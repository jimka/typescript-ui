---
touches-shared:
    - packages/lib/src/typescript/lib/component/display/Markdown.ts
    - packages/lib/tests/component/display/Markdown.test.ts
    - packages/lib/tests/component/markdown-editor.test.ts
    - packages/lib/docs/components/Markdown.md
---

# GFM Tables in the Markdown Dialect — Implementation Plan

## Overview

The library ships two halves of one Markdown dialect: the read-only viewer [`Markdown`](packages/lib/src/typescript/lib/component/display/Markdown.ts) and the WYSIWYG editor [`MarkdownEditor`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts), whose value is a Markdown string. Neither supports GFM pipe tables. This plan adds them to both.

**The two halves must support the same set of Markdown constructs.** That rule is already written into the codebase in three places.[^parity-sources] Breaking it is a data-loss bug: a construct the viewer renders but the editor cannot represent is silently destroyed when a document is loaded into the editor, edited, and read back out. So the viewer half and the editor half land together, in one merge.

This is one plan, not phased.[^one-plan] Three things make it bigger than a token-switch addition:

1. `@lexical/table` is not installed. Adding it is a new **runtime** dependency of the published package.
2. `@lexical/markdown` 0.46.0 ships no table transformer, so one must be hand-written.
3. Existing formatting commands are shaped as `setBlockType(type)` — a flat list of paragraph-like block types at [`MarkdownEditor.ts:60`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L60). A grid does not fit that shape, so the editor needs five new commands.

Column alignment (`|:---:|`) **is** part of the dialect. See *Column alignment is in the dialect* below.

---

## Architecture Decisions

### The viewer builds tables the way it builds lists

`appendTable` joins the token switch at [`Markdown.ts:466`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L466) alongside the existing `case "heading"` / `case "list"` arms, and builds `<table>` › `<thead>`/`<tbody>` › `<tr>` › `<th>`/`<td>` through the DOM sink — exactly the shape [`appendList`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L517) uses for `<ul>` › `<li>`. Styling is shared class rules added to [`ensureMarkdownClassRules`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L46), never inline styles.[^viewer-precedent]

A wide table scrolls inside its own frame, in a wrapper `<div>` that the table sits in. This mirrors how fenced code already handles overlong lines.[^table-wrap]

### Column alignment is in the dialect

The viewer applies the GFM alignment marker as a CSS class on the header cell and on every body cell of that column. The editor stores it on each `TableCellNode` through `setFormat` and regenerates the marker on export.[^alignment-feasible]

The mapping runs in both directions:

| Delimiter cell | Viewer puts this class on the column's cells | Editor cell format | Editor writes back |
|---|---|---|---|
| `:---` | `ts-ui-md-align-left` | `"left"` | `:---` |
| `:---:` | `ts-ui-md-align-center` | `"center"` | `:---:` |
| `---:` | `ts-ui-md-align-right` | `"right"` | `---:` |
| `---` | *(no alignment class)* | `""` | `---` |

Worked example — authored source, what renders, what the editor writes back after a load and an unrelated edit:

```markdown
| Name | Qty | Price |
|:-----|:---:|------:|
| Nut  | 10  | 0.05  |
```

Renders as a three-column table whose first column is left-aligned, second centred, third right-aligned — on the header row and the body row alike. The editor writes back:

```markdown
| Name | Qty | Price |
| :--- | :---: | ---: |
| Nut | 10 | 0.05 |
```

The alignment survives. Cell padding does not: the editor normalises each cell to one space either side. Writing a document out and reading it back is therefore **canonical**, not byte-identical — a second pass through the editor changes nothing further. That same normalisation already applies to every other construct in the dialect, and reaching a form that no longer changes is what the existing round-trip tests call a fixpoint.[^canonical-form]

Alignment is **preserved**, not **authorable** in the WYSIWYG surface — there is no command to change a column's alignment. A user who wants to change it switches to source mode and edits the delimiter row. Adding an alignment command is listed under `## Non-Goals`.

### A hand-written multiline transformer, not the row-at-a-time shape

The table transformer is a `MultilineElementTransformer` that consumes the whole table block in one pass through `handleImportAfterStartMatch`. The in-dialect precedent is `CODE`, the fenced-code transformer already in the curated array, which uses the same hook.[^multiline-choice]

Consuming the block in one pass lets the transformer **require a delimiter row**. Without one it declines the match and the lines fall through to ordinary paragraphs — which is exactly what the viewer does:

| Source | Viewer renders | Editor round-trips as |
|---|---|---|
| `\| a \| b \|`<br>`\| --- \| --- \|`<br>`\| 1 \| 2 \|` | one table | the same table |
| `\| a \| b \|`<br>`\| 1 \| 2 \|` | two paragraphs | two paragraphs, unchanged |

### Escaped pipes are handled explicitly

A cell may contain `\|` for a literal pipe. On import the transformer splits a row on unescaped pipes only and turns `\|` back into `|`; on export it escapes every `|` inside a cell back to `\|`. This is not an edge case in this repo.[^escaped-pipes]

### The editor accepts every table shape the viewer does, and writes one back

GFM lets a row omit its leading and trailing pipes, and lets cell padding be anything. The importer accepts all of that; the exporter always writes the fully-piped, single-space form. Both halves therefore render the same tables, and a round trip normalises the source rather than losing it:[^shape-normalisation]

| Authored | Viewer renders | Editor writes back |
|---|---|---|
| `a \| b`<br>`--- \| ---`<br>`1 \| 2` | a 2×1 table | `\| a \| b \|`<br>`\| --- \| --- \|`<br>`\| 1 \| 2 \|` |
| `\| a   \| b   \|`<br>`\|:------\|-----:\|`<br>`\| 1   \| 2   \|` | left / right aligned | `\| a \| b \|`<br>`\| :--- \| ---: \|`<br>`\| 1 \| 2 \|` |

### The transformer lives in its own module and receives the transformer list lazily

`createTableTransformer(getTransformers)` is defined in a new file, `markdownTableTransformer.ts`, and is called from `markdownTransformers.ts`. It takes a **function** returning the transformer array rather than the array itself.[^lazy-transformers]

### Table state registration is split from table view registration

`registerTablePlugin` and `registerTableCellUnmergeTransform` join the existing `mergeRegister` call in [`ensureEditor`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L686). `registerTableSelectionObserver` does **not** — it is registered from `mountWysiwyg`, only once the live view has actually attached, and torn down in `dispose`.[^observer-split]

This split matches the one the component already draws between editor state (headless, always available) and the mounted view.

### Merged cells are transformed away

`registerTableCellUnmergeTransform` forces every cell to a column span and row span of one. GFM cannot express a merged cell, so a merge arriving by paste would be unrepresentable on export.[^unmerge]

### Table insertion is a command, not a typed shortcut

A user inserts a table by calling `insertTable(rows, columns)`, wired to a consumer's own button — the same consumer-wired shape the existing command API uses. Typing a pipe row does not create a table.[^no-typing-shortcut]

---

## Public API

### `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`

```typescript
class MarkdownEditor extends Component<MarkdownEditorOptions> {
    /**
     * Inserts a table of `rows` rows by `columns` columns at the caret. The
     * first row is the header row, so `insertTable(2, 3)` gives a header row
     * plus one body row. The caret lands in the first header cell.
     */
    insertTable(rows: number, columns: number): this;

    /** Inserts a row after (default) or before the row holding the caret. */
    insertTableRow(after?: boolean): this;

    /** Deletes the row holding the caret. */
    deleteTableRow(): this;

    /** Inserts a column after (default) or before the column holding the caret. */
    insertTableColumn(after?: boolean): this;

    /** Deletes the column holding the caret. */
    deleteTableColumn(): this;
}
```

All five no-op without throwing when the caret is not inside a table cell — the same contract the existing `toggleBold` / `setBlockType` commands carry.

No new state-bearing property, so no options-bag field, no setter/getter pair, and no row in [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts).

### `packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts` (new, internal)

```typescript
/**
 * Builds the GFM pipe-table transformer.
 *
 * @param getTransformers - Returns the curated transformer array. Called at
 *   import/export time, not at construction time, so the array may reference
 *   the transformer this call returns.
 */
export function createTableTransformer(
    getTransformers: () => Transformer[],
): MultilineElementTransformer;
```

Not re-exported from [`component/editor/index.ts`](packages/lib/src/typescript/lib/component/editor/index.ts) — `TRANSFORMERS` is internal today and stays internal.

---

## Internal Structure

### Viewer — new class names (`Markdown.ts`)

Added beside the existing `CODE_CLASS` … `HEADING_CLASS` constants at [`Markdown.ts:18`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L18):

```typescript
const TABLE_WRAP_CLASS   = "ts-ui-md-table-wrap";
const TABLE_CLASS        = "ts-ui-md-table";
const TH_CLASS           = "ts-ui-md-th";
const TD_CLASS           = "ts-ui-md-td";
const ALIGN_LEFT_CLASS   = "ts-ui-md-align-left";
const ALIGN_CENTER_CLASS = "ts-ui-md-align-center";
const ALIGN_RIGHT_CLASS  = "ts-ui-md-align-right";
```

The rules added to `ensureMarkdownClassRules`:

| Class | Styles |
|---|---|
| `ts-ui-md-table-wrap` | `maxWidth: "100%"`, `overflowX: "auto"` |
| `ts-ui-md-table` | `borderCollapse: "collapse"` |
| `ts-ui-md-th` | `border: "1px solid var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))"`, `padding: "0.3em 0.6em"`, `fontWeight: "600"`, `textAlign: "left"` |
| `ts-ui-md-td` | same border and padding as `ts-ui-md-th`, no `fontWeight`, no `textAlign` |
| `ts-ui-md-align-left` / `-center` / `-right` | `textAlign: "left"` / `"center"` / `"right"` |

The `ts-ui-md-th` rule sets `textAlign: "left"` so an unaligned header cell does not inherit the browser's centred `<th>` default; an alignment class added after it wins by being later in the stylesheet.

### Viewer — the builder (`Markdown.ts`)

```typescript
/** Maps marked's per-column alignment to the class that applies it, or null for no alignment. */
function alignmentClass(align: "center" | "left" | "right" | null): string | null;

private appendTable(parent: Handle, token: Tokens.Table): void;
private appendTableRow(section: Handle, cells: Tokens.TableCell[], header: boolean): void;
```

`appendTable` creates the wrapper `<div>`, the `<table>`, a `<thead>` holding one row built from `token.header`, and a `<tbody>` holding one row per entry in `token.rows`. `appendTableRow` creates the `<tr>`, then per cell creates `<th>` (header) or `<td>` (body), adds the base class plus the alignment class when `alignmentClass(cell.align)` returns one, and fills it with `appendInlineTokens(cell, cell.tokens)`.

marked puts the column's alignment on every cell, header and body alike (`Tokens.TableCell.align`), so no separate column-index lookup is needed — `token.align` is not read.

### Editor — the transformer (`markdownTableTransformer.ts`)

Module-private helpers, all pure and unit-testable:

```typescript
/**
 * A candidate table row: any line containing a pipe. Deliberately loose — a
 * line only becomes a table once the next line is a matching delimiter row,
 * which handleImportAfterStartMatch checks. Leading and trailing pipes are
 * optional in GFM, so they cannot be part of this test.
 */
const TABLE_ROW_REG_EXP = /\|/;

/**
 * Splits one row into its cell texts. Drops one optional leading and one
 * optional trailing pipe, splits on unescaped `|` only, turns each `\|` back
 * into a literal `|`, and trims each cell. A manual scan rather than a regexp
 * with a lookbehind.
 *
 * "| a | b \| c |"  ->  ["a", "b | c"]
 * "a | b"           ->  ["a", "b"]
 */
function splitTableRow(line: string): string[];

/**
 * Reads a GFM delimiter row's per-column alignment, or null when the line is
 * not a delimiter row.
 *
 * "| :--- | :---: | ---: | --- |"  ->  ["left", "center", "right", ""]
 * "| a | b |"                      ->  null
 */
function parseDelimiterRow(line: string): ElementFormatType[] | null;

/**
 * Renders a delimiter row from the header cells' formats.
 *
 * ["left", "center", "right", ""]  ->  "| :--- | :---: | ---: | --- |"
 */
function formatDelimiterRow(alignments: ElementFormatType[]): string;

/**
 * Prepares a cell's Markdown for embedding in a pipe row: trims it, escapes
 * every `|` to `\|`, and replaces every newline with a literal `\n`.
 */
function escapeCellText(markdown: string): string;
```

`parseDelimiterRow` runs `splitTableRow`, then requires every segment to match `/^:?-+:?$/` after trimming; any segment that does not makes the whole function return `null`. A segment starting **and** ending with `:` is `"center"`; starting only is `"left"`; ending only is `"right"`; neither is `""`.

`formatDelimiterRow` maps `"left"` → `:---`, `"center"` → `:---:`, `"right"` → `---:`, and anything else (including `""`, `"start"`, `"end"`, `"justify"`) → `---`, then joins with `" | "` inside a leading and trailing `|`.

The transformer itself:

```typescript
export function createTableTransformer(getTransformers: () => Transformer[]): MultilineElementTransformer {
    return {
        dependencies: [TableNode, TableRowNode, TableCellNode],
        regExpStart:  TABLE_ROW_REG_EXP,
        type:         "multiline-element",

        handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => { /* below */ },

        // Never reached: handleImportAfterStartMatch either imports the block or
        // declines it, so the default multiline import path never runs.
        replace: () => false,

        export: (node) => { /* below */ },
    };
}
```

`handleImportAfterStartMatch`:

1. Read `lines[startLineIndex + 1]`. When it is missing, return `null` (decline).
2. `parseDelimiterRow` it. When that returns `null`, return `null` (decline).
3. `splitTableRow(lines[startLineIndex])` gives the header cells; its length is the column count. When the delimiter row's length differs from it, return `null` (decline) — GFM requires the two to match, and marked refuses the table outright when they do not.
4. Walk forward from `startLineIndex + 2`, splitting each line, until a blank line or the end of input. A line's content is irrelevant here: marked ends a table only at a blank line, so a following prose line with no pipe in it is absorbed as a one-cell row rather than ending the table.[^blank-line-terminator]
5. Build the `TableNode` (below) and `rootNode.append(table)`.
6. Return `[true, lastConsumedLineIndex]`.

Building the node — every row gets exactly the header's column count, padding with empty cells and dropping extras:

```typescript
const table = $createTableNode();

rows.forEach((cells, rowIndex) => {
    const row = $createTableRowNode();

    for (let column = 0; column < columnCount; column += 1) {
        const cell = $createTableCellNode(
            rowIndex === 0 ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS);

        $convertFromMarkdownString(
            (cells[column] ?? "").replace(/\\n/g, "\n"), getTransformers(), cell);

        // AFTER the conversion: it clears the cell's children, and setting the
        // format first risks the clear taking the format with it.
        cell.setFormat(alignments[column] ?? "");
        row.append(cell);
    }

    table.append(row);
});
```

`TableCellHeaderStates.ROW` is Lexical's name for "this cell is in the table's first row" — the GFM header row.

`export`:

1. Return `null` when the node is not a `TableNode`, or when it has no rows.
2. Read the alignment of every cell in row 0 with `getFormatType()`.
3. For each row, render every cell as `escapeCellText($convertToMarkdownString(getTransformers(), cell))`, then join with `" | "` inside a leading and trailing `|`.
4. **Always** emit `formatDelimiterRow(alignments)` straight after row 0, whatever that row's header state.[^always-delimiter]
5. Join the lines with `"\n"`.

### Editor — the command guard (`MarkdownEditor.ts`)

Lexical's row/column helpers throw when the selection is not inside a cell, so every one of the four row/column commands runs behind the same guard:

```typescript
/**
 * Whether the caret currently sits inside a table cell — the precondition for
 * the row/column helpers, which throw rather than no-op when it does not.
 */
function $selectionIsInTableCell(): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    return $getTableCellNodeFromLexicalNode(selection.anchor.getNode()) !== null;
}
```

---

## Ordered Implementation Steps

### Dependency

1. **`packages/lib/package.json`** — add `"@lexical/table": "^0.46.0"` to `dependencies`, in alphabetical order between `@lexical/selection` (line 190) and `@lexical/utils` (line 191). Run `npm install` from the repo root so the workspace lockfile updates.
   - Check: `ls node_modules/@lexical/table` succeeds.
   - Do **not** touch [`packages/lib/vite.lib.config.ts`](packages/lib/vite.lib.config.ts) — its `external` pattern at line 88 already covers `@lexical/`.

### Viewer

2. **`packages/lib/src/typescript/lib/component/display/Markdown.ts`** — add the seven class-name constants from `## Internal Structure` beside the existing ones at line 18, and the matching `StyleRule`s inside `ensureMarkdownClassRules` (line 46). Follow the existing rules' comment style: each spacing value gets a one-line "why".
3. Same file — add the module-level `alignmentClass` function and the private `appendTable` / `appendTableRow` methods described in `## Internal Structure`, placing them after `appendListItem` (line 537) so the block builders stay grouped.
4. Same file — add `case "table": this.appendTable(parent, token as Tokens.Table); break;` to the token switch at line 466, above the `case "space"` arm.
5. Same file — correct the class docblock at lines 143–145, which currently names tables among the token types that fall through to plain text. Tables now render; images, raw HTML, and the remaining GFM extensions still fall through.
   - Check: `grep -n 'case "table"' packages/lib/src/typescript/lib/component/display/Markdown.ts` — expect exactly one match.

### Viewer tests

6. **`packages/lib/tests/component/display/Markdown.test.ts`** — delete the `renders a table as text without creating <table>` case (lines 174–180) and keep the image case. Add the *Viewer* cases from `## Expected Behaviour`, reusing the existing `createdTags` / `textWrites` / `childTagsOf` helpers. Alignment classes need a new helper alongside them:

   ```typescript
   /** Every `{ addClass }` payload written through `apply`, in order. */
   function classWrites(): string[][] {
       return sink.writes
           .filter((w) => w.op === 'apply' && (w.args[1] as { addClass?: string[] }).addClass !== undefined)
           .map((w) => (w.args[1] as { addClass: string[] }).addClass);
   }
   ```

   - Check: `npm -w packages/lib run test -- display/Markdown` — green.

### Editor: nodes, theme, transformer

7. **`packages/lib/src/typescript/lib/component/editor/editorNodes.ts`** — import `TableNode`, `TableRowNode`, `TableCellNode` from `@lexical/table` and append all three to `EDITOR_NODES` (line 22). Extend the docblock's list of constructs to name tables.
8. **`packages/lib/src/typescript/lib/component/editor/editorTheme.ts`** — add four class-name constants beside the existing ones at line 11: `ts-ui-mde-table`, `ts-ui-mde-table-row`, `ts-ui-mde-table-cell`, `ts-ui-mde-table-cell-header`. Add their `StyleRule`s to `ensureMarkdownEditorClassRules` (line 38), matching the viewer's border, padding, and header weight so both surfaces look the same. Add `table`, `tableRow`, `tableCell`, and `tableCellHeader` keys to `EDITOR_THEME` (line 126).
9. **`packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts`** (new) — the module described in `## Internal Structure`: `TABLE_ROW_REG_EXP`, `splitTableRow`, `parseDelimiterRow`, `formatDelimiterRow`, `escapeCellText`, and the exported `createTableTransformer`. Start the file with the `// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0` header every sibling carries.
10. **`packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts`** — import `createTableTransformer`, build `const TABLE = createTableTransformer(() => TRANSFORMERS);` above the array, and put `TABLE` **first** in `TRANSFORMERS` (line 46).
11. Same file — fix the docblock. Two corrections: line 23's claim that Lexical's preset carries table transformers is false for the installed version and must be dropped;[^docblock-wrong] and the transformer→viewer-token mapping list at lines 33–41 gains a `TABLE` → `| a | b |` (table) row. Update "these nine" to "these ten".
    - Check: `grep -c 'table transformers' packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts` — expect zero.

### Editor: registration and commands

12. **`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`** — add `registerTablePlugin(editor)` and `registerTableCellUnmergeTransform(editor)` to the `mergeRegister` call in `ensureEditor` (line 695), after `registerList(editor)`.
13. Same file — add a private field `private _unregisterTableView: (() => void) | null = null;` beside `_unregister` (line 302). In `mountWysiwyg` (line 714), after `this._wysiwyg.mount(...)`, register the selection observer **only when the view really attached and it is not already registered**:

    ```typescript
    private mountWysiwyg(): void {
        const editor = this.ensureEditor();

        this._wysiwyg.mount(editor);

        // Offline the seam's mountView returns null and the root stays unset;
        // the observer's mutation listener needs a real table element in the
        // document and throws without one, so it is view-time only.
        if (editor.getRootElement() && !this._unregisterTableView) {
            this._unregisterTableView = registerTableSelectionObserver(editor, true);
        }
    }
    ```

14. Same file — call `this._unregisterTableView?.()` at the top of `dispose` (line 673), before the existing `this._unregister?.()`.
15. Same file — add the five public commands from `## Public API` after `setBlockType` (line 594), plus the module-level `$selectionIsInTableCell` helper from `## Internal Structure` beside `createBlockNode` (line 95). `insertTable` places a selection at the end of the document when there is none, then dispatches:

    ```typescript
    insertTable(rows: number, columns: number): this {
        const editor = this.ensureEditor();

        // INSERT_TABLE_COMMAND inserts at the selection; a freshly built editor
        // may have none, so seed one first.
        editor.update(() => {
            if (!$isRangeSelection($getSelection())) {
                $getRoot().selectEnd();
            }
        }, { discrete: true });

        editor.dispatchCommand(INSERT_TABLE_COMMAND, {
            columns:        String(columns),
            rows:           String(rows),
            includeHeaders: { rows: true, columns: false },
        });

        return this;
    }
    ```

    The other four follow `toggleLink`'s shape (line 573) — an `editor.update(..., { discrete: true })` whose body checks `$selectionIsInTableCell()` and then calls `$insertTableRowAtSelection(after)`, `$deleteTableRowAtSelection()`, `$insertTableColumnAtSelection(after)`, or `$deleteTableColumnAtSelection()`.
16. Same file — extend the class docblock's dialect sentence (lines 249–252) to name tables, and its formatting paragraph (lines 254–259) to mention the table commands.

### Editor tests

17. **`packages/lib/tests/component/markdown-editor.test.ts`** — add the three table documents to `CORPUS` (line 36) in the editor's canonical form, add `'table'` to `VIEWER_TOKENS` (line 52), and change `toHaveLength(9)` (line 76) to `10`. The existing round-trip, mode, and dialect-fidelity suites then cover the new documents automatically.
18. Same file — add the remaining *Editor* cases from `## Expected Behaviour` as new `describe` blocks: the alignment round-trip, the missing-delimiter case, the escaped-pipe case, the five commands, and the `EDITOR_NODES` membership check.
    - Check: `npm -w packages/lib run test` — green.

### Docs and demos

19. **`packages/lib/docs/components/Markdown.md`** — add a `| pipe table | <table> with <thead>/<tbody> |` row to the supported-syntax table (lines 30–38) and a sentence naming column alignment. Rewrite line 44 so tables are no longer in the fallback list. Add one sentence to the sizing paragraph (line 48) saying a wide table scrolls inside its own frame, like fenced code.
20. **`packages/lib/docs/components/MarkdownEditor.md`** — add tables to the dialect list on line 5; add a `| Table | pipe rows plus a `\| --- \|` delimiter row |` row to the constructs table (lines 43–54); remove "Tables" from the exclusion list on line 56; add the five commands to the command-API table (lines 68–74) and a short paragraph saying alignment is preserved on round-trip but changed in source mode.
    - Check: `grep -c 'Tables, images, strikethrough' packages/lib/docs/components/MarkdownEditor.md` — expect zero; the exclusion sentence must be rewritten, not left with "Tables" in it.
21. **`packages/lib/src/typescript/MarkdownPanel.ts`** — add a small aligned table to `SAMPLE` (line 7) and correct line 31, which currently tells the reader tables fall back to plain text.
22. **`packages/lib/src/typescript/MarkdownEditorPanel.ts`** — add a table to `SAMPLE` (line 11) and add an `Insert table` [`Button`](packages/lib/src/typescript/lib/component/button) to the existing `ToolBar` (line 60) wired to `this._editor.insertTable(2, 3)` through a named method, per the ARCHITECTURE listener rule.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/package.json` |
| Modify | `package-lock.json` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/src/typescript/MarkdownPanel.ts` |
| Modify | `packages/lib/src/typescript/MarkdownEditorPanel.ts` |

---

## Expected Behaviour

### Viewer — unit-testable in `Markdown.test.ts`

Source used below unless stated otherwise:

```markdown
| a | b |
| --- | --- |
| 1 | 2 |
```

- The render creates a `div` wrapper, a `table`, a `thead`, a `tbody`, two `tr`, two `th`, and two `td`.
- `childTagsOf('thead')` is `['TR']`; `childTagsOf('tbody')` is `['TR']`.
- `childTagsOf('tr')` is `['TH', 'TH', 'TD', 'TD']` — the header row's two `th`, then the body row's two `td`. The helper flattens across both rows, so it is one list, not two.
- The texts `a`, `b`, `1`, `2` are all written.
- `| **b** |` in the header nests a `strong` inside the `th`.
- With `| :--- | :---: | ---: |` as the delimiter row, the first column's `th` and `td` both carry `ts-ui-md-align-left`, the second `ts-ui-md-align-center`, the third `ts-ui-md-align-right`.
- With `| --- | --- |` as the delimiter row, no cell carries any `ts-ui-md-align-*` class.
- A cell authored as `` `x \| y` `` renders the literal text `x | y` — the escape is resolved before the viewer sees it.
- `a | b\n--- | ---\n1 | 2` (no leading or trailing pipes) creates the same `table` / `thead` / `tbody` structure as the fully-piped source.
- Two pipe rows with **no** delimiter row create no `table` element.
- `| a | b |\n| --- |\n| 1 | 2 |` (delimiter row narrower than the header) creates no `table` element.
- An image (`![alt](x.png)`) still creates no `img` — the existing fallback case stays green unchanged.

### Editor — unit-testable in `markdown-editor.test.ts`

- `TRANSFORMERS` has 10 entries, and still excludes `STRIKETHROUGH`, `HIGHLIGHT`, and `CHECK_LIST`.
- `EDITOR_NODES` contains `TableNode`, `TableRowNode`, and `TableCellNode`.
- These three corpus documents round-trip to a fixpoint and are canonically equal to their source, through the existing round-trip suite:
  - `| a | b |\n| --- | --- |\n| 1 | 2 |`
  - `| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |`
  - ``| a | b |\n| --- | --- |\n| x | `p \| q` |``
- Each of those three also survives a `setMode('source')` → `setMode('wysiwyg')` round-trip unchanged, and lexes to viewer-supported tokens only — both through the existing suites once `'table'` joins `VIEWER_TOKENS`.
- Loading `| a | b |\n| :---: | --- |\n| 1 | 2 |` and reading the value back yields a delimiter row containing `:---:` in the first column and `---` in the second.
- Loading `| a | b |\n| 1 | 2 |` (no delimiter row) and reading it back yields no delimiter row and no extra pipes — the two lines stay two paragraphs.
- Loading `| a | b |\n| --- |\n| 1 | 2 |` (delimiter row narrower than the header) likewise stays paragraphs, matching what the viewer does with the same source.
- Loading `a | b\n--- | ---\n1 | 2` (no leading or trailing pipes) and reading it back yields `| a | b |\n| --- | --- |\n| 1 | 2 |` — the table is preserved and its shape normalised.
- Loading `| a | b |\n| --- | --- |\n| 1 | 2 |\ntrailing prose` yields a table with two body rows, the second being `| trailing prose |  |`. The importer follows marked in ending a table only at a blank line.
- `insertTable(2, 3)` on an empty editor yields Markdown with three columns, a delimiter row, and one body row — two rows in all, the first being the header.
- After `insertTable(2, 3)`, `insertTableRow()` yields one more body row, and `insertTableColumn()` yields one more column in the header row, the delimiter row, and every body row.
- After `insertTable(3, 3)`, `deleteTableRow()` yields a table with one fewer row, and `deleteTableColumn()` yields one fewer column everywhere. The caret sits in the **header** row straight after `insertTable`, so the row `deleteTableRow()` removes is the header row; the next row becomes the header and the exported table still carries a delimiter row.
- All five commands chained on a fresh editor with no selection and no table do not throw.

### Manual verification (browser required)

The mounted `contenteditable` never attaches under the test harness, so everything below is verified by running the demo app (`npm -w packages/lib run dev`) and opening the **MD Editor** and **Markdown** panels.

- The MD Editor panel shows the sample table as a real grid on the left, and the viewer on the right shows the same grid.
- Clicking into a cell places a caret; typing edits that cell and the viewer follows.
- <kbd>Tab</kbd> moves the caret to the next cell and <kbd>Shift+Tab</kbd> to the previous.
- The **Insert table** toolbar button inserts a 3-column, 2-row table at the caret with a bold header row.
- Dragging across cells selects a cell range rather than plain text.
- Switching to source mode, changing a delimiter cell to `:---:`, and switching back centres that column in the WYSIWYG surface; switching to source again still shows `:---:`.
- In the Markdown panel, a table wider than the panel scrolls horizontally inside its own frame, and the panel itself does not scroll sideways.
- Toggling the theme recolours the table borders in both panels with no rebuild.

---

## Verification

```bash
npm -w packages/lib run typecheck
npm -w packages/lib run lint
npm -w packages/lib run test
npm run build:lib
npm run docs:build            # must finish with zero warnings

# Both halves of the dialect changed together — neither may be empty.
grep -n 'case "table"' packages/lib/src/typescript/lib/component/display/Markdown.ts
grep -rn 'TableNode' packages/lib/src/typescript/lib/component/editor/editorNodes.ts

# The two documentation corrections this plan owns — both expect zero.
grep -c 'table transformers' packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts
grep -c 'Tables, images, strikethrough' packages/lib/docs/components/MarkdownEditor.md
```

Then `npm -w packages/lib run dev` and walk the manual list above.

---

## Documentation Impact

`Markdown` is exported from `@jimka/typescript-ui/component/display` and `MarkdownEditor` from `@jimka/typescript-ui/component/editor`; the five new methods ride the existing `MarkdownEditor` export, so no barrel and no sidebar entry changes. The two doc pages are [`docs/components/Markdown.md`](packages/lib/docs/components/Markdown.md) and [`docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md), both already in the components sidebar.

Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) (*Don't `{@link}` internal symbols from public JSDoc*), the new methods' JSDoc must not link `createTableTransformer`, `$selectionIsInTableCell`, or any `@lexical/table` symbol — describe the behaviour in prose instead. `npm run docs:build` must finish with zero warnings.

[`packages/lib/llms.txt`](packages/lib/llms.txt) needs no regeneration: it derives its entries from each class's summary sentence, and neither class's first sentence changes.

---

## Potential Challenges

- **`registerTableSelectionObserver` throwing in the headless tests.** Its mutation listener looks up the table's DOM element and throws when there is none. Step 13 registers it only after the view attaches; if a headless test still throws, the registration has leaked into `ensureEditor`.
- **A module cycle between the two transformer files.** `markdownTableTransformer.ts` needs the transformer array, which lives in the file that imports it. The lazy `getTransformers` function in step 9 is what prevents the cycle; passing the array by value would reintroduce it.
- **Setting the cell format before converting its content.** `$convertFromMarkdownString` clears the target node. Set the format after, as the snippet in `## Internal Structure` does, or alignment silently vanishes on every import.
- **Corpus documents authored in non-canonical form.** The existing round-trip suite asserts the editor's first-pass output equals the authored source after normalising. A corpus table written with padded cells (`| a   | b   |`) fails that assertion. Author them exactly as the exporter emits them: one space either side of each cell.
- **`<th>`'s centred browser default leaking through.** Without the explicit `textAlign: "left"` on `ts-ui-md-th`, an unaligned header cell renders centred while its body cells render left, which reads as a bug.
- **A body row with more cells than the header.** The importer truncates to the header's column count; extra cells are dropped. marked truncates the same way, so the two halves agree — but a source file relying on ragged rows loses data in both.
- **Keying the importer on a leading pipe.** GFM makes the leading and trailing pipes optional, and marked renders a table without them. An importer that requires them turns such a table into paragraphs while the viewer still shows a grid — the exact failure the parity rule exists to catch. `TABLE_ROW_REG_EXP` is deliberately just "contains a pipe", with the real decision made by the delimiter-row check.
- **Ending the importer's row scan on the first non-row line.** marked ends a table at a blank line only, so this would split one table into a table plus a paragraph. Scan to the blank line.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — the token switch (466), `appendList` (517) as the builder shape to mirror, `ensureMarkdownClassRules` (46), the class-name constants (18).
- [`packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts`](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts) — the curated array and the docblock that states the dialect contract; both change here.
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — `createBlockNode` (95), `toggleLink` (573) as the command shape to mirror, `ensureEditor` (686), `mountWysiwyg` (714), `dispose` (673).
- [`packages/lib/src/typescript/lib/component/editor/editorTheme.ts`](packages/lib/src/typescript/lib/component/editor/editorTheme.ts) — the class-rule and theme-map shape the table entries must match.
- [`packages/lib/tests/component/display/Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts) — the `RecordingDOMSink` helpers every new viewer assertion reuses; the fallback block at 173 that this plan halves.
- [`packages/lib/tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts) — `CORPUS` (36), `VIEWER_TOKENS` (52), and the `normalize` helper (55) the round-trip contract rests on.
- [`packages/lib/docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md) — lines 5 and 56, the consumer-facing statement of the dialect.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — typed setters, named listener functions, class rules through `StyleRule`, no raw DOM outside the seam.
- [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — the `{@link}` restriction that the docs build enforces.

---

## Non-Goals

- **A command to change a column's alignment.** Alignment round-trips losslessly and is editable in source mode; a WYSIWYG alignment control needs its own UX decision about how a column is targeted, and none of the 154 doc pages uses an alignment marker at all.
- **Merged cells.** GFM cannot express `colspan` or `rowspan`, so supporting them in the editor would produce state the exporter must destroy. `registerTableCellUnmergeTransform` deliberately flattens them.
- **Column resizing, row striping, frozen rows, and scrollable table wrappers inside the editor.** `@lexical/table` exposes theme hooks for all four; none has a Markdown representation, so each would be editor-only chrome and a parity risk.
- **Creating a table by typing a pipe row.** See *Table insertion is a command, not a typed shortcut*.
- **Nested tables.** `registerTablePlugin` defaults them off and the importer never builds one; GFM has no syntax for them.
- **Images, raw HTML, strikethrough, highlight, task lists, and thematic breaks.** Each is a separate dialect addition needing its own viewer arm and its own editor transformer under the parity rule. Their plain-text fallback stays as it is.

---

## Notes

[^parity-sources]: The three places are the source of truth for the dialect. [`markdownTransformers.ts:17`](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L17) describes the curated array as "the exact subset of Markdown the read-only `Markdown` viewer renders" and carries a transformer→viewer-token mapping symbol by symbol. [`docs/components/MarkdownEditor.md:5`](packages/lib/docs/components/MarkdownEditor.md#L5) states the same contract for consumers, and line 56 lists tables among the constructs excluded "so the editor's output always round-trips cleanly through the viewer". [`MarkdownEditor.ts:249`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L249) repeats it in the class docblock. The test file already guards it too: `VIEWER_TOKENS` at [`markdown-editor.test.ts:52`](packages/lib/tests/component/markdown-editor.test.ts#L52) asserts the editor's output lexes only to token types the viewer handles.

[^one-plan]: Splitting the viewer and editor halves into two merges would put a release boundary between them, and any release carrying only the viewer half ships the data-loss bug the parity rule exists to prevent. Within the plan the steps are ordered viewer-first because the viewer half is small and independently checkable, which gives a green checkpoint before the larger editor work starts — but both halves are in one branch and one merge. The plan is 14 files, of which four are documentation and two are demo panels; the code surface is six files plus one dependency line.

[^viewer-precedent]: `appendList` builds `<ul>` → `<li>` through `this.create(tag)` (which mints the handle, tracks it for release, and records it for teardown on the next `setMarkdown`) and `DOM.sink.apply(handle, { addClass })`, then `DOM.sink.appendChild`. `appendTable` is the same shape one level deeper. Using `DOM.sink.apply`'s `style` field for alignment instead of classes would work but would break with the file's own convention — every existing prose element is styled by a module-level `StyleRule` and an `addClass`, and there are only three alignment values, so three shared rules cover the whole space.

[^table-wrap]: The `Markdown` class docblock promises the prose "never overflows horizontally", with fenced code as the documented exception that "preserve[s] their lines and scroll[s] inside their own frame". A table's columns cannot reflow below their content width, so a wide table would break that promise. Putting the `<table>` inside a `max-width: 100%; overflow-x: auto` wrapper makes it behave the same way the `<pre>` rule already does, so the component keeps one story about horizontal overflow rather than two. `display: block` on the `<table>` itself was rejected: it disables the table layout algorithm and collapses the column sizing.

[^alignment-feasible]: Three facts, each checked against the installed packages. marked 18.0.6's table token carries `align: Array<"center" | "left" | "right" | null>` plus a per-cell `align`, so the viewer gets alignment for free from the lexer. `TableCellNode` extends `ElementNode`, whose `setFormat(type: ElementFormatType)` / `getFormatType()` pair accepts `"left" | "center" | "right" | ""` among others; `SerializedTableCellNode` spreads `SerializedElementNode`, so the format is part of the cell's serialized form. And Lexical's reconciler applies a non-zero element format as `text-align` on that node's DOM element, so a formatted cell renders aligned in the WYSIWYG surface with no extra work. `TableCellNode`'s own fields (`colSpan`, `rowSpan`, `headerState`, `width`, `backgroundColor`, `verticalAlign`) carry no horizontal alignment — the inherited `format` is the mechanism, and it needs no custom node subclass. The alternative, declaring alignment out of the dialect on both sides, was rejected because the delimiter row has to be parsed and emitted either way: recognising it is how the importer knows where the header ends, and emitting it is what makes the output a valid GFM table. Carrying the alignment through is a small addition to work that is already required, and the alternative would have the editor silently rewrite `|:---:|` to `|---|` in a user's document.

[^canonical-form]: The existing round-trip suite at [`markdown-editor.test.ts:222`](packages/lib/tests/component/markdown-editor.test.ts#L222) asserts two things per corpus document: that a second pass equals the first (a fixpoint), and that the first pass equals the authored source after `normalize`, which strips trailing whitespace and collapses blank-line runs. Cell padding inside a row is not something `normalize` handles, so table corpus documents must be authored in the exporter's own form.

[^multiline-choice]: Lexical's playground ships a `TABLE` transformer, but as an `ElementTransformer` that matches one pipe row at a time and rebuilds the table by walking backwards over previously-created paragraph siblings and removing them. That shape cannot require a delimiter row, because when the first row is matched the delimiter has not been read yet. It also has no way to reject a run of pipe rows that never gets one. The multiline shape reads the whole block from the `lines` array, so it can check line two before committing, and it replaces the backwards sibling surgery with a forward scan. `CODE`, already in the curated array, is the in-repo precedent for the `handleImportAfterStartMatch` hook: it consumes a fenced block the same way. The one thing the element shape gives up is markdown-shortcut typing, which this plan does not want anyway.

[^escaped-pipes]: The library's own documentation contains 12,892 escaped pipes across 242 Markdown files — they are how every type union in every options table is written, for example `` `"wysiwyg" \| "source"` `` at [`MarkdownEditor.md:34`](packages/lib/docs/components/MarkdownEditor.md#L34). Without escape handling, loading any of those pages into the editor would split one cell into two and shift every following column. The viewer needs no work here: marked resolves the escape before the token reaches the component, so a cell authored as `` `"a" \| "b"` `` arrives as a codespan token whose text is `"a" | "b"`. A regexp with a lookbehind (`/(?<!\\)\|/`) would also split correctly, but a manual scan matches what `@lexical/markdown` itself does — its `isTableRowDivider` docblock records that a nested-quantifier pattern was replaced by a manual scan because backtracking engines can run it in super-linear time.

[^lazy-transformers]: The transformer needs the full transformer array twice: to convert a cell's Markdown into nodes on import, and to convert a cell's nodes back to Markdown on export. That array lives in `markdownTransformers.ts`, which is also the file that builds the table transformer — so passing the array by value would need `markdownTableTransformer.ts` to import from its own importer, and the array would not be initialised yet at the moment `createTableTransformer` is called. A function returning the array is evaluated only when a document is imported or exported, by which time the array exists.

[^observer-split]: `registerTablePlugin` registers command listeners and node transforms only, so it is safe with no DOM. `registerTableSelectionObserver` is different: it registers a mutation listener on `TableNode` that calls `$getTableAndElementByKey`, which throws when the node has no element in the document, and it constructs a `MutationObserver` over the rendered table. Under the test harness `DOM.sink.mountView` returns `null` and Lexical's root element is never set, so registering the observer eagerly in `ensureEditor` would make every headless test that creates a table throw. Its purpose — pointer drag across cells, tab navigation, the cell-selection overlay — is entirely about the mounted view, so view-time registration is also where it belongs on the merits, not only for the tests.

[^unmerge]: A merged cell can arrive by pasting an HTML table into the editor, since `TableCellNode` supports `colSpan` and `rowSpan` and `@lexical/table` registers DOM import rules for them. GFM pipe syntax has no representation for either, so the exporter would have to drop the merge silently — the document would look one way in the editor and another after a save-and-reload. Flattening at the state level instead means what the user sees is always what round-trips.

[^no-typing-shortcut]: `registerMarkdownShortcuts` runs element transformers as the user types, firing on the space after a matched token. For a table this is the wrong granularity: a pipe row is only a table once a delimiter row follows it, which is at least two lines and one Enter later, so a typing shortcut would either fire too early on any line containing pipes or need its own multi-line state machine. `MultilineElementTransformer.replace` is documented as import-only, so choosing the multiline shape settles this by construction. The command API is also how every other non-typed formatting action in this component already works — `setBlockType`, `toggleLink`, the list toggles — and the demo panel already carries a toolbar to wire buttons into.

[^always-delimiter]: Lexical's playground exporter emits the delimiter row only when the first row's cells carry a header state, and it tests that state with a strict equality against a single flag. Both choices produce broken output in reachable cases: a table whose first row lost its header state (a row deleted in the WYSIWYG surface, say) exports as plain pipe rows, which marked does not parse as a table at all — so the viewer would render paragraphs where the editor showed a grid, a direct parity break. Emitting the delimiter after row 0 unconditionally means every exported table is valid GFM. It is also lossless in GFM terms, because GFM has no headerless table: whatever row 0 holds is the header by definition.

[^blank-line-terminator]: Checked against marked 18.0.6, not assumed. `| a | b |\n| --- | --- |\n| 1 | 2 |\nplain prose` lexes to a single `table` token — the pipe-free trailing line is absorbed as a row. Inserting a blank line before it produces `table`, `space`, `paragraph`. So the terminator is the blank line, not "the line stops looking like a row". Ending the importer's scan on a non-pipe line instead would split one document into a table plus a paragraph where the viewer shows one table, which is a parity break in the direction this plan exists to prevent.

[^shape-normalisation]: Both looser shapes were checked against marked 18.0.6. `a | b\n--- | ---\n1 | 2` — no leading or trailing pipes anywhere — lexes to a `table` token, so the viewer renders it and the editor must too; an importer keyed on a leading pipe would turn it into paragraphs and destroy the table. In the other direction, `| a | b |\n| --- |\n| 1 | 2 |`, whose delimiter row has fewer columns than the header, lexes to a plain `paragraph` — marked refuses it — which is why the importer declines on a column-count mismatch rather than padding. Normalising the output to one canonical shape is the same choice the dialect already makes for emphasis: the curated array picks `BOLD_STAR` over `BOLD_UNDERSCORE` so `__b__` is read but `**b**` is written.

[^docblock-wrong]: The claim was checked against the installed package, not assumed. `@lexical/markdown` 0.46.0's `dependencies` are `@lexical/{code-core,internal,link,rich-text,list,selection,text,utils}` and `lexical` — no `@lexical/table`. Its public exports are the four transformer arrays, the individual transformers (`HEADING`, `QUOTE`, `CODE`, both list kinds, `CHECK_LIST`, the emphasis variants, `STRIKETHROUGH`, `HIGHLIGHT`, `INLINE_CODE`, `LINK`), the three conversion functions, `registerMarkdownShortcuts`, and one table-related helper — `isTableRowDivider`, a predicate that tests whether a line is a delimiter row. A predicate is not a transformer; there is no table transformer in the package, and no image transformer either. The docblock's claims about `STRIKETHROUGH`, `HIGHLIGHT`, and `CHECK_LIST` are correct and stay.

---

## Implementation Notes

- **Pre-existing, unrelated bugfix required to run the test suite at all.** `tests/component/container/leaves.smoke.test.ts` called `new MenuItem({...}, () => {})` (2 args) at two call sites, but `MenuItem`'s constructor requires a third `onOpenSubmenu` callback. This pre-dates this plan (confirmed identical on local `master`) and made `npm -w packages/lib run typecheck:test` — and therefore `npm run test` — fail on unmodified `master`, before any of this plan's changes. Fixed as a standalone commit (both call sites now pass `() => {}` as the third argument) so the full suite could actually run; it is unrelated to GFM tables and out of this plan's scope otherwise.
- **A second, plan-caused bug found only by the manual-verification browser pass.** The demo panel's `MarkdownEditorPanel.handleInsertTable` was written as an ordinary class method and wired with `insertTableButton.on('action', this.handleInsertTable)`. Passed as a bare reference this way, Lexical/the framework's `on()` sugar invokes it unbound, so `this` was `undefined` inside the method and clicking "Insert table" threw `TypeError: Cannot read properties of undefined (reading 'insertTable')` — caught live in Chrome via `mcp__chrome-devtools`, not by any offline test (the offline harness never mounts a real DOM button click for this panel). Fixed by converting it to a `private readonly` arrow-function class field, matching the codebase's own precedent for this exact pattern (`VideoPlayer._onPlayButton`, `ScrollStrip.leadClicked`/`trailClicked`). Re-verified live afterward: the button now inserts a table with no error, in both the WYSIWYG editor and the synced viewer.
- **Tab-key cell-to-cell navigation could not be conclusively verified live.** The plan's manual-verification list includes "Tab moves the caret to the next cell and Shift+Tab to the previous," provided by `@lexical/table`'s `registerTableSelectionObserver(editor, true)` (wired exactly as step 13 specifies). Driving a synthetic Tab keypress through the Chrome DevTools Protocol (both `press_key` and a manual `dispatchEvent`) moved focus to the next native-focusable element instead of the next table cell, and a diagnostic `keydown` listener attached to both the contenteditable root and `document` never observed the event firing at all for that specific key — while every other interaction on the same contenteditable (click-to-place-caret, typing, insert-table, alignment round-trip through source mode, theme-driven recolouring) worked correctly through the same pipeline. This points to a CDP/automation-tooling artifact specific to synthetic Tab dispatch rather than a product defect, but it was not possible to fully rule out a real issue without a physical keyboard. Recommend a human spot-check of Tab/Shift+Tab cell navigation in the MD Editor demo panel before relying on it.
- **A third, plan-caused bug found during the same live pass, initially missed: dragging across cells produced no visible selection.** A pointer drag through the CDP `drag` action (mousedown on one cell, mouseup on another) left the browser's native selection collapsed to a caret and added no highlight to any cell, which read as ambiguous — either the CDP-synthesised drag wasn't registering with Lexical's pointer handlers (the same class of artifact as the Tab-key finding above) or the selection was registering but not rendering. Reading `@lexical/table`'s source (`$addHighlightToDOM`/`$removeHighlightFromDOM` in `node_modules/@lexical/table`) settled it: both call `addClassNamesToElement(element, editorThemeClasses.tableCellSelected)`, and `editorTheme.ts`'s `EDITOR_THEME` never defined a `tableCellSelected` key, so the call was always a silent no-op — confirmed by `grep -rn tableCellSelected packages/lib/src` returning nothing. This is a real, code-level gap, not a CDP artifact: whatever cell-selection state Lexical tracks internally, no user could ever see it. Fixed by adding a `tableCellSelected` class rule to `editorTheme.ts`, reusing the data-grid `Table` component's own `--ts-ui-table-row-selected` token so a selected editor cell highlights the same way a selected table row does elsewhere in the framework (standalone follow-up commit, since the branch's plan-move commit had already landed by the time this was found). Re-verified live afterward: dragging from the header cell to the diagonal body cell now stamps `ts-ui-mde-table-cell-selected` on all four cells in the range and renders a visible blue highlight in the WYSIWYG surface.
- **Wide-table horizontal scroll in the `Markdown` viewer verified live.** The plan's manual-verification list includes "a table wider than the panel scrolls horizontally inside its own frame, and the panel itself does not scroll sideways." Temporarily widening the demo panel's sample table with one unbroken long token, then reading `document.documentElement.scrollWidth` against `window.innerWidth` and the table wrapper `<div>`'s `scrollWidth`/`clientWidth` in the live page, confirmed the document itself never gains horizontal overflow (`docScrollWidth === winWidth`) while the wrapper div (`overflow-x: auto`, per the `[^table-wrap]` footnote) does (`scrollWidth 1942` vs `clientWidth 1192`) and shows its own scrollbar under the table. The demo-panel edit used for this check was reverted afterward; it is not part of the shipped diff.
