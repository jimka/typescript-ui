# Box-Child Clamp Ordering — Implementation Plan

## Overview

Three layout managers size a child by clamping to its minimum first and its maximum second, so the maximum wins when the two conflict. Everywhere else in the framework the minimum wins. The mismatch is visible today: on the docs app's `/components/ComboBox` and `/components/LabeledFieldSet` pages the "Show source" toggle is drawn on top of the demo frame instead of below it.

The fix swaps the two clamps in [`VBox.resolveChildHeight`](packages/lib/src/typescript/lib/layout/VBox.ts#L585), [`HBox.resolveChildWidth`](packages/lib/src/typescript/lib/layout/HBox.ts#L613), and [`FlowLayout.clampedPreferredSize`](packages/lib/src/typescript/lib/layout/FlowLayout.ts#L337), so all three match [`Component.clampPreferredToConstraints`](packages/lib/src/typescript/lib/core/Component.ts#L2709) and [`Component.clampWidth`](packages/lib/src/typescript/lib/core/Component.ts#L3281).

The change is narrow by construction: the two orderings give the same answer whenever `min ≤ max`, so only a child whose minimum exceeds its maximum behaves differently.[^only-degenerate]

---

## The rule

A child's placed extent is clamped into `[min, max]`. When `min > max` — a contradictory pair the framework accepts without complaint — the minimum wins.

| min | max | requested | Today (min, then max) | After (max, then min) |
|---|---|---|---|---|
| 40 | 200 | 120 | 120 | 120 |
| 40 | 200 | 10 | 40 | 40 |
| 40 | 200 | 900 | 200 | 200 |
| **120** | **47** | 120 | **47** | **120** |

Only the last row moves. The first three are the ordinary `min ≤ max` cases, where both orderings reduce to the same clamp.

---

## Architecture Decisions

### The minimum is the hard floor — the three box sites are the outliers

Swap the clamps so the minimum is applied last in all three managers.[^min-is-floor] The framework already states this rule twice in `Component`: [`clampPreferredToConstraints:2713-2721`](packages/lib/src/typescript/lib/core/Component.ts#L2713) caps to the maximum then floors to the minimum, and [`clampWidth:3285-3292`](packages/lib/src/typescript/lib/core/Component.ts#L3285) does the same for the committed size. `plans/implemented/size-constraint-invariant.md` names the rule outright: "An explicit `minSize` always wins, because min is the hard floor every other clamp already treats as authoritative."

### The cross-axis clamps stay as they are

`VBox` and `HBox` clamp the *cross* axis to the maximum only, with no minimum floor at all — [`VBox.ts:481-483`](packages/lib/src/typescript/lib/layout/VBox.ts#L481) and [`HBox.ts:462-464`](packages/lib/src/typescript/lib/layout/HBox.ts#L462). Leave both untouched.[^cross-axis-deliberate]

### No setter-time warning for a contradictory pair

`setMinSize` and `setMaxSize` still accept `min > max` silently. Do not add validation.[^no-setter-warning]

---

## The failure this fixes

A component that sets a hard maximum on itself can shrink an ancestor's cell below the size that ancestor explicitly demanded.

The docs app's demo block is the live case. [`DocsDemo`](packages/docs/src/shell/DocsDemo.ts) stacks a bordered stage above a "Show source" toggle in a `VBox`, and gives the stage an explicit `minSize.height` — 120px on the ComboBox page. The chain that breaks it:

1. [`ComboBox.ts:736`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L736) calls `setMaxSize` on itself with a hard height.
2. The stage's layout manager is a `Fit`, and [`Fit.getMaxSize:104`](packages/lib/src/typescript/lib/layout/Fit.ts#L104) reports its child's maximum as its own. The stage's merged maximum height therefore becomes about 47px.
3. `VBox.resolveChildHeight` floors the stage's cell to its 120px minimum, then caps it to that 47px maximum. The cell is 47px.
4. `VBox` places the toggle at `stage top + 47`, and advances no further.
5. The stage element itself is then committed through `clampHeight`, which applies the minimum last and restores 120px.

Steps 3 and 5 disagree, and the toggle lands 73px inside the frame. After the swap, step 3 yields 120px and the toggle sits below it.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/layout/VBox.ts`** — in `resolveChildHeight` (lines 597-603), move the `if (maxSize)` block above the `if (minSize)` block so the minimum is applied last. Update the method's docblock sentence "clamped to its min/max" to state that the minimum wins when the two conflict.
2. **`packages/lib/src/typescript/lib/layout/HBox.ts`** — apply the same swap in `resolveChildWidth` (lines 625-631), with the same docblock update.
3. **`packages/lib/src/typescript/lib/layout/FlowLayout.ts`** — apply the same swap in `clampedPreferredSize` (lines 345-353), with the same docblock update. This is the base class for `HFlow` and `VFlow`, so both inherit the fix.
4. **Check no fourth site was missed.** `grep -n "Math.max(.*minSize\?\." packages/lib/src/typescript/lib/layout/*.ts` and confirm every hit that is followed by a `Math.min(… max…)` on the same value is one of the three above.
5. **Write the unit tests** from `## Expected Behaviour` before making any of the edits above, per the project's test-first rule.
6. **Run the layout suite**, then the full library suite (`## Verification`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/VBox.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/HBox.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/FlowLayout.ts` |
| Modify | `packages/lib/tests/component/layout/VBox.test.ts` |
| Modify | `packages/lib/tests/component/layout/HBox.test.ts` |
| Modify | `packages/lib/tests/component/layout/HFlow.test.ts` |

---

## Expected Behaviour

All six cases are unit-testable offline; none needs a browser. Cases 1-3 must pass both before and after the change — they are the guard that the ordinary path did not move.

1. **`VBox`, `min ≤ max`, child fits.** A column 400px tall holds one child with `minSize.height` 40 and `maxSize.height` 200, preferring 120. The child is placed 120px tall.
2. **`VBox`, `min ≤ max`, request below the minimum.** Same child preferring 10px. The child is placed 40px tall.
3. **`VBox`, `min ≤ max`, request above the maximum.** Same child preferring 900px. The child is placed 200px tall.
4. **`VBox`, `min > max`.** A child with `minSize.height` 120 and `maxSize.height` 47 is placed **120px** tall, not 47px.
5. **`HBox`, `min > max`.** The width mirror of case 4: `minSize.width` 120 against `maxSize.width` 47 places the child 120px wide.
6. **`HFlow`, `min > max`.** A flow child with `minSize` 120×120 and `maxSize` 47×47 is placed at 120×120 on both axes, exercising `FlowLayout.clampedPreferredSize` through a subclass.

Additionally, a **manual check** the tests cannot reach: with the library rebuilt, `/components/ComboBox` and `/components/LabeledFieldSet` in the docs app must draw the "Show source" toggle *below* the demo frame, not on top of it.

---

## Verification

- `npm run typecheck` in `packages/lib`.
- `npx vitest run tests/component/layout` in `packages/lib` — the layout suite, which is where a cell-sizing regression surfaces first.
- `npx vitest run` in `packages/lib` — the full suite. A change to how box managers resolve a cell reaches far more than the layout tests, so a green layout suite alone is not enough.
- `npx vitest run` in `packages/docs`.
- **Manual, in the docs app.** `packages/lib` must be rebuilt first: the docs dev server resolves `@jimka/typescript-ui` through the package's `exports` map to `dist/`, so an edit to `packages/lib/src` is invisible to the browser until `npm run build` runs in `packages/lib`.[^rebuild-required] Then start the docs dev server and open `/components/ComboBox` and `/components/LabeledFieldSet`, and confirm the toggle sits below the frame on both. Check `/components/Slider` too — it has the same block shape with a non-degenerate child, and must be unchanged.

---

## Potential Challenges

- **A component relying on the maximum to shrink an ancestor.** If some component in the library sets a maximum smaller than an ancestor's explicit minimum and depends on winning, the full suite catches it as a size assertion moving. Treat any such failure as a second instance of this same bug and fix the offending constraint pair — do not restore the old ordering for one call site.
- **The library ships a build artefact.** Anyone verifying in the browser without rebuilding `packages/lib` will see no change and conclude the fix does not work.
- **`Grid` and `Border` are not in scope but sit nearby.** Neither resolves a cell through the swapped shape ([`Grid.ts:582`](packages/lib/src/typescript/lib/layout/Grid.ts#L582) accumulates a track maximum, not a clamp), so leave both alone; a grep during step 4 that hits them is a false positive.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts:2709`](packages/lib/src/typescript/lib/core/Component.ts#L2709) — `clampPreferredToConstraints`, the precedent the three managers must match. Read its docblock: it states the minimum-wins rule and why the floor is applied last.
- [`packages/lib/src/typescript/lib/core/Component.ts:3281`](packages/lib/src/typescript/lib/core/Component.ts#L3281) — `clampWidth`, the same ordering on the committed size. This is the clamp that disagrees with the managers today.
- `plans/implemented/size-constraint-invariant.md` — the plan that established the `min ≤ preferred ≤ max` envelope. Its "Conflict-precedence rule" section is the source of the minimum-wins rule.
- `plans/implemented/docs-component-demo-set.md` — its closing addendum records the symptom and the diagnosis this plan acts on.
- [`packages/lib/src/typescript/lib/layout/VBox.ts:585`](packages/lib/src/typescript/lib/layout/VBox.ts#L585) — the first of the three sites; `HBox` and `FlowLayout` are line-for-line parallels.

---

## Non-Goals

- **Any change to the cross-axis clamps.** Their maximum-last ordering is deliberate; see `## Architecture Decisions`.
- **Validating `min > max` at the setter.** Out of scope, and already recorded as a known gap by `size-constraint-invariant.md`.
- **Changing `ComboBox`'s own maximum.** `ComboBox.setMaxSize` is a legitimate self-constraint. This plan fixes how ancestors respond to it, not the constraint.
- **The docs app.** No file under `packages/docs` changes; the demo pages are the check, not the fix.

---

## Notes

[^only-degenerate]: `min(max(x, lo), hi)` and `max(min(x, hi), lo)` agree for every `x` whenever `lo ≤ hi` — both reduce to clamping `x` into `[lo, hi]`. They diverge only when `lo > hi`, where the first returns `hi` and the second returns `lo`. So the swap is invisible to every child whose constraints are consistent, and the blast radius is exactly the set of children carrying a contradictory pair. That is why cases 1-3 in `## Expected Behaviour` are written to pass before *and* after: they pin the unchanged majority.

[^min-is-floor]: The alternative — leaving the managers alone and instead stopping `Fit.getMaxSize` from reporting its child's maximum as the container's — was rejected. It would fix the one docs symptom while leaving the ordering mismatch in place for every other route to a contradictory pair, and it would break `Fit`'s actual contract: a `Fit` container really is bounded by its single child, which is what makes a maximum-carrying child inside a `Fit` behave sensibly in every non-degenerate case.

[^cross-axis-deliberate]: `size-constraint-invariant.md` chose the cross-axis behaviour explicitly: the container cap is applied first so a child that already fits is untouched, and "max is applied last so it always caps". The reasoning is that flooring the cross axis to a child's minimum would inflate a child back to its content size inside a narrower column, which defeats a scrolling or clipping child — the docblocks at `VBox.ts:461-472` and `HBox.ts:442-453` spell this out. The main axis is a different question: there the manager is dividing space it owns among cells, and a cell that ignores its child's explicit minimum desynchronises from what the child will actually commit.

[^no-setter-warning]: `size-constraint-invariant.md` scoped this in deliberately and left it: "`maxSize < minSize` accepted silently. `setMinSize`/`setMaxSize` never cross-check … **not** adding a setter-time warning (Non-Goal)." Adding one now would turn every existing contradictory pair in the library and in consumer code into console noise, which is a separate decision with its own migration cost.

[^rebuild-required]: `packages/lib/package.json` maps each subpath export to `./dist/lib/*.es.js`, so the docs app imports the built bundle rather than the TypeScript sources. This was confirmed during the investigation that produced this plan: editing `VBox.ts` and reloading the docs dev server changed nothing on the page until the library was rebuilt.

---

## Implementation Notes

**Cases 4-6 needed a second, sibling-observing assertion — a literal single-child `getHeight()`/`getWidth()` check does not discriminate the bug.** `LayoutManager.commitBounds` always calls `component.setWidth`/`setHeight` regardless of which layout manager placed it, and `Component`'s own `clampWidth`/`clampHeight` (unaffected by this plan) already cap-then-floor on every call. So a degenerate child's *own* committed size lands on its minimum whether or not the three sites in this plan are fixed — `stage.getHeight()` would read `120` either way, exactly as `## The failure this fixes` step 5 describes for the docs symptom (`clampHeight` "restores 120px" regardless of the wrong intermediate cell height from step 3). A test asserting only that would pass vacuously before the fix.

What the bug actually moves is the *next* sibling's position: `VBox`/`HBox` advance `y`/`x` by the layout manager's own (pre-clamp) cell extent — `heights[idx]`/`widths[idx]` — not by what the child ends up committing to, and `HFlow`/`VFlow` advance `x` by the cell from `clampedPreferredSize` the same way. Cases 4-6 were implemented as two-component tests: a degenerate `stage` (as the plan specifies) followed by a plain `toggle` sibling, asserting `toggle.getY()`/`getX()` equals `120 + spacing` — which is `52` before the fix and `125` after. Each test also keeps the plan's literal `stage.getHeight()`/`getWidth() === 120` assertion as a non-discriminating sanity check matching the Expected Behaviour wording verbatim, but the sibling assertion is what actually pins the fix (verified red before the source edit, green after).

**Manual verification (`## Verification`'s docs-app step) was performed and passed.** `packages/lib` was rebuilt with `npm run build:lib` (the subpath-exports build the docs app's `package.json` `exports` map actually resolves — plain `npm run build` only produces the demo-app bundle, not `dist/lib`). The worktree's own `node_modules/@jimka/typescript-ui` was symlinked to this worktree's `packages/lib` (not the main tree's) so the docs dev server exercised the fixed code. Serving `packages/docs` and opening `/components/ComboBox` and `/components/LabeledFieldSet` confirmed the "Show source" toggle now renders below the demo frame instead of overlapping it, with no console errors; `/components/Slider` (the non-degenerate case the plan calls out) is unchanged.

No test file listed in `## Files to Create / Modify / Delete` changed as a result — the same three files (`VBox.test.ts`, `HBox.test.ts`, `HFlow.test.ts`) still hold cases 4-6, just with an added sibling component and assertion per case.
