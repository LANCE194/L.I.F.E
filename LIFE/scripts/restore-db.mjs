#!/usr/bin/env node
/**
 * Restore the L.I.F.E. database from a backup file.
 *
 *   npm run restore -- <backup-file> [--yes]
 *
 * Accepts either
 *   - a plain SQLite backup (Settings → Download backup, database/backups/*.db), or
 *   - a cloud snapshot export (a Turso database copy holding the life_snapshot_* tables that the
 *     online server writes, see server/lib/cloudSync.js); the newest snapshot inside it is unpacked
 *     and verified against its checksum.
 *
 * The current database/life.db (including anything still in its WAL journal) is first copied to
 * database/backups/life_before_restore_<time>.db, so a restore can always be undone.
 * Stop the L.I.F.E. server before restoring.
 */

import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'server', 'package.json'));
const Database = require('better-sqlite3');

const REQUIRED_TABLES = ['trainees', 'sessions', 'users', 'settings'];

/** Returns the SQLite image to restore as a Buffer, plus a short description of the source. */
export function readBackupImage(file) {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
        if (REQUIRED_TABLES.every(name => tables.has(name))) {
            return { image: db.serialize(), kind: 'plain SQLite backup' };
        }
        if (tables.has('life_snapshot_head') && tables.has('life_snapshot_chunks')) {
            const head = db.prepare('SELECT * FROM life_snapshot_head WHERE id = 1').get();
            if (!head) throw new Error('The cloud snapshot export contains no saved copy.');
            const rows = db.prepare('SELECT idx, data FROM life_snapshot_chunks WHERE generation = ? ORDER BY idx').all(head.generation);
            if (rows.length !== head.chunks || rows.some((row, i) => row.idx !== i)) {
                throw new Error(`The cloud snapshot is incomplete (${rows.length} of ${head.chunks} parts).`);
            }
            const compressed = Buffer.concat(rows.map(row => row.data));
            if (crypto.createHash('sha256').update(compressed).digest('hex') !== head.sha256) {
                throw new Error('The cloud snapshot failed its checksum.');
            }
            return { image: zlib.gunzipSync(compressed), kind: `cloud snapshot saved ${head.updated_at}` };
        }
        throw new Error('This file is not a L.I.F.E. backup (no trainees/sessions tables and no cloud snapshot).');
    } finally {
        db.close();
    }
}

/**
 * Row counts of the main tables in a SQLite image (also proves the image opens). The image is
 * checked through a temporary file because WAL-mode images cannot be opened in memory.
 */
export function describeImage(image) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-restore-'));
    const file = path.join(dir, 'check.db');
    fs.writeFileSync(file, image);
    const db = new Database(file);
    try {
        const integrity = db.pragma('integrity_check', { simple: true });
        if (integrity !== 'ok') throw new Error(`The backup failed its integrity check (${integrity}).`);
        const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
        return {
            trainees: count('trainees'),
            users: count('users'),
            sessions: count('sessions'),
            session_details: count('session_details'),
        };
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

async function main() {
    const args = process.argv.slice(2);
    const file = args.find(arg => !arg.startsWith('--'));
    if (!file) {
        console.log('Usage: npm run restore -- <backup-file> [--yes]');
        process.exit(1);
    }

    const target = path.join(ROOT, 'database', process.env.LIFE_DB_PATH || 'life.db');
    const source = path.resolve(file);
    if (path.resolve(target) === source) {
        console.error('The backup file is the live database itself; choose a backup copy.');
        process.exit(1);
    }

    const { image, kind } = readBackupImage(source);
    const counts = describeImage(image);
    console.log(`Backup: ${source}`);
    console.log(`Type:   ${kind}`);
    console.log(`Holds:  ${counts.trainees} trainees, ${counts.users} accounts, ${counts.sessions} sessions, ${counts.session_details} compression records`);

    if (!args.includes('--yes')) {
        console.log('\nThis replaces database/life.db. Run again with --yes to restore.');
        return;
    }

    const backupDir = path.join(path.dirname(target), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    if (fs.existsSync(target)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safety = path.join(backupDir, `life_before_restore_${stamp}.db`);
        const current = new Database(target);
        try {
            await current.backup(safety); // includes changes still in the WAL journal
        } finally {
            current.close();
        }
        console.log(`Current database saved to ${safety}`);
    }

    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${target}${suffix}`, { force: true });
    fs.writeFileSync(`${target}.restore`, image);
    fs.renameSync(`${target}.restore`, target);
    console.log(`Restored to ${target}. Start L.I.F.E. as usual; the database is upgraded automatically if needed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(err => {
        console.error(`Restore failed: ${err.message}`);
        process.exit(1);
    });
}
