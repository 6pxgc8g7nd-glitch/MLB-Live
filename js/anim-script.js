/* 打席動畫的純計算：用 Statcast 的真實球路與擊球資料，排出「投手投球 → 打者擊球 → 野手傳球 → 跑者推進」的時間表。
 * 不碰 DOM，可以在 node 測試（pitchPath / hitPlan / runnerMoves / batPose / buildScript / frameAt）。畫面在 anim-view.js。 */
import { evZh } from './dict.js';
import { pitchCls } from './pitches.js';
import { DCAM, EYE, DP, PLATE_Y } from './cam3d.js';
export { DCAM, EYE, DP };

export const MOUND_Y = 60.5;
const G_FT = 32.2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const ease = (u) => u * u * (3 - 2 * u);

export const BASE_XY = { H: [0, 0], '1B': [63.6, 63.6], '2B': [0, 127.3], '3B': [-63.6, 63.6] };
const ORDER = ['H', '1B', '2B', '3B', 'H'];

// 解 y(t) = target，取最靠近 t=0 的根
function solveT(c, target) {
  const a = 0.5 * c.aY, b = c.vY0, k = c.y0 - target;
  if (Math.abs(a) < 1e-9) return b ? -k / b : null;
  const disc = b * b - 4 * a * k;
  if (disc < 0) return null;
  const s = Math.sqrt(disc), r = [(-b + s) / (2 * a), (-b - s) / (2 * a)];
  return Math.abs(r[0]) < Math.abs(r[1]) ? r[0] : r[1];
}

// 一球的真實軌跡：從出手點到本壘板前緣，N 個取樣點（x 左右、y 離本壘距離、z 高度，單位呎）
export function pitchPath(pd, N = 30) {
  const c = pd && pd.coordinates;
  if (!c || c.vY0 == null || c.aY == null || c.y0 == null) return null;
  const T = solveT(c, PLATE_Y);
  const ts = solveT(c, MOUND_Y - (pd.extension || 6));
  if (!(T > 0.2 && T < 1.2)) return null;
  const t0 = ts != null && ts < 0 && ts > -0.4 ? ts : 0;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((T - t0) * i) / N;
    pts.push({ x: c.x0 + c.vX0 * t + 0.5 * c.aX * t * t, y: c.y0 + c.vY0 * t + 0.5 * c.aY * t * t, z: c.z0 + c.vZ0 * t + 0.5 * c.aZ * t * t });
  }
  return { pts, dur: T - t0 };
}

// 擊球：落點（呎，本壘為原點）、飛行時間、高度；沒有落點座標就回傳 null
export function hitPlan(h) {
  const c = h && h.coordinates;
  if (!c || c.coordX == null || c.coordY == null) return null;
  const x = (c.coordX - 125.42) * 2.5, y = (198.27 - c.coordY) * 2.5;
  const D = Math.hypot(x, y) || 1;
  const ang = h.launchAngle, v = h.launchSpeed || 80;
  const ground = /ground|bunt/.test(h.trajectory || '') || (ang != null && ang <= 8);
  if (ground) return { kind: 'ground', x, y, D, dur: clamp(D / (v * 1.467 * 0.62), 0.45, 3), apex: 0, v, ev: h.launchSpeed, la: ang, total: h.totalDistance };
  const a = ang == null ? 25 : ang;
  const vz = v * 1.467 * Math.sin((a * Math.PI) / 180);
  const apex = clamp(a > 40 ? (vz * vz) / (2 * G_FT) * 0.75 : (D * Math.tan((a * Math.PI) / 180)) / 4, 6, 140);
  return { kind: 'air', x, y, D, dur: clamp(2 * Math.sqrt((2 * apex) / G_FT), 0.9, 5.5), apex, v, ev: h.launchSpeed, la: ang, total: h.totalDistance };
}
export function hitPos(hp, u) {
  u = clamp(u, 0, 1);
  if (hp.kind === 'air') return { x: hp.x * u, y: hp.y * u, z: 3 * (1 - u) + 4 * hp.apex * u * (1 - u) };
  const ue = 1 - Math.pow(1 - u, 1.7);
  const hops = clamp(Math.round(hp.D / 45), 2, 6), h0 = Math.min(3, 0.9 + hp.v / 60);
  return { x: hp.x * ue, y: hp.y * ue, z: 0.3 + Math.abs(Math.sin(Math.PI * u * hops)) * h0 * Math.pow(1 - u, 1.5) };
}

// 這個打席裡有哪些跑者要移動：路徑是經過的壘包，out 表示跑到那裡被刺殺；idx 是這次移動發生在第幾個 playEvent
export function runnerMoves(play) {
  const out = [];
  for (const r of (play && play.runners) || []) {
    const m = r.movement || {};
    const d = r.details || {};
    const id = (d.runner && d.runner.id) || null;
    const credits = (r.credits || []).map((c) => ({ cr: c.credit, pos: c.position && c.position.abbreviation }));
    const s0 = m.start || m.originBase || null;
    const s = s0 ? ORDER.indexOf(s0) : 0;
    let e;
    if (m.isOut) e = m.outBase ? (m.outBase === 'Home' ? 4 : ORDER.indexOf(m.outBase)) : -1;
    else e = m.end ? (m.end === 'score' ? 4 : ORDER.indexOf(m.end)) : -1;
    if (s < 0 || e < s) continue;
    // 打者被接殺／三振出局：他根本沒跑出去（有助殺或在一壘被刺殺才算跑）
    if (!s0 && m.isOut && !credits.some((c) => c.cr === 'f_assist' || (c.cr === 'f_putout' && c.pos === '1B'))) continue;
    if (e === s && !(m.isOut && s0)) continue; // 沒有移動（站在原地的跑者）
    out.push({ id, path: e === s ? [ORDER[s], ORDER[s]] : ORDER.slice(s, e + 1), out: !!m.isOut, batter: !s0, idx: d.playIndex, ev: d.event || '', credits, outNumber: m.outNumber || 0 });
  }
  return out;
}
const runnerPos = (path, u) => {
  const n = path.length - 1;
  const f = clamp(u, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
  const a = BASE_XY[path[i]], b = BASE_XY[path[i + 1]];
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k };
};

// 捕手後方視角的透視：鏡頭在本壘板後方 DCAM 呎、眼高 EYE 呎；單位 = 本壘板前緣處的 1 呎
export const persp = (x, y, z) => { const s = DP / (y + DCAM); return { x: x * s, y: -(z - EYE) * s, s }; };

// 全壘打牆離本壘的距離（依方向，左右外野線約 330 呎、中外野約 410 呎，與畫面上的牆一致）
export const wallR = (x, y) => { const th = Math.abs((Math.atan2(x, y) * 180) / Math.PI); return 410 - 81 * Math.pow(Math.min(th, 45) / 45, 2); };

export const WIND = 0.6; // 投手從開始動作到出手的秒數
const TR = 0.9; // 擊出後，鏡頭從捕手視角拉高、拉遠成俯視所需的秒數
const FIELD_CAM = { cx: 0, y0: -50, y1: 170, minW: 230 };
const hitCam = (hp) => {
  const top = Math.max(150, hp.y + hp.apex + 70);
  return { cx: hp.x * 0.35, y0: -60, y1: top, minW: Math.max(280, 2 * (Math.abs(hp.x) + 60)) };
};
const lerpCam = (a, b, k) => ({ cx: a.cx + (b.cx - a.cx) * k, y0: a.y0 + (b.y0 - a.y0) * k, y1: a.y1 + (b.y1 - a.y1) * k, minW: a.minW + (b.minW - a.minW) * k });

const callZh = (e) => {
  const c = ((e.details && e.details.call && e.details.call.description) || (e.details && e.details.description) || '');
  if (/swinging|foul tip/i.test(c) && !/foul$/i.test(c.trim())) return { zh: '揮空', en: 'Swinging strike', swing: true };
  if (/called strike/i.test(c)) return { zh: '好球', en: 'Called strike' };
  if (/hit by pitch/i.test(c)) return { zh: '觸身球', en: 'Hit by pitch' };
  const k = pitchCls(e);
  return { ...{ b: { zh: '壞球', en: 'Ball' }, s: { zh: '好球', en: 'Strike' }, f: { zh: '界外', en: 'Foul', swing: true }, x: { zh: '擊出', en: 'In play', swing: true } }[k] };
};

const POS = { P: [0, MOUND_Y], C: [0, -7], '1B': [72, 80], '2B': [30, 137], '3B': [-72, 80], SS: [-30, 137], LF: [-150, 250], CF: [0, 290], RF: [150, 250] };
export const FIELD_POS = POS;
const baseSpot = (b) => (b === 'Home' || b === 'H' ? [0, 0] : BASE_XY[b]);
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 守備：誰接到球、傳給誰、在哪裡刺殺。資料來自每位跑者的 credits（f_fielded_ball / f_assist / f_putout）
function fieldPlan(play, hp, tHit, tLand) {
  const runners = (play && play.runners) || [];
  const cr = (r) => (r.credits || []).map((c) => ({ cr: c.credit, pos: c.position && c.position.abbreviation })).filter((c) => POS[c.pos]);
  const outs = runners.filter((r) => r.movement && r.movement.isOut && cr(r).some((c) => c.cr === 'f_putout')).sort((a, b) => (a.movement.outNumber || 0) - (b.movement.outNumber || 0));
  let first = null;
  for (const r of runners) { const c = cr(r).find((x) => x.cr === 'f_fielded_ball'); if (c) { first = c.pos; break; } }
  if (!first && outs.length) first = cr(outs[0])[0].pos;
  if (!first) return null;
  const spot0 = [hp.x, hp.y];
  const seq = [{ pos: first, spot: spot0 }];
  const putRid = [];
  for (const r of outs) {
    const cs = cr(r).filter((c) => c.cr === 'f_assist' || c.cr === 'f_putout');
    const rid = (r.details && r.details.runner && r.details.runner.id) || null;
    const lastS = () => seq[seq.length - 1];
    cs.forEach((c, k) => {
      const put = c.cr === 'f_putout';
      if (put && cs.length === 1 && c.pos === lastS().pos) { putRid.push({ rid, at: seq.length - 1 }); return; } // 外野接殺：球就在他手上
      if (!put && k === 0 && c.pos === lastS().pos) return;
      const spot = put && r.movement.outBase ? baseSpot(r.movement.outBase) : POS[c.pos];
      if (put && c.pos === lastS().pos && dist2(spot, lastS().spot) < 1) { putRid.push({ rid, at: seq.length - 1 }); return; }
      seq.push({ pos: c.pos, spot });
      if (put) putRid.push({ rid, at: seq.length - 1 });
    });
  }
  const moves = [], legs = [], cur = {};
  const go = (pos, to, ta, tb) => { const from = cur[pos] || POS[pos]; moves.push({ pos, from, to, t0: ta, t1: tb }); cur[pos] = to; };
  go(first, spot0, tHit, tLand);
  let tc = tLand + 0.2;
  const arr = new Map();
  const when = [tLand];
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i], d = dist2(a.spot, b.spot);
    if (a.pos === b.pos) { const dur = clamp(d / 22, 0.3, 1.4); legs.push({ kind: 'carry', t0: tc, t1: tc + dur, from: a.spot, to: b.spot }); go(b.pos, b.spot, tc, tc + dur); tc += dur + 0.1; }
    else { const dur = clamp(d / 120, 0.35, 0.8); legs.push({ kind: 'throw', t0: tc, t1: tc + dur, from: a.spot, to: b.spot }); go(b.pos, b.spot, tHit + 0.1, tc + dur - 0.05); tc += dur + 0.12; }
    when[i] = legs[legs.length - 1].t1;
  }
  putRid.forEach((p) => arr.set(p.rid, when[p.at]));
  return { moves, legs, arrive: arr, end: tc };
}

// 手肘：肩到手之間用兩節手臂（各約 1.05 呎）夾出來，手肘朝下
function elbowOf(S, H, down) {
  const dx = H.x - S.x, dz = H.z - S.z, d = Math.hypot(dx, dz) || 1e-6, L = 1.05;
  const h = Math.sqrt(Math.max(0.02, L * L - (d / 2) * (d / 2)));
  let nx = -dz / d, nz = dx / d;
  if (nz * down > 0) { nx = -nx; nz = -nz; } // 讓手肘往下掉
  return { x: (S.x + H.x) / 2 + nx * h, z: (S.z + H.z) / 2 + nz * h };
}

// 投手的投球動作（單位：呎，x 以投手丘中心為 0、投球手那一側 hand=±1 為正，z 向上）。
// ph：-1 準備（站在投手板）→ -0.35 抬腿蓄力完成 → 0 出手 → 0.8 收尾
export function pitcherPose(ph, hand) {
  const p = clamp(ph, -1, 1);
  const wind = ease(clamp((p + 1) / 0.65, 0, 1)), strd = ease(clamp((p + 0.35) / 0.35, 0, 1)), fol = ease(clamp(p / 0.8, 0, 1));
  const lift = wind * (1 - strd);
  const hOpen = ease(clamp((p + 0.55) / 0.55, 0, 1)), sOpen = ease(clamp((p + 0.4) / 0.4, 0, 1)); // 髖先打開、肩膀慢一點，出手時胸口正對本壘
  // 手與手套的路徑（x, z, y）：y 是往本壘方向走了幾呎。投球手：胸前 → 往後舉到高處 → 出手 → 收尾橫過身體
  const path = (A, B, C, D) => {
    const m = p < -0.35 ? [A, B, wind] : p < 0 ? [B, C, strd] : [C, D, fol];
    return { x: m[0].x + (m[1].x - m[0].x) * m[2], z: m[0].z + (m[1].z - m[0].z) * m[2], y: m[0].y + (m[1].y - m[0].y) * m[2] };
  };
  const hand1 = path({ x: hand * 0.25, z: 4.3, y: 0 }, { x: hand * 1.9, z: 5.5, y: -0.6 }, { x: hand * 1.0, z: 6.7, y: 3.6 }, { x: -hand * 0.9, z: 3.1, y: 4.6 });
  const glove = path({ x: -hand * 0.25, z: 4.3, y: 0 }, { x: -hand * 0.7, z: 5.0, y: 1.2 }, { x: -hand * 1.0, z: 4.4, y: 2.2 }, { x: -hand * 0.4, z: 3.5, y: 1.2 });
  const hip = { x: 0, z: 3.0 - 0.45 * strd - 0.25 * fol, y: 3.0 * strd + 0.5 * fol }; // 跨步時身體往本壘移動
  const sh = { x: -hand * 0.1 * lift + hand * 0.15 * fol, z: 4.9 - 0.5 * strd - 0.6 * fol, y: hip.y + 0.5 * strd };
  const ws = 0.35 + 0.45 * sOpen, wh = 0.3 + 0.3 * hOpen;
  const el = (side, hnd) => { const e = elbowOf({ x: sh.x + side * ws * 0.6, z: sh.z - 0.1 }, hnd, 1); e.y = (sh.y + hnd.y) / 2; return e; };
  return {
    hip, sh, ws, wh, head: { x: sh.x * 0.6, z: sh.z + 0.9, y: sh.y + 0.3 }, handF: hand1, handB: glove,
    elbowF: el(hand, hand1), elbowB: el(-hand, glove),
    footB: { x: hand * 0.45, z: 0.35 * fol, y: 1.3 * fol }, // 後腳留在投手板上，出手後才被帶上來、腳跟抬起
    footF: { x: -hand * (0.45 + 0.4 * strd), z: lift * 2.2, y: 6.0 * strd }, // 前腳抬起後往本壘跨出約 6 呎
    kneeB: { x: hand * 0.35, z: 1.5 - 0.3 * fol, y: 0.5 * hip.y }, kneeF: { x: -hand * (0.5 + 0.2 * strd), z: 1.6 + lift * 1.5, y: 3.4 * strd + 0.4 * lift },
  };
}

// 用幾個關鍵點組出完整的人形姿勢：膝蓋取髖與腳的中點再往前一點，手肘由肩與手算出來
function rig({ hip, sh, head, footF, footB, handF, handB, ws = 0.7, wh = 0.5, knee = 0.3 }) {
  const kn = (f, k) => ({ x: (hip.x + f.x) / 2 + k, z: (hip.z + f.z) / 2 });
  return {
    hip, sh, head, ws, wh, footF, footB, handF, handB, kneeF: kn(footF, knee), kneeB: kn(footB, -knee * 0.3),
    elbowF: elbowOf({ x: sh.x + ws * 0.6, z: sh.z - 0.1 }, handF, 1), elbowB: elbowOf({ x: sh.x - ws * 0.6, z: sh.z - 0.1 }, handB, 1),
  };
}
// 野手的準備姿勢（微蹲、雙手放在膝蓋上方）、跑步（ph 是跑步的相位，雙腿與雙臂反向擺動）、捕手蹲下
export const standPose = () => rig({ hip: { x: 0, z: 2.75 }, sh: { x: 0.05, z: 4.45 }, head: { x: 0.1, z: 5.3 }, footF: { x: 0.45, z: 0 }, footB: { x: -0.45, z: 0 }, handF: { x: 0.5, z: 3.2 }, handB: { x: -0.5, z: 3.2 }, knee: 0.25 });
export function runPose(ph) {
  const a = Math.sin(ph), b = Math.cos(ph);
  return rig({
    hip: { x: 0, z: 2.95 + 0.08 * Math.abs(b) }, sh: { x: 0.1, z: 4.85 }, head: { x: 0.2, z: 5.75 },
    footF: { x: 0.95 * a, z: Math.max(0, 0.9 * b) }, footB: { x: -0.95 * a, z: Math.max(0, -0.9 * b) },
    handF: { x: -0.9 * a, z: 3.9 + 0.3 * b }, handB: { x: 0.9 * a, z: 3.9 - 0.3 * b }, knee: 0.4,
  });
}
export const crouchPose = () => rig({ hip: { x: 0, z: 1.7 }, sh: { x: 0.05, z: 3.2 }, head: { x: 0.1, z: 3.95 }, footF: { x: 0.65, z: 0 }, footB: { x: -0.65, z: 0 }, handF: { x: 0.35, z: 2.3 }, handB: { x: -0.35, z: 2.3 }, ws: 0.75, wh: 0.6, knee: 0.7 });

// 打者的姿勢（單位：呎，x 以打者站的位置為 0、朝本壘為正，z 向上）。
// load 0~1：舉棒蓄力＋跨步；k 0~1：揮棒進度（0.5 = 球棒到達球的位置）；type：contact / foul / whiff / take；z：球過本壘的高度
export function batPose(load, k, type, z) {
  const swing = type !== 'take';
  const kk = swing ? k : 0;
  const ld = load;
  // 揮棒的順序：先是髖部帶頭轉（rH），肩膀慢一點跟上（rS），球棒落後手一截再甩過去（sB 前慢後快），碰到球（k=0.5）後收棒繞過肩膀（f2）
  const rH = ease(clamp(kk / 0.45, 0, 1)), rS = ease(clamp((kk - 0.08) / 0.5, 0, 1));
  const sB = Math.pow(ease(clamp(kk / 0.5, 0, 1)), 1.4), f2 = ease(clamp((kk - 0.5) / 0.5, 0, 1));
  const sw1 = ease(clamp(kk / 0.5, 0, 1));
  const zc = clamp(z == null ? 2.6 : z, 1.7, 4.6);
  const zHit = type === 'whiff' ? zc + (zc > 2.7 ? -0.9 : 0.9) : zc; // 揮空：棒子從球的下方（或上方）掃過
  const base = -100 - 15 * ld;
  const th = base * (1 - sB) + 110 * f2 + (type === 'foul' ? 10 * sB : 0); // 球棒角度：-90 = 朝上，0 = 水平朝本壘，收棒時繞到身體另一側
  const pre = 0.35 - 0.6 * ld;
  const hands = {
    x: pre + (0.7 - pre) * sw1 - 0.8 * f2,
    z: (4.6 + 0.3 * ld) + (zHit + 0.1 - (4.6 + 0.3 * ld)) * sw1 + 0.75 * f2,
  };
  if (!swing) { hands.x = 0.15 - 0.45 * ld; hands.z = 4.6 + 0.3 * ld; }
  const rad = (th * Math.PI) / 180, L = 2.8;
  const tip = { x: hands.x + L * Math.cos(rad), z: hands.z - L * Math.sin(rad) };
  const phiS = swing ? rS * 70 + f2 * 35 : 0, phiH = swing ? rH * 75 + f2 * 30 : 0; // 肩、髖的轉動
  const ws = 0.15 + 0.75 * Math.abs(Math.cos((phiS * Math.PI) / 180));
  const wh = 0.15 + 0.55 * Math.abs(Math.cos(((phiH * 0.7) * Math.PI) / 180));
  const lean = -0.25 * ld + 0.3 * rH - 0.2 * f2 + (type === 'whiff' ? 0.4 * f2 : 0); // 揮空：重心被帶出去
  const dip = type === 'whiff' ? 0.45 * f2 : 0;
  const hip = { x: 0.35 * rH, z: 3.0 }; // 重心從後腳移到前腳
  const sh = { x: hip.x * 0.6 + lean * 0.25, z: 4.9 - dip };
  const el = (side) => elbowOf({ x: sh.x + side * ws * 0.6, z: 4.8 - dip }, hands, 1);
  const stride = 0.45 + 0.55 * ld + 0.2 * rH;
  return {
    hands, tip, ws, wh, hip, sh, handF: hands, handB: hands, elbowF: el(1), elbowB: el(-1),
    head: { x: lean * 0.25 + 0.08 * rH, z: 5.8 - dip - 0.2 * rH }, // 頭盡量不動、眼睛盯著球
    kneeF: { x: stride * 0.5 + 0.35, z: 1.6 }, kneeB: { x: -0.35 + 0.3 * rH, z: 1.5 - dip * 0.4 },
    footF: { x: stride, z: 0.5 * ld * (1 - clamp(kk / 0.12, 0, 1)) }, // 蓄力時前腳稍微抬起，出棒時踩下
    footB: { x: -0.55 - 0.15 * rH, z: 0.3 * rH }, // 後腳以前腳掌為軸，腳跟離地
    tipZ: tip.z,
  };
}

// 把一個打席排成時間表（秒）。prev 是同一個半局的上一個打席（用來知道一開始壘上有誰）。
// 回傳的東西只有資料，frameAt 依時間算出每一格的畫面狀態
export function buildScript(play, prev) {
  const evAll = ((play && play.playEvents) || []).filter(Boolean);
  const segs = [], caps = [], zone = [], evcaps = [], ents = new Map();
  let t = 0.7, hitStart = null, hitDur = 0, hrCross = null, zTop = null, zBot = null, endT = 0, plan = null;
  const isHR = !!(play && play.result && play.result.event === 'Home Run');
  const idxOf = (e, k) => (e.index != null ? e.index : k);
  const idxSet = new Set(evAll.map(idxOf));
  const lastPitch = [...evAll].reverse().find((e) => e.isPitch);
  const lastPitchIx = lastPitch ? idxOf(lastPitch, evAll.indexOf(lastPitch)) : null;
  const moves = runnerMoves(play).map((m) => ({ ...m, idx: idxSet.has(m.idx) ? m.idx : lastPitchIx }));
  // 一開始壘上的跑者（上一個打席結束時的狀態）
  const sameHalf = prev && prev.about && play && play.about && prev.about.inning === play.about.inning && prev.about.halfInning === play.about.halfInning;
  const pm = (sameHalf && prev.matchup) || {};
  [['1B', pm.postOnFirst], ['2B', pm.postOnSecond], ['3B', pm.postOnThird]].forEach(([base, p]) => { if (p && p.id) ents.set(p.id, { id: p.id, base, moves: [] }); });
  const addMove = (m, t0, dur) => {
    let ent = ents.get(m.id);
    if (!ent) {
      const b0 = m.path[0];
      if (b0 !== 'H') for (const [k, v] of ents) if (v.base === b0 && !v.moves.length) ents.delete(k); // 代跑換人：舊的那個不留
      ent = { id: m.id, base: b0 === 'H' ? null : b0, moves: [] }; ents.set(m.id != null ? m.id : 'm' + ents.size, ent);
    }
    ent.moves.push({ path: m.path, t0, dur, out: m.out, scored: m.path[m.path.length - 1] === 'H' && m.path.length > 1 });
    endT = Math.max(endT, t0 + dur);
  };
  const dur0 = (m) => Math.max(0.9, (m.path.length - 1) * 0.65);
  // 不是擊出球的跑者移動（盜壘、牽制、保送、暴投…）：切到球場畫面，跑者跑完再回去
  const playSeg = (ms, label) => {
    const d = ms.reduce((mx, m) => Math.max(mx, dur0(m)), 0);
    const t0 = t;
    segs.push({ kind: 'play', t0, t1: t0 + d + 0.6, cam0: FIELD_CAM, cam1: FIELD_CAM, ct0: t0, ct1: t0 + 1, until: t0 + d + 0.9 });
    ms.forEach((m) => addMove(m, t0 + 0.3, dur0(m)));
    if (label) evcaps.push({ t0, t1: t0 + d + 0.9, text: label });
    t = t0 + d + 1.2;
  };
  evAll.forEach((e, k) => {
    const ix = idxOf(e, k);
    const ms = moves.filter((m) => m.idx === ix);
    if (!e.isPitch) {
      if (ms.length) playSeg(ms, evZh(e.details && e.details.event) || (e.details && e.details.description) || '');
      return;
    }
    const pp = pitchPath(e.pitchData);
    const dp = pp ? clamp(pp.dur * 3.3, 1.1, 2.1) : 0.9;
    const prevCount = caps.length ? caps[caps.length - 1].count : { balls: 0, strikes: 0 };
    const pc = pitchCls(e), pd = e.pitchData || {};
    if (zTop == null && pd.strikeZoneTop) { zTop = pd.strikeZoneTop; zBot = pd.strikeZoneBottom; }
    const call = callZh(e);
    caps.push({ t0: t, t1: t + dp, n: caps.length + 1, code: (e.details && e.details.type && e.details.type.code) || '', name: (e.details && e.details.type && e.details.type.description) || '', speed: pd.startSpeed, ev: e.hitData && e.hitData.launchSpeed, pz: pd.coordinates && pd.coordinates.pZ, call, swing: !!call.swing, cls: pc, count: e.count, prevCount });
    segs.push({ kind: 'pitch', t0: t, t1: t + dp, pp, cls: pc, code: caps[caps.length - 1].code });
    const co = pd.coordinates;
    if (co && co.pX != null && co.pZ != null) zone.push({ t: t + dp, x: co.pX, z: co.pZ, cls: pc, code: caps[caps.length - 1].code });
    t += dp;
    const last = ix === lastPitchIx;
    const hp = hitPlan(e.hitData);
    if (hp) {
      t += 0.35; // 打擊瞬間停一下，讓人看到球在好球帶的位置
      const hr = last && isHR, inPlay = pc === 'x';
      const seg = { kind: 'hit', t0: t, t1: t + hp.dur, hp, foul: pc === 'f', hr, cam0: hitCam(hp), cam1: hitCam(hp), ct0: t, ct1: t + 1, until: last ? Infinity : t + hp.dur + 0.5, legs: null, start: co && co.pX != null ? { x: co.pX, z: co.pZ } : null };
      if (hr) { // 全壘打：球飛出牆外時鏡頭追著球走，並在過牆瞬間放火花
        const u = clamp(wallR(hp.x, hp.y) / hp.D, 0.2, 1);
        seg.cam1 = { cx: hp.x, y0: Math.max(-60, hp.y - 170), y1: hp.y + 170, minW: 320 };
        seg.ct0 = t + Math.max(hp.dur * 0.15, TR + 0.1); seg.ct1 = t + hp.dur * 0.8;
        hrCross = t + hp.dur * u;
        seg.cross = { t: hrCross, x: hp.x * u, y: hp.y * u };
      }
      let extra = 0;
      if (inPlay && !hr && last) {
        plan = fieldPlan(play, hp, t, t + hp.dur);
        if (plan) { seg.legs = plan.legs; seg.fieldMoves = plan.moves; seg.until = Infinity; extra = plan.end - (t + hp.dur); }
      }
      segs.push(seg);
      if (inPlay) ms.forEach((m) => {
        const natural = dur0(m);
        const arrive = plan && plan.arrive.get(m.id);
        addMove(m, t + 0.15, arrive ? Math.max(natural, arrive - (t + 0.15) + 0.1) : natural);
      });
      if (last) { hitStart = t; hitDur = hp.dur + Math.max(0, extra); }
      t += hp.dur + 0.5 + Math.max(0, extra);
      if (!last) t += 0.8;
      if (!inPlay && ms.length) playSeg(ms, evZh((ms[0] && ms[0].ev) || (play.result && play.result.event)));
    } else {
      t += 0.7;
      if (ms.length) playSeg(ms, evZh((ms[0] && ms[0].ev) || (last && play.result && play.result.event)));
    }
  });
  const rt0 = hitStart != null ? hitStart + 0.15 : t;
  const contactEnd = hitStart != null ? hitStart + hitDur : t;
  const bannerT = hrCross != null ? hrCross : hitStart != null ? Math.max(contactEnd - 0.2, Math.min(endT, rt0 + 0.6)) : t;
  const total = Math.max(t, endT, bannerT) + 1.8;
  return { segs, caps, evcaps, zone, ents: [...ents.values()], bannerT, total, hr: isHR && hrCross != null, zTop: zTop || 3.4, zBot: zBot || 1.6 };
}

const entPos = (ent, t) => {
  // 還沒開始跑：站在原本的壘包（打者在移動前不顯示）
  let cur = ent.base ? { ...{ x: BASE_XY[ent.base][0], y: BASE_XY[ent.base][1] } } : null;
  let gone = false, moving = false;
  for (const mv of ent.moves) {
    if (t < mv.t0) { if (!cur) { const b = BASE_XY[mv.path[0]]; if (mv.path[0] !== 'H') cur = { x: b[0], y: b[1] }; } break; }
    const u = (t - mv.t0) / mv.dur;
    cur = runnerPos(mv.path, u);
    gone = (mv.out || mv.scored) && u >= 1;
    moving = u > 0 && u < 1;
  }
  return cur && !gone ? { ...cur, moving } : null;
};

const hitAt = (s, u) => { const p = hitPos(s.hp, u); if (s.start) { p.x += s.start.x * (1 - u); p.z += (s.start.z - 3) * (1 - u); } return p; }; // 從球實際過本壘的位置接續

// 在時間 t 的畫面狀態；scene 是 'pitch'（捕手後方視角）或 'field'（球場俯視）
export function frameAt(sc, t) {
  let hs = null;
  for (const s of sc.segs) if ((s.kind === 'hit' || s.kind === 'play') && t >= s.t0 && t <= s.until) hs = s;
  const isHit = !!hs && hs.kind === 'hit';
  const m = isHit ? clamp((t - hs.t0) / TR, 0, 1) : 0;
  const scene = hs && !(isHit && t < hs.t0 + TR) ? 'field' : 'pitch';
  const cam = hs ? lerpCam(hs.cam0, hs.cam1, ease(clamp((t - hs.ct0) / (hs.ct1 - hs.ct0), 0, 1))) : null;
  let ball = null, trail = null, trailCls = '', trail2 = null, fm = null;
  for (let i = 0; i < sc.segs.length; i++) {
    const s = sc.segs[i];
    if (t < s.t0) break;
    const u = clamp((t - s.t0) / (s.t1 - s.t0), 0, 1);
    if (s.kind === 'pitch' && s.pp) {
      const pts = s.pp.pts, f = u * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f));
      const a = pts[k], b = pts[k + 1], w = f - k;
      const next = sc.segs[i + 1];
      const stillHere = t < s.t1 || (!(next && next.kind === 'hit') && t < s.t1 + 0.55);
      if (stillHere || (next && next.kind === 'hit' && t < next.t0)) { ball = { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w }; trail = pts.slice(0, k + 1).concat([ball]); trailCls = s.code; }
    } else if (s.kind === 'hit') {
      const n = 24, list = [];
      for (let j = 0; j <= Math.round(u * n); j++) list.push(hitAt(s, j / n));
      ball = hitAt(s, u); trail = list.concat([ball]); trailCls = s.hr ? 'hr' : s.foul ? 'foul' : 'hit';
      if (s.legs && t > s.t1) { // 野手接到球之後的傳球
        let p = { x: s.hp.x, y: s.hp.y, z: 0.5 };
        for (const lg of s.legs) {
          if (t < lg.t0) break;
          const k = clamp((t - lg.t0) / (lg.t1 - lg.t0), 0, 1), arc = lg.kind === 'throw' ? 4 * k * (1 - k) * Math.min(14, dist2(lg.from, lg.to) / 8) : 0;
          p = { x: lg.from[0] + (lg.to[0] - lg.from[0]) * k, y: lg.from[1] + (lg.to[1] - lg.from[1]) * k, z: 3 + arc };
          if (lg.kind === 'throw') trail2 = [{ x: lg.from[0], y: lg.from[1], z: 3 }, p];
        }
        ball = p;
      }
      if (s.fieldMoves) fm = s.fieldMoves;
    }
  }
  let cap = null;
  for (const c of sc.caps) if (t >= c.t0) cap = { ...c, done: t >= c.t1 };
  let evcap = null;
  for (const c of sc.evcaps) if (t >= c.t0 && t <= c.t1) evcap = c.text;
  const zone = sc.zone.filter((z) => t >= z.t);
  const lastZ = zone[zone.length - 1];
  const impact = lastZ && t - lastZ.t < 0.9 ? { x: lastZ.x, z: lastZ.z, cls: lastZ.cls, k: (t - lastZ.t) / 0.9 } : null;
  // 打者：先舉棒蓄力，球快到時揮棒（0.5 = 球棒碰到球的位置），不揮的球只做蓄力動作
  let bat = { load: 0, k: 0, type: 'take', z: 2.6 };
  if (cap) {
    const type = !cap.swing ? 'take' : cap.call.zh === '揮空' ? 'whiff' : cap.cls === 'f' ? 'foul' : 'contact';
    bat = { load: type === 'take' ? 0.6 * Math.sin(Math.PI * clamp((t - (cap.t1 - 0.6)) / 0.7, 0, 1)) : clamp((t - (cap.t1 - 0.6)) / 0.35, 0, 1), k: type === 'take' ? 0 : clamp((t - (cap.t1 - 0.25)) / 0.5, 0, 1), type, z: cap.pz };
  }
  const runners = sc.ents.map((e) => { const p = entPos(e, t); return p ? { ...p, batter: !e.base && e.moves[0] && e.moves[0].path[0] === 'H' } : null; }).filter(Boolean);
  // 野手：預設站位，有任務的在時間內移動；act 表示正在動
  const fielders = Object.keys(POS).map((pos) => {
    let p = POS[pos], act = false;
    for (const m of (fm || []).filter((x) => x.pos === pos)) {
      if (t >= m.t1) p = m.to;
      else if (t > m.t0) { const k = ease((t - m.t0) / (m.t1 - m.t0)); p = [m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k]; act = true; break; }
      else break;
    }
    return { pos, x: p[0], y: p[1], act };
  });
  let hud = null;
  if (hs && hs.kind === 'hit') {
    const hp = hs.hp, u = clamp((t - hs.t0) / (hs.t1 - hs.t0), 0, 1);
    const g = Math.hypot((ball && ball.x) || 0, (ball && ball.y) || 0);
    const total = hp.total != null ? hp.total : Math.round(hp.D);
    hud = { ev: hp.ev, la: hp.la, total, dist: Math.round(total * (hs.legs && t > hs.t1 ? 1 : clamp(g / hp.D, 0, 1))), hang: +(u * hp.dur).toFixed(1), air: hp.kind === 'air', foul: hs.foul };
  }
  const cr = hs && hs.cross;
  const fx = cr && t >= cr.t && t - cr.t < 1.5 ? { x: cr.x, y: cr.y, k: (t - cr.t) / 1.5 } : null;
  // 球棒碰到球的瞬間（擊出或界外）：火花、畫面震動、閃光；力道依擊球初速
  let contact = null;
  if (cap && cap.swing && (cap.cls === 'x' || cap.cls === 'f') && t >= cap.t1 && t - cap.t1 < 0.45) {
    const z = sc.zone.find((q) => q.t === cap.t1);
    contact = { k: (t - cap.t1) / 0.45, x: z ? z.x : 0, z: z ? z.z : 2.6, strength: clamp(((cap.ev || 85) - 60) / 50, 0.25, 1) * (cap.cls === 'f' ? 0.6 : 1), foul: cap.cls === 'f' };
  }
  // 投手動作：每球出手前 0.6 秒開始（抬腿、跨步、揮臂），出手那一刻球從手上飛出，之後 0.45 秒收尾
  let pit = -1;
  for (const c of sc.caps) { if (t >= c.t0 - WIND && t <= c.t0 + 0.45) { pit = (t - c.t0) / WIND; break; } }
  const land = isHit ? { x: hs.hp.x, y: hs.hp.y, u: clamp((t - hs.t0) / (hs.t1 - hs.t0), 0, 1.5), foul: hs.foul, hr: hs.hr, air: hs.hp.kind === 'air' } : null; // 落點標記（遊戲裡球飛行時地面上的圓圈）
  return { t, pit, land, contact, scene, m, endCam: isHit ? hs.cam0 : null, cam, ball, trail, trailCls, trail2, cap, evcap, zone, impact, bat, hud, runners, fielders, fx, banner: t >= sc.bannerT, hr: sc.hr };
}

// 電視轉播的比分條：比分、局數、出局數、壘上有人、目前球數。
// 打席進行中顯示打席開始前的狀態，結果出來（banner）之後換成打席結束後的狀態（得分、出局數會跳動）
export function scorebug(play, prev, f) {
  const r = (play && play.result) || {}, pr = (prev && prev.result) || {};
  const pre = [pr.awayScore != null ? pr.awayScore : 0, pr.homeScore != null ? pr.homeScore : 0];
  const post = [r.awayScore != null ? r.awayScore : pre[0], r.homeScore != null ? r.homeScore : pre[1]];
  const made = ((play && play.runners) || []).filter((x) => x.movement && x.movement.isOut).length;
  const outsPost = clamp((play && play.count && play.count.outs) || 0, 0, 3);
  const outsPre = clamp(outsPost - made, 0, 2);
  const done = !!f.banner;
  const sc = done ? post : pre;
  const cap = f.cap;
  const cnt = cap ? (cap.done ? cap.count : cap.prevCount) : null;
  const near = (b) => f.runners.some((q) => Math.hypot(q.x - BASE_XY[b][0], q.y - BASE_XY[b][1]) < 9);
  return {
    away: sc[0], home: sc[1], scored: done && (post[0] !== pre[0] || post[1] !== pre[1]),
    outs: done ? Math.min(outsPost, 3) : outsPre,
    inning: (play && play.about && play.about.inning) || 0, half: play && play.about && play.about.halfInning === 'bottom' ? 'bottom' : 'top',
    balls: cnt ? cnt.balls : 0, strikes: cnt ? cnt.strikes : 0,
    bases: [near('1B'), near('2B'), near('3B')],
  };
}
