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

## Timer and focus counter

A right-hand panel holds a session timer with 5 / 10 / 25 / 50-minute presets
and a custom length (1-600 minutes). Below it, two stat blocks: the selected
day's focus time and blocks completed, then the same pair totalled over the
stretch that day belongs to.

- `endsAt` is the only thing that says the clock is running; everything else is
  derived, so a reload resumes the session where it really is. Time that passed
  while the tab was closed still counts, capped at the session's end.
- Paused time never counts. Choosing a new length banks whatever has run.
- The counter follows the calendar: on today it is live, on another day it
  shows that day's stored total. Totals live in `planner.focus`, keyed by local
  date and pruned past 60 days.
- Finishing a session raises a notification and logs a completed session.
- A block counts as completed on the day it is scheduled for, so the count is
  read straight off the tasks rather than stored separately.

The bottom panel totals whichever stretch the selected day falls in:

| Selected day | Stretch totalled |
| --- | --- |
| Mon-Fri | that week's Monday through Friday |
| Sat | that Saturday and the Sunday after |
| Sun | that Sunday and the Saturday before |

A weekend is counted as the Saturday-Sunday pair people mean by the word, which
is deliberately not the app's Sunday-start calendar week.

## Settings

The gear in the header opens a settings dialog. It currently holds one thing:
the theme colour, as six circles split between a palette's accent and the soft
tint it pairs with, drawn in whichever mode you are already in.

- A palette swaps only `--accent` and `--accent-soft`; every other colour is
  shared, so the whole app recolours from two values.
- Stored in `planner.accent`; an unknown value falls back to Indigo.
- The rules sit *below* the light/dark blocks in `styles.css` on purpose:
  `:root[data-accent="x"]` and `:root[data-theme="dark"]` have the same
  specificity, so source order is what decides.
- Dark palettes bright enough to fail against white button text (everything
  but Indigo) declare their own dark `--accent-text`.

## Other features

- Priority (colored left edge), notes, and per-task duration
- A focus timer with presets, per-day stats, and weekday/weekend totals
- A block shows its note under the time, or beside the title when it is
  too short (under ~55 min) for a second line
- A notification when a block starts, plus an optional heads-up beforehand
- Installable as a PWA, works offline
- Light and dark themes, following the system by default, in six colours
- Export/import all tasks as JSON

## How notifications actually work

Each card fires up to two notifications:

1. **A heads-up**, `leadMin` minutes before the block (skipped when the lead is
   `0`, since the start alert lands moments later).
2. **"Now: <title>"** the moment the block starts, showing its time range. It
   stays on screen until dismissed, and tapping it focuses Planner.

And while any block is running, a **break reminder** on every half hour of the
clock — 5:00, 5:30, 6:00 — rather than counted from each block's own start, so
back-to-back blocks keep one rhythm. A mark that falls exactly on a block's
start is skipped (the start alert just fired), a mark more than 5 minutes past
is dropped, and overlapping blocks share a single reminder. The last mark
announced lives in `planner.break` so a reload cannot repeat it.

Set a card's lead to `No notifications` (`-1`) to silence all three — such a
card is not treated as a running session either.

Nothing is scheduled on a server — the app checks every 20 seconds, and again
whenever the tab regains focus, because background tabs get their timers
throttled. Notifications are shown through the service worker registration when
one is available, which is what makes them survive a backgrounded tab on mobile
and makes them clickable.

Alerts therefore arrive when Planner is **open in a tab**, or running as an
installed PWA. If every window is closed, the heads-up is missed and the start
alert only fires if you reopen within 10 minutes of the block starting — a stale
"this started 3 hours ago" buzz is worse than silence. This is the honest limit
of static hosting.

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
| `app.js` | State, storage, drag controller, overlap layout, notifications, timer |
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
  leadMin,                      // heads-up lead time; -1 silences the card
  done,
  notified,                     // the lead-time heads-up has fired
  started,                      // the "starting now" alert has fired
  created
}
```

Data saved by the earlier `planner.v1` list version is migrated automatically:
a `due` date becomes a one-hour block at that time.
