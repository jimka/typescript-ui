---
depends-on: [markdown-editor-list-looseness-transform-cost, markdown-editor-large-document-costs]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/tests/component/markdown-serializer.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/display/Markdown.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
---

# MarkdownEditor Reload Differences — Implementation Plan

## Overview

`MarkdownEditor`'s WYSIWYG mode promises two things: the editor never holds a state Markdown cannot represent, and a save reloads to the same document. A test set of 33,480 edit sequences was run on `f984cf5e7`, the tip of `feature/marked-version-pin-or-upgrade`, with the list looseness plan's code in place. After each of its 197,571 steps the editor's node tree was compared with the tree a load of its save builds. No save reloads to another save. The trees differ after 33,030 steps; with this plan's code, after 29,534, none of them by a cause R2, R3 or R4 removes.[^count]

Every differing step was grouped by cause; the groups are in [What stays as it is](#what-stays-as-it-is--the-other-groups) and in *Addendum: the groups*. Most are not defects: states that exist only while the user types (an empty paragraph, a space at the end of a line), what a load records (the bullet a list was written with), and two ways of holding the same text. Four groups are defects that no other plan fixes, and the owner asked for a fifth change. This plan makes the five changes, each with one rule beside the existing rules of its kind:

| # | What happens today | Rule | Lives in |
|---|---|---|---|
| R1 | Text typed into a raw block of a list item, or deleted from it, leaves the list's looseness as it was. The list is tight in the editor and its save reloads loose, or the other way round. | The typing rule for looseness reads a raw block as it reads a paragraph. | `$keepLoosenessAfterTyping`, [markdownWritable.ts:418](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L418) |
| R2 | Shift+Enter in a table cell leaves a line break inside the cell's paragraph. The save writes it as the cell paragraph break `\n\n`, which reloads as two paragraphs. A `<br>` in a cell's text shows as the text `<br>` in the viewer and in the editor. | A line break in a table cell is saved as `<br>`. In a table cell, the viewer renders `<br>` as a line break and the editor loads it as one. | `writeBreak` and `pushTokenReading` ([markdownSerializer.ts:4577](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L4577)), `appendInlineToken` in the importer ([markdownImporter.ts:1564](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1564)) and in the viewer ([Markdown.ts:2017](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L2017)) |
| R3 | A code block set to a paragraph, heading, quote or list item keeps its line ends as characters of one text node. The save writes hard breaks, which reload as line break nodes. | A line end inside a text of such a block becomes a line break node. | `registerLineBreakRules`, [markdownWritable.ts:1481](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1481) |
| R4 | `INDENT_CONTENT_COMMAND` gives a paragraph, heading, quote, code block or raw block Lexical's own indent, which no save writes. | The editor's listener handles the command for every selection and moves list items only. | `$moveSelectedItemsOnce`, [MarkdownEditor.ts:4000](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4000) |
| R5 | A space or tab typed at the start of a line stays in the editor. The save drops it, so a reload loses it. | Spaces and tabs at a line's start are removed at the next edit of their block. While the caret stands in them or at either end of them, the user is typing there, and they stay. | `registerLineBreakRules`, [markdownWritable.ts:1481](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1481) |

The changes are in `markdownWritable.ts` (R1, R3, R5), `MarkdownEditor.ts` (R4), and, for R2, `markdownSerializer.ts`, `markdownImporter.ts`, the viewer's `Markdown.ts` and the table tokenizer module `markdownTableExtension.ts`, which gets the one shared pattern. One new test file holds the editor rows; the viewer's test file, the round-trip corpus and the test view model get R2's rows and its reading of `<br>`. Twelve existing test expectations change, each listed in step 9. `MarkdownEditor.md` gets one new bullet and three changed or added sentences, `Markdown.md` a syntax row, and the changelog six entries. No public API changes.

Line numbers are those of `f984cf5e7`. The plans in `depends-on`, and the two raw block plans they depend on, edit the same files in other functions, so find each site by its symbol name.

---

## Architecture Decisions

### R1 — the looseness typing rule reads a raw block too

`$keepLoosenessAfterTyping` runs for every text node that changes. It reads its item's looseness when the text stands in a block whose text decides whether the block writes anything: a paragraph of the item, or the item's text when blocks follow it. A raw block is such a block: a raw block holding whitespace alone writes nothing. The rule gets a third case, `$isMarkdownRawBlockNode(block)`.[^r1]

| Document | Edit | Editor today | Save | Reload | Editor after |
|---|---|---|---|---|---|
| `- a⏎⏎  <div>`, the raw block's text deleted and a space typed | `<p>` typed after the space | tight, raw block ` <p>` | `- a⏎⏎  <p>` | loose | loose |
| `- a⏎⏎  <div>`, a space typed at the raw block's end | `<div>` deleted, the space left | loose, raw block of one space | `- a` | tight | tight |

(`⏎` is a line end.)

### R2 — a line break in a table cell is `<br>`

A pipe table row cannot hold a newline, so a line break inside a cell needs a written form. GFM's form is the HTML line break `<br>`. The dialect today has one form for every break in a cell, the cell paragraph break `\n\n` (backslash, `n`, twice), and a load builds it as two paragraphs of the cell. R2 gives a line break its own form, so Shift+Enter in a cell keeps a line break through a save and a load:

| Where | What it holds | Saved as | Loaded as, and shown by the viewer as |
|---|---|---|---|
| a cell | a line break (Shift+Enter, a newline in pasted or converted text) | `<br>` | a line break |
| a cell | two paragraphs (Enter, a merge of cells) | `\n\n`, unchanged | two paragraphs; one `<br>` in the viewer, unchanged |
| a cell | the text `<br>` typed as characters | `\<br>`, unchanged | the text `<br>` |
| outside a table | a `<br>` in a paragraph | unchanged | the text `<br>`, as any other inline HTML |

The reading rule is the same in the viewer, the importer, the serializer's read-back check and the test view model: an inline `html` token in a table cell's text whose text matches `CELL_LINE_BREAK_TAG` is a line break. The pattern takes `<br>`, `<br/>`, `<br />` and any letter case; inside a code span or after a backslash there is no `html` token, so those stay text. The save always writes `<br>`. The pattern is exported once, from `markdownTableExtension.ts`, the module every one of those readers already imports the table token types from.[^r2-one-pattern]

Each reader handles the cell line break where it already handles the cell paragraph break, with the "in a table cell" flag it already has: the viewer's `splitCellBreaks`, the importer's `target.nextCellParagraph`, the serializer's `context.inTableCell`, the view model's `context.inCell`. This mirrors how `CELL_PARAGRAPH_BREAK` is read today ([Markdown.ts:70](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L70), [markdownImporter.ts:62](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L62), [markdownSerializer.ts:224](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L224)).[^r2-precedent]

Enter in a cell is unchanged: it makes a new paragraph of the cell, saved `\n\n`, as a merged cell's paragraphs are. Both forms show as a new line of the cell in the editor and in the viewer, and each reloads as itself.[^r2-enter]

Source mode needs no change. It edits the Markdown text, so a `<br>` typed into a cell row is that text; the viewer, and the WYSIWYG mode after a switch, read it as a line break. Source mode's inline commands already treat the tag as one token: bold over `a<br>b` writes `**a<br>b**`, and a range that cuts into the tag is declined.[^r2-source]

| Cell | Edit | Editor today | Save today | Editor after | Save after |
|---|---|---|---|---|---|
| `t1` | Shift+Enter between `t` and `1` | paragraph `t`, line break, `1` | `t\n\n1` (reloads as two paragraphs) | the same | `t<br>1` (reloads as itself) |
| `a<br>b` | load | `a`, source run `<br>`, `b` | `a<br>b` | `a`, line break, `b` | `a<br>b` |
| `t1` | Enter between `t` and `1` | paragraphs `t`, `1` | `t\n\n1` | the same | the same |

### R3 — a line end inside a text becomes a line break node

Only a code block and a raw block hold a line end as a character of their text. When a code block is set to another block type, or toggled into a list, its text node moves into the new block as it is. The new `$keepLineEndsOutOfText`, a `TextNode` transform registered in `registerLineBreakRules`, splits such a text node at every line end and puts a line break node there.[^r3]

| Document | Edit | Editor today | Save | Reload and editor after |
|---|---|---|---|---|
| a code block of the lines `a`, `b` | `setBlockType("paragraph")` | paragraph of one text `a⏎b` | `a\⏎b` | paragraph: `a`, line break, `b` |
| the same | the bulleted toggle | item text of one text `a⏎b` | `- a\⏎  b` | item text: `a`, line break, `b` |
| the same | a letter typed in it | code block of one text | unchanged form | unchanged: a code block keeps its line ends |

### R4 — the indent command moves list items only

`registerListItemRules` listens to `INDENT_CONTENT_COMMAND` and `OUTDENT_CONTENT_COMMAND` at high priority, and today hands every selection that holds no item nested in a selected item to Lexical's own handler. That handler gives each selected block an indent: a list item moves a level, and any other block takes an element indent that the editor draws and no save writes. `$moveSelectedItemsOnce` now handles every selection itself, through the same `$handleIndentAndOutdent` it already calls, and moves a block only when it is a list item or a list item's text.[^r4]

| Selection | Command | Today | After |
|---|---|---|---|
| caret in a paragraph | indent | the paragraph is drawn indented; the save is unchanged; one more undo step | nothing changes, and no undo step is added |
| from item `b` into a paragraph | indent | `b` moves a level in, and the paragraph is drawn indented | `b` moves a level in; the paragraph is as it was |
| caret in item `b` | indent, then outdent | `b` moves in, then out | the same |

No key and no method of `MarkdownEditor` sends either command today, so this rule changes nothing a user can reach. It keeps the state out for a host that sends the command, and for the day a key is bound to it.[^r4-reach]

### R5 — spaces and tabs at a line's start go at the next edit

Markdown drops the spaces and tabs a line starts with, so the save writes none and a load builds none. The new `$dropWhitespaceAtLineStarts`, a `TextNode` transform registered in `registerLineBreakRules`, removes them from the editor too. It runs whenever a text changes, and reads only the block that holds an end of the selection, the block being edited. It leaves the whitespace while a collapsed caret stands in it or at either end of it: right after it, the user is typing it; right before it, the user is about to type in front of it, which makes it whitespace inside the line. So a space typed at a line's start shows until the next character is typed, which takes its place.[^r5]

A line starts at these places, which are exactly where the save drops the whitespace:

| Block | A line starts | Whitespace there |
|---|---|---|
| paragraph, list item's text, heading, quote | at the block's start; after a line break; after a soft line break; after the task marker that opens an item's text (`[ ] `) | removed |
| paragraph of a table cell | at the paragraph's start (each paragraph of the cell) | removed |
| paragraph of a table cell | after a line break (`<br>`) | kept: the save writes it and a load keeps it |
| code block, raw block | anywhere | kept: the block's text is written as it stands |
| any | inside a code span or inside a link's text | kept: the save writes it there |
| any | a later line (after a break) whose text starts with whitespace and then a source run, such as an indented `<span>` | kept: the save keeps that indent, and a load builds it |

Only spaces and tabs count. A no-break space is text: the save writes it, and it stays.

| Document | Edit | Editor after | Save |
|---|---|---|---|
| `p0` | a space typed at the start | ` p0`, the caret after the space | `p0` |
| ` p0` from the row above | `x` typed after the space | `xp0`, the caret after `x` | `xp0` |
| ` p0` from the first row | the caret moved to the end, `y` typed | `p0y` | `p0y` |
| `a b0` | Enter after `a` | `a`, then ` b0`, the caret before the space | `a⏎⏎b0` |
| the row above | `x` typed | `a`, then `x b0`: the space is inside the line now | `a⏎⏎x b0` |
| `w2⏎⏎x y` | `z` typed over the range from the start of `w2` to after `x` | `z y` | `z y` |
| `p0` | a space, then a dead key starts a composition after it (`´`) | ` ´p0`, unchanged while composing | — |
| ` ´p0` composing | the composition ends as `é` | `ép0` | `ép0` |
| `p0` | a paste of a space at the start, then a paste of `x` | ` p0`, then `xp0` | `xp0` |
| `p0` | a paste of a tab and `x` at the start | `xp0` | `xp0` |
| `a<br>c0` in a cell | a space typed before `c0`, then `x` | `a`, line break, ` xc0` | `a<br> xc0` |

A paste is treated as typing: a caret left right after the pasted whitespace keeps it, and a caret after pasted text removes it. Typing over a range from one block into the next can remove the range in one update and insert the text in the next (a command dispatched outside an update runs its listeners in updates of their own), so for one update the rest of the second block, ` y`, starts a line with the caret right before it; the caret rule keeps its space, and the typed `z` then stands before it. Reading only the block that holds the selection follows the run-edge rule, which tidies typing only where the caret is; it also keeps the rule's work to one block per update.[^r5-block] An undo of a typed space and the letter after it gives back the document as it was before both, in one step, since both changes are in the updates the history merges. A composition (an input method, a dead key) is never changed while it runs: the transform does nothing while any text of the block is being composed, and the update that ends the composition removes the whitespace.[^r5-composition] A load never runs the rule, as the run-edge rule never tidies a load.

### Each rule stands beside the rules of its kind

`markdownWritable.ts` keeps each shape Markdown cannot hold out of the editor with a rule next to the rules for the same node: the looseness rules in `registerMarkdownListTransforms`, the break rules in `registerLineBreakRules`. R1 extends the first; R3 and R5 extend the second. R2 changes no editor rule: it changes what a cell's break is written as and read as, in the four places that already read the cell paragraph break. R4 extends the listener that already owns the command. No new registration function and no new seam is added.[^precedent]

### What stays as it is — the other groups

The other groups are left alone. Each is one of three things: an artefact of comparing trees, a state that exists while the user edits and that the save cannot hold, or a decision an implemented plan recorded. The counts are steps of the set in which the cause takes part, on the parent.

| Group | Steps | What differs | Verdict |
|---|---|---|---|
| marker as loaded | 8,259 | a load records the bullet or delimiter a list was written with, where it is the one an editor-made list writes anyway | artefact: nothing shown, nothing saved differs |
| marker written by rule | 1,948 | a save writes a nested list with `*` to keep it apart from what is next to it; a load records `*` as the list's own | artefact; documented save rule |
| cached text format | 1,268 | Lexical's cache of a block's text format | artefact |
| code block line ends | 1,371 | Enter in a code block makes a line break node; a load builds one text holding line ends | two forms of the same text, both shown and saved alike |
| empty paragraph | 6,795 | a paragraph with no content (after Enter, or after a pasted list or table) | editing state: the save writes nothing for it |
| empty item text | 631 | an item's empty text line before another block of the item | editing state, documented |
| emptied raw block | 245 | a raw block whose text was deleted | editing state, documented |
| whitespace at a line's end | 3,573 | a space typed at the end of a block's line | editing state: the save drops it, and the next word typed makes it a space inside the line |
| whitespace at a line's start, while the caret is at it | 3,834 on the parent, 3,462 after R5 | after R5: a space just typed with the caret right after it (341 steps), the same states brought back by undo and redo (2,011), and a caret left right before the whitespace or in another block | editing state, by R5's own rule |
| soft line break at an edge | 162 (77 after R5) | a soft break first or last in its block, or spaces after it | the same |
| raw block edges | 181 | an empty first or last line, or spaces before the first line, of an edited raw block | the same, documented |
| task marker kept as source | 6,921 | a `[ ]` marker that no longer opens a list item stays an atomic run; the save writes `\[ \]`, which reloads as text; with it (203 steps), spaces typed after such a run | recorded Non-Goal of `markdown-list-toggle-task-item-parity`; the owner chose to leave it |
| inline HTML kept as source | 13 | an HTML tag that comes to open a list item's paragraph is saved escaped and reloads as text | the same kind; left with the task marker |
| emptied table | 153 | a table with no row | made only by the test set's own `clear()`; no command leaves one |

No other unstarted plan fixes any group of this table or any of R1 to R5.[^owners]

### The rows go in a new test file

The editor rows compare the editor's tree with the tree of a load of its save, for one document and a few steps each. They go in `tests/component/markdown-editor-reload-differences.test.ts`, a file no other plan edits. The whole file is in *Addendum: the test file*. It was run as printed: 31 rows fail and 14 pass before the change, and all 45 pass after it. R2's viewer rows go in the viewer's own test file, beside its tests of the cell paragraph break, and two rows go in the round-trip corpus, which checks the viewer and the editor read a document alike.

### Decisions the owner has not seen

The owner answered the earlier sign-offs on 2026-10-14: R1, R3 and R4 yes; R2 as `<br>`; the task marker left as it is; a space typed at a block's start removed at the next character. Working out R2 and R5 needed three more answers. The plan is written for the recommended one in each.

| # | Decision | Recommended | In this plan |
|---|---|---|---|
| 1 | Enter in a table cell keeps making a new paragraph of the cell, saved `\n\n`, beside Shift+Enter's `<br>`. Both show as a new line of the cell. | yes: it is Enter everywhere else, and `\n\n` is the merged cell's form the owner kept | yes |
| 2 | R5 counts every line's start, not only a block's: after a line break or soft break, after a task marker, and each paragraph of a table cell. | yes: the save drops whitespace at all of them alike | yes |
| 3 | R5 removes whitespace that any edit, not only typing, leaves at a line's start in the block being edited with the caret away from it, at once: a pasted line that opens with a tab loses the tab. With the caret right before or after the whitespace (Enter before a space, a word deleted up to a space) it stays until the next edit. | yes: the save drops it, and nobody is typing there | yes |

---

## Internal Structure

"Directly before a function" means before its JSDoc comment. Every new function and constant is module-private unless shown with `export`.

### `markdownWritable.ts` — R1

In `$keepLoosenessAfterTyping`, add one constant and one term to the condition. After `markdown-editor-list-looseness-transform-cost` the function reads as below, with the two changed places marked.

```typescript
function $keepLoosenessAfterTyping(text: TextNode): void {
    const item = $findMatchingParent(text, $isListItemNode);
    const list = item?.getParent();
    const block = text.getParent();
    const isFurtherParagraph = $isParagraphNode(block) && !$isMarkdownListItemTextNode(block);
    const isTextOverBlocks = $isMarkdownListItemTextNode(block) && block.getNextSibling() !== null;
    // A raw block writes nothing while it holds whitespace alone, as a paragraph does.
    const isRawBlock = $isMarkdownRawBlockNode(block);                                            // new

    if (item === null || !$isListNode(list) || !(isFurtherParagraph || isTextOverBlocks || isRawBlock)) {   // changed
        return;
    }

    $keepLoosenessThroughItem(list, item);
}
```

Change the first sentence of the function's JSDoc to name the third case: "in a paragraph or a raw block an item holds after its text, and in an item's own text when the item holds more after it".

### `markdownTableExtension.ts` — R2's pattern

Add directly before `splitRow` ([markdownTableExtension.ts:51](../packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L51)):

```typescript
/**
 * The inline HTML a table cell holds for a line break inside one of its
 * lines of text: `<br>`, `<br/>` or `<br />`, in any letter case. A pipe row
 * cannot hold a newline, so GFM writes a line break in a cell this way. In a
 * cell, the viewer renders it as a line break and the editor loads it as
 * one; anywhere else it stays literal text, as other inline HTML does. Tested
 * against an `html` token's `text`.
 */
export const CELL_LINE_BREAK_TAG = /^<br\s*\/?>$/i;
```

### `Markdown.ts` (the viewer) — R2

Import the pattern beside the table token types:

```typescript
import { CELL_LINE_BREAK_TAG } from "~/component/display/markdownTableExtension.js";
import type { MdTableToken, MdTableHeaderCell, MdTableBodyCell } from "~/component/display/markdownTableExtension.js";
```

In `appendInlineToken` (L2017), add a case after `case "br"`:

```typescript
            case "html": this.appendInlineHtml(parent, token as Tokens.HTML, splitCellBreaks); break;
```

Add the method directly before the JSDoc of `appendInlineWrapper` (L2118):

```typescript
    /**
     * Appends inline HTML: a `<br>` in a table cell ({@link CELL_LINE_BREAK_TAG})
     * as a line break, anything else as its literal text.
     *
     * @param parent - The element handle to append into.
     * @param token - The `html` token.
     * @param inTableCell - Whether the token is in a table cell's text (`splitCellBreaks`).
     */
    private appendInlineHtml(parent: Handle, token: Tokens.HTML, inTableCell: boolean): void {
        const isCellLineBreak = inTableCell && CELL_LINE_BREAK_TAG.test(token.text);

        if (isCellLineBreak) {
            DOM.sink.appendChild(parent, this.create("br"));
        } else {
            this.appendTextNode(parent, token.text);
        }
    }
```

The `else` branch is what the `default` case did for an `html` token.

### `markdownImporter.ts` — R2

Import the pattern beside the table token types, as in the viewer. In `appendInlineToken` (L1564), add a case after `case "br"`:

```typescript
        case "html":       appendInlineHtml(target, token as Tokens.HTML, context); break;
```

Add the function directly before `appendTextToken`'s JSDoc:

```typescript
/**
 * Appends inline HTML: in a table cell, a `<br>` ({@link CELL_LINE_BREAK_TAG})
 * as a line break, as the viewer renders it there; anything else as a source
 * node showing its text.
 *
 * @param target - Where nodes are appended.
 * @param token - The `html` token.
 * @param context - The formatting it inherits.
 */
function appendInlineHtml(target: InlineTarget, token: Tokens.HTML, context: InlineContext): void {
    const isCellLineBreak = target.nextCellParagraph !== null && CELL_LINE_BREAK_TAG.test(token.text);

    if (isCellLineBreak) {
        appendLeaf(target, $createLineBreakNode(), context);
    } else {
        appendSourceNode(target, token.text, token.raw, context);
    }
}
```

The line break carries no marker state: in a cell the save writes `<br>` whatever the marker, and outside a cell (after a cut and paste) the default marker `\` is the right one.

A construct kept as written (`keptSourceState`) is split into runs by `keptPieces` (L1944), which keeps a hard break as a run of its own. In a cell it must do the same for a `<br>`, or the tag would merge into the text runs around it. Three edits:

1. `keptPieces` takes a third parameter, `inTableCell = false`, passes it on in its recursive call (`keptPieces(child, inner, inTableCell)`), and in its leaf branch reads:

    ```typescript
        const generic = token as Tokens.Generic;
        const isCellLineBreak = inTableCell && token.type === "html" && CELL_LINE_BREAK_TAG.test(generic.text as string);
        const isBreak = token.type === "br" || isCellLineBreak;
        const leaf = isBreak || (token.type === "mdimage" && $imageSpec(generic) !== null) ? generic : null;
        const display = token.type === "mdimage" || isBreak ? "" : generic.text as string | undefined ?? token.raw;
    ```

    Its JSDoc's first paragraph becomes "… except that an image the viewer renders, a hard break and, in a table cell, a `<br>` are runs of their own, never merged, so each keeps its node." and it gains `@param inTableCell - Whether the token is in a table cell's text.`

2. `appendKeptConstruct` (L1856) reads `nextCellParagraph` first and passes it on:

    ```typescript
    const nextCellParagraph = target.nextCellParagraph;
    const pieces = keptPieces(token, context, nextCellParagraph !== null);
    ```

3. `appendKeptRuns` (L1883) builds a leaf's node with a new function, in place of `leaf.type === "br" ? hardBreak(leaf.raw) : $imageNode(leaf)!`:

    ```typescript
            : keptLeafNode(leaf);
    ```

    Add it directly before `splitAtCellBreaks`:

    ```typescript
    /**
     * The node of a kept construct's leaf run: a line break for a hard break or
     * a cell's `<br>`, else the image.
     *
     * @param leaf - The run's token.
     * @returns The node.
     */
    function keptLeafNode(leaf: Tokens.Generic): LexicalNode {
        switch (leaf.type) {
            case "br":   return hardBreak(leaf.raw);
            case "html": return $createLineBreakNode();
            default:     return $imageNode(leaf)!;
        }
    }
    ```

The other two callers of `keptPieces` (L1357, L1489) only ask whether it returns `null`, which the new parameter does not change; they keep two arguments.

### `markdownSerializer.ts` — R2

Import the pattern beside the table token type. Change `CELL_PARAGRAPH_BREAK`'s JSDoc (L217) to "Two {@link CELL_LINE_BREAK}s: what a table cell writes between two of its paragraphs. Mirrors the viewer's own `CELL_PARAGRAPH_BREAK`, the only sequence it splits a cell's text on (one `<br>` per boundary) — a lone {@link CELL_LINE_BREAK} renders as literal text — and the importer reads it back as a paragraph boundary." Add after it:

```typescript
/**
 * What a table cell writes for a line break, or a newline, inside one of its
 * paragraphs: the HTML line break GFM uses in a cell, which the viewer
 * renders as a line break there and the importer loads as one
 * ({@link CELL_LINE_BREAK_TAG}).
 */
const CELL_HARD_BREAK = "<br>";
```

In `writeBreak` (L4577), the cell branch returns `{ kind: "syntax", text: CELL_HARD_BREAK }`, and the JSDoc's first sentence becomes "The piece a line break writes: `<br>` in a table cell ({@link CELL_HARD_BREAK}), a space in a heading, else a hard break with its marker."

In the inline writer, the `open` closure (L4507) loses the `previous` read, the comment under it and the `if` that pushed a space after a cell paragraph break. No line break writes `CELL_PARAGRAPH_BREAK` as a piece any more, so the condition can no longer hold; `serializeTableCell` keeps adding its own space before a paragraph that opens with a delimiter. `open` becomes:

```typescript
    const open = (mark: Mark): void => {
        writer.stack.push(mark);
        writer.pieces.push({ kind: "delimiter", text: MARK_DELIMITERS[mark], mark, opens: true });
    };
```

A delimiter after `<br>` needs no space: `>` is punctuation, so `<br>*{*` opens its emphasis (a row of `markdown-serializer.test.ts` shows it, step 9).

In `pushTokenReading` (L4954), add a case after `case "br"`:

```typescript
            case "html":       pushHtmlReading(reading, token as Tokens.HTML, scope, context); break;
```

Add the function directly before `linkScope`:

```typescript
/**
 * Appends the reading of inline HTML: a break for a `<br>` in a table cell
 * ({@link CELL_LINE_BREAK_TAG}), as the viewer renders it there; else its
 * characters, as the viewer shows them.
 *
 * @param reading - The reading units so far. Extended in place.
 * @param token - The `html` token.
 * @param scope - What it inherits.
 * @param context - Where it is written.
 */
function pushHtmlReading(reading: string[], token: Tokens.HTML, scope: ReadingScope, context: InlineContext): void {
    const isCellLineBreak = context.inTableCell === true && CELL_LINE_BREAK_TAG.test(token.text);

    if (isCellLineBreak) {
        pushBreakReading(reading);
    } else {
        pushCharacterReading(reading, token.text, scope, context);
    }
}
```

The reading is what the save checks its own output against. Without this case, a written `<br>` would read as four characters where the editor holds a break, and the save would escape it.[^r2-reading]

### `markdownWritable.ts` — R3

Add `$createLineBreakNode` to the import from `"lexical"`. In `registerLineBreakRules`, register the new transform directly before the existing `TextNode` transform, so the break rule that follows it sees line break nodes:

```typescript
        editor.registerNodeTransform(TextNode, $keepLineEndsOutOfText),
        editor.registerNodeTransform(TextNode, (text) => {
            const container = $breakRuleContainerOf(text);
```

Add the function directly before `$declinesLineBreak`:

```typescript
/**
 * Turns each line end inside a text of a block of text into a line break
 * node, which is what a load builds for the hard break a save writes there.
 * Only a code block and a raw block hold a line end as a character of their
 * text; a block made of one — a code block set to a paragraph, a heading, a
 * quote or a list item — takes its text node as it is, line ends and all.
 * A caret keeps its place in the text.
 *
 * @param text - The text node that changed.
 */
function $keepLineEndsOutOfText(text: TextNode): void {
    const content = text.getTextContent();
    const holdsLineEnd = content.includes("\n") && !$isMarkdownSourceTextNode(text);
    const block = holdsLineEnd ? $findEnclosingBlock(text) : null;
    const keepsLineEnds = block === null || $isMarkdownRawBlockNode(block) || $isCodeNode(block);

    if (keepsLineEnds) {
        return;
    }

    const offsets: number[] = [];

    for (let at = content.indexOf("\n"); at !== -1; at = content.indexOf("\n", at + 1)) {
        offsets.push(at, at + 1);
    }

    for (const piece of text.splitText(...offsets)) {
        const isLineEnd = piece.getTextContent() === "\n";

        if (isLineEnd) {
            piece.replace($createLineBreakNode());
        }
    }
}
```

### `markdownWritable.ts` — R5

In `registerLineBreakRules`, register the transform directly after R3's:

```typescript
        editor.registerNodeTransform(TextNode, $keepLineEndsOutOfText),
        editor.registerNodeTransform(TextNode, $dropWhitespaceAtLineStarts),
```

Add the constants, the interface and the eight functions directly before `$declinesLineBreak`, after R3's function. `MARKDOWN_IMPORT_TAG`, `$hasUpdateTag`, `$isTableCellNode`, `$isMarkdownListItemTextNode`, `$isMarkdownSourceTextNode`, `$inlineLeaves` and `$isBreakRuleContainer` are already imported or defined in the file.

```typescript
/** The spaces and tabs a text starts with: at a line's start, the save drops them. */
const LEADING_WHITESPACE = /^[ \t]*/;

/** The source of a soft line break: a source run that shows a space and saves a line end. */
const SOFT_BREAK_SOURCE = "\n";

/** The source of a task item's marker, kept as a source run at the start of the item's text. */
const TASK_MARKER_SOURCE = /^\[[ xX]\] $/;

/** The spaces and tabs one text node holds at the start of a line: the node, and how many characters. */
interface LineStartWhitespace {
    readonly node:   TextNode;
    readonly length: number;
}

/**
 * Removes the spaces and tabs at the start of each line of a block, which
 * the save drops and a load does not bring back: at the start of a
 * paragraph, a list item's text, a heading or a quote, after a line break or
 * a soft line break in one, after the task marker that opens an item's
 * text, and at the start of each paragraph of a table cell. Only the block
 * an end of the selection stands in is read: the block being edited, never
 * one an edit only passes text through. While the caret stands in that
 * whitespace or at either end of it, it stays: the user is typing it, or is
 * about to type before it. The next edit of the block that leaves the caret
 * elsewhere removes it, so a space and then a letter typed at a line's start
 * leave the letter alone. A caret keeps its place in the text. Nothing is
 * removed while a text of the block is being composed (an input method, a
 * dead key); the update that ends the composition removes it. A code block,
 * a raw block, a code span and the text of a link keep their whitespace, as
 * the save does, and so does whitespace before a source run at the start of
 * a later line (an indented `<span>`). A load keeps what it loaded.
 *
 * @param text - The text node that changed.
 */
function $dropWhitespaceAtLineStarts(text: TextNode): void {
    const block = $hasUpdateTag(MARKDOWN_IMPORT_TAG) ? null : $findEnclosingBlock(text);
    const inCell = $isParagraphNode(block) && $isTableCellNode(block.getParent());

    if (block === null || !(inCell || $isBreakRuleContainer(block))) {
        return;
    }

    const isEdited = $selectionStandsIn(block);
    const isComposing = $inlineLeaves(block).some((leaf) => $isTextNode(leaf) && leaf.isComposing());

    if (!isEdited || isComposing) {
        return;
    }

    for (const run of $whitespaceAtLineStarts(block, inCell)) {
        const isTyped = $caretStandsIn(run);

        if (!isTyped) {
            run.forEach(({ node, length }) => $dropLeadingCharacters(node, length));
        }
    }
}

/**
 * The whitespace at the start of each line of a block, one run per line
 * that opens with some: the plain texts the line opens with that hold only
 * spaces and tabs, and the leading spaces and tabs of the next. A line ends
 * at a line break or a soft line break, except in a table cell, whose save
 * keeps the whitespace after a break. A task marker opening an item's text
 * comes before the line's start. The whitespace before a source run that
 * opens a later line is left out: the save keeps it.
 *
 * @param block - The block.
 * @param inCell - Whether the block is a paragraph of a table cell.
 * @returns The runs, in order.
 */
function $whitespaceAtLineStarts(block: ElementNode, inCell: boolean): LineStartWhitespace[][] {
    const runs: LineStartWhitespace[][] = [];
    let run: LineStartWhitespace[] = [];
    let atLineStart = true;
    let isFirstLine = true;

    const endLine = (): void => {
        if (run.length > 0) {
            runs.push(run);
        }

        run = [];
    };

    for (const child of block.getChildren()) {
        const endsLine = !inCell && $endsLine(child);

        if (endsLine) {
            endLine();
            atLineStart = true;
            isFirstLine = false;
        }

        if (endsLine || !atLineStart || $opensTaskItem(block, child)) {
            continue;
        }

        const length = $leadingWhitespaceLength(child);

        if (length > 0) {
            run.push({ node: child as TextNode, length });
        }

        const isWhitespaceOnly = length > 0 && length === child.getTextContentSize();
        const indentsSource = length === 0 && !isFirstLine && $isMarkdownSourceTextNode(child);

        if (indentsSource) {
            run = [];
        }

        atLineStart = isWhitespaceOnly;
    }

    endLine();

    return runs;
}

/**
 * Whether an inline node ends a line of its block: a line break, or a soft
 * line break.
 *
 * @param node - The inline node.
 * @returns `true` when it does.
 */
function $endsLine(node: LexicalNode): boolean {
    return $isLineBreakNode(node) || ($isMarkdownSourceTextNode(node) && node.getSource() === SOFT_BREAK_SOURCE);
}

/**
 * Whether an inline node is the task marker that opens a list item's text.
 *
 * @param block - The block holding the node.
 * @param node - The inline node.
 * @returns `true` when it is.
 */
function $opensTaskItem(block: ElementNode, node: LexicalNode): boolean {
    return $isMarkdownListItemTextNode(block) && node.getPreviousSibling() === null
        && $isMarkdownSourceTextNode(node) && TASK_MARKER_SOURCE.test(node.getSource());
}

/**
 * How many spaces and tabs a plain text starts with: none for any other
 * node — a source run, a code span, a link, an image.
 *
 * @param node - The inline node.
 * @returns The number of leading spaces and tabs.
 */
function $leadingWhitespaceLength(node: LexicalNode): number {
    const isPlainText = $isTextNode(node) && !$isMarkdownSourceTextNode(node) && !node.hasFormat("code");

    return isPlainText ? LEADING_WHITESPACE.exec(node.getTextContent())![0].length : 0;
}

/**
 * Whether an end of the selection stands in a block: the block the user is
 * editing. A block an edit only moves text into or out of, on the way to
 * where the caret ends, is left alone until it is edited itself.
 *
 * @param block - The block.
 * @returns `true` when the selection's anchor or focus is in the block.
 */
function $selectionStandsIn(block: ElementNode): boolean {
    const selection = $getSelection();
    const points = $isRangeSelection(selection) ? [selection.anchor, selection.focus] : [];

    return points.some((point) => $findEnclosingBlock(point.getNode())?.is(block) === true);
}

/**
 * Whether a collapsed caret stands in a line's starting whitespace, or right
 * after it: the user is typing there.
 *
 * @param run - The whitespace at the line's start.
 * @returns `true` when it does.
 */
function $caretStandsIn(run: readonly LineStartWhitespace[]): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== "text") {
        return false;
    }

    const { key, offset } = selection.anchor;

    return run.some(({ node, length }) => node.getKey() === key && offset <= length);
}

/**
 * Removes the first characters of a text node, or the whole node when they
 * are all it holds. A selection point in the text moves back with the
 * characters after them.
 *
 * @param node - The text node.
 * @param length - How many characters to remove.
 */
function $dropLeadingCharacters(node: TextNode, length: number): void {
    if (length === node.getTextContentSize()) {
        node.remove();

        return;
    }

    const selection = $getSelection();
    const points = $isRangeSelection(selection) ? [selection.anchor, selection.focus] : [];
    const key = node.getKey();

    node.setTextContent(node.getTextContent().slice(length));

    for (const point of points) {
        if (point.type === "text" && point.key === key) {
            point.set(key, Math.max(0, point.offset - length), "text");
        }
    }
}
```

Extend the JSDoc of `registerLineBreakRules` with one sentence after "…its cell break shows anywhere.": "Two text node transforms turn a line end inside a text into a line break node ({@link $keepLineEndsOutOfText}), and remove the spaces and tabs at a line's start, which the save drops, from the block being edited once the caret is not at them ({@link $dropWhitespaceAtLineStarts})." Replace "its cell break shows anywhere" in the same JSDoc by "its line break (`<br>`) shows anywhere".

### `MarkdownEditor.ts` — R4

In `$moveSelectedItemsOnce`, drop the early return, add `opensItem`, and return `true`:

```typescript
function $moveSelectedItemsOnce(isIndent: boolean): boolean {
    const carried = $itemBlocksCarriedAlong(isIndent);

    $handleIndentAndOutdent((block) => {
        const indent = block.getIndent();
        // Only a list item has a depth: any other block would take an indent no save writes.
        const opensItem = $isMarkdownListItemTextNode(block) || $isListItemNode(block);
        const movesItself = opensItem && !carried.has(block.getKey());

        if (movesItself && isIndent) {
            block.setIndent(indent + 1);
        } else if (movesItself && indent > 0) {
            block.setIndent(indent - 1);
        }
    });

    return true;
}
```

Rewrite the function's JSDoc: the first paragraph becomes "`INDENT_CONTENT_COMMAND` and `OUTDENT_CONTENT_COMMAND` listener. Every selected list item moves one level; a block that is no list item is left as it is, since Lexical's own handler would give it an indent no save writes. Where a range holds the text of a list item and the text of an item nested in it, the outer item is moved, and what it holds goes with it; the nested item is not moved a second time for itself." The `@returns` line becomes "`true`: the command is handled here for every selection." The `@remarks` paragraph stays.

### `markdown-roundtrip/viewModel.ts` (test code) — R2

The view model is the round-trip harness's model of the viewer, so it reads a cell's `<br>` as the viewer does. Import the pattern beside the table token types (`import { CELL_LINE_BREAK_TAG } from '~/component/display/markdownTableExtension';`) and add a case after `case 'br'` in `viewerInlineToken`:

```typescript
        case 'html': {
            const text = (token as Tokens.HTML).text;
            const isCellLineBreak = context.inCell && CELL_LINE_BREAK_TAG.test(text);

            if (isCellLineBreak) {
                runs.push({ kind: 'break' });
            } else {
                pushText(runs, text, context);
            }

            break;
        }
```

---

## Ordered Implementation Steps

1. **Check the base.** Both plans in `depends-on` are in `plans/implemented/`. From the repository root: `grep -n 'function \$keepLoosenessAfterTyping\|function \$keepLoosenessThroughItem\|function \$keepCellParagraphs\|function registerLineBreakRules\|function \$declinesLineBreak\|function \$inlineLeaves\|function \$isBreakRuleContainer' packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` — expect seven matches. `grep -n 'function \$moveSelectedItemsOnce' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — expect one. `grep -n 'function writeBreak\|function pushTokenReading\|const open = (mark: Mark)' packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` — expect three. If `$keepLoosenessAfterTyping` does not end in `$keepLoosenessThroughItem(list, item)`, the looseness plan is not in: stop.
2. **Add the test file.** Create `packages/lib/tests/component/markdown-editor-reload-differences.test.ts` with the content of *Addendum: the test file*, unchanged.
3. **See it fail.** From `packages/lib`: `npx vitest run tests/component/markdown-editor-reload-differences.test.ts`. Expect 31 failed and 14 passed. The 14 that pass are `L4`, `C3`, `C4`, the three `C6` rows, `C7`, `N3`, `I4`, `W5`, `W7`, `W11`, and the `W4` rows for a code block and for the middle of a line. Any other split means the base differs from what this plan measured; stop and report it.
4. **R1.** Edit `$keepLoosenessAfterTyping` as in *Internal Structure*. Check: rows `L1` to `L4` pass.
5. **R2.** Add `CELL_LINE_BREAK_TAG` to `markdownTableExtension.ts`; make the viewer, importer and serializer edits of *Internal Structure*; make the `viewModel.ts` edit. Add the viewer rows `V1` to `V3` to `tests/component/display/Markdown.test.ts` and the two corpus rows to `tests/component/markdown-roundtrip/corpus/dialect.ts`, as *Expected Behaviour* gives them. Check: rows `C1` to `C7`, `V1` to `V3`, and the `W4` row for a cell's line after a `<br>` pass; `npx vitest run tests/component/markdown-roundtrip -t 'table cell line break'` passes.
6. **R3.** Add the import, the registration and `$keepLineEndsOutOfText`. Check: rows `N1` to `N3` pass.
7. **R4.** Edit `$moveSelectedItemsOnce`. Check: rows `I1` to `I4` pass.
8. **R5.** Add the registration, the constants, `LineStartWhitespace` and the eight functions; extend `registerLineBreakRules`' JSDoc. Check: all 45 rows of the new file pass.
9. **Update the existing tests the change answers differently.** From `packages/lib`, `npx vitest run tests/component` fails exactly the twelve tests below before this step. Edit each as listed; then the command passes. Strings are quoted as the test source writes them.
    - `markdown-serializer.test.ts`, the `nested` table (`a quote nested in a cell…`, `a code block nested in a cell…`): the expected `'q\\n\\nr'` becomes `'q<br>r'` and `'x \\| y\\n\\nz'` becomes `'x \\| y<br>z'`. In the comment above the table, "each of its lines split by the cell break" becomes "each of its line breaks written as `<br>`".
    - `markdown-serializer.test.ts`, `a line break in a cell writes the cell paragraph break, which the viewer shows as one break`: rename to `a line break in a cell writes <br>, which the viewer shows as one break`; the expected save's cell becomes `x<br>y`.
    - `markdown-serializer.test.ts`, `in a table cell, the newline is the cell break, not a raw newline ending the row`: rename to `in a table cell, the newline is a <br>, not a raw newline ending the row`; the expected cell becomes `a<br>b`.
    - `markdown-serializer.test.ts`, `emphasis opening right after a table cell's break is written after a space, so it can open`: rename to `emphasis opening right after a table cell's paragraph break is written after a space, so it can open`; the expected cell becomes `<br>*{*\\n\\n **}**` (the first break is a line break now, the second still a paragraph break); add to its comment "A line break, `<br>`, ends in punctuation, after which the delimiter opens with no space."
    - `markdown-serializer.test.ts`, the `cases` table of `a hard break at the start of a block is written; a table cell keeps a break at either edge`: in the four `a cell … a break …` rows the expected cell `\\n\\na` becomes `<br>a`, `a\\n\\n` becomes `a<br>`, `\\n\\n` becomes `<br>`, and `a\\n\\nb` becomes `a<br>b`. The three `empty paragraph` rows stay.
    - `markdown-importer.test.ts`, `Shift+Enter at the end of a table cell still breaks the line (control)`: in the `kept` table, the expected cell `b\\n\\n` becomes `b<br>`.
    - `markdown-editor-command-crashes.test.ts`, `W1: deleting the last line of a quote converted from a code block`: the second `selectText` becomes `selectText(editor, ['b', 0], ['b', 1])`. After R3 the quote holds `a`, a line break and `b`, not one text `a⏎b`.
    - `markdown-editor-list-item-paste.test.ts`, `T12: a pasted line that opens with a tab keeps the tab in the item's new paragraph`: rename to `T12: a pasted line that opens with a tab loses the tab in the item's new paragraph, as its save does`; the expected list becomes `['paragraph:y1']`.

    That is nine tests in `markdown-serializer.test.ts` (two, one, one, one, four) and one in each of the other three files. A test that fails and is not in this list states behaviour this plan does not mean to change: report it with its name before changing it.[^changed-tests]
10. **Static checks.** From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint` — all clean.
11. **Full suite.** `npm test` — every test passes.
12. **Commit the code** (the `commit` skill), one commit per rule, so the differential of step 13 can copy the tree with `git archive`.
13. **Run the differential** as in `## Verification`, *The reload differential*. It must end with `HARD CHECKS AT ZERO`. If it does not, stop and report the first line that is not zero.
14. **Docs and changelog.** Apply `## Documentation Impact`.
15. **Docs and build checks.** From `packages/lib`: `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.
16. **Manual checks** of `## Expected Behaviour`, *Manual checks*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts` |
| Create | `packages/lib/tests/component/markdown-editor-reload-differences.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-paste.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Editor rows

All rows are unit tests in `markdown-editor-reload-differences.test.ts`. A tree is written as the test file's `tree` helper prints it: each list as `tight(…)` or `loose(…)`, each text in quotes (a source run too, as the text it shows), `[indented]` after a block that carries an element indent. Unless a row says otherwise, it checks the tree, the save, and that a load of the save shows the same tree. `CELL(x)` stands for the table `| t0 |⏎| --- |⏎| x |`: a header cell `t0` and one body cell holding `x`. A row on such a table gives the body cell's paragraphs as the tree, and the body cell's text as the save.

Rows that fail before the change:

| Row | Document | Steps | Tree after | Save after |
|---|---|---|---|---|
| L1 | `- a⏎⏎  <div>` | select the raw block's text, delete, type a space; then type `<p>` after the space | after the space: `tight(…, markdown-raw-block(" "))`; after `<p>`: `loose(…, markdown-raw-block(" <p>"))` | `- a⏎⏎  <p>`, which reloads loose |
| L2 | `- a⏎- b⏎- c` | a raw block of one space appended to item `a` in code; `<div>` typed after the space | `loose(…)` | `- a⏎⏎  <div>⏎⏎- b⏎⏎- c` |
| L3 | `- a⏎⏎  <div>` | a space typed at the raw block's end; `<div>` selected and deleted | `tight(…, markdown-raw-block(" "))` | `- a`, which reloads as a tight list of one item |
| C1 | `CELL(t1)` | Shift+Enter between `t` and `1` | `paragraph("t", linebreak, "1")` | `CELL(t<br>1)` |
| C2 | `CELL(t1)` | Shift+Enter at the end of `t1`; `y` typed; then two undos | `paragraph("t1", linebreak, "y")`; after the undos the save is `CELL(t1)` | `CELL(t1<br>y)` |
| C5 | `CELL(a<br>b)`, and the same with `<br/>`, `<br />`, `<BR>` | load; then `x` typed after `b` | after the load `paragraph("a", linebreak, "b")`, saved as loaded; after `x` `paragraph("a", linebreak, "bx")` | `CELL(a<br>bx)` |
| N1 | a code block of the lines `a`, `b` | `setBlockType("paragraph")` | `paragraph("a", linebreak, "b")` | `a\⏎b` |
| N2 | the same | the bulleted toggle | `tight(markdown-list-item(markdown-list-item-text("a", linebreak, "b")))` | `- a\⏎  b` |
| I1 | `p0⏎⏎p1` | `x` typed in `p1`; the indent command; then one undo | `paragraph("p0") \| paragraph("px1")`, no `[indented]`; the undo takes back the `x` | `p0⏎⏎px1`, then `p0⏎⏎p1` |
| I2 | `- a⏎- b⏎⏎p0` | a range from `b` into `p0`; the indent command; then one undo | `b` is an item of a list nested in item `a`; `paragraph("p0")` without `[indented]` | `- a⏎  - b⏎⏎p0`, then the document |
| I3 | `- a⏎⏎  more⏎- b` | caret in `more`; the indent command | `paragraph("more")` without `[indented]` | the document |
| W1 | `p0` | a space typed at the start; `x`; `y` | after the space `paragraph(" p0")`; after `x` `paragraph("xp0")`; after `y` `paragraph("xyp0")` | `xp0` after `x` |
| W2 | `p0` | a space, a space and a tab typed at the start; then `x` | `paragraph("  \tp0")`, then `paragraph("xp0")` | `xp0` |
| W3 | `# h0`, `> q0`, `- i0`, `- [ ] t0`, `- a⏎⏎  m0`, `a\⏎b0`, `a⏎b0`, `CELL(c0)`, `CELL(a\n\nc0)` | a space then `x` typed before the last text's first letter | the space gone: `heading("xh0")`, `quote("xq0")`, `…("xi0")`, `…("[ ] ", "xt0")`, `…paragraph("xm0")`, `paragraph("a", linebreak, "xb0")`, `paragraph("a", " ", "xb0")`, `…paragraph("xc0")`, `…paragraph("a"), paragraph("xc0")` | `# xh0`, `> xq0`, `- xi0`, `- [ ] xt0`, `- a⏎⏎  xm0`, `a\⏎xb0`, `a⏎xb0`, `CELL(xc0)`, `CELL(a\n\nxc0)` |
| W4 | `CELL(a<br>c0)` | a space then `x` typed before `c0` | `paragraph("a", linebreak, " xc0")`: kept | `CELL(a<br> xc0)` |
| W6 | `p0` | a space typed at the start; the caret moved to the end; `y` typed | `paragraph("p0y")` | `p0y` |
| W8 | `p0` | a space and `x` typed at the start; one undo | `paragraph("xp0")`, then `paragraph("p0")` | `p0` after the undo |
| W9 | `p0` | a space typed at the start; a composition started after it, holding `´`; the composition ended as `é` | while composing `paragraph(" ´p0")`; after `paragraph("ép0")` | `ép0` |
| W10 | `p0` | a paste of a space at the start; a paste of `x` | `paragraph(" p0")`, then `paragraph("xp0")` | `xp0` |
| W12 | `p0` | a paste of a tab and `x` at the start | `paragraph("xp0")` | `xp0` |

Controls that pass before and after:

| Row | Document | Steps | Expected |
|---|---|---|---|
| L4 | `- a⏎⏎  <div>⏎- b` | `x` typed at the end of the raw block | the list stays loose; save `- a⏎⏎  <div>x⏎⏎- b` |
| C3 | `ab` | Shift+Enter between `a` and `b` | `paragraph("a", linebreak, "b")`; save `a\⏎b` |
| C4 | `CELL(t1)` | Enter between `t` and `1` | `paragraph("t"), paragraph("1")`; save `CELL(t\n\n1)` |
| C6 | ``CELL(`a<br>b`)``, `CELL(a\<br>b)`, `a<br>b` | load | the `<br>` stays text (`paragraph("a<br>b")` in the cell; `paragraph("a", "<br>", "b")` outside a table); saved as loaded |
| C7 | `CELL(t1)` | the text `<br>` typed between `t` and `1` | `paragraph("t<br>1")`; save `CELL(t\<br>1)` |
| N3 | a code block of the lines `a`, `b` | `x` typed after `a` | one text `ax⏎b` in the code block; save keeps the fence |
| I4 | `- a⏎- b` | caret in `b`; indent, then outdent | saves `- a⏎  - b`, then `- a⏎- b` |
| W4 | a code block of `c0`; `a0` | a space then `x` typed at the code's start; at the middle of `a0` | `code(" xc0")`, save `` ```⏎ xc0⏎``` ``; `paragraph("a x0")`, save `a x0` |
| W5 | `p0` | a no-break space then `x` typed at the start | `paragraph(" xp0")` with the no-break space; save the same text |
| W7 | `a b0` | Enter after `a`; then `x` | `paragraph("a") \| paragraph(" b0")`: the caret is before the space, so it stays; then `paragraph("a") \| paragraph("x b0")`, save `a⏎⏎x b0` |
| W11 | `w2⏎⏎x y` | `z` typed over the range from the start of `w2` to after `x` | `paragraph("z y")`, save `z y`: the rest of `x y` keeps its space, which stood at a line's start, the caret before it, between the removal and the typing |

### Viewer rows

In `tests/component/display/Markdown.test.ts`, inside `describe('Markdown table', …)`, directly before `it('does not split an escaped newline outside a table cell', …)`. They use the file's `childTagsOf`, `createdTags` and `textWrites` helpers.

`VTABLE(x)` stands for `| x | c |⏎| --- | --- |⏎| 1 | 2 |`, whose first header cell holds `x`.

| Row | Source | Expected |
|---|---|---|
| V1 | `VTABLE(a<br>b)`, and the same with `<br/>`, `<br />`, `<BR>` | the `th` holds one `BR`; the text writes hold `a` and `b`; no text write holds `<` |
| V2 | `VTABLE(**a<br>b**)` | the `strong` holds a `BR` |
| V3 | ``VTABLE(`a<br>b`)`` (a code span), `VTABLE(a\<br>b)` (escaped), `a<br>b` (a paragraph) | no `br` element is created; the text writes hold `a<br>b`, `<` and `<br>` respectively |

The code of the rows:

```typescript
    it.each([
        ['<br>'], ['<br/>'], ['<br />'], ['<BR>'],
    ])('V1: renders a cell\'s %s as a <br> between the two runs of text', (tag) => {
        new Markdown(`| a${tag}b | c |\n| --- | --- |\n| 1 | 2 |`).getElement(true);

        expect(childTagsOf('th').filter((t) => t === 'BR')).toHaveLength(1);
        expect(textWrites()).toEqual(expect.arrayContaining(['a', 'b']));
        expect(textWrites().some((t) => t.includes('<'))).toBe(false);
    });

    it('V2: renders a <br> inside bold text of a cell as a <br> inside the <strong>', () => {
        new Markdown('| **a<br>b** | c |\n| --- | --- |\n| 1 | 2 |').getElement(true);

        expect(childTagsOf('strong')).toContain('BR');
    });

    it.each([
        ['in a code span of a cell', '| `a<br>b` | c |\n| --- | --- |\n| 1 | 2 |', 'a<br>b'],
        ['escaped in a cell', '| a\\<br>b | c |\n| --- | --- |\n| 1 | 2 |', '<'],
        ['outside a table', 'a<br>b', '<br>'],
    ])('V3: keeps a <br> %s as literal text', (_name, source, literal) => {
        new Markdown(source).getElement(true);

        expect(createdTags()).not.toContain('br');
        expect(textWrites()).toContain(literal);
    });
```

Before the change `V1` and `V2` fail and `V3` passes.

### Round-trip corpus rows

In `tests/component/markdown-roundtrip/corpus/dialect.ts`, directly after the `'table cell underscore'` row:

```typescript
    { name: 'table cell line break', source: '| a |\n| --- |\n| x<br>y |' },
    { name: 'table cell line break in a construct kept as written', source: '| a |\n| --- |\n| [~[a](/b) \\]<br>~)]() |' },
```

The harness checks that the viewer and the editor read each alike, and that a save keeps it. The second row is a construct the importer keeps as written, holding a `<br>`: it fails the `surface` check when `keptPieces` is not told it stands in a cell.

### Manual checks — need manual verification

In the demo's MD Editor page (`npx vite` in `packages/lib`), in WYSIWYG mode:

- **M1 (R2).** Put the caret inside a table cell and press Shift+Enter, then type. The text goes on a new line of the same cell; Backspace at its start joins the two lines; source mode shows `<br>` in the cell. Switch back: the cell shows the two lines. Open the same Markdown in the MD Viewer page: the cell shows the two lines. No console message.
- **M2 (R2, source mode).** In source mode, type `x<br>y` into a table cell's text. Switch to WYSIWYG: the cell shows `x` and `y` on two lines.
- **M3 (R1).** Load `- a⏎⏎  <div>` through source mode. Select `<div>` and delete it, type a space, then type `<p>`. Switch to source mode: it reads `- a`, an empty line, and `<p>` indented by two spaces.
- **M4 (R3).** Make a code block of two lines, put the caret in it and choose the paragraph block type. The two lines show as before; the arrow keys move between them.
- **M5 (R5).** At the start of a paragraph, type a space: it shows. Type a letter: the space goes, the letter stands at the start, the caret after it. With a dead key (for example `´` then `e` on a layout that has one) or an input method, type a space at a paragraph's start and then a composed character: the composition is not disturbed, and the space goes when it ends.

---

## Verification

From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm test`, `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.

### The reload differential

The rules add writes to transforms that run on every keystroke, so a wrong one corrupts documents without any error. The check runs the looseness plan's set on a private copy of the parent and of the branch, records for every step the editor's whole tree and the tree a load of its save builds, and compares.

The scripts are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans5/reload-revision/diff/` (called `$K` below). They are the scripts of `…/plans3/large-doc/` (whose `README.md` describes each), with two changes: `reload/rich.py` and `reload/richnorms.py` split the cause `edgespace` into `leadspace` and `trailspace`, and `reload/cmpreload.py` sorts the saves that differ between the two runs (below).

```bash
K=~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans5/reload-revision/diff
$K/setup.sh parent <the commit the branch started from>
$K/setup.sh branch <the branch's last code commit>
for side in parent branch; do
    SYS="0 1 2 3 4 5 6 7" RND="101 202 303 404" RNDN=1800 $K/runreload.sh $side $side 2
done
python3 $K/reload/cmpreload.py parent branch
```

`cmpreload.py` prints one line per check and ends with `HARD CHECKS AT ZERO` or `HARD CHECKS FAIL`:

| Hard check | What it counts | Must be |
|---|---|---|
| a save that does not reload to the same document | steps of the branch whose tree differs from its reload's by a cause this plan removes (`indent`, `cellbreak`, `textnewline`), and steps that reload as shown on the parent and not on the branch | 0 |
| a save that differs for no reason the plan gives | steps whose save differs between the two runs, outside the cases that hold an indent step, other than: a cell line break written `<br>` where the parent wrote `\n\n`; a save that reloads as shown where the parent's did not; a later step of a case whose tree a rule changed at an earlier step (its edits land on other text) | 0 |
| a second undo step | cases where undoing every edit does not give the loaded document back | 0 |
| a throw | errors other than the key emulation the test DOM lacks | 0 |

A case that holds an indent step is compared for its counts only. The indent command made an undo step on a paragraph before and makes none now, so the two runs undo other edits from that step on.[^indent-undo]

Read the counts of the three exempted kinds too: they should be near those of *Addendum: the groups* (100, 7 and 1). Then print the groups of the branch: `python3 $K/reload/rich.py $K/reload/data-branch`. Expect the *by cause* list of *Addendum: the groups*, its branch column, within a few steps.

---

## Documentation Impact

No exported symbol changes. In `packages/lib/docs/components/MarkdownEditor.md`:

- In the **Line breaks** bullet (line 90), replace the last sentence "A table cell keeps every break: its cell break shows anywhere." by: "A table cell keeps every break, anywhere in the cell: Shift+Enter there makes a line break, saved as `<br>`, and Enter a new line of the cell, saved as the cell paragraph break `\n\n`; both show as a new line, and a `<br>` in a loaded cell shows as a line break. A code block's lines, when it becomes a paragraph, a quote or a list item, are kept by line breaks."
- After the **A link holding only a soft line break** bullet (line 94), add a bullet: "- **Whitespace at a line's start.** Markdown drops the spaces and tabs a line starts with — at the start of a paragraph, heading, quote, list item or table cell paragraph, after a line break, and after a task marker — so the save writes none. A space typed there shows while the caret stays right after it; the next edit of the block removes it, so a letter typed after the space takes its place. Whitespace another edit leaves at a line's start goes at once unless the caret stands right before or after it: a pasted line that opens with a tab loses the tab, while a space left right after the caret by Enter or a deletion stays, and text typed there keeps it inside the line. A code block, a raw Markdown block, a code span, a link's text and a cell's line after a `<br>` keep theirs, as their save does."
- In the **Lists** bullet (line 95), after the sentence that begins "A list's looseness follows what its save reads as", add: "Text typed into a raw Markdown block of an item, or deleted from it, counts as it does in a paragraph: a raw block holding only spaces is no block of its item."

In `packages/lib/docs/components/Markdown.md`, add a row to the syntax table after the `body cell <<` / `^^` row (line 65):

```markdown
| `<br>` (or `<br/>`, `<br />`) inside a table cell | `<br>` — a line break in the cell; elsewhere, and inside a code span, it is literal text like any other HTML |
```

Add four entries at the end of `## Fixed` → `### Components` in `packages/lib/docs/reference/changelog/next.md`, in the file's bullet style:

- **`MarkdownEditor`: a list's looseness follows text typed in a raw block of its item.** A raw Markdown block that held only spaces, and so wrote nothing, could come to hold text while its list stayed tight in the editor and loaded loose from the save; and the other way round. The list now turns loose or tight with the keystroke.
- **`MarkdownEditor`: Shift+Enter in a table cell keeps its line break through a save.** The break was saved as the cell paragraph break `\n\n` and loaded back as a second paragraph of the cell. It is now saved as `<br>` and loads as a line break.
- **`MarkdownEditor`: a code block made into a paragraph, a heading, a quote or a list item holds line breaks.** Its text kept the line ends as characters of one text. What is shown and saved is unchanged.
- **`MarkdownEditor`: the indent command leaves a block that is no list item alone.** `INDENT_CONTENT_COMMAND` gave a paragraph, a heading, a quote, a code block or a raw block an indent that was drawn and never saved, and added an undo step. No key or method of the editor sends the command.

Add two entries at the end of `## Changed` → `### Components`:

- **`Markdown` and `MarkdownEditor` read `<br>` in a table cell as a line break.** `<br>`, `<br/>` or `<br />` in a cell's text showed as that literal text in the viewer and in the editor; it now renders, and loads, as a line break in the cell, and the editor saves a line break in a cell as `<br>`. Outside a table, and inside a code span, it stays literal text. A cell's paragraphs (Enter, a merged cell) are still saved as `\n\n`.
- **`MarkdownEditor` removes the spaces and tabs at a line's start at the next edit.** The save has always dropped them; the editor kept showing them until a reload. A space typed at a line's start still shows while the caret is right after it, and goes when the next character is typed.

Run `grep -rn 'cell break' packages/lib/docs/` and check that no other page says a line break in a cell is saved as `\n\n`; the bullet edited above is the one at `f984cf5e7`.

---

## Potential Challenges

- **Line numbers have moved.** Four plans edit these files first. Locate every function by name; step 1's greps confirm the shape.
- **The order of the `TextNode` registrations in `registerLineBreakRules` matters.** `$keepLineEndsOutOfText` comes first, so the rules after it see line break nodes; `$dropWhitespaceAtLineStarts` next, then the break rule. Rows `N1` and `N2` pass either way; the differential's `textnewline` line does not.
- **`splitText` drops empty pieces.** A text that starts or ends with a line end gives no empty text node; R3's loop only looks at pieces that are a line end. Do not index the pieces by position.
- **`setTextContent` does not move the selection.** `$dropLeadingCharacters` moves the points in the text itself; without it the caret lands one character too far right after the space goes (row `W1`'s `y` would land after `p`).
- **A command dispatched outside an update commits later.** In the test file a step that reads the tree (`shown`) commits the updates before it. Row `W8` reads the tree before its undo for that reason; an undo dispatched right after typing undoes against an uncommitted history.
- **The end of a composition may change no text.** When the browser's last composition update leaves the text as it was, no `TextNode` is marked changed, and the whitespace goes at the block's next edit instead. Row `W9` changes the text at the end, as composing a dead key does.
- **Row `I1` needs the typed `x`.** Without an edit before it, an undo has nothing to take back, and the row could not tell "no undo step" from "one empty undo step".
- **The differential needs memory.** Each of its 12 jobs holds a document set in memory; at two jobs a side took six minutes. Run the two sides one after the other.

---

## Critical Files

- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts): `registerMarkdownListTransforms` (L362) and `$keepLoosenessAfterTyping` (L418), the precedent and the site of R1; `registerLineBreakRules` (L1481), `$isBreakRuleContainer` (L1565), `$findEnclosingBlock` (L1594), `$inlineLeaves` (L1628), `$dropUnwritableBreaks` (L1707) and `$keepSelectionInText` (L1849), for R3 and R5; `registerRunEdgeRules` (L1895) and `$editedLeaves` (L2011), the precedent for leaving what the caret is typing until the next edit, and for skipping a load.
- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `$moveSelectedItemsOnce` (L4000), `registerListItemRules` (L4078).
- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts): `CELL_PARAGRAPH_BREAK` (L224), `serializeTableCell` (L2813), `writeBreak` (L4577), `pushTokenReading` (L4954) and `pushTextReading` (L5015), the cell paragraph break R2 sits beside; `trimLineEdges` (L5218), which drops the whitespace R5 removes; `$writesSomething` (L2493), which says a raw block of whitespace writes nothing.
- [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts): `appendInlineToken` (L1564), `appendTextToken` (L1598), `appendKeptConstruct` (L1856), `appendKeptRuns` (L1883), `keptPieces` (L1944), `hardBreak` (L2379).
- [Markdown.ts](../packages/lib/src/typescript/lib/component/display/Markdown.ts): `CELL_PARAGRAPH_BREAK` (L70), `appendTableRow` (L1848), `appendInlineToken` (L2017), `appendTextWithBreaks` (L2173).
- [markdownTableExtension.ts](../packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts): the table token types every reader imports; `tokenizeTable` (L242).
- `plans/markdown-editor-list-looseness-transform-cost.md`: `$keepLoosenessThroughItem`, and row `L8`, which starts from the state R1 removes.
- `plans/markdown-editor-table-command-fixes.md`, decision B1: `\n\n` is the cell paragraph break a merged cell is saved with.
- `plans/implemented/markdown-list-toggle-task-item-parity.md`, Non-Goals: the kept task marker.

---

## Non-Goals

- **The task marker kept as source, and inline HTML kept as source at an item's start.** The owner chose to leave them. Turning the run into text the moment it stops being a marker would end the round trip of a list toggle off and on.
- **`<br>` outside a table cell.** A paragraph has its own line break (`\` at a line's end); `<br>` there stays literal text in the viewer and a source run in the editor, as all inline HTML is.
- **Changing how a cell's paragraphs are written.** Enter and a merged cell keep `\n\n`, and a document that holds `\n\n` loads as before.
- **Whitespace at a line's end, and a no-break space at a cell's start.** Trailing whitespace is a state of typing that the next word ends. A cell's save trims every kind of whitespace at its start, a no-break space too; that one character is left as the editor holds it.[^r5-nbsp]
- **Other states of editing.** An empty paragraph, an empty item text, an emptied raw block, and whitespace at the edge of a raw block exist because the user is typing there. A save drops them, and a load does not bring them back.
- **What a load records.** The bullet or delimiter a list was written with, and a code block's lines as one text.
- **The title of an indented definition.** The one record left in the list-edit fuzz. It is sign-off 4 of `markdown-editor-raw-block-edge-cases`, and no unstarted plan changes it.
- **The 88 records of the reviewer 7 fuzz.** None is a defect of the editor; see *Addendum: the fuzz records*.
- **Binding a key to the indent command.** R4 only keeps the command from making a state no save holds.

---

## Addendum: the groups

Measured on private copies of `f984cf5e7` with the looseness plan's prototype applied, on `marked` 18.0.10: the parent, and the parent with this plan's code (`…/plans5/reload-revision/`: `applyR.py` of `…/plans3/large-doc/` for R1, R3 and R4, `applyBR.py` for R2, `applyW.py` for R5). The set is the looseness plan's: 44 documents with 29 edits at every caret, 13 over every short range, joins and pairs of edits, then 4 × 1,800 random runs, each edit then undone and redone. The probe (`diff/probes/zz-ld-reload.test.ts`) records each node's exported JSON. The parent's counts are the ones an earlier draft measured on `fef32344b`, to the step.

A step can have several causes. "Part of" counts the steps a cause takes part in; "alone" those it explains by itself. The earlier draft's `edgespace` is split here into `leadspace` and `trailspace`.

| Cause (name in `rich.py`) | Parent: part of | Parent: alone | Branch: part of | Branch: alone | Group in this plan |
|---|---|---|---|---|---|
| `marker` | 8,259 | 7,001 | 8,277 | 7,288 | marker as loaded |
| `tasksource` | 6,921 | 3,566 | 6,907 | 3,637 | task marker kept as source |
| `emptyblock` | 6,795 | 5,251 | 6,794 | 5,424 | empty paragraph |
| `indent` | 4,070 | 3,175 | 0 | 0 | **R4** |
| `leadspace` | 3,834 | 2,498 | 3,462 | 2,450 | whitespace at a line's start (**R5** removes it once the caret has left it) |
| `trailspace` | 3,573 | 1,006 | 3,553 | 1,027 | whitespace at a line's end |
| `anymarker` | 1,948 | 1,232 | 1,952 | 1,315 | marker written by rule |
| `codebreaks` | 1,371 | 1,099 | 1,375 | 1,160 | code block line ends |
| `none` | 1,268 | 1,268 | 1,349 | 1,349 | cached text format |
| `emptyitemtext` | 631 | 448 | 630 | 482 | empty item text |
| `emptyraw` | 245 | 160 | 244 | 160 | emptied raw block |
| `innerspace` | 203 | 0 | 201 | 0 | task marker kept as source (spaces after the run) |
| `softedge`, and 6 steps the script leaves unexplained | 162 | 104 | 77 | 29 | soft line break at an edge |
| `emptytable` | 153 | 103 | 154 | 106 | emptied table |
| `rawedges`, `rawmargin` | 181 | 76 | 181 | 76 | raw block edges |
| `cellbreak` | 144 | 105 | 0 | 0 | **R2** |
| `looseness` | 23 | 0 | 24 | 0 | follows from an emptied table: its item reads as two blocks |
| `htmlsource` | 13 | 13 | 13 | 13 | inline HTML kept as source |
| `textnewline` | 2 | 2 | 0 | 0 | **R3** |
| steps compared / differing | 197,571 / 33,030 | | 197,571 / 29,534 | | |

No step differs in a list's looseness alone. On the branch, 2,011 of the 3,462 `leadspace` steps are undo and redo steps: the history brings back a state the editor held while the user typed a space, with the caret after it, so R5 keeps it; 341 are the step that typed the space. The groups not named R1 to R5 move by a few steps between the two columns because the two runs' documents differ from the first step a rule changed.

Each group, with the smallest case found:

| Group | Document and steps | Editor holds | Save | Reload holds |
|---|---|---|---|---|
| marker as loaded | `p0`; the bulleted toggle | a list with no recorded marker | `- p0` | a list whose marker is recorded as `-` |
| marker written by rule | `- a0⏎⏎  - n0⏎  - n1`; Enter at the start of `n0` | nested list, marker `-` | `- a0⏎⏎  *⏎  * n0⏎  * n1` | nested list, marker `*` |
| code block line ends | `- a0⏎⏎  ```⏎  c0⏎  ```⏎- a1`; Enter inside `c0` | code: `c`, line break, `0` | the two lines in the fence | code: one text `c⏎0` |
| empty paragraph | `p0`; Enter at its end | `p0`, an empty paragraph | `p0` | `p0` |
| empty item text | `- a0⏎-⏎- a2`; the indent command on `a2` | item 2: an empty text, then a nested list | `- a0⏎- - a2` | item 2: the nested list alone |
| emptied raw block | `p⏎⏎<div>⏎⏎q`; select `<div>`, delete | `p`, an empty raw block, `q` | `p⏎⏎q` | `p`, `q` |
| whitespace at a line's start | `p0`; a space typed at its start, the caret after it | ` p0` | `p0` | `p0` |
| whitespace at a line's end | `p0`; a space typed at its end | `p0 ` | `p0` | `p0` |
| soft line break at an edge | a paragraph whose second line starts with two spaces after an edit joins it | `…`, soft break, `  c0` | the second line at the margin | `…`, soft break, `c0` |
| raw block edges | `- a0⏎⏎  [r]: /u⏎- a1`; a space typed at the raw block's start | ` [r]: /u` | unchanged | `[r]: /u` |
| task marker kept as source | `- [ ] w0`; `setBlockType("quote")` | quote: source run `[ ] `, text `w0` | `> \[ \] w0` | quote: text `[ ] w0` |
| inline HTML kept as source | a paste that leaves `</div>` alone in a paragraph of an item | source run `</div>` | `\</div>` | text `</div>` |
| emptied table | a table of an item cleared by the set's own `clear()` | a table with no row | nothing | no table |

The four defects are rows `L1` and `L3` (R1, which the set does not reach), `C1` (R2, `cellbreak`), `N2` (R3, `textnewline`) and `I1` (R4, `indent`) of `## Expected Behaviour`.

**Result of the prototype.** `cmpreload.py parent branch` ends with `HARD CHECKS AT ZERO`.

| Check | Result |
|---|---|
| steps compared | 197,571 |
| steps of the branch differing by `indent`, `cellbreak`, `textnewline` | 0, 0, 0 (4,070, 144 and 2 on the parent) |
| steps that reload as shown on the parent and not on the branch, outside the indent cases | 0 |
| saves that differ between the two, outside the indent cases | 108: 100 a cell line break written `<br>` where the parent wrote `\n\n`; 7 that reload as shown where the parent's did not (two spaces after a task marker, two spaces a paste left at a line's start, each with its undo and redo); 1 a later step of a case whose tree R3 and R5 changed at its first step, so the step deletes another character |
| saves that differ, in the cases that hold an indent step | 866, in 308 cases, the first always at an undo or redo |
| cases whose undos do not give the document back | 0 on both |
| throws | 0 on both |
| saves whose reload saves differently | 0 on both |

The run before the last fix of R5 found one defect, now a row (`W11`): when text is typed over a range that ends in a later block, the editor removes the range and inserts the text in two updates, and the first leaves the rest of the later block, ` y`, at the start of a block with the caret before it. R5 then removed the space, so `w2⏎⏎x y` with `z` typed from the start of `w2` to after `x` gave `zy`. R5 now keeps whitespace with the caret right before it.

---

## Addendum: the fuzz records

The seeded fuzz of `…/scratch-keep/impl/raw-block-edge-cases/` left 1 list-edit record and 88 reviewer 7 records at `fef32344b`, when an earlier draft of this plan read them all; they were not run again for this draft, which changes nothing they concern.

The reviewer 7 files hold 68 `linesMerged`, 19 `lettersLost` and 1 `parity` record; no record carries two checks. (The 70, 20 and 1 of the raw block edge cases plan's notes count the parent's records replayed on that branch.) None is a defect of the editor:

| Class | Records | What happens | Why the check fires | Owner |
|---|---|---|---|---|
| a raw block re-read as its blocks | 66 `linesMerged` | an edit inside a raw block makes its text read as other blocks, which the editor then shows (`$showRawBlockAsItsBlocks`); two lines of a lazy paragraph become one paragraph joined by a soft break | the check ends a line only at a line break node or a block; the save still holds the two lines, in the same order | none needed |
| lines in one code text | 2 `linesMerged` | a removal or a block type leaves two lines in one code block's text | a line end inside a code text ends no line for the check; the save holds both lines | none needed |
| bold ends inside a word | 14 `lettersLost` | bold over a range that ends inside a word splits that word into two text nodes | the check looks for each word inside one text node; the save holds every letter | none needed |
| copied rows pasted over cells | 5 `lettersLost` | rows copied from a table are written over the cells from the caret's cell on | specified in `markdown-editor-table-cells-paste-empty-column`, rows E1 to E4, which says the harness counts it as lost letters | none needed |
| a ragged table kept raw | 1 `parity` | a paste leaves a table row with more cells than its header; the editor keeps the table as a raw block, and the viewer drops the extra cell | the check exempts raw lists and quotes, not raw tables | none needed |

The list-edit record (seed 7703, document 196, `load:canonical`) is real and small: a definition indented under a list item whose title has a second line. The viewer keeps that line's indentation in the title, and the raw block drops it. It needs no tab. It is sign-off 4 of `markdown-editor-raw-block-edge-cases`. `markdown-tab-column-parity` does not change it, and no other unstarted plan does.

---

## Addendum: the test file

`packages/lib/tests/component/markdown-editor-reload-differences.test.ts`, complete:

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createRangeSelection, $getRoot, $getState, $isElementNode, $isTextNode, $setCompositionKey, $setSelection, CONTROLLED_TEXT_INSERTION_COMMAND,
    DELETE_CHARACTER_COMMAND, INDENT_CONTENT_COMMAND, INSERT_LINE_BREAK_COMMAND, INSERT_PARAGRAPH_COMMAND, OUTDENT_CONTENT_COMMAND, PASTE_COMMAND,
    UNDO_COMMAND,
} from 'lexical';
import type { LexicalEditor, LexicalNode } from 'lexical';
import { $isListItemNode, $isListNode } from '@lexical/list';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { listLooseState } from '~/component/editor/markdownNodeState';
import { $createMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

function load(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return editor;
}

/** The document as a tree: each text as written, each list with its looseness, each block with an indent it carries. */
function tree(node: LexicalNode): string {
    const isText = $isTextNode(node);
    const isList = $isListNode(node);
    const isElement = $isElementNode(node);

    if (isText) {
        return JSON.stringify(node.getTextContent());
    }

    if (isList) {
        const looseness = $getState(node, listLooseState) ? 'loose' : 'tight';

        return `${looseness}(${node.getChildren().map(tree).join(', ')})`;
    }

    if (isElement) {
        const isIndented = !$isListItemNode(node) && node.getType() !== 'markdown-list-item-text' && node.getIndent() !== 0;

        return `${node.getType()}${isIndented ? '[indented]' : ''}(${node.getChildren().map(tree).join(', ')})`;
    }

    return node.getType();
}

function shown(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => $getRoot().getChildren().map(tree).join(' | '));
}

/** Selects from `offset` in the text node reading `from` to `toOffset` in the one reading `to`; `-1` is a text's end. */
function select(editor: MarkdownEditor, from: string, offset: number, to: string = from, toOffset: number = offset): void {
    lexicalOf(editor).update(() => {
        const texts = $getRoot().getAllTextNodes();
        const anchor = texts.find((node) => node.getTextContent() === from)!;
        const focus = texts.find((node) => node.getTextContent() === to)!;
        const selection = $createRangeSelection();

        selection.anchor.set(anchor.getKey(), offset < 0 ? anchor.getTextContentSize() : offset, 'text');
        selection.focus.set(focus.getKey(), toOffset < 0 ? focus.getTextContentSize() : toOffset, 'text');
        $setSelection(selection);
    }, { discrete: true });
}

function type(editor: MarkdownEditor, text: string): void {
    lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, text);
}

function deleteSelection(editor: MarkdownEditor): void {
    lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
}

/** Checks what the editor shows and saves, and that a load of the save shows the same. */
function expectShownAndReloaded(editor: MarkdownEditor, expectedTree: string, expectedSave: string): void {
    const saved = editor.getValue();

    expect(shown(editor)).toBe(expectedTree);
    expect(saved).toBe(expectedSave);
    expect(shown(load(saved))).toBe(expectedTree);
}

describe('the editor shows what its save reloads to: a raw block of a list item that starts or stops writing', () => {
    it('L1: text typed into a raw block that held a space alone makes the list loose', () => {
        const editor = load('- a\n\n  <div>');

        // The raw block's text goes, then a space is typed: it writes nothing, and its one-item list is tight.
        select(editor, '<div>', 0, '<div>', -1);
        deleteSelection(editor);
        type(editor, ' ');

        expect(shown(editor)).toBe('tight(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block(" ")))');

        select(editor, ' ', 1);
        type(editor, '<p>');

        expect(shown(editor)).toBe('loose(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block(" <p>")))');
        expect(editor.getValue()).toBe('- a\n\n  <p>');
        expect(shown(load(editor.getValue()))).toBe('loose(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block("<p>")))');
    });

    it('L2: the same in a list of several items, whose save then sets its items apart', () => {
        const editor = load('- a\n- b\n- c');

        lexicalOf(editor).update(() => {
            const item = $getRoot().getAllTextNodes()[0]!.getParents().find($isListItemNode)!;

            item.append($createMarkdownRawBlockNode(' '));
        }, { discrete: true });
        select(editor, ' ', 1);
        type(editor, '<div>');

        expect(shown(editor)).toBe('loose(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block(" <div>")), markdown-list-item(markdown-list-item-text("b")), markdown-list-item(markdown-list-item-text("c")))');
        expect(editor.getValue()).toBe('- a\n\n  <div>\n\n- b\n\n- c');
    });

    it('L3: a raw block deleted down to a space leaves its one-item list tight', () => {
        const editor = load('- a\n\n  <div>');

        select(editor, '<div>', -1);
        type(editor, ' ');
        select(editor, '<div> ', 0, '<div> ', 5);
        deleteSelection(editor);

        expectShownAndReloadedButForBlank(editor, 'tight(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block(" ")))', '- a', 'tight(markdown-list-item(markdown-list-item-text("a")))');
    });

    it('L4: a letter typed in a raw block that already writes changes no looseness', () => {
        const editor = load('- a\n\n  <div>\n- b');

        select(editor, '<div>', 5);
        type(editor, 'x');

        expectShownAndReloaded(editor, 'loose(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block("<div>x")), markdown-list-item(markdown-list-item-text("b")))', '- a\n\n  <div>x\n\n- b');
    });
});

/** As {@link expectShownAndReloaded}, for a document holding a block that writes nothing, which a load does not build. */
function expectShownAndReloadedButForBlank(editor: MarkdownEditor, expectedTree: string, expectedSave: string, reloadedTree: string): void {
    const saved = editor.getValue();

    expect(shown(editor)).toBe(expectedTree);
    expect(saved).toBe(expectedSave);
    expect(shown(load(saved))).toBe(reloadedTree);
}

describe('the editor shows what its save reloads to: a line break in a table cell', () => {
    const TABLE = '| t0 |\n| --- |\n| t1 |';
    const cells = (...body: string[]): string => `table(tablerow(tablecell(paragraph("t0"))), tablerow(tablecell(${body.join(', ')})))`;

    it('C1: Shift+Enter inside a cell keeps a line break, saved as <br>', () => {
        const editor = load(TABLE);

        select(editor, 't1', 1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

        expectShownAndReloaded(editor, cells('paragraph("t", linebreak, "1")'), '| t0 |\n| --- |\n| t<br>1 |');
    });

    it('C2: text typed after Shift+Enter at a cell\'s end follows the break, and two undos give the cell back', () => {
        const editor = load(TABLE);

        select(editor, 't1', -1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
        type(editor, 'y');

        expectShownAndReloaded(editor, cells('paragraph("t1", linebreak, "y")'), '| t0 |\n| --- |\n| t1<br>y |');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(TABLE);
    });

    it('C3: Shift+Enter in a paragraph outside a table still makes a hard break', () => {
        const editor = load('ab');

        select(editor, 'ab', 1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

        expectShownAndReloaded(editor, 'paragraph("a", linebreak, "b")', 'a\\\nb');
    });

    it('C4: Enter inside a cell still makes a new paragraph of the cell, saved as the cell paragraph break', () => {
        const editor = load(TABLE);

        select(editor, 't1', 1);
        lexicalOf(editor).dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);

        expectShownAndReloaded(editor, cells('paragraph("t")', 'paragraph("1")'), '| t0 |\n| --- |\n| t\\n\\n1 |');
    });

    it.each([
        ['<br>'], ['<br/>'], ['<br />'], ['<BR>'],
    ])('C5: a cell\'s %s loads as a line break, and an edit of the cell saves it as <br>', (tag) => {
        const source = `| t0 |\n| --- |\n| a${tag}b |`;
        const editor = load(source);

        expect(shown(editor)).toBe(cells('paragraph("a", linebreak, "b")'));
        expect(editor.getValue()).toBe(source);

        select(editor, 'b', 1);
        type(editor, 'x');

        expectShownAndReloaded(editor, cells('paragraph("a", linebreak, "bx")'), '| t0 |\n| --- |\n| a<br>bx |');
    });

    it.each([
        ['in a code span of a cell', '| t0 |\n| --- |\n| `a<br>b` |', cells('paragraph("a<br>b")')],
        ['escaped in a cell', '| t0 |\n| --- |\n| a\\<br>b |', cells('paragraph("a<br>b")')],
        ['outside a table', 'a<br>b', 'paragraph("a", "<br>", "b")'],
    ])('C6: a <br> %s stays text', (_name, source, expectedTree) => {
        const editor = load(source);

        expect(shown(editor)).toBe(expectedTree);
        expect(editor.getValue()).toBe(source);
    });

    it('C7: the text <br> typed into a cell is saved escaped and reloads as text', () => {
        const editor = load(TABLE);

        select(editor, 't1', 1);
        type(editor, '<br>');

        expectShownAndReloaded(editor, cells('paragraph("t<br>1")'), '| t0 |\n| --- |\n| t\\<br>1 |');
    });
});

describe('the editor shows what its save reloads to: a line end inside a text', () => {
    it('N1: a code block of two lines made a paragraph holds a line break', () => {
        const editor = load('```\na\nb\n```');

        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(1, 1); }, { discrete: true });
        editor.setBlockType('paragraph');

        expectShownAndReloaded(editor, 'paragraph("a", linebreak, "b")', 'a\\\nb');
    });

    it('N2: a code block of two lines made a list item holds a line break', () => {
        const editor = load('```\na\nb\n```');

        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(1, 1); }, { discrete: true });
        editor.toggleUnorderedList();

        expectShownAndReloaded(editor, 'tight(markdown-list-item(markdown-list-item-text("a", linebreak, "b")))', '- a\\\n  b');
    });

    it('N3: a code block keeps its line ends as text', () => {
        const editor = load('```\na\nb\n```');

        lexicalOf(editor).update(() => { $getRoot().getAllTextNodes()[0]!.select(1, 1); }, { discrete: true });
        type(editor, 'x');

        expectShownAndReloaded(editor, 'code("axb")'.replace('axb', 'ax\\nb'), '```\nax\nb\n```');
    });
});

describe('the editor shows what its save reloads to: an indent', () => {
    it('I1: the indent command leaves a paragraph as it is, and adds no undo step', () => {
        const editor = load('p0\n\np1');

        select(editor, 'p1', 1);
        type(editor, 'x');
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expectShownAndReloaded(editor, 'paragraph("p0") | paragraph("px1")', 'p0\n\npx1');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe('p0\n\np1');
    });

    it('I2: over a list item and a paragraph it moves the item alone, in one undo step', () => {
        const editor = load('- a\n- b\n\np0');

        select(editor, 'b', 1, 'p0', 1);
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expectShownAndReloaded(editor, 'tight(markdown-list-item(markdown-list-item-text("a"), tight(markdown-list-item(markdown-list-item-text("b"))))) | paragraph("p0")', '- a\n  - b\n\np0');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe('- a\n- b\n\np0');
    });

    it('I3: a further paragraph of an item takes none either', () => {
        const editor = load('- a\n\n  more\n- b');

        select(editor, 'more', 1);
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expectShownAndReloaded(editor, 'loose(markdown-list-item(markdown-list-item-text("a"), paragraph("more")), markdown-list-item(markdown-list-item-text("b")))', '- a\n\n  more\n- b');
    });

    it('I4: the indent and outdent of a list item move it as before', () => {
        const editor = load('- a\n- b');

        select(editor, 'b', 1);
        lexicalOf(editor).dispatchCommand(INDENT_CONTENT_COMMAND, undefined);

        expect(editor.getValue()).toBe('- a\n  - b');

        lexicalOf(editor).dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);

        expect(editor.getValue()).toBe('- a\n- b');
    });
});

/** Pastes plain text at the selection, as Ctrl/Cmd+V does with a clipboard holding only text. */
function pasteText(editor: MarkdownEditor, text: string): void {
    const data: Record<string, string> = { 'text/plain': text };

    // `registerRichText`'s paste handler tells clipboard, drag, input and key events apart by class name.
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
    lexicalOf(editor).update(() => {
        lexicalOf(editor).dispatchCommand(PASTE_COMMAND, Object.assign(new ClipboardEvent('paste'), {
            clipboardData: { types: Object.keys(data), files: [], getData: (type: string) => data[type] ?? '' }, preventDefault: () => {},
        }));
    }, { discrete: true });
    vi.unstubAllGlobals();
}

describe('the editor shows what its save reloads to: whitespace at a line\'s start', () => {
    it('W1: a space typed at a paragraph\'s start stays until the next character, which takes its place', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');

        expect(shown(editor)).toBe('paragraph(" p0")');

        type(editor, 'x');

        expectShownAndReloaded(editor, 'paragraph("xp0")', 'xp0');

        type(editor, 'y');

        expect(shown(editor)).toBe('paragraph("xyp0")');
    });

    it('W2: spaces and a tab typed one after another stay together, and go together', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');
        type(editor, ' ');
        type(editor, '\t');

        expect(shown(editor)).toBe('paragraph("  \\tp0")');

        type(editor, 'x');

        expectShownAndReloaded(editor, 'paragraph("xp0")', 'xp0');
    });

    it.each([
        ['a heading', '# h0', 'h0', 'heading("xh0")', '# xh0'],
        ['a quote', '> q0', 'q0', 'quote("xq0")', '> xq0'],
        ['a list item', '- i0', 'i0', 'tight(markdown-list-item(markdown-list-item-text("xi0")))', '- xi0'],
        ['a task item, after its marker', '- [ ] t0', 't0', 'tight(markdown-list-item(markdown-list-item-text("[ ] ", "xt0")))', '- [ ] xt0'],
        ['a further paragraph of an item', '- a\n\n  m0', 'm0', 'loose(markdown-list-item(markdown-list-item-text("a"), paragraph("xm0")))', '- a\n\n  xm0'],
        ['a line after a hard break', 'a\\\nb0', 'b0', 'paragraph("a", linebreak, "xb0")', 'a\\\nxb0'],
        ['a line after a soft break', 'a\nb0', 'b0', 'paragraph("a", " ", "xb0")', 'a\nxb0'],
        ['a table cell', '| t0 |\n| --- |\n| c0 |', 'c0', 'table(tablerow(tablecell(paragraph("t0"))), tablerow(tablecell(paragraph("xc0"))))', '| t0 |\n| --- |\n| xc0 |'],
        ['a cell\'s second paragraph', '| t0 |\n| --- |\n| a\\n\\nc0 |', 'c0', 'table(tablerow(tablecell(paragraph("t0"))), tablerow(tablecell(paragraph("a"), paragraph("xc0"))))', '| t0 |\n| --- |\n| a\\n\\nxc0 |'],
    ])('W3: the same at the start of %s', (_name, source, text, expectedTree, expectedSave) => {
        const editor = load(source);

        select(editor, text, 0);
        type(editor, ' ');
        type(editor, 'x');

        expectShownAndReloaded(editor, expectedTree, expectedSave);
    });

    it.each([
        ['a code block', '```\nc0\n```', 'c0', 'code(" xc0")', '```\n xc0\n```'],
        ['a cell\'s line after a <br>', '| t0 |\n| --- |\n| a<br>c0 |', 'c0', 'table(tablerow(tablecell(paragraph("t0"))), tablerow(tablecell(paragraph("a", linebreak, " xc0"))))', '| t0 |\n| --- |\n| a<br> xc0 |'],
        ['the middle of a line', 'a0', 'a0', 'paragraph("a x0")', 'a x0'],
    ])('W4: whitespace the save keeps stays: %s', (_name, source, text, expectedTree, expectedSave) => {
        const editor = load(source);

        select(editor, text, text === 'a0' ? 1 : 0);
        type(editor, ' ');
        type(editor, 'x');

        expectShownAndReloaded(editor, expectedTree, expectedSave);
    });

    it('W5: a no-break space at a paragraph\'s start is no whitespace the save drops, and stays', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');
        type(editor, 'x');

        expectShownAndReloaded(editor, 'paragraph(" xp0")', ' xp0');
    });

    it('W6: the next character typed anywhere in the block takes the space away', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');
        select(editor, ' p0', -1);
        type(editor, 'y');

        expectShownAndReloaded(editor, 'paragraph("p0y")', 'p0y');
    });

    it('W7: a space an edit leaves at a line\'s start with the caret before it stays, and text typed there keeps it inside the line', () => {
        const editor = load('a b0');

        select(editor, 'a b0', 1);
        lexicalOf(editor).dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);

        expect(shown(editor)).toBe('paragraph("a") | paragraph(" b0")');

        type(editor, 'x');

        expectShownAndReloaded(editor, 'paragraph("a") | paragraph("x b0")', 'a\n\nx b0');
    });

    it('W11: text typed over a range from one block into another keeps the space after the range', () => {
        const editor = load('w2\n\nx y');

        select(editor, 'w2', 0, 'x y', 1);
        type(editor, 'z');

        expectShownAndReloaded(editor, 'paragraph("z y")', 'z y');
    });

    it('W12: a pasted line that opens with a tab loses it once the caret has passed it', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        pasteText(editor, '\tx');

        expectShownAndReloaded(editor, 'paragraph("xp0")', 'xp0');
    });

    it('W8: one undo after the space and the letter gives the document back', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');
        type(editor, 'x');

        expect(shown(editor)).toBe('paragraph("xp0")');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(shown(editor)).toBe('paragraph("p0")');
        expect(editor.getValue()).toBe('p0');
    });

    it('W9: while a text is being composed, its block keeps its whitespace; the end of the composition takes it away', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        type(editor, ' ');
        lexicalOf(editor).update(() => {
            const text = $getRoot().getAllTextNodes()[0]!;

            // A dead key or an input method starts a composition in the text, after the space.
            $setCompositionKey(text.getKey());
            text.spliceText(1, 0, '´', true);
        }, { discrete: true });

        expect(shown(editor)).toBe('paragraph(" ´p0")');

        lexicalOf(editor).update(() => {
            const text = $getRoot().getAllTextNodes()[0]!;

            $setCompositionKey(null);
            text.spliceText(1, 1, 'é', true);
        }, { discrete: true });

        expectShownAndReloaded(editor, 'paragraph("ép0")', 'ép0');
    });

    it('W10: a paste at a paragraph\'s start is taken as typing: a space alone stays, text after it takes it away', () => {
        const editor = load('p0');

        select(editor, 'p0', 0);
        pasteText(editor, ' ');

        expect(shown(editor)).toBe('paragraph(" p0")');

        pasteText(editor, 'x');

        expectShownAndReloaded(editor, 'paragraph("xp0")', 'xp0');
    });
});
```

---

## Notes

[^count]: An earlier draft of this plan measured the same set on `fef32344b`, the tip of `feature/markdown-editor-raw-block-edge-cases`: 197,571 steps, 33,030 differing. The probe compares each node's whole exported JSON, so it sees more than the looseness plan's own comparison, which counted 20,121 differing steps by node type, text and looseness; the further steps are differences in what a node records, mostly the marker a load records on a list. This draft re-ran the set on `f984cf5e7` with the looseness plan's prototype (`…/scratch-keep/plans3/large-doc/looseness-proto-v3.diff`, which applies to it unchanged).

[^r1]: `$keepLoosenessAfterTyping` exists because a keystroke marks only its text node, so no element rule runs for it. Its two cases are the two blocks of an item whose text decides whether they write: `$writesSomething` (markdownSerializer.ts L2493) answers by content for a paragraph and for a raw block, and `true` or by its save for every other block. A quote of an item was checked: with its text deleted it still writes `>`, so it needs no case. The raw block case costs what the paragraph case costs: one read of the item, and of the list only when the item changes the answer.

    The looseness plan left this defect out because that plan had to change no behaviour (its Non-Goals), and it pins the state in its row `L8`. After R1 the state of `L8` can still be made in code, by appending a raw block of whitespace and writing its text node directly, so `L8` keeps passing. A user reaches the state without code, in both directions: rows `L1` and `L3`.

[^r2-one-pattern]: The cell paragraph break is defined four times, once per module that reads or writes it, each copy with a comment naming the others. The `<br>` pattern is a regular expression with three spellings and a case flag, which is easier to let drift than a fixed four-character string, so it is defined once and imported. `markdownTableExtension.ts` is not re-exported from any entry point, so the constant is no public API; it imports no DOM, so the viewer's import-without-DOM test is unaffected.

[^r2-precedent]: Searched for: how the dialect gives a table cell a form a pipe row cannot hold. Found: the cell paragraph break, written by `serializeTableCell` and `writeBreak`, split by the viewer's `appendTextWithBreaks` under its `splitCellBreaks` flag, split by the importer's `appendTextToken` under `target.nextCellParagraph`, read by the serializer's `pushTextReading` under `context.inTableCell`, and read by the test view model under `context.inCell`. Each reader decides "in a cell" with its own flag, at the token it reads. R2 adds the `html` token beside the `text` token in the same four readers. A lexer-level alternative was considered: turning a cell's `html` `<br>` token into a `br` token after `marked` lexes, so every reader would see a hard break. It was rejected: `marked` fills a cell's inline tokens only after the whole document is lexed, so the change would need a pass over the finished token tree in each of the three lexing entry points, and the importer would record `<br>` as a hard break's marker, which a break cut out of the cell would then write outside it.

[^r2-enter]: GFM has no paragraph inside a cell; `\n\n` is this dialect's own form, and `markdown-editor-table-command-fixes` (decision B1, accepted by the owner) keeps it as the break a merged cell writes between the cells' paragraphs. Making Enter write `<br>` too would need the editor to hold a cell as one paragraph with line breaks, rewriting every paste, merge and block conversion that leaves paragraphs in a cell, and it would change the save of every cell an author made with Enter. With two forms, each round-trips as itself: the differential below shows no save that reloads differently. The cost is that two keys make breaks that look alike and are written differently, which only source mode shows.

[^r2-source]: Source mode is a `CodeEditor` holding the Markdown text, so it supports `<br>` by holding it; the viewer and the importer give it meaning. Its inline commands read the document's tokens (`markdownSourceTokens.ts`), where an `html` token is one inline that `respectsTokens` (markdownSourceEdits.ts) will not let a range cut into. Measured on the prototype: in `a<br>b`, bold and italic over the whole text wrap it, over a range that cuts into `<br>` or covers the tag alone they are declined, and after the tag they wrap the text after it. Its HTML highlighting needs nothing either: the built-in `"markdown"` language already parses inline HTML in a table row.

[^r2-reading]: The read-back check (`$readsBackAsShown`, `$runsReadingOtherwise`) lexes what the save writes and compares its reading with what the editor holds. A typed `<br>` text in a cell already reads as four characters and is escaped (`t\<br>1`, row `C7`); after R2 the check tells it apart from a line break, which reads as a break.

[^r3]: The serializer has written a line end inside a text as a break since `markdown-editor-serializer` (its note F1: "A newline inside a text node is a hard break… The importer never puts a newline in plain text"). So the save has been right, and only the node form differed. With the transform the break rules that already exist for line break nodes apply to these breaks too, and the differential shows that no save changes. A text kept as Markdown source (`MarkdownSourceTextNode`) is left alone: a soft line break is such a node, its source is a line end, and it shows a space.

[^r4]: `$handleIndentAndOutdent` calls its callback with the block each selected node stands in. For a list item that block is the item's text, whose `setIndent` moves the item; that part of the callback is unchanged, and it is what Lexical's own handler did for a selection the listener passed on. The only blocks that now go unmoved are those that are no item's text: for them `setIndent` set Lexical's element indent. An update that changes nothing makes no undo step, which row `I1` pins.

[^r4-reach]: `registerRichText`'s `KEY_TAB_COMMAND` handler returns `false` without sending an indent command, and nothing in `packages/lib/src` dispatches one; `markdown-editor-link-format-command-fixes` records the same in its addendum of routes. A paste of HTML whose paragraphs carry `padding-inline-start` or `data-lexical-indent` was tried headless and set no indent. The state is reached in the test set because the set dispatches the command itself.

[^r5]: The owner accepted "a space typed at the start of a block is removed when the next character is typed" against the earlier recommendation. The rule follows the run-edge rule's precedent (`registerRunEdgeRules`, `$tidyRuns`): a space typed after bold text shows plain until the next word, and a load is never tidied. A transform cannot tell a typed character from other edits (a browser may put a typed character in with no command, which `registerTypedTextMarks` in `MarkdownEditor.ts` only learns of in an update listener), so the rule asks where the caret is instead: whitespace the caret stands in, or at either end of, is being typed or typed before, and any other whitespace at a line's start is not. That makes it the same kind of rule as the break rules beside it, which also tidy what a deletion or a paste leaves, with no command marking the edit. The places a line starts mirror the save: `trimLineEdges` (markdownSerializer.ts L5218) drops the spaces and tabs at the start of each line a break or soft break begins, except before a source run on a later line; `serializeTableCell` trims a cell's text, and each paragraph of a cell is written through `trimLineEdges` too; a cell's line break is a piece inside its line, so whitespace after it is written. Measured per block with the prototype: a space, two spaces, four spaces and a tab are dropped by the save, and by a reload, in every place the table lists; a no-break space is kept everywhere outside a cell's start; a link's text, a code span, a code block and a cell's line after `<br>` keep their whitespace through a save and a load.

[^r5-composition]: Lexical marks the text being composed with its composition key (`TextNode.isComposing()`), and changing that text, or the text before it, under an active composition moves the input method's own range and breaks it. The transform therefore does nothing while any text of the block is composing. A dead key typed right after a typed space at a line's start starts a composition in that same text, after the space; when it ends, Lexical updates the text with the composed character and the composition key cleared, so the transform runs again and removes the space then. Row `W9` emulates both updates with `$setCompositionKey`; a real input method is manual check `M5`.

[^r5-nbsp]: `serializeTableCell` ends with `.trim()`, which takes every kind of whitespace off the cell's text, a no-break space (U+00A0) included, while `trimLineEdges` takes only spaces and tabs. Taking a no-break space off a cell's first line too would make the rule's notion of whitespace depend on the block; a no-break space at a cell's start is typed with an explicit key (Option+Space on macOS), and is left.

[^r5-block]: `registerRunEdgeRules` tidies a whole block after a command that can leave a format where its delimiter cannot stand, and after typing only the leaves at the caret (`$editedLeaves`), since nothing marks a typed character. R5 reads the block of the selection's anchor and focus for the same reason, and with it never reads a block a paste or a join only passed through. A block left with whitespace at a line's start and no caret in it keeps the whitespace until it is edited; the save drops it either way.

[^precedent]: Searched for: how the editor keeps a shape out that an edit can make and a save cannot hold. Found: `registerWritableStateRules` (markdownWritable.ts L79) and the registration functions it merges, one per kind of node, each a set of node transforms that rewrite the shape in the update that made it, so the change undoes with the edit. R1, R3 and R5 are such transforms. R4 is a command listener because the shape comes from one command, and the listener that owns that command for list items is already there; a transform that set the indent back would leave an undo step that changes nothing. R2 is no editor rule: a line break in a cell is a shape Markdown can hold once the dialect writes and reads `<br>`.

[^owners]: Checked against every unstarted Markdown plan in `plans/` at `f984cf5e7`: `markdown-editor-cross-item-range-removal`, `markdown-editor-heading-to-code-escapes`, `markdown-editor-large-document-costs`, `markdown-editor-link-format-command-fixes`, `markdown-editor-list-looseness-transform-cost`, `markdown-editor-raw-block-range-edits`, `markdown-editor-table-command-fixes`, `markdown-editor-typing-at-link-start-swallowed`, `markdown-named-character-references`, `markdown-source-mode-block-locator`, `markdown-source-mode-command-gaps`, `markdown-source-mode-list-lift-parity`, `markdown-source-mode-tab-highlighting`, `markdown-tab-column-parity` and `marked-upgrade`. None changes the editor's tree for any group, and none reads or writes `<br>` in a cell. Three name a group as out of their scope: the looseness plan (R1, its Non-Goals), the table command plan (how a cell's paragraphs are written, which R2 leaves), and the source mode list lift plan (the WYSIWYG surface's kept marker). The table command plan also adds the `\n\n` row to `Markdown.md`'s syntax table and two `\n\n` rows to the round-trip corpus; R2's rows go beside them, whichever lands first.

[^indent-undo]: In the set, an indent step on a block that is no list item changed the editor's state on the parent, so the history took it as a step. The set then undoes as many steps as it made edits. On the branch the same command changes nothing and makes no step, so the last undo takes back one edit more. The saves therefore differ from the first undo on, in 308 cases. Within those cases the counts of the other checks are compared and are equal.

[^changed-tests]: Each of the twelve states the old behaviour of a changed rule, and each was read: ten serializer and importer rows pin `\n\n` for a line break in a cell (R2); `W1` of the command crash file selects inside a text `a⏎b` that R3 no longer leaves; `T12` pins a tab kept at a pasted paragraph's start, which R5 now removes, as the save always did. With the edits, the prototype passed the whole suite.
