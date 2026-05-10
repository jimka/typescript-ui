# Table Export Functionality — Implementation Plan

## Overview

Add CSV and JSON export to the `Table` component via a pure-logic `TableExporter` helper class and two new public methods (`exportCSV`, `exportJSON`) on `Table`. Export is opt-in and surfaced through the existing column-visibility context menu (flat items, no submenu). The implementation touches three files and creates one new file.

---

## Architecture Decisions

### `TableExporter` is a stateless helper class

No `import` of any UI class is needed inside it, keeping it fully unit-testable without a DOM. It receives a column list and a record list at call time and returns a string or triggers a download.

### `ExportOptions` co-located with `TableExporter`

Matches the pattern for `ContextMenuItemConfig` (defined in `ContextMenuItem.ts`, re-exported from `index.ts`). `Table.ts` imports both from `./TableExporter.js`.

### Column selection is a private helper on `Table`

`getExportColumns(includeHidden: boolean): Column[]` is a one-liner that picks between `this.resolvedColumns` (all) and `this.getColumns()` (visible only).

### The export menu flag is an instance field

`setExportMenuEnabled(enabled: boolean)` follows the existing setter-based API style on `Table`. When `true`, `showColumnMenu` appends the two export items.

### Download mechanics in `TableExporter`

`TableExporter.download(content, filename, mimeType)` is a private static method shared by CSV and JSON. `URL.revokeObjectURL` is called synchronously and immediately after `anchor.click()`.

### RFC 4180 CSV escaping

Quote the field if it contains `,`, `"`, or `\n`; double interior `"`. Header row uses `Field.getName()`.

### JSON output scoped to export columns

The exporter picks only the keys for export columns from `record.getData()`, preventing hidden fields from leaking even when `includeHidden: false` is the default.

### Default filenames

`table-export.csv` and `table-export.json`.

### Context menu is single-level only

`ContextMenu.show()` accepts a flat `ContextMenuItemConfig[]`. There is no nesting mechanism. Export items must be flat items, not a submenu.

---

## Public API (TypeScript Signatures)

### `ExportOptions` and `TableExporter` (new file)

```typescript
export interface ExportOptions {
    /** When true, hidden columns are included in the export. Default: false. */
    includeHidden?: boolean;
    /** Override the downloaded filename. */
    filename?: string;
}

export class TableExporter {
    /**
     * Converts columns + records to an RFC 4180 CSV string and triggers a download.
     */
    static exportCSV(
        columns: Column[],
        records: ModelRecord[],
        options?: ExportOptions
    ): void;

    /**
     * Converts columns + records to a JSON array of objects and triggers a download.
     */
    static exportJSON(
        columns: Column[],
        records: ModelRecord[],
        options?: ExportOptions
    ): void;

    /** RFC 4180: wrap in quotes if the value contains , " or \n; double interior ". */
    private static escapeCSVField(value: any): string;

    /** Creates a Blob, clicks a temporary <a> anchor, then synchronously revokes the URL. */
    private static download(content: string, filename: string, mimeType: string): void;
}
```

### Additions to `Table`

```typescript
/** Opt-in: when true, "Export as CSV" and "Export as JSON" appear in the column context menu. */
setExportMenuEnabled(enabled: boolean): void;

/** Triggers a CSV download of the current store view. */
exportCSV(options?: ExportOptions): void;

/** Triggers a JSON download of the current store view. */
exportJSON(options?: ExportOptions): void;

/** Returns columns for export. */
private getExportColumns(includeHidden: boolean): Column[];
```

### Addition to `index.ts`

```typescript
export type { ExportOptions } from './component/table/TableExporter.js';
```

---

## Ordered Implementation Steps

### Step 1 — Create `TableExporter.ts`

`Base/component/table/TableExporter.ts`

1. License header.
2. Import `Column` from `./Column.js` and `ModelRecord` from `../../data/ModelRecord.js`.
3. Export `ExportOptions` interface.
4. Export `TableExporter` class with:

**`private static escapeCSVField(value: any): string`:**
```typescript
private static escapeCSVField(value: any): string {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}
```

**`private static download(content, filename, mimeType): void`:**
```typescript
private static download(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
```

**`static exportCSV(columns, records, options?): void`:**
```typescript
static exportCSV(columns: Column[], records: ModelRecord[], options?: ExportOptions): void {
    const header = columns
        .map(c => TableExporter.escapeCSVField(c.getField().getName()))
        .join(',');

    const rows = records.map(record =>
        columns
            .map(c => TableExporter.escapeCSVField(record.get(c.getField().getName())))
            .join(',')
    );

    const csv = [header, ...rows].join('\r\n');
    TableExporter.download(csv, options?.filename ?? 'table-export.csv', 'text/csv;charset=utf-8;');
}
```

**`static exportJSON(columns, records, options?): void`:**
```typescript
static exportJSON(columns: Column[], records: ModelRecord[], options?: ExportOptions): void {
    const data = records.map(record =>
        Object.fromEntries(
            columns.map(c => [c.getField().getName(), record.get(c.getField().getName())])
        )
    );
    const json = JSON.stringify(data, null, 2);
    TableExporter.download(json, options?.filename ?? 'table-export.json', 'application/json');
}
```

### Step 2 — Add private field and helper to `Table.ts`

1. Add import: `import { TableExporter, ExportOptions } from './TableExporter.js';`
2. Add `private exportMenuEnabled: boolean = false;`
3. Add `setExportMenuEnabled(enabled: boolean): void` — sets the field.
4. Add `private getExportColumns(includeHidden: boolean): Column[]`:
   ```typescript
   private getExportColumns(includeHidden: boolean): Column[] {
       return includeHidden ? this.resolvedColumns.slice() : this.getColumns();
   }
   ```

### Step 3 — Add `exportCSV` and `exportJSON` to `Table.ts`

```typescript
exportCSV(options?: ExportOptions): void {
    const columns = this.getExportColumns(options?.includeHidden ?? false);
    const records = this.store.getRecords();
    TableExporter.exportCSV(columns, records, options);
}

exportJSON(options?: ExportOptions): void {
    const columns = this.getExportColumns(options?.includeHidden ?? false);
    const records = this.store.getRecords();
    TableExporter.exportJSON(columns, records, options);
}
```

`store.getRecords()` returns the filtered, sorted view — the same records the user sees.

### Step 4 — Extend `showColumnMenu` in `Table.ts`

At the end of the `items` array construction, before `this.columnContextMenu.show(x, y, items)`:

```typescript
if (this.exportMenuEnabled) {
    items.push(
        { separator: true },
        { text: 'Export as CSV',  action: () => this.exportCSV()  },
        { text: 'Export as JSON', action: () => this.exportJSON() }
    );
}
```

Final menu order:
```
[column toggles...]
─ separator ─
Reset columns
─ separator ─       ← new, conditional
Export as CSV       ← new, conditional
Export as JSON      ← new, conditional
```

### Step 5 — Re-export from `index.ts`

In the "Table subsystem" section:

```typescript
export type { ExportOptions } from './component/table/TableExporter.js';
```

`TableExporter` itself is not exported — callers use `table.exportCSV(...)` / `table.exportJSON(...)`.

---

## Edge Cases

**Null / undefined cell values**: `escapeCSVField` stringifies them as empty string via `String(value ?? '')`. No `"null"` or `"undefined"` appears literally in exports.

**Empty store**: both exporters handle empty `records` array — CSV will contain only the header row; JSON produces `[]`.

**`includeHidden: true` semantics**: uses `this.resolvedColumns` which honours the spec's `appendUnlisted` setting. Fields excluded by `appendUnlisted: false` are never exported even with `includeHidden: true`.

**MIME type for CSV**: `text/csv;charset=utf-8;` ensures non-ASCII characters are handled correctly by Excel and other consumers.

**`URL.revokeObjectURL` timing**: `click()` is synchronous from JavaScript's perspective. The browser queues the download before `revokeObjectURL` runs.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `Base/component/table/TableExporter.ts` |
| Modify | `Base/component/table/Table.ts` |
| Modify | `Base/index.ts` |

---

## Critical Files

- `src/typescript/Base/component/table/TableExporter.ts` (new)
- `src/typescript/Base/component/table/Table.ts`
- `src/typescript/Base/index.ts`
- `src/typescript/Base/component/table/Column.ts` (reference — `getField()` is the key method used)
