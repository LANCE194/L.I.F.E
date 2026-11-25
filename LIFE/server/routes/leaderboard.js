/**
 * L.I.F.E. Leaderboard Routes
 * Top performers and rankings
 */

import express from 'express';
import { prepare } from '../db.js';
import { SUPERVISED_SESSION } from '../lib/sessionFilters.js';
import { applyDateRange, optionalNumber } from '../lib/validate.js';
import { authenticate } from '../middleware/auth.js';
import { trainerOrAdmin } from '../middleware/roles.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/leaderboard
 * Get leaderboard with filters
 */
router.get('/', trainerOrAdmin, (req, res) => {
    const { limit, start_date, end_date, organization, hide_names } = req.query;

    let query = `
        SELECT
            t.trainee_id,
            t.full_name,
            t.organization,
            COUNT(s.session_id) as total_sessions,
            AVG(s.accuracy_pct) as avg_accuracy,
            MAX(s.accuracy_pct) as best_accuracy,
            AVG(s.avg_bpm) as avg_bpm,
            MAX(s.date_time) as last_session
        FROM trainees t
        JOIN sessions s ON t.trainee_id = s.trainee_id
        WHERE t.is_active = 1 AND ${SUPERVISED_SESSION}
    `;
    const params = [];

    query = applyDateRange(query, params, 's.date_time', start_date, end_date);

    if (organization) {
        query += ' AND t.organization = ?';
        params.push(String(organization));
    }

    query += ' GROUP BY t.trainee_id, t.full_name, t.organization';
    query += ' ORDER BY avg_accuracy DESC, best_accuracy DESC, total_sessions DESC';
    query += ' LIMIT ?';
    params.push(optionalNumber(limit, 'limit', { min: 1, max: 500, integer: true, fallback: 100 }));

    const leaderboard = prepare(query).all(...params);

    // Add rank
    // Standard competition ranking: equal averages share a rank (1, 2, 2, 4).
    let previous = null;
    let previousRank = 0;
    const ranked = leaderboard.map((entry, index) => {
        const avg = Math.round(entry.avg_accuracy * 10) / 10;
        const rank = previous !== null && avg === previous ? previousRank : index + 1;
        previous = avg;
        previousRank = rank;
        return { ...entry, rank };
    }).map(entry => ({
        ...entry,
        avg_accuracy: Math.round(entry.avg_accuracy * 10) / 10,
        best_accuracy: Math.round(entry.best_accuracy * 10) / 10,
        avg_bpm: Math.round(entry.avg_bpm * 10) / 10,
        full_name: hide_names === 'true' ? `Trainee ${entry.trainee_id}` : entry.full_name
    }));

    // Get top 3 for highlights
    const top3 = ranked.slice(0, 3);

    res.json({ leaderboard: ranked, top3 });
});

/**
 * GET /api/leaderboard/organizations
 * Get organizations with session counts
 */
router.get('/organizations', trainerOrAdmin, (req, res) => {
    const orgs = prepare(`
        SELECT
            t.organization,
            COUNT(DISTINCT t.trainee_id) as trainee_count,
            COUNT(s.session_id) as session_count,
            AVG(s.accuracy_pct) as avg_accuracy
        FROM trainees t
        LEFT JOIN sessions s ON t.trainee_id = s.trainee_id AND ${SUPERVISED_SESSION}
        WHERE t.is_active = 1 AND t.organization IS NOT NULL AND t.organization != ''
        GROUP BY t.organization
        ORDER BY session_count DESC
    `).all();

    res.json({ organizations: orgs });
});

export default router;