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
