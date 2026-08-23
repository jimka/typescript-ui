---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/src/typescript/lib/component/table/Row.ts
  - packages/lib/src/typescript/lib/component/table/Header.ts
---

# Column Window Edge Stability — Implementation Plan

## Overview

Horizontal scrolling on a wide table is far more expensive than vertical scrolling, and the gap is worst near the left and right ends of the columns. The cause is the *width* of the rendered column window. [`computeColumnWindow`](packages/lib/src/typescript/lib/component/table/Body.ts#L140) takes the run of columns the viewport actually intersects — the *raw-visible* run — pads it by [`COLUMN_BUFFER`](packages/lib/src/typescript/lib/component/table/Body.ts#L103) on each side, and then clamps the result to `[0, n-1]` ([Body.ts:184-185](packages/lib/src/typescript/lib/component/table/Body.ts#L184-L185)), so the window is narrower near an edge than it is mid-scroll — and narrower by a *different* amount at each step through the clamped zone. [`computeColumnWindowSlidePlan`](packages/lib/src/typescript/lib/component/table/Body.ts#L1123) refuses to produce a plan unless the previous and new windows have exactly the same width ([Body.ts:1131](packages/lib/src/typescript/lib/component/table/Body.ts#L1131)), so every width-changing tick sends **every pooled row** through the full reconcile in [`Row.setColumnWindow`](packages/lib/src/typescript/lib/component/table/Row.ts#L435) instead of the cheap slide in [`Row.reconcileWindowSlide`](packages/lib/src/typescript/lib/component/table/Row.ts#L652).[^measured]

Vertical scrolling never hits this wall because [`VirtualRowView.computePoolTarget`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L296) already decouples the *rendered* row count from the current window: it grows the pool once to a fixed maximum derived from the viewport, and edge clamping then only changes how many of those already-built rows are shown. This plan gives the column window the same treatment. `computeColumnWindow` gains a fixed window width, computed from the column widths and the viewport width alone, and places that fixed-width window by sliding it against the ends of the column list rather than shrinking it. The slide plan and `Row.setColumnWindow` need no change at all — once consecutive windows are always the same width, the existing fast path becomes available at the edges (and on the mid-scroll ticks where the raw-visible count jitters by one) for free.

A second, independent change goes in alongside it. `Row.setColumnWindow`'s full-reconcile pass 3 writes `cell.getAria().setColIndex(col + 1)` for every rendered cell on every tick ([Row.ts:582](packages/lib/src/typescript/lib/component/table/Row.ts#L582)), and nothing on that path deduplicates a repeated value — not [`Aria.setColIndex`](packages/lib/src/typescript/lib/core/Aria.ts#L449), not [`Component.setElementAttribute`](packages/lib/src/typescript/lib/core/Component.ts#L1549), not [`ElementAttributes.set`](packages/lib/src/typescript/lib/core/ElementAttributes.ts#L30) — so each one is a real DOM `setAttribute` even when the cell's column did not change. [`TableHeader.reconcileColumnCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L713) has the same unguarded write at [Header.ts:807](packages/lib/src/typescript/lib/component/table/Header.ts#L807). Both are scoped to the cells that actually changed column.

Only three source files change — `Body.ts`, `Row.ts`, and `Header.ts` — plus their tests and the changelog. No public API is added or altered.

---

## Architecture Decisions

### The rendered column window gets a fixed width, sized from the viewport

`computeColumnWindow` computes the window's width once per call from the column widths and the viewport width, independent of the current scroll offset. This mirrors `VirtualRowView.computePoolTarget` ([VirtualRowView.ts:296-304](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L296-L304)), which sizes the row pool from `visibleHeight / rowHeight` plus the buffers rather than from the current window, precisely so edge clamping cannot shrink it.[^why-fixed-width]

The width is `min(n, maxRawVisible + 2 × COLUMN_BUFFER)`, where `maxRawVisible` is the largest number of columns any scroll offset can make raw-visible. Rows get that count by dividing by a uniform row height; columns have varying widths, so it is derived with one sliding-window pass over the `lefts` array.[^max-raw-derivation] No extra slack term is needed on top — unlike `computePoolTarget`'s trailing `+ 2`, this count already includes the partially-shown column at each end.

### Near an edge the window slides instead of shrinking

The window is placed by clamping its *start*, not its two ends: `firstCol = min(max(firstRawVisible - COLUMN_BUFFER, 0), n - slotCount)`, and `lastCol = firstCol + slotCount - 1`. At the left edge the window pins at `[0, slotCount-1]` and extends further right than the buffer alone would; at the right edge it pins at `[n-slotCount, n-1]` and extends further left. Every slot therefore still maps to a real column, so the per-cell geometry in [`bindAndPositionRows`](packages/lib/src/typescript/lib/component/table/Body.ts#L1324) — which starts each row's cells at `columns.lefts[columns.firstCol]` and walks `columns.widths` ([Body.ts:1396-1404](packages/lib/src/typescript/lib/component/table/Body.ts#L1396-L1404)) — stays correct with no change.[^why-slide-not-hide]

Worked against 20 columns of 100px in a 250px viewport (`maxRawVisible` = 4, so `slotCount` = `min(20, 4 + 4)` = 8, and `n - slotCount` = 12):

| `scrollX` | `firstRawVisible` | window today | window after | width today → after |
|---|---|---|---|---|
| `0` (left edge) | 0 | `[0, 4]` | `[0, 7]` | 5 → 8 |
| `550` (mid-scroll) | 5 | `[3, 10]` | `[3, 10]` | 8 → 8 |
| `650` (mid-scroll) | 6 | `[4, 11]` | `[4, 11]` | 8 → 8 |
| `1750` (right edge) | 17 | `[15, 19]` | `[12, 19]` | 5 → 8 |

Mid-scroll windows are unchanged; only the clamped zones widen, and the width is now the same at every offset.

### `computeColumnWindowSlidePlan` and `Row.setColumnWindow` are unchanged

Neither the slide plan nor either of `Row`'s two reconcile paths is touched. The fixed width makes `prevWidth === nextWidth` hold across every scroll tick, which is the single condition that was denying the fast path near the edges; every other eligibility rule (`delta !== 0`, `|delta| < width`, `!_columnsDirty`, the row's own previous window matching the plan) keeps its current meaning.[^no-row-change] Where the window is pinned against an edge, consecutive ticks produce an *identical* window, so `setColumnWindow` takes its existing no-change early return ([Row.ts:475-477](packages/lib/src/typescript/lib/component/table/Row.ts#L475-L477)) and does no work at all.

### The ARIA column-index write is scoped to retargeted cells

In `Row.setColumnWindow`'s pass 3 and `TableHeader.reconcileColumnCells`'s pass 3, `getAria().setColIndex(col + 1)` moves inside the existing "this cell changed column" condition, mirroring how [`Body.bindAndPositionRows`](packages/lib/src/typescript/lib/component/table/Body.ts#L1324) already gates its own row-level ARIA write behind `if (wasRebound)` ([Body.ts:1366-1375](packages/lib/src/typescript/lib/component/table/Body.ts#L1366-L1375), calling [`computeRowAria`](packages/lib/src/typescript/lib/component/table/Body.ts#L526)).

This is safe because a cell that survives pass 1 was matched by **field name**, and a field's visible-column index is fixed by `_visibleFields` — which cannot change without setting `_columnsDirty` ([Row.setColumnFields:370](packages/lib/src/typescript/lib/component/table/Row.ts#L370), [TableHeader.rebuildCells:667](packages/lib/src/typescript/lib/component/table/Header.ts#L667)). So a survivor's correct `aria-colindex` is the one it already carries.[^survivor-colindex]

Worked against a row whose window moves from `[0, 5]` to `[3, 8]` with no field-set change:

| Column | Field | Cell comes from | `setColIndex` called? |
|---|---|---|---|
| 3 | `f3` | pass 1 — kept its own cell | no — already `4` |
| 4 | `f4` | pass 1 — kept its own cell | no — already `5` |
| 5 | `f5` | pass 1 — kept its own cell | no — already `6` |
| 6 | `f6` | pass 2 — recycled from `f0` | yes — `7` |
| 7 | `f7` | pass 2 — recycled from `f1` | yes — `8` |
| 8 | `f8` | pass 2 — recycled from `f2` | yes — `9` |

`Row.reconcileWindowSlide` already writes `setColIndex` only for entering cells ([Row.ts:713](packages/lib/src/typescript/lib/component/table/Row.ts#L713)) and needs no change.

---

## Public API

No public API changes. `computeColumnWindow` and `computeColumnWindowSize` are `@internal`, exported from `Body.ts` for `Header.ts` and the offline tests only — neither is re-exported from `component/table/index.ts`, and neither may be added to it.

---

## Internal Structure

### `computeColumnWindowSize` — the fixed width

New module-level function in `Body.ts`, placed directly above `computeColumnWindow` so the two read in order:

```typescript
export function computeColumnWindowSize(lefts: number[], viewportWidth: number): number {
    const n = lefts.length;

    if (n === 0) {
        return 0;
    }

    // Widest run of columns whose left edges all fall within one viewport
    // width of each other. The raw-visible run at any scroll offset is one
    // such run plus at most one extra column on its left, so `widest + 1`
    // bounds every offset's raw-visible count.
    let widest = 1;
    let start  = 0;

    for (let end = 0; end < n; end++) {
        while (start < end && lefts[end] - lefts[start] > viewportWidth) {
            start++;
        }

        if (end - start + 1 > widest) {
            widest = end - start + 1;
        }
    }

    return Math.min(n, widest + 1 + 2 * COLUMN_BUFFER);
}
```

### `computeColumnWindow` — the rewritten tail

Everything above the raw-visible scan is unchanged: the `lefts` accumulation loop and the `n === 0` early return stay exactly as they are ([Body.ts:145-156](packages/lib/src/typescript/lib/component/table/Body.ts#L145-L156)). The scan itself now stops at the first raw-visible column, and the window is derived from `slotCount`:

```typescript
    const viewportRight = scrollX + viewportWidth;

    let firstRawVisible = -1;

    for (let i = 0; i < n; i++) {
        if (lefts[i] + widths[i] >= scrollX && lefts[i] <= viewportRight) {
            firstRawVisible = i;
            break;
        }
    }

    if (firstRawVisible === -1) {
        // No column's span touches the viewport at all (e.g. scrolled past
        // the content); anchor the window at the left edge so a window is
        // still returned.
        firstRawVisible = 0;
    }

    const slotCount = computeColumnWindowSize(lefts, viewportWidth);
    const firstCol  = Math.min(Math.max(firstRawVisible - COLUMN_BUFFER, 0), n - slotCount);
    const lastCol   = firstCol + slotCount - 1;

    return { firstCol, lastCol, widths, lefts };
```

`lastRawVisible` disappears with this rewrite; `packages/lib/tsconfig.json` sets `noUnusedLocals`, so leaving it behind is a typecheck failure rather than dead code.

---

## Ordered Implementation Steps

Tests come first for each behavioural change, per the `implement` skill's test-first flow. The pure-function work in steps 1-3 is self-contained; run it green before touching the reconcilers.

1. **Add the failing pure-function tests.** In `packages/lib/tests/component/table/ColumnWindow.test.ts`, add a `describe('computeColumnWindowSize')` block and a `describe('computeColumnWindow — edge stability')` block covering the cases in `## Expected Behaviour` §A and §B. Import `computeColumnWindowSize` alongside the existing `computeColumnWindow` import. Expect them to fail.

2. **Add `computeColumnWindowSize` to `Body.ts`,** exactly as given in `## Internal Structure`, immediately above `computeColumnWindow`. Give it a JSDoc block in the file's existing style, marked `@internal`, that names `VirtualRowView.computePoolTarget` as the row-side twin in prose (do **not** `{@link}` it — see the `{@link}` rule in `CODE_CONVENTIONS.md`).

3. **Rewrite `computeColumnWindow`'s tail** per `## Internal Structure`: replace the two-variable raw-visible scan with the first-match-and-break scan, drop `lastRawVisible`, and derive `firstCol`/`lastCol` from `slotCount`. Update the function's JSDoc: the raw-visible run is now widened to a fixed width and the window slides against the ends of the column list rather than being clamped at both ends. → verify: `npm run typecheck` clean, and the new `ColumnWindow.test.ts` blocks pass.

4. **Re-derive the existing literal window expectations.** These encode the old shrinking window and must be recomputed from the table in `## Architecture Decisions`; each is listed with what changes and why in `## Expected Behaviour` §E:
   - `ColumnWindow.test.ts` — the left-edge and right-edge cases.
   - `Body.test.ts:1274` — rendered cell count at `wideBody(20, 300, 0)`.
   - `Body.test.ts:1666` — the scroll offset that produces a slide.
   - `Body.test.ts:1933` (case 14) — `getColumnWindowStart()` after the far jump.
   - `TreeBody.test.ts:230-234` — the stale windowing comment.
   - `RowCellCache.test.ts:245` (case 11) — the fixture no longer displaces any cell.
   → verify: `npm test` — the whole `tests/component/table/` suite green.

5. **Add the failing `Row` ARIA-scoping test** to `packages/lib/tests/component/table/ColumnWindowSlide.test.ts`, per `## Expected Behaviour` §C.

6. **Scope `Row.setColumnWindow`'s ARIA write.** In pass 3 ([Row.ts:578-592](packages/lib/src/typescript/lib/component/table/Row.ts#L578-L592)), move `cell.getAria().setColIndex(col + 1);` from the top of the loop body into the existing `if (retargeted.has(col) || columnsDirtyAtEntry)` block, above the `_lastRetargeted.push`. Leave `setBaseBackground` where it is. Extend the pass-3 comment to record why a survivor's index cannot be stale (the `_visibleFields`/`_columnsDirty` argument from `## Architecture Decisions`). → verify: `npm test`.

7. **Add the failing `TableHeader` ARIA-scoping test** to `packages/lib/tests/component/table/HeaderColumnWindow.test.ts`, per `## Expected Behaviour` §D.

8. **Scope `TableHeader.reconcileColumnCells`'s ARIA write.** Declare `const retargeted = new Set<number>();` next to `assigned` ([Header.ts:735-736](packages/lib/src/typescript/lib/component/table/Header.ts#L735-L736)); add `retargeted.add(col);` beside the existing `assigned[slot] = cell;` at the end of pass 2 ([Header.ts:780](packages/lib/src/typescript/lib/component/table/Header.ts#L780)); in pass 3 wrap only the `cell.getAria().setColIndex(col + 1);` line in `if (retargeted.has(col) || this._columnsDirty)`. Read `this._columnsDirty` directly — `reconcileColumnCells` does not clear it until [Header.ts:833](packages/lib/src/typescript/lib/component/table/Header.ts#L833), after pass 3. Adjust the method's doc comment, which currently promises that *every* per-column property including the ARIA index is re-applied to every rendered cell. → verify: `npm test`.

9. **Confirm the old two-ended clamp is gone.** `grep -rn 'lastRawVisible' packages/lib/src/ packages/lib/tests/` — expect zero matches.

10. **Add the changelog entry** to `packages/lib/docs/reference/changelog/next.md` per `## Documentation Impact`.

11. **Run the full gate:** `npm run typecheck`, `npm test`, `npm run lint`.

12. **Re-measure in sqladmin** per `## Verification`'s manual section.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Row.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/tests/component/table/ColumnWindow.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnWindowSlide.test.ts` |
| Modify | `packages/lib/tests/component/table/HeaderColumnWindow.test.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/tests/component/table/RowCellCache.test.ts` |
| Modify | `packages/lib/tests/component/table/TreeBody.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases below are unit-testable offline except §F, which is manual.

### §A — `computeColumnWindowSize`

| `lefts` | `viewportWidth` | Result | Why |
|---|---|---|---|
| `[0, 100, …, 1900]` (20 × 100px) | `250` | `8` | widest run 3 → max raw-visible 4 → `4 + 4` |
| `[0, 100, …, 1900]` (20 × 100px) | `1000` | `16` | widest run 11 → max raw-visible 12 → `12 + 4` |
| `[0, 50, 350, 400, 700, 750]` | `400` | `6` | `min(n, 4 + 1 + 4)` caps at the column count |
| `[0, 0, 0]` (unknown widths) | `0` | `3` | every left edge coincides → whole table, matching today's pre-layout degrade |
| `[]` | `250` | `0` | no columns |

### §B — `computeColumnWindow` edge stability

For 20 columns of 100px in a 250px viewport:

- `scrollX` `0` returns `[0, 7]`; `550` returns `[3, 10]`; `650` returns `[4, 11]`; `1750` returns `[12, 19]`.
- `lastCol - firstCol + 1` is `8` at every one of those offsets.
- At every one of those offsets the window contains every raw-visible column — that is, every `i` whose span `[lefts[i], lefts[i] + widths[i]]` intersects `[scrollX, scrollX + viewportWidth]`.
- `firstCol` is never below `0` and `lastCol` never above `n - 1`, at `scrollX` `0` and at a `scrollX` far past the content (e.g. `1_000_000`).
- A table whose column count is at or below the computed size (e.g. 3 columns of 100px in a 250px viewport) returns `[0, n-1]` at every offset.
- `widths` and `lefts` on the returned window are unchanged from today: `lefts` is still the running sum of `widths`, and a zero-column call still returns `firstCol: 0`, `lastCol: -1`, and two empty arrays.

### §C — `Row` ARIA scoping

Against a row windowed to `[0, 5]` and then to `[3, 8]` with no intervening `setColumnFields` call:

- A cell that survives (the one rendering column 3, 4, or 5) receives **no** `setColIndex` call on the second window — spy on that cell's own `getAria().setColIndex` before the second call.
- That survivor's `getAria().getColIndex()` still reports its correct 1-based column afterwards.
- Every cell in the new window reports `getColIndex() === column + 1`, survivors and entering cells alike.
- After a `setColumnFields` call that changes the field set, the next `setColumnWindow` *does* call `setColIndex` on survivors too — `_columnsDirty` widens the scope.

### §D — `TableHeader` ARIA scoping

Against `render20At100(table, 550)` (window `[3, 10]`) followed by `setScrollX(650)` (window `[4, 11]`):

- A surviving header cell receives no `setColIndex` call on the slide.
- Every rendered header cell still reports `getColIndex() === windowStart + slot + 1` afterwards — the existing case 6 assertion, re-run after the slide.
- A header cell recycled into a new column *does* receive the call.

### §E — Existing cases whose literals move

| File | Case | Today | After | Why |
|---|---|---|---|---|
| `ColumnWindow.test.ts` | left-edge, `scrollX 0` | `[0, 4]` | `[0, 7]` | window no longer shrinks at the edge |
| `ColumnWindow.test.ts` | right-edge, `scrollX 1750` | `[15, 19]` | `[12, 19]` | window slides left instead of shrinking |
| `ColumnWindow.test.ts` | mid-scroll, `scrollX 550` | `[3, 10]` | `[3, 10]` | unchanged — keep as a regression guard |
| `Body.test.ts:1274` | cell count at `wideBody(20, 300, 0)` | `6` | `9` | `maxRawVisible` 5 for a 300px viewport → `slotCount` 9 |
| `Body.test.ts:1666` | `setScrollX(300)` "the window slides" | slides | no longer slides | at `scrollX 300` the window is still pinned at `firstCol 0`. Use `setScrollX(400)`, which gives a one-column slide, and reword the comment. The `survivors > 50` threshold at line 1686 still clears: the pool is at least 9 rows (the sibling case's `cells > 50` over a 6-wide window says so) and a one-column slide leaves 8 survivors per row |
| `Body.test.ts:1933` | `getColumnWindowStart()` after `setScrollX(1500)` | `12` | `11` | right-edge window is `[11, 19]`; `|delta|` is still ≥ width, so the case still exercises the full path |
| `TreeBody.test.ts:230-234` | fixture comment | `[0, 4]` / `[15, 19]` | `[0, 7]` / `[12, 19]` | comment only — both assertions (tree cell present at `scrollX 0`, absent at `1750`) still hold |
| `RowCellCache.test.ts:245` | 6 columns narrowed to a 10px viewport | 3 of 6 rendered | 6 of 6 rendered | `slotCount` floors at `2 + 2 × COLUMN_BUFFER` = 6, so nothing is displaced into the cell cache and the case stops exercising cached-cell disposal — widen the fixture past 6 columns so the narrow still displaces cells |

### §F — Manual, in the sqladmin consuming app

- Horizontal wheel scrolling `wide.cols_60` end to end stays visually smooth, with no stall at either end of the columns.
- Cells stay correctly positioned and correctly valued at both ends — in particular the leftmost column sits flush at x 0 when scrolled fully left, and the rightmost column's right edge sits flush with the content width when scrolled fully right.
- The header stays aligned with the body at both ends.
- Cell editing still commits when the edited column is scrolled out of the window.

---

## Verification

Automated, from the repo root:

- `npm run typecheck` — clean.
- `npm test` — the whole suite, with `tests/component/table/` green. `Body.test.ts` cases 11 and 12 (a one-column slide calls `cellKeyFor` zero times, and constructs at most `poolSize` cells) must pass **unmodified** — they are the guard that the slide path still works mid-scroll. The cell-layout-skip cases may have their scroll offsets adjusted per `## Expected Behaviour` §E, but not their assertions.
- `npm run lint` — clean.
- `grep -rn 'lastRawVisible' packages/lib/src/ packages/lib/tests/` — expect zero matches.

Manual, in the sqladmin consuming app at `/home/jika/typescript/sqladmin`:

- Build the library with `npm run build:lib` and consume it through the symlink override, then open `wide.cols_60` at a maximized viewport.
- Re-run the established protocol from `LIBRARY_NOTES.md`'s "Horizontal scrolling a wide grid layout-thrashes" entry: a 4-leg / 80-event direction-reversing `WheelEvent` burst under a Chrome performance trace, once horizontal and once vertical on the same page with no reload.
- Compare against that entry's recorded baseline. The two numbers this plan targets: the `DOMSize` insight's per-pass elements-affected share (63-71% of ~19,750 elements before) and the horizontal-versus-vertical frame-gap asymmetry (horizontal worst 433-533 ms, average 91-95 ms, ~30% of frames over 100 ms; vertical worst 150-167 ms, average 27-31 ms, ~4% over 100 ms). Both should shrink, and the horizontal figures should move toward the vertical ones.
- Record the result in `LIBRARY_NOTES.md` under that entry whichever way it goes.

---

## Documentation Impact

No public API changes, so no TypeDoc page moves and `npm run docs:api` needs no re-run beyond the standard gate.

One changelog entry, in `packages/lib/docs/reference/changelog/next.md`. `next.md` currently has `## Breaking changes` and `## Fixed`; add a `## Changed` section with a `### Table` subsection between them, matching the section order in [`0.7.0.md`](packages/lib/docs/reference/changelog/0.7.0.md) (Breaking changes → Changed → Added → Fixed). Frame it like 0.7.0's own horizontal-scrolling entry — what a consumer observes, then "No consumer action is needed":

> **Horizontal scrolling to either end of a wide table is no longer slower than scrolling through its middle.** The rendered column window keeps a constant width at every scroll offset, so reaching the first or last columns no longer forces every visible row to re-derive its whole cell set. A few more columns are rendered when the table is scrolled hard against either end — the same number it renders mid-scroll. No consumer action is needed.

---

## Potential Challenges

- **`Header.ts` is also edited by the unimplemented `plans/header-column-window-rotation.md`.** That plan adds a slide fast path to `reconcileColumnCells` while leaving the full path in place, so the two changes are compatible in substance but will conflict textually in pass 3. Whichever lands second re-applies the `retargeted`-scoped ARIA write to the surviving full path.
- **First render builds a few more cells per row.** At a 250px viewport over 100px columns that is 8 cells instead of 5 — cells the pool would have built within two scroll ticks anyway. Nothing to mitigate; noted so the extra construction on the very first pass is not mistaken for a regression.
- **A viewport resize still changes the window width and still takes the full path.** That is correct and unchanged: a resize genuinely changes how many columns fit. `Body.test.ts` case 15 pins it.
- **The header and the body size their windows from slightly different viewport widths** (the header's cached `geometry.viewportWidth` versus the body's own `getWidth()`), so their windows can differ by a column at some offsets. This is true today for `firstCol`/`lastCol` as well and no test depends on the two matching exactly; do not try to reconcile them here.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — the precedent. Read `computeVisibleWindow` (271-281), `computePoolTarget` (296-304), `growRowPool` (327-358), `alignPoolWindow` (377-393), and `hideExcessPoolRows` (436-445) as a unit; `computePoolTarget`'s doc comment states the "windowSize shrinks near the edges, so don't size the pool from it" rule this plan carries over to columns.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `COLUMN_BUFFER` (103), the `ColumnWindow` interface (112-119), `computeColumnWindow` (140-188), `computeColumnWindowSlidePlan` (1123-1161), `renderWindowPass` (1169-1241), and `bindAndPositionRows` (1324-1406).
- [`packages/lib/src/typescript/lib/component/table/Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts) — `setColumnWindow` (435-638) end to end, including the fast-path dispatch (481-489) and pass 3 (578-592), plus `reconcileWindowSlide` (652-746) for the entering-cell ARIA write it already scopes.
- [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts) — `reconcileColumnCells` (713-836) and `renderColumnWindow` (1333-1355), the header's only `computeColumnWindow` caller.
- [`plans/implemented/table-column-window-rotation.md`](plans/implemented/table-column-window-rotation.md) — the plan that introduced the slide plan and its eligibility table; this plan changes what feeds that table, not the table itself.
- [`plans/implemented/table-column-virtualization.md`](plans/implemented/table-column-virtualization.md) — the plan that introduced `computeColumnWindow` and its inclusive-bounds rule, which the rewritten scan preserves verbatim.
- [`/home/jika/typescript/sqladmin/LIBRARY_NOTES.md`](/home/jika/typescript/sqladmin/LIBRARY_NOTES.md) — the "Horizontal scrolling a wide grid layout-thrashes" entry holds the measurement protocol and the baseline numbers `## Verification` compares against.

---

## Non-Goals

- **Positioning cells by transform instead of `left`/`width`.** Pooled rows are placed with `setTranslate` and are compositor-only; cells are placed with `applyBounds` and trigger layout. That is a real secondary cost, but converting cells to transforms is a much larger change with box-model-correctness risk at rebind time, and it is not what makes the edges slower than the middle.
- **Cold-cache cell construction cost in `Row.createCellForField`.** A separate, previously-deferred thread.
- **A slide fast path for `TableHeader`.** Owned by `plans/header-column-window-rotation.md`.
- **`TableHeader.reconcileFilterCells`'s identical ARIA write** ([Header.ts:1299](packages/lib/src/typescript/lib/component/table/Header.ts#L1299)). Its pass 3 also re-applies `setColumnLabel`, `setOperators`, `setNumericOnly`, and `setFilterState` unguarded, so scoping the ARIA write alone would buy little; the filter row's full treatment belongs with the header slide path.
- **`HeaderCell.setRequired`'s missing equality guard** ([cell/Header.ts:453](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L453)), which calls `_renderTitle()` on every reconcile unlike its guarded neighbour `setHeaderText`. Found while scoping the ARIA write; recorded here rather than fixed, because the header slide path removes the call from survivors entirely.
- **Deduplicating attribute writes framework-wide.** `ElementAttributes.set` stays as it is: a guard there would change behaviour for every attribute the framework writes, not only this one.

---

## Notes

[^measured]: The gap was confirmed by live measurement in the sqladmin consuming app before this plan, then traced to the source. On `wide.cols_60` (60 columns) at a maximized viewport the window width cycles through four distinct values (54/55/56/57) across almost the whole scrollable range, because the viewport shows most of the table and the clamped zones therefore dominate. Every change in that value is a tick where `computeColumnWindowSlidePlan` returns undefined and every pooled row takes the full reconcile at once — not one lagging row. It is a recurring per-tick cost, not a one-time cold-cache cost. The same width jitter also appears mid-scroll on ordinary wide tables, because the number of columns a viewport intersects alternates between two values as the scroll offset moves through a column; the fixed width removes that case too.

[^why-fixed-width]: Three alternatives were considered and rejected. **Widening the buffer** (say `COLUMN_BUFFER = 8`) shrinks how often the clamped zone is entered but does not make the width constant, so the fast path still drops out at every step through the clamp — and it costs the extra cells at every offset, not only near the edges. **Relaxing `computeColumnWindowSlidePlan` to accept a width change** means the slide plan can no longer describe the reconcile as "these `|delta|` cells leave, these `|delta|` enter", which is the property `Row.reconcileWindowSlide`'s whole implementation rests on; a width-changing plan needs a second, different fast path. **Leaving the window alone and making the full path cheaper** does not close the gap, because the full path's cost is inherently proportional to the window width times the pool size — that is exactly what `VirtualRowView` avoided by never rebuilding at all.

[^max-raw-derivation]: The bound is exact and needs no per-offset search. At any scroll offset the raw-visible run `[f, l]` satisfies `lefts[l] <= scrollX + viewportWidth` (column `l`'s left edge is inside the viewport) and `lefts[f] + widths[f] >= scrollX`, and the second of those gives `lefts[f + 1] >= scrollX`. Subtracting, `lefts[l] - lefts[f + 1] <= viewportWidth` — so `[f + 1, l]` is one of the runs the sliding window measures, and the full run is at most one column longer. That makes `widest + 1` an upper bound on every offset's raw-visible count, and it is reached whenever some offset places a column boundary exactly at the viewport's left edge. The pass is O(n) over the visible-column count, the same order as the `lefts` accumulation `computeColumnWindow` already runs on every call.

[^why-slide-not-hide]: The literal transcription of `VirtualRowView`'s approach would be a fixed number of rendered cells per row with the ones falling outside `[0, n-1]` hidden, mirroring `hideExcessPoolRows`. Sliding is strictly better for columns because it avoids a problem rows do not have. A pooled row's position comes from `setTranslate` and is computed from its own data index, so a hidden slot is inert. A cell's position is computed by accumulating `widths` from `lefts[firstCol]`, so an empty slot at the left edge would need a synthetic width and offset for the accumulation to stay correct — a new concept with a new way to be wrong. Sliding keeps every slot mapped to a real column, so the existing accumulation is correct unchanged. The one case sliding cannot cover — a column list shorter than the fixed width — resolves to "render the whole table", which is already a constant-width window.

[^no-row-change]: This is what makes the change small. The slide plan's other four conditions are about overlap and dirtiness, not width, and none of them is affected by where the window sits relative to the column list's ends. `Row.setColumnWindow`'s own guard that the plan matches *this row's* previous window (`this._windowFirst === plan.prevFirstCol && currentLastCol === plan.prevLastCol`) also keeps its meaning: a row that fell behind still falls back to the full path for one tick and then rejoins the fast path.

[^survivor-colindex]: The argument turns on `_visibleFields` being the single source of the column ordering in both classes. `Row._visibleFields` is written only by `setColumnFields` ([Row.ts:364](packages/lib/src/typescript/lib/component/table/Row.ts#L364)), which sets `_columnsDirty` on the same call; `TableHeader._visibleFields` is written only by `rebuildCells` ([Header.ts:666](packages/lib/src/typescript/lib/component/table/Header.ts#L666)), which sets `_columnsDirty` likewise. A pass-1 survivor is matched by field name, so it renders the same field it did before, and that field's index into `_visibleFields` is unchanged whenever `_columnsDirty` is false. `Row`'s separator round trip is covered by the same flag: `renderSeparator` sets `_columnsDirty` ([Row.ts:407](packages/lib/src/typescript/lib/component/table/Row.ts#L407)), and coming out of separator mode disposes every cell anyway, so no cell can survive it. The alternative — deduplicating inside `Aria.setColIndex`, or inside `ElementAttributes.set` — was rejected: a guard in `ElementAttributes.set` changes behaviour for every attribute in the framework, including a deliberate re-assert of a value something else changed on the element, and a guard in `Aria.setColIndex` alone would make one of roughly forty `Aria` setters behave unlike its siblings for no stated reason.
