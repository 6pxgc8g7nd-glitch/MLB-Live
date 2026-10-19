/* 打席動畫的畫面：球場俯視 SVG、捕手視角的 3D 場景（cam3d.js）、雷達面板、控制列。時間表與每一格的狀態來自 anim-script.js。 */
import { esc } from './util.js';
import { evZh } from './dict.js';
import { S } from './state.js';
import { PITCH_ZH } from './pitches.js';
import { IC } from './icons.js';
import { teamAbbr, teamColor } from './dict.js';
import { pitchGroup } from './pitchmap.js';
import { createStage } from './anim-3d.js';
import { FIELD_POS as POS, buildScript, frameAt, batPose, pitcherPose, standPose, runPose, crouchPose, clamp, scorebug } from './anim-script.js';
/* ───────── 畫面 ───────── */
const ZH = () => S.lang !== 'en';
const L = (zh, en) => (ZH() ? zh : en);

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
    <div class="an-st">      <div class="an-bcard"><i class="cc"></i><div><small>${L('打者', 'AT BAT')}</small><b class="bc-n"></b><span class="bc-s"></span></div></div>
      <div class="an-pcard"><i class="cc"></i><div><small>${L('投手', 'PITCHING')}</small><b class="bc-n"></b><span class="bc-s"></span></div></div>
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
  const st = $e('.an-st');
  let sbSig = '', znSig = null;
  const half = play.about && play.about.halfInning === 'bottom' ? 'bottom' : 'top';
  const batTeam = gd && gd.teams && gd.teams[half === 'top' ? 'away' : 'home'], pitTeam = gd && gd.teams && gd.teams[half === 'top' ? 'home' : 'away'];
  const batColor = teamColor(batTeam), pitColor = teamColor(pitTeam), pitDir = m.pitchHand && m.pitchHand.code === 'L' ? 1 : -1; // 右投的投球手在捕手視角的左邊
  { // 比分板上的球隊簡稱與顏色；球員的球衣顏色也用在 2D 球場畫面的圓點上（--def 守備、--off 進攻）
    const away = gd && gd.teams && gd.teams.away, home = gd && gd.teams && gd.teams.home;
    $e('.sb-a').textContent = teamAbbr(away) || 'AWAY'; $e('.sb-h').textContent = teamAbbr(home) || 'HOME';
    $e('.sb-c.a').style.background = teamColor(away); $e('.sb-c.h').style.background = teamColor(home);
    el.style.setProperty('--def', pitColor); el.style.setProperty('--off', batColor);
    el.querySelector('.an-bcard .cc').style.background = batColor; el.querySelector('.an-pcard .cc').style.background = pitColor;
    const bsx = feed && feed.liveData && feed.liveData.boxscore && feed.liveData.boxscore.teams;
    const find = (id) => { for (const sd of ['away', 'home']) { const p = bsx && bsx[sd] && bsx[sd].players && bsx[sd].players['ID' + id]; if (p) return p; } return null; };
    const bp = find(m.batter && m.batter.id), pp2 = find(m.pitcher && m.pitcher.id);
    const HB = { R: L('右打', 'R'), L: L('左打', 'L'), S: L('左右開弓', 'S') }, HP = { R: L('右投', 'R'), L: L('左投', 'L') };
    const avg = bp && bp.seasonStats && bp.seasonStats.batting && bp.seasonStats.batting.avg, era = pp2 && pp2.seasonStats && pp2.seasonStats.pitching && pp2.seasonStats.pitching.era;
    el.querySelector('.an-bcard .bc-n').textContent = bat; el.querySelector('.an-pcard .bc-n').textContent = pit;
    el.querySelector('.an-bcard .bc-s').textContent = [bp && bp.jerseyNumber ? '#' + bp.jerseyNumber : '', HB[m.batSide && m.batSide.code], avg ? `AVG ${avg}` : ''].filter(Boolean).join(' · ');
    el.querySelector('.an-pcard .bc-s').textContent = [pp2 && pp2.jerseyNumber ? '#' + pp2.jerseyNumber : '', HP[m.pitchHand && m.pitchHand.code], era ? `ERA ${era}` : ''].filter(Boolean).join(' · ');
  }
  const dir = rightie ? 1 : -1;
  let stage;
  try { stage = createStage(st, { batColor, pitColor, dir, pitDir, positions: POS }); } catch (e) { el.remove(); return null; } // 沒有 WebGL 的裝置：不開動畫
  const opener = document.activeElement;
  let t = 0, speed = 1, raf = 0, last = 0, rm = 0;

  const bits = [];
  if (R.rbi) bits.push(L(`${R.rbi} 分打點`, `${R.rbi} RBI`));
  $e('.an-bn b').textContent = sc.hr ? L('全壘打！', 'HOME RUN!') : (ZH() ? evZh(R.event) : R.event) || '';
  $e('.an-bn small').textContent = bits.join(' · ');
  $e('.an-bn').classList.toggle('hr', !!sc.hr);

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
  let playing = !reduce;
  const ui = () => {
    rg.value = String(Math.round((t / sc.total) * 1000));
    tm.textContent = `${t.toFixed(1)} / ${sc.total.toFixed(1)}`;
    pp.innerHTML = playing ? IC.pause : IC.play; pp.setAttribute('aria-pressed', String(!playing)); pp.setAttribute('aria-label', playing ? L('暫停', 'Pause') : L('播放', 'Play'));
  };
  const pose3d = { batPose, pitcherPose, standPose, runPose, crouchPose };
  const draw = () => {
    const f = frameAt(sc, t);
    stage.render(f, sc, pose3d);
    const ct = f.contact; // 擊中瞬間畫面震動
    const amp = ct ? 7 * ct.strength * (1 - ct.k) * (1 - ct.k) : 0;
    stage.canvas.style.transform = ct ? `translate(${(Math.sin(ct.k * 55) * amp).toFixed(1)}px, ${(Math.cos(ct.k * 47) * amp).toFixed(1)}px)` : '';
    applyText(f);
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
  const seekTo = (s) => { t = clamp(s, 0, sc.total); draw(); };
  const pitchStarts = sc.caps.map((c) => c.t0);
  const nextPitch = () => { const n = pitchStarts.find((x) => x > t + 0.05); pause(); seekTo(n != null ? n : sc.total); };
  const prevPitch = () => { const p = [...pitchStarts].reverse().find((x) => x < t - 0.4); pause(); seekTo(p != null ? p : 0); };
  const restart = () => { t = 0; draw(); resume(); };
  const close = () => {
    cancelAnimationFrame(raf); cancelAnimationFrame(rm);
    document.removeEventListener('keydown', onKey);
    stage.dispose();
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
