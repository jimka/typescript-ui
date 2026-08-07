---
touches-shared: [packages/lib/src/typescript/lib/layout/LayoutManager.ts]
---

# HBox / VBox calculate-then-commit split — Implementation Plan

## Overview

`HBox` and `VBox` currently interleave two jobs inside their placement loops: working out where each child goes, and writing that result onto the child. Both happen in one call — [`LayoutManager.placeComponent`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L305), which is [`resolveBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L332) (pure arithmetic) followed by [`commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L471) (the writes plus the recursive `child.doLayout()`).

This plan separates the two into consecutive passes at each of the six placement loops in [`HBox.ts`](packages/lib/src/typescript/lib/layout/HBox.ts) and [`VBox.ts`](packages/lib/src/typescript/lib/layout/VBox.ts): the loop collects each child's resolved rect into an array, and a second pass commits the array. Nothing about the arithmetic changes, so no geometry changes.

Two new members land on `LayoutManager`: a `ResolvedPlacement` record type and a `protected commitPlacements(placements)` helper. `BoxLayout` is untouched. This is a pilot — no other layout manager is in scope.[^pilot]

---

## Architecture Decisions

### Two passes per loop, mirroring `HFlow`

Each placement loop becomes "collect resolved rects, then commit them", the same shape [`HFlow`](packages/lib/src/typescript/lib/layout/HFlow.ts) already uses: [`groupIntoRows`](packages/lib/src/typescript/lib/layout/HFlow.ts#L324) measures every cell into a plain record array without touching a child, and [`placeRows`](packages/lib/src/typescript/lib/layout/HFlow.ts#L372) walks that array committing them.[^hflow-precedent]

The existing structure of each file stays: one `doLayout` dispatching to `layoutEqualMode` / `layoutPreferredMode`, no new private methods, no moved code. Only the `placeComponent` call inside each loop changes, plus one line after the loop.

### `ResolvedPlacement` is declared in `LayoutManager.ts` and stays off the barrel

The record type is declared top-level in `LayoutManager.ts`, immediately before the class — the placement [`LayoutManagerOptions`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L20) already occupies. It is `export`ed so `HBox` and `VBox` can import it, but it is **not** added to [`layout/index.ts`](packages/lib/src/typescript/lib/layout/index.ts), which keeps it out of the generated API docs.[^barrel]

### One shared `commitPlacements`, not six copies of the same loop

All six call sites want the identical three-line loop with no per-site variation, so the loop lives once on `LayoutManager` as a `protected` helper placed directly after `commitBounds`.[^shared-helper]

Its parameter is a plain `ResolvedPlacement[]`, matching how every neighbouring layout method already types an array parameter (`components: Component[]`, `rows: HFlowRow[]`).[^readonly]

### Commit and recurse stay one step

`commitBounds` keeps its recursive `component.doLayout()` call exactly where it is. Only the *calculation* moves earlier; committing a child and laying out its subtree remain a single indivisible step inside `commitBounds`.

### `reserveContentFrame` stays where it is

[`reserveContentFrame`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L243) reads every child's committed `getX`/`getY`/`getWidth`/`getHeight`, so it must run after all commits. It is called from `doLayout` ([HBox.ts:293](packages/lib/src/typescript/lib/layout/HBox.ts#L293), [VBox.ts:292](packages/lib/src/typescript/lib/layout/VBox.ts#L292)) after the mode method returns, and the mode method still commits before returning — so the ordering holds unchanged. **Do not move `commitPlacements` up into `doLayout`;** that would break the equal/preferred split and the stretching branch's early return.

---

## Public API

Neither symbol is consumer-facing; both are internal seams. `ResolvedPlacement` is exported only so the two subclass modules can import the type.

```typescript
// packages/lib/src/typescript/lib/layout/LayoutManager.ts

export interface ResolvedPlacement {
    component: Component;
    x: number;
    y: number;
    width: number;
    height: number;
}

export abstract class LayoutManager extends BaseObject {
    protected commitPlacements(placements: ResolvedPlacement[]): void;
}
```

---

## Implementation

The transformation is identical at all six sites. Before:

```typescript
for (const component of components) {
    this.placeComponent(component, x, y, cellWidth, containerSize.height, FillType.BOTH);

    x += cellWidth + spacing;
}
```

After:

```typescript
const placements: ResolvedPlacement[] = [];

for (const component of components) {
    placements.push({ component, ...this.resolveBounds(component, x, y, cellWidth, containerSize.height, FillType.BOTH) });

    x += cellWidth + spacing;
}

this.commitPlacements(placements);
```

The loop body's `if (cross) { … } else { … }` branching, the cursor-advance lines, and every argument passed to `placeComponent` stay byte-identical — only the call itself becomes a `resolveBounds` result pushed onto the array.

The six sites:

| File | Method | Loop | `placeComponent` calls | Where `commitPlacements` goes |
|---|---|---|---|---|
| `HBox.ts` | `layoutEqualMode`, stretching | [316–320](packages/lib/src/typescript/lib/layout/HBox.ts#L316) | 1 (line 317) | after the loop, **before** the `return` on line 322 |
| `HBox.ts` | `layoutEqualMode`, non-stretching | [345–359](packages/lib/src/typescript/lib/layout/HBox.ts#L345) | 2 (lines 351, 355) | after the loop (method end) |
| `HBox.ts` | `layoutPreferredMode` | [505–534](packages/lib/src/typescript/lib/layout/HBox.ts#L505) | 2 (lines 522, 526) | after the loop (method end) |
| `VBox.ts` | `layoutEqualMode`, stretching | [317–321](packages/lib/src/typescript/lib/layout/VBox.ts#L317) | 1 (line 318) | after the loop, **before** the `return` on line 323 |
| `VBox.ts` | `layoutEqualMode`, non-stretching | [332–345](packages/lib/src/typescript/lib/layout/VBox.ts#L332) | 2 (lines 339, 341) | after the loop (method end) |
| `VBox.ts` | `layoutPreferredMode` | [456–507](packages/lib/src/typescript/lib/layout/VBox.ts#L456) | 2 (lines 497, 499) | after the loop (method end) |

Each site gets its **own** `const placements: ResolvedPlacement[] = []` declared immediately before its loop. In `VBox.layoutEqualMode` the two branches share the `const x` / `let y` cursor declared at [VBox.ts:311–312](packages/lib/src/typescript/lib/layout/VBox.ts#L311), above the `isStretching()` test — do not hoist the `placements` array to sit beside them. Two separate arrays, one per branch.

`commitPlacements` itself:

```typescript
protected commitPlacements(placements: ResolvedPlacement[]): void {
    for (const placement of placements) {
        this.commitBounds(placement.component, placement.x, placement.y, placement.width, placement.height);
    }
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/layout/LayoutManager.ts`** — add the `ResolvedPlacement` interface immediately after the `LayoutManagerOptions` block (line 21) and before `export abstract class LayoutManager`. Give it a JSDoc description; **no `@category` tag** (it is not a documented symbol — see step 3). Verify: `npm -w packages/lib run typecheck` passes.

2. **`LayoutManager.ts`** — add `protected commitPlacements(placements: ResolvedPlacement[]): void` directly after `commitBounds` (which ends at line 481), with a JSDoc block covering the parameter. Body as shown in `## Implementation`. Verify: typecheck passes.

3. **`packages/lib/src/typescript/lib/layout/index.ts`** — no edit. Confirm with `grep -n 'ResolvedPlacement' packages/lib/src/typescript/lib/layout/index.ts` — expect zero matches.

4. **`packages/lib/src/typescript/lib/layout/HBox.ts`** — add `import type { ResolvedPlacement } from "~/layout/LayoutManager.js";` to the import block at the top (lines 3–8).

5. **`HBox.ts`, `layoutEqualMode` stretching branch** — declare `const placements: ResolvedPlacement[] = [];` after the `let x = insets.getLeft();` on line 314; convert the `placeComponent` on line 317 to a `resolveBounds` push; add `this.commitPlacements(placements);` after the loop's closing brace and **before** the `return;` on line 322. Leave `x += cellWidth + spacing;` untouched.

6. **`HBox.ts`, `layoutEqualMode` non-stretching branch** — declare `const placements: ResolvedPlacement[] = [];` after `let x = insets.getLeft();` on line 343; convert both `placeComponent` calls (lines 351 and 355) to pushes, keeping the `if (cross)` / `else` structure and the `const y = this.rowChildY(…)` line exactly as they are; add `this.commitPlacements(placements);` after the loop, as the method's last statement.

7. **`HBox.ts`, `layoutPreferredMode`** — declare `const placements: ResolvedPlacement[] = [];` after `let x = insets.getLeft() + lead;` on line 503; convert both `placeComponent` calls (lines 522 and 526) to pushes; add `this.commitPlacements(placements);` after the loop, as the method's last statement. Leave the two cursor lines `x += widths[idx];` and `x += spacing + gap;` and their explanatory comment untouched.

8. **Checkpoint** — `grep -n 'placeComponent' packages/lib/src/typescript/lib/layout/HBox.ts` — expect zero matches. Then `npm -w packages/lib run typecheck`.

9. **`packages/lib/src/typescript/lib/layout/VBox.ts`** — add `import type { ResolvedPlacement } from "~/layout/LayoutManager.js";` to the import block (lines 3–8).

10. **`VBox.ts`, `layoutEqualMode` stretching branch** — declare `const placements: ResolvedPlacement[] = [];` after `const cellWidth = containerSize.width;` on line 315; convert the `placeComponent` on line 318 to a push; add `this.commitPlacements(placements);` after the loop and **before** the `return;` on line 323. Do not touch the shared `const x` / `let y` on lines 311–312.

11. **`VBox.ts`, `layoutEqualMode` non-stretching branch** — declare a second, separate `const placements: ResolvedPlacement[] = [];` after `const crossExtent = containerSize.width;` on line 330; convert both `placeComponent` calls (lines 339 and 341) to pushes; add `this.commitPlacements(placements);` after the loop, as the method's last statement.

12. **`VBox.ts`, `layoutPreferredMode`** — declare `const placements: ResolvedPlacement[] = [];` after `let y = insets.getTop() + lead;` on line 454; convert both `placeComponent` calls (lines 497 and 499) to pushes; add `this.commitPlacements(placements);` after the loop, as the method's last statement. Leave `y += heights[idx];`, `y += spacing + gap;`, and their comment untouched.

13. **Checkpoint** — `grep -n 'placeComponent' packages/lib/src/typescript/lib/layout/VBox.ts` — expect zero matches.

14. **Confirm nothing else moved** — `git diff --stat` must list exactly three files: `LayoutManager.ts`, `HBox.ts`, `VBox.ts`. `git diff packages/lib/src/typescript/lib/layout/BoxLayout.ts` must be empty.

15. **Run the checks in `## Verification`.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/HBox.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/VBox.ts` |

---

## Expected Behaviour

This is a pure refactor: every case below must produce **the same numbers as before the change**. No new tests are required — the cases exist to be checked against, not written from scratch.[^no-new-tests] Where a case has no automated coverage today, it is marked manual.

| Case | Expectation | How it is checked |
|---|---|---|
| `HBox`/`VBox` in `mode: "preferred"`, default cross placement | Each child lands at the same `x`/`y`/`width`/`height` as before; the cursor still advances by `widths[idx]` / `heights[idx]`, never by `getWidth()`/`getHeight()` | Unit — `tests/component/layout/HBox.test.ts`, `VBox.test.ts` |
| `mode: "preferred"` with `weight` cells | Weight cells split the remainder identically | Unit — `VBox.test.ts` (weight cases at lines 149–150) |
| `mode: "preferred"` with `justify` other than `"start"` | `lead`/`gap` still applied to the same cursor | Unit — `HBox.test.ts`; manual — the `hbox-justify` demo on [`docs/layouts/HBox.md:12`](packages/lib/docs/layouts/HBox.md#L12) |
| `mode: "equal"` with `stretching: true` | Every cell keeps the same width/height and fills the cross axis | Unit — indirect, via `TabBar*` and `ScrollStrip` tests |
| `mode: "equal"` without stretching, default cross placement | Children keep preferred cross extent and baseline-align (HBox) / left-align (VBox) | **Manual** — the `vbox-sizing-modes` demo on [`docs/layouts/VBox.md:74`](packages/lib/docs/layouts/VBox.md#L74); no automated coverage exists[^equal-gap] |
| Any mode, child with an explicit `fill` / `anchor` constraint (`crossPlacement` returns non-null) | The cross branch still receives `cross.offset` / `cross.extent` | **Manual** — no test sets a cross constraint on an `HBox`/`VBox` child[^equal-gap] |
| Container with zero children | Both modes commit an empty array and no-op, as today | Unit — existing empty-container assertions |
| A scroll-enabled host (`Panel.setAutoScroll`) | The content frame still sizes to the children's committed far edge, because `reserveContentFrame` still runs after all commits | Unit — existing autoScroll layout tests |

The one ordering that genuinely moves: a child's own resolve still happens before its own commit, but *other* children's commits now happen later. That is safe because nothing in either file's calc phase reads a sibling's committed geometry.[^ordering]

---

## Verification

1. `npm -w packages/lib run typecheck`
2. `npm -w packages/lib run test` — the full suite, not just the box-named files. `HBox`/`VBox` are constructed internally by ~30 components, so the whole suite is the honest regression gate. Currently green and worth re-reading the output for by name:
   - `packages/lib/tests/component/layout/HBox.test.ts`
   - `packages/lib/tests/component/layout/VBox.test.ts`
   - `packages/lib/tests/component/container/TabBar.test.ts`, `TabBar.edgecases.test.ts`, `TabBar.tools.test.ts`, `TabBar.contextMenu.test.ts`
   - `packages/lib/tests/component/container/ScrollStrip.test.ts`
   - `packages/lib/tests/component/container/TabCloseReservePerTab.test.ts`
   - `packages/lib/tests/component/container/TabCloseGlyphCentring.test.ts`
3. `grep -rn 'placeComponent' packages/lib/src/typescript/lib/layout/HBox.ts packages/lib/src/typescript/lib/layout/VBox.ts` — expect zero matches.
4. `git diff packages/lib/src/typescript/lib/layout/BoxLayout.ts` — expect empty.
5. **Read the diff end to end.** For every cursor-advance line (`x +=` / `y +=`) confirm it still reads the pre-resolved local (`cellWidth`, `cellHeight`, `widths[idx]`, `heights[idx]`, `spacing`, `gap`) and never `component.getWidth()` / `component.getHeight()`. This is the one mistake the type checker cannot catch.
6. **Manual, in the docs app** (`npm run docs:dev`, http://localhost:5173): open the VBox layouts page and confirm the `vbox-sizing-modes` demo's two columns still render as before — the `"preferred"` column keeps per-row heights, the `"equal"` column divides evenly, and both keep their children at preferred width. This is the only route that exercises equal-mode-without-stretching. Then open the HBox layouts page and confirm the `hbox-justify` demo's modes are unchanged.

---

## Documentation Impact

None. Neither new symbol reaches a package entry point: `commitPlacements` is `protected` (TypeDoc excludes it) and `ResolvedPlacement` is deliberately not re-exported from `layout/index.ts`. No public JSDoc gains a `{@link}` to either. `npm -w packages/lib run docs:api` output should be unchanged from its pre-change baseline.

---

## Potential Challenges

- **The stretching branches return early.** In both files `layoutEqualMode` returns from inside the `isStretching()` block. `commitPlacements` must be inserted *before* that `return`, not after the method's last loop — otherwise every stretching layout silently commits nothing, and `TabBar` / `ScrollStrip` collapse. The `grep` in step 8/13 will not catch this; the test suite will.
- **`VBox.layoutEqualMode` declares its cursor above the branch.** `const x` / `let y` sit on lines 311–312, before `isStretching()`. Putting the `placements` array beside them would leave the stretching branch's already-committed entries in the array for the non-stretching branch — which cannot both run, but the shared array invites the mistake on a later edit. Declare one array per branch.
- **Equal-mode-without-stretching has no automated coverage and no in-repo consumer.** All three in-repo equal-mode sites ([`TabBar.ts:594`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L594), [`ScrollStrip.ts:236–237`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L236)) pass `stretching: true`, and no test file anywhere sets `mode: "equal"`. The docs demo in `## Verification` step 6 is the only check on that branch — do not skip it.
- **A child's `doLayout()` running later than before.** In `VBox.layoutEqualMode`'s non-stretching branch and `HBox.layoutPreferredMode`, `component.getPreferredSize()` is read inside the placement loop, so after this change child *n*'s preferred size is read before child *n−1* is committed. Children are independent subtrees, so a sibling's `doLayout` cannot alter another's preferred size — but if the full suite shows a geometry regression in exactly these two methods, this is the first thing to look at.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) — `resolveBounds` (332), `commitBounds` (471), `reserveContentFrame` (243), and the `LayoutManagerOptions` placement precedent (20).
- [`packages/lib/src/typescript/lib/layout/HFlow.ts`](packages/lib/src/typescript/lib/layout/HFlow.ts) — **the precedent.** `HFlowRow` (28), `groupIntoRows` (324), `placeRows` (372). Read these three before touching `HBox`/`VBox`.
- [`packages/lib/src/typescript/lib/layout/HBox.ts`](packages/lib/src/typescript/lib/layout/HBox.ts) and [`VBox.ts`](packages/lib/src/typescript/lib/layout/VBox.ts) — the files being changed.
- [`packages/lib/src/typescript/lib/layout/BoxLayout.ts`](packages/lib/src/typescript/lib/layout/BoxLayout.ts) — read to confirm `crossPlacement` (447), `justifyOffsets` (401), and `computeShrink` (373) need no change. Do not edit it.
- [`packages/lib/src/typescript/lib/layout/index.ts`](packages/lib/src/typescript/lib/layout/index.ts) — read to confirm `ResolvedPlacement` must not be added.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Size constraints: who is responsible for what*, for the placement contract this refactor must not disturb.

---

## Non-Goals

- **Every other layout manager.** `Grid`, `Border`, `Anchor`, `Card`, `Fit`, `Absolute`, `Split`, `Tab`, `Accordion` keep their inline `placeComponent` calls. `HFlow`/`VFlow` already have this shape. `Table` is confirmed *not* cleanly separable — it reads an earlier sibling's committed `getContentBounds()`/`getHeight()` to size a later one, so the calc phase there is not pure.
- **Changing when a child's `doLayout()` runs.** Commit and recurse stay fused inside `commitBounds`.
- **Any geometry-diff or skip-unchanged optimization.** This plan only makes such an optimization *possible* later by giving it a resolved-rect array to compare against; it implements none of it.
- **Batching the DOM writes across children.** `commitPlacements` commits one child at a time, exactly as the current loop does.
- **New tests.** The existing suite is the regression net.
- **Touching `BoxLayout.ts`.** `crossPlacement`, `justifyOffsets`, `computeShrink`, and `aggregateMaxSize` are already pure and already run before placement.
- **Backfilling the missing equal-mode / cross-constraint tests.** That gap predates this change; filling it is separate work.

---

## Notes

[^pilot]: The pilot scope was set with the user. `HBox`/`VBox` are the two best candidates: their calc phase is already almost entirely a pre-pass (`widths[]`/`heights[]` in `layoutPreferredMode`, `heights[]`/`baselines[]` in `HBox.layoutEqualMode`), and their placement loops carry no cross-sibling reads. Widening the pilot before it has landed would mix a proven-safe transformation with `Table`'s genuinely-unsafe one.

[^hflow-precedent]: `HFlow.groupIntoRows` builds `HFlowRow[]` — an array of `{ component, width, height, baseline }` cell records — with no `Component` mutation, and `HFlow.placeRows` walks it committing each cell. That establishes three things this plan reuses verbatim: a plain record interface at module top-level for the phase-1 output, an array of those records as the hand-off, and a separate method owning the commit walk. `VFlow` mirrors it (`VFlow.ts:292`, `:345`). The motivation for bringing the shape to `HBox`/`VBox` is readability first — "compute everything into an array, then commit everything" — and it incidentally enables a future geometry-diff skip of unchanged children (the pattern `TableHeader`'s `_cellGeom` cache already uses elsewhere in this codebase) and easier isolated testing of the calc phase. Neither of those is built here.

[^barrel]: `layout/index.ts` is a package entry point, and `CODE_CONVENTIONS.md` notes that TypeDoc documents only what is re-exported from one. Adding `ResolvedPlacement` there would put an internal seam type on the public API surface and make it a compatibility commitment. Exporting it from `LayoutManager.ts` alone is enough for the two subclass modules to import it, because they import from the module path (`~/layout/LayoutManager.js`), not the barrel — which is exactly what `BoxLayout.ts:3` and `FlowLayout.ts:3` already do for `LayoutManagerOptions`.

[^shared-helper]: The alternative — inlining a three-line `for` loop at each of the six sites — was rejected. This is not speculative reuse: the duplication is concrete and complete within this one changeset, all six copies would be character-identical, and the helper sits next to the `commitBounds` it wraps, where a reader looking at one will see the other. It also gives the future geometry-diff optimization a single place to grow a skip check, rather than six.

[^readonly]: A `readonly ResolvedPlacement[]` parameter would signal that the helper does not mutate the array. The codebase does use `readonly` array parameters in a few places (`tabCloseTargets.ts:31`, `TabBar.ts:1793`, `RoutePattern.ts:230`), so it is not unprecedented — but nothing in `layout/` uses it, and the two nearest analogues both take plain mutable arrays (`HFlow.placeRows(rows: HFlowRow[], …)`, `HBox.layoutEqualMode(components: Component[], …)`). The array is built and consumed inside one method with no shared ownership, so the modifier would buy nothing here. Matching the immediate neighbours wins.

[^no-new-tests]: The user decided this ships without new tests. The refactor changes no arithmetic, and the regression net is broad: `HBox`/`VBox` are constructed at 49 sites across 32 files in `packages/lib/src/typescript/lib/`, so the full suite exercises them heavily and indirectly. Adding tests that assert the same geometry the existing box tests already assert would not increase confidence.

[^equal-gap]: Verified, and **pre-existing** — not introduced by this refactor. `grep -rln 'mode: "equal"' packages/lib/tests/` returns nothing, so no test constructs an equal-mode box at all; the branch is reached only indirectly through `TabBar` and `ScrollStrip`, both of which pass `stretching: true` and therefore only ever hit the stretching branch. Separately, `grep -rln 'anchor: AnchorType\|fill: FillType' packages/lib/tests/` matches only `Fit.test.ts`, and `VBox.test.ts` uses `LayoutConstraints` for `weight` alone — so no test drives `crossPlacement` to return non-null inside a box. Both gaps are worth filling; that is separate work, and this plan only flags them so the implementer knows which branches the green suite is *not* proving.

[^ordering]: The rule the refactor rests on: `resolveBounds` reads only its own arguments, the manager's own `_layoutConstraints` map, and the child's own `getPreferredSize()`/`getSize()`/`getMinSize()`/`getMaxSize()`. It never reads a component's current `x`/`y`/`width`/`height` and never mutates anything. The surrounding calc code in both files is the same: `cellWidth`/`cellHeight`, `widths[]`/`heights[]`, `baselines[]`, `rowAscent`/`rowDescent`, `lead`/`gap`, and the `crossPlacement` result all derive from running locals plus per-child size and baseline getters. `commitBounds` writes only the child it was handed and recurses into that child's own subtree, so no commit can change a sibling's reported size. Two loops therefore produce identical numbers to one interleaved loop.

---

## Implementation Notes

**The `vbox-sizing-modes` demo does not exercise the branch `## Expected Behaviour` and `## Verification` cite it for.** Lines 174 and 196 of this plan, and the `[^equal-gap]` footnote, name the `vbox-sizing-modes` docs demo (`packages/docs/src/demos/vbox-sizing-modes.ts`) as the manual-verify route for `VBox.layoutEqualMode`'s **non-stretching** branch (the loop converted at Ordered Implementation Step 11). That demo's equal-mode column actually passes `stretching: true` (`vbox-sizing-modes.ts:48`), so it exercises the *stretching* early-return branch, not the non-stretching one — the "both keep their children at preferred width" claim at line 196 does not hold for that demo's equal column, whose children are forced to a shared 104px width by stretching rather than each keeping its own preferred width. This was caught by audit, not planning.

No automated test constructs an equal-mode box at all (confirmed: `grep -rln 'mode: "equal"' packages/lib/tests/` is empty), so the non-stretching branch shipped with neither working automated coverage nor a working manual-verify route. Since the test harness can exercise it perfectly well (it just wasn't tried), I closed the gap with a temporary offline test using the same `installTestDOM` harness as `VBox.test.ts` — `hostVBox(200, 300, new VBox({ mode: 'equal', spacing: 4 }))` with three children of preferred size 58×29, 104×41, 69×29 — ran it once, and deleted it (per this plan's `## Non-Goals`, "New tests," this was verification, not a permanent addition). Result, confirming the converted branch is correct:

```
a { x: 0, y: 0,                 w: 58,  h: 97.333 }
b { x: 0, y: 101.333 (97.333+4), w: 104, h: 97.333 }
c { x: 0, y: 202.667 (2×97.333+8), w: 69, h: 97.333 }
```

Equal heights (`(300 − 2×4) / 3 = 97.333` each), correct cumulative spacing-adjusted `y`, each child at its own preferred width (not a shared uniform width), left-aligned `x`. This is the intended contract and matches the plan's prose description of the mode — only its cited verification route was wrong.

Left as-is, uncorrected: this note documents the discrepancy rather than editing plan lines 174/196/`[^equal-gap]` in place, per this skill's rule that plan-file edits are limited to this section.

**The "no in-repo consumer" claim at line 210 and in `[^equal-gap]` is also wrong — for the HBox side.** Both say all three in-repo equal-mode sites (`TabBar.ts:594`, `ScrollStrip.ts:236–237`) pass `stretching: true`, concluding there is no in-repo consumer of the non-stretching equal-mode branch. `ColumnPanel.ts:11-13` constructs `new HBox({ mode: "equal", stretching: false })` — a fourth equal-mode site the plan missed, exercising exactly the branch converted at Ordered Implementation Step 6 (`HBox.ts` non-stretching `layoutEqualMode`). `ColumnPanel` is not dead code: it is mounted as the "Column" section in `packages/lib/src/typescript/main.ts:67`, the entry point `npm run dev` serves — a real, currently-running manual-verify route existed for this branch the whole time; the plan's inventory just missed it. (The VBox side of the same claim holds: `RowPanel.ts:11` does pass `stretching: true`, so VBox's non-stretching equal-mode branch genuinely had no in-repo consumer, as the first note above already establishes.) This was caught by a second audit round, not planning.

Verified the HBox non-stretching equal-mode branch the same way as VBox's above: a temporary offline test, `hostHBox(300, 200, new HBox({ mode: 'equal', stretching: false, spacing: 4 }))` with three children of preferred size 29×58, 41×104, 29×69, run once and deleted. Result:

```
a { x: 0,                 y: 0, w: 97.333, h: 58  }
b { x: 101.333 (97.333+4), y: 0, w: 97.333, h: 104 }
c { x: 202.667 (2×97.333+8), y: 0, w: 97.333, h: 69  }
```

Equal widths (`(300 − 2×4) / 3 = 97.333` each), correct cumulative spacing-adjusted `x`, each child at its own preferred height (not a shared uniform height). Confirms the converted `HBox.ts` non-stretching `layoutEqualMode` branch is correct; only the plan's site inventory was incomplete.

**The "no in-repo consumer" claim is wrong for the VBox side too, contradicting the previous note's parenthetical.** The second note above states "the VBox side of the same claim holds: `RowPanel.ts:11` does pass `stretching: true`, so VBox's non-stretching equal-mode branch genuinely had no in-repo consumer" — but that check only looked at `RowPanel.ts`. `packages/lib/src/typescript/AlignSelfPanel.ts` also constructs a non-stretching equal-mode `VBox`: `buildVBoxColumn()` (lines 58–69) is called with `mode: "equal"` at line 26 (`this.addComponent(this.buildVBoxColumn("equal"))`), and builds `VBox({ mode })` with no `stretching` key, which defaults to `false` (confirmed in `VBox.ts`'s JSDoc and `VBox.test.ts`'s "defaults stretching to false" case). `AlignSelfPanel` is mounted live via `packages/lib/src/typescript/main.ts:74` (`addSection(() => new AlignSelfPanel(), "AlignSelf")`), so a real, currently-running manual-verify route exists for exactly the branch converted at Ordered Implementation Step 11 (`VBox.ts` non-stretching `layoutEqualMode`) — the plan's inventory, and the second note's follow-up check, both missed it. This was caught by a third audit round, not planning.

`AlignSelfPanel` is also an in-repo site exercising `crossPlacement`'s non-null (anchor/fill) return path inside a box layout, which the `[^equal-gap]` footnote separately (and, per this note, also incompletely) claims has no in-repo consumer: `buildVBoxColumn`'s children use `constraints: { anchor: AnchorType.WEST }`, `constraints: { anchor: AnchorType.EAST }`, and `constraints: { fill: FillType.HORIZONTAL }` on a `VBox` whose `mode` is either `"preferred"` or `"equal"` depending on which column is built — the `"equal"` column exercises both gaps the footnote flagged, at once. (It is not the *only* such site — see the fifth note below.)

Verified with a temporary offline test in `VBox.test.ts`, using the same `installTestDOM`/`hostVBox` harness as the two notes above: `hostVBox(220, 200, new VBox({ mode: 'equal', spacing: 4 }))` with four 50×20 children — one default, one with `{ anchor: AnchorType.WEST }`, one with `{ anchor: AnchorType.EAST }`, one with `{ fill: FillType.HORIZONTAL }` — mirroring `buildVBoxColumn`'s WEST/EAST/fill buttons. Run once and deleted (per this plan's `## Non-Goals`, "New tests"). Result:

```
default { x: 0,   w: 50  }  // crossPlacement returns null; falls back to insets.left / preferred width
WEST    { x: 0,   w: 50  }  // crossPlacement anchors to the leading edge
EAST    { x: 170, w: 50  }  // crossPlacement anchors to the trailing edge (220 − 50)
fill    { x: 0,   w: 220 }  // crossPlacement fills the full cross extent
```

**The two notes above, while correcting the VBox side, both stopped short on the HBox side of `AlignSelfPanel.ts`.** The second note's "no in-repo consumer" correction (above) cites only `ColumnPanel.ts:11-13` as an additional non-stretching-equal-mode `HBox` consumer. `AlignSelfPanel.ts:24` also calls `buildHBoxRow("equal")`, and `buildHBoxRow` (`AlignSelfPanel.ts:37–48`) builds `HBox({ mode })` at `:40` with no `stretching` key — a second, independent in-repo consumer of the same branch (Ordered Implementation Step 6). Separately, the third note's crossPlacement paragraph (above) claims `AlignSelfPanel` is "the only in-repo site exercising `crossPlacement`'s non-null (anchor/fill) return path inside a box layout" and only cites `buildVBoxColumn`'s WEST/EAST/fill children — but `buildHBoxRow`'s children (`AlignSelfPanel.ts:43–45`: `constraints: { anchor: AnchorType.NORTH } }`, `constraints: { anchor: AnchorType.SOUTH } }`, `constraints: { fill: FillType.VERTICAL } }`) drive the same `crossPlacement` non-null path in **HBox**, in both the `"preferred"` and `"equal"` calls (`AlignSelfPanel.ts:23–24`) — so the HBox anchor/fill push sites (`HBox.ts:356`, `HBox.ts:530`) had a real in-repo consumer and manual-verify route the whole time, same as their VBox counterparts. This was caught by a fourth audit round, not planning.

Verified the HBox side the same way as the VBox side above: a temporary offline test in `HBox.test.ts`, using the same `installTestDOM`/`hostHBox` harness, `hostHBox(300, 90, new HBox({ mode: 'equal', spacing: 4 }))` (90 mirrors `AlignSelfPanel`'s `ROW_HEIGHT`) with three 50×20 children — one with `{ anchor: AnchorType.NORTH }`, one with `{ anchor: AnchorType.SOUTH }`, one with `{ fill: FillType.VERTICAL }` — mirroring `buildHBoxRow`'s NORTH/SOUTH/fill buttons. Run once and deleted (per this plan's `## Non-Goals`, "New tests"). Result (cross extent = the host's 90px inner height, insets cleared):

```
NORTH { y: 0,  h: 20 }  // crossPlacement anchors to the leading edge
SOUTH { y: 70, h: 20 }  // crossPlacement anchors to the trailing edge (90 − 20)
fill  { y: 0,  h: 90 }  // crossPlacement fills the full cross extent
```

Matches `BoxLayout.crossPlacement`'s contract for `horizontal: true` (NORTH = lead, SOUTH = trail), committed correctly through the split `resolveBounds`/`commitPlacements` pair. Confirms the HBox anchor/fill cross-constraint path is exercised in-repo and behaves correctly after the refactor; the plan's and the earlier notes' site inventories were incomplete on this side too.

**The third note's "only in-repo site" claim above was itself an overclaim — `AlignSelfPanel` is not the only in-repo consumer of `crossPlacement`'s non-null path.** `packages/docs/src/shell/DocsDemo.ts` wraps every inline live demo block shown across the docs app: its constructor (`DocsDemo.ts:59-62`) sets `layoutManager: VBox({ stretching: true })` (default `"preferred"` mode) and adds its "Show source" toggle with `this.addComponent(this._toggle, { anchor: AnchorType.EAST })` (`DocsDemo.ts:88`). `crossAnchorEdge(EAST, horizontal: false)` returns `"trail"`, so `crossPlacement` returns non-null for that child even though the box is globally stretching (an explicit per-child anchor overrides global `stretching`, per `BoxLayout.ts`'s own doc comment on `LayoutConstraints.anchor`) — driving the same `VBox.layoutPreferredMode` push (`VBox.ts:505`) already verified in the note above. This doesn't change any geometry conclusion in this section — `DocsDemo` adds another live consumer of an already-verified path, it doesn't reveal a new one — so no further offline verification was run for it. This was caught by a fifth audit round, not planning.

Each result matches `BoxLayout.crossPlacement`'s documented contract, committed correctly through the split `resolveBounds`/`commitPlacements` pair. Confirms both the non-stretching equal-mode branch and the anchor/fill cross-constraint path are exercised in-repo and behave correctly after the refactor; only the plan's and the prior notes' site inventories were incomplete.
