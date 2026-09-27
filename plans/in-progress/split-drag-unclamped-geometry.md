---
depends-on:
  - split-noop-drag-frame-gate
touches-shared:
  - packages/lib/src/typescript/lib/layout/Split.ts
  - packages/lib/tests/component/layout/Split.dragFrameGate.test.ts
  - packages/lib/docs/layouts/Split.md
  - packages/lib/docs/reference/changelog/next.md
  - plans/research/render-review-2026-09-15/00-post-campaign-agenda.md
---

# Split Drag Unclamped Geometry — Implementation Plan

## Overview

One frame of a `Split` gutter drag writes four numbers: the leading pane's main-axis extent, the gutter's main-axis position, and the trailing pane's main-axis position and extent ([`Split.onDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L1447)). Three of those four numbers are derived from a size the leading pane may never have accepted, and one of the three is also derived from a measurement taken when the pointer went down.

The first defect is at [Split.ts:1463](packages/lib/src/typescript/lib/layout/Split.ts#L1463). `dragAmount` is `newLhs - wasLhsMain` — the *requested* travel. `lhs.setWidth(newLhs)` then runs the pane's own clamp, which can commit something else, while the gutter and the trailing pane are moved by the requested amount regardless. Holding a drag past a pane's own maximum therefore opens a 46 px gap between the gutter and the pane edge it divides.

The second defect is at [Split.ts:1453](packages/lib/src/typescript/lib/layout/Split.ts#L1453). `total` — the pair's combined extent, which the drag conserves — is read from `_dragOriginLhsSize + _dragOriginRhsSize`, captured once at the press. A container resize under a live drag re-divides the two panes, and every frame after it hands the trailing pane `total - newLhs` against a `total` that is now too large: the pane commits 296 px inside a 300 px host whose leading pane holds 100.

This plan makes both numbers follow what was committed rather than what was asked for, inside `onDrag`. It touches [layout/Split.ts](packages/lib/src/typescript/lib/layout/Split.ts) only — one private field deleted, one private signature widened by a parameter, one module-private interface field added, and `onDragStart`'s capture and `onDrag`'s write block rewritten. No public API moves. Both defects pre-date the branch that found them, which recorded them without pinning them: `Split.dragFrameGate.test.ts`'s cases D2b, D2c and D2d assert only pass counts and the leading pane's box precisely so a fix would not have to fight a test that had frozen the wrong geometry.[^recorded]

---

## Architecture Decisions

### The pane's own clamp is the truth; the gutter follows the committed edge

`onDrag` writes the leading pane's extent first, re-reads what the pane committed, and derives the gutter's and the trailing pane's writes from that. It does not try to predict the pane's clamp, and it does not move the pane's limits into the `Split`'s own clamp.[^read-back]

The precedent is [`LayoutManager.commitBounds:647`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L647), whose comparison is documented in exactly these terms — the committed rectangle before the write against the committed rectangle after it, "never the request against the box the child already held" — and [`Component.writeBounds:4586`](packages/lib/src/typescript/lib/core/Component.ts#L4586), which returns that comparison. `onDrag` at the stack tip already does one such read-back, for the unmoved-pane gate it added at [:1480](packages/lib/src/typescript/lib/layout/Split.ts#L1480). This plan makes the geometry read the same way the gate already does.

### The pair's combined extent is read live, once per frame

`total` becomes the sum of the two panes' committed main-axis extents, read at the top of each frame instead of at the press. `resolveLhsSize` takes it as a parameter.[^live-total]

The two press-time fields that remain — `_dragOriginPointer` and `_dragOriginLhsSize` — are the pointer-to-size mapping, and they stay press-anchored: `newLhs` is `_dragOriginLhsSize + (position - _dragOriginPointer)`, clamped. That is what makes a drag held past a limit idempotent, so a reversal starts moving at the boundary coordinate rather than immediately. `_dragOriginRhsSize` was only ever half of `total` and is deleted.

An outline drag keeps a press-captured total, in a new `total` field on the module-private `SplitOutlineDrag` interface beside the `bounds` it already reads once.[^outline-total]

### The fix is `onDrag`'s, not the shared commit path's

No shared writer has this defect. [`LayoutManager.commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L601) derives nothing from a requested size, and [`CollapseSupport.commitRect`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L332) is handed a fully resolved rect. `onDrag` is the only writer in the layout package that computes one component's geometry from *another* component's requested size, so it is the only one that can disagree with a clamp.

`Border` has no gutter drag at all — its gutters are built `movable: false` ([`Border.ensureGutter:820`](packages/lib/src/typescript/lib/layout/Border.ts#L820)) and only carry a collapse chevron. `Accordion`'s gutter drag re-reads every open section's live height on every frame ([`readOpenSections:2040`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2040)) and re-places the whole stack, so it has neither a press-time total nor a separate gutter nudge. Neither is in scope.[^siblings]

### The stored pane sizes record what was committed

`_sizes.set(lhs, …)` and `_sizes.set(rhs, …)` take the committed extents, not the requested ones. `_sizes` is what `getPaneSizes()` reports and what a consumer persists through `paneresize`, so a size the pane refused must not reach it.[^stored-sizes]

---

## Internal Structure

### The two defects side by side

Both rows use the scene `Split.dragFrameGate.test.ts` already builds: a 400x300 host with no insets, split horizontally into a leading pane (preferred 100, min 60, max 250) and a trailing pane (preferred 100, min 80, no max). At rest the leading pane holds `{x 0, w 100}`, the gutter `{x 97, w 10}` and the trailing pane `{x 104, w 296}`.

| Frame | lhs asked | lhs commits | gutter `x` | rhs `x` | rhs width | rhs far edge | host inner |
|---|---|---|---|---|---|---|---|
| Past the leading max — today | 296 | 250 | **293** | **300** | 100 | 400 | 400 |
| Past the leading max — fixed | 296 | 250 | 247 | 254 | 100 | 354 | 400 |
| After a mid-drag shrink — today | 200 | 200 | 197 | 204 | **196** | **400** | 300 |
| After a mid-drag shrink — fixed | 200 | 200 | 197 | 204 | 96 | 300 | 300 |

Row 1 is reached by driving the pointer to 400 (the leading pane pins at its 250 maximum), then dropping the trailing pane's maximum to 100, then moving to 500. That inverts `resolveLhsSize`'s clamp bracket and returns a size *above* the leading pane's own maximum.[^inverted] Row 3 is reached by pressing the gutter, shrinking the host to 300 and laying it out (the panes become 100 and 196), then moving to 200.

Two quantities are fixed on every frame of every drag, and both are wrong in row 1:

| Quantity | Value |
|---|---|
| gutter's visual centre − leading pane's committed trailing edge | `2` — half the 4 px divider footprint |
| trailing pane's committed leading edge − leading pane's committed trailing edge | `4` — the divider footprint |

A pane's "committed trailing edge" is `getX() + getTranslateX() + getWidth()` on the x axis. The translate term is not decoration: a pane placed through `commitBounds`' size-stable-move fast path reports its pre-move `getX()` and carries the move on a transform, and a `Split` pane reaches a drag in that state.[^translate]

### The rewritten `onDrag` write block

`onDrag`'s head gains `total` (no new read — it sums the two samples the gate already takes) and passes it to `resolveLhsSize`:

```typescript
        const horizontal = this._orientation === "horizontal";
        // Read before the writes and compared after them, the rule
        // `Component.writeBounds` and `commitBounds` share: a pane's own clamp
        // can move it somewhere other than the size it was handed. These three
        // numbers are the whole of what one frame writes.
        const wasLhsMain = horizontal ? lhs.getWidth() : lhs.getHeight();
        const wasRhsMain = horizontal ? rhs.getWidth() : rhs.getHeight();
        const wasRhsPos  = horizontal ? rhs.getX()     : rhs.getY();
        // The pair's combined extent, which this frame divides between the two
        // panes. Read live rather than captured at the press: the drag's own
        // writes conserve it, so a per-frame read agrees with a press capture on
        // every frame of an ordinary drag and follows the container when a
        // resize under a live drag re-divides the panes.
        const total      = wasLhsMain + wasRhsMain;
        const newLhs     = this.resolveLhsSize(this.pairBounds(lhs, rhs, horizontal), position, total);
```

The write block keeps its single `if (horizontal)` split, and each branch writes the leading pane, re-reads it, and derives the other three writes from that:

```typescript
        let committedLhs: number;

        if (horizontal) {
            lhs.setWidth(newLhs);

            committedLhs = lhs.getWidth();

            const dragAmount = committedLhs - wasLhsMain;

            gutter.setX(gutter.getX() + dragAmount);
            rhs.setX(rhs.getX() + dragAmount);
            rhs.setWidth(total - committedLhs);
        } else {
            lhs.setHeight(newLhs);

            committedLhs = lhs.getHeight();

            const dragAmount = committedLhs - wasLhsMain;

            gutter.setY(gutter.getY() + dragAmount);
            rhs.setY(rhs.getY() + dragAmount);
            rhs.setHeight(total - committedLhs);
        }
```

The tail samples the trailing pane once and uses those two reads for both the stored sizes and the gate:

```typescript
        const nowRhsMain = horizontal ? rhs.getWidth() : rhs.getHeight();
        const nowRhsPos  = horizontal ? rhs.getX()     : rhs.getY();

        this._sizes.set(lhs, committedLhs);
        this._sizes.set(rhs, nowRhsMain);

        this.layoutDraggedPane(lhs, committedLhs !== wasLhsMain);
        this.layoutDraggedPane(rhs, nowRhsMain !== wasRhsMain || nowRhsPos !== wasRhsPos);
```

`total - committedLhs` states the rule the frame implements: the trailing pane takes the span the leading pane did not.[^rhs-expression]

Both position writes stay **relative** — `getX() + dragAmount`, not an absolute coordinate derived from the pane edge. That is deliberate: the gutter's resting offset from the pane edge is `GUTTER_HIT_OVERHANG` for a movable gutter and `0` for a locked one ([`doLayout:2209`](packages/lib/src/typescript/lib/layout/Split.ts#L2209)), and a relative write preserves whichever one `doLayout` established instead of re-deriving it. A relative write is also correct for a pane carrying a translate, where an absolute one would not be.

### `resolveLhsSize` takes the total

```typescript
    private resolveLhsSize(bounds: PairBounds, position: number, total: number): number {
        const offset = position - this._dragOriginPointer;
        const loLhs  = Math.max(bounds.minLhs, total - bounds.maxRhs);
        const hiLhs  = Math.min(bounds.maxLhs, total - bounds.minRhs);

        return Math.max(loLhs, Math.min(hiLhs, this._dragOriginLhsSize + offset));
    }
```

The body's arithmetic is unchanged — including the `Math.max(loLhs, …)` outer bracket, which lets the low bound win when the two cross. That tie-break matches [`Component.clampWidth:4734`](packages/lib/src/typescript/lib/core/Component.ts#L4734), which applies its maximum first and its minimum second for the same reason, and it is not this plan's to change.

### `onDragStart` and `previewDrag`

`onDragStart` replaces the `if (horizontal)` block that seeded the two origin fields with two ternaries, and hands the press-time total to the outline:

```typescript
        this._dragOriginPointer = position;

        const horizontal = this._orientation === "horizontal";

        this._dragOriginLhsSize = horizontal ? lhs.getWidth() : lhs.getHeight();

        // The pair's combined main-axis extent at the press. Only an outline
        // drag keeps it: it writes no pane while the pointer is down, so it
        // replays the same press-once basis its `bounds` already come from.
        const originTotal = this._dragOriginLhsSize + (horizontal ? rhs.getWidth() : rhs.getHeight());

        if (this.getResizeMode() === "outline") {
            const line = gutterOutline(rectOf(gutter), horizontal ? "x" : "y");

            this._outlineDrag = { bounds: this.pairBounds(lhs, rhs, horizontal), total: originTotal, line };
            this._resizeDrag.beginOutline({ parent: DOM.source.getParentNode(gutter.getElement()!)!, start: line, zIndex: IN_PAGE_OUTLINE_Z_INDEX });
        } else {
            this._outlineDrag = null;
            this._resizeDrag.beginLive();
        }
```

`SplitOutlineDrag` ([:154](packages/lib/src/typescript/lib/layout/Split.ts#L154)) gains the field, and `previewDrag` ([:1581](packages/lib/src/typescript/lib/layout/Split.ts#L1581)) passes it:

```typescript
interface SplitOutlineDrag {
    /** The two neighbours' bounds, read once when the drag started. */
    bounds: PairBounds;
    /** The pair's combined main-axis extent, read once when the drag started. */
    total: number;
    /** The outline's box at the press. */
    line: OutlineRect;
}
```

```typescript
        const travel = this.resolveLhsSize(outline.bounds, frame.position, outline.total) - this._dragOriginLhsSize;
```

---

## Ordered Implementation Steps

Steps 1–4 are one edit to one file and must land together: `noUnusedLocals` is on for the library build ([`packages/lib/tsconfig.json:9`](packages/lib/tsconfig.json#L9)), so deleting `_dragOriginRhsSize` without widening `resolveLhsSize`, or widening it without updating both callers, fails `npm run typecheck`.

1. **[`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — add `total` to `SplitOutlineDrag` and delete `_dragOriginRhsSize`.** Add the documented `total: number` field to the interface at [:154-160](packages/lib/src/typescript/lib/layout/Split.ts#L154), between `bounds` and `line`. Delete the `_dragOriginRhsSize` field at [:213](packages/lib/src/typescript/lib/layout/Split.ts#L213).

2. **Same file — rewrite `onDragStart`'s capture block** ([:1387-1397](packages/lib/src/typescript/lib/layout/Split.ts#L1387)) and its outline branch ([:1402](packages/lib/src/typescript/lib/layout/Split.ts#L1402)) exactly as *`onDragStart` and `previewDrag`* shows. The `if (horizontal) { … } else { … }` block that assigned the two origin fields is replaced by the two ternaries plus `originTotal`.

3. **Same file — widen `resolveLhsSize`** ([:1556](packages/lib/src/typescript/lib/layout/Split.ts#L1556)) to `(bounds: PairBounds, position: number, total: number)`, delete its own `const total` line ([:1557](packages/lib/src/typescript/lib/layout/Split.ts#L1557)), and document the new parameter as: the pair's combined main-axis extent to divide — read live by a live frame, and captured at the press by an outline preview. Leave the three arithmetic lines alone. Update `previewDrag`'s call at [:1581](packages/lib/src/typescript/lib/layout/Split.ts#L1581) to pass `outline.total`.

4. **Same file — rewrite `onDrag`'s body** ([:1448-1486](packages/lib/src/typescript/lib/layout/Split.ts#L1448)) exactly as *The rewritten `onDrag` write block* shows: `total` added to the `const` block (keeping the block's `=` alignment), `dragAmount` moved inside each branch of the existing `if (horizontal)`, `committedLhs` declared before it, `rhs`'s extent written as `total - committedLhs`, and the tail rebuilt around `nowRhsMain` / `nowRhsPos`. `layoutDraggedPane` and `pairBounds` are not touched.

   Check: `npm run typecheck && npm run lint`, then `grep -n '_dragOriginRhsSize' packages/lib/src/typescript/lib/layout/Split.ts` — expect zero matches, and `grep -c 'dragAmount' packages/lib/src/typescript/lib/layout/Split.ts` — expect 6, three lines in each branch of `onDrag`'s `if (horizontal)`.

5. **Same file — correct `onDrag`'s public `@remarks`** ([:1418-1445](packages/lib/src/typescript/lib/layout/Split.ts#L1418)). Two changes to the existing prose. First paragraph: "computed from the drag origin captured in `onDragStart`" becomes the drag origin for the pointer travel and the panes' own live combined extent for the room that travel is clamped into, so a container resize under a live drag is followed rather than overflowed. Add one short paragraph after it: the gutter's and the trailing pane's writes are derived from the extent the leading pane actually committed, never from the size it was handed, so a frame the pane's own clamp refuses moves neither. Describe the clamp in prose — do not add a `{@link}` to `clampWidth`, which is `protected` and excluded from the docs build. Check: `npm run docs:api` reports no new warnings.

6. **Create [`packages/lib/tests/component/layout/Split.dragGeometry.test.ts`](packages/lib/tests/component/layout/Split.dragGeometry.test.ts).** Cover U1–U7, C1–C5 and S1 from *Expected Behaviour*. Copy the harness from [`Split.dragFrameGate.test.ts:18-213`](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts#L18) — the `installTestDOM` config, the constants, the `requestAnimationFrame` capture, the `afterEach` teardown, `scene()`, `verticalScene()`, `passes()`, `press()`, `pressDown()`, `move()`, `moveDown()` and `drive()` — and add:
   - `spacing: 4` on every `Split` this file constructs **if and only if** `split-gutter-zero-thickness-gap` has already landed and `SplitOptions` carries a `spacing` field; on the tree this plan is written against there is no such option and nothing to pass;
   - a **third, trailing** `resizeMode?: ResizeMode` parameter on `scene()` — after its two existing pane builders, so no existing call changes — forwarded to the `Split` constructor the way [`Split.resizeMode.test.ts:123`](packages/lib/tests/component/layout/Split.resizeMode.test.ts#L123)'s own `scene` forwards its mode. C5 is the only case that passes it;
   - `unconstrainedScene()`, a copy of `scene()` whose panes are bare `new Component()` with no `preferredSize` and no `setMinSize` / `setMaxSize` calls. Keep the `weighted(0)` / `weighted(1)` constraints `scene()` adds them with: the two panes then divide the pane room equally on the first pass, which is the rest state U5 and U6 assert from;
   - the four probes in *Expected Behaviour → Probes*;
   - `translateScene()`, the three-pane fixture U7 needs.

   Check: `npm test`.

7. **[`packages/lib/tests/component/layout/Split.dragFrameGate.test.ts`](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts) — three edits, all consequences of the fix.**
   - **D2b** ([:470](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts#L470)) expects `[0, 1]`; the fixed frame moves nothing at all, so it becomes `[0, 0]`. Rewrite its title as *lays out neither pane on a frame that a mid-drag resize left with nothing to move*, and replace its inline comment: back at the press coordinate after the host shrank, the leading pane is asked for the width it holds and the trailing pane for the width it holds, so neither moves. Keep its `box(scn.lhs)` assertion.
   - **D2c** ([:488](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts#L488)) still passes with `[1, 1]`, but its comment claims 200 is "the one travel for which the stale total asks the trailing pane for the 196 px it already holds". With the live total the trailing pane's extent moves too, so replace that sentence: the frame moves the leading pane by 100, and the trailing pane's position and extent both follow.
   - **The shared comment block above D2b** ([:453-468](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts#L453)) and **D2d's closing comment** ([:528-533](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts#L528)) both describe the two defects as pre-existing and out of scope. Replace both with one sentence each: the geometry these frames produce is now pinned by `Split.dragGeometry.test.ts`, and these cases keep asserting the pass counts, which are this gate's own contract. Do not add geometry assertions here.

   Check: `npm test`.

8. **Documentation.** The two edits in *Documentation Impact*, in order. Check: `npm run docs:llms:check`.

9. **[`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L1534) — close the candidate.** The bullet beginning *Two pre-existing `Split.onDrag` defects surfaced while proving that* ends "One candidate covering both, unplanned." Replace that last sentence with a pointer to this plan and one clause each on what it fixed: the gutter and the trailing pane now follow the leading pane's committed edge, and the pair's combined extent is read live. Touch no other bullet and no other plan file.

10. **Full gate.** `npm test && npm run lint && npm run build:lib && npm run docs:api`. Then `grep -n 'newLhs' packages/lib/src/typescript/lib/layout/Split.ts` — expect exactly three matches, all inside `onDrag` and `resolveLhsSize`, and none of them on a `gutter.set`, `rhs.set` or `_sizes.set` line.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` — **shared** with `split-gutter-zero-thickness-gap` |
| Create | `packages/lib/tests/component/layout/Split.dragGeometry.test.ts` |
| Modify | `packages/lib/tests/component/layout/Split.dragFrameGate.test.ts` |
| Modify | `packages/lib/docs/layouts/Split.md` — **shared** with `split-gutter-zero-thickness-gap` |
| Modify | `packages/lib/docs/reference/changelog/next.md` — **shared** with every plan landing in this release |
| Modify | `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` |

[`plans/split-gutter-zero-thickness-gap.md`](plans/split-gutter-zero-thickness-gap.md) is being drafted in parallel and edits the same class. It owns gutter construction, reserve and paint: it deletes `GUTTER_SIZE`, raises `GUTTER_HIT_OVERHANG` to 5, and turns the space between panes into a `spacing` option defaulting to `0`, so the gutter element stays 10 px on the main axis but reserves nothing and straddles the pane boundary. This plan owns the drag path — `onDragStart`, `onDrag`, `resolveLhsSize` and `previewDrag` — and that plan's own `## Non-Goals` assigns them here by name. Neither plan's edits to `layout/Split.ts` touch the other's lines. **The gutter element's 10 px main-axis size is settled by that plan and this one does not change it**, nor `GUTTER_SIZE`, nor `GUTTER_HIT_OVERHANG`, nor the reserve between panes.

**Landing order changes two literals and nothing else.** Every expected value in *Expected Behaviour* is stated for the tree this plan is written against, where the reserve between panes is a fixed 4 px and a movable gutter's element overhangs it by 3 px on each side. Those two numbers are what make the rest offset `2` and the rest gap `4`. If `split-gutter-zero-thickness-gap` lands first, the fixture must pass `spacing: 4` to `scene()` so the reserve is 4 px again and every number in this plan holds unchanged — see *Expected Behaviour → Probes*. Whichever plan lands second rebases over the other.

---

## Expected Behaviour

Every case is unit-testable in `Split.dragGeometry.test.ts`. Nothing here needs a real pointer: the drag runs through the gutter's own `onDragStart` / `onDrag` / `onDragStop` handlers, the path `scheduleDrag` sits on, exactly as `Split.dragFrameGate.test.ts` already drives it. One manual check is owed and is listed in *Verification*.

### Probes

Four helpers, each reading a quantity rather than a box, so a case names the rule it is pinning:

- `leadingEdge(scn, horizontal)` — `lhs.getX() + lhs.getTranslateX() + lhs.getWidth()`, or the `y` / height pair. The translate fold-in mirrors [`Split.resizeMode.test.ts:41`](packages/lib/tests/component/layout/Split.resizeMode.test.ts#L41)'s `visualBox` and [`CollapseSupport.captureRect:212`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L212).
- `gutterOffset(scn, horizontal)` — the gutter's visual centre (`getX() + getWidth() / 2`) minus `leadingEdge`. Expected `2` on every frame. The centre-of-the-gap idiom is [`Split.gutterHitBox.test.ts:59`](packages/lib/tests/component/layout/Split.gutterHitBox.test.ts#L59)'s.
- `dividerGap(scn, horizontal)` — the trailing pane's committed leading edge (translate folded in) minus `leadingEdge`. Expected `4` on every frame.
- `trailingEnd(scn, horizontal)` — the trailing pane's committed far edge.

Assert the literals, not just the relations: `2`, `4` and a real coordinate are all non-zero, so no case can be satisfied by two zeroes.

**The fixture's divider gap must be non-zero, or `gutterOffset` and `dividerGap` both become `0 === 0`.** On the tree this plan is written against it is non-zero automatically: `GUTTER_SIZE` is a fixed 4 px. If `split-gutter-zero-thickness-gap` has landed, `Split`'s reserve is the `spacing` option and defaults to `0`, so **every scene in this file must pass `spacing: 4`** — which restores today's geometry exactly, leaving `gutterOffset` `2`, `dividerGap` `4` and every coordinate below unchanged.

### The gutter stays on the pane edge

**U1. Horizontal, held past the leading pane's own maximum.** On `scene()`: `drive([400])` pins the leading pane at 250 with the gutter at 247 and the trailing pane at `{254, 146}`; then `rhs.setMaxSize({ width: 100, height: UNBOUND_HEIGHT })`; then `move(500)`. After that frame the leading pane's box is `{0, 0, 250, 300}`, `gutter.getX()` is `247`, the trailing pane's box is `{254, 0, 100, 300}`, `gutterOffset` is `2`, `dividerGap` is `4` and `trailingEnd` is `354`.
*Catches:* `dragAmount` taken from `newLhs` instead of the committed extent. Today that frame writes the gutter to 293 and the trailing pane to `{300, 100}`, giving `gutterOffset` 48 and `dividerGap` 50.

**U2. Vertical, the same frame on the y axis.** On `verticalScene()` — whose main-axis figures match the horizontal scene's by construction — press with `pressDown`, `moveDown(400)`, drop the trailing maximum to `{ width: UNBOUND_HEIGHT, height: 100 }`, `moveDown(500)`. The leading pane's box is `{0, 0, 300, 250}`, `gutter.getY()` is `247`, the trailing pane's box is `{0, 254, 300, 100}`, `gutterOffset` is `2`, `dividerGap` is `4`, `trailingEnd` is `354`.
*Catches:* the fix applied to `onDrag`'s horizontal branch only — the mutation shape the frame-gate audit already found four instances of in this method.

**U3. Horizontal, held past the leading pane's own minimum.** On `scene()`: `drive([-500])`. The leading pane's box is `{0, 0, 60, 300}`, `gutter.getX()` is `57`, the trailing pane's box is `{64, 0, 336, 300}`, `gutterOffset` `2`, `dividerGap` `4`, `trailingEnd` `400`.
*Catches:* a regression, not the defect. This arm is already correct today, because `resolveLhsSize`'s low bound never returns a size below the leading pane's own minimum. The case fails if the rewritten write block drops the trailing pane's position write, mis-signs `dragAmount`, or re-derives the gutter's position absolutely with the wrong overhang.

**U4. Vertical, held past the leading pane's own minimum.** `verticalScene()`, `pressDown`, `moveDown(-500)`. Leading pane `{0, 0, 300, 60}`, `gutter.getY()` `57`, trailing pane `{0, 64, 300, 336}`, `gutterOffset` `2`, `dividerGap` `4`, `trailingEnd` `400`.
*Catches:* the same mutations as U3 on the vertical arm.

**U5. Panes with no explicit min or max, driven past the far end of the pair.** On `unconstrainedScene()` the two panes divide the 396 px of pane room equally, so at rest the leading pane is `{0, 198}`, the gutter `{195, 10}` and the trailing pane `{202, 198}`. `drive([900])`: the leading pane's box is `{0, 0, 396, 300}`, `gutter.getX()` is `393`, the trailing pane's box is `{400, 0, 0, 300}`, `gutterOffset` `2`, `dividerGap` `4`, `trailingEnd` `400`.
*Catches:* a regression. A fixture whose panes carry no limits cannot reach either defect — nothing clamps and the live total equals the press total — so this case exists to prove the rewrite leaves the unconstrained drag alone, including at a zero-width trailing pane.

**U6. The same fixture driven past the near end.** `drive([-800])`: leading pane `{0, 0, 0, 300}`, `gutter.getX()` `-3` (negative, and correct — the gutter's hit box overhangs the container edge), trailing pane `{4, 0, 396, 300}`, `gutterOffset` `2`, `dividerGap` `4`.
*Catches:* the same as U5, at a zero-width leading pane.

**U7. A pane that entered the drag carrying a translate.** `translateScene()`: a 308x200 host with no insets and three bare `Component` panes, which divide the 300 px of pane room into 100 each. Then `setPaneSize(panes[0], 140)`, `setPaneSize(panes[2], 60)` and one `doLayout()`: the middle pane keeps its 100 px width while its slot moves, so `commitBounds` takes its size-stable-move fast path and the pane reports `getX()` 104 with `getTranslateX()` 40, while `gutter[1]` sits at 241. Give the middle pane `maxSize.width` 100 and the last pane `maxSize.width` 20, press `gutter[1]` at 245 and move to 300. After the frame the middle pane still reports `{x 104, tx 40, w 100}`, `gutter[1].getX()` is `241`, the last pane is `{248, 20}`, `gutterOffset` is `2` and `dividerGap` is `4`.
*Catches:* the same requested-travel delta U1 does (today: gutter 281, last pane `{288, 20}`, `gutterOffset` 42, `dividerGap` 44) **and** any reformulation of the gutter write as an absolute coordinate derived from `getX() + getWidth()` without the translate, which would land 40 px out. This case is what licenses *Non-Goals*' exclusion of the `setX` translate defect.

### The trailing pane stays inside its host

**C1. A frame that a mid-drag shrink left with nothing to move.** On `scene(skippablePane, skippablePane)`: `press`, then `host.setWidth(300)` and `host.doLayout()` — the panes become `{0, 100}` and `{104, 196}` — then `move(PRESS_X)`. Both panes' boxes are unchanged — leading `{0, 0, 100, 300}`, trailing `{104, 0, 196, 300}` — `trailingEnd` is `300`, and `passes()` reads `[0, 0]`.
*Catches:* the press-time total. Today that frame hands the trailing pane 296 and commits `trailingEnd` 400 inside a 300 px host, and lays the trailing pane out for it.

**C2. A moving frame after a mid-drag shrink.** The same setup, then `move(200)`. The leading pane is `{0, 0, 200, 300}`, `gutter.getX()` is `197`, the trailing pane is `{204, 0, 96, 300}`, `gutterOffset` `2`, `dividerGap` `4`, `trailingEnd` `300`.
*Catches:* the press-time total on a frame that does move (today the trailing pane commits 196 and overruns to 400), and the gutter invariants on the same frame.

**C3. The same shrink on a vertical split.** `verticalScene(skippablePane, skippablePane)`, `pressDown`, `host.setHeight(300)`, `host.doLayout()`, `moveDown(200)`. Leading pane `{0, 0, 300, 200}`, `gutter.getY()` `197`, trailing pane `{0, 204, 300, 96}`, `trailingEnd` `300`.
*Catches:* the live total read through one orientation arm only.

**C4. The release frame.** The C2 setup, but issue `scn.gutter.onDrag({ clientX: 200 })` **without** draining a frame, then `scn.gutter.onDragStop()`. The committed geometry is C2's, and `trailingEnd` is `300`.
*Catches:* the live total computed somewhere the release does not pass through. `ResizeDrag.end()` force-flushes the freshest buffered move ([`ResizeDrag:354`](packages/lib/src/typescript/lib/core/ResizeDrag.ts#L354)), so a total read in `scheduleDrag` or in the session's `apply` wrapper rather than in `onDrag` would leave the last frame of every drag on the stale value — which is the frame the user is left looking at.

**C5. An outline release after a mid-drag shrink.** `scene(skippablePane, skippablePane, 'outline')`, then `press`, `host.setWidth(300)`, `host.doLayout()`, `onDrag({ clientX: 200 })`, drain a frame (the outline line moves, the panes do not), then `onDragStop()`. With the frame already drained, `end()` has nothing buffered to flush and runs the previewed move once through its `commit` hook ([`Split.ts:229`](packages/lib/src/typescript/lib/layout/Split.ts#L229)), so exactly one `onDrag` lands. The panes finish on C2's geometry and `trailingEnd` is `300`.
*Catches:* an `onDrag` that prefers `_outlineDrag.total` over the live read when an outline drag is in flight — the natural over-reach once `SplitOutlineDrag.total` exists, and the one that would leave an outline release on the stale `trailingEnd` 400 inside a 300 px host. This is also the only case covering an outline drag's released geometry after a mid-drag resize, which is the geometry the user is left looking at in that mode.

### The stored sizes

**S1. A refused size never reaches `_sizes`.** After U1's final frame, `getPaneSize(lhs)` is `250` and `getPaneSize(rhs)` is `100`.
*Catches:* `_sizes.set(lhs, newLhs)` and `_sizes.set(rhs, total - committedLhs)` written without the read-back. Today the same frame stores 296 for the leading pane — a width it refused — which `getPaneSizes()` would then report through `paneresize` for a consumer to persist. No geometry assertion in U1 catches this, because `_sizes` is not read again until the next `doLayout`.

---

## Verification

1. `npm run typecheck && npm run lint` from the worktree root.
2. `npm test` from the worktree root — never with a bare `--root`, which makes `llms-generate.test.ts`'s `resolveDoc` resolve against the wrong cwd and report bogus failures. The baseline on the branch point is **518 files, 8708 passed, 2 todo, zero failures**; after this plan it reads **519 files, 8721 passed, 2 todo** — the new file's 13 cases, with `Split.dragFrameGate.test.ts` keeping all 14 of its own.
3. `grep -n '_dragOriginRhsSize' packages/lib/src/typescript/lib/layout/Split.ts` — zero matches.
4. `grep -n 'newLhs' packages/lib/src/typescript/lib/layout/Split.ts` — three matches, none on a line that writes the gutter, the trailing pane, or `_sizes`.
5. `npm run build:lib && npm run docs:api` — no new warnings. `npm run docs:llms:check`.
6. **Manual, owed: one real drag.** In the demo app or Loom, drag a `Split` gutter past a pane's minimum and past a pane's maximum, in both orientations, and hold. Expect the gutter to stay glued to the pane edge for the whole hold and to start moving again at the boundary coordinate on reversal, with no gap opening between the gutter and either pane. Then, with a drag held, resize the window: expect the trailing pane to stay inside the window rather than sliding out past its edge. **Do not run this as part of implementing the plan without asking** — every route to it opens a window on the user's desktop.

---

## Documentation Impact

No public API changes: the deleted field, the widened signature and the new interface field are all private or module-private, so no catalog or sidebar entry moves and no cross-reference form changes. Two doc edits.

1. **[`packages/lib/docs/layouts/Split.md`](packages/lib/docs/layouts/Split.md#L188), `## Live or outline resizing`.** After the sentence about a frame that can move neither pane, add one sentence: a pane held against its own minimum or maximum keeps the gutter on its edge — the gutter follows the extent the pane committed, not the travel the pointer asked for — and a window resize under a live drag re-divides the pair rather than pushing the trailing pane out of the container.
2. **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L1696), `## Fixed` → `### Layouts`.** One entry, at the top of that section: a `Split` gutter dragged past a pane's own size limit no longer detaches from the pane edge it divides, and a container resized under a live drag no longer leaves the trailing pane committed wider than its host. Say that the gutter and the trailing pane are now placed from the extent the leading pane committed, and that the pair's combined extent is read per frame instead of at the press. Mention that `getPaneSizes()` now reports the committed extent rather than the requested one on a frame a pane's clamp refused.

The `@remarks` edit in step 5 is public JSDoc, so per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) it describes the clamp in prose rather than linking `clampWidth`, which is `protected` and excluded from the docs build.

---

## Potential Challenges

- **`Split.dragFrameGate.test.ts`'s D2b turns red without step 7.** Its `[0, 1]` expectation exists because the stale total was the only thing that could move the trailing pane's extent on a frame that moved nothing else. Step 7 changes the number and the reason, and does not weaken the case.
- **No case can isolate `rhsMoved`'s position term any more, and that is not a defect.** With a live total the trailing pane's requested extent is `wasRhsMain - dragAmount`, so its position and extent move together on every reachable frame; D2d remains an extent-only witness (its position is unchanged and its clamp cuts its extent), but the position-only witness D2c used to be is gone. Leave `rhsMoved` as the full read-back anyway — it mirrors `commitBounds`' own six-field comparison, and a term that is currently redundant is cheaper than a gate that silently stops working if the coupling ever breaks.
- **An over-constrained pair leaves a gap at the trailing edge, and must.** In U1 the leading pane can hold at most 250 and the trailing at most 100, against a 396 px pair — geometry cannot fill it, so `trailingEnd` lands at 354 with 46 px bare. That is the honest outcome of a frame, and the next full `doLayout` redistributes across every pane. Assert `354`; do not add a floor that hides it.
- **A container resize whose layout pass has not landed yet still overflows for one frame.** The live total is read off the panes, so it only becomes correct once `Split.doLayout` has re-divided them. A drag frame that beats the pending layout pass writes geometry consistent with the old container. That is one frame, and it is the same exposure any unlaid-out state has; a press-time capture never recovers at all.
- **Landing after `split-gutter-zero-thickness-gap` needs `spacing: 4` on every scene.** That plan makes the reserve between panes default to `0`, which would turn this file's two invariant assertions into `0 === 0` — the vacuous shape this plan's whole case list is built to avoid. One constructor argument per scene restores the geometry every number here is stated for. Keeping both position writes relative means the rewritten `onDrag` itself needs no change under either order.
- **`getWidth()` and `getX()` can report the "never assigned" `NaN` sentinel.** `total` and `dragAmount` then read `NaN`, every comparison is false, and both panes are laid out — the conservative direction, and the same reasoning the frame gate already rests on. No special case.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `SplitOutlineDrag` ([:154](packages/lib/src/typescript/lib/layout/Split.ts#L154)), the origin fields ([:211](packages/lib/src/typescript/lib/layout/Split.ts#L211)), the `_resizeDrag` hooks ([:224](packages/lib/src/typescript/lib/layout/Split.ts#L224)), `paneMinSize` / `paneMaxSize` ([:753](packages/lib/src/typescript/lib/layout/Split.ts#L753), [:768](packages/lib/src/typescript/lib/layout/Split.ts#L768)), `onDragStart` ([:1382](packages/lib/src/typescript/lib/layout/Split.ts#L1382)), `onDrag` ([:1447](packages/lib/src/typescript/lib/layout/Split.ts#L1447)), `layoutDraggedPane` ([:1508](packages/lib/src/typescript/lib/layout/Split.ts#L1508)), `pairBounds` ([:1529](packages/lib/src/typescript/lib/layout/Split.ts#L1529)), `resolveLhsSize` ([:1556](packages/lib/src/typescript/lib/layout/Split.ts#L1556)), `previewDrag` ([:1574](packages/lib/src/typescript/lib/layout/Split.ts#L1574)), `doLayout`'s gutter placement and its overhang ([:2209](packages/lib/src/typescript/lib/layout/Split.ts#L2209)), and `GUTTER_SIZE` / `GUTTER_HIT_OVERHANG` ([:31](packages/lib/src/typescript/lib/layout/Split.ts#L31), [:37](packages/lib/src/typescript/lib/layout/Split.ts#L37)).
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) — **the precedent**: `commitBounds` ([:601](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L601)), its size-stable-move fast path ([:624](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L624)) and its committed-before-against-committed-after comparison and comment ([:641-652](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L641)).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `setWidth` ([:4623](packages/lib/src/typescript/lib/core/Component.ts#L4623)), `clampWidth` and its maximum-then-minimum order ([:4734](packages/lib/src/typescript/lib/core/Component.ts#L4734)), `clampsToContentSize` ([:4662](packages/lib/src/typescript/lib/core/Component.ts#L4662)), `setContentClampSuspended` ([:4688](packages/lib/src/typescript/lib/core/Component.ts#L4688)), `writeBounds` ([:4586](packages/lib/src/typescript/lib/core/Component.ts#L4586)), `setX` ([:4848](packages/lib/src/typescript/lib/core/Component.ts#L4848)) and `getTranslateX` ([:5210](packages/lib/src/typescript/lib/core/Component.ts#L5210)).
- [`packages/lib/src/typescript/lib/layout/CollapseSupport.ts`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts) — `captureRect` ([:212](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L212)) and `commitRect` ([:332](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L332)), the library's read and write forms for a component that may carry a translate.
- [`packages/lib/src/typescript/lib/core/ResizeDrag.ts`](packages/lib/src/typescript/lib/core/ResizeDrag.ts#L347) — `end()`, which force-flushes the buffered move and then commits the previewed one, so the release runs `onDrag`.
- [`ARCHITECTURE.md`](ARCHITECTURE.md#L122) — *Size constraints: who is responsible for what*, rule 6's consequence: a manager assigns the available space capped to the child's maximum and **leaves the minimum to the child's own clamp**.
- [`packages/lib/tests/component/layout/Split.dragFrameGate.test.ts`](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts) — the harness to copy ([:18-213](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts#L18)), its `box` helper ([:155](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts#L155)), and the three cases step 7 edits.
- [`packages/lib/tests/component/layout/Split.gutterHitBox.test.ts`](packages/lib/tests/component/layout/Split.gutterHitBox.test.ts#L59) — the gutter-centred-on-the-pane-boundary idiom the probes reuse.
- [`plans/implemented/split-noop-drag-frame-gate.md`](plans/implemented/split-noop-drag-frame-gate.md) — `## Implementation Notes`, which records both defects and why its own cases stop short of asserting them.

---

## Non-Goals

- **The gutter element's size, the reserve between panes, and the gutter's paint.** `plans/split-gutter-zero-thickness-gap.md` owns all three. `GUTTER_SIZE`, `GUTTER_HIT_OVERHANG` and the gutter's element size are unchanged here, and every position this plan writes is a relative delta, so the rewritten `onDrag` reads neither constant.
- **Making `Component.setX` / `setY` clear a leftover translate.** That is a third, separate defect, and it belongs to `Component`, not to `Split`.[^translate]
- **`Split.doLayout`'s own requested-against-committed accumulation.** `doLayout` advances its cursor by the size it hands each pane ([:2184](packages/lib/src/typescript/lib/layout/Split.ts#L2184)), so a pane whose clamp refuses that size leaves the same kind of gap. It is a third site for the same class of bug, in the sizing pass rather than the drag path, with its own pre-clamp (`clampMain`) already in front of it. Neither reported defect names it.
- **`layoutDraggedPane`'s unmoved-pane gate.** Unchanged. The fix does not change what "moved" means — it stays the committed-box read-back the gate already used — it only changes which geometry the frame writes. See *Potential Challenges* for what that does to the gate's case coverage.
- **The outline drag's press-once `bounds`.** An outline preview replays the pair's bounds from the press, so a mid-drag change to a pane's limits moves the released geometry without moving the line. Pre-existing, unchanged, and separate from the total.
- **`Border` and `Accordion`.** Neither has either defect.[^siblings]

---

## Notes

[^recorded]: Both defects were found while proving case D2d of `plans/implemented/split-noop-drag-frame-gate.md`, and its `## Implementation Notes` records them: "on the inverted-bracket frame `onDrag` moves the gutter and the trailing pane by the *unclamped* `dragAmount` while the leading pane's own clamp holds it back, so the gutter ends up detached from the pane edge it divides (gutter x 293 against a leading pane ending at 250)", and, for the trailing pane, "both frames commit it wider than the shrunken host and overflow it". That plan's D2b, D2c and D2d therefore "deliberately assert only pass counts and the leading pane's box so neither bug is pinned as expected output". `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` records the pair as "One candidate covering both, unplanned."

[^read-back]: The rival option was to move the panes' own limits into the `Split`'s clamp, so that `resolveLhsSize` could never return a size a pane would refuse and only one clamp would exist. It was rejected for two reasons. The first is that the `Split` cannot compute the pane's answer. `Component.clampWidth` applies the *merged* minimum and maximum for a general component and only the *explicit* constraints for a `Container` or `Panel` ([`Component.ts:4734`](packages/lib/src/typescript/lib/core/Component.ts#L4734)), switched by the protected `clampsToContentSize()` and suspendable through `setContentClampSuspended` — a policy a layout manager cannot read without duplicating a branch it does not own. `pairBounds` reads `getMinSize` / `getMaxSize` through `paneMinSize` / `paneMaxSize`, which additionally substitute the collapse snapshot for an undisplayed pane, so the two have two independent reasons to disagree. The second is that [`ARCHITECTURE.md:122`](ARCHITECTURE.md#L122) forbids it in as many words: a manager "assigns the available space, capped to the child's maximum, and leaves the minimum to the child's own clamp". The codebase does hoist a child's limit into a manager's own arithmetic elsewhere — [`Border.flooredMainExtent:862`](packages/lib/src/typescript/lib/layout/Border.ts#L862) floors a region's reserved extent at the region's own minimum, mirroring `VBox.preferredChildHeight` / `HBox.preferredChildWidth` — but those are *sizing* decisions taken before anything is written, where there is no committed box to read. `onDrag`'s gutter position is derived from a write that already happened, so the committed box exists and is the cheaper and more accurate source.

[^inverted]: `resolveLhsSize` clamps into `[loLhs, hiLhs]` as `Math.max(loLhs, Math.min(hiLhs, …))`, where `loLhs = max(minLhs, total - maxRhs)` and `hiLhs = min(maxLhs, total - minRhs)`. When the bracket inverts — `loLhs` passing `hiLhs`, which happens as soon as `total` exceeds `maxLhs + maxRhs` — the low bound wins and the returned size sits *above* the leading pane's own maximum. U1's numbers: `total` 396, `maxRhs` 100, so `loLhs` is 296 while `hiLhs` is 250; the pane is handed 296, its own `setWidth` clamps it to 250, and the requested travel reads 46 for a pane that moved nowhere. A drag past a pane's *minimum* does not produce this: `loLhs` is never below `minLhs`, so the leading pane never clamps upward. A first reading of this area guessed the trigger was a grown `minSize`; it is the inverted bracket, and only on the maximum side.

[^live-total]: The alternative was to re-capture the press-time state when the container resizes. It was rejected because a re-capture has to rebase `_dragOriginPointer` and `_dragOriginLhsSize` together at whatever position the pointer happens to hold, and doing that while the drag is parked past a limit destroys the idempotence those two fields exist for: the reversal would start moving immediately instead of at the boundary coordinate. Reading the total live costs nothing and needs no resize hook. It is also self-consistent: under this plan's writes the pair's far edge is `lhs.getX() + total + GUTTER_SIZE` on every frame, independent of the frame, so a per-frame read of `lhs.getWidth() + rhs.getWidth()` returns the same number a press capture would for every frame of an ordinary drag, and returns the *right* number after a resize has re-divided the panes. Where a pane's own clamp does cut its extent, the live total shrinks by that amount and the bracket narrows with it — which is correct, because the pair really does have less room — while `_dragOriginLhsSize + offset` stays anchored to the press, so the pointer mapping does not drift. And the two reads are free: `onDrag` already samples both panes' extents for the unmoved-pane gate, so `total` is a sum of values it holds.

[^outline-total]: An outline drag writes no pane while the pointer is down, so its live total and its press total are the same number on every frame of an ordinary drag; the field only matters after a container resize mid-drag. Keeping it press-captured pairs it with `SplitOutlineDrag.bounds`, which `onDragStart` already reads once by design, so the preview replays one consistent basis rather than mixing a live total with stale bounds. The release still commits through `onDrag` and so uses the live total, as does a live-mode drag throughout. The alternative — having `previewDrag` resolve the two panes from its `frame` and read the total live — would make the preview follow a mid-drag resize, but at the cost of a hybrid basis and a duplicated pane lookup in the one path that does not otherwise need one.

[^translate]: `Component.setX` writes `left` and leaves any existing translate in place, so a component placed through `commitBounds`' size-stable-move fast path — which reports the pre-move `getX()` and carries the move on a transform ([`LayoutManager.ts:624`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L624)) — keeps that transform through a later `setX`. A `Split` pane does reach a drag in that state: U7's fixture produces it with two `setPaneSize` calls and one `doLayout`. This plan does not need it fixed, and the reason is structural rather than lucky. Every position `onDrag` writes is a *relative* delta (`getX() + dragAmount`), which moves the element's visual position by exactly `dragAmount` whatever translate rides on it, and every quantity it reads is an *extent* (`getWidth()` / `getHeight()`), which no translate affects. U7 pins that: the invariants hold on a clamped frame over a pane carrying a 40 px translate. Making `setX` own the translate is a `Component`-level API decision affecting every caller of `setX` / `setY` and every fast-pathed element, and the library's current answer is that each writer folds it in where it matters — `CollapseSupport.captureRect` and `commitRect`, `Toggle.doLayout`, `TabBar.positionIndicator`, `ScrollStrip.laidOutItemsExtent`. `will-change: transform` staying promoted on such a pane for the duration of a drag is part of that same separate question.

[^rhs-expression]: `rhs.setWidth(total - committedLhs)` and `rhs.setWidth(total - newLhs)` commit the same box in every state reachable through `resolveLhsSize`, so no prescribed case distinguishes them. The proof: the leading pane can only clamp *downward* (its clamp minimum never exceeds `pairBounds`' `minLhs`, so it never clamps up), and `committedLhs < newLhs` requires the inverted bracket, whose own condition is `total > maxLhs + maxRhs` — which makes `total - committedLhs` exceed `maxRhs`, so the trailing pane's own clamp cuts it back to the same ceiling `total - newLhs` already sat under. A fixture that breaks the equality needs a trailing pane whose own clamp is looser than the merged maximum `pairBounds` read — a `Container` or `Panel` whose box manager reports a small content-derived maximum — and every such fixture has a broken layout at rest, before any drag, because `clampMain` writes that same maximum into the pane's stored size on the first pass. `total - committedLhs` is prescribed because it states the rule the frame implements: the trailing pane takes the span the leading pane did not.

[^stored-sizes]: `_sizes` is the stored ratio the next `doLayout` reproduces and, through `getPaneSizes()`, the array a consumer persists when `paneresize` fires. On U1's frame today it records 296 for a pane that committed 250. Storing the committed extents changes nothing for an ordinary drag — `Split.resizeMode.test.ts`'s S4 (`[{px 70}, {ratio 1}]`) and `Split.dragFrameGate.test.ts`'s D2 and D4 (250) all read the same either way, because their frames commit what they were handed — and case S1 is the only place the difference shows.

[^siblings]: `Border`'s gutters are constructed `movable: false` and carry only a collapse chevron ([`Border.ensureGutter:819-824`](packages/lib/src/typescript/lib/layout/Border.ts#L819)), so no `Border` region is ever dragged and neither defect has a site there. `Accordion` does have a gutter drag, and it is built differently in both respects: `readOpenSections` re-reads every open section's live height, minimum and maximum on every frame ([`Accordion.ts:2040`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2040)), so there is no press-time total to go stale; and `applySectionHeights` re-runs the shared `layoutSections` for the whole stack rather than nudging a gutter by a delta ([:2129](packages/lib/src/typescript/lib/layout/Accordion.ts#L2129)), so no gutter position is derived from a size a section refused. `layoutSections` does advance its cursor by the height it *requests* for each wrapper ([`placeSection:1658`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1658)), which is the same latent shape as `Split.doLayout`'s cursor and is out of scope for the same reason.

---

## Implementation Notes

Five things happened that the plan either left conditional, did not foresee, or
predicted but could not confirm. Nothing here is a redesign; the plan's
decisions were followed as written.

### The conditional in step 6 resolved: every scene passes `spacing: 4`

`split-gutter-zero-thickness-gap` landed first, so `SplitOptions` does carry a
`spacing` field and it does default to `0`. Every `Split` in
`Split.dragGeometry.test.ts` is therefore constructed with `spacing: SPACING`
(`4`), which restores the pre-change reserve exactly and leaves every literal in
*Expected Behaviour* holding unchanged — the rest state is leading pane
`{x 0, w 100}`, gutter `{x 97, w 10}`, trailing pane `{x 104, w 296}`, and the
two invariants read `2` and `4` rather than the vacuous `0 === 0` a
`spacing: 0` fixture would have produced. `onDrag` itself needed no change under
this landing order, as the plan anticipated: both position writes are relative
deltas.

### One numeric correction in `Split.dragFrameGate.test.ts` beyond step 7's three edits

D2d's explanatory comment claimed the inverted bracket hands the leading pane
**296** with a requested delta of **46**. Those were the figures under the old
fixed 4 px `GUTTER_SIZE`; that file constructs its `Split` with no `spacing`, so
after phase 1 its pair holds 400 px rather than 396 and the bracket's low bound
is `400 − 100 = 300`, for a delta of 50. Verified by spying on the leading pane's
`setWidth` on that exact frame, which recorded `300`. The comment now reads 300
and 50. This is a stale-number fix in a comment step 7 already rewrites either
side of, not an unrelated cleanup.

### Two files the Files table does not list had to change

The plan's survey of `_dragOriginRhsSize`'s users only covered `packages/lib`, so
its Files table misses **`packages/qa/tests/ablations.test.ts`**. That package's
`splitFixture()` seeds a drag by writing `Split`'s private origin fields
directly, including `split._dragOriginRhsSize`, and its docstring says it
prepares the drag "as `onDragStart` would". With the field deleted that write
only created a stray property on the instance and the claim stopped being true,
so the line is gone. JavaScript accepts a write to a non-existent field, so
nothing failed to warn about it; it is the orphan cleanup
[CLAUDE.md](../../CLAUDE.md)'s *Surgical Changes* rule asks for.

`onDragStart`'s own JSDoc in `layout/Split.ts` also had to be corrected, which
step 5 does not cover — it scopes the doc fix to `onDrag`'s `@remarks`. The
sibling summary claimed the method captures "the current sizes of the two
adjacent panels" and that later frames derive the new sizes from them, both
false once the trailing capture went away and the total became a per-frame read.
It now says what it captures — the pointer coordinate and the leading panel's
size — and that a live frame reads the pair's room off the two panels instead.

### The measured suite baseline is phase 1's, not the plan's

*Verification* step 2 quotes 518 files / 8708 passed at the plan's own branch
point and 519 / 8721 after. The actual start point —
`feature/split-gutter-zero-thickness-gap` — already carries one more test file,
so the measured baseline was **519 files / 8721 passed / 2 todo / 0 failed** and
the finish is **520 / 8734 / 2 todo / 0 failed**. That is exactly the +1 file and
+13 cases the plan predicted; only the starting figures moved.

### Verification integrity: every assertion was mutation-checked

Each prescribed *Catches* claim was checked by applying the named mutation to
`onDrag`, running `Split.dragGeometry.test.ts` and `Split.dragFrameGate.test.ts`,
and restoring. Every case named by the plan reddened for its own mutation:

| Mutation applied to `onDrag` | Cases that caught it |
|---|---|
| `dragAmount` from `newLhs`, x arm | U1, U7 |
| `dragAmount` from `newLhs`, y arm | U2 |
| Trailing pane's position write dropped, x arm | U1, U3, U5, U6, C2, C4, C5, D1, D2, D3 |
| `dragAmount` mis-signed, x arm | U1, U3, U5, U6, C2, C4, C5, D1, D2, D3 |
| Gutter write dropped, x arm | U1, U3, U5, U6, C2 |
| Gutter written absolutely off `getX() + getWidth()`, translate ignored | **U7 only** |
| Combined extent captured at the press again | C1, C2, C3, C4, C5, D2b |
| Press-time extent on the y arm only | **C3 only** |
| `_outlineDrag.total` preferred over the live read | **C5 only** |
| `_sizes.set(lhs, newLhs)` | **S1 only** |
| `_sizes.set(rhs, total - committedLhs)` | **S1 only** |

The four single-case rows are the ones that matter: U7 is the only witness for
the translate fold-in, C3 for the y arm's live read, C5 for an outline release
preferring the press-time total, and S1 for a refused size reaching `_sizes`.
U7's fixture was confirmed to build what it claims before the drag runs — the
middle pane reports `getX()` 104 with `getTranslateX()` 40 and width 100, and
`gutter[1]` sits at 241 — and the pre-fix run reproduced the plan's pinned buggy
numbers exactly: gutter at 293 against a pane edge at 250 (U1, U2), gutter at 281
(U7), and the trailing pane committing 296 at x 104 for a far edge of 400 inside
a 300 px host (C1).

**Two mutations were caught by nothing, both predicted by the plan and both left
as they are.** Neither is a vacuous assertion; each is a documented equivalence.

- Writing the trailing pane's extent as `total - newLhs` instead of
  `total - committedLhs` reddens no case, which is exactly what
  `[^rhs-expression]` argues: the two commit the same box in every state
  reachable through `resolveLhsSize`. `total - committedLhs` is kept because it
  states the rule the frame implements.
- Dropping `rhsMoved`'s position term reddens no case, which is what *Potential
  Challenges* predicts: with a live total the trailing pane's position and extent
  move together on every reachable frame. The term is kept, per the plan, because
  it mirrors `commitBounds`' own comparison and a redundant term is cheaper than
  a gate that silently stops working if the coupling breaks. Dropping the
  *extent* term instead reddens **D2d alone**, confirming D2d survives as the
  gate's extent-only witness. No replacement for the lost position-only witness
  was invented.

### Still owed

*Verification* step 6 — one real drag in a windowed app, past a pane's minimum
and its maximum in both orientations, plus a window resize under a held drag —
was **not run**: every route to it opens a window on the user's desktop. It
remains owed and is the only unverified item.
