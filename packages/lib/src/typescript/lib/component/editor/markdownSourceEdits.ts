// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Tokens } from "marked";
import { lineEndAt } from "~/component/display/markdownAttributes.js";
import { analyzeMarkdownSource } from "~/component/editor/markdownSourceTokens.js";
import type { SourceAnalysis, SourceInline } from "~/component/editor/markdownSourceTokens.js";

/**
 * A source-mode edit: the range of the pre-edit text to replace, the
 * replacement, and the selection to leave behind.
 */
export interface MarkdownSourceEdit {
    /** 0-based start of the range in the pre-edit text that `insert` replaces. */
    from: number;
    /** 0-based end (exclusive) of that range. */
    to: number;
    /** The replacement text for `[from, to)`. */
    insert: string;
    /** The selection to leave behind, as 0-based offsets into the post-edit text. */
    selection: { from: number; to: number };
}

/** A source-mode edit rule: the edit to apply for a document and selection, or `null` to change nothing. */
export type MarkdownSourceTransform = (text: string, from: number, to: number) => MarkdownSourceEdit | null;

/** What a source-mode selection can report about itself from raw text alone. */
export interface MarkdownSourceSelectionState {
    bold:            boolean;
    italic:          boolean;
    underline:       boolean;
    strikethrough:   boolean;
    code:            boolean;
    hasSelectedText: boolean;
    linkUrl:         string | null;
}

/** A `[from, to)` range of the source. */
interface SourceRange {
    from: number;
    to:   number;
}

/**
 * Matches one "word" character for the normalised-range collapsed-caret
 * expansion: any Unicode letter or number, plus underscore. Mirrors
 * `MarkdownEditor.ts`'s own `WORD_CHARACTER` (the WYSIWYG side's
 * `$selectEnclosingWordIfCollapsed`) so a caret expands to the same word on
 * either surface. Duplicated rather than imported: this module stays free of
 * DOM, Lexical and components, and `MarkdownEditor.ts` imports from here, so
 * an import the other way would cycle.
 */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

/** The inline token types a normalised range is absorbed into when it covers one exactly. */
const ABSORBED_TYPES: ReadonlySet<string> = new Set(["strong", "em", "del", "underline", "codespan"]);

/** The inline token type of an image: every form arrives as the dialect's `mdimage`. */
const IMAGE_TYPES: ReadonlySet<string> = new Set(["mdimage"]);

// ---------------------------------------------------------------- ranges

/**
 * Normalises a raw `[from, to)` range for
 * {@link readSourceSelectionState}, reading the document's tokens: trims
 * whitespace inward; for a selection that started collapsed (a bare caret),
 * expands it to the enclosing run of word characters, without leaving the
 * content of the innermost emphasis, styled span or link around the caret (so
 * a caret in `_hello world_` takes `world`, not `world_`); clamps a range that
 * reaches into one block's own syntax (a list marker, a heading's `#`) to
 * that block's text; and absorbs an emphasis run or code span the range
 * covers exactly, syntax included, into its content. A real (non-collapsed)
 * selection that trims down to nothing is *not* expanded.
 *
 * @param analysis - The document's analysis.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @returns The normalised range, or `null` when nothing is left to act on.
 */
function normalizeRange(analysis: SourceAnalysis, from: number, to: number): SourceRange | null {
    let range = trimRange(analysis.text, from, to);

    if (from === to) {
        range = expandToWord(analysis, from);
    }

    range = trimRange(analysis.text, ...clampToInlineBlock(analysis, range));

    return range.from >= range.to ? null : absorbCoveredTokens(analysis, range);
}

/**
 * Trims whitespace inward from both ends of a range.
 *
 * @param text - The full document text.
 * @param from - The range's start.
 * @param to - The range's end (exclusive).
 * @returns The trimmed range; empty when it held only whitespace.
 */
function trimRange(text: string, from: number, to: number): SourceRange {
    let start = from;
    let end = to;

    while (start < end && /\s/.test(text[start]!)) { start += 1; }
    while (end > start && /\s/.test(text[end - 1]!)) { end -= 1; }

    return { from: start, to: end };
}

/**
 * Expands a caret to the run of word characters around it, bounded by the
 * content of the innermost emphasis, styled span or link that holds the
 * caret, else by the inline text holding it.
 *
 * @param analysis - The document's analysis.
 * @param caret - The caret's offset.
 * @returns The word's range; empty when no word character touches the caret.
 */
function expandToWord(analysis: SourceAnalysis, caret: number): SourceRange {
    const text = analysis.text;
    const bounds = innermostContentAround(analysis, caret)
        ?? analysis.inlineBlocks.find((block) => block.start <= caret && caret <= block.end)
        ?? { start: 0, end: text.length };
    let start = caret;
    let end = caret;

    while (start > bounds.start && WORD_CHARACTER.test(text[start - 1]!)) { start -= 1; }
    while (end < bounds.end && WORD_CHARACTER.test(text[end]!)) { end += 1; }

    return { from: start, to: end };
}

/**
 * The content of the innermost token with editable content (emphasis, a
 * styled span, a bracketed link's text) holding `caret`, its edges included.
 *
 * @param analysis - The document's analysis.
 * @param caret - The caret's offset.
 * @returns The content's bounds, or `null` when no such token holds the caret.
 */
function innermostContentAround(analysis: SourceAnalysis, caret: number): { start: number; end: number } | null {
    let innermost: SourceInline | null = null;

    for (const inline of analysis.inlines) {
        if (inline.hasContent && inline.innerStart <= caret && caret <= inline.innerEnd
            && (innermost === null || inline.innerStart >= innermost.innerStart)) {
            innermost = inline;
        }
    }

    return innermost === null ? null : { start: innermost.innerStart, end: innermost.innerEnd };
}

/**
 * Clamps a range that reaches into the syntax around one block's inline text
 * — a list marker, a quote's `>`, a heading's `#` run, a table row's pipes —
 * to that text, when it touches no other block's text and lies within the
 * block's own lines. Any other range is returned as it is.
 *
 * @param analysis - The document's analysis.
 * @param range - The trimmed range.
 * @returns The clamped `[from, to)` pair.
 */
function clampToInlineBlock(analysis: SourceAnalysis, range: SourceRange): [number, number] {
    const text = analysis.text;
    const touched = analysis.inlineBlocks.filter((block) => block.start < range.to && range.from < block.end);
    const block = touched.length === 1 ? touched[0]! : null;

    if (block === null) {
        return [range.from, range.to];
    }

    const lineStart = text.lastIndexOf("\n", block.start - 1) + 1;
    const lineEnd = lineEndAt(text, block.end);

    if (range.from < lineStart || range.to > lineEnd) {
        return [range.from, range.to];
    }

    return [Math.max(range.from, block.start), Math.min(range.to, block.end)];
}

/**
 * Absorbs every emphasis run or code span the range covers exactly, syntax
 * included, into its content — `**hello**` selected whole acts on `hello`.
 *
 * @param analysis - The document's analysis.
 * @param range - The range.
 * @returns The absorbed range.
 */
function absorbCoveredTokens(analysis: SourceAnalysis, range: SourceRange): SourceRange {
    let current = range;
    let covered = findCovered(analysis, current);

    while (covered !== undefined) {
        current = { from: covered.innerStart, to: covered.innerEnd };
        covered = findCovered(analysis, current);
    }

    return current;
}

/**
 * Finds the absorbable token whose whole construct is exactly `range`.
 *
 * @param analysis - The document's analysis.
 * @param range - The range.
 * @returns The token, or `undefined`.
 */
function findCovered(analysis: SourceAnalysis, range: SourceRange): SourceInline | undefined {
    return analysis.inlines.find((inline) => ABSORBED_TYPES.has(inline.type) && inline.innerStart !== -1
        && inline.start === range.from && inline.end === range.to && inline.innerStart < inline.innerEnd);
}

/**
 * The innermost token of `type` whose content holds the whole range.
 *
 * @param analysis - The document's analysis.
 * @param range - The normalised range.
 * @param types - The token types to look for.
 * @returns The token, or `null`.
 */
function tokenAround(analysis: SourceAnalysis, range: SourceRange, types: ReadonlySet<string>): SourceInline | null {
    let innermost: SourceInline | null = null;

    for (const inline of analysis.inlines) {
        if (types.has(inline.type) && inline.innerStart !== -1
            && inline.innerStart <= range.from && range.to <= inline.innerEnd
            && (innermost === null || inline.start >= innermost.start)) {
            innermost = inline;
        }
    }

    return innermost;
}

// ---------------------------------------------------------------- links

/**
 * Finds the innermost link or image — any form the viewer reads: inline,
 * reference (`[docs]`, `[docs][]`, `[docs][d]`), angle-bracket, bare-URL,
 * `www.` and email autolinks — whose source holds the whole raw `[from, to]`
 * selection, either end inclusive. An image is reported rather than skipped,
 * so a caller can refuse to act inside its alt text.
 *
 * @param analysis - The document's analysis.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @param except - A link or image to skip (to find the one enclosing it).
 * @returns The enclosing link or image, or `null`.
 */
function findEnclosingLink(analysis: SourceAnalysis, from: number, to: number, except?: SourceInline): SourceInline | null {
    let innermost: SourceInline | null = null;

    for (const inline of analysis.inlines) {
        if ((inline.type === "link" || IMAGE_TYPES.has(inline.type)) && inline !== except && inline.start <= from && to <= inline.end
            && (innermost === null || inline.start >= innermost.start)) {
            innermost = inline;
        }
    }

    return innermost;
}

/**
 * Reads what a source-mode selection can answer from raw text alone — the
 * five inline-format flags, whether there's something to act on, and any
 * enclosing link's URL — through the viewer's own tokens: a flag is set when
 * the normalised selection lies inside that format's content (`**…**` or
 * `__…__` for bold, and so on), and `linkUrl` is the target of the innermost
 * link of any form holding the selection.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @returns The selection's source-mode state.
 */
export function readSourceSelectionState(text: string, from: number, to: number): MarkdownSourceSelectionState {
    const analysis = analyzeMarkdownSource(text);
    const range = normalizeRange(analysis, from, to);
    const link = findEnclosingLink(analysis, from, to);
    const linkUrl = link?.type === "link" ? (link.token as Tokens.Link).href : null;

    if (range === null) {
        return {
            bold: false, italic: false, underline: false, strikethrough: false, code: false,
            hasSelectedText: false,
            linkUrl,
        };
    }

    const isInside = (type: string): boolean => tokenAround(analysis, range, new Set([type])) !== null;

    return {
        bold:            isInside("strong"),
        italic:          isInside("em"),
        underline:       isInside("underline"),
        strikethrough:   isInside("del"),
        code:            isInside("codespan"),
        hasSelectedText: true,
        linkUrl,
    };
}
