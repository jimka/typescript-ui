# MarkdownEditor Insert-Line-Around-Block Menu Items — Implementation Plan

## Overview

`MarkdownEditor`'s right-click context menu ([MarkdownEditor.ts:1476](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1476)) currently offers three flavors depending on what was clicked: a table cell, a genuinely empty top-level paragraph ("empty-line"), or anything else ("text"). This plan adds two new items to the "text" menu — **Insert line before block** and **Insert line after block** — shown only when the click resolves inside a blockquote, a list, or a fenced code block. Clicking a plain paragraph, a heading, or a table cell never shows them.

Each item inserts a genuinely empty paragraph immediately outside the whole enclosing block and moves the caret into it. For a list, "the whole enclosing block" is the entire `ListNode` the clicked item belongs to, not just that item.

The existing Alt+Enter shortcut ([$handleSeparatorShortcut, MarkdownEditor.ts:199](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L199)) already does an "insert after" for a table cell or fenced code block, using its own resolver ([$findEnclosingSeparatorTarget, MarkdownEditor.ts:167](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L167)). This plan leaves both of those completely untouched and adds a second, separate resolver and a pair of new public command-API methods for the menu to call.

Three files change: `MarkdownEditor.ts` (the resolver, the two new methods, the classification, and the menu builder), `markdown-editor.test.ts` (headless tests), and `docs/components/MarkdownEditor.md` (the Command API table and the context-menu description).

---

## Architecture Decisions

### A separate resolver, not a widened `$findEnclosingSeparatorTarget`

Add a new function, `$findEnclosingInsertableBlock`, rather than widening `$findEnclosingSeparatorTarget` to also cover blockquotes and lists. `$findEnclosingSeparatorTarget` keeps returning exactly what it returns today (`TableNode | CodeNode | null`) and `$handleSeparatorShortcut` keeps calling it, unmodified.[^shortcut-scope]

### The Alt+Enter keyboard shortcut is not widened

`$handleSeparatorShortcut` stays scoped to a table cell or fenced code block, insert-after only, exactly as it behaves today. Only the context menu gets the new blockquote/list/code coverage, and only the menu gets "insert before" (which does not exist anywhere today).[^shortcut-scope]

### A list's enclosing block is the nearest `ListNode`, found by one upward walk over all three types together

`$findEnclosingInsertableBlock` walks up from the clicked node once, using `$findMatchingParent` with a single combined predicate that matches a `CodeNode`, a `QuoteNode`, or a `ListNode` — not three separate nearest-of-type lookups tried in a fixed order. For a list item, this resolves to its immediate parent `ListNode` ("two levels up" from the `ListItemNode`) — the whole list the clicked item belongs to, regardless of which item was clicked. For a *nested* list (a list inside a list item), it resolves to the nearest (innermost) enclosing list, not the outermost root list.[^nested-list]

### Two new public methods, not one with a direction flag

Add `insertParagraphBeforeBlock()` and `insertParagraphAfterBlock()` as two zero-argument methods, following the same "every menu item calls a public method" precedent every other item in this menu already follows.[^method-shape]

### `hasEnclosingBlock` is optional on the `"text"` classification

`ContextMenuTarget`'s `"text"` variant gains `hasEnclosingBlock?: boolean` — optional, not required.[^optional-field]

### Round-trip safety

Inserting a genuinely empty paragraph immediately before/after a `QuoteNode`, `ListNode`, or `CodeNode` is the same operation `$handleSeparatorShortcut` already performs for `TableNode`/`CodeNode` today (`target.insertBefore/insertAfter(paragraph)`, an empty paragraph that converts to blank content and reconstructs identically on re-import). Nothing about the target type changes that. The one new edge case this feature can reach more easily than the keyboard shortcut — invoking "insert after" twice in a row on the same still-present block, producing two adjacent empty paragraphs — is accepted as harmless (no typed content is at risk) rather than specially guarded against.[^round-trip-safety]

---

## Public API

```typescript
// MarkdownEditor.ts

class MarkdownEditor extends Component<MarkdownEditorOptions> {
    /** Insert an empty paragraph immediately before the enclosing blockquote/list/code block; no-op without one. */
    insertParagraphBeforeBlock(): this;

    /** Insert an empty paragraph immediately after the enclosing blockquote/list/code block; no-op without one. */
    insertParagraphAfterBlock(): this;
}

// Widened union member (test-support export, not part of the public MarkdownEditor callable):
export type ContextMenuTarget =
    | { kind: "table-cell"; hasSelectedText: boolean; bold: boolean; italic: boolean; strikethrough: boolean; code: boolean }
    | { kind: "empty-line"; hasSelectedText: boolean }
    | {
          kind: "text";
          hasSelectedText: boolean;
          bold: boolean; italic: boolean; strikethrough: boolean; code: boolean;
          hasEnclosingBlock?: boolean;
      };
```

No new construction options, no new events. Both methods follow the existing chainable `this`-returning shape every other command-API method uses.

---

## Internal Structure

### New resolver and shared mutation helper

Insert directly after `$findEnclosingSeparatorTarget` ([MarkdownEditor.ts:177](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L177)), before the `$handleSeparatorShortcut` doc comment ([MarkdownEditor.ts:179](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L179)):

```typescript
/**
 * Finds the blockquote, list, or fenced code block enclosing `node`, if any —
 * the nearest of the three, regardless of nesting order (a list inside a
 * quote resolves to the list; a quote inside a list resolves to the quote).
 * For a list, this is the whole {@link ListNode} the clicked item belongs to
 * — its immediate parent, two levels up from the clicked `ListItemNode` —
 * never just that one item, and never the outermost list when the list is
 * nested inside another list.
 *
 * @remarks
 * Deliberately separate from {@link $findEnclosingSeparatorTarget}: that
 * resolver backs the Alt+Enter keyboard shortcut and stays scoped to a table
 * cell or fenced code block; this one backs the right-click menu's "Insert
 * line before/after block" items and never resolves a table cell (out of
 * scope for this menu — a table cell already gets its own dedicated context
 * and menu).
 *
 * @param node - The node to search upward from (typically a selection anchor
 *   or a right-click's resolved node).
 * @returns The enclosing {@link CodeNode}, {@link QuoteNode}, or
 *   {@link ListNode}, or `null` when `node` sits in none of them.
 */
function $findEnclosingInsertableBlock(node: LexicalNode): CodeNode | QuoteNode | ListNode | null {
    return $findMatchingParent(
        node,
        (n): n is CodeNode | QuoteNode | ListNode => $isCodeNode(n) || $isQuoteNode(n) || $isListNode(n),
    );
}

/**
 * Shared body of {@link MarkdownEditor.insertParagraphBeforeBlock} and
 * {@link MarkdownEditor.insertParagraphAfterBlock}: resolves the block
 * enclosing the caret (see {@link $findEnclosingInsertableBlock}) and inserts
 * an empty paragraph immediately before or after it, moving the caret into
 * the new paragraph. No-op when there is no range selection, or the caret is
 * not inside a blockquote, list, or fenced code block.
 *
 * @param after - Whether to insert after (`true`) or before (`false`) the
 *   enclosing block.
 */
function $insertParagraphAroundEnclosingBlock(after: boolean): void {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return;
    }

    const target = $findEnclosingInsertableBlock(selection.anchor.getNode());

    if (target === null) {
        return;
    }

    const paragraph = $createParagraphNode();

    if (after) {
        target.insertAfter(paragraph);
    } else {
        target.insertBefore(paragraph);
    }

    paragraph.selectStart();
}
```

### Classification: `$classifyContextMenuTarget`

At [MarkdownEditor.ts:397](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L397), the final `return` of the "text" branch gains `hasEnclosingBlock`:

```typescript
    const hasEnclosingBlock = $findEnclosingInsertableBlock(node) !== null;

    return { kind: "text", hasSelectedText, hasEnclosingBlock, ...formatState };
```

### Menu builder: `buildTextContextMenuItems`

At [MarkdownEditor.ts:1545](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1545), convert the returned array literal into a variable and conditionally push two more items, mirroring `Table.showColumnMenu`'s conditional-push style ([Table.ts:1711](packages/lib/src/typescript/lib/component/table/Table.ts#L1711)):

```typescript
private buildTextContextMenuItems(context: ContextMenuTarget & { kind: "text" }): MenuItemConfig[] {
    const items: MenuItemConfig[] = [
        ...this.buildClipboardMenuItems(context.hasSelectedText),
        { separator: true },
        ...this.buildFormatToggleItems(context),
        { separator: true },
        {
            text:    "Block style",
            submenu: {
                label: "Block style",
                items: [
                    { text: "Paragraph", action: () => this.setBlockType("paragraph") },
                    { separator: true },
                    ...this.buildHeadingMenuItems(),
                    { separator: true },
                    { text: "Quote", action: () => this.setBlockType("quote") },
                    { text: "Code block", action: () => this.setBlockType("code") },
                ],
            },
        },
        { separator: true },
        { text: "Clear formatting", action: () => this.clearFormatting() },
    ];

    if (context.hasEnclosingBlock) {
        items.push(
            { separator: true },
            { text: "Insert line before block", action: () => this.insertParagraphBeforeBlock() },
            { text: "Insert line after block", action: () => this.insertParagraphAfterBlock() },
        );
    }

    return items;
}
```

### Command-API methods

Insert directly after `setBlockType()` ([MarkdownEditor.ts:1136-1148](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1136-L1148)), before the `insertTable` doc comment ([MarkdownEditor.ts:1150](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1150)):

```typescript
/**
 * Inserts an empty paragraph immediately before the blockquote, list, or
 * fenced code block enclosing the caret, and moves the caret into it. For a
 * list, this is the whole list, not just the clicked item. No-op without
 * throwing when the caret is not inside one of those three block types.
 *
 * @returns This component, for method chaining.
 */
insertParagraphBeforeBlock(): this {
    this.ensureEditor().update(() => { $insertParagraphAroundEnclosingBlock(false); }, { discrete: true });

    return this;
}

/**
 * Inserts an empty paragraph immediately after the blockquote, list, or
 * fenced code block enclosing the caret, and moves the caret into it. For a
 * list, this is the whole list, not just the clicked item. No-op without
 * throwing when the caret is not inside one of those three block types.
 *
 * @returns This component, for method chaining.
 */
insertParagraphAfterBlock(): this {
    this.ensureEditor().update(() => { $insertParagraphAroundEnclosingBlock(true); }, { discrete: true });

    return this;
}
```

---

## Ordered Implementation Steps

1. **Imports** ([MarkdownEditor.ts:24,26,28](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L24)) — add `QuoteNode, $isQuoteNode` to the `@lexical/rich-text` import, `ListNode, $isListNode` to the `@lexical/list` import, and `$isCodeNode` to the `@lexical/code` import.
   Check: `npx tsc --noEmit` (or the project's typecheck script) has no unresolved-import errors.

2. **Add `$findEnclosingInsertableBlock` and `$insertParagraphAroundEnclosingBlock`** immediately after `$findEnclosingSeparatorTarget` (after line 177), exactly as shown in Internal Structure. Do not touch `$findEnclosingSeparatorTarget` or `$handleSeparatorShortcut` themselves.
   Check: `grep -n 'findEnclosingSeparatorTarget\|handleSeparatorShortcut' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` shows the same two functions, byte-for-byte, as before this step.

3. **Widen `ContextMenuTarget`** ([MarkdownEditor.ts:238-241](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L238-L241)) — add the optional `hasEnclosingBlock?: boolean` field to the `"text"` union member only.

4. **Update `$classifyContextMenuTarget`**'s final return ([MarkdownEditor.ts:397](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L397)) to compute and include `hasEnclosingBlock`, exactly as shown in Internal Structure.

5. **Add the two command-API methods** after `setBlockType()` (after line 1148), exactly as shown in Internal Structure.

6. **Update `buildTextContextMenuItems`** ([MarkdownEditor.ts:1545-1568](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1545-L1568)) to the array-plus-conditional-push form shown in Internal Structure. Leave `buildEmptyLineContextMenuItems` and `buildTableCellContextMenuItems` untouched — neither ever carries `hasEnclosingBlock`.

7. **Update the class-level doc comment**'s command-API list ([MarkdownEditor.ts:601-602](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L601-L602)) — insert `` `insertParagraphBeforeBlock`/`insertParagraphAfterBlock` `` right after `` `insertTable` ``, before `` `insertTableRow`/`deleteTableRow` ``.

8. **Update existing tests that assert `$classifyContextMenuTarget`'s exact output** ([markdown-editor.test.ts:1005-1007,1024-1026](packages/lib/tests/component/markdown-editor.test.ts#L1005-L1007)) — both `toEqual` assertions for ordinary prose must add `hasEnclosingBlock: false`, since the classifier now always includes that key for a `"text"` result.
   Check: these two tests are the *only* required edits to pre-existing tests — every hand-built `{ kind: 'text', ... }` fixture elsewhere in the file (lines 1239, 1253, 1268, 1288, 1303, 1383-1384, 1458) compiles and behaves unchanged because the field is optional and reads as falsy when absent.

9. **Add new tests** per Expected Behaviour below: classification cases (quote/list/nested-list/code → `hasEnclosingBlock: true`; plain paragraph/heading → `false`), menu-item-count and wiring cases, the command methods' effect on the document tree (including the whole-list and nested-list cases), the double-invocation edge case, and one round-trip case. Add a `.insertParagraphBeforeBlock().insertParagraphAfterBlock()` call to the existing "all commands no-throw" chain ([markdown-editor.test.ts:283-299](packages/lib/tests/component/markdown-editor.test.ts#L283-L299)).

10. **Update `docs/components/MarkdownEditor.md`**:
    - Command API table ([MarkdownEditor.md:71-83](packages/lib/docs/components/MarkdownEditor.md#L71-L83)): add a row for the two new methods.
    - The no-op sentence ([MarkdownEditor.md:85](packages/lib/docs/components/MarkdownEditor.md#L85)): add a clause noting the new pair no-ops outside a blockquote/list/fenced code block.
    - The "Right-click context menu" bullet ([MarkdownEditor.md:67](packages/lib/docs/components/MarkdownEditor.md#L67)): add a sentence describing the two new items and when they appear.

11. **Typecheck and test.** Run the project's typecheck and `packages/lib/tests/component/markdown-editor.test.ts`; then `npm run docs:api` and confirm zero warnings (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s `{@link}`-to-excluded-symbol rule — neither new public method's JSDoc links `$findEnclosingInsertableBlock` or `$insertParagraphAroundEnclosingBlock` by name).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |

`packages/lib/llms.txt`'s one-line MarkdownEditor entry is a generic capability description and needs no change.

---

## Expected Behaviour

Classification rule (all headless-testable via `$classifyContextMenuTarget`, mirroring the existing describe block at [markdown-editor.test.ts:992](packages/lib/tests/component/markdown-editor.test.ts#L992)):

| Click location | `kind` | `hasEnclosingBlock` | New menu items shown? |
|---|---|---|---|
| Plain paragraph text | `text` | `false` | No |
| Heading text | `text` | `false` | No |
| Anywhere in a table cell | `table-cell` | (field not present) | No |
| Text inside a blockquote | `text` | `true` | Yes |
| Text inside any item of a (non-nested) list | `text` | `true`, same `ListNode` regardless of which item | Yes |
| Text inside a nested list's inner item | `text` | `true`, resolves to the **inner** list | Yes |
| Text inside a fenced code block | `text` | `true` | Yes |
| A genuinely empty top-level paragraph | `empty-line` | (field not present — different kind) | No |

Behaviours to pin, each headless-testable unless marked otherwise:

1. `buildTextContextMenuItems` with `hasEnclosingBlock: true` returns 15 entries: the existing 12 (Cut/Copy/Paste, separator, 4 format rows, separator, Block style, separator, Clear formatting) plus a separator and the two new items, in that order. With `hasEnclosingBlock` omitted or `false`, the existing 12-entry behavior is unchanged.
2. Both new items' `action` reaches `MarkdownEditor.insertParagraphBeforeBlock`/`insertParagraphAfterBlock` respectively (same "reaches the command" style as [markdown-editor.test.ts:1282](packages/lib/tests/component/markdown-editor.test.ts#L1282)).
3. `insertParagraphAfterBlock()` with the caret inside a blockquote inserts a new `paragraph` root child immediately after the `quote` child, and the caret moves into it — same `childTypes`/`caretIsInAParagraph` helpers as the Alt+Enter describe block ([markdown-editor.test.ts:1102-1120](packages/lib/tests/component/markdown-editor.test.ts#L1102-L1120)).
4. `insertParagraphBeforeBlock()` with the caret inside a blockquote inserts the new paragraph immediately *before* the quote (the case Alt+Enter has never supported, for any block type).
5. Both methods behave the same way for a fenced code block and for a list — for a list, `childTypes` shows exactly one `list` child before and after (never split into two lists), with the new paragraph immediately before/after that single list, regardless of which list item the resolving selection was in.
6. For a nested list (a list inside a list item), `insertParagraphAfterBlock()` inserts the new paragraph as a sibling of the **inner** list, inside the outer item — not after the outer list.
7. Both methods no-op without throwing when the caret is in a plain paragraph, a heading, or a table cell (no enclosing blockquote/list/code).
8. Calling `insertParagraphAfterBlock()` twice in a row with the caret still resolving to the same block inserts two adjacent empty paragraphs between the block and whatever followed it — both survive; this is expected, not a bug.
9. Round-trip: after `insertParagraphAfterBlock()` on a document containing a blockquote (or list, or fenced code), `getValue()` fed into a fresh `MarkdownEditor.setValue()` reproduces the same child-type sequence — mirroring the `normalize`/fixpoint pattern in the "MarkdownEditor value round-trip (idempotence)" describe block ([markdown-editor.test.ts:579-596](packages/lib/tests/component/markdown-editor.test.ts#L579-L596)).
10. Regression, headless: dispatching `KEY_ENTER_COMMAND` with `altKey: true` (the `dispatchEnter` helper, [markdown-editor.test.ts:1134](packages/lib/tests/component/markdown-editor.test.ts#L1134)) with the caret inside a blockquote or list still returns `handled === true` via Lexical's own native paragraph-insertion (not `$handleSeparatorShortcut`, which returns `false` for these node types) — confirming the shortcut was not widened.

**Manual-verify only** (needs a real DOM and a mounted Lexical view, which the recording-sink harness cannot provide — `mountView` returns `null` offline, per the test file's header comment at [markdown-editor.test.ts:38-43](packages/lib/tests/component/markdown-editor.test.ts#L38-L43)):

- A real right-click (native `contextmenu` event) inside a rendered blockquote, list, or fenced code block shows both new items; a right-click on a plain paragraph, heading, or table cell does not.
- Clicking either new item visually inserts a blank line and moves the blinking caret into it, in the correct position (before/after the block).
- Right-clicking different items within the same list all produce the identical menu (same block resolved), and choosing either item always lands the new line outside the *whole* list, not next to just the clicked item.

---

## Verification

- Typecheck: the project's TypeScript check passes with no new errors.
- `packages/lib/tests/component/markdown-editor.test.ts` passes, including the new and updated cases above.
- `npm run docs:api` finishes with zero warnings.
- Manual smoke test in the app (`npm run dev`, then the `MarkdownEditorPanel` demo at `packages/lib/src/typescript/MarkdownEditorPanel.ts`): right-click inside a blockquote, a list, and a fenced code block; confirm the two new items appear and behave as described; right-click a paragraph, a heading, and a table cell and confirm they do not appear.

---

## Documentation Impact

- `packages/lib/docs/components/MarkdownEditor.md`: Command API table gets a new row; the no-op sentence gets a clause; the "Right-click context menu" bullet gets a sentence. See Ordered Implementation Steps §10 for exact locations.
- `ContextMenuTarget` is not re-exported from `packages/lib/src/typescript/lib/component/editor/index.ts` (confirmed: no match for `ContextMenuTarget`/`$classifyContextMenuTarget` in that barrel), so it is excluded from the TypeDoc API reference the same way it is today — widening it needs no `docs:api` update.
- The two new methods are plain public `MarkdownEditor` members with JSDoc; `npm run docs:api` picks them up automatically once the class doc comment and method comments are in place.

---

## Potential Challenges

- **Fixed-priority resolver order would silently misresolve a nested quote-in-list or list-in-quote.** Mitigated by using one `$findMatchingParent` call with a combined predicate (nearest match wins regardless of type) instead of three sequential single-type lookups.
- **A required `hasEnclosingBlock` field would break ~8 pre-existing hand-built test fixtures.** Mitigated by making the field optional (see Architecture Decisions).
- **Public JSDoc must not `{@link}` the two new internal `$`-prefixed functions.** Both public method doc comments describe behavior in prose only; the internal functions' own doc comments may freely link back to the public methods.

---

## Critical Files

- [MarkdownEditor.ts:167-224](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L167-L224) — `$findEnclosingSeparatorTarget` / `$handleSeparatorShortcut`, the precedent this plan generalizes the *shape* of but not the code of.
- [MarkdownEditor.ts:1476-1637](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1476-L1637) — `buildContextMenuItems` and its three per-kind builders.
- [Table.ts:1711-1762](packages/lib/src/typescript/lib/component/table/Table.ts#L1711-L1762) — `showColumnMenu`'s conditional-push `MenuItemConfig[]` style, mirrored in step 6.
- [markdown-editor.test.ts:992-1406](packages/lib/tests/component/markdown-editor.test.ts#L992-L1406) — the classification and context-menu test blocks whose patterns (`contextMenuMethodsOf`, `dispatchEnter`, `childTypes`, `normalize`/fixpoint) the new tests must reuse.
- `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` — confirms `QuoteNode`, `ListNode`, `ListItemNode`, and `CodeNode` are already registered on every editor; no change needed there.
- `packages/lib/docs/components/MarkdownEditor.md` — the doc page this plan updates.

---

## Non-Goals

- Table cells: no insert-before/after items, this round (explicit user decision).
- Per-list-item "insert a new item": not added (explicit user decision — only escaping the whole list is in scope).
- Widening the Alt+Enter keyboard shortcut to cover blockquotes/lists: out of scope this round.
- Climbing to the outermost list for a nested list (matching Lexical's own native empty-list-item Enter-exit behavior, which uses the topmost list): out of scope — resolution always stops at the nearest enclosing list.
- Guarding against two consecutive "insert after" invocations producing two adjacent empty paragraphs: accepted, not fixed.

---

## Notes

[^shortcut-scope]: Investigation into Lexical's own native Enter handling found that a plain Enter already does most of what the "after" direction would add for these two block types, independent of anything this codebase built: `QuoteNode.insertNewAfter` (in `@lexical/rich-text`'s `index.ts`) unconditionally creates a new paragraph after the quote and moves any caret-forward content into it, whenever Enter is pressed anywhere inside a blockquote's text. `$handleListInsertParagraph` (in `@lexical/list`'s `formatList.ts`, registered against `INSERT_PARAGRAPH_COMMAND` at `COMMAND_PRIORITY_LOW`) already exits the whole list (via `$getTopListNode`) into a new paragraph when Enter is pressed on an empty list item. Neither of those provides "insert before" — nothing does, for any block type, today — but the "after" direction the keyboard shortcut would add is already reachable natively for both blockquote and list, at least from certain caret positions. Combined with `$handleSeparatorShortcut`'s own doc comment already stating its rationale is specific to a table/code click having "nowhere to land" (which does not apply to a quote or list, where ordinary flow text is already there to click), this is enough evidence that widening the shortcut adds a keyboard path with no problem left to solve, while the menu's value is independent: it works from any click point inside the block (not just a caret positioned at the exact spot the native gesture needs) and it is the only way to get "insert before" at all. Given that, the lowest-risk shape is two resolvers that never touch each other's call sites: `$findEnclosingSeparatorTarget`/`$handleSeparatorShortcut` stay exactly as shipped, and the menu gets its own `$findEnclosingInsertableBlock`, at the cost of both functions separately resolving the nearest enclosing `CodeNode` (via different Lexical APIs — `$getNearestNodeOfType` there, `$findMatchingParent`'s combined predicate here). Sharing one widened resolver was considered and rejected: both callers would still need to filter the union down to their own subset (the shortcut to table/code, the menu to quote/list/code), so nothing is saved except that one overlapping check, at the cost of coupling two call sites that this decision deliberately keeps independent — a future change to one path could not accidentally widen the other's behavior by touching a shared function.

[^nested-list]: `$getNearestNodeOfType(node, ListNode)` (the same style of call `$findEnclosingSeparatorTarget` already uses for `CodeNode`) finds the nearest `ListNode` ancestor of the clicked node — structurally, that is exactly "the clicked `ListItemNode`'s own parent," i.e., two levels up, matching the plan's brief. But when the surrounding block hierarchy mixes types (a list inside a quote, a quote inside a list), checking `CodeNode`, then `QuoteNode`, then `ListNode` in that fixed order can return the *wrong* one: e.g. a blockquote containing a list, clicked inside a list item — the fixed-order check would find the outer `QuoteNode` via its own nearest-of-type lookup before ever checking for a nearer `ListNode`, even though the list is structurally closer to the click. `$findMatchingParent` with one combined predicate (`$isCodeNode(n) || $isQuoteNode(n) || $isListNode(n)`) walks the ancestor chain once and returns on the first match at any level, so the nearest one wins regardless of which of the three types it is. For a *nested list specifically* (list inside a list item, no other type involved), this also means resolution stops at the inner list — deliberately different from Lexical's own native double-Enter list-exit (`$handleListInsertParagraph` climbs to `$getTopListNode`, the outermost list). This plan follows the brief's literal "two levels up" description (the nearest list) rather than matching Lexical's native outermost-list behavior; if a future request wants outermost-list semantics instead, that is a one-line change (swap `$isListNode` matching for a `$getTopListNode` climb) but is out of scope here since it was not asked for.

[^method-shape]: `insertTableRow(after: boolean = true)` / `insertTableColumn(after: boolean = true)` establish a "one method, boolean direction flag" shape elsewhere in this same command API, and it was considered here as `insertParagraphAroundBlock(after: boolean = true)`. Two zero-argument methods were chosen instead because every caller of this new pair — both new menu items, and any toolbar button a consumer wires — always wants a fixed, non-parameterized action (never a runtime-computed direction), matching the `toggleBold()`/`toggleItalic()`/`toggleStrikethrough()`/`toggleInlineCode()` shape (separate methods per fixed action) at least as closely as the row/column shape. It is also the naming the feature request itself suggested, and it reads as a natural one-to-one pair with the two menu item labels.

[^optional-field]: `packages/lib/tests/component/markdown-editor.test.ts` has eight sites that construct a `{ kind: 'text', ... }` (or spread `...SOME_FORMATS`) object literal by hand to feed directly into `buildContextMenuItems`, without going through `$classifyContextMenuTarget` (lines 1239, 1253, 1268, 1288, 1303, 1383, 1384, 1458). None of them exercises this feature. A required `hasEnclosingBlock: boolean` field would fail TypeScript compilation at all eight until each one is edited to add `hasEnclosingBlock: false` — churn with no connection to what those tests are actually checking. Declaring the field optional keeps every one of them compiling unchanged, and reading `context.hasEnclosingBlock` (undefined when absent) as falsy gives exactly the right default: a hand-built fixture that does not mention the field behaves as "no enclosing block," which is what every one of those eight tests actually wants. The two tests that assert `$classifyContextMenuTarget`'s exact output via `toEqual` (lines 1005-1007, 1024-1026) still need updating regardless of the field's optionality, because the classifier's real return value gains the key at runtime — `toEqual` fails on the extra key either way. Only those two require an edit; see Ordered Implementation Steps §8.

[^round-trip-safety]: `$handleSeparatorShortcut` already ships `target.insertAfter($createParagraphNode())` for `TableNode`/`CodeNode`, and the resulting empty paragraph round-trips safely today (it converts to blank content and reconstructs as an empty paragraph on re-import — the same mechanism the `"empty-line"` classification already depends on). `QuoteNode.insertBefore`/`insertAfter` and `ListNode.insertBefore`/`insertAfter` are the same base `LexicalNode` methods, inserting a sibling in the same parent — there is nothing type-specific in the insertion itself that would behave differently for a blockquote or a list than it does today for a table or code block. The one scenario this feature can reach more easily than the keyboard shortcut is invoking "insert after" twice against the same block without an intervening edit (two right-clicks are trivial; the shortcut requires the caret to still be inside the block, which the first invocation already moved it out of) — producing two adjacent empty paragraphs. Both are genuinely empty (no typed content at risk), so this is accepted as a harmless, low-severity quirk rather than something to special-case away.
