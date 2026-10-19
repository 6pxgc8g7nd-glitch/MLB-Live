/* 打席動畫的 3D 舞台（Three.js）：球場、看台、人物、球與特效。只負責「把 frameAt 算出的畫面狀態畫出來」，不含時間表邏輯。
 * 世界座標（呎）：x 往一壘、y 往中外野、z 向上；Three 座標：X = x，Y = z（向上），Z = -y（所以往外野是 -Z，鏡頭預設朝 -Z）。 */
import * as THREE from './vendor/three.module.min.js';
import { GROUND, PAL, WALL } from './cam3d.js';

const V = (x, y, z) => new THREE.Vector3(x, z, -y); // 世界座標 → Three 座標
const W2V = (w) => V(w[0], w[1], w[2]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, k) => a + (b - a) * k;
const ease = (u) => u * u * (3 - 2 * u);
const UP = new THREE.Vector3(0, 1, 0);
const PLATE_Y = 17 / 12;

// ───────── 場地貼圖：從 GROUND（跟 2D 資料同一份）畫成一張俯視貼圖 ─────────
// 場地貼圖：從 GROUND（跟 2D 資料同一份）畫成俯視貼圖。整個球場一張，本壘周圍再疊一張高解析的（近看才不會糊）
const TEX_ALL = { x0: -450, x1: 450, y0: -90, y1: 810, px: 3072 };
const TEX_HOME = { x0: -110, x1: 110, y0: -45, y1: 135, px: 2048 };
function fieldTexture(renderer, T) {
  const S = T.px / (T.x1 - T.x0), cv = document.createElement('canvas');
  cv.width = T.px; cv.height = Math.round((T.y1 - T.y0) * S);
  const g = cv.getContext('2d');
  const P = ([x, y]) => [(x - T.x0) * S, (T.y1 - y) * S];
  g.fillStyle = PAL.grassA; g.fillRect(0, 0, cv.width, cv.height);
  for (const e of GROUND) {
    if (e.wallFace) continue;
    g.beginPath();
    e.pts.forEach((p, i) => { const [u, v] = P(p); if (i) g.lineTo(u, v); else g.moveTo(u, v); });
    if (e.closed) g.closePath();
    if (e.fill) { g.fillStyle = e.fill; g.fill(); }
    if (e.stroke) { g.strokeStyle = e.stroke; g.lineWidth = Math.max(1.5, e.sw * S * 0.28); g.globalAlpha = e.op || 1; g.lineJoin = 'round'; g.stroke(); g.globalAlpha = 1; }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true;
  return t;
}
const crowdTexture = () => { // 看台觀眾：深藍底、零星的彩色小點
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d'); g.fillStyle = '#26315a'; g.fillRect(0, 0, 256, 256);
  const cols = ['#c7cfe2', '#8b97b8', '#e3c46a', '#d96a6a', '#6aa6d9', '#f2f2f2'];
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 420; i++) { g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.globalAlpha = 0.55 + rnd() * 0.4; g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 2 + rnd() * 2.4, 0, 6.3); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
};
const skyTexture = () => {
  const cv = document.createElement('canvas'); cv.width = 8; cv.height = 256;
  const g = cv.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#3a78c2'); gr.addColorStop(0.5, '#79afdf'); gr.addColorStop(0.8, '#bddcf1'); gr.addColorStop(1, '#e1eef7');
  g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
};

// 外野牆與看台：沿著牆線（WALL）往上、往外一層一層
function buildStadium(scene) {
  // rows：幾條由 3D 點組成的折線，相鄰兩條之間鋪成面。貼圖座標依實際距離算（uv 是每張貼圖鋪幾呎），這樣斜坡再長觀眾也不會被拉成條紋
  const ribbon = (rows, mat, tile) => {
    const pos = [], uvs = [], idx = [], n = rows[0].length, T = tile || 0;
    const vAt = rows.map((r, ri) => (ri ? rows.slice(0, ri + 1).reduce((s0, rr, k) => (k ? s0 + rr[0].distanceTo(rows[k - 1][0]) : 0), 0) : 0));
    rows.forEach((row, r) => { let acc = 0; row.forEach((p, i) => { if (i) acc += p.distanceTo(row[i - 1]); pos.push(p.x, p.y, p.z); uvs.push(T ? acc / T : i, T ? vAt[r] / T : r); }); });
    for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < n - 1; i++) { const a = r * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); scene.add(m); return m;
  };
  const row = (scale, h) => WALL.map(([x, y]) => { const d = Math.hypot(x, y) || 1, k = 1 + scale / d; return V(x * k, y * k, h); });
  const wallMat = new THREE.MeshLambertMaterial({ color: PAL.wall, side: THREE.DoubleSide });
  ribbon([row(0, 0), row(0, 9)], wallMat);
  ribbon([row(0, 9), row(0.4, 9.3)], new THREE.MeshBasicMaterial({ color: PAL.wallTop, side: THREE.DoubleSide }));
  const crowd = new THREE.MeshLambertMaterial({ map: crowdTexture(), side: THREE.DoubleSide });
  const tiers = [[3, 11], [14, 17], [26, 24], [40, 33], [56, 44], [74, 56]];
  ribbon(tiers.map(([d, h]) => row(d, h)), crowd, 36);
  // 本壘後面的看台：一圈弧形，由近到遠一層層升高（鏡頭在投手背後時，打者後面的背景就是它）
  const behind = (R, h) => Array.from({ length: 25 }, (_, i) => { const th = ((i / 24) * 2 - 1) * 1.35; return V(Math.sin(th) * R, -Math.cos(th) * R, h); });
  ribbon([behind(62, 0), behind(62, 5)], new THREE.MeshLambertMaterial({ color: '#2a5da3', side: THREE.DoubleSide }));
  ribbon([behind(62, 5), behind(64, 5.3)], new THREE.MeshBasicMaterial({ color: '#e9ecf1', side: THREE.DoubleSide }));
  ribbon([[64, 6], [72, 15], [86, 27], [100, 38], [116, 50], [134, 63]].map(([d, h]) => behind(d, h)), crowd, 36);
}

// ───────── 人物 ─────────
const MAT = { skin: '#d8a37c', pants: '#e9ecf1', shoe: '#1b1f27', belt: '#1a1f26', wood: '#d8ad72', glove: '#7a4f26' };
const geoCache = {};
const cyl = (rt, rb, seg = 12) => { const k = `${rt}_${rb}_${seg}`; return geoCache[k] || (geoCache[k] = new THREE.CylinderGeometry(rt, rb, 1, seg, 1)); };
const sph = (r) => { const k = `s${r}`; return geoCache[k] || (geoCache[k] = new THREE.SphereGeometry(r, 16, 12)); };
const capGeo = () => geoCache.cap || (geoCache.cap = new THREE.SphereGeometry(1.08, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55));
const brimGeo = () => geoCache.brim || (geoCache.brim = new THREE.CylinderGeometry(1, 1, 0.08, 14, 1, false, -Math.PI / 2, Math.PI));

class Humanoid {
  constructor(scene, lite = false) {
    this.lite = lite;
    this.g = new THREE.Group(); scene.add(this.g);
    this.mat = { jersey: new THREE.MeshLambertMaterial({ color: '#888' }), sock: new THREE.MeshLambertMaterial({ color: '#888' }), cap: new THREE.MeshLambertMaterial({ color: '#888' }) };
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    this.m = { skin: lam(MAT.skin), pants: lam(MAT.pants), shoe: lam(MAT.shoe), belt: lam(MAT.belt), wood: lam(MAT.wood), glove: lam(MAT.glove), dark: lam('#2a3140'), mask: lam('#cfd6df') };
    const add = (geo, mat) => { const o = new THREE.Mesh(geo, mat); o.frustumCulled = false; this.g.add(o); return o; };
    this.torso = add(cyl(1, 0.82, 14), this.mat.jersey);
    this.head = add(sph(0.42), this.m.skin); this.cap = add(capGeo(), this.mat.cap); this.brim = add(brimGeo(), this.mat.cap);
    this.neck = add(cyl(0.14, 0.16), this.m.skin);
    this.eyeL = add(sph(0.045), this.m.belt); this.eyeR = add(sph(0.045), this.m.belt);
    this.legF = add(cyl(0.22, 0.19), this.m.pants); this.legB = add(cyl(0.22, 0.19), this.m.pants);
    this.shoeF = add(new THREE.BoxGeometry(0.5, 0.26, 0.95), this.m.shoe); this.shoeB = add(new THREE.BoxGeometry(0.5, 0.26, 0.95), this.m.shoe);
    if (!lite) {
      this.shinF = add(cyl(0.19, 0.15), this.mat.sock); this.shinB = add(cyl(0.19, 0.15), this.mat.sock);
      this.kneeF = add(sph(0.2), this.m.pants); this.kneeB = add(sph(0.2), this.m.pants);
      this.upF = add(cyl(0.16, 0.13), this.mat.jersey); this.upB = add(cyl(0.16, 0.13), this.mat.jersey);
      this.foF = add(cyl(0.13, 0.1), this.m.skin); this.foB = add(cyl(0.13, 0.1), this.m.skin);
      this.elF = add(sph(0.14), this.m.skin); this.elB = add(sph(0.14), this.m.skin);
      this.hdF = add(sph(0.14), this.m.skin); this.hdB = add(sph(0.14), this.m.skin);
      this.dtF = add(sph(0.2), this.mat.jersey); this.dtB = add(sph(0.2), this.mat.jersey);
      this.beltM = add(cyl(1, 1, 14), this.m.belt);
      this.maskM = add(new THREE.BoxGeometry(0.62, 0.5, 0.12), this.m.mask);
      this.bat = add(new THREE.CylinderGeometry(0.17, 0.045, 1, 10), this.m.wood);
      this.gloveM = add(sph(0.36), this.m.glove);
      this.ballM = add(sph(0.13), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    }
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; scene.add(this.shadow);
  }
  colors(jersey, sock = jersey, cap = jersey) { this.mat.jersey.color.set(jersey); this.mat.sock.color.set(sock); this.mat.cap.color.set(cap); return this; }
  set visible(v) { this.g.visible = v; this.shadow.visible = v; }
  seg(mesh, a, b, rad) { // 把單位高度的圓柱放在 a、b 兩點之間
    const d = b.clone().sub(a), len = Math.max(d.length(), 1e-4);
    mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.scale.set(rad, len, rad);
    mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
  }
  // 依姿勢（關節座標）擺好全身。W：把（x, z, y）換成世界座標 [X, Y, Z]；facing：頭朝向 +1＝往外野（打者看著投手）、-1＝往本壘；o：{ back, mask, bat:{hands,tip}, glove, ball }
  update(p, W, facing, o = {}) {
    const J = (q) => W2V(W(q.x, q.z, q.y || 0));
    const hip = J(p.hip), sh = J(p.sh), fF = J(p.footF), fB = J(p.footB);
    const head = sh.clone().lerp(J(p.head), 0.6); // 3D 的頭離肩膀近一點（2D 姿勢的頭抬得比較高）
    this.visible = true;
    this.seg(this.torso, hip, sh, 1); this.torso.scale.set(((p.wh + p.ws) * 0.5) * 0.82 + 0.05, this.torso.scale.y, 0.48);
    this.head.position.copy(head);
    this.neck.position.copy(sh).add(new THREE.Vector3(0, 0.12, 0)); this.neck.scale.set(1, Math.max(0.1, head.y - sh.y), 1);
    const ey = head.clone().add(new THREE.Vector3(0, -0.02, facing * -0.37)); this.eyeL.position.copy(ey).add(new THREE.Vector3(-0.15, 0, 0)); this.eyeR.position.copy(ey).add(new THREE.Vector3(0.15, 0, 0));
    this.eyeL.visible = this.eyeR.visible = !o.back && !o.mask;
    this.cap.position.copy(head).add(new THREE.Vector3(0, 0.03, 0)); this.cap.scale.setScalar(0.42);
    this.brim.position.copy(head).add(new THREE.Vector3(0, 0.1, facing * -0.26)); this.brim.scale.set(0.5, 1, 0.6); this.brim.rotation.y = facing > 0 ? Math.PI : 0;
    this.brim.visible = !o.back;
    this.seg(this.legF, hip, fF, 1); this.seg(this.legB, hip, fB, 1);
    this.legF.scale.x = this.legF.scale.z = 1; this.legB.scale.x = this.legB.scale.z = 1;
    this.shoeF.position.copy(fF).add(new THREE.Vector3(0, 0.1, -facing * 0.2)); this.shoeB.position.copy(fB).add(new THREE.Vector3(0, 0.1, -facing * 0.2));
    this.shadow.position.set(hip.x, 0.04, hip.z); this.shadow.scale.set(1.5, 1.5, 1.5);
    if (this.lite) return this;
    const kF = J(p.kneeF), kB = J(p.kneeB);
    this.seg(this.legF, hip, kF, 1); this.seg(this.legB, hip, kB, 1);
    this.seg(this.shinF, kF, fF, 1); this.seg(this.shinB, kB, fB, 1);
    this.kneeF.position.copy(kF); this.kneeB.position.copy(kB);
    const eF = J(p.elbowF), eB = J(p.elbowB), hF = J(p.handF), hB = J(p.handB);
    const shF = sh.clone().add(new THREE.Vector3(p.ws * 0.6, -0.1, 0)), shB = sh.clone().add(new THREE.Vector3(-p.ws * 0.6, -0.1, 0));
    this.seg(this.upF, shF, eF, 1); this.seg(this.upB, shB, eB, 1); this.seg(this.foF, eF, hF, 1); this.seg(this.foB, eB, hB, 1);
    this.elF.position.copy(eF); this.elB.position.copy(eB); this.hdF.position.copy(hF); this.hdB.position.copy(hB); this.dtF.position.copy(shF); this.dtB.position.copy(shB);
    const bm = hip.clone().lerp(sh, 0.04);
    this.beltM.position.copy(bm); this.beltM.scale.set(this.torso.scale.x * 0.86, 0.16, 0.48 * 0.86);
    this.maskM.visible = !!o.mask; if (o.mask) this.maskM.position.copy(head).add(new THREE.Vector3(0, -0.08, facing * 0.3));
    this.bat.visible = !!o.bat; if (o.bat) { const a = W2V(W(o.bat.hands.x, o.bat.hands.z, 0)), b = W2V(W(o.bat.tip.x, o.bat.tip.z, 0)); this.seg(this.bat, a, b, 1); this.bat.scale.x = this.bat.scale.z = 1; this.bat.scale.set(1, a.distanceTo(b), 1); }
    this.gloveM.visible = !!o.glove; if (o.glove) this.gloveM.position.copy(hB);
    this.ballM.visible = !!o.ball; if (o.ball) this.ballM.position.copy(hF);
    return this;
  }
}

// ───────── 舞台 ─────────
export function createStage(host, opts) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.insertBefore(renderer.domElement, host.firstChild);
  const canvas = renderer.domElement; canvas.id = 'an3d'; canvas.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(17, 0.6, 1, 40000);
  scene.add(new THREE.HemisphereLight('#dcebff', '#3c5a30', 1.15));
  const sun = new THREE.DirectionalLight('#fff4de', 1.15); sun.position.set(-90, 160, 40); scene.add(sun);
  scene.background = skyTexture();
  scene.fog = new THREE.Fog('#a9c9e6', 1200, 6000); // 遠處慢慢融進天空的顏色

  // 地面：大貼圖＋外圍一大片深色（遮住貼圖外面的空白）
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), new THREE.MeshLambertMaterial({ color: '#2a3350' })); outer.rotation.x = -Math.PI / 2; outer.position.y = -0.2; scene.add(outer);
  const patch = (T, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(T.x1 - T.x0, T.y1 - T.y0), new THREE.MeshLambertMaterial({ map: fieldTexture(renderer, T) })); m.rotation.x = -Math.PI / 2; m.position.set((T.x0 + T.x1) / 2, y, -(T.y0 + T.y1) / 2); scene.add(m); return m; };
  patch(TEX_ALL, 0); patch(TEX_HOME, 0.02);
  buildStadium(scene);
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(8, 9.5, 0.9, 28), new THREE.MeshLambertMaterial({ color: PAL.mound })); mound.position.copy(V(0, 60.5, 0.45)); scene.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 0.5), new THREE.MeshLambertMaterial({ color: '#fff' })); rubber.position.copy(V(0, 60.5, 0.96)); scene.add(rubber);
  for (const [x, y] of [[63.6, 63.6], [0, 127.3], [-63.6, 63.6]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 1.6), new THREE.MeshLambertMaterial({ color: '#fff' })); b.position.copy(V(x, y, 0.15)); b.rotation.y = Math.PI / 4; scene.add(b); }
  const plate = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.708, PLATE_Y), new THREE.Vector2(0.708, PLATE_Y), new THREE.Vector2(0.708, 0.7), new THREE.Vector2(0, 0), new THREE.Vector2(-0.708, 0.7)])), new THREE.MeshBasicMaterial({ color: '#fffdf5' }));
  plate.rotation.x = -Math.PI / 2; plate.position.set(0, 0.03, 0); scene.add(plate);

  // 人物：打者、投手、捕手、主審用完整版；野手用簡化版；跑者最多 4 位
  const batter = new Humanoid(scene).colors(opts.batColor), pitcher = new Humanoid(scene).colors(opts.pitColor);
  const catcher = new Humanoid(scene).colors(opts.pitColor), umpire = new Humanoid(scene).colors('#2a3140', '#2a3140', '#2a3140');
  const fielders = {}; for (const k of Object.keys(opts.positions)) fielders[k] = new Humanoid(scene, true).colors(opts.pitColor);
  const runners = Array.from({ length: 4 }, () => new Humanoid(scene).colors(opts.batColor));
  [batter, pitcher, catcher, umpire, ...runners].forEach((h) => { h.visible = false; }); Object.values(fielders).forEach((h) => { h.visible = false; });

  // 球、球軌跡、好球帶、落點圈、火花
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff' })); scene.add(ball);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false })); ballShadow.rotation.x = -Math.PI / 2; scene.add(ballShadow);
  let trailMesh = null;
  const trailMat = new THREE.MeshBasicMaterial({ color: '#fff' });
  const zoneTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 246); g.lineWidth = 4; g.globalAlpha = 0.5; for (const k of [1, 2]) { g.beginPath(); g.moveTo(k * 85.3, 6); g.lineTo(k * 85.3, 250); g.moveTo(6, k * 85.3); g.lineTo(250, k * 85.3); g.stroke(); } const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const zone = new THREE.Mesh(new THREE.PlaneGeometry(1.416, 2), new THREE.MeshBasicMaterial({ map: zoneTex, transparent: true, depthWrite: false, side: THREE.DoubleSide })); scene.add(zone);
  const zoneDots = [];
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, depthWrite: false, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
  const sparks = Array.from({ length: 24 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true })); m.visible = false; scene.add(m); return m; });

  const PCOL = { fb: '#ff5a4f', si: '#ff9a3c', ct: '#c9996a', sl: '#5aa9ff', cu: '#b794ff', ch: '#4fd694', ot: '#d6dbe3', hit: '#ffffff', foul: '#c4cdd8', hr: '#ffe27a' };
  const size = { w: 1, h: 1 };
  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    if (w === size.w && h === size.h) return; size.w = w; size.h = h;
    renderer.setSize(w, h, false); canvas.style.width = '100%'; canvas.style.height = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix();
  };

  // 鏡頭：起點在投手背後的高處（望遠），擊出後繞到本壘後方、升高、拉遠成球場俯視；終點對準 frameAt 給的視野（f.cam）
  const START = { d: 112, alpha: 0.16, tanH: 1 / 13, tz: 3.6 };
  const FIELD_ALPHA = 0.95, FIELD_TANH = Math.tan((38 * Math.PI) / 360);
  const placeCamera = (f) => {
    const a = camera.aspect;
    const end = (f.scene === 'field' ? f.cam : f.endCam) || { cx: 0, y0: -60, y1: 200, minW: 280 };
    const hv = end.y1 - end.y0, wv = Math.max(hv * a, end.minW);
    const endT = { x: end.cx, y: (end.y0 + end.y1) / 2 };
    const dEnd = wv / (2 * FIELD_TANH);
    const k = ease(clamp(f.scene === 'field' ? 1 : f.m, 0, 1));
    const yaw = Math.PI * (1 - ease(clamp(k * 1.12, 0, 1)));
    const al = mix(START.alpha, FIELD_ALPHA, Math.sqrt(k));
    const d = Math.exp(mix(Math.log(START.d), Math.log(dEnd), k));
    const kt = k * k;
    const T = { x: mix(0, endT.x, kt), y: mix(0, endT.y, kt), z: mix(START.tz, 0, k) };
    const fx = Math.sin(yaw) * Math.cos(al), fy = Math.cos(yaw) * Math.cos(al), fz = -Math.sin(al);
    camera.position.copy(V(T.x - d * fx, T.y - d * fy, T.z - d * fz));
    camera.lookAt(V(T.x, T.y, T.z));
    const tanH = mix(START.tanH, FIELD_TANH, k);
    camera.fov = (2 * Math.atan(tanH / a) * 180) / Math.PI; camera.updateProjectionMatrix();
    return k;
  };

  const setTrail = (pts, cls, pxScale) => {
    if (trailMesh) { scene.remove(trailMesh); trailMesh.geometry.dispose(); trailMesh = null; }
    if (!pts || pts.length < 2) return;
    const g = (c) => ({ fb: 'fb', fa: 'fb', si: 'si', ft: 'si', fc: 'ct', sl: 'sl', st: 'sl', sv: 'sl', cu: 'cu', kc: 'cu', cs: 'cu', ch: 'ch', fs: 'ch', fo: 'ch' }[(c || '').toLowerCase()] || (['hit', 'foul', 'hr'].includes(c) ? c : 'ot'));
    trailMat.color.set(PCOL[g(cls)] || '#fff');
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => V(q.x, q.y, q.z)));
    trailMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(48, pts.length * 2), 0.1 * pxScale, 6, false), trailMat);
    trailMesh.frustumCulled = false; scene.add(trailMesh);
  };

  // 每格：依 frameAt 的狀態更新整個舞台並畫出來
  const render = (f, sc, bits) => {
    resize();
    const k = placeCamera(f);
    const distTo = (p) => camera.position.distanceTo(p);
    const near = clamp(1 - k * 1.2, 0, 1); // 轉場前段才看得到近處的人
    // 打者
    const { batPose, pitcherPose, standPose, runPose, crouchPose } = bits;
    const bp = batPose(f.bat.load, f.bat.k, f.bat.type, f.bat.z);
    const Wb = (x, z) => [opts.dir * (x - 2.1), 0.7, z];
    batter.update(bp, Wb, 1, { bat: { hands: bp.hands, tip: bp.tip } });
    const pp = pitcherPose(f.pit, opts.pitDir);
    const Wp = (x, z, y = 0) => [x, 59.4 - y, z + 0.8];
    pitcher.update(pp, Wp, -1, { back: true, glove: true, ball: f.pit < 0 });
    // 捕手、主審
    const C = opts.positions.C;
    catcher.update(crouchPose(), (x, z) => [C[0] + x, C[1], z], 1, {});
    umpire.update(standPose(), (x, z) => [0.4 + x, -10.5, z], 1, { mask: true });
    // 野手（簡化版，捕手與投手用上面的完整版）
    for (const q of f.fielders) {
      const h = fielders[q.pos]; if (!h) continue;
      if (q.pos === 'P' || q.pos === 'C') { h.visible = false; continue; }
      h.update(q.act ? runPose(f.t * 7 + q.x * 0.05) : standPose(), (x, z) => [q.x + x, q.y, z], -1, {});
    }
    // 跑者
    runners.forEach((h, i) => {
      const r = f.runners[i];
      if (!r) { h.visible = false; return; }
      h.update(r.moving ? runPose(f.t * 8) : standPose(), (x, z) => [r.x + x, r.y, z], -1, {});
    });
    // 轉場時打者、投手、捕手、主審淡出的做法：直接隱藏（拉遠後本來就太小）
    const showClose = near > 0.02 || f.scene === 'pitch';
    batter.visible = pitcher.visible = catcher.visible = umpire.visible = showClose && k < 0.85;
    // 球與軌跡
    const px = Math.max(1, camera.position.length() / 90); // 距離越遠越放大一點，球才看得到
    if (f.ball) {
      const bpos = V(f.ball.x, f.ball.y, f.ball.z);
      ball.visible = true; ball.position.copy(bpos); ball.scale.setScalar(0.13 * Math.max(1, distTo(bpos) / 38));
      ballShadow.visible = f.ball.z > 0.6; ballShadow.position.set(bpos.x, 0.05, -f.ball.y); ballShadow.scale.setScalar(0.45 * Math.max(1, distTo(bpos) / 80));
      setTrail(f.trail, f.trailCls, px);
    } else { ball.visible = false; ballShadow.visible = false; setTrail(null); }
    // 好球帶（在本壘板前緣處）與這個打席的每一球落點
    const zt = sc.zTop, zb = sc.zBot;
    zone.position.copy(V(0, PLATE_Y, (zt + zb) / 2)); zone.scale.set(1, zt - zb, 1); zone.visible = f.scene === 'pitch' && k < 0.6;
    f.zone.forEach((z, i) => {
      let d = zoneDots[i];
      if (!d) { d = zoneDots[i] = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: '#fff' })); scene.add(d); }
      const grp = ({ ff: 'fb', fa: 'fb', si: 'si', ft: 'si', fc: 'ct', sl: 'sl', st: 'sl', sv: 'sl', cu: 'cu', kc: 'cu', cs: 'cu', ch: 'ch', fs: 'ch', fo: 'ch' }[(z.code || '').toLowerCase()]) || 'ot';
      d.material.color.set(PCOL[grp]); d.position.copy(V(z.x, PLATE_Y - 0.02, z.z)); d.scale.setScalar(i === f.zone.length - 1 ? 0.2 : 0.14); d.visible = zone.visible;
    });
    for (let i = f.zone.length; i < zoneDots.length; i++) zoneDots[i].visible = false;
    // 落點標記圈
    if (f.land && f.land.u < 1.45) {
      const lf = f.land.u < 1 ? 1 : clamp(1.45 - f.land.u, 0, 0.45) / 0.45, rr = 7 + 2.2 * Math.sin(f.t * 14);
      ring.visible = true; ring.position.set(f.land.x, 0.08, -f.land.y); ring.scale.setScalar(rr); ring.material.opacity = 0.9 * lf;
    } else ring.visible = false;
    // 火花：擊中瞬間（在好球帶位置）與全壘打過牆（在牆上）
    sparks.forEach((s) => { s.visible = false; });
    const burst = (cx, cy, cz, n, rad, size, col, op) => { for (let i = 0; i < n; i++) { const s = sparks[i], an = (i / n) * Math.PI * 2 + 0.3, up = Math.sin(i * 1.7) * 0.6; s.visible = true; s.position.set(cx + Math.cos(an) * rad, cz + up * rad * 0.8, -cy + Math.sin(an) * rad * 0.3); s.scale.setScalar(size); s.material.color.set(i % 3 ? col : '#ffffff'); s.material.opacity = op; } };
    if (f.contact) { const c = f.contact; burst(c.x, PLATE_Y, c.z, 14, (0.5 + 1.8 * c.strength * Math.sqrt(c.k)), 0.1 + 0.12 * (1 - c.k), c.foul ? '#d3dae2' : '#ffe27a', 1 - c.k); }
    else if (f.fx) { burst(f.fx.x, f.fx.y, 8, 24, 15 + 70 * f.fx.k, 1.4 * (1 - f.fx.k * 0.6), '#ffd84d', 1 - f.fx.k); }
    renderer.render(scene, camera);
  };
  const dispose = () => {
    renderer.dispose(); scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); } });
    canvas.remove();
  };
  return { render, resize, dispose, canvas, renderer, PCOL };
}
