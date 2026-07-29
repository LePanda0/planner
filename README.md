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

### Day and week views

The **Day / Week** switch in the top bar changes how much the grid shows, and
the choice is remembered between visits.

- **Week** lays out Sunday through Saturday side by side, tinting today's column
  and keeping the red now-indicator inside it.
- **Drag a card into any column** to schedule it on that day — the dashed
  preview follows the column you're over, so you can move a block from Tuesday
  to Friday in one drag.
- The arrows step a **week** at a time in week view, a day at a time in day view.
- **Click a column's date** to open that day on its own.
- Blocks too narrow to fit a time range (three-way overlaps, small screens) drop
  their controls and keep the title.

Dragging uses pointer events, so it works with a mouse, a trackpad, and touch.

### Regular events

Tick **Regular event** when creating a card (or in its editor) and it moves to
the tray's **Regular** section, drawn as a stack to show it's a template.

A regular card is never scheduled itself. Dragging it onto the grid leaves the
original in place and schedules an independent **copy**, so you can drop the
same standup onto Monday, Tuesday, and Wednesday from one card. The copies are
ordinary tasks: move, resize, complete, or delete them without touching the
template.

**Edits propagate.** Each copy remembers its template via `templateId`, so
editing the template updates every copy already on the grid — the editor tells
you how many will change before you save.

Only the fields you actually changed are pushed down. Rename the template and
the copies get the new name but keep their own lengths, so a copy you resized
on the grid survives. Change **Length** on the template and every copy adopts
it, overriding those manual resizes. Times are never touched: a copy stays on
the day and hour you dropped it.

Templates have no done checkbox, since finishing a template is meaningless.
Ticking the box on a scheduled card promotes it to a template and takes it off
the grid; deleting a template leaves its copies alone.

One limitation: copies made before this linking existed have no `templateId`
and won't receive edits. Re-drag the template to make fresh linked copies.

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
  regular,                      // true = template; duplicates when scheduled
  templateId,                   // the template this was copied from, or null
  start,                        // ISO datetime, or null when unscheduled
                                // (always null for a regular card)
  leadMin,                      // reminder lead time; -1 disables
  done, notified, created
}
```

Data saved by the earlier `planner.v1` list version is migrated automatically:
a `due` date becomes a one-hour block at that time.
