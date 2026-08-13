---
depends-on: [hbox-vbox-layout-calc-commit-split]
---

# Layout manager calculate-then-commit sweep — Implementation Plan

## Overview

[`HBox`](packages/lib/src/typescript/lib/layout/HBox.ts) and [`VBox`](packages/lib/src/typescript/lib/layout/VBox.ts) no longer interleave working out where a child goes with writing it there. Each placement loop resolves every child into a `ResolvedPlacement[]` and a single trailing pass commits the array — the pilot shipped in commit `055c4c70`. Every other layout manager still commits inside its placement loop.

This plan finishes the sweep across the six managers where the same split fits: [`Absolute`](packages/lib/src/typescript/lib/layout/Absolute.ts), [`Anchor`](packages/lib/src/typescript/lib/layout/Anchor.ts), [`HFlow`](packages/lib/src/typescript/lib/layout/HFlow.ts), [`VFlow`](packages/lib/src/typescript/lib/layout/VFlow.ts), [`Split`](packages/lib/src/typescript/lib/layout/Split.ts) and [`Grid`](packages/lib/src/typescript/lib/layout/Grid.ts). Two managers are examined and deliberately left alone: [`Tab`](packages/lib/src/typescript/lib/layout/Tab.ts) places exactly one child per pass, and [`Border`](packages/lib/src/typescript/lib/layout/Border.ts) uses two different placement styles per region.

Nothing about the arithmetic changes, so no geometry changes. [`LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) is **not** edited: `ResolvedPlacement`, `resolveBounds`, `commitBounds` and `commitPlacements` are used exactly as they stand today.[^base-untouched]

---

## Architecture Decisions

### Mirror the pilot — resolve into an array, commit in one pass

Each converted placement loop pushes `{ component, ...this.resolveBounds(…) }` into a local array and calls `this.commitPlacements(placements)` once after the loop. That is the shape the pilot established at [HBox.ts:297](packages/lib/src/typescript/lib/layout/HBox.ts#L297) and [HBox.ts:325](packages/lib/src/typescript/lib/layout/HBox.ts#L325), which in turn mirrors `HFlow`'s existing two-phase [`groupIntoRows`](packages/lib/src/typescript/lib/layout/HFlow.ts#L324) / [`placeRows`](packages/lib/src/typescript/lib/layout/HFlow.ts#L372) pair.[^precedent]

Every argument passed to `placeComponent` or `commitBounds` today is passed unchanged to `resolveBounds`, and every cursor-advance line stays byte-identical.

### A manager with an extra per-child write keeps a file-local record

Two managers write more than bounds per child. `Split` sets a `clip-path` on each pane after committing it ([Split.ts:1277](packages/lib/src/typescript/lib/layout/Split.ts#L1277), [Split.ts:1378](packages/lib/src/typescript/lib/layout/Split.ts#L1378)). `Grid`'s occupancy path installs or clears a clip frame on each child before committing it ([Grid.ts:1007](packages/lib/src/typescript/lib/layout/Grid.ts#L1007), [Grid.ts:1015](packages/lib/src/typescript/lib/layout/Grid.ts#L1015)).

Those two get a file-local record type extending `ResolvedPlacement` plus a private commit loop that replays the file's own per-child write order. The shared `ResolvedPlacement` and `commitPlacements` stay as they are.[^local-record]

| Manager | Per-child work beyond the bounds write | Shape used |
|---|---|---|
| `Absolute`, `Anchor` | none | shared `ResolvedPlacement[]` → `commitPlacements` |
| `HFlow`, `VFlow` | none | shared `ResolvedPlacement[]` → `commitPlacements` |
| `Grid`, baseline branch | none | shared `ResolvedPlacement[]` → `commitPlacements` |
| `Grid`, occupancy branch | clip frame set/cleared **before** the bounds write | `GridPlacement[]` → `commitGridPlacements` |
| `Split` | `clip-path` written **after** the bounds write | `SplitPlacement[]` → `commitPanes` |
| `Tab` | — (one child, no loop) | unchanged |
| `Border` | two placement styles per region, plus gutter writes | unchanged |

### `Split` defers its panes, not its gutters

`Split.doLayout` interleaves pane placement with gutter geometry writes ([Split.ts:1305–1318](packages/lib/src/typescript/lib/layout/Split.ts#L1305)) because both advance the same `x`/`y` cursor. Only the panes are collected and deferred; the gutter writes stay exactly where they are.[^split-gutters]

### `Tab` is left unchanged

`Tab.doLayout` calls `placeComponent` once, at [Tab.ts:1961](packages/lib/src/typescript/lib/layout/Tab.ts#L1961), for the single visible child. There is no placement loop to split.[^tab]

### `Border` is left unchanged

Each of `Border`'s five regions takes one of two placement styles: an unframed `placeComponent` plus a `clip-path`, or a clip frame plus a `commitBounds` at `(0, 0)` inside that frame ([Border.ts:945–965](packages/lib/src/typescript/lib/layout/Border.ts#L945)). A single placement array would have to carry both styles' side effects, and the commit loop would reproduce the same branch it replaced.[^border]

### Methods that stop committing get `resolve*` names

`HFlow.placeRows` becomes `resolveRows`, `VFlow.placeColumns` becomes `resolveColumns`, and `Grid`'s `placeAt` closure becomes `resolveAt`. Each returns placements instead of writing them, so the old name would state the opposite of what the method does.[^renames]

---

## Internal Structure

### The standard conversion (Absolute, Anchor, HFlow, VFlow, Grid baseline branch)

Before — resolve and commit fused, once per child:

```typescript
for (const cell of row.cells) {
    const y = row.y + this.crossOffset(cell.height, row.rowHeight, cell.baseline, rowAscent, rowDescent);

    this.placeComponent(cell.component, x, y, cell.width, cell.height, FillType.NONE);

    x += cell.width + gap;
}
```

After — resolve into the array, commit once at the end of the method:

```typescript
for (const cell of row.cells) {
    const y = row.y + this.crossOffset(cell.height, row.rowHeight, cell.baseline, rowAscent, rowDescent);

    placements.push({ component: cell.component, ...this.resolveBounds(cell.component, x, y, cell.width, cell.height, FillType.NONE) });

    x += cell.width + gap;
}
```

`Absolute` and `Anchor` do not call `resolveBounds` today and must not start: both deliberately bypass the cell clamp — the shrink-to-the-cell step inside `resolveBounds` — so an oversized child commits at its full size. They build the record literally from the values they already computed: `placements.push({ component, x, y, width, height })`.

### `Grid`'s occupancy record

Declared at file scope in `Grid.ts`, in the slot `HFlowRow` occupies in [HFlow.ts:28](packages/lib/src/typescript/lib/layout/HFlow.ts#L28) — after the `GridOptions` interface, before the class JSDoc:

```typescript
/**
 * A child's resolved bounds plus the clip-frame decision made for it — the
 * hand-off between {@link Grid.layoutOccupancy}'s resolve pass and its commit
 * pass. `clipFrame` is the cell rect to clip the child to, or `null` to clear
 * any frame the child carries.
 */
interface GridPlacement extends ResolvedPlacement {
    clipFrame: { x: number; y: number; width: number; height: number } | null;
}
```

The commit loop, a private method on `Grid` placed directly after `layoutOccupancy`:

```typescript
private commitGridPlacements(placements: GridPlacement[]): void {
    for (const placement of placements) {
        if (placement.clipFrame) {
            placement.component.setClipFrame(placement.clipFrame.x, placement.clipFrame.y, placement.clipFrame.width, placement.clipFrame.height);
        } else {
            placement.component.clearClipFrame();
        }

        this.commitBounds(placement.component, placement.x, placement.y, placement.width, placement.height);
    }
}
```

The frame write comes before the bounds write, exactly as in today's `placeAt`.

### `Split`'s pane record

Declared at file scope in `Split.ts`, after the `SplitOptions` interface ([Split.ts:62](packages/lib/src/typescript/lib/layout/Split.ts#L62)) and before `class Split`:

```typescript
/**
 * A pane's resolved bounds plus the `clip-path` to write after committing them —
 * the hand-off between {@link Split.doLayout}'s placement loop and its commit
 * pass. `clipPath` is `null` for a pane that carries no clip.
 */
interface SplitPlacement extends ResolvedPlacement {
    clipPath: string | null;
}
```

```typescript
private commitPanes(placements: SplitPlacement[]): void {
    for (const placement of placements) {
        this.commitBounds(placement.component, placement.x, placement.y, placement.width, placement.height);

        placement.component.setClipPath(placement.clipPath);
    }
}
```

The clip-path write comes after the bounds write, exactly as in today's loop.

---

## Ordered Implementation Steps

Each phase is independent: typecheck and the manager's own test file must pass before moving to the next.

### Phase 1 — `Absolute`

1. **`packages/lib/src/typescript/lib/layout/Absolute.ts`** — add `ResolvedPlacement` to the existing named import from `~/layout/LayoutManager.js` on line 3. That import already carries the `LayoutManagerOptions` interface, so add the name to it rather than opening a separate `import type` line.

2. **`Absolute.ts`, `doLayout`** — declare `const placements: ResolvedPlacement[] = [];` immediately before the `for` loop on [line 49](packages/lib/src/typescript/lib/layout/Absolute.ts#L49); replace the `this.commitBounds(component, x, y, width, height);` on line 59 with `placements.push({ component, x, y, width, height });`; add `this.commitPlacements(placements);` after the loop's closing brace, as the method's last statement. Leave the four `const` lines that compute `width`/`height`/`x`/`y` untouched.

3. **Checkpoint** — `grep -n 'commitBounds' packages/lib/src/typescript/lib/layout/Absolute.ts` → zero matches. Then `npm -w packages/lib run typecheck` and, from `packages/lib`, `npx vitest run tests/component/layout/Absolute.test.ts`.

### Phase 2 — `Anchor`

4. **`packages/lib/src/typescript/lib/layout/Anchor.ts`** — add `ResolvedPlacement` to the existing named import from `~/layout/LayoutManager.js` on line 3.

5. **`Anchor.ts`, `doLayout`** — declare `const placements: ResolvedPlacement[] = [];` immediately before the `for` loop on [line 157](packages/lib/src/typescript/lib/layout/Anchor.ts#L157); replace the `this.commitBounds(component, xAxis.start, yAxis.start, xAxis.extent, yAxis.extent);` on line 173 with `placements.push({ component, x: xAxis.start, y: yAxis.start, width: xAxis.extent, height: yAxis.extent });`; add `this.commitPlacements(placements);` after the loop, as the method's last statement. `resolveAxis` and `resolve` are not touched — they stay the calc step.

6. **`Anchor.ts`, doc comments** — the class JSDoc on [line 49](packages/lib/src/typescript/lib/layout/Anchor.ts#L49) and the `doLayout` JSDoc on [line 137](packages/lib/src/typescript/lib/layout/Anchor.ts#L137) both say the manager commits through `commitBounds`. Change both to `commitPlacements`, keeping the surrounding wording (including "bypassing the cell clamp", which is still true) and the plain-backtick form — do not turn either into a `{@link}`.

7. **Checkpoint** — `grep -n 'commitBounds' packages/lib/src/typescript/lib/layout/Anchor.ts` → zero matches. Then typecheck and `npx vitest run tests/component/layout/Anchor.test.ts`.

### Phase 3 — `HFlow`

8. **`packages/lib/src/typescript/lib/layout/HFlow.ts`** — add `import type { ResolvedPlacement } from "~/layout/LayoutManager.js";` to the import block at the top (lines 3–7), matching [HBox.ts:4](packages/lib/src/typescript/lib/layout/HBox.ts#L4).

9. **`HFlow.ts`, rename** — rename `placeRows` ([line 372](packages/lib/src/typescript/lib/layout/HFlow.ts#L372)) to `resolveRows`. Update its two other references: the call in `doLayout` on [line 294](packages/lib/src/typescript/lib/layout/HFlow.ts#L294), and the `@returns The ordered rows ready for {@link HFlow.placeRows}` line in `groupIntoRows`'s JSDoc ([line 322](packages/lib/src/typescript/lib/layout/HFlow.ts#L322)).

10. **`HFlow.ts`, `resolveRows`** — change the return type from `void` to `ResolvedPlacement[]`; declare `const placements: ResolvedPlacement[] = [];` as the method's first statement, **before** the outer `for (const row of rows)` loop, so one array spans every row; replace the `this.placeComponent(cell.component, x, y, cell.width, cell.height, FillType.NONE);` on [line 393](packages/lib/src/typescript/lib/layout/HFlow.ts#L393) with the push shown in `## Internal Structure`; `return placements;` as the method's last statement. Leave `x += cell.width + gap;` and the `justifyGaps` / `alignLead` / `crossOffset` calls untouched.

11. **`HFlow.ts`, `resolveRows` JSDoc** — the summary says "Phase 2 of {@link HFlow.doLayout}: distributes each row's cells…". Keep the description of what it computes; change the closing sentence so it says the method resolves each cell's bounds rather than committing them, and add an `@returns The resolved placements, ready for {@link LayoutManager.commitPlacements}.` line, matching [HBox.ts:314](packages/lib/src/typescript/lib/layout/HBox.ts#L314).

12. **`HFlow.ts`, `doLayout`** — replace the single `this.placeRows(rows, insets.getLeft(), innerSize.width, spacing);` call with two statements:

    ```typescript
    const placements = this.resolveRows(rows, insets.getLeft(), innerSize.width, spacing);

    this.commitPlacements(placements);
    ```

    Both must sit where the old call sat — **above** the `Number.isFinite(innerSize.width)` block and the `this.reserveContentFrame()` call, which read committed geometry.

13. **Checkpoint** — `grep -n 'placeComponent\|placeRows' packages/lib/src/typescript/lib/layout/HFlow.ts` → zero matches. Then typecheck and `npx vitest run tests/component/layout/HFlow.test.ts tests/component/layout/FlowLayout.test.ts`.

### Phase 4 — `VFlow`

14. **`packages/lib/src/typescript/lib/layout/VFlow.ts`** — repeat steps 8–12 against the mirror-image members: import block at the top; `placeColumns` ([line 358](packages/lib/src/typescript/lib/layout/VFlow.ts#L358)) → `resolveColumns`; call site in `doLayout` ([line 278](packages/lib/src/typescript/lib/layout/VFlow.ts#L278)); the `{@link VFlow.placeColumns}` reference in `groupIntoColumns`'s `@returns` ([line 306](packages/lib/src/typescript/lib/layout/VFlow.ts#L306)); the `placeComponent` call on [line 374](packages/lib/src/typescript/lib/layout/VFlow.ts#L374). One `placements` array declared before the outer `for (const column of columns)` loop. Leave `y += cell.height + gap;` untouched.

15. **Checkpoint** — `grep -n 'placeComponent\|placeColumns' packages/lib/src/typescript/lib/layout/VFlow.ts` → zero matches. Then typecheck and `npx vitest run tests/component/layout/VFlow.test.ts`.

### Phase 5 — `Split`

16. **`packages/lib/src/typescript/lib/layout/Split.ts`** — add `ResolvedPlacement` to the existing named import from `~/layout/LayoutManager.js` on line 3.

17. **`Split.ts`, record type** — declare the `SplitPlacement` interface from `## Internal Structure` between the `SplitOptions` interface ([line 62](packages/lib/src/typescript/lib/layout/Split.ts#L62)) and the `Split` class JSDoc.

18. **`Split.ts`, `commitPanes`** — add the private method from `## Internal Structure` directly after `placeGutterAsStrip` ([line 1346](packages/lib/src/typescript/lib/layout/Split.ts#L1346)), with a JSDoc block covering the parameter.

19. **`Split.ts`, `placeGutterAsStrip`** — change the return type from `void` to `SplitPlacement`. Keep every gutter write (`setOpaque` / `setVisible` / `setX` / `setY` / `setWidth` / `setHeight`) and `pane.setVisible(true)` exactly where they are. Replace the `if (horizontal) { … } else { … }` block containing the two `placeComponent` calls ([lines 1370–1376](packages/lib/src/typescript/lib/layout/Split.ts#L1370)) with the same branch assigning a `SplitPlacement` local:

    ```typescript
    let placement: SplitPlacement;

    if (horizontal) {
        const paneX = towardStart ? x : x + COLLAPSE_STRIP_SIZE - fullMain;
        placement = { component: pane, ...this.resolveBounds(pane, paneX, y, fullMain, crossSize, FillType.BOTH), clipPath: this.paneClipInset(direction) };
    } else {
        const paneY = towardStart ? y : y + COLLAPSE_STRIP_SIZE - fullMain;
        placement = { component: pane, ...this.resolveBounds(pane, x, paneY, crossSize, fullMain, FillType.BOTH), clipPath: this.paneClipInset(direction) };
    }

    return placement;
    ```

    Delete the now-redundant `pane.setClipPath(this.paneClipInset(direction));` on [line 1378](packages/lib/src/typescript/lib/layout/Split.ts#L1378) — `commitPanes` writes it. Update the method's JSDoc with an `@returns` line saying it returns the pane's resolved placement for the caller to commit.

20. **`Split.ts`, `doLayout` collapsed branch** — declare `const placements: SplitPlacement[] = [];` immediately after `const placed = new Set<number>();` ([line 1233](packages/lib/src/typescript/lib/layout/Split.ts#L1233)); change the `this.placeGutterAsStrip(gutter, component, x, y, crossSize, horizontal, this.paneDirection(component));` call on [line 1249](packages/lib/src/typescript/lib/layout/Split.ts#L1249) to `placements.push(this.placeGutterAsStrip(…));` with the same arguments. Leave `placed.add(servingIdx);`, the `x`/`y` advance by `COLLAPSE_STRIP_SIZE`, and the `continue` untouched.

21. **`Split.ts`, `doLayout` expanded branch** — replace the `this.placeComponent(component, x, y, …, FillType.BOTH);` call on [lines 1265–1272](packages/lib/src/typescript/lib/layout/Split.ts#L1265) and the `component.setClipPath(servingIdx >= 0 ? "inset(0 0 0 0)" : null);` on [line 1277](packages/lib/src/typescript/lib/layout/Split.ts#L1277) with one push that folds both:

    ```typescript
    placements.push({
        component,
        ...this.resolveBounds(component, x, y, horizontal ? mainSize : crossSize, horizontal ? crossSize : mainSize, FillType.BOTH),
        clipPath: servingIdx >= 0 ? "inset(0 0 0 0)" : null
    });
    ```

    Keep the comment above the old `setClipPath` line with the push. Leave `component.setVisible(true);` on line 1263 where it is, and leave the whole gutter block on lines 1285–1322 untouched.

22. **`Split.ts`, commit** — add `this.commitPanes(placements);` immediately after the main loop's closing brace on [line 1323](packages/lib/src/typescript/lib/layout/Split.ts#L1323), before the gutter-visibility sweep on lines 1325–1329.

23. **Checkpoint** — `grep -n 'placeComponent' packages/lib/src/typescript/lib/layout/Split.ts` → zero matches. `grep -n 'setClipPath' packages/lib/src/typescript/lib/layout/Split.ts` → exactly one match, inside `commitPanes`. Then typecheck and `npx vitest run tests/component/layout/Split.test.ts tests/component/layout/CollapseAnimationTeardown.test.ts`.

### Phase 6 — `Grid`

24. **`packages/lib/tests/component/layout/Grid.test.ts`** — add the clip-frame test specified in `## Expected Behaviour`, **before** editing `Grid.ts`, and run it: `npx vitest run tests/component/layout/Grid.test.ts` from `packages/lib`. It must be green against the unconverted `Grid.ts`. A red result here means the test's expectations are wrong, not that `Grid` is — fix the test before continuing.[^grid-test]

25. **`packages/lib/src/typescript/lib/layout/Grid.ts`** — add `ResolvedPlacement` to the existing named import from `~/layout/LayoutManager.js` on line 3, and declare the `GridPlacement` interface from `## Internal Structure` after the `GridOptions` interface (which ends at line 38) and before the `Grid` class JSDoc.

26. **`Grid.ts`, baseline branch of `doLayout`** — declare `const placements: ResolvedPlacement[] = [];` immediately before `let y = containerInsets.getTop();` on [line 737](packages/lib/src/typescript/lib/layout/Grid.ts#L737); replace the `this.placeComponent(cell.component, x, cellY, width, cell.height, this._defaultFill, this._defaultAnchor);` call on [lines 768–776](packages/lib/src/typescript/lib/layout/Grid.ts#L768) with `placements.push({ component: cell.component, ...this.resolveBounds(cell.component, x, cellY, width, cell.height, this._defaultFill, this._defaultAnchor) });`; add `this.commitPlacements(placements);` after the outer rows loop closes on [line 782](packages/lib/src/typescript/lib/layout/Grid.ts#L782), as `doLayout`'s last statement. Leave the `y += Math.max(rowExtents[row] ?? 0, baselineHeight) + spacing;` advance untouched.

27. **`Grid.ts`, `commitGridPlacements`** — add the private method from `## Internal Structure` directly after `layoutOccupancy` ([line 944](packages/lib/src/typescript/lib/layout/Grid.ts#L944) to line 1073), with a JSDoc block covering the parameter.

28. **`Grid.ts`, `placeAt` → `resolveAt`** — rename the closure on [line 962](packages/lib/src/typescript/lib/layout/Grid.ts#L962) and change its type from `(…) => void` to `(…) => GridPlacement`. Keep byte-identical: the `x`/`y`/`w`/`h` arithmetic, the `const min = component.getMinSize();` test, both `const resolved = this.resolveBounds(…)` calls, and the clip branch's `pref` / `childWidth` / `childHeight` lines. Only the two branches' trailing side effects become returns, and both explanatory comments stay:

    - clip branch (today [lines 1007–1008](packages/lib/src/typescript/lib/layout/Grid.ts#L1007)) — `return { component, x: resolved.x - x, y: resolved.y - y, width: childWidth, height: childHeight, clipFrame: { x, y, width: w, height: h } };`
    - fit branch (today [lines 1015–1016](packages/lib/src/typescript/lib/layout/Grid.ts#L1015)) — `return { component, x: resolved.x, y: resolved.y, width: resolved.width, height: resolved.height, clipFrame: null };`

29. **`Grid.ts`, `layoutOccupancy` passes** — declare `const placements: GridPlacement[] = [];` immediately after the `resolveAt` closure's closing `};`; change `placeAt(component, r, c, rowSpan, colSpan);` on [line 1044](packages/lib/src/typescript/lib/layout/Grid.ts#L1044) and `placeAt(component, slot.r, slot.c, rowSpan, colSpan);` on [line 1071](packages/lib/src/typescript/lib/layout/Grid.ts#L1071) to `placements.push(resolveAt(…));` with the same arguments; add `this.commitGridPlacements(placements);` after pass 2's loop closes on [line 1072](packages/lib/src/typescript/lib/layout/Grid.ts#L1072), as the method's last statement. One array spans both passes, so explicit children still commit before auto-flowed ones.

30. **Checkpoint** — `grep -n 'placeComponent\|placeAt' packages/lib/src/typescript/lib/layout/Grid.ts` → zero matches. `grep -n 'setClipFrame\|clearClipFrame' packages/lib/src/typescript/lib/layout/Grid.ts` → exactly two matches, both inside `commitGridPlacements`. Then typecheck and `npx vitest run tests/component/layout/Grid.test.ts` — including the step-24 test, still green.

### Phase 7 — guards and full verification

31. **Confirm the untouched files stayed untouched** — `git diff --stat` must list exactly seven files: `Absolute.ts`, `Anchor.ts`, `HFlow.ts`, `VFlow.ts`, `Split.ts`, `Grid.ts`, `Grid.test.ts`. `git diff packages/lib/src/typescript/lib/layout/LayoutManager.ts packages/lib/src/typescript/lib/layout/Tab.ts packages/lib/src/typescript/lib/layout/Border.ts` must be empty.

32. **Run everything in `## Verification`.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Absolute.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Anchor.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/HFlow.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/VFlow.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Grid.ts` |
| Modify | `packages/lib/tests/component/layout/Grid.test.ts` |

---

## Expected Behaviour

This is a pure refactor: every case below must produce **the same numbers as before the change**. Only one new test is added — the `Grid` clip-frame case, which has no coverage today and is the one branch whose non-bounds side effect moves.[^grid-test]

| Manager | Case | Expectation | How it is checked |
|---|---|---|---|
| `Absolute` | Children at application-set `x`/`y`, one larger than the container | Same `x`/`y` (each child's own `getX`/`getY`) and same unclamped `width`/`height` as before; commit order is child order | Unit — `tests/component/layout/Absolute.test.ts` |
| `Anchor` | Both edges set (stretch), one edge set, neither edge set | Stretch still derives `inner − near − far`; the no-edge child still lands at its own `getX`/`getY` with no inset origin added | Unit — `tests/component/layout/Anchor.test.ts` |
| `Anchor` | Percentage offsets | `extent * percent / 100` unchanged | Unit — `Anchor.test.ts` |
| `HFlow` / `VFlow` | Wrapped rows/columns with `align`, `justify`, `itemAlign` including `"baseline"` | Every cell lands at the same `x`/`y`/`width`/`height`; the wrapped-line extent published afterwards is unchanged | Unit — `HFlow.test.ts`, `VFlow.test.ts`, `FlowLayout.test.ts` |
| `HFlow` / `VFlow` | Scroll-enabled host | Content frame still sizes to the children's committed far edge, because `reserveContentFrame` still runs after the commit | **Inspection** — step 12 keeps the commit above `reserveContentFrame`; neither the flow tests nor the flow demos use a scrolling host, so nothing else guards this |
| `Split` | Expanded panes, horizontal and vertical | Same pane rects; a collapsible pane still carries `inset(0 0 0 0)`, a non-collapsible one still carries no clip | Unit — `tests/component/layout/Split.test.ts` |
| `Split` | A collapsed pane | The gutter still fills the pane's slot as the opaque strip, the pane still commits at full stored size anchored to its collapse edge, and its `clip-path` is still the direction inset | Unit — `Split.test.ts`; **manual** — collapse/expand animation, dev app "Split" section |
| `Split` | Gutter geometry and the trailing hide sweep | Unchanged — gutter writes were not deferred | Unit — `Split.test.ts` |
| `Grid` | `baselineAlign: true` rows | Same per-cell `x`/`y`/`width`, same row advance | Unit — `Grid.test.ts` |
| `Grid` | Occupancy path, child fits its cell | Same fill/anchor-resolved rect; the child's clip frame is cleared | Unit — `Grid.test.ts` |
| `Grid` | Occupancy path, child's min exceeds its cell | Clip frame installed at the cell rect; child committed at the frame-relative offset with its natural extent on the overflowing axis | **Unit — new test, see below** |
| `Grid` | Explicit `col`/`row` children plus auto-flowed children | Explicit children still commit before auto-flowed ones | Unit — `Grid.test.ts` |
| All six | Container with zero children | The array stays empty and the commit pass writes nothing, exactly as the old loop wrote nothing | **Inspection** — the loop body never runs; no per-manager empty-container geometry test exists |

### The new `Grid` clip-frame test

Add to `packages/lib/tests/component/layout/Grid.test.ts` in a new `describe` block, following the file's existing idiom: `installTestDOM(CONFIG)`, the `hostGrid` helper, children built as `new Component({ preferredSize: … })` and added with `host.addComponent(…)`, geometry asserted after `host.doLayout()`, and `afterEach(() => DOM.reset())`.

Setup: a `Grid` with `rows: 1`, `columns: 2`, `spacing: 0`, `columnTracks: [{ mode: 'fixed' as const, value: 50 }, { mode: 'weight' as const, value: 1 }]`, hosted at 200×100. Child `a` is `new Component({ preferredSize: { width: 150, height: 20 } })` with `a.setMinSize({ width: 150, height: 20 })` (the setter form, matching `HFlow.test.ts:105`); child `b` is `new Component({ preferredSize: { width: 20, height: 20 } })` with no min. Both auto-flow, so `a` takes the fixed 50-wide column and `b` the 150-wide weight column.

Assert, after `host.doLayout()`:

| Subject | Expected | Why |
|---|---|---|
| `a.getX()`, `a.getY()` | `0`, `0` | committed relative to its clip frame; `resolveBounds` applies no anchor displacement on an overflowing axis |
| `a.getWidth()` | `150` | natural extent on the overflowing axis, not the 50-wide cell |
| `a.getHeight()` | `100` | fits vertically, so the cell-resolved height under the default `FillType.BOTH` |
| `DOM.source.getParentNode(a.getElement()!)` | not the host's element | the clip frame is installed and `a` is parked inside it |
| `b.getX()`, `b.getWidth()` | `50`, `150` | the second column is unaffected |
| `DOM.source.getParentNode(b.getElement()!)` | the host's element | `b`'s frame is cleared, so it stays a direct child |

---

## Verification

1. `npm -w packages/lib run typecheck`
2. `npm -w packages/lib run test` — the full suite, not just the layout files. These six managers are constructed throughout the component library, so the whole suite is the honest regression gate. Worth reading by name in the output: `tests/component/layout/{Absolute,Anchor,HFlow,VFlow,FlowLayout,Split,Grid,CollapseAnimationTeardown}.test.ts`.
3. **Per-file grep invariants** (all already listed as phase checkpoints):
   - `Absolute.ts`, `Anchor.ts` — zero `commitBounds` matches.
   - `HFlow.ts`, `VFlow.ts`, `Split.ts`, `Grid.ts` — zero `placeComponent` matches.
   - `Split.ts` — exactly one `setClipPath`, inside `commitPanes`.
   - `Grid.ts` — exactly two clip-frame calls, both inside `commitGridPlacements`.
4. `git diff packages/lib/src/typescript/lib/layout/LayoutManager.ts packages/lib/src/typescript/lib/layout/Tab.ts packages/lib/src/typescript/lib/layout/Border.ts` — expect empty.
5. **Read the diff end to end.** For every cursor-advance line (`x +=` / `y +=`) confirm it still reads the pre-resolved local (`cell.width`, `cell.height`, `mainSize`, `COLLAPSE_STRIP_SIZE`, `gap`, `spacing`, `rowExtents[row]`) and never `component.getWidth()` / `component.getHeight()`. This is the one mistake the type checker cannot catch, and it is what makes the deferral safe.[^ordering]
6. **Manual, in the dev app** (`npm run dev`, http://localhost:8015) — these routes cover the branches the offline suite does not reach:
   - **Split** section: drag a gutter, then collapse and expand a pane. The strip must appear in the pane's slot and the pane must animate into and out of it without snapping. This is the only check on the clip-path write moving into `commitPanes`.
   - **Grid** section: the wide child pinned to the fixed 120px column (`GridPanel.ts:50` sets `minSize` 400×30) must still clip at the column edge rather than spilling into the next column, and no spurious horizontal scrollbar may appear.
   - **HFlow** / **VFlow** sections: resize the window and confirm wrapping, line alignment, and item alignment are unchanged.
7. **Manual, in the docs app** (`npm run docs:dev`, http://localhost:5173) — open the layout pages carrying the `absolute-placement`, `anchor-positions`, `grid-tracks`, `grid-uniform`, `hflow-wrap` and `split-panes` demos and confirm each renders as before.

---

## Documentation Impact

None. No symbol changes visibility, no barrel is edited, and every name introduced (`GridPlacement`, `SplitPlacement`, `commitGridPlacements`, `commitPanes`) is file-local or `private`, so TypeDoc does not emit it. Of the renames, `resolveRows` and `resolveColumns` are `private` methods and `resolveAt` is a local closure. `npm -w packages/lib run docs:api` output should be unchanged from its pre-change baseline.

---

## Potential Challenges

- **`Split.placeGutterAsStrip` both writes and returns.** After the change it still writes the gutter's geometry but returns the pane's placement instead of committing it. Reviewers will read the name as "places everything"; the `@returns` line added in step 19 is what tells them otherwise — do not skip it.
- **`Split`'s clip-path write is animation-driving.** It is the property the collapse transition interpolates. `commitPanes` keeps it after the bounds write, per pane, exactly as today — but this is the one reorder risk in the plan, so the manual collapse/expand check in `## Verification` step 6 is not optional.
- **`Grid`'s clip branch commits frame-relative coordinates.** `resolveAt`'s clip branch must keep `resolved.x - x` / `resolved.y - y`, not `resolved.x` / `resolved.y`: the child is parked inside a frame anchored at the cell. Copying the fit branch's fields into the clip branch would move every clipped child by the cell origin.
- **One array per method, not per branch.** `Grid.layoutOccupancy` spans two passes and `HFlow.resolveRows` spans two nested loops; each still uses a single array so commit order matches today's placement order. The opposite mistake — one array per inner loop, committed inside the outer one — reintroduces the interleaving this plan removes.
- **`reserveContentFrame` must stay after the commit.** `HFlow` and `VFlow` call it at the end of `doLayout`, and it reads every child's committed `getX`/`getY`/`getWidth`/`getHeight`. Step 12 places the commit above it; moving the commit below it would size the content frame from the previous pass's geometry.
- **A child's `doLayout()` now runs after the next child has been measured.** `Grid`'s occupancy path reads `component.getMinSize()` and `getPreferredSize()` inside the resolve pass, so after this change child *n*'s sizes are read before child *n−1* is committed. Children are independent subtrees, so a sibling's `doLayout` cannot alter another's reported size — but if the suite shows a geometry regression in `Grid`, this is the first thing to look at.[^ordering]

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) — read, do not edit: `ResolvedPlacement` (28), `placeComponent` (318), `resolveBounds` (345), `commitBounds` (484), `commitPlacements` (503), `reserveContentFrame` (256).
- [`packages/lib/src/typescript/lib/layout/HBox.ts`](packages/lib/src/typescript/lib/layout/HBox.ts) — **the precedent.** `doLayout`'s dispatch-then-commit shape (268–300) and the pushes inside `layoutEqualMode` (316) are what every conversion here mirrors. `VBox.ts` is the same file transposed.
- [`packages/lib/src/typescript/lib/layout/HFlow.ts`](packages/lib/src/typescript/lib/layout/HFlow.ts) — `HFlowRow` (28) shows where a file-local record type is declared and documented; `GridPlacement` and `SplitPlacement` copy that slot and JSDoc style.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `setClipFrame` (1119) and `clearClipFrame` (1160). Both re-parent the element, which is why the clip decision is carried in `GridPlacement` and applied in the commit pass rather than during the resolve pass.
- [`plans/implemented/hbox-vbox-layout-calc-commit-split.md`](plans/implemented/hbox-vbox-layout-calc-commit-split.md) — the pilot plan, including its `## Implementation Notes` on which box branches the green suite does *not* prove.
- [`packages/lib/src/typescript/GridPanel.ts`](packages/lib/src/typescript/GridPanel.ts) — line 50 pins a 400px-min child into a 120px fixed column; the live route for `Grid`'s clip branch.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Positioning is always absolute* and *Size constraints: who is responsible for what*, the two rules this refactor must not disturb.

---

## Non-Goals

- **`Tab` and `Border`.** Both were investigated and deliberately excluded; see `## Architecture Decisions`. Neither file may appear in the diff.
- **`LayoutManager.ts`.** No new shared type, no change to `commitPlacements`'s signature or body, no change to `resolveBounds` / `commitBounds` / `placeComponent`.
- **`Card`, `Fit`.** Each places a single child through one `placeComponent` call ([Card.ts:274](packages/lib/src/typescript/lib/layout/Card.ts#L274), [Fit.ts:243](packages/lib/src/typescript/lib/layout/Fit.ts#L243)) — the same no-loop shape that excludes `Tab`.
- **`Accordion`, `Table`.** Neither routes bounds through `placeComponent` / `commitBounds` at all; both write `setX`/`setY`/`setWidth`/`setHeight` directly. `Table` was additionally confirmed non-separable by the pilot: it reads an earlier sibling's committed geometry to size a later one.
- **Any geometry-diff or skip-unchanged optimization.** This plan only makes one possible later by giving every manager a resolved-rect array; it implements none of it.
- **Batching the DOM writes across children.** Every commit pass commits one child at a time, exactly as the current loops do.
- **Changing when a child's `doLayout()` runs relative to its own commit.** Commit and recurse stay fused inside `commitBounds`.
- **Backfilling the missing coverage the pilot flagged.** The equal-mode and cross-constraint gaps in `HBox`/`VBox` predate this change.

---

## Notes

[^base-untouched]: The pilot added `ResolvedPlacement` and `commitPlacements` to `LayoutManager` and four managers now depend on them (`HBox`, `VBox`, and after this plan `HFlow`, `VFlow`). Widening that shared surface for one manager's side effect — e.g. adding an optional `clipFrame` field consumed by `commitPlacements` — would put a three-state field (`undefined` = leave the child's frame alone, `null` = clear it, a rect = install it) on the path every already-migrated manager runs through. The distinction between "no opinion" and "clear it" is exactly the kind of subtlety that silently breaks a manager that never asked for it, and the alternative costs about the same number of lines. Rejected in favour of file-local records.

[^precedent]: `HFlow.groupIntoRows` builds `HFlowRow[]` — records of `{ component, width, height, baseline }` — with no component mutation, and `placeRows` walks that array. The pilot brought the same shape to `HBox`/`VBox` (`055c4c70`), which is why `HFlow`'s own phase 2 is now the odd one out: it holds an array but still commits inside its loop. Converting it closes the loop on the pattern it inspired.

[^local-record]: The record's job is to carry every decision the resolve pass made, so the commit pass replays them in the original per-child order. `Grid`'s frame decision must land *before* its bounds write (the child is re-parented into the frame, and its committed coordinates are relative to it); `Split`'s clip-path must land *after* (that is where it sits today, and it drives a CSS transition). One shared commit loop cannot honour both orders without a flag, and two five-line private loops are cheaper and clearer than that flag. A file-local record also keeps each manager's extra state next to the manager that produces it, as `HFlowRow` and `VFlowColumn` already do.

[^split-gutters]: The gutters are `SplitGutter` components positioned with raw `setX`/`setY`/`setWidth`/`setHeight`, not through `commitBounds`, and they share the pane loop's running cursor: a divider consumes `GUTTER_SIZE` between two panes, a collapse strip consumes `COLLAPSE_STRIP_SIZE` in place of one. Deferring them too would mean a second record type for a component that is not laid out through the placement seam at all. Their writes are also cheap — four setters, no recursive `doLayout` — so the expensive half (the panes, each of which recurses into its whole subtree) is the half worth deferring. `Split`'s resolve pass reads nothing from the DOM (`computeMainAxisSizes` runs before the loop and `_sizes` is a map), so the gain here is write batching and consistency with the other managers, not the removal of a read-after-write.

[^tab]: `grep -n 'placeComponent\|commitBounds' Tab.ts` returns exactly one hit, at line 1961, and `doLayout` (1798–1991) contains no placement loop — the `for` loop at 1829 only toggles `setVisible`/ARIA on every child before the single visible one is placed. Collecting one placement into an array and immediately committing it adds an allocation and a redirection for no separation: the resolve and the commit would still be adjacent statements. The task brief described `Tab` as looping over tabs; that is not what the code does, and the brief's expectation is not followed here.

[^border]: Border's five region blocks each choose between two placement styles based on `isRegionCollapsible(placement) || this._collapsing`. The collapsible style calls `placeComponent` at the region's absolute rect, then `clearClipFrame()`, then `applyRegionClip` (which writes a `clip-path`, or writes nothing for a non-collapsible region). The framed style writes `setClipPath(null)`, then `setClipFrame` at the region's rect, then commits the child at `(0, 0)` inside that frame. A single array would need to carry the style, the frame rect and the clip-path decision, and the commit loop would re-run the same branch — no reduction in branching, a rewrite of a 260-line method, and each region's `updateRegionGutter` call would still write DOM between the resolve steps, so the resolve pass would not even become write-free. Border also throws mid-method when a region reports no preferred size; deferring the commits would change which regions are already committed when that throw fires. Left alone.

[^renames]: The rename is three references per file: the declaration, the call in `doLayout`, and one `{@link}` in the phase-1 method's `@returns`. All three are private symbols, so nothing outside the file sees the change and no doc page references them. The alternative — keeping `placeRows` on a method that no longer places anything — trades a five-minute edit for a name that misleads every future reader.

[^grid-test]: `Grid.test.ts` has ten cases and none touches a clip frame; `grep -rn 'setClipFrame' packages/lib/tests/` matches only `element-release.test.ts` and `handle-registry.test.ts`, neither of which goes through `Grid`. That branch is also the only place in this plan where a side effect other than a bounds write moves into a new pass, so the existing-suite-as-regression-net argument does not cover it. Hence the inverted order in Phase 6: the test runs green against the unconverted `Grid` first (step 24), then again after the conversion (step 30). A test that only ever ran against the new code would prove the new code self-consistent, not unchanged — which is the property this whole plan is claiming.

[^ordering]: The rule the whole sweep rests on, unchanged from the pilot: `resolveBounds` reads only its arguments, the manager's own `_layoutConstraints` map, and the child's own `getPreferredSize()`/`getSize()`/`getMinSize()`/`getMaxSize()`. It never reads a component's current `x`/`y`/`width`/`height`, and it mutates nothing. `commitBounds` writes only the child it was handed and recurses into that child's own subtree, so no commit can change a sibling's reported size. Each converted file was checked against that rule: `HFlow`/`VFlow` do all their measuring in `groupIntoRows`/`groupIntoColumns` before any commit; `Split` measures in `computeMainAxisSizes` before the loop; `Grid` reads only the child being resolved. The two exceptions that read a component's own position — `Absolute` and `Anchor`, which read `getX()`/`getY()` for children with no anchoring constraint — are safe because each writes back the same value it read, and no other child's commit touches it.
