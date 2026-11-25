/**
 * L.I.F.E. Settings Routes
 * Calibration/configuration (validated whitelist) and database backup.
 */

import express from 'express';
import path from 'path';
import { prepare, transaction, backupDatabase, DATABASE_DIR } from '../db.js';
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
router.post('/backup', adminOnly, handle(async (req, res) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(DATABASE_DIR, 'backups', `life_backup_${timestamp}.db`);
    try {
        await backupDatabase(backupPath);
        res.json({ message: 'Backup created successfully', path: backupPath });
    } catch (err) {
        console.error('Backup error:', err);
        res.status(500).json({ error: 'Backup failed' });
    }
}));

export default router;
