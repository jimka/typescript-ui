---
touches-shared: [packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts]
---

# Virtual Row View Resize Relayout — Implementation Plan

## Overview

Dragging a [`Split`](packages/lib/src/typescript/lib/layout/Split.ts) gutter that resizes a pane containing a [`Tree`](packages/lib/src/typescript/lib/component/tree/Tree.ts) re-lays out every visible row's children on every animation frame of the drag. A live pane resize changes the row width on each frame, so [`VirtualRowView.positionRow`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L516)'s per-slot geometry cache reports "changed" for every visible row, every frame, and [`Tree._positionRows`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1513) answers that by calling [`TreeRow.layoutChildren`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L287) for each one. Across roughly 80 visible rows in a real app — a Tauri/WebKitGTK desktop editor — that per-row relayout measured at roughly 44 ms per frame on top of an already-high baseline.

This plan coalesces that child relayout: while the row width is still moving, each pass writes the row's own geometry and withholds the per-row child layout; one animation frame after the width stops moving, a settle pass lays every visible row's children out accurately. The mechanism lives on the shared base [`VirtualRowView`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L60) and is used only by `Tree`; [`table/Body`](packages/lib/src/typescript/lib/component/table/Body.ts#L1390) is untouched and keeps today's behaviour exactly.[^body-untouched]

No public API changes — `VirtualRowView` is `@internal` and not barrel-exported, and the three methods added to it are one `protected` and two `private`.

---

## Architecture Decisions

### The child relayout is coalesced to a settle frame, mirroring `Split.scheduleDrag` / `flushDrag`

`VirtualRowView` gains `deferRowLayoutWhileResizing(widthChanged)`, a settle animation frame armed on the first width change of a burst, and a `flushResizeSettle` that re-lays out every visible row's children once the width has been quiet for a frame. The arm-once-and-leave-it shape, the `DOM.sink.requestAnimationFrame` handle, and the teardown cancel are copied from `Split.scheduleDrag` / `flushDrag` ([Split.ts:1098](packages/lib/src/typescript/lib/layout/Split.ts#L1098), [:1111](packages/lib/src/typescript/lib/layout/Split.ts#L1111)), which solves the same class of problem one layer up.[^split-precedent]

### No cross-component "a resize is in flight" signal

Nothing tells `VirtualRowView` that a `Split` or `Accordion` gutter is being dragged. `VirtualRowView` infers a live resize from its own inputs instead: a second width change arriving before the settle frame for the first one has run. A run of such changes is called a *burst* below — one drag produces one burst, one change per frame.[^why-not-signal]

### The first width change of a burst always lays out in full

A one-off resize — a sidebar toggle, a window resize, a programmatic `setWidth` — produces exactly one width change, so it takes the full accurate path on its own frame and owes nothing afterwards. Only the second and later changes of a burst are withheld.

| Pass | Width vs. previous pass | Settle frame armed? | Child layout this pass |
|---|---|---|---|
| Sidebar toggle (single step) | changed | no | full — and nothing owed |
| Drag frame 1 | changed | no | full |
| Drag frame 2..N | changed | yes | withheld |
| Same-width pass inside a burst | unchanged | yes | none needed (geometry already current) |
| Settle frame, first quiet frame | — | — | full, for every visible row |
| Scroll tick, no width change | unchanged | no | today's behaviour — rebound rows only |

### The row's own width write stays live on every frame

`positionRow` keeps writing each row's translate, width and height every frame. A row's own width is what its selection tint and hover wash span, so withholding that write would leave a visibly wrong-width highlight for the whole drag.[^row-width-stays-live]

### The toggle and icon `Glyph` repositioning is already free — no change there

`TreeRow.layoutChildren` and `IconLabelTreeNodeRenderer.layoutChildren` place the expand/collapse toggle and the row icon at coordinates that do not depend on the row width, and `Component.setX` / `setY` / `setWidth` / `setHeight` each return early when handed their current value. Those calls therefore already produce no DOM write on a width-only change, and this plan does not try to optimise them.[^glyphs-already-free]

### `Tree` alone opts in; `Body` is not wired to the new method

`Tree.renderWindow` already computes whether the shared row width changed ([Tree.ts:1427-1430](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1427)); that same boolean is handed to the new base method. `Body` never calls it, so the base's settle state stays inert for a table.[^body-untouched]

---

## Internal Structure

### New private state on `VirtualRowView`

Placed with the existing private fields, after `_lastWindowStart` ([VirtualRowView.ts:72](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L72)):

```typescript
/** Whether a pass withheld a width-driven child relayout that is still owed. */
private _rowLayoutOwed: boolean = false;
/** Whether a further width change landed after the settle frame was armed. */
private _rowWidthMoved: boolean = false;
/** The animation frame armed to end a resize burst, or `null` when none is in flight. */
private _resizeSettleHandle: number | null = null;
```

### `deferRowLayoutWhileResizing` — the decision, once per render pass

```typescript
/**
 * Decides whether this render pass may withhold the width-driven relayout of
 * every visible row's children because the view's width is still moving, and
 * arms the settle pass that catches them up once it stops.
 *
 * @param widthChanged - Whether this pass sizes rows to a different width than
 *   the previous pass did.
 *
 * @returns `true` when the caller must skip each row's child layout this pass.
 *
 * @remarks The first width change of a burst is always applied in full, so a
 * one-off resize lands accurate on its own frame. Only a change that arrives
 * while a settle frame is already armed is withheld.
 */
protected deferRowLayoutWhileResizing(widthChanged: boolean): boolean {
    if (!widthChanged) {
        // A pass at a settled width with no burst in flight owes the catch-up
        // itself, so a withheld layout is never left waiting on a frame that
        // never runs. Skipped while a burst is in flight, because a second
        // same-width pass within one frame would otherwise undo the whole
        // saving.
        if (this._rowLayoutOwed && this._resizeSettleHandle === null) {
            this._rowLayoutOwed = false;
            this.invalidateGeom();
        }

        return false;
    }

    if (this._resizeSettleHandle === null) {
        this.scheduleResizeSettle();

        return false;
    }

    this._rowWidthMoved = true;
    this._rowLayoutOwed = true;

    return true;
}
```

### `scheduleResizeSettle` / `flushResizeSettle` — the settle frame

```typescript
/**
 * Arms the animation frame that ends a resize burst. Armed once and left
 * alone while further width changes arrive, matching `Split.scheduleDrag`.
 */
private scheduleResizeSettle(): void {
    this._resizeSettleHandle = DOM.sink.requestAnimationFrame(() => this.flushResizeSettle());
}

/**
 * Ends a resize burst, or extends it by one frame when the width moved again
 * since this frame was armed. On the first quiet frame it re-lays out every
 * visible row's children at the settled width.
 */
private flushResizeSettle(): void {
    this._resizeSettleHandle = null;

    if (this._rowWidthMoved) {
        this._rowWidthMoved = false;
        this.scheduleResizeSettle();

        return;
    }

    if (!this._rowLayoutOwed) {
        return;
    }

    this._rowLayoutOwed = false;
    this.invalidateGeom();
    this.renderWindow();
}
```

`invalidateGeom()` ([VirtualRowView.ts:561](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L561)) is what makes the following `renderWindow` pass report a geometry change for every slot, which is what drives the full child layout.

### Teardown

`destructor()` ([VirtualRowView.ts:146](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L146)) cancels a still-armed settle frame before disposing the pool, so the callback cannot fire against rows that are about to be torn down — the same care `Split.detach` takes for its own buffered drag frame.

---

## Ordered Implementation Steps

1. **Add the three private fields** to `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`, after the `_lastWindowStart` field at [:72](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L72). Declarations in *Internal Structure*.

2. **Add `scheduleResizeSettle` and `flushResizeSettle`** to the same file, placed immediately after `invalidateGeom` ([:561](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L561)) so the three settle methods sit together. Bodies in *Internal Structure*. `DOM` is already imported in this file ([:4](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L4)) — no new import. Both call only methods that already exist (`invalidateGeom`, `renderWindow`).

3. **Add `deferRowLayoutWhileResizing`** directly before `scheduleResizeSettle`, so the protected entry point reads ahead of the two private helpers it drives. Body in *Internal Structure*.

4. **Cancel the settle frame in `destructor`** ([:146](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L146)), as the first statements of the method, before the `_rowPool` disposal loop:

   ```typescript
   if (this._resizeSettleHandle !== null) {
       DOM.sink.cancelAnimationFrame(this._resizeSettleHandle);
       this._resizeSettleHandle = null;
   }
   ```

   Extend the method's doc comment with one sentence: a still-armed settle frame is cancelled here so it cannot re-render against a disposed pool.

5. **Hand the width-changed flag to the new method in `Tree.renderWindow`.** In `packages/lib/src/typescript/lib/component/tree/Tree.ts`, leave the `rowWidth` derivation at [:1424-1426](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1424) exactly as it is, then replace the `if (rowWidth !== this._lastRowWidth)` block at [:1427-1430](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1427) and the `_positionRows` call at [:1432](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1432) with:

   ```typescript
   const widthChanged = rowWidth !== this._lastRowWidth;

   if (widthChanged) {
       this._lastRowWidth = rowWidth;
       this.invalidateGeom();
   }

   // While a live pane resize keeps moving the row width, each row's children
   // keep the layout the previous pass gave them; the settle pass catches them up.
   const deferChildLayout = this.deferRowLayoutWhileResizing(widthChanged);

   this._positionRows(win.firstRow, win.windowSize, rowWidth, reboundFlags, deferChildLayout);
   ```

6. **Add the parameter to `Tree._positionRows`** ([:1513](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1513)): a fifth parameter `deferChildLayout: boolean`, documented as "Whether a live resize is withholding the width-driven child relayout this pass." Change the guard at [:1521](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1521) from `if (wasRebound || geomChanged)` to:

   ```typescript
   if (wasRebound || (geomChanged && !deferChildLayout)) {
   ```

   Update the method's summary line so it says the pass re-lays out children when the row was rebound, or when its geometry changed and no live resize is withholding the pass.

   Checkpoint: `grep -rn 'deferRowLayoutWhileResizing' packages/lib/src/typescript/lib/component/table/` — expect zero matches.

7. **Write the new test file** `packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts`, covering every case in *Expected Behaviour*. Model the frame-capture harness on [`ScrollRebindLayoutEconomy.test.ts:31-61`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts#L31), with one change: the fake `cancelAnimationFrame` must actually drop the callback (store callbacks in a `Map` keyed by an incrementing handle), so the teardown case can assert that a cancelled settle frame does not run.

8. **Typecheck, lint, test.** `npm run typecheck`, `npm run lint`, then the commands in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Create | `packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts` |

---

## Expected Behaviour

The existing tree tests never drive two width changes in one burst and never observe `TreeRow.layoutChildren`, so every case below is new coverage.[^no-test-coverage]

### Unit-testable (offline, `installTestDOM` + captured animation frames)

Mount a `_Tree` with enough short-labelled nodes to fill the viewport, settle it, then spy on each pooled row's `layoutChildren`.

1. **A one-off width change lays out every visible row's children.** One `setWidth` + `doLayout` at a new width calls `layoutChildren` once per visible row. Draining the captured frames afterwards produces no further calls — nothing was owed.

2. **A second width change in the same burst lays out no row's children.** Without draining frames, a further `setWidth` + `doLayout` calls `layoutChildren` zero times, while each pooled row's own `getWidth()` still reflects the new width.

3. **A same-width pass inside a burst lays out no row's children.** After the withheld pass of case 2, a further `doLayout()` at that same width calls `layoutChildren` zero times. (Pins the settle-frame gate on the catch-up branch: without it, this pass would run a full catch-up every frame of a drag.)

4. **The settle frame catches every visible row up exactly once.** After case 2, draining the captured frames calls `layoutChildren` once per visible row, and the resulting renderer and label widths equal those of a control tree taken to the same final width in a single step.

5. **A width change that lands while a settle frame is already armed extends the burst.** Draining the captured frames after such a change performs no catch-up — the drain only re-arms. A second drain, with no further width change in between, performs the catch-up.

6. **A slot rebound during a withheld pass still lays its children out.** In a single pass during a burst, change both the width and the height (a taller viewport pulls further rows into the window): `layoutChildren` is called for each newly bound slot and for no already-bound slot.

7. **Scroll economy is unchanged.** With no width change, a one-row scroll calls `layoutChildren` only for the slot that rebound, and for no other slot.

8. **Teardown mid-burst cancels the settle frame.** Disposing the tree during a burst and then draining the captured frames runs no settle callback: no `renderWindow`, no `layoutChildren`, no error.

9. **`Body` is unaffected.** `packages/lib/tests/component/table/` passes unchanged, `ScrollRebindLayoutEconomy.test.ts`, `CellLayoutSkip.test.ts`, `ColumnResize.test.ts` and `ColumnWidths.test.ts` included.

### Manual-verify (pointer drag and paint are not exercisable offline)

- **Dragging a `Split` gutter over a populated tree is materially smoother**, and on release every row is laid out correctly for the final width.
- **While dragging narrower, a label that should now be ellipsised may clip hard at the row edge for the duration of the drag**, snapping to its correct ellipsis on release. This is the accepted trade-off, not a defect.
- **A one-off resize** — toggling the sidebar, resizing the window once — lands in the correct final layout immediately, with no visible stale frame.
- **Scrolling the tree during and after a drag** shows correctly laid-out rows throughout.

---

## Verification

- **Typecheck:** `npm run typecheck` (clean).
- **Lint:** `npm run lint` (clean).
- **Unit tests:** `npx vitest run tests/component/tree/` and `npx vitest run tests/component/table/` from `packages/lib` — all green, including the new `ResizeLayoutEconomy.test.ts`.
- **Grep invariants:**
  - `grep -rn 'deferRowLayoutWhileResizing' packages/lib/src/typescript/lib/` — matches only `VirtualRowView.ts` (definition) and `Tree.ts` (single call site).
  - `grep -rn '_resizeSettleHandle' packages/lib/src/typescript/lib/` — matches only `VirtualRowView.ts`, and the `destructor` occurrence is present.
- **Build:** `npm run build:lib` succeeds.
- **Manual live:** the docs app's Tree demo inside a `Split` (`npm run docs:dev`), or the sibling Loom app's file-tree sidebar, exercising the four manual-verify observations above.

---

## Potential Challenges

- **Two render passes per frame could defeat the coalescing.** A container's layout recursion can reach `Tree.renderWindow` more than once per frame; if the second, same-width pass triggered the catch-up, nothing would be saved. Mitigated by gating the catch-up branch on no settle frame being in flight, and pinned by Expected Behaviour case 3.
- **The settle frame could land before a frame's width change.** Then that frame does a full pass and immediately starts a fresh burst — one extra accurate pass, never an incorrect one.[^raf-ordering]
- **A withheld pass leaves children stale.** Every route out of that state is covered: the settle frame, the catch-up on the next quiet pass, a rebind, and `onThemeReflow`'s own `invalidateGeom` ([VirtualRowView.ts:681](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L681)).
- **The offline sink drops `requestAnimationFrame`.** The new test file must capture frames explicitly, as `ScrollRebindLayoutEconomy.test.ts` does.
- **A tree's very first render arms a settle frame.** `Tree._lastRowWidth` starts at `0`, so the first pass counts as a width change. The frame it arms finds nothing owed and returns — one harmless animation frame per mounted tree at startup — but a test that counts armed frames must expect it.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `positionRow` ([:516](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L516)), `invalidateGeom` ([:561](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L561)), `destructor` ([:146](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L146)), and the sibling `deferRenderWhileFirstLayoutHeld` ([:581](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L581)) whose name and return shape the new method mirrors.
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts) — `renderWindow` ([:1358](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1358)), the row-width derivation and its `invalidateGeom` ([:1424-1430](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1424)), and `_positionRows` ([:1513](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1513)).
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `scheduleDrag` ([:1098](packages/lib/src/typescript/lib/layout/Split.ts#L1098)), `flushDrag` ([:1111](packages/lib/src/typescript/lib/layout/Split.ts#L1111)) and the `detach` cancel: the precedent this plan follows.[^split-precedent]
- [`packages/lib/src/typescript/lib/component/tree/TreeRow.ts`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts) — `layoutChildren` ([:287](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L287)): the work being withheld.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `bindAndPositionRows` ([:1390](packages/lib/src/typescript/lib/component/table/Body.ts#L1390)): read to confirm it ignores `positionRow`'s return value and guards its own per-cell layout through `applyBounds`.
- [`packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts) — the frame-capture + layout-spy test shape the new test file copies.
- [`plans/implemented/accordion-resizable-drag-perf-and-snap.md`](plans/implemented/accordion-resizable-drag-perf-and-snap.md) — the nearest prior drag-performance plan.[^accordion-precedent]
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the absolute-positioning and typed-setter rules the design has to stay inside.

---

## Non-Goals

- **The ~84 ms/frame baseline** measured with an empty sidebar panel. It is present with no tree on screen at all and is a property of the host webview's rendering, not of this code.
- **`Table` / `Body`.** Its per-cell `applyBounds` already skips an unchanged rectangle ([Component.ts:3973](packages/lib/src/typescript/lib/core/Component.ts#L3973)), and a column-width change during a drag moves visible column boundaries, so it must stay live.[^body-untouched]
- **Sizing rows or their children through CSS percentages or flex** instead of explicit `setWidth` writes.[^why-not-css]
- **`Accordion`'s own per-frame `doLayout`**, which walks `getPreferredSize` over its open sections. A separate concern in a separate file.
- **Aligning `IconLabelTreeNodeRenderer.layoutChildren` ([IconLabel.ts:132](packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts#L132)) with `LabelTreeNodeRenderer.layoutChildren` ([Label.ts:91](packages/lib/src/typescript/lib/component/tree/renderer/Label.ts#L91))**, which clamps its label to the label's own content width while the icon+label renderer sizes its label to the whole available box. A real inconsistency, but a behaviour change to two renderers rather than a fix to the relayout path, so it stays out of this plan.

---

## Notes

[^split-precedent]: `Split.scheduleDrag` / `flushDrag` buffer a gutter's `drag` events and apply at most one per animation frame, with a synchronous flush on drag-end and a cancel in `detach()` for a drag torn down mid-flight. This plan copies three things from it: arm the frame once and leave it armed while further events arrive (rather than cancel-and-re-arm per event), hold the handle in a nullable field that doubles as the "in flight" test, and cancel that handle in the teardown hook. That change solved the pane-resize dispatch; the per-row cost this plan addresses sits underneath the dispatch and is untouched by it. **At drafting time this change is present in the repository's main working tree but not yet committed to `master`**, so an implementer on a branch cut from `master` may not see it — the line numbers cited for `Split.ts` are those of the uncommitted version, and the symbol names are the reliable reference.

[^why-not-signal]: The alternative was a framework-level "a resize is in flight" signal that `Split` and `Accordion` broadcast and `VirtualRowView` subscribes to. It was rejected on three counts: `VirtualRowView` has no knowledge of what container it sits in and would have to walk ancestors or register a global subscription to find one; the signal would need teardown handling in every emitter, multiplying the class of bug `Split.detach`'s cancel exists to prevent; and it would cover only the emitters that were taught to broadcast, whereas inferring the burst from the width itself covers every driver — a `Split` gutter, an `Accordion` section drag, a docked window resize, a live window resize — with no emitter-side change at all.

[^why-not-css]: Sizing each row with a percentage or flex width so the browser resolves it from one container write was considered and rejected. `ARCHITECTURE.md`'s *Positioning is always absolute* rule makes every `Component` absolutely positioned with coordinates assigned by a layout manager, and the framework's containing-block math, scroll arithmetic and `overflow` propagation all assume it. Beyond the rule, `Component.getWidth()` reads a cached `_width` written by `setWidth`, so a browser-resolved width would leave every cached read stale — `Tree`'s own content-width and scrollbar math included. `Table`'s cells carry per-column pixel widths that no single container write can express, and `Tree`'s `rowOverflow: "scroll"` mode deliberately sizes rows *wider* than their container (`Math.max(viewportWidth, _maxContentWidth)` at [Tree.ts:1424-1426](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1424)), which a percentage of the container cannot produce.

[^glyphs-already-free]: Checked rather than assumed. `Component.setX` ([:4222](packages/lib/src/typescript/lib/core/Component.ts#L4222)), `setY` ([:4258](packages/lib/src/typescript/lib/core/Component.ts#L4258)), `setWidth` ([:4051](packages/lib/src/typescript/lib/core/Component.ts#L4051)) and `setHeight` ([:4155](packages/lib/src/typescript/lib/core/Component.ts#L4155)) each compare against the cached field and return before touching `writeHorizontalGeometry` / `writeVerticalGeometry` when the value is unchanged. The toggle's coordinates depend on the row's depth and the row height, and the icon's on the icon size and the row height — none on the row width — so on a width-only change every one of those calls is a guarded no-op. `Text.setLineHeight` ([Text.ts:1162](packages/lib/src/typescript/lib/component/input/Text.ts#L1162)) carries the same guard for its numeric form, and `Glyph` does not override `getPreferredSize`, so the toggle's `getPreferredSize()` read resolves from the cached constraint rather than measuring. The genuinely-changing writes on a width-only frame are three: the row's own `left`/`width`, the renderer's, and the label's. Withholding `layoutChildren` removes the latter two, plus the whole JS call chain — two `getContentBounds()` allocations, roughly forty guarded setter calls, and four `setAutoCommitStyle` flush pairs per row per frame.

[^accordion-precedent]: `plans/implemented/accordion-resizable-drag-perf-and-snap.md` fixed a drag that called `container.doLayout()` on every pointer move by giving the drag a lightweight path that writes geometry for only the affected band. Its pattern is "narrow *which components* the drag path touches", and it does not transfer here: this drag already touches only the rows it must, and every one of them genuinely needs a new width each frame. The transferable half of that plan is its *shape* — a drag-specific cheap path plus a shared primitive so the cheap and full paths cannot drift — which this plan keeps by having the withheld pass and the settle pass both run the same `positionRow` / `layoutChildren` code, differing only in whether the child layout is called.

[^raf-ordering]: A settle frame armed during frame N runs in frame N+1's animation-frame phase. In both realistic drivers the width change reaches `renderWindow` first: with `Split.scheduleDrag` in place, `Split.flushDrag` was armed from a `mousemove` earlier in frame N and so sits ahead of this callback in frame N+1's list; without it, `onDrag` runs straight from the `mousemove`, which is dispatched before the animation-frame phase entirely. If some driver did invert that order, the settle frame would find nothing owed, return, and the frame's width change would start a fresh burst that lays out in full — one extra accurate pass on that frame, bounded by today's cost, never a wrong result.

[^row-width-stays-live]: Per `ARCHITECTURE.md`'s *Component CSS tiers and state-rule dedup*, `TreeRow` carries its per-record tints (`.selected`, `.focused`, …) on the row element itself, so the row's own width is what a selection highlight or hover wash spans. Coalescing that write would pin a selected row's highlight to the drag's starting width for the whole drag — plainly visible, unlike a label's truncation point arriving a frame late.

[^no-test-coverage]: Confirmed against `packages/lib/tests/component/tree/` and `packages/lib/tests/component/table/`. Every `setWidth` in `Tree.test.ts` is a single mount-time sizing call; `TreeFontReflow.test.ts` sizes once and then changes the font. No tree test drives two width changes in a burst, and none observes `TreeRow.layoutChildren`. On the table side, `ColumnResize.test.ts` and `ColumnWidths.test.ts` cover column widths rather than repeated body-width changes. The resize-driven repositioning path is therefore unpinned today, which is why this plan specifies it case by case before any code is written.

[^body-untouched]: `Body.bindAndPositionRows` discards `positionRow`'s return value ([Body.ts:1414](packages/lib/src/typescript/lib/component/table/Body.ts#L1414), [:1461](packages/lib/src/typescript/lib/component/table/Body.ts#L1461)) and positions each cell through `Component.applyBounds`, which already withholds a cell's `doLayout` when the rectangle it is handed is unchanged (the `canSkipUnchangedLayout` opt-in, which `Cell` takes). A body-width change with fixed column widths therefore already costs one row-element write per row and nothing more; with flexible columns the cell rectangles genuinely move and must be written every frame, because a column boundary is visible in a way a label's truncation point is not. Leaving `Body` off the new method also keeps a table from paying an extra settle render after every width change.

---

## Implementation Notes

- **No docs-app page composes a `Tree` inside a draggable `Split` to drag,
  so the plan's three drag-specific Manual-verify bullets were not exercised
  against a real pointer-drag + compositor-paint runtime in this run** —
  corrected from an earlier, factually wrong version of this note (an audit
  round caught the error; see below). `packages/lib/docs/components/Tree.md`
  *does* exist and *is* live at `/components/Tree` (routed case-sensitively
  by `packages/docs/src/content/pages.ts`) with its `tree-nodes` demo, and
  the docs shell's own sidebar (`packages/docs/src/shell/DocsSidebar.ts`) is
  itself a live, virtual-scrolled `Tree` — but neither sits inside a `Split`,
  and the two docs `Split` demos (`split-panes`, etc.) hold no `Tree`. The
  Loom app's file-tree sidebar — the other surface the plan names, and the
  actual app the 44 ms/frame measurement in the Overview came from — lives
  in a separate repository/worktree not wired to consume this branch's
  unreleased `dist` output, so it wasn't a substitute here either.
- **The plan's third Manual-verify bullet — a one-off resize lands in the
  correct final layout immediately, with no visible stale frame — *was*
  reachable and was checked live**, against `/components/Tree`'s demo:
  resizing the browser viewport 1280→1000 moved the tree's rows and
  renderers together, in step, with no stale frame — corrected from an
  earlier version of this note that also claimed the docs shell's own
  sidebar tree as a second confirmation, which a later audit round caught as
  wrong: `DocsSidebar` carries a fixed `preferredSize.width` and sits in
  `DocsShell`'s `Border` WEST region with no EAST region to contend with, so
  `Border` hands it exactly that preferred width regardless of viewport
  width — it never receives a width change on a plain browser resize, so it
  exercised none of this plan's new code path. The eight automated cases in
  `ResizeLayoutEconomy.test.ts` additionally pin the exact frame-by-frame
  mechanics the three remaining bullets would otherwise spot-check (the
  withhold/catch-up transition, the burst-extension case, a slot rebound
  mid-burst, teardown mid-burst, and — after an audit round — that a
  withheld pass's eventual catch-up actually reproduces a single-step
  control's renderer *and* label geometry, not just its row width). Only the
  subjective "does a live gutter drag look smoother" observation and the
  deliberate mid-drag ellipsis-clipping trade-off remain genuinely
  unverified here; a maintainer should still drag a `Split` gutter over a
  populated `Tree` in a real app (Loom's sidebar, once this branch is
  available there) to confirm those two directly.
- **`VirtualRowView.deferRowLayoutWhileResizing`'s `!widthChanged` branch, as
  specified verbatim in this plan's `## Internal Structure`, contained a
  dead inner check.** `_rowLayoutOwed` is set only while
  `_resizeSettleHandle` is non-`null`, and every path that clears the handle
  (`flushResizeSettle`'s non-extending return, and `destructor`'s cancel)
  either resolves `_rowLayoutOwed` in the same step or tears the view down
  entirely, so the guarded resolution this branch attempted
  (`_rowLayoutOwed && _resizeSettleHandle === null`) could never observe
  both conditions true at once — confirmed by an audit round's own
  instrumentation across a multi-change burst. The branch was simplified to
  an unconditional `return false;`; this changes no observable behaviour
  (the code it removed never ran) and all eight `ResizeLayoutEconomy.test.ts`
  cases pass unchanged before and after. `scheduleResizeSettle`'s doc comment
  now records, as a deliberate design tradeoff rather than an oversight, that
  — unlike `Split.onDragEnd` — there is no synchronous flush for a
  still-armed settle frame: nothing signals this view that a drag has ended
  (per this plan's own "No cross-component signal" decision), so there is no
  well-defined moment to flush at other than the frame itself. A real browser
  always eventually delivers `requestAnimationFrame`; only the offline test
  sink drops it outright, which is why `ResizeLayoutEconomy.test.ts` installs
  its own capturing one, matching `ScrollRebindLayoutEconomy.test.ts`'s
  existing precedent for the same class of frame-gated mechanism.
- **Post-audit fixup: the single-`requestAnimationFrame` settle this plan
  shipped never actually withheld anything during a real `Split` gutter
  drag — the identical defect a later sibling branch,
  `feature/scrollstrip-resize-resync-coalescing`, found and fixed for
  `ScrollStrip`'s equivalent mechanism, and had flagged by name (footnote
  `[^virtualrowview-branch]`) as likely to affect this branch too.**
  `Split.flushDrag` already coalesces a drag to exactly one synchronous
  `doLayout()` pass per animation frame, itself scheduled via a
  `requestAnimationFrame` registered by whichever `mousemove` arrives after
  the previous frame's flush — chronologically *after*
  `scheduleResizeSettle`'s own callback for the same upcoming frame, which is
  registered synchronously, one frame earlier, still inside the *current*
  frame's pass. `requestAnimationFrame` callbacks run in registration order,
  so the settle callback always fired and cleared `_resizeSettleHandle`
  moments *before* that frame's real drag pass checked it, so
  `deferRowLayoutWhileResizing` never returned `true` in a real drag — the
  withhold branch was dead code in production despite all eight
  `ResizeLayoutEconomy.test.ts` cases passing, because every one of them
  drives several `doLayout()` passes back-to-back with no intervening frame,
  a shape a real drag never produces. Ported `ScrollStrip`'s fix verbatim in
  shape: `scheduleResizeSettle` now arms a two-hop relay —
  `armResizeSettleCheck` on the next frame (which only re-arms for one more
  frame, keeping `_resizeSettleHandle` continuously non-`null` across the
  boundary), then `flushResizeSettle` on the frame after that. By the time
  the second hop's `_rowWidthMoved` check runs, the frame in between is an
  entirely separate, already-completed `requestAnimationFrame` batch, so
  nothing races it. This roughly doubles settle latency after a drag stops
  (3-4 frames instead of 2), confirmed both offline and live (see below);
  still well under 100ms at 60Hz and imperceptible for a UI settle.
  Alongside it, `deferRowLayoutWhileResizing`'s check order was corrected to
  match: it now checks `this._resizeSettleHandle === null` *first*, arming a
  new settle only when the width actually changed, and withholds
  unconditionally whenever a settle is already armed regardless of whether
  *this* pass's width moved (using the changed flag only to decide whether to
  additionally mark `_rowWidthMoved`). The old `!widthChanged` early return
  skipped the settle-armed check entirely; traced against `Tree._positionRows`
  (`positionRow`'s `geomChanged` result, itself gated on the row's own cached
  geometry, already returns `false` on a genuine same-width-same-everything
  pass regardless of `deferChildLayout`), this was harmless for `Tree`
  specifically today, but the ordering was still fixed to match the now
  corrected canonical shape rather than leave a latent inconsistency.
  Updated `packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts`'s
  "extends the burst" case to pin the two-hop relay's own intermediate state
  (`_rowWidthMoved`/`_resizeSettleHandle`) rather than a hardcoded frame
  count that assumed the old single-hop timing, and added
  `ResizeLayoutEconomyRealtime.test.ts`, simulating one real `doLayout()`
  pass per animation frame (interleaved with draining whatever settle-relay
  callback is currently queued) rather than several passes with no
  intervening frame — the shape that would have caught this defect, mirroring
  `ScrollStrip`'s own realtime test file.
  **Live-browser confirmation:** no docs-app page combines a `Tree` with a
  draggable `Split` (confirmed above), so a temporary, uncommitted demo
  (`packages/docs/src/demos/scratch-split-tree-drag.ts`, plus a matching
  marker temporarily added to `Tree.md`) built one — a 60-row `Tree` in
  `rowOverflow: "clip"` mode (so `rowWidth` tracks the live viewport width
  every pass, unlike the default "scroll" mode, which pins `rowWidth` to the
  widest label's content width once that exceeds the viewport — the first
  attempt used the default mode and produced a constant `rowWidth` for the
  whole drag, a dead end worth recording). Both were deleted before this note
  was written. One real methodological trap surfaced along the way: this
  worktree has no `node_modules` of its own, so Vite's module resolution
  walked up to the *main* tree's `node_modules` and silently served its
  stale, pre-fix `packages/lib/dist` build to the docs dev server — a
  `Tree.prototype`/`VirtualRowView.prototype` introspection check caught it
  (`scheduleResizeSettle`/`armResizeSettleCheck`/`flushResizeSettle` were
  simply absent) before any measurement was trusted; running `npm install`
  inside the worktree fixed the workspace symlink to point at its own
  `packages/lib`. With that corrected, `chrome-devtools` MCP tooling dispatched
  a real `mousedown`/40 `mousemove`/`mouseup` sequence at the `.SplitGutter`
  element, one dispatch per real awaited `requestAnimationFrame`, while a
  patched `Tree.prototype._positionRows` recorded each pass's
  `deferChildLayout` decision directly. Result: frame 1 (drag start) ran
  live, frames 2 through 40 (39 consecutive real drag frames) all withheld
  (`deferChildLayout: true`), and a single catch-up pass ran 3 quiet frames
  after `mouseup` — 2 live passes out of 40 real drag frames, versus 40 of 40
  the single-hop code would have produced, and settle latency landing exactly
  in the "3-4 frames" range predicted above. `npx vitest run
  tests/component/tree/ tests/component/table/`, `npm run typecheck`, `npm
  run lint`, and `npm run build:lib` all stayed clean throughout.
