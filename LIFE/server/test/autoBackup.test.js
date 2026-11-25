import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { localDateStamp, pruneAutoBackups, runDailyBackup } from '../lib/autoBackup.js';

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'life-autobackup-'));
}

const fakeBackup = async target => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'db');
};

test('creates one backup per local day and skips if it already exists', async () => {
    const dir = tempDir();
    const now = new Date(2026, 10, 25, 9, 0);
    const first = await runDailyBackup({ dir, now, backup: fakeBackup });
    assert.equal(path.basename(first), `auto_${localDateStamp(now)}.db`);
    assert.equal(path.basename(first), 'auto_2026-11-25.db');
    assert.equal(await runDailyBackup({ dir, now, backup: fakeBackup }), null);
    assert.deepEqual(fs.readdirSync(dir), ['auto_2026-11-25.db']); // no .partial left behind
});

test('keeps only the newest automatic backups and never touches manual ones', async () => {
    const dir = tempDir();
    for (let day = 1; day <= 5; day += 1) {
        await runDailyBackup({ dir, keep: 3, now: new Date(2026, 10, day), backup: fakeBackup });
    }
    fs.writeFileSync(path.join(dir, 'life_backup_2026-01-01T00-00-00.db'), 'manual');
    pruneAutoBackups(dir, 3);
    assert.deepEqual(fs.readdirSync(dir).sort(), [
        'auto_2026-11-03.db', 'auto_2026-11-04.db', 'auto_2026-11-05.db', 'life_backup_2026-01-01T00-00-00.db',
    ]);
});

test('a failed backup leaves no file for today', async () => {
    const dir = tempDir();
    await assert.rejects(runDailyBackup({ dir, now: new Date(2026, 10, 25), backup: async () => { throw new Error('disk full'); } }));
    assert.equal(fs.existsSync(path.join(dir, 'auto_2026-11-25.db')), false);
});
