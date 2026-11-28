/**
 * L.I.F.E. Settings Routes
 * Calibration/configuration (validated whitelist) and database backup.
 */

import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prepare, transaction, backupDatabase, resolveDbPath } from '../db.js';
import { attachmentHeader } from '../lib/escape.js';
import { authenticate } from '../middleware/auth.js';
import { trainerOrAdmin, adminOnly, practiceAccess } from '../middleware/roles.js';
import { fail, handle } from '../lib/validate.js';

const router = express.Router();

/**
 * Every editable setting with its allowed range. Keys not listed here are rejected.
 * Ranges match the Settings page inputs.
 */
export const SETTING_RULES = {
    angle_threshold: { min: 120, max: 180 },
    smoothing_window: { min: 1, max: 20, integer: true },
    visibility_threshold: { min: 0.1, max: 1 },
    min_peak_distance_ms: { min: 200, max: 1000, integer: true },
    peak_prominence: { min: 0.002, max: 0.2 },
    bpm_min: { min: 60, max: 120, integer: true },
    bpm_max: { min: 100, max: 160, integer: true },
    bpm_window_intervals: { min: 2, max: 10, integer: true },
    session_duration_sec: { min: 30, max: 600, integer: true },
    pass_mark_pct: { min: 50, max: 100 },
    metronome_bpm: { min: 80, max: 140, integer: true },
    camera_width: { min: 320, max: 1920, integer: true },
    camera_height: { min: 240, max: 1080, integer: true },
    camera_framerate: { min: 15, max: 60, integer: true },
};

function readSettings() {
    const settings = {};
    for (const { key, value } of prepare('SELECT key, value FROM settings ORDER BY key').all()) {
        if (key === 'schema_version') continue;
        const number = Number(value);
        settings[key] = value !== '' && Number.isFinite(number) ? number : value;
    }
    return settings;
}

function validateSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Settings object required');

    const clean = {};
    for (const [key, raw] of Object.entries(input)) {
        const rule = SETTING_RULES[key];
        if (!rule) fail(`Unknown setting: ${key}`);
        const value = Number(raw);
        if (!Number.isFinite(value)) fail(`${key} must be a number`);
        if (rule.integer && !Number.isInteger(value)) fail(`${key} must be a whole number`);
        if (value < rule.min || value > rule.max) fail(`${key} must be between ${rule.min} and ${rule.max}`);
        clean[key] = value;
    }

    const merged = { ...readSettings(), ...clean };
    if (merged.bpm_min >= merged.bpm_max) fail('Min BPM must be lower than Max BPM');
    return clean;
}

router.use(authenticate);

// Read-only calibration values are needed by the Live Session, including trainee self-practice.
router.get('/', practiceAccess, (req, res) => {
    res.json({ settings: readSettings() });
});

router.put('/', adminOnly, (req, res) => {
    const clean = validateSettings(req.body?.settings);
    const upsert = prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    transaction(() => {
        for (const [key, value] of Object.entries(clean)) upsert.run(key, String(value));
    });
    res.json({ settings: readSettings() });
});

router.put('/:key', adminOnly, (req, res) => {
    const clean = validateSettings({ [req.params.key]: req.body?.value });
    const [[key, value]] = Object.entries(clean);
    prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    res.json({ key, value });
});

/**
 * POST /api/settings/backup (admin only)
 * Writes a consistent copy to database/backups/.
 */
const backupDir = () => path.join(path.dirname(resolveDbPath()), 'backups');
const stampNow = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// Only plain names of .db files directly inside backups/ can be listed or downloaded.
const BACKUP_NAME = /^[A-Za-z0-9._-]+\.db$/;

router.post('/backup', adminOnly, handle(async (req, res) => {
    const backupPath = path.join(backupDir(), `life_backup_${stampNow()}.db`);
    try {
        await backupDatabase(backupPath);
        res.json({ message: 'Backup created successfully', path: backupPath });
    } catch (err) {
        console.error('Backup error:', err);
        res.status(500).json({ error: 'Backup failed' });
    }
}));

/**
 * GET /api/settings/backup/download (admin only)
 * A consistent copy of the whole database as a .db file, made now. It can be opened with
 * DB Browser for SQLite or restored with "npm run restore -- <file> --yes".
 */
router.get('/backup/download', adminOnly, handle(async (req, res) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-backup-'));
    const tempFile = path.join(tempDir, 'life.db');
    try {
        await backupDatabase(tempFile);
        res.setHeader('Content-Type', 'application/vnd.sqlite3');
        res.setHeader('Content-Disposition', attachmentHeader(`life_backup_${stampNow()}.db`));
        res.setHeader('Cache-Control', 'no-store');
        await new Promise((resolve, reject) => {
            res.sendFile(tempFile, err => (err ? reject(err) : resolve()));
        });
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}));

/**
 * GET /api/settings/backups (admin only) -> { backups: [{ name, bytes, modified_at, kind }] }
 * Backups kept on the server (manual, daily automatic and pre-upgrade copies), newest first.
 */
router.get('/backups', adminOnly, (req, res) => {
    const dir = backupDir();
    const kindOf = name => (name.startsWith('auto_') ? 'automatic'
        : name.startsWith('life_backup_') ? 'manual'
            : 'safety copy');
    const backups = fs.existsSync(dir)
        ? fs.readdirSync(dir)
            .filter(name => BACKUP_NAME.test(name))
            .map(name => {
                const stat = fs.statSync(path.join(dir, name));
                return { name, bytes: stat.size, modified_at: stat.mtime.toISOString(), kind: kindOf(name) };
            })
            .sort((a, b) => b.modified_at.localeCompare(a.modified_at))
        : [];
    res.json({ backups, directory: dir });
});

/**
 * GET /api/settings/backups/:name (admin only) -> the backup file as a download.
 */
router.get('/backups/:name', adminOnly, (req, res) => {
    const { name } = req.params;
    const file = path.join(backupDir(), name);
    if (!BACKUP_NAME.test(name) || !fs.existsSync(file)) {
        return res.status(404).json({ error: 'Backup not found' });
    }
    res.setHeader('Content-Type', 'application/vnd.sqlite3');
    res.setHeader('Content-Disposition', attachmentHeader(name));
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(file);
});

export default router;
