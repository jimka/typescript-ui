# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Changed

### Core

- **`FocusHistory.back()` / `forward()` now reveal a hidden trail entry before
  focusing it**, rather than silently failing to move focus onto an element
  the browser cannot currently see. Reveal selects the `Tab` a target lives
  in, expands a collapsed `Border` region / `Accordion` section / `Split`
  pane, and scrolls an `autoScroll` `Panel` — in each case only if needed. A
  trail entry that still cannot be brought into a focusable state after
  revealing is skipped rather than failing the whole navigation. Public
  signatures are unchanged; existing consumers see focus land where it
  previously could not.

### Layouts

- **`Tab.setTabItalic(content, italic)` is no longer view-only.** It now
  writes to the tab's `LayoutConstraints` the same way `setTabGlyph` does,
  so the flag survives a tear-off, a re-dock, or a restored layout.

## Added

### Components

- **`TabBar` gains `setEntryModified(id, modified)` / `isEntryModified(id)`**,
  and **`TabButton` gains `setModified(modified)` / `isModified()`** as the
  button-level mechanism they run through — a small filled dot trailing a
  tab's label, marking unsaved changes, that survives label truncation since
  it is a real content-row child rather than baked into the label text.

- **`CodeEditor` gains `revealRange(at, options?)`**, for jumping the editor to
  a range a host computed elsewhere — a search hit, a diagnostic, a stack
  frame. It selects the 1-based `{ line, column, length }` range, scrolls it
  into view, and paints an accent highlight over it that survives the editor
  not having focus, which a native selection does not. `options.focus: false`
  previews a location without stealing focus; `options.highlight: false`
  suppresses the highlight; `options.scrollAlign` (`"nearest"` by default, or
  `"center"`/`"start"`/`"end"`) chooses where the range lands in the viewport
  once scrolled into view, on both axes — `"center"` keeps surrounding
  context visible on every side, useful when the reveal comes from a results
  list rather than in-place navigation. The target is clamped against the
  live document, so a stale position lands at the nearest valid range
  instead of throwing. The
  new types `CodeEditorRevealTarget` and `CodeEditorRevealOptions` are exported
  from `component/editor`. No consumer action is needed.

- **`CodeEditor` gains `getSelection()` and a `"selectionchange"` event**,
  for building a "12 characters, 2 lines selected" status-bar readout.
  `getSelection()` returns the primary selection's
  `{ characterCount, lineCount }` — 0 characters across 1 line for a
  collapsed selection (a bare caret) — reading that same default before the
  editor mounts. `"selectionchange"` fires once per real change to either
  count, independently of `"cursorchange"`: selecting all text while the
  caret is already at the document's last position leaves the caret in
  place (no `"cursorchange"`) but still changes the selection's extent (a
  `"selectionchange"`). The payload type `CodeEditorSelection` is newly
  exported from `component/editor`. No consumer action is needed.

### Layouts

- **`Tab.setTabModified(content, modified)` / `isTabModified(content)`** show
  or hide a live tab's "unsaved changes" dot. The flag is written to the
  tab's `LayoutConstraints`, so it survives a tear-off, a re-dock, or a
  saved layout, and accepts a tab added but not yet laid out.

### Core

- **New `FocusReveal` broker**, exported from `core` alongside
  `FocusHistory`. Hiding containers (`Tab`, `Border`, `Accordion`, `Split`,
  and the scroll `Panel`) register as `FocusRevealer`s; `FocusReveal.reveal(target)`
  invokes every registered revealer containing `target`, outermost-first, so
  a hidden descendant can be brought into a focusable state before something
  focuses it — the mechanism `FocusHistory.back()` / `forward()` now use (see
  Changed, below). Most consumers won't call this directly.

- **New `SpatialNavigation` service**, exported from `core` alongside
  `FocusHistory` and `FocusReveal`. `SpatialNavigation.enable()` arms two
  chords that rank every candidate element's rectangle against the focused
  element's and jump to the nearest one in the pressed direction:
  `Ctrl+Alt` + arrow moves to the nearest individual focusable element, and
  `Ctrl+Shift` + arrow moves to the nearest container marked via
  `Component.setNavigationTarget`, landing on that container's remembered —
  or first — focusable descendant. A collapsed or scrolled-away destination
  is brought into view via `FocusReveal` before focus lands. The service
  stands down while a transient overlay (a dropdown, a dialog) is active,
  via the new `LayerManager.hasActiveInputLayer()`; any new arrow-key
  handler must guard itself with `SpatialNavigation.claimsKey(e)` so the two
  never act on the same keypress. A held chord's OS-generated key-repeat is
  claimed but never moves focus past the one step its initial keydown took,
  so a slightly longer press can't silently skip past a candidate. Ranking
  tolerates a sub-pixel negative gap between two visually-adjacent elements —
  `getBoundingClientRect()` can round two flush flex siblings' shared edge to
  either side of `0` — so a genuinely adjacent candidate is never dropped for
  landing a thousandth of a pixel "behind" the origin. Ranking also always
  prefers a candidate sharing the origin's own row or column over one that
  doesn't, however close the latter scores — otherwise a widget with a wide
  gap to its true neighbour (a `Slider` past a text label, say) could jump to
  an unrelated, merely-nearby element in a different row instead, such as a
  tab strip sitting just above it. When one marked container nests another,
  the coarse tier always lands on the outer one first when approaching from
  outside both — which then hands off to its own remembered descendant,
  drilling down through any further nesting the same way — rather than
  letting a nested container out-rank its own ancestor merely by sitting
  closer to the origin; a move already inside the nest still reaches the
  specific inner container directly. Opt-in — nothing calls `enable()`
  automatically.

- **`Component` gains `setNavigationTarget(value)` / `isNavigationTarget()`**
  and the matching `navigationTarget` construction option, marking a
  container as a target the `SpatialNavigation` coarse tier can land focus
  on. Mirrors the flag onto the element as `data-ts-ui-navigation-target`,
  present only while the flag is on. `ToolBar`, `MenuBar`, and `TabBar` are
  marked by default, since each is a self-contained chrome region a user
  would expect to jump straight into; nothing else is marked by default.

### Overlay

- **`Dock` gains four panel-id-keyed presentation setters**:
  `setPanelTitle(id, title)`, `setPanelGlyph(id, glyph)`,
  `setPanelItalic(id, italic)`, `setPanelModified(id, modified)`. Each is
  durable — surviving a tear-off, a re-dock, and a `setLayoutState`
  restore — and accepts a panel whose tab cell has not been created yet,
  returning `true` when the panel is registered and `false` for an unknown
  id.

- **`Dock` gains `setTabOptions(options)` / `DockOptions.tabOptions`**,
  applying a `TabOptions` presentation bag to every region the dock owns,
  now and later — including a region a drag-driven edge split creates.
  `reorderable`, `listeners`, and `tools` are dropped rather than
  forwarded, since `Dock` owns the first two as invariants and the third
  may carry a live component that can only ever have one parent.

- **`AbstractWindow` gains the vetoable `"beforeclose"` event** and a new
  `WindowCloseController` type. `requestClose()` fires it first; a listener
  calling `preventDefault()` on the controller aborts the close. The
  programmatic `onExitAction()` is not guarded by it.

- **`Dock` gains the `"beforeclose"` and `"dblclick"` events**.
  `"beforeclose"` fires for a tab's ✕ (tiled or floated) and a float
  window's chrome ✕, forwarding the same controller `Tab`/`AbstractWindow`
  handed it; `removePanel` stays the unguarded programmatic path.
  `"dblclick"` fires when a tab button is double-clicked, mirroring `Tab`'s
  own `"tabdblclick"`.

## Fixed

### Core

- **`SpatialNavigation.disable()` now empties its focus memory even when
  `enable()` was never called.** The memory (`_lastFocus`, which of a marked
  container's descendants to restore focus to) is populated by `move()`
  alone, independent of the keyboard listeners `enable()` attaches — but the
  clear was previously gated on the service having actually transitioned out
  of an enabled state, so a caller driving navigation purely through
  `move()` and never calling `enable()` could not reset that memory. No
  consumer action is needed.

- **`SpatialNavigation`'s component tier no longer escapes a scrolled
  container early.** A candidate scrolled far enough out of its own
  scrolling container's view can end up, in raw page coordinates, farther
  from the origin than some unrelated element positioned elsewhere on the
  page — e.g. a fixed tab strip near the page's top, once a same-container
  sibling has been scrolled up to that same coordinate. `Ctrl+Alt`+arrow
  could then jump straight to that unrelated element instead of continuing
  through the container's remaining (merely off-screen, not gone) content.
  A candidate inside the origin's nearest scrolling or hiding container —
  found via the same `FocusReveal` registry the reveal step already uses —
  now always ranks ahead of one outside it, however the two score against
  each other; a move still falls through to outside candidates once the
  container is genuinely exhausted. No consumer action is needed.

- **`SpatialNavigation` no longer ranks against `<body>`'s own rect when
  nothing is genuinely focused yet.** `document.activeElement` never
  actually reports `null` once the page has loaded — it defaults to
  `<body>` itself — so a move attempted before anything had been focused
  ranked every candidate against `<body>`'s own (essentially arbitrary)
  rectangle, landing on whatever came out on top rather than anywhere a
  user would expect. A move now lands on the first candidate in DOM order
  for a forward (south/east) direction, or the last for a backward
  (north/west) one, matching `FocusTraversal`'s own convention for a fresh
  Tab press. No consumer action is needed.

- **`SpatialNavigation`'s target tier no longer lands on a marked
  container's own focusable element ahead of its content.** A composite
  widget's container commonly carries its own `tabindex="0"` too — `ToolBar`,
  `MenuBar`, and `TabBar` all do, as the single roving-tabindex Tab stop such
  a widget conventionally exposes — so a coarse-tier move landed there
  directly, leaving none of the widget's own buttons reachable: every one of
  them sits geometrically inside that origin, not beside it in any compass
  direction, so a further `Ctrl+Alt`+arrow had nothing to move to either. A
  real focusable descendant, remembered or first, now always wins over the
  container's own element; the container itself still receives focus for a
  genuine leaf navigation target (a `TextArea` marked as its own target,
  say) that has no descendant at all. No consumer action is needed.

- **`SpatialNavigation`'s component tier no longer lands on a composite
  widget's own wrapping container ahead of its content.** The same
  `tabindex="0"` container `ToolBar`/`MenuBar`/`TabBar` expose was an
  ordinary peer candidate for `Ctrl+Alt`+arrow too, and a border or inset
  pixel could let it out-rank its own buttons on raw geometry — stranding
  the move on the container, with none of its content reachable (every
  button sits inside that origin, never beside it in any compass
  direction). A real focusable descendant always wins now. No consumer
  action is needed.

- **`SpatialNavigation`'s component tier no longer lands on a candidate a
  collapsed ancestor is currently clipping to nothing.** A height-animated
  collapsible region (an `Accordion` section, a `Border` region, a `Split`
  pane) keeps its content at its ordinary, unclipped layout size while
  collapsed, so the content's own rect reports exactly where it would sit
  if the region were open — deceptively close to whatever genuinely
  visible content follows it. `Ctrl+Alt`+arrow could land there directly,
  silently expanding the region and jumping into it instead of the nearer,
  already-visible neighbour a user would expect. A sibling merely scrolled
  out of an ordinary, non-zero-sized scrolling container's view is
  unaffected. No consumer action is needed.

- **`SpatialNavigation` no longer treats a merely-touching, non-overlapping
  row or column as sharing the origin's perpendicular band.** Ranking
  measured "does the candidate share the origin's row/column" the same way
  it measured the raw perpendicular gap — `0` for both a genuine overlap and
  two spans that simply touch at a shared edge, e.g. a fixed chrome row
  flush against the content below it. A candidate in that touching row could
  then out-rank the origin's true same-row neighbour on raw score alone,
  once the neighbour sat far enough along the row. Sharing a band now
  requires an actual positive-width overlap; a touching-only neighbour ranks
  by score like any other off-band candidate. No consumer action is needed.

- **`SpatialNavigation`'s component tier now reaches a `RovingTabIndex`
  member roved to `tabindex="-1"`**, instead of treating every member but the
  group's own active one as invisible. A `ToolBar` (or `ButtonGroup`, or a
  `RadioButton` group, …) roves every member but one to `tabindex="-1"`, and
  a non-native-tag member — a `ComboBox`, say — has nothing else to make it
  match `FOCUSABLE_SELECTOR`, so `Ctrl+Alt`+arrow could only ever reach
  whichever member currently held the group's own Tab stop, skipping every
  other one entirely. `RovingTabIndex` now marks every member it manages,
  active or not, and this tier includes that marked set alongside the
  ordinary focusable one. No consumer action is needed.

- **`SpatialNavigation`'s component tier no longer drops a native-tag
  candidate for containing another candidate.** A composite widget's
  wrapping container losing to its own content this way is correct — see the
  fix above this one — but a `TabButton` is not a passive wrapper: it is a
  real, independently meaningful `<button>` in its own right, and its
  overlaid `TabCloseButton` (raw-appended, not enrolled in a layout, so it is
  a genuine DOM child) is a second, separately meaningful one. Treating the
  same containment rule as disqualifying here left every closeable tab
  reachable only by its close button, skipping the tab itself entirely. A
  native-tag candidate (`<button>`, `<input>`, `<select>`, `<textarea>`,
  `<a>`) is now always kept regardless of what it contains; the rule still
  applies to a non-native-tag container. No consumer action is needed.

- **`SpatialNavigation`'s component tier no longer scatters a `Table` into
  one stop per incidentally-tabbable cell.** A boolean column's
  always-visible `Checkbox` cell renderer sets its own `tabindex="0"` for
  standalone use, same as `Table`'s `<tbody>` does for its own single
  grid-pattern Tab stop — but unlike a `ToolBar`/`MenuBar`/`TabBar` button, it
  is enrolled in no `RovingTabIndex` group and renders as no native tag, so
  the existing "content wins over its container" rule let every such cell
  out-rank the table's own stop, leaving `Ctrl+Alt`+arrow landing on scattered
  cells instead of the table — or skipping the table entirely when none of
  its cells happened to rank as nearest. A candidate that is neither a
  native-tag element nor a `RovingTabIndex` member now always loses to
  whichever other candidate contains it, instead of always winning. No
  consumer action is needed.

- **`SpatialNavigation` and `FocusTraversal` no longer crash with
  `hasAttribute is not a function` for an element inside a `Window`,
  `Dialog`, `Menu`, or any other `LayerManager`-registered overlay.** Both
  services walk an element's ancestors looking for a marked container,
  bounded at `<body>` on the assumption that every framework component tree
  lives under it — but a portaled overlay's root is appended directly onto
  `documentElement`, bypassing `<body>` entirely, so the walk ran past
  `<html>` into the `document` node itself, which has no `hasAttribute`. Both
  walks are now bounded at `documentElement` instead, which every element's
  ancestry reaches regardless of which of the two it is mounted under. No
  consumer action is needed.

- **`SpatialNavigation` no longer drops or misranks a `Grid` cell's oversized
  child that `Component.setClipFrame` clips.** The clipped child keeps its
  full, unclipped natural size and is parked at its clip frame's origin, so
  its own rect can spill deep into a neighbouring cell — enough to put a
  genuinely-adjacent candidate "behind" it on raw geometry (or, from the
  other direction, drop the clipped child itself from ranking entirely).
  Both the moving element's own rect and every candidate's rect are now
  intersected with any `setClipFrame` ancestor's rect before ranking, so
  geometry reflects what is actually visible rather than the unclipped box.
  An ordinary scrolling container is unaffected — only a `setClipFrame`
  frame's rect is ever intersected in. No consumer action is needed.

- **`SpatialNavigation`'s component tier no longer risks crashing with
  `getComputedStyle` is not a function while checking for a collapsed
  ancestor.** Its search root is the topmost registered `LayerManager` layer,
  which is not guaranteed to be an ancestor of every candidate — e.g. one
  living in some other, currently non-topmost layer — so the ancestor walk
  could run past `documentElement` into the `document` node itself, on which
  `getComputedStyle` throws. Bounded at `documentElement` too now, matching
  the `recordOrigin`/`findTabKeyOwner` fix above. No consumer action is
  needed.

### Components

- **`Button`, `ComboBox`, `Checkbox`, `Toggle`, `RadioButton`, and `Slider`
  now show a themed focus ring when keyboard focus lands on them**, instead
  of `Button`/`ComboBox` falling back to the browser's raw 1px black default
  outline and `Checkbox`/`Toggle`/`RadioButton`/`Slider` showing nothing at
  all (each unconditionally suppressed its own outline with no replacement).
  All six now register the same `:focus-visible` ring `Link` already had;
  `Checkbox`, `Toggle`, and `RadioButton` additionally paint a
  themed-background separator between the ring and their own checked-state
  fill, which otherwise shares the ring's accent blue closely enough to
  blend into it. Separately, `SpatialNavigation` now also mirrors a
  `data-ts-ui-focus-visible` marker onto whatever element it focuses, matched
  by that same ring rule alongside the pseudo-class: Chromium's native
  `:focus-visible` heuristic does not treat a keydown with `ctrlKey` /
  `altKey` held as keyboard-navigation-worthy, even though the resulting
  `.focus()` call is a real, synchronous, trusted result of that keydown —
  exactly the shape of both of `SpatialNavigation`'s own chords — so without
  the marker, a `Ctrl+Alt` / `Ctrl+Shift`+arrow move would silently show no
  ring on any control at all, native `outline` or not. No consumer action is
  needed.

- **A `ToolBar` no longer sweeps a non-interactive child, such as a `Text`
  caption placed next to a control, into its roving-tabindex group.**
  Membership was decided by "hasn't opted out with `tabindex="-1"`" — which a
  decorative child never does, since it never touches `tabindex` at all —
  rather than by "has declared itself interactive." A caption added before
  its control (the common label-then-control toolbar layout) could then
  become the group's first, and only ever, active member, permanently
  roving every real control off to `tabindex="-1"` and leaving the bar's own
  Arrow-key navigation, and Tab, reaching nothing but the caption. `Button`
  now declares its own `tabindex="0"` explicitly, matching the convention
  `ComboBox`/`Checkbox`/`RadioButton`/etc. already followed, and `ToolBar`
  now requires that explicit declaration for roving-group membership instead
  of merely the absence of an opt-out. No consumer action is needed.

- **A `TabBar`'s own ArrowLeft / ArrowRight tab navigation no longer skips
  tabs after a `SpatialNavigation`-driven move landed keyboard focus on one
  without activating it.** It previously always stepped from the *active*
  tab, which normally tracks focus exactly — until `SpatialNavigation` moves
  focus onto a different tab with a direct `.focus()` call that bypasses
  activation entirely. A subsequent bare arrow press then stepped from the
  stale active tab instead of the one visibly focused, jumping to a
  seemingly unrelated tab. It now steps from whichever tab currently holds
  DOM focus, falling back to the active tab only when focus is outside the
  strip. No consumer action is needed.

- **A `SpatialNavigation`-driven move onto a `TabBar` tab clipped outside its
  scrolled tab strip now scrolls the strip to bring it into view**, instead
  of leaving keyboard focus on an invisible tab and then, on the next press,
  jumping to whatever unrelated element happened to be nearest — since a
  clipped tab is fully valid but invisible, not gone. `ScrollStrip`'s own
  `overflow: hidden` clip is set directly rather than through `Panel`'s
  `autoScroll` option, so it never went through the registration that would
  otherwise make it a `FocusReveal` revealer; it now registers explicitly and
  reuses its existing `revealItem` scrolling logic to do so. No consumer
  action is needed.

- **Expanding or collapsing a `Tree` node no longer rebuilds every visible
  row's toggle caret, nor repositions every visible row, when most of what's
  on screen hasn't actually changed.** Internally, `TreeRow.setRowData` tore
  down and reconstructed the expand/collapse caret `Glyph` on every bind of
  a row with children, even when the row's `hasChildren`/`expanded`/
  `loading` triple was unchanged, and `Tree`'s reflatten path unconditionally
  marked every pooled row unbound before every expand/collapse/lazy-load
  transition. A row is now rebound only when what it was last bound to has
  actually changed, so collapsing or re-expanding a folder costs work
  proportional to the rows that actually changed rather than to how many
  other expandable rows happen to be visible. `setNodes` and
  `setRendererFactory` still force a full rebind of every visible row, since
  either can hand a row genuinely different content behind an unchanged
  node/state — a caller mutating a node's fields in place before calling
  `setNodes` again, or a fresh renderer with no cached content to compare
  against. No consumer action is needed.

- **Expanding or collapsing a `Tree` node deep in a scrolled, densely
  expanded tree no longer rebinds most of the visible rows.** A pool slot was
  assigned by flat position, so inserting or removing a run of rows shifted
  every row below the change point into a different slot than the one
  already correctly showing it, forcing a rebind and — for an expandable row
  — a toggle-caret rebuild, even though the row's own content never changed.
  A render pass now re-matches each pool slot to the node it was already
  showing, by identity, before deciding which slots to rebind, so a node
  that stays on screen keeps its slot, its DOM element, and its caret across
  an unrelated toggle and pays only a reposition. No consumer action is
  needed.

### Layouts

- **`Tab.setTabGlyph(content, glyph)` / `clearTabGlyph(content)` no longer
  silently drop a write made before the tab's strip cell exists.** Both used
  to return `false` and write nothing for a tab added moments ago but not yet
  laid out; they now record the write durably and return `true`, applying it
  once the cell is created.

### Overlay

- **A `Window`'s header ✕ now goes through the same close path as
  `TabWindow`'s close tool**, so it can be vetoed via `AbstractWindow`'s new
  `"beforeclose"` event. Previously it called the unguarded
  `onExitAction()` directly, bypassing `requestClose()` entirely.

- **A `setLayoutState` restore no longer permanently drops a tiled root
  region's tab wiring.** Previously, closing a tab in the dock's original
  group after a restore did not fire `"beforeclose"`/`"close"`, and
  `setTabOptions`/`DockOptions.tabOptions` stopped reaching that region,
  because the restore rebuilds the root's `Tab` in place and the sweep's
  idempotency guard mistook the unchanged container for an already-wired
  one. No consumer action is needed.
