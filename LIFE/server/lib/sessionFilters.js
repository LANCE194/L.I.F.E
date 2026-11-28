/**
 * Shared SQL conditions on the sessions table (alias "s").
 */

import { fail } from './validate.js';

/** Sessions run by staff (counts.self_practice is not 1). */
export const SUPERVISED_SESSION = "COALESCE(json_extract(s.counts, '$.self_practice'), 0) = 0";
/** Sessions a trainee recorded on their own account (Practice page). */
export const SELF_PRACTICE_SESSION = "COALESCE(json_extract(s.counts, '$.self_practice'), 0) = 1";

/**
 * Which sessions the leaderboard and dashboard statistics count:
 *   all        - every recorded session (default): trainer-supervised and trainee self-practice
 *   supervised - trainer-supervised sessions only (the Chapter 4 evaluation set)
 *   self       - trainee self-practice sessions only
 */
export const SESSION_SCOPES = ['all', 'supervised', 'self'];

export function parseScope(value) {
    if (value === undefined || value === null || value === '') return 'all';
    const scope = String(value).toLowerCase();
    if (!SESSION_SCOPES.includes(scope)) fail(`scope must be one of: ${SESSION_SCOPES.join(', ')}`);
    return scope;
}

/** SQL condition for a scope ("1 = 1" for all sessions). */
export function scopeCondition(scope) {
    if (scope === 'supervised') return SUPERVISED_SESSION;
    if (scope === 'self') return SELF_PRACTICE_SESSION;
    return '1 = 1';
}

/** Self-practice sessions counted inside an aggregate (for the "self-practice" column). */
export const SELF_PRACTICE_COUNT = `SUM(CASE WHEN ${SELF_PRACTICE_SESSION} THEN 1 ELSE 0 END)`;
