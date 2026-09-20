# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Components

- **`Slider`'s `showTicks` option and its `isShowTicks()` / `setShowTicks()`
  accessors are removed.** Nothing ever rendered tick marks: the option was
  stored, read back by its own getter, and used nowhere else. Drop the option
  and the two calls — there is no replacement. See
  [Migration](/reference/migration/next) for the full note.

- **`WindowBorder.setDirection()` is removed.** It had no callers, and it
  could not be made correct where it stood: it rewrote the direction without
  re-applying the hover cursor, which the strip writes once at construction
  and shares with the drag cursor so the two can never disagree. A strip's
  direction is now what it always effectively was — fixed at construction,
  read back through `getDirection()`. See
  [Migration](/reference/migration/next) for the full note.

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

- **Nineteen setters across `Component`, `Button`, `Text`, `Aria` and
  `RovingTabIndex` now return early when handed the value they already
  hold.** The early return skips the setter's side effects, not merely its
  assignment — the style write, the cache invalidation, the attribute write,
  the scheduled layout pass. Every one of them leaves the same observable end
  state as before, so nothing a consumer wrote stops compiling or stops
  working, with two exceptions worth naming. A caller that used
  `setSize(currentSize)` to force a relayout must now use `invalidateLayout()`
  or `flushLayout()`, because an unchanged box no longer schedules a pass; and
  `RovingTabIndex.moveTo(activeIndex)` no longer re-focuses the member that is
  already active and already tabbable, so activating the selected tab leaves
  focus and scroll exactly where they were.

- **`Button.clearDescription()` now destroys the subtitle label it removes**,
  the way `clearGlyph()` already destroys the glyph. It previously detached
  the label and left it holding its element, its per-instance stylesheet rule
  and its theme subscription for the lifetime of the process. A caller holding
  a reference from an earlier `getDescription()` must not reuse it across a
  `clearDescription()` call.

- **The DOM seam now skips an inline-style or stylesheet-rule write whose
  value already matches the declaration it would change**, and skips the
  whole-rule-body assignment when a batched rule flush merges to the text the
  rule already carries. A removal of a *shorthand* is never skipped — only a
  non-empty read can authorise that, because a shorthand reads back empty
  while its longhands are only partly set. A redundant clear of a box-geometry
  **longhand** (`width`, `height`, the `min-`/`max-` pairs, the four insets)
  *is* skipped, because a longhand reports its own value however it was set,
  so an empty read proves absence. That case carries the measured win: two
  such writes per frame — one on a rule, one inline — were forcing
  full-document restyles worth **46% of the frame** on a 2387-element editor
  grid, which a same-session A/B took from 107.4 to 59.9 ms/frame. The comparison is made against the live
  declaration being written, so no cache can drift out of step with an inline
  `style` wipe or with two `StyleRule` instances sharing one underlying rule. There is
  no consumer-facing consequence: the resulting declaration is identical
  either way, and no signature moves — what changes is how much restyle work
  the engine is handed per frame.

- **`setInsets()` / `clearInsets()`, `setLayoutManager()` and
  `sortComponents()` now mark the component's layout as owed** —
  `isLayoutDirty()` reports `true` afterwards — **and
  `LayoutManager.setLayoutConstraints()` marks its container's**, so an
  unchanged re-commit can never withhold the pass that applies the change. A
  same-value inset write still returns early and marks nothing.
  `invalidateLayout()` now also marks every ancestor that opted into skipping
  an unchanged commit, so a pass owed beneath such an ancestor is not withheld
  by its skip.

- **`Component.setTranslate()` and `Text.setLineHeight()` now ignore a
  non-finite number instead of writing an invalid declaration**, joining
  `DiagramView.setZoom()` in refusing rather than clamping — a `NaN` cannot be
  resolved by a clamp, and coercing it to 0 would cancel a translate the
  element really carries. Both leave the cache and the element exactly as the
  last good call left them. For `setTranslate()` that removes a write the
  browser already discarded and nothing else. For `setLineHeight()` — and for
  `ComboBoxLabel.setLineHeight()`, which gained the same guard — it is an
  observable improvement: the numeric form paints through a shared class rule
  keyed on the value, so a non-finite number used to swap the control off its
  real `line-height` class onto a `NaN`-keyed one whose declaration the browser
  then dropped, silently reverting the control to the theme line box while
  `getLineHeight()` reported `NaN`. It now keeps, and reports, the last real
  value. Anything that was passing a computed `NaN` and relying on that revert
  must ask for the value it wants instead — `centerInHeight(null)` on a `Text`
  returns it to the theme's additive line box. Separately, `getSize()`,
  `getWidth()` and `getHeight()` are now documented as reporting `NaN` before
  the first commit rather than `0` or `null`, and
  `getX()` / `getY()` as reporting it before anything positions the
  component — a documentation correction to what these accessors always did,
  not a behaviour change, but one worth checking your own null guards against.

### Components

- **`MenuBar` and `ToolBar` are no longer re-laid-out when their parent
  re-commits them at the rectangle they already hold.**
  `LayoutManager.commitBounds`, which the box, flow, grid, border, fit, card,
  anchor and absolute managers commit a child through, now withholds the
  child's layout pass when the commit moved nothing, the child's class opted
  in, and no pass is owed — the gate the table's cells already had through
  `applyBounds`, still off by default. These two bars are its first
  opt-ins. `ToolBar.setOrientation()` and `setFlat()` now lay the bar out
  themselves, as `setCompact()` already did. A consumer that changes a bar's
  layout through a path that announces nothing — a child's `setDisplayed`,
  the manager reached through `getLayoutManager()`, the bar's own padding or
  border, or a custom child's intrinsic size changed without
  `setPreferredSize` / `notifyIntrinsicSizeChanged` — must now follow it with
  `bar.scheduleLayout()`: such changes used to take effect on the next
  incidental relayout, which no longer reaches a bar whose rectangle holds
  still.

- **`CellEditorPool.release()` now takes the cell that is releasing the
  editor** — `release(cell: Cell<any>)`, where it previously took no
  argument. The pool ignores a caller that is no longer the cell holding the
  shared editor, so a release arriving after another cell has taken the
  editor over can no longer unhook the cell that owns it now. The library's
  own single call site, in `Cell`, passes `this`; a consumer calling
  `release()` directly must pass the releasing cell.

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

- **`Tree` gains `insertNode`, `removeNode`, `setChildren` and
  `notifyNodeChanged`**, for changing a tree one node at a time without
  `setNodes`' reset. Every node the tree still holds keeps its expansion,
  loaded children and selection, and the scroll offset stays put; a caller
  keeps a node by passing the same object again. Removed nodes drop their
  state silently — no `"selection"` or `"collapse"` fires — and a load in
  flight for one stays dropped even if the node is inserted again. An
  `insertNode`, `removeNode` or `setChildren` on a lazy node's children
  counts as loading it and drops a load already in flight, including one
  `revealByPredicate` started. A `revealByPredicate` still running follows
  these calls: it finds a matching node added meanwhile, and never returns,
  expands or caches children for a node the tree no longer holds. Only rows
  whose content changed are rebound, and `notifyNodeChanged(node)` repaints
  just the row showing a node changed in place. No consumer action is needed.

### Layouts

- **`Tab.setTabModified(content, modified)` / `isTabModified(content)`** show
  or hide a live tab's "unsaved changes" dot. The flag is written to the
  tab's `LayoutConstraints`, so it survives a tear-off, a re-dock, or a
  saved layout, and accepts a tab added but not yet laid out.

- **`LayoutManager` gains `componentRemoved(component)`**, the counterpart to
  the existing `addDeferredComponent` seam: the container calls it once a
  child has left its child list, so a manager holding per-child state can drop
  it. It is an invalidation, not a departure — removing a child is also the
  primitive `moveComponent` and `replaceComponent` are built on, so an
  override forgets its parked state and lets the next layout pass re-derive
  what follows, rather than writing to a child list that is not settled yet.
  The base implementation does nothing, so an existing custom manager needs no
  change; `Card` is the one built-in manager that implements it (see Fixed,
  below).

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

- **`Diagnostics` gains a cumulative `layoutErrors` counter** and the
  `noteLayoutError()` that pushes it, counting the throws the batched layout
  flush isolated (see Fixed, below). `DiagnosticsSampler` carries it through
  to every sample, and the shipped diagnostics overlay shows it as a **Layout
  errors** row directly under **Layout flush**. Anything above `0` is a bug
  worth chasing: the component the console error names kept its old geometry
  for that frame.

- **`Component` gains `onSizeChange(listener)` / `offSizeChange(listener)`**,
  fired whenever a component commits a new width or height. It is the second
  custom event to live directly on the base class, alongside the existing
  `onDirtyChange` pair, and takes the same dedicated-`onX`/`offX` shape for the
  same reason: a base-class `on`/`emit` overload is unreachable on a subclass
  that declares its own. The event fires once per axis that actually changes,
  so a laid-out resize — which commits the two axes separately — delivers one
  call per changed axis and a listener must be safe to run twice; a move fires
  nothing. `ProgressSpinner.showOverlay` is the first consumer: an overlay now
  follows its target's size through this relay rather than re-arming a layout
  pass every animation frame for as long as it is shown. No consumer action is
  needed.

- **`Component` gains `getClipPath()`**, returning the CSS `clip-path` last
  passed to `setClipPath()` — `null` before any call, and again after
  `setClipPath(null)`. `setClipPath` now caches what it wrote, the way
  `setTransform` and `setContain` already did, so it can skip a repeat of the
  value it is already showing; the getter is what makes that cache readable
  instead of write-only.

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

- **A scrolling `Panel` and a virtual list (`Tree`, a table body) no longer
  re-blur a viewport-sized shadow on every frame they repaint or resize.**
  The position-aware scroll-edge cue was one overlay element carrying four
  blurred inset `box-shadow` layers the size of the whole scroll viewport, so
  the browser re-blurred each lit layer across that whole box on every
  repaint. The cue now paints on four thin, edge-pinned strips inside that
  same overlay — one per edge, each carrying a single shadow layer — so the
  blurred area drops from four viewport-sized boxes to four 12px bands.
  Visually identical; no consumer action is needed.

- **One throwing component no longer takes down the rest of a layout frame.**
  The batched flush dequeues both the dirty-component set and the frame's
  post-layout callbacks before it starts, so a single `doLayout()` throw
  dropped every component still queued behind it *and* the whole callback
  queue — one-shot consumer work ("focus this once it is laid out", "measure
  the revealed panel") that nothing retried and nothing reported as lost. Each
  entry now runs in its own `try`/`catch`: the failing one keeps the geometry
  it already had, every other one lays out normally, and the failure is
  reported through `console.error` with the original error passed on plus the
  new `layoutErrors` counter (see Added, above). The synchronous
  `Component.flushLayout` escape hatch is deliberately not wrapped — it serves
  one direct caller, and that caller is entitled to the exception. No consumer
  action is needed.

- **A roved-off member of a roving-tabindex group is no longer a Tab stop.**
  The framework-wide focusable selector carried its `:not([tabindex="-1"])`
  guard on its trailing `[tabindex]` branch alone, so an element that renders
  as a native `<button>`, `<input>`, `<select>` or `<textarea>` kept matching
  its own branch whatever `tabindex` it held. Every member a `RovingTabIndex`
  group had deliberately roved out of the tab order stayed reachable by Tab —
  a `ToolBar`, a tab strip, or a `ButtonGroup` offered one stop per item
  instead of one for the whole group, and a `Dialog`'s focus trap cycled
  through those items too. The guard now binds to every branch, so each such
  group contributes exactly its active member; Arrow-key navigation within a
  group and `SpatialNavigation`'s reach into its roved-off members are both
  unchanged. One further consequence is worth knowing: a `Tab` layout writes
  `tabindex="-1"` onto every tab's content component, so a leaf component used
  directly as tab content that renders as a bare native control — a
  `TextArea`, say — is no longer a tab stop of its own. That is what a
  browser's own traversal already did with `tabindex="-1"`, so the change
  removes a divergence rather than creating one.

- **An element marked `contenteditable` is now a Tab stop.** The same selector
  had no `[contenteditable]` branch, so a third-party editing surface —
  CodeMirror's `.cm-content` inside a `CodeEditor` or `MarkdownEditor` — was
  invisible to it even though a browser tabs into such an element natively.
  `Tab` stepped straight over the editor, and a `Dialog` containing one could
  neither focus nor trap on it. A `contenteditable` element that is not
  explicitly `contenteditable="false"` now counts as a stop. No consumer
  action is needed.

- **A decorative glyph icon is no longer a focus candidate.** The same
  selector matched any element carrying an `href`, and every `Glyph` renders
  as `<svg><use href="#…">` — so each glyph-bearing control contributed a
  second, unfocusable match right after itself. `Tab` under `FocusTraversal`
  could land on one, a `Dialog`'s focus trap cycled through them, and
  `Dialog`'s primary-button lookup — which resolves the configured primary
  button by its position among the button row's focusable elements — picked
  the wrong element whenever a dialog's buttons carried glyphs. The branch is
  now `a[href], area[href]`. No consumer action is needed.

- **Importing the library no longer touches the DOM**, so every entry point
  except `core` loads without one (a Vitest `node` suite, a build-time
  script). Twelve controls' focus rings and 13 modules' shared rules and
  `@keyframes` used to be written the moment their module was evaluated. As a
  result, `import { registerLanguage } from '@jimka/typescript-ui/component/editor'`
  threw `ReferenceError: document is not defined`. Those writes now wait for
  the library's first stylesheet write (normally the first render) and run
  just ahead of it, so every rule keeps its position within the library's
  stylesheet. That stylesheet's own `<style>` element is now added to `<head>`
  at that first write rather than at import, so an app that adds a `<style>`
  of its own in between — importing a non-`core` entry point, then its own
  CSS, then rendering — now has the library's sheet after its own, and rules
  of equal specificity resolve the other way. Apps that import `core` up front
  (as the create-app template does) and production builds that link their CSS
  statically are unaffected. `core` still creates the page's `Body` when it
  loads. No consumer action is needed.

- **`Animation.play` now removes the two transition listeners it registers.**
  Each call armed a `transitionend` and a `transitionstart` listener on the
  element it animates and removed neither, so an element that outlives its
  animations — a menu that fades on every show, a dialog that re-enters —
  collected another pair every time. Both of the animation's exits now take
  them away again. One documented promise narrows with it: cancelling the
  returned handle now reaches the element, where it previously touched
  nothing at all. That stays safe because the framework cancels every
  transition running against an element's handle before releasing it, so a
  cancel that can still reach the DOM always runs while the handle is live.
  No consumer action is needed.

- **A child no layout manager ever positioned no longer re-writes
  `transform: translate3d(NaNpx,NaNpx,0)` on every layout pass, nor sits
  permanently promoted to its own compositor layer.** Such a child — every
  `ComboBox` caret glyph, among others — still reported the "never assigned"
  sentinel from `getX()` / `getY()`, which made `commitBounds`' size-stable
  fast path believe it had moved on every settled pass; the resulting
  `will-change: transform` was taken and never released, and each pass also
  re-dirtied the nearest ancestor that had opted into skipping an unchanged
  commit. The fast path now requires a real current position, so these
  children take the slow path and stay at the static position they already
  rendered at. In the same family, a `Markdown` whose width is assigned before
  any height was ever committed no longer writes `height: NaNpx` when
  restoring its content-height probe; the box stays at `height: auto` until
  the pass's own `setHeight` lands. No write the browser was honouring is
  removed — every suppressed declaration was one it already discarded. One
  case does move, in the direction of correctness: a child that had been sized
  but never positioned, then handed a real target by its manager, used to take
  the fast path and so received only the discarded `NaN` transform, leaving it
  at its static position indefinitely with `getX()` / `getY()` never assigned.
  It now takes the slow path and is placed where its manager asked. Anything
  that looked right because such a child stayed put was relying on that bug.

- **A component destroyed part-way through a pointer drag no longer leaves the
  page unclickable.** A drag against the viewport — a `SplitGutter`, a
  `WindowBorder`, a `Scrollbar` thumb, a `HeaderCell`'s column-resize edge —
  suppresses pointer events on every direct child of `<html>` and pins the
  drag cursor there for the duration, and only the drag's own release listener
  took that back off. Destroying the dragging component removed that listener,
  so the release was heard by nobody and the suppression plus the frozen
  cursor survived for the life of the page, with nothing left on the page that
  a click could reach to undo it — closing a window while pressing its resize
  border was enough to trigger it. Teardown now ends whatever drag the
  component had armed. The component's own drag-stop callback is deliberately
  not run: clearing the document element is the whole repair, and running the
  callback would report a gesture as committed because the component was
  destroyed. No consumer action is needed.

### Components

- **Two `Markdown` previews of documents that share a heading name no longer
  break each other's outline.** Heading ids are unique within one render but
  land in the one document-wide id space, and heading tracking resolved them
  with a document-wide lookup; in the second preview every heading resolved to
  the first preview's element and was discarded, so that preview's minimap
  never highlighted and its rows did not respond to clicks. Both readers now
  resolve a heading inside the scrolling pane they were given. Rendered ids,
  `extractMarkdownHeadings` and `#fragment` links are unchanged; no consumer
  action is needed.

- **A theme change while a `Markdown` is on a hidden page no longer leaves it
  reporting a height of zero.** The content-height measurement ran against a
  `display:none` element, where every geometry read reports zero, and nothing
  re-measured on the way back: a re-show changes no width, which is the only
  thing that previously triggered a re-measure. The measurement is now skipped
  while the component is not effectively visible and re-run once it becomes
  visible again, so the last good height stands in the meantime. The same
  recovery covers a `setMarkdown` that lands while hidden. No consumer action
  is needed.

- **A table no longer writes an in-progress cell edit onto the wrong record
  when scrolling rebinds the row under it.** The body keeps a small pool of
  row components and rebinds them to new records as the user scrolls; an
  editor left open over one of those slots survived the rebind, so the next
  blur or Enter saved the typed text onto whichever record the slot had moved
  on to and left the record the user actually edited untouched. The body now
  commits an open edit before rebinding its row, onto the record the edit was
  opened against — the same rule it already applied when a column scrolled
  out of view. As with that existing column-axis commit, a scroll ends the
  edit rather than carrying the editor along; keyboard focus is not restored
  afterwards. No consumer action is needed.

- **`CellEditorPool` now commits the cell holding the shared editor before
  anything takes that editor away, and disposes a cached editor it drops.**
  A second cell could acquire the editor while the first still believed it
  was editing, leaving that cell's typed text to be written by whatever the
  editor did next. Separately, `register` dropped a cached editor without
  disposing it — reachable from a user gesture, since `Table.setDisplayMode`
  re-registers every combo column's factory, leaking one `ComboEditor` with
  its combo box, dropdown, theme subscription and per-instance style rules
  per combo column per toggle. No consumer action is needed beyond the
  `release` signature change noted under *Changed* above.

- **A store-backed `AutoCompleteField` no longer clears the application's
  filters or fires store events while the user types.** Each debounced
  keystroke used to call `clearFilter()` then `filterBy()` on the configured
  store, wiping any filter the application had installed and firing
  `filterchange`/`datachange` on every keystroke, so any other `List` /
  `Table` / chart bound to the same store rebuilt twice per keystroke.
  Suggestions are now matched in-process against the store's full record
  set, and the store itself is never written to. One visible side effect:
  suggestions now list in the store's load order rather than its active
  sort order, and a query with more matches than `maxSuggestions` may
  therefore surface a different subset than before. No other consumer
  action is needed.

- **An `AutoCompleteField` disposed while the user is typing, or just after
  the field loses focus, no longer throws.** Its debounce and blur timers
  used the bare global `setTimeout` and were never cleared on disposal, so a
  closed dialog or torn-down form could fire a callback against a dropdown
  whose DOM handles had already been released. Both timers are now cancelled
  in `destructor`. No consumer action is needed.

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

- **Dragging a `Split` gutter over a `TabBar`'s overflowing tab strip no
  longer forces a synchronous layout flush on every animation frame of the
  drag.** `ScrollStrip`'s post-layout arrow-enablement read (which resyncs
  the clip's scroll-offset cache on the way) forces the browser to compute
  layout immediately rather than deferring it to the next paint — a profiled
  gutter drag over an editor pane's tab strip spent 43% of its sampled CPU
  there, once per frame. The first extent change of a drag still reads
  live, so a one-off resize (a sidebar toggle, a window resize, opening or
  closing a tab) is never delayed; only the second and later changes of a
  live drag now withhold the read, catching up in one pass on the first
  animation frame the width or height stops moving. `ScrollStrip.mainScroll()`
  now always resyncs its cache from the DOM before returning, so a reveal or
  a within-strip tab-reorder drag mid-drag is never served a stale scroll
  position. No consumer action is needed.

- **Resizing a `Tab` pane on the axis its strip does not scroll along — e.g.
  dragging the horizontal gutter between two rows of editor panes — no
  longer forces a synchronous layout per visible tab strip on every frame.**
  `ScrollStrip` now re-reads scroll geometry only when a layout pass could
  have moved the browser's scroll clamp (its clip's main-axis extent or the
  laid-out items' far edge changed), instead of on every pass the
  resize-burst detector did not recognise as a burst; a pass that changes
  nothing the clamp depends on reads nothing. `Aria`'s typed setters also
  skip a write whose value is unchanged, so a tab strip's per-pass
  `aria-selected` / `aria-hidden` refresh no longer rewrites attributes that
  already hold the value. One consumer-facing consequence: a call to
  `ScrollStrip.setMainScroll` made outside a layout pass should be followed
  by `refreshArrows()`, since a layout pass that changes nothing the clamp
  depends on no longer re-derives the arrows on its behalf (`revealItem` and
  `resetScroll` already do this themselves).

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

- **Dragging a `Split` gutter, resizing a `Dock` pane, or any other live
  external resize of a scrolling `Panel` no longer forces up to five
  synchronous layout flushes on every animation frame of the resize.**
  `resizeScrollShadowOverlay`'s edge-overlay resize, `measureScrollbarGutter`'s
  gutter measurement, and `updateScrollShadows`'s edge-strength recompute each
  force the browser to compute layout immediately rather than deferring it to
  the next paint, and under the default `scrollbarStyle: "overlay"` /
  `scrollShadows: true` configuration a single live `doLayout()` pass paid for
  five of them — worse than the single flush per pass `ScrollStrip`'s own
  equivalent fix addresses, since `Panel` is the base class nearly every
  scrollable component extends. The first size change of a resize still
  remeasures live, so a one-off resize (a sidebar toggle, a window resize, a
  `Dock` pane drop) is never delayed; only the second and later changes of a
  live resize now withhold all three together, catching up within a couple of
  animation frames of the width and height settling. The overlay scrollbar's
  own inner content viewport still tracks the panel's live size on every
  frame regardless, so content never visibly detaches from the panel's edge
  mid drag; the scrollbar gutter reservation, the overlay bar's own
  position and size, and the edge shadow all briefly lag a fast resize
  instead, catching up once it settles. No consumer action is needed.

- **A scrolling `Panel`'s post-layout scroll-metrics remeasure now reads
  live scrollbar/scroll-shadow geometry from the DOM at most twice per pass,
  down from up to five under the default `scrollbarStyle: "overlay"` (two,
  down from four, under `scrollbarStyle: "native"`).** `resizeScrollShadowOverlay`,
  `measureScrollbarGutter`, and `updateScrollShadows` each read a live
  `scrollWidth`/`scrollHeight`, and several of those reads restated data an
  earlier one in the same pass had already measured — a redundancy that cost
  a forced synchronous layout flush each time, on every live pass, not only
  during a resize burst. The remeasure is now a single read-then-apply pass
  (the new `Panel.remeasureScrollMetrics`, replacing the retired
  `measureScrollbarGutter`) that resolves the same gutter, overlay size, and
  shadow-edge values from one measurement instead of several. No consumer
  action is needed.

- **Dragging a `Split` gutter that resizes a pane holding a `Tree` no longer
  re-lays out every visible row's children on every animation frame of the
  drag.** A live resize changes the row width on each frame, which made
  every row's cached geometry report "changed" every frame, and `Tree`
  answered that by calling `TreeRow.layoutChildren` once per visible row,
  every frame — roughly 80 calls per frame in a real sidebar, each rebuilding
  the row's renderer and label layout from scratch. The first width change of
  a drag still lays out in full, so a one-off resize (a sidebar toggle, a
  window resize) is never delayed; only the second and later changes of a
  live drag now withhold the child relayout, catching every visible row up
  in one pass on the first animation frame the width stops moving. A row's
  own width, translate, and height are still written every frame regardless,
  so its selection tint and hover wash never lag behind the drag. `Table` is
  unaffected. No consumer action is needed.

- **An arrow key no longer throws on a `ToolBar` with no children.** The bar
  makes its own element a tab stop, so an empty one can hold keyboard focus,
  while the roving-tabindex group its arrow handling steps through is only
  created once a child is added — pressing an arrow there threw `Cannot read
  properties of undefined (reading 'moveNext')`. The key is now left alone,
  keeping it available to an ancestor or to `SpatialNavigation`. No consumer
  action is needed.

- **A `Tree.revealByPredicate` still running when `setNodes` replaces the
  tree now searches the new tree.** It used to carry on over the old roots,
  so it could resolve to a node from the old dataset, expand that node's
  detached ancestors, and cache the children it loaded for a node the tree
  no longer held. It now starts again on the new roots, from the first,
  abandons a branch the reset detached, and commits nothing from a load that
  was still in flight. Separately, when `setNodes` is handed the same node
  objects while a lazy node's `expandNodeAsync` load is in flight, and the
  node is expanded again, the dropped load no longer commits its children
  and leaves the newer call resolving `false`: only the newer load expands
  the node and resolves `true`. No consumer action is needed.

- **A `Tree` expand and a `revealByPredicate` that need the same lazy
  node's children now share one `loadChildren` call.** Each used to call
  `loadChildren` itself, and an expand whose call settled second replaced
  the children the reveal had loaded, detaching the subtree the reveal was
  still searching, so the reveal could resolve to a node the tree no longer
  held. The tree now waits on at most one call per node: whichever needs
  the children first makes it, and the other waits on it, as a second
  expand already did. The children are committed once. An expand waiting on the
  call expands the node and fires `"expand"` once, or, when the call
  rejects, fires `"loaderror"` once and leaves the node collapsed and
  unloaded, whichever of the two started the call. A reveal also goes back
  for children a later expand or reveal loads under a node it passed after
  the call it waited on for that node failed, instead of resolving `null`
  with the match in the tree. No consumer action is needed.

- **A `TreeTable`'s body no longer leaks its drag wiring when it goes away.**
  Reparent drag-and-drop registers a drag source and a drop target on every
  pooled row, plus one more on the body itself for the empty area below the
  last row, and each registration lives in a process-wide map until its
  teardown runs. The body discarded all of them, so a disposed tree table
  stayed reachable through that map — with its rows, their cells, and the
  records they were bound to — for the life of the page. The body now runs
  every teardown it was handed, before the inherited teardown disposes the
  rows they are registered against. No consumer action is needed.

- **A tree cell's expand/collapse toggle is now destroyed when it is
  replaced.** The renderer swaps in a fresh caret glyph whenever the row's
  depth, child count or expansion changes — and a scrolling tree table rebinds
  its pooled rows constantly — but the outgoing glyph was only detached, so it
  kept its element, its per-instance stylesheet rule and its theme
  subscription. One glyph was stranded per swap. Because the replaced glyph is
  now destroyed, a caller holding a reference from an earlier
  `TreeCellRenderer.getToggle()` must not reuse it across a `setTreeState`
  call that changes the toggle.

- **A date or time picker's dropdown no longer strands the half of its panel
  that is swapped out.** Opening the year scroller takes the day grid out of
  the panel and puts the year column in its place, and closing it does the
  reverse; whichever half was out when the dropdown was destroyed was no
  longer a registered child, so nothing reclaimed it. A dropdown that had
  opened and closed the year scroller left behind the year column and all 171
  of its year cells; one destroyed with the scroller still open left the day
  grid behind instead. Both halves are now released. No consumer action is
  needed.

- **`TablePanel` and `TreeTablePanel` now destroy their loading-overlay
  spinner.** The spinner is mounted by `ProgressSpinner.showOverlay`, which
  appends it straight onto the table's element rather than registering it as a
  child of the panel, so the panel's own teardown never reached it: a panel
  bound to a store that had loaded at least once leaked the spinner and its
  arc on every disposal. No consumer action is needed.

- **A `CodeEditor` no longer adds 51 CSS rules to the page for every editor
  and every theme change.** Its theme extension was rebuilt on each call, and
  each build produced two fresh `style-mod` modules — which a stylesheet
  keeps in append order, with no way to unmount one again. The theme is now
  built once per dark/light flag and shared from then on, so a long session
  of theme toggling no longer grows the page's rule count. One visible
  consequence: every editor on the same flag now carries the same generated
  theme class rather than one of its own. Nothing in the library reads that
  class. No consumer action is needed.

- **`MenuBar` and `MenuSeparator` now paint their rule as a real border, so
  the bar reserves the pixel the rule occupies instead of spending its
  buttons' bottom row on it.** Both wrote the rule straight to their own CSS
  rule, which paints but does not register as a border, so the bar measured
  its border as zero and handed each `MenuBarButton` its full outer height —
  one pixel more than the content box has, with the overflow clipped. The
  consumer-visible consequence: **a `MenuBar` now reports a preferred and a
  minimum height of 29 rather than 28**, so a layout that hosts one gains a
  pixel of chrome. A bar placed in a `Border` NORTH region takes that pixel
  automatically; a layout that pins a menu bar to a literal 28 must be
  changed to 29, or it will clip the buttons exactly as the bar used to.
  `MenuSeparator` is unchanged in size — its 9px height and its 1px rule are
  where they always were, and a caller-supplied `border` still wins over the
  class default for either class.

- **A `WindowBorder` constructed with an explicit `Direction.NORTH` no longer
  reads as one constructed with no direction at all.** The constructor
  guarded its assignment on the argument's truthiness, and `Direction.NORTH`
  is enum value `0`. The two agreed by accident — the field it guarded was
  already initialised to `NORTH` — so nothing observable was wrong; the guard
  is gone and the direction is now assigned unconditionally. No consumer
  action is needed.

### Data

- **A store holding 1,000 records or more now builds its view.** Above that
  threshold the store offloads its sort and filter to a Web Worker, and in a
  built consumer app that offload never completed: the library asked the app
  serving the page for its worker script by an absolute, build-hashed URL only
  the library ships, nothing answered it, and neither the client nor the store
  noticed — so a `Table` bound to such a store stayed empty for the life of
  the page, its `'load'` event never fired, and no error appeared anywhere.
  Three changes fix it together. The worker now travels inside the library's
  own bundle, so nothing is fetched to start it. A worker whose script fails
  to run, whose reply cannot be decoded, or that never answers its first
  request is detected and retired for the rest of the page. And any offload
  that fails — for one of those reasons, or a one-off such as a record that
  will not structured-clone — rebuilds that view on the main thread, applying
  every active sorter rather than the worker protocol's primary one, so
  `'load'`, `'sortchange'`, `'filterchange'` and `'datachange'` all still fire
  and a `load()` still settles. The degradation warns once through
  `console.warn`. No consumer action is needed, with one exception: an app
  serving the framework under a strict Content-Security-Policy must now allow
  `worker-src blob:` (or `data:`, its fallback) rather than `worker-src
  'self'`; a policy allowing neither simply keeps every store on the main
  thread.

### Layouts

- **`Tab.setTabGlyph(content, glyph)` / `clearTabGlyph(content)` no longer
  silently drop a write made before the tab's strip cell exists.** Both used
  to return `false` and write nothing for a tab added moments ago but not yet
  laid out; they now record the write durably and return `true`, applying it
  once the cell is created.

- **An auto-sized `Grid` with no laid-out children no longer throws
  `RangeError: Invalid array length`.** It derived its column count as
  `floor(sqrt(count))`, so an empty grid divided by zero and carried a `NaN`
  row count into every size report and into `doLayout`. `getColRowCount()` now
  returns `{width: 0, height: 0}` for a grid with no laid-out children,
  whatever its declared `rows`/`columns` — which also stops an
  explicitly-sized empty grid reporting one inter-cell spacing gap for cells
  it does not have. The state is ordinary at runtime: undisplaying the last
  visible child empties a container's laid-out child list.

- **An emptied `HBox` or `VBox` no longer reports a negative or unbounded
  preferred size.** The inter-child spacing term was `spacing * (count - 1)`,
  so an empty row reported a negative width, and `VBox` seeded its cross-axis
  width with the unbounded sentinel that only a first child ever replaced.
  Either value, summed by the parent, drove the shrink ratio to starvation and
  collapsed the container's siblings to effectively zero. Both now report the
  container's perimeter and nothing more.

- **`Fit` and `Card` no longer lay their child out against a 0×0 rectangle
  before the container is rendered.** Both recursed into the whole subtree and
  committed a geometry the next pass overwrites; they now return when the
  container has no inner size, as `HBox`, `VBox`, `Grid`, `HFlow`, `VFlow` and
  `Anchor` already did.

- **Removing a `Card`'s visible child no longer leaves the container
  permanently blank.** The card kept the removed component as its current
  visible one; it now promotes the first of the remaining children on the next
  layout pass, or shows nothing when the removed child was the last. Deferring
  the promotion is what keeps `moveComponent` and `replaceComponent` — both
  built on `removeComponent` — settling on one visible child rather than two.
  The removed child keeps whatever displayed state it had, so a child removed
  while it was *inactive* is still `display: none` and the caller re-displays
  it.

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

- **Dragging a tab, a `Dock` region, or a `TreeTable` row no longer forces a
  synchronous layout flush on every raw `mousemove`.** `DragManager` re-ran
  its drop-target hit test (`elementsFromPoint`) and the full
  enter/leave/`onDragOver` dispatch on every pointer move, uncapped by the
  display's frame rate; both shipped `onDragOver` consumers force a second
  layout flush of their own on top of that (`TabBar`'s reorder-slot read,
  `DockRegion`'s zone read), so a drag over a `Dock` layout paid two forced
  layouts per raw move. The hit test and everything that depends on it now
  settle to at most once per animation frame, mirroring `Split`'s own
  gutter-drag coalescing; the drag ghost still tracks the cursor at native
  pointer rate, since repositioning it is cheap. No consumer action is
  needed.

- **Disposing a `Dock` or a `Window` now unregisters the drop target and drag
  source it wired.** A dock registers itself as the drop target that accepts a
  tab once every panel has been torn off, and a window registers its header as
  the source of the Shift-drag re-dock gesture; `DragManager` holds each
  registration in a process-wide map until the teardown it handed back is run,
  and neither class ran it. A dock or window disposed at any point in the
  session therefore stayed reachable — along with everything in its subtree —
  for the life of the page. Both now unregister before the inherited teardown
  destroys the component the registration is keyed by. No consumer action is
  needed.

- **`ButtonGroup` now releases every listener it registers.** A button handed
  to `removeButton` kept the group's `"action"` listener, so clicking it went
  on deselecting its former siblings; `setContainer` left its arrow-key
  `keydown` registration on every container it had ever been given, so a
  re-wired group kept driving navigation from the old one; and `dispose()`
  released neither. All three now remove the exact registration the group
  made. Separately, `addButton` of a button already in the group is now a
  no-op — it used to add a second copy of the member and a second listener,
  so one click ran the group's reconciliation twice. No consumer action is
  needed.

- **A window's trailing resize strips now take each edge's own inset.** The
  east band's x folded in the window's *left* inset and the south band's y its
  *top* inset, and the south strip took its height from the *right* inset.
  Each is correct whenever the opposing insets match, which the default
  uniform 4px inset does — so a window left at the defaults is unaffected. A
  window given asymmetric insets had its three eastern strips start past the
  padding box's right edge, where `overflow: hidden` clipped most of the grab
  band away, and its southern strips sat one inset's difference too low. No
  consumer action is needed.
