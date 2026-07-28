# Planner

Drag task cards from a tray onto a 24-hour day grid. Local-first: tasks live in
your browser's `localStorage` and never leave the device. No accounts, no server,
no tracking.

**Live:** https://lepanda0.github.io/planner/

## How it works

The left rail holds **unscheduled cards** — a backlog you build with the
**New card** button. The right pane is a **12 AM to 12 AM day grid**, Google
Calendar style, with hour lines, half-hour marks, and a live red now-indicator.

- **Click a card or block** (or press `F2`) to edit its title, notes, length,
  priority, and reminder. The pencil icon on a tray card does the same.
- **Drag a card onto the grid** to schedule it. It snaps to 15 minutes and a
  dashed preview shows the exact time range before you let go.
- **Drag a block around the grid** to move it; duration is preserved.
- **Drag a block's bottom edge** to change how long it takes.
- **Drag a block back to the tray** to unschedule it without losing it.
- **Arrows at the top** move between days; the tray is shared across all days.
- Overlapping blocks split into side-by-side columns automatically.

Dragging uses pointer events, so it works with a mouse, a trackpad, and touch.

### Keyboard

Cards and blocks are focusable, so the app is usable without dragging:

| Key | On a tray card | On a scheduled block |
| --- | --- | --- |
| `F2` | Open the editor | Open the editor |
| `Enter` | Schedule in the first free slot | Send back to the tray |
| `↑` / `↓` | — | Move by 15 min (`Shift` = 1 hour) |
| `Delete` | Delete the task | Delete the task |

Inside the editor, `Enter` saves and `Esc` cancels.

A click only opens the editor if it *isn't* the start of a drag — the pointer
has to stay within 4px. So dragging never accidentally opens the editor, and a
tap never accidentally moves a card.

## Other features

- Priority (colored left edge), notes, and per-task duration
- Browser notifications at a configurable lead time before a block starts
- Installable as a PWA, works offline
- Light and dark themes, following the system by default
- Export/import all tasks as JSON

## How reminders actually work

Nothing is scheduled on a server — the app checks every 20 seconds for blocks
whose reminder time has passed and fires a browser `Notification`.

Reminders therefore arrive when Planner is **open in a tab**, or running as an
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
`index.html` via `file://` won't work, because service workers and notifications
require a secure origin:

```powershell
python -m http.server 8000
# then open http://localhost:8000
```

The service worker caches the app shell, so **after changing CSS or JS you must
bump `CACHE` in `sw.js`** — otherwise returning visitors keep the old build for
one extra load. During development, DevTools → Application → Service Workers →
"Update on reload" avoids the confusion.

## Deployment

Pushing to `main` publishes automatically via GitHub Pages
(Settings → Pages → Deploy from branch → `main` / root).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell: top bar, tray, calendar |
| `styles.css` | Theming, layout, card/block/grid styling |
| `app.js` | State, storage, drag controller, overlap layout, reminders |
| `sw.js` | Offline cache (stale-while-revalidate) |
| `manifest.webmanifest` | PWA metadata |

## Data model

Tasks are stored under `planner.v2` as:

```js
{
  id, title, notes, priority,   // 'low' | 'normal' | 'high'
  durationMin,                  // block length in minutes
  start,                        // ISO datetime, or null when unscheduled
  leadMin,                      // reminder lead time; -1 disables
  done, notified, created
}
```

Data saved by the earlier `planner.v1` list version is migrated automatically:
a `due` date becomes a one-hour block at that time.
