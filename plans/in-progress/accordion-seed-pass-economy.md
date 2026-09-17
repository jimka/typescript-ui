# Accordion seed-pass economy — Implementation Plan

## Overview

`Accordion.doLayout` computes two sizing stages — `computeShrinkRatio` ([layout/Accordion.ts:1575](packages/lib/src/typescript/lib/layout/Accordion.ts#L1575)) and `computeFill` ([layout/Accordion.ts:1583](packages/lib/src/typescript/lib/layout/Accordion.ts#L1583)) — on every pass, before it knows whether anything will read them. In resizable mode their only consumer is the seed at [layout/Accordion.ts:2426](packages/lib/src/typescript/lib/layout/Accordion.ts#L2426), which fires only for an open section that has no stored size yet; once every open section is stored, both stages run and their output is thrown away. In non-resizable mode their output *is* read, but each open section's preferred/min/max is fetched three separate times in one pass — once by `computeShrinkRatio`, once by `computeFill`, once again by the `contentHeightFor` callback at [layout/Accordion.ts:1604](packages/lib/src/typescript/lib/layout/Accordion.ts#L1604). Each fetch is an unmemoised recursive walk of that section's whole subtree, which in Loom's sidebar is a `Tree`.

This plan makes the sizing stages run on demand and measure each open section once. Three further items ride along in the same file: the reduced-motion media query at [layout/Accordion.ts:1704](packages/lib/src/typescript/lib/layout/Accordion.ts#L1704) stops running on settled passes, `setHeaderHeight`/`setAnimationDuration` are brought in line with their sibling setters, and `detach` gives back the container border `attach` took over.

A runtime experiment that stubbed both stages after the second pass was measured in WebKitGTK on the library's S3
sidebar-drag scenario: **−3.19 ms/frame** and **−19.9% of all counted per-frame work** (2036 → 1632 calls), with
every section rectangle unchanged. That experiment is not shippable — a pass counter is a guess about when seeding
has finished, and zeroing the fill map would move a weighted section's height on any pass where it *is* read. This
plan is the correct-by-construction version of the same result.

Everything is inside `packages/lib/src/typescript/lib/layout/Accordion.ts`, its two test files, and the Accordion
docs page. No public signature changes.

---

## Architecture Decisions

### The sizing stages run on demand, not on a schedule

`doLayout` holds the shrink ratio, the per-section content heights and the fill map in one lazily-built bundle instead of two eagerly-computed values. A reader that needs the bundle builds it; a pass with no such reader builds nothing.[^why-lazy]

The terminating condition is a state test, not a pass count: **the seed runs for an open section that has no stored size**, exactly as [`Split.seedFromPreferred`:901](packages/lib/src/typescript/lib/layout/Split.ts#L901) already decides the same question for panes ("a pane that already has a stored size is skipped, so a later `setPreferredSize` never re-seeds it"). `Accordion`'s seed loop already makes that per-section test; what this plan changes is that the *inputs* to the seed are no longer computed before the test is asked.[^precedent]

When the bundle does run, it runs where today's eager code ran — before `layoutSections` places anything.[^build-point]

### Each open section is measured once per pass

The bundle reads each open section's preferred, min and max height once into a small per-section record, and the shrink, content-height and fill stages all read that record instead of calling the component again.[^measure-once]

### Geometry is unchanged by construction

Both changes are rearrangements of pure reads. Every read site returns the same number it returns today, from the same inputs, at the same point in the pass; a site that never asks causes no computation. Nothing is approximated, skipped on a heuristic, or gated on a frame or pass counter.[^by-construction]

### The container border is captured at attach and given back at detach

`attach` records the container's border before the accordion starts writing it, and `detach` restores that recorded border when the container survives the detach.[^border-restore] The "does the container survive" test is the one [`Border.detach`](packages/lib/src/typescript/lib/layout/Border.ts#L1507) already uses to separate a manager swap from a dispose.

### Configuration state stays across a detach

`detach` clears `_resizePinned`, `_hoveredHeader` and `_resizeFactor`. It does **not** clear `_tools` or `_pendingSectionSizes`.[^keep-config]

---

## Internal Structure

Two module-local types, neither exported:

```ts
/** One open section's size reports, read once per layout pass. */
interface SectionMeasure {
    preferred: number;
    min:       number;
    /** `null` when the section declares no maximum height. */
    max:       number | null;
}

/** The non-resizable content-height model for one layout pass. */
interface ContentHeightModel {
    shrinkRatio:    number;
    /** Each open section's fill-free content height, by container index. */
    contentHeights: Map<number, number>;
    /** Each open section's share of the container's leftover height, by container index. */
    fills:          Map<number, number>;
}
```

The builder, replacing the two eager calls:

```ts
private computeContentHeightModel(components: Component[], containerSize: Size | null): ContentHeightModel {
    const measures = new Map<number, SectionMeasure>();

    for (let i = 0; i < components.length; i++) {
        if (!components[i].isDisplayed() || !this._openState[i]) {
            continue;
        }

        const preferred = components[i].getPreferredSize();
        const min       = components[i].getMinSize();
        const max       = components[i].getMaxSize();

        measures.set(i, {
            preferred: preferred ? preferred.height : 100,
            min:       min ? min.height : 0,
            max:       max ? max.height : null,
        });
    }

    const shrinkRatio    = this.computeShrinkRatio(components, containerSize, measures);
    const contentHeights = new Map<number, number>();

    for (const [i, measure] of measures) {
        contentHeights.set(i, this.openContentHeight(measure, shrinkRatio));
    }

    return { shrinkRatio, contentHeights, fills: this.computeFill(components, containerSize, contentHeights, measures) };
}
```

The `100` preferred fallback and the `0` min fallback are the ones `computeShrinkRatio` and `openContentHeight` already apply independently today; folding them in here applies them once.

The accessor in `doLayout`, and the one helper both readers share:

```ts
let heightModel: ContentHeightModel | null = null;
const contentModel = (): ContentHeightModel => (heightModel ??= this.computeContentHeightModel(components, containerSize));
```

```ts
/** An open section's non-resizable content height: its shrunk height plus its fill share. */
private legacyOpenHeight(model: ContentHeightModel, index: number): number {
    return (model.contentHeights.get(index) ?? 0) + (model.fills.get(index) ?? 0);
}
```

### When the model is built

`??`'s right operand is evaluated only when the left is nullish, so `resizeHeights?.get(i) ?? this.legacyOpenHeight(contentModel(), i)` does not build the model when the resizable path supplied a height.

| Pass | Resizable | Open sections with a stored size | Model built? | Why |
|---|---|---|---|---|
| First layout | on | none | yes | every open section needs a seed |
| Settled drag frame | on | all | **no** | no reader asks |
| A section is opened for the first time | on | all but that one | yes | the newly open section needs a seed |
| A section is closed, then reopened | on | all — its entry was kept | **no** | the reopened section still has its stored size |
| Any pass, one or more sections open | off, or on but inactive | — | yes | every open section's height comes from the model |
| Any pass, every section closed | either | — | **no** | no open section asks for a content height |

---

## Ordered Implementation Steps

Work in `packages/lib/src/typescript/lib/layout/Accordion.ts` unless stated. Steps 2–8 are one behaviour (the sizing rearrangement) and must land together — the file does not typecheck part-way through them, so run `npm run typecheck` only once step 8 is complete. Steps 9–12 are independent riders, and steps 13–14 close the change out.

1. **Write the tests first.** Turn `## Expected Behaviour` into cases in `packages/lib/tests/component/layout/Accordion.manager.test.ts` (the non-resizable geometry, work-count and rider cases) and `packages/lib/tests/component/layout/Accordion.resizable.test.ts` (the resizable geometry, seeding, work-count and detach cases). Run them and confirm which fail before touching the source: the work-count cases and rider cases 11–15 must fail, the geometry cases 1–7 must already pass.

2. **Add the two interfaces.** Declare `SectionMeasure` and `ContentHeightModel` as module-local (non-exported) interfaces near the top of the file, beside the existing `AccordionEvent` / `SectionToggleCallback` type declarations. Give each a JSDoc comment as shown in `## Internal Structure`.

3. **Re-point `computeShrinkRatio` at the measures.** Change its signature to `computeShrinkRatio(components: Component[], containerSize: Size | null, measures: Map<number, SectionMeasure>): number`. Inside the loop, replace

   ```ts
   if (!this._openState[i]) {
       continue;
   }

   const pref = components[i].getPreferredSize();
   const min  = components[i].getMinSize();

   openPreferred += pref ? pref.height : 100;
   openMin       += min ? min.height : 0;
   ```

   with

   ```ts
   const measure = measures.get(i);

   if (!measure) {
       continue;
   }

   openPreferred += measure.preferred;
   openMin       += measure.min;
   ```

   Leave the `isDisplayed()` check, the header/spacing accumulation and the three-case ratio policy exactly as they are. The `measures` lookup is a total replacement for the `_openState` test because the map holds exactly the displayed-and-open indices, and the `isDisplayed()` check above it has already run. Update the JSDoc `@param` list.

4. **Re-point `openContentHeight` at a measure.** Change its signature to `openContentHeight(measure: SectionMeasure, shrinkRatio: number): number` and rewrite the body to read `measure.preferred` / `measure.min` / `measure.max` (`null` meaning unbounded) instead of calling `getPreferredSize` / `getMinSize` / `getMaxSize`. The arithmetic — shrink toward min, cap at max, floor at min — does not change. Update the JSDoc `@param` list; keep the paragraph explaining why the merged-bounds clamp matters.

5. **Re-point `fillHeadroom` at a measure.** Change its signature to `fillHeadroom(measure: SectionMeasure, contentHeight: number): number` and read `measure.max` (`null` → `Number.POSITIVE_INFINITY`) instead of calling `getMaxSize()`.

6. **Take the content heights into `computeFill`.** Change its signature to `computeFill(components: Component[], containerSize: Size | null, contentHeights: Map<number, number>, measures: Map<number, SectionMeasure>): Map<number, number>` — `shrinkRatio` is no longer a parameter, because the content heights already fold it in. Inside the loop, replace

   ```ts
   if (this._openState[i]) {
       const contentHeight = this.openContentHeight(components[i], shrinkRatio);
   ```

   with

   ```ts
   const measure = measures.get(i);

   if (measure) {
       const contentHeight = contentHeights.get(i) ?? 0;
   ```

   and pass `measure` to `fillHeadroom`. Everything else in the method — the weight resolution, the leftover test, `distributeFillWithinMax` — is unchanged. Update the JSDoc `@param` list.

7. **Add `computeContentHeightModel` and `legacyOpenHeight`.** Place `computeContentHeightModel` immediately before `computeShrinkRatio`, and `legacyOpenHeight` immediately after `openContentHeight`. Bodies are in `## Internal Structure`. Both get a JSDoc comment; `computeContentHeightModel`'s must state that it is built at most once per pass and only when a reader asks.

8. **Make `doLayout` and `computeResizableHeights` lazy.**
   - In `doLayout`, delete the `const shrinkRatio = …` (`:1575`) and `const fills = …` (`:1583`) statements and their two comment blocks; put the substance of those comments on `computeContentHeightModel` instead. Add the `heightModel` / `contentModel` pair from `## Internal Structure` in their place.
   - Change the `computeResizableHeights` call to `this.computeResizableHeights(components, containerSize, contentModel)`.
   - After that call, add the pre-`layoutSections` build guard:

     ```ts
     // With the resizable path inactive every open section's height comes from the
     // model, so build it here rather than inside layoutSections — that keeps the
     // model's inputs read before any section is placed, exactly as before.
     if (resizeHeights === null && components.some((component, i) => component.isDisplayed() && this._openState[i])) {
         contentModel();
     }
     ```

   - Rewrite the open branch of the `contentHeightFor` callback (`:1604`) as `return resizeHeights?.get(i) ?? this.legacyOpenHeight(contentModel(), i);`.
   - In `computeResizableHeights`, change the last two parameters to a single `contentModel: () => ContentHeightModel` and rewrite the seed line (`:2426`) as `this._resizeSizes.set(component, this.legacyOpenHeight(contentModel(), i));`. Update its JSDoc `@param` list: the model is read *only* to seed a not-yet-stored section.
   - Check: `grep -n 'openContentHeight\|computeFill\|computeShrinkRatio\|fillHeadroom' packages/lib/src/typescript/lib/layout/Accordion.ts` — every remaining call site passes a `SectionMeasure`, a measures map, or a content-heights map. There must be no call of `openContentHeight` that takes a `Component`.

9. **Reorder the reduced-motion conjunction** (`:1704`) to `const shrinking = isOpen && animateShrink && contentHeight < oldHeight && !Animation.isReducedMotion();`. Both operands are side-effect free, so only the evaluation order changes.

10. **`setHeaderHeight` relayouts** (`:370`). Add `this.relayoutHost();` before `return this;`, matching `setCompact` (`:408`), `setSpacing` (`:518`) and `setSingleOpen` (`:325`). `applyOptions` calls this setter during construction, where `getContainer()` is null and `relayoutHost`'s optional chaining makes it a no-op.

11. **`setAnimationDuration` reaches existing chevrons** (`:434`). After assigning `_animationDuration`, loop `for (const header of this._headers) { header.setAnimationTiming(ms, ACCORDION_EASING); }` — the same shape `setCompact` and `setChevronSide` already use, and the same call `createSection` makes at `:1380`.

12. **`detach` tidy-up** (`:1133`).
    - Add `import type { BorderOptions } from "~/primitive/Border.js";` to the import block — `BorderOptions` is not currently imported into this file.
    - Declare `private _borderBeforeAttach: BorderOptions | null = null;` beside the other private fields, and in `attach` (`:1086`), after `super.attach(container)`, record `this._borderBeforeAttach = container.getBorder();`.
    - In `detach`, hoist `const components = container ? container.getComponents() : [];` (`:1181`) out of the `for` loop to just above it.
    - Near the existing `_resizeSizes.clear()` / `_gutterPairs = []` block and before `super.detach()`, add `this._resizePinned.clear(); this._hoveredHeader = -1; this._resizeFactor = 1;`.
    - In the same block, restore the border when the container survives:

      ```ts
      // Give back the border applyContainerTheming took over. A dispose reaches
      // here from Component.destructor, which already emptied the container, so
      // writing through its released handle must be skipped — the same test
      // Border.detach uses.
      if (container && container.getComponents().length > 0) {
          if (this._borderBeforeAttach) {
              container.setBorder(this._borderBeforeAttach);
          } else {
              container.clearBorder();
          }
      }

      this._borderBeforeAttach = null;
      ```

13. **Update the docs page.** In `packages/lib/docs/layouts/Accordion.md`, the runtime-setter table (lines 43–50): add to the `headerHeight` row that `setHeaderHeight` re-lays-out the host, and to the `animationDuration` row that `setAnimationDuration` re-times existing headers' chevrons as well as the panel transitions. No other page changes.

14. **Run the checks in `## Verification`.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/tests/component/layout/Accordion.manager.test.ts` |
| Modify | `packages/lib/tests/component/layout/Accordion.resizable.test.ts` |
| Modify | `packages/lib/docs/layouts/Accordion.md` |

---

## Expected Behaviour

Write these as tests before changing the source. All are unit-testable against `installTestDOM`; none needs a browser.

**Geometry is identical.** This is the bar the whole change has to clear. These cases go in `Accordion.manager.test.ts` and `Accordion.resizable.test.ts` beside the suites they extend.

1. Every existing case in the `shrink-ratio geometry`, `fill-weight distribution`, `resizable — seed parity with weight`, `resizable — fill invariant`, `resizable — rescale on container resize`, `fill — respects maxSize (non-resizable)` and `resizable/non-resizable size parity` suites still passes unchanged. These assert exact heights from the documented formula, so any drift in the shrink, content-height or fill arithmetic fails them.
2. **Repeated passes are stable.** A 4-section accordion (2 open, 2 closed, one open section weighted), laid out three times with no input change, reports the same `[width, height]` for all four sections after pass 1, pass 2 and pass 3 — in both resizable and non-resizable mode. The slice review's `E1` probe asserted exactly this equality once; here it becomes a permanent regression guard.
3. **A first-time open still seeds.** Resizable, section 1 closed at first layout. After `openSection(1)` and a relayout, section 1's height equals what the non-resizable model would give it (its shrunk preferred height plus its fill share) — i.e. the seed still fires for a section that has no stored size.
4. **A reopened section keeps its stored size.** The existing `resizable — collapse frees space` cases already pin this; they must keep passing, because the model is deliberately *not* built on that pass.
5. **A closed-first section does not disturb the model.** Non-resizable, section 0 closed and section 1 open: section 1's height matches the documented shrink/fill formula, unchanged from today.
6. **Single open section**, non-resizable: its height is its preferred height plus the whole leftover when it is weighted, and its plain preferred height when it is not.
7. **Zero open sections**: every section contributes only its header height, the accordion's own `getPreferredSize` is unchanged, and each closed section's content still sits at its preferred height. The content-height model is never built — assert `computeShrinkRatio` and `computeFill` are not entered.

**Work avoided — first-class, and pinned in CI.** These count calls with `vi.spyOn` on a section component, once per `doLayout` pass, the way probes `E1b`/`E1c`/`A3` did.

| Case (per `doLayout` pass) | Today | After |
|---|---|---|
| `getPreferredSize` / `getMinSize` / `getMaxSize` on one open section, non-resizable | 3 / 3 / 3 | **1 / 1 / 1** |
| `getPreferredSize` / `getMinSize` / `getMaxSize` on one open section, settled resizable | 2 / 3 / 3 | **0 / 1 / 1** |
| `computeShrinkRatio` + `computeFill` calls, settled resizable | 1 + 1 | **0 + 0** |
| `DOM.source.matchMedia` calls, 2 open sections, unchanged pass | 2 | **0** |

8. Non-resizable, 2 open sections: the three size reports on one open section total 1/1/1 on a settled pass.
9. Resizable, after two settled passes: 0/1/1 on the third pass, and neither `computeShrinkRatio` nor `computeFill` is entered.
10. `DOM.source.matchMedia` is not called during a pass in which no section's content height falls below its current height; it *is* still called on a pass where a section shrinks, so reduced motion keeps suppressing the deferred reflow.

**Riders.**

11. `setHeaderHeight(40)` after a first layout moves every header and re-stacks the sections at the new height without any other layout trigger.
12. `setAnimationDuration(500)` after a first layout leaves every existing header's chevron timing at 500 ms (assert through the header's animation timing, as `createSection` sets it).
13. A container carrying `{ border: '2px solid red' }` before `new Container({ layoutManager: accordion })`, laid out and then given a different layout manager, reports `{ border: '2px solid red' }` again.
14. A container with no border of its own, attached and then detached, no longer reports the themed accordion border.
15. Detaching a manager mid-drag leaves `_resizePinned` empty and `_resizeFactor` at 1 — no detached section component is still referenced.

---

## Verification

- `npm run typecheck` and `npm run typecheck:test` — the signature changes in steps 3–8 must have no remaining call sites on the old shapes.
- `npm -w packages/lib run test` — the whole suite, not just the two Accordion files; `ManagerChrome.styleRuleDisposal.test.ts` is the nearest gate for the detach border restore.
- `npm run lint`.
- `npm run docs:api` — must finish with zero warnings after the JSDoc edits.
- Manual, in the docs app's Accordion page: open and close sections (the animation still runs and still shrinks smoothly), drag a resizable accordion's gutter (heights track the cursor), and resize the window while a toggle animation is mid-flight (no jump).
- Performance, separately and after merge: re-run the wave-2 S3 arm (`mode=filetree&tabs=1&gutter=explorer&count=1`) plain-bracketed at both ends, in its **own** sweep. The sibling `Border` region-size memo must not land in the same measurement — two changes on one frame cannot be attributed separately. Expect `accordion.openContentHeight` at 2 per frame against today's 4, and total counted per-frame work near 1632 against 2036.

---

## Documentation Impact

`packages/lib/docs/layouts/Accordion.md`: the runtime-setter table (lines 43–50) says every option "has a matching setter for runtime updates". Two rows are now true that were not: note on the `headerHeight` row that `setHeaderHeight` re-lays-out the host, and on the `animationDuration` row that `setAnimationDuration` applies to existing headers' chevrons as well as to the panel transitions. No new exported symbol, so no `llms.txt` or API-catalog entry changes.

---

## Potential Challenges

- **`measures.get(i)` must mean exactly "displayed and open".** The map's population loop is the single place that filter lives; the two readers keep their own `isDisplayed()` checks for header accounting and consult the map only for the open branch. Mitigation: step 3 and step 6 both replace an `_openState[i]` test with a map lookup and nothing else — no third filter is introduced.
- **`computeFill` loses its `shrinkRatio` parameter.** An implementer copying the old call shape will pass four arguments in the wrong order. Mitigation: the parameter order in step 6 is explicit, and `typecheck` catches a `Map` where a `number` was expected.
- **The build guard in step 8 must run after `computeResizableHeights`, not before.** Before it, `resizeHeights` does not exist yet. Mitigation: the step states the position; the `const` declaration makes the wrong order a compile error.
- **`clearBorder()` writes an explicit `none` rather than restoring an unset border.** A container that had no border of its own is left with `none` after a detach instead of nothing. This matches what `themed: false` already writes, so nothing changes visually; behaviour 14 is written against the accordion's border being gone, not against `getBorder()` returning `null`.

---

## Critical Files

- `packages/lib/src/typescript/lib/layout/Accordion.ts` — the whole change. Read `doLayout` (`:1533`), `layoutSections` (`:1647`), `computeShrinkRatio` (`:2061`), `openContentHeight` (`:2130`), `computeFill` (`:2167`), `fillHeadroom` (`:2295`), `computeResizableHeights` (`:2382`), `applyPendingSectionSizes` (`:2443`) and `distributeWithinConstraints` (`:2503`) before editing.
- `packages/lib/src/typescript/lib/layout/Split.ts:901` (`seedFromPreferred`) — the precedent this plan follows: a seed gated on whether the participant already has a stored size, run once per participant, never re-run.
- `packages/lib/src/typescript/lib/layout/Border.ts:1507` (`detach`) — the precedent for releasing what `attach` wrote, and for the "does the container survive this detach" test.
- `packages/lib/tests/component/layout/Accordion.manager.test.ts` — the shrink and fill geometry gates.
- `packages/lib/tests/component/layout/Accordion.resizable.test.ts` — the seeding, rescale, pin and teardown gates.
- `plans/research/render-review-2026-09-15/08-layout-accordion-table-serialization.md` — findings F08.2, F08.4, F08.5, F08.11, F08.14 and their probes.
- `plans/research/render-review-2026-09-15/97-wave2-measurement.md` — the measured result this plan makes permanent.

---

## Non-Goals

- **Closed sections leaving the render tree** (finding F08.3). That change is the largest remaining item in the Accordion render-work review and carries its own hazard checklist, so it is a separate plan, sequenced after this one so the sizing noise is out of its measurement.
- **Moving `applyContainerTheming` out of `doLayout`** (finding F08.1). The four rule declarations it used to write are already suppressed by `Component.setBorder`'s unchanged-value guard, so the call is cheap and stays where it is. Only its *detach* half is in scope here.
- **A general size-hint memo on `Component` itself**, shared by every layout manager. That was measured directly in the same sweep: it removed two thirds of all counted per-frame calls, the frame got no faster, and at per-frame granularity it changed the layout. This plan's per-section measure is not that memo — it is local to one `Accordion` pass and threaded as a parameter, so no other manager and no later pass can read it.
- **Batching `placeSection`'s twelve geometry setters** (finding F08.6). Unrelated to the sizing pipeline, and its other half is a `core` change.
- **Clearing `_tools` or `_pendingSectionSizes` on detach** — see _Configuration state stays across a detach_.
- **Measuring this change in the same sweep as the sibling `Border` region-size memo.** Two changes landing on one frame cannot be attributed separately.

---

## Notes

[^why-lazy]: Two eager stages, two possible readers. In resizable mode the only consumer is the seed at `:2426`, which fires per open section that has no `_resizeSizes` entry; `contentHeightFor`'s fallback at `:1604` is unreachable while the resizable path is active, because `distributeWithinConstraints` returns an entry for every index in `openIndices` and `layoutSections` skips exactly the sections `openIndices` excludes. In non-resizable mode `contentHeightFor` reads the model for every open section, so it must still be built. A lazy bundle serves both without either branch having to predict the other. The alternative — re-deriving the "is the resizable path active" test in `doLayout` so it can decide up front — was rejected: it duplicates the participation logic that `computeResizableHeights` already owns (open-index resolution, budget, the pending-sizes drain), which is precisely the kind of second copy that drifts.

[^precedent]: `Split` faces the same problem — first-layout panes need a size, later passes must not re-derive one — and answers it with a per-participant `has()` test rather than a pass count or a "first layout" flag. `Accordion`'s seed loop already uses the identical `if (!this._resizeSizes.has(component))` shape; this plan extends the same idea one level up, so the *inputs* to the seed are also gated on whether any participant is unseeded. That is why stubbing the stages after a fixed number of passes is not the permanent form: a pass count is a proxy for "everything is seeded by now", and it happens to hold for a static accordion and to fail for one where a section is opened for the first time on pass 9.

[^build-point]: The guard in step 8 of `## Ordered Implementation Steps` exists so the model's inputs are read at the same point in the pass as today — before `layoutSections` places or reflows anything. Without it, a non-resizable accordion whose first sections are closed would build the model from inside the `contentHeightFor` callback, after those earlier sections had already been placed at the new width and reflowed. Sibling sections are independent subtrees, so in practice their reports would not move; the guard removes the need to rely on that. The model's position relative to `applyPendingSectionSizes` and the `_resizeSizes` prune inside `computeResizableHeights` does change — both write only `_resizeSizes`, which no stage of the model reads, so the values are identical either way.

[^measure-once]: Today one open section costs 3 `getPreferredSize` + 3 `getMinSize` + 3 `getMaxSize` per non-resizable pass (probe `A2`), because `computeShrinkRatio`, `computeFill` and `contentHeightFor` each fetch the same three numbers. Every fetch is an unmemoised recursive walk of the section's subtree. Sharing them is safe within a pass for the same reason `shrinkRatio` is already shared: the current code computes the ratio before `layoutSections` and applies it to a preferred height re-read during the loop, so it already assumes a section's reported size does not move mid-pass. Measuring once makes that assumption explicit instead of introducing it. This also closes finding F08.4 — `openContentHeight` is computed once per open section per pass rather than twice, which is exactly the 4 → 2 calls per frame the stubbing experiment recorded on S3.

[^by-construction]: Geometry has to be proved unchanged here, not merely observed unchanged. Three properties give that. First, `computeShrinkRatio`, `openContentHeight`, `computeFill` and `fillHeadroom` read component state and constraints and write nothing, so deferring them cannot change any other value. Second, the per-pass measure applies the same `100` / `0` / unbounded fallbacks the readers apply today, so the arithmetic is byte-identical input by input. Third, the build guard keeps the read point where it is. The tests carry the proof rather than the argument: behaviour 1 pins the documented formulas, behaviour 2 pins three consecutive passes to identical rectangles in both modes, and behaviours 3–7 cover the four cases the stubbing experiment never exercised — a section opened for the first time, a section reopened, a single open section, and none open.

[^border-restore]: `applyContainerTheming` writes the container's border on every pass, in both branches — a themed border when `themed` is on, an explicit `none` when it is off — so the accordion always takes the border over from whatever the container had. `detach` clears the headers, wrappers, gutters and stored sizes but leaves that border behind, so a manager swap leaves the host still painting the accordion's frame. Capturing in `attach` rather than at the first write keeps the recorded value from being the accordion's own: `attach` runs before any `doLayout`. A consumer that sets its own border *after* attaching loses it to the next pass today, so restoring the pre-attach value costs nothing that currently survives. The survives-the-detach test means an accordion detached from a container that holds no sections leaves the border in place; that is the same trade `Border.detach` makes, and diverging from it here would be worse than the leftover border.

[^keep-config]: The slice's F08.14 lists `_tools` and `_pendingSectionSizes` among the fields `detach` fails to clear, but clearing either would be a regression. `_tools` holds the consumer's global header tools, registered through `addTool` and re-applied to each header on hover; the detach loop itself reads `_tools` to release them from the headers it disposes, and a re-attached manager is expected to put them back. `_pendingSectionSizes` holds a caller's `applySectionSizes` request that has not yet reached a layout — `getSectionSizes` reads it directly at `:1004` — so dropping it on detach would silently discard a restore the caller asked for. `_resizePinned` is different: it holds references to section components that are going away, which is a real leak, and `_hoveredHeader` and `_resizeFactor` are per-layout scratch that indexes an array `detach` empties.
