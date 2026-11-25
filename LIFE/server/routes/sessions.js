/**
 * L.I.F.E. Session Routes
 * Completed-session logging (idempotent via client_session_id) and history.
 */

import express from 'express';
import { prepare, transaction } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { trainerOrAdmin, adminOnly, practiceAccess } from '../middleware/roles.js';
import {
    optionalNumber,
    requiredId,
    applyDateRange,
    paginationParams,
    fail,
} from '../lib/validate.js';

const router = express.Router();

const MAX_DETAILS = 2000;
const PROCEDURE_STEP_KEYS = new Set([
    'scene_safe',
    'response_checked',
    'emergency_services_called',
    'breathing_checked',
    'cpr_started',
    'cpr_continued',
    'aed_used',
]);

function safeJson(text) {
    try {
        return JSON.parse(text || '{}');
    } catch {
        return {};
    }
}

export function parseSessionRow(session) {
    return {
        ...session,
        counts: safeJson(session.counts),
        procedure_steps: safeJson(session.procedure_steps),
    };
}

function validateCounts(counts) {
    if (counts === undefined || counts === null) return {};
    if (typeof counts !== 'object' || Array.isArray(counts)) fail('counts must be an object');
    const clean = {};
    for (const [key, value] of Object.entries(counts)) {
        if (!/^[a-z_]{1,40}$/.test(key)) fail('counts has an invalid key');
        clean[key] = optionalNumber(value, `counts.${key}`, { min: 0, max: 100000, fallback: 0 });
    }
    return clean;
}

function validateProcedureSteps(steps) {
    if (steps === undefined || steps === null) return {};
    if (typeof steps !== 'object' || Array.isArray(steps)) fail('Invalid procedure checklist');
    const clean = {};
    for (const [key, value] of Object.entries(steps)) {
        if (!PROCEDURE_STEP_KEYS.has(key) || typeof value !== 'boolean') fail('Invalid procedure checklist');
        clean[key] = value;
    }
    return clean;
}

function validateDetails(details) {
    if (details === undefined || details === null) return [];
    if (!Array.isArray(details)) fail('details must be a list');
    if (details.length > MAX_DETAILS) fail(`details may contain at most ${MAX_DETAILS} entries`);
    return details.map((detail, index) => {
        if (!detail || typeof detail !== 'object') fail(`details[${index}] is invalid`);
        const ts = Number(detail.ts);
        if (!Number.isFinite(ts) || ts < 0) fail(`details[${index}].ts must be a timestamp`);
        const bpm = detail.bpm === null || detail.bpm === undefined
            ? null
            : optionalNumber(detail.bpm, `details[${index}].bpm`, { min: 0, max: 400 });
        const angle = detail.elbow_angle === null || detail.elbow_angle === undefined
            ? null
            : optionalNumber(detail.elbow_angle, `details[${index}].elbow_angle`, { min: 0, max: 180 });
        return { ts: Math.round(ts), bpm, angle, locked: detail.elbow_locked ? 1 : 0 };
    });
}

router.use(authenticate);

/**
 * POST /api/sessions
 * Creates a completed session. Re-sending the same client_session_id returns the stored
 * session (200) instead of creating a duplicate, so offline retries are safe.
 */
router.post('/', practiceAccess, (req, res) => {
    const body = req.body || {};
    const traineeId = requiredId(body.trainee_id, 'Trainee ID');
    // Trainee accounts may only record their own self-practice sessions.
    const selfPractice = req.user.role === 'trainee';
    if (selfPractice && traineeId !== req.user.traineeId) {
        return res.status(403).json({ error: 'You can only save your own practice sessions' });
    }

    const clientSessionId = body.client_session_id;
    if (clientSessionId !== undefined &&
        (typeof clientSessionId !== 'string' || clientSessionId.length < 1 || clientSessionId.length > 128)) {
        return res.status(400).json({ error: 'Invalid client session ID' });
    }

    if (clientSessionId) {
        const existing = prepare('SELECT * FROM sessions WHERE client_session_id = ?').get(clientSessionId);
        if (existing) {
            if (selfPractice && existing.trainee_id !== req.user.traineeId) {
                return res.status(409).json({ error: 'Session ID already used' });
            }
            return res.status(200).json({ session: parseSessionRow(existing), duplicate: true });
        }
    }

    const durationSec = optionalNumber(body.duration_sec, 'duration_sec', { min: 0, max: 3600, integer: true });
    const totalCompressions = optionalNumber(body.total_compressions, 'total_compressions', { min: 0, max: 5000, integer: true });
    const avgBpm = optionalNumber(body.avg_bpm, 'avg_bpm', { min: 0, max: 400 });
    const elbowLockPct = optionalNumber(body.elbow_lock_pct, 'elbow_lock_pct', { min: 0, max: 100 });
    const accuracyPct = optionalNumber(body.accuracy_pct, 'accuracy_pct', { min: 0, max: 100 });
    const counts = validateCounts(body.counts);
    // Set by the server (not trusted from the client) so trainers can tell self-practice apart.
    if (selfPractice) counts.self_practice = 1;
    else delete counts.self_practice;
    const procedureSteps = validateProcedureSteps(body.procedure_steps);
    const details = validateDetails(body.details);

    // Inactive trainees are accepted so sessions recorded before a deactivation (e.g. queued
    // offline) are not lost; the Live page only offers active trainees.
    const trainee = prepare('SELECT * FROM trainees WHERE trainee_id = ?').get(traineeId);
    if (!trainee) {
        return res.status(404).json({ error: 'Trainee not found' });
    }
    if (!trainee.consent_given) {
        return res.status(409).json({
            error: selfPractice
                ? 'Your consent has not been recorded yet. Ask your trainer to record it before practising.'
                : 'This trainee has not given consent. Record consent on the Trainees page before saving sessions.',
            code: 'CONSENT_REQUIRED',
        });
    }

    const passMark = Number(prepare("SELECT value FROM settings WHERE key = 'pass_mark_pct'").get()?.value ?? 80);
    const result = accuracyPct >= passMark ? 'Pass' : 'Needs Improvement';

    const insertSession = prepare(`
        INSERT INTO sessions (client_session_id, trainee_id, duration_sec, total_compressions, avg_bpm,
                              elbow_lock_pct, accuracy_pct, counts, procedure_steps, result)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertDetail = prepare(`
        INSERT INTO session_details (session_id, ts, bpm, elbow_angle, elbow_locked)
        VALUES (?, ?, ?, ?, ?)
    `);

    const sessionId = transaction(() => {
        const { lastInsertRowid } = insertSession.run(
            clientSessionId || null,
            traineeId,
            durationSec,
            totalCompressions,
            avgBpm,
            elbowLockPct,
            accuracyPct,
            JSON.stringify(counts),
            JSON.stringify(procedureSteps),
            result
        );
        for (const detail of details) {
            insertDetail.run(lastInsertRowid, detail.ts, detail.bpm, detail.angle, detail.locked);
        }
        prepare("UPDATE live_status SET status = 'Completed', updated_at = datetime('now') WHERE id = 1").run();
        return lastInsertRowid;
    });

    const session = prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
    res.status(201).json({ session: parseSessionRow(session) });
});

/**
 * GET /api/sessions?trainee_id=&start_date=&end_date=&limit=&offset=
 */
router.get('/', trainerOrAdmin, (req, res) => {
    const { trainee_id, start_date, end_date } = req.query;
    const { limit, offset } = paginationParams(req.query);

    let where = ' WHERE 1=1';
    const params = [];

    if (trainee_id) {
        where += ' AND s.trainee_id = ?';
        params.push(requiredId(trainee_id, 'trainee_id'));
    }
    where = applyDateRange(where, params, 's.date_time', start_date, end_date);

    const total = prepare(`SELECT COUNT(*) AS count FROM sessions s${where}`).get(...params).count;
    const sessions = prepare(`
        SELECT s.*, t.full_name AS trainee_name, t.organization
        FROM sessions s
        JOIN trainees t ON s.trainee_id = t.trainee_id
        ${where}
        ORDER BY s.date_time DESC, s.session_id DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ sessions: sessions.map(parseSessionRow), total });
});

router.get('/:id', trainerOrAdmin, (req, res) => {
    const sessionId = requiredId(req.params.id, 'Session ID');
    const session = prepare(`
        SELECT s.*, t.full_name AS trainee_name, t.organization
        FROM sessions s
        JOIN trainees t ON s.trainee_id = t.trainee_id
        WHERE s.session_id = ?
    `).get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    const details = prepare('SELECT * FROM session_details WHERE session_id = ? ORDER BY ts').all(sessionId)
        .map(detail => ({ ...detail, elbow_locked: Boolean(detail.elbow_locked) }));

    res.json({ session: parseSessionRow(session), details });
});

/**
 * DELETE /api/sessions/:id (admin only); details cascade.
 */
router.delete('/:id', adminOnly, (req, res) => {
    const sessionId = requiredId(req.params.id, 'Session ID');
    const { changes } = prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
    if (!changes) {
        return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ message: 'Session deleted' });
});

export default router;
