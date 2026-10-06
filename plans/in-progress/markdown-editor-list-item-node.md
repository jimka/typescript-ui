---
depends-on: [markdown-editor-list-item-block-paste]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor List Item Node — Implementation Plan

## Overview

`MarkdownEditor`'s WYSIWYG lists are built from `@lexical/list`'s `ListNode`
and `ListItemNode`. Lexical's list item holds a line of text and, at most, a
nested list. The branch this plan builds on
(`markdown-editor-list-item-block-paste`) made a list item hold blocks: a
second paragraph, a heading, a table, a quote, nested lists in any order.
Lexical's list code does not know that shape. It merges, drops or flattens an
item's blocks, and the branch put a listener in front of each command that
did so. Seven review rounds each found another command.

This plan gives the editor two node classes of its own and takes the
listeners out:

- `MarkdownListItemNode` — a list item. It holds blocks only. A nested list
  is one of its blocks.
- `MarkdownListItemTextNode` — the text a list item opens with. It is a
  paragraph that passes Lexical's questions on to its item.

Both live in a new file,
`packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts`.
The importer
([markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts)),
the serializer
([markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts)),
the writable-state rules
([markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts))
and the editor
([MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts))
change to the new shape. Sixteen functions and types the branch added for
those listeners are deleted. One paste handler is added, for the one case
no node class can cover. The saved Markdown of every pinned row stays the
same, except eleven rows listed under *Results that change*.

The plan is written against `95e2c850a`, the tip of
`feature/markdown-editor-list-item-block-paste` before its restack. Line
numbers are from that commit; find each site by its symbol name first. The
whole design was run as a prototype before this plan was
written.[^prototype]

---

## Root Cause

Four defects are known on the branch and not fixed there:

1. Lexical merges two nested lists when the item between them goes, and
   drops the blocks after the second list.
2. A nested list that an edit builds from a raw block of an item loses the
   item's text when one of its items is moved out.
3. Blocks pasted into a paragraph, heading or quote that a list item holds
   go in as text on one line (`cP1P2d`).
4. The list-edit fuzz's 82 records of the same kind, with pasted lists.

Lexical's list item shape differs from a regular tree in three ways. Each
one is behind a group of the branch's defects.

| What is irregular today | Example (`li` = `ListItemNode`) | What goes wrong |
|---|---|---|
| A nested list lives in a second item node whose first child is the list | `- a\n  - b\n\n  c` is `li("a")`, `li(list(li("b")), paragraph("c"))` | Lexical removes or merges that second node with the blocks it holds (known defects 1 and 2). An item that comes to open with a list is read as part of the item before it. |
| An item's text is loose inline nodes; its other blocks are block nodes beside them | `- a\n\n  p` is `li("a", paragraph("p"))` | Lexical treats the item as one line of text: Enter merges `p` into the new item, a block type moves `p` into the heading, typing over `a` lands in `p`. |
| An item's blocks stand in a container that is neither the root nor a shadow root | the paragraph `p` above | Lexical pastes blocks there as one line of text (known defects 3 and 4). |

A *shadow root* is Lexical's name for a container it treats as a small
document of its own, such as a table cell.

The first two go away when the tree is regular. The third does not: it is
decided inside Lexical's paste routine by the pasted-into block alone. See
*One paste handler stays*.

---

## Architecture Decisions

### A list item holds blocks only — its text is a node of its own

An item's children are blocks. When the item opens with text, its first
child is a `MarkdownListItemTextNode` holding that text (and the task marker
`[ ] `, as a source node, when there is one). Every later child is an
ordinary block: `ParagraphNode`, `HeadingNode`, `QuoteNode`, `CodeNode`,
`TableNode`, `MarkdownBlockNode`, `MarkdownRawBlockNode` or a nested
`ListNode`. No item node continues another.[^why-regular]

| Source | Today | After (`item` = `MarkdownListItemNode`, `text` = `MarkdownListItemTextNode`) |
|---|---|---|
| `- a` | `li("a")` | `item(text("a"))` |
| `- a\n\n  p` | `li("a", paragraph("p"))` | `item(text("a"), paragraph("p"))` |
| `- a\n  - b\n\n  c` | `li("a")`, `li(list(li("b")), paragraph("c"))` | `item(text("a"), list(item(text("b"))), paragraph("c"))` |
| `- a\n  - b\n\n  c\n\n  * d` | `li("a")`, `li(list(…), paragraph("c"))`, `li(list(…))` | `item(text("a"), list(…), paragraph("c"), list(…))` |
| `- # Foo` | `li(heading("Foo"))` | `item(heading("Foo"))` |
| `- - a` | `li()`, `li(list(li("a")))` | `item(list(item(text("a"))))` |
| `-` | `li()` | `item(text())` |
| `- [ ] t` | `li("[ ] ", "t")` | `item(text("[ ] ", "t"))` |

Markdown reads a list item as a container of blocks, tight or loose alike,
so every item Markdown can write has exactly one such tree. Looseness stays
a state of the list (`listLooseState`), as today.

### The normal form, and the two rules that keep it

After every update an item is in this form:

1. Every child is a block.
2. A `MarkdownListItemTextNode` stands only as the first child of an item.
3. A first child that is a plain paragraph is the item's text.
4. An item has at least one child.
5. A text node holding nothing is not followed by a block, except by a
   nested list.[^empty-text]

`$keepItemShape` and `$keepItemTextInPlace` in `markdownWritable.ts` bring
any tree into that form. They mirror the existing rules there
(`$keepColumnInFence`, `$keepBlocksOutOfText`), which do the same for other
shapes.

| Left by an edit or by Lexical | Brought to |
|---|---|
| `item("x")` (inline nodes straight in the item) | `item(text("x"))` |
| `item()` | `item(text())` |
| `item(paragraph("p"), table)` | `item(text("p"), table)` |
| `item(text(), paragraph("p"))` | `item(text("p"))` |
| `item(text(), list(…))` | unchanged: the empty text is where the caret sits to type the item's text |
| `paragraph("a")`, `text("b")` outside any item | `paragraph("a")`, `paragraph("b")` |

### The item replaces `ListItemNode` through Lexical's node replacement

`editorNodes.ts` registers `MarkdownListItemNode` and the entry
`{ replace: ListItemNode, with: …, withKlass: MarkdownListItemNode }`, so
every item `@lexical/list` creates is the editor's class. `ListNode` stays
Lexical's. `MarkdownListItemNode` extends `ListItemNode`, so every
`$isListItemNode` check in Lexical and in the editor keeps
holding.[^replacement]

The subclass pattern mirrors
[markdownReferenceLinkNode.ts:52](../packages/lib/src/typescript/lib/component/editor/markdownReferenceLinkNode.ts#L52)
(`ReferenceLinkNode extends LinkNode`) and
[markdownSourceNodes.ts:32](../packages/lib/src/typescript/lib/component/editor/markdownSourceNodes.ts#L32)
(`MarkdownSourceTextNode extends TextNode`): static `getType`, `clone` and
`importJSON`, a type name starting with `markdown-`. The block-container
overrides mirror `MarkdownColumnNode`
([markdownBlockNode.ts:37](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L37)).
Node replacement itself is new to this codebase; nothing else can make
`@lexical/list`'s own `$createListItemNode()` calls build the editor's
class.

### The item's text is a `ParagraphNode` subclass with its own type

`MarkdownListItemTextNode extends ParagraphNode`. It is registered beside
`ParagraphNode`, not in place of it. Lexical asks the block the caret is in
what to do on Enter, Backspace, indent, a block type change and a paste. In
a regular tree that block is the item's text, not the item. A class of the
editor's own there is what lets those questions reach the
item.[^why-text-node]

### The item is not a shadow root

`MarkdownListItemNode.isShadowRoot()` stays `false`. A shadow root would
make Lexical paste blocks into an item's blocks without a handler, but it
also stops every join and range removal across items.[^no-shadow-root]

### An item's text stands for its item

An edit of the text node is an edit of the item. An edit of any other block
of the item is an ordinary edit of a block inside a container.

| Edit | In the item's text | In another block of the item |
|---|---|---|
| Enter | the item is split | the block is split; both halves stay in the item |
| Backspace at the block's start | the item moves out one level, or leaves the list | the block joins the block before it |
| a block type | the item leaves its lists, then takes the type | the block takes the type in place |
| indent, outdent | the item moves | unchanged: Lexical's own indent of that block, which no key of the editor reaches |
| a paste of blocks | the list is split around the pasted blocks, as today | the block is split; the pasted blocks become blocks of the item |

### What each edit does, where it is decided, and what it replaces

"Hook" means a method Lexical itself calls on the node. Each rule is pinned
by the rows named in *Expected Behaviour*.

| Edit | Rule | Decided in | Replaces |
|---|---|---|---|
| Enter in an item's text | The item is split at the caret. The text after the caret and every block after the text go to a new item after it. | `MarkdownListItemTextNode.insertNewAfter` (hook) | `registerItemTextEdits` (Enter arm), `ListItemNode.insertNewAfter` |
| Enter at the end of an item's text | The same rule: the new item takes the blocks. Its empty text is then dropped by normal-form rule 5, so the first of those blocks reads as its text. | hook + `$keepItemTextInPlace` | `$keepOpeningParagraphAsText` |
| Enter in an item holding nothing but empty or blank text | A nested item moves out one level. A top-level item becomes an empty paragraph, the list split around it. | `insertNewAfter` (hook) | `$handleListInsertParagraph` (through `registerList`) |
| Enter in another block of an item | Lexical's own: a new block after it, in the item. | Lexical | — |
| Backspace at the start of an item (`KEY_BACKSPACE_COMMAND`) | A nested item moves out one level (`$outdentItem`). A top-level item leaves the list (`$liftItemOut`). | `MarkdownListItemNode.collapseAtStart` (hook, called by `registerList`'s own listener) | `$backspaceOutdentsNestedItem`, `ListItemNode.collapseAtStart` |
| Backspace at the start of another block of an item | Lexical's own join: the block's text joins the block before it. | Lexical | — (a recorded defect: the key did nothing) |
| A join that takes an item's text away (Delete at the end of the block before it, a range that ends in its text, `DELETE_CHARACTER_COMMAND` at its start) | The text joins the block before it, as any text does. What the item held after its text moves to the end of the item before it. For a list's first item, the blocks up to its first nested list move to before the list, and the rest stays in the list, in an item. | `MarkdownListItemTextNode.remove` (hook) | `ListItemNode.remove` and `mergeLists` (known defect 1), part of `$keepBlocksOutOfText`'s work |
| Typing or pasting over all of an item's text | The text node stays and takes what is typed. | Lexical, on the regular tree | `registerItemTextEdits` (typing and paste arms) |
| Deleting all of an item's text | Normal-form rule 5: before a block other than a nested list, the emptied text is dropped and that block reads as the text. | `$keepItemTextInPlace` | `$keepOpeningParagraphAsText` |
| Outdent | The item moves out to follow the outer item. The items after it in the nested list, and the outer item's blocks after that list, move into it, so the document reads in the same order. | `$outdentItem`, through `setIndent` (hook) on the item and on its text | `$outdentItemKeepingBlocks`, `$outdentKeepingItemBlocks`, `$handleOutdent` (known defect 2) |
| Indent | The item becomes the last item of a nested list at the end of the item before it, with everything it holds. A list's first item is wrapped in an empty item, as Lexical does. | `$indentItem`, through `setIndent` (hook) | `$handleIndent` |
| A block type or the list toggle set on an item's text | The item leaves its lists (`$liftItemOut`); its text takes the type; the blocks up to its first nested list follow it; the nested list and the rest stay in the list, in an item. | `MarkdownListItemTextNode.replace` (hook, called by `$setBlocksType`) | `$prepareBlockForType`, `ListItemNode.replace`, the item slice in `$copyBlockAsCodeSource` |
| A block type set on another block of an item | Lexical's own: the block changes in place. | Lexical | — |
| A list kind toggled with the caret in an item's text | Lexical's own `$insertList`: the nearest list changes kind. With the caret in an empty text, the editor converts that list itself. | `$insertList`; `$convertListOfEmptyItem` in `MarkdownEditor.ts` | — |
| Blocks pasted at an item's text | Lexical's own insert. The first pasted block's text joins the text; the others go after the item's list, the list split there; the text after the caret joins the last pasted block. | Lexical, through the text node's `isParentRequired`, `insertNewAfter`, `insertAfter` and `remove` hooks | `registerItemTextEdits` (paste arms), `registerCopiedItemParagraphs` |
| Blocks pasted into a paragraph, heading or quote that an item holds | The block is split at the caret and the pasted blocks become blocks of the item between the halves. | `$pasteBlocksIntoItemBlock` (a paste handler) | nothing: this is the fix of known defects 3 and 4 |
| A copied list pasted | Lexical's parse builds each item with the item's own `append`, which keeps blocks as blocks. | `MarkdownListItemNode.append` | `$parseKeepingItemParagraphs`, `registerCopiedItemParagraphs`, the `splice` warning in the importer |
| Everything an item holds deleted | The block the range started in stays, emptied: an empty item. | Lexical, on the regular tree | most routes to `$keepNoListWithoutItem` |
| Looseness | Unchanged: `$keepLoosenessWritable` sets the list's state to what its save reads. | `markdownWritable.ts` | — |
| Task marker | Unchanged: a source node at the start of the item's text. | importer, serializer | — |

Two of these results are choices the user has not signed off yet. They are
kept exactly as the branch has them.[^unsigned]

### One paste handler stays: blocks pasted into a block that an item holds

A node is *parent-required* when it says it needs a parent of a certain
kind (`isParentRequired()`), as a list item needs a list.
`RangeSelection.insertNodes` flattens pasted blocks to one line of text when
the caret's block is not parent-required and its parent is neither the
root nor a shadow root
([Lexical.dev.mjs:9458](../node_modules/lexical/dist/Lexical.dev.mjs#L9458),
its "case 3c"). A paragraph, heading or quote in a list item is such a
block. Those are Lexical's own classes, so no node of the editor's can
answer for them.[^case-3c]

`$pasteBlocksIntoItemBlock` is a
`SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` listener, the seam
`$pasteColumnsAsTheirBlocks`
([MarkdownEditor.ts:1251](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1251))
and `$pasteIntoTextOnlyBlock`
([MarkdownEditor.ts:1181](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1181))
already use. It does what Lexical's insert does at the top level: split the
block at the caret, join the first pasted block's text to the first half,
put the other blocks after it, join the second half to the last pasted
block.

### What is deleted and what stays

**Deleted.** After step 3 none of these names is left in `src/`.

| Symbol | File | Why it can go |
|---|---|---|
| `registerItemTextEdits`, `ItemTextEdit`, `$itemWhoseTextHolds`, `$itemWhoseTextIsSelected`, `$removeRangeEndingInItemText`, `$putBlocksAfterCaret` | `MarkdownEditor.ts` | Enter, typing and paste at an item's text are decided by the text node's hooks |
| `registerCopiedItemParagraphs`, `copiedNodesHoldingItemParagraphs`, `holdsItemParagraph` | `MarkdownEditor.ts` | the item's `append` keeps blocks, so Lexical's parse builds the copy as it was |
| `$backspaceOutdentsNestedItem`, `$outdentKeepingItemBlocks` and their two `registerCommand` lines | `MarkdownEditor.ts` | `collapseAtStart` and `setIndent` |
| `$prepareBlockForType` | `MarkdownEditor.ts` | the text node's `replace` |
| `$parseKeepingItemParagraphs` | `markdownWritable.ts` | callers use Lexical's `$parseSerializedNode` |
| `$outdentItemKeepingBlocks` | `markdownWritable.ts` | `$outdentItem` |
| `$keepOpeningParagraphAsText` | `markdownWritable.ts` | `$keepItemShape`, `$keepItemTextInPlace` |
| `$continuesItemBefore` | `markdownSerializer.ts` | no item node continues another |

**Kept**, each with its reason. "Rule 1" and "rule 2" are the branch's
names: a raw block stands in a list item only when it reads the same there
as on its own, and no block stays inside a block that holds text only.

| Symbol | Reason | Change |
|---|---|---|
| `$copyBlockAsCodeSource` | `$setBlocksType`'s hook for a conversion to a code block; it predates the branch | back to the body it had before the branch (see *Implementation*) |
| `$keepNoListWithoutItem`, `$replaceEmptiedContainerAtCaret` | rules about a list, not an item: a removal can still take every item of a list | none |
| `$keepBlocksOutOfText`, `$moveBlocksOutAfter`, `$takeBlocksOutOf` | rule 2 of the branch is about text blocks; rows K15 to K20 pin it; a code block and a raw block use it | `$moveBlocksOutAfter` inserts with `splice` |
| `$showColumnRawBlocksAsWritten`, `$readListAgainAroundRawBlock`, `rawBlockStandsInItem` | rule 1 of the branch and the column rule, about raw blocks | none |
| `$showItemRawBlocksAsWritten` | a raw block of an item still needs the check | loses its walk back through continuing items |
| `$pastedText`, `$cellLines`, `$keepCellParagraphs` | a list pasted into a code block, raw block or table cell | none |
| `$keepLoosenessWritable`, `$keepLoosenessOfItemHolding`, `$keepLoosenessAfterTyping`, `$normalizeList`, `$joinLists`, `$numberListItems`, `$keepNumbersWritable` | looseness, joining and numbering are rules about `ListNode`, which stays Lexical's | the continuing-item cases go; one condition changes |
| `registerList(editor)` | its Backspace listener is what calls `collapseAtStart`; its two insert-list listeners call `$insertList` | none[^register-list] |

### Type names, JSON and the clipboard

| Node | Type name |
|---|---|
| `MarkdownListItemNode` | `markdown-list-item` |
| `MarkdownListItemTextNode` | `markdown-list-item-text` |

Neither class overrides `exportJSON`: the inherited one writes the node's
own type. A copied nested item exports its depth as `indent`;
`updateFromJSON` then calls `setIndent` on a node that is in no list yet, so
both `setIndent` overrides do nothing for a node without a parent.

No payload copied before this change can reach the new classes, and none
needs converting.[^type-name]

### HTML: `importDOM` keeps a nested list in its item; `exportDOM` is inherited

`MarkdownListItemNode.importDOM` declares `ol` and `ul` again at priority 1.
Each calls `ListNode`'s own conversion and replaces its `after` step, which
moves a nested list out of its `<li>` into an item node of its own (the
shape this plan removes). The DOM element is passed through and never
named or read, which the `local/no-raw-dom` rule allows.[^html]

`exportDOM` is not overridden. An item exports `<li>` holding `<p>` and
`<ul>`, the ordinary HTML of a list.

### One CSS rule keeps a tight list tight

The item's text now renders as a `<p>` inside the `<li>`. `editorTheme.ts`
gets one rule, `.ts-ui-mde-list > li > p:first-child { margin: 0 }`, beside
the existing `.ts-ui-mde-table-cell > p` rule
([editorTheme.ts:198](../packages/lib/src/typescript/lib/component/editor/editorTheme.ts#L198)),
which resets a paragraph's margin for the same reason. The text then stands
where the bare text stood, and a later paragraph keeps its margin as today.

### Results that change

Every other pinned `saved` string stays as it is. Each row below was run on
the prototype.

| Row | Edit | Today | After | Reason |
|---|---|---|---|---|
| K3 | `DELETE_CHARACTER` backward at the start of an item; the item before ends in a quote | `- a\n\n  > q0\n\n  w2\n\n  ::: …` (`w2` a paragraph of its own) | `- a\n\n  > q0w2\n\n  ::: …` | a join joins text, here as outside a list; the item's other blocks follow as before[^join-rule] |
| K5 | Delete at the end of an item's second paragraph | `1. a\n\n   w4\n\n   w5\n\n   \| h \|…` | `1. a\n\n   w4w5\n\n   \| h \|…` | the same |
| T15 | the row's second step looked for the text `w2` after K5's join | — | `Delete` at `p1`@2, `Enter` at `p1w2`@3 gives `- w0\n\n  p1w\n\n  2` | follows from K5 |
| X7 | `insertImage` over everything the only item holds | `![](u.png)` | `- ![](u.png)` | the item stays, as it does when text is typed over the same range (X3) |
| U13 | a quote set over a range from a nested item's quote to the outer item's headings | `- a\n\n> b\n\n> q\n\n> g\n\n> h\n\n- d` | `- a\n  - b\n\n    > q\n\n  > g\n\n  > h\n\n- d` | `b` is not in the selection; before, Lexical counted the whole item as a selected block |
| M1, M2 | an item's raw list is edited into a list | the item became part of the item before it, whose open comment then showed as a paragraph | the item stays an item; the comment stays a raw block | an item that opens with a list is an item (`- - n`); before, Lexical's shape read it as the nested list of the item before |
| P10 | a fence and a paragraph pasted at the start of a nested item | `- a\n\n- ::: {align=center}\n  **f**\n  :::\n\n  P2bcd\n\n  - e\n\n- f` | `- a\n\n  ::: {align=center}\n  **f**\n  :::\n\n  P2bcd\n\n  - e\n\n- f` | the fence goes where every other pasted block goes, into the outer item; before, it turned the item node holding the nested list into an item of the outer list |
| D27, D29, D30 (table edge) | a table between two texts of one item is removed | `- item\n\n- headil`, `- item\n\n- hetail`, `- item\n\n- hextail` | `- item\n\n- head\n\n  il`, `- item\n\n- he\n\n  tail`, `- item\n\n- hex\n\n  tail` | the text after the table is a paragraph, and a table-edge removal joins nothing, as at the top level |

Two results change that no row pins today. Both concern an item that holds
a nested list of its own.

| Edit | Today | After |
|---|---|---|
| `- a\n- b\n  - c\n- d`, indent `b` | `- a\n  - b\n  - c\n- d` (`b` and `c` become siblings) | `- a\n  - b\n    - c\n- d` |
| `- a\n  - b\n    - c\n  - d\n\n  e\n- f`, outdent `b` | `- a\n\n- b\n  - - c\n  - d\n\n  e\n\n- f` (`c` wrapped in an extra item) | `- a\n\n- b\n  - c\n  - d\n\n  e\n\n- f` |

### Four steps, the tree green after each

1. **The item class, same shape.** A subclass that changes nothing, in
   place of `ListItemNode`. Only type-name strings change.
2. **The text class and the three list operations, unused.** Added with
   unit tests on hand-built trees. Nothing builds a text node yet.
3. **The switch.** Importer, serializer, rules and editor change to the new
   shape, the hooks are turned on and the listeners are deleted. This step
   cannot be cut into green halves.[^one-step]
4. **The paste handler, and rows for the four known defects.**

Docs, changelog, the fuzz runs and the manual checks follow as step 5.

### The fuzz harnesses read node types through a mapping

The scratch harnesses name `'listitem'` in five places. Each is replaced by
the type that plays the same part.[^fuzz-map]

| Harness | Line | `'listitem'` means | Replace with |
|---|---|---|---|
| `zz-list-item-edit-fuzz.test.ts` | 78 | the container of a raw block | `'markdown-list-item'` |
| | 242 | the node whose children are spliced in | `'markdown-list-item'` |
| | 585 | `target.in === 'listitem' && target.block !== 'listitem'` | `target.in === 'markdown-list-item' && target.block !== 'markdown-list-item-text'` |
| `zz-column-paste-fuzz.test.ts` | 183 | a leaf block a copy can hold empty | `'markdown-list-item-text'` |
| `zz-table-edge-fuzz-lbdeclined.test.ts` | — | not named | no change |

---

## Internal Structure

The two node classes and the list operations go in
`markdownListItemNode.ts`; the last two subsections name their own file.
Write full JSDoc on every symbol, as the code conventions ask; the comments
below are shortened.

### `MarkdownListItemNode`

```ts
export class MarkdownListItemNode extends ListItemNode {
    static getType(): string;                        // "markdown-list-item"
    static clone(node: MarkdownListItemNode): MarkdownListItemNode;   // new MarkdownListItemNode(node.__value, node.__checked, node.__key)
    static importJSON(json: SerializedListItemNode): MarkdownListItemNode;   // new MarkdownListItemNode().updateFromJSON(json)

    // Step 3 adds everything below.
    static importDOM(): DOMConversionMap | null;
    append(...nodes: LexicalNode[]): this;           // this.splice(this.getChildrenSize(), 0, nodes): no merging
    canBeEmpty(): boolean;                           // false
    remove(preserveEmptyParent?: boolean): void;     // $removePlainly(this, preserveEmptyParent): no merging of neighbours
    setIndent(indent: number): this;
    collapseAtStart(): boolean;
}
```

```ts
    setIndent(indent: number): this {
        let current = this.getIndent();
        const isInList = this.getParent() !== null;

        // `updateFromJSON` sets the indent of an item that is in no list yet.
        while (isInList && current !== indent) {
            const moved = current < indent ? $indentItem(this) : $outdentItem(this);

            if (!moved) {
                break;
            }

            current += current < indent ? 1 : -1;
        }

        return this;
    }

    collapseAtStart(): boolean {
        const outdented = $outdentItem(this);

        if (outdented) {
            return true;
        }

        const lifted = $liftItemOut(this);
        const first = lifted[0];

        if ($isElementNode(first)) {
            first.selectStart();
        }

        return lifted.length > 0;
    }
```

`importDOM`, and the helper it uses:

```ts
    static importDOM(): DOMConversionMap | null {
        const lists = ListNode.importDOM?.() ?? null;

        if (lists === null) {
            return null;
        }

        return {
            ol: (element) => {
                const own = lists.ol?.(element) ?? null;

                return own === null ? null : { priority: 1, conversion: (list) => keepingNestedLists(own.conversion(list)) };
            },
            ul: (element) => {
                const own = lists.ul?.(element) ?? null;

                return own === null ? null : { priority: 1, conversion: (list) => keepingNestedLists(own.conversion(list)) };
            },
        };
    }

/** `ListNode`'s conversion, its `after` step replaced: a child that is no item is wrapped in one, and nothing is moved. */
function keepingNestedLists(output: DOMConversionOutput | null): DOMConversionOutput | null {
    const list = output?.node;

    if (output === null || !(list instanceof ListNode)) {
        return output;
    }

    return { ...output, after: (children) => children.map((child) => ($isListItemNode(child) ? child : list.createListItemNode().append(child))) };
}
```

### `MarkdownListItemTextNode`

```ts
export class MarkdownListItemTextNode extends ParagraphNode {
    static getType(): string;                        // "markdown-list-item-text"
    static clone(node: MarkdownListItemTextNode): MarkdownListItemTextNode;   // new MarkdownListItemTextNode(node.__key)
    static importJSON(json: SerializedParagraphNode): MarkdownListItemTextNode;   // new MarkdownListItemTextNode().updateFromJSON(json)

    isParentRequired(): boolean;                     // true
    createParentElementNode(): ElementNode;          // $createListItemNode()
    canMergeWhenEmpty(): boolean;                    // true, as ListItemNode
    getIndent(): number;
    setIndent(indent: number): this;
    insertNewAfter(selection: RangeSelection, restoreSelection?: boolean): ParagraphNode;
    collapseAtStart(): boolean;
    insertAfter(node: LexicalNode, restoreSelection?: boolean): LexicalNode;
    replace<N extends LexicalNode>(replaceWith: N, includeChildren?: boolean): N;
    remove(preserveEmptyParent?: boolean): void;
}
```

Every override starts by reading `const item = this.getParent()` and falls
back to `super` when `item` is no `MarkdownListItemNode` or is not attached.
The importer, `$parseSerializedNode` and the scratch builds in
`markdownWritable.ts` call these methods on trees that are not in the
document.

```ts
    getIndent(): number {
        const item = this.getParent();

        return $isMarkdownListItemNode(item) && item.isAttached() ? item.getIndent() : 0;
    }

    setIndent(indent: number): this {
        const item = this.getParent();

        if ($isMarkdownListItemNode(item)) {
            item.setIndent(indent);
        }

        return this;
    }

    insertNewAfter(selection: RangeSelection, restoreSelection?: boolean): ParagraphNode {
        const item = this.getParent();
        const isItemText = $isMarkdownListItemNode(item) && item.isAttached();

        if (!isItemText) {
            return super.insertNewAfter(selection, restoreSelection ?? true);
        }

        // Blank text counts as none, as in Lexical's own rule for an empty item.
        const holdsNothing = item.getChildrenSize() === 1
            && this.getChildren().every((child) => $isTextNode(child) && child.getTextContent().trim() === "");

        if (holdsNothing) {
            const outdented = $outdentItem(item);

            return outdented ? this : ($liftItemOut(item)[0] as ParagraphNode);
        }

        const next = $createListItemNode();
        const text = $createMarkdownListItemTextNode();

        item.insertAfter(next, restoreSelection);
        next.splice(0, 0, [text, ...this.getNextSiblings()]);

        return text;
    }

    collapseAtStart(): boolean {
        const item = this.getParent();

        return $isMarkdownListItemNode(item) && item.isAttached() ? item.collapseAtStart() : false;
    }

    insertAfter(node: LexicalNode, restoreSelection?: boolean): LexicalNode {
        const item = this.getParent();
        const leavesList = $isMarkdownListItemNode(item) && item.isAttached() && $isElementNode(node) && !node.isInline();

        // As `ListItemNode.insertAfter`: a block put after an item's text goes after the item's list, the list split there.
        return leavesList ? item.insertAfter(node, restoreSelection) : super.insertAfter(node, restoreSelection);
    }

    replace<N extends LexicalNode>(replaceWith: N, includeChildren?: boolean): N {
        const item = this.getParent();
        const opensItem = $isMarkdownListItemNode(item) && item.isAttached() && this.getPreviousSibling() === null;
        const staysText = replaceWith instanceof MarkdownListItemTextNode;

        if (!opensItem || staysText) {
            return super.replace(replaceWith, includeChildren);
        }

        // The item leaves its lists; its text is then a paragraph where the list stood.
        const paragraph = $liftItemOut(item)[0]!;

        return paragraph.replace(replaceWith, includeChildren);
    }

    remove(preserveEmptyParent?: boolean): void {
        const item = this.getParent();
        const selection = $getSelection();
        const anchor = $isRangeSelection(selection) && selection.isCollapsed() ? selection.anchor.getNode() : null;
        const isItemText = $isMarkdownListItemNode(item) && item.isAttached();
        // The caret is in what the item holds after its text: the text alone goes, an empty block before the caret's.
        const caretStaysInItem = isItemText && anchor !== null && item.isParentOf(anchor) && !this.is(anchor) && !this.isParentOf(anchor);

        if (isItemText && !caretStaysInItem) {
            $moveRestBeforeItem(item, this);
        }

        super.remove(preserveEmptyParent);
    }
```

`remove` is the hook behind every join: Lexical ends a merge of two blocks
by calling `remove` on the block it merged away.[^remove-hook]

### The list operations

```ts
/** Removes a node as `LexicalNode.remove` does, whatever its class overrides. */
function $removePlainly(node: LexicalNode, preserveEmptyParent?: boolean): void {
    ElementNode.prototype.remove.call(node, preserveEmptyParent);
}

/** Moves what an item holds after `text` to follow what stands before the item. */
function $moveRestBeforeItem(item: MarkdownListItemNode, text: LexicalNode): void {
    const previous = item.getPreviousSibling();
    const rest = text.getNextSiblings();

    if ($isMarkdownListItemNode(previous)) {
        previous.splice(previous.getChildrenSize(), 0, rest);

        return;
    }

    const list = item.getParentOrThrow();
    const firstList = rest.findIndex($isListNode);
    const blocks = firstList === -1 ? rest : rest.slice(0, firstList);

    if (blocks.length > 0) {
        list.getParentOrThrow().splice(list.getIndexWithinParent(), 0, blocks);
    }
}

/** Moves a nested item one level out, with what followed it inside the outer item. */
export function $outdentItem(item: MarkdownListItemNode): boolean {
    const list = item.getParentOrThrow<ListNode>();
    const outer = list.getParent();

    if (!$isMarkdownListItemNode(outer)) {
        return false;
    }

    const rest = item.getNextSiblings();
    const tail = list.getNextSiblings();

    if (rest.length > 0) {
        const restList = $copyNode(list);

        item.splice(item.getChildrenSize(), 0, [restList]);
        restList.splice(0, 0, rest);
    }

    item.splice(item.getChildrenSize(), 0, tail);
    outer.insertAfter(item);

    if (list.isEmpty()) {
        list.remove();
    }

    return true;
}

/** Nests an item under the item before it, with everything it holds. */
export function $indentItem(item: MarkdownListItemNode): boolean {
    const list = item.getParentOrThrow<ListNode>();
    const previous = item.getPreviousSibling();

    if (!$isMarkdownListItemNode(previous)) {
        // A list's first item: wrapped in an empty item, as Lexical does (`- - a`).
        const wrapper = $createListItemNode();
        const nested = $copyNode(list);

        item.insertBefore(wrapper);
        wrapper.splice(0, 0, [nested]);
        nested.splice(0, 0, [item]);

        return true;
    }

    const last = previous.getLastChild();
    const joins = $isListNode(last) && last.getListType() === list.getListType();
    const nested = joins ? last : $copyNode(list);

    if (!joins) {
        previous.splice(previous.getChildrenSize(), 0, [nested]);
    }

    nested.splice(nested.getChildrenSize(), 0, [item]);

    return true;
}

/**
 * Takes an item out of every list it is in. Its text becomes a paragraph where the outermost list
 * stood, the list split around it; the blocks up to its first nested list follow; the nested list
 * and what follows it stay in the list, in an item.
 *
 * @returns The blocks moved out, the paragraph first when the item had a text; none when nothing left.
 */
export function $liftItemOut(item: MarkdownListItemNode): LexicalNode[] {
    while ($outdentItem(item)) {
        // One level per call.
    }

    const list = item.getParentOrThrow<ListNode>();
    const container = list.getParentOrThrow();
    const children = item.getChildren();
    const first = children[0];
    const text = $isMarkdownListItemTextNode(first) ? first : null;
    const rest = text === null ? children : children.slice(1);
    const firstList = rest.findIndex($isListNode);
    const blocks = firstList === -1 ? rest : rest.slice(0, firstList);
    const paragraph = text === null ? null : $createParagraphNode();
    const moved: LexicalNode[] = paragraph === null ? blocks : [paragraph, ...blocks];
    const after = item.getNextSiblings();

    if (moved.length === 0) {
        return moved;
    }

    if (paragraph !== null && text !== null) {
        paragraph.splice(0, 0, text.getChildren());
    }

    container.splice(list.getIndexWithinParent() + 1, 0, moved);

    if (text !== null) {
        $removePlainly(text, true);
    }

    const keepsItem = item.getChildrenSize() > 0;
    const following = keepsItem ? [item, ...after] : after;

    if (following.length > 0) {
        const restList = $copyNode(list);
        const last = moved[moved.length - 1]!;

        container.splice(last.getIndexWithinParent() + 1, 0, [restList]);
        restList.splice(0, 0, following);
    }

    if (!keepsItem) {
        $removePlainly(item, true);
    }

    if (list.isEmpty()) {
        list.remove();
    }

    return moved;
}
```

These functions use `splice`, never `append`: in steps 1 and 2 the item's
`append` is still Lexical's, which merges a paragraph into the item.

### The normal-form rules (`markdownWritable.ts`)

```ts
/** Brings a list item into its normal form (rules 1, 3 and 4). */
function $keepItemShape(item: ListItemNode): void {
    let run: ParagraphNode | null = null;

    if (!item.isAttached()) {
        return;
    }

    for (const child of item.getChildren()) {
        if ($isBlock(child)) {
            run = null;

            continue;
        }

        if (run === null) {
            run = $createParagraphNode();
            child.insertBefore(run);
        }

        run.append(child);
    }

    if (item.getChildrenSize() === 0) {
        item.append($createMarkdownListItemTextNode());
    }

    const first = item.getFirstChild();
    const opensWithParagraph = $isParagraphNode(first) && !$isMarkdownListItemTextNode(first);

    if (opensWithParagraph) {
        first.replace($createMarkdownListItemTextNode(), true);
    }
}

/** Keeps an item's text where one stands (rule 2) and drops one that holds nothing before a block (rule 5). */
function $keepItemTextInPlace(text: MarkdownListItemTextNode): void {
    const parent = text.getParent();

    if (!text.isAttached()) {
        return;
    }

    const opensItem = $isMarkdownListItemNode(parent) && text.getPreviousSibling() === null;

    if (!opensItem) {
        text.replace($createParagraphNode(), true);

        return;
    }

    const following = text.getNextSibling();
    const isEmptyBeforeBlock = text.isEmpty() && following !== null && !$isListNode(following);

    if (isEmptyBeforeBlock) {
        ParagraphNode.prototype.remove.call(text, true);
    }
}
```

`$keepItemShape` runs as the first statement of the existing
`ListItemNode` transform in `registerMarkdownListTransforms`
([markdownWritable.ts:287](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L287)),
in place of `$keepOpeningParagraphAsText`. `$keepItemTextInPlace` is a new
transform on `MarkdownListItemTextNode`, registered in the same function.
Rule 5 lives on the text node because Lexical runs a transform for a node
that was written itself; an item whose text lost its last character is not
written.[^transforms-per-type]

### The paste handler (`MarkdownEditor.ts`)

```ts
/** Tells whether a node is a paragraph, heading or quote that a list item holds after its text. */
function $isItemBlockTakingText(node: LexicalNode | null): node is ElementNode {
    const isTextBlock = $isParagraphNode(node) || $isHeadingNode(node) || $isQuoteNode(node);

    return isTextBlock && !$isMarkdownListItemTextNode(node) && $isMarkdownListItemNode(node.getParent());
}

/** Tells whether a pasted node is a block: an element or a decorator that is not inline. */
function $isPastedBlock(node: LexicalNode): boolean {
    return $isBlock(node) || ($isDecoratorNode(node) && !node.isInline());
}

function $pasteBlocksIntoItemBlock(payload: CommandPayloadType<typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND>): boolean {
    const selection = payload.selection;
    const holdsBlock = payload.nodes.some($isPastedBlock);

    if (!$isRangeSelection(selection) || !holdsBlock) {
        return false;
    }

    const start = $orderedPoints(selection)[0];
    const startBlock = $findEnclosingBlock(start.getNode());

    if (!$isItemBlockTakingText(startBlock)) {
        return false;
    }

    if (!selection.isCollapsed()) {
        selection.removeText();
    }

    const firstBlock = $findEnclosingBlock(selection.anchor.getNode());

    if (!$isItemBlockTakingText(firstBlock)) {
        return false;
    }

    // Each run of pasted inline nodes becomes a paragraph, as Lexical wraps them.
    const blocks: LexicalNode[] = [];
    let run: ParagraphNode | null = null;

    for (const node of payload.nodes) {
        if ($isPastedBlock(node)) {
            blocks.push(node);
            run = null;

            continue;
        }

        if (run === null) {
            run = $createParagraphNode();
            blocks.push(run);
        }

        run.append(node);
    }

    const tail = firstBlock.isEmpty() ? null : selection.insertParagraph();
    const first = blocks[0]!;
    const merges = ($isParagraphNode(first) || $isHeadingNode(first) || $isQuoteNode(first)) && !first.isEmpty();
    const rest = merges ? blocks.slice(1) : blocks;
    const last = blocks[blocks.length - 1]!;
    const lastLeaf = $isElementNode(last) ? last.getLastDescendant() ?? last : last;

    if (merges) {
        firstBlock.append(...first.getChildren());
    }

    firstBlock.getParentOrThrow().splice(firstBlock.getIndexWithinParent() + 1, 0, rest);

    const lastBlock = rest.length === 0 ? firstBlock : $findEnclosingBlock(lastLeaf);
    const end = lastBlock === null ? null : lastBlock.getLastDescendant() ?? lastBlock;

    if (end !== null) {
        end.selectEnd();
    }

    const joinsTail = tail !== null && ($isParagraphNode(lastBlock) || $isHeadingNode(lastBlock) || $isQuoteNode(lastBlock));

    if (joinsTail) {
        lastBlock.append(...tail.getChildren());
        tail.remove();
    }

    if (firstBlock.isEmpty()) {
        firstBlock.remove();
    }

    return true;
}

function registerItemBlockPaste(editor: LexicalEditor): () => void {
    return editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, $pasteBlocksIntoItemBlock, COMMAND_PRIORITY_HIGH);
}
```

`buildEditor` calls `registerItemBlockPaste(editor)` on the line after
`registerColumnPaste(editor)`. A pasted column is then already its blocks
when this handler sees it. `$pasteIntoTextOnlyBlock` is registered later,
and the two never apply to the same caret.

---

## Implementation

Site-by-site changes of step 3. `text` means a
`MarkdownListItemTextNode`.

### `markdownImporter.ts`

- `$buildListItem`
  ([:1038](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1038))
  returns `ListItemNode | null`, one node. It creates
  `const itemText = $createMarkdownListItemTextNode()`, appends it to the
  item **before** building into it when the item opens with text or holds
  nothing at all (`text !== null || located.length === 0`), and passes
  `itemText` where it passes `listItem` today: to
  `$buildKeepingConstructs`, to `clear()`, to `append(…checkbox…)` and as
  `block:` of `appendInlineTokens`. `$buildKeepingConstructs` is called only
  when `text !== null`.
- `$buildItemBlocks`
  ([:1082](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1082))
  returns `ListItemNode | null`. Each entry is appended to `listItem`: a
  nested list that `$buildList` built, else `$buildItemBlock(entry)`. No
  `holder`, no second item node, no `splice` comment.
- `$buildList`
  ([:945](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L945))
  appends the one node (`list.append(built)`).
- `$holdsItemBlocks`
  ([:977](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L977))
  tests each child of each item with
  `!$isListNode(child) && !$isMarkdownListItemTextNode(child)`.

| Item | `$holdsItemBlocks` | As today |
|---|---|---|
| `item(text("a"))` | no | yes |
| `item(text("a"), list(…))` | no | yes |
| `item(text("a"), paragraph("p"))` | yes | yes |
| `item(heading("Foo"))` | yes | yes |

### `markdownSerializer.ts`

- Delete `$continuesItemBefore`
  ([:1913](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1913)).
- `serializeList`
  ([:2076](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2076))
  and `$listReadsLoose`
  ([:1094](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1094)):
  one entry per item node; the `continues` branch goes.
- `appendItemBlocks`
  ([:2119](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2119))
  and `itemBlockKinds`
  ([:2172](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2172)):
  the `inline` run and `flushInline` go, since every child is a block. In
  `appendItemBlocks` a text node is written with `inListItem: true`, any
  other paragraph with `inItemParagraph: true`.
- `$blocksAfter`
  ([:1887](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1887))
  returns `node.getNextSiblings()`.
- `$readStandardForm`
  ([:887](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L887)):
  `$isListItemNode(container)` becomes
  `$isMarkdownListItemTextNode(container)`. The test is by type, so it also
  holds for a text node that is in no item yet.
- `inlineRuns`
  ([:945](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L945)):
  the list-item tail of the function goes; an item falls under the general
  `node.getChildren().flatMap(…)` line.
- `serializeCellChild`
  ([:2557](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2557)):
  for each item, each child that is no list is written through
  `serializeCellChild(child, definitions)`, each nested list as today.

The serializer's output for a given document must not change by one byte:
it is the fingerprint an unedited block is saved by. The round-trip corpus
checks that.

### `markdownWritable.ts`

- `registerMarkdownListTransforms`: `$keepItemShape` and
  `$keepItemTextInPlace` as described under *Internal Structure*.
- **Register every paragraph rule for the text node too.** A transform
  registered for `ParagraphNode` does not run for a subclass with its own
  type. Add `MarkdownListItemTextNode` beside `ParagraphNode` at lines 80
  (`$keepBlocksOutOfText`), 298 (`$keepLoosenessOfItemHolding`), 829
  (`checkSiblings`), 1382 (`dropInContainer`) and 1845 (the `tidy` list).
  In the last two, the text node also takes the place of `ListItemNode`.
- `$moveBlocksOutAfter`
  ([:120](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L120)):
  `container.getParentOrThrow().splice(container.getIndexWithinParent() + 1, 0, moved)`
  when `moved` is not empty. The text node's `insertAfter` would take a
  block out of the list.
- `$keepLoosenessAfterTyping`
  ([:328](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L328)):
  the condition becomes "the text's block is a paragraph that is no text
  node, or the list has one item"
  (`list.getChildrenSize() <= 1`).[^looseness-cost]
- `$normalizeList`'s helpers: `$keepNumbersWritable` counts every item;
  `$numberListItems` adds one per item; `$joinLists` appends the items and
  joins no nested lists.
- `$showItemRawBlocksAsWritten`
  ([:982](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L982))
  is `$showRawBlocksAsWritten(item)`, no loop.
- `$isBreakRuleContainer`
  ([:1456](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1456))
  and `$dropUnwritableBreaks`
  ([:1599](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1599)):
  the list-item cases go (`$isListItemNode(node)`, `holdsBlocks`).
- `$scratchBlock`
  ([:2054](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2054)):
  a text node gives `$createMarkdownListItemTextNode()`, tested before the
  paragraph case; the list-item case goes.
- `$editOrRestore`
  ([:2346](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2346)):
  both parses are `$parseSerializedNode`.
- Delete `$parseKeepingItemParagraphs`, `$keepOpeningParagraphAsText`,
  `$outdentItemKeepingBlocks`.

### `MarkdownEditor.ts`

- `buildEditor`
  ([:6358](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6358)):
  remove the four lines `registerItemTextEdits(editor)`, the
  `OUTDENT_CONTENT_COMMAND` and `KEY_BACKSPACE_COMMAND` registrations and
  `registerCopiedItemParagraphs(editor)`. `registerList(editor)` stays.
- `setBlockType`
  ([:5590](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5590)):
  the hook argument is `type === "code" ? $copyBlockAsCodeSource : undefined`,
  as before the branch.
- `$copyBlockAsCodeSource`
  ([:363](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L363)):
  after the `$isTextOnlyBlock` return, the body is
  `const markdown = $serializeInlineNodes(block.getChildren()); block.clear();`
  and, when `markdown !== ""`, `block.append($createTextNode(markdown))`.
  Drop the JSDoc sentences about a list item's blocks.
- `$selectionLiesInListOfType`
  ([:2638](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2638)):
  the item is `block.getParent()` when `block` is a text node.
- `toggleList`
  ([:4575](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4575)):
  inside its `editor.update`, after `$moveBlockPointsIntoText`, call
  `$convertListOfEmptyItem(type)` and dispatch `insert` only when it
  returned `false`. `$convertListOfEmptyItem` is new: for a collapsed caret
  whose block is an empty text node, it puts a new
  `$createListNode(type)` before the item's list, moves the list's children
  into it with `splice`, removes the old list and returns `true`.
  `$insertList` would read the empty text as an empty block and nest a list
  in the item.
- `$settleCaretIntoBlock`
  ([:1669](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1669)):
  `isBetweenBlocks` also holds for an element point on a list item
  (`$isRootOrShadowRoot(parent) || $isMarkdownListItemNode(parent)`).
- `$classifyContextMenuTarget`
  ([:3927](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3927)):
  the `"empty-line"` test adds `&& !$isMarkdownListItemTextNode(block)`. An
  empty list item stays kind `"text"`, as today.
- Delete the symbols listed under *What is deleted and what stays*.

### `editorNodes.ts`, `editorTheme.ts`, `viewModel.ts`

- `EDITOR_NODES` is typed
  `ReadonlyArray<Klass<LexicalNode> | LexicalNodeReplacement>`. In place of
  `ListItemNode` it holds `MarkdownListItemNode`, then
  `{ replace: ListItemNode, with: (): MarkdownListItemNode => new MarkdownListItemNode(), withKlass: MarkdownListItemNode }`
  (step 1) and `MarkdownListItemTextNode` (step 2). Update its JSDoc.
- `editorTheme.ts`: the rule under *One CSS rule keeps a tight list tight*,
  a `scope: "selector"` `StyleRule` after the `LIST_CLASS` rule.
- `tests/component/markdown-roundtrip/viewModel.ts`: `editorListItems`
  ([:655](../packages/lib/tests/component/markdown-roundtrip/viewModel.ts#L655))
  pushes one entry per item; `editorItemBlocks` returns
  `editorBlocks(children)`. The harness compares block models, so nothing
  else in it changes.

---

## Ordered Implementation Steps

Run commands from `packages/lib` unless one says "repo root". Do not run
`npm install`. Work test-first inside each step.

**Step 1 — the item class, same shape**

1. Create `markdownListItemNode.ts` with `MarkdownListItemNode` (the three
   static methods only), `$isMarkdownListItemNode`, and the SPDX line the
   sibling files start with.
2. Change `EDITOR_NODES` as *Implementation* says.
3. In `holdsItemParagraph`
   ([MarkdownEditor.ts:1306](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1306))
   compare with `MarkdownListItemNode.getType()`.
4. In the tests, replace `listitem(` by `markdown-list-item(` in every
   shape string, and `'listitem@0'` by `'markdown-list-item@0'` (three
   files: `markdown-editor-list-item-edits.test.ts`,
   `markdown-editor-list-item-paste.test.ts`,
   `markdown-editor-table-edge.test.ts`).
5. Check: `npx vitest run tests/component/markdown-*.test.ts tests/component/markdown-roundtrip`
   is green. Before sub-steps 3 and 4 the prototype failed 67 tests: 62 on
   the type name, 5 on `holdsItemParagraph`.

**Step 2 — the text class and the list operations**

6. Add `MarkdownListItemTextNode`, `$createMarkdownListItemTextNode`,
   `$isMarkdownListItemTextNode`, `$removePlainly`, `$moveRestBeforeItem`,
   `$outdentItem`, `$indentItem` and `$liftItemOut` to
   `markdownListItemNode.ts`. Register the text class in `EDITOR_NODES`.
7. Create `tests/component/markdown-list-item-node.test.ts` with rows S1 to
   S8 of *Expected Behaviour*. They build trees by hand in a bare Lexical
   editor (`createEditor({ nodes: EDITOR_NODES, onError })`) and call the
   three exported operations.
8. Check: the new file and step 5's command are green. No test of the
   editor changes, since nothing builds a text node yet.

**Step 3 — the switch**

9. Tests first. Apply *Tests that are restated* in full: shapes (from
   step 1's strings to the final ones of *The existing rows*), hand-built
   trees, the eleven rows of *Results that change*. Add rows S9 to S16 and
   the V, I and H rows. Run step 5's command and keep the list of failing
   tests.
10. `markdownListItemNode.ts`: add the item's step-3 members.
11. `markdownImporter.ts`, `markdownSerializer.ts`, `viewModel.ts`,
    `markdownWritable.ts`, `MarkdownEditor.ts`, `editorTheme.ts`, in that
    order, as *Implementation* lists.
12. Checkpoints:
    - `grep -rn 'continuesItemBefore\|registerItemTextEdits\|registerCopiedItemParagraphs\|parseKeepingItemParagraphs\|outdentItemKeepingBlocks\|keepOpeningParagraphAsText\|prepareBlockForType\|backspaceOutdentsNestedItem\|outdentKeepingItemBlocks\|itemWhoseText\|putBlocksAfterCaret\|holdsItemParagraph' src/`
      — expect no match.
    - `grep -n 'registerNodeTransform(ParagraphNode' src/typescript/lib/component/editor/*.ts`
      — each hit has a `MarkdownListItemTextNode` twin beside it.
    - `grep -rn "\.insertAfter(" src/typescript/lib/component/editor/markdownWritable.ts`
      — no hit whose receiver can be an item's text.
13. Run step 5's command: green. Run
    `npx vitest run tests/component/markdown-editor-context-menu-mounted.test.ts tests/component/markdown-editor-table-edge-mounted.test.ts tests/unit/import-without-dom.test.ts`:
    green.

**Step 4 — the paste handler and the known defects**

14. Add rows A1 to A3 and B1 to
    `markdown-editor-list-item-edits.test.ts`. They pass already; they pin
    known defects 1 and 2.
15. Add rows Y1 to Y8 to `markdown-editor-list-item-paste.test.ts`. Y1 to
    Y7 fail: the paste gives one line of text. Y8 passes.
16. Add `$isItemBlockTakingText`, `$isPastedBlock`,
    `$pasteBlocksIntoItemBlock` and `registerItemBlockPaste`; register the
    last in `buildEditor`. Rerun: green.

**Step 5 — docs and full checks**

17. Make the edits under *Documentation Impact*.
18. Run everything under *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts` |
| Create | `packages/lib/tests/component/markdown-list-item-node.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-paste.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-edge.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every row is testable offline unless it stands under *Manual (browser)
checks*. `\n` is a newline in the source string; `x@n` is offset `n` in the
text node whose text is exactly `x`. `Backspace` and `Delete` are
`DELETE_CHARACTER_COMMAND`, `Backspace key` is `KEY_BACKSPACE_COMMAND`, as
in `markdown-editor-list-item-edits.test.ts`. Every row with steps also
runs that file's `expectSaveKeepsDocument` after the load and after each
step: reload, idempotence, viewer parity and the standard form.

### The existing rows

Every row of the families D, E, R, G, Q, P (paragraph lines), K, L, M, N, J,
F, W, U, C, T and X, the 165-row paste matrix, P1 to P14, O1, O2 and the
other rows of the two list-item files keep their `saved` string, except the
eleven rows under *Results that change*. Their `shape` strings are restated
by these rules:

| Old | New |
|---|---|
| `listitem("a")` | `markdown-list-item(markdown-list-item-text("a"))` |
| `listitem()` | `markdown-list-item(markdown-list-item-text())` |
| `listitem("a", paragraph("p"))` | `markdown-list-item(markdown-list-item-text("a"), paragraph("p"))` |
| `listitem(heading("h"))` | `markdown-list-item(heading("h"))` |
| `listitem("a"), listitem(list(X), paragraph("c"))` | `markdown-list-item(markdown-list-item-text("a"), list(X), paragraph("c"))` |
| `listitem(list(X))` as a list's first item, or after K6's and K14's joins | `markdown-list-item(list(X))` |
| caret `listitem@0` (table-edge D18, D28) | `markdown-list-item-text@0` |

A `shape` that the rules above cannot give is a failure to report, not a
string to adjust.

### The matrix: item shapes by edits

Each cell names the rows that pin it. "—" means the edit does not apply.

| Edit | text only | text + blocks | text + nested list + block after it | opens with a block | empty |
|---|---|---|---|---|---|
| Enter in the text | V9, V10 | T1 to T6, T13, T14 | T7, V11 | — | V4, V5, X2 |
| Enter in a block | — | V3 | V3 | — | — |
| `Backspace key` at the item's start | U8 | V7 | U1 to U7 | V6 | — |
| join at the item's start | K1 | K1 to K14, J1, J2 | A1 to A3, V8 | K4 | V13 |
| join inside the item | — | V1, V2 | — | — | — |
| type or delete over the text | X3 | T8 to T12 | V14 | — | V12 |
| indent, outdent | U8 | U7 | U1 to U6, I1 to I3, B1 | — | — |
| block type, list toggle | C5, H6 | C1 to C4, H1, H3, H4, J3 | U9 to U14, H2 | — | H5 |
| paste at the text | P1, the matrix | the 7 rows "a paste into the text of a list item that holds blocks" | P2 to P14, O2 | the matrix's fence rows | — |
| paste in a block | — | Y1 to Y5, Y7, Y8 | Y6 | — | — |
| range over the item | X8 | X1 to X7 | A3 | D22 to D30 | — |

### New rows: keys in an item (`markdown-editor-list-item-edits.test.ts`)

| # | Source | Steps | `saved` |
|---|---|---|---|
| A1 | `- a\n  - x\n- mid\n  - y\n\n  after\n- z` | `Backspace` at `mid`@0 | `- a\n  - xmid\n  - y\n\n  after\n\n- z` |
| A2 | the same | `Delete` at `x`@1 | `- a\n  - xmid\n  - y\n\n  after\n\n- z` |
| A3 | `- a\n  - x\n- mid\n- b\n  - y\n\n  after\n- z` | `Backspace` over `x`@1 to `b`@0 | `- a\n  - xb\n  - y\n\n  after\n\n- z` |
| B1 | `- a\n\n  - x\n    > q\n- z` (the item holds a raw list) | `Backspace` over `- x`@3 to `  > q`@5; `Backspace key` at `x`@0 | `- a\n\n- x\n\n- z` |
| V1 | `- a\n\n  p\n- z` | `Backspace` at `p`@0 | `- ap\n\n- z` |
| V2 | the same | `Delete` at `a`@1 | `- ap\n\n- z` |
| V3 | `- a\n\n  pq\n- z` | `Enter` at `pq`@1 | `- a\n\n  p\n\n  q\n\n- z` |
| V4 | `- a\n- z` | `Enter` at `a`@1; type one space; `Enter` | `- a\n\n* z` |
| V5 | `- a\n  - b\n- z` | `Enter` at `b`@1; `Enter` | `- a\n  - b\n-\n- z` |
| V6 | `p\n\n- # Foo\n- z` | `Backspace key` at `Foo`@0 | `p\n\n# Foo\n\n- z` |
| V7 | `- a\n- b\n\n  c\n- z` | `Backspace key` at `b`@0 | `- a\n\nb\n\nc\n\n- z` |
| V8 | `p\n\n- a\n\n  b\n  - n\n\n  c\n- z` | `Delete` at `p`@1 | `pa\n\nb\n\n- - n\n\n  c\n\n- z` |
| V9 | `- wx\n- z` | `Enter` at `wx`@0 | `-\n- wx\n- z` |
| V10 | `- ab\n- z` | `Shift+Enter` at `ab`@1 | `- a\\\n  b\n- z` |
| V11 | `- a\n  - n\n- z` | `Enter` at `a`@1; type `Q` | `- a\n- Q\n  - n\n- z` |
| V12 | `-` | caret at the document's end; type `Q` | `- Q` |
| V13 | `- a\n  - n\n- z` | `Backspace` over `a`@0 to `a`@1; `Backspace` at `n`@0 | `- - n\n- z` |
| V14 | the same | `Backspace` over `a`@0 to `a`@1; type `Q` | `- Q\n  - n\n- z` |
| I1 | `- a\n- b\n  - c\n- d` | `indent` at `b`@1 | `- a\n  - b\n    - c\n- d` |
| I2 | `- a\n- b` | `indent` at `a`@1 | `- - a\n- b` |
| I3 | `- a\n  - b\n    - c\n  - d\n\n  e\n- f` | `outdent` at `b`@1 | `- a\n\n- b\n  - c\n  - d\n\n  e\n\n- f` |
| H1 | `- a\n\n  p\n- z` | `setBlockType('h2')` at `p`@1 | `- a\n\n  ## p\n\n- z` |
| H2 | `- one\n  - inner\n- three` | `toggleUnorderedList()` at `one`@1 | `one\n\n- - inner\n- three` |
| H3 | `- one\n\n  second\n\n- two` | `toggleUnorderedList()` at `one`@1 | `one\n\nsecond\n\n- two` |
| H4 | the same | `toggleUnorderedList()` at `second`@1 | unchanged: `- one\n\n  second\n\n- two` |
| H5 | `- a\n-\n- z` | `Enter` at `a`@1; `toggleOrderedList()` | `1. a\n2.\n3.\n4. z` |
| H6 | `- a\n- b` | `toggleOrderedList()` at `b`@1 | `1. a\n2. b` |

In V10 the saved text holds one backslash before the line break.

These rows were also run on the branch, with these results:

| Rows | On the branch |
|---|---|
| V3 to V14, H1 to H6, I2 | the same save: the switch must change none of them |
| A1 to A3 | `after` is lost (`- a\n  - xmid\n  - y\n\n- z`): known defect 1 |
| B1 | `a` is lost (`- x\n\n- z`): known defect 2 |
| V1, V2 | nothing happens in a browser; the headless editor cannot make the key |
| I1, I3 | the results under *Results that change* |

Rows that pin a shape as well:

| # | `shape` |
|---|---|
| A1 | `list(markdown-list-item(markdown-list-item-text("a"), list(markdown-list-item(markdown-list-item-text("xmid")), markdown-list-item(markdown-list-item-text("y"))), paragraph("after")), markdown-list-item(markdown-list-item-text("z")))` |
| V1 | `list(markdown-list-item(markdown-list-item-text("ap")), markdown-list-item(markdown-list-item-text("z")))` |
| I3 | `list(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("b"), list(markdown-list-item(markdown-list-item-text("c")), markdown-list-item(markdown-list-item-text("d"))), paragraph("e")), markdown-list-item(markdown-list-item-text("f")))` |
| T11 (restated) | `list(markdown-list-item(markdown-list-item-text("p")), markdown-list-item(markdown-list-item-text("z")))` |

M1 and M2 keep their sources and steps. Their assertion after the edit
becomes `expect(shapeOf(editor)).toContain('markdown-raw-block("<!-- c")')`,
and `expectSaveKeepsDocument` runs with `comparesWithViewer` `false` when
the list still holds a raw list.

### New rows: a paste into a block of an item (`markdown-editor-list-item-paste.test.ts`)

Clipboards are copied from a second editor, as in that file: *paragraphs*
is `P1\n\nP2` from `P1`@0 to `P2`@2; *list* is `- k\n- m\n\nzz` from `k`@0
to `m`@1; *table* is `| h |\n| --- |\n| c |\n\nP2` from `h`@0 to `P2`@2;
*heading* is `## H\n\nP2` from `H`@0 to `P2`@2. Each row also asserts the
file's four checks, undo included.

| # | Target | Clipboard | At | `saved` |
|---|---|---|---|---|
| Y1 | `- x\n\n  cd\n- z` | paragraphs | `cd`@1 | `- x\n\n  cP1\n\n  P2d\n\n- z` |
| Y2 | `- x\n\n  ## cd\n- z` | paragraphs | `cd`@1 | `- x\n\n  ## cP1\n\n  P2d\n\n- z` |
| Y3 | `- x\n\n  > cd\n- z` | paragraphs | `cd`@1 | `- x\n\n  > cP1\n\n  P2d\n\n- z` |
| Y4 | `- x\n\n  cd\n- z` | list | `cd`@1 | `- x\n\n  c\n\n  - k\n  - md\n\n- z` |
| Y5 | `- x\n\n  cd\n- z` | table | `cd`@1 | `- x\n\n  c\n\n  \| h \|\n  \| --- \|\n  \| c \|\n\n  P2d\n\n- z` |
| Y6 | `- a\n  - b\n\n  cd\n- z` | heading | `cd`@2 | `- a\n  - b\n\n  cdH\n\n  P2\n\n- z` |
| Y7 | `- x\n\n  cd\n- z` | paragraphs | `cd`@0 | `- x\n\n  P1\n\n  P2cd\n\n- z` |
| Y8 | `- x\n\n  cd\n- z` | `P1 zz` from `P1 zz`@0 to `P1 zz`@2: text, no block | `cd`@1 | `- x\n\n  cP1d\n\n- z` (the handler declines; control) |

Before step 4, Y1 gives `- x\n\n  cP1P2d\n\n- z`, and Y2 to Y7 likewise
hold their pasted text on one line. Y8 passes before and after.

### Node-level rows (`markdown-list-item-node.test.ts`)

Trees are built by hand with `splice`; `t(x)` is a text node holding `x`,
`p(x)` a paragraph, `i(…)` an item, `ul(…)` a bullet list. The expected
shape uses the same letters.

| # | Step | Tree | Call | Expected |
|---|---|---|---|---|
| S1 | 2 | `ul(i(t(a), ul(i(t(b))), p(c)), i(t(d)))` | `$outdentItem` on `b` | `ul(i(t(a)), i(t(b), p(c)), i(t(d)))` |
| S2 | 2 | `ul(i(t(a), ul(i(t(b)), i(t(x))), p(c)))` | `$outdentItem` on `b` | `ul(i(t(a)), i(t(b), ul(i(t(x))), p(c)))` |
| S3 | 2 | `ul(i(t(a)))` | `$outdentItem` on `a` | returns `false`; unchanged |
| S4 | 2 | `ul(i(t(a)), i(t(b), ul(i(t(c)))))` | `$indentItem` on `b` | `ul(i(t(a), ul(i(t(b), ul(i(t(c)))))))` |
| S5 | 2 | `ul(i(t(a), ul(i(t(n)))), i(t(b)))` | `$indentItem` on `b` | `ul(i(t(a), ul(i(t(n)), i(t(b)))))` |
| S6 | 2 | `p(x)`, `ul(i(t(a)), i(t(b), p(c), ul(i(t(n))), p(e)), i(t(z)))` | `$liftItemOut` on `b` | `p(x)`, `ul(i(t(a)))`, `p(b)`, `p(c)`, `ul(i(ul(i(t(n))), p(e)), i(t(z)))` |
| S7 | 2 | `ul(i(heading(Foo)), i(t(z)))` | `$liftItemOut` on the first item | `heading(Foo)`, `ul(i(t(z)))` |
| S8 | 2 | `ul(i(ul(i(t(n)))))` | `$liftItemOut` on the outer item | returns `[]`; unchanged |
| S9 | 3 | `ul(i(t(wx), p(p2)), i(t(z)))` | caret `wx`@1, `selection.insertParagraph()` | `ul(i(t(w)), i(t(x), p(p2)), i(t(z)))` |
| S10 | 3 | `ul(i(t(a)), i(t(b), p(c)))` | caret `b`@0, `selection.deleteCharacter(true)` | `ul(i(t(ab), p(c)))` |
| S11 | 3 | `ul(i(t(), ul(i(t(n)))))` | caret `n`@0, `selection.deleteCharacter(true)` | `ul(i(ul(i(t(n)))))`: the text alone goes |
| S12 | 3 | `ul(i(t(a), ul(i(t(b))), p(c)), i(t(d)))` | caret `b`@1, `$setBlocksType(selection, () => $createHeadingNode('h2'))` | `ul(i(t(a)))`, `heading(b)`, `p(c)`, `ul(i(t(d)))` |
| S13 | 3 | `ul(i(t(a), p(p)))` | `$parseSerializedNode` of the list's own `exportJSON` tree | the same shape; item and text of the editor's classes |
| S14 | 3 | — | `$createListItemNode()` | an instance of `MarkdownListItemNode` |
| S15 | 3 | `ul(i(t(a)), i(t(b)))` | `text.getIndent()` of `b`, then `text.setIndent(1)` | `0`; then `ul(i(t(a), ul(i(t(b)))))` |
| S16 | 3 | a detached `i(t(a), p(p))` | `text.remove()`, `text.setIndent(1)`, `item.setIndent(1)` | no throw; `p` stays in the item |

S1 to S8 run in a bare editor: until step 3 the writable-state rules would
take a text node apart. S9 to S12 run in an editor with
`registerWritableStateRules` registered, so the normal form holds after
each update. S1 to S8 were worked out by hand from the functions above.
S9 to S16 restate, at node level, rows the prototype ran through the whole
editor (T1, A1, V13, U9, the paste rows, I1).

### Tests that are restated

| File | What changes | Count on the prototype |
|---|---|---|
| `markdown-editor-list-item-edits.test.ts` | `shape` strings; K3, K5, T15, X7, U13, M1, M2 | 56 |
| `markdown-importer.test.ts` | `itemChildTypes` and `nestedItemChildTypes` expectations (`['text', 'paragraph']` becomes `['markdown-list-item-text', 'paragraph']`; `[['text'], ['list', 'paragraph'], ['text']]` becomes `[['markdown-list-item-text', 'list', 'paragraph'], ['markdown-list-item-text']]`); helpers that walk an item's inline children read the text node's | 34 |
| `markdown-serializer.test.ts` | the `item(…)` helper ([:957](../packages/lib/tests/component/markdown-serializer.test.ts#L957)) builds the new shape: strings go into one text node, a nested list is a child of its item; rows that built a second item node for a nested list pass it as a child | 13 |
| `markdown-editor-list-item-paste.test.ts` | `shape` strings; P10 | 9 |
| `markdown-editor-command-crashes.test.ts` | R16's hand-built item holding text and a list is built in the new shape; its expected saves stay | 6 |
| `markdown-editor-table-edge.test.ts` | `loadWithTableOpeningTail` builds `item(table, paragraph("tail"))` with `splice`; `loadWithTableBetweenHeadAndTail` builds `item(text("head"), table, paragraph("tail"))`; D18's and D28's caret string; D27, D29, D30 | 5 |
| `markdown-editor.test.ts` | two tests reach a nested item through a second item node; they read the nested list as a child of the outer item | 2 |
| `markdown-view-model.test.ts` | row IB1 builds one item | 1 |

With the code of step 3 and the tests unchanged, the prototype failed
exactly these 126 tests, of 6,539 in 17 files, and no other.

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**.

| # | Steps | Expected |
|---|---|---|
| B1 | Source mode: `- a` / `- b`; back to WYSIWYG | the two items stand one line apart, as before this plan; no extra space above or below an item's text |
| B2 | Source mode: `- a` / (empty) / `  p` / `- z`; back; click at the start of `p`, Backspace | the item reads `ap`; one Ctrl/Cmd+Z brings `p` back |
| B3 | In the same document, click in `p`, paste two paragraphs copied from elsewhere in the editor | the item holds three paragraphs after `a`; nothing is run together on one line |
| B4 | Source mode: `- a` / `  - b` / (empty) / `  c` / `- d`; back; Backspace at the start of `b` | items `a`, `b` holding `c`, `d` |
| B5 | Copy a list from a web page — an item with a sub-item, and an item of two paragraphs — and paste it into an empty paragraph | the sub-item is nested under its item, not an item of its own; the two paragraphs are two paragraphs of their item |
| B6 | Copy `- a` with its paragraph `p` in this editor, paste into another paragraph | the pasted item holds `p` as a paragraph |
| B7 | Type in an item, press Enter twice | a new item, then the list ends and the caret is in a paragraph |
| B8 | Arrow keys, Shift+arrow and a mouse drag across an item's text, its paragraph and the next item | the selection moves and extends as in a list before this plan |

B5 is the only check of `importDOM`: the test DOM has no HTML parser.

---

## Verification

- `npm run typecheck` (repo root) and `npm -w packages/lib run typecheck:test`.
- `npm run lint` (repo root): zero errors. `markdownListItemNode.ts` names
  no DOM type.
- `npx vitest run tests/component/markdown-list-item-node.test.ts`: S1 to
  S16.
- `npx vitest run tests/component/markdown-*.test.ts tests/component/markdown-roundtrip`:
  every row, the corpus and the edit fuzz.
- `npm test` (repo root): full suite green.
- `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.
- The three `grep` checkpoints of step 12.
- **The list-edit fuzz.** Copy
  `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/impl/list-item-block-paste/zz-list-item-edit-fuzz.test.ts`
  with its three replacements from *The fuzz harnesses read node types
  through a mapping*, run
  it with `runlif.sh` over the eleven seeds at 1,500 documents, read it with
  `showlif.py`, and delete the copy. Required against the baseline
  `lif-r8/`:

  | Class | Baseline | Required |
  |---|---|---|
  | `pasteList:pasteFlattenedInItemBlock` | 82 | 0 |
  | `load:*` — a quote before an indented lazy HTML start, outside lists | 6 | no more than 6 |
  | `load:*` — the definition bookkeeping, a title holding a blank line | 5 | no more than 5 |
  | `spacesBeforeRaw:*` — spaces before a raw block after a list, top level | 2 | no more than 2 |
  | any other class | 0 | 0 |

  The last three classes are outside list items and are not this plan's.
- **The regression fuzzes.** `runfuzz.sh` over the four variants, with the
  one replacement in `zz-column-paste-fuzz.test.ts`. Compare with
  `cmpfuzz.py` against `impl/list-item-block-paste/fuzz/`. Required: paste
  47 (44 `emptyContainer`, 3 `undo`), paste strict 47, table edge 0, table
  edge strict 0; the same `(index, check)` pairs; the same `ran`,
  `skipped`, `withColumn` and `nothingCopied`. Records are compared with
  node keys masked (`#\d+`): every item now has one node more, so keys
  shift.
- Manual rows B1 to B8.

---

## Documentation Impact

No exported symbol changes; `EDITOR_NODES` and the node classes are
internal. Two pages change.

**[MarkdownEditor.md](../packages/lib/docs/components/MarkdownEditor.md)**,
the **Lists.** bullet (line 95):

- Replace the sentence starting "Blocks pasted into a block that a list
  item holds" with: "Blocks pasted into a block that a list item holds — one
  of its further paragraphs, a heading or a quote — become blocks of that
  item, the block split at the caret, as a paste at the top level splits a
  paragraph."
- Replace "and once an item's own text is deleted, the paragraph it opens
  with is its text, as Markdown reads an item whose first line is empty"
  with: "and once an item's own text is deleted, the paragraph after it is
  its text, as Markdown reads an item whose first line is empty; before a
  nested list the empty text line stays, to type the item's text in."
- After the sentence on a nested item moved out, add: "An item that is
  indented or moved out keeps its own nested list under it. Joining an
  item's text to the block before it — Delete at that block's end, or a
  range that ends in the text — joins the two texts, and what the item held
  after its text follows into the item before it; for a list's first item,
  the blocks up to its first nested list follow the text out of the list.
  Backspace at the start of an item's further paragraph joins it to the
  block before it. A block type set on such a further block changes it in
  place; set on the item's own text, it takes the item out of its lists."

**[next.md](../packages/lib/docs/reference/changelog/next.md)**

- Add at the end of `## Fixed` → `### Components` (just before `### Core`):
  "**`MarkdownEditor` edits a list item that holds blocks as one item.**
  The editor's list items are now nodes of its own, which hold blocks: the
  item's text, then paragraphs, headings, quotes, tables, fences and nested
  lists in any order. Blocks pasted into a paragraph, heading or quote of a
  list item become blocks of the item, where they were run together on one
  line. Backspace at the start of an item's second paragraph joins it to
  the item's text, where the key did nothing. Joining an item between two
  items that hold nested lists keeps the blocks after the second list,
  which were lost, and moving an item out of a nested list that an edit
  built keeps the outer item's text. An item that is indented keeps its
  nested list under it. A list pasted from a web page keeps the paragraphs
  its items hold. Joining an item to the block before it now joins the two
  texts on one line also when that block is a quote or a further paragraph
  of an item. No consumer action is needed."
- In the entry "**`MarkdownEditor` keeps a list whose item holds a
  block.**" (same unreleased file), delete the sentence "Blocks pasted into
  a block that a list item holds (a further paragraph, a heading or a
  quote) still go in as text on that block's line, as Lexical inserts
  them."

---

## Potential Challenges

- **A hook runs on a node outside the document.** `updateFromJSON` calls
  `setIndent`; the importer and the scratch builds call `remove` and
  `replace` on detached trees. Each override returns to `super` unless the
  item is attached (row S16).
- **A paragraph rule that never runs for an item's text.** A transform is
  registered per node type. The second `grep` of step 12 finds a missed
  one; the symptom is a nested list whose looseness is stale after its
  item's text is deleted.
- **A parent is not transformed when its child changes.** Put a rule on the
  node that is written. Normal-form rule 5 is on the text node for that
  reason.
- **`append` on an item before step 3.** Lexical's `ListItemNode.append`
  merges a paragraph, the text node included. Steps 1 and 2 use `splice`.
- **A block handed to the text node's `insertAfter` leaves the list.** That
  is the hook Lexical's paste relies on. The editor's own code puts a block
  after an item's text with `splice` on the item.
- **`$insertList` on an empty text.** It reads the empty text as an empty
  block and would nest a list in the item; `$convertListOfEmptyItem` runs
  first (row H5).
- **An open fault of the prototype.** Two of 6,000 fuzz documents threw
  `Expected node … to have a parent` in the fuzz's load checks, and a plain
  `setValue` and `getValue` of the same sources did not throw. The cause
  was not found. The list-edit fuzz run of *Verification* must end with no
  `load:throw` record.[^open-throw]
- **A pinned `saved` string that will not pass.** Do not change it. Stop and
  report the row. Only the eleven rows of *Results that change* differ.
- **Sibling plans edit the same files.** Apply each change by symbol name
  and append the changelog entry without touching its neighbours.

---

## Critical Files

- [LexicalList.dev.mjs](../node_modules/@lexical/list/dist/LexicalList.dev.mjs)
  — read only: `ListItemNode` (575) with `append` (706), `replace` (719),
  `insertAfter` (774), `remove` (795), `collapseAtStart` (815), `setIndent`
  (882); `mergeLists` (271), `$handleIndent` (380), `$handleOutdent` (442),
  `$handleListInsertParagraph` (498), `$insertList` (152),
  `$normalizeChildren` (1266), `ListNode.splice` (1187), `registerList`
  (1885).
- [Lexical.dev.mjs](../node_modules/lexical/dist/Lexical.dev.mjs) — read
  only: `insertNodes` (9303, case 3c at 9458), `insertParagraph` (9519),
  `deleteCharacter` (9760), `$removeTextFromCaretRange` (19387),
  `$getBlockMergeTargets` (19558), `$parseSerializedNodeImpl` (11981),
  `registerNodeTransform` (14807).
- [markdownReferenceLinkNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownReferenceLinkNode.ts),
  [markdownSourceNodes.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceNodes.ts),
  [markdownBlockNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts)
  — the precedents for a node subclass and for a container of blocks.
- [editorNodes.ts](../packages/lib/src/typescript/lib/component/editor/editorNodes.ts),
  [editorTheme.ts](../packages/lib/src/typescript/lib/component/editor/editorTheme.ts).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts)
  — `registerWritableStateRules` (75), `registerMarkdownListTransforms`
  (282), `registerRawBlockRules` (790), `registerLineBreakRules` (1373),
  `registerRunEdgeRules` (1790).
- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts)
  — `buildEditor` (6333), `registerItemTextEdits` (2976),
  `registerCopiedItemParagraphs` (3076), `registerColumnPaste` (3134),
  `toggleList` (4575), `setBlockType` (5572).
- `markdown-editor-list-item-block-paste.md` — under `plans/in-progress/`
  at `95e2c850a`, under `plans/implemented/` once that branch is closed.
  Read its Implementation Notes: the three rules, *Decisions*, *Seen along
  the way*.
- The prototype, never to be committed:
  `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/list-item-node/prototype-on-95e2c850a.diff`
  and `prototype-markdownListItemNode.ts` beside it. It is a reference, not
  a patch: it leaves dead code in place and skips JSDoc.
- [ARCHITECTURE.md](../ARCHITECTURE.md) and
  [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md).

---

## Non-Goals

- **Changing where a paste at an item's text lands.** The list is still
  split around the pasted blocks (P1 to P14 unchanged).
- **The two choices the user has not signed off.** Enter at the end of an
  item's text, and a nested item moved out with the outer item's later
  blocks, stay as the branch has them.
- **The list toggle's contract.** `markdown-list-toggle-task-item-parity`
  owns it; this plan keeps today's results (H2 to H6).
- **Lexical's `check` list type.** The editor's task marker stays a source
  node in the item's text.
- **A `ListNode` of the editor's own.** Its transform is already replaced;
  nothing else in it needs changing.
- **The three fuzz classes outside list items**, the paste of table cells
  into an item's text, and the paste into a raw `<pre>` block: recorded on
  the branch, owned elsewhere.
- **Source mode.** Its commands edit the Markdown text and are untouched.

---

## Addendum: Plans implemented after this one

Each of these was written against the branch's `ListItemNode`. Every one
must read "the item's text" as a `MarkdownListItemTextNode`, never as inline
nodes of the item, and must not expect an item node that continues another.

- **`markdown-editor-table-cells-paste-empty-column`.** Its handler is
  registered before `registerItemBlockPaste`, so pasted rows and cells are
  tables when that handler sees them. Its analysis of a paste "in a list
  item" describes `ListItemNode`; the caret's block is now the text node,
  and its list-item rows (K rows) must be measured again. A table pasted
  into a paragraph of an item is now a block of that item (row Y5). Its
  fuzz baseline is this plan's final run, read with the mapping and with
  node keys masked.
- **`markdown-editor-paste-undo-merge`.** `registerItemTextEdits` queued a
  second update behind a paste into an item's text. That update is gone.
  The three `undo` records must be confirmed on this plan's final fuzz run
  before that plan starts from them.
- **`markdown-list-toggle-task-item-parity`.** Its contract and its 94
  shapes stand. Its WYSIWYG *Internal Structure* does not: `$itemOfText`,
  `$isolateItemText`, `$moveToItemAfter` and `$makeListItems` are written
  for inline text in the item, a continuing item node and
  `ListItemNode.replace`. They must be rewritten on `$liftItemOut`,
  `$outdentItem` and the text node. Its rule 2 keeps what an item held
  after its text in the list; `$liftItemOut` takes the blocks up to the
  first nested list out. That plan changes the one function. Its prototype
  diff under `scratch-keep/plans2/list-toggle-parity/` no longer applies.
  `$convertListOfEmptyItem` goes when its own route replaces `$insertList`.
- **`markdown-editor-raw-block-range-edits`.** `$removeRangeEndingInItemText`
  no longer exists. Its rows E20 and E21 join a raw block with a list
  item's text; measure them again, since the join now goes through the
  text node's `remove`.
- **`markdown-editor-table-command-fixes`.** Its `$holdsNoCaret` tests "a
  list item whose first child is a block". Every item now holds blocks
  only, so the test is `$isListItemNode(node)`. `$settleCaretIntoBlock`
  already treats a point on an item as between blocks. Its rows on a list
  item (R43) must be measured again.
- **`markdown-editor-link-format-command-fixes`.** No list-specific code.
  Its rows that link or format text in a list item now run on the text
  node. Where a row or a helper names a block's type, an item's text is
  `markdown-list-item-text`; `$isParagraphNode` holds for it.
- **`markdown-editor-readonly-keyboard-selection`.** `registerList` stays
  registered, so its list of guarded list commands stands.
  `registerItemTextEdits` and `registerCopiedItemParagraphs`, which
  listened to Enter, paste and typing at the highest priority, are gone.
  `registerItemBlockPaste` listens to
  `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` at `COMMAND_PRIORITY_HIGH` and
  must stay behind that plan's read-only guard.

---

## Addendum: What a review should attack

- **The `remove` hook.** It decides between "the item is joined away" and
  "an empty text is dropped" by where the caret is. Look for a Lexical call
  of `remove` on an item's text that is neither, and for an edit that moves
  blocks out of an item it should have stayed in.
- **Normal-form rule 5.** Find an edit that leaves the caret in an empty
  text that is then dropped under it, in a way the branch did not.
- **Hooks on detached trees.** Paste, undo, a declined format
  (`$editOrRestore`), a changed definition (`$showBlockAnew`) and a raw
  block read again all build or parse nodes outside the document.
- **Every `$isParagraphNode` and `getType() === "paragraph"`** in the four
  modules: each now also sees, or misses, an item's text.
- **The serializer's bytes.** Any list whose standard form differs from the
  branch's by one character loses its source on a load.
- **The table-edge and stale-focus guards** on ranges that start or end in
  an item's text, its blocks, or a table an item holds.
- **Selection.** Element points on an item, carets after a lift or an
  outdent, and browser arrow keys across `<li><p>`.
- **HTML paste**, which no offline test covers.
- **Keystroke cost** in a list of several hundred items, in an item's text
  and in an item's paragraph.

---

## Notes

[^prototype]: The prototype is a throwaway patch on `95e2c850a`, kept at
    `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/list-item-node/`
    (`prototype-on-95e2c850a.diff`, 1,011 lines) with its logs. It has the
    two node classes, the importer and serializer changes, the normal-form
    rules, the paste handler, and the four listener registrations removed.
    Measured on it: 17 Markdown test files, 6,539 tests, 126 failing, all of
    them listed under *Tests that are restated*; the round-trip corpus and
    the source-preservation file (2,464 tests) pass unchanged; the mounted
    files and `import-without-dom` pass. The list-edit fuzz over four seeds
    (6,000 documents) fails 6 against 30 at the branch: the 26 flattened
    pastes are gone, the 3 load records and the 1 top-level record are the
    branch's, and 2 are the open fault named under *Potential Challenges*.
    The paste fuzz and the table-edge fuzz over seeds 601 and 1709 give the
    branch's records (2 and 6 `emptyContainer`; 0 and 0), equal once node
    keys are masked. Thirty-three new rows and fifteen rows compared with
    the branch were run through `expectSaveKeepsDocument`; their saves are
    the ones in *Expected Behaviour*.

[^why-regular]: A probe ran Lexical's own routines on hand-built trees of
    this shape, with no editor code (`zz-proto-item-node.test.ts` and
    `proto-out.txt` in the scratch folder). On the regular tree Lexical
    already gives: Backspace at the start of an item's second paragraph
    joins it to the text (`ap`); typing over all of the text leaves the
    paragraph alone (`Q`, `p`); a range across three items joins the two
    texts and leaves the last item's other paragraph; a range over all an
    item holds leaves the item with an empty block. The same probe shows
    what Lexical does not give, each of which this plan decides: Enter makes
    a second paragraph in the item, a paste flattens, and the inherited
    `collapseAtStart`, `setIndent` and `remove` build or assume the
    continuing-item shape (`remove` dropped the block after the second
    nested list, which is known defect 1).
    Keeping today's shape with an owned subclass was the alternative. It
    would keep both irregular features: an item that is a text block when it
    opens with text and a container when it opens with a block, and three
    trees for one document (`li("a")`, `li(list, block)`; `li(list, block,
    list)` from a paste; `li("a", list)` from a raw block read again).

[^why-text-node]: Three designs were compared.
    *Inline text straight in the item* (today's placement, nested lists as
    children): Lexical's hooks reach the item for free, but an item whose
    text is deleted has no node to hold the caret, so text typed next lands
    in its first block. That is what `registerItemTextEdits` worked around.
    *A plain `ParagraphNode` as the text*: the tree is regular, but Lexical
    asks the paragraph, which the editor does not own. Enter, indent,
    outdent, a block type, a paste at the text and every join would each
    need a command listener again; a join is reached from thirteen commands
    (the list in `registerRangeGuards`).
    *A paragraph subclass* (chosen): `insertNewAfter`, `collapseAtStart`,
    `setIndent`, `replace`, `remove`, `insertAfter` and `isParentRequired`
    are all methods Lexical calls on the caret's block. The prototype
    passes the T, U, K, J, C and X families and the paste rows with no list
    listener but `registerList`'s own. The cost is a second type: paragraph
    transforms must be registered for it, and two normal-form rules keep it
    where it belongs.
    Replacing `ParagraphNode` itself by an editor class was not taken: it
    would rename the type of every paragraph in every test and harness.

[^no-shadow-root]: The probe ran the same edits with `isShadowRoot()`
    returning `true`. A paste then kept its blocks, the one gain. But
    `deleteCharacter` does not merge across a shadow root
    ([Lexical.dev.mjs:9782](../node_modules/lexical/dist/Lexical.dev.mjs#L9782)),
    forward deletion stops before one (`forwardDeletion`, line 9741),
    `$getBlockMergeTargets` returns nothing when a shadow root stands
    between the two blocks (line 19581), and `$insertList` on an item's
    paragraph lost the item's other paragraph. Backspace and Delete between
    two items, and every range across items, would have to be written by
    hand. That is more listeners, not fewer.

[^replacement]: The precedent search looked for `replace:` and `withKlass`
    in `packages/lib/src`: no match. The editor's other nodes are separate
    types that only its own code creates, which works because nothing else
    builds a `:::` column or a raw block. List items are different:
    `ListNode.createListItemNode`, `$insertList`, `ListNode.splice` and the
    HTML conversions all call `$createListItemNode()`, and that function
    applies a registered replacement. A separate class that does not extend
    `ListItemNode` was ruled out: `ListNode.splice` wraps every child that
    is no `ListItemNode` in a new item, and about forty `$isListItemNode`
    checks in the editor and its tests would stop matching. The existing
    override of `@lexical/list` is of another kind: `ListNode`'s transform
    set is cleared through `editor.getRegisteredNode`
    ([markdownWritable.ts:283](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L283)),
    which stays as it is.

[^type-name]: Lexical writes copied nodes with the editor's namespace and
    reads them back only when the namespace matches. `MarkdownEditor` sets
    none, so each editor instance gets a random one
    ([Lexical.dev.mjs:14332](../node_modules/lexical/dist/Lexical.dev.mjs#L14332)):
    a payload from an older library, or from another editor on the page, is
    never parsed as nodes. It arrives as HTML or text. Inside one instance
    every payload carries the new type names. The editor exposes no Lexical
    JSON; its value is Markdown. One trap remains for a test that
    hand-writes JSON: a node of type `listitem` is built by
    `ListItemNode.importJSON`, which calls `new ListItemNode()` and so
    skips the replacement. No test does that today.

[^html]: `ListNode`'s conversion ends with `$normalizeChildren`
    ([LexicalList.dev.mjs:1266](../node_modules/@lexical/list/dist/LexicalList.dev.mjs#L1266)),
    which moves each nested list into a wrapper item after its item. In the
    new model that wrapper is an item of its own (`- a`, `- - b`). A
    normal-form rule cannot undo it, because a loaded `- - b` has the same
    tree. The override was checked on the prototype with
    `npx eslint src/typescript/lib/component/editor/markdownListItemNode.ts`:
    no message, while a line reading `element.tagName` in the same file is
    reported twice. The `<li>` conversion stays Lexical's. Lexical's HTML
    import attaches an `<li>`'s converted children with the item's own
    `append` (`$createNodesFromDOM` in `@lexical/html`), so an `<li>` holding
    two `<p>` keeps both, where `ListItemNode.append` merged them. That is
    read in Lexical's source, not run; manual row B5 checks it, and with it
    the branch's recorded item "A list pasted as HTML".

[^register-list]: `registerList` registers six things. Three still act: the
    two insert-list commands (`$insertList`, whose new items are brought to
    normal form by `$keepItemShape`) and the Backspace listener, which
    walks from the caret up through first children to the item and calls
    its `collapseAtStart`. Three never match the new shape:
    `$handleListInsertParagraph` needs a caret on an item with no children
    or text straight in the item, and the two text-style transforms read
    text straight in the item. Dropping `registerList` and registering the
    three live listeners by hand was considered and not taken: it is more
    change for the same behaviour, and the list-toggle plan removes two of
    the three anyway.

[^case-3c]: The condition is
    `!firstBlock.isParentRequired() && !$isRootOrShadowRoot(firstBlock.getParentOrThrow())`.
    It can be made false in two ways. The parent can be a shadow root,
    which is rejected above. Or the block can be parent-required, which is
    how the item's text escapes it; but `HeadingNode` and `QuoteNode` are
    Lexical's classes, and replacing them and every paragraph for this
    would change the type of most nodes in the document. The fuzz's 82
    records are spread over paragraphs, headings and quotes, so a handler
    is needed for at least two of the three, and one handler for all three
    is the smallest fix. It uses only `selection.insertParagraph()`,
    `append` and `splice`.

[^remove-hook]: Lexical calls `remove` on an item's text in four places.
    `$removeTextFromCaretRange` calls it on the block it merged into an
    earlier one (line 19498) and on an empty block a range ended at (line
    19509): both are joins, and the rest of the item follows. `insertNodes`
    calls it on the new block it split off once that block's text is joined
    to the last pasted block (line 9500): the rest of the item follows
    there too, which is what the branch's rows for a paste into the text of
    an item holding blocks pin. `deleteCharacter` calls it on an empty
    block before the caret's block instead of merging (line 9869): there
    the caret is inside the item, after the text, and only the text must
    go. The caret test tells that last case from the others; row S11 pins
    it. Lexical's own `ListItemNode.remove` is the precedent for a `remove`
    that changes the tree around the node.

[^empty-text]: Markdown has no item whose first line is empty over a
    paragraph: `-`, a blank line and an indented `p` is an empty item and a
    paragraph outside the list. So the branch made the first paragraph the
    item's text (rows T3, T11, T12), and rule 5 keeps that result. Before a
    nested list the branch keeps an empty item node that holds the caret
    (`li()`, `li(list)`), so that text typed next is the item's text (row
    V11). Rule 5's exception keeps that too. Markdown reads `-` over an
    indented list as an item holding the list, with or without the empty
    text.

[^transforms-per-type]: `registerNodeTransform` files a transform under the
    node's type name, and for a replaced class also under the class that
    replaces it
    ([Lexical.dev.mjs:14807](../node_modules/lexical/dist/Lexical.dev.mjs#L14807)).
    A subclass with its own type gets nothing from its parent's
    registrations: the codebase already registers `MarkdownSourceTextNode`
    beside `TextNode` for that reason. Lexical runs transforms for leaves
    that changed and for elements that were written; an element whose
    descendant changed is only marked, not transformed. On the prototype,
    before the paragraph rules were registered for the text node, the
    list-edit fuzz failed 7 of 3,000 documents on a nested list's looseness
    after its item's text was deleted.

[^one-step]: The importer cannot build the new shape while the listeners
    read the old one, and the reverse. Measured on the prototype: with only
    the importer, the serializer, the view model and the normal-form rule
    changed, and every listener still registered, 189 of 6,519 tests fail,
    among them the T, U, K, J, C and P rows. With the listeners removed and
    the hooks on, 126 fail, all in tests that state the old shape. There is
    no point between the two where the suite is green. Moving each
    behaviour into the node first, in the old shape, was considered: it
    would write `insertNewAfter`, the outdent and the join twice, once for
    a shape that is then deleted.

[^fuzz-map]: The harnesses live in
    `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/`:
    `impl/list-item-block-paste/zz-list-item-edit-fuzz.test.ts`,
    `column-paste/zz-column-paste-fuzz.test.ts` and
    `review-fixes/b/zz-table-edge-fuzz-lbdeclined.test.ts`. They are never
    committed. A mapped copy of the first is kept in the scratch folder as
    `zz-list-item-edit-fuzz.mapped.test.ts`. A document's number can mean a
    different document than on the branch once the first edit differs,
    since later random draws depend on the tree; compare classes, and
    replay any record of a new class on the branch before calling it new.

[^unsigned]: *Enter at the end of an item's text* gives a new item that
    takes the item's blocks, so the first of them becomes the new item's
    text (T3: `- wx`, `p2` gives `- wx\n\n- p2`). *A nested item moved out
    as its list's last item* takes the outer item's later blocks along (U1:
    `- a\n\n- b\n\n  c`). In this plan the second is one case of a single
    rule, "what followed the item inside the outer item moves into it",
    which also gives U3 and U4 and keeps the document's reading order. If
    the user decides otherwise, the first is one line of `insertNewAfter`
    (which siblings move to the new item) and the second is the `tail`
    line of `$outdentItem`.

[^join-rule]: On the branch a join moved all of an item's children into the
    block before it, and rule 2 then moved the blocks out. Where the item
    before ended in a block, the joined text stayed a run of its own after
    that block (`w2` after the quote), which no other join in the editor
    does and which cannot exist in the new model: an item holds no loose
    text after a block. Joining the text to that block is what Backspace
    does between a quote and a paragraph at the top level. What follows the
    text is unchanged: it goes to the end of the item before.

[^looseness-cost]: Today the test reads `$isParagraphNode(text.getParent())`
    to tell an item's paragraph from its own text, and `<= 2` counts an
    item and the item node holding its nested list. Every item's text is
    now a paragraph, so the unchanged test would read the list's looseness
    on every keystroke in every list. The branch measured that cost at 11.1
    ms a keystroke in a list of 300 items before it narrowed the test.

[^open-throw]: Seed 601, document 1161:
    `[d]: /first\n\n- w0\n\n\n  [d]: /u1 "t\n\n  u2"\n- w3\n\n  | h4 |\n  | --- |\n  | c5 |\n- * n6\n\n    p7\n\n# g12`.
    Seed 2207, document 376:
    `| t9 |\n| --- |\n| u10 |\n\n+ w0\n\n\n  ::: {align=center}\n  f1\n  :::\n  ***\n+ | h2 |\n  | --- |\n  | c3 |\n\n```\nk5\n```\n`
    (without the final newline). Both hold a list that loads as a raw
    block. The likely cause is a hook or a rule running on an item of a
    list that the importer built and then gave up on; the guards under
    *Internal Structure* were added after these runs and may already close
    it.
