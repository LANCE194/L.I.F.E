/**
 * Output-escaping helpers for HTML, CSV and HTTP headers.
 */

const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

/**
 * Neutralize spreadsheet formula injection: cells beginning with = + - @ tab or CR are
 * prefixed with an apostrophe so Excel/LibreOffice treat them as text.
 * Numbers are left untouched.
 */
export function csvSafe(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return value;
    const text = String(value);
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function csvSafeRow(row) {
    const safe = {};
    for (const [key, value] of Object.entries(row)) {
        safe[key] = csvSafe(value);
    }
    return safe;
}

/**
 * Content-Disposition header that is valid for any file name (RFC 6266 / RFC 5987).
 */
export function attachmentHeader(filename) {
    const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
