---
depends-on:
  - clipboard-context-menu-foundation
  - text-input-context-menu-clipboard
---

# Table Cell Context-Menu Clipboard Actions — Implementation Plan

## Overview

`Body.init` suppresses the browser's own right-click menu page-wide ([native-context-menu-suppression.md](implemented/native-context-menu-suppression.md)). Two things in `Table`/`TreeTable` are affected: a cell's own in-place text editing, and the table's whole-cell/range selection (drag across cells, or a plain click) that already supports Copy but not Cut or Paste.

Today, right-clicking a data cell calls `Table.showCellMenu()` ([Table.ts:1774](../packages/lib/src/typescript/lib/component/table/Table.ts#L1774)), which shows a single hand-rolled "Copy" item calling `Body.copyContextMenuSelection()` ([Body.ts:1797](../packages/lib/src/typescript/lib/component/table/Body.ts#L1797)). Ctrl/Cmd+C runs the same copy through `Body.copySelectionToClipboard()` ([Body.ts:1783](../packages/lib/src/typescript/lib/component/table/Body.ts#L1783)), from `Body.onKeyDown()` ([Body.ts:2459](../packages/lib/src/typescript/lib/component/table/Body.ts#L2459)). Both build clipboard text through `Body.buildCopyText()` ([Body.ts:1752](../packages/lib/src/typescript/lib/component/table/Body.ts#L1752)) → `TableExporter.buildRectangularTSV()` ([TableExporter.ts:185](../packages/lib/src/typescript/lib/component/table/TableExporter.ts#L185)), confirmed as current on `master` — the older `plans/implemented/table-copy-clipboard-format.md` describes a since-removed `onCopy`/`locateCellInGrid` shape that no longer exists.

This plan adds Cut and Paste beside that existing Copy — for the range selection (new keyboard and menu paths on `Body`/`Table`, and a TSV parser on `TableExporter`) and, separately, for the three cell editors (`DateEditor`, `TimeEditor`, `DateTimeEditor`) that construct their own `<input>` outside the `TextInput` hierarchy and so don't inherit [`text-input-context-menu-clipboard.md`](text-input-context-menu-clipboard.md)'s mechanism the way `StringEditor`/`NumberEditor` do.

---

## Architecture Decisions

### `StringEditor` and `NumberEditor` already get the Cut/Copy/Paste menu for free

Both compose a real `TextField` as a registered child (`String.ts:20,59`, `Number.ts:40,84-86`), so the field's own `<input>` is a genuine descendant element. Right-clicking it dispatches straight to `TextInput`'s own exact-target `contextmenu` listener with no interception in between.[^string-number-free] No source change to either class.

### `ComboEditor` and `BooleanEditor` stay out of scope

`ComboEditor` wraps a `ComboBox` (`tag: "div"`, `Combo.ts:41,47`) and `BooleanEditor` wraps a `Checkbox` — neither has an editable text control, the same reasoning [text-input-context-menu-clipboard.md](text-input-context-menu-clipboard.md) used to exclude `ComboBox` itself.

### `TextInputCellEditor` gets its own small Cut/Copy/Paste mechanism, built from the shared primitives

`DateEditor`, `TimeEditor`, and `DateTimeEditor` extend `TextInputCellEditor`, whose constructor calls `super("input")` ([TextInputCellEditor.ts:32](../packages/lib/src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts#L32)) — its own element *is* the `<input>`, built independently of `TextInput`. Rather than refactor it to extend or compose `TextInput`, this plan adds a second, self-contained `contextmenu` handler plus `copy()`/`cut()`/`paste()` directly on `TextInputCellEditor`, using the exact same `buildClipboardMenuItems` and `DOM.source.getSelectionRange` primitives `TextInput` uses.[^textinputcelleditor-own-mechanism] Unlike `TextInput`, these methods need no enabled/read-only gate: the editor only ever exists while its cell is being edited, and `Cell.startEdit()` already refuses to start when `cell.isReadOnly()` ([Cell.ts:636](../packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L636)).

### `TreeTable`/`TreeBody` inherit everything here for free

`TreeTable extends Table` ([TreeTable.ts:87](../packages/lib/src/typescript/lib/component/table/TreeTable.ts#L87)) and `TreeBody extends _Body` ([TreeBody.ts:112](../packages/lib/src/typescript/lib/component/table/TreeBody.ts#L112)) with no override of `onCellContextMenu`, `onKeyDown`'s copy/cut/paste branch, or the context-menu family of methods this plan adds. `TreeBody` overrides only `getVisibleRecords()` ([TreeBody.ts:511](../packages/lib/src/typescript/lib/component/table/TreeBody.ts#L511)), which is exactly the seam `buildCopyText`, `cutRange`, and `pasteIntoRange` already call polymorphically — the same reason Copy already works on `TreeTable` today.

### A field is clearable/pasteable exactly when `Row.createCellForField` would give it a real editor

`Row.createCellForField` ([Row.ts:883-922](../packages/lib/src/typescript/lib/component/table/Row.ts#L883)) decides, in order: a custom `ColumnConfig.renderer` wins (display-only, no editor); then `ColumnConfig.cellType` (a `DynamicCell`, whose editable variant varies per record); then a static `ColumnConfig.values` list (`ComboCell`); then a switch on `field.getType()` — `string`/`number`/`boolean`/`date`/`time`/`datetime` each get a real editor, `glyph` and any unmapped type fall through to `GlyphCell`/`DefaultCell`, both built with no editor at all. Cut and Paste reuse this exact precedence for a new `isFieldClearable(field, config)` check: true for the switch's six types and for a static combo, false for a custom renderer, a per-record `cellType`, `glyph`, or the unmapped fallback.

| Column shape | `isFieldClearable` |
|---|---|
| `field.getType() === 'string'` \| `'number'` \| `'boolean'` \| `'date'` \| `'time'` \| `'datetime'` | `true` |
| `config.values` non-empty (static combo) | `true` |
| `config.renderer` set | `false` — display-only, no editor |
| `config.cellType` set (`DynamicCell`) | `false` — per-record variant, no single static shape |
| `field.getType() === 'glyph'`, or unmapped | `false` — `GlyphCell`/`DefaultCell`, no editor |

A boolean field is clearable, not excluded: `BooleanEditor.setValue(null)` renders the checkbox's indeterminate state, and `null`/`undefined` are already a real, existing "empty" boolean per `Body.isEmptyValue`'s own doc comment.[^boolean-clearable] Clearing a cell always writes `null`, never `""` — the same "no value is `null`, not empty string" convention `StringEditor`/`ComboEditor` already use.

### Cut is copy-then-clear; a read-only cell in the range is only ever copied, never cleared

`cutRange(bounds)` calls the existing `buildCopyText(bounds)` first — a read-only or non-clearable cell still contributes its value to the clipboard — then clears every cell that is both clearable and not read-only. Read-only is decided by extracting `applyReadOnlyState`'s existing three-source union ([Body.ts:2200-2211](../packages/lib/src/typescript/lib/component/table/Body.ts#L2200)) into `isRecordFieldReadOnly(record, fieldName)`, reused by both `applyReadOnlyState` and the new Cut/Paste path so the two never drift.[^readonly-extract]

### Paste writes the clipboard's own shape at the target's top-left corner, clipped to the table

Paste does not reuse the resolved range's *extent* — only its top-left corner as the write origin. It writes the parsed clipboard grid at its own size, silently dropping whatever falls past the last visible row or last visible column.[^paste-shape] A separator row in the destination is skipped (the write cursor advances past it without consuming a clipboard row), mirroring `buildCopyText`'s own separator skip.

| Clipboard shape | Anchor | Remaining table (from anchor) | Result |
|---|---|---|---|
| 2×2 | row 3, col 1 | 10 rows × 5 cols | writes rows 3–4, cols 1–2 |
| 2×2 | row 9 of a 10-row table, col 1 | 1 row × 5 cols | writes only row 9; clipboard's second row is dropped |
| 1×5 | row 3, col 3 of a 4-column table | 10 rows × 1 col | writes only col 3; clipboard's columns 4–7 are dropped |

Per destination cell: an empty pasted field (`""`) writes `null` (a clear, so a Cut-then-Paste-elsewhere round-trips losslessly)[^empty-clears]; a non-empty value that fails `Field.convertValue` (the same coercion `ModelRecord.set` already runs — `undefined`, or a numeric `NaN`, exactly `ModelRecord`'s private `checkType`'s own failure test) is skipped, leaving the existing value; a non-clearable or read-only cell is skipped; everything else writes the raw string, letting `ModelRecord.set`/`setMany` do the real, single-authority conversion.

| Column type | Pasted text | Write |
|---|---|---|
| `number` | `"42"` | `42` |
| `number` | `""` | `null` (clears the cell) |
| `number` | `"abc"` | skipped — existing value unchanged |
| `date` | an unparseable date string | skipped — existing value unchanged |
| `boolean` | any non-empty string | always writes — `Field.convertValue`'s boolean coercion never fails, so `"maybe"` writes `true` exactly as it would via `record.set` today |
| `string` | `"hello"` | `"hello"` |
| read-only cell in range | any | skipped |
| `glyph` / custom-renderer / dynamic-`cellType` column | any | skipped — not clearable/pasteable |

All writes to one destination record within one paste are batched through `record.setMany(...)` — one store notify per row instead of one per field.

### Keyboard Ctrl/Cmd+X and Ctrl/Cmd+V extend the existing Ctrl/Cmd+C branch in `Body.onKeyDown`

`onKeyDown` ([Body.ts:2459](../packages/lib/src/typescript/lib/component/table/Body.ts#L2459)) already special-cases Ctrl/Cmd+C, deferring to the browser when `DOM.source.getDocumentSelection()` reports a live sub-cell text selection. The new 'x'/'v' branches need no such guard.[^keyboard-xv]

### `Table.showCellMenu` migrates onto the shared `buildClipboardMenuItems`, gaining Cut and Paste

The hand-rolled Copy item is replaced by `buildClipboardMenuItems({ hasSelectedText: true, cut, copy, paste })`, matching how [clipboard-context-menu-foundation.md](clipboard-context-menu-foundation.md) migrated `MarkdownEditor` and how [text-input-context-menu-clipboard.md](text-input-context-menu-clipboard.md) builds `TextInput`'s own menu. `hasSelectedText` is a literal `true`: `showCellMenu` only ever runs after a real right-click resolved `_contextMenuCell`, so a target always exists at menu-open time — the same always-enabled behaviour the current Copy item already has (it sets no `enabled` field at all).[^hasSelectedText-true] Cut and Paste are offered whenever Copy is, rather than gated by a separate read-only check: a range can mix read-only and writable cells, and each Cut/Paste call already skips what it can't touch per-cell, so a whole-row omission would be misleading.[^always-offered] This drops the item's `glyph: 'clipboard'` decoration, since the shared builder never sets `glyph`.[^glyph-drop]

### `TableExporter` gets a TSV parser as `buildRectangularTSV`'s read twin

No TSV/CSV import or paste-parsing code exists anywhere in the codebase today (confirmed by search) — `parseRectangularTSV(text)` is new, placed directly after `buildRectangularTSV` ([TableExporter.ts:187](../packages/lib/src/typescript/lib/component/table/TableExporter.ts#L187)) as its inverse, using the same quoting rules `escapeTSVField` writes (a field is quoted, with `"` doubled inside, when it contains a tab, `"`, or newline) so a Copy-then-Paste round-trips losslessly.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/table/TableExporter.ts

/**
 * Parses tab/newline-delimited clipboard text into a row-major grid of cell
 * strings — the exact inverse of `buildRectangularTSV`, including its
 * quoting for a field containing a tab, `"`, or newline. `""` parses to `[]`.
 *
 * @internal
 */
static parseRectangularTSV(text: string): string[][];
```

```typescript
// packages/lib/src/typescript/lib/component/table/Body.ts — new public methods on TableBody
// (exported as `Body`), inherited unchanged by `TreeBody`.

/** Cuts the current cell-range selection: copies it, then clears every clearable, non-read-only cell in it. The Ctrl/Cmd+X path. No-op when nothing is selected. */
cutSelectionToClipboard(): void;

/** Reads the clipboard and writes it into the grid starting at the current selection's top-left corner. The Ctrl/Cmd+V path. No-op when nothing is selected, or the clipboard is empty/unavailable. */
pasteAtSelection(): Promise<void>;

/** The menu's Cut path. Resolves its target exactly like `copyContextMenuSelection`. No-op when no cell was right-clicked. */
cutContextMenuSelection(): void;

/** The menu's Paste path. Resolves its target exactly like `copyContextMenuSelection`; writes at that target's top-left corner. No-op when no cell was right-clicked. */
pasteAtContextMenuSelection(): Promise<void>;
```

```typescript
// packages/lib/src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts —
// new public methods, inherited by DateEditor, TimeEditor, DateTimeEditor.

/** Copies the current selection to the system clipboard. No-op without a selection. */
copy(): this;

/** Copies the current selection to the system clipboard, then removes it from the field. No-op without a selection. */
cut(): this;

/** Reads the system clipboard and inserts it at the caret, replacing any selection. */
paste(): Promise<boolean>;
```

No new options, no new events. `StringEditor`, `NumberEditor`, `ComboEditor`, `BooleanEditor`, `TreeTable`, `TreeBody` are unchanged.

---

## Internal Structure

### `TableExporter.parseRectangularTSV`

Placed directly after `buildRectangularTSV` ([TableExporter.ts:187](../packages/lib/src/typescript/lib/component/table/TableExporter.ts#L187)):

```typescript
// JSDoc as given in `## Public API`.
static parseRectangularTSV(text: string): string[][] {
    if (text === '') {
        return [];
    }

    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];

        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else if (c === '"' && field === '') {
            inQuotes = true;
        } else if (c === '\t') {
            row.push(field);
            field = '';
        } else if (c === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (c === '\r') {
            // Dropped: a real spreadsheet paste uses `\r\n` line endings.
        } else {
            field += c;
        }
    }

    row.push(field);
    rows.push(row);

    return rows;
}
```

### `Body.ts` additions

`isFieldClearable`, placed directly before `resolveContextMenuBounds` (new, see below):

```typescript
/**
 * Reports whether `field` has a real, statically-typed editor per
 * {@link Row.createCellForField}'s own precedence — the same test that
 * decides whether Cut may clear it or Paste may write it.
 */
private isFieldClearable(field: Field, config: ColumnConfig | undefined): boolean {
    if (config?.renderer || config?.cellType) {
        return false;
    }

    if (config?.values && config.values.length > 0) {
        return true;
    }

    switch (field.getType()) {
        case 'string':
        case 'number':
        case 'boolean':
        case 'date':
        case 'time':
        case 'datetime':
            return true;
        default:
            return false;
    }
}
```

`isRecordFieldReadOnly`, extracted from `applyReadOnlyState`'s per-entry union ([Body.ts:2200-2211](../packages/lib/src/typescript/lib/component/table/Body.ts#L2200)):

```typescript
/** The same read-only union {@link applyReadOnlyState} paints onto pooled cells, usable for a record/field pair with no live Cell. */
private isRecordFieldReadOnly(record: ModelRecord, fieldName: string): boolean {
    const config = this._columnConfigs.get(fieldName);

    return config?.readOnly === true
        || this._rowReadOnly?.(record) === true
        || config?.cellReadOnly?.(record) === true;
}
```

`applyReadOnlyState`'s loop body shrinks to:

```typescript
for (const { cell, fieldName } of entries) {
    cell.setReadOnly(this.isRecordFieldReadOnly(record, fieldName));
}
```

`resolveContextMenuBounds`, extracted from `copyContextMenuSelection`'s current body ([Body.ts:1797-1814](../packages/lib/src/typescript/lib/component/table/Body.ts#L1797)), placed directly before it:

```typescript
/** The right-click target: the current range when the right-clicked cell falls inside it, otherwise just that one cell. Shared by the menu's Copy/Cut/Paste paths. */
private resolveContextMenuBounds(): CellRangeBounds | null {
    if (!this._contextMenuCell) {
        return null;
    }

    const currentRange = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus);

    return this.isCellWithinBounds(this._contextMenuCell, currentRange)
        ? currentRange
        : this.getCellRangeBounds(this._contextMenuCell, this._contextMenuCell);
}

copyContextMenuSelection(): void {
    const bounds = this.resolveContextMenuBounds();
    if (!bounds) {
        return;
    }

    DOM.sink.writeClipboardText(this.buildCopyText(bounds));
}
```

`cutRange` and `pasteIntoRange`, the two shared bodies, placed directly after `copyContextMenuSelection`:

```typescript
/** Copies `bounds` (unchanged from Copy's own formatting), then clears every clearable, non-read-only cell in it to `null`, one `setMany` per touched row. */
private cutRange(bounds: CellRangeBounds): void {
    DOM.sink.writeClipboardText(this.buildCopyText(bounds));

    const records = this.getVisibleRecords();
    const fields  = this.computeVisibleFields();

    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
        const record = records[r];
        if (this._rowSeparator?.(record)) {
            continue;
        }

        const clears: Record<string, null> = {};

        for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
            const field  = fields[c];
            const config = this._columnConfigs.get(field.getName());

            if (this.isFieldClearable(field, config) && !this.isRecordFieldReadOnly(record, field.getName())) {
                clears[field.getName()] = null;
            }
        }

        if (Object.keys(clears).length > 0) {
            record.setMany(clears);
        }
    }
}

/** Reads the clipboard, parses it as TSV, and writes it starting at `bounds`' top-left corner — see the Architecture Decision on paste shape. */
private async pasteIntoRange(bounds: CellRangeBounds): Promise<void> {
    const clip = await DOM.source.readClipboardText();
    if (clip === null || clip === '') {
        return;
    }

    const parsedRows = TableExporter.parseRectangularTSV(clip);
    const records    = this.getVisibleRecords();
    const fields     = this.computeVisibleFields();

    let destRow = bounds.minRow;

    for (const parsedRow of parsedRows) {
        while (destRow < records.length && this._rowSeparator?.(records[destRow])) {
            destRow++;
        }

        if (destRow >= records.length) {
            break;
        }

        const record = records[destRow];
        const values: Record<string, any> = {};

        for (let pc = 0; pc < parsedRow.length; pc++) {
            const destCol = bounds.minCol + pc;
            if (destCol >= fields.length) {
                break;
            }

            const field  = fields[destCol];
            const config = this._columnConfigs.get(field.getName());

            if (!this.isFieldClearable(field, config) || this.isRecordFieldReadOnly(record, field.getName())) {
                continue;
            }

            const raw = parsedRow[pc];

            if (raw === '') {
                values[field.getName()] = null;
                continue;
            }

            const coerced = field.convertValue(raw);
            const failed  = coerced === undefined || (typeof coerced === 'number' && isNaN(coerced));

            if (!failed) {
                values[field.getName()] = raw;
            }
        }

        if (Object.keys(values).length > 0) {
            record.setMany(values);
        }

        destRow++;
    }
}
```

Public wrappers, placed beside `copySelectionToClipboard`/`copyContextMenuSelection`:

```typescript
cutSelectionToClipboard(): void {
    const bounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus);
    if (!bounds) {
        return;
    }

    this.cutRange(bounds);
}

async pasteAtSelection(): Promise<void> {
    const bounds = this.getCellRangeBounds(this._rangeAnchor, this._rangeFocus);
    if (!bounds) {
        return;
    }

    await this.pasteIntoRange(bounds);
}

cutContextMenuSelection(): void {
    const bounds = this.resolveContextMenuBounds();
    if (!bounds) {
        return;
    }

    this.cutRange(bounds);
}

async pasteAtContextMenuSelection(): Promise<void> {
    const bounds = this.resolveContextMenuBounds();
    if (!bounds) {
        return;
    }

    await this.pasteIntoRange(bounds);
}
```

`onKeyDown`'s existing Ctrl/Cmd+C block ([Body.ts:2465-2475](../packages/lib/src/typescript/lib/component/table/Body.ts#L2465)) gains two siblings, inserted directly after it:

```typescript
if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
    this.cutSelectionToClipboard();

    return { prevent: true };
}

if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
    void this.pasteAtSelection();

    return { prevent: true };
}
```

### `Table.ts` — `showCellMenu`

Replaces the current body ([Table.ts:1774-1778](../packages/lib/src/typescript/lib/component/table/Table.ts#L1774)):

```typescript
private showCellMenu(x: number, y: number): void {
    this._columnContextMenu.show(x, y, buildClipboardMenuItems({
        hasSelectedText: true,
        cut:   () => this._body.cutContextMenuSelection(),
        copy:  () => this._body.copyContextMenuSelection(),
        paste: () => void this._body.pasteAtContextMenuSelection(),
    }));
}
```

New import, beside the existing `~/component/container/MenuItem.js` import ([Table.ts:18](../packages/lib/src/typescript/lib/component/table/Table.ts#L18)):

```typescript
import { buildClipboardMenuItems } from "~/component/shared/buildClipboardMenuItems.js";
```

The now-unused `clipboard` glyph import and its registration entry are removed: `import { clipboard } from "~/glyphs/solid/clipboard.js";` ([Table.ts:27](../packages/lib/src/typescript/lib/component/table/Table.ts#L27)) and the `clipboard` argument in `Glyph.register(table_columns, undo, file_csv, file_code, file_lines, clipboard);` ([Table.ts:49](../packages/lib/src/typescript/lib/component/table/Table.ts#L49)).

### `TextInputCellEditor.ts` additions

New imports, added to the existing import block:

```typescript
import { Event } from "~/core/Event.js";
import { Menu } from "~/overlay/Menu.js";
import { buildClipboardMenuItems } from "~/component/shared/buildClipboardMenuItems.js";
```

New field, placed after the three existing private fields ([TextInputCellEditor.ts:27-29](../packages/lib/src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts#L27)):

```typescript
// Self-wired Cut/Copy/Paste replacement for the browser's own right-click
// menu, suppressed page-wide by Body.init (native-context-menu-suppression.md).
// Mirrors TextInput._contextMenu; disposed explicitly in destructor().
private readonly _contextMenu: Menu = new Menu();
```

Constructor gains one line ([TextInputCellEditor.ts:31-33](../packages/lib/src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts#L31)):

```typescript
constructor() {
    super("input");

    Event.addListener(this, "contextmenu", this.handleContextMenu);
}
```

New `destructor()` override, placed directly after the constructor:

```typescript
/** Disposes the context menu, then runs the inherited teardown — `_contextMenu` is a Position.FIXED overlay, never a registered child. */
protected destructor(): void {
    this._contextMenu.dispose();

    super.destructor();
}
```

New `handleContextMenu`, `copy`, `cut`, `paste`, placed after `setAutoComplete` and before `init()` ([TextInputCellEditor.ts:75-80](../packages/lib/src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts#L75)):

```typescript
private handleContextMenu(event: MouseEvent): Event.ListenerResult {
    const element = this.getElement();

    if (element) {
        const range           = DOM.source.getSelectionRange(element);
        const hasSelectedText = range !== null && range.start !== range.end;

        this._contextMenu.show(event.clientX, event.clientY, buildClipboardMenuItems({
            hasSelectedText,
            cut:   () => this.cut(),
            copy:  () => this.copy(),
            paste: () => void this.paste(),
        }));
    }

    return { stop: true, prevent: true };
}

copy(): this {
    const element = this.getElement();
    if (!element) {
        return this;
    }

    const range = DOM.source.getSelectionRange(element);
    if (range === null || range.start === range.end) {
        return this;
    }

    DOM.sink.writeClipboardText(DOM.source.getValue(element).slice(range.start, range.end));

    return this;
}

cut(): this {
    const element = this.getElement();
    if (!element) {
        return this;
    }

    const range = DOM.source.getSelectionRange(element);
    if (range === null || range.start === range.end) {
        return this;
    }

    const text = DOM.source.getValue(element);
    DOM.sink.writeClipboardText(text.slice(range.start, range.end));

    DOM.sink.setValue(element, text.slice(0, range.start) + text.slice(range.end));
    DOM.sink.setSelectionRange(element, range.start, range.start);

    // Re-fires "input" so the subclass's own listener (DateEditor / TimeEditor /
    // DateTimeEditor's `Event.addListener(this, "input", () => this.onInput())`)
    // re-syncs its cached value from the DOM — mirrors TextInput.cut().
    Event.fireEvent(this, "input");

    return this;
}

async paste(): Promise<boolean> {
    const element = this.getElement();
    if (!element) {
        return false;
    }

    const clip = await DOM.source.readClipboardText();
    if (clip === null) {
        return false;
    }

    const el = this.getElement();

    if (clip !== "" && el) {
        const text     = DOM.source.getValue(el);
        const range    = DOM.source.getSelectionRange(el) ?? { start: text.length, end: text.length };
        const combined = text.slice(0, range.start) + clip + text.slice(range.end);

        DOM.sink.setValue(el, combined);

        const caret = Math.min(range.start + clip.length, combined.length);
        DOM.sink.setSelectionRange(el, caret, caret);
        Event.fireEvent(this, "input");
    }

    return true;
}
```

---

## Ordered Implementation Steps

1. **Write `TableExporter.parseRectangularTSV` tests (red).** Extend [`TableExporter.test.ts`](../packages/lib/tests/component/table/TableExporter.test.ts), adding a `describe('TableExporter.parseRectangularTSV', ...)` block beside the existing `describe('TableExporter.buildRectangularTSV', ...)` (line 249), covering Expected Behaviour 1-6.
   *Check:* fails to compile (method doesn't exist).

2. **Implement `parseRectangularTSV`.** Add it to [`TableExporter.ts`](../packages/lib/src/typescript/lib/component/table/TableExporter.ts) from `## Internal Structure`, directly after `buildRectangularTSV` (line 187).
   *Check:* Step 1's tests pass.

3. **Extract `isFieldClearable` and `isRecordFieldReadOnly` on `Body`.** In [`Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts): add `isFieldClearable` (new); replace `applyReadOnlyState`'s inlined union (lines 2200-2211) with a call to the new `isRecordFieldReadOnly`, per `## Internal Structure`.
   *Check:* `cd packages/lib && npx vitest run tests/component/table/Body.test.ts` — the existing read-only tests (`describe('Body required-empty cell outline resolution', ...)` and any read-only coverage) stay green with no test edits, proving the refactor is behaviour-preserving.

4. **Write Body Cut/Paste tests (red).** Extend `Body.test.ts` with two new `describe` blocks, `'Body range selection — cut'` and `'Body range selection — paste'`, placed after the existing `'Body range selection — copy'` (line 1031) and `'... — right-click / context menu'` (line 1171) blocks — mirror their exact setup shape (`MemoryStore`, `(b as any)._rangeAnchor/_rangeFocus`, `RecordingDOMSink.writes`, `vi.spyOn(DOM.source, 'readClipboardText')` per [text-input-context-menu-clipboard.md](text-input-context-menu-clipboard.md)'s own paste-test idiom). Cover Expected Behaviour 7-28.
   *Check:* fails to compile (the methods don't exist yet).

5. **Implement `resolveContextMenuBounds`, `cutRange`, `pasteIntoRange`, and the four public wrappers on `Body`.** Refactor `copyContextMenuSelection` to call `resolveContextMenuBounds`. Extend `onKeyDown` with the 'x'/'v' branches. All from `## Internal Structure`.
   *Check:* Step 4's tests pass. `cd packages/lib && npx vitest run tests/component/table/Body.test.ts tests/component/table/TreeBody.test.ts` — all green, `TreeBody.test.ts` unedited.

6. **Write `Table.showCellMenu` tests (red).** Extend [`Table.test.ts`](../packages/lib/tests/component/table/Table.test.ts): a new test asserting `showCellMenu` builds Cut/Copy/Paste rows in that order via `vi.spyOn(Menu.prototype, 'show')`, mirroring the existing `'Table cellcontextmenu — right-click "Copy" menu'` block (line 83). Cover Expected Behaviour 29.
   *Check:* fails — the menu still has one item.

7. **Migrate `showCellMenu`.** In [`Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts): add the `buildClipboardMenuItems` import; replace `showCellMenu`'s body; remove the now-unused `clipboard` glyph import and its `Glyph.register(...)` argument; update the doc comment above `showCellMenu` ([Table.ts:1765-1773](../packages/lib/src/typescript/lib/component/table/Table.ts#L1765)) to mention Cut and Paste. Update the stale comment above the existing `'Table cellcontextmenu — right-click "Copy" menu'` describe block ([Table.test.ts:78-82](../packages/lib/tests/component/table/Table.test.ts#L78)) — it currently explains a since-removed `glyph: 'clipboard'` regression; rewrite it to state the test is now a general "menu construction doesn't throw" smoke check, keeping the `not.toThrow()` assertion itself.
   *Check:* Step 6's test passes. `grep -n "clipboard" packages/lib/src/typescript/lib/component/table/Table.ts` — zero matches. `npm run lint` — no unused-import warning.

8. **Write `TextInputCellEditor` tests (red).** Extend [`editor.test.ts`](../packages/lib/tests/component/table/cell/editor.test.ts) with a new `describe('TextInputCellEditor Cut/Copy/Paste', ...)` block, instantiating a `DateEditor` (any of the three subclasses works identically). Cover Expected Behaviour 31-34, using the same `Event.fireEvent(editor, makeEvent(el, 'contextmenu', {...}))` + `vi.spyOn(Menu.prototype, 'show')` technique [text-input-context-menu-clipboard.md](text-input-context-menu-clipboard.md) used for `TextInput`.
   *Check:* fails to compile.

9. **Implement the `TextInputCellEditor` additions.** From `## Internal Structure`.
   *Check:* Step 8's tests pass. `cd packages/lib && npx vitest run tests/component/table/cell/editor.test.ts` — green, including the pre-existing `DateEditor`/`TimeEditor`/`DateTimeEditor` coverage with no edits to those classes.

10. **Add the "inherits for free" confirmation tests.** In `editor.test.ts`'s existing `describe('StringEditor', ...)` (line 424) and `describe('NumberEditor parse contract', ...)` (line 467) blocks, add one test each asserting a right-click on the composed `_textField`'s element opens the shared Cut/Copy/Paste menu (`vi.spyOn(Menu.prototype, 'show')`), with **no source changes** to `String.ts` or `Number.ts`. Covers Expected Behaviour 35-36.
   *Check:* green with zero source edits to either file — this is what proves the non-goal.

11. **Full check.** `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm test`, `npm run lint`, `npm run docs:api` (zero warnings).

12. **Docs.** Apply every edit in `## Documentation Impact`, per the `document` skill.

13. **Manual smoke test.** Behaviours 37-40, in the running demo app.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/TableExporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts` |
| Modify | `packages/lib/tests/component/table/TableExporter.test.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/tests/component/table/Table.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/editor.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

`packages/lib/tests/component/table/TreeBody.test.ts` is deliberately **not** in this table: Step 5's check requires it to pass unedited. `String.ts`, `Number.ts`, `Combo.ts` (both cell and editor), `Boolean.ts` (both cell and editor), `TreeTable.ts`, and `TreeBody.ts` are unchanged — see `## Non-Goals`.

---

## Expected Behaviour

**Unit-testable — `TableExporter.parseRectangularTSV`** (pure, mirrors the existing `buildRectangularTSV` tests):

1. `parseRectangularTSV('Alice\t25\nBob\t30')` → `[['Alice','25'],['Bob','30']]`.
2. `parseRectangularTSV('only')` → `[['only']]`.
3. `parseRectangularTSV('"a\tb"\t"c""d"\t"e\nf"')` → `[['a\tb','c"d','e\nf']]` — the inverse of the existing escaping case at `TableExporter.test.ts:259`.
4. `parseRectangularTSV('')` → `[]`.
5. For any grid of plain strings and strings containing tabs/quotes/newlines, `parseRectangularTSV(buildRectangularTSV(grid))` deep-equals `grid`.
6. `'a\tb\r\nc\td'` (a `\r\n` line ending) parses identically to `'a\tb\nc\td'`.

**Unit-testable — `Body` Cut** (`Body.test.ts`, `'Body range selection — cut'`):

7. `cutSelectionToClipboard()` with no range selected writes nothing and changes no record.
8. Cutting a single string cell writes its value to the clipboard and sets the record's field to `null`.
9. Cutting a multi-cell, multi-column range of plain writable string columns writes the pre-cut text to the clipboard (identical to what Copy would write) and sets every cell's field to `null`.
10. A read-only cell in the cut range keeps its value; every other cell in the range still clears.
11. A `glyph`, custom-`renderer`, or `cellType`-dynamic column's cells in the range keep their value; the rest of the range still clears.
12. Cutting a boolean cell sets it to `null` (renders indeterminate), not skipped.
13. A separator row inside the cut range keeps its own field values (mirrors Copy's existing separator skip) and its neighbours still clear.
14. Ctrl+X and Cmd+X both call `cutSelectionToClipboard()`; a bare `"x"` keypress does not.
15. `cutContextMenuSelection()` resolves its target exactly like `copyContextMenuSelection()`: inside the current range → the whole range; outside it → just the right-clicked cell; no cell right-clicked → no-op; the right-clicked record no longer visible → no-op, does not throw.

**Unit-testable — `Body` Paste** (`Body.test.ts`, `'Body range selection — paste'`, clipboard stubbed via `vi.spyOn(DOM.source, 'readClipboardText')`):

16. With the clipboard resolving `"X\tY"` and the anchor at row 0 col 0, `pasteAtSelection()` writes `"X"` into col 0 and `"Y"` into col 1 of that row.
17. Pasting a 2×2 grid anchored at the table's last row/column writes only what fits; the rest is silently dropped.
18. A read-only cell inside the paste's destination keeps its value; sibling writable cells in the same paste still write.
19. An empty pasted field (`""`) writes `null` to a writable, clearable destination cell.
20. A non-numeric string pasted into a `number` column's cell leaves that cell unchanged; other cells in the same paste still write.
21. An unparseable date string pasted into a `date` column's cell leaves it unchanged.
22. Any non-empty string pasted into a `boolean` column's cell always writes (never skipped).
23. Pasting into a `glyph`, custom-`renderer`, or `cellType`-dynamic column's cell is a no-op for that cell.
24. A destination row that is a separator is skipped without consuming a clipboard row for it.
25. Clipboard `null` (read denied) and `""` (empty) each leave every record unchanged.
26. `pasteAtContextMenuSelection()` resolves its target exactly like `copyContextMenuSelection()`/`cutContextMenuSelection()`.
27. Ctrl+V and Cmd+V both call `pasteAtSelection()`; a bare `"v"` keypress does not.
28. Pasting two fields into the same record fires exactly one store notify for that record (asserted via `record.setMany` being called once, or via a single `'datachange'`), not one per field.

**Unit-testable — `Table.showCellMenu`** (`Table.test.ts`):

29. Right-clicking a cell shows a menu with `"Cut"`, `"Copy"`, `"Paste"` in that order, `Cut`/`Copy` `enabled: true`, `Paste` present.
30. The existing `'constructs the context menu without throwing'` smoke test still passes with the `clipboard` glyph import removed.

**Unit-testable — `TextInputCellEditor`** (`editor.test.ts`, using `DateEditor`):

31. With text selected in the input, `copy()` writes that substring to the clipboard; with a collapsed caret, it writes nothing.
32. With text selected, `cut()` writes the substring to the clipboard, removes it from the input, and re-syncs the editor's cached value (`getValue()` reflects the post-cut text); with a collapsed caret, it is a no-op.
33. With the clipboard stubbed to resolve `"2024-01-01"` and a collapsed caret, `paste()` inserts it at the caret and re-syncs the cached value; with the clipboard resolving `null`, `paste()` resolves `false` with no change.
34. Right-clicking with text selected opens a menu with `Cut`/`Copy`/`Paste` all enabled; right-clicking with a collapsed caret opens `Cut`/`Copy` disabled and `Paste` present and enabled.

**Unit-testable — inherited-for-free confirmation** (`editor.test.ts`, existing `StringEditor`/`NumberEditor` blocks, no source edits):

35. Right-clicking `StringEditor`'s composed `_textField` element opens the same Cut/Copy/Paste menu `TextInput` builds.
36. Right-clicking `NumberEditor`'s composed `_textField` element does the same.

**Manual** (`npm run dev`, app on `localhost:8015`, a **Table**/**TreeTable** demo):

37. Selecting a range and pressing Ctrl/Cmd+X clears it and copies the pre-cut values; Ctrl/Cmd+V into a different cell writes them back.
38. Right-clicking a cell shows Cut/Copy/Paste; each acts correctly, including on a `TreeTable`.
39. Pasting a block copied from this table into a spreadsheet, then copying it back and pasting into the table, reproduces the original values (including any cell containing a tab, quote, or newline).
40. Double-clicking a `DateField`/`TimeField`/`DateTimeField` column's cell to edit it, then right-clicking inside it, shows the same Cut/Copy/Paste menu as a `TextField`; Cut/Copy/Paste act correctly and the cell still commits/parses normally afterward.

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` — clean.
- `cd packages/lib && npx vitest run tests/component/table/TableExporter.test.ts tests/component/table/Body.test.ts tests/component/table/Table.test.ts tests/component/table/cell/editor.test.ts tests/component/table/TreeBody.test.ts` — all green, `TreeBody.test.ts` unedited.
- `npm test` — the whole suite; no regression.
- `npm run lint` — clean; confirms the removed `clipboard` import leaves no unused-import warning.
- `grep -n "clipboard" packages/lib/src/typescript/lib/component/table/Table.ts` — zero matches.
- `grep -rn "isFieldClearable\|isRecordFieldReadOnly\|resolveContextMenuBounds\|cutRange\|pasteIntoRange" packages/lib/src/typescript/lib/component/table/Body.ts` — each defined once, used at the cited call sites.
- `grep -rn "TextInputCellEditor" packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts` — each still extends it unchanged; no new imports in these three files.
- `npm run docs:api` — zero warnings.
- `npm run build:docs` — clean VitePress build.
- Manual cases 37-40 above.

---

## Documentation Impact

- **[`packages/lib/docs/components/Table.md:274`](../packages/lib/docs/components/Table.md#L274)** — the paragraph describing range selection currently ends "...Ctrl/Cmd+C, or right-click a cell and choose **Copy** from the context menu, writes the selected range to the clipboard...". Extend it: Ctrl/Cmd+X (or **Cut**) additionally clears every cell in the range it can (skipping read-only and non-text-typed cells); Ctrl/Cmd+V (or **Paste**) writes clipboard TSV starting at the range's top-left cell, clipped to the table, skipping cells it can't write.
- **[`packages/lib/docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)** — add a bullet under `## Added` → `### Components` (line 100): "**`Table`/`TreeTable` cell ranges gain Cut and Paste**, alongside the existing Copy — via Ctrl/Cmd+X/V and the cell right-click menu. `DateEditor`/`TimeEditor`/`DateTimeEditor` (in-place cell editing) also gain a right-click Cut/Copy/Paste menu, matching `StringEditor`/`NumberEditor`, which already had one through their composed `TextField`."
- **No change to `docs/components/TreeTable.md`** — its "context menu... is identical" claim (line 5) already covers this without editing.
- **`packages/lib/llms.txt` needs no change** — generated from `scripts/llms/manifest.data.mjs`; this adds no new capability class it indexes.

---

## Potential Challenges

- **`ModelRecord.set`'s conversion runs a second time inside `setMany`.** The paste path pre-checks `field.convertValue(raw)` to decide whether to include a field, then hands the *raw string* (not the pre-computed value) to `setMany`, which converts again for the real write. This keeps `Field.convertValue` the single authority and costs one redundant, cheap conversion per written cell.
- **A `DynamicCell` column's actual per-record editable variant is never resolved for Cut/Paste.** `isFieldClearable` treats any `ColumnConfig.cellType` column as categorically non-clearable/pasteable, even though a given record's resolved variant might itself be a plain string. Resolving the per-record variant off-screen was rejected as unnecessary complexity for a column shape none of the sibling clipboard plans need to touch either — see `## Non-Goals`.
- **`Row.createCellForField`'s precedence could drift from `isFieldClearable`'s copy of it.** Both must be updated together if a new column shape is ever added; there is no shared helper between `Row.ts` and `Body.ts` today, and adding one is out of scope for this plan (`Row.createCellForField` is `private static`).

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts) — `buildCopyText` (1752), `copySelectionToClipboard`/`copyContextMenuSelection` (1783/1797), `getCellRangeBounds`/`isCellWithinBounds` (1641/1672), `applyReadOnlyState` (2200), `onKeyDown`'s Ctrl+C branch (2459).
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts) — `showCellMenu` (1774) and its `_columnContextMenu` field (214).
- [`packages/lib/src/typescript/lib/component/table/TableExporter.ts`](../packages/lib/src/typescript/lib/component/table/TableExporter.ts) — `buildRectangularTSV`/`escapeTSVField` (185/195), the escaping this plan's parser inverts.
- [`packages/lib/src/typescript/lib/component/table/Row.ts:883-922`](../packages/lib/src/typescript/lib/component/table/Row.ts#L883) — `createCellForField`, the precedent `isFieldClearable` mirrors.
- [`packages/lib/src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts), [`CellEditor.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts) — the class this plan extends, and why it can't simply extend `TextInput` (its abstract `getValue`/`setValue` contract, consumed by `CellEditorPool`/`Cell`).
- [`packages/lib/src/typescript/lib/component/table/cell/editor/String.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/String.ts), [`Number.ts`](../packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts) — confirm the composed-`TextField` shape that makes `StringEditor`/`NumberEditor` a verified non-goal.
- [`packages/lib/src/typescript/lib/data/Field.ts`](../packages/lib/src/typescript/lib/data/Field.ts) — `convertValue`/`convertByType`, the single coercion authority Paste reuses.
- [`packages/lib/src/typescript/lib/data/ModelRecord.ts`](../packages/lib/src/typescript/lib/data/ModelRecord.ts) — `set`/`setMany`/`checkType`, confirming the failure test Paste mirrors.
- [`plans/implemented/table-cell-range-selection.md`](implemented/table-cell-range-selection.md) — the current Copy mechanism this plan extends; supersedes `table-copy-clipboard-format.md`'s stale description.
- [`plans/clipboard-context-menu-foundation.md`](clipboard-context-menu-foundation.md), [`plans/text-input-context-menu-clipboard.md`](text-input-context-menu-clipboard.md) — the shared builder and the `TextInput` mechanism this plan mirrors on `TextInputCellEditor` and consumes directly in `Table.showCellMenu`.
- [`plans/implemented/data-field-types-and-validation.md`](implemented/data-field-types-and-validation.md) — `Field.convertValue`'s coercion table and `ModelRecord.checkType`'s failure test, reused as-is for Paste's per-cell validity check.

---

## Non-Goals

- **No refactor of `TextInputCellEditor`/`DateEditor`/`TimeEditor`/`DateTimeEditor` to extend or compose `TextInput`.** Rejected — see the Architecture Decision and its footnote.
- **No changes to `StringEditor`, `NumberEditor`, `ComboEditor`, `BooleanEditor`.** Each is either already covered (composed `TextField`) or out of scope (no editable text).
- **No per-record resolution of a `DynamicCell` column's actual variant.** A `cellType`-configured column is uniformly non-clearable/pasteable; see `## Potential Challenges`.
- **No tiling or growing the paste to fill a larger pre-existing selection.** Paste always uses the clipboard's own shape; see the Architecture Decision on paste shape.
- **No combo-option-membership validation on paste.** A pasted string outside a combo column's declared options writes verbatim, matching `ComboEditor.setValue`'s own existing looseness.
- **No change to `TreeTable.ts`/`TreeBody.ts`.** Both inherit this plan's mechanism unchanged — see the Architecture Decision.
- **No shortcut hints or glyphs on the Cut/Copy/Paste menu rows**, matching `buildClipboardMenuItems`'s own design.
- **No rich clipboard formats.** Copy/Cut write plain TSV text; Paste reads plain text.

---

## Notes

[^string-number-free]: `StringEditor`'s constructor wires `blur`/`keydown`/`input` listeners on `this._textField` and calls `this.addComponent(this._textField)` ([String.ts:28-59](../packages/lib/src/typescript/lib/component/table/cell/editor/String.ts#L28)); `NumberEditor` does the same with an `AnchorType.NORTHEAST` constraint ([Number.ts:48-86](../packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts#L48)). Per ARCHITECTURE.md's "one DOM element per class" rule, `_textField`'s own `<input>` is a real, independent element — the actual target of a right-click landing on it. `TextInput`'s `contextmenu` listener is registered exact-target (`Event.addListener(this, "contextmenu", ...)`) against that same `TextField` instance, so the dispatcher matches it directly; `CellEditorPool.wireListeners` ([CellEditorPool.ts:135-166](../packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L135)) only wires `blur`/`keydown` on the outer `CellEditor`, never `contextmenu`, so nothing intercepts it first.

[^textinputcelleditor-own-mechanism]: `CellEditor<T>` is `abstract`, declaring `abstract getValue(): T` / `abstract setValue(t: T): void` plus `retainsFocus`/`getContentX`/`getDisplayText`, consumed by `CellEditorPool.acquire` and `Cell.startEdit`/`commitEdit` ([Cell.ts:635-695](../packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L635)). `TextInput` has no matching generic `getValue`/`setValue` pair — it works in terms of `getText()`/`setText(string)` — so making `TextInputCellEditor` extend `TextInput` instead of `CellEditor<T>` would break that contract entirely, not merely diverge stylistically; every caller expecting a `CellEditor<T>` would need a separate adapter. Composing an inner `TextInput` (the `StringEditor`/`NumberEditor` shape) was also considered: it would work, but `DateEditor`/`TimeEditor`/`DateTimeEditor` each wire `focus`/`blur`/`input` directly on `this` today (their own element *is* the input) to drive a picker dropdown with its own focus-retention logic ([DateTime.ts:43-45,225-244](../packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L43)); moving to a composed child would mean re-plumbing that wiring onto the child in all three classes, purely to gain a context menu, with real risk to the dropdown behaviour. `TextInputCellEditor.ts`'s own doc comment independently confirms the design intent: it exists precisely because `CellEditor` "extends `Component` (not `Input`)" and most non-text editors prefer a `<div>` root — i.e., the class hierarchy was deliberately kept flat under `CellEditor`, not under any input-family base. The smaller mechanism this plan adds reuses the identical shared primitives (`buildClipboardMenuItems`, `DOM.source.getSelectionRange`) `TextInput` uses, so nothing about Cut/Copy/Paste's actual logic is duplicated — only the ten lines of DOM read/write plumbing are, which is what a shared primitive is for.

[^boolean-clearable]: `BooleanEditor.setValue(null)` ([Boolean.ts editor:118-134](../packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L118)) puts the checkbox into its indeterminate state and caches `null` — a real, reachable, already-rendered state, not an error. `Body.isEmptyValue`'s own doc comment ([Body.ts:2219](../packages/lib/src/typescript/lib/component/table/Body.ts#L2219)) independently states "an unset boolean (`null`/`undefined`, rendered indeterminate) IS empty", confirming `null` is boolean's own legitimate "no value" — symmetric with every other clearable type, not a special case needing exclusion.

[^readonly-extract]: Before this plan, `applyReadOnlyState`'s union (`config?.readOnly === true || this._rowReadOnly?.(record) === true || config?.cellReadOnly?.(record) === true`) had exactly one call site. Cut/Paste need the identical per-(record, field) answer for record/column pairs that may have no live pooled `Cell` (a cut/paste range can extend beyond the rendered row-pool window, exactly like `buildCopyText` already does), so the union is extracted into a named method rather than duplicated a second time.

[^paste-shape]: Two alternatives were rejected. Growing the active selection to match a larger clipboard would change selection state as a side effect of a paste, which nothing asked for. Clipping to the *selection's* shape (rather than the table's) would silently drop the clipboard's own extra rows/columns even when the table has room for them — surprising for the common "select one cell, paste a block" gesture, which is exactly why real spreadsheets use the clipboard's own shape too. Clipping only to the table's true remaining rows/columns keeps the rule to one sentence and matches that established, familiar behaviour.

[^empty-clears]: `buildCopyText` renders a `null` field as `''` (`String(value ?? '')`). If Paste treated `''` as "leave unchanged" instead of "clear", a Cut (which sets cleared cells to `null`) followed immediately by a Paste of that same clipboard elsewhere would silently fail to reproduce the blanks — breaking the basic "paste reproduces what was copied" expectation the whole feature exists to satisfy.

[^keyboard-xv]: `Body.onKeyDown` is registered with `Event.addListener(this, "keydown", this.onKeyDown)` ([Body.ts:1028](../packages/lib/src/typescript/lib/component/table/Body.ts#L1028)) — an exact-target registration on the body's own root element, confirmed by its own doc comment "`Body.onKeyDown` (which fires only while its own element holds focus)" ([Body.ts:2644](../packages/lib/src/typescript/lib/component/table/Body.ts#L2644)). While a cell is being edited, DOM focus sits on the editor's own descendant input, so this handler does not fire at all — there is no coexistence case with an editor's own Cut/Copy/Paste to arbitrate. The existing Ctrl+C guard exists for a different scenario entirely: the user drags to select rendered (non-editing) cell text natively while the body element still holds keyboard focus, and native Ctrl+C should copy that substring instead of the whole-cell-range. Cut and Paste have no equivalent competing native behaviour — a browser does not offer a native "cut" over merely-selected, non-editable text, and a focused non-input container has no native paste target — so neither new branch needs a guard.

[^hasSelectedText-true]: `showCellMenu` ([Table.ts:1774](../packages/lib/src/typescript/lib/component/table/Table.ts#L1774)) is only ever invoked from `Table`'s `"cellcontextmenu"` listener, which only fires after `Body.onCellContextMenu` successfully resolved a real cell and set `_contextMenuCell` ([Body.ts:1983-1993](../packages/lib/src/typescript/lib/component/table/Body.ts#L1983)) — so a target always exists when the menu opens, and the pre-existing Copy item never set an `enabled` field at all (effectively always enabled). Computing a real `hasSelectedText` would only matter for the narrow race where the right-clicked record is removed between the click and the menu render — a case the original code never bothered to reflect in the item's enabled state either (it only guards inside `copyContextMenuSelection` itself, which still no-ops safely). Matching that existing behaviour exactly avoids adding new plumbing for a race nothing here changes.

[^always-offered]: `TextInput`'s menu omits Cut/Paste entirely on a read-only field because a single scalar has one read-only flag for its whole value. A table range has no such single flag — it can freely mix read-only and writable cells, or clearable and non-clearable columns — so an item omitted for "some part of this range is read-only" would hide a Cut/Paste that would still usefully act on the rest of the range. Gating on Copy's own existing `hasSelectedText: true` keeps one enablement rule for all three rows, consistent with how Copy has always worked here.

[^glyph-drop]: `showCellMenu`'s current Copy item is the only place in `Table.ts` that imports and registers the `clipboard` glyph (confirmed: `grep -rl 'glyphs/solid/clipboard'` matches only `Table.ts` and its test). `buildClipboardMenuItems` never sets `glyph` on any row — a deliberate design choice recorded in `clipboard-context-menu-foundation.md`'s own Non-Goals ("no shortcut hints and no glyphs on the three rows"), already applied identically to `MarkdownEditor`'s migration in that same plan. Keeping Table's own Copy item hand-rolled (with its glyph) while adding hand-rolled Cut/Paste beside it was rejected: it would leave `Table` as the one consumer in the whole batch not using the shared builder, for the sake of one icon on one menu row.
