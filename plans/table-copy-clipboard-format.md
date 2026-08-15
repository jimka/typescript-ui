---
depends-on: [selectable-display-text]
---

# Table Copy Clipboard Formatting — Implementation Plan

## Overview

When a user selects table cell text and copies it, the browser's default `copy` behaviour writes the raw concatenated text of the selection to the clipboard, with no separators between cells or rows. This plan makes the [`Table`](packages/lib/src/typescript/lib/component/table/Table.ts) body intercept the native `copy` event and write a tab/newline-separated (TSV) payload instead, so a copied cell range pastes into a spreadsheet as separate cells rather than one run-on string.

The whole mechanism lives in [`Body`](packages/lib/src/typescript/lib/component/table/Body.ts): a new `copy` listener resolves the live browser selection against the cells currently rendered in `Body`'s row pool and rebuilds the copied text from their cached display text. Building that resolution requires one new read on the DOM seam — [`DOM.source`](packages/lib/src/typescript/lib/core/DOM.ts) has no way to read the browser's `Selection` today — added as `getDocumentSelection()`, implemented in `ProductionDOMSource` and stubbed to `null` in the offline `ModelledDOMSource` ([`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts)).

`Body` is the base class of both `Table`'s flat body and [`TreeBody`](packages/lib/src/typescript/lib/component/table/TreeBody.ts) (`TreeTable`'s body), so this lands once and both inherit it. This plan depends on [`selectable-display-text`](plans/selectable-display-text.md), which is what makes table cell text selectable at all — it is not yet merged to `master`, and this plan reads the cell/renderer code that plan introduces.

---

## Architecture Decisions

### The `copy` listener is registered on `Body` itself, with no subtree walk

`Event.addListener(this, "copy", this.onCopy)` is added in `Body.init()` next to the existing exact-target `focus` / `keydown` registrations ([`Body.ts:807-808`](packages/lib/src/typescript/lib/component/table/Body.ts#L807)). No subtree listener, and no listener on `Table` or `TablePanel`.[^copy-target]

### `TreeTable` inherits the feature with no `TreeTable`-specific code

`TreeBody extends _Body` and `TreeBody.init()` calls `super.init(element)` before doing its own work ([`TreeBody.ts:478-484`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L478)), so the `copy` listener wired in the base class's `init()` is registered on every `TreeBody` instance automatically.[^treetable-inherits]

### Header, parent-header and group-separator cells are excluded — structurally for headers, explicitly for separators

[`HeaderCell`](packages/lib/src/typescript/lib/component/table/cell/Header.ts) and [`ParentHeaderCell`](packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts) are mounted by the header band container, [`TableHeader`](packages/lib/src/typescript/lib/component/table/Header.ts) — note this is a different file from `cell/Header.ts` despite the similar name — never by `Body`. So a `Body`-scoped copy handler cannot reach them at all — no runtime check is needed to keep them out.

`GroupSeparatorCell` rows are different: `Row.renderSeparator` mounts a `GroupSeparatorCell` directly inside `Body`'s own row pool for a rotated table's group-label rows ([`Row.ts:321-333`](packages/lib/src/typescript/lib/component/table/Row.ts#L321)), so they need an explicit skip. `Row.isSeparator()` ([`Row.ts:147-149`](packages/lib/src/typescript/lib/component/table/Row.ts#L147)) is the existing flag for this and is checked when building the copy grid.

### Rows scrolled out of the rendered window are silently absent from the copy

A pool slot outside the current window has no live DOM element to hold a `Selection` boundary in the first place — `hideExcessPoolRows` clears `_rowDisplayed[i]` for it ([`VirtualRowView.ts:436-445`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L436)) and a truly off-window row was never in the pool to begin with. The browser's own `Selection` therefore already stops at the rendered window's edge; this plan does not add any extra handling for it, and does not attempt to reach into un-rendered rows.

### Resolving a browser `Selection` to grid cells

The copy grid is every currently-displayed, non-separator row in `Body._rowPool`, in pool order, each row's cells in `Row.getComponents()` order. Both orders are already document order: `alignPoolWindow` keeps `_rowPool[i]` bound to the same visual row across scroll ticks ([`VirtualRowView.ts:377-393`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L377)), and `Row.setColumnWindow`'s `sortComponents` call keeps a row's cells in left-to-right visible-column order ([`Row.ts:495-496`](packages/lib/src/typescript/lib/component/table/Row.ts#L495)).

Given that grid, locate the (row, col) position of the selection's start and end containers, then walk row-major from start to end: `\t` between cells in the same row, `\n` between rows. Only the first and last cell touched are trimmed to the actually-selected characters (via the selection's start/end character offsets); every cell strictly between them contributes its full [`getDisplayText()`](packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L91).[^why-not-rectangle]

| Grid (2 rows × 3 cols) | col 0 | col 1 | col 2 |
|---|---|---|---|
| row 0 | `Alice` | `25` | `NYC` |
| row 1 | `Bob` | `30` | `LA` |

| Start | End | Result |
|---|---|---|
| (row 0, col 0), no offset | (row 0, col 2), no offset | `Alice\t25\tNYC` |
| (row 0, col 1), no offset | (row 1, col 1), no offset | `25\tNYC\nBob\t30` |
| (row 0, col 0), offset 2 | (row 0, col 1), offset 1 | `ice\t2` |
| (row 0, col 0), offset 2 | (row 0, col 0), offset 4 | `ic` |

The second row shows the rule for a multi-row span: it is not a rectangle. The row containing the start cell keeps every column from the start column to its own last rendered column; the row containing the end cell keeps every column from its first to the end column. This is exactly what a native mouse-drag `Selection` produces — a `Range`'s two boundaries are the touched characters, and every node between them in document order is fully contained — so no rectangle has to be synthesized.

### A new `DOM.source.getDocumentSelection()` read, boxed through handles

`window.getSelection()` is a raw global read with no existing seam method, so per [ARCHITECTURE.md](ARCHITECTURE.md)'s DOM-seam rule it needs a `DOMSource` method rather than a call site reaching for the global directly.

```typescript
export interface DocumentSelectionRange {
    startContainer: Handle;
    startOffset:    number | null;
    endContainer:   Handle;
    endOffset:      number | null;
}
```

A `null` offset means `startContainer` (or `endContainer`) is not a text node, so the boundary sits at that node's edge rather than at a character — the `Node.TEXT_NODE` check lives inside the seam, where a real DOM type test belongs, rather than being re-derived by every caller. `getDocumentSelection()` returns `null` outright when there is no selection or a collapsed one, so a caller has one bail check instead of two.[^naming]

### The offline test source reports no selection; the pure grid/text logic is what unit tests exercise

`ModelledDOMSource.getDocumentSelection()` returns `null` unconditionally — there is no live browser `Selection` to model offline, the same way `ModelledDOMSource.matchMedia()` degrades to an inert result. The actual drag-select-then-copy gesture is manual-verify only, matching the existing DragManager precedent in `selectable-display-text.md` for the same reason (the offline harness records `dispatchEvent` without invoking listeners and cannot drive a selection). The row-major walk and the tab/newline formatting are written as pure functions precisely so they do not share that limitation — see `## Internal Structure`.

### Escaping mirrors `TableExporter`'s CSV convention, adapted to tab

A cell's display text can itself contain a tab or an embedded newline (e.g. a multi-line string field, collapsed visually by CSS but still present in the underlying string) — left unescaped, that would insert spurious column or row breaks into the pasted grid. A cell's contributed text is quote-wrapped, with interior quotes doubled, whenever it contains a tab, a newline, or a double-quote — the same shape as [`TableExporter.escapeCSVField`](packages/lib/src/typescript/lib/component/table/TableExporter.ts#L138), with the trigger set adapted from comma (CSV's delimiter) to tab (this format's delimiter).[^not-reuse]

| Cell text | Clipboard field |
|---|---|
| `Notes` | `Notes` |
| `a\tb` | `"a\tb"` |
| `He said "hi"` | `"He said ""hi"""` |

### The handler writes to `clipboardData` inline and returns a disposition for `preventDefault`

Per [ARCHITECTURE.md](ARCHITECTURE.md)'s event-handling rule, `onCopy` never calls `event.preventDefault()` itself; it returns `{ prevent: true }` and lets the dispatcher's `applyDisposition` call it — the same pattern the *other*, app-root `Body` class's `onContextMenu` handler uses in [`plans/implemented/native-context-menu-suppression.md`](plans/implemented/native-context-menu-suppression.md) (`core/Body.ts`, not this plan's `component/table/Body.ts` — the two are unrelated classes that happen to share a name). Calling `event.clipboardData.setData(...)` directly is not covered by that rule at all — it is neither `stopPropagation` nor `preventDefault`, just a data write on the event object the dispatcher already handed the listener.

### Only `text/plain` (TSV) is written to the clipboard

No `text/html` payload. TSV alone already satisfies the round-trip requirement — every mainstream spreadsheet app parses tab-delimited plain text into cells — and the task framing itself presents HTML as optional enrichment, not a requirement. See `## Non-Goals`.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/DOM.ts

export interface DocumentSelectionRange {
    startContainer: Handle;
    startOffset:    number | null;
    endContainer:   Handle;
    endOffset:      number | null;
}

interface DOMSource {
    // ... existing members ...

    /**
     * Reads the document's current text selection as plain data, boxed
     * through handles so the live `Selection`/`Range` never escapes the seam.
     *
     * @returns The selection's start/end containers and character offsets,
     *   or `null` when nothing is selected (no ranges, or a collapsed one).
     */
    getDocumentSelection(): DocumentSelectionRange | null;
}
```

```typescript
// packages/lib/src/typescript/lib/component/table/Body.ts

/**
 * Finds the row-major grid position of the rendered cell containing
 * `target`, or `null` when no cell in `grid` contains it.
 */
export function locateCellInGrid(
    grid:   Array<Array<{ element: Handle }>>,
    target: Handle,
): { row: number, col: number } | null;

/**
 * Builds a tab/newline-formatted clipboard payload from `rows`, spanning
 * `[startRow, startCol]` to `[endRow, endCol]` inclusive in row-major order.
 * `startOffset`/`endOffset` trim the first/last cell to the selected
 * characters (`null` leaves that cell's text whole); every cell strictly
 * between the two boundaries contributes its full text.
 */
export function buildTsv(
    rows: string[][],
    startRow: number, startCol: number, startOffset: number | null,
    endRow: number, endCol: number, endOffset: number | null,
): string;
```

Both are new module-level exports in `Body.ts`, alongside the existing exported `resolveClickedColumn` ([`Body.ts:70`](packages/lib/src/typescript/lib/component/table/Body.ts#L70)) and `computeColumnWindow` ([`Body.ts:120`](packages/lib/src/typescript/lib/component/table/Body.ts#L120)) — same file, same "exported for direct unit testing" precedent. No new `Body` public methods and no new `BodyOptions` field: the feature is always on, matching `selectable-display-text`'s own always-on shape.

---

## Internal Structure

Three new private `Body` methods, and a module-private escape helper alongside the two exported functions above.

```typescript
private onCopy(e: ClipboardEvent): Event.ListenerResult {
    const text = this.buildSelectionText();

    if (text === null) {
        return;
    }

    e.clipboardData?.setData("text/plain", text);

    return { prevent: true };
}

private buildSelectionText(): string | null {
    const range = DOM.source.getDocumentSelection();
    if (!range) {
        return null;
    }

    const grid  = this.renderedCellGrid();
    const start = locateCellInGrid(grid, range.startContainer);
    const end   = locateCellInGrid(grid, range.endContainer);

    if (!start || !end) {
        return null;
    }

    return buildTsv(
        grid.map(row => row.map(cell => cell.text)),
        start.row, start.col, range.startOffset,
        end.row,   end.col,   range.endOffset,
    );
}

private renderedCellGrid(): Array<Array<{ text: string, element: Handle }>> {
    const grid: Array<Array<{ text: string, element: Handle }>> = [];

    for (let i = 0; i < this._rowPool.length; i++) {
        if (!this._rowDisplayed[i]) {
            continue;
        }

        const row = this._rowPool[i];
        if (row.isSeparator()) {
            continue;
        }

        const cells = row.getComponents() as Cell<any>[];

        grid.push(cells.map(cell => ({
            text:    cell.getRenderer().getDisplayText(),
            element: cell.getElement()!,
        })));
    }

    return grid;
}
```

```typescript
export function buildTsv(
    rows: string[][],
    startRow: number, startCol: number, startOffset: number | null,
    endRow:   number, endCol:   number, endOffset:   number | null,
): string {
    const lines: string[] = [];

    for (let r = startRow; r <= endRow; r++) {
        const row     = rows[r];
        const colFrom = r === startRow ? startCol : 0;
        const colTo   = r === endRow   ? endCol   : row.length - 1;
        const parts: string[] = [];

        for (let c = colFrom; c <= colTo; c++) {
            const isStart = r === startRow && c === startCol;
            const isEnd   = r === endRow   && c === endCol;
            const text    = row[c];
            const from    = isStart && startOffset !== null ? startOffset : 0;
            const to      = isEnd   && endOffset   !== null ? endOffset   : text.length;

            parts.push(escapeTsvField(text.slice(from, to)));
        }

        lines.push(parts.join("\t"));
    }

    return lines.join("\n");
}

function escapeTsvField(value: string): string {
    if (value.includes("\t") || value.includes("\n") || value.includes("\"")) {
        return "\"" + value.replace(/"/g, "\"\"") + "\"";
    }

    return value;
}

export function locateCellInGrid(
    grid:   Array<Array<{ element: Handle }>>,
    target: Handle,
): { row: number, col: number } | null {
    for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
            if (DOM.source.contains(grid[r][c].element, target)) {
                return { row: r, col: c };
            }
        }
    }

    return null;
}
```

`escapeTsvField` is not exported — it has no independent contract beyond `buildTsv`'s own escaping cases, mirroring `columnWidthsEqual`'s un-exported role next to the exported `resolveClickedColumn` / `computeColumnWindow` in the same file ([`Body.ts:170`](packages/lib/src/typescript/lib/component/table/Body.ts#L170)).

`DOM.source.contains(ancestor, node)` ([`DOM.ts:1170`](packages/lib/src/typescript/lib/core/DOM.ts#L1170)) already includes the ancestor-equals-node case, so `locateCellInGrid` resolves correctly whether a selection boundary sits on the cell's own root element or on a descendant (the renderer, or its `Text`'s node) — the same containment check `resolveClickedColumn` already uses for click targets ([`Body.ts:74`](packages/lib/src/typescript/lib/component/table/Body.ts#L74)).

---

## Ordered Implementation Steps

1. **[`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts)** — add the exported `DocumentSelectionRange` interface near `getActiveElement`'s declaration ([`DOM.ts:1111`](packages/lib/src/typescript/lib/core/DOM.ts#L1111)), and add `getDocumentSelection(): DocumentSelectionRange | null;` to the `DOMSource` interface directly after `getActiveElement`.

2. **`DOM.ts` — `ProductionDOMSource`** — implement `getDocumentSelection()` directly after `getActiveElement()` ([`DOM.ts:2174`](packages/lib/src/typescript/lib/core/DOM.ts#L2174)):
   ```typescript
   /** @inheritDoc */
   getDocumentSelection(): DocumentSelectionRange | null {
       const sel = window.getSelection();
       if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
           return null;
       }

       const range = sel.getRangeAt(0);
       const startIsText = range.startContainer.nodeType === Node.TEXT_NODE;
       const endIsText   = range.endContainer.nodeType === Node.TEXT_NODE;

       return {
           startContainer: _registry.intern(range.startContainer),
           startOffset:    startIsText ? range.startOffset : null,
           endContainer:   _registry.intern(range.endContainer),
           endOffset:      endIsText ? range.endOffset : null,
       };
   }
   ```
   Only the first range is read (`getRangeAt(0)`) — matches Chrome's single-range selection model; see `## Non-Goals`.
   *Check:* `grep -n 'getDocumentSelection' packages/lib/src/typescript/lib/core/DOM.ts` — two matches (the interface member from step 1, and this implementation).

3. **[`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts)** — in `ModelledDOMSource`, add `getDocumentSelection()` next to `getActiveElement()` ([`TestDOM.ts:1111`](packages/lib/tests/dom/TestDOM.ts#L1111)):
   ```typescript
   /** No live Selection offline; always reports nothing selected. */
   getDocumentSelection(): DocumentSelectionRange | null {
       return null;
   }
   ```
   Import `DocumentSelectionRange` alongside the file's existing `Handle` import from `~/core/DOM`.
   *Check:* `npm run typecheck` — `ModelledDOMSource implements DOMSource` fails to compile until this method exists.

4. **[`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts)** — add the module-level `buildTsv`, `escapeTsvField` and `locateCellInGrid` functions from `## Internal Structure`, placed after `computeColumnWindow` / `columnWidthsEqual` ([`Body.ts:170`](packages/lib/src/typescript/lib/component/table/Body.ts#L170)) and before `class Body`.

5. **`Body.ts` — add `renderedCellGrid`, `buildSelectionText`, `onCopy`** as private methods on `Body`, from `## Internal Structure`. Place them near `onSubtreeClick`/`onRowClick` ([`Body.ts:1184`](packages/lib/src/typescript/lib/component/table/Body.ts#L1184)).

6. **`Body.ts` — wire the listener.** In `init()` ([`Body.ts:797`](packages/lib/src/typescript/lib/component/table/Body.ts#L797)), add `Event.addListener(this, "copy", this.onCopy);` directly after the existing `Event.addListener(this, "keydown", this.onKeyDown);` line ([`Body.ts:808`](packages/lib/src/typescript/lib/component/table/Body.ts#L808)).
   *Check:* `grep -n 'addListener(this, "copy"' packages/lib/src/typescript/lib/component/table/Body.ts` — one match.

7. **Tests — [`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts).** Add the unit cases from `## Expected Behaviour`, importing `buildTsv` and `locateCellInGrid` alongside the existing `resolveClickedColumn` import ([`Body.test.ts:17`](packages/lib/tests/component/table/Body.test.ts#L17)).

8. **Tests — [`packages/lib/tests/component/table/TreeBody.test.ts`](packages/lib/tests/component/table/TreeBody.test.ts).** Add the one inheritance case from `## Expected Behaviour`.

9. **Docs — [`packages/lib/docs/components/Table.md`](packages/lib/docs/components/Table.md).** Extend the existing selectability line at [`Table.md:262`](packages/lib/docs/components/Table.md#L262) per `## Documentation Impact`.

10. **Docs — [`packages/lib/docs/concepts/dom-seams.md`](packages/lib/docs/concepts/dom-seams.md).** Append `getDocumentSelection` to the enumerated "globals" method list at [`dom-seams.md:63`](packages/lib/docs/concepts/dom-seams.md#L63).

11. **Changelog — [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md).** Add one bullet under `## Changed` → `### Table` ([`next.md:50`](packages/lib/docs/reference/changelog/next.md#L50)) describing the behaviour change.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/tests/component/table/TreeBody.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Unit-testable

**`buildTsv`** (pure — no DOM, no `installTestDOM`; a plain `describe('buildTsv', ...)` block with literal arrays). The first five cases reuse the same `rows` grid and cases the worked example under `## Architecture Decisions` gives; the last three add the escaping behaviour, where TAB and NEWLINE stand for the literal `\t` / `\n` characters inside a cell's own text (as opposed to the `\t` / `\n` the function itself inserts between cells/rows).

Let `rows = [["Alice","25","NYC"], ["Bob","30","LA"]]` for the first five cases below.

| Case | Call (`startRow,startCol,startOffset, endRow,endCol,endOffset`) | Expectation |
|---|---|---|
| Whole row, no offsets | `buildTsv(rows, 0,0,null, 0,2,null)` | `"Alice\t25\tNYC"` |
| Cross-row span, no offsets | `buildTsv(rows, 0,1,null, 1,1,null)` | `"25\tNYC\nBob\t30"` |
| Partial-boundary trim | `buildTsv(rows, 0,0,2, 0,1,1)` | `"ice\t2"` |
| Single-cell trim | `buildTsv(rows, 0,0,2, 0,0,4)` | `"ic"` |
| `null` offset on one side only | `buildTsv(rows, 0,0,null, 0,1,1)` | `"Alice\t2"` — the un-offset boundary keeps its full text |
| Tab inside a cell's text | `buildTsv([["a<TAB>b","c"]], 0,0,null, 0,1,null)` | first field quote-wrapped with its tab intact, second field plain: `"a<TAB>b"` then a real tab then `c` |
| Quote inside a cell's text | `buildTsv([['He said "hi"']], 0,0,null, 0,0,null)` | quote-wrapped with interior quotes doubled: `"He said ""hi"""` |
| Newline inside a cell's text | `buildTsv([["a<NEWLINE>b"]], 0,0,null, 0,0,null)` | quote-wrapped with its newline intact: `"a<NEWLINE>b"` |

**`locateCellInGrid`** (needs real handles — `installTestDOM` + a constructed `Body`, mirroring the existing `resolveClickedColumn` tests at [`Body.test.ts:449-505`](packages/lib/tests/component/table/Body.test.ts#L449)):

| Case | Expectation |
|---|---|
| `target` is a cell's own element | `{ row, col }` of that cell |
| `target` is a descendant of a cell (its renderer's element) | same `{ row, col }` — via `DOM.source.contains` |
| `target` is outside every cell in the grid (e.g. the row's own element) | `null` |

**`onCopy` / `buildSelectionText`** — construct `const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]); await store.load();` and `const b = new Body(store); b.getElement(true);`, the same fixture `resolveClickedColumn`'s tests use ([`Body.test.ts:450-460`](packages/lib/tests/component/table/Body.test.ts#L450)), read `const cells = (b as any).getRowPool()[0].getComponents();` for real cell elements, and call `(b as any).onCopy(fakeEvent)` directly rather than dispatching a real `copy` DOM event (see `## Potential Challenges` for why).

| Case | Setup | Expectation |
|---|---|---|
| No selection | `DOM.source.getDocumentSelection` returns `null` (the `ModelledDOMSource` default — no stubbing needed) | `onCopy` returns `undefined`; `fakeEvent.clipboardData.setData` is never called |
| Resolved selection, whole row | `vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({ startContainer: cells[0].getElement()!, startOffset: null, endContainer: cells[2].getElement()!, endOffset: null })` | `fakeEvent.clipboardData.setData` is called once with `("text/plain", "1\t2\t3")`; `onCopy` returns `{ prevent: true }` |
| Selection resolves outside every rendered cell | stub returns a `DocumentSelectionRange` built from `row.getElement()!` (the row itself, not a cell) for both ends | `onCopy` returns `undefined`; `setData` not called |
| A `GroupSeparatorCell` row sits inside the selected range (rotated table) | build a rotated-mode `Body`, select across a separator row | the separator row's label is absent from the payload — grid indices skip it |

`fakeEvent` is `{ clipboardData: { setData: vi.fn() } } as unknown as ClipboardEvent`.

### Manual verification only (`npm run dev`, `http://localhost:8015`, per `selectable-display-text.md`'s own manual table)

| Case | Expectation |
|---|---|
| `#/complex` — drag across two cells in one row, Ctrl+C, paste into a text editor | Pasted text is `cell1\tcell2` |
| `#/complex` — drag across two rows, Ctrl+C, paste | Pasted text has the two rows on separate lines, columns tab-separated |
| `#/complex` — drag across two cells, Ctrl+C, paste into an actual spreadsheet (Excel or Google Sheets) | Pasted values land in separate cells, not one cell |
| `#/complex` — select the whole visible window, scroll, then copy a selection that was never re-dragged | The clipboard reflects only whatever is still selected — scrolling does not keep the old selection alive over new rows |
| `#/misc` → tree table demo — drag across two cells within one `TreeTable` row, Ctrl+C, paste | Same tab-separated behaviour as the flat table |
| Any plain click (no drag) then Ctrl+C | Native default copy behaviour (nothing selected, so nothing copied) — unaffected by this change |
| Drag-select inside a table, then Ctrl+C without ever clicking a table cell first | Covered structurally: a selection can only exist inside `Body` if a click or drag already focused it, per the `The copy listener is registered on Body itself` decision |

---

## Verification

1. `npm run typecheck` — clean.
2. `npm run test` — the new cases in `Body.test.ts` and `TreeBody.test.ts` pass; no existing test regresses. Pay attention to `packages/lib/tests/component/table/` and `packages/lib/tests/dom/`.
3. `npm run lint` — clean. `getDocumentSelection`'s `window.getSelection()` / `Node.TEXT_NODE` reads live inside `ProductionDOMSource`, the one place such reads are allowed.
4. `grep -rn 'getDocumentSelection' packages/lib/src packages/lib/tests` — hits only in `core/DOM.ts` (interface + `ProductionDOMSource`) and `tests/dom/TestDOM.ts` (`ModelledDOMSource`).
5. `grep -n 'buildTsv\|locateCellInGrid' packages/lib/src/typescript/lib/component/table/Body.ts` — both defined once, before `class Body`.
6. `npm run docs:api` — finishes with zero warnings (the new `DocumentSelectionRange` / `getDocumentSelection` JSDoc must not `{@link}` anything excluded from the public docs, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
7. Walk the manual table above in the running app, including the actual-spreadsheet paste case.

---

## Documentation Impact

No barrel or sidebar change — `DOM`, `DOMSource`, and `Handle` are already exported and documented; `DocumentSelectionRange` and `getDocumentSelection` are picked up automatically by TypeDoc from their JSDoc.

- **[`packages/lib/docs/components/Table.md:262`](packages/lib/docs/components/Table.md#L262)** — the line currently reads "Cell values are selectable and copyable by dragging across them; headers are not. …". Extend it to state that copying a multi-cell selection writes tab-separated columns and newline-separated rows, so a paste into a spreadsheet lands in separate cells, and that this applies to `TreeTable` too.
- **[`packages/lib/docs/concepts/dom-seams.md:63`](packages/lib/docs/concepts/dom-seams.md#L63)** — the "globals" method list already enumerates `matchMedia` / `requestAnimationFrame` / `getActiveElement` / etc.; append `getDocumentSelection`.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — one bullet under `## Changed` → `### Table` (next to the existing selectability-related entries), stating that copying a multi-cell selection now produces a tab/newline-formatted payload instead of raw concatenated text, for both `Table` and `TreeTable`.

---

## Potential Challenges

- **Testing the `copy` listener's registration itself is fragile across a shared test suite.** `Event.addListener`'s native-registration gate (`installedListenerTypes`, a module-level `Set` not cleared by `DOM.reset()`) means only the first test in a given module load actually triggers `DOM.sink.addListener("copy", ...)`; a later test's dispatch through its own fresh `RecordingDOMSink` would silently do nothing. Mitigation: tests call `(body as any).onCopy(fakeEvent)` directly, exactly like the existing `(b as any).onKeyDown(...)` calls in `Body.test.ts` — never a real `copy` event dispatch.
- **Excess/hidden pool rows must be filtered by `_rowDisplayed`, not by iterating the whole pool.** `_rowPool` can be larger than the currently visible window (`computePoolTarget` pre-grows it); a grid built without the `_rowDisplayed[i]` check would leak stale, off-screen rows into the copy. Mitigation: `renderedCellGrid` checks `_rowDisplayed[i]` explicitly.
- **`BooleanCell` / `GlyphCell` / a `DynamicCell` resolved to `'boolean'` contribute an empty string.** None of them override `getDisplayText()` (`BooleanEditor` inherits `CellEditor`'s `""` default, `GlyphRenderer`'s `getDisplayText()` returns the glyph's registry name only when there's a value, not a checkbox state). This is accepted, not fixed here — see `## Non-Goals`.
- **Only the first `Selection` range is read.** Firefox supports multi-range selection (Ctrl+drag); Chrome does not. `getRangeAt(0)` matches Chrome's model, which this framework already assumes elsewhere (no other selection code in this codebase handles `rangeCount > 1`).

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — the whole mechanism; read `init` (797), `onSubtreeClick`/`onRowClick` (1184-1282), `resolveClickedColumn` (70) and `computeColumnWindow`/`columnWidthsEqual` (120-177) as the precedent this plan's new module-level functions sit beside.
- [`packages/lib/src/typescript/lib/component/table/Row.ts`](packages/lib/src/typescript/lib/component/table/Row.ts) — `getComponents()` order via `setColumnWindow`'s `sortComponents` (495), `getFieldNames`/`getColumnWindowStart` (113-135), `isSeparator` (147).
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `_rowPool`/`_rowDisplayed` (52-55), `alignPoolWindow` (377-393), `hideExcessPoolRows` (436-445).
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) — `getRenderer()` (504).
- [`packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts`](packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts) — `getDisplayText()`'s contract (91).
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — `DOMSource` interface conventions; `getActiveElement` (1111, 2174) is the direct precedent `getDocumentSelection` is placed beside; `contains` (1170, 2226); `intern` (932).
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `ModelledDOMSource` (866), `installTestDOM`, `RecordingDOMSink`.
- [`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts) — the `resolveClickedColumn` describe block (449-505) is the exact pattern the new `locateCellInGrid` tests follow; the direct `(b as any).onKeyDown(...)` calls elsewhere in the file are the precedent for testing `onCopy` without a real event dispatch.
- [`packages/lib/src/typescript/lib/component/table/TableExporter.ts`](packages/lib/src/typescript/lib/component/table/TableExporter.ts) — `escapeCSVField` (138), the escaping shape `escapeTsvField` mirrors.
- [`plans/selectable-display-text.md`](plans/selectable-display-text.md) — the plan this one depends on; establishes `setUserSelect("text")` on every text-bearing renderer, `getDisplayText()` on every renderer, and the header/separator opt-out this plan's structural-exclusion reasoning mirrors.
- [`plans/implemented/native-context-menu-suppression.md`](plans/implemented/native-context-menu-suppression.md) — the closest existing precedent for wiring a native browser event the framework has no prior listener for, and the disposition-return convention `onCopy` follows.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the event-handling return-disposition rule and the DOM-seam rule, both binding on this plan.

---

## Non-Goals

- **No paste-side handling.** This is copy-out only.
- **No change to the selection mechanism.** No `setUserSelect` call changes anywhere; this plan only intercepts `copy` and reformats what `selectable-display-text` already makes selectable.
- **No `text/html` clipboard payload.** TSV alone meets the round-trip requirement; adding an HTML `<table>` serializer roughly doubles the surface (escaping, structure, styling decisions) for enrichment the task itself frames as optional.
- **No opt-out or configuration option.** Always on, matching `selectable-display-text`'s own always-on shape; nothing in the task asked for one.
- **No handling for a selection spanning outside this table's own rendered rows** — into another component, or a scrolled-out/virtualized row. A scrolled-out row has no DOM element for a `Selection` to reach in the first place; a selection resolving outside every rendered cell falls back to the browser's own default copy for that gesture.
- **No `Markdown`, `Dialog`, or `Notification` changes.** Those have no cell/row structure to preserve, and the browser's default copy is already correct there.
- **No multi-range (Firefox Ctrl+drag) selection support.** Only `Selection.getRangeAt(0)` is read, matching Chrome's single-range model.
- **No special-cased formatting for `BooleanCell` / `GlyphCell` / a `DynamicCell` resolved to `'boolean'`.** They contribute whatever their existing `getDisplayText()` already returns (empty string for the two boolean-backed cases); no `CellRenderer.getDisplayText()` override is added for them by this plan.

---

## Notes

[^copy-target]: A click anywhere in a row already calls `this.focus()` on `Body` itself (`Body.ts:1260`, guarded so it does not steal focus from an active `<input>`/`<textarea>`/`<select>` cell editor), which makes `Body`'s own element `document.activeElement`. This also happens at the end of a text-selecting drag: `selectable-display-text.md`'s own "Accepted side effects" section documents that a drag-select inside the table body still lands a row click, because the browser fires a trailing `click` whose target's nearest matching ancestor is caught by `Body`'s subtree click listener (`onSubtreeClick` → `onRowClick`, `Body.ts:1184-1282`). So by the time the user presses Ctrl+C, `document.activeElement` is `Body`'s own element, and the browser's `copy` event targets exactly that. `Event.addListener` routes by exact target id (`Event.ts`'s `baseListener` looks up `listenerMap.get(evnt.type)?.get(elementId)`), so an exact-target listener on `Body` is sufficient — no subtree walk, and no ambiguity between multiple tables on one page, since only one element is ever `document.activeElement` at a time.

[^treetable-inherits]: This resolves the "Table/TablePanel component family" scoping language in the task description: `TreeTable extends Table` and its cells (via `TreeCellRenderer`, which delegates `getDisplayText()` to the wrapped typed renderer) use the identical `Cell`/`CellRenderer` machinery this plan reads from. Excluding `TreeTable` would require adding active suppression, not simply omitting code — and the task's own non-goal list only names `Markdown`, `Dialog`, and `Notification` as genuinely out of scope, each because they lack a cell/row structure, which does not describe `TreeTable`.

[^why-not-rectangle]: A browser `Selection`/`Range` between two arbitrary points is not a spreadsheet-style rectangular block. Synthesizing a rectangle (e.g. "every cell whose column falls between the start and end column, in every row between the start and end row") would silently include cells the user's drag never touched — for example a drag from the top-right of a table to the bottom-left would, under a rectangle interpretation, also include the top-left and bottom-right corners, which were never under the pointer. Row-major (a `Range`'s actual document-order semantics) is both simpler to implement and matches what the user visually sees highlighted.

[^naming]: Named `getDocumentSelection()` / `DocumentSelectionRange` rather than `getSelectionRange()` to avoid confusion with the unrelated `DOMSink.setSelectionRange(handle, start, end)`, which sets a single `<input>` element's own native text-cursor range — a different concept (one element's internal cursor vs. the whole document's text selection).

[^not-reuse]: `TableExporter.escapeCSVField` ([`TableExporter.ts:138`](packages/lib/src/typescript/lib/component/table/TableExporter.ts#L138)) is `private static` on a different class and is comma-triggered (CSV's own delimiter) — not directly reusable, and importing it across an unrelated module for one shared shape would be a worse coupling than duplicating four lines. `escapeTsvField` in `Body.ts` mirrors its structure (quote-wrap, double interior quotes) with the trigger set swapped from `,` to `\t`.
