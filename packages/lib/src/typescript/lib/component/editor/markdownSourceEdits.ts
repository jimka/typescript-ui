// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Tokens } from "marked";
import {
    formatAttributes, lineEndAt, resolveImageSpec, resolveSpanStyle, spanStyleToAttributes,
} from "~/component/display/markdownAttributes.js";
import { needsAngleBrackets } from "~/component/display/markdownDestinations.js";
import { escapeCharacterReferences, startsWithCharacterReference } from "~/component/display/markdownCharacterReferences.js";
import { lexMarkdown } from "~/component/display/markdownExtensions.js";
import {
    analyzeMarkdownSource, canonicalSpanStyle, entryFormat, entryKey, MARK_LETTERS, withMark,
} from "~/component/editor/markdownSourceTokens.js";
import type { EntryFormat, SourceAnalysis, SourceBlockNode, SourceEntry, SourceInline } from "~/component/editor/markdownSourceTokens.js";

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

/** The inline token types clear formatting removes: every emphasis-like run and code span. */
const CLEARED_TYPES: ReadonlySet<string> = ABSORBED_TYPES;

/** The inline token types that are images: the dialect's own, and `marked`'s for one it does not take (a titled image). */
const IMAGE_TYPES: ReadonlySet<string> = new Set(["mdimage", "image"]);

/**
 * The text before a `:` that makes it the colon of a GFM bare-URL autolink.
 * Mirrors the serializer's own `BARE_URL_SCHEME` (`markdownSerializer.ts`, a
 * Lexical module this one must not import).
 */
const BARE_URL_SCHEME = /(?:https?|ftp)$/i;

/** The text before a `.` that makes it the dot of a GFM `www.` autolink; mirrors the serializer's `BARE_WWW_PREFIX`. */
const BARE_WWW_PREFIX = /www$/i;

/** A character of an email autolink's local part; mirrors the serializer's `EMAIL_LOCAL_CHARACTER`. */
const EMAIL_LOCAL_CHARACTER = /^[A-Za-z0-9._+-]$/;

/** A character of an email autolink's domain; mirrors the serializer's `EMAIL_DOMAIN_CHARACTER`. */
const EMAIL_DOMAIN_CHARACTER = /^[A-Za-z0-9_-]$/;

// ---------------------------------------------------------------- ranges

/**
 * Normalises a raw `[from, to)` range for an inline command or
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
 * Whether a range lies inside one block's located inline text — a
 * paragraph, heading, list item or table cell — and so not in a code block,
 * a `:::` fence line, a table delimiter row or across a blank line.
 *
 * @param analysis - The document's analysis.
 * @param range - The range.
 * @returns Whether it does.
 */
function insideInlineBlock(analysis: SourceAnalysis, range: SourceRange): boolean {
    return analysis.inlineBlocks.some((block) => block.start <= range.from && range.to <= block.end);
}

/**
 * The escaped paragraph break a table cell's text carries between two of its
 * paragraphs: backslash-`n` twice, the sequence the viewer splits a cell's
 * text on (`Markdown.ts`'s `CELL_PARAGRAPH_BREAK`).
 */
const CELL_PARAGRAPH_BREAK = "\\n\\n";

/**
 * Whether a range touches a table cell's paragraph break: holds one, or cuts
 * into one. Syntax written around or into it would show it as literal text,
 * or leave a lone `\n` that shows as literal text. Breaks are found the way
 * the viewer splits on them, leftmost first and never overlapping.
 *
 * @param analysis - The document's analysis.
 * @param range - The range.
 * @returns Whether it does.
 */
function touchesCellParagraphBreak(analysis: SourceAnalysis, range: SourceRange): boolean {
    const text = analysis.text;

    return analysis.inlineBlocks.some((block) => {
        if (!block.cell || block.end <= range.from || range.to <= block.start) {
            return false;
        }

        for (let at = text.indexOf(CELL_PARAGRAPH_BREAK, block.start); at !== -1 && at < block.end;) {
            if (at < range.to && range.from < at + CELL_PARAGRAPH_BREAK.length) {
                return true;
            }

            at = text.indexOf(CELL_PARAGRAPH_BREAK, at + CELL_PARAGRAPH_BREAK.length);
        }

        return false;
    });
}

/**
 * Where an inline command writes around a range: the range itself, or the
 * whole code span or autolink when the range is exactly its text — markers
 * written inside the backticks would be code, and inside `<…>` part of the
 * address, not formatting.
 *
 * @param analysis - The document's analysis.
 * @param range - The normalised range.
 * @returns The placement.
 */
function placementFor(analysis: SourceAnalysis, range: SourceRange): SourceRange {
    const atom = analysis.inlines.find((inline) => (inline.type === "codespan" || inline.type === "link")
        && !inline.hasContent && inline.innerStart === range.from && inline.innerEnd === range.to);

    return atom === undefined ? range : { from: atom.start, to: atom.end };
}

/**
 * Whether a range respects every inline token: for each, the range either
 * misses it, holds all of it, or lies inside the content of one with
 * editable content. A range cutting a token's syntax — half of an emphasis
 * run, into a link's destination, inside an autolink, code span, image or
 * escape — does not.
 *
 * @param analysis - The document's analysis.
 * @param range - The range.
 * @returns Whether it does.
 */
function respectsTokens(analysis: SourceAnalysis, range: SourceRange): boolean {
    return analysis.inlines.every((inline) => range.to <= inline.start || inline.end <= range.from
        || (range.from <= inline.start && inline.end <= range.to)
        || (inline.hasContent && inline.innerStart <= range.from && range.to <= inline.innerEnd));
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

// ---------------------------------------------------------------- verification

/**
 * What a command expects one leaf of the document to show after its edit:
 * one format, or the formats it may show, any of which is accepted.
 */
type ExpectedFormat = (entry: SourceEntry) => EntryFormat | readonly EntryFormat[];

/**
 * Keeps an edit only when the edited document reads exactly as expected:
 * re-lexed, its blocks and visible characters are the original's, each
 * showing the format `expect` gives it. This is what keeps a command from
 * writing syntax the viewer reads differently than intended — markers that
 * fail CommonMark's flanking rules, a marker after an escaping backslash, a
 * wrap that re-pairs other markers, a link that would turn into an image —
 * since none of those keeps the document's meaning.
 *
 * @param analysis - The pre-edit document's analysis.
 * @param edit - The candidate edit.
 * @param expect - The format each pre-edit leaf should show afterwards.
 * @returns `edit`, or `null` when the result reads otherwise.
 */
function verified(analysis: SourceAnalysis, edit: MarkdownSourceEdit, expect: ExpectedFormat): MarkdownSourceEdit | null {
    const before = analysis.entries;
    const after = analyzeMarkdownSource(analysis.text.slice(0, edit.from) + edit.insert + analysis.text.slice(edit.to)).entries;

    if (before.length !== after.length) {
        return null;
    }

    for (let index = 0; index < before.length; index += 1) {
        const actual = entryKey(after[index]!, entryFormat(after[index]!));
        const accepted = [expect(before[index]!)].flat().some((format) => entryKey(before[index]!, format) === actual);

        if (!accepted) {
            return null;
        }
    }

    return edit;
}

/**
 * Whether a leaf lies inside a range: a character inside it, or an atom
 * (a code span's or escape's characters, an image) wholly inside it.
 *
 * @param entry - The leaf.
 * @param range - The range.
 * @returns Whether it does.
 */
function inRange(entry: SourceEntry, range: SourceRange): boolean {
    return entry.start !== -1 && range.from <= entry.start && entry.end <= range.to;
}

// ---------------------------------------------------------------- inline toggles

/**
 * Builds an inline-toggle transform for a token type and the marker it
 * writes: bold `strong` / `**`, italic `em` / `*`, strikethrough `del` /
 * `~~`, underline `underline` / `++`, inline code `codespan` / `` ` ``. The
 * document is read through the viewer's own lexer, so a run written in any
 * form it reads (`__bold__`, `_italic_`, `~struck~`) counts.
 *
 * When the normalised range lies inside the content of such a token —
 * however far out, past other formats between — the format is removed from
 * the whole range, as the WYSIWYG toggle removes it (see
 * {@link removeFormat}, and {@link splitCodeSpan} for inline code).
 * Otherwise the markers are written around the range — around a whole code
 * span when the range is its code. Declines (`null`) when the range is not inside one block's inline
 * text (a code block, a fence line, a blank line), cuts any token's syntax
 * (half of another run, inside an autolink or a link's destination), a wrap
 * holds or cuts into a table cell's paragraph break, or (inline code only,
 * via `refuse`) the range still contains a backtick — and when the
 * result would not read back as that format with nothing else changed:
 * markers failing CommonMark's flanking rules (`**hello.**b`), a marker
 * written straight after a backslash (`C:\**Users**`), or a wrap that would
 * re-pair other markers.
 *
 * @param type - The token type the format is read as.
 * @param marker - The marker written on each side.
 * @param refuse - An extra rejection test over the normalised inner text.
 * @returns The transform.
 */
function createInlineToggle(type: string, marker: string, refuse?: (inner: string) => boolean): MarkdownSourceTransform {
    const types = new Set([type]);

    return (text, from, to) => {
        const analysis = analyzeMarkdownSource(text);
        const range = normalizeRange(analysis, from, to);

        if (range === null || !insideInlineBlock(analysis, range) || (refuse?.(text.slice(range.from, range.to)) ?? false)) {
            return null;
        }

        const active = tokenAround(analysis, range, types);

        if (active !== null) {
            return type === "codespan" ? splitCodeSpan(analysis, active, range) : removeFormat(analysis, range, type, marker);
        }

        return wrapRange(analysis, type === "codespan" ? range : placementFor(analysis, range), MARK_LETTERS[type]!, marker);
    };
}

/**
 * Builds the edit writing `marker` on each side of a placement, with the
 * selection on the text between them.
 *
 * @param analysis - The document's analysis.
 * @param placement - Where to write.
 * @param letter - The mark letter the wrapped text should gain.
 * @param marker - The marker.
 * @returns The edit, or `null` when the placement cuts a token or a table
 *   cell's paragraph break, or the result would read otherwise than the
 *   wrapped text gaining the format.
 */
function wrapRange(analysis: SourceAnalysis, placement: SourceRange, letter: string, marker: string): MarkdownSourceEdit | null {
    if (!respectsTokens(analysis, placement) || touchesCellParagraphBreak(analysis, placement)) {
        return null;
    }

    const inner = analysis.text.slice(placement.from, placement.to);
    const edit = {
        from:      placement.from,
        to:        placement.to,
        insert:    marker + inner + marker,
        selection: { from: placement.from + marker.length, to: placement.to + marker.length },
    };

    return verified(analysis, edit, (entry) => {
        const format = entryFormat(entry);

        return inRange(entry, placement) ? withMark(format, letter) : format;
    });
}

// ---------------------------------------------------------------- removing a format

/** CommonMark's whitespace, which a marker run may not sit against on its inner side. */
const WHITESPACE = /\s/;

/** A character of a container's line prefix after a newline: a list item's indentation, a quote's `>`. */
const LINE_PREFIX_CHARACTER = /[ \t>]/;

/**
 * The marker each emphasis type can also be written with, tried when its
 * own marker and the canonical one do not read back: `_` runs are bound by
 * different intraword rules than `*` runs.
 */
const ALTERNATE_MARKERS: Readonly<Record<string, string>> = { strong: "__", em: "_", del: "~", underline: "++" };

/** A visible whitespace leaf, which can stand inside or outside a format alike. */
const WHITESPACE_LEAF = /^t\s$/u;

/** An ASCII punctuation character, which CommonMark lets a backslash escape. */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/g;

/**
 * Whether a piece of a container's content carries the format in the
 * result: `marked` when every visible character in it does, `plain` when
 * none does, `mixed` when some do, `neutral` when it holds only whitespace
 * or no visible character at all, which may stand inside or outside a run.
 */
type ItemStatus = "marked" | "plain" | "mixed" | "neutral";

/** One piece of a container's content: a stretch of its source text, or a child container. */
type ContentItem =
    | { readonly kind: "text"; readonly from: number; readonly to: number; readonly status: ItemStatus }
    | { readonly kind: "node"; readonly inline: SourceInline; readonly status: ItemStatus };

/** What {@link removeFormat} rewrites its region with. */
interface FormatRemoval {
    readonly analysis: SourceAnalysis;
    /** The normalised range losing the format. */
    readonly range:    SourceRange;
    /** The format's token type. */
    readonly type:     string;
    /** The located containers inside the outermost covering token, in document order. */
    readonly nodes:    readonly SourceInline[];
    /** The visible leaves inside the outermost covering token. */
    readonly leaves:   readonly SourceEntry[];
    /** The marker each kept run of the format is written with. */
    readonly marker:   string;
}

/** The text {@link removeFormat} writes, and where the range's text lands in it. */
interface Emission {
    out:           string;
    selectionFrom: number;
    selectionTo:   number;
}

/**
 * Builds the edit removing a format from a whole normalised range that a
 * token of it covers, the way the WYSIWYG toggle removes it: the outermost
 * covering token is rewritten with every token of the format inside it
 * dropped, and the text that keeps the format wrapped again, one run per
 * stretch, at the shallowest level it can stand — so a selection covered
 * twice (`__foo, __bar__ az__` → `__foo,__ bar __az__`), only partly
 * (`**hello world**` → `**hello** world`) or past another container
 * (`***[**zq0029**[r]](/u) z***` → `*[zq0029**[r]**](/u) **z***`) loses the
 * format entirely. Each run is written with the outer token's own marker,
 * else the canonical or the alternate one, whichever first reads back as
 * intended: the range's text without the format, whitespace at its edges
 * either way, and everything else as before (see {@link verified}).
 *
 * @param analysis - The document's analysis.
 * @param range - The normalised range.
 * @param type - The format's token type.
 * @param marker - The format's canonical marker.
 * @returns The edit, or `null` when the range cuts a token's syntax, holds
 *   no visible character, or no marker reads back as intended.
 */
function removeFormat(analysis: SourceAnalysis, range: SourceRange, type: string, marker: string): MarkdownSourceEdit | null {
    const outer = outermostAround(analysis, range, type);
    const inside = analysis.inlines.filter((inline) => outer.start <= inline.start && inline.end <= outer.end);
    const leaves = analysis.entries.filter((entry) => entry.kind === "leaf" && entry.ancestors.includes(outer));
    const cuts = cutsSyntax(inside, range.from) || cutsSyntax(inside, range.to);
    const unlocated = leaves.some((entry) => entry.start === -1);
    const selected = leaves.some((entry) => inRange(entry, range));

    if (cuts || unlocated || !selected) {
        return null;
    }

    const nodes = inside.filter((inline) => inline.hasContent);
    const own = analysis.text.slice(outer.start, outer.innerStart);
    const letter = MARK_LETTERS[type]!;
    const expect = (entry: SourceEntry): EntryFormat | EntryFormat[] => {
        const format = entryFormat(entry);

        if (!entry.ancestors.includes(outer)) {
            return format;
        }

        if (inRange(entry, range)) {
            return withoutMark(format, letter);
        }

        return WHITESPACE_LEAF.test(entry.key) ? [format, withoutMark(format, letter)] : format;
    };

    for (const candidate of new Set([own, marker, ALTERNATE_MARKERS[type]!])) {
        const emission: Emission = { out: "", selectionFrom: -1, selectionTo: -1 };

        emitContent({ analysis, range, type, nodes, leaves, marker: candidate }, outer.innerStart, outer.innerEnd, false, emission);

        const edit = verified(analysis, {
            from:      outer.start,
            to:        outer.end,
            insert:    emission.out,
            selection: { from: outer.start + emission.selectionFrom, to: outer.start + emission.selectionTo },
        }, expect);

        if (edit !== null) {
            return edit;
        }
    }

    return null;
}

/**
 * The outermost token of `type` whose content holds the whole range.
 *
 * @param analysis - The document's analysis.
 * @param range - The normalised range, which such a token holds.
 * @param type - The token type.
 * @returns The token.
 */
function outermostAround(analysis: SourceAnalysis, range: SourceRange, type: string): SourceInline {
    return analysis.inlines.find((inline) => inline.type === type && inline.innerStart !== -1
        && inline.innerStart <= range.from && range.to <= inline.innerEnd)!;
}

/**
 * Whether an offset cuts a token's syntax: lies strictly inside an atom (a
 * code span, an autolink, an image, an escape), or inside the syntax around a
 * container's content.
 *
 * @param inlines - The tokens to test.
 * @param offset - The offset.
 * @returns Whether it does.
 */
function cutsSyntax(inlines: readonly SourceInline[], offset: number): boolean {
    return inlines.some((inline) => (inline.hasContent
        ? (inline.start < offset && offset < inline.innerStart) || (inline.innerEnd < offset && offset < inline.end)
        : inline.start < offset && offset < inline.end));
}

/**
 * Removes one mark letter from a format.
 *
 * @param format - The format.
 * @param letter - The letter to remove, from `MARK_LETTERS`.
 * @returns The new format.
 */
function withoutMark(format: EntryFormat, letter: string): EntryFormat {
    return { ...format, marks: format.marks.replace(letter, "") };
}

/**
 * Writes a container's content with the format moved: outside a run of it
 * (`inRun` false), each maximal stretch of `marked` pieces — `neutral` ones
 * between them included, those at its edges left outside — is wrapped in the
 * marker, and every other piece written as it is, a child container with
 * its own content written the same way; inside a run, everything is written
 * as it is.
 *
 * @param removal - What the region is rewritten with.
 * @param from - The content's start.
 * @param to - The content's end (exclusive).
 * @param inRun - Whether the content already stands inside a run.
 * @param emission - The text written so far, appended to.
 */
function emitContent(removal: FormatRemoval, from: number, to: number, inRun: boolean, emission: Emission): void {
    const items = contentItems(removal, from, to);
    let index = 0;

    while (index < items.length) {
        if (inRun || items[index]!.status !== "marked") {
            emitItem(removal, items[index]!, inRun, emission);
            index += 1;
            continue;
        }

        let last = index;

        for (let next = index; next < items.length && ["marked", "neutral"].includes(items[next]!.status); next += 1) {
            if (items[next]!.status === "marked") {
                last = next;
            }
        }

        emission.out += removal.marker;
        items.slice(index, last + 1).forEach((item) => emitItem(removal, item, true, emission));
        emission.out += removal.marker;
        index = last + 1;
    }
}

/**
 * Writes one piece of content, noting where the range's text starts and
 * ends in the result: before the first piece starting at or after the
 * range's start, after the last one ending at or before its end.
 *
 * @param removal - What the region is rewritten with.
 * @param item - The piece.
 * @param inRun - Whether it stands inside a run.
 * @param emission - The text written so far, appended to.
 */
function emitItem(removal: FormatRemoval, item: ContentItem, inRun: boolean, emission: Emission): void {
    const text = removal.analysis.text;
    const [start, end] = item.kind === "text" ? [item.from, item.to] : [item.inline.start, item.inline.end];

    if (emission.selectionFrom === -1 && start >= removal.range.from) {
        emission.selectionFrom = emission.out.length;
    }

    if (item.kind === "text") {
        emission.out += text.slice(item.from, item.to);
    } else {
        emission.out += text.slice(item.inline.start, item.inline.innerStart);
        emitContent(removal, item.inline.innerStart, item.inline.innerEnd, inRun, emission);
        emission.out += text.slice(item.inline.innerEnd, item.inline.end);
    }

    if (end <= removal.range.to) {
        emission.selectionTo = emission.out.length;
    }
}

/**
 * Splits a container's content into pieces: its direct child containers,
 * and the source text between them, cut at the range's ends and with the
 * whitespace at each stretch's edges a piece of its own. A child token of the
 * format being removed is no piece: its syntax is dropped and its content's
 * pieces stand in its place.
 *
 * @param removal - What the region is rewritten with.
 * @param from - The content's start.
 * @param to - The content's end (exclusive).
 * @returns The pieces, in document order.
 */
function contentItems(removal: FormatRemoval, from: number, to: number): ContentItem[] {
    const items: ContentItem[] = [];
    let at = from;

    for (const child of directChildren(removal.nodes, from, to)) {
        items.push(...textItems(removal, at, child.start));

        if (child.type === removal.type) {
            items.push(...contentItems(removal, child.innerStart, child.innerEnd));
        } else {
            items.push({ kind: "node", inline: child, status: itemStatus(removal, child.start, child.end) });
        }

        at = child.end;
    }

    items.push(...textItems(removal, at, to));

    return items;
}

/**
 * The containers directly inside `[from, to)`: those not inside another one
 * there.
 *
 * @param nodes - The located containers, in document order.
 * @param from - The span's start.
 * @param to - The span's end (exclusive).
 * @returns The direct children, in document order.
 */
function directChildren(nodes: readonly SourceInline[], from: number, to: number): SourceInline[] {
    const children: SourceInline[] = [];

    for (const node of nodes) {
        if (from <= node.start && node.end <= to && node.start >= (children[children.length - 1]?.end ?? from)) {
            children.push(node);
        }
    }

    return children;
}

/**
 * Splits a stretch of source text into pieces: cut at the range's ends, and
 * each part's leading and trailing whitespace a `neutral` piece of its own
 * (a newline counts along with the container prefix after it).
 *
 * @param removal - What the region is rewritten with.
 * @param from - The stretch's start.
 * @param to - The stretch's end (exclusive).
 * @returns The non-empty pieces, in document order.
 */
function textItems(removal: FormatRemoval, from: number, to: number): ContentItem[] {
    const { range } = removal;
    const cuts = [from, ...[range.from, range.to].filter((cut) => from < cut && cut < to), to];
    const items: ContentItem[] = [];

    for (let index = 0; index + 1 < cuts.length; index += 1) {
        const [start, end] = [cuts[index]!, cuts[index + 1]!];
        const coreStart = leadingSpaceEnd(removal.analysis.text, start, end);
        const coreEnd = Math.max(coreStart, trailingSpaceStart(removal.analysis.text, start, end));
        const pieces: Array<[number, number, ItemStatus]> = [
            [start, coreStart, "neutral"],
            [coreStart, coreEnd, itemStatus(removal, coreStart, coreEnd)],
            [coreEnd, end, "neutral"],
        ];

        items.push(...pieces.filter(([pieceStart, pieceEnd]) => pieceStart < pieceEnd)
            .map(([pieceStart, pieceEnd, status]) => ({ kind: "text" as const, from: pieceStart, to: pieceEnd, status })));
    }

    return items;
}

/**
 * Where the whitespace opening a stretch of source text ends: past
 * whitespace, and past a newline together with the container prefix after
 * it.
 *
 * @param text - The full document text.
 * @param from - The stretch's start.
 * @param to - The stretch's end (exclusive).
 * @returns The offset.
 */
function leadingSpaceEnd(text: string, from: number, to: number): number {
    let at = from;

    while (at < to && WHITESPACE.test(text[at]!)) {
        const newline = text[at] === "\n";

        at += 1;

        while (newline && at < to && LINE_PREFIX_CHARACTER.test(text[at]!)) { at += 1; }
    }

    return at;
}

/**
 * Where the whitespace closing a stretch of source text starts: before
 * whitespace, and before a newline together with the container prefix after
 * it.
 *
 * @param text - The full document text.
 * @param from - The stretch's start.
 * @param to - The stretch's end (exclusive).
 * @returns The offset.
 */
function trailingSpaceStart(text: string, from: number, to: number): number {
    let at = to;

    while (at > from) {
        const newline = text.lastIndexOf("\n", at - 1);
        const prefixOnly = newline >= from && [...text.slice(newline + 1, at)].every((char) => LINE_PREFIX_CHARACTER.test(char));

        if (prefixOnly) {
            at = newline;
        } else if (WHITESPACE.test(text[at - 1]!)) {
            at -= 1;
        } else {
            break;
        }
    }

    return at;
}

/**
 * Whether the visible characters in `[from, to)` carry the format in the
 * result: those that carry it now, outside the range.
 *
 * @param removal - What the region is rewritten with.
 * @param from - The piece's start.
 * @param to - The piece's end (exclusive).
 * @returns The piece's status.
 */
function itemStatus(removal: FormatRemoval, from: number, to: number): ItemStatus {
    const visible = removal.leaves.filter((entry) => from <= entry.start && entry.end <= to && !WHITESPACE_LEAF.test(entry.key));
    const marked = visible.filter((entry) => !inRange(entry, removal.range)
        && entry.ancestors.some((ancestor) => ancestor.type === removal.type)).length;

    if (visible.length === 0) {
        return "neutral";
    }

    if (marked === visible.length) {
        return "marked";
    }

    return marked === 0 ? "plain" : "mixed";
}

/**
 * Builds the edit taking a code span's code in the range out of the span:
 * the code before and after it stays code, each part in the span's own
 * backtick run, and the range's text is written as plain text — as written,
 * else with every ASCII punctuation character backslash-escaped, whichever
 * first reads back as the same characters without the code format and
 * everything else as before.
 *
 * @param analysis - The document's analysis.
 * @param code - The code span holding the range.
 * @param range - The normalised range.
 * @returns The edit, or `null` when neither form reads back as intended.
 */
function splitCodeSpan(analysis: SourceAnalysis, code: SourceInline, range: SourceRange): MarkdownSourceEdit | null {
    const text = analysis.text;
    const fence = text.slice(code.start, code.innerStart);
    const left = text.slice(code.innerStart, range.from);
    const right = text.slice(range.to, code.innerEnd);
    const before = left === "" ? "" : fence + left + fence;
    const selected = selectedCodeLeaves(analysis, code, range);
    const expect = (entry: SourceEntry): EntryFormat => (selected.has(entry) ? withoutMark(entryFormat(entry), "c") : entryFormat(entry));
    const raw = text.slice(range.from, range.to);

    for (const middle of new Set([raw, raw.replace(ASCII_PUNCTUATION, "\\$&")])) {
        const edit = verified(analysis, {
            from:      code.start,
            to:        code.end,
            insert:    before + middle + (right === "" ? "" : fence + right + fence),
            selection: { from: code.start + before.length, to: code.start + before.length + middle.length },
        }, expect);

        if (edit !== null) {
            return edit;
        }
    }

    return null;
}

/**
 * The leaves of a code span whose characters lie in the range. A code
 * span's leaves all span the whole span, so they are matched to the code by
 * position: the k-th leaf is the k-th character of the code, past the one
 * space CommonMark strips from each end when both ends carry one.
 *
 * @param analysis - The document's analysis.
 * @param code - The code span.
 * @param range - The range.
 * @returns The selected leaves.
 */
function selectedCodeLeaves(analysis: SourceAnalysis, code: SourceInline, range: SourceRange): Set<SourceEntry> {
    const content = analysis.text.slice(code.innerStart, code.innerEnd);
    const stripped = content.length > 1 && content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "" ? 1 : 0;
    const leaves = analysis.entries.filter((entry) => entry.kind === "leaf" && entry.ancestors[entry.ancestors.length - 1] === code);

    return new Set(leaves.filter((_entry, index) => {
        const offset = code.innerStart + stripped + index;

        return range.from <= offset && offset < range.to;
    }));
}

/** `**text**` — bold; a `__text__` run counts as bold too. */
export const BOLD_SOURCE: MarkdownSourceTransform = createInlineToggle("strong", "**");
/** `*text*` — italic; a `_text_` run counts as italic too. */
export const ITALIC_SOURCE: MarkdownSourceTransform = createInlineToggle("em", "*");
/** `++text++` — underline, this dialect's own marker (see `markdownStyleTransformers.ts`'s `UNDERLINE`). */
export const UNDERLINE_SOURCE: MarkdownSourceTransform = createInlineToggle("underline", "++");
/** `~~text~~` — strikethrough; a `~text~` run counts as struck too. */
export const STRIKETHROUGH_SOURCE: MarkdownSourceTransform = createInlineToggle("del", "~~");
/** `` `text` `` — inline code. Refuses a range that still contains a backtick, which a plain wrap would re-parse differently. */
export const INLINE_CODE_SOURCE: MarkdownSourceTransform = createInlineToggle("codespan", "`", (inner) => inner.includes("`"));

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
 * Whether a range overlaps any link or image.
 *
 * @param analysis - The document's analysis.
 * @param range - The range.
 * @returns Whether it does.
 */
function touchesLinkOrImage(analysis: SourceAnalysis, range: SourceRange): boolean {
    return analysis.inlines.some((inline) => (inline.type === "link" || IMAGE_TYPES.has(inline.type))
        && inline.start < range.to && range.from < inline.end);
}

/**
 * Builds the link toggle transform: wraps the selection in a link to `url`,
 * re-points the enclosing link when the selection already sits inside one, or
 * (`url === null`) unwraps the enclosing link back to plain text. Every link
 * form the viewer reads counts as enclosing. Re-pointing keeps an inline
 * link's title as written and writes any other form — a reference link or an
 * autolink — as an inline link (`[text](url "title")`), so only this link
 * changes target. Unwrapping keeps the link's text; an autolink's text gets
 * its `:`, `.` or `@` escaped, as the serializer escapes it in plain text, so
 * it is not read as a link again. Declines (`null`) when `url` is non-null
 * and there is no enclosing link and nothing to wrap (a collapsed caret with
 * no word under it), or the range would hold a link (links do not nest), cut
 * a token, or hold or cut into a table cell's paragraph break; when `url` is
 * `null` and there is no enclosing link; when the
 * selection sits inside an image, whose alt text a link cannot be nested in;
 * and when the result would not read as intended.
 *
 * @param url - The link target, or `null` to remove the enclosing link.
 * @returns The transform.
 */
export function linkSource(url: string | null): MarkdownSourceTransform {
    return (text, from, to) => {
        const analysis = analyzeMarkdownSource(text);
        const link = findEnclosingLink(analysis, from, to);

        if (link !== null) {
            if (link.type !== "link") {
                return null;
            }

            return url === null ? unlink(analysis, link) : repointLink(analysis, link, url);
        }

        return url === null ? null : wrapInLink(analysis, from, to, url);
    };
}

/** Removes the link enclosing the current selection. Equivalent to `linkSource(null)`. */
export const REMOVE_LINK_SOURCE: MarkdownSourceTransform = linkSource(null);

/**
 * Builds the edit replacing a link with its text. An autolink nested in
 * another link's text (`[<https://a.test/in> b](/out)`) is taken out of the
 * outer link, whose text before and after it each keep the outer link's
 * target (`https\://a.test/in[ b](/out)`), so its text is unlinked rather
 * than joining the outer link, as removing the link in WYSIWYG mode does.
 *
 * @param analysis - The document's analysis.
 * @param link - The link.
 * @returns The edit, or `null` when the result would read otherwise than the
 *   link's text unlinked and everything else unchanged.
 */
function unlink(analysis: SourceAnalysis, link: SourceInline): MarkdownSourceEdit | null {
    if (link.innerStart === -1) {
        return null;
    }

    const inner = analysis.text.slice(link.innerStart, link.innerEnd);
    const insert = link.hasContent ? inner : escapeAutolinkText(inner);
    const without = new Set([link]);
    const outer = findEnclosingLink(analysis, link.start, link.end, link);
    const edit = outer === null ? {
        from:      link.start,
        to:        link.end,
        insert,
        selection: { from: link.start, to: link.start + insert.length },
    } : takeOutOfLink(analysis, outer, link, insert);

    if (edit === null) {
        return null;
    }

    return verified(analysis, edit, (entry) =>
        (entry.ancestors.includes(link) ? { ...entryFormat(entry, without), link: null } : entryFormat(entry)));
}

/**
 * Builds the edit replacing a link nested in an outer link's text with
 * `insert`, outside the outer link: the outer text before it and after it
 * each become a link with the outer link's destination (or reference).
 *
 * @param analysis - The document's analysis.
 * @param outer - The outer link.
 * @param link - The nested link.
 * @param insert - What replaces the nested link.
 * @returns The edit, or `null` when the outer link is not a bracketed one.
 */
function takeOutOfLink(analysis: SourceAnalysis, outer: SourceInline, link: SourceInline, insert: string): MarkdownSourceEdit | null {
    if (!outer.hasContent || outer.innerStart === -1 || analysis.text[outer.start] !== "[") {
        return null;
    }

    const text = analysis.text;
    const destination = text.slice(outer.innerEnd, outer.end);
    const before = text.slice(outer.innerStart, link.start);
    const after = text.slice(link.end, outer.innerEnd);
    const opening = before === "" ? "" : "[" + before + destination;

    return {
        from:      outer.start,
        to:        outer.end,
        insert:    opening + insert + (after === "" ? "" : "[" + after + destination),
        selection: { from: outer.start + opening.length, to: outer.start + opening.length + insert.length },
    };
}

/**
 * Escapes the characters that would make an autolink's text a GFM autolink
 * again as plain text: the `:` of a bare URL's scheme, the `.` after `www`
 * and the `@` of an email address — the serializer's own rules for these
 * three characters — and the `&` of a character reference, which would read
 * as the character it names.
 *
 * @param text - The autolink's text.
 * @returns The text, safe as plain text.
 */
function escapeAutolinkText(text: string): string {
    let escaped = "";

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]!;
        const before = text.slice(0, index);
        const triggers = (char === ":" && BARE_URL_SCHEME.test(before) && text.startsWith("//", index + 1))
            || (char === "." && BARE_WWW_PREFIX.test(before))
            || (char === "@" && EMAIL_LOCAL_CHARACTER.test(text[index - 1] ?? "") && EMAIL_DOMAIN_CHARACTER.test(text[index + 1] ?? ""))
            || (char === "&" && startsWithCharacterReference(text.slice(index)));

        escaped += triggers ? "\\" + char : char;
    }

    return escaped;
}

/**
 * Builds the edit pointing a link at `url`. An inline link keeps its text
 * and its title as written; a reference link or an autolink becomes an
 * inline link holding its text (and a reference link's title). An
 * autolink's text is written with the `&` of each character reference
 * escaped, since as link text it would read as the character it names.
 *
 * @param analysis - The document's analysis.
 * @param link - The link.
 * @param url - The new target.
 * @returns The edit, or `null`.
 */
function repointLink(analysis: SourceAnalysis, link: SourceInline, url: string): MarkdownSourceEdit | null {
    if (link.innerStart === -1) {
        return null;
    }

    const written = analysis.text.slice(link.innerStart, link.innerEnd);
    const text = link.hasContent ? written : escapeCharacterReferences(written);
    const raw = analysis.text.slice(link.start, link.end);
    const title = link.hasContent && raw.endsWith(")")
        ? writtenTitle(raw.slice(link.innerEnd - link.start + 2, -1))
        : quotedTitle((link.token as Tokens.Link).title ?? null);
    const href = hrefOf(url);

    return verified(analysis, {
        from:      link.start,
        to:        link.end,
        insert:    `[${text}](${formatDestination(url)}${title === "" ? "" : " " + title})`,
        selection: { from: link.start + 1, to: link.start + 1 + text.length },
    }, (entry) => {
        const format = entryFormat(entry);

        return entry.ancestors.includes(link) ? { ...format, link: href } : format;
    });
}

/**
 * Reads the title of an inline link as written, delimiters included, from
 * what its parentheses hold: the text after the destination (`<…>`, or a run
 * without whitespace whose parentheses balance).
 *
 * @param parenthesised - The text between the link's `(` and `)`.
 * @returns The title as written, or `""` when the link has none.
 */
function writtenTitle(parenthesised: string): string {
    const body = parenthesised.trimStart();
    let index = 0;

    if (body.startsWith("<")) {
        index = body.indexOf(">") + 1;
    } else {
        let depth = 0;

        while (index < body.length && !/\s/.test(body[index]!) && !(body[index] === ")" && depth === 0)) {
            depth += body[index] === "(" ? 1 : body[index] === ")" ? -1 : 0;
            index += 1;
        }
    }

    return body.slice(index).trim();
}

/**
 * Writes a title in double quotes, its `\` and `"` escaped, and the `&` of
 * each character reference.
 *
 * @param title - The title, or `null`.
 * @returns The quoted title, or `""` for none.
 */
function quotedTitle(title: string | null): string {
    return title === null || title === "" ? "" : `"${escapeCharacterReferences(title.replace(/[\\"]/g, "\\$&"))}"`;
}

/**
 * Writes a link destination: in angle brackets when it holds a character a
 * bare destination cannot hold safely ({@link needsAngleBrackets}), with its
 * `<`, `>` and backslashes escaped inside them. The `&` of a character
 * reference is escaped, so the destination reads back as `url`.
 *
 * @param url - The destination.
 * @returns The destination as written.
 */
function formatDestination(url: string): string {
    const angled = [...url].some((char) => needsAngleBrackets(char));
    const escaped = escapeCharacterReferences(angled ? url.replace(/[\\<>]/g, "\\$&") : url);

    return angled ? `<${escaped}>` : escaped;
}

/**
 * The `href` the viewer gives a link written to `url`, read by lexing one:
 * `marked` may normalise the destination, and a verified edit compares what
 * it reads.
 *
 * @param url - The destination.
 * @returns The `href`.
 */
function hrefOf(url: string): string {
    const paragraph = lexMarkdown(`[x](${formatDestination(url)})`)[0] as Tokens.Paragraph | undefined;
    const link = paragraph?.tokens?.[0];

    return link?.type === "link" ? (link as Tokens.Link).href : url;
}

/**
 * Builds the edit wrapping the normalised selection in a link to `url`.
 *
 * @param analysis - The document's analysis.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @param url - The link target.
 * @returns The edit, or `null` when the range cuts a token or a table cell's
 *   paragraph break, holds a link or image, or the result would read
 *   otherwise.
 */
function wrapInLink(analysis: SourceAnalysis, from: number, to: number, url: string): MarkdownSourceEdit | null {
    const range = normalizeRange(analysis, from, to);

    if (range === null || !insideInlineBlock(analysis, range)) {
        return null;
    }

    const placement = placementFor(analysis, range);

    if (!respectsTokens(analysis, placement) || touchesLinkOrImage(analysis, placement)
        || touchesCellParagraphBreak(analysis, placement)) {
        return null;
    }

    const inner = analysis.text.slice(placement.from, placement.to);
    const href = hrefOf(url);

    return verified(analysis, {
        from:      placement.from,
        to:        placement.to,
        insert:    `[${inner}](${formatDestination(url)})`,
        selection: { from: placement.from + 1, to: placement.from + 1 + inner.length },
    }, (entry) => {
        const format = entryFormat(entry);

        return inRange(entry, placement) ? { ...format, link: href } : format;
    });
}

// ---------------------------------------------------------------- styled spans

/** The span attribute key for each kebab-case CSS property the three style setters patch. */
const ATTRIBUTE_KEY_BY_CSS_PROPERTY: Record<string, string | undefined> = {
    "color":       "color",
    "font-family": "font",
    "font-size":   "size",
};

/** One located styled span: the whole construct's range, its visible text's range, and its attributes. */
interface StyledSpanMatch {
    start:      number;
    end:        number;
    textStart:  number;
    textEnd:    number;
    attributes: Record<string, string>;
}

/**
 * The document's `[text]{key=value …}` styled spans, read from the viewer's
 * own `styledspan` tokens — a span whose text could not be located is left
 * out, and the verification of any rewrite touching it then declines.
 *
 * @param analysis - The document's analysis.
 * @returns The located spans, in document order.
 */
function findStyledSpans(analysis: SourceAnalysis): StyledSpanMatch[] {
    return analysis.inlines
        .filter((inline) => inline.type === "styledspan" && inline.innerStart !== -1)
        .map((inline) => ({
            start:      inline.start,
            end:        inline.end,
            textStart:  inline.innerStart,
            textEnd:    inline.innerEnd,
            attributes: spanAttributes(inline),
        }));
}

/**
 * A styled span token's parsed attributes.
 *
 * @param inline - The `styledspan` token.
 * @returns Its attributes.
 */
function spanAttributes(inline: SourceInline): Record<string, string> {
    return (inline.token as unknown as { attributes: Record<string, string> }).attributes;
}

/**
 * Resolves the range {@link spanStyleSource} acts on: refuse a raw range
 * containing a newline (this module writes a span within one line, though
 * the viewer and the importer read one across a newline); normalise with
 * {@link normalizeRange}; take a whole code span when the range is its code;
 * then refuse a range outside one block's inline text (a code block, a `:::`
 * fence line, a table delimiter row), one touching a link or image (its
 * text, destination or an image's `{width=…}` group), one cutting any
 * other token's syntax, and one holding or cutting into a table cell's
 * paragraph break ({@link touchesCellParagraphBreak}).
 *
 * The brackets go where the range is, inside any emphasis around it —
 * `**[hello]{…}**` for a whole bold run, the form the serializer writes.
 *
 * @param analysis - The document's analysis.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @returns The range to act on, or `null` when the span syntax cannot be
 *   written around it.
 */
function resolveSpanRange(analysis: SourceAnalysis, from: number, to: number): SourceRange | null {
    if (analysis.text.slice(from, to).includes("\n")) {
        return null;
    }

    const range = normalizeRange(analysis, from, to);

    if (range === null || !insideInlineBlock(analysis, range)) {
        return null;
    }

    const placement = placementFor(analysis, range);

    if (touchesLinkOrImage(analysis, placement) || !respectsTokens(analysis, placement)) {
        return null;
    }

    return touchesCellParagraphBreak(analysis, placement) ? null : placement;
}

/**
 * Translates the kebab-case CSS patch the three style setters build into the
 * dialect's shorter attribute keys.
 *
 * @param patch - The CSS patch.
 * @returns The attribute patch, or `null` when the patch names a CSS property
 *   the span syntax has no attribute key for.
 */
function toAttributePatch(patch: Record<string, string | null>): Record<string, string | null> | null {
    const attributePatch: Record<string, string | null> = {};

    for (const [property, value] of Object.entries(patch)) {
        const key = ATTRIBUTE_KEY_BY_CSS_PROPERTY[property];

        if (key === undefined) {
            return null;
        }

        attributePatch[key] = value;
    }

    return attributePatch;
}

/** One stretch of *visible* text inside the rewritten range, with the attributes it carries. */
interface StyledUnit {
    from:       number;
    to:         number;
    attributes: Record<string, string>;
}

/**
 * Walks `[start, end)` left to right into an alternating list of units: each
 * span contributes its text range with its own attributes, and every stretch
 * between spans contributes itself with none. The span syntax itself (`[`,
 * `]`, `{…}`) belongs to no unit — it is re-emitted rather than carried.
 *
 * @param start - The rewritten range's start.
 * @param end - The rewritten range's end (exclusive).
 * @param spans - Every styled span in the document.
 * @returns The units, in document order.
 */
function collectStyledUnits(start: number, end: number, spans: StyledSpanMatch[]): StyledUnit[] {
    const units: StyledUnit[] = [];
    let cursor = start;

    for (const span of spans) {
        if (span.start < start || span.end > end) {
            continue;
        }

        if (cursor < span.start) {
            units.push({ from: cursor, to: span.start, attributes: {} });
        }

        units.push({ from: span.textStart, to: span.textEnd, attributes: span.attributes });
        cursor = span.end;
    }

    if (cursor < end) {
        units.push({ from: cursor, to: end, attributes: {} });
    }

    return units;
}

/** One run of visible text the rewrite re-emits, with the attributes it carries. */
interface StyledPiece {
    text:       string;
    attributes: Record<string, string>;
    patched:    boolean;
}

/**
 * Splits one unit into its three pieces at the selection's boundaries, already
 * clamped into the unit — which is also what handles a selection boundary
 * landing inside a span's own syntax: an offset inside `[` clamps to the
 * text's start and one inside `]{…}` to its end, so that span's text is simply
 * not patched.
 *
 * @param text - The full document text.
 * @param unit - The unit to split.
 * @param selectionFrom - The selection's start, clamped into the unit.
 * @param selectionTo - The selection's end, clamped into the unit.
 * @returns The before / selected / after pieces, in that order.
 */
function splitUnitAtSelection(
    text: string, unit: StyledUnit, selectionFrom: number, selectionTo: number,
): StyledPiece[] {
    return [
        { text: text.slice(unit.from, selectionFrom),  attributes: unit.attributes, patched: false },
        { text: text.slice(selectionFrom, selectionTo), attributes: unit.attributes, patched: true },
        { text: text.slice(selectionTo, unit.to),       attributes: unit.attributes, patched: false },
    ];
}

/** The span attribute keys the dialect models, the ones {@link ATTRIBUTE_KEY_BY_CSS_PROPERTY} maps to. */
const MODELLED_ATTRIBUTE_KEYS: ReadonlySet<string | undefined> = new Set(Object.values(ATTRIBUTE_KEY_BY_CSS_PROPERTY));

/**
 * Merges `patch` into a span's attributes: a `null` value removes its key.
 *
 * @param attributes - The span's attributes.
 * @param patch - The attribute patch.
 * @returns The merged attributes.
 */
function mergePatch(attributes: Record<string, string>, patch: Record<string, string | null>): Record<string, string> {
    const merged = { ...attributes };

    for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
            delete merged[key];
        } else {
            merged[key] = value;
        }
    }

    return merged;
}

/**
 * Resolves the attribute set one piece is emitted with: its own attributes,
 * with `patch` merged in when the piece is patched. The dialect's own keys go
 * through the `resolveSpanStyle` / `spanStyleToAttributes` pair the
 * serializer (`markdownSerializer.ts`) writes a span's style with — which
 * drops an invalid value exactly as that serializer drops it, and orders the
 * keys `color`, `font`, `size`; a key the dialect does not model is the
 * author's, so it is kept as written, after them.
 *
 * @param piece - The piece to resolve.
 * @param patch - The attribute patch, applied only when `piece.patched`.
 * @returns The resolved attributes; empty when the piece carries none.
 */
function resolvePieceAttributes(piece: StyledPiece, patch: Record<string, string | null>): Record<string, string> {
    const merged = piece.patched ? mergePatch(piece.attributes, patch) : piece.attributes;

    const unmodelled = Object.entries(merged).filter(([key]) => !MODELLED_ATTRIBUTE_KEYS.has(key));

    return { ...spanStyleToAttributes(resolveSpanStyle(merged)), ...Object.fromEntries(unmodelled) };
}

/** Adjacent pieces sharing one resolved attribute set, emitted together as one span or one bare stretch. */
interface StyledRun {
    text:        string;
    attributes:  Record<string, string>;
    /** Offset within `text` of the run's first patched character, or `-1` when no patched piece joined it. */
    patchedFrom: number;
    /** Offset within `text` just past the run's last patched character. */
    patchedTo:   number;
}

/**
 * Groups the pieces into runs, joining each non-empty piece onto the previous
 * run when both resolve to the same attribute set. Lexical keeps one text node
 * per distinct style and merges equal neighbours, so emitting equal
 * neighbours as separate spans would write bytes the WYSIWYG export never
 * would — fragmenting a span on a redundant press, and re-normalising on the
 * next mode switch.
 *
 * @param pieces - Every piece of the rewritten range, in document order.
 * @param patch - The attribute patch, applied to the patched pieces.
 * @returns The runs, in document order.
 */
function groupPiecesIntoRuns(pieces: StyledPiece[], patch: Record<string, string | null>): StyledRun[] {
    const runs: StyledRun[] = [];

    for (const piece of pieces) {
        if (piece.text === "") {
            continue;
        }

        const attributes = resolvePieceAttributes(piece, patch);
        let run = runs[runs.length - 1];

        if (run === undefined || formatAttributes(run.attributes) !== formatAttributes(attributes)) {
            run = { text: "", attributes, patchedFrom: -1, patchedTo: -1 };
            runs.push(run);
        }

        if (piece.patched) {
            if (run.patchedFrom === -1) {
                run.patchedFrom = run.text.length;
            }

            run.patchedTo = run.text.length + piece.text.length;
        }

        run.text += piece.text;
    }

    return runs;
}

/**
 * Re-emits one run: bare text when its attribute set is empty, else
 * `[text]{…}`. Every group goes out through the same three calls the
 * serializer's span style makes (the first two in {@link resolvePieceAttributes},
 * `formatAttributes` here), so the bytes written for one group are the bytes
 * WYSIWYG would have written for the same style — which is what makes a span
 * authored in source mode survive a switch to WYSIWYG and back unchanged.
 *
 * @param run - The run to emit.
 * @returns The emitted Markdown, or `null` to decline the whole edit when a
 *   bracketed emission would carry a `[` or `]`, which the dialect's span text
 *   cannot hold.
 */
function emitRun(run: StyledRun): string | null {
    if (Object.keys(run.attributes).length === 0) {
        return run.text;
    }

    return /[[\]]/.test(run.text) ? null : `[${run.text}]{${formatAttributes(run.attributes)}}`;
}

/**
 * Grows `range` into the range the rewrite replaces: out over every span it
 * intersects, so a span the selection only clips is re-emitted whole, and then
 * over every span abutting that, so a neighbour that ends up equally styled
 * can be emitted as one span with it ({@link groupPiecesIntoRuns}).
 *
 * @param range - The range to patch, from {@link resolveSpanRange}.
 * @param spans - Every styled span in the document, in document order.
 * @returns The rewritten range's `[start, end)`.
 */
function growOverStyledSpans(range: SourceRange, spans: StyledSpanMatch[]): { start: number; end: number } {
    const touched = spans.filter((span) => span.start < range.to && range.from < span.end);
    let start = Math.min(range.from, ...touched.map((span) => span.start));
    let end = Math.max(range.to, ...touched.map((span) => span.end));

    // `spans` is in document order, so one backward pass grows `start` over a
    // chain of abutting spans and one forward pass grows `end`.
    for (let index = spans.length - 1; index >= 0; index -= 1) {
        if (spans[index]!.end === start) {
            start = spans[index]!.start;
        }
    }

    for (const span of spans) {
        if (span.start === end) {
            end = span.end;
        }
    }

    return { start, end };
}

/**
 * Whether re-emitting `units` would cut a token in two. Each unit goes out as
 * its own group, so a token inside the rewritten range must lie inside one
 * unit: an emphasis run holding plain text and a span — the whole of
 * `x **a [b]{…} c** y` restyled — would have its markers land in different
 * brackets and read back as literal characters. A token holding the whole
 * rewritten range stays outside the brackets and is no concern.
 *
 * @param analysis - The document's analysis.
 * @param units - The rewritten range's units, from {@link collectStyledUnits}.
 * @param start - The rewritten range's start.
 * @param end - The rewritten range's end (exclusive).
 * @returns Whether the rewrite must decline.
 */
function unitsCutToken(analysis: SourceAnalysis, units: StyledUnit[], start: number, end: number): boolean {
    return analysis.inlines.some((inline) => inline.start < end && start < inline.end
        && !(inline.start <= start && end <= inline.end)
        && !(inline.type === "styledspan" && start <= inline.start && inline.end <= end)
        && !units.some((unit) => unit.from <= inline.start && inline.end <= unit.to));
}

/**
 * Whether the character at `index` is backslash-escaped — preceded by an odd
 * run of backslashes, which makes it literal text rather than syntax.
 *
 * @param text - The full document text.
 * @param index - The character's offset.
 * @returns Whether a backslash escapes it.
 */
function isEscaped(text: string, index: number): boolean {
    let backslashes = 0;

    while (index - backslashes - 1 >= 0 && text[index - backslashes - 1] === "\\") { backslashes += 1; }

    return backslashes % 2 === 1;
}

/**
 * Emits the runs as the replacement for the range starting at `start`, and
 * finds where the patched text lands in the rewritten document.
 *
 * A bracketed run is checked against the backslash escapes around it: a `[`
 * written straight after an escaping backslash (`C:\[Users]{…}`), or a `]`
 * written straight after a run text ending in one (`[a\]{…}`), is a literal
 * bracket, so the span would not read back and its syntax would show as
 * prose — and the backslash would stop escaping what it escaped before.
 *
 * @param text - The full document text.
 * @param runs - The runs, from {@link groupPiecesIntoRuns}.
 * @param start - The rewritten range's start, unchanged by the edit.
 * @returns The replacement text and the selection over the patched text
 *   (`null` when no run carries patched text), or `null` when a run declines
 *   or a bracket would land escaped.
 */
function emitRuns(
    text: string, runs: StyledRun[], start: number,
): { insert: string; selection: { from: number; to: number } | null } | null {
    const before = text.slice(0, start);
    let insert = "";
    let selectionFrom = -1;
    let selectionTo = -1;

    for (const run of runs) {
        const emitted = emitRun(run);

        if (emitted === null) {
            return null;
        }

        const bracketed = emitted !== run.text;

        if (bracketed) {
            const preceding = before + insert;

            if (isEscaped(preceding, preceding.length) || isEscaped(run.text, run.text.length)) {
                return null;
            }
        }

        if (run.patchedFrom !== -1) {
            // A bracketed emission holds its text one `[` in; a bare one
            // holds it at its own start. `start` is the unchanged prefix's
            // end, so this is already an offset into the POST-edit text.
            const textAt = start + insert.length + (bracketed ? 1 : 0);

            if (selectionFrom === -1) {
                selectionFrom = textAt + run.patchedFrom;
            }

            selectionTo = textAt + run.patchedTo;
        }

        insert += emitted;
    }

    return { insert, selection: selectionFrom === -1 ? null : { from: selectionFrom, to: selectionTo } };
}

/**
 * Rewrites the styled spans around `range` with `patch` merged into the
 * selected part of each, over the range {@link growOverStyledSpans} gives. The
 * selection left behind lands on the user's own text inside the brackets,
 * from the first patched piece's text to the last one's.
 *
 * @param analysis - The document's analysis.
 * @param range - The range to patch, from {@link resolveSpanRange}.
 * @param patch - The attribute patch.
 * @returns The edit, or `null` when the rewrite would cut a token in two,
 *   when a run declines, when a bracket would land escaped, when the rewrite
 *   equals what it replaces, when the selection patched no visible text at
 *   all, or when the result would read otherwise than the selected text
 *   taking the patched style.
 */
function rewriteStyledSpans(
    analysis: SourceAnalysis, range: SourceRange, patch: Record<string, string | null>,
): MarkdownSourceEdit | null {
    const text = analysis.text;
    const spans = findStyledSpans(analysis);
    const { start, end } = growOverStyledSpans(range, spans);
    const units = collectStyledUnits(start, end, spans);

    if (unitsCutToken(analysis, units, start, end)) {
        return null;
    }

    const pieces = units.flatMap((unit) => {
        const pieceFrom = Math.min(Math.max(range.from, unit.from), unit.to);
        const pieceTo = Math.min(Math.max(range.to, unit.from), unit.to);

        return splitUnitAtSelection(text, unit, pieceFrom, pieceTo);
    });

    const emitted = emitRuns(text, groupPiecesIntoRuns(pieces, patch), start);

    // Nothing patched (every boundary clamped out of every unit's text) leaves
    // no selection to report, and a rewrite equal to what it replaces is a
    // no-op the caller should not spend an undo step on.
    if (emitted === null || emitted.selection === null || emitted.insert === text.slice(start, end)) {
        return null;
    }

    const edit = { from: start, to: end, insert: emitted.insert, selection: emitted.selection };

    return verified(analysis, edit, (entry) => {
        const format = entryFormat(entry);

        if (!inRange(entry, range)) {
            return format;
        }

        const span = [...entry.ancestors].reverse().find((ancestor) => ancestor.type === "styledspan");

        return { ...format, style: canonicalSpanStyle(mergePatch(span === undefined ? {} : spanAttributes(span), patch)) };
    });
}

/**
 * Applies a colour/font/size patch to the raw Markdown around the selection,
 * writing the dialect's `[text]{key=value …}` styled span. Merges into an
 * existing span rather than nesting inside it, splits one that is only partly
 * selected, and removes the whole `{…}` group when the patch clears its last
 * attribute.
 *
 * @param patch - Kebab-case CSS property names (`color`, `font-family`,
 *   `font-size`) mapped to their new value, or `null` to remove that property
 *   — the same bag `MarkdownEditor`'s three style setters build.
 * @returns The edit rule, which yields `null` for a patch this dialect cannot
 *   express and for a selection the span syntax cannot be written around.
 */
export function spanStyleSource(patch: Record<string, string | null>): MarkdownSourceTransform {
    return (text, from, to) => {
        const analysis = analyzeMarkdownSource(text);
        const range = resolveSpanRange(analysis, from, to);

        if (range === null) {
            return null;
        }

        const attributePatch = toAttributePatch(patch);

        if (attributePatch === null) {
            return null;
        }

        return rewriteStyledSpans(analysis, range, attributePatch);
    };
}

// ---------------------------------------------------------------- clear formatting and state

/**
 * Builds the edit deleting the syntax of every token in `tokens`: it replaces
 * the span from the earliest of the range and the tokens to the latest, and
 * maps the range through the deletions so the selection still covers the
 * same visible text.
 *
 * @param text - The full document text.
 * @param range - The normalised range.
 * @param tokens - The tokens to unwrap; at least one, each with located content.
 * @param escapeCodeReferences - Whether the `&` of each character reference in
 *   a code span's code gets a backslash, so the code stays the text it was
 *   once it is plain text.
 * @returns The edit.
 */
function removeTokenSyntax(
    text: string, range: SourceRange, tokens: readonly SourceInline[], escapeCodeReferences: boolean,
): MarkdownSourceEdit {
    const removed = tokens.flatMap((token) => [[token.start, token.innerStart], [token.innerEnd, token.end]] as const);
    const isRemoved = (index: number): boolean => removed.some(([start, end]) => start <= index && index < end);

    const removedBefore = (offset: number): number => removed
        .reduce((count, [start, end]) => count + Math.max(0, Math.min(end, offset) - start), 0);

    const from = Math.min(range.from, ...tokens.map((token) => token.start));
    const to = Math.max(range.to, ...tokens.map((token) => token.end));
    const codes = escapeCodeReferences ? tokens.filter((token) => token.type === "codespan") : [];

    const escapes = (index: number): boolean => text[index] === "&" && codes.some((code) => (
        code.innerStart <= index && index < code.innerEnd && startsWithCharacterReference(text.slice(index, code.innerEnd))
    ));

    const addedBefore = (offset: number): number => {
        let count = 0;

        for (let index = from; index < offset; index += 1) {
            const added = !isRemoved(index) && escapes(index);

            if (added) { count += 1; }
        }

        return count;
    };

    let insert = "";

    for (let index = from; index < to; index += 1) {
        const kept = !isRemoved(index);

        if (kept) { insert += (escapes(index) ? "\\" : "") + text[index]; }
    }

    return {
        from,
        to,
        insert,
        selection: {
            from: range.from - removedBefore(range.from) + addedBefore(range.from),
            to:   range.to - removedBefore(range.to) + addedBefore(range.to),
        },
    };
}

/**
 * Clears inline formatting from the current selection by removing the
 * syntax of every emphasis run (`**`, `__`, `*`, `_`, `~~`, `++`, …) and
 * code span the normalised selection touches, both sides together, so a
 * selection reaching only one marker of a run never orphans its partner.
 * Runs are the viewer's own tokens, so escaped markers, markers inside a code
 * span, a list bullet and a thematic break's `***` are never treated as
 * formatting. Links and `[text]{…}` styled spans are left alone, matching
 * the WYSIWYG command. The `&` of a character reference in a code span's
 * code is escaped (`\&copy;`) when the code is taken out, so it stays the
 * text it was. Declines (`null`) when the selection touches no run —
 * nothing to clear is no edit, rather than an identical rewrite that would
 * still cost an undo step — on a collapsed caret that expands to nothing,
 * and when the result would read otherwise than the same text without those
 * formats (a code span whose code would read as Markdown once unwrapped).
 */
export const CLEAR_FORMAT_SOURCE: MarkdownSourceTransform = (text, from, to) => {
    const analysis = analyzeMarkdownSource(text);
    const range = normalizeRange(analysis, from, to);

    if (range === null) {
        return null;
    }

    const touched = analysis.inlines.filter((inline) => CLEARED_TYPES.has(inline.type) && inline.innerStart !== -1
        && inline.start < range.to && range.from < inline.end);

    if (touched.length === 0) {
        return null;
    }

    const without = new Set(touched);

    const expected = (entry: SourceEntry): EntryFormat => entryFormat(entry, without);

    return verified(analysis, removeTokenSyntax(text, range, touched, false), expected)
        ?? verified(analysis, removeTokenSyntax(text, range, touched, true), expected);
};

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

/**
 * Whether an offset sits inside a link's or image's syntax: anywhere strictly
 * within an image (its alt text, its source, its size group), or within a
 * link but outside its text — an inline link's destination and title and the
 * `](` before them, a reference link's label, or anywhere in an autolink,
 * whose text is its destination. A link's text holds inline content, an image
 * included, so an offset there — or at either outer edge of a link or image —
 * is free.
 *
 * @param analysis - The document's analysis.
 * @param offset - 0-based offset.
 * @returns Whether it does.
 */
function insideLinkSyntax(analysis: SourceAnalysis, offset: number): boolean {
    return analysis.inlines.some((inline) => {
        if (!(inline.start < offset && offset < inline.end)) {
            return false;
        }

        if (IMAGE_TYPES.has(inline.type)) {
            return true;
        }

        return inline.type === "link" && !(inline.hasContent && inline.innerStart <= offset && offset <= inline.innerEnd);
    });
}

/**
 * The located blocks of one type at any depth of the analysis's block tree.
 *
 * @param nodes - The blocks to search.
 * @param type - The block type.
 * @returns The blocks, in document order.
 */
function locatedBlocks(nodes: readonly SourceBlockNode[], type: string): SourceBlockNode[] {
    return nodes.flatMap((node) => [...(node.type === type && node.start !== -1 ? [node] : []), ...locatedBlocks(node.children, type)]);
}

/** A `|` that is no escaped `\|`: a table row's cell separator or outer pipe. */
const UNESCAPED_PIPE = /(?<!\\)\|/;

/**
 * Whether a range would cut a table's structure: it touches a table's lines
 * — an end on one of them, either outer edge included, or spanning one — and
 * does not lie inside one cell: on one header or body row (not the delimiter
 * row), holding no unescaped `|`, and between the row's outer pipes where it
 * has them. Text written there would join two rows, or stand past the row's
 * last pipe as a cell beyond the header, which the viewer drops.
 *
 * @param analysis - The document's analysis.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @returns Whether it would.
 */
function cutsTableStructure(analysis: SourceAnalysis, from: number, to: number): boolean {
    const text = analysis.text;
    const lineStart = (offset: number): number => text.lastIndexOf("\n", offset - 1) + 1;

    return locatedBlocks(analysis.tree, "mdtable").some((table) => {
        if (to < table.start || from > table.end) {
            return false;
        }

        const line = lineStart(from);
        const selected = text.slice(from, to);
        const delimiterRow = text.indexOf("\n", table.start) + 1;

        if (selected.includes("\n") || line < lineStart(table.start) || line === delimiterRow || UNESCAPED_PIPE.test(selected)) {
            return true;
        }

        const lineEnd = text.indexOf("\n", line);
        const row = text.slice(line, lineEnd === -1 ? text.length : lineEnd);
        // A row of a table in a list item or a quote opens after the container's indentation and `>`.
        const open = row.search(/[^ \t>]/);
        const close = row.trimEnd().length - 1;
        const opens = row[open] === "|";
        const closes = close > open && row[close] === "|" && row[close - 1] !== "\\";

        return (opens && from - line <= open) || (closes && to - line > close);
    });
}

/** A line of a `:::` fence's own syntax, past a container's indentation and `>`: a `:::` line or a `|||` separator. */
const FENCE_SYNTAX_LINE = /^[ \t>]*(?::{3,}|\|\|\|[ \t]*$)/;

/** A fenced code block's opening run, past its indentation. */
const CODE_FENCE_RUN = /^[ \t]*(`{3,}|~{3,})/;

/**
 * The start of each fenced code block's opening line, and of its closing
 * line when it has one, at any depth: the lines that delimit the code.
 *
 * @param analysis - The document's analysis.
 * @returns The line starts.
 */
function codeFenceLineStarts(analysis: SourceAnalysis): Set<number> {
    const text = analysis.text;
    const lineStart = (offset: number): number => text.lastIndexOf("\n", offset - 1) + 1;
    const starts = new Set<number>();

    for (const block of locatedBlocks(analysis.tree, "code")) {
        const opening = CODE_FENCE_RUN.exec(text.slice(block.start, block.end))?.[1];

        if ((block.token as Tokens.Code).codeBlockStyle === "indented" || opening === undefined) {
            continue;
        }

        const first = lineStart(block.start);
        const last = lineStart(block.end);
        // The closing fence: the opening run's character, at least as many, past a container's indentation and `>`.
        const closing = new RegExp(`^[ \\t>]*${opening[0]!}{${opening.length},}[ \\t]*$`);

        starts.add(first);

        if (last !== first && closing.test(text.slice(last, block.end))) {
            starts.add(last);
        }
    }

    return starts;
}

/**
 * Whether a range touches a fence line — a line of a `:::` fence's own
 * syntax (its opening or closing `:::` line, or a `|||` column separator,
 * outside a code block in it), or a fenced code block's opening or closing
 * line, its indentation included — which text written on it, or a selection
 * replaced across it, would break: a code block would open or end
 * elsewhere, and the lines around it read anew.
 *
 * @param analysis - The document's analysis.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @returns Whether it does.
 */
function touchesFenceLine(analysis: SourceAnalysis, from: number, to: number): boolean {
    const text = analysis.text;
    const fences = locatedBlocks(analysis.tree, "mdblock");
    const code = locatedBlocks(analysis.tree, "code");
    const codeFences = codeFenceLineStarts(analysis);
    // A block in a list item or quote starts after the line's indentation or `>`, so a line counts when it overlaps it.
    const holds = (node: SourceBlockNode, start: number, end: number): boolean => node.start <= end && start <= node.end;
    let line = text.lastIndexOf("\n", from - 1) + 1;

    while (line <= to) {
        const lineEnd = text.indexOf("\n", line);
        const end = lineEnd === -1 ? text.length : lineEnd;

        const fenceSyntax = FENCE_SYNTAX_LINE.test(text.slice(line, end)) && fences.some((fence) => holds(fence, line, end))
            && !code.some((block) => holds(block, line, end));

        if (fenceSyntax || codeFences.has(line)) {
            return true;
        }

        if (lineEnd === -1) {
            break;
        }

        line = lineEnd + 1;
    }

    return false;
}

/**
 * Builds the image-insertion transform: validates `src` (via
 * `resolveImageSpec`, the same allow-list `insertImage` uses on the WYSIWYG
 * side), then replaces the selection with `![alt](src)` plus a
 * `{width=… height=…}` attribute block when either dimension resolved,
 * leaving the caret just after it. Declines (`null`) when either end of the
 * selection sits inside an image or a link's syntax beyond its text (see
 * {@link insideLinkSyntax}), where the image would be written into the alt
 * text, source or destination rather than read as an image, and when the
 * selection would cut a table's structure ({@link cutsTableStructure}) or
 * touches a fence line — a `:::` fence's own lines, or a fenced code block's
 * opening or closing line ({@link touchesFenceLine}).
 *
 * @param src - The image source.
 * @param alt - The image's alt text.
 * @param attributes - The parsed `width`/`height` attribute record.
 * @returns The transform, or `null` when `src` fails the scheme allow-list.
 */
export function imageSource(src: string, alt: string, attributes: Record<string, string>): MarkdownSourceTransform {
    return (text, from, to) => {
        const spec = resolveImageSpec(src, alt, attributes);

        if (spec === null) {
            return null;
        }

        const analysis = analyzeMarkdownSource(text);

        if (insideLinkSyntax(analysis, from) || insideLinkSyntax(analysis, to) || cutsTableStructure(analysis, from, to)
            || touchesFenceLine(analysis, from, to)) {
            return null;
        }

        const resolved: Record<string, string> = {};

        if (spec.width !== null) { resolved.width = String(spec.width); }
        if (spec.height !== null) { resolved.height = String(spec.height); }

        const attributeBlock = Object.keys(resolved).length > 0 ? `{${formatAttributes(resolved)}}` : "";
        const insert = `![${spec.alt}](${spec.src})${attributeBlock}`;

        return { from, to, insert, selection: { from: from + insert.length, to: from + insert.length } };
    };
}
