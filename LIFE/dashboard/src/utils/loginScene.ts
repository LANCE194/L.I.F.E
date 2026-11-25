/**
 * Animated sign-in background: a pose-tracked rescuer giving chest compressions at 110 BPM,
 * with an ECG trace, elbow-angle readout and a 30:2 counter. Drawn on a canvas so it works
 * offline and stays light. All geometry is relative to the canvas size.
 */

const BPM = 110;
const PER_CYCLE = 30;
const BREATH_PAUSE_S = 4;
const COMPRESSION_S = 60 / BPM;
const CYCLE_S = PER_CYCLE * COMPRESSION_S + BREATH_PAUSE_S;

const COLORS = {
  navyDeep: '#021640',
  navy: '#0a2e56',
  gold: '#e3b657',
  goldSoft: 'rgba(227, 182, 87, 0.75)',
  pulse: '#3ddc84',
  crimson: '#ff3b5c',
  line: 'rgba(255, 255, 255, 0.55)',
  faint: 'rgba(255, 255, 255, 0.08)',
};

interface Point { x: number; y: number }

export interface SceneState {
  ecg: number[];
  lastSampleT: number;
  lastPhase: number;
  particles: { x: number; y: number; r: number; vy: number; a: number }[];
}

export function createSceneState(): SceneState {
  const particles = Array.from({ length: 40 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 0.6 + Math.random() * 1.6,
    vy: 0.004 + Math.random() * 0.01,
    a: 0.15 + Math.random() * 0.35,
  }));
  return { ecg: [], lastSampleT: 0, lastPhase: 0, particles };
}

/** Where the scene is in the 30:2 loop at time t (seconds). */
export function sceneTiming(t: number) {
  const inCycle = t % CYCLE_S;
  const compressing = inCycle < PER_CYCLE * COMPRESSION_S;
  const count = compressing ? Math.floor(inCycle / COMPRESSION_S) + 1 : PER_CYCLE;
  const phase = compressing ? (inCycle % COMPRESSION_S) / COMPRESSION_S : 0;
  // Smooth push down and recoil: 0 at the top, 1 at full depth (mid-phase).
  const depth = compressing ? (1 - Math.cos(phase * Math.PI * 2)) / 2 : 0;
  return { compressing, count, phase, depth, breathLeft: compressing ? 0 : CYCLE_S - inCycle };
}

function glowLine(ctx: CanvasRenderingContext2D, points: Point[], color: string, width: number, blur: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, p: Point, r: number, color: string, blur = 0) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draw one frame. `t` is seconds since start; `dpr` scales line widths. */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, state: SceneState, dpr: number) {
  const { compressing, count, phase, depth, breathLeft } = sceneTiming(t);
  const narrow = w / dpr < 900;

  // ---- Background ----
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.05, 0, w * 0.5, h * 0.4, Math.max(w, h) * 0.9);
  bg.addColorStop(0, '#13406e');
  bg.addColorStop(0.45, COLORS.navy);
  bg.addColorStop(1, COLORS.navyDeep);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Globe-like grid (as in the emblem), slowly rotating.
  ctx.save();
  ctx.strokeStyle = COLORS.faint;
  ctx.lineWidth = 1 * dpr;
  const gx = w * 0.5;
  const gy = h * 0.42;
  const gr = Math.min(w, h) * 0.62;
  ctx.beginPath();
  ctx.arc(gx, gy, gr, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 1; i < 6; i += 1) {
    const offset = ((i / 6 + t * 0.01) % 1) * 2 - 1;
    ctx.beginPath();
    ctx.ellipse(gx, gy, Math.abs(offset) * gr, gr, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = -2; i <= 2; i += 1) {
    const y = gy + (i / 3) * gr;
    const half = Math.sqrt(Math.max(0, gr * gr - (y - gy) ** 2));
    ctx.beginPath();
    ctx.moveTo(gx - half, y);
    ctx.lineTo(gx + half, y);
    ctx.stroke();
  }
  ctx.restore();

  // Drifting particles.
  for (const p of state.particles) {
    p.y -= p.vy / 60;
    if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
    dot(ctx, { x: p.x * w, y: p.y * h }, p.r * dpr, `rgba(227, 182, 87, ${p.a * 0.5})`);
  }

  if (narrow) {
    drawEcg(ctx, w, h, t, state, dpr);
    return;
  }

  // ---- Rescuer and patient (side view) ----
  const s = Math.min(h * 0.38, w * 0.22);
  const floorY = h * 0.8;
  const cx = w * 0.18;
  const d = depth * s * 0.06; // compression depth on screen

  // Floor line and soft shadow.
  ctx.save();
  ctx.strokeStyle = 'rgba(227, 182, 87, 0.35)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(cx - s * 1.2, floorY);
  ctx.lineTo(cx + s * 1.1, floorY);
  ctx.stroke();
  ctx.translate(cx - s * 0.1, floorY);
  ctx.scale(1, 0.14);
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Patient lying on the floor, head to the right; the chest dips with each compression.
  const chestTop: Point = { x: cx, y: floorY - s * 0.17 + d };
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.75, floorY - s * 0.02);
  ctx.quadraticCurveTo(cx - s * 0.45, floorY - s * 0.12, cx - s * 0.18, floorY - s * 0.14);
  ctx.quadraticCurveTo(chestTop.x, chestTop.y - s * 0.01, cx + s * 0.32, floorY - s * 0.14);
  ctx.lineTo(cx + s * 0.42, floorY - s * 0.1);
  ctx.lineTo(cx + s * 0.42, floorY);
  ctx.lineTo(cx - s * 0.75, floorY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + s * 0.55, floorY - s * 0.09, s * 0.085, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Target mark on the chest.
  dot(ctx, chestTop, 3 * dpr, COLORS.crimson, 10 * dpr);

  // Rescuer pose: kneeling, shoulders over the hands, arms straight.
  const shoulder: Point = { x: cx - s * 0.02, y: floorY - s * 0.86 + d };
  const wrist: Point = { x: cx, y: chestTop.y - s * 0.03 };
  const elbow: Point = { x: (shoulder.x + wrist.x) / 2 + s * 0.004, y: (shoulder.y + wrist.y) / 2 };
  const hip: Point = { x: cx - s * 0.36, y: floorY - s * 0.5 + d * 0.3 };
  const knee: Point = { x: cx - s * 0.32, y: floorY - s * 0.03 };
  const ankle: Point = { x: cx - s * 0.78, y: floorY - s * 0.02 };
  const neck: Point = { x: shoulder.x + s * 0.04, y: shoulder.y - s * 0.06 };
  const head: Point = { x: shoulder.x + s * 0.1, y: shoulder.y - s * 0.16 };

  // Body skeleton (white) and the tracked arm (green = locked).
  glowLine(ctx, [ankle, knee, hip, shoulder], COLORS.line, 3 * dpr, 6 * dpr);
  glowLine(ctx, [shoulder, neck], COLORS.line, 3 * dpr, 6 * dpr);
  ctx.save();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 2.5 * dpr;
  ctx.shadowColor = COLORS.line;
  ctx.shadowBlur = 6 * dpr;
  ctx.beginPath();
  ctx.arc(head.x, head.y, s * 0.075, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  glowLine(ctx, [shoulder, elbow, wrist], COLORS.pulse, 6 * dpr, 18 * dpr);
  for (const joint of [shoulder, elbow, wrist, hip, knee, ankle]) dot(ctx, joint, 4.5 * dpr, '#ffffff', 8 * dpr);

  // Stacked hands with fingers (gold, as in the live overlay).
  ctx.save();
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2 * dpr;
  ctx.shadowColor = COLORS.gold;
  ctx.shadowBlur = 8 * dpr;
  for (let i = 0; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(wrist.x, wrist.y);
    ctx.lineTo(wrist.x + s * (0.03 + i * 0.012), wrist.y + s * (0.006 - i * 0.002));
    ctx.stroke();
  }
  ctx.restore();

  // Elbow-angle arc and readout.
  const angle = 170 + Math.round(Math.sin(t * 1.3) * 2 + 2);
  ctx.save();
  ctx.strokeStyle = COLORS.goldSoft;
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.arc(elbow.x, elbow.y, s * 0.07, -Math.PI / 2 - 0.15, Math.PI / 2 + 0.15, true);
  ctx.stroke();
  ctx.fillStyle = COLORS.gold;
  ctx.font = `600 ${Math.round(12 * dpr)}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(`${angle}°`, elbow.x - s * 0.22, elbow.y + 4 * dpr);
  ctx.restore();

  drawEcg(ctx, w, h, t, state, dpr);

  // ---- HUD (right of the card) ----
  const hudX = w * 0.76;
  const hudY = h * 0.3;
  const line = 26 * dpr;
  ctx.save();
  ctx.font = `700 ${Math.round(30 * dpr)}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8 * dpr;
  ctx.fillText(compressing ? `${BPM}` : '—', hudX, hudY);
  ctx.font = `600 ${Math.round(12 * dpr)}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = COLORS.gold;
  ctx.fillText('COMPRESSIONS / MIN', hudX, hudY + 18 * dpr);

  const rows: [string, string][] = compressing
    ? [['Elbows locked', '✓'], ['Hands stacked', '✓'], ['Compression', `${count} / ${PER_CYCLE}`]]
    : [['30 done', 'Give 2 breaths'], ['Resume in', `${Math.ceil(breathLeft)} s`], ['Ratio', '30:2']];
  ctx.font = `500 ${Math.round(14 * dpr)}px "Segoe UI", system-ui, sans-serif`;
  rows.forEach(([label, value], i) => {
    const y = hudY + 52 * dpr + i * line;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(label, hudX, y);
    ctx.fillStyle = value === '✓' ? COLORS.pulse : '#ffffff';
    ctx.fillText(value, hudX + 130 * dpr, y);
  });

  // 30:2 progress bar.
  const barY = hudY + 52 * dpr + rows.length * line;
  const barW = 200 * dpr;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(hudX, barY, barW, 5 * dpr);
  const progress = compressing ? (count - 1 + phase) / PER_CYCLE : 1;
  const grad = ctx.createLinearGradient(hudX, 0, hudX + barW, 0);
  grad.addColorStop(0, COLORS.pulse);
  grad.addColorStop(1, COLORS.gold);
  ctx.fillStyle = grad;
  ctx.fillRect(hudX, barY, barW * progress, 5 * dpr);
  ctx.restore();

  // Recording-style indicator, top-left.
  ctx.save();
  const blink = Math.sin(t * 4) > -0.2;
  if (blink) dot(ctx, { x: 22 * dpr, y: 24 * dpr }, 5 * dpr, COLORS.crimson, 10 * dpr);
  ctx.font = `600 ${Math.round(11 * dpr)}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('LIVE · POSE TRACKING DEMO', 34 * dpr, 28 * dpr);
  ctx.restore();

  state.lastPhase = phase;
}

function drawEcg(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, state: SceneState, dpr: number) {
  // ECG trace along the bottom: a spike at the bottom of each compression, flat during breaths.
  const sampleEvery = 1 / 60;
  while (state.lastSampleT + sampleEvery <= t) {
    state.lastSampleT += sampleEvery;
    const { phase: ph, compressing: active } = sceneTiming(state.lastSampleT);
    // QRS-like spike at the bottom of each compression.
    let v = Math.sin(state.lastSampleT * 7) * 0.03;
    if (active) {
      const x = ph - 0.5;
      v += Math.exp(-(x * x) / 0.0006) * 1 - Math.exp(-((x - 0.04) ** 2) / 0.0004) * 0.35 + Math.exp(-((x - 0.22) ** 2) / 0.004) * 0.18;
    }
    state.ecg.push(v);
    if (state.ecg.length > 360) state.ecg.shift();
  }
  const ecgY = h * 0.92;
  const ecgH = h * 0.06;
  const ecgPoints = state.ecg.map((v, i) => ({ x: (i / 359) * w, y: ecgY - v * ecgH }));
  if (ecgPoints.length > 1) {
    glowLine(ctx, ecgPoints, 'rgba(61, 220, 132, 0.85)', 2 * dpr, 12 * dpr);
    dot(ctx, ecgPoints[ecgPoints.length - 1], 3.5 * dpr, COLORS.pulse, 14 * dpr);
  }

}
