/* 打席動畫的畫面：球場俯視 SVG、捕手視角的 3D 場景（cam3d.js）、雷達面板、控制列。時間表與每一格的狀態來自 anim-script.js。 */
import { esc } from './util.js';
import { evZh } from './dict.js';
import { S } from './state.js';
import { PITCH_ZH } from './pitches.js';
import { IC } from './icons.js';
import { teamAbbr, teamColor } from './dict.js';
import { pitchGroup } from './pitchmap.js';
import { PLATE_Y, camAt, project, projectPoly, GROUND } from './cam3d.js';
import { FIELD_POS as POS, buildScript, frameAt, batPose, pitcherPose, standPose, runPose, crouchPose, clamp, scorebug } from './anim-script.js';
/* ───────── 畫面 ───────── */
const ZH = () => S.lang !== 'en';
const L = (zh, en) => (ZH() ? zh : en);

// 2D 球場畫面直接用 3D 場景的同一份地面資料（GROUND），顏色與形狀才會跟轉場結束時的畫面一模一樣
const fieldSVG = () => `<defs><pattern id="crowd2" width="9" height="7" patternUnits="userSpaceOnUse"><circle cx="1.8" cy="1.8" r="1.3" fill="#ff8fa3"/><circle cx="6.2" cy="2" r="1.3" fill="#ffd84d"/><circle cx="4" cy="5.2" r="1.3" fill="#8fd3ff"/></pattern></defs><g transform="scale(1,-1)">${GROUND.filter((g) => !g.wallFace).map((g) => {
  const pts = g.pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const stroke = g.stroke ? ` stroke="${g.stroke}" stroke-width="${g.sw}" vector-effect="non-scaling-stroke"` : '';
  return (g.closed ? `<polygon points="${pts}" fill="${g.fill || 'none'}"${stroke}${g.op ? ` opacity="${g.op}"` : ''}/>` : `<polyline points="${pts}" fill="none"${stroke}/>`) + (g.crowd ? `<polygon points="${pts}" fill="url(#crowd2)" opacity=".6"/>` : '');
}).join('')}</g>`;

const f2 = (n) => n.toFixed(3);
export function openAnim(play, gd, allPlays, feed) {
  if (!play || document.getElementById('an')) return null;
  const prevPlay = allPlays && play.about ? [...allPlays].reverse().find((p) => p.about && p.about.atBatIndex === play.about.atBatIndex - 1) : null;
  const sc = buildScript(play, prevPlay);
  if (!sc.segs.length) return null;
  const m = play.matchup || {}, bat = (m.batter && m.batter.fullName) || '', pit = (m.pitcher && m.pitcher.fullName) || '';
  const R = play.result || {};
  const rightie = !(m.batSide && m.batSide.code === 'L');
  const el = document.createElement('div');
  el.id = 'an'; el.className = 'an'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="an-h"><div class="an-who"><b>${esc(bat)}</b><span>vs ${esc(pit)}</span></div><button class="an-x" aria-label="${L('關閉', 'Close')}">${IC.close}</button></div>
    <div class="an-st"><svg id="anPv" preserveAspectRatio="xMidYMid slice" aria-hidden="true"></svg>
      <svg id="anSvg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${fieldSVG()}
      <g id="anFd">${Object.keys(POS).map((p) => `<circle class="an-fd" data-pos="${p}" cx="${POS[p][0]}" cy="${-POS[p][1]}" r="3"/>`).join('')}</g>
      <circle id="anBt" class="an-bt" cx="${rightie ? -4.2 : 4.2}" cy="0" r="3"/>
      <polyline id="anTr" class="an-tr" fill="none" vector-effect="non-scaling-stroke"/><polyline id="anTr2" class="an-tr2" fill="none" vector-effect="non-scaling-stroke"/>
      <circle id="anLand" class="an-land" r="0"/><g id="anFx"></g><g id="anRn"></g>
      <g id="anBall"><ellipse id="anSh" class="an-sh"/><circle id="anBc" class="an-bc"/></g></svg>
      <div class="an-sb"><div class="sb-tm"><div class="sb-row"><i class="sb-c a"></i><span class="sb-a"></span><b class="sb-sa">0</b></div><div class="sb-row"><i class="sb-c h"></i><span class="sb-h"></span><b class="sb-sh">0</b></div></div>
        <div class="sb-mid"><div class="sb-in"></div><svg class="sb-d" viewBox="0 0 34 30" aria-hidden="true"><rect class="b2" x="14" y="2" width="7" height="7" transform="rotate(45 17.5 5.5)"/><rect class="b3" x="3" y="12" width="7" height="7" transform="rotate(45 6.5 15.5)"/><rect class="b1" x="25" y="12" width="7" height="7" transform="rotate(45 28.5 15.5)"/></svg></div>
        <div class="sb-lp"><div class="lp b"><u>B</u><i></i><i></i><i></i></div><div class="lp s"><u>S</u><i></i><i></i></div><div class="lp o"><u>O</u><i></i><i></i></div></div></div>
      <div class="an-zn"></div>
      <div class="an-hud" hidden></div>
      <div class="an-info"><div class="in-r"><b class="in-n"></b><span class="in-s"></span></div><div class="in-m"><i></i></div></div>
      <div class="an-pop" hidden></div>
      <div class="an-fl"></div>
      <div class="an-bn" hidden><b></b><small></small></div></div>
    <div class="an-bar"><div class="an-sc"><input class="an-rg" type="range" min="0" max="1000" step="1" value="0" aria-label="${L('動畫時間軸', 'Timeline')}"><span class="an-tm">0.0 / 0.0</span></div>
      <div class="an-bt2"><button class="an-pv" aria-label="${L('上一球', 'Previous pitch')}">${IC.prev}</button><button class="an-pp" aria-label="${L('暫停', 'Pause')}" aria-pressed="false">${IC.pause}</button><button class="an-nx" aria-label="${L('下一球', 'Next pitch')}">${IC.next}</button><button class="an-re">${IC.replay}${L('重播', 'Replay')}</button><button class="an-sp" aria-pressed="false">${L('慢動作', 'Slow')} 1×</button></div></div>`;
  document.body.appendChild(el);
  const $e = (s) => el.querySelector(s);
  const svg = $e('#anSvg'), pv = $e('#anPv'), st = $e('.an-st');
  let sbSig = '', znSig = null;
  const half = play.about && play.about.halfInning === 'bottom' ? 'bottom' : 'top';
  const batTeam = gd && gd.teams && gd.teams[half === 'top' ? 'away' : 'home'], pitTeam = gd && gd.teams && gd.teams[half === 'top' ? 'home' : 'away'];
  const batColor = teamColor(batTeam), pitColor = teamColor(pitTeam), pitDir = m.pitchHand && m.pitchHand.code === 'L' ? 1 : -1; // 右投的投球手在捕手視角的左邊
  { // 比分板上的球隊簡稱與顏色；球員的球衣顏色也用在 2D 球場畫面的圓點上（--def 守備、--off 進攻）
    const away = gd && gd.teams && gd.teams.away, home = gd && gd.teams && gd.teams.home;
    $e('.sb-a').textContent = teamAbbr(away) || 'AWAY'; $e('.sb-h').textContent = teamAbbr(home) || 'HOME';
    $e('.sb-c.a').style.background = teamColor(away); $e('.sb-c.h').style.background = teamColor(home);
    el.style.setProperty('--def', pitColor); el.style.setProperty('--off', batColor);
  }
  const dir = rightie ? 1 : -1;
  const opener = document.activeElement;
  let t = 0, speed = 1, raf = 0, last = 0, rm = 0;

  const bits = [];
  if (R.rbi) bits.push(L(`${R.rbi} 分打點`, `${R.rbi} RBI`));
  $e('.an-bn b').textContent = sc.hr ? L('全壘打！', 'HOME RUN!') : (ZH() ? evZh(R.event) : R.event) || '';
  $e('.an-bn small').textContent = bits.join(' · ');
  $e('.an-bn').classList.toggle('hr', !!sc.hr);

  // 捕手視角與轉場：同一台針孔攝影機，從本壘後方拉高、拉遠成球場俯視（cam3d.js）。每格重畫整個 3D 場景
  // Q 版球員：大頭、粗肢體、黑色描邊，穿球隊顏色。依姿勢逐格重畫；W 把（x, z, y）換成世界座標（呼叫端已把身體縮成 Q 版比例）；jersey 是球衣顏色；o.back 是背對鏡頭（投手）
  const SKIN = '#f2b98a', PANTS = '#f4f6fa', INK = '#151b26';
  const figure = (c, W, p, jersey, o) => {
    const P2 = (q) => project(c, W(q.x, q.z, q.y));
    const sc0 = P2(p.hip);
    if (!sc0) return '';
    const u = c.F / sc0.d; // 1 呎在畫面上的大小
    const L = (a, b, w, col) => { const A = P2(a), B = P2(b); return A && B ? `<line x1="${f2(A.x)}" y1="${f2(A.y)}" x2="${f2(B.x)}" y2="${f2(B.y)}" stroke="${INK}" stroke-width="${f2((w + 0.2) * u)}" stroke-linecap="round"/><line x1="${f2(A.x)}" y1="${f2(A.y)}" x2="${f2(B.x)}" y2="${f2(B.y)}" stroke="${col}" stroke-width="${f2(w * u)}" stroke-linecap="round"/>` : ''; };
    const shoe = (q) => { const A = P2(q); return A ? `<ellipse cx="${f2(A.x + (o.dir || 1) * 0.15 * u)}" cy="${f2(A.y)}" rx="${f2(0.62 * u)}" ry="${f2(0.3 * u)}" fill="#e8402f" stroke="${INK}" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ''; };
    const PS = (q) => `${f2(q.x)},${f2(q.y)}`;
    const poly = projectPoly(c, [W(p.sh.x - p.ws, 4.95, p.sh.y), W(p.sh.x + p.ws, 4.95, p.sh.y), W(p.hip.x + p.wh, 3.0, p.hip.y), W(p.hip.x - p.wh, 3.0, p.hip.y)], true);
    const hd = P2(p.head);
    const r = 0.82 * u;
    const gs = P2({ x: p.hip.x, z: 0, y: p.hip.y });
    let s = gs ? `<ellipse cx="${f2(gs.x)}" cy="${f2(gs.y)}" rx="${f2(1.5 * u)}" ry="${f2(0.5 * u * Math.max(0.35, c.up[2]))}" fill="rgba(0,0,0,.28)"/>` : ''; // 腳下的影子
    s += L(p.hip, p.kneeB, 0.72, PANTS) + L(p.kneeB, p.footB, 0.6, o.sock || jersey) + shoe(p.footB) + L(p.hip, p.kneeF, 0.72, PANTS) + L(p.kneeF, p.footF, 0.6, o.sock || jersey) + shoe(p.footF); // 褲子到膝蓋，膝蓋以下是球隊顏色的長襪
    s += L(p.elbowB, p.handB, 0.4, SKIN) + L(p.sh, p.elbowB, 0.5, jersey);
    if (poly.length > 2) s += `<polygon points="${poly.map(PS).join(' ')}" fill="${jersey}" stroke="${INK}" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    s += L({ x: p.hip.x - p.wh * 0.9, z: 3.05, y: p.hip.y }, { x: p.hip.x + p.wh * 0.9, z: 3.05, y: p.hip.y }, 0.2, '#2a3140'); // 腰帶
    s += L(p.elbowF, p.handF, 0.4, SKIN) + L(p.sh, p.elbowF, 0.5, jersey);
    if (hd) {
      const d1 = o.dir || 1;
      if (o.mask) { // 主審：深色帽子加護面罩
        s += `<circle cx="${f2(hd.x)}" cy="${f2(hd.y)}" r="${f2(r)}" fill="#2a3140" stroke="${INK}" stroke-width="3" vector-effect="non-scaling-stroke"/><rect x="${f2(hd.x - r * 0.7)}" y="${f2(hd.y - r * 0.1)}" width="${f2(r * 1.4)}" height="${f2(r * 0.85)}" rx="${f2(r * 0.2)}" fill="#cfd6df" stroke="${INK}" stroke-width="2" vector-effect="non-scaling-stroke"/><path d="M${f2(hd.x - r * 0.7)} ${f2(hd.y + r * 0.2)}H${f2(hd.x + r * 0.7)}M${f2(hd.x - r * 0.7)} ${f2(hd.y + r * 0.45)}H${f2(hd.x + r * 0.7)}M${f2(hd.x)} ${f2(hd.y - r * 0.1)}V${f2(hd.y + r * 0.75)}" stroke="${INK}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
      } else if (o.back) { // 背對鏡頭：只看得到帽子與後腦
        s += `<circle cx="${f2(hd.x)}" cy="${f2(hd.y)}" r="${f2(r)}" fill="${jersey}" stroke="${INK}" stroke-width="3" vector-effect="non-scaling-stroke"/><circle cx="${f2(hd.x)}" cy="${f2(hd.y - r * 0.15)}" r="${f2(r * 0.18)}" fill="rgba(255,255,255,.55)"/>`;
      } else {
        s += `<circle cx="${f2(hd.x)}" cy="${f2(hd.y)}" r="${f2(r)}" fill="${SKIN}" stroke="${INK}" stroke-width="3" vector-effect="non-scaling-stroke"/>`
          + `<path d="M${f2(hd.x - r)} ${f2(hd.y - r * 0.05)} A${f2(r)} ${f2(r)} 0 0 1 ${f2(hd.x + r)} ${f2(hd.y - r * 0.05)} Z" fill="${jersey}" stroke="${INK}" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
          + `<ellipse cx="${f2(hd.x + d1 * r * 0.12)}" cy="${f2(hd.y - r * 0.02)}" rx="${f2(r * 1.02)}" ry="${f2(r * 0.22)}" fill="${jersey}" stroke="${INK}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`
          + `<circle cx="${f2(hd.x - r * 0.36 + d1 * r * 0.1)}" cy="${f2(hd.y + r * 0.3)}" r="${f2(r * 0.11)}" fill="${INK}"/><circle cx="${f2(hd.x + r * 0.36 + d1 * r * 0.1)}" cy="${f2(hd.y + r * 0.3)}" r="${f2(r * 0.11)}" fill="${INK}"/>`;
      }
    }
    return s + (o.extra || '');
  };
  const drawPitch = (f) => {
    const a = st.clientWidth / Math.max(1, st.clientHeight);
    pv.setAttribute('viewBox', `-1 ${f2(-1 / a)} 2 ${f2(2 / a)}`);
    const ec = f.endCam || { cx: 0, y0: -60, y1: 200, minW: 280 };
    const hvE = ec.y1 - ec.y0, wvE = Math.max(hvE * a, ec.minW), hhE = wvE / a;
    const c = camAt(f.m, a, { cx: ec.cx, cy: ec.y0 + hhE / 2, wv: wvE });
    const k = c.k, pxN = 2 / Math.max(1, st.clientWidth); // 1 px 在畫面座標裡有多大
    const P = (q) => `${f2(q.x)},${f2(q.y)}`;
    let out = '<defs><pattern id="crowd3" width="0.06" height="0.05" patternUnits="userSpaceOnUse"><circle cx="0.012" cy="0.012" r="0.009" fill="#ff8fa3"/><circle cx="0.042" cy="0.014" r="0.009" fill="#ffd84d"/><circle cx="0.026" cy="0.036" r="0.009" fill="#8fd3ff"/></pattern></defs>'; // 看台觀眾的圓點花紋
    for (const g of GROUND) {
      const pts = projectPoly(c, g.pts, g.closed);
      if (pts.length < 2) continue;
      const stroke = g.stroke ? ` stroke="${g.stroke}" stroke-width="${g.sw}" vector-effect="non-scaling-stroke"` : '';
      const gop = g.wallFace ? clamp(1 - k * 1.3, 0, 1) : g.op; // 牆面轉成俯視後淡出，跟 2D 畫面一致
      if (g.wallFace && gop <= 0) continue;
      out += g.closed ? `<polygon points="${pts.map(P).join(' ')}" fill="${g.fill || 'none'}"${stroke}${gop != null ? ` opacity="${gop}"` : ''}/>` : `<polyline points="${pts.map(P).join(' ')}" fill="none"${stroke}/>`;
      if (g.crowd) out += `<polygon points="${pts.map(P).join(' ')}" fill="url(#crowd3)" opacity=".6"/>`;
    }
    const fade = clamp(1 - k * 1.6, 0, 1);
    const dot = (p, rFt, minPx, attrs) => { const s = project(c, p); return s ? `<circle cx="${f2(s.x)}" cy="${f2(s.y)}" r="${f2(Math.max((rFt * c.F) / s.d, minPx * pxN))}" ${attrs}/>` : ''; };
    // 好球帶（在本壘板前緣處）：轉場時淡出
    if (fade > 0) {
      const zy = PLATE_Y, zt = sc.zTop, zb = sc.zBot;
      const corners = [[-0.708, zy, zt], [0.708, zy, zt], [0.708, zy, zb], [-0.708, zy, zb]];
      const zp = projectPoly(c, corners, true);
      if (zp.length > 2) out += `<g opacity="${f2(fade)}"><polygon points="${zp.map(P).join(' ')}" fill="rgba(255,255,255,.07)" stroke="#fff" stroke-width="2.2" vector-effect="non-scaling-stroke"/>`
        + [1, 2].map((i) => { const x = -0.708 + (1.416 * i) / 3, z = zt - ((zt - zb) * i) / 3, A = project(c, [x, zy, zt]), B = project(c, [x, zy, zb]), C = project(c, [-0.708, zy, z]), D = project(c, [0.708, zy, z]); return A && B && C && D ? `<path d="M${P(A)}L${P(B)}M${P(C)}L${P(D)}" stroke="rgba(255,255,255,.35)" stroke-width="1" vector-effect="non-scaling-stroke"/>` : ''; }).join('')
        + f.zone.map((z, i) => dot([z.x, zy, z.z], i === f.zone.length - 1 ? 0.17 : 0.13, 3, `class="pm-${pitchGroup(z.code)}" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke" fill-opacity="${i === f.zone.length - 1 ? 1 : 0.7}"`)).join('')
        + (f.impact ? (() => { const s = project(c, [f.impact.x, zy, f.impact.z]); return s ? `<circle class="pv-ring ${f.impact.cls}" cx="${f2(s.x)}" cy="${f2(s.y)}" r="${f2(((0.2 + 0.45 * f.impact.k) * c.F) / s.d)}" opacity="${f2(1 - f.impact.k)}" fill="none" stroke-width="3" vector-effect="non-scaling-stroke"/>` : ''; })() : '') + '</g>';
    }
    if (fade > 0.02) out += `<g opacity="${f2(fade)}">${figure(c, (x, z) => [0.2 + x * 1.15, -10.5, z * 0.82], standPose(), '#2a3140', { dir: 1, mask: true, sock: '#2a3140' })}</g>`; // 主審站在捕手後面（先畫，才會在捕手後面）
    // 野手：近處是站著的人，拉遠後縮成跟 2D 球場一樣的圓點
    const sorted = f.fielders.map((q) => ({ q, s: project(c, [q.x, q.y, 0]) })).filter((o) => o.s && o.s.d > 4).sort((u, v) => v.s.d - u.s.d);
    for (const { q, s } of sorted) {
      if (q.pos === 'P' && k < 0.7) continue; // 投手改畫成有動作的人（下面）
      const fig = fade > 0.02 && s.d < 260; // 近的畫成穿球衣的人，遠的與拉遠後縮成圓點（跟平面球場一致）
      const top = project(c, [q.x, q.y, 5.6 * (1 - k) + 0.3]);
      const r = (0.45 * c.F / s.d) * (1 - k) + (q.act ? 5 : 4) * pxN * k;
      if (fig) {
        const pose = q.act ? runPose(f.t * 7 + q.x * 0.05) : q.pos === 'C' ? crouchPose() : standPose();
        out += `<g opacity="${f2(fade)}">${figure(c, (x, z) => [q.x + x * 1.15, q.y, z * 0.82], pose, pitColor, { dir: 1 })}</g>`;
        if (k < 0.35) continue;
      } else if (top && fade > 0.02) out += `<line x1="${f2(s.x)}" y1="${f2(s.y)}" x2="${f2(top.x)}" y2="${f2(top.y)}" stroke="${pitColor}" stroke-width="${f2((1.3 * c.F) / s.d)}" stroke-linecap="round" opacity="${f2(fade)}"/>`;
      out += `<circle cx="${f2((top || s).x)}" cy="${f2((top || s).y)}" r="${f2(r)}" fill="${q.act ? '#ffd84d' : pitColor}" stroke="#151b26" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    }
    // 打者與投手（轉場早期才看得到）：穿該隊球衣顏色
    if (k < 0.7) {
      const al = f2(clamp(1 - k / 0.7, 0, 1));
      const p = batPose(f.bat.load, f.bat.k, f.bat.type, f.bat.z);
      const Wb = (x, z) => [dir * (x * 1.15 - 2.1), 0.7, z * 0.82]; // Q 版比例：身體寬一點、矮一點
      const lnB = (A, B, w, col) => { const a1 = project(c, Wb(A.x, A.z)), b1 = project(c, Wb(B.x, B.z)); return a1 && b1 ? `<line x1="${f2(a1.x)}" y1="${f2(a1.y)}" x2="${f2(b1.x)}" y2="${f2(b1.y)}" stroke="${col}" stroke-width="${f2((w * c.F) / a1.d)}" stroke-linecap="round"/>` : ''; };
      // 揮棒的掃痕：把最近一小段時間棒頭走過的範圍畫成淡淡的扇形，加上棒頭的軌跡線
      const sweep = (() => {
        if (f.bat.type === 'take' || f.bat.k < 0.08 || f.bat.k > 0.97) return '';
        const tips = [], n = 7;
        for (let i = 0; i <= n; i++) { const q = batPose(f.bat.load, Math.max(0, f.bat.k - 0.22 * (1 - i / n)), f.bat.type, f.bat.z); tips.push(Wb(q.tip.x, q.tip.z)); }
        const hs = Wb(p.hands.x, p.hands.z), pts = projectPoly(c, [hs, ...tips], true), tl = projectPoly(c, tips, false);
        return (pts.length > 2 ? `<polygon points="${pts.map(P).join(' ')}" fill="rgba(255,255,255,.17)"/>` : '') + (tl.length > 1 ? `<polyline points="${tl.map(P).join(' ')}" fill="none" stroke="rgba(255,236,170,.65)" stroke-width="2.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : '');
      })();
      const mid = { x: p.hands.x + (p.tip.x - p.hands.x) * 0.62, z: p.hands.z + (p.tip.z - p.hands.z) * 0.62 };
      const bat = lnB(p.hands, p.tip, 0.34, INK) + lnB(p.hands, mid, 0.14, '#e0b27a') + lnB(mid, p.tip, 0.27, '#e0b27a'); // 球棒：細握把＋粗棒頭，黑色描邊
      out += `<g opacity="${al}">${figure(c, Wb, p, batColor, { dir, extra: sweep + bat })}</g>`;
      // 投手：站在投手丘上，每球出手前抬腿、揮臂，出手瞬間球離手
      const pp = pitcherPose(f.pit, pitDir);
      const Wp = (x, z, y = 0) => [x * 1.15, 59.4 - y, z * 0.82 + 0.8]; // 站在投手板上，y 是往本壘方向的距離
      const rel = f.pit < 0 ? (() => { const hs = project(c, Wp(pp.handF.x, pp.handF.z, pp.handF.y)); return hs ? `<circle cx="${f2(hs.x)}" cy="${f2(hs.y)}" r="${f2(Math.max((0.2 * c.F) / hs.d, 1.6 * pxN))}" fill="#fff"/>` : ''; })() : '';
      const gl = (() => { const gs = project(c, Wp(pp.handB.x, pp.handB.z, pp.handB.y)); return gs ? `<circle cx="${f2(gs.x)}" cy="${f2(gs.y)}" r="${f2((0.55 * c.F) / gs.d)}" fill="#8a5a2b" stroke="#151b26" stroke-width="2.5" vector-effect="non-scaling-stroke"/>` : ''; })();
      out += `<g opacity="${al}">${figure(c, Wp, pp, pitColor, { dir: 1, back: true, extra: gl + rel })}</g>`;
    }
    // 落點標記：球飛行時，地面上閃動的黃色圓圈（棒球遊戲的接球提示），落地後淡出
    if (f.land && f.land.u < 1.45) {
      const lf = f.land.u < 1 ? 1 : clamp(1.45 - f.land.u, 0, 0.45) / 0.45, rr = 7 + 2.2 * Math.sin(f.t * 14);
      const ring = projectPoly(c, Array.from({ length: 28 }, (_, i) => { const th = (i / 28) * Math.PI * 2; return [f.land.x + Math.cos(th) * rr, f.land.y + Math.sin(th) * rr, 0.05]; }), true);
      if (ring.length > 2) out += `<polygon points="${ring.map(P).join(' ')}" fill="rgba(255,225,70,.28)" stroke="#ffd84d" stroke-width="3" vector-effect="non-scaling-stroke" opacity="${f2(lf)}"/>`;
    }
    // 跑者
    for (const r of f.runners) {
      const rs = project(c, [r.x, r.y, 0]);
      if (rs && fade > 0.02 && rs.d < 260) {
        out += `<g opacity="${f2(fade)}">${figure(c, (x, z) => [r.x + x * 1.15, r.y, z * 0.82], r.moving ? runPose(f.t * 8) : standPose(), batColor, { dir: 1 })}</g>`;
        if (k < 0.35) continue;
      }
      out += dot([r.x, r.y, 0.8], 1.1, 5.5, `fill="${r.batter ? '#ff9a3c' : batColor}" stroke="#151b26" stroke-width="2" vector-effect="non-scaling-stroke"`);
    }
    // 球的軌跡與球
    if (f.ball && f.m > -1 && (f.scene === 'pitch')) {
      const tp = projectPoly(c, f.trail.map((q) => [q.x, q.y, q.z]), false);
      if (tp.length > 1) out += `<polyline points="${tp.map(P).join(' ')}" fill="none" class="an-tr pm-s-${f.trailCls === 'hit' || f.trailCls === 'foul' || f.trailCls === 'hr' ? f.trailCls : pitchGroup(f.trailCls)}" vector-effect="non-scaling-stroke"/>`;
      const sh = project(c, [f.ball.x, f.ball.y, 0]);
      if (sh && f.ball.z > 0.6) out += `<ellipse cx="${f2(sh.x)}" cy="${f2(sh.y)}" rx="${f2((0.45 * c.F) / sh.d)}" ry="${f2((0.22 * c.F * c.v) / sh.d * Math.max(0.35, Math.sin(Math.atan2(c.f[2] * -1, c.f[1]))))}" fill="rgba(0,0,0,.35)"/>`;
      out += dot([f.ball.x, f.ball.y, f.ball.z], 0.19, 2.4 + 2.6 * k, 'class="an-bc"');
    }
    // 擊中瞬間：往外噴的火花與閃光（位置是球過本壘的地方，隨鏡頭轉場一起移動）
    const ct = f.contact;
    if (ct) {
      const cs = project(c, [ct.x, PLATE_Y, ct.z]);
      if (cs) {
        const fade = 1 - ct.k, R = (0.35 + 1.1 * ct.strength * Math.sqrt(ct.k)) * c.F / cs.d;
        out += `<circle cx="${f2(cs.x)}" cy="${f2(cs.y)}" r="${f2(R * 0.55)}" fill="#fff" opacity="${f2(Math.max(0, fade - 0.35))}"/>`;
        for (let i = 0; i < 14; i++) {
          const an = (i / 14) * Math.PI * 2 + 0.3, r0 = R * 0.45, r1 = R * (0.9 + 0.5 * (i % 3) / 2);
          out += `<line x1="${f2(cs.x + Math.cos(an) * r0)}" y1="${f2(cs.y + Math.sin(an) * r0)}" x2="${f2(cs.x + Math.cos(an) * r1)}" y2="${f2(cs.y + Math.sin(an) * r1)}" stroke="${ct.foul ? '#d3dae2' : '#ffe27a'}" stroke-width="${i % 2 ? 2 : 3}" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity="${f2(fade)}"/>`;
        }
      }
      const amp = 7 * ct.strength * (1 - ct.k) * (1 - ct.k);
      pv.style.transform = `translate(${(Math.sin(ct.k * 55) * amp).toFixed(1)}px, ${(Math.cos(ct.k * 47) * amp).toFixed(1)}px)`;
    } else if (pv.style.transform) pv.style.transform = '';
    pv.innerHTML = out;
  };
  const applyPitch = drawPitch;
  const applyField = (f) => {
    const a = st.clientWidth / Math.max(1, st.clientHeight);
    const cam = f.cam || { cx: 0, y0: -60, y1: 200, minW: 280 };
    const hv = cam.y1 - cam.y0, wv = Math.max(hv * a, cam.minW), hh = wv / a;
    const cy = cam.y0 + hh / 2; // 下緣固定，視窗比需要的高時多出來的留在上方
    svg.setAttribute('viewBox', `${(cam.cx - wv / 2).toFixed(2)} ${(-cy - hh / 2).toFixed(2)} ${wv.toFixed(2)} ${hh.toFixed(2)}`);
    const k = wv / Math.max(1, st.clientWidth); // 1 px 對應幾呎
    f.fielders.forEach((q) => { const c = $e(`.an-fd[data-pos="${q.pos}"]`); c.setAttribute('cx', q.x.toFixed(1)); c.setAttribute('cy', (-q.y).toFixed(1)); c.setAttribute('r', ((q.act ? 5 : 4) * k).toFixed(2)); c.classList.toggle('act', q.act); });
    $e('#anBt').setAttribute('r', (6 * k).toFixed(2)); $e('#anBt').style.display = f.scene === 'field' ? 'none' : '';
    const P = (p) => `${p.x.toFixed(2)},${(-p.y - p.z).toFixed(2)}`;
    const ball = $e('#anBall');
    if (f.ball && f.scene === 'field') {
      ball.style.display = '';
      const bc = $e('#anBc'), sh = $e('#anSh');
      bc.setAttribute('cx', f.ball.x.toFixed(2)); bc.setAttribute('cy', (-f.ball.y - f.ball.z).toFixed(2)); bc.setAttribute('r', (5 * k).toFixed(2));
      sh.setAttribute('cx', f.ball.x.toFixed(2)); sh.setAttribute('cy', (-f.ball.y).toFixed(2)); sh.setAttribute('rx', (4 * k).toFixed(2)); sh.setAttribute('ry', (2 * k).toFixed(2));
    } else ball.style.display = 'none';
    const tr = $e('#anTr');
    tr.setAttribute('points', f.trail && f.scene === 'field' ? f.trail.map(P).join(' ') : '');
    $e('#anTr2').setAttribute('points', f.trail2 && f.scene === 'field' ? f.trail2.map(P).join(' ') : '');
    tr.setAttribute('class', 'an-tr pm-s-' + (f.trailCls === 'hit' || f.trailCls === 'foul' || f.trailCls === 'hr' ? f.trailCls : pitchGroup(f.trailCls)));
    const ld = $e('#anLand');
    if (f.land && f.scene === 'field' && f.land.u < 1.45) {
      ld.setAttribute('cx', f.land.x.toFixed(1)); ld.setAttribute('cy', (-f.land.y).toFixed(1)); ld.setAttribute('r', (7 + 2.2 * Math.sin(f.t * 14)).toFixed(1));
      ld.style.opacity = (f.land.u < 1 ? 1 : clamp(1.45 - f.land.u, 0, 0.45) / 0.45).toFixed(2);
    } else ld.setAttribute('r', 0);
    $e('#anRn').innerHTML = f.runners.filter((r) => !r.gone).map((r) => `<circle class="an-rn${r.batter ? ' b' : ''}" cx="${r.x.toFixed(1)}" cy="${(-r.y).toFixed(1)}" r="${(5.5 * k).toFixed(2)}"/>`).join('');
    // 全壘打過牆瞬間：往四周擴散的火花（角度固定，不用亂數，重播時一樣）
    $e('#anFx').innerHTML = f.fx ? Array.from({ length: 16 }, (_, i) => {
      const ang = (i / 16) * Math.PI * 2, d = (20 + 55 * f.fx.k) * (i % 2 ? 1 : 0.65);
      return `<circle cx="${(f.fx.x + Math.cos(ang) * d).toFixed(1)}" cy="${(-f.fx.y - Math.sin(ang) * d).toFixed(1)}" r="${(3.2 * k * (1 - f.fx.k * 0.6)).toFixed(2)}" fill="${i % 3 ? '#f2c94c' : '#fff'}" opacity="${(1 - f.fx.k).toFixed(2)}"/>`;
    }).join('') : '';
  };
  const applyText = (f) => {
    const c = f.cap;
    const hudEl = $e('.an-hud');
    if (f.hud && (f.scene === 'field' || f.m > 0)) {
      const hu = f.hud;
      const row = (lab, val, unit) => `<div><small>${lab}</small><b>${val}</b><i>${unit}</i></div>`;
      hudEl.innerHTML = `${hu.ev != null ? row(L('初速', 'Exit velo'), hu.ev, 'mph') : ''}${hu.la != null ? row(L('仰角', 'Launch angle'), hu.la, '°') : ''}${row(L('飛行距離', 'Distance'), hu.dist, 'ft')}${hu.air ? row(L('滯空', 'Hang time'), hu.hang.toFixed(1), 's') : ''}${hu.foul ? `<em>${L('界外', 'FOUL')}</em>` : ''}`;
      hudEl.hidden = false;
    } else hudEl.hidden = true;
    $e('.an-bn').hidden = !f.banner;
    // 遊戲式比分板：比分、局數、壘上有人、B/S/O 圓燈
    const b = scorebug(play, prevPlay, f), sig = JSON.stringify(b);
    if (sig !== sbSig) {
      sbSig = sig;
      $e('.sb-sa').textContent = b.away; $e('.sb-sh').textContent = b.home;
      $e('.sb-in').textContent = L(`${b.inning}局${b.half === 'top' ? '上' : '下'}`, `${b.half === 'top' ? 'Top' : 'Bot'} ${b.inning}`);
      el.querySelectorAll('.lp.b i').forEach((d, i) => d.classList.toggle('on', i < b.balls));
      el.querySelectorAll('.lp.s i').forEach((d, i) => d.classList.toggle('on', i < b.strikes));
      el.querySelectorAll('.lp.o i').forEach((d, i) => d.classList.toggle('on', i < b.outs));
      ['b1', 'b2', 'b3'].forEach((k, i) => $e('.sb-d .' + k).classList.toggle('on', b.bases[i]));
      $e('.an-sb').classList.toggle('score', b.scored);
    }
    // 每球結果的大字彈出（STRIKE! / BALL / 揮空…）：球到本壘之後約 0.9 秒
    const pop = $e('.an-pop');
    if (c && c.done && f.t - c.t1 < 0.9 && !f.banner && c.call) {
      const key = String(c.n);
      if (pop.dataset.k !== key) { pop.dataset.k = key; pop.classList.remove('go'); void pop.offsetWidth; pop.classList.add('go'); }
      const POP = { s: ['好球！', 'STRIKE!'], b: ['壞球', 'BALL'], f: ['界外', 'FOUL'], x: ['擊出！', 'HIT!'] };
      pop.textContent = c.call.zh === '揮空' ? L('揮空！', 'SWING & MISS!') : c.call.zh === '觸身球' ? L('觸身球', 'HIT BY PITCH') : L(POP[c.cls][0], POP[c.cls][1]);
      pop.className = `an-pop go ${c.call.zh === '揮空' ? 'w' : c.cls}`; pop.hidden = false;
    } else { pop.hidden = true; pop.dataset.k = ''; }
    // 好球帶面板（像遊戲的投球結果圖）：九宮格＋這個打席每一球的落點
    const zt = sc.zTop, zb = sc.zBot, zx = (x) => 45 + x * 28.2, zy = (z) => 85 - ((z - zb) / (zt - zb)) * 60;
    const zdots = f.zone.map((q, i) => `<circle class="pm-${pitchGroup(q.code)}" cx="${zx(q.x).toFixed(1)}" cy="${zy(q.z).toFixed(1)}" r="${i === f.zone.length - 1 ? 6.5 : 5}" stroke="#151b26" stroke-width="2"/>`).join('');
    const zlast = f.zone[f.zone.length - 1];
    const zring = f.impact && zlast ? `<circle cx="${zx(zlast.x).toFixed(1)}" cy="${zy(zlast.z).toFixed(1)}" r="${(7 + 12 * f.impact.k).toFixed(1)}" fill="none" stroke="#fff" stroke-width="2.5" opacity="${(1 - f.impact.k).toFixed(2)}"/>` : '';
    const zsig = zdots + zring;
    if (zsig !== znSig) { znSig = zsig; $e('.an-zn').innerHTML = `<svg viewBox="0 0 90 110" aria-hidden="true"><rect x="1" y="1" width="88" height="108" rx="12" class="zn-bg"/><rect x="25" y="25" width="40" height="60" class="zn-z"/><path d="M38.3 25V85M51.7 25V85M25 45H65M25 65H65" class="zn-g"/>${zdots}${zring}</svg>`; }
    // 球種與球速（速度條 70~105 mph）
    if (f.evcap) { $e('.in-n').textContent = f.evcap; $e('.in-s').textContent = ''; $e('.in-m i').style.width = '0%'; }
    else if (c || sc.caps[0]) {
      const c = f.cap || sc.caps[0]; // 第一球還沒出手時先顯示這一球的球種與球速
      const nm = ZH() ? PITCH_ZH[c.code] || c.name : c.name;
      $e('.in-n').textContent = `${L('第', 'No.')}${c.n}${L('球', '')}　${nm}`;
      $e('.in-s').textContent = c.speed ? `${Math.round(c.speed)} mph` : '';
      $e('.in-m i').style.width = c.speed ? `${clamp(((c.speed - 70) / 35) * 100, 4, 100).toFixed(0)}%` : '0%';
    }
    // 全壘打：過牆瞬間全螢幕閃一下
    $e('.an-fl').style.opacity = f.fx ? Math.max(0, 0.8 - f.fx.k * 5).toFixed(2) : '0';
  };
  // 播放控制：播放／暫停、時間軸、上一球／下一球。拖時間軸、按上下一球都會先暫停
  const rg = $e('.an-rg'), tm = $e('.an-tm'), pp = $e('.an-pp');
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let playing = !reduce, lastScene = 'pitch';
  const ui = () => {
    rg.value = String(Math.round((t / sc.total) * 1000));
    tm.textContent = `${t.toFixed(1)} / ${sc.total.toFixed(1)}`;
    pp.innerHTML = playing ? IC.pause : IC.play; pp.setAttribute('aria-pressed', String(!playing)); pp.setAttribute('aria-label', playing ? L('暫停', 'Pause') : L('播放', 'Play'));
  };
  const draw = () => {
    const f = frameAt(sc, t);
    if (f.scene === 'pitch' || lastScene === 'pitch') applyPitch(f); // 轉場結束後 3D 場景已經看不到，不必每格重畫
    lastScene = f.scene;
    pv.style.opacity = f.scene === 'pitch' ? 1 : 0; svg.style.opacity = f.scene === 'field' ? 1 : 0;
    applyField(f); applyText(f);
    ui();
  };
  const frame = (now) => {
    raf = 0;
    if (!playing) return;
    if (!last) last = now;
    t = Math.min(sc.total, t + ((now - last) / 1000) * speed); last = now;
    draw();
    if (t < sc.total) raf = requestAnimationFrame(frame); else { playing = false; ui(); }
  };
  const resume = () => { playing = true; last = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); ui(); };
  const pause = () => { playing = false; cancelAnimationFrame(raf); raf = 0; last = 0; ui(); };
  const seekTo = (s) => { t = clamp(s, 0, sc.total); lastScene = 'pitch'; draw(); };
  const pitchStarts = sc.caps.map((c) => c.t0);
  const nextPitch = () => { const n = pitchStarts.find((x) => x > t + 0.05); pause(); seekTo(n != null ? n : sc.total); };
  const prevPitch = () => { const p = [...pitchStarts].reverse().find((x) => x < t - 0.4); pause(); seekTo(p != null ? p : 0); };
  const restart = () => { t = 0; lastScene = 'pitch'; draw(); resume(); };
  const close = () => {
    cancelAnimationFrame(raf); cancelAnimationFrame(rm);
    document.removeEventListener('keydown', onKey);
    el.remove();
    if (opener && opener.focus) try { opener.focus(); } catch (_) {}
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') { // 焦點留在動畫視窗內
      const f = [...el.querySelectorAll('button, input')];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    } else if (e.key === ' ' && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); if (playing) pause(); else if (t >= sc.total) restart(); else resume(); }
    else if (e.key === 'ArrowRight' && document.activeElement !== rg) nextPitch();
    else if (e.key === 'ArrowLeft' && document.activeElement !== rg) prevPitch();
  };
  document.addEventListener('keydown', onKey);
  rg.addEventListener('input', () => { const to = (Number(rg.value) / 1000) * sc.total; pause(); seekTo(to); }); // 先讀值再暫停（暫停會把滑桿同步回目前時間）
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('.an-x')) close();
    else if (e.target.closest('.an-re')) restart();
    else if (e.target.closest('.an-pp')) { if (playing) pause(); else if (t >= sc.total) restart(); else resume(); }
    else if (e.target.closest('.an-nx')) nextPitch();
    else if (e.target.closest('.an-pv')) prevPitch();
    else if (e.target.closest('.an-sp')) {
      speed = speed === 1 ? 0.4 : 1;
      const b = e.target.closest('.an-sp'); b.textContent = `${L('慢動作', 'Slow')} ${speed === 1 ? '1×' : '0.4×'}`; b.setAttribute('aria-pressed', String(speed !== 1));
    }
  });
  $e('.an-x').focus();
  // 系統設定「減少動態效果」：不自動播放，直接停在結果畫面，可用時間軸自己看
  rm = requestAnimationFrame(() => { if (reduce) seekTo(sc.total); else { draw(); resume(); } });
  // 給測試用：跳到指定時間並畫出那一格
  el._ctl = { sc, seek: (s) => { pause(); seekTo(s); }, time: () => t, playing: () => playing, total: sc.total };
  return el._ctl;
}
