/**
 * Permanent online storage in Turso (a free, SQLite-compatible cloud database).
 *
 * Hosting without a persistent disk (the Render free plan) starts every restart, redeploy or
 * sleep with an empty disk. When TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set:
 *   - at startup, if there is no local database file, the latest copy is restored from Turso
 *     before the server opens the database;
 *   - while running, a compressed copy of the whole database is uploaded within a couple of
 *     seconds of any change, and once more when the server shuts down (Render stops a sleeping
 *     service with SIGTERM).
 * So trainees, accounts, sessions and settings stay until someone deletes them in the app.
 *
 * The server keeps using the local SQLite file for every request (fast, synchronous, real
 * transactions); Turso only holds the copy. Use one Turso database per running server.
 *
 * If Turso cannot be reached at startup the server refuses to start instead of starting empty,
 * because an empty database would otherwise be uploaded over the saved one.
 */

import crypto from 'crypto';
import fs from 'fs';
import zlib from 'zlib';

const DEFAULT_CHUNK_BYTES = 512 * 1024; // keeps every HTTP request well under Turso's size limit
const REQUEST_TIMEOUT_MS = 30_000;

const SETUP_SQL = [
    `CREATE TABLE IF NOT EXISTS life_snapshot_chunks (
        generation TEXT NOT NULL,
        idx INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (generation, idx)
    )`,
    `CREATE TABLE IF NOT EXISTS life_snapshot_head (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        generation TEXT NOT NULL,
        chunks INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        updated_at TEXT NOT NULL
    )`,
];

/** True when both Turso settings are present (does not check that they work). */
export function isCloudSyncConfigured(env = process.env) {
    return Boolean((env.TURSO_DATABASE_URL || '').trim() && (env.TURSO_AUTH_TOKEN || '').trim());
}

/**
 * Turso connection settings, or null when cloud storage is not configured.
 * Throws when only one of the two settings is present, so a typo is not silently ignored.
 */
export function cloudSyncConfig(env = process.env) {
    const url = (env.TURSO_DATABASE_URL || '').trim();
    const token = (env.TURSO_AUTH_TOKEN || '').trim();
    if (!url && !token) return null;
    if (!url || !token) {
        throw new Error('Cloud storage needs both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (or neither).');
    }
    // Turso shows libsql://name-org.turso.io; the HTTP API is the same host over https.
    const httpUrl = url.replace(/^libsql:\/\//i, 'https://').replace(/^wss:\/\//i, 'https://').replace(/\/+$/, '');
    return { url: httpUrl, token };
}

// --- Turso HTTP API (Hrana over HTTP, /v2/pipeline) ---------------------------------------

function toValue(value) {
    if (value === null || value === undefined) return { type: 'null' };
    if (Buffer.isBuffer(value)) return { type: 'blob', base64: value.toString('base64') };
    if (typeof value === 'number' && Number.isInteger(value)) return { type: 'integer', value: String(value) };
    if (typeof value === 'number') return { type: 'float', value };
    return { type: 'text', value: String(value) };
}

function fromValue(value) {
    switch (value?.type) {
        case 'integer': return Number(value.value);
        case 'float': return Number(value.value);
        case 'text': return value.value;
        case 'blob': return Buffer.from(value.base64 || '', 'base64');
        default: return null;
    }
}

/**
 * Returns execute(statements) → [{ rows, changes }], running [{ sql, args }] in order.
 * Throws on any HTTP or SQL error.
 */
export function createHttpTransport({ url, token }, fetchImpl = globalThis.fetch) {
    return async function execute(statements) {
        const requests = statements.map(({ sql, args = [] }) => ({
            type: 'execute',
            stmt: { sql, args: args.map(toValue) },
        }));
        requests.push({ type: 'close' });

        let response;
        try {
            response = await fetchImpl(`${url}/v2/pipeline`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ baton: null, requests }),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (err) {
            throw new Error(`Turso is not reachable (${err.message})`);
        }
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            const hint = response.status === 401 || response.status === 403 ? ' (check TURSO_AUTH_TOKEN)' : '';
            throw new Error(`Turso answered HTTP ${response.status}${hint}: ${text.slice(0, 200)}`);
        }

        const body = await response.json();
        return statements.map((_, index) => {
            const result = body.results?.[index];
            if (!result || result.type !== 'ok') {
                throw new Error(`Turso error: ${result?.error?.message || 'no result'}`);
            }
            const { cols = [], rows = [], affected_row_count: changes = 0 } = result.response?.result || {};
            const names = cols.map(col => col.name);
            return {
                rows: rows.map(row => Object.fromEntries(row.map((value, i) => [names[i], fromValue(value)]))),
                changes,
            };
        });
    };
}

// --- Snapshot store ------------------------------------------------------------------------

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

/** Snapshot storage on top of an execute() transport. */
export function createSnapshotStore(execute, { chunkBytes = DEFAULT_CHUNK_BYTES } = {}) {
    let ready = null;
    const ensureTables = () => {
        ready ??= execute(SETUP_SQL.map(sql => ({ sql }))).catch(err => { ready = null; throw err; });
        return ready;
    };

    return {
        /** Upload a database image. The new copy replaces the old one only once it is complete. */
        async save(databaseBuffer) {
            await ensureTables();
            const compressed = zlib.gzipSync(databaseBuffer);
            const digest = sha256(compressed);
            const generation = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
            const chunks = Math.max(1, Math.ceil(compressed.length / chunkBytes));

            for (let idx = 0; idx < chunks; idx += 1) {
                const data = compressed.subarray(idx * chunkBytes, (idx + 1) * chunkBytes);
                await execute([{
                    sql: 'INSERT INTO life_snapshot_chunks (generation, idx, data) VALUES (?, ?, ?)',
                    args: [generation, idx, Buffer.from(data)],
                }]);
            }
            // Switching the head row is a single-row write, so a reader sees the old copy or the
            // new one, never a mix. Chunks of failed or older uploads are removed afterwards.
            await execute([{
                sql: `INSERT INTO life_snapshot_head (id, generation, chunks, sha256, bytes, updated_at)
                      VALUES (1, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, chunks = excluded.chunks,
                          sha256 = excluded.sha256, bytes = excluded.bytes, updated_at = excluded.updated_at`,
                args: [generation, chunks, digest, databaseBuffer.length, new Date().toISOString()],
            }]);
            await execute([{ sql: 'DELETE FROM life_snapshot_chunks WHERE generation <> ?', args: [generation] }])
                .catch(err => console.error('Cloud storage: could not remove old copies:', err.message));
            return { bytes: databaseBuffer.length, compressedBytes: compressed.length, chunks };
        },

        /** The latest database image, or null if nothing has been saved yet. */
        async load() {
            await ensureTables();
            const [{ rows: heads }] = await execute([{ sql: 'SELECT * FROM life_snapshot_head WHERE id = 1' }]);
            const head = heads[0];
            if (!head) return null;

            const [{ rows }] = await execute([{
                sql: 'SELECT idx, data FROM life_snapshot_chunks WHERE generation = ? ORDER BY idx',
                args: [head.generation],
            }]);
            if (rows.length !== head.chunks || rows.some((row, i) => row.idx !== i)) {
                throw new Error(`Cloud copy is incomplete (${rows.length} of ${head.chunks} parts)`);
            }
            const compressed = Buffer.concat(rows.map(row => row.data));
            if (sha256(compressed) !== head.sha256) {
                throw new Error('Cloud copy failed its checksum');
            }
            return { buffer: zlib.gunzipSync(compressed), updatedAt: head.updated_at };
        },
    };
}

// --- Startup restore and background upload -------------------------------------------------

/**
 * Before the database is opened: if there is no local database file, write the latest cloud
 * copy there. Returns 'local' (a local file already exists and is used), 'restored', or 'empty'
 * (nothing saved in the cloud yet). Throws if the cloud copy cannot be read.
 */
export async function restoreFromCloud(dbPath, store, { attempts = 3, retryDelayMs = 2000 } = {}) {
    // On the same running machine the local file is never older than the cloud copy.
    if (fs.existsSync(dbPath)) return { status: 'local' };

    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const snapshot = await store.load();
            if (!snapshot) return { status: 'empty' };
            for (const suffix of ['-wal', '-shm', '.restore']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
            fs.writeFileSync(`${dbPath}.restore`, snapshot.buffer);
            fs.renameSync(`${dbPath}.restore`, dbPath);
            return { status: 'restored', bytes: snapshot.buffer.length, updatedAt: snapshot.updatedAt };
        } catch (err) {
            lastError = err;
            if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
    }
    throw new Error(`Could not read the saved data from cloud storage: ${lastError.message}`);
}

/**
 * Upload the database whenever it has changed (checked every intervalMs).
 * getDatabase() returns the open better-sqlite3 connection.
 * Returns { flush(), stop(), status() }; flush() uploads now if anything changed.
 */
export function startCloudSync(getDatabase, store, { intervalMs = 2000 } = {}) {
    let uploadedChanges = null; // total_changes() value contained in the last successful upload
    let inFlight = null;
    let lastError = null;
    let lastSavedAt = null;
    let announced = false;

    const changeCounter = () => getDatabase().prepare('SELECT total_changes() AS n').get().n;

    const uploadIfChanged = async () => {
        const changes = changeCounter();
        if (changes === uploadedChanges) return false;
        // serialize() is synchronous, so no request can change the database in between.
        const image = getDatabase().serialize();
        try {
            const info = await store.save(image);
            uploadedChanges = changes;
            lastSavedAt = new Date().toISOString();
            if (lastError || !announced) {
                console.log(`Cloud storage: data saved to Turso (${Math.ceil(info.compressedBytes / 1024)} KB).`);
            }
            lastError = null;
            announced = true;
            return true;
        } catch (err) {
            if (!lastError) console.error(`Cloud storage: upload failed, will retry: ${err.message}`);
            lastError = err.message;
            throw err;
        }
    };

    const flush = async () => {
        // Wait for an upload in progress, then upload again if more changes arrived meanwhile.
        while (inFlight) await inFlight.catch(() => {});
        inFlight = uploadIfChanged().finally(() => { inFlight = null; });
        return inFlight;
    };

    const timer = setInterval(() => {
        if (!inFlight) flush().catch(() => {});
    }, intervalMs);
    timer.unref();

    const sync = {
        flush,
        stop: () => {
            clearInterval(timer);
            if (active === sync) active = null;
        },
        status: () => ({ lastSavedAt, lastError, pending: uploadedChanges === null || changeCounter() !== uploadedChanges }),
    };
    active = sync;
    return sync;
}

let active = null;

/** Status of the running cloud upload for /api/health, or null when cloud storage is off. */
export function cloudSyncStatus() {
    return active ? active.status() : null;
}
