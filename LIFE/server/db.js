/**
 * L.I.F.E. Database Module
 * SQLite on disk via better-sqlite3 (WAL journal, foreign keys, real transactions).
 *
 * Writes go straight to database/life.db through SQLite's own journal, so a crash or
 * power cut cannot leave a half-written file, and tools such as DB Browser for SQLite
 * can read the database while the server runs.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATABASE_DIR = path.join(__dirname, '..', 'database');
const SCHEMA_PATH = path.join(DATABASE_DIR, 'schema.sql');

let db = null;
const statementCache = new Map();

// Columns that hold UTC "YYYY-MM-DD HH:MM:SS" text. They are returned to clients as ISO-8601
// with a trailing "Z" so browsers parse them as UTC instead of local time.
const UTC_DATETIME_COLUMNS = new Set([
    'date_time',
    'date_registered',
    'created_at',
    'updated_at',
    'last_session',
]);
const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function resolveDbPath() {
    const configured = process.env.LIFE_DB_PATH || 'life.db';
    return path.isAbsolute(configured) ? configured : path.join(DATABASE_DIR, configured);
}

function normalizeRow(row) {
    if (!row || typeof row !== 'object') return row;
    for (const key of Object.keys(row)) {
        const value = row[key];
        if (UTC_DATETIME_COLUMNS.has(key) && typeof value === 'string' && SQLITE_DATETIME.test(value)) {
            row[key] = `${value.replace(' ', 'T')}Z`;
        }
    }
    return row;
}

function addColumnIfMissing(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(existing => existing.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

/**
 * Bring databases created by older versions up to the current schema.
 */
function runMigrations() {
    addColumnIfMissing('sessions', 'client_session_id', 'TEXT');
    addColumnIfMissing('sessions', 'procedure_steps', "TEXT DEFAULT '{}'");
    addColumnIfMissing('users', 'must_change_password', 'INTEGER DEFAULT 0');
    addColumnIfMissing('users', 'token_version', 'INTEGER DEFAULT 0');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_client_session_id ON sessions(client_session_id)');
    migrateUsersForTraineeAccounts();
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_trainee ON users(trainee_id) WHERE trainee_id IS NOT NULL');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', '3')").run();
}

/**
 * Schema v3: trainee sign-in accounts. SQLite cannot change a CHECK constraint in place, so an
 * older users table is rebuilt with the 'trainee' role and a trainee_id link. A consistent copy
 * of the database is written to backups/ first.
 */
function migrateUsersForTraineeAccounts() {
    const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    if (!table || table.sql.includes("'trainee'")) return;

    const backupDir = path.join(path.dirname(db.name), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(backupDir, `pre_trainee_accounts_${stamp}.db`);
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    db.pragma('foreign_keys = OFF');
    try {
        db.transaction(() => {
            db.exec(`CREATE TABLE users_v3 (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'trainer', 'trainee')),
    trainee_id INTEGER REFERENCES trainees(trainee_id) ON DELETE CASCADE, -- set only for trainee accounts
    is_active INTEGER DEFAULT 1,
    must_change_password INTEGER DEFAULT 0, -- 1 = user must set a new password at next login
    token_version INTEGER DEFAULT 0,        -- bumped to revoke all issued tokens
    created_at TEXT DEFAULT (datetime('now')),
    CHECK ((role = 'trainee') = (trainee_id IS NOT NULL))
);`);
            db.exec(`
                INSERT INTO users_v3 (user_id, username, password_hash, role, is_active, must_change_password, token_version, created_at)
                SELECT user_id, username, password_hash, role, is_active, must_change_password, token_version, created_at FROM users
            `);
            db.exec('DROP TABLE users');
            db.exec('ALTER TABLE users_v3 RENAME TO users');
            db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
        })();
    } finally {
        db.pragma('foreign_keys = ON');
    }
    console.log(`Database upgraded for trainee accounts (backup: ${backupPath})`);
}

/**
 * Open the database and apply the schema. Safe to call more than once.
 */
export function initializeDatabase() {
    if (db) return db;

    const dbPath = resolveDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');

    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
    runMigrations();

    console.log(`Database ready (better-sqlite3, WAL): ${dbPath}`);
    return db;
}

export function getDatabase() {
    if (!db) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    return db;
}

/**
 * Prepared statement with run/get/all. get() returns null when there is no row,
 * and date columns are normalized to ISO-8601 UTC.
 */
export function prepare(sql) {
    const database = getDatabase();
    let statement = statementCache.get(sql);
    if (!statement) {
        statement = database.prepare(sql);
        statementCache.set(sql, statement);
    }

    return {
        run: (...params) => {
            const info = statement.run(...params);
            return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
        },
        get: (...params) => normalizeRow(statement.get(...params)) ?? null,
        all: (...params) => statement.all(...params).map(normalizeRow),
    };
}

/**
 * Run fn inside a transaction; rolls back if fn throws.
 */
export function transaction(fn) {
    return getDatabase().transaction(fn)();
}

/**
 * Consistent online backup (safe while the server is handling requests).
 */
export async function backupDatabase(backupPath) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    await getDatabase().backup(backupPath);
    return backupPath;
}

export function closeDatabase() {
    if (db) {
        statementCache.clear();
        db.close();
        db = null;
    }
}
