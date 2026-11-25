import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binaryMetrics, evaluate, parseCsv, template, pearson, pairedT, tTestP, interpret, procedureSummary, likertSummary } from './evaluate.mjs';

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
  assert.equal(lines[0], 'session_id,compression,timestamp_ms,system_bpm,system_elbow_angle,system_locked,observer_locked,reference_bpm,condition');
  assert.equal(lines[5], '7,5,3190,108,,Not visible,,,');
});

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('t distribution p-values match statistical tables', () => {
  close(tTestP(2.228, 10), 0.05);   // two-sided critical value, df 10
  close(tTestP(2.045, 29), 0.05);
  close(tTestP(0, 5), 1);
  close(tTestP(4.032, 5), 0.01);
});

test('Pearson r and paired t-test give the textbook results', () => {
  const r = pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
  close(r.r, 0.7746);
  close(r.p, 0.1240);
  const t = pairedT([1, 2, 0, 3, 1, 2]);   // mean 1.5, SD 1.0488
  close(t.t, 3.5032);
  assert.equal(t.df, 5);
  close(t.p, 0.0172);
});

test('evaluate adds Pearson, paired t and per-condition results', () => {
  const labels = [
    'compression,observer_locked,reference_bpm,condition',
    '1,Yes,108,good light',
    '2,Yes,111,good light',
    '3,No,110,good light',
    '4,Yes,100,dim light',
    '6,Yes,120,dim light',
  ].join('\n');
  const result = evaluate(SYSTEM, labels);
  assert.ok(result.bpm.pearson && result.bpm.pairedT);
  assert.deepEqual(result.byCondition.map(c => [c.condition, c.labels, c.elbow.total]), [['good light', 3, 3], ['dim light', 2, 2]]);
  assert.equal(result.byCondition[0].elbow.accuracy, 1);
});

test('Likert interpretation follows the paper scale', () => {
  assert.equal(interpret(4.21), 'Strongly Agree (Excellent)');
  assert.equal(interpret(4.2), 'Agree (Very Good)');
  assert.equal(interpret(3.41), 'Agree (Very Good)');
  assert.equal(interpret(2.61), 'Neutral (Good)');
  assert.equal(interpret(1.81), 'Disagree (Fair)');
  assert.equal(interpret(1.8), 'Strongly Disagree (Poor)');
});

test('likertSummary computes weighted mean and SD per item, characteristic, overall and group', () => {
  const csv = ['respondent,group,FS1,FS2,US1', 'R1,Trainee,5,4,3', 'R2,Trainee,4,4,4', 'R3,Trainer,5,5,2'].join('\n');
  const result = likertSummary(csv);
  assert.equal(result.respondents, 3);
  const fs1 = result.items.find(item => item.code === 'FS1');
  assert.deepEqual(fs1.frequency, [2, 1, 0, 0, 0]);
  close(fs1.weightedMean, 14 / 3);
  close(fs1.sd, 0.5774);
  assert.deepEqual(result.characteristics.map(c => c.characteristic), ['Functional suitability', 'Usability']);
  close(result.characteristics[0].weightedMean, 27 / 6);
  close(result.overall.weightedMean, 36 / 9);
  assert.deepEqual(result.groups.map(g => [g.group, g.respondents]), [['Trainee', 2], ['Trainer', 1]]);
});

test('procedureSummary reads the sessions export and counts missed items per item and person', () => {
  const csv = [
    'Session ID,Trainee ID,Session Type,Procedure %,Checked that the scene is safe,Kept every pause under 10 seconds,Used the AED in order and resumed CPR,Avg FPS,Avg Inference (ms)',
    '1,1,Supervised,100,Yes,Yes,N/A,28,12',
    '2,1,Supervised,75,No,No,N/A,24,15',
    '3,2,Supervised,50,No,Yes,No,20,18',
    '4,2,Self-practice,0,No,No,No,10,40',
  ].join('\n');
  const result = procedureSummary(csv);
  assert.equal(result.sessions, 3);
  assert.equal(result.excludedSelfPractice, 1);
  assert.equal(result.participants, 2);
  close(result.procedure.mean, 75);
  close(result.procedure.sd, 25);
  const scene = result.items.find(item => item.item === 'Checked that the scene is safe');
  assert.deepEqual([scene.applicable, scene.missed, scene.participantsMissed], [3, 2, 2]);
  const aed = result.items.find(item => item.item.startsWith('Used the AED'));
  assert.deepEqual([aed.applicable, aed.missed], [1, 1]);
  close(result.fps.mean, 24);
  assert.equal(result.fps.min, 20);
});
