# MarkdownEditor Context Menu — Implementation Plan

## Overview

`MarkdownEditor` ([packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts)) has a full formatting command API (`toggleBold`, `setBlockType`, `insertTableRow`, …) but no way to reach it except a consumer-built toolbar. This plan adds a right-click context menu directly to the WYSIWYG surface, with contents that depend on what was clicked: a word or selection gets inline-format and block-style commands, an empty line gets block-insert commands, and a table cell gets row/column/table commands.

The menu reuses the existing [`Menu`](packages/lib/src/typescript/lib/overlay/Menu.ts) component in rebuild mode — the same component the Misc demo panel's "Right-click me for context menu" button uses ([MiscPanel.ts:914-928](packages/lib/src/typescript/MiscPanel.ts#L914-L928)) and the same one [`Table`](packages/lib/src/typescript/lib/component/table/Table.ts) already wires up for its own column and cell context menus ([Table.ts:214](packages/lib/src/typescript/lib/component/table/Table.ts#L214), [Table.ts:1711-1778](packages/lib/src/typescript/lib/component/table/Table.ts#L1711-L1778)). Building the menu's contents requires classifying the click: resolving the native `contextmenu` event's target to a Lexical node, then reading the surrounding document structure. This plan also closes a real dialect gap found during investigation: this editor's transformer list cannot emit `~~strikethrough~~`, and the read-only `Markdown` viewer cannot render it either, even though the task asks for a strikethrough toggle.

Three files change beyond `MarkdownEditor.ts`: `markdownTransformers.ts` and `editorTheme.ts` (both in the same `component/editor/` directory) gain strikethrough support, and `Markdown.ts` ([packages/lib/src/typescript/lib/component/display/Markdown.ts](packages/lib/src/typescript/lib/component/display/Markdown.ts)) gains `<del>` rendering so the viewer stays able to render everything the editor can produce.

---

## Architecture Decisions

### Reuse `Menu` in rebuild mode, one instance owned by `MarkdownEditor`

`MarkdownEditor` gets a single `private readonly _contextMenu: Menu = new Menu();` field, shown via `.show(x, y, items)` with a freshly-built item list for whichever of the three contexts applies. This mirrors `Table`'s `_columnContextMenu` field exactly.[^table-menu-precedent]

### The menu is self-wired, not consumer-wired

Every other formatting entry point this editor exposes is deliberately consumer-wired — the class's own doc comment says there is "no built-in toolbar" and the mode toggle is "consumer-wired… no built-in chrome" ([MarkdownEditor.ts:328-345](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L328-L345)). The context menu does not follow that pattern. It follows the *keyboard shortcuts* instead — Ctrl/Cmd+B, and the Alt+Enter separator shortcut added in the previous session ([MarkdownEditor.ts:149-194](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L149-L194)) — both registered inside the editor itself with no consumer involvement. A context menu is triggered by a native gesture on the surface itself, not by placing visible chrome, so it belongs with the gesture-driven shortcuts, not the toolbar. Concretely: the menu is built and shown from inside `MarkdownEditor`'s own constructor wiring, and the existing `MarkdownEditorPanel` demo needs **no functional changes** — right-clicking in the already-live demo exercises the new menu immediately, the same way Alt+Enter already does.

### Classifying a click: resolve DOM target → Lexical node, mirroring `$tableClickCommand`

A native `contextmenu` event carries a real DOM `target`. `@lexical/table`'s own `$tableClickCommand` resolves exactly this kind of raw DOM target to a Lexical node with `isDOMNode(event.target)` followed by `$getNearestNodeFromDOMNode(event.target)` (`node_modules/@lexical/table/dist/LexicalTable.dev.mjs:4802-4809`). This plan's classification mirrors that call shape.[^import-path-correction]

### Classification is a pure function, split from the untestable DOM-resolution step

`$getNearestNodeFromDOMNode` only resolves against nodes Lexical has actually reconciled into a *real, mounted* DOM tree. Offline, `WysiwygSurface.mount()`'s call to `DOM.sink.mountView` returns `null` and the view never attaches (documented at [MarkdownEditor.ts:966-968](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L966-L968)), so `$getNearestNodeFromDOMNode` can never resolve anything in the offline test harness — there is no way to unit-test the DOM-resolution step itself. Splitting the work into two pieces keeps everything else testable:

- `$classifyContextMenuTarget(node: LexicalNode): ContextMenuTarget` — pure Lexical-tree logic, given an already-resolved node. No DOM involved, so this is fully offline-testable the same way `$selectionIsInTableCell` already is.
- `MarkdownEditor.handleWysiwygContextMenu(event: MouseEvent)` — the thin, four-line wrapper that resolves `event.target` to a node and calls the function above. This is the only piece the manual-verify step has to cover.

`$classifyContextMenuTarget` is exported (not part of the public `MarkdownEditor` callable, just a plain named export) so the test file can import it directly, mirroring how `Markdown.test.ts` already imports the non-barrel-exposed `mapFenceLangToEditorId` and `extractMarkdownHeadings` ([Markdown.test.ts:2](packages/lib/tests/component/display/Markdown.test.ts#L2)).

### Classification rule

Table cell wins even when empty; an empty paragraph is the insert context; everything else is the format context, which also carries the current bold/italic/strikethrough/code state so the menu can show a checkmark on active toggles.

| Click resolves to | Table cell? | Empty paragraph? | Menu shown |
|---|---|---|---|
| Text inside a populated table cell | yes | — | table-cell |
| An *empty* table cell | yes | — | table-cell (table check runs first) |
| An empty paragraph outside any table | no | yes | empty-line (insert) |
| A word, or a range selection, in ordinary prose | no | no | text (format) |
| An empty heading or empty quote | no | no (only a bare paragraph counts) | text (format) — no-op-safe on an empty selection, same as clicking a toolbar button with nothing selected |

### The native selection-follow-on-right-click assumption, and why the action handlers don't depend on it being perfect

Standard contenteditable behavior collapses the caret to the click point on a right-click outside the current selection, and preserves the selection when the click lands inside it — this is what lets "right-click a word" and "right-click a selection" both act on the right text. This plan does not re-implement that logic.[^native-rightclick-verification] Instead, every menu item's `action` calls one of `MarkdownEditor`'s **existing** command methods unchanged (`toggleBold()`, `setBlockType()`, `insertTableRow()`, …), each of which reads `$getSelection()` at the moment it runs — exactly what a toolbar `Button` wired to the same methods already does today in `MarkdownEditorPanel` ([MarkdownEditorPanel.ts:74-89](packages/lib/src/typescript/MarkdownEditorPanel.ts#L74-L89)). The menu introduces no new dependency on selection surviving a click outside the contenteditable: that already has to work for the existing toolbar demo to function.

No word-boundary auto-selection is added: a collapsed click inside a word applies a toggle to future typing only, the same as the toolbar buttons already do. Expanding to word boundaries would need `RangeSelection.modify()`, which wraps the browser's native `Selection.modify()` and has known cross-browser word-granularity differences — a real complexity increase for behavior the task did not explicitly request.[^word-select-rejected]

### Inline code is included in the format menu; link add/edit is not

`toggleInlineCode()` is a zero-argument toggle with exactly the same shape as `toggleBold`/`toggleItalic` — there is no reason to leave it out, and `INLINE_CODE` is already in the editor's transformer list. It is included.

`toggleLink(url: string | null)` needs a URL string from the user. Every other item in every context menu this plan adds is a zero-friction wire-through to a no-argument (or fixed-argument, like `insertTable(2, 3)`) command; a link item would need a small inline text-input popover that does not exist yet in this component family (`MenuItemConfig` supports a custom `row()` factory, but building a commit-on-Enter URL prompt inside a `Menu` row is a separate, nontrivial UI problem). Adding it is left out of this plan; see Non-Goals.

### `WysiwygSurface` exposes its own `"contextmenu"` custom event

The private `WysiwygSurface` class registers `Event.addListener(this, "contextmenu", { prevent: true, handler: this.handleContextMenu })` on itself and re-fires it as a typed `"contextmenu"` event through the full `on`/`off`/`emit` + `ListenerBag` shape ARCHITECTURE.md requires for custom events. This is not a new pattern: `TabBar`, `ParentHeader`, `SplitGutter`, `Tree`, `CollapseButton`, `AbstractSelectableList`, `DiagramView`, and `Header.ts` (table cell) all wrap a self-registered raw `contextmenu` DOM listener into their own semantic `"contextmenu"` custom event this same way — `ParentHeader.ts:305` (`Event.addSubtreeListener(this, "contextmenu", { prevent: true, handler: this.onContextMenu });`) is the closest match to this plan's exact registration shape. `MarkdownEditor` subscribes with `this._wysiwyg.on("contextmenu", (event) => this.handleWysiwygContextMenu(event));` in its constructor — an inline arrow, not a bare method reference, because `ListenerBag.fire` calls listeners bare with no `this` rebinding ([ListenerBag.ts:82-84](packages/lib/src/typescript/lib/core/ListenerBag.ts#L82-L84)), the same reason `MarkdownEditor`'s own constructor already wraps `handleCodeChange` in an arrow at [MarkdownEditor.ts:437](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L437). The registration's `prevent: true` is an unconditional floor (not a per-branch disposition) — every one of the precedents above uses the same unconditional floor, and this plan adds no read-only special-casing (see Non-Goals) that would need a conditional one.

### Table-cell menu: four insert items, not two

Both `insertTableRow` and `insertTableColumn` already take an `after: boolean = true` direction argument, but the table-cell menu exposes both directions as separate items rather than one item defaulting to `after`:

- Insert row above → `insertTableRow(false)`
- Insert row below → `insertTableRow(true)`
- Insert column left → `insertTableColumn(false)`
- Insert column right → `insertTableColumn(true)`

plus Delete row, Delete column, and the new Delete table.

### Deleting a table: no existing helper, so `MarkdownEditor` gets one

`@lexical/table`'s export list (`node_modules/@lexical/table/dist/index.d.ts:25`) has row and column deletion helpers but no whole-table deletion. `TableNode extends ElementNode`, which inherits `remove(preserveEmptyParent?: boolean): void` from `LexicalNode` (`node_modules/lexical/dist/LexicalNode.d.ts:880`) — the standard way to remove any node and its children from the tree. The new `deleteTable()` finds the enclosing table via a new `$getEnclosingTableNode()` helper, mirroring the existing `$selectionIsInTableCell()` ([MarkdownEditor.ts:120-128](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L120-L128)) but returning the `TableNode` itself instead of a boolean, then calls `.remove()` on it. `$selectionIsInTableCell()` is refactored to `return $getEnclosingTableNode() !== null;` rather than duplicating the same three lines.

### "Reset to undecorated" is `clearFormatting()`, built on Lexical's `IS_ALL_FORMATTING` bitmask

Lexical exports `IS_ALL_FORMATTING` — a bitmask covering every text format it knows about (bold, italic, strikethrough, underline, code, subscript, superscript, highlight, …) — from its core package (`node_modules/lexical/dist/LexicalConstants.d.ts:31`, re-exported at `dist/index.d.ts:12`). `clearFormatting()` walks every `TextNode` in the current selection (`RangeSelection.getNodes()`) and clears that mask from each node's format with `node.setFormat(node.getFormat() & ~IS_ALL_FORMATTING)`. This clears every format Lexical supports, not just the four this dialect exposes toggles for — defensively correct against a stray format a paste might have introduced, and no more code than hand-listing the dialect's own four formats. Block type (heading, quote, …) is untouched; it has its own menu items. The method is named `clearFormatting`, not `resetToUndecorated`, to match this file's existing verb-object naming (`toggleBold`, `setBlockType`) — the task's "reset to undecorated" describes what the menu item does in English, not the method name.

### Strikethrough needs three separate fixes, not just a menu item

Investigation found `STRIKETHROUGH` is not in this editor's curated `TRANSFORMERS` array ([markdownTransformers.ts:53-64](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L53-L64)) — confirmed by an existing test that currently asserts the *exclusion*: `markdown-editor.test.ts:117-121` expects `TRANSFORMERS` to **not** contain `STRIKETHROUGH`. Without it, an author could not save `~~text~~` through this editor at all, so a strikethrough toggle would have nothing to round-trip. Three additions are needed together, not just the transformer:

1. **`markdownTransformers.ts`** — add `STRIKETHROUGH` (a plain `TextFormatTransformer` with `tag: '~~'`, the same shape as `BOLD_STAR`/`ITALIC_STAR`) to the array, after `INLINE_CODE` and before `LINK` — matching Lexical's own canonical relative order among its format transformers (`node_modules/@lexical/markdown/dist/*.dev.mjs:621`), while leaving this file's existing non-canonical `BOLD_STAR`/`ITALIC_STAR`/`INLINE_CODE` ordering untouched.
2. **`editorTheme.ts`** — Lexical only paints a visible style for a text format when `EditorThemeClasses.text` names a CSS class for it; `bold`/`italic`/`code` already do this via `BOLD_CLASS`/`ITALIC_CLASS`/`INLINE_CODE_CLASS` ([editorTheme.ts:207-211](packages/lib/src/typescript/lib/component/editor/editorTheme.ts#L207-L211)). Without a matching `strikethrough` entry, a strikethrough-formatted selection would round-trip through Markdown correctly but render with **no visible strikethrough in the WYSIWYG surface** — a real, easy-to-miss WYSIWYG gap. Add `STRIKETHROUGH_CLASS = "ts-ui-mde-strikethrough"` (`{ textDecoration: "line-through" }`) and `text: { …, strikethrough: STRIKETHROUGH_CLASS }`.
3. **`Markdown.ts`** — marked's GFM lexer already tokenizes `~~text~~` as a `Tokens.Del` (`type: "del"`, same `{ raw, text, tokens }` shape as `Tokens.Strong`/`Tokens.Em`), but `appendInlineToken`'s switch ([Markdown.ts:1739-1770](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1739-L1770)) has no `"del"` case, so it falls to the `default` branch and renders as plain text with the tildes stripped — the read-only viewer silently drops strikethrough today. This is exactly the invariant `MarkdownEditor`'s own doc comment states it must never violate: "a curated transformer list… guarantees the editor can never emit Markdown the viewer would drop to plain text" ([MarkdownEditor.ts:323-325](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L323-L325)). Add `case "del": this.appendInlineWrapper(parent, "del", (token as Tokens.Del).tokens, splitCellBreaks); break;`, mirroring the existing `"strong"`/`"em"` cases exactly. `<del>` needs no new CSS class — the browser's native strikethrough styling is free, the same as `<strong>`/`<em>`'s native bold/italic.

### Block-style scope matches the task's own wording exactly

The task names two different block-type surfaces with two different scopes: the word/selection context's "block style" is explicitly scoped to "heading levels h1–h6, or normal paragraph" (no quote, no code), while the empty-line context's insert list explicitly includes quote and code. The two menus are built from slightly different item sets rather than one shared list — see Internal Structure.

### Inline-toggle checkmarks; no block-type checkmark

Bold/Italic/Strikethrough/Inline code show a checkmark reflecting the current selection's format state (`RangeSelection.hasFormat(type)` — one cheap read per item, computed once when the menu is built). The block-style and insert-menu items do not show which block type is currently active — that needs a "what block type is the caret in" helper this plan does not otherwise need, meaningfully more code than the one-line format check. Left out; see Non-Goals.

---

## Public API

```typescript
// New methods on MarkdownEditor, alongside the existing toggleBold/toggleItalic/toggleInlineCode:

/** Toggles strikethrough on the current selection. No-op without a range selection. */
toggleStrikethrough(): this;

/**
 * Clears every inline text format (bold, italic, strikethrough, inline code,
 * and any other Lexical text format) from the current selection, leaving
 * plain text. No-op without a range selection. Block type is untouched.
 */
clearFormatting(): this;

/**
 * Deletes the entire table containing the caret, including every row and
 * cell. No-op without throwing when the caret is not inside a table cell.
 */
deleteTable(): this;
```

```typescript
// New named export from MarkdownEditor.ts, for offline testing — not part of
// the public MarkdownEditor callable, and not re-exported from any barrel.

export type ContextMenuTarget =
    | { kind: "table-cell" }
    | { kind: "empty-line" }
    | { kind: "text"; bold: boolean; italic: boolean; strikethrough: boolean; code: boolean };

export function $classifyContextMenuTarget(node: LexicalNode): ContextMenuTarget;
```

No changes to `MarkdownEditorOptions`, `MarkdownBlockType`, or any existing signature.

---

## Internal Structure

### `WysiwygSurface` (private class) additions

```typescript
type WysiwygSurfaceEvent = "contextmenu";

// New field, alongside the existing _contentEditable / _onReady:
private readonly _listeners: ListenerBag<WysiwygSurfaceEvent> = this.registerListenerBag(new ListenerBag<WysiwygSurfaceEvent>());

// In the constructor, alongside the existing setContentEditable/setOverflow/setPadding calls:
Event.addListener(this, "contextmenu", { prevent: true, handler: this.handleContextMenu });

on(event: "contextmenu", listener: (event: MouseEvent) => void): this {
    this._listeners.add(event, listener);
    return this;
}

off(event: "contextmenu", listener: (event: MouseEvent) => void): this {
    this._listeners.remove(event, listener);
    return this;
}

protected emit(event: "contextmenu", payload: MouseEvent): void {
    this._listeners.fire(event, payload);
}

private handleContextMenu(event: MouseEvent): void {
    this.emit("contextmenu", event);
}
```

### `MarkdownEditor` classification and menu construction

```typescript
/** Finds the table containing the current selection, if any. */
function $getEnclosingTableNode(): TableNode | null {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    const tableCell = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
    return tableCell === null ? null : $getTableNodeFromLexicalNodeOrThrow(tableCell);
}

// $selectionIsInTableCell becomes:
function $selectionIsInTableCell(): boolean {
    return $getEnclosingTableNode() !== null;
}

export function $classifyContextMenuTarget(node: LexicalNode): ContextMenuTarget {
    if ($getTableCellNodeFromLexicalNode(node) !== null) {
        return { kind: "table-cell" };
    }

    const block = $findMatchingParent(node, (n) => $isElementNode(n) && !n.isInline());

    if ($isParagraphNode(block) && block.getTextContent() === "") {
        return { kind: "empty-line" };
    }

    const selection = $getSelection();
    const hasFormat = (type: TextFormatType): boolean =>
        $isRangeSelection(selection) && selection.hasFormat(type);

    return {
        kind: "text",
        bold: hasFormat("bold"), italic: hasFormat("italic"),
        strikethrough: hasFormat("strikethrough"), code: hasFormat("code"),
    };
}
```

`MarkdownEditor` gets one new field (`private readonly _contextMenu: Menu = new Menu();`), one DOM-resolving handler, and four item-building methods:

```typescript
private handleWysiwygContextMenu(event: MouseEvent): void {
    if (!isDOMNode(event.target)) return;
    const domTarget = event.target;
    const editor = this.ensureEditor();

    const context = editor.read(() => {
        const node = $getNearestNodeFromDOMNode(domTarget);
        return node === null ? null : $classifyContextMenuTarget(node);
    });

    if (context === null) return;

    this._contextMenu.show(event.clientX, event.clientY, this.buildContextMenuItems(context));
}

private buildContextMenuItems(context: ContextMenuTarget): MenuItemConfig[] {
    switch (context.kind) {
        case "table-cell":  return this.buildTableCellContextMenuItems();
        case "empty-line":  return this.buildEmptyLineContextMenuItems();
        case "text":        return this.buildTextContextMenuItems(context);
    }
}
```

Item lists (all `action`s call the existing/new command methods verbatim, no new selection logic):

| Method | Items |
|---|---|
| `buildTextContextMenuItems(context)` | Bold `Ctrl+B` (checked: `context.bold`), Italic `Ctrl+I` (checked: `context.italic`), Strikethrough (checked: `context.strikethrough`), Inline code (checked: `context.code`), separator, "Block style" submenu → [Paragraph, separator, Heading 1..6], separator, Clear formatting |
| `buildEmptyLineContextMenuItems()` | "Heading" submenu → `buildHeadingMenuItems()`, Quote, Code block, separator, Table |
| `buildTableCellContextMenuItems()` | Insert row above, Insert row below, Insert column left, Insert column right, separator, Delete row, Delete column, Delete table |
| `buildHeadingMenuItems()` (shared helper) | Heading 1..6 → `setBlockType("h1"..."h6")` |

The empty-line menu omits a "Paragraph" item — the classification already guarantees the caret sits in an empty paragraph, so converting it to a paragraph is a guaranteed no-op.

---

## Ordered Implementation Steps

1. **Fix the strikethrough dialect gap first — it blocks everything downstream that toggles it.**
   - `packages/lib/tests/component/markdown-editor.test.ts:108-121` — flip the two existing tests: `STRIKETHROUGH` moves from the "excludes" assertion (line 118) into the "contains exactly the ten…" assertion (lines 109-115, now eleven), and add a `'strikethrough': '~~struck~~ text'` entry to the `CORPUS` map (line ~40-55) so the existing round-trip/idempotence/dialect-fidelity `for` loops pick it up automatically. Run the suite — both moved assertions and the new corpus entry should fail (red).
   - `packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts` — import `STRIKETHROUGH` from `@lexical/markdown` and insert it into the `TRANSFORMERS` array after `INLINE_CODE`, before `LINK`. Update the file's own doc comment (the "ten dialect transformers" / mapping list) to eleven and add the `STRIKETHROUGH` → `~~text~~` row.
   - `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` — add `STRIKETHROUGH_CLASS`, its `StyleRule` (`textDecoration: "line-through"`), and `EDITOR_THEME.text.strikethrough`.
   - `packages/lib/src/typescript/lib/component/display/Markdown.ts` — add the `case "del":` branch to `appendInlineToken`'s switch ([Markdown.ts:1739](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1739)). Add a new `describe('Markdown strikethrough')` block to `packages/lib/tests/component/display/Markdown.test.ts` mirroring the existing `'Markdown emphasis'` block (`new Markdown('~~s~~').getElement(true)`, assert `createdTags()` contains `'del'`, `childTagsOf('p')` contains `'DEL'`, `textWrites()` contains `'s'`).
   - Verify: `npm run test` (or the project's scoped vitest command) — the two updated tests, the new corpus entry, and the new `Markdown.test.ts` block are all green.

2. **Add `toggleStrikethrough`, `clearFormatting`, and `deleteTable` to the command API.**
   - `MarkdownEditor.ts` — add `IS_ALL_FORMATTING`, `$isTextNode`, and `TextFormatType` (type-only) to the existing `'lexical'` import ([MarkdownEditor.ts:11-15](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L11-L15)).
   - Add `toggleStrikethrough()` right after `toggleInlineCode()` ([MarkdownEditor.ts:656-660](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L656-L660)), same one-line body shape with `"strikethrough"`.
   - Add `$getEnclosingTableNode()` right after `$selectionIsInTableCell()` ([MarkdownEditor.ts:120-128](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L120-L128)), and refactor `$selectionIsInTableCell()` to call it (see Internal Structure).
   - Add `deleteTable()` after `deleteTableColumn()` ([MarkdownEditor.ts:821-831](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L821-L831)).
   - Add `clearFormatting()` after `toggleLink()` ([MarkdownEditor.ts:693-705](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L693-L705)) — it operates on inline formatting like the toggle methods, not block type like `setBlockType`.
   - Write tests first in `markdown-editor.test.ts`, alongside the existing `'MarkdownEditor command API'` and `'MarkdownEditor table commands'` blocks:
     - `toggleStrikethrough` no-throws with no selection (extend the existing chained no-throw test at line 264-278); round-trips `~~x~~` through `setValue`/`getValue` on a selected word.
     - `clearFormatting()`: build a document with `**bold** *italic* \`code\``, select all, call `toggleBold(); toggleItalic(); toggleInlineCode();` to apply all three (or set formats directly via a white-box selection setup mirroring `selectStart`), call `clearFormatting()`, assert `getValue()` contains the plain text with no `**`/`*`/`` ` `` markers. No-throw with no selection.
     - `deleteTable()`: `insertTable(2, 3)`, select into a cell (mirror `selectInFirstTableCell` from the Alt+Enter test block, [markdown-editor.test.ts:753-762](packages/lib/tests/component/markdown-editor.test.ts#L753-L762)), call `deleteTable()`, assert the document has no `table` token (`lexer(editor.getValue())`). No-throw when the caret is not in a table cell.
   - Verify: new tests fail before the methods exist, pass after (red→green).

3. **Add the pure classification helper, test it directly.**
   - `MarkdownEditor.ts` — add `$getNearestNodeFromDOMNode`, `isDOMNode`, `$findMatchingParent`, `$isElementNode`, and `$isParagraphNode` to the `'lexical'` import. Add the `ContextMenuTarget` type and the exported `$classifyContextMenuTarget(node)` function (see Internal Structure), placed near `$findEnclosingSeparatorTarget` since it is the closest sibling.
   - Write tests first, in a new `describe('$classifyContextMenuTarget')` block in `markdown-editor.test.ts`, importing `$classifyContextMenuTarget` directly (mirroring `Markdown.test.ts`'s import of `mapFenceLangToEditorId`). Build each fixture with `setValue`, then reach a concrete `LexicalNode` reference the same way `selectInFirstTableCell` does (via `lexicalOf(editor).update(() => { … })`), and assert the classification:
     - A text node inside an ordinary paragraph → `{ kind: "text", bold: false, … }`.
     - A text node inside a paragraph after `toggleBold()` was applied to a selection covering it → `{ kind: "text", bold: true, … }`.
     - The paragraph node of a genuinely empty paragraph → `{ kind: "empty-line" }`.
     - A node inside a populated table cell → `{ kind: "table-cell" }`.
     - A node inside an *empty* table cell → `{ kind: "table-cell" }` (table check wins over the empty-paragraph check).
   - Verify: tests fail before the function exists, pass after.

4. **Wire the raw `contextmenu` DOM event through `WysiwygSurface`.**
   - `MarkdownEditor.ts` — add `Event` import from `~/core/Event.js` and `ListenerBag` is already imported ([MarkdownEditor.ts:6](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6)). Add the `WysiwygSurfaceEvent` type, the `_listeners` field, `on`/`off`/`emit`, `handleContextMenu`, and the `Event.addListener` registration to `WysiwygSurface` (see Internal Structure).
   - This step is not offline-testable in isolation (the recording DOM sink delivers no real events), so no new offline test is added for it — it is covered by the manual-verify step (Step 6) and by the offline tests in Steps 5-6 that reach `handleWysiwygContextMenu` directly, bypassing the DOM event.
   - Verify: `npm run typecheck` (or the project's build) passes; no behavioral test here by design.

5. **Add `_contextMenu`, `handleWysiwygContextMenu`, and the four item-builder methods to `MarkdownEditor`.**
   - Add `import { Menu } from "~/overlay/Menu.js";` and `import { MenuItemConfig } from "~/component/container/MenuItem.js";`.
   - Add the `_contextMenu` field, `handleWysiwygContextMenu`, `buildContextMenuItems`, `buildTextContextMenuItems`, `buildEmptyLineContextMenuItems`, `buildTableCellContextMenuItems`, and `buildHeadingMenuItems` (see Internal Structure).
   - Wire `this._wysiwyg.on("contextmenu", (event) => this.handleWysiwygContextMenu(event));` in the constructor, right after `this._wysiwyg = new WysiwygSurface(() => this.mountWysiwyg());` ([MarkdownEditor.ts:433](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L433)).
   - Add `this._contextMenu.dispose();` to `destructor()`, alongside the existing `_unregisterTableView?.()` / `_unregister?.()` / `_editor?.setRootElement(null)` calls ([MarkdownEditor.ts:900-903](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L900-L903)) — `Menu` is never registered via `addComponent` (per `Menu`'s own class comment), so the base class's child-recursion teardown cannot reach it; `Table.destructor()` disposes `_columnContextMenu` the same explicit way.
   - Write tests first, reaching the private methods via the same `as unknown as { … }` cast pattern the file's `lexicalOf`/`codeEditorOf`/`wysiwygOf` helpers already use ([markdown-editor.test.ts:67-85](packages/lib/tests/component/markdown-editor.test.ts#L67-L85)):
     - `buildContextMenuItems({ kind: "text", bold: true, … })` returns an array whose "Bold" entry has `checked: true` and whose "Block style" entry has a `submenu` with 8 items (Paragraph, separator, 6 headings).
     - `buildContextMenuItems({ kind: "empty-line" })` returns an array with no "Paragraph" item and a "Heading" submenu of exactly 6 items.
     - `buildContextMenuItems({ kind: "table-cell" })` returns exactly 8 entries (4 inserts, 1 separator, 3 deletes) in the order given in Internal Structure.
     - Invoke a few `action` callbacks directly (e.g. the "Delete table" item's `action()` on an editor with a table and the caret inside it) and assert the resulting document, proving the wiring reaches the right command.
     - `handleWysiwygContextMenu` no-throws when `event.target` is not a DOM node (an object that fails `isDOMNode`).
   - Verify: red before the methods exist, green after.

6. **Manual browser verification (not offline-testable).**
   - Use the [`run`](../../../.claude/skills/run) skill (or `npm run dev`) to launch the app and open the existing `MarkdownEditorPanel` demo — no demo code changes are needed (Step 5's self-wiring is the point).
   - Right-click a word with no selection: format menu appears; Bold/Italic act on future typing at that caret (documented existing behavior, unchanged by this plan).
   - Select a range of text, right-click inside the selection: format menu appears, selection is visibly preserved (not collapsed); toggling Bold visibly bolds the selected text.
   - Right-click an empty line: insert menu appears; each item converts the line as expected; Table inserts a 2×3 table.
   - Right-click inside a table cell (populated and empty): table-cell menu appears with all eight items; each insert/delete acts on the right row/column; Delete table removes the whole table.
   - Confirm the native browser context menu never appears over the WYSIWYG surface (the framework menu always replaces it).
   - Record the outcome of the native-selection-follow-on-right-click assumption from [^native-rightclick-verification] — if it turns out selection does *not* survive a right-click the way assumed, this is a design-level finding to raise before shipping, not a bug to patch silently.

7. **Docs.** See Documentation Impact below — run after Steps 1-6 are green, per the `document` skill.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/Markdown.md` |

No new files. `packages/lib/src/typescript/MarkdownEditorPanel.ts` (the demo) is unchanged — see Architecture Decisions.

---

## Expected Behaviour

Unit-testable offline (all of Steps 1-5's tests):

- `TRANSFORMERS` contains exactly eleven transformers including `STRIKETHROUGH`; the old exclusion assertion is gone.
- `~~text~~` round-trips through `MarkdownEditor.setValue`/`getValue` unchanged (modulo the existing `normalize` helper).
- `new Markdown('~~s~~')` builds a `<del>` wrapping the text `"s"`.
- `toggleStrikethrough()` is a no-throw no-op with no selection; toggles the strikethrough format on a real selection.
- `clearFormatting()` strips bold/italic/strikethrough/inline-code markers from a selection's exported Markdown, leaving plain text; is a no-throw no-op with no selection; leaves block type untouched.
- `deleteTable()` removes an inserted table's `table` token from the exported Markdown when the caret is in a cell; is a no-throw no-op when it is not.
- `$classifyContextMenuTarget` returns `"table-cell"` for both a populated and an empty cell, `"empty-line"` only for a genuinely empty paragraph outside a table, and `"text"` (with correct `bold`/`italic`/`strikethrough`/`code` flags) otherwise.
- `buildContextMenuItems` returns the exact item shape (count, order, labels, `checked` state, submenu contents) documented in Internal Structure for each of the three `ContextMenuTarget` kinds, and each item's `action` reaches the correct existing command method.

Needs manual browser verification (Step 6 — real `contextmenu` DOM events, real caret/selection placement, and Menu positioning/dismissal are outside what the recording DOM sink can exercise):

- The native browser context menu is suppressed and the framework `Menu` appears at the click point in all three contexts.
- Right-click inside an existing selection preserves it (does not collapse the caret to the click point); right-click outside any selection moves the caret there — the assumption flagged in [^native-rightclick-verification].
- Selecting a menu item correctly applies its command to the text the user actually intended (the selection that was live at the moment of the right-click), not to whatever the selection becomes after the menu itself is clicked.
- The menu dismisses on outside click, Escape, and item activation, matching every other `Menu` instance in the app (inherited `Menu`/`LayerManager` behavior, not new to this plan).

---

## Verification

- `npm run test` (or the project's scoped vitest invocation) — all tests in `markdown-editor.test.ts` and `Markdown.test.ts`, including every new one from Steps 1, 2, 3, and 5.
- `npm run typecheck` (or equivalent) — the new `'lexical'` imports (`IS_ALL_FORMATTING`, `$isTextNode`, `TextFormatType`, `$getNearestNodeFromDOMNode`, `isDOMNode`, `$findMatchingParent`, `$isElementNode`, `$isParagraphNode`) and the new `Menu`/`MenuItemConfig` imports resolve cleanly.
- `npx eslint packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts packages/lib/src/typescript/lib/component/display/Markdown.ts` — in particular the `local/no-raw-dom` rule: `event.target` stays typed `EventTarget | null` throughout (never cast to `Node`/`Element`), matching the same shape `@lexical/table`'s own `$tableClickCommand` uses.
- `grep -n 'not.toContain(STRIKETHROUGH)' packages/lib/tests/component/markdown-editor.test.ts` — expect zero matches (the old exclusion assertion must be gone, not just superseded).
- `npm run docs:api` — zero warnings (per CODE_CONVENTIONS.md's `{@link}` rule) after the new public methods gain JSDoc.
- Manual smoke test per Step 6, against the `MarkdownEditorPanel` demo (`npm run dev`, app at `localhost:8015`).

---

## Documentation Impact

- `packages/lib/docs/components/MarkdownEditor.md`:
  - "Formatting" section ([MarkdownEditor.md:59-65](packages/lib/docs/components/MarkdownEditor.md#L59-L65)) — add a fourth bullet for the right-click context menu, alongside shortcut typing / keyboard shortcuts / command API.
  - "Command API" table ([MarkdownEditor.md:69-79](packages/lib/docs/components/MarkdownEditor.md#L69-L79)) — add rows for `toggleStrikethrough()`, `clearFormatting()`, and `deleteTable()`.
  - "Supported constructs" table and its intro ([MarkdownEditor.md:39-57](packages/lib/docs/components/MarkdownEditor.md#L39-L57)) — add a `Strikethrough | ~~struck~~` row; remove "strikethrough" from the sentence listing what is excluded from the dialect (line 57).
- `packages/lib/docs/components/Markdown.md`:
  - "Supported syntax (v1)" table ([Markdown.md:42-52](packages/lib/docs/components/Markdown.md#L42-L52)) — add a `~~struck~~ | <del>` row.
  - "Fallback for unsupported tokens" ([Markdown.md:105](packages/lib/docs/components/Markdown.md#L105)) — remove "strikethrough" from the list of GFM extensions that still fall through to the plain-text fallback.
- `MarkdownEditor.ts`'s own class doc comment ([MarkdownEditor.ts:328-337](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L328-L337)) — extend "Formatting is driven three ways" to four, and list the three new command methods alongside the existing ones.
- New public methods (`toggleStrikethrough`, `clearFormatting`, `deleteTable`) need full JSDoc (`@returns`, no `{@link}` to non-public symbols) per CODE_CONVENTIONS.md, so `npm run docs:api` stays at zero warnings.

---

## Potential Challenges

- **The native-selection-follow-on-right-click assumption is unverified by this plan.** Investigation confirmed it via `@lexical/table`'s own resolution pattern and standard contenteditable behavior, but could not exercise a real right-click through the available tooling (no synthetic event reproduces trusted native selection/caret behavior). Mitigation: Step 6 checks it first, before relying on it further; if it's wrong, the fix is at the `handleWysiwygContextMenu` level (explicitly move the selection before showing the menu), not a redesign.
- **`$getNearestNodeFromDOMNode` needs a real mounted view.** Getting this wrong (e.g. trying to unit-test it directly) produces a confusing "always resolves to null" failure offline with no error — mitigated by Step 3 testing the pure classification function instead, and Step 4 explicitly calling out that no offline test exists for the DOM-resolution sliver.
- **Menu width with an 8-item table-cell menu and long labels ("Insert column right").** `Menu.layOutColumns()` already clamps to `[MIN_MENU_WIDTH, MAX_MENU_WIDTH]` and ellipsizes; verify visually in Step 6 that nothing looks cramped.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — the component being extended; read in full before starting (already done for this plan).
- [packages/lib/src/typescript/lib/overlay/Menu.ts](packages/lib/src/typescript/lib/overlay/Menu.ts) — the menu component being reused; `show()`, `MenuItemConfig`'s `submenu`/`checked`/`separator` shape.
- [packages/lib/src/typescript/lib/component/table/Table.ts:214,1680-1778](packages/lib/src/typescript/lib/component/table/Table.ts#L214) — the `_columnContextMenu` ownership/disposal/build-on-demand precedent this plan mirrors directly.
- [packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts:305](packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L305) — the closest precedent for wrapping a self-registered `contextmenu` DOM listener into a semantic custom event.
- [packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts) and [packages/lib/src/typescript/lib/component/editor/editorTheme.ts](packages/lib/src/typescript/lib/component/editor/editorTheme.ts) — both need the strikethrough addition.
- [packages/lib/src/typescript/lib/component/display/Markdown.ts:1739-1770](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1739-L1770) — `appendInlineToken`'s switch, needs the `"del"` case.
- [packages/lib/tests/component/markdown-editor.test.ts](packages/lib/tests/component/markdown-editor.test.ts) — existing helpers (`lexicalOf`, `selectInFirstTableCell`, the `CORPUS` map) this plan's new tests reuse.

---

## Non-Goals

- **Link add/edit is not added to the format menu** — needs a new inline URL-prompt UI this plan does not build (see Architecture Decisions).
- **No word-boundary auto-selection on a collapsed right-click** — matches existing toolbar-button behavior; adding it would need `RangeSelection.modify()` and its cross-browser quirks.
- **No checkmark on the current block type** in the block-style/heading submenus — would need a new "what block type is the caret in" helper this plan does not otherwise require.
- **No `getReadOnly()` special-casing** — the menu is available whenever the WYSIWYG surface is shown; its commands already no-op safely when the editor is not editable, the same as the existing toolbar demo's buttons do today.
- **No demo (`MarkdownEditorPanel.ts`) changes** — the menu is self-wired (see Architecture Decisions), so the existing demo already exercises it.
- **No changes to `insertTable`'s fixed 2×3 default** — the empty-line menu's "Table" item calls `insertTable(2, 3)`, matching the existing toolbar demo's own hardcoded call; a dimension picker is out of scope.

---

## Notes

[^table-menu-precedent]: `Table.showColumnMenu`/`showCellMenu` ([Table.ts:1711-1778](packages/lib/src/typescript/lib/component/table/Table.ts#L1711-L1778)) both call `this._columnContextMenu.show(x, y, items)` on the same single field, with a comment explaining why one instance is safe to reuse across different content: "a column-header right-click and a body-cell right-click never happen at once, and `Menu.show()` fully rebuilds its item list on every call, so there is nothing to reset between uses." The same reasoning applies here — the three `MarkdownEditor` contexts are mutually exclusive per right-click.

[^import-path-correction]: The task brief that seeded this investigation stated `$getNearestNodeFromDOMNode` is exported from `'@lexical/utils'`. That is incorrect for the installed version: `@lexical/utils/dist/index.d.ts` re-exports only `$findMatchingParent`, `$getAdjacentSiblingOrParentSiblingCaret`, `$splitNode`, `addClassNamesToElement`, `isBlockDomNode`, `isHTMLAnchorElement`, `isHTMLElement`, `isInlineDomNode`, and `mergeRegister` from `'lexical'` — not `$getNearestNodeFromDOMNode`. `$getNearestNodeFromDOMNode`, `isDOMNode`, `$findMatchingParent`, `$isElementNode`, and `$isParagraphNode` are all exported directly from the top-level `'lexical'` package (confirmed against `node_modules/lexical/dist/index.d.ts`), the same package `MarkdownEditor.ts` already imports `$getSelection`/`$isRangeSelection`/etc. from. All new Lexical imports in this plan go on the existing `'lexical'` import line.

[^native-rightclick-verification]: Investigation attempted to verify this empirically via the Chrome DevTools MCP tools available in this session, but the `click` tool has no right-click/button option, and a script-dispatched synthetic `contextmenu`/`mousedown` event does not reproduce a browser's native selection-adjustment behavior (untrusted events do not drive native text selection — the same reason `feedback_synthetic_click_bypasses_hittest` warns against trusting `dispatchEvent`-based clicks for hit-testing). This is standard, well-established contenteditable/text-field behavior across Chromium, Firefox, and WebKit, but this plan could not confirm it with a real right-click in this session. Step 6 confirms it manually as the first thing checked, since the whole "menu items act on the already-correct selection" design leans on it.

[^word-select-rejected]: An alternative considered: on a collapsed right-click landing inside a word, expand the Lexical selection to that word's boundaries before showing the menu, so "toggle bold" visibly bolds the clicked word rather than only affecting future typing. Rejected for this plan: Lexical has no built-in "select word at point" helper (checked `@lexical/selection`'s full export list), so this would mean hand-rolling boundary detection or using `RangeSelection.modify()`, which wraps the browser's native `Selection.modify()` and is known to have cross-browser word-granularity differences (particularly Firefox vs. Chromium). The task's own phrasing ("right-click on a word or selected text") is read as describing when the format menu appears, not as a request for auto-selection — every menu item already behaves consistently with how the pre-existing toolbar buttons behave on a collapsed selection.

---

## Implementation Notes

**`WysiwygSurface` registers its `contextmenu` listener with `Event.addSubtreeListener`, not `Event.addListener` as Internal Structure's code block specified.** The plan's own prose (Architecture Decisions, *"`WysiwygSurface` exposes its own `"contextmenu"` custom event"*) already names `ParentHeader.ts:305`'s `Event.addSubtreeListener(this, "contextmenu", …)` as "the closest match to this plan's exact registration shape," but the literal code block that followed it specified the exact-target `Event.addListener` variant instead — an internal inconsistency in the plan. `Event.addListener` only fires when a DOM event's `target` is precisely the registered component's own element (`Event.ts`'s `baseListener` looks the target id up directly in `listenerMap`); it does not walk ancestors. Lexical renders every word as a `<span>` (or nested inline element) inside the surface's root `contenteditable` div, so a real right-click on rendered prose almost always targets one of those descendants, never the root element itself — under `Event.addListener`, `handleWysiwygContextMenu` would fire only for a click landing on a pixel with no rendered inline content (e.g. the padding past the last line), and the context menu would appear to simply not work for the overwhelmingly common case of right-clicking on text.

This was caught during Step 6's manual verification, not by the offline test suite: Step 3 and Step 5's tests reach `$classifyContextMenuTarget` and `buildContextMenuItems`/`handleWysiwygContextMenu` directly (bypassing the real DOM `contextmenu` dispatch, as the plan's own Step 4 notes — *"no offline test exists for the DOM-resolution sliver"*), so they could not have caught a registration-shape defect; only a real click through the actual DOM event pipeline could, which is exactly what Step 6 is for. Fixed by switching the registration to `Event.addSubtreeListener` (matching `ParentHeaderCell`'s identical call), re-verified via `npm test` (unaffected — all 6213 tests still pass, since the change is invisible to the offline harness) and via a live browser session (`npm run dev`): right-clicking a word inside prose, an empty line, and a populated table cell now each show the correct menu; clicking "Insert column right" with the caret placed in a cell correctly added a column to the live document.

**The native-selection-follow-on-right-click assumption ([^native-rightclick-verification]) remains unverified.** The Chrome DevTools MCP tools available in this session still had no right-click/button-parameter option on `click`, and no raw CDP mouse-dispatch tool was exposed either, so this session could not send a real trusted right-click any more than the investigation that seeded the plan could. A synthetic `dispatchEvent(new MouseEvent('contextmenu', …))` was used instead to verify everything downstream of that assumption: the menu shows the correct content for all three contexts (word/prose, empty line, table cell — both populated and, implicitly, empty since the classification test suite already covers that), the native browser menu is suppressed (`event.defaultPrevented` was `true` on every dispatch, and no native menu ever appeared), an existing text selection is not disturbed by the framework's own code (`window.getSelection().isCollapsed` was `false` and the selected text unchanged immediately after the synthetic dispatch, since `handleWysiwygContextMenu` only reads the selection, never writes it), and a menu item's `action` correctly reaches the underlying command when the Lexical selection is actually inside the target (verified by placing the DOM selection into a table cell before dispatching, then clicking "Insert column right" and confirming a column was added). What could not be verified is the platform behavior itself — whether a *real* right-click collapses the caret to the click point outside an existing selection, or preserves an existing selection when the click lands inside it. This is exactly the gap the plan's footnote already documented before implementation began; it is a platform-behavior verification gap, not a code defect, and no code in this plan implements or could implement that behavior — it is native `contenteditable` behavior the browser provides for any trusted click.
