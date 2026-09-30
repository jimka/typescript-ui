---
touches-shared:
  - packages/lib/src/typescript/lib/layout/BoxLayout.ts
  - packages/lib/src/typescript/lib/layout/VBox.ts
  - packages/lib/src/typescript/lib/layout/HBox.ts
---

# Box Layout Commit Drift — Implementation Plan

## Overview

`VBox` works out every child's height first and only then commits the children one by one. Each child's `y` is fixed before the commits start. A child can come out of its own commit taller than the height `VBox` worked out for it. When that happens, every later child still lands at its old `y` and overlaps it. This is the overlap measured on the docs site. On `/components/Image` a demo block lands 1909px inside the prose above it.

The mechanism, verified against current `master`:

1. `VBox.layoutPreferredMode` resolves every child's height into `heights[]` ([VBox.ts:439-454](packages/lib/src/typescript/lib/layout/VBox.ts#L439)). It advances its cursor by that resolved value ([VBox.ts:533-537](packages/lib/src/typescript/lib/layout/VBox.ts#L533)) and returns the full placement list. `doLayout` then commits the list ([VBox.ts:300](packages/lib/src/typescript/lib/layout/VBox.ts#L300)).
2. `LayoutManager.commitBounds` calls `setWidth` and then `setHeight` ([LayoutManager.ts:638-639](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L638)).
3. `Markdown.setWidth` re-measures synchronously when the width changes ([Markdown.ts:988-999](packages/lib/src/typescript/lib/component/display/Markdown.ts#L988)). `measureContentHeight` reads `scrollHeight` ([Markdown.ts:1106](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1106)), stores `_measuredHeight`, and schedules its parent's layout for the next frame ([Markdown.ts:1125-1126](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1125)). `Markdown.getMinSize` folds in `_measuredHeight` ([Markdown.ts:944-956](packages/lib/src/typescript/lib/component/display/Markdown.ts#L944)).
4. The `setHeight` call that follows clamps the box up to that new minimum ([Component.ts:4806-4820](packages/lib/src/typescript/lib/core/Component.ts#L4806)). The clamp applies because `clampsToContentSize()` is `true` for anything that is not a `Container` ([Container.ts:49-51](packages/lib/src/typescript/lib/core/Container.ts#L49)).
5. The block is now taller than the slot it was placed in. Every later child keeps its `y`. The parent pass that `Markdown` scheduled corrects the positions one frame later.

On a page's first pass an unmeasured `Markdown` reports no preferred size. `VBox` then gives it a 100px slot (`_defaultComponentHeight`, [VBox.ts:35](packages/lib/src/typescript/lib/layout/VBox.ts#L35)). The measured 1909px overlap is therefore a 2009px block placed in a 100px slot.[^frame-analysis]

Every number in this plan comes from a **production build** of the docs site (`npm run build:docs`, served by `vite preview`). A dev-server run of the same pages reproduced them value for value — same worst overlap, same worst clip, same frames — so the defect ships to a built site and is not a dev-server artefact.

This plan adds a *drift carry* to the commit step shared by `HBox` and `VBox`. A drift carry is a running total of how much each committed child differs from its resolved extent on the stacking axis. Every later child is shifted by that total. The change lives in [BoxLayout.ts](packages/lib/src/typescript/lib/layout/BoxLayout.ts) and covers both axes and both modes. Nothing public changes.

---

## Architecture Decisions

### Shift later siblings by the committed-minus-resolved difference, in the same pass

A new `BoxLayout.commitStackedPlacements(placements, horizontal)` commits the placements in order. Before each commit, it adds the running drift to the child's main-axis position. After each commit, it adds `committed extent − resolved extent` to the drift. `VBox` and `HBox` call it in place of `commitPlacements`.[^why-drift]

This mirrors how `VBox` handled the same problem before commit `83dfee04`: it advanced its cursor by `component.getHeight()` after each commit, so a child that grew during its commit pushed its siblings down. The `justify` change replaced that with the resolved height, and the calc/commit split ([plans/implemented/hbox-vbox-layout-calc-commit-split.md](plans/implemented/hbox-vbox-layout-calc-commit-split.md)) then fixed every position before any commit. The drift carry brings back the committed-extent result without undoing either change.[^precedent]

### Measure drift against the child's own resolved extent, never its cell

The drift compares the committed extent with `placement.height` (vertical) or `placement.width` (horizontal). It never compares with the cell step between two placements. A child with `fill: NONE` that is smaller than its cell has no drift and must not pull later siblings back into the slack.[^cell-vs-extent]

### The fix lives in `BoxLayout`, and covers `HBox` and `VBox` together

`commitStackedPlacements` takes the same `horizontal: boolean` parameter that `aggregateMaxSize` and `crossPlacement` already take ([BoxLayout.ts:355](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L355), [BoxLayout.ts:600](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L600)). `LayoutManager.commitPlacements` is not changed. Its other callers (`Absolute`, `Anchor`, `Grid`, `HFlow`, `VFlow`) do not stack children along one axis.[^where]

The width arm (`HBox`, where a child would have to grow wider during its commit) has no library component that triggers it today. `commitBounds` writes width before height, so a clamp cannot grow a width during the commit. Only a child that re-sets its own width inside `setHeight` or its own `doLayout` can. The width arm ships and is tested anyway, with a test-only child that does exactly that.[^width-arm]

### `commitBounds` keeps writing width before height

The order in [LayoutManager.ts:638-639](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L638) does not change.[^order]

### Render cost

Each committed child costs one cached-field read (`getHeight()` / `getWidth()`) and one subtraction. There are no new DOM reads or writes, and no extra layout passes. When nothing grows, the drift is 0 and every commit gets the same arguments as before, byte for byte. When a child grows, later siblings move to their correct place in the same pass. The corrective pass that `Markdown` still schedules then finds their rectangles unchanged and moves nothing. Today that corrective pass moves every later sibling, and those moves take `commitBounds`' translate path, which causes one more pass to fold the translate back.[^cost]

---

## Public API

No public API changes. One new protected member on `BoxLayout`:

```typescript
export abstract class BoxLayout extends LayoutManager {
    protected commitStackedPlacements(placements: ResolvedPlacement[], horizontal: boolean): void;
}
```

`ResolvedPlacement` is imported as a type from `~/layout/LayoutManager.js`.

---

## Implementation

```typescript
protected commitStackedPlacements(placements: ResolvedPlacement[], horizontal: boolean): void {
    let drift = 0;

    for (const placement of placements) {
        const component = placement.component;
        const x = horizontal ? placement.x + drift : placement.x;
        const y = horizontal ? placement.y : placement.y + drift;

        this.commitBounds(component, x, y, placement.width, placement.height);

        const committed = horizontal ? component.getWidth() : component.getHeight();
        const resolved  = horizontal ? placement.width : placement.height;

        drift += committed - resolved;
    }
}
```

- Read the committed extent **after** `commitBounds` returns. `commitBounds` also runs the child's own `doLayout`, so a size change made there is included.
- The drift adds up across children (`+=`). It is never reset inside the loop.
- The drift moves only the main-axis coordinate (`y` for `VBox`, `x` for `HBox`). The cross-axis coordinate and both sizes pass through unchanged.

JSDoc for the method: a description of the behaviour, a blank line, then `@param` for both parameters. Add a `@remarks` that names the case it exists for: a child whose own `setWidth` raises its minimum height, so the `setHeight` clamp grows it past its resolved slot (`Markdown`'s re-measure). The method is `protected`, so TypeDoc leaves it out and links to internal symbols are allowed in its own JSDoc.

---

## Ordered Implementation Steps

1. **Write the regression tests first.** Create `packages/lib/tests/component/layout/BoxLayout.commitDrift.test.ts` with cases T1–T6 from `## Expected Behaviour`. Follow the setup in [LayoutManager.commitBounds.test.ts:23-44](packages/lib/tests/component/layout/LayoutManager.commitBounds.test.ts#L23): the same `CONFIG`, and a host `Container` with `getElement(true)`, `setWidth`, `setHeight`, `clearInsets()`. Rules for this file:
   - Call `installTestDOM(CONFIG)` in `beforeEach`.
   - In `afterEach`, first `dispose()` every host the test created (collect them in an array the helper fills), then call `DOM.reset()`. Disposing the host disposes its `Markdown` children, which removes their theme listeners.
   - Use **no** `vi.spyOn`. Seed `Markdown`'s content height only with `setScrollExtent(handle, { width: 0, height: N })` from `tests/dom/TestDOM`. Get `handle` from `md.getElement(true)!` after the `Markdown` is added to a rendered host.
   - Read a true position as `c.getX() + c.getTranslateX()` / `c.getY() + c.getTranslateY()`, following the idiom in that file's header.
   - Use `itemAlign: "stretch"` rather than the deprecated `stretching` option.
2. Run `npx vitest run tests/component/layout/BoxLayout.commitDrift.test.ts` from `packages/lib`. Expect T1–T5 **red**, each failing with the pre-fix number in the table, and T6 green. If a red case fails with any other number, stop: the fixture does not reproduce the defect. Fix the fixture before touching source.
3. **`packages/lib/src/typescript/lib/layout/BoxLayout.ts`**: add `import type { ResolvedPlacement } from "~/layout/LayoutManager.js";` (or add `type ResolvedPlacement` to the existing `LayoutManager` import). Add `commitStackedPlacements` as shown in `## Implementation`, next to `justifyOffsets`.
4. **`packages/lib/src/typescript/lib/layout/VBox.ts`**:
   - In `doLayout`, replace `this.commitPlacements(placements);` ([VBox.ts:300](packages/lib/src/typescript/lib/layout/VBox.ts#L300)) with `this.commitStackedPlacements(placements, false);`. This one call site covers both modes. Keep it in `doLayout`.
   - Rewrite the comment at [VBox.ts:533-535](packages/lib/src/typescript/lib/layout/VBox.ts#L533). The new comment says the calc loop advances by the resolved height so the justify gap stays exact, and that a child which grows during its own commit is handled by `commitStackedPlacements` carrying the difference onto later children.
   - Change `{@link LayoutManager.commitPlacements}` in the `@returns` of `layoutEqualMode` and `layoutPreferredMode` to `{@link BoxLayout.commitStackedPlacements}`. Both methods are private, so there is no docs impact.
5. **`packages/lib/src/typescript/lib/layout/HBox.ts`**: make the same three edits. Use `this.commitStackedPlacements(placements, true);` at [HBox.ts:301](packages/lib/src/typescript/lib/layout/HBox.ts#L301), and rewrite the comment at [HBox.ts:561-563](packages/lib/src/typescript/lib/layout/HBox.ts#L561).
6. Check: `grep -n "commitPlacements(" packages/lib/src/typescript/lib/layout/VBox.ts packages/lib/src/typescript/lib/layout/HBox.ts` finds no code call sites (only doc text, if any). `grep -c "commitStackedPlacements(placements" packages/lib/src/typescript/lib/layout/VBox.ts packages/lib/src/typescript/lib/layout/HBox.ts` reports exactly 1 per file.
7. Re-run the new test file. All six cases must be green.
8. **Prove each assertion can fail** by applying each mutation in the `## Expected Behaviour` mutation table, one at a time. For each, run the new file, confirm the named case goes red, then revert. Record the results in the plan's implementation notes. Do this with plain source edits. Do not use spies.
9. Run the full verification in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/BoxLayout.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/VBox.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/HBox.ts` |
| Create | `packages/lib/tests/component/layout/BoxLayout.commitDrift.test.ts` |

---

## Expected Behaviour

All six cases are offline and unit-testable. Every host is a `Container` with insets cleared, so the first cell starts at `(0, 0)`. Every layout manager uses `spacing: 0`. "Pre-fix" is the number the assertion gets on current `master`. It is pinned so that each assertion has something to fail from.

**Fixtures.**

- `md(extent)`: a `new Markdown('# A')` added to the host. After adding, `setScrollExtent(md.getElement(true)!, { width: 0, height: extent })`.
- `box(w, h)`: `new Component({ preferredSize: { width: w, height: h } })`.
- `WidthOnHeightLeaf`: a test-local `class extends Component`. It has `declare private _widthAfterHeight: number | undefined;` and an `armWidthAfterHeight(width: number): void` that sets the field. It overrides `setHeight(height)` as follows: call `super.setHeight(height)`, then call `super.setWidth(this._widthAfterHeight)` when the field is not `undefined`, then return `this`. This child re-sets its own width during its commit. It stands in for the width arm, which has no trigger in the library.

**Cases.** Before asserting any position, assert that the growing child really grew (`A.getHeight()` / `A.getWidth()` equals the "A committed" value). A fixture that fails to reproduce the defect then fails loudly, instead of passing the position checks for the wrong reason.

| # | Host and layout | Children (in order) | A committed | Assertion | Pre-fix | Post-fix |
|---|---|---|---|---|---|---|
| T1 | 400×5000, `VBox({ spacing: 0, itemAlign: "stretch" })`; one `host.doLayout()` | A = `md(2009)`, B = `box(100, 50)`, C = `box(100, 50)` | height 2009 | B true y / C true y / B true x | 100 / 150 / 0 | **2009 / 2059 / 0** |
| T2 | as T1 with A = `md(500)`: `doLayout()` twice. Then `host.setWidth(300)`, re-seed A's extent to 1230, `doLayout()` once | A, B = `box(100, 50)` | height 1230 after the third pass | B true y after the third pass | 500 | **1230** |
| T3 | 400×300, `VBox({ mode: "equal", spacing: 0, itemAlign: "stretch" })`; one pass | A = `md(2009)`, B = `box(100, 50)`, C = `box(100, 50)` | height 2009 | B true y / C true y | 100 / 200 | **2009 / 2109** |
| T4 | 1000×40, `HBox({ spacing: 0, itemAlign: "start" })`; one pass | A = `WidthOnHeightLeaf` with preferred 100×40, armed to 300; B = `box(50, 40)`; C = `box(50, 40)` | width 300 | B true x / C true x / B true y | 100 / 150 / 0 | **300 / 350 / 0** |
| T5 | 300×40, `HBox({ mode: "equal", spacing: 0, itemAlign: "start" })`; one pass | same as T4 | width 300 | B true x / C true x | 100 / 200 | **300 / 400** |
| T6 | 400×300, `VBox({ mode: "equal", spacing: 0, itemAlign: "stretch" })`; one pass | A = `box(100, 50)`; B = `box(100, 40)` added with `{ fill: FillType.NONE, anchor: AnchorType.NORTHWEST }`; C = `box(100, 50)` | B height 40 inside a 100px cell | C true y | 200 | **200** (green both sides) |

T1 reproduces the first sampled frame (t=405ms): a 2009px block in a 100px default slot, 1909px overlap. T2 reproduces the frame at t=551ms: a block measured at one width and re-measured 730px taller mid-commit after its width changed. T6 is a guard. It does not reproduce the defect. It exists only to kill mutation M7.

**Mutation table.** Each mutation must turn the named case red (step 8). No assertion here compares zero with zero or counts calls. Each one checks a resulting position.

| Mutation (source edit) | What it models | Red case(s) |
|---|---|---|
| M1: `VBox.doLayout` keeps `commitPlacements` | fix missing on the vertical arm | T1, T2, T3 |
| M2: `HBox.doLayout` keeps `commitPlacements` | fix missing on the horizontal arm | T4, T5 |
| M3: `drift += resolved - committed` | sign flipped | T1, T4 |
| M4: `drift = committed - resolved` (no accumulation) | only the next sibling is shifted | T1 (C), T4 (C) |
| M5: VBox passes `true` / HBox passes `false` | axis swapped | T1, T4 |
| M6: drift added to both `x` and `y` | cross axis also shifted | T1 (B x), T4 (B y) |
| M7: drift measured against the cell step (`nextPlacement.y - placement.y`) instead of `placement.height` | anchored child pulls siblings into its slack | T6 |
| M8: `layoutEqualMode`'s result committed through `commitPlacements` (separate call site per mode) | one of two modes left out | T3, T5 |

**Manual (browser) confirmation, one-off.** This is not the acceptance test. After the fix, re-run the frame-sampling script on `/components/Image` and `/layouts/Absolute` with `ignoreCache`, against a production build (`npm run build:docs`, served by `vite preview`) — the configuration the numbers below were taken in. Expected:

- No frame shows a demo overlapping its previous sibling. The frames that showed 1909 / 877 / 730 on Image and 968.8 / 176 on Absolute show 0. The overlap transient is the first ~600ms of the page's life, so this is the whole of what the fix removes.
- A clip frame like the one at t=517ms (the previous sibling clipped up to 730px while nothing overlaps) **may still appear**. It comes from content outgrowing its box between two layout passes, and this fix does not change that.
- A **10px** clip is still expected after the overlap has gone, clearing by about 2.7s, together with the `CodeEditor` guessed-height warning in the console. That clip is a different mechanism and must not be read as a failure of this fix. See `## Non-Goals`.

---

## Verification

Run from the worktree root unless stated otherwise:

- `npm run typecheck`
- `npm run lint`
- `npm test`. This runs the full lib suite, including the existing `VBox.test.ts`, `HBox.test.ts`, and `LayoutManager.commitBounds.test.ts`. They must stay green. The fast-path test there has zero drift, so its translate assertions still apply.
- `npx vitest run tests/component/layout/BoxLayout.commitDrift.test.ts` from `packages/lib`, plus the step 8 mutation results.
- `npm run build:lib`
- `npm run docs:api`. It must finish with zero warnings.
- `npm -w packages/docs test`. Run it after `docs:api`, because it depends on the generated API files. Never invoke vitest with a bare `--root`.

---

## Potential Challenges

- **`justify` other than `start`, and weight cells.** When a child grows mid-commit, the drift pushes the trailing children past where `justify: "end"` or a weight cell would have put them, until the next pass. The growing component has to announce its change, as `Markdown` already does through `scheduleLayout`, and that next pass re-resolves the positions. An overflowing trailing edge for one frame is strictly better than an overlap.
- **A child that grows on every pass** (like `WidthOnHeightLeaf`) gets drift on every pass. Positions stay correct, and it costs no more than any other move.
- **`Markdown` is not measured until it has an element.** In T1–T3, seed the extent only after the `Markdown` is in a rendered host (see step 1). Seeding a handle that does not exist yet fails.
- **Offline `scrollHeight`.** `setScrollExtent` stores a fixed number, and `measureContentHeight`'s `height: auto` collapse does not affect it ([TestDOM.ts:1415-1428](packages/lib/tests/dom/TestDOM.ts#L1415)). T2 therefore re-seeds between passes to model the width change. It does not model reflow itself. That is enough, because the defect depends only on *when* the measured value changes, not on how the browser computes it.

---

## Critical Files

- [packages/lib/src/typescript/lib/layout/BoxLayout.ts](packages/lib/src/typescript/lib/layout/BoxLayout.ts): the new method's home. It shows the `horizontal: boolean` convention (`aggregateMaxSize`, `crossPlacement`).
- [packages/lib/src/typescript/lib/layout/VBox.ts:426-541](packages/lib/src/typescript/lib/layout/VBox.ts#L426) and [HBox.ts:440-569](packages/lib/src/typescript/lib/layout/HBox.ts#L440): the calc loops. They stay unchanged apart from comments.
- [packages/lib/src/typescript/lib/layout/LayoutManager.ts:601-672](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L601): `commitBounds` (write order, fast path, recursion) and `commitPlacements`, which the new method mirrors.
- [packages/lib/src/typescript/lib/component/display/Markdown.ts:944-1127](packages/lib/src/typescript/lib/component/display/Markdown.ts#L944): the real trigger (`getMinSize`, `setWidth`, `measureContentHeight`).
- [packages/lib/tests/component/layout/LayoutManager.commitBounds.test.ts](packages/lib/tests/component/layout/LayoutManager.commitBounds.test.ts): the host helper and true-position idiom to copy.
- [plans/implemented/hbox-vbox-layout-calc-commit-split.md](plans/implemented/hbox-vbox-layout-calc-commit-split.md): why placements are resolved before commit, and which ordering constraints the split keeps.
- Commit `83dfee04` (`git show 83dfee04 -- '*VBox.ts'`): the precedent. `VBox` advanced by `getHeight()` until this commit.

---

## Non-Goals

- **The `CodeEditor` guessed-height correction is out of scope.** Before this fix the overlap clears about 600ms after first paint on the measured pages. One effect outlives it, and this fix does not shorten it: a **10px** clip, still present at 1.7s and gone by 2.7s. It is the deferred fenced-code upgrade correcting the height it guessed from the placeholder `<pre>`, and the component reports the correction itself — `Markdown: fenced "javascript" code block's CodeEditor corrected its guessed height by 10px (97px → 106.9375px) on mount` — so a reader has the size and the source without re-measuring anything. Whether 10px for two seconds earns its own change is that reader's call; this plan does not touch it.[^tail]
- **The between-passes clip is out of scope** (the 730px clip at t=517ms). This is content that grows past its box before any code re-measures it: a width change reflowing prose, or a `CodeEditor` correcting its guessed height ([Markdown.ts:1209-1261](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1209)). No layout-manager change can move a box before the component knows it grew.
- **`HFlow`/`VFlow`, `Grid`, `Border`, `Split` are out of scope.** Each also sizes children before committing them, but the correction would have a different shape (per line, per track, per region). No reproduction has been measured for any of them.[^other-managers]
- **`LayoutManager.commitPlacements` and `commitBounds` stay unchanged.** That covers their signatures, bodies, and the width-then-height order.
- **`Markdown` keeps measuring inside `setWidth`, and keeps scheduling its parent's pass.** Both still matter: the scheduled pass is how an ancestor's scroll extent and a `justify`/weight layout catch up.
- **`docs-demo-prose-alignment` stays as it is.** The measurement showed the overlap numbers are byte-identical with the demo padding removed. Nothing in that plan's change should be reverted.

---

## Addendum: Frame-by-frame reading of the measurement

These readings come from the code paths above, applied to a production build of the docs site sampled every animation frame. A dev-server run gave the same pixel values at the same frames.

| frame | t (ms) | sidebar width | prose block widths | max overlap | max clip |
|---|---|---|---|---|---|
| 2 | 405 | 1 | 114, 594, 158, 205, 148, 119, 222 | 1909 | 0 |
| 3 | 517 | 320 | 683 ×7 | 877 | 730 |
| 4 | 551 | 320 | 683 ×7 | 730 | 1 |
| 5 | 594 | 320 | 683 ×7 | 0 | 1 |

- **Frame 2 (t=405ms): first layout.** Every `Markdown` is unmeasured. `Markdown.getPreferredSize` returns the base value, which is `null` ([Markdown.ts:966-978](packages/lib/src/typescript/lib/component/display/Markdown.ts#L966); a plain `Component`'s default `Absolute` manager has no preferred size, [LayoutManager.ts:181-183](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L181)). `preferredChildHeight` then falls back to `_defaultComponentHeight = 100` ([VBox.ts:625-631](packages/lib/src/typescript/lib/layout/VBox.ts#L625)). Each block's commit changes its width from `NaN`, measures, and clamps up. The overlap is `measured − 100`: 2009 − 100 = 1909 for the second demo's prose block. T1 is this frame.
- **The width that triggers the re-measure is the sidebar's, and it is observed.** Inside a commit, the only thing that changes `_measuredHeight` and is then followed by a `setHeight` clamp is `setWidth` with a changed width. `onFirstLayout`, the theme listener, and the scheduled measure all re-measure outside the clamp, and `measureContentHeight` restores the old box height there ([Markdown.ts:1108-1119](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1108)). Between frames 2 and 3 the sidebar (`Border` WEST, [DocsShell.ts](packages/docs/src/shell/DocsShell.ts)) resolves from **1px to 320px**, which re-sizes the content pane, and every prose block's width goes from its own unresolved value (114–594px, one per block) to a uniform 683px. That width change is what reaches `Markdown.setWidth` mid-commit.
- **The web font is excluded as the trigger.** `document.fonts.ready` resolved at t=22ms and the last `loadingdone` fired at t=151ms — both before the first sampled frame at t=405ms, so the fonts were already active for every frame that overlaps. What resolves the sidebar from 1px to 320px has not been traced, and the fix does not depend on which width change it is, only on a width change arriving while `_measuredHeight` is stale.
- **Frame 4 (t=551ms): overlap 730, which is frame 3's clip 730.** Prose had grown 730px past its box by frame 3 with nothing re-measuring it; the next pass picked that growth up mid-commit and left every later block at its old `y`. T2 is this shape. Frame 3 itself carries both mechanisms at once (overlap 877 *and* clip 730) within the ~112ms between samples.
- **Frame 5 (t=594ms) onward: no overlap.** A 10px clip remains until between 1.7s and 2.7s — see `## Non-Goals`.

---

## Notes

[^frame-analysis]: The brief's citations were read before the fifteen-branch merge. Several have moved: `Markdown.setWidth` (981-995 → 988-999), `measureContentHeight`'s read (1097-1106 → 1090-1106), `clampHeight` (4801-4817 → 4806-4820). The others match. The 100px default slot is new. It explains why the first frame's numbers are so large, and gives T1 its exact pre-fix value. See `## Addendum: Frame-by-frame reading of the measurement`.

[^why-drift]: Four other fixes were considered and rejected.
    **Commit height before width:** `setHeight` would clamp against the old minimum, and the measure in `setWidth` would come too late to re-clamp. The block would clip instead of overlap until the corrective pass. `Image`'s same-pass height floor ([Image.ts:888-918](packages/lib/src/typescript/lib/component/display/Image.ts#L888)) and `Markdown`'s restore logic ([Markdown.ts:1108-1119](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1108)) also both depend on width being written first.
    **Have a synchronous re-measure restart the pass:** this re-resolves and re-commits every child, including each child's `doLayout` recursion, once per grown child. On a first paint every prose block grows, so the cost is O(n²) commits. That is far more than the one-frame overlap it removes.
    **Stop freezing heights (resolve inside the commit loop):** this undoes the calc/commit split and the `justify` gap arithmetic, for the same positions the drift carry produces.
    **Report height-for-width from `Markdown.getPreferredSize`:** there is no width parameter to answer with, and the library has no height-for-width negotiation. That would be a new public protocol.
    The drift carry is O(1) per child and needs no new pass.

[^precedent]: `git show 83dfee04 -- '*VBox.ts'` shows `y += component.getHeight();` replaced by `y += heights[idx];`. At the time `placeComponent` committed inside the loop, so `getHeight()` was the committed height. That commit's message states the change left "today's behaviour byte-identical" for the non-justify path; in this one case it did not. It moved to the resolved extent because the justify gap arithmetic had to be exact, which is why the fix cannot simply read `getHeight()` again and must keep the exact gap arithmetic while still absorbing commit-time growth — what the drift carry does. The new comment's reason ("the gap is measured against the same extent contentHeight summed") is still valid for the calc loop. The drift carry keeps that arithmetic and adds back the result the old read gave. The library's other route for "a commit invalidated what I computed" is the growing component's own `scheduleLayout` ([Component.ts:8190](packages/lib/src/typescript/lib/core/Component.ts#L8190)). It always lands a frame later, which is the one-frame overlap. The pass-number reset in `endLayoutPassNumber` refreshes size-hint caches, not placements. So nothing already in the library corrects positions within the same pass.

[^cell-vs-extent]: In equal mode, and in preferred mode when a child's constraints set a `fill` other than `BOTH`, `resolveBounds` can return a child smaller than its cell ([LayoutManager.ts:412-537](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L412)). The child then sits inside its cell with room to spare. Comparing against the cell would give a negative drift for every such child on every pass, pulling later siblings upward into overlap. Comparing against `placement.height` gives 0. For a child that grows while smaller than its cell, the drift carry shifts siblings by the full growth even when some of it would have fit in the spare room. That may leave a small gap until the next pass, but it never causes an overlap.

[^where]: `Absolute` and `Anchor` place each child independently, so a drift carry would move children that do not depend on one another. `Grid` and the flow managers would need a correction per row or per line, not per child. Putting the carry into the shared helper would therefore be wrong for two of its callers and incomplete for the rest. `BoxLayout` is the lowest class that owns "children stacked along one axis".

[^width-arm]: Every `setWidth` override in the library was checked: `Markdown`, `Image`, `Footer`, and `AbstractWindow`. Only `Markdown` and `Image` re-derive the other axis. Both re-derive *height* from width, which is the vertical arm. `Image.setHeight` re-derives width but only publishes it as a preferred size and a floor for the next pass ([Image.ts:849-859](packages/lib/src/typescript/lib/component/display/Image.ts#L849)). It does not write the width during the commit. `Image` with `preserveAspectRatio` inside a `VBox` is a second, inferred trigger for the vertical arm: its `setWidth` raises a height floor that `setHeight` clamps to. It is not measured here, and the same fix covers it. The width arm is tested with a synthetic child. Applying one shared helper to both managers keeps the two arms from drifting apart when either one is edited later.

[^order]: Writing width first is what lets a width-dependent component (such as `Markdown` or `Image`) settle its height inside the same commit rather than clip. With the drift carry, that same-commit growth now also moves the siblings. Reversing the order would swap one wrong frame for another (overlap for clip) and break `Image`'s same-pass floor.

[^cost]: No in-engine measurement is required for acceptance. The steady state is unchanged: drift 0, the same `commitBounds` arguments, and no added DOM access. The first-paint transient does strictly less work. The measured pages settle their overlap one pass earlier, and the later siblings are no longer moved a second time. `getHeight()` builds a small object through `getSize()` ([Component.ts:3740-3745](packages/lib/src/typescript/lib/core/Component.ts#L3740)). That is negligible next to `commitBounds`' own six getter reads of the same kind ([LayoutManager.ts:604-609](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L604)).

[^tail]: The overlap is gone by t=594ms. What outlives it is a 10px clip, present from t=635ms and absent by t=2671ms; the samples between those two are 1s apart, so it can only be placed between 1.7s and 2.7s. It is the fenced-code `CodeEditor` upgrade: the mount guesses the block's height from the placeholder `<pre>` ([Markdown.ts:1219-1261](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1219)), CodeMirror's own measurement corrects it on `heightchange`, and a coalesced re-measure follows ([Markdown.ts:1592-1612](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1592)). The component logs the correction at t=599ms: `Markdown: fenced "javascript" code block's CodeEditor corrected its guessed height by 10px (97px → 106.9375px) on mount.` Import latency is not the tail — the last JS chunk finished at t=577ms — and neither is font activation. Two further sources produce the same clip-shaped effect on other pages: a block queued behind the one-viewport lookahead ([Markdown.ts:136](packages/lib/src/typescript/lib/component/display/Markdown.ts#L136)), and a fractional CodeMirror line height read against an integer `scrollHeight`. Every one of them re-measures outside a `VBox` commit and restores the old box height, so each shows up as a clip and a scheduled pass, never as an overlap. A figure of 7.3s for this tail is a sampling artefact and should not be reproduced: a backgrounded tab throttles `requestAnimationFrame` to about 1Hz once the page goes idle, which stretches four idle samples into seven seconds.

[^other-managers]: Findings per manager, from reading each one's placement code:

    | Manager | Sizes ahead of commit | A sibling can be overlapped by in-commit growth | Status |
    |---|---|---|---|
    | `VBox` / `HBox` | yes (`heights[]` / `widths[]`) | yes | fixed here |
    | `HFlow` / `VFlow` | yes (`groupIntoRows`, [HFlow.ts:295](packages/lib/src/typescript/lib/layout/HFlow.ts#L295)) | yes, the next line | not fixed, no reproduction |
    | `Grid` | yes (`resolveTracks`, [Grid.ts:736-737](packages/lib/src/typescript/lib/layout/Grid.ts#L736)) | yes, the next track | not fixed, no reproduction |
    | `Border` | yes (region extents, [Border.ts:1416-1585](packages/lib/src/typescript/lib/layout/Border.ts#L1416)) | yes in principle; regions are usually `Panel`s, which do not clamp to content | not fixed |
    | `Split` | pane sizes come from the divider, not from content | only by a child clamping past its pane | not fixed |
    | `Card` / `Fit` / `Tab` | one visible child | no | immune |
    | `Absolute` / `Anchor` | positions do not depend on siblings | no | immune |

    `HFlow` and `VFlow` are a symmetric pair and are left out together, so no single arm of a pair ships alone.
