// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Makes the built-in "markdown" language's parser count a tab after `#` and
// after `>` as Markdown does: a tab reaches the next multiple of four
// columns (CommonMark §2.2), and read a line whose markers only spaces and
// tabs follow as blank, however many columns they reach. `languages.ts`
// passes MARKDOWN_TAB_STOPS to `markdown()` and hands the parser it gets back
// to readQuoteContinuationTabs. Everything here is types or plain functions, so
// importing this module loads no grammar package.

import type { markdown } from "@codemirror/lang-markdown";

/**
 * The extensions `markdown()` accepts. Named from that function's own
 * signature because `@lezer/markdown`, which declares the type, is not a
 * direct dependency.
 */
export type MarkdownExtension = NonNullable<NonNullable<Parameters<typeof markdown>[0]>["extensions"]>;

/** One parser configuration, as opposed to a list of them. */
export type MarkdownConfig = Exclude<MarkdownExtension, readonly unknown[]>;

/** A block parser of a parser configuration. */
export type BlockParser = NonNullable<MarkdownConfig["parseBlock"]>[number];

/** The parse state a block parser is given. */
type BlockContext = Parameters<NonNullable<BlockParser["parse"]>>[0];

/**
 * The line a block parser reads. `pos` is the first character past the
 * markers the enclosing blocks took, `next` that character's code, and
 * `indent` its column, with tabs counted to Markdown's stops.
 */
type MarkdownLine = Parameters<NonNullable<BlockParser["parse"]>>[1];

/** Character codes the parsers compare against, as `Line.next` holds them. */
const TAB        = "\t".charCodeAt(0);
const SPACE      = " ".charCodeAt(0);
const HASH       = "#".charCodeAt(0);
const QUOTE_MARK = ">".charCodeAt(0);

/** The most `#` characters an ATX heading opens with (CommonMark §4.2): seven are text. */
const MAX_HEADING_LEVEL = 6;

/**
 * The columns a blockquote marker takes when a tab follows it: the `>` and
 * one column of the tab. CommonMark §5.1 gives the marker one optional space,
 * and §2.2 reads a tab there as the spaces to its stop, so the marker takes
 * one of them and the rest belong to the quote's content.
 */
const QUOTE_MARKER_WIDTH = 2;

/**
 * Tells whether a character code is a space or a tab.
 *
 * @param code - A character code.
 * @returns `true` for a space or a tab.
 */
function isSpaceOrTab(code: number): boolean {
    return code === SPACE || code === TAB;
}

/**
 * Reads the level of an ATX heading whose `#` run a tab follows. A space
 * after the run is the stock parser's case and is left to it.
 *
 * @param line - The line the parser is on.
 * @returns The heading's level, 1 to 6, or `-1` when the line is not such a heading.
 */
function headingAfterTabLevel(line: MarkdownLine): number {
    if (line.next !== HASH) {
        return -1;
    }

    let end = line.pos + 1;

    while (end < line.text.length && line.text.charCodeAt(end) === HASH) {
        end++;
    }

    const level = end - line.pos;
    const tabFollows = line.text.charCodeAt(end) === TAB;

    return tabFollows && level <= MAX_HEADING_LEVEL ? level : -1;
}

/**
 * Finds where a heading's closing `#` run starts: a run that ends the text
 * and has a space or a tab before it. `#→Foo·##` closes at the `##`;
 * `#→Foo#` does not close.
 *
 * @param text - The line's text.
 * @param from - Where the opening `#` run starts.
 * @param end - Where the text ends once trailing spaces and tabs are left off.
 * @returns The closing run's start, or `text.length` when there is none.
 */
function closingSequenceStart(text: string, from: number, end: number): number {
    let start = end;

    while (start > from && text.charCodeAt(start - 1) === HASH) {
        start--;
    }

    const isClosing = start < end && start > from && isSpaceOrTab(text.charCodeAt(start - 1));

    return isClosing ? start : text.length;
}

/**
 * Parses an ATX heading whose `#` run a tab follows, into the same nodes the
 * stock parser gives a heading with a space there: `ATXHeading1` to
 * `ATXHeading6`, a `HeaderMark` for each `#` run, and the inline content.
 *
 * @param cx - The parse state.
 * @param line - The line the parser is on.
 * @returns `true` when the line was such a heading and is consumed, otherwise `false`.
 */
function parseHeadingAfterTab(cx: BlockContext, line: MarkdownLine): boolean {
    const level = headingAfterTabLevel(line);

    if (level < 0) {
        return false;
    }

    const text = line.text;
    const from = cx.lineStart + line.pos;
    let contentEnd = text.length;

    while (contentEnd > line.pos && isSpaceOrTab(text.charCodeAt(contentEnd - 1))) {
        contentEnd--;
    }

    const closing = closingSequenceStart(text, line.pos, contentEnd);
    // The text starts one character past the run: the tab.
    const textStart = line.pos + level + 1;

    const children = [
        cx.elt("HeaderMark", from, from + level),
        ...cx.parser.parseInline(text.slice(textStart, closing), cx.lineStart + textStart),
    ];

    if (closing < text.length) {
        children.push(cx.elt("HeaderMark", cx.lineStart + closing, cx.lineStart + contentEnd));
    }

    const heading = cx.elt(`ATXHeading${level}`, from, cx.lineStart + text.length, children);

    cx.nextLine();
    cx.addElement(heading);

    return true;
}

/**
 * Tells whether a line ends the paragraph above it by starting an ATX
 * heading whose `#` run a tab follows, as a heading with a space there does.
 *
 * @param _cx - The parse state.
 * @param line - The line after the paragraph's last line.
 * @returns `true` when the line starts such a heading.
 */
function endsParagraphAtHeadingAfterTab(_cx: BlockContext, line: MarkdownLine): boolean {
    return headingAfterTabLevel(line) >= 0;
}

/**
 * Tells whether a line's next character is a blockquote marker that a tab
 * follows.
 *
 * @param line - The line the parser is on.
 * @returns `true` for `>` and then a tab.
 */
function isQuoteMarkBeforeTab(line: MarkdownLine): boolean {
    return line.next === QUOTE_MARK && line.text.charCodeAt(line.pos + 1) === TAB;
}

/**
 * Starts a blockquote whose `>` a tab follows, with the quote's content at
 * the marker's column plus QUOTE_MARKER_WIDTH. The stock parser starts it
 * one column further left, at the tab. `>` with a space or nothing after it
 * is left to the stock parser.
 *
 * @param cx - The parse state.
 * @param line - The line the parser is on.
 * @returns `null` when it started the quote, otherwise `false`.
 */
function parseBlockquoteAfterTab(cx: BlockContext, line: MarkdownLine): null | false {
    const isQuoteStart = isQuoteMarkBeforeTab(line);

    if (!isQuoteStart) {
        return false;
    }

    const markFrom = cx.lineStart + line.pos;

    cx.startComposite("Blockquote", line.pos);
    cx.addElement(cx.elt("QuoteMark", markFrom, markFrom + 1));
    line.moveBaseColumn(line.indent + QUOTE_MARKER_WIDTH);

    return null;
}

/**
 * Ends a line whose list or blockquote markers, opened on it, only spaces and
 * tabs follow: the line is blank there (CommonMark §4.9), and a blank line
 * opens no indented code block (§4.4), however many columns its whitespace
 * reaches. The stock parser counts that whitespace as the indentation of a
 * code block, so `-→→` holds an empty code block where CommonMark and the
 * viewer read an empty item. The item's content column stays the stock one,
 * one past the marker (§5.2: an item that starts with a blank line), so the
 * lines after it read as before. Any other line is left to the stock
 * parsers: a line that is blank from its start never reaches this one.
 *
 * @param cx - The parse state.
 * @param line - The line the parser is on.
 * @returns `true` when only spaces and tabs are left on the line and it is consumed, otherwise `false`.
 */
function endBlankLineRest(cx: BlockContext, line: MarkdownLine): boolean {
    if (line.pos < line.text.length) {
        return false;
    }

    // What the parser does with a blank line no block parser takes: it moves on to the next line.
    cx.nextLine();

    return true;
}

/**
 * The parser configuration the built-in `"markdown"` language adds through
 * `markdown({ extensions })`. Three block parsers, each placed in front of the
 * stock parser it completes. The first two take only the lines with a tab,
 * the third only a line whose markers only spaces and tabs follow:
 *
 * | Line | Stock reading | With these parsers |
 * | --- | --- | --- |
 * | `#→Foo` | a paragraph | a level-1 heading |
 * | `a`, then `#→b` | one paragraph | a paragraph, then a heading |
 * | `>→-·a`, `>`, `>·····b` | `b` is code after the list | `b` is a paragraph of the item |
 * | `-→→`, `-······`, `>·>·→` | an empty code block in the item or quote | an empty item or quote |
 *
 * A quote's later lines are read by readQuoteContinuationTabs.
 *
 * @internal Used by `languages.ts` only, not part of the public API surface.
 */
export const MARKDOWN_TAB_STOPS: MarkdownConfig = {
    parseBlock: [
        { name: "ATXHeadingAfterTab", before: "ATXHeading", parse: parseHeadingAfterTab, endLeaf: endsParagraphAtHeadingAfterTab },
        { name: "BlockquoteAfterTab", before: "Blockquote", parse: parseBlockquoteAfterTab },
        { name: "BlankLineRest", before: "IndentedCode", parse: endBlankLineRest },
    ],
};

/** The function a parser runs on each later line of an open blockquote, to take its `>`. */
type QuoteContinuation = (block: { end: number }, cx: BlockContext, line: MarkdownLine) => boolean;

/**
 * The two members of `@lezer/markdown`'s `MarkdownParser` that
 * readQuoteContinuationTabs reads. `nodeSet` is public. `skipContextMarkup`,
 * the function per open block type that takes that block's markers off each
 * later line, is internal: it is in no type declaration, and may be renamed
 * by any release.
 */
interface MarkdownParserInternals {
    readonly nodeSet: { readonly types: readonly { readonly name: string; readonly id: number }[] };
    skipContextMarkup?: Readonly<Record<number, QuoteContinuation | undefined>>;
}

/**
 * Makes a Markdown parser take one column of a tab that follows `>` on a
 * blockquote's later lines, as on its first (see MARKDOWN_TAB_STOPS). The
 * stock parser takes the whole tab there, so `> - a` over `>→- b` reads `b`
 * as a second item rather than one nested under `a`.
 *
 * No parser configuration reaches a block's later lines: a configuration
 * that names an existing block type is skipped. So this replaces the entry
 * for `Blockquote` in the parser's internal table of them, on `parser` alone:
 * the table is copied, and the stock entry still reads every line whose `>`
 * no tab follows. When the table or the entry is not there, as in a release
 * that renamed them, the parser is left as it is and reads such lines the
 * stock way.
 *
 * @internal Used by `languages.ts` only, not part of the public API surface.
 *
 * @param parser - The parser of the language `markdown()` returned. It must be that language's own, never `commonmarkLanguage`'s.
 */
export function readQuoteContinuationTabs(parser: object): void {
    const internals = parser as MarkdownParserInternals;
    const blockquote = internals.nodeSet.types.find((type) => type.name === "Blockquote");
    const table = internals.skipContextMarkup;
    const stock = blockquote === undefined || table === undefined ? undefined : table[blockquote.id];

    if (blockquote === undefined || table === undefined || typeof stock !== "function") {
        return;
    }

    const continueQuote: QuoteContinuation = (block, cx, line) => {
        const isQuoteLine = isQuoteMarkBeforeTab(line);

        if (!isQuoteLine) {
            return stock(block, cx, line);
        }

        const markFrom = cx.lineStart + line.pos;

        line.addMarker(cx.elt("QuoteMark", markFrom, markFrom + 1));
        line.moveBaseColumn(line.indent + QUOTE_MARKER_WIDTH);
        // What the stock entry does too: the open quote reaches the end of this line.
        block.end = cx.lineStart + line.text.length;

        return true;
    };

    internals.skipContextMarkup = { ...table, [blockquote.id]: continueQuote };
}
