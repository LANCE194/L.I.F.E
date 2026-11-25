/**
 * L.I.F.E. Trainee self-service routes (trainee accounts only).
 * A trainee can read only their own profile, statistics and sessions.
 */

import express from 'express';
import { prepare } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { traineeOnly } from '../middleware/roles.js';
import { computeTraineeStats } from './stats.js';
import { parseSessionRow } from './sessions.js';

const router = express.Router();

router.use(authenticate);
router.use(traineeOnly);

/**
 * GET /api/me/progress -> { trainee, stats, progress, sessions, pass_mark_pct }
 */
router.get('/progress', (req, res) => {
    const result = req.user.traineeId ? computeTraineeStats(req.user.traineeId) : null;
    if (!result) return res.status(404).json({ error: 'No trainee profile is linked to this account' });

    const { trainee, stats, progress } = result;
    const sessions = prepare(`
        SELECT session_id, date_time, duration_sec, total_compressions, avg_bpm, elbow_lock_pct, accuracy_pct, counts, procedure_steps, result
        FROM sessions WHERE trainee_id = ? ORDER BY date_time DESC, session_id DESC LIMIT 100
    `).all(req.user.traineeId).map(parseSessionRow);
    const passMark = Number(prepare("SELECT value FROM settings WHERE key = 'pass_mark_pct'").get()?.value ?? 80);

    res.json({
        // Only what a trainee should see about themselves (no trainer notes).
        trainee: {
            trainee_id: trainee.trainee_id,
            full_name: trainee.full_name,
            organization: trainee.organization,
            date_registered: trainee.date_registered,
            consent_given: Boolean(trainee.consent_given),
            is_active: Boolean(trainee.is_active),
        },
        stats,
        progress,
        sessions,
        pass_mark_pct: passMark,
    });
});

export default router;
