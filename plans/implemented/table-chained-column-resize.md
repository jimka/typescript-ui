---
depends-on: [table-generated-column-widths]
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Table.ts
  - packages/lib/src/typescript/lib/layout/Table.ts
---

# Chained Column Resize — Implementation Plan

## Overview

Dragging a column's right edge in a `Table` is zero-sum between that column and its immediate right neighbour. Once the neighbour reaches its `minWidth`, the pair has nothing left to trade: [`onColumnResize`](packages/lib/src/typescript/lib/component/table/Table.ts#L1235) clamps the dragged column at whatever width it had reached and silently discards every further pixel of travel, so the handle detaches from the cursor. In the extreme — where the correction would also push the dragged column below its own minimum — the method returns without writing anything at all.

This plan replaces that with the model `Accordion` already uses for its gutters: width is taken from — and given to — columns fanning outward from the dragged edge, nearest-first. The nearest column absorbs the travel until it hits its bound, then the next one beyond it takes over. The chain-distribution arithmetic moves out of [`Accordion.distributeDragChain`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1949) into a shared module both call sites import.

Unlike `Accordion`, this drag is not strictly conserving. When the columns on the right of the edge can give up no more width, further travel widens the table's **total column width** instead of stalling; the table then scrolls horizontally, which the header and body already support. The widened total is recorded on the `Table` so the layout manager's `rescaleWidths` preserves it instead of squeezing the columns back to the container width on the next pass.

---

## Architecture Decisions

### The drag mirrors `Accordion`'s gutter chain

The dragged edge splits the visible columns into two chains, each ordered nearest-first: the **left chain** `[i, i-1, …, 0]` and the **right chain** `[i+1, …, n-1]`, where `i` is the index of the column whose right edge is dragged. Moving the edge right grows the left chain and shrinks the right chain; moving it left does the reverse. Each chain distributes the travel nearest-first, spilling to the next column only once the current one reaches its bound.

The precedent is [`Accordion.onGutterDrag`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1821) and [`Accordion.distributeDragChain`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1949), which already establish the upper-group / lower-group split, the nearest-first spill, and the two supporting rules below.[^mirror]

### Per-frame deltas, not an absolute origin

Each `columnresize` event applies only that frame's pointer travel on top of the live widths, replacing the current absolute `originWidth ± (clientX − originClientX)` derivation. The three origin fields (`_resizeOriginClientX`, `_resizeOriginW0`, `_resizeOriginW1`) are deleted.[^incremental]

### Blocked travel accrues as a dead zone

The tracked pointer position advances by the travel that was **actually applied**, not by the raw `clientX`. When the chains are exhausted the applied travel is zero and the tracked pointer stays put, so travel past the limit accrues a dead zone the pointer must retrace before the edge moves again. Advancing by applied travel alone is what keeps the cursor glued to the handle on reversal.[^deadzone]

### The table's width is the last thing to grow and the first thing to give back

The table's total column width is the sum of the visible column widths. It is allowed to exceed the container's available width, and the excess becomes horizontal scroll extent. The rule that decides when it moves:

- **Edge moving right** — the right chain gives up width first; only what it cannot give grows the total.
- **Edge moving left** — the total gives back its accumulated growth first, down to the available width; only what remains is handed to the right chain.

So the total never falls below the available width, and any growth is undoable at the same handle.[^ratchet]

**Amendment (post-implementation).** The right chain participates *only while the columns fit the container*. Once the total exceeds the available width — a horizontal scrollbar is showing — the drag stops scavenging altogether: the edge resizes the columns to its left and the total moves with it, in both directions, and the columns to the right are never touched. Without this, a table that reached its overflowing state some other way (the last column's own handle, or a column set whose `minWidth` sum already exceeds the container) would still steal width from the right of the edge while a scrollbar was showing, which is the wrong trade — space is not scarce once the table can scroll. Concretely this is one term in `onColumnResize`: the rightward branch's `absorbed` is `0` when `growth > WIDTH_TARGET_EPSILON_PX`. The leftward branch is unchanged and already had the right shape — `delta − min(delta, growth)` is `0` for as long as growth remains, so scavenging resumes exactly at the point the table fits again, mid-frame if need be. `Accordion` is unaffected: only the arithmetic primitives are shared, never this policy.

### "The table's maximum width" is the columns' own `maxWidth` constraints

Growth stops when every column in the left chain has reached its `Column.getMaxWidth()`. No table-level ceiling, option, or ceiling constant is introduced — the cap falls out of the chain arithmetic, which cannot push a column past its declared maximum. With no `maxWidth` declared (the default) the total is unbounded, and the practical limit is that the pointer cannot travel past the window edge.[^ceiling]

### The widened total is stored on the `Table` and honoured by `rescaleWidths`

`Table` gains a private `_columnWidthTarget`: the column sum the last drag committed when that sum exceeded the available width, otherwise `0`. The layout manager rescales toward `Math.max(availableWidth, container.getColumnWidthTarget())` instead of `availableWidth`. Without it, the next layout pass shrinks the widened columns straight back.[^target]

### The chain arithmetic moves to a shared module

`chainRoom` and `distributeDragChain` move into a new internal `core/DragChain.ts`, which `Accordion` and `Table` both import. `Accordion`'s behaviour is unchanged — only the two helper bodies move.[^extract]

### `onColumnResize` keeps calling `doLayout()` synchronously

The synchronous `doLayout()` per pointer move stays. Switching to `scheduleLayout()` belongs to the separate wide-table performance work, not here.[^schedule]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/DragChain.ts — new internal module, no barrel export

/** Travel below this many pixels is treated as no travel at all. */
export const DRAG_DISTRIBUTION_EPSILON: number;

/**
 * Total room the group has left: toward `maxs` when `sign` is +1, toward
 * `mins` when `sign` is -1. Each term is floored at 0.
 */
export function chainRoom(
    group  : number[],
    current: number[],
    sign   : number,
    mins   : number[],
    maxs   : number[],
): number;

/**
 * Distributes `delta` across `group` (nearest-first), growing (`sign` +1) or
 * shrinking (`sign` -1) each entry within its `[min, max]`. `out` is seeded to
 * `current` by the caller and mutated in place.
 */
export function distributeDragChain(
    group  : number[],
    current: number[],
    delta  : number,
    sign   : number,
    mins   : number[],
    maxs   : number[],
    out    : number[],
): void;
```

```typescript
// packages/lib/src/typescript/lib/component/table/Table.ts

class Table extends Component<TableOptions> {
    /**
     * The pixel width the columns are laid out against: the table's inner width
     * less the reserved vertical-scrollbar track. `0` before first render.
     * Called by the layout manager.
     */
    getAvailableColumnWidth(): number;

    /**
     * The total column width a resize drag grew the table to, or `0` when the
     * table sits at its available width. Called by the layout manager.
     */
    getColumnWidthTarget(): number;
}
```

New private state on `Table`, replacing `_resizeOriginClientX` / `_resizeOriginW0` / `_resizeOriginW1`:

| Field | Type | Meaning |
|---|---|---|
| `_dragEdgeIndex` | `number \| null` | Index of the column whose right edge is being dragged; `null` when no drag is live. |
| `_dragLastClientX` | `number` | Pointer x consumed so far — advanced only by applied travel. |
| `_columnWidthTarget` | `number` | Backing field for `getColumnWidthTarget()`. |

None of the three is written by a setter that `applyOptions` dispatches, so they take ordinary initializers — no `declare`, and no `TableOptions` field.

---

## Internal Structure

### `core/DragChain.ts`

```typescript
export const DRAG_DISTRIBUTION_EPSILON = 1e-6;

export function chainRoom(group: number[], current: number[], sign: number, mins: number[], maxs: number[]): number {
    let total = 0;

    for (const pos of group) {
        total += sign > 0 ? Math.max(0, maxs[pos] - current[pos]) : Math.max(0, current[pos] - mins[pos]);
    }

    return total;
}

export function distributeDragChain(group: number[], current: number[], delta: number, sign: number, mins: number[], maxs: number[], out: number[]): void {
    const room = (pos: number): number =>
        sign > 0 ? Math.max(0, maxs[pos] - current[pos]) : Math.max(0, current[pos] - mins[pos]);

    let remaining = delta;

    for (const pos of group) {
        if (remaining <= DRAG_DISTRIBUTION_EPSILON) {
            return;
        }

        const take = Math.min(remaining, room(pos));
        out[pos] += sign * take;
        remaining -= take;
    }
}
```

Both bodies are the ones `Accordion` runs today — `distributeDragChain` verbatim, `chainRoom` as the loop currently inlined in `onGutterDrag` for `growRoom` / `shrinkRoom`.

### `Table.onColumnResizeStart`

```typescript
private onColumnResizeStart(colIndex: number, clientX: number): void {
    if (colIndex < 0 || colIndex >= this._columnWidths.length) {
        return;
    }

    this._dragEdgeIndex   = colIndex;
    this._dragLastClientX = clientX;
}
```

The guard drops from `colIndex >= n - 1` to `colIndex >= n`: the last column's right edge is now a working handle.

### `Table.onColumnResize`

```typescript
private onColumnResize(colIndex: number, clientX: number): void {
    if (this._dragEdgeIndex === null || colIndex !== this._dragEdgeIndex) {
        return;
    }

    const widths  = this._columnWidths;
    const columns = this.getColumns();
    const mins    = columns.map(col => col.getMinWidth() ?? MIN_COLUMN_WIDTH_PX);
    const maxs    = columns.map(col => col.getMaxWidth() ?? Number.POSITIVE_INFINITY);

    // Nearest-first chains fanning out from the dragged edge.
    const left : number[] = [];
    const right: number[] = [];

    for (let i = colIndex; i >= 0; i--) {
        left.push(i);
    }

    for (let i = colIndex + 1; i < widths.length; i++) {
        right.push(i);
    }

    const frameDelta = clientX - this._dragLastClientX;
    const sign       = frameDelta >= 0 ? 1 : -1;
    const available  = this.getAvailableColumnWidth();
    const total      = widths.reduce((s, w) => s + w, 0);
    // Growth already accrued, which a leftward drag gives back before the right
    // chain grows. Never negative: the total is floored at `available`.
    const growth     = Math.max(0, total - available);

    const delta = sign > 0
        ? Math.min(frameDelta, chainRoom(left, widths, 1, mins, maxs))
        : Math.min(-frameDelta, chainRoom(left, widths, -1, mins, maxs), chainRoom(right, widths, 1, mins, maxs) + growth);

    if (delta <= DRAG_DISTRIBUTION_EPSILON) {
        return;   // dead zone — the tracked pointer deliberately stays put
    }

    // Rightward: the right chain absorbs everything it can, the rest grows the
    // total. Leftward: the accrued growth is given back first, the rest is
    // absorbed by the right chain.
    const absorbed = sign > 0 ? delta : delta - Math.min(delta, growth);
    const out      = widths.slice();

    distributeDragChain(left,  widths, delta,    sign, mins, maxs, out);
    distributeDragChain(right, widths, absorbed, -sign, mins, maxs, out);

    this._dragLastClientX += sign * delta;
    this._columnWidths     = out;

    const newTotal = out.reduce((s, w) => s + w, 0);

    this._columnWidthTarget = newTotal > available + WIDTH_TARGET_EPSILON_PX ? newTotal : 0;

    this.doLayout();
}
```

`absorbed` never exceeds the right chain's room, because `delta` was already capped by `chainRoom(right, …) + growth` on the leftward branch.

### `Table.getAvailableColumnWidth`

```typescript
getAvailableColumnWidth(): number {
    const innerSize = this.getInnerSize();

    return innerSize ? innerSize.width - DOM.source.getScrollBarWidth() : 0;
}
```

This is the expression [layout/Table.ts:104](packages/lib/src/typescript/lib/layout/Table.ts#L104) computes today; that line is changed to call this method so the drag handler and the layout manager share one derivation.

---

## The distribution rule, worked

Available width **500**. Four `string` columns, none declaring a `maxWidth`:

| Column | Start width | `minWidth` |
|---|---|---|
| A | 200 | 60 |
| B | 150 | 100 |
| C | 100 | 40 |
| D | 50 | 30 |

Each row below is one drag frame applied to the row above it.

| # | Edge dragged | Travel | What happens | A | B | C | D | Total | `_columnWidthTarget` |
|---|---|---|---|---|---|---|---|---|---|
| 0 | — | — | starting state | 200 | 150 | 100 | 50 | 500 | 0 |
| 1 | A's right | +200 | right chain gives 130 (B 50, C 60, D 20), the remaining 70 grows the table | 400 | 100 | 40 | 30 | 570 | 570 |
| 2 | A's right | +50 | right chain is exhausted — all 50 grows the table | 450 | 100 | 40 | 30 | 620 | 620 |
| 3 | A's right | −30 | give-back first: 30 comes off the total, right chain untouched | 420 | 100 | 40 | 30 | 590 | 590 |
| 4 | A's right | −120 | 90 of give-back reaches the floor, the last 30 goes to B | 300 | 130 | 40 | 30 | 500 | 0 |
| 5 | D's right | +40 | no right chain — all 40 grows the table, D absorbs it | 300 | 130 | 40 | 70 | 540 | 540 |
| 6 | D's right | −100 | capped at the 40 of give-back available; the floor stops the rest | 300 | 130 | 40 | 30 | 500 | 0 |

Rows 1–2 are the case today's code cannot express at all: at row 1 the old handler caps A at 250 the moment B reaches its 100 minimum and discards the remaining 150 px of travel. Rows 5–6 are the last column's right edge, which today does nothing — with no right chain it becomes a pure table-width handle.

---

## Ordered Implementation Steps

1. **Check the dependency landed.** `grep -n "MIN_COLUMN_WIDTH_PX\|maybeResampleColumnWidths" packages/lib/src/typescript/lib/component/table/Table.ts` — both must be present. They come from `plans/implemented/table-generated-column-widths.md`. If either is missing, stop and report that the dependency has not been implemented.

2. **Create `packages/lib/src/typescript/lib/core/DragChain.ts`** with the two functions and the constant from `## Internal Structure`. Give the module a file-level JSDoc in the style of [core/ScrollShadow.ts](packages/lib/src/typescript/lib/core/ScrollShadow.ts) — a shared recipe used by two owners — and carry `Accordion.distributeDragChain`'s existing doc comment across onto the exported function, generalised from "section" to "entry". Do **not** add it to any barrel. *Check:* `npm run typecheck` passes.

3. **Write `packages/lib/tests/core/DragChain.test.ts`** covering behaviour cases 14a–14c. They pass immediately (step 2 supplies the code).

4. **`packages/lib/src/typescript/lib/layout/Accordion.ts`** — delete the module-level `DRAG_DISTRIBUTION_EPSILON` (line 68, used only inside the method being removed) and the private `distributeDragChain` method (line 1949); import `chainRoom` and `distributeDragChain` from `~/core/DragChain.js`. In `onGutterDrag`, replace the two `growRoom` / `shrinkRoom` accumulation loops (lines 1870–1882) with `const growRoom = chainRoom(growGroup, current, 1, mins, maxs);` and `const shrinkRoom = chainRoom(shrinkGroup, current, -1, mins, maxs);`, and change the two `this.distributeDragChain(...)` calls to bare `distributeDragChain(...)`. Nothing else in the file changes. *Check:* `npx vitest run packages/lib/tests/component/layout/Accordion.resizable.test.ts` — all pass unchanged.

5. **Write `packages/lib/tests/component/table/ColumnResize.test.ts`** with behaviour cases 1–13. They fail at this point. Drive the drag through the private-method cast pattern from [packages/lib/tests/component/layout/Accordion.resizable.test.ts:186](packages/lib/tests/component/layout/Accordion.resizable.test.ts#L186), and set up widths per the fixture recipe at the top of `## Expected Behaviour`.

6. **`packages/lib/src/typescript/lib/component/table/Table.ts` — state.** Add `import { DOM } from "~/core/DOM.js";` and `import { chainRoom, distributeDragChain, DRAG_DISTRIBUTION_EPSILON } from "~/core/DragChain.js";`. Add a module-level `const WIDTH_TARGET_EPSILON_PX = 0.5;` with a comment stating it is the sub-pixel tolerance below which a total is treated as equal to the available width — the same 0.5 the file's existing width comparisons use ([Table.ts:485](packages/lib/src/typescript/lib/component/table/Table.ts#L485)). Delete the `_resizeOriginClientX` / `_resizeOriginW0` / `_resizeOriginW1` fields (lines 114–116) and add `_dragEdgeIndex`, `_dragLastClientX`, `_columnWidthTarget` per `## Public API`. *Check:* `grep -n "_resizeOrigin" packages/lib/src/typescript/lib/component/table/Table.ts` — expect zero matches once step 7 lands.

7. **`Table.ts` — the two drag handlers.** Replace the bodies of `onColumnResizeStart` ([line 1208](packages/lib/src/typescript/lib/component/table/Table.ts#L1208)) and `onColumnResize` ([line 1235](packages/lib/src/typescript/lib/component/table/Table.ts#L1235)) with the versions in `## Internal Structure`, and rewrite both JSDoc blocks to describe the chained model, the growth rule, and the dead zone.

8. **`Table.ts` — the two seam accessors.** Add `getAvailableColumnWidth()` (body in `## Internal Structure`) and `getColumnWidthTarget()` (returns `this._columnWidthTarget`) next to the existing `getColumnWidths` / `setColumnWidths` pair at [line 412](packages/lib/src/typescript/lib/component/table/Table.ts#L412), documented as part of the same layout-manager seam.

9. **`Table.ts` — target lifecycle.** Set `this._columnWidthTarget = 0` in `setStore` ([line 391](packages/lib/src/typescript/lib/component/table/Table.ts#L391)), in `bindView` ([line 1054](packages/lib/src/typescript/lib/component/table/Table.ts#L1054)), in `resetColumns` ([line 1282](packages/lib/src/typescript/lib/component/table/Table.ts#L1282)), and in `maybeResampleColumnWidths` — each beside the existing `_columnWidths` / `_savedColumnWidths` clears. In `setColumnVisible`, immediately after `this._columnWidths` is assigned ([line 485](packages/lib/src/typescript/lib/component/table/Table.ts#L485)), add:

    ```typescript
    // Keep a grown table's target in step with the new column set: showing a
    // column trims the others back to the same total, hiding one frees its width.
    if (this._columnWidthTarget > 0) {
        this._columnWidthTarget = this._columnWidths.reduce((s, w) => s + w, 0);
    }
    ```

    *Check:* `grep -n "_columnWidthTarget" packages/lib/src/typescript/lib/component/table/Table.ts` — expect exactly nine sites (declaration, getter, the write in `onColumnResize`, four clears, and the two lines of the `setColumnVisible` guard).

10. **`packages/lib/src/typescript/lib/layout/Table.ts` — `doLayout`.** Replace line 104 with `const availableWidth = container.getAvailableColumnWidth();`, and add `const targetWidth = Math.max(availableWidth, container.getColumnWidthTarget());` beneath it. Change the `rescaleWidths` call (line 112) to pass `targetWidth`. Leave the `initializeWidths` call, `body.renderWindow(availableWidth, columnWidths)`, and the header's `innerRowW` arithmetic on `availableWidth` / `containerSize.width` untouched. Update the method's `@remarks` to say a drag-widened total is preserved. *Check:* `grep -n "getScrollBarWidth" packages/lib/src/typescript/lib/layout/Table.ts` — expect one match (the header's scrollbar cover at line 239), not two.

11. **Run the tests** — every case from steps 3 and 5 passes, and `Table.test.ts`, `RotatedView.test.ts`, `Body.test.ts`, `Column.test.ts`, `ColumnWidths.test.ts`, `Accordion.resizable.test.ts` still pass.

12. **Documentation** — apply `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/DragChain.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Create | `packages/lib/tests/core/DragChain.test.ts` |
| Create | `packages/lib/tests/component/table/ColumnResize.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |

---

## Expected Behaviour

**Fixture recipe for cases 1–13.** The offline harness reserves a 15 px scrollbar track (`scrollBarWidth: 15` in the `installTestDOM` config every table test uses), so a table at `setWidth(515)` has an available width of 500 — the worked example's number. Build the table over a four-`string`-column model with the `minWidth` values from the worked example, `setWidth(515)` / `setHeight(400)` / `doLayout()`, then plant the starting widths with the public `table.setColumnWidths([200, 150, 100, 50])`. Drive the drag through

```typescript
const priv = table as unknown as {
    onColumnResizeStart(colIndex: number, clientX: number): void;
    onColumnResize(colIndex: number, clientX: number): void;
};
```

Pointer coordinates are absolute: `onColumnResizeStart(0, 1000)` then `onColumnResize(0, 1200)` is a +200 frame. Assert on `table.getColumnWidths()`.

**Unit-testable — chained distribution**

1. *The chain spills past the first neighbour.* Drag A's right edge +80. B falls to its `minWidth` 100 and C gives the remaining 30: `[280, 100, 70, 50]`, total still 500.
2. *No stall at the first neighbour's minimum.* Drag A's right edge +60, where B's room is only 50: `[260, 100, 90, 50]`. A grows the full 60 and C gives the last 10, where today's handler caps A at 250 and never touches C.
3. *Two frames chain the same way as one.* Drag +40 then +40 from the same start produces the same array as a single +80 (case 1).

**Unit-testable — table growth**

4. *Growth past an exhausted chain.* Worked-example row 1: +200 gives `[400, 100, 40, 30]`, total 570, `getColumnWidthTarget()` 570.
5. *Growth with no chain left at all.* Row 2 applied after row 1: `[450, 100, 40, 30]`, total 620, target 620.
6. *Give-back comes first on reversal.* Row 3: −30 leaves B, C, D untouched and takes 30 off A; total 590, target 590.
7. *Give-back then chain growth.* Row 4: −120 yields `[300, 130, 40, 30]`, total 500, target 0.
8. *The total never falls below the available width.* From row 4's state, drag A's right edge −200: A shrinks and B grows to keep the total at exactly 500.
9. *The last column's right edge grows and shrinks the table.* Rows 5 and 6: `onColumnResizeStart(3, …)` then +40 gives total 540 / target 540; a following −100 gives total 500 / target 0 with D back at its 30 minimum.

**Unit-testable — dead zone**

10. *Blocked travel must be retraced.* Give A `maxWidth: 250`. From the start state, `onColumnResizeStart(0, 1000)` then `onColumnResize(0, 1200)`: A stops at 250, B absorbs 50, total stays 500. `onColumnResize(0, 1100)` changes nothing (still inside the dead zone). `onColumnResize(0, 1000)` shrinks A by 50 back to 200.

**Unit-testable — the widened total survives**

11. *A second layout does not undo the growth.* After case 4, call `table.doLayout()` again: `getColumnWidths()` is unchanged and still sums to 570.
12. *Resizing the container.* After case 4, `setWidth(815)` + `doLayout()` rescales the columns to an 800 total (the 570 target no longer binds); `setWidth(515)` + `doLayout()` returns the total to 570, the width the user dragged it to.
13. *Re-initialisation clears the target.* After case 4, `table.setStore(otherStore)` leaves `getColumnWidthTarget()` at 0.

**Unit-testable — `core/DragChain.ts`**

14. a. *Room sums per direction.* `chainRoom([0,1], [50,50], 1, [0,0], [80,60])` is 40; the same group with `sign` −1 and `mins` `[30,45]` is 25. b. *An entry already outside its bounds contributes 0, never a negative.* `chainRoom([0], [10], -1, [30], [Number.POSITIVE_INFINITY])` is 0. c. *`distributeDragChain` fills nearest-first and stops when `delta` runs out.* Group `[0,1,2]`, current `[50,50,50]`, delta 30, sign −1, mins `[40,30,40]`, `out` seeded to `[50,50,50]` ends as `[40,30,50]` — the first entry gives its 10, the second gives the remaining 20, the third is untouched.

**Manual verification** (`npm run dev`, app on `localhost:8015`, Misc panel → *Show window with wide table (45 columns)!*)

15. Dragging a column edge right past several neighbours keeps the handle under the cursor throughout; each neighbour collapses to its minimum in turn rather than the drag freezing at the first one.
16. Dragging further once every column to the right is at its minimum widens the table: a horizontal scrollbar appears in the body and the header band scrolls in step with it.
17. Reversing the drag narrows the table back before any column to the right regrows, and the table stops narrowing once it fits the window again.
18. After over-dragging past the limit, reversing moves the handle only after the cursor has come back to where the handle actually is — the handle never jumps to meet a far-off cursor.
19. The last column's right-edge handle widens and narrows the table without touching any other column.
20. `AccordionPanel` gutter drags behave exactly as before (Misc panel's accordion demo).

**Unit-testable — no scavenging while the table overflows** (added with the amendment in `## Architecture Decisions`; numbered after the original 1–20 rather than renumbering them). The fixture reaches an overflowing state with the right chain *still un-exhausted* by dragging the **last** column's handle +100, giving `[200, 150, 100, 150]` — total 600 against the available 500, with B/C/D all still above their minimums.

21. *Growing an edge widens the table instead of scavenging.* Drag A's right edge +50: `[250, 150, 100, 150]`, total and target 650 — B keeps its 150 even though it has 50 px of shrink room to give.
22. *Shrinking an edge narrows the table instead of feeding the right chain.* Drag A's right edge −50: `[150, 150, 100, 150]`, total and target 550.
23. *Scavenging resumes once the table fits again.* From case 21's state, drag −200: 150 of it gives the growth back (total down to the available 500), the remaining 40 of A's shrink room is scavenged by B, and the last 10 is dead zone — `[60, 190, 100, 150]`, total 500, target 0.

**Manual verification — the amendment**

24. With the wide table scrolled horizontally, dragging any column edge moves only that column and the table's width; every column to its right keeps the width it had.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean (the new module holds no DOM access; `getAvailableColumnWidth` reads through `DOM.source`).
- `npm run test` — the two new suites plus `Accordion.resizable.test.ts`, `Table.test.ts`, `RotatedView.test.ts`, `Body.test.ts`, `ColumnWidths.test.ts`.
- `grep -rn "_resizeOrigin" packages/lib/src` — expect zero matches.
- `grep -n "distributeDragChain" packages/lib/src/typescript/lib/layout/Accordion.ts` — expect only import and call sites, no method declaration.
- `npm run docs:api` — finishes with zero warnings (`CODE_CONVENTIONS.md` requires this after any public-JSDoc change).
- Manual cases 15–20 above.

---

## Documentation Impact

- **`packages/lib/docs/components/Table.md`** — the one-line bullet *"Drag a column header's right edge to resize."* under **Sorting and selection** ([line 172](packages/lib/docs/components/Table.md#L172)) becomes a short **Resizing columns** subsection covering: the nearest-first chain, that a column pinned at its `minWidth` passes the travel to the next one out, that the table widens and scrolls horizontally once nothing is left to take, that a leftward drag narrows the table back before regrowing anything, and that the last column's handle changes the table's width only. If the section carries a numeric example, reuse the worked example's numbers rather than inventing a second set.
- **JSDoc** — `Table.getAvailableColumnWidth` and `Table.getColumnWidthTarget` (both public, both rendered by TypeDoc); rewritten blocks on `onColumnResizeStart` / `onColumnResize`; the file-level and per-function comments in `core/DragChain.ts`.
- **`core/DragChain.ts` is internal** — it is added to no barrel, mirroring `core/ScrollShadow.ts`, so it does not enter the generated API docs. Public JSDoc must therefore not `{@link}` `chainRoom` or `distributeDragChain`; describe the behaviour in prose instead (`CODE_CONVENTIONS.md`, *Don't `{@link}` internal symbols from public JSDoc*).
- **No barrel change and no `packages/lib/llms.txt` change** — `Table` is already exported and already listed; no new component or option is introduced.

---

## Potential Challenges

- **`trimToTarget` cannot always reach its target after a chained drag.** A chained drag leaves many columns sitting exactly on their `minWidth`, so the trim pools in [`trimToTarget`](packages/lib/src/typescript/lib/component/table/Table.ts#L752) have little or no room and showing a hidden column can push the total above the previous one. Mitigation: accepted and consistent — the table simply grows, which is what this plan makes it do everywhere else. The `setColumnVisible` guard in step 9 records the new total so the layout preserves it.
- **`_savedColumnWidths` remembers the minima.** `setColumnWidths` mirrors every drag result into `_savedColumnWidths`, so a column the chain collapsed to its minimum comes back at that minimum after a hide/show. Mitigation: unchanged pre-existing behaviour; `resetColumns` (header context menu → reset) is the escape hatch.
- **A stale target resurrects old growth after a widen-then-narrow.** Case 12 pins this deliberately: widening the window past the target and narrowing it back restores the dragged total. Mitigation: it is the desirable reading (the user's width is remembered), and any later drag rewrites or clears the target.
- **Rotated mode is not special-cased.** A drag in `"rotated"` mode runs the same chain over the three projection columns, all of which declare a `maxWidth` except the filler. Mitigation: none needed — the arithmetic is bound-respecting, and `RotatedView.test.ts` already pins the projection's widths.
- **The plan assumes two symbols from the dependency plan.** `MIN_COLUMN_WIDTH_PX` and `maybeResampleColumnWidths` are added by `table-generated-column-widths`. Mitigation: step 1 checks for both and stops if they are absent.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/layout/Accordion.ts` | `onGutterDrag` (line 1821) and `distributeDragChain` (line 1949) — the precedent this plan mirrors and the source of the extracted module. Read both doc comments in full. |
| `packages/lib/src/typescript/lib/component/table/Table.ts` | Owns `_columnWidths`, `_savedColumnWidths`, `trimToTarget`, `setColumnVisible`, `resetColumns`, and the two drag handlers being replaced. |
| `packages/lib/src/typescript/lib/layout/Table.ts` | `doLayout` → `initializeWidths` / `rescaleWidths` / `absorbSlackIntoGreedy` — `rescaleWidths` is what would otherwise undo a widened total. |
| `packages/lib/src/typescript/lib/component/table/Body.ts` | `renderWindow` (line 661) — the horizontal scroll extent is already `max(bodyWidth, sum(columnWidths))`, which is why a grown total needs no scroll-model change. |
| `packages/lib/src/typescript/lib/component/table/cell/Header.ts` | `onResizeDragStart` / `onResizeDrag` (lines 467–487) — confirms `resizestart` always precedes `resizedrag`, so no drag-end signal is needed. |
| `packages/lib/src/typescript/lib/core/ScrollShadow.ts` | The shared-internal-recipe module shape `core/DragChain.ts` copies (no barrel export, `@category Core` file doc). |
| `packages/lib/tests/component/layout/Accordion.resizable.test.ts` | The private-drag-method test pattern (line 186) the new table tests reuse. |
| `packages/lib/tests/component/table/RotatedView.test.ts` | The `setWidth` / `setHeight` / `doLayout` / `getColumnWidths` assertion pattern (line 340). |

---

## Non-Goals

- **Growing the `Accordion` container.** `Accordion` gains the shared chain functions and nothing else. Its container growth interacts with `_resizeFactor` rescaling and its scroll host, which is a separate design problem.
- **Replacing `doLayout()` with `scheduleLayout()` in the drag path.** The per-move relayout cost belongs to the wide-table performance work.
- **Auto-scrolling the body when a drag reaches the viewport edge.** The pointer's reach bounds one gesture; the user releases, scrolls, and drags again.
- **A table-level maximum-width option.** Growth is bounded by the columns' own `maxWidth` values; no ceiling constant and no `TableOptions` field is added for it.
- **Column reordering or pinning.** `plans/table-column-pinning.md` is out of scope for this release.
- **Changing how widths are first derived.** `initializeWidths`, `getIntrinsicColumnWidths`, and `absorbSlackIntoGreedy` keep the behaviour `table-generated-column-widths` gives them.

---

## Notes

[^mirror]: `Accordion` is the only place in the codebase that already solves "a dragged boundary redistributes space across a run of bounded siblings". `Split` and `Border` gutters move a single boundary between exactly two components and have no chain. Its `onGutterDrag` doc comment states the semantics this plan reuses word for word: "**Both sides chain outward** from the gutter: the nearest section absorbs the travel first, spilling to the next once it reaches its max (on the growing side) or its min (on the shrinking side)." Mapping section→column and height→width is the whole translation; the one deliberate divergence is that `Accordion` conserves the open set's combined height while this drag may change the total, which is the feature being added.

[^incremental]: The absolute-origin form cannot express a chain. It reconstructs both widths from a snapshot taken at drag start, which works only while exactly two columns move; once the travel can land on any of `n` columns depending on which bounds have been hit along the way, the result depends on the path, not on the endpoints. `Accordion` uses per-frame deltas for exactly this reason, and its comment spells out the consequence: the chain "is purely a function of the live heights — the drag keeps no memory of where each section started, so reversing the pointer simply moves the boundary the other way and the closest section grows/shrinks first in that new direction too". A drag is therefore not exactly reversible in either model, which is why `## Expected Behaviour` pins endpoint states rather than round trips.

[^deadzone]: The absolute-origin model got this property for free: over-travel past a clamp changed nothing because the clamped result was recomputed from the origin each move. With per-frame deltas the same property has to be built, and `Accordion.onGutterDrag` shows how — `this._dragLastPointer += Math.sign(frameDelta) * delta;` with `delta` being the applied travel. Without it the tracked pointer would run away with the cursor and the first reversing frame would snap the edge across the whole accumulated gap. Behaviour case 10 is the regression test.

[^ratchet]: The alternative — always let the right chain act first in both directions — was rejected because it makes the table a one-way ratchet. Columns almost never declare a `maxWidth`, so the right chain can nearly always absorb a leftward drag, meaning growth could be created but never undone at the handle that created it. Giving the accrued growth back first makes the same handle undo its own work, and the floor at the available width keeps the table from ever being narrower than its container, which would leave dead space that `absorbSlackIntoGreedy` would immediately fight over.

[^ceiling]: The three candidates named in the request all fail on inspection. (1) `Component.getMaxSize()` is a bound on the `Table`'s own box, which its parent's layout manager assigns and reassigns on every pass — the table cannot widen its own box, and with no explicit `setMaxSize` the merged value is `UNBOUNDED` anyway, so it would express nothing. (2) The layout's available width is the threshold at which growth *starts*; using it as the ceiling would mean no growth at all, which is the bug being fixed. (3) The horizontal scroll extent is an output rather than an input: `Body.renderWindow` computes it as `Math.max(this._lastBodyWidth, totalColumnWidth)` ([Body.ts:686](packages/lib/src/typescript/lib/component/table/Body.ts#L686)), so it follows the column sum instead of bounding it. That leaves the bound the framework already owns — `Column.getMaxWidth()`, declared per column in the spec — which the chain arithmetic enforces without a line of extra code. Inventing a table-level ceiling constant would add a second, competing notion of "how wide may this get" with no call site asking for one.

[^target]: `rescaleWidths` scales the flexible columns so the total lands on the width it is handed, and it runs on every layout pass. Handed `availableWidth`, it computes `ratio = (availableWidth − fixedTotal) / prevFlexTotal < 1` for a widened table and shrinks the widened column straight back — including the columns *left* of the dragged edge, which the drag never touched. Handing it the drag's total instead makes `prevFlexTotal` and `newFlexTotal` agree, so the early return at [layout/Table.ts:364](packages/lib/src/typescript/lib/layout/Table.ts#L364) fires and the array passes through untouched. Two alternatives were rejected: marking the table "user-resized" and skipping `rescaleWidths` entirely (kills the container-resize rescale that flexible columns depend on, forever after the first drag), and storing the target as the raw width array (goes stale the moment a column is shown or hidden, where a single number stays meaningful).

[^extract]: The project's conventions bar abstractions built for a single call site, but they carry an explicit carve-out for "extracting to a utility class [that] clearly improves readability by separating reusable mechanics from call-site-specific writes" — and here there are two real call sites the day the plan lands, not a speculative second one. The functions are pure arithmetic over number arrays with no `Accordion` or `Table` state, and the valuable part is the doc comment describing semantics that are easy to get subtly wrong (nearest-first, live values, no memory of the drag's start). Duplicating that comment into `Table.ts` would create two copies to keep in step. The extraction also happens to be the seam that lets `Accordion` adopt the growth behaviour later without a rewrite, but it would be worth doing on the two-call-sites count alone. `core/` is the right home: `core/ScrollShadow.ts` is the same shape — a shared recipe imported by `Panel` and `VirtualScroller`, exported from no barrel.

[^schedule]: The 3000-header-layouts figure comes from `doLayout()` relaying out every header cell unconditionally on each pointer move; `scheduleLayout()` would coalesce those to one per animation frame, but `mousemove` already fires at most once per frame in practice, so the measured win is close to zero — the cost is per-cell work inside the header layout, and that is what the wide-table performance work addresses. Deferring also has a correctness cost here: `doLayout` calls back into `setColumnWidths`, so the next drag frame would read a width array the layout had not yet reconciled. The one cheap win this plan does take is the early return when the applied travel is zero, which skips the relayout entirely for every frame spent inside the dead zone.

---

## Implementation Notes

- **The `## Expected Behaviour` fixture recipe's `setWidth(515)` does not yield an available width of 500** in `packages/lib/tests/component/table/ColumnResize.test.ts`. `Table`'s constructor sets a real `1px solid` border on all four sides (`this.setBorder({ border: "1px solid var(--ts-ui-border-color, black)" })`), and `getInnerSize()` subtracts border width alongside insets — the plan's fixture note only accounts for the 15px scrollbar track. Measured directly: `setWidth(515)` → `getAvailableColumnWidth()` returns 498, not 500. The test file uses `setWidth(517)` (and `setWidth(817)`/`setWidth(517)` for case 12's container-resize round trip) to land on the exact available widths the worked example's numbers depend on, with a comment at the top of the file explaining the 2px adjustment. No production code is affected — `getAvailableColumnWidth()` and `getColumnWidthTarget()` are implemented exactly as specified; this is purely a test-fixture arithmetic correction.
