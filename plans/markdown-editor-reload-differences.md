---
depends-on: [markdown-editor-list-looseness-transform-cost, markdown-editor-large-document-costs]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Reload Differences — Implementation Plan

## Overview

`MarkdownEditor`'s WYSIWYG mode promises two things: the editor never holds a state Markdown cannot represent, and a save reloads to the same document. A test set of 33,480 edit sequences was run on `fef32344b`, the tip of `feature/markdown-editor-raw-block-edge-cases`, with the list looseness plan's code in place. After each of its 197,571 steps the editor's node tree was compared with the tree a load of its save builds. No save reloads to another save. The trees differ after 33,030 steps.[^count]

Every differing step was grouped by cause; the groups are in [What stays as it is](#what-stays-as-it-is--the-other-groups) and in *Addendum: the groups*. Most are not defects: states that exist only while the user types (an empty paragraph, a space at the end of a line), what a load records (the bullet a list was written with), and two ways of holding the same text. Four groups are defects that no other plan fixes. This plan fixes those four, each with one rule beside the existing rules of its kind:

| # | Defect | Rule | Lives in |
|---|---|---|---|
| R1 | Text typed into a raw block of a list item, or deleted from it, leaves the list's looseness as it was. The list is tight in the editor and its save reloads loose, or the other way round. | The typing rule for looseness reads a raw block as it reads a paragraph. | `$keepLoosenessAfterTyping`, [markdownWritable.ts:418](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L418) |
| R2 | Shift+Enter in a table cell leaves a line break inside the cell's paragraph. The save writes the cell break, which reloads as two paragraphs. | A line break in a cell's paragraph splits the paragraph, as Enter does. | `$keepCellParagraphs`, [markdownWritable.ts:647](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L647) |
| R3 | A code block set to a paragraph, heading, quote or list item keeps its line ends as characters of one text node. The save writes hard breaks, which reload as line break nodes. | A line end inside a text of such a block becomes a line break node. | `registerLineBreakRules`, [markdownWritable.ts:1481](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1481) |
| R4 | `INDENT_CONTENT_COMMAND` gives a paragraph, heading, quote, code block or raw block Lexical's own indent, which no save writes. | The editor's listener handles the command for every selection and moves list items only. | `$moveSelectedItemsOnce`, [MarkdownEditor.ts:3817](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3817) |

The changes are in `markdownWritable.ts` (three functions, one new function for R2 and one for R3) and `MarkdownEditor.ts` (one function). One new test file holds the rows. The docs page gets three sentences and the changelog four entries. No public API changes.

Line numbers are those of `fef32344b`. The plans in `depends-on`, and the two raw block plans they depend on, edit the same files in other functions, so find each site by its symbol name.

---

## Architecture Decisions

### R1 — the looseness typing rule reads a raw block too

`$keepLoosenessAfterTyping` runs for every text node that changes. It reads its item's looseness when the text stands in a block whose text decides whether the block writes anything: a paragraph of the item, or the item's text when blocks follow it. A raw block is such a block: a raw block holding whitespace alone writes nothing. The rule gets a third case, `$isMarkdownRawBlockNode(block)`.[^r1]

| Document | Edit | Editor today | Save | Reload | Editor after |
|---|---|---|---|---|---|
| `- a⏎⏎  <div>`, the raw block's text deleted and a space typed | `<p>` typed after the space | tight, raw block ` <p>` | `- a⏎⏎  <p>` | loose | loose |
| `- a⏎⏎  <div>`, a space typed at the raw block's end | `<div>` deleted, the space left | loose, raw block of one space | `- a` | tight | tight |

(`⏎` is a line end.)

### R2 — a line break in a table cell splits its paragraph

A table cell holds one kind of break, written `\n\n`. A load builds it as the boundary between two paragraphs of the cell, and Enter in a cell makes two paragraphs. Shift+Enter leaves a line break node inside one paragraph, which the save writes as the same `\n\n`. `$keepCellParagraphs` gets one more job: a paragraph of the cell that holds a line break is split at it, by the new `$splitAtLineBreaks`.[^r2]

| Cell | Edit | Editor today | Save | Reload | Editor after |
|---|---|---|---|---|---|
| `t1` | Shift+Enter between `t` and `1` | one paragraph: `t`, line break, `1` | `t\n\n1` | two paragraphs `t`, `1` | two paragraphs `t`, `1` |
| `t1` | Shift+Enter at its end, then `y` | one paragraph: `t1`, line break, `y` | `t1\n\ny` | two paragraphs `t1`, `y` | two paragraphs `t1`, `y` |

A caret that stood after the line break stands at the start of the new paragraph, so typing goes on where it did.

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

### Each rule stands beside the rules of its kind

`markdownWritable.ts` already keeps each shape Markdown cannot hold out of the editor with a rule next to the rules for the same node: the looseness rules in `registerMarkdownListTransforms`, the cell rules in `registerTableRules` (`$keepCellParagraphs`), the break rules in `registerLineBreakRules`. R1, R2 and R3 extend those three. R4 extends the listener that already owns the command. No new registration function and no new seam is added.[^precedent]

### What stays as it is — the other groups

The other groups are left alone. Each is one of three things: an artefact of comparing trees, a state that exists while the user edits and that the save cannot hold, or a decision an implemented plan recorded. The counts are steps of the set in which the cause takes part.

| Group | Steps | What differs | Verdict |
|---|---|---|---|
| marker as loaded | 8,259 | a load records the bullet or delimiter a list was written with, where it is the one an editor-made list writes anyway | artefact: nothing shown, nothing saved differs |
| marker written by rule | 1,948 | a save writes a nested list with `*` to keep it apart from what is next to it; a load records `*` as the list's own | artefact; documented save rule |
| cached text format | 1,268 | Lexical's cache of a block's text format | artefact |
| code block line ends | 1,371 | Enter in a code block makes a line break node; a load builds one text holding line ends | two forms of the same text, both shown and saved alike |
| empty paragraph | 6,795 | a paragraph with no content (after Enter, or after a pasted list or table) | editing state: the save writes nothing for it |
| empty item text | 631 | an item's empty text line before another block of the item | editing state, documented |
| emptied raw block | 245 | a raw block whose text was deleted | editing state, documented |
| whitespace at a line's edge | 7,248 | a space typed at the start or end of a block's line, or (203 steps) after a task marker | editing state: the save drops it |
| soft line break at an edge | 162 | a soft break first or last in its block, or spaces after it | the same |
| raw block edges | 181 | an empty first or last line, or spaces before the first line, of an edited raw block | the same, documented |
| task marker kept as source | 6,921 | a `[ ]` marker that no longer opens a list item stays an atomic run; the save writes `\[ \]`, which reloads as text | recorded Non-Goal of `markdown-list-toggle-task-item-parity`; see the sign-offs |
| inline HTML kept as source | 13 | an HTML tag that comes to open a list item's paragraph is saved escaped and reloads as text | the same kind; see the sign-offs |
| emptied table | 153 | a table with no row | made only by the test set's own `clear()`; no command leaves one |

No other unstarted plan fixes any group of this table or any of R1 to R4.[^owners]

### The rows go in a new test file

The rows compare the editor's tree with the tree of a load of its save, for one document and a few steps each. They go in `tests/component/markdown-editor-reload-differences.test.ts`, a file no other plan edits. The whole file is in *Addendum: the test file*. It was run as printed: 10 rows fail and 4 pass before the change, and all 14 pass after it.

### Decisions that await the user's sign-off

Each of the four rules changes what the editor holds, so each needs a yes. The plan is written for the recommended answer.

| # | Decision | Recommended | In this plan |
|---|---|---|---|
| 1 | R1: a list turns loose, or tight, the moment text typed in a raw block of its item makes that block write something, or nothing. | yes: the editor then shows the list as every reload does | yes |
| 2 | R2: Shift+Enter in a table cell makes a new paragraph of the cell, as Enter does. | yes: a cell has one kind of break | yes |
| 3 | R3: the line ends of a code block made into another block become line breaks at once. Nothing shown changes. | yes | yes |
| 4 | R4: the indent command leaves every block that is no list item alone. No key sends the command today. | yes | yes |
| 5 | A task marker that no longer opens a list item becomes plain text in the editor at once, as its save already writes it. Today a bulleted toggle off and on again gives the task item back; with this change it would give an item holding the text `[ ]`. | no: the implemented plan chose to leave it, and the round trip is worth more than the node kind | no |
| 6 | A space typed at the start of a block is removed when the next character is typed. | no: the editor would take back what was just typed | no |

---

## Internal Structure

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

### `markdownWritable.ts` — R2

In `$keepCellParagraphs`, call `$splitAtLineBreaks` for a paragraph of text, before the `continue`:

```typescript
    for (const child of cell.getChildren()) {
        const isTextParagraph = $isParagraphNode(child) && !child.getChildren().some($isBlock);
        const isBlockToWrite = !isTextParagraph && $isElementNode(child);

        if (isTextParagraph) {
            $splitAtLineBreaks(child);
        }

        if (!isBlockToWrite) {
            continue;
        }
```

Add the new function directly before `$cellLines`:

```typescript
/**
 * Splits a paragraph of a table cell at each line break it holds: the text
 * after a break goes to a paragraph of its own after it, and the break
 * goes. A cell holds one kind of break, written `\\n\\n`, which a load builds
 * as the boundary between two paragraphs of the cell; a line break put into
 * a cell's paragraph (Shift+Enter, pasted text) is saved as that break, so
 * the editor shows it as a load of its save does, and as Enter leaves it. A
 * caret that stood after a break stands at the start of the new paragraph.
 *
 * @param paragraph - A paragraph of a table cell, holding inline nodes only.
 */
function $splitAtLineBreaks(paragraph: ElementNode): void {
    let rest = paragraph;
    let lineBreak = rest.getChildren().find($isLineBreakNode);

    while (lineBreak !== undefined) {
        const index = lineBreak.getIndexWithinParent();
        const next = $createParagraphNode();
        const selection = $getSelection();
        const points = $isRangeSelection(selection) ? [selection.anchor, selection.focus] : [];
        const restKey = rest.getKey();
        const after = points.filter((point) => point.type === "element" && point.key === restKey && point.offset > index);
        const offsets = after.map((point) => point.offset - index - 1);

        rest.insertAfter(next, false);
        next.splice(0, 0, lineBreak.getNextSiblings());
        lineBreak.remove();
        after.forEach((point, at) => point.set(next.getKey(), offsets[at]!, "element"));
        rest = next;
        lineBreak = rest.getChildren().find($isLineBreakNode);
    }
}
```

Add one sentence to the JSDoc of `$keepCellParagraphs`: "A paragraph of text holding a line break is split at it ({@link $splitAtLineBreaks})."

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

---

## Ordered Implementation Steps

1. **Check the base.** Both plans in `depends-on` are in `plans/implemented/`. From the repository root: `grep -n 'function \$keepLoosenessAfterTyping\|function \$keepLoosenessThroughItem\|function \$keepCellParagraphs\|function \$cellLines\|function registerLineBreakRules\|function \$declinesLineBreak' packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` — expect six matches. `grep -n 'function \$moveSelectedItemsOnce' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — expect one. If `$keepLoosenessAfterTyping` does not end in `$keepLoosenessThroughItem(list, item)`, the looseness plan is not in: stop.
2. **Add the test file.** Create `packages/lib/tests/component/markdown-editor-reload-differences.test.ts` with the content of *Addendum: the test file*, unchanged.
3. **See it fail.** From `packages/lib`: `npx vitest run tests/component/markdown-editor-reload-differences.test.ts`. Expect 10 failed and 4 passed: `L1`, `L2`, `L3`, `C1`, `C2`, `N1`, `N2`, `I1`, `I2`, `I3` fail; `L4`, `C3`, `N3`, `I4` pass. Any other split means the base differs from what this plan measured; stop and report it.
4. **R1.** Edit `$keepLoosenessAfterTyping` as in *Internal Structure*. Check: rows `L1` to `L4` pass.
5. **R2.** Edit `$keepCellParagraphs` and add `$splitAtLineBreaks`. Check: rows `C1` to `C3` pass.
6. **R3.** Add the import, the registration and `$keepLineEndsOutOfText`. Check: rows `N1` to `N3` pass.
7. **R4.** Edit `$moveSelectedItemsOnce`. Check: rows `I1` to `I4` pass, so all 14 rows pass.
8. **Static checks.** From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint` — all clean.
9. **Full suite.** `npm test` — every test passes, 14 more than at the base. A test that fails on a table cell's line break, on a code block made into another block, or on an indented block states the old behaviour: report it with its row before changing it.
10. **Commit the code** (the `commit` skill), one commit per rule, so the differential of step 11 can copy the tree with `git archive`.
11. **Run the differential** as in `## Verification`, *The reload differential*. It must end with `HARD CHECKS AT ZERO`. If it does not, stop and report the first line that is not zero.
12. **Docs and changelog.** Apply `## Documentation Impact`.
13. **Docs and build checks.** From `packages/lib`: `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.
14. **Manual checks** of `## Expected Behaviour`, *Manual checks*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create | `packages/lib/tests/component/markdown-editor-reload-differences.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows are unit tests in `markdown-editor-reload-differences.test.ts`. A tree is written as the test file's `tree` helper prints it: each list as `tight(…)` or `loose(…)`, each text in quotes, `[indented]` after a block that carries an element indent. Unless a row says otherwise, it checks the tree, the save, and that a load of the save shows the same tree.

### Rows that fail before the change

| Row | Document | Steps | Tree after | Save after |
|---|---|---|---|---|
| L1 | `- a⏎⏎  <div>` | select the raw block's text, delete, type a space; then type `<p>` after the space | after the space: `tight(…, markdown-raw-block(" "))`; after `<p>`: `loose(…, markdown-raw-block(" <p>"))` | `- a⏎⏎  <p>`, which reloads loose |
| L2 | `- a⏎- b⏎- c` | a raw block of one space appended to item `a` in code; `<div>` typed after the space | `loose(…)` | `- a⏎⏎  <div>⏎⏎- b⏎⏎- c` |
| L3 | `- a⏎⏎  <div>` | a space typed at the raw block's end; `<div>` selected and deleted | `tight(…, markdown-raw-block(" "))` | `- a`, which reloads as a tight list of one item |
| C1 | `\| t0 \|⏎\| --- \|⏎\| t1 \|` | Shift+Enter between `t` and `1` | second cell: `paragraph("t"), paragraph("1")` | `…\| t\n\n1 \|` |
| C2 | the same | Shift+Enter at the end of `t1`; `y` typed; then two undos | `paragraph("t1"), paragraph("y")`; after the undos the save is the document | `…\| t1\n\ny \|` |
| N1 | a code block of the lines `a`, `b` | `setBlockType("paragraph")` | `paragraph("a", linebreak, "b")` | `a\⏎b` |
| N2 | the same | the bulleted toggle | `tight(markdown-list-item(markdown-list-item-text("a", linebreak, "b")))` | `- a\⏎  b` |
| I1 | `p0⏎⏎p1` | `x` typed in `p1`; the indent command; then one undo | `paragraph("p0") \| paragraph("px1")`, no `[indented]`; the undo takes back the `x` | `p0⏎⏎px1`, then `p0⏎⏎p1` |
| I2 | `- a⏎- b⏎⏎p0` | a range from `b` into `p0`; the indent command; then one undo | `b` is an item of a list nested in item `a`; `paragraph("p0")` without `[indented]` | `- a⏎  - b⏎⏎p0`, then the document |
| I3 | `- a⏎⏎  more⏎- b` | caret in `more`; the indent command | `paragraph("more")` without `[indented]` | the document |

### Controls that pass before and after

| Row | Document | Steps | Expected |
|---|---|---|---|
| L4 | `- a⏎⏎  <div>⏎- b` | `x` typed at the end of the raw block | the list stays loose; save `- a⏎⏎  <div>x⏎⏎- b` |
| C3 | `ab` | Shift+Enter between `a` and `b` | `paragraph("a", linebreak, "b")`; save `a\⏎b` |
| N3 | a code block of the lines `a`, `b` | `x` typed after `a` | one text `ax⏎b` in the code block; save keeps the fence |
| I4 | `- a⏎- b` | caret in `b`; indent, then outdent | saves `- a⏎  - b`, then `- a⏎- b` |

### Manual checks — need manual verification

In the demo's MD Editor page (`npx vite` in `packages/lib`), in WYSIWYG mode:

- **M1 (R2).** Put the caret inside a table cell and press Shift+Enter, then type. The text goes on a new line of the same cell; Backspace at its start joins the two lines; the source shows `\n\n` in the cell. No console message.
- **M2 (R1).** Load `- a⏎⏎  <div>` through source mode. Select `<div>` and delete it, type a space, then type `<p>`. Switch to source mode: it reads `- a`, an empty line, and `<p>` indented by two spaces.
- **M3 (R3).** Make a code block of two lines, put the caret in it and choose the paragraph block type. The two lines show as before; the arrow keys move between them.

---

## Verification

From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm test`, `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.

### The reload differential

The four rules add writes to transforms that run on every keystroke, so a wrong one corrupts documents without any error. The check runs the looseness plan's set on a private copy of the parent and of the branch, records for every step the editor's whole tree and the tree a load of its save builds, and compares.

The scripts are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/large-doc/` (called `$K` below); `README.md` there describes each.

```bash
K=~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/large-doc
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
| an unedited block saved differently | steps whose save differs between the two runs, outside the cases that hold an indent step | 0 |
| a second undo step | cases where undoing every edit does not give the loaded document back | 0 |
| a throw | errors other than the key emulation the test DOM lacks | 0 |

A case that holds an indent step is compared for its counts only. The indent command made an undo step on a paragraph before and makes none now, so the two runs undo other edits from that step on.[^indent-undo]

Then print the groups of the branch: `python3 $K/reload/rich.py $K/reload/data-branch`. Expect the *by cause* list of *Addendum: the groups* without `indent`, `cellbreak` and `textnewline`, and every other count within a few steps of its number there.

---

## Documentation Impact

No exported symbol changes. In `packages/lib/docs/components/MarkdownEditor.md`:

- In the **Line breaks** bullet (line 90), replace the last sentence "A table cell keeps every break: its cell break shows anywhere." by: "A table cell keeps every break: its cell break shows anywhere, as the boundary between two lines of the cell, and Shift+Enter in a cell starts a new line of it as Enter does. A code block's lines, when it becomes a paragraph, a quote or a list item, are kept by line breaks."
- In the **Lists** bullet (line 95), after the sentence that begins "A list's looseness follows what its save reads as", add: "Text typed into a raw Markdown block of an item, or deleted from it, counts as it does in a paragraph: a raw block holding only spaces is no block of its item."

Add four entries at the end of `## Fixed` → `### Components` in `packages/lib/docs/reference/changelog/next.md`:

> **`MarkdownEditor`: a list's looseness follows text typed in a raw block of its item.** A raw Markdown block that held only spaces, and so wrote nothing, could come to hold text while its list stayed tight in the editor and loaded loose from the save; and the other way round. The list now turns loose or tight with the keystroke.
>
> **`MarkdownEditor`: Shift+Enter in a table cell starts a new line of the cell as Enter does.** It left a line break inside the cell's paragraph, which was saved as the cell break and loaded as two paragraphs. The save is unchanged.
>
> **`MarkdownEditor`: a code block made into a paragraph, a heading, a quote or a list item holds line breaks.** Its text kept the line ends as characters of one text. What is shown and saved is unchanged.
>
> **`MarkdownEditor`: the indent command leaves a block that is no list item alone.** `INDENT_CONTENT_COMMAND` gave a paragraph, a heading, a quote, a code block or a raw block an indent that was drawn and never saved, and added an undo step. No key or method of the editor sends the command.

---

## Potential Challenges

- **Line numbers have moved.** Four plans edit these files first. Locate every function by name; step 1's greps confirm the shape.
- **`$splitAtLineBreaks` must not use `insertAfter`'s selection handling.** It passes `false`, and moves the element points itself: Lexical's own handling would count the new paragraph in a point on the cell. Keep the `false`.
- **The order of the two `TextNode` registrations in `registerLineBreakRules` matters.** `$keepLineEndsOutOfText` must come first, so the break rule after it drops a break that is now a node at a block's end. Rows `N1` and `N2` pass either way; the differential's `textnewline` line does not.
- **`splitText` drops empty pieces.** A text that starts or ends with a line end gives no empty text node; the loop only looks at pieces that are a line end. Do not index the pieces by position.
- **Row `I1` needs the typed `x`.** Without an edit before it, an undo has nothing to take back, and the row could not tell "no undo step" from "one empty undo step".
- **The differential needs memory.** Each of its 12 jobs holds a document set in memory; at two jobs a side took about 20 minutes on a busy machine. Run the two sides one after the other.

---

## Critical Files

- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts): `registerMarkdownListTransforms` (L362) and `$keepLoosenessAfterTyping` (L418), the precedent and the site of R1; `registerTableRules` (L618), `$keepCellParagraphs` (L647), `$cellLines` (L673), for R2; `registerLineBreakRules` (L1481), `$isBreakRuleContainer` (L1565), `$findEnclosingBlock` (L1594), for R3; `$keepBlocksOutOfText` (L108), which calls `$keepCellParagraphs` for a changed paragraph of a cell.
- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `$moveSelectedItemsOnce` (L3817), `registerListItemRules` (L3895).
- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts): `writeBreak` (L4577), which writes a cell's break; `textNodeSegments` (L3297), which writes a line end in a text as a break; `$writesSomething` (L2493), which says a raw block of whitespace writes nothing.
- `plans/markdown-editor-list-looseness-transform-cost.md`: `$keepLoosenessThroughItem`, and row `L8`, which starts from the state R1 removes.
- `plans/implemented/markdown-list-toggle-task-item-parity.md`, Non-Goals: the kept task marker (sign-off 5).

---

## Non-Goals

- **The task marker kept as source, and inline HTML kept as source at an item's start.** Sign-off 5. Turning the run into text the moment it stops being a marker would end the round trip of a list toggle off and on.
- **States of editing.** An empty paragraph, an empty item text, an emptied raw block, and whitespace at the edge of a line or of a raw block exist because the user is typing there. A save drops them, and a load does not bring them back.
- **What a load records.** The bullet or delimiter a list was written with, and a code block's lines as one text.
- **The title of an indented definition.** The one record left in the list-edit fuzz. It is sign-off 4 of `markdown-editor-raw-block-edge-cases`, and no unstarted plan changes it.
- **The 88 records of the reviewer 7 fuzz.** None is a defect of the editor; see *Addendum: the fuzz records*.
- **Binding a key to the indent command.** R4 only keeps the command from making a state no save holds.

---

## Addendum: the groups

Measured on a private copy of `fef32344b` with the looseness plan's prototype applied, on `marked` 18.0.9. The set is the looseness plan's: 44 documents with 29 edits at every caret, 13 over every short range, joins and pairs of edits, then 4 × 1,800 random runs, each edit then undone and redone. The probe (`$K/probes/zz-ld-reload.test.ts`) records each node's exported JSON, so it sees more than the looseness plan's own comparison did: 33,030 differing steps where that one saw 20,121.

A step can have several causes. "Part of" counts the steps a cause takes part in; "alone" those it explains by itself.

| Cause (name in `rich.py`) | Part of | Alone | Group in this plan |
|---|---|---|---|
| `marker` | 8,259 | 7,001 | marker as loaded |
| `edgespace` | 7,248 | 3,541 | whitespace at a line's edge |
| `tasksource` | 6,921 | 3,566 | task marker kept as source |
| `emptyblock` | 6,795 | 5,251 | empty paragraph |
| `indent` | 4,070 | 3,175 | **R4** |
| `anymarker` | 1,948 | 1,232 | marker written by rule |
| `codebreaks` | 1,371 | 1,099 | code block line ends |
| `none` | 1,268 | 1,268 | cached text format |
| `emptyitemtext` | 631 | 448 | empty item text |
| `emptyraw` | 245 | 160 | emptied raw block |
| `innerspace` | 203 | 0 | whitespace at a line's edge (a space typed after a task marker) |
| `softedge`, and 6 steps the script leaves unexplained | 162 | 104 | soft line break at an edge |
| `emptytable` | 153 | 103 | emptied table |
| `rawedges`, `rawmargin` | 181 | 76 | raw block edges |
| `cellbreak` | 144 | 105 | **R2** |
| `looseness` | 23 | 0 | follows from an emptied table: its item reads as two blocks |
| `htmlsource` | 13 | 13 | inline HTML kept as source |
| `textnewline` | 2 | 2 | **R3** |

No step differs in a list's looseness alone.

Each group, with the smallest case found:

| Group | Document and steps | Editor holds | Save | Reload holds |
|---|---|---|---|---|
| marker as loaded | `p0`; the bulleted toggle | a list with no recorded marker | `- p0` | a list whose marker is recorded as `-` |
| marker written by rule | `- a0⏎⏎  - n0⏎  - n1`; Enter at the start of `n0` | nested list, marker `-` | `- a0⏎⏎  *⏎  * n0⏎  * n1` | nested list, marker `*` |
| code block line ends | `- a0⏎⏎  ```⏎  c0⏎  ```⏎- a1`; Enter inside `c0` | code: `c`, line break, `0` | the two lines in the fence | code: one text `c⏎0` |
| empty paragraph | `p0`; Enter at its end | `p0`, an empty paragraph | `p0` | `p0` |
| empty item text | `- a0⏎-⏎- a2`; the indent command on `a2` | item 2: an empty text, then a nested list | `- a0⏎- - a2` | item 2: the nested list alone |
| emptied raw block | `p⏎⏎<div>⏎⏎q`; select `<div>`, delete | `p`, an empty raw block, `q` | `p⏎⏎q` | `p`, `q` |
| whitespace at a line's edge | `p0`; a space typed at its start | ` p0` | `p0` | `p0` |
| soft line break at an edge | a paragraph whose second line starts with two spaces after an edit joins it | `…`, soft break, `  c0` | the second line at the margin | `…`, soft break, `c0` |
| raw block edges | `- a0⏎⏎  [r]: /u⏎- a1`; a space typed at the raw block's start | ` [r]: /u` | unchanged | `[r]: /u` |
| task marker kept as source | `- [ ] w0`; `setBlockType("quote")` | quote: source run `[ ] `, text `w0` | `> \[ \] w0` | quote: text `[ ] w0` |
| inline HTML kept as source | a paste that leaves `</div>` alone in a paragraph of an item | source run `</div>` | `\</div>` | text `</div>` |
| emptied table | a table of an item cleared by the set's own `clear()` | a table with no row | nothing | no table |

The four defects are rows `L1` and `L3` (R1, which the set does not reach), `C1` (R2, `cellbreak`), `N2` (R3, `textnewline`) and `I1` (R4, `indent`) of `## Expected Behaviour`.

The looseness plan's planner saw one defect and 20,121 differing steps. The defect is R1. It is still there on this tip, and typing in another item does not heal it: only a change of an item's blocks or of its checkbox does. The 20,121 steps are the groups above as far as that plan's plainer trees could see them; its example, "a typed leading space that the save drops", is the group *whitespace at a line's edge*.

**Result of the prototype.** The four rules applied to the same copy (`$K/applyR.py`, the code of *Internal Structure*): `cmpreload.py` ends with `HARD CHECKS AT ZERO`.

| Check | Parent | Prototype |
|---|---|---|
| steps compared | 197,571 | 197,571 |
| steps differing by `indent` | 4,070 | 0 |
| steps differing by `cellbreak` | 144 | 0 |
| steps differing by `textnewline` | 2 | 0 |
| steps that reload as shown on the parent and not on the prototype, outside the indent cases | — | 0 |
| saves that differ between the two, outside the indent cases | — | 0 |
| saves that differ, in the cases that hold an indent step | — | 827, in 303 cases, the first always at an undo or redo |
| cases whose undos do not give the document back | 0 | 0 |
| throws | 0 | 0 |
| saves whose reload saves differently | 0 | 0 |

The code was also applied on top of `markdown-editor-large-document-costs`' code: it typechecks, lints clean, and the 14 rows and that plan's 28 rows pass.

---

## Addendum: the fuzz records

The seeded fuzz of `…/scratch-keep/impl/raw-block-edge-cases/` leaves 1 list-edit record and 88 reviewer 7 records at this tip. All were read, not sampled.

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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    $createRangeSelection, $getRoot, $getState, $isElementNode, $isTextNode, $setSelection, CONTROLLED_TEXT_INSERTION_COMMAND, DELETE_CHARACTER_COMMAND,
    INDENT_CONTENT_COMMAND, INSERT_LINE_BREAK_COMMAND, OUTDENT_CONTENT_COMMAND, UNDO_COMMAND,
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

    it('C1: Shift+Enter inside a cell splits its paragraph, as Enter does', () => {
        const editor = load(TABLE);

        select(editor, 't1', 1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

        expectShownAndReloaded(editor, cells('paragraph("t")', 'paragraph("1")'), '| t0 |\n| --- |\n| t\\n\\n1 |');
    });

    it('C2: text typed after Shift+Enter at a cell\'s end goes into the new paragraph, and two undos give the cell back', () => {
        const editor = load(TABLE);

        select(editor, 't1', -1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
        type(editor, 'y');

        expectShownAndReloaded(editor, cells('paragraph("t1")', 'paragraph("y")'), '| t0 |\n| --- |\n| t1\\n\\ny |');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(TABLE);
    });

    it('C3: Shift+Enter in a paragraph outside a table still makes a line break', () => {
        const editor = load('ab');

        select(editor, 'ab', 1);
        lexicalOf(editor).dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

        expectShownAndReloaded(editor, 'paragraph("a", linebreak, "b")', 'a\\\nb');
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
```

---

## Notes

[^count]: The looseness plan's planner counted 20,121 differing steps on the same set. The probe used here compares each node's whole exported JSON, where that planner's compared each node's type and text and each list's looseness. The 12,909 further steps are differences in what a node records, mostly the marker a load records on a list. The set, the documents and the seeds are the same, and so is the tip: 3 of the 33,480 cases give other records at this tip than at `75d022ba1`.

[^r1]: `$keepLoosenessAfterTyping` exists because a keystroke marks only its text node, so no element rule runs for it. Its two cases are the two blocks of an item whose text decides whether they write: `$writesSomething` (markdownSerializer.ts L2493) answers by content for a paragraph and for a raw block, and `true` or by its save for every other block. A quote of an item was checked: with its text deleted it still writes `>`, so it needs no case. The raw block case costs what the paragraph case costs: one read of the item, and of the list only when the item changes the answer.

    The looseness plan left this defect out because that plan had to change no behaviour (its Non-Goals), and it pins the state in its row `L8`. After R1 the state of `L8` can still be made in code, by appending a raw block of whitespace and writing its text node directly, so `L8` keeps passing. A user reaches the state without code, in both directions: rows `L1` and `L3`.

[^r2]: The cell break is the dialect's only break in a cell: `writeBreak` (markdownSerializer.ts L4577) writes every break of a cell as `\n\n`, and the importer splits a cell's text on it into paragraphs. `$isBreakRuleContainer` (markdownWritable.ts L1565) leaves cell paragraphs out of the break rules for that reason: a cell keeps every break. So a line break node in a cell's paragraph and a boundary between two of its paragraphs are one thing held in two forms, and a load always builds the second.

    The rule is in `$keepCellParagraphs` and not in the Shift+Enter command, so it also covers a break that comes into a cell another way, such as pasted text. `$keepBlocksOutOfText` (L108) already calls `$keepCellParagraphs` whenever a paragraph of a cell changes, so no new registration is needed.

    **Rejected: make the importer build a line break node.** That would change what every load builds for every table, and Enter would still make two paragraphs. `markdown-editor-table-command-fixes` names "changing how a cell break is written" a Non-Goal; this rule changes neither the writing nor the reading.

[^r3]: The serializer has written a line end inside a text as a break since `markdown-editor-serializer` (its note F1: "A newline inside a text node is a hard break… The importer never puts a newline in plain text"). So the save has been right, and only the node form differed. With the transform the break rules that already exist for line break nodes apply to these breaks too, and the differential shows that no save changes.

    A text kept as Markdown source (`MarkdownSourceTextNode`) is left alone: a soft line break is such a node, its source is a line end, and it shows a space.

[^r4]: `$handleIndentAndOutdent` calls its callback with the block each selected node stands in. For a list item that block is the item's text, whose `setIndent` moves the item; that part of the callback is unchanged, and it is what Lexical's own handler did for a selection the listener passed on. The only blocks that now go unmoved are those that are no item's text: for them `setIndent` set Lexical's element indent.

    An update that changes nothing makes no undo step, which row `I1` pins.

[^r4-reach]: `registerRichText`'s `KEY_TAB_COMMAND` handler returns `false` without sending an indent command, and nothing in `packages/lib/src` dispatches one; `markdown-editor-link-format-command-fixes` records the same in its addendum of routes. A paste of HTML whose paragraphs carry `padding-inline-start` or `data-lexical-indent` was tried headless and set no indent. The state is reached in the test set because the set dispatches the command itself: 4,070 of its steps.

[^precedent]: Searched for: how the editor keeps a shape out that an edit can make and a save cannot hold. Found: `registerWritableStateRules` (markdownWritable.ts L79) and the registration functions it merges, one per kind of node, each a set of node transforms that rewrite the shape in the update that made it, so the change undoes with the edit. R1 to R3 are such transforms. R4 is a command listener because the shape comes from one command, and the listener that owns that command for list items is already there; a transform that set the indent back would leave an undo step that changes nothing.

[^owners]: Checked against every unstarted Markdown plan in `plans/`: `markdown-editor-raw-block-range-edits`, `markdown-editor-cross-item-range-removal`, `markdown-editor-table-command-fixes`, `markdown-editor-link-format-command-fixes`, `markdown-editor-readonly-keyboard-selection`, `markdown-editor-list-looseness-transform-cost`, `markdown-language-readonly-and-fences`, `markdown-source-mode-block-locator`, `markdown-source-mode-list-lift-parity`, `markdown-tab-column-parity`, `marked-upgrade`, `marked-version-pin-or-upgrade`, `markdown-source-mode-command-gaps` (source mode's line commands only) and `markdown-raw-block-html-tail-parity` (where the lexer ends an HTML block). None changes the editor's tree for any group. Three name a group as out of their scope: the looseness plan (R1, its Non-Goals), the table command plan (how a cell break is written), and the source mode list lift plan (the WYSIWYG surface's kept marker).

[^indent-undo]: In the set, an indent step on a block that is no list item changed the editor's state on the parent, so the history took it as a step. The set then undoes as many steps as it made edits. On the branch the same command changes nothing and makes no step, so the last undo takes back one edit more. The saves therefore differ from the first undo on, in 303 cases. Within those cases the counts of the other checks are compared and are equal.
