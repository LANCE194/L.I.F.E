/**
 * L.I.F.E. Export Routes
 * CSV export functionality
 */

import express from 'express';
import { stringify } from 'csv-stringify';
import { prepare } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { trainerOrAdmin, adminOnly } from '../middleware/roles.js';
import { escapeHtml, csvSafeRow, attachmentHeader } from '../lib/escape.js';
import { applyDateRange, requiredId } from '../lib/validate.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Project emblem, embedded as a data URI so certificates work offline, in the sandboxed preview
// and as a standalone downloaded file (whose CSP only allows data: images).
const LOGO_FILE = fileURLToPath(new URL('../../dashboard/public/brand/logo-256.png', import.meta.url));
let logoDataUri;
function certificateLogo() {
    if (logoDataUri === undefined) {
        try {
            logoDataUri = `data:image/png;base64,${readFileSync(LOGO_FILE).toString('base64')}`;
        } catch {
            logoDataUri = null; // emblem missing: the certificate still renders without it
        }
    }
    return logoDataUri;
}

function sendCsv(res, filename, columns, rows) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', attachmentHeader(filename));
    // UTF-8 BOM so Excel shows accented names (e.g. ñ) correctly.
    res.write('﻿');
    const stringifier = stringify({ header: true, columns });
    stringifier.pipe(res);
    for (const row of rows) stringifier.write(csvSafeRow(row));
    stringifier.end();
}

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/export/sessions
 * Export sessions as CSV
 */
router.get('/sessions', trainerOrAdmin, (req, res) => {
    const { trainee_id, start_date, end_date } = req.query;

    let query = `
        SELECT
            s.session_id,
            s.date_time,
            t.full_name as trainee_name,
            t.organization,
            s.duration_sec,
            s.total_compressions,
            s.avg_bpm,
            s.elbow_lock_pct,
            s.accuracy_pct,
            s.result
        FROM sessions s
        JOIN trainees t ON s.trainee_id = t.trainee_id
        WHERE 1=1
    `;
    const params = [];

    if (trainee_id) {
        query += ' AND s.trainee_id = ?';
        params.push(requiredId(trainee_id, 'trainee_id'));
    }

    query = applyDateRange(query, params, 's.date_time', start_date, end_date);

    query += ' ORDER BY s.date_time DESC';

    const sessions = prepare(query).all(...params);

    // Convert to CSV
    const columns = {
        session_id: 'Session ID',
        date_time: 'Date/Time',
        trainee_name: 'Trainee',
        organization: 'Organization',
        duration_sec: 'Duration (sec)',
        total_compressions: 'Total Compressions',
        avg_bpm: 'Avg BPM',
        elbow_lock_pct: 'Elbow Lock %',
        accuracy_pct: 'Accuracy %',
        result: 'Result'
    };

    sendCsv(res, 'life_sessions_export.csv', columns, sessions);
});

/**
 * GET /api/export/trainees
 * Export trainees as CSV
 */
router.get('/trainees', trainerOrAdmin, (req, res) => {
    const trainees = prepare(`
        SELECT
            trainee_id,
            full_name,
            organization,
            notes,
            consent_given,
            is_active,
            date_registered
        FROM trainees
        ORDER BY date_registered DESC
    `).all();

    const columns = {
        trainee_id: 'Trainee ID',
        full_name: 'Full Name',
        organization: 'Organization',
        notes: 'Notes',
        consent_given: 'Consent Given',
        is_active: 'Active',
        date_registered: 'Date Registered'
    };

    sendCsv(res, 'life_trainees_export.csv', columns, trainees.map(trainee => ({
        ...trainee,
        consent_given: trainee.consent_given ? 'Yes' : 'No',
        is_active: trainee.is_active ? 'Yes' : 'No'
    })));
});

/**
 * GET /api/export/test-data
 * Export detailed test data (session details) as CSV - Admin only
 */
router.get('/test-data', adminOnly, (req, res) => {
    const { session_id } = req.query;

    let query = `
        SELECT
            sd.detail_id,
            sd.session_id,
            s.date_time,
            t.full_name as trainee_name,
            sd.ts,
            sd.bpm,
            sd.elbow_angle,
            sd.elbow_locked
        FROM session_details sd
        JOIN sessions s ON sd.session_id = s.session_id
        JOIN trainees t ON s.trainee_id = t.trainee_id
        WHERE 1=1
    `;
    const params = [];

    if (session_id) {
        query += ' AND sd.session_id = ?';
        params.push(requiredId(session_id, 'session_id'));
    }

    query += ' ORDER BY sd.session_id, sd.ts';

    const details = prepare(query).all(...params);

    const columns = {
        detail_id: 'Detail ID',
        session_id: 'Session ID',
        date_time: 'Session Date/Time',
        trainee_name: 'Trainee',
        ts: 'Timestamp (ms)',
        bpm: 'BPM',
        elbow_angle: 'Elbow Angle',
        elbow_locked: 'Elbow Locked'
    };

    sendCsv(res, 'life_test_data_export.csv', columns, details.map(detail => ({
        ...detail,
        elbow_locked: detail.elbow_locked ? 'Yes' : 'No'
    })));
});

/**
 * GET /api/export/certificate/:sessionId
 * Generate Certificate of Practice Completion (HTML)
 */
router.get('/certificate/:sessionId', trainerOrAdmin, (req, res) => {
    const session = prepare(`
        SELECT s.*, t.full_name, t.organization
        FROM sessions s
        JOIN trainees t ON s.trainee_id = t.trainee_id
        WHERE s.session_id = ?
    `).get(requiredId(req.params.sessionId, 'Session ID'));

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    const date = escapeHtml(new Date(session.date_time).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }));
    const fixed = value => escapeHtml(Number(value || 0).toFixed(1));
    const name = escapeHtml(session.full_name);
    const organization = session.organization ? escapeHtml(session.organization) : '';
    const logo = certificateLogo();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Certificate of Practice Completion</title>
    <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: 'Georgia', serif; margin: 0; padding: 40px; background: #f5f6fa; color: #0f2240; }
        .certificate { max-width: 860px; margin: 0 auto; background: white; padding: 56px 64px; border: 6px solid #0a2e56; box-shadow: 0 0 20px rgba(2,22,64,0.12); position: relative; }
        .certificate::before { content: ''; position: absolute; top: 14px; left: 14px; right: 14px; bottom: 14px; border: 2px solid #e3b657; pointer-events: none; }
        .header { text-align: center; margin-bottom: 24px; }
        .emblem { width: 120px; height: 120px; display: block; margin: 0 auto 12px; }
        .logo { font-size: 28px; font-weight: bold; color: #0a2e56; margin-bottom: 6px; letter-spacing: 3px; }
        .logo span { color: #a81638; }
        .subtitle { font-size: 14px; color: #8a6420; text-transform: uppercase; letter-spacing: 2px; }
        .title { text-align: center; font-size: 34px; font-weight: bold; color: #a81638; margin: 24px 0; text-transform: uppercase; letter-spacing: 3px; }
        .title::after { content: ''; display: block; width: 120px; height: 3px; background: #e3b657; margin: 14px auto 0; }
        .recipient { text-align: center; font-size: 22px; color: #0f2240; margin: 12px 0; }
        .recipient-name { font-weight: bold; color: #0a2e56; border-bottom: 2px solid #e3b657; padding: 0 8px; }
        .details { margin-top: 36px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .detail { padding: 14px; background: #f5f6fa; border-left: 4px solid #0a2e56; border-radius: 4px; }
        .detail-label { font-size: 11px; text-transform: uppercase; color: #5b6880; letter-spacing: 1px; }
        .detail-value { font-size: 18px; font-weight: bold; color: #0a2e56; margin-top: 4px; }
        .footer { margin-top: 36px; text-align: center; }
        .disclaimer { font-size: 12px; color: #5b6880; margin-top: 16px; font-style: italic; }
        .signatures { display: flex; justify-content: space-between; margin-top: 56px; }
        .signature { text-align: center; width: 220px; }
        .signature-line { border-top: 1px solid #0f2240; padding-top: 5px; font-size: 14px; color: #0f2240; }
        @media print { body { background: white; padding: 0; } .certificate { box-shadow: none; } }
    </style>
</head>
<body>
    <div class="certificate">
        <div class="header">
            ${logo ? `<img class="emblem" src="${logo}" alt="Project L.I.F.E. emblem">` : ''}
            <div class="logo">PROJECT L.I.F.E<span>.</span></div>
            <div class="subtitle">Localized Intelligent First-aid Evaluator</div>
        </div>
        <div class="title">Certificate of Practice Completion</div>
        <div class="recipient">This certifies that <span class="recipient-name">${name}</span></div>
        <div class="recipient">has completed a CPR practice session</div>
        <div class="recipient">on <strong>${date}</strong></div>

        <div class="details">
            <div class="detail">
                <div class="detail-label">Session Duration</div>
                <div class="detail-value">${escapeHtml(session.duration_sec)} seconds</div>
            </div>
            <div class="detail">
                <div class="detail-label">Total Compressions</div>
                <div class="detail-value">${escapeHtml(session.total_compressions)}</div>
            </div>
            <div class="detail">
                <div class="detail-label">Average BPM</div>
                <div class="detail-value">${fixed(session.avg_bpm)}</div>
            </div>
            <div class="detail">
                <div class="detail-label">Elbow Lock %</div>
                <div class="detail-value">${fixed(session.elbow_lock_pct)}%</div>
            </div>
            <div class="detail">
                <div class="detail-label">Accuracy Score</div>
                <div class="detail-value">${fixed(session.accuracy_pct)}%</div>
            </div>
            <div class="detail">
                <div class="detail-label">Result</div>
                <div class="detail-value">${escapeHtml(session.result)}</div>
            </div>
            ${organization ? `
            <div class="detail">
                <div class="detail-label">Organization</div>
                <div class="detail-value">${organization}</div>
            </div>
            ` : ''}
        </div>

        <div class="footer">
            <div class="disclaimer">Training aid only. Not a medical device. This certificate confirms practice session completion only and does not constitute CPR certification.</div>
        </div>

        <div class="signatures">
            <div class="signature">
                <div class="signature-line">Trainer Signature</div>
            </div>
            <div class="signature">
                <div class="signature-line">Date: ${date}</div>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', attachmentHeader(`certificate_${session.full_name.replace(/\s+/g, '_')}_${session.session_id}.html`));
    res.send(html);
});

export default router;