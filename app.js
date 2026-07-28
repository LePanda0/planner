/* Planner — local-first task planning with browser reminders.
 * State lives in localStorage; nothing leaves the device. */

(() => {
  'use strict';

  const STORE_KEY = 'planner.v1';
  const THEME_KEY = 'planner.theme';
  const TICK_MS = 20000; // how often we check for due reminders

  /** @type {{tasks: Task[]}} */
  let state = { tasks: [] };
  let view = 'today';

  // ---------------------------------------------------------------- storage

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.tasks)) state.tasks = parsed.tasks.filter(isTask);
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

  function isTask(t) {
    return t && typeof t.id === 'string' && typeof t.title === 'string';
  }

  // ------------------------------------------------------------------ model

  function addTask({ title, notes, due, leadMin, priority }) {
    state.tasks.push({
      id: crypto.randomUUID(),
      title: title.trim(),
      notes: (notes || '').trim(),
      due: due || null,          // ISO string, or null for "someday"
      leadMin,                   // minutes before due to remind; -1 = never
      priority,                  // low | normal | high
      done: false,
      notified: false,
      created: new Date().toISOString(),
    });
    save();
    render();
  }

  function toggleDone(id) {
    const t = state.tasks.find(t => t.id === id);
    if (!t) return;
    t.done = !t.done;
    if (t.done) t.notified = true; // don't nag about finished work
    save();
    render();
  }

  function removeTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    save();
    render();
  }

  // ------------------------------------------------------------------ dates

  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const dayDiff = iso => Math.round((startOfDay(iso) - startOfDay(new Date())) / 86400000);

  function bucketOf(t) {
    if (t.done) return 'done';
    if (!t.due) return 'someday';
    return dayDiff(t.due) <= 0 ? 'today' : 'upcoming'; // overdue counts as today
  }

  function formatDue(iso) {
    const d = new Date(iso);
    const days = dayDiff(iso);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (days === 0) return `Today, ${time}`;
    if (days === 1) return `Tomorrow, ${time}`;
    if (days === -1) return `Yesterday, ${time}`;
    if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: 'long' })}, ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
  }

  function leadLabel(min) {
    if (min < 0) return null;
    if (min === 0) return 'at due time';
    if (min < 60) return `${min}m before`;
    if (min < 1440) return `${min / 60}h before`;
    return `${min / 1440}d before`;
  }

  // -------------------------------------------------------------- reminders

  function reminderAt(t) {
    if (!t.due || t.leadMin < 0) return null;
    return new Date(t.due).getTime() - t.leadMin * 60000;
  }

  function checkReminders() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    let changed = false;

    for (const t of state.tasks) {
      if (t.done || t.notified) continue;
      const at = reminderAt(t);
      // Fire if the moment has passed, but not for stale items (>1 day late)
      if (at === null || at > now || now - at > 86400000) continue;

      try {
        new Notification(t.title, {
          body: `Due ${formatDue(t.due)}${t.notes ? '\n' + t.notes : ''}`,
          tag: t.id,
          icon: './icon-192.png',
        });
      } catch (err) {
        console.warn('Notification failed:', err);
      }
      t.notified = true;
      changed = true;
    }

    if (changed) { save(); render(); }
  }

  async function requestNotifications() {
    if (!('Notification' in window)) {
      toast('This browser does not support notifications.');
      return;
    }
    const result = await Notification.requestPermission();
    updateNotifyButton();
    if (result === 'granted') {
      toast('Reminders on. They fire while Planner is open.');
      checkReminders();
    } else {
      toast('Reminders blocked — enable them in site settings.');
    }
  }

  function updateNotifyButton() {
    const btn = $('#notify-btn');
    if (!('Notification' in window)) { btn.hidden = true; return; }
    const granted = Notification.permission === 'granted';
    btn.hidden = granted;
    btn.textContent = Notification.permission === 'denied' ? 'Reminders blocked' : 'Enable reminders';
  }

  // ----------------------------------------------------------------- render

  const $ = sel => document.querySelector(sel);
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const EMPTY_TEXT = {
    today: 'Nothing due today. Enjoy it.',
    upcoming: 'No upcoming tasks scheduled.',
    someday: 'No unscheduled tasks.',
    done: 'Nothing completed yet.',
  };

  function sortTasks(a, b) {
    if (a.due && b.due) return new Date(a.due) - new Date(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    const rank = { high: 0, normal: 1, low: 2 };
    return rank[a.priority] - rank[b.priority] || new Date(a.created) - new Date(b.created);
  }

  function render() {
    // tab counts
    const counts = { today: 0, upcoming: 0, someday: 0, done: 0 };
    for (const t of state.tasks) counts[bucketOf(t)]++;
    for (const [key, n] of Object.entries(counts)) {
      $(`[data-count="${key}"]`).textContent = n;
    }

    const visible = state.tasks.filter(t => bucketOf(t) === view).sort(sortTasks);
    if (view === 'done') visible.reverse();

    const list = $('#list');
    const empty = $('#empty');

    if (!visible.length) {
      list.innerHTML = '';
      empty.textContent = EMPTY_TEXT[view];
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    // Group upcoming tasks by day so the list reads like a plan
    let html = '';
    let lastGroup = null;
    for (const t of visible) {
      if (view === 'upcoming' && t.due) {
        const g = formatDue(t.due).split(',')[0];
        if (g !== lastGroup) { html += `<div class="group-label">${esc(g)}</div>`; lastGroup = g; }
      }
      html += taskHTML(t);
    }
    list.innerHTML = html;
  }

  function taskHTML(t) {
    const overdue = t.due && !t.done && new Date(t.due) < new Date();
    const lead = leadLabel(t.leadMin);
    const meta = [];

    if (t.due) {
      meta.push(`<span class="due${overdue ? ' is-overdue' : ''}">${overdue ? 'Overdue · ' : ''}${esc(formatDue(t.due))}</span>`);
      if (lead && !t.done) meta.push(`<span class="bell">🔔 ${esc(lead)}</span>`);
    }
    if (t.priority === 'high' && !t.done) meta.push('<span>High priority</span>');

    return `
      <article class="task prio-${t.priority}${t.done ? ' done' : ''}" data-id="${t.id}">
        <button class="check" data-act="toggle" aria-pressed="${t.done}" aria-label="Mark ${t.done ? 'not done' : 'done'}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        </button>
        <div class="task-body">
          <div class="task-title">${esc(t.title)}</div>
          ${t.notes ? `<div class="task-notes">${esc(t.notes)}</div>` : ''}
          ${meta.length ? `<div class="task-meta">${meta.join('')}</div>` : ''}
        </div>
        <button class="del" data-act="delete" aria-label="Delete task">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </article>`;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
  }

  // ------------------------------------------------------------------ theme

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

  // ------------------------------------------------------------ import/export

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
      const incoming = (parsed?.tasks || []).filter(isTask);
      if (!incoming.length) { toast('No tasks found in that file.'); return; }

      const seen = new Set(state.tasks.map(t => t.id));
      const added = incoming.filter(t => !seen.has(t.id));
      state.tasks.push(...added);
      save();
      render();
      toast(`Imported ${added.length} task${added.length === 1 ? '' : 's'}.`);
    } catch (err) {
      console.warn('Import failed:', err);
      toast('That file is not valid Planner JSON.');
    }
  }

  // ------------------------------------------------------------------ events

  function wire() {
    $('#new-task').addEventListener('submit', e => {
      e.preventDefault();
      const title = $('#f-title').value;
      if (!title.trim()) return;

      const dueRaw = $('#f-due').value;
      addTask({
        title,
        notes: $('#f-notes').value,
        due: dueRaw ? new Date(dueRaw).toISOString() : null,
        leadMin: Number($('#f-lead').value),
        priority: $('#f-priority').value,
      });

      e.target.reset();
      $('#f-lead').value = '15';
      $('#f-priority').value = 'normal';
      $('#f-title').focus();
    });

    $('#tabs').addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      view = tab.dataset.view;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t === tab));
      render();
    });

    $('#list').addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.closest('.task').dataset.id;
      if (btn.dataset.act === 'toggle') toggleDone(id);
      else removeTask(id);
    });

    $('#notify-btn').addEventListener('click', requestNotifications);
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
      render();
    });

    // Keep tabs in sync if the app is open in two windows
    window.addEventListener('storage', e => {
      if (e.key !== STORE_KEY) return;
      load();
      render();
    });

    // Catch up on reminders after the device wakes or the tab regains focus
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { render(); checkReminders(); }
    });
  }

  // -------------------------------------------------------------------- init

  applyTheme(localStorage.getItem(THEME_KEY));
  load();
  wire();
  updateNotifyButton();
  render();
  checkReminders();
  setInterval(checkReminders, TICK_MS);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW failed:', err));
    });
  }
})();
