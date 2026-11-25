/**
 * L.I.F.E. Statistics Routes
 * Dashboard statistics and trends
 */

import express from 'express';
import { prepare } from '../db.js';
import { SUPERVISED_SESSION } from '../lib/sessionFilters.js';
import { parseSessionRow } from './sessions.js';
import { requiredId, timezoneModifier } from '../lib/validate.js';
import { authenticate } from '../middleware/auth.js';
import { trainerOrAdmin } from '../middleware/roles.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/stats/dashboard
 * Get dashboard summary statistics
 */
router.get('/dashboard', trainerOrAdmin, (req, res) => {
    // Day boundaries follow the client's local time zone (?tz_offset_min=getTimezoneOffset()).
    const tz = timezoneModifier(req.query);

    // Total active trainees
    const traineeCount = prepare('SELECT COUNT(*) as count FROM trainees WHERE is_active = 1').get().count;

    // Dashboard statistics use trainer-supervised sessions only (trainee self-practice is
    // excluded, as on the leaderboard). The recent-sessions feed below still shows all activity.

    // Sessions today
    const sessionsToday = prepare(`
        SELECT COUNT(*) as count FROM sessions s
        WHERE date(s.date_time, ?) = date('now', ?) AND ${SUPERVISED_SESSION}
    `).get(tz, tz).count;

    // Average accuracy (all time)
    const avgAccuracy = prepare(`
        SELECT AVG(s.accuracy_pct) as avg FROM sessions s WHERE ${SUPERVISED_SESSION}
    `).get().avg || 0;

    // Average BPM (all time)
    const avgBpm = prepare(`
        SELECT AVG(s.avg_bpm) as avg FROM sessions s WHERE ${SUPERVISED_SESSION}
    `).get().avg || 0;

    // Top 5 leaderboard
    const top5 = prepare(`
        SELECT
            t.trainee_id,
            t.full_name,
            t.organization,
            AVG(s.accuracy_pct) as avg_accuracy,
            MAX(s.accuracy_pct) as best_accuracy,
            COUNT(s.session_id) as session_count
        FROM trainees t
        JOIN sessions s ON t.trainee_id = s.trainee_id
        WHERE t.is_active = 1 AND ${SUPERVISED_SESSION}
        GROUP BY t.trainee_id
        ORDER BY avg_accuracy DESC
        LIMIT 5
    `).all();

    // Recent sessions (last 10, all activity; self-practice is flagged in counts)
    const recentSessions = prepare(`
        SELECT s.*, t.full_name as trainee_name, t.organization
        FROM sessions s
        JOIN trainees t ON s.trainee_id = t.trainee_id
        ORDER BY s.date_time DESC, s.session_id DESC
        LIMIT 10
    `).all();

    // Accuracy trend (last 30 local days, daily average)
    const accuracyTrend = prepare(`
        SELECT
            date(s.date_time, ?) as date,
            AVG(s.accuracy_pct) as avg_accuracy,
            COUNT(*) as session_count
        FROM sessions s
        WHERE date(s.date_time, ?) >= date('now', ?, '-30 days') AND ${SUPERVISED_SESSION}
        GROUP BY date(s.date_time, ?)
        ORDER BY date(s.date_time, ?)
    `).all(tz, tz, tz, tz, tz);

    res.json({
        stats: {
            trainee_count: traineeCount,
            sessions_today: sessionsToday,
            avg_accuracy: Math.round(avgAccuracy * 10) / 10,
            avg_bpm: Math.round(avgBpm * 10) / 10
        },
        top5: top5.map(t => ({
            ...t,
            avg_accuracy: Math.round(t.avg_accuracy * 10) / 10,
            best_accuracy: Math.round(t.best_accuracy * 10) / 10
        })),
        recent_sessions: recentSessions.map(parseSessionRow),
        accuracy_trend: accuracyTrend.map(t => ({
            ...t,
            avg_accuracy: Math.round(t.avg_accuracy * 10) / 10
        }))
    });
});

/**
 * GET /api/stats/trainee/:id
 * Get statistics for a specific trainee
 */
/**
 * Totals and per-session progress for one trainee (shared with GET /api/me/progress).
 * Returns null when the trainee does not exist.
 */
export function computeTraineeStats(traineeId) {
    const trainee = prepare('SELECT * FROM trainees WHERE trainee_id = ?').get(traineeId);
    if (!trainee) return null;

    const sessions = prepare('SELECT * FROM sessions WHERE trainee_id = ? ORDER BY date_time, session_id').all(traineeId);
    if (sessions.length === 0) {
        return {
            trainee,
            stats: { total_sessions: 0, total_compressions: 0, avg_accuracy: 0, best_accuracy: 0, avg_bpm: 0, avg_duration: 0, pass_rate: 0 },
            progress: [],
        };
    }

    const totalCompressions = sessions.reduce((sum, s) => sum + (s.total_compressions || 0), 0);
    const avgAccuracy = sessions.reduce((sum, s) => sum + (s.accuracy_pct || 0), 0) / sessions.length;
    const bestAccuracy = Math.max(...sessions.map(s => s.accuracy_pct || 0));
    const avgBpm = sessions.reduce((sum, s) => sum + (s.avg_bpm || 0), 0) / sessions.length;
    const avgDuration = sessions.reduce((sum, s) => sum + (s.duration_sec || 0), 0) / sessions.length;
    const passCount = sessions.filter(s => s.result === 'Pass').length;

    return {
        trainee,
        stats: {
            total_sessions: sessions.length,
            total_compressions: totalCompressions,
            avg_accuracy: Math.round(avgAccuracy * 10) / 10,
            best_accuracy: Math.round(bestAccuracy * 10) / 10,
            avg_bpm: Math.round(avgBpm * 10) / 10,
            avg_duration: Math.round(avgDuration),
            pass_rate: Math.round((passCount / sessions.length) * 100),
        },
        progress: sessions.map((s, i) => ({
            session_number: i + 1,
            date: s.date_time,
            accuracy: s.accuracy_pct,
            bpm: s.avg_bpm,
            compressions: s.total_compressions,
            result: s.result,
        })),
    };
}

router.get('/trainee/:id', trainerOrAdmin, (req, res) => {
    const result = computeTraineeStats(requiredId(req.params.id, 'Trainee ID'));
    if (!result) return res.status(404).json({ error: 'Trainee not found' });
    res.json(result);
});

export default router;