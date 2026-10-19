/* 打擊動畫的攝影機：一台針孔攝影機。投球階段像棒球遊戲，從「投手背後、高處」望遠看向打者；擊出後一邊升高、一邊繞到本壘後方，
 * 最後拉遠成「球場俯視」，與 2D 球場畫面對上。
 * 座標：x 往一壘為正、y 離本壘越遠越大、z 向上，單位呎。畫面座標：x ∈ [-1,1]，y 往下，高度 = 2 / 寬高比。 */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, k) => a + (b - a) * k;
const ease = (u) => u * u * (3 - 2 * u);

export const DCAM = 6, EYE = 3, PLATE_Y = 17 / 12; // 舊的「捕手後方」視角常數，persp() 與測試還在用
export const DP = DCAM + PLATE_Y;
// 起點（投手背後）：鏡頭在本壘後方 130 呎（投手板後面約 70 呎）、高約 25 呎，望遠（F 大）看向打者胸口，視線從投手頭上越過
export const START = { d: 112, alpha: 0.16, F: 11.5, tz: 3.6, shift: 0.55 };
const D1 = 8000; // 終點：拉到很遠、近似正交的俯視
const ALPHA1 = Math.PI / 4; // 終點的俯角 45°，配合 2D 球場畫面的「往上偏移」畫法

// end：2D 球場畫面的視野 { cx, cy, wv }（cx、cy 是畫面中心對應的地面位置，wv 是畫面寬度的呎數）
export function camAt(m, a, end) {
  const k = ease(clamp(m, 0, 1));
  const F1 = (2 * D1) / end.wv;
  const d = Math.exp(mix(Math.log(START.d), Math.log(D1), k));
  const F = Math.exp(mix(Math.log(START.F), Math.log(F1), k));
  const al = mix(START.alpha, ALPHA1, Math.sqrt(k)); // 先快速俯下來，像升降機
  const yaw = Math.PI * (1 - ease(clamp(k * 1.12, 0, 1))); // 方位角：π＝從投手背後看向本壘，0＝從本壘後方看向外野；提早一點轉完
  const kt = k * k; // 目標點晚一點才移向球場中央，前半段一直盯著本壘附近
  const T = [mix(0, end.cx, kt), mix(0, end.cy, kt), mix(START.tz, 0, k)];
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sa = Math.sin(al), ca = Math.cos(al);
  const f = [sy * ca, cy * ca, -sa], up = [sy * sa, cy * sa, ca], right = [cy, -sy, 0];
  return { P: [T[0] - d * f[0], T[1] - d * f[1], T[2] - d * f[2]], f, up, right, F, v: mix(1, Math.SQRT2, k), shift: START.shift * (1 - k), k, yaw };
}

const EPS = 0.3;
const view = (c, p) => { const r = [p[0] - c.P[0], p[1] - c.P[1], p[2] - c.P[2]]; return [r[0] * c.right[0] + r[1] * c.right[1], r[0] * c.up[0] + r[1] * c.up[1] + r[2] * c.up[2], r[0] * c.f[0] + r[1] * c.f[1] + r[2] * c.f[2]]; };
const toScreen = (c, q) => ({ x: (c.F * q[0]) / q[2], y: (-c.F * q[1] * c.v) / q[2] - c.shift, d: q[2] });
export function project(c, p) { const q = view(c, p); return q[2] > EPS ? toScreen(c, q) : null; }

// 多邊形／折線對近平面裁切（Sutherland–Hodgman），回傳畫面座標點陣列
export function projectPoly(c, pts, closed = true) {
  const q = pts.map((p) => view(c, p)), out = [];
  const n = q.length, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = q[i], b = q[(i + 1) % n], ina = a[2] > EPS, inb = b[2] > EPS;
    if (ina) out.push(a);
    if (ina !== inb) { const s = (EPS - a[2]) / (b[2] - a[2]); out.push([mix(a[0], b[0], s), mix(a[1], b[1], s), EPS]); }
  }
  if (!closed && q.length && q[q.length - 1][2] > EPS) out.push(q[q.length - 1]);
  return out.map((p) => toScreen(c, p));
}

// 球場配色（3D 場景與 2D 球場畫面共用，交接時才對得上）：高飽和的遊戲風格
export const PAL = { grassA: '#3fae52', grassB: '#4cc060', dirt: '#e0ae6e', mound: '#cf9a58', stands: '#4a4592', standsTop: '#6d63c9', wall: '#1d7a3c', wallTop: '#ffd84d', line: '#ffffff', sky0: '#52b8ff', sky1: '#cdeeff' };

// 球場地面（z = 0）的形狀。y 一律 ≥ -4（起點鏡頭在投手背後，本壘後方不需要畫）
const arc = (a, ctrl, b, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return [(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * ctrl[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * ctrl[1] + u * u * b[1]]; });
const circle = (cx, cy, r, n = 40) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return [cx + Math.cos(t) * r, Math.max(-4, cy + Math.sin(t) * r)]; });
const RIGHT_WALL = arc([233, 233], [205, 405], [0, 410]);
export const WALL = [...arc([-233, 233], [-205, 405], [0, 410]), ...RIGHT_WALL.slice(1)];
const sq = (cx, cy, h) => [[cx, cy - h], [cx + h, cy], [cx, cy + h], [cx - h, cy]];
// 距離本壘 y 處，界內區域左右各延伸多遠（界外線 45° 到 233 呎，之後是外野牆的弧線）
export const halfWidth = (y) => {
  if (y <= 233) return Math.max(0, y);
  const pts = RIGHT_WALL; // y 由 233 增加到 410
  for (let i = 1; i < pts.length; i++) if (y <= pts[i][1]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], u = (y - y0) / (y1 - y0 || 1); return x0 + (x1 - x0) * u; }
  return 0;
};
// 外野草皮的割草條紋：每 17 呎一條，深淺交錯
const STRIPES = Array.from({ length: 24 }, (_, i) => i).filter((i) => i * 17 < 405 && i % 2 === 0).map((i) => {
  const y0 = Math.max(4, i * 17), y1 = Math.min(409, (i + 1) * 17), h0 = halfWidth(y0), h1 = halfWidth(y1);
  return { poly: [[-h0, y0], [h0, y0], [h1, y1], [-h1, y1]], fill: PAL.grassB };
});
// 外野牆：立起來的牆面（z 0~8 呎）與牆頂的黃線；轉場拉成俯視後牆面淡出，以免跟 2D 畫面對不上
const WALL_FACE = WALL.slice(0, -1).map((p, i) => ({ face: [[p[0], p[1], 0], [WALL[i + 1][0], WALL[i + 1][1], 0], [WALL[i + 1][0], WALL[i + 1][1], 8], [p[0], p[1], 8]], fill: i % 2 ? PAL.wall : '#238a46' }));
export const GROUND = [
  { poly: [[-4000, -4], [4000, -4], [4000, 6000], [-4000, 6000]], fill: PAL.grassA },
  { poly: [[-4000, 233], ...WALL, [4000, 233], [4000, 6000], [-4000, 6000]], fill: PAL.stands, crowd: true },
  { poly: [[0, -4], [-233, 233], ...WALL.slice(1, -1), [233, 233]], fill: PAL.grassA },
  ...STRIPES,
  { poly: circle(0, 60.5, 95), fill: PAL.dirt },
  { poly: [[0, 17], [-49, 63.6], [0, 112], [49, 63.6]], fill: PAL.grassB },
  { poly: circle(0, 0, 14), fill: PAL.dirt },
  { poly: circle(0, 60.5, 9), fill: PAL.mound },
  ...WALL_FACE,
  { line: WALL, stroke: PAL.wallTop, sw: 3.5 },
  { line: [[0, 0], [-290, 290]], stroke: PAL.line, sw: 2 }, { line: [[0, 0], [290, 290]], stroke: PAL.line, sw: 2 },
  { poly: [[0, 0], [63.6, 63.6], [0, 127.3], [-63.6, 63.6]], stroke: PAL.line, sw: 1.4, op: 0.75 },
  { poly: [[-5.8, -3], [-1.8, -3], [-1.8, 3], [-5.8, 3]], stroke: PAL.line, sw: 1.6 }, { poly: [[1.8, -3], [5.8, -3], [5.8, 3], [1.8, 3]], stroke: PAL.line, sw: 1.6 },
  { poly: [[-0.708, PLATE_Y], [0.708, PLATE_Y], [0.708, 0.7], [0, 0], [-0.708, 0.7]], fill: '#fffdf5' },
  { poly: sq(63.6, 63.6, 2.8), fill: '#fff' }, { poly: sq(0, 127.3, 2.8), fill: '#fff' }, { poly: sq(-63.6, 63.6, 2.8), fill: '#fff' },
].map((g) => (g.face ? { ...g, pts: g.face, closed: true, wallFace: true } : { ...g, pts: (g.poly || g.line).map(([x, y]) => [x, y, 0]), closed: !!g.poly }));
