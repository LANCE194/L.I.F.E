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
import PDFDocumentCtor from 'pdfkit';
import {
    COLORS, startReport, summaryRow, table, heading, finishReport, logo, safeText, tzOffsetFrom,
    formatDate, formatDateTime, fixed1, duration,
} from '../lib/pdfReport.js';

const wantsPdf = req => String(req.query.format || '').toLowerCase() === 'pdf';
const fileDate = () => new Date().toISOString().slice(0, 10);
const safeJson = text => { try { return JSON.parse(text || '{}'); } catch { return {}; } };
const resultColor = row => (row.result === 'Pass' ? COLORS.green : COLORS.crimson);

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
            s.result,
            s.counts
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

    if (wantsPdf(req)) {
        const tz = tzOffsetFrom(req.query);
        const traineeName = trainee_id ? prepare('SELECT full_name FROM trainees WHERE trainee_id = ?').get(Number(trainee_id))?.full_name : null;
        const filters = [
            traineeName ? `Trainee: ${traineeName}` : 'All trainees',
            start_date || end_date ? `Dates: ${start_date ? formatDate(start_date, tz) : 'start'} to ${end_date ? formatDate(new Date(new Date(end_date).getTime() - 1).toISOString(), tz) : 'today'}` : 'All dates',
        ];
        const doc = startReport(res, { filename: `life_sessions_${fileDate()}.pdf`, title: 'Session Report', filters, tzOffsetMin: tz });
        const rows = sessions.map(row => ({ ...row, counts: safeJson(row.counts) }));
        const passes = rows.filter(row => row.result === 'Pass').length;
        const avg = rows.length ? rows.reduce((sum, row) => sum + (row.accuracy_pct || 0), 0) / rows.length : null;
        summaryRow(doc, [
            ['Sessions', String(rows.length)],
            ['Average accuracy', avg === null ? '—' : `${avg.toFixed(1)}%`],
            ['Passed', rows.length ? `${passes} (${Math.round((passes / rows.length) * 100)}%)` : '—'],
            ['Self-practice', String(rows.filter(row => row.counts.self_practice === 1).length)],
        ]);
        table(doc, [
            { label: 'Date / time', width: 1.5, value: row => formatDateTime(row.date_time, tz) },
            { label: 'Trainee', width: 1.6, bold: true, value: row => row.trainee_name + (row.counts.self_practice === 1 ? ' (self-practice)' : '') },
            { label: 'Organization', width: 1.3, value: row => row.organization || '—' },
            { label: 'Duration', width: 0.7, align: 'right', value: row => duration(row.duration_sec) },
            { label: 'Compressions', width: 0.9, align: 'right', value: row => String(row.total_compressions ?? 0) },
            { label: 'Avg BPM', width: 0.7, align: 'right', value: row => fixed1(row.avg_bpm) },
            { label: 'Elbow lock', width: 0.8, align: 'right', value: row => `${fixed1(row.elbow_lock_pct)}%` },
            { label: 'Accuracy', width: 0.8, align: 'right', bold: true, value: row => `${fixed1(row.accuracy_pct)}%` },
            { label: 'Procedure', width: 0.8, align: 'right', value: row => (row.counts.procedure_pct === undefined ? '—' : `${Math.round(row.counts.procedure_pct)}%`) },
            { label: 'Result', width: 1.1, bold: true, value: row => row.result, color: resultColor },
        ], rows);
        return finishReport(doc);
    }

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

    sendCsv(res, 'life_sessions_export.csv', columns, sessions.map(({ counts, ...row }) => row));
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

    if (wantsPdf(req)) {
        const tz = tzOffsetFrom(req.query);
        const accounts = new Map(prepare("SELECT trainee_id, username, is_active FROM users WHERE role = 'trainee'").all().map(a => [a.trainee_id, a]));
        const counts = new Map(prepare('SELECT trainee_id, COUNT(*) AS n FROM sessions GROUP BY trainee_id').all().map(c => [c.trainee_id, c.n]));
        const doc = startReport(res, { filename: `life_trainees_${fileDate()}.pdf`, title: 'Trainee List', filters: ['All trainees'], tzOffsetMin: tz });
        summaryRow(doc, [
            ['Trainees', String(trainees.length)],
            ['Active', String(trainees.filter(t => t.is_active).length)],
            ['Consent recorded', String(trainees.filter(t => t.consent_given).length)],
            ['With sign-in', String(trainees.filter(t => accounts.has(t.trainee_id)).length)],
        ]);
        table(doc, [
            { label: 'Name', width: 1.6, bold: true, value: t => t.full_name },
            { label: 'Organization', width: 1.4, value: t => t.organization || '—' },
            { label: 'Consent', width: 0.7, value: t => (t.consent_given ? 'Given' : 'Pending'), color: t => (t.consent_given ? COLORS.green : COLORS.crimson) },
            { label: 'Status', width: 0.7, value: t => (t.is_active ? 'Active' : 'Inactive') },
            { label: 'Sign-in', width: 1.2, value: t => accounts.get(t.trainee_id)?.username || '—' },
            { label: 'Sessions', width: 0.7, align: 'right', value: t => String(counts.get(t.trainee_id) || 0) },
            { label: 'Registered', width: 0.9, value: t => formatDate(t.date_registered, tz) },
            { label: 'Notes', width: 2, value: t => t.notes || '' },
        ], trainees);
        return finishReport(doc);
    }

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

    if (wantsPdf(req)) {
        const tz = tzOffsetFrom(req.query);
        const doc = startReport(res, {
            filename: `life_test_data_${fileDate()}.pdf`,
            title: 'Test Data: Per-Compression Results',
            filters: [session_id ? `Session #${session_id}` : 'All sessions', 'For accuracy analysis (Chapter 4)'],
            landscape: false,
            tzOffsetMin: tz,
        });
        const bySession = new Map();
        for (const d of details) {
            if (!bySession.has(d.session_id)) bySession.set(d.session_id, []);
            bySession.get(d.session_id).push(d);
        }
        summaryRow(doc, [
            ['Sessions', String(bySession.size)],
            ['Compressions', String(details.length)],
            // Only compressions where the elbow was visible, as in the app's elbow-lock score.
            ['Elbow locked', (() => {
                const visible = details.filter(d => d.elbow_angle !== null);
                return visible.length ? `${Math.round((visible.filter(d => d.elbow_locked).length / visible.length) * 100)}%` : '—';
            })()],
            ['Elbow not visible', String(details.filter(d => d.elbow_angle === null).length)],
        ]);
        if (bySession.size === 0) table(doc, [{ label: 'Compression', value: () => '' }], []);
        for (const [id, rows] of bySession) {
            heading(doc, `Session #${id} · ${rows[0].trainee_name} · ${formatDateTime(rows[0].date_time, tz)} · ${rows.length} compressions`);
            const start = rows[0].ts;
            table(doc, [
                { label: '#', width: 0.5, align: 'right', value: r => String(rows.indexOf(r) + 1) },
                { label: 'Time (s)', width: 0.8, align: 'right', value: r => ((r.ts - start) / 1000).toFixed(1) },
                { label: 'BPM', width: 0.8, align: 'right', value: r => fixed1(r.bpm) },
                { label: 'Elbow angle', width: 0.9, align: 'right', value: r => (r.elbow_angle === null ? 'not visible' : `${fixed1(r.elbow_angle)}°`) },
                { label: 'Elbow locked', width: 0.9, value: r => (r.elbow_angle === null ? '—' : r.elbow_locked ? 'Yes' : 'No'), color: r => (r.elbow_angle === null ? COLORS.muted : r.elbow_locked ? COLORS.green : COLORS.crimson) },
                { label: 'Timestamp (ms)', width: 1.2, align: 'right', value: r => String(r.ts) },
            ], rows, { fontSize: 7.5 });
            doc.y += 6;
        }
        return finishReport(doc);
    }

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

    if (wantsPdf(req)) return sendCertificatePdf(req, res, session);

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

/**
 * Certificate of Practice Completion as a one-page landscape A4 PDF.
 */
function sendCertificatePdf(req, res, session) {
    const tz = tzOffsetFrom(req.query);
    const PDFDocument = PDFDocumentCtor;
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: 'Certificate of Practice Completion', Author: 'Project L.I.F.E.' } });
    const safeName = session.full_name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'trainee';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachmentHeader(`certificate_${safeName}_${session.session_id}.pdf`));
    doc.pipe(res);

    const W = doc.page.width;
    const H = doc.page.height;
    doc.rect(18, 18, W - 36, H - 36).lineWidth(6).strokeColor(COLORS.navy).stroke();
    doc.rect(32, 32, W - 64, H - 64).lineWidth(1.5).strokeColor(COLORS.gold).stroke();

    const center = (text, y, { font = 'Helvetica', size = 12, color = COLORS.text, spacing = 0 } = {}) =>
        doc.font(font).fontSize(size).fillColor(color).text(safeText(text), 60, y, { width: W - 120, align: 'center', characterSpacing: spacing });

    const emblem = logo();
    if (emblem) doc.image(emblem, W / 2 - 42, 48, { width: 84, height: 84 });
    center('PROJECT L.I.F.E.', 140, { font: 'Helvetica-Bold', size: 20, color: COLORS.navy, spacing: 2 });
    center('LOCALIZED INTELLIGENT FIRST-AID EVALUATOR', 165, { size: 9, color: COLORS.goldDark, spacing: 1.5 });
    center('CERTIFICATE OF PRACTICE COMPLETION', 190, { font: 'Times-Bold', size: 26, color: COLORS.crimson, spacing: 2 });
    doc.moveTo(W / 2 - 60, 226).lineTo(W / 2 + 60, 226).lineWidth(2).strokeColor(COLORS.gold).stroke();

    center('This certifies that', 240, { font: 'Times-Roman', size: 15 });
    center(session.full_name, 260, { font: 'Times-Bold', size: 26, color: COLORS.navy });
    const nameWidth = Math.min(doc.widthOfString(safeText(session.full_name)) + 30, W - 200);
    doc.moveTo(W / 2 - nameWidth / 2, 292).lineTo(W / 2 + nameWidth / 2, 292).lineWidth(1.2).strokeColor(COLORS.gold).stroke();
    center(`has completed a CPR practice session on ${formatDate(session.date_time, tz, true)}`, 300, { font: 'Times-Roman', size: 14 });

    const details = [
        ['Session duration', duration(session.duration_sec)],
        ['Total compressions', String(session.total_compressions ?? 0)],
        ['Average rate', `${fixed1(session.avg_bpm)} per min`],
        ['Elbow lock', `${fixed1(session.elbow_lock_pct)}%`],
        ['Accuracy score', `${fixed1(session.accuracy_pct)}%`],
        ['Result', session.result],
    ];
    if (session.organization) details.push(['Organization', session.organization]);
    const cols = 3;
    const boxW = 210;
    const boxH = 38;
    const gap = 12;
    const gridW = cols * boxW + (cols - 1) * gap;
    const gridX = (W - gridW) / 2;
    details.forEach(([label, value], i) => {
        const x = gridX + (i % cols) * (boxW + gap);
        const y = 334 + Math.floor(i / cols) * (boxH + 8);
        doc.rect(x, y, boxW, boxH).fillColor('#f5f6fa').fill();
        doc.rect(x, y, 4, boxH).fillColor(COLORS.navy).fill();
        doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(safeText(label).toUpperCase(), x + 12, y + 7, { width: boxW - 18, characterSpacing: 0.6 });
        doc.font('Helvetica-Bold').fontSize(12).fillColor(label === 'Result' ? resultColor(session) : COLORS.navy)
            .text(safeText(value), x + 12, y + 19, { width: boxW - 18, lineBreak: false, ellipsis: true });
    });

    const rowsUsed = Math.ceil(details.length / cols);
    const afterGrid = 334 + rowsUsed * (boxH + 8) + 4;
    center('Training aid only. Not a medical device. This certificate confirms practice session completion only and does not constitute CPR certification.',
        afterGrid, { font: 'Helvetica-Oblique', size: 8.5, color: COLORS.muted });

    const sigY = H - 78;
    const sigW = 200;
    doc.moveTo(90, sigY).lineTo(90 + sigW, sigY).lineWidth(0.8).strokeColor(COLORS.text).stroke();
    doc.moveTo(W - 90 - sigW, sigY).lineTo(W - 90, sigY).stroke();
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text)
        .text('Trainer signature', 90, sigY + 6, { width: sigW, align: 'center' })
        .text(`Date: ${formatDate(session.date_time, tz, true)}`, W - 90 - sigW, sigY + 6, { width: sigW, align: 'center' });

    doc.end();
}

export default router;