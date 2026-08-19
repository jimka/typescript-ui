# Table TSV Export — Implementation Plan

## Overview

`Table` (and its wrappers `TablePanel` / `TreeTablePanel`) currently offer two file-export formats — CSV and JSON — through [`TableExporter.exportCSV`](packages/lib/src/typescript/lib/component/table/TableExporter.ts#L42) / [`exportJSON`](packages/lib/src/typescript/lib/component/table/TableExporter.ts#L73), reached via [`Table.exportCSV`](packages/lib/src/typescript/lib/component/table/Table.ts#L1963) / [`Table.exportJSON`](packages/lib/src/typescript/lib/component/table/Table.ts#L1977) and two "Export as CSV" / "Export as JSON" column-context-menu entries. This plan adds a third format, TSV, with the same shape: `TableExporter.exportTSV`, `Table.exportTSV`, forwarding methods on `TablePanel`/`TreeTablePanel`, and a third "Export as TSV" menu entry everywhere the other two appear.

The just-merged `table-cell-range-selection` feature (`plans/implemented/table-cell-range-selection.md`) already added tab-separated formatting for clipboard copy: [`Body.buildRectangularTsv`](packages/lib/src/typescript/lib/component/table/Body.ts#L219) joins an already-stringified grid into tab/newline text, and a module-private `escapeTsvField` escapes one field. This plan relocates both into `TableExporter.ts` (renamed to match that file's `CSV`-acronym casing) so the new file-download path and the existing clipboard path share one escaping rule instead of two, and updates `Body.ts` to call the relocated version.

This is a wiring change, not new architecture — the record resolution, hidden-column handling, and value formatting `exportTSV` needs are identical to what `exportCSV`/`exportJSON` already do.

---

## Architecture Decisions

### `exportTSV` lives on `TableExporter`, mirroring `exportCSV`/`exportJSON` exactly

`TableExporter` is the only place in the codebase that builds a `Blob` and triggers a download.[^only-downloader] `exportTSV` follows the same three-part shape as `exportCSV`: resolve a header row and data rows from `columns`/`records`/`columnConfigs`/`display`, join them into one string, then call the existing private `TableExporter.download(content, filename, mimeType)`. No new mechanism is introduced.

### The TSV row/field-joining logic moves from `Body.ts` into `TableExporter.ts`, not the other way around

`Body.ts` already imports `TableExporter` (for `TableExporter.formatValue`, used by `buildCopyText`), so `TableExporter.ts` importing from `Body.ts` back would be a circular import. `TableExporter.ts` is also already the file that owns per-format field-escaping (`escapeCSVField`), so it is the natural single owner for the TSV equivalent too. `Body.buildRectangularTsv` (row-major grid → tab/newline string) and its private `escapeTsvField` move into `TableExporter.ts` as `TableExporter.buildRectangularTSV` (public static, `@internal`-tagged — the same visibility `formatValue` already has, since `Body.ts` must keep calling it) and a `private static escapeTSVField`. `Body.buildCopyText` calls `TableExporter.buildRectangularTSV(rows)` in place of the old bare call; `exportTSV` builds a `[header, ...rows]` grid and passes the whole thing through the same method, so the file-download path and the clipboard path escape a field identically.[^casing-rename]

### Row values are stringified before escaping, matching the existing TSV contract, not the CSV one

`escapeCSVField(value: any)` stringifies internally (`String(value ?? '')`) because `exportCSV` passes it a raw formatted value per field. `escapeTSVField(value: string)` — moved over unchanged from `escapeTsvField` — takes an already-stringified value, matching the contract `Body.buildCopyText` already relies on: it stringifies each value with `String(value ?? '')` itself before handing rows to the row-joining helper. `exportTSV` follows the same order: map each cell through `String(TableExporter.formatValue(...) ?? '')` first, then pass the whole `[header, ...rows]` grid to `buildRectangularTSV`. This is not a new inconsistency — it is the TSV side's existing, already-shipped contract, applied to a second caller.

### Row separator stays `\n`, not CSV's `\r\n`

`exportCSV` joins rows with `'\r\n'` per RFC 4180. `buildRectangularTSV` (moving over unchanged) joins with `'\n'`, matching the already-shipped clipboard-copy behaviour. `exportTSV` reuses `buildRectangularTSV` as-is rather than special-casing a CRLF variant for file export only — TSV has no equivalent formal RFC mandating CRLF, and diverging the file-export line ending from the clipboard one would need a second parameter or a second helper for no behavioural benefit.

### MIME type is `text/tab-separated-values;charset=utf-8;`

This is the MIME type browsers and spreadsheet tools already recognize for `.tsv`, and it mirrors the `;charset=utf-8;` suffix `exportCSV` already uses for `text/csv`.

### Menu entry: `'Export as TSV'` with glyph `file-lines`

The two existing entries (`file-csv`, `file-code`) each depict the *format*. Font Awesome (the glyph set this codebase vendors) has no `file-tsv` icon; `file-lines` — a plain-text-file icon already registered elsewhere in this codebase (`MiscPanel.ts`) — reads as "delimited text file" without colliding with CSV's spreadsheet-grid icon or JSON's code-brackets icon.

### Naming: `exportTSV`, not `exportTsv`

`Table.exportCSV`/`exportJSON` use all-caps acronym casing; `exportTSV` matches. (`MenuButton.ts`'s JSDoc `@example` block uses `exportCsv`/`exportJson`, but that is illustrative placeholder text inside a doc comment, not a real call site, and not a naming precedent.)

---

## Public API

```typescript
// TableExporter.ts
class TableExporter {
    static exportTSV(
        columns      : Column[],
        records      : ModelRecord[],
        columnConfigs: Map<string, ColumnConfig>,
        display      : CellTextResolver,
        options     ?: ExportOptions
    ): void;

    /** @internal — relocated from Body.ts's `buildRectangularTsv`, renamed for this file's CSV-acronym casing. */
    static buildRectangularTSV(rows: string[][]): string;
}
```

```typescript
// Table.ts
class Table {
    exportTSV(options?: ExportOptions): void;
}
```

```typescript
// TablePanel.ts
class TablePanel {
    exportTSV(options?: ExportOptions): void;
}

// TreeTablePanel.ts
class TreeTablePanel {
    exportTSV(options?: ExportOptions): void;
}
```

No new options type: `exportTSV` reuses the existing `ExportOptions` (`includeHidden?`, `filename?`) unchanged. `TreeTable extends Table` ([TreeTable.ts:87](packages/lib/src/typescript/lib/component/table/TreeTable.ts#L87)) and defines no export methods of its own, so it inherits `exportTSV` automatically — no change needed in `TreeTable.ts`.

---

## Internal Structure

`TableExporter.exportTSV` (new, placed after `exportJSON`):

```typescript
static exportTSV(
    columns      : Column[],
    records      : ModelRecord[],
    columnConfigs: Map<string, ColumnConfig>,
    display      : CellTextResolver,
    options     ?: ExportOptions
): void {
    const header = columns.map(c => c.getField().getName());

    const rows = records.map(record =>
        columns.map(c => String(TableExporter.formatValue(c, record.get(c.getField().getName()), columnConfigs, display) ?? ''))
    );

    const tsv = TableExporter.buildRectangularTSV([header, ...rows]);

    TableExporter.download(tsv, options?.filename ?? 'table-export.tsv', 'text/tab-separated-values;charset=utf-8;');
}
```

`TableExporter.buildRectangularTSV` / `escapeTSVField` (relocated verbatim from `Body.ts`, renamed, restyled to this file's single-quote convention):

```typescript
static buildRectangularTSV(rows: string[][]): string {
    return rows.map(row => row.map(TableExporter.escapeTSVField).join('\t')).join('\n');
}

private static escapeTSVField(value: string): string {
    if (value.includes('\t') || value.includes('"') || value.includes('\n')) {
        return '"' + value.replace(/"/g, '""') + '"';
    }

    return value;
}
```

`Body.buildCopyText`'s final line changes from:

```typescript
return buildRectangularTsv(rows);
```

to:

```typescript
return TableExporter.buildRectangularTSV(rows);
```

(`TableExporter` is already imported in `Body.ts` — see [Body.ts:25](packages/lib/src/typescript/lib/component/table/Body.ts#L25) — so no new import is needed there.)

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/table/TableExporter.ts`**
   - Add `static exportTSV(...)` after `exportJSON` (~line 91), body per `## Internal Structure` above.
   - Add `static buildRectangularTSV(rows: string[][]): string` and `private static escapeTSVField(value: string): string` after `exportTSV` (or after `formatValue`/`escapeCSVField`, wherever reads most naturally next to the CSV/JSON export methods) — bodies are `Body.ts`'s current `buildRectangularTsv`/`escapeTsvField` (~Body.ts lines 219–229) moved over unchanged except the rename, with JSDoc adapted from the moved-from comment (drop the "unlike the row-major span the deleted `buildTsv` formatted" historical aside — it refers to code this repo no longer has).
   - Update the class-level `@remarks` (~line 27) from `Used internally by {@link Table.exportCSV} and {@link Table.exportJSON}.` to also name `{@link Table.exportTSV}`.
   - Check: `grep -n "buildRectangularTSV\|escapeTSVField\|exportTSV" packages/lib/src/typescript/lib/component/table/TableExporter.ts` shows the three new symbols.

2. **`packages/lib/src/typescript/lib/component/table/Body.ts`**
   - Delete the `buildRectangularTsv` function and its JSDoc block, and the `escapeTsvField` function (~lines 204–229).
   - In `buildCopyText` (~line 1719), change `return buildRectangularTsv(rows);` to `return TableExporter.buildRectangularTSV(rows);`.
   - Check: `grep -n "buildRectangularTsv\|escapeTsvField" packages/lib/src/typescript/lib/component/table/Body.ts` — zero matches.

3. **`packages/lib/tests/component/table/Body.test.ts`**
   - Remove `buildRectangularTsv` from the `~/component/table/Body` import (line 17).
   - Delete the `describe('buildRectangularTsv', ...)` block (~lines 512–524; 3 `it`s).
   - Check: `grep -n "buildRectangularTsv" packages/lib/tests/component/table/Body.test.ts` — zero matches.

4. **`packages/lib/tests/component/table/TableExporter.test.ts`**
   - The `import { TableExporter } from '~/component/table/TableExporter';` line is already present; no new import is needed since `buildRectangularTSV` is a public static, called directly as `TableExporter.buildRectangularTSV(...)` (no `(TableExporter as any)` cast).
   - Add a `describe('TableExporter.buildRectangularTSV', ...)` block with the 3 cases moved from `Body.test.ts` step 3, calling `TableExporter.buildRectangularTSV(...)` directly:
     - `joins each row's cells with tabs and the rows with newlines` — `[['Alice', '25'], ['Bob', '30']]` → `'Alice\t25\nBob\t30'`.
     - `formats a single-cell grid with no separators` — `[['only']]` → `'only'`.
     - `quote-wraps a field containing a tab, a quote, or a newline` — `[['a\tb', 'c"d', 'e\nf']]` → `'"a\tb"\t"c""d"\t"e\nf"'`.
   - In the existing `describe('TableExporter.exportCSV / exportJSON (structural smoke)', ...)` block (~line 193), rename the title to `'TableExporter.exportCSV / exportJSON / exportTSV (structural smoke)'` and add a fourth `it`, alongside the existing `exportCSV`/`exportJSON` cases (~lines 212–224), reusing the same block-local `records()`/`columns`/`configs`: `exportTSV(columns, records(), configs, display)` does not throw, and triggers exactly one `createElement('a')` + one `click` on the recording sink. Do not create a separate `describe` block — `records()`/`columns`/`configs` are declared local to this one and a new block would have to redeclare them.
   - Check: `npx vitest run packages/lib/tests/component/table/TableExporter.test.ts` passes.

5. **`packages/lib/src/typescript/lib/component/table/Table.ts`**
   - Add `import { file_lines } from "~/glyphs/solid/file_lines.js";` after the `file_code` import (~line 25).
   - Add `file_lines` to the `Glyph.register(...)` call (~line 47): `Glyph.register(table_columns, undo, file_csv, file_code, file_lines, clipboard);`.
   - Add a third menu item to both menu-construction sites:
     - Rotated-mode menu (~lines 1649–1652, inside `showColumnMenu`'s `if (this._displayMode === "rotated")` branch): the `'Export as JSON'` entry already has a trailing comma, so just add the new entry after it:
       ```typescript
       this._columnContextMenu.show(x, y, [
           { text: 'Export as CSV',  glyph: 'file-csv',  action: () => this.exportCSV()  },
           { text: 'Export as JSON', glyph: 'file-code', action: () => this.exportJSON() },
           { text: 'Export as TSV',  glyph: 'file-lines', action: () => this.exportTSV() },
       ]);
       ```
     - Normal-mode menu (~lines 1692–1698, the `if (this._exportMenuEnabled)` block): the `'Export as JSON'` entry currently has no trailing comma (it's the array's last element) — give it one, then add `{ text: 'Export as TSV', glyph: 'file-lines', action: () => this.exportTSV() }` as the new last element, itself with no trailing comma:
       ```typescript
       items.push(
           { separator: true },
           { text: 'Export as CSV',  glyph: 'file-csv',  action: () => this.exportCSV()  },
           { text: 'Export as JSON', glyph: 'file-code', action: () => this.exportJSON() },
           { text: 'Export as TSV',  glyph: 'file-lines', action: () => this.exportTSV() }
       );
       ```
   - Update `setExportMenuEnabled`'s JSDoc (~line 1945) from `Enables or disables the "Export as CSV" / "Export as JSON" entries...` to `Enables or disables the "Export as CSV" / "Export as JSON" / "Export as TSV" entries...`.
   - Add `exportTSV(options?: ExportOptions): void` immediately after `exportJSON` (~line 1982), body mirroring `exportCSV`/`exportJSON` exactly:
     ```typescript
     exportTSV(options?: ExportOptions): void {
         const columns = this.getExportColumns(options?.includeHidden ?? false);
         const records = this._store.getRecords();

         TableExporter.exportTSV(columns, records, this._columnConfigs, this._cellText, options);
     }
     ```
     JSDoc mirrors `exportCSV`'s: "Triggers a TSV download of the current store view. Mode-independent: always exports the source table's records and columns, never the rotated field/value projection."
   - Check: `npx tsc --noEmit -p packages/lib` (or the project's usual typecheck command) passes.

6. **`packages/lib/src/typescript/lib/component/table/TablePanel.ts`**
   - Add `exportTSV(options?: ExportOptions): void { this._table.exportTSV(options); }` immediately after `exportJSON` (~line 165).
   - Update `setExportMenuEnabled`'s JSDoc (~line 141) the same way as step 5.

7. **`packages/lib/src/typescript/lib/component/table/TreeTablePanel.ts`**
   - Add `exportTSV(options?: ExportOptions): void { this._treeTable.exportTSV(options); }` immediately after `exportJSON` (~line 198).
   - Update `setExportMenuEnabled`'s JSDoc (~line 174) the same way as step 5.

8. **`packages/lib/tests/component/table/Table.test.ts`**
   - In the `'Column window — export and ARIA column count are scroll-independent'` describe block (~line 95), add a test mirroring `'exportCSV on a wide table scrolled to the far right...'` (~line 119) for `exportTSV`: spy on `TableExporter.exportTSV`, call `table.exportTSV()` on a far-right-scrolled wide table, assert it was called once with all 20 columns.
   - Check: `npx vitest run packages/lib/tests/component/table/Table.test.ts` passes.

9. **`packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts`**
   - Extend test `'5. Reset columns / Filter / export entries keep their order and separators...'` (~line 277): add `const tsvIndex = items.findIndex(i => i.text === 'Export as TSV');` and `expect(tsvIndex).toBe(jsonIndex + 1);`.
   - Extend test `'6. rotated mode is unchanged: export rows only when enabled...'` (~line 311): the `toEqual([...])` array gains a third element `{ text: 'Export as TSV', glyph: 'file-lines', action: expect.any(Function) }` after the JSON entry.
   - Check: `npx vitest run packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts` passes.

10. **Docs and changelog** — per `## Documentation Impact` below.

11. Run the full check: `npm run typecheck` (or repo equivalent) and `npx vitest run packages/lib/tests/component/table/` — all green. Run `npm run docs:api` — zero warnings (per `CODE_CONVENTIONS.md`'s `{@link}` rule, since the class-level `@remarks` edit in step 1 adds a new `{@link Table.exportTSV}`).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/table/TableExporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TablePanel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TreeTablePanel.ts` |
| Modify | `packages/lib/tests/component/table/TableExporter.test.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/tests/component/table/Table.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/components/TablePanel.md` |
| Modify | `packages/lib/docs/components/TreeTablePanel.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

| # | Case | Type |
| --- | --- | --- |
| 1 | `TableExporter.buildRectangularTSV([['Alice','25'],['Bob','30']])` → `'Alice\t25\nBob\t30'` | Unit (relocated) |
| 2 | `TableExporter.buildRectangularTSV([['only']])` → `'only'` | Unit (relocated) |
| 3 | `TableExporter.buildRectangularTSV([['a\tb','c"d','e\nf']])` → `'"a\tb"\t"c""d"\t"e\nf"'` (tab, quote, or newline triggers quote-wrap; interior quotes double) | Unit (relocated) |
| 4 | `TableExporter.exportTSV(columns, records, configs, display)` does not throw and creates+clicks exactly one `<a>` element | Unit (structural smoke, mirrors `exportCSV`/`exportJSON`) |
| 5 | `Table.exportTSV()` on a table scrolled far right still calls `TableExporter.exportTSV` with every resolved column, not just the horizontally-windowed ones | Unit (mirrors the existing `exportCSV` column-window test) |
| 6 | `Table.exportTSV({ includeHidden: true })` includes hidden columns; without it, only visible columns | Not unit-tested — `Table.exportTSV` calls the same private `getExportColumns` that `exportCSV`/`exportJSON` already call, and `includeHidden` has no dedicated test for either of those today either (verified: no `includeHidden` hits in `packages/lib/tests/`). Not introducing new coverage here matches existing precedent; flagged for manual verify only |
| 7 | Normal-mode column menu with `setExportMenuEnabled(true)`: item order is `..., 'Export as CSV', 'Export as JSON', 'Export as TSV'` — one separator precedes the group (before CSV), and TSV is the new last entry, immediately after JSON | Unit (`ColumnVisibilityMenu.test.ts` test 5) |
| 8 | Rotated-mode column menu with `setExportMenuEnabled(true)`: exactly 3 items — CSV, JSON, TSV, in that order, each with its glyph | Unit (`ColumnVisibilityMenu.test.ts` test 6) |
| 9 | Clicking the "Export as TSV" menu row calls `table.exportTSV()` | Covered by case 8's `action: expect.any(Function)` shape; the CSV/JSON entries have no deeper test than this either — matching precedent |
| 10 | `TablePanel.exportTSV(options)` / `TreeTablePanel.exportTSV(options)` forward to the wrapped `Table`/`TreeTable` | Manual verify — no test file exists for `TablePanel`/`TreeTablePanel` today, and `exportCSV`/`exportJSON` forwarding is untested for the same reason; do not introduce new test infrastructure for this alone |
| 11 | The downloaded file's content, filename, and MIME type (`table-export.tsv`, `text/tab-separated-values;charset=utf-8;`) | Manual verify — the recording DOM sink cannot observe `Blob` contents or the `download` filename beyond the `setAttr` call already asserted structurally, matching how `exportCSV`'s CSV body is not asserted either (see `TableExporter.test.ts`'s file header comment) |

---

## Verification

- `npx vitest run packages/lib/tests/component/table/` — `TableExporter.test.ts`, `Body.test.ts`, `Table.test.ts`, `ColumnVisibilityMenu.test.ts` all pass.
- Typecheck: run the project's typecheck script (see `package.json`) — zero errors.
- `npm run docs:api` — zero warnings.
- Manual: open the docs app's Table demo (or any page with `setExportMenuEnabled(true)`), right-click a column header, confirm "Export as TSV" appears after "Export as CSV"/"Export as JSON" with a plain-text-file glyph, and clicking it downloads a `.tsv` file that opens correctly in a spreadsheet app (tab-delimited columns, one row per record).
- Manual: repeat in rotated mode (`setDisplayMode('rotated')`) — the column menu should show only the three export entries.
- Manual: call `table.exportTSV({ includeHidden: true })` after hiding a column and confirm the hidden column's field appears in the download — `includeHidden` has no automated coverage for any of the three export formats today.

---

## Documentation Impact

- **`packages/lib/docs/components/Table.md`**:
  - Line 180 ("Export always covers the source table") — extend `exportCSV()` / `exportJSON()` to `exportCSV()` / `exportJSON()` / `exportTSV()`.
  - Line 359 (method table) — change `exportCSV(options?)` / `exportJSON(options?)` row to also list `exportTSV(options?)`.
  - Line 360 (method table) — extend `setExportMenuEnabled` row's description to mention `"Export as TSV"`.
  - `## Exporting` section (~lines 419–450): extend the opening sentence to `exportCSV()`, `exportJSON()`, and `exportTSV()`; extend the code sample with a `table.exportTSV();` line; add a sentence after the RFC 4180 paragraph (~line 438) describing TSV's own escaping rule (fields containing a tab, `"`, or `\n` are quote-wrapped, interior quotes doubled — same shape as the CSV rule, different trigger characters); change the closing sentence from "the same three methods (`setExportMenuEnabled`, `exportCSV`, `exportJSON`)" to "the same four methods (`setExportMenuEnabled`, `exportCSV`, `exportJSON`, `exportTSV`)".
- **`packages/lib/docs/components/TablePanel.md`** (~lines 58–71): add `panel.exportTSV();` to the code sample; update the `setExportMenuEnabled(true)` comment from "adds CSV/JSON entries" to "adds CSV/JSON/TSV entries".
- **`packages/lib/docs/components/TreeTablePanel.md`** (~lines 70–81): add `panel.exportTSV();` to the code sample.
- **`packages/lib/docs/reference/changelog/next.md`**: add a new `### Table` subsection under `## Added` (there is currently only `### Core` and `### Components` there), with an entry in the file's existing bold-lead-sentence style, e.g.:

  ```markdown
  ### Table

  - **`Table.exportTSV(options?)`** downloads the current store view as a
    tab-separated file, alongside the existing `exportCSV`/`exportJSON`. Same
    `includeHidden`/`filename` options and the same combo/date/time/datetime
    formatting. A new "Export as TSV" entry joins "Export as CSV"/"Export as
    JSON" in the column context menu wherever `setExportMenuEnabled(true)` is
    set, including the rotated-mode menu. `TablePanel`/`TreeTablePanel`
    forward `exportTSV` the same way they already forward `exportCSV`/
    `exportJSON`. No consumer action is needed.
  ```
- No new doc page: `exportTSV` is documented inside the existing `Table.md` "Exporting" section, matching how `exportCSV`/`exportJSON` are documented there rather than on separate pages.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/TableExporter.ts`](packages/lib/src/typescript/lib/component/table/TableExporter.ts) — the file being extended; `exportCSV` is the structural precedent `exportTSV` mirrors, and `escapeCSVField` is the casing precedent `escapeTSVField` follows.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `buildRectangularTsv`/`escapeTsvField` (~lines 219–229) are being relocated out of here; `buildCopyText` (~line 1695) is the one call site that needs updating.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) — `exportCSV`/`exportJSON` (~lines 1963–1982), the glyph-registration block (~lines 22–47), and both `showColumnMenu` menu-construction sites (~lines 1643–1701).
- [`packages/lib/src/typescript/lib/component/table/TablePanel.ts`](packages/lib/src/typescript/lib/component/table/TablePanel.ts) and [`TreeTablePanel.ts`](packages/lib/src/typescript/lib/component/table/TreeTablePanel.ts) — the forwarding pattern to extend.
- [`packages/lib/tests/component/table/TableExporter.test.ts`](packages/lib/tests/component/table/TableExporter.test.ts) — test-structure precedent for `exportTSV`'s smoke test and `buildRectangularTSV`'s unit tests.
- [`packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts`](packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts) — tests 5 (~line 277) and 6 (~line 311) are the only existing coverage of the menu's export entries and must be extended, not just left alone.
- [`plans/implemented/table-cell-range-selection.md`](plans/implemented/table-cell-range-selection.md) — the plan that introduced `buildRectangularTsv`/`escapeTsvField`; its Architecture Decisions explain why they're shaped as a pure grid-in/string-out function.

---

## Non-Goals

- **Selection-scoped export.** `exportTSV` always serializes the full current store view (the same records `exportCSV`/`exportJSON` use), never just an active cell-range selection.
- **Streaming or chunked download for large tables.** `exportTSV` builds the whole string in memory and downloads it in one `Blob`, exactly like `exportCSV`/`exportJSON` today.
- **A CRLF variant of the TSV row separator.** Reuses `buildRectangularTSV`'s existing `\n` unchanged (see Architecture Decisions).
- **Renaming or restructuring `exportCSV`/`exportJSON`.** Both stay exactly as they are; `escapeCSVField` is untouched too — only new code is added beside them.

---

## Notes

[^only-downloader]: Confirmed by `grep -rln "new Blob(\|URL.createObjectURL" packages/lib/src/typescript` — `TableExporter.ts` is the only match in the library source. There is no second "add a sibling export format" precedent anywhere else in the codebase to follow instead.

[^casing-rename]: The moved-from names (`buildRectangularTsv`, `escapeTsvField`) use mixed-case `Tsv`, matching no particular convention in `Body.ts`. `TableExporter.ts` already establishes all-caps acronym casing for this exact kind of symbol (`escapeCSVField`, `exportCSV`, `exportJSON`), so the relocated symbols are renamed to `buildRectangularTSV`/`escapeTSVField` to match their new home rather than carrying the old file's casing over. This is a small, mechanical rename — it touches the two call sites (`Body.ts`'s `buildCopyText`, and the test files per Ordered Implementation Steps 3–4) and nothing else.
