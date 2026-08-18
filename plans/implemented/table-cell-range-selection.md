# Table Cell-Range Selection and Copy — Implementation Plan

## Overview

Two reports share one cause. [`Body.onCopy`](packages/lib/src/typescript/lib/component/table/Body.ts#L1572) builds the clipboard payload by resolving the browser's native `Selection`/`Range` against [`Body.renderedCellGrid`](packages/lib/src/typescript/lib/component/table/Body.ts#L1648), which only enumerates the pool rows currently in the DOM. `Body` virtualizes rows and columns — [`VirtualRowView`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L47) recycles pool-row elements onto new records as the user scrolls, without ever moving them in the DOM. A native selection anchored to those elements silently comes to describe whatever data now occupies them, so a drag-selection that survives a scroll copies the wrong thing (bug 2), and there is no way to copy a cell at all without first drag-selecting its rendered text (bug 1).

The fix replaces native-selection-based copy with a virtualization-safe model: a rectangular cell range tracked by record identity and column index, rendered as a per-cell highlight on every render pass, and read out for both Ctrl+C and a new right-click "Copy" menu item without ever touching the DOM. This mirrors the existing row-selection model (`_selectedRecords`/`_anchorRecord`), which already solves the identity-vs-DOM-position problem for whole rows.

The whole change lives in `Body`, `Cell`, `Table`, the DOM sink seam, and the theme system:

- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — new range-selection state, mouse-driven range gestures, the right-click handler, and the rebuilt copy path. The old DOM-Range-based copy path is deleted.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) — one new boolean visual state, composed into the existing background-tint precedence chain.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) — wires the new right-click event to a "Copy" menu item, reusing the existing column context menu.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — one new page-level sink method, `writeClipboardText`, so clipboard writes go through the seam like every other browser capability.
- [`packages/lib/src/typescript/lib/core/Theme.ts`](packages/lib/src/typescript/lib/core/Theme.ts) and the three built-in theme files — one new themed color for the range highlight.

---

## Architecture Decisions

### Range state is keyed by record identity and column index, mirroring row selection

`Body` gets two new fields, `_rangeAnchor` and `_rangeFocus`, each `{ record: ModelRecord, col: number } | null`. Row position is resolved live via `getVisibleRecords().indexOf(record)` wherever needed, exactly how `_anchorRecord` already works.[^identity-precedent] Column position is a plain visible-column index, the same basis `_focusedColIndex` and `ColumnWindow` already use. This generalizes the row-selection pattern to two axes instead of inventing a new identity scheme.

### The drag gesture is new; `reduceModifierSelection` does not generalize to it

[`reduceModifierSelection`](packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts) resolves one click event against a 1-D member set. It has no notion of a continuously-tracked pointer or a second (column) axis, so it cannot drive a drag. What *does* generalize is its shift-range branch's shape — the anchor stays fixed, the moving end follows the gesture — which the new mousedown/mousemove/mouseup handlers reproduce directly instead of routing through the helper.[^shift-parity] Ctrl-click toggle (discontiguous multi-cell selection) is not implemented; a drag selection is always one contiguous rectangle, matching how every mainstream spreadsheet-style grid handles cell selection and matching what a single TSV block can represent.

### The rectangle is a side effect of the drag; no header-driven entry point is added

Dragging from one cell to another already produces a multi-row, multi-column rectangle — "selecting multiple columns" falls out of the same gesture that selects multiple rows. No click-or-drag handling is added to `TableHeader`/`HeaderCell` for this feature.

### Native text selection is suppressed for the duration of a range drag, not disabled globally

`onCellMouseDown` does not call `preventDefault()` — a blanket `preventDefault` on cell mousedown has broken mousedown-driven descendants before (an overlay `Scrollbar` drag inside a dropdown's focus-loss guard).[^prevent-default-trap] Instead, mousedown arms three viewport listeners — `mousemove`, `mouseup`, and `selectstart` — and the `selectstart` listener unconditionally returns `{ stop: true, prevent: true }` until `mouseup`. This is the exact mechanism [`DragManager.onSourceMouseDown`](packages/lib/src/typescript/lib/overlay/DragManager.ts#L323) already uses to stop native text selection from painting alongside a mouse-driven drag over selectable cell text[^selectstart-precedent] — table cell text keeps `user-select: text` unchanged; only the live gesture window suppresses selection from starting. Character-level (sub-cell) copy is consequently no longer possible — a range always copies whole cells. `resolveClickedColumn` and a small new helper, `locateCellFromTarget` (which additionally resolves the pool row and record), are reused for hit-testing on every mousedown/mousemove/contextmenu; `Body.onSubtreeClick`'s own inline row-walk is left untouched rather than refactored onto the new helper, since it is working, tested code with no bug to fix here.

A plain click is a zero-distance drag, so `onCellMouseDown` alone (anchor = focus = the clicked cell) is what makes Ctrl+C copy exactly the last-clicked cell with no prior drag — this satisfies bug 1's "copy without first selecting" requirement for the keyboard path, and the right-click decision below covers the mouse path. `onCellMouseDown` calls `this.focus()` unconditionally (no active-editor check is needed — mousedown on an editing cell bails before reaching it), because a genuine multi-cell drag never fires a `click` event at all (mousedown and mouseup land on different elements), so the existing `onRowClick`'s own focus call cannot be relied on to run after a drag.

### Right-click never mutates the persistent range — it computes an ephemeral copy target

The investigation's tentative suggestion was to collapse the selection to the clicked cell before opening the menu. Checking this against [`Tree._handleContextMenu`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1191) — the library's only other selection-aware right-click flow — shows the opposite rule: right-click *deliberately does not change the selection*, and the menu instead acts on the resolved target the event carries directly.[^tree-contextmenu] `Body.onCellContextMenu` follows that: it resolves the right-clicked cell into a short-lived `_contextMenuCell` field, leaves `_rangeAnchor`/`_rangeFocus` and the highlight untouched, and emits `"cellcontextmenu"` with just the viewport coordinates (mirroring `ParentHeaderCell`'s `(x, y)`-only contextmenu shape, since the listener does not need a field name). `Body.copyContextMenuSelection()` — the menu's "Copy" action — then computes the *effective* range at click time: the current range if `_contextMenuCell` falls inside it, otherwise just that one cell. See the worked table below.

| Right-click target | Current persistent range | Effective copy range | Persistent range changed? |
|---|---|---|---|
| Cell (R2, B), nothing selected yet | none | just (R2, B) | No |
| Cell (R2, B), inside range R1–R3 × A–B | R1–R3 × A–B | R1–R3 × A–B (unchanged) | No |
| Cell (R5, C), outside range R1–R3 × A–B | R1–R3 × A–B | just (R5, C) | No |

A right-click on an actively-editing cell, a separator row (rotated mode), or outside every cell is left to the browser (no menu, matching `Tree._handleContextMenu`'s "empty space is left to the browser" rule and `onCellMouseDown`'s same editing-cell bail).

### The context menu is the existing `Table._columnContextMenu` instance, reused

`Table` already owns one rebuild-mode `Menu` for the column header's right-click (`_columnContextMenu`, shown via `showColumnMenu`). Since a column-header right-click and a body-cell right-click never happen at once, the new `showCellMenu(x, y)` method reuses the same field rather than allocating a second `Menu` — `Menu.show()` fully rebuilds its item list on every call, so there is nothing to reset between uses.[^menu-reuse]

### Copy text comes from `TableExporter`/`CellTextResolver`, not from live cell renderers

A cell range can span rows and columns that are not currently rendered — that is the entire bug being fixed. Formatting a value with no live `CellRenderer` is already a solved problem: `Table.exportCSV`/`exportJSON` format arbitrary (possibly unrendered) records through [`TableExporter.formatValue`](packages/lib/src/typescript/lib/component/table/TableExporter.ts#L108), which resolves combo/date/time/datetime display text via an owner-held [`CellTextResolver`](packages/lib/src/typescript/lib/component/table/cell/CellText.ts#L63) and passes every other value through unchanged. `Body` gets its own `_cellText: CellTextResolver` field (mirroring `_editorPool`, disposed in `destructor()`), and uses it uniformly for every cell in a copy — rendered or not — so a range that starts on-screen and ends off-screen does not silently switch formatting mid-selection.[^formatting-fidelity]

### `buildTsv` does not survive; a plain rectangular assembler replaces it

`buildTsv` formats a *row-major span* — a shape that trims only its two boundary cells and takes every column in between, matching what a native browser `Range` produces when you drag from the middle of one line of text to the middle of another. A rectangular cell range is a different shape entirely: every row uses the *same* `[minCol, maxCol]`, with no boundary-row special case and no character offsets (see the previous decision). `buildTsv` is deleted along with the rest of the DOM-Range path; the new exported, pure `buildRectangularTsv(rows: string[][]): string` just joins an already-sliced grid with tabs and newlines. `escapeTsvField` is unchanged and reused.

### Copy is triggered by keydown + the Clipboard API, not the native `copy` DOM event

The old path relied on a native `copy` event, which browsers fire only when there is something for the default handler to consider copying (traditionally a non-collapsed `Selection`). The new model keeps no native selection at all, so nothing guarantees a `copy` event still fires. Rather than fabricate a dummy native selection purely to keep that event alive, `Body.onKeyDown` gets a new branch that detects Ctrl/Cmd+C directly and calls the same `copySelectionToClipboard()` the rest of the design already needs — unifying the keyboard trigger and the menu-item trigger onto one code path and removing the dependency on ambiguous native-selection-requires-copy-event behavior entirely. `onCopy`, `buildSelectionText`, `renderedCellGrid`, and `locateCellInGrid` are deleted; the `"copy"` subtree listener registration in `init()` is removed. No other file references any of these four symbols.[^grep-verified]

### Clipboard writes go through a new `DOM.sink` method

`navigator.clipboard.writeText` is a page-level browser API with no element receiver — the same shape as [`DOMSink.setLocationHash`/`pushHistoryPath`](packages/lib/src/typescript/lib/core/DOM.ts#L647), which are already seamed for exactly this reason.[^clipboard-seam] A new `DOMSink.writeClipboardText(text: string): void` is added next to them; `ProductionDOMSink` calls `navigator.clipboard?.writeText(text)` (optional-chained — the Clipboard API is undefined in non-secure contexts) and `RecordingDOMSink` records the call so tests can assert on it without a real `navigator.clipboard` existing (this project's tests run under Node, where no such global exists at all). `Body.copySelectionToClipboard()`/`copyContextMenuSelection()` call `DOM.sink.writeClipboardText(...)`, never `navigator` directly.

### The highlight is a new `Cell` boolean state composed into the existing tint precedence, not a raw DOM write

`Cell._applyStateTint()` already resolves one background color from two precedence-ordered inputs (`_readOnly`, `_baseBackground`). A third, `_rangeSelected`, is added ahead of both — a selected cell shows the same accent regardless of read-only or group-color state, mirroring how row selection already wins over the dirty/new/stripe tint in `updateRowVisualState`. This reuses `Cell`'s own idempotent setter + composed-tint machinery instead of Body writing raw inline styles on top of what `Cell` owns, which would fight `Cell`'s own cached writes on the same `background-color` property.[^why-not-raw-write] The color reuses the framework's single selection accent hue via a new dedicated token, `--ts-ui-table-cell-range-selected` (`theme.table.cell.rangeSelectedBackground`), defaulted to the same per-theme rgba values `table.row.selected` already uses — a new token because every other themed color in this immediate neighborhood (`readonlyBackground`, `requiredEmptyOutlineColor`, `table.row.selected`) gets its own dedicated `Theme` field, and this is not an exception.

`Body.updateCellRangeVisualState(i)` repaints one pool row's cells and is called from the same two places `updateRowVisualState` already is: (a) inside `bindAndPositionRows`'s per-row loop, gated on `wasRebound || windowChanged`, so a cell scrolled into view picks up correct highlight state without a full sweep on every scroll tick;[^scroll-perf] (b) a new full-sweep helper, `refreshCellRangeHighlight()`, called after every gesture that can change the range (mousedown, a mousemove whose resolved cell actually changed, and nowhere else — right-click never calls it, per the earlier decision).

### `TreeBody`'s reparent drag is not coordinated with the new range drag — flagged, not fixed

[`TreeBody`](packages/lib/src/typescript/lib/component/table/TreeBody.ts) wires each pooled row as a `DragManager` drag source (`DragManager.makeDragSource`, TreeBody.ts:612), which itself installs a mousedown-triggered `mousemove`/`mouseup`/`selectstart` viewport listener set — the exact same mechanism this plan adds at the `Body` level. On `TreeTable`, a mousedown on a row's cell now arms *both* trackers independently; nothing coordinates them. This is out of scope here (see Non-Goals) and left as an explicit follow-up. `onCellMouseDown`, `onCellDragMove`, `onCellDragEnd`, and `onCellContextMenu` are declared `protected` — the same visibility `onSubtreeClick`/`onKeyDown`/`afterRowBound` already use for `TreeBody`'s benefit — specifically so a future fix can override them without another refactor.

---

## Public API

```typescript
// Body.ts
export type BodyEvent = "verticalscroll" | "horizontalscroll" | "selection" | "cellclick" | "cellcontextmenu";

class Body extends VirtualRowView<Row> {
    on(event: "cellcontextmenu", listener: (x: number, y: number) => void): this;

    /** Copies the current cell-range selection (Ctrl/Cmd+C path). No-op when nothing is selected. */
    copySelectionToClipboard(): void;

    /** Copies the effective right-click copy target (menu "Copy" path). No-op when no cell was right-clicked. */
    copyContextMenuSelection(): void;
}

/** Pure TSV assembler over an already-sliced row-major grid. Replaces `buildTsv`. */
export function buildRectangularTsv(rows: string[][]): string;
```

```typescript
// Cell.ts
class Cell<T> extends Component {
    /** Toggles the cell-range-selection highlight. Backing field: `_rangeSelected` (private, default `false`). */
    setRangeSelected(value: boolean): this;
}
```

```typescript
// DOM.ts
interface DOMSink {
    /** Writes `text` to the system clipboard. Page-level; no element receiver. */
    writeClipboardText(text: string): void;
}
```

```typescript
// Theme.ts
interface Theme {
    table: {
        cell: {
            // existing fields unchanged …
            rangeSelectedBackground: string;
        };
    };
}
```

---

## Internal Structure

```typescript
// Body.ts — the widened `emit` implementation signature (step 8). Only the
// implementation signature and its body change; every existing overload
// (`"verticalscroll"`, `"selection"`, `"cellclick"`, …) and every existing
// call site are unchanged — TypeScript checks call sites against the
// overload list, not this signature.
protected emit(event: "verticalscroll" | "horizontalscroll", offset: number): void;
protected emit(event: "selection", records: ModelRecord[]): void;
protected emit(event: "cellclick", detail: CellClickEvent): void;
protected emit(event: "cellcontextmenu", x: number, y: number): void;
protected emit(event: BodyEvent, ...payload: unknown[]): void {
    this._listeners.fire(event, ...payload);   // was: fire(event, payload) — now spreads
}
```

```typescript
// Body.ts — new private state
private _rangeAnchor    : { record: ModelRecord, col: number } | null = null;
private _rangeFocus     : { record: ModelRecord, col: number } | null = null;
private _contextMenuCell: { record: ModelRecord, col: number } | null = null;
private _cellText       : CellTextResolver = new CellTextResolver();
```

```typescript
// Body.ts — bounds + hit-testing shared by every range operation.
type CellRangeBounds = { minRow: number, maxRow: number, minCol: number, maxCol: number };

private getCellRangeBounds(
    anchor: { record: ModelRecord, col: number } | null,
    focus:  { record: ModelRecord, col: number } | null,
): CellRangeBounds | null {
    if (!anchor || !focus) { return null; }

    const records   = this.getVisibleRecords();
    const anchorRow = records.indexOf(anchor.record);
    const focusRow  = records.indexOf(focus.record);

    if (anchorRow === -1 || focusRow === -1) { return null; }   // record removed/filtered since selection

    return {
        minRow: Math.min(anchorRow, focusRow), maxRow: Math.max(anchorRow, focusRow),
        minCol: Math.min(anchor.col, focus.col), maxCol: Math.max(anchor.col, focus.col),
    };
}

/** Walks up from `target` to the pool row that owns it, mirroring `onSubtreeClick`'s own walk, then resolves the column. Returns null off a separator row, a hidden row, or a target outside every cell. */
private locateCellFromTarget(target: Handle | null): { row: Row, cell: Cell<any>, record: ModelRecord, col: number } | null {
    let node = target;

    while (node) {
        const row = this._rowPool.find(r => r.getElement() === node);

        if (row) {
            if (row.isSeparator()) { return null; }

            const record = row.getData();
            if (!record) { return null; }

            const cells = row.getComponents() as Cell<any>[];
            const slot  = resolveClickedColumn(cells, target);
            if (slot < 0) { return null; }

            return { row, cell: cells[slot], record, col: slot + row.getColumnWindowStart() };
        }

        node = DOM.source.getParentElement(node);
    }

    return null;
}
```

```typescript
// Body.ts — the two public copy entry points, and the bounds-containment
// check `copyContextMenuSelection` uses to decide "existing range or just
// this cell" (the worked table in the right-click Architecture Decision).
private isCellWithinBounds(cell: { record: ModelRecord, col: number }, bounds: CellRangeBounds | null): boolean {
    if (!bounds) { return false; }

    const row = this.getVisibleRecords().indexOf(cell.record);

    return row >= bounds.minRow && row <= bounds.maxRow && cell.col >= bounds.minCol && cell.col <= bounds.maxCol;
}

copySelectionToClipboard(): void {
    const bounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus);
    if (!bounds) { return; }

    DOM.sink.writeClipboardText(this.buildCopyText(bounds));
}

copyContextMenuSelection(): void {
    if (!this._contextMenuCell) { return; }

    const currentRange = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus);
    const bounds        = this.isCellWithinBounds(this._contextMenuCell, currentRange)
        ? currentRange
        : this.getCellRangeBounds(this._contextMenuCell, this._contextMenuCell);

    // Falls through here (rather than a non-null assertion above) so a
    // `_contextMenuCell` whose record was removed from the store between the
    // right-click and the menu click — `getCellRangeBounds` returns null for
    // both branches in that case — copies nothing instead of throwing.
    if (!bounds) { return; }

    DOM.sink.writeClipboardText(this.buildCopyText(bounds));
}
```

```typescript
// Body.ts — highlight repaint. Mirrors `updateRowVisualState`'s two call
// sites exactly: a full sweep after a range-changing gesture, and a
// per-row call from `bindAndPositionRows` gated on wasRebound || windowChanged.
private refreshCellRangeHighlight(): void {
    this._boundIndices.forEach((dataIdx, i) => {
        if (dataIdx !== -1) { this.updateCellRangeVisualState(i); }
    });
}

private updateCellRangeVisualState(i: number): void {
    const row = this._rowPool[i];
    if (row.isSeparator()) { return; }

    const dataIdx = this._boundIndices[i];
    const record  = this.getVisibleRecords()[dataIdx];
    if (!record) { return; }

    const bounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus);
    const cells  = row.getComponents() as Cell<any>[];
    const start  = row.getColumnWindowStart();

    for (let slot = 0; slot < cells.length; slot++) {
        const col      = start + slot;
        const inRange  = !!bounds
            && dataIdx >= bounds.minRow && dataIdx <= bounds.maxRow
            && col >= bounds.minCol && col <= bounds.maxCol;

        cells[slot].setRangeSelected(inRange);
    }
}
```

```typescript
// Body.ts — copy text assembly, shared by the two public copy methods
private buildCopyText(bounds: CellRangeBounds): string {
    const records = this.getVisibleRecords();
    const fields  = this.computeVisibleFields();
    const rows: string[][] = [];

    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
        const record = records[r];
        if (this._rowSeparator?.(record)) { continue; }   // matches the old renderedCellGrid's separator skip

        const line: string[] = [];
        for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
            const field  = fields[c];
            const column = this._columns.find(col => col.getField().getName() === field.getName());
            const value  = column
                ? TableExporter.formatValue(column, record.get(field.getName()), this._columnConfigs, this._cellText)
                : record.get(field.getName());

            line.push(String(value ?? ''));
        }
        rows.push(line);
    }

    return buildRectangularTsv(rows);
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/DOM.ts`** — add `writeClipboardText(text: string): void` to the `DOMSink` interface (next to `pushHistoryPath`/`replaceHistoryPath`, ~line 672), doc comment mirroring `setLocationHash`'s. Implement on `ProductionDOMSink`: `writeClipboardText(text: string): void { navigator.clipboard?.writeText(text); }` (next to `replaceHistoryPath`'s impl, ~line 1774).
   → verify: `grep -n "writeClipboardText" packages/lib/src/typescript/lib/core/DOM.ts` shows both the interface and the implementation.

2. **`packages/lib/tests/dom/TestDOM.ts`** — implement `writeClipboardText` on `RecordingDOMSink` (next to `replaceHistoryPath`, ~line 585): `writeClipboardText(text: string): void { this.record('writeClipboardText', text); }`.
   → verify: `npm run -w packages/lib typecheck` — `RecordingDOMSink` must still satisfy `DOMSink`.

3. **`packages/lib/src/typescript/lib/core/Theme.ts`** — add `rangeSelectedBackground: string;` to the `table.cell` interface block (next to `readonlyBackground`, ~line 360), and a matching CSS-var mapping line `'--ts-ui-table-cell-range-selected' : theme.table.cell.rangeSelectedBackground,` (next to the `readonlyBackground` mapping, ~line 1073).

4. **`packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts`, `DarkTheme.ts`, `ModernTheme.ts`** — add `rangeSelectedBackground` to each theme's `table.cell` object (next to `readonlyBackground`), using the same value as that theme's `table.row.selected` (Classic/Modern: `'rgba(30, 100, 200, 0.15)'`, Dark: `'rgba(30, 100, 200, 0.25)'`).
   → verify: `npm run -w packages/lib typecheck` — all three theme object literals satisfy `Theme` with the new required field.

5. **`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`** — add `private _rangeSelected: boolean = false;` near `_readOnly`/`_baseBackground` (~line 44); add `setRangeSelected(value: boolean): this` mirroring `setRequiredEmpty`'s idempotence-guard shape (~after line 330); change `_applyStateTint()`'s `background` resolution (~line 361) to:
   ```typescript
   const background = this._rangeSelected
       ? 'var(--ts-ui-table-cell-range-selected, rgba(30, 100, 200, 0.15))'
       : this._readOnly
           ? 'var(--ts-ui-table-cell-readonly-bg, rgba(0, 0, 0, 0.04))'
           : this._baseBackground;
   ```
   → verify: existing `Cell.test.ts` background/cursor/outline precedence tests still pass unmodified (range-selected defaults `false`, so every existing case is unaffected).

6. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — delete the old copy path:
   - `onCopy` (~line 1572), `buildSelectionText` (~line 1591), `renderedCellGrid` (~line 1648), the exported `locateCellInGrid` (~line 269), the exported `buildTsv` (~line 221).
   - The `Event.addSubtreeListener(this, "copy", this.onCopy);` registration in `init()` (~line 1025).
   → verify: `grep -n "onCopy\|buildSelectionText\|renderedCellGrid\|locateCellInGrid\|buildTsv" packages/lib/src/typescript/lib/component/table/Body.ts` — zero matches.

7. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — add imports: `import { TableExporter } from "~/component/table/TableExporter.js";` and `import { CellTextResolver } from "~/component/table/cell/CellText.js";`. Add the exported `buildRectangularTsv` function (replacing the deleted `buildTsv`, same location) and keep `escapeTsvField` unchanged.

8. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — widen `BodyEvent` to include `"cellcontextmenu"` (~line 33); add the `on(event: "cellcontextmenu", …)` overload and the `emit(event: "cellcontextmenu", x: number, y: number)` overload (~lines 1764/1797), widening the `emit` implementation signature to `...payload: unknown[]` (mirroring `HeaderCell.emit`'s implementation signature) so the new 2-argument call type-checks without touching any existing single-argument `emit` call site.

9. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — add the new private fields (`_rangeAnchor`, `_rangeFocus`, `_contextMenuCell`, `_cellText`) next to `_selectedRecords`/`_anchorRecord` (~line 330).

10. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — add `locateCellFromTarget`, `getCellRangeBounds`, `isCellWithinBounds`, `refreshCellRangeHighlight`, `updateCellRangeVisualState`, `buildCopyText` (bodies per `## Internal Structure` above and the description in Architecture Decisions).

11. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — add `protected onCellMouseDown(e: MouseEvent): void`, `protected onCellDragMove(e: MouseEvent): Event.ListenerResult`, `protected onCellDragEnd(): Event.ListenerResult`, a private `onCellDragSelectStart(): Event.ListenerResult` returning `{ stop: true, prevent: true }`, and `protected onCellContextMenu(e: MouseEvent): Event.ListenerResult`, per the gesture design in Architecture Decisions.

12. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — in `init()` (~line 1010-1025), add `Event.addSubtreeListener(this, "mousedown", this.onCellMouseDown);` and `Event.addSubtreeListener(this, "contextmenu", this.onCellContextMenu);` alongside the existing `"click"` subtree listener.

13. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — in `onKeyDown` (~line 2120), after the `records.length === 0` early return, add:
    ```typescript
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        this.copySelectionToClipboard();
        return { prevent: true };
    }
    ```

14. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — in `bindAndPositionRows` (~line 1412-1429), after the existing `if (wasRebound) {...} else if (windowChanged) {...}` block that calls `applyReadOnlyState`, add:
    ```typescript
    if (wasRebound || windowChanged) {
        this.updateCellRangeVisualState(i);
    }
    ```

15. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — add the public `copySelectionToClipboard()` and `copyContextMenuSelection()` methods (bodies per Architecture Decisions: the former uses `getCellRangeBounds(this._rangeAnchor, this._rangeFocus)`; the latter computes the effective bounds from `_contextMenuCell` per the worked table). Both end with `DOM.sink.writeClipboardText(this.buildCopyText(bounds))`, guarded by an early return when there is nothing to copy.

16. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — in `destructor()` (~line 1078), add `this._cellText.dispose();` next to `this._editorPool.dispose();`.
    → verify: `npm run -w packages/lib typecheck` clean.

17. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — in the constructor, next to the existing `this._header.on("columncontextmenu", ...)` wiring (~line 304), add `this._body.on("cellcontextmenu", (x, y) => this.showCellMenu(x, y));`. Add a private `showCellMenu(x: number, y: number): void` next to `showColumnMenu` (~line 1641) that calls `this._columnContextMenu.show(x, y, [{ text: 'Copy', glyph: 'clipboard', action: () => this._body.copyContextMenuSelection() }]);`.
    → verify: `npm run -w packages/lib typecheck` clean.

18. **`packages/lib/tests/component/table/Body.test.ts`** — delete the `describe('buildTsv', …)`, `describe('locateCellInGrid', …)`, and `describe('Body onCopy / buildSelectionText', …)` blocks; update the import line to drop `buildTsv`/`locateCellInGrid` and add `buildRectangularTsv`. Add the new test blocks from `## Expected Behaviour` below. Leave `describe('resolveClickedColumn', …)` and the row-selection `describe` blocks (lines 329-451, 764-851) untouched.

19. **`packages/lib/tests/component/table/TreeBody.test.ts`** — replace `describe('TreeBody copy — inherits Body onCopy without any TreeBody-specific code', …)` (lines 289-333) with an equivalent test against the new mechanism (drive `_rangeAnchor`/`_rangeFocus` or a simulated mousedown/mouseup, call `copySelectionToClipboard()`, assert on the `RecordingDOMSink`'s `writeClipboardText` write) — proves `TreeBody` inherits the new path with no override, the same thing the deleted test proved for the old one.

20. **`packages/lib/docs/components/Table.md`** — rewrite the "Cell values are selectable and copyable by dragging across them…" paragraph (line 263) per `## Documentation Impact` below.

21. **`packages/lib/docs/concepts/theming.md`** — add a row for `table.cell.rangeSelectedBackground` / `--ts-ui-table-cell-range-selected` next to the existing `table.cell.requiredEmptyOutlineColor` row (~line 89).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/DarkTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/ModernTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/tests/component/table/TreeBody.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/concepts/theming.md` |

---

## Expected Behaviour

**Range gestures** (unit-testable against a `Body` built the way `Body.test.ts`'s existing tests already do, driving `onCellMouseDown`/`onCellDragMove`/`onCellDragEnd` with `makeEvent`):

| Gesture sequence | Resulting anchor | Resulting focus | Selected rectangle |
|---|---|---|---|
| mousedown (R1, colB) | (R1, colB) | (R1, colB) | just (R1, colB) |
| … then mousemove to (R3, colA), mouseup | (R1, colB) unchanged | (R3, colA) | rows 1–3 × cols A–B |
| … then a plain mousedown at (R0, colC) | (R0, colC) | (R0, colC) | just (R0, colC) — the old range is discarded |
| … then a shift-mousedown at (R2, colA) | (R0, colC) unchanged | (R2, colA) | rows 0–2 × cols A–C |

- A mousedown that resolves to a separator row (rotated mode), an actively-editing cell, or no cell at all is a no-op — no anchor/focus change, no drag armed.
- A mousemove during an active drag that resolves to the same cell the current focus already names is a no-op (no repaint).
- A mousemove that resolves to no cell (pointer left every pool row) leaves the focus unchanged — no auto-scroll, no clamping (see Non-Goals).

**Copy** (unit-testable: build a `Body`, drive the range gestures above or set `_rangeAnchor`/`_rangeFocus` directly, call `copySelectionToClipboard()`, assert on the `RecordingDOMSink`'s recorded `writeClipboardText` write):

- No range selected → `copySelectionToClipboard()` writes nothing.
- A range whose rows are **not currently in the row pool** (scrolled out of the virtualized window) still produces the correct text — this is the regression test for bug 2. Build a store with more records than fit the pool, select a range, scroll so the range's rows leave the pool, and assert the written text is unchanged.
- A range spanning a separator row (rotated mode, `setRowSeparator`) omits that row from the output entirely, same as the deleted `renderedCellGrid`'s behavior.
- A combo/date/time/datetime column's copied text matches what `TableExporter.formatValue` reports for that value, not the raw record value.
- Ctrl+C and Cmd+C (`ctrlKey`/`metaKey`) both trigger `onKeyDown`'s new branch and call `copySelectionToClipboard()`; a bare `C` keypress (no modifier) does not.

**Right-click / context menu** (unit-testable on `Body`; the menu construction itself is `Table`-level and needs a manual smoke test — see Verification):

- Right-click a cell with no prior selection → `_contextMenuCell` is set, `"cellcontextmenu"` fires with the event's viewport coordinates, the event handler returns `{ prevent: true }`; `_rangeAnchor`/`_rangeFocus` remain `null`.
- Right-click a cell already inside the current range → the range is untouched; `copyContextMenuSelection()` afterward copies the whole existing range.
- Right-click a cell outside the current range → the range is untouched; `copyContextMenuSelection()` afterward copies just the right-clicked cell.
- Right-click on a separator row, an actively-editing cell, or outside every cell → returns `undefined` (no `{ prevent: true }`), no event fires, `_contextMenuCell` is left as it was.

**Highlight rendering** (manual verification — visual/DOM output, per plan-format's guidance for non-automatable cases):

- Every cell inside the current rectangle shows the `--ts-ui-table-cell-range-selected` tint; cells outside it show their normal (readonly/group-color/default) background.
- Scrolling so a previously off-screen row/column inside the range enters the pool shows it highlighted without a full-table repaint being required.
- A read-only cell inside the range still shows the range tint, not the read-only tint (range wins the precedence).

---

## Verification

1. `npm run -w packages/lib typecheck` — clean.
2. `npm run -w packages/lib test -- Body.test.ts TreeBody.test.ts Cell.test.ts` — new and existing cases pass.
3. `npm run -w packages/lib test` (full suite) — no regressions, in particular `default-options-fallback.test.ts` does **not** need a new row (`rangeSelectedBackground` is read directly by `Cell._applyStateTint()` via the CSS `var()` fallback, the same way `readonlyBackground` already is — not through the defaulted-`XOptions`-field mechanism that registry guards).
4. Manual smoke test on the docs app (`npm run docs:dev`): open a `Table` demo, drag-select a rectangle of cells, scroll it out of view and back, Ctrl+C, paste into a spreadsheet — verify the pasted grid matches the originally-selected rectangle exactly, including for rows that left the viewport mid-drag.
5. Manual smoke test: right-click a cell with nothing selected, click "Copy", paste — verify it pastes that one cell.
6. Manual smoke test: right-click a cell inside an existing multi-cell selection, click "Copy", paste — verify it pastes the whole selection, and verify the visible highlight did not change shape when the menu opened.
7. Manual smoke test on `TreeTable`: drag a row (reparent) and separately drag across cells (range-select) — confirm neither is silently broken; if they visibly conflict, that is expected per this plan's stated limitation, not a regression to chase down here.

---

## Documentation Impact

- **`packages/lib/docs/components/Table.md`**, line 263 — the paragraph "Cell values are selectable and copyable by dragging across them; headers are not…" describes the old native-selection mechanism (word-select, shift-click range-select) and must be rewritten to describe: click-drag over cells selects a rectangular range (replacing native text selection for that gesture); Ctrl/Cmd+C or right-click → Copy writes tab-separated columns / newline-separated rows to the clipboard; a range always copies whole cells (no more character-level trim within a boundary cell). Keep a caveat for `TreeTable`, updated to reflect the new, not-yet-coordinated interaction with its row-reparent drag (per this plan's Non-Goals) rather than the old "reparent-drag takes precedence over text selection" framing.
- **`packages/lib/docs/concepts/theming.md`** — add the `table.cell.rangeSelectedBackground` / `--ts-ui-table-cell-range-selected` row per Ordered Step 21.
- `Body`/`Cell`/`DOMSink` all gain public, JSDoc-documented members (per `## Public API`); no new page beyond the two above is needed since none of the three is a new *component* — `Body` is already documented as `TableBody` and gains behavior, not a new entry point.

---

## Potential Challenges

- **`TreeTable`'s reparent drag vs. the new range drag.** Both are mousedown-armed viewport-listener trackers with no mutual awareness. Mitigated only by making the four new gesture handlers `protected` so `TreeBody` can override them later; not fixed here (see Non-Goals).
- **`_contextMenuCell` staleness.** If a user right-clicks, then the store mutates (row removed) before clicking "Copy", `getCellRangeBounds`-style resolution already handles a vanished record by returning `null`/skipping it via the `indexOf === -1` guard — `copyContextMenuSelection()` should end up copying nothing rather than throwing. Worth an explicit test.
- **Idempotent `setRangeSelected` calls on every scroll tick.** `updateCellRangeVisualState` runs for every rebound/retargeted cell on every render pass; `Cell.setRangeSelected`'s existing-value short-circuit (mirroring `setReadOnly`/`setRequiredEmpty`) keeps this from writing DOM styles when nothing changed.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — everything above lives here; read in full before starting.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — pool rotation mechanics that make identity-keyed state the only safe approach.
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts) (`_handleContextMenu`, ~line 1191) — the precedent for "right-click does not mutate selection."
- [`packages/lib/src/typescript/lib/overlay/DragManager.ts`](packages/lib/src/typescript/lib/overlay/DragManager.ts) (`onSourceMouseDown`, `onSelectStart`, ~lines 323-502) — the precedent for suppressing native text selection during a mouse-driven drag without a blanket `preventDefault`.
- [`packages/lib/src/typescript/lib/component/table/TableExporter.ts`](packages/lib/src/typescript/lib/component/table/TableExporter.ts) and [`packages/lib/src/typescript/lib/component/table/cell/CellText.ts`](packages/lib/src/typescript/lib/component/table/cell/CellText.ts) — the off-screen value-formatting mechanism the new copy path reuses.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) (`_applyStateTint`, ~line 360) — the precedence chain the new highlight state joins.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) (`showColumnMenu`, ~line 1641) — the working reference for opening a rebuild-mode `Menu`.
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](packages/lib/src/typescript/lib/overlay/Menu.ts) — real `Menu` API (`show(x, y, configs, onClose?, excludeEl?)`).
- [`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts) and [`packages/lib/tests/component/table/TreeBody.test.ts`](packages/lib/tests/component/table/TreeBody.test.ts) — existing coverage that pins the old behavior and must be replaced, not just left to fail.

---

## Non-Goals

- **`TreeTable`/`TreeBody` drag coordination.** The new range drag is not reconciled with `TreeBody`'s existing `DragManager`-based row-reparent drag. Flagged as a follow-up (see Architecture Decisions and Potential Challenges).
- **Sub-cell (character-level) copy.** A range always copies whole cells; there is no way to select or copy a substring of one cell's text anymore, since that required a live native `Selection` — the exact mechanism this plan removes.
- **Discontiguous / multi-rectangle selection.** Ctrl-click does not add a second disjoint rectangle to the selection. One contiguous rectangle only.
- **Keyboard-driven range extension.** Shift+Arrow does not extend the cell range. The new range is mouse-driven only; existing keyboard row/column navigation (`_anchorRecord`, `_focusedColIndex`) is untouched.
- **Auto-scroll while dragging past the viewport edge.** Dragging the pointer below the last rendered row or past the table's edge does not scroll the table or extend the range beyond whatever the pointer currently resolves to.
- **Column-header-driven column selection.** No click/drag affordance is added to `TableHeader`/`HeaderCell` for selecting a whole column; a full-column range is achievable today only by dragging through every row of that column.
- **Cursor/`user-select` affordance changes on cell renderers.** `cursor: text` and `user-select: text` stay as they are on cell renderers even though sub-cell text selection can no longer complete; changing that visual affordance is a separate, broader change touching many renderer classes and `CellTextSelection.test.ts`, out of scope for the two bugs this plan fixes.

---

## Notes

[^identity-precedent]: `Body._anchorRecord` already stores a `ModelRecord` reference rather than a pool-slot index, and every read site (`_updateFocusStyle`, `_updateActiveDescendant`) tolerates `getVisibleRecords().indexOf(record) === -1` gracefully (the record was filtered or removed) by treating the lookup as "not currently resolvable" rather than throwing or proactively cleaning up. The new `_rangeAnchor`/`_rangeFocus` fields follow the same tolerance — no explicit invalidation is wired to store `remove`/`datachange` events, matching how `_anchorRecord` itself has none.

[^shift-parity]: The degenerate case matches `reduceModifierSelection`'s own documented rule for "shift with no anchor": it is treated as a plain replace, not an error. `onCellMouseDown`'s `if (e.shiftKey && this._rangeAnchor) { … } else { anchor = focus = clicked }` reproduces exactly that fallback — a shift-click with no existing anchor starts a fresh single-cell selection instead of doing nothing or throwing.

[^prevent-default-trap]: Recorded precedent: a blanket `pointerdown.preventDefault()` guard once silently killed mousedown-driven descendants — specifically an overlay `Scrollbar` drag nested inside a dropdown's focus-loss guard — and had to be fixed with a target-specific carve-out. The lesson generalizes: never `preventDefault()` a broad mousedown handler without first confirming every kind of interactive content that can land under it still works. This plan sidesteps the question entirely by not calling `preventDefault()` on mousedown at all.

[^selectstart-precedent]: `DragManager`'s own comment on `onSelectStart` states the problem and the fix precisely: "`preventDefault()` on `mousemove` does not by itself stop the browser from extending a selection (verified live: the selection still grew with every `mousemove` observably prevented), so the suppression has to target `selectstart` itself." That comment was written for exactly this scenario — a mouse-driven drag over now-selectable table cell text — so reusing the technique (not the code, since `DragManager`'s session machinery is drag-and-drop-specific) is the correct call rather than re-deriving a fix to the same problem.

[^tree-contextmenu]: `Tree._handleContextMenu`'s own doc comment: "Mirrors `_handleClick`'s row-matching but deliberately does not change the selection: a right-click positions a context menu over a node without triggering the selection-driven side effects … that a left-click would." Tree's menu consumer receives the target node directly as an event parameter and never needs to consult persistent selection state to know what to act on — which is the structural lesson this plan borrows: carry the resolved right-click target through the event/short-lived field, rather than mutating the persistent selection to make the menu's action have something to read.

[^menu-reuse]: `Menu`'s own class comment on rebuild mode confirms this is safe: "Items are passed per `show(x, y, items)` call and disposed on the next show or hide." Nothing about a rebuild-mode `Menu` instance is scoped to one particular caller's item set.

[^formatting-fidelity]: This is a deliberate, minor fidelity change for plain `number`/`boolean`/`glyph`/custom-renderer columns: `TableExporter.formatValue` only special-cases `combo`/`date`/`time`/`datetime` values (returning everything else verbatim, e.g. a raw `number`), whereas the old `renderedCellGrid`-based copy read `cell.getRenderer().getDisplayText()`, which reflects each renderer's own on-screen formatting (e.g. a `NumberRenderer`'s thousands separators, if any) for every cell type. Off-screen cells have no live renderer to read from, so exact per-renderer-type fidelity is not achievable at all for them — matching `TableExporter`'s existing, already-shipped fidelity level (the same one `Table.exportCSV`/`exportJSON` already present as correct) is preferable to inventing a second, parallel formatting path that only some cells in a mixed on-screen/off-screen range would use.

[^why-not-raw-write]: `Cell._applyStateTint()` already caches its resolved `background-color` into `_options.backgroundColor` and flushes it via `DOM.sink.apply`. A second writer (`Body`) directly overwriting the same inline style property outside that cache — the technique `updateRowVisualState` uses at the row level, justified there because `Row` has no competing cached `background-color` writer of its own — would go stale the next time `Cell`'s own setters (`setReadOnly`, `setBaseBackground`) run and re-flush their cached value, silently reverting `Body`'s override. Routing through a `Cell`-owned setter avoids the two writers fighting over one property.

[^scroll-perf]: This mirrors `applyReadOnlyState`'s own call sites in `bindAndPositionRows` exactly (`wasRebound` → full row rewrite, `windowChanged` → still worth rechecking since a new column may have entered the range's column bounds). A pure vertical-translate scroll tick where no pool slot's bound row or column window changes calls neither `applyReadOnlyState` nor the new `updateCellRangeVisualState`, keeping this off the hot per-frame path — the same reasoning that keeps `updateRowVisualState` off it today.

[^grep-verified]: Confirmed via `grep -rln "onCopy\|buildSelectionText\|renderedCellGrid\|locateCellInGrid\|\bbuildTsv\b" packages/lib/src packages/lib/tests packages/lib/docs packages/docs`: the only hits outside `Body.ts` itself are `Body.test.ts` and `TreeBody.test.ts` (both addressed in Ordered Steps 18-19).

[^clipboard-seam]: `setLocationHash`, `replaceLocationHash`, `pushHistoryPath`, and `replaceHistoryPath` are the existing precedent for a `DOMSink` method with no `Handle` parameter — each calls a global (`location`, `history`) rather than operating on a specific element. `writeClipboardText` follows the identical shape for `navigator.clipboard`. This is also the only way to make `copySelectionToClipboard()`/`copyContextMenuSelection()` testable at all: this project's tests run under Node (`environment: 'node'` in `vitest.config.ts`), where no `navigator` global exists, so a direct `navigator.clipboard.writeText(...)` call in `Body.ts` would throw the moment a test exercised it.
