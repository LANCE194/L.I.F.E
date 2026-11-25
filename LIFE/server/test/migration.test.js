/**
 * Upgrading a database created before trainee accounts existed (schema v2).
 * Runs in its own process (node:test isolates files), so it has its own database.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

test('v2 users table is rebuilt with the trainee role, keeping existing accounts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-migrate-'));
    const dbPath = path.join(dir, 'old.db');
    const schema = fs.readFileSync(new URL('../../database/schema.sql', import.meta.url), 'utf-8');
    const v2Users = `CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'trainer')),
    is_active INTEGER DEFAULT 1,
    must_change_password INTEGER DEFAULT 0,
    token_version INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);`;
    const oldSchema = schema.replace(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/, v2Users);
    assert.notEqual(oldSchema, schema);

    const old = new Database(dbPath);
    old.exec(oldSchema);
    old.prepare("INSERT INTO users (username, password_hash, role, token_version) VALUES ('boss', 'hash', 'admin', 3)").run();
    old.prepare("INSERT INTO trainees (full_name) VALUES ('Ana')").run();
    old.close();

    process.env.LIFE_DB_PATH = dbPath;
    process.env.LIFE_SECRET_PATH = path.join(dir, 'secret');
    const { initializeDatabase, prepare, closeDatabase } = await import('../db.js');
    initializeDatabase();

    const sql = prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get().sql;
    assert.match(sql, /'trainee'/);
    assert.match(sql, /trainee_id/);
    assert.deepEqual(prepare('SELECT username, role, token_version FROM users').all(), [{ username: 'boss', role: 'admin', token_version: 3 }]);
    prepare("INSERT INTO users (username, password_hash, role, trainee_id) VALUES ('ana', 'h', 'trainee', 1)").run();
    assert.throws(() => prepare("INSERT INTO users (username, password_hash, role) VALUES ('nolink', 'h', 'trainee')").run(), /CHECK/);
    assert.throws(() => prepare("INSERT INTO users (username, password_hash, role, trainee_id) VALUES ('ana2', 'h', 'trainee', 1)").run(), /UNIQUE/);
    assert.ok(fs.readdirSync(path.join(dir, 'backups')).some(name => name.startsWith('pre_trainee_accounts_')));
    assert.equal(prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
});
