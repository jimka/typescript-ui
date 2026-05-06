# Table Column Pinning — Implementation Plan

## Overview

Column pinning freezes selected columns at the left edge of the table, outside horizontal scrolling. The implementation uses a dual-panel layout: a `PinnedPanel` on the left for pinned columns and a `ScrollPanel` on the right for scrollable columns. Both panels share one vertical scroll position synchronized through a transparent `ScrollOverlay`. The existing `Table`, `Header`, `Body`, `Column`, and `ColumnConfig` types are extended minimally.

---

## Architecture Decisions

### Wrapper (`TableWithPinning`) rather than subclass of `Table`

`Table` uses the `Table` layout manager which is tightly coupled to the HTML table model. Adding two side-by-side sub-tables inside a `<table>` element is not valid HTML. `TableWithPinning extends Component` and installs a custom `PinnedTableLayout`.

### Dual-panel layout, not CSS `sticky`

CSS `position: sticky` is incompatible with the framework's absolute-positioned virtual scroll. Each panel (`PinnedPanel`, `ScrollPanel`) has its own `Header`, `Body`, and footer.

### Single scroll overlay

A transparent `ScrollOverlay` is positioned absolutely to cover the full body area (both panels). It has `overflow: auto` and a phantom div tall enough for all records. On `scroll` it writes `scrollTop` to both bodies. This gives a single scrollbar at the far right and perfectly synchronized positions.

### Resize callbacks carry panel-local column index

Because pinned and scroll panels each have their own `Header` instance, the index passed to `onColumnResize` is already local to that panel.

### `PinSeparator` — visual divider

A 4 px wide `Component` with `ew-resize` cursor. Dragging redistributes width between panels.

### Selection synchronization

Both bodies share the same store/record set. A new `setOnSelectionChange` callback on `Body` fires when selection changes; `TableWithPinning` uses it to sync the other panel via a new `syncSelection` method on `Body`.

---

## Public API (TypeScript Signatures)

### `ColumnConfig` extension

```typescript
export interface ColumnConfig {
    field    : string;
    minWidth?: number;
    maxWidth?: number;
    hidden?  : boolean;
    pinned?  : boolean;   // NEW
}
```

### `Column` extension

```typescript
export class Column {
    // NEW:
    isPinned(): boolean;
}
```

### `PinnedPanel` (new file)

```typescript
export class PinnedPanel extends Component {
    constructor(store: AbstractStore, spec?: ColumnSpec);
    getHeader(): Header;
    getBody(): Body;
    getColumns(): Column[];
    getColumnWidths(): number[];
    setColumnWidths(widths: number[]): void;
    setOnColumnResize(fn: (colIndex: number, delta: number) => void): void;
    setScrollTop(value: number): void;
}
```

### `ScrollPanel` (new file)

```typescript
export class ScrollPanel extends Component {
    constructor(store: AbstractStore, spec?: ColumnSpec);
    getHeader(): Header;
    getBody(): Body;
    getColumns(): Column[];
    getColumnWidths(): number[];
    setColumnWidths(widths: number[]): void;
    setOnColumnResize(fn: (colIndex: number, delta: number) => void): void;
    setScrollTop(value: number): void;
    getScrollElement(): HTMLElement | undefined;
}
```

### `PinSeparator` (new file)

```typescript
export class PinSeparator extends Component {
    constructor();
    setOnDrag(fn: (delta: number) => void): void;
}
```

### `ScrollOverlay` (new file)

```typescript
export class ScrollOverlay extends Component {
    constructor();
    setPhantomHeight(height: number): void;
    setOnScroll(fn: (scrollTop: number) => void): void;
    setScrollTop(value: number): void;
    getScrollTop(): number;
}
```

### `TableWithPinning` (new file)

```typescript
export class TableWithPinning extends Component {
    constructor(store: AbstractStore, spec?: ColumnSpec);

    getStore(): AbstractStore;
    getPinnedPanel(): PinnedPanel;
    getScrollPanel(): ScrollPanel;

    getPinnedColumns(): Column[];
    getScrollColumns(): Column[];
    getAllColumns(): Column[];

    getPinnedColumnWidths(): number[];
    getScrollColumnWidths(): number[];
    setPinnedColumnWidths(widths: number[]): void;
    setScrollColumnWidths(widths: number[]): void;

    setColumnVisible(fieldName: string, visible: boolean): void;
    getSelectedRecord(): ModelRecord | null;
    getSelectedRecords(): ModelRecord[];

    async sync(): Promise<void>;
}
```

---

## Ordered Implementation Steps

### Step 1 — Extend `ColumnConfig` and `Column`

- Add `pinned?: boolean` to `ColumnConfig`.
- Add `private pinned: boolean` to `Column`, set from `config?.pinned ?? false`.
- Add `isPinned(): boolean` getter.

### Step 2 — Implement `PinSeparator`

- Extend `Component`, width 4 px, full height, `cursor: ew-resize`.
- Wire `mousedown` on element, `mousemove`/`mouseup` on viewport (same pattern as `HeaderCell.onResizeDragStart`).
- On `mousemove`, call `onDragCallback(e.movementX)`.

### Step 3 — Implement `ScrollOverlay`

- Extend `Component`, `position: absolute`, `overflow: auto`.
- Inner phantom `<div>` child (`position: absolute; top: 0; width: 1px; height: {phantomHeight}px`).
- In `init()`, attach scroll listener via `Event.addListener(this, 'scroll', ...)`.
- `setScrollTop(v)`: direct `element.scrollTop = v`.

### Step 4 — Implement `PinnedPanel`

- Extend `Component`, `overflow: hidden`.
- Filter columns: `Column.resolve(...).filter(c => c.isPinned())`.
- Create `Header`, `Body` with `overflow: hidden` on both axes.
- `setScrollTop(value)`: `body.getElement()!.scrollTop = value` directly.

**Adding `setBodyOverflow` to `Body.ts`:**
```typescript
setBodyOverflow(overflowX: string, overflowY: string): void {
    this.overflowX = overflowX;
    this.overflowY = overflowY;
    // update element if already rendered
}
```

### Step 5 — Implement `ScrollPanel`

- Extend `Component`, `overflow: hidden`.
- Filter: `Column.resolve(...).filter(c => !c.isPinned())`.
- Body has `overflow-x: auto`, `overflow-y: hidden` (horizontal scroll of wide scroll content).
- On body horizontal scroll, sync header `scrollLeft`: `header.getElement()!.scrollLeft = body.getElement()!.scrollLeft`.

### Step 6 — Implement `PinnedTableLayout`

`Base/layout/PinnedTable.ts` — mirrors `layout/Table.ts` but manages two independent column sets.

`doLayout()`:
1. Partition columns into pinned/scroll.
2. Initialize/rescale pinned and scroll column widths (reuse `initializeWidths`/`rescaleWidths` logic from `Table.ts`).
3. Compute `pinnedPanelWidth = sum(pinnedColumnWidths)`, `scrollPanelWidth = available - pinnedPanelWidth - 4`.
4. Position `PinnedPanel` at left, `PinSeparator` next, `ScrollPanel` filling remainder.
5. Position `ScrollOverlay` over full body area.
6. Set `overlay.setPhantomHeight(totalRows * rowHeight)`.

### Step 7 — Implement `TableWithPinning`

Wire everything in the constructor:
```typescript
constructor(store, spec) {
    super();
    this.setLayoutManager(new PinnedTableLayout());

    this.pinnedPanel = new PinnedPanel(store, /* pinnedColumns */);
    this.scrollPanel = new ScrollPanel(store, /* scrollColumns */);
    this.separator   = new PinSeparator();
    this.overlay     = new ScrollOverlay();

    this.pinnedPanel.setOnColumnResize((i, d) => this.onPinnedResize(i, d));
    this.scrollPanel.setOnColumnResize((i, d) => this.onScrollResize(i, d));
    this.separator.setOnDrag(d => this.onSeparatorDrag(d));

    this.overlay.setOnScroll(top => {
        this.pinnedPanel.setScrollTop(top);
        this.scrollPanel.setScrollTop(top);
    });

    // Selection sync
    this.pinnedPanel.getBody().setOnSelectionChange(records =>
        this.scrollPanel.getBody().syncSelection(records)
    );
    this.scrollPanel.getBody().setOnSelectionChange(records =>
        this.pinnedPanel.getBody().syncSelection(records)
    );

    this.addComponent(this.pinnedPanel);
    this.addComponent(this.separator);
    this.addComponent(this.scrollPanel);
    this.addComponent(this.overlay);
}
```

`onSeparatorDrag(delta)`: clamp `pinnedPanelWidth` between min and max, call `doLayout()`.

### Step 8 — Selection sync additions to `Body.ts`

```typescript
private onSelectionChangeCallback: ((records: ModelRecord[]) => void) | null = null;

setOnSelectionChange(fn: (records: ModelRecord[]) => void): void {
    this.onSelectionChangeCallback = fn;
}

syncSelection(records: ModelRecord[]): void {
    // sets this.selectedRecords to the provided set and refreshes visual states
    // without firing the change callback (to avoid infinite loops)
}
```

Call `notifySelectionChange()` at end of `onRowClick()` and `selectRecord()`.

### Step 9 — Export from `index.ts`

```typescript
export { TableWithPinning }  from './component/table/TableWithPinning.js';
export { PinnedPanel }       from './component/table/pinned/PinnedPanel.js';
export { ScrollPanel }       from './component/table/pinned/ScrollPanel.js';
export { PinSeparator }      from './component/table/pinned/PinSeparator.js';
export { ScrollOverlay }     from './component/table/pinned/ScrollOverlay.js';
export { PinnedTableLayout } from './layout/PinnedTable.js';
```

---

## Key Behavioral Details

**Scroll synchronization:** `ScrollOverlay` fires `onScroll(scrollTop)`. `TableWithPinning` calls `pinnedPanel.setScrollTop(top)` then `scrollPanel.setScrollTop(top)`. Both complete before browser repaints — frame-perfect alignment.

**No pinned columns:** When `pinnedColumns.length === 0`, pinned panel width is 0, separator is hidden (`setDisplayed(false)`), scroll panel fills full width. `TableWithPinning` is a drop-in replacement for `Table` in this degenerate case.

---

## Files to Create

| File | Purpose |
|---|---|
| `Base/component/table/pinned/PinnedPanel.ts` | Left panel housing pinned Header/Body |
| `Base/component/table/pinned/ScrollPanel.ts` | Right panel housing scroll Header/Body |
| `Base/component/table/pinned/PinSeparator.ts` | Draggable 4 px divider |
| `Base/component/table/pinned/ScrollOverlay.ts` | Transparent overlay owning single vertical scrollbar |
| `Base/component/table/TableWithPinning.ts` | Top-level component coordinating both panels |
| `Base/layout/PinnedTable.ts` | Layout manager for `TableWithPinning` |

## Files to Modify

| File | Changes |
|---|---|
| `Base/component/table/ColumnConfig.ts` | Add `pinned?: boolean` |
| `Base/component/table/Column.ts` | Add `private pinned`, `isPinned()`, update constructor |
| `Base/component/table/Body.ts` | Add `setOnSelectionChange()`, `syncSelection()`, `setBodyOverflow()` |
| `Base/index.ts` | Export six new public types |

---

## Critical Files

- `src/typescript/Base/component/table/ColumnConfig.ts`
- `src/typescript/Base/component/table/Column.ts`
- `src/typescript/Base/component/table/Body.ts`
- `src/typescript/Base/layout/Table.ts`
- `src/typescript/Base/component/table/Table.ts`
