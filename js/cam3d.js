/* 球場的幾何與配色（GROUND：地面上的形狀；WALL：外野牆線）。3D 舞台（anim-3d.js）拿它畫場地貼圖與外野牆。
 * 座標：x 往一壘為正、y 離本壘越遠越大、z 向上，單位呎。 */

export const DCAM = 6, EYE = 3, PLATE_Y = 17 / 12; // 舊的「捕手後方」視角常數，persp() 與測試還在用
export const DP = DCAM + PLATE_Y;
// 球場配色（3D 場景與 2D 球場畫面共用，交接時才對得上）：高飽和的遊戲風格
export const PAL = { grassA: '#44b653', grassB: '#57ca65', dirt: '#e5b17a', mound: '#d49c60', stands: '#3b3d9e', standsTop: '#5a5fd0', wall: '#2f9e57', wallTop: '#fff0a0', line: '#ffffff', sky0: '#52b8ff', sky1: '#cdeeff' };

// 球場地面（z = 0）的形狀
const arc = (a, ctrl, b, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return [(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * ctrl[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * ctrl[1] + u * u * b[1]]; });
const circle = (cx, cy, r, n = 40) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return [cx + Math.cos(t) * r, cy + Math.sin(t) * r]; });
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
const WALL_FACE = WALL.slice(0, -1).map((p, i) => ({ face: [[p[0], p[1], 0], [WALL[i + 1][0], WALL[i + 1][1], 0], [WALL[i + 1][0], WALL[i + 1][1], 8], [p[0], p[1], 8]], fill: ['#e8505b', '#3f8efc', '#ffd43b', '#51cf66'][i % 4] }));
export const GROUND = [
  { poly: [[-4000, -400], [4000, -400], [4000, 6000], [-4000, 6000]], fill: PAL.grassA },
  { poly: [[-4000, 233], ...WALL, [4000, 233], [4000, 6000], [-4000, 6000]], fill: PAL.stands },
  { poly: [[0, 0], [-233, 233], ...WALL.slice(1, -1), [233, 233]], fill: PAL.grassA },
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
