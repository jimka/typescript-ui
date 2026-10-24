---
touches-shared:
  - packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts
  - packages/lib/src/typescript/lib/component/tree/Tree.ts
  - packages/lib/src/typescript/lib/component/table/TreeBody.ts
  - packages/lib/docs/components/Tree.md
  - packages/lib/docs/components/TreeTable.md
  - packages/lib/docs/reference/changelog/next.md
---

# Tree Row Motion Without Snaps — Implementation Plan

## Overview

`Tree` and `TreeTable` animate a single node's expand or collapse through the shared row-motion primitives on [`VirtualRowView`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L792). Two rules in [`mayAnimateRowMotion`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L824) make some toggles jump straight to the end state instead of animating:

1. **Tall block.** A node whose *child block* (every visible descendant row under it, all depths) has more rows than fit in the viewport snaps.
2. **End-of-list collapse.** A collapse near the end of a scrolled list snaps, because its commit render pulls the scroll offset up to the new, shorter content's maximum (a *scroll clamp*).

This plan makes both animate, in both components, with no visible jump in row positions, content height (the scrollbar's extent) or scroll offset at the start or at the end of the motion. A tall block animates only its *shown rows* — the leading rows of the block that are on screen while the node is open; the rest are off screen at both ends of the motion and are left out of it. An end-of-list collapse moves the scroll offset itself, frame by frame, from where it was before the commit to where the commit put it, so the rows above slide down as the block closes. One narrow case keeps snapping (see *What still snaps*).

All changes sit in `VirtualRowView.ts`, plus a few lines in [`Tree._reflattenWithMotion`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1255) and [`TreeBody.setExpanded`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L341). No public signature changes. Tests M9 and M10 in `TreeExpandMotion.test.ts`, and their two unnamed `TreeTable` twins, pin the old snap rules; they are the contract this plan changes and are rewritten, not worked around. The docs and the original plan's footnote that describe the snap rules are updated.

---

## Architecture Decisions

### A tall block animates only its shown rows

When a block has more rows than the viewport (`blockLength > viewportRows`, where `viewportRows = ceil(getHeight() / rowHeight)`), the motion keeps only the block's first `shownLength` rows. `shownLength` counts rows from the block's start down to the viewport's bottom edge, measured while the node is open, at the scroll offset from before the commit. The rest of the block — its *hidden tail* — is removed from the *motion row list* (the row list the render pass reads while a motion plays), so the rows after the block follow the shown rows directly and move with them as one piece. A block that fits the viewport keeps every row, exactly as today.[^trim] This mirrors two existing rules: the virtual pool renders only the rows its window can show, and [`CollapseSupport`'s mover filter](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L186) gives frames only to boxes that actually move.[^precedent]

```
shownLength = blockLength                                   when blockLength <= viewportRows
            = clamp(ceil((scrollYBefore + getHeight() - blockStart * H) / H), 0, blockLength)   otherwise
```

Worked cases, `H = 24`, viewport 120 px (`viewportRows = 5`). `blockStart * H` is the toggled row's bottom edge.

| Toggle | `blockLength` | `blockStart * H` | scroll before | `shownLength` | Result |
|---|---|---|---|---|---|
| expand `E{c0..c4}`, E at row 0 | 5 | 24 | 0 | 5 (fits) | animates every child |
| expand `E{c0..c5}`, E at row 0 | 6 | 24 | 0 | `ceil(96/24)` = 4 | animates c0–c3; c4, c5 off screen |
| expand or collapse `B{b0..b19}`, B at row 1 | 20 | 48 | 0 | `ceil(72/24)` = 3 | animates b0–b2 |
| collapse `P{p0..p19}`, P at row 9 | 20 | 240 | 168 | `ceil(48/24)` = 2 | animates p0–p1, and drives the scroll |
| expand `P{p0..p19}`, P at row 0 | 20 | 24 | 24 | `ceil(120/24)` = 5 | animates p0–p4 |
| expand `P{p0..p19}`, P at row 0 | 20 | 24 | 48 | `ceil(144/24)` = 6 | snaps: 6 > 5 |

### Rows move by the shown rows; the content height moves by the whole block

Row positions use the shown rows only. The content height (what the scrollbar and the scroll clamp read) uses the whole block, so it runs continuously from the closed list's height to the open list's height. With reveal `r` (0 = closed, 1 = open), `m = shownLength`, `k = blockLength` and `totalRows` the motion row list's length:

- a row at motion-list index `i < blockStart` sits at `i * H`;
- a row at `i >= blockStart` sits at `i * H - (1 - r) * m * H`;
- content height is `(totalRows + k - m) * H - (1 - r) * k * H`.

Worked example: `A B{b0..b19} C D L0..L9` (34 rows open, 14 closed), B expanded, scroll 0, so `m = 3`, `k = 20`. The motion row list is `A B b0 b1 b2 C D L0..L9` (17 rows).

| Row | Motion index | `r = 0` y / opacity | `r = 0.5` y / opacity | `r = 1` y / opacity | Settled y |
|---|---|---|---|---|---|
| b0 | 2 | -24 / 0 | 12 / 0 | 48 / 1 | 48 |
| b1 | 3 | 0 / 0 | 36 / 0.5 | 72 / 1 | 72 |
| b2 | 4 | 24 / 0 | 60 / 1 | 96 / 1 | 96 |
| b3 | — | not rendered | not rendered | not rendered | 120 |
| C | 5 | 48 / — | 84 / — | 120 / — | 528 |
| D | 6 | 72 / — | 108 / — | 144 / — | 552 |
| content height | | 336 | 576 | 816 | 816 |

At `r = 0`, C and D sit where they were before the expand. At `r = 1` every row inside the 120 px viewport (A, B, b0–b2) sits where the settled render puts it; C and D change position at the settle, but both are below the viewport before and after. Collapse uses the same table with `r` running from 1 to 0.[^content-height]

### An end-of-list collapse drives the scroll offset

When the commit's own render clamps the scroll offset, the motion records the offset from before the commit (`scrollFrom`) and the one after it (`scrollTo`). Every frame then sets the offset by linear interpolation in reveal between the two, through `VirtualScroller.setScrollY`. The scroller's tick renders that frame, as it does for a wheel ease or a fling. The commit's clamped render still runs synchronously; the motion's first frame restores `scrollFrom` before the browser paints.[^scroll-drive]

```
scrollY(r) = scrollTo + (scrollFrom - scrollTo) * (r - revealTo) / (revealFrom - revealTo)
```

Worked example: 20 root leaves then `Z{z1 z2 z3}`, Z expanded, viewport 120 px, scrolled to the end (456). Collapsing Z leaves 21 rows (content 504), so the commit clamps the offset to 384.

| Reveal | Scroll offset | Z y | z1 y / opacity | z2 y / opacity | z3 y / opacity | Content height |
|---|---|---|---|---|---|---|
| 1 (first frame) | 456 | 480 | 504 / 1 | 528 / 1 | 552 / 1 | 576 |
| 0.5 | 420 | 480 | 468 / 0 | 492 / 0.5 | 516 / 1 | 540 |
| 0 (settled) | 384 | 480 | — | — | — | 504 |

The list's last row stays on the viewport's bottom edge on every frame, and the rows above it slide down by 72 px over the motion.

### A scroll the motion did not make settles a scroll-bound motion

A motion is *scroll-bound* when it is trimmed (`shownLength < blockLength`) or drives the scroll (`scrollFrom !== scrollTo`). Both were planned for one scroll offset. When a scroll tick arrives that the motion did not cause and that changed the vertical offset — a wheel, a touch drag, the scrollbar, `setScrollY` — a scroll-bound motion settles at once: `settleRowMotion()`, then the tick renders the committed state. Every other motion keeps playing through a scroll, as M14 pins today.[^foreign-scroll] This follows [`scrollToCommittedY`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L1229), which already settles a motion before a scroll that would leave its rows in the wrong place.

The check lives in one new private method, `routeScrollerTick`, which the scroller calls instead of `onScrollerTick` directly, so `Body`'s `onScrollerTick` override needs no change.

### A retarget keeps the previous motion's shown rows

Re-toggling the same node while its motion is pending or running reuses that motion's `shownLength` instead of computing a new one. Recomputing could change `m` mid-motion, which moves every row after the shown rows at the moment of the re-toggle.[^retarget-shown]

### What still snaps

One case keeps snapping: a node scrolled entirely out of view above the viewport, with more than a viewport of its open children below its bottom edge — `shownLength > viewportRows`. Animating it continuously would need more than a viewport of rows in the motion, which grows the pool past today's bound and moves rows faster than they can be read.[^residual] A view with no height (`viewportRows === 0`) also snaps, as today. Reduced motion, bulk and structural calls, and a toggled row missing from the render keep their current rules.

### The committed-index map follows the shown rows

`rowMotionCommittedIndex` maps a motion-list index to a committed-list index, for `Body`'s `aria-rowindex` and zebra stripe. With trimming, a row past the shown rows sits `k - m` rows further down in the committed list during an expand, and `m` rows further up during a collapse. Inside the shown rows, the index is unchanged.[^committed-index]

| Motion | Motion index `i` | Committed index |
|---|---|---|
| any | `i < blockStart + m` | `i` (a leaving row keeps its pre-collapse index) |
| expand | `i >= blockStart + m` | `i + k - m` |
| collapse | `i >= blockStart + m` | `i - m` |

`settleRowMotionIfEntering` keeps testing the whole block (`blockLength`), because its index is a committed-list index and every block row is an entering row there.

### The original plan's snap footnote is superseded

`plans/implemented/tree-expand-collapse-animation.md`'s `[^threshold]` footnote and the matching rows of its *Which toggles animate* table no longer describe the code. A one-line pointer note is appended to that plan's *Implementation Notes*; its body is left as the record of what it shipped.

---

## Internal Structure

All in `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`. Every method keeps or gets JSDoc per the conventions; it is shortened here.

### State

```typescript
interface RowMotion extends RowMotionBlock {
    key:         object;
    /** How many of the block's leading rows the motion row list keeps; equal to `blockLength` unless the motion is trimmed. */
    shownLength: number;
    reveal:      number;
    /** The reveal the tween starts from. */
    revealFrom:  number;
    /** The reveal the tween runs to: 1 for an expand, 0 for a collapse. */
    revealTo:    number;
    started:     boolean;
    expanding:   boolean;
    /** The vertical scroll offset before the commit — where the scroll sits at `revealFrom`. */
    scrollFrom:  number;
    /** The offset the commit's render left — where the scroll sits at `revealTo`. Differs from `scrollFrom` only when that render clamped it. */
    scrollTo:    number;
    /** The vertical offset this motion last rendered against; a scroll tick that finds another one came from elsewhere. */
    scrollY:     number;
    handle:      Animation.CancelHandle;
}

/** True while a row motion itself moves the scroll offset, so its own scroll tick is not taken for a user's. */
private _rowMotionScrolling: boolean = false;
```

`RowMotionBlock` (exported) is unchanged: `blockLength` stays the whole block.

### Scheduling

```typescript
protected commitWithRowMotion(key: object, expanding: boolean, commit: () => RowMotionBlock | null): boolean {
    const previous      = this._rowMotion;
    const retarget      = previous !== null && previous.key === key ? previous : null;
    const scrollYBefore = this._scroller?.getScrollY() ?? 0;
    const block         = commit();

    if (block === null) {
        return false;
    }

    const shownLength = retarget?.shownLength ?? this.rowMotionShownLength(block, scrollYBefore);

    if (!this.mayAnimateRowMotion(block, shownLength)) {
        return false;
    }

    const from = retarget?.reveal ?? (expanding ? 0 : 1);
    const to   = expanding ? 1 : 0;

    if (from === to) {
        return false;
    }

    this.scheduleRowMotion(key, block, shownLength, from, to, scrollYBefore);

    return true;
}

private rowMotionViewportRows(): number {
    return Math.ceil((this.getHeight() || 0) / this.getRowHeight());
}

private rowMotionShownLength(block: RowMotionBlock, openScrollY: number): number {
    if (block.blockLength <= this.rowMotionViewportRows()) {
        return block.blockLength;
    }

    const rowHeight    = this.getRowHeight();
    const rowsToBottom = Math.ceil((openScrollY + (this.getHeight() || 0) - block.blockStart * rowHeight) / rowHeight);

    return Math.min(block.blockLength, Math.max(0, rowsToBottom));
}

private mayAnimateRowMotion(block: RowMotionBlock, shownLength: number): boolean {
    if (Animation.isReducedMotion() || this._scroller === null) {
        return false;
    }

    const viewportRows = this.rowMotionViewportRows();

    return block.blockLength > 0 && viewportRows > 0 && shownLength <= viewportRows;
}

private scheduleRowMotion(key: object, block: RowMotionBlock, shownLength: number, from: number, to: number, scrollFrom: number): void {
    const scrollTo = this._scroller!.getScrollY();
    const motion: RowMotion = {
        key, ...block, shownLength, reveal: from, revealFrom: from, revealTo: to, started: false,
        expanding: to === 1, scrollFrom, scrollTo, scrollY: scrollTo, handle: { cancel: (): void => {} },
    };

    // …the existing `this._rowMotion = motion;` and `Animation.tween({...})` body, unchanged.
}

/** The row list a just-scheduled motion renders: `rows` itself, or a copy without the block's hidden tail. */
protected rowMotionRows<T>(rows: T[]): T[] {
    const motion = this._rowMotion!;

    if (motion.shownLength === motion.blockLength) {
        return rows;
    }

    return rows.slice(0, motion.blockStart + motion.shownLength)
        .concat(rows.slice(motion.blockStart + motion.blockLength));
}
```

### Frames and scroll ticks

```typescript
private stepRowMotion(motion: RowMotion, reveal: number): void {
    if (this._rowMotion !== motion) {
        return;
    }

    const firstFrame = !motion.started;

    motion.reveal = reveal;

    if (firstFrame) {
        motion.started = true;
        this.onRowMotionRowsChanged();
    }

    // A scroll change ticks the scroller, and the tick renders this frame.
    if (!this.driveRowMotionScroll(motion, firstFrame)) {
        this.renderWindow();
    }
}

/** Moves the scroll offset to where the motion's reveal puts it; returns whether that moved it, and so rendered. */
private driveRowMotionScroll(motion: RowMotion, firstFrame: boolean): boolean {
    const scroller = this._scroller;

    if (scroller === null || motion.scrollFrom === motion.scrollTo) {
        return false;
    }

    // Only a collapse clamps the commit, and its committed list lacks the
    // block, so the motion's content height is the committed one plus the
    // block's revealed share. Set before restoring `scrollFrom`, which the
    // committed height would clamp straight back.
    if (firstFrame) {
        scroller.setContentHeight(scroller.getContentHeight() + motion.reveal * motion.blockLength * this.getRowHeight());
    }

    const progress = (motion.reveal - motion.revealTo) / (motion.revealFrom - motion.revealTo);
    const before   = scroller.getScrollY();

    this._rowMotionScrolling = true;
    scroller.setScrollY(motion.scrollTo + (motion.scrollFrom - motion.scrollTo) * progress);
    this._rowMotionScrolling = false;

    motion.scrollY = scroller.getScrollY();

    return motion.scrollY !== before;
}

/** The scroller's tick: settles a scroll-bound motion on a scroll it did not make, then runs `onScrollerTick`. */
private routeScrollerTick(): void {
    const motion = this._rowMotion;

    if (motion !== null && !this._rowMotionScrolling && this.isRowMotionScrollBound(motion)
        && this._scroller!.getScrollY() !== motion.scrollY) {
        this.settleRowMotion();
    }

    this.onScrollerTick();
}

private isRowMotionScrollBound(motion: RowMotion): boolean {
    return motion.shownLength < motion.blockLength || motion.scrollFrom !== motion.scrollTo;
}
```

### Geometry and index helpers

```typescript
/** How far rows after the shown rows are pulled up (drives positions and the window overhang). */
private rowMotionHiddenHeight(): number {        // existing name; now uses shownLength
    const motion = this._rowMotion;

    if (motion === null || !motion.started) {
        return 0;
    }

    return (1 - motion.reveal) * motion.shownLength * this.getRowHeight();
}

/** The whole block's hidden height (drives the content height and the settle hand-off). */
private rowMotionBlockHiddenHeight(): number {
    const motion = this._rowMotion;

    if (motion === null || !motion.started) {
        return 0;
    }

    return (1 - motion.reveal) * motion.blockLength * this.getRowHeight();
}

protected rowMotionContentHeight(totalRows: number): number {
    const motion     = this._rowMotion;
    const hiddenTail = motion !== null && motion.started ? motion.blockLength - motion.shownLength : 0;

    return (totalRows + hiddenTail) * this.getRowHeight() - this.rowMotionBlockHiddenHeight();
}

protected rowMotionCommittedIndex(dataIndex: number): number {
    const motion = this._rowMotion;

    if (motion === null || !motion.started) {
        return dataIndex;
    }

    if (dataIndex < motion.blockStart + motion.shownLength) {
        return dataIndex;
    }

    return motion.expanding
        ? dataIndex + motion.blockLength - motion.shownLength
        : dataIndex - motion.shownLength;
}
```

`isInRowMotionBlock` tests `dataIndex < motion.blockStart + motion.shownLength` instead of `+ motion.blockLength`. `settleRowMotion` calls `rowMotionBlockHiddenHeight()` where it called `rowMotionHiddenHeight()`; its `droppedHeight` stays `motion.blockLength * H`.

### Subclass wiring

`Tree._reflattenWithMotion`:

```typescript
private _reflattenWithMotion(node: TreeNode, expanding: boolean): void {
    const before = this._flatRows;
    let   rows   = before;

    const scheduled = this.commitWithRowMotion(node, expanding, () => {
        this._reflattenAndRender();

        rows = expanding ? this._flatRows : before;

        return this.rowMotionBlock(rows, rows.findIndex(row => row.node === node));
    });

    this._motionRows = scheduled ? this.rowMotionRows(rows) : null;
}
```

`TreeBody.setExpanded`, after its existing guards:

```typescript
const before = this._flatRows;
let   rows   = before;

const scheduled = this.commitWithRowMotion(record, expanded, () => {
    // …the existing add/delete, flatten(), invalidateRowBindings(), renderWindow()…

    rows = expanded ? this._flatRows : this.collapsingMotionRows(before, record);

    return this.rowMotionBlock(rows, rows.findIndex(f => f.record === record));
});

if (scheduled) {
    this._motionRows    = this.rowMotionRows(rows);
    this._motionRecords = this._motionRows.map(f => f.record);
} else {
    this._motionRows    = null;
    this._motionRecords = null;
}
```

Assigning the motion lists after `commitWithRowMotion` returns is safe: nothing reads them before the motion's first frame.[^assign-after]

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Work test-first: write the Phase 1 tests, run them, see them fail, then implement.

### Phase 1 — Tests (red first)

1. **`tests/component/tree/TreeExpandMotion.test.ts`**:
   - Update the file-header comment (lines 3–7): it also pins `plans/tree-row-motion-no-snap.md` (M9, M10 rewritten; M16–M22 new).
   - Add two module-level fixture helpers next to `mountSingleBranch` (line 195), both 300 × 120 like it:
     - `mountLongBranch()` — roots `A, B{b0..b19}, C, D, L0..L9`, all collapsed; returns the tree and the nodes.
     - `mountEndBranch()` — roots `r0..r8, P{p0..p19}`, all collapsed; returns the tree, `P` and its children.
   - Replace M9 (line 460) and M10 (line 474) with the new M9 and M10 from *Expected Behaviour*. Keep their `it` titles in the form `M9: …` / `M10: …`, reworded to the new contract.
   - Add M16–M22 inside the main `describe` (line 208), directly after the M15 case (line 604). They call `expectFinalRender` and `poolSnapshot` (lines 387, 403), which are function declarations in the same `describe` callback and so already in scope. Read content heights from a `layoutScrollbars` spy, as M2 does.
2. **`tests/component/table/TreeTableExpandMotion.test.ts`**:
   - Update the file-header comment (lines 3–7) the same way (T7–T13).
   - Replace the unnamed threshold test (line 732) with T7 and the unnamed clamp test (line 750) with T8.
   - Add a helper `mountBranchWithTail(childCount: number, trailingRoots: number, minColumnWidth = 100)` next to the local `mountSingleBranch` (line 710): a five-row table (header included, as `mountSingleBranch` does) over root `E` (id 1) with `childCount` leaves (ids 2…), then `trailingRoots` root leaves; the first trailing root is named `F`. Pass `minColumnWidth` into the spec's single column.
   - Add T9–T13 after T8. Extend `BodyPrivate`'s `_scroller` type (line 129) with `layoutScrollbars(w: number, h: number): void`, for the content-height spy. Read `aria-rowindex` with `row.getAria().getRowIndex()` (as at line 385) and the stripe with `row.isStyleState('.stripe')` (as at line 409).
3. **Run** `npx vitest run tests/component/tree/TreeExpandMotion.test.ts tests/component/table/TreeTableExpandMotion.test.ts`. Expect M9, M10, M16–M21, T7–T12 to fail. M22 and T13 are pool-bound guards and may already pass (today the case snaps); keep them. Every other existing case must still pass.

### Phase 2 — `VirtualRowView`

4. **`src/typescript/lib/component/shared/VirtualRowView.ts`** — state:
   - Add `shownLength`, `revealFrom`, `revealTo`, `scrollFrom`, `scrollTo`, `scrollY` to `RowMotion` (lines 31–45), with the doc comments from *Internal Structure*.
   - Add `_rowMotionScrolling` after `_lastPassInMotion` (line 126).
5. **Same file** — scroller tick: in `initScroller` (line 159) pass `() => this.routeScrollerTick()` instead of `() => this.onScrollerTick()`. Add `routeScrollerTick` and `isRowMotionScrollBound` below `onScrollerTick` (line 172). Update `onScrollerTick`'s JSDoc to say it runs after a scroll-bound motion has been settled.
6. **Same file** — scheduling: replace `commitWithRowMotion`, `mayAnimateRowMotion` and `scheduleRowMotion`'s signature and motion literal (lines 792–868) with *Internal Structure*'s versions; keep the existing `Animation.tween` call and its easing comment as they are. Add `rowMotionViewportRows`, `rowMotionShownLength` and `rowMotionRows`. Rewrite `mayAnimateRowMotion`'s JSDoc to list the new rules (reduced motion, no scroller, empty block, no viewport height, shown rows taller than the viewport) and `commitWithRowMotion`'s `@param commit` to say the block is the whole block.
   - Check: `grep -n "scrollYBefore" src/typescript/lib/component/shared/VirtualRowView.ts` — matches only inside `commitWithRowMotion`.
7. **Same file** — frames: replace `stepRowMotion` (line 880) and add `driveRowMotionScroll` after it.
8. **Same file** — geometry: change `rowMotionHiddenHeight` (line 589) to `shownLength` and update its JSDoc; add `rowMotionBlockHiddenHeight`; replace `rowMotionContentHeight` (line 650) and `rowMotionCommittedIndex` (line 632); in `isInRowMotionBlock` (line 668) use `shownLength`; in `settleRowMotion` (line 951) use `rowMotionBlockHiddenHeight()`. Update each changed JSDoc to name the shown rows and the hidden tail.
9. **Same file** — class JSDoc (lines 88–95): add `{@link rowMotionRows}` to the list of row-motion primitives.
10. **Check**: `npm run typecheck`.

### Phase 3 — Subclass wiring

11. **`src/typescript/lib/component/tree/Tree.ts`**: replace `_reflattenWithMotion` (lines 1255–1271) with *Internal Structure*'s version. Update its JSDoc: the motion row list is the full list trimmed by `rowMotionRows` for a tall block.
12. **`src/typescript/lib/component/table/TreeBody.ts`**: replace the tail of `setExpanded` (lines 358–383) with *Internal Structure*'s version. Update the `_motionRows` field comment (lines 152–158) to say the list is trimmed for a tall block.
13. **Check**: `npm run typecheck`; `npx vitest run tests/component/tree tests/component/table` — all green, including M1–M8, M11–M15, the scroll-into-view, keyboard, aria-hidden and active-descendant cases, `RenderPassEconomy.test.ts`, `TreeBody.test.ts`, `Body.test.ts`.

### Phase 4 — Other suites

14. **Run** `npx vitest run tests/component/table/EditAcrossRowRebind.test.ts`. Its fixture (`makeScrollableTreeTable`, line 309) expands a 4000-record block, which used to snap and now animates; the file drives frames with `now = 0` against the real clock, so the motion stays at its first frame. If any case fails, wrap only that `table.setExpanded(…)` call: `const reduced = vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true);` before it and `reduced.mockRestore();` after it, with a one-line comment that the fixture wants the expanded table, not a motion. Import `Animation` from `~/core/Animation` and `vi` from `vitest` if missing. If every case passes, leave the file alone.
15. **Run** `npm test`. Any other failing test outside the two motion files and step 14 is unexpected: stop and report it with the failure, rather than changing its expectations.

### Phase 5 — Documentation

16. **`src/typescript/lib/component/tree/Tree.ts`** class JSDoc (lines 219–222): replace "; a toggle whose children would not fit in the current viewport, or whose commit moves the scroll offset, snaps instead." with "; a toggle of a node scrolled out of view above the viewport, whose open children reach more than a viewport below it, snaps instead."
17. **`src/typescript/lib/component/table/TreeBody.ts`** `setExpanded` JSDoc (lines 336–339): replace the parenthesised list "(a block taller than the viewport, a commit that moves the scroll offset, `prefers-reduced-motion: reduce`)" with "(a record scrolled out of view above the viewport whose open children reach more than a viewport below it, `prefers-reduced-motion: reduce`)".
18. **`docs/components/Tree.md`** line 99: replace the sentence "A toggle whose children would not fit in the current viewport, or whose commit moves the scroll offset, also snaps instead of animating." with:
    > A node whose children are taller than the viewport animates the children that are on screen while it is open; the rest appear or disappear off screen. A collapse near the end of a scrolled list slides the rows above down as the children close, the way a file browser does. One toggle still snaps: a node scrolled out of view above the viewport whose open children reach more than a viewport below it. A scroll made while one of these two kinds of motion plays — wheel, touch, scrollbar or `setScrollY()` — settles it at once.
19. **`docs/components/TreeTable.md`** line 80: the same replacement, with "a node" written "a record" and "`setScrollY()`" written "`getBody().setScrollY()`" (`TreeTable` itself has no `setScrollY`).
20. **`docs/reference/changelog/next.md`**: append, below the intro paragraph:
    ```markdown
    ## Changed

    ### Components

    - **`Tree` and `TreeTable` animate the toggles that used to snap.** A node
      whose children are taller than the viewport now animates the children
      that are on screen while it is open, and a collapse near the end of a
      scrolled list slides the rows above down as the children close, instead
      of jumping. One toggle still snaps: a node scrolled out of view above
      the viewport whose open children reach more than a viewport below it. A
      scroll made while one of these motions plays settles it at once.
    ```
21. **`plans/implemented/tree-expand-collapse-animation.md`**: append one bullet to `## Implementation Notes` (after line 787): "- **Superseded snap rules.** The `[^threshold]` footnote and the *Which toggles animate* rows for a block taller than the viewport and a clamped collapse no longer hold: [`plans/tree-row-motion-no-snap.md`](../tree-row-motion-no-snap.md) replaced both with a trimmed motion and a scroll-driving collapse." (Use the `plans/implemented/` link form once that plan moves there.)
22. **Check**: `grep -rn "would not fit in the current viewport\|moves the scroll offset" packages/lib/docs/components packages/lib/src/typescript/lib/component` — zero matches. `npm run docs:api`; `npm run docs:llms:check` (run `npm run docs:llms` only if it reports a change).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TreeBody.ts` |
| Modify | `packages/lib/tests/component/tree/TreeExpandMotion.test.ts` |
| Modify | `packages/lib/tests/component/table/TreeTableExpandMotion.test.ts` |
| Modify (only if step 14 fails) | `packages/lib/tests/component/table/EditAcrossRowRebind.test.ts` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/components/TreeTable.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/implemented/tree-expand-collapse-animation.md` |

---

## Expected Behaviour

All cases are unit-testable offline with the existing frame-and-clock harness unless marked **manual**. `H = 24` and the viewport is 120 px for `Tree`. "Frame at +n" means `runFrame(start + n)` where `start` is the clock at the toggle. Mid-motion values use `toBeCloseTo`. Content height is the second argument of the last `layoutScrollbars` call (spy, as M2 does).

### `Tree`

- **M9 (rewritten)** `mountSingleBranch(5)`: `expandNode(E)` calls the tween once and the frame at +100 displays c0–c4. `mountSingleBranch(6)`: `expandNode(E)` also calls the tween once (it used to snap); at +100 c0, c1, c2, c3 sit at -24, 0, 24, 48 with opacity 0, 0, 1, 1, c4 and c5 are not displayed, and the content height is 96; after `settle()`, `expectFinalRender` holds and c4 sits at 120.
- **M10 (rewritten)** 20 root leaves then `Z{z1 z2 z3}`, Z expanded and settled, `setScrollY(576)` (lands on 456). `_onToggle(Z)`: the tween is called once. Before any frame: `_flatRows` has 21 rows, the scroll offset is 384 and `expectFinalRender` holds. Frames at +0, +100 and after `settle()` match the end-of-list worked example (scroll offset, Z/z1–z3 positions and opacities, content height 576 / 540 / 504); after the settle no z row is displayed.
- **M16** `mountLongBranch()`, `expandNode(B)` at scroll 0: frames at +0 and +100 and the settle match the tall-block worked example; b3–b19 are not displayed before the settle. A frame at +199 and the settled render put the same node at the same `getTranslateY()` (`toBeCloseTo(y, 0)`, within half a pixel) for every displayed row whose top is inside `[0, 120)`.
- **M17** `mountLongBranch()`, B expanded and settled at scroll 0, then `_onToggle(B)`: before any frame `_flatRows` has 14 rows. Frame at +0: b0, b1, b2, C, D at 48, 72, 96, 120, 144; b0–b2 have `aria-hidden="true"` and `pointer-events: none`; b3–b19 are not displayed; content 816. Frame at +100: 12, 36, 60, 84, 108; content 576. Settled: C at 48, D at 72, content 336, no row has `aria-hidden`.
- **M18** Trimmed and clamped. `mountEndBranch()`, P expanded and settled (30 rows), `setScrollY(168)`, then `_onToggle(P)`: before any frame the offset is 120. Frame at +0: offset 168, P at 216, p0 at 240 and p1 at 264 (both opacity 1), p2–p19 not displayed, content 720. Frame at +100: offset 144, P 216, p0 216 (opacity 0), p1 240 (opacity 1), content 480. Settled: offset 120, P 216, content 240.
- **M19** Retarget keeps the shown rows. M18's setup to the frame at +100 (clock 1100), then `expandNode(P)` at clock 1100: a frame at 1100 still shows offset 144, p0 at 216, p1 at 240 and content 480 (a fresh count would have shown 1 row and moved p0 to 228). Frame at 1200: p0 240, p1 264, offset still 144, content 720; afterwards `expectFinalRender` holds at offset 144.
- **M20** What still snaps. Roots `P{p0..p19}, L0..L29`, collapsed. `setScrollY(48)` then `expandNode(P)`: the tween is not called and `expectFinalRender` holds. On a fresh tree, `setScrollY(24)` then `expandNode(P)`: the tween is called once.
- **M21** Foreign scroll. Each part first asserts the motion is running at +100. (a) `mountLongBranch()`, `expandNode(B)`, frames +0 and +100, then `tree.setScrollY(24)`: the motion is no longer running, the offset is 24, `expectFinalRender` holds, and later frames leave `poolSnapshot` unchanged. (b) M10's setup to the frame at +100, then `tree.setScrollY(400)`: no motion, offset 384, `expectFinalRender` holds. (c) M14 (untrimmed, no clamp) keeps passing unchanged: its motion keeps playing through `setScrollY`.
- **M22** Pool bound. `mountLongBranch()`: `_rowPool.length` is 11 (5 viewport rows + 2 × 2 buffer + 2) after mount, after `expandNode(B)`, after the frames at +0 and +100, and after the settle. An untrimmed motion would have needed 28.
- **Unchanged** M1–M8, M11–M15 and every later case in the file pass as written: the `A B{b1..b3} C D` fixture's block fits and its commit never clamps.

### `TreeTable`

`V = body.getHeight()`, `H = body.getRowHeight()`, `viewportRows = ceil(V / H)`. For `mountBranchWithTail(k, …)`, E is row 0, so `m = min(k, ceil((V - H) / H))`.

- **T7 (rewritten threshold)** `mountSingleBranch(viewportRows)` and `mountSingleBranch(viewportRows + 1)`: `setExpanded(E, true)` calls the tween once for each.
- **T8 (rewritten clamp)** The existing fixture (20 roots, `Z{z1 z2 z3}`), Z expanded and settled, `body.setScrollY(24 * H)`; read `scrollBefore`. `setExpanded(Z, false)`: the tween is called once; before any frame `getFlatRecords()` has 21 entries, the offset is `scrollBefore - 3H` and `expectFinalRender` holds. Frame at +0: offset `scrollBefore`, content `24H`. Frame at +100: offset `scrollBefore - 1.5H`, Z at `20H`, z1 at `19.5H` with opacity 0, content `22.5H`. Settled: offset `scrollBefore - 3H`, content `21H`.
- **T9** Trimmed expand. `mountBranchWithTail(viewportRows + 3, 1)`, `setExpanded(E, true)`: tween called. Frame at +0: F at `H`, content `2H`, children past `m` not displayed. Frame at +100: child `j < m` at `(j + 1)H - 0.5mH`, F at `(m + 1)H - 0.5mH`, content `(k + 2)H - 0.5kH`; F's row has `aria-rowindex` `k + 3` and its stripe is `(k + 1) % 2 === 1`. Settled: `expectFinalRender`, content `(k + 2)H`.
- **T10** Trimmed collapse. Same fixture, E expanded and settled, `setExpanded(E, false)`. Frame at +0: child `j < m` at `(j + 1)H` with `aria-hidden="true"`; children past `m` not displayed; F at `(m + 1)H` with `aria-rowindex` 3. Settled: F at `H`, no row has `aria-hidden`.
- **T11** Foreign scroll. Each part first asserts the motion is running at +100. (a) T9 to the frame at +100, then `body.setScrollY(H)`: settled, `expectFinalRender`. (b) T8 to the frame at +100, then `body.setScrollY(scrollBefore - H)`: settled, offset `scrollBefore - 3H`. (c) `mountBranchWithTail(viewportRows + 3, 1, 600)` (wider than the 300-px table), expand E, frame at +100, then `body.setScrollX(50)`: the motion is still running; a vertical `body.setScrollY(H)` after it settles it.
- **T12** What still snaps. `mountBranchWithTail(viewportRows + 3, 20)`, `body.setScrollY(2H)`, `setExpanded(E, true)`: no tween, `expectFinalRender`. A fresh table with `body.setScrollY(H)`: the tween is called once.
- **T13** Pool bound. Two tables from `mountBranchWithTail(viewportRows + 3, 20)`; expand E on one under a mocked `Animation.isReducedMotion() === true` and record its pool length `P`. On the other, the pool length after the commit, after frames +0 and +100, and after the settle is at most `P`.
- **Unchanged** T1–T6 and every later case in the file pass as written.

### Manual

- **V1 (manual)** Dev app (`npm run dev`, `localhost:8015`): in the left navigator `Tree`, shrink the window until a category's children do not fit, then expand and collapse it — the on-screen children slide in and out with the rows below moving in step; no jump at the start or the end.
- **V2 (manual)** MiscPanel's `Tree` and `TreeTable`: scroll to the very end with the last node expanded, collapse it — the rows above slide down while the list's end stays on the bottom edge; the scrollbar thumb grows smoothly.
- **V3 (manual)** Wheel-scroll during V1's and V2's motions: the motion snaps to its end at once, with no row left misplaced. Wheel-scroll during a small block's motion keeps it playing.

---

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm test` — the whole suite; in particular `tests/component/tree/TreeExpandMotion.test.ts`, `tests/component/table/TreeTableExpandMotion.test.ts`, `tests/component/tree/RenderPassEconomy.test.ts`, `tests/component/table/EditAcrossRowRebind.test.ts`, `tests/component/shared/KeyboardRevealSites.test.ts`, `tests/component/dispose-deferred-work.test.ts`
- `grep -n "blockLength <= viewportRows\|getScrollY() === scrollYBefore" packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` — zero matches
- `grep -rn "would not fit in the current viewport\|moves the scroll offset" packages/lib/docs/components packages/lib/src/typescript/lib/component` — zero matches
- `npm run docs:api`; `npm run docs:llms:check`
- Manual V1–V3

---

## Documentation Impact

- No export changes: `VirtualRowView` is `@internal` and not barrel-exported; every new member is `private` or `protected` on it.
- Pages: `docs/components/Tree.md` (line 99) and `docs/components/TreeTable.md` (line 80), the *Animation* subsections; `docs/reference/changelog/next.md` (new `## Changed` → `### Components` entry). No migration note: nothing a consumer calls changes, and no toggle that animated before stops animating.
- JSDoc: `Tree` class, `TreeBody.setExpanded`. `TreeTable.setExpanded` points at `TreeTable.md` and needs no change.
- `llms.txt`: no class summary changes; step 22's check confirms.

---

## Potential Challenges

- **The commit's scroll clamp emits `verticalscroll` twice more on `TreeTable`.** The body reports the commit's clamped offset, then the restored one on the first frame, then one per frame; the commit's value is never painted. No library code listens to the event; accept.
- **A resize during a trimmed motion** can uncover where the hidden tail belongs, which then changes at the settle. The window is 200 ms; accept.
- **A wheel ease or fling still running when a scroll-bound motion starts** ticks the scroller on its next frame and settles the motion. That is the user scrolling; accept.
- **A trimmed `TreeTable` expand rebinds the window twice more** (first frame and settle), because its motion row list is no longer `_flatRows` itself. A collapse already pays this; accept.
- **Offline frame drivers** that pass `now = 0` against a real clock now leave tall-block toggles and end-of-list collapses at their first frame, where they used to snap. Step 14 covers the one known fixture; step 15 stops on any other.
- **`driveRowMotionScroll`'s first-frame content height and `settleRowMotion` both read `getContentHeight()` as a known value** (the commit's height, or the last frame's). Both hold because nothing renders a started motion before its first frame; keep it that way.

---

## Critical Files

- `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` — every row-motion primitive; `scrollToCommittedY` and `settleRowMotion` are the settle precedent this plan extends.
- `packages/lib/src/typescript/lib/component/container/VirtualScroller.ts` — `setScrollY` (line 264, fires the owner's tick), `setContentHeight` / `getContentHeight` (lines 230–251), `clampToContent` (line 453, clamps without a tick), and the `SmoothScroller` write seam (lines 120–132), the per-frame scroll-writer precedent.
- `packages/lib/src/typescript/lib/layout/CollapseSupport.ts` — `CollapseMover` (line 186) and `animateLayout` (line 381): only moving boxes get frames; every frame is a function of one progress value.
- `packages/lib/src/typescript/lib/component/tree/Tree.ts` — `_reflattenWithMotion`, `_renderedRows`, `onRowMotionRowsChanged`, `renderWindow` (line 2517).
- `packages/lib/src/typescript/lib/component/table/TreeBody.ts` — `setExpanded`, `collapsingMotionRows`, `onRowMotionRowsChanged`, `getRenderedRecords`.
- `packages/lib/src/typescript/lib/component/table/Body.ts` — `onScrollerTick` (line 1138), `renderWindowPass` (line 1278), `computeRowAria` and the stripe write (lines 656, 1566), which read `rowMotionCommittedIndex`.
- `plans/implemented/tree-expand-collapse-animation.md` — the original design, its worked example and its *Implementation Notes*.
- `packages/lib/tests/component/tree/TreeExpandMotion.test.ts` — the harness and helpers the new cases reuse.

---

## Non-Goals

- **Recomputing the shown rows mid-motion** (on a resize or a scroll). A scroll settles a scroll-bound motion instead; a resize is accepted (see *Potential Challenges*).
- **Animating the off-screen-above case.** It needs more than a viewport of rows in the motion.
- **Settling on a horizontal scroll.** The vertical layout does not depend on it.
- **An option to turn trimming or scroll driving off.** Reduced motion stays the only switch, as in the original plan.
- **Changing M14's behaviour** for motions that are neither trimmed nor scroll-driving.

---

## Notes

[^trim]: Three candidates were compared on the `A B{b0..b19} C D` example. *Capping only the hidden height* at `m` rows, with the whole block still in the motion row list, starts C at `(2 + 20 - 3) * 24` instead of 48 — 17 rows below where it was before the expand — so the rows after the block jump at the motion's start, and the hidden tail's rows slide through the viewport. *Keeping the whole block* is today's rule's reason to snap: the block travels 20 rows in 200 ms, and the window must cover 20 rows of overhang, a pool of 28 rows in a 5-row view. *Dropping the hidden tail from the motion row list* makes C follow the shown rows directly, so it starts at 48 and ends at 120, both off screen at the end, and the window's overhang is at most `m` rows. The tail rows are below the viewport when the node is open (by how `m` is counted) and under the toggled row when it is closed, so leaving them out changes nothing anyone can see. Blocks that fit the viewport keep every row, so every existing case, and `TreeTable`'s no-extra-rebind path for an expand, are unchanged; trimming them too would have no visible effect and would cost the `TreeTable` expand two extra rebinds.

[^precedent]: Searched: `CollapseSupport.animateLayout` / `runCollapse` (`Split`, `Border`), `Animation.tween`, `SmoothScroller` and `VirtualScroller`'s fling loop (both write the scroll offset every frame through `VirtualScroller.setScrollY`, whose tick renders), `VirtualScroller.clampToContent` (render passes clamp a shrinking content without a tick; `Body.renderWindowPass` re-emits `verticalscroll` by comparing the offset before and after), and the motion's own `scrollToCommittedY` / `settleRowMotion` (a scroll that would leave rows misplaced settles the motion; the content height is handed over as a delta through `setContentHeight`). Trimming follows the pool's own rule — render only what the window can show — and `CollapseSupport`'s mover filter, which skips a box that ends where it started. Scroll driving follows the fling loop and `SmoothScroller`: write the offset with `setScrollY` and let the tick render. The foreign-scroll settle follows `scrollToCommittedY`. Nothing found handled scroll anchoring for a shrinking list; the interpolation in *An end-of-list collapse drives the scroll offset* is new, and is justified in the scroll-drive footnote.

[^content-height]: Content height must be continuous at both ends: the closed list's height at `r = 0` and the open list's at `r = 1`. Using `(totalRows + k - m) * H - (1 - r) * k * H` gives exactly those, for an expand and a collapse alike. The rendered rows end at `totalRows * H - (1 - r) * m * H`, which is `r * (k - m) * H` short of the content height. That gap only shows when the list's end is inside the viewport, and then it reads as the list's end moving, as in an ordinary expand. A user scroll into it settles the motion (the motion is trimmed, so scroll-bound). Tying the content height to the rendered rows instead would make the scrollbar's extent jump by `(k - m) * H` at the start or the settle.

[^scroll-drive]: Letting each frame's `clampToContent` pull the offset — the obvious alternative — works for a small block but not for a trimmed one. In `mountEndBranch()` (offset 168, `m = 2`, committed maximum 120) the whole-block content height keeps the clamp idle until the reveal drops below 0.1: p0 and p1 retract while blank space opens under P, then the rows above race down 48 px in the motion's final stretch. The interpolated offset keeps the list's end on the viewport's bottom edge on every frame, for any `m`: the view's bottom is `committedEnd + r * (scrollFrom - scrollTo)`, the rendered rows' end is `committedEnd + r * m * H`, and `scrollFrom - scrollTo <= m * H` because the rows after the toggled node are at least zero. The offset is restored on the first frame and not at the commit, because the commit must render the final state at a valid offset (callers and tests read rows right after a toggle) and its content height clamps the old offset away; the first frame runs before paint, so the clamped render is never shown, which is the same argument the original plan made for the final-state render. Only a collapse can clamp (an expand only grows the content), which is why the first-frame content height adds `reveal * blockLength * H` to the committed height.

[^foreign-scroll]: A trimmed motion is correct only for the offset it was planned at: scrolled down, the viewport would reach where the hidden tail belongs, and the rows shown there would change at the settle. A scroll-driving motion writes the offset every frame and would fight the user. Settling at once matches what `scrollToCommittedY` already does for a programmatic scroll. The test compares the vertical offset with the one the motion last rendered against, so a horizontal tick (`Body`'s column scroll) never settles a motion; `_rowMotionScrolling` marks the motion's own `setScrollY`, whose tick fires before the motion can record the new offset. Motions that are neither trimmed nor scroll-driving are correct at any offset, so M14's contract stays.

[^retarget-shown]: A retarget renders from the reveal the old motion reached, so its first frame must place rows where the old motion's last frame did; with a different `m`, every row after the shown rows moves by `(1 - r) * (mOld - mNew) * H`. In `mountEndBranch()` the scroll-driving collapse lowers the offset from 168 to 144 by its midpoint, where a fresh count gives `m = 1`, not 2. The old `m` still covers the new motion: a scroll-driving collapse only lowers the offset (fewer rows to the bottom), a trimmed motion settles on any other scroll, and an untrimmed motion's `m` is the whole block.

[^residual]: `shownLength > viewportRows` can only happen when the toggled row's bottom edge is above the viewport's top. The block's on-screen rows then begin partway into the block, and keeping them continuous means keeping every row from the block's start, more than a viewport's worth: the window's overhang (and so the pool) grows past today's bound of one viewport, and the rows travel more than a screen in 200 ms — the two reasons the original rule existed. A toggled row whose bottom edge is at or below the viewport's top always gives `shownLength <= viewportRows`, so every toggle of a node the user can see or click animates. The case needs a programmatic toggle of a scrolled-away node.

[^committed-index]: During an expand, the motion row list is the committed list without the hidden tail, so a row after the shown rows sits `k - m` places earlier in the motion list than in the committed one. During a collapse, the motion row list is the pre-collapse list without the hidden tail and the committed list has no block at all, so a row after the shown rows sits `m` places later. With `m = k` both reduce to today's map (identity for an expand, `i - k` past the block for a collapse).

[^assign-after]: `_renderedRows` (`Tree`) and `renderedFlatRows` / `getRenderedRecords` (`TreeBody`) read the motion lists only while `isRowMotionRunning()`, which turns true on the first frame. The commit's own render happens inside `commitWithRowMotion`, with the old motion already stopped by `_flatten` / `flatten`, so it reads the committed list either way. The `TreeBody.onRowMotionRowsChanged` call that `stopRowMotion` makes inside the commit still sees the previous motion's lists, as today.

---

## Implementation Notes

- **M16 compares only the rows of the shown block (`A`, `B`, `b0`-`b2`).** At the frame at +199 `C` sits a fraction of a pixel above `120`, which is inside `[0, 120)`; it is below the viewport at the settle, so including it would compare a row that legitimately moves.
- **`EditAcrossRowRebind.test.ts` took the step 14 remedy.** `makeScrollableTreeTable` now expands under a mocked reduced-motion, as the plan prescribed for a failing case.
- **`VirtualRowView.setScrollY` settles a scroll-bound motion before it scrolls (added in audit, M23).** The plan put the foreign-scroll settle only in the scroller's tick (`routeScrollerTick`), but by then `VirtualScroller.setScrollY` has already clamped the target against the motion's content height, which is shorter than the committed one mid-expand; a `setScrollY(696)` during a trimmed expand ended at 456. `setScrollY` now settles first, the order `scrollToCommittedY` already keeps, and renders the settled state itself when the clamp leaves the offset unchanged. Wheel, touch and scrollbar scrolls reach the scroller directly and still settle in its tick. Since every `setScrollY` call now settles before the tick, cases added alongside drive the scroller directly to keep that path covered: M21(b) and T11(d) for a trimmed expand, M21(d) and T11(e) for a scroll-driving collapse, where T11(e) also checks that a horizontal scroll keeps the collapse playing (it fails if the motion stops recording the offset it drove each frame). T11(b) and T11(e) share a `startEndOfListCollapse` helper.
- **A retarget's shown-row count is capped at the new block's length (audit advisory).** `commitWithRowMotion` takes `Math.min(retarget.shownLength, block.blockLength)`. No current path lets a block shrink between two toggles of the same node without a structural stop, so this changes nothing observable today; it keeps `rowMotionRows` from slicing past the block if one ever does.
- **Manual checks V1-V3 were run in Chrome against a dev server serving this worktree, sampling every row's position and opacity per animation frame.** V1: the left navigator at a 7-row view, expanding *Box & Flow Layouts* (8 children, previously a snap) animated over 14 distinct frames, its first child sliding from -120 to 24 and fading in, with every on-screen row meeting the settled render; the following row's last motion position (166) and settled one (216) both lie below the 150 px view. V2: scrolled to the end, collapsing *Showcase* (a clamping collapse, previously a snap) kept the pre-collapse layout on the first frame and slid the rows above down together (*Diagnostics* 54 → 102) with the list's end on the bottom edge. V3: a wheel scroll at ~90 ms into V1's expand settled it on the next frame (no faded row, every visible row on one shared sub-row offset), and the wheel ease then scrolled the settled rows together. The MiscPanel TreeTable's data is too small to show a tall or clamping toggle, so only its ordinary collapse was checked there (it animates); TreeTable's tall and clamping paths rely on T7-T13, which run through the same base code.
