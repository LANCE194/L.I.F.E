/**
 * Small input-validation helpers (no external dependencies).
 * Each helper throws a ValidationError, which routes turn into HTTP 400.
 */

export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.status = 400;
    }
}

export function fail(message) {
    throw new ValidationError(message);
}

export function optionalNumber(value, name, { min = -Infinity, max = Infinity, integer = false, fallback = 0 } = {}) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) fail(`${name} must be a number`);
    if (integer && !Number.isInteger(number)) fail(`${name} must be a whole number`);
    if (number < min || number > max) fail(`${name} must be between ${min} and ${max}`);
    return number;
}

export function requiredId(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) fail(`${name} must be a positive whole number`);
    return number;
}

export function optionalString(value, name, { maxLength = 200, required = false } = {}) {
    if (value === undefined || value === null) {
        if (required) fail(`${name} is required`);
        return null;
    }
    if (typeof value !== 'string') fail(`${name} must be text`);
    const trimmed = value.trim();
    if (required && !trimmed) fail(`${name} is required`);
    if (trimmed.length > maxLength) fail(`${name} must be at most ${maxLength} characters`);
    return trimmed;
}

export function optionalBoolean(value, name) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (value === 0 || value === 1) return Boolean(value);
    fail(`${name} must be true or false`);
}

export function paginationParams(query, { defaultLimit = 100, maxLimit = 1000 } = {}) {
    const limit = optionalNumber(query.limit, 'limit', { min: 1, max: maxLimit, integer: true, fallback: defaultLimit });
    const offset = optionalNumber(query.offset, 'offset', { min: 0, integer: true, fallback: 0 });
    return { limit, offset };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toSqliteUtc(date) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Convert a date-range bound from the client into a UTC SQLite timestamp.
 * Accepts an ISO-8601 instant (preferred: the client converts local day boundaries) or a
 * plain YYYY-MM-DD (interpreted as a UTC day). End bounds are exclusive: a plain end date
 * becomes the start of the following day so the whole end day is included.
 */
export function rangeBound(value, name, { isEnd = false } = {}) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') fail(`${name} must be a date`);

    if (DATE_ONLY.test(value)) {
        const date = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(date.getTime())) fail(`${name} is not a valid date`);
        if (isEnd) date.setUTCDate(date.getUTCDate() + 1);
        return toSqliteUtc(date);
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) fail(`${name} is not a valid date`);
    return toSqliteUtc(date);
}

/**
 * Append date-range conditions on `column` to a query/params pair.
 */
export function applyDateRange(query, params, column, startValue, endValue) {
    const start = rangeBound(startValue, 'start_date');
    const end = rangeBound(endValue, 'end_date', { isEnd: true });
    if (start) {
        query += ` AND ${column} >= ?`;
        params.push(start);
    }
    if (end) {
        query += ` AND ${column} < ?`;
        params.push(end);
    }
    return query;
}

/**
 * Client time-zone offset in minutes east of UTC (e.g. +480 for the Philippines).
 * Browsers report getTimezoneOffset() as minutes WEST of UTC, so the client sends that value
 * and we negate it here.
 */
export function timezoneModifier(query) {
    const westMinutes = optionalNumber(query.tz_offset_min, 'tz_offset_min', {
        min: -840,
        max: 840,
        integer: true,
        fallback: 0,
    });
    const eastMinutes = -westMinutes;
    return `${eastMinutes >= 0 ? '+' : ''}${eastMinutes} minutes`;
}

export const PASSWORD_MIN_LENGTH = 8;

export function validatePassword(password, name = 'Password') {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
        fail(`${name} must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    if (password.length > 128) fail(`${name} must be at most 128 characters`);
    return password;
}

/**
 * Wrap a route handler so ValidationErrors become 400 responses.
 */
export function handle(fn) {
    return async (req, res, next) => {
        try {
            await fn(req, res, next);
        } catch (err) {
            if (err instanceof ValidationError) {
                return res.status(400).json({ error: err.message });
            }
            next(err);
        }
    };
}
