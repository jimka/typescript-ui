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

## Fixed

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
