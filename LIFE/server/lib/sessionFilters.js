/**
 * Shared SQL conditions on the sessions table (alias "s").
 */

/** Sessions run by staff. Trainee self-practice (counts.self_practice = 1) is left out of rankings. */
export const SUPERVISED_SESSION = "COALESCE(json_extract(s.counts, '$.self_practice'), 0) = 0";
