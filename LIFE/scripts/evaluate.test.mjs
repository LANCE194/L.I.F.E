import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binaryMetrics, evaluate, parseCsv, template } from './evaluate.mjs';

// Same columns as Reports -> "Export test data CSV".
const SYSTEM = [
  'Detail ID,Session ID,Session Date/Time,Trainee,Timestamp (ms),BPM,Elbow Angle,Elbow Locked',
  '1,7,2026-11-25T06:00:00Z,"Cruz, Ana",1000,110,170,Yes',
  '2,7,2026-11-25T06:00:00Z,"Cruz, Ana",1545,110,168,Yes',
  '3,7,2026-11-25T06:00:00Z,"Cruz, Ana",2090,112,150,No',
  '4,7,2026-11-25T06:00:00Z,"Cruz, Ana",2640,95,165,Yes',
  '5,7,2026-11-25T06:00:00Z,"Cruz, Ana",3190,108,,No',
  '6,7,2026-11-25T06:00:00Z,"Cruz, Ana",3700,125,171,Yes',
].join('\n');

test('parseCsv handles quotes, embedded commas and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
  assert.deepEqual(rows, [{ a: 'x, y', b: 'say "hi"' }]);
});

test('binaryMetrics computes the standard measures', () => {
  const m = binaryMetrics([
    { predicted: true, actual: true }, { predicted: true, actual: true }, { predicted: true, actual: false },
    { predicted: false, actual: false }, { predicted: false, actual: true },
  ]);
  assert.equal(m.tp, 2); assert.equal(m.fp, 1); assert.equal(m.tn, 1); assert.equal(m.fn, 1);
  assert.equal(m.accuracy, 3 / 5);
  assert.equal(m.precision, 2 / 3);
  assert.equal(m.recall, 2 / 3);
  assert.ok(Math.abs(m.f1 - 2 / 3) < 1e-12);
});

test('evaluate matches by compression number and excludes unscorable rows', () => {
  const labels = [
    'compression,observer_locked,reference_bpm',
    '1,Yes,110',   // TP
    '2,No,110',    // FP (system said locked)
    '3,No,110',    // TN
    '4,Yes,110',   // TP; BPM error -15
    '5,Yes,110',   // system could not see the elbow -> unscorable
    '6,Yes,120',
  ].join('\n');
  const result = evaluate(SYSTEM, labels);
  assert.deepEqual(result.sessions, [7]);
  assert.equal(result.unscorable, 1);
  assert.deepEqual([result.elbow.tp, result.elbow.fp, result.elbow.tn, result.elbow.fn], [3, 1, 1, 0]);
  assert.equal(result.elbow.recall, 1);
  // Correct = locked AND 100..120 (#5 excluded). System: #1, #2 correct; #3 bent; #4 at 95 and #6 at 125 wrong.
  // Observer: #1, #4, #6 correct; #2, #3 wrong. -> TP #1, FP #2, TN #3, FN #4 and #6.
  assert.deepEqual([result.correct.tp, result.correct.fp, result.correct.tn, result.correct.fn], [1, 1, 1, 2]);
  // Errors: 0, 0, 2, -15, -2, 5 -> MAE 4
  assert.equal(result.bpm.n, 6);
  assert.ok(Math.abs(result.bpm.mae - 4) < 1e-9);
});

test('evaluate matches by timestamp and reports missed and extra compressions', () => {
  const labels = [
    'session_id,timestamp_ms,observer_locked',
    '7,1010,Yes',
    '7,1560,Yes',
    '7,2100,No',
    '7,2900,Yes',   // 260 ms from the nearest detection -> missed at 250 ms tolerance
    '7,3195,Yes',
    '7,3690,Yes',
  ].join('\n');
  const result = evaluate(SYSTEM, labels, { toleranceMs: 250 });
  assert.equal(result.detection.matched, 5);
  assert.equal(result.detection.missed, 1);
  assert.equal(result.detection.extra, 1); // the detection at 2640 ms
});

test('template lists one row per detection with blank observer columns', () => {
  const lines = template(SYSTEM).trim().split('\n');
  assert.equal(lines.length, 7);
  assert.equal(lines[0], 'session_id,compression,timestamp_ms,system_bpm,system_elbow_angle,system_locked,observer_locked,reference_bpm');
  assert.equal(lines[5], '7,5,3190,108,,Not visible,,');
});
