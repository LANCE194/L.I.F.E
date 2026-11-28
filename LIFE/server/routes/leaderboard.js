/**
 * L.I.F.E. Leaderboard Routes
 * Rankings by average accuracy. Every recorded session counts by default, including trainee
 * self-practice from the Practice page; ?scope=supervised|self narrows it.
 *
 * Staff see full names (or "Trainee N" with hide_names=true). Trainee accounts see the same
 * ranking with their own row marked (is_me) and other trainees shown as "First L." only.
 */

import express from 'express';
import { prepare } from '../db.js';
import { parseScope, scopeCondition, SELF_PRACTICE_COUNT } from '../lib/sessionFilters.js';
import { applyDateRange, optionalNumber } from '../lib/validate.js';
import { authenticate } from '../middleware/auth.js';
import { practiceAccess } from '../middleware/roles.js';

const router = express.Router();

router.use(authenticate);

const round1 = value => Math.round((value || 0) * 10) / 10;

/** "María Dela Cruz" -> "María D." (what trainees see of other trainees). */
export function shortName(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'Trainee';
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/**
 * Standard competition ranking over the full result (equal averages share a rank: 1, 2, 2, 4).
 * Exported for the dashboard top 5 and the trainee's own rank.
 */
export function rankedLeaderboard({ scope = 'all', startDate, endDate, organization } = {}) {
    let query = `
        SELECT
            t.trainee_id,
            t.full_name,
            t.organization,
            COUNT(s.session_id) AS total_sessions,
            ${SELF_PRACTICE_COUNT} AS self_practice_sessions,
            SUM(CASE WHEN s.result = 'Pass' THEN 1 ELSE 0 END) AS passed_sessions,
            AVG(s.accuracy_pct) AS avg_accuracy,
            MAX(s.accuracy_pct) AS best_accuracy,
            AVG(s.avg_bpm) AS avg_bpm,
            SUM(s.total_compressions) AS total_compressions,
            MAX(s.date_time) AS last_session
        FROM trainees t
        JOIN sessions s ON t.trainee_id = s.trainee_id
        WHERE t.is_active = 1 AND ${scopeCondition(scope)}
    `;
    const params = [];
    query = applyDateRange(query, params, 's.date_time', startDate, endDate);
    if (organization) {
        query += ' AND t.organization = ?';
        params.push(String(organization));
    }
    query += ' GROUP BY t.trainee_id, t.full_name, t.organization';
    query += ' ORDER BY avg_accuracy DESC, best_accuracy DESC, total_sessions DESC, t.trainee_id';

    let previous = null;
    let previousRank = 0;
    return prepare(query).all(...params).map((entry, index) => {
        const avg = round1(entry.avg_accuracy);
        const rank = previous !== null && avg === previous ? previousRank : index + 1;
        previous = avg;
        previousRank = rank;
        return {
            ...entry,
            rank,
            avg_accuracy: avg,
            best_accuracy: round1(entry.best_accuracy),
            avg_bpm: round1(entry.avg_bpm),
            total_compressions: entry.total_compressions || 0,
            pass_rate: entry.total_sessions ? Math.round((entry.passed_sessions / entry.total_sessions) * 100) : 0,
        };
    });
}

/**
 * GET /api/leaderboard?scope=&start_date=&end_date=&organization=&limit=&hide_names=
 * -> { leaderboard, top3, total_ranked, scope, me }
 */
router.get('/', practiceAccess, (req, res) => {
    const { limit, start_date, end_date, organization, hide_names } = req.query;
    const scope = parseScope(req.query.scope);
    const max = optionalNumber(limit, 'limit', { min: 1, max: 500, integer: true, fallback: 100 });
    const viewerTraineeId = req.user.role === 'trainee' ? req.user.traineeId : null;
    const hideNames = hide_names === 'true';

    const full = rankedLeaderboard({ scope, startDate: start_date, endDate: end_date, organization });
    const present = entry => {
        const isMe = viewerTraineeId !== null && entry.trainee_id === viewerTraineeId;
        let name = entry.full_name;
        if (viewerTraineeId !== null && !isMe) name = shortName(entry.full_name);
        else if (hideNames && !isMe) name = `Trainee ${entry.trainee_id}`;
        return { ...entry, full_name: name, is_me: isMe };
    };

    const leaderboard = full.slice(0, max).map(present);
    const mine = viewerTraineeId !== null ? full.find(entry => entry.trainee_id === viewerTraineeId) : null;

    res.json({
        leaderboard,
        top3: leaderboard.slice(0, 3),
        total_ranked: full.length,
        scope,
        me: mine ? present(mine) : null,
    });
});

/**
 * GET /api/leaderboard/organizations?scope=
 * Organizations with session counts
 */
router.get('/organizations', practiceAccess, (req, res) => {
    const scope = parseScope(req.query.scope);
    const orgs = prepare(`
        SELECT
            t.organization,
            COUNT(DISTINCT t.trainee_id) as trainee_count,
            COUNT(s.session_id) as session_count,
            AVG(s.accuracy_pct) as avg_accuracy
        FROM trainees t
        LEFT JOIN sessions s ON t.trainee_id = s.trainee_id AND ${scopeCondition(scope)}
        WHERE t.is_active = 1 AND t.organization IS NOT NULL AND t.organization != ''
        GROUP BY t.organization
        ORDER BY session_count DESC
    `).all();

    res.json({ organizations: orgs });
});

export default router;
