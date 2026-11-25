/**
 * Automatic daily database backup.
 *
 * On start and then hourly, writes database/backups/auto_YYYY-MM-DD.db (local date) if today's
 * copy does not exist yet, and keeps only the newest `keep` automatic copies. Manual backups
 * from the Settings page (life_backup_*.db) are never pruned. Disable with LIFE_AUTO_BACKUP=0.
 */

import fs from 'fs';
import path from 'path';
import { backupDatabase } from '../db.js';

const AUTO_PATTERN = /^auto_\d{4}-\d{2}-\d{2}\.db$/;

export function localDateStamp(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Delete the oldest automatic backups beyond `keep`. Returns the deleted file names. */
export function pruneAutoBackups(dir, keep) {
    if (!fs.existsSync(dir)) return [];
    const autos = fs.readdirSync(dir).filter(name => AUTO_PATTERN.test(name)).sort(); // date order
    const remove = autos.slice(0, Math.max(0, autos.length - keep));
    for (const name of remove) fs.rmSync(path.join(dir, name), { force: true });
    return remove;
}

/**
 * Make today's automatic backup if it is missing. Returns the backup path, or null if one
 * already existed for today.
 */
export async function runDailyBackup({ dir, keep = 14, now = new Date(), backup = backupDatabase } = {}) {
    const target = path.join(dir, `auto_${localDateStamp(now)}.db`);
    if (fs.existsSync(target)) return null;
    // Write to a temporary name first so a crash never leaves a half-written "today" file.
    const partial = `${target}.partial`;
    await backup(partial);
    fs.renameSync(partial, target);
    pruneAutoBackups(dir, keep);
    return target;
}

export function startAutoBackups(dbPath, { keep = 14, intervalMs = 60 * 60 * 1000 } = {}) {
    if (process.env.LIFE_AUTO_BACKUP === '0') return null;
    const dir = path.join(path.dirname(dbPath), 'backups');
    const tick = () => runDailyBackup({ dir, keep })
        .then(created => { if (created) console.log(`Automatic backup: ${created}`); })
        .catch(err => console.error('Automatic backup failed:', err.message));
    void tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref();
    return timer;
}
