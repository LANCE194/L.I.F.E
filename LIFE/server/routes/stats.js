/**
 * L.I.F.E. Statistics Routes
 * Dashboard statistics and trends
 */

import express from 'express';
import { prepare } from '../db.js';
import { parseScope, scopeCondition, SELF_PRACTICE_COUNT } from '../lib/sessionFilters.js';
import { rankedLeaderboard } from './leaderboard.js';
import { parseSessionRow } from './sessions.js';
import { requiredId, timezoneModifier } from '../lib/validate.js';
import { authenticate } from '../middleware/auth.js';
import { trainerOrAdmin } from '../middleware/roles.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/stats/dashboard?tz_offset_min=&scope=all|supervised|self
 * Dashboard summary. Statistics count every recorded session by default (trainer-supervised and
 * trainee self-practice); ?scope=supervised gives the trainer-supervised (Chapter 4) figures.
 * The recent-sessions feed always lists all activity, with self-practice flagged in counts.
 */
router.get('/dashboard', trainerOrAdmin, (req, res) => {
    // Day boundaries follow the client's local time zone (?tz_offset_min=getTimezoneOffset()).
    const tz = timezoneModifier(req.query);
    const scope = parseScope(req.query.scope);
    const inScope = scopeCondition(scope);

    const traineeCount = prepare('SELECT COUNT(*) as count FROM trainees WHERE is_active = 1').get().count;

    const sessionsToday = prepare(`
        SELECT COUNT(*) as count FROM sessions s
        WHERE date(s.date_time, ?) = date('now', ?) AND ${inScope}
    `).get(tz, tz).count;

    const totals = prepare(`
        SELECT
            COUNT(*) AS total_sessions,
            ${SELF_PRACTICE_COUNT} AS self_practice_sessions,
            SUM(CASE WHEN s.result = 'Pass' THEN 1 ELSE 0 END) AS passed,
            AVG(s.accuracy_pct) AS avg_accuracy,
            AVG(s.avg_bpm) AS avg_bpm,
            SUM(s.total_compressions) AS total_compressions
        FROM sessions s WHERE ${inScope}
    `).get();

    const top5 = rankedLeaderboard({ scope }).slice(0, 5).map(entry => ({
        trainee_id: entry.trainee_id,
        full_name: entry.full_name,
        organization: entry.organization,
        avg_accuracy: entry.avg_accuracy,
        best_accuracy: entry.best_accuracy,
        session_count: entry.total_sessions,
        self_practice_sessions: entry.self_practice_sessions,
        rank: entry.rank,
    }));

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
        WHERE date(s.date_time, ?) >= date('now', ?, '-30 days') AND ${inScope}
        GROUP BY date(s.date_time, ?)
        ORDER BY date(s.date_time, ?)
    `).all(tz, tz, tz, tz, tz);

    const totalSessions = totals.total_sessions || 0;
    res.json({
        scope,
        stats: {
            trainee_count: traineeCount,
            sessions_today: sessionsToday,
            avg_accuracy: Math.round((totals.avg_accuracy || 0) * 10) / 10,
            avg_bpm: Math.round((totals.avg_bpm || 0) * 10) / 10,
            total_sessions: totalSessions,
            self_practice_sessions: totals.self_practice_sessions || 0,
            total_compressions: totals.total_compressions || 0,
            pass_rate: totalSessions ? Math.round(((totals.passed || 0) / totalSessions) * 100) : 0,
        },
        top5,
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