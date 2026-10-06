---
depends-on: [markdown-editor-list-item-block-paste]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor List Toggle and Task Item Parity — Implementation Plan

## Overview

`MarkdownEditor` has two editing surfaces, WYSIWYG (Lexical) and source mode
(the raw Markdown text). `toggleUnorderedList()` and `toggleOrderedList()`
are documented as turning the selection into a list or out of one, on both.
Today the two surfaces disagree: on a task item (`- [ ] todo`) source mode
does nothing while WYSIWYG converts it, and in several other shapes they
produce documents the `Markdown` viewer shows differently.

This plan fixes one contract for the two toggles, the same on both surfaces,
and changes each surface where it breaks that contract. The same defect on a
task item exists in `setBlockType`, which shares the code, and is fixed with
it. The changes are in
[MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts)
(the WYSIWYG list route),
[markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts)
(the source-mode route) and one line of
[markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts).
A new test file runs 94 shapes through both surfaces and compares what the
viewer reads.

The plan is written against `63a81117d`, the tip of
`feature/markdown-raw-block-html-tail-parity`; line numbers are from that
commit, so find each site by its symbol name first. It depends on
`markdown-editor-list-item-block-paste`, which makes a list item holding
several blocks load as an editable list. Every result in this plan was
measured on that branch at `0d9902fb0`.[^prototype]

---

## What the two surfaces do today

Measured at `0d9902fb0`. Lines of a document are separated by ` ⏎ ` here; a
blank line shows as `⏎⏎`.

| # | Document | Selection, command | WYSIWYG | Source mode |
|---|---|---|---|---|
| 1 | `- [ ] one ⏎ - [x] two` | caret in `one`, bulleted | `\[ \] one`, then the list `- [x] two` | does nothing |
| 2 | same | caret in `one`, numbered | the whole list: `1. [ ] one ⏎ 2. [x] two` | does nothing |
| 3 | same | caret in `one`, `setBlockType("h2")` | `## \[ \] one` | does nothing |
| 4 | same | caret in `one`, `setBlockType("code")` | a code block holding `\[ \] one` | does nothing |
| 5 | `- one ⏎ - two ⏎ - three` | caret in `two`, numbered | the whole list numbered | `- one ⏎ 1. two ⏎ - three` |
| 6 | `- one ⏎   - inner ⏎ - three` | caret in `inner`, numbered | the nested list numbered, in place | `- one ⏎ 1. inner ⏎ - three` |
| 7 | `- one ⏎ - two ⏎⏎ three` | caret in `three`, bulleted | `- one ⏎ - two ⏎ - three` | `- one ⏎ - two ⏎⏎ - three`, a loose list |
| 8 | `one ⏎⏎ two` | both selected, bulleted | `- one ⏎ - two` | `- one ⏎⏎ - two`, a loose list |
| 9 | `- one ⏎⏎   second ⏎⏎ - two` | caret in `one`, bulleted | `onesecond ⏎⏎ - two` | `one ⏎⏎ - second ⏎⏎ - two` |
| 10 | same | caret in `second`, bulleted | nothing changes | `- one ⏎⏎ - second ⏎⏎ - two` |
| 11 | `> - one ⏎ > - two` | caret in `one`, bulleted | one item holding the text `> - one ⏎ > - two` | `one ⏎ > - two` |

Row 9 loses the document's structure: the item's second paragraph is moved
into the new paragraph and the save runs the two together. Row 10 reports
`canSetBlockType` as `true` and changes nothing.

---

## Architecture Decisions

### The contract — six rules, the same on both surfaces

**Terms.**

- A *text block* is a paragraph, a heading, or the text a list item opens
  with.
- A list item's *text* is its first block, when that block is a paragraph or
  a heading. On the WYSIWYG surface that is the `ListItemNode`'s own inline
  content, or the paragraph or heading node that is its first child.
- A list's *kind* is bulleted or numbered. A *task item* is an item of
  either kind whose text opens with the *task marker* `[ ] `, `[x] ` or
  `[X] `. There is no third kind of list.
- The *touched blocks* are the text blocks holding the selection's two ends
  and every text block between them. A caret touches one block.
- The *top level* is the document's top level, or the `:::` column the block
  stands in. A block never leaves its column.
- A list is *loose* when a blank line separates two of its blocks, else
  *tight*. The viewer wraps a loose list's item texts in paragraphs.

**Rules,** for a toggle of kind K:

1. **Direction.** The toggle is *off* when every touched block is the text
   of an item of a K list. Otherwise it is *on*.
2. **Off.** Each touched block becomes a paragraph at the top level. Every
   list around it is split there. What its item held after its text stays in
   the list, as an item.
3. **On.** Each touched block that is not already the text of a K-list item
   becomes an item of a K list at the top level; the lists around it are
   split there, as in rule 2. A touched block that already is such a text is
   left as it is. No untouched block changes.
4. **Joining.** A new item becomes the last item of a K list that ends right
   before it, or the first item of one that starts right after it, when that
   list is written with the same marker (`-`, `*` or `+`; `.` or `)`). New
   items made from neighbouring blocks form one list. The resulting list is
   tight, unless a list that was joined into it was loose.
5. **Task marker.** The marker belongs to its item's text. An item that
   stays an item (rule 3) keeps its marker. A text that stops being an
   item's text (rule 2, and every `setBlockType`) keeps the marker as the
   literal text it shows, written `\[ \] ` or `\[x\] `; in a code block it
   is written as it was, `[ ] `. What the item held after its text stays in
   a plain item.
6. **Availability.** `canSetBlockType` keeps its rule (see *`canSetBlockType`
   keeps its rule* below). Wherever it is `true` on the WYSIWYG surface,
   each toggle changes the document.

**Worked cases.** "Reads as" is what the viewer shows; both surfaces must
produce it.

| Case | Document | Selection | Toggle | Reads as | Rules |
|---|---|---|---|---|---|
| bulleted item | `- one ⏎ - two ⏎ - three` | caret in `two` | bulleted | list `one`; paragraph `two`; list `three` | 1 off, 2 |
| numbered item | `1. one ⏎ 2. two ⏎ 3. three` | caret in `two` | numbered | list `one`; paragraph `two`; list `three` | 1 off, 2 |
| item of the other kind | `- one ⏎ - two ⏎ - three` | caret in `two` | numbered | bulleted `one`; numbered `two`; bulleted `three` | 1 on, 3 |
| task item, its list's kind | `- [ ] one ⏎ - [x] two` | caret in `one` | bulleted | paragraph `[ ] one`; list with the task item `two` | 2, 5 |
| task item, the other kind | same | caret in `one` | numbered | numbered list with the task item `one`; bulleted list with the task item `two` | 3, 5 |
| task and plain items | `- [ ] one ⏎ - two ⏎ - three` | `one` to `two` | bulleted | paragraphs `[ ] one` and `two`; list `three` | 2, 5 |
| two lists of different kinds | `- one ⏎ - two ⏎⏎ 1. three ⏎ 2. four` | `two` to `three` | bulleted | tight bulleted `one`, `two`, `three`; numbered `four` | 1 on, 3, 4 |
| nested item, its list's kind | `- one ⏎   - inner ⏎ - three` | caret in `inner` | bulleted | list `one`; paragraph `inner`; list `three` | 2 |
| nested item, the other kind | same | caret in `inner` | numbered | bulleted `one`; numbered `inner`; bulleted `three` | 3 |
| item holding a nested list | same | caret in `one` | bulleted | paragraph `one`; a list whose first item holds the list `inner`, then `three` | 2 |
| item holding two paragraphs, its text | `- one ⏎⏎   second ⏎⏎ - two` | caret in `one` | bulleted | paragraph `one`; loose list `second`, `two` | 2 |
| the same item, its second paragraph | same | caret in `second` | bulleted | loose list `one`, `second`, `two` | 1 on, 3, 4 |
| loose list | `- one ⏎⏎ - two ⏎⏎ - three` | caret in `two` | bulleted | list `one`; paragraph `two`; list `three` | 2 |
| list in a `:::` column | `::: columns ⏎ - one ⏎ - two ⏎ \|\|\| ⏎ Right ⏎ :::` | caret in `one` | bulleted | in the left column: paragraph `one`; list `two` | 2 |
| paragraph after a tight list | `- one ⏎ - two ⏎⏎ three` | caret in `three` | bulleted | one tight list `one`, `two`, `three` | 3, 4 |
| two paragraphs | `one ⏎⏎ two` | both | bulleted | one tight list `one`, `two` | 3, 4 |

A caret and a range follow the same rules: a caret is a selection touching
one block.

The rules are stated in blocks. Six places remain where the two surfaces do
not hold the same blocks, or where a difference is left alone on purpose;
they are listed under *Non-Goals*, each with the test rows that pin it. The
one that concerns list items most: source mode selects by lines, and for a
block of several lines it acts on the selected lines only.

### A task marker is part of its item's text — the WYSIWYG surface is right

Source mode converts a task item as the WYSIWYG surface does (rule 5),
instead of doing nothing.[^marker-is-text]

### A toggle of the other kind changes the touched items only — source mode is right

On the WYSIWYG surface a numbered toggle in a bulleted list (and the
reverse) no longer converts the whole list. It changes the touched items
alone and splits their list around them (rule 3), as source mode does. To
convert a whole list, select it.[^selected-only]

### A converted block lands at the top level, also out of a nested list — source mode is right

A nested item that changes kind becomes an item at the top level, as a
nested item that leaves its list becomes a paragraph there. The WYSIWYG
surface no longer converts a nested list in place.[^top-level]

### A new item joins the list next to it and leaves it tight — the WYSIWYG surface is right

Source mode follows rule 4. It writes neighbouring new items line after
line, writes them with the marker of the K list they join, continues a
numbered list's count, and removes the blank lines between the new items and
a tight list they join.[^joining]

### Only an item's text is "the item"; a block the item holds after it is not — source mode is right

For an item holding several blocks, the rules apply to each block
separately. The item's text follows rules 1–3 as any item's text does. A
block the item holds after its text is not an item's text, so a toggle on it
is always *on*: the block becomes an item of its own (rule 3). The WYSIWYG
surface is changed to do this, and to stop moving an item's other blocks
into the block that replaces the item.[^item-blocks]

### A list inside a quote stays a raw block on the WYSIWYG surface

The WYSIWYG surface loads a quote that holds a list as a *raw Markdown
block*: it shows the source text in a monospace font, not a list. There the
toggles act on the raw block as they do on every raw block — its text
becomes one item. Source mode applies the six rules to the list inside the
quote. The two results differ; the parity test pins both, so neither can
drift.[^quote-raw]

### `canSetBlockType` keeps its rule

| Surface | `canSetBlockType` |
|---|---|
| WYSIWYG | `true` for a range selection (a caret included) that touches no table cell; `false` with no selection, with table cells selected, and while read-only |
| Source mode | always `true` (`false` while read-only): where a source command declines is not predicted |

Every list shape in this plan reports `true`. The stack's rule for the field
— `true` means the command changes the document or the selection — holds for
the toggles on every row of the parity matrix once row 10 of the table above
is fixed.[^availability]

### WYSIWYG: the editor makes the list items itself — Lexical's insert command is no longer used

`toggleList` keeps its off route, `setBlockType("paragraph")`. Its on route
no longer dispatches Lexical's `INSERT_UNORDERED_LIST_COMMAND` /
`INSERT_ORDERED_LIST_COMMAND`. A new function, `$makeListItems`, takes each
touched block out of the lists around it and makes it an item of a K list
where it then stands. The precedent is the off route itself
([MarkdownEditor.ts:4113](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4113)),
which the context-menu-caret work built on `setBlockType` after measuring
that Lexical's own list command acts on the whole list; the joining step
mirrors `@lexical/list`'s unexported `$createListOrMerge`
([LexicalList.dev.mjs:221](../node_modules/@lexical/list/dist/LexicalList.dev.mjs#L221)).[^own-route]

### WYSIWYG: an item's other blocks are moved out before the item is replaced

Before `setBlockType` and the toggles replace a list item, a new function,
`$isolateItemText`, moves every block the item holds after its text into a
new list item right after it. The shape — a `ListItemNode` that continues
the item before it — is the one Lexical and the importer already use for a
nested list.[^holder]

### Source mode: the marker travels through the existing lift

The source-mode commands keep their design: lift each target block to the
top level with `liftLines`, then check the result by lexing it
(`readsAsExpected`). The change is in what a target carries and what the
check expects: a task item's marker goes with the item's text, and the check
expects the marker's characters as text (or, for an item that stays an item,
the marker in its new list). No new edit mechanism is added.[^source-design]

### Parity is pinned by a matrix on what the viewer reads

A new test file runs every row through both surfaces and asserts three
things: the exact Markdown the WYSIWYG surface saves, the exact Markdown
source mode leaves, and that the viewer reads the two alike
(`viewerModel(a).blocks` equals `viewerModel(b).blocks`). The model is the
existing both-surfaces test
([markdown-editor.test.ts:836](../packages/lib/tests/component/markdown-editor.test.ts#L836)),
extended to a table. Rows where the surfaces differ on purpose are listed in
the same file and must *not* read alike, so a later fix turns them
red.[^matrix]

---

## Internal Structure

All new functions are module-private. Give each a JSDoc block in the file's
style (description, blank line, `@param` / `@returns`). Assign a call's
result to a variable before testing it, as the surrounding code does; a
type guard that narrows (`$isListItemNode(block)`) is tested directly.

### `MarkdownEditor.ts` — WYSIWYG

Add `$createListNode` and `$createListItemNode` to the `@lexical/list`
import and `ListItemNode` to its type import; add `$setState` to the
`lexical` import, `listLooseState` to the `markdownNodeState.js` import and
`$writtenListMarker` to the `markdownSerializer.js` import. Remove
`INSERT_UNORDERED_LIST_COMMAND` and `INSERT_ORDERED_LIST_COMMAND` from the
`@lexical/list` import (`registerList` stays).

Replace the body of `$selectionLiesInListOfType`
([:2425](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2425))
and add the functions below it, before `$blocksTouchedBy`:

```typescript
function $selectionLiesInListOfType(type: ListType): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    return $blocksTouchedBy(selection).every((block) => $isItemTextOfListType(block, type));
}

// The list item a block is the text of: the block itself when it is a list item,
// or the item a paragraph or heading opens. `null` for any other block.
function $itemOfText(block: ElementNode | null): ListItemNode | null {
    if ($isListItemNode(block)) {
        return block;
    }

    const parent = block === null ? null : block.getParent();
    const opensItem = $isListItemNode(parent) && parent.getFirstChild() === block;
    const isText = $isParagraphNode(block) || $isHeadingNode(block);

    return opensItem && isText ? parent : null;
}

function $isItemTextOfListType(block: ElementNode | null, type: ListType): boolean {
    const list = $itemOfText(block)?.getParent();

    return $isListNode(list) && list.getListType() === type;
}

// Leaves a list item holding its text alone, so it can be replaced by another
// block without taking the item's other blocks along.
function $isolateItemText(block: ElementNode): ListItemNode | null {
    const item = $itemOfText(block);

    if (item === null) {
        return null;
    }

    if (item !== block) {
        // The children move first: removing a block that still holds the caret would move the caret off its text.
        item.splice(0, 0, block.getChildren());
        block.remove();
    }

    const children = item.getChildren();
    const firstBlock = children.findIndex((child) => $isElementNode(child) && !child.isInline());
    // An item whose first child is a nested list is the rest of the item before it: it holds no text of its own.
    const continuesItemBefore = firstBlock === 0 && $isListNode(children[0]);

    if (firstBlock !== -1 && !continuesItemBefore) {
        $moveToItemAfter(item, children.slice(firstBlock));
    }

    return item;
}

// Moves blocks of a list item to a new item after it. A paragraph that comes
// first gives the new item its inline content, the form a load gives an item's text.
function $moveToItemAfter(item: ListItemNode, blocks: LexicalNode[]): void {
    const [first, ...rest] = blocks;

    if (first === undefined) {
        return;
    }

    const holder = $createListItemNode();

    item.insertAfter(holder);

    if ($isParagraphNode(first)) {
        holder.splice(0, 0, first.getChildren());
        first.remove();
    } else {
        holder.splice(0, 0, [first]);
    }

    holder.splice(holder.getChildrenSize(), 0, rest);
}

// Takes a block out of the list items around it, to the root or its `:::` column,
// as a paragraph. A block in no list item is returned as it is.
function $liftOutOfLists(block: ElementNode): ElementNode {
    const holder = block.getParent();
    let item = $isolateItemText(block);

    if (item === null && !$isListItemNode(holder)) {
        return block;
    }

    if (item === null && $isListItemNode(holder)) {
        // A block an item holds after its text becomes an item of its own first.
        $moveToItemAfter(holder, block.getNextSiblings());
        item = $createListItemNode();
        holder.insertAfter(item);
        item.splice(0, 0, block.getChildren());
        block.remove();

        const emptied = holder.isEmpty();

        if (emptied) {
            holder.remove();
        }
    }

    const paragraph = $createParagraphNode();

    // ListItemNode.replace outdents the item to the top of its lists and splits them around the paragraph.
    item!.replace(paragraph, true);

    return paragraph;
}

// Makes a block standing outside every list an item of a list of one kind, where it stands.
function $itemizeBlock(block: ElementNode, type: ListType): void {
    const item = $createListItemNode();
    const previous = block.getPreviousSibling();
    const next = block.getNextSibling();
    const joinsPrevious = $isListNode(previous) && previous.getListType() === type;
    const joinsNext = $isListNode(next) && next.getListType() === type;
    const selection = $getSelection();

    item.splice(0, 0, block.getChildren());

    if (joinsPrevious) {
        // The list transform joins `next` into `previous` when their markers match; a loose one makes the whole list loose.
        const meetsLoose = joinsNext && $getState(next, listLooseState) && $writtenListMarker(next) === $writtenListMarker(previous);

        if (meetsLoose) {
            $setState(previous, listLooseState, true);
        }

        previous.append(item);
        block.remove();
    } else if (joinsNext) {
        next.splice(0, 0, [item]);
        block.remove();
    } else {
        const list = $createListNode(type);

        list.append(item);
        block.replace(list);
    }

    if ($isRangeSelection(selection)) {
        // A caret in an empty block is held on the block itself, which is gone.
        for (const point of [selection.anchor, selection.focus]) {
            if (point.key === block.getKey()) {
                point.set(item.getKey(), 0, "element");
            }
        }
    }
}

// The blocks a range selection touches, each once, last first: an order in which
// changing one block never moves a block still to be changed.
function $touchedBlocksLastFirst(selection: RangeSelection): ElementNode[] {
    const blocks = [...new Set($blocksTouchedBy(selection))].filter((block) => block !== null);

    // `isBefore` does not order a block against a block it holds: the holder comes first in the document.
    return blocks.sort((a, b) => (b.isParentOf(a) || (!a.isParentOf(b) && b.isBefore(a)) ? -1 : 1));
}

function $makeListItems(selection: RangeSelection, type: ListType): void {
    const blocks = $touchedBlocksLastFirst(selection).filter((block) => !$isItemTextOfListType(block, type));

    for (const block of blocks) {
        const attached = block.isAttached();

        if (attached) {
            $itemizeBlock($liftOutOfLists(block), type);
        }
    }
}

function $isolateTouchedItemTexts(selection: RangeSelection): void {
    for (const block of $touchedBlocksLastFirst(selection)) {
        const attached = block.isAttached();

        if (attached) {
            $isolateItemText(block);
        }
    }
}
```

Three existing sites change:

```typescript
// $selectedBlocksHaveType (:2466) — the last statement becomes:
return $blocksTouchedBy(selection).every((block) => {
    // A paragraph or heading that opens a list item is that item's text, which the conversion takes out of its list.
    const opensItem = !$isListItemNode(block) && $itemOfText(block) !== null;

    return !opensItem && ($isHeadingNode(block) ? block.getTag() : block?.getType()) === type;
});

// toggleList (:4113) — drop the `insert` parameter; the on route becomes:
editor.update(() => {
    const selection = $getSelection();

    if ($isRangeSelection(selection)) {
        $moveBlockPointsIntoText(selection);
        $makeListItems(selection, type);
    }
}, { discrete: true });

// setBlockType (:5110) — inside its update, before $setBlocksType:
$isolateTouchedItemTexts(selection);
```

`toggleUnorderedList` and `toggleOrderedList` call `this.toggleList("bullet")`
and `this.toggleList("number")`.

`$copyBlockAsCodeSource`
([:350](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L350))
passes whether the block is a list item, so that a task marker is written
into the code as it was:

```typescript
const markdown = $serializeInlineNodes(block.getChildren(), $isListItemNode(block));
```

### `markdownSerializer.ts`

`$serializeInlineNodes`
([:774](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L774))
gains a second parameter, documented in its JSDoc as "whether the nodes are
a list item's text, whose first line may open with a task marker":

```typescript
export function $serializeInlineNodes(nodes: LexicalNode[], inListItem: boolean = false): string {
    return serializeInlineNodes(nodes, { ...MULTI_LINE, definitions: $collectDefinitions(), inListItem });
}
```

### `markdownSourceLines.ts` — the task marker

`marked` gives a task marker in one of two shapes, and both must be handled:

| List | Where the marker is | The item's text token |
|---|---|---|
| tight (`- [ ] one ⏎ - [x] two`) | a `checkbox` block of its own, before the text | `text` with `text: "one"` |
| loose (`- [ ] one ⏎⏎ - [x] two`) | an inline `checkbox:[ ] ` leaf opening the paragraph | `paragraph` with `text: "[ ] one"` |

`readLeaves`
([:156](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L156))
reads both shapes as the first one, so a result that turns one shape into
the other still compares equal. Its leaf branch becomes:

```typescript
if (entry.kind === "leaf") {
    if (entry.key.startsWith("checkbox:")) {
        // A loose item's marker is an inline leaf of its paragraph, a tight item's a block of its own: both read as that block.
        leaves.push({ key: entry.key, path: [...stack], block: block - 0.5, entry: index, offset: entry.start });
    } else if (entry.key !== "br" && !/^t\s$/.test(entry.key)) {
        leaves.push({ key: entryKey(entry, entryFormat(entry)), path: [...stack, textBlock], block, entry: index, offset: entry.start });
    }

    return;
}
```

`block - 0.5` is a block number no other leaf has, so the marker is never
counted as sharing a block with the text after it — which is how the tight
shape already reads.

`expectLeaves`
([:280](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L280))
lets one leaf become several, and takes the task items whose marker a
command takes out:

```typescript
function expectLeaves(
    leaves: readonly LeafView[], change: (leaf: LeafView) => ExpectedLeaf | readonly ExpectedLeaf[] | null | undefined,
    unmarked: readonly SourceBlockNode[] = [],
): ExpectedLeaf[] {
    const expected: ExpectedLeaf[] = [];

    for (const leaf of leaves) {
        const changed = change(leaf);

        if (changed === null) {
            expected.push({ key: leaf.key, path: pathWithoutTakenMarkers(leaf, unmarked), group: `o${leaf.block}` });
        } else if (changed !== undefined) {
            expected.push(...(Array.isArray(changed) ? changed as readonly ExpectedLeaf[] : [changed as ExpectedLeaf]));
        }
    }

    return expected;
}

// A kept leaf's path once the task markers of `unmarked` items have left them: such an item is a plain item.
function pathWithoutTakenMarkers(leaf: LeafView, unmarked: readonly SourceBlockNode[]): readonly string[] {
    let path = leaf.path;

    for (const item of unmarked) {
        if (item.entryStart < leaf.entry && leaf.entry < item.entryEnd) {
            // Every block around an item writes one path segment, so the item's own is at its depth.
            path = path.map((segment, index) => (index === depthOf(item) ? "item:false:false" : segment));
        }
    }

    return path;
}

// How many blocks hold a node.
function depthOf(node: SourceBlockNode): number {
    let depth = 0;

    for (let parent = node.parent; parent !== null; parent = parent.parent) {
        depth += 1;
    }

    return depth;
}
```

Add after `blockTextLines`
([:517](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L517)):

```typescript
/** A task item's marker, as the item's text block carries it. */
interface TaskMarker {
    /** The marker as written, with the space after it: `[ ] `, `[x] ` or `[X] `. */
    readonly raw:   string;
    /** The index of the marker's entry in the analysis. */
    readonly entry: number;
    /** Whether the marker is a block of its own before the text (a tight item), not the start of the text (a loose one). */
    readonly own:   boolean;
}

/** A task marker opening a loose item's first paragraph. */
const TASK_MARKER_START = /^\[[ xX]\] /;

/** A leaf that is a task marker; the group is the character between the brackets. */
const TASK_MARKER_LEAF = /^checkbox:\[([ xX])\]/;

// The marker of the task item a block is the text of, `null` for any other block.
function taskMarkerOf(node: SourceBlockNode): TaskMarker | null {
    const item = node.parent;

    if (item?.type !== "list_item" || (item.token as Tokens.ListItem).task !== true) {
        return null;
    }

    const first = item.children[0]!;

    if (first.type === "checkbox") {
        return item.children[1] === node ? { raw: first.token!.raw, entry: first.entryStart, own: true } : null;
    }

    const start = TASK_MARKER_START.exec((node.token as { text: string }).text);

    return first === node && start !== null ? { raw: start[0], entry: node.entryStart + 1, own: false } : null;
}

// The task items whose marker leaves with one of `targets`.
function itemsLosingMarker(targets: readonly SourceBlockNode[]): SourceBlockNode[] {
    return targets.filter((target) => target.type !== "code" && taskMarkerOf(target) !== null).map((target) => target.parent!);
}

// The first entry a target owns: its marker's, when the marker is a block before it.
function firstEntryOf(node: SourceBlockNode): number {
    const marker = taskMarkerOf(node);

    return marker === null ? node.entryStart : Math.min(marker.entry, node.entryStart);
}

// A text block's lines with its task marker: as the text it shows (`\[ \] `), or as written (`[ ] `).
function textLinesOf(node: SourceBlockNode, markerAs: "text" | "written"): string[] {
    const lines = blockTextLines(node);
    const marker = node.type === "code" ? null : taskMarkerOf(node);

    if (marker === null) {
        return lines;
    }

    const rest = marker.own ? lines[0]! : lines[0]!.slice(marker.raw.length);
    const shown = markerAs === "written" ? marker.raw : marker.raw.replace("[", "\\[").replace("]", "\\]");

    return [shown + rest, ...lines.slice(1)];
}

// The text leaves a task marker reads as once it is literal text; `null` for a leaf that is no marker.
function markerTextLeaves(leaf: LeafView, path: readonly string[], group: string): ExpectedLeaf[] | null {
    const marker = TASK_MARKER_LEAF.exec(leaf.key);

    if (marker === null) {
        return null;
    }

    return ["[", marker[1]!, "]"].filter((char) => char !== " ").map((char) => ({ key: `t${char}|||`, path, group }));
}
```

`t[|||` is the key `entryKey` gives a plain `[`: the letter `t`, the
character, and three empty format fields. A space is left out because
`readLeaves` leaves whitespace out.

Five call sites use these:

| Function | Change |
|---|---|
| `targetOfEntry` ([:898](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L898)) | `target.entryStart <= entry` becomes `firstEntryOf(target) <= entry` |
| `convertBlocks` ([:917](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L917)) | `blockTextLines(target)` becomes `textLinesOf(target, "text")`; the expected leaf becomes `markerTextLeaves(leaf, path, group) ?? { key: leaf.key, path, group }`; pass `itemsLosingMarker(targets)` as `expectLeaves`'s third argument |
| `FENCED_CODE_SOURCE` ([:1032](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1032)) | pass `itemsLosingMarker(targets)` as `expectLeaves`'s third argument |
| `fencedContent` ([:1081](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1081)) | `blockTextLines(target)` becomes `textLinesOf(target, "written")` |
| `listOff` ([:1181](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1181)) | as `convertBlocks`: `textLinesOf(target, "text")`, `markerTextLeaves(…) ?? …`, and `itemsLosingMarker(targets)` |

In `convertBlocks` and `listOff`, `path` and `group` are the values the
existing expected leaf already uses (`[...columnPath(leaf.path), ...kind]`
with `` `t${index}${line}` ``, and `[...columnPath(leaf.path), "p"]` with
`` `t${index}` ``).

### `markdownSourceLines.ts` — `listOn`

Replace `listOn`
([:1212](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1212))
with the functions below.

```typescript
function listOn(analysis: SourceAnalysis, targets: readonly SourceBlockNode[], selected: ReadonlySet<number>, kind: "unordered" | "ordered"): MarkdownSourceEdit | null {
    const text = analysis.text;
    const plans: ListPlan[] = targets.map((target) => {
        const lines = nodeLines(text, target);
        const converted = lines.map((line) => selected.has(line.start) && !isMarkerLine(text, target, line.start, kind));

        return { target, lines, converted, first: converted.indexOf(true) };
    }).filter((plan) => plan.first !== -1);

    if (plans.length === 0) {
        return null;
    }

    const join = readListJoin(analysis, plans, kind);
    const replacements = againstTightNeighbours(text, itemReplacements(text, plans, join, kind), join);

    return firstReadingEdit(analysis, () => replacements, expectedItemLeaves(analysis, plans, kind), replacements.map(() => null), false);
}

/** One block a list-on edit touches, with the lines of it that become items. */
interface ListPlan {
    readonly target:    SourceBlockNode;
    readonly lines:     SourceLine[];
    /** Per line of the block, whether it becomes a new item. */
    readonly converted: boolean[];
    /** The index of the first line that does. */
    readonly first:     number;
}

/** The lists the new items of a list-on edit join, and the marker the items are written with. */
interface ListJoin {
    /** The list ending right above the first new item, blank lines aside; `null` for none. */
    readonly above:     SourceBlockNode | null;
    /** The list starting right below the last new item, written with the same marker; `null` for none. */
    readonly below:     SourceBlockNode | null;
    readonly bullet:    string;
    readonly delimiter: string;
    /** The number the first new item of a numbered list takes. */
    readonly start:     number;
}

function expectedItemLeaves(analysis: SourceAnalysis, plans: readonly ListPlan[], kind: "unordered" | "ordered"): ExpectedLeaf[] {
    const list = `list:${String(kind === "ordered")}`;
    const unmarked = itemsLosingMarker(plans.filter((plan) => plan.first === 0).map((plan) => plan.target));

    return expectLeaves(readLeaves(analysis), (leaf) => {
        const index = plans.findIndex((plan) => firstEntryOf(plan.target) <= leaf.entry && leaf.entry < plan.target.entryEnd);

        if (index === -1) {
            return null;
        }

        const { target, lines, converted, first } = plans[index]!;
        const line = lines.findIndex((candidate) => candidate.start <= leaf.offset && leaf.offset <= candidate.end);
        const group = converted.lastIndexOf(true, line);

        if (line < first) {
            return null;
        }

        // Only the item made from the block's first line carries the marker that line opens with.
        const item = group === 0 && taskMarkerOf(target) !== null ? itemSignature(target.parent!) : "item:false:false";
        const path = [...columnPath(leaf.path), list, item];

        return TASK_MARKER_LEAF.test(leaf.key)
            ? { key: leaf.key, path, group: `t${index}:${group}:marker` }
            : { key: leaf.key, path: [...path, "p"], group: `t${index}:${group}` };
    }, unmarked);
}

function readListJoin(analysis: SourceAnalysis, plans: readonly ListPlan[], kind: "unordered" | "ordered"): ListJoin {
    const first = plans[0]!;
    const last = plans[plans.length - 1]!;
    const above = neighbourList(analysis, first.target, first.lines[first.first]!.start, -1, kind);
    const listBelow = neighbourList(analysis, last.target, last.lines[last.lines.length - 1]!.start, 1, kind);
    const styled = containingList(first.target, kind) ?? above ?? listBelow;
    const marker = styled === null ? { bullet: "-", delimiter: "." } : listMarkerOf(styled);
    const sameMarker = listBelow !== null && (kind === "unordered"
        ? listMarkerOf(listBelow).bullet === marker.bullet
        : listMarkerOf(listBelow).delimiter === marker.delimiter);

    // A list written with another marker stays a list of its own, so the new items do not join it.
    return { above, below: sameMarker ? listBelow : null, ...marker, start: above === null ? 1 : nextNumberOf(above) };
}

function itemReplacements(text: string, plans: readonly ListPlan[], join: ListJoin, kind: "unordered" | "ordered"): LineReplacement[] {
    const replacements: LineReplacement[] = [];
    let number = join.start;

    for (const { target, lines, converted, first } of plans) {
        const written = textLinesOf(target, "written").slice(first).map((line, offset) => {
            if (!converted[first + offset]!) {
                return line;
            }

            const marker = kind === "unordered" ? join.bullet : `${number}${join.delimiter}`;

            number += 1;

            return `${marker} ${line.trimStart()}`;
        });
        const previous = replacements[replacements.length - 1];
        const firstLine = lines[first]!.start;
        const lastLine = lines[lines.length - 1]!.end;
        // Blocks with only blank lines between them share one replacement: their items stand line after line.
        const adjoins = previous !== undefined && isBlank(text.slice(previous.last + 1, Math.max(previous.last + 1, firstLine - 1)));

        if (adjoins) {
            replacements[replacements.length - 1] = { first: previous.first, last: lastLine, lines: [...previous.lines, ...written], nodes: [...previous.nodes, target] };
        } else {
            replacements.push({ first: firstLine, last: lastLine, lines: written, nodes: [target] });
        }
    }

    return replacements;
}

// Takes the blank lines between the new items and a tight list they join into the replacements.
function againstTightNeighbours(text: string, replacements: readonly LineReplacement[], join: ListJoin): LineReplacement[] {
    const joined = [join.above, join.below].filter((list) => list !== null);
    const tight = joined.every((list) => !(list.token as Tokens.List).loose);
    const result = [...replacements];
    const last = result.length - 1;

    if (tight && join.above !== null) {
        result[0] = { ...result[0]!, first: lineEndAt(text, join.above.end - 1) + 1 };
    }

    if (tight && join.below !== null) {
        result[last] = { ...result[last]!, last: lineStartAt(text, join.below.start) - 1 };
    }

    return result;
}

function itemSignature(item: SourceBlockNode): string {
    const token = item.token as Tokens.ListItem;

    return `item:${String(token.task)}:${String(token.checked ?? false)}`;
}

// The nearest `:::` column around a block, `null` at the top level.
function columnOf(node: SourceBlockNode): SourceBlockNode | null {
    for (let parent = node.parent; parent !== null; parent = parent.parent) {
        if (parent.type === "column") {
            return parent;
        }
    }

    return null;
}

// The list of `kind` at the level the new item lands on whose last line (above) or first line (below)
// is the nearest line that is not blank. A list holding the block is not a neighbour: the lift splits it.
function neighbourList(
    analysis: SourceAnalysis, target: SourceBlockNode, lineStart: number, direction: -1 | 1, kind: "unordered" | "ordered",
): SourceBlockNode | null {
    const text = analysis.text;
    const at = nearestTextLine(text, lineStart, direction);
    const column = columnOf(target);
    const found = at === -1 ? undefined : allNodes(analysis.tree).find((node) => node.type === "list" && node.start !== -1
        && (node.parent === null || node.parent.type === "column") && columnOf(node) === column
        && lineStartAt(text, direction === -1 ? node.end - 1 : node.start) === at);

    if (found === undefined || (found.token as Tokens.List).ordered !== (kind === "ordered") || isAncestor(found, target)) {
        return null;
    }

    return found;
}

// The start of the nearest line above or below that is not blank, `-1` for none.
function nearestTextLine(text: string, lineStart: number, direction: -1 | 1): number {
    let at = lineStart;

    do {
        const end = lineEndAt(text, at);

        at = direction === -1 ? (at === 0 ? -1 : lineStartAt(text, at - 1)) : (end >= text.length ? -1 : end + 1);
    } while (at !== -1 && isBlank(text.slice(at, lineEndAt(text, at))));

    return at;
}

// The outermost list around a block, when it is of `kind`: the list a lifted item lands inside.
function containingList(target: SourceBlockNode, kind: "unordered" | "ordered"): SourceBlockNode | null {
    for (let parent = target.parent; parent !== null; parent = parent.parent) {
        if (parent.type === "list" && (parent.parent === null || parent.parent.type === "column")) {
            return (parent.token as Tokens.List).ordered === (kind === "ordered") ? parent : null;
        }
    }

    return null;
}

// A list's bullet character (`-` for a numbered list) and numbered delimiter (`.` for a bulleted one).
function listMarkerOf(list: SourceBlockNode): { bullet: string; delimiter: string } {
    const marker = ITEM_MARKER.exec((list.token as Tokens.List).items[0]!.raw)?.[2] ?? "-";

    return { bullet: /^[-+*]$/.test(marker) ? marker : "-", delimiter: marker.endsWith(")") ? ")" : "." };
}

// The number the item after a numbered list's last takes.
function nextNumberOf(list: SourceBlockNode): number {
    const token = list.token as Tokens.List;

    return Number(token.start) + token.items.length;
}
```

How the join decides, with the marker and the blank lines it gives:

| Document | New item from | Toggle | Source mode writes | Why |
|---|---|---|---|---|
| `* one ⏎ * two ⏎⏎ three` | `three` | bulleted | `* one ⏎ * two ⏎ * three` | joins the tight list above: its marker, no blank line |
| `1) a ⏎ 2) b ⏎⏎ mid` | `mid` | numbered | `1) a ⏎ 2) b ⏎ 3) mid` | its delimiter, the next number |
| `zero ⏎⏎ - one ⏎ - two` | `zero` | bulleted | `- zero ⏎ - one ⏎ - two` | joins the tight list below |
| `- a ⏎ - b ⏎⏎ mid ⏎⏎ - c ⏎⏎ - d` | `mid` | bulleted | `- a ⏎ - b ⏎⏎ - mid ⏎⏎ - c ⏎⏎ - d` | a joined list is loose, so the result is loose and the blank lines stay |
| `* a ⏎ * b ⏎⏎ mid ⏎⏎ - c ⏎⏎ - d` | `mid` | bulleted | `* a ⏎ * b ⏎ * mid ⏎⏎ - c ⏎⏎ - d` | the list below is written with another marker, so it is not joined |
| `- one ⏎ - two ⏎⏎ three` | `three` | numbered | `- one ⏎ - two ⏎⏎ 1. three` | no numbered list to join: nothing is removed |
| `* one ⏎⏎   second ⏎⏎ * two` | `second` | bulleted | `* one ⏎⏎ * second ⏎⏎ * two` | the list around the block gives the marker |

---

## Ordered Implementation Steps

Work test-first: steps 2–4 write failing tests, steps 5–9 make them pass.
Run commands from `packages/lib`.

1. **Check the dependency.** `ls ../../plans/implemented/ | grep markdown-editor-list-item-block-paste`
   must print the plan. If it does not, stop: the M rows of the matrix need
   that branch.
2. **Create the parity test**
   `tests/component/markdown-roundtrip/markdown-list-toggle-parity.test.ts`
   as *Expected Behaviour › The parity test file* specifies, with the `ROWS`
   and `DIFFERS` tables copied exactly. Run it:
   `npx vitest run tests/component/markdown-roundtrip/markdown-list-toggle-parity.test.ts`.
   Expect 20 `ROWS` tests to pass (the controls listed there) and 74 to
   fail. If an M row fails on "loads as an editable list", the dependency is
   missing (step 1).
3. **Add the source-mode unit tests** of *Expected Behaviour › Source-mode
   unit cases* to `tests/component/markdown-source-edits.test.ts`, in a new
   `describe('line commands and task items')` and a new
   `describe('listSource joins the list next to it')` after
   `describe('listSource')`. Update the existing test at
   [:1319](../packages/lib/tests/component/markdown-source-edits.test.ts#L1319)
   (see *Existing tests that change*). Run the file; the new tests fail.
4. **Update and add the WYSIWYG tests** in
   `tests/component/markdown-editor.test.ts`: the two changed `CASES` rows
   and the new tests of *Expected Behaviour › WYSIWYG-only cases*, all in
   `describe('MarkdownEditor list toggles in a list of their kind')`
   ([:716](../packages/lib/tests/component/markdown-editor.test.ts#L716)).
5. **`markdownSourceLines.ts`, the task marker.** Make the `readLeaves`,
   `expectLeaves` and helper changes and the five call-site changes of
   *Internal Structure › the task marker*. Check:
   `npx vitest run tests/component/markdown-source-edits.test.ts` — the
   `line commands and task items` tests that do not use a list-on toggle
   pass, and no test that passed before fails.
6. **`markdownSourceLines.ts`, `listOn`.** Replace `listOn` as *Internal
   Structure › `listOn`* gives it. Check: the whole
   `markdown-source-edits.test.ts` file passes.
7. **`markdownSerializer.ts`.** Add the `inListItem` parameter to
   `$serializeInlineNodes`. Check: `npm run typecheck`.
8. **`MarkdownEditor.ts`.** Make the import changes, add the new functions,
   and change `$selectionLiesInListOfType`, `$selectedBlocksHaveType`,
   `toggleList`, `toggleUnorderedList`, `toggleOrderedList`, `setBlockType`
   and `$copyBlockAsCodeSource` as *Internal Structure › WYSIWYG* gives
   them. Check:
   `grep -n 'INSERT_UNORDERED_LIST_COMMAND\|INSERT_ORDERED_LIST_COMMAND' src/typescript/lib/component/editor/MarkdownEditor.ts`
   — expect zero matches.
9. **Update the JSDoc** of `toggleUnorderedList`, `toggleOrderedList`,
   `setBlockType` and the private `toggleList` in `MarkdownEditor.ts`, and
   of `listSource`, `blockPrefixSource`, `FENCED_CODE_SOURCE`,
   `readLineTargets`, `SKIPPED_NODE_TYPES` and the module header comment in
   `markdownSourceLines.ts`, to the texts in *Documentation Impact*.
10. **Run the Markdown tests:**
    `npx vitest run tests/component/markdown-roundtrip tests/component/markdown-editor.test.ts tests/component/markdown-source-edits.test.ts tests/component/markdown-editor-columns.test.ts tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-document-panel.test.ts tests/component/markdown-serializer.test.ts tests/component/markdown-importer.test.ts tests/component/markdown-source-preservation.test.ts`.
    All pass.
11. **Update the docs and the changelog** as *Documentation Impact* gives
    them.
12. **Run the checks** of *Verification*, then the manual cases.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/markdown-roundtrip/markdown-list-toggle-parity.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Everything in the first four subsections is **testable offline**, in the
headless editor under the modelled DOM. The last subsection lists what
**needs manual verification** in a browser.

### The parity test file

`markdown-list-toggle-parity.test.ts` installs the test DOM as
`markdown-edit-fuzz.test.ts` in the same folder does (`installTestDOM` in
`beforeEach`, `DOM.reset()` in `afterEach`), and defines:

```typescript
type CommandName = 'UL' | 'OL' | 'paragraph' | 'h2' | 'quote' | 'code';

const COMMANDS: Record<CommandName, (editor: MarkdownEditor) => unknown> = {
    UL:        (editor) => editor.toggleUnorderedList(),
    OL:        (editor) => editor.toggleOrderedList(),
    paragraph: (editor) => editor.setBlockType('paragraph'),
    h2:        (editor) => editor.setBlockType('h2'),
    quote:     (editor) => editor.setBlockType('quote'),
    code:      (editor) => editor.setBlockType('code'),
};

/** [id, document, word the selection starts in, word it ends in (null: a caret), command, what WYSIWYG saves, what source mode leaves] */
type Row = [id: string, doc: string, from: string, to: string | null, command: CommandName, wysiwyg: string, source: string];
```

**Selection.** For a row's words `from` and `to` (`to` is `from` when
`null`):

- WYSIWYG: in a discrete update, find the first text node whose text
  contains `from` and the first whose text contains `to`; select from
  `indexOf(from) + 1` in the first to `indexOf(to) + 1` in the second.
- Source mode: build `new MarkdownEditor(doc, { mode: 'source' })` and mock
  its private `_codeEditor.getSelection` (with `vi.spyOn`) to return
  `{ characterCount: 0, lineCount: 1, from: a, to: b }`, where `a` and `b`
  are the smaller and the larger of `doc.indexOf(from) + 1` and
  `doc.indexOf(to) + 1`. This is what the existing test at
  [markdown-editor.test.ts:849](../packages/lib/tests/component/markdown-editor.test.ts#L849)
  does.

**Each `ROWS` row is one test** named `` `${id} ${command}` `` asserting, in
this order:

1. `canonicalSave` of an editor loaded with `doc` equals `doc`: the document
   is in the form the editor saves.
2. The loaded WYSIWYG document holds no `MarkdownRawBlockNode` (walk the
   root's descendants with `$isMarkdownRawBlockNode`); message: "loads as an
   editable list".
3. `getSelectionState().canSetBlockType` is `true` on the WYSIWYG editor
   before the command.
4. After the command the WYSIWYG editor's `getValue()` equals `wysiwyg`, and
   differs from `doc`.
5. A new editor loaded with that value saves the same value.
6. `editorSurfaceModel(editor)` equals `viewerModel(value).blocks`.
7. After dispatching `UNDO_COMMAND` once on the Lexical editor, `getValue()`
   equals `doc`.
8. After the command the source-mode editor's `getValue()` equals `source`.
9. `viewerModel(source).blocks` equals `viewerModel(wysiwyg).blocks`.

**Each `DIFFERS` row is one test** asserting 4 (without "differs from
`doc`"), 5, 6 and 8, and that `viewerModel(source).blocks` does **not**
equal `viewerModel(wysiwyg).blocks`.

`ROWS` — 94 rows. Copy exactly:

```typescript
const ROWS: Row[] = [
    // B, N — plain items
    ['B1', '- one\n- two\n- three', 'two', null, 'UL', '- one\n\ntwo\n\n- three', '- one\n\ntwo\n\n- three'],
    ['B1', '- one\n- two\n- three', 'two', null, 'OL', '- one\n\n1. two\n\n- three', '- one\n1. two\n- three'],
    ['B2', '- one\n- two\n- three', 'one', 'two', 'UL', 'one\n\ntwo\n\n- three', 'one\n\ntwo\n\n- three'],
    ['B2', '- one\n- two\n- three', 'one', 'two', 'OL', '1. one\n2. two\n\n- three', '1. one\n2. two\n- three'],
    ['B3', '- one\n- two\n- three', 'one', 'three', 'UL', 'one\n\ntwo\n\nthree', 'one\n\ntwo\n\nthree'],
    ['B3', '- one\n- two\n- three', 'one', 'three', 'OL', '1. one\n2. two\n3. three', '1. one\n2. two\n3. three'],
    ['N1', '1. one\n2. two\n3. three', 'two', null, 'UL', '1. one\n\n- two\n\n1. three', '1. one\n- two\n3. three'],
    ['N1', '1. one\n2. two\n3. three', 'two', null, 'OL', '1. one\n\ntwo\n\n1. three', '1. one\n\ntwo\n\n3. three'],
    // T — task items
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'UL', '\\[ \\] one\n\n- [x] two', '\\[ \\] one\n- [x] two'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'OL', '1. [ ] one\n\n- [x] two', '1. [ ] one\n- [x] two'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'paragraph', '\\[ \\] one\n\n- [x] two', '\\[ \\] one\n- [x] two'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'h2', '## \\[ \\] one\n\n- [x] two', '## \\[ \\] one\n- [x] two'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'quote', '> \\[ \\] one\n\n- [x] two', '> \\[ \\] one\n- [x] two'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'code', '```\n[ ] one\n```\n\n- [x] two', '```\n[ ] one\n```\n- [x] two'],
    ['T2', '- [ ] one\n- [x] two', 'two', null, 'UL', '- [ ] one\n\n\\[x\\] two', '- [ ] one\n\n\\[x\\] two'],
    ['T2', '- [ ] one\n- [x] two', 'two', null, 'OL', '- [ ] one\n\n1. [x] two', '- [ ] one\n1. [x] two'],
    ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'UL', '\\[ \\] one\n\n\\[x\\] two', '\\[ \\] one\n\n\\[x\\] two'],
    ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'OL', '1. [ ] one\n2. [x] two', '1. [ ] one\n2. [x] two'],
    ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'paragraph', '\\[ \\] one\n\n\\[x\\] two', '\\[ \\] one\n\n\\[x\\] two'],
    ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'h2', '## \\[ \\] one\n\n## \\[x\\] two', '## \\[ \\] one\n## \\[x\\] two'],
    ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'quote', '> \\[ \\] one\n\n> \\[x\\] two', '> \\[ \\] one\n\n> \\[x\\] two'],
    ['T4', '1. [ ] one\n2. [x] two', 'one', null, 'UL', '- [ ] one\n\n1. [x] two', '- [ ] one\n2. [x] two'],
    ['T4', '1. [ ] one\n2. [x] two', 'one', null, 'OL', '\\[ \\] one\n\n1. [x] two', '\\[ \\] one\n\n2. [x] two'],
    ['T5', '- [ ] one\n- two\n- three', 'one', 'two', 'UL', '\\[ \\] one\n\ntwo\n\n- three', '\\[ \\] one\n\ntwo\n\n- three'],
    ['T5', '- [ ] one\n- two\n- three', 'one', 'two', 'OL', '1. [ ] one\n2. two\n\n- three', '1. [ ] one\n2. two\n- three'],
    ['T6', '- [ ] one\n- two\n- three', 'two', null, 'UL', '- [ ] one\n\ntwo\n\n- three', '- [ ] one\n\ntwo\n\n- three'],
    ['T6', '- [ ] one\n- two\n- three', 'two', null, 'OL', '- [ ] one\n\n1. two\n\n- three', '- [ ] one\n1. two\n- three'],
    ['T7', '- [ ] one\n\n- [x] two\n\n- three', 'two', null, 'UL', '- [ ] one\n\n\\[x\\] two\n\n- three', '- [ ] one\n\n\\[x\\] two\n\n- three'],
    ['T7', '- [ ] one\n\n- [x] two\n\n- three', 'two', null, 'OL', '- [ ] one\n\n1. [x] two\n\n- three', '- [ ] one\n\n1. [x] two\n\n- three'],
    ['T7', '- [ ] one\n\n- [x] two\n\n- three', 'two', null, 'paragraph', '- [ ] one\n\n\\[x\\] two\n\n- three', '- [ ] one\n\n\\[x\\] two\n\n- three'],
    ['T8', '- one\n  - [ ] inner\n- three', 'inner', null, 'UL', '- one\n\n\\[ \\] inner\n\n- three', '- one\n\n\\[ \\] inner\n\n- three'],
    ['T8', '- one\n  - [ ] inner\n- three', 'inner', null, 'OL', '- one\n\n1. [ ] inner\n\n- three', '- one\n1. [ ] inner\n- three'],
    ['T9', '- [ ] one\n  - inner\n- three', 'one', null, 'UL', '\\[ \\] one\n\n- - inner\n- three', '\\[ \\] one\n- - inner\n- three'],
    ['T9', '- [ ] one\n  - inner\n- three', 'one', null, 'OL', '1. [ ] one\n\n- - inner\n- three', '1. [ ] one\n- - inner\n- three'],
    ['T10', '- [x] one\n- two\n\n[x]: /url', 'one', null, 'UL', '\\[x\\] one\n\n- two\n\n[x]: /url', '\\[x\\] one\n- two\n\n[x]: /url'],
    ['T10', '- [x] one\n- two\n\n[x]: /url', 'one', null, 'OL', '1. \\[x\\] one\n\n- two\n\n[x]: /url', '1. [x] one\n- two\n\n[x]: /url'],
    ['T10', '- [x] one\n- two\n\n[x]: /url', 'one', null, 'paragraph', '\\[x\\] one\n\n- two\n\n[x]: /url', '\\[x\\] one\n- two\n\n[x]: /url'],
    ['T11', '- [ ] **one** two\n- three', 'one', null, 'UL', '\\[ \\] **one** two\n\n- three', '\\[ \\] **one** two\n- three'],
    ['T11', '- [ ] **one** two\n- three', 'one', null, 'OL', '1. [ ] **one** two\n\n- three', '1. [ ] **one** two\n- three'],
    ['T12', '::: columns\n- [ ] one\n- two\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\n\\[ \\] one\n\n- two\n|||\nRight\n:::', '::: columns\n\\[ \\] one\n- two\n|||\nRight\n:::'],
    ['T12', '::: columns\n- [ ] one\n- two\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. [ ] one\n\n- two\n|||\nRight\n:::', '::: columns\n1. [ ] one\n- two\n|||\nRight\n:::'],
    ['T13', 'zero\n\n- [ ] one\n- two', 'zero', 'one', 'UL', '- zero\n- [ ] one\n- two', '- zero\n- [ ] one\n- two'],
    ['T13', 'zero\n\n- [ ] one\n- two', 'zero', 'one', 'OL', '1. zero\n2. [ ] one\n\n- two', '1. zero\n2. [ ] one\n- two'],
    // X — ranges across lists and paragraphs, and joining
    ['X1', '- one\n- two\n\n1. three\n2. four', 'two', 'three', 'UL', '- one\n- two\n- three\n\n1. four', '- one\n- two\n- three\n2. four'],
    ['X1', '- one\n- two\n\n1. three\n2. four', 'two', 'three', 'OL', '- one\n\n1. two\n2. three\n3. four', '- one\n1. two\n1. three\n2. four'],
    ['X2', '- one\n- two\n\nthree', 'two', 'three', 'UL', '- one\n- two\n- three', '- one\n- two\n- three'],
    ['X2', '- one\n- two\n\nthree', 'two', 'three', 'OL', '- one\n\n1. two\n2. three', '- one\n1. two\n2. three'],
    ['X3', '- one\n- two\n\nthree', 'three', null, 'UL', '- one\n- two\n- three', '- one\n- two\n- three'],
    ['X3', '- one\n- two\n\nthree', 'three', null, 'OL', '- one\n- two\n\n1. three', '- one\n- two\n\n1. three'],
    ['X4', 'zero\n\n- one\n- two', 'zero', null, 'UL', '- zero\n- one\n- two', '- zero\n- one\n- two'],
    ['X4', 'zero\n\n- one\n- two', 'zero', null, 'OL', '1. zero\n\n- one\n- two', '1. zero\n\n- one\n- two'],
    ['X5', '- one\n\nmid\n\n- two', 'mid', null, 'UL', '- one\n- mid\n- two', '- one\n- mid\n- two'],
    ['X5', '- one\n\nmid\n\n- two', 'mid', null, 'OL', '- one\n\n1. mid\n\n- two', '- one\n\n1. mid\n\n- two'],
    ['X6', '* one\n* two\n\nthree', 'three', null, 'UL', '* one\n* two\n* three', '* one\n* two\n* three'],
    ['X6', '* one\n* two\n\nthree', 'three', null, 'OL', '* one\n* two\n\n1. three', '* one\n* two\n\n1. three'],
    ['X7', 'one\n\ntwo', 'one', 'two', 'UL', '- one\n- two', '- one\n- two'],
    ['X7', 'one\n\ntwo', 'one', 'two', 'OL', '1. one\n2. two', '1. one\n2. two'],
    ['X8', '1. one\n2. two\n\nthree', 'three', null, 'UL', '1. one\n2. two\n\n- three', '1. one\n2. two\n\n- three'],
    ['X8', '1. one\n2. two\n\nthree', 'three', null, 'OL', '1. one\n2. two\n3. three', '1. one\n2. two\n3. three'],
    // S — nested lists
    ['S1', '- one\n  - inner\n- three', 'inner', null, 'UL', '- one\n\ninner\n\n- three', '- one\n\ninner\n\n- three'],
    ['S1', '- one\n  - inner\n- three', 'inner', null, 'OL', '- one\n\n1. inner\n\n- three', '- one\n1. inner\n- three'],
    ['S2', '- one\n  - inner\n- three', 'one', null, 'UL', 'one\n\n- - inner\n- three', 'one\n- - inner\n- three'],
    ['S2', '- one\n  - inner\n- three', 'one', null, 'OL', '1. one\n\n- - inner\n- three', '1. one\n- - inner\n- three'],
    ['S3', '- one\n  - inner\n- three', 'one', 'inner', 'UL', 'one\n\ninner\n\n- three', 'one\n\ninner\n\n- three'],
    ['S3', '- one\n  - inner\n- three', 'one', 'inner', 'OL', '1. one\n2. inner\n\n- three', '1. one\n2. inner\n- three'],
    ['S4', '- one\n  1. inner\n- three', 'inner', null, 'UL', '- one\n- inner\n- three', '- one\n- inner\n- three'],
    ['S4', '- one\n  1. inner\n- three', 'inner', null, 'OL', '- one\n\ninner\n\n- three', '- one\n\ninner\n\n- three'],
    ['S5', '- one\n  - a\n  - b\n- three', 'a', null, 'UL', '- one\n\na\n\n- - b\n- three', '- one\n\na\n\n- - b\n- three'],
    ['S5', '- one\n  - a\n  - b\n- three', 'a', null, 'OL', '- one\n\n1. a\n\n- - b\n- three', '- one\n1. a\n- - b\n- three'],
    // L — loose lists
    ['L1', '- one\n\n- two\n\n- three', 'two', null, 'UL', '- one\n\ntwo\n\n- three', '- one\n\ntwo\n\n- three'],
    ['L1', '- one\n\n- two\n\n- three', 'two', null, 'OL', '- one\n\n1. two\n\n- three', '- one\n\n1. two\n\n- three'],
    ['L2', '- one\n\n- two', 'one', 'two', 'UL', 'one\n\ntwo', 'one\n\ntwo'],
    ['L2', '- one\n\n- two', 'one', 'two', 'OL', '1. one\n2. two', '1. one\n2. two'],
    // M — items holding several blocks (need markdown-editor-list-item-block-paste)
    ['M1', '- one\n\n  second\n\n- two', 'one', null, 'UL', 'one\n\n- second\n\n- two', 'one\n\n- second\n\n- two'],
    ['M1', '- one\n\n  second\n\n- two', 'one', null, 'OL', '1. one\n\n- second\n\n- two', '1. one\n\n- second\n\n- two'],
    ['M1', '- one\n\n  second\n\n- two', 'one', null, 'paragraph', 'one\n\n- second\n\n- two', 'one\n\n- second\n\n- two'],
    ['M1', '- one\n\n  second\n\n- two', 'one', null, 'h2', '## one\n\n- second\n\n- two', '## one\n\n- second\n\n- two'],
    ['M2', '- one\n\n  second\n\n- two', 'second', null, 'UL', '- one\n\n- second\n\n- two', '- one\n\n- second\n\n- two'],
    ['M2', '- one\n\n  second\n\n- two', 'second', null, 'OL', '- one\n\n1. second\n\n- two', '- one\n\n1. second\n\n- two'],
    ['M3', '- one\n\n  second\n\n- two', 'one', 'second', 'UL', '- one\n\n- second\n\n- two', '- one\n\n- second\n\n- two'],
    ['M3', '- one\n\n  second\n\n- two', 'one', 'second', 'OL', '1. one\n2. second\n\n- two', '1. one\n2. second\n\n- two'],
    ['M4', '- one\n  - inner\n\n  after\n\n- two', 'after', null, 'UL', '- one\n  - inner\n\n- after\n\n- two', '- one\n  - inner\n\n- after\n\n- two'],
    ['M5', '- one\n\n  > quoted\n\n- two', 'quoted', null, 'UL', '- one\n\n- quoted\n\n- two', '- one\n\n- quoted\n\n- two'],
    ['M5', '- one\n\n  > quoted\n\n- two', 'quoted', null, 'OL', '- one\n\n1. quoted\n\n- two', '- one\n\n1. quoted\n\n- two'],
    ['M6', '- # Foo\n- bar', 'Foo', null, 'UL', 'Foo\n\n- bar', 'Foo\n- bar'],
    ['M6', '- # Foo\n- bar', 'Foo', null, 'OL', '1. Foo\n\n- bar', '1. Foo\n- bar'],
    ['M7', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'UL', 'one\n\n- ```\n  code\n  ```\n\n- two', 'one\n\n- ```\n  code\n  ```\n\n- two'],
    ['M7', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'OL', '1. one\n\n- ```\n  code\n  ```\n\n- two', '1. one\n\n- ```\n  code\n  ```\n\n- two'],
    ['M8', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'UL', '\\[ \\] one\n\n- second\n\n- [x] two', '\\[ \\] one\n\n- second\n\n- [x] two'],
    ['M8', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'OL', '1. [ ] one\n\n- second\n\n- [x] two', '1. [ ] one\n\n- second\n\n- [x] two'],
    // C — a list in a `:::` column
    ['C1', '::: columns\n- one\n- two\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\none\n\n- two\n|||\nRight\n:::', '::: columns\none\n- two\n|||\nRight\n:::'],
    ['C1', '::: columns\n- one\n- two\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. one\n\n- two\n|||\nRight\n:::', '::: columns\n1. one\n- two\n|||\nRight\n:::'],
    ['C2', '::: columns\n- one\n- two\n|||\nRight\n:::', 'two', null, 'UL', '::: columns\n- one\n\ntwo\n|||\nRight\n:::', '::: columns\n- one\n\ntwo\n\n|||\nRight\n:::'],
    ['C2', '::: columns\n- one\n- two\n|||\nRight\n:::', 'two', null, 'OL', '::: columns\n- one\n\n1. two\n|||\nRight\n:::', '::: columns\n- one\n1. two\n|||\nRight\n:::'],
];
```

The two saved texts of a row can differ where the viewer reads no
difference: a blank line between two lists or blocks, and a numbered item's
number (the viewer numbers every list from one).

**Controls.** These 20 rows pass before any source change; the other 74
fail: `B1 UL`, `B2 UL`, `B3 UL`, `B3 OL`, `N1 OL`, `T6 UL`, `X3 OL`,
`X4 OL`, `X5 OL`, `X6 OL`, `X8 UL`, `S1 UL`, `S2 UL`, `S3 UL`, `S4 OL`,
`S5 UL`, `L1 UL`, `L2 UL`, `C1 UL`, `C2 UL`.

`DIFFERS` — the 14 rows where the surfaces differ on purpose (see
*Non-Goals* for each reason). The strings are the results after this plan's
change; before it, `E1 OL`, `E5` and `E7` fail on their `wysiwyg` or
`source` string and the other eleven pass:

```typescript
const DIFFERS: Row[] = [
    // a list in a quote is a raw block on the WYSIWYG surface
    ['Q1', '> - one\n> - two', 'one', null, 'UL', '- \\> - one\\\n  \\> - two', 'one\n> - two'],
    ['Q1', '> - one\n> - two', 'one', null, 'OL', '1. \\> - one\\\n   \\> - two', '1. one\n> - two'],
    // source mode acts on single lines of a block
    ['E1', '- one\n  two\n- three', 'two', null, 'UL', 'one\ntwo\n\n- three', '- one\n- two\n- three'],
    ['E1', '- one\n  two\n- three', 'two', null, 'OL', '1. one\n   two\n\n- three', '- one\n1. two\n- three'],
    ['E2', 'one\ntwo', 'one', 'two', 'UL', '- one\n  two', '- one\n- two'],
    ['E2', 'one\ntwo', 'one', 'two', 'OL', '1. one\n   two', '1. one\n2. two'],
    // a code block, a raw block
    ['E3', '```\none\n```\n\ntwo', 'one', null, 'UL', '- one\n\ntwo', '```\none\n```\n\ntwo'],
    ['E3', '```\none\n```\n\ntwo', 'one', null, 'OL', '1. one\n\ntwo', '```\none\n```\n\ntwo'],
    ['E8', '<div>x</div>\n\ntwo', 'x', null, 'UL', '- \\<div>x\\</div>\n\ntwo', '<div>x</div>\n\ntwo'],
    // setBlockType on a block an item holds after its text
    ['E4', '- one\n\n  second\n\n- two', 'second', null, 'paragraph', '- one\n\n  second\n\n- two', '- one\n\nsecond\n\n- two'],
    ['E4', '- one\n\n  second\n\n- two', 'second', null, 'h2', '- one\n\n  ## second\n\n- two', '- one\n\n## second\n\n- two'],
    // setBlockType("code") over several blocks
    ['E5', '- [ ] one\n- [x] two', 'one', 'two', 'code', '```\n[ ] one\n```\n\n```\n[x] two\n```', '```\n[ ] one\n[x] two\n```'],
    // the looseness of a list left as one item holding only a nested list
    ['E6', '- one\n  - inner\n\n- three', 'three', null, 'UL', '- one\n\n  - inner\n\nthree', '- one\n  - inner\n\nthree'],
    ['E7', '- one\n  - inner\n\n  after\n\n- two', 'after', null, 'OL', '- one\n\n  - inner\n\n1. after\n\n- two', '- one\n  - inner\n\n1. after\n\n- two'],
];
```

### Source-mode unit cases

In `markdown-source-edits.test.ts`, each as
`expect(apply(text, command(text, from, to)!)).toBe(result)` with the caret
at `text.indexOf(word) + 1` (a range: from the first word to the second).

`describe('line commands and task items')`:

| # | Text | Selection | Command | Result |
|---|---|---|---|---|
| U1 | `- [ ] one ⏎ - [x] two` | `one` | `listSource('unordered')` | `\[ \] one ⏎ - [x] two` |
| U2 | same | `two` | `listSource('unordered')` | `- [ ] one ⏎⏎ \[x\] two` |
| U3 | same | `one` | `listSource('ordered')` | `1. [ ] one ⏎ - [x] two` |
| U4 | same | `one` | `blockPrefixSource('## ')` | `## \[ \] one ⏎ - [x] two` |
| U5 | same | `one` | `blockPrefixSource('> ')` | `> \[ \] one ⏎ - [x] two` |
| U6 | same | `one` | `blockPrefixSource('')` | `\[ \] one ⏎ - [x] two` |
| U7 | same | `one` | `FENCED_CODE_SOURCE` | `` ``` ⏎ [ ] one ⏎ ``` ⏎ - [x] two `` |
| U8 | `* [X] one ⏎ * two` | `one` | `listSource('unordered')` | `\[X\] one ⏎ * two` |
| U9 | `- [ ] one ⏎⏎ - [x] two ⏎⏎ - three` (loose) | `two` | `listSource('unordered')` | `- [ ] one ⏎⏎ \[x\] two ⏎⏎ - three` |
| U10 | same | `two` | `listSource('ordered')` | `- [ ] one ⏎⏎ 1. [x] two ⏎⏎ - three` |
| U11 | `- [ ] one ⏎   more ⏎ - two` | `one` | `listSource('ordered')` | `1. [ ] one ⏎ more ⏎ - two` |
| U12 | same | `more` | `listSource('ordered')` | `- [ ] one ⏎ 1. more ⏎ - two`: the marker stays with the first line |
| U13 | `- [ ] one ⏎⏎   second ⏎⏎ - [x] two` | `one` | `listSource('unordered')` | `\[ \] one ⏎⏎ - second ⏎⏎ - [x] two` |
| U14 | `> - [ ] one ⏎ > - [x] two` | `one` | `listSource('unordered')` | `\[ \] one ⏎ > - [x] two` |
| U15 | same | `one` | `listSource('ordered')` | `1. [ ] one ⏎ > - [x] two` |
| U16 | `1. [ ] one ⏎ 2. two` | `one` | `listSource('unordered')` | `- [ ] one ⏎ 2. two` |
| U17 | `- [ ] one ⏎ - [x] two` | `one` to `two` | `FENCED_CODE_SOURCE` | `` ``` ⏎ [ ] one ⏎ [x] two ⏎ ``` `` |

`describe('listSource joins the list next to it')`: the seven rows of the
table at the end of *Internal Structure › `listOn`*, plus:

| # | Text | Selection | Command | Result |
|---|---|---|---|---|
| J8 | `1. a ⏎ 2. b ⏎ 3. c ⏎ 4. d ⏎ 5. e ⏎ 6. f ⏎ 7. g ⏎ 8. h ⏎ 9. i ⏎⏎ ten` | `ten` | `listSource('ordered')` | the same nine lines, then `10. ten` with no blank line before it |
| J9 | `one ⏎⏎ two ⏎⏎ three` | `one` to `three` | `listSource('unordered')` | `- one ⏎ - two ⏎ - three` |
| J10 | `mid ⏎⏎ 1. a ⏎ 2. b` | `mid` | `listSource('ordered')` | `1. mid ⏎ 1. a ⏎ 2. b`: the lines below are not renumbered |
| J11 | `- one ⏎ - two ⏎⏎⏎⏎ three` | `three` | `listSource('unordered')` | `- one ⏎ - two ⏎ - three`: every blank line between goes |
| J12 | `+ one ⏎⏎ three` | `three` | `listSource('unordered')` | `+ one ⏎ + three` |

### WYSIWYG-only cases

In `describe('MarkdownEditor list toggles in a list of their kind')`, using
that describe's `editorOf` and `selectFrom` helpers:

| # | Document | Selection | Command | Assert |
|---|---|---|---|---|
| W1 | `- one ⏎⏎   second ⏎⏎ - two` | caret in `one` | `toggleUnorderedList()` | the root's children are a paragraph and a list; the list's first item's children are one text node `second` (no paragraph node) |
| W2 | same | caret in `one` | `setBlockType('h2')` | value `## one ⏎⏎ - second ⏎⏎ - two`; no node of the document has a paragraph as the child of a heading |
| W3 | `- one ⏎ - two ⏎ - three` | caret in `two` | `toggleOrderedList()` | the anchor is in the text node `two`, offset 1, whose parent is a list item of a `number` list |
| W4 | `- one ⏎⏎ - two ⏎⏎ three` | caret in `three` | `toggleUnorderedList()` | value `- one ⏎⏎ - two ⏎⏎ - three`: a loose list stays loose |
| W5 | `- a ⏎ - b ⏎⏎ mid ⏎⏎ - c ⏎⏎ - d` | caret in `mid` | `toggleUnorderedList()` | value `- a ⏎⏎ - b ⏎⏎ - mid ⏎⏎ - c ⏎⏎ - d`: one loose list |
| W6 | `- # Foo ⏎ - bar` | caret in `Foo` | `setBlockType('h1')` | value `# Foo ⏎⏎ - bar`: a heading that opens an item is not "already a heading"; the anchor is still in the text node `Foo`, offset 1 |
| W7 | `one ⏎⏎ two`, then `$getRoot().clear()` and an empty paragraph appended and selected | caret in the empty paragraph | `toggleUnorderedList()` | the root holds one list with one empty item, and the selection's anchor is that item |
| W8 | `- one ⏎ - two ⏎ - three` | caret in `two` | `toggleOrderedList()` twice | value `- one ⏎⏎ two ⏎⏎ - three`: the second call is *off* |
| W9 | `- [ ] one ⏎ - [x] two` | caret in `one` | `setBlockType('code')` | value `` ``` ⏎ [ ] one ⏎ ``` ⏎⏎ - [x] two `` |
| W10 | `- one ⏎⏎   second ⏎⏎ - two` | `one` to `second` | `setBlockType('h2')` | value `## one ⏎⏎ ## second ⏎⏎ - two`, which is also what source mode leaves for the same selection |

The availability consistency test already in the file (`availability, read
from the live selection`, [:5051](../packages/lib/tests/component/markdown-editor.test.ts#L5051))
must keep passing unchanged: it asserts, for its list cases, that a toggle
with `canSetBlockType` `true` changes the document or the selection.

### Existing tests that change

| Test | Change |
|---|---|
| `markdown-editor.test.ts` `CASES`, "in a list of the other kind the toggle converts the list instead" ([:779](../packages/lib/tests/component/markdown-editor.test.ts#L779)) | name: "in a list of the other kind the toggle changes the caret's item alone, its list split around it"; `result: '- one\n\n1. two\n\n- three'` |
| `markdown-editor.test.ts` `CASES`, "a range from a bulleted list into a numbered one …" ([:783](../packages/lib/tests/component/markdown-editor.test.ts#L783)) | name: "a range from a bulleted list into a numbered one makes the numbered item it touches a bulleted item, joining the list before it"; `result: '- one\n- two\n- three\n\n1. four'` |
| `markdown-source-edits.test.ts`, "marks only the non-blank lines of a selection spanning several blocks" ([:1319](../packages/lib/tests/component/markdown-source-edits.test.ts#L1319)) | name: "makes the blocks of a selection items of one tight list, and keeps the blank line between headings"; the two list expectations become `'- foo\n- bar'` and `'1. foo\n2. bar'`; the heading expectation stays `'## foo\n\n## bar'` |

No other existing test changes. The existing both-surfaces test at
[:836](../packages/lib/tests/component/markdown-editor.test.ts#L836) stays
as it is and keeps passing.

### Manual (browser) checks — needs manual verification

Run `npm run dev` at the repository root and open the demo's **MD Editor**
page (`#/md-editor`). Switch to source mode with the toolbar's source
toggle, replace the text with `- [ ] todo`, `- [x] done`, `- plain`, and
switch back.

| # | Action | Expect |
|---|---|---|
| X1 | Click into `todo`; toolbar **Insert ▸ Bulleted list** | `todo` leaves the list as a paragraph reading `[ ] todo`; the list below starts at `[x] done`; the viewer pane shows the same |
| X2 | Without clicking anywhere, type `Q` | `Q` lands in that paragraph: the keyboard is back in the editor |
| X3 | Press Ctrl+Z twice | first the `Q` goes, then the item is back in its list as a task item |
| X4 | Click into `plain`; **Insert ▸ Numbered list** | only `plain` becomes `1. plain`; `todo` and `done` stay bulleted task items |
| X5 | Switch to source mode; put the caret on the `- [x] done` line; **Insert ▸ Bulleted list** | the line reads `\[x\] done`, and nothing flashes as refused |
| X6 | In source mode, on the `- [ ] todo` line, **Insert ▸ Numbered list** | the line reads `1. [ ] todo` |
| X7 | Reload the three lines; in WYSIWYG mode right-click `todo`; **Block style ▸ Heading 2** (context menu) | a heading reading `[ ] todo`, and the list below starts at `[x] done` |

---

## Verification

From `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test`.
- `npm run lint`.
- The command of step 10, then `npm test` for the whole suite.
- `npm run docs:api`, `npm run docs:llms:check` and `npm run build:lib`.
- Grep: `grep -rnE 'convert(s|ing) whole' src/typescript/lib/component/editor/MarkdownEditor.ts docs/components/MarkdownEditor.md`
  — expect zero matches.
- The manual cases X1–X7.

---

## Documentation Impact

No public signature changes. `$serializeInlineNodes` is exported from its
module only, not from a package entry point.

**JSDoc, `MarkdownEditor.ts`.** `toggleUnorderedList` becomes:

```typescript
/**
 * Converts the selected blocks into an unordered (bulleted) list, or out
 * of one. When every selected block is the text of an item of a bulleted
 * list, those items become paragraphs and the list is split around them; a
 * task item's `[ ]` / `[x]` marker stays as the text it shows. Otherwise
 * every other selected block becomes a bulleted item at the top level (or
 * in its `:::` column): an item of a numbered list changes alone, its list
 * split around it, and a new item joins a bulleted list right before or
 * after it. No-op without a range selection, and when the selection
 * touches a table cell (whole cells selected included), which holds text
 * only.
 *
 * In `"source"` mode, does the same to the blocks the raw Markdown's
 * selected lines touch.
 *
 * @returns This component, for method chaining.
 */
```

`toggleOrderedList` gets the same text with "ordered (numbered)",
"numbered" and "bulleted" swapped. In `setBlockType`'s JSDoc, add after its
first sentence: "A list item's text is taken out of its list, the blocks the
item holds after it staying in the list as an item; a task item's marker
stays as the text it shows, and in a code block as it was written." The
private `toggleList`'s JSDoc drops its `insert` parameter and its sentences
about Lexical's insert, and says instead that the on route makes each
touched block an item itself (`$makeListItems`).

**JSDoc and comments, `markdownSourceLines.ts`.**

- The module header comment: after the sentence ending "…the paragraphs,
  headings, list item texts and code blocks its selection's lines touch.",
  add "A task item's marker goes with its item's text."
- `SKIPPED_NODE_TYPES`: "…and a task item's checkbox, which goes with its
  item's text: a command that converts the text carries the marker."
- `readLineTargets`: replace "A thematic break and a task checkbox are left
  alone." with "A thematic break is left alone; a task checkbox is no target
  of its own and goes with its item's text."
- `listSource`: replace "A blank line stays blank." with "Items made from
  neighbouring blocks stand line after line, as one tight list; a new item
  is written with the marker of a list of `kind` right before or after it,
  which it joins, and the blank lines between it and a tight list are
  removed. A task item that stays an item keeps its marker; one whose text
  is lifted out keeps it as the text it shows (`\[x\]`)."
- `blockPrefixSource` and `FENCED_CODE_SOURCE`: add "A task item's marker is
  carried as the text it shows" / "as written".

**`docs/components/MarkdownEditor.md`.**

- The Command API row for the toggles
  ([:117](../packages/lib/docs/components/MarkdownEditor.md)) becomes:

  ```markdown
  | `toggleUnorderedList()` / `toggleOrderedList()` | Convert the selected blocks into a bulleted / numbered list, or out of one. When every selected block is the text of an item of a list of that kind, those items become paragraphs and the list is split around them. Otherwise each other selected block becomes an item of such a list at the top level (or in its `:::` column): an item of a list of the other kind changes alone, its list split around it — select a whole list to convert it whole — and a new item joins a list of that kind right before or after it, which stays tight. A task item's `[ ]` / `[x]` marker stays a marker while its item stays an item, and becomes the text it shows when the item's text leaves its list. |
  ```

- The `setBlockType` row
  ([:120](../packages/lib/docs/components/MarkdownEditor.md)) gains: "A list
  item's text is taken out of its list; the blocks the item holds after it
  stay in the list. A task item's marker stays as the text it shows."
- In the source-mode paragraph that starts "The block commands —"
  ([:294](../packages/lib/docs/components/MarkdownEditor.md)), replace the
  sentence "Turning a list off makes each item's text a paragraph of its own
  (`- a` / `- b` gives `a`, a blank line, `b`), and turning one on makes
  each selected line an item, the paragraph's lines below the selection
  continuing the last one." with:

  ```markdown
  Turning a list off makes each item's text a paragraph of its own (`- a` / `- b` gives `a`, a blank line, `b`), a task item's marker written as the text it shows (`- [x] a` gives `\[x\] a`). Turning one on makes each selected line an item, the paragraph's lines below the selection continuing the last one; the new items stand line after line as one tight list, written with the marker of a list of that kind right before or after them, which they join — the blank lines between them and a tight list are removed, since they would make it loose. An item that changes kind keeps its task marker (`- [ ] a` gives `1. [ ] a`), and `setBlockType` carries a marker as the list toggles do, into a code block as it was written.
  ```

- After that paragraph, add a new paragraph:

  ```markdown
  The list toggles and `setBlockType` give the same result on both surfaces for the same blocks. They differ where the surfaces hold different things: source mode can select single lines of a paragraph or of an item's text and makes each selected line an item, where the WYSIWYG surface holds one block; a list inside a blockquote is a raw Markdown block on the WYSIWYG surface, and the commands act on that block as a whole; on a code block or a raw Markdown block the WYSIWYG toggles make the block's text an item, where source mode does nothing; `setBlockType` on a block a list item holds after its text converts it in place on the WYSIWYG surface and takes it out of the list in source mode; `setBlockType("code")` over several blocks makes one code block per block on the WYSIWYG surface and one for all of them in source mode; and a list left as one item that holds only a nested list keeps a loose list's spacing on the WYSIWYG surface.
  ```

**`docs/reference/changelog/next.md`.** Append to **Changed › Components**,
as the last entry before `### Overlay`:

```markdown
- **`MarkdownEditor`'s list toggles change the selected blocks only, alike
  on both surfaces.** On the WYSIWYG surface `toggleOrderedList()` in a
  bulleted list (and `toggleUnorderedList()` in a numbered one) converted
  the whole list whatever was selected, a nested list in place, and made a
  loose list tight. It now changes the selected items alone, as source mode
  does: each becomes an item of the other kind at the top level and its list
  is split around it. Select a whole list to convert it whole. In source
  mode, items made from neighbouring blocks now stand line after line as one
  tight list, and an item made next to a list of that kind joins it with
  that list's marker and leaves it tight, as on the WYSIWYG surface; before,
  the blank lines stayed and the list read as loose. No consumer action is
  needed unless code relied on a caret converting a whole list.
```

Append to **Fixed › Components**, as the last entries before `### Core`:

```markdown
- **The block commands act on a task-list item in source mode.**
  `toggleUnorderedList`, `toggleOrderedList` and `setBlockType` did nothing
  on a line such as `- [ ] todo`, while the WYSIWYG surface converted it.
  Both surfaces now do the same: an item that stays an item keeps its marker
  (`1. [ ] todo`), and one whose text leaves its list keeps the marker as
  the text it shows (`\[ \] todo`, `## \[x\] done`), which is what the
  viewer showed all along. A code block made from a task item holds the
  marker as it was written on both surfaces (`[ ] todo`; the WYSIWYG surface
  wrote `\[ \] todo`). No consumer action is needed.

- **Converting a list item that holds more blocks no longer runs them into
  its text.** On the WYSIWYG surface, `setBlockType` or a list toggle on an
  item holding a second paragraph, a code block or another block moved those
  blocks into the new block, and the save ran them together: `- one` with a
  paragraph `second` became `onesecond`. The item's text is now converted
  alone and the blocks it held stay in the list as an item, as in source
  mode. A list toggle on a block an item holds after its text makes that
  block an item of its own; before, it changed nothing in a list of that
  kind and converted the whole list in one of the other. No consumer action
  is needed.
```

No migration note, no `llms.txt` change, and `docs/components/Markdown.md`
is untouched: the viewer does not change.

---

## Potential Challenges

- **The dependency may still move.** The M rows' `wysiwyg` strings were
  measured at `0d9902fb0`. If the merged branch writes a blank line or a
  marker differently, a string can be off while assertion 9 (the viewer
  reads both alike) holds: then update the string to the measured value.
  If assertion 9 fails, the code is wrong, not the string.
- **`LexicalNode.isBefore` is not a document order for a block and a block
  inside it.** In Lexical 0.49 `a.isBefore(b)` is `true` when `b` holds
  `a`. `$touchedBlocksLastFirst` handles the pair with `isParentOf` first;
  do not simplify it to `isBefore` alone. Row `M3 OL` catches the mistake.
- **`ListItemNode.replace` does the lifting.** It outdents a nested item,
  splits its lists and remaps a selection held on the item. The plan relies
  on it for every lift; rows `S1`, `S5`, `T8` and `C1` pin the result.
- **`readLeaves` is shared by every source-mode line command.** Its change
  alters how a loose task item's marker is read for all of them. Run the
  whole `markdown-source-edits.test.ts` and `markdown-editor.test.ts` after
  step 5, not only the new tests.
- **Move a block's children before removing the block.** Removing a node
  that still holds the caret moves the caret to a neighbour.
  `$isolateItemText` and `$moveToItemAfter` therefore `splice` the children
  out first and remove the emptied block after. Done the other way round,
  `W6` loses its caret and `W10` converts only the first block.
- **A paragraph must not be passed to `ListItemNode.append`.** `append`
  merges a paragraph's children into the item. The new code uses `splice`
  for every block it moves, as the dependency's importer does; keep it so.
- **The task marker in a loose list is inside the paragraph's text.** Both
  shapes of the table in *Internal Structure › the task marker* need a test:
  rows `T1` (tight) and `T7` (loose) cover them on both surfaces.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts)
  — `toggleList` (:4113, the precedent for the off route), `setBlockType`
  (:5110), `$selectionLiesInListOfType` (:2425), `$blocksTouchedBy` (:2448),
  `$selectedBlocksHaveType` (:2466), `$moveBlockPointsIntoText` (:3138),
  `$readCommandAvailability` (:3255), `$copyBlockAsCodeSource` (:350).
- [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts)
  — the module header (:9), `readLeaves` (:156), `expectLeaves` (:280),
  `readLineTargets` (:431), `liftLines` (:568), `firstReadingEdit` (:863),
  `convertBlocks` (:917), `FENCED_CODE_SOURCE` (:1032), `isMarkerLine`
  (:1140), `toggleList` (:1159), `listOff` (:1181), `listOn` (:1212).
- [markdownSourceTokens.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts)
  — read only: `SourceBlockNode`, `SourceEntry`, `entryKey` (:267),
  `walkListItems` (:589), which writes the `item:task:checked` signature.
- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts)
  — `$serializeInlineNodes` (:774), `strayTaskMarkersAsText` (:4881),
  `$writtenListMarker` (:1054), `$listReadsLoose` (:1074).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts)
  — read only: `$normalizeList` (:146), which joins a list with the next one
  of its kind and marker after `$itemizeBlock` runs.
- [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts)
  — read only, on the dependency branch: `$buildListItem` (:995), which
  builds the item shapes `$isolateItemText` takes apart.
- [LexicalList.dev.mjs](../node_modules/@lexical/list/dist/LexicalList.dev.mjs)
  — read only: `$insertList` (:152), `$createListOrMerge` (:221),
  `ListItemNode.replace` (:719).
- [markdown-editor.test.ts](../packages/lib/tests/component/markdown-editor.test.ts)
  — `describe('MarkdownEditor list toggles in a list of their kind')`
  (:716) and its both-surfaces test (:836), the model for the matrix.
- [viewModel.ts](../packages/lib/tests/component/markdown-roundtrip/viewModel.ts)
  and [harness.ts](../packages/lib/tests/component/markdown-roundtrip/harness.ts)
  — `viewerModel` (:286), `editorSurfaceModel` (:576), `canonicalSave` (:27).
- [plans/implemented/markdown-editor-context-menu-caret.md](implemented/markdown-editor-context-menu-caret.md)
  — *Implementation Notes*, "The list toggles toggle (A-3)" and "The
  contract, and how the commands keep it (A-5)".
- `plans/implemented/markdown-editor-list-item-block-paste.md` — the item
  shapes a load builds (*Where each block of an item goes*).

---

## Non-Goals

Each of these is a difference between the surfaces that stays. All are
pinned by a `DIFFERS` row, so none can change unnoticed.

- **A list inside a blockquote on the WYSIWYG surface** (rows `Q1`). The
  WYSIWYG surface holds it as a raw block. Making it an editable list is an
  importer and serializer feature of its own.
- **Source mode's single lines** (rows `E1`, `E2`). Source mode makes each
  selected line of a multi-line block an item, and with the caret on a later
  line of an item's text splits the item there. The WYSIWYG surface shows
  those lines as one flowing block and has no such selection. This is
  documented source-mode behaviour and is how several lines become several
  items there. For the same reason `setBlockType("h1")`–`("h6")` writes one
  heading per line in source mode and one heading holding the line break on
  the WYSIWYG surface.
- **The toggles on a code block or a raw Markdown block** (rows `E3`, `E8`).
  The WYSIWYG surface makes the block's text an item; source mode declines.
  Neither involves a list item, and raw blocks are the subject of
  `markdown-editor-raw-block-range-edits`.
- **`setBlockType` on a block a list item holds after its text** (rows
  `E4`). The WYSIWYG surface converts it in place, inside the item — which
  is how a step of a numbered list gets a code block — and source mode takes
  it out of the list. Which is right is a question about `setBlockType`, not
  about the list toggles or task items.[^in-item-blocks]
- **`setBlockType("code")` over several blocks** (row `E5`). The WYSIWYG
  surface makes one code block per block, source mode one for all. The task
  marker is written alike in both since this plan.
- **The looseness of a list left as one item holding only a nested list**
  (rows `E6`, `E7`). After a split, the WYSIWYG surface keeps that list
  loose and writes a blank line before its nested list; in source mode the
  list reads tight. The viewer wraps that one item's text in a paragraph or
  not. The WYSIWYG surface behaves the same when the other items are deleted
  by hand, so this is its looseness model, not the toggles'.
- **Changing an item's kind in place, at its depth.** Rule 3 sends a
  converted block to the top level on both surfaces. Keeping a nested item
  nested while its kind changes would be a new behaviour on both.
- **Turning the kept marker back into plain text on the WYSIWYG surface.**
  After an item leaves its list, the WYSIWYG document still holds the marker
  as an atomic run of text kept as Markdown source (the component docs'
  *Kept as source*) until the next load; it saves and shows as text either
  way. A second toggle therefore gives `- [ ] one` on the WYSIWYG
  surface and `- \[ \] one` in source mode, which the viewer reads alike.
- **`canSetBlockType` in source mode.** It stays always `true`: source mode
  does not predict where a command declines.
- **The existing both-surfaces test.** It is left as it is; new shapes go
  into the matrix.

---

## Notes

[^prototype]: The changes of *Internal Structure* were prototyped on
    `0d9902fb0` in a throwaway worktree, and the `ROWS`, `DIFFERS`,
    *Controls* and "today" tables are that prototype's measured output, with
    the 20 controls measured on the unchanged commit. With the prototype in
    place `typecheck` and `eslint` on the three source files passed, and
    fifteen Markdown test files (6050 tests) passed except the three tests
    listed under *Existing tests that change*. The prototype's diff is kept
    outside the repository at
    `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/list-toggle-parity/prototype-on-0d9902fb0.diff`
    with the probe tests and their outputs. It is evidence, not the
    implementation: implement from this plan, tests first.

[^marker-is-text]: The dialect shows a task marker as text. The viewer
    renders `- [ ] task` as an `<li>` whose text starts with the literal
    `[ ]` and no checkbox (`docs/components/Markdown.md`, the construct
    table), and the editor docs already say that a marker which is no longer
    on its item's first line "saves as the text it shows, `\[x\]`". So
    taking a task item out of its list and keeping `[ ] one` as text changes
    nothing the reader sees, and drops nothing. Source mode's refusal was
    not a decision: its commands lift the item's text and then check that
    the result reads as expected, and the check failed because the marker,
    a separate token, was left behind in an emptied item. Two alternatives
    were rejected. Dropping the marker loses the checked state without the
    user asking. Declining on both surfaces would leave the WYSIWYG toolbar
    offering a command that does nothing on a task item, or need a new
    `false` case in `canSetBlockType` for something Markdown can express.

[^selected-only]: Three reasons. First, the commands are documented as
    converting "the selected blocks", and the off direction already acts on
    the touched items only: the context-menu-caret work measured Lexical's
    `$removeList` and rejected it because it "dissolves the whole top-level
    list … where source mode and the documented contract take out the
    selected blocks". A toggle that reaches untouched items in one direction
    and not in the other is two rules. Second, Lexical's insert has defects
    here that need fixing anyway: it replaces the list node, which drops the
    list's looseness (a loose list comes out tight), and with the caret in a
    block an item holds after its text it converts the whole list, or — in a
    list of the toggle's kind — replaces the list by an equal one, an undo
    step that undoes nothing while `canSetBlockType` is `true`. Third, each
    surface stays conventional: changing only the selected paragraphs is
    what word processors do, and changing only the selected lines is what
    every Markdown source toolbar does; converting a whole list from a caret
    has no counterpart in a source editor. The sentence "A list of the other
    kind converts whole" in the docs was written to describe Lexical's
    behaviour when the off direction was fixed, and the same notes record
    that "the other direction was not touched". The alternative — source
    mode converting the whole list — was rejected for those reasons, and
    because it needs a new in-place re-marking edit in source mode with
    re-indentation of every item's later lines.

[^top-level]: `docs/components/MarkdownEditor.md` states the rule for all
    block commands: "A block they convert leaves the quotes and list items
    around it for the top level (or its `:::` column)". The off direction
    follows it on both surfaces, and the existing both-surfaces test pins
    that ("a caret in a nested item takes it out to the top level"). The on
    direction now follows the same rule on both. The cost is recorded here
    so it is not rediscovered as a bug: on the WYSIWYG surface the numbered
    toggle no longer turns a nested bulleted list into a nested numbered
    one. A nested list of another kind is still loaded, shown, edited and
    saved; it is made in source mode or by pasting. Keeping an item at its
    depth while its kind changes was considered and left out (see
    *Non-Goals*): it needs a nested-list split on the WYSIWYG surface and an
    in-place re-marking edit in source mode, and no surface does it today.

[^joining]: A toggle should not change how untouched items read. With the
    blank lines kept, `- one ⏎ - two ⏎⏎ - three` is one loose list in
    Markdown, so making `three` an item put `one` and `two` into paragraphs
    in the viewer. Markdown cannot keep two lists with the same marker
    apart, so the new item is in that list either way; the only choice is
    whether the list stays tight, and tight is what the list was. When one
    of the joined lists is loose the result must be loose, since a Markdown
    list is one or the other as a whole; `$itemizeBlock` sets that on the
    WYSIWYG surface for the one case its list transform would not (a tight
    list before the new item, a loose one after). The marker matters for the
    same reason: `* one ⏎ * two ⏎⏎ - three` is two lists. The rejected
    alternative was to make the WYSIWYG surface produce loose lists, which
    would have changed untouched items on the surface that had it right.

[^item-blocks]: The existing behaviour for an item holding a nested list is
    the precedent: on both surfaces a toggle on the item's text takes the
    text out and "leaves its nested list an item", pinned by the existing
    both-surfaces test. An item holding a second paragraph is the same case
    with another block. Source mode already works this way and needed no
    change. The alternative, taking the whole item out with all its blocks,
    would contradict that pinned behaviour and would need a second scoping
    rule. The WYSIWYG corruption comes from `$setBlocksType` calling
    `ListItemNode.replace(paragraph, true)`, which moves every child of the
    item, blocks included, into the paragraph. The dependency branch makes
    such items common, since they now load as lists instead of raw blocks.

[^quote-raw]: The WYSIWYG surface has no node for a quote that holds blocks:
    its quote node holds inline content, and the importer loads "a
    blockquote holding more than one paragraph or another block" as a raw
    block (the *Kept as source* section of the component docs). Two ways to
    make the surfaces agree were rejected. Loading such a quote as an
    editable container is a feature of the size of the list-item-block
    work. Making source mode decline inside a quote would remove a command
    that works and reads back correctly. Declining on the WYSIWYG surface
    inside every raw block was also considered; it would change what the
    block commands do on HTML blocks and thematic breaks, which is not about
    lists and belongs with the raw-block plans.

[^availability]: "Field `true` means the command changes the document or
    the selection; `false` means it changes nothing at all" is the stack's
    rule (context-menu-caret notes, A-5), with the recorded exception that a
    field covers a command, not a call: `setBlockType("paragraph")` in a
    paragraph changes nothing with the field `true`. The toggles have no
    such call left on the WYSIWYG surface: every touched block is either
    taken out of its list (off) or made an item (on). Assertions 3 and 4 of
    the parity test check this for every row. Source mode's field is
    constant by design: where a source command declines "depends on the raw
    text around the selection, which is not predicted" (`readSurfaceSelectionState`).

[^own-route]: Lexical's `$insertList` goes by the nearest list of each
    selected leaf and replaces that list node whole, so it cannot convert
    one item, and it drops the state this editor keeps on a list (its
    looseness and marker). `$createListOrMerge`, the part that makes one
    block an item and joins a neighbouring list, is not exported from
    `@lexical/list`; `$itemizeBlock` restates it and adds the looseness
    rule. The lifting is not restated: `ListItemNode.replace`
    already outdents and splits, and is what `$setBlocksType` uses on the
    off route. Running the on route in one discrete update keeps it one undo
    step, as the off route is.

[^holder]: Lexical stores a nested list as a list item of its own whose
    first child is the list, and the dependency's importer puts the blocks
    after a nested list into that same item. A list item whose first child
    is a block is therefore already a shape the serializer writes and the
    viewer-model projection reads (`editorListItems`). `$moveToItemAfter`
    gives the new item inline content when the first moved block is a
    paragraph, because that is the form a load gives an item's text: after
    the command the document is the one a reload would build.

[^source-design]: Every source-mode line command is "lift, then check by
    lexing": the check is what makes the commands safe on arbitrary text,
    and a command whose result does not read as intended declines. Keeping
    that design means a mistake in the new code makes a command decline
    rather than write a wrong document. The marker is escaped as `\[ \]` so
    the saved text matches what the WYSIWYG serializer writes for the same
    text, and so `[x]` cannot turn into a reference link where the document
    defines `[x]`.

[^matrix]: The viewer model is compared rather than the saved text because
    the two surfaces legitimately write some things differently: source mode
    leaves untouched lines as they are (a numbered list's later numbers, the
    absence of a blank line between two lists), and the WYSIWYG surface
    writes changed blocks in its standard form. Pinning each surface's exact
    text as well keeps those differences from growing unnoticed. Rows that
    must not read alike follow the round-trip harness's rule for known
    divergences (`assertCheck` in `harness.ts`): a listed difference that
    disappears turns its test red until the entry is removed. Assertion 1
    is there because looseness is only comparable for documents written the
    way the editor saves them: the editor keeps one loose flag per list,
    while the source text can make a list loose with a single blank line.

[^in-item-blocks]: Measured at `0d9902fb0` with this plan's change:
    `setBlockType("h2")` with the caret in `second` of
    `- one ⏎⏎   second ⏎⏎ - two` gives `- one ⏎⏎   ## second ⏎⏎ - two` on
    the WYSIWYG surface and `- one ⏎⏎ ## second ⏎⏎ - two` in source mode;
    `setBlockType("paragraph")` there changes nothing on the WYSIWYG
    surface (the block is already a paragraph) and takes the paragraph out
    of the list in source mode. A range that also covers the item's text
    converts both blocks at the top level on both surfaces, because
    `$isolateItemText` has by then made the second paragraph an item's
    text.
