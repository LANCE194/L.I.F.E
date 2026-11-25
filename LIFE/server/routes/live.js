/**
 * L.I.F.E. Live Status Routes
 * Real-time session metrics
 */

import express from 'express';
import { prepare } from '../db.js';
import { optionalNumber, requiredId } from '../lib/validate.js';

const LIVE_STATUSES = new Set(['Waiting', 'Ready', 'In Progress', 'Completed']);
import { authenticate } from '../middleware/auth.js';
import { trainerOrAdmin, practiceAccess } from '../middleware/roles.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/live
 * Update live status from browser client (called every ~2 seconds during session)
 */
router.post('/', practiceAccess, (req, res) => {
    const {
        trainee_id,
        status,
        accuracy_pct,
        bpm,
        elbow_lock_pct,
        compressions,
        elapsed_sec
    } = req.body || {};

    if (status !== undefined && !LIVE_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    // Trainee accounts may only report their own practice session.
    if (req.user.role === 'trainee' && Number(trainee_id) !== req.user.traineeId) {
        return res.status(403).json({ error: 'You can only report your own practice session' });
    }

    // Verify trainee if provided
    if (trainee_id) {
        const trainee = prepare('SELECT * FROM trainees WHERE trainee_id = ? AND is_active = 1').get(requiredId(trainee_id, 'trainee_id'));
        if (!trainee) {
            return res.status(404).json({ error: 'Trainee not found or inactive' });
        }
    }

    prepare(`
        UPDATE live_status SET
            trainee_id = ?,
            status = ?,
            accuracy_pct = ?,
            bpm = ?,
            elbow_lock_pct = ?,
            compressions = ?,
            elapsed_sec = ?,
            updated_at = datetime('now')
        WHERE id = 1
    `).run(
        trainee_id ? Number(trainee_id) : null,
        status || 'In Progress',
        optionalNumber(accuracy_pct, 'accuracy_pct', { min: 0, max: 100 }),
        optionalNumber(bpm, 'bpm', { min: 0, max: 400 }),
        optionalNumber(elbow_lock_pct, 'elbow_lock_pct', { min: 0, max: 100 }),
        optionalNumber(compressions, 'compressions', { min: 0, max: 5000, integer: true }),
        optionalNumber(elapsed_sec, 'elapsed_sec', { min: 0, max: 3600, integer: true })
    );

    res.json({ success: true });
});

/**
 * GET /api/live
 * Get current live status
 */
router.get('/', trainerOrAdmin, (req, res) => {
    const live = prepare(`
        SELECT ls.*, t.full_name as trainee_name
        FROM live_status ls
        LEFT JOIN trainees t ON ls.trainee_id = t.trainee_id
        WHERE ls.id = 1
    `).get();

    res.json({ live });
});

/**
 * POST /api/live/reset
 * Reset live status to waiting
 */
router.post('/reset', practiceAccess, (req, res) => {
    // A trainee may clear the live status only when it shows their own session.
    if (req.user.role === 'trainee') {
        const current = prepare('SELECT trainee_id FROM live_status WHERE id = 1').get();
        if (current?.trainee_id && current.trainee_id !== req.user.traineeId) {
            return res.json({ success: true, unchanged: true });
        }
    }
    prepare(`
        UPDATE live_status SET
            trainee_id = NULL,
            status = 'Waiting',
            accuracy_pct = 0,
            bpm = 0,
            elbow_lock_pct = 0,
            compressions = 0,
            elapsed_sec = 0,
            updated_at = datetime('now')
        WHERE id = 1
    `).run();

    res.json({ success: true });
});

export default router;