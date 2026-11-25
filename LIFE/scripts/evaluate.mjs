#!/usr/bin/env node
/**
 * L.I.F.E. accuracy evaluation (Chapter 4).
 *
 * Compares the system's per-compression output (Reports -> "Export test data CSV") with a
 * human observer's labels, and prints:
 *   - elbow-lock confusion matrix, accuracy, precision, recall, F1 ("locked" = positive class)
 *   - "correct compression" (locked AND in-range BPM) confusion matrix and the same metrics
 *   - BPM error: MAE, RMSE, bias, % within ±5 BPM, Pearson r and a paired t-test
 *   - compression detection: matched, missed, extra (when labels carry timestamps)
 *   - the same measures for each test condition (optional "condition" label column)
 *
 * It also summarises the other Chapter 4 data (paper section 3.10):
 *   --procedure <sessions.csv>   procedure adherence per session (mean, SD), how often each
 *                                procedure item was missed, and frame rate / inference time
 *                                (file: Reports -> "Download sessions" CSV)
 *   --likert <responses.csv>     ISO/IEC 25010 questionnaire: weighted mean, SD and verbal
 *                                interpretation per item, per characteristic and overall
 *                                (file: docs/evaluation/likert-responses-template.csv)
 *
 * Usage
 *   node scripts/evaluate.mjs --template <test_data.csv> [--session <id>] > labels.csv
 *       Writes a label sheet with one row per detected compression. The observer fills in
 *       observer_locked (Yes/No) and, if measured, reference_bpm (e.g. from a metronome or
 *       a video count). Rows can be added for compressions the system missed (leave
 *       compression blank and give timestamp_ms) and rows deleted for false detections.
 *
 *   node scripts/evaluate.mjs <test_data.csv> <labels.csv> [--session <id>] [--bpm-min 100]
 *       [--bpm-max 120] [--tolerance-ms 250] [--json]
 *
 * Label file columns (header names are case-insensitive):
 *   session_id       optional when the export holds one session
 *   compression      1-based compression number in that session (matches by order), or
 *   timestamp_ms     time of the compression (matches the nearest detection within tolerance)
 *   observer_locked  Yes/No, Y/N, 1/0, true/false
 *   reference_bpm    optional reference cadence at that compression
 *   condition        optional test condition, e.g. "good light 2 m", "dim light", "3 m"
 *
 * Compressions where the system could not see the elbow (blank elbow angle) are reported as
 * unscorable and left out of the elbow-lock metrics, matching how the app scores them.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PROCEDURE_ITEMS } from '../server/lib/procedure.js';

// ---------- CSV ----------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(cell => cell.trim() !== '')) rows.push(row);

  if (rows.length === 0) return [];
  const header = rows[0].map(name => name.trim().toLowerCase());
  return rows.slice(1).map(cells => Object.fromEntries(header.map((name, index) => [name, (cells[index] ?? '').trim()])));
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Exports prefix risky cells with ' (spreadsheet formula protection); strip it before parsing.
const clean = value => (typeof value === 'string' ? value.replace(/^'/, '').trim() : value);

function toNumber(value) {
  const text = clean(value);
  if (text === undefined || text === null || text === '') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function toBool(value) {
  const text = String(clean(value) ?? '').toLowerCase();
  if (['yes', 'y', '1', 'true', 'locked'].includes(text)) return true;
  if (['no', 'n', '0', 'false', 'unlocked', 'bent'].includes(text)) return false;
  return null;
}

function pick(row, ...names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== '') return row[name];
  }
  return undefined;
}

// ---------- Loading ----------

export function loadSystemRows(text, sessionFilter) {
  const rows = parseCsv(text).map(row => ({
    sessionId: toNumber(pick(row, 'session id', 'session_id')),
    ts: toNumber(pick(row, 'timestamp (ms)', 'ts', 'timestamp_ms')),
    bpm: toNumber(pick(row, 'bpm')),
    angle: toNumber(pick(row, 'elbow angle', 'elbow_angle')),
    locked: toBool(pick(row, 'elbow locked', 'elbow_locked')),
  })).filter(row => row.ts !== null);

  const filtered = sessionFilter ? rows.filter(row => row.sessionId === sessionFilter) : rows;
  const bySession = new Map();
  for (const row of filtered) {
    if (!bySession.has(row.sessionId)) bySession.set(row.sessionId, []);
    bySession.get(row.sessionId).push(row);
  }
  for (const list of bySession.values()) {
    list.sort((a, b) => a.ts - b.ts);
    list.forEach((row, index) => {
      row.compression = index + 1;
      row.visible = row.angle !== null;
    });
  }
  return bySession;
}

export function loadLabels(text, defaultSession) {
  return parseCsv(text).map((row, index) => ({
    line: index + 2,
    sessionId: toNumber(pick(row, 'session_id', 'session id')) ?? defaultSession,
    compression: toNumber(pick(row, 'compression', 'compression_no', 'index')),
    ts: toNumber(pick(row, 'timestamp_ms', 'ts', 'timestamp (ms)')),
    locked: toBool(pick(row, 'observer_locked', 'locked')),
    referenceBpm: toNumber(pick(row, 'reference_bpm', 'ref_bpm')),
    condition: clean(pick(row, 'condition', 'test_condition')) || null,
  }));
}

// ---------- Statistics ----------

export const mean = values => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
/** Sample standard deviation (n - 1). */
export function sd(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const value of c) ser += value / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betaContinuedFraction(a, b, x) {
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-12) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Two-sided p-value of Student's t with df degrees of freedom. */
export function tTestP(t, df) {
  if (!Number.isFinite(t)) return 0;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/** Pearson correlation with its two-sided p-value. */
export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  const t = Math.abs(r) >= 1 ? Infinity : r * Math.sqrt((n - 2) / (1 - r * r));
  return { n, r, p: tTestP(t, n - 2) };
}

/** Paired t-test of differences (system - reference). */
export function pairedT(differences) {
  const n = differences.length;
  const s = sd(differences);
  if (n < 2 || s === null) return null;
  const meanDifference = mean(differences);
  const t = s === 0 ? (meanDifference === 0 ? 0 : Infinity) : meanDifference / (s / Math.sqrt(n));
  return { n, meanDifference, t, df: n - 1, p: tTestP(t, n - 1) };
}

// ---------- Matching & metrics ----------

export function matchLabels(bySession, labels, toleranceMs) {
  const pairs = [];
  const missed = [];
  const problems = [];
  const used = new Set();

  for (const label of labels) {
    const detections = bySession.get(label.sessionId);
    if (!detections) {
      problems.push(`line ${label.line}: session ${label.sessionId ?? '(blank)'} is not in the test-data file`);
      continue;
    }
    let match = null;
    if (label.compression !== null) {
      match = detections[label.compression - 1] ?? null;
      if (!match) problems.push(`line ${label.line}: session ${label.sessionId} has no compression #${label.compression}`);
    } else if (label.ts !== null) {
      let bestDistance = Infinity;
      for (const detection of detections) {
        const key = `${label.sessionId}:${detection.compression}`;
        const distance = Math.abs(detection.ts - label.ts);
        if (!used.has(key) && distance < bestDistance) {
          bestDistance = distance;
          match = detection;
        }
      }
      if (bestDistance > toleranceMs) match = null;
      if (!match) missed.push(label);
    } else {
      problems.push(`line ${label.line}: needs a compression number or timestamp_ms`);
      continue;
    }
    if (match) {
      used.add(`${label.sessionId}:${match.compression}`);
      pairs.push({ label, detection: match });
    }
  }

  let detected = 0;
  const extra = [];
  for (const [sessionId, detections] of bySession) {
    if (!labels.some(label => label.sessionId === sessionId)) continue;
    detected += detections.length;
    for (const detection of detections) {
      if (!used.has(`${sessionId}:${detection.compression}`)) extra.push(detection);
    }
  }
  return { pairs, missed, extra, detected, problems };
}

export function binaryMetrics(pairs) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const { predicted, actual } of pairs) {
    if (predicted && actual) tp += 1;
    else if (predicted && !actual) fp += 1;
    else if (!predicted && !actual) tn += 1;
    else fn += 1;
  }
  const total = tp + fp + tn + fn;
  const ratio = (a, b) => (b === 0 ? null : a / b);
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);
  return { tp, fp, tn, fn, total, accuracy: ratio(tp + tn, total), precision, recall, specificity: ratio(tn, tn + fp), f1 };
}

export function bpmError(pairs) {
  const withReference = pairs.filter(({ label, detection }) => label.referenceBpm !== null && detection.bpm !== null);
  const errors = withReference.map(({ label, detection }) => detection.bpm - label.referenceBpm);
  if (errors.length === 0) return null;
  const mae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
  const bias = errors.reduce((sum, e) => sum + e, 0) / errors.length;
  const within5 = errors.filter(e => Math.abs(e) <= 5).length / errors.length;
  return {
    n: errors.length, mae, rmse, bias, within5,
    pearson: pearson(withReference.map(({ detection }) => detection.bpm), withReference.map(({ label }) => label.referenceBpm)),
    pairedT: pairedT(errors),
  };
}

export function evaluate(systemText, labelText, options = {}) {
  const { session = null, bpmMin = 100, bpmMax = 120, toleranceMs = 250 } = options;
  const bySession = loadSystemRows(systemText, session);
  const defaultSession = session ?? (bySession.size === 1 ? [...bySession.keys()][0] : null);
  const labels = loadLabels(labelText, defaultSession);
  const matched = matchLabels(bySession, labels, toleranceMs);
  const overall = measures(matched, bpmMin, bpmMax);

  const conditionNames = [...new Set(labels.map(label => label.condition).filter(Boolean))];
  const byCondition = conditionNames.map(name => {
    const keep = label => label.condition === name;
    return {
      condition: name,
      labels: labels.filter(keep).length,
      missed: matched.missed.filter(keep).length,
      ...measures({ pairs: matched.pairs.filter(pair => keep(pair.label)) }, bpmMin, bpmMax),
    };
  });

  return {
    sessions: [...bySession.keys()],
    labels: labels.length,
    detection: {
      detected: matched.detected,
      matched: matched.pairs.length,
      missed: matched.missed.length,
      extra: matched.extra.length,
      timestampMatching: labels.some(label => label.compression === null && label.ts !== null),
    },
    ...overall,
    byCondition,
    problems: matched.problems,
    settings: { bpmMin, bpmMax, toleranceMs },
  };
}

function measures(matched, bpmMin, bpmMax) {
  const scorable = matched.pairs.filter(({ label, detection }) => detection.visible && label.locked !== null);
  const unscorable = matched.pairs.filter(({ detection }) => !detection.visible).length;
  const unlabeled = matched.pairs.filter(({ label }) => label.locked === null).length;

  const elbow = binaryMetrics(scorable.map(({ label, detection }) => ({ predicted: detection.locked === true, actual: label.locked })));

  const inRange = bpm => bpm !== null && bpm >= bpmMin && bpm <= bpmMax;
  const correctPairs = scorable
    .filter(({ label, detection }) => label.referenceBpm !== null && detection.bpm !== null)
    .map(({ label, detection }) => ({
      predicted: detection.locked === true && inRange(detection.bpm),
      actual: label.locked && inRange(label.referenceBpm),
    }));

  return {
    unscorable,
    unlabeled,
    elbow,
    correct: correctPairs.length ? binaryMetrics(correctPairs) : null,
    bpm: bpmError(matched.pairs),
  };
}

// ---------- Output ----------

const pct = value => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const num = (value, digits = 2) => (value === null || value === undefined ? 'n/a' : value.toFixed(digits));
const pValue = p => (p < 0.001 ? '< 0.001' : `= ${p.toFixed(3)}`);

function matrixText(title, m, positive, negative) {
  const width = Math.max(positive.length, negative.length) + 12;
  const pad = text => String(text).padStart(14);
  return [
    title,
    `${''.padEnd(width)}${pad(`Obs ${positive}`)}${pad(`Obs ${negative}`)}`,
    `${`System ${positive}`.padEnd(width)}${pad(m.tp)}${pad(m.fp)}`,
    `${`System ${negative}`.padEnd(width)}${pad(m.fn)}${pad(m.tn)}`,
    `  n = ${m.total}   accuracy ${pct(m.accuracy)}   precision ${pct(m.precision)}   recall ${pct(m.recall)}   specificity ${pct(m.specificity)}   F1 ${num(m.f1, 3)}`,
  ].join('\n');
}

export function report(result) {
  const lines = [];
  lines.push('L.I.F.E. accuracy evaluation');
  lines.push(`Sessions: ${result.sessions.join(', ') || '(none)'}   Label rows: ${result.labels}   Target BPM: ${result.settings.bpmMin}-${result.settings.bpmMax}`);
  lines.push('');
  const d = result.detection;
  lines.push(`Compression detection: ${d.detected} detected, ${d.matched} matched to labels` +
    (d.timestampMatching ? `, ${d.missed} missed (labelled but not detected), ${d.extra} extra (detected but not labelled), tolerance ±${result.settings.toleranceMs} ms` : ''));
  if (d.timestampMatching && d.matched + d.missed > 0) {
    lines.push(`  Detection recall ${pct(d.matched / (d.matched + d.missed))}   precision ${pct(d.matched / (d.matched + d.extra || 1))}`);
  }
  lines.push(`Unscorable (elbow not visible to the system): ${result.unscorable}   Matched rows without an observer label: ${result.unlabeled}`);
  lines.push('');
  lines.push(result.elbow.total ? matrixText('Elbow lock (positive = locked)', result.elbow, 'locked', 'bent') : 'Elbow lock: no labelled, scorable compressions.');
  lines.push('');
  lines.push(result.correct
    ? matrixText('Correct compression (locked AND in-range BPM)', result.correct, 'correct', 'wrong')
    : 'Correct compression: needs reference_bpm in the labels.');
  lines.push('');
  lines.push(result.bpm
    ? `BPM error (system - reference), n = ${result.bpm.n}: MAE ${num(result.bpm.mae)}   RMSE ${num(result.bpm.rmse)}   bias ${num(result.bpm.bias)}   within ±5 BPM ${pct(result.bpm.within5)}`
    : 'BPM error: needs reference_bpm in the labels.');
  if (result.bpm?.pearson) {
    lines.push(`  Pearson r = ${num(result.bpm.pearson.r, 3)} (n = ${result.bpm.pearson.n}, p ${pValue(result.bpm.pearson.p)})`);
  }
  if (result.bpm?.pairedT) {
    const t = result.bpm.pairedT;
    lines.push(`  Paired t-test (system vs reference): mean difference ${num(t.meanDifference)} BPM, t(${t.df}) = ${num(t.t, 3)}, p ${pValue(t.p)}` +
      (t.p < 0.05 ? '  -> significant difference at 0.05' : '  -> no significant difference at 0.05'));
  }
  if (result.byCondition?.length) {
    lines.push('');
    lines.push('By test condition:');
    lines.push(`  ${'Condition'.padEnd(24)}${'labels'.padStart(8)}${'elbow n'.padStart(9)}${'elbow acc'.padStart(11)}${'F1'.padStart(8)}${'BPM MAE'.padStart(9)}${'±5 BPM'.padStart(9)}${'missed'.padStart(8)}`);
    for (const c of result.byCondition) {
      lines.push(`  ${c.condition.slice(0, 23).padEnd(24)}${String(c.labels).padStart(8)}${String(c.elbow.total).padStart(9)}${pct(c.elbow.accuracy).padStart(11)}${num(c.elbow.f1, 3).padStart(8)}${(c.bpm ? num(c.bpm.mae) : 'n/a').padStart(9)}${(c.bpm ? pct(c.bpm.within5) : 'n/a').padStart(9)}${(result.detection.timestampMatching ? String(c.missed) : '-').padStart(8)}`);
    }
  }
  if (result.problems.length) {
    lines.push('');
    lines.push(`Warnings (${result.problems.length}):`);
    for (const problem of result.problems.slice(0, 20)) lines.push(`  - ${problem}`);
    if (result.problems.length > 20) lines.push(`  ... and ${result.problems.length - 20} more`);
  }
  return lines.join('\n');
}

export function template(systemText, session) {
  const bySession = loadSystemRows(systemText, session);
  const out = ['session_id,compression,timestamp_ms,system_bpm,system_elbow_angle,system_locked,observer_locked,reference_bpm,condition'];
  for (const [sessionId, rows] of bySession) {
    for (const row of rows) {
      out.push([sessionId, row.compression, row.ts, row.bpm ?? '', row.angle ?? '', row.visible ? (row.locked ? 'Yes' : 'No') : 'Not visible', '', '', '']
        .map(csvCell).join(','));
    }
  }
  return `${out.join('\n')}\n`;
}

// ---------- Procedure adherence and performance (sessions export) ----------

const LIKERT_SCALE = [
  [4.21, 'Strongly Agree (Excellent)'],
  [3.41, 'Agree (Very Good)'],
  [2.61, 'Neutral (Good)'],
  [1.81, 'Disagree (Fair)'],
  [1.0, 'Strongly Disagree (Poor)'],
];
/** Verbal interpretation of a weighted mean (paper Table 5); boundaries use the 2-decimal value. */
export function interpret(value) {
  if (value === null) return 'n/a';
  const rounded = Math.round(value * 100) / 100;
  return (LIKERT_SCALE.find(([min]) => rounded >= min) ?? LIKERT_SCALE.at(-1))[1];
}

export function procedureSummary(sessionsText, { includeSelfPractice = false } = {}) {
  const all = parseCsv(sessionsText);
  const rows = includeSelfPractice ? all : all.filter(row => clean(row['session type']) !== 'Self-practice');
  const who = row => clean(row['trainee id']) || clean(row.trainee);
  const procedure = rows.map(row => toNumber(row['procedure %'])).filter(value => value !== null);
  const items = PROCEDURE_ITEMS.map(([, label]) => {
    const column = label.toLowerCase();
    const values = rows.map(row => ({ who: who(row), value: toBool(row[column]) })).filter(entry => entry.value !== null);
    const missed = values.filter(entry => entry.value === false);
    return {
      item: label,
      applicable: values.length,
      missed: missed.length,
      missedPct: values.length ? missed.length / values.length : null,
      participantsMissed: new Set(missed.map(entry => entry.who)).size,
    };
  }).filter(item => item.applicable > 0);
  const fps = rows.map(row => toNumber(row['avg fps'])).filter(value => value !== null && value > 0);
  const inference = rows.map(row => toNumber(row['avg inference (ms)'])).filter(value => value !== null && value > 0);
  return {
    sessions: rows.length,
    excludedSelfPractice: all.length - rows.length,
    participants: new Set(rows.map(who)).size,
    procedure: { n: procedure.length, mean: mean(procedure), sd: sd(procedure), min: procedure.length ? Math.min(...procedure) : null, max: procedure.length ? Math.max(...procedure) : null },
    items,
    fps: { n: fps.length, mean: mean(fps), sd: sd(fps), min: fps.length ? Math.min(...fps) : null },
    inferenceMs: { n: inference.length, mean: mean(inference), sd: sd(inference), max: inference.length ? Math.max(...inference) : null },
  };
}

export function procedureReport(result) {
  const lines = ['L.I.F.E. procedure adherence and performance'];
  lines.push(`Sessions: ${result.sessions} supervised${result.excludedSelfPractice ? ` (${result.excludedSelfPractice} self-practice left out)` : ''}   Participants: ${result.participants}`);
  lines.push('');
  const p = result.procedure;
  lines.push(`Procedure adherence per session (n = ${p.n}): mean ${num(p.mean, 1)}%   SD ${num(p.sd, 1)}   min ${num(p.min, 1)}%   max ${num(p.max, 1)}%`);
  lines.push('');
  lines.push('Frequency of each missed item:');
  lines.push(`  ${'Item'.padEnd(54)}${'applies'.padStart(8)}${'missed'.padStart(8)}${'%'.padStart(8)}${'people'.padStart(8)}`);
  for (const item of result.items) {
    lines.push(`  ${item.item.slice(0, 53).padEnd(54)}${String(item.applicable).padStart(8)}${String(item.missed).padStart(8)}${pct(item.missedPct).padStart(8)}${String(item.participantsMissed).padStart(8)}`);
  }
  lines.push('');
  lines.push(`Frame rate per session (n = ${result.fps.n}): mean ${num(result.fps.mean, 1)} FPS   SD ${num(result.fps.sd, 1)}   lowest ${num(result.fps.min, 1)}`);
  lines.push(`Pose inference time per session (n = ${result.inferenceMs.n}): mean ${num(result.inferenceMs.mean, 1)} ms   SD ${num(result.inferenceMs.sd, 1)}   highest ${num(result.inferenceMs.max, 1)}`);
  return lines.join('\n');
}

// ---------- ISO/IEC 25010 questionnaire (Likert) ----------

export const CHARACTERISTICS = {
  FS: 'Functional suitability',
  PE: 'Performance efficiency',
  US: 'Usability',
  RE: 'Reliability',
  SE: 'Security',
  PO: 'Portability',
};

export function likertSummary(text) {
  const rows = parseCsv(text);
  const itemColumns = rows.length ? Object.keys(rows[0]).filter(name => /^(fs|pe|us|re|se|po)\d+$/.test(name)) : [];
  const scoreOf = value => {
    const n = toNumber(value);
    return n !== null && Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };
  const describe = values => ({ n: values.length, weightedMean: mean(values), sd: sd(values), interpretation: interpret(mean(values)) });
  const scores = (prefix, subset) => subset.flatMap(row => itemColumns.filter(code => code.startsWith(prefix)).map(code => scoreOf(row[code]))).filter(value => value !== null);
  const present = Object.entries(CHARACTERISTICS).filter(([prefix]) => itemColumns.some(code => code.startsWith(prefix.toLowerCase())));
  const byCharacteristic = subset => present.map(([prefix, name]) => ({ characteristic: name, ...describe(scores(prefix.toLowerCase(), subset)) }));

  const items = itemColumns.map(code => {
    const values = rows.map(row => scoreOf(row[code])).filter(value => value !== null);
    return {
      code: code.toUpperCase(),
      characteristic: CHARACTERISTICS[code.slice(0, 2).toUpperCase()],
      frequency: [5, 4, 3, 2, 1].map(score => values.filter(value => value === score).length),
      ...describe(values),
    };
  });
  const groups = [...new Set(rows.map(row => clean(row.group)).filter(Boolean))].map(group => {
    const subset = rows.filter(row => clean(row.group) === group);
    return { group, respondents: subset.length, characteristics: byCharacteristic(subset), overall: describe(scores('', subset)) };
  });
  return { respondents: rows.length, items, characteristics: byCharacteristic(rows), overall: describe(scores('', rows)), groups };
}

export function likertReport(result) {
  const lines = ['L.I.F.E. ISO/IEC 25010 evaluation (5-point Likert scale)'];
  lines.push(`Respondents: ${result.respondents}`);
  lines.push('');
  lines.push(`  ${'Item'.padEnd(6)}${'f(5)'.padStart(6)}${'f(4)'.padStart(6)}${'f(3)'.padStart(6)}${'f(2)'.padStart(6)}${'f(1)'.padStart(6)}${'WM'.padStart(7)}${'SD'.padStart(7)}  Interpretation`);
  for (const item of result.items) {
    lines.push(`  ${item.code.padEnd(6)}${item.frequency.map(f => String(f).padStart(6)).join('')}${num(item.weightedMean).padStart(7)}${num(item.sd).padStart(7)}  ${item.interpretation}`);
  }
  const block = (characteristics, overall) => {
    for (const c of characteristics) lines.push(`  ${c.characteristic.padEnd(26)} WM ${num(c.weightedMean)}   SD ${num(c.sd)}   ${c.interpretation}`);
    lines.push(`  ${'Overall'.padEnd(26)} WM ${num(overall.weightedMean)}   SD ${num(overall.sd)}   ${overall.interpretation}`);
  };
  lines.push('');
  lines.push('By characteristic:');
  block(result.characteristics, result.overall);
  for (const g of result.groups) {
    lines.push('');
    lines.push(`Group: ${g.group} (${g.respondents} respondents)`);
    block(g.characteristics, g.overall);
  }
  return lines.join('\n');
}

// ---------- CLI ----------

function parseArgs(argv) {
  const options = { files: [], session: null, bpmMin: 100, bpmMax: 120, toleranceMs: 250, json: false, template: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value)) throw new Error(`${arg} needs a number`);
      return value;
    };
    if (arg === '--session') options.session = next();
    else if (arg === '--bpm-min') options.bpmMin = next();
    else if (arg === '--bpm-max') options.bpmMax = next();
    else if (arg === '--tolerance-ms') options.toleranceMs = next();
    else if (arg === '--json') options.json = true;
    else if (arg === '--template') options.template = true;
    else if (arg === '--procedure') options.mode = 'procedure';
    else if (arg === '--likert') options.mode = 'likert';
    else if (arg === '--include-self-practice') options.includeSelfPractice = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else options.files.push(arg);
  }
  return options;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const usage = 'Usage:\n  node scripts/evaluate.mjs --template <test_data.csv> [--session ID] > labels.csv\n  node scripts/evaluate.mjs <test_data.csv> <labels.csv> [--session ID] [--bpm-min 100] [--bpm-max 120] [--tolerance-ms 250] [--json]\n  node scripts/evaluate.mjs --procedure <sessions.csv> [--include-self-practice] [--json]\n  node scripts/evaluate.mjs --likert <responses.csv> [--json]';
    if (options.help) {
      console.log(usage);
    } else if (options.mode === 'procedure' || options.mode === 'likert') {
      if (options.files.length !== 1) throw new Error(usage);
      const text = readFileSync(options.files[0], 'utf8');
      const result = options.mode === 'procedure' ? procedureSummary(text, options) : likertSummary(text);
      console.log(options.json ? JSON.stringify(result, null, 2) : (options.mode === 'procedure' ? procedureReport(result) : likertReport(result)));
    } else if (options.template) {
      if (options.files.length !== 1) throw new Error(usage);
      process.stdout.write(template(readFileSync(options.files[0], 'utf8'), options.session));
    } else {
      if (options.files.length !== 2) throw new Error(usage);
      const result = evaluate(readFileSync(options.files[0], 'utf8'), readFileSync(options.files[1], 'utf8'), options);
      console.log(options.json ? JSON.stringify(result, null, 2) : report(result));
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
