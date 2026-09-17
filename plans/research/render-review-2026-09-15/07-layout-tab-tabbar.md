# 07 layout-tab-tabbar — render-work review

**Summary**

1. An *overflowing, scrollable* tab strip — Loom's editor stack once more than a
   few files are open — tears down and rebuilds both scroll-arrow glyphs on
   **every** layout pass: 2 `insertRule` + 2 `deleteRule` + 2 `setRuleStyles`,
   10 element creations and 6 handle releases per frame per pane. Stylesheet
   mutation on hot path 1 is the most expensive thing this slice can do
   (F07.1, HIGH).
2. `TabBar.stripThickness()` re-derives every tab button's preferred size on
   every call, and one outer `Split` pass calls it **10× per pane** (measured:
   20 calls / 160 `buttonCrossExtent` for 2 panes × 8 tabs). A 2×2 Loom grid
   with ~10 tabs per pane is ~400 full `TabButton` preferred-size derivations
   per frame (F07.2, HIGH).
3. `TabBar.applyTabButtonStyles()` rewrites every tab button's insets,
   writing-mode and text-align every pass: N fresh `Insets` (each with a UUID),
   N+6 unguarded `data-insets` attribute writes, 2N `Button.recomputePreferredSize`,
   and — via `Button.setTextAlign`'s unconditional `scheduleLayout()` — N extra
   `TabButton` layout roots that run 4N component `doLayout`s on the *next*
   frame (F07.3, HIGH).
4. The default `widthMode: "equal"` is **quadratic**: 8 tabs → 192
   `computePreferredSize` per pass, 16 tabs → 640 (F07.4, HIGH).
5. `Tab.attach` materialises the whole bar subtree — 9 elements and **7
   stylesheet rules** — at container *construction*, contradicting
   `docs/concepts/performance.md`'s "construction is JS-only"; and a
   `setBarVisible(false)` bar (Dock's root frame) is hidden with
   `visibility:hidden`, so those 9 elements stay in the render tree and are
   charged on every ancestor resize (F07.5, F07.6, MEDIUM).

All counts are from probes in
`.worktrees/_probes/07-layout-tab-tabbar/` (`tab-pass.test.ts` …
`tab-pass5.test.ts`), run against the lib's vitest setup with the modelled DOM.
The "Loom configuration" used throughout is
`{ widthMode: 'content', maxWidth: 160, scrollable: true, compact: true, reorderable: true }`
with closeable, glyphed tabs — exactly `loom/src/EditorController.ts:112` plus
`Dock.ts:812`'s `compact: true, reorderable: true`.

---

## Findings

### F07.1 An overflowing scroll strip rebuilds both arrow glyphs — and two stylesheet rules — every layout pass

- **Category**: C (stylesheet-rule write on a hot path), B, F, G
- **Impact**: **HIGH** — per frame, per visible pane whose tab strip overflows.
  In Loom that is every editor pane with more than a screenful of tabs.
- **Where**:
  - `component/container/ScrollStrip.ts:801-802` — `lead.setGlyph(...)`,
    `trail.setGlyph(...)`, unconditional inside `layoutArrows`.
  - `component/button/Button.ts:1789-1819` — `setGlyph` has **no
    unchanged-name guard**: it always constructs a new `ButtonIconGlyph`,
    calls `_rebuildContentRow()`, then `outgoing?.dispose()` (which releases
    the element handle and deletes the glyph's per-instance stylesheet rule)
    and `recomputePreferredSize()`.
  - `component/container/TabBar.ts:2911` — `this._tabClip.layoutContent(arrowReserve, endGap)`,
    the call that reaches `layoutArrows`.
  - `component/container/TabBar.ts:2900` — `arrowReserve(...)` is what gates it:
    non-zero only when `scrollable` **and** the tabs overflow.
- **Hot path**:
  - `Body.doLayout` / `Split` gutter drag → … → `Tab.doLayout` (`layout/Tab.ts:2057`)
  - → `TabBar.placeStrip` (`TabBar.ts:2853`) → `TabBar.layoutChrome` (`TabBar.ts:2874`)
  - → `ScrollStrip.layoutContent` (`ScrollStrip.ts:744`) → `ScrollStrip.layoutArrows` (`ScrollStrip.ts:786`)
  - → `Button.setGlyph("angle-left")` × 2, same value as last frame
  - → `new ButtonIconGlyph` → `ensureStyleRule` + `setRuleStyles`; `outgoing.dispose()` → `deleteStyleRule` + `release`.
- **Evidence** (probe `tab-pass3.test.ts`, 12 closeable tabs, 500 px strip,
  Loom options; one unchanged `doLayout` after two warm passes):
  - `J1 setGlyph calls in one unchanged pass: ["ScrollStripArrowButton:angle-left","ScrollStripArrowButton:angle-right"]`
  - `J1 structural/rule ops in that pass: {"removeElement":6,"createElement":2,"createElementNS":8,"ensureStyleRule":2,"setRuleStyles":2,"deleteStyleRule":2,"release":6}`
  - `J2 (2 tabs, wide strip — no overflow) structural/rule ops: {}`
  - `J3 (default widthMode=equal, non-scrollable, 12 tabs) structural/rule ops: {}`
  - `ProductionDOMSink.deleteStyleRule` (`core/DOM.ts:1714`) additionally scans
    `sheet.cssRules` linearly to find the rule index, so the cost grows with the
    app's total rule count.
  - Briefing cost model: *any* stylesheet-rule mutation forces a full-document
    restyle (~195 ms/frame at 21k nodes for a single write). Six of them per
    frame per overflowing pane. Real-engine magnitude **not verified**.
- **Proposed change**: give `Button.setGlyph` an unchanged-name guard (it can
  read the current name back through `this._glyph?.getGlyphName()`, which
  `TabBar.getEntryGlyph` already uses), *and* make `ScrollStrip.layoutArrows`
  set the arrow glyphs only when `isVertical()` changed since the last pass
  (the only input to that expression). Either alone fixes the symptom; both
  together also protect every other per-pass `setGlyph` caller.
- **Risk / blast radius**: `Button.setGlyph` is called from ~40 sites; a guard
  changes behaviour only for a same-name re-set, which today is a
  destroy/rebuild that also drops any per-glyph state a caller applied through
  `getGlyph()`. `TabBar.test.ts:439` ("setEntryGlyph disposes the glyph it
  replaces") pins the *different-name* case and is unaffected.
  `ScrollStrip`'s arrows have no test that reads their glyph identity.
- **Proof at implement time**: a probe asserting zero `ensureStyleRule` /
  `deleteStyleRule` / `createElementNS` ops in a second unchanged `Tab.doLayout`
  pass on an overflowing scrollable strip (probe `J1` inverted); then
  ms/frame on the 2×2 editor-grid horizontal drag with ≥12 tabs per pane.
- **Cross-slice**: the two files are owned by **04 core-panel-scrolling**
  (`ScrollStrip`) and **13 button-glyph-image** (`Button.setGlyph`). `TabBar` is
  `ScrollStrip`'s only consumer in the library, and this is the path that makes
  it a per-frame cost.

---

### F07.2 `stripThickness()` re-derives every tab button's preferred size, and runs ~10× per pane per frame

- **Category**: D (layout work recomputed with unchanged inputs — no memo)
- **Impact**: **HIGH** — multiplied by tabs × panes × re-entries.
- **Where**:
  - `component/container/TabBar.ts:2222-2252` — `stripThickness()` loops
    `_entries` calling `buttonCrossExtent(entry.button)`.
  - `component/container/TabBar.ts:2193-2201` — `buttonCrossExtent` is
    `button.getPreferredSize()`, which for a `TabButton` is derived live every
    call (`component/button/Button.ts:2373-2384` → `computePreferredSize` →
    `_content.getPreferredSize()` + `getPerimeterSize()`).
  - `layout/Tab.ts:2128` — one call in `doLayout`.
  - `component/container/TabBar.ts:2887` — a **second** call inside
    `layoutChrome`, even though `placeStrip` was just handed a `height`/`width`
    derived from the first call.
  - `layout/Tab.ts:1682` — `composeSize()` calls it again, and
    `getPreferredSize` / `getMinSize` / `getMaxSize` (`Tab.ts:1626/1636/1646`)
    all route through `composeSize`.
- **Hot path**:
  - `Split.doLayout` → `resolveBounds(tabHost, …)` reads `getPreferredSize`,
    `getSize`, `getMaxSize`, `getMinSize` (`layout/LayoutManager.ts:608-613`)
  - → each of the three size reports → `Tab.composeSize` → `TabBar.stripThickness()`
  - → N × `TabButton.getPreferredSize()` → N × content-row aggregation + perimeter
  - and again, twice, inside the `Tab.doLayout` that follows.
- **Evidence** (probe `tab-pass5.test.ts`, a horizontal `Split` over two
  Loom-configured `Tab` panes of 8 tabs each, one outer unchanged pass):
  - `L2 one outer Split pass (2 Tab panes x 8 tabs): TabBar.stripThickness=20 TabBar.buttonCrossExtent=160 TabBar.applyTabButtonStyles=2`
  - i.e. **10 `stripThickness` calls per pane per frame**, each a full
    N-button preferred-size sweep. Extrapolated to a 2×2 grid with 10 tabs per
    pane: ~400 `TabButton` preferred-size derivations per frame, before the
    width-mode work in F07.4.
  - Probe `tab-pass3.test.ts`: `J4 one doLayout pass: stripThickness=2 buttonCrossExtent=24`
    (12 tabs) — the `doLayout` half alone already double-counts.
  - This is the `Tab`-side instance of slice 05's "size reports are recomputed,
    never memoised, and re-entered 4–8 times per child per pass".
- **Proposed change**: memoise `stripThickness()` behind a per-pass signature
  (`_compact`, `_side`, `_widthMode`, `_fixedWidth`, the resolved scale's
  `tabButtonInset`, and an entry-set version counter bumped by
  `createBarEntry` / `removeBarEntry` / `setEntryName` / `setEntryGlyph` /
  `setEntryItalic`), invalidated on theme change (the bar already subscribes,
  `TabBar.ts:644`). Separately, pass the already-computed `thickness` into
  `layoutChrome` instead of recomputing it there.
- **Risk / blast radius**: `stripThickness` is public API used by `Tab` only
  (`Tab.ts:1682`, `Tab.ts:2128`) and by the bar itself; the documented
  `prepareStrip → stripThickness → placeStrip` order in
  `docs/components/TabBar.md` is unchanged. `TabCloseReservePerTab.test.ts`
  and `TabCloseGlyphCentring.test.ts` pin the resulting geometry, so a stale
  memo would fail them.
- **Proof at implement time**: re-run probe `L2` and assert
  `buttonCrossExtent ≤ entries.length` per outer pass; then ms/frame on the
  2×2 editor-grid drag.

---

### F07.3 `applyTabButtonStyles` rewrites every button's insets / writing-mode / text-align every pass, and schedules one extra layout per tab

- **Category**: B (unchanged-value write), D (avoidable layout pass), G (allocation churn)
- **Impact**: **HIGH** — per frame, per pane, scaling with tab count.
- **Where**:
  - `component/container/TabBar.ts:2558-2594` — `applyTabButtonStyles()`, called
    unconditionally from `prepareStrip()` (`TabBar.ts:2831`), itself called
    unconditionally from `Tab.doLayout` (`layout/Tab.ts:2122`).
  - `component/container/TabBar.ts:2088-2115` — `computeTabButtonInsets()`
    allocates `new Insets(...)` per tab per pass; `Insets extends BaseObject`
    (`primitive/Insets.ts:18`) whose constructor calls `Util.generateUUID()` —
    a 36-character regex-replace with 32 `Math.random()` calls.
  - `core/Component.ts:2531-2535` — `setInsets` writes
    `data-insets` through `setDataAttribute` with **no unchanged-value guard**
    (`core/ElementAttributes.ts:30-37` applies straight to the DOM).
  - `component/button/Button.ts:2336-2341` — `Button.setInsets` overrides and
    calls `recomputePreferredSize()` (`Button.ts:2404`), which runs
    `_syncGlyphSize()` + a full `computePreferredSize()`.
  - `component/button/Button.ts:1244-1264` — `setTextAlign` calls
    `this.scheduleLayout()` **unconditionally**, with no comparison against the
    current alignment.
  - `TabBar.ts:2572-2576` — `clearWritingMode()` on the horizontal sides; for a
    button whose `_options.writingMode` is already undefined
    (`core/Component.ts:5282`) `super` returns early, but `Button`'s override
    (`Button.ts:1303-1326`) still calls `_text.clearWritingMode()`,
    `_description?.clearWritingMode()` and a second `recomputePreferredSize()`.
- **Hot path**: `Tab.doLayout` → `TabBar.prepareStrip` → `applyTabButtonStyles`
  → per entry: `computeTabButtonInsets` (alloc) → `Button.setInsets` →
  `data-insets` write + `recomputePreferredSize` → `clearWritingMode` →
  `recomputePreferredSize` → `setTextAlign` → `scheduleLayout()`.
- **Evidence**:
  - Probe `tab-pass.test.ts`, 3 tabs, *identical bounds*:
    `A2 writes per identical pass: {"setAttr:data-insets":5, …}`.
  - Probe `tab-pass2.test.ts`: `I2 8 tabs … "setAttr:data-insets":14`;
    `I2 16 tabs … "setAttr:data-insets":22` → **N + 6 unguarded attribute
    writes per pass**.
  - Probe `tab-pass3.test.ts`: `J5 12 tabs: computeTabButtonInsets=12 computeToolButtonInsets=1 getContentInsets=41`
    → 54 `Insets` (and 54 UUIDs) allocated per pane per frame.
  - Probe `tab-pass2.test.ts` `C2`: `recomputePreferredSize` = **2 per tab per
    pass** at every tab count and width mode (3 tabs → 6, 16 tabs → 32).
  - Probe `tab-pass2.test.ts` `B2` (4 tabs):
    `B2 scheduleLayout callers during one unchanged pass (4 tabs): {"TabButton":4}` and
    `B2 doLayout roots on the next rAF flush: {"Component:TabButton":4,"Component:Component":4,"Component:ButtonIconGlyph":4,"Component:ButtonLabelText":4}`
    — **4N extra component layout passes on the following frame**, every frame
    of a continuous resize.
  - Probe `tab-pass2.test.ts` `B3`: `two same-value setTextAlign calls scheduled: {"TabButton":2}`.
  - The `scroll-strip-deferred-resync` plan's Architecture Decisions already
    noted "five unconditional attribute rewrites, two of them ARIA" and fixed
    the ARIA pair in `Aria.setAttribute` (`core/Aria.ts:791`); my probe confirms
    zero ARIA writes now. The `data-insets` remainder is still open, and grows
    with tab count.
- **Proposed change**: three independent mechanisms.
  1. Gate `applyTabButtonStyles` on a signature — `(_compact, _side,
     _orientation, _textAlign, scale.tabButtonInset, scale.tabClose,
     entrySetVersion)`. `constraints.closeable` is construction-time only
     (`docs/components/TabButton.md`: "there is no runtime `setCloseable`"), so
     the whole strip needs at most two distinct `Insets` values, computed once
     per signature change rather than once per tab per frame.
  2. Give `Component.setInsets` (and `clearInsets`) an unchanged-value guard,
     the way `setPadding` (`Component.ts:2571`) already has one.
  3. Give `Button.setTextAlign` an unchanged-value guard so it stops scheduling
     a layout on a no-op.
- **Risk / blast radius**: (1) is local to `TabBar`; the theme-change path
  already re-lays-out through `Tab`'s subscription (`Tab.ts:376`), and
  `tab-font-relative-sizing`'s "re-pin, don't just pin once" intent is preserved
  because the resolved scale is part of the signature. (2) touches every
  `setInsets` caller in the library — it is a pure dedup, but `Insets` is
  mutable (`setTop` et al.), so the guard must compare the four numbers, not
  object identity. (3) is used by `Table` header cells and `Tab` only.
- **Proof at implement time**: a probe asserting ≤ 2 `data-insets` writes and
  **zero** `TabButton` `scheduleLayout` calls in a second unchanged
  `Tab.doLayout` pass; `DiagnosticsOverlay`'s *layout passes per second* during
  an idle resize drag.

---

### F07.4 `widthMode: "equal"` — the library default — is quadratic in preferred-size derivations

- **Category**: D
- **Impact**: **HIGH** for any strip on the default width mode; Loom escapes it
  by choosing `"content"`, but `Dock.ts:812`'s stacks and `DockRegion.ts:542`'s
  stacks both take the default.
- **Where**:
  - `component/container/TabBar.ts:2294-2302` — `tabModeExtent`'s `"equal"`
    branch loops **every** entry calling `buttonMainExtent`.
  - `component/container/TabBar.ts:2492-2514` — `predictTabsExtent` calls
    `predictedTabExtent` per entry, which calls `tabModeExtent` per entry → N².
  - `component/container/TabBar.ts:2333-2345` — the scrollable branch of
    `applyTabWidths` calls `tabModeExtent` once per entry → another N².
  - `component/container/TabBar.ts:2608-2614` — `endAlignGap` calls
    `predictTabsExtent` a **second** time when `_align === "end"`.
- **Hot path**: `Tab.doLayout` → `TabBar.layoutChrome` → `arrowReserve(this.predictTabsExtent(), …)`
  → N × `tabModeExtent` → N × N × `TabButton.getPreferredSize()`.
- **Evidence** (probe `tab-pass2.test.ts` `C2`, one unchanged pass):

  | tabs | widthMode | `TabButton.computePreferredSize` | `getPreferredSize` |
  |---|---|---|---|
  | 3 | content | 30 | 24 |
  | 8 | content | 80 | 64 |
  | 16 | content | 160 | 128 |
  | 8 | **equal** | **192** | 176 |
  | 16 | **equal** | **640** | 608 |
  | 16 | fill | 144 | 112 |

- **Proposed change**: compute the per-pass extents once — one array of
  `buttonMainExtent` values built at the top of `layoutChrome` and threaded
  through `predictTabsExtent` / `applyTabWidths` / `tabModeExtent` / `endAlignGap`
  / `scrollStepExtent`. The `"equal"` widest-extent scan then runs once per
  pass instead of once per entry per query.
- **Risk / blast radius**: pure refactor inside `TabBar`'s private width
  machinery; `TabBar.edgecases.test.ts` pins the mode defaults and round-trips,
  `TabCloseReservePerTab.test.ts` pins the resulting geometry.
- **Proof at implement time**: re-run `C2` and assert
  `computePreferredSize ≤ k·N` for every mode; ms/frame on a 16-tab strip drag.

---

### F07.5 `Tab.attach` materialises the whole bar subtree — 9 elements and 7 stylesheet rules — at container construction

- **Category**: E (work for invisible content), H (function/implementation mismatch)
- **Impact**: **MEDIUM** — once per `Tab`, but Loom's `Dock` builds one `Tab`
  per region, per stack, and per tear-off window; first-paint and
  layout-restore cost.
- **Where**:
  - `layout/Tab.ts:318` — `private _bar: TabBar = new TabBar();` (field
    initialiser, so it runs before the container exists).
  - `layout/Tab.ts:985` — `DOM.sink.appendChild(container.getElement(true)!, this._bar.getElement(true)!)`
    inside `attach()`; `getElement(true)` **force-creates**, which materialises
    the element and its per-instance `#id` rule.
  - `component/container/TabBar.ts:758-787` — `init()` then force-creates
    `_tabClip`, `_toolGroup`, `_leadGroup`, the clip element, `_indicator`,
    `_dropTint`, `_reorderBar`.
- **Hot path**: construction / first render — `new Container({ layoutManager: new Tab() })`
  → `Component.setLayoutManager` → `Tab.attach` → force-create ×9.
- **Evidence** (probe `tab-pass4.test.ts` `K2`):
  - `K2 new Container({}) ops: {}`
  - `K2 new Container({layoutManager: new Tab()}) ops: {"createElement":9,"setId":9,"apply":78,"ensureStyleRule":7,"setRuleStyles":7,"appendChild":8}`
  - `docs/concepts/performance.md:178` states "Construction itself is JS-only —
    no stylesheet inserts, no forced layout, no `document.body` probes — so
    building a detached subtree before attaching it to the live document is
    cheap and predictable." A `Tab` breaks that contract for its own container.
- **Proposed change**: move the bar's element append out of `attach()` into the
  container's first render — `Tab` already runs work per `doLayout`, so
  appending on the first `doLayout` (when `container.getElement()` is non-null
  anyway) keeps the same visible result. Alternatively defer only the overlay
  chrome (`_dropTint`, `_reorderBar` — needed only when `reorderable`;
  `_toolGroup` — needed only when a tool exists; `_leadGroup` — only when a
  leading widget is set) so a default strip materialises 4 elements, not 9.
- **Risk / blast radius**: `Tab.attach` is the only place that mounts the bar;
  `TabWindow` (`overlay/TabWindow.ts:81`) and `Dock` both construct through it.
  `Tab.lifecycle.test.ts` and `TabCloseGlyphCentring.test.ts` ("gives the close
  button a resolved size at construction") exercise the construction ordering.
- **Proof at implement time**: a probe asserting
  `new Container({ layoutManager: new Tab() })` performs zero `ensureStyleRule`
  ops; DiagnosticsOverlay's *stylesheet rules* count on Loom's cold start.

---

### F07.6 A hidden tab strip is hidden with `visibility:hidden`, so it stays in the render tree

- **Category**: E
- **Impact**: **MEDIUM** — per resize frame, for every `Tab` whose bar is
  hidden. `Dock` hides the root frame's bar in its normal single-region state
  (`overlay/Dock.ts:646`, `:1018`), which is Loom's steady state.
- **Where**:
  - `layout/Tab.ts:2119` — `this._bar.setVisible(this._barVisible)`.
  - `layout/Tab.ts:759-769` — `setBarVisible`, whose JSDoc says "the strip is
    removed from view and reserves no thickness".
- **Hot path**: any ancestor resize → the browser still styles and lays out the
  9-element hidden bar subtree.
- **Evidence**:
  - Probe `tab-pass4.test.ts` `K3`: `hidden bar: isVisible=false isDisplayed=true`.
  - Probe `tab-pass.test.ts` `G`: `hidden bar element exists: true ; parent is host element: true`,
    and the pass still writes (`{"style:height":2,"setAttr:data-insets":1,"style:top":1}`).
  - Briefing cost model: "A subtree hidden with `visibility:hidden` stays in the
    render tree and is charged on every ancestor resize (~9 ms/frame per hidden
    CodeMirror editor). `display:none` removes the cost." The library's own
    `undisplay-inactive-tab-pages` plan established exactly this distinction for
    tab *pages* — the strip itself was never converted.
- **Proposed change**: `Tab.doLayout` should call
  `this._bar.setDisplayed(this._barVisible)` instead of `setVisible`. The bar is
  hand-positioned (never a box child), so `display:none` costs it no layout
  slot; the `undisplay-inactive-tab-pages` plan's "`Tab` owns `displayed`,
  `visible` is the consumer's channel" rule applies unchanged here.
- **Risk / blast radius**: `setBarVisible` has one production caller
  (`overlay/Dock.ts:646/1012/1018/1048`). Nothing reads the bar's
  `isVisible()`; `Tab.isBarVisible()` reads `Tab`'s own `_barVisible` field.
  A `display:none` bar reports zero for live geometry reads, but `Tab` already
  skips `prepareStrip` / `stripThickness` / `placeStrip` when the bar is hidden
  (`Tab.ts:2121`, `:2128`, `:2217`), so nothing reads it while hidden.
- **Proof at implement time**: a probe asserting `bar.isDisplayed() === false`
  after `setBarVisible(false)`; ms/frame on a Loom window resize with the Dock
  in its single-region (bar-hidden) state.

---

### F07.7 Every `TabBar` configuration setter schedules a layout that can never re-apply the configuration

- **Category**: D (avoidable layout pass), H (function/implementation mismatch)
- **Impact**: **MEDIUM** — a correctness gap for the documented standalone
  `TabBar`, plus 13 wasted `scheduleLayout()` calls.
- **Where**: `component/container/TabBar.ts:874, 899, 924, 953, 989, 1014,
  1040, 1065, 1098, 1130, 1211, 1256, 1291` — every setter ends with
  `this.scheduleLayout()`. The strip's actual re-configuration lives in
  `layoutChrome` (`TabBar.ts:2874`), which is reachable **only** from
  `placeStrip` (`TabBar.ts:2859`), which only the owner calls.
- **Hot path**: `bar.setWidthMode(…)` → `scheduleLayout()` → rAF flush →
  `TabBar.doLayout()` → the bar's `HBox` manager over **zero** box children →
  nothing happens.
- **Evidence**:
  - Probe `tab-pass4.test.ts` `K1`:
    `standalone TabBar after 3 setters: TabBar.doLayout=1 TabBar.layoutChrome=0`.
  - Probe `tab-pass4.test.ts` `K4`:
    `TabBar.getComponents().length = 0 ; manager = HBox` — `TabBar` never calls
    `addComponent` on itself (grep for `this.addComponent` in `TabBar.ts`: 0
    hits); tabs go to `_tabClip`, tools to `_toolGroup`, the lead widget to
    `_leadGroup`. The `HBox({ mode: "equal", spacing: 0, stretching: true })`
    installed at `TabBar.ts:601` therefore has nothing to lay out, ever.
  - It works today only because every `Tab` forwarder *also* calls
    `this.getContainer()?.scheduleLayout()` (`layout/Tab.ts:487`, `:512`, … 13
    sites), which reaches `Tab.doLayout` → `placeStrip`.
  - `docs/components/TabBar.md:80` documents these setters as standalone public
    API ("the same strip knobs … each with a typed setter … they behave
    identically here"), which is not true for a bar the consumer positions
    itself.
- **Proposed change**: have `TabBar.doLayout()` re-run `layoutChrome` against
  its last placed rectangle (cache `width`/`height` in `placeStrip`), so the
  bar's own setters are self-sufficient. Then `Tab`'s 13 forwarders no longer
  need their own `scheduleLayout()` — the bar's scheduled pass does the work —
  removing one scheduled root per strip setter call.
- **Risk / blast radius**: the documented
  `prepareStrip → stripThickness → placeStrip` contract must stay the owner's
  path; making `doLayout` re-enter `layoutChrome` adds a second entry point, so
  the thickness memo of F07.2 must invalidate correctly. `TabBar.edgecases.test.ts`
  covers the setter round-trips but asserts no geometry.
- **Proof at implement time**: invert probe `K1` — assert
  `layoutChrome ≥ 1` after a standalone `setWidthMode`.

---

### F07.8 A tab-header drag forces two live DOM reads per drag frame, after writing the drop cues

- **Category**: A (forced sync read on a hot path)
- **Impact**: **MEDIUM** — per pointer frame, but only while a tab drag is in
  flight (hot path 3).
- **Where**:
  - `component/container/TabBar.ts:3024-3035` — `onDragOver` writes first
    (`this._dropTint.showOver(this._tabClip)` → `setX`/`setY`/`setWidth`/`setHeight`/`setVisible`)
    and then reads.
  - `component/container/TabBar.ts:3169` —
    `const rect = DOM.source.getElementRect(element)` — a live
    `getBoundingClientRect` on the clip frame.
  - `component/container/TabBar.ts:3177` — `this._tabClip.mainScroll()`, which
    is `_clip.syncScrollOffsets()` + a cached read (`ScrollStrip.ts:859-864`) —
    a second live read.
- **Hot path**: `mousemove` (rAF-coalesced by `dragmanager-pointer-coalescing`)
  → `DragManager` → `makeTabDropTarget.onDragOver` → `_dropTint.showOver` (write)
  → `updateReorderSlot` → `getElementRect` (read) + `syncScrollOffsets` (read)
  → `_reorderBar.placeAt` (write).
- **Evidence**: read from the code; the write-then-read ordering is explicit at
  `TabBar.ts:3025-3026`. After the first drag frame the `showOver` setters are
  unchanged-value no-ops (`Component.setX`/`setWidth` guard), so the reads may
  not always follow a real write — **not verified** which of the two dominates
  in a real engine.
- **Proposed change**: hoist `updateReorderSlot` above `showOver` so both reads
  precede every write in the handler, and replace
  `DOM.source.getElementRect(clipHandle)` with
  `DOM.source.getViewportRect(clipComponent)` — `ScrollStrip._clip` is a real
  `Component`, and per `docs/concepts/dom-seams.md` the component-keyed rect is
  derived from cached layout state and needs no browser layout. That requires
  `ScrollStrip` to expose the clip `Component` (or a `clipViewportRect()`
  helper) rather than only its `Handle`.
- **Risk / blast radius**: `updateReorderSlot` is called only from `onDragOver`;
  `TabBar.test.ts:212` ("keeps the indicator glued to the active tab after
  moveBarEntry") pins the translate-folding arithmetic, not the rect source.
  Exposing the clip component is a `ScrollStrip` API addition (slice 04).
- **Proof at implement time**: a probe asserting zero `DOM.source.getElementRect`
  calls in a synthetic `onDragOver`; frame time during a tab drag in WebKitGTK.

---

### F07.9 Per-pass allocation churn in `Tab.doLayout` and `TabBar.layoutChrome`

- **Category**: G (allocation churn in the layout path)
- **Impact**: **MEDIUM** — per frame, per pane; scales with tab count.
- **Where**:
  - `layout/Tab.ts:2067` → `syncUntabbedChildren()` (`Tab.ts:1854-1877`)
    allocates a `Set<Component>` and fills it with up to 2N entries on **every**
    pass, purely to detect a child added by a bare `addComponent`.
    `LayoutManager` has no child-added hook (grep for `componentAdded` /
    `childAdded` in `layout/LayoutManager.ts`: 0 hits), so the sweep is the
    current mechanism.
  - `layout/Tab.ts:2213` — `this._bar.clearInsets()` on every pass in the
    common (`barIgnoreParentInsets === false`) case;
    `Component.clearInsets` (`core/Component.ts:2547`) always allocates
    `new Insets(0,0,0,0)` and always writes `data-insets`.
  - `layout/Tab.ts:2185/2193/2201/2209` — the `barIgnoreParentInsets` branch
    allocates a fresh `Insets` per pass instead.
  - `layout/Tab.ts:2065` and `TabBar.ts:2880` — two `getContentInsets()` calls,
    each allocating (slice 28's finding).
  - `component/container/ScrollStrip.ts:760/766` — `_clip.setInsets(new Insets(…))`
    per pass (slice 04).
- **Evidence**: probe `tab-pass3.test.ts`
  `J5 12 tabs: computeTabButtonInsets=12 computeToolButtonInsets=1 getContentInsets=41`
  → ~54 `Insets` objects, each minting a UUID through
  `Util.generateUUID()` (`core/Util.ts:363`: a 36-char regex replace with 32
  `Math.random()` calls), per pane per frame. At 4 panes and 60 Hz that is
  ~13,000 UUIDs per second in the layout path.
- **Proposed change**: (a) cache the two `Insets` values `computeTabButtonInsets`
  can produce (F07.3 already removes the per-tab call); (b) skip
  `this._bar.clearInsets()` when the bar's insets are already zero; (c) give
  `syncUntabbedChildren` a cheap gate — compare
  `container.getComponents().length` against the number of owned components and
  skip the `Set` build when they match. (d) belongs to slice 01/28: `Insets`
  does not need to extend `BaseObject` — nothing reads an `Insets`'s id
  (grep `insets.getId()` / `Insets` + `getId`: 0 hits in `packages/`).
- **Risk / blast radius**: (c) must still fire when a child was added *and*
  another removed in the same frame — comparing counts alone is not sufficient;
  a monotonic child-list version on `Component` would be. (d) is a
  library-wide change to a `primitive` type.
- **Proof at implement time**: a probe counting `Insets` constructions per
  unchanged `Tab.doLayout`; JS-heap allocation rate in a DevTools profile.

---

### F07.10 The visible page is placed through `placeComponent`, which reads four size hints and discards them

- **Category**: D
- **Impact**: **MEDIUM** — per frame, per visible pane; each discarded read is a
  `CodeEditor`'s uncached size report in Loom.
- **Where**:
  - `layout/Tab.ts:2239-2246` — `this.placeComponent(component, contentX, contentY, contentWidth, contentHeight, FillType.BOTH)`.
  - `layout/LayoutManager.ts:608-613` — `resolveBounds` reads
    `getPreferredSize()`, `getSize()`, `getMaxSize()`, `getMinSize()`
    unconditionally; with `FillType.BOTH` the width and height come from the
    cell, so the preferred size is dead weight.
  - `layout/LayoutManager.ts:547/566` — `commitBounds` ends with an
    unconditional `component.doLayout()`.
- **Hot path**: `Tab.doLayout` → `placeComponent` → `resolveBounds` (4 size
  reports on the editor subtree) → `commitBounds` → `CodeEditor.doLayout()`.
- **Evidence**: read from the code. `LayoutConstraints.fill` defaults to `null`
  (`layout/LayoutConstraints.ts:39`), so `Tab`'s explicit `FillType.BOTH` wins
  for every page added without an explicit fill — i.e. every page `TabPanel`,
  `Tab.createTab` and `Dock` create. This is the `Tab` instance of slice 05's
  "`resolveBounds` then discards four of those reads whenever the child fills
  both axes, which is the common case", and of slices 01/05's "no built-in
  layout manager uses `Component.applyBounds`".
- **Proposed change**: when the resolved page carries no `fill`/`anchor`
  constraints of its own, `Tab` can call `commitBounds` directly with the
  content rectangle (the `Absolute` manager already takes that escape hatch —
  `LayoutManager.ts:600`'s doc names it). Separately, `Tab` is a good candidate
  for the `canSkipUnchangedLayout` opt-in on the **page**: on a
  cross-axis-only pane resize the page rectangle is genuinely unchanged.
- **Risk / blast radius**: a page *with* `fill`/`anchor` constraints must keep
  the `resolveBounds` path. `Tab.test.ts:113-160` ("content-area overflow
  inflation") pins the interaction with `inflateForOverflow`.
- **Proof at implement time**: a probe asserting ≤ 1 `getPreferredSize` call on
  the visible page per unchanged pass; ms/frame on the 2×2 editor grid.

---

### F07.11 `Tab` mirrors `TabBar`'s entire configuration surface, and the option ladder exists three times

- **Category**: I (duplication), H (over-engineering)
- **Impact**: **LOW** (code health) — but it is ~40 % of `Tab.ts`'s length and
  the reason a reader cannot tell which class owns strip state.
- **Where**:
  - `layout/Tab.ts:484-747` — 13 setter/getter pairs
    (`setWidthMode`/`getWidthMode`, `setMaxWidth`/`getMaxWidth`,
    `setFixedWidth`/`getFixedWidth`,
    `setUnderBorderFullWidth`/`isUnderBorderFullWidth`, `setSide`/`getSide`,
    `setAlign`/`getAlign`, `setOrientation`/`getOrientation`,
    `setTextAlign`/`getTextAlign`, `setScrollable`/`isScrollable`,
    `setCompact`/`isCompact`, `setReorderable`/`isReorderable`), each a
    one-line forward to `this._bar` plus `this.getContainer()?.scheduleLayout()`
    — ~264 lines of pure forwarding.
  - `layout/Tab.ts:156-235` (`TabOptions`) duplicates
    `component/container/TabBar.ts:130-190` (`TabBarOptions`) field-for-field
    for 11 fields, JSDoc included.
  - Three parallel option→setter ladders over the same fields:
    `Tab.applyOptions` (`Tab.ts:410-473`), `TabBar.dispatchBarOptions`
    (`TabBar.ts:664-727`), `Dock.applyTabOptions` (`overlay/Dock.ts:2032-2045`).
  - `component/container/TabBar.ts:31` — `TabBar` imports
    `TabWidthMode` / `TabSide` / `TabOrientation` from `~/layout/Tab.js`, even
    though `docs/components/TabBar.md:12` calls the bar "a pure dependency
    sink". The types belong on the bar's side of the extraction.
  - `docs/components/TabPanel.md:5` explicitly rejects this pattern one level
    up ("rather than a mirrored forwarder per setter"), so the library is
    inconsistent with its own stated preference.
- **Evidence**: line counts above; `Tab.ts` is 2,853 lines and `TabBar.ts`
  3,413.
- **Proposed change**: move `TabWidthMode` / `TabSide` / `TabOrientation` to
  `TabBar.ts` (re-exported from `layout/Tab.ts` for compatibility), make
  `TabOptions extends TabBarOptions` (adding only the content-side fields:
  `listeners`, `tools`, `barIgnoreParentInsets`, `detachWindowMode`), and
  replace `Tab`'s 13 forwarder pairs with a single documented `getBar(): TabBar`
  accessor — exactly the shape `TabPanel.getTab()` already uses. Keep the
  existing forwarders as thin deprecated shims if the public surface must not
  break. `Dock.applyTabOptions` then becomes
  `tab.getBar().applyOptions(filtered)`.
- **Risk / blast radius**: the 13 setters are public documented API
  (`docs/layouts/Tab.md`, `docs/components/TabPanel.md`); removing them is a
  breaking change, so the shim route is the safe one. Depends on F07.7 (the
  bar's own `scheduleLayout` must actually work before the forwarders can stop
  scheduling for it).
- **Proof at implement time**: line-count delta and a compile of the docs app +
  create-app templates.

---

### F07.12 Smaller duplication and dead code

- **Category**: I, J
- **Impact**: **LOW** (code health only)
- **Where / evidence**: see the `## Redundant, duplicated and dead code`
  section below for the full list with greps.

---

## Entity inventory

| Entity | Stated function (one line) | Owns DOM (elements, rules) | Per-layout-pass writes / reads | Verdict | Findings |
|---|---|---|---|---|---|
| `layout/Tab` | Content manager: selected page, lazy-load, tear-off, docking; drives a composed `TabBar`. | None of its own; raw-appends the bar's element into the container (`Tab.ts:985`). | Reads: `getComponents`, `getInnerSize`, `getContentInsets` (1 alloc), `isEffectivelyVisible` × inactive children, `stripThickness` (×1 here, more via size reports). Writes: `setDisplayed(false)` + `aria-hidden` per inactive child (both guarded), `bar.setVisible`, `bar.clearInsets()` (**unguarded** `data-insets` + alloc), `placeStrip` (4 guarded geometry writes), `placeComponent` on the page. No live DOM reads (probe `D`: `{}`). | **over-built** (content manager + a full mirror of the bar's config surface) | F07.3, F07.5, F07.6, F07.9, F07.10, F07.11 |
| `component/container/TabBar` | Standalone window-agnostic strip: toolbar, cells, indicator, reorder bar, tools, overflow scroll, tab DnD. | 1 own element (role=`tablist`) + `_tabClip` (ScrollStrip, 2 elements), `_toolGroup`, `_leadGroup`, `_indicator`, `_dropTint`, `_reorderBar` — 9 elements, 7 `#id` rules, all force-created at `Tab.attach`. | Per pass: `applyTabButtonStyles` → N `Insets` allocs + N `data-insets` writes + 2N `recomputePreferredSize` + N `scheduleLayout`; `stripThickness` ×2 (N `getPreferredSize` each); `predictTabsExtent` + `applyTabWidths` (N or N² `getPreferredSize`); `positionClipFrame` / `positionToolGroup` / `positionLeadGroup` / `positionIndicator` / `positionCloseButtons` / `positionModifiedBadges` (all guarded geometry setters). | **over-built** | F07.1–F07.4, F07.7, F07.8, F07.9 |
| `TabIndicator` (private, `TabBar.ts:229`) | The single shared selection bar that slides to the active tab. | 1 element + its `#id` rule. | `slideTo` → `setTranslate` + `setElementStyles` (6 props) per pass when the active cell's extent is > 0. `setElementStyles` writes inline styles unconditionally, but `positionIndicator` is only reached with a laid-out active cell, and the values are stable — probe shows no per-pass style writes attributable to it. | fits | — |
| `TabReorderBar` (private, `TabBar.ts:344`) | The insertion rule shown during a within-strip drag. | 1 element + rule; hidden until a drag. | Nothing per layout pass; 4 guarded geometry writes + `setVisible` per drag frame. | fits | F07.8 (ordering) |
| `TabDropTint` (private, `TabBar.ts:413`) | The faint "droppable here" wash over the strip during a tab drag. | 1 element + rule; hidden until a drag. | Nothing per layout pass; 4 guarded writes per drag frame, all no-ops after the first. | fits | F07.8 |
| `component/container/TabPanel` | `Container` + an owned `Tab`, exposing `addTab`/`addLazyTab`/`getTab`. | None beyond `Container`'s. | None of its own. | **fits** — 192 lines, no per-pass work, the cleanest entity in the slice. | — |
| `component/container/tabCloseTargets` (`computeBulkCloseIds`) | Pure: which tab ids a bulk-close row targets. | None. | None — per context-menu open only. | fits | — |
| `component/button/TabButton` | Tab-styled `ToggleButton` with optional overlaid ✕, busy wash and modified dot. | Own element + `.TabButton` class rule + 3 state rules; raw-appends `_closeButton`, `_busyIndicator`, `_modifiedGlyph` onto its own element. | Per pass, driven by the bar: `setInsets` (→ `data-insets` write + `recomputePreferredSize`), `clearWritingMode` (→ another `recomputePreferredSize`), `setTextAlign` (→ `scheduleLayout`), `positionModifiedBadge` (guarded, allocates one size object). 10 `computePreferredSize` per tab per pass. | **mismatch** — the doc says "the strip keeps every geometry concern", yet the button re-derives its own preferred size twice per pass because the strip pokes it. | F07.3 |
| `TabBusyIndicator` (private, `TabButton.ts:85`) | Translucent pulsing wash marking a loading tab. | 1 element, built lazily on first `setBusy(true)`; shares a `.TabBusyIndicator` class rule. | None per pass. `setBusy` correctly clears the infinite keyframe when hidden (`TabButton.ts:420`). | fits | — |
| `component/button/TabCloseButton` | Compact ✕ button sized to sit inside a tab header. | Own element + `.TabCloseButton` class rule + 2 state rules. | Per pass, from `positionCloseButtons`: `setWidth`/`setHeight`/`pinGlyphSize`/`setX`/`setY` — all guarded no-ops on an unchanged pass. | fits | — |

---

## Redundant, duplicated and dead code

Greps are rooted at the repo root and cover `packages/lib`, `packages/lib/tests`,
the docs app (`packages/lib/src/typescript/*DemoPanel.ts`), `create-app`, and
`/home/jika/typescript/loom/src`. `/dist/` is excluded throughout.

**Dead — zero callers anywhere (definition only):**

| Symbol | Grep | Hits |
|---|---|---|
| `Tab.isEmpty()` (`layout/Tab.ts:786`) | `grep -rn "isEmpty" packages/ loom/src --include=*.ts \| grep -v /dist/` | 1 (the definition). `Dock.isEmpty` (`overlay/Dock.ts:434`) is Dock's own, over `_frames`. |
| `Tab.isBarIgnoreParentInsets()` (`layout/Tab.ts:812`) | `grep -rn "isBarIgnoreParentInsets" packages/ loom/src --include=*.ts` | 1 (the definition) |
| `Tab.getDetachWindowMode()` (`layout/Tab.ts:836`) | `grep -rn "getDetachWindowMode" packages/ loom/src --include=*.ts` | 1 (the definition) |
| `BarEntry.contextMenuListener` (`TabBar.ts:213`) | `grep -rn "contextMenuListener" packages/ --include=*.ts` | 2 — the declaration and the single write at `TabBar.ts:1780`; never read. The field's own comment admits "removal needs no reference of its own". |

**Dead in production — tests only:**

| Symbol | Grep | Hits |
|---|---|---|
| `TabBar.getEntryGlyph(id)` (`TabBar.ts:1571`) | `grep -rn "getEntryGlyph" packages/ --include=*.ts \| grep -v /tests/` | 1 (the definition) |
| `TabBar.getLeadingWidget()` (`TabBar.ts:1301`) | `grep -rn "getLeadingWidget" packages/ --include=*.ts` | 1 definition + 3 assertions in `TabBar.edgecases.test.ts` |

**Vestigial configuration:**

- `TabBar.ts:601` installs `new HBox({ mode: "equal", spacing: 0, stretching: true })`
  on the bar, but the bar never has box children:
  `grep -n "this.addComponent\|super.addComponent" packages/lib/src/typescript/lib/component/container/TabBar.ts` → **0 hits**,
  and probe `K4` prints `TabBar.getComponents().length = 0`. Every piece of
  chrome is raw-appended and hand-positioned by `layoutChrome`. The mode /
  spacing / stretching options describe a layout that never runs.
- `TabBar`'s constructor `subclassDefaults` parameter (`TabBar.ts:593`),
  `TabButton`'s (`TabButton.ts:252`) and `TabCloseButton`'s
  (`TabCloseButton.ts:77`): `grep -rn "extends TabBar\|extends TabButton\|extends TabCloseButton" packages/ --include=*.ts | grep -v /dist/` → **0 hits**.
  These are part of the library-wide class-cascade convention, so this is a note
  rather than a removal candidate.
- `TabCloseButtonOptions` (`TabCloseButton.ts:17`) is an empty interface
  extending `ButtonOptions` — it adds nothing.

**Duplication (both sites cited):**

- `TAB_FADE_DURATION_MS = 120` is declared twice, in `layout/Tab.ts:149` and
  `component/container/TabBar.ts:39`. Each file's comment acknowledges the other
  copy. One shared constant would do.
- `SCROLL_ARROW_STEP = 80` is declared twice, in
  `component/container/ScrollStrip.ts:39` and `component/container/TabBar.ts:72`,
  with near-identical doc comments. `TabBar` always installs a step provider
  (`TabBar.ts:613`), so `ScrollStrip`'s own default is unreachable for a tab
  strip while `TabBar` re-implements the same floor.
- The spring-loaded host-window raise exists twice with the same shape, the same
  `SPRING_RAISE_DELAY_MS` import and near-identical doc comments:
  `component/container/TabBar.ts:3055-3078` (`scheduleSpringRaise` /
  `clearSpringRaise`) and `layout/DockRegion.ts:164-181`. → slice 06/10.
- `isVertical()` — "west or east" — is implemented twice:
  `layout/Tab.ts:1656-1660` and `component/container/TabBar.ts:2420-2422`.
  `Tab`'s copy exists only because `TabBar`'s is private.
- `hostWindow()` (`Tab.ts:2560-2572`) and `ancestorWindow()` (`Tab.ts:2585-2593`)
  are the same `AbstractWindow` ancestor walk; the only difference is
  `hostWindow`'s `_closeHostWindowWhenEmpty` gate. `hostWindow` could be
  `this._closeHostWindowWhenEmpty ? this.ancestorWindow() : null`.
- Three option→setter ladders over the same 11–12 fields:
  `Tab.applyOptions` (`Tab.ts:410-473`), `TabBar.dispatchBarOptions`
  (`TabBar.ts:664-727`), `Dock.applyTabOptions` (`overlay/Dock.ts:2032-2045`).
- The strip-tool *flat* policy is applied in two places and disagrees:
  `Tab.addTool` forces `setFlat(true)` for a `Button` tool (`Tab.ts:883-885`),
  but `TabBar.addTool` (`TabBar.ts:1205-1214`) does not — only its
  descriptor path does, inside `buildDescriptorTool` (`TabBar.ts:1230`). A
  consumer using `TabBar` directly (the documented standalone path) gets an
  un-flattened tool; the `TabBar` doc page says nothing about the difference.

**Contract / documentation defects (LOW):**

- `TabBarOptions.listeners` (`TabBar.ts:132-141`) declares 8 of the 9
  `TabBarEvent` members — `tabdblclick` is missing, so it cannot be wired
  declaratively even though `on("tabdblclick", …)` exists (`TabBar.ts:3365`).
- `layout/Tab.ts:2357-2366` — a JSDoc block documenting `setActiveTabIndex`
  ("Activates the tab at the given index programmatically — clamped …") sits
  immediately above a *second* JSDoc block for `setActiveContent`. The real
  `setActiveTabIndex` (`Tab.ts:2389`) therefore has no doc comment of its own,
  and `setActiveContent` has two.
- `Tab.applyOptions` (`Tab.ts:466-472`) and `TabBar.dispatchBarOptions`
  (`TabBar.ts:718-724`) both contain
  `if (tool instanceof Component) { this.addTool(tool); } else { this.addTool(tool); }`
  — textually identical branches. Both comment that this is a TypeScript
  overload-resolution workaround, which is accurate; noted only so a future
  reader does not "simplify" it into a bug.
- `Tab._onBarReordered` (`Tab.ts:1111-1126`) sorts `_contents` with
  `order.indexOf(a.id) - order.indexOf(b.id)` — two linear scans inside the
  comparator, i.e. O(N² log N) per reorder. A `Map<string, number>` built once
  from `order` makes it O(N log N). Per reorder event only, so LOW.

---

## Cross-slice notes

- **→ 04 core-panel-scrolling**: `ScrollStrip.layoutArrows` (`ScrollStrip.ts:801-802`)
  calls `Button.setGlyph` with an unchanged name on every layout pass. Combined
  with `Button.setGlyph`'s missing guard this is 2 `insertRule` + 2
  `deleteRule` + 2 `setRuleStyles` + 10 element creations per frame per
  overflowing strip (F07.1) — the single largest item this slice found, and it
  lives entirely in slice 04's file. Also `ScrollStrip.layoutContent`
  (`ScrollStrip.ts:760/766`) allocates `new Insets(...)` per pass, and
  `ScrollStrip` exposes only a `Handle` for its clip frame, forcing `TabBar` to
  use `DOM.source.getElementRect` where `getViewportRect(component)` would
  serve from cache (F07.8).
- **→ 13 button-glyph-image**: `Button.setGlyph` (`Button.ts:1789`) has no
  unchanged-name guard — it always rebuilds the glyph, the content row and the
  stylesheet rule. `Button.setTextAlign` (`Button.ts:1244-1264`) calls
  `scheduleLayout()` unconditionally, even for the value it already has;
  `TabBar` calls it once per tab per layout pass, producing 4N extra component
  `doLayout`s on the next frame (probe `B2`). `Button.setInsets`
  (`Button.ts:2336`) chains a full `recomputePreferredSize()`, and
  `Button.getPreferredSize` derives live on every call with no memo — 10
  derivations per tab per pass (probe `C2`).
- **→ 01 core-component-lifecycle**: `Component.setInsets` /
  `clearInsets` (`Component.ts:2531` / `:2547`) have no unchanged-value guard,
  unlike their sibling `setPadding` (`Component.ts:2571`); every call writes
  `data-insets` straight through `ElementAttributes.set`
  (`core/ElementAttributes.ts:30`), which also has no guard. This slice
  measured **N + 6** such writes per pass. Confirming slices 01/05: `Tab` uses
  `placeComponent` → `commitBounds` → unconditional `child.doLayout()`, and
  overrides no `canSkipUnchangedLayout`; the visible page is the best
  `canSkipUnchangedLayout` candidate I saw in this slice, because a
  cross-axis-only pane resize leaves its rectangle identical.
- **→ 28 focus-navigation-forms-primitives / 01**: `Component.getContentInsets()`
  is called **41 times per `Tab.doLayout` pass** with 12 tabs (probe `J5`),
  each allocating an `Insets` whose `BaseObject` constructor mints a UUID.
  Nothing reads an `Insets`'s id — `Insets` arguably should not extend
  `BaseObject` at all.
- **→ 06 layout-split-border-dockregion / 10 overlay-dock-drag-rail-drawer**:
  `TabBar.scheduleSpringRaise` / `clearSpringRaise` (`TabBar.ts:3055-3078`)
  duplicates `DockRegion.ts:164-181` — same delay constant, same idempotence
  comment, same `DragManager.isDragging()` gate. One shared helper in
  `DragManager` would serve both. `Dock.applyTabOptions`
  (`overlay/Dock.ts:2032-2045`) is a third copy of this slice's option ladder.
- **Seam that does not hold**: `docs/concepts/performance.md:178` promises
  "Construction itself is JS-only — no stylesheet inserts, no forced layout".
  `new Container({ layoutManager: new Tab() })` performs 9 `createElement`, 7
  `ensureStyleRule` and 7 `setRuleStyles` before anything is rendered (probe
  `K2`), because `Tab.attach` (`Tab.ts:985`) uses `getElement(true)` on the
  whole bar subtree. Either the doc or the code is wrong.
- **Seam worth adding**: `LayoutManager` has no "a child was added" hook
  (`grep -n "componentAdded\|childAdded" layout/LayoutManager.ts` → 0 hits), so
  `Tab` re-sweeps every child against a freshly built `Set` on every layout pass
  (`Tab.ts:1854`). `Accordion` and `Card` are likely in the same position.

---

## Suggested plan grouping

**Plan A — "strip chrome stops churning the stylesheet"** (F07.1). Smallest,
highest payoff, measurable on its own. Two mechanisms: an unchanged-name guard
in `Button.setGlyph`, and an orientation gate in `ScrollStrip.layoutArrows`.
Touches slices 04 and 13's files, so it should be owned by whichever of those
plans lands first — but it must not be dropped, because `TabBar` is the only
path that makes it per-frame. No dependencies. Measure: rule writes per frame
under an overflowing 12-tab strip; ms/frame on the 2×2 grid drag.

**Plan B — "the tab strip re-applies only what changed"** (F07.3 + F07.2 +
F07.4). One coherent change set: a per-pass signature that gates
`applyTabButtonStyles`, a memo for `stripThickness`, one pre-computed extent
array threaded through the width machinery, and `layoutChrome` taking the
thickness as a parameter instead of recomputing it. Depends on nothing;
benefits compound with Plan A. Measure: `computePreferredSize` /
`buttonCrossExtent` / `data-insets` writes per unchanged pass at 3 / 8 / 16
tabs, in all four width modes.

**Plan C — "unchanged-value guards on the setters the strip calls per pass"**
(the `Component.setInsets` / `clearInsets` guard and the `Button.setTextAlign`
guard from F07.3, plus the `Button.setInsets` → `recomputePreferredSize`
chain). Library-wide, so it belongs with slice 01's and 13's own setter-guard
work rather than here; Plan B removes the per-pass *calls*, this removes the
per-call *cost* for every other caller. Independent of B, but B alone already
captures most of the tab-strip benefit.

**Plan D — "the tab bar leaves the render tree when it is not shown, and is
built when it is"** (F07.6 + F07.5). `setBarVisible` → `setDisplayed`, and the
bar's element mount moves from `Tab.attach` to first layout (or the overlay
chrome becomes lazy). One change set; both halves are about a bar nobody is
looking at. Depends on nothing. Measure: element and rule count after
`new Container({ layoutManager: new Tab() })`; ms/frame on a Loom resize with
the Dock in its bar-hidden single-region state.

**Plan E — "`TabBar` is self-sufficient; `Tab` stops mirroring it"** (F07.7 +
F07.11). A refactor: `TabBar.doLayout` re-runs `layoutChrome` against its last
placed rect, `TabWidthMode`/`TabSide`/`TabOrientation` move to `TabBar.ts`,
`TabOptions extends TabBarOptions`, `Tab` exposes `getBar()` and keeps its 13
forwarders as thin shims, and `Dock.applyTabOptions` collapses into the bar's
own option dispatch. **Depends on Plan B** (the thickness memo must invalidate
correctly once `layoutChrome` has a second entry point). Measure: line-count
delta, plus a probe asserting a standalone `TabBar` setter actually re-lays the
strip.

**Plan F — "tab drag reads before it writes"** (F07.8). Small; reorder
`onDragOver` and switch to a component-keyed viewport rect. **Depends on slice
04** exposing the clip frame's `Component`. Could ride along with whichever
`ScrollStrip` plan does that.

**Too small to plan — ride along with a neighbour:**
- F07.9's `clearInsets` skip and `syncUntabbedChildren` gate → Plan B.
- F07.10 (`placeComponent` → `commitBounds` for the page, and the
  `canSkipUnchangedLayout` opt-in) → whichever plan slice 01/05 writes for the
  `applyBounds` contract; `Tab` should be named in it as a concrete opt-in
  candidate.
- Every item in `## Redundant, duplicated and dead code` → one "tab slice
  cleanup" commit alongside Plan E (the dead methods, the duplicated constants,
  the `hostWindow`/`ancestorWindow` collapse, the `Tab.isVertical` removal, the
  missing `tabdblclick` listener field, the misplaced `setActiveTabIndex`
  JSDoc, the `addTool` flat-policy asymmetry, and the `_onBarReordered` sort).
