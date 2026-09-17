# 06 layout-split-border-dockregion — render-work review

Paths are relative to `packages/lib/src/typescript/lib/` unless stated.
Probe files live in `.worktrees/_probes/06-layout-split-border-dockregion/`
(`rulewrites.test.ts`, `rulewrites2.test.ts`, `dragnoop.test.ts`,
`hoverwalk.test.ts`, `borderfanout.test.ts`), run with the briefing's command.

## Summary

- **A steady-state layout pass through `Split` or `Border` mutates the shared
  stylesheet.** Probe: an unchanged whole-tree pass over a Loom-shaped
  `sidebar | 2×2 Split grid` writes **18 CSS-rule declarations**, every one of
  them the value that was already there; one gutter-drag frame on the same tree
  writes **14**. In the target engine any rule mutation invalidates style for
  the whole document, so this converts every resize/drag frame into a
  full-document restyle that would otherwise not happen. Two mechanisms:
  `clip-path` re-asserted per pane/region (F06.1) and the collapse chevron's
  per-instance `transform`/`width` rewritten per gutter (F06.2).
- **A gutter drag that is clamped at a pane's minimum still re-lays out both
  panes' whole subtrees, once per frame, forever.** Probe: three over-travel
  frames produced three `doLayout()` calls on each pane with zero geometry
  change. In Loom that is the full CodeMirror re-measure (~15–20 ms per visible
  editor) paid for nothing (F06.3).
- **`Split.recalculateSizes` re-runs its whole seed/rescale/pin/refill pipeline
  on every pass**, asking each pane for `getMinSize`/`getMaxSize` four times
  each per pass (probe: 4+4 per pane, plus 43 `getLayoutConstraints` and 19
  `paneDirection` calls for four panes), even when the container extent, the
  pane set and every constraint are unchanged (F06.4).
- **`Border.getPreferredSize` calls each region's `getMinSize` as well as its
  `getPreferredSize`**, so one unchanged `Border` pass costs **16 recursive size
  reports per edge region** (5 pref + 8 min + 3 max) — the largest single
  amplifier of slice 05's "size reports are never memoised" finding (F06.5).
- **`SplitGutter` is the only component in a Loom shell that registers a
  *subtree* `mouseover`/`mouseout` listener**, which makes every `mouseover`
  anywhere in the document walk the target's whole ancestor chain: probe shows
  16 `getId` + 15 `getParentElement` seam reads for one crossing on a 14-deep
  unrelated target (F06.7).

## Findings

### F06.1 `clip-path` is rewritten on the shared stylesheet for every pane and every region, on every layout pass

- **Category**: C (stylesheet-rule write on a hot path), B (unchanged-value write)
- **Impact**: HIGH — per frame on hot path 1, multiplied by every `Split` and
  `Border` in the subtree being laid out.
- **Where**:
  - `layout/Split.ts:2137-2148` (`commitPanes`, the `setClipPath` at `:2145`)
  - `layout/Split.ts:2000-2007` (the `clipPath: servingIdx >= 0 ? "inset(0 0 0 0)" : null` placement field)
  - `layout/Border.ts:744-765` (`applyRegionClip`)
  - `layout/Border.ts:1272`, `:1320`, `:1377`, `:1419` (`setClipPath(null)` on the non-collapsible branch of each edge)
  - `core/Component.ts:2798-2802` (`setClipPath` → `setElementCSSRule`, no guard)
  - `core/Component.ts:1893-1901` (`setElementCSSRule` → `_styleRule.queue` + `commitCSSRule`)
  - `core/StyleTarget.ts:61-64`, `:400-410` (`StyleTarget.queue` / `StyleRule.flushDirty`, no dedup)
  - `core/DOM.ts:1667-1692` (`ProductionDOMSink.setRuleStyles` → `writeDeclaration`, no dedup)
- **Hot path**:
  - `Body` resize / `Dock` pane resize / `Split.onDrag` → `pane.doLayout()`
  - → `LayoutManager.commitBounds` (`layout/LayoutManager.ts:546-569`) calls `child.doLayout()` unconditionally
  - → nested `Split.doLayout` (`layout/Split.ts:1885`) → `commitPanes` (`:2057`)
  - → `placement.component.setClipPath(placement.clipPath)` (`:2145`) — once per pane
  - → `Component.setElementCSSRule("clipPath", …)` → `commitCSSRule()` → `StyleRule.flush()`
  - → `DOM.sink.setRuleStyles(rule, { clipPath: … })` → `rule.style.clipPath = …`
  - and, in parallel, nested `Border.doLayout` → `setClipPath(null)` once per non-collapsible edge region, or `applyRegionClip` → `setClipPath("inset(0 0 0 0)")` once per collapsible one.
- **Evidence**: read the whole chain; no layer dedups. `StyleRule.flushDirty`
  only skips an *empty* bag, never an unchanged value; `writeDeclaration` assigns
  unconditionally. Probes (`rulewrites2.test.ts`):
  - `Q1` — 5-region non-collapsible `Border`, pass 2: `4` rule declarations,
    all `clipPath=null`, on regions that have never carried a clip.
  - `Q1b` — `Border` with one collapsible WEST region: `3` declarations
    (`clipPath=inset(0 0 0 0)` + 2 from F06.2).
  - `Q2` — 2-pane `Split` of styled panes, pass 2: `clipPath=inset(0 0 0 0)`
    on pane 0 and `clipPath=null` on the trailing pane — both branches write.
  - `Q3b` — unchanged whole-tree pass over `sidebar | 2×2 grid`: **18**
    declarations, 6 of them `clipPath`.
  - `Q3` — one gutter-drag frame on the same tree: **14** declarations.
  - Note: the write only reaches the sheet once the pane's `#id` rule is
    materialised (`Component.materialiseWhenNeeded`, `core/Component.ts:6613`).
    `P2` (bare `Component` regions, no declarations of their own) recorded `0`;
    `Q1` (regions with a `backgroundColor`, i.e. every real themed pane) recorded
    `4`. Loom's panes and regions are all in the second category.
- **Proposed change**: give `Component.setClipPath` the same
  cached-value guard `setTransition` (`core/Component.ts:5124-5133`) and
  `setWillChange` already have — store `_clipPath`, return early when unchanged.
  That is one edit and it fixes both managers plus every other caller. If a
  `Component`-level change is out of scope for the plan, the call-site
  alternative is to track the last-written clip per pane in `Split` (alongside
  `_collapsed`) and per placement in `Border`, and to hoist the two static
  values (`"inset(0 0 0 0)"`, `null`) out of the per-pass loop.
- **Risk / blast radius**: `setClipPath` callers are `Split.commitPanes`,
  `Border` (5 sites) and nothing else (grep `setClipPath(` over `packages/`: 7
  hits, all in these two files plus the `Component` definition). The collapse
  animation relies on the expanded keyframe being *present* before the transition
  starts, not on it being re-written: `CollapseSupport.primeCollapse`
  (`layout/CollapseSupport.ts:132`) installs the transition and the *next*
  `doLayout` writes the changed value, which a change-guard still writes. Tests
  that pin it: `tests/component/layout/Split.collapseUndisplay.test.ts`,
  `tests/component/layout/Border.collapseUndisplay.test.ts`,
  `tests/component/layout/CollapseAnimationTeardown.test.ts`.
- **Proof at implement time**: a probe asserting `ruleStyleWrites(sink).length
  === 0` for a second, unchanged `doLayout()` of the `sidebar | 2×2 grid` tree
  (today: 18) and of a 5-region `Border` (today: 4); then ms/frame on the 2×2
  editor-grid horizontal drag in a real WebKitGTK recording.

### F06.2 Every gutter rewrites its chevron's per-instance `transform` and `width` rules on every layout pass

- **Category**: C, B
- **Impact**: HIGH — three rule declarations per gutter per pass, on the same
  frames as F06.1.
- **Where**:
  - `component/container/CollapseButton.ts:219-223` (`applyRotation` → `createStyleRule("").set("transform", …)`, unguarded)
  - `component/container/CollapseButton.ts:237-243` (`setStripMode` → `createStyleRule("").set("width", …)`, unguarded)
  - `component/container/CollapseButton.ts:271-276` (`setDirection` → `applyRotation`, no unchanged-value check)
  - `component/container/SplitGutter.ts:364-400` (`setOpaque` → `setDirection` + `setStripMode`, runs its whole body even when `_opaque` is unchanged)
  - `component/container/SplitGutter.ts:418-428` (`setCollapseDirection` → `setDirection`)
  - `layout/Split.ts:2028` (`gutter.setOpaque(false)` — every expanded divider, every pass), `:2032` (`gutter.setCollapseDirection(...)`), `:1981-1982` and `:2091` (the collapsed-strip branch)
  - `layout/Border.ts:801` (`gutter.setOpaque(collapsed)` — every collapsible region, every pass)
- **Hot path**:
  - `…doLayout()` → `Split.doLayout` placement loop (`layout/Split.ts:2020-2035`)
  - → `gutter.setOpaque(false)` → `CollapseButton.setDirection(...)` → `applyRotation()` → `StyleRule.set("transform", …)` → `DOM.sink.setRuleStyles` (**1 rule write**)
  - → `CollapseButton.setStripMode(false)` → `StyleRule.set("width", null)` (**2**)
  - → back in the loop, `gutter.setCollapseDirection(...)` → `CollapseButton.setDirection(...)` → `applyRotation()` again (**3**)
- **Evidence**: `StyleRule.set` (`core/StyleTarget.ts:35-41`) writes through to
  `DOM.sink.setRuleStyles` the moment the rule is materialised; `createStyleRule`
  (`core/Component.ts`) returns a cached rule, so the target is always
  materialised after first render. Probe `P1` recorded exactly
  `transform, width, transform` per gutter per pass (`rulewrites.test.ts`); `Q2`
  and `Q3` reproduce it with 1 and 3 gutters. `SplitGutter.setOpaque`'s other
  effects are already idempotent — `setBackgroundColor`
  (`core/Component.ts:2656-2664`), `setStyleState` (`:6213-6217`),
  `setCursor` (`:2974-2980`) and `updateTooltip`
  (`component/container/SplitGutter.ts:434-472`) all guard on the current value.
  The two `CollapseButton` writers are the only unguarded ones.
- **Proposed change**: early-return in `CollapseButton.setDirection` when
  `_direction === direction`, and track `_stripMode` in `CollapseButton` so
  `setStripMode` early-returns on an unchanged flag. Optionally also early-return
  in `SplitGutter.setOpaque` when `_opaque === value` — safe, because
  `setCollapseDirection` re-applies the chevron on its own path and every other
  effect in the method is already idempotent — but the `CollapseButton` guards
  alone remove all three writes.
- **Risk / blast radius**: `CollapseButton.setDirection` callers:
  `SplitGutter.setOpaque`, `SplitGutter.setCollapseDirection`, the constructor's
  options bag. `setStripMode` caller: `SplitGutter.setOpaque` only. Pinned by
  `tests/component/container/CollapseButton.test.ts` ("round-trips setDirection",
  "writes the strip width when filled and removes its own width entry when not")
  — both assert the *resulting* rule contents after a change, so a no-change
  guard does not disturb them.
- **Proof at implement time**: rule declarations per frame under a `count=1`
  gutter in the same probe as F06.1 — today 3 per gutter, target 0; combined with
  F06.1 the whole-tree pass should reach 0.

### F06.3 A gutter drag clamped at a pane's minimum still re-lays out both panes' subtrees every frame

- **Category**: D (avoidable layout pass), E (work for content nothing changed for)
- **Impact**: HIGH — per frame for the whole duration of any over-travel, and
  the cost is a full editor re-measure per visible editor in the two panes.
- **Where**: `layout/Split.ts:1334-1397` (`onDrag`), specifically the
  unconditional `lhs.doLayout()` / `rhs.doLayout()` at `:1387-1393`.
- **Hot path**:
  - `SplitGutter.onDrag` (`component/container/SplitGutter.ts:637-648`) → `emit("drag")`
  - → `Split.scheduleDrag` (`layout/Split.ts:1412`) → rAF → `flushDrag` (`:1425`) → `Split.onDrag` (`:1334`)
  - → `newLhs` is clamped to `loLhs`/`hiLhs` (`:1370-1371`), so `dragAmount === 0` (`:1373`)
  - → `lhs.setWidth(newLhs)` / `rhs.setWidth(newRhs)` / `setX` are all no-ops (guarded in `Component.setWidth` `:4055-4070` and `setX` `:4271-4285`)
  - → `lhs.doLayout()` and `rhs.doLayout()` run anyway, each cascading the whole subtree through `LayoutManager.commitBounds`'s unconditional `child.doLayout()`.
- **Evidence**: probe `R1` (`dragnoop.test.ts`): after the left pane hit its
  200 px minimum, three further drag frames left `left.getWidth()` at 200 and
  still recorded `doLayout` 3× on the left pane and 3× on the right pane.
  This is also the frame shape a user produces constantly — the natural gesture
  is to drag a sidebar shut, which parks the pointer past the minimum.
- **Proposed change**: in `onDrag`, capture the panes' pre-write main extents,
  and skip the `doLayout()` call for a pane whose extent (and, for `rhs`, position)
  did not change. The information is already computed: `dragAmount === 0` implies
  the lhs did not move and, since `total` is conserved, neither did the rhs — one
  early return covers the whole frame. (`onDrag` intentionally does not use
  `applyBounds`, so the `canSkipUnchangedLayout` contract cannot help here; the
  check has to be explicit.)
- **Risk / blast radius**: `onDrag` is called only from `flushDrag`, and
  `flushDrag` only from the rAF and `onDragEnd`. `Split.test.ts` exercises drag
  clamping through the stored sizes, not through layout-call counts, so nothing
  pins the redundant pass. The one behaviour to preserve: `_sizes.set` must still
  run (it already does, before the `doLayout` calls).
- **Proof at implement time**: extend probe `R1` to assert 0 `doLayout` calls
  across the three over-travel frames; then ms/frame on a real WebKitGTK
  recording of a sidebar drag held past the minimum.

### F06.4 `Split.recalculateSizes` recomputes the entire size distribution on every pass, with unchanged inputs

- **Category**: D
- **Impact**: HIGH — per frame on hot path 1, and the cost is recursive
  (`getMinSize`/`getMaxSize` on a pane descend into its whole subtree).
- **Where**: `layout/Split.ts:2283-2530` (`recalculateSizes`), called
  unconditionally from `doLayout` at `:1955`. The repeated size reads:
  - `:2348` — the re-clamp loop, `clampMain` (`:843`) → `paneMinSize` + `paneMaxSize`
  - `:2492`/`:2494` — the pin classification, `isPinnedMain` (`:862`) → min + max again
  - `:2538` — the refill loop, `isPinnedMain` a third time
  - plus `LayoutManager.resolveBounds` (`layout/LayoutManager.ts:383-390`) reading
    `getPreferredSize`/`getSize`/`getMaxSize`/`getMinSize` and discarding all four
    because `Split` always passes `FillType.BOTH`
- **Hot path**: `Split.doLayout` (`:1885`) → `recalculateSizes` (`:1955`) →
  the four loops above → per pane, `Component.getMinSize()`/`getMaxSize()` →
  the pane's own `LayoutManager.getMinSize/getMaxSize` → its children's reports.
- **Evidence**: probe `P3` (`rulewrites.test.ts`), 3-pane `Split`, one unchanged
  pass, per pane: `getPreferredSize` 1, **`getMinSize` 4, `getMaxSize` 4**,
  `doLayout` 1. Probe `Q5` (`rulewrites2.test.ts`), 4-pane `Split`, one unchanged
  pass: `recalculateSizes` 1, `clampMain` 4, `isPinnedMain` 8,
  `isResizePinnedMain` 8, `paneServingGutter` 4, `paneDirection` **19**,
  `getLayoutConstraints` **43**, `getContentInsets` 1. Nothing in the pipeline is
  gated: the resize block at `:2465` is skipped when `available ===
  _lastAvailableMain`, but the prune loops, `seedFromPreferred`, the re-clamp
  loop, the three-tier classification and the refill all run regardless.
- **Proposed change**: gate the whole pipeline on a cheap change signature —
  `available`, `components.length`, and the identity/order of the pane list —
  mirroring the clamp-signature gate the merged `scroll-strip-deferred-resync`
  plan uses for `ScrollStrip.layoutItems`. The re-clamp loop exists for a live
  min/max change that does not move `available`; make it participate in the
  signature by caching each pane's last-seen `[min, max]` pair (one read per pane
  per pass instead of four) and re-running only when one differs. Fold
  `isPinnedMain`'s two reads into that same cached pair so the classification and
  refill loops read the cache rather than the component. Separately, hoist the
  `paneServingGutter`/`paneDirection`/`getLayoutConstraints` results into one
  per-pass array instead of re-deriving them 19/43 times.
- **Risk / blast radius**: `recalculateSizes` is public and called by `doLayout`
  only (grep `recalculateSizes`: 2 hits in `packages/`, both in `Split.ts`).
  `tests/component/layout/Split.test.ts` has ~40 cases pinning weight pinning,
  seeding, live min/max and refill behaviour — the gate must not skip a pass
  whose min/max changed, which is exactly what the cached pair covers.
- **Proof at implement time**: a probe asserting ≤ 1 `getMinSize` and ≤ 1
  `getMaxSize` per pane per unchanged pass (today 4 and 4), and unchanged results
  across the existing `Split.test.ts` weight/seed/refill suite.

### F06.5 `Border.getPreferredSize` reads each region's minimum as well as its preferred, multiplying an already-unmemoised report

- **Category**: D
- **Impact**: HIGH — per pass, multiplied by the number of `Border`s in the tree
  (Loom's shell, `Header`, `Dialog`, `MarkdownDocumentPanel` and both table
  panels all use one).
- **Where**: `layout/Border.ts:857-930` (`getPreferredSize`, calling
  `regionMinSize` at `:884`, `:893`, `:902`, `:919` on top of
  `regionPreferredSize`), `:939-1020` (`getMinSize`), `:1090-1150`
  (`computeTotalMinSize`), and `doLayout`'s own second round of
  `regionPreferredSize`/`regionMinSize` reads at `:1236/:1241`, `:1288/:1293`,
  `:1336/:1340`, `:1345/:1350`.
- **Hot path**: host `LayoutManager.resolveBounds` → `container.getPreferredSize()`
  → `Border.getPreferredSize` → per region `getPreferredSize()` **and**
  `getMinSize()` → the region's own manager → its children — repeated for every
  one of the 4–8 size-report re-entries slice 05 measured per child per pass.
- **Evidence**: probe `T1` (`borderfanout.test.ts`), 5-region `Border` inside a
  `VBox` host, one unchanged pass. Per edge region: `getPreferredSize` **5**,
  `getMinSize` **8**, `getMaxSize` **3**, `doLayout` 1; centre region 4/3/3.
  `Border.getPreferredSize` itself ran 4× and `Border.getMinSize` 3× in that one
  pass. That is 76 recursive size computations for a layout nothing changed in.
- **Proposed change**: this is slice 05's memoisation problem with `Border` as
  the largest amplifier; the local half is to compute each region's
  `{preferred, min, max}` triple **once per pass** into a small per-pass record
  and have `getPreferredSize`, `getMinSize`, `computeTotalMinSize` and `doLayout`
  read that record. A pass-scoped cache invalidated by `LayoutManager`'s existing
  dirty signal is enough; it does not need the general memoisation slice 05 will
  propose, and it composes with it.
- **Risk / blast radius**: all four readers are internal to `Border`;
  `regionPreferredSize`/`regionMinSize`/`regionMaxSize` (`:594`, `:607`, `:623`)
  already interpose the collapsed-content snapshot, so they are the natural cache
  point. Pinned by `tests/component/layout/Border.test.ts` (min-floor,
  middle-row aggregation, overflow inflation) and
  `tests/component/layout/Border.collapseUndisplay.test.ts` (the snapshot
  substitution).
- **Proof at implement time**: a probe asserting ≤ 1 `getPreferredSize` and ≤ 1
  `getMinSize` per region per pass (today 5 and 8).

### F06.6 `setClipFrame` writes four unchanged inline properties one at a time per region per pass, and every commit ends with an empty `apply`

- **Category**: B, G (seam round-trip churn)
- **Impact**: MEDIUM — per pass per region; 30 seam writes for a no-op 5-region
  `Border` pass, of which 10 do nothing at all.
- **Where**:
  - `core/Component.ts:` `setClipFrame`'s `this._clipFrameStyle.setMany({left, top, width, height})` — `InlineStyle` is materialised, so `StyleTarget.set` (`core/StyleTarget.ts:35-41`) writes each key through as its own `DOM.sink.apply`, with no unchanged-value check
  - `core/StyleTarget.ts:449-457` (`InlineStyle.flushDirty` — unlike `StyleRule.flushDirty` at `:403-409`, it does **not** early-return on an empty bag)
  - `layout/Border.ts:1273`, `:1321`, `:1378`, `:1420`, `:1442` (the five `setClipFrame` calls per pass)
  - `layout/LayoutManager.ts:546`/`:569` (`commitBounds`'s `setAutoCommitStyle(false/true)` pair, whose `true` half flushes an empty bag when nothing moved)
- **Hot path**: `…doLayout()` → `Border.doLayout` → per region
  `setClipFrame(x, y, w, h)` → 4 × `DOM.sink.apply(frameHandle, {style:{one key}})`
  → then `commitBounds(region, 0, 0, w, h)` → `setAutoCommitStyle(true)` →
  `commitElementStyle()` → `InlineStyle.flush()` → `DOM.sink.apply(handle,
  {style:{}})` with an empty patch.
- **Evidence**: probe `Q1` (`rulewrites2.test.ts`) — 5-region `Border`, pass 2:
  **30** `apply` calls, of which **10** are `{"style":{}}`; the other 20 are the
  four clip-frame geometry properties per region written individually with the
  values they already hold. Probe `P2b` shows the same shape with bare
  components (25 applies, 5 of them empty). `Q3` shows 5 empty applies per
  gutter-drag frame.
- **Proposed change**: two independent one-liners. (a) In `InlineStyle.flushDirty`,
  mirror `StyleRule.flushDirty`'s empty-bag early return — that removes the empty
  `apply` from every `commitBounds` in the library, not just this slice's.
  (b) Make `setClipFrame` `queue` its four properties and `flush()` once (one
  `apply` instead of four), and skip the write entirely when the rect matches the
  last one written (cache it beside `_clipFrame`).
- **Risk / blast radius**: `setClipFrame` callers are `Border` (5) and
  `Grid.doLayout` (`layout/Grid.ts:1111`). `InlineStyle.flushDirty` is on every
  component's commit path — the change is a pure no-op removal, but it is a
  `core` edit, so it belongs with slice 02/03's plan rather than this one.
- **Proof at implement time**: a probe asserting 5 `apply` calls (down from 30)
  for an unchanged 5-region `Border` pass, and 0 patches equal to `{style:{}}`
  across an unchanged whole-tree pass.

### F06.7 `SplitGutter` registers subtree `mouseover`/`mouseout`, so every mouseover in the document walks the target's ancestor chain

- **Category**: G (listener churn / global routing cost), A-adjacent (per-pointer-event reads)
- **Impact**: MEDIUM — per `mouseover`/`mouseout` boundary crossing anywhere in
  the app, at ~2 seam reads per DOM level of the target's depth.
- **Where**:
  - `component/container/SplitGutter.ts:230-231` (the two `Event.addSubtreeListener` calls)
  - `core/Event.ts:295-345` (the dispatcher's subtree phase: a `while (handle)` walk doing `DOM.source.getId(handle)` then `DOM.source.getParentElement(handle)` per level)
- **Hot path**: native `mouseover` → the single window-level base listener
  (`core/Event.ts:248`) → exact-target phase (O(1)) → **subtree phase**: because
  `subtreeListenerMap.get("mouseover")` is non-empty, the walk runs for *every*
  mouseover regardless of where it happened, climbing the target to the root.
- **Evidence**: probe `S1` (`hoverwalk.test.ts`) — one `mouseover` on a 14-deep
  subtree that has nothing to do with any gutter cost **16 `getId` + 15
  `getParentElement` + 1 `intern`**. Grep over `packages/`: only three classes
  register subtree `mouseover` (`SplitGutter`, `overlay/Notification.ts:249`,
  and — for `mouseout` only — `component/chart/AbstractChart.ts:190` and
  `component/diagram/DiagramView.ts:1821`). In a Loom shell with no toast, no
  chart and no diagram, `SplitGutter` is the sole reason the ancestor walk runs
  at all. These are property reads, not forced layout, so the per-crossing cost
  is microseconds — but it is paid on every crossing across the whole editor
  surface, and it is entirely avoidable.
- **Proposed change**: `SplitGutter`'s only descendant is `_collapseButton`, a
  real `Component` with its own id. Replace the two subtree registrations with
  four exact-target ones — `Event.addListener(this, …)` and
  `Event.addListener(this._collapseButton, …)` for both types — keeping
  `containsEventTarget`'s `relatedTarget` filter as-is. The precedent is in the
  same class: `updateTooltip` already attaches `Tooltip` to both the gutter and
  the chevron (`component/container/SplitGutter.ts:466-471`), and `Tooltip.attach`
  uses exact-target registration.
- **Risk / blast radius**: the hover behaviour is pinned by
  `tests/component/container/SplitGutter.hover.test.ts` (7 cases) and
  `SplitGutter.hoverSubtreeRouting.test.ts` — the latter exists specifically to
  pin the chevron-crossing case, so it is the regression gate for this change.
  Note `_collapseButton` is created after `super()` but before the listener
  wiring block, so the registration order already works.
- **Proof at implement time**: re-run probe `S1` and assert 0 `getParentElement`
  calls for a mouseover on an unrelated target (today 15); confirm
  `SplitGutter.hoverSubtreeRouting.test.ts` still passes.

### F06.8 `DockRegion.computeZone` forces a `getBoundingClientRect` on every coalesced drag frame for a rectangle that cannot change

- **Category**: A (forced sync read on a hot path)
- **Impact**: MEDIUM — once per animation frame for the whole duration of a tab
  drag over a dock region.
- **Where**: `layout/DockRegion.ts:238-240` (`computeZone`'s
  `DOM.source.getViewportRect(this._region)`), reached from `:68-77`
  (`onDragOver`) via `:211` (`dropZone`).
- **Hot path**:
  - `mousemove` → `DragManager.scheduleMove` (`overlay/DragManager.ts:506`) → rAF → `flushMove` (`:524`)
  - → `pickDropTarget` (already forces a layout via `elementsFromPoint`)
  - → `target.options.onDragOver(detail)` → `DockRegion.dropZone` → `computeZone`
  - → `DOM.source.getViewportRect(region)` → `getBoundingClientRect()` — after the drag ghost's transform write earlier in the same frame, so it flushes style+layout for the document.
- **Evidence**: read the chain. `DragManager`'s own JSDoc
  (`overlay/DragManager.ts:495-499`) names this read as one of the two reasons
  the merged `dragmanager-pointer-coalescing` plan exists, so the frequency is
  already down to once per frame — but the *read itself* was left in place, and
  the region's viewport rect cannot change during a drag: nothing in the drag
  path lays the dock out, and the two things that could (a spring-loaded window
  raise, `:171`; a scroll) are both observable. `attachTo`
  (`overlay/DropZoneOverlay.ts`) additionally does two `DOM.source.getParentElement`
  reads per frame for a parent that only changes on the first frame.
- **Proposed change**: cache the region rect for the duration of one drag
  session — populate it on the first `onDragOver` (or on `DragManager`'s
  drag-start broadcast) and clear it in `onDragLeave`/`onDrop`. Guard the
  `attachTo` parent check with an "already attached to this region" flag. Both
  are `DockRegion`-local.
- **Risk / blast radius**: `computeZone` is used by `dropZone`, which both the
  hover overlay and the commit guard call, so feedback and behaviour stay in
  step as long as the cache is per-session. `isSeedRegion` and `isLegalDrop`
  also run per frame and allocate (`getComponents()` + a closure each); they are
  pure JS and cheap by comparison. No test pins the rect read
  (`tests/layout/DockRegion.styleRuleDisposal.test.ts` is about rule teardown).
- **Proof at implement time**: a probe spying on `DOM.source.getViewportRect`
  across N simulated `onDragOver` calls — today N, target 1.

### F06.9 The collapse animation commits and re-lays-out every participant every frame, including participants that do not move

- **Category**: E, D
- **Impact**: MEDIUM — ~12 frames per toggle, each frame paying a full subtree
  layout per content-bearing pane.
- **Where**: `layout/CollapseSupport.ts:380-395` (`animateLayout`'s `frame`),
  `:315-330` (`commitRect`, whose `doLayout()` is unconditional when
  `relayout` is true), `:471-500` (`runCollapse`), and the participant lists at
  `layout/Split.ts:487-491` (every pane + every gutter) and
  `layout/Border.ts:` `setRegionCollapsed`.
- **Hot path**: `setPaneCollapsed` → `runCollapse` → `animateLayout` → rAF
  `frame` → per mover `commitRect(lerpRect(start, end, eased), relayout)` →
  `component.doLayout()` → the mover's whole subtree.
- **Evidence**: read the loop; there is no `start`-equals-`end` check and no
  per-frame change check. `commitRect`'s own geometry setters are all guarded
  (`setX` `core/Component.ts:4271`, `setWidth` `:4055`, `setTranslate`,
  `setWillChange` `:5090`), so a non-moving mover writes nothing — but
  `doLayout()` still runs. Probe `R3` (`dragnoop.test.ts`): one animation frame
  of a 3-pane collapse ran `doLayout` once on each of the three panes and issued
  8 `apply` calls; in a nested tree those `doLayout` calls carry the F06.1/F06.2
  rule writes with them. `runCollapse` also primes a `background-color`
  transition on **every** gutter (`:484`) although, as its own comment admits,
  only the toggling gutter's colour changes.
- **Proposed change**: in `animateLayout`, drop movers whose `start` and `end`
  rects are equal from the per-frame loop (keep them in the list for the final
  `end` commit, or simply commit them once up front). In `runCollapse`, narrow
  the `background-color` prime to the gutter that actually changes state — the
  caller already knows which one, since `Split.doLayout`/`Border.updateRegionGutter`
  decide it.
- **Risk / blast radius**: `animateLayout` is used only by `runCollapse`, itself
  used only by `Split.setPaneCollapsed` and `Border.setRegionCollapsed`. Pinned
  by `tests/component/layout/CollapseSupport.test.ts` (translate-fold),
  `CollapseAnimationTeardown.test.ts`, and
  `Split.collapseUndisplay.test.ts`'s "A sibling's toggle does not prime the
  cross-fade on a collapsed-and-undisplayed pane" — which is already asserting a
  narrower prime set, so narrowing further is in the direction that test points.
- **Proof at implement time**: a probe counting `doLayout` calls per animation
  frame for a collapse where one pane is weight-pinned (today: every pane).

### F06.10 `Split` and `Accordion` still mirror the same drag, clamp and weight-pin mechanics — health-audit Priority 2 #4 is still open

- **Category**: I (duplication)
- **Impact**: LOW (code health) — but it is the reason F06.3's fix has to be
  written twice, and the reason the two surfaces drift.
- **Where** — concrete method pairs:

  | `Split.ts` | `Accordion.ts` | what is duplicated |
  |---|---|---|
  | `scheduleDrag` `:1412-1418` | `scheduleGutterDrag` `:1975-1981` | identical rAF-buffer-latest-position, identical field pair (`_pendingDrag`/`_dragRafHandle` vs `_pendingGutterDrag`/`_dragRafHandle`) |
  | `flushDrag` `:1425-1437` | `flushGutterDrag` `:1988-2000` | byte-for-byte the same body modulo the payload shape |
  | `onDragEnd` `:1449-1458` | `onGutterDragEnd` `:2018-2036` | cancel-rAF, synchronous flush, emit the commit-grained event |
  | `clampMain` `:843-850` | `clampSectionHeight` `:2279-2284` | `Util.clamp(value, min?.axis ?? 0, max?.axis ?? +∞)` on one axis |
  | `effectiveResizeWeight` `:830-832` + `isResizePinnedMain` `:885-887` | `effectiveWeight` `:2229-2233` | weight resolution with a different fallback convention (`Split` distinguishes unset from explicit `0`; `Accordion` collapses both to `0`) |
  | the three-tier refill `:2482-2547` | `resizePinnedSections` `:2250-2277` | "hold the pins, rescale the flexible, yield the pins when the budget cannot cover them" |
  | `onDragStart` `:1292-1308` | `onGutterDragStart` `:1808-1858` | capture drag origin + adjacent extents |

- **Evidence**: read both files. The audit's sub-item about Accordion's
  viable-listener workaround is **closed**: `grep -n
  "beginViewportDrag\|endViewportDrag\|mouseup" layout/Accordion.ts` returns
  nothing, and `Accordion.getOrCreateResizeGutter` (`:1766`) now uses
  `gutter.on("dragend", …)` like `Split` does.
- **Proposed change**: extract the *drag-frame buffer* first — it is the
  smallest, most literal duplicate and the one both F06.3 and any future
  coalescing work touches: a tiny `RafDragBuffer<T>` helper (`schedule(payload)`,
  `flush()`, `cancel()`) owned by `layout/` and used by both managers. Leave the
  clamp/weight mechanics alone for now: the two conventions genuinely differ
  (`Split`'s unset-vs-`0` distinction is load-bearing for
  `paneSizeUnits`/`getPaneSizes`), so unifying them is a behaviour question, not
  a refactor, and belongs in the open scope question the audit already recorded.
- **Risk / blast radius**: the buffer extraction touches
  `Split.scheduleDrag`/`flushDrag`/`onDragEnd`/`detach` and the Accordion
  equivalents including `detach`. `tests/overlay/DragManager.pointerCoalescing.test.ts`
  and `tests/component/layout/Accordion.resizable.test.ts` are the gates.
- **Proof at implement time**: the existing coalescing tests pass unchanged; line
  count in the two managers drops by the extracted body.

### F06.11 Per-pass allocation churn in the `Split` layout and drag paths

- **Category**: G
- **Impact**: LOW individually, but all of it is per frame on hot path 1.
- **Where**:
  - `layout/Split.ts:1336-1337` — `container.getLaidOutComponents()` called **twice** per drag frame (each call is `_components.filter(...)`, `core/Component.ts`'s `getLaidOutComponents`), plus `this._gutters.indexOf(gutter)`
  - `layout/Split.ts:1294-1295` — the same double call in `onDragStart`
  - `layout/Split.ts:2301`, `:2322` — `[...this._sizes.keys()]` and `[...this._weights.keys()]` allocated per pass, each entry then doing `components.indexOf(pane)` (O(n²))
  - `layout/Split.ts:1892` and `:2289` — `container.getInnerSize()` called twice per pass (each allocates a `Size` and a `PerimeterSize`)
  - `layout/Split.ts:1915` — `container.getContentInsets()`, which allocates a fresh `Insets` **with a UUID** per call (slice 28's finding); `Border.ts:1198` does the same
  - `layout/Split.ts:2010` / `:2011` — a `Set<number>` and a `SplitPlacement[]` per pass; `:2233` — a `Map<Component, number>` per pass
  - `layout/Border.ts:541` — a fresh `[NORTH, SOUTH, WEST, EAST]` array plus a `retained[]` per pass
  - `core/Component.ts:3339-3344` — `getSize()` allocates a new object, and `getWidth()`/`getHeight()` each go through it; `LayoutManager.commitBounds` calls both per child per pass
- **Hot path**: all of the above sit inside `Split.doLayout` / `Split.onDrag` /
  `Border.doLayout`, which run once per frame during a resize or drag.
- **Evidence**: probe `R2` (`dragnoop.test.ts`) recorded 2
  `getLaidOutComponents` calls for one drag frame; probe `Q5` recorded 1
  `getContentInsets` per `Split` pass. The rest is read directly from the source.
- **Proposed change**: hoist `getLaidOutComponents()` to one call per
  `onDrag`/`onDragStart` invocation; pass the already-computed `containerSize`
  into `recalculateSizes` instead of re-reading it; replace the two prune loops'
  `indexOf` with a `Set` built once from `components`. The `Insets`/`Size`
  allocations belong to slices 01/28.
- **Risk / blast radius**: all local to `Split`/`Border`; no test depends on the
  number of calls.
- **Proof at implement time**: allocation counters in the existing layout-economy
  probe style (`tests/component/tree/ResizeLayoutEconomy.test.ts` is the precedent).

### F06.12 `SplitGutter.applyHoverState` calls `matchMedia` on every hover boundary and every drag start/stop

- **Category**: A (a live environment read on a pointer path), B
- **Impact**: LOW — per boundary crossing over a gutter, not per `mousemove`.
- **Where**: `component/container/SplitGutter.ts:719-722` (`applyHoverState` →
  `Animation.isReducedMotion()` → `DOM.source.matchMedia(...)`, `core/Animation.ts`),
  called from `:338` (`setMovable`), `:607`/`:623` (`onDragStart`/`onDragStop`)
  and `:689`/`:705` (`onMouseOver`/`onMouseOut`).
- **Hot path**: `mouseover` on the gutter → `onMouseOver` → `applyHoverState` →
  `matchMedia("(prefers-reduced-motion: reduce)")` → `.matches`.
- **Evidence**: probe `Q4` (`rulewrites2.test.ts`): one hover enter costs 2
  `apply` calls (the transition write and the class toggle) and 0 rule writes; a
  repeat enter costs 0; a leave costs 1 — so the *write* side is properly
  guarded. Only the `matchMedia` call is unconditional. The re-assert is
  deliberate (`primeCollapse` clears the transition, `:141-145`), so the call
  cannot simply be hoisted to construction; it should read a cached value.
- **Proposed change**: `Animation` should memoise the reduced-motion `MediaQueryList`
  and its `matches` behind a `change` subscription rather than re-querying per
  call — an `Animation`-level change (slice 11) that this and every other caller
  benefits from.
- **Risk / blast radius**: `Animation.isReducedMotion` has callers across the
  library; a cached value must still follow a live OS setting change, hence the
  `change` listener.
- **Proof at implement time**: a probe spying on `DOM.source.matchMedia` across
  N hover crossings — today N, target 1 for the process.

## Entity inventory

| Entity | Stated function | Owns DOM (elements, rules) | Per-layout-pass writes / reads | Verdict | Findings |
|---|---|---|---|---|---|
| `layout/Split.ts` — `Split` | "Splits the container into two or more resizable panels separated by draggable gutter elements" (`docs/layouts/Split.md`) | no element of its own; appends one `SplitGutter` per pane pair to the container's element (`:1949`) | per pane: 1 `clipPath` rule declaration, 4 `getMinSize`, 4 `getMaxSize`, 1 `getPreferredSize`, 1 unconditional `doLayout`; per gutter: 3 rule declarations + 4 inline geometry writes; per pass: 2 `getInnerSize`, 1 `getContentInsets`, 43 `getLayoutConstraints` (4 panes), 1 `Map` + 1 `Set` + 1 array | **over-built** on the write side — the collapse/weight/persistence machinery is justified by its docs, but none of the per-pass work is change-gated | F06.1, F06.2, F06.3, F06.4, F06.11 |
| `layout/Border.ts` — `Border` | "Divides a container into five named regions" (`docs/layouts/Border.md`) | no element; one lazily-created `SplitGutter` per collapsible edge | per region: 1 `clipPath` rule declaration, 4 unchanged inline clip-frame writes + 1 empty `apply`, 5 `getPreferredSize` + 8 `getMinSize` + 3 `getMaxSize`, 1 unconditional `doLayout`; per pass: 1 `getInnerSize`, 1 `getContentInsets` | **over-built** — the collapsible path is well-factored, but the *non*-collapsible path (the overwhelmingly common one: `Header`, `Dialog`, table panels) still pays a rule write and 20 inline writes per pass | F06.1, F06.5, F06.6 |
| `layout/DockRegion.ts` — `DockRegion` | "Turns an edge/center drop onto a region into a structural re-split or a tab add"; explicitly *not* a `Component` | none — owns a `DropZoneOverlay` and a drop-target registration only | **zero** — takes no part in any layout pass | **fits** — the class does exactly what its JSDoc says, and its structural methods (`splitOnEdge`, `dockAsTab`, `isRedundantEdgeDrop`) are all cold-path | F06.8 (drag-frame path only) |
| `layout/CollapseSupport.ts` | Shared collapse plumbing for `Split` and `Border`: prime the CSS transition, snapshot start/end, interpolate | none (operates on the caller's components) | per animation frame: per participant 1 `commitRect` (all setters guarded) + 1 unconditional `doLayout` when `relayout` | **fits**, with one gap — no start-equals-end skip, and the gutter cross-fade is primed on every gutter rather than the one that changes | F06.9 |
| `component/container/SplitGutter.ts` — `SplitGutter` | "A gutter shared by `Split` and `Border` that doubles as both a divider and a collapsed strip" | one `div`; the shared `.opaque` / `.hover` class-tier rules; raw-appends its `CollapseButton` | driven by the managers: `setOpaque`/`setCollapseDirection`/`setCollapsible` per pass (→ F06.2), 4 inline geometry writes; per hover boundary: 1–2 `apply`, 1 `matchMedia` | **fits** functionally; **over-built** on event wiring (a subtree listener for a component with one known child) | F06.2, F06.7, F06.12 |
| `component/container/CollapseButton.ts` — `CollapseButton` | "A small chevron button carried by a `SplitGutter` that triggers a collapse or a restore" | one `span`; the shared `.CollapseButton` class rule (module-level, once); one per-instance `#id` rule for `transform` and `width` | 2–3 rule declarations per gutter per pass, all unchanged | **mismatch** — a purely presentational 40×10 chevron is the slice's single largest source of stylesheet mutation, because neither of its two writers checks whether anything changed | F06.2 |

## Redundant, duplicated and dead code

Items not already covered by a finding. Greps were run over all of
`packages/` (lib src, lib tests, docs app, create-app), excluding `lib/dist`.

- **`SplitGutter.off` has zero callers.** `grep -rn "\.off(['\"](dragstart|drag|dragend|collapse|contextmenu)['\"]" --include=*.ts packages/` → 2 hits, both unrelated (`Split.off('paneresize')` in a test, `List.off('contextmenu')`). The `on`/`off`/`emit` triple is the library's uniform event shape, so this is convention rather than accident — flagging for completeness only. (J, LOW)
- **`CollapseButton.off` has zero callers.** Same grep, same result. (J, LOW)
- **`Split.getPaneSize` / `Split.setPaneSize` have no production callers.**
  `grep -rn "\.getPaneSize(" --include=*.ts --include=*.md packages/ | grep -v dist` → 86 hits, **all** in `packages/lib/tests/component/layout/Split.test.ts`.
  `grep -rn "\.setPaneSize(" --include=*.ts packages/ | grep -v dist` → 7 hits: 1 internal (`Split.applyPaneSizes` `:1218`) and 6 in the same test file. Both are documented public API (`setPaneSize`'s JSDoc names "an edge-drop dock" as the intended consumer, but `DockRegion` uses `transferPaneSize` instead). Keep, but the JSDoc's stated consumer does not exist. (J / H, LOW)
- **`SplitGutter._dispatchDrag` is a one-line indirection with one caller.**
  `component/container/SplitGutter.ts:578` is `this.emit("drag", position)`; its only caller is `onDrag` at `:645`. (`WindowBorder` has an unrelated method of the same name.) Inline it. (I, LOW)
- **`SplitGutterOptions.listeners` exposes only `collapse`**, not the five events `SplitGutter.on` accepts (`dragstart`, `drag`, `dragend`, `collapse`, `contextmenu`). Every real consumer (`Split.doLayout` `:1935-1946`, `Accordion.getOrCreateResizeGutter` `:1767-1769`) wires drag listeners imperatively, so the declarative bag is a partial surface that nothing can use for the events that matter. Either complete it or drop it. (H, LOW)
- **`SplitGutter._direction` is typed `String` (the boxed wrapper), not `string`**, and `SplitGutterOptions.orientation` is `string` rather than the `AxisOrientation` union `SplitOptions.orientation` uses (`layout/Split.ts:76`). `setDirection(direction?: String)` compares with `this._direction === "horizontal"` (`:186`, `:632`), which is correct only because the value is always a primitive in practice. (H, LOW — a correctness trap, not a render cost.)
- **Health-audit Priority 1 #7 is closed, not open.** The audit reported that
  `round-layout-coordinates` broke the gap-free-adjacency invariant
  `CollapseSupport` depends on. `Component.writeHorizontalGeometry`
  (`core/Component.ts:4338-4348`) now derives the width from
  `roundedExtent(this._left, this._width)` = `round(left + width) − round(left)`,
  which restores exactly that invariant. No seam can open between adjacent panes
  at fractional coordinates. Do not re-plan this.
- **Health-audit Priority 2 #4's `dragend` sub-item is closed.**
  `grep -n "beginViewportDrag\|endViewportDrag\|mouseup" layout/Accordion.ts` →
  0 hits; `Accordion` now consumes `SplitGutter`'s own `"dragend"` event
  (`layout/Accordion.ts:1769`). The rest of Priority 2 #4 is still open — see
  F06.10.

## Cross-slice notes

- **→ 01 core-component-lifecycle / 02 core-component-styling:**
  `Component.setClipPath` (`core/Component.ts:2798`) is the only geometry-adjacent
  style setter in the typed API with **no** unchanged-value guard, while its
  siblings `setTransition` (`:5124`), `setWillChange` (`:5090`), `setTranslate`,
  `setCursor` (`:2974`) and `setBackgroundColor` (`:2656`) all have one. Fixing it
  there fixes F06.1 for both managers at once. More generally, every
  `setElementCSSRule` caller inherits "no dedup at any layer"
  (`core/StyleTarget.ts:61`, `core/DOM.ts:1667`) — `setTransform` (`:3279`) has
  the same shape, which is what slice 27 reported for pan/zoom.
- **→ 02 / 03 core-dom-seam:** `InlineStyle.flushDirty`
  (`core/StyleTarget.ts:449-457`) does not early-return on an empty bag, so every
  `LayoutManager.commitBounds` that changes nothing still issues one
  `DOM.sink.apply(handle, {style:{}})`. Measured: 10 per unchanged 5-region
  `Border` pass, 5 per gutter-drag frame on a nested tree. `StyleRule.flushDirty`
  four lines below **does** have the guard — this is a one-line asymmetry.
- **→ 03 core-dom-seam-events:** `Event`'s subtree dispatch
  (`core/Event.ts:295-345`) walks the target's whole ancestor chain for *every*
  event of a type that has any subtree registration, with two seam reads per
  level. That cost is invisible to the registering component and unbounded in the
  target's depth. Worth a note in slice 03 regardless of F06.7's local fix.
- **→ 05 layout-base-box-flow-grid (confirming the earlier reviewer):** neither
  `Split` nor `Border` uses `Component.applyBounds`. `Split.commitPanes`
  (`layout/Split.ts:2137`) calls `LayoutManager.commitBounds` (or `commitRect`
  for a content-out pane); `Border` calls `commitBounds` and `placeComponent`.
  Both therefore re-lay-out every descendant on every pass, exactly as slice 05
  reported. `Split` also always passes `FillType.BOTH` to `resolveBounds`, so all
  four of the size reports `resolveBounds` takes (`layout/LayoutManager.ts:385-388`)
  are discarded — the common case that reviewer named.
- **→ 08 layout-accordion-…:** F06.10's table pairs `Split`'s drag/clamp/weight
  methods with `layout/Accordion.ts:1808`, `:1860`, `:1975`, `:1988`, `:2018`,
  `:2229`, `:2250`, `:2279`. Accordion also uses `SplitGutter`
  (`layout/Accordion.ts:1766`), so **F06.2, F06.7 and F06.12 apply to Accordion's
  gutters too** — Accordion constructs them with `collapsible: false`, which means
  its chevron is hidden but `setStripMode`/`setDirection` are still reachable
  through any `setOpaque` call. Accordion never calls `setOpaque`, so it pays
  F06.7 and F06.12 but not F06.2. Slice 08 should confirm.
- **→ 10 overlay-dock-drag-rail-drawer:** `DropZoneOverlay.attachTo`
  (`overlay/DropZoneOverlay.ts`) is called unconditionally on every coalesced
  drag frame by `DockRegion.onDragOver` (`layout/DockRegion.ts:72`) and does two
  `DOM.source.getParentElement` reads each time for a parent that only changes on
  the first frame. `setHighlight` is properly guarded; `attachTo` is not.
- **→ 11 overlay-popups-layers-animation:** `Animation.isReducedMotion()` is a
  live `matchMedia` call per invocation, reached from `SplitGutter.applyHoverState`
  (per hover boundary), `CollapseSupport.primeCollapse` and `animateLayout`
  (per collapse). Memoising it behind a `change` subscription is an `Animation`
  change with several beneficiaries.
- **→ 28 focus-navigation-…:** `Split.doLayout` and `Border.doLayout` each call
  `container.getContentInsets()` once per pass, which allocates a fresh `Insets`
  with a UUID — the allocation slice 28 measured. Two per frame per manager
  instance here; small on its own, real when multiplied by the managers in a tree.
- **Seam contract that does not hold for this slice:** `docs/concepts/layout-system.md`
  states that "a child handed the exact rectangle it already has is not
  re-laid-out". Neither manager in this slice gets that, for the reason slice 05
  gave; and `Split.onDrag` (`layout/Split.ts:1387-1393`) bypasses the bounds
  machinery entirely, so it cannot get it even if `commitBounds` were fixed —
  F06.3 has to be fixed at the call site.

## Suggested plan grouping

**Plan A — "zero stylesheet writes on a steady-state layout pass"** (F06.1 +
F06.2). One coherent change set with one measurable number: rule declarations per
unchanged `doLayout` pass, today 18 on the Loom-shaped tree and 14 per drag frame,
target 0. Three small edits: a cached-value guard in `Component.setClipPath`, and
unchanged-value guards in `CollapseButton.setDirection` and `setStripMode`.
Highest payoff per line in the slice, no dependency on any other slice. Measure
with the probe first, then with a WebKitGTK Timeline recording of the 2×2 grid
drag — this is the one finding whose real-engine effect should be confirmed
before the rest, because it decides whether the per-frame restyle disappears.

**Plan B — "a drag frame that changes nothing costs nothing"** (F06.3 + F06.11's
`onDrag` half). Skip the two `doLayout()` calls and the second
`getLaidOutComponents()` when the clamp absorbed the whole move. Independent of
Plan A, and the two compose: after both, an over-travel drag frame writes nothing
and lays nothing out. Small, self-contained, directly user-visible on the sidebar
gesture.

**Plan C — "size reports read once per pass"** (F06.4 + F06.5 + the rest of
F06.11). The `Split` change-signature gate and the `Border` per-pass region
record. These are the same idea applied to the two managers and should ship
together so the probe can assert "≤ 1 min/max read per child per pass" across
both. **Depends on slice 05** only in the sense that it should not contradict
whatever general memoisation that slice proposes — if slice 05 lands a
`Component`-level cache, Plan C shrinks to the `Split` gate alone; if it does
not, Plan C stands on its own. Sequence it after Plan A so the rule-write noise
is out of the measurement.

**Plan D — "pointer-path reads"** (F06.7 + F06.8, with F06.12 riding along if
slice 11 does not take it). Three unrelated-looking edits that share one measure:
seam reads per pointer event. `SplitGutter`'s exact-target listeners,
`DockRegion`'s per-session rect cache, `DropZoneOverlay.attachTo`'s attached flag.
Lowest risk in the slice; `SplitGutter.hoverSubtreeRouting.test.ts` is the gate.

**Plan E — "collapse animation frames"** (F06.9). One file
(`CollapseSupport.ts`), two edits (start-equals-end skip, narrow the gutter
cross-fade prime). Naturally paired with Plan A, since the animation frames are
where Plan A's rule writes currently multiply by 12.

**Rides along, too small to plan**: F06.6's `InlineStyle.flushDirty` guard
(one line — send it to slice 02/03's plan, since it changes a `core` seam every
component uses; the `setClipFrame` batching half can ride with Plan C, which
already touches `Border.doLayout`). F06.10's `RafDragBuffer` extraction should
ride with Plan B, which rewrites `Split.onDrag`'s frame path anyway and would
otherwise leave `Accordion` with the un-fixed copy. The dead-code items
(`SplitGutter.off`, `CollapseButton.off`, `_dispatchDrag`, the partial
`listeners` bag, the boxed `String` type) are a single tidy-up commit with no
measurement attached.
