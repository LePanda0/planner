# Planner

A local-first planning and reminder app. No accounts, no server, no tracking —
tasks live in your browser's `localStorage` and never leave the device.

**Live:** https://lepanda0.github.io/planner/

## Features

- Add tasks with a due date/time, priority, and notes
- **Today / Upcoming / Someday / Done** views, with upcoming grouped by day
- Browser notifications at a configurable lead time (at due, 5m, 15m, 1h, 1d before)
- Installable as a PWA and works offline
- Light and dark themes, following the system by default
- Export/import your tasks as JSON

## How reminders actually work

The app schedules nothing on a server — it checks every 20 seconds for tasks
whose reminder time has passed and fires a browser `Notification`.

That means reminders arrive when Planner is **open in a tab**, or running as an
installed PWA. If every window is closed, the reminder fires the next time you
open the app (as long as it's less than a day late). This is the honest limit of
static hosting.

**To get true background push** you would need a small backend: a Web Push
service (VAPID keys + a push subscription stored server-side) that wakes the
service worker even when the app is closed. A serverless function on
Vercel/Cloudflare Workers plus a scheduled trigger is the usual shape. The
service worker in `sw.js` is already the right place to add a `push` handler.

## Local development

No build step, no dependencies. Serve the folder over HTTP — opening
`index.html` via `file://` won't work, because service workers and
notifications require a secure origin:

```powershell
python -m http.server 8000
# then open http://localhost:8000
```

## Deployment

Pushing to `main` publishes automatically via GitHub Pages
(Settings → Pages → Deploy from branch → `main` / root).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and app shell |
| `styles.css` | Theming, layout, components |
| `app.js` | State, storage, reminders, rendering |
| `sw.js` | Offline cache (stale-while-revalidate) |
| `manifest.webmanifest` | PWA metadata |
