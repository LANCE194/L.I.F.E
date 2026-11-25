#!/usr/bin/env node
/**
 * L.I.F.E. accuracy evaluation (Chapter 4).
 *
 * Compares the system's per-compression output (Reports -> "Export test data CSV") with a
 * human observer's labels, and prints:
 *   - elbow-lock confusion matrix, accuracy, precision, recall, F1 ("locked" = positive class)
 *   - "correct compression" (locked AND in-range BPM) confusion matrix and the same metrics
 *   - BPM error: MAE, RMSE, % within ±5 BPM
 *   - compression detection: matched, missed, extra (when labels carry timestamps)
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
 *
 * Compressions where the system could not see the elbow (blank elbow angle) are reported as
 * unscorable and left out of the elbow-lock metrics, matching how the app scores them.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
  }));
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
  const errors = pairs
    .filter(({ label, detection }) => label.referenceBpm !== null && detection.bpm !== null)
    .map(({ label, detection }) => detection.bpm - label.referenceBpm);
  if (errors.length === 0) return null;
  const mae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
  const bias = errors.reduce((sum, e) => sum + e, 0) / errors.length;
  const within5 = errors.filter(e => Math.abs(e) <= 5).length / errors.length;
  return { n: errors.length, mae, rmse, bias, within5 };
}

export function evaluate(systemText, labelText, options = {}) {
  const { session = null, bpmMin = 100, bpmMax = 120, toleranceMs = 250 } = options;
  const bySession = loadSystemRows(systemText, session);
  const defaultSession = session ?? (bySession.size === 1 ? [...bySession.keys()][0] : null);
  const labels = loadLabels(labelText, defaultSession);
  const matched = matchLabels(bySession, labels, toleranceMs);

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
    sessions: [...bySession.keys()],
    labels: labels.length,
    detection: {
      detected: matched.detected,
      matched: matched.pairs.length,
      missed: matched.missed.length,
      extra: matched.extra.length,
      timestampMatching: labels.some(label => label.compression === null && label.ts !== null),
    },
    unscorable,
    unlabeled,
    elbow,
    correct: correctPairs.length ? binaryMetrics(correctPairs) : null,
    bpm: bpmError(matched.pairs),
    problems: matched.problems,
    settings: { bpmMin, bpmMax, toleranceMs },
  };
}

// ---------- Output ----------

const pct = value => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const num = (value, digits = 2) => (value === null ? 'n/a' : value.toFixed(digits));

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
  const out = ['session_id,compression,timestamp_ms,system_bpm,system_elbow_angle,system_locked,observer_locked,reference_bpm'];
  for (const [sessionId, rows] of bySession) {
    for (const row of rows) {
      out.push([sessionId, row.compression, row.ts, row.bpm ?? '', row.angle ?? '', row.visible ? (row.locked ? 'Yes' : 'No') : 'Not visible', '', '']
        .map(csvCell).join(','));
    }
  }
  return `${out.join('\n')}\n`;
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
    else if (arg === '--help' || arg === '-h') options.help = true;
    else options.files.push(arg);
  }
  return options;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const usage = 'Usage:\n  node scripts/evaluate.mjs --template <test_data.csv> [--session ID] > labels.csv\n  node scripts/evaluate.mjs <test_data.csv> <labels.csv> [--session ID] [--bpm-min 100] [--bpm-max 120] [--tolerance-ms 250] [--json]';
    if (options.help) {
      console.log(usage);
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
