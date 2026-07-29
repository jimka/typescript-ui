# Width-aware flow preferred size — Implementation Plan

## Overview

`HFlow.getPreferredSize()` ([HFlow.ts:71](packages/lib/src/typescript/lib/layout/HFlow.ts#L71)) reports a **single-line** shape: the width is every child's preferred width summed with item spacing, and the height is one row. `VFlow.getPreferredSize()` ([VFlow.ts:73](packages/lib/src/typescript/lib/layout/VFlow.ts#L73)) is the transpose — one column. Under a stretching parent the flow almost always gets less than the unwrapped extent, wraps to several lines, and then tells its parent it only needs one. The parent sizes it for one line and the rest is clipped by the framework's default `overflow: hidden`.

Measured offline with eleven 190x285 children in an `HFlow({spacing: 8, lineSpacing: 8})` at width 892: the children lay out in three rows with tops 0 / 293 / 586 and a content bottom of 871, while `getPreferredSize()` keeps reporting `2170 x 285`.

This plan makes the **cross-axis** extent of both flows honest. `doLayout` already groups the children into rows (or columns) at the container's real inner extent; it will publish the resulting line extent onto the manager, `getPreferredSize` will report that measurement instead of the one-line estimate, and a change in the measurement relays upward so the parent re-sizes on the next pass. The main-axis (width for `HFlow`) hint is deliberately unchanged. Three source files, two doc pages, one changelog entry, and preferred-size tests for both flows — of which there are currently none.[^no-coverage]

---

## Architecture Decisions

### The wrapped extent is measured in `doLayout` and published, not computed in `getPreferredSize`

`HFlow.doLayout` already calls `groupIntoRows` at the container's real inner width ([HFlow.ts:252](packages/lib/src/typescript/lib/layout/HFlow.ts#L252)). It will hand the resulting rows' total cross extent to a new `FlowLayout.publishWrappedLineExtent(extent)`. `getPreferredSize` reads that stored number back and never builds rows itself.[^why-not-in-getpreferred]

This mirrors how the codebase already solves width-dependent height. `Text` re-measures from its `setWidth` override and reports the cached result from `getPreferredSize` ([Text.ts:521](packages/lib/src/typescript/lib/component/input/Text.ts#L521)); `Markdown` does the same with `_measuredHeight` ([Markdown.ts:499](packages/lib/src/typescript/lib/component/display/Markdown.ts#L499)). The already-implemented `marker-list-numbering-styles` plan states the rule in as many words: *"Do not 'fix' this by computing the column inside `getPreferredSize` — that would mutate children from a size query, and `getPreferredSize` is on the hot layout-gathering path."*

The existing wrap arithmetic is reused exactly as it stands: `groupIntoRows` / `groupIntoColumns` are not refactored, not extracted, and not duplicated. The only new arithmetic is a sum over the rows they already return.

### A changed measurement relays upward through `notifyIntrinsicSizeChanged`

When the published extent differs from the previous one, `FlowLayout` calls `container.notifyIntrinsicSizeChanged()`. That is the framework's declared channel for *"a layout manager whose intrinsic sizing depends on internal state"* ([Component.ts:5329](packages/lib/src/typescript/lib/core/Component.ts#L5329)), and `Accordion.relayoutHost` is the existing caller ([Accordion.ts:882](packages/lib/src/typescript/lib/layout/Accordion.ts#L882)). An unchanged extent notifies nothing, which is what stops the relay from looping.[^no-schedule-layout]

### The reported preferred **width** of an `HFlow` does not change

`HFlow` keeps reporting the full unwrapped width (`2170` in the measurement above); `VFlow` keeps reporting its single-column height. Only the cross axis becomes measurement-backed.

The two axes answer different questions. On the main axis the preferred size is an *aspiration*: "give me this much and I will not wrap at all." On the cross axis it is a *consequence* of the main-axis width the flow was actually given, so reporting one line is simply false.[^why-main-axis-unchanged]

### `getMinSize` and `getMaxSize` are untouched

Neither flow's minimum or maximum becomes width-aware. A `Container` (and therefore a `Panel`) returns `false` from `clampsToContentSize()` ([Component.ts:3267](packages/lib/src/typescript/lib/core/Component.ts#L3267)), so a layout-derived minimum would not make a flow host inflate itself anyway — only the parent honouring the preferred size fixes the clipping. Widening the minimum would additionally floor every ancestor at the wrapped height, which is a behaviour change nobody asked for.

### A measurement taken at a non-finite width is not published

`Component.getInnerSize()` subtracts the perimeter from an unset `_width`, so before the first sizing pass it returns `{width: NaN, height: NaN}` rather than `null` ([Component.ts:2921](packages/lib/src/typescript/lib/core/Component.ts#L2921)). `doLayout` treats that object as truthy and runs, and every `> NaN` wrap comparison is false, so the children collapse into one bogus row. The publish call is therefore guarded by `Number.isFinite` on the wrap threshold, following the same guard `Table.doLayout` already carries for the same reason ([Table.ts:109](packages/lib/src/typescript/lib/layout/Table.ts#L109)). Placement behaviour at a `NaN` width is left exactly as it is.

---

## Public API

No exported symbol changes. Every new member is internal:

```typescript
// FlowLayout (abstract base) — shared by HFlow and VFlow
private   _wrappedLineExtent: number | null;          // null until first measured
protected getWrappedLineExtent(): number | null;
protected publishWrappedLineExtent(extent: number): void;
override  detach(): this;                             // clears _wrappedLineExtent
```

```typescript
// HFlow
private rowsCrossExtent(rows: HFlowRow[], lineSpacing: number): number;
```

```typescript
// VFlow
private columnsCrossExtent(columns: VFlowColumn[], lineSpacing: number): number;
```

---

## Internal Structure

The published number is the **line extent only** — summed row heights (or column widths) plus the inter-line spacing, with no insets, padding, or border in it. `getPreferredSize` then adds `perimeterSize` back exactly as it does today, so there is no way to double-count or drop the perimeter.

```typescript
// FlowLayout
protected publishWrappedLineExtent(extent: number): void {
    if (this._wrappedLineExtent === extent) {
        return;
    }

    this._wrappedLineExtent = extent;

    this.getContainer()?.notifyIntrinsicSizeChanged();
}
```

```typescript
// HFlow
private rowsCrossExtent(rows: HFlowRow[], lineSpacing: number): number {
    if (rows.length === 0) {
        return 0;
    }

    let extent = lineSpacing * (rows.length - 1);

    for (const row of rows) {
        extent += row.rowHeight;
    }

    return extent;
}
```

`VFlow.columnsCrossExtent` is the transpose, summing `column.columnWidth`.

**Which extent the wrap runs against.** The wrap threshold is `container.getInnerSize().width` for `HFlow` and `.height` for `VFlow` — the *inner* extent, already perimeter-subtracted, already read by `doLayout` ([HFlow.ts:238](packages/lib/src/typescript/lib/layout/HFlow.ts#L238), [VFlow.ts:233](packages/lib/src/typescript/lib/layout/VFlow.ts#L233)). `getPreferredSize` reads no width at all, so the outer-vs-inner mistake cannot be made there.

---

## Ordered Implementation Steps

Work test-first: step 1 writes the failing tests, steps 2–6 make them pass, steps 7–9 are documentation.

1. **Add the preferred-size tests** to `packages/lib/tests/component/layout/HFlow.test.ts` and `VFlow.test.ts`, using each file's existing `hostHFlow` / `hostVFlow` helper. Cover every case in `## Expected Behaviour`. Run them — the wrapped cases must fail with today's single-line numbers before any source change.

2. **`FlowLayout.ts`** — add `private _wrappedLineExtent: number | null = null;` beside the existing `_spacing` / `_lineSpacing` fields ([FlowLayout.ts:79](packages/lib/src/typescript/lib/layout/FlowLayout.ts#L79)), plus `protected getWrappedLineExtent()`, `protected publishWrappedLineExtent(extent)` (body above), and a `detach()` override that sets the field back to `null` before calling `super.detach()`.

3. **`HFlow.ts`** — add the private `rowsCrossExtent(rows, lineSpacing)` helper (body above), next to the existing `cellsMainExtent` ([HFlow.ts:359](packages/lib/src/typescript/lib/layout/HFlow.ts#L359)).

4. **`HFlow.doLayout`** — after the `placeRows` call and **before** `reserveContentFrame()` ([HFlow.ts:254](packages/lib/src/typescript/lib/layout/HFlow.ts#L254)), publish the measurement, guarded on the wrap threshold being a real number:

   ```typescript
   if (Number.isFinite(innerSize.width)) {
       this.publishWrappedLineExtent(this.rowsCrossExtent(rows, lineSpacing));
   }
   ```

5. **`HFlow.getPreferredSize`** — replace the height line ([HFlow.ts:106](packages/lib/src/typescript/lib/layout/HFlow.ts#L106)) with a measured-first form. Leave the loop above it alone: it still sums the width and still collects `heights` / `baselines` for the fallback.

   ```typescript
   const measured = this.getWrappedLineExtent();

   let height = measured !== null
       ? measured
       : (uniformHeight ? extents.height : this.computeRowHeight(heights, baselines));
   ```

6. **`VFlow.ts`** — repeat steps 3–5 transposed: add `columnsCrossExtent(columns, lineSpacing)` summing `column.columnWidth`; publish from `doLayout` guarded by `Number.isFinite(innerSize.height)`; and in `getPreferredSize` replace the width line ([VFlow.ts:106](packages/lib/src/typescript/lib/layout/VFlow.ts#L106)) with

   ```typescript
   const measured = this.getWrappedLineExtent();

   let width = measured !== null
       ? measured
       : (uniformWidth ? extents.width : maxWidth);
   ```

7. **Rewrite the two `getPreferredSize` docblocks.** Both currently state a permanent limitation that is only true on the first pass, and both point at a scroll host as the design.[^wrong-docs] Replace `HFlow.ts:56-70` with a description of the real contract: the width is the single-line sum (the flow's aspiration), the height is the measured wrapped extent once a layout has run at a real width, and the single-line height is the fallback before that first layout. Say the same about `VFlow.ts:59-72` with the axes swapped. Delete the scroll-host sentence from both (*"The parent absorbs the difference: a scroll-enabled host scrolls vertically…"* and its `VFlow` twin) — a plain `Container` cannot be that host, since `autoScroll` is a `PanelOptions` field ([Panel.ts:77](packages/lib/src/typescript/lib/core/Panel.ts#L77)). Leave each **class-level** docblock's `Panel.setAutoScroll` mention alone; a scrolling host is still one valid arrangement.

8. **Update the `## Scrolling` sections** of `packages/lib/docs/layouts/HFlow.md` (around line 150) and `packages/lib/docs/layouts/VFlow.md` (around line 120). Both tell the reader that overflow past the inner cross extent is scrolled or clipped; add that the flow now *reports* its wrapped extent, so a parent that honours preferred sizes grows it to fit and scrolling is only needed when the parent cannot.

9. **Add a `### Fixed` entry** under `## 0.3.0` in `packages/lib/docs/reference/changelog.md`, following the existing entries' bold-lede-then-explanation shape.

10. **Run the checks** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/FlowLayout.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/HFlow.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/VFlow.ts` |
| Modify | `packages/lib/tests/component/layout/HFlow.test.ts` |
| Modify | `packages/lib/tests/component/layout/VFlow.test.ts` |
| Modify | `packages/lib/docs/layouts/HFlow.md` |
| Modify | `packages/lib/docs/layouts/VFlow.md` |
| Modify | `packages/lib/docs/reference/changelog.md` |

---

## Expected Behaviour

All cases below are **unit-testable offline**. The offline harness (`installTestDOM` plus `tests/dom/font-metrics.test-font.json`) models geometry completely — every "after" number in this section came from running the scenario against it.[^offline-numbers] Hosts are built with the existing `hostHFlow` / `hostVFlow` helpers, which realise the element, set the size, and clear the insets — so the perimeter is zero and the reported cross extent equals the measured line extent exactly.

### HFlow

| # | Scenario | `getPreferredSize()` before `doLayout` | after `doLayout` |
|---|---|---|---|
| 1 | 3 x 60x20, `spacing: 5`, `lineSpacing: 8`, host 100x300 → 3 rows | `190 x 20` | `190 x 76` |
| 2 | 40x20 + 30x20, `spacing: 5`, host 300x200 → 1 row | `75 x 20` | `75 x 20` |
| 3 | 30x20 + 50x40, `uniform: "height"`, `spacing: 5`, `lineSpacing: 8`, host 60x300 → 2 rows | `85 x 40` | `85 x 88` |
| 4 | 30x20 + 50x20 + 20x20, `uniform: "width"`, `spacing: 5`, `lineSpacing: 8`, host 100x300 → 3 rows | `160 x 20` | `160 x 76` |

Case 1 arithmetic: three rows of height 20 with two 8px line gaps = `3*20 + 2*8 = 76`. Case 3: two uniform 40-high rows plus one gap = `88`. Case 2 is the regression guard — a flow that fits on one line must report exactly what it reports today.

5. **The reported width never changes.** In every case above, the "before" and "after" widths are identical. Assert this explicitly in case 1.
6. **No width yet → single-line fallback.** A host whose element is realised but which was never given a width, and on which `doLayout` was never called, reports `190 x 20` for case 1's children.
7. **A layout at a non-finite width publishes nothing.** Same host as case 6, but call `doLayout()` before reading: the report is still `190 x 20`, not a measurement taken against `NaN`.
8. **The measurement tracks the width.** Lay case 1's host out at width 100 (`190 x 76`), then `setWidth(300)` and `doLayout()` again: the report becomes `190 x 20`, because all three children now fit on one row.
9. **`getMinSize` is unchanged.** For case 1, `getMinSize()` returns the same value before and after `doLayout`.

### VFlow

| # | Scenario | before `doLayout` | after `doLayout` |
|---|---|---|---|
| 10 | 3 x 20x60, `spacing: 5`, `lineSpacing: 8`, host 300x100 → 3 columns | `20 x 190` | `76 x 190` |
| 11 | 20x40 + 30x30, `spacing: 5`, host 200x300 → 1 column | `30 x 75` | `30 x 75` |
| 12 | 30x20 + 50x40, `uniform: "width"`, `spacing: 5`, `lineSpacing: 8`, host 300x60 → 2 columns | `50 x 65` | `108 x 65` |

13. **The reported height never changes** across cases 10–12.
14. **The `VFlow` fallback and `NaN` guard** behave as cases 6–7, transposed onto the height axis.

### Relay and stability

15. **A changed measurement relays upward.** Add the flow `Container` to an outer host running `VBox({stretching: true})`, size the outer host so the flow wraps to three rows, and settle it with `flushLayout()`. Then spy on the **outer** host's `scheduleLayout`, widen the outer host so the flow needs only one row, and call `outerHost.doLayout()` — the spy fires, because the flow's changed extent reaches the outer host through the parent-installed preferred-size relay.
16. **A settled flow does not re-dirty itself.** Call the shared `expectNoSelfReschedule` helper from `packages/lib/tests/helpers/layoutStability.ts` on the same outer host, without changing its width. This is the loop guard: it proves that a second identical pass publishes the same extent and therefore notifies nothing.

### Manual verification

17. **`HFlow` / `VFlow` demo sections** (`npm run dev`, sections "HFlow" and "VFlow" on `localhost:8015`). Expected: **unchanged rendering**. Exercise the toolbar's spacing, `uniform`, `align`, `itemAlign`, and `justify` controls and resize the window; nothing should shift, and the CPU must stay idle rather than pegging.
18. **`MarkerListPanel`** — contingent on `feature/marker-lists` being merged; see `## Potential Challenges`. Its list rows are plain `Container`s with an `HFlow`, no `preferredSize`, and no `autoScroll`, and they currently clip. Expected after this change: every wrapped line of `FieldSet` boxes is visible, with no scroll host and no pinned size added. **Do not modify `MarkerListPanel` to make this pass** — it is the reproduction case, kept deliberately.

---

## Verification

```bash
cd packages/lib

# The two flow suites, red before the change and green after.
npx vitest run tests/component/layout/HFlow.test.ts tests/component/layout/VFlow.test.ts tests/component/layout/FlowLayout.test.ts

# Nothing else in the layout system regresses.
npx vitest run tests/component/layout/

# Full suite + types.
npm test
npm run typecheck

# Public JSDoc changed on two classes — must finish with zero warnings.
npm run docs:api
```

Grep invariants:

```bash
# getPreferredSize must not build rows/columns itself.
grep -n 'groupIntoRows\|groupIntoColumns' packages/lib/src/typescript/lib/layout/HFlow.ts packages/lib/src/typescript/lib/layout/VFlow.ts
# expect: matches only in doLayout, the helper's own definition, and docblocks —
# none between the getPreferredSize signature and its closing brace.

# The stale docblock claims are gone.
grep -rn 'only known once the parent assigns\|only known once the parent' packages/lib/src/typescript/lib/layout/
grep -rn 'The parent absorbs the difference' packages/lib/src/typescript/lib/layout/
# expect: zero matches for both.

# The class-level docblocks still mention Panel.setAutoScroll (correctly — a
# scrolling host is still one valid arrangement); only the getPreferredSize
# docblocks lose it.
grep -n 'setAutoScroll' packages/lib/src/typescript/lib/layout/HFlow.ts packages/lib/src/typescript/lib/layout/VFlow.ts
# expect: one match per file, in the class docblock.
```

Manual: `npm run dev` and exercise cases 17–18 above.

---

## Documentation Impact

- `HFlow.getPreferredSize` and `VFlow.getPreferredSize` are public documented methods, so their rewritten `@remarks` ship into the TypeDoc API pages. Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), the new prose must not `{@link}` the new protected members — describe the mechanism ("measured at the last layout") rather than naming `publishWrappedLineExtent`.
- `packages/lib/docs/layouts/HFlow.md` and `VFlow.md` — the `## Scrolling` section on each.
- `packages/lib/docs/reference/changelog.md` — a `### Fixed` bullet under `## 0.3.0`.
- No new exports, so `packages/lib/llms.txt`, the barrel `layout/index.ts`, and the docs sidebar are untouched.

---

## Potential Challenges

- **The report lags a resize by one pass.** A parent that measures its children before assigning their widths reads the extent from the *previous* width. The next pass corrects it, and the corrected pass publishes the same value again so it does not schedule a third — the same two-pass convergence the `marker-list-numbering-styles` plan documents for its shared marker column, and the same one `Text.setWidth` documents for wrapped prose. Mitigation is the idempotence of `publishWrappedLineExtent`, pinned by expected-behaviour case 16.
- **A repeated-write loop is the failure mode to watch for.** If the published extent ever differs on every pass, each pass notifies and schedules the next. The single guard is the equality early return in `publishWrappedLineExtent`. If a browser check shows a flow section pegging the CPU, that is the line to inspect first.
- **The relay only fires when the flow host has a wired parent.** `notifyIntrinsicSizeChanged` is a no-op on an unparented component, so test 15 must build a real parent host rather than calling `doLayout` on a bare `Container`.
- **`MarkerListPanel` does not exist on `master`.** It lives only on `feature/marker-lists` (its plans are at `plans/implemented/marker-list-{layout-manager,component-markers,numbering-styles}.md` on that branch; on `master` two of them are still at `plans/marker-list-*.md`). This plan carries **no `depends-on`** — the fix is implementable and fully testable from `master` alone. Manual case 18 is contingent: run it only if `feature/marker-lists` is merged, and otherwise reproduce on `master` with a throwaway `Container` holding eleven `Component`s of `preferredSize: {width: 190, height: 285}` under `HFlow({spacing: 8, lineSpacing: 8})` inside a stretching `VBox`, which clips 586px today.
- **Row heights must equal the committed child extents.** `rowsCrossExtent` sums `row.rowHeight`, which `groupIntoRows` derives from `clampedPreferredSize` — already floored to each child's minimum — so `placeComponent`'s own min-floor cannot push a child past its row. Cross-check in case 1 by asserting the measured height equals `max(child.getY() + child.getHeight())`, which is what `reserveContentFrame` uses for the scroll extent.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/layout/HFlow.ts`](packages/lib/src/typescript/lib/layout/HFlow.ts) | The subject: `getPreferredSize`, `doLayout`, `groupIntoRows`, `HFlowRow`. |
| [`packages/lib/src/typescript/lib/layout/VFlow.ts`](packages/lib/src/typescript/lib/layout/VFlow.ts) | The transpose. |
| [`packages/lib/src/typescript/lib/layout/FlowLayout.ts`](packages/lib/src/typescript/lib/layout/FlowLayout.ts) | Shared base — holds the new field and publish method. |
| [`packages/lib/src/typescript/lib/component/input/Text.ts:521`](packages/lib/src/typescript/lib/component/input/Text.ts#L521) | **The precedent.** Width-dependent height: measure on size assignment, cache, report from `getPreferredSize`, converge over two passes. Its `setWidth` docblock is the argument this plan reuses. |
| [`packages/lib/src/typescript/lib/layout/Accordion.ts:882`](packages/lib/src/typescript/lib/layout/Accordion.ts#L882) | The existing `notifyIntrinsicSizeChanged` caller — the shape `publishWrappedLineExtent` follows. |
| [`packages/lib/src/typescript/lib/core/Component.ts:2666`](packages/lib/src/typescript/lib/core/Component.ts#L2666) | `getPreferredSize` and the comment at :2683 explaining why it must stay cheap and non-recursive. |
| [`packages/lib/src/typescript/lib/layout/Table.ts:109`](packages/lib/src/typescript/lib/layout/Table.ts#L109) | The `Number.isFinite` guard precedent for an unsized container's `NaN` inner size. |
| [`packages/lib/tests/component/layout/HFlow.test.ts`](packages/lib/tests/component/layout/HFlow.test.ts) | The `hostHFlow` helper idiom the new tests follow. |
| [`packages/lib/tests/helpers/layoutStability.ts`](packages/lib/tests/helpers/layoutStability.ts) | `expectNoSelfReschedule` — the relayout-loop guard for case 16. |

---

## Non-Goals

- **Changing `getMinSize` or `getMaxSize` on either flow.** Out of scope per the decision above; a layout-derived minimum would not help a `Container` host and would over-constrain every ancestor.
- **Changing the main-axis preferred extent** (`HFlow` width, `VFlow` height). Decided above.
- **Refactoring `groupIntoRows` / `groupIntoColumns`,** or extracting a shared measurement pass into `FlowLayout`. The two are mirror images that the base deliberately keeps concrete ([FlowLayout.ts:70](packages/lib/src/typescript/lib/layout/FlowLayout.ts#L70)); only the tiny cross-extent sum is new.
- **Touching `MarkerListPanel`, `FlowDemoPanel`, `HFlowPanel`, or `VFlowPanel`.** They are verification targets. `FlowDemoPanel` gives its flow host `weight: 1` in a stretching `VBox` ([FlowDemoPanel.ts:68](packages/lib/src/typescript/FlowDemoPanel.ts#L68)), so the weighted child receives the leftover space and its preferred height is never consulted for placement — its rendering is unaffected. `HFlowPanel` and `VFlowPanel` only pass different option bags to that same base, so the same holds. No file under `packages/lib/src/typescript/lib/component/**` uses either flow.[^blast-radius]
- **Memoising `getPreferredSize` itself.** It does strictly less work after this change than before on the measured path, so there is nothing to cache.

---

## Notes

[^no-coverage]: `packages/lib/tests/component/layout/HFlow.test.ts`, `VFlow.test.ts`, and `FlowLayout.test.ts` together contain zero `getPreferredSize`, `getMinSize`, or `getMaxSize` assertions — verified with `grep -rn 'getPreferredSize\|getMinSize\|getMaxSize'` across the three files. `HFlow.test.ts` covers wrapping, same-row advance, uniform-width stride, and the clamp-ordering regression; `VFlow.test.ts` covers wrapping and same-column advance; `FlowLayout.test.ts` is a pure setter/getter suite with no geometry. Nothing pins the size hints at all, which is why the single-line report survived this long.

[^why-not-in-getpreferred]: Computing the wrap inside `getPreferredSize` was the obvious shape and is rejected for three reasons. (1) `getPreferredSize` sits on the layout-gathering recursion, which `Component.getPreferredSize` is explicitly written to keep cheap — the comment at [Component.ts:2683](packages/lib/src/typescript/lib/core/Component.ts#L2683) refuses to clamp against the merged maximum precisely because doing so re-enters children's `getPreferredSize` and goes exponential in tree depth. Building rows calls `clampedPreferredSize` on every child, which calls each child's `getPreferredSize` *and* `getMinSize` *and* `getMaxSize`; doing that on the measure path re-enters the same recursion the comment warns about. (2) It would not be any fresher — it would read the same last-assigned width, so it buys nothing in accuracy. (3) It still would not converge on its own: nothing would tell the parent to re-measure, so the relay in `doLayout` would be needed anyway. Publishing from `doLayout` gets the accuracy with none of the cost, and reuses the wrap arithmetic verbatim instead of copying it. The one thing the `doLayout` site does not cover is a caller that queries the preferred size of a flow that has never laid out — which is exactly the fallback branch.

[^no-schedule-layout]: `Accordion.relayoutHost` calls both `scheduleLayout()` and `notifyIntrinsicSizeChanged()`; this plan calls only the latter. The difference is that an accordion's open/close changes how its own subtree must be arranged, so it needs its own re-layout, whereas here `doLayout` has just finished and its placement is already correct for the bounds the container currently has. Only the *reported* size moved, and only ancestors care about that. A re-entrant `scheduleLayout` from inside a `doLayout` side effect queues into the following frame rather than the current drain ([Component.ts:196](packages/lib/src/typescript/lib/core/Component.ts#L196)), so convergence costs exactly one extra frame either way.

[^why-main-axis-unchanged]: Making the preferred width report the wrapped width instead would be self-defeating: a shrink-to-fit parent would hand the flow back exactly the width it just wrapped at, freezing the line breaks at whatever width the flow first happened to receive, and the flow could never un-wrap when more room appeared. Keeping the unwrapped sum means a parent with room to spare gives the flow enough to avoid wrapping, and a parent without room gives it less — which is the input the cross-axis measurement then answers. The asymmetry is therefore load-bearing, not an oversight.

[^wrong-docs]: [HFlow.ts:64-68](packages/lib/src/typescript/lib/layout/HFlow.ts#L64) says the real height is *"only known once the parent assigns a width — unavailable when the hint is queried"*. The first clause is right; the second is only true of the very first pass. After any layout the container is still holding the width `doLayout` wrapped against — the offline probe reads `getWidth() === 892` at the same moment `getPreferredSize()` reports a height of `285`. The next sentence, *"The parent absorbs the difference: a scroll-enabled host scrolls vertically…"*, presents a workaround as the design, and omits that `autoScroll` is a `PanelOptions` field ([Panel.ts:77](packages/lib/src/typescript/lib/core/Panel.ts#L77), defaulting to `"none"` at :114) — so a reader who follows the docblock with a plain `Container` gets silent clipping instead. [VFlow.ts:66-71](packages/lib/src/typescript/lib/layout/VFlow.ts#L66) carries the transposed version of both errors.

[^offline-numbers]: Every "before" figure in `## Expected Behaviour` was produced by running the scenario against `installTestDOM` on `master` and printing `getPreferredSize()`, the distinct child tops/lefts, and the content bottom/right. Each "after" figure equals the content extent that same run committed — e.g. case 1's children land at tops 0 / 28 / 56 with a content bottom of 76, and case 3's at tops 10 / 48 with a bottom of 88 (the 10 is the default centre anchor placing a 20-high child in a 40-high uniform cell). The harness models geometry fully, so these are exact, not approximate; browser checks are a sanity pass, not the verification.

[^blast-radius]: `grep -rln 'HFlow\|VFlow' --include='*.ts' packages/lib/src/typescript` returns exactly seven files: the three layout sources, the `layout/index.ts` barrel, and the three demo files (`FlowDemoPanel.ts`, `HFlowPanel.ts`, `VFlowPanel.ts`) plus their `main.ts` registration. Nothing under `lib/component/**` uses either flow, and `LayoutSerialization.ts` has no flow-specific branch, so no serialised layout round-trip is affected. On `feature/marker-lists` there is one more consumer, `MarkerListPanel.ts`; that branch changes no file under `packages/lib/src/typescript/lib/layout/`, so the two branches do not conflict.
