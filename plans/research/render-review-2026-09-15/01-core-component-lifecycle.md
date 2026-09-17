# 01 core-component-lifecycle — render-work review

All paths below are relative to `packages/lib/src/typescript/lib/` unless stated.
Probe results quoted as `[P…]` come from throwaway tests in
`.worktrees/_probes/01-core-component-lifecycle/` (`lifecycle.probe.test.ts`,
`lifecycle2.probe.test.ts`), run against the lib's real vitest setup and the
modelled DOM; the run command is the one in the briefing.

## Summary

- **The unchanged-subtree layout skip is inert everywhere that matters.**
  `LayoutManager.commitBounds` — the commit path every box/grid/border/split
  manager funnels through — calls `component.doLayout()` unconditionally and
  never touches `Component.applyBounds`, so the `canSkipUnchangedLayout` gate
  is reachable only from the six `applyBounds` call sites, all inside `Table`.
  Exactly one class in the library overrides the gate (`table/cell/Cell.ts:256`).
  Every `Split` gutter drag, `Dock` pane resize and window resize therefore
  re-runs a full `doLayout()` for the whole tree, including the half whose
  rectangle is byte-identical (probe `PC`). Hot path 1. (F01.1)
- **A layout pass re-derives every size hint from scratch, many times per node.**
  One *unchanged* `doLayout()` over a 53-node tree costs 788 `getMaxSize` +
  788 `getMinSize` + 484 `getPreferredSize` calls (14.9/14.9/9.1 per node), each
  walking its own subtree; growth is superlinear in depth (6 nodes → 59
  `getMaxSize`; 13 nodes → 360). Nothing is memoised. **44 % of that work is
  charged to `Component.clampWidth`/`clampHeight`** inside `setWidth`/`setHeight`
  (probe `PJ`), which run two full content-size aggregations per axis per
  commit. Hot path 1, multiplied by every component on screen. (F01.2, F01.3)
- **A detached bordered subtree fires ~38 `getComputedStyle` reads per node per
  layout pass.** `getBorderSize`'s pre-connect estimate is uncached and resolves
  `var()` border widths through `DOM.source.getThemeVar`, i.e.
  `getComputedStyle(document.documentElement)`. One pass over a 4-node detached
  bordered subtree issued **152** of them (probe `PL`). Hot paths 5 and 6
  (dialog/menu open, offscreen panel build). (F01.4)
- **`Component.setSize` has no unchanged guard**: it writes geometry and calls
  `scheduleLayout()` even when both axes are identical. Any `doLayout` that
  calls `this.setSize` (today: `ProgressSpinner`'s overlay mode) therefore spins
  a layout pass plus a `requestAnimationFrame` **every frame, forever** — probe
  `PD` shows 5 frames still armed after 5 idle flushes — and every no-op
  viewport `resize` event costs a full-tree relayout. (F01.5)
- **Pure-waste DOM traffic per pass**: every component ends its commit with an
  empty `DOM.sink.apply` (53 empty style applies on a 53-node unchanged pass,
  31 on a 3-section `Accordion` frame), and the unbatched geometry-setter sites
  (`Split`'s live gutter drag, `Accordion`, `TabBar`, `ScrollStrip`) pay 8 style
  applies for 4 values, 4 of them unchanged re-writes (probe `PA`). (F01.6, F01.7)

---

## Findings

### F01.1 `commitBounds` recurses unconditionally — the `canSkipUnchangedLayout` skip never fires outside `Table`

- **Category**: D (avoidable layout pass), H (documented contract not met by the
  implementation)
- **Impact**: HIGH — per frame on hot path 1, multiplied by every component
  whose rectangle did not change
- **Where**:
  - `layout/LayoutManager.ts:547-571` (`commitBounds`; `component.doLayout()` at `:567`)
  - `core/Component.ts:3977-3989` (`applyBounds`), `:4000-4002` (`canSkipUnchangedLayout`)
  - `component/table/cell/Cell.ts:256` — the **only** override in the library
  - `docs/concepts/layout-system.md:29` states the opposite
- **Hot path**:
  - `Split` gutter `mousemove` (or `Body._onViewportResize` → `Component.setSize`)
  - → `scheduleLayout()` → `flushPendingLayouts` → `root.doLayout()`
  - → manager `doLayout()` → `placeComponent` → `resolveBounds` → `commitBounds`
  - → `component.setX/setY/setWidth/setHeight`
  - → **`component.doLayout()` — unconditional**
  - → that child's manager `doLayout()` → … to every leaf
- **Evidence**: `grep -rn "canSkipUnchangedLayout" packages/` returns one
  production override (`Cell`) plus a test helper. `grep -rn "\.applyBounds(\|\.setBounds("`
  returns 12 call sites, all in `layout/Table.ts`, `component/table/Body.ts`,
  `component/table/Header.ts`. `commitBounds` never calls either. Probe `PC`:
  in an unchanged `Split` pass, every node of a 5-deep chain inside the pane
  still gets exactly one `doLayout()` call. The implemented plan
  `plans/implemented/layout-calc-commit-split.md` explicitly scoped this out
  ("Any geometry-diff or skip-unchanged optimization … this plan implements
  none of it"; "Commit and recurse stay fused inside `commitBounds`") and says
  it exists to make one possible later — so this is that plan's intended
  follow-up, not a contradiction of it.
- **Proposed change**: route `commitBounds`'s final `component.doLayout()`
  through `Component.applyBounds`'s gate — i.e. have `commitBounds` compute
  `changed` from the four setters (as `writeBounds` already does) and recurse
  only when `changed || !component.canSkipUnchangedLayout() || component.isLayoutDirty()`.
  Then flip the default: `canSkipUnchangedLayout()` returning `true` on the base
  and `false` only for classes that mutate their own layout without moving their
  rectangle (`Cell`'s doc comment at `cell/Cell.ts:230-254` is the model list of
  what such a class looks like). A safer staged version keeps the base default
  `false` and opts in the containers on Loom's hot path first — `Panel`,
  `Container`, `Tab`'s pages, `Dock`'s regions.
- **Risk / blast radius**: every layout manager. The known hazards are (a) a
  component that dirties its own layout outside the setter pipeline — the
  existing `invalidateLayout()` escape hatch covers it and is already honoured
  by `applyBounds`; (b) a component with no element yet, which `applyBounds`
  already special-cases; (c) `Text`-style intrinsic re-measures, which relay
  through `_onPreferredSizeChange` and so re-dirty the ancestor rather than
  relying on the recursion. Tests that pin the current behaviour:
  `tests/core/ComponentBounds.test.ts` cases 5-10,
  `tests/component/table/CellLayoutSkip.test.ts`,
  `tests/component/table/Body.test.ts:460`.
- **Proof at implement time**: a probe asserting that a second `root.doLayout()`
  at unchanged bounds produces zero `doLayout` calls below the root (probe `PC`
  currently reports `[1,1,1,1,1]`); then ms/frame on the 2×2 editor-grid
  horizontal drag.

### F01.2 Size hints are re-aggregated from scratch on every query; the commit-time clamps are 44 % of it

- **Category**: D (layout work recomputed with unchanged inputs — missing
  cache), H
- **Impact**: HIGH — per frame on hot path 1, superlinear in tree depth
- **Where**:
  - `core/Component.ts:4164-4178` (`clampWidth`), `:4230-4244` (`clampHeight`)
  - `core/Component.ts:4055-4072` (`setWidth`), `:4204-4221` (`setHeight`) — each calls one clamp
  - `core/Component.ts:3543-3545` (`getMinSize`), `:3577-3579` (`getMaxSize`), `:3514-3536` (`mergeConstraintSize`)
  - `core/Component.ts:3376-3395` (`getPreferredSize`)
  - `layout/BoxLayout.ts:345-400` (`aggregateMaxSize` — walks `getLaidOutComponents()` and calls each child's `getMaxSize()`)
- **Hot path**:
  - `commitBounds` → `component.setWidth(w)`
  - → `clampWidth` → `this.getMaxSize()` → `getLayoutManager().getMaxSize()`
  - → `BoxLayout.aggregateMaxSize` → `container.getLaidOutComponents()` → per child `child.getMaxSize()` → … recurses to the leaves
  - → back in `clampWidth`: `this.getMinSize()` → the same walk again
  - → `commitBounds` → `component.setHeight(h)` → `clampHeight` → two more full walks
  - → four subtree aggregations per committed child, per frame
- **Evidence** (probe `P1`, `P1b`, `PH`, `PJ`, all on a settled tree, measuring a
  single `root.doLayout()` at unchanged geometry):
  - 53-node tree (`Panel(VBox) > 4 × Component(HBox) > 3 × Button`):
    `getMaxSize` 788 (14.9/node), `getMinSize` 788 (14.9/node),
    `getPreferredSize` 484 (9.1/node), `getPerimeterSize` 1470 (27.7/node),
    `getLaidOutComponents` 1662 (31.4/node).
  - Depth scaling (`P1b`): 6 nodes → 59 `getMaxSize`; 7 → 87; 9 → 158; 11 → 249;
    13 → 360. Node count ×2.2, call count ×6.1.
  - `PJ`: of 1576 combined `getMinSize`/`getMaxSize` calls in that pass,
    **688 (44 %) occur inside `setWidth`/`setHeight`**, i.e. inside the clamps.
  - `PH`: making every container a `Panel` (`clampsToContentSize() === false`,
    so the clamps use the cheap `getMaxSizeConstraint()` instead) drops a
    depth-8 chain from 384 to 248 `getMaxSize` calls — a 35 % cut from the
    clamp alone, with the manager-side aggregation untouched.
- **Proposed change**: two tiers, independently measurable.
  1. **Cheap, local, zero-contract-change**: compute the clamp bounds once per
     rectangle instead of four times. `writeBounds` (`:4020-4029`) and
     `commitBounds` already know they are writing all four values; resolve
     `getMinSize()`/`getMaxSize()` once into a local pair and have `setWidth` /
     `setHeight` take an optional pre-resolved bound (or add a private
     `clampSize(w, h)` the batched path uses). Removes ~3/4 of the 688.
  2. **Structural**: memoise `getMinSize()` / `getMaxSize()` / `getPreferredSize()`
     per component, invalidated by the relays the framework already runs —
     `_onPreferredSizeChange` / `_onConstraintSizeChange` (installed in
     `wireChild`, `:6718-6734`), `notifyIntrinsicSizeChanged` (`:7381-7386`),
     `insertComponent` / `removeComponent`. Note the gap that must be closed
     first: **`setDisplayed` does not fire either relay** (`:2304-2334`), yet it
     changes `getLaidOutComponents()` and therefore every aggregate above it,
     so a naive memo would go stale on a tab/card switch.
- **Risk / blast radius**: every layout manager reads these three methods; the
  `min ≤ preferred ≤ max` resolution rules in `docs/concepts/sizing.md` must not
  change. Tier 1 is contained to `Component` and `LayoutManager.commitBounds`.
  Tier 2 needs an invalidation audit of every writer of a size hint.
  Pinned by `tests/core/ComponentContentClamp.test.ts`,
  `tests/component/default-options-fallback.test.ts`, and the box-layout suites.
- **Proof at implement time**: re-run probe `P1`/`PJ` and assert
  `getMaxSize`/`getMinSize` per node drops below a threshold on an unchanged
  pass; then ms/frame on the 2×2 editor-grid drag.

### F01.3 Every size query allocates — ~5 400 short-lived objects per unchanged 53-node pass

- **Category**: G (allocation churn in the layout path)
- **Impact**: HIGH when combined with F01.1/F01.2 (it is their footprint), LOW on
  its own
- **Where**:
  - `core/Component.ts:3339-3344` (`getSize` returns a fresh object; `getWidth`/`getHeight` at `:4036`/`:4185` allocate one each just to read a number)
  - `core/Component.ts:3514-3536` (`mergeConstraintSize` — a fresh `Size` on every branch, by design)
  - `core/Component.ts:3409-3427` (`clampPreferredToConstraints` — a fresh `Size` per `getPreferredSize`)
  - `core/Component.ts:3764-3798` (`getPerimeterSize` — a fresh `PerimeterSize` per call)
  - `core/Component.ts:3619-3634` (`getInnerSize`), `:3651-3666` (`getContentBounds`)
  - `core/Component.ts:2624-2638` (`getContentInsets` — a fresh `Insets`)
  - `core/Component.ts:7049-7051` (`getLaidOutComponents` — `Array.filter`, a fresh array plus an `isDisplayed()` call per child, on every call)
- **Hot path**: same chain as F01.2; each hop allocates.
- **Evidence** (probe `P1`, one unchanged pass, 53 nodes): `getLaidOutComponents`
  1662 arrays, `getPerimeterSize` 1470 objects, `getMinSize`+`getMaxSize` 1576
  objects, `getPreferredSize` 484, `getSize` 250, `getContentInsets` 70 —
  ≈ 5 400 allocations for a pass that changes nothing. At 60 Hz on a tree an
  order of magnitude larger than this probe's, that is the GC pressure floor of
  a drag.
- **Proposed change**: mostly falls out of F01.2's memo (a cached `Size` is
  returned, not rebuilt). Independently worth doing: make `getWidth()`/`getHeight()`
  read `_width`/`_height` directly instead of going through `getSize()`; give
  `getLaidOutComponents()` a fast path that returns `_components` itself when no
  child is undisplayed (the common case), so no array is allocated.
- **Risk / blast radius**: `getLaidOutComponents()`'s return value is iterated by
  managers; returning the live `_components` array when nothing is filtered means
  a caller that mutates it would corrupt the child list — none does today, but it
  is worth a `readonly` signature. `getSize()` is public API and must keep
  returning a fresh object.
- **Proof at implement time**: an allocation counter in the probe (call counts on
  the six methods above) for an unchanged pass, before/after.

### F01.4 A detached bordered subtree issues an uncached `getComputedStyle` storm from `getBorderSize`

- **Category**: A (forced sync style read), D (missing cache)
- **Impact**: HIGH on hot paths 5 and 6 — dialog/menu open, offscreen panel
  build, first render of any bordered subtree
- **Where**:
  - `core/Component.ts:3685-3714` (`getBorderSize` — the estimate branch at `:3704-3713` is **not** cached into `_borderWidths`)
  - `core/Component.ts:3727-3750` (`estimateBorderSideWidth` → `DOM.source.getThemeVar`, recursing)
  - `core/DOM.ts:2331-2333` (`getThemeVar` = `getComputedStyle(document.documentElement).getPropertyValue(name).trim()`, no cache)
  - `core/Component.ts:3764-3798` (`getPerimeterSize` calls `getBorderSize()` — 27.7×/node/pass per F01.2)
- **Hot path**:
  - `Dialog`/`Menu`/lazy `Dock` panel built and laid out while still detached
  - → manager `doLayout()` → `container.getPerimeterSize()` → `getBorderSize()`
  - → `DOM.source.isConnected(element)` false → estimate branch
  - → `estimateBorderSideWidth` ×4 → `DOM.source.getThemeVar` → `getComputedStyle(documentElement)`
  - → repeated on every one of the ~28 `getPerimeterSize()` calls that node makes per pass, and on every subsequent pass while it stays detached
- **Evidence**: probe `PL` — a 4-node detached subtree whose borders are written
  as `var(--ts-ui-border-width, 1px) solid …` issues **152 `getThemeVar` calls
  and 38 `isConnected` calls in one `doLayout()`**. The connected path is fine:
  `measureBorderWidths` (`core/BorderWidths.ts:71-96`) shares one measurement per
  resolved border spec and `_borderWidths` memoises it per component. Only the
  pre-connect branch is uncached, and it is the branch that runs for exactly the
  subtrees that are built off-document.
- **Proposed change**: cache the estimate the same way the measurement is cached
  — store it in `_borderWidths` behind a `_borderWidthsProvisional` flag that
  `getBorderSize` clears the first time `isConnected` returns true, so the
  authoritative measure still replaces it on connect. Cheaper still, and useful
  to every caller: memoise `getThemeVar` per var name in `core/DOM.ts`, cleared
  by the `ThemeManager.onThemeChange` hook `core/BorderWidths.ts:112` already
  registers.
- **Risk / blast radius**: a themed border whose `var()` resolves differently
  after a theme change must not keep a stale estimate — the theme-change clear
  covers it. `tests/core/BorderWidths.test.ts` pins the sharing rules;
  `docs/concepts/sizing.md` and `getBorderSize`'s own JSDoc describe the
  estimate as deliberately uncached, so the doc changes with the code.
- **Proof at implement time**: probe `PL`'s `getThemeVar` count for the same
  detached pass (152 → ≤ 4), plus a real-engine Timeline recording of a `Dialog`
  open showing the recalc-style bars gone.

### F01.5 `Component.setSize` writes and schedules a layout even when the size is unchanged

- **Category**: B (unchanged-value write), D (avoidable layout pass, relayout loop)
- **Impact**: HIGH for the loop case (one wasted layout pass + one rAF **every
  frame, indefinitely**); MEDIUM for the window-resize case
- **Where**:
  - `core/Component.ts:3918-3936` (`setSize` — no equality guard, unlike `setWidth:4058` / `setHeight:4207` / `setX:4272` / `setY:4308`, which all have one)
  - `core/Body.ts:224-226` (`_onViewportResize` → `setSize`)
  - `component/display/ProgressSpinner.ts:287-289` (`doLayout()` calls `this.setSize(...)`)
  - `component/display/ProgressBar.ts:192-203`, `component/input/Slider.ts:506-532` (call `child.setSize(...)` from their own `doLayout`)
- **Hot path** (the loop):
  - `flushPendingLayouts` → `spinner.doLayout()`
  - → `this.setSize({ same width, same height })`
  - → `writeHorizontalGeometry()` + `writeVerticalGeometry()` (two style writes with identical values)
  - → `this.scheduleLayout()` → `pendingLayouts.add(this)` → `ensureFlushScheduled()`
  - → next frame, repeat — forever
- **Evidence**: probe `PD` — a component whose `doLayout` calls `this.setSize`
  leaves **5 frames armed after 5 idle flushes** (a settling component leaves 0).
  Probe `P2` — `setSize` with an identical size leaves `isLayoutDirty() === true`,
  arms one frame, and emits 2 style applies. This is the bug class
  `plans/implemented/relayout-loop-fix.md` chased (its Architecture Decisions
  rejected a *production* self-reschedule detector, which this fix does not
  reintroduce — it is the same "unchanged value → early return" setter idiom
  that plan adopted, applied at the base setter instead of at each caller).
- **Proposed change**: give `setSize` the same guard its per-axis siblings have —
  after clamping, if `width === this._width && height === this._height && this.getElement()`,
  return without writing or scheduling. Keep the `scheduleLayout()` on a real
  change. That fixes `ProgressSpinner` and every future caller at the source, and
  stops `ProgressBar`/`Slider` from re-queueing their children every pass.
- **Risk / blast radius**: 22 `setSize` call sites. The one behavioural
  difference is that a caller relying on `setSize` to force a relayout at an
  unchanged size loses it — `flushLayout()` / `doLayout()` / `invalidateLayout()`
  are the correct verbs for that and are already used elsewhere. `Body`'s first
  `setSize` in `init()` runs while `_width`/`_height` are `NaN`, so it is never
  short-circuited (`NaN !== NaN`).
- **Proof at implement time**: probe `PD` reporting 0 armed frames; and the
  `DiagnosticsOverlay`'s *layout passes per second* row falling to 0 on an idle
  Loom window with a spinner shown.

### F01.6 Every commit ends with an empty `DOM.sink.apply`

- **Category**: B, G
- **Impact**: MEDIUM — one wasted handle resolve + two allocations per component
  per layout pass, i.e. once per node per frame during a drag
- **Where**:
  - `core/Component.ts:1810-1819` (`setAutoCommitStyle(true)` → `commitElementStyle()`)
  - `core/Component.ts:1824-1830` (`commitElementStyle` → `_inlineStyle.flush()`)
  - `core/StyleTarget.ts:79-83` (`flush()` early-returns only on a null target, not on an empty bag)
  - `core/StyleTarget.ts:457-459` (`InlineStyle.flushDirty` → `DOM.sink.apply(target, { style: dirty })` unconditionally)
  - contrast `core/StyleTarget.ts:404-410` (`StyleRule.flushDirty` — which *does* early-return on an empty bag)
- **Hot path**: `commitBounds`/`applyBounds`/`setBounds` → `setAutoCommitStyle(true)`
  → `commitElementStyle()` → `InlineStyle.flush()` → `DOM.sink.apply(handle, { style: {} })`
  → `_registry.resolve(handle)` → `Object.keys({})` → nothing written.
- **Evidence**: probe `P1` — an unchanged 53-node pass produces
  `{"apply:style{}": 53}`, i.e. **53 applies, 0 of them carrying a declaration**.
  Probe `PB` — a 3-section `Accordion` unchanged pass produces 31 style applies,
  **all 31 empty**. Probe `P6c` — a single `Text.setText` produces one real style
  apply followed by three empty ones.
- **Proposed change**: give `StyleTarget.flush()` the empty-bag early return that
  `StyleRule.flushDirty` already has, so it is shared by both subclasses rather
  than duplicated in one of them.
- **Risk / blast radius**: `StyleTarget` is `core/StyleTarget.ts` (slice 02/03).
  The only behavioural change is that a no-op `apply` stops being recorded — a
  handful of tests assert apply counts (`tests/core/StyleRuleBatchedFlush.test.ts`,
  `tests/core/ComponentBounds.test.ts:64-81`) and would need their expectations
  re-read, not relaxed.
- **Proof at implement time**: probe `P1`'s write breakdown showing
  `apply:style{}` at 0 for an unchanged pass.

### F01.7 `setX`/`setY`/`setWidth`/`setHeight` each write both properties of their axis; unbatched call sites pay 8 writes for 4 values

- **Category**: B (unchanged-value write), G
- **Impact**: MEDIUM — per frame on hot path 1 for `Split`'s live gutter drag and
  on every `Accordion` / `TabBar` / `ScrollStrip` pass
- **Where**:
  - `core/Component.ts:4338-4346` (`writeHorizontalGeometry` writes **both** `left` and `width`), `:4353-4361` (`writeVerticalGeometry`)
  - called from `setX:4283`, `setY:4319`, `setWidth:4069`, `setHeight:4218`, `setSize:3930-3931`
  - unbatched callers: `layout/Split.ts:1369-1377` (the live gutter-drag handler),
    `layout/Accordion.ts:1508-1524` and `:1791-1794`,
    `component/container/TabBar.ts` (46 raw setter sites),
    `component/container/ScrollStrip.ts` (18), `component/container/Scrollbar.ts` (32)
- **Hot path**:
  - `SplitGutter` `mousemove` → `Split` drag handler (`Split.ts:1369`)
  - → `lhs.setWidth(n)` → `writeHorizontalGeometry()` → `InlineStyle.set("left", …)` → `DOM.sink.apply` *(unchanged value)*, then `set("width", …)` → `DOM.sink.apply`
  - → `gutter.setX(n)` → two more applies
  - → `rhs.setX(n)` → two more; `rhs.setWidth(n)` → two more
  - → 8 applies per frame, 4 of them re-writing a value the element already has
- **Evidence**: probe `PA` — four unbatched setters produce
  `[{left:10px},{width:100px},{top:20px},{height:50px},{left:10px},{width:200px},{top:20px},{height:80px}]`
  — **8 applies**; the same rectangle through `setBounds` produces **1 apply**
  with all four keys. Probe `PA2` — `setWidth(120)` on a component at `left: 40`
  re-writes `left: 40px`.
  The `left`/`top` re-write from `setWidth`/`setHeight` is genuinely redundant:
  `roundedExtent` (`:319-323`) makes the *extent* depend on the origin, not the
  other way round, so only `setX`/`setY` need to write the pair.
- **Proposed change**: two independent parts.
  1. Split the pair: have `setWidth`/`setHeight` write only their own extent, and
     leave the paired write to `setX`/`setY` (which must re-derive the extent from
     the new rounded origin). Removes two unchanged writes per component per pass.
  2. Give `StyleTarget` a last-written map so `set`/`queue` skip a same-value
     write outright, cleared on `attach`/`materialize`/`dispose`. This subsumes
     part 1 and also covers the `applyStyle` replay path.
  Separately (cross-slice): the hot unbatched call sites should bracket their
  writes in `setAutoCommitStyle(false)`/`(true)` or use `setBounds`.
- **Risk / blast radius**: part 1 is contained to `Component`; the invariant to
  keep is that a *move* still re-derives the extent (that is what
  `plans/research/codebase-health-audit-2026-08-29.md` item 7 and `roundedExtent`
  exist for), so only the `setWidth`/`setHeight` direction may be narrowed.
  Part 2 touches `core/StyleTarget.ts` (slice 02/03) and must not break
  `applyStyle`'s deliberate `removeAttr: ["style"]` wipe at `:6400`, which makes
  the element's real inline style diverge from any cache — the wipe has to clear
  the map too. `tests/core/ComponentBounds.test.ts:64-81` pins the batched shape.
- **Proof at implement time**: probe `PA` reporting ≤ 4 applies for the unbatched
  sequence and `PB` reporting 0 for an unchanged `Accordion` pass.

### F01.8 Scroll setters read back in the same task; the wheel handler adds two live metric reads per event

- **Category**: A (forced sync read after a write)
- **Impact**: MEDIUM — per scroll write and per wheel event on hot path 2,
  multiplied by the scrollable ancestors a wheel gesture walks
- **Where**:
  - `core/Component.ts:4395-4408` (`setScrollLeft`: `DOM.sink.apply(..., { scrollLeft })` then `DOM.source.getScrollLeft(element)`)
  - `core/Component.ts:4418-4431` (`setScrollTop`, same shape)
  - `core/Component.ts:4903-4916` (`writeNativeScroll` — the eased-wheel loop's per-frame write, same read-back)
  - `core/Component.ts:4588-4597` / `:4605-4614` (`getMaxScrollLeft`/`getMaxScrollTop` → `DOM.source.getScrollMetrics`)
  - `core/Component.ts:4950-4981` (`onWheelScroll` calls both at `:4959-4960`)
  - `core/Component.ts:4879` (`SmoothScroller`'s `clamp` calls them again, per eased frame)
- **Hot path**:
  - `wheel` (subtree listener, registered per scrollable component at `:4882`)
  - → `onWheelScroll` → `getMaxScrollLeft()` → `DOM.source.getScrollMetrics` **(live read)**
  - → `getMaxScrollTop()` → `DOM.source.getScrollMetrics` **(live read)**
  - → `SmoothScroller.scrollBy` → per animation frame: `read` → `getScrollLeft/Top` **(live read)**, `clamp` → `getScrollMetrics` **(live read)**, `write` → `writeNativeScroll` → scroll write **then** `getScrollLeft/Top` **(live read after the write)**
- **Evidence**: read directly from the code above; probe `PF` confirms
  `setScrollTop` performs a live `getScrollTop` read in the same call. The
  read-after-write is deliberate and documented (`docs/concepts/dom-seams.md:51`:
  "the cache invariant is restored by a *separate* `getScrollLeft` read of the
  settled value"), so this is a cost-of-design note, not a defect — but under the
  briefing's cost model a geometry read after a write in the same task flushes
  style+layout for the whole document, and this one runs on the scroll path.
- **Proposed change**: (a) coalesce `onWheelScroll`'s two `getScrollMetrics`
  calls into one — `getScrollMetrics` already returns all six values in one
  round-trip (`docs/concepts/dom-seams.md:49`), so `getMaxScrollLeft` +
  `getMaxScrollTop` should be one call, not two; the same applies to
  `SmoothScroller`'s `clamp`. (b) Defer the settle read-back out of the write
  task: keep the optimistic requested value in `_scrollLeft`/`_scrollTop` and
  reconcile from the element's own `scroll` event (or one read per gesture at the
  end), instead of one read per write. (c) Do not register the wheel listener at
  all while the component has no scrollable extent — `refreshWheelScrolling`
  (`:4852-4861`) keys only on the overflow *style*, not on whether anything can
  move, while `onWheelScroll` then re-checks the extent per event.
- **Risk / blast radius**: (b) changes the `getScrollLeft`/`getScrollTop` cache
  contract that `captureSubtreeScroll`/`restoreSubtreeScroll` (`:4539`, `:4568`)
  and `syncScrollOffsets` (`:4478`) depend on; `tests/core/ComponentSubtreeScroll.test.ts`
  and `tests/core/PanelScrollChaining.test.ts` pin it. (a) is safe and local.
  Overlaps slice 04 (`SmoothScroller`, `Panel`).
- **Proof at implement time**: a probe counting `DOM.source.getScrollMetrics` /
  `getScrollLeft` calls per synthetic wheel event; then a WebKitGTK Timeline
  recording of a wheel scroll over a `Tree` inside an `Accordion`.

### F01.9 Debug-only `data-*` attributes are ~95 % of the framework's attribute traffic

- **Category**: B, E, H (work nothing observable depends on)
- **Impact**: MEDIUM — per component at construction and first render; per
  `setPreferredSize` thereafter, which for a `Text` is per text change
- **Where**:
  - `core/Component.ts:2531-2536` (`setInsets` → `data-insets`), `:2547-2553` (`clearInsets`)
  - `core/Component.ts:3444` (`setPreferredSize` → `data-preferredSize`), `:3470` (`clearPreferredSize`)
  - `core/Component.ts:6035-6047` (`onStyleResolved` → `data-minSize` / `data-maxSize`, re-written on every `flushStyleBag` that resolves a size key)
  - `core/Component.ts:6576-6579` (`applyMiscInlineStyles` → `data-insets` again, per render)
  - `core/Component.ts:7121` and `:7147` (`data-layout`)
- **Hot path**: construction and first render (hot path 6); then
  `Text.setText` → `setPreferredSize` → `setDataAttribute("preferredSize", …)` →
  `ElementAttributes.set` → `DOM.sink.apply(..., { setAttr })` on every keystroke
  that changes a status-bar readout.
- **Evidence**: probe `PK` — building + first-rendering + laying out a 53-node
  tree produces **200 `setAttr` applies carrying 248 attribute writes**:
  `data-layout` 53, `data-minSize` 53, `data-maxSize` 29, `data-insets` 89,
  `data-preferredSize` 24 — against **12** real (`tabindex`) writes. Probe `P6b`:
  a single `Button` costs 14 `setAttr` applies at first render, every one of them
  `data-*`. Probe `P6c`: `Text.setText` emits
  `apply {"setAttr":{"data-preferredSize":"87px 16px"}}`.
  `grep -rn "data-insets\|data-preferredSize\|data-minSize\|data-maxSize" packages/`
  finds **no production reader** — only `Component` writing them and
  `tests/component/Component.test.ts:106-131` asserting them.
  (`data-ts-ui-tab-key-owner`, `data-ts-ui-navigation-target` and
  `data-ts-ui-clip-frame` are different — `FocusTraversal` / `SpatialNavigation`
  read those, and they must stay.)
- **Proposed change**: gate the five debug attributes behind a `Diagnostics`
  switch, defaulting off — the precedent is `Diagnostics.isTimingEnabled()`
  (`core/Diagnostics.ts:94`), already used to gate the layout-flush timing in
  `flushPendingLayouts` (`:206-207`). `DiagnosticsOverlay.open()` turns it on.
  Each write site becomes `if (Diagnostics.isInspectionEnabled()) …`.
- **Risk / blast radius**: the assertions in `tests/component/Component.test.ts`
  and `tests/component/default-options-fallback.test.ts:779-832` — the latter
  reads `data-ts-ui-tab-key-owner`, which is unaffected; the former would need to
  enable the switch. `Insets.render()` string allocation goes away with them.
- **Proof at implement time**: probe `PK` reporting `setAttr` applies down to the
  `tabindex`-only count.

### F01.10 `getElement()`'s by-id fallback turns construction into 5–23 document queries per component

- **Category**: D (work nothing needs), H (the documented "construction is
  JS-only" contract)
- **Impact**: MEDIUM — once per component at construction; startup cost only
- **Where**:
  - `core/Component.ts:1284-1297` (`getElement` — `DOM.source.getElementById(this.getId())` on every call while `_element` is unset, and the miss is never recorded)
  - `core/Component.ts:1914-1926` (`commitCSSRule` gates on `this.getElement()`, so **every** `setElementCSSRule` during construction issues a lookup)
  - `core/Component.ts:2235`, `:2251`, `:2312`, `:2329` (`setVisible`/`setDisplayed` each call `getElement()` twice)
  - `core/DOM.ts` — `ProductionDOMSource.getElementById` is a real `document.getElementById`
- **Hot path**: `new Button({ text })` → `applyOptions` → each chrome/style setter
  → `setElementCSSRule` → `commitCSSRule` → `getElement()` → `document.getElementById(uuid)` → miss.
- **Evidence**: probe `P6a`/`PI` — `getElementById` calls during **construction
  alone** (no render): bare `Component` 0, `Component({backgroundColor, border})`
  2, `Text` 6, `Panel` 5, **`Button` 23**.
  `docs/concepts/performance.md:178` and `ARCHITECTURE.md` §"Defer DOM work to
  render time" both state construction does no DOM work.
- **Proposed change**: assign `this._element` inside `render()` (`:7657-7664`)
  *before* `init()` runs, then gate `commitCSSRule` (and the other internal
  "am I rendered?" checks) on the field rather than on `getElement()`. The by-id
  fallback is load-bearing today precisely because `_element` is still unset
  while `init()` runs — which is the only reason those mid-render `getElement()`
  calls resolve — so the assignment must land first; after that the fallback can
  be narrowed to `getElement(true)` or dropped.
- **Risk / blast radius**: `Body` overrides `getElement()` entirely
  (`core/Body.ts:198-200`) and is unaffected. `release()` already reads
  `_element` directly and documents why (`:1348-1350`). The risk is any consumer
  relying on a `Component` adopting a pre-existing element with a matching id —
  `grep` finds none. `tests/core/DisposedPendingLayout.test.ts` ("skips a
  component that never rendered") pins the `getElement()` guard in
  `flushPendingLayouts` and must keep passing.
- **Proof at implement time**: probe `P6a` reporting 0 `getElementById` calls for
  every construction.

### F01.11 `pauseLayout()` does not pause the subtree, contrary to its documentation

- **Category**: H (function/implementation mismatch)
- **Impact**: LOW — a correctness/expectation gap, not a per-frame cost
- **Where**:
  - `core/Component.ts:7157-7168` (`isLayoutPaused` / `pauseLayout` — a per-component flag)
  - `core/Component.ts:7225-7227` (`doLayout` checks `this.isLayoutPaused()` only)
  - `core/Component.ts:218-240` (`flushPendingLayouts` prunes only components whose ancestor is **in the dirty snapshot**)
  - `docs/concepts/performance.md:35` — "blocks the rAF queue from running on this component (and its subtree)"
- **Evidence**: a descendant of a paused component that schedules its own layout
  is not pruned (its paused ancestor is not itself in `pendingLayouts`) and its
  own `doLayout()` sees its own unset flag, so it runs. The pause only prevents
  the *ancestor's recursion* from reaching it.
- **Proposed change**: either walk ancestors in `isLayoutPaused()` (and in
  `scheduleLayout`'s guard), or correct the doc page and
  `docs/concepts/component-lifecycle.md:111` to say the pause is per-component.
  The doc fix is the smaller change and matches what every current caller wants.
- **Risk / blast radius**: an ancestor walk on `scheduleLayout`/`doLayout` puts
  work on the hottest path in the framework — the same objection
  `plans/implemented/relayout-loop-fix.md` raised against its dev-mode guard. The
  doc fix has none.
- **Proof at implement time**: a probe asserting the documented behaviour either
  way.

### F01.12 The `release()` / `canRelease()` subsystem has no production opt-in

- **Category**: H (speculative generality), J (unreachable in production)
- **Impact**: LOW — code health; ~90 lines plus a branch in `init()`
- **Where**:
  - `core/Component.ts:1343-1382` (`release`), `:4150-4152` (`canRelease`, default `false`)
  - `core/Component.ts:551-553` (`_pendingRematerialize`, `_refocusOnRematerialize`), `:4441-4449` (`restoreReleasedState`), `:7597-7606` (the `init()` rematerialise branch)
  - `docs/concepts/component-lifecycle.md:73-82` documents it as public API
- **Evidence**: `grep -rn "canRelease" packages/` → one definition, one call, and
  one override, the last in `tests/component/element-release.test.ts:81`.
  `grep -rn "\.release()" packages/` (component receivers) → only that test file;
  the one production hit is `CellEditorPool.release()`, a different class. So
  `release()` returns `false` for every component that exists in the library, and
  the documented use cases ("an offscreen tab's content, a virtualized row you
  expect to come back") are implemented by neither `Tab` nor `VirtualRowView`.
- **Proposed change**: either land the first real consumer (`Tab`'s inactive
  pages are the obvious candidate now that `undisplay-inactive-tab-pages` has
  shown the shape of the problem) or retire the subsystem and its doc section.
  Do not leave it in the middle — the `init()` branch and the two fields are paid
  for by every component.
- **Risk / blast radius**: public documented API; removal is a breaking change to
  the docs page even though nothing calls it.
- **Proof at implement time**: n/a (code health).

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `Component` — construction / options (`:731-916`) | Build the JS object; defer all DOM to render | none intended | 0 writes; **5–23 `getElementById` reads per instance** | mismatch | F01.10 |
| `Component` — listener/theme/destroy wiring (`:928-985`) | Register `listeners` bag, theme subs, destroy hooks | none | none | fits | — |
| `Component` — `dispose`/`destructor`/handles (`:1001-1231`) | Recursive teardown; release handles, rules, subs | removes element, disposes rules | none (teardown only) | fits | — |
| `Component` — element lifecycle (`:1284-1382`) | Lazy element, detach, release | root element handle | 1 `getElementById` per call while unrendered | over-built (release half) | F01.10, F01.12 |
| `Component` — clip / content frames (`:1410-1677`) | Interpose a sized wrapper for clipping / scroll extent | 1 extra `<div>` each | geometry writes only when a manager (re)frames | fits | — |
| `Component` — element attr / style seams (`:1686-1926`) | Buffered attribute, inline-style and rule writes | element attrs, inline style, `#id` rule | 1 empty `apply` per commit; `commitCSSRule` per commit | fits (bar the empty flush) | F01.6 |
| `Component` — id / name / data attrs (`:1933-2113`) | Identity + data-carrying attributes | `id`, `data-*` | 5 debug `data-*` at render, 1 per `setPreferredSize` | over-built | F01.9 |
| `Component` — visible / displayed / effective (`:2191-2438`) | Tri-state visibility, `display:none`, coalesced subtree reconcile | one class token per state | 1 class toggle per change; rAF-coalesced walk | fits | — |
| `Component` — dirty flag (`:2449-2513`) | Own + descendant uncommitted-edit state | none | none | fits | — |
| `Component` — insets / padding / content insets (`:2520-2638`) | Layout spacing bands | `data-insets`, `padding` rule | 1 `Insets` alloc per `getContentInsets` (1.3/node/pass) | fits | F01.3, F01.9 |
| `Component` — size constraints (`:3339-3612`) | Report preferred/min/max upward | `data-*Size` only | **14.9 `getMinSize` + 14.9 `getMaxSize` + 9.1 `getPreferredSize` per node per pass**, uncached | over-built | F01.2, F01.3 |
| `Component` — inner size / perimeter / border (`:3619-3798`) | Derive the content rectangle | none | 27.7 `getPerimeterSize` per node per pass; **152 `getThemeVar` per detached pass** | mismatch (detached path) | F01.3, F01.4 |
| `Component` — baseline (`:3816-3849`) | Text-baseline alignment offset | none | 1 manager call + border/inset reads per query | fits | — |
| `Component` — vertical-align trio (`:3851-3880`) | CSS `vertical-align` | `#id` rule | none | dead | F01.13 (below) |
| `Component` — `setSize`/`setBounds`/`applyBounds`/`writeBounds` (`:3918-4029`) | Commit a rectangle, then recurse if it changed | `left`/`top`/`width`/`height` inline | 1 batched apply (batched sites); **8 applies (unbatched sites)**; `setSize` schedules unconditionally | mismatch | F01.1, F01.5, F01.7 |
| `Component` — width/height/x/y + clamps (`:4036-4361`) | Per-axis commit with self-clamping | inline style | 2 style writes per setter; 2 full size aggregations per clamp | over-built | F01.2, F01.7 |
| `Component` — scroll offsets & subtree capture (`:4372-4614`) | Cached native scroll, capture/restore around `display:none` | `scrollLeft`/`scrollTop` | 1 live read-back per write; 2 `getScrollMetrics` per max query | fits (by design), costly | F01.8 |
| `Component` — wheel scrolling (`:4841-4981`) | Eased wheel over native scroll | subtree `wheel` listener | 2 `getScrollMetrics` per wheel event + 3 reads per eased frame | over-built | F01.8 |
| `Component` — focus (`:5464-5491`) | `DOM.sink.focus` / `blur` wrappers | none | none | fits | — |
| `Component` — children & constraints (`:6671-7100`) | Child list, DOM mounting, constraint relay | `insertBefore` / `appendChild` | `getLaidOutComponents` allocates 31.4 arrays per node per pass | over-built | F01.3 |
| `Component` — layout manager (`:7107-7150`) | Resolve / attach the manager, mirror `data-layout` | `data-layout` | none | fits | F01.9 |
| `Component` — pause / resume (`:7157-7187`) | Suspend automatic passes | none | none | mismatch (doc) | F01.11 |
| `Component` — `doLayout` / `onFirstLayout` (`:7194-7310`) | Run the manager; drain first-connected callbacks | none | 1 `Diagnostics` increment; 1 `isConnected` read when a callback is queued | fits | — |
| `Component` — layout queue (`:179-252`, `:7322-7450`) | rAF-coalesced flush with ancestor pruning | none | O(D²·H) ancestor scan (measured negligible) | fits | see *Redundant…* |
| `Component` — visibility queue (`:261-281`, `:7459-7465`) | rAF-coalesced effective-visibility reconcile | none | none per layout pass | fits | — |
| `Component` — `init` / `render` (`:7546-7664`) | Create the element, bind buffers, mount children | element, class tokens, all replayed styles | one-off | fits | — |
| `core/ComponentDefaults.ts` | One frozen defaults bag per class | none | none | fits | inventory note below |
| `core/BorderWidths.ts` | Share one measured border width per resolved spec | none | 1 `getBorderWidths` per distinct spec per theme | fits | F01.4 (the *un*cached sibling path is in `Component`) |
| `core/Callable.ts` | Call a class with or without `new` | none | none | fits | inventory note below |

Two inventory notes that are not findings:

- `ComponentDefaults.resolveClassDefaults` (`:86-109`) caches only the **first**
  bag per constructor (`if (!entry) cache.set(...)`). `Panel` seeds
  `{ insets: new Insets(0,0,0,0) }` per instance when `flush` is set
  (`core/Panel.ts:292`), so that identity check never matches and every flush
  `Panel` allocates and `Object.freeze`s a fresh bag. Two `Object.keys`/`filter`
  arrays are also allocated per construction on the hit path. Construction-only,
  small.
- `Callable.callable` (`:58-88`) mirrors every own static of the wrapped class
  onto the wrapper as an accessor. That means a class's `ownStyleStates` /
  `ownClassStyleDefaults` / `ownStyleTraits` are *own properties of both* the
  wrapper and the raw class, and `ClassStyleRules`'s hierarchy walk uses
  `Object.getPrototypeOf` plus own-property checks. I did not verify whether the
  walk therefore sees each declaration twice — **not verified**; it belongs to
  slice 02 and is flagged in *Cross-slice notes*.

---

## Redundant, duplicated and dead code

Counts below are from `grep -rn "<symbol>" packages/ --include=*.ts`, excluding
`node_modules/`, `packages/lib/dist/` and the definition site itself; generated
TypeDoc pages under `packages/lib/docs/api/` are excluded too (every inherited
member is re-listed there, so they are not callers).

### F01.13 Zero-caller public members on `Component`

| Symbol | Where | Callers (prod) | Callers (tests) |
|---|---|---|---|
| `sync()` | `core/Component.ts:6657-6664` | 0 | 0 |
| `hasElementAttribute(key)` | `:1686-1694` | 0 | 0 |
| `getElementAttribute(key)` | `:1703-1711` | 0 | 0 |
| `getAutoCommitAttributes()` | `:1837-1839` | 0 | 0 |
| `doChildrenComponentLayouts()` | `:7194-7206` | 0 | 0 |
| `getVerticalAlign()` / `setVerticalAlign()` / `clearVerticalAlign()` + the `_verticalAlign` field | `:579`, `:748`, `:3851-3880` | 0 | 0 |

`sync()` is the worst of these: it is the last remaining consumer of the
`DOM.source.getElementById` path outside `getElement`, and its name is shadowed
in the same hierarchy by `Table.sync()` (`component/table/Table.ts:1092`), which
means something entirely different (flush the record store). A consumer calling
`someComponent.sync()` gets style re-application on most components and a store
round-trip on a `Table`. Retire it, or rename it (`reapplyStyle()`).

`_verticalAlign` is seeded to `"baseline"` in the constructor (`:748`) but nothing
ever writes it to CSS unless `setVerticalAlign` is called, which nothing does.

### Pure pass-through `getElement` overrides

`component/input/Text.ts:359-361` and `component/input/TextInput.ts:856-858` are
both `getElement(createIfMissing = false) { return super.getElement(createIfMissing); }`
— no behaviour, only a re-stated JSDoc. Belongs to slices 14 and 15; noted here
because it is `Component.getElement`'s contract being restated.

### `flushPendingLayouts`'s ancestor prune is O(D²·H) — measured negligible

`core/Component.ts:218-227` scans the dirty **array** with `indexOf` once per
ancestor level per dirty component. Probe `PG`: a flush with 240 queued
components across a 2-deep tree measured **0.00 ms**. Worth converting to a `Set`
membership test when someone is already in the file (the `pendingLayouts` `Set`
is cleared at `:213` before the loop, so the snapshot needs its own `Set`), but
not worth a plan of its own.

### Audit items from `codebase-health-audit-2026-08-29.md` that touch this slice

- **Item 7** (`round-layout-coordinates` breaks gap-free adjacency; `Component.ts:3842, 3946, 4007, 4043`)
  is **closed**: `roundedExtent` (`:307-323`) now derives the extent from the
  rounded origin, and the companion "device pixel" JSDoc error is gone
  (`setX`'s remark at `:4262-4269` now says "nearest CSS pixel").
- **Item 107's** `Component.getCSSRule()` and `Component.clearPosition()` are
  **closed**: `grep -rn "getCSSRule\|clearPosition" packages/ --include=*.ts`
  returns 0 hits.
- No other audit item lands in this slice.

---

## Cross-slice notes

- **→ 02 core-component-styling / 03 core-dom-seam-events**:
  `StyleTarget.flush()` (`core/StyleTarget.ts:79-83`) does not early-return on an
  empty dirty bag, and `InlineStyle.flushDirty` (`:457-459`) therefore issues a
  `DOM.sink.apply` per component per layout commit that writes nothing
  (53 per 53-node unchanged pass). `StyleRule.flushDirty` (`:404-410`) already
  has the guard — lift it to the base. See F01.6.
- **→ 03 core-dom-seam-events**: `ProductionDOMSource.getThemeVar`
  (`core/DOM.ts:2331-2333`) is an uncached `getComputedStyle(document.documentElement)`.
  It is reached 152 times in one layout pass over a small detached bordered
  subtree (F01.4). A per-name memo cleared on theme change would fix that at the
  seam for every caller, not just `Component`.
- **→ 03 core-dom-seam-events**: the same slice owns `DOMSink.apply`'s registry
  resolve, which is what an empty apply wastes; and `Event.addSubtreeListener`,
  which `attachWheelScrolling` (`:4882`) registers for every component whose
  overflow style is `auto`/`scroll` regardless of whether anything can scroll.
- **→ 05 layout-base-box-flow-grid**: `LayoutManager.commitBounds:547-571` is the
  actual locus of F01.1 — the `doLayout()` at `:567` is unconditional and bypasses
  `Component.applyBounds` entirely. `BoxLayout.aggregateMaxSize:345-400` (and its
  min/preferred siblings) is the recursion F01.2 measures; a `Component`-level
  memo only helps if the managers' own aggregates are memoised with it.
- **→ 06 layout-split-border-dockregion**: `Split.ts:1369-1377` — the live
  gutter-drag handler writes `setWidth`/`setX`/`setHeight`/`setY` with
  auto-commit on, costing 8 inline-style applies per frame where 3 batched
  writes would do. See F01.7.
- **→ 08 layout-accordion-table-serialization**: `Accordion.placeSection`
  (`layout/Accordion.ts:1503-1527`) and the gutter placement (`:1791-1794`) do the
  same, three components at a time; probe `PB` shows the resulting 31 style
  applies per unchanged pass, all empty.
- **→ 07 layout-tab-tabbar / 04 core-panel-scrolling**: `TabBar` (46 sites),
  `ScrollStrip` (18) and `Scrollbar` (32) are the other large unbatched
  geometry-setter populations.
- **→ 14 text-and-small-display**: `ProgressSpinner.doLayout` calls
  `this.setSize(...)` (`component/display/ProgressSpinner.ts:287-289`), which with
  today's `Component.setSize` is a perpetual relayout loop (F01.5, probe `PD`).
  `ProgressBar.doLayout` (`:192-203`) re-queues its two children every pass for
  the same reason. Fixing `setSize` fixes both without touching those files.
  Also: `Text.getElement` is a no-op override (see above).
- **→ 15 inputs-text-boolean-slider**: `Slider.doLayout` (`component/input/Slider.ts:506-532`)
  calls `child.setSize` three times per pass — same mechanism as above.
  `TextInput.getElement` is a no-op override.
- **Seam my slice relies on that does not hold**:
  `docs/concepts/layout-system.md:29` describes `applyBounds` as *the* join
  between committing a rectangle and recursing. It is not — `commitBounds` is,
  and it does not diff. Any slice reasoning about "a child handed the same
  rectangle is not re-laid-out" is reasoning about behaviour that only `Table`
  cells get.

---

## Suggested plan grouping

**Plan A — "Skip the unchanged subtree" (F01.1).** Route `commitBounds`'s recurse
through the `applyBounds` gate and opt the container classes in. Independently
measurable on the 2×2 editor-grid drag. *Depends on:* nothing. *Blocks:* nothing,
but it multiplies Plan B's payoff (fewer nodes reached × cheaper per node).
Needs slice 05's agreement on `LayoutManager`.

**Plan B — "Resolve each component's size hints once per pass" (F01.2 + F01.3).**
Two steps, shippable separately: (B1) one clamp resolution per rectangle instead
of four, contained to `Component` + `commitBounds`; (B2) a memo on
`getMinSize`/`getMaxSize`/`getPreferredSize` invalidated by the existing size
relays, plus the missing `setDisplayed` invalidation. B1 first — it is
low-risk, locally provable, and removes ~44 % of the aggregation on its own.
*Depends on:* nothing. *Coordinate with:* slice 05 (the managers' own aggregates).

**Plan C — "Stop writing what is already there" (F01.6 + F01.7).** The empty-bag
guard in `StyleTarget.flush`, the `setWidth`/`setHeight` paired-write split, and
optionally a last-written map on `StyleTarget`. One coherent change set with one
counter to watch (style applies per frame). *Depends on:* nothing. *Coordinate
with:* slice 02 (owns `StyleTarget`). The unbatched call sites in `Split`,
`Accordion`, `TabBar`, `ScrollStrip` can ride along or be their own follow-up per
slice.

**Plan D — "Cache the pre-connect border estimate" (F01.4).** `Component`'s
provisional `_borderWidths` plus, ideally, a `getThemeVar` memo in `core/DOM.ts`.
Measurable on a `Dialog` open and on first render. *Depends on:* nothing.
*Coordinate with:* slice 03 if the `DOM.ts` memo is included.

**Plan E — "No-op setters do nothing" (F01.5).** The `setSize` unchanged guard.
Two lines, kills a perpetual rAF loop, and it should ship on its own so the
`DiagnosticsOverlay` layout-passes-per-second reading is attributable. *Depends
on:* nothing.

**Plan F — "Debug metadata is opt-in" (F01.9) and "construction is JS-only"
(F01.10).** Group them: both are startup-cost reductions with the same shape
(stop doing something nothing reads), both touch only `Component`, and both are
proved by the same construction/first-render probe. *Depends on:* nothing.

**Rides along, too small to plan:** F01.11 (the `pauseLayout` doc correction —
attach to whichever plan touches the layout queue), the `flushPendingLayouts`
`Set` swap (attach to Plan A, which is already in that function's neighbourhood),
and F01.13's dead-member removals (attach to Plan F, which is already editing
those regions). **F01.12** (the unused `release()` subsystem) is a product
decision, not a perf plan — raise it with the user before either landing a
consumer or retiring it.
