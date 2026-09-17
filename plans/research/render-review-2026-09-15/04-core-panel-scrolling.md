# 04 core-panel-scrolling — render-work review

**Summary**

- `ScrollStrip.layoutArrows` re-sets both arrow glyphs on **every** layout pass
  (`ScrollStrip.ts:801-802`). `Button.setGlyph` has no same-name guard, so each
  pass destroys and rebuilds two `Glyph` components: **2 `deleteStyleRule` + 2
  `ensureStyleRule` + 2 `setRuleStyles` per strip per frame** — stylesheet-rule
  mutations on hot path 1, the one thing the cost model prices at ~195 ms/frame
  a piece. Probe: 108 recorded DOM ops on an identical pass, **76 of them from
  `setGlyph` alone**. Multiplies by visible tab strip (F04.1).
- A settled overlay `Panel` whose own rect **did not change** still runs the
  full live remeasure every frame: **2 `getScrollMetrics` reads, each after a
  write in the same task (= 2 forced synchronous layouts), plus 4
  unchanged-value inline-style writes and 2 empty-bag flushes**. The
  `panel-scroll-metrics-resize-coalescing` gate only arms on *this panel's own*
  size change, so the panels that merely get re-laid-out during an ancestor
  resize are never coalesced. Probe: 10 identical `applyBounds` frames → 20
  reads, 60 applies, settle relay never armed (F04.2).
- Every overlay `Panel` registers **two** separate subtree `"scroll"` listeners
  that each re-read the element: **3 `getScrollMetrics` per scroll event**, two
  of them redundant, plus a per-scroll overlay *resize* write whose input cannot
  change on a scroll. Because both are subtree listeners, a **descendant's**
  scroll (a nested `CodeEditor`, a nested `Panel`) pays the same 3 reads on the
  ancestor (F04.3).
- `SmoothScroller.step` writes **both** axes every frame, and
  `Component.writeNativeScroll` reads the offset back after each write: **2
  forced synchronous layouts per wheel-ease frame, one of them for an axis that
  never moved**. Each wheel event costs a further 4 `getScrollMetrics` through
  the clamp path (F04.4).
- The 2026-08-29 health audit's duplication item #5 (`Panel` vs
  `VirtualScroller` scrollbar layout, duplicated `setShadowEdge`) is **still
  open**, and the open `overlay-scrollbars-non-panel` plan would add a third
  copy. A shared numeric core would also let `Panel` drop its second live read
  entirely (F04.7).

---

## Findings

### F04.1 `ScrollStrip.layoutArrows` rebuilds both arrow glyphs — and their stylesheet rules — on every layout pass

- **Category**: C (stylesheet-rule write on a hot path), B (unchanged-value write), G (allocation/listener churn), D (avoidable work in `doLayout`)
- **Impact**: **HIGH** — per frame on hot path 1, once per *overflowing* visible strip. Loom's 2×2 editor grid has four tab strips; at four overflowing strips that is 8 rule deletes + 8 rule inserts + 8 rule writes per frame.
- **Where**:
  - `component/container/ScrollStrip.ts:801-802` — `lead.setGlyph(...)` / `trail.setGlyph(...)`, unconditional.
  - `component/button/Button.ts:1789-1819` — `setGlyph` has no same-name guard: it allocates a new `ButtonIconGlyph`, calls `_rebuildContentRow()`, `outgoing?.dispose()` (deletes the outgoing glyph's per-instance `#id` rule) and `recomputePreferredSize()`.
  - `component/container/ScrollStrip.ts:744-773` — `layoutContent` → `layoutArrows` on every pass.
  - `component/container/TabBar.ts:2911` — `this._tabClip.layoutContent(arrowReserve, endGap)` inside `layoutChrome`, i.e. every `TabBar` layout pass.
- **Hot path**:
  1. `Split`/`Dock` gutter drag or window resize → `doLayout` from `Body` down
  2. → `TabBar.doLayout` → `TabBar.layoutChrome` (`TabBar.ts:2874`)
  3. → `ScrollStrip.layoutContent` (`TabBar.ts:2911`)
  4. → `ScrollStrip.layoutArrows` (`ScrollStrip.ts:770`)
  5. → `Button.setGlyph("angle-left")` and `Button.setGlyph("angle-right")` (`ScrollStrip.ts:801-802`) — same names as last frame
  6. → `Glyph` construction + `_rebuildContentRow()` + `outgoing.dispose()` → `DOM.sink.deleteStyleRule` / `ensureStyleRule` / `setRuleStyles`
- **Evidence**: probe `.worktrees/_probes/04-core-panel-scrolling/scrollstrip.probe.test.ts`, third identical `layoutContent(reserve, 0)` pass on a 7-button horizontal strip in a 140 px band:

  ```
  SCROLLSTRIP identical pass (overflowing): total=108 createElement=2 appendChild=8
    removeElement=6 ensureStyleRule=2 setRuleStyles=2 deleteStyleRule=2 release=6 apply=66
  SCROLLSTRIP identical pass (fits): total=0
  SCROLLSTRIP-ATTR setGlyph stubbed identical pass: total=32
  ```

  With `Button.prototype.setGlyph` stubbed to a no-op the same pass falls from
  108 ops to 32 — and **all** of `createElement`, `createElementNS` (×8),
  `appendChild` (×8), `removeElement` (×6), `release` (×6), `ensureStyleRule`
  (×2), `deleteStyleRule` (×2) and `setRuleStyles` (×2) disappear. The
  `deleteStyleRule`/`ensureStyleRule` selectors in the probe output are two
  distinct per-instance `#id` rules — a real delete-and-reinsert on the shared
  sheet, not a same-value write. A non-overflowing strip (no arrows) is already
  perfectly silent (`total=0`), so this is entirely the arrow path.
- **Proposed change**: `Button.setGlyph(name)` gains an early `if (this._glyph?.getName() === name) return this;` guard (or `ScrollStrip.layoutArrows` caches the last glyph name per arrow and calls `setGlyph` only on an orientation change). The guard in `Button` is the better home — every per-pass `setGlyph` caller benefits and it matches the value-guard convention already in `setBackgroundColor` (`Component.ts:2656`) and `setStyleState` (`Component.ts:6213`). `layoutArrows` should additionally hoist the two `setGlyph` calls out of the per-pass body into `ensureArrows()` + `setOrientation`, since the glyph depends only on orientation.
- **Risk / blast radius**: `Button.setGlyph` is public and called from `applyOptions` (`Button.ts:819,1010`), `ToolBar`, `MenuItem`, `TabCloseButton`, `ScrollStrip`. A same-name guard changes behaviour only for a caller that relies on `setGlyph` as a *refresh* (e.g. after a `Glyph.register` of a different sprite under the same name) — `Glyph.register` is a module-level seed in `ScrollStrip.ts:23`, not a runtime re-registration, so no shipped caller does. Tests pinning `setGlyph`: `component/button/*.test.ts` (glyph swap), `component/container/ScrollStrip.test.ts`. The `layoutArrows` half is internal.
- **Proof at implement time**: rerun the probe above and assert `total <= 32`, `deleteStyleRule === 0`, `ensureStyleRule === 0` on an identical pass; harness: ms/frame on the 2×2 editor-grid horizontal gutter drag with ≥6 tabs per strip (arrows shown).

---

### F04.2 `Panel.doLayout` remeasures live on every pass whose own rect did not change — the resize coalescing never engages for it

- **Category**: A (forced sync read on a hot path), D (avoidable layout work), B (unchanged-value write), E (work for invisible/unchanging content)
- **Impact**: **HIGH** — per frame on hot path 1, once per *scrolling* `Panel` in the tree whose own rect is stable while an ancestor resizes (a fixed-width rail, a `Border` north/south region, an edge pane, any panel on the non-moving side of a gutter). Two forced synchronous layouts each.
- **Where**:
  - `core/Panel.ts:650-706` — `doLayout`
  - `core/Panel.ts:660` — `this.commitElementStyle()` (the write the reads land after)
  - `core/Panel.ts:671-672` — `if (!this.deferScrollMetricsWhileResizing(sizeChanged)) this.remeasureScrollMetrics();`
  - `core/Panel.ts:740-760` — `deferScrollMetricsWhileResizing`: with no settle handle armed it returns `false` for **every** pass, and only arms one when `sizeChanged`
  - `core/Panel.ts:1102` — `DOM.source.getScrollMetrics(el)` (read 1)
  - `core/Panel.ts:925-930` — `measureOverlayLayout`: `_overlayScrollStyle.setMany(...)` then `DOM.source.getScrollMetrics(innerEl)` (read 2, deliberately after the write)
  - `core/Component.ts:3982, 4000` — `applyBounds` recurses into `doLayout()` unless `canSkipUnchangedLayout()` is `true`; the default is `false` and only `component/table/cell/Cell.ts:256` overrides it, so **no `Panel` ever skips**.
- **Hot path**:
  1. gutter drag / window resize → `LayoutManager.commitBounds` → `child.applyBounds(x, y, w, h)` with the child's *existing* rectangle
  2. `applyBounds` (`Component.ts:3982`) — `changed === false`, but `canSkipUnchangedLayout()` is `false` → `this.doLayout()`
  3. `Panel.doLayout` → `commitElementStyle()` (write)
  4. `sizeChanged === false`, `_scrollMetricsSettleHandle === null` → `deferScrollMetricsWhileResizing` returns `false` (`Panel.ts:745-751`)
  5. `remeasureScrollMetrics()` → `getScrollMetrics(panelEl)` — **forced layout #1**
  6. → `measureOverlayLayout` → 2 inline writes → `getScrollMetrics(innerEl)` — **forced layout #2**
  7. → `commitOverlayLayout` + `resolveShadowOverlaySize`/`applyShadowOverlaySize` → 2 more inline writes
- **Evidence**: probe `.worktrees/_probes/04-core-panel-scrolling/panel2.probe.test.ts` / `panel4.probe.test.ts`, overlay `Panel({autoScroll:'auto'})` at 400×300 with 900 px of content, settled, then handed the identical rect 10 times:

  ```
  P04-A unchanged-bounds x10: getScrollMetrics=20, apply=60, settleHandleArmed=false
  P04-B never-overflowed x10: getScrollMetrics=20, apply=60
  P04-H frame 2: [["apply","panelEl",{"style":{}}],
                  ["apply","innerScroller",{"style":{"width":"388px"}}],
                  ["apply","innerScroller",{"style":{"height":"288px"}}],
                  ["apply","shadowOverlay",{"style":{"width":"388px"}}],
                  ["apply","shadowOverlay",{"style":{"height":"288px"}}],
                  ["apply","panelEl",{"style":{}}]]
  ```

  Every value written in frame 2 is identical to frame 1's; the settle relay is
  never armed, so `panel-scroll-metrics-resize-coalescing` withholds nothing.
  `P04-B` shows the same 2 reads + 4 writes for a panel whose content has
  **never overflowed** — nothing scrollable exists to update. The existing
  suite pins the live-pass cost at exactly this number
  (`tests/core/PanelResizeMetricsCoalescing.test.ts:170`, *"calls
  getScrollMetrics exactly twice per live pass in the default configuration"*)
  but has no case for a settled *unchanged-size* pass; `ScrollStrip`'s sibling
  suite does (`ScrollStrip.resizeResyncCoalescing.test.ts:250`, *"is a silent
  pass once the relay has resolved and nothing changed"*).
- **Proposed change**: give `Panel` the clamp-signature gate `ScrollStrip`
  already has (`ScrollStrip.ts:522-537`). `remeasureScrollMetrics` runs only
  when a cached signature moved — `{width, height, borderSize, gutter, child
  count, content preferred extent}` — and the existing burst relay stays as the
  second-level gate for the case where the signature *does* move every frame.
  A signature-unchanged pass performs zero `DOM.source` reads and zero inline
  writes. Additionally, override `canSkipUnchangedLayout()` on `Panel` to
  `true` once the signature gate exists, so an unchanged rect stops recursing
  at all (this is the larger win and is a slice-01 seam decision — see
  *Cross-slice notes*).
- **Risk / blast radius**: `remeasureScrollMetrics` also clears a stale gutter
  after a content shrink; `scheduleGutterSettleOnShrink` (`Panel.ts:852-881`)
  is the existing signal for that and must feed the new signature so the shrink
  case still forces a pass. Tests that pin the current behaviour:
  `tests/core/PanelResizeMetricsCoalescing.test.ts` (all 15),
  `tests/core/PanelGutterSettle.test.ts`, `tests/core/PanelOverlayScrollbar.test.ts:333`
  (*"re-sizes the inner scroller to the CURRENT panel viewport on every settled
  layout"* — this one asserts the write happens, so the signature must include
  the panel's own size, which it does). `canSkipUnchangedLayout` on `Panel`
  affects every `Panel` subclass (`Form`, `ScrollStrip`, `FloatingPanel`,
  `AccordionPanel`, `TablePanel`, `Menu`'s item panel) — that half should be
  planned separately and behind the same `isLayoutDirty()` escape the base
  gate already honours.
- **Proof at implement time**: a probe asserting `getScrollMetrics` call count
  `=== 0` and `apply` count `=== 0` across 10 identical `applyBounds` frames on
  a settled scrolling `Panel`; harness: ms/frame on a Split gutter drag with a
  scrolling side panel whose width is *not* being dragged.

---

### F04.3 Two subtree `"scroll"` listeners per `Panel`, three `getScrollMetrics` reads per scroll event, and a per-scroll overlay resize that cannot have changed

- **Category**: A (forced sync read per event), D (repeated work with unchanged inputs), B (unchanged-value write), E (work triggered by content the panel does not scroll)
- **Impact**: **HIGH** — per scroll event on hot path 2. Fires for the panel's own scroll *and* for any descendant's scroll (the listeners are subtree-scoped), so one editor scroll tick charges every enclosing scrolling `Panel`.
- **Where**:
  - `core/Panel.ts:1560-1573` — `installOverlayScrollbars` registers `Event.addSubtreeListener(this, "scroll", handler)` → `syncOverlayScrollbars`
  - `core/Panel.ts:1281-1292` — `installScrollShadows` registers a **second** `Event.addSubtreeListener(this, "scroll", handler)` → `updateScrollShadows`
  - `core/Panel.ts:1699-1709` — `syncOverlayScrollbars`: `getScrollMetrics(innerEl)` (read 1)
  - `core/Panel.ts:1418-1438` — `updateScrollShadows`: `getScrollMetrics(getScrollElement())` (read 2), then `resizeScrollShadowOverlay(el)`
  - `core/Panel.ts:1392-1405` — `resizeScrollShadowOverlay`: `getScrollMetrics(el)` (read 3) for the panel's **client box**, which a scroll cannot change, then two inline writes
- **Hot path**:
  1. wheel / keyboard / caret / thumb-drag → native `"scroll"` on the inner scroller
  2. `Event` capture-phase window listener → subtree walk to the panel id
  3. → `syncOverlayScrollbars` → `getScrollMetrics(innerEl)` → `Scrollbar.setMetrics` ×2 (thumb translate writes)
  4. → `updateScrollShadows` → `getScrollMetrics(innerEl)` (**forced layout**, the bars just wrote)
  5. → `resizeScrollShadowOverlay` → `getScrollMetrics(panelEl)` → 2 inline writes
  6. → `applyShadowEdges` → up to 4 custom-property writes (correctly quantised, `ScrollShadow.ts:148`)
- **Evidence**: probe `panel.probe.test.ts`, both handlers fired once with an **unchanged** scroll position:

  ```
  PANEL scroll event (unchanged position): getScrollMetrics=3
    (targets: ['inner','inner','panel']), apply=2,
    overlayStyleWrites=[{width:'388px'},{height:'288px'}]
  ```

  Three reads where one suffices; the two writes are the shadow overlay being
  re-sized to the same value it already had. `Panel.ts:1429`'s own comment
  concedes the subtree scope ("a nested descendant's scroll only triggers a
  harmless re-read") — in software-rendered WebKitGTK a read landing after a
  write is a document-wide style+layout flush, not harmless.
- **Proposed change**: collapse the two registrations into one handler that
  performs a single `getScrollMetrics(getScrollElement())` and drives both the
  bar metrics and the shadow edges from that one struct (this is exactly what
  `remeasureScrollMetrics` already does for the layout path — `Panel.ts:1082-1140`
  resolves both from one read). Drop `resizeScrollShadowOverlay` from the
  scroll path entirely: the overlay's size depends on the client box and the
  gutter, both of which only change in `doLayout`. Gate the handler on the
  event target being this panel's own scroll element (compare the interned
  handle) so a descendant's scroll costs nothing.
- **Risk / blast radius**: the two handlers are installed and torn down
  independently (`setScrollShadows` vs `setScrollbarStyle` can each disable one
  half), so the merged handler needs the union guard. Tests:
  `tests/core/PanelOverlayScrollbar.test.ts:444` (*"syncOverlayScrollbars is a
  metrics-only push"*), `tests/core/PanelScrollShadowStrips.test.ts`,
  `tests/core/PanelScrollChaining.test.ts`.
- **Proof at implement time**: probe asserting `getScrollMetrics` call count
  `=== 1` per scroll event and `apply` count `=== 0` for an unchanged position;
  and `=== 0` for a scroll event whose target is a descendant scroller.

---

### F04.4 `SmoothScroller` writes both axes every frame and `writeNativeScroll` reads each write back — two forced layouts per wheel-ease frame

- **Category**: A (forced sync read after a write, per frame), B (unchanged-value write on the idle axis)
- **Impact**: **HIGH** — per rAF frame for the whole duration of every wheel gesture (hot path 2), on every `Panel` with `autoScroll` and every `VirtualScroller`. A vertical-only wheel pays the horizontal axis's write+read-back for nothing.
- **Where**:
  - `core/SmoothScroller.ts:220-221` — `this._target.write("x", this._curX); this._target.write("y", this._curY);` — unconditional, both axes, every frame
  - `core/SmoothScroller.ts:152-153` — `scrollBy` clamps **both** axes on every wheel event
  - `core/Component.ts:4900-4914` — `writeNativeScroll`: `DOM.sink.apply(element, {scrollLeft: value}); this._scrollLeft = DOM.source.getScrollLeft(element);` — write then read, per axis
  - `core/Component.ts:4879` — the `clamp` seam calls `getMaxScrollLeft()` / `getMaxScrollTop()`, each a full `DOM.source.getScrollMetrics` (`Component.ts:4588-4612`)
  - `core/Component.ts:4959-4960` — `onWheelScroll` calls `getMaxScrollLeft()` **and** `getMaxScrollTop()` before deciding, i.e. two more `getScrollMetrics` per wheel event
- **Hot path**:
  1. `wheel` → `Component.onWheelScroll` (`Component.ts:4948`) → 2 × `getScrollMetrics` (canX/canY)
  2. → `SmoothScroller.scrollBy` (`SmoothScroller.ts:146`) → `clamp("x")` + `clamp("y")` → 2 more `getScrollMetrics`
  3. → rAF loop `step` (`SmoothScroller.ts:198`), each frame:
     - `write("x", curX)` → `apply({scrollLeft})` → `getScrollLeft()` — **forced layout #1**
     - `write("y", curY)` → `apply({scrollTop})` → `getScrollTop()` — **forced layout #2**
  4. each native write also fires the `"scroll"` event → F04.3's 3 reads
- **Evidence**: probe `virtualscroller.probe.test.ts`, a `Container` with
  `overflow:auto` and vertical-only content, one wheel notch:

  ```
  SMOOTH scrollBy: frames=1 reads L=1 T=1 writes=[]
  SMOOTH one frame: scrollLeftWrites=1 scrollTopWrites=1 reads L=1 T=1
    ops=[['apply',{scrollLeft:0}],['apply',{scrollTop:25.17}]]
  ```

  `scrollLeft: 0` is written and read back every frame for an axis that never
  moves. `SmoothScroller.ts:210-218` already computes `settledX` / `settledY`
  per axis — the information needed to skip is in hand and discarded.
- **Proposed change**: in `step`, write an axis only when `_cur<axis>` changed
  since the previous frame (track `_lastWrittenX/Y`); skip the write entirely
  when the axis was never given a delta. Separately, `writeNativeScroll` should
  not read back per axis per frame — the browser clamp only matters at the
  range ends, which `SmoothScroller` already clamps against via the `clamp`
  seam; a single read-back at loop end (`settledX && settledY`) restores the
  cache invariant with one forced layout per gesture instead of two per frame.
  Cache the `getMaxScrollLeft/Top` pair for the duration of one gesture rather
  than re-reading it in both `onWheelScroll` and each `clamp`.
- **Risk / blast radius**: `SmoothScroller` is shared by `Component`'s native
  wheel path and `VirtualScroller` (`VirtualScroller.ts:121-125`, whose `write`
  is a pure JS setter with no read-back — it is unaffected by the read change
  but benefits from the skip). The read-back deferral changes when
  `getScrollLeft()`'s cache becomes accurate mid-gesture; `ScrollStrip.mainScroll`
  (`ScrollStrip.ts:859`) and `Component.syncScrollOffsets` already resync on
  demand, so no consumer reads a stale cache without a resync. Tests:
  `tests/core/PanelScrollChaining.test.ts`, `tests/component/list/horizontalScrolling.test.ts`.
- **Proof at implement time**: probe asserting `scrollLeft` write count `=== 0`
  across a 10-frame vertical-only ease, and `getScrollLeft`/`getScrollTop` call
  count `<= 2` for the whole gesture. Harness: ms/frame while wheel-scrolling
  a Loom file tree.

---

### F04.5 A scrollbar arrow's hover/unhover mutates the shared stylesheet, where the sibling thumb already uses a class state

- **Category**: C (stylesheet-rule write on a pointer path), I (duplication — one widget, two different state mechanisms)
- **Impact**: **MEDIUM** — two full-document restyles per hover cycle over any scrollbar arrow, on hot path 3. Not per-frame, but pointer travel across a bar's arrows (four arrows per overlay `Panel`) produces a burst of them.
- **Where**:
  - `component/container/Scrollbar.ts:387-400` — `ScrollArrowButton._onMouseOver` / `_onMouseOut` call `this.setBackgroundColor(...)`
  - `core/Component.ts:2656-2663` → `writeStyle` (`Component.ts:5635-5656`) → `flushStyleBag()` + `commitCSSRule()` → `StyleRule.flushDirty` → `DOM.sink.setRuleStyles` on the instance's `#id` rule
  - `component/container/Scrollbar.ts:424-452` — `ScrollbarThumb` solves the identical problem with `ownStyleStates` + `setStyleState(".hover", …)`, which writes only a class token (`Component.ts:6213-6233`)
  - `component/container/Scrollbar.ts:193-198` — `ScrollArrowButton` **already declares** `ownStyleStates` (for `.disabled`), so the mechanism is present and unused for hover
- **Hot path**: `mousemove` → `Event` routing → `ScrollArrowButton._onMouseOver` → `setBackgroundColor` → `#id` rule mutation → full-document restyle.
- **Evidence**: probe `scrollbar.probe.test.ts`:

  ```
  SCROLLBAR arrow mouseover: setRuleStyles=1 [['#cc5d…', {cursor:null, visibility:null,
    whiteSpace:null, userSelect:null, minWidth:null, minHeight:null, maxWidth:null,
    maxHeight:null, overflowX:null, overflowY:null,
    backgroundColor:'var(--ts-ui-scrollbar-arrow-hover-bg, rgba(0,0,0,0.06))'}]], apply=0
  SCROLLBAR arrow mouseout:  setRuleStyles=1 [['#cc5d…', {backgroundColor:null}]], apply=0
  SCROLLBAR thumb mouseover: setRuleStyles=0, apply=1 [{addClass:['hover']}]
  ```

  The arrow's mouseover also drags **ten unrelated `null` removals** into the
  rule write (the class-default reconciliation in `flushStyleBag`) — see
  *Cross-slice notes*.
- **Proposed change**: add a `.hover` entry to `ScrollArrowButton.ownStyleStates`
  extracting `{ backgroundColor: SCROLL_ARROW_HOVER_DECLARATIONS.backgroundColor }`
  and replace both handlers with `this.setStyleState(".hover", true/false)`,
  mirroring `ScrollbarThumb.applyHoverState` line for line. Keep the existing
  `_disabled` short-circuit in `_onMouseOver`. `render()` already replays
  `.disabled` (`Scrollbar.ts:349-353`); `.hover` needs no replay.
- **Risk / blast radius**: `ScrollArrowButton` is file-local to `Scrollbar.ts`;
  no external caller. The `.disabled` state rule already wins over the resting
  tier through `restingGuardSuffix`, and `.hover` must lose to `.disabled` —
  declaration order in `ownStyleStates` decides, so `.disabled` must stay last.
  Tests: `tests/component/container/Scrollbar.test.ts:393-445` (asserts the
  hover fill via `getBackgroundColor`) and the four
  `ScrollbarArrow.test.ts` hoisting rows (251-345).
- **Proof at implement time**: the same probe asserting `setRuleStyles === 0`
  and one `addClass`/`removeClass` apply per hover transition.

---

### F04.6 `scheduleGutterSettleOnShrink` runs a whole-subtree preferred-size recursion every pass, including passes the burst gate withheld

- **Category**: D (layout work recomputed with unchanged inputs; outside the coalescing gate)
- **Impact**: **MEDIUM** — per frame on hot path 1, for every scrolling `Panel` that is *currently showing* a gutter or a lit shadow edge (the normal state of any overflowing scroll host). Adds one extra `getPreferredSize()` per laid-out child per pass, on top of what the layout manager already did.
- **Where**:
  - `core/Panel.ts:703` — `this.scheduleGutterSettleOnShrink();` — called unconditionally at the end of `doLayout`, **outside** the `deferScrollMetricsWhileResizing` branch
  - `core/Panel.ts:867-876` — `if (this.showsScrollAffordance()) { const preferred = this.getPreferredSize(); … }`
  - `core/Component.ts:3376-3395` — `getPreferredSize()` → `getLayoutManager().getPreferredSize()`
  - `layout/Grid.ts:345-392`, `layout/Border.ts:857-932` — a manager's `getPreferredSize` walks every laid-out child and calls **its** `getPreferredSize`, which recurses into that child's manager. No memoization anywhere on the path.
- **Hot path**: gutter drag → `Panel.doLayout` → (remeasure withheld) →
  `scheduleGutterSettleOnShrink` → `showsScrollAffordance()` is `true` →
  `getPreferredSize()` → full subtree recursion.
- **Evidence**: probe `panel3.probe.test.ts`, `Panel({autoScroll:'auto', layoutManager: VBox()})` with 20 children, one identical `applyBounds`:

  ```
  P04-E overlay/auto, 20 kids, gutter={right:12,bottom:12} edges={top:0,bottom:100,left:0,right:28}:
        child getPreferredSize calls in ONE identical pass = 100
  P04-F autoScroll none, 20 kids: child getPreferredSize calls in ONE identical pass = 80
  P04-G mid-burst withheld pass: armed=true getScrollMetrics=0 childPreferredSizeCalls=100
  ```

  Exactly **+1 `getPreferredSize` per laid-out child per pass** (100 vs 80, a
  25 % uplift here), and `P04-G` shows it still runs on a pass where the burst
  gate withheld every DOM read — the coalescing plan's gate does not cover it.
  The method's own doc comment claims the extent read "costs nothing on the
  overwhelming majority of layouts, where there is nothing to settle"; that is
  true only for panels with no affordance showing, which is the opposite of the
  case that matters.
- **Proposed change**: fold the shrink signal into the clamp signature of
  F04.2 and compute it once. Concretely: have the layout manager publish the
  preferred extent it already resolved during `super.doLayout()` (it computed
  it moments earlier) instead of re-deriving it, and skip the whole helper on
  a pass the burst gate withheld — a shrink cannot be actioned mid-burst
  anyway, since `remeasureScrollMetrics` is the only thing that would clear the
  stale gutter and it is withheld.
- **Risk / blast radius**: `scheduleGutterSettleOnShrink` is `Panel`-private.
  Its contract is pinned by `tests/core/PanelGutterSettle.test.ts` (7 cases,
  including `:108` *"does not read the extent (nor schedule) when no scroll
  affordance is showing"*). Skipping it mid-burst delays a shrink-triggered
  gutter clear to the settle frame — the same window the burst gate already
  accepts for the gutter itself.
- **Proof at implement time**: probe asserting child `getPreferredSize` call
  count is identical for `autoScroll:'auto'` and `autoScroll:'none'` on an
  unchanged pass, and `=== 0` extra on a withheld pass.

---

### F04.7 `Panel` and `VirtualScroller` still duplicate the scrollbar-layout algorithm and the shadow-edge writer (health audit P2 #5 — still open)

- **Category**: I (duplication), H (function/implementation mismatch)
- **Impact**: **MEDIUM** — code health, but with a concrete render payoff: the shared version lets `Panel` drop one of its two per-pass live reads (F04.2's read 2).
- **Where**:
  - `core/Panel.ts:913-971` (`measureOverlayLayout` + `commitOverlayLayout`) vs `component/container/VirtualScroller.ts:299-327` (`computeScrollbarVisibility`) + `:414-455` (`layoutScrollbars`)
  - `core/Panel.ts:1451-1459` vs `component/container/VirtualScroller.ts:497-505` — `setShadowEdge`, byte-identical apart from the write target (`InlineStyle.set` vs `DOM.sink.apply`)
  - `core/Panel.ts:1305-1337` vs `component/container/VirtualScroller.ts:104-115` — the shadow-host element construction, duplicated
  - `core/Panel.ts:1044-1057` vs `component/container/VirtualScroller.ts:474-484` — the four-edge ramp, duplicated
- **Status vs the audit**: partially closed. `ScrollShadowEdges`, `scrollShadowRamp`, `quantizeShadowEdge`, `scrollShadowEdgeValue` and `appendScrollShadowStrips` now live once in `core/ScrollShadow.ts` (and the audit's Priority-3 orphan exports `SCROLL_SHADOW_EXTENT_PX` / `SCROLL_SHADOW_RAMP_PX` are now module-private — `ScrollShadow.ts:31,41`). What remains duplicated is the **scrollbar-layout algorithm**, the **`setShadowEdge` wrapper**, the **shadow-host construction**, and the **edge-ramp call sequence**.
- **Evidence**: side-by-side, the two do the same five steps in the same order
  — resolve the owner's box, read `getTrackWidth()`, decide per-axis visibility
  against the cross-axis reservation, derive the effective viewport, then
  `setX`/`setY`/`setWidth|Height`/`setMetrics` on both bars and size the
  clip/inner element. They differ only in **where the visibility inputs come
  from**: `Panel` writes the inner element then reads `scrollWidth/scrollHeight`
  back from the DOM (one iteration, one forced layout); `VirtualScroller` runs
  a two-iteration fixpoint over JS-held content sizes (no DOM read at all,
  `VirtualScroller.ts:315-321`).
- **Proposed change**: extract a numeric core —
  `resolveScrollbarLayout({viewportW, viewportH, contentW, contentH, scrollX,
  scrollY, axes, trackW}) → {vVisible, hVisible, effW, effH, edges}` — plus a
  `ScrollbarPair` holder that owns the two `Scrollbar` instances, the shadow
  host and its four strips, `setShadowEdge`, and the bar placement/metric push.
  `VirtualScroller` supplies the numbers from its fields; `Panel` supplies
  `contentW/contentH` from the preferred extent it already computes
  (`Panel.ts:868`) and its client box from the committed size minus border and
  gutter, which it already has cached (`Panel.ts:695`). That removes the
  write-then-read in `measureOverlayLayout` for the *visibility* decision; only
  the scroll **offsets** would still need a live read, and only on a scroll
  event (F04.3), not on every layout pass.
- **Risk / blast radius**: **this contradicts the open `overlay-scrollbars-non-panel`
  plan**, whose *Architecture Decisions* explicitly state "`Panel` and
  `VirtualScroller` are not migrated onto the helper" and give reasons
  (`VirtualScroller` has no native scroll element; `Panel` additionally owns an
  inset inner element, re-parents children, and reserves a gutter that feeds
  `getInnerSize`). Those reasons are sound for the *element-ownership* half and
  are the reason this proposal shares only the **numeric core plus the bar
  pair**, not the scroller plumbing — the two proposals compose: the new
  `core/OverlayScrollbars.ts` would be a third consumer of the same numeric
  core rather than a third copy of it. Anyone implementing this must reconcile
  with that plan first. The `Panel` behaviour change (deriving overflow from
  the preferred extent rather than a DOM read) is the risky part: content can
  overflow for reasons `getPreferredSize` cannot see (wrapped text, foreign
  DOM such as a `CodeEditor`), so the live read must remain as a
  settle-frame-only correction. Tests: `tests/core/PanelOverlayScrollbar.test.ts`
  (25 cases), `tests/component/container/VirtualScroller.test.ts`.
- **Proof at implement time**: line-count delta plus the F04.2 probe showing
  `getScrollMetrics === 1` (not 2) on a live pass.

---

### F04.8 A scrolling `Panel` eagerly builds 12 scrollbar components and 6 raw elements at first render, whether or not anything ever overflows

- **Category**: E (work for content nobody can see), H (over-built for the common case), G (listener churn)
- **Impact**: **MEDIUM** — construction and first-render cost, multiplied by every `autoScroll` panel in the app; also per-frame, since those components participate in `applyBounds` recursion. Library-internal `autoScroll` users include `Menu`'s item panel (`overlay/Menu.ts:195`), `Dialog`'s content region (`overlay/Dialog.ts:727`), `AbstractSelectableList`'s row stack (`component/list/AbstractSelectableList.ts:919`), `PickerColumn` (`component/input/PickerColumn.ts:96`), `MarkdownViewer` (`component/display/MarkdownViewer.ts:163`) — i.e. every dropdown, dialog and list in a Loom session.
- **Where**:
  - `core/Panel.ts:1181-1184` — `init` installs the overlay whenever `scrollbarStyle === "overlay" && autoScroll !== "none"`; nothing waits for actual overflow
  - `core/Panel.ts:1186-1189` — same for the shadow overlay + 4 strips
  - `component/container/Scrollbar.ts:604-627` — each `Scrollbar` builds a thumb, two `ScrollArrowButton`s (each with a `ScrollArrowGlyph`), and registers 4 listeners of its own
  - `component/container/Scrollbar.ts:265-269` — each `ScrollArrowButton` registers 5 more (3 element + 2 viewport)
  - `component/container/Scrollbar.ts:542` — `_arrowsEnabled` defaults to `true` and **no production call site ever passes `arrowsEnabled: false`** (only tests do)
- **Evidence**: probe `panel2.probe.test.ts`:

  ```
  P04-D footprint: nonScrolling createElement=1 | scrolling createElement=19,
                   strips=4, barsComponentTree=12
  ```

  One element for a plain `Panel`; **19 elements and a 12-component scrollbar
  tree** for a scrolling one (2 bars × {bar, thumb, 2 arrows, 2 glyphs}), plus
  the inner scroller, the shadow host and its 4 strips. `Scrollbar.setMetrics`
  does `setDisplayed(overflow)` (`Scrollbar.ts:791`), so a bar with no overflow
  is correctly out of the render tree — but it is still constructed, still
  holds an `#id` stylesheet rule, still registers ~10 listeners, and its
  children still take part in every `applyBounds` recursion. The four shadow
  strips are never undisplayed at all.
- **Proposed change**: defer `installOverlayScrollbars` and
  `installScrollShadows` to the first pass on which `remeasureScrollMetrics`
  observes real overflow, and tear them down again on a sustained
  no-overflow settle. The install path is already idempotent and already
  re-entrant-safe (`Panel.ts:1495-1533`, `:1276-1293`), and
  `refreshOverlayScrollbars`/`refreshScrollShadows` already exist as the
  install/teardown entry points — the change is moving the trigger from `init`
  to the first overflow observation. Second, `setDisplayed(false)` the shadow
  host along with the bars when neither axis overflows.
- **Risk / blast radius**: the first frame of a newly-overflowing panel would
  paint without bars or shadow; today it paints with them already mounted.
  `Panel.ts:1181`'s comment documents an ordering dependency (bars must install
  before shadows so `getScrollElement()` resolves) that the deferred path must
  preserve. Tests: `tests/core/PanelOverlayScrollbar.test.ts:140` (*"installs
  both bars + inner scroller + handler once autoScroll and overlay style are
  both active"*) pins the current eager behaviour and would need rewriting —
  flag this as an intentional contract change in any plan.
- **Proof at implement time**: `Component` live-count and stylesheet-rule count
  in `DiagnosticsOverlay` for a Loom session with the file tree and a few
  dialogs open; probe asserting `createElement <= 2` for a scrolling `Panel`
  whose content fits.

---

### F04.9 `VirtualScroller` recomputes the scrollbar-visibility fixpoint five-plus times per render pass and runs `updateShadows` twice per scroll tick

- **Category**: D (repeated computation with unchanged inputs — no cache), G (allocation per call), B (unchanged-value write)
- **Impact**: **MEDIUM** — per scroll tick and per virtual-row render pass on hot path 2, for every `Table`, `TreeTable` and `Tree` on screen.
- **Where**:
  - `component/container/VirtualScroller.ts:299-327` — `computeScrollbarVisibility` calls `this._owner.getContentBounds()` (which allocates an `Insets` via `Component.getContentInsets`, `Component.ts:2624-2637`) and runs its 2-iteration loop; **nothing memoizes the result**
  - callers: `effectiveViewportH` (`:337`), `effectiveViewportW` (`:344`), `clampToContent` (`:384-385`, two calls), `layoutScrollbars` (`:423`), `updateShadows` (`:475`), `clampAxis` (`:271-273`), `setScrollX`/`setScrollY` (`:220`, `:246`)
  - `component/container/VirtualScroller.ts:414-455` — `layoutScrollbars` reads `getContentBounds()` directly **and** via `computeScrollbarVisibility` **and** again via `updateShadows`
  - `component/container/VirtualScroller.ts:461-464` — `updateTransform` calls `updateShadows`; the owner's `renderWindow` then calls `layoutScrollbars`, which calls `updateShadows` again (`:454`)
  - `component/container/VirtualScroller.ts:449` — the clip-box style write is unconditional
- **Hot path**: wheel/touch → `setScrollY` (`:220`, 1 visibility computation) →
  `updateTransform` (`:461`) → `updateShadows` (1 more) → `_onScroll()` →
  owner `renderWindow` → `clampToContent` (2 more) → `layoutScrollbars`
  (1 direct `getContentBounds` + 1 more visibility + `updateShadows` 1 more).
  **≈6 identical fixpoint computations and ≈6 `getContentBounds` allocations
  per scroll tick.**
- **Evidence**: probe `virtualscroller.probe.test.ts`, third identical
  `layoutScrollbars(150, 1000)`:

  ```
  VSCROLLER layoutScrollbars identical: ops=['apply']
    clipWrites=[{style:{left:'0px', top:'0px', width:'188px', height:'400px'}}]
  ```

  One unchanged-value write per call (no read follows it, so it is cheap in
  isolation) — but the surrounding recomputation is pure waste, and the double
  `updateShadows` means the eight `quantizeShadowEdge` comparisons run twice.
- **Proposed change**: memoize `computeScrollbarVisibility` on a signature of
  `{contentWidth, contentHeight, ownerWidth, ownerHeight, trackW}` and
  invalidate on `clampToContent`/`layoutScrollbars`. Drop the `updateShadows`
  call from `updateTransform` — `layoutScrollbars` already runs it at the end
  of every `renderWindow`, and `updateTransform`'s own call sees pre-render
  metrics anyway. Guard the clip-box write on a changed rectangle.
- **Risk / blast radius**: `updateTransform` is also reached from
  `clampToContent` (`:397`) on a path that does **not** end in
  `layoutScrollbars`; that call site needs its own `updateShadows`. Consumers:
  `component/shared/VirtualRowView.ts`, `component/table/Body.ts`,
  `component/tree/Tree.ts`. Tests: `tests/component/container/VirtualScroller.test.ts`
  (shadow cases `:173-247`), `tests/component/table/ScrollRebindLayoutEconomy.test.ts`.
- **Proof at implement time**: probe counting `Component.getContentBounds`
  calls per simulated scroll tick (expect ≤2, currently ~6) and asserting zero
  `apply` on an identical `layoutScrollbars`.

---

### F04.10 `InlineStyle.setMany` is unbatched and `InlineStyle.flushDirty` has no empty-bag guard — 6 `DOM.sink.apply` calls per `Panel` frame where 2 would do

- **Category**: B (unchanged-value / empty write), G (allocation and handle-resolve churn)
- **Impact**: **MEDIUM** — the empty-flush half is one wasted `apply` *per rendered component per layout pass*, tree-wide; the unbatched half is +2 applies per `Panel` frame. Each `apply` is a registry resolve plus a patch-object allocation. No forced layout, so this is allocation/throughput rather than a stall.
- **Where**:
  - `core/StyleTarget.ts:48-50` — `setMany` loops `set`, and `set` (`:35-43`) writes **immediately, one `apply` per key**, once the target is attached
  - `core/StyleTarget.ts:404-407` — `StyleRule.flushDirty` **does** guard `Object.keys(dirty).length === 0`
  - `core/StyleTarget.ts:457-459` — `InlineStyle.flushDirty` has **no such guard** and always calls `DOM.sink.apply(target, {style: dirty})`
  - `core/Component.ts:1824-1829` — `commitElementStyle()` → `InlineStyle.flush()`, called from `Panel.doLayout` (`Panel.ts:660`) *and* from `setAutoCommitStyle(true)` at the end of `applyBounds` (`Component.ts:1810-1816`)
  - `Panel` `setMany` sites on the per-frame path: `Panel.ts:697`, `:925`, `:957`, `:1033`
- **Evidence**: probe `panel4.probe.test.ts`, frames 2 and 3 of an identical
  `applyBounds` on a settled overlay `Panel` — identical, six ops each:

  ```
  P04-H frame 2: [["apply","panelEl",{"style":{}}],
                  ["apply","innerScroller",{"style":{"width":"388px"}}],
                  ["apply","innerScroller",{"style":{"height":"288px"}}],
                  ["apply","shadowOverlay",{"style":{"width":"388px"}}],
                  ["apply","shadowOverlay",{"style":{"height":"288px"}}],
                  ["apply","panelEl",{"style":{}}]]
  ```

  Two empty-bag flushes and four single-key applies that a `queueMany` +
  `flush` pair would collapse to two. Confirmed tree-wide by
  `panel2.probe.test.ts`'s `P04-C` (a plain `Container`'s second identical
  `applyBounds` emits exactly one `apply({style:{}})`) and by
  `scrollstrip.probe.test.ts`'s op histogram, which shows **`"style:": 29`** —
  29 empty-style applies in one `ScrollStrip` pass, one per component in the
  subtree.
- **Proposed change**: (1) add the empty guard to `InlineStyle.flushDirty`,
  mirroring `StyleRule.flushDirty` one class up — a one-line change that
  removes one `apply` per rendered component per layout pass across the whole
  library. (2) In `StyleTarget`, make `setMany` batch: collect into one patch
  and issue a single `DOM.sink.apply` when attached, instead of looping `set`.
  The seam doc already advertises exactly this ("one handle resolve performs
  every mutation in the patch") — `setMany` is the path that does not honour it.
- **Risk / blast radius**: both changes are in `core/StyleTarget.ts` and affect
  every component. The `setMany` batching changes write *ordering* only within
  one call (all keys land in one patch rather than sequentially) — no call site
  depends on an interleaved read between two keys of one `setMany`. This is
  slice 02/03 territory; raised here because the probe found it on this slice's
  hot path. Tests: anything counting `sink.writes` length (`tests/dom/recorder.test.ts`,
  the style-hoisting rows in `Scrollbar.test.ts:481-616`).
- **Proof at implement time**: `tests/dom` recorder probe asserting zero
  `apply` ops for a `commitElementStyle()` with an empty bag, and `apply === 1`
  for a two-key `setMany`; rerun `P04-H` expecting 2 ops per frame.

---

### F04.11 `setNativeScrollbarHidden` mints a per-instance `#id::-webkit-scrollbar` rule where the file's own shared class rule already solves it

- **Category**: I (duplication — the same problem solved two ways in one file), C (stylesheet-rule writes reachable from a runtime setter)
- **Impact**: **LOW–MEDIUM** — two stylesheet rules per scrolling `Panel` (rule-count growth, and a rule delete/insert on every `setLayoutManager` / `setAutoScroll` / `setScrollbarStyle`), not per frame.
- **Where**:
  - `core/Panel.ts:1650-1653` — `setElementCSSRule("scrollbarWidth", …)` plus `this.createStyleRule("::-webkit-scrollbar").set("display", …)`, i.e. two `#id`-scoped rules per instance
  - `core/Panel.ts:121-153` — the same file already registers `OVERLAY_SCROLLER_CLASS` as **one shared pair of class rules** for exactly this purpose, for the inner element
  - `core/Panel.ts:1575, 1630` — called from `installOverlayScrollbars` (every call, not only the first) and `removeOverlayScrollbars`
  - `core/Panel.ts:469-473` — `setLayoutManager` → `setAutoScroll` → `refreshOverlayScrollbars` → `installOverlayScrollbars` → `setNativeScrollbarHidden(true)` again
- **Evidence**: read of the two paths; `tests/core/PanelOverlayScrollbar.test.ts:192`
  (*"hides the native scrollbar via the deferred CSS seam on install"*) pins the
  current per-`#id` shape. Note also that the panel element in overlay mode
  never scrolls by construction (`Panel.ts:1500-1504`: "inert: the inner element
  is absolute / out of flow and always fits"), so for `autoScroll` values other
  than `"both"` the panel element's native bar can never appear and the rules
  are not merely duplicated but unnecessary.
- **Proposed change**: apply `OVERLAY_SCROLLER_CLASS` to the panel element too
  (add/remove the class token instead of minting two `#id` rules), and skip it
  entirely for modes where the panel element's `overflow` is not `scroll`.
- **Risk / blast radius**: `Panel`-private. The `"both"` mode genuinely needs
  the hide because `overflow: scroll` always paints a bar. Tests:
  `PanelOverlayScrollbar.test.ts:192, 204-247`.
- **Proof at implement time**: `DiagnosticsOverlay`'s stylesheet-rule counter
  across a session that opens several scrolling panels; probe asserting
  `ensureStyleRule` count for a scrolling `Panel` drops by 1 per instance.

---

### F04.12 `ScrollStrip.layoutContent` allocates an `Insets` and writes `data-insets` on the clip every pass

- **Category**: B (unchanged-value attribute write), G (per-frame allocation)
- **Impact**: **LOW** — one attribute write and one allocation per strip per frame on hot path 1. Included because it is the only remaining unconditional write in the post-fix `ScrollStrip` pass once F04.1 is fixed.
- **Where**:
  - `component/container/ScrollStrip.ts:760, 766` — `this._clip.setInsets(new Insets(endGap, 0, 0, 0))` / `new Insets(0, 0, 0, endGap)`, unconditional
  - `core/Component.ts:2531-2536` — `setInsets` has **no value guard**: it always stores the object and calls `setDataAttribute("insets", insets.render())`
  - `primitive/Insets.ts` — no `equals()` exists, so no caller *can* guard cheaply
- **Evidence**: probe `scrollstrip.probe.test.ts`, the `setGlyph`-stubbed
  identical pass:

  ```
  SCROLLSTRIP-ATTR setGlyph stubbed identical pass: total=32
    hist={"setAttr:data-insets":1,"style:":29,"style:width":1,"style:height":1}
  ```

  One `data-insets` write survives on a pass where nothing changed. (`style:`
  ×29 is F04.10's empty-flush.)
- **Proposed change**: add an `Insets.equals(other)` and guard `setInsets` on
  it; have `layoutContent` keep the last `endGap` and only rebuild the `Insets`
  when it moves.
- **Risk / blast radius**: `setInsets` is public and widely called; a value
  guard is behaviour-preserving unless a caller mutates an `Insets` in place
  (the class is value-like and has no mutators). The `data-*` attribute itself
  is diagnostics-only — see *Cross-slice notes*.
- **Proof at implement time**: rerun the stubbed-pass probe expecting
  `setAttr:data-insets === 0`.

---

### F04.13 Dead code in this slice

- **Category**: J (dead code)
- **Impact**: **LOW** (code health)
- **Where / greps** (run over all of `packages/`, excluding `dist/` and generated `docs/api/`):
  - `component/container/Scrollbar.ts:900-916` — `setArrowsEnabled`.
    `grep -rn "setArrowsEnabled" --include=*.ts --include=*.md packages/ | grep -v /dist/ | grep -v docs/api/` → **4 hits: its own definition, its own JSDoc cross-reference, and two lines of `docs/components/Scrollbar.md`. Zero callers.**
  - `component/container/Scrollbar.ts:692-701` — `disposeArrows`, reachable only from `setArrowsEnabled`. **Zero other callers.**
  - `core/SmoothScroller.ts:188-190` — `isAnimating()`.
    `grep -rn "isAnimating" --include=*.ts packages/ | grep -v /dist/` → **43 hits, every one of them `Canvas` / `WebGLCanvas`'s own unrelated `isAnimating`. Zero callers on `SmoothScroller`.**
  - `component/container/ScrollStrip.ts:478-482` — `moveItem` **is** used (`TabBar.ts:1884, 3284`); listed here only to record that it was checked.
- **Proposed change**: delete `setArrowsEnabled` + `disposeArrows` and the two
  `docs/components/Scrollbar.md` lines describing a runtime toggle nothing
  performs (keep `arrowsEnabled` as a construction-time option — that one *is*
  used, by tests and by the options bag). Delete `SmoothScroller.isAnimating`.
- **Risk / blast radius**: both are public exports; removal is a minor-version
  API break. `tests/component/container/Scrollbar.test.ts:55-76` exercises
  `isArrowsEnabled`/`getArrowStep` (the getters), not `setArrowsEnabled`.
- **Proof at implement time**: build + full test suite green after removal.

---

### F04.14 An overlay thumb drag pays a forced write-then-read plus the full three-read scroll cascade on every `mousemove`

- **Category**: A (forced sync read per pointer event), B
- **Impact**: **MEDIUM** — per `mousemove` for the duration of a scrollbar drag (hot path 3 feeding hot path 2).
- **Where**:
  - `component/container/Scrollbar.ts:1089-1105` — `_onDragMove` emits `"scroll"` on every viewport `mousemove`
  - `core/Panel.ts:250-251` — `_onOverlayScrollV` / `_onOverlayScrollH` → `this.setScrollTop(position)` / `setScrollLeft(position)`
  - `core/Component.ts:4395-4407, 4418-4430` — `setScrollLeft`/`setScrollTop`: `_wheelScroller?.reset()` (which itself reads **both** axes, `Component.ts:4876-4879`), then `DOM.sink.apply({scrollTop})`, then `DOM.source.getScrollTop(element)` read-back
  - the resulting native `"scroll"` then triggers F04.3's three `getScrollMetrics`
- **Evidence**: probe `panel.probe.test.ts`:

  ```
  PANEL bar->setScrollTop: getScrollTop reads=2, getScrollLeft reads=1, scroll writes=1
  ```

  Three live offset reads for one write, before the scroll event's own three
  metric reads. The `getScrollLeft` read comes from `_wheelScroller.reset()`
  re-seeding an axis the drag never touches.
- **Proposed change**: `setScrollLeft`/`setScrollTop` should reset only the
  axis they write (the `SmoothScroller` seam already takes an axis), and should
  take the read-back from the `"scroll"` event's own single merged read
  (F04.3) instead of doing their own. Additionally, `Scrollbar._onDragMove`
  should skip the emit when the computed `newPosition` equals
  `this._scrollPosition` — a sub-pixel `mousemove` on a long track routinely
  maps to the same scroll position.
- **Risk / blast radius**: `setScrollLeft`/`setScrollTop` are public
  `Component` API (slice 01) with many callers; the read-back is the documented
  cache invariant (`dom-seams.md`, "the cache invariant is restored by a
  separate `getScrollLeft` read of the settled value"), so deferring it must be
  paired with F04.3's merged scroll handler. The `_onDragMove` guard is
  `Scrollbar`-local and safe. Tests: `tests/component/container/Scrollbar.test.ts:406-445`,
  `tests/core/PanelOverlayScrollbar.test.ts:430`.
- **Proof at implement time**: probe counting `DOM.source.getScrollTop` +
  `getScrollLeft` + `getScrollMetrics` per simulated drag `mousemove` (expect
  ≤2, currently 6).

---

### F04.15 `FocusReveal.containing` walks every registered revealer on every reveal

- **Category**: D (work proportional to the whole registry, not to the target's ancestry), H
- **Impact**: **LOW** — cold path: `FocusReveal.reveal` is reached only from `FocusHistory.back/forward` (`core/FocusHistory.ts:153`) and `SpatialNavigation` (`core/SpatialNavigation.ts:550, 642`), i.e. per keypress at most.
- **Where**:
  - `core/FocusReveal.ts:224-251` — `containing` iterates the whole `_revealers` set, calling `getRevealElement()`, `DOM.source.isConnected(el)` and `DOM.source.contains(el, target)` for each, then sorts the survivors with a comparator that calls `contains` up to twice per comparison
  - `core/Panel.ts:422-426` — **every** non-`"none"` `Panel` registers, alongside every `Split`, `Border`, `Tab`, `Accordion` and `ScrollStrip`
  - `core/Panel.ts:586-607` — `revealDescendant` does two live `getElementRect` reads and up to two `setScrollTop`/`setScrollLeft` write-then-read-back pairs
- **Evidence**: read of the code; not measured (cold path). In a Loom-sized
  app the registry is plausibly 50–200 entries, so one directional-navigation
  keypress costs that many `isConnected` + `contains` seam calls before any
  reveal happens.
- **Proposed change**: walk **up** from the target through
  `DOM.source.getParentElement` and match against a `Map<Handle, FocusRevealer>`
  keyed on each revealer's element, instead of scanning the registry and
  testing containment downward. That makes the cost proportional to the
  target's depth and yields outermost-first ordering for free (reverse the
  walk), removing the `contains`-based sort entirely.
- **Risk / blast radius**: `FocusReveal` is a public `core` export with three
  consumers. The registry-pruning side effect for GC'd containers
  (`FocusReveal.ts:234-237`) must be preserved — a `WeakMap` keyed on handle
  plus the existing `destructor` unregisters covers it. Tests:
  `tests/unit/core/FocusReveal.test.ts`.
- **Proof at implement time**: probe counting `DOM.source.contains` calls per
  `reveal` with 100 registered revealers (expect O(depth), currently O(registry)).

---

## Entity inventory

| Entity | Stated function | Owns DOM (elements, rules) | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `core/Panel` | `Container` with 4 px insets that opts into native scrolling via `autoScroll`, hiding the native bar behind overlay `Scrollbar`s and painting edge shadows | panel element; inner scroll `<div>` (overlay mode); shadow host + 4 strips; 2 `Scrollbar` components; per-`#id` `scrollbarWidth` rule + `#id::-webkit-scrollbar` rule; 2 shared `.PanelOverlayScroller` rules | **2 `getScrollMetrics` reads (both after a write in the same task) + 4 unchanged inline writes + 2 empty flushes per pass, even when nothing changed**; plus a full subtree `getPreferredSize()` recursion whenever an affordance shows | **over-built** — the coalescing gate covers only the self-resizing case; the eager overlay install and the double scroll listener are unconditional | F04.2, F04.3, F04.6, F04.7, F04.8, F04.11, F04.14, F04.15 |
| `component/container/VirtualScroller` | Shared transform-based scroll machinery for virtual lists: rows container, 2 `Scrollbar`s, wheel + touch/fling | clip box, rows container, shadow host + 4 strips, 2 `Scrollbar` components | per `layoutScrollbars`: 1 unchanged clip-box write, ~3 `getContentBounds` allocations, 2 visibility fixpoints, 1 `updateShadows`; **zero live DOM reads** (the design `Panel` should have) | **fits**, with a caching gap | F04.7, F04.9 |
| `component/container/Scrollbar` | Custom overlay scrollbar driven by pushed `setMetrics`; thumb drag, track paging, end-cap arrows | root element; thumb; 2 `ScrollArrowButton`s each with a `ScrollArrowGlyph`; one `#id` rule per component (6 per bar) | **zero writes on an identical `setMetrics`**; one `transform` apply on a scroll-only change; one class toggle on an arrow disable flip | **fits** (the write economy is genuinely good) — but the arrow's hover path and the dead runtime toggle spoil it | F04.5, F04.8, F04.13, F04.14 |
| `ScrollArrowButton` (file-local) | Press-and-hold arrow at each end of a track, dim at the scroll limit | own element + glyph child; `.ScrollArrowButton.disabled` shared state rule; per-`#id` rule | 0 per pass; **1 stylesheet-rule mutation per hover and per unhover** | **mismatch** — declares `ownStyleStates` yet hand-rolls hover through a per-`#id` rule write | F04.5 |
| `ScrollbarThumb` (file-local) | Draggable thumb; hover/drag highlight | own element; `.ScrollbarThumb.hover` shared state rule | 0 per pass; 1 class toggle per hover | **fits** — the reference implementation F04.5 asks the arrow to copy | — |
| `core/ScrollShadow` | Single source of truth for the edge-shadow recipe: strip geometry, per-edge ramp, quantised edge cache | creates the 4 strips (`appendScrollShadowStrips`) | pure functions; `quantizeShadowEdge` correctly suppresses an unchanged edge write | **fits** — the extraction the health audit asked for, done | — (the duplicated `setShadowEdge` *wrappers* are F04.7) |
| `core/SmoothScroller` | Re-targetable rAF easing loop over a `{read, write, clamp}` seam, shared by native-overflow and transform scrolling | none | per ease frame: **2 writes + 2 read-backs through the `Component` target, one axis of which never moved** | **over-built** on the write side; `isAnimating` dead | F04.4, F04.13 |
| `component/container/ScrollStrip` | Overflow-scrolling button rail: non-scrolling band + inner clip + two paging arrows in reserved gutters | band element; inner `_clip` `Panel`; 2 `ScrollStripArrowButton`s | after the 2026-09-15 clamp fix: **0 ops when not overflowing**; when overflowing, **108 ops of which 76 are the redundant `setGlyph` rebuild** (2 rule deletes + 2 inserts + 2 rule writes), 29 empty flushes, 1 `data-insets` write | **fits structurally**; the clamp fix landed correctly, but `layoutArrows` still does unconditional per-pass work | F04.1, F04.12 |
| `ScrollStripArrowButton` (file-local) | Class-tier chrome for the paging arrows | own element + glyph | rebuilt (glyph + rule) every pass by its owner | **fits** (the fault is the caller's) | F04.1 |
| `core/FocusReveal` | Registry brokering "surface a hidden focus target before focusing it", outermost-first | none | none per pass; per reveal: O(registry) `isConnected` + `contains` seam calls | **over-built** for its cold-path role | F04.15 |
| `FocusRevealer` (interface) | Two-method contract implemented by `Tab`, `Border`, `Accordion`, `Split`, `Panel`, `ScrollStrip` | — | — | **fits** | — |

---

## Redundant, duplicated and dead code

Items not already covered in Findings.

1. **`SCROLL_SHADOW_EXTENT_PX` / `SCROLL_SHADOW_RAMP_PX` are no longer orphan exports** — the 2026-08-29 audit's Priority-3 entry for `core/ScrollShadow.ts:25,35` is **closed**: both are now module-private `const`s (`ScrollShadow.ts:31,41`).
   `grep -rn "SCROLL_SHADOW_EXTENT_PX\|SCROLL_SHADOW_RAMP_PX" --include=*.ts packages/ | grep -v /dist/` → **2 hits, both the declarations themselves.** Recorded so a later sweep does not re-open it.

2. **`Scrollbar.getArrowStep()` / `isArrowsEnabled()` have no non-test callers.**
   `grep -rn "\.getArrowStep()\|\.isArrowsEnabled()" --include=*.ts packages/ | grep -v /dist/` → **6 hits, all in `tests/component/container/Scrollbar.test.ts`.** Not proposed for removal — they are the getter halves of a documented options pair, and the library's convention keeps getter/setter symmetry. Listed for completeness alongside F04.13, which *does* propose removing the setter that has no getter counterpart in use.

3. **`Panel.clearAutoScroll()` has one caller, a test.**
   `grep -rn "clearAutoScroll" --include=*.ts packages/ | grep -v /dist/` → **3 hits: the definition, the generated `.d.ts`, and `tests/component/default-options-fallback.test.ts:655`.** Keep — it is part of the library-wide `clearX()` convention and the test pins a real default-resolution behaviour.

4. **No narrative documentation page exists for `Panel`.** `packages/lib/docs/components/` has pages for `Scrollbar`, `ScrollStrip`, `VirtualScroller` and every `Panel` *subclass* (`TabPanel`, `AccordionPanel`, `FloatingPanel`, `PopupPanel`, `TablePanel`), but the base class — the library's only scroll host, carrying a five-part scroll stack (`autoScroll`, `scrollShadows`, `scrollbarStyle`, `flush`, and the gutter/`getInnerSize` contract) — is documented only by the generated `docs/api/core/classes/Panel.md` and by prose scattered across `Form.md`, `PopupPanel.md` and `concepts/accessibility.md`. `llms.txt` lists no entry for it either.

5. **`docs/components/VirtualScroller.md:28` still types the `init` hook as `protected init(element?: HTMLElement)`.** The DOM seam replaced every such signature with `Handle` (`dom-seams.md`, "outside `core/DOM.ts` an element is named only by a `Handle`"), and `local/no-raw-dom` would reject the documented code. Copy-paste from this page produces code that does not compile.

6. **`docs/components/Scrollbar.md:56,79` documents a runtime `setArrowsEnabled` toggle that no code performs** — see F04.13; the doc lines should go with the method.

7. **`Scrollbar.ts:460` derives `SCROLLBAR_ROOT_CLASS` from `this.constructor.name`** via `Component.init`'s class-name stamp, which `isScrollbarTarget` (`:485-497`) then matches on. This is the case the open `minification-safe-class-names` plan exists for — cross-referenced, not re-reported.

8. **`Panel.ts`'s prose no longer mentions `_overlayHost`** — the 2026-08-29 audit's Priority-4 stale-citation entry for this file is **closed**.
   `grep -rn "_overlayHost" packages/lib/src/typescript/lib/core/Panel.ts` → **0 hits.**

---

## Cross-slice notes

- **→ 01 core-component-lifecycle: `canSkipUnchangedLayout` has exactly one opt-in in the whole library.**
  `grep -rn "canSkipUnchangedLayout" --include=*.ts packages/lib/src/typescript/lib/` → the default (`core/Component.ts:4000`, `false`) and one override (`component/table/cell/Cell.ts:256`). Every container, every `Panel`, every layout host therefore re-runs `doLayout()` on an unchanged rectangle, which is the precondition for F04.2 and for the whole class of "settled pass still does work" findings. The `applyBounds` diff (`Component.ts:3982`) exists and works; almost nothing uses it. Deciding which components can safely opt in is a slice-01 call that several other slices depend on.

- **→ 01 core-component-lifecycle: `Component.setScrollLeft` / `setScrollTop` read back after every write** (`Component.ts:4395-4407, 4418-4430`) and call `_wheelScroller?.reset()`, which reads **both** axes (`Component.ts:4876-4879`). Measured at 3 live reads per single-axis write (probe `PANEL bar->setScrollTop`). See F04.14.

- **→ 01 core-component-lifecycle: `Component.setInsets` (`Component.ts:2531-2536`) has no value guard**, and `setDataAttribute` (`Component.ts:2093-2101`) is not gated on any diagnostics flag — every `setInsets` writes a `data-insets` attribute to production DOM. See F04.12.

- **→ 02 core-component-styling: a single `setBackgroundColor` on a class-styled component writes eleven declarations.** Probe `SCROLLBAR-DETAIL arrow mouseover` shows the `#id` rule write carrying `backgroundColor` plus **ten `null` removals** (`cursor`, `visibility`, `whiteSpace`, `userSelect`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `overflowX`, `overflowY`) produced by `flushStyleBag`'s class-default reconciliation. Correct, but it means every runtime style setter on a class-styled component is a wide rule mutation, not a narrow one.

- **→ 02 / 03: `InlineStyle.flushDirty` lacks the empty-bag guard its `StyleRule` sibling has** (`core/StyleTarget.ts:404-407` vs `:457-459`), and `StyleTarget.setMany` (`:48-50`) issues one `DOM.sink.apply` per key instead of one per call. Measured at 29 empty applies in one `ScrollStrip` pass and 6-instead-of-2 applies per `Panel` frame. See F04.10 — the fix belongs in slice 02/03 but the measurement is here.

- **→ 03 core-dom-seam-events: `Event.addSubtreeListener` gives no way to scope a `"scroll"` listener to the component's own element.** `Panel` registers two subtree scroll listeners precisely because the inner scroller has no id (`Panel.ts:1287-1291, 1561-1572`); the consequence is that any descendant's scroll charges the ancestor. A `{ selfOnly: true }` or target-handle-filtered registration option would fix F04.3 cleanly at the seam.

- **→ 03 core-dom-seam-events: constructing *any* `Scrollbar` locks `"touchstart"` as `passive: false` page-wide** for the app's lifetime (`Scrollbar.ts:613-619, 624-627`, with the caveat written out in the source and in `docs/reference/migration/next.md`). Since every scrolling `Panel` builds two `Scrollbar`s at first render (F04.8), this happens in practice in essentially every app. Worth a slice-03 look at whether `Event` can scope passivity per registration.

- **→ 05 layout-base-box-flow-grid: `VBox` calls each child's `getPreferredSize()` four times per layout pass.** Probe `P04-F` (`autoScroll:'none'`, 20 children, one identical pass) → 80 calls. `getPreferredSize` recurses into the child's own manager (`Grid.ts:345-392`, `Border.ts:857-932`) with no memoization, so the cost compounds with depth. F04.6 adds a fifth call; the other four are slice 05's.

- **→ 07 layout-tab-tabbar: `TabBar.layoutChrome` calls `ScrollStrip.layoutContent` unconditionally on every pass** (`TabBar.ts:2911`), which is what makes F04.1 a per-frame cost. If `TabBar` gained its own unchanged-signature gate, F04.1's blast radius would shrink — but the `setGlyph` guard is still the correct fix, since `ScrollStrip` is a public component with other owners.

- **→ 10 overlay-dock-drag-rail-drawer / 11 overlay-popups: `Menu`'s item panel (`overlay/Menu.ts:195`) and `Dialog`'s content region (`overlay/Dialog.ts:727`) are `autoScroll` panels**, so every menu open and every dialog open pays F04.8's 12-component / 6-element / ~20-listener install even for a three-item menu that never overflows.

- **Contradiction to flag**: F04.7's shared-implementation proposal touches ground the open `plans/overlay-scrollbars-non-panel.md` explicitly claims ("`Panel` and `VirtualScroller` are not migrated onto the helper"). The proposal here is narrower — share the *numeric* visibility/placement core and the bar pair, not the scroller plumbing — and is intended to compose with that plan rather than replace it, but any implementer must reconcile the two before starting.

---

## Suggested plan grouping

**Plan A — "ScrollStrip arrow glyph churn" (do first; smallest change, largest measured win).**
F04.1 plus F04.12 riding along. One value guard in `Button.setGlyph`, one hoist in `ScrollStrip.layoutArrows`, one `Insets.equals` + `setInsets` guard. Measurable on its own: ms/frame on the 2×2 editor-grid horizontal gutter drag with overflowing tab strips, and the probe's op count (108 → ≤6). No dependency on any other plan. This is the direct continuation of `scroll-strip-deferred-resync` / `scrollstrip-resize-resync-coalescing` — those two removed the per-pass *read*; this removes the per-pass *rule mutation* they left behind.

**Plan B — "Panel unchanged-pass gate."**
F04.2 + F04.6. Give `Panel` a clamp signature (mirroring `ScrollStrip.layoutItems`), fold the shrink signal into it, and keep the existing burst relay as the second-level gate. Measurable: `getScrollMetrics` per unchanged `applyBounds` (2 → 0) and ms/frame on a gutter drag that does not resize the scrolling panel. Depends on nothing. **Explicitly does *not* include** the `canSkipUnchangedLayout` opt-in, which should be a slice-01 plan of its own — Plan B's gains are additive to it either way.

**Plan C — "One scroll listener per Panel."**
F04.3 + F04.14. Merge the two subtree scroll registrations into one handler with one `getScrollMetrics`, drop `resizeScrollShadowOverlay` from the scroll path, filter on the event target, and make `setScrollLeft`/`setScrollTop` single-axis. Measurable: reads per scroll event (3 → 1), reads per drag `mousemove` (6 → ≤2). Depends on slice 03 if the target filter needs a new `Event` registration option; otherwise self-contained. The `Component.setScrollLeft/Top` half is a slice-01 edit and should be carved out if slice 01 is planning that area anyway.

**Plan D — "SmoothScroller per-axis writes."**
F04.4. Skip the unmoved axis, defer the read-back to loop end, cache the max-scroll pair per gesture. Measurable: `scrollLeft` writes across a vertical-only ease (10 → 0) and ms/frame while wheel-scrolling. Independent of A–C, but its read-back deferral is cleanest **after** Plan C lands, since Plan C's merged scroll handler is where the settled value would come from. Sequence D after C.

**Plan E — "Scrollbar arrow hover state + dead-code removal."**
F04.5 + F04.13 + doc items 5/6 from *Redundant…*. Small, self-contained, and follows the exact template of the already-merged `button-resting-chrome-state-isolation` / `checkbox-radio-delegate-state-style-defaults` work. Measurable: `setRuleStyles` per hover cycle (2 → 0).

**Plan F — "Defer the overlay chrome until first overflow."**
F04.8 + F04.11. Changes a pinned contract (`PanelOverlayScrollbar.test.ts:140`), so it needs its own `## Architecture Decisions` section and should land after Plan B, whose signature gate provides the "has it overflowed" signal for free. Measurable: live `Component` count and stylesheet-rule count in `DiagnosticsOverlay` for a Loom session.

**Plan G — "Share the scrollbar-layout core."**
F04.7 + F04.9. The largest refactor and the one that must be reconciled with the open `overlay-scrollbars-non-panel` plan first. Depends on Plan B (whose signature already assembles the numbers the shared core needs) and should absorb `VirtualScroller`'s caching gap (F04.9) in the same change, since the memoized fixpoint *is* the shared core. Do last.

**Too small to plan on their own — ride along:**
- F04.12 → Plan A.
- F04.15 (`FocusReveal.containing`) → ride with whichever slice plans `FocusHistory`/`SpatialNavigation` (slice 28), not with this slice; it is a cold path and nothing here depends on it.
- F04.10 (`InlineStyle` empty flush + unbatched `setMany`) → **belongs to slice 02/03**, not to a slice-04 plan. It is a two-line change with library-wide effect; whoever plans `core/StyleTarget.ts` should take it, and Plan B's probe will show the improvement for free.

---

## Probes

All probe files live in `.worktrees/_probes/04-core-panel-scrolling/` and were run with:

```
PROBE_DIR=.worktrees/_probes/04-core-panel-scrolling \
  npx vitest run --config .worktrees/_probes/vitest.probe.config.ts --disable-console-intercept
```

`panel.probe.test.ts`, `scrollbar.probe.test.ts`, `scrollstrip.probe.test.ts`,
`virtualscroller.probe.test.ts` (pre-existing in the probe directory; re-run
and their output verified against the source for this report),
`panel2.probe.test.ts`, `panel3.probe.test.ts`, `panel4.probe.test.ts` (added
for this report). 21 probes across 7 files, all passing. Nothing in the main tree was
modified.
