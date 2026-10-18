---
depends-on: [markdown-editor-quote-node]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceModel.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/tests/component/markdown-source-mode-through-model.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/tests/component/markdown-editor-reload-differences.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Four Known-Issue Fixes — Implementation Plan

## Overview

Four defects from the known-issues list, each reproduced on the chain's tip `feature/markdown-editor-quote-node` (`f80f4e07b`) before this plan was written:

| Defect | On the tip | What this plan does |
|---|---|---|
| **The list-toggle freeze.** `toggleUnorderedList()` in source mode on `"\n\n 1.\t</pre>\n \t  >\t#\th\n"`, caret at 7, ran for over 100 s. | Does not reproduce. The command declines in about 30 ms (the caret is in a raw HTML block) and row 5.21 already pins that. | Fixes the line-start helper the loop rested on, which still names the wrong line at offset 0, and widens 5.21 to every source-mode command at every offset. |
| **A heading or code block after a join.** A selection from a raw Markdown block into a later block, deleted or typed over, leaves text that reads as a heading or a code block. | The Delete sample (`- a` / `  - b` / `    > q` / `  - c`, then `after`) and the tab sample (`***` / (blank) / `x`, a tab, `# y`) reproduce. The typing sample (`***` / (blank) / `- x # y`) does not: it gives `Z # y`. | Fixes the class in the one join every route goes through, and adds a sweep of every such range. |
| **The lone backslash.** A code block with an empty line, set to a paragraph, saves `\` on the empty line. | Reproduces: `a\` / `\` / `b`. It reloads as the same document. | Decides that the `\` is the line break of the empty line, as two Shift+Enters save it. Docs and tests only. |
| **The blank line of a loose list.** In source mode, the caret on the blank line between `- a` and `- b`, heading 2 gives `- a` / (blank) / `## b`. | Reproduces, and in a list item's blocks, a quote's blocks and a `:::` column's blocks too. Source-mode `insertTable` on such a line inside a list or quote splits it. | A blank line between the blocks of a container names no block: the command does nothing there. |

The changes are in `MarkdownEditor.ts` (the join), `markdownSerializer.ts` (one new export), `markdownSourcePlaces.ts` and `markdownSourceModel.ts` (where a source offset is placed), and `markdownSourceLines.ts` (the table insert and the line-start helper). Four test files get rows; `MarkdownEditor.md`, the changelog and the known-issues list get edits. No public API changes. Line numbers are those of `f80f4e07b`.

Every fix below was prototyped on a private copy of the tip (`…/scratch-keep/plans6/four-fixes/proto/`, diff in `prototype.diff`; the prototype's helper names differ, and the names in this plan are the ones to use). With it, the 51 Markdown test files (14,127 tests) pass unchanged, the type check is clean, and the measurements in `## Addendum: Measurements` hold.

---

## Architecture Decisions

### The freeze is gone with the code that had it; the helper it rested on is fixed

The freeze was in `nearestTextLine`, part of the source-mode list text surgery that `markdown-source-mode-commands-through-model` deleted (`fe498e8dc`). Its loop stepped up a line with `lineStartAt(text, at - 1)`. In a text that opens with a newline, `lineStartAt(text, 0)` returns 1, not 0: `text.lastIndexOf("\n", -1)` finds the newline at index 0. So from line 1 the step never moved.[^freeze-cause]

The same `lineStartAt` survives in [markdownSourceLines.ts:248](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L248), used by `tableSource` and `paragraphAroundBlockSource`. Their loops only move forward, so nothing hangs, but the helper names the second line for a caret at offset 0. `lineStartAt` returns 0 for an offset of 0 or less, as [markdownSourcePlaces.ts:746](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L746) already guards the same expression.[^other-line-starts]

| Source | Caret | `insertTable(2, 2)` before | After |
|---|---|---|---|
| (blank) / `abc` | 0, on the blank first line | (blank) / table / (blank) / `abc` | table / (blank) / (blank) / `abc` |

The table now goes on the caret's own blank line, as the table rule says ("a blank line itself when the caret is on one"). Both results read the same.

### A join into a raw block writes the rest so the line reads as the rest's text

When a selection runs from inside a raw Markdown block into a later block, every route removes it through `$deleteRangeFromTextOnlyBlock` ([MarkdownEditor.ts:3700](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3700)). The *rest* — what the later block holds after the selection — joins the raw block as Markdown written by `$joinedMarkdown` ([:3639](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3639)), at the *joint*: the place in the raw block where the selection started. Where the joint opens a line of the raw block, `$joinedMarkdown` escapes the rest's first character for a line start.

That escape reaches only the rest's first character. Three other things at the joint's line start can become block syntax, and nothing checked them. They are the shared cause of the samples:

| What stands at the line start | Example (Delete from the first point to the second) | Before | After |
|---|---|---|---|
| The spaces or tab the rest opens with, written in front of the escaped text: four columns of them make an indented code block | `***` / (blank) / `x`, tab, `# y`; `***`@0 to after `x` | `` ``` `` / `\# y` / `` ``` `` | `\# y` |
| Whitespace after a list marker left bare by the selection (`-` with nothing after it): it completes the marker, so the rest opens the item's text, but the rest was escaped as if it followed `-` mid-line | `- a` / `  > q` / `  > r` / (blank) / `x    # y`; after `-` to after `x` | `- # y` (a heading) | `- \# y` |
| No rest at all: the line keeps only container markers, and a bare `-` under a line of text is a setext heading's underline | `- a` / `  - b` / `    > q` / `  - c` / (blank) / `after`; before `b` to the end of `after` | `- ## a` | `- a` / `  *` |

The fix has three parts, all in `MarkdownEditor.ts`:

1. **The joint opens a line when the line before it and the rest's leading whitespace together are container markers and indentation** — `RAW_LINE_OPENING` tested on `lineBeforeJoint + leading`, not on `lineBeforeJoint` alone.
2. **A rest that opens a line keeps its leading whitespace only as far as the raw block reads the same.** Candidates, in order: the whitespace as written, one space, none. The first whose raw block lexes to the same block structure as the rest opening the line's content wins. Whitespace holding a tab is never kept as written.[^whitespace-rule]
3. **When the rest holds no text and the raw block's last line is container markers ending in a bare `-` that the reader takes for a setext underline, the `-` is written `*`.** The serializer does the same for an empty item right under a line of text (`UNDER_TEXT_BULLET`).

"Lexes to the same block structure" is `blockShape` ([markdownSerializer.ts:2744](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2744)): each block's type, a list's items' blocks, a quote's and a `:::` fence's blocks. The serializer already uses it to decide whether dropping a raw block's indentation keeps its reading (`readingInBlockList`, [:2684](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2684)). Part 2 is that same check, run on the joined text. Part 3 mirrors `listMarkerWriter` ([:3650](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3650)) and `UNDER_TEXT_BULLET` ([:251](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L251)). A new export, `markdownBlockShape(markdown)`, wraps `blockShape(lexMarkdown(markdown))` for `MarkdownEditor.ts`.[^precedent-join]

Every route (Delete, Backspace, typing, a paste, Enter, Tab, a cut) removes the selection as Delete does before inserting, so all of them get the fix through this one function. Code-block joins are untouched: a code block's text is not read as Markdown.

Measured over 11,912 ranges (every start in seven raw blocks, every end in eight later blocks, Delete and typing): the tip leaves a heading or a code block the document did not hold 477 times; the prototype, never.[^sweep]

### What an emptied nested item becomes — decided: an empty item written `*`

**Feature:** Delete over a selection that starts right after a nested list item's marker in a raw list and runs past the list.

| Source | Selection | Before | Recommended |
|---|---|---|---|
| `- a` / `  - b` / `    > q` / `  - c` / (blank) / `after` | from before `b` to the end of `after` | `- ## a` | `- a` / `  *` |
| the same, then typing `Z` over the selection | | `- ## aZ` | `- a` / `  * Z` |
| `- a` / `- b` / `  > q` / (blank) / `after` (top level) | from before `b` to the end of `after` | `- a` / `-` | unchanged |

**Options.** Write the bare `-` as `*` when the reader would take it for an underline (recommended). Or drop the emptied item. Or leave the text as it is, as source mode leaves it.

**Consequences.** The item survives empty, as the WYSIWYG surface keeps it when the same selection is deleted in a rich list (`- a` / `  - b` / `  - c` / (blank) / `after` gives `- a` / `  *` today). The nested list's bullet becomes `*`, so text typed into the item keeps `*` (`  * Z`). A rich list writes `*` only while the item is empty and `-` again once it holds text, because its authored bullet stays `-`. A top-level empty item is no underline, so it keeps `-`.

**Recommendation and decision:** `*`. It is the editor's own form for an empty item under text, and it keeps what the user did not select. Decided.

### Whitespace a rest opens a line with — decided: kept while it reads the same, else one space

**Feature:** the spaces and tabs at the start of a joined rest, where the rest opens a raw line.

| Source | Selection | Delete before | Delete after | Typing `Z` before | Typing `Z` after |
|---|---|---|---|---|---|
| `***` / (blank) / `x # y` | `***`@0 to after `x` | `\# y` | unchanged | `Z # y` | unchanged |
| `***` / (blank) / `x`, tab, `# y` | the same | code block of `\# y` | `\# y` | code block of `Z\# y` | `Z # y` |
| `***` / (blank) / `x    # y` | the same | code block of `\# y` | `\# y` | code block of `Z\# y` | `Z # y` |
| `- a` / `  > q` / (blank) / `x    y` | after `- ` to after `x` | `- ` code block of `y` | `- y` | `- ` code block of `Zy` | `- Zy` |

**Options.** Keep the whitespace while the raw block reads the same, else one space, else none (recommended). Or always drop it. Or always keep one space.

**Consequences.** One space keeps the separation a user sees when typing over the selection (`Z # y` for a space or a tab alike). Dropping all of it would give `Z# y`, a space the user did not select gone. A single space always would push a line indented three spaces into code. Saves of Delete are the same under all three options, since the save drops the whitespace a paragraph line opens with.

**Recommendation and decision:** keep, else one space, else none. Decided.

### Edits inside one raw block stay text edits

A selection whose two ends are both in one raw block is edited as text and the block read again, as documented. Delete over such a selection can still leave a bare `-` under text (`- a` / `  - b` / `    > q` / `  - c`, from before `b` to after `c`, gives `- ## a`), exactly as source mode gives it. Typing over the same selection gives `- a` / `  - Z`, since nothing is read between the removal and the insert. This plan leaves that alone.[^in-block]

### A code block's empty line is saved as a line holding only `\` — decided: keep it

**Feature:** `setBlockType("paragraph")` (or a heading of level 1 or 2, or a list toggle) on a code block whose lines include an empty one.

| Source | Command | Shown | Saved | Reloads as |
|---|---|---|---|---|
| `` ``` `` / `a` / (empty) / `b` / `` ``` `` | paragraph | `a`, line break, line break, `b` | `a\` / `\` / `b` | the same paragraph |
| the same | heading 2 | the same | `a\` / `\` / `b` / `---` | the same heading |
| the same | bulleted list | the same | `- a\` / `  \` / `  b` | the same item |
| `ab`, Shift+Enter twice after `a` | — | `a`, line break, line break, `b` | `a\` / `\` / `b` | the same paragraph |

The second line's `\` is the hard break that ends the empty line, not a stray character. The viewer reads the paragraph as `a`, two line breaks, `b`, and shows an empty line.

**Options.** Keep the form (recommended). Split the block at each empty line into two blocks. Drop the empty line.

**Consequences.** Keeping it changes no code. It matches what two Shift+Enters save, and Markdown has no other way to hold an empty line inside a paragraph: a line of spaces is a blank line and ends the paragraph. Splitting would turn one block into several on a block-type change, against the rule that a code block's lines are kept by line breaks. Dropping would lose a line the user had.

**Recommendation and decision:** keep. The fix is the documentation of the form and tests that pin it. Decided.[^backslash]

### A blank line between the blocks of a container names no block — decided: the command does nothing

**Feature:** a source-mode command with the caret on a blank line inside a list, a list item, a quote or a `:::` column, between two of its blocks.

| Source | Caret | `setBlockType("h2")` before | Recommended |
|---|---|---|---|
| `- a` / (blank) / `- b` | 4, the blank line | `- a` / (blank) / `## b` | nothing |
| `- a` / (blank) / `  b` | 4 | `- a` / (blank) / `  ## b` | nothing |
| `> a` / `>` / `> b` | 4 or 5, the `>` line | `> a` / `>` / `> ## b` | nothing |
| `::: columns` / `a` / (blank) / `b` / `\|\|\|` / `c` / `:::` | 14, the blank line | `## b` in the column | nothing |
| `- a` / (blank) / `-` | 4 | `## a` / (blank) / `-` | nothing |
| `- a` / (blank) / `- b` | 5, the start of `- b` | `- a` / (blank) / `## b` | unchanged |
| `` - a `` / (blank) / ```` ``` ```` / `x` / (empty) / `y` / ```` ``` ```` (all in the item) | 15, the code block's empty line | acts on the code block | unchanged |

**Options.** Do nothing, as between top-level blocks (recommended). Act on the block before. Act on the block after, as today.

**Consequences.** The WYSIWYG surface has no caret on that line, so there is nothing to compare with, and the source places no caret where its line does not tell which node it is in. Both rules come from the plan that made source-mode commands run through the WYSIWYG model (`markdown-source-mode-commands-through-model`): its rule for a caret between top-level blocks, and the rule its second review round added. Declining makes the inside of a container behave as the space between top-level blocks already does, and as source mode behaved before that plan (its old text surgery declined on these lines). Acting on either neighbour guesses. A range end on such a line moves inward, as between top-level blocks: a start to the next block's start, an end to the previous block's end.[^gap-rule]

**Recommendation and decision:** do nothing. Decided.

A *blank line between blocks* here is a line that holds only spaces, tabs and `>`, inside a top-level block's source, on which no leaf block's source lies. A leaf block is a source node with no children: a paragraph, a heading, a code block (its empty lines are code lines), an HTML block, a table, an empty item. The `|||` separator and a table's delimiter row are not blank; they keep their behaviour (see `## Non-Goals`).

The seam is `$placeOfSourceOffset` ([markdownSourcePlaces.ts:156](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L156)). It gains a parameter saying what an offset on such a line takes: the next block's start (the default, today's behaviour), the previous block's end, or no place. The source model ([markdownSourceModel.ts:335](../packages/lib/src/typescript/lib/component/editor/markdownSourceModel.ts#L335)) asks for no place for a collapsed caret, the next block for a range's start and the previous block for its end. The other caller, the caret mapping after a raw block shows as its blocks (`$selectCaretPlace`, [markdownWritable.ts:1249](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1249)), keeps the default: it must put the caret somewhere.[^seam]

### Source-mode `insertTable` declines on a blank line inside a list or quote

`tableSource` puts the table on the caret's line when that line is blank or holds only container syntax ([markdownSourceLines.ts:313](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L313)). Inside a list or a quote, past the container's first line, a table written at column 0 splits the container:

| Source | Caret | Before | After |
|---|---|---|---|
| `- a` / (blank) / `- b` | 4 | `- a` / (blank) / table / (blank) / (blank) / `- b` (two lists) | nothing |
| `> a` / `>` / `> b` | 4 | `> a` / (blank) / table / (blank) / `>` / `> b` (two quotes) | nothing |
| `> a` / `>` | 4 | `> a` / (blank) / table / (blank) / `>` | nothing |
| `>` / `> a` | 0, the quote's first line | table above the quote | unchanged |
| `::: columns` / `a` / (blank) / `b` / … | 14 | table in the column | unchanged |

The table already declines "inside a quote or list item's content past its first block" for the same reason. This extends the rule to the blank lines between their blocks. A column holds a table, so a column's blank line keeps it. The paragraph inserts keep acting there: their rule names the top-level quote, list, table or code block around the caret, which the blank line is in.

### Changelog — one Fixed entry, two corrected entries

The join fix gets a Fixed entry. The blank-line rule and the table decline correct two unreleased entries in place: the source-mode commands' Changed entry, which lists where a command does nothing, and the Added entry for the source-mode command API, which describes `insertTable`. The freeze and the backslash get no entry.[^changelog]

---

## Public API

None. Two internal additions, neither re-exported from an entry point:

```ts
// markdownSerializer.ts
export function markdownBlockShape(markdown: string): string;

// markdownSourcePlaces.ts
export type BetweenBlocksPlace = "next" | "previous" | "none";

export function $placeOfSourceOffset(
    text: string, offset: number, block: LexicalNode, start: number, end: number, betweenBlocks?: BetweenBlocksPlace,
): SourcePlace | null;   // betweenBlocks defaults to "next", today's behaviour
```

---

## Internal Structure

### `markdownSerializer.ts`

Directly after `blockShape` (L2744):

```ts
/**
 * The block structure the viewer's lexer reads a stretch of Markdown as:
 * each block's type, a list's items' blocks, a quote's and a `:::` fence's
 * blocks. Two texts with equal shapes read as the same blocks.
 *
 * @param markdown - The Markdown.
 * @returns A string naming the structure.
 */
export function markdownBlockShape(markdown: string): string {
    return blockShape(lexMarkdown(markdown));
}
```

### `MarkdownEditor.ts` — the join

Add `markdownBlockShape` to the import from `markdownSerializer.js` (L68–70).

In `$joinedMarkdown` (L3639), replace the three lines from `const lineBeforeJoint` to `const markdown` with:

```ts
    const lineBeforeJoint = textBeforeJoint.slice(textBeforeJoint.lastIndexOf("\n") + 1);
    // Whitespace the rest opens with completes a marker the selection left bare (`-` then ` # y`).
    const leading = /^[ \t]*/.exec(nodes.map((node) => node.getTextContent()).join(""))![0];
    const opensLine = RAW_LINE_OPENING.test(lineBeforeJoint + leading);
    const written = $inlineMarkdown(nodes, opensLine ? "" : textBeforeJoint.slice(-1));
    const markdown = opensLine ? restWrittenAtLineStart(textBeforeJoint, lineBeforeJoint, written) : written;
```

The `opensTag` lines after it stay as they are. Update the function's JSDoc: "a joint where the line holds nothing yet but container markers and indentation" becomes "a joint where the line holds nothing yet but container markers and indentation, counting the whitespace the rest opens with"; add a sentence: "The whitespace a rest that opens a line starts with is written as `restWrittenAtLineStart` decides."

Add directly after `$joinedMarkdown`:

```ts
/**
 * The joined Markdown of a rest that opens a raw block's line, its leading
 * whitespace written only as far as the raw block still reads as the rest
 * opening the line's content: as written, else one space, else none. Four
 * columns of whitespace would make the line an indented code block. A tab
 * is never kept as written: its width depends on the column the raw block is
 * saved at (indented, in a list item), which this text does not show.
 *
 * @param textBeforeJoint - The raw block's text before the joint.
 * @param lineBeforeJoint - The part of it on the joint's line.
 * @param markdown - The rest's Markdown, with the whitespace it opens with.
 * @returns The Markdown to join.
 */
function restWrittenAtLineStart(textBeforeJoint: string, lineBeforeJoint: string, markdown: string): string {
    const trimmed = markdown.replace(/^[ \t]+/, "");

    if (trimmed === markdown) {
        return markdown;
    }

    // After a marker the selection left bare (`-`), one space keeps it a marker.
    const separator = lineBeforeJoint === "" || /[ \t]$/.test(lineBeforeJoint) ? "" : " ";
    const shape = markdownBlockShape(textBeforeJoint + separator + trimmed);
    const holdsTab = /^[ \t]*\t/.test(markdown);
    const candidates = holdsTab ? [` ${trimmed}`, trimmed] : [markdown, ` ${trimmed}`, trimmed];

    return candidates.find((candidate) => markdownBlockShape(textBeforeJoint + candidate) === shape) ?? separator + trimmed;
}

/**
 * A raw block's line holding only container markers that ends in a bare `-`
 * bullet: the markers before it (group 1) and the whitespace after it
 * (group 2). The prefix is {@link RAW_LINE_OPENING}'s.
 */
const EMPTY_DASH_ITEM_LINE = /^((?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+))*[ \t]*)-([ \t]*)$/;

/**
 * How many headings the viewer's lexer reads in a stretch of Markdown, at any depth.
 *
 * @param markdown - The Markdown.
 * @returns The count.
 */
function headingCount(markdown: string): number {
    return markdownBlockShape(markdown).match(/\bheading\b/g)?.length ?? 0;
}

/**
 * Keeps an emptied list item an item: when a raw block's last line holds
 * only container markers ending in a bare `-`, and the lexer reads that `-`
 * as the underline of a setext heading (the text with `-` holds more
 * headings than with `*`), writes it `*`, as the save writes an empty item
 * right under a line of text. The character is replaced in the text node
 * that holds it, so the caret keeps its offset.
 *
 * @param block - The raw block, after a removal left it without a joined rest.
 */
function $keepEmptyDashItemAnItem(block: MarkdownRawBlockNode): void {
    const text = block.getTextContent();
    const lineStart = text.lastIndexOf("\n") + 1;
    const match = EMPTY_DASH_ITEM_LINE.exec(text.slice(lineStart));

    if (match === null) {
        return;
    }

    const dash = lineStart + match[1]!.length;
    const starred = `${text.slice(0, dash)}*${text.slice(dash + 1)}`;

    if (headingCount(text) <= headingCount(starred)) {
        return;
    }

    let at = 0;

    for (const child of block.getChildren()) {
        const size = child.getTextContentSize();

        if ($isTextNode(child) && dash < at + size) {
            const own = child.getTextContent();

            child.setTextContent(`${own.slice(0, dash - at)}*${own.slice(dash - at + 1)}`);

            return;
        }

        at += size;
    }
}
```

In `$deleteRangeFromTextOnlyBlock` (L3700), directly before its final `return true;`:

```ts
    const target = block.getLatest();

    // With no text joined, the line the joint is on is the raw block's last.
    if ($isMarkdownRawBlockNode(target) && target.isAttached() && tail.trim() === "") {
        $keepEmptyDashItemAnItem(target);
    }
```

Add one sentence to that function's JSDoc: "When nothing joins, an emptied list item's bare `-` that would read as a heading's underline is written `*` (`$keepEmptyDashItemAnItem`)."

The rewrite looks at the whole raw text, not only the last text node, because a joined rest of whitespace lands in a text node of its own.

### `markdownSourcePlaces.ts` — no place on a blank line between blocks

Above `$placeOfSourceOffset` (L156):

```ts
/**
 * What an offset on a blank line between the blocks of a container takes
 * ({@link $placeOfSourceOffset}): the next block's start, the previous
 * block's end, or no place.
 */
export type BetweenBlocksPlace = "next" | "previous" | "none";
```

`$placeOfSourceOffset` gains `betweenBlocks: BetweenBlocksPlace = "next"` as its sixth parameter. Its JSDoc gets a bullet: "An offset on a blank line between the blocks of a container ({@link standsBetweenBlocks}) takes what `betweenBlocks` says; the default, the next block's start, is where a caret mapped out of a raw block goes." The call of `$placeAmongUnits` becomes:

```ts
    const isBetweenBlocks = betweenBlocks !== "next" && standsBetweenBlocks(source, offset - start, analysis, end - start);
    const place = $placeAmongUnits(walk.units, offset - start, source, walk.inlines, isBetweenBlocks ? betweenBlocks : "next");
```

`$placeAmongUnits` (L1133) gains `betweenBlocks: BetweenBlocksPlace = "next"` and passes it to `$placeBetween` (L1165), which gains the same parameter. In `$placeBetween`, directly after `endOfBefore` and `startOfAfter` are computed:

```ts
    // Only an offset that stands between blocks is asked for another place than the next block's start.
    if (betweenBlocks !== "next") {
        return betweenBlocks === "previous" ? endOfBefore : null;
    }
```

Add two functions after `sourceNodesOf` (L358), mirroring it:

```ts
/**
 * Whether an offset stands on a blank line between the blocks of a
 * container: its line holds only spaces, tabs and `>` (the line prefix a
 * quote or list item gives a line), and no leaf block's source — a block
 * that holds no other, such as a paragraph, a code block or an empty item —
 * lies on that line. A code block's empty line is the code block's.
 *
 * @param source - The block's Markdown, with what follows it.
 * @param offset - The offset in `source`.
 * @param analysis - The analysis of `source`.
 * @param length - The length of the block's own Markdown.
 * @returns Whether it does; `false` when a leaf block's source is not found.
 */
function standsBetweenBlocks(source: string, offset: number, analysis: SourceAnalysis, length: number): boolean {
    const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
    const newline = source.indexOf("\n", offset);
    const lineEnd = newline === -1 ? source.length : newline;
    const isBlank = source.slice(lineStart, lineEnd).replace(LINE_PREFIX, "") === "";

    if (!isBlank) {
        return false;
    }

    const lineOf = (at: number): number => source.lastIndexOf("\n", at - 1) + 1;

    return leafSourceNodesOf(analysis, length).every((leaf) => leaf.start !== NOT_FOUND
        && (lineOf(leaf.start) > lineStart || lineOf(Math.max(leaf.start, leaf.end - 1)) < lineStart));
}

/**
 * The block-level source nodes in a block's source that hold no other block.
 *
 * @param analysis - The analysis of the block's Markdown and what follows it.
 * @param length - The length of the block's own Markdown.
 * @returns The nodes in document order.
 */
function leafSourceNodesOf(analysis: SourceAnalysis, length: number): SourceBlockNode[] {
    const found: SourceBlockNode[] = [];

    const collect = (node: SourceBlockNode): void => {
        if (node.children.length === 0) {
            found.push(node);
        }

        node.children.forEach(collect);
    };

    ownBlocks(analysis, length).forEach(collect);

    return found;
}
```

### `markdownSourceModel.ts` — the model asks for it

- Import `BetweenBlocksPlace` with `SourcePlace` (L14).
- `$placeInSpans` (L212) and `$placeInUnpairedBlocks` (L268) each gain a last parameter `betweenBlocks: BetweenBlocksPlace` and pass it to their `$placeOfSourceOffset` call.
- In `$selectSourceRange` (L335), `placeOf` takes `(offset, betweenBlocks)` and passes it on; the two calls become:

```ts
    const anchor = placeOf(range.from, from === to ? "none" : "next");
    const focus = from === to ? anchor : placeOf(range.to, "previous");
```

- `$selectSourceRange`'s JSDoc bullet list gets: "A collapsed caret on a blank line between the blocks of a list, list item, quote or `:::` column has no place either; a range end there moves inward, as between top-level blocks."

### `markdownSourceLines.ts` — the line start and the table

```ts
/** The containers a table written on one of their blank lines would split: a quote and a list. */
const TABLE_SPLIT_CONTAINER_TYPES: ReadonlySet<string> = new Set(["blockquote", "list"]);
```

next to `SURROUNDED_BLOCK_TYPES` (L26). `lineStartAt` (L248):

```ts
function lineStartAt(text: string, offset: number): number {
    // At the document start there is no line before: `lastIndexOf("\n", -1)` would find a newline at 0.
    return offset <= 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
}
```

In `tableInsertionLine`, the `node === undefined` branch (L313):

```ts
    if (node === undefined) {
        // A blank line past a quote's or list's first line is inside it: a table there would split it.
        const isInsideContainer = allNodes(analysis.tree).some((container) => TABLE_SPLIT_CONTAINER_TYPES.has(container.type)
            && container.start !== -1 && lineStartAt(text, container.start) < line.start && line.start <= lineStartAt(text, container.end - 1));
        const isContainerSyntax = CONTAINER_SYNTAX_ONLY.test(text.slice(line.start, line.end));

        return isContainerSyntax && !isInsideContainer ? line.start : null;
    }
```

Extend the `@returns` of `tableInsertionLine` and the JSDoc of `tableSource` (L346) with: "and on a blank line inside a quote or a list past its first line, where a table written at column 0 would split it."

---

## Ordered Implementation Steps

Work in `.worktrees/markdown-editor-four-known-issue-fixes` (its `node_modules` and `packages/lib/node_modules` are symlinks to the main tree). Run tests from `packages/lib`.

1. **Read the critical files** listed in `## Critical Files`. Run `npx vitest run tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-source-mode-through-model.test.ts tests/component/markdown-source-edits.test.ts tests/component/markdown-editor-reload-differences.test.ts`: all pass on the base.
2. **Write the freeze rows** (`## Expected Behaviour`, *The freeze*) in `markdown-source-mode-through-model.test.ts` and `markdown-source-edits.test.ts`. Check: only the `insertTable` at offset 0 row fails.
3. **Write the join rows and the sweep** (*The join*) in `markdown-editor-command-crashes.test.ts`. Check: the rows marked "fails on the base" fail, and the sweep fails for all seven raw blocks.
4. **Write the backslash rows** (*The empty code line*) in `markdown-editor-reload-differences.test.ts`. Check: they pass on the base (no code changes for them).
5. **Write the blank-line rows and the differential check** (*The blank line*) in `markdown-source-mode-through-model.test.ts` and `markdown-source-edits.test.ts`. Check: the decline rows and the caret rows fail; the code-block rows pass; part 9 of the differential fails with "acted on a blank line between the blocks of a container".
6. **`markdownSourceLines.ts`: `lineStartAt`.** Check: the step-2 rows pass.
7. **`markdownSerializer.ts`: `markdownBlockShape`.** Then **`MarkdownEditor.ts`: the import, `$joinedMarkdown`, `restWrittenAtLineStart`, `EMPTY_DASH_ITEM_LINE`, `headingCount`, `$keepEmptyDashItemAnItem` and the call in `$deleteRangeFromTextOnlyBlock`.** Check: the step-3 rows and the sweep pass; `grep -n "RAW_LINE_OPENING.test(lineBeforeJoint)" src/typescript/lib/component/editor/MarkdownEditor.ts` finds nothing.
8. **`markdownSourcePlaces.ts`: `BetweenBlocksPlace`, the parameter on `$placeOfSourceOffset`, `$placeAmongUnits` and `$placeBetween`, `standsBetweenBlocks`, `leafSourceNodesOf`. `markdownSourceModel.ts`: the parameter threaded through.** Check: the step-5 rows other than the table rows pass; `grep -n '\$placeOfSourceOffset(' src/typescript/lib/component/editor/markdownWritable.ts` shows the call with five arguments, unchanged.
9. **`markdownSourceLines.ts`: `TABLE_SPLIT_CONTAINER_TYPES` and the `tableInsertionLine` branch.** Check: the table rows pass.
10. **JSDoc** of `$joinedMarkdown`, `$deleteRangeFromTextOnlyBlock`, `$placeOfSourceOffset`, `$selectSourceRange`, `tableInsertionLine`, `tableSource` and `MarkdownEditor.insertTable` as given in `## Internal Structure` and `## Documentation Impact`.
11. **Docs and changelog** as given in `## Documentation Impact`.
12. **Known-issues list** as given in `## Documentation Impact`.
13. **Verification** as given in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceModel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-mode-through-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-reload-differences.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify (outside the repo) | `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/known-issues-2026-10.md` |

---

## Expected Behaviour

All rows are offline unit tests. In the tables of this section a string in backticks is the content of a TypeScript single-quoted literal, as the test writes it: `\n` is a line end, `\t` a tab, `\\` one backslash, and `\|` inside a table cell stands for `|`. `x@n` is offset `n` in the text node whose text is exactly `x`; a caret given as a number is a source offset. Rows marked "fails on the base" fail before this plan's code and pass after; the others pass on both and guard against a regression.

### The freeze

In `markdown-source-mode-through-model.test.ts`, in the `the pass` describe, next to row 5.21:

- **Every source-mode command on the freeze document ends at once.** For `"\n\n 1.\t</pre>\n \t  >\t#\th\n"`, every offset from 0 to its length, and each of the seventeen `COMMANDS` plus `insertTable(2, 2)`, `insertParagraphBeforeBlock()` and `insertParagraphAfterBlock()`: each `runInSource` call takes under 1,000 ms (measured worst: 29 ms), and at offset 7 the seventeen leave the text unchanged. Passes on the base.

In `markdown-source-edits.test.ts`, `describe('tableSource')`:

| Row | Text | Caret | `apply(text, edit)` | `edit.selection` |
|---|---|---|---|---|
| a caret on a blank first line puts the table on that line (fails on the base) | `"\nabc"` | 0 | `"|  |  |\n| --- | --- |\n|  |  |\n\n\nabc"` | `{ from: 2, to: 2 }` |
| a caret on the second blank line is unchanged | `"\nabc"` | 1 | `"\n|  |  |\n| --- | --- |\n|  |  |\n\nabc"` | `{ from: 3, to: 3 }` |

### The join

In `markdown-editor-command-crashes.test.ts`, appended to `JOIN_ROWS` (L2653). Each row is Delete over the range, either way round, through the existing `it.each(JOIN_ROWS)`. The first column is the row's name:

| Row | Source | Start | End | Saved |
|---|---|---|---|---|
| an emptied nested item stays an item (fails on the base) | `- a\n  - b\n    > q\n  - c\n\nafter` | `['  - b', 4]` | `['after', 5]` | `- a\n  *` |
| an emptied nested item from right after its dash (fails on the base) | the same | `['  - b', 3]` | `['after', 5]` | `- a\n  *` |
| an emptied item under a continuation line (fails on the base) | `- a\n  b\n  - c\n    > q\n\nafter` | `['  - c', 4]` | `['after', 5]` | `- a\n  b\n  *` |
| an emptied item and a rest of spaces (fails on the base) | `- a\n  - b\n    > q\n\nc  \n` | `['  - b', 4]` | `['c  ', 1]` | `- a\n  *\n` |
| an emptied top-level item keeps its dash | `- a\n- b\n  > q\n\nafter` | `['- b', 2]` | `['after', 5]` | `- a\n-` |
| an emptied item in a quote keeps its dash | `> a\n> - b\n>   > q\n\nafter` | `['- b', 2]` | `['after', 5]` | `> a\n>\n> -` |
| a tab a rest opens a line with (fails on the base) | `***\n\nx\t# y` | `['***', 0]` | `['x\t# y', 1]` | `\\# y` |
| four spaces a rest opens a line with (fails on the base) | `***\n\nx    # y` | `['***', 0]` | `['x    # y', 1]` | `\\# y` |
| two tabs a rest opens a line with (fails on the base) | `***\n\nx\t\tyy` | `['***', 0]` | `['x\t\tyy', 1]` | `yy` |
| spaces after a list marker (fails on the base) | `- a\n  > q\n\nx    y` | `['- a', 2]` | `['x    y', 1]` | `- y` |
| a space completing a bare star (fails on the base) | `***\n\nx\t# y` | `['***', 1]` | `['x\t# y', 1]` | `* \\# y` |
| spaces completing a bare dash (fails on the base) | `- a\n  > q\n  > r\n\nx    # y` | `['- a', 1]` | `['x    # y', 1]` | `- \\# y` |
| a tab completing a bare dash (fails on the base) | `- a\n  - b\n    > q\n  - c\n\nx  \t- y` | `['  - b', 3]` | `['x  \t- y', 1]` | `- a\n  - \\- y` |
| a tab at an HTML block's line start (fails on the base) | `<div>\nraw\n</div>\n\nx\t# y` | `['raw', 0]` | `['x\t# y', 1]` | `<div>\n \\# y` |

The existing row named `K5` (a thematic break joined with ` # y`: `***\n\nx # y` → `\\# y`) stays as it is: one space is kept.

Appended to `ROUTE_ROWS` (L2713), checked by the existing `it.each(ROUTE_ROWS)` (the route equals Delete then the same input, either way round):

| Row | Route | Source | Start | End | Saved |
|---|---|---|---|---|---|
| typing over an emptied nested item (fails on the base) | typing | `- a\n  - b\n    > q\n  - c\n\nafter` | `['  - b', 4]` | `['after', 5]` | `- a\n  * Z` |
| typing over a tab a rest opens a line with (fails on the base) | typing | `***\n\nx\t# y` | `['***', 0]` | `['x\t# y', 1]` | `Z # y` |
| typing from a thematic break into a list item | typing | `***\n\n- x # y` | `['***', 0]` | `['x # y', 1]` | `Z # y` |

**The sweep** — a new `describe('a removal out of a raw block makes no heading or code block of what is left', …)` after the join describe. For each raw block of `RAW_BLOCKS` (one `it` each, `SWEEP_TIMEOUT_MS = 60_000` with the comment of the list-item sweep's constant), and each later block of `LATER_BLOCKS`:

```ts
/** Raw blocks a removal can start in: lists holding a quote, a thematic break, an HTML block, a quote holding a list. */
const RAW_BLOCKS = [
    '- a\n  - b\n    > q\n  - c', '- a\n  b\n  - c\n    > q', '1. a\n   - b\n     > q', '- a\n  > q\n  > r', '***', '<div>\nw\n</div>', '> a\n> - b\n>   > q',
];

/** Later blocks whose text holds whitespace and block markers a joined rest can open a line with. */
const LATER_BLOCKS = ['after', 'x\t# y', 'x    # y', 'x  \t- y', 'x - y', '- x\t# y', '> x\t# y', 'x\t\tyy'];
```

the document is `` `${raw}\n\n${later}` ``. A selection runs from every offset of every text node inside a raw block of the loaded document to every offset of every text node outside it; Delete (`DELETE_CHARACTER_COMMAND`, `true`) removes it. Every kind of block among a heading, a code block and a thematic break in the save must also be in the source. Kinds are read by walking `lexMarkdown(save)` into list items' and quotes' tokens. Skip a document whose load holds no raw block (`- a\n  > q\n  > r` before `- x\t# y` loads as rich blocks). Fails on the base for all seven raw blocks: 262 of the 5,956 Delete cases. The whole sweep takes about 13 s.

### The empty code line

In `markdown-editor-reload-differences.test.ts`, in `describe('the editor shows what its save reloads to: a line end inside a text')` (L249), after `N3`, through `expectShownAndReloaded`, with the caret put at `a` as `N1` puts it. Each also checks how the viewer's lexer reads the save: the inline tokens of `lexMarkdown(saved)[0]` (for the list row, of `lexMarkdown(saved)[0].items[0].tokens[0]`) have the types `['text', 'br', 'br', 'text']`, so the `\` shows as a line break and not as text (measured):

| Row | Source | Command | Tree | Saved |
|---|---|---|---|---|
| a code block with an empty line made a paragraph holds two line breaks | `` ```\na\n\nb\n``` `` | `setBlockType('paragraph')` | `paragraph("a", linebreak, linebreak, "b")` | `a\\\n\\\nb` |
| the same made a heading 2 | the same | `setBlockType('h2')` | `heading("a", linebreak, linebreak, "b")` | `a\\\n\\\nb\n---` |
| the same made a list item | the same | `toggleUnorderedList()` | `tight(markdown-list-item(markdown-list-item-text("a", linebreak, linebreak, "b")))` | `- a\\\n  \\\n  b` |
| two Shift+Enters save the same form | `ab`, caret `ab`@1 | `INSERT_LINE_BREAK_COMMAND` twice | `paragraph("a", linebreak, linebreak, "b")` | `a\\\n\\\nb` |

The tree spellings follow `tree()` in that file (as `N1` and `N2` spell them); the save strings are measured. Import `lexMarkdown` from `~/component/display/markdownExtensions` for the token check. All pass on the base.

### The blank line

In `markdown-source-mode-through-model.test.ts`, appended to `DECLINES` (L538), each run through the existing `it.each` that expects no change, no replacement, no event and one focus:

| Row | Source | Caret | Commands |
|---|---|---|---|
| the blank line between the items of a loose list (fails on the base) | `- a\n\n- b` | 4 | `h2`, `bold`, `bulleted`, `image` |
| the blank line of a loose numbered list (fails on the base) | `1. a\n\n2. b` | 5 | `h2` |
| a line of spaces between items (fails on the base) | `- a\n  \n- b` | 5 | `h2` |
| the blank line between a list item's blocks (fails on the base) | `- a\n\n  b` | 4 | `h2`, `image` |
| a quote's line between its blocks (fails on the base) | `> a\n>\n> b` | 4 and 5 (two rows) | `h2`, `bold`, `quote` |
| a quote's empty last line (fails on the base) | `> a\n>` | 4 | `h2` |
| a quote's empty first line (fails on the base) | `>\n> a` | 1 | `h2` |
| a list in a quote, between its items (fails on the base) | `> - a\n>\n> - b` | 6 | `h2` |
| the blank line between a column's blocks (fails on the base) | `::: columns\na\n\nb\n\|\|\|\nc\n:::` | 14 | `h2`, `bold` |
| the blank line before an empty item (fails on the base) | `- a\n\n-` | 4 | `h2` |
| the blank line before a code block in an item (fails on the base) | `` - a\n\n  ```\n  x\n  ```\n\n- b `` | 4 and 21 (two rows) | `h2` |

Appended to `ROWS` (L459), through the existing pass check (text, and the caret where not `null`):

| Row | Source | From | To | Command | Text | Caret |
|---|---|---|---|---|---|---|
| a range ending on a loose list's blank line moves inward (fails on the base) | `- a\n\n- b` | 2 | 4 | `bold` | `- **a**\n\n- b` | `at(4, 5)` |
| the same, a heading (fails on the base: the caret) | `- a\n\n- b` | 2 | 4 | `h2` | `## a\n\n- b` | `at(3, 4)` |
| a range starting on a loose list's blank line | `- a\n\n- b` | 4 | 8 | `bold` | `- a\n\n- **b**` | `at(9, 10)` |
| a range ending on a quote's blank line (fails on the base) | `> a\n>\n> b` | 1 | 4 | `h2` | `> ## a\n>\n> b` | `at(5, 6)` |
| the start of the next item's line acts on it | `- a\n\n- b` | 5 | 5 | `h2` | `- a\n\n## b` | `at(8)` |
| a code block's empty line in a quote is the code block's | `` > ```\n> a\n>\n> ``` `` | 10 | 10 | `h2` | `> ## a` | `at(6)` |
| a code block's empty line in an item is the code block's | `` - a\n\n  ```\n  x\n\n  y\n  ``` `` | 15 | 15 | `h2` | `- a\n\n  x\\\n  \\\n  y\n  ---` | `at(16)` |

**The differential** (`describe('the corpus differential')`, L885): before the `isOnBlankLines` check (L915), a collapsed caret for which a new test helper `standsOnBlankLineInsideBlock(source, at)` is true counts as `counts.innerBlank`. That caret must leave `run.text` equal to `source` with no replacement; otherwise push `` `${where}: acted on a blank line between the blocks of a container` `` and `continue`. The helper:

```ts
/**
 * Whether a caret stands on a blank line inside a top-level block, between the blocks of a container: the line holds
 * only spaces, tabs and `>`, a top-level block holds the caret, and no block of the viewer's reading that holds no other
 * block has its source on the line.
 *
 * @param doc - The document.
 * @param at - The caret.
 * @returns Whether it does.
 */
function standsOnBlankLineInsideBlock(doc: string, at: number): boolean {
    const lineStart = doc.lastIndexOf('\n', at - 1) + 1;
    const newline = doc.indexOf('\n', at);
    const line = doc.slice(lineStart, newline === -1 ? doc.length : newline);
    const inTopLevel = locateTopLevelBlocks(doc).blocks.some((block) => block.start <= at && at <= block.end);
    const lineOf = (offset: number): number => doc.lastIndexOf('\n', offset - 1) + 1;
    const leaves = (nodes: readonly SourceBlockNode[]): SourceBlockNode[] => nodes.flatMap((node) => (node.children.length === 0 ? [node] : leaves(node.children)));
    const onLeaf = leaves(analyzeMarkdownSource(doc).tree).some((leaf) => leaf.start === -1
        || (lineOf(leaf.start) <= lineStart && lineStart <= lineOf(Math.max(leaf.start, leaf.end - 1))));

    return /^[ \t>]*$/.test(line) && inTopLevel && !onLeaf;
}
```

Import `analyzeMarkdownSource` and the type `SourceBlockNode` from `~/component/editor/markdownSourceTokens`. Measured on the prototype: 320 carets of the differential stand on such lines; all eight parts fail on the base (`CommonMark 256 (List items)` at offset 6 is the first difference) and pass with the fix.

In `markdown-source-edits.test.ts`, `describe('code fences and tables stay out of list items')` (L89), a new `it('declines a table on a blank line inside a list or a quote, and keeps one in a column', …)` (fails on the base for the first three):

| Text | Caret | `tableSource(2, 2)(text, caret, caret)` |
|---|---|---|
| `- a\n\n- b` | 4 | `null` |
| `> a\n>\n> b` | 4 | `null` |
| `> a\n>` | 4 | `null` |
| `>\n> a` | 0 | applied: `"|  |  |\n| --- | --- |\n|  |  |\n\n>\n> a"` |
| `::: columns\na\n\nb\n\|\|\|\nc\n:::` | 14 | applied: `"::: columns\na\n\n|  |  |\n| --- | --- |\n|  |  |\n\n\nb\n\|\|\|\nc\n:::"` |
| `one\n\ntwo` | 4 | applied: `"one\n\n|  |  |\n| --- | --- |\n|  |  |\n\n\ntwo"` |

### Manual (browser) checks

None needed: every change is in text the offline harness reads, and no layout, focus or pointer path changes. One optional check in the docs app: load `- a`, a blank line, `- b` in a `MarkdownEditor` in source mode, click the blank line, press the heading-2 toolbar button; nothing changes.

---

## Verification

From `packages/lib`:

- `npx vitest run tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-source-mode-through-model.test.ts tests/component/markdown-source-edits.test.ts tests/component/markdown-editor-reload-differences.test.ts` — the rows of `## Expected Behaviour` pass.
- `npx vitest run tests/component/markdown tests/component/display/Markdown tests/component/display/markdown` — every Markdown test file passes unchanged (the prototype measured 51 files, 14,127 tests; the filter also takes in `markdown-roundtrip`).
- `npm run typecheck`, `npm run typecheck:test`, `npm run lint` — clean.
- `npm run docs:api` — zero warnings (the new exports are internal and linked from no public JSDoc).
- `npm test` — the whole suite.
- `grep -rn 'placeOfSourceOffset(' src/typescript/lib` — besides the definition, three calls: `markdownWritable.ts` with five arguments, the two in `markdownSourceModel.ts` with six.

---

## Documentation Impact

No public symbol changes, so no API page or catalog entry moves.

**`packages/lib/docs/components/MarkdownEditor.md`:**

- *Kept as source* paragraph (L84), in the sentence ending "…a raw block as Markdown with every escape, escaped for where it lands; a raw block whose text then reads as other blocks shows as those blocks;": after "escaped for where it lands" insert ", and where the rest opens one of the raw block's lines — at its start, or after its quote or list markers — the spaces and tabs it opens with are kept only as far as the line still reads as the rest's own text (four columns of them would make it a code block), and a list item the selection empties is kept as an empty item, written `*` where a bare `-` under a line of text would read as a heading's underline".
- *Line breaks* bullet (L92): after "A code block's lines, when it becomes a paragraph or a list item, are kept by line breaks." add "An empty line among them is saved as a line holding only the `\` of its break (`a\`, `\`, `b`), as two line breaks in a row are anywhere; it reloads as the same empty line."
- Source-mode paragraph (L294): "A command also does nothing with the caret on a blank line between blocks," becomes "A command also does nothing with the caret on a blank line between blocks (between top-level blocks, or between the blocks of a list, a list item, a quote or a `:::` column, as in `- a`, a blank line, `- b`),".
- L296: after the sentence that ends "…step out of the top-level quote, list, table or code block around the caret." add "On a blank line inside a list or a quote, `insertTable` does nothing, since a table there would split the list or quote."

**`MarkdownEditor.insertTable` JSDoc** (`MarkdownEditor.ts`, the `"source"` sentence near L9918): "inserts the raw-Markdown GFM table skeleton above the block holding the caret instead." becomes "inserts the raw-Markdown GFM table skeleton above the block holding the caret instead, and does nothing on a blank line inside a list or a quote, where the table would split it."

**`packages/lib/docs/reference/changelog/next.md`** (its paragraphs are wrapped at about 75 columns: match the quoted text across line ends, and rewrap each edited paragraph):

- In *Fixed › Components*, a new entry directly after "**`MarkdownEditor` replaces a selection that leaves a raw Markdown block or a code block the way Delete removes it.**":

  > - **`MarkdownEditor`: a selection removed from a raw Markdown block into a later block leaves no heading or code block behind.** Deleting from the start of a nested item's text in a raw list (`- a`, `  - b`, `    > q`, `  - c`) to the end of a later paragraph left the item's `-` alone under `a`, where it reads as a heading's underline, and saved `- ## a`; the item now stays, empty, saved `- a` and `  *`. The spaces or tab that the rest of the later block started with stayed in front of it where it opened a line of the raw block, so `x`, a tab and `# y` joined at a thematic break's start became a code block holding `\# y`, and four spaces after a list marker made the item's text code; they are now kept only as far as the line still reads as that text. Typing, a paste and the other edits over such a selection give the same, as they remove it as Delete does first. No consumer action is needed.

- In *Changed*, the entry "**`MarkdownEditor`'s source-mode commands give the WYSIWYG result.**" (it stands under that section's *Layouts* heading): "on the blank lines between blocks or before the first block" becomes "on a blank line between blocks — also between the items of a list, the blocks of a list item or a quote, and the blocks of a `:::` column — or before the first block".
- In *Added › Components*, the entry "**`MarkdownEditor`'s command API edits the raw Markdown directly in `"source"` mode**": "and `insertTable` goes above the whole block holding the caret instead of splitting an HTML block or a table" becomes "and `insertTable` goes above the whole block holding the caret instead of splitting an HTML block or a table, and does nothing on a blank line inside a list or a quote".

**Known-issues list** (`/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/known-issues-2026-10.md`, outside the repo):

- Remove "Delete over a raw nested list item to a later paragraph can turn the item above into a heading …".
- Remove "(join-escapes review 1) Typing over a range from a thematic break's start into a list item …".
- Remove "(join-escapes review 1) A rest opening with a tab, joined at a raw block's start, becomes an indented code block …".
- Remove "(tab-column review 1) Source-mode list toggle hangs …".
- Remove "(through-model review 2) A source-mode caret on the blank line between items of a loose list acts on the next item …".
- In "(reload-differences review 1, same on the base) …", delete the clause "a code block with an empty line set to a paragraph saves `\` on an empty line;".
- Add: "(four-fixes, by design) Delete over a selection inside one raw block that leaves a bare `-` under a line of text reads as a heading's underline (`- a` / `  - b` / `    > q` / `  - c`, from before `b` to after `c`, gives `- ## a`), as source mode gives it; typing over the same selection keeps the item."
- Add: "(four-fixes, left as before) A source-mode caret on a `:::` column's `|||` line or on a table's delimiter row acts on the next column or row, though no block is named there either."

---

## Potential Challenges

- **`$placeOfSourceOffset` is called from three places.** Only the two in `markdownSourceModel.ts` pass the new argument; leaving `markdownWritable.ts` on the default is what keeps the caret mapping of a raw block shown as its blocks unchanged. The Verification grep checks it.
- **The sweep is the slowest new test.** Split it into one `it` per raw block, Delete only, with `SWEEP_TIMEOUT_MS`; the whole sweep measured 13 s on the prototype.
- **Tree spellings in the backslash rows.** `tree()` in `markdown-editor-reload-differences.test.ts` has its own spelling (`tight(…)`, `heading(…)`); read it from `N1`/`N2` before writing the rows, and keep the save strings as given.
- **`$keepEmptyDashItemAnItem` runs before the raw block is read again.** It must run in `$deleteRangeFromTextOnlyBlock`, inside the same update, before the transforms show the raw block as its blocks; a later hook would see a heading already built.
- **`lexMarkdown` cost per join.** `restWrittenAtLineStart` and `$keepEmptyDashItemAnItem` lex the raw block's text at most six times, only on a join whose rest opens a line with whitespace or holds no text; raw blocks are small.

---

## Critical Files

- [MarkdownEditor.ts:3600-3745](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3600) — `$joinIntoTextOnlyBlock`, `RAW_LINE_OPENING`, `$joinedMarkdown`, `$textBeforePoint`, `$deleteRangeFromTextOnlyBlock`; [:3804](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3804) `$inlineMarkdown`.
- [markdownSerializer.ts:2684-2768](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2684) — `readingInBlockList`, `blockShape`, `blockStructure`: the "same blocks" check this plan reuses. [:245-251](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L245) and [:3640-3660](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3640) — `UNDER_TEXT_BULLET`, `listMarkerWriter`: the precedent for `*`.
- [markdownSourcePlaces.ts:76-100, 150-200, 336-372, 1120-1235](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L150) — `LINE_PREFIX`, `BLOCK_END`, `$placeOfSourceOffset`, `$locatedWalk`, `ownBlocks`, `sourceNodesOf`, `$placeAmongUnits`, `$placeBetween`, `$placeBesideNode`.
- [markdownSourceModel.ts:180-360](../packages/lib/src/typescript/lib/component/editor/markdownSourceModel.ts#L180) — `$placeInSpans`, `$placeInUnpairedBlocks`, `movedInward`, `$selectSourceRange`: the rule for a caret between top-level blocks that this plan extends.
- [markdownWritable.ts:1185-1260](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1185) — `$showRawBlockAsItsBlocks`, `$selectCaretPlace`: the caller that keeps the default.
- [markdownSourceLines.ts:20-50, 240-330](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L240) — `CONTAINER_SYNTAX_ONLY`, `lineStartAt`, `linesOf`, `leafNodes`, `tableInsertionLine`.
- [markdownSourcePlaces.ts:746](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L746) — the guarded line start `lineStartAt` now mirrors.
- `plans/implemented/markdown-source-mode-commands-through-model.md` — *Where a selection end stands between blocks*, and the placement rule of its second review round in its Implementation Notes.
- `plans/implemented/markdown-editor-join-escapes-heading-line.md` — the join's design (one join, every route).
- Tests: `markdown-editor-command-crashes.test.ts` L2598-2790 (helpers, `JOIN_ROWS`, `ROUTE_ROWS`), `markdown-source-mode-through-model.test.ts` L456-575 and L780-1033, `markdown-source-edits.test.ts` L1-110 and L182-250, `markdown-editor-reload-differences.test.ts` L29-100 and L249-276, and the list-item sweep in `markdown-editor-list-item-edits.test.ts` L2440-2460 for the timeout constant.

---

## Non-Goals

- **Edits inside one raw block.** A selection with both ends in a raw block is a text edit, read again as written; source mode gives the same.[^in-block]
- **The `|||` line and a table's delimiter row in source mode.** A caret there still acts on the next column or row. Neither is a blank line, and both shapes have their own placement code (`$emptyCellAt`, `TABLE_DELIMITER_LINE`); they are recorded in the known-issues list.
- **Source-mode `insertTable` in a list's later item.** With the caret in the text of a list's second item, the table still goes above that item and splits the list, as documented ("above the block holding the caret"); only blank lines change here.
- **Joins into a code block.** A code block's text is not read as Markdown, so whitespace and a bare marker there mean nothing.
- **A different form for an empty paragraph line.** `\` alone stays the editor's form (decided above).

---

## Addendum: Measurements

All on private copies under `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/four-fixes/`: the tip (`f80f4e07b`), the code just before source-mode commands ran through the WYSIWYG model (`fe498e8dc^`, in `old/`), and the prototype (`proto/`, `prototype.diff`). Probes are in `probes/` (tip) and `pprobes/` (prototype), run with `vitest.scratch.config.ts`, `vitest.old.config.ts` and `vitest.proto.config.ts`.

| What | Result |
|---|---|
| The freeze sample on `fe498e8dc^` | `listSource('unordered')` loops in `nearestTextLine` (six million steps in 0.3 s before a guard threw); `listSource('ordered')` returns in 12 ms |
| The freeze sample on the tip | the seventeen commands that run through the WYSIWYG model, `insertTable` and the two paragraph inserts at every offset of the sample: worst 28 ms, none of the seventeen changes the text at offset 7; 11 commands at every offset of four documents that open with blank lines: worst 29 ms |
| The join sweep, tip | 11,912 cases (Delete and typing): 477 leave a heading or code block (Delete: 111 heading, 151 code; typing: 104 heading, 111 code). Delete alone, per raw block: 74, 55, 54, 29, 17, 9 and 24 of the seven, 262 in all |
| The join sweep, prototype | 0 of 11,912 |
| An intermediate prototype that kept a tab when it read the same | 2 left, both in a raw block saved indented in a list item: the tab's width moved with the column |
| The blank-line rows, tip | heading 2 acts on a neighbouring block on every blank line listed (the next one, or the one before where no block follows: `- a` / (blank) / `-`, `> a` / `>`); `insertTable` splits the list or the quote |
| The blank-line rows, prototype | nothing on every blank line listed; code blocks' empty lines still act |
| The text surgery of `fe498e8dc^` on the blank lines | `blockPrefixSource('## ')` returns `null` on `- a` / (blank) / `- b`, `> a` / `>` / `> b` and `- a` / (blank) / `  b` |
| The suites, prototype | 51 Markdown test files, 14,127 tests, all pass; `tsc --noEmit` clean |
| The differential with the blank-line check (`prototype-differential.diff`) | 320 carets on blank lines between the blocks of a container; the tip fails all eight parts, the prototype passes them |
| The join and route rows, prototype | every row of `## Expected Behaviour` holds both ways round |
| The backslash form | `lexMarkdown("a\\\n\\\nb")`: one paragraph of `text`, `br`, `br`, `text`; reload and second save identical |

---

## Notes

[^freeze-cause]: Found by running the sources of `fe498e8dc^`, just before source-mode commands ran through the WYSIWYG model, with a step counter in each loop of `markdownSourceLines.ts`: the counter in `nearestTextLine`'s `while` passed six million in a third of a second, from `neighbourList`, from `readListJoin`, from `listOn`. The sample opens with two newlines; the caret's block (`1.`) looks for a list above it, starting from line 1; `lineStartAt(text, 0)` gave 1, so `at` stayed 1. The ordered toggle returned at once because its path did not look above. On the tip the same command reads the Markdown into the model, where the caret stands in a raw HTML block of a list item, and declines as every command on a raw block does (row 5.21, already in the suite with a 1,000 ms bound).

[^other-line-starts]: The other `lastIndexOf("\n", x - 1) + 1` sites were checked: `markdownSourcePlaces.ts:746` is guarded (`from === 0 ? 0 : …`); `markdownImporter.ts:1039` (`resumePosition`) reaches index 0 only when the text's first character is not whitespace, so no newline sits there; `markdownSourceEdits.ts:172` takes an inline block's start, which never stands on a newline. Only `markdownSourceLines.ts`'s helper can be handed offset 0 of a text that opens with a newline. Its effect today is invisible in the reading (the table lands one blank line lower), which is why it is fixed rather than reported as a defect.

[^whitespace-rule]: The reference is the rest opening the line's content: the raw text before the joint, a space when the line ends in a bare marker, and the rest without its whitespace. Each candidate is compared with that by block structure, not text, so a candidate wins when it makes no block the reference does not have. Dropping all whitespace at once was the first prototype: it fixes the reading but makes typing over the selection lose the space between the typed text and the rest (`Z# y`). The tab exclusion came from the sweep: a raw block inside a list item is checked at column 0 but saved two columns in, so a tab that reads as one space here reads as code there (`- \t\# y` saved as `  - \t\# y`). A space has the same width at every column.

[^precedent-join]: Searched for: how the editor decides that two writings of a raw block read alike, and what it writes for an empty item under text. Found: `readingInBlockList` and `blockShape`, which keep a raw block's dedent only when the text "still lexes to the same blocks", and `rawBlockStandsInItem`, which compares item shapes the same way; and `UNDER_TEXT_BULLET` with `listMarkerWriter`'s `bareUnderText`, which write `*` for a bare `-` marker right under a line of text. Escaping was considered for the bare `-` and rejected: `\-` would make the item's line the text `-` continuing `a`, so the item would vanish instead of becoming a heading. The join keeps its one-function shape from `markdown-editor-join-escapes-heading-line` (*One join, every route*); nothing is added on the routes.

[^sweep]: The sweep's invariant is narrow on purpose: none of its documents holds a heading or a code block, and a removal only takes text away, so a heading or a code block in the save can only come from text that became block syntax at a line start. It covers both halves of the class (whitespace and an emptied marker) without encoding the fix. On the tip it reports the samples of the known issues and two more shapes of the same cause: whitespace completing a bare `-` or `*`, and whitespace after a list marker. A tab joined inside an HTML block's text keeps reading as HTML, so the sweep does not see it; the HTML row pins it.

[^in-block]: Inside one raw block the user edits the block's source, shown as source, and the block is read again afterwards; Delete there gives what source mode gives for the same keys. The join is different: there the editor writes another block's text into the raw block, and promises that it keeps meaning what it showed. Making in-block edits keep an emptied item would mean rewriting text the user typed or removed by hand, and would make the WYSIWYG raw block disagree with source mode.

[^backslash]: The known issue was filed by a reload review as a save that looks odd, not one that reloads otherwise; the probe confirms it reloads to the same tree and saves to the same text. CommonMark reads a backslash at a line's end as a hard break also when it is the line's only character, and the viewer's `marked` lexes the line as a `br` token. The heading 3 to 6 case (`#### a  b`, breaks shown as spaces) is the documented heading rule and unchanged.

[^gap-rule]: The plan `markdown-source-mode-commands-through-model`: "A collapsed caret on a blank line between blocks has no place, and the command does nothing. A range end on such a line moves inward" (top-level blocks), and its second review round: "a caret is placed only where its source line tells which node it is in; where the code cannot tell, the command declines". The placement module took a caret past a line end in another block to the next block's start (`BLOCK_END`), which is where acting on the next item came from. The text surgery of `fe498e8dc^` declined on these lines (Addendum), so this restores what source mode did before that plan. Acting on the item before was rejected: a blank line after an item's text is no more that item's than the next one's, and the WYSIWYG surface offers no caret to settle it.

[^seam]: The rule needs both the shown units (for the place before or after) and the source analysis (for whether a leaf block lies on the line); `$placeOfSourceOffset` is the one function that has both. A test in the model alone could not tell a code block's empty line from a blank line between blocks. The raw-block caret mapping keeps the next block because it cannot decline: after an edit makes a raw block show as its blocks, the caret has to stand somewhere.

[^changelog]: The source-mode commands that run through the WYSIWYG model, `tableSource`'s blank-line rule and the raw-block joins all arrived in this unreleased cycle; 0.10.0 had none of them. The chain records a fix to a new feature as a Fixed entry when the entry describing the feature does not cover the case (the raw-block join entry describes the routes, not this reading), and edits the feature's own entry when that entry lists the behaviour (the source-mode Changed entry lists where a command does nothing; the Added entry says where `insertTable` goes). A Fixed entry for the blank line as well would say the same thing twice. The freeze lived only in code deleted before any release, and the backslash changes nothing a consumer sees.
