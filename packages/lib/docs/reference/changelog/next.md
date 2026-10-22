# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Components

- **`Tree` and `TreeTable` no longer register `caret-down` / `caret-right`
  at module load.** Their row toggles are now a single `angle-right` glyph,
  turned to point down instead of swapped for a different one. Code that
  displays `caret-down` / `caret-right` elsewhere and relied on importing
  `Tree` or `TreeTable` to have registered them must now register them
  itself. See [Migration](/reference/migration/next) for the full note.

- **`TimeField` values sit on 1 January 1970, local.** A typed or picked
  time used to land on today's date, while a store `time` field, the time
  cell editor, the filter row and the table's paste path all use 1 January
  1970, so a `TimeField` bound to a `time` field could mark an untouched
  value dirty. A relative shorthand such as `+30mi` is still resolved
  against now; only its time of day is kept. See
  [Migration](/reference/migration/next) for the full note.

- **`Markdown` reads a table only where no other block starts.** A line
  over `---` rendered as a one-column table: a setext heading, a thematic
  break after a blockquote or a blank line, a fenced code block whose first
  line is `---`, and a list with a bare `-` item all came out as tables. A
  table's delimiter row must now hold a `|` or a `:` (`| --- |`,
  `--- | ---`, `:-:`), and every block that can start on the header line is
  tried first, as GFM specifies: indented or fenced code, an ATX heading, a
  thematic break, a blockquote, a list, an HTML block, a link reference
  definition and a `:::` fence. A line over `---` is now a setext heading,
  and a `---` that starts no other block is a thematic break, which
  `Markdown` renders as its literal text, as it renders every thematic
  break — so a `---` that used to render as a table with an empty header
  now shows as `---`. `MarkdownEditor` loads these documents the same way.
  A one-column table whose delimiter row holds only dashes (`a` over `---`)
  must add a `|` or a `:` to it (`| a |` over `| --- |`, or `a` over
  `:--`). See [Migration](/reference/migration/next) for the full note.

### Core

- **`DOM.sink` and `DOM.source` are now read-only.** Swap a seam through
  `DOM.install({ sink, source })` or restore the production pair with
  `DOM.reset()`; a direct assignment no longer compiles. The two calls are what
  tell the library's seam-derived caches that the handles they hold have stopped
  resolving, so an assignment that went around them left stale handles behind.
  Code already using `install` / `reset` — which is every documented path —
  needs no change. See [Migration](/reference/migration/next) for the full note.

- **`SpatialNavigation`'s region chord is now `Ctrl+Alt+Shift`+arrow.**
  The `"target"` tier's default modifiers change from `Ctrl+Shift` to
  `Ctrl+Alt+Shift`, because `Ctrl+Shift+←`/`→` is word selection in every
  text input, `MarkdownEditor` and `CodeEditor`, and the service took it
  away from all of them while enabled. The `Ctrl+Alt`+arrow control chord
  is unchanged. Restore the old chord with
  `SpatialNavigation.configure({ targetModifiers: { ctrl: true, shift: true } })`.
  See [Migration](/reference/migration/next) for the full note.

- **A `Panel` subclass that scrolls something of its own must override
  `revealRect`, not only `revealDescendant`.** `FocusReveal.reveal` used to
  call `revealDescendant(target)` on every scrolling panel around a control.
  It now measures the control once and calls `revealRect(rect, axis?)` on
  each of them, innermost first. A subclass that overrode
  `revealDescendant` to scroll an inner element, as `ScrollStrip` does for
  its clip, inherits `Panel.revealRect` and is no longer asked: focus
  history and spatial navigation stop scrolling its content into view, with
  no error. It also inherits `Panel.hasScrollRange`, which answers for the
  panel and not for the inner element. Only such a subclass is affected;
  see [Migration](/reference/migration/next) for what to override.

- **`DOMSink` gains one required member: `createMouseEvent(type, init)`.**
  It builds a mouse event without dispatching it, so the event's `target` is
  `null` until something dispatches it. `Tree` and `List` use it for the
  event they hand a `"contextmenu"` listener when the menu is opened from
  the keyboard. Only a consumer implementing its own `DOMSink` is affected;
  see [Migration](/reference/migration/next) for what to return.

### Data

- **`JsonWriter` writes each `Date` in its field type's form.** A `date`
  field is written as `2026-06-28`, a `time` field as `09:30:15.250`, and
  any other field as local ISO 8601 with its UTC offset
  (`2026-06-28T12:04:59.123-07:00`), no longer as `toISOString()`. The UTC
  instant did not name the day the user saw: a `date` of 28 June typed in
  Tokyo went out as `2026-06-27T15:00:00.000Z`. See
  [Migration](/reference/migration/next) for the full note.

- **`AjaxProxy`'s `filter=` writes each `Date` as local ISO 8601 with its
  offset.** A filter operand of midnight on 28 June in Los Angeles is sent
  as `2026-06-28T00:00:00.000-07:00` rather than
  `2026-06-28T07:00:00.000Z`: the same instant, plus the calendar day and
  wall-clock time the user saw. `sort=` is unchanged. See
  [Migration](/reference/migration/next) for the full note.

- **A store reads a bare date as local midnight, and a `time` field reads
  `HH:MM[:SS[.fraction]]`.** A `date` or `datetime` value of `2026-06-28`
  was read as UTC midnight, the previous day west of UTC; it is now that
  local day. A `time` value such as `09:30:15.250000` was an Invalid Date,
  so a store `time` column was always empty; it now reads as that time on
  1 January 1970, local, to the millisecond. Any other temporal text still
  goes through `new Date(raw)`. See [Migration](/reference/migration/next)
  for the full note.

### Overlay

- **A `Window` and a `TabWindow` take keyboard focus when shown.** `show()`
  moves focus to the window once it has laid out, `bringToFront()` moves it at
  once, also when the window is already the active one, and closing a window
  that holds focus returns focus to where it came from. Pass
  `autoFocus: false` to keep a window out of the way. See
  [Migration](/reference/migration/next) for the full note.

- **A restore that interrupts a rail minimize now announces `['minimize',
  'restore']` rather than `"restore"` alone.** The `"minimize"` a rail-bound
  window owes is deferred to the end of the 150 ms shrink-into-the-rail
  animation, and a restore arriving inside that shrink used to void it — so
  the pair arrived unbalanced, with a `"restore"` no `"minimize"` preceded.
  The debt is now paid on that route too, matching what `setRail` already did
  for a window that stays minimized under a new owner, and matching the two
  events' documented meaning: the window's state reads `"minimized"` for the
  whole shrink, so the old behaviour left that transition unannounced. A
  consumer that counts the two events now sees them balance. See
  [Migration](/reference/migration/next) for the full note.

- **A `Dialog`'s first `Escape` inside an editing surface or `Table` no
  longer closes the dialog.** A dialog whose only focusable content was a
  `CodeEditor` opened with focus in the editor, where `Tab` indented and
  `Escape` closed the whole dialog, so no key reached its buttons. The first
  `Escape` inside an editing surface now releases it: the next `Tab` or
  `Shift+Tab` moves to the dialog's next or previous control, and a second
  `Escape` closes the dialog. The first `Escape` also reaches the surface,
  so it can close an open completion list or search panel. A `Table` keeps
  the first `Escape` too, but its own `Tab` handling can still pull focus
  back into it. `Dialog.requestClose()` now returns `boolean`. See
  [Migration](/reference/migration/next) for the full note.

- **An `aria-label` you set on a `Dialog`, a `Window` or a titled `Popover`
  is now outranked by its title.** Each of the three now points
  `aria-labelledby` at the text that shows its title, and a browser prefers
  that reference over `aria-label`. A name written with
  `getAria().setLabel(…)` after construction is therefore no longer what a
  screen reader announces. Call `getAria().clearLabelledBy()` first, or pass
  `ariaLabel` in a `Dialog`'s config. See
  [Migration](/reference/migration/next) for the full note.

## Changed

### Components

- **`Tree` and `TreeTable` toggles are a thin angle that turns to point
  down, and a single expand or collapse animates.** On `Tree`, a caret
  click, row toggle, `ArrowLeft` / `ArrowRight`, `expandNode(Async)` or a
  lazy load settling with an expand waiting, and on `TreeTable`,
  `setExpanded`, a toggle click or `ArrowLeft` / `ArrowRight`, plays a
  200ms row motion after its state commits — the toggled node's children
  slide out and fade in, and the rows below move to make room — while
  bulk/structural calls, a block taller than the viewport, a commit that
  moves the scroll offset, and `prefers-reduced-motion: reduce` all snap
  instead. While a collapse plays, the rows sliding away carry
  `aria-hidden="true"`, so assistive technology reads only the committed
  rows. A call that has to scroll a row into view settles a running motion
  first, while one whose row is already in view leaves it playing; a
  keyboard move onto a child that an expand is still fading in also settles
  it. `TreeCellRenderer`'s
  `setTreeState` gains an optional fourth `animate` parameter (default
  `false`) for a caller that wants the turn animated.

- **A `Tab` strip's descriptor tools have an accessible name.** A tool built
  from a `TabToolDescriptor` showed its `label` as a tooltip only, so a
  screen reader announced an unnamed button. The label is now the button's
  accessible name as well, kept off its face. No consumer action is needed.

- **A keyboard move in a `List`, `Tree`, `Table` or `TreeTable` also scrolls
  a scrolling panel around the component.** An arrow key, `Home` / `End`,
  `PageUp` / `PageDown`, type-ahead in a list, entering an edit in a table
  (by a key or a double-click), and the keyboard context menu (`Shift+F10`)
  used to scroll only the component's own rows. A scrolling `Panel` around
  the component now follows, by the least distance that shows the current
  row — or column, in a table — and nothing when it is already in view of
  the panel. The panel moves inside the key press: a layout pass queued
  around the component is run first, so what is measured is final. A key
  pressed while a `Split` pane, `Border` region or `Accordion` section
  around the component is still opening or closing scrolls the component
  only, and the next key after the animation scrolls the panel as usual. A
  component in a closed section, or one that is hidden, moves nothing
  around it. A panel follows only when its last layout pass found its
  content overflowing: content that has grown since without a pass of that
  panel is not seen until the panel is laid out, as its scrollbar is not.
  A state setter called from code scrolls
  the component and nothing around it, as before: `List.setFocusedIndex`,
  `Tree.selectNode`, `Tree.revealByPredicate`, `Table.selectRecord`. So does
  a click that selects a row. To bring a row selected from code into view
  of the panels around the component, call
  `FocusReveal.reveal(component.getElement())` after the setter. No
  consumer action is needed.

- **`List` type-ahead moves to the next match and steps on a repeated
  letter.** A letter used to focus the first row from the top whose label
  starts with the buffer, so a repeated letter did nothing. It now focuses
  the next matching row after the focused one, wrapping, and typing the same
  letter again steps through the matches. Several different letters still
  match as a prefix, now starting from the focused row. The key is now
  prevented on the list's own element, as it already was in an open
  `ComboBox`. `MultiSelectList` and the `ComboBox` dropdown change with it.
  The `protected` fields `_typeAheadBuf` and `_typeAheadAt` of
  `AbstractSelectableList` are gone. No consumer action is needed unless a
  subclass read those two fields.

### Core

- **`FocusHistory` records places, not popups.** A control inside a context
  menu, dropdown, popup panel, popover, dialog or modal drawer is no longer
  a stop of the trail; a popover built with `dismissOn: "manual"`, a window
  and a non-modal drawer still are. `Alt+[` and `Alt+]` do nothing while a
  menu, dropdown, popup panel, dialog or modal drawer is open, or a popover
  that is not `dismissOn: "manual"`, and the key is not consumed. `back()`
  and `forward()` return `false` and move nothing while a dialog or modal
  drawer is open. When focus has left the current stop — it is in a table
  cell's editor, or the focused control was removed — `back()` returns to
  that stop first. Consumer action: none, unless code relied on `back()`
  reaching a dialog's own controls.

- **`FocusHistory`'s `canGoBack` / `canGoForward` and `"change"` follow
  focus.** The two flags now say what `back()` and `forward()` would do from
  where focus is. `canGoBack` is `true` when focus has left the current
  stop, also when that is the only stop, because `back()` returns to it.
  Both are `false` while a dialog or a modal drawer is open. `"change"` now
  fires when either flag changes value, and only then. It no longer fires
  after a recorded focus move or a `back()` / `forward()` call that leaves
  both flags as they were, nor from `clear()` when both were already
  `false`. It now also fires for a focus move that records nothing — into a
  table cell's editor or a popup, or off every control — and when a dialog
  or a modal drawer opens or closes. Consumer action: none for a listener
  that copies the two flags onto buttons, but read `canGoBack()` /
  `canGoForward()` once when subscribing, since no event announces the
  starting state. Code that used `"change"` to learn that a focus move was
  recorded can no longer do so.

- **`SpatialNavigation`'s control chord (`Ctrl+Alt`+arrow) chooses its
  landing by new rules.** It only considers controls that are visible —
  not ones scrolled out of another panel, clipped away, off screen, behind a
  floating window, or disabled — and it leaves focus where it is when nothing
  qualifies. A move searches the focused control's own row first (a
  `ToolBar`, `MenuBar`, `TabBar` or accordion header), then its scrolling
  panel, then everything else. Outside its row a control must be in line
  with the focused one, or at least as far forward as it is sideways. A
  `Tree`, `List` or `Table` moves level with its current row or cell. Both
  chords stay inside the non-modal window focus is in, and neither enters
  one from the page behind it. The container rule that ranked everything in
  the same collapsible or scrolling container first is gone: `Ctrl+Alt+→`
  along an accordion header's tool buttons no longer jumps to a button
  elsewhere in the same accordion. The region chord (`Ctrl+Alt+Shift`+arrow)
  keeps its ranking. No consumer action is needed.

- **`Tree` and the `Table` body show a focus ring when a spatial-navigation
  move lands on them.** Neither showed anything before.

- **`FocusReveal.reveal` scrolls once the layout and any open animation
  have settled, which can be after it returns.** It still selects the tab and
  expands the pane, region or section inside the call, so the control can
  take focus on the next line. The scroll used to run inside the call as
  well; it now waits for a layout pass queued around the control and for
  any `Accordion`, `Split` or `Border` around it that is still animating,
  whether this reveal started the animation or not. A reveal
  into a collapsed `Split` pane or `Border` region therefore scrolls when
  the expand ends, about 200 ms later than before, and the pane is back at
  the position it was left at by then. Under `prefers-reduced-motion:
  reduce` there is no delay. A scroll that is still waiting is dropped when
  the user has moved on: a newer reveal was asked for, focus was on the
  control and has gone to another one, a modal layer has opened over it, or
  the user has turned the wheel, pressed the pointer or a scrolling key, or
  panned by touch, on a panel the scroll would move. `FocusHistory.back()` /
  `forward()` and spatial navigation behave the same way. The scroll runs
  after the first layout flush that finds no layout pass queued around the
  control and no section, pane or region around it still moving. That is
  not always the next flush: a panel that gains or loses a scrollbar in one
  pass queues another. The wait is bounded: after 60 flushes, about a
  second, the scroll runs with the geometry it finds. Consumer action: code
  that reads a control's position on the line after `FocusReveal.reveal`
  now reads it before the scroll. Read it in
  `FocusReveal.afterReveal(callback)` instead: the callback runs once the
  scroll is over, whether it ran or was dropped, and at once when no scroll
  is waiting.

- **A disposed component's setters write nothing.** A setter called after
  `dispose()` used to throw `DOM handle … is not registered` when it would
  change an inline style or an attribute. It now updates the component's
  cached state and returns, which also makes a second `dispose()` safe for a
  component whose teardown writes an attribute — a `Dialog` that had already
  closed threw there. Reading or writing through a raw handle still throws.

- **One throwing visibility hook or first-layout callback no longer takes the
  rest with it.** A throw from `onEffectiveVisibilityChange` used to escape
  `Component.flushEffectiveVisibility()` and leave every component queued
  behind it unreconciled; a throw from an `onFirstLayout` callback used to
  abort that component's `doLayout()` and drop the callbacks behind it. Both
  are now caught per entry, logged with `console.error` and counted on the
  diagnostics overlay's "Layout errors" row, as a throwing layout pass
  already was.

### Layouts

- **A floating window rebuilt by `restoreLayout` is built with
  `autoFocus: false`.** A layout restore shows its windows from code, so none
  of them takes focus from what the user is working in. A float torn off a
  tab strip still takes focus. `Dock.focusPanel()` on a float rebuilt this way
  no longer moves focus into it.

- **`CodeEditorSelection` gains `from`/`to`, and `"selectionchange"` widens
  its dedup to match.** The two 0-based document offsets join
  `characterCount` and `lineCount`, giving `getSelection()`'s payload the
  same offsets `getCursorPosition()` already reports — usable directly with
  `getValue().slice(from, to)` or as a CodeMirror selection anchor.
  `"selectionchange"` now fires when any of the four fields changes, not just
  `characterCount`/`lineCount`, so a same-length selection dragged to a
  different place in the document — which left both counts unchanged — now
  emits where it previously did not. A consumer reading only
  `characterCount`/`lineCount` off the payload is unaffected; one that reads
  the new fields, or relies on `"selectionchange"` firing only on a count
  change, should account for the wider dedup.

- **`MarkdownEditor` reads Markdown with the viewer's parser.** A document
  now loads exactly as the `Markdown` viewer renders it: underscore
  emphasis, setext headings, indented and `~~~` code, two-space nested
  lists, autolinks and loose lists are read the way the viewer reads them,
  and a hard-wrapped paragraph shows as one flowing line that saves with its
  line breaks. Hard line breaks keep the form they were written in, and
  Shift+Enter saves as `\` at the line end. A list keeps its bullet (`-`,
  `*` or `+`) or its `.` / `)` number delimiter. Thematic breaks, HTML, and
  blockquotes or list items holding several blocks are kept as editable raw
  Markdown blocks instead of being flattened, so saving no longer corrupts
  them, and so is a table whose rows hold more cells than its header; a link
  with empty text, or whose whole text is another link, is kept as source
  too, showing the inner link's text as the viewer does; an image the viewer
  will not render shows nothing, as in the viewer. An inline construct the
  editor would write back differently (strikethrough over a space before a
  linked image, a bare URL in a heading whose id it is part of) is kept as
  source too, the text around it staying ordinary text, and a raw block edited
  until it reads as several blocks shows as those blocks. Inside a raw block or a
  code block the format toggles, text styles, links, images and tables
  decline, since the block saves its text as written, and content joined or
  pasted into one becomes its Markdown text; converting a block to a code
  block keeps its formatting as Markdown. The toggles, styles and links also
  decline over inline HTML and the other runs kept as source — with whole
  table cells selected a format toggle leaves a cell holding one as it is and
  formats the rest, or takes the format off them when all their text already
  has it — and
  `setBlockType` and the list toggles decline in a table cell (whole cells
  selected included), which holds
  text only, instead of saving `## ` or `- ` into it. Saving writes
  `*`/`**` emphasis — `_`/`__` around emphasis whose own `*` the viewer
  would pair with it (`_foo fuzz**bar** baz_`) — and escapes only
  characters that would change meaning. An image keeps its `{…}` attribute
  group as written, a code block keeps its whole info string and saves with a
  `~~~` fence when it holds a backtick, a paragraph line opening with inline
  HTML that would start an HTML block saves with its `<` escaped, and a list
  next to a raw list block saves with a marker that keeps it its own list;
  two raw list blocks an edit brings together save with a `[//]: #` line
  between them, which shows nothing. No consumer action is needed.

- **`MarkdownEditor` makes nothing a save cannot write as shown.** Shift+Enter
  does nothing at the end of a block or in a level 3–6 heading, and a break an
  edit leaves there is removed (or, in such a heading — or a level 1 or 2
  heading saved on one line, when a line of its setext form would end it —
  shows as the space it saves as). Bold, italic and strikethrough applied over
  edge spaces cover the text only — the toolbar, the context menu and the next
  toggle then read the selection as formatted, so a second press takes the
  format off — and a format, style or link whose result Markdown could not hold
  as shown — emphasis opening with punctuation after a letter (`x**(a)**b`),
  underline over a `+`, a colour over a bracket — is declined, from the
  toggles, the keyboard and the typing shortcuts alike; after a paste, a
  deletion or typing such edges lose the format instead, so a space typed
  after bold text shows plain until the next word joins the bold. Lists of different bullet
  characters or delimiters stay two lists, as the viewer reads them, and a
  list's looseness follows its save; a table stays rectangular with every
  cell aligned by its column, and a heading or list pasted into a cell becomes
  its lines of text; an HTML block left open before other blocks shows as the
  paragraph it saves as; `insertImage` declines alt text holding a bracket.
  No consumer action is needed.

- **`Markdown` merges a table cell only into a whole rectangle.** A `<<`
  extends only a cell begun in its own row, and a `^^` extends the cell
  above only when the row continues every column that cell spans; any other
  `<<` or `^^` now shows as literal text, where it used to leave a hole in
  the grid or push a cell into an extra column. Grids written with `<<` and
  `^^` in every covered position render as before. No consumer action is
  needed.

- **`MarkdownEditor` saves only what you edited.** Blocks you did not
  change keep their exact source — list markers, table padding, line
  wrapping and blank lines — so a one-word edit no longer reformats the
  document, and switching to source mode and back leaves the text as it
  was. No consumer action is needed.

### Overlay

- **A non-modal `Drawer` now stacks below windows, and a modal one in the
  Dialog band.** A non-modal drawer used to take the Dropdown band (10000),
  above every window and popover. It now takes the new `Band.Drawer` (8950),
  above the `Rail` and below windows. A modal drawer takes `Band.Dialog`, so
  its scrim now also covers toasts. In-page drag outlines moved from
  `Band.Window - 1` to `Band.Drawer - 1`, which keeps them under an open
  drawer as before. No consumer action is needed unless an app relied on a
  non-modal drawer covering a window.

- **A modal `Drawer` takes focus when it opens and returns it when it
  closes.** A modal drawer used to leave focus on the control that opened it,
  behind the scrim. It now moves focus to its first control once it has laid
  out, or to the drawer itself when it holds none, and keeps `Tab` and
  `Shift+Tab` inside. When the slide-out has finished, focus returns to the
  element that had it when the drawer opened, unless that element was
  disposed or removed from the page meanwhile. A non-modal drawer moves no
  focus, as before. Code that relied on the opener keeping focus while a
  modal drawer is open — a key handler on that control, say — no longer
  receives those keys until the drawer has closed.

- **A custom `DismissableLayer` should implement `onInertChanged`.** A layer
  without it stays focusable and clickable behind a modal dialog or drawer.
  One line does it: `onInertChanged(inert) { this.setInertAttribute(inert); }`.
  A surface that is not a layer, mounts itself on `<html>` and holds a
  control registers with `LayerManager.addBackgroundSurface` instead. A
  custom `LayoutManager` that mounts a component of its own on its container
  returns it from `getChromeComponents()`, which matters when it is the
  body's manager. See [Layering: Modal scope](/concepts/layering#modal-scope).

- **`Dialog`, `Window`, `TabWindow` and `Drawer` are announced as dialogs.**
  Each now has the `dialog` role, and a screen reader announces it when focus
  enters it. A `Dialog` takes its name from its title and its description
  from its `message`; `Dialog.confirm`, `Dialog.warning` and `Dialog.error`
  are alert dialogs (`alertdialog`). A `Window` takes its name from its header
  text and a `TabWindow` from its active tab's label. A `Drawer` has no title,
  so you name it with `getAria().setLabel(…)`. No layer carries `aria-modal`:
  the application behind a modal is already inert. No consumer action is
  needed unless you already name one of these yourself, which is listed
  under Breaking changes. See
  [Accessibility: Dialogs and windows](/concepts/accessibility#dialogs-and-windows).

- **Title-bar buttons have names and tooltips.** A dialog's close button and
  a window's minimize, maximize, close and window-menu buttons were unnamed
  glyph buttons. They are now named "Close", "Minimize", "Maximize" and
  "Window menu", and show the name as a hover tooltip, which is new. The
  minimize and maximize buttons read "Restore" while the window is minimized
  or maximized. The names are English; to change one, reach the button
  through `dialog.getTitleBar().getCloseButton()`, the new
  `WindowHeader.getMinimizeButton()` / `getMaximizeButton()` /
  `getCloseButton()`, or the new `TabWindow.getMinimizeButton()` /
  `getMaximizeButton()` / `getCloseButton()` / `getWindowMenuButton()`, and
  call `setText`. A button you rename keeps your name in every window state.

## Added

### Components

- **A column resize now reports when it ends.** `TableHeaderEvent` gained
  `"columnresizeend"` and `HeaderCellEvent` gained `"resizeend"`, the header
  cell event the header relays to produce it. Both shipped in 0.10.0 and were
  left out of that release's notes, so they are recorded here rather than
  under a version they did not belong to. A consumer that persists a column
  width, or that runs work which should wait for the drag to settle, listens
  for the end event instead of debouncing `"columnresize"`. The existing
  `"columnresizestart"` and `"columnresize"` are unchanged.


- **`VirtualScroller` exposes its content height.** `getContentHeight()`
  reads the height `setScrollY` clamps against, and `setContentHeight(h)`
  replaces it without clamping the scroll position or moving the
  scrollbars — for an owner whose content changed between renders and must
  scroll against the new height before its next one.

- **`PickerColumn` can centre a cell its caller names.**
  `scrollCellIntoView(cell)` scrolls the column so that cell sits in the
  middle of the view, as `scrollSelectedIntoView()` does for the first
  selected cell. It is for a column that shows more than one cell
  selected, as a calendar's year list does for the calendar's year and
  the year the keyboard is on. Neither method scrolls a column that is
  hidden.

- **`VirtualScroller` gains `getViewportHeight()`,** the twin of
  `getViewportWidth()`: the owner's content-box height, less the track of
  the horizontal scrollbar while that bar shows. An owner tests a row
  against it, not against its own height, to tell whether the row is in
  view.

- **`VirtualRowView.scrollRowIntoView` and
  `AbstractSelectableList.scrollIndexIntoView` take an optional second
  argument, `around`.** Both are `protected`, for a subclass. With `true`
  the scrolling panels around the component follow the row, as they do for
  a key. Without it the component scrolls alone, as it did before, so an
  existing subclass call is unchanged.

- **`VirtualScroller` gains `getViewportRect()`,** the visible window as a
  rectangle in browser-viewport coordinates: the box the rows are clipped
  to, `getViewportWidth()` wide and `getViewportHeight()` high. Unlike the
  two size getters it measures the DOM, so it is for a reveal and not for a
  scroll or render path.

- **A modified tab is announced to assistive technology.** While
  `Tab.setTabModified` (or `TabButton.setModified`) marks a tab, its
  button carries `aria-description="Modified"`, so a screen reader
  reports the unsaved state along with the tab's name.

- **`CodeEditor` languages accept options, and SQL can be parsed as
  PostgreSQL.** `setLanguage(id, options?)` and the new `languageOptions`
  construction option pass a settings bag to the language, and
  `getLanguageOptions()` reads it back. Options travel with the language:
  omitting them, or switching to another language, resets them to `{}`. The
  built-in `sql` language reads `SqlLanguageOptions`
  (`{ dialect?: "standard" | "postgresql" }`, default `"standard"`). The
  dialect sets the grammar used for highlighting, keyword completion and
  lint, and the engine `format()` uses. Under the default generic dialect,
  PostgreSQL's `@>` and `<@` operators and dollar-quoted strings
  (`$$ … $$`) are reported as syntax errors, and `format()` rejects them.
  With `setLanguage("sql", { dialect: "postgresql" })`, they parse and
  format cleanly. `LanguageDefinition`'s three loaders now receive the
  options; definitions that take no argument keep working. No consumer
  action is needed.

- **`MarkdownEditor`'s command API edits the raw Markdown directly in
  `"source"` mode**, instead of leaving the visible source text untouched.
  The five format toggles, `toggleLink`/`removeLink`, `clearFormatting`,
  `cut`/`copy`/`paste`, `setBlockType`, `toggleUnorderedList`/`toggleOrderedList`,
  `insertParagraphBeforeBlock`/`insertParagraphAfterBlock`, `insertImage`, and
  `insertTable` all rewrite the raw text in place around the source
  `CodeEditor`'s own selection, emitting only the dialect's own markers so the
  result round-trips back through `"wysiwyg"` unchanged. They read the raw
  text with the viewer's own parser, so they see every form it reads —
  `__bold__` and `_italic_`, reference links, bare-URL, `www.` and email
  autolinks — and each checks its result, doing nothing when the edited text
  would not read back as intended (markers left literal by Markdown's flanking
  rules or a backslash, or cutting another construct). `removeLink` on a link
  nested in another link's text takes it out of the outer link
  (`[[a](/in) b](/out)` gives `a[ b](/out)`). The block commands work on
  whole blocks as the viewer reads them: a block `setBlockType` or a list
  toggle converts leaves the quotes and list items around it for the top
  level, and what followed it inside them stays there, re-opened by its own
  marker, instead of being left behind as indented code or lazy text; a
  converted paragraph is set apart from its neighbours rather than joining
  them, so toggling a list off makes each item its own paragraph; and
  `insertTable` goes above the whole block holding the caret instead of
  splitting an HTML block or a table. The other eleven
  commands — `setBlockAlignment`, `setColumnCount`, and the nine
  table-structure commands — still no-op in `"source"` mode; each needs its own
  design (a `:::` fence rewrite or a parsed pipe grid) and is left for a
  follow-up. `getSelectionState()` and `"selectionstate"` are mode-aware too:
  in `"source"` mode the five format flags, `hasSelectedText`, and `linkUrl`
  are derived from the raw text, while `inTable`, `tableColumnAlignment`,
  `blockAlignment`, and `columnCount` report the fields that mode has no
  notion of, and `setMode` emits a fresh state so a toolbar's pressed/enabled
  state never lags a mode switch. `CodeEditor` gains the public
  `replaceRange(from, to, insert, selection?)`, the one-transaction seam this
  all rides on. No consumer action is needed.

- **`MarkdownEditor`'s three style setters edit the raw Markdown in `"source"`
  mode.** `setTextColor`, `setFontFamily` and `setFontSize` write the
  dialect's `[text]{color=… font=… size=…}` styled span straight into the
  source text, instead of no-opping there. A new attribute merges into a span
  already around the selection rather than nesting a second one inside it, a
  span the selection only partly covers splits in two, neighbouring text that
  ends up styled alike is written as one span, and the whole `{…}` group goes
  away once the last attribute is cleared. Every attribute group is re-emitted
  in the dialect's own `color`/`font`/`size` order through the same pipeline
  the `"wysiwyg"` export uses, so a span authored in source mode survives a
  mode switch byte-for-byte — a hand-written group in another order is
  re-ordered once, on its first edit. An attribute the dialect does not model
  is kept as written, after those three. The span goes inside any emphasis
  around the selection (`**[world]{color=…}**`, the form `"wysiwyg"` saves),
  and the source text is read with the viewer's own parser, so only a
  selection the span would break is refused: one that crosses a line break,
  touches a link of any form or an image (including an image's `{width=…}`
  group) — mirroring the `"wysiwyg"` side's own refusal inside a link — lies
  in a code span, a code block, a `:::` fence line or a table delimiter row,
  whose own `{…}` groups a span would break, cuts through a run's markers, or
  would put a bracket straight after an escaping backslash (`C:\Users`), where
  the bracket would be literal and the span syntax would show. A selection
  mixing emphasis with plain text keeps its form across a mode switch
  (`[**a** b]{color=#cc0000}`). A format toggle pressed straight after a
  style command that covered more than one span does nothing, since its
  markers would cut the spans; reselect inside one span first. No consumer
  action is needed.

- **`MarkdownEditor` edits reference-style links.** `[text][label]`,
  `[label][]` and `[label]` show as links and save in the form they were
  written, and their definition lines save unchanged. A link whose URL is
  edited, or whose definition is edited or removed, saves inline with its
  own URL, so a save never changes where a link points. Bracketed text never
  turns into a link when a definition for it is added, and a reference kept
  as written shows what its edited definition now gives it.

### Core

- **`Body.init({ strings })`, `Body.setStrings`, `Body.getStrings` and the
  `BuiltInStrings` type** — an application-wide table of the library's
  built-in strings, holding the dialog close button's name.

- **`LayerManager.Band` gains `Drawer`** (8950, between the `Rail`'s fixed
  8900 and `Window`).

- **`DismissableLayer` gains an optional `keepsOwnBand()`** for a nested layer
  that must stack in its own band while staying linked under its opener.

- **`Aria.setHidden(null)` removes `aria-hidden`.** Like `setExpanded(null)`,
  it leaves the element as if the attribute had never been set, where
  `setHidden(false)` writes `aria-hidden="false"`.

- **`DismissableLayer.requestClose()` may return `false` to decline.** The
  layer stays open and `LayerManager` leaves the `Escape` that triggered the
  request unhandled, so it reaches the focused content. Any other return,
  including none, counts as handled, as before.

- **`Aria` gains `setDescription` / `getDescription` / `clearDescription`**
  for `aria-description`, mirroring the `setLabel` / `getLabel` /
  `clearLabel` trio.

- **`LayerManager` gains the modal-scope API.** `hasModalLayer()` says
  whether any registered layer is modal, wherever it sits in the stack.
  `isBehindModal(node)` says whether an element lies outside the topmost
  modal layer and the layers opened from it. `containTab(e)` wraps `Tab` and
  `Shift+Tab` at the edges of that scope; the manager calls it for every
  `Tab`, and a layer that closes itself on `Tab` calls it again once focus
  is back on its opener. `addBackgroundSurface(surface)` and
  `removeBackgroundSurface(surface)` register a `BackgroundSurface`: a
  surface that is not a layer but must go inert behind a modal one.
  `DismissableLayer` gains two optional members: the `onInertChanged(inert)`
  hook, and `isLayerClosing()`, which a layer that stays registered while it
  fades out returns `true` from, so that its controls are left out of the
  `Tab` wrap meanwhile. `AnimatedDropdown` implements both. See
  [Layering: Modal scope](/concepts/layering#modal-scope).

- **`Component.setInertAttribute(value)` / `getInertAttribute()`** write and
  read the HTML `inert` attribute, buffered until render like every element
  attribute. `LayerManager` drives it for the surfaces behind a modal layer,
  and overwrites a value set from elsewhere on a layer or on a component
  added to `Body`; there is no options-bag field.

- **`Panel` gains `getScrollViewportRect()`, `revealSpan()`,
  `revealRect()` and `hasScrollRange()`.** `getScrollViewportRect()`
  returns the visible window onto a scrolling panel's content, in
  browser-viewport coordinates: the panel's box inside its border, clear of
  its scrollbars, and the same rectangle under either `scrollbarStyle`. It
  returns `null` for a panel that does not scroll (`autoScroll: "none"`),
  is not rendered, or is hidden. `revealSpan(axis, start, end)` scrolls the
  least distance that brings a span of the content into that window along
  one axis; `start` and `end` are positions in the content, so a caller
  that knows its own row arithmetic need not measure an element. It leaves
  alone an axis the panel does not scroll, and a hidden panel. The
  scrolling panels around the panel then scroll along the same axis to show
  the span as well, inside the call: a layout pass queued around the panel
  is run first, and while a pane, region or section around the panel is
  still opening or closing the panels around it are left alone. Pass
  `false` as a fourth argument to scroll this panel and nothing else.
  `revealRect(rect, axis?)` does the same for a rectangle given in
  browser-viewport coordinates, in this panel alone, and returns what the
  panel then shows of it. `hasScrollRange(axis?)` says whether the content
  overflowed the viewport when the panel was last laid out, without
  measuring anything.

- **`FocusRevealer` gains four optional members, and `FocusReveal` gains
  `revealRectAround()` and `afterReveal()`.** A revealer that scrolls
  implements `revealRect(rect, axis?)`: it scrolls the least distance that
  shows a
  rectangle, given in browser-viewport coordinates, and returns what it then
  shows of it. It may also implement `hasScrollRange(axis?)`, to say
  without measuring whether it has anything to scroll. A revealer whose
  open animates implements `isRevealSettled()`, which is `false` while a
  section, pane or region is still moving, and one that opens implements
  `hidesDescendant(target)`, which says whether a control is in a part it
  hides right now. `Panel` and `ScrollStrip` implement the first two;
  `Accordion`, `Split` and `Border` implement the last two, and `Tab` the
  last. `FocusReveal.revealRectAround(component, measure, axis?)`
  lets a component that scrolls its own rows ask the scrolling panels
  among its ancestors to show a rectangle it worked out. Everything
  happens inside the call, and nothing waits. A layout pass queued around
  the component is run first. Nothing moves while a pane, region or section
  above the component is still opening or closing, while an opener hides
  the component or the component is hidden, from inside a layout pass, or
  when no panel has anything to scroll. `measure` is called only when the
  panels are about to move and may return `null`; it is passed `true` when
  a layout pass was run first, in which case the caller has to scroll its
  own content again before it measures. `FocusReveal.afterReveal(callback)`
  runs `callback` once the scroll of the latest `FocusReveal.reveal` is
  over, and at once when none is waiting. A callback may ask for another
  reveal, and one that throws is reported on the console without stopping
  the others. A custom revealer that scrolls
  should implement `revealRect`; without it, it is called before every
  scroller.

- **`Aria` gains `setDescribedBy` / `getDescribedBy` / `clearDescribedBy`,
  `clearLabelledBy`, and the `'alertdialog'` role.** The first three read and
  write `aria-describedby`, the id of the element whose text describes this
  one. `clearLabelledBy()` removes `aria-labelledby`, which `setLabelledBy`
  could set but nothing could take away; a browser prefers that reference
  over `aria-label`, so it has to go before `setLabel` can rename an element.

- **`LayerManager.isInTransientLayer(node)`** says whether an element lies
  inside a transient layer: one that an outside click or focus move
  dismisses, such as a menu, a dropdown or a popover. Only the layer the
  element lives in is asked, not the layer it was opened from.

- **`Component` gains `navigationGroup` / `setNavigationGroup` /
  `isNavigationGroup`.** A group is one row or column of related controls
  that the control chord searches before looking elsewhere. `ToolBar`,
  `MenuBar`, `TabBar` and `AccordionHeader` are groups by default.

- **`FocusRevealer` gains an optional `getScrollViewportElement()`,** which
  a revealer that scrolls implements to name the element its content scrolls
  inside. `Panel` and `ScrollStrip` implement it.

- **`LayerManager` gains `getLayerContaining(node)` and `getLayers()`.**

- **`SmoothScroller.stop()` cancels the in-flight loop without reading.**
  For an owner that is being torn down, where `reset()` would re-read the
  live position through an element that is already gone.

### Data

- **`JsonWriter.dataFor` is `protected`.** A subclass can override it to
  change which fields are written — to drop server-generated columns, say —
  and keep `'dirty'` mode and the per-type `Date` forms, instead of
  re-implementing the `Writer` interface.

### Layouts

- **`LayoutManager.getChromeComponents()`** returns the components a manager
  mounts on its container's element beside the container's children: `Tab`'s
  tab strip, `Accordion`'s section headers and wrappers, and the gutters of
  `Split`, `Border` and `Accordion`. They are not in the container's
  `getComponents()`. `Body` reads it to make them inert behind a modal
  dialog. The base implementation returns none.

- **A `Card` can now select its visible child by a caller-supplied key.**
  `LayoutConstraints` gained a `key` field, and `Card` gained
  `setVisibleKey`, `getVisibleKey`, `hasKey` and a `visibleKey` option. A key
  names a child slot the way a component id does, with one difference that is
  the point of it: a key can name a child that has not been built yet. So
  `container.addComponent(() => new Panel(), { key: "misc" })` registers a page
  unbuilt, and the page is constructed the first time `setVisibleKey("misc")`
  asks for it — or, when the key was selected before the registration arrived,
  on the first layout pass of a rendered container. Selection by id is
  unchanged and keeps working; the two share one selection, so each setter
  retires the other. The build is synchronous, so a factory returning a promise
  throws and an asynchronous one still needs a `Tab`. `lazy: false` declines
  the deferral on a `Card` exactly as it does on a `Tab`, and `lazy` is
  therefore now read by two managers rather than one.

### Overlay

- **`DialogConfig.closeButtonLabel`** names the title-bar close button of one
  dialog, including one built by `Dialog.show`. See
  [Dialog: Screen readers](/components/Dialog#screen-readers).

- **`WindowOptions.autoFocus`, `setAutoFocus` and `isAutoFocus`** choose
  whether a window takes keyboard focus when code shows or raises it. The
  default is `true`.

- **`DockCloseController`** types the controller a `Dock` `"beforeclose"`
  listener receives. `Dock.on("beforeclose")`, `off` and
  `DockOptions.listeners.beforeclose` used to declare a `TabCloseController`,
  although a float window's chrome ✕ passes a `WindowCloseController`. All
  three types have the same `preventDefault()` shape, so a listener annotated
  with either old type still compiles.

- **`Menu.handleKey(e)`, and the keyboard-highlight methods work in rebuild
  mode.** A control that opens a rebuild-mode menu and keeps DOM focus can
  forward its keydowns to `handleKey`: `ArrowDown` / `ArrowUp` move the
  highlight and `Enter` / `Space` activate the highlighted row. `focusItem`,
  `focusNext`, `focusPrev`, `activateFocused` and `getFocusedIndex` used to
  throw on a rebuild-mode menu; they now work in both modes. Each
  `toggleFor()` starts with no row highlighted, and so does a `show()`
  opened with the mouse. No consumer action is needed.

- **`DialogConfig.role` and `DialogConfig.ariaLabel`, and the `DialogRole`
  type.** `role` is `'dialog'` (the default) or `'alertdialog'`, for a message
  that interrupts the user and needs an answer. `ariaLabel` replaces the
  title as the dialog's accessible name. Both are config fields because
  `Dialog.show(config)` never hands out the dialog; on a constructed dialog
  the same values are reached through `dialog.getAria()`. See
  [Dialog: Screen readers](/components/Dialog#screen-readers).

- **A `Popover`'s title is its accessible name.** A popover already had the
  `dialog` role; it now points `aria-labelledby` at its title, and drops the
  reference when the title is cleared. A popover without a title has no
  name until you call `getAria().setLabel(…)`, and a popover you named
  before giving it a title keeps your name.

- **`WindowHeader` and `TabWindow` expose their title-bar buttons.**
  `WindowHeader.getMinimizeButton()`, `getMaximizeButton()` and
  `getCloseButton()`, and `TabWindow.getMinimizeButton()`,
  `getMaximizeButton()`, `getCloseButton()` and `getWindowMenuButton()`,
  return the buttons, so that an application can rename them with `setText`.

## Fixed

### Components

- **An `AutoCompleteField`'s suggestion list is no longer a Tab stop.** The
  field keeps focus while its suggestions are open and closes them on `Tab`,
  but the list itself could take that `Tab` when nothing focusable followed
  the field, and focus was then lost as the list closed. No consumer action
  is needed.

- **The table's filter row reads a typed `YYYY-MM-DD` as a local day.** A
  `date` or `datetime` operand was parsed with `new Date(text)`, which reads
  a bare date as UTC midnight, so "Equals" and the ordering operators landed
  on the previous day west of UTC. A date with a time, such as
  `2026-06-28 12:04`, is read as before.

- **A `Table` whose columns fit no longer flashes a horizontal scrollbar while
  it is resized.** A resize rescales the columns
  proportionally, and for some widths the rescaled widths summed to a fraction
  of a pixel over the width they fill. The virtual scroller and the
  `Scrollbar` both read that float error as overflow, so the horizontal bar
  showed for a frame and the viewport shrank by a track, pulling the bottom
  scroll shadow up with it. Content now has to exceed the viewport by more
  than half a pixel to count as overflow. No consumer action is needed.

- **A text field inside a `ToolBar` keeps its arrow keys.** The bar's
  roving-focus handler took `ArrowLeft` / `ArrowRight` (`ArrowUp` /
  `ArrowDown` on a vertical bar) from every child, so a `TextField`'s caret
  could not move — focus jumped to a toolbar button instead. While a
  text-entry child has focus — an `<input>` that takes text, a
  `<textarea>`, or a `contenteditable` surface such as `CodeEditor` or
  `MarkdownEditor` — the bar now leaves the arrow keys to it. `Tab` and
  `Shift+Tab` leave a text field, as before; a `CodeEditor` keeps `Tab` for
  indenting, so press `Escape` and then `Tab` to leave it. No consumer action
  is needed.

- **`SplitButton`'s dropdown opens from the keyboard.** It could only be
  opened by clicking the chevron. With the button focused, `ArrowDown` or
  `Alt+ArrowDown` now opens it with the first row highlighted; `ArrowUp` /
  `ArrowDown` move the highlight, `Enter` / `Space` run the highlighted row
  without firing the primary action, `Escape` closes it, and `Tab`,
  `ArrowLeft` and `ArrowRight` close it and move focus as usual. Focus stays
  on the button throughout. In a vertical `ToolBar` plain `ArrowDown` still
  moves between the toolbar's buttons, so `Alt+ArrowDown` opens the dropdown
  there. The button now declares `aria-haspopup="menu"`, keeps
  `aria-expanded` in step and names the menu in `aria-controls`. No consumer
  action is needed.

- **A modified tab without a glyph now shows its "unsaved changes" dot.**
  The dot was drawn only as a badge over a tab's leading glyph, so
  `Tab.setTabModified(content, true)` on a glyph-less tab showed nothing.
  On such a tab the dot now sits over the label's upper-left corner,
  still as an overlay that never moves the label. The 0.10.0 notes
  described this dot as trailing the label; since 0.10.0 it has been a
  badge on the glyph's corner.

- **Shift+F10 opens the context menu of the current tree row, list row or
  table cell.** Shift+F10 and the ContextMenu key opened nothing there: a
  `Tree`, a `List` and a table body hold focus on their own element, so the
  browser sends the key's `contextmenu` event to the widget and not to a
  row or a cell. `Tree`, `List`, `MultiSelectList`, `Table` and `TreeTable`
  now open the menu for the current row or cell and under it. Each scrolls
  that item into view first. It is the menu a right-click on that item
  opens, the selection is not changed, and with no current item nothing
  opens. One contract changes: for a keyboard menu a `Tree` or `List`
  `"contextmenu"` listener receives a synthetic event, with `clientX` /
  `clientY` under the row and a `null` `target`. No consumer action is
  needed unless a listener reads `event.target`.

- **A `List` scrolls its focused row into view.** With overlay scrollbars,
  the default, moving the focused row with the arrow keys, `Home` / `End`,
  `PageUp` / `PageDown`, type-ahead or `setFocusedIndex` did not scroll the
  list, so the row could sit out of view. `List` and `MultiSelectList` now
  scroll the least distance that shows the whole row, vertically only, so
  a list with `horizontalScrolling` keeps its horizontal position. The
  dropdown of a `ComboBox` follows its highlighted option for the same
  reason. A programmatic selection — `setSelectedIndex`, `setValue`,
  `setValues` — does not scroll, as before. No consumer action is needed.

- **A calendar's year list opens on the calendar's year and follows the
  keyboard.** The year list of a `DateField` or `DateTimeField` opened on
  its first year, with the calendar's year out of view, and the arrow
  keys, `PageUp` / `PageDown`, `Home` / `End` and typing a year moved a
  highlight the list did not follow. It now opens centred on the
  calendar's year, and each of those keys puts the year it highlights in
  the middle of the list, towards earlier and later years alike; at
  either end of the list the highlight sits as near the middle as the
  list allows. A view scrolled with the wheel or the scrollbar stays
  where it is until a key moves the highlight. A click on a month arrow
  while the list is open no longer clears the mark of the year the
  keyboard is on. A table's date and date-time cell editors open the
  same calendar and get the centring. No consumer action is needed.

- **A `Tree`, `Table` or `TreeTable` no longer leaves its current row or
  cell partly hidden.** With a border, or with the other axis's scrollbar
  showing, the row or column that the keyboard scrolled into view — or
  that Shift+F10 opened a menu for — stayed clipped by up to 16 px, under
  the border and the scrollbar. `PageUp` / `PageDown` in a `Table`,
  `TreeTable`, `List` or `MultiSelectList` also moved one row too many in
  the same situation, so one row per page was never shown whole. A page is
  now the number of whole rows in view. No consumer action is needed.

- **A `ComboBox` dropdown opens on its selected option.** It opened
  scrolled to the top, with a selected option further down out of view.
  The option is now scrolled into view by the least distance, so one below
  the first page appears at the dropdown's bottom edge. A table's combo
  cell editor opens the same dropdown. No consumer action is needed.

- **A time picker opens on its selected time.** The dropdown of a
  `TimeField` opened with every column scrolled to the top: with `09:30`
  in the field, `09` was below the view. Each column now opens with its
  selected hour, minute or second in the middle, or as near the middle as
  the ends of the column allow. A minute or second that is not a multiple
  of five has no cell, and its column is not scrolled. Picking a value
  still does not scroll. The time row of a `DateTimeField` and a table's
  time and date-time cell editors open the same dropdown. No consumer
  action is needed.

- **A `MarkdownViewer` minimap click lands on the heading after the prose
  was scrolled from the keyboard.** After `PageDown` or another scroll the
  browser makes on its own, a click on a minimap heading stopped short of
  it by the distance scrolled. No consumer action is needed.

- **A `Tree` pages with `PageUp` / `PageDown`.** The two keys did nothing in
  a tree and left the browser to scroll whatever was behind it. They now
  move the current row by one page — the number of whole rows the tree
  shows — select it and scroll it into view. With `Shift` they extend the
  selection, like the arrow keys and `Home` / `End`. `Table`, `TreeTable`,
  `List` and `MultiSelectList` already paged. One behaviour changes: a
  focused tree now takes the two keys, so they no longer scroll a panel
  around it; a `keydown` listener on an ancestor still receives them. A
  tree tall enough to show all its rows, inside such a panel, therefore
  moves to its last or first row. No consumer action is needed.

- **A `Tree`'s `Shift`+arrow starts a range when there is no anchor.** With
  nothing selected — or after the anchor's node was removed, or hidden by a
  collapse — `Shift` with an arrow key, `Home` or `End` selected one row at
  a time and never built a range. Unless a collapse had hidden the anchor,
  `getSelectedNode()` also returned `null` beside a non-empty selection.
  Such a move is now a plain move whose row becomes the anchor, as a
  `Shift`-click with no anchor already was. A `Shift`-click whose anchor a
  collapse has hidden is a plain click too: before, it selected the clicked
  row and left the hidden node as the anchor; now the clicked row becomes
  the anchor and, with `expandTrigger: "click"`, toggles. With `Ctrl` or
  `Cmd` held as well it is a `Ctrl`/`Cmd`-click, which toggles the clicked
  row in the selection where it used to replace the selection. No consumer
  action is needed.

- **A `List`, `Tree`, `Table` or `TreeTable` in a scrolling panel keeps its
  current row in view of that panel while the keyboard moves it.** A key or
  `Shift+F10` scrolled only the component, so the current row could sit
  below the panel's edge, out of sight. The panel now follows by the least
  distance: up or down for a row, sideways for a table column. See the
  entry under Changed for what follows and what does not.

- **A `Tree`, `Table` or `TreeTable` no longer holds empty rows.** A view
  with more rows than fit kept three spare pool rows displayed and unbound,
  which were empty `treeitem` or `row` elements a screen reader could reach.
  A spare row is now hidden until it shows data. No consumer action is
  needed.

- **A `Tree` has type-ahead.** Typing the first letters of a label moves to
  the next visible row that starts with them, selects it and scrolls it into
  view. The same letter typed again steps through the matches. Only visible
  rows are searched and nothing is expanded or loaded, and the keys are
  prevented, not stopped. No consumer action is needed.

- **`Enter` activates the current `Tree` row.** The tree's activation
  event, `"dblclick"`, fired only for a double-click, so "open" was out of
  reach from the keyboard. `Enter` on the current row now fires it and then
  toggles an expandable node, as a double-click on the row does. A held key
  activates once, and `Enter` with a modifier is left alone. One behaviour
  changes: a `"dblclick"` listener now also runs for `Enter`, and in a modal
  `Dialog` with a primary button the dialog is confirmed as well. No
  consumer action is needed unless a `keydown` handler of your own already
  opens the node on `Enter`: remove it, or it opens the node twice.

- **`*` expands a `Tree` row's siblings.** It opens every sibling of the
  current row whose children are already loaded, fires `"expand"` for each,
  and never starts a lazy load. No consumer action is needed.

- **`Home` / `End` activate the first / last tab of a `Tab` strip.** They
  act while a tab or its ✕ holds focus, and a strip tool keeps the keys. No
  consumer action is needed.

- **Disposing a `Tree` or a `Table` while it is still scrolling no longer
  throws.** Closing the tab or window that held one during an eased wheel
  scroll or a touch fling logged an uncaught `DOM handle … is not
  registered` on the next frame. No consumer action is needed.

- **A `SpinButton` or a `Scrollbar` arrow disposed while pressed stops
  repeating.** Its repeat timer used to keep firing every 40 ms for the life
  of the page. No consumer action is needed.

- **A `Tree` disposed during a lazy load stays quiet.** `revealByPredicate`
  could reject with a handle error or go on calling `loadChildren` for the
  remaining lazy branches; it now resolves `null`. `expandNodeAsync` resolves
  `false`. No consumer action is needed.

- **A paste into a `Table` that was disposed while the clipboard was being
  read writes nothing.** It used to write the clipboard into the store. No
  consumer action is needed.

- **`MarkdownEditor`'s 32 command-API methods no longer mutate the hidden
  Lexical document while `"source"` mode is showing.** Every command called
  `ensureEditor()` and acted on the Lexical state regardless of which surface
  was visible, so pressing one in `"source"` mode silently rebuilt the Lexical
  document from the stale text it last held, fired a `"change"` carrying
  content the user never typed (the Lexical round-trip's own normalisation),
  and could desync `getValue()` from what the visible `CodeEditor` showed.
  No command reaches the hidden Lexical document in `"source"` mode any more:
  the twenty-one listed under *Added* rewrite the visible source text instead,
  and the other eleven are explicit, documented no-ops. No consumer action
  is needed.

- **`Markdown` no longer prints link reference definitions.** A
  `[label]: url` line — such as the version-link block at the foot of a
  changelog — rendered as a paragraph of literal text. It now renders
  nothing, as CommonMark specifies, at the top level or inside a
  blockquote, list item or `:::` fence. A reference link inside a table
  cell also resolves now when its definition comes after the table; it
  used to render as literal text. No consumer action is needed.

- **`Markdown` renders hard line breaks.** A line ending in `\` or in two or
  more spaces now breaks the line, as CommonMark specifies. It used to flow
  into the next line, and the backslash form printed a stray `\`. A plain
  line end inside a paragraph still flows. No consumer action is needed.

- **`Markdown` shows a task-list item's marker.** `- [ ] task` rendered
  only `task`; it now renders `[ ] task`, as it already did when the
  item's text held an escape or formatting. The marker is still literal
  text, not a checkbox. In a task item a blank line before its nested list
  or second paragraph makes loose (`- [x] a` over a blank line and
  `  - b`), the marker stood on a line of its own above the item's text; it
  now starts the item's first paragraph, as in GFM and in a list loose from
  its first item. No consumer action is needed.

- **`Markdown` no longer drops a character after a blockquote.** When a
  list inside a blockquote ran on through a lazy line, the line straight
  after the quote could lose its first character, so `<div>` showed as
  `div>` and `1. g` as `. g`. No consumer action is needed.

- **`MarkdownEditor` aligns and columns a selection that reaches into a table
  or a `:::` column.** `setBlockAlignment` and `setColumnCount` threw when
  the selection spanned two table cells, or ran from outside a `:::` fence
  into one of its columns. With the caret in a table that was not the
  document's first block, they wrapped an earlier block instead of the table.
  They now wrap the whole table or fence the selection reaches.
  `setColumnCount` also threw when it merged or dropped a column the
  selection ended in and the fence then unwrapped; it now unwraps the fence.
  No consumer action is needed.

- **`MarkdownEditor.toggleLink(null)` no longer throws at a link's edge.** A
  selection that ended exactly where a link starts, or started exactly where
  one ends, made Lexical's link removal throw. A link with none of its text
  selected is now left as it is. No consumer action is needed.

- **`MarkdownEditor` no longer throws when deleting from the start of a
  paragraph into a later one.** Deleting, typing over, cutting, pasting over
  or pressing Enter on a selection that started at the beginning of a block
  and ended inside a word of a later block could throw inside Lexical. The
  document was then left partly edited. These edits now apply normally. No
  consumer action is needed.

- **`MarkdownEditor` keeps the caret inside text a save trims.** Deleting
  the last line of a block converted from a code block (for example with
  `setBlockType("quote")`) left the caret past the end of the trimmed text,
  and the next edit or `getSelectionState()` threw. The caret now stays at
  the text's end. No consumer action is needed.

- **`MarkdownEditor` keeps ordered list numbers to nine digits.** Typing
  `1234567890. ` (or pressing Enter after it) started an ordered list that
  the save wrote as a paragraph, since a Markdown list marker holds at most
  nine digits; the typing shortcut now starts a list only for one to nine
  digits. An item added after `999999999.` now lowers the list's first
  number so every item still has nine digits at most. No consumer action is
  needed.

- **`Markdown` reads code blocks inside a `:::` fence as code.** A `:::`
  line inside a fenced code block in a fence closed the fence early, and a
  `::: …` line there left it unclosed. A `|||` after a ```` ```` ```` code
  block holding a ```` ``` ```` line, or after a `~~~` block holding one,
  did not start a new column. Code fences now open and close as CommonMark
  reads them, also on a list item's marker line, and a `:::` or `|||` line
  inside code is code; a `:::` fence opened on a list item's marker line
  nests. `MarkdownEditor`
  loads these documents the same way. A code block left open inside a fence
  now hides the fence's closing line, so that fence renders as ordinary
  paragraphs; close the code block to keep the fence.

- **`MarkdownEditor` saves `:::` columns as it shows them.** Wrapping a
  block in a fence with `setBlockAlignment` or `setColumnCount`, or pasting
  or typing into a column, could save a fence the viewer ended early or
  never closed: an HTML or other raw Markdown block holding a `:::` line, a
  `::: …` line or an unclosed code fence, and a code block holding an
  indented fence-like line. Such a raw block now saves, and shows, as a
  paragraph of the same text, and such a code block is written with a
  longer fence. Pasting a selection that spanned two columns left bare
  columns in the document, shown as raw blocks and saved as their contents;
  they now become the blocks they hold. An unedited paragraph starting with
  an unclosed `::: …` line was saved as loaded even after a block added
  after it held a `:::` line, which turned the two into a fence; that line
  is now saved escaped. No consumer action is needed.

### Core

- **A completing animation no longer clears a `transition` a later animation
  on the same element is running through.** `transition` is one CSS property
  on one element, so two animations playing on the same element share the
  declaration — and because the one that started first also finishes first,
  its completion was taking the rule out from under the one that had
  superseded it. The superseded animation's deadline landed mid-flight and
  the live animation snapped to its end state instead of travelling to it,
  losing as much as its whole duration minus the 40 ms fallback grace: a
  second gesture 108 ms into a 120 ms fade cost that fade 68 of its 120 ms.
  A completion now leaves the declaration alone while a later animation on
  the same element is still running through it, and that later one clears it
  at its own end. The surfaces a plain gesture reaches are `ComboBox` and
  the other picker dropdowns, `PopupButton` panels, `Menu`, `Popover`,
  `Dialog` (panel and backdrop), `Drawer` (panel and scrim), and `Window` —
  whose own element carries four of these animations at once, its entrance
  fade, its close fade and the two rail genies, and whose rail pair is the
  instance `rail-handover-follow-ups` had fixed per-site. No consumer action
  is needed.

- **`Favicon` no longer writes the browser-tab icon through a stale element
  handle after the DOM seams are swapped.** The injected `<link rel="icon">`
  was remembered in module state that outlived a seam swap, so a later
  `Favicon.install` swapped the `href` on a handle the new sink had never
  minted instead of appending a fresh link. The cache is now dropped
  automatically whenever the installed sink is replaced. No consumer action is
  needed.

- **`FocusTraversal` stands down entirely while an open `Dialog` is the
  topmost layer.** With focus in an editor inside the dialog, the service
  armed its own `Escape` release for the editor alongside the dialog's, and
  moved focus a second time on the next `Tab`.

- **A viewport listener registered by another viewport listener no longer
  receives the event that one is handling.** `Event.addViewportListener`
  handed the event in flight to a listener added by an earlier viewport
  listener of the same dispatch, which a native listener added during a
  dispatch never gets. A `Dialog` opened from a viewport `keydown` listener
  therefore saw the key press that opened it, and confirmed itself on
  `Enter` unless focus was on a button, a text area or an editing surface.
  Such a listener now receives the next event of its type. A viewport
  listener registered from an element listener earlier in the same event is
  unchanged. No consumer action is needed.

- **A `Panel` scrolls a control into view correctly.** After the browser
  had scrolled the panel itself — a key press such as `PageDown`, `Tab`
  moving focus to a control out of view, a touch pan, a native scrollbar —
  the reveal started from an out-of-date position and stopped short. With
  `scrollbarStyle: "native"` the control could end under the scrollbar or
  the border. A panel was scrolled along an axis its `autoScroll` mode does
  not scroll, with no scrollbar to bring it back. And a control wider or
  taller than the panel lost its start. `Panel.revealDescendant` now
  re-reads the position, measures the visible window inside the border and
  clear of the scrollbars, moves only the axes the panel scrolls, and keeps
  the start of a control that does not fit. `Panel.revealRect` and
  `Panel.revealSpan` apply the same rule: focus history and spatial
  navigation reveal through `revealRect`, and a `Menu`'s highlighted row
  through `revealDescendant`. No consumer action is needed.

- **A control inside nested scrolling panels is scrolled into view in one
  step.** The outer panel scrolled before the inner one, so the control
  could end out of sight until a second attempt. A panel around a collapsed
  `Split` pane, a collapsed `Border` region or a closed `Accordion` section
  scrolled before the control had a box. The scroll ran while an `Accordion`
  section was still opening and stopped short. A pane or region that had
  just expanded lost the position it had been left at. And a reveal asked
  for before a new panel's first layout did nothing. Now the tab, pane,
  region or section opens first; then each scrolling panel moves, from the
  innermost out, after the layout and any open animation have settled.
  Focus history, spatial navigation and `FocusReveal.reveal` all use it.
  `FocusReveal.reveal` still opens at once, and its scroll can follow after
  the call returns; `FocusReveal.afterReveal` tells a caller when. A
  control that is not rendered, and one behind a modal layer, scroll
  nothing. No consumer action is needed.

- **Focus history no longer stumbles over a menu or dialog that has
  closed.** The control that opened a context menu from the keyboard, or a
  dialog, was left in the trail twice, so one `Alt+[` did nothing visible.
  Opening either dropped the forward part of the trail. `Alt+[` with a menu
  or a dropdown open moved focus to the page and left the menu or dropdown
  open. After a popup or a drawer closed with focus inside it, `Alt+[`
  skipped the control that opened it. And `enable()` with nothing focused
  recorded `<body>`, so `canGoBack` reported `true` with nowhere to go. No
  consumer action is needed.

### Layouts

- **A `Split`'s `paneSizes` and `collapsedPanes` now survive a layout pass
  that runs before its panes are added.** Both options were drained on the
  first layout pass and cleared whether or not that pass had any pane to
  apply them to, so a split handed to `Body.init` — which lays out once
  while it waits for the startup font — lost its seeded pane widths and its
  collapsed panes on every load, falling back to an equal division, or to
  each pane's own preferred width where it declares one. Each
  option is now held until the first pass that has panes. A genuinely stale
  array is still discarded whole, once, and `applyPaneSizes` now says so in
  the console instead of discarding in silence; it also warns when it is
  called before the container has panes, which is a no-op. No consumer
  action is needed.

- **A `VBox`/`HBox` child that grows past its resolved slot during its own
  commit no longer overlaps the siblings placed after it.** Both managers
  resolve every child's placement before any of them commit, so a child whose
  own `setWidth` raises its minimum height — `Markdown`'s width-triggered
  re-measure being the real-world trigger — clamped taller than the slot the
  calc phase gave it, while every later sibling kept the position that phase
  had already fixed. The overlap cleared itself one frame later, once the
  growing child's own scheduled layout caught up, but that frame was
  visible: a demo block on the docs site landed up to 1909px inside the
  prose above it. Committing a placement loop now carries a running
  main-axis drift — how far each child committed *past* the extent resolved
  for it — onto every later sibling, in the same pass. Only growth is
  carried, so a child that commits smaller than its resolved extent, as an
  equal-mode cell's child with a size ceiling of its own does on every pass,
  leaves its siblings exactly where they were planned. No consumer action is
  needed.

### Overlay

- **A window closed while its rail-minimize genie is still running now fades
  out from its resting state.** Closing a window mid-collapse cancelled the
  genie, but a cancel writes no styles, so the shrink-into-the-rail
  `transform` and `opacity` were still on the element and the close fade
  animated out of the shrunken, half-faded state — reading as the window
  simply disappearing. The collapse is now undone and the window's resting
  state committed two animation frames before the fade arms, so the close
  fade of a window caught mid-collapse starts that much later than an
  ordinary one, which is unchanged. No consumer action is needed.

- **`DOM.reset()` now cancels a `Notification`'s pending auto-dismiss, and
  disposing a toast cancels its own.** The toast's auto-dismiss timer used
  the bare global `setTimeout`, which `DOM.reset()` cannot reach, so a suite
  that showed a toast and then reset the DOM had the dismiss run afterwards
  and animate the toast out through handles the reset had discarded. The
  timer now goes through `DOM.sink`, like `AutoCompleteField`'s and the
  table filter row's, and `Notification`'s destructor clears a timer a
  dispose would otherwise have left armed. No consumer action is needed.

- **The keyboard can no longer reach the application behind a modal `Dialog`
  or `Drawer`.** A dialog wrapped `Tab` only while it was the topmost layer
  and only between the first and last element its selector matched, so focus
  got out in several ways: `Tab` from a context menu or an open `ComboBox`
  dropdown on the dialog's last control; `Shift+Tab` after a click on the
  dialog's text; `Tab` from the last visible control when a hidden one
  followed it; and `Alt+[` with a menu open, which
  [`FocusHistory`](/recipes/focus-history) took to a control of the page. A
  dialog with nothing focusable left focus on the button that opened it,
  where `Space` opened a second one. A modal drawer did not hold focus at
  all. Now, while a modal dialog or drawer is open, the rest of the
  application is `inert` — every component added to `Body`, every layer the
  modal was not opened from, the `Rail`, and each toast's dismiss button —
  so it cannot be focused, clicked or read by a screen reader. `Tab` wraps
  inside the modal and the layers opened from it, and a modal with nothing
  focusable takes focus itself. The library marks its own containers and
  never `<body>` or `<html>`, so a browser extension's own menu beside a
  dialog stays usable. Three things follow for application code.
  `element.focus()` on something behind a modal does nothing until the modal
  closes. An element appended by hand to `<body>` or `<html>` is not made
  inert and can still be reached; build it as a `Popover` or `PopupPanel`,
  which take part. And the feature needs the `inert` attribute: Chrome 102,
  Firefox 112, Safari 15.5 (see
  [Browser support](/reference/browser-support)). See
  [Dialog: Keyboard](/components/Dialog#keyboard) and
  [Layering: Modal scope](/concepts/layering#modal-scope).

- **A `Window` disposed while shown leaves the layer tree.** `dispose()` on
  an open window, or on a `TabWindow`, tore the window down but left it
  registered with `LayerManager`, so `getTopLayer()` could go on naming a
  window whose element was gone and the manager's document listeners were
  never removed. Its destructor now unregisters it, as every other layer's
  does. A window closed first is unaffected. No consumer action is needed.

- **A modal `Dialog` is no longer drawn beneath — and left clickable under —
  another overlay.** A dialog opened while any layer was open inherited that
  layer's band. Opened from a window, it sat below pinned windows, popovers
  and toasts, with its backdrop tied with the window. Opened with a drawer
  open, its backdrop sat under or tied with the drawer, which then took clicks
  and focus. A dialog now always stacks in the Dialog band. No consumer action
  is needed.

- **A `Dialog` whose opener is disposed while it is open now closes cleanly
  and resolves `show()`.** On close, a dialog returns focus to the element
  that had it when the dialog opened. If that element had been disposed in
  the meantime — a button in a tab the dialog's own action closed, say — the
  restore threw `DOM handle <n> is not registered`, and the promise `show()`
  returned never resolved, so code after the `await`, a `finally` included,
  never ran. The dialog now skips the restore when that element is gone or
  no longer on the page, leaving focus on the page, and resolves `show()`
  even if restoring focus fails. No consumer action is needed.

- **`Dock` no longer emits `focus(null)` while a panel is still open.** When
  the focused panel closed and its region was left empty — the last tiled tab
  closing while a float stayed open, or a focused float closed with its
  chrome ✕ — the Dock reported that nothing was focused. A click into an
  already-active float did not correct it. Focus now moves to the active
  panel of the same float, then of the tiled tree, then of the frontmost
  float. `focus(null)` fires only once no panel remains anywhere. No consumer
  action is needed.

- **Rebuild-mode `Menu`s declare `role="menu"`.** Context menus, the
  `MenuButton` and `SplitButton` dropdowns and the `ToolBar` overflow menu
  rendered `menuitem` rows inside an element with no role. They now carry
  `role="menu"`, as persistent-mode menus already did. No consumer action is
  needed.

- **A context menu opened from the keyboard can be worked from the
  keyboard.** Shift+F10 or the ContextMenu key opened the menu, but the arrow
  keys, `Enter` and `Space` went on acting on the control that had focus: the
  caret moved, a line break was inserted, and no row could be reached. A
  `Menu.show()` that follows a key press now takes focus, highlights its
  first enabled row, and handles `ArrowDown` / `ArrowUp`, `Home` / `End`,
  `Enter` / `Space`, `ArrowRight` / `ArrowLeft` for submenus, `Tab` and
  `Escape`. When it closes, focus returns to where it was, before a closing
  row's `action` runs. A menu opened with the mouse, and the `SplitButton`
  and `MenuBar` dropdowns, behave as before. A table cell editor keeps its
  edit open while such a menu is up, and a date or time editor its picker.
  The menu names its highlighted row in `aria-activedescendant`, through the
  new `MenuRow.getActiveDescendantId()`. A modifier pressed by itself and a
  held key's auto-repeat do not count as a key press. See
  [Menu: Keyboard](/components/Menu#keyboard). No consumer action is needed,
  with two exceptions. Code that calls `show()` for a dropdown whose trigger
  should keep focus after a key press should call `toggleFor()` instead. A
  custom `CellEditor` that overrides `retainsFocus` should also return `true`
  when `super.retainsFocus(...)` does, or its edit ends when the menu opens.

- **An `initialFocus` component that is hidden or disabled no longer leaves a
  dialog without focus.** The dialog called `focus()` on it, the browser
  refused, and focus rested on `<body>` until the first `Tab`. A screen
  reader announces a dialog when focus enters it, so such a dialog was not
  announced at all. `initialFocus` now resolves to the component's first
  visible, enabled stop, and a component that offers none falls back to the
  default order. No consumer action is needed.

- **A window constructed minimized or maximized shows the restore glyph.** A
  `Window` built with `windowState: "minimized"` or `"maximized"` kept the
  minimize and maximize glyphs of the normal state on its header buttons,
  because the glyph was swapped only on a transition. The header now reflects
  the state the window starts in, and so do the button names: "Restore" on
  the matching button of a `Window` or a `TabWindow`. No consumer action is
  needed.

- **A `Popover` whose anchor is disposed closes without an error.** Closing
  the panel that held the anchor while the popover was open made the next
  window resize, a `setTitle`, `setBody` or other relayout, an outside press
  and the popover's own close throw `DOM handle … is not registered`. The
  popover now closes and fires `onClose`; `show()` with a disposed anchor
  warns and does nothing. `getAnchorElement()` now returns `null` for a
  disposed anchor instead of its released handle. No other consumer action
  is needed.

- **Disposing a component in the middle of a drag from it ends the drag.**
  The drag used to stay open for the life of the page: its ghost stayed on
  screen and no other drag could start. The drag is abandoned: its source
  hears neither `"dragend"` nor `onDragEnd`. A drop handler that disposes
  the source no longer throws. A drag is also no longer in progress
  (`DragManager.isDragging()` is `false`) by the time the source's
  `onDragEnd` runs; it used to end afterwards. No consumer action is
  needed.

- **A `Window` whose content is replaced keeps working.** Replacing the body
  during a maximise or restore animation threw and left the window unable to
  change state, and a replacement made at any time stayed visible when the
  window was minimized. No consumer action is needed.

- **A menu closed just after the pointer reached a submenu item no longer
  opens that submenu.** No consumer action is needed.

- **Dismissing a `Dialog` while a button's async `onClick` is pending no
  longer ends in an unhandled promise rejection, and no longer lets the late
  button result override the dismissal.** Pressing Escape during a slow guard
  used to resolve `show()` with the button's result instead of `"close"`. The
  same now holds for any button click during the 150 ms dismissal fade, guarded
  or not: the first dismissal wins, and `show()` resolves with its result. A
  second Escape, close or programmatic `hide()` still restarts the fade. No
  consumer action is needed.

- **A dropdown or menu whose trigger is disposed while it is open no longer
  breaks outside clicks.** Every later press or focus move outside it threw
  `DOM handle … is not registered`, and other open menus and dropdowns did
  not close on that press.
  This happened with a `Window`'s window menu after `clearGlyph()` on its
  header, and with any `Menu`, `PopupPanel` or other dropdown opened from a
  component the application disposed. The layer now stays open until the
  next outside press, Escape or window blur closes it as usual. No consumer
  action is needed.
