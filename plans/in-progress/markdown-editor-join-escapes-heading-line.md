---
depends-on: [markdown-editor-minimal-escapes]
touches-shared: [packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts, packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts]
---

# MarkdownEditor Join Escapes — Implementation Plan

## Overview

When the WYSIWYG `MarkdownEditor` joins the rest of a block into a code block or a raw Markdown block, the joined text gets escapes its source never held. Load ```` ```\ncode\n```\n\n### +alpha ````, delete from the end of `code` to the start of `+alpha`, and the save is ```` ```\ncode\+alpha\n``` ````. The heading's line is `### +alpha`; it never held `\+`. The rest is written by `$inlineMarkdown` ([MarkdownEditor.ts:3183](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3183)) through `$serializeInlineNodes` ([markdownSerializer.ts:1013](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1013)), which writes every rest as a paragraph that opens a line. So it adds the escapes a paragraph's line start needs, even to a heading's text and to a rest that starts mid-line.

The other routes into the same join disagree with Delete. Typing, paste, Enter, Shift+Enter, Tab and cut over the same range, and Backspace/Delete at the boundary when the later block is a heading, quote or list item, go through Lexical's own merge. That merge moves the text in with no escape at all, so `\+ alpha` loses its backslash (`codeZ+ alpha`).

This plan decides what each join writes, puts every route through the one join, and teaches the serializer to write text that continues a line. It touches `MarkdownEditor.ts` (the join and the range guards) and `markdownSerializer.ts` (one new context field, one new export). Line numbers are those of `feature/markdown-editor-minimal-escapes` at `fc1987e85`, the branch this plan builds on.

---

## Architecture Decisions

### What a join writes — code block and raw block differ

A join has two places: the *join point*, where the range ends in the joined block (the rest starts there), and the *joint*, where the range starts in the raw block or code block (the rest lands there).

| Joined into | Written as | Escapes | First line escaped against |
|---|---|---|---|
| a code block | the joined block's own save: a heading's line, a list item's text, a paragraph's or quote's lines | the save's own (lean) escapes | the character before the join point **in the joined block** |
| a raw block | a paragraph's lines, as today | every escape, as today | the character before the joint **in the raw block** |

A code block's text is never read as Markdown, so the only standard is source mode's text: the joined block's save from the join point on (decision G8).[^g8] A raw block's text is read as Markdown where it lands, so it keeps `markdown-editor-minimal-escapes`' rule that joined Markdown keeps every escape, and is escaped for where it lands.[^raw-every-escape]

In both rows, a line-start escape is written on the first line only when that line opens a line: the point is at the joined block's start or right after a line break (code), or the joint is at a raw line's start (raw).

| Source | Range end | Joined into code (after) | Before this plan |
|---|---|---|---|
| `### +alpha` | start of `+alpha` | `code+alpha` | `code\+alpha` |
| `### alpha \#` | start of `alpha #` | `codealpha \#` | `codealpha #` |
| `### x # y` | after `x ` | `code# y` | `code\# y` |
| `\+ alpha` (paragraph) | start | `code\+ alpha` | `code\+ alpha` |
| `+alpha` (paragraph) | start | `code+alpha` | `code\+alpha` |
| `a * b` (paragraph) | start | `codea * b` | `codea \* b` |
| `snake_case_x` | after `snake` | `code_case_x` | `code\_case_x` |
| `x\` then `\- y` on the next line (a hard break) | start of `- y` | `code\- y` | `code\- y` |

### One join, every route

Every route that joins a rich block's rest into a code block or raw block goes through `$deleteRangeFromTextOnlyBlock` ([MarkdownEditor.ts:3084](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3084)):

- **Range commands remove first.** A range that starts inside a raw block or code block and ends outside it (`$isRangeOutOfTextOnlyBlock`) becomes a third shape of `$removeGuardedRange` ([:2636](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2636)), after the table-edge shape and before the stale-focus one. Every command guard that calls it (typing and IME, both pastes, drop, Enter, Shift+Enter, Tab, cut, word/line delete) then removes the range the way Delete does, and runs its input at the caret the removal leaves.[^remove-first]
- **Backspace and Delete at the boundary build the range.** `$joinIntoTextOnlyBlock`'s collapsed branch sets the selection from the text-only block's end to the next block's start, and calls `$deleteRangeFromTextOnlyBlock`. The next block may be a paragraph, a heading, a quote, or a list item's text (through the lists its item opens).[^collapsed-as-range]

This mirrors `$removeRangeBeforeEnter` ([:1163](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1163)), which already removes a range out of a raw block as Delete does before Enter, and the remove-first guards of `markdown-editor-table-command-fixes` (`$removeGuardedRangeForInsert`, `$clearGuardedRangeBeforeParagraph`).

### The serializer learns "continues a line"

`InlineContext` gains `continuesAfter?: string`: the character the content's first line follows. When it is set, `assembleLines`/`renderLine` escape the first text piece against that character instead of a line start, and skip that line's line-start escapes (`escapeLineStart`, `escapeHtmlBlockStart`, a link reference definition's `:`, a task checkbox). The lean check reads the writing after that character.[^continues-after]

The precedent is the existing position flags of `InlineContext` (`inListItem`, `inItemParagraph`), which each change only the escapes a position needs.

### The joined block's save is written by one serializer export

A new export `$serializeRestOfBlock(block, nodes, before)` writes `nodes` — the rest of `block` from a point — in `block`'s own context, the way `block`'s save writes them. `$serializeBlockContent` (heading → code conversion, `markdown-editor-heading-to-code-escapes`) becomes `$serializeRestOfBlock(block, block.getChildren(), "")`, so a code block made from a block and a block joined into a code block share one writer.[^one-writer]

A heading's rest is setext lines when the heading is level 1–2 and the rest holds a newline or starts right after one; otherwise it is an ATX line with its closing `#` run escaped. The closing-run escape counts the line start only when the rest opens the line.[^setext-rest]

---

## Sign-off

| Question | Options | Recommendation |
|---|---|---|
| A join into a code block writes the joined block's lean save (`a * b` stays `a * b`), where `markdown-editor-minimal-escapes` keeps every escape in joined Markdown (`a \* b`). R16 changes to `h a * b **c** kl`. | **A.** Code block: the block's own (lean) save; raw block: every escape, as minimal-escapes decided. **B.** Every escape into both. **C.** The lean save into both. | **A.** A code block's text is never read as Markdown, so G8 (source mode's text, no escape it never held) decides it; a raw block's text is read as Markdown next to other text, where a lean `*` can pair, so minimal-escapes' reason holds there. |

---

## Public API

None. `$serializeRestOfBlock` is exported from `markdownSerializer.ts` for `MarkdownEditor.ts` only; the module is internal (not re-exported from an entry point).

```ts
// markdownSerializer.ts
interface InlineContext {
    // … existing fields …
    readonly continuesAfter?: string;
}

export function $serializeInlineNodes(nodes: LexicalNode[], before?: string): string;          // before defaults to ""
export function $serializeRestOfBlock(block: ElementNode, nodes: LexicalNode[], before: string): string;
export function $serializeBlockContent(block: ElementNode): string;                              // unchanged signature
```

---

## Implementation

### `markdownSerializer.ts`

```ts
/**
 * The character a first line continues after, as {@link InlineContext.continuesAfter} takes it.
 *
 * @param before - The character before the content on its line; `""` or `"\n"` where the content opens its line.
 * @returns The character, or `undefined` at a line's start.
 */
function continuationOf(before: string): string | undefined {
    const opensLine = before === "" || before === "\n";

    return opensLine ? undefined : before;
}

export function $serializeInlineNodes(nodes: LexicalNode[], before: string = ""): string {
    const context: InlineContext = { ...MULTI_LINE, definitions: $collectDefinitions(), joinsMarkdown: true, continuesAfter: continuationOf(before) };

    return serializeInlineNodes(nodes, context);
}

export function $serializeBlockContent(block: ElementNode): string {
    return $serializeRestOfBlock(block, block.getChildren(), "");
}

export function $serializeRestOfBlock(block: ElementNode, nodes: LexicalNode[], before: string): string {
    const definitions = $collectDefinitions();
    const isHeading = $isHeadingNode(block);

    if (isHeading) {
        return writtenHeadingLines(nodes, Number(block.getTag().slice(1)), definitions, before).content;
    }

    const context: InlineContext = {
        ...MULTI_LINE, definitions, inListItem: $isMarkdownListItemTextNode(block), continuesAfter: continuationOf(before),
    };

    return serializeInlineNodes(nodes, context);
}

function writtenHeadingContent(node: HeadingNode, definitions: Links | null): { content: string; setext: boolean } {
    return writtenHeadingLines(node.getChildren(), Number(node.getTag().slice(1)), definitions, "");
}

function writtenHeadingLines(nodes: LexicalNode[], level: number, definitions: Links | null, before: string): { content: string; setext: boolean } {
    const continuesAfter = continuationOf(before);

    if (level <= SETEXT_MAX_LEVEL) {
        // The underline is Markdown the lean rules do not see: `|` over `---` is a table.
        const lines = serializeInlineNodes(nodes, { ...MULTI_LINE, definitions, joinsMarkdown: true, continuesAfter });
        const isMultiLine = lines.includes("\n") || before === "\n";
        const isInterrupted = lines.split("\n").some((line) => SETEXT_INTERRUPTING_LINE.test(line));

        if (isMultiLine && !isInterrupted) {
            return { content: lines, setext: true };
        }
    }

    const line = serializeInlineNodes(nodes, { ...HEADING_LINE, definitions, continuesAfter });

    return { content: escapeClosingHashes(line, before), setext: false };
}

/**
 * Escapes the `#` run an ATX heading's line ends with, which would
 * otherwise read as the heading's closing sequence: a run after a space or
 * a tab, or one that is the whole line — when the line opens there.
 *
 * @param line - The heading's line, or the rest of it from a point.
 * @param before - The character before the line's text; `""` or `"\n"` at the heading's start.
 * @returns The line, its closing run escaped.
 */
function escapeClosingHashes(line: string, before: string): string {
    const runMayOpen = before === "" || /^[ \t\n]$/.test(before);

    return line.replace(/(^|[ \t])(#+)$/, (match: string, space: string, hashes: string) => {
        const isClosing = space !== "" || runMayOpen;

        return isClosing ? space + "\\" + hashes : match;
    });
}
```

`assembleLines` ([:5406](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5406)) — the three changed statements:

```ts
    const continues = context.continuesAfter !== undefined;
    let written = continues;

    lineContents.forEach((pieces, index) => {
        lineContents[index] = strayTaskMarkersAsText(pieces, context.inListItem === true && index === 0 && !continues);
    });

    // … inside lines.map((line, index) => { … }):
        const continuing = continues && index === 0;
        const rendered = renderLine(lineContents[index]!, context, !written, lean, continuing ? context.continuesAfter! : null);
        const content = continuing ? rendered : escapeHtmlBlockStart(rendered, lineContents[index]!, index === 0, context);
```

`renderLine` ([:5803](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5803)) gains a last parameter `continuesAfter: string | null = null`; the first text piece's `before` is `continuesAfter ?? "\n"`, and the line-start escape runs only when `continuesAfter === null`:

```ts
        const before = previous === undefined ? continuesAfter ?? "\n" : previous.kind === "reference" ? "" : previous.text.slice(-1);
    // …
    const opensLine = continuesAfter === null;

    return !context.singleLine && opensLine && pieces[0]?.kind === "text" ? escapeLineStart(rendered, lean) : rendered;
```

`leanOrFull` ([:3185](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3185)) reads both writings after the character the first line continues:

```ts
    // A first line that continues a line is read after the character it follows.
    const prefix = context.continuesAfter ?? "";
    const alike = leanReadsAsFull(prefix + lean, prefix + full, context);
```

### `MarkdownEditor.ts`

```ts
/**
 * Whether a selection is a range from inside a raw Markdown block or a code
 * block to a later block outside it, which {@link $deleteRangeFromTextOnlyBlock}
 * removes by joining that block's rest to the start's block.
 *
 * @param selection - The selection.
 * @returns `true` for such a range.
 */
function $isRangeOutOfTextOnlyBlock(selection: BaseSelection | null): selection is RangeSelection {
    const isRange = $isRangeSelection(selection);
    const isOpen = isRange && !selection.isCollapsed();

    if (!isOpen) {
        return false;
    }

    const [start, end] = $orderedPoints(selection);
    const block = $findMatchingParent(start.getNode(), $isTextOnlyBlock);
    const tailBlock = $findEnclosingBlock(end.getNode());
    const endsInside = block !== null && $findMatchingParent(end.getNode(), (node) => node.is(block)) !== null;

    return block !== null && tailBlock !== null && !endsInside;
}

/**
 * The Markdown the rest of a block joins a raw block or code block as
 * ({@link $deleteRangeFromTextOnlyBlock}): into a code block, as the joined
 * block's own save writes that rest, after the character before the point
 * in that block; into a raw block, as Markdown with every escape, after the
 * character before the joint in the raw block.
 *
 * @param target - The raw block or code block the rest joins.
 * @param source - The block the rest comes from.
 * @param nodes - The rest, detached.
 * @param jointBefore - The raw block's or code block's character before the joint; `""` at its start.
 * @param restBefore - The source block's character before the rest; `""` at its start.
 * @returns The Markdown.
 */
function $joinedMarkdown(target: ElementNode, source: ElementNode, nodes: LexicalNode[], jointBefore: string, restBefore: string): string {
    const isCode = $isCodeNode(target);

    if (isCode) {
        return $inlineMarkdown(nodes, restBefore, (run, before) => $serializeRestOfBlock(source, run, before));
    }

    return $inlineMarkdown(nodes, jointBefore);
}

/**
 * A block's text before a point in it, as `getTextContent()` gives the
 * block's text (a line break is `\n`).
 *
 * @param block - The block.
 * @param point - A point in the block.
 * @returns The text before the point.
 */
function $textBeforePoint(block: ElementNode, point: PointType): string {
    const text = block.getTextContent();
    const node = point.getNode();
    const restOfNode = point.type === "text" ? node.getTextContentSize() - point.offset : 0;
    const after = $nodesAfterPoint(point, block).reduce((size, next) => size + next.getTextContentSize(), 0);

    return text.slice(0, Math.max(0, text.length - restOfNode - after));
}
```

`$inlineMarkdown` ([:3183](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3183)) takes the character before the run and the writer; the leading whitespace it re-adds is what the first character then follows:

```ts
function $inlineMarkdown(
    nodes: LexicalNode[], before: string = "", serialize: (nodes: LexicalNode[], before: string) => string = $serializeInlineNodes,
): string {
    const text = nodes.map((node) => node.getTextContent()).join("");
    const leading = /^[ \t]*/.exec(text)![0];
    const trailing = /[ \t]*$/.exec(text)![0];
    // The serializer trims the leading whitespace, which the first character then follows.
    const markdown = serialize(nodes, leading === "" ? before : leading.slice(-1));

    if (markdown === "") {
        return text.trim() === "" ? text : markdown;
    }

    return leading + markdown.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "") + trailing;
}
```

`$deleteRangeFromTextOnlyBlock` ([:3084](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3084)) — its guard becomes the predicate, and the tail is computed with both characters:

```ts
function $deleteRangeFromTextOnlyBlock(selection: RangeSelection): boolean {
    const isJoin = $isRangeOutOfTextOnlyBlock(selection);

    if (!isJoin) {
        return false;
    }

    const [start, end] = $orderedPoints(selection);
    const block = $findMatchingParent(start.getNode(), $isTextOnlyBlock)!;
    const tailBlock = $findEnclosingBlock(end.getNode())!;
    const startPoint: [string, number, "text" | "element"] = [start.key, start.offset, start.type];
    const jointBefore = $textBeforePoint(block, start).slice(-1);
    const rest = $detachRestOfBlock(tailBlock, end);
    // The rest of a list item, for an end between its blocks, is blocks: they follow the block, they are no text of it.
    const following = $takeBlocksOutOf(rest);
    // What the tail block keeps once its rest is detached is what came before the rest.
    const restBefore = tailBlock.getTextContent().slice(-1);
    const tail = $isTextOnlyBlock(tailBlock) ? rest.getTextContent() : $joinedMarkdown(block, tailBlock, rest.getChildren(), jointBefore, restBefore);
    // … the rest of the function is unchanged from `const range = tailBlock.selectEnd();` on.
}
```

`$joinIntoTextOnlyBlock`'s collapsed branch ([:3036](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3036)):

```ts
    const pair = isBackward ? $textOnlyBlockBeforeBlockStart(selection) : $blockAfterTextOnlyBlockEnd(selection);

    if (pair === null) {
        return false;
    }

    const [block, next] = pair;

    // The join is the range from the block's end to the next block's start, removed as a range is.
    selection.anchor.set(block.getKey(), block.getChildrenSize(), "element");
    selection.focus.set(next.getKey(), 0, "element");

    return $deleteRangeFromTextOnlyBlock(selection);
```

The two pair finders (renamed from `$textOnlyBlockBeforeParagraphStart` / `$paragraphAfterTextOnlyBlockEnd`, [:3266](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3266), [:3284](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3284)):

```ts
/**
 * Whether a block holds the inline content a join into a raw block or code
 * block takes: a paragraph (a list item's text is one), a heading or a quote.
 *
 * @param node - The node.
 * @returns `true` for such a block.
 */
function $isJoinableBlock(node: LexicalNode | null | undefined): node is ElementNode {
    return $isParagraphNode(node) || $isHeadingNode(node) || $isQuoteNode(node);
}

/**
 * The outermost node a block opens: the block, or the list item and list
 * it is the first child of, as far up as each is its parent's first child.
 *
 * @param block - The block.
 * @returns The node whose previous sibling comes before the block.
 */
function $outermostOpenedBy(block: ElementNode): LexicalNode {
    let edge: LexicalNode = block;

    for (;;) {
        const parent = edge.getParent();
        const isFirst = edge.getPreviousSibling() === null;
        const inListPart = $isListItemNode(parent) || $isListNode(parent);
        const climbs = isFirst && inListPart;

        if (!climbs) {
            return edge;
        }

        edge = parent!;
    }
}

/**
 * The block of text a node starts with: the node, or the first item's text
 * of the list (and nested first item) it is.
 *
 * @param node - The node after a raw block or code block.
 * @returns That block, or the node when it is no list.
 */
function $firstTextBlockOf(node: LexicalNode | null): LexicalNode | null {
    let next = node;
    let isListPart = $isListNode(next) || $isListItemNode(next);

    while (isListPart) {
        next = (next as ElementNode).getFirstChild();
        isListPart = $isListNode(next) || $isListItemNode(next);
    }

    return next;
}

function $textOnlyBlockBeforeBlockStart(selection: RangeSelection): [MarkdownRawBlockNode | CodeNode, ElementNode] | null {
    const anchor = selection.anchor;
    const block = $findMatchingParent(anchor.getNode(), $isJoinableBlock);
    const first = block?.getFirstDescendant() ?? null;
    const atStart = anchor.offset === 0 && (anchor.getNode().is(block) || anchor.getNode().is(first));
    const previous = block === null ? null : $outermostOpenedBy(block).getPreviousSibling();

    return block && atStart && $isTextOnlyBlock(previous) ? [previous, block] : null;
}

function $blockAfterTextOnlyBlockEnd(selection: RangeSelection): [MarkdownRawBlockNode | CodeNode, ElementNode] | null {
    const block = $findMatchingParent(selection.anchor.getNode(), $isTextOnlyBlock);
    const next = $firstTextBlockOf(block?.getNextSibling() ?? null);

    return block && $isSelectionAtBlockEnd(block, selection) && $isJoinableBlock(next) ? [block, next] : null;
}
```

`$removeGuardedRange` ([:2636](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2636)) — the new step between the two existing shapes:

```ts
    if (isTableEdge) {
        $removeTableEdgeRange(selection, caretStaysOutOf);

        return true;
    }

    // A range out of a raw block or code block joins the later block's rest as its Markdown, as Delete joins it.
    const isJoin = $isRangeOutOfTextOnlyBlock(selection);

    if (isJoin) {
        return $deleteRangeFromTextOnlyBlock(selection);
    }

    const isStaleFocus = $isStaleFocusRange(selection);
```

---

## Ordered Implementation Steps

1. **Check the base.** `git log --oneline -1` on the implementation branch shows `markdown-editor-minimal-escapes` merged under it. `grep -n "joinsMarkdown: true" packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` gives two matches (`$serializeInlineNodes`, the setext branch). If minimal-escapes changed in its last review, find each site by symbol name.
2. **Write the tests first** (see `## Expected Behaviour`): a new `describe('a join into a code block or raw block writes what the joined block held (J rows)', …)` at the end of `packages/lib/tests/component/markdown-editor-command-crashes.test.ts`, using the file's `load`, `selectText`, `lexicalOf`, `rangeOf`, its paste event stubs (copy them from R13) and `UNDO_COMMAND`. Re-pin R16 there to `'```\nh a * b **c** kl\n```'` and rename it `R16: deleting from a code block's start into a later block joins the rest as that block saves it`. Run `npx vitest run tests/component/markdown-editor-command-crashes.test.ts --maxWorkers=2` from `packages/lib`: the J rows marked "red" fail, R16 fails.
3. **Serializer: `continuesAfter`.** In `markdownSerializer.ts`: add the `InlineContext.continuesAfter` field with the doc comment below, `continuationOf`, the `assembleLines`, `renderLine` and `leanOrFull` changes (`## Implementation`). Field doc: "The character the content's first line follows, for content written after text already on that line (a raw block's or code block's line it joins). That line is escaped against it and takes no escape a line's start needs: no block starter, HTML block start, link reference definition or task checkbox opens there. Absent when the content opens its line."
4. **Serializer: the writers.** Add the `before` parameter to `$serializeInlineNodes` (doc: `@param before - The character the nodes follow on their first line; "" (the default) or "\n" where they open a line.`). Add `$serializeRestOfBlock`, `writtenHeadingLines` and `escapeClosingHashes`; make `writtenHeadingContent` and `$serializeBlockContent` delegate as shown. Move the "A heading's content is written as the heading's save writes it…" sentences of `$serializeBlockContent`'s doc onto `$serializeRestOfBlock`, which adds: "Only the first line of a rest that continues a line (`before` neither `""` nor `\n`) leaves out a line start's escapes." Check: `grep -n '(#+)\$/, "\$1' markdownSerializer.ts` gives no match (the old inline replace is gone).
5. **Run the serializer and heading→code suites:** `npx vitest run tests/component/markdown-serializer.test.ts tests/component/markdown-editor.test.ts --maxWorkers=2` — green (E41 rows and the setext/lean rows unchanged).
6. **Editor: the join.** In `MarkdownEditor.ts`: import `$serializeRestOfBlock`; add `$isRangeOutOfTextOnlyBlock`, `$joinedMarkdown`, `$textBeforePoint`; change `$inlineMarkdown` and `$deleteRangeFromTextOnlyBlock` as shown. In `$deleteRangeFromTextOnlyBlock`'s doc, replace the words "joins as its Markdown" in the first sentence with "joins as {@link $joinedMarkdown} writes it". `$keepTextOnly`'s call `$inlineMarkdown(run)` stays as it is.
7. **Editor: Backspace and Delete at the boundary.** Replace `$joinIntoTextOnlyBlock`'s collapsed branch; rename and generalize the two pair finders; add `$isJoinableBlock`, `$outermostOpenedBy`, `$firstTextBlockOf`. Update `$joinIntoTextOnlyBlock`'s doc: "Handles Backspace at the start of a paragraph, heading, quote or list item's text right after such a block (the first item of a list right after it), Delete at such a block's end before one, and a range deleted from inside such a block into a later block: each through {@link $deleteRangeFromTextOnlyBlock}, a collapsed caret as the range from the block's end to the next block's start." Check: `grep -n 'ParagraphStart\|paragraphAfterTextOnly' MarkdownEditor.ts` gives no match.
8. **Editor: remove first.** Add the join step to `$removeGuardedRange` and name the shape in its doc ("… a table-edge range, else a range out of a raw block or code block ({@link $deleteRangeFromTextOnlyBlock}), else a stale-focus range …"). Add `$isRangeOutOfTextOnlyBlock(selection)` to the `isGuarded` of `$clearGuardedRangeBeforeTyping` ([:2905](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2905)), `$clearGuardedRangeBeforePastedText` ([:2878](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2878)) and `$cutGuardedRange` ([:2965](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2965)), right after the table-edge test, and name the shape in each doc comment. In `$removeRangeBeforeEnter` ([:1163](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1163)) drop the `isTableEdge` / `joinedAsMarkdown` lines: its body becomes `$removeGuardedRange(selection)`, then `removeText()` when that removed nothing; keep its doc's order of shapes.
9. **Run the J rows and the touched suites:** `npx vitest run tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-editor-table-edge.test.ts tests/component/markdown-editor-list-item-edits.test.ts tests/component/markdown-editor-typing-shortcuts.test.ts --maxWorkers=2` — green.
10. **Docs** (`## Documentation Impact`), then `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows are unit-testable in `markdown-editor-command-crashes.test.ts`. `C` is ```` '```\ncode\n```\n\n' ```` and the range starts at `['code', 4]`; `R` is `'<div>\nraw\n</div>\n\n'` and the range starts at `['</div>', 6]`. "Delete" is `DELETE_CHARACTER_COMMAND` with `true`; every range row holds in both directions (anchor and focus swapped). "red" marks a row that fails before the change.

**What the join writes (Delete over the range):**

| Row | Source | Range end | Saved | |
|---|---|---|---|---|
| J1 | `C + '### +alpha'` | `['+alpha', 0]` | ```` '```\ncode+alpha\n```' ```` | red (the repro) |
| J2 | `C + '### alpha \\#'` | `['alpha #', 0]` | ```` '```\ncodealpha \\#\n```' ```` | red |
| J3 | `C + '### x # y'` | `['x # y', 2]` | ```` '```\ncode# y\n```' ```` | red |
| J4 | `C + '+alpha'` | `['+alpha', 0]` | ```` '```\ncode+alpha\n```' ```` | red |
| J5 | `C + '\\+ alpha'` | `['+ alpha', 0]` | ```` '```\ncode\\+ alpha\n```' ```` | control |
| J6 | `C + 'a # b'` | `['a # b', 2]` | ```` '```\ncode# b\n```' ```` | red |
| J7 | `C + 'a * b'` | `['a * b', 0]` | ```` '```\ncodea * b\n```' ```` | red |
| J8 | `C + 'snake_case_x'` | `['snake_case_x', 5]` | ```` '```\ncode_case_x\n```' ```` | red |
| J9 | `C + '> \\- alpha'` | `['- alpha', 0]` | ```` '```\ncode\\- alpha\n```' ```` | control |
| J10 | `C + '- +alpha'` | `['+alpha', 0]` | ```` '```\ncode+alpha\n```' ```` | red |
| J11 | `C + '- \\[ \\] x'` | `['[ ] x', 0]` | ```` '```\ncode\\[ \\] x\n```' ```` | control |
| J12 | `C + 'x\\\n\\- y'` | `['- y', 0]` | ```` '```\ncode\\- y\n```' ```` (after a break: a line start) | control |
| J13 | `C + '+a\nb\n==='` | `['+a', 0]` | ```` '```\ncode\\+a\nb\n```' ```` (setext lines, every escape, as that heading saves) | control |
| J14 | `C + '> a\n> +b'` | `['a', 0]` | ```` '```\ncodea\n+b\n```' ```` (the quote's lines kept) | red |
| K1 | `R + '### +alpha'` | `['+alpha', 0]` | `'<div>\nraw\n</div>+alpha'` | red |
| K2 | `R + 'a * b'` | `['a * b', 0]` | `'<div>\nraw\n</div>a \\* b'` (every escape kept) | control |
| K3 | `R + 'a # b'` | `['a # b', 2]` | `'<div>\nraw\n</div># b'` | red |
| K4 | `R + '### alpha \\#'` | `['alpha #', 0]` | `'<div>\nraw\n</div>alpha #'` | control |

**Every route writes what Delete writes** (one `it.each` over the routes; each route's save equals the row's literal and equals Delete-then-the-input on a fresh editor, and the caret is where Delete-then-the-input leaves it — except J25, literal only: a word delete at the caret Delete leaves needs the browser's `Selection.modify`, which the modelled DOM lacks). Before the change every row here is red: J20–J22 and J24 save their literal but Delete-then-the-input gives `\+alpha`:

| Row | Source, range end | Route | Saved |
|---|---|---|---|
| J20 | `C + '### +alpha'`, `['+alpha', 0]` | type `Z` (`CONTROLLED_TEXT_INSERTION_COMMAND`) | ```` '```\ncodeZ+alpha\n```' ```` |
| J21 | same | plain-text paste `Z` (`PASTE_COMMAND`, R13's event) | ```` '```\ncodeZ+alpha\n```' ```` |
| J22 | same | Enter (`KEY_ENTER_COMMAND`) | ```` '```\ncode\n+alpha\n```' ```` |
| J23 | same | Shift+Enter (`INSERT_LINE_BREAK_COMMAND`) | ```` '```\ncode\n+alpha\n```' ```` (red: changed nothing) |
| J24 | same | Tab (`INSERT_TAB_COMMAND`) | ```` '```\ncode\t+alpha\n```' ```` |
| J25 | same | `DELETE_WORD_COMMAND` | ```` '```\ncode+alpha\n```' ```` |
| J26 | same | `CUT_COMMAND` (await `vi.waitFor`) | ```` '```\ncode+alpha\n```' ```` (red: cut nothing) |
| J27 | `C + '\\+ alpha'`, `['+ alpha', 0]` | type `Z` | ```` '```\ncodeZ\\+ alpha\n```' ```` (red: `codeZ+ alpha`) |
| J28 | `C + '### alpha \\#'`, `['alpha #', 0]` | type `Z` | ```` '```\ncodeZalpha \\#\n```' ```` (red) |
| J29 | `R + 'a * b'`, `['a * b', 0]` | type `Z` | `'<div>\nraw\n</div>Za \\* b'` (red: `Za * b`) |

**Backspace and Delete at the boundary** (caret rows; the saved value equals the range row's):

| Row | Source | Caret, key | Saved | Caret after |
|---|---|---|---|---|
| J30 | `C + '### +alpha'` | `['+alpha', 0]`, Backspace | ```` '```\ncode+alpha\n```' ```` | `"code+alpha"@4` |
| J31 | `C + '### +alpha'` | `['code', 4]`, Delete (`false`) | ```` '```\ncode+alpha\n```' ```` | `"code+alpha"@4` |
| J32 | `C + '> \\- alpha'` | `['- alpha', 0]`, Backspace | ```` '```\ncode\\- alpha\n```' ```` | — |
| J33 | `C + '- +alpha\n\n  para\n- two'` | `['+alpha', 0]`, Backspace | ```` '```\ncode+alpha\n```\n\npara\n\n- two' ```` | — |
| J34 | `C + '1. +alpha\n2. two'` | `['code', 4]`, Delete | ```` '```\ncode+alpha\n```\n\n1. two' ```` | — |
| J35 | `C + '+alpha'` | `['+alpha', 0]`, Backspace | ```` '```\ncode+alpha\n```' ```` | `"code+alpha"@4` |
| J36 | `'para\n\n- +alpha'` | `['+alpha', 0]`, Backspace | `'para+alpha'` (control: no code block, the list rules') | — |
| J37 | `C + '### +alpha'` | J30, then one `UNDO_COMMAND` | `C + '### +alpha'` | — |
| J38 | `C + '### +alpha'` | J20, then one `UNDO_COMMAND` | `C + '### +alpha'` | — |

**Existing rows that must stay:** R14, R15 (`'<div>a \\* b'`), the raw-block Enter rows (`richRanges`, `removeThenEnter`), the table-edge D13/D17 rows, E41 in `markdown-editor.test.ts`. R16 is re-pinned (step 2).

**Manual (Chromium, demo `MarkdownEditor`):** J1 by mouse-drag and Delete; J20 by typing a letter over the drag; J30 by Backspace. The saved text (source-mode toggle) matches the rows.

---

## Verification

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint` from `packages/lib`.
- The J/K rows red before step 3 where marked, green after step 9.
- The full suite once: `npx vitest run --maxWorkers=2` from `packages/lib` (check `free -g` first). On the prototype the full suite gave 19,228 tests with only R16 failing before its re-pin.
- `grep -n 'joinedAsMarkdown' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives no match.
- `npm run docs:api` with zero warnings; `npm run build:lib`.
- The manual rows above.

---

## Documentation Impact

- `packages/lib/docs/components/MarkdownEditor.md`, the raw-block paragraph (the sentence "Backspace at the start of a paragraph after the block (or Delete at the block's end) joins that paragraph to it as its Markdown, and so does the rest of a block a deleted range reaches into from inside it"): say that Backspace at the start of a paragraph, heading, quote or list item's text after the block, and Delete at its end, join it; that typing, pasting, Enter, Shift+Enter, Tab and cut over a range from inside the block into a later block join that block's rest as Delete does; and that a code block takes the rest as that block's own line holds it (`### +alpha` gives `+alpha`), a raw block as Markdown with every escape.
- `packages/lib/docs/reference/changelog/next.md`, under `## Fixed` → `### Components`, after the heading→code entry: "**`MarkdownEditor` joins a block into a code block as that block holds its text.** Deleting from a code block into a heading wrote the heading's text with the escapes a paragraph's line start needs (`### +alpha` gave `\+alpha`), and a rest starting mid-line got them too (`a # b` from after `a ` gave `\# b`); typing, pasting, Enter, Shift+Enter, Tab and cut over the same range, and Backspace at a heading, quote or list item right after the code block, moved the text in with no escape at all (`\+ alpha` gave `+ alpha`). Every route now writes the text as the joined block's own save holds it, as source mode does; a raw block takes it as Markdown with every escape, escaped for where it lands. No consumer action is needed."

---

## Potential Challenges

- **`markdown-editor-minimal-escapes` changes in its last review.** Its `leanOrFull`, `assembleLines` and `renderLine` are where steps 3–4 land; follow the symbols, not the line numbers.
- **`markdown-editor-tab-over-range-before-list` edits the neighbouring guards** (`$removeGuardedRangeForInsert`, `$clearGuardedRangeBeforeParagraph`, `$clearGuardedRangeBeforeLineBreak`). Its changes and this plan's touch different functions; whichever lands second rebases by symbol. Both keep the table-edge shape first.
- **A list-start Backspace changes route.** Backspace at a list's first item right after a code block now runs `$joinIntoTextOnlyBlock` at HIGH priority, ahead of the list item rules at LOW; J33/J34 pin the same block shapes the list rules gave, and `markdown-editor-list-item-edits.test.ts` must stay green.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `$joinIntoTextOnlyBlock` (:3036), `$deleteRangeFromTextOnlyBlock` (:3084), `$detachRestOfBlock` (:3134), `$inlineMarkdown` (:3183), `$keepTextOnly` (:3222), `$nodesAfterPoint` (:3307), `$removeRangeBeforeEnter` (:1163, the remove-first precedent), `$removeGuardedRange` (:2636), the guards at :2855–:2965, `registerTextOnlyBlockRules` (:4415), `registerRangeGuards` (:4457), `$copyBlockAsCodeSource` (:376).
- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts): `InlineContext` (:420), `$serializeInlineNodes` (:1013), `$serializeBlockContent` (:1030), `writtenHeadingContent` (:2434), `leanOrFull` (:3185), `assembleLines` (:5406), `renderLine` (:5803), `escapeHtmlBlockStart` (:5915), `escapeLineStart` (:6172).
- `plans/implemented/markdown-editor-heading-to-code-escapes.md` and `plans/implemented/markdown-editor-minimal-escapes.md` (once landed): the two rules this plan extends.

---

## Non-Goals

- **Preserved source.** The join writes the serializer's writing of the joined block, not the text the document was loaded with; `$serializeBlockContent` does the same.[^one-writer]
- **Emphasis flanking at the joint.** A delimiter run that opens the rest is written as the rest alone needs; only text escapes see `continuesAfter`.
- **`$keepTextOnly`.** Its runs keep today's writing; after this plan no join route reaches it.
- **A rest from inside a `:::` column or table cell.** A table-edge range keeps its own removal; a range into a column joins as Delete already does (the column the rest leaves is removed when empty).

---

## Notes

[^g8]: The owner's decision G8 (2026-10-06, for E41): source mode's text is right, and WYSIWYG must not add escapes the source never held. In source mode, deleting from the end of `code` to the start of `+alpha` leaves the heading's source text `+alpha` behind the joint. The save of a block after `markdown-editor-minimal-escapes` is lean (`+alpha`, `a * b`), so the joined text is the lean writing too. This narrows minimal-escapes' "Markdown joined into other Markdown keeps every escape" to raw blocks: its reason, a bare `*` pairing with a `*` of the raw block, cannot happen in a code block, whose text is never read as Markdown. R16 changes from `h a \* b` to `h a * b` for that reason; see `## Sign-off`.

[^raw-every-escape]: A raw block is a thematic break, an HTML block, a link reference definition, or a quote or list the editor's nodes cannot hold; the viewer reads the last two as Markdown, so a lean `*` joined there can pair with one already in the raw text and read differently from what the joined block showed. Writing for the joined block's context (its heading line) would not help there: the text is read as a line of the raw block. The escapes a line start needs are left out mid-line because the raw line they land on is not a line start (`</div>+alpha`); the alternative, strict G8 for raw blocks too (the lean save), was weighed and left to the owner's sign-off.

[^remove-first]: Before this plan only Delete/Backspace (`$joinIntoTextOnlyBlock`) and Enter in a raw block (`$removeRangeBeforeEnter`) joined this way; every other range command fell through to Lexical's `removeText()`, whose merge moves the rest's plain text in unescaped and leaves `$keepTextOnly` to write only its formatted runs. The prototype measured the routes: typing, both pastes, Enter, Shift+Enter, Tab, cut and word delete now each save what Delete-then-the-input saves (J20–J29). Shift+Enter over the range changed nothing before; after the removal the caret is in the code block, where a break is always written. IME composition start over a range dispatches `CONTROLLED_TEXT_INSERTION_COMMAND` (Lexical 0.49 `$handleCompositionStart`), and a drop inserts through `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`, so both take the typing and paste guards.

[^collapsed-as-range]: Building the range keeps one code path for the text, the caret (at the joint) and the undo step. The old collapsed branch appended `$serializeInlineNodes(paragraph)` and moved the caret itself; the range removal gives the same caret (`"code+alpha"@4`, J30/J35). Backspace at a heading, quote or list item right after a code block was Lexical's merge before, with plain text joined; J33/J34 show the block shapes are those Lexical gave (an item's other blocks stay, a list's later items stay). `MarkdownListItemTextNode` extends `ParagraphNode`, so `$isParagraphNode` covers an item's text.

[^continues-after]: The first piece's `before` decides `_` (intraword), `+` next to `+`, `(`/`{` after `]`, and `@` of an email; mid-line it is the real neighbour, so `snake_case_x` from after `snake` stays `_case_x` (J8). A link reference definition's `:` and a task checkbox only open a block's first line, so `written` starts `true` and `strayTaskMarkersAsText` sees no item first line. The lean check (`leanReadsAsFull`) reads a block alone; reading `# b` alone would read a heading, so both writings are read after the character they follow, which keeps the cache key honest too.

[^one-writer]: `$copyBlockAsCodeSource` (heading → code) already follows G8 through `$serializeBlockContent`; the join is the same question asked of a block's rest instead of its whole. Neither consults the loaded source of an unchanged block: for a setext heading loaded as `+a\nb\n===` both write `\+a` (every escape, minimal-escapes' setext rule), J13.

[^setext-rest]: `writtenHeadingContent` decides setext on the whole heading. The rest alone is a fair stand-in: a rest holding a newline came from a multi-line heading, and a rest starting right after a newline (`before === "\n"`) came from a setext heading's later line. A rest from a setext heading's last line that holds no newline and starts mid-line is written as an ATX line; it differs only for a line ending in a `#` run, which the ATX writing escapes. `escapeClosingHashes` with `before` other than whitespace leaves a run that follows a non-space (`x#` from after `x` stays `#`).
