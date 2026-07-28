/* Planner — drag task cards from the tray onto a 24-hour day grid.
 * All state lives in localStorage; nothing leaves the device. */

(() => {
  'use strict';

  // ------------------------------------------------------------- constants

  const STORE_KEY = 'planner.v2';
  const LEGACY_KEY = 'planner.v1';
  const THEME_KEY = 'planner.theme';

  const SNAP = 15;          // minutes the grid snaps to
  const MIN_DUR = 15;
  const DAY_MIN = 1440;
  const DRAG_THRESHOLD = 4; // px before a press becomes a drag
  const EDGE = 48;          // px from the edge that triggers auto-scroll
  const TICK_MS = 20000;

  const HOUR_H = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--hour-h')
  ) || 56;
  const PX_PER_MIN = HOUR_H / 60;

  const $ = sel => document.querySelector(sel);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ----------------------------------------------------------------- state

  /** @type {{tasks: Task[]}} */
  let state = { tasks: [] };
  let selectedDay = startOfDay(new Date());
  let showDone = false;

  const els = {};
  ['tray', 'tray-list', 'tray-count', 'tray-empty', 'done-list', 'toggle-done',
   'compose', 'add-btn', 'cancel-compose', 'cal-scroll', 'cal-inner', 'gutter',
   'lanes', 'now-line', 'drop-preview', 'day-label', 'toast', 'notify-btn'
  ].forEach(id => { els[id] = document.getElementById(id); });

  // --------------------------------------------------------------- storage

  function isTask(t) {
    return t && typeof t.id === 'string' && typeof t.title === 'string';
  }

  function normalize(t) {
    return {
      id: t.id,
      title: t.title,
      notes: t.notes || '',
      priority: ['low', 'normal', 'high'].includes(t.priority) ? t.priority : 'normal',
      leadMin: Number.isFinite(t.leadMin) ? t.leadMin : 15,
      durationMin: clamp(Number(t.durationMin) || 60, MIN_DUR, DAY_MIN),
      start: t.start || null,
      done: !!t.done,
      notified: !!t.notified,
      created: t.created || new Date().toISOString(),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.tasks)) state.tasks = parsed.tasks.filter(isTask).map(normalize);
        return;
      }
      // Migrate v1: a `due` date becomes a 1-hour block at that time.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed?.tasks)) {
          state.tasks = parsed.tasks.filter(isTask).map(t =>
            normalize({ ...t, start: t.due || null, durationMin: 60 }));
          save();
          toast('Upgraded your tasks to the new schedule view.');
        }
      }
    } catch (err) {
      console.warn('Could not read saved tasks:', err);
      toast('Saved tasks could not be read; starting fresh.');
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save:', err);
      toast('Out of storage — changes may not persist.');
    }
  }

  const byId = id => state.tasks.find(t => t.id === id);

  // ----------------------------------------------------------------- dates

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function isSameDay(a, b) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
  function minutesInto(iso) { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }

  function isoAt(day, minutes) {
    const d = new Date(day);
    d.setHours(0, minutes, 0, 0);
    return d.toISOString();
  }

  function fmtTime(minutes) {
    const h24 = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
  }

  function fmtDuration(min) {
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function fmtDayLabel(day) {
    const today = startOfDay(new Date());
    const diff = Math.round((startOfDay(day) - today) / 86400000);
    const base = day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    if (diff === 0) return `${base} · Today`;
    if (diff === 1) return `${base} · Tomorrow`;
    if (diff === -1) return `${base} · Yesterday`;
    return base;
  }

  // ------------------------------------------------------------ task model

  function addTask(fields) {
    const t = normalize({ id: crypto.randomUUID(), ...fields });
    state.tasks.push(t);
    save();
    renderAll();
    return t;
  }

  function schedule(id, day, minutes) {
    const t = byId(id);
    if (!t) return;
    t.start = isoAt(day, clamp(minutes, 0, DAY_MIN - t.durationMin));
    t.notified = false; // a moved task deserves a fresh reminder
    save();
    renderAll();
  }

  function unschedule(id) {
    const t = byId(id);
    if (!t) return;
    t.start = null;
    t.notified = false;
    save();
    renderAll();
  }

  function setDuration(id, minutes) {
    const t = byId(id);
    if (!t) return;
    const startMin = t.start ? minutesInto(t.start) : 0;
    t.durationMin = clamp(minutes, MIN_DUR, DAY_MIN - startMin);
    save();
    renderAll();
  }

  function toggleDone(id) {
    const t = byId(id);
    if (!t) return;
    t.done = !t.done;
    if (t.done) t.notified = true;
    save();
    renderAll();
  }

  function removeTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    save();
    renderAll();
  }

  /** First SNAP-aligned slot on `day` that no scheduled task occupies. */
  function firstFreeSlot(day, durationMin) {
    const busy = eventsOn(day).map(t => [minutesInto(t.start), minutesInto(t.start) + t.durationMin]);
    const now = isSameDay(day, new Date())
      ? Math.ceil((new Date().getHours() * 60 + new Date().getMinutes()) / SNAP) * SNAP
      : 9 * 60;
    for (let m = now; m <= DAY_MIN - durationMin; m += SNAP) {
      if (!busy.some(([s, e]) => m < e && m + durationMin > s)) return m;
    }
    return clamp(now, 0, DAY_MIN - durationMin);
  }

  const eventsOn = day => state.tasks
    .filter(t => t.start && isSameDay(t.start, day))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  // ---------------------------------------------------------------- render

  function renderAll() {
    renderDayLabel();
    renderTray();
    renderCalendar();
    updateNow();
  }

  function renderDayLabel() {
    els['day-label'].textContent = fmtDayLabel(selectedDay);
  }

  function cardHTML(t) {
    const meta = [fmtDuration(t.durationMin)];
    if (t.priority === 'high') meta.push('High priority');
    return `
      <article class="card prio-${t.priority}${t.done ? ' is-done' : ''}"
               data-id="${t.id}" tabindex="0"
               aria-label="${esc(t.title)}, unscheduled">
        <button class="check" data-act="toggle" aria-label="Mark ${t.done ? 'not done' : 'done'}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        </button>
        <div class="card-body">
          <div class="card-title">${esc(t.title)}</div>
          ${t.notes ? `<div class="card-notes">${esc(t.notes)}</div>` : ''}
          <div class="card-meta">${meta.join(' · ')}</div>
        </div>
        <button class="del" data-act="delete" aria-label="Delete task">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </article>`;
  }

  function renderTray() {
    const open = state.tasks.filter(t => !t.start && !t.done);
    const done = state.tasks.filter(t => t.done);

    els['tray-list'].innerHTML = open.map(cardHTML).join('');
    els['tray-count'].textContent = open.length;
    els['tray-empty'].hidden = open.length > 0;

    els['toggle-done'].textContent = `${showDone ? 'Hide' : 'Show'} completed (${done.length})`;
    els['toggle-done'].setAttribute('aria-expanded', String(showDone));
    els['done-list'].hidden = !showDone;
    els['done-list'].innerHTML = showDone ? done.map(cardHTML).join('') : '';
  }

  function buildGutter() {
    els['cal-inner'].style.height = `${24 * HOUR_H}px`;
    let html = '';
    for (let h = 0; h <= 24; h++) {
      const label = h === 0 || h === 24 ? '12 AM' : fmtTime(h * 60).replace(':00', '');
      // The first and last labels sit flush against the edges, so they get
      // shifted fully inside instead of straddling their hour line.
      const shift = h === 0 ? '0' : h === 24 ? '-100%' : '-50%';
      html += `<div class="hour-label" style="top:${h * HOUR_H}px;transform:translateY(${shift})">${label}</div>`;
    }
    els.gutter.innerHTML = html;
  }

  /** Google-Calendar-style side-by-side columns for overlapping blocks. */
  function assignColumns(events) {
    const laid = events.map(t => ({
      task: t,
      s: minutesInto(t.start),
      e: minutesInto(t.start) + t.durationMin,
      col: 0, cols: 1,
    }));

    let cluster = [];
    let clusterEnd = -1;

    const flush = () => {
      if (!cluster.length) return;
      const colEnds = [];
      for (const item of cluster) {
        let idx = colEnds.findIndex(end => end <= item.s);
        if (idx === -1) idx = colEnds.length;
        colEnds[idx] = item.e;
        item.col = idx;
      }
      cluster.forEach(item => { item.cols = colEnds.length; });
      cluster = [];
      clusterEnd = -1;
    };

    for (const item of laid) {
      if (cluster.length && item.s >= clusterEnd) flush();
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.e);
    }
    flush();

    return laid;
  }

  function renderCalendar() {
    els.lanes.querySelectorAll('.event').forEach(n => n.remove());

    for (const item of assignColumns(eventsOn(selectedDay))) {
      const { task: t, s, col, cols } = item;
      const height = Math.max(t.durationMin * PX_PER_MIN, 16);
      const widthPct = 100 / cols;

      const el = document.createElement('article');
      el.className = `event prio-${t.priority}${t.done ? ' is-done' : ''}${height < 34 ? ' is-short' : ''}`;
      el.dataset.id = t.id;
      el.tabIndex = 0;
      el.style.top = `${s * PX_PER_MIN}px`;
      el.style.height = `${height}px`;
      el.style.left = `calc(${col * widthPct}% + 4px)`;
      el.style.width = `calc(${widthPct}% - 8px)`;
      el.setAttribute('aria-label',
        `${t.title}, ${fmtTime(s)} to ${fmtTime(s + t.durationMin)}`);

      el.innerHTML = `
        <button class="check" data-act="toggle" aria-label="Mark ${t.done ? 'not done' : 'done'}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        </button>
        <div class="event-body">
          <div class="event-title">${esc(t.title)}</div>
          <div class="event-time">${fmtTime(s)} – ${fmtTime(s + t.durationMin)}</div>
        </div>
        <button class="del" data-act="delete" aria-label="Delete task">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <div class="resize-handle" data-act="resize" aria-hidden="true"></div>`;

      els.lanes.appendChild(el);
    }
  }

  function updateNow() {
    const line = els['now-line'];
    if (!isSameDay(selectedDay, new Date())) { line.hidden = true; return; }
    const now = new Date();
    line.hidden = false;
    line.style.top = `${(now.getHours() * 60 + now.getMinutes()) * PX_PER_MIN}px`;
  }

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3400);
  }

  // ------------------------------------------------------------------ drag

  /** @type {null | {id:string, mode:'move'|'resize', ...}} */
  let drag = null;
  let autoScrollFrame = null;

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('[data-act="toggle"], [data-act="delete"]')) return;

    const host = e.target.closest('.card, .event');
    if (!host) return;

    const id = host.dataset.id;
    const t = byId(id);
    if (!t) return;

    const rect = host.getBoundingClientRect();
    const resizing = !!e.target.closest('[data-act="resize"]');

    drag = {
      id, mode: resizing ? 'resize' : 'move',
      host, task: t,
      startX: e.clientX, startY: e.clientY,
      grabDX: e.clientX - rect.left,
      grabDY: clamp(e.clientY - rect.top, 0, Math.max(t.durationMin * PX_PER_MIN - 1, 0)),
      width: rect.width,
      started: false,
      lastX: e.clientX, lastY: e.clientY,
      ghost: null,
      dropMin: null,
      newDuration: t.durationMin,
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function beginDrag() {
    drag.started = true;
    document.body.classList.add('is-dragging');

    if (drag.mode === 'move') {
      const ghost = drag.host.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.classList.remove('is-source');
      ghost.style.width = `${drag.width}px`;
      ghost.style.height = '';
      ghost.style.left = '0px';
      ghost.style.top = '0px';
      ghost.removeAttribute('tabindex');
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      drag.host.classList.add('is-source');
    }
    startAutoScroll();
  }

  function onPointerMove(e) {
    if (!drag) return;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;

    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      beginDrag();
    }

    if (drag.mode === 'move') updateMove();
    else updateResize();
  }

  function updateMove() {
    drag.ghost.style.transform =
      `translate(${drag.lastX - drag.grabDX}px, ${drag.lastY - drag.grabDY}px) rotate(1deg)`;

    const min = minutesFromPoint(drag.lastX, drag.lastY, drag.task.durationMin);
    drag.dropMin = min;

    const overTray = pointInEl(els.tray, drag.lastX, drag.lastY);
    els.tray.classList.toggle('is-drop-target', min === null && overTray);
    els.lanes.classList.toggle('is-drop-target', min !== null);

    const preview = els['drop-preview'];
    if (min === null) { preview.hidden = true; return; }
    preview.hidden = false;
    preview.style.top = `${min * PX_PER_MIN}px`;
    preview.style.height = `${Math.max(drag.task.durationMin * PX_PER_MIN, 16)}px`;
    preview.innerHTML = `<span class="drop-time">${fmtTime(min)} – ${fmtTime(min + drag.task.durationMin)}</span>`;
  }

  function updateResize() {
    const lanesRect = els.lanes.getBoundingClientRect();
    const startMin = minutesInto(drag.task.start);
    const bottomMin = (drag.lastY - lanesRect.top) / PX_PER_MIN;
    const dur = clamp(
      Math.round((bottomMin - startMin) / SNAP) * SNAP,
      MIN_DUR, DAY_MIN - startMin
    );
    drag.newDuration = dur;

    drag.host.style.height = `${Math.max(dur * PX_PER_MIN, 16)}px`;
    const time = drag.host.querySelector('.event-time');
    if (time) time.textContent = `${fmtTime(startMin)} – ${fmtTime(startMin + dur)}`;
  }

  /** Snapped start minute for a pointer position, or null if outside the grid. */
  function minutesFromPoint(x, y, durationMin) {
    const r = els.lanes.getBoundingClientRect();
    const scroll = els['cal-scroll'].getBoundingClientRect();
    // Must be horizontally over the lanes and vertically inside the viewport of the scroller
    if (x < r.left || x > r.right || y < scroll.top || y > scroll.bottom) return null;

    const top = y - r.top - drag.grabDY;
    return clamp(Math.round(top / PX_PER_MIN / SNAP) * SNAP, 0, DAY_MIN - durationMin);
  }

  function pointInEl(el, x, y) {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function startAutoScroll() {
    const step = () => {
      if (!drag || !drag.started) return;
      const r = els['cal-scroll'].getBoundingClientRect();
      const { lastX: x, lastY: y } = drag;

      if (x >= r.left && x <= r.right) {
        if (y < r.top + EDGE) els['cal-scroll'].scrollTop -= Math.ceil((r.top + EDGE - y) / 6);
        else if (y > r.bottom - EDGE) els['cal-scroll'].scrollTop += Math.ceil((y - (r.bottom - EDGE)) / 6);
        else { autoScrollFrame = requestAnimationFrame(step); return; }
        if (drag.mode === 'move') updateMove(); else updateResize();
      }
      autoScrollFrame = requestAnimationFrame(step);
    };
    autoScrollFrame = requestAnimationFrame(step);
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (autoScrollFrame) { cancelAnimationFrame(autoScrollFrame); autoScrollFrame = null; }

    const d = drag;
    drag = null;

    if (!d || !d.started) {
      // A plain click — nothing to commit.
      if (d) d.host.classList.remove('is-source');
      return;
    }

    document.body.classList.remove('is-dragging');
    els.tray.classList.remove('is-drop-target');
    els.lanes.classList.remove('is-drop-target');
    els['drop-preview'].hidden = true;
    if (d.ghost) d.ghost.remove();
    d.host.classList.remove('is-source');

    if (d.mode === 'resize') {
      setDuration(d.id, d.newDuration);
      return;
    }

    if (d.dropMin !== null) {
      schedule(d.id, selectedDay, d.dropMin);
    } else if (pointInEl(els.tray, d.lastX, d.lastY)) {
      if (d.task.start) { unschedule(d.id); toast('Moved back to unscheduled.'); }
      else renderAll();
    } else {
      renderAll(); // dropped nowhere — snap back
    }
  }

  // -------------------------------------------------------------- keyboard

  function onKeyDown(e) {
    const host = e.target.closest?.('.card, .event');
    if (!host) return;
    const t = byId(host.dataset.id);
    if (!t) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeTask(t.id);
      return;
    }

    if (!t.start) {
      // Tray card: Enter drops it into the first free slot of the shown day.
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const min = firstFreeSlot(selectedDay, t.durationMin);
        schedule(t.id, selectedDay, min);
        toast(`Scheduled at ${fmtTime(min)}.`);
      }
      return;
    }

    // Scheduled block: arrows nudge it, Enter sends it back to the tray.
    const startMin = minutesInto(t.start);
    const stepMin = e.shiftKey ? 60 : SNAP;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? -stepMin : stepMin;
      schedule(t.id, selectedDay, clamp(startMin + delta, 0, DAY_MIN - t.durationMin));
      refocus(t.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      unschedule(t.id);
      refocus(t.id);
    }
  }

  function refocus(id) {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.focus();
  }

  // ------------------------------------------------------------- reminders

  function checkReminders() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    let changed = false;

    for (const t of state.tasks) {
      if (t.done || t.notified || !t.start || t.leadMin < 0) continue;
      const at = new Date(t.start).getTime() - t.leadMin * 60000;
      if (at > now || now - at > 86400000) continue; // not yet, or too stale to bother

      try {
        new Notification(t.title, {
          body: `Starts ${fmtTime(minutesInto(t.start))}${t.notes ? '\n' + t.notes : ''}`,
          tag: t.id,
          icon: './icon-192.png',
        });
      } catch (err) {
        console.warn('Notification failed:', err);
      }
      t.notified = true;
      changed = true;
    }
    if (changed) { save(); renderAll(); }
  }

  async function requestNotifications() {
    if (!('Notification' in window)) { toast('This browser does not support notifications.'); return; }
    await Notification.requestPermission();
    updateNotifyButton();
    if (Notification.permission === 'granted') {
      toast('Reminders on. They fire while Planner is open.');
      checkReminders();
    } else {
      toast('Reminders blocked — enable them in site settings.');
    }
  }

  function updateNotifyButton() {
    const btn = els['notify-btn'];
    if (!('Notification' in window)) { btn.hidden = true; return; }
    btn.hidden = Notification.permission === 'granted';
    btn.textContent = Notification.permission === 'denied' ? 'Reminders blocked' : 'Enable reminders';
  }

  // ----------------------------------------------------------- theme & I/O

  function applyTheme(mode) {
    if (mode) document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme')
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `planner-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJSON(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = (parsed?.tasks || []).filter(isTask).map(normalize);
      if (!incoming.length) { toast('No tasks found in that file.'); return; }

      const seen = new Set(state.tasks.map(t => t.id));
      const added = incoming.filter(t => !seen.has(t.id));
      state.tasks.push(...added);
      save();
      renderAll();
      toast(`Imported ${added.length} task${added.length === 1 ? '' : 's'}.`);
    } catch (err) {
      console.warn('Import failed:', err);
      toast('That file is not valid Planner JSON.');
    }
  }

  // ---------------------------------------------------------------- events

  function goToDay(date) {
    selectedDay = startOfDay(date);
    renderAll();
  }

  function wire() {
    // day navigation
    $('#prev-day').addEventListener('click', () =>
      goToDay(new Date(selectedDay.getTime() - 86400000)));
    $('#next-day').addEventListener('click', () =>
      goToDay(new Date(selectedDay.getTime() + 86400000)));
    $('#today-btn').addEventListener('click', () => { goToDay(new Date()); scrollToNow(); });

    // compose
    els['add-btn'].addEventListener('click', () => {
      els.compose.hidden = !els.compose.hidden;
      if (!els.compose.hidden) $('#f-title').focus();
    });
    els['cancel-compose'].addEventListener('click', () => {
      els.compose.hidden = true;
      els.compose.reset();
    });
    els.compose.addEventListener('submit', e => {
      e.preventDefault();
      const title = $('#f-title').value.trim();
      if (!title) return;
      addTask({
        title,
        notes: $('#f-notes').value,
        durationMin: Number($('#f-duration').value),
        priority: $('#f-priority').value,
        leadMin: Number($('#f-lead').value),
        start: null,
      });
      els.compose.reset();
      $('#f-duration').value = '60';
      $('#f-priority').value = 'normal';
      $('#f-lead').value = '15';
      $('#f-title').focus();
    });
    els.compose.addEventListener('keydown', e => {
      if (e.key === 'Escape') { els.compose.hidden = true; els.compose.reset(); }
    });

    // check / delete, delegated across tray and calendar
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-act="toggle"], [data-act="delete"]');
      if (!btn) return;
      const id = btn.closest('[data-id]').dataset.id;
      if (btn.dataset.act === 'toggle') toggleDone(id);
      else removeTask(id);
    });

    // drag + keyboard
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    els['toggle-done'].addEventListener('click', () => { showDone = !showDone; renderTray(); });
    els['notify-btn'].addEventListener('click', requestNotifications);
    $('#theme-btn').addEventListener('click', toggleTheme);
    $('#export-btn').addEventListener('click', exportJSON);
    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', e => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    });

    $('#clear-done').addEventListener('click', () => {
      const n = state.tasks.filter(t => t.done).length;
      if (!n) { toast('No completed tasks to clear.'); return; }
      if (!confirm(`Delete ${n} completed task${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
      state.tasks = state.tasks.filter(t => !t.done);
      save();
      renderAll();
    });

    // keep other tabs in sync
    window.addEventListener('storage', e => {
      if (e.key !== STORE_KEY) return;
      load();
      renderAll();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { renderAll(); checkReminders(); }
    });
  }

  function scrollToNow() {
    const now = new Date();
    const target = isSameDay(selectedDay, now)
      ? (now.getHours() * 60 + now.getMinutes()) * PX_PER_MIN - 160
      : 8 * HOUR_H;
    els['cal-scroll'].scrollTop = Math.max(0, target);
  }

  // ------------------------------------------------------------------ init

  applyTheme(localStorage.getItem(THEME_KEY));
  load();
  buildGutter();
  wire();
  updateNotifyButton();
  renderAll();
  scrollToNow();
  checkReminders();

  setInterval(checkReminders, TICK_MS);
  setInterval(updateNow, 30000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW failed:', err));
    });
  }
})();
