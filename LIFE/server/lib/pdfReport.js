/**
 * PDF reports for Reports & Export (PDFKit, pure JavaScript, works offline).
 * A4 pages with the L.I.F.E. emblem, title, filters, a paginated table and page numbers.
 */

import PDFDocument from 'pdfkit';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { attachmentHeader } from './escape.js';

export const COLORS = {
    navy: '#0a2e56',
    navyDeep: '#021640',
    crimson: '#a81638',
    gold: '#e3b657',
    goldDark: '#8a6420',
    text: '#0f2240',
    muted: '#5b6880',
    border: '#dde2ea',
    zebra: '#f5f6fa',
    green: '#1e8a4c',
};

const LOGO_FILE = fileURLToPath(new URL('../../dashboard/public/brand/logo-256.png', import.meta.url));
let logoBuffer;
export function logo() {
    if (logoBuffer === undefined) {
        try {
            logoBuffer = readFileSync(LOGO_FILE);
        } catch {
            logoBuffer = null;
        }
    }
    return logoBuffer;
}

// The built-in PDF fonts cover Western European characters (e.g. ñ, é). Anything else is
// replaced so the PDF never shows broken glyphs.
const EXTRA_OK = new Set('‘’“”–—•…€™'.split(''));
export function safeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, ch => (EXTRA_OK.has(ch) ? ch : '?'));
}

/** Client time-zone offset (minutes west of UTC, from getTimezoneOffset); 0 if absent/invalid. */
export function tzOffsetFrom(query) {
    const value = Number(query?.tz_offset_min);
    return Number.isInteger(value) && Math.abs(value) <= 840 ? value : 0;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function localParts(value, tzOffsetMin) {
    if (!value) return null;
    const text = String(value);
    const utc = /Z$|[+-]\d\d:?\d\d$/.test(text) ? new Date(text) : new Date(`${text.replace(' ', 'T')}Z`);
    if (Number.isNaN(utc.getTime())) return null;
    return new Date(utc.getTime() - tzOffsetMin * 60000); // read with UTC getters
}

export function formatDate(value, tzOffsetMin = 0, long = false) {
    const d = localParts(value, tzOffsetMin);
    if (!d) return '—';
    return long
        ? `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
        : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatDateTime(value, tzOffsetMin = 0) {
    const d = localParts(value, tzOffsetMin);
    if (!d) return '—';
    const h = d.getUTCHours();
    const time = `${((h + 11) % 12) + 1}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    return `${formatDate(value, tzOffsetMin)} ${time}`;
}

export const fixed1 = value => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1));
export const duration = seconds => {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Start a report: sets download headers, pipes to the response and draws the page header.
 * Returns the PDFKit document.
 */
export function startReport(res, { filename, title, subtitle, filters = [], landscape = true, tzOffsetMin = 0 }) {
    const doc = new PDFDocument({
        size: 'A4',
        layout: landscape ? 'landscape' : 'portrait',
        margins: { top: 40, bottom: 48, left: 40, right: 40 },
        bufferPages: true,
        info: { Title: safeText(title), Author: 'Project L.I.F.E.', Creator: 'L.I.F.E. Localized Intelligent First-aid Evaluator' },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachmentHeader(filename));
    doc.pipe(res);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const top = doc.page.margins.top;
    const emblem = logo();
    if (emblem) doc.image(emblem, left, top - 6, { width: 44, height: 44 });
    const textLeft = emblem ? left + 54 : left;
    doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(16).text(safeText(title), textLeft, top - 2, { width: width - 54 });
    doc.fillColor(COLORS.goldDark).font('Helvetica').fontSize(9)
        .text(safeText(subtitle || 'Project L.I.F.E. — Localized Intelligent First-aid Evaluator'), textLeft, doc.y + 1, { width: width - 54 });
    const generated = formatDateTime(new Date().toISOString(), tzOffsetMin);
    const filterText = [...filters.filter(Boolean), `Generated ${generated}`].join('   ·   ');
    doc.fillColor(COLORS.muted).fontSize(8).text(safeText(filterText), textLeft, doc.y + 2, { width: width - 54 });
    const ruleY = Math.max(doc.y + 6, top + 46);
    doc.moveTo(left, ruleY).lineTo(left + width, ruleY).lineWidth(2).strokeColor(COLORS.gold).stroke();
    doc.y = ruleY + 10;
    doc.x = left;
    return doc;
}

/** A row of small summary figures under the header, e.g. [['Sessions', '12'], ...]. */
export function summaryRow(doc, items) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const boxWidth = Math.min(150, (width - (items.length - 1) * 8) / items.length);
    const y = doc.y;
    items.forEach(([label, value], i) => {
        const x = left + i * (boxWidth + 8);
        doc.roundedRect(x, y, boxWidth, 34, 3).fillColor(COLORS.zebra).fill();
        doc.rect(x, y, 3, 34).fillColor(COLORS.navy).fill();
        doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(safeText(label).toUpperCase(), x + 9, y + 6, { width: boxWidth - 12 });
        doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(12).text(safeText(value), x + 9, y + 16, { width: boxWidth - 12 });
    });
    doc.y = y + 44;
    doc.x = left;
}

/** Section heading inside a report (e.g. one per session in the test-data report). */
export function heading(doc, text) {
    const left = doc.page.margins.left;
    if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
    doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(10).text(safeText(text), left, doc.y + 4);
    doc.y += 3;
}

/**
 * Paginated table. columns: [{ label, width (relative), align, value(row) => string, color(row) }].
 * The header row repeats on each new page.
 */
export function table(doc, columns, rows, { fontSize = 8, emptyText = 'No records match the selected filters.' } = {}) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const totalWeight = columns.reduce((sum, c) => sum + (c.width || 1), 0);
    const widths = columns.map(c => ((c.width || 1) / totalWeight) * width);
    const pad = 4;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    const drawHeader = () => {
        const y = doc.y;
        doc.rect(left, y, width, fontSize + 10).fillColor(COLORS.navy).fill();
        let x = left;
        doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#ffffff');
        columns.forEach((c, i) => {
            doc.text(safeText(c.label), x + pad, y + 5, { width: widths[i] - pad * 2, align: c.align || 'left', lineBreak: false, ellipsis: true });
            x += widths[i];
        });
        doc.y = y + fontSize + 10;
    };

    if (rows.length === 0) {
        drawHeader();
        doc.font('Helvetica-Oblique').fontSize(fontSize + 1).fillColor(COLORS.muted).text(emptyText, left + pad, doc.y + 8);
        doc.y += 8;
        return;
    }

    drawHeader();
    rows.forEach((row, index) => {
        doc.font('Helvetica').fontSize(fontSize);
        const texts = columns.map(c => safeText(c.value(row)));
        const heights = texts.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i] - pad * 2 }));
        const rowHeight = Math.max(...heights) + pad * 2;
        if (doc.y + rowHeight > bottom()) {
            doc.addPage();
            doc.y = doc.page.margins.top;
            drawHeader();
        }
        const y = doc.y;
        if (index % 2 === 1) doc.rect(left, y, width, rowHeight).fillColor(COLORS.zebra).fill();
        let x = left;
        columns.forEach((c, i) => {
            const color = c.color ? c.color(row) : null;
            doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(color || COLORS.text)
                .text(texts[i], x + pad, y + pad, { width: widths[i] - pad * 2, align: c.align || 'left' });
            x += widths[i];
        });
        doc.moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight).lineWidth(0.5).strokeColor(COLORS.border).stroke();
        doc.y = y + rowHeight;
    });
    doc.x = left;
}

/** Footer on every page ("Page x of y") and finish the response. */
export function finishReport(doc, note = 'L.I.F.E. is a CPR training aid, not a medical device. Results confirm practice only, not certification.') {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        const left = doc.page.margins.left;
        const width = doc.page.width - left - doc.page.margins.right;
        const y = doc.page.height - doc.page.margins.bottom + 16;
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0; // allow writing in the footer area without adding a page
        doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
            .text(safeText(note), left, y, { width: width - 80, lineBreak: false, ellipsis: true })
            .text(`Page ${i - range.start + 1} of ${range.count}`, left + width - 80, y, { width: 80, align: 'right', lineBreak: false });
        doc.page.margins.bottom = savedBottom;
    }
    doc.end();
}
