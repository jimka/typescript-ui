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

### Overlay

- **A non-modal `Drawer` now stacks below windows, and a modal one in the
  Dialog band.** A non-modal drawer used to take the Dropdown band (10000),
  above every window and popover. It now takes the new `Band.Drawer` (8950),
  above the `Rail` and below windows. A modal drawer takes `Band.Dialog`, so
  its scrim now also covers toasts. In-page drag outlines moved from
  `Band.Window - 1` to `Band.Drawer - 1`, which keeps them under an open
  drawer as before. No consumer action is needed unless an app relied on a
  non-modal drawer covering a window.

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

### Core

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

### Data

- **`JsonWriter.dataFor` is `protected`.** A subclass can override it to
  change which fields are written — to drop server-generated columns, say —
  and keep `'dirty'` mode and the per-type `Date` forms, instead of
  re-implementing the `Writer` interface.

### Layouts

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
  rebuild-mode show starts with no row highlighted. No consumer action is
  needed.

## Fixed

### Components

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
