/**
 * L.I.F.E. Trainee self-service routes (trainee accounts only).
 * A trainee can read and download only their own profile, statistics, ranking and sessions.
 */

import express from 'express';
import { prepare } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { traineeOnly } from '../middleware/roles.js';
import { computeTraineeStats } from './stats.js';
import { parseSessionRow } from './sessions.js';
import { rankedLeaderboard } from './leaderboard.js';
import { sendCsv, sendCertificatePdf } from './export.js';
import { attachmentHeader } from '../lib/escape.js';
import { requiredId } from '../lib/validate.js';
import {
    COLORS, startReport, summaryRow, table, heading, finishReport, tzOffsetFrom, formatDate, formatDateTime, fixed1, duration,
} from '../lib/pdfReport.js';
import { missedItems } from '../lib/procedure.js';

const router = express.Router();

router.use(authenticate);
router.use(traineeOnly);

const fileDate = () => new Date().toISOString().slice(0, 10);
const passMarkPct = () => Number(prepare("SELECT value FROM settings WHERE key = 'pass_mark_pct'").get()?.value ?? 80);

/** Only what a trainee should see about themselves (no trainer notes). */
function publicProfile(trainee) {
    return {
        trainee_id: trainee.trainee_id,
        full_name: trainee.full_name,
        organization: trainee.organization,
        date_registered: trainee.date_registered,
        consent_given: Boolean(trainee.consent_given),
        is_active: Boolean(trainee.is_active),
    };
}

function ownSessions(traineeId, limit = 100) {
    return prepare(`
        SELECT session_id, date_time, duration_sec, total_compressions, avg_bpm, elbow_lock_pct, accuracy_pct, counts, procedure_steps, result
        FROM sessions WHERE trainee_id = ? ORDER BY date_time DESC, session_id DESC LIMIT ?
    `).all(traineeId, limit).map(parseSessionRow);
}

/** The trainee's place on the overall leaderboard (all sessions), or null if not ranked yet. */
function ownRank(traineeId) {
    const full = rankedLeaderboard({ scope: 'all' });
    const entry = full.find(row => row.trainee_id === traineeId);
    return entry ? { rank: entry.rank, total_ranked: full.length, avg_accuracy: entry.avg_accuracy } : null;
}

function loadOwn(req, res) {
    const result = req.user.traineeId ? computeTraineeStats(req.user.traineeId) : null;
    if (!result) {
        res.status(404).json({ error: 'No trainee profile is linked to this account' });
        return null;
    }
    return result;
}

/**
 * GET /api/me/progress -> { trainee, stats, progress, sessions, pass_mark_pct, ranking }
 */
router.get('/progress', (req, res) => {
    const result = loadOwn(req, res);
    if (!result) return;
    const { trainee, stats, progress } = result;
    res.json({
        trainee: publicProfile(trainee),
        stats,
        progress,
        sessions: ownSessions(req.user.traineeId),
        pass_mark_pct: passMarkPct(),
        ranking: ownRank(req.user.traineeId),
    });
});

/**
 * GET /api/me/export?format=json|csv|pdf
 * The trainee's own data: json = full personal backup (profile, statistics, every session with
 * its compression-by-compression record); csv = one row per session; pdf = progress report.
 */
router.get('/export', (req, res) => {
    const result = loadOwn(req, res);
    if (!result) return;
    const { trainee, stats } = result;
    const format = String(req.query.format || 'json').toLowerCase();
    const slug = trainee.full_name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'trainee';
    const sessions = ownSessions(req.user.traineeId, 5000);
    const passMark = passMarkPct();

    if (format === 'csv') {
        const columns = {
            session_id: 'Session ID', date_time: 'Date/Time', session_type: 'Session Type', duration_sec: 'Duration (sec)',
            total_compressions: 'Total Compressions', correct: 'Correct', incorrect: 'Incorrect', avg_bpm: 'Avg BPM',
            elbow_lock_pct: 'Elbow Lock %', accuracy_pct: 'Accuracy %', procedure_pct: 'Procedure %', result: 'Result', missed_items: 'Missed Items',
        };
        return sendCsv(res, `life_my_sessions_${slug}_${fileDate()}.csv`, columns, sessions.map(session => ({
            session_id: session.session_id,
            date_time: session.date_time,
            session_type: session.counts.self_practice === 1 ? 'Self-practice' : 'Supervised',
            duration_sec: session.duration_sec,
            total_compressions: session.total_compressions,
            correct: session.counts.correct ?? '',
            incorrect: session.counts.incorrect ?? '',
            avg_bpm: session.avg_bpm,
            elbow_lock_pct: session.elbow_lock_pct,
            accuracy_pct: session.accuracy_pct,
            procedure_pct: session.counts.procedure_pct ?? '',
            result: session.result,
            missed_items: missedItems(session).join('; '),
        })));
    }

    if (format === 'pdf') {
        const tz = tzOffsetFrom(req.query);
        const ranking = ownRank(req.user.traineeId);
        const doc = startReport(res, {
            filename: `life_my_progress_${slug}_${fileDate()}.pdf`,
            title: 'My Progress Report',
            filters: [trainee.full_name, trainee.organization || 'No organization', `Trainee since ${formatDate(trainee.date_registered, tz)}`],
            tzOffsetMin: tz,
        });
        summaryRow(doc, [
            ['Sessions', String(stats.total_sessions)],
            ['Average accuracy', `${fixed1(stats.avg_accuracy)}%`],
            ['Best accuracy', `${fixed1(stats.best_accuracy)}%`],
            ['Passed', `${stats.pass_rate}% (pass mark ${passMark}%)`],
            ['Leaderboard', ranking ? `#${ranking.rank} of ${ranking.total_ranked}` : 'Not ranked yet'],
        ]);
        heading(doc, 'Sessions');
        table(doc, [
            { label: 'Date / time', width: 1.5, value: row => formatDateTime(row.date_time, tz) },
            { label: 'Type', width: 1, value: row => (row.counts.self_practice === 1 ? 'Self-practice' : 'Supervised') },
            { label: 'Duration', width: 0.7, align: 'right', value: row => duration(row.duration_sec) },
            { label: 'Compressions', width: 0.9, align: 'right', value: row => String(row.total_compressions ?? 0) },
            { label: 'Avg BPM', width: 0.7, align: 'right', value: row => fixed1(row.avg_bpm) },
            { label: 'Elbow lock', width: 0.8, align: 'right', value: row => `${fixed1(row.elbow_lock_pct)}%` },
            { label: 'Accuracy', width: 0.8, align: 'right', bold: true, value: row => `${fixed1(row.accuracy_pct)}%` },
            { label: 'Procedure', width: 0.8, align: 'right', value: row => (row.counts.procedure_pct === undefined ? '—' : `${Math.round(row.counts.procedure_pct)}%`) },
            { label: 'Result', width: 1.3, bold: true, value: row => row.result, color: row => (row.result === 'Pass' ? COLORS.green : COLORS.crimson) },
        ], sessions, { emptyText: 'No sessions recorded yet.' });
        return finishReport(doc);
    }

    if (format !== 'json') return res.status(400).json({ error: 'format must be json, csv or pdf' });

    const details = prepare('SELECT ts, bpm, elbow_angle, elbow_locked FROM session_details WHERE session_id = ? ORDER BY ts');
    const backup = {
        app: 'L.I.F.E. – Localized Intelligent First-aid Evaluator',
        kind: 'trainee-data-export',
        version: 1,
        exported_at: new Date().toISOString(),
        trainee: publicProfile(trainee),
        pass_mark_pct: passMark,
        stats,
        ranking: ownRank(req.user.traineeId),
        sessions: sessions.map(session => ({
            ...session,
            session_type: session.counts.self_practice === 1 ? 'self-practice' : 'supervised',
            details: details.all(session.session_id).map(detail => ({ ...detail, elbow_locked: Boolean(detail.elbow_locked) })),
        })),
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', attachmentHeader(`life_my_data_${slug}_${fileDate()}.json`));
    res.send(JSON.stringify(backup, null, 2));
});

/**
 * GET /api/me/certificate/:sessionId -> Certificate of Practice Completion (PDF) for an own session.
 */
router.get('/certificate/:sessionId', (req, res) => {
    const session = prepare(`
        SELECT s.*, t.full_name, t.organization
        FROM sessions s JOIN trainees t ON s.trainee_id = t.trainee_id
        WHERE s.session_id = ? AND s.trainee_id = ?
    `).get(requiredId(req.params.sessionId, 'Session ID'), req.user.traineeId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return sendCertificatePdf(req, res, session);
});

export default router;
