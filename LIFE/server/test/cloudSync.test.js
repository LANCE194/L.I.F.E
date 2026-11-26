/**
 * Permanent online storage (Turso): data written before a restart is back after it, nothing is
 * uploaded over the saved copy when Turso cannot be read, and only changes trigger uploads.
 * A fake Turso HTTP API (Hrana /v2/pipeline) backed by an in-memory SQLite database stands in
 * for the real service, so the real HTTP transport code is exercised.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    cloudSyncConfig,
    createHttpTransport,
    createSnapshotStore,
    isCloudSyncConfigured,
    restoreFromCloud,
    startCloudSync,
} from '../lib/cloudSync.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-cloudsync-'));
after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

function decode(value) {
    switch (value.type) {
        case 'null': return null;
        case 'integer': return BigInt(value.value);
        case 'float': return value.value;
        case 'text': return value.value;
        case 'blob': return Buffer.from(value.base64, 'base64');
        default: throw new Error(`unknown value type ${value.type}`);
    }
}

function encode(value) {
    if (value === null) return { type: 'null' };
    if (Buffer.isBuffer(value)) return { type: 'blob', base64: value.toString('base64').replace(/=+$/, '') };
    if (typeof value === 'bigint' || Number.isInteger(value)) return { type: 'integer', value: String(value) };
    if (typeof value === 'number') return { type: 'float', value };
    return { type: 'text', value };
}

/** A fake Turso: returns { fetch, calls, remote, failing } where remote is the cloud database. */
function fakeTurso({ token = 'secret-token' } = {}) {
    const remote = new Database(':memory:');
    remote.defaultSafeIntegers(true);
    const state = { calls: 0, failing: false, remote };
    state.fetch = async (url, options) => {
        state.calls += 1;
        if (state.failing) throw new Error('getaddrinfo ENOTFOUND');
        assert.match(url, /^https:\/\/life-test\.turso\.io\/v2\/pipeline$/);
        if (options.headers.Authorization !== `Bearer ${token}`) {
            return new Response('{"error":"Unauthorized"}', { status: 401 });
        }
        const { requests } = JSON.parse(options.body);
        const results = requests.map(request => {
            if (request.type === 'close') return { type: 'ok', response: { type: 'close' } };
            try {
                const statement = remote.prepare(request.stmt.sql);
                const args = request.stmt.args.map(decode);
                if (statement.reader) {
                    const cols = statement.columns().map(col => ({ name: col.name, decltype: col.type }));
                    const rows = statement.raw(true).all(...args).map(row => row.map(encode));
                    return { type: 'ok', response: { type: 'execute', result: { cols, rows, affected_row_count: 0 } } };
                }
                const info = statement.run(...args);
                return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: Number(info.changes) } } };
            } catch (err) {
                return { type: 'error', error: { message: err.message } };
            }
        });
        return new Response(JSON.stringify({ baton: null, base_url: null, results }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    return state;
}

const config = { url: 'https://life-test.turso.io', token: 'secret-token' };
const storeFor = (turso, options) => createSnapshotStore(createHttpTransport(config, turso.fetch), options);

function makeLocalDatabase(file) {
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE trainees (id INTEGER PRIMARY KEY, name TEXT, photo BLOB)');
    return db;
}

test('configuration: both Turso settings, or neither', () => {
    assert.equal(cloudSyncConfig({}), null);
    assert.equal(isCloudSyncConfigured({}), false);
    assert.deepEqual(
        cloudSyncConfig({ TURSO_DATABASE_URL: ' libsql://life-test.turso.io/ ', TURSO_AUTH_TOKEN: ' abc ' }),
        { url: 'https://life-test.turso.io', token: 'abc' }
    );
    assert.equal(isCloudSyncConfigured({ TURSO_DATABASE_URL: 'libsql://x', TURSO_AUTH_TOKEN: 'y' }), true);
    assert.throws(() => cloudSyncConfig({ TURSO_DATABASE_URL: 'libsql://x' }), /both/);
});

test('data written before a restart is restored after it', async () => {
    const turso = fakeTurso();
    const file = path.join(tempDir, 'roundtrip.db');
    const db = makeLocalDatabase(file);
    const sync = startCloudSync(() => db, storeFor(turso), { intervalMs: 60_000 });

    db.prepare('INSERT INTO trainees (name) VALUES (?)').run('Juan Dela Cruz');
    db.prepare('INSERT INTO trainees (name, photo) VALUES (?, ?)').run('Maria Clara', Buffer.from([0, 1, 2, 255]));
    assert.equal(await sync.flush(), true);
    sync.stop();
    db.close();

    // The machine goes away: the disk is empty after the restart.
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });

    const result = await restoreFromCloud(file, storeFor(turso));
    assert.equal(result.status, 'restored');
    const reopened = new Database(file);
    assert.deepEqual(
        reopened.prepare('SELECT name, photo FROM trainees ORDER BY id').all(),
        [{ name: 'Juan Dela Cruz', photo: null }, { name: 'Maria Clara', photo: Buffer.from([0, 1, 2, 255]) }]
    );
    assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok');
    reopened.close();
});

test('a deletion is kept too: deleted data does not come back after a restart', async () => {
    const turso = fakeTurso();
    const file = path.join(tempDir, 'delete.db');
    const db = makeLocalDatabase(file);
    const sync = startCloudSync(() => db, storeFor(turso), { intervalMs: 60_000 });
    db.prepare("INSERT INTO trainees (name) VALUES ('Keep'), ('Remove')").run();
    await sync.flush();
    db.prepare("DELETE FROM trainees WHERE name = 'Remove'").run();
    await sync.flush();
    sync.stop();
    db.close();
    fs.rmSync(file, { force: true });

    await restoreFromCloud(file, storeFor(turso));
    const reopened = new Database(file);
    assert.deepEqual(reopened.prepare('SELECT name FROM trainees').all(), [{ name: 'Keep' }]);
    reopened.close();
    // Only the newest copy is kept in Turso.
    assert.equal(Number(turso.remote.prepare('SELECT COUNT(DISTINCT generation) AS n FROM life_snapshot_chunks').get().n), 1);
});

test('nothing is uploaded when nothing changed', async () => {
    const turso = fakeTurso();
    const db = makeLocalDatabase(path.join(tempDir, 'unchanged.db'));
    const sync = startCloudSync(() => db, storeFor(turso), { intervalMs: 60_000 });
    assert.equal(await sync.flush(), true); // first copy
    const callsAfterFirst = turso.calls;
    assert.equal(await sync.flush(), false);
    assert.equal(turso.calls, callsAfterFirst);
    db.prepare("INSERT INTO trainees (name) VALUES ('New')").run();
    assert.equal(await sync.flush(), true);
    sync.stop();
    db.close();
});

test('changes are uploaded automatically in the background', async () => {
    const turso = fakeTurso();
    const db = makeLocalDatabase(path.join(tempDir, 'background.db'));
    const sync = startCloudSync(() => db, storeFor(turso), { intervalMs: 20 });
    db.prepare("INSERT INTO trainees (name) VALUES ('Auto')").run();
    for (let i = 0; i < 100 && sync.status().pending; i += 1) await new Promise(r => setTimeout(r, 20));
    assert.equal(sync.status().pending, false);
    assert.ok(sync.status().lastSavedAt);
    sync.stop();
    db.close();
});

test('large databases are split into parts and restored intact', async () => {
    const turso = fakeTurso();
    const file = path.join(tempDir, 'large.db');
    const db = makeLocalDatabase(file);
    const insert = db.prepare('INSERT INTO trainees (name, photo) VALUES (?, ?)');
    for (let i = 0; i < 50; i += 1) insert.run(`T${i}`, crypto.getRandomValues(Buffer.alloc(2000)));
    const sync = startCloudSync(() => db, storeFor(turso, { chunkBytes: 4096 }), { intervalMs: 60_000 });
    await sync.flush();
    sync.stop();
    const expected = db.prepare('SELECT name, photo FROM trainees ORDER BY id').all();
    db.close();
    assert.ok(Number(turso.remote.prepare('SELECT COUNT(*) AS n FROM life_snapshot_chunks').get().n) > 10);

    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
    await restoreFromCloud(file, storeFor(turso));
    const reopened = new Database(file);
    assert.deepEqual(reopened.prepare('SELECT name, photo FROM trainees ORDER BY id').all(), expected);
    reopened.close();
});

test('an empty Turso database starts a new local database', async () => {
    const turso = fakeTurso();
    const file = path.join(tempDir, 'fresh.db');
    assert.deepEqual(await restoreFromCloud(file, storeFor(turso)), { status: 'empty' });
    assert.equal(fs.existsSync(file), false);
});

test('an existing local database is used as is (it is never older than the cloud copy)', async () => {
    const turso = fakeTurso();
    const file = path.join(tempDir, 'existing.db');
    makeLocalDatabase(file).close();
    assert.deepEqual(await restoreFromCloud(file, storeFor(turso)), { status: 'local' });
    assert.equal(turso.calls, 0);
});

test('if Turso cannot be read, startup fails instead of starting empty', async () => {
    const turso = fakeTurso();
    turso.failing = true;
    const file = path.join(tempDir, 'unreachable.db');
    await assert.rejects(restoreFromCloud(file, storeFor(turso), { attempts: 2, retryDelayMs: 1 }), /not reachable/);
    assert.equal(fs.existsSync(file), false);
});

test('a wrong token is reported clearly', async () => {
    const turso = fakeTurso({ token: 'other' });
    await assert.rejects(
        restoreFromCloud(path.join(tempDir, 'badtoken.db'), storeFor(turso), { attempts: 1 }),
        /HTTP 401 \(check TURSO_AUTH_TOKEN\)/
    );
});

test('a damaged cloud copy is refused, not loaded', async () => {
    const turso = fakeTurso();
    const db = makeLocalDatabase(path.join(tempDir, 'damaged-src.db'));
    const sync = startCloudSync(() => db, storeFor(turso), { intervalMs: 60_000 });
    await sync.flush();
    sync.stop();
    db.close();
    turso.remote.prepare('UPDATE life_snapshot_chunks SET data = ?').run(Buffer.from('garbage'));
    const file = path.join(tempDir, 'damaged.db');
    await assert.rejects(restoreFromCloud(file, storeFor(turso), { attempts: 1 }), /checksum/);
    assert.equal(fs.existsSync(file), false);
});

test('a failed upload is retried and does not replace the saved copy', async () => {
    const turso = fakeTurso();
    const file = path.join(tempDir, 'retry.db');
    const db = makeLocalDatabase(file);
    const sync = startCloudSync(() => db, storeFor(turso), { intervalMs: 60_000 });
    db.prepare("INSERT INTO trainees (name) VALUES ('First')").run();
    await sync.flush();

    turso.failing = true;
    db.prepare("INSERT INTO trainees (name) VALUES ('Second')").run();
    await assert.rejects(sync.flush());
    assert.equal(sync.status().pending, true);
    assert.match(sync.status().lastError, /not reachable/);

    turso.failing = false;
    assert.equal(await sync.flush(), true);
    assert.equal(sync.status().lastError, null);
    sync.stop();
    db.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
    await restoreFromCloud(file, storeFor(turso));
    const reopened = new Database(file);
    assert.deepEqual(reopened.prepare('SELECT name FROM trainees ORDER BY id').all(), [{ name: 'First' }, { name: 'Second' }]);
    reopened.close();
});

test('online with Turso, storage counts as permanent (admin password is no longer reset at each start)', async () => {
    const { isEphemeralCloud } = await import('../seed_admin.js');
    const saved = { ...process.env };
    try {
        process.env.RENDER = 'true';
        delete process.env.LIFE_DB_PATH;
        delete process.env.LIFE_STORAGE;
        delete process.env.TURSO_DATABASE_URL;
        delete process.env.TURSO_AUTH_TOKEN;
        assert.equal(isEphemeralCloud(), true);
        process.env.TURSO_DATABASE_URL = 'libsql://life-test.turso.io';
        process.env.TURSO_AUTH_TOKEN = 'abc';
        assert.equal(isEphemeralCloud(), false);
    } finally {
        for (const key of ['RENDER', 'LIFE_DB_PATH', 'LIFE_STORAGE', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    }
});
