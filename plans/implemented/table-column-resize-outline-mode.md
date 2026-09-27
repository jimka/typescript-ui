---
touches-shared: [packages/lib/docs/reference/changelog/next.md, packages/qa/README.md]
---

# Table Column Resize — Outline Mode — Implementation Plan

## Overview

A column-resize drag lays the whole table out on every frame: the header cells move, and every rendered body cell is re-placed under them. This plan gives that drag the choice the split and accordion gutters and the window edges already have. Under `"outline"` the table stays exactly as it is while a thin bar follows the pointer to where the dragged edge would land, and one layout runs when the button is released. Under `"live"` — still the default — nothing changes.

The choice is the library's existing `ResizeMode` contract, not a new flag. `type ResizeMode = "live" | "outline"` lives at [packages/lib/src/typescript/lib/core/ResizeDrag.ts:25](packages/lib/src/typescript/lib/core/ResizeDrag.ts#L25); the app-wide default is `"live"` ([ResizeDrag.ts:102](packages/lib/src/typescript/lib/core/ResizeDrag.ts#L102)), writable through [core/Body.ts:237](packages/lib/src/typescript/lib/core/Body.ts#L237); an owner overrides it with its own `setResizeMode(mode | null)`. [`Split`](packages/lib/src/typescript/lib/layout/Split.ts#L817), `Accordion` and `AbstractWindow` are the three owners today. `Table` becomes the fourth.

The work lands almost entirely in [component/table/Table.ts](packages/lib/src/typescript/lib/component/table/Table.ts), which already owns the drag's arithmetic ([Table.ts:2173](packages/lib/src/typescript/lib/component/table/Table.ts#L2173)) and its state. Two files outside it gain one event each, carrying a release signal up from the resize handle to the table — the event chain has no drag-end event today.

---

## Architecture Decisions

### The table becomes the fourth owner of the `ResizeMode` seam

`Table` gains a `ResizeDrag<ColumnDragFrame>` session, a `_resizeMode` field that falls back to the app-wide default, and `getResizeMode()` / `setResizeMode(mode | null)`. The wiring mirrors [Split.ts:1399-1406](packages/lib/src/typescript/lib/layout/Split.ts#L1399) — read the mode once when the drag starts, `beginOutline` with a `gutterOutline` bar or `beginLive` — and the bar, the Escape and window-blur cancel, and the commit-on-release all come from the session rather than being built here.[^seam]

### The per-table override is a setter pair, with no options field

`Split`, `Accordion` and `AbstractWindow` each also expose `resizeMode` on their options bag. `Table` does not, because `TableOptions` never reaches a consumer: `Table`'s constructor is `(store, spec?, bodyFactory?)` and passes its own literal to `super`, so a field on that bag would be unreachable API.[^no-option]

Resolution is the table's own mode first, then the app-wide one:

| App-wide mode | `table.setResizeMode(…)` last called with | `table.getResizeMode()` |
|---|---|---|
| `"live"` | nothing | `"live"` |
| `"outline"` | nothing | `"outline"` |
| `"outline"` | `"live"` | `"live"` |
| `"outline"` | `"live"`, then `null` | `"outline"` |

### The live path keeps today's timing

An outline drag's moves are buffered in the session; a live drag's are not. `onColumnResize` still runs the arithmetic on every `mousemove` and still ends in `scheduleLayout()`, so live mode behaves exactly as it does today, down to the frame a layout lands on.[^live-untouched]

### One arithmetic body serves the live apply and the outline preview

Today's `onColumnResize` body becomes `resolveColumnResize(colIndex, clientX, widths, lastClientX)`, which reads its state from parameters and returns the resolved widths instead of assigning them. The live apply passes the table's own state; the preview passes the outline drag's private copy. Neither mode can then clamp differently from the other — the reason `Split` splits [resolveLhsSize](packages/lib/src/typescript/lib/layout/Split.ts#L1511) out of its own gutter drag.

### The bar travels by the width the left chain gained

The dragged edge's screen position is the sum of the widths left of and including it. `resolveColumnResize` caps each frame's travel at what the left chain can absorb ([DragChain.ts:43](packages/lib/src/typescript/lib/core/DragChain.ts#L43)), so that sum moves by exactly the travel the frame applied — which is also what the tracked pointer advances by. The bar's offset from its press position is therefore `lastClientX - startClientX`, needing no second measurement.[^travel]

| Fixture: available 500, widths `[200, 150, 100, 50]`, mins `60/100/40/30`, press at `clientX` 1000 | Resolved widths | Bar offset |
|---|---|---|
| move to 1080, no column carries a `maxWidth` | `[280, 100, 70, 50]` | 80 |
| move to 1300, column A capped at `maxWidth` 250 | `[250, 100, 100, 50]` | 50 |
| then back to 1000 | `[200, 150, 100, 50]` | 0 |

### The bar spans the table and sits on the dragged edge

The bar is mounted on the table's own element and spans the table's content box top to bottom, so it crosses the header band and the body together. Its box comes from `gutterOutline(…, "x")` — the same helper both gutter owners use — around a zero-width rectangle at the edge, which yields a 4 px bar centred on it.[^bar-geometry]

### The event chain gains a release signal

Nothing today tells the table a column drag ended. `ResizeHandle` already declares and fires a `dragend` event ([ResizeHandle.ts:212](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L212)) that no one subscribes to, so the chain is completed rather than invented: `HeaderCell` subscribes to it and emits a new `"resizeend"`, `TableHeader` forwards it as `"columnresizeend"`, and `Table` ends its session there. The new events carry no payload.[^end-no-payload]

### `VirtualRowView`'s row-layout deferral is left alone

`VirtualRowView.deferRowLayoutWhileResizing` ([VirtualRowView.ts:501](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L501)) withholds a row's child layout while its *width* keeps moving and catches up on a settle frame. It is not extended and not called from the table body: under `"outline"` no layout pass runs during the drag at all, so there is nothing for a deferral to withhold, and under `"live"` the behaviour must not change.[^defer-contract]

### The bar is taken down with the table

`Table.destructor` cancels the session, so a table disposed mid-drag cannot leave a bar on screen with two live viewport listeners. `Split.detach` ([Split.ts:1860](packages/lib/src/typescript/lib/layout/Split.ts#L1860)) and `Accordion.detach` ([Accordion.ts:1280](packages/lib/src/typescript/lib/layout/Accordion.ts#L1280)) both do the same.

---

## Public API

Two new methods on `Table`, inherited unchanged by `TreeTable`. Signatures and doc wording mirror [Split.ts:802-820](packages/lib/src/typescript/lib/layout/Split.ts#L802).

```typescript
class Table extends Component<TableOptions> {
    /** This table's own mode when it has one, otherwise the app-wide default. */
    getResizeMode(): ResizeMode;

    /** `null` follows the app-wide default again. Takes effect from the next drag. */
    setResizeMode(mode: ResizeMode | null): this;
}
```

Backing field: `private _resizeMode: ResizeMode | null = null;`. There is no `TableOptions` field and no `applyOptions` dispatch, so the field takes a plain initializer rather than `declare` — nothing writes it during the `super()` cascade.

New event on `HeaderCell` (`HeaderCellEvent` gains `"resizeend"`):

```typescript
on(event: "resizeend", listener: () => void): this;
protected emit(event: "resizeend"): void;
```

New event on `TableHeader` (`TableHeaderEvent` gains `"columnresizeend"`):

```typescript
on(event: "columnresizeend", listener: () => void): this;
protected emit(event: "columnresizeend"): void;
```

---

## Internal Structure

All of the following is private to `component/table/Table.ts` unless stated.

### Types, beside the existing module-level ones

```typescript
/** One buffered column-resize move: {@link Table.onColumnResize}'s two arguments. */
interface ColumnDragFrame {
    /** Visible index of the column whose right edge is being dragged. */
    colIndex: number;
    /** The absolute pointer `clientX` for this move. */
    clientX: number;
}

/** What one frame of a column drag resolves to, before anything is written. */
interface ColumnResizeStep {
    /** The per-column widths this move lands on. */
    widths: number[];
    /** The tracked pointer x, advanced only by the travel actually applied. */
    lastClientX: number;
    /** The total-width target these widths imply; `0` when the table fits. */
    widthTarget: number;
}

/** An outline drag's own state: the bar, and the widths only the release commits. */
interface ColumnOutlineDrag {
    /** The bar's box at the press, in the table's own coordinate space. */
    line: OutlineRect;
    /** The pointer x at the press; the bar's travel is measured from it. */
    startClientX: number;
    /** The widths resolved so far, starting from the committed ones. */
    widths: number[];
    /** The tracked pointer x, advanced only by applied travel. */
    lastClientX: number;
    /** The total-width target `widths` implies. */
    widthTarget: number;
    /** Visible indices of every column any frame of this drag moved. */
    moved: Set<number>;
}
```

### Module-level helper

```typescript
/**
 * The visible column indices whose width differs between two width arrays.
 *
 * @param before - The widths before the move.
 * @param after - The widths after it.
 * @returns The indices that changed.
 */
function movedColumns(before: number[], after: number[]): Set<number> {
    const moved = new Set<number>();

    for (let i = 0; i < after.length; i++) {
        if (after[i] !== before[i]) {
            moved.add(i);
        }
    }

    return moved;
}
```

### Fields, beside `_dragLastClientX` ([Table.ts:230](packages/lib/src/typescript/lib/component/table/Table.ts#L230))

```typescript
// This table's own resize mode; `null` follows the app-wide default.
private _resizeMode: ResizeMode | null = null;

// The outline drag in progress, or `null` in live mode and between drags.
private _outlineDrag: ColumnOutlineDrag | null = null;

// The drag session: in outline mode it buffers each move, moves the bar, and
// lays the drag out once on release. A live drag applies its own moves (see
// `onColumnResize`) and uses the session only for its begin/end bookkeeping.
private readonly _resizeDrag: ResizeDrag<ColumnDragFrame> = new ResizeDrag<ColumnDragFrame>({
    apply:   (frame): void => this.applyColumnResize(frame.colIndex, frame.clientX),
    preview: (frame): OutlineRect | null => this.previewColumnResize(frame),
    commit:  (): void => this.commitColumnResize(),
});
```

### The bar's box

```typescript
private columnEdgeOutline(colIndex: number): OutlineRect | null {
    const box = this.getContentBounds();

    if (box === null || !Number.isFinite(box.height)) {
        return null;
    }

    const headerBox = this._header.getContentBounds();

    let edgeX = this._header.getX() + (headerBox?.x ?? 0) - this._header.getScrollX();

    for (let i = 0; i <= colIndex; i++) {
        edgeX += this._columnWidths[i] ?? 0;
    }

    return gutterOutline({ x: edgeX, y: box.y, width: 0, height: box.height }, "x");
}
```

### The three hook bodies

```typescript
private applyColumnResize(colIndex: number, clientX: number): void {
    const step = this.resolveColumnResize(colIndex, clientX, this._columnWidths, this._dragLastClientX);

    if (step === null) {
        return;
    }

    this.pinColumnWidths(movedColumns(this._columnWidths, step.widths), step.widths);

    this._dragLastClientX   = step.lastClientX;
    this._columnWidths      = step.widths;
    this._columnWidthTarget = step.widthTarget;

    this.scheduleLayout();
}

private previewColumnResize(frame: ColumnDragFrame): OutlineRect | null {
    const outline = this._outlineDrag;

    if (outline === null) {
        return null;
    }

    const step = this.resolveColumnResize(frame.colIndex, frame.clientX, outline.widths, outline.lastClientX);

    if (step === null) {
        return null;
    }

    for (const i of movedColumns(outline.widths, step.widths)) {
        outline.moved.add(i);
    }

    outline.widths      = step.widths;
    outline.lastClientX = step.lastClientX;
    outline.widthTarget = step.widthTarget;

    return { ...outline.line, x: outline.line.x + (step.lastClientX - outline.startClientX) };
}

private commitColumnResize(): void {
    const outline = this._outlineDrag;

    if (outline === null) {
        return;
    }

    this.pinColumnWidths(outline.moved, outline.widths);

    this._dragLastClientX   = outline.lastClientX;
    this._columnWidths      = outline.widths;
    this._columnWidthTarget = outline.widthTarget;

    this.scheduleLayout();
}
```

### Pinning, lifted out of today's body

```typescript
private pinColumnWidths(moved: Set<number>, widths: number[]): void {
    if (this._displayMode === "rotated") {
        return;
    }

    const columns = this.getColumns();

    for (const i of moved) {
        this._pinnedColumnWidths.set(columns[i].getField().getName(), widths[i]);
    }
}
```

---

## Ordered Implementation Steps

1. **Imports** — in `component/table/Table.ts`, beside the existing `chainRoom` import ([Table.ts:44](packages/lib/src/typescript/lib/component/table/Table.ts#L44)), add `import { ResizeDrag, gutterOutline, getAppResizeMode, IN_PAGE_OUTLINE_Z_INDEX } from "~/core/ResizeDrag.js";` and `import type { OutlineRect, ResizeMode } from "~/core/ResizeDrag.js";`. Nothing uses them until step 3, and an unused import fails both `typecheck` and `lint`, so run no check here.

2. **Types and helper** — add `ColumnDragFrame`, `ColumnResizeStep`, `ColumnOutlineDrag` and `movedColumns` at module level in `Table.ts`, beside the existing module-level declarations above the class (`WIDTH_TARGET_EPSILON_PX` sits at [Table.ts:92](packages/lib/src/typescript/lib/component/table/Table.ts#L92)).

3. **Fields** — add `_resizeMode`, `_outlineDrag` and `_resizeDrag` after `_dragLastClientX` ([Table.ts:230](packages/lib/src/typescript/lib/component/table/Table.ts#L230)), exactly as `## Internal Structure` gives them.

4. **Accessors** — add `getResizeMode()` and `setResizeMode(mode)` as public methods on `Table`, with the JSDoc wording from [Split.ts:796-821](packages/lib/src/typescript/lib/layout/Split.ts#L796) adapted to a column drag. Refer to `Body.setResizeMode` in backticks, never `{@link}` — the docs build rejects a link from public JSDoc to a symbol it does not render.

5. **Split the arithmetic** — rename `onColumnResize`'s body to `private resolveColumnResize(colIndex: number, clientX: number, widths: number[], lastClientX: number): ColumnResizeStep | null`, changing only these five things and nothing else:
   - drop the `_dragEdgeIndex` guard (the callers keep it) and the `const widths = this._columnWidths;` line;
   - read `lastClientX` in place of `this._dragLastClientX` in the `frameDelta` computation;
   - `return null` where the dead-zone early return is;
   - delete the `_pinnedColumnWidths` block (step 6 re-homes it);
   - replace the four trailing assignments and `scheduleLayout()` with `return { widths: out, lastClientX: lastClientX + sign * delta, widthTarget: newTotal > available + WIDTH_TARGET_EPSILON_PX ? newTotal : 0 };`.

   Keep its JSDoc on `resolveColumnResize` — it describes the arithmetic — and note in it that the caller owns the writes. **The file does not typecheck again until step 7 restores `onColumnResize`**, which the constructor's `"columnresize"` subscription still names; run no check between here and there.

6. **Add `pinColumnWidths`, `applyColumnResize`, `previewColumnResize`, `commitColumnResize` and `columnEdgeOutline`** from `## Internal Structure`, placed after `resolveColumnResize`.

7. **Rewrite the two drag entry points.** `onColumnResizeStart` keeps its bounds guard and its two assignments, then:

   ```typescript
   const line = this.getResizeMode() === "outline" ? this.columnEdgeOutline(colIndex) : null;

   if (line === null) {
       this._outlineDrag = null;
       this._resizeDrag.beginLive();

       return;
   }

   this._outlineDrag = {
       line,
       startClientX: clientX,
       widths:       this._columnWidths.slice(),
       lastClientX:  clientX,
       widthTarget:  this._columnWidthTarget,
       moved:        new Set<number>(),
   };
   this._resizeDrag.beginOutline({ parent: this.getElement(true)!, start: line, zIndex: IN_PAGE_OUTLINE_Z_INDEX });
   ```

   `onColumnResize` becomes the guard plus a two-way branch:

   ```typescript
   if (this._dragEdgeIndex === null || colIndex !== this._dragEdgeIndex) {
       return;
   }

   if (this._outlineDrag !== null) {
       this._resizeDrag.schedule({ colIndex, clientX });

       return;
   }

   this.applyColumnResize(colIndex, clientX);
   ```

8. **Add the release handler** to `Table`:

   ```typescript
   private onColumnResizeEnd(): void {
       this._resizeDrag.end();

       this._outlineDrag   = null;
       this._dragEdgeIndex = null;
   }
   ```

   The two assignments come *after* `end()`, which is what reaches `commitColumnResize` and needs `_outlineDrag` still set.

9. **Cancel on teardown** — in `Table.destructor` ([Table.ts:1703](packages/lib/src/typescript/lib/component/table/Table.ts#L1703)), before `super.destructor()`, add `this._resizeDrag.cancel();` and `this._outlineDrag = null;` with a comment pointing at `Split.detach`'s equivalent.

10. **`HeaderCell` emits `"resizeend"`** — in `component/table/cell/Header.ts`: add `"resizeend"` to `HeaderCellEvent` ([Header.ts:29](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L29)); add `dragend: () => this.emit("resizeend"),` to the `ResizeHandle` listeners bag ([Header.ts:222-225](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L222)); add the `on` and `emit` overloads and extend the `on` JSDoc's event list. `onResizeDragStop` already calls `this._resizeHandle.dragEnd()` — leave it untouched.

11. **`TableHeader` forwards it** — in `component/table/Header.ts`: add `"columnresizeend"` to `TableHeaderEvent` ([Header.ts:182](packages/lib/src/typescript/lib/component/table/Header.ts#L182)); add `cell.on("resizeend", () => this.emit("columnresizeend"));` in `wireCell` after the `"resizedrag"` line ([Header.ts:1224](packages/lib/src/typescript/lib/component/table/Header.ts#L1224)); add the `on` and `emit` overloads and extend the `on` JSDoc's event list.

12. **`Table` subscribes** — after the `"columnresize"` wiring ([Table.ts:331](packages/lib/src/typescript/lib/component/table/Table.ts#L331)) add `this._header.on("columnresizeend", () => this.onColumnResizeEnd());`.

13. **Checkpoint** — `npm run typecheck`, `npm run lint`, then `npx vitest run tests/component/table/ColumnResize.test.ts` in `packages/lib`. That suite must pass **unedited**: it drives `onColumnResizeStart` / `onColumnResize` directly in live mode, which this change leaves synchronous. A failure here means step 5 or 7 changed the live path.

14. **New suite** — create `packages/lib/tests/component/table/ColumnResizeOutlineMode.test.ts` covering T1–T9 of `## Expected Behaviour`. Model it on [Split.resizeMode.test.ts](packages/lib/tests/component/layout/Split.resizeMode.test.ts): the same `installTestDOM` config, the same captured `requestAnimationFrame` / `cancelAnimationFrame` pair, the same `afterEach` that disposes every table, resets `setAppResizeMode('live')`, calls `Tooltip._stopPointerWatch()` and then `DOM.reset()`. Reuse `ColumnResize.test.ts`'s `makeTable` / `specWithAMax` fixture verbatim and reach the private handlers through the same cast, widened with `onColumnResizeEnd(): void`.

15. **Docs** — the four `packages/lib/docs/` files listed in `## Documentation Impact`. (The fifth file there, `packages/qa/README.md`, is step 16's.)

16. **QA label** — in `packages/qa/src/panels/table-rows.ts`, import `RESIZE_OUTLINE_SELECTOR` from `'../builders/shared.js'` and add `resizeOutline: RESIZE_OUTLINE_SELECTOR` to the `geometry` map; add `'table-rows'` to the `it.each` list at [packages/qa/tests/mount.test.ts:275](packages/qa/tests/mount.test.ts#L275); and in the `table-rows` row of `packages/qa/README.md`'s panel table ([README.md:325](packages/qa/README.md#L325)), append `resizeOutline` to the geometry-labels column with the wording the `shell-deep` and `windows` rows already use — `` `resizeOutline` (the resize outline; `null` unless an outline drag is on screen) ``.

17. **Final checks** — the whole `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/table/ColumnResizeOutlineMode.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/components/Body.md` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` — **shared** with every plan landing in this release |
| Modify | `packages/qa/src/panels/table-rows.ts` (one label, one import) |
| Modify | `packages/qa/tests/mount.test.ts` (one list entry) |
| Modify | `packages/qa/README.md` (one geometry label) — **shared** with `table-cell-date-formatter-memo`, which edits the `g23.write-economy` ablation rows of the same file |

`table-body-visible-records-memo` shares nothing with this plan; it touches `component/table/Body.ts` and `data/AbstractStore.ts`. `table-cell-date-formatter-memo` shares `packages/qa/README.md` and the changelog, and touches no file under `component/table/` that this plan touches.

---

## Expected Behaviour

T1–T9 are unit-testable offline. T10 needs a browser and is a documented manual check.

**The fixture** is `ColumnResize.test.ts`'s: four `string` columns A/B/C/D with `minWidth` `60/100/40/30`, the table at `setWidth(514)` / `setHeight(400)` for an available column width of 500, and starting widths planted as `[200, 150, 100, 50]`. A drag is `onColumnResizeStart(0, 1000)`, then one `onColumnResize(0, x)` per move, then `onColumnResizeEnd()`.

**Draining frames.** An outline move needs a drained frame after it — that is when the buffered move reaches the bar. A live move does not: it applies synchronously, and `ColumnResize.test.ts` asserts its widths before any layout runs. Keep that shape, so no case below drains a frame in live mode.

"The bar" is the session's outline, reached as `(table as unknown as { _resizeDrag: { _outline: Component | null } })._resizeDrag._outline`, mirroring `Split.resizeMode.test.ts`'s `outlineOf`.

**T1. Mode resolution.** `new Table(store).getResizeMode()` is `"live"`. After `setAppResizeMode("outline")` the same call is `"outline"`. `setResizeMode("live")` returns the table and makes it `"live"` again; `setResizeMode(null)` returns it to `"outline"`.

**T2. An outline drag leaves the table alone.** With `"outline"`, drain the frames the fixture itself queued, install `doLayout` and `scheduleLayout` spies, then press at 1000, move to 1080 and drain one frame. `getColumnWidths()` is still `[200, 150, 100, 50]`, `getColumnWidthTarget()` is still `0`, and neither spy was called. The bar exists, its parent element is the table's own element, `getWidth()` is `4`, `getY()` equals `table.getContentBounds()!.y`, `getHeight()` equals `table.getContentBounds()!.height`, `getTranslateX()` is `80`, and `getX() + 2` equals `header.getX() + header.getContentBounds()!.x + 200`.[^bar-x-assert]

**T3. The bar stops where the drag would stop.** With `specWithAMax(250)` and `"outline"`, press at 1000 and move to 1300: `getTranslateX()` is `50`, column A's own `maxWidth` having bound the travel 50 px out. Moving back to 1000 returns it to `0`. `getColumnWidths()` is unchanged throughout.

**T4. A move inside the dead zone leaves the bar where it is.** Continuing T3 from the 1300 position, a move to 1200 is entirely inside the dead zone the capped travel accrued: `getTranslateX()` stays `50`.

**T5. Both modes release to the same widths.** Press at 1000, move through 1080, and release. In `"outline"` and in `"live"` alike, `getColumnWidths()` is `[280, 100, 70, 50]` and `getColumnWidthTarget()` is `0`. After the release the bar is `null`.

**T6. A release with no movement commits nothing.** With `"outline"`, press at 1000 and release without a move: `getColumnWidths()` is `[200, 150, 100, 50]` and no layout was scheduled.

**T7. Escape cancels and commits nothing.** With `"outline"`, press at 1000, move to 1080, then dispatch a window `keydown` with `key: "Escape"`. The bar is `null`. A further move to 1200 changes nothing, and `onColumnResizeEnd()` leaves `getColumnWidths()` at `[200, 150, 100, 50]`.

**T8. Disposal mid-drag takes the bar down.** With `"outline"`, press at 1000, move to 1080, then `table.dispose()`. The bar's element has no parent, and `Event.listenerCounts().viewport` is back to its pre-drag value.

**T9. An unsized table falls back to live.** Build a table whose element exists (`getElement(true)`) and whose widths are planted (`setColumnWidths([200, 150, 100, 50])`, which schedules nothing) but which was never given a width or a height, so `getContentBounds()` offers no finite height. Under `"outline"` its drag still starts live: no bar is created, and a move to 1080 applies on the move itself, before any frame is drained, growing column A from 200 to 280. Assert the bar is `null` and `getColumnWidths()[0]` is `280`, and nothing else — how the rest of the array falls out depends on what an unsized table reports for its available width, which is not what this case is about.

**T10. Manual, in a browser.** Temporarily add `specTable.setResizeMode('outline');` after `specTable.setExportMenuEnabled(true);` in [MiscPanel.ts:744](packages/lib/src/typescript/MiscPanel.ts#L744), run `npm run dev` from `packages/lib`, and open the **Misc.** section. Drag one of that table's column headers by its right edge. A 4 px accent-blue bar spans the table from the top of the header band to the bottom of the body and follows the pointer; no header cell and no body cell moves until the button is released, at which point every column lands where a live drag would have left it. Press Escape mid-drag: the bar goes and nothing moves. Then drag the *last* column's right edge far to the right — the bar keeps tracking the edge and is clipped at the table's right edge once the edge passes it, which is where a live drag puts that edge too. **Revert the added line before committing.**

---

## Verification

From `packages/lib`:

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm run test:lint` — clean.
- `npx vitest run tests/component/table/ColumnResize.test.ts` — green **with no edits to that file**. This is the live-mode regression gate; cases 30–33 in it pin the live path's layout coalescing.
- `npm test` — green, with T1–T9 new.
- `grep -c 'this\.doLayout()' packages/lib/src/typescript/lib/component/table/Table.ts` — `7`, the count `master` has. The drag path schedules; it never lays out synchronously.
- `grep -n 'columnresizeend' packages/lib/src/typescript/lib/component/table/Header.ts` — a hit in each of: the `TableHeaderEvent` union, the `on` JSDoc, the `on` overload, the `emit` overload, `wireCell`. `grep -n 'columnresizeend' packages/lib/src/typescript/lib/component/table/Table.ts` — one, in the constructor.
- `grep -n 'resizeend' packages/lib/src/typescript/lib/component/table/cell/Header.ts` — a hit in each of: the `HeaderCellEvent` union, the `ResizeHandle` listeners bag, the `on` JSDoc, the `on` overload, the `emit` overload.
- `npm run docs:api` — the same warning count `master` has, and no new one. `npm run docs:llms:check` — clean.
- `npm run build:lib`, then `(cd ../qa && npm test)` — green; the `table-rows` panel still mounts under jsdom. This opens no window.
- `grep -n 'resizeOutline' ../qa/README.md` — four rows now: `shell-deep`, `shell-shallow`, `windows` and `table-rows`.
- T10 by hand, in the demo app.

**The measurement cell, for the campaign to run later.** This plan runs no QA measurement. The cell for the mode as built is `panel=table-rows&drive=drag,idle:4` with `work=1&seam=1&geom=1`, one arm adding `resize=outline`. `table-rows` already registers a `drag` target on the header's `.ResizeHandle` element and a `cell` geometry probe on `.TableBody .StringCell`, and `mount.ts` already turns `resize=` into an app-wide `Body.setResizeMode` call, so step 16's `resizeOutline` label is the only addition the cell needs. **Gate geometry on the last unit of the trailing `idle` phase, not across the burst**: under `"outline"` the mid-burst units differ from the live arm by design, and comparing them is what made the earlier `g22` reading look like a focus regression.[^measurement]

---

## Documentation Impact

`Table` is already exported from `component/table` and already has a doc page, so no barrel, catalog or sidebar entry changes. `llms.txt` indexes components by task, not by method, so it needs no edit — `npm run docs:llms:check` confirms.

- **`docs/components/Table.md`** — add a `### Live or outline resizing` section after `### Resizing columns`, written like [docs/layouts/Split.md](packages/lib/docs/layouts/Split.md)'s equivalent: what `'outline'` shows, that the mode is read when the drag starts, that Escape cancels, that a table with no mode of its own follows the app-wide default set through `Body.init`, and that `'live'` is the default. Add a `setResizeMode(mode)` row to `## Common methods`.
- **`docs/components/Body.md`** — lines 84, 90 and 98 each list the drags the app-wide mode governs as "a `Split` gutter, a resizable `Accordion` gutter and a window edge". Add a table's column-resize drag to all three.
- **`docs/concepts/performance.md`** — in `## Outline resizing`, add the table's column drag to the opening list, and **delete** "table column resize, which stays live" from the "What it does not cover" sentence at line 53, leaving the header-move and Tauri-frame exclusions.
- **`packages/qa/README.md`** — the geometry label, edited in step 16 alongside the panel it documents. The panel table's geometry column is that file's record of what a run can probe, so a label that ships without a row there is invisible to the next session.
- **`docs/reference/changelog/next.md`** — one entry under `## Added` → `### Components` (line 484): `Table` takes `getResizeMode()` / `setResizeMode(mode | null)`, `'live'` stays the default, `TreeTable` inherits it, and a table with none of its own follows `Body`'s.

---

## Potential Challenges

- **A stale `_dragEdgeIndex` today, cleared by this change.** Nothing resets it after a drag, so it survives until the next press. `onColumnResizeEnd` now nulls it; no other code reads it outside a drag, so nothing depends on the old value.
- **The bar is clipped where the edge would be clipped.** A drag that grows the table past its available width can put the dragged edge beyond the table's right edge, and `Table` sets `overflow: hidden`. The bar clips there. That is the same place live mode leaves the column edge, so the two modes agree; it is pinned as the second half of T10 rather than clamped.
- **The header's left border would offset the bar.** `columnEdgeOutline` adds the header's x and its content-box origin but no border width, which is correct only because `TableHeader`'s class chrome declares `borderBottom` alone. A left or right border added to the header later would shift the bar by its width; the method carries a comment saying so.
- **A body-cell probe mid-burst differs from the live arm on purpose.** A geometry gate that compares every unit will read the outline arm as broken. The measurement note under `## Verification` states the settled-state rule; do not widen it.

---

## Critical Files

| File | Why |
|---|---|
| [`core/ResizeDrag.ts`](packages/lib/src/typescript/lib/core/ResizeDrag.ts) | The seam: `ResizeMode`, `ResizeDragHooks`, `gutterOutline`, `IN_PAGE_OUTLINE_Z_INDEX`, `getAppResizeMode`, and `ResizeDrag`'s begin/schedule/end/cancel lifecycle. |
| [`layout/Split.ts:145-230`, `:796-821`, `:1380-1600`, `:1840-1862`](packages/lib/src/typescript/lib/layout/Split.ts#L1380) | The precedent this plan mirrors: frame and outline-state types, the accessor pair, the mode branch at drag start, `previewDrag`, `onDragEnd`, and the cancel on teardown. |
| [`component/table/Table.ts:2122-2245`](packages/lib/src/typescript/lib/component/table/Table.ts#L2122) | The drag arithmetic being split, and the growth / dead-zone rules its docstring carries. |
| [`core/DragChain.ts`](packages/lib/src/typescript/lib/core/DragChain.ts) | `chainRoom` caps each frame's travel, which is why the bar's offset equals the tracked pointer's travel. |
| [`component/table/cell/ResizeHandle.ts`](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts) | Already declares and fires the `dragend` event the release signal is built on. |
| [`component/table/cell/Header.ts:180-230`, `:495-560`, `:643-672`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L643) | The handle wiring, the event surface to widen, and the mouseup path that fires `dragEnd()`. |
| [`component/table/Header.ts:1205-1240`](packages/lib/src/typescript/lib/component/table/Header.ts#L1205) | `wireCell` and `columnIndexOf` — why the forwarded events resolve their index live, and why the release does not. |
| [`layout/Table.ts:150-300`](packages/lib/src/typescript/lib/layout/Table.ts#L150) | Where the header band and the inner rows are placed, which is the coordinate chain `columnEdgeOutline` walks. |
| [`component/shared/VirtualRowView.ts:480-580`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L480) | The row-layout deferral this plan deliberately leaves alone. |
| [`tests/component/table/ColumnResize.test.ts`](packages/lib/tests/component/table/ColumnResize.test.ts) | The live-mode contract that must keep passing unedited, and the fixture the new suite reuses. |
| [`tests/component/layout/Split.resizeMode.test.ts`](packages/lib/tests/component/layout/Split.resizeMode.test.ts) | The offline outline-drag test shape: frame capture, `outlineOf`, and the `afterEach` that unwinds module state. |
| [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md) | The `g22` sections: the measurement, the visibility problem, and the decision this plan implements. |

---

## Non-Goals

- **No change to live mode.** Its timing, its per-`mousemove` arithmetic and its `scheduleLayout()` hop all stay. `"live"` remains the default.
- **No `TableOptions` field.** See *The per-table override is a setter pair, with no options field*: the bag never reaches a consumer.
- **No outline for the row-height or table-width resize paths.** Only the column-edge drag gains the mode.
- **No extension of `VirtualRowView.deferRowLayoutWhileResizing`**, and no opt-in of the table body into it.
- **No new QA ablation, panel, driver or page parameter.** The cell is already drivable — `resize=`, the `.ResizeHandle` drag target and the body-cell probe all ship; only a geometry label is added to an existing panel.
- **No measurement run.** `packages/qa/runqa.sh`, the sweep scripts, MiniBrowser and the Tauri host each open a full-screen window and are not run by this plan.

---

## Notes

[^seam]: The alternative was a table-local flag plus a bar component of the table's own. It was rejected on two counts. The agenda's decision section is explicit that the contract already exists and a plan extends it rather than inventing a flag, and a parallel implementation would have had to re-solve the Escape and window-blur cancel, the between-drags reset, the release-time flush of the freshest buffered move, and the shared `.ResizeOutline` class rule that lets a drag write no stylesheet rule of its own — each of which `core/ResizeDrag.ts` already ships for three owners.

[^no-option]: `TableOptions` ([Table.ts:152](packages/lib/src/typescript/lib/component/table/Table.ts#L152)) is an empty interface, and `Table`'s constructor calls `super({ tag: "table" })` with its own literal; it accepts `(store, spec?, bodyFactory?)` and nothing else. So `applyOptions` can never see a consumer-supplied bag, and a `resizeMode` field on it would be documented API that no call can reach. `ColumnSpec` was the other candidate home — it is construction-time and does reach the consumer — but it is the column-presentation contract (per-column overrides, `autoSizeColumns`, `filterable`), and a drag-feedback mode is not column presentation. `ARCHITECTURE.md`'s third DOM-write rule asks for an options field for consumer-configurable properties; it presumes the bag reaches the consumer, which here it does not. The divergence is the missing option field alone — the getter, the setter, the `null`-means-default fallback and the read-at-drag-start timing all match `Split` exactly.

[^live-untouched]: Routing live moves through the session was considered and rejected. `PerFrameCoalescer` is trailing-edge only ([PerFrameCoalescer.ts:47](packages/lib/src/typescript/lib/core/PerFrameCoalescer.ts#L47)), so a live move would be applied from inside an animation-frame callback. `scheduleLayout()` called from there arms a fresh frame — `flushPendingLayouts` clears its own handle at the top precisely so re-entrant schedules land on the *next* frame ([Component.ts:263-276](packages/lib/src/typescript/lib/core/Component.ts#L263)) — so the layout would land one frame after the pointer move instead of the same frame, making the default drag visibly laggier. The other three owners avoid this because their `apply` hooks lay out synchronously; matching them would mean changing `applyColumnResize` to call `doLayout()`, which contradicts the reason `onColumnResize`'s own docstring gives for scheduling, and would require editing every case in `ColumnResize.test.ts` — including cases 30–33, which exist to pin that scheduling. The user's decision is that live behaves as it does today, so the live path is left alone. The visible cost of that choice is one property in the hooks object: `apply` is wired to `applyColumnResize`, the same method the live path calls directly, and the table does not reach it through the session. `beginLive()` still earns its call — it resets the session, so a previous outline drag left open cannot leak its bar or its buffered move into a live one.

[^travel]: `resolveColumnResize` caps `delta` at `chainRoom(left, …)`, and `distributeDragChain` distributes a `delta` no larger than the group's room in full ([DragChain.ts:72-86](packages/lib/src/typescript/lib/core/DragChain.ts#L72)). So the left chain's summed width changes by exactly `sign * delta`, which is also what `lastClientX` advances by. Measuring the bar from the tracked pointer rather than re-summing the widths keeps the two in lockstep by construction and needs no DOM read. The right chain's redistribution and the table's own growth are irrelevant to the bar: both happen to the *right* of the edge.

[^bar-geometry]: `gutterOutline(box, "x")` returns a 4 px-wide box centred on `box`'s centre line, so a zero-width rectangle at the edge yields a bar centred on the edge — the helper needs no change. The table's own element is the mount parent because the bar has to cross the header band and the body, which are siblings inside it; mounting inside the header instead would trap the bar in the stacking context the header's `will-change: transform` creates. `IN_PAGE_OUTLINE_Z_INDEX` is documented for exactly this case — an outline drawn in the page, above page content that forms no stacking context of its own and below every window. Appending a positioned `<div>` to the `<table>` element is what the header, body and footer children already do, so it introduces no new shape. The edge's x is built from component boxes rather than a `getBoundingClientRect` so the press costs no forced layout, following `Split`'s use of `rectOf`.

[^end-no-payload]: `columnresizestart` and `columnresize` both carry a column index, resolved live through `columnIndexOf` so a scroll or a hide cannot stale it ([Header.ts:1205-1220](packages/lib/src/typescript/lib/component/table/Header.ts#L1205)). A release does not need one: exactly one drag is ever live, and `columnIndexOf` returns `-1` for a cell the column window has recycled away — which a live drag that grows the table past its viewport can do — so an index on the release would add a way for the commit to be skipped and the bar to be stranded. `Split.onDragEnd()` takes no arguments for the same reason.

[^defer-contract]: The agenda notes that `deferRowLayoutWhileResizing` is "a shipped deferral contract for tree rows" and asks whether this work should extend it. It should not. That method's trigger is a *width change observed during a render pass*, with a two-frame settle relay to catch the rows up, and it is designed for a resize the view is told about only through its own geometry — its docstring says so explicitly ("nothing signals this view that a drag has ended"). An outline drag has the opposite shape: the table knows exactly when the drag starts and ends, runs no layout pass at all in between, and commits on a release rather than on a quiet frame. Extending the deferral would mean keeping a settle relay armed for a burst that produces no passes to withhold. The two mechanisms also cannot collide: `"outline"` schedules no layout during the drag, so no `renderWindow` call happens for a deferral to intercept, and `"live"` is unchanged.

[^bar-x-assert]: The bar's absolute x depends on `TableHeader`'s content insets, which come from the theme's default options rather than from anything the fixture sets. Asserting `getX() + 2` against the header's own content origin plus the first column's width states the real contract — the bar is centred on the dragged edge — without pinning a number the theme owns.

[^measurement]: The figures the agenda records for `g22.settle-relay` — `treetable-rows` · `resize` at 103.02 → 81.58 ms per frame and work −92.4% — are indicative of the payoff, not a prediction for this mode. Two things differ. That ablation was driven by `drive=resize`, the harness's window-resize stand-in, which re-lays the whole table out at a new width each frame ([packages/qa/src/harness/drivers.ts:272](packages/qa/src/harness/drivers.ts#L272)) — not a column-edge drag. And it deferred cell bounds within a pass that still ran, whereas `"outline"` runs no pass at all and paints a bar instead. The cell above measures the mode as built; nothing here should be reported as its expected result.

---

## Implementation Notes

Eleven notes. Five are prescribed verifications that could not have caught a
regression; three are gaps the prescribed cases left open; one is a defect the
audit found in the shipped code, over two rounds, and the plan's own blind spot
behind it; one records a step of the implement skill this plan deliberately
scoped out; one lists what is left to verify by hand.

### T8 as prescribed cannot pass

`## Expected Behaviour`'s T8 asks that after `table.dispose()` mid-drag,
"`Event.listenerCounts().viewport` is back to its pre-drag value". It is not, and
cannot be: disposing the table also unregisters the eight viewport listeners a
live table of this fixture holds, so the count reads 3 against a pre-drag 11
whether or not the bar was cleaned up. The assertion compares two different
populations and fails on a correct implementation — it failed on the first run of
the finished code.

Rewritten to measure the residue instead: a control table of the same shape is
built and disposed first, giving what one table's disposal leaves behind (the
session-wide watches a `Tooltip` installs, which outlive every table); the case
then asserts that starting the drag adds exactly two listeners — the bar's
`keydown` and its window `blur` — and that disposing the dragging table returns
the count to that residue. Mutation-checked: deleting `this._resizeDrag.cancel()`
from `Table.destructor` turns it red, which the prescribed form would not have.

### Three of T2's geometry assertions cannot fail in T2's own fixture

T2 asserts `getY()` against `table.getContentBounds()!.y` and `getX() + 2`
against `header.getX() + header.getContentBounds()!.x + 200`. In the fixture the
content origin is `(0, 0)`, the header sits at `x: 0`, and the header's scroll
offset is 0 — so a `columnEdgeOutline` that wrote `y: 0` outright, or dropped
`this._header.getX()`, or dropped `- this._header.getScrollX()`, passes T2
unchanged. All three were confirmed by mutation.

Two cases were added rather than the fixture changed, since `## Ordered
Implementation Steps` step 14 asks for it verbatim. **T14** gives a table of the
same shape `Insets(7, 0, 0, 5)`, which moves the content origin to `(5, 7)` and
the header to `x: 5`, and asserts the bar's top, height and x against them; it
plants the widths after the fixture's own layout pass, because a pass over an
inset table rescales them to its narrower band. **T15** scrolls the header 30 px
and asserts the bar lands on the visible edge. One term stays unfalsifiable
offline: `headerBox?.x ?? 0` is 0 for every table the harness can build, because
`TableHeader` declares no left content inset. It is defensive against one being
added later — which is the exposure `## Potential Challenges` already names — and
only T10, by hand, sees the composed result.

### Nothing in T1–T9 reaches the widths a release pins

`commitColumnResize`'s `pinColumnWidths(outline.moved, outline.widths)` could be
deleted outright, and every prescribed case stays green; so could
`movedColumns`'s own comparison, and so could `commitColumnResize`'s
`scheduleLayout()`. Three assertions were added. T5 now asserts the pinned map
and that exactly one layout is scheduled across the whole drag in **both** modes
— outline on the release, live on the move, one either way. **T16** runs the same
drag out and back in both modes and asserts they pin the identical map, which is
what the `moved` Set buys: column A ends where it started, so a diff of the
committed widths against the final ones would not pin it, while `moved` does.
Substituting that diff is a mutation only T16 catches.

### The event chain the plan adds is verified by greps alone

`## Verification` checks `resizeend` and `columnresizeend` with `grep -n`. A grep
cannot tell a wired listener from an unwired one, and the chain — `ResizeHandle`'s
`dragend` to `HeaderCell`'s `"resizeend"` to `TableHeader`'s `"columnresizeend"`
to `Table.onColumnResizeEnd` — is the whole reason two files outside `Table.ts`
are touched. Every prescribed case calls `onColumnResizeEnd()` directly, so
deleting any one of the three forwardings leaves the suite green. **T17** drives
the gesture through the real events instead: a `mousedown` on the first header
cell's resize handle, then the viewport `mousemove` and `mouseup` that
`HeaderCell.onResizeDragStart` installs. Deleting any of the three forwardings
turns it red.

### Nothing pinned `beginLive()`

`[^live-untouched]` argues the call earns its place because it resets the
session, "so a previous outline drag left open cannot leak its bar or its
buffered move into a live one" — but no prescribed case switches mode with a
drag open. **T18** does: it presses in outline mode, switches the table to
`'live'`, presses again, and asserts the stale bar is gone and off screen.
Removing `this._resizeDrag.beginLive()` was the only one of twenty-six mutations
the suite failed to catch before T18 existed.

### T1's tables had to be registered for disposal

As prescribed, T1 builds `new Table(store)` three times and disposes none of
them. Every `Table` leaves entries in `Event`'s per-type registration maps, which
`DOM.reset()` does not clear; a surviving type map then stops the next case's
`addListener` re-registering the base listener against the fresh sink, and T17 —
the only case that dispatches real DOM events — heard nothing and failed. T1 now
builds its tables through a helper that registers them for the `afterEach`
disposal every other case already relied on. This is the same hazard
`Split.resizeMode.test.ts`'s `afterEach` comment describes, reached from the
other side.

### The `moved` Set, and what `commit`'s argument is for

`ResizeDragHooks.commit` receives the last buffered move; `commitColumnResize`
ignores it, as `## Internal Structure` specifies. Worth recording why that is
sound rather than sloppy: `ResizeDrag.end()` force-flushes the buffer through
`preview` before it calls `commit`, so `_outlineDrag.widths` already holds the
freshest move's result and the argument would be a second, redundant route to
the same numbers — resolving it again would double-count the travel.

### The abnormal-termination paths, and where each is pinned

Enumerated because deferring the body's relayout means the header and body
disagree for the length of the drag, and every way the drag can end has to
resolve that. Escape — T7. The browser window losing focus — T11 (the plan pins
only Escape; both reach `ResizeDrag.cancel` through the bar's own viewport
listeners, but only a Table-level case proves the table's session is the one
being cancelled). Disposal mid-drag — T8. A fresh press over a drag still open,
in outline mode — T12, and in live mode — T18. A release after a cancel, which
must commit nothing — the tails of T7 and T11. A release with no move at all —
T6. A move after a release, which the newly-cleared `_dragEdgeIndex` makes inert
— T13. There is no `pointercancel` path to pin: `HeaderCell` drives the gesture
with mouse events, and a release outside the browser window arrives as the
window blur T11 covers.

### The plan never considers the column set changing mid-drag

Found by the audit, and a real defect in the code as first written. An outline
drag holds a private copy of the widths taken at the press, and `## Internal
Structure` has the release commit that copy back unconditionally. Seven paths
rebuild the columns or their widths without knowing a drag is open —
`setStore`, `setColumnVisible`, `resetColumns`, `bindView`, the two rotated
rebuilds and `maybeResampleColumnWidths` — and the plan considers none of them.
`[^end-no-payload]` makes it worse by arguing the release needs no column index
because "exactly one drag is ever live", which is true, and because
`columnIndexOf` returns `-1` for a recycled cell, which is exactly how a release
can go missing altogether.

Three consequences were reproduced. Hiding a column the drag had spilled travel
onto made the release throw, because `pinColumnWidths` looks each moved index up
in a column list that had since shrunk — and it had already pinned a stale width
before throwing, and the throw skipped `onColumnResizeEnd`'s own clearing.
Hiding the dragged column itself stranded the bar on screen with its two
viewport listeners, because the cell whose mouseup would have released it was
recycled away. And a width re-sample mid-drag was overwritten on release by the
press-time snapshot, so the two modes stopped landing in the same place — the
one thing T5 exists to guarantee.

Fixed with `Table.cancelOutlineColumnDrag()`, called from every path that
rebuilds the columns or their widths. It follows `AbstractWindow.setWindowState`,
which cancels its own session when another path changes what the drag is
resizing; `Split` needs no equivalent because a pane cannot leave
mid-gutter-drag, which is why the plan's precedent had nothing to copy here. The
method is a no-op outside an outline drag, so `'live'` never reaches it — a live
drag advances its tracked pointer every move and reads the rebuilt widths on the
next one, exactly as it does today, which `## Non-Goals` requires.

Two further defects in that fix, both found by the audit's second round, both in
the same blind spot. First, clearing `_outlineDrag` alone was not enough to end
the gesture: the button is still down, so moves keep arriving, and with the
dragged edge still set they applied *live* from `_dragLastClientX` — which an
outline drag never advances — jumping the edge by the whole travel since the
press and pinning the result. The dragged edge is cleared too now, which ends
the gesture; the user releases and presses again. The first attempt left it set
on the reasoning that a live drag survives a rebuild today, which was wrong: a
live drag advances its tracked pointer every move, so it has no accumulated
travel to jump by. `AbstractWindow` blocks post-cancel moves through its own
state guard, which is the half of that precedent the first fix missed.

Second, the explicit call sites were not the whole set. The layout manager writes
the widths back through `setColumnWidths` on every pass and rescales them when
the available width changes, so a pass the drag never asked for — the container
resized, a vertical scrollbar appearing on load — left the snapshot describing
widths the table no longer had, and the release undid the rescale and restored a
total the container could not hold. `setColumnWidths` now abandons an open drag
when the widths it writes differ from the ones already there; an unchanged write,
which is what an ordinary pass mid-drag performs, leaves it alone, or every
unrelated layout during a drag would silently cancel it. T21 pins that, T27 the
pass that must not abandon.

**A third round of the audit caught a regression introduced by the second.**
Seeing the backstop catch every case the tests then covered, the second fix
deleted six of the seven explicit calls as dead code. They are not. The
mutation tests that licensed the deletion all ran on the suite's flexible
`string` fixture, where a layout pass always rescales, so the backstop always saw
a change. On a table whose every column is fixed-width — four `number` columns —
`rescaleWidths` returns the widths it was handed untouched
(`layout/Table.ts:492`), and `setColumnVisible` and `resetColumns` assign
`_columnWidths` themselves *before* laying out. The setter then compares the new
widths against themselves, finds no change, and the drag survives: hiding a
column the drag had spilled onto made the release throw again, and a reset was
undone by it. That is the same crash this note opened by claiming was fixed.

The six calls are restored, and `## Expected Behaviour`'s reasoning is not
something the flexible fixture can check. T28–T30 run the hide, the re-show and
the reset against a fixed-width fixture built for the purpose, and pin
`setColumnVisible`'s and `resetColumns`' own calls; T22 pins
`maybeResampleColumnWidths`', which the backstop cannot cover at all because it
clears the widths itself and only *schedules* the pass. The remaining four —
`setStore`, `bindView`, the rotated `selectRecord` and the rotated store refresh
— are belt-and-braces: each sets `_columnWidths = []`, so the length change alone
guarantees the backstop fires whatever the fixture, and removing any of them
leaves the suite green. They stay anyway. Deleting a guard because the tests in
hand cannot distinguish it from a redundant one is precisely the move that
produced this regression, and the lesson is recorded here rather than acted on
twice.

This reached beyond the plan's `## Files to Create / Modify / Delete` in one
other way. `core/Body.ts`'s three API-doc mentions of the drags the app-wide
mode governs, `core/ResizeDrag.ts`'s own header comment and `ResizeMode`
docstring, and `core/index.ts`'s barrel comment all still said three owners and
"each owner's own `resizeMode` option" — which is wrong twice over now, since
`Table` is the fourth and deliberately has no such option. `## Documentation
Impact` lists only the `docs/` tree, so the generated API reference would have
kept contradicting the feature. Two comments inside `Table.ts` also pointed at
`onColumnResize` for behaviour that step 5's rename moved into
`resolveColumnResize` and `applyColumnResize`. And `Table.md` gained a paragraph
on the abandon rule, since when a drag is called off rather than committed is
something a consumer has to be able to predict.

### No permanent demo

The implement skill's step 7 asks for a demo of the new feature. This plan
instead folds the demo line into T10's manual procedure and says to revert it
before committing, and `MiscPanel.ts` is absent from `## Files to Create /
Modify / Delete`. Left as the plan has it: a demo table permanently in outline
mode would contradict the decision that `'live'` is the default, and a toggle
control is more than the plan sanctions.

### Still to verify by hand

This section and the closure of the render-review agenda's G22 entry
(`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`, a file
`## Files to Create / Modify / Delete` does not list) ride in the branch's one
extra bookkeeping commit, following the precedent of `bf83fc4c`, `e06c4170`,
`5f4003d3` and `f9b458a5`.

T10 is unchanged and is the only step of `## Verification` not run here: offline
tests cannot show a bar tracking a real pointer, nor the clipping at the table's
right edge once the dragged edge passes it. Its procedure stands as written —
temporarily add `specTable.setResizeMode('outline');` after
`specTable.setExportMenuEnabled(true);` in `MiscPanel.ts`, `npm run dev` from
`packages/lib`, and drag in the **Misc.** section. No window was opened from this
run.
