# 05 layout-base-box-flow-grid — render-work review

**Summary**

- One unchanged layout pass over a 31-component shell-shaped tree (`Fit` → `Card` → `VBox(4)` → `HBox(6 leaves)`) costs **267 `getPreferredSize` + 263 `getMinSize` + 263 `getMaxSize` + 288 `getBaseline` = 1,081 size queries and 104 filtered-array allocations** — ~35 size queries per component per frame, none memoised, each one a fresh recursive descent of that child's subtree (probe S1). This is the dominant per-frame JS cost of hot path 1 in everything the Loom shell renders. (F05.2)
- `LayoutManager.resolveBounds` reads `getPreferredSize()`, `getSize()`, `getMaxSize()` and `getMinSize()` **before** it knows the fill mode, and discards all four whenever the resolved fill is `BOTH`. In a Loom-shaped `Fit`/`Card` chain and in a plain `HBox` row, **100 % of `resolveBounds` calls resolve to `BOTH`** (probe R1) — 4 discarded recursive size descents per child per frame, for free. (F05.1)
- No built-in layout manager routes through `Component.applyBounds`, so the documented "a child handed the exact rectangle it already has is not re-laid-out" contract covers **nothing outside the Table**. `commitBounds` calls `component.doLayout()` unconditionally; a second identical pass re-runs every descendant manager's full resolve (probe P4: 9/9 leaves re-laid-out). (F05.3)
- A track-less `Grid` — the default — runs a full per-child `measureContent` sweep in `getPreferredSize`, `getMinSize`, `getMaxSize`, `computeTotalMinSize` **and** `layoutOccupancy`, and never reads the result (probe R3). (F05.4)
- Two correctness holes reachable through the recently-merged undisplay work: an auto-sized `Grid` whose laid-out children drop to zero **throws `RangeError: Invalid array length`** from every size report and from `doLayout`, which aborts the whole frame's layout flush (probe G1); and an `HBox`/`VBox` with zero laid-out children reports preferred `width: -5` / `width: UNBOUNDED`, which starves every sibling in a preferred-mode parent to ~0 px (probes P6/P10/R6). (F05.5, F05.6)
- Good news to build on: the geometry setters (`setX/setY/setWidth/setHeight/setTranslate/setWillChange`) are all value-diffed, no manager in this slice reads live DOM geometry, and no `StyleRule` write is reachable from a layout pass. Category A and C are clean here; the cost is recomputation and recursion, not writes.

## Findings

### F05.1 `resolveBounds` reads four size hints it discards on every `FillType.BOTH` placement

- **Category**: D (layout work recomputed with unchanged inputs), G (allocation churn), H
- **Impact**: HIGH — once per child per layout pass on hot paths 1, 5 and 6; every `Fit`, `Card`, `Border`, `Tab` and `Grid` placement and every `HBox`/`VBox` placement branch passes `FillType.BOTH`.
- **Where**: `layout/LayoutManager.ts:383-406` (the four reads at `:385-388`, the `BOTH` branch at `:398-400`); callers `layout/Fit.ts:243-250`, `layout/Card.ts:318-325`, `layout/HBox.ts:325,360,364,368,546,550,554`, `layout/VBox.ts:325,347,351,353,519,523,525`, `layout/Grid.ts:779,1026,1037`, `core/Component.ts:3339` (`getSize` allocates a fresh `Size` per call).
- **Hot path**:
  - `Body.doLayout` (window resize / `Split` gutter drag frame)
  - → `Fit.doLayout` → `LayoutManager.placeComponent` (`LayoutManager.ts:355`)
  - → `LayoutManager.resolveBounds` (`:383`)
  - → `component.getPreferredSize()` → child's `LayoutManager.getPreferredSize()` → every grandchild's `getPreferredSize()` …
  - → `component.getSize()` (allocation), `getMaxSize()`, `getMinSize()` (each a second and third full descent)
  - → `fill == FillType.BOTH` → `width = maxWidth; height = maxHeight` — all four results unused.
- **Evidence**: read `resolveBounds` in full: when `fill === BOTH` the `preferredSize`/`size`/`maxSize`/`minSize` locals are never referenced again, and the two anchor-displacement blocks (`:459`, `:482`) cannot fire because `width === maxWidth` and `height === maxHeight`. Probe R1 (`.worktrees/_probes/05-layout-base-box-flow-grid/third.test.ts`) instruments the resolved fill at every `resolveBounds` call:
  - `[R1] Loom chain (4 managers, 4 children) one pass: resolveBounds BOTH 4 non-BOTH 0 -> discarded getPreferredSize+getSize+getMinSize+getMaxSize reads: 16`
  - `[R1] HBox(10 leaves) one pass: resolveBounds BOTH 10 non-BOTH 0 -> discarded size reads: 40`
  Probe P4 shows the knock-on: in the 4-level `Fit → Fit → Card → Fit → leaf` chain the leaf's `getPreferredSize` is called 4× per root pass, and three of those four are `resolveBounds` reads that the `BOTH` branch throws away (`[P] Loom chain second pass: … leaf {"pref":4,"min":6,"max":6,…}`).
- **Proposed change**: move the four reads inside the non-`BOTH` arms of `resolveBounds` — resolve `fill`/`anchor` from the constraints first, return `{x, y, width: maxWidth, height: maxHeight}` immediately for `BOTH`, and read `preferredSize`/`size`/`maxSize`/`minSize` lazily only in the axis branch that consumes them (`HORIZONTAL` needs neither for width, `VERTICAL` neither for height). Same for the anchor blocks, which are already guarded.
- **Risk / blast radius**: `resolveBounds` is the shared chokepoint for every manager (slices 05, 06, 07, 08). Behaviour is unchanged by construction — the values are provably unused on the branch being skipped. Pinned by `tests/component/layout/LayoutManager.resolveBounds.test.ts`, `Fit.test.ts`, `Card.test.ts`, `HBox.test.ts`, `VBox.test.ts`, `Grid.test.ts`, `Border.test.ts`.
- **Proof at implement time**: a probe asserting `getPreferredSize` call count on the leaf of the `Fit→Fit→Card→Fit` chain drops from 4 to 1 per root pass, and `getMinSize` from 6 to 3; ms/frame on the 2×2 editor-grid horizontal drag.

### F05.2 Size reports are recomputed from scratch and re-entered 4–8× per child per pass

- **Category**: D (missing cache), G
- **Impact**: HIGH — per frame on hot path 1, multiplied by every component in the tree.
- **Where**: `core/Component.ts:3376` (`getPreferredSize`, no memo), `:3543` (`getMinSize`), `:3577` (`getMaxSize`), `:3816` (`getBaseline`); the repeat call sites are `layout/HBox.ts:587-588` (`measureFixedWidths`), `:616-617` (`measureWeightCells`), `:457-459,491` (main loop), `:535-536` (placement loop), `layout/LayoutManager.ts:385-388` (`resolveBounds`), plus `core/Component.ts:4165,4231` (`clampWidth`/`clampHeight` re-read the merged min/max on every committed write). `layout/VBox.ts:442-444,480-481,558-559,587-588` is the mirror image.
- **Hot path**:
  - `Body.doLayout` → `HBox.doLayout` (`HBox.ts:268`)
  - → `layoutPreferredMode` (`:436`) → `measureFixedWidths` → per child `getPreferredSize()` + `getMinSize()`
  - → `measureWeightCells` → per weight child `getMinSize()` + `getMaxSize()`
  - → main loop (`:455`) → per child `getPreferredSize()` + `getMinSize()` + `getMaxSize()` + `getBaseline()`
  - → placement loop (`:529`) → per child `getPreferredSize()` + `getMaxSize()` + `crossPlacement`'s constraint read
  - → `resolveBounds` → a fourth `getPreferredSize()`, a third `getMinSize()`/`getMaxSize()`
  - → `commitBounds` → `setWidth`/`setHeight` → `clampWidth`/`clampHeight` → a fourth/fifth `getMinSize()`/`getMaxSize()`
  - and each of those calls on a *container* child re-enters that child's manager, which repeats the whole shape one level down.
- **Evidence**: no cache exists — `getPreferredSize` is `getPreferredSizeConstraint() ?? getLayoutManager().getPreferredSize()` with a clamp, `getMinSize`/`getMaxSize` are `mergeConstraintSize(...)`; the only memo comments in `Component.ts` are for style resolution (`:597`, `:5536`). Measured (probe `fanout.test.ts`, second identical pass):
  - `[P] HBox leaf-children second pass, per child: {"pref":4,"min":5,"max":5,"base":1,"lay":1} x6 children; manager.getLayoutConstraints calls: 30`
  - `[P] HBox Container(VBox×3 leaves) children, second pass: per child {"pref":4,"min":3,"max":3,…} | per grandchild leaf {"pref":8,"min":8,"max":8,…}`
  - `[P] nested (general mids) second pass: … leaf getPreferredSize per leaf 8 getMinSize 10 getMaxSize 10`
  - `[P] 8-deep Fit chain second pass: leaf {"pref":9,"min":11,"max":11,…}` — the count grows linearly with depth, so total measurement work is O(depth²) even for a single chain.
  - Whole-tree (probe S1, 31 components, one unchanged pass): `getPreferredSize 267 getMinSize 263 getMaxSize 263 getBaseline 288 doLayout 30 getLaidOutComponents 104`.
  Cross-contamination is real and not obvious: `HBox.getMinSize` (`HBox.ts:162,175`) calls each child's `getBaseline()`, and `HBox.getContentBaseline` (`:47-67`) calls each child's `getPreferredSize()` — so asking a row for its *minimum* transitively re-measures its grandchildren's *preferred* sizes.
- **Proposed change**: gather each child's `(preferred, min, max, baseline, constraints)` **once** at the top of each manager's resolve phase into the per-child arrays the box layouts already build (`widths[]`, `heights[]`, `baselines[]`), and thread those values into `resolveChildWidth` / `crossPlacement` / `resolveBounds` instead of re-reading. This is a per-manager, per-phase gather — not a global cache — so it cannot go stale across the `commitBounds → child.doLayout()` recursion (where a child legitimately republishes its intrinsic size, e.g. `FlowLayout.publishWrappedLineExtent`, `FlowLayout.ts:219`). Pair it with F05.1 so `resolveBounds` gains an overload taking pre-read hints.
  *Note on `plans/two-phase-baseline-resolution.md`*: that plan says "**Do not add a per-pass metrics cache** — that is speculative". That instruction is about a cache for its new `getBaselineMetrics()` sweep, and it was written without a measured fan-out number. The evidence that has changed is the 1,081-query figure above; a per-phase gather also makes that plan's extra sweep free rather than additive, so the two are complementary. If the plan's authors still want no cache at all, the gather can be scoped to the box layouts only and left out of the baseline protocol.
- **Risk / blast radius**: touches `HBox`, `VBox`, `Grid`, `HFlow`, `VFlow`, `Fit`, `Card` and the shared `resolveBounds`. The risk is a child whose size changes *between* gather and commit within one pass — today only reachable through a nested `HFlow`/`VFlow` publishing a new wrapped extent, which already relays through `notifyIntrinsicSizeChanged` and lands on the next frame. Pinned by the whole `tests/component/layout/` suite plus `tests/component/tree/ResizeLayoutEconomy*.test.ts`.
- **Proof at implement time**: re-run probe S1 and assert the 31-component tree drops below ~150 total size queries; ms/frame on the 2×2 editor-grid horizontal drag and on the empty-project idle drag (currently ~52 ms/frame).

### F05.3 `commitBounds` bypasses `applyBounds`, so the unchanged-geometry skip covers no built-in layout

- **Category**: D (missing `canSkipUnchangedLayout` opt-in), H (implementation does not match the documented contract)
- **Impact**: HIGH — the entire recursion on hot path 1 is unconditional.
- **Where**: `layout/LayoutManager.ts:547-571` (`commitBounds`; the unconditional `component.doLayout()` at `:568`), `layout/LayoutManager.ts:580-584` (`commitPlacements`), vs. `core/Component.ts:3977-3989` (`applyBounds`, which *does* diff) and `:4000` (`canSkipUnchangedLayout`, default `false`).
- **Hot path**: `Body.doLayout` → any manager's `doLayout` → `commitPlacements` → `commitBounds` → `component.doLayout()` → that child's manager's full resolve pass → its own `commitPlacements` → … to every leaf, every frame, regardless of whether anything changed.
- **Evidence**: `grep -rn "applyBounds" packages --include=*.ts` returns **8 production call sites, all inside the Table subsystem** (`layout/Table.ts:389,405`, `component/table/Header.ts:1628,1646,1670`, `component/table/Body.ts:1415,1469`) and one opt-in (`component/table/cell/Cell.ts:256`). Not one layout manager in this slice — or in slices 06/07/08 — calls it. `packages/lib/docs/concepts/layout-system.md` ("### The write is diffed") and the briefing's pipeline description both describe the diffed behaviour as the general rule; it is in fact Table-only. Probe P4 confirms the recursion is unconditional on an identical second pass: `[P] nested (Container mids) second pass: mid doLayout calls [1,1,1] | leaf doLayout total 9`.
  The per-child *DOM writes* are already diffed (`setWidth` `core/Component.ts:4060+`, `setX`, `setTranslate`, `setWillChange` all early-return on an unchanged value), so the waste is the recursion and the re-measurement it drives (F05.1/F05.2), not the writes.
- **Proposed change**: route `commitBounds`'s commit half through `Component.applyBounds` (it already opens the same `setAutoCommitStyle(false/true)` batching window and already reports `changed`), keeping the size-stable `setTranslate` fast path in front of it, and then opt the layout-managed container types into `canSkipUnchangedLayout`. The gate must stay opt-in per the existing design; the candidates are the container types whose `doLayout` is a pure function of their own rectangle and their children's hints — which is where the existing `isLayoutDirty()` / `invalidateLayout()` machinery already carries the "something else changed" signal.
- **Risk / blast radius**: the largest change in this slice. A container that mutates its own inputs without calling `invalidateLayout`/`scheduleLayout` would silently stop re-laying out. The existing `Cell.canSkipUnchangedLayout` doc (`component/table/cell/Cell.ts:253`) enumerates the writer audit that had to be done for one class; the same audit is needed per opted-in type. `tests/component/table/CellLayoutSkip.test.ts`, `ScrollRebindLayoutEconomy.test.ts`, `HeaderThemeReflow.test.ts` and `tests/component/tree/ResizeLayoutEconomy*.test.ts` are the existing shape to copy.
- **Proof at implement time**: a probe asserting that a second identical `root.doLayout()` over the 31-component S1 tree calls `doLayout` on fewer than N descendants (today: all 30); `DiagnosticsOverlay`'s layout-passes-per-second counter during a gutter drag.

### F05.4 Track-less `Grid` runs five discarded `measureContent` sweeps per pass

- **Category**: D, H
- **Impact**: MEDIUM–HIGH — per pass for every `Grid` without declared tracks (the default), multiplied by the children count; HIGH where a `Grid` sits on a resize path.
- **Where**: `layout/Grid.ts:375` (`getPreferredSize`), `:434` (`getMinSize`), `:482` (`getMaxSize`), `:597` (`computeTotalMinSize`), `:970` (`layoutOccupancy`); the guards that make the result dead are `:377,381`, `:436,440`, `:484,488`, `:607,611` (`this._columnTracks.length > 0 ? … : uniform estimate`) and `resolveTracks` (`:825-861`), which reads `contentSizes` only for `track.mode === "content"`.
- **Hot path**: `parent.doLayout` → `child.getPreferredSize()` → `Grid.getPreferredSize` → `measureContent(components, cols, rows)` → per child `getLayoutConstraints()` + `getPreferredSize()` + `getMinSize()` (each a full subtree descent) → result assigned to `content`, then `content.columns`/`content.rows` are never read because both track arrays are empty.
- **Evidence**: probe R3, 9-child `Grid({columns: 3})` with no tracks: `[R3] track-less Grid(9 kids) ONE doLayout: measureContent 1 getLayoutConstraints 36 child0 getPreferredSize 2 | columnTracks 0 rowTracks 0` and `[R3] track-less Grid: measureContent calls for pref+min+max alone: 3`. Probe P5 with a parent asking all three reports plus a layout: `measureContent 4 getColRowCount 4 host.getLaidOutComponents 8`. `getColRowCount` (`Grid.ts:304`) allocates a filtered child array on each of those four calls.
- **Proposed change**: guard each `measureContent` call behind `this._columnTracks.length > 0 || this._rowTracks.length > 0` (and behind `this._baselineAlign`, which is the other consumer, `Grid.ts:886-887`), and pass the per-axis slice only to the axis that declared tracks. Also hoist `getColRowCount()` to one call per `doLayout`/report instead of recomputing it (it is pure over the same child list).
- **Risk / blast radius**: `Grid` only; `tests/component/layout/Grid.test.ts` covers both the track and track-less paths, including `getColRowCount inference`.
- **Proof at implement time**: a probe asserting `measureContent` call count is 0 for a track-less, non-baseline `Grid` across `getPreferredSize` + `getMinSize` + `getMaxSize` + `doLayout`.

### F05.5 An auto-sized `Grid` with zero laid-out children throws, aborting the frame's whole layout flush

- **Category**: D (a thrown layout pass), H; correctness
- **Impact**: HIGH — one throw kills every remaining layout in the frame.
- **Where**: `layout/Grid.ts:316-318` (`columns = Math.floor(Math.sqrt(0)) === 0`; `rows = Math.ceil(0 / 0) === NaN`), consumed by `layout/Grid.ts:880-881` (`new Array(cols).fill(0)` / `new Array(rows).fill(0)`), reached from `:375`, `:434`, `:482`, `:597`, `:970`. The flush loop with no `try`/`catch` is `core/Component.ts:218-240`.
- **Hot path**: `flushLayouts` (`core/Component.ts:218`) → `c.doLayout()` → `Grid.doLayout` (`:671`) → `layoutOccupancy` (`:969`) → `measureContent` (`:879`) → `new Array(NaN)` → `RangeError: Invalid array length` → the remaining entries in the `dirty` snapshot never lay out and the `afterLayoutCallbacks` queue (`:244-247`) never drains.
- **Evidence**: probe G1 (`fourth.test.ts`):
  - `[G1] empty track-less Grid: getColRowCount {"width":0,"height":null} pref THREW: Invalid array length min THREW: Invalid array length max THREW: Invalid array length doLayout THREW: Invalid array length`
  - `[G1] track-less Grid after its only child is undisplayed: colRow {"width":0,"height":null} pref THREW: Invalid array length doLayout THREW: Invalid array length`
  - `[G1] empty Grid({columns:2}): colRow {"width":2,"height":0} … doLayout "ok"` — an explicitly-sized grid is fine, so the hole is exactly the `!this._rows && !this._columns` arm.
  The second line is the reachable one: the grid need not start empty. Any auto `Grid` whose children are all `setDisplayed(false)` — which is what `Card` (`layout/Card.ts:197`), `Tab`, and the collapsed-pane path do — hits it, because `getColRowCount` counts `getLaidOutComponents()` (`Grid.ts:310`).
- **Proposed change**: early-return in `getColRowCount` when `componentCount === 0` (a `{width: 0, height: 0}` grid), and defend the `Math.ceil(n / columns)` division against a zero divisor. The five callers then take their existing zero-children paths.
- **Risk / blast radius**: `Grid` only. `tests/component/layout/Grid.test.ts:75-89` pins `getColRowCount` inference for non-empty grids; no test covers the empty case.
- **Proof at implement time**: a regression test asserting `Grid().getPreferredSize()` and `doLayout()` on an empty and an all-undisplayed auto grid do not throw.

### F05.6 Empty / all-undisplayed `HBox` and `VBox` report negative and unbounded preferred sizes, starving their siblings

- **Category**: H; correctness, reachable through the merged undisplay work
- **Impact**: MEDIUM–HIGH — a visible, total layout collapse of a row when it happens; not per frame.
- **Where**: `layout/HBox.ts:117` (`width += this._spacing * (components.length - 1)` with `length === 0` → `-spacing`), `layout/HBox.ts:179` (same in `getMinSize`), `layout/VBox.ts:108` (`let width = UNBOUNDED`, never reduced when there are no children) and `:122` (`height += spacing * (length - 1)`), `layout/VBox.ts:168-182` (`getMinSize` mirror). `computeTotalMinSize` guards the empty case (`HBox.ts:227`, `VBox.ts:225`); the size reports do not. Consumer that amplifies it: `layout/HBox.ts:576-596` (`measureFixedWidths`) → `BoxLayout.computeShrink` (`BoxLayout.ts:426`).
- **Hot path**: `Card.setVisibleComponentId` / `Split` collapse → `child.setDisplayed(false)` → the box's `getLaidOutComponents()` (`core/Component.ts:7049`) now returns `[]` → parent's next `doLayout` → `HBox.layoutPreferredMode` → `measureFixedWidths` sums `UNBOUNDED` into `fixedPreferred` → `computeShrink` returns `shrinkRatio ≈ 1` → every sibling shrinks to its minimum (0).
- **Evidence**: probes P6, P10 and R6:
  - `[P] empty HBox pref {"width":-5,"height":0} … empty VBox pref {"width":9007199254740991,"height":-5} min {"width":0,"height":-5}`
  - `[R6] VBox pref with child displayed {"width":40,"height":20} -> after setDisplayed(false) {"width":9007199254740991,"height":-5}`
  - `[P10] HBox[50px, empty VBox Container, 50px] in 400px: widths a 2.1671553440683056e-12 empty 0 b 2.1671553440683056e-12` — versus the control with an empty **HBox** child, where the siblings keep their 50 px.
  - `[P10] HBox with VBox Container child: before removing its only child [50,20,50] after [~0, 0, ~0]`
  `Component.setContentClampSuspended` (`core/Component.ts:4118`) exists precisely because a childless box manager reports a degenerate *maximum* during a collapse; the *preferred* report was not covered by the same fix. Whether Loom reaches this today through a specific collapsed pane is **not verified** — the mechanism is.
- **Proposed change**: return an empty-children early result from `HBox.getPreferredSize`/`getMinSize` and `VBox.getPreferredSize`/`getMinSize` (perimeter only, both axes `0`), matching the guard `computeTotalMinSize` already has, and replace `VBox`'s `UNBOUNDED`-seeded `width` with a plain `0`-seeded maximum (the `isUnbounded(width) ? Math.min : Math.max` trick at `VBox.ts:116` exists only to pick up the first child's width and is what leaves the sentinel behind).
- **Risk / blast radius**: `HBox`/`VBox` only. `tests/component/layout/HBox.test.ts` / `VBox.test.ts` pin the populated cases; no test covers zero laid-out children.
- **Proof at implement time**: a regression test asserting a box with zero laid-out children reports non-negative, non-sentinel sizes, and that a sibling of an emptied `VBox` in a preferred-mode `HBox` keeps its width.

### F05.7 `reserveContentFrame` walks every child before it checks whether the host scrolls

- **Category**: D, G
- **Impact**: MEDIUM — once per pass per `HBox`/`VBox`/`HFlow`/`VFlow` container, O(children), on hot path 1; wasted entirely for a non-scrolling host, which is the common case.
- **Where**: `layout/LayoutManager.ts:293-337` — the far-edge loop at `:313-316` runs before the `if (this.isOverflowingX() || this.isOverflowingY())` test at `:330`. Callers: `HBox.ts:299`, `VBox.ts:297`, `HFlow.ts:309`, `VFlow.ts:293`.
- **Hot path**: gutter-drag frame → `HBox.doLayout` → `reserveContentFrame` → `container.getInnerSize()` (a second call this pass) → `container.getLaidOutComponents()` (a second filtered-array allocation this pass) → `container.getContentInsets()` → per child `getX() + getTranslateX() + getWidth()` and `getY() + getTranslateY() + getHeight()` (`getWidth`/`getHeight` each allocate a `Size` via `core/Component.ts:4036,4185` → `:3339`) → `clearContentFrame()`, which returns immediately because no frame exists.
- **Evidence**: probe R4, non-scrolling `HBox` with 8 children: `[R4] non-scrolling HBox(8 kids) one pass: getTranslateX per child 2 total 16 | clearContentFrame calls 1`. One of the two `getTranslateX` reads per child is `commitBounds`'s position check (`LayoutManager.ts:551`); the other is this discarded loop. Probe P1 shows the duplicated host reads: `host.getLaidOutComponents: 2 getPerimeterSize: 2 getInnerSize: 2 getContentInsets: 2` for one `HBox` pass.
- **Proposed change**: hoist the `isOverflowingX() || isOverflowingY()` test to the top of `reserveContentFrame` — a non-scrolling host calls `clearContentFrame()` (already an idempotent no-op, `core/Component.ts:1587-1591`) and returns without touching the children. While there, take `inner`/`components`/`insets` from the caller instead of re-reading them (each box layout already holds all three).
- **Risk / blast radius**: `HBox`/`VBox`/`HFlow`/`VFlow` and any future manager using the helper. Behaviour is identical — the loop's outputs feed only the branch being skipped. Covered by the autoScroll cases in `tests/component/layout/HBox.test.ts` / `VFlow.test.ts`.
- **Proof at implement time**: a probe asserting zero `getTranslateX`/`getWidth` reads from `reserveContentFrame` on a non-scrolling host.

### F05.8 `getLaidOutComponents()` allocates a filtered array on every call, and every manager calls it several times per pass

- **Category**: G
- **Impact**: MEDIUM — 104 array allocations for one pass over 31 components (probe S1); scales with component count on hot path 1, so hundreds-to-thousands of short-lived arrays per frame in the Loom shell, i.e. GC pressure inside the frame budget.
- **Where**: `core/Component.ts:7049-7051` (`this._components.filter(...)`); callers in this slice: `LayoutManager.ts:300`, `Fit.ts:131,189,216`, `Card.ts` (none — it caches, see the inventory), `HBox.ts:84,146,226,279`, `VBox.ts:85,145,224,277`, `BoxLayout.ts:352`, `HFlow.ts:86,155,206,286`, `VFlow.ts:87,144,190,270`, `Grid.ts:310,356,415,475,576,677`, `Anchor.ts:158`, `Absolute.ts:47`.
- **Hot path**: one root `doLayout` → each manager's `doLayout` allocates one array, `reserveContentFrame` a second, and every `getPreferredSize`/`getMinSize`/`getMaxSize`/`getContentBaseline` the parent asks for allocates another — so the count multiplies by the F05.2 fan-out.
- **Evidence**: probe R2: `[R2] HBox(3 x Container(VBox x3)) one pass: getLaidOutComponents calls root 2 per mid 13 total 41` — 13 filtered-array allocations per mid container for a single root pass. Probe S1: `getLaidOutComponents(array allocs) 104` for 31 components. `Fit` is the worst offender per call: `Fit.computeSize` (`Fit.ts:131`) allocates a whole filtered array to read index `0`, and does so once each for preferred, min and max.
- **Proposed change**: two independent steps. (a) In `Fit`, replace `getLaidOutComponents()[0]` with a scan for the first displayed child (no allocation). (b) In the box/flow/grid managers, take the child list once per `doLayout` / per size report and pass it into the helpers that currently re-fetch it (`computeTotalMinSize`, `aggregateMaxSize`, `getColRowCount`, `reserveContentFrame` — see F05.7). A cached array on `Component` invalidated by add/remove/`setDisplayed` is the larger alternative and belongs to slice 01.
- **Risk / blast radius**: mechanical; the list is stable within one synchronous pass except where a manager mutates children mid-pass (documented as unsupported in `layout-system.md` § Common pitfalls).
- **Proof at implement time**: re-run probe S1 and assert the allocation count falls below ~40.

### F05.9 `Fit` and `Card` lay out a 0×0 rectangle and recurse before the container has an element

- **Category**: D, B, E
- **Impact**: MEDIUM — once per subtree on hot path 6 (construction / first render), and again on every re-mount; `Fit` is the `Body` root, the `Dock` root and every `Dock` frame, so the affected subtree is the whole shell.
- **Where**: `layout/Fit.ts:232-250` (`containerSize` may be `null`; `:247-248` pass `0`/`0` anyway) and `layout/Card.ts:307-325` (same shape at `:322-323`). Contrast `HBox.ts:274-277`, `VBox.ts:272-275`, `Grid.ts:679-682`, `HFlow.ts:281-284`, `VFlow.ts:265-268`, `Anchor.ts:147-151`, all of which `return` when `getInnerSize()` is `null`.
- **Hot path**: `Component.addComponent` → `scheduleLayout` → flush → `Fit.doLayout` on a container with no element → `getInnerSize()` returns `null` (`core/Component.ts:3619-3622`) → `placeComponent(child, 0, 0, 0, 0, BOTH)` → `commitBounds` sets the child's `_width`/`_height` to 0 → `component.doLayout()` recurses the entire subtree at zero size → the real pass then has to redo all of it.
- **Evidence**: probe P7 and G2:
  - `[P] Fit pre-render: child width/height 0 0 child doLayout calls 1 | HBox host without element: early return = NaN / doLayout 0`
  - `[G2] Fit: child w=0 h=0 dirty=true | Card: child w=0 h=0 dirty=true | Anchor: child w=NaN h=NaN dirty=true | Absolute: child w=40 h=20 dirty=true | Grid: child w=NaN h=NaN dirty=true` — `NaN` means untouched; only `Fit` and `Card` commit, and `Absolute` commits deliberately (it never reads the inner size, `Absolute.ts:40-64`).
- **Proposed change**: `return` from `Fit.doLayout` and `Card.doLayout` when `container.getInnerSize()` is `null`, matching every other manager. The child stays `isLayoutDirty()`, so `Component.doLayout` (`core/Component.ts:7231-7233`) will not record the pass as done and the real pass still runs.
- **Risk / blast radius**: `Fit`/`Card` only. `tests/component/layout/PrematureLayout.test.ts` is the test file that pins this class of behaviour; check it does not assert the current 0×0 commit.
- **Proof at implement time**: a probe asserting the child's `doLayout` is not called when the `Fit`/`Card` host has no element, and that the child's committed width stays `NaN`.

### F05.10 `Card` keeps a removed child as `_currentVisible`, leaving the container permanently blank

- **Category**: H; correctness
- **Impact**: MEDIUM — per event (removing the visible page), permanent blank container afterwards.
- **Where**: `layout/Card.ts:28,37` (`_currentVisible`, `_pendingScrollRestore`), `:171-177` (`getVisibleComponent`, which re-syncs only when `_currentVisible` is falsy), `:299-305` (`doLayout`, same guard), `:232` (`syncVisible` early-returns when `resolved === this._currentVisible`). Nothing clears it: `core/Component.ts:6744` (`unwireChild`) calls only `delLayoutConstraints`.
- **Hot path**: `container.removeComponent(visiblePage)` → `unwireChild` → constraints dropped, manager not notified → next `doLayout` → `Card.doLayout` sees a non-null `_currentVisible` → `placeComponent` on a detached component → the remaining sibling stays `display: none` from the first `syncVisible`.
- **Evidence**: probe R5: `[R5] Card: visible before removal a | after removing a: getVisibleComponent === a (REMOVED CHILD) | removed child doLayout calls in the pass: 1 | b displayed? false | pref {"width":40,"height":20}` — the card still reports the removed child's preferred size and still lays it out, while the only remaining child is invisible. `packages/lib/docs/concepts/performance.md` § "Collapsed panes…" documents the *removed* component needing `setDisplayed(true)` from the caller; it does not cover the container going blank.
- **Proposed change**: give `LayoutManager` a `componentRemoved(component)` hook called from `unwireChild` (it already has the component in hand), and have `Card` clear `_currentVisible`/`_pendingScrollRestore` and re-sync when the removed child is the visible one. `Tab` (slice 07) and `Split`/`Border` (slice 06) have the same shape of parked per-child state and would use the same hook — coordinate before adding it.
- **Risk / blast radius**: adds a `LayoutManager` seam, so it touches slices 06/07/08. `tests/component/layout/Card.test.ts` and `Card.undisplay.test.ts` pin the switch behaviour; neither covers removal.
- **Proof at implement time**: a regression test asserting that removing the visible child leaves a displayed, laid-out sibling.

### F05.11 `HFlow`'s baseline `rowExtent` is quadratic in row length and allocates two arrays per cell

- **Category**: G, D
- **Impact**: MEDIUM for a long baseline-aligned row; LOW otherwise — `HFlow`/`VFlow` are not on the Loom shell's per-frame path.
- **Where**: `layout/HFlow.ts:475-484` (`rowExtent` re-runs `lineExtent` over the whole row-so-far for every cell, allocating `row.cells.map(...)` twice at `:481-482`), called from `:359` inside the per-child wrap loop; `layout/HFlow.ts:385-386` allocates the same two arrays again per row in `resolveRows`. `layout/LayoutManager.ts:692-721` (`computeRowHeight`) is the O(n) body being re-entered.
- **Hot path**: container resize → `HFlow.doLayout` (`:275`) → `groupIntoRows` (`:329`) → per cell `rowExtent` → two `Array.map` allocations + `computeRowHeight` over all cells placed so far.
- **Evidence**: probe P8, 40 cells on one row: `[P] HFlow baseline 40 cells one row: lineExtent calls 40 computeRowMetrics calls 41` — 40 nested scans (≈820 element visits) and 80 array allocations for one pass, where an incremental fold would be 40 visits and zero allocations. Non-baseline rows already fold incrementally (`:477`).
- **Proposed change**: keep a running `{ascent, descent, tallest}` triple on `HFlowRow` and fold each new cell into it, so `rowExtent` is O(1) per cell; `resolveRows` then reads the row's stored metrics instead of rebuilding the two arrays.
- **Risk / blast radius**: `HFlow` only; `tests/component/layout/HFlow.test.ts` covers the baseline row heights. The doc comment at `:465-473` explains why the baseline case cannot be folded as a plain maximum — an ascent/descent pair *can* be folded, which is the point of the change.
- **Proof at implement time**: a probe asserting `computeRowMetrics` is called once per row rather than once per cell.

### F05.12 `commitBounds` flushes an empty inline-style patch for every child on every pass

- **Category**: B, G
- **Impact**: LOW per call, MEDIUM in aggregate — one `DOM.sink.apply` + one handle-registry resolve per laid-out component per frame on hot path 1.
- **Where**: `layout/LayoutManager.ts:548,570` (`setAutoCommitStyle(false)` / `(true)`) → `core/Component.ts:1814,1824-1829` (`commitElementStyle` → `_inlineStyle.flush()`) → `core/StyleTarget.ts:79-83` (`flush` → `flushDirty`) → `:457-459` (`InlineStyle.flushDirty` calls `DOM.sink.apply(target, { style: dirty })` with no empty-bag guard) → `core/DOM.ts:1641-1643` (`_registry.resolve(handle)` + `applyPatchTo`).
- **Hot path**: gutter-drag frame → `commitBounds` per child → `setAutoCommitStyle(true)` → an `apply` carrying `{ style: {} }`.
- **Evidence**: probe P9 dumps the patches: `[P9] no-op HBox pass with 3 leaves: writes 3 patches: [{"op":"apply","patch":{"style":{}}},{"op":"apply","patch":{"style":{}}},{"op":"apply","patch":{"style":{}}}]`, and the third pass repeats it. Probe P4: `DOM sink writes during pass: 12 {"apply":12}` for 12 unchanged components. `StyleRule.flushDirty` (`core/StyleTarget.ts:404-407`) *does* guard the empty case; `InlineStyle.flushDirty` does not — a one-line asymmetry. No stylesheet rule write is reachable from this path (`StyleRule.ensure`, `core/StyleTarget.ts:374-379`, is a no-op once materialised), so category C is clean.
- **Proposed change**: add the same `if (Object.keys(dirty).length === 0) return;` guard to `InlineStyle.flushDirty`. This belongs to slice 02/03; recorded here because this slice is what triggers it once per component per frame.
- **Risk / blast radius**: `core/StyleTarget.ts`; every component. Trivially behaviour-preserving.
- **Proof at implement time**: `DOM.sink` write count per unchanged layout pass drops to 0 in probe P9's scenario.

### F05.13 Constraint lookups: five `Map<string, …>` hits per child per box pass, and the id key orphans on `setId`

- **Category**: D, H
- **Impact**: LOW per frame; the `setId` hole is a latent correctness bug.
- **Where**: `layout/LayoutManager.ts:47` (`Map<string, LayoutConstraints>` keyed by `component.getId()`), `:594-627` (set/del/get); the five per-child reads in an `HBox` pass are `HBox.ts:582` (`measureFixedWidths`), `:613` (`measureWeightCells`), `:456` (main loop), `BoxLayout.ts:591` (`crossPlacement`), `LayoutManager.ts:384` (`resolveBounds`). `core/Component.ts:1933` (`setId`) re-points the style rule and the event index but never migrates the manager's constraint entry.
- **Hot path**: `HBox.doLayout` → the five sites above, each a string hash lookup.
- **Evidence**: probe P1: `manager.getLayoutConstraints calls: 30` for 6 children (5 each) in both `HBox` and `VBox`; probe R3: `getLayoutConstraints 36` for a 9-child `Grid` doLayout (4 each). Reading `setId` (`core/Component.ts:1933-1975`) confirms `Event.reindexComponent` and the `StyleRule` re-point are handled and the layout-constraints map is not.
- **Proposed change**: fold the constraint read into the per-child gather of F05.2 (one lookup per child per pass), and key the map on the `Component` (a `Map`/`WeakMap<Component, LayoutConstraints>`) rather than its id, which removes both the string hashing and the `setId` orphaning.
- **Risk / blast radius**: `LayoutManager` and every manager that reads constraints; `LayoutSerialization` (slice 08) walks constraints and should be checked. `tests/component/layout/*` exercise constraints throughout.
- **Proof at implement time**: a probe asserting one `getLayoutConstraints` call per child per `HBox.doLayout`, plus a regression test that `setId` on an added child preserves its constraints.

### F05.14 `for…in` over arrays in the four hottest size reports

- **Category**: D (micro), H
- **Impact**: LOW on its own; it sits inside the F05.2 fan-out, so it is multiplied by 4–8 per child per pass.
- **Where**: `layout/HBox.ts:93,106` (`getPreferredSize`), `:155,168` (`getMinSize`); `layout/VBox.ts:91,111` (`getPreferredSize`), `:151,171` (`getMinSize`). Every other loop in the slice already uses `for…of`.
- **Evidence**: read of the four methods; `for (let idx in components)` enumerates string keys and defeats the engine's array fast path, on the exact methods probe S1 counts at 267 and 263 invocations per pass.
- **Proposed change**: convert to `for…of` (or an indexed loop) as part of whichever plan touches these methods. Too small to plan on its own — ride along with F05.2 or F05.6.
- **Risk / blast radius**: none; `tests/component/layout/HBox.test.ts` / `VBox.test.ts` pin the results.
- **Proof at implement time**: covered by the F05.2 counters.

### F05.15 `inflateForOverflow` without `reserveContentFrame`: universal scroll is half-wired in `Fit`, `Card` and `Grid`

- **Category**: I (inconsistency), H
- **Impact**: LOW — a missing trailing inset in a scrolling `Fit`/`Card`/`Grid` host; no per-frame cost.
- **Where**: `layout/Fit.ts:239-241`, `layout/Card.ts:314-316`, `layout/Grid.ts:692` all call `inflateForOverflow` and implement `computeTotalMinSize` (`Fit.ts:183-197`, `Card.ts:279-287`, `Grid.ts:570-619`), but none calls `reserveContentFrame` (`LayoutManager.ts:293`), which `HBox.ts:299`, `VBox.ts:297`, `HFlow.ts:309` and `VFlow.ts:293` all do.
- **Evidence**: `grep -rn "reserveContentFrame" packages/lib/src` returns exactly those four call sites plus the definition. The helper's own doc (`LayoutManager.ts:259-291`) states the trailing inset is otherwise lost once children overflow.
- **Proposed change**: either call `reserveContentFrame` from the three managers that opted into overflow inflation, or narrow the helper's doc to say the reserve is a box/flow-only behaviour. Decide, then make the code and the doc agree.
- **Risk / blast radius**: adding the call re-parents the child subtree once on the first scrolling pass (see the transition caveat at `LayoutManager.ts:270-279`); verify against `tests/component/layout/Fit.test.ts` / `Card.test.ts`.
- **Proof at implement time**: a test asserting the trailing inset is scrollable in a `Panel({autoScroll})` hosting a `Fit`/`Grid`.

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `LayoutManager` | Abstract base: constraint storage, fill/anchor resolution, commit, baseline helpers | None directly; drives `Component` setters, `setContentFrame`/`clearContentFrame` | Per child: 4 size reads in `resolveBounds` (all discarded when fill is `BOTH`), 1 `getTransition`, 1 `getWidth`+`getHeight` (2 `Size` allocations), 1 `setX/setY/setWidth/setHeight/setTranslate/setWillChange` (all diffed), 1 empty `DOM.sink.apply`, 1 unconditional `child.doLayout()`. No live DOM geometry read. | over-built | F05.1, F05.3, F05.7, F05.12, F05.13 |
| `LayoutConstraints` | Per-child hints bag shared by every manager | None | 5 map lookups per child per box pass | over-built (18 fields, one flat bag for 8 managers; `description` has no reader) | F05.13, dead-code §2 |
| `LayoutSizes` | Pure px/ratio persistence helpers for `Split`/`Accordion` | None | Not on the layout path (restore/serialize only) | fits | — |
| `BoxLayout` | Axis-agnostic config + shared shrink/weight/justify/cross-placement maths for `HBox`/`VBox` | None | `aggregateMaxSize`: 1 `getMaxSize` per child per `getMaxSize()` call; `crossPlacement`: 1 constraint read per child per pass | fits, except the unused `overflowSizing` surface | F05.15, dead-code §1 |
| `HBox` | Single horizontal row, preferred or equal mode, weights, justify, baseline | None | Per child per pass: `getPreferredSize` ×4, `getMinSize` ×5, `getMaxSize` ×5, `getBaseline` ×1, constraints ×5; host: `getInnerSize` ×2, `getLaidOutComponents` ×2, `getPerimeterSize` ×2, `getContentInsets` ×2 (probe P1) | over-built | F05.2, F05.6, F05.7, F05.8, F05.14 |
| `VBox` | Vertical mirror of `HBox` | None | Same counts as `HBox` minus the per-child baseline read (probe P1) | over-built | F05.2, F05.6, F05.7, F05.8, F05.14 |
| `FlowLayout` | Wrapping-flow base: spacing, uniformity, align/justify, wrapped-extent measurement | None | `clampedPreferredSize`: 3 size reads per child per call; `publishWrappedLineExtent` relays intrinsic-size changes (guarded against a loop) | fits | F05.8 |
| `HFlow` | Rows that wrap downward, optional uniform cells and baseline item-align | None | 1 `clampedPreferredSize` + 1 `getBaseline` per child in `groupIntoRows`, a second `clampedPreferredSize` for main-filled cells in `resolveRows`, plus the quadratic `rowExtent` fold | over-built | F05.11, F05.8 |
| `VFlow` | Columns that wrap rightward | None | Mirror of `HFlow` minus baselines (its `cells[].baseline` is always `null`) | fits | F05.8, dead-code §4 |
| `Fit` | Exactly one child filling (or centred in) the inner bounds | None | Per pass: 1 `getLaidOutComponents` for `doLayout` + 1 each for preferred/min/max (allocating a filtered array to read index 0); the child's `getPreferredSize`/`getMinSize`/`getMaxSize` ×1/×3/×3 (probe P3) | over-built | F05.1, F05.8, F05.9, F05.15, dead-code §3 |
| `Absolute` | No-op manager: each child at its own `(x, y)` and preferred size | None | Per child: `getPreferredSize` ×1, `getSize` ×1, `getX`/`getY`; no inner-size read at all | fits | — |
| `Anchor` | Edge/percent-relative placement, re-resolved on resize | None | Per child: 1 constraint read, `getPreferredSize` ×1, `getSize` ×1, `getX`/`getY`; bails cleanly when unsized | fits | — |
| `AnchorConstraints` | Per-child edge/size offsets for `Anchor` | None | Read once per child per pass | fits | — |
| `Card` | One child visible at a time, others `display: none` | Drives `setDisplayed` (in the setter, not the pass) and the deferred scroll restore | Per pass: no child-list allocation (`_currentVisible` is cached); the visible child's `getPreferredSize` ×1, `getMinSize`/`getMaxSize` ×3 (probe P3) | mismatch (stale `_currentVisible` after removal) | F05.1, F05.9, F05.10 |
| `Grid` | Uniform or track-sized cell grid with spans, explicit placement, optional baseline rows | Drives `setClipFrame`/`clearClipFrame` per child (both idempotent no-ops when unchanged) | Per pass: 1 `measureContent` (≈3 reads + 1 constraint lookup per child) even with no tracks, plus `getColRowCount` ×1 per report, plus `resolveBounds`'s 4 reads per child | over-built | F05.1, F05.4, F05.5, F05.8, F05.15 |
| `GridConstraints` | `col`/`row`/`colSpan`/`rowSpan` per child | None | Read 2–4× per child per pass | fits | F05.13 |
| `GridTrack` | `weight`/`fixed`/`content` track descriptor | None | Read per track per pass | fits | — |
| `FillType` | Fill enum | None | — | fits | — |
| `AnchorType` | Anchor enum (numeric, `NORTHWEST === 0`) | None | — | fits (the `??` at `LayoutManager.ts:396` correctly handles the falsy zero) | — |

## Redundant, duplicated and dead code

1. **`BoxOverflowSizing` / `overflowSizing` has no consumer anywhere.** The type (`BoxLayout.ts:40`), the option field (`:111`), the field (`:133`), the `applyOptions` arm (`:177-179`), the getter (`:289-291`), the setter (`:303-307`) and the two read sites (`HBox.ts:416`, `VBox.ts:401`) exist only to serve each other. `grep -rn "overflowSizing" packages --include=*.ts | grep -v /dist/ | grep -v "lib/src/typescript/lib/layout/"` → **0 hits**; `grep -rn "setOverflowSizing(" packages --include=*.ts | grep -v /dist/` → **1 hit, its own definition**. No test sets it either. Either delete it or give it a demo that exercises the `"min"` arm.
2. **`LayoutConstraints.description` has no reader.** `grep -rEn "\b(lc|cons|constraints|layoutConstraints)\??\.description" packages --include=*.ts | grep -v /dist/` → **0 hits** (`Button`'s `description` is an unrelated component option). Declared at `LayoutConstraints.ts:16`.
3. **`Fit.getComponent()` has zero callers.** `grep -rn "getComponent()" packages --include=*.ts | grep -v /dist/` → **1 hit, its own definition** (`Fit.ts:154`). It also disagrees with the rest of the class: it counts `getComponents()` while `doLayout` and `computeSize` count `getLaidOutComponents()`, so its "more than one component" throw fires on a case `doLayout` deliberately allows.
4. **`VFlowColumn.cells[].baseline` is always `null`.** Written as a literal at `VFlow.ts:342`, read only at `VFlow.ts:383` where `null` is also passed for `rowAscent` — the field carries no information. The interface comment (`:23-28`) admits as much.
5. **`LayoutManager._defaultPreferredSize` / `_defaultMinSize` / `_defaultMaxSize` are unreachable configuration.** Declared at `LayoutManager.ts:48-50`, returned at `:159`, `:168`, `:177`; `grep -rn "_defaultPreferredSize\|_defaultMinSize\|_defaultMaxSize" packages --include=*.ts` → **3 declarations, 3 reads, 0 writes** (the other two hits are doc comments in `HBox.ts:641` and `VBox.ts:610`). They are constants dressed as state, and `getMinSize`/`getMaxSize` hand the *same mutable object* to every caller on every call. Replace with frozen module constants, or drop the fields.
6. **Audit item 6 (`plans/research/codebase-health-audit-2026-08-29.md` §6, "`LayoutManager`'s shared clamp chokepoint still lets max beat min") is closed.** The current `resolveBounds` applies the maximum and then the minimum as two independent `if`s (`LayoutManager.ts:419-425` for width, `:447-453` for height), so the minimum wins — the ordering the audit asked for. No action; recorded so the next reader does not re-open it.
7. **`Grid.getColRowCount()` returns a `{width, height}` shape carrying a column and a row count.** Its own JSDoc (`Grid.ts:300-303`) apologises for the repurposing. Public and pinned by `tests/component/layout/Grid.test.ts:75-89`, so it is a rename, not a deletion — worth doing while F05.5 touches the method.

## Cross-slice notes

- **→ 01 core-component-lifecycle**: `Component.applyBounds` / `canSkipUnchangedLayout` (`Component.ts:3977-4001`) are reachable only from the Table. The seam this slice's F05.3 relies on exists and works; nothing in `layout/` uses it. Whoever owns the `Component` half should decide whether `commitBounds` adopting it changes `applyBounds`'s contract.
- **→ 01 core-component-lifecycle**: `Component.getWidth()` / `getHeight()` (`:4036`, `:4185`) allocate a `Size` object via `getSize()` (`:3339`) just to read one number. `commitBounds` calls both per child per pass and `reserveContentFrame` calls both again — 4 throwaway objects per child per frame before anything else.
- **→ 01 core-component-lifecycle**: `flushLayouts` (`Component.ts:218-240`) has no `try`/`catch` around `c.doLayout()`, so one throwing manager (F05.5) drops every remaining layout **and** the `afterNextLayout` callbacks for that frame. The same loop does `dirty.indexOf(p)` inside a walk over `dirty` — O(n²) in the number of dirty components per flush.
- **→ 01 core-component-lifecycle**: `Component.getLaidOutComponents()` (`:7049`) allocates a filtered array on every call; this slice alone calls it 104 times for a 31-component pass (F05.8). A cached list invalidated on add/remove/`setDisplayed` would fix it for every slice at once.
- **→ 02 core-component-styling**: `InlineStyle.flushDirty` (`core/StyleTarget.ts:457-459`) has no empty-bag guard, so every `commitBounds` emits `DOM.sink.apply(handle, { style: {} })` (F05.12). `StyleRule.flushDirty` (`:404-407`) already has the guard — copy it.
- **→ 06 layout-split-border-dockregion, 07 layout-tab-tabbar, 08 layout-accordion-table-serialization**: `Split`, `Border` and `Tab` commit through the same `commitBounds`/`placeComponent` chokepoint, so F05.1 and F05.3 land on them automatically; `Accordion` and `DockRegion` do not call it at all and need a separate look. F05.10's proposed `componentRemoved` hook would also serve `Tab`'s page bookkeeping and `Split`/`Border`'s collapsed-child ownership — agree the seam across those slices before adding it.
- **→ 06 layout-split-border-dockregion**: `Component.setContentClampSuspended` (`Component.ts:4118`) suspends the *committed-size* clamp for a collapsed pane whose box manager has lost its children, but the manager's *preferred/min* reports are still the degenerate `-spacing` / `UNBOUNDED` values of F05.6. If a collapsed pane in Loom is a `Component` with a `VBox`, its siblings are at risk.
- **→ plans/two-phase-baseline-resolution.md**: that plan's "Do not add a per-pass metrics cache" note is addressed head-on in F05.2 — the per-phase gather proposed there is narrower than a cache and makes the plan's extra `getBaselineMetrics()` sweep close to free. It also changes one of the plan's cost assumptions: it states the extra sweep is cheap because "both already called later in the same pass, both memoized" — `getPreferredSize` is **not** memoized on `Component` (only `Text`'s own text measurement is), and it is already called 4–8× per child per pass.

## Suggested plan grouping

**Plan A — "Lazy size reads in `resolveBounds`" (F05.1, rider: F05.14).** Self-contained, mechanical, measurable on its own, and the single best payoff-per-risk item in the slice: it removes one full recursive size descent per child per frame from every manager in the library. No dependencies. Do this first.

**Plan B — "Per-pass hint gather in the box layouts" (F05.2, F05.8, F05.13).** Gather `(preferred, min, max, baseline, constraints)` once per child per resolve phase in `HBox`/`VBox`/`Grid`/`HFlow`/`VFlow`, thread them into `resolveChildWidth`/`crossPlacement`/`resolveBounds`, key constraints on the `Component`, and stop re-fetching the child list. Depends on Plan A (it needs `resolveBounds` to accept pre-read hints). Coordinate with `two-phase-baseline-resolution` before starting.

**Plan C — "Layout-pass economy: box hygiene" (F05.4, F05.7, F05.9, F05.15).** Four independent small fixes that share a theme (work done in `doLayout` that the pass does not need) and one measurement: discarded `Grid.measureContent` sweeps, `reserveContentFrame`'s pre-check, `Fit`/`Card` bailing when unsized, and the `inflateForOverflow`/`reserveContentFrame` inconsistency. No dependencies; parallel-safe with A and B.

**Plan D — "Degenerate child sets" (F05.5, F05.6, F05.10, rider: dead-code §3, §7).** The correctness cluster: empty and all-undisplayed child lists, and the removed-visible-child case. All three are reachable through the merged undisplay/collapse work, all three want a regression test first. Independent of A–C, but F05.10's `componentRemoved` hook must be agreed with slices 06/07/08, so schedule that half after their reports land.

**Plan E — "Flow layout fold" (F05.11).** `HFlow`'s quadratic baseline row measurement. Standalone, small, low priority for the Loom shell — fold it into whichever plan next touches `HFlow`, or run it alone if flow layouts get a perf complaint.

**Rides along, too small to plan:** F05.12 goes to slice 02's `StyleTarget` plan (one line); F05.14 rides with Plan A or B; dead-code §1 (`overflowSizing`), §2 (`LayoutConstraints.description`), §4 (`VFlowColumn.baseline`) and §5 (`LayoutManager`'s three default-size fields) ride with Plan C as a single deletion commit; §6 needs no action beyond the note.
