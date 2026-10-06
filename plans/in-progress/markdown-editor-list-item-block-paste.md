---
depends-on: [markdown-demo-sample-table-width]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-serializer.test.ts
  - packages/lib/tests/component/markdown-editor-columns.test.ts
  - packages/lib/tests/component/display/markdownLexer.test.ts
  - packages/lib/tests/component/display/Markdown.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts
---

# MarkdownEditor List Item Block Paste — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, pasting more than one block into a
**nested** list item leaves a block (a paragraph, code block, table, quote,
`:::` fence, …) inside the outer list item. The editor shows it, the save
writes it, and the `Markdown` viewer renders the save the same way. But
loading that save again shows the whole list as a *raw Markdown block*: the
monospace, text-only block the editor uses for Markdown it has no rich-text
form for. Switching to source mode and back is enough to see it.

Example: in `- a\n  - b\n\nP1\n\nP2`, copy from the start of `P1` to the end
of `P2` and paste at the end of `b`. The editor saves the list as
`- a\n\n  - bP1\n\n  P2`, and that source loads as one raw block.

The fix has four parts, all in the library:

- **A — importer.** `$buildListItem` in
  [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts)
  builds the blocks a list item holds, where today it gives up and returns a
  raw block. This part fixes the 804 pastes.
- **B — importer.** The same function reads a task item's checkbox where
  `marked` puts it in a list that is loose from the start. Today every such
  list (`- [ ] a`, blank line, `- [x] b`) loads as a raw block.
- **C — viewer lexer.** The `:::` fence tokenizer in
  [markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts)
  lexes its columns as blocks when the fence stands in a list item. Today
  the viewer prints such a fence's paragraphs as literal text.
- **D — serializer.** `listItemLines` in
  [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts)
  no longer writes `- ---` for an item that opens with a raw thematic break.

The paste itself does not change: no paste handler, and no rule in
`markdownWritable.ts`. Twelve existing tests that pin the old load are
updated, six round-trip corpus cases lose their known-divergence entry, the
corpus gains sixteen cases, and two docs pages and the changelog are
updated.

This plan is written against `feature/markdown-demo-sample-table-width` at
`4f68f3556`, the tip of the unmerged Markdown stack. Line numbers are from
that commit; find each site by its symbol name first.

---

## Root Cause

### What the fuzz records show

The seeded paste fuzz reports 925 failures over eleven seeds. Sorting its
records by the shape of the failing document gives:[^fuzz-records]

| Fuzz check | Count | Shape behind it | Fixed by |
|---|---|---|---|
| `reload` (and `second:*:reload`) | 804 | a list item holds a block that is not a nested list | Part A |
| `editParity` | 48 | a `:::` fence in a list item, before any nested list | Part C |
| `editParity` | 1 | a raw `---` block opens an item of a `-` list | Part D |
| `editParity` | 25 | a raw block cut to `<div` | not this plan — `markdown-raw-block-html-tail-parity` |
| `emptyContainer`, `undo` | 47 | — | not this plan — sibling plans |

The `reload` failures and the list-item `editParity` failures do **not**
share a cause. They share a precondition: a block standing in a list item.
Part A's 804 failures split into four shapes:

| Shape of the item (`li` = `ListItemNode`) | Count | Saved as |
|---|---|---|
| block after the item's nested list: `li("a")`, `li(list, BLOCK…)` | 703 | `- a\n  - b\n\n  BLOCK` |
| block opens the item: `li(BLOCK…)` | 84 | `- BLOCK` (`- \| h \|`, `- ::: x`, `- ## h`) |
| nested list opens the item, then a block | 9 | `- - b\n\n  BLOCK` |
| block right after the item's text: `li("a", BLOCK)` | 8 | `- a\n\n  BLOCK` |

### 1. Lexical puts the pasted blocks into the outer item

`RangeSelection.insertNodes` joins the first pasted block to the caret's
list item and inserts the rest after that item
([Lexical.dev.mjs:9495](../node_modules/lexical/dist/Lexical.dev.mjs#L9495)).
`ListItemNode.insertAfter`
([LexicalList.dev.mjs:774](../node_modules/@lexical/list/dist/LexicalList.dev.mjs#L774))
does not accept a block that is not a list item. It splits the list and puts
the block after the **list node**.

| Caret's list | The list node's parent | Where the block lands | Loads again as |
|---|---|---|---|
| top-level | the root (or a `:::` column) | between two lists | two lists and the block — correct today |
| nested | the outer `ListItemNode` | inside the outer item, after the nested list | one raw block — the defect |

Lexical stores a nested list as a list item of its own whose first child is
the list. So the outer item of `- a\n  - b` is two nodes, `li("a")` and
`li(list(li("b")))`, and the pasted block becomes a child of the second.

**Insert line after block** reaches the same state without a paste.
`$insertParagraphAroundEnclosingBlock`
([MarkdownEditor.ts:751](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L751))
inserts its paragraph after the caret's *nearest* list, so in a nested list
the paragraph lands inside the outer item.

### 2. The serializer writes such an item; the importer refuses to build it

`appendItemBlocks`
([markdownSerializer.ts:1823](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1823))
writes every block child of a list item as a block of that item. The viewer
reads the result back as the editor shows it: all 804 failing pastes pass
the fuzz's editor-against-viewer check.

`$buildListItem`
([markdownImporter.ts:993](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L993))
accepts only an optional checkbox, one text or paragraph, and nested lists.
For anything else it returns `null`, and `$buildBlock`
([:784](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L784))
turns the whole list into a raw block. The editor can hold, write and show a
state its own importer cannot build.

### 3. A task list that is loose from the start is refused too

`marked` handles a task item's `[ ]` in two ways:

| List | Where `marked` puts the checkbox | Importer today |
|---|---|---|
| made loose while lexing its items (`- [ ] a\n\n  - b`) | a `checkbox` token before the item's paragraph | builds the list |
| loose from the start: a blank line between items (`- [ ] a\n\n- [x] b`) | first token *inside* the paragraph, and `[ ] ` at the start of the paragraph's `raw` | raw block |

In the second form the paragraph's `raw` is `[ ] a` while the item's text is
`a`, so `coversText`
([markdownImporter.ts:916](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L916))
finds text no token covers and `$buildListItem` returns `null`. Any paste
that makes a task list loose runs into this: every task-item row of this
plan's paste matrix fails for this reason once Part A is in.[^task-found]

### 4. A fence in a list item is lexed as text

`marked` lexes a list item's content with `lexer.state.top` set to `false`.
In that state a paragraph comes out as a bare `text` token. In a loose list
`marked` turns an item's direct `text` tokens back into paragraphs, and the
viewer's `appendListItem` renders a direct `text` token's inline content
itself. Neither reaches inside a `:::` fence. The fence tokenizer
([markdownExtensions.ts:180](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L180))
lexes its first column in whatever state it was called in, so the viewer's
`appendBlockToken` prints that column's paragraphs through its plain-text
fallback
([Markdown.ts:1656](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L1656)).

| Source | Viewer today | Viewer after Part C |
|---|---|---|
| `- ::: {align=center}\n  **bold**\n  :::` | the literal text `**bold**`, no `<p>` | `<p><strong>bold</strong></p>` |
| `- ::: columns\n  left\n  \|\|\|\n  right\n  :::` | first column plain text, second a `<p>` | both `<p>` |
| `- a\n  - b\n\n  ::: x\n  w\n  :::` | `<p>` (a nested list came first) | unchanged |

`blockTokens` sets `top` back to `true` when it returns. That is why only
the first column is affected, and only when no nested list comes before the
fence in the item.

### 5. `- ---` is a thematic break, not a list item

A raw `---` block as an item's first block is written on the marker's line:
`- ---`. Markdown reads that line as one thematic break of four dashes, so
the list ends there.

---

## Architecture Decisions

### The fix belongs in the importer — the paste is left alone

`$buildListItem` builds every block a list item holds. Nothing is added to
`MarkdownEditor.ts` or `markdownWritable.ts`, and a paste lands where it
lands today.[^why-importer]

The precedent is `$buildFence`
([markdownImporter.ts:1119](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1119)).
It already builds a container's blocks from its tokens through
`$buildBlock`, with a raw block for whatever a node cannot hold. On the
write side the matching precedent is `appendItemBlocks`
([markdownSerializer.ts:1823](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1823)):
the serializer plan's decision F6, "a list item holding blocks keeps them".

### The contract

After any edit that leaves a block in a list item — a paste, **Insert line
after block**, a load — these four hold:

1. **Parity.** The viewer renders the saved source as the editor shows it.
2. **Reload.** Loading the saved source shows the same document. No list
   becomes a raw block.
3. **Idempotence.** Saving the reloaded document gives the same source.
4. **Undo.** One undo after a paste restores the document from before it.

One state is left out: a list item holding a *repeated* link reference
definition still loads as a raw block (see *Every block token of an item is
built* below).

### Where each block of an item goes

The item's first text or paragraph is the inline content of the item's own
`ListItemNode`, as today. Each later block goes into a *holder*:

- Until the item's first nested list, the holder is the item's own
  `ListItemNode`.
- Each nested list opens a new `ListItemNode` whose first child is the list
  (as today). That node is the holder for the blocks up to the next nested
  list.

| Source | Nodes built (`li` = `ListItemNode`) |
|---|---|
| `- a\n\n  second` | `li("a", paragraph("second"))` |
| `- a\n  - b\n\n  c` | `li("a")`, `li(list(li("b")), paragraph("c"))` |
| `- a\n\n  b\n\n  - c\n\n  d` | `li("a", paragraph("b"))`, `li(list(li("c")), paragraph("d"))` |
| `- a\n  - b\n\n  c\n\n  * d` | `li("a")`, `li(list(li("b")), paragraph("c"))`, `li(list(li("d")))` |
| `- # Foo\n- bar` | `li(heading("Foo"))`, `li("bar")` |
| `- - a` (unchanged) | `li()`, `li(list(li("a")))` |

The node shapes in this table are the ones a paste builds and the
serializer already writes.[^holder]

### Blocks are inserted with `splice`, never `append`

A block is added to its holder with
`holder.splice(holder.getChildrenSize(), 0, [block])`.
`ListItemNode.append` merges a paragraph's children into the item as inline
text, which would turn a second paragraph into more text of the
first.[^splice]

### Inline content first, blocks after

The item's inline content is built by `$buildKeepingConstructs` before any
block is added. That function clears the item and reads back its standard
form several times, and both steps assume the item holds inline content
only.

### A list holding item blocks is built only when its save keeps its looseness

After its items are built, `$buildList` checks one thing for a list one of
whose items holds a block other than a nested list: `$listReadsLoose(list)`
must equal `token.loose`. When it does not, `$buildList` returns `null` and
the list stays a raw block, as today. Lists without such a block skip the
check, so every list that builds today builds exactly as
before.[^looseness]

*Loose* means the viewer wraps each item's text in a paragraph; a blank line
between items or between an item's blocks makes a list loose. The serializer
always writes a blank line before an item block that is not a nested list,
so it cannot write a *tight* item holding such a block.

| Source | Item blocks | `token.loose` | Save reads loose | Result |
|---|---|---|---|---|
| `- a\n\n  b` | text, paragraph | `true` | `true` | list |
| `- a\n\n  > q\n\n- b` | text, quote | `true` | `true` | list |
| `- # Foo\n- bar` | heading alone | `false` | `false` | list |
| `- a\n  > q\n- b` | text, quote, no blank line | `false` | `true` | raw block (unchanged) |
| `- # Foo\n- Bar\n  ---\n  baz` | heading, text, no blank line | `false` | `true` | raw block (unchanged) |

### Every block token of an item is built; only text no token covers keeps a list raw

A link reference definition in an item (a `def` token) is built like any
other block: `$buildBlock` makes it a raw block, as it does at the top level
and in a `:::` column. Item text that no token covers still makes
`$buildListItem` return `null`, as today. `marked` gives no token for a
*repeated* definition, so a list holding one stays a raw
block.[^definitions]

| Source | Item tokens | Result |
|---|---|---|
| `- [q]: https://q.com` | `def` | list: `li(raw("[q]: https://q.com"))` |
| `- a\n  - b\n\n  [x]: /url` | text, list, `def` | list: `li("a")`, `li(list(li("b")), raw("[x]: /url"))` |
| `[x]: /a\n\n- [x]: /b\n- c` | none for the first item (repeated definition) | raw block (unchanged) |

### A checkbox inside the first paragraph is moved out before the item is read

A new helper, `withOwnCheckbox`, takes the checkbox out of the first
paragraph and puts it before that paragraph as a token of its own. That is
the shape `marked` gives a list it made loose while lexing, which
`$buildListItem` already reads. The helper runs before `$buildListItem`
looks at the tokens, so the rest of the function handles both shapes the
same way.

| `marked`'s item tokens | After `withOwnCheckbox` |
|---|---|
| `checkbox`, `paragraph "a"` | unchanged |
| `paragraph { raw: "[ ] a", text: "[ ] a", tokens: [checkbox, text "a"] }` | `checkbox`, `paragraph { raw: "a", text: "a", tokens: [text "a"] }` |
| `paragraph "a"` (no task) | unchanged |

A checkbox with no text after it still returns `null`: the existing rule
"a checkbox before anything but text or a paragraph" now also covers a
paragraph that held only the checkbox.

### The fence tokenizer lexes every column with `top` on

Before each `this.lexer.blockTokens(section)` call, the tokenizer sets
`this.lexer.state.top = true`. The state is not restored afterwards.
`marked`'s own blockquote tokenizer is the precedent: it sets `top` to
`true` around the `blockTokens` call for its content, for the same
reason.[^top]

Part C changes the viewer's lexer. The editor's importer reads with the same
lexer (`lexMarkdown`), so viewer and editor keep accepting the same syntax.

### An item that would open with its own thematic break gets a bare marker line

When an item's first block is not a nested list and the marker line would
read as a thematic break, `listItemLines` writes the marker on a line of its
own and the block under it. `marked` reads `-\n  ---` as an item holding a
thematic break.[^bare-marker]

Under a line of text a bare `-` would read as a setext heading underline.
`serializeList` already writes a `-` list as `*` in that position when its
first item is empty; the same switch now also applies when the first item
would open with its own thematic break. With `*` the line is `* ---`, which
is an item, so no bare marker is needed there.

| List (`raw(x)` = a raw block of text `x`) | Today | After Part D |
|---|---|---|
| `-` list: `a`, `raw(---)`, `b` | `- a\n- ---\n- b` | `- a\n-\n  ---\n- b` |
| `-` list: `raw(---)`, `b` | `- ---\n- b` | `-\n  ---\n- b` |
| `-` list: `a`, `raw(- - -)`, `b` | `- a\n- - - -\n- b` | `- a\n-\n  - - -\n- b` |
| `-` list nested under text `a`: `raw(---)`, `b` | `- a\n  - ---\n  - b` | `- a\n  * ---\n  * b` |
| loose `-` list: `a`, `raw(---)` + `raw(***)`, `b` | `- a\n\n- ---\n\n  ***\n\n- b` | `- a\n\n-\n  ---\n\n  ***\n\n- b` |
| `-` list: `a`, `raw(***)`, `b` | `- a\n- ***\n- b` | unchanged |
| ordered list: `a`, `raw(---)` | `1. a\n2. ---` | unchanged |

### Raw-list test fixtures change to a list that stays raw

Eleven existing tests use a list whose item holds a block (most often a
second paragraph, `- a\n\n  b`) as a convenient raw list. Those lists now
load as lists. Each fixture gets a quote right under another block of the
item, with no blank line between them (`- a\n  > b`). Such a list stays raw
before and after this plan.[^fixtures]

---

## Implementation

### `markdownImporter.ts`

Add to the imports: `$isElementNode` (from `lexical`), `$isListNode` (from
`@lexical/list`), `$listReadsLoose` (from `markdownSerializer.js`, in the
existing import that already brings `$definitionsSource`).

`$buildList` — the body is unchanged up to the end of its loop; add the
check before the final `return list;`:

```ts
    const keepsLooseness = !$holdsItemBlocks(list) || $listReadsLoose(list) === token.loose;

    if (!keepsLooseness) {
        return null;
    }

    return list;
```

New, directly after `$buildList`:

```ts
/**
 * Tells whether an item of a list holds a block other than a nested list:
 * a list the save writes with a blank line before that block.
 *
 * @param list - The list.
 * @returns `true` when one of its items holds such a block.
 */
function $holdsItemBlocks(list: ListNode): boolean {
    return list.getChildren().some((item) => $isElementNode(item)
        && item.getChildren().some((child) => $isElementNode(child) && !child.isInline() && !$isListNode(child)));
}
```

New, directly before `$buildListItem`'s JSDoc block:

```ts
/**
 * A task item's tokens with its checkbox as a token of its own before the
 * item's text. `marked` puts it there in a list it made loose while lexing
 * its items; in a list loose from the start it puts the checkbox first in
 * the first paragraph's own tokens, and the marker at the start of that
 * paragraph's `raw` and `text`, which the item's text does not hold.
 *
 * @param tokens - The item's tokens, `space` tokens dropped.
 * @returns The tokens, the checkbox taken out of the first paragraph.
 */
function withOwnCheckbox(tokens: Token[]): Token[] {
    const first = tokens[0];
    const holdsTokens = first !== undefined && (first.type === "paragraph" || first.type === "text");
    const inner = holdsTokens ? (first as Tokens.Paragraph).tokens?.[0] : undefined;

    if (first === undefined || inner?.type !== "checkbox") {
        return tokens;
    }

    const paragraph = first as Tokens.Paragraph;
    const own = {
        ...paragraph,
        raw:    paragraph.raw.slice(inner.raw.length),
        text:   paragraph.text.slice(inner.raw.length),
        tokens: paragraph.tokens.slice(1),
    };

    return [inner, own, ...tokens.slice(1)];
}
```

`$buildListItem` — replace the whole body. The `$buildKeepingConstructs`
call is the existing one, unchanged:

```ts
function $buildListItem(item: Tokens.ListItem): ListItemNode[] | null {
    const content = withOwnCheckbox(withoutSpace(item.tokens));
    const located = locateTokens(item.text, content);
    const covered = located.every((entry) => !("gap" in entry));

    if (!covered) {
        return null;
    }

    const checkbox = content[0]?.type === "checkbox" ? content.shift()! : null;
    const first = content[0];
    const text = first !== undefined && (first.type === "text" || first.type === "paragraph") ? first : null;
    const rest = text === null ? content : content.slice(1);
    const tokens = text === null ? [] : text.type === "paragraph" ? (text as Tokens.Paragraph).tokens : [text];

    // The viewer prints a task marker inline at the start of the item's text
    // or first paragraph; before anything else it stands on a line of its
    // own, which an item's line of text cannot show.
    if (checkbox !== null && tokens.length === 0) {
        return null;
    }

    const listItem = $createListItemNode();

    $buildKeepingConstructs(listItem, [...(checkbox === null ? [] : [checkbox]), ...tokens], null, (keep) => {
        // …existing callback, unchanged…
    });

    return $buildItemBlocks(listItem, rest, located);
}
```

New, directly after `$buildListItem`:

```ts
/**
 * Builds the blocks after a list item's text. A block goes into the item's
 * own node until the item's first nested list; each nested list opens a new
 * item node whose first child is the list (Lexical's shape for nesting),
 * which then takes the blocks up to the next nested list.
 *
 * @param listItem - The item's own node, its inline content already built.
 * @param tokens - The item's block tokens after its text.
 * @param located - The item's tokens with their source text.
 * @returns The item's nodes, or `null` when a nested list cannot be built.
 */
function $buildItemBlocks(listItem: ListItemNode, tokens: Token[], located: LocatedBlock[]): ListItemNode[] | null {
    const items: ListItemNode[] = [listItem];
    let holder: ListItemNode = listItem;

    for (const token of tokens) {
        if (token.type !== "list") {
            // `ListItemNode.append` would merge a paragraph's children into the item.
            holder.splice(holder.getChildrenSize(), 0, [$buildItemBlock(token, located)]);

            continue;
        }

        const nested = $buildList(token as Tokens.List);

        if (nested === null) {
            return null;
        }

        holder = $createListItemNode().append(nested);
        items.push(holder);
    }

    return items;
}

/**
 * Builds one block of a list item other than a nested list. A `text` token
 * (a paragraph `marked` lexed in a tight item) is a paragraph, as the viewer
 * renders it; any other token is built as a block anywhere is.
 *
 * @param token - The block token.
 * @param located - The item's tokens with their source text.
 * @returns The block's node.
 */
function $buildItemBlock(token: Token, located: LocatedBlock[]): LexicalNode {
    if (token.type === "text") {
        return $appendInlineContent($createParagraphNode(), (token as Tokens.Text).tokens ?? [token]);
    }

    const entry = located.find((candidate) => !("gap" in candidate) && candidate.token === token);
    const source = entry !== undefined && !("gap" in entry) ? entry.source : withoutBlankEdges(token.raw ?? "");

    return $buildBlock(token, source);
}
```

`coversText` stays: `$buildQuote` still calls it.

### `markdownExtensions.ts`

In `BLOCK_EXTENSION.tokenizer`, replace the `columns:` line:

```ts
            columns:    splitColumnSections(inner).map((section) => {
                // A fence holds blocks wherever it stands. In a list item `marked` lexes with `top` off, where a
                // paragraph is a bare `text` token; `blockTokens` turns `top` back on when it returns.
                this.lexer.state.top = true;

                return this.lexer.blockTokens(section);
            }),
```

### `markdownSerializer.ts`

In `serializeList`, replace the one `const markerOf = …` line:

```ts
    const opening = items[0]?.[0];
    const plainMarker = listMarkerWriter(list, false, marker)(0);
    // A raw thematic break of the bullet's own character opening the first item puts the marker on a line of
    // its own (see `listItemLines`), which under a line of text is a setext underline, as an empty item's is.
    const opensWithBreak = opening !== undefined && opening.withMarker === undefined
        && THEMATIC_BREAK.test(`${plainMarker} ${opening.markdown.split("\n")[0]!}`);
    const markerOf = listMarkerWriter(list, underText && (items[0]?.length === 0 || opensWithBreak), marker);
```

In `listItemLines`, add between the existing `if (THEMATIC_BREAK.test(first) && nested.withMarker !== undefined …) { … }`
block and the final `return [first, ...lines.slice(1)];`:

```ts
    // An item opening with a raw thematic break of its bullet's own character would read as one break
    // (`- ---`): the marker stands on a line of its own and the block under it, which `marked` reads as the
    // item's block.
    const opensWithOwnBreak = nested.withMarker === undefined && THEMATIC_BREAK.test(first);

    if (opensWithOwnBreak) {
        return [marker, ...lines];
    }
```

`lines` already holds every block's lines indented under the marker, so
`[marker, ...lines]` is the marker line followed by the item's whole content.

---

## Ordered Implementation Steps

Run every command from `packages/lib` unless it says "repo root". Work
test-first: each part adds its failing tests, then the code.

**Part C — the fence tokenizer**

1. In [markdownLexer.test.ts](../packages/lib/tests/component/display/markdownLexer.test.ts),
   after the `describe('the fence extension reads code fences inside a fence', …)`
   block (line 257), add `describe('the fence extension lexes a fence in a list item as blocks', …)`
   with rows LI1–LI4 from *Expected Behaviour*. Add the local helper
   `fenceColumnTypes` described there.
2. In [Markdown.test.ts](../packages/lib/tests/component/display/Markdown.test.ts),
   inside `describe('Markdown block fence (alignment / columns)', …)`
   (line 449), add row V1.
3. Run `npx vitest run tests/component/display/markdownLexer.test.ts tests/component/display/Markdown.test.ts`.
   Expect LI1, LI2 and V1 to fail, LI3 and LI4 to pass.
4. Make the `markdownExtensions.ts` change under *Implementation*. Add one
   sentence to `BLOCK_EXTENSION`'s JSDoc: each section is lexed with
   `marked`'s `top` state on, so a fence in a list item holds paragraphs.
   Rerun step 3's command: all pass.

**Part D — the serializer**

5. In [markdown-serializer.test.ts](../packages/lib/tests/component/markdown-serializer.test.ts),
   inside `describe('F6: a list item holding blocks writes each as a block of the item', …)`
   (line 1097), add rows S1–S7. Build each list with the file's existing
   `item(…)` helper (line 957) and `$createMarkdownRawBlockNode`.
6. Run `npx vitest run tests/component/markdown-serializer.test.ts`. Expect
   S1, S2, S3, S5 and S6 to fail, S4 and S7 to pass.
7. Make the two `markdownSerializer.ts` changes under *Implementation*. Add
   to `listItemLines`'s JSDoc that an item whose first block is not a nested
   list and whose marker line would read as a thematic break is written with
   its marker on a line of its own. Add to `serializeList`'s `underText`
   `@param` that the `*` switch also applies when the first item opens with
   a thematic break of the bullet's character. Rerun step 6: all pass.

**Parts A and B — the importer**

8. Change the raw-list fixtures in
   [markdown-importer.test.ts](../packages/lib/tests/component/markdown-importer.test.ts)
   exactly as the table *Existing tests that change* lists (rows F1–F8).
   Run `npx vitest run tests/component/markdown-importer.test.ts`: all pass.
   The new fixtures are raw lists on the current code too.
9. In the same file, change I11 (line 243) and add the three `describe`
   blocks from *Importer* under *Expected Behaviour* (rows B1–B14, T1–T5,
   R1–R3). Add the local helper `itemChildTypes` described there.
10. In [markdown-editor-columns.test.ts](../packages/lib/tests/component/markdown-editor-columns.test.ts),
    replace W7, W9 and W10 and add W7b, W9b and W10b as *Existing tests that
    change* lists.
11. Update the round-trip corpus as *Round-trip corpus* under *Expected
    Behaviour* lists: remove six `known` entries, add sixteen cases, reword
    one divergence reason.
12. Create
    `packages/lib/tests/component/markdown-editor-list-item-paste.test.ts`
    with the paste matrix, the pinned rows P1–P14 and rows O1–O2. Copy the
    helpers `lexicalOf`, `load`, `update`, `$textNode`, `selectText`,
    `copySelection` and `pasteNodes` from
    [markdown-editor-columns.test.ts:48–133](../packages/lib/tests/component/markdown-editor-columns.test.ts#L48),
    with the same `CONFIG`, `beforeEach` and `afterEach`. Start the file
    with the `// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0`
    line that file starts with.
13. Run `npx vitest run tests/component/markdown-importer.test.ts tests/component/markdown-editor-columns.test.ts tests/component/markdown-roundtrip tests/component/markdown-editor-list-item-paste.test.ts`.
    Expect failures only in: I11, B1–B14, T1–T5, W7b, W9b, W10b, the
    `surface` check of every new corpus case without a `known` entry and of
    the six cases whose `known` entry was removed, 132 of the 165 matrix
    rows, P2–P14, O1 and O2.
14. Make the `markdownImporter.ts` changes under *Implementation*. Update
    two JSDoc blocks:
    - `$buildList`: it builds a list when every item can be built, and a
      list one of whose items holds a block other than a nested list only
      when its save keeps the looseness the viewer reads.
    - `$buildListItem`: it builds the item's text, then its blocks; it
      returns `null` when item text is covered by no token, when a checkbox
      has no text after it, or when a nested list cannot be built.
15. Rerun step 13's command: all pass.
16. `grep -n 'coversText' src/typescript/lib/component/editor/markdownImporter.ts`
    — expect two matches (the function and its call in `$buildQuote`).
    `grep -n 'state.top' src/typescript/lib/component/display/markdownExtensions.ts`
    — expect one match.

**Docs and full checks**

17. Make the edits under *Documentation Impact*.
18. Run everything under *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Create | `packages/lib/tests/component/markdown-editor-list-item-paste.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-columns.test.ts` |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every row is testable offline unless it is under *Manual (browser) checks*.
In the tables, `\n` is a newline in the source string and `x@n` is offset
`n` in the text node whose text is exactly `x`.

### Lexer and viewer (Part C)

`fenceColumnTypes(source)`: take the first list item of
`lexMarkdown(source)[0]`, find its first `mdblock` token, and return each
column's token types with `space` tokens dropped.

| # | Source | Expected | Today |
|---|---|---|---|
| LI1 | `- ::: columns\n  **left**\n  \|\|\|\n  right\n  :::` | `[['paragraph'], ['paragraph']]` | `[['text'], ['paragraph']]` |
| LI2 | `- a\n\n  ::: {align=center}\n  x\n  :::` | `[['paragraph']]` | `[['text']]` |
| LI3 | `- a\n  - b\n\n  ::: x\n  w\n  :::` (control) | `[['paragraph']]` | same |
| LI4 | each source of LI1–LI3 | `lexMarkdown(source)` deep-equals `lexMarkdownUnbounded(source)` | same |
| V1 | `new Markdown('- ::: {align=center}\n  **bold**\n  :::')`, then `getElement(true)` | `createdTags()` equals `['div', 'ul', 'li', 'div', 'div', 'p', 'strong']` | ends `…, 'div', 'span']` |

### Serializer (Part D)

Each row serializes one list built from nodes and asserts the exact output.
Each row also asserts that the viewer reads the output as one list:
`viewerModel(output).blocks.map((block) => block.kind)` equals `['list']`.
Today S1, S2, S3, S5 and S6 fail the output assertion.

| # | List | Expected output |
|---|---|---|
| S1 | `bullets(item('a'), item(raw('---')), item('b'))` | `- a\n-\n  ---\n- b` |
| S2 | `bullets(item(raw('---')), item('b'))` | `-\n  ---\n- b` |
| S3 | `bullets(item('a'), item(bullets(item(raw('---')), item('b'))))` | `- a\n  * ---\n  * b` |
| S4 | `bullets(item('a'), item(raw('***')), item('b'))` | `- a\n- ***\n- b` |
| S5 | `bullets(item('a'), item(raw('- - -')), item('b'))` | `- a\n-\n  - - -\n- b` |
| S6 | `bullets(item('a'), item(raw('---'), raw('***')), item('b'))` | `- a\n\n-\n  ---\n\n  ***\n\n- b` |
| S7 | `$createListNode('number', 1).append(item('a'), item(raw('---')))` | `1. a\n2. ---` |

`item(…)` is the file's existing helper. `bullets(…items)` is
`$createListNode('bullet').append(…items)`, and `raw(x)` is `$createMarkdownRawBlockNode(x)`.

### Importer (Parts A and B)

`itemChildTypes(editor)`: for the root's first child (a list), return each
`ListItemNode`'s children's `getType()` values.

**Loads as a list.** Each row asserts `rootTypes(editor)[0]` equals
`'list'`, `expectSurface(editor, source)` and
`editor.getValue() === source`. All fail today (the list is a
`markdown-raw-block`).

| # | Source | Also assert |
|---|---|---|
| I11 | `- one\n\n  two` | `itemChildTypes` = `[['text', 'paragraph']]` |
| B1 | `- a\n  - b\n\n  c\n- d` | `itemChildTypes` = `[['text'], ['list', 'paragraph'], ['text']]` |
| B2 | `- a\n\n  b\n\n  - c\n\n  d` | `[['text', 'paragraph'], ['list', 'paragraph']]` |
| B3 | `- a\n  - b\n\n  c\n\n  * d` | `[['text'], ['list', 'paragraph'], ['list']]` |
| B4 | `1. a\n\n   b\n2. c` | `[['text', 'paragraph'], ['text']]` |
| B5 | `- a\n\n  ```\n  code\n  ```\n\n- b` | `[['text', 'code'], ['text']]` |
| B6 | `- a\n\n  > q\n\n- b` | `[['text', 'quote'], ['text']]` |
| B7 | `- a\n\n  <div>\n  x\n  </div>\n\n- b` | `[['text', 'markdown-raw-block'], ['text']]` |
| B8 | `- a\n\n- \| h \|\n  \| --- \|\n  \| c \|\n\n- b` | `[['text'], ['table'], ['text']]` |
| B9 | `- # Foo\n- bar` | `[['heading'], ['text']]` |
| B10 | `- a\n\n- ::: {align=center}\n  **f**\n\n  g\n  :::\n\n- b` | `[['text'], ['markdown-block'], ['text']]` |
| B11 | `- a\n-\n  ---\n- b` | `[['text'], ['markdown-raw-block'], ['text']]` |
| B12 | `- a\n\n  second\n\n  third` | `[['text', 'paragraph', 'paragraph']]` |
| B13 | `- [q]: https://q.com\n\nSee [q].` | `[['markdown-raw-block']]` |
| B14 | `- a\n  - b\n\n  [x]: /url\n\nsee [x]` | `[['text'], ['list', 'markdown-raw-block']]` |

Rename I11 to `'I11: a list item holding two paragraphs is a list, the
second paragraph a block of the item'`. I11, B1–B4 and B12 are the rows
that catch an `append` in place of the `splice`.

**Task lists.** The same three assertions.

| # | Source | Today |
|---|---|---|
| T1 | `- [ ] a\n\n- [x] b` | raw block |
| T2 | `- [ ] a\n  - [x] b\n\n- [ ] c` | raw block |
| T3 | `- [ ] a\n  - [x] b\n\n  c\n\n- [ ] d` | raw block |
| T4 | `- [ ] a\n\n  b\n\n- [x] c` | raw block |
| T5 | `- a\n\n  b\n- [ ] c` | raw block |

**Stays a raw block.** Each row asserts that `rootTypes(editor)` holds no
`'list'` and that `editor.getValue() === source`. All pass today and must
keep passing.

| # | Source | Why |
|---|---|---|
| R1 | `- a\n  > q\n- b` | a block right under the item's text: the save would make the list loose |
| R2 | `- # Foo\n- Bar\n  ---\n  baz` | a heading and text with no blank line between |
| R3 | `[x]: /a\n\n- [x]: /b\n- c` | an item holding a repeated definition, which no token covers |

### Paste matrix

A table-driven test over 5 targets × 11 clipboards × 3 positions = 165
cases. The clipboard is copied from a second editor, then pasted into the
target at `bcd`@0, `bcd`@1 or `bcd`@3.

| Target | Source |
|---|---|
| top-level item | `- bcd\n- z` |
| nested item | `- a\n  - bcd\n  - e\n- f` |
| ordered nested item | `1. a\n   1. bcd\n   2. e\n2. f` |
| task nested item | `- [ ] a\n  - [x] bcd\n- [ ] f` |
| loose nested item | `- a\n\n  - bcd\n\n- f` |

| Clipboard | Copied from | Copy | Copied node types |
|---|---|---|---|
| paragraphs | `P1\n\nP2` | `P1`@0 → `P2`@2 | paragraph, paragraph |
| heading | `## H\n\nP2` | `H`@0 → `P2`@2 | heading, paragraph |
| code | `` ```\ncode\n```\n\nP2 `` | `code`@0 → `P2`@2 | code, paragraph |
| list | `- x\n- y\n\nP2` | `x`@0 → `P2`@2 | list, paragraph |
| table | `\| h \|\n\| --- \|\n\| c \|\n\nP2` | `h`@0 → `P2`@2 | table, paragraph |
| quote | `> q\n\nP2` | `q`@0 → `P2`@2 | quote, paragraph |
| fence | `::: {align=center}\n**f**\n:::\n\nP2` | `f`@0 → `P2`@2 | markdown-block, paragraph |
| HTML | `<div>\nx\n</div>\n\nP2` | `<div>`@0 → `P2`@2 | markdown-raw-block, paragraph |
| paragraph, code | `` P1\n\n```\ncode\n``` `` | `P1`@0 → `code`@4 | paragraph, code |
| paragraph, fence | `P1\n\n::: {align=center}\n**f**\n:::` | `P1`@0 → `f`@1 | paragraph, markdown-block |
| paragraph, definition | `P1\n\n[x]: /url` | `P1`@0 → `[x]: /url`@9 | paragraph, markdown-raw-block |

Every case asserts the contract, with `saved = editor.getValue()` taken
right after the paste:

| Check | Assertion |
|---|---|
| parity | `editorSurfaceModel(editor)` equals `viewerModel(saved).blocks` |
| reload | `editorSurfaceModel(load(saved))` equals `editorSurfaceModel(editor)` |
| idempotence | `load(saved).getValue()` equals `saved` |
| undo | after one `lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined)`, `editor.getValue()` equals the target's source |

Today the 33 top-level cases pass. The other 132 fail *reload*, and three of
those also fail *parity* (the fence clipboard at `bcd`@0 in the nested,
ordered and loose targets).

### Pinned paste results

These rows also assert the exact `saved`. P1 passes today; it is the
control showing a top-level paste still splits the list.

| # | Target | Clipboard | At | `saved` |
|---|---|---|---|---|
| P1 | top-level | paragraphs | `bcd`@1 | `- bP1\n\nP2cd\n\n- z` |
| P2 | nested | paragraphs | `bcd`@0 | `- a\n  - P1\n\n  P2bcd\n\n  - e\n\n- f` |
| P3 | nested | paragraphs | `bcd`@1 | `- a\n  - bP1\n\n  P2cd\n\n  - e\n\n- f` |
| P4 | nested | paragraphs | `bcd`@3 | `- a\n  - bcdP1\n\n  P2\n\n  - e\n\n- f` |
| P5 | nested | heading | `bcd`@1 | `- a\n  - bH\n\n  P2cd\n\n  - e\n\n- f` |
| P6 | nested | paragraph, code | `bcd`@3 | `` - a\n  - bcdP1\n\n  ```\n  code\n  ```\n\n  - e\n\n- f `` |
| P7 | nested | list | `bcd`@1 | `- a\n  - b\n  - x\n  - y\n\n  P2cd\n\n  - e\n\n- f` |
| P8 | nested | table | `bcd`@1 | `- a\n  - b\n\n  \| h \|\n  \| --- \|\n  \| c \|\n\n  P2cd\n\n  - e\n\n- f` |
| P9 | nested | quote | `bcd`@1 | `- a\n  - bq\n\n  P2cd\n\n  - e\n\n- f` |
| P10 | nested | fence | `bcd`@0 | `- a\n\n- ::: {align=center}\n  **f**\n  :::\n\n  P2bcd\n\n  - e\n\n- f` |
| P11 | ordered | paragraphs | `bcd`@1 | `1. a\n   1. bP1\n\n   P2cd\n\n   1. e\n\n2. f` |
| P12 | task | paragraphs | `bcd`@1 | `- [ ] a\n  - [x] bP1\n\n  P2cd\n\n- [ ] f` |
| P13 | loose | paragraphs | `bcd`@1 | `- a\n  - bP1\n\n  P2cd\n\n- f` |
| P14 | nested | paragraph, definition | `bcd`@1 | `- a\n  - bP1\n\n  [x]: /urlcd\n\n  - e\n\n- f` |

### Other routes to a block in a list item

| # | Steps | Expected |
|---|---|---|
| O1 | load `- a\n  - b\n- c`; caret at `b`@1; `editor.insertParagraphAfterBlock()`; dispatch `CONTROLLED_TEXT_INSERTION_COMMAND` with `'X'` | `saved` = `- a\n  - b\n\n  X\n\n- c`; parity, reload and idempotence hold |
| O2 | load `- a\n  - b\n\nP1\n\nP2`; copy `P1`@0 → `P2`@2 in the same editor; paste at `b`@1 | `saved` = `- a\n\n  - bP1\n\n  P2\n\nP1\n\nP2`; all four checks hold |

O2 is the example the defect was reported with.

### Round-trip corpus

Remove `known: { surface: 'listItemBlocks' }` from six cases. Do not rename
them: a case's name seeds its edit fuzz.

- `corpus/commonmark.ts`: `CommonMark 256 (List items)`, `CommonMark 316 (Lists)`,
  `CommonMark 319 (Lists)`.
- `corpus/dialect.ts`: `raw list whose indented second marker continues the first item`.
- `corpus/referenceLinks.ts`: `definition in a list item`,
  `star definition in a list item`.

`CommonMark 300 (List items)` and `duplicate definition in a list item` keep
their `known` entry.

Add at the end of the array in `corpus/dialect.ts`:

```ts
    { name: 'paragraph after a nested list in a list item', source: '- a\n  - b\n\n  c\n- d' },
    { name: 'two paragraphs in an ordered list item', source: '1. a\n\n   b\n2. c' },
    { name: 'code block in a list item', source: '- a\n\n  ```\n  code\n  ```\n\n- b' },
    { name: 'quote in a list item', source: '- a\n\n  > q\n\n- b' },
    { name: 'HTML block in a list item', source: '- a\n\n  <div>\n  x\n  </div>\n\n- b' },
    { name: 'table opening a list item', source: '- a\n\n- | h |\n  | --- |\n  | c |\n\n- b' },
    { name: 'heading opening a list item', source: '- # Foo\n- bar' },
    { name: 'fence opening a list item', source: '- a\n\n- ::: {align=center}\n  **f**\n\n  g\n  :::\n\n- b' },
    { name: 'fence columns opening a list item', source: '- ::: columns\n  left\n  |||\n  right\n  :::' },
    { name: 'fence under a list item text', source: '- a\n\n  ::: {align=center}\n  *f*\n  :::' },
    { name: 'thematic break under a bare list marker', source: '- a\n-\n  ---\n- b' },
    { name: 'thematic break opening a nested list item', source: '- a\n  * ---\n  * b' },
    { name: 'loose task list', source: '- [ ] a\n\n- [x] b' },
    { name: 'loose task list with a nested item and a paragraph', source: '- [ ] a\n  - [x] b\n\n  c\n\n- [ ] d' },
    { name: 'tight block under a list item text', source: '- a\n  > q\n- b', known: { surface: 'listItemBlocks' } },
    { name: 'multi-paragraph quote in a list item', source: '- a\n\n  > q1\n  >\n  > q2\n\n- b', known: { surface: 'quoteBlocks' } },
```

Every check of every new case passes with the fix, the edit fuzz included,
except the two `known` surface checks, which must keep failing.[^harness-blind]

In `corpus/divergences.ts`, replace the `listItemBlocks` reason with:

> A list one of whose items holds a repeated link reference definition
> (which marked drops without a token, and the viewer renders as an empty
> item), or a block right under another with no blank line between them
> (which a save cannot write without making the list loose), is kept as a
> raw Markdown block: saved unchanged, but shown as source where the viewer
> renders a list.

### Existing tests that change

`markdown-importer.test.ts` — fixtures only; each test's assertions keep
their shape. `OLD → NEW` is a replacement inside the named string.

| # | Test (line) | Change |
|---|---|---|
| F1 | `#12`, row `a bullet list after a raw bullet list` (1833) | source and saved: `- a\n\n  b` → `- a\n  > b` |
| F2 | `#12`, row `a bullet list before a raw bullet list` (1834) | source and saved: `- a\n\n  b` → `- a\n  > b` |
| F3 | `#12`, row `an ordered list after a raw ordered list` (1835) | source and saved: `1. a\n\n   b` → `1. a\n   > b` |
| F4 | `#12`, row `a bullet list between raw bullet lists of two markers` (1836) | source and saved: `- a\n\n  b` → `- a\n  > b` and `* c\n\n  d` → `* c\n  > d` |
| F5 | `#12`, row `an ordered list between raw ordered lists of both delimiters` (1838) | source and saved: `1. a\n\n   b` → `1. a\n   > b` and `1) c\n\n   d` → `1) c\n   > d` |
| F6 | `two raw lists an edit brings together…` (1857) | loaded source: `- a\n  > b\n\n<!-- x -->\n\n- c\n  > d`; expected save: `- a\n  > b\n\n[//]: #\n\n- c\n  > d` |
| F7 | `a loaded list before an indented raw list…` (1870) | `source` literal: `' - *\n  * 0\n    > 9\nd'` (it starts with a space); expected `standard` literal: `'- *\n\n[//]: #\n\n  * 0\n    > 9\nd'` |
| F8 | `a nested list after a raw list of its marker in one item…` (3646) | the raw block's text: `1) x\n\n   p` → `1) x\n   > p`; reword its comment: the list's item holds a quote right under its text, so it stays raw |

After F1, row 1 reads `['a bullet list after a raw bullet list', '- a\n  > b\n\n1) x', 'x', (editor) => editor.toggleUnorderedList(), '- a\n  > b\n\n* x']`.

`markdown-editor-columns.test.ts` — W7, W9 and W10 keep their intent with a
list that stays raw; W7b, W9b and W10b are new and pin the list that now
loads as a list. Each test keeps the `caretAtStart(editor)` and the command
of the test it replaces.

| # | Source loaded | Command | Expected |
|---|---|---|---|
| W7 | `- a\n  > b\n  :::` | `setColumnCount(2)` | value `::: columns\n\\- a\\\n\\> b\\\n\\:::\n\|\|\|\n\n:::`; `columnChildTypes` = `['paragraph', 'paragraph']`; `expectParity` |
| W7b | `- a\n\n  b\n  :::` | `setColumnCount(2)` | value `::: columns\n- a\n\n  b\n  \\:::\n\|\|\|\n\n:::`; `columnChildTypes` = `['list', 'paragraph']`; `expectParity` |
| W9 | `` - ```\n  :::\n  ```\n  > q `` | `setBlockAlignment('center')` | value `` ::: {align=center}\n- ```\n  :::\n  ```\n  > q\n::: ``; `columnChildTypes` = `['markdown-raw-block']`; `viewerBlockKinds` = `['fence(list)']` |
| W9b | `` - ```\n  :::\n  ``` `` | `setBlockAlignment('center')` | value `` ::: {align=center}\n- ```\n  :::\n  ```\n::: ``; `columnChildTypes` = `['list']`; `viewerBlockKinds` = `['fence(list)']`; `expectParity` |
| W10 | `- ::: {align=right}\n  x\n  :::\n  > q\n\nafter` | `setBlockAlignment('center')` | value `::: {align=center}\n- ::: {align=right}\n  x\n  :::\n  > q\n:::\n\nafter`; `columnChildTypes` = `['markdown-raw-block']`; `viewerBlockKinds` = `['fence(list)', 'paragraph']` |
| W10b | `- ::: {align=right}\n  x\n  :::\n\nafter` | `expectParity` right after the load, then `setBlockAlignment('center')` | value `- ::: {align=center}\n  x\n  :::\n\nafter`; `viewerBlockKinds` = `['list', 'paragraph']`; `expectParity` |

In the value column, `\\` is one backslash in the saved text, written as in
a TypeScript string literal: W7's value is the literal
`'::: columns\n\\- a\\\n\\> b\\\n\\:::\n|||\n\n:::'`.

Test names: W7 keeps its name. W7b: `'W7b: a list whose item holds a
paragraph with a ::: line stays a list, the line escaped'`. W9: `'W9: a raw
list whose item starts with a code block stays raw, and the fence reads past
it'`. W9b: `'W9b: a list whose item starts with a code block is a list, and
the fence reads past the code'`. W10: `'W10: a raw list whose item starts
with a fence stays raw, and the outer fence reads past its closer'`. W10b:
`'W10b: a list whose item starts with a fence is a list, and aligning at its
start aligns that fence'`.

In W10b the caret at the document's start is inside the item's fence, so
`setBlockAlignment` aligns that fence. It no longer wraps the list.

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**. Switch to source
mode with the toolbar's source toggle, replace the text with the five lines
below, and switch back. The document is now a list item `a` holding a
nested item `b`, followed by two paragraphs.

```
- a
  - b

P1

P2
```

| # | Steps | Expected |
|---|---|---|
| M1 | Select from the start of `P1` to the end of `P2`, Ctrl/Cmd+C, click at the end of `b`, Ctrl/Cmd+V | the nested item reads `bP1`; `P2` is a paragraph under it, aligned with `a`'s text |
| M2 | After M1, switch to source mode and back with the toolbar's source toggle | the list is still a list, not a block of monospace source |
| M3 | Set the document up again as above, repeat M1, then press Ctrl/Cmd+Z once | the document is back to how it was before the paste |
| M4 | Right-click in `b` → **Insert line after block**, type `X`, then toggle source mode and back | `X` is a paragraph inside item `a`; the list is still a list |
| M5 | In source mode, replace the text with `- ::: {align=center}` / `  **bold**` / `  :::`, then switch back | the item shows `bold` in bold and centred, with no asterisks |

---

## Verification

- `npm run typecheck` (repo root) and `npm -w packages/lib run typecheck:test`.
- `npx vitest run tests/component/display/markdownLexer.test.ts tests/component/display/Markdown.test.ts`
  (from `packages/lib`): LI1–LI4 and V1 pass.
- `npx vitest run tests/component/markdown-serializer.test.ts`: S1–S7 pass.
- `npx vitest run tests/component/markdown-importer.test.ts tests/component/markdown-editor-columns.test.ts`:
  every row passes.
- `npx vitest run tests/component/markdown-roundtrip`: every harness check
  and the edit fuzz pass, the sixteen new cases included.
- `npx vitest run tests/component/markdown-editor-list-item-paste.test.ts`:
  165 matrix rows, P1–P14, O1 and O2 pass.
- `npm test` (repo root): full suite green.
- `npm run lint` (repo root): zero errors.
- `npm run docs:api` (repo root).
- The two `grep` checks of step 16.
- Manual rows M1–M5.

---

## Documentation Impact

No exported symbol changes. Three pages change.

**[MarkdownEditor.md](../packages/lib/docs/components/MarkdownEditor.md)**

- In the paragraph starting "Markdown the editor has no rich-text form for"
  (line 82), replace the words "a whole list when any of its items does,"
  with the line below, written as Markdown:

  ```
  a whole list when one of its items holds a repeated link reference definition or a block right under another with no blank line between them (`- a` over an indented `> q`),
  ```
- At the end of the **Lists.** bullet (line 95), add: "A list item holds
  blocks as the viewer shows them: further paragraphs, code blocks, quotes,
  tables, `:::` fences and raw Markdown blocks (a link reference definition
  among them) load as blocks of the item, before or after its nested lists. Pasting several blocks into a nested
  list item, or **Insert line after block** inside a nested list, adds such
  a block to the outer item, and it is kept through a save and a load. A
  raw thematic break of the bullet's own character that opens an item
  (`---` in a `-` list) is saved under the marker on a line of its own,
  since `- ---` is one thematic break."

**[Markdown.md](../packages/lib/docs/components/Markdown.md)**

- In the paragraph starting "A `::: {…}` fence opens on a line" (line 75),
  after the sentence ending "since the line closing it is indented under
  the item.", add: "A fence in a list item holds blocks like a fence
  anywhere else: its paragraphs render as paragraphs, with their inline
  formatting."

**[next.md](../packages/lib/docs/reference/changelog/next.md)** — add three
entries at the end of `## Fixed` → `### Components` (just before
`### Core`):

- "**`MarkdownEditor` keeps a list whose item holds a block.** Pasting
  several blocks into a nested list item, or **Insert line after block**
  inside a nested list, leaves a paragraph, code block, table, quote or
  `:::` fence inside the outer list item. The save wrote it and the viewer
  showed it, but loading that Markdown again — or switching to source mode
  and back — showed the whole list as a raw Markdown block. A list whose
  items hold such blocks, written by the editor or by hand, now loads as a
  list, each block a block of its item. A task list with a blank line
  between its items loaded as a raw block for a related reason and now
  loads as a list too. A list still loads as a raw block when one of its
  items holds a repeated link reference definition, or a block right under
  another with no blank line between them. No consumer action is needed."
- "**`Markdown` renders a `:::` fence in a list item as blocks.** The first
  column of a fence standing in a list item before any nested list printed
  its paragraphs as literal text: `**bold**` kept its asterisks. Its content
  is now read as blocks, as in a fence anywhere else. `MarkdownEditor` loads
  these documents the same way. No consumer action is needed."
- "**`MarkdownEditor` saves a thematic break that opens a list item as an
  item.** A raw `---` block opening an item of a `-` list was saved as
  `- ---`, which Markdown reads as one thematic break that ends the list.
  The marker is now written on a line of its own, with the break under it.
  No consumer action is needed."

---

## Potential Challenges

- **`ListItemNode.append` flattens a paragraph.** Use `splice` for every
  block, as the snippet does; rows I11, B1, B2, B3, B4 and B12 fail when a
  paragraph was appended.
- **A raw block that reads as such a list now shows as the list.**
  `$showRawBlockAsItsBlocks`
  ([markdownWritable.ts:573](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L573))
  builds a raw block's text with the same importer. That is why F8's raw
  block must change; it is the intended result, not a regression.
- **Sibling plans edit the same files.** `markdownImporter.ts`,
  `markdownSerializer.ts` and `next.md` are shared. Apply each change by
  symbol name, not by line number, and append the changelog entries without
  touching the neighbours.
- **A corpus case fails a check after step 14.** Do not add a `known` entry
  to make it pass. Stop and report the case: the looseness check is meant to
  keep every list the save cannot write back as a raw block.
- **`createdTags()` in V1 depends on the render order.** If the list of tags
  differs in a way unrelated to `p` and `strong`, assert instead that the
  list contains `'p'` and `'strong'` and does not contain `'span'`.

---

## Critical Files

- [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts)
  — `$buildList` (952), `$buildListItem` (993), `$buildBlock` (778),
  `locateTokens` (539), `coversText` (916), and the precedent `$buildFence`
  (1119).
- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts)
  — `$listReadsLoose` (1074), `serializeList` (1788), the precedent
  `appendItemBlocks` (1823), `listMarkerWriter` (1933), `listItemLines`
  (1962), `THEMATIC_BREAK` (47).
- [markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts)
  — `BLOCK_EXTENSION` (128), `listWithOwnTaskMarker` (362).
- [Markdown.ts](../packages/lib/src/typescript/lib/component/display/Markdown.ts)
  — `appendBlockToken` (1639) and `appendListItem` (1729): how the viewer
  renders an item's tokens.
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts)
  — `$keepLoosenessWritable` (232): the rule that sets a list's looseness to
  what `$listReadsLoose` returns.
- [viewModel.ts](../packages/lib/tests/component/markdown-roundtrip/viewModel.ts)
  — `editorListItems` (655), `viewerListItem` (367): the two projections
  every parity check compares.
- [markdown-serializer.test.ts:957](../packages/lib/tests/component/markdown-serializer.test.ts#L957)
  — the `item(…)` helper and its note on `ListItemNode.append`.
- [markdown-editor-columns.test.ts:48](../packages/lib/tests/component/markdown-editor-columns.test.ts#L48)
  — the copy and paste helpers the new test file reuses.
- [ARCHITECTURE.md](../ARCHITECTURE.md) and
  [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md).

---

## Non-Goals

- **Changing where a paste lands.** Lexical's placement stays: the first
  pasted block joins the item's text, the rest go after the nested list.
- **A paste handler or a `markdownWritable.ts` rule that moves blocks out of
  list items.** Rejected; see footnote `why-importer`.
- **The `<div` raw-block tail** (25 of the 74 `editParity` records). It is
  not about list items; `markdown-raw-block-html-tail-parity` owns it.
- **The fuzz's `emptyContainer` and `undo` classes.** Sibling plans own them.
- **Blockquotes holding more than one paragraph.** A `QuoteNode` still holds
  one paragraph; such a quote inside a list item is a raw block inside the
  item.
- **A tight list with a block right under an item's text, and a repeated
  definition in an item.** Both keep loading as a raw block.
- **Joining a run of definitions in a list item.** At the top level
  consecutive definition lines are one raw block. In a list item each is a
  raw block of its own, so an edited list writes a blank line between them.
  The viewer shows nothing for either form.
- **Source mode.** Its commands edit the Markdown text and are untouched.
- **New editing commands for blocks inside list items.** Enter, Backspace
  and the toolbar act on such blocks as they do today.

---

## Notes

[^fuzz-records]: The fuzz is
    `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/column-paste/zz-column-paste-fuzz.test.ts`,
    with its result files `cp-head-<seed>.json` beside it (seeds 601, 1709,
    2207, 3313, 4409, 5521, 6607, 7703, 8819, 9907 and 11003; 3000 pastes
    each). It is a scratch file and is never committed.
    Each `reload` record's editor projection was walked for a list item
    whose blocks are anything but one paragraph followed by nested lists;
    all 804 records hold one. The blocks held are fences (510 occurrences),
    paragraphs (476), tables (151), raw blocks (132), headings (94), code
    blocks (83) and quotes (80). Each `editParity` record was reduced to the
    first path where the editor's and the viewer's projections differ: 48
    differ as editor `paragraph` against viewer `raw` inside a fence's first
    column inside a list item, 25 as editor `raw` against viewer `paragraph`
    at a raw block whose text ends in a cut HTML tag, and one as a list's
    looseness, where the save holds `- ---`.

[^why-importer]: Three places could close the gap between what the editor
    holds and what its importer builds.
    *The serializer* is not at fault: for all 804 pastes the viewer reads
    the save exactly as the editor shows it, and Markdown represents every
    one of these items.
    *A paste rule* (a handler, or a `markdownWritable.ts` transform that
    moves blocks out of list items) was rejected for four reasons. It would
    go against the serializer plan's decision F6, which keeps a list item's
    blocks and writes them. It would undo a decided behaviour of **Insert
    line after block**, which puts its paragraph inside the outer item on
    purpose. It would have to split the outer list and leave the nested
    list's remaining items without a parent (`- - e`). And it would fix only
    documents the editor made, while a hand-written list with a
    two-paragraph item would still load as a raw block.
    `markdownWritable.ts`'s rules exist for states Markdown cannot represent
    (a block in a table cell, a column outside its fence); a block in a list
    item is not one of them.
    *The importer* is the one module that disagrees with the other three
    (serializer, viewer, the harness's projection), so it is the one that
    changes.

[^task-found]: The fuzz does not generate task lists, so this cause is not
    among its records. It was found by running this plan's paste matrix
    against Part A alone: every task row still failed *reload*, each
    because the paste made the outer task list loose.

[^holder]: A paste builds `li(list, block, list)` — two nested lists in one
    node — where a load builds `li(list, block)`, `li(list)`. The serializer
    and both projections treat a `ListItemNode` whose first child is a list
    as a continuation of the item before it, so the two trees save and
    project the same. The contract compares projections for that reason.
    One node per nested list is kept because it is what the importer builds
    today for an item with two nested lists.

[^splice]: `ListItemNode.append`
    ([LexicalList.dev.mjs:706](../node_modules/@lexical/list/dist/LexicalList.dev.mjs#L706))
    unwraps any node `canMergeWith` accepts, which is a paragraph or another
    list item. The serializer tests' `item(…)` helper carries the same
    warning. `ElementNode.splice` inserts the node as given. A paste reaches
    the same result through `insertAfter` on the nested list.

[^looseness]: `$keepLoosenessWritable` sets every list's looseness to
    `$listReadsLoose(list)` when the load's update commits. For a tight list
    whose item holds a block, that flips the list to loose. The block then
    differs from the fingerprint recorded at load, so an unedited document
    is rewritten with blank lines the source did not have, and the viewer
    reads a loose list where the source had a tight one. Run without the
    check, the corpus shows exactly that: `CommonMark 300` and
    `tight block under a list item text` fail *parity*, *verbatim* and
    *canonical*. The check is limited to lists holding item blocks so that
    no list building today can change.
    A stricter check — serialize the built list and compare the block
    structure it lexes to — was considered and not taken: it needs a new
    serializer export that takes the load's definitions, and it found
    nothing the looseness check missed in the corpus, the edit fuzz, the
    paste matrix or the paste fuzz.

[^definitions]: Keeping every list with a definition in an item raw, as
    today, was rejected. It leaves a hole in the contract: copying a
    paragraph and a definition and pasting them into a nested list item puts
    the definition's raw block into the outer item, and the save
    (`- a\n  - bP1\n\n  [x]: /url`) would still load as a raw list. Building
    the `def` token closes the hole. The pieces it relies on already exist: a paste
    can put such a raw block into a list item today, and the serializer's
    `rawBlockTexts`
    ([markdownSerializer.ts:730](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L730))
    already reads definitions out of raw blocks in list items. The viewer
    renders nothing for a definition, and the harness's projection drops a
    raw block holding only definitions, so the two sides agree.
    A *repeated* definition is different: `marked` emits no token for it,
    so there is nothing to build a block from, and building the item from
    its tokens would drop the line on the next save. That list stays raw,
    as `coversText` was written to ensure.

[^top]: `marked`'s `Lexer.blockTokens` only tries its `paragraph` rule while
    `state.top` is `true`; otherwise the text falls to the `text` rule. Its
    list tokenizer sets `top` to `false` before lexing each item, and
    `blockTokens` sets it to `true` again on return. `marked`'s blockquote
    tokenizer saves `top`, sets it to `true` for its content and restores
    it. The fence tokenizer does not restore it, on purpose: today `top` is
    already `true` after a fence (the last `blockTokens` call left it so),
    and restoring `false` would change how the blocks *after* a fence in a
    tight list item are lexed. Setting it before each column changes exactly
    one thing: the tokens of a first column lexed in a list item.

[^bare-marker]: The alternative was to write the list with another bullet
    (`* ---`). A list's written marker also decides whether two neighbouring
    lists join, in `serializeListApart`, `keepNestedListsApart` and
    `$normalizeList`; changing it for a third reason would have to be
    threaded through all three. A bare marker line keeps the list's marker.
    The state is rare: one record in 33 000 pastes, a paste over a range
    that reached from a nested list item into a later block. A plain paste
    of a raw `---` does not produce it: the pasted text joins the item's
    text and is saved escaped (`\---`).

[^fixtures]: The replacement fixtures were run against the unchanged code:
    F1–F8 and the new W7, W9 and W10 all pass there, so the change of
    fixture alters no test's meaning. `- a\n  > b` stays raw because its
    item holds a quote with no blank line above it (see *A list holding item
    blocks is built only when its save keeps its looseness*).

[^harness-blind]: The corpus harness cannot see Part C's defect. The editor
    loads with the viewer's lexer, so a fence lexed as text shows as text on
    both sides and the two projections agree. Part C is pinned by LI1, LI2
    and V1, and by the paste matrix's fence rows, where the editor holds
    real paragraphs and the viewer read text.
    The whole plan was checked before writing it, with patched copies of the
    three modules swapped in through a Vitest alias (never committed). The
    Markdown and viewer suites fail only the twelve tests this plan updates
    and the six `known` entries it removes. The harness with the corpus
    changes above passes all 2 479 tests. The paste matrix passes 165 of
    165. Nine fuzz seeds (26 151 pastes) report no `reload` failure and no
    list-item `editParity` failure. The exact diff is kept at
    `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plan-list-item-block-paste/final-prototype.diff`.

---

## Implementation Notes

Implemented on `feature/markdown-editor-list-item-block-paste`, on top of
`feature/markdown-raw-block-html-tail-parity` at `63a81117d`. The plan was
written against `4f68f3556`; the stack moved before the work began.

The lexer change (Part C) and the serializer change (Part D) went in as
written. The importer differs from the plan's snippets, and the serializer,
`markdownWritable.ts` and `MarkdownEditor.ts` got changes the plan does not
have. All of them answer findings of the reviews, of the list-edit fuzz, or
of probes made while that fuzz's results were sorted.

After three reviews in a row had each found new defects in one area, the
piecemeal fixes there were replaced by two rules. The seventh review then
found that ordinary edits of an item that holds blocks lost or merged
those blocks, and its findings are answered by a third. The three rules
are stated first; the sections after them cover what else differs from
the plan.

**Closed by the user's decision of 2026-10-06.** The seventh review found
seven blocking findings. They are fixed, covered by rows and mutation
checks, and were made once with no further review, so those fixes have
not been reviewed. Shown this, the user chose to close the plan as it
stands and to make an editor-owned list item node the next branch
(`markdown-editor-list-item-node`), which is to replace the per-command
handling of rule 3 and close the two defects left open under *Seen along
the way*.

### Decisions

**Decided by the user on 2026-10-06:**

- **A repeated definition in a list item is a raw block of that item**
  (the plan kept the whole list raw). Accepted on condition that the flip
  between a list and a raw list is closed; the sixth review confirmed it
  is. See *A repeated definition in an item is a raw block of that item*.
- **A bare block tag name (`<div`) is an HTML block wherever its input
  ends** (the parent plan's rule), list items and blockquotes included.
  Accepted as implemented. What it means for a list on this branch is in
  the table under *The parent branch's list-item rows changed meaning*,
  which the fourth review confirmed row by row.

**Decided by the user on 2026-10-10.** Each is behaviour beyond the plan
that the user had not seen when the plan was closed on 2026-10-06:

1. **A run of definitions in a list item is one raw block** (the plan's
   Non-Goal *Joining a run of definitions in a list item* is reversed).
   Needed because an edit already kept such a run as one raw block, while a
   load built one per definition, which the tight-list rule then refused:
   the editor's list reloaded as a raw list. Accepted.
2. **Outside lists too, repeated definitions a blank line apart are a raw
   block each, and a blank line typed between two definition lines splits
   their raw block.** Needed because the split is in the function every
   container locates its blocks with, and without the edit-side half the
   editor's list and its reload differed in looseness. Accepted.
3. **No block stays inside a block that holds text only, in any document**
   (rule 2 below): a paragraph, heading, quote, code block, raw block, or a
   table cell's paragraph. Needed because joining a list item that holds
   blocks to the block before it moved those blocks into that block, and
   the save then wrote their text into its line (`w0` and a thematic break
   saved as `w0---`; a table pasted in a list into a cell saved as one
   line). Shown to the user as a fix with no alternative; no objection.
4. **A list that is copied and pasted keeps the paragraphs its items
   hold, through a paste listener of the editor's own** (the plan says the
   paste does not change). Needed because Lexical builds copied nodes with
   a parse that merges an item's paragraphs into its text, so a list every
   load now builds did not come through a copy and paste as it was (`- a`
   holding a paragraph `p` was pasted as `- ap`, into every container).
   See *A copied list keeps the paragraphs its items hold*. Shown to the
   user as a fix with no alternative; no objection.

5. **An edit of a list item leaves the blocks it holds as its blocks**
   (rule 3 below): Enter in an item's text takes the item's blocks into the
   new item with what follows the caret, an item whose own text is deleted
   takes its first paragraph as its text, and a nested item moved out of
   its list takes along the blocks the outer item holds after that list.
   Needed because Lexical's list code knows no block in a list item: one
   Enter, one Backspace or one block-type command on a loaded document
   merged those blocks into text or deleted them. Accepted, the two
   choices in it included: Enter gives the item's blocks to the new item,
   and a nested item moved out takes the later blocks along.

**Superseded by the following branch; not changed here.** Blocks pasted
into a block that a list item holds (one of its further paragraphs, a
heading, a quote) go in as text on that block's line: `P1` and `P2` pasted
into `cd` of `- x` holding the paragraph `cd` give `cP1P2d`, and a pasted
table gives its cells' text. This is Lexical's own rule for a block that
stands inside another block (`insertNodes`, its case 3c), the result is a
document Markdown can hold, and the parent branch does the same to a
paragraph a paste left in an item. It is new for loaded documents, since
an item's paragraph could not be loaded before. A fix needs a decision on
what such a paste should give (above all for a pasted list) and a paste
handler of its own; see *Seen along the way, not changed*. The following
branch, `markdown-editor-list-item-node`, has that handler: there such
blocks go into the item (its rows Y1 to Y13).

**Done as the following branch: a list item class of the editor's own.**
Rule 3 and the paste listener each stand in front of one Lexical routine
that treats a list item as text and nested lists only. Others remain (see
*Seen along the way*: nested lists that Lexical merges, and a nested list
standing among an item's blocks). A `ListItemNode` replacement whose
`append` keeps paragraphs and whose `remove` keeps the blocks after a
nested list would close them at the source. It changes the node type the
editor's lists are made of, so it is a plan of its own:
`markdown-editor-list-item-node`, the following branch.

### Rule 1: a raw block in a list item

*A list item holds a raw block only when the block's item form, written as
a block of an item by the serializer, is read by `marked` as the same
blocks the text reads as on its own, at every place a block of an item is
written.*

One function states it, `rawBlockStandsInItem` in `markdownSerializer.ts`.
The **item form** (`rawBlockInItem`) is the text from its first line that
holds something to its last, at the margin: without the indentation that
means nothing to Markdown, dropped by the rule a load already used for a
raw block (`rawBlockAtMargin`: a dedent is kept only when the text still
lexes to the same blocks). The function writes that form with the
serializer's own item writer (`listItemLines`) at five places — opening
the item, alone and before another item, tight and after a blank line; and
under the item's text, as the list's last line and before another item —
lexes each, and compares the item's blocks with the blocks the form reads
as alone.

Three places use it, and nothing else decides:

| Where | What it does |
|---|---|
| the save (`$rawBlockSource`) | writes a raw block of a list item in its item form |
| the load (`$buildItemBlock`) | builds a raw block of an item only when the rule holds, with its item form as its text. Otherwise the item cannot be built, so its list is a raw block: of the item around it when it is a nested list, which the same rule then judges, or of the document |
| an edit (`$readListAgainAroundRawBlock` in `markdownWritable.ts`) | when a raw block of an item is left with text for which the rule does not hold, the outermost list around it is shown anew as its save reads, built as a load builds it (`$showBlockAnew`, the path a changed definition already takes). The editor then shows what loading the save shows |

So a load, an edit and a reload cannot disagree about a raw block in a
list item, whatever its text: the save writes the item form, the rule says
that form reads the same wherever it stands, and where it does not the
editor holds no such raw block.

An edited raw block is first shown as the paragraph or the blocks its own
text reads as, as before (`$showRawBlockAsItsBlocks`), and the rule is
asked of what stays a raw block. The caret stays at the same offset of the
list's text where that text still reaches (`$showBlockAnew`'s rule).

What the rule refuses, each found as a defect by a review or the fuzz
before the rule existed:

| Raw text | Why it does not read the same in an item | Rows |
|---|---|---|
| a quote ending on a line without `>` that starts an HTML block (`> q`, then `<div`) | part of the quote where the item's text ends there, a block after it once a blank line follows the item | Q1 to Q12 |
| text that keeps spaces before its first line (a raw list whose later lines are measured by them; a quote whose lazy lines only stay in it while indented) | on the item's marker line the spaces shift the item's content | Q13, the grid G |
| text that reads one way as a paragraph and another line by line, as `marked` reads an item | a tag line under text is an HTML block in an item | the `RB` matrix |

The grid **G** is the sixth review's first finding as a table-driven test:
nine raw lists, at three places in an item, with one to three spaces typed
before them, 81 rows. Before the rule 21 of them failed.

What the item form drops was also found as defects (review 4's second
finding, review 5's first): an empty first line left the item's marker
bare (a setext underline under a line of text), an empty last line read as
a blank line between items, and spaces before the block put it under the
nested list above it. Rows E1 to E9, R1 to R4 and the `RB` matrix.

Not part of the rule, because they concern a raw block's neighbours and
were right before: a raw block that runs on (an open comment) is written
as a paragraph once a block follows it; two raw lists next to each other
are set apart by a `[//]: #` line, in an item as at the top level (row
R5); a raw block whose text holds a `:::` line is written as a paragraph
in a column, also as a block of a list item there. The editor shows that
paragraph once the list stands in a column; the seventh review found that
wrapping a list in a fence (an alignment or a column count set on it) left
the raw block as it was, since no item of the list changes then. A column
now checks its lists' items too (`$showColumnRawBlocksAsWritten`, rows W1
to W4).

### Rule 2: no block stays inside a block that holds text only

*A paragraph, a heading, a quote, a code block and a raw block hold text.
A block that comes to stand inside one is moved out to follow it, in
order; text after such a block follows in a paragraph. A table cell holds
paragraphs of text: every block in it, at any depth, becomes paragraphs of
the cell.*

A block gets there when a list item holding blocks is joined to the block
before it: Lexical moves all of the item's children over. Before, the save
wrote such a block's text into the line around it.

| Container | Route | Before | Now |
|---|---|---|---|
| paragraph, heading, quote | Backspace at the item's start, Delete at the container's end | `w0` and a thematic break saved as `w0---` | the text joins; the blocks follow (rows K1 to K8) |
| code block, raw block | the same two keys | a table's cells written into the code (`codew0hc`); an HTML block written into the raw block with backslashes | the text joins as its Markdown, as a paragraph's does; the blocks follow (K9 to K11) |
| code block, raw block | a range deleted from inside it into the item's text | the item's blocks written into the text (`co0---`) | the rest of the item's text joins; the blocks follow (K12 to K14) |
| table cell | a list whose items hold blocks, pasted | each item's text and blocks in one paragraph, saved `aqk` | one paragraph of the cell per item text and per block (five rows in the paste file) |
| code block, raw block | a list whose items hold blocks, pasted | an item's text and the block after it on one line (`aq`) | each block apart from the item's text, as two items are (seven rows in the paste file) |

One function moves blocks out (`$moveBlocksOutAfter` in
`markdownWritable.ts`): the paragraph, heading and quote rule calls it,
the raw-block rule calls it before it reads the raw block's text, and
`$keepTextOnly` in `MarkdownEditor.ts` calls it before it flattens a code
block's content to text. `$deleteRangeFromTextOnlyBlock` takes the blocks
out of the rest it joins (`$takeBlocksOutOf`). For a cell,
`$keepCellParagraphs` now flattens any block to one paragraph per run of
text, at any depth (`$cellLines`, which replaces the list-only
`$listItemLines`); a paragraph of a cell that comes to hold a block is
handed to it. A paste into a code block or a raw block goes in as text
(`$pasteIntoTextOnlyBlock`, as before); the text of a pasted list is now
read with a blank line between an item's text and each block the item
holds (`$pastedText`), where Lexical's text of an item puts nothing
between them.

Rows K1 to K14 pin the save and the document's shape. K15 to K20 put
blocks between a container's text by hand, one row per container, since no
key leaves text after a block there. Checked by mutation: a rule that
drops the blocks fails 14 rows, one that reverses them 6, and each
container's own call fails its rows.

In Chromium, with real keys, on `p1`, a list item `w0` holding a thematic
break, and an item `z` (`p1\n\n- w0\n\n  ---\n- z`), each row on a fresh
document unless it says otherwise:

| Key | Seen |
|---|---|
| Backspace at the start of `w0` | the item becomes a paragraph `w0` of its own after `p1`, the thematic break follows it as a block, and the list is `z`. The source reads `p1`, `w0`, `---`, `- z`, a blank line between each |
| Backspace again, at the start of that paragraph | `p1w0`, the thematic break, the list `z` |
| Delete at the end of `p1` | `p1w0`, the thematic break, the list `z`; the caret stays after `p1` |
| Delete at the end of a code block `k` that stands before `- w0` holding a table, and `- z` | the code block reads `kw0`, the table follows it, then the list `z` |
| `- a` holding a quote `q`, and `- k`, copied and pasted at the end of a table cell `c` | the cell holds the lines `c`, `a`, `q`, `k`, and the empty line a paste ending in a block leaves at a cell's end (as a list of text items does on the parent branch; the next plan's `emptyContainer` records) |

So the first Backspace at a first item's start is Lexical's own step: the
item becomes a paragraph and its blocks follow it at the top level. The
rule acts on Delete, on a deleted range, and on a join the headless rows
make by dispatching the delete command at once (K1: `p1w0`).
`MarkdownEditor.md` says the same: Backspace at the start of a list's
first item turns the item into a paragraph first.

### Rule 3: an edit of a list item leaves its blocks as its blocks

*The blocks a list item holds stay blocks, and stay in the document, when
the item's text is edited, the item is split, emptied or moved out of its
list, or its block type is changed.*

Lexical's list code predates blocks in a list item: it appends what
follows a caret to a new item (and a list item's `append` merges a
paragraph into text), it removes the item node that holds a nested list
once that list is empty (with whatever else that node holds), and it
leaves the caret in an item's next block when the item's text is gone.
The seventh review reached each of these with one key on a document every
load now builds. Before this branch the same edits did the same to an
item a paste had left a block in.

| Edit | Before | Now | Where |
|---|---|---|---|
| Enter in an item's text; a paste of several blocks or lines there | the item's paragraphs merged into the new item's text (`wx` over `p2`: `w`, `xp2`) | what follows the caret goes into the new item, the blocks with it (T1 to T7, T13, T14; seven rows in the paste file) | `registerItemTextEdits` in `MarkdownEditor.ts` |
| typing or pasting over all of an item's text | the caret fell into the item's next block, and the text went there (`Qp`; an HTML block became paragraph text) | the text replaces the item's text (T8 to T10) | the same |
| an item's own text deleted | an item opening with a paragraph, which no load builds | that paragraph is the item's text, as its save reads (T11, T12) | `$keepOpeningParagraphAsText` in `markdownWritable.ts` |
| Backspace at the start of a nested item; the outdent command | the outer item's blocks after the nested list deleted, or moved before the item | they follow the item out, or stay after the rest of the nested list (U1 to U8) | `$outdentItemKeepingBlocks`, called from a `KEY_BACKSPACE_COMMAND` and an `OUTDENT_CONTENT_COMMAND` handler |
| a block type or the list toggle set on a nested item | the same blocks deleted | they follow the new block (U9 to U14) | `$prepareBlockForType`, the hook `$setBlocksType` calls before it replaces a block |
| a code block made of an item holding blocks | their text written into the code line (`ap`, `ahc`); a throw over a range | the item's text is the code, the blocks follow it (C1 to C5) | `$copyBlockAsCodeSource` |
| a range that takes everything an item holds | a list with no item; a throw from `insertImage` | an empty item holding the caret, or no list (X1 to X9) | `$keepNoListWithoutItem`, `$replaceEmptiedContainerAtCaret` |
| a task item joined to a heading before it | the item's blocks read as the heading's text (`h[x] w4q5`) | they follow the heading (J1 to J3) | the run rules move blocks out before they read a block (`registerRunEdgeRules`) |

How the first two work: for each command that splits or replaces at the
selection (Enter, a paste, an insert of copied nodes, typing over a
range), a listener ahead of every other takes the blocks the item holds
after its text out of it, runs the command again on an item of text
alone, and puts the blocks after the content of the block the caret is in
afterwards: at the end of a list item, as its blocks, or after any other
block. A range that starts outside the item and ends in its text is
removed first, as Enter and a paste remove it, so that the caret tells
which item is split. An item's own text is what it holds before its first
block; text after a block is left to Lexical as before. Lexical's paste
handler does its work in an update queued behind the listener, so for a
paste the blocks are put back in an update queued behind that one.

Three results are choices, each the one the save can write:

- **Enter at the end of an item's text** leaves the caret in a new item
  that takes the item's blocks, so the item's first paragraph is the new
  item's text. Markdown has no item whose first line is empty over a
  paragraph: `-`, a blank line and an indented `p` is an empty item and a
  paragraph outside the list.
- **Backspace over all of an item's text** makes the item's first
  paragraph its text for the same reason, and what is typed next goes
  before it.
- **A nested item moved out as its list's last item** takes the outer
  item's later blocks along as blocks of its own, which keeps them after
  it as they were read; moved out from the start or the middle, the blocks
  stay after the rest of the nested list.

In Chromium, with real keys: Backspace at the start of `b` in
`- a\n  - b\n\n  c\n- d` gives the items `a`, `b` holding `c`, and `d`;
Enter after `w` in `- wx\n\n  p2\n- z` gives `w`, `x` holding `p2`, and
`z`; `Q` typed over the selected `a` of `- a\n\n  p\n- z` gives `Q` holding
`p`; Backspace over everything in `- w0\n\n  p1` leaves an empty item, and
`XY` typed then gives `- XY`. The console showed no error.

Of twenty-three temporary mutations (`mutate5.py` in the scratch
directory) twenty-one fail at least one row. One failed none and its code
was taken out: moving the blocks out right after a block type change,
which the run rules' change already does. The other changes no result:
wrapping typing at a collapsed caret too. Such typing takes nothing out
of the item, and it is left unwrapped for the cost of a keystroke.

### A copied list keeps the paragraphs its items hold

Found by probes made while the list-edit fuzz's results were sorted, not
by a review. Lexical builds copied nodes with `$parseSerializedNode`, which
appends each child with its parent's own `append`, and
`ListItemNode.append` merges a paragraph's children into the item. A list
item holding a paragraph, which every load of `- a\n\n  p` now builds, was
pasted as `- ap`, wherever it was pasted (a table cell got the one line
`ap`). On the parent branch the same merge happens to an item a paste left
a paragraph in; no load built one there.

| Site | Change |
|---|---|
| a paste, a drop, an insert-from-paste input event | `registerCopiedItemParagraphs` in `MarkdownEditor.ts`. A listener of `PASTE_COMMAND`, `DROP_COMMAND` and `CONTROLLED_TEXT_INSERTION_COMMAND` reads the copied nodes off the data transfer when a list item among them holds a paragraph, and keeps them for that command's update only (`$onUpdate` forgets them). The `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` that Lexical then dispatches, with the merged nodes, is answered by inserting the copied nodes built by `$parseKeepingItemParagraphs` instead, through `$insertGeneratedNodes`, the way the column paste handler pastes a column's blocks. It is registered ahead of that handler, so every paste handler sees the paragraphs |
| a format the editor declines (`$editOrRestore` in `markdownWritable.ts`) | it puts each block it touched back from its serialized form, and asks whether that form was writable before the edit, both with Lexical's parse. Bold declined on an item's text merged the paragraphs of a list in that item's fence (`- x(a)y` over a fence holding `- k` and its paragraph `p`: saved `- kp`). Both parses are `$parseKeepingItemParagraphs` now (rows F1 to F4) |

`$parseKeepingItemParagraphs` (`markdownWritable.ts`) builds a node as
Lexical does, except that a paragraph stays a child of a list item that
already holds something. A paragraph that opens an item is still merged:
that is the item's text, and it is what a list copied from inside an
item's second paragraph holds.

Lexical gives no hook between a data transfer and the nodes it builds from
it, so the listener remembers the transfer's own nodes. The other way is a
`ListItemNode` replacement whose `append` keeps paragraphs. It would cover
every route without a listener, but it changes the node type every list of
the editor is made of, the `listitem` type name included, which the paste
fuzz that is the next plan's baseline reads. A follow-up plan could make
that change on its own.

The paste file's rows now paste as Ctrl/Cmd+V does: a `PASTE_COMMAND` whose
clipboard holds the copied nodes as Lexical's copy writes them. Before,
they inserted nodes Lexical's parse had already built, which is why no row
saw the merge. The 165 matrix rows and every pinned row hold on that route
unchanged. Added: seven rows over the target and the item's shape (a
paragraph, a quote, a top-level and a nested item; two paragraphs, a task
item, a paragraph after a quote, a nested item's paragraph), a list copied
from an item's paragraph on, the input event, the insert a drop leads to
(the test DOM has no pointer for the drop itself), a paste that inserts
nothing, nodes of another editor namespace, and a clipboard whose nodes
are no JSON. Eleven temporary mutations (`mutate4.py` in the scratch
directory) each fail at least one row; a twelfth, which also counted a
paragraph opening an item, changed no result and that condition was taken
out.

In Chromium, with real keys: `- a` holding the paragraphs `p` and `r`, and
`- k`, copied and pasted into a paragraph gives the same list again, each
paragraph a paragraph of its item; pasted at the end of a table cell `c`
it gives the lines `c`, `a`, `p`, `r`, `k`; one Ctrl+Z takes the paste
back. The console showed nothing for the copy, the paste or the undo.

### An item's paragraph is written as `marked` reads an item: line by line

`marked` reads a list item's text line by line, so a line of an item's
paragraph that starts an HTML block is one there, where a paragraph at the
top level takes the line in. The paragraph writer is told it writes an
item's paragraph (`inItemParagraph`) and escapes the `<` of such a line,
as it already did for an item's own text. `opensHtmlBlockInItem` tells an
HTML block start from inline HTML opening the line, which stays text
(review 5's A4). Rows P1 to P5. Found by the list-edit fuzz.

### A repeated definition in an item is a raw block of that item

**Accepted by the user on 2026-10-06** (see *Decisions*). The plan decides
that a list item holding a repeated link reference definition keeps its
whole list a raw block
(*Every block token of an item is built; only text no token covers keeps a
list raw*, row R3, and the Non-Goals). That decision is not implemented.
The third audit showed that it makes the editor flip between two documents:

| Step | Result with the plan's rule |
|---|---|
| load `[x]: /a\n\n- [x]: /b\n- c` | two raw blocks (row R3) |
| change `c` to `cd` in the raw list | the editor reads the raw block's text again, on its own. Read alone, `[x]: /b` is a first definition, so it has a token, and the raw block becomes a list |
| save and load | `marked` drops the definition again, and the list is a raw block again |

Before this plan a definition in an item kept the list raw whether it had a
token or not, so the edit and the load agreed. The plan builds a `def`
token (which closes the paste hole its footnote `definitions` describes)
but not text without a token, and that is what made them disagree.

`$buildListItem` now builds text of an item that no token covers as a raw
block of the item. That is what `$buildLocatedBlock` does with such text at
the top level and in a `:::` column, and both the second and the third
audit pointed to it. The plan's reason against it ("there is nothing to
build a block from") does not hold: the located gap carries the text. No
source is dropped.

That change alone did not make an edit and a load build the same list, as
this section first claimed. The fourth review found three routes that
still gave an editor list which reloaded as one raw block. They are closed
by the next section's changes, and rows D1 to D9 pin them.

What changes against the plan's text:

| Plan | Now |
|---|---|
| row R3: `[x]: /a\n\n- [x]: /b\n- c` stays a raw block | it loads as a list, the definition a raw block of its item (row I11, three sources) |
| corpus case `duplicate definition in a list item` keeps its `known` entry | every check passes; the entry is removed |
| the contract leaves one state out | a definition in an item is no exception any more: one pasted where the document already holds its label holds all four checks (rows X2 and X3). The lists that still load as a raw block are the tight list and the quote described two sections below; neither is a state an edit can leave in a list item |
| the docs and the `listItemBlocks` reason name the repeated definition | they name the tight list only |

The other way to stop the flip was to keep every list with a definition in
an item raw, as before the plan. The plan rejects that, since it leaves
the paste of a definition into a nested item failing *reload*.

`$buildItemBlocks` now walks the item's located blocks, gaps included, and
builds each with `$buildLocatedBlock`, as `$buildBlockList` does. The
plan's lookup of each token in the located list, and its fallback for a
token that was not located, are gone: a token `locateTokens` cannot place
leaves its text as a gap, which is now built too. The checkbox is taken out
of the tokens before they are located; it has no text of its own in the
item. A blockquote holding a repeated definition is untouched and still
loads as a raw block (row I7).

### Definition runs in an item, and a blank line between repeated definitions

The fourth review showed the repeated-definition fix was incomplete:

| Source | Edit | Editor | Reload of the save |
|---|---|---|---|
| `[d]: /a\n\n- [d]: /b\n\n  [d]: /c` (loaded as a raw list) | type at the end | a list, two raw blocks | one raw list |
| `[x]: /a\n\n- [x]: /b\n  [x]: /c\n- c` | type before `[x]: /a`, or delete it | a list | one raw list |
| `- [x]: /b\n- c` | Shift+Enter after the definition, type `[y]: /c` | a list, one raw block of two lines | one raw list |

Two causes, both fixed:

- **`$buildListItem` did not join definition runs.** Every other container
  builder locates its blocks with `locateBlocks`, which joins a run of
  definitions on consecutive lines into one raw block. The item builder
  used `locateTokens`, so a load built two raw blocks where an edit kept
  one, and the tight-list rule then refused the list. It now calls
  `locateBlocks`. This also retires the plan's Non-Goal *Joining a run of
  definitions in a list item*: `- [a]: /u\n  [b]: /v\n- c` loads as a list
  whose item holds one raw block (row D3).
- **A gap could span a blank line.** `marked` gives no token for a
  repeated definition, so two of them a blank line apart were one stretch
  of uncovered text, one raw block. The list then read tight where
  `marked` read it loose. `joinDefinitionRuns` now splits a definition-only
  gap at each blank line between two definitions (`definitionRuns`). It
  first split at every blank line, which the fifth review showed cuts a
  definition whose title or label holds one in half
  (`[d]: /b "ti\n\ntle"`). Each definition's extent is now read with
  `marked`'s own pattern, through the `candidateStarts` the locating code
  already uses (rows D12 to D16 and three corpus cases).

The split is in the shared function, so it also applies outside lists.
**This is the second point the user accepted on 2026-10-10:**

| Document | Before | Now |
|---|---|---|
| `[d]: /a\n\n[d]: /b\n\n[d]: /c` at the top level or in a column | two raw blocks (the two repeated definitions were one) | three raw blocks, as `[a]: …`, `[b]: …`, `[c]: …` already were (row D10) |
| a raw block `[a]: /x\n[b]: /y`, Enter between its lines | one raw block holding an empty line | two raw blocks, which is what a load of that save builds (row D11) |

The second row is `$readRawBlockAsBlocks`: it kept any text holding only
definitions as one raw block. It now does so for one run only (the guard
that did it is gone; text holding nothing still stays the raw block it
is). Without it
the edit side and the load side still disagreed in a list item, where the
difference shows as the list's looseness (row D8). Saves do not change:
the same text is written either way.

### Looseness, and the item before a nested list

- **A block a deletion empties.** `$listReadsLoose` already skips a block
  that writes nothing, but the rule that applies it ran on text changes
  only, and a deletion that empties a block removes its text node. The
  list stayed loose in the editor while its save was tight (`- one\n\n
  two`, `two` deleted). The rule now also runs for the paragraph or raw
  block itself (rows L1, L2).
- **An item node that comes to open with a nested list** continues the
  item before it, so that list becomes a block after that item's raw
  block. The raw-block rule ran for the changed item only. It now walks
  back through the items it continues (`$showItemRawBlocksAsWritten`;
  rows M1, M2; found by the list-edit fuzz).
- **One predicate.** "An item node whose first child is a list" was
  written out in three places of the serializer and four of
  `markdownWritable.ts`. It is `$continuesItemBefore` now, a type guard,
  which also removes the type-guard call the fourth review pointed out in
  an `if` of `$blocksAfter`.
- **The cost of a keystroke.** A list's looseness is read on every
  keystroke in a paragraph of an item, and reading it wrote every block of
  every item. Such paragraphs came from a paste only; every load of an
  item with two paragraphs builds them now. Measured in the headless
  editor, typing in an item paragraph of a list of 300 items, each holding
  a paragraph and a table, cost 11.1 ms a keystroke against 3.4 ms in an
  item's own text. `$writesSomething` tells whether a block writes
  anything without writing it where its kind tells (a paragraph, a raw
  block, a table, a code block): 5.7 ms now, and 18 ms for 1,000 items
  where it was 36.

### A raw block that runs on sees the nested list after it

The plan's footnote `holder` says the serializer treats an item node whose
first child is a list as part of the item before it, "so the two trees save
and project the same". One rule did not: `$writesBlockAfter` looked only at
a raw block's siblings. A load builds `li("a", raw)`, `li(list)`, so a raw
block that runs on (an HTML block its text does not close) did not see the
nested list after it. The third audit showed two results:

| Document | Edit | Result before the fix |
|---|---|---|
| `- a\n\n  <div\n\n\n  - n\n\n- b` | type after `b` | the save lost the second blank line, and `<div` took in the nested list |
| `- a\n\n  <!-- c -->\n\n  - n\n\n- b` | delete `-->` | the editor kept a raw block and the list; the saved comment took in the list |

`$writesBlockAfter` now also reads the blocks of the item nodes that
continue the raw block's item (`$blocksAfter`), which is how
`serializeList` gathers an item's blocks. The paste-built shape
`li(list, raw, list)` was right before and is unchanged.

The editor's side of the rule needed the same reach. It shows such a raw
block as the paragraph its save writes (`$showRawBlocksAsWritten` in
`markdownWritable.ts`), but only looked when the raw block, the root or a
column changed. Nesting the next item under a list item that ends in an
open comment (`- a\n\n  <!-- c\n- b`, Lexical's indent command in `b`)
changed neither, so the editor kept the raw block while the save wrote
the paragraph. The rule
is now registered for `ListItemNode` too: Lexical marks an item dirty when
the item next to it changes. Row HE19 pins it, and rows N1 to N6 the same
one level deeper, under `10.`, in a column, for `<pre>`, for a comment
that opens the item and in a task item. This went in after the third audit
and was not part of its findings as written; it is the "editor does not
notice" half of B1 for an edit that is not in the raw block. The editor
binds no key to the indent command (Tab and Shift+Tab move the focus, as
a run in Chromium showed), so these rows dispatch the command; rows M1 and
M2 reach the same shape with a key.

Rows HE15 to HE17 and three corpus cases pin the save, with the list-item
positions of the raw-block edit matrix in `markdown-edit-fuzz.test.ts`
(`RB`). With `$blocksAfter` reverted, at the final code, 36 `RB` rows fail,
with HE15 to HE17, HE19, N1 to N6, and the *canonical* and *edits* checks
of the corpus case `html block start before a nested list in a list item`.
(An earlier version of this note said 31 `RB` rows and left HE19 out; the
fourth review counted 27 at that commit.)

### A nested list that cannot be built is a raw block of its item

The plan's `$buildItemBlocks` returns `null` when a nested list cannot be
built, which makes the whole outer list a raw block, as before the plan.
That broke the plan's own contract for a state the editor can hold: a raw
list block in a list item. The second audit showed it with a paste.

| Step | Result with the plan's snippet |
|---|---|
| copy a paragraph and a raw list (`P1\n\n1) x\n   > p`), paste at the end of `bcd` in `- a\n  - bcd\n  - e\n- f` | the outer item holds the raw list as a block |
| save | `- a\n  - bcdP1\n\n  1) x\n     > p\n\n  - e\n\n- f` |
| load that save | the whole list is one raw block |

`$buildItemBlocks` now builds such a nested list as a raw block of its
item, as `$buildBlock` does for a list anywhere
(`$buildList(token) ?? $buildRawBlock(source, true)`). It no longer returns
`null`. `$buildItemBlock` builds the raw block itself for a list token,
since `$buildLocatedBlock` would build the list a second time first.

The looseness check still decides the list around it. A raw nested list is
a block of its item, so a tight outer list holding one stays raw as a
whole (`- a\n  - b\n    > q`, row R3), and a loose one loads as a list
(rows N1 to N3). The viewer shows a list where the editor shows the nested
list's source, so the corpus cases for these shapes carry the known
`listItemBlocks` divergence, and their rows compare the editor with its own
reload.

### The parent branch's list-item rows changed meaning

`markdown-raw-block-html-tail-parity` made a bare block tag name (`<div`)
an HTML block on a list item's line, and pinned that a list holding one
loads as one raw block, as a list holding `<div>` did. With Part A such a
list loads as a list whose item holds a raw block. That is the plan's own
row B7 and its class "block opens the item", so the parent's rows were
restated, not this plan's fix.

| Parent's row | Was | Now |
|---|---|---|
| HE11 (`- <div>` cut to `- <div`) | stays a raw list | renumbered HE13: stays a raw block of its item, the list a list; compared with the viewer |
| HE13 (`- a\n\n  <div>` cut to `- a\n\n  <div`) | stays a raw list | renumbered HE14: the same |
| HE11 (new) | — | `- a\n  <div>` cut to `- a\n  <div` stays a raw list: the block stands right under the item's text |
| HT4 (`- <div`) | one raw block | HT4b: a list, its item a raw block; HT4 keeps `> <div` |
| HT7 (`1. <div`, `- a\n\n- <div`) | one raw block | HT7b: a list, the item a raw block; HT7 keeps the quote line and `- a\n  <div` |
| corpus `html block start ending a list item` (`- a\n- <div`) | `known: listItemBlocks` | no `known` entry: every check passes |

The corpus cases `html block start on a list item continuation line`
(`- a\n  <div`) and `html block start on a lazy line after a list item`
(`- a\n<div`) keep their `known` entry: both hold a block right under the
item's text.

**This narrows the point the parent plan left for the user's sign-off.**
Its notes list the list shapes that went from an editable list to one raw
block. Checked at this branch's tip:

| Where the tag name stands | Examples | Parent branch | This branch |
|---|---|---|---|
| the only line of a list item | `- <div`, `1. <div`, `- a\n- <div`, `- a\n\n- <div`, `- a\n  - <div` | one raw block | an editable list, the tag name a raw block of its item |
| under an item's text after a blank line | `- a\n\n  <div`, `- a\n\n  <div>` | one raw block | an editable list, the HTML a raw block of its item |
| the last line of a list item's text, no blank line above | `- a\n  <div`, `- a\n<div` | one raw block | one raw block (unchanged) |
| in a blockquote | `> <div`, `> <div\nfoo`, `> a\n<div` | one raw block | one raw block (unchanged) |

### Tests beyond the plan's rows

| Added | Why |
|---|---|
| B15 to B20 in `markdown-importer.test.ts` | a table as a block of a list item at every place a paste can leave one: after a nested list, under an item's text, under a nested item's text, opening a nested item, after a list nested in a nested item, and after a paragraph in an ordered nested item. The next plan (`markdown-editor-table-cells-paste-empty-column`) pastes tables into nested list items |
| five corpus cases, `table after a nested list in a list item` to `table after a list nested in a nested list item` | the same shapes through every harness check and the edit fuzz |
| B21, B22 and the corpus case `block right under a list item text in a loose list` | the other side of R1: a block right under another keeps a list raw only when the list is tight (see *Documentation* below) |
| the corpus case `task marker before a code fence in a list item` (`- [ ]` and a code fence on one line) | a second tight list holding a block right under its text: `marked` reads the fence line as the item's text and the closing fence as an empty code block |
| N1 to N3 and the new R3 in `markdown-importer.test.ts`, four corpus cases (`raw nested list under a list item text` to `tight list whose nested list is raw`) | a nested list that cannot be built: a raw block of its item in a loose list, and a tight outer list that stays raw |
| two raw-list clipboards (a paragraph and a raw ordered or bullet list) at the three offsets of the nested target, and X1, in the new paste file | the second audit's paste; parity is left out, since the viewer reads a raw list as a list |
| I11 restated over three sources (the parent file's `I7/I11` row split in two), X2 and X3 in the new paste file, HE18, the corpus case `duplicate definition after a nested list in a list item` | a repeated definition in an item: by load, by paste, and by an edit that turns a raw list into a list |
| HE15 to HE17, HE19, five list-item positions in the `RB` matrix of `markdown-edit-fuzz.test.ts`, three corpus cases (`html block start before a nested list in a list item` and two with a comment) | a raw block that runs on before a nested list of its item |
| S8 to S10 in `markdown-serializer.test.ts`, five corpus cases (`spaced thematic break under a bare list marker` to `star thematic break under a bare star marker nested under text`) | Part D beyond the first item of a `-` list: a later item of a nested list, a `*` list holding a raw `***`, and that list nested under text, where a bare `*` underlines nothing and so needs no switch. The corpus cases load the outputs of S5, S6 and S8 to S10 again |
| `markdown-editor-list-item-edits.test.ts`, a new file: rows D1 to D16, E1 to E9, R1 to R5, the grid G (81 rows), Q1 to Q13, P1 to P5, K1 to K20, L1 to L5, M1, M2, N1 to N6, F1 to F4, W1 to W4, U1 to U14, C1 to C5, T1 to T15, X1 to X9, J1 to J3, E10 | the fourth to seventh reviews' defects and what the list-edit fuzz found. Each row loads a document, makes edits as keys do, and after every step checks reload, idempotence, parity and the standard form, that no block stands in a paragraph, heading or quote, and that each raw block's text reads in the reload as it did (the surface model collapses a raw block's whitespace, which cannot tell a raw list from the same lines indented otherwise) |
| the `RB` matrix: 23 positions (fifteen in a list item, tight lists among them) by 52 texts, 1,196 rows | a raw block set to each text an edit can leave: an empty first or last line, spaces before it, whitespace alone, definition runs, a quote before a lazy HTML start, and lines a fence reads |
| twenty-one corpus cases, `definition run in a list item` to `two raw lists a definition line apart in a list item` | the definition, quote and raw-list classes through every harness check and the edit fuzz |
| in the new paste file: five rows for a list whose items hold blocks pasted into a table cell, seven for one pasted into a code block or a raw block, the rows of *A copied list keeps the paragraphs its items hold*, seven rows for a paste into the text of an item holding blocks, and one for a list of empty items put into a cell | rule 2 for a paste, the copied list, and rule 3 for a paste |
| `the $name clipboard copies the node types the matrix is named for` (11 rows) in the new paste file | pins the plan's "Copied node types" column, so a clipboard that silently copied something else would not pass as a matrix row |
| `nestedItemChildTypes` beside `itemChildTypes` | B17 to B20 assert the nested list's items |

The seventeen saves the next plan's prototype reported as `reload`
failures (tables pasted into nested list items) were loaded at this
branch's tip: each loads as a list, shows what the viewer shows, and saves
and reloads to the same document. Their sources are kept in the scratch
directory (`impl/list-item-block-paste/probe/in-sibling17.json`).

### Code and test code that differ from the plan's text

- The line numbers in the plan had drifted; every site was found by name.
- `withOwnCheckbox` looks for the checkbox in a first `paragraph` only. The
  plan's snippet also accepted a first `text` token. `marked` turns every
  `text` token of a loose list's items into a paragraph before it returns
  the list, and it puts the checkbox inside the first token only in a list
  that is loose, so that arm could not run. The first audit found this.
- `$buildItemBlock` has no arm for a `text` token. The plan's snippet built
  one as a paragraph. A `text` token after an item's first block exists
  only in a tight list, where any block it became makes the list read
  loose, so `$buildList` then drops the list either way. The second audit
  found this.
- The plan's row R3 is gone and R3 is now the tight list whose nested list
  cannot be built (see the two sections above).
- Three multi-line statements taken from the plan's snippets got the blank
  lines the code conventions ask for: `own` in `withOwnCheckbox`,
  `opensWithBreak` in `serializeList`, and the clipboard constants in the
  new paste file.
- The B, T and R rows are three `describe` blocks at the end of
  `markdown-importer.test.ts`, each one `it.each` table.
- S1 to S7 are one `it.each` table inside the F6 `describe`, with the local
  helpers `bullets` and `raw` the plan names.
- LI4 is one `it.each` over the three sources of LI1 to LI3.
- The paste file's four checks are two helpers, `expectSaveKeepsDocument`
  (parity, reload, idempotence) and `expectUndoRestores`.
- Step 8's F8 comment reads "holds a quote right under its text, with no
  blank line between: the save would make that list loose, so it stays
  raw".

### Red phase

Step 3: LI1, LI2 and V1 failed; LI3 and LI4 passed. Step 6: S1, S2, S3, S5
and S6 failed; S4 and S7 passed. Step 13, with the rows added above: 201
failures, which are 132 matrix rows, P2 to P14, O1, O2, I11, B1 to B20, T1
to T5, W7b, W9b, W10b and 25 `surface` checks (the six cases whose `known`
entry the plan removes, its fourteen new cases without one, and the five
table cases). With the importer change in, six more tests failed: the
parent's five rows and its corpus case, described above.

### Counts that changed since the plan was written

The parent branch removed the 25 `<div`-tail records from the paste fuzz,
so the plan's root-cause table loses that row, and its Part A count is 805,
not 804: seed 3313 case 1558 now shows the `reload` failure its
`editParity` failure had hidden. The baseline's 49 `editParity` records are
48 fences in a list item (Part C) and one `- ---` (Part D).

The corpus gains 57 cases, not sixteen: the plan's sixteen, five table
cases, the task-marker case, the loose-list case, four raw nested lists, a
repeated definition after a nested list, three raw blocks before a nested
list, five Part D outputs, eleven definition cases, a bare marker over an
HTML block, eight quotes before an HTML start, and two raw lists in one
item. Eight cases lose their `known` entry, not six: the parent's `html
block start ending a list item` and `duplicate definition in a list item`
are the other two.

### Documentation

- **The list that stays raw is a tight one.** The plan's wording says a
  list stays raw when an item holds "a block right under another with no
  blank line between them". The rule in `$buildList` is narrower: such a
  list stays raw only when the save would change its looseness, which is
  when the list is tight. `- a\n  > q\n\n- b` is loose already and loads
  as a list (B21). `MarkdownEditor.md`, the changelog entry, the parent's
  corrected entry and the `listItemBlocks` divergence reason all say
  "tight", and that a nested list right under its item's text is no such
  block. The first audit found this.
- **A raw nested list.** `MarkdownEditor.md` and the changelog entry say
  that a nested list which still loads as a raw block is a raw block of its
  item, and that the list around it loads by the same rule as any list.
- **No repeated definition.** The plan's wording names the repeated
  definition as a reason a list stays raw. The docs, the changelog entry
  and the `listItemBlocks` reason do not, since such a list now loads as a
  list. `MarkdownEditor.md` says a repeated definition is a raw block of
  its item like any other definition.
- **The quote.** The docs, the changelog entry and the `listItemBlocks`
  reason name the second list that stays raw: one whose item holds a quote
  ending on a line without `>` that starts an HTML block.
- **How a raw block of an item is saved**, that the column rule and the
  runs-on rule reach a list item, and that a blank line ends a run of
  definitions, are each one sentence in `MarkdownEditor.md`; the changelog
  entry names the first and the last.
- **`MarkdownEditor.md` names headings** among the blocks an item holds, as
  B9 and P5 show; the plan's sentence left them out. The changelog entry
  names them too.
- **The first changelog entry** also says that an HTML block or a link
  reference definition in an item is a raw Markdown block of that item.
- **Two earlier entries of the same unreleased changelog were corrected.**
  "`MarkdownEditor` reads Markdown with the viewer's parser" said that list
  items holding several blocks are kept as raw Markdown blocks; it now says
  a list item keeps the blocks it holds. "`Markdown` reads an HTML block
  start on a last line" (the parent's entry) said a list in which such a
  line reads as an HTML block loads as a raw Markdown block; it now says
  the line is a raw block of its item, and keeps the whole list raw only
  right under the item's text.

### No demo change

The MD Editor demo page already loads and edits lists. This plan adds no
command and no option, so no demo was added (worker step 7).

### Manual checks M1 to M5

Run in Chromium against this worktree's dev server on port 8038, through
the chrome-devtools tools. The server was stopped afterwards. Copy, paste,
undo and the typed `X` were real key presses (Ctrl+C, Ctrl+V, Ctrl+Z). The
tool cannot press the right mouse button, read the clipboard or type a
multi-line text without the source editor continuing each list line, so
three things were done by script: the source text was put in with
`document.execCommand('insertText')` on the focused source editor, carets
and ranges were set with the DOM Selection API, and the context menu was
opened with a dispatched `contextmenu` event.

| # | Seen |
|---|---|
| M1 | the nested item reads `bP1`; `P2` is a `<p>` inside the outer item's second `<li>`, its left edge at the same pixel as `a`'s text |
| M2 | the source is `- a`, an empty line, `  - bP1`, an empty line, `  P2`, then the two paragraphs; back in WYSIWYG the list is the same list, with no raw block |
| M3 | after one Ctrl+Z the surface is the list `a` / `b` and the paragraphs `P1`, `P2`, as before the paste |
| M4 | the menu holds **Insert line after block**; it adds an empty `<p>` in the outer item after the nested list; `X` goes into it; the source is `- a`, `  - b`, `  X` with empty lines between; back in WYSIWYG the list is unchanged |
| M5 | the item holds a block with `text-align: center`, one column, and a `<p>` holding `<strong>bold</strong>`; no asterisks |

The console showed no error or warning.

### Checks

Run from `packages/lib` at the final code, one after another.

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run typecheck:test` | clean |
| `npm run lint` | clean |
| `npx vitest run` | 553 files, 15,666 tests passed, 2 todo |
| `npm run docs:api` | no warnings |
| `npm run docs:llms:check` | 108 catalogued, 121 excluded, 0 unaccounted for |
| `npm run build:lib` | built |
| `grep 'coversText'` in `markdownImporter.ts` | two matches (the function and its call in `$buildQuote`) |
| `grep 'state.top'` in `markdownExtensions.ts` | one match |

The manual checks M1 to M5 were run before the audits and not repeated.
The audit fixes change what loads as a list and how a raw block of a list
item is saved; none of M1 to M5 holds a raw block. Further checks were
made in Chromium later, each with real keys: after the fourth review
(Shift+Tab and Enter in a nested item, Backspace at the start of an item's
second paragraph), after the sixth (the joins under *Rule 2*, and the
copied list under *A copied list keeps the paragraphs its items hold*),
and after the seventh (under *Rule 3*). The check after the fourth review
tried Shift+Tab and Enter and concluded that no key reaches Lexical's
outdent. That was wrong: Backspace at the start of a nested item does, as
the seventh review showed.

### Regression fuzz

The two throwaway fuzzes are not in the repository. Each was copied into
`tests/component/`, run with `FUZZ_N=3000` over seeds 601, 1709, 2207, 3313,
4409, 5521, 6607, 7703, 8819, 9907 and 11003, and deleted again. The result
files are in the user's scratch directory, under
`impl/list-item-block-paste/fuzz/`, with `runfuzz.sh` and `cmpfuzz.py`
beside that folder. They are the baseline for the next plan.

All four runs were made eight times: before the audits, after the second
audit's fix, after the third audit's fixes, after the fourth, the fifth,
the sixth and the seventh review's fixes (the last is the final code). The fifth run showed
20 new `strayEmptyParagraph` records in the column paste fuzz, in both
modes: blocks pasted into a table cell, which an exemption then hid and
rule 2 now turns into the cell's paragraphs. In the other seven runs, the
last among them, each of the 44 result files came out byte-identical to
the baseline in `fuzz/`.
The numbers below are the final run's.

**Table-edge deletion** (`zz-table-edge-fuzz-lbdeclined`): 0 failures in
default mode and 0 in strict mode, as at the parent. All 22 result files
are byte-identical to the parent's.

**Column paste** (`zz-column-paste-fuzz`), 31,951 pastes per mode.

| Check | Parent, default | This branch, default | Parent, strict | This branch, strict |
|---|---|---|---|---|
| `reload` | 800 | 0 | 826 | 0 |
| `editParity` | 49 | 0 | 51 | 0 |
| `second:type:reload` | 3 | 0 | 3 | 0 |
| `second:enter:reload` | 2 | 0 | 2 | 0 |
| `emptyContainer` | 44 | 44 | 44 | 44 |
| `undo` | 3 | 3 | 3 | 3 |
| total | 901 | 47 | 929 | 47 |

Every difference from the parent, record by record:

- **All 805 reload records are gone** (800 `reload`, 3 `second:type:reload`
  and 2 `second:enter:reload`; 831 in strict mode). Each held a list item
  with a block that is not a nested list, which Part A now builds.
- **All 49 `editParity` records are gone** (51 in strict mode). 48 held a
  `:::` fence in a list item before any nested list (50 in strict mode),
  which Part C fixes. One held `- ---` (seed 2207, case 2640), which Part D
  fixes.
- **The 47 records left are identical to the parent's**, byte for byte: 44
  `emptyContainer` and 3 `undo`. They belong to
  `markdown-editor-table-cells-paste-empty-column` and
  `markdown-editor-paste-undo-merge`.
- **No record was added and none changed.** The fuzz reports the first
  check a case fails, so a fixed `reload` could have uncovered a later
  failure in the same case. None did. The run counts (`ran`, `skipped`,
  `withColumn`, `nothingCopied`) are the parent's for every seed.

### The list-edit fuzz

The two fuzzes above paste and delete; neither loads a list whose items
hold blocks and then edits it with keys. A third throwaway fuzz does:
`impl/list-item-block-paste/zz-list-item-edit-fuzz.test.ts` in the scratch
directory, with `runlif.sh` and `showlif.py` beside it. It is not in the
repository.

It generates a list document (six marker kinds; an item's blocks from
thirty-three kinds, among them HTML and its bare tag names, comments left
open, definitions, repeated ones and ones whose title holds a blank line,
quotes before a lazy line, tables, fences, raw nested lists; tight and
loose; a blank line, none or two between an item's blocks; nested in
another list or a column; after a definition; before or after a quote, a
code block, a raw block, a table or a heading; with tabs; with CRLF), then
makes one or two edits. After the load and after each edit it checks that
the save loads as the document the editor shows, each raw block reading as
it did, saves again unchanged, reads in the viewer as the editor shows it
(where the editor holds no raw list or quote), that the standard form
reads and loads the same, and that no block stands inside a paragraph,
heading, quote, code block or raw block.

| Edit | What it does |
|---|---|
| typing, Enter, Shift+Enter, Backspace, Delete | at a random place in a random text node |
| the indent and outdent commands | at a random text node |
| a raw block's text replaced | by one of 28 texts |
| a text node's whole text deleted | a range and Backspace |
| spaces before a raw block (added for review 6's first finding) | one to three spaces typed before the first line of a random raw block, at any place in the document |
| a join by Backspace or Delete (added for its third finding) | the key at the start or the end of a random block: of a code block, a raw block, a table cell, a quote, a paragraph or a list item, next to whatever stands there |
| a range deleted across blocks | from a place in one block to a place in a later one |
| a list pasted | a second generated list, copied with or without the paragraph after it, and pasted at a random place of a random text node, a table cell, a code block and a raw block among them. It is pasted as Ctrl/Cmd+V pastes: a `PASTE_COMMAND` with the copied nodes on a clipboard. After it, no two texts that stood in different blocks of the copy may be one run of text in the save |

A Backspace or Delete inside a text node is emulated by selecting the one
character; at a text node's edge the key is dispatched as it is, which the
headless editor can do for some places and not for others (Lexical needs a
browser selection there; such a step is counted as not emulated and the
document dropped).

| Run, 11 seeds of 1,500 documents | Failing documents |
|---|---|
| the parent branch, with the fuzz as it was after the fourth review | 22 |
| this branch before the fourth review's fixes (3 seeds of 600) | 198 of 1,800 |
| this branch at review 6's code, with the fuzz as it was then | 8 |
| the parent branch, with the fuzz as it is now | 70 |
| this branch at review 7's code, with the fuzz as it is now | 96 |
| this branch at the final code, with the fuzz as it is now | 95 |

The 95, each under *Seen along the way* (the 96 were the same classes,
with 83 in the first):

- 82 are a list pasted into a block that a list item holds, which Lexical
  flattens to text. The fuzz counts them apart. No other paste wrote the
  texts of two blocks into one run.
- Six fail at the load: a quote before an indented lazy HTML start outside
  any list. Each fails the same checks on the parent branch.
- Five fail `canonical` at the load: the definition bookkeeping entry,
  each with a definition whose title holds a blank line. On the parent
  branch each is one raw list and holds every check; the parent fails the
  same way where the HTML start stands in a column.
- Two fail after spaces typed before a raw block that follows a list, at
  the top level. The same class is 36 of the parent's 70, and its
  top-level form was replayed there with the same result.

The parent's 70 are 36 documents with spaces typed before a raw block, 11
with a pasted list, 17 at the load, 3 with a raw block's text replaced and
3 with the outdent command. A document's number does not mean the same
document on both branches: which edits are possible depends on what the
load built, so the two runs draw different documents after the first that
differs. The comparison is by class, and each class this branch still
fails was loaded or replayed on the parent (`probe/` in the scratch
directory).

Had the fuzz had these edits before review 6, it would have found that
review's first finding (the spaces: 21 of the grid's 81 rows failed) and
its third (the joins and the pasted lists). What it found beyond the
reviews' findings is named in the sections above: the quote's indentation,
the column rule, the item before a nested list, the paragraph's
continuation line, the item joined to the block before it, two raw lists
in one item, and, with the list pasted as a real paste, the copied list's
paragraphs.

### Seen along the way, not changed

- **A task marker with nothing after it** (`- [ ]`, then a nested list or a
  blank line and a block) is no task marker to `marked`. The item's text is
  `[ ]`, and an edited save writes it `\[ \]`. This is as before the plan.
- **The rule "a checkbox with no text after it" in `$buildListItem` looks
  unreachable.** `marked` 18 makes an item a task only when text follows
  the marker on its line, so a checkbox token always has text after it. The
  rule predates this plan, the plan keeps it, and no test reaches it. A
  follow-up could remove it.
- **A quote before an indented lazy HTML start, outside lists.** The
  top-level form of the quote above is as it was on the parent branch.
  `p\n\n  > q\n  <div\n\nz` loads as a raw block `> q\n<div` (the
  indentation dropped), whose standard form reads as a quote and an HTML
  block where the source read one quote. The harness's `canonical` checks
  fail on it at the parent too. A follow-up plan should apply the reading
  rule 1 asks of a raw block in a list item to the raw block a load builds
  anywhere, or fix the blockquote rule itself in the lexer wrapper.
- **Lexical merges two nested lists when the item between them goes.**
  `ListItemNode.remove` and `mergeLists` then remove the item node that
  held the second list, with the blocks the outer item held after it. A
  list pasted at the start of an item's text whose nested list a raw block
  follows reaches it (found by the seventh review's own fuzz, rerun after
  its findings were fixed; the same record fails at the code it reviewed).
  Rule 3 covers the routes the review named. This one, and any other
  removal of such an item node inside Lexical, needs the list item class
  named under *Decisions*.
- **A nested list standing among an item's blocks.** A raw block of an
  item that an edit turns into a list leaves the list after the item's
  text, in the same item node, where a load puts it in an item node of its
  own. Lexical's outdent of an item of that list then removes the item
  node, text and all (the seventh review's fuzz: 7 records at the code it
  reviewed, 2 now). Moving such a list into an item node of its own was
  tried and taken out again: four of the parent branch's tests
  (`markdown-editor-command-crashes.test.ts`, R16) build that shape by hand
  and pin what a range removal does in it.
- **A selection copied across table cells, pasted into a list item's
  text, drops the text after the caret**, and with it the blocks the item
  holds; the table is not inserted. The parent branch does the same to an
  item of text (`- bcd`, pasted at `b`: `- b`). It belongs with the next
  plan, which pastes table cells.
- **A paste into a raw `<pre>` block that makes it read as several blocks
  throws** (`$getTextNodeOffset: invalid offset`). The seventh review
  found it and replayed it on the parent branch, which throws the same way
  at the top level; in a list item it is reachable because such lists now
  load.
- **Backspace at the start of an item's second paragraph does not join
  it to the item's text.** Checked in Chromium with a real key press on
  `- a\n\n  p`: the document stays as it is and the caret moves to the end
  of `a`. Nothing is lost and the save is unchanged; a follow-up could make
  the key join the two.
- **Text written differently after an edit.** The list-edit fuzz compares
  the standard form of an edited document with that of its reload. Three
  kinds of difference were left that change nothing in what the document
  reads as: a space an edit left before an item's text, a task marker a
  forward delete merged into the middle of an item (written as text on the
  second save), and a raw block outside lists keeping an empty edge line
  or spaces before it. A fourth does change content: `marked` expands a
  tab in a list item's content, so a tab in text, a code block or a
  `<pre>` block of an item is saved as four spaces once its list is
  rewritten (`- a`, a code block holding `x`, a tab and `y`, then `- b`:
  type in `b`). For a list whose item holds a block this is new on this
  branch: on the parent such a list was one raw block and kept its tab.
  The editor and the viewer agree on the four spaces. The fuzz asks for
  an equal standard form after a load only, as the harness does.
- **A definition the save's bookkeeping does not see.** The serializer
  reads the document's definitions from its raw blocks' text joined as if
  every raw block stood at the top level. A raw block that runs on (an
  open comment, or a bare `<div`, whose HTML block `marked` ends only at
  the blank line after the next text) and is the last block of a list item
  or a `:::` column is confined by that container in the document, but in
  the joined text it takes in the definition after it. A reference link
  whose definition comes later is then written inline once its block is
  edited (`- a\n\n  <!-- c\n- b [x] z\n\n  [x]: /u`, type in `b`:
  `[x](/u)`). The link still points where it did, unless the definition's
  title holds a blank line, which the inline form cannot write. On the
  parent branch the same happens with a column
  (`::: columns\n<div\n|||\n[x]: /u "t\n\nu8"\n:::\n\nb [x] c` fails the
  same two checks on both branches); in a list item it is new, since such
  a list was one raw block. The definitions' joined text is read in six
  places of the serializer, the importer and `markdownWritable.ts`. A
  follow-up plan should read the definitions raw block by raw block.
- **A bare block tag before an edited block, at the top level.**
  `<div\n\n\nb` with `b` edited is saved with one blank line between the
  two, and `<div` then takes `b` in. The raw block is written as its source
  and the separator is the ordinary one. Seen on the parent branch; in a
  list item the save writes the second blank line (row HE17).
- **An emptied raw block between a list and a raw list at the top level**
  writes nothing, and the two are then written next to each other without
  the separator line, so they read as one list. Found by the list-edit
  fuzz after the outdent command; not in a list item.
- **Spaces typed before a raw block that follows a list, at the top
  level.** Outside lists a raw block is saved as its text, spaces
  included, so three spaces before a raw block after `1) w0` put it into
  that item (`p1\n\n1) w0\n   </div\n\n<div>\ny3\n</div>`, the last block
  set to `   <div`). The parent branch saves and reloads the same document
  the same way. Rule 1 is about a raw block of a list item. A follow-up
  could ask its question of a raw block that follows a list.
- **Blocks pasted into a block that a list item holds go in as text.**
  Lexical's `insertNodes` flattens a paste holding blocks when the caret's
  block stands inside another block that is no root (its case 3c: "mirror
  pasting into an input"). A paragraph, heading or quote of a list item is
  such a block: `P1` and `P2` pasted into `cd` of `- x\n\n  cd` give
  `cP1P2d`; a pasted table gives its cells' text; a pasted list all of its
  text on that line. The result saves and reloads as shown. The parent
  branch does the same to a paragraph a paste left in an item
  (`- a\n  - b`, `P1\n\nP2` pasted in `b`, then `Q1\n\nQ2` pasted in `P2`:
  `PQ1Q22` on both branches); for a loaded document it is new, since no
  load built an item's paragraph. `MarkdownEditor.md` and the changelog
  entry say what happens. Listed under *Decisions*, as superseded by the
  following branch: a fix is a paste handler that inserts the blocks into
  the item, and has to say what a list pasted there becomes.
- **A list pasted as HTML.** Lexical writes its copied nodes under the
  editor instance's own namespace (this editor sets none, so each instance
  has its own), and a paste into another editor instance, or from another
  application, is built from the clipboard's HTML by Lexical's DOM import.
  That import appends an `<li>`'s children with the same
  `ListItemNode.append`, so an item's paragraphs are merged there as they
  were here (read in Lexical's source; not run, the test DOM has no HTML
  parser for it). Unchanged, and the same on the parent branch. The list
  item replacement named under *A copied list keeps the paragraphs its
  items hold* would cover it.
- **A paste that ends in a block, at a table cell's end, leaves an empty
  line in the cell** (`c` and a pasted list `- a`, `- k`: the cell saves
  `c`, `a`, `k` and an empty line). The parent branch does the same. These
  are the `emptyContainer` records of the paste fuzz, which belong to the
  next plan.
- **Switching to source mode logs a Lexical warning** ("an editor update
  ran while a read-only context was on the stack") in the demo. The parent
  branch's dev server logs the same warning for the same click. Not looked
  into here.
- **One code commit holds Parts A to D.** The changelog lists three
  entries, but the plan's contract ties them: the paste matrix passes only
  with the importer, the lexer and the serializer change together (three
  of its rows fail *parity* without Part C).

### Audit

Each round was a fresh reviewer given the plan, the branch and its base.
The user's standing rule for this stack is that advisory findings are fixed
too. Every fix was folded into the commit it belongs to.

**Round 1** found two blocking and eight advisory findings.

| # | Finding | What was done |
|---|---|---|
| B1 | a "third list that stays raw" (a task marker before a code fence), added to the docs, the divergence reason, row R4 and these notes after the fuzz run, is no third rule: the fence line reads as the item's text, so it is the tight-list rule again | the clause is gone from `MarkdownEditor.md`, the changelog and the divergence reason; the row added for it is removed; the corpus case stays, described as what it is |
| B2 | the docs said a list stays raw whenever an item holds a block right under another; that holds only for a tight list | "tight" in `MarkdownEditor.md`, both changelog entries and the divergence reason; rows B21 and B22 and a corpus case pin the loose side |
| A1 | the commit messages would name the wrong number of raw lists once B1 was fixed | with B1 fixed they are right again: two lists stay raw |
| A2 | one code commit carries three fixes the changelog lists apart | kept as one; the reason is under *Seen along the way, not changed* |
| A3 | `$buildItemBlocks` looks each token up in the located list where `$buildFence` iterates the located entries; the fallback for a token not located cannot run; definition runs in an item are not joined | kept in this round; the lookup and the fallback went with round 3's B2, and the definition runs are under *Seen along the way, not changed* |
| A4 | the `text` arm of `withOwnCheckbox` cannot run | removed |
| A5 | three multi-line statements without the blank lines the conventions ask for | added |
| A6 | Part D's bare marker in a later nested item and in a `*` list had no test | rows S8 to S10 |
| A7 | `MarkdownEditor.md` left headings out of the blocks an item holds | added, in the changelog entry too |
| A8 | the rule "a checkbox with no text after it" looks unreachable | recorded under *Seen along the way, not changed* |

**Round 2** found one blocking and three advisory findings.

| # | Finding | What was done |
|---|---|---|
| B1 | a raw list pasted into a nested list item made the whole list a raw block on reload, since `$buildItemBlocks` returned `null` for a nested list it could not build | the nested list is a raw block of its item; rows N1 to N3, the row that is now R3, the raw-list paste rows and X1 (a fourth N row went with round 3's B2); four corpus cases; the docs' sentence on a raw nested list; the section *A nested list that cannot be built is a raw block of its item* |
| A1 | the plan's stated exception (a repeated definition) is reachable by a paste, and no row pinned that route | row X2, which round 3's B2 then turned into a row that holds all four checks |
| A2 | the `text` arm of `$buildItemBlock` never affects a result | removed |
| A3 | `$buildItemBlocks` looks each token up where the precedent iterates the located entries | kept, as in round 1 |

**Round 3** found two blocking and five advisory findings. It was the last
round the audit skill allows, so **the fixes below were not audited**.

| # | Finding | What was done |
|---|---|---|
| B1 | a raw block that runs on did not see its item's nested list in the next item node, so its save took the list in | `$blocksAfter`, and the raw-block rule registered for list items; see *A raw block that runs on sees the nested list after it* |
| B2 | editing a raw list holding a repeated definition turned it into a list, and a reload turned it back | uncovered item text is a raw block of its item; see *A repeated definition in an item is a raw block of that item* |
| A1 | the docs said the list around a raw nested list stays a list "unless that list is tight", which is not the exact rule | "loads by the same rule as any list" |
| A2 | the notes' first paragraph named one source deviation where the notes list more | the table at the top of these notes |
| A3 | S5, S6 and S8 to S10 assert the output but not that it loads again | five corpus cases |
| A4 | the item builders differ from `$buildBlockList` in three ways the plan prescribes | two went with B2's fix (gaps are built, entries are walked); the third, joining definition runs, went with the fourth review's first finding |
| A5 | three spaces before a raw block after a nested list | recorded as a known `RB` row then; fixed after the fourth review |

**Review 4** was a fresh reviewer the orchestrator ran on the branch after
round 3's fixes. It found four blocking and six advisory findings.

| # | Finding | What was done |
|---|---|---|
| 1 | three routes still gave an editor list holding definitions that reloaded as a raw list | `locateBlocks` in `$buildListItem`, the gap split, the raw-block reading; rows D1 to D11; see *Definition runs in an item* |
| 2 | a raw block whose first line is empty was written on a bare marker line | `$rawBlockSource`; rows E1 to E9 and the `RB` matrix's tight-list positions and texts |
| 3 | a raw quote ending on a lazy HTML start read differently once its list was rewritten | such a list stays raw; rows Q1 to Q12 and eight corpus cases |
| 4 | a list's looseness fell out of step with its item blocks after five edits | the two rows with an emptied block: the looseness rule for the block itself (L1, L2). The two with an empty last line: `$rawBlockSource` (E4, E5). The one with Enter between definitions: the raw-block reading (D8) |
| A1 | outdenting a nested item drops the outer item's later block; Backspace at the start of an item's second paragraph did nothing in the reviewer's emulation | both under *Seen along the way, not changed*, each with what a run in Chromium showed. The outdent is fixed after review 7 (rule 3) |
| A2 | the `   <div` note understated its scope | the cause is fixed (`$rawBlockSource`, row E9); the note and the known row are gone |
| A3 | a count in these notes was off | corrected under *A raw block that runs on sees the nested list after it* |
| A4 | the list-item raw-block rule was pinned by HE19 alone | rows N1 to N6 |
| A5 | a type-guard call in an `if` of `$blocksAfter` | gone with `$continuesItemBefore` |
| A6 | "an item node whose first child is a list" written out in several places | `$continuesItemBefore` |

Each new row was checked to fail without its fix, by twelve temporary
mutations, each reverted at once (`impl/list-item-block-paste/mutate.py`
in the scratch directory). One change failed no row and was taken out
again: running the looseness rule on text typed in a raw block.

**Review 5** was the one fresh review of review 4's fixes. It found three
blocking and nine advisory findings.

| # | Finding | What was done |
|---|---|---|
| 1 | `$rawBlockSource` dropped a raw list's leading spaces, which are part of what it reads as | the load's own rule, `rawBlockAtMargin`, shared; rows R1 to R4 |
| 2 | `definitionRuns` cut a repeated definition at a blank line inside its title or label | definition extents by `marked`'s pattern; rows D12 to D16 |
| 3 | a `RegExp.test` call in an `if` of `definitionRuns`, and a type guard over a call in one of `$rawBlockSource` | both hoisted |
| A1 | the three commit bodies would be stale after the fold | rewritten at the fold |
| A2 | the reversed Non-Goal was missing from the sign-off list | point 2 of the list at the top |
| A3 | review 4's A1 (the outdent command) is recorded, not fixed | unchanged then, as the orchestrator asked; fixed after review 7 (rule 3) |
| A4 | the escape of an item paragraph's continuation line matched inline HTML too | `opensHtmlBlockInItem`; rows P4, P5 |
| A5 | a tab in a code block of a list item is content, not "text that reads the same" | the note now says so |
| A6 | `isOneDefinitionRun` was misnamed and nearly redundant | replaced by a guard for text holding nothing |
| A7 | two test nits in the edits file | fixed |
| A8 | the looseness rule's cost on a keystroke was now common, unmeasured | measured and halved; see *Looseness, and the item before a nested list* |
| A9 | `IGNORED_INDENT` and `BLANK_FIRST_LINES` duplicated the importer's constants | gone with the shared `rawBlockAtMargin` and `withoutBlankEdges` |

Ten more temporary mutations (`mutate2.py` in the scratch directory)
checked that each row added after review 5 fails without its fix. For
`$keepBlocksOutOfText` the one mutation removes the rule; the sixth review
showed that rows K1 to K6 do not tell a rule that drops the blocks, or
reverses them, from the right one.

**Review 6** was a second fresh review, of review 5's fixes. It found five
blocking and six advisory findings, and the work stopped there as the
orchestrator had asked. Its report is in the scratch directory
(`impl/list-item-block-paste/review6-findings.md`). The orchestrator then
asked for one rule in place of each run of piecemeal fixes: rules 1 and 2
above.

| # | Finding | What was done |
|---|---|---|
| 1 | spaces typed before a raw list of a list item gave a save that reloaded as something else: 27 of 81 combinations of shape, place and count | rule 1. One predicate, `rawBlockStandsInItem`, is asked by the save, the load and the edit; the load-side refusal `readsByItsEnd` and the importer's `INDENTED_LINE` are gone. The 81 combinations are the grid G; before the rule 21 of its rows failed (the review counted 27 with its own emulation of the key) |
| 2 | no row asserted what `$keepBlocksOutOfText` promises | rows K1 to K14 pin the save and the shape, K15 to K20 put blocks between text by hand. A rule that drops the blocks fails 14 rows, one that reverses them 6 |
| 3 | the same loss in a code block, a raw block and a table cell; the docs said otherwise | rule 2 for every container: `$moveBlocksOutAfter` also from `$keepTextOnly` and the raw-block rule, `$takeBlocksOutOf` in the range delete, `$cellLines` for a cell (the exemption is gone). The docs state the rule with no exception |
| 4 | two calls in an `if` condition | hoisted (`$takeBlocksOutOf`, `itemBlockKinds`) |
| 5 | the tab note called new behaviour pre-existing | corrected under *Seen along the way* |
| A | `INDENTED_LINE` declared twice | gone with rule 1 |
| A | the refusal of a raw block keeping its indentation was wider than the docs said | the item form is tried by the same margin rule a load uses, and the docs state rule 1 |
| A | `withoutBlankEdges` dropped spaces ending a raw block's last line in an item | the item form drops last lines that hold nothing, not the spaces ending a line that holds something (`BLANK_LAST_LINES`) |
| A | a missing blank line in `definitionRuns` | added |
| A | notes wording ("the four reviews", "the second point") | these notes were rewritten around the two rules |
| A | docs and notes disagreed on Backspace at a first item's start | checked in Chromium; see the table under *Rule 2* |

Found after review 6 by the extended list-edit fuzz and by probes made
while its results were sorted, and fixed: the item's text and block
written into one line by a paste into a code block or raw block
(`$pastedText`), and a copied list item's paragraphs merged by Lexical's
parse, at a paste and at a declined format (*A copied list keeps the
paragraphs its items hold*). Ten temporary mutations for the two rules
(`mutate3.py`) and eleven for the paste (`mutate4.py`) each fail at least
one row.

**Review 7** was the one fresh review of everything done after review 6,
asked to break the rules with documents and edits of its own making. It
ran a grid of 21,280 raw texts and positions against rule 1 and found no
failure; rule 2 and the copied list held on the routes these notes claim.
It found seven blocking and eight advisory findings. Its report is in the
scratch directory (`impl/list-item-block-paste/review7-findings.md`), with
its probes (`review7-probes/`). **The fixes below were made once and not
reviewed**, as the orchestrator asked. The plan was closed afterwards by
the user's decision of 2026-10-06, recorded at the top of these notes.

| # | Finding | What was done |
|---|---|---|
| B1 | a list wrapped in a `:::` fence kept a raw block of its item that the save writes as a paragraph there; `MarkdownEditor.md` said the editor shows the paragraph | a column checks the raw blocks of its lists' items (`$showColumnRawBlocksAsWritten`); rows W1 to W4. The docs' sentence is true now |
| B2 | the note that no key reaches Lexical's outdent was untrue: Backspace at the start of a nested item does, and deleted the outer item's blocks after the nested list | `$outdentItemKeepingBlocks`, from a Backspace handler ahead of the list plugin's and from an outdent handler in place of Lexical's; rows U1 to U8. The note is corrected |
| B3 | Enter in the text of an item holding paragraphs merged them into the new item's text; so did a paste of several blocks there | `registerItemTextEdits`; rows T1 to T7, T13 to T15 and seven paste rows |
| B4 | typing over, or deleting, all of an item's text joined the item's next block to what was typed | the same listener for typing and pasting over a range (T8 to T10); the opening paragraph rule for the deletion (T11, T12), where the joined result is the one Markdown can hold |
| B5 | a block type or the list toggle set on a nested item deleted the outer item's blocks after the nested list | `$prepareBlockForType` moves the item out with them first; rows U9 to U14 |
| B6 | a code block made of an item wrote the item's blocks into the code line, and threw over a range | `$copyBlockAsCodeSource` takes the item's inline content only; rows C1 to C5 |
| B7 | a range taking everything an item holds left a list with no item, and made `insertImage` throw | `$keepNoListWithoutItem` and the caret-on-a-list case of `$replaceEmptiedContainerAtCaret`; rows X1 to X9 |
| A1 | the changes beyond the plan have no *Architecture Decisions* entry | they are the numbered list under *Decisions*, now with rule 3 |
| A2 | no browser check of a drag and drop | none was made; the docs and the changelog no longer name the drop. The insert a drop makes is covered by two rows |
| A3 | a paste into a raw `<pre>` block throws, on the parent too | under *Seen along the way* |
| A4 | a list of empty items pasted into a cell left one more empty paragraph than on the parent | a list holding nothing leaves none again; one row |
| A5 | spaces ending a raw block's last line in an item were saved and dropped by the load | the item form drops them, as the load does (`withoutBlankEdges`); row E10. This reverses what was done for review 6's advisory on the same line, which had made the save keep them |
| A6 | `$showRawBlockAsSaved` was a nested function declaration after the `return` | a `const` before it |
| A7 | `editor._config.namespace` read without a remark | a comment says Lexical's own paste reads it the same way |
| A8 | no precedent problem found | — |

Also found while fixing these, and fixed: a task item joined to a heading
before it had its blocks read as the heading's text (rows J1 to J3), and
an insert of copied nodes made without a paste event was dropped by the
first version of the new listener (the drop-route row in the paste file).

The seventh review's own fuzz was run again on the code it reviewed and on
the final code, five seeds of 3,000 documents each (`runr7.sh`,
`showr7.py`, `replayr7.sh` in the scratch directory). It checks, beyond
the harness's checks, that an edit which deletes nothing loses no word and
that an edit which joins nothing puts no two words on one line.

| | Reviewed code | Final code |
|---|---|---|
| failing documents | 206 | 122 |
| a block type set: words on one line / words lost | 45 / 7 | 1 / 0 |
| Enter: words on one line | 21 | 2 |
| Backspace at a block's start: words lost | 7 | 2 |
| the outdent command: words lost | 2 | 0 |
| a range deleted, an alignment, a paste over a range: reload | 6 | 0 |

The 122 left were sorted by hand. Most are no defect: a raw block that an
edit turns into the blocks it reads as puts two of its lines in one
paragraph, as Markdown reads them, and bold over part of a word splits the
word the check looks for. Eight paste records were replayed on the
reviewed code and fail the same way there. Those of them that are
defects, with the two Backspace and the one list-toggle record, are the
four entries *Seen along the way* names: nested lists that Lexical
merges, a nested list among an item's blocks, a paste of table cells into
an item's text, and the paste into a raw `<pre>` block. One paste record
fails *parity* (a paste inside an open comment of a list item) and was
not looked into further.
