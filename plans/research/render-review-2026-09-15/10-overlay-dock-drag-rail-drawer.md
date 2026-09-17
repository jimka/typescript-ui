# 10 overlay-dock-drag-rail-drawer — render-work review

## Summary

- **`Dock` itself adds nothing per frame.** It is a `Container` with a `Fit`
  manager and one child, with no `doLayout`, no `render`, no viewport listener,
  no geometry read and no stylesheet write. Probe P8: five identical `doLayout`
  passes over a 3-panel dock scheduled **0** sweeps and **0** rAF callbacks; the
  40 style applies and 4 rule writes per pass all belong to `Split`/`Tab`
  (slices 06/07). A pane resize and a body resize cost the same. Nothing to fix
  here — the rest of this report is about the drag path, the sweep, and
  `Rail`/`Drawer`.
- **F10.1 (HIGH)** — the drag ghost follows the cursor by writing `left`/`top`
  on an un-composited, translucent, box-shadowed `position: fixed` box, on every
  **raw** `mousemove`: 4 `DOM.sink.apply` calls per move, 2 of them writing
  unchanged `width`/`height` (probe P1/P2). `AbstractWindow`'s own header drag
  already does the opposite (`setWillChange("transform")` + `setTranslate`).
  Layout + a blurred-shadow repaint per raw pointer event in software Cairo.
- **F10.2 (MEDIUM–HIGH)** — `Dock.reconcileHosts` rebuilds the whole region
  index once per registered panel. Probe P9, one sweep: 24 panels → 24
  `allTabRegions()`, 25 `floatWindowsHoldingFrames()`, 27
  `AbstractWindow.getOpenWindows()` and **649 `regionKind()`** calls (each a
  `getClassName()` plus a regex `replace`). 4 panels → 29; 12 → 181; 24 → 649:
  quadratic. Runs on every `addPanel`, close, drop, tab-bar merge and restore.
- **F10.3 (MEDIUM)** — `ReorderIndicator` is dead as shipped (no drop target in
  the library ever returns a number from `onDragOver`), yet it is constructed
  per gesture and `detach()`ed on **every** drag frame, and each detach on a
  never-rendered component issues a `DOM.source.getElementById` (probe P2: 1 per
  drag frame; probe P3: 20 for 10 detach pairs).
- **F10.4 (MEDIUM)** — `Dock` registers itself as a global drop target and
  discards the teardown closure; `destructor` never unregisters it, so the
  module-level `dropTargets` map strongly retains every `Dock` ever built.
- **F10.5 (MEDIUM for a Rail app; LOW for Loom)** — a mounted content-fit `Rail`
  re-derives its thickness with a full subtree preferred-size aggregation on
  every `resize` event: 19 `getPreferredSize` calls and 0 style writes per
  unchanged tick with 6 handles (probe P7); 0 with an explicit `thickness`.

A **closed `Drawer` pays exactly nothing per resize** (probe P6): it never
materialises an element before `open()`, and `close()` removes the viewport
listener before the exit slide. An **open** one costs one `getViewportSize()`
per resize event and zero writes when the viewport is unchanged.

## Findings

### F10.1 The drag ghost moves via `left`/`top` on an un-composited shadowed box, per raw mousemove

- **Category**: F (paint-heavy), B (unchanged-value write), G (allocation churn)
- **Impact**: HIGH — per raw pointer event (not per frame) for the whole
  duration of every tab drag, window re-dock drag and tree row drag.
- **Where**:
  - `overlay/DragGhost.ts:90-93` (`moveTo` → `setX` + `setY`)
  - `overlay/DragGhost.ts:69-73` (`setBackgroundColor` / `setShadow` /
    `setBorderRadius` / `setOpacity(0.85)` — a translucent, blurred surface)
  - `overlay/DragGhost.ts:63` (`Position.FIXED`, no `will-change`)
  - `overlay/DragManager.ts:642-651` (`onMouseMove`, called per raw move)
  - `core/Component.ts:4271` / `:4307` (`setX` / `setY` →
    `writeHorizontalGeometry` / `writeVerticalGeometry`)
  - `core/Component.ts:4336-4346` (each writes **two** properties: `left`+`width`,
    `top`+`height`, because the rounded extent is derived from the origin)
  - `core/StyleTarget.ts:35-41` + `:446-448` (`InlineStyle.set` →
    one `DOM.sink.apply` per property; no last-value filter)
- **Hot path**:
  - window `mousemove` (capture) → `Event.baseViewportListener` (`core/Event.ts:350`)
  - → `DragManager.onMouseMove` (`overlay/DragManager.ts:615`)
  - → `session.ghost.moveTo(x + 12, y + 12)` (`:646`)
  - → `DragGhost.moveTo` → `Component.setX` → `writeHorizontalGeometry`
  - → `setElementStyle("left", …)` → `InlineStyle.set` → `DOM.sink.apply`
  - → `setElementStyle("width", …)` → `InlineStyle.set` → `DOM.sink.apply` *(unchanged value)*
  - → `Component.setY` → the same two for `top` and `height` *(`height` unchanged)*
  - → browser: layout of the fixed box + repaint of old ∪ new rect, box-shadow
    blur re-rasterized by Cairo, on a non-composited layer.
- **Evidence**: probe P1 — one 1 px horizontal `moveTo` records
  `{"apply":2}` with style keys `["left","width"]`; one diagonal `moveTo`
  records `{"apply":4}` with `["left","width","top","height"]`. Probe P2 — five
  raw mousemoves during a live session record `{"apply":20}`, i.e. 4 per raw
  move, and the drained frame that follows records `{}` (the frame itself writes
  nothing; all 20 come from the ghost). `width` and `height` are re-written with
  the value they already hold on every move because `writeHorizontalGeometry`
  re-derives `roundedExtent(this._left, this._width)` whenever the origin moves;
  with integer `clientX` the derived value is unchanged every time.
  The comment at `DragManager.ts:606-611` asserts the inline, unthrottled
  reposition is cheap "since neither is expensive" — that is the claim this
  finding contradicts, and it was never measured in the target engine.
  `Animation.ts` sets no `will-change` anywhere (grep: 0 hits), and
  `DragGhost` never calls `setWillChange`.
- **Proposed change**: give the ghost the same shape the framework already uses
  for a window drag (`overlay/AbstractWindow.ts:2364-2366`, `:2378`, `:2391-2394`):
  `show()` stamps the base `setX`/`setY` once and calls
  `setWillChange("transform")`; `moveTo(x, y)` becomes
  `setTranslate(x - baseX, y - baseY)`; `hide()` clears the translate and the
  hint. `Component.setTranslate` (`core/Component.ts:4647-4661`) writes one
  guarded inline `transform` and nothing else, so the per-move cost drops from
  4 applies (2 of them unchanged) to 1, and the motion moves onto a
  pre-created compositor layer instead of forcing layout + a blurred repaint.
- **Risk / blast radius**: `moveTo` is called from exactly one place
  (`DragManager.ts:646`) and, for a caller-supplied ghost, behind a
  `typeof … === "function"` probe (see F10.7). `tests/overlay/overlay-primitives.test.ts`
  asserts ghost geometry; `tests/overlay/DragManager.pointerCoalescing.test.ts:277`
  ("repositions the ghost on every raw move") asserts the reposition happens per
  raw move, not how it is written. A translate-based ghost reports the same
  `getX()`/`getY()`, so any test reading those still passes; a test reading the
  recorded `left`/`top` style would need updating.
- **Proof at implement time**: a probe asserting ≤ 1 `DOM.sink.apply` per
  `moveTo` and zero `width`/`height` keys among them (today: 4 and 2); in the
  harness, ms/frame during a tab drag across the 2×2 editor grid, and the
  presence of a compositor layer for the ghost in a WebKitGTK Timeline recording.

### F10.2 `Dock.reconcileHosts` rebuilds the whole region index once per panel — a quadratic sweep

- **Category**: D (work recomputed with unchanged inputs), H, I
- **Impact**: MEDIUM–HIGH — once per structural change, growing as O(N²) in the
  open-panel count. Loom keeps 10–30 editor tabs open and schedules a sweep on
  every `addPanel`, every tab close, every drop, every tab-bar merge and every
  `setLayoutState` restore.
- **Where**:
  - `overlay/Dock.ts:1185-1215` (`reconcileHosts`, the loop)
  - `overlay/Dock.ts:2073-2081` (`regionForFrame` → `allTabRegions()` per frame)
  - `overlay/Dock.ts:2102-2125` (`allTabRegions` → full tree walk **plus**
    `floatWindowsHoldingFrames()`)
  - `overlay/Dock.ts:1159-1165` (`floatWindowsHoldingFrames` →
    `AbstractWindow.getOpenWindows()` × frames × ancestor walks)
  - `overlay/Dock.ts:1556-1560` (`regionKind` → `getClassName()` + `replace(/^_/, "")`)
  - `overlay/Dock.ts:1228-1230` (`hostForFrame` → `floatForFrame` → another
    `floatWindowsHoldingFrames()`)
- **Hot path**:
  - any structural change → `Dock.scheduleSweep` (`:892`) → rAF → `runSweep` (`:910`)
  - → `ownedFloatWindows()` — scan 1
  - → `wireRegion(root)` — tree walk 1
  - → `subscribeFloatWindows()` → `floatWindowsHoldingFrames()` — scan 2 —
    plus `pruneClosedFloatSubscriptions()` → `new Set(getOpenWindows())` — scan 3
  - → `reconcileHosts(root)` → **for each of N frames**: `hostForFrame` (ancestor
    walk) **and** `regionForFrame` → `allTabRegions()` → `collectTabRegions(root)`
    (full tree walk, one `regionKind` per node) **and** `floatWindowsHoldingFrames()`
    (scan 3+i)
  - → `teardownVanished` — tree walk 2 — → `reconcileEmptyState` → `mainRegionEmpty` → `rootTab`
- **Evidence**: probe P9, a single `runSweep()` on a dock whose panels all sit in
  one tiled `Tab` region:

  | panels | `allTabRegions` | `floatWindowsHoldingFrames` | `getOpenWindows` | `regionKind` | sink ops |
  |---|---|---|---|---|---|
  | 4  | 4  | 5  | 7  | 29  | `{}` |
  | 12 | 12 | 13 | 15 | 181 | `{}` |
  | 24 | 24 | 25 | 27 | 649 | `{}` |

  The sweep writes **nothing** to the DOM on a no-op pass (`{}` in every row), so
  all of this is pure recomputation. `regionKind` fits N·(N+1) + overhead — the
  tree is re-walked once per frame because `regionForFrame` re-derives
  `allTabRegions()` inside the loop.
- **Proposed change**: `reconcileHosts` computes `allTabRegions()` and
  `floatWindowsHoldingFrames()` **once**, then walks those regions once building
  a `Map<Component, Component>` from content frame to region (and a
  `Map<Component, AbstractWindow>` from frame to float), and looks each frame up
  in O(1). `runSweep` can pass its already-computed float list down rather than
  letting three separate helpers each call `getOpenWindows()`. Nothing about the
  emitted events changes — the diff logic is untouched.
- **Risk / blast radius**: `regionForFrame` is also called from `focusPanel`
  (`:1880`), `removePanel` (`:1914`) and `setFrameBusy` (`:1645`) — those stay as
  they are; only the reconcile loop changes. `tests/overlay/Dock.lifecycle.test.ts`
  pins every attach/detach/move/focus emission and the ledger updates; it is the
  regression net.
- **Proof at implement time**: re-run probe P9 and assert `allTabRegions` = 1 and
  `regionKind` linear in N (24 panels: ≤ 30, today 649); plus the full
  `Dock.lifecycle` / `Dock.beforeClose` suites unchanged.

### F10.3 `ReorderIndicator` is dead chrome, built per gesture and `detach()`ed per drag frame

- **Category**: J (dead code), A (read on a hot path), G
- **Impact**: MEDIUM — one wasted `getElementById` per drag frame for the whole
  duration of every dock/tab-strip drag, plus one Component construct + dispose
  per gesture.
- **Where**:
  - `overlay/ReorderIndicator.ts:318-322` (its own JSDoc: "Reserved for future
    sibling-reorder work — drop-on-directory does not use this overlay")
  - `overlay/DragManager.ts:388` (`session.indicator = new ReorderIndicator()`,
    unconditional per committed gesture)
  - `overlay/DragManager.ts:576-581` (`flushMove`'s `else if (session.indicator)
    { session.indicator.detach(); }` — reached every frame)
  - `overlay/DragManager.ts:454-456` (`leaveCurrentTarget` — the same on leave)
  - `overlay/DragManager.ts:482-487` (`enterNewTarget` — the same on enter)
  - `overlay/ReorderIndicator.ts:377-379` → `Component.removeElement`
    (`core/Component.ts:1316-1320`) → `getElement()` (`core/Component.ts:1284-1297`)
    → `DOM.source.getElementById(this.getId())`
- **Hot path**:
  - rAF → `DragManager.flushMove` (`:526`)
  - → same-target branch → `target.options.onDragOver(detail)` → `null`
    (`DockRegion.ts:81`, `TabBar.ts:3035`)
  - → `else if (session.indicator) session.indicator.detach()` (`:579-580`)
  - → `Component.removeElement` → `getElement()` → `_element` is falsy (never
    rendered) → `DOM.source.getElementById(id)` → miss → cached as `null` →
    **repeated on the next frame**
- **Evidence**: no drop target in the library returns a number from
  `onDragOver`. The four registrations are `DockRegion.ts:68-82` (returns
  `null`), `TabBar.ts:3024-3042` (declared `number | null`, always returns
  `null`), `Dock.ts:454-459` (returns `null`) and `TreeBody.ts:627` /
  `TreeBody.ts:740` (no `onDragOver` at all). Probe P2: a five-move, one-frame
  drag over a `DockRegion`-shaped target records `{"elementsFromPoint":1,
  "getElementById":1,…}` — the single `getElementById` is this detach. Probe
  P2b: leaving a target records 2 (`feedback.detach` + `indicator.detach`).
  Probe P3: 10 × (`indicator.detach()` + `feedback.detach()`) on never-rendered
  instances records 20 `getElementById` calls. `DragFeedback` shows the same
  shape whenever the target sets `suppressValidityTint` — which every dock and
  tab-strip target does (`DockRegion.ts:67`, `TabBar.ts:3022`, `Dock.ts:453`).
- **Proposed change**: two independent parts.
  (a) Build `session.indicator` and `session.feedback` **lazily**, on the first
  call that actually needs them (a numeric `onDragOver` hint / a non-suppressed
  tint), so a dock drag constructs neither; the `if (session.indicator)` guards
  already present become the null-check.
  (b) Give `Component.removeElement` (or these two `detach()` methods) the
  `_element`-field check `release()` already uses (`core/Component.ts:1348-1353`,
  whose own comment warns that `getElement()` resurrects by id), so a detach on a
  component that has no element costs nothing.
  Part (b) is a `core/Component` change — see Cross-slice notes.
- **Risk / blast radius**: `commitSession`'s unconditional construction is pinned
  indirectly by `tests/overlay/DragManager.styleRuleDisposal.test.ts` and
  `DragManager.repeatedDragDisposal.test.ts`, which assert a completed gesture
  leaves no per-instance rule behind — a chrome object that is never built
  trivially satisfies both. `endSession`'s `dispose()` calls need the same
  null-guards they already have.
- **Proof at implement time**: a probe asserting 0 `DOM.source.getElementById`
  reads across ten drained drag frames over a `suppressValidityTint` target
  (today: 10), and 0 `ReorderIndicator` constructions in a completed dock drag.

### F10.4 `Dock` registers a global drop target and never unregisters it

- **Category**: J (leak / missing teardown), G
- **Impact**: MEDIUM — a correctness and retention defect, not a per-frame cost.
- **Where**:
  - `overlay/Dock.ts:447-479` (`wireEmptyDropTarget`; the return value of
    `DragManager.makeDropTarget` is discarded at `:448`)
  - `overlay/Dock.ts:2371-2385` (`destructor` — disposes `_emptyDropOverlay` and
    every `DockRegion`, nothing for this registration)
  - `overlay/DragManager.ts:264-268` (`makeDropTarget` stores
    `{ component, options }` in the module-level `dropTargets` map and returns the
    only closure that removes it)
- **Hot path**: n/a (construction + teardown).
- **Evidence**: every other `makeDropTarget` caller in the library keeps its
  teardown and calls it — `DockRegion.ts:59` → `destroy()` at `:132`,
  `TabBar.ts:3021` (returned to the caller), `TreeBody.ts:627` / `:740`
  (`_rowDnDTeardowns` / `_emptyAreaDropTeardown`). `Dock.ts:448` is the sole
  discard. `dropTargets` is a module-level `Map` (`DragManager.ts:195`) with no
  weak semantics, so the entry pins the `Dock`, its options bag (including a
  consumer-supplied `emptyContent` component) and its whole subtree for the life
  of the process, defeating the `FinalizationRegistry`-based handle release
  `docs/concepts/dom-seams.md` relies on. Not probe-verified — `dropTargets` is
  module-private; confirmed by reading both sites.
  (`overlay/Window.ts:165` discards a `makeDragSource` teardown the same way —
  see Cross-slice notes.)
- **Proposed change**: store the closure in a private field in
  `wireEmptyDropTarget` and call it from `destructor` before
  `super.destructor()`, alongside the existing `_emptyDropOverlay.dispose()`.
- **Risk / blast radius**: none beyond `Dock`; nothing else reads the field.
  `tests/overlay/Dock.styleRuleDisposal.test.ts` already covers the
  destroy path and would be the natural home for the assertion.
- **Proof at implement time**: a probe that builds and destroys N docks and
  asserts a drag over a fresh source resolves no stale target — or, more
  directly, exposing a test-only size accessor on `dropTargets` and asserting it
  returns to its baseline after `dock.dispose()`.

### F10.5 A content-fit `Rail` re-derives its thickness with a full preferred-size aggregation per resize event

- **Category**: D (work recomputed with unchanged inputs)
- **Impact**: MEDIUM for an app that mounts a `Rail`; LOW for Loom (grep:
  `/home/jika/typescript/loom/src` has 1 incidental `Rail` mention and no
  instantiation). `resize` fires roughly per frame during a window resize or
  drag.
- **Where**:
  - `overlay/Rail.ts:291` (`_boundResizeHandler` = `applyRestingGeometry`)
  - `overlay/Rail.ts:809` (`Event.addViewportListener(this, "resize", …)`)
  - `overlay/Rail.ts:1271-1278` (`applyRestingGeometry`)
  - `overlay/Rail.ts:1248-1266` (`restingRect` → `DOM.source.getViewportSize()`
    + `getThickness()`)
  - `overlay/Rail.ts:403-413` (`getThickness` → `measureContentThickness()` when
    no explicit `thickness`)
  - `overlay/Rail.ts:424-436` (`measureContentThickness` → `this.getPreferredSize()`)
  - `overlay/Rail.ts:443-447` (`adaptThickness` — the existing invalidation hook,
    already called from `setThickness`, `registerDrawer`, `unregisterDrawer`,
    `showWindowHandle`, `removeWindowHandle` and `applyOrientation`)
- **Hot path**:
  - window `resize` → `Event.baseViewportListener` → `Rail._boundResizeHandler`
  - → `applyRestingGeometry` → `restingRect`
  - → `DOM.source.getViewportSize()` *(a forced document layout in production —
    see the slice-03 finding in the briefing)*
  - → `getThickness()` → `measureContentThickness()` → `Component.getPreferredSize()`
  - → the `VBox`/`HBox` manager aggregates every handle's preferred size
  - → `Math.ceil(cross)` → the same number the rail already has
  - → `setX`/`setY`/`setWidth`/`setHeight`, all guarded, all no-ops
- **Evidence**: probe P5/P7 on a WEST rail with 6 handles, one unchanged resize
  tick: `rail.getPreferredSize` calls = 1; size reports across the whole rail
  subtree = **19 `getPreferredSize`**, 0 `getMinSize`, 0 `getMaxSize`;
  `getViewportSize` reads = 1; sink ops = **`{}`**. Ten unchanged ticks: 10
  top-level calls, still `{}` writes. The same rail constructed with
  `thickness: 48` records **0** `getPreferredSize` calls per tick — so the entire
  aggregation is attributable to the content-fit path and is discarded.
- **Proposed change**: cache the measured thickness in a private field, fill it
  lazily in `measureContentThickness`, and clear it in `adaptThickness()` (which
  already sits on every mutation that can change it) and in `setCollapsed`. Then
  a resize tick reads a number instead of walking the subtree, and the
  existing guarded geometry setters keep the tick write-free.
- **Risk / blast radius**: `getThickness()` is public (documented in
  `docs/components/Rail.md` under "Edges and thickness") and is read by
  `setCollapsed` (`:478`) to capture `_expandedThickness`; the cache must be
  cleared there too, or that capture reads a stale value.
  `tests/overlay/Rail.test.ts` ("round-trips an explicit thickness") and the
  `handleMainAxisOffset` suite pin the behaviour.
- **Proof at implement time**: re-run probe P7 and assert 0 `getPreferredSize`
  calls across the rail subtree for an unchanged resize tick (today: 19).

### F10.6 `DropZoneOverlay.attachTo` re-reads parentage twice on every drag frame

- **Category**: A (read on a hot path, mild), G
- **Impact**: LOW — 2 seam round-trips per drag frame per hovered region; not
  layout-forcing.
- **Where**:
  - `overlay/DropZoneOverlay.ts:154-171` (`attachTo`: two
    `DOM.source.getParentElement` comparisons, two `getElement(true)` calls)
  - `layout/DockRegion.ts:72` (`this._overlay.attachTo(this._region)` on **every**
    `onDragOver`, with the doc note "Idempotent — safe to call on every
    `onDragOver`")
- **Hot path**: rAF → `DragManager.flushMove` → `onDragOver` →
  `DropZoneOverlay.attachTo` → `DOM.source.getParentElement(myEl)` ×1,
  `DOM.source.getParentElement(highlightEl)` ×1.
- **Evidence**: probe P4 — 5 settled `attachTo` + `setHighlight` calls with
  unchanged region geometry record **10 `getParentElement` reads and 0 sink
  ops**. The geometry setters' guards work correctly (`setX(0)`/`setY(0)` and
  the unchanged width/height are all no-ops), and `setHighlight`'s
  zone+validity latch (`:186-189`) works correctly; only the parentage probe
  runs unconditionally. A real zone change costs just `{"apply":2}`
  (`["left","width"]`), which is already minimal.
- **Proposed change**: latch the attached region in a private field
  (`_attachedTo`), append only when it differs, and clear it in `detach()`
  alongside the `_zone`/`_valid` reset that is already there (`:239-243`).
- **Risk / blast radius**: `attachTo` has two callers — `DockRegion.ts:72` and
  `Dock.ts:455`. `tests/layout/DockRegion.styleRuleDisposal.test.ts` and
  `tests/overlay/Dock.styleRuleDisposal.test.ts` cover the disposal path.
- **Proof at implement time**: re-run probe P4 and assert 0 `getParentElement`
  reads for 5 settled `attachTo` calls (today: 10).

### F10.7 `ghostFactory` has no user and costs three runtime duck-type probes, one per raw mousemove

- **Category**: H (configurability nobody uses), J
- **Impact**: LOW–MEDIUM — one `typeof` probe plus an `as unknown as` cast per
  raw mousemove, and three escape hatches in an otherwise typed module.
- **Where**:
  - `overlay/DragManager.ts:96-101` (the option)
  - `overlay/DragManager.ts:382-396` (`commitSession`:
    `typeof (ghost as unknown as { show?: () => void }).show === "function"`)
  - `overlay/DragManager.ts:642-651` (`onMouseMove`:
    `typeof dragGhost.moveTo === "function"` — **per raw mousemove**)
  - `overlay/DragManager.ts:751-766` (`endSession`:
    `typeof dragGhost.hide === "function"`)
- **Hot path**: window `mousemove` → `onMouseMove` → the `moveTo` probe, before
  every ghost reposition.
- **Evidence**: grep for `ghostFactory` — `packages/lib/src`: 4 hits, all inside
  `DragManager.ts` itself (the declaration plus the three use sites);
  `packages/lib/tests`: **0**; `packages/docs/src` + `packages/create-app`: **0**;
  `/home/jika/typescript/loom/src`: **0**. The only non-source hits are the API
  reference and one row in `docs/recipes/drag-and-drop.md:50`. So the option is
  documented public API with zero users anywhere, and the three probes exist
  solely because the returned `Component` might not be a `DragGhost`.
- **Proposed change**: keep the option (it is documented public API) but type it
  `(source: Component, data: DragData) => DragGhost` — `DragGhost` is exported
  from the same barrel — and delete all three `typeof`/`as unknown as` pairs,
  calling `show()`/`moveTo()`/`hide()` directly. `endSession`'s
  "factory-owned ghosts are detached, never disposed" rule keys on
  `sourceOptions.ghostFactory` being present, which is unaffected.
- **Risk / blast radius**: a type-only narrowing of a public option with no
  callers; a consumer returning a bare `Component` would become a compile error
  (and today already gets silently degraded behaviour — no `show`, so the
  fallback `appendChild` branch runs). No test references it.
- **Proof at implement time**: `npm run typecheck` plus the existing
  `DragManager` suites; no measurement needed.

### F10.8 The default drag ghost is an empty 160×28 box, and both of its documented behaviours are absent

- **Category**: H (function/implementation mismatch), J (unreachable code)
- **Impact**: LOW (a UX defect plus dead code), but it compounds F10.1: the
  shadowed translucent box repainted per raw mousemove carries no information.
- **Where**:
  - `overlay/DragManager.ts:384` (`new DragGhost()` — no arguments)
  - `overlay/DragGhost.ts:23,26` (`DEFAULT_WIDTH = 160`, `DEFAULT_HEIGHT = 28`)
  - `overlay/DragManager.ts:97-100` (the option's JSDoc: the default ghost
    "carries no label and **matches the source's size**" — it does not; nothing
    reads the source's size)
  - `overlay/DragManager.ts:54-55` (`TabDragData.label`, JSDoc: "used for the
    drag ghost and the tear-off window title")
  - `component/container/TabBar.ts:2977` (writes `label` on every tab drag start)
  - `overlay/DragGhost.ts:49`, `:75-79`, `:119-132` (`_label`, the label branch,
    and the whole `doLayout()` override)
- **Hot path**: n/a (per gesture).
- **Evidence**: grep for `dragData["label"]` / `dragData.label` across
  `packages/lib/src` — **0 hits**; nobody reads `TabDragData.label`. Grep for
  `new DragGhost(` outside `DragGhost.ts` — the only production site is
  `DragManager.ts:384` with no arguments; the only labelled constructions are
  `tests/overlay/overlay-primitives.test.ts:136` and
  `tests/component/content-box-containment.test.ts:403`. So `_label`, the
  `if (label !== undefined)` branch and the `doLayout()` override are unreachable
  in production. `doLayout()` also calls `getContentBounds()`
  (`core/Component.ts:3651`, which allocates a fresh `Insets`) unconditionally
  before checking `this._label`.
- **Proposed change**: either (a) make the default ghost carry the source's label
  and size — `commitSession` reads `dragData["label"]` when present and the
  source's `getWidth()`/`getHeight()`, which makes the documented behaviour true
  and the ghost informative; or (b) drop the label support from `DragGhost`
  (field, branch, `doLayout` override) and correct both JSDoc blocks. (a) is the
  better user outcome and makes `TabDragData.label` load-bearing; whichever is
  chosen, the two false JSDoc claims must go.
- **Risk / blast radius**: `overlay-primitives.test.ts` constructs a labelled
  ghost and asserts its layout — option (b) would delete those cases;
  `content-box-containment.test.ts:403` uses a labelled ghost as a content-box
  fixture and would need a different subject. Option (a) touches no test.
- **Proof at implement time**: a screenshot of a tab drag in the harness showing
  the panel title in the ghost; no counter needed.

### F10.9 `endSession` never fires the current target's `onDragLeave`

- **Category**: H (contract gap), I (worked around at the call site)
- **Impact**: LOW — latent today, reachable for any target whose `accepts` can
  return `false`.
- **Where**:
  - `overlay/DragManager.ts:683-703` (`onMouseUp`: `onDrop` runs only inside
    `if (target.options.accepts(detail))`)
  - `overlay/DragManager.ts:714-780` (`endSession`: unwires listeners, disposes
    chrome, restores the cursor — never calls `leaveCurrentTarget`)
  - `overlay/DragManager.ts:284-290` (`DragManager.cancel` → `endSession` —
    same gap)
  - `layout/DockRegion.ts:87-92` (`onDrop` detaches the overlay and clears the
    spring-raise timer **before** its own legality check — the workaround)
- **Hot path**: n/a (gesture end).
- **Evidence**: a release over a target that refuses the drop, and every
  `cancel()`, leaves the target's hover chrome attached and any dwell timer
  armed. `DockRegion` and `TabBar` are immune only because their `accepts`
  predicates are unconditional for a tab drag (`DockRegion.ts:66`,
  `TabBar.ts:3023`); `TreeBody.ts:627`'s row target *can* refuse and has no
  `onDragLeave` at all, so it happens to be immune too. `DragManager.cancel` has
  **0** callers in `packages/lib/src` (3 in tests), so nothing exercises the
  cancel path today. The fact that `DockRegion` hoists its cleanup above its own
  legality check is direct evidence the author hit this asymmetry.
- **Proposed change**: call `leaveCurrentTarget(session, detail)` from
  `endSession` before disposing the chrome, so every gesture end is symmetric
  with every target change. `DockRegion.onDrop`'s pre-check cleanup can then stay
  (it is idempotent) or move below the guard.
- **Risk / blast radius**: `onDragLeave` would newly fire once at the end of a
  successful drop as well as a refused one; targets must tolerate a leave after a
  drop. All four in-library targets do (their leave handlers are pure hides).
  Worth a line in `docs/recipes/drag-and-drop.md`.
- **Proof at implement time**: a probe asserting `onDragLeave` fires exactly once
  for a refused release and once for `cancel()` mid-hover (today: zero).

### F10.10 `Rail.positionChevron` re-writes four rule declarations per collapse toggle, one of them constant

- **Category**: C (stylesheet-rule write), B
- **Impact**: LOW — per collapse toggle, not per frame.
- **Where**: `overlay/Rail.ts:609-613` (`new StyleRule({ scope: "component",
  name: …, styles: { left, top, width, zIndex: "1" } })`), reached from
  `applyCollapseAppearance` (`:511`, once per mount) and
  `animateCollapseTransition` (`:634`, once per toggle).
- **Hot path**: chevron double-click → `toggleCollapsed` → `setCollapsed` →
  `animateCollapseTransition` → `positionChevron` → `StyleRule` constructor →
  `ensure()` → `flushDirty` → `DOM.sink.setRuleStyles` → a full-document restyle
  in the target engine.
- **Evidence**: `_ruleFor(selector)` is cached by selector
  (`core/StyleTarget.ts:355-368`), so repeated construction reuses the same
  `CSSStyleRule` and no rule leaks — `tests/overlay/Rail.styleRuleDisposal.test.ts`
  confirms disposal. But `zIndex: "1"` never changes and is re-written every
  toggle, and the whole write lands on a rule that is already materialised.
- **Proposed change**: hold one `StyleRule` for the chevron as a field, write
  `zIndex` once at mount, and update only `left`/`top`/`width` on a toggle.
- **Risk / blast radius**: `Rail.styleRuleDisposal.test.ts` asserts the chevron's
  rule is reclaimed on destroy; a field-held rule needs an explicit `dispose()`
  in `destructor` (which already disposes `_collapseButton`).
- **Proof at implement time**: a probe counting `DOM.sink.setRuleStyles` calls
  across ten collapse toggles.

### F10.11 `Drawer` and `Rail` slide animations create their compositor layer on the first animated frame

- **Category**: F (paint-heavy), G
- **Impact**: LOW for Loom (no `Drawer`/`Rail` instantiation in
  `/home/jika/typescript/loom/src`); MEDIUM for any app that opens a drawer.
- **Where**:
  - `overlay/Drawer.ts:528-542` (`animateIn`), `:550-579`
    (`animateOutAndFinalize`) — `Animation.play` on `transform`
  - `overlay/Rail.ts:858-872` (`animateIn`), `:844-850` (`unmount`)
  - `overlay/Rail.ts:674-683` + `:696-724` (`collapseTween` animates `width`, and
    `left`/`top` for EAST/SOUTH rails)
  - `core/Animation.ts` — grep for `willChange`: **0 hits**
- **Hot path**: `Drawer.open()` → `animateIn` → `Animation.play` → a
  `transform` transition on a 320 px × full-viewport-height panel carrying
  `--ts-ui-drawer-shadow`, with no layer pre-created.
- **Evidence**: `docs/concepts/performance.md` § "Compositor-layer hints" states
  the framework calls `setWillChange` automatically for window drag, virtual
  rows and the table header; the drawer and rail slides are not in that list, and
  neither class calls `setWillChange`. `Rail.collapseTween` animates `width`
  (and `left`), which cannot be composited at all — every tween frame is a
  layout + full-strip repaint, and the strip's children are clipped, not
  re-laid-out (the documented intent at `Rail.ts:620-625`).
- **Proposed change**: `setWillChange("transform")` before `Animation.play` and
  `setWillChange(null)` in the completion callback, for both slide directions in
  both classes — the same lifetime discipline `AbstractWindow` uses. The rail
  collapse tween's `width` animation is a separate, larger question (a transform
  scale would distort the handles); leave it, and note it.
- **Risk / blast radius**: confined to the two classes; `Drawer.test.ts` asserts
  option round-trips only.
- **Proof at implement time**: a WebKitGTK Timeline recording of a drawer open
  showing one layer-creation tick before the slide rather than during it.

### F10.12 `Dock.regionKind` duplicates the file's own `instanceof Tab` discrimination

- **Category**: I (duplication), H
- **Impact**: LOW on its own; it is the per-call cost multiplied by F10.2's
  quadratic call count (649 calls per sweep at 24 panels).
- **Where**:
  - `overlay/Dock.ts:1548-1560` (`regionKind`, whose JSDoc says "Discriminates on
    the stripped runtime class name (no `instanceof`, avoiding an import cycle)")
  - `overlay/Dock.ts:1531-1546` (`isRegionContainer`, `isTab` — both built on it)
  - `overlay/Dock.ts:9-10` (Dock imports `Tab` and `Split` directly)
  - `overlay/Dock.ts:1041`, `:1062`, `:2061` (`manager instanceof Tab`, three
    times, in the same file)
- **Hot path**: every sweep — see F10.2.
- **Evidence**: the import-cycle justification is contradicted three lines'
  worth by the file itself: `Tab` is imported at the top and `instanceof Tab` is
  already used in `hideEmptyState`, `rootTab` and `ownerTab`. Each `regionKind`
  call runs `getClassName()` and a regex `replace(/^_/, "")`, allocating a
  string; probe P9 counts 649 of them in one 24-panel sweep.
- **Proposed change**: replace `regionKind`'s string comparison with
  `manager instanceof Tab` / `manager instanceof Split` inside `isTab` /
  `isRegionContainer`, matching what the rest of the file already does, and
  correct or delete the JSDoc claim. `regionKind` itself then has one remaining
  caller (`collapseSinglePaneSplit:1450`) and can inline.
- **Risk / blast radius**: **check against the open
  `minification-safe-class-names` plan** before acting. That plan's Architecture
  Decisions explicitly preserve `Dock.ts`'s `replace(/^_/, "")` strip site as a
  "defensive no-op"; it does not require the site to exist, so removing it is
  compatible — but the plan should be updated to drop `Dock.ts` from its list of
  strip sites rather than silently diverging. `instanceof` is strictly more
  robust under minification than a name comparison, so this moves in the same
  direction the plan does.
- **Proof at implement time**: re-run probe P9 (`regionKind` → 0 or 1) and the
  full `Dock.lifecycle` / `Dock.panelPresentation` suites.

### F10.13 Four broken `{@link}` doc paths in this slice's public JSDoc

- **Category**: J (code health)
- **Impact**: LOW.
- **Where**:
  - `overlay/DragGhost.ts:37` and `overlay/DragFeedback.ts:27` →
    `/api/overlay/variables/DragManager`; the page is at
    `packages/lib/docs/api/overlay/namespaces/DragManager` (`DragManager` is a
    namespace, not a variable).
  - `overlay/Drawer.ts:135` → `/api/core/classes/LayerManager`; the page is at
    `packages/lib/docs/api/core/namespaces/LayerManager`.
  - `overlay/Drawer.ts:139` → `/api/component/container/classes/DialogBackdrop`;
    **no page exists** — `DialogBackdrop` is not in the public API docs, so per
    `CODE_CONVENTIONS.md` § "Don't `{@link}` internal symbols from public JSDoc"
    this must become prose, not a corrected link.
- **Evidence**: every other `/api/…` path in the nine slice files resolves to an
  existing `.md` under `packages/lib/docs/api/` (checked: `Split`, `Tab`,
  `Window`, `Component`, `serializeLayout`, `restoreLayout`, `TabBar`,
  `DismissableLayer`, `Placement`, `Container`, `Panel`, `Border`, `Button`,
  `TreeTable`, `DockRegion`, and all four drag-chrome classes). These four are
  the exceptions. This carries the 2026-08-29 codebase-health audit's
  "`/api/overlay/variables/DragManager` ×6" item for this slice (2 of the 6 are
  here; the other 4 are in `TreeBody.ts`, `TreeTable.ts` and `Component.ts`).
- **Proposed change**: fix the two `variables/` → `namespaces/` paths and the
  `LayerManager` path; rewrite the `DialogBackdrop` reference as prose.
- **Risk / blast radius**: none. `npm run docs:api` must finish with zero
  warnings.
- **Proof at implement time**: `npm run docs:api` clean.

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `Dock` | Glue: panel registry, declarative layout compiler, re-wire sweep over `Split`/`Tab` regions | its own `Container` element; one `DropZoneOverlay` for the empty state | **none** — no `doLayout`, no `render`, no viewport listener, no geometry read, no rule write (probe P8: 0 sweeps and 0 rAF callbacks across 5 identical passes) | fits (per frame) / over-built (per sweep) | F10.2, F10.4, F10.12 |
| `DragManager` (namespace) | Process-wide DnD coordinator: source/target registry, one session, three overlays | none directly; drives the three chrome components and writes `body { cursor }` | per raw move: 4 applies via the ghost; per rAF frame: 1 `elementsFromPoint` + 1 `getElementById` (dead-indicator detach) + 0 writes | over-built | F10.1, F10.3, F10.7, F10.8, F10.9 |
| `DragGhost` | Follow-the-cursor preview above every overlay | one fixed, translucent, shadowed div; optional `Text` child (never used) | 4 inline applies (`left`,`width`,`top`,`height`) per raw mousemove, 2 unchanged; `doLayout` reads `getContentBounds()` unconditionally | mismatch | F10.1, F10.8 |
| `DragFeedback` | Valid/invalid tint over the hovered drop target | one absolute div (only when a target does *not* suppress the tint) | 0 while suppressed; 1 `getElementById` per `detach()` on a never-rendered instance | fits (over-built for dock targets) | F10.3 |
| `DropZoneOverlay` (+ nested `DropZoneHighlight`) | Full-bleed "this region accepts a dock" tint plus one moved band marking the drop zone | two absolute divs, appended raw into the region element | per drag frame: 2 `getParentElement` reads, 0 writes; per zone change: 2 applies | fits | F10.6 |
| `ReorderIndicator` | 2 px insertion bar between rows during a drag-reorder | one absolute div — never attached in production | per drag frame: 1 `getElementById` via `detach()` | dead | F10.3 |
| `Rail` | Persistent edge-anchored launcher strip hosting drawer/window handles | one fixed strip, a raw-appended `CollapseButton`, one `#id` `StyleRule` for the chevron | per resize event: 1 `getViewportSize` + 19 `getPreferredSize` across the subtree (6 handles), 0 writes | over-built | F10.5, F10.10, F10.11 |
| `RailHandle` | Flat-chromed `Button` with a `.selected` wash mirroring drawer/window state | inherits `Button`'s; class-tier rules shared across instances | none of its own beyond `Button` | fits | — |
| `Drawer` | Edge-anchored overlay panel that slides in and out | one fixed panel; a `DialogBackdrop` when modal | closed: **zero** (no element, no listener). Open: 1 `getViewportSize` per resize event, 0 writes when unchanged (probe P6) | fits | F10.11, F10.13 |

## Redundant, duplicated and dead code

Items not already covered by a finding above.

- **`Rail.unregisterDrawer` has no caller.** `grep -rn "unregisterDrawer"
  packages/lib/src` → 1 (its own declaration); `packages/lib/tests` → 0;
  `packages/docs/src` + `packages/create-app` → 0; `/home/jika/typescript/loom/src`
  → 0. It is documented public API (`docs/components/Rail.md` § "Hosting
  drawers") and is the only way to undo `registerDrawer`, so it should stay —
  but it is completely untested, and it is the path that detaches the drawer's
  `open`/`close` subscriptions, so a regression there is a listener leak nobody
  would catch. Recommend a test, not a deletion.
- **`RailDrawerRegistration.alignEdge` has no caller.** `grep -rn "alignEdge"
  packages/lib/src` → 2 (the field declaration and the single read at
  `Rail.ts:928`); tests → 0; docs app / create-app → 0; Loom → 0. Documented in
  `docs/components/Rail.md`. Same verdict as above: keep, cover.
- **`DragManager.cancel()` has no in-library caller.** `packages/lib/src` → 0;
  `packages/lib/tests` → 3. It is the only path that ends a session without a
  `mouseup`, and it is the path F10.9's asymmetry is worst on. Nothing in the
  library offers Escape-to-cancel during a drag; that is a plausible missing
  feature rather than dead code, but the method is currently exercised only by
  tests.
- **`DropTargetOptions.feedbackHost` has no caller.** `grep -rn "feedbackHost"
  packages/lib/src` → 3 (declaration, one JSDoc cross-reference in
  `DragFeedback.ts:88`, and the single read at `DragManager.ts:471`); tests → 0;
  docs app / create-app → 0; Loom → 0. Documented at
  `docs/recipes/drag-and-drop.md:61`. It exists for a scrolling target
  (`TabBar`'s clip frame) — which sets `suppressValidityTint: true` and so never
  reaches the tint at all. The whole `if (host && host !== target)` branch in
  `DragFeedback.attachTo` (`:233-246`) is therefore unreachable today.
- **`DockOptions.emptyContent` / `setEmptyContent` / `getEmptyContent` are
  unused by the target app.** Loom: 1 hit (`setEmptyContent`), 0 for
  `emptyContent` / `getEmptyContent`. Well covered by tests (14 hits) and
  genuinely public; noted only so a future simplification pass knows the
  placeholder machinery (`showEmptyState` / `hideEmptyState` /
  `placeholderConstraints` / `mainRegionEmpty` / `rootTab`, ~90 lines) carries
  one real consumer.
- **`isSeedRegion()` allocates on every drag frame.** `layout/DockRegion.ts:221-224`
  calls `this._region.getComponents()` (a fresh array) and
  `getLayoutConstraints(child)` per child on every `onDragOver`, ahead of
  `computeZone`. Small, but it is in the per-frame drag chain and the result
  cannot change mid-gesture. → belongs to slice 06; recorded here because the
  chain runs through my slice.

## Cross-slice notes

- **→ 01 core-component-lifecycle: `Component.removeElement` resurrects a
  released element by id.** `core/Component.ts:1316-1320` calls `getElement()`,
  which at `:1284-1297` falls through to `DOM.source.getElementById(this.getId())`
  whenever `_element` is falsy — and caches `null`, so the lookup repeats on
  every subsequent call. `release()` at `:1348-1353` deliberately reads the field
  directly with a comment warning about exactly this. Any per-frame `detach()`
  on a component that has no element therefore costs a document query; probe P3
  measured 20 for 10 detach pairs. Giving `removeElement` the same field-direct
  read fixes F10.3's read at the root and helps every other `removeElement`
  caller.
- **→ 01 core-component-lifecycle: `setX`/`setY` each write two properties as
  two separate `DOM.sink.apply` calls.** `writeHorizontalGeometry`
  (`core/Component.ts:4336-4346`) re-derives `width` from the origin, so a pure
  move re-writes an unchanged `width`; `InlineStyle.set`
  (`core/StyleTarget.ts:35-41`) has no last-value filter, so both reach the sink.
  This is the mechanism behind the briefing's confirmed "unbatched geometry sites
  pay 8 style applies for 4 values" finding, measured here at 4 applies per
  `moveTo` (probe P1). A same-value short-circuit in `writeHorizontalGeometry` /
  `writeVerticalGeometry` would halve every unbatched geometry write in the
  library, not just the ghost's.
- **→ 01 core-component-lifecycle / 05 layout-base: `canSkipUnchangedLayout` is
  inert for `Dock` too.** `Dock` is a `Container` with a `Fit` manager;
  `LayoutManager.commitBounds:567` calls `child.doLayout()` unconditionally, so
  the dock's region tree is re-laid-out on every frame of a resize even when the
  dock's own rectangle is identical. `Dock` is a safe candidate to opt in (it
  owns no geometry of its own beyond the single `Fit` child) once the base
  contract is honoured, but opting in today changes nothing.
- **→ 05 layout-base: confirmed at Dock scale.** Probe P8, one *identical*
  `doLayout` pass over a 3-panel dock: **265 `getPreferredSize`, 195
  `getMinSize`, 189 `getMaxSize`** — the briefing's "size hints have no memo"
  finding, reproduced on the target app's editor-area shape.
- **→ 02 core-component-styling: confirmed at Dock scale.** The same probe
  records **4 `DOM.sink.setRuleStyles` calls per identical pass** over a 3-pane
  dock (20 across 5 passes) — the `Split.commitPanes` / `Border.doLayout`
  `setClipPath` shape the slice-02 reviewer found, reaching the target engine as
  4 full-document restyles per resize frame in a Loom-shaped tree.
- **→ 06 layout-split-border-dockregion**: `DockRegion.onDragOver`
  (`layout/DockRegion.ts:68-82`) is the per-frame consumer of my slice's
  `DropZoneOverlay`. Its `computeZone` (`:238-239`) issues a
  `DOM.source.getViewportRect` for a rectangle the framework already holds in
  cached layout state; it lands immediately after `pickDropTarget`'s
  `elementsFromPoint` with no intervening write, so it is currently cheap — but
  it becomes a second forced layout the moment anything writes between them.
  `isSeedRegion()`'s per-frame array allocation is noted above.
- **→ 07 layout-tab-tabbar**: `TabBar.makeTabDropTarget` (`:3021`) declares
  `onDragOver: (detail) => number | null` and always returns `null`; narrowing
  the return type to `null` would make F10.3's claim (no target ever drives the
  reorder indicator) statically checkable. `TabBar.ts:2977` writes
  `TabDragData.label` that nobody reads (F10.8).
- **→ 09 overlay-windows-dialogs**: `overlay/Window.ts:165` calls
  `DragManager.makeDragSource(this._header, …)` and discards the teardown
  closure, exactly as `Dock.ts:448` does for its drop target (F10.4). The
  `dragSources` map (`DragManager.ts:194`) therefore retains every `Window` ever
  opened, and the header's `mousedown` subtree listener is never removed. Same
  fix shape.
- **Seam contract that does hold**: `DOM.sink.apply` genuinely batches a patch
  into one handle resolve, and `Component`'s four per-axis geometry setters
  genuinely guard on unchanged values — probe P4 recorded **0 sink ops** for five
  settled `DropZoneOverlay.attachTo` calls, and probe P5 recorded **0 sink ops**
  for ten unchanged `Rail` resize ticks. The waste in both cases is upstream of
  the setters, in re-deriving the values.

## Suggested plan grouping

1. **`drag-ghost-compositor-move`** — F10.1 alone. Self-contained, the largest
   user-visible win in the slice, measurable on its own (applies per raw
   mousemove; ms/frame during a tab drag over the editor grid). Optionally
   absorbs F10.8(a) — giving the ghost the dragged tab's label and size — since
   both touch `DragGhost`'s construction and `commitSession`. No dependencies.
2. **`drag-session-chrome-diet`** — F10.3 + F10.7 + F10.9, plus the F10.6
   parentage latch riding along. One coherent change to
   `DragManager`/`DropZoneOverlay`: build chrome lazily, type `ghostFactory`
   concretely, make gesture end symmetric with target change, latch the overlay's
   attachment. Depends on the `Component.removeElement` field-direct read (see
   Cross-slice notes) for its full benefit, but stands alone without it — the
   lazy construction removes the per-frame `detach()` either way. Measurable as
   `DOM.source` reads per drained drag frame.
3. **`dock-sweep-index`** — F10.2 + F10.12. One change set: hoist the region and
   float scans out of `reconcileHosts` into a single indexed walk, and collapse
   the two discriminators onto `instanceof`. F10.12 must be reconciled with the
   open `minification-safe-class-names` plan (which lists `Dock.ts`'s strip site
   as preserved) — sequence this **after** that plan lands, or coordinate the
   edit, rather than diverging silently. Measurable as `regionKind` /
   `allTabRegions` calls per sweep at 24 panels.
4. **`rail-thickness-memo`** — F10.5 + F10.10, plus F10.4's teardown fix riding
   along (F10.4 is two lines and belongs with whichever plan touches `Dock`
   next; it fits equally well in plan 3). Independent of everything else.
   Measurable as `getPreferredSize` calls per resize tick.
5. **Too small to plan; ride along with a neighbour**: F10.11 (two
   `setWillChange` calls in `Drawer` and `Rail` — attach to plan 4); F10.13 (four
   doc-link fixes — attach to whichever plan edits those files, or to a
   library-wide doc-link sweep alongside the 2026-08-29 audit's other four
   `DragManager` links); the `isSeedRegion` allocation (→ slice 06's plan); the
   `unregisterDrawer` / `alignEdge` test gaps (a test-only change, no plan).

Dependencies: 1, 3 and 4 are mutually independent and can land in any order. 2
is best sequenced after the `Component.removeElement` change from slice 01 if
that lands, but does not block on it. Nothing here contradicts
`dragmanager-pointer-coalescing` — that plan deliberately kept the ghost's
reposition inline and unthrottled, and F10.1 does not re-throttle it; it makes
the inline write cheap enough for that decision to hold.
