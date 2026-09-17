# 26 charts-canvas-video — render-work review

**Summary**

- `AbstractChart.doLayout` repaints from scratch on **every** pass: a 3-series ×
  50-point `LineChart` destroys and recreates **210 SVG elements and issues 1,081
  sink ops per layout pass**, with byte-identical inputs. A gutter-drag frame and
  a settled frame cost the same (probe: `1081` vs `1084`). An **empty** chart
  still rebuilds 57 axis marks per pass. (F26.1, HIGH)
- Every chart pass runs **12 un-batched `DOM.source.measureText` calls** —
  12 forced document layouts per chart per frame — to re-derive an axis margin
  that the code's own JSDoc says is range-independent and therefore cacheable.
  They land *after* the pass's own writes. (F26.2, HIGH)
- **Confirmed and quantified from slice 13**: `VideoPlayer.syncFromState:590-591`
  calls the unguarded `Button.setGlyph` twice per `timeupdate`. One `timeupdate`
  at an unchanged second costs **73 sink ops, 6 stylesheet-rule mutations and 6
  `scheduleLayout()` roots** — and **72 of the 73 ops and all 6 rule ops and all
  6 layout roots come from those two calls** (probe: stubbing them leaves exactly
  1 apply). One minute of playback = **17,640 sink ops and 1,440 rule
  mutations**. (F26.3, HIGH)
- Per `mousemove` over a chart: one forced `getElementRect`, and for a `LineChart`
  a fresh `CurveTape` + d3 `line()` generator **per visible series** (3 rebuilds
  of a 50-segment curve per pointer sample), then an unconditional
  `Tooltip.show` / `Tooltip.hide` with no same-datum guard — 10 identical-datum
  moves cost 83 sink ops, 3 rule ops and 20 `measureText`. (F26.4, HIGH)
- A chart that nobody can see still repaints in full: an undisplayed chart on a
  store `datachange` or a theme change runs the same 1,081-op repaint
  (probe). (F26.6, MEDIUM)
- **Positives to protect** (all probe-verified): `canvas-pause-when-hidden` works
  for all three hiding shapes and resumes correctly; `ChartLegend`'s
  `setEntries`/`setOrientation` idempotency guards from `relayout-loop-fix` still
  hold; `syncBackingStore`'s short-circuit gives 0 sink ops over 10 unchanged
  passes; a chart pass issues **zero** stylesheet-rule mutations and zero empty
  applies; the chart's `Panel` base takes no forced scroll read.

---

## Findings

### F26.1 A chart tears down and rebuilds every SVG mark on every layout pass

- **Category**: F (SVG redraw with unchanged input), D (layout work recomputed
  with unchanged inputs), G (allocation churn)
- **Impact**: **HIGH** — per frame on hot path 1, multiplied by every visible chart.
- **Where**:
  - `component/chart/AbstractChart.ts:574-598` (`doLayout` — calls `repaint`
    unconditionally, last statement)
  - `component/chart/AbstractChart.ts:715-726` (`repaint` — `clearMarks()` then
    full redraw)
  - `component/chart/AbstractChart.ts:836-843` (`clearMarks` — `removeChild` +
    `release` per mark)
  - `component/chart/AbstractChart.ts:813-820` (`createMark` —
    `createElementNS` + `apply` + `appendChild` + array push per mark)
  - `component/chart/ChartAxis.ts:102-132`, `:148-170`, `:186-208` (3 marks per
    left tick, 2 per bottom tick)
  - `component/chart/LineChart.ts:235-260`, `:271-278` (1 path + 1 circle per point)
  - `component/chart/BarChart.ts:128-137` (1 rect per series × point)
- **Hot path**:
  - `Split`/`Dock` gutter drag → `LayoutManager.commitBounds` → `child.doLayout()`
    (unconditional — briefing, slices 01/05)
  - → `AbstractChart.doLayout:574`
  - → `repaint:715` → `clearMarks:836` (N × `removeChild` + N × `release`)
  - → `drawAxis` + `drawSeries` + `drawSelection` (N × `createElementNS` +
    `apply` + `appendChild`)
- **Evidence** (probe `chart-pass.probe.test.ts`, modelled sink, unchanged bounds
  and unchanged data):
  - `LineChart` 3×50, legend on, **one unchanged pass**:
    `{apply: 241, removeChild: 210, release: 210, createElementNS: 210,
    appendChild: 210}` = **1,081 sink ops**.
  - Ten identical passes: 10,810 ops — linear, no memo anywhere.
  - `BarChart` 2×12: 438 ops (83 marks) per pass.
  - **Zero series, legend on**: still `{apply: 61, removeChild: 57, release: 57,
    createElementNS: 57, appendChild: 57}` = 289 ops — the axis alone is 57
    marks rebuilt per frame with no data at all.
  - A 1px-width resize frame costs 1,084 ops vs 1,081 for a no-change frame: the
    chart does **not** distinguish "my rectangle moved" from "nothing changed".
  - Zero `ensureStyleRule`/`setRuleStyles`/`deleteStyleRule` in a pass (good), and
    zero empty applies (good) — the whole cost is element churn.
  - `AbstractChart` does **not** override `canSkipUnchangedLayout`
    (`grep -rn canSkipUnchangedLayout component/chart component/display` → 0 hits),
    so the briefing's "child handed its own rectangle" contract is inert here too.
  - In the target engine each pass also forces the engine to re-parse and
    re-rasterise the whole `<svg>` subtree (software Cairo), on top of the JS ops.
- **Proposed change**: two independent levers, smallest first.
  1. **Repaint gate.** Cache a repaint signature in `doLayout` —
     `{plot.x, plot.y, plot.width, plot.height}` + the x/y scale `domain()`+`range()`
     + a series-model revision counter bumped by `setSeries`/`rebuildFromStore`/
     `handleLegendToggle` + `_selectedPoint` + the theme revision — and skip
     `repaint()` entirely when it is unchanged. That takes a settled pass and an
     over-travel drag frame from 1,081 ops to ~30.
  2. **Update in place.** Keep the mark handles in `_marks` keyed by role
     (`axis-tick-i`, `series-s-point-i`) and re-`apply` the changed attributes
     instead of `removeChild`/`release`/`createElementNS`/`appendChild`. A resize
     frame that genuinely changes geometry then costs N applies, not 5N ops. The
     `Table`'s row pool (`component/table/Body.ts`) is the in-repo precedent for
     "rebind the slot, don't rebuild the node".
  - Both need `clearMarks`'s handle-release discipline preserved (the Glyphs
    sprite-leak lesson the JSDoc at `:1095-1099` cites).
- **Risk / blast radius**: `LineChart`, `BarChart`, any consumer subclass of
  `AbstractChart`. Pinned by `tests/component/chart/Chart.test.ts` "LineChart mark
  set" / "BarChart mark set" / "axis titles" / "draws no marks for a hidden
  series", which count `createElementNS` per tag on a *first* pass — a repaint
  gate leaves those green (first pass still paints); an in-place update rewrites
  them. `tests/component/chart/Chart.test.ts:179` (`dispose releases the last
  repaint marks`) pins the release path.
- **Proof at implement time**: a probe asserting ≤ 40 sink ops and zero
  `createElementNS` across 10 identical `doLayout()` calls on a 3×50 `LineChart`;
  and ms/frame on a `Split`-gutter drag with a chart in one pane.

---

### F26.2 Axis margins are re-measured per pass with 12 un-batched forced text measurements

- **Category**: A (forced sync read after a write, per frame), D (missing cache)
- **Impact**: **HIGH** — 12 forced document layouts per chart per frame on hot path 1.
- **Where**:
  - `component/chart/AbstractChart.ts:689-705` (`computePlot` — calls
    `measureAxisMargin` twice per pass)
  - `component/chart/ChartAxis.ts:64-87` (`measureAxisMargin` — `:76`
    `DOM.source.measureText(format(value))` inside a per-tick loop; `:84`
    `DOM.source.measureText("0")`)
  - `core/DOM.ts:2130-2178` (`measureText` — creates a `<span>`, appends it to
    `document.body`, takes **two** `getBoundingClientRect` reads, removes it; no
    cache)
  - `component/chart/AbstractChart.ts:585` (`sizeSurface` — the write that
    precedes the reads in the same task)
- **Hot path**:
  - resize frame → `AbstractChart.doLayout:574`
  - → `sizeSurface:606` → `DOM.sink.apply(svg, {setAttr, style})` **(write)**
  - → `reserveLegend:625` → legend geometry setters **(writes)**
  - → `computePlot:689` → `measureAxisMargin("left", …)` → 11 × `measureText`
    **(forced layout each)**
  - → `measureAxisMargin("bottom", …)` → 1 × `measureText`
- **Evidence** (probe): **12 `DOM.source.measureText` calls per pass**, invariant
  across chart size and data volume (3×50 line chart: 12; 2×12 bar chart: 12;
  zero-series chart: 12). 120 over 10 passes. Zero `measureTextWidths` calls —
  the mandated batch seam (`docs/concepts/performance.md:187`, "Measuring N
  strings one at a time costs N forced layouts") is not used anywhere in the
  slice. `measureAxisMargin`'s own JSDoc (`ChartAxis.ts:51-56`) states the
  measurement is "independent of the pixel range", i.e. it depends only on the
  scale's domain, the tick count and the font — a perfect cache key that nothing
  caches. Confirms slices 14/18 ("renderers must not call measure inline") on a
  new path.
- **Proposed change**:
  1. Replace the `measureText` loop in `measureAxisMargin` with one
     `DOM.source.measureTextWidths(labels)` call (12 forced layouts → 1).
  2. Memoise the result on the chart, keyed on
     `(orientation, scale.domain(), tickCount, themeRevision)`; the existing
     `ThemeManager.onThemeChange` subscription (`AbstractChart.ts:194`) is the
     invalidation hook. A settled pass and a pure-resize pass then take **zero**
     forced reads, because a resize changes only the pixel range.
  3. `computePlot:690` also builds a whole provisional scale pair only to read
     its ticks; with the memo it can reuse the previous pass's tick values when
     the domain is unchanged.
- **Risk / blast radius**: `measureAxisMargin` is used only by
  `AbstractChart.computePlot` (`grep -rn measureAxisMargin packages/` → 9 hits:
  definition, one call site ×2, tests). Pinned by
  `tests/component/chart/ChartAxis.test.ts:72-90` (margin grows with longer
  labels; constant one-line height for a bottom axis) — both survive a batch +
  memo.
- **Proof at implement time**: a probe asserting ≤ 1 `DOM.source.measureText` /
  `measureTextWidths` call on the first pass and **0** across 10 subsequent
  identical passes, and 0 across 10 pure-resize passes.

---

### F26.3 `VideoPlayer` re-sets both control glyphs on every `timeupdate` — 6 stylesheet mutations and 6 layout roots per event

- **Category**: B (unchanged-value write), C (stylesheet-rule write on a hot
  path), D (avoidable layout pass)
- **Impact**: **HIGH** — 4+ times per second for the whole duration of playback.
- **Where**:
  - `component/display/VideoPlayer.ts:590-591`
    (`this._playBtn.setGlyph(...)`, `this._muteBtn.setGlyph(...)`)
  - `component/display/VideoPlayer.ts:723-726` (`onVideoTimeUpdate` →
    `syncFromVideo` → `syncFromState`)
  - `component/display/VideoPlayer.ts:665-674` (`timeupdate` wired at construction)
  - `component/display/VideoPlayer.ts:589` (`_timeText.setText` — unguarded,
    writes on a byte-identical string)
- **Hot path**:
  - `<video>` fires `timeupdate` (≈4 Hz in WebKit)
  - → `Video`'s native handler → `ListenerBag.fire("timeupdate")`
  - → `VideoPlayer.onVideoTimeUpdate:723` → `syncFromVideo:599`
  - → `syncFromState:580` → `Button.setGlyph` ×2 → `Glyph` dispose + rebuild →
    `deleteStyleRule` + `ensureStyleRule` + `setRuleStyles` ×2, plus
    `scheduleLayout()` ×3 each
- **Evidence** (probe `videoplayer.probe.test.ts` / `videoplayer2.probe.test.ts`):
  - One `timeupdate` whose rendered state is **identical** (same second, same
    paused/muted state): `{apply: 31, removeElement: 6, createElement: 2,
    createElementNS: 8, appendChild: 8, setId: 2, ensureStyleRule: 2,
    setRuleStyles: 2, insertBefore: 4, deleteStyleRule: 2, release: 6}` =
    **73 sink ops, 6 of them stylesheet-rule mutations**.
  - Stubbing the two `setGlyph` calls and repeating: **1 sink op** (`apply`).
    So 72 of 73 ops are the unguarded glyph swap.
  - `player.scheduleLayout()` is called **6 times** per `timeupdate`; attributing
    each control write individually: `scrubber.setMax` 0, `scrubber.setValue` 0,
    `timeText.setText` 0, **`playBtn.setGlyph` 3**, **`muteBtn.setGlyph` 3**,
    `volume.setValue` 0. Every layout root per `timeupdate` is the glyph swap.
  - One second of playback (4 `timeupdate`s): 294 ops, 24 rule ops.
    One minute (240 `timeupdate`s): **17,640 ops, 1,440 rule ops**.
  - Resizing the player window *while playing*: 10 frames = 1,273 ops and 70
    rule ops (7/frame: 6 from the glyphs + 1 from the `Border` `clip-path`,
    slice 06).
  - `_timeText.setText` with a byte-identical string: 10 calls → 10 applies (no
    same-value guard) — confirms slice 14 on this path. Three of every four
    `timeupdate`s carry the same formatted string.
- **Proposed change**: the correct fix is upstream and already proposed by slice
  13 — a same-name guard in `Button.setGlyph` (and slice 18's `Glyph.setName()`).
  With that guard this finding disappears without touching `VideoPlayer`. If the
  upstream guard slips, the local mechanism is: hold the last-written glyph name
  in two fields and call `setGlyph` only on a change; and hold the last-written
  time string and skip `setText` when unchanged. Both are strictly worse than the
  upstream fix (they leave every other `setGlyph` caller exposed) — prefer the
  guard.
- **Risk / blast radius**: `Button.setGlyph` has many callers (`ScrollStrip`,
  filter cells, `VideoPlayer`, menus). Pinned by
  `tests/component/display/VideoPlayer.test.ts:124` and `:135` (play/pause and
  mute glyph names after `syncFromState`) — a same-name guard keeps them green
  because they assert the resulting name, not the write.
- **Proof at implement time**: a probe asserting ≤ 2 sink ops and **0** rule ops
  and **0** `scheduleLayout` roots for a `syncFromState` whose rendered state is
  unchanged; and 0 rule ops over 240 simulated `timeupdate`s at a fixed second.

---

### F26.4 The chart hover path takes a forced read, rebuilds the curve per series, and re-shows the tooltip on every `mousemove`

- **Category**: A (forced sync read per pointer event), G (per-event allocation),
  C (rule writes via `Tooltip`), B (unchanged-value re-show)
- **Impact**: **HIGH** — per raw `mousemove` on hot path 3, uncoalesced.
- **Where**:
  - `component/chart/AbstractChart.ts:853-870` (`handlePointerMove` — no
    same-hit guard; `Tooltip.show` / `Tooltip.hide` on every sample)
  - `component/chart/AbstractChart.ts:950-958` (`clientToSurface` —
    `DOM.source.getElementRect(this._svg)` per call)
  - `component/chart/LineChart.ts:315-364` (`resolveHit` — `clientToSurface`,
    then `curveYAt` per visible series)
  - `component/chart/LineChart.ts:382-417` (`curveYAt` — `new CurveTape()` + a
    fresh d3 `line()` generator + a full re-run of the curve + a 24-step binary
    search, **per series per event**)
  - `component/chart/AbstractChart.ts:189-191` (three subtree listeners:
    `mousemove`, `mouseout`, `click`, installed in the constructor for the
    component's life)
- **Hot path**:
  - raw `mousemove` → `Event`'s window-level handler → ancestor walk (slice 03)
  - → `AbstractChart.handlePointerMove:853`
  - → `LineChart.resolveHit:315` → `clientToSurface:950` →
    `getElementRect` **(forced document layout)**
  - → `curveYAt:382` × visible-series-count (tape + generator + N segments each)
  - → `Tooltip.show(text, x, y)` or `Tooltip.hide()` — unconditionally
- **Evidence** (probes `chart-hover.probe.test.ts`, `chart-hover2.probe.test.ts`):
  - 10 `mousemove`s → **10 `DOM.source.getElementRect` reads** (1 per sample, no
    rAF coalescing, no cache of the surface rect across a settled frame).
  - `curveYAt` is called **once per visible series per sample** (3 for a 3-series
    chart); each call allocates a `CurveTape`, a d3 `line()` generator and 49
    `CurveSegment` arrays for a 50-point series, then discards all of it.
  - 10 `mousemove`s that all resolve to the **same datum**: `{createElement: 2,
    setId: 2, apply: 60, ensureStyleRule: 3, setRuleStyles: 3, appendChild: 11,
    addListener: 1, requestAnimationFrame: 1}` = **83 sink ops, 3 stylesheet-rule
    mutations, 20 `DOM.source.measureText` calls** (2 per `Tooltip.show`,
    one line at a time — slice 11's finding, reached from here).
  - 10 `mousemove`s over blank space → **10 `Tooltip.hide()` calls** (slice 11:
    `Tooltip.hide()` never early-returns, so each plays a full fade on a detached
    element and leaks 2 native listeners).
- **Proposed change**:
  1. Cache the SVG surface rect: it is already known in layout space — the chart
     writes it in `sizeSurface` — so `clientToSurface` can read the cached
     perimeter origin plus one rect taken at most once per frame (or on
     scroll/resize), not once per pointer sample. This is the same
     "uncoalesced `getViewportRect` per raw pointer sample" shape slice 15 found
     in `Slider` and slice 09 found in `AbstractWindow`'s move path.
  2. Guard the tooltip: remember the last resolved `{series, index}` and the last
     shown text; call `Tooltip.show` only when the text changes, and
     `Tooltip.hide` only when a tooltip is actually showing.
  3. Build the `CurveTape` once per repaint (the curve only changes when the
     scales or the data change) and store it per series, instead of rebuilding it
     per pointer sample.
  4. Coalesce `handlePointerMove` to one rAF, as `dragmanager-pointer-coalescing`
     already does for drags.
- **Risk / blast radius**: `resolveHit` is `protected` and overridden by
  `LineChart`; `BarChart` uses the base `hitMark` path (no curve work, but the
  same `Tooltip` and no rect read). No test pins per-event counts;
  `tests/component/chart/Chart.test.ts:202-254` pins `hitMark`'s *results* only.
- **Proof at implement time**: a probe asserting ≤ 1 `getElementRect` and ≤ 1
  `Tooltip.show` across 10 `mousemove`s that resolve to the same datum, and 0
  `Tooltip.hide` calls when no tooltip is showing.

---

### F26.5 The legend subtree is laid out twice per chart pass, with stale geometry the first time

- **Category**: D (avoidable layout pass), I (two places doing one job)
- **Impact**: **MEDIUM** — per frame on hot path 1, one legend subtree
  (3 components per series) per chart.
- **Where**:
  - `component/chart/AbstractChart.ts:575` (`super.doLayout()` — runs the chart's
    default `Absolute` manager over its laid-out children, which includes
    `_legend`)
  - `component/chart/AbstractChart.ts:671-677` (`placeLegend` — `setX`, `setY`,
    `setWidth`, `setHeight`, then a direct `this._legend.doLayout()`)
  - `core/Component.ts:7107-7125` (`getLayoutManager` — lazily installs
    `new Absolute()` when no manager was set; `AbstractChart` never sets one)
- **Hot path**: resize frame → `AbstractChart.doLayout:574` →
  `super.doLayout()` → `Absolute` manager → `commitBounds` →
  `_legend.doLayout()` **(pass 1, with last frame's rectangle)** →
  `reserveLegend:625` → `placeLegend:671` → 4 geometry setters →
  `_legend.doLayout()` **(pass 2, with this frame's rectangle)**.
- **Evidence** (probe `chart-detail.probe.test.ts`): `legend.doLayout` is called
  **2×** per chart `doLayout`; `legend.setEntries` 1×; `legend.setVisible` 1×;
  `getPerimeterSize` 3× per pass (`doLayout:583`, `sizeSurface:607`, and once
  inside the legend placement chain), each allocating a fresh object.
  The ordering is the bug: `super.doLayout()` runs *before* the legend's new
  rectangle is computed, so pass 1 is always against stale geometry.
- **Proposed change**: `reserveLegend`/`placeLegend` already own the legend's
  rectangle completely, so the manager pass is pure waste. Either (a) move
  `super.doLayout()` to the end of `AbstractChart.doLayout`, after `placeLegend`
  has written the final rectangle, and drop the explicit `_legend.doLayout()`; or
  (b) keep the explicit placement and keep the legend out of the manager's
  laid-out set. (a) is smaller and keeps one owner of the child's layout.
  Separately, hoist `getPerimeterSize()` to one call per pass and pass it down.
- **Risk / blast radius**: `AbstractChart` only. Pinned indirectly by
  `tests/component/chart/Chart.test.ts:384-407` (steady-state layout stability) —
  which must stay green.
- **Proof at implement time**: a probe asserting exactly 1 `legend.doLayout` and
  1 `getPerimeterSize` per chart pass.

---

### F26.6 A chart nobody can see repaints in full on a data refresh or a theme change

- **Category**: E (work for invisible content)
- **Impact**: **MEDIUM** — per store event / per theme toggle, per hidden chart.
- **Where**:
  - `component/chart/AbstractChart.ts:316-324` (`rebuildFromStore` →
    `scheduleLayout()` unconditionally)
  - `component/chart/AbstractChart.ts:194` (`ThemeManager.onThemeChange(() =>
    this.scheduleLayout())` — installed for the chart's life, never released
    while hidden)
  - `core/Component.ts:192-240` (`flushPendingLayouts` — no visibility gate; it
    skips only disposed/never-rendered components)
  - `component/chart/AbstractChart.ts:574-598` (`doLayout` — no visibility gate)
- **Hot path**: store `datachange` (or a theme toggle) →
  `AbstractChart._onStoreRefresh` → `rebuildFromStore:316` → `scheduleLayout()`
  → next rAF → `flushPendingLayouts` → `doLayout()` → full `repaint`.
- **Evidence** (probe `chart-hover2.probe.test.ts`): a chart with
  `isDisplayed() === false` and `isEffectivelyVisible() === false`, on a
  `setSeries` + flush, issues the identical **1,081 sink ops / 210 SVG element
  rebuilds**. A forced pass while undisplayed costs the same 1,081 ops. The theme
  subscription is confirmed still installed while hidden.
  This is the `Tab`-inactive-page case: `Tab` undisplays the page
  (`layout/Tab.ts:2112`) so it never lays the chart out itself, but any
  *self*-scheduled layout (store event, theme change, legend toggle) bypasses
  that and repaints anyway.
- **Proposed change**: gate `repaint()` on `isEffectivelyVisible()` and set a
  `_repaintPending` flag when it is skipped; flush it from
  `onEffectiveVisibilityChange(true)` — exactly the shape
  `AbstractCanvasSurface.onEffectiveVisibilityChange:452` and
  `Markdown.onEffectiveVisibilityChange:1463` already use. Note the trap slice 25
  found: do **not** write a measurement-derived cache (the axis-margin memo of
  F26.2) from a pass that runs while undisplayed.
- **Risk / blast radius**: `AbstractChart` and subclasses. No test pins a repaint
  while hidden.
- **Proof at implement time**: a probe asserting 0 sink ops for a `setSeries` +
  flush on an undisplayed chart, and a full repaint on the next
  `onEffectiveVisibilityChange(true)`.

---

### F26.7 A `WebGLCanvas` with no GL context still runs its animation loop forever

- **Category**: E / G (a loop running for content that renders nothing), H
- **Impact**: **MEDIUM** in the target environment specifically — WebKitGTK
  software-rendered under WSLg has no WebGL2, so *every* `WebGLCanvas` on screen
  schedules a rAF callback per browser frame that returns at its first line.
- **Where**:
  - `component/display/WebGLCanvas.ts:250-261` (`render` →
    `onFirstLayout(() => this.startAnimation())`, unconditional)
  - `component/display/WebGLCanvas.ts:268-272` (`renderFrame` — `if (!gl || this._contextLost) return;`)
  - `component/display/AbstractCanvasSurface.ts:386-389` (`shouldAnimate` —
    consults `_animationRequested` and visibility, never `hasRenderingContext()`)
  - `component/display/AbstractCanvasSurface.ts:419-443` (`animationStep` — the
    `maxFps` cap skips the *draw*, not the reschedule)
- **Hot path**: first connected layout → `startAnimation` → `reconcileAnimation`
  → `requestAnimationFrame(animationStep)` → per frame: `getMaxFps()`, a
  timestamp comparison, `drawFrame()` → `renderFrame()` → early return →
  `requestAnimationFrame` again. Forever, while visible.
- **Evidence** (probe `webgl.probe.test.ts`, with the element marked connected):
  `getContext()` returns `null` and `isAnimating()` is **`true`**. `Canvas`
  correctly does not auto-start (`isAnimating()` false after two layouts).
  Secondary note on the same mechanism: with the default `maxFps: 30`, the loop
  still wakes on every browser frame (60/s at 60 Hz, 180/s on a 180 Hz display)
  to decide to skip — the cap thins draws, not wake-ups. That is documented
  behaviour (`AbstractCanvasSurfaceOptions.maxFps` JSDoc at
  `AbstractCanvasSurface.ts:22-32`), so it is a note, not a defect.
- **Proposed change**: add `&& this.hasRenderingContext()` to `shouldAnimate()`
  (with a reconcile from the `webglcontextrestored` handler at
  `WebGLCanvas.ts:101-105`, which already calls `syncBackingStore`), so a surface
  that cannot paint does not schedule frames. Separately consider gating the
  auto-start at `WebGLCanvas.ts:258` on a context being obtainable.
- **Risk / blast radius**: `WebGLCanvas` only. `tests/component/display/WebGLCanvas.test.ts`
  asserts loop start/stop under the modelled sink, where `getContext` is also
  `null` — so those tests would need the context stubbed, or the gate expressed
  as "context unavailable **and** a frame hook is set". Call this out in the plan.
- **Proof at implement time**: a probe asserting `isAnimating() === false` for a
  connected `WebGLCanvas` whose `getContext()` is `null`, and `true` once a
  context is stubbed in.

---

### F26.8 A canvas moved under an already-hidden ancestor keeps animating

- **Category**: E (work for invisible content) — gap in the merged
  `canvas-pause-when-hidden` design
- **Impact**: **LOW** — narrow trigger (reparenting into a hidden subtree), but a
  60 fps loop for content nobody sees when it fires.
- **Where**:
  - `component/display/AbstractCanvasSurface.ts:452-455`
    (`onEffectiveVisibilityChange` is the **only** pause trigger)
  - `core/Component.ts:2429-2438` (`scheduleEffectiveVisibilityReconcile` — armed
    only from `setVisible` / `setDisplayed`)
  - `plans/implemented/canvas-pause-when-hidden.md` — the merged plan's original
    design had `reconcileAnimation()` as the last statement of `doLayout`; the
    shipped code replaced that poll with the edge-triggered hook (see the JSDoc
    at `AbstractCanvasSurface.ts:445-450`), which closes the per-frame ancestor
    walk but opens this hole.
- **Evidence** (probe `canvas.probe.test.ts`): the three cases the task asked me
  to confirm all **pass** —
  - `setVisible(false)` (`visibility:hidden`) → `isAnimating()` false ✔
  - `setDisplayed(false)` (`display:none`) → `isAnimating()` false ✔
  - ancestor `setDisplayed(false)` (the `Tab`/`Card` shape, `layout/Tab.ts:2112`)
    → `isAnimating()` false ✔, and `true` again after the ancestor is shown ✔
  - but: a canvas that started animating and is then **added to** an
    already-hidden parent reports `isEffectivelyVisible() === false` while
    `isAnimating()` stays **`true`** — no `setVisible`/`setDisplayed` call fires
    on the reparent, so no edge event reaches it.
- **Proposed change**: re-check `shouldAnimate()` on reparent. The cheapest hook
  is `Component`'s child-wiring path (`addComponent`/`wireChild`) propagating an
  effective-visibility reconcile to the newly attached subtree — which would also
  fix the same hole for `Markdown` and `CodeEditor`, which use the identical
  deferred-flush pattern. That makes it a `Component`-level change, so it belongs
  with slice 01/02's work, not in a chart/canvas plan.
- **Risk / blast radius**: `core/Component.ts` — shared. Every
  `onEffectiveVisibilityChange` override (Glyph, Markdown, CodeEditor, Panel,
  AbstractCanvasSurface) would start receiving an extra edge event on reparent;
  each is idempotent today, but that must be re-checked.
- **Proof at implement time**: a probe asserting `isAnimating() === false` after
  `hiddenParent.addComponent(runningCanvas)`.

---

### F26.9 `setControlsVisible(false)` and a hidden legend stay in the render tree

- **Category**: E (hidden content still charged on every ancestor resize)
- **Impact**: **LOW–MEDIUM** — the exact shape slice 07 found in
  `Tab.setBarVisible`; ~9 elements for the control bar, 3 per series for the legend.
- **Where**:
  - `component/display/VideoPlayer.ts:436-441` (`setControlsVisible` →
    `this._controls.setVisible(value)`)
  - `component/chart/AbstractChart.ts:629` (`this._legend.setVisible(false)` when
    the legend is off or there are no series)
- **Hot path**: any ancestor resize → the browser re-lays out the
  `visibility:hidden` subtree anyway (briefing: ~9 ms/frame per hidden CodeMirror
  editor; a control bar with two `Slider`s and three `Button`s is smaller but not
  free).
- **Evidence**: read from source; `setVisible` routes through the shared
  `.invisible` class (`core/Component.ts:2245`) which sets `visibility`, not
  `display`. `core/Component.ts`'s `getLaidOutComponents()` filters on
  `isDisplayed()`, not `isVisible()`, so a `setVisible(false)` child is **also
  still laid out by its manager every pass**. Not separately quantified —
  the control bar is tiny; the legend of a many-series chart is not.
  `tests/component/display/VideoPlayer.test.ts:68` pins `isVisible() === false`,
  so switching to `setDisplayed` needs that assertion updated.
- **Proposed change**: use `setDisplayed(false)` in both places, matching the
  merged `undisplay-inactive-tab-pages` / `collapsed-panes-leave-render-tree`
  precedent. For the chart legend the rectangle is owned by `reserveLegend`, so
  nothing reflows.
- **Risk / blast radius**: `VideoPlayer.isControlsVisible` reads `_options.controls`
  and is unaffected; the test above asserts the child's `isVisible()` and must
  change to `isDisplayed()`.
- **Proof at implement time**: a probe asserting the hidden control bar / legend
  reports `isDisplayed() === false`, and that its children get 0 `doLayout` calls
  on an ancestor resize pass.

---

### F26.10 `LineChart` writes hit-test attributes it never reads, and its hover contract does not match its documentation

- **Category**: H (function/implementation mismatch), J (unreachable branch),
  and a small per-frame write share
- **Impact**: **LOW** (correctness/clarity; a small share of F26.1's writes)
- **Where**:
  - `component/chart/LineChart.ts:252` (`"data-series"` on the path),
    `:274` (`"data-series"` + `"data-index"` on every point marker)
  - `component/chart/LineChart.ts:315-364` (`resolveHit` — purely geometric, never
    reads a dataset)
  - `component/chart/AbstractChart.ts:973-1005` (`hitMark` — the dataset reader;
    unreachable from `LineChart`)
  - `component/chart/AbstractChart.ts:865-867`, `:903` (the `hit.index === null`
    "whole-series" branches)
  - `packages/lib/docs/components/LineChart.md:64`, `:68` ("hovering the line
    itself (no marker) shows a series-level tooltip"; "with `showPoints: false` a
    series stays hoverable at the series level")
- **Evidence**: `LineChart.resolveHit:363` always returns
  `index: this.nearestPointIndex(...)` — it can never return `index: null`. So
  the documented series-level tooltip never appears for a `LineChart`, and the
  `data-series`/`data-index` attributes written on 153 marks per repaint
  (3 paths + 150 circles in the probe fixture) are never read by anything.
  `BarChart` uses the base `hitMark`, but its marks always carry `data-index`
  (`BarChart.ts:133`), so `hitMark`'s `index: null` branch — and both
  null-index branches above it — are unreachable across the shipped library.
- **Proposed change**: pick one contract. Either drop the geometric override's
  point snapping when the cursor is not near a marker (restoring the documented
  series-level hover, and keeping the attributes meaningful), or drop the
  `data-*` attributes from `LineChart`'s marks and the `index: null` branches,
  and correct the doc page. The second is smaller and matches what ships.
- **Risk / blast radius**: `tests/component/chart/Chart.test.ts:222` ("resolves a
  series-only mark (a line path) to a whole-series hit") pins `hitMark`'s
  `index: null` behaviour through a white-box subclass — it would survive dropping
  the attributes but documents a path no shipped chart uses.
- **Proof at implement time**: a doc/behaviour test, plus the mark-attribute count
  in F26.1's probe.

---

### F26.11 `VideoPlayer.getInnerSize()` forces a viewport read per layout pass while fullscreen

- **Category**: A (forced sync read)
- **Impact**: **LOW** — fullscreen only, 1 read per pass.
- **Where**: `component/display/VideoPlayer.ts:766-778`
  (`DOM.source.getViewportSize()`); `core/DOM.ts` `getViewportSize` is slice 03's
  "forces a document layout for a value that `Math.max` then discards".
- **Evidence** (probe): 1 `getViewportSize` call per `doLayout` while
  `_fullscreen` is true. `getInnerSize()` is also consulted by size reports, so
  the count is a floor, not a ceiling.
- **Proposed change**: cache the viewport extent on `fullscreenchange` (the
  handler at `VideoPlayer.ts:544` already runs then) and on the window `resize`
  event, rather than reading it per layout pass. This rides along with slice 03's
  `getViewportSize` fix and is too small to plan on its own.
- **Risk / blast radius**: `VideoPlayer` only;
  `tests/component/display/VideoPlayer.test.ts:240` pins the fullscreen inner
  size and would stay green against a cache seeded on the same event.
- **Proof at implement time**: a probe asserting 0 `getViewportSize` calls across
  10 fullscreen layout passes after the first.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `AbstractChart` | SVG-first base for the chart family: sizes the surface, reserves the legend, computes the plot, repaints | 1 `<svg>` + 3 `<g>` groups (tracked); every mark (untracked, released per repaint) | **1,081 sink ops / 210 element rebuilds** (3×50 line chart); **12 forced `measureText`**; 0 rule writes; 0 empty applies; 3 `getPerimeterSize` allocations; legend laid out 2× | mismatch (repaints unconditionally; measures per pass) | F26.1, F26.2, F26.5, F26.6, F26.10 |
| `LineChart` | One path per series over a linear/time x axis, optional markers | none of its own; draws through `seriesMark` | 3 paths + 150 circles per repaint; per `mousemove`: 1 `getElementRect` + 1 `CurveTape`+generator per visible series | over-built (hover), mismatch (doc vs `resolveHit`) | F26.1, F26.4, F26.10 |
| `BarChart` | Grouped/stacked bars over a band x axis | none of its own | 1 `<rect>` per (visible series × point) per repaint; `pointPixel` recomputes **all** bars to find one (`BarChart.ts:229`) | fits, with one wasteful lookup | F26.1 |
| `ChartAxis` (`drawAxis`, `measureAxisMargin`) | Draw one axis natively; measure the margin it needs | none (creates through the caller's `MarkFactory`) | 3 marks per left tick, 2 per bottom tick; **12 `DOM.source.measureText`** per pass, un-batched, un-memoised | mismatch (a pure measurement that forces 12 document layouts per frame) | F26.2, F26.1 |
| `ChartLegend` | Clickable one-row-per-series legend | its own `Panel` + 3 components per row | **0 element creations on an unchanged pass** (idempotency guard holds); laid out twice per chart pass; entries array re-allocated per pass | fits (guard intact) | F26.5 |
| `Scale.ts` | Thin adapter over d3 scales/ticks/formats | none | pure; `buildScales` runs **2×** per pass, `tickFormatter` **4×** | fits | F26.2 |
| `types.ts` | `ChartPoint` / `ChartSeries` / `ChartSeriesModel` / `PlotRect` / `MarkFactory` / `ChartSelectionEvent` | none | none | fits, but `PlotRect` and `MarkFactory` are unreachable from the package entry point | see *Redundant…* |
| `chart/index.ts` | Chart barrel | none | none | mismatch (omits `ChartScale`, `PlotRect`, `MarkFactory` needed to subclass the exported `AbstractChart`) | see *Redundant…* |
| `AbstractCanvasSurface` | Shared animation loop, frame clock, backing-store sync, visibility reconcile, process-wide DPR watch | the `<canvas>` element's `width`/`height` attributes | **0 sink ops** over 10 unchanged passes; 1 `getDevicePixelRatio` per pass (not a forced layout); 2 applies per genuine resize frame + a full `drawFrame()` | fits — this is the good one | F26.7, F26.8 |
| `Canvas` | 2D raster surface; consumer draws via `onDraw` | none beyond the base | per resize frame: backing-store wipe + full `redraw()` (inherent) | fits | — |
| `WebGLCanvas` | GPU surface; `onContextInit` + `onFrame` hooks; loop auto-starts | none beyond the base; 2 context-loss listeners | as base; loop runs even with `getContext() === null` | over-built (auto-start ignores context availability) | F26.7 |
| `Video` | Native `<video>` primitive; typed media setters; media-event bridge | `<video>` element, 8 native listeners | none in layout | fits | `getPreload` dead (below) |
| `VideoPlayer` | `Border` of a `Video` + a composed control bar | root element + `fullscreenchange` listener | settled pass: 50 sink ops incl. **1 `setRuleStyles`** (the `Border` `clip-path`, slice 06); **per `timeupdate`: 73 ops, 6 rule ops, 6 layout roots** | mismatch (per-event cost is all unchanged-value writes) | F26.3, F26.9, F26.11 |
| `PlaybackEngine` / `ProgressiveEngine` | Pluggable media-loading strategy | none | none | over-built (one implementation, zero consumers) | below |

---

## Redundant, duplicated and dead code

Greps run from `packages/`, excluding `node_modules`, `docs/dist`, `lib/dist`.

1. **The 2026-08-29 audit's Priority 2 #3 (`Canvas`/`WebGLCanvas` ~250-line
   lockstep copy) is CLOSED.** `AbstractCanvasSurface.ts` now owns the animation
   loop, frame clock, `maxFps`, `animateWhenHidden`, backing-store sync, DPR
   watch, visibility reconcile and destructor. What is **still** duplicated is
   ~20 lines: `getContext()` (`Canvas.ts:102-115` vs `WebGLCanvas.ts:158-171` —
   identical apart from the context-id string and the cast), `hasRenderingContext()`
   (`Canvas.ts:166-168` vs `WebGLCanvas.ts:222-224` — byte-identical),
   `drawFrame()` one-line delegates, and `this.clearInsets()` in both
   constructors. A `protected abstract contextId(): string` plus a cached
   `_context` field on the base would remove the rest. Low priority; report it,
   do not plan it on its own.
2. **Audit Priority 2 #8 (`AxisOrientation` name collision) is CLOSED.**
   `component/chart/ChartAxis.ts:13` now declares
   `type ChartAxisEdge = Extract<Edge, "bottom" | "left">`, derived from
   `primitive/Edge`, and is not exported.
3. **Audit Priority 3 `chart/types.ts:44-56 ChartStoreBinding` is CLOSED** — the
   type no longer exists (`grep -rn ChartStoreBinding packages/` → 0 hits).
4. **Audit Priority 2 #9 (`visiblePoints()` duplicated between
   `LineChart`/`BarChart`) is CLOSED** — it lives once at
   `AbstractChart.ts:138-140`.
5. **Audit's llms.txt gap is CLOSED** — `packages/lib/llms.txt:79-81, 99-102`
   now list `LineChart`, `BarChart`, `ChartLegend`, `Canvas`, `WebGLCanvas`,
   `Video`, `VideoPlayer`.
6. **`AxisRenderOptions` is exported but unreachable.**
   `component/chart/ChartAxis.ts:41-48` is `export interface`, but
   `component/chart/index.ts` never re-exports `ChartAxis.js` — the only chart
   entry point. `grep -rn "AxisRenderOptions" packages/ --include=*.ts` → 2 hits
   (declaration + its use as a parameter type in the same file). The audit's
   Priority 3 entry for it is **still open**. Same for `DEFAULT_TICK_COUNT`,
   `drawAxis`, `measureAxisMargin`.
7. **`ChartScale`, `PlotRect` and `MarkFactory` are not exported from
   `component/chart/index.ts`**, yet all three appear in the signatures of
   `AbstractChart`'s `protected abstract` members
   (`buildScales`, `drawSeries`, `pointPixel`, `seriesMark`), and `AbstractChart`
   **is** publicly exported (`index.ts:498`). A consumer cannot type an override
   without reaching into a deep path. Either export the three types or stop
   exporting `AbstractChart`.
8. **`Video.getPreload()` has zero callers.**
   `grep -rn "\bgetPreload\b" packages/ --include=*.ts` (excluding dist) → **1**
   hit: the declaration at `component/display/Video.ts:281-283`. Its `setPreload`
   sibling has 2 (declaration + the options dispatch).
9. **Every chart runtime setter has exactly one caller — its own options
   dispatcher.** `setXScaleType`, `setCurved`, `setShowPoints`, `setGrouped`,
   `setLegendPosition`, `setXAxisLabel`, `setYAxisLabel` each grep to **2** hits
   (declaration + the `dispatchXxxOptions` line); `setSeries`/`setShowLegend`
   likewise have no external caller in `packages/`. None of them has an
   unchanged-value guard, and each ends in an unconditional `scheduleLayout()`.
   They are harmless today only because nothing calls them at runtime — but they
   are the "configurability nobody uses" shape, and if any of them is ever wired
   to a control it becomes a per-event full repaint. Add the guards when F26.1's
   repaint gate lands (the gate makes the guard cheap: a no-op setter then
   schedules a pass that repaints nothing).
10. **`PlaybackEngine` has one implementation and zero consumers.**
    `grep -rn "\bPlaybackEngine\b" packages/ --include=*.ts` (excluding dist) →
    4 hits: the interface, `VideoPlayer`'s field + option, and one test.
    `ProgressiveEngine` is the only implementor, and nothing in
    `packages/` ever passes `engine:`. The seam is deliberate and documented
    (`PlaybackEngine.ts:8-16`: a prerequisite for adaptive streaming) — record it
    as speculative generality, do not remove it without asking.
11. **`maxFps` and `animateWhenHidden` have zero production callers.**
    Both grep only to their own declarations, generated `docs/dist` API pages,
    and `packages/lib/tests/`. No docs-app demo and no `MiscPanel` demo exercises
    either. They are consumer-facing options with documented behaviour; noted for
    completeness, not proposed for removal.
12. **`ChartLegend._rows` (`ChartLegend.ts:78`) shadows `getComponents()`.** The
    rows are added via `addComponent`, so the array is a second copy of the child
    list maintained in lockstep by `setEntries:180-188` and read only by
    `handleRowClick:272`. `getComponents()` would serve.
13. **The `index: null` ("whole-series") hit path is unreachable** across the
    shipped charts — see F26.10 for the three sites.

---

## Cross-slice notes

- **→ 13 button-glyph-image (confirmed, quantified).** `VideoPlayer.syncFromState:590-591`
  is exactly as slice 13 described. Numbers from my probe: 36 sink ops per
  `setGlyph` call (72 for the pair), 3 stylesheet-rule ops per call, and — new —
  **3 `scheduleLayout()` roots per call**. All six layout roots and all six rule
  ops per `timeupdate` are attributable to those two lines and nothing else.
  Guarding `Button.setGlyph` on an unchanged name removes 72 of 73 sink ops and
  100% of the rule and layout cost of a `timeupdate`.
- **→ 11 overlay-popups (confirmed on a new caller).** The chart hover path is a
  second high-frequency `Tooltip` caller alongside `Button`: `Tooltip.show` is
  called per `mousemove` with no same-text guard (10 identical-datum moves → 10
  shows → 20 one-at-a-time `measureText`), and `Tooltip.hide()` is called on
  every blank-space `mousemove` with no "is anything showing" guard (10 moves →
  10 hides). Slice 11's fixes should be measured against a chart hover, not only
  a button hover.
- **→ 03 core-dom-seam-events.** `AbstractChart` registers **three** subtree
  listeners in its constructor (`mousemove`, `mouseout`, `click`,
  `AbstractChart.ts:189-191`) and `ChartLegend` registers a fourth
  (`ChartLegend.ts:102`, `click`), all for the component's lifetime. Adding to
  slice 08's registrant list: any fix for `Event`'s per-`mousemove` ancestor walk
  must cover `SplitGutter`, `Accordion` (2 per section), **`AbstractChart`** and
  **`ChartLegend`**. Note that a chart is the *only* component in my slice that
  registers a subtree `mousemove`, so one visible chart is enough to install the
  window-level `mousemove` base listener for the whole app.
- **→ 14 text-and-small-display (confirmed).** `Text.setText` has no same-value
  guard on this path either: 10 byte-identical `setText` calls on
  `VideoPlayer._timeText` → 10 applies. Three of every four `timeupdate`s carry
  an identical string.
- **→ 06 layout-split-border-dockregion (confirmed).** A settled `VideoPlayer`
  layout pass issues **1 `setRuleStyles`** — the `Border` manager's per-region
  `clip-path`. So the 14-rule-mutations-per-drag-frame figure slice 06 reported
  is charged again per `VideoPlayer` on screen.
- **→ 01/05 (confirmed).** No entity in my slice overrides
  `canSkipUnchangedLayout`, and `AbstractChart`'s legend placement goes through
  the default `Absolute` manager's unconditional `commitBounds` →
  `child.doLayout()`. `AbstractChart` is a plausible `canSkipUnchangedLayout`
  opt-in candidate *once* F26.1's repaint gate exists — before that, skipping the
  pass and skipping the repaint are the same thing and the gate is the better fix.
- **→ 04 core-panel-scrolling (refuted for this slice).** `AbstractChart` extends
  `Panel`, but slice 04's "a settled Panel handed its own unchanged rectangle
  still runs the full live remeasure" does **not** bite here: probe shows **0
  `DOM.source.getScrollMetrics` calls** per chart pass, because
  `Panel.remeasureScrollMetrics` (`core/Panel.ts:1086-1090`) short-circuits on
  `_autoScroll === "none"`, which is the chart's default. The chart's `Panel`
  base does still call `commitElementStyle()` per pass.
- **Seam gap worth naming.** `AbstractChart` writes SVG marks through
  `DOM.sink.createElementNS` + `apply` + `appendChild` and has no way to express
  "update this existing node's attributes as part of the same batched patch"
  other than another `apply`. That is sufficient for F26.1's in-place-update fix,
  but it is the same missing "update" counterpart slice 24 flagged for
  `createViewElement`. Worth one shared answer.

---

## Suggested plan grouping

**Plan A — "Chart repaint gate and axis-margin memo" (the big one).**
F26.1 lever 1 (repaint signature gate) + F26.2 (batch `measureTextWidths`, memo
the margin keyed on domain/tickCount/theme) + F26.5 (single legend layout,
one `getPerimeterSize` per pass) + F26.6 (skip the repaint while not effectively
visible, flush on `onEffectiveVisibilityChange(true)`). These four share one
file and one measurement: sink ops and forced reads per settled pass. Target: a
settled or over-travel pass goes from **1,081 sink ops + 12 forced layouts** to
**≈0 + 0**. No dependency on another slice. F26.6 must land *with* F26.2's memo,
not after it, or the memo can be poisoned by a pass that runs while undisplayed
(slice 25's trap).

**Plan B — "Chart hover coalescing" (F26.4).** Cache the surface rect, guard the
tooltip on the resolved datum, hoist the `CurveTape` to repaint time, coalesce
`mousemove` to one rAF. Depends on Plan A only for the tape hoist (the tape's
lifetime is tied to the repaint signature). Should be measured jointly with slice
11's `Tooltip.attach`/`hide` fixes — if those land first, Plan B's numbers
change, so sequence 11-then-B or measure both.

**Plan C — "`Button.setGlyph` unchanged-name guard" (F26.3).** This is slice 13's
plan, not mine; my contribution is the `VideoPlayer` scenario and its numbers
(73 → 1 sink ops, 6 → 0 rule ops, 6 → 0 layout roots per `timeupdate`). Add the
`Text.setText` same-value guard (slice 14) to the same measurement. Nothing in
this slice should re-implement a local workaround — the briefing's rule against
papering over a shared gap applies.

**Plan D — "Canvas loop correctness" (F26.7 + F26.8).** Gate `shouldAnimate()` on
`hasRenderingContext()`, and reconcile on reparent. F26.8's mechanism lives in
`core/Component.ts` and also fixes `Markdown` and `CodeEditor`, so it belongs to
slice 01/02's plan with a cross-reference from here; F26.7 is `WebGLCanvas`-local
and can ship alone.

**Rides along with a neighbour (too small to plan):**
- F26.9 (`setVisible` → `setDisplayed` for the control bar and the hidden legend)
  — attach to whichever of Plan A / Plan C touches those files, or to the
  library-wide `setVisible`-vs-`setDisplayed` sweep slice 07 proposes.
- F26.11 (`getViewportSize` per fullscreen pass) — rides with slice 03's
  `getViewportSize` fix.
- F26.10 and items 6, 7, 8, 12, 13 of *Redundant…* — one code-health commit,
  no measurement.
- `Canvas`/`WebGLCanvas` residual `getContext` duplication (item 1) — ride along
  with Plan D.

**Probes** are in `.worktrees/_probes/26-charts-canvas-video/`
(`chart-pass`, `chart-hover`, `chart-hover2`, `chart-detail`, `videoplayer`,
`videoplayer2`, `canvas`, `webgl`), runnable with
`PROBE_DIR=.worktrees/_probes/26-charts-canvas-video npx vitest run --config .worktrees/_probes/vitest.probe.config.ts --disable-console-intercept`.
