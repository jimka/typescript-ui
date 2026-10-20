// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Token, Tokens } from "marked";

/**
 * The width of Markdown's tab stops, in columns: a tab advances to the next
 * multiple of four (CommonMark §2.2), whatever width an editor shows it with,
 * so the columns Markdown reads its indentation by are counted with this, not
 * with an editor's `tabSize`.
 *
 * @internal Shared with the editor's Markdown language, not part of the public API surface.
 */
export const MARKDOWN_TAB_STOP = 4;

/**
 * One step of a line's container prefix: a run of spaces and tabs, a quote
 * marker, a list marker that whitespace or the line's end follows, or a task
 * checkbox that whitespace follows. Sticky, so each step is matched where the
 * one before it ended.
 */
const PREFIX_STEP = /[ \t]+|>|(?:[*+-]|\d{1,9}[.)])(?=[ \t]|$)|\[[ xX]\](?=[ \t])/y;

/** Whitespace that holds a tab and runs to the end of a line. */
const TABBED_LINE_END = /^[ \t]*\t[ \t]*$/;

/**
 * The width of a tab that starts at a column: the columns up to the next tab
 * stop.
 *
 * @internal Shared by the tab handling of the lexer and the source analysis, not part of the public API surface.
 *
 * @param column - The column the tab starts at, counted from the line's start.
 * @returns The number of columns it spans.
 */
export function tabWidthAt(column: number): number {
    return MARKDOWN_TAB_STOP - (column % MARKDOWN_TAB_STOP);
}

/**
 * Finds where a line's container prefix ends: its leading run of whitespace,
 * `>` markers and list markers, and a task checkbox when one follows a list
 * marker. The shape of the line decides: a marker character counts wherever
 * it stands in that run, so on a line of paragraph text that happens to begin
 * with one, its tabs are read as the spaces to their stop (which changes only
 * the whitespace they stand for). Whitespace that ends the line is not part of
 * it. `> - [ ] x` ends before `x`; `- a - b` ends before `a`; `>`, a tab, `-`,
 * a tab ends before the last tab.
 *
 * @param line - One line, without its line end.
 * @returns The index of the first character past the prefix.
 */
function prefixEnd(line: string): number {
    let end = 0;
    let afterListMarker = false;

    for (;;) {
        PREFIX_STEP.lastIndex = end;

        const step = PREFIX_STEP.exec(line)?.[0];

        if (step === undefined) {
            return end;
        }

        const first = step.charAt(0);
        const isWhitespace = first === " " || first === "\t";
        const isCheckbox = first === "[";
        const endsLine = end + step.length === line.length;

        if ((isCheckbox && !afterListMarker) || (isWhitespace && endsLine && end > 0)) {
            return end;
        }

        afterListMarker = isWhitespace ? afterListMarker : first !== ">" && !isCheckbox;
        end += step.length;
    }
}

/**
 * Finds where each line's container prefix ends.
 *
 * @internal Shared with the lexer's tab handling and the serializer, not part of the public API surface.
 *
 * @param lines - Lines, without their line ends.
 * @returns For each, the index of the first character past its prefix.
 */
export function containerPrefixEnds(lines: readonly string[]): number[] {
    return lines.map(prefixEnd);
}

/**
 * Tells which lines hold a tab in their container prefix: a tab whose width
 * depends on the column the line starts at.
 *
 * @internal Shared with the editor's serializer, not part of the public API surface.
 *
 * @param lines - Lines, without their line ends.
 * @returns For each, whether its prefix holds a tab.
 */
export function prefixTabLines(lines: readonly string[]): boolean[] {
    const ends = containerPrefixEnds(lines);

    return lines.map((line, index) => line.slice(0, ends[index]).includes("\t"));
}

/**
 * A text with the tabs of its container prefixes written as spaces.
 *
 * @internal Shared with the source analysis, not part of the public API surface.
 */
export interface TabExpansion {
    /** The expanded text. */
    readonly text:    string;
    /** The source offset each character of `text` stands for, and the source's length after the last. */
    readonly offsets: readonly number[];
}

/**
 * One replacement in a line, by character index.
 *
 * @internal Returned by prefixTabEdits, not part of the public API surface.
 */
export interface PrefixTabEdit {
    /** Where the replaced text starts. */
    readonly from:   number;
    /** Where the replaced text ends. */
    readonly to:     number;
    /** The spaces that replace it. */
    readonly insert: string;
}

/**
 * Lists the replacements that write a line's container prefix without tabs:
 * each tab of the prefix becomes the spaces that reach its tab stop, counted
 * from the line's start, and whitespace that holds a tab and ends the line
 * after a marker becomes one space; its width means nothing there, and two
 * or more spaces would end a paragraph line in a hard line break. In `>`,
 * two tabs and `a`, the first tab becomes three spaces and the second four.
 * This is the one statement of the tab rule: the expansion of a text and the
 * editor's Enter and Backspace both apply it.
 *
 * @internal Shared with the editor's Markdown language, not part of the public API surface.
 *
 * @param line - One line, without its line end.
 * @returns The replacements, in line order and not overlapping; empty when the prefix holds no tab.
 */
export function prefixTabEdits(line: string): PrefixTabEdit[] {
    const end = prefixEnd(line);
    const edits: PrefixTabEdit[] = [];
    let column = 0;

    for (let index = 0; index < end; index += 1) {
        const isTab = line[index] === "\t";
        const width = isTab ? tabWidthAt(column) : 1;

        if (isTab) {
            edits.push({ from: index, to: index + 1, insert: " ".repeat(width) });
        }

        column += width;
    }

    const endsInTab = end > 0 && TABBED_LINE_END.test(line.slice(end));

    if (endsInTab) {
        edits.push({ from: end, to: line.length, insert: " " });
    }

    return edits;
}

/**
 * Writes one line's container prefix with its tabs as spaces, recording where
 * each character of the result came from.
 *
 * @param line - One line, without its line end.
 * @param lineStart - The line's offset in the source.
 * @param offsets - Receives the source offset of each character of the result.
 * @returns The line with a tab-free container prefix.
 */
function expandLine(line: string, lineStart: number, offsets: number[]): string {
    let expanded = "";
    let copied = 0;

    for (const edit of prefixTabEdits(line)) {
        for (let at = copied; at < edit.from; at += 1) {
            offsets.push(lineStart + at);
        }

        for (let step = 0; step < edit.insert.length; step += 1) {
            offsets.push(lineStart + edit.from);
        }

        expanded += line.slice(copied, edit.from) + edit.insert;
        copied = edit.to;
    }

    for (let at = copied; at < line.length; at += 1) {
        offsets.push(lineStart + at);
    }

    return expanded + line.slice(copied);
}

/**
 * Writes every tab of each line's container prefix as the spaces that reach
 * its tab stop, counted from the line's start. A line then reads the same with
 * one character per column in its prefix, which is what `marked` counts.
 * Whitespace that ends a line after a marker and holds a tab is written as one
 * space: its width means nothing there, and two or more spaces would end a
 * paragraph line in a hard line break. The list and blockquote tokenizers lex
 * this form, and the source analysis lexes it too, so that both read a tab as
 * the same spaces; `offsets` maps it back to the source.
 *
 * @internal Shared with the lexer and the source analysis, not part of the public API surface.
 *
 * @param text - Lines joined by line feeds.
 * @returns The text with tab-free container prefixes.
 */
export function expandPrefixTabs(text: string): TabExpansion {
    const source = text.split("\n");
    const lines: string[] = [];
    const offsets: number[] = [];
    let lineStart = 0;

    source.forEach((line) => {
        if (lineStart > 0) {
            offsets.push(lineStart - 1);
        }

        lines.push(expandLine(line, lineStart, offsets));
        lineStart += line.length + 1;
    });

    offsets.push(text.length);

    return { text: lines.join("\n"), offsets };
}

/** A range of a source, as the offsets of its first character and just past its last. */
export type SourceRange = readonly [number, number];

/**
 * Finds the lines the list and blockquote tokenizers read with their prefix
 * tabs as spaces: the top-level lists and quotes, and those inside the
 * columns of a `:::` fence, which `marked` lexes block by block. A container
 * inside another is within its range already. The lexer and the source
 * analysis agree on these ranges because both go by the tokens.
 *
 * @internal Shared with the source analysis, not part of the public API surface.
 *
 * @param tokens - Block tokens whose `raw` follow one another from `from`.
 * @param source - The source they were lexed from.
 * @param from - The offset the first token starts at.
 * @returns The ranges, in order.
 */
export function containerRanges(tokens: readonly Token[], source: string, from: number = 0): SourceRange[] {
    const ranges: SourceRange[] = [];
    let position = from;

    for (const token of tokens) {
        const end = position + token.raw.length;

        if (token.type === "list" || token.type === "blockquote") {
            ranges.push([position, end]);
        } else if (token.type === "mdblock") {
            ranges.push(...fenceRanges(token as unknown as { columns: Token[][] }, source, position, end));
        }

        position = end;
    }

    return ranges;
}

/**
 * Finds the container ranges inside the columns of a `:::` fence. Each
 * column's tokens are found in the fence's source by their `raw`.
 *
 * @param fence - The fence token.
 * @param source - The source it was lexed from.
 * @param start - The offset its source starts at.
 * @param end - The offset just past its source.
 * @returns The ranges, in order.
 */
function fenceRanges(fence: { columns: Token[][] }, source: string, start: number, end: number): SourceRange[] {
    const ranges: SourceRange[] = [];
    let cursor = start;

    for (const column of fence.columns) {
        const first = column[0]?.raw ?? "";
        const at = first === "" ? -1 : source.indexOf(first, cursor);

        if (at === -1 || at >= end) {
            continue;
        }

        ranges.push(...containerRanges(column, source, at));
        cursor = at + column.reduce((length, token) => length + token.raw.length, 0);
    }

    return ranges;
}

/**
 * The block token types whose `raw` is set back to the source: the containers,
 * which a raw block shows and a save writes as they are, the blocks that are
 * raw blocks themselves, and the thematic break, whose line a horizontal rule
 * keeps as its state (a rule in a list item keeps the tabs it was written
 * with). The others keep the expanded form their text is read from; a code
 * block's `text` is set back on its own ({@link restoreCodeTexts}).
 */
const SOURCE_KEPT_TYPES: ReadonlySet<string> = new Set(["blockquote", "list", "list_item", "html", "def", "hr"]);

/** A text read in its expanded form, and the source it came from, for restoring tokens' `raw`. */
interface RawContext {
    /** The expanded text's lines. */
    readonly lines:   readonly string[];
    /** The offset of each expanded line's start in the expanded text. */
    readonly starts:  readonly number[];
    readonly source:  string;
    readonly offsets: readonly number[];
    /** The lines of tokens whose `raw` was set back to the source. */
    readonly restored: Set<number>;
}

/**
 * Where a `raw` line stands in an expanded line: `raw` is the line after the
 * container's prefix was taken off, and its end may be trimmed.
 *
 * @param line - The expanded line.
 * @param raw - One line of a token's `raw`.
 * @returns The index in `line` its first character stands at, or `-1` when it is not a part of the line.
 */
function rawStartInLine(line: string, raw: string): number {
    const start = line.trimEnd().length - raw.trimEnd().length;

    return start >= 0 && line.startsWith(raw, start) ? start : -1;
}

/**
 * Finds the line of the expanded text a token's `raw` starts at, whose
 * following lines hold the rest of it.
 *
 * @param context - The expanded text and its source.
 * @param raw - The token's `raw` lines.
 * @param from - The first line to try.
 * @param to - The line past the last one the token may end on; left out, the end of the text.
 * @returns The line index, or `-1`.
 */
function findRawLine(context: RawContext, raw: readonly string[], from: number, to: number = context.lines.length): number {
    for (let line = from; line + raw.length <= to; line += 1) {
        const holds = raw.every((part, at) => rawStartInLine(context.lines[line + at]!, part) !== -1);

        if (holds) {
            return line;
        }
    }

    return -1;
}

/**
 * Writes `length` characters of an expanded line as the source wrote them: a
 * tab whose spaces are all there is a tab again, and the spaces of one that is
 * cut across (the container took some of its columns) stay spaces.
 *
 * @param context - The expanded text and its source.
 * @param line - The expanded line's index.
 * @param start - The index of the first character in the line.
 * @param length - How many characters.
 * @returns The text as the source holds it.
 */
function sourceOfSlice(context: RawContext, line: number, start: number, length: number): string {
    const first = context.starts[line]! + start;
    let text = "";

    for (let at = first; at < first + length; at += 1) {
        const offset = context.offsets[at]!;
        const isTab = context.source[offset] === "\t";
        const isRunStart = at === 0 || context.offsets[at - 1] !== offset;
        let width = 1;

        while (isTab && context.offsets[at + width] === offset) {
            width += 1;
        }

        const isWhole = isTab && isRunStart && at + width <= first + length;

        if (isWhole) {
            text += "\t";
            at += width - 1;
        } else {
            text += isTab ? " " : context.source[offset];
        }
    }

    return text;
}

/**
 * The block tokens inside a token that the lexer read from the same lines.
 *
 * @param token - A block token.
 * @returns Its nested block tokens, in order.
 */
function nestedBlocks(token: Token): Token[] {
    const generic = token as unknown as { tokens?: Token[]; items?: Token[]; columns?: Token[][] };

    if (token.type === "blockquote" || token.type === "list_item") {
        return generic.tokens ?? [];
    }

    return token.type === "list" ? generic.items ?? [] : (generic.columns ?? []).flat();
}

/**
 * Sets the `raw` of each block token, at any depth, back to the source. The
 * lexer read an expanded copy of the lines, so a nested token's `raw` holds
 * the spaces a tab stood for; a raw block shows that text, and a save writes
 * it. Each token's lines are found in the expanded text and written as the
 * source wrote them ({@link sourceOfSlice}). The `text` of each code block is
 * set back to what CommonMark reads from the source ({@link restoreCodeTexts}).
 *
 * @internal Shared with the list and blockquote tokenizers, not part of the public API surface.
 *
 * @param tokens - Block tokens read from `expansion`, in order; their `raw`, and the `text` of their code blocks, are changed.
 * @param expansion - The expanded text they were lexed from.
 * @param source - The source it was expanded from.
 */
export function restoreTokenSources(tokens: readonly Token[], expansion: TabExpansion, source: string): void {
    const lines = expansion.text.split("\n");
    const starts: number[] = [];
    let offset = 0;

    for (const line of lines) {
        starts.push(offset);
        offset += line.length + 1;
    }

    const context: RawContext = { lines, starts, source, offsets: expansion.offsets, restored: new Set() };

    // Before restoreFrom, which sets the containers' `raw` back to the source: the code walk finds them by their expanded lines.
    restoreCodeTexts(context, tokens, 0, lines.length, 0);
    restoreFrom(context, tokens, 0, "walk");
}

/**
 * Sets the `text` of each code block, at any depth, back to what CommonMark
 * reads from the source: the lexer read the expanded copy, in which a tab of
 * a code line's leading whitespace is already the spaces to its stop. Each
 * block is found by its `raw` lines, inside the lines of the container found
 * around it ({@link findRawLine}); a block that is not found keeps the text the
 * lexer read.
 *
 * @param context - The expanded text and its source.
 * @param tokens - Block tokens that follow one another; the `text` of their code blocks is changed.
 * @param from - The line the first starts at, or after.
 * @param to - The line past the last one they may end on.
 * @param quotes - How many quotes hold the tokens.
 */
function restoreCodeTexts(context: RawContext, tokens: readonly Token[], from: number, to: number, quotes: number): void {
    let line = from;

    for (const token of tokens) {
        const raw = token.raw.replace(/\n+$/, "").split("\n");
        const found = token.raw.trim() === "" ? -1 : findRawLine(context, raw, line, to);

        if (found === -1) {
            continue;
        }

        if (token.type === "code") {
            restoreCodeText(context, token as Tokens.Code, found, quotes);
        } else {
            restoreCodeTexts(context, nestedBlocks(token), found, found + raw.length, token.type === "blockquote" ? quotes + 1 : quotes);
        }

        line = found + raw.length;
    }
}

/**
 * Sets one code block's `text` back to what CommonMark reads from the source.
 * Each line of the text ends the expanded line it was read from; it is read
 * again from the source at the same column ({@link sourceFromColumn}). A line
 * that does not end its expanded line, or that misses a `>` of the quotes
 * around the block (a lazy line, which `marked` reads into a quote's code
 * where CommonMark ends the quote), leaves the whole text as the lexer read it.
 *
 * @param context - The expanded text and its source.
 * @param code - The code token; its `text` is changed.
 * @param first - The line its `raw` starts at.
 * @param quotes - How many quotes hold the block.
 */
function restoreCodeText(context: RawContext, code: Tokens.Code, first: number, quotes: number): void {
    // A fence's text starts on the line after its opening fence; an indented block's on its first line.
    const textStart = code.codeBlockStyle === "indented" ? first : first + 1;
    const parts = code.text.split("\n");
    const restored: string[] = [];

    for (const [at, part] of parts.entries()) {
        const index = textStart + at;
        const line = context.lines[index] ?? "";
        const start = line.length - part.length;
        const endsLine = index < context.lines.length && start >= 0 && line.endsWith(part);
        const markers = endsLine ? line.slice(0, start).split(">").length - 1 : 0;

        if (!endsLine || markers < quotes) {
            return;
        }

        restored.push(sourceFromColumn(context, index, start));
    }

    code.text = restored.join("\n");
}

/**
 * Reads the rest of an expanded line from the source, from one of its
 * characters on, as CommonMark reads a code line from a column: a tab that
 * the column cuts across (the container and the block took some of its
 * columns) is the spaces of the columns left of it, and the rest of the line
 * is the source's, every tab kept. `- one`, a blank line, a fence and the
 * code line two spaces, a tab, `bb`, read from column 2, is a tab and `bb`;
 * the line a space, a tab, `bb` is two spaces and `bb`.
 *
 * @param context - The expanded text and its source.
 * @param line - The expanded line's index.
 * @param start - The index of the first character to read, in the line.
 * @returns The rest of the source line, from that column.
 */
function sourceFromColumn(context: RawContext, line: number, start: number): string {
    const first = context.starts[line]! + start;
    const lineEnd = context.offsets[context.starts[line]! + context.lines[line]!.length]!;
    let from = context.offsets[first]!;
    let spaces = "";
    const isCut = context.source[from] === "\t" && first > 0 && context.offsets[first - 1] === from;

    if (isCut) {
        while (context.offsets[first + spaces.length] === from) {
            spaces += " ";
        }

        from += 1;
    }

    return spaces + context.source.slice(from, lineEnd);
}

/**
 * How far {@link restoreFrom} goes: `walk` restores the tokens and what is
 * inside them, `leaf` the tokens alone, `none` nothing.
 */
type RestoreMode = "walk" | "leaf" | "none";

/** A list item whose content a save writes where the source does: its marker at the margin and one space after it. */
const CANONICAL_ITEM = /^(?:[-*+]|\d{1,9}[.)]) \S/;

/**
 * The mode for the blocks inside a token. A save writes a list item's blocks
 * at the item's own content column, and a quote's after `> `, so a tab among
 * them keeps its width only where that column is the source's: in a list item
 * written in the standard form. Blocks deeper than that, or in a quote or an
 * item written otherwise, stay as the lexer read them.
 *
 * @param token - A restored token.
 * @param firstLine - The first line of its `raw`, as the lexer read it.
 * @returns The mode.
 */
function modeInside(token: Token, firstLine: string): RestoreMode {
    if (token.type === "list") {
        return "walk";
    }

    return token.type === "list_item" && CANONICAL_ITEM.test(firstLine) ? "leaf" : "none";
}

/**
 * Restores the `raw` of tokens that follow one another from a line on.
 *
 * @param context - The expanded text and its source.
 * @param tokens - The tokens.
 * @param from - The line the first starts at, or after.
 * @param mode - How far to go.
 */
function restoreFrom(context: RawContext, tokens: readonly Token[], from: number, mode: RestoreMode): void {
    let line = from;

    for (const token of mode === "none" ? [] : tokens) {
        const raw = token.raw.replace(/\n+$/, "").split("\n");
        const found = token.raw.trim() === "" || !SOURCE_KEPT_TYPES.has(token.type) ? -1 : findRawLine(context, raw, line);

        if (found === -1) {
            continue;
        }

        const restored = raw.map((part, at) => {
            const start = rawStartInLine(context.lines[found + at]!, part);

            return sourceOfSlice(context, found + at, start, part.length);
        });

        if (!keepsReading(context, raw, restored, found)) {
            continue;
        }

        token.raw = restored.join("\n") + token.raw.slice(raw.join("\n").length);

        const inside = mode === "leaf" ? "none" : modeInside(token, raw[0]!);

        restoreFrom(context, nestedBlocks(token), found, inside);
        restoreText(context, token, found);
        raw.forEach((_, at) => context.restored.add(found + at));
        line = found + raw.length;
    }
}

/**
 * Sets the `text` of a list item or a quote back to the source on the lines
 * of the tokens inside it whose `raw` was. It is the lines of the container
 * with its prefix taken off, and the editor finds those tokens in it by their
 * `raw`, so a line stays as the tokens on it were read.
 *
 * @param context - The expanded text and its source.
 * @param token - The container token, whose `raw` is already restored.
 * @param first - The line its `raw` starts at.
 */
function restoreText(context: RawContext, token: Token, first: number): void {
    const container = token as unknown as { text?: unknown };

    if ((token.type !== "list_item" && token.type !== "blockquote") || typeof container.text !== "string") {
        return;
    }

    const parts = container.text.split("\n");
    const starts = parts.map((part, at) => rawStartInLine(context.lines[first + at] ?? "", part));

    if (starts.includes(-1) || first + parts.length > context.lines.length) {
        return;
    }

    container.text = parts.map((part, at) => {
        return context.restored.has(first + at) ? sourceOfSlice(context, first + at, starts[at]!, part.length) : part;
    }).join("\n");
}

/**
 * Tells whether lines written as the source wrote them still expand to the
 * lines the lexer read, with the prefix the container took off in front of
 * them: a tab stands for the same spaces only at the same column.
 *
 * @param context - The expanded text and its source.
 * @param raw - The lines of a token's `raw` as the lexer read them.
 * @param restored - The same lines as the source wrote them.
 * @param first - The line the first one stands at.
 * @returns Whether the restored lines read as the lexer's.
 */
function keepsReading(context: RawContext, raw: readonly string[], restored: readonly string[], first: number): boolean {
    return raw.every((part, at) => {
        const line = context.lines[first + at]!;
        const prefix = line.slice(0, rawStartInLine(line, part));

        return expandPrefixTabs(prefix + restored[at]!).text === prefix + part;
    });
}
