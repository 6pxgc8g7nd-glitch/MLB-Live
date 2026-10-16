/* 手勢：比分頁左右滑動換日、比分頁下拉更新 */
import { $ } from './util.js';
import { view, route$ } from './state.js';
import { stepDay } from './shell.js';

// 只在比分頁：整個畫面左右滑動換日。往左滑＝後一天（舊內容往左滑出，新日期從右邊滑進來），往右滑＝前一天。
// 其他頁面（排名、設定、比賽頁）不會因為左右滑動而換頁，換頁用下方的分頁列。
export function initSwipe() {
  const DUR = 200, EASE = 'cubic-bezier(.22,.8,.3,1)';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let d = null, busy = false, mute = 0;
  const W = () => innerWidth;
  const pose = (x, o) => { view.style.transform = `translate3d(${x}px,0,0)`; view.style.opacity = String(o); };
  const clean = () => ['transform', 'opacity', 'transition', 'will-change'].forEach((p) => view.style.removeProperty(p));
  const tr = (on) => { view.style.transition = on ? `transform ${DUR}ms ${EASE}, opacity ${DUR}ms ease` : 'none'; };

  document.addEventListener('pointerdown', (e) => {
    if (busy || route$ !== 'scores' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.clientX < 24) return; // 螢幕最左緣留給系統的返回手勢
    if (e.target.closest('.top, .tabbar, .fsheet, .cal, .scroll, input, select, textarea')) return;
    d = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, lock: 0, v: 0, lx: e.clientX, lt: e.timeStamp };
  });
  document.addEventListener('pointermove', (e) => {
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.lock) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.3) { d = null; return; } // 以直向捲動為主
      d.lock = 1; view.style.willChange = 'transform, opacity';
    }
    d.dx = dx;
    const dt = e.timeStamp - d.lt;
    if (dt > 0) d.v = 0.8 * d.v + 0.2 * ((e.clientX - d.lx) / dt);
    d.lx = e.clientX; d.lt = e.timeStamp;
    tr(false); pose(dx * 0.5, 1 - Math.min(0.45, Math.abs(dx) / W()));
  });
  const end = (e) => {
    if (!d || d.id !== e.pointerId) return;
    const s = d; d = null;
    if (!s.lock) return;
    mute = Date.now() + 350;
    const w = W(), dir = s.dx < 0 ? 1 : -1;
    const fast = Math.abs(s.v) > 0.5 && Math.sign(s.v) === -dir;
    const commit = e.type === 'pointerup' && (Math.abs(s.dx) > w * 0.28 || (fast && Math.abs(s.dx) > 40));
    const later = (fn, ms) => setTimeout(fn, reduce ? 0 : ms);
    busy = true;
    if (!commit) { tr(true); pose(0, 1); later(() => { clean(); busy = false; }, DUR + 30); return; }
    tr(true); pose(-dir * w * 0.45, 0); // 舊內容往滑動的方向滑出去
    later(() => {
      window.scrollTo(0, 0);
      stepDay(dir); // 換日並載入新內容
      tr(false); pose(dir * w * 0.45, 0); // 新內容從另一側滑進來
      requestAnimationFrame(() => requestAnimationFrame(() => {
        tr(true); pose(0, 1);
        later(() => { clean(); busy = false; }, DUR + 30);
      }));
    }, DUR + 20);
  };
  document.addEventListener('dragstart', (e) => { if (d) e.preventDefault(); }); // 滑鼠拖曳比賽卡片（連結）時不要啟動瀏覽器的拖放
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  document.addEventListener('click', (e) => { if (Date.now() < mute) { e.preventDefault(); e.stopPropagation(); } }, true); // 滑鼠拖曳放開時不要誤觸點擊
}

export function initPull(refresh) {
  const THRESH = 56;                    // 內容被拉下的距離（已套用阻力）超過這個值，放開才會更新
  let t0 = null, busy = false, saved = '';
  const note = (txt) => { const u = $('#updated'); if (u) { if (txt) u.textContent = txt; else if (saved) u.textContent = saved; } };
  const reset = (anim) => {
    view.style.transition = anim ? 'transform .26s cubic-bezier(.22,.8,.3,1)' : 'none';
    view.style.transform = '';
    setTimeout(() => { if (!t0) view.style.removeProperty('transition'); }, 300);
  };
  document.addEventListener('touchstart', (e) => {
    t0 = null;
    if (busy || route$ !== 'scores' || e.touches.length !== 1 || window.scrollY > 0) return;
    if (e.target.closest('.top, .tabbar, .fsheet, .cal, .scroll')) return;
    const t = e.touches[0];
    t0 = { x: t.clientX, y: t.clientY, lock: 0, pull: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!t0) return;
    const t = e.touches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
    if (!t0.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) { t0 = null; return; }
      t0.lock = 1;
      const u = $('#updated'); saved = u ? u.textContent : '';
    }
    const pull = Math.min(110, dy * 0.5);
    t0.pull = pull;
    view.style.transition = 'none';
    view.style.transform = `translate3d(0,${pull}px,0)`;
    note(pull >= THRESH ? '放開更新' : '下拉更新');
  }, { passive: true });
  const end = async () => {
    const s = t0; t0 = null;
    if (!s || !s.lock) return;
    if (s.pull >= THRESH) {
      busy = true;
      reset(true);
      note('更新中…');
      try { await refresh(); } catch (e) { /* 失敗由橫幅顯示 */ }
      busy = false;
      const u = $('#updated'); if (u && u.textContent === '更新中…') u.textContent = saved;
    } else {
      reset(true);
      note(saved);
    }
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
}
