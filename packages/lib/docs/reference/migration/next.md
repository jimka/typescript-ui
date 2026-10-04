# Next

Breaking-change notes for the next release, collected here as they land —
this page is not tied to a version number yet. Once this release is tagged,
any note here moves onto its own numbered page (see
[Migration](/reference/migration)) and this page resets to empty.

## A Window takes focus when it is shown

**What changed and why.** A shown window was announced by a screen reader
only when focus happened to enter it. `show()` now moves focus to the window
after its first layout; `bringToFront()` moves it at once, also when the window
is already the active one; closing a window that holds focus returns focus to
the element it came from. Pass `autoFocus: false` to a window that should not
take focus.

| Call | Before | Now |
| --- | --- | --- |
| `win.show()` | focus stays on the opener | focus moves to the window |
| `win.bringToFront()` on the active window | focus stays | focus moves to the window |
| closing a focused window | focus on `<body>` | focus on the opener |

**Who needs to act.** Code that shows a window while the user keeps working
elsewhere: a tool palette, a log or status window, a window opened from a
timer or a network reply. Build it with `autoFocus: false`. Code that focuses
its own field right after `show()` needs no change, because focus arrives
after the window's first layout.

`autoFocus: false` opts a window out of the new focus moves; it does not
bring back every old behaviour.

| Call | Before | With `autoFocus: false` |
| --- | --- | --- |
| `win.show()` | focus stays on the opener | focus stays on the opener |
| `win.bringToFront()` on the active window | focus stays | focus stays |
| `win.bringToFront()` on an inactive window | focus moves to the window | focus stays |
| a press inside the window, or `restore()` | focus moves to the window | focus moves to the window |
| closing a window that holds focus | focus on `<body>` | focus on the element it took focus from, when a press or `restore()` activates it |

```typescript
// Before
new Window("Log").show();               // focus stayed where it was

// After — keep it out of the way
new Window("Log", { autoFocus: false }).show();
```

## A restore that interrupts a rail minimize fires the `minimize` it owed first

**What changed and why.** A window minimizing into a
[`Rail`](/components/Rail) shrinks into its handle over 150 ms, and its
`"minimize"` is held back until that shrink lands — so the handle appears
when the window has finished shrinking into it. A restore arriving inside
that window used to *void* the held-back event, on the ground that a window
leaving `"minimized"` has nothing left to announce. But the window's state
reads `"minimized"` for the whole shrink, so a consumer polling
`getWindowState()` saw a transition into and out of `"minimized"` that no
event ever reported, and one pairing the two events saw a `"restore"` with
no `"minimize"` before it. The debt is now paid instead of voided, which is
what [`setRail`](/api/overlay/classes/AbstractWindow#setrail) already did
for a window that stays minimized under a new owner. A restore that lets the
shrink land is unchanged, and so is a close or a dispose inside it: the first
still announces `"close"` alone, the second still announces nothing.

**Who needs to act.** Nothing fails to compile, and a consumer that only
mirrors the window's state — as `Rail` itself does — needs no change. A
listener that treated `"minimize"` as "the window is now hidden behind a rail
handle" sees one more call, for a window that is about to be shown again in
the same task; it should read `getWindowState()` in the handler, or wait for
the paired `"restore"`, rather than assume.

```typescript
// Before — a restore inside the 150 ms shrink
win.on("minimize", onMin);
win.on("restore",  onRes);
win.minimize();
win.restore();      // onRes only

// After
win.minimize();
win.restore();      // onMin, then onRes — in that order, in the same task
```

## `DOM.sink` and `DOM.source` are read-only

**What changed and why.** The two seam properties are now declared `readonly`,
so they are swapped through
[`DOM.install`](/api/core/interfaces/DOMSeams#install) or
[`DOM.reset`](/api/core/interfaces/DOMSeams#reset) and nowhere else. Those two
calls are what tell the library's seam-derived caches that the handles they hold
have stopped resolving — a `Handle` only means anything to the seam that minted
it, and `reset` rebuilds the shared handle registry outright. A direct
assignment went around that notification, leaving a cache writing through a
handle the incoming sink had never minted. Making the properties read-only makes
the two swap routes the only ones, so the notification cannot be bypassed.

**Who needs to act.** Only code that assigned a seam directly, which no
documented path ever did. The assignment is now a compile error; install the
seam instead, which is also what restores the production pair:

```typescript
// Before
DOM.sink = myRecordingSink;

// After
DOM.install({ sink: myRecordingSink });
// … and to restore the production pair
DOM.reset();
```

## `DOMSink` gains `createMouseEvent`

**What changed and why.** One more construction moved behind the seam.
`createMouseEvent(type, init)` builds a mouse event and returns it without
dispatching it. `Tree` and `List` call it for the `contextmenu` event they hand
a `"contextmenu"` listener when the menu is opened with Shift+F10 or the
ContextMenu key, so that no library code names the global `MouseEvent`
constructor.

**Who needs to act.** Only a consumer implementing its own `DOMSink`; the
missing member is a compile error. In a browser, return
`new MouseEvent(type, init)`. A sink that runs without a DOM returns a plain
object carrying `type`, the `init` fields a listener reads (`clientX`,
`clientY`, `button` and the four modifier flags, defaulting to `0` and
`false`), a `null` `target`, and no-op `preventDefault()` /
`stopPropagation()`.

## A `Panel` subclass that scrolls something of its own overrides `revealRect`

**What changed and why.** `FocusReveal.reveal` no longer calls
`revealDescendant(target)` on a scrolling panel. With panels inside one
another that call made each panel measure the control for itself, the
outermost first, and the control could end out of view. The broker now
measures the control once and hands the rectangle from panel to panel, the
innermost first, through `revealRect(rect, axis?)`: each panel scrolls to show
the rectangle it is handed and returns what it then shows of it.
`revealDescendant` stays, for a caller that reveals in one panel directly.

**Who needs to act.** Only a `Panel` subclass that overrides
`revealDescendant` to scroll something other than the panel itself. It
inherits `Panel.revealRect`, which the broker now calls, so its override is
skipped without an error and focus history and spatial navigation no longer
scroll its content into view. Override `revealRect` as well:

```typescript
revealRect(rect: Rect, axis?: ScrollAxis): Rect {
    // Scroll your own inner element the least distance that shows `rect`
    // (browser-viewport coordinates), along `axis` when one is given, and
    // return the part of `rect` that element shows afterwards. Return
    // `rect` unchanged when there is nothing to scroll.
}
```

Override `hasScrollRange(axis?)` too. The inherited one answers for the panel
itself, from its own overflow, and a panel whose own box never scrolls
answers `false`; a list, tree or table inside the subclass would then never
ask it to scroll for a keyboard move. Return whether your inner element can
scroll along `axis`, or `true` when that is not known without measuring.

`ScrollStrip` is the library's own case; its `revealRect` and
`hasScrollRange` are the model. A revealer that is not a `Panel` and
implements only `revealDescendant` needs no change: it is still called,
before every scrolling panel.

## `DOMSource` gains `readDocumentSelection`

**What changed and why.** `MarkdownEditor` now brings its own selection to
the browser's before it builds a context menu, because on Linux a right-click
moves the browser's caret and raises `contextmenu` before the editor has
followed it. That needs the document's live selection, which Lexical resolves
against the DOM it owns. The read goes through the read seam, like every
other DOM read, so `DOMSource` gains one member:
`readDocumentSelection(reader)`, which hands the live `Selection` (or `null`
when the document has none) to `reader` for the length of the call and
returns what `reader` returns. `getDocumentSelection()` could not carry this:
it reports nothing for a collapsed selection and answers in handles.

**Who needs to act.** Only code that implements `DOMSource` itself — a custom
source installed through `DOM.install`. `ProductionDOMSource` implements it,
and code that only calls the seam is unaffected. A source that wraps another
forwards the call. A source that answers from its own model has no live
selection to hand over and returns `null` without calling `reader`, which
callers treat as "no selection":

```typescript
import type { DOMSource } from '@jimka/typescript-ui/core';

class MySource implements DOMSource {
    // …
    readDocumentSelection<T>(_reader: (selection: Selection | null) => T): T | null {
        return null;
    }
}
```

## `Tree` and `TreeTable` no longer register `caret-down` / `caret-right`

**What changed and why.** `Tree` and `TreeTable` row toggles are now one
`angle-right` glyph, turned 90° to point down when expanded instead of being
swapped for a differently-named glyph — a rotation can be animated with a CSS
transition, and a glyph-name swap cannot. `TreeRow.ts` and `TreeCell.ts`
previously registered `caret-down` and `caret-right` with the shared glyph
registry as a side effect of importing them; neither file references those
names any more, so that registration is gone too.

**Who needs to act.** Code that shows a `caret-down` or `caret-right` glyph
elsewhere — a `Button` glyph, an icon renderer's resolver — and relied on
importing `Tree` or `TreeTable` to have registered them for it must now
register them itself:

```typescript
import { Glyph } from '@jimka/typescript-ui/component/display';
import { caret_down, caret_right } from '@jimka/typescript-ui/glyphs/solid';

Glyph.register(caret_down, caret_right);
```

Code that read a tree row's toggle via `getToggle().getGlyphName()` to learn
whether it was expanded should call `Tree.getExpandedNodes()` /
`TreeTable.isExpanded(record)` instead — the glyph name is now `angle-right`
in both states, and the rotation (`getTransform()`) carries the state.

## `SpatialNavigation`'s region chord is `Ctrl+Alt+Shift`+arrow

**What changed and why.** The `"target"` tier — the chord that jumps
between navigation-target containers — defaulted to `Ctrl+Shift`+arrow.
The service claims its chords at the window before any widget sees them,
so on Windows and Linux it took `Ctrl+Shift+←`/`→` word selection away
from every `<input>`, `<textarea>`, `MarkdownEditor` and `CodeEditor`, and
on macOS it took `CodeEditor`'s `Ctrl-Shift`-arrow bindings. The default is
now `Ctrl+Alt+Shift`+arrow, which no editor or browser binds. The
`"component"` tier stays on `Ctrl+Alt`+arrow.

**Who needs to act.** An app that enables `SpatialNavigation` without
passing `targetModifiers` now answers to `Ctrl+Alt+Shift`+arrow. Update any
help text or shortcut legend that names the old chord. An app that passes
its own `targetModifiers` is not affected. To keep the old chord:

```typescript
SpatialNavigation.configure({ targetModifiers: { ctrl: true, shift: true } });
```

## A `Date` crosses the wire in local form

**What changed and why.** `JsonWriter` and `AjaxProxy`'s `filter=` wrote
every `Date` with `toISOString()`, a UTC instant. That instant no longer
named the calendar day or wall-clock time the user saw: a `date` of 28 June
typed in Tokyo was sent as `2026-06-27T15:00:00.000Z`, and a server that
kept the first ten characters stored the 27th. `JsonWriter` now writes each
top-level `Date` in the form its field type is read back in, and `AjaxProxy`
— whose filter descriptors name a field but not its type — writes every
filter `Date` as local ISO 8601 with its UTC offset.

| Where | Value (local) | Before | After |
|---|---|---|---|
| `JsonWriter`, `date` field | 28 June 2026, 00:00 in Tokyo | `2026-06-27T15:00:00.000Z` | `2026-06-28` |
| `JsonWriter`, `time` field | 09:30:15.250 in Kolkata | `1970-01-01T04:00:15.250Z` | `09:30:15.250` |
| `JsonWriter`, any other field | 28 June 2026, 12:04:59.123 in Los Angeles | `2026-06-28T19:04:59.123Z` | `2026-06-28T12:04:59.123-07:00` |
| `AjaxProxy` `filter=` | 28 June 2026, 00:00 in Tokyo | `2026-06-27T15:00:00.000Z` | `2026-06-28T00:00:00.000+09:00` |

An offset of zero is written `+00:00`, never `Z`. An Invalid `Date` is still
written as `null`, a `Date` nested inside an object or array field value
keeps its `toISOString()` form, and `sort=` is unchanged.

**Who needs to act.** A server that matches a trailing `Z`, or that parses a
`date` value as an instant and relied on the day being UTC's, must parse
each value by its type instead: a bare date, a bare time, or an ISO 8601
date-time with an offset, which any ISO parser reads as the same instant as
before. A consumer who needs the old body can pass a custom `writer` to
`AjaxProxy`.

## A store reads a bare date or a time of day as a local value

**What changed and why.** `Field` converted every `date`, `time` and
`datetime` value with `new Date(raw)`. That read a bare `2026-06-28` as UTC
midnight — 27 June in Los Angeles — and could not read a time of day at all:
`new Date("09:30:00")` is an Invalid Date, so a store `time` column was
always empty. A bare `YYYY-MM-DD` in a `date` or `datetime` field is now
read as local midnight, and a `time` field reads a two-digit
`HH:MM[:SS[.fraction]]` as that time on 1 January 1970, local, to the
millisecond. Any other text still goes through `new Date(raw)`.

| Field type | Raw value | Before | After |
|---|---|---|---|
| `date` | `"2026-06-28"` | UTC midnight | 28 June, 00:00 local |
| `datetime` | `"2026-06-28"` | UTC midnight | 28 June, 00:00 local |
| `time` | `"09:30:15.250000"` | `undefined` | 1 January 1970, 09:30:15.250 local |
| `date` | `"2026-06-28T12:04:00Z"` | that instant | that instant (unchanged) |

0.10.0's migration note says "a store `time` or `datetime` column reads with
`new Date(...)`"; that no longer holds for `time`, nor for a bare-date
`datetime` value. The 0.10.0 page is left as it was released.

**Who needs to act.** Code that relied on a bare date loading as UTC
midnight — for example by reading it back with `getUTCDate()` — should read
it with the local getters. Code that relied on a `time` column being empty,
or that filled it in by hand after load, now receives the stored time.

## `TimeField` values sit on 1 January 1970

**What changed and why.** `TimeField` put a typed or picked time on today's
date. A store `time` field, the time cell editor, the filter row and the
table's paste path all use 1 January 1970, so a `TimeField` bound to a
`time` field could mark an untouched value dirty. `TimeField`'s values now
sit on 1 January 1970, local. A relative shorthand is still resolved
against now; only its time of day is kept.

| Input | Before | After |
|---|---|---|
| typed `09:30` on 28 June 2026 | 28 June 2026, 09:30 | 1 January 1970, 09:30 |
| picked 14:45 from the dropdown | today, 14:45 | 1 January 1970, 14:45 |
| typed `+30mi` at 23:50 on 28 June 2026 | 29 June 2026, 00:20 | 1 January 1970, 00:20 |

`setValue` keeps the `Date` it is given, so a value set from code keeps its
own date until the user edits it.

**Who needs to act.** Code that reads the date part of a `TimeField` value,
or compares it with today, should read only its hours, minutes and seconds,
or combine them with the date it wants.

## `Markdown` reads a table only where no other block starts

**What changed and why.** `Markdown` took a line over a delimiter row of
dashes alone as a one-column table, ahead of most other blocks: a setext
heading (`Title` over `---`), a thematic break after a blockquote or a blank
line, a fenced code block whose first line is `---`, and a list with a bare
`-` item all rendered as tables. GFM tries every block that can start on the
header line first, and reads a delimiter row only when a `|` or a `:` marks
it as one; `Markdown` now does the same. Indented or fenced code, an ATX
heading, a thematic break, a blockquote, a list, an HTML block, a link
reference definition and a `:::` fence each win over a table, and a
delimiter row must hold a `|` or a `:`. `MarkdownEditor` loads these
documents the same way.

| Source | Before | After |
|---|---|---|
| `Title` over `---` | a table, header `Title` | a level-2 heading `Title` |
| a blank line, then `---` | a table with an empty header | a thematic break, shown as its literal `---` |
| a delimiter row holding a `\|` or a `:` (`a` over `:--`) | a table | a table (unchanged) |

**Who needs to act.** Content that wrote a one-column table with a delimiter
row of dashes alone now renders as a heading. Add a `|` or a `:` to the
delimiter row:

```markdown
<!-- Before: a one-column table -->
Name
---
Ada

<!-- After -->
| Name |
| --- |
| Ada |
```

## A `Dialog`'s first Escape inside an editor releases it

**What changed and why.** A modal `Dialog` whose only focusable content was
a `CodeEditor` trapped a keyboard user: the dialog opened with focus in the
editor, `Tab` and `Shift+Tab` indented and dedented, and `Escape` closed the
whole dialog, so no key reached its buttons. `Escape` inside an editing
surface in a dialog now releases that surface for one `Tab` instead of
closing the dialog, and a second `Escape` closes it. Inside a `Table` the
first `Escape` does not close the dialog either, but the table's own `Tab`
handling can still pull focus back into it.

| Focus | Release armed for this owner? | Key | Result |
|---|---|---|---|
| in the editor | no | `Escape` | release armed; dialog stays open; the editor also receives the Escape |
| in the editor | yes | `Tab` / `Shift+Tab` | focus moves to the dialog's next / previous control, wrapping inside the dialog |
| in the editor | yes | `Escape` | dialog closes with `'close'` |

Any other key, or focus leaving the editor, cancels the release. A mandatory
modal (`dismissable: false`) releases the same way and still ignores the
second `Escape`. To support this, `DismissableLayer.requestClose()` may now
return `false` to decline, and `Dialog.requestClose()` returns `boolean`:
`false` when it armed the release, `true` otherwise.

**Who needs to act.** An automated UI test or script that closes a dialog
with a single `Escape` while focus is in a `CodeEditor`, `MarkdownEditor` or
`Table` must send two, or move focus to a button first. A `Dialog` subclass
that overrides `requestClose(): void` no longer compiles: return `boolean`,
and call `super.requestClose()` and return its result to keep the release.
Other `DismissableLayer` implementations need no change; a `requestClose()`
that returns nothing is handled as before.

## A `Dialog`, a `Window` and a titled `Popover` are named by their title

**What changed and why.** These three layers had no accessible name, so a
screen reader announced none when focus entered them. Each now points
`aria-labelledby` at the component that shows its title: a dialog's title-bar
text, a window's header text, a popover's title row. A browser computes an
element's name from `aria-labelledby` before it looks at `aria-label`, so an
`aria-label` on the same element is ignored while the reference is there.

| Layer | You wrote | Announced before | Announced now |
|---|---|---|---|
| `Window('Local Storage')` | `win.getAria().setLabel('Storage inspector')` | "Storage inspector" | "Local Storage" |
| `new Dialog({ title: 'Delete?' })` | `dialog.getAria().setLabel('Delete record 42')` | "Delete record 42" | "Delete?" |
| `Popover({ title: 'Filters' })` | `popover.getAria().setLabel('Row filters')` | "Row filters" | "Filters" |

A `TabWindow` and a `Drawer` are not affected. A `TabWindow` writes its name
into `aria-label` and leaves a name you set alone; a `Drawer` has no title
and takes whatever name you give it. A `Popover` you name before it gets a
title also keeps your name.

**Who needs to act.** Code that names a `Dialog`, a `Window` or a titled
`Popover` through `getAria().setLabel(…)` after constructing it. Remove the
reference first:

```typescript
win.getAria().clearLabelledBy().setLabel('Storage inspector');
```

For a `Dialog`, `ariaLabel` in the config does the same and also works with
`Dialog.show(config)`, which never hands out the dialog. Code that sets no
ARIA on these layers needs no change.
