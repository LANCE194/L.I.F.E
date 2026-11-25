/**
 * Rebuilds the procedure-adherence checklist of a saved session from its stored fields, so
 * exports can list which items were followed or missed (paper section 3.10: "frequency of each
 * missed item across participants").
 *
 * The rules mirror evaluateProcedure() in dashboard/src/cpr/flow.ts; a dashboard test
 * (procedureParity.test.ts) checks that both give the same items for the same session.
 */

export const HANDS_STACKED_TARGET_PCT = 70;

const cyclesPerTwoMinutes = perCycle => (perCycle === 15 ? 10 : 5);
const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * Stable keys (used as export column names) for every item that can appear.
 * An item that does not apply to a session (e.g. no AED arrived) is reported as null.
 */
export const PROCEDURE_ITEMS = [
    ['scene_safe', 'Checked that the scene is safe'],
    ['response_checked', 'Checked responsiveness (tap and shout)'],
    ['breathing_checked', 'Checked breathing'],
    ['called_911', 'Called 911 and sent for an AED before compressions'],
    ['compressions_started', 'Started chest compressions'],
    ['hands_stacked', 'Hands stacked on the chest'],
    ['breaths_every_cycle', 'Gave 2 breaths after every cycle'],
    ['cycles_completed', 'Completed the expected cycles in 2 minutes'],
    ['continuous_hands_only', 'Continuous compressions (hands-only)'],
    ['pauses_under_10s', 'Kept every pause under 10 seconds'],
    ['aed_in_order', 'Used the AED in order and resumed CPR'],
];

/**
 * @param {{ procedure_steps?: object, counts?: object, duration_sec?: number, total_compressions?: number }} session
 *        (procedure_steps and counts already parsed from JSON)
 * @returns {Record<string, boolean|null>} item key -> followed (true), missed (false) or not applicable (null)
 */
export function procedureItems(session) {
    const steps = session.procedure_steps || {};
    const counts = session.counts || {};
    const total = num(session.total_compressions);
    const elapsed = num(session.duration_sec);
    const longPauses = num(counts.long_pauses);
    const cycles = num(counts.breath_cycles);
    const handsOnly = num(counts.hands_only) === 1;
    const perCycle = num(counts.compressions_per_cycle) || 30;

    const result = Object.fromEntries(PROCEDURE_ITEMS.map(([key]) => [key, null]));
    result.scene_safe = steps.scene_safe === true;
    result.response_checked = steps.response_checked === true;
    result.breathing_checked = steps.breathing_checked === true;
    result.called_911 = steps.emergency_services_called === true;
    result.compressions_started = (steps.cpr_started === true || total > 0) && total > 0;
    if (counts.hands_stacked_pct !== undefined) result.hands_stacked = num(counts.hands_stacked_pct) >= HANDS_STACKED_TARGET_PCT;
    if (!handsOnly) {
        const expected = cyclesPerTwoMinutes(perCycle) * Math.min(1, elapsed / 120);
        const minimum = Math.max(1, Math.floor(expected) - 1);
        result.breaths_every_cycle = cycles >= 1 && num(counts.skipped_breaths) === 0;
        result.cycles_completed = cycles >= minimum;
    } else {
        result.continuous_hands_only = total > 0 && longPauses === 0;
    }
    result.pauses_under_10s = longPauses === 0;
    if (steps.aed_used === true) result.aed_in_order = longPauses === 0;
    return result;
}

/** Labels of the missed items, in checklist order. */
export function missedItems(session) {
    const items = procedureItems(session);
    return PROCEDURE_ITEMS.filter(([key]) => items[key] === false).map(([, label]) => label);
}
