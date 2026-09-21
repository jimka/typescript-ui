# Render-work review 2026-09-15 — synthesis

## What this is

A whole-library render-work review of `@jimka/typescript-ui`, run on 2026-09-15
as 28 fresh-context slices, one reviewer per slice. Each reviewer read its
source in full, traced seven named hot paths, and backed claims with probes run
against the library's own vitest setup and modelled DOM. The 28 reports sit
beside this file as `01-*.md` … `28-*.md`; the brief is `00-briefing.md`. No
code was changed.

The cost model is Tauri on Linux — WebKitGTK, software-rendered, under WSLg —
driving the Loom editor. Four measured facts govern every ranking below.
A geometry or style read after a DOM write in the same task flushes style and
layout for the whole document; one such read per visible tab strip per frame
cost ~110 ms/frame in a 2×2 editor grid. Any stylesheet-rule mutation forces a
full-document restyle, ~195 ms/frame at 21k nodes, even for a same-valued write.
A subtree hidden with `visibility: hidden` stays in the render tree and is
charged on every ancestor resize (~9 ms/frame per hidden CodeMirror editor);
`display: none` removes it. Inline-style writes and class toggles are cheap when
no read follows them.

Loom baselines to measure against: idle floor ~17 ms/frame; empty-project gutter
drag ~52; 2×2 editor-grid horizontal drag ~107 after the merged September fixes;
each visible CodeMirror ~15–20 ms/frame of its own re-measure. The 60 Hz budget
is 16.7 ms.

Paths are relative to `packages/lib/src/typescript/lib/` unless stated.

---

## The cross-cutting defects

Ten defects in `Component`, `StyleTarget`, `LayoutManager`, `DOM` and `Event`
account for most of the per-frame cost measured in a dozen unrelated components.
Every slice that found a "this component is wasteful per frame" number was, in
most cases, measuring one of these. They are ranked by total user-visible cost.

### X1 — `StyleTarget` never compares a write against the value already there, and fans a multi-property write out one property at a time

**Root cause.** `StyleTarget.set` (`core/StyleTarget.ts:35-41`) writes straight
through to the live target once materialised, with no comparison. `setMany`
(`:48-50`) loops `set`, so an attached target issues one `DOM.sink.apply` or one
`DOM.sink.setRuleStyles` **per property**. Neither `StyleRule.writeStyle`
(`:399-401`) nor `ProductionDOMSink.setRuleStyles` (`core/DOM.ts:1667-1694`)
compares either. Filtering lives entirely in `Component`'s typed setters, and
half of those have no guard (X2).

**Why it is the top item.** A stylesheet-rule mutation is the most expensive
write the target engine has. Every same-valued rule write on a per-frame path is
a full-document restyle bought for nothing.

**Confirming slices and numbers.**

| Slice | Instance | Cost |
|---|---|---|
| 06 | `Split.commitPanes:2145` + `Border.ts:1272/1320/1377/1419` re-assert `clip-path` per pane/region per pass | 18 rule declarations per unchanged Loom-shaped whole-tree pass; 14 per gutter-drag frame — all same-valued |
| 08 | `Accordion.doLayout:1556` → `applyContainerTheming` → unguarded `Component.setBorder` | 4 rule declarations per pass; **all 4** of a Loom sidebar gutter-drag frame's |
| 06 | `CollapseButton.applyRotation:219` + `setStripMode:242` | 3 rule declarations per gutter per pass |
| 09 | `Component.setClipFrame`'s `setMany` on a `Window` | 16 applies per settled pass for 4 clip frames' 4 values each |
| 02 | `flushStateStyleBag` / `flushStyleBag` isolation branch | a two-property state write is two full-document restyles (probe P7) |
| 13 | 12 `setPressedX`/`setHoverX` setters, `Glyph.setFontSize`/`setLineHeight`/`setTextAlign` | 3 `setRuleStyles` for three unchanged-value calls |
| 20 | `FilterCell.setOperators` + `setFilterState` both call `applyOperatorFace` | 48 stylesheet ops per filter commit at 8 columns, 120 at 20 |
| 17 | `PickerDay.setSelected`/`PickerCell.setSelected` write `backgroundColor` then `fontWeight` | 2–4 rule mutations per arrow keypress; 6 to type a 10-character date |
| 14 | `Header` drives one west label through `Border` | 1 `clipPath` rule write per `Header`/`WindowHeader` per pass |
| 15 | `FieldDecorator.clearError` with no error showing | 10 calls → 10 `setRuleStyles`; Loom wires it to `on("change")`, so one restyle per keystroke |
| 16 | `FileDropZone.setActive` | 2 rule mutations per drag boundary crossing |
| 28 | `FieldSet.clampLegendWidth` from inside `doLayout` | 2 rule declarations per frame per titled `FieldSet` |

**Fix.** Give `StyleTarget` a `_written` map so `set`/`queue`/`flushDirty` drop a
key whose value equals the last one written, cleared on `attach`/`materialize`/
`dispose`; make `setMany` queue-then-flush so one call is one patch. One change
covers every rule and inline write in the library.

**Unblocks.** It removes the per-frame restyle from `Split`, `Border`,
`Accordion`, `Header`, the picker cells and the filter row without touching any
of them. It is also the precondition for measuring anything else on a drag
frame: until it lands, the restyle dominates and every other number is noise.

`Component.pinStateStyle` (`core/Component.ts:5820`) must keep bypassing the
memo — never deduplicating is its whole purpose — and `applyStyle`'s
`removeAttr: ["style"]` wipe (`:6400`) must clear it.

### X2 — `Component`'s typed setters are half guarded, half not

**Root cause.** 15 of `Component`'s 30 typed style setters compare before
writing and 15 do not (slice 02 F02.6 lists both halves). Unguarded:
`setBackgroundImage:2758`, `setClipPath:2798`, `setColorScheme:2861`,
`setBorder:2926`, `setOutline:3156`, `setAppearance:3190`, `setBorderImage:3233`,
`setTransform:3276`, `setTransformOrigin:3314`, `setPointerEvents:5224`,
`setWritingMode:5268`, `setOpacity:5310`, `setWhiteSpace:5389`,
`setAnimationPlayState:5079`, `setInsets:2531`. Add `setSize:3918` (no
unchanged-value guard, unlike its four per-axis siblings), `Button.setText:1167`,
`Button.setGlyph:1789`, `Button.setTextAlign:1244`, `Text.setText:828`,
`Aria.setRole`/`setTabIndex` (`core/Aria.ts:105`, `:140`), and
`ElementAttributes.set`/`remove` (`core/ElementAttributes.ts:30`, `:47`).

X1's seam memo suppresses the *write*. It does not suppress the setter's **side
effects**, and those are what several slices measured:

- `setBorder` nulls `_borderWidths` even on an identical spec, forcing a
  `getComputedStyle` re-measure on the next `getBorderSize()` (02, 08).
- `setInsets` writes `data-insets` through `ElementAttributes`, which has no
  value filter — N+6 attribute writes per `Tab` pass (07, 13, 04).
- `Button.setTextAlign` calls `scheduleLayout()` unconditionally; `TabBar` calls
  it once per tab per pass, producing 4N extra component `doLayout`s on the next
  frame (07 probe B2, 13 F13.3).
- `Component.setSize` writes geometry *and* schedules a layout on a no-op. Any
  `doLayout` that calls `this.setSize` is a perpetual layout + rAF loop —
  `ProgressSpinner`'s overlay mode is one, measured at 6 consecutive rAF
  generations with nothing changing (01 F01.5, 14 F14.2).
- `Text.setText` marks the measurement stale and schedules a parent layout for a
  byte-identical string (X5).

**Fix.** Add the same-value early return to each, comparing resolved values
(`setBorder` must compare the four resolved side strings, `setInsets` the four
numbers). Pair `setSize`'s guard with the `ProgressSpinner` fix — see the
ordering constraint in section 8.

### X3 — the unchanged-geometry skip is inert everywhere except the table

**Root cause.** `LayoutManager.commitBounds` ends with an unconditional
`component.doLayout()` (`layout/LayoutManager.ts:568`). `Component.applyBounds`
(`core/Component.ts:3977-3989`) does diff, and recurses only when
`changed || !canSkipUnchangedLayout() || isLayoutDirty() || !getElement()`
(`:3982`) — but `canSkipUnchangedLayout()` defaults to `false` (`:4000`) and
exactly one class overrides it (`component/table/cell/Cell.ts:256`). So every
resize frame re-runs a full `doLayout()` for the whole tree, including the half
whose rectangle is byte-identical.

`docs/concepts/layout-system.md:29` describes the diffed behaviour as the
general rule. It is table-only.

**Confirming slices.** 01 and 05 independently; then 04 (`Panel`), 06
(`Split`/`Border`), 07 (`Tab`), 08 (`Accordion` bypasses `commitBounds`
entirely), 10 (`Dock`), 11 (`Popover`/`Tooltip`/`Notification`), 12, 14, 15
(`Slider`), 18 (`SelectableListRow`, `Tree`), 23 (`CodeEditorSearchPanel`), 25
(`Markdown`), 26 (`AbstractChart`).

**Corrections that narrow the claim.** `layout/Table` *is* a built-in manager
that calls `applyBounds` (`layout/Table.ts:389`, `:405`) — slice 08. So do
`TableHeader.positionColumnCells`/`positionParentCells`/`positionFilterCells`
(`component/table/Header.ts:1622/1640/1659`) — slice 20. There are **7**
`applyBounds` sites, not eight, and `layout/Table.ts:389` hands a `Button`,
which does not override the gate and so gets no skip (slice 19).

**Where it works, and why.** Slice 19 measured the skip firing: a settled
14-column table runs zero `Cell.doLayout` and zero `CellRenderer.doLayout` on an
unchanged pass. Two things make it pay, both transferable: the host caches the
rectangles it hands down (`VirtualRowView.positionRow:530`,
`Body._lastColumnWidths`), and `Cell.clampsToContentSize()` returns `false` —
see X4.

**Honest limit.** The skip removes the child's `doLayout()` and nothing else.
`applyBounds` on a settled cell still costs four guarded setter calls and one
empty DOM patch (X6).

**Fix.** Compute `changed` in `commitBounds` from the four setters (as
`writeBounds` already does) and recurse only when the `applyBounds` gate would.
Then opt in the container types on Loom's hot path first: `Panel`, `Container`,
`Tab`'s pages, `Dock`'s regions, `Tree`, `SelectableListRow`, `Notification`,
`CodeEditorSearchPanel`, `Markdown`, the picker cells. Slice 01 F01.1 lists the
three known hazards and the existing escape hatches for each.

### X4 — size hints are never memoised, and `clampsToContentSize()` is the bigger lever next to the skip

**Root cause, two parts.**

*Nothing caches.* `Component.getPreferredSize:3376`, `getMinSize:3543` and
`getMaxSize:3577` re-derive from scratch on every query, each walking its own
subtree. `clampWidth:4164` and `clampHeight:4228` each run two full content-size
aggregations per axis per commit — 44% of the total (slice 01 probe PJ).
`LayoutManager.resolveBounds:383-406` reads `getPreferredSize`, `getSize`,
`getMaxSize` and `getMinSize` *before* it knows the fill mode, and discards all
four when the fill is `BOTH` — which slice 05 measured at **100%** of
`resolveBounds` calls in a Loom-shaped chain and in a plain `HBox` row.

*The opt-out already exists and almost nothing uses it.*
`clampsToContentSize()` defaults to `true` (`core/Component.ts:4092`);
`Cell.clampsToContentSize()` returns `false` (`component/table/cell/Cell.ts:225`),
which drives `getMinSize`/`getMaxSize` to **zero calls across 90 `applyBounds`**
(slice 19 probe P1).

**Measured fan-out.**

| Slice | Scenario | Size queries per pass |
|---|---|---|
| 01 | 53-node tree, unchanged | 788 `getMaxSize` + 788 `getMinSize` + 484 `getPreferredSize` |
| 05 | 31-node shell-shaped tree, unchanged | 1,081 total; 104 filtered-array allocations |
| 10 | 3-panel `Dock`, one identical pass | 265 pref + 195 min + 189 max |
| 06 | 5-region `Border`, per edge region | 5 pref + 8 min + 3 max (`Border.getPreferredSize` also asks each region's minimum) |
| 17 | 59-component calendar dropdown | 2,708 — ~46 per component, the 7-column `Grid` track solve being the multiplier |
| 28 | `LabeledGrid`, 16 children | 160 — ~10 per child |
| 21 | 105 table cells, width-changing frame | 1,710, of which ~1,140 (two thirds) are charged to `clampWidth`/`clampHeight` |
| 07 | 2 `Tab` panes × 8 tabs, one outer `Split` pass | 20 `stripThickness` / 160 `buttonCrossExtent` |

Growth is superlinear in depth: 6 nodes → 59 `getMaxSize`; 13 nodes → 360
(slice 01 probe P1b).

**Fix, in payoff order.** (a) Move `resolveBounds`'s four reads inside the
non-`BOTH` arms — mechanical, contained to one method, removes one full
recursive size descent per child per frame from every manager. (b) Override
`clampsToContentSize()` to `false` on components that are force-sized by their
parent: `CellRenderer` first (removes ~1,140 of the 1,710 above), then the
picker cells, the list/tree row renderers, and the leaf display components.
(c) Resolve the clamp bounds once per rectangle instead of four times.
(d) Gather each child's `(preferred, min, max, baseline, constraints)` once per
manager resolve phase.

**Related allocation.** `Component.getContentInsets()` (`:2624-2634`) returns a
fresh `Insets` on both branches, and `Insets extends BaseObject`, whose
constructor mints a UUID. Slice 28 measured `new Insets(...)` at **1,216 ns**
against 6 ns for a plain literal, and 282 of them in one `doLayout` of a
241-container tree (~0.34 ms/frame in node/V8). Every manager's `doLayout` opens
with one; `Split`, `Border`, `Tab`, `TabBar`, `FloatingPanel` and
`Slider.valueAtPointer` add more. The fix is a lazy `BaseObject` id plus a cached
`getContentInsets` invalidated by `setInsets`/`clearInsets`/`setPadding`.

`plans/two-phase-baseline-resolution.md` says "do not add a per-pass metrics
cache — that is speculative". It was written without a measured fan-out number.
The 1,081-query figure is the evidence that has changed; a per-phase gather also
makes that plan's extra `getBaselineMetrics()` sweep close to free rather than
additive.

### X5 — `Text.setText` and `Button.setGlyph` rewrite unchanged values, on per-frame and per-event paths

These are two setters, but one shape and one fix family, and between them they
account for most of the remaining stylesheet churn.

**`Button.setGlyph` (`component/button/Button.ts:1789-1819`)** has no same-name
guard. It always allocates a fresh `ButtonIconGlyph`, rebuilds the content row,
disposes the outgoing glyph (deleting its per-instance `#id` rule) and recomputes
the preferred size: **37 sink ops including one `ensureStyleRule` and one
`deleteStyleRule`, identical whether the name changed** (slice 13 probe).

| Caller | Frequency | Cost |
|---|---|---|
| `ScrollStrip.layoutArrows:801-802` | per layout pass per overflowing tab strip | 2 rule inserts + 2 deletes + 2 writes; 108 DOM ops on an identical pass, 76 of them from `setGlyph` (04, 07) |
| `VideoPlayer.syncFromState:590-591` | every `timeupdate`, ≥4/s during playback | 73 sink ops, 6 rule mutations, 6 `scheduleLayout` roots — 72 of the 73 from those two lines (26) |
| `Header`'s filter cells | per store `filterchange` | 16 `setGlyph` → 48 stylesheet ops at 8 columns (20) |
| `Window.reflectMaximizeState` | per window state transition | 3 stylesheet mutations for a glyph that did not change (09) |
| `TreeCellRenderer.refreshToggle:221` | per expand/collapse | 36 rule mutations per `collapseAll`, plus 18 leaked `Glyph`s (22) |
| `TreeRow.setRowData`, `IconLabel`, list `Glyph` renderer | per rebind whose icon changed | one tree expand = 3 rule mutations + 74 DOM ops; one collapse = 5 + 94 (18) |

The deeper cause for the tree/list cases is that **`Glyph` names are immutable**
(`component/display/Glyph.ts:282`), so every icon change disposes and rebuilds a
component. The fix there is a `Glyph.setName()`, not a caller workaround.

**`Text.setText` (`component/input/Text.ts:828-845`)** has no same-string guard,
and every call marks the measurement stale, schedules a parent layout and makes
the next pass issue an off-screen `<span>` probe: `appendChild` +
2 `getBoundingClientRect` — **one forced whole-document layout per `setText`,
identical string or not** (slice 14 probe). A *wrapping* `Text` re-measures
inside the bounds commit: 2 probes per frame, 20 `measureText` over 10 drag
frames.

Multipliers: 200 identical `textContent` writes per `notifyRecordChanged` on a
21×5 table pool, ~1,100 on a full-screen wide table (21); 1,375 text patches to
build a 50-item `NumberedList` (18); 32 identical title writes per sort click at
8 columns (20); 23 per `Tree.setNodes` handed an identical array (18).

Loom already hand-works around this with `measure()` + `setPreferredSize` +
`setAutoMeasure(false)` and a 14-line comment naming the reflow
(`loom/src/EditorController.ts:115-186`).

**Fix.** Same-value guards on both, plus slice 14's layout-free single-line
measurement seam on `DOMSource` (with `truncate: true` the default, a `Text` is
`white-space: nowrap`, so its natural width is `ctx.measureText(...).width` and
its height is `Util.lineHeightPx` — both already available, both layout-free).
That retires Loom's workaround.

### X6 — `InlineStyle.flushDirty` has no empty-bag guard, so every commit ends in an empty DOM patch

**Root cause.** `StyleTarget.flush()` (`core/StyleTarget.ts:79-83`) early-returns
only on a null target. `StyleRule.flushDirty` (`:404-410`) guards the empty bag;
`InlineStyle.flushDirty` (`:457-459`) does not, and calls
`DOM.sink.apply(target, { style: {} })` unconditionally. Every
`applyBounds`/`commitBounds` re-enables auto-commit at the end, so every
component flushes an empty patch on every pass.

Cost per call is one handle resolve plus two allocations — no forced layout. It
earns its place here on count alone.

| Slice | Scenario | Empty applies |
|---|---|---|
| 03 | 201-component tree, unchanged full-tree pass | 200 of 200 |
| 19 | settled 14-column table, per layout pass | 199 of 200; 180 are the trailing flush of the `applyBounds` calls that just correctly decided to skip |
| 18 | 300-item `List`, one unchanged pass | 902 of 906 |
| 08 | 4-section `Accordion`, unchanged pass | 38 of 38; 45 of 45 over three no-op drag frames |
| 09 | settled `Window` pass | 27 of 43 |
| 20 | 20-column header, unchanged pass | 29 of 30; 49 of 50 with the filter row; 42 of 68 per column-resize drag frame |
| 22 | `TreeBody` five-frame width burst | 650 of 1,570 |
| 12 | Loom's `MenuBar` + rail `ToolBar` chrome | ~28 per resize frame, all of them |
| 25 | `MarkdownViewer`, 10 identical passes | 310 of 350 |

**Fix.** Lift the guard into the shared `flush()` and delete the subclass copy;
add an empty-patch short-circuit to `ProductionDOMSink.apply` for direct callers.
One line, library-wide.

### X7 — the continuous-motion pattern is followed correctly in one place and violated in several

**The pattern, verified.** `AbstractWindow`'s header drag (slice 09 F09.11, probe
09b test 4) is the reference, and it has four parts, all of which a copier must
take:

1. lazy promotion — `setWillChange("transform")` on **first motion**, not on
   `mousedown`, so a plain click never pays for a layer;
2. motion committed with `Component.setTranslate` (`core/Component.ts:4647`),
   which writes `transform` **inline**, not to the `#id` stylesheet rule;
3. the setter's own unchanged-value guard does the filtering;
4. the layer is released on gesture end (`setTranslate(0,0)` +
   `setWillChange(null)`), after `setX`/`setY` commit the real position.

Measured: **one apply, one property, zero rule mutations, zero layout passes**
per move frame.

**Correction to slice 10's citation** (slice 09): that path is **not**
rAF-coalesced, so it still pays one `getViewportSize()` forced layout per raw
`mousemove`, unlike the resize and snap paths in the same class. Copy the
layer/translate half; add the coalescing the original lacks.

**Violators.**

| Slice | Component | What it does instead |
|---|---|---|
| 10 | `DragGhost.moveTo:90-93` | `setX`/`setY` on an un-composited translucent box-shadowed `position: fixed` box — 4 applies per **raw** mousemove, 2 of them unchanged `width`/`height` |
| 15 | `Slider` | `left`/`top` on an un-promoted thumb; no `setWillChange` anywhere in the file; one uncoalesced `getViewportRect` forced read per raw pointer sample, including 10 samples that write nothing |
| 27 | `DiagramView.applyTransformToHost:1005` | `Component.setTransform` → the `#id` **stylesheet rule**, once per raw pointer event, uncoalesced |
| 15 | `Toggle.applyValue:390` | `setTransform` → an `#id` rule write per flip, where `Checkbox`/`RadioButton` do the same job with one inline `opacity` write |
| 20 | table `Header` | the hint is on the wrong element: `Table.ts:336` promotes the `<thead>`, which receives **zero** transform writes, while `Header.setScrollX:1694-1696` transforms the three inner `Row`s, which carry no `will-change` |
| 10 | `Drawer`, `Rail` | `Animation.play` on `transform` with no hint anywhere (`grep will-change` in `core/Animation.ts` → 0 hits); `Rail.collapseTween` animates `width`, which cannot be composited at all |
| 16 | `ComboBox` caret | writes `transform: translate3d(NaNpx,NaNpx,0)` every pass forever and pins `will-change: transform` permanently |

**Enabling defect.** `Component.setTransform:3276` targets the component's `#id`
stylesheet rule while `setTranslate:4647` writes inline. Nothing in
`setTransform`'s JSDoc says so. Under this cost model that makes `setTransform`
the most expensive geometry setter on the public API. Either move
`transform`/`transformOrigin`/`clipPath` onto the inline surface, or extend
`setTranslate` to carry a scale — a library decision, not a per-component
workaround.

### X8 — `Event`'s subtree walk climbs to `<html>` for every event of any registered type

**Root cause.** `core/Event.ts:296-346` walks `DOM.source.getId(handle)` then
`DOM.source.getParentElement(handle)` per ancestor, for **every** event of a type
that has *any* subtree registration, matching or not, terminating only at the
document root. Each ancestor is interned with a `WeakRef` and a
`FinalizationRegistry.register` on first sight (`core/DOM.ts:212-224`,
`:2568-2572`).

Measured: 20 `getId` + 20 `getParentElement` on a 20-deep chain with zero matches
(slice 03 probe P3); 16 + 15 for one `mouseover` on a 14-deep unrelated target
(slice 06 probe S1). These are property reads, not forced layout — the cost is
call and allocation churn, paid on every boundary crossing across the whole
editor surface.

**The registrant set — the blocker.** Slice 06 proposed moving `SplitGutter` to
exact-target listeners. Slice 08 corrected it: that alone will not remove the
walk, because `Accordion` installs **two subtree `mouseover`/`mouseout`
listeners per section** (`layout/Accordion.ts:1403-1404`). A four-section Loom
sidebar is eight more. The full list any fix must cover:

- `mouseover`/`mouseout`: `SplitGutter.ts:230-231`, `Accordion.ts:1403-1404`
  (per section), `Notification.ts:249-250`, `AbstractChart.ts:189-190`,
  `DiagramView.ts:1821`.
- `pointerover`/`pointerout`/`pointerdown`: `Button.ts:851-853`, for the app's
  life, on every button.
- `keydown`: `ToolBar.ts:191-209`, `TabBar`.
- `click`/`mousedown`/`contextmenu`: `Body.init:1037-1044`; `SplitButton.ts:156`;
  `DragManager.makeDragSource` per `TreeBody` pool row (18–21 per tree table).
- `dragenter`/`dragover`/`dragleave`/`drop`: `FileDropZone.ts:91-94` — `dragover`
  fires continuously for any OS drag anywhere in the document, and the handler is
  empty.
- `scroll`: two per `Panel` (`core/Panel.ts:1283`, `:1561`); one per
  `MarkdownViewer` (`:195`).
- `wheel`: `core/Component.ts:4882`, for every component whose overflow style is
  `auto`/`scroll` regardless of whether anything can scroll.

**Fix.** Replace the per-level pair with one seam call,
`DOMSource.getAncestorIds(handle): readonly string[]`, that climbs inside
`core/DOM.ts` and returns ids only — one handle resolve and zero interns per
event instead of 2·depth resolves. Then narrow the registrants: `SplitGutter` to
exact-target on itself and its `CollapseButton`; `Accordion`'s headers to
non-bubbling `mouseenter`/`mouseleave` (its handlers already discard every event
whose `relatedTarget` is inside the header); `ToolBar`'s `keydown` registered
lazily on the first roving member.

One test pins incidental behaviour and must be restated:
`tests/dom/event-subtree-reentrant-dispose.test.ts` case EV2 asserts an outer
ancestor listener does **not** run after an inner one disposes itself; with a
snapshot walk it would.

### X9 — `DOMSource.getViewportSize()` forces a document layout for a value `Math.max` discards

**Root cause.** `core/DOM.ts:2336-2341` is
`Math.max(document.documentElement.clientWidth, window.innerWidth || 0)`.
`clientWidth` is in the forced-reflow set; `innerWidth` is not; and
`innerWidth >= clientWidth` on any desktop engine, so the `clientWidth` read can
never win. 30 call sites.

One `resize` event costs one read **per registered viewport listener**, and the
later ones land after earlier handlers' DOM writes — a forced synchronous layout
per extra listener per resize frame (slice 03 probe P1). Registrants: `Body`,
each `Rail`, each `Drawer`, every open `Window` (7 sites) and `Dialog` (2), every
`Popover`, every `Markdown`.

Worst measured instance (slice 09 probe 09c test 4): with **4 minimized windows**
one resize event costs **16 `getThemeVar` + 16 `getViewportSize` = 32 forced
document flushes and ~624 applies**, because each window's own listener re-runs
the static whole-stack relayout — quadratic in minimized windows.

**Fix.** Reorder to `window.innerWidth || document.documentElement.clientWidth`,
and memoise per task (cleared by `queueMicrotask`) so N handlers for one event
share one read.

### X10 — `getBorderSize`'s pre-connect estimate is uncached and resolves `var()` through `getComputedStyle`

**Root cause.** `Component.getBorderSize:3685-3714` caches the *connected*
measurement into `_borderWidths` but not the pre-connect estimate branch
(`:3704-3713`), which calls `estimateBorderSideWidth` → `DOM.source.getThemeVar`
→ `getComputedStyle(document.documentElement)` (`core/DOM.ts:2331-2333`),
uncached, per side, per call. `getPerimeterSize` calls `getBorderSize()` ~28
times per node per pass.

| Slice | Scenario | Reads |
|---|---|---|
| 01 | one pass over a 4-node detached bordered subtree | 152 `getThemeVar` |
| 09 | `AbstractWindow.show()` lays the whole window out **before** `LayerManager.mount` | 516 `getComputedStyle(documentElement)` on a bare window, vs **0** attached; `Dialog.open()` mounts first and pays 3 |
| 15 | `new TextField()` | 8, all for the same `--ts-ui-input-border`; half of them thrown away by `setBorder`'s own `if (pref)` gate |
| 17 | `AbstractCalendarDropdown.showAt` lays out twice, both passes detached | inferred from 01/09; not reproducible offline |

**Fix.** Cache the estimate in `_borderWidths` behind a provisional flag cleared
on first connect; memoise `getThemeVar` per var name in `core/DOM.ts`, cleared by
the `ThemeManager.onThemeChange` hook `core/BorderWidths.ts:112` already
registers; and move `LayerManager.mount` above `doLayout()` in
`AbstractWindow.show()`.

---

## Ranked findings beyond the cross-cutting defects

Ranked by what a Loom user would feel, not by op count. Loom's shell is a `Dock`
of `Tab`s holding CodeMirror editors, a `Split` with a file `Tree` in an
`Accordion`, a `MenuBar`, a `ToolBar`, a `StatusBar`, and `Dialog`s. It mounts no
`Window`, no `Rail`, no `Drawer`, no chart, no diagram, no `MarkdownEditor`, and
no `Table` outside dev tooling.

### Tier 1 — on Loom's gutter-drag and resize path

1. **A gutter drag clamped at a pane's minimum still re-lays out both panes'
   whole subtrees, every frame** (06 F06.3, `layout/Split.ts:1387-1393`). Probe:
   three over-travel frames → three `doLayout()` calls per pane with zero
   geometry change. Dragging a sidebar shut parks the pointer past the minimum,
   so this is the ordinary gesture. In Loom each wasted pass is a full CodeMirror
   re-measure per visible editor.

2. **`Accordion` re-measures and fully re-lays out every *closed* section on
   every frame** (08 F08.3). Probe: 1 `getPreferredSize` + 1 `doLayout` per
   closed section per `Split`-gutter-drag frame, for content clipped to zero
   height. Each closed Loom sidebar section holds a `Tree`. `Accordion` never
   received the `collapsed-panes-leave-render-tree` treatment `Split`/`Border`/
   `Tab` got, and `docs/layouts/Accordion.md` has no render-tree paragraph while
   `Split.md` does.

3. **`Accordion`'s shrink/fill pipeline runs in full every resizable pass and its
   output is discarded** (08 F08.2). Stubbing `computeShrinkRatio` and
   `computeFill` after the first pass left every section's rectangle
   byte-identical while removing 2 `getPreferredSize` + 2 `getMinSize` +
   2 `getMaxSize` per open section per frame — each a recursive walk of a `Tree`.

4. **`Split.recalculateSizes` recomputes the whole distribution every pass**
   (06 F06.4): 4 `getMinSize` + 4 `getMaxSize` per pane per unchanged pass, plus
   43 `getLayoutConstraints` and 19 `paneDirection` calls for four panes.
   Nothing is gated; the existing `available === _lastAvailableMain` check covers
   only the resize block.

5. **`Border.getPreferredSize` asks each region for its minimum as well as its
   preferred** (06 F06.5): 16 recursive size reports per edge region per
   unchanged pass, 76 for a 5-region `Border`. Loom's shell, `Header`, `Dialog`
   and both table panels each use one.

6. **The tab strip recomputes its chrome wholesale per pass** (07 F07.1–F07.4).
   `stripThickness()` has no memo and runs ~10× per pane per frame (20 calls /
   160 `buttonCrossExtent` for 2 panes × 8 tabs). `applyTabButtonStyles` rewrites
   every button's insets, writing-mode and text-align per pass, allocating 54
   `Insets` (and 54 UUIDs) per pane per frame at 12 tabs. The default
   `widthMode: "equal"` is quadratic: 8 tabs → 192 `computePreferredSize`, 16 →
   640. Loom escapes the quadratic by choosing `"content"`, but `Dock`'s own
   stacks take the default.

7. **A settled overlay `Panel` handed its own unchanged rectangle still runs the
   full live remeasure** (04 F04.2): 2 `getScrollMetrics` reads, each after a
   write in the same task — two forced synchronous layouts per frame — plus 4
   unchanged inline writes. The `panel-scroll-metrics-resize-coalescing` relay
   never arms, because it keys only on the panel's own size changing. Every
   fixed-width rail, `Border` edge region and non-dragged pane inherits this.
   `ScrollStrip`'s clamp-signature gate is the in-repo template.

8. **`scheduleGutterSettleOnShrink` runs a whole-subtree preferred-size recursion
   every pass, outside the coalescing gate** (04 F04.6): +1 `getPreferredSize`
   per laid-out child per pass for any `Panel` currently showing a gutter or a
   lit shadow edge — the normal state of an overflowing scroll host. It runs even
   on frames the burst gate withheld.

9. **`Tab.setBarVisible(false)` hides the bar with `visibility: hidden`**
   (07 F07.6), leaving 9 elements in the render tree to be charged on every
   ancestor resize. `Dock` hides the root frame's bar in its normal
   single-region state, which is Loom's steady state. Same shape:
   `SplitGutter`'s permanently-hidden `CollapseButton` on every `Accordion`
   gutter (08 F08.8), `MenuItem`'s invisible legacy icon `Text` (12 F12.2), the
   sort-priority and filter-clause badges on every rendered header cell
   (20 F20.8), `VideoPlayer`'s control bar and the chart legend (26 F26.9).

10. **`FloatingPanel.placeNextTo` forces a document layout per host pass, and
    `MarkdownViewer.doLayout` calls it twice** (11 F11.5, 25 F25.3). Probe: 20
    `getElementRect` over 10 identical passes — 2 forced synchronous layouts per
    frame per visible Markdown preview, which is a Loom preview pane.

11. **`Markdown.measureContentHeight` is a collapse/measure/restore probe on
    every assigned-width change** (25 F25.1): `height: auto` → read
    `scrollHeight` → `height: Npx`, i.e. 7 style applies (4 empty) + 1 forced
    `getScrollMetrics` + 2 document-layout invalidations per frame of a
    horizontal drag, plus a `parent.scheduleLayout()` that adds a second pass
    next frame. `resyncCodeEditorWidths` (25 F25.4) then interleaves one live
    wrapper read between each live code block's width write — N forced layouts
    for N blocks.

12. **`ScrollStrip.layoutContent` is called unconditionally from
    `TabBar.layoutChrome:2911`** (04 F04.1), which is what makes X5's
    `setGlyph` churn a per-frame cost rather than a per-event one.

### Tier 2 — on Loom's typing, scroll and pointer paths

13. **`Tooltip.hide()` never early-returns** (11 F11.1). `Component.removeElement`
    keeps the handle, so the `if (!el) return` guard is dead after the first
    show. Every `mouseout` and every `mousedown` over any tooltip-attached
    component plays a full 100 ms fade on a detached element: 3 applies, a
    timer, a `matchMedia`, and **2 native listeners that are never removed**.
    `Tooltip.attach` is not idempotent either — identical text costs 4 listener
    removals + 4 additions + 5 fresh closures (which defeat `Event`'s
    same-reference dedup) plus a stray `hide()` that dismisses a tooltip
    currently showing for a *different* component. 50 labelled `Button`s carry
    200 tooltip registrations, 50 of them the app's only resting `mousemove`.
    `Tooltip.show` also measures text one line at a time: 2 forced layouts for a
    one-line tooltip, 4 for three lines, while `Util.measureTextWidths` exists
    and is unused.

14. **Every `Panel` registers two subtree `scroll` listeners and takes three
    `getScrollMetrics` per scroll event** (04 F04.3), two of them redundant, plus
    a per-scroll overlay resize whose input cannot change on a scroll. Because
    they are subtree listeners, a **descendant's** scroll — a nested CodeMirror,
    a nested `Panel` — charges every enclosing `Panel`.

15. **`SmoothScroller.step` writes both axes every frame and
    `writeNativeScroll` reads each write back** (04 F04.4): two forced
    synchronous layouts per wheel-ease frame, one for an axis that never moved.
    Each wheel event costs a further 4 `getScrollMetrics` through
    `onWheelScroll` + `clamp`.

16. **`FieldDecorator.clearError()` mutates a stylesheet rule on every call, with
    no error showing** (15 F15.1). Loom wires it to `on("change")` in its rename
    and go-to-line dialogs, so that is one full-document restyle **per
    keystroke**.

17. **Opening a menu crosses the read ↔ rule-write boundary three times in one
    task** (12 F12.3). A 12-row `Menu.show()` costs 873 sink writes and 57
    stylesheet-rule ops, with 19 text measurements sandwiched between two batches
    of rule writes — the hazard `docs/concepts/performance.md:140` names. 24 rows
    → 1,497 writes / 105 rule ops. Right-clicking the Loom file tree is this
    path.

18. **`SpatialNavigation` resolves ~1,500 computed styles per arrow chord and its
    candidate collection is quadratic** (28 F28.1, F28.2). The component tier
    walks every candidate's ancestor chain twice — once in `isRenderedVisible`,
    once in `ancestorGeometry` — and `leafFocusables` runs an O(n²)
    `DOM.source.contains` scan for every candidate that is not a native focusable
    tag, which is every framework container that sets `tabindex="0"`
    (`Panel`, `Tree`, `Table`'s `<tbody>`, `ToolBar`, `MenuBar`, `TabBar`).
    Measured: 1,482 `contains` at n=40, 25,122 at n=160.

19. **Every `mousedown` in a Loom shell now walks the ancestor chain**, because
    `Body.init:1037-1044` installs three subtree listeners for the table body's
    lifetime (19). `SplitGutter` is no longer the only registrant.

### Tier 3 — big numbers with small Loom impact, stated plainly

These are real and worth fixing for the library. None of them is on Loom's
frame path today, and several reviewers said so themselves.

- **`ComboBoxDropdown.showAt` is unbounded** (16 F16.1): 500 items → 21,822 sink
  writes, 16,249 applies, 1,522 elements and **500 one-at-a-time `measureText`
  reflows**, for a panel capped at 200 px that shows nine rows. Cold path; no
  Loom combo has 500 items. The one-line half of the fix
  (`Util.measureTextWidths`) is worth taking regardless.
- **`AbstractSelectableList` is not virtualised** (18 F18.2): 300 items = 900
  components, 906 applies per unchanged pass, 901 `left`+`width` writes per
  resize frame. Loom's lists are dropdown-sized. The virtualisation half should
  be gated on whether a real app ever puts hundreds of items in a `List`; the
  per-row unchanged-rect guard is three lines and worth doing now.
- **`AbstractChart` rebuilds every SVG mark per pass** (26 F26.1): 1,081 sink ops
  and 210 element recreations per layout pass for a 3×50 line chart; an *empty*
  chart still rebuilds 57 axis marks. Plus 12 un-batched forced `measureText`
  per pass for a margin the code's own JSDoc says is range-independent
  (26 F26.2). Loom mounts no chart.
- **`DiagramView`** (27): a stylesheet-rule write per raw pointer event, an
  O(N) `getElementById` scan per pointer event (802 DOM lookups for one
  pointerdown + click on a 400-node graph), and a full residency recompute per
  zoom notch. Loom mounts no diagram.
- **`MarkdownEditor` re-serialises the whole document on every Lexical commit**
  (24 F24.1), selection-only commits included — 68–86% of every commit,
  1.65–2.2 ms on a 9 KB document, and 25 transformer-index rebuilds per keystroke
  inside a 4×6 table (24 F24.3). Loom does not use `MarkdownEditor` at all
  (`grep` → 0 files). The library's own demo doubles the cost by reading
  `getValue()` from its change handler.
- **`AbstractPickerField` fights its own layout manager** (17 F17.1): the default
  `Absolute` manager commits the button at its *preferred* rect, then `doLayout`
  overwrites it and re-fires `_button.doLayout()`. Three identical settled passes
  → 5 real style writes each (height flipping 16↔18 every pass), 10 `doLayout`
  calls and 161 size-hint queries per pass, against a `TextField`'s 1 empty
  apply and 4 queries. Loom uses no picker fields. `ComboBox.doLayout` has the
  same "manager first, override second" shape (16 F16.4) and Loom does use
  `ComboBox`.
- **The calendar dropdown rebuilds everything** (17 F17.3, F17.5): a second open
  of the year scroller costs **513 shared-stylesheet mutations** for a
  byte-identical list, and the detached column keeps all 171 rules while closed;
  every month step rebuilds all 42 day cells when 2 of 42 change. Cold path for
  Loom.
- **The `Window` resize-fps cap halves the frame rate** (09 F09.2):
  `PerFrameCoalescer` compares against `1000/60 = 16.667 ms` while a real 60 Hz
  frame is ~16.6, so 6 buffered moves apply 3, alternating — which reads as
  stutter. `getResizeFps`/`setResizeFps` have zero production callers. Loom opens
  no `Window`.
- **`Dock.reconcileHosts` is quadratic** (10 F10.2): 24 panels → 649
  `regionKind` calls, 24 `allTabRegions`, 25 `floatWindowsHoldingFrames` per
  sweep. It runs on every `addPanel`, close, drop, tab-bar merge and restore, and
  writes **nothing** to the DOM. Loom keeps 10–30 editor tabs open, so this one
  *is* charged — but per structural change, not per frame.
- **`temporalDisplayText` builds a fresh `Intl.DateTimeFormat` per value**
  (21 F21.3): 42–48 µs/call against 0.65–0.87 µs cached, a 55–66× factor. Per
  rebound temporal cell, per sampled row on auto-size, and ~4.8 s of pure
  formatter construction on a 100k-row CSV export. Export is the case that hurts.
- **`lexMarkdown` is quadratic** (25 F25.2): both block tokenizer extensions
  `split("\n")` the whole remaining source at every block-token position —
  408.70 ms against marked's own 3.98 ms at 3,200 blocks, synchronously inside
  `setMarkdown`. Loom previews Markdown files, so this is charged per preview
  open; a README-sized document is well under the quadratic knee.
- **`codeEditorTheme()` mints 2 `StyleModule`s and 51 CSS rules per call**
  (23 F23.1) — once per editor and again per theme toggle, never released, with
  the accumulated sheet re-serialised on each new mount. A Markdown preview with
  15 fenced blocks adds 765 rules; ten preview toggles of a six-fence README leak
  ~3,060 (25 F25.10). Loom previews Markdown, so this is charged.

---

## Corrections and refutations

A plan author must not resurrect any claim in this section.

### Corrections between reviewers

**`Text.setLineHeight` — reported by 14, partly refuted by 21, settled by 16.**
Slice 14 F14.3 reported that a *changing* line height is a full-document restyle
per frame plus an unbounded rule leak, naming `ComboBox.doLayout:922`,
`CellRenderer.doLayout:120` and the tree/list row renderers as per-frame drivers.

- Slice 21 refuted the `CellRenderer` half: the pixel argument is the
  theme-derived row height, which no resize can change, so the guard at
  `Text.ts:1173` short-circuits all 72 calls — **0 rule ops on a width-changing
  frame** (probe P21.4).
- Slice 16 refuted the `ComboBox` half and supersedes both: `applySingleLineBox`
  pins `minSize.height === maxSize.height`, so eight requested heights from 40 to
  17 all commit as 22 with **zero** rule ops (probe slice16a). The selector is
  `.ComboBoxLabel.lh<N>px` from `ComboBoxLabel.setLineHeight` — a hand-rolled
  copy of `Text.setLineHeight` on a plain `Component` — not `.Text.lh<N>px`.
  A session mints one rule per distinct theme font scale, not one per dragged
  pixel.

**Settled position.** The per-frame restyle does not exist. The unbounded leak
does, and it has a different cause: `Text.setLineHeight(NaN)` mints a permanent
`.Text.lhNaNpx { line-height: NaNpx }`, because the numeric guard at
`Text.ts:1173` cannot fire for `NaN`. The `NaN` reaches it from
`Component.getContentBounds()` returning an object whose members are `NaN`
(see the contract error below). `Text.setLineHeight` should reject a non-finite
numeric argument. `ComboBox.ts:922` is redundant and should be deleted along with
`ComboBoxLabel.setLineHeight` (~60 lines and one whole rule family).

**"No built-in layout manager uses `Component.applyBounds`" — reported by 01 and
05, corrected by 08, 19 and 20.** `layout/Table` does (`layout/Table.ts:389`,
`:405`), and so do `TableHeader.positionColumnCells`/`positionParentCells`/
`positionFilterCells` (`component/table/Header.ts:1622/1640/1659`). There are
**7** `applyBounds` sites, not eight. `layout/Table.ts:389` hands a `Button`,
which does not override the gate, so that call gets no skip. The narrowed claim
is: `commitBounds` — the path every box, grid, border, split, tab and card
manager funnels through — never routes through `applyBounds`.

**The no-op drag-frame skip is a port, not a new design — 08 corrects 06.**
`Accordion.layoutSections` already has it: `if (reflowAll || contentHeight !==
oldHeight)` (`layout/Accordion.ts:1708`), plus dead-zone bookkeeping in
`onGutterDrag` (`:1922`) that `Split`'s absolute origin+offset model has no
equivalent of. Probe: three over-travel gutter-drag frames produced **0**
`doLayout` calls and 0 rule writes. Port the gate `Accordion` → `Split`.

**The continuous-motion precedent — 09 corrects 10.** `AbstractWindow`'s header
drag is exemplary on the write side (1 apply, 1 property, 0 rule mutations, 0
layout passes per move frame) but is **not** rAF-coalesced, so it pays one
`getViewportSize()` forced layout per raw `mousemove`. Copy the layer/translate
half and add the coalescing the original lacks.

**The table focus sweep — 21 corrects 19.** Slice 19 F19.3 rated
`_updateFocusStyle`'s full-pool fallback HIGH on the strength of 105
`setStyleState` calls per pass. `Component.setStyleState` is guarded, so all 105
produce **zero** DOM writes (probe P21.3). It is a JS-call-count finding, not a
write finding, and should be rated LOW. The fix is still worth making; it must
not be bundled into a DOM-write-reduction plan on the strength of a write count
it does not produce.

**`Accordion`'s gutters do not pay the `CollapseButton` rule writes — 08 confirms
06's guess.** `Accordion` constructs its gutters with `collapsible: false` and
never calls `setOpaque`, so F06.2 does not apply to them. F06.7 (subtree
listeners) and F06.12 (`matchMedia` per hover) do.

**Slice 04's settled-`Panel` remeasure does not reproduce everywhere.** It does
not fire in picker dropdowns (17: 0 `getScrollMetrics` over 5 identical
time-picker passes), in charts (26: `Panel.remeasureScrollMetrics` short-circuits
on `_autoScroll === "none"`, the chart default), or in the table body (19:
`Body` sets `setOverflow("hidden")` and is not a `Panel`). Slice 25 also measured
zero for `MarkdownContentPane` and marked it **not verified** either way.

**Slice 23's `syncAutoHeight` HIGH does not apply to `MarkdownEditor` — 24
corrects the briefing's routing.** `autoHeightMaxRows` is set only by
`component/display/Markdown.ts:1194`, i.e. the *viewer's* embedded code blocks
(slice 25), not the Markdown editor. `MarkdownEditor` has no `doLayout`, no size
override, zero geometry reads and zero style writes on any layout path, and
construction issues zero sink ops.

### Premises in the briefing that were wrong

- **The `Image.getPreferredSize` bug is already fixed** (13 F13.15). Commit
  `0e7b07db` replaced the live natural-size read with the `_naturalSize` cache
  plus the `_hasExplicitPreferredSize` gate. The override at
  `component/display/Image.ts:787-789` is now `return super.getPreferredSize();`
   — dead code.
- **`plans/button-primary-press-filtering-exploration.md` is stale** (13 F13.19),
  superseded by `plans/implemented/primary-button-interaction-filtering.md`. Its
  line references no longer resolve and it proposes
  `createStyleRule(".pressed")`, which the class-hierarchy-cascade work replaced
  with declared class-tier states. Retire it.
- **"The `CodeEditor` wrapper is wasteful per frame" is refuted** (23 F23.2).
  Ten identical `setSize` + `doLayout` passes on a mounted editor record **zero
  `DOM.source` geometry reads** and no editor-owned style writes; the 5 applies
  per pass are `Component`'s own. `doLayout` never calls `requestMeasure`, and
  CodeMirror's `ResizeObserver` self-throttles to one measure per 75 ms. The
  measured 15–20 ms/frame is engine layout of CodeMirror's line DOM caused by the
  box changing size. The only lever is decoupling the box CodeMirror observes
  from the box the framework commits during a drag — a product decision with a
  visible trade-off, needing a real A/B.
- **`MenuBar` and `ToolBar` add no per-frame work of their own** (12 F12.1). A
  settled pass issues no rule writes, no geometry reads and no non-empty style
  writes — only X6's empty flush, ~28 per resize frame for Loom's chrome.
- **`Dock` adds zero per-frame work** (10). No `doLayout`, no `render`, no
  viewport listener, no geometry read, no rule write. Everything a dock pane
  costs belongs to `Split` and `Tab`. Treat as settled.
- **`LayerManager` writes no DOM and reads no geometry** (11). Its
  `restampSubtree` comment is accurate.
- **`Animation.play` costs zero JS per animated frame** (11) — the motion is a
  CSS transition through an `InlineStyle` buffer, and `finish` clears
  `transition` so a later `transform` write is not retroactively animated.
- **No stylesheet-rule write is reachable on any per-frame path in slice 11**
  (11). The suspected `Popover.positionArrow` `setShadow` produces
  `setRuleStyles: 0` on both an unchanged-anchor and a moved-anchor reposition,
  because `Component.setShadow` is guarded.
- **The table header's continuous-motion paths are already clean** (20). A
  column-resize drag frame costs 0 stylesheet-rule mutations and 0 forced reads
  over 10 frames; an unchanged pass costs 0 header-cell `doLayout`.

### Documentation errors found

**`docs/concepts/performance.md`'s column-window paragraph is wrong in four
places** (21 F21.4). The paragraph beginning "A table's row pool is fixed size;
the cells inside a row are not" (commit `a7e7c454`, 2026-08-03) predates
`Row._cellCache` (commit `517a7594`, 2026-08-17).

| Claim | Fact |
|---|---|
| "rebuilds a cell" on a column-window step | only on a cold cache; the second traverse of the same range builds **0** elements against 72 (probe P21.7) |
| "and its stylesheet rule" | a `Cell` materialises **no** per-instance rule — 55 `ensureStyleRule` ops for a whole 14-column table build, every selector class-scoped (probe P21.6) |
| "the freed cell's rule is deleted immediately … nothing carries over" | `Row.retireCell:948-966` caches rather than disposes; 3,667 → 2,474 sink ops (−33%) between first and second traverse |
| "the framework has no per-column cache to warm" | `Row._cellCache:129` keyed by `Row.cellKey:815` is exactly that |

The brief's question "would a per-type pool remove it" is answered: yes, and it
is already implemented. Rewrite the paragraph; note honestly that `_cellCache`
has no eviction (21 F21.9).

**Other doc/code disagreements**, each confirmed by reading the code:

- `performance.md`: "Every `getSize()` call forces a flush so the read is
  up-to-date." `Component.getSize:3339-3344` returns cached `_width`/`_height`
  and forces nothing (09, 14, 27).
- `performance.md:35` and `component-lifecycle.md:111`: `pauseLayout()` "blocks
  the rAF queue from running on this component (and its subtree)". It is a
  per-component flag; a descendant that schedules its own layout is not pruned
  (01 F01.11).
- `performance.md:178` and `ARCHITECTURE.md`: "Construction itself is JS-only —
  no stylesheet inserts, no forced layout." False three ways:
  `new Container({ layoutManager: new Tab() })` performs 9 `createElement`,
  7 `ensureStyleRule` and 7 `setRuleStyles` (07 F07.5); `new ToolBar()` runs
  three synchronous `doLayout()` calls from its own constructor (12 F12.5);
  `Component.getElement()`'s by-id fallback turns construction into 5–23
  `document.getElementById` calls per component, 23 for a `Button`, 277 for one
  `Dialog.show()` (01 F01.10, 09).
- `layout-system.md:29`: the diffed-write contract — inert outside the table
  (X3).
- `dom-seams.md`: "the per-frame inline-style flush in `StyleTarget` batches its
  whole dirty bag into a single `apply`". True only while the buffer is
  unmaterialised; after `attach`/`ensure`, `set` and `setMany` write through one
  property at a time — which is exactly the per-frame case (02).
- `sizing.md`'s size invariant ("min wins on read"): false for every auto-sized
  `Button`, because `Button.getPreferredSize` bypasses
  `clampPreferredToConstraints` on the auto branch — a `Button` with
  `minSize.width 300` reports a preferred width of 38 (13 F13.10).
- `Component.getContentBounds()`'s JSDoc promises `null` when the element is not
  in the DOM; it returns a non-null object whose `width`/`height` are `NaN`,
  because `getInnerSize()` returns an object of nullish members. Every caller in
  the library guards with `if (!box)` or `?? fallback`, and every one is
  therefore wrong for this case (16). This is the mechanism behind the
  `ComboBox` NaN transform and the `.Text.lhNaNpx` rule.
- `docs/components/Text.md:49` claims `Text` subscribes to the theme on
  construction; `tests/component/input/TextThemeReflow.test.ts:26` asserts it
  registers **zero** theme listeners (14 F14.15).
- `docs/components/AbstractWindow.md:5` says `AbstractWindow extends Panel`; it
  extends `Container` (09).
- `docs/components/Tree.md:98` documents `collapseAll()`; `component/tree/`
  contains no such method (18 F18.11).
- Four more small ones: `ToolBarSeparator.md`'s thickness (9 px documented, 1 in
  code), `ToolBar.md`'s compact insets (2 documented, 0 in code) and two
  advertised-but-unread theme tokens (12 F12.14); `docs/components/Slider.md`
  and `Toggle.md` document tokens that `Slider.ts` never reads and that do not
  exist at all, respectively (15 F15.11); `Tooltip.md`'s "follows the pointer
  until it leaves" (11); `VirtualScroller.md:28`'s pre-seam `init(element?:
  HTMLElement)` signature (04).
</content>
</invoke>

---

## Correctness bugs

These are not render-work findings and must not wait behind a performance plan.
Several are one-line fixes with a precedent in their own file. The table folds in
`00-progress.md`'s register, verified against each source report, plus fourteen
the register missed. Ranked by severity.

**Re-verified 2026-09-20 against `master` at `82f012b1`** — see
`01-phase2-status-pass.md` for current line numbers, fix shapes, and the six
places this register was wrong or narrower than the code. Corrected entries
carry the correction inline. Every line number in these tables is from
2026-09-15 and has drifted.

### Data loss

| # | Bug | Where | Slice |
|---|---|---|---|
| C1 | An open cell editor survives its pool row being rebound by a scroll, then commits the user's text onto whichever record the slot now holds; the edited record is left untouched. Probe: `WROTE_TO_WRONG_RECORD: true`. `commitEditsOutsideWindow` guards the column axis only — the row axis never received the same treatment. | `component/table/Body.ts:1390-1473`, `:1347-1367`; `component/table/Row.ts:283-296`, `:788-801` | 22 F22.1 |
| C2 | `AutoCompleteField.querySuggestions` mutates the consumer's shared store on every keystroke: `store.clearFilter()` destroys the application's own filters, `store.filterBy(...)` leaves the field's own installed, 2 `datachange` + 2 `filterchange` fire per keystroke (every bound `List`/`Table`/chart rebuilds twice), and `getRecords()` is read on the synchronous side of an async rebuild. Probe confirms the app's filter is gone and the field's remains. | `component/input/AutoCompleteField.ts:629-651` | 16 F16.5 |

C1 and C2 both have contained fixes. C1: commit or cancel any editing cell on a
row whose `wasRebound` is true, before `row.setData`. C2: filter in-process with
the already-exported `matchesFilter` over `store.getAll()`, using the descriptor
`querySuggestions` already builds.

### Crashes

| # | Bug | Where | Slice |
|---|---|---|---|
| C3 | An auto-sized `Grid` whose laid-out children drop to zero throws `RangeError: Invalid array length` from every size report and from `doLayout`. `flushLayouts` has no `try`/`catch`, so one throw drops every remaining layout **and** the frame's `afterNextLayout` callbacks. Reachable whenever an auto `Grid`'s children are all `setDisplayed(false)` — which is what `Card`, `Tab` and the collapsed-pane path do. | `layout/Grid.ts:316-318` (`rows = Math.ceil(0 / 0)`), consumed at `:880-881`; `core/Component.ts:218-240` | 05 F05.5 |
| C4 | A childless, focused `ToolBar` throws on arrow-key navigation: `_rovingTabIndex` is created only in `addComponent`, but the bar sets its own `tabIndex` to 0. Probe: `Cannot read properties of undefined (reading 'moveNext')`. | `component/menubar/ToolBar.ts:198-206`, `:189`, `:542-544` | 12 F12.13 |
| C5 | `AutoCompleteField` leaks two timers past disposal — a 200 ms debounce and a 150 ms blur timer, both on the bare global `setTimeout`, neither cleared in `destructor`. A field disposed mid-typing fires against a disposed dropdown whose handles are released, and `HandleRegistry.resolve` throws by design on a released handle. Not reproduced by probe. | `component/input/AutoCompleteField.ts:126`, `:506-509`, `:567-578`, `:714-718` | 16 F16.11 |

### Leaks that grow without bound

| # | Bug | Where | Slice |
|---|---|---|---|
| C6 | `Text.setLineHeight(NaN)` mints a permanent `.Text.lhNaNpx` shared rule, because the numeric guard cannot fire for `NaN`. `ClassStyleRules._stateBags` has no delete path. | `component/input/Text.ts:1173`, `:1200`; `core/ClassStyleRules.ts:1104` | 16 F16.4 |
| C7 | `codeEditorTheme()` mints two fresh `StyleModule`s and 51 CSS rules per call — per editor and per theme toggle — and nothing releases them; each new mount re-serialises the whole accumulated `<style>`. Ten preview toggles of a six-fence README leak ~3,060 rules. `style-mod`'s own docs forbid the pattern. | `component/editor/theme.ts:68`, `:222`; `component/editor/CodeEditor.ts:2069`, `:2644` | 23 F23.1, 25 F25.10 |
| C8 | `Dock` registers a global drop target and discards the teardown closure; `destructor` never unregisters it. `DragManager.dropTargets` is a module-level `Map` with no weak semantics, so every `Dock` ever built is retained with its whole subtree. `overlay/Window.ts:165` discards a `makeDragSource` teardown the same way, retaining every `Window` opened. | `overlay/Dock.ts:447-479`, `:2371-2385`; `overlay/DragManager.ts:194-195` | 10 F10.4 |
| C9 | `TreeBody` has no `destructor`, so `_rowDnDTeardowns` (18–21 entries) and `_emptyAreaDropTeardown` never run. Probe: 18 still held after dispose. Every disposed `TreeTable` pins its pool rows and the body in `DragManager`'s maps for the life of the page. | `component/table/TreeBody.ts` (no `destructor`), `:132`, `:135` | 22 F22.9 |
| C10 | `TreeCellRenderer.refreshToggle` removes the outgoing `Glyph` without disposing it, despite a comment claiming to match `TreeRow.setRowData:229-231`, which does. One `collapseAll` on a 200-root tree leaks 18 `Glyph`s with their `#id` rules and issues 36 stylesheet mutations. | `component/table/cell/renderer/TreeCell.ts:221-238` | 22 F22.3 |
| C11 | The picker's year column is retained detached with all 171 cell rules while closed, and `dispose()` releases 44 of 215 — the column is no longer a registered child, so the destructor recursion never reaches it. | `component/input/AbstractCalendarDropdown.ts:1007-1020` (no dispose), `:1027-1050` | 17 F17.3 |
| C12 | `Button.clearDescription()` strands the description `Text` — element, `#id` rule, theme subscription and measurement-registry entry. `destructor` nulls the field first, so its `this._description?.dispose()` never fires. `setGlyph`/`clearGlyph` hold the outgoing instance in a local for exactly this reason. **Closed 2026-09-20: fixed by wave 1's `8d8adb29`, with a regression test.** | `component/button/Button.ts:1407-1415` | 13 F13.7 |
| C13 | `CellEditorPool.register` drops a cached editor with `_editors.delete(key)` and no `dispose()`, contradicting the class's own JSDoc. Reachable from `Table.setDisplayMode` (the rotated-view toggle), so a user control leaks one `ComboEditor` with its `ComboBox`, dropdown, theme subscription and rules per combo column per toggle. **Closed 2026-09-20: fixed by C1's `6b8e0d5a`, with a regression test.** | `component/table/cell/editor/CellEditorPool.ts:276-281` | 22 F22.10 |
| C14 | `TablePanel._spinner` is mounted via `showOverlay`, never through `addComponent`, and `destructor` never touches it — one leaked component with a theme subscription per panel that ever saw a `loadingchange`. `TreeTablePanel` is a near-verbatim copy with the same bug. | `component/table/TablePanel.ts:38`, `:132-141`; `component/table/TreeTablePanel.ts:44`, `:138-147` | 19 F19.14, 22 F22.11 |
| C15 | `Animation.play` registers `transitionend` and `transitionstart` with `{ once: true }` and removes neither in `finish()` or `cancel()`. A transition that never fires — the normal case for a detached element — leaks two native listeners each time. Probe: 10 stray `Tooltip.hide()`s → 20 `addListener`, 0 `removeListener`, all piling onto one retained singleton element. | `core/Animation.ts:153-177`, `:133-151`, `:211-213` | 11 F11.1 |
| C16 | `ButtonGroup.addButton` registers an inline-arrow `"action"` listener with no stored reference, and `removeButton` never removes it — a removed button keeps deselecting its former siblings. `setContainer` allocates a fresh `RovingTabIndex` and another inline-arrow subtree `keydown` listener on every call, with no removal path. | `overlay/ButtonGroup.ts:229-245`, `:252-266`, `:276-298` | 11 F11.9 |

### Wrong render

| # | Bug | Where | Slice |
|---|---|---|---|
| C17 | An emptied `HBox`/`VBox` reports negative or unbounded preferred sizes — `width += spacing * (length - 1)` with `length === 0`, and `VBox`'s `UNBOUNDED`-seeded width that is never reduced. Probe: empty `HBox` pref `{-5, 0}`; empty `VBox` pref `{9007199254740991, -5}`. A sibling of an emptied `VBox` in a preferred-mode `HBox` is starved to ~0 px. Reachable through the merged undisplay/collapse work. | `layout/HBox.ts:117`, `:179`; `layout/VBox.ts:108`, `:122`, `:168-182` | 05 F05.6 |
| C18 | A theme change while a `Markdown` is undisplayed measures a `display:none` element and permanently caches height 0. `measureContentHeight` checks only `getElement()`, never `isEffectivelyVisible()`, and `setWidth`'s changed-guard means a re-show never re-measures. Loom reproduction: open a preview, switch to the source page, toggle the theme, switch back — the preview reports height 0 and cannot scroll. | `component/display/Markdown.ts:990-993`, `:1043-1050`, `:972-984` | 25 F25.6 |
| C19 | Two `Markdown` previews of documents sharing a heading name break each other's outline. Heading ids are deduped only within one render but written into the global document id space; `findActiveHeading` resolves them with a document-wide `getElementById`, so the second viewer's `contains` check rejects every heading and the minimap never highlights. Two Dock panes previewing two files is the ordinary Loom case. **Wider than recorded (2026-09-20): `HeadingScrollTracker.scrollToHeading` carries the same `getElementById` + `contains` pair, so the second viewer's minimap clicks silently no-op too, not just its highlight.** | `component/display/Markdown.ts:2206-2245`, `:426`, `:1619` | 25 F25.5 |
| C20 | `Card` keeps a removed child as `_currentVisible`, so the container is permanently blank: it still reports the removed child's preferred size and still lays it out, while the remaining sibling stays `display: none`. `unwireChild` drops constraints and never notifies the manager. | `layout/Card.ts:28`, `:171-177`, `:232`, `:299-305`; `core/Component.ts:6744` | 05 F05.10 |
| C21 | `Tooltip.detach` ends in an unconditional `Tooltip.hide()`, so `Button.setText` on any button starts the fade-out of a tooltip currently showing for a **different** component. Probe Q3: `visible true, dismissing false` → `visible true, dismissing true` after an unrelated `setText`. | `overlay/Tooltip.ts:462-477`, `:393-394`; `component/button/Button.ts:1445` | 11 F11.2 |
| C22 | Every `ComboBox` writes `transform: translate3d(NaNpx,NaNpx,0)` onto its caret glyph on every layout pass, forever, and pins `will-change: transform` permanently. Root cause is in the layout base: `Absolute.doLayout:56-57` feeds an unset `getX()` into `commitBounds`'s translate fast path, `positionUnchanged` can never be true once `NaN` is in play, and `setTranslate`'s `===` guard cannot reject `NaN`. | `component/input/ComboBox.ts:658-680`; `layout/Absolute.ts:56-57`; `layout/LayoutManager.ts:551-558`; `core/Component.ts:4648`, `:4658` | 16 F16.3 |
| C23 | `AbstractPickerField`'s `parseRaw` accepts partial input: typing `2026` or `2026-09` parses through `new Date(raw + "T00:00:00")` and fires `notifyChange` with a value the user never typed. The same path flashes the invalid border red three times while typing a 10-character date. **Sibling hole (2026-09-20): `DateTimeField.parseRaw` leaves its `datePart` unchecked, so `"2026 10:00"` commits 1 Jan 2026 10:00 — fold it into the same fix.** | `component/input/DateField.ts:116-131`; `component/input/AbstractPickerField.ts:427-446` | 17 F17.7 |
| C24 | `MenuBar` and `MenuSeparator` paint their borders through `setElementCSSRule` rather than `setBorder`/`cacheBorderSpec`, so `getBorderSize()` returns `{0,0,0,0}` and `getInnerSize()` overstates the usable height by 1 px. `MenuBar`'s `HBox` then stretches every button one pixel past the content box and `overflow: hidden` clips the bottom row. Three sites in the same slice use the correct pattern. | `component/menubar/MenuBar.ts:88-91`; `component/container/MenuSeparator.ts:53-56`; `core/Component.ts:3690-3700` | 12 F12.10 |
| C25 | `AbstractWindow.doLayout` writes the south resize strip's height from `insets.getRight()`; every sibling uses its matching side. Invisible at the default uniform 4 px insets, wrong for any consumer passing asymmetric insets. | `overlay/AbstractWindow.ts:2466` | 09 F09.13 |
| C26 | `WindowBorder.setDirection`'s `if (!direction) direction = Direction.NORTH` guard treats an explicit `Direction.NORTH` as missing, because `Direction.NORTH === 0`. The constructor has the same latent bug. Currently masked: `setDirection` has zero callers and the field default is already NORTH. | `component/container/WindowBorder.ts:154-162`, `:113-115` | 09 |
| C27 | `Markdown.measureContentHeight` writes `height: NaNpx` on a component's first commit, because `commitBounds` calls `setWidth` before `setHeight` and `getHeight()` returns the uninitialised `_height` rather than its intended `0` fallback. The browser drops the invalid declaration, so it self-corrects; the write still reaches the DOM. | `component/display/Markdown.ts:1069`, `:1080`; `core/Component.ts:3339`, `:4185` | 25 F25.13 |
| C28 | `Fit` and `Card` lay out a 0×0 rectangle and recurse into the whole subtree before the container has an element; every other manager returns when `getInnerSize()` is `null`. The real pass then redoes all of it. | `layout/Fit.ts:232-250`; `layout/Card.ts:307-325` | 05 F05.9 |
| C29 | `LayoutSerialization` filters `transient` children under a `Tab` but not under a `Split`, so a captured layout carries a placeholder node that `materializeNode` then warns about and skips on every restore. No in-library trigger today (the Dock's placeholder sits under a `Tab`), so this is drift prevention. | `layout/LayoutSerialization.ts:216` vs `:232` | 08 F08.13 |

### Stuck state, a11y, battery

| # | Bug | Where | Slice |
|---|---|---|---|
| C30 | `LayerManager`'s monotonic z counter is consumed by `bringToFront`, not only by `register`. Since raising is a per-click gesture, an ordinary window crosses the PinnedWindow, Popover **and** Dropdown bands after ~400 title-bar clicks. Probe: crossed at raise #400, z 10203 against `Band.Popover`. The band comment's headroom budget counts registrations only. | `core/LayerManager.ts:174-176`, `:228`, `:398-407`, `:452-467` | 11 F11.6 |
| C31 | `Notification`'s hard-coded `Z_INDEX = 10002` is overtaken by the dropdown band after three `LayerManager.register` calls anywhere in the session, so a toast silently renders behind an open menu or picker for the rest of the session. A fixed literal cannot sit "just above" a band-plus-counter allocator. | `overlay/Notification.ts:111-117`; `core/LayerManager.ts:130`, `:228` | 11 F11.7 |
| C32 | `FOCUSABLE_SELECTOR`'s `:not([tabindex="-1"])` binds only to its trailing `[tabindex]` branch, so every roved-off `<button>` still matches: every tab button, tool-bar button and menu-bar button is a Tab stop and a spatial-navigation candidate. `RovingTabIndex.add` does set `tabindex="-1"`; the selector never honours it. Five live `it.todo`s pin the defect, including a resting `CodeEditor` exposing **zero** tab stops for want of a `[contenteditable]` branch. | `core/Focusable.ts:12`; `tests/core/FocusTraversalCompositeWidgets.test.ts:56-79`, `:105-122` | 28 F28.4 |
| C33 | `Notification` never re-stacks on a viewport resize: `restack` derives both coordinates from `getViewportSize()` but the file registers no `resize` listener, so live toasts stay at the old bottom-right corner until the next show or dismissal. | `overlay/Notification.ts:605-619` | 11 F11.11 |
| C34 | `RadioButton.setSelected` fires nothing while `Checkbox.setSelected` fires a synthetic click; two sibling controls with the same documented `on("action")` contract behave differently for a programmatic write. Separately, `Checkbox.setSelected`'s synthetic click dispatches through `Event`'s full routing on every pooled boolean-cell rebind, which `Body.onSubtreeClick` catches and discards and `cell/editor/Boolean.ts` wraps a `_suppressCommit` flag around. Any change must be an opt-out, not a removal. **The stated reason is wrong (2026-09-20): `CheckboxMenuRow`/`RadioMenuRow` do not depend on the click — `AbstractBooleanMenuRow.installControl` sets `setPointerEvents("none")` on the control and listens on the row, which the synthetic click never reaches. The real reason is stronger: `Checkbox.on("action")` is a direct-target listener on the checkbox root, a real click lands on the inner `_box`, and `Event` matches direct listeners by exact target id — so `on("action")` never fires from a real click, and the synthetic click is its sole delivery path.** **Settled (2026-09-20) by `plans/implemented/boolean-input-action-fanout.md`: the opt-out is `Checkbox.setSelected`'s new `fireAction` parameter, defaulting to `true`, so no existing call changes. `RadioButton` is unchanged and gains no fan-out — its `"action"` firing once per user activation and never on a programmatic write is the correct contract, and giving it one would make `ButtonGroup`'s sibling-deselect sweep announce an action on every untouched button and re-enter itself. `cell/editor/Boolean.ts` passes `fireAction: false` at both programmatic sites and `_suppressCommit` is gone, which also fixed a user-reachable double commit the flag was hiding. The residue — that `on("action")` is delivered by the wrong event in both directions — is recorded as C40.** | `component/input/RadioButton.ts:365-376` vs `component/input/Checkbox.ts:450-454`; `component/table/Body.ts:1488-1496` | 15, 19 F19.10 |
| C35 | A `WebGLCanvas` whose `getContext()` returns `null` still runs its rAF loop forever, because `shouldAnimate()` never consults `hasRenderingContext()`. That is the normal case in software-rendered WebKitGTK — the target environment. **Impact claim refuted (2026-09-20): the QA app's `canvas-idle` panel measured `webglContexts` 4 of 4 under WSLg MiniBrowser — that engine has WebGL2. The mechanism is real, but read the severity as latent, not routine.** | `component/display/WebGLCanvas.ts:250-261`; `component/display/AbstractCanvasSurface.ts:386-389` | 26 F26.7 |
| C36 | A canvas added to an already-hidden parent keeps animating: `onEffectiveVisibilityChange` is the only pause trigger, and a reparent fires no `setVisible`/`setDisplayed` edge. The three hiding shapes the merged `canvas-pause-when-hidden` plan covers all work; this is the hole the edge-triggered rewrite opened. The same gap affects `Markdown` and `CodeEditor`, which use the identical deferred-flush pattern. | `component/display/AbstractCanvasSurface.ts:452-455`; `core/Component.ts:2429-2438` | 26 F26.8 |

### Latent, worth recording

`CellEditorPool` has no ownership guard: `acquire` reassigns `_activeCell`
without committing the outgoing cell, and `release()` takes no argument and
blanks the pointer whichever cell calls it, after which the pool's blur and
keydown listeners reach nobody (22 F22.17). No production path reaches it today
because `Cell.startEdit` refuses to re-enter — but C1's fix touches the same
invariant and should close it. **Closed 2026-09-20, as predicted: `acquire`
now commits the outgoing cell before taking the slot, and `release(cell)`
takes the releasing cell and returns early unless it owns the slot.**

`Tree.setNodes` clears the expanded set silently, forcing the caller into one
full reflatten and render per expansion replayed. Loom's `FileTree.refresh()`
does exactly that (18 F18.9) — a documented contract, not a bug, but the reason
a refresh is expensive.

---

## Positives to protect

A plan that breaks any of these is a regression even if it hits its own target.
Each is probe-verified in the slice named.

**The layout and write seams that already work**

- **The unchanged-geometry skip genuinely fires where it is used.** Zero
  `Cell.doLayout` and zero `CellRenderer.doLayout` on an unchanged table pass, on
  a one-row vertical scroll, and on a horizontal scroll that does not move the
  column window. Pinned by `CellLayoutSkip.test.ts` and
  `ScrollRebindLayoutEconomy.test.ts` (19, 21).
- **`Cell.clampsToContentSize() === false`** gives 0 `getMinSize`/`getMaxSize`
  across 90 `applyBounds` (19). This is the measurement any size-hint memo must
  be compared against.
- **`Component`'s four per-axis geometry setters are guarded and reach the sink
  zero times on an unchanged pass** (05, 09, 10). The "unchanged geometry
  applies" other slices saw are clip-frame writes from `StyleTarget.setMany`, not
  component geometry.
- **`Component.setStyleState` is guarded and writes a single class token** — the
  precedent slices 04, 17, 18 and 20 all want extended. `TreeRow` and
  `Body.updateRowVisualState` already use it (18, 19).
- **`StyleRule.flushDirty`'s empty-bag guard** is why an `Accordion` pass makes
  exactly one `setRuleStyles` call rather than four (08). It is the template for
  X6's fix, not a thing to remove.
- **`Component.setVisible`/`setDisplayed` short-circuit idempotently**, which is
  why `Accordion`'s per-pass `setVisible(true)`/`setDisplayed(true)` cost nothing
  (08).
- **`Aria`'s private `setAttribute` is value-compared** (02, 18) — the guard
  `setRole`/`setTabIndex` should adopt.
- **`Component.setTranslate` is guarded and writes inline, not to a rule** (18,
  09) — the whole basis of X7's correct pattern.

**Components that add nothing per frame**

- **`Dock`**: no `doLayout`, no `render`, no viewport listener, no geometry read,
  no rule write. Five identical passes over a 3-panel dock scheduled 0 sweeps and
  0 rAF callbacks (10).
- **`MenuBar` and `ToolBar`**: a settled pass issues no rule writes, no geometry
  reads and no non-empty style writes (12).
- **`LayerManager`**: zero DOM writes, zero geometry reads, no per-frame work
  (11).
- **`Animation.play`**: zero JS per animated frame; CSS-transition driven,
  inline-only writes, and `finish` clears `transition` so a later `transform`
  write is not retroactively animated (11).
- **`TreeBody`'s settled pass is byte-for-byte the flat `Body`'s** — 105 sink
  ops, 0 rule ops, 0 forced reads. The tree structure costs nothing per frame
  (22).
- **`layout/Table`** is clean on the render axis: 0 rule writes per pass, cached
  read-backs, a real calculate/commit split (08).
- **`MarkdownEditor`** has no `doLayout`, no size override, zero geometry reads,
  zero style writes on any layout path, and construction issues zero sink ops
  (24).
- **`CodeEditor`'s wrapper**: zero `DOM.source` geometry reads and no
  editor-owned style writes over 10 identical passes (23).

**Paths that are already economical**

- **`Tree`'s gutter-drag path**: 1 DOM write, 0 rule ops, 0 forced reads on an
  unchanged pass; a drag frame costs 29 writes for 26 pooled rows with zero
  `layoutChildren` and zero rebinds — the `virtual-row-view-resize-relayout`
  withholding works (18).
- **The table header's continuous-motion paths**: a column-resize drag frame
  costs 0 stylesheet-rule mutations and 0 forced reads over 10 frames; an
  unchanged pass costs 0 header-cell `doLayout`; a sub-column horizontal scroll
  that does not move the window reconciles nothing (20).
- **`Table.onColumnResize`** does pure arithmetic, ends at `scheduleLayout()`,
  and early-returns before scheduling when the drag is in the dead zone — the
  third in-repo precedent for the no-op-frame skip, after `Accordion` (19, 20).
- **The cell editor pool actually pools**: a steady-state open is 8 sink ops and
  0 rule ops, a close is 5 and releases cleanly, and an open editor adds nothing
  to a settled pass or a scroll tick (22).
- **Scroll rebinding is minimal**: a one-row vertical tick calls `Row.setData`
  exactly once, not once per pool slot; the column-window slide fast path touches
  only the entering and departing cells, and `Row._cellCache` makes a
  narrow-then-widen cycle allocate nothing (19, 21).
- **No stylesheet-rule mutation is reachable on any per-frame path in the
  table** — row tinting goes through class tokens against shared rules, and
  `Cell.setBaseBackground` routes through a shared value-class rule rather than
  materialising an `#id` rule per recycle (19, 21).
- **`Button` press/release costs one class toggle; idle hover costs zero sink
  ops; a plain `Button` or `ToggleButton` materialises zero per-instance
  stylesheet rules** (13). Hover appearance is pure CSS via `ownStyleStates`, so
  hovering the menu bar or tool bar writes nothing (12).
- **A keystroke in a `TextInput` costs one sink op and zero layout, rule or
  geometry work; focus in/out is entirely CSS** (15).
- **`Checkbox`/`RadioButton` flips write no stylesheet rule**, and `Binding.commit()`
  writes nothing (15).
- **`FileDropZone.onDragOver` is deliberately empty**: 20 `dragover` events cost
  zero sink ops (16).
- **`DatePickerDropdown.onDateSelected` costs zero sink ops and zero layout
  passes**; `TimeColumns`/`PickerColumn.setSelectedValue` rebind in place
  (17).
- **An open picker dropdown costs the host zero per-frame work** — `Position.FIXED`,
  `LayerManager`-mounted, outside the parent's layout tree, and `LayerManager`
  registers no resize or scroll listener (17).
- **`Card` undisplays the inactive child with `display: none`**, not
  `visibility: hidden` — so a `MarkdownEditor` in WYSIWYG mode and a
  `DynamicCell`'s inactive renderers leave the render tree entirely (21, 22, 24).
- **The day grid batches its text measurement**: 31 of 32 `measureText` calls
  come from a single `measureTexts` (17), unlike the tree renderers.
- **The list renderers already use the correct lazy `_measured` pattern** that
  lets the framework's batch form (18).
- **`GlyphRenderer.setValue` is guarded**, which is what keeps the glyph rebuild
  cost out of the table rebind path (21).
- **The `merged` September fixes still hold**: `ScrollStrip`'s clamp-signature
  gate makes a settled strip silent; `undisplay-inactive-tab-pages`,
  `collapsed-panes-leave-render-tree` and the scroll-shadow edge strips are all
  confirmed in place by the slices that checked them.
- **`ensureMarkdownEditorClassRules()` is a module singleton** that inserts 20
  rules once per document (24) — the shape `codeEditorTheme()` should adopt.
- **No `backdrop-filter` anywhere in the library** (09). Do not let a "frosted
  glass" backdrop land without a WebKitGTK measurement.
- **`core/OverlayPosition.ts` is pure and exhaustively tested**, and is now the
  single placement vocabulary for `Tooltip`, `Menu`, `PopupPanel` and
  `AnimatedDropdown` (11, 12).
- **`ColumnFilter.ts` is a pure module** with no `core/` import, no DOM and no
  component — which is why the filter model can be unit-tested and
  worker-serialised (20).

---

## Dead code, duplication, and unused API

### 2026-08-29 health-audit items the campaign confirmed **closed**

| Audit item | Evidence | Slice |
|---|---|---|
| P1 #3 — `FieldSet`/`LabeledFieldSet` leak their `Legend` | `component/container/FieldSet.ts:274-278` disposes `_legend`; `dispose-full-teardown.test.ts:439` covers it | 14, 28 |
| P1 #7 — `round-layout-coordinates` breaks gap-free adjacency | `roundedExtent` (`core/Component.ts:307-323`) derives the extent from the rounded origin; the "device pixel" JSDoc error is gone | 01, 06 |
| P1 #12 — keyboard Enter drops the boolean menu row's `"action"` | `AbstractBooleanMenuRow.ts:132-139`; pinned by `MenuRow.test.ts` A1–A6/R1–R14 | 12 |
| P1 #12 (Checkbox half) — synthetic click on the wrong element id | `Checkbox.ts:450-454` fires on the root, where `on("action")` registers | 15 |
| P2 #1 — two ~150-line duplicated windowed reconcilers in `Header.ts` | `reconcileWindowedRow<TCell>` + `reconcileWindowedRowSlide<TCell>` + `WindowedRowHooks` is exactly the extraction asked for; both paths now route per-column state through one `hooks.apply` | 20 |
| P2 #2 — `RadioMenuRow` is a ~105-line uncredited copy of `CheckboxMenuRow` | `AbstractBooleanMenuRow.ts` (297 lines) owns everything; the two subclasses are 75 and 79 lines | 12 |
| P2 #4 (partial) — Accordion's viewport-listener `dragend` workaround | `Accordion` now consumes `SplitGutter`'s own `"dragend"` (`:1769`); `grep beginViewportDrag|mouseup` → 0 | 06 |
| P2 #6 — `Menu.open()` hand-rolls the `OverlayPosition` primitives | `Menu.ts:646`/`:662-666` route through `positionAdjacent` and `positionAnchoredFlexible` | 11, 12 |
| P2 #7 — `MarkdownViewer`/`DocsContent` duplicate ~60 lines of scroll tracking | `HeadingScrollTracker` exists and both hosts delegate; ~8 lines of per-host wiring remain and are correctly not shared | 25 |
| P2 #8 — two exported `AxisOrientation`s with incompatible unions | both duplicates gone; `primitive/Axis.ts:13` is the single declaration | 28 |
| P2 #9 (partial) — `range()` triplicated in `Body`/`Row`/`Header` | all three call `Util.range`; `grep "function range" component/table/*.ts` → 0 | 19, 20 |
| P2 #10 (partial) — per-pooled-row `getVisibleRecords()` in the table | `Body.ts:1716-1738` takes `records` as a parameter; pinned by `VisibleRecordQueryEconomy.test.ts`. The per-**pass** calls remain — see 19 F19.2 | 19 |
| #4 — `ComboBoxLabel` leaks its renderer | `ComboBox.ts:617-621` disposes `_renderer`; `SelectableListRow` and `LabelListItemRenderer` got the same | 16, 18 |
| #11 — `CodeEditor.syncAutoHeight` strands an uncommitted height | the `desired === previousHeight` branch (`:2537-2551`) now re-commits before returning | 23 |
| P3 — `ResolvedStyleBag`/`ResolvedStyleState` orphan exports | both now module-private | 02 |
| P3 — `Component.getCSSRule()` / `clearPosition()` | 0 grep hits | 01 |
| P3 — `SCROLL_SHADOW_EXTENT_PX` / `SCROLL_SHADOW_RAMP_PX` orphan exports | both module-private (`ScrollShadow.ts:31,41`) | 04 |
| P3 — `OverlayPosition.ts` orphan exports | `AnchorAxis` gone; `AnchorOptions`/`FlexiblePlacement` module-private | 11 |
| P3 — `AbstractCalendarDropdown.ts`'s 17-symbol export block, `PICKER_HEADER_HEIGHT`, `TimeColumns.ts:192` | export block down to 2 used symbols; the other two have 0 hits | 17 |
| P3 — `SelectableListRow` exported without `callable()`; `AbstractSelectableList.getIndex()` | class is module-private; `getIndex` has 0 hits | 18 |
| P4 — `Panel.ts` prose citing `_overlayHost` | 0 hits | 04 |
| P2 #6 (Item 6) — `LayoutManager`'s clamp lets max beat min | `resolveBounds` applies max then min as two independent `if`s, so min wins | 05 |
| — `windowControls.ts` claims a helper shared by two consumers when one remains | both `createWindowControlButton` and `setWindowControlsActive` have two consumers | 09 |
| — Slice 18's own findings 1 and 2 (`TreeRow`/`SelectableListRow` renderer leaks) | both have destructors; `syncRows` pairs `removeComponent` with `dispose()` | 18 |

**No audit item lands in slices 22 or 24** (grepped; 0 hits).

### 2026-08-29 audit items still **open**

- **P2 #4 (rest)** — `Split` and `Accordion` mirror the same drag, clamp and
  weight-pin mechanics. Slice 06 F06.10 tables all seven method pairs and slice
  08 F08.7 gives the `Accordion` side of each. The smallest useful extraction is
  the rAF drag-frame buffer (`schedule`/`flush`/`cancel`), which both `Split` and
  `Accordion` re-implement verbatim and which five other sites hand-roll as well
  (`ScrollStrip`, `Panel`, `VirtualRowView`, plus `AbstractWindow`'s
  `PerFrameCoalescer`, the one clean documented version — `overlay/AbstractWindow.ts:238-327`).
  The clamp/weight halves genuinely differ in convention and should not be merged.
- **P2 #5** — `Panel` and `VirtualScroller` still duplicate the scrollbar-layout
  algorithm, the `setShadowEdge` wrapper, the shadow-host construction and the
  edge-ramp sequence (04 F04.7). The shared parts (`ScrollShadowEdges`,
  `scrollShadowRamp`, `quantizeShadowEdge`, `appendScrollShadowStrips`) already
  moved to `core/ScrollShadow.ts`. **This contradicts the open
  `overlay-scrollbars-non-panel` plan**, whose Architecture Decisions state
  neither class is migrated onto the helper — see section 8.
- **P2 #9 (rest)** — `WindowBorder`/`SplitGutter` share the `dragCursor()` +
  `beginViewportDrag`/`endViewportDrag` lifecycle shape but not the code
  (09). `DiagramView`'s viewport↔graph inversion is written out **five** times,
  not the three the audit counted (27 F27.14).
- **P3** — `component/chart/ChartAxis.ts:41` `AxisRenderOptions`: 0 hits
  outside its own file (26, 28).
- **Docs links** — `/api/overlay/variables/DragManager` ×6: two are in
  `DragGhost.ts:37`/`DragFeedback.ts:27`; the other four are in `TreeBody.ts`,
  `TreeTable.ts` and `Component.ts`. Plus `Drawer.ts:135`'s `LayerManager` path
  and `Drawer.ts:139`'s link to `DialogBackdrop`, which has no API page and must
  become prose (10).
- **Stale plan citation** — `DiagramEdgeLayer.ts:107` cites a
  `fk-diagram-cardinality-and-index-coverage` plan; `grep` over `plans/` → 0 (27).
- **Duplicate constants** — `TOGGLE_WIDTH = 20` in `component/tree/TreeRow.ts:21`
  and `component/table/cell/renderer/TreeCell.ts:16`, each commenting that the
  other must be kept in lockstep (18, 21). `DEFAULT_INDENT_PX = 16` is exported
  from `TreeCell.ts:19` and re-declared locally in `TreeTable.ts:12` (21). The
  list row height 22 is declared four times (18). `TAB_FADE_DURATION_MS` and
  `SCROLL_ARROW_STEP` are each declared twice (07). `ICON_WIDTH`/`iconSizePx()`
  are byte-identical in the list and tree glyph renderers (18). `SVG_NS` is
  declared in four modules (26, 27).
- **`updateHeight()`** — the audit's six copies are now four
  (`TextField.ts:75`, `AbstractPickerField.ts:292`, `ComboBox.ts:884`,
  `NumberSpinner.ts:285`), plus a fifth inline site at `layout/Table.ts:212`.
  The per-caller one-line height expression is an accepted decision; the
  **constructor pair** `this.updateHeight(); this.subscribeTheme(() => this.updateHeight());`
  repeated verbatim four times is not (15, 16, 17).

### Dead or unreachable code found by this campaign

Grep counts are from the owning slice; each excludes `packages/lib/dist/` and the
generated `packages/lib/docs/api/`.

**Zero callers anywhere**

| Symbol | Where | Slice |
|---|---|---|
| `Component.sync()`, `hasElementAttribute`, `getElementAttribute`, `getAutoCommitAttributes`, `doChildrenComponentLayouts`, the `verticalAlign` trio + `_verticalAlign` | `core/Component.ts:6657`, `:1686`, `:1703`, `:1837`, `:7194`, `:579/:748/:3851-3880` | 01 |
| `StyleTarget.hasQueuedWrites()` | `core/StyleTarget.ts:96` | 02 |
| `Event.init()` — an exported no-op | `core/Event.ts:370-375` | 03 |
| `Scrollbar.setArrowsEnabled` + `disposeArrows`; `SmoothScroller.isAnimating()` | `component/container/Scrollbar.ts:900`, `:692`; `core/SmoothScroller.ts:188` | 04 |
| `Fit.getComponent()`; `LayoutConstraints.description`; `BoxLayout.overflowSizing` and its whole option/getter/setter/read chain; `VFlowColumn.cells[].baseline`; `LayoutManager._defaultPreferredSize`/`_defaultMinSize`/`_defaultMaxSize` (3 reads, 0 writes) | `layout/Fit.ts:154`; `LayoutConstraints.ts:16`; `BoxLayout.ts:40/111/133/177/289/303`; `VFlow.ts:342`; `LayoutManager.ts:48-50` | 05 |
| `Tab.isEmpty()`, `isBarIgnoreParentInsets()`, `getDetachWindowMode()`; `BarEntry.contextMenuListener` (written, never read); `TabBar`'s `HBox` over a component that never has box children | `layout/Tab.ts:786`, `:812`, `:836`; `TabBar.ts:213`, `:601` | 07 |
| `Accordion.getChevronSide`/`getToolsVisibility`/`getChevronGlyph`; `AccordionHeader.getChevronSide`/`isExpanded`; `TableLayoutOptions` (empty interface) | `layout/Accordion.ts:445/674/475`; `AccordionHeader.ts:337/309`; `layout/Table.ts:19` | 08 |
| `AbstractWindow.getResizeFps`, `modifierStillHeld` (a one-line alias of `modifierMatches`), `onMouseDown`; `WindowBorder.isSnapTarget`, `setDirection`, `WindowBorderOptions` and its whole `listeners` bag; `DialogBackdropOptions`; `TabWindow.isChromeComponent` (overrides the base to return the base's default); `WindowHeader._closeable`/`_minimizable`/`_maximizable` and their four getters | `overlay/AbstractWindow.ts:2161/3280/2034`; `WindowBorder.ts:225/154`; `DialogBackdrop.ts`; `TabWindow.ts:320`; `WindowHeader.ts:104-106` | 09 |
| `ReorderIndicator` — no drop target in the library returns a number from `onDragOver`, yet it is constructed per gesture and `detach()`ed per drag frame, each detach costing a `getElementById` | `overlay/ReorderIndicator.ts`; `overlay/DragManager.ts:388`, `:576-581` | 10 |
| `DragManager.ghostFactory` (0 users, 3 runtime duck-type probes, one per raw mousemove); `DropTargetOptions.feedbackHost`; `DragGhost`'s `_label`, its `doLayout` override and `TabDragData.label` — the default ghost is an empty 160×28 box and neither documented behaviour exists | `overlay/DragManager.ts:96/642/471`; `overlay/DragGhost.ts:49/119-132` | 10 |
| `Popover.clearActions()`; `AnimatedDropdown.onShowComplete()` (a documented extension point with no implementor) | `overlay/Popover.ts:443`; `core/AnimatedDropdown.ts:218` | 11 |
| `ToolBarOptions.overflowSide` and its `"start"` branch; `MenuItemOptions` + `MenuItem`'s 5th constructor parameter + its whole `applyOptions`; `MenuRow.closeMenu()` (injected per factory row, never called); `Menu.setMenuWidth`; `MenuItemConfig.icon`; the `--ts-ui-toolbar-padding`/`-gap` theme tokens | `component/menubar/ToolBar.ts:48`; `MenuItem.ts:29/228/362`; `MenuRow.ts:222`; `Menu.ts:534`; `MenuItem.ts:93`; `core/Theme.ts:1187-1188` | 12 |
| `Button.setDescriptionUnderGlyph`/`isDescriptionUnderGlyph` (the sole reason `_outerColumn`/`_innerRow` and one of three `_rebuildContentRow` branches exist); `getPressedBorderRadius`, `getHoverBorderRadius`, `getHoverForegroundColor`, `clearPressedForegroundColor`; `Glyph.getAnimated`/`clearAnimated`; `Image.getPreferredSize` (a pure `super` call); the three `glyphs/<style>/index.ts` barrels (0 importers in-repo) | `component/button/Button.ts`; `component/display/Glyph.ts`; `Image.ts:787`; `glyphs/index.ts` | 13 |
| `Text.getElement` (verbatim delegation), `clearTextShadow`, `getWordBreak`, `getLineClamp`, `setFontKerning`/`setFontVariant`/`setFontStretch`/`setFontSizeAdjust` (whose class-tier declarations still widen the library's widest selector); `StatusBar.removeLeft`/`removeRight` (byte-identical and both dead); `PaginationBarOptions.totalCount` (declared, never honoured) | `component/input/Text.ts`; `component/container/StatusBar.ts:218/232`; `PaginationBar.ts:25` | 14 |
| `Slider.showTicks` + `setShowTicks`/`isShowTicks` (never rendered; the JSDoc admits it); `Binding.removeValidation`, `getValidateOnChange`; `FieldValidationConfig.validateOnChange` (write-once `false`, making its `||` branch unreachable) | `component/input/Slider.ts:26`; `core/Binding.ts:362/410`; `validation/ValidationRule.ts:35` | 15 |
| `ComboBoxDropdown.getMinWidth()`; `HiddenFileInput._multiple`/`_accept` and its dead `init()` replay | `component/input/ComboBox.ts:348`; `FileField.ts:150-182` | 16 |
| `PickerColumnHeader` (a dead export); `applyDateMath` (no production caller) | `component/input/PickerColumn.ts:71`; `dateMath.ts:87` | 17 |
| `Tree.getRendererFactory()`; `Tree.collapseAll()` documented but absent; `Tree` has no `PageUp`/`PageDown` though `VirtualRowView.computePageSize` exists for it | `component/tree/Tree.ts` | 18 |
| `Row.addColumn`, `Body.setRowIndented`, `Body`'s `"verticalscroll"` event (one test consumer) | `component/table/Row.ts:341`; `Body.ts:788`, `:38` | 19 |
| `ResizeHandle`'s whole `"dragend"` event (emitted, zero registrations); `SortPriorityBadgeOptions.priority` / `FilterClauseBadgeOptions.count` and the two `applyOptions` overrides that exist only to serve them; `Column.setHeaderGlyph`/`clearHeaderGlyph` (a write-only API — mutating a `Column` has no rendering effect); `TableHeader.getModel()` | `component/table/cell/ResizeHandle.ts:15/160/192/212`; `SortPriorityBadge.ts:15`; `Column.ts:188`; `Header.ts:379` | 20 |
| `GroupSeparatorCell.getColor()` + `_color`; `ParentHeaderCell.getColor()`; `TreeCellRenderer.getDepth()`; `Cell`'s 5th and 6th constructor parameters (`editorContraints`, misspelled, and `subclassDefaults` — 0 of 16 call sites pass either); nine `setValue` overrides byte-equivalent to the inherited one; three identical `commitEdit` overrides | `component/table/cell/` | 21 |
| `Date`/`Time`/`DateTimeEditor`'s `setDropdownAnimated`/`isDropdownAnimated` (6 dead methods, 3 dead fields, so `_animated` is permanently `true`); `TreeBody.getIdField`/`getParentField`/`getTreeColumn`; `TreeTable.addRowReparentListener`/`removeRowReparentListener` and the whole `_rowReparentWrappers` map; `NumberEditor`'s `AnchorType.NORTHEAST` constraint (inert under `Fit` + `FillType.BOTH`); `TreeBody.expandAll`'s roots loop (provably redundant — every parent with children is already a `_childIds` key) | `component/table/cell/editor/`; `TreeBody.ts`; `TreeTable.ts:394` | 22 |
| `CodeEditor.autoHeightMinRows`, `highlightWhitespace`, `moveCursorToEnd`, the `"readonlyedit"` event (0 listeners anywhere, yet its flash overlay is mounted in every editor for life) | `component/editor/CodeEditor.ts` | 23 |
| `MarkdownEditor.setContentEditable`/`getContentEditable` (undocumented facades, test-only) | `component/editor/MarkdownEditor.ts:2220/2231` | 24 |
| `HeadingScrollTracker.getHeadings()` (test-only); `MarkdownOptions.fontScale`, `showMinimap`, `showControls`, `maxHeadingDepth` (0 consumers outside the lib's own tests) | `component/display/` | 25 |
| `PlaybackEngine` (one implementor, zero consumers — a documented speculative seam); `maxFps`, `animateWhenHidden`; `ChartLegend._rows` shadowing `getComponents()` | `component/display/`, `component/chart/` | 26 |
| `DiagramEdgeData.label` (mapped nowhere, rendered nowhere); `ElkConstructorOptions.workerUrl` (1 hit, its own declaration) | `component/diagram/`, `elkjs.d.ts` | 27 |
| `rankInDirection` (public, 0 consumers); `FocusTraversal.enable()` (0 call sites in `packages/` — which is why C32 went unnoticed); `configure()` on all three focus services; `primitive/Point` (dead) | `core/SpatialNavigation.ts`, `core/FocusTraversal.ts`, `primitive/Point.ts` | 28 |

**Speculative generality with no production opt-in**

- `Component.release()` / `canRelease()` — ~90 lines plus a branch in `init()`
  and two fields every component pays for. `canRelease()` returns `false` for
  every class in the library; the documented use cases (an offscreen tab's
  content, a virtualized row) are implemented by neither `Tab` nor
  `VirtualRowView` (01 F01.12). Either land `Tab`'s inactive pages as the first
  consumer or retire the subsystem and its doc section — leaving it in the middle
  is what costs.
- `ElementAttributes`' batching half — `setAutoCommitAttributes`,
  `getAutoCommitAttributes`, `commitElementAttributes`, `queue`, `queueRemove`,
  `isMaterialized` — is documented as "off by default" and nothing turns it on
  (02).
- `core/Type.ts` — 14 of 16 exports have no caller outside their own test; the
  two live ones (`Type.isArray`, `Type.isBoolean`) have one call site each, and
  `Type.isInteger` duplicates `Util.isInteger` (03).
- `SpatialNavigation`'s whole `"target"` tier — `Component.setNavigationTarget(true)`
  has zero call sites in the library, the demo, the docs app or create-app, so
  `_lastFocus`, `recordOrigin`, `pruneStaleMemory`, `outermostTargets` and
  `targetLandings` (~180 lines) serve a candidate set that is always empty, while
  the *live* component tier pays `pruneStaleMemory` + `recordOrigin` on every
  move (28 F28.6). Land it or retire it — a user decision.
- `ToolBar`'s `overflow: "menu"` pipeline has zero in-library consumers, zero in
  Loom, and **zero tests**, yet it adds one full `Button.computePreferredSize`
  recursion per child per pass when enabled (12 F12.6). Decide whether to remove
  the feature before optimising it.
- `FooterRow` is constructed, mounted and unreachable: `Table.ts:321` sets
  `_footerVisible = false` and there is no `setFooterVisible`, so 132 lines and
  two live elements per `Table` exist for a feature nothing can turn on
  (20 F20.9).

**Convention violations worth one sweep**

- Eleven inline-arrow `Event` registrations in slice 16's files alone, plus six
  in slice 12's and two in slice 24's, against `ARCHITECTURE.md`'s "Listeners
  must reference a named function". Each allocates a closure `Event`'s
  same-reference dedup cannot match and `removeListener` cannot target.
- Six cross-component `Event` registrations in slice 16 (a component listening to
  another component's events), against the same document. Known debt with a
  named intended fix (widen typed `on("blur"|"keydown"|"input")` shorthands onto
  `TextField`).
- `TableExporter.download` holds `Blob` and `URL.createObjectURL` — the only two
  such calls in the library, against `ARCHITECTURE.md:130`'s rule that
  `core/DOM.ts` is the only module that touches or holds a reference to the real
  DOM. The `local/no-raw-dom` rule misses it because `Blob`/`URL` are not
  `Element`/`Node`. The consequence is that the export tests can only assert
  "one anchor was clicked", never the bytes (22 F22.15).
- `MenuSeparator` nudges itself with a CSS `margin` on an absolutely positioned
  component, against `ARCHITECTURE.md`'s *Positioning is always absolute* and
  *No cosmetic insets or padding*; the painted rule sits 4 px below where layout
  thinks it is (12).

---

## Proposed plan groups

Twenty-nine groups, ordered so the highest value-per-risk lands first and so
that groups sharing files do not run concurrently. Each is one coherent change
set with its own counter. Group numbers are ordering, not priority within a wave.

Slugs are kebab-case and suitable as `plans/<slug>.md`.

### Ordering constraints the reports established

These are not negotiable and a naive grouping trips on all five.

1. **G06 `progress-indicator-resize-relay` must land before G07's
   `Component.setSize` guard.** `ProgressSpinner`'s overlay is raw-appended and
   is in nobody's laid-out set, so the perpetual `setSize` → `scheduleLayout`
   loop is the *only* thing that resizes it with its target (14 F14.2). Adding
   the guard first would silently break overlay resizing.
2. **G21's `applyRequiredEmptyState` gate must land with, not before, the
   `_boundIndices` narrowing** — both are in G21 for that reason. The gate's
   correctness depends on `Body.onStoreChange` continuing to blank
   `_boundIndices` on every store event; narrowing that (19 F19.5) without
   gating together stops clearing a filled cell's tint after an edit
   (21 F21.7).
3. **G20's fix for `Event`'s per-mousemove ancestor walk must cover every
   subtree-listener registrant at once.** `SplitGutter` and `Accordion`'s two
   per section are the minimum; the full list is in X8. Fixing one leaves the
   walk installed and the number unmoved (08 F08.9).
4. **G12's no-op drag-frame skip is a port from `Accordion` to `Split`**, not a
   new design (08's correction to 06). Take `Accordion.layoutSections`'s
   `reflowAll || contentHeight !== oldHeight` gate and `onGutterDrag`'s dead-zone
   bookkeeping; do not invent a second mechanism.
5. **Three pending plans need amending before they run** — G01.

### G01 `pending-plan-amendments`

**Scope.** Amend or retire three plans in `plans/` before any of them is
implemented. Bookkeeping only; no source change.

**Covers.** 23 F23.4, 19 Redundant #8 + cross-slice, 13 F13.19, 04 F04.7.

**Files.** `plans/overlay-scrollbars-non-panel.md`,
`plans/table-column-pinning.md`,
`plans/button-primary-press-filtering-exploration.md`.

- `overlay-scrollbars-non-panel` — its step 5 specifies
  `doLayout() { super.doLayout(); this.commitElementStyle(); this._overlayBars?.layout(...) }`
  and its internal structure has `apply()` read `getScrollMetrics(scroller)`
  once. That is a style commit immediately followed by a live scroll-metrics read
  **inside `doLayout`, per visible editor per frame** — the exact shape that cost
  ~110 ms/frame in the `ScrollStrip` case. `CodeEditor.doLayout` today makes zero
  such reads, so the plan would introduce the regression rather than compound
  one. Do not contradict its architecture; add one requirement — `apply()` must
  carry a clamp-signature gate on the band `(x, y, width, height)` plus the last
  pushed metrics, so an unchanged band performs no read at all, with the plan's
  own `sync()` as the settle-frame catch-up. Its own expected-behaviour case 6
  already accepts read-skipping as a contract. Also note that slice 04's
  numeric-core extraction (P2 #5) composes with it rather than contradicting it:
  share the visibility/placement maths and the bar pair, not the scroller
  plumbing. And note that `MarkdownEditor` owns a `CodeEditor`, so a
  source-mode `MarkdownEditor` must be in the measurement set.
- `table-column-pinning` — every line reference into `Body.ts` and `Table.ts` is
  stale (the files have roughly doubled since drafting); it proposes adding
  `Body.setSelectedRecords(records)`, which already exists at `Body.ts:2285`;
  its claim that the right body "has `overflow-y: auto` (today's default)"
  contradicts `Body.ts:348`'s `setOverflow("hidden")`. Most importantly,
  `PinnedTable` owns two full `Table` instances over one store, so **every
  per-frame cost in slice 19 doubles under pinning** — two `renderWindowPass`
  runs, two `_updateFocusStyle` materialisations, two empty-apply fans, two
  `applyRequiredEmptyState` sweeps, two never-shown `FooterRow`s, two misplaced
  `will-change` hints. Re-base it on the current files and schedule it **after**
  G21, G22 and G23.
- `button-primary-press-filtering-exploration` — superseded by
  `plans/implemented/primary-button-interaction-filtering.md`; its line
  references no longer resolve and it proposes `createStyleRule(".pressed")`,
  which the class-hierarchy-cascade work replaced with declared class-tier
  states. Move it to `plans/implemented/` beside its successor or mark it
  superseded.

**Depends on.** Nothing. **Risk.** None. **Proof.** n/a.

### G02 `cell-editor-record-binding`

**Scope.** Stop an open cell editor from committing onto the wrong record, and
close the pool's ownership hole.

**Covers.** 22 F22.1, F22.17, F22.10 (C1, C13, and the latent pool guard).

**Files.** `component/table/Body.ts`,
`component/table/cell/editor/CellEditorPool.ts`, `component/table/cell/Cell.ts`.

**Depends on.** Nothing. **Do first** — it is silent data corruption.

**Risk.** Medium. It edits `bindAndPositionRows`, which G21 and G22 also touch,
so those must not run concurrently. No test drives a scroll while editing, so
nothing pins today's behaviour. The re-entrancy a mid-scroll commit causes is
already handled by `renderWindow`'s `_reconciling` guard.

**Proof.** Probe C1 asserting `WROTE_TO_WRONG_RECORD === false` and either
`editedRecordReceivedTheValue === true` (commit-first) or `cell.isEditing() ===
false` after the scroll (cancel-first); probe P1 asserting
`firstEditorDisposeCalls === 1` for a `register` over a live key.

### G03 `autocomplete-store-query`

**Scope.** `AutoCompleteField` filters in-process instead of mutating the
consumer's shared store, and clears both its timers on dispose through the DOM
seam.

**Covers.** 16 F16.5, F16.11 (C2, C5).

**Files.** `component/input/AutoCompleteField.ts`.

**Depends on.** Nothing. **Risk.** Low — no test exercises the store branch, and
`filterBy`/`clearFilter` have no other caller in the library. The plan needs an
Architecture Decision noting the deliberately dropped remote-filter capability;
a real one needs its own `queryFor(descriptor)` API, not a hijack of the shared
filter set.

**Proof.** Probe asserting 0 `datachange` and 0 `filterchange` emits and an
unchanged `getActiveFilters()` after a query; a 1,500-record case asserting the
suggestions still match; a type-dispose-advance-timers case asserting no throw.

### G04 `style-write-dedup-at-the-seam`

**Scope.** `StyleTarget` compares before it writes and batches `setMany`; the
empty-bag guard moves into the shared `flush()`; the sink and the attribute
buffers stop writing unchanged values.

**Covers.** X1, X6. 01 F01.6; 02 F02.1, F02.3, F02.11, F02.14; 03 F03.1, F03.6,
F03.7; 04 F04.10; 05 F05.12; 06 F06.6; 08 F08.6(b); 09 F09.4; 12 F12.1;
13 F13.8; 14; 18; 19 F19.1; 20; 21; 22; 25.

**Files.** `core/StyleTarget.ts`, `core/DOM.ts` (empty-patch short-circuit in
`ProductionDOMSink.apply`), `core/ElementAttributes.ts`, `core/Aria.ts`
(`setRole`/`setTabIndex` route through the guarded private `setAttribute`).

**Depends on.** Nothing. **Land first of the perf groups** — until it lands, the
same-valued rule writes dominate every drag-frame measurement and every other
group's numbers are noise.

**Risk.** High blast radius, low behavioural risk. Every style write in the
library goes through this class. `Component.pinStateStyle` must keep bypassing
the memo (never deduplicating is its purpose) and `applyStyle`'s
`removeAttr: ["style"]` wipe must clear it. Tests that count `apply`/
`setRuleStyles` ops need their expectations re-read, not relaxed:
`tests/core/StyleRuleBatchedFlush.test.ts` (cases 2, 9 and 18 all use *changed*
values, so a same-value filter does not break them),
`tests/core/ComponentBounds.test.ts:64-81`, `tests/dom/recorder.test.ts`, and the
`*.classStyleHoisting` / `*.styleRuleDisposal` suites, which observe op order.

**Proof.** Slice 03 probe P6: `emptyAppliesInPass` 200 → 0 over a 201-component
tree. Slice 19: empty applies per settled 14-column table pass 199 → 0. Slice 06
probe Q3b: rule declarations per unchanged Loom-shaped whole-tree pass 18 → 0,
and per gutter-drag frame 14 → 0. Slice 09 probe 09e: settled `Window` pass 43
applies + 1 rule write → 0 and 0. Then ms/frame on the 2×2 editor-grid
horizontal drag.

### G05 `resolve-bounds-lazy-size-reads`

**Scope.** `LayoutManager.resolveBounds` reads `getPreferredSize`, `getSize`,
`getMaxSize` and `getMinSize` only in the branch that consumes them.

**Covers.** 05 F05.1, F05.14; 06 F06.4(part); 07 F07.10(part).

**Files.** `layout/LayoutManager.ts`.

**Depends on.** Nothing. It has the best payoff-per-risk of any single method
in the campaign: behaviour is unchanged by construction (the values are provably unused on the branch being
skipped), it is contained to one method, and it removes one full recursive size
descent per child per frame from every manager in the library.

**Risk.** Low. Pinned by `LayoutManager.resolveBounds.test.ts` plus the `Fit`,
`Card`, `HBox`, `VBox`, `Grid` and `Border` suites — all outcome assertions.

**Proof.** Slice 05 probe R1: discarded size reads per pass, 16 → 0 for a
4-manager Loom chain and 40 → 0 for a 10-leaf `HBox`; probe P4: the leaf's
`getPreferredSize` per root pass 4 → 1, `getMinSize` 6 → 3.

### G06 `progress-indicator-resize-relay`

**Scope.** `ProgressSpinner`'s overlay tracks its target through a real resize
relay instead of a self-re-arming layout pass; `ProgressBar` and `Slider` stop
driving their children through the unguarded `Component.setSize`.

**Covers.** 14 F14.2, F14.9; 15 F15.2, F15.13.

**Files.** `component/display/ProgressSpinner.ts`,
`component/display/ProgressBar.ts`, `component/input/Slider.ts`.

**Depends on.** Nothing. **Blocks G07** — see ordering constraint 1.

**Risk.** Medium for the spinner: three live consumers (`TablePanel`,
`TreeTablePanel`, `DiagramView`) plus the demo, and
`tests/component/display/ProgressSpinner.test.ts` and
`tests/component/diagram/DiagramView.test.ts:3119-3164` pin `isOverlay()` and the
overlay geometry. Low for the other two — `Slider` does not depend on `setSize`'s
unconditional `scheduleLayout()` (probe: `selfSchedule = 0`, geometry stable over
10 passes).

**Proof.** Slice 14 probe: rAF callbacks per generation `[1,1,1,1,1,1]` →
`[1,0,0,0,0,0]`, plus a case asserting the overlay still resizes when the target
changes width. Slice 15: `Slider` applies per settled pass 13 → 1 and child
`scheduleLayout` calls 3 → 0.

### G07 `component-setter-guards`

**Scope.** The fifteen unguarded typed setters get a same-value early return,
with the comparison chosen so the setter's **side effects** are skipped too.
Includes `Component.setSize`, `setInsets`/`clearInsets`, `setBorder`,
`setWritingMode`, `setOpacity`, `setTransform`, `setClipPath`,
`setBackgroundImage`; `Button.setGlyph`, `setText`, `setTextAlign`,
`clearDescription` (with the missing dispose); `Text.setText`;
`Component.setValueStyleState`'s token guard; `RovingTabIndex.moveTo`'s no-op
guard; `Aria.clearLabel`.

**Covers.** X2, X5's guard half. 01 F01.5, F01.7; 02 F02.6, F02.7; 04 F04.1,
F04.12; 07 F07.3(2,3); 08 F08.1(general), F08.10; 09 F09.9, F09.12; 12 F12.8,
F12.9; 13 F13.1, F13.3, F13.7, F13.13; 14 F14.1(2), F14.11, F14.12;
15 F15.14; 16 F16.10; 17 F17.7(styling half); 18 F18.5(1); 20 F20.2(4), F20.3,
F20.4(2), F20.7; 21 F21.1; 25 F25.7(guards); 26 F26.3; 28 F28.8.

**Files.** `core/Component.ts`, `component/button/Button.ts`,
`component/input/Text.ts`, `core/RovingTabIndex.ts`, `core/Aria.ts`.

**Depends on.** G06 (the `setSize` guard). Shares `core/Component.ts` with G09,
G10 and G16 — sequence, do not parallelise.

**Risk.** Medium-high by reach. `Button.setGlyph`'s guard is safe because
`Glyph` names are immutable by design, so name equality is an exact identity
test; the 23 call sites include none that relies on a same-name swap as a
refresh. `setBorder` must compare the four resolved side strings, not object
identity. `setInsets` must compare the four numbers. `setShowText`'s guard
interacts with `applyOptions`' deliberate re-dispatch and needs a force
parameter or a different resync hook (13 F13.13). One test spies
`FilterCell.prototype.setOperators` with `toHaveBeenLastCalledWith` and needs
re-pointing at the rendered face (20).

**Proof.** `ensureStyleRule + deleteStyleRule === 0` for `setGlyph(currentName)`;
`scheduleLayout` not called for `setTextAlign(currentValue)`; `apply` ops per
identical `setText` 3 → 0; `setRuleStyles` per repeated `setBorder` with an equal
spec 1 → 0; attribute writes per identical `Tab` pass 6 → 0; `setRuleStyles`
across 10 error-free `clearError()` calls 10 → 0. Then rule writes per frame
under a `ScrollStrip` overflow scenario 4 → 0, and `setRuleStyles` per
`timeupdate` on a playing `VideoPlayer` 6 → 0.

### G08 `environment-read-caching`

**Scope.** Stop forcing a document layout to read values that are either
constant or already known: the viewport size, theme variables, the pre-connect
border estimate, and `Body`'s own element. Also reorder `AbstractWindow.show()`
to mount before it lays out.

**Covers.** X9, X10. 01 F01.4; 03 F03.2, F03.5, F03.15; 09 F09.1, F09.6, F09.7,
F09.8; 12 F12.3(viewport half); 15 F15.6; 16 F16.12; 17 F17.4(detached half).

**Files.** `core/DOM.ts`, `core/Component.ts` (`getBorderSize`),
`core/BorderWidths.ts`, `core/Body.ts`, `overlay/AbstractWindow.ts`,
`overlay/Dialog.ts`, `component/container/DialogBackdrop.ts`,
`component/input/TextField.ts`.

**Depends on.** Nothing. Shares `core/Component.ts` with G07 — sequence.

**Risk.** Low-medium. The `getViewportSize` reorder changes the returned number
only on an engine where `innerWidth < clientWidth` (mobile pinch-zoom); the
current `Math.max` already prefers the larger. The `getThemeVar` memo must be
cleared on theme change — `core/BorderWidths.ts:112` already registers the hook.
Moving `LayerManager.mount` above `doLayout()` in `show()` has no ordering
dependency on `bringToFront` or the viewport listener, and no test asserts the
order. `DialogBackdrop`'s `inset: 0` change deletes `resize()` and both its call
sites, one of which is `Drawer`'s.

**Proof.** Slice 01 probe PL: `getThemeVar` per detached 4-node pass 152 → ≤ 4.
Slice 09 probe 09b: `getThemeVar` during `show()` 516 → ≤ 5; probe 09c test 4:
forced flushes per resize event with 4 minimized windows 32 → ≤ 2; probe 09c
test 3: `getViewportSize` per dialog resize event 3 → 0. Slice 15: `getThemeVar`
per `new TextField()` 8 → ≤ 4. Slice 03 probe P1:
`viewportReadsForOneEvent` 2 → 1. Then a WebKitGTK Timeline recording of a
window drag-resize counting Recalculate Style / Layout entries per `resize`
task.

### G09 `unchanged-subtree-layout-skip`

**Scope.** `LayoutManager.commitBounds` computes `changed` from the four setters
and recurses only when `Component.applyBounds`'s gate would; the container types
on Loom's hot path opt into `canSkipUnchangedLayout()`.

**Covers.** X3. 01 F01.1; 04 F04.2(second half); 05 F05.3; 07 F07.10; 11 F11.12;
14 (the leaf list); 15; 18 F18.2(1); 23 F23.12; 25; 26.

**Files.** `layout/LayoutManager.ts`, `core/Component.ts`, plus one
`canSkipUnchangedLayout()` override per opted-in class.

**Depends on.** G04 and G07 (so the measurement is not swamped by rule writes and
unguarded setters). Shares `core/Component.ts` with G07 and G10.

**Risk.** Highest in the campaign — every layout manager. The three known hazards
and their existing escape hatches are in 01 F01.1; `Cell`'s own doc comment
(`component/table/cell/Cell.ts:230-254`) is the model writer audit for each
opted-in class. Stage it: keep the base default `false` and opt in `Panel`,
`Container`, `Tab`'s pages, `Dock`'s regions, `Tree`, `SelectableListRow`,
`Notification`, `CodeEditorSearchPanel` and `Markdown` first. Pinned by
`tests/core/ComponentBounds.test.ts` cases 5-10,
`tests/component/table/CellLayoutSkip.test.ts`, `Body.test.ts:460`, and the
`ResizeLayoutEconomy` suites.

**Proof.** Slice 01 probe PC: `doLayout` calls below the root on a second
identical pass `[1,1,1,1,1]` → all zero. Slice 05: a second identical pass over
the 31-component S1 tree calls `doLayout` on fewer than 30 descendants. Then
ms/frame on the 2×2 editor-grid horizontal drag, and the `DiagnosticsOverlay`
layout-passes-per-second reading during a gutter drag.

### G10 `content-clamp-opt-out`

**Scope.** Components that are force-sized by their parent override
`clampsToContentSize()` to `false`; `Component` resolves the clamp bounds once
per rectangle instead of four times.

**Covers.** X4(b,c). 01 F01.2(tier 1); 19's transferable lever; 21 F21.2;
17 F17.12(local half).

**Files.** `core/Component.ts`, `component/table/cell/renderer/CellRenderer.ts`,
`component/input/AbstractCalendarDropdown.ts` (the two cell classes),
plus the leaf display components slice 14 lists.

**Depends on.** G07 (shares `core/Component.ts`). Independent of G09, and its
number should be taken **before** any general size-hint memo lands, because it
removes two thirds of the traffic that memo would otherwise cache.

**Risk.** Medium. The behavioural change is that a component handed less than its
content minimum clips instead of overflowing — which is what the table already
does one level up. `CellEditor extends Component` directly, not `CellRenderer`,
so `BooleanEditor`'s 16×16 hard max is untouched. Check
`ColumnWidths.test.ts` (auto-size derives widths from sampled text, not from a
live renderer's min) and `content-box-containment.test.ts:576-607`.

**Proof.** Slice 21 probe P21.14: renderer `getMinSize`/`getMaxSize` per
width-changing frame 270 each → ~90 each, with the `Text` figures following;
total size-hint calls 1,710 → ~570. Then ms/frame on the 2×2 editor-grid drag
with a table pane open.

### G11 `box-layout-per-pass-gather`

**Scope.** Each box, flow and grid manager gathers every child's
`(preferred, min, max, baseline, constraints)` once per resolve phase and threads
the values through; `Grid` stops running discarded `measureContent` sweeps;
`getLaidOutComponents` stops allocating.

**Covers.** X4(d). 01 F01.2(tier 2), F01.3; 05 F05.2, F05.4, F05.7, F05.8,
F05.11, F05.13; 06 F06.5; 12 F12.11; 17 F17.12; 28 F28.10 + the `Grid`
cross-slice note.

**Files.** `layout/LayoutManager.ts`, `BoxLayout.ts`, `HBox.ts`, `VBox.ts`,
`Grid.ts`, `HFlow.ts`, `VFlow.ts`, `Fit.ts`, `Border.ts`, `core/Component.ts`.

**Depends on.** G05 (needs `resolveBounds` to accept pre-read hints) and G09
(so the gather is measured against the reduced node set). Largest layout change;
run last of the layout set.

**Risk.** High. The hazard is a child whose size changes between gather and
commit within one pass — today reachable only through a nested `HFlow`/`VFlow`
publishing a new wrapped extent, which already relays through
`notifyIntrinsicSizeChanged` and lands on the next frame. The whole
`tests/component/layout/` suite plus `ResizeLayoutEconomy*` pins it.
**Coordinate with `plans/two-phase-baseline-resolution.md`** — see the
correction in X4: a per-phase gather is narrower than the per-pass metrics cache
that plan forbids, and it makes that plan's extra `getBaselineMetrics()` sweep
close to free rather than additive. Get the plan author's agreement first.

**Proof.** Slice 05 probe S1: total size queries over a 31-component unchanged
pass 1,081 → below ~150, and filtered-array allocations 104 → below ~40. Slice 06
probe T1: `getPreferredSize`/`getMinSize` per `Border` region per pass 5/8 → 1/1.
Slice 28: `LabeledGrid` size queries for 16 children 160 → ~32. Then ms/frame on
the 2×2 editor-grid drag and on the empty-project idle drag (today ~52).

### G12 `split-border-drag-economy`

**Scope.** A `Split` or `Border` pass that changes nothing writes nothing and
lays nothing out: port `Accordion`'s no-op drag-frame gate to `Split.onDrag`,
gate `recalculateSizes` on a change signature, give `Border` a per-pass region
record, guard `CollapseButton`'s two writers, skip the `setClipPath` call when
the resolved value is unchanged, and skip non-moving participants in the collapse
animation.

**Covers.** 06 F06.1(call-site half), F06.2, F06.3, F06.4, F06.5, F06.9, F06.11;
08 F08.7(the ported gate); 09 F09.4(the `Border` half).

**Files.** `layout/Split.ts`, `layout/Border.ts`, `layout/CollapseSupport.ts`,
`component/container/CollapseButton.ts`, `component/container/SplitGutter.ts`.

**Depends on.** G04 (the seam memo removes the rule writes; this removes the
calls and the layout passes underneath them). Ordering constraint 4 applies.
Shares `SplitGutter.ts` with G20 — sequence.

**Risk.** Medium. `Split.test.ts` has ~40 cases pinning weight pinning, seeding,
live min/max and refill; the signature gate must not skip a pass whose min/max
changed, which the cached `[min, max]` pair covers. `CollapseSupport`'s collapse
animation is pinned by three suites including
`Split.collapseUndisplay.test.ts`'s "a sibling's toggle does not prime the
cross-fade on a collapsed-and-undisplayed pane", which already points the way
this change goes.

**Proof.** Slice 06 probe R1: `doLayout` calls across three over-travel drag
frames 6 → 0. Probe Q5: `getMinSize`/`getMaxSize` per pane per unchanged pass
4/4 → ≤ 1/1. Probe Q3b: rule declarations per unchanged whole-tree pass 18 → 0.
Then ms/frame on a real WebKitGTK recording of a sidebar drag held past the
minimum.

### G13 `accordion-pass-economy`

**Scope.** An `Accordion` layout pass writes nothing to the stylesheet and
measures each section once: move `applyContainerTheming` out of `doLayout` into
`attach`, gate the shrink/fill seed on a section actually needing seeding,
memoise `openContentHeight` for the pass, reorder the `matchMedia` conjunction,
guard the runtime setters, and make `detach` release what `attach` wrote.

**Covers.** 08 F08.1, F08.2, F08.4, F08.5, F08.10, F08.11, F08.14.

**Files.** `layout/Accordion.ts`.

**Depends on.** G04 for the measurement to be clean. Independent of G12 in
content, but both are measured on the same Loom sidebar drag, so sequence them.

**Risk.** Low-medium. No test pins the container's border.
`Accordion.resizable.test.ts` is the gate for the seed change, including the
"turning resizable on is visually seamless" seeding behaviour that must keep
working on the first pass.

**Proof.** Slice 08 probe E2: rule declarations per unchanged pass 4 → 0; probe
D1: declarations per `Split`-gutter-drag frame on the Loom shape 4 → 0. Probe
E1b: size reports per open section per settled resizable pass 2 pref + 3 min +
3 max → 0/1/1. Probe A3: `matchMedia` per pass 1 per open section → 0.

### G14 `accordion-closed-section-render-tree`

**Scope.** A settled closed section leaves the render tree, as `Split`, `Border`
and `Tab` panes already do.

**Covers.** 08 F08.3, plus F08.8's `SplitGutter` `setDisplayed` swap.

**Files.** `layout/Accordion.ts`, `component/container/SplitGutter.ts`,
`packages/lib/docs/layouts/Accordion.md`.

**Depends on.** G13 (so the seed-pass noise does not mask the gain).

**Risk.** Highest in the Loom-shell set. It must be gated on "closed **and** no
animation entry for this index" — the closed section's preferred-height content
is load-bearing *during* a close animation. Use
`plans/implemented/collapsed-panes-leave-render-tree.md`'s Architecture
Decisions as the hazard checklist: content-clamp suspension via
`Component.setContentClampSuspended`, `captureSubtreeScroll` guarded on
`isEffectivelyVisible()`, snapshot-backed size reports, `detach` putting recorded
children back by `isDestroyed()`. Gates: `Accordion.manager.test.ts`'s "a closed
section contributes only its header height to both reports" and "a non-displayed
section contributes neither header nor content nor gap", plus all of
`Accordion.resizable.test.ts`.

**Ship the cheap increment first**: skip only the reflow and the
`getPreferredSize` for a *settled* closed section, leaving it in the render tree.
That alone removes a full `Tree` layout per closed section per frame and is
measurable on its own.

**Proof.** A probe asserting 0 `doLayout` and 0 `getPreferredSize` on a settled
closed section across three `Split`-gutter-drag frames (today 3 and 3), then
ms/frame on the Loom sidebar drag with the file tree collapsed versus open, in a
WebKitGTK recording.

### G15 `tab-strip-pass-economy`

**Scope.** The tab strip re-applies only what changed: a per-pass signature gates
`applyTabButtonStyles`, `stripThickness` gets a memo, one pre-computed extent
array is threaded through the width machinery, `layoutChrome` takes the thickness
as a parameter, `ScrollStrip.layoutArrows` sets its glyphs only on an orientation
change, the bar uses `setDisplayed` instead of `setVisible`, and `Tab.attach`
stops force-creating nine elements at construction.

**Covers.** 07 F07.1(caller half), F07.2, F07.3(1), F07.4, F07.5, F07.6, F07.9;
04 F04.1(caller half), F04.12.

**Files.** `component/container/TabBar.ts`,
`component/container/ScrollStrip.ts`, `layout/Tab.ts`.

**Depends on.** G07 (`Button.setGlyph`, `setTextAlign`, `Component.setInsets`
guards). Shares nothing with G12/G13.

**Risk.** Medium. `TabCloseReservePerTab.test.ts` and
`TabCloseGlyphCentring.test.ts` pin the resulting geometry, so a stale thickness
memo fails them — good. The signature must include the resolved theme scale so
`tab-font-relative-sizing`'s intent is preserved. `Tab.lifecycle.test.ts` and
`TabCloseGlyphCentring.test.ts` ("gives the close button a resolved size at
construction") exercise the construction ordering `Tab.attach` changes.

**Proof.** Slice 07 probe J1: structural + rule ops in an unchanged overflowing
pass `{removeElement:6, createElement:2, createElementNS:8, ensureStyleRule:2,
setRuleStyles:2, deleteStyleRule:2, release:6}` → `{}`. Probe L2:
`buttonCrossExtent` per outer pass 160 → ≤ 16. Probe C2: `computePreferredSize`
at 16 tabs in `equal` mode 640 → ≤ k·N. Probe B2: `TabButton` `scheduleLayout`
calls per unchanged pass 4 → 0. Probe K2:
`new Container({layoutManager: new Tab()})` `ensureStyleRule` 7 → 0.
Then ms/frame on the 2×2 editor-grid horizontal drag with ≥12 tabs per pane.

### G16 `panel-settled-pass-and-scroll-reads`

**Scope.** A settled `Panel` handed its own rectangle performs no read and no
write; one scroll listener replaces two; `SmoothScroller` writes only the axis
that moved.

**Covers.** 04 F04.2, F04.3, F04.4, F04.6, F04.14; 01 F01.8; 23 F23.10(the
shared max-scroll memo).

**Files.** `core/Panel.ts`, `core/SmoothScroller.ts`, `core/Component.ts`
(scroll setters and the max-scroll memo), `core/Event.ts` (if the self-scoped
scroll registration is added).

**Depends on.** G07 (shares `core/Component.ts`). The merged scroll handler is
also where `SmoothScroller`'s deferred read-back gets its settled value, so the
two halves ship together.

**Risk.** Medium. `Panel`'s signature must include the shrink signal so
`scheduleGutterSettleOnShrink`'s case still forces a pass;
`PanelOverlayScrollbar.test.ts:333` asserts the inner scroller is re-sized on
every settled layout, so the panel's own size must be in the signature (it is).
Deferring the scroll read-back changes when `getScrollLeft`'s cache becomes
accurate mid-gesture; `ComponentSubtreeScroll.test.ts` and
`PanelScrollChaining.test.ts` pin it.

**Proof.** Slice 04 probe P04-A: `getScrollMetrics` across 10 identical
`applyBounds` frames 20 → 0, applies 60 → 0. Probe PANEL: `getScrollMetrics` per
scroll event 3 → 1, and 0 for a descendant's scroll. Probe P04-E: child
`getPreferredSize` per pass with `autoScroll:'auto'` equal to the
`autoScroll:'none'` count. Probe SMOOTH: `scrollLeft` writes across a 10-frame
vertical-only ease 10 → 0. Then ms/frame on a Split gutter drag with a scrolling
side panel whose width is not being dragged.

### G17 `glyph-name-setter`

**Scope.** `Glyph.setName(name)` mutates the existing glyph in place, so an icon
change stops disposing and rebuilding a component; the three swap sites adopt it;
`TreeCellRenderer.refreshToggle` gains the `dispose()` it claims to have.

**Covers.** 18 F18.4; 22 F22.3 (C10); 13 F13.9; 14 F14.11; 04/07/09/20/26's
remaining `setGlyph` callers.

**Files.** `component/display/Glyph.ts`, `component/display/Glyphs.ts`,
`component/tree/TreeRow.ts`, `component/tree/renderer/IconLabel.ts`,
`component/list/renderer/Glyph.ts`,
`component/table/cell/renderer/TreeCell.ts`,
`component/display/IconText.ts`, `component/display/IconLabel.ts`.

**Depends on.** G07's `setGlyph` guard, so the two are measured separately.

**Risk.** Medium. `Glyph`'s immutability is load-bearing for the sprite mount
(`ensureGlyphSymbolMounted`) and the char-mode `_def` lookup; a setter must
re-run both and re-assert the preferred-size inline style.
`tests/component/tree/Tree.test.ts:97-118` pins the *current* instance-swap
behaviour by asserting toggle identity changes across an expand — that assertion
moves to the name.

**Proof.** Slice 22 probe D8: stylesheet ops per `collapseAll` on a 200-root tree
36 → 0, and orphan `Glyph` instances after N expand/collapse cycles → 0. Slice 18
probe P: ops per expand 74 → ~10 and per collapse 94 → ~10; probe K2: sink ops
per one-row scroll step with a changing icon 39 → ~13. Slice 13 probe: 
`querySelector` per `new Glyph` 1-per-instance → 1-per-distinct-name.

### G18 `text-measurement-without-reflow`

**Scope.** A `Text` measures itself without forcing a document layout: a
single-line measurement seam on `DOMSource` backed by the canvas context the
seam already owns, the wrap re-measure taken off the bounds-commit path and
given a width-keyed memo, the eight redundant `scheduleLayout()` calls dropped in
favour of the `setPreferredSize` relay, and the theme-change sweep filtered on
effective visibility.

**Covers.** X5's measurement half. 14 F14.1, F14.4, F14.6, F14.7, F14.10,
F14.12; 18 F18.3; 12 F12.3(measurement half); 11 F11.3; 16 F16.1(a);
26 F26.2(batch half).

**Files.** `core/DOM.ts`, `core/Util.ts`, `component/input/Text.ts`,
`component/tree/renderer/Label.ts`,
`component/tree/renderer/IconLabel.ts`, `component/tree/Tree.ts`,
`overlay/Tooltip.ts`, `overlay/Menu.ts`, `component/chart/ChartAxis.ts`,
`component/input/ComboBox.ts`.

**Depends on.** G07 (the `setText` same-value guard lands there; this group is
the measurement half). Shares `core/DOM.ts` with G08 and G20 — sequence.

**Risk.** High by reach: `setText` is the most-called API in the library, and the
new path changes measured numbers, so every baseline- and width-sensitive test
must be re-run (`TextIntrinsicHeight`, `StatusBar.test.ts:146`,
`content-box-containment.test.ts`). The offline modelled source derives both
paths from the same font table, so parity is checkable offline; a real-browser
parity check is the only manual step. `setWidth`'s synchronous re-measure is
documented as deliberate so the taller preferred height propagates before the
next pass reads it — `TextIntrinsicHeight.test.ts:53-71` and `:84-112` are the
contract to preserve. The tree-renderer half needs `Tree._bindAndMeasure` split
into a bind pass and a measure pass before a batch can form.

**Proof.** Slice 14 probe: `DOM.source.measureText` across `setText` + `doLayout`
for a default `nowrap` `Text` 1 → 0; sink writes for an identical `setText` 3 →
0; `measureText` over 10 drag frames on a wrapping `Text` 20 → ≤ 10 and 0 once
the width settles. Slice 18 probe M: `measureTexts` per force-rebind pass 0 → 1
and direct `measureText` 23 → 0. Slice 11 probe P1: `measureText + measureTexts`
for a 3-line tooltip show 4 → 1, and 0 for a repeat show. Then ms/frame on a Loom
selection drag with the status-bar readouts left on default auto-measure — the
`setAutoMeasure(false)` pin removed from `loom/src/EditorController.ts`.

### G19 `tooltip-hover-path`

**Scope.** Moving the pointer across a toolbar costs nothing: `Tooltip.hide()`
early-returns when nothing is showing, `Tooltip.attach` early-returns on
unchanged text and shares module-level handlers, `detach` hides only its own
anchor, and `Animation.play` removes the listeners it added.

**Covers.** 11 F11.1, F11.2 (C15, C21); 13 F13.5; 15 F15.1(tooltip half);
20 F20.3(tooltip half); 26 (the chart hover caller).

**Files.** `overlay/Tooltip.ts`, `core/Animation.ts`,
`component/button/Button.ts` (`_rebuildTooltip`'s same-string guard),
`validation/FieldDecorator.ts`.

**Depends on.** G07 for `Button.setText`'s guard, which removes the caller.
Independent otherwise.

**Risk.** Low. The early return skips an animation already running on a detached
element. `tests/overlay/Tooltip.test.ts:291` pins that repeated `attach` calls do
not register a duplicate teardown hook — an early return preserves it.
`tests/core/Animation.test.ts:299-343` pins `afterTransition`'s listener removal
and asserts nothing about `play`'s, so the listener fix is unpinned either way.

**Proof.** Slice 11 probes: sink ops for a `hide()` with nothing showing 3 → 0;
`Event.addListener`/`removeListener` on a re-attach with identical text 4/4 →
0/0; `removeListener` after a `play()` whose fallback timer wins 0 → 2;
`Tooltip.dismissing` stays `false` after an unrelated `setText`. Slice 13:
`Event.addListener` across five identical `setText` calls 20 → 0. Slice 15:
`setRuleStyles` across 10 error-free `clearError()` calls 10 → 0.

### G20 `event-dispatch-and-registrants`

**Scope.** One seam call replaces the per-level ancestor walk, and every
high-frequency subtree registrant is narrowed at once.

**Covers.** X8. 03 F03.3, F03.7, F03.10, F03.11, F03.16; 06 F06.7; 08 F08.9;
12 F12.7; 16 (the `FileDropZone` registrants); 26 (chart and legend); 09 F09.14.

**Files.** `core/DOM.ts` (`getAncestorIds`), `core/Event.ts`,
`tests/dom/TestDOM.ts`, `component/container/SplitGutter.ts`,
`layout/Accordion.ts`, `component/menubar/ToolBar.ts`,
`component/input/FileDropZone.ts`, `component/chart/AbstractChart.ts`,
`component/chart/ChartLegend.ts`, `overlay/Notification.ts`.

**Depends on.** Nothing, but **ordering constraint 3 applies**: all registrants
in one change set, or the walk stays installed. Shares `core/DOM.ts` with G08 and
G18 — sequence. Shares `SplitGutter.ts` with G12 and `Accordion.ts` with
G13/G14 — sequence.

**Risk.** Medium. `tests/dom/event-subtree-reentrant-dispose.test.ts` case EV2
pins incidental behaviour (an outer ancestor listener not running after an inner
one disposes itself) and must be restated — the code comment describes the abort
as crash-avoidance, not a contract. `Accordion`'s switch to
`mouseenter`/`mouseleave` must be checked against
`overlay/Notification.ts:242-247`, which records a reason for preferring
`mouseover`/`mouseout` on a root with a non-empty subtree. If the framework's
routing cannot deliver non-bubbling events to an exact-target registration, that
is a `core/Event` gap to raise, not to work around.

**Proof.** Slice 03 probe P3: `getId` + `getParentElement` for one dispatched
event on a 20-deep chain 40 → 0, and handle-registry growth across 1,000
synthetic `pointerover` dispatches. Slice 06 probe S1, re-run with a live
`Accordion` in the tree: `getParentElement` for one unrelated `mouseover` 15 → 0.

### G21 `table-render-pass-economy`

**Scope.** The table render pass stops doing work whose inputs did not move, and
one changed record rebinds one row instead of the whole window.

**Covers.** 19 F19.2, F19.3, F19.5, F19.6, F19.7, F19.8, F19.11, F19.13;
21 F21.7; 22 F22.2, F22.5, F22.8, F22.12.

**Files.** `component/table/Body.ts`, `component/table/Table.ts`,
`component/table/TreeBody.ts`.

**Depends on.** G02 (shares `bindAndPositionRows`). **Ordering constraint 2
applies**: `applyRequiredEmptyState`'s gate and the `_boundIndices` narrowing are
both in this group and must land together. `TreeBody.onStoreChange` must be
included — narrowing only the base leaves the tree paying two O(N) rebuilds per
edit anyway (22 F22.2).

**Risk.** Medium. `datachange` is also fired for batch commits with no per-record
identity, so the narrow path must key on `'update'` arriving, not on
`'datachange'`. `VisibleRecordQueryEconomy.test.ts` pins "at most 2
`getVisibleRecords` per scroll tick" — the change tightens it to 1.
`_updateFocusStyle` is `protected` and `TreeBody` calls it after programmatic
navigation, so the `records` parameter stays optional.

**Proof.** Slice 19 probe P9/P13: row-visible predicate invocations per unchanged
layout pass 8,000 → 0; probe P16: `getVisibleRecords` per ArrowDown 6 → ≤ 1;
probe P1: `setStyleState` per unchanged pass on an unselected table 105 → 0, and
`setRequiredEmpty` per pass on a spec with no required column 90 → 0; probe P8:
`Row.setData` for a single-record `notifyRecordChanged` 18 → 1. Slice 22 probe
D7: records copied per settled pass 4,000 → 0 and per ArrowDown 24,000 → ≤ 4,000;
probe T6: `rebuildIndexCalls`/`flattenCalls` for a non-structural `datachange`
2/2 → 0/0, `installRowDnD` 36 → 0; probe T10: `getToggleElement` per non-toggle
click 21 → ≤ 1.

### G22 `table-resize-settle-relay`

**Scope.** A width-changing burst re-lays out the cells once, on the settle
frame, instead of once per frame — in the flat body, the tree body and the
header together.

**Covers.** 19 F19.4; 22 F22.4; 20's mirroring requirement.

**Files.** `component/table/Body.ts`, `component/table/Header.ts`.

**Depends on.** G21 (same file). **The header must move with the body** or the
two visibly disagree mid-drag.

**Risk.** Medium. `CellLayoutSkip.test.ts` case 12 drives a single synchronous
width change with no frame burst, so it takes the
`_resizeSettleHandle === null` branch and still relays out immediately —
matching `ResizeLayoutEconomy.test.ts`'s note that a multi-change burst needs a
capturing `requestAnimationFrame`. `TreeBody.afterRowBound` runs per rendered row
regardless, so deferring cell layout does not disturb the toggle or indent state.

**Proof.** Slice 19 probe P4: cell `doLayout` per frame across a five-frame burst
90×5 → 90 once. Slice 22 probe D6: `cellDoLayoutTotal` 270 → 54. Then ms/frame on
a Loom gutter drag with a table pane open.

### G23 `table-header-and-cell-write-economy`

**Scope.** The filter row, the sort sweep and the cell renderers stop rewriting
values that did not change, and the column-focus underline becomes a declared
state class.

**Covers.** 20 F20.2, F20.3, F20.4, F20.5, F20.6, F20.7, F20.8, F20.10;
21 F21.1, F21.3, F21.6, F21.8, F21.11.

**Files.** `component/table/Header.ts`, `component/table/cell/Filter.ts`,
`component/table/cell/Header.ts`, `component/table/cell/ParentHeader.ts`,
`component/table/cell/SortPriorityBadge.ts`,
`component/table/cell/FilterClauseBadge.ts`,
`component/table/cell/renderer/*`, `data/temporalText.ts`.

**Depends on.** G07 (`Button.setGlyph`/`setText`/`clearDescription` guards make
half of F20.2 and F20.3 a no-op; if they land first, re-scope this group to the
`onStoreFilterChange` narrowing and the double `applyOperatorFace`). G21 (shares
`Header.ts` with G22 — sequence).

**Risk.** Medium. The `.columnFocused` conversion changes every declared state's
generated `:not()` guard suffix on `HeaderCell`, so
`TableHeader.classStyleDefaults.test.ts` and `PooledTintMetaClasses.test.ts` are
the likely movers — split that half out if the plan needs shrinking. The
`setOperators` identity guard must not swallow `setOperators([])` on a cell that
already had `[]` (`ColumnFilterRow.test.ts:1562`). The renderer guard must
compare the computed **display string**, not the raw value —
`ComboRenderer.setOptions` re-enters `setValue` with an unchanged value to
re-resolve against a new label map.

**Proof.** Slice 20 probe P3: stylesheet ops per `store.setFilter` at 8 columns
48 → 0; probe P2: `_rebuildContentRow` and `Tooltip.attach` across five filter
keystrokes 1 and 2-per-char → 0; probe P4: text applies per sort click 32 → 1;
probe P5: rule ops across a `setFocusedColumn(a)→(b)→(null)` sequence 6 → 0;
probe P8: text applies on a forced reconcile with unchanged columns 24 → 0.
Slice 21 probe P21.11: redundant `textContent` writes per
`notifyRecordChanged` 200 → 0; probe P21.6: `.focused` rules for the cell family
5 → 1; probe P21.12: 20,000 `TimeRenderer.setValue` calls ~850 ms → ~15 ms, then
wall-clock on a 100k-row CSV export with a datetime column.

### G24 `list-and-tree-row-economy`

**Scope.** List rows toggle class tokens instead of rewriting the whole `class`
attribute and stop firing `change` for a selection that did not change; the tree
batches its text measurement and stops re-rendering its window on every pass.

**Covers.** 18 F18.1, F18.3(host half), F18.5(2), F18.6, F18.7, F18.10, F18.12,
F18.13, F18.2(option 1); 16 F16.2(a).

**Files.** `component/list/AbstractSelectableList.ts`,
`component/list/AbstractMarkerList.ts`, `component/tree/Tree.ts`,
`component/input/ComboBox.ts`.

**Depends on.** G18 (the tree renderers' lazy `_measured` pattern needs the
measurement seam to be worth batching into). Independent of the table groups.

**Risk.** Medium. Suppressing a no-op `change` is the contract `Tree` already
ships, but it is observable — `ComboBox` and `AutoCompleteField` listen for it,
and it needs a changelog entry. `renderWindow`'s early-out must not swallow a
pass its nine other entry points need, so the generation counter has to be bumped
by `_flatten` and by every `_boundIndices.fill(-1)` site.
`tests/component/tree/ResizeLayoutEconomy.test.ts` pins the withholding.

**Proof.** Slice 18 probe F: class writes per `moveFocus` on a 300-item list 600
→ ≤ 4, and 0 `DOM.source` reads following a write; probe S: `change` events
across five clamped ArrowDowns 5 → 0; probe A: `setStyleState` per unchanged
`Tree.doLayout` 52 → 0 and sink writes 1 → 0; probe I: `{text}` patches for 50
`addComponent` calls on a `NumberedList` 1,375 → 50. Slice 16 probe:
class-attribute writes per ArrowDown on an open dropdown 2N → N.

### G25 `codemirror-theme-singleton`

**Scope.** Every editor shares one chrome theme per mode and one highlight
module, instead of minting 51 rules per instance and per theme toggle; a hidden
editor withholds its theme reconfigure; the `:has()` rule becomes a marker class.

**Covers.** 23 F23.1, F23.5, F23.11, F23.8 (C7).

**Files.** `component/editor/theme.ts`, `component/editor/CodeEditor.ts`.

**Depends on.** Nothing. **Highest value-to-risk in the editor set.**
`component/editor/editorTheme.ts`'s `ensureMarkdownEditorClassRules()` is the
in-repo precedent — a module singleton inserting 20 rules once.

**Risk.** Low. `codeEditorTheme` has no importer outside `CodeEditor.ts`.
Sharing one prefix class across editors is what a normal CodeMirror app does. No
test pins per-instance identity.

**Proof.** Rule count on the shared sheet after mounting *n* editors: flat
instead of `51n`; `DiagnosticsOverlay`'s stylesheet-rule readout across two theme
toggles with 6 tabs open: +612 → +0.

### G26 `markdown-viewer-resize-and-lexer`

**Scope.** A `Markdown` preview costs nothing per drag frame, and lexing is
linear.

**Covers.** 25 F25.1, F25.2, F25.4, F25.13, F25.14, F25.16; 11 F11.5;
25 F25.3(the caller-side gate).

**Files.** `component/display/Markdown.ts`,
`component/display/MarkdownViewer.ts`,
`component/display/markdownExtensions.ts`,
`component/display/markdownTableExtension.ts`,
`component/container/FloatingPanel.ts`.

**Depends on.** G09 (`Markdown` is a good `canSkipUnchangedLayout` candidate once
the gate is live, and its own probe already measures 0 writes and 0 reads for an
unchanged width). Coordinate the `placeNextTo` gate with slice 11's owner —
`DiagramView` uses `FloatingPanel` the same way, so the choice of caller-side vs
`FloatingPanel`-side matters beyond this group.

**Risk.** Medium. `Markdown.test.ts:1381-1524` pins the min/preferred-size
folding, the growth re-measure and the `Fit` scroll-host growth; `:1861` pins
that the width flush precedes the geometry read, which a read-all-then-write-all
resync keeps. The lexer change must leave `Markdown.test.ts:1055-1278` (tables,
widths, merges) and `:382-524` (fences, nesting, escapes) green.

**Proof.** Slice 25 probe P1: style applies per `setWidth` 7 (4 empty) → ≤ 1, and
`DOM.source` reads per frame 1 → 0 during a simulated 10-frame drag; probe P2:
all `getScrollMetrics` calls landing at the same sink-write count. The lexer
timing table: `lexMarkdown` at 3,200 blocks 408.70 ms → tracking marked's 3.98 ms
within a small constant. Probe viewer: `getElementRect` over 10 identical passes
20 → 0. Then ms/frame on a Loom horizontal gutter drag with a preview pane.

### G27 `markdown-heading-scroll-cache`

**Scope.** `Markdown` publishes its headings and their handles from the render
walk it already performs; the active heading resolves from cached offsets. This
also fixes the duplicate-id correctness bug (C19).

**Covers.** 25 F25.5 (C19), F25.9, F25.12.

**Files.** `component/display/Markdown.ts`,
`component/display/HeadingScrollTracker.ts`,
`component/display/MarkdownMinimap.ts`,
`component/display/MarkdownViewer.ts`.

**Depends on.** G26 (shares `Markdown.ts` — sequence, do not parallelise).

**Risk.** Medium. `findActiveHeading` is a public export with a documented
signature and a six-case suite including max-scroll tie-breaks; the offset-cache
variant can ship behind the existing signature first. `packages/docs`'s
`DocsContent` stacks several `Markdown` blocks in one pane, so a handle list must
be assemblable from more than one instance.

**Proof.** A probe asserting 0 `DOM.source` reads per `trackScroll` on a settled
pane (today 33 `getElementRect` + 33 `getElementById` + 33 `contains` on a
40-heading document); a two-viewer probe asserting each resolves its own heading;
`lexMarkdown` entered once per `MarkdownViewer.setMarkdown` instead of twice.

### G28 `continuous-motion-pattern`

**Scope.** Every continuous-motion path adopts the four-part pattern
`AbstractWindow`'s header drag already uses, and the framework gains the inline
transform setter that makes it possible.

**Covers.** X7. 10 F10.1, F10.11; 15 F15.3, F15.4, F15.5; 27 F27.1, F27.4;
20 F20.1; 09 F09.11(the missing coalescing); 02 F02.2.

**Files.** `core/Component.ts` (the new inline transform surface),
`overlay/DragGhost.ts`, `overlay/DragManager.ts`, `component/input/Slider.ts`,
`component/input/Toggle.ts`, `component/diagram/DiagramView.ts`,
`component/table/Table.ts`, `component/table/Header.ts`, `overlay/Drawer.ts`,
`overlay/Rail.ts`, `overlay/AbstractWindow.ts`.

**Depends on.** G07 (shares `core/Component.ts`). **Flag for the user before
planning**: it needs a `Component` API decision — either move
`transform`/`transformOrigin`/`clipPath` onto the inline surface, or extend
`setTranslate` to carry a scale and add a public inline-transform setter beside
it. `DiagramView` cannot reach `setElementStyle` (it is `protected`) and making
`_contentHost` a bespoke subclass would be exactly the "paper over a library gap"
move the project forbids.

**Risk.** High and partly unmeasurable offline. Moving `transform` off the rule
changes which surface wins over a class rule; `grep` shows 7 `setTransform` call
sites, none with a competing state rule, but `replayGeometryStyles`'s `(0,0)`
skip exists specifically so a rule-driven rotation is not clobbered and must be
revisited. `DiagramView.test.ts` reads `view._contentHost.getTransform()` in ~30
assertions, and `getTransform()` reflects the *rule* value.

**Payoff not verified in the real engine.** Compositing is the one thing the
sandbox cannot record. Every claim here is reasoned from the cost model plus the
`AbstractWindow` write-count contrast. **Take a WebKitGTK Timeline recording of a
tab drag and a `DiagramView` pan before and after**, and treat the write-count
probes as necessary but not sufficient.

**Proof.** Write counts: applies per `DragGhost.moveTo` 4 (2 unchanged) → 1;
`setRuleStyles` per `DiagramView` pointermove 1 → 0 and ≤ 1 per animation frame;
`getViewportRect` per 10-sample `Slider` drag 10 → 1; `setRuleStyles` per
`Toggle` flip 1 → 0; `will-change` present on exactly the elements that receive a
`transform` write. Then ms/frame on a WebKitGTK recording of a tab drag across
the 2×2 editor grid, and a pan over a 300-node diagram.

### G29 `dead-surface-and-docs-sweep`

**Scope.** One commit per theme, no measurement attached: delete the zero-caller
members listed in section 7, collapse the duplicated constants, correct the
documentation errors listed in section 4, and fix the six broken `{@link}` paths.

**Covers.** every slice's `## Redundant, duplicated and dead code` section, plus
the doc corrections.

**Files.** wide and shallow.

**Depends on.** Nothing, but each deletion should ride with whichever group is
already editing that file where possible. **Three items are product decisions,
not cleanups, and need the user**: retiring or landing `Component.release()`,
retiring or landing `SpatialNavigation`'s target tier, and removing or finishing
`ToolBar`'s `overflow: "menu"` and the `FooterRow`.

**Risk.** Low per item; several are public-API removals and need changelog
entries.

**Proof.** Grep counts re-run at zero; `npm run docs:api` warning-free; the full
suite green.

### Groups whose payoff is not yet verified in the real engine

Flagged explicitly, per the `loom-perf-needs-real-webkit-recording` rule. All of
these need a WebKitGTK Timeline recording **before or during** implementation,
not after.

| Group | Why offline probes are insufficient |
|---|---|
| G28 `continuous-motion-pattern` | compositing and paint cannot be recorded in the sandbox at all; the whole payoff is paint-side |
| G04 `style-write-dedup-at-the-seam` | the ~195 ms/frame restyle figure is real, but the gain from removing 18 same-valued rule writes per pass has never been measured end to end |
| G14 `accordion-closed-section-render-tree` | the gain is engine layout of a subtree that leaves the render tree; op counts show the JS half only |
| G17 `glyph-name-setter` and G25 `codemirror-theme-singleton` | rule *counts* are measurable offline; the restyle saving they buy is not |
| G09 `unchanged-subtree-layout-skip` | how much of the 107 ms/frame is framework recursion versus CodeMirror's own re-measure is unknown until measured |
| G12 `split-border-drag-economy` | slice 06 asked for its real-engine confirmation first, because it decides whether the per-frame restyle disappears |
| G16 `panel-settled-pass-and-scroll-reads` | forced-layout counts are offline-visible; their millisecond cost in software Cairo is not |
| The `CodeEditor` box-decoupling lever (23 F23.2, **not in any group**) | the only lever on the measured 15–20 ms per visible editor, and it carries a visible trade-off — content does not track the drag until settle. Plan it last, after G04–G16 have removed the noise, and A/B it in the real shell. It is a product decision, not a performance one. |

---

## What to measure

The existing Loom harness already reports the three counter families this
campaign needs. Take a full baseline **before G04 lands**, because G04 removes
the per-frame restyle that currently dominates every other measurement.

### The scenarios

| # | Scenario | Why |
|---|---|---|
| S1 | 2×2 editor-grid **horizontal** gutter drag, 4 visible CodeMirror editors, ≥12 tabs per pane | the campaign's headline path. Today ~107 ms/frame. Exercises X1 (Split/Border clip-path), X3, X4, X5 (ScrollStrip arrows), X6, and the tab-strip groups |
| S2 | 2×2 grid **vertical** gutter drag, same tree | the horizontal/vertical asymmetry was 220 vs 107 ms/frame before the `ScrollStrip` fix; re-check that they stay level |
| S3 | Loom **sidebar** gutter drag, file tree expanded, one Accordion section closed | isolates G13/G14. Today the Accordion's four border declarations are **all four** of this frame's rule mutations |
| S4 | Window resize on an **empty project** | today ~52 ms/frame against a ~17 ms idle floor. Everything measured here is framework-only, with no CodeMirror in the way — the cleanest read on G09, G10 and G11 |
| S5 | Pointer sweep across the tool bar and the tab strip, no drag | isolates G19 and G20 — the per-`mousemove` cost, which no other scenario exposes |
| S6 | Typing a 40-character line in an editor with the status bar on default auto-measure (the `setAutoMeasure(false)` pin removed from `loom/src/EditorController.ts`) | isolates G18. If the pin can be deleted without a regression, G18 succeeded |
| S7 | Right-click on the file tree (a 12-row context menu) | isolates the `Menu.show()` read↔rule-write crossing (12 F12.3): 873 sink writes and 57 rule ops today |
| S8 | Markdown preview open in one pane, horizontal gutter drag | isolates G26: two forced layouts per frame from `placeNextTo`, plus the collapse/measure/restore probe |
| S9 | Idle, one project open, nothing moving | the regression gate. `DiagnosticsOverlay`'s layout-passes-per-second must read 0. Today `ProgressSpinner`'s overlay mode alone keeps it non-zero |

### The counters, in the harness's own terms

- **ms/frame** — on S1–S4 and S8. The primary number.
- **Rule writes per frame** — `setRuleStyles` + `ensureStyleRule` +
  `deleteStyleRule` ops between two `flushPendingLayouts` calls, under the
  recording sink or `DiagnosticsOverlay`'s stylesheet counter. Today: 18 per
  unchanged Loom-shaped whole-tree pass, 14 per gutter-drag frame, 4 of them the
  Accordion's. Target 0 on S1–S4.
- **Applies per frame, and how many are empty** — total `DOM.sink.apply` ops,
  split by whether the patch carries a declaration. Today: 199 of 200 empty per
  settled table pass, 902 of 906 per 300-item list pass, 27 of 43 per settled
  `Window` pass, 42 of 68 per header resize frame. Target: empty count 0.
- **Forced reads per frame** — `getScrollMetrics` + `getElementRect` +
  `getViewportSize` + `getOffsetSize` + `getComputedStyle`-backed reads
  (`getThemeVar`, `getComputedOverflow`, `isRenderedVisible`). Target 0 on a
  settled pass; ≤ 1 per gesture where a live read is genuinely needed.
- **Stylesheet rule count** — `DiagnosticsOverlay`'s total, sampled across ten
  Markdown-preview toggles on a fenced-code README. Today it climbs ~306 per
  toggle and never falls. Target: flat.
- **Layout passes per second at idle** — `DiagnosticsOverlay`. Target 0 on S9.

### The three headline numbers

Quote these when the work is done.

1. **ms/frame on the 2×2 editor-grid horizontal drag (S1): 107 → target.**
   The campaign's single number. It is what the merged September fixes moved from
   220, and it is what every group in waves 1–3 is aimed at.
2. **Stylesheet-rule writes per gutter-drag frame: 14 → 0.**
   Measured by slice 06 on a `sidebar | 2x2 Split grid` tree; an unchanged
   whole-tree pass over the same tree writes 18. Every one is a same-valued
   write, and each is a full-document restyle in the target engine. Slice 08
   measured the companion figure on an Accordion-in-Split sidebar: 4 per
   gutter-drag frame, all four the Accordion's border. G04, G07, G12 and G13
   together should take both to zero, and the counts are exact and easy to
   assert.
3. **Empty `DOM.sink.apply` calls per settled table layout pass: 199 of 200 → 0.**
   The cheapest fix in the campaign — one line in `InlineStyle.flushDirty` —
   against the largest count anywhere in the library, and the clearest evidence
   that the library stopped doing work nothing observes.
