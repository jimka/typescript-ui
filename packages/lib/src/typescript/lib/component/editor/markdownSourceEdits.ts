// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { resolveImageSpec, formatAttributes } from "~/component/display/markdownAttributes.js";

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

/**
 * Matches one "word" character for the normalised-range collapsed-caret
 * expansion: any Unicode letter or number, plus underscore. Mirrors
 * `MarkdownEditor.ts`'s own `WORD_CHARACTER` (the WYSIWYG side's
 * `$selectEnclosingWordIfCollapsed`) so a caret expands to the same word on
 * either surface. Duplicated rather than imported: this module stays a leaf
 * with no DOM/Lexical/component dependency, and `MarkdownEditor.ts` imports
 * from here, so an import the other way would cycle.
 */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

/** The four characters an inline marker run can be made of. */
const MARKER_CHARACTERS = new Set(["*", "~", "+", "`"]);

/** A blank line — a paragraph break an inline marker pair can never span. */
const BLANK_LINE = /\n[ \t]*\n/;

/** CommonMark's whitespace for the flanking rules; a newline counts, as does the document's edge. */
const WHITESPACE = /\s/;

/** CommonMark's punctuation for the flanking rules: any Unicode punctuation or symbol character. */
const PUNCTUATION = /[\p{P}\p{S}]/u;

/**
 * Normalises a raw `[from, to)` range for an inline transform or
 * {@link readSourceSelectionState}, in four steps: trims whitespace inward;
 * for a selection that started collapsed (a bare caret), expands it to the
 * enclosing run of word characters; absorbs matching edge markers (the same
 * character, on both ends, with more than two characters between); and gives
 * up (`null`) when the result is empty. A real (non-collapsed) selection that
 * trims down to nothing is *not* expanded — only a caret that started
 * collapsed is.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @returns The normalised range, or `null` when nothing is left to act on.
 */
function normalizeRange(text: string, from: number, to: number): { from: number; to: number } | null {
    const wasCollapsed = from === to;
    let start = from;
    let end = to;

    while (start < end && /\s/.test(text[start]!)) { start += 1; }
    while (end > start && /\s/.test(text[end - 1]!)) { end -= 1; }

    if (wasCollapsed) {
        while (start > 0 && WORD_CHARACTER.test(text[start - 1]!)) { start -= 1; }
        while (end < text.length && WORD_CHARACTER.test(text[end]!)) { end += 1; }
    }

    while (end - start > 2 && text[start] === text[end - 1] && MARKER_CHARACTERS.has(text[start]!)) {
        start += 1;
        end -= 1;
    }

    return start === end ? null : { from: start, to: end };
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
 * CommonMark's flanking test for the delimiter run `[start, end)`. A
 * left-flanking run (one that can open emphasis) is not followed by
 * whitespace, and is followed by a non-punctuation character or preceded by
 * whitespace or punctuation; a right-flanking run (one that can close) is the
 * mirror image. The document's edges count as whitespace. Applied to `*`, `~`
 * and `+` alike, as Lexical's Markdown importer applies it. The viewer flanks
 * `*` and `~` the same way but reads `++` with no flanking test at all, so
 * for `+` this can only decline an edit the viewer would have accepted —
 * never accept one it would read as literal text.
 *
 * @param text - The full document text.
 * @param start - The run's start.
 * @param end - The run's end (exclusive).
 * @param left - `true` for the left-flanking (opening) test, `false` for the
 *   right-flanking (closing) one.
 * @returns Whether the run is flanking on that side.
 */
function isFlanking(text: string, start: number, end: number, left: boolean): boolean {
    const before = text[start - 1];
    const after = text[end];
    const [primary, secondary] = left ? [after, before] : [before, after];

    if (primary === undefined || WHITESPACE.test(primary)) {
        return false;
    }

    if (!PUNCTUATION.test(primary)) {
        return true;
    }

    return secondary === undefined || WHITESPACE.test(secondary) || PUNCTUATION.test(secondary);
}

/**
 * Measures the run of `char` immediately outside a normalised `[start, end)`
 * range that can actually act as a marker: how many consecutive `char`
 * characters sit right before `start` and right after `end`, counting only
 * what Markdown would read as syntax. A backslash-escaped first character is
 * literal, so it drops out of the left run; a closing run whose first
 * character is escaped cannot close at `end` at all — except for inline code,
 * inside which a backslash is literal. Outside inline code, a left run that
 * is not left-flanking, or a right run that is not right-flanking, is literal
 * text and counts as zero.
 *
 * @param text - The full document text.
 * @param start - The normalised range's start.
 * @param end - The normalised range's end (exclusive).
 * @param char - The marker character to count.
 * @returns The two effective run lengths.
 */
function markerRunLengths(text: string, start: number, end: number, char: string): { left: number; right: number } {
    let leftStart = start;

    while (leftStart > 0 && text[leftStart - 1] === char) { leftStart -= 1; }

    if (leftStart < start && isEscaped(text, leftStart)) {
        leftStart += 1;
    }

    let rightEnd = end;

    while (text[rightEnd] === char) { rightEnd += 1; }

    if (char !== "`" && rightEnd > end && isEscaped(text, end)) {
        rightEnd = end;
    }

    if (char === "`") {
        return { left: start - leftStart, right: rightEnd - end };
    }

    return {
        left:  isFlanking(text, leftStart, start, true) ? start - leftStart : 0,
        right: isFlanking(text, end, rightEnd, false) ? rightEnd - end : 0,
    };
}

/**
 * Whether a marker of `count` characters is currently active right around a
 * normalised range — what a wrap checks its own result against, so that the
 * markers it adds read back as that format. A one-character marker (italic,
 * inline code) is active when the smaller of the two surrounding runs is odd,
 * since a run of two in the
 * `*` family means bold, not italic; a two-character marker (bold,
 * strikethrough, underline) is active when that smaller run is at least two.
 * The runs are measured by {@link markerRunLengths}, so an escaped or
 * non-flanking marker — literal text that only looks like one — is inactive.
 *
 * @param text - The full document text.
 * @param start - The normalised range's start.
 * @param end - The normalised range's end (exclusive).
 * @param char - The marker character.
 * @param count - The marker's width (1 or 2).
 * @returns Whether the marker is active.
 */
function isMarkerActive(text: string, start: number, end: number, char: string, count: number): boolean {
    const { left, right } = markerRunLengths(text, start, end, char);
    const n = Math.min(left, right);

    return count === 1 ? n % 2 === 1 : n >= 2;
}

/**
 * Builds an inline-toggle transform for a `{ char, count }` marker: bold
 * `{ "*", 2 }`, italic `{ "*", 1 }`, strikethrough `{ "~", 2 }`, underline
 * `{ "+", 2 }`, inline code `` { "`", 1 } ``. When a pair of that format
 * covers the normalised range (see {@link coveringFormats}), the press
 * removes the format from the whole range ({@link removeFormat}); otherwise
 * it wraps the range in the markers. Declines (`null`) when the
 * normalised range contains a blank line, or (inline code only, via
 * `refuse`) still contains a backtick — and when the markers it would add
 * would not read back as that format: a closer after punctuation and before a
 * letter (`**hello.**b`) fails CommonMark's flanking rules, and a marker
 * written straight after a backslash (`C:\**Users**`) is escaped. Either
 * would leave the markers as visible literal text. A wrap also declines when
 * the range holds or cuts into a table cell's paragraph break (see
 * {@link touchesCellParagraphBreak}).
 *
 * @param char - The marker character.
 * @param count - The marker's width (1 or 2).
 * @param refuse - An extra rejection test over the normalised inner text.
 * @returns The transform.
 */
function createInlineToggle(char: string, count: number, refuse?: (inner: string) => boolean): MarkdownSourceTransform {
    return (text, from, to) => {
        const range = normalizeRange(text, from, to);

        if (range === null) {
            return null;
        }

        const { from: start, to: end } = range;
        const inner = text.slice(start, end);

        if (BLANK_LINE.test(inner) || (refuse?.(inner) ?? false)) {
            return null;
        }

        const format = formatLetter(char, count);
        const active = coveringFormats(text, range).has(format);

        if (active) {
            return removeFormat(text, range, format);
        }

        if (touchesCellParagraphBreak(text, start, end)) {
            return null;
        }

        const marker = char.repeat(count);
        const wrapped = text.slice(0, start) + marker + inner + marker + text.slice(end);

        // Checked on the result, not predicted from the input: the new markers
        // merge with any same-character run already beside them, and it is the
        // merged run Markdown reads.
        if (!isMarkerActive(wrapped, start + count, end + count, char, count)) {
            return null;
        }

        return {
            from:      start,
            to:        end,
            insert:    marker + inner + marker,
            selection: { from: start + count, to: end + count },
        };
    };
}

/** `**text**` — bold. */
export const BOLD_SOURCE: MarkdownSourceTransform = createInlineToggle("*", 2);
/** `*text*` — italic. */
export const ITALIC_SOURCE: MarkdownSourceTransform = createInlineToggle("*", 1);
/** `++text++` — underline, this dialect's own marker (see `markdownStyleTransformers.ts`'s `UNDERLINE`). */
export const UNDERLINE_SOURCE: MarkdownSourceTransform = createInlineToggle("+", 2);
/** `~~text~~` — strikethrough. */
export const STRIKETHROUGH_SOURCE: MarkdownSourceTransform = createInlineToggle("~", 2);
/** `` `text` `` — inline code. Refuses a range that still contains a backtick, which a plain wrap would re-parse differently. */
export const INLINE_CODE_SOURCE: MarkdownSourceTransform = createInlineToggle("`", 1, (inner) => inner.includes("`"));

/**
 * One `[text](destination "title")` inline link — or, when a `!` precedes
 * it, an image's `[alt](src)`. Follows CommonMark's inline-link grammar: the
 * destination is `<…>` or a run with no whitespace or parentheses, and an
 * optional title — `"…"`, `'…'` or `(…)` — follows after whitespace. Group 1
 * is the bracketed text, group 2 the destination as written, group 3 the
 * title with its delimiters.
 */
const LINK_PATTERN = /\[([^[\]]*)\]\(\s*(<[^<>\n]*>|[^\s()]*)(?:\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?\s*\)/g;

/** A located link match: its span in the document, its bracketed text, its URL and title, and whether it is an image. */
interface LinkMatch {
    start: number;
    end:   number;
    text:  string;
    /** The destination, without the `<…>` an angle-bracketed one is written in. */
    url:   string;
    /** The title exactly as written, delimiters included, or `null` when the link has none. */
    title: string | null;
    /** Whether the match is an image's `[alt](src)` — a `!` precedes it — rather than a link. */
    image: boolean;
}

/**
 * Finds the link or image whose span contains the whole raw `[from, to]`
 * selection — one regex pass over the document. An image is reported (with
 * `image` set) rather than skipped, so a caller can refuse to act inside its
 * alt text instead of mistaking that text for plain prose.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @returns The enclosing match, or `null` when the selection sits outside
 *   every link and image.
 */
function findEnclosingLink(text: string, from: number, to: number): LinkMatch | null {
    LINK_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = LINK_PATTERN.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;

        if (start <= from && to <= end) {
            const destination = match[2]!;

            return {
                start,
                end,
                text:  match[1]!,
                url:   destination.startsWith("<") ? destination.slice(1, -1) : destination,
                title: match[3] ?? null,
                image: start > 0 && text[start - 1] === "!",
            };
        }
    }

    return null;
}

/**
 * Builds the link toggle transform: wraps the selection in a link to `url`,
 * updates the enclosing link's URL in place when the selection already sits
 * inside one — keeping its title — or (`url === null`) unwraps the enclosing
 * link back to plain text. Declines (`null`) when `url` is non-null and there
 * is no enclosing link and nothing to wrap (a collapsed caret with no word
 * under it), when `url` is `null` and there is no enclosing link to remove,
 * when the selection sits inside an image, whose alt text a link cannot be
 * nested in, and when a new link's text would hold or cut into a table
 * cell's paragraph break (see {@link touchesCellParagraphBreak}).
 *
 * @param url - The link target, or `null` to remove the enclosing link.
 * @returns The transform.
 */
export function linkSource(url: string | null): MarkdownSourceTransform {
    return (text, from, to) => {
        const link = findEnclosingLink(text, from, to);

        if (link?.image === true) {
            return null;
        }

        if (link !== null) {
            if (url === null) {
                return {
                    from:      link.start,
                    to:        link.end,
                    insert:    link.text,
                    selection: { from: link.start, to: link.start + link.text.length },
                };
            }

            const wrapped = `[${link.text}](${url}${link.title === null ? "" : " " + link.title})`;

            return {
                from:      link.start,
                to:        link.end,
                insert:    wrapped,
                selection: { from: link.start + 1, to: link.start + 1 + link.text.length },
            };
        }

        if (url === null) {
            return null;
        }

        const range = normalizeRange(text, from, to);

        if (range === null || touchesCellParagraphBreak(text, range.from, range.to)) {
            return null;
        }

        const inner = text.slice(range.from, range.to);
        const wrapped = `[${inner}](${url})`;

        return {
            from:      range.from,
            to:        range.to,
            insert:    wrapped,
            selection: { from: range.from + 1, to: range.from + 1 + inner.length },
        };
    };
}

/** Removes the link enclosing the current selection. Equivalent to `linkSource(null)`. */
export const REMOVE_LINK_SOURCE: MarkdownSourceTransform = linkSource(null);

/** One matched inline-format pair: the opening and the closing marker characters it consumes. */
interface MarkerPair {
    openFrom:  number;
    openTo:    number;
    closeFrom: number;
    closeTo:   number;
}

/** A `*`, `~` or `+` delimiter run the pairing pass can still draw marker characters from. */
interface DelimiterRun {
    char:     string;
    index:    number;
    length:   number;
    canOpen:  boolean;
    canClose: boolean;
    active:   boolean;
}

/**
 * Splits the paragraphs the normalised range touches into their own
 * `[start, end)` spans: from the start of the paragraph holding `from` to the
 * end of the one holding `to`, cut at every blank line in between. A marker
 * pair never spans a blank line, so each span is paired on its own.
 *
 * @param text - The full document text.
 * @param from - The normalised range's start.
 * @param to - The normalised range's end (exclusive).
 * @returns The paragraph spans, in document order.
 */
function paragraphSpansAround(text: string, from: number, to: number): { start: number; end: number }[] {
    const lines = splitLines(text);
    const isBlank = (index: number): boolean => lines[index]!.text.trim() === "";
    let first = lineIndexAt(lines, from);
    let last = lineIndexAt(lines, to);

    while (first > 0 && !isBlank(first - 1)) { first -= 1; }
    while (last < lines.length - 1 && !isBlank(last + 1)) { last += 1; }

    const spans: { start: number; end: number }[] = [];

    for (let index = first; index <= last; index += 1) {
        if (isBlank(index)) {
            continue;
        }

        const previous = spans[spans.length - 1];

        if (previous !== undefined && !isBlank(index - 1)) {
            previous.end = lines[index]!.end;
        } else {
            spans.push({ start: lines[index]!.start, end: lines[index]!.end });
        }
    }

    return spans;
}

/**
 * Finds the code spans in `[start, end)`, per CommonMark: a backtick run
 * opens one unless a backslash escapes it, and the next run of the same
 * length closes it; a run with no partner is literal.
 *
 * @param text - The full document text.
 * @param start - The paragraph's start.
 * @param end - The paragraph's end (exclusive).
 * @returns Each code span as a marker pair: its opening and closing runs.
 */
function findCodeSpans(text: string, start: number, end: number): MarkerPair[] {
    const runs: { index: number; length: number }[] = [];

    for (let index = start; index < end;) {
        let length = 0;

        while (index + length < end && text[index + length] === "`") { length += 1; }

        if (length > 0) {
            runs.push({ index, length });
        }

        index += Math.max(length, 1);
    }

    const spans: MarkerPair[] = [];

    for (let open = 0; open < runs.length; open += 1) {
        const opener = runs[open]!;
        const close = runs.findIndex((run, index) => index > open && run.length === opener.length);

        if (isEscaped(text, opener.index) || close === -1) {
            continue;
        }

        const closer = runs[close]!;

        spans.push({
            openFrom:  opener.index,
            openTo:    opener.index + opener.length,
            closeFrom: closer.index,
            closeTo:   closer.index + closer.length,
        });

        open = close;
    }

    return spans;
}

/**
 * Collects the `*`, `~` and `+` delimiter runs in `[start, end)` that can
 * open or close emphasis, skipping escaped characters and everything inside
 * a code span, where those characters are literal. A run that is neither
 * left- nor right-flanking — a list bullet, a thematic break's `***`, the `+`
 * of `1 + 1` — is not collected at all.
 *
 * @param text - The full document text.
 * @param start - The paragraph's start.
 * @param end - The paragraph's end (exclusive).
 * @param codeSpans - The paragraph's code spans, from {@link findCodeSpans}.
 * @returns The runs, in document order.
 */
function scanDelimiterRuns(text: string, start: number, end: number, codeSpans: MarkerPair[]): DelimiterRun[] {
    const runs: DelimiterRun[] = [];

    for (let index = start; index < end;) {
        const char = text[index]!;
        const inCode = codeSpans.some((span) => span.openFrom <= index && index < span.closeTo);

        if (char === "`" || !MARKER_CHARACTERS.has(char) || inCode || isEscaped(text, index)) {
            index += 1;
            continue;
        }

        let length = 1;

        while (index + length < end && text[index + length] === char) { length += 1; }

        const canOpen = isFlanking(text, index, index + length, true);
        const canClose = isFlanking(text, index, index + length, false);

        if (canOpen || canClose) {
            runs.push({ char, index, length, canOpen, canClose, active: true });
        }

        index += length;
    }

    return runs;
}

/**
 * Pairs delimiter runs into emphasis the way CommonMark's delimiter-stack
 * algorithm does, simplified to this dialect: each closing run takes the
 * nearest earlier opening run of the same character, consuming two
 * characters from each when both have two (`**`, `~~`, `++`) and one
 * otherwise (`*` only — a lone `~` or `+` is literal); runs between a matched
 * pair are deactivated; and the "rule of three" stops a run that can both
 * open and close from pairing across a length that would split it oddly.
 *
 * @param runs - The paragraph's runs, from {@link scanDelimiterRuns}; consumed.
 * @returns The matched pairs.
 */
function pairDelimiterRuns(runs: DelimiterRun[]): MarkerPair[] {
    const pairs: MarkerPair[] = [];

    for (let close = 0; close < runs.length; close += 1) {
        const closer = runs[close]!;

        while (closer.canClose && closer.active && closer.length > 0) {
            const open = findOpenerFor(runs, close);

            if (open === -1) {
                break;
            }

            const opener = runs[open]!;
            const width = Math.min(opener.length, closer.length) >= 2 ? 2 : 1;

            pairs.push({
                openFrom:  opener.index + opener.length - width,
                openTo:    opener.index + opener.length,
                closeFrom: closer.index,
                closeTo:   closer.index + width,
            });

            opener.length -= width;
            closer.index += width;
            closer.length -= width;

            for (let between = open + 1; between < close; between += 1) {
                runs[between]!.active = false;
            }
        }
    }

    return pairs;
}

/**
 * Finds the opening run the closing run `runs[close]` pairs with: the
 * nearest earlier active run of the same character that can open, has
 * characters left, is wide enough for that character's marker, and is not
 * ruled out by CommonMark's rule of three.
 *
 * @param runs - The paragraph's runs.
 * @param close - The closing run's index.
 * @returns The opening run's index, or `-1` when none qualifies.
 */
function findOpenerFor(runs: DelimiterRun[], close: number): number {
    const closer = runs[close]!;

    for (let open = close - 1; open >= 0; open -= 1) {
        const opener = runs[open]!;

        if (!opener.active || !opener.canOpen || opener.length === 0 || opener.char !== closer.char) {
            continue;
        }

        // `~~` and `++` are this dialect's only `~` / `+` markers.
        if (opener.char !== "*" && Math.min(opener.length, closer.length) < 2) {
            continue;
        }

        const sum = opener.length + closer.length;
        const ruleOfThree = (opener.canClose || closer.canOpen)
            && sum % 3 === 0 && opener.length % 3 !== 0 && closer.length % 3 !== 0;

        if (!ruleOfThree) {
            return open;
        }
    }

    return -1;
}

/**
 * Finds every inline-format pair — emphasis and code spans — in the
 * paragraphs the normalised range touches.
 *
 * @param text - The full document text.
 * @param from - The normalised range's start.
 * @param to - The normalised range's end (exclusive).
 * @returns The matched pairs, in no particular order.
 */
function findMarkerPairs(text: string, from: number, to: number): MarkerPair[] {
    return paragraphSpansAround(text, from, to).flatMap(({ start, end }) => {
        const codeSpans = findCodeSpans(text, start, end);

        return [...codeSpans, ...pairDelimiterRuns(scanDelimiterRuns(text, start, end, codeSpans))];
    });
}

/**
 * Builds the edit deleting every marker character of `pairs`: it replaces
 * the span from the earliest of the range and the pairs to the latest, and
 * maps the range through the deletions so the selection still covers the
 * same visible text.
 *
 * @param text - The full document text.
 * @param range - The normalised range.
 * @param pairs - The pairs to remove; at least one.
 * @returns The edit.
 */
function removeMarkerPairs(text: string, range: { from: number; to: number }, pairs: MarkerPair[]): MarkdownSourceEdit {
    const removed = pairs.flatMap((pair) => [[pair.openFrom, pair.openTo], [pair.closeFrom, pair.closeTo]] as const);
    const isRemoved = (index: number): boolean => removed.some(([start, end]) => start <= index && index < end);
    const removedBefore = (offset: number): number => removed
        .reduce((count, [start, end]) => count + Math.max(0, Math.min(end, offset) - start), 0);

    const from = Math.min(range.from, ...pairs.map((pair) => pair.openFrom));
    const to = Math.max(range.to, ...pairs.map((pair) => pair.closeTo));
    let insert = "";

    for (let index = from; index < to; index += 1) {
        if (!isRemoved(index)) { insert += text[index]; }
    }

    return {
        from,
        to,
        insert,
        selection: { from: range.from - removedBefore(range.from), to: range.to - removedBefore(range.to) },
    };
}

/** A normalised `[from, to)` range of the source. */
interface SourceRange {
    from: number;
    to:   number;
}

/**
 * The letter naming the format a marker of `char` and `width` applies: `b`old
 * (`**`), `i`talic (`*`), `s`trikethrough (`~~`), `u`nderline (`++`), `c`ode
 * (a backtick run, whatever its length).
 *
 * @param char - The marker character.
 * @param width - The marker's width.
 * @returns The format letter.
 */
function formatLetter(char: string, width: number): string {
    switch (char) {
        case "`": return "c";
        case "~": return "s";
        case "+": return "u";
        default:  return width >= 2 ? "b" : "i";
    }
}

/**
 * The format letter of a marker pair (see {@link formatLetter}).
 *
 * @param text - The full document text.
 * @param pair - The pair.
 * @returns Its format letter.
 */
function pairFormat(text: string, pair: MarkerPair): string {
    return formatLetter(text[pair.openFrom]!, pair.openTo - pair.openFrom);
}

/**
 * Whether a marker pair's content holds every character of `[from, to)`.
 *
 * @param pair - The pair.
 * @param from - The range's start.
 * @param to - The range's end (exclusive).
 * @returns Whether it does.
 */
function pairCovers(pair: MarkerPair, from: number, to: number): boolean {
    return pair.openTo <= from && to <= pair.closeFrom;
}

/**
 * The formats whose marker pairs cover a normalised range: every pair
 * Markdown reads around it (see {@link findMarkerPairs}), however far out —
 * `**foo, **bar** az**` is bold over `bar` twice over, and `*a **b** c*` is
 * italic over `b` past the bold between.
 *
 * @param text - The full document text.
 * @param range - The normalised range.
 * @returns The covering formats' letters.
 */
function coveringFormats(text: string, range: SourceRange): Set<string> {
    const pairs = findMarkerPairs(text, range.from, range.to);

    return new Set(pairs.filter((pair) => pairCovers(pair, range.from, range.to)).map((pair) => pairFormat(text, pair)));
}

/**
 * Builds the edit removing a format from a whole normalised range that a
 * pair of it covers, the way the WYSIWYG toggle does: every pair of that
 * format inside the outermost covering one is dropped, and the outermost
 * pair's text before and after the range is wrapped again in its own
 * marker, so a selection covered twice (`**foo, **bar** az**` →
 * `**foo,** bar **az**`) or only partly (`**hello world**` →
 * `**hello** world`) loses the format entirely. The new markers sit at the
 * split points {@link findSplitPoints} finds. The result is re-read (see
 * {@link readsWithoutFormat}): the edit stands only when the selected text —
 * and the whitespace between it and a split point — no longer shows the
 * format and nothing else changed; else `null`, as for a split whose markers
 * would cross a link's brackets.
 *
 * @param text - The full document text.
 * @param range - The normalised range.
 * @param format - The format's letter (see {@link formatLetter}).
 * @returns The edit, or `null` when no split reads back as intended.
 */
function removeFormat(text: string, range: SourceRange, format: string): MarkdownSourceEdit | null {
    const pairs = findMarkerPairs(text, range.from, range.to);
    const own = pairs.filter((pair) => pairFormat(text, pair) === format);
    const outer = own.filter((pair) => pairCovers(pair, range.from, range.to))
        .reduce((outermost, pair) => (pair.openFrom < outermost.openFrom ? pair : outermost));
    const dropped = own.filter((pair) => outer.openFrom <= pair.openFrom && pair.closeTo <= outer.closeTo);
    const isDropped = (index: number): boolean => dropped.some((pair) => (pair.openFrom <= index && index < pair.openTo)
        || (pair.closeFrom <= index && index < pair.closeTo));
    const others = pairs.filter((pair) => !dropped.includes(pair));
    // A code span's spaces are its code, so its split points never move past one.
    const cuts = findSplitPoints(text, range, outer, { isDropped, others, overWhitespace: format !== "c" });
    const edit = buildSplitEdit(text, range, outer, cuts, isDropped);

    // The whitespace between the range and a split point ends up outside the format too.
    return edit !== null && readsWithoutFormat(text, edit, { from: cuts[0], to: cuts[1] }, format) ? edit : null;
}

/**
 * Builds the edit {@link removeFormat} makes over its outermost pair: the
 * dropped markers deleted, and the pair's own marker written again around
 * the text before the left split point and after the right one, where any
 * text is left there.
 *
 * @param text - The full document text.
 * @param range - The normalised range.
 * @param outer - The outermost covering pair.
 * @param cuts - The left and right split points.
 * @param isDropped - Whether a character is one of the markers being dropped.
 * @returns The edit, with the selection on the range's text; `null` when a
 *   new pair would cross a link's brackets (see {@link shareLinkContext}).
 */
function buildSplitEdit(
    text: string, range: SourceRange, outer: MarkerPair, cuts: [number, number], isDropped: (index: number) => boolean,
): MarkdownSourceEdit | null {
    const [cutLeft, cutRight] = cuts;
    const kept = (start: number, end: number): string => text.slice(start, end).split("")
        .filter((_char, offset) => !isDropped(start + offset)).join("");
    const marker = text.slice(outer.openFrom, outer.openTo);
    const left = kept(outer.openTo, cutLeft);
    const right = kept(cutRight, outer.closeFrom);
    const crossesLink = (left !== "" && !shareLinkContext(text, outer.openFrom, cutLeft))
        || (right !== "" && !shareLinkContext(text, cutRight, outer.closeTo));

    if (crossesLink) {
        return null;
    }

    const before = (left === "" ? "" : marker + left + marker) + kept(cutLeft, range.from);
    const middle = kept(range.from, range.to);
    const after = kept(range.to, cutRight) + (right === "" ? "" : marker + right + marker);
    const selectionFrom = outer.openFrom + before.length;

    return {
        from:      outer.openFrom,
        to:        outer.closeTo,
        insert:    before + middle + after,
        selection: { from: selectionFrom, to: selectionFrom + middle.length },
    };
}

/** What {@link findSplitPoints} may step over. */
interface SplitContext {
    /** Whether a character is one of the markers being dropped. */
    isDropped:      (index: number) => boolean;
    /** The pairs that stay. */
    others:         readonly MarkerPair[];
    /** Whether a split point moves over whitespace. */
    overWhitespace: boolean;
}

/**
 * Where a format removed from a range splits its outermost pair: the
 * point the text before the range ends and the one the text after it
 * starts. Each moves outward from the range over whitespace (the closer must
 * follow text to close, the opener precede it to open), over the markers
 * being dropped, and out of another format's pair that opens (or closes)
 * right there around the range — `*a **b** c*` splits as `*a* **b** *c*`,
 * not inside the bold.
 *
 * @param text - The full document text.
 * @param range - The normalised range.
 * @param outer - The outermost covering pair, which the points stay inside.
 * @param context - What the points may step over.
 * @returns The left and right split points.
 */
function findSplitPoints(text: string, range: SourceRange, outer: MarkerPair, context: SplitContext): [number, number] {
    const { isDropped, others, overWhitespace } = context;
    const skippable = (index: number): boolean => isDropped(index) || (overWhitespace && WHITESPACE.test(text[index]!));
    let left = range.from;
    let right = range.to;

    while (left > outer.openTo) {
        const opening = others.find((pair) => pair.openTo === left && pair.openFrom >= outer.openTo && pair.closeFrom >= range.to);

        if (opening !== undefined) {
            left = opening.openFrom;
        } else if (skippable(left - 1)) {
            left -= 1;
        } else {
            break;
        }
    }

    while (right < outer.closeFrom) {
        const closing = others.find((pair) => pair.closeFrom === right && pair.closeTo <= outer.closeFrom && pair.openTo <= range.from);

        if (closing !== undefined) {
            right = closing.closeTo;
        } else if (skippable(right)) {
            right += 1;
        } else {
            break;
        }
    }

    return [left, right];
}

/**
 * Which link's text an offset sits in: `""` outside every link, the link's
 * start offset inside one's bracketed text (either edge included), and
 * `"syntax"` inside a link's syntax beyond its text or anywhere strictly
 * within an image (see {@link insideLinkSyntax}).
 *
 * @param text - The full document text.
 * @param offset - 0-based offset.
 * @returns The context.
 */
function linkContextAt(text: string, offset: number): string {
    const syntax = insideLinkSyntax(text, offset);

    if (syntax) {
        return "syntax";
    }

    LINK_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = LINK_PATTERN.exec(text)) !== null) {
        const textStart = match.index + 1;

        if (textStart <= offset && offset <= textStart + match[1]!.length) {
            return String(match.index);
        }
    }

    return "";
}

/**
 * Whether a new marker pair at `open` and `close` would stay within one
 * context: both outside every link, or both inside one link's text — never
 * across a link's brackets, nor inside its syntax.
 *
 * @param text - The full document text.
 * @param open - The opening marker's offset.
 * @param close - The closing marker's offset.
 * @returns Whether it would.
 */
function shareLinkContext(text: string, open: number, close: number): boolean {
    const context = linkContextAt(text, open);

    return context !== "syntax" && context === linkContextAt(text, close);
}

/** One character of a paragraph that is no marker, with the formats the pairs around it apply. */
interface FormattedCharacter {
    char:    string;
    index:   number;
    /** The covering pairs' format letters, sorted. */
    formats: string;
}

/**
 * Reads every character of the paragraphs around `[from, to)` that is not
 * a marker of any pair, with the formats of the pairs covering it — what
 * the viewer would show there, as far as this module can read it.
 *
 * @param text - The full document text.
 * @param from - The range's start.
 * @param to - The range's end (exclusive).
 * @returns The characters, in document order.
 */
function readFormattedCharacters(text: string, from: number, to: number): FormattedCharacter[] {
    return paragraphSpansAround(text, from, to).flatMap(({ start, end }) => {
        const codeSpans = findCodeSpans(text, start, end);
        const pairs = [...codeSpans, ...pairDelimiterRuns(scanDelimiterRuns(text, start, end, codeSpans))];
        const characters: FormattedCharacter[] = [];

        for (let index = start; index < end; index += 1) {
            const isMarker = pairs.some((pair) => (pair.openFrom <= index && index < pair.openTo)
                || (pair.closeFrom <= index && index < pair.closeTo));

            if (!isMarker) {
                const covering = pairs.filter((pair) => pairCovers(pair, index, index + 1));
                const formats = [...new Set(covering.map((pair) => pairFormat(text, pair)))].sort().join("");

                characters.push({ char: text[index]!, index, formats });
            }
        }

        return characters;
    });
}

/**
 * Whether an edit removing a format reads back as intended: re-read (see
 * {@link readFormattedCharacters}), the paragraphs it touches hold the same
 * characters, those in `range` with the format gone and every other one
 * formatted as before.
 *
 * @param text - The full document text.
 * @param edit - The candidate edit.
 * @param range - The range the format is removed from.
 * @param format - The format's letter.
 * @returns Whether it does.
 */
function readsWithoutFormat(text: string, edit: MarkdownSourceEdit, range: SourceRange, format: string): boolean {
    const result = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    const before = readFormattedCharacters(text, edit.from, edit.to);
    const after = readFormattedCharacters(result, edit.from, edit.from + edit.insert.length);

    return before.length === after.length && before.every((character, index) => {
        const selected = range.from <= character.index && character.index < range.to;
        const expected = selected ? character.formats.replace(format, "") : character.formats;

        return after[index]!.char === character.char && after[index]!.formats === expected;
    });
}

/**
 * Clears inline formatting from the current selection by removing every
 * whole marker pair — `**`, `*`, `~~`, `++`, or a code span's backticks —
 * that the normalised selection touches, both of its markers together, so a
 * selection reaching only one marker of a pair never orphans its partner.
 * Markers are paired the way Markdown reads them (see
 * {@link pairDelimiterRuns}), so escaped markers, markers inside a code span,
 * a list bullet and a thematic break's `***` are never treated as
 * formatting. Links and `[text]{…}` styled spans are left alone, matching
 * the WYSIWYG command. Declines (`null`) when the selection touches no pair
 * — nothing to clear is no edit, rather than an identical rewrite that would
 * still cost an undo step — and on a collapsed caret that expands to nothing.
 */
export const CLEAR_FORMAT_SOURCE: MarkdownSourceTransform = (text, from, to) => {
    const range = normalizeRange(text, from, to);

    if (range === null) {
        return null;
    }

    const touched = findMarkerPairs(text, range.from, range.to)
        .filter((pair) => pair.openFrom < range.to && pair.closeTo > range.from);

    return touched.length === 0 ? null : removeMarkerPairs(text, range, touched);
};

/**
 * Reads what a source-mode selection can answer from raw text alone — the
 * five inline-format flags, whether there's something to act on, and any
 * enclosing link's URL. A flag is set when a marker pair of that format
 * covers the normalised selection, however far out it sits and however many
 * other formats lie between (see {@link coveringFormats}) — exactly when
 * pressing that format's toggle would remove it.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @returns The selection's source-mode state.
 */
export function readSourceSelectionState(text: string, from: number, to: number): MarkdownSourceSelectionState {
    const range = normalizeRange(text, from, to);
    const link = findEnclosingLink(text, from, to);
    const linkUrl = link !== null && !link.image ? link.url : null;

    if (range === null) {
        return {
            bold: false, italic: false, underline: false, strikethrough: false, code: false,
            hasSelectedText: false,
            linkUrl,
        };
    }

    const formats = coveringFormats(text, range);

    return {
        bold:            formats.has("b"),
        italic:          formats.has("i"),
        underline:       formats.has("u"),
        strikethrough:   formats.has("s"),
        code:            formats.has("c"),
        hasSelectedText: true,
        linkUrl,
    };
}

/** A leading heading, quote, bullet or numbered-list marker — what a block-type change replaces. */
const BLOCK_PREFIX = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+\.[ \t]+)/;

/** A ` ``` ` fence line, for {@link findBlockLineRun}'s fence scan. */
const FENCE_LINE = /^[ \t]*```/;

/** A block line for {@link paragraphAroundBlockSource}'s run-finding scan: a quote, list item, table row, or fence marker. */
const BLOCK_LINE = /^[ \t]*(?:>|[-*+][ \t]+|\d+\.[ \t]+|\||```)/;

/**
 * The one piece of block syntax a paragraph's continuation line carries: the
 * quote marker its paragraph's own lines share. A list marker, a `#` or a
 * number there is the paragraph's text.
 */
const CONTINUATION_PREFIX = /^[ \t]*>[ \t]?/;

/**
 * Strips the block syntax a line opens with: {@link BLOCK_PREFIX} from a line
 * that starts a block, {@link CONTINUATION_PREFIX} from one that continues a
 * paragraph.
 *
 * @param line - The line.
 * @param continuation - Whether it continues a paragraph.
 * @returns The line without that syntax.
 */
function stripBlockSyntax(line: string, continuation: boolean): string {
    return line.replace(continuation ? CONTINUATION_PREFIX : BLOCK_PREFIX, "");
}

/** Whether a line is blank — whitespace only. */
function isBlank(line: string): boolean {
    return line.trim() === "";
}

/**
 * Declines an edit that would rewrite its range to the text already there:
 * applying it would change nothing, yet still cost the user an undo step.
 *
 * @param text - The full document text.
 * @param edit - The candidate edit.
 * @returns `edit`, or `null` when it changes nothing.
 */
function unlessNoOp(text: string, edit: MarkdownSourceEdit): MarkdownSourceEdit | null {
    return text.slice(edit.from, edit.to) === edit.insert ? null : edit;
}

/**
 * Builds a block-type transform: expands the selection to whole lines and
 * then to whole paragraphs (see {@link selectWholeLines}), drops the fence
 * lines of a fenced code block selected whole and a setext heading's
 * underline, then rewrites each surviving line (see {@link rewriteBlockLine}). Declines (`null`) when the
 * lines already read that way — a blank line alone included — and when a
 * selected line belongs to any other multi-line construct.
 *
 * @param prefix - The prefix to write onto each line (`""` for a paragraph,
 *   `"> "` for a quote, `"#".repeat(level) + " "` for a heading).
 * @returns The transform.
 */
export function blockPrefixSource(prefix: string): MarkdownSourceTransform {
    return (text, from, to) => {
        const selected = selectWholeLines(text, from, to, true, true);

        if (selected === null) {
            return null;
        }

        const { start, end, continuations } = selected;
        const insert = selected.lines.map((line, index) => rewriteBlockLine(line, continuations[index]!, prefix)).join("\n");

        return unlessNoOp(text, { from: start, to: end, insert, selection: { from: start, to: start + insert.length } });
    };
}

/**
 * Rewrites one line for {@link blockPrefixSource}: strips its block syntax
 * (see {@link stripBlockSyntax}) and, when a new prefix replaces it, the
 * indentation left after it, which a continuation line carries and a line
 * opening a block would read as code. A blank line stays blank.
 *
 * @param line - The line.
 * @param continuation - Whether it continues a paragraph.
 * @param prefix - The prefix to write.
 * @returns The rewritten line.
 */
function rewriteBlockLine(line: string, continuation: boolean, prefix: string): string {
    if (isBlank(line)) {
        return line;
    }

    const stripped = stripBlockSyntax(line, continuation);

    return prefix === "" ? stripped : prefix + stripped.trimStart();
}

/**
 * Converts the selected whole paragraphs into a fenced code block: strips
 * each line's block syntax (see {@link stripBlockSyntax}; the fence lines of
 * a fenced code block selected whole and a setext heading's underline are
 * dropped, same as {@link blockPrefixSource}), then wraps the whole run in
 * ` ``` ` lines.
 * Declines (`null`) when the lines already are exactly that block, when a
 * selected line belongs to any other multi-line construct, and when the run
 * starts inside a list item's content: fence lines written at column 0 there
 * end the list, and the WYSIWYG editor holds no code block inside an item.
 */
export const FENCED_CODE_SOURCE: MarkdownSourceTransform = (text, from, to) => {
    const selected = selectWholeLines(text, from, to, true, true);

    if (selected === null || selected.inListItem) {
        return null;
    }

    const { start, end, continuations } = selected;
    const code = selected.lines.map((line, index) => stripBlockSyntax(line, continuations[index]!));
    const insert = ["```", ...code, "```"].join("\n");

    return unlessNoOp(text, { from: start, to: end, insert, selection: { from: start, to: start + insert.length } });
};

/** Whether every selected line already carries `kind`'s own list marker. */
function lineHasListMarker(kind: "unordered" | "ordered", line: string): boolean {
    return kind === "unordered" ? /^[ \t]*[-*+][ \t]+/.test(line) : /^[ \t]*\d+\.[ \t]+/.test(line);
}

/**
 * Builds a list-toggle transform: expands the selection to whole lines, then
 * either strips every non-blank line's marker (when each already carries
 * `kind`'s own marker) or strips its block syntax (see
 * {@link stripBlockSyntax}) and the indentation left after it, and prepends a
 * fresh one — `"- "` for an unordered list,
 * `"1. "`/`"2. "`/… (counting from one) for an ordered one. A blank line
 * stays blank. Each selected line becomes its own item, while the lines of a
 * paragraph below the selection continue the last item.
 *
 * Declines (`null`) when there is no non-blank line to act on, when a selected
 * line belongs to a multi-line construct (see {@link selectWholeLines}), a
 * fenced code block included — its lines are no list items — when the
 * selection touches a setext heading's text, whose underline would then
 * close the last item into a heading, when a line that continued a
 * paragraph would read as something other than text once it opens an item
 * (see {@link opensBlockOnItsOwn}), and when a line below the selection that
 * goes on continuing the last item would start a block inside it instead.
 *
 * @param kind - Which list marker to toggle.
 * @returns The transform.
 */
export function listSource(kind: "unordered" | "ordered"): MarkdownSourceTransform {
    return (text, from, to) => {
        const selected = selectWholeLines(text, from, to, false, false);

        if (selected === null || selected.setext) {
            return null;
        }

        const { start, end, lines, continuations } = selected;
        const allMarked = lines.every((line) => isBlank(line) || lineHasListMarker(kind, line));
        const opensBlock = (line: string, index: number): boolean => continuations[index]! && opensBlockOnItsOwn(stripBlockSyntax(line, true));
        // The lines below go on continuing the paragraph, now the last item's,
        // where a line that only read as text beside a top-level paragraph
        // would start a sibling or nested block instead.
        const interruptsItem = (line: string): boolean => interruptsParagraph(stripBlockSyntax(line, true), true);

        if (!allMarked && (lines.some(opensBlock) || selected.continuedBelow.some(interruptsItem))) {
            return null;
        }

        let items = 0;

        const rewritten = lines.map((line, index) => {
            if (isBlank(line)) {
                return line;
            }

            const stripped = stripBlockSyntax(line, continuations[index]!);

            if (allMarked) {
                return stripped;
            }

            items += 1;

            return (kind === "unordered" ? "- " : `${items}. `) + stripped.trimStart();
        });

        const insert = rewritten.join("\n");

        return unlessNoOp(text, { from: start, to: end, insert, selection: { from: start, to: start + insert.length } });
    };
}

/** One line's `[start, end)` span (excluding its own trailing newline) inside a document. */
interface LineSpan {
    text:  string;
    start: number;
    end:   number;
}

/** Splits `text` into its lines, each carrying its own document offsets. */
function splitLines(text: string): LineSpan[] {
    const lines: LineSpan[] = [];
    let start = 0;

    for (let index = 0; index <= text.length; index += 1) {
        if (index === text.length || text[index] === "\n") {
            lines.push({ text: text.slice(start, index), start, end: index });
            start = index + 1;
        }
    }

    return lines;
}

/** The line index whose span contains `offset`. */
function lineIndexAt(lines: LineSpan[], offset: number): number {
    return lines.findIndex((line) => offset <= line.end);
}

/**
 * A run of lines making up one multi-line construct other than paragraph
 * text, which a line command must not rewrite piecemeal: a fenced or indented
 * code block, a table, a link reference definition, an HTML block, or one
 * `:::` fence line.
 */
interface LineConstruct {
    /** `codeFence` for a fenced code block, `table` for a table, `other` for the rest. */
    kind:       "codeFence" | "table" | "other";
    first:      number;
    last:       number;
    /** A fenced code block's fence lines — one when it is never closed; empty for every other construct. */
    fenceLines: number[];
}

/** A code fence's opening line: up to three spaces of indentation, then three or more backticks or tildes. */
const CODE_FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** A `:::` fence line of the dialect's column regions; the Markdown between two of them is ordinary text. */
const COLUMN_FENCE_LINE = /^ {0,3}:{3,}/;

/** A line indented far enough to be indented code: four spaces, or a tab within the first four columns. */
const INDENTED_CODE_LINE = /^(?: {4}| {0,3}\t)/;

/** A list item's marker, after which an indented line is the item's continuation rather than code. */
const LIST_ITEM_LINE = /^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]|$)/;

/**
 * A line that starts a block even straight after paragraph text, so it never
 * continues a paragraph: an ATX heading, a quote, a bullet item or an ordered
 * item numbered 1 with content on its line, a code fence, a `:::` fence line,
 * or a thematic break. An empty item and an item numbered otherwise cannot
 * interrupt a paragraph.
 */
const PARAGRAPH_INTERRUPTION = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|[-*+][ \t]+\S|1[.)][ \t]+\S|`{3,}|~{3,}|:{3,}|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/;

/** A line holding no paragraph text once its container markers are gone: an ATX heading, a fence, a `:::` fence line or a thematic break. */
const NON_PARAGRAPH_LINE = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|:{3,}|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/;

/** A setext heading's underline: a run of `=` or `-` alone on its line. */
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

/** The quote and list markers a line opens with, nested ones included. */
const CONTAINER_PREFIX = /^(?:[ \t]*(?:>[ \t]?|(?:[-*+]|\d+[.)])(?:[ \t]+|$)))+/;

/** One quote marker opening a line. */
const QUOTE_MARKER = /^ {0,3}>[ \t]?/;

/** A link reference definition's opening: its bracketed label and the colon. */
const DEFINITION_LINE = /^ {0,3}\[(?:\\.|[^\\\]])+\]:/;

/**
 * One delimiter-row cell: `-`s optionally bounded by `:`, optionally followed
 * by a `{…}` attribute block. Mirrors `markdownTableExtension.ts`'s
 * `parseDelimiterRow`, whose table grammar this module may not import a
 * parsed document from.
 */
const DELIMITER_CELL = /^:?-+:?(?:\s*\{[^{}]*\})?$/;

/**
 * The HTML blocks CommonMark ends at an end marker rather than at a blank
 * line — raw-text elements, comments, processing instructions, declarations
 * and CDATA — as `[start, end]` pairs.
 */
const MARKED_END_HTML_BLOCKS: ReadonlyArray<readonly [RegExp, RegExp]> = [
    [/^ {0,3}<(?:script|pre|style|textarea)(?:[\s>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
    [/^ {0,3}<!--/, /-->/],
    [/^ {0,3}<\?/, /\?>/],
    [/^ {0,3}<![A-Za-z]/, />/],
    [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
];

/** An HTML block opened by one of CommonMark's block-level tag names; it runs to the next blank line. */
const BLOCK_TAG_HTML_BLOCK = new RegExp(
    "^ {0,3}</?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt"
    + "|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem"
    + "|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[\\s/>]|$)",
    "i",
);

/**
 * An HTML block made of one complete open or closing tag alone on its line;
 * it runs to the next blank line, and cannot interrupt a paragraph.
 */
const LONE_TAG_HTML_BLOCK = /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)[ \t]*$/;

/** Whether `lines[index]` is blank — or lies outside the document, which reads as a blank line's edge. */
function isBlankLine(lines: LineSpan[], index: number): boolean {
    return index < 0 || index >= lines.length || lines[index]!.text.trim() === "";
}

/**
 * Finds every multi-line construct other than paragraph text, scanning the
 * document's top-level lines in order. A line-based reading, like the rest of
 * this module: constructs nested inside a quote or list item are not found,
 * and where a line's reading is uncertain it errs toward a construct, which
 * only makes a line command decline.
 *
 * @param lines - The document's lines.
 * @returns The constructs, in document order.
 */
function findLineConstructs(lines: LineSpan[]): LineConstruct[] {
    const constructs: LineConstruct[] = [];

    for (let index = 0; index < lines.length; index += 1) {
        const construct = codeFenceAt(lines, index) ?? columnFenceLineAt(lines, index) ?? htmlBlockAt(lines, index)
            ?? tableAt(lines, index) ?? definitionAt(lines, index) ?? indentedCodeAt(lines, index);

        if (construct !== null) {
            constructs.push(construct);
            index = construct.last;
        }
    }

    return constructs;
}

/**
 * The fenced code block opening at `lines[index]`: through the first closing
 * fence of the same character at least as long, or to the document's end
 * when it is never closed.
 *
 * @param lines - The document's lines.
 * @param index - The candidate opening line.
 * @returns The block, or `null` when the line opens none.
 */
function codeFenceAt(lines: LineSpan[], index: number): LineConstruct | null {
    const open = CODE_FENCE_OPEN.exec(lines[index]!.text);

    if (open === null) {
        return null;
    }

    const run = open[1]!;
    const close = new RegExp(`^ {0,3}${run[0]!}{${run.length},}[ \\t]*$`);

    for (let last = index + 1; last < lines.length; last += 1) {
        if (close.test(lines[last]!.text)) {
            return { kind: "codeFence", first: index, last, fenceLines: [index, last] };
        }
    }

    return { kind: "codeFence", first: index, last: lines.length - 1, fenceLines: [index] };
}

/**
 * The `:::` fence line at `lines[index]`, a construct of one line.
 *
 * @param lines - The document's lines.
 * @param index - The candidate line.
 * @returns The line, or `null` when it is no `:::` fence line.
 */
function columnFenceLineAt(lines: LineSpan[], index: number): LineConstruct | null {
    return COLUMN_FENCE_LINE.test(lines[index]!.text) ? { kind: "other", first: index, last: index, fenceLines: [] } : null;
}

/**
 * The HTML block starting at `lines[index]`: through the line holding its end
 * marker for the kinds that have one, else to the line before the next blank
 * line.
 *
 * @param lines - The document's lines.
 * @param index - The candidate first line.
 * @returns The block, or `null` when the line starts none.
 */
function htmlBlockAt(lines: LineSpan[], index: number): LineConstruct | null {
    const text = lines[index]!.text;
    const marked = MARKED_END_HTML_BLOCKS.find(([start]) => start.test(text));

    if (marked !== undefined) {
        let last = index;

        while (last < lines.length - 1 && !marked[1].test(lines[last]!.text)) { last += 1; }

        return { kind: "other", first: index, last, fenceLines: [] };
    }

    if (!BLOCK_TAG_HTML_BLOCK.test(text) && !(LONE_TAG_HTML_BLOCK.test(text) && isBlankLine(lines, index - 1))) {
        return null;
    }

    return { kind: "other", first: index, last: lastBeforeBlankLine(lines, index), fenceLines: [] };
}

/**
 * The table whose header is `lines[index]`: the header, a delimiter row with
 * as many cells, and every body row up to the next blank line — the shape
 * `markdownTableExtension.ts` reads a table in.
 *
 * @param lines - The document's lines.
 * @param index - The candidate header line.
 * @returns The table, or `null` when the next line is no delimiter row for it.
 */
function tableAt(lines: LineSpan[], index: number): LineConstruct | null {
    if (index + 1 >= lines.length || isBlankLine(lines, index)) {
        return null;
    }

    const delimiter = tableRowCells(lines[index + 1]!.text);

    if (!delimiter.every((cell) => DELIMITER_CELL.test(cell)) || delimiter.length !== tableRowCells(lines[index]!.text).length) {
        return null;
    }

    return { kind: "table", first: index, last: lastBeforeBlankLine(lines, index + 1), fenceLines: [] };
}

/**
 * Splits a table row into its trimmed cell texts the way
 * `markdownTableExtension.ts`'s `splitRow` does: one optional leading and
 * trailing pipe dropped, then split on every pipe no backslash escapes.
 *
 * @param line - The row.
 * @returns Its cells.
 */
function tableRowCells(line: string): string[] {
    let trimmed = line.trim();

    if (trimmed.startsWith("|")) {
        trimmed = trimmed.slice(1);
    }

    if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
        trimmed = trimmed.slice(0, -1);
    }

    return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/**
 * The link reference definition opening at `lines[index]`, with the lines it
 * continues onto: a destination on the next line when the label's line has
 * none, and any indented or quoted line after — a title, or the rest of one.
 *
 * @param lines - The document's lines.
 * @param index - The candidate first line.
 * @returns The definition, or `null` when the line opens none.
 */
function definitionAt(lines: LineSpan[], index: number): LineConstruct | null {
    if (!DEFINITION_LINE.test(lines[index]!.text)) {
        return null;
    }

    let last = index;

    while (!isBlankLine(lines, last + 1)) {
        const destinationPending = /\]:[ \t]*$/.test(lines[last]!.text);
        const continues = /^[ \t]|^["'(]/.test(lines[last + 1]!.text);

        if (!destinationPending && !continues) {
            break;
        }

        last += 1;
    }

    return { kind: "other", first: index, last, fenceLines: [] };
}

/**
 * The indented code block starting at `lines[index]`: an indented line after
 * a blank one, when no list item or indented line above makes it a
 * continuation, through the last indented line before a non-indented one.
 *
 * @param lines - The document's lines.
 * @param index - The candidate first line.
 * @returns The block, or `null` when the line starts none.
 */
function indentedCodeAt(lines: LineSpan[], index: number): LineConstruct | null {
    const text = lines[index]!.text;

    if (!INDENTED_CODE_LINE.test(text) || isBlankLine(lines, index) || !isBlankLine(lines, index - 1)) {
        return null;
    }

    let above = index - 1;

    while (above >= 0 && isBlankLine(lines, above)) { above -= 1; }

    if (above >= 0 && (LIST_ITEM_LINE.test(lines[above]!.text) || /^[ \t]/.test(lines[above]!.text))) {
        return null;
    }

    let last = index;

    for (let next = index + 1; next < lines.length; next += 1) {
        if (INDENTED_CODE_LINE.test(lines[next]!.text) && !isBlankLine(lines, next)) {
            last = next;
        } else if (!isBlankLine(lines, next)) {
            break;
        }
    }

    return { kind: "other", first: index, last, fenceLines: [] };
}

/**
 * The last line of the run of non-blank lines starting at `lines[index]`.
 *
 * @param lines - The document's lines.
 * @param index - The run's first line.
 * @returns Its last line's index.
 */
function lastBeforeBlankLine(lines: LineSpan[], index: number): number {
    let last = index;

    while (!isBlankLine(lines, last + 1)) { last += 1; }

    return last;
}

/** The whole lines a line command rewrites, with any fence line or setext underline it drops already left out. */
interface SelectedLines {
    /** 0-based start of the first selected line. */
    start:          number;
    /** 0-based end of the last selected line, before its own newline. */
    end:            number;
    /** The selected lines' text, in order. */
    lines:          string[];
    /** For each of `lines`, whether it continues the paragraph text of the line above it. */
    continuations: boolean[];
    /** The lines below the selection that continue the paragraph its last line belongs to. */
    continuedBelow: string[];
    /** Whether the paragraphs around the selection hold a setext heading's underline. */
    setext:         boolean;
    /** Whether the first selected line sits inside a list item's content (see {@link insideListItem}). */
    inListItem:     boolean;
}

/**
 * Expands a raw `[from, to)` range to the whole lines a line command rewrites
 * — and, when `wholeParagraphs` is set, on to the whole paragraphs those
 * lines belong to (see {@link paragraphLineRange}), so the command never
 * leaves part of a paragraph to be re-read on its own, a setext heading's
 * underline dropped with the rest of its syntax. Declines when any line
 * belongs to a multi-line construct (see {@link findLineConstructs}):
 * rewriting one line of a code block, table, definition, `:::` fence or HTML
 * block would break the construct, and unbalancing a fence would turn the
 * rest of the document into code. The one exception, when `wholeCodeFences`
 * is set, is a fenced code block whose lines are all selected: it converts as
 * one unit, its fence lines dropped.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw range.
 * @param to - 0-based end (exclusive) of the raw range.
 * @param wholeCodeFences - Whether a fenced code block covered whole converts.
 * @param wholeParagraphs - Whether to take the selected lines' whole paragraphs.
 * @returns The lines, or `null` when the command must decline.
 */
function selectWholeLines(
    text: string, from: number, to: number, wholeCodeFences: boolean, wholeParagraphs: boolean,
): SelectedLines | null {
    const lines = splitLines(text);
    const constructs = findLineConstructs(lines);
    const reading = readParagraphLines(lines, constructs);
    const paragraphs = paragraphLineRange(reading, lineIndexAt(lines, from), lineIndexAt(lines, to));
    const { first, last } = wholeParagraphs ? paragraphs : { first: lineIndexAt(lines, from), last: lineIndexAt(lines, to) };
    const dropped = new Set<number>();

    for (const construct of constructs) {
        if (construct.last < first || last < construct.first) {
            continue;
        }

        const coveredWhole = first <= construct.first && construct.last <= last;

        if (!wholeCodeFences || construct.kind !== "codeFence" || !coveredWhole) {
            return null;
        }

        construct.fenceLines.forEach((line) => dropped.add(line));
    }

    const kept: string[] = [];
    const continuations: boolean[] = [];

    for (let index = first; index <= last; index += 1) {
        if (!dropped.has(index) && !reading.underline[index]!) {
            kept.push(lines[index]!.text);
            continuations.push(reading.continues[index]!);
        }
    }

    return {
        start:          lines[first]!.start,
        end:            lines[last]!.end,
        lines:          kept,
        continuations,
        continuedBelow: lines.slice(last + 1, paragraphs.last + 1).map((line) => line.text),
        setext:         reading.underline.slice(paragraphs.first, paragraphs.last + 1).includes(true),
        inListItem:     insideListItem(lines, first),
    };
}

/** How each line of a document stands toward the paragraph text around it. */
interface ParagraphReading {
    /** Per line: whether it continues the paragraph text of the line above, lazily or indented. */
    continues: boolean[];
    /** Per line: whether it is a setext heading's underline, closing the paragraph text above into a heading. */
    underline: boolean[];
}

/**
 * Reads, line by line, which lines continue a paragraph and which close one
 * as a setext heading's underline. A line-based reading, like the rest of
 * this module: a line continues the line above when that line holds
 * paragraph text (see {@link holdsParagraphText}) and it is not blank, not
 * part of a construct, and does not start a block that interrupts the
 * paragraph (see {@link interruptsParagraph}), read past the quote markers
 * the two lines share.
 *
 * @param lines - The document's lines.
 * @param constructs - Its multi-line constructs, from {@link findLineConstructs}.
 * @returns The reading.
 */
function readParagraphLines(lines: LineSpan[], constructs: LineConstruct[]): ParagraphReading {
    const inConstruct = lines.map((_line, index) => constructs.some((construct) => construct.first <= index && index <= construct.last));
    const continues: boolean[] = [];
    const underline: boolean[] = [];
    // Per line: the first line of the paragraph it belongs to.
    const starts: number[] = [];

    lines.forEach((line, index) => {
        const above = lines[index - 1]?.text;
        const afterText = above !== undefined && !inConstruct[index - 1]! && holdsParagraphText(above);
        const rest = above === undefined ? "" : stripSharedQuoteMarkers(above, line.text);
        const candidate = afterText && !inConstruct[index]! && !isBlank(rest);
        const isUnderline = candidate && SETEXT_UNDERLINE.test(line.text) && (line.text.includes("=") || !CONTAINER_PREFIX.test(above));
        const inList = candidate && opensListParagraph(lines[starts[index - 1]!]!.text);
        const isContinuation = candidate && !isUnderline && !SETEXT_UNDERLINE.test(line.text) && !interruptsParagraph(rest, inList);

        underline.push(isUnderline);
        continues.push(isContinuation);
        starts.push(isContinuation ? starts[index - 1]! : index);
    });

    return { continues, underline };
}

/**
 * Whether a paragraph whose first line is `line` sits in a list item: the
 * line, read past any quote markers, opens with a list marker or is indented
 * as an item's content.
 *
 * @param line - The paragraph's first line.
 * @returns Whether it does.
 */
function opensListParagraph(line: string): boolean {
    let rest = line;

    while (QUOTE_MARKER.test(rest)) { rest = rest.replace(QUOTE_MARKER, ""); }

    return LIST_ITEM_LINE.test(rest) || /^[ \t]/.test(rest);
}

/**
 * Whether `line` starts a block that interrupts the paragraph above it (see
 * {@link PARAGRAPH_INTERRUPTION}). Inside a list item, any list marker with
 * content starts a sibling or nested item, whatever its number and however
 * deep its indentation, and so does a deeper-indented heading, quote or
 * fence, which the item's content indentation brings back within reach.
 *
 * @param line - The line, past the quote markers it shares with the line above.
 * @param inList - Whether the paragraph sits in a list item.
 * @returns Whether it does.
 */
function interruptsParagraph(line: string, inList: boolean): boolean {
    if (!inList) {
        return PARAGRAPH_INTERRUPTION.test(line);
    }

    const content = line.trimStart();

    return PARAGRAPH_INTERRUPTION.test(content) || /^\d+[.)][ \t]+\S/.test(content);
}

/**
 * Widens the lines `[first, last]` to the whole paragraphs they belong to:
 * up while the first continues the line above or underlines it, down while
 * the next continues the last or underlines it — never past an underline,
 * which closes its paragraph.
 *
 * @param reading - The document's paragraph reading.
 * @param first - The first line's index.
 * @param last - The last line's index.
 * @returns The widened line range.
 */
function paragraphLineRange(reading: ParagraphReading, first: number, last: number): { first: number; last: number } {
    const { continues, underline } = reading;
    let top = first;
    let bottom = last;

    while (continues[top]! || underline[top]!) { top -= 1; }

    while (bottom + 1 < continues.length && !underline[bottom]! && (continues[bottom + 1]! || underline[bottom + 1]!)) { bottom += 1; }

    return { first: top, last: bottom };
}

/**
 * Whether a line holds paragraph text, read past the quote and list markers
 * it opens with: what is left is not blank and is no ATX heading, code fence,
 * `:::` fence line, thematic break or setext underline.
 *
 * @param line - The line.
 * @returns Whether it does.
 */
function holdsParagraphText(line: string): boolean {
    const rest = line.replace(CONTAINER_PREFIX, "");

    return rest.trim() !== "" && !NON_PARAGRAPH_LINE.test(rest) && !SETEXT_UNDERLINE.test(rest);
}

/**
 * Strips from `line` as many leading quote markers as `above` opens with, so
 * a quote's own `>` on each of its lines does not read as a new quote
 * interrupting its paragraph.
 *
 * @param above - The line above.
 * @param line - The line to strip.
 * @returns `line` without the shared markers.
 */
function stripSharedQuoteMarkers(above: string, line: string): string {
    let rest = line;

    for (let depth = quoteDepth(above); depth > 0 && QUOTE_MARKER.test(rest); depth -= 1) {
        rest = rest.replace(QUOTE_MARKER, "");
    }

    return rest;
}

/**
 * How many quote markers a line opens with, one after another.
 *
 * @param line - The line.
 * @returns The count.
 */
function quoteDepth(line: string): number {
    let depth = 0;

    for (let rest = line; QUOTE_MARKER.test(rest); rest = rest.replace(QUOTE_MARKER, "")) { depth += 1; }

    return depth;
}

/**
 * Whether `lines[index]` sits inside a list item's content below the item's
 * own marker line: it is indented, and the lines above it, up through blank
 * and indented ones, reach a list item's marker line. A nested item's marker
 * line counts, being indented itself; a top-level item's does not.
 *
 * @param lines - The document's lines.
 * @param index - The line's index.
 * @returns Whether it does.
 */
function insideListItem(lines: LineSpan[], index: number): boolean {
    if (!/^[ \t]/.test(lines[index]!.text)) {
        return false;
    }

    for (let above = index - 1; above >= 0; above -= 1) {
        const text = lines[above]!.text;

        if (LIST_ITEM_LINE.test(text)) {
            return true;
        }

        if (!isBlankLine(lines, above) && !/^[ \t]/.test(text)) {
            return false;
        }
    }

    return false;
}

/**
 * Whether a paragraph's continuation line would open a block other than
 * paragraph text once it starts a block of its own — a list item's first
 * line: a link reference definition, a list item (a number other than 1, or
 * an empty item, cannot interrupt a paragraph), or an HTML block of any kind,
 * including the lone-tag kind that cannot interrupt a paragraph either.
 *
 * @param line - The line, its quote marker already stripped.
 * @returns Whether it would.
 */
function opensBlockOnItsOwn(line: string): boolean {
    const content = line.trimStart();

    return DEFINITION_LINE.test(content) || LIST_ITEM_LINE.test(content) || BLOCK_TAG_HTML_BLOCK.test(content) || LONE_TAG_HTML_BLOCK.test(content)
        || MARKED_END_HTML_BLOCKS.some(([start]) => start.test(content));
}

/**
 * The escaped paragraph break a table cell's text carries between two of its
 * paragraphs: backslash-`n` twice, the sequence the viewer splits a cell's
 * text on (`Markdown.ts`'s `CELL_PARAGRAPH_BREAK`).
 */
const CELL_PARAGRAPH_BREAK = "\\n\\n";

/**
 * Whether `[from, to)` touches a table cell's paragraph break: holds one, or
 * cuts into one. Markers written around or into it would show it as literal
 * text, or leave a lone `\n` that shows as literal text. Breaks are found the
 * way the viewer splits on them, leftmost first and never overlapping.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the range.
 * @param to - 0-based end (exclusive) of the range.
 * @returns Whether it does.
 */
function touchesCellParagraphBreak(text: string, from: number, to: number): boolean {
    const lines = splitLines(text);
    const first = lineIndexAt(lines, from);
    const last = lineIndexAt(lines, to);
    const tables = findLineConstructs(lines).filter((construct) => construct.kind === "table");

    for (let index = first; index <= last; index += 1) {
        if (!tables.some((table) => table.first <= index && index <= table.last)) {
            continue;
        }

        const line = lines[index]!;

        for (let at = text.indexOf(CELL_PARAGRAPH_BREAK, line.start); at !== -1 && at < line.end;) {
            if (at < to && from < at + CELL_PARAGRAPH_BREAK.length) {
                return true;
            }

            at = text.indexOf(CELL_PARAGRAPH_BREAK, at + CELL_PARAGRAPH_BREAK.length);
        }
    }

    return false;
}

/**
 * Finds the run of consecutive lines around `lines[caretLine]` that make up
 * one block — a contiguous run of {@link BLOCK_LINE}-matching lines, or,
 * when the caret's line sits inside an open fence — an odd number of
 * {@link FENCE_LINE} lines precede it, or the line is itself one of the
 * fence's two markers — the whole fence, both markers and the code between
 * them.
 *
 * @param lines - The document's lines.
 * @param caretLine - The index of the caret's line.
 * @returns The block's first and last line indices, or `null` when the
 *   caret's line is neither a block line nor inside a fence.
 */
function findBlockLineRun(lines: LineSpan[], caretLine: number): { first: number; last: number } | null {
    let fencesBefore = 0;

    for (let index = 0; index < caretLine; index += 1) {
        if (FENCE_LINE.test(lines[index]!.text)) { fencesBefore += 1; }
    }

    const insideFence = fencesBefore % 2 === 1;
    const caretIsFence = FENCE_LINE.test(lines[caretLine]!.text);

    if (insideFence || caretIsFence) {
        // Together, the two flags fix which marker the caret is on: inside an
        // open fence region a marker can only be the CLOSING one, outside it
        // can only be an OPENING one. Each scan therefore has to start one line
        // PAST a marker the caret already sits on — starting on it matches that
        // line as its own partner, collapsing the run to the single marker and
        // putting the inserted line inside the code block.
        let open = insideFence && caretIsFence ? caretLine - 1 : caretLine;

        while (open >= 0 && !FENCE_LINE.test(lines[open]!.text)) { open -= 1; }

        let close = insideFence ? caretLine : caretLine + 1;

        while (close < lines.length && !FENCE_LINE.test(lines[close]!.text)) { close += 1; }

        return open >= 0 && close < lines.length ? { first: open, last: close } : null;
    }

    if (!BLOCK_LINE.test(lines[caretLine]!.text)) {
        return null;
    }

    let first = caretLine;

    while (first > 0 && BLOCK_LINE.test(lines[first - 1]!.text)) { first -= 1; }

    let last = caretLine;

    while (last < lines.length - 1 && BLOCK_LINE.test(lines[last + 1]!.text)) { last += 1; }

    return { first, last };
}

/**
 * Builds the paragraph-around-block transform: finds the run of consecutive
 * lines around the caret that make up one blockquote, list, table, or fenced
 * code block (see {@link findBlockLineRun}), and inserts a new line separated
 * from it by a blank line, leaving the caret on that new line.
 *
 * Two newlines, not one: a single newline leaves the caret on a line directly
 * adjacent to the block, which Markdown reads as a lazy continuation of it —
 * text typed there re-parses back INTO the quote, list or table instead of
 * becoming the paragraph outside it this command exists to make.
 *
 * @param after - Whether to insert after (`true`) or before (`false`) the block.
 * @returns The transform.
 */
export function paragraphAroundBlockSource(after: boolean): MarkdownSourceTransform {
    return (text, from) => {
        const lines = splitLines(text);
        const caretLine = lineIndexAt(lines, from);
        const run = findBlockLineRun(lines, caretLine);

        if (run === null) {
            return null;
        }

        const at = after ? lines[run.last]!.end : lines[run.first]!.start;
        // After: past both newlines, onto the new line below the blank one.
        // Before: at the insert point, which the blank line now separates from the block.
        const selectionAt = after ? at + 2 : at;

        return { from: at, to: at, insert: "\n\n", selection: { from: selectionAt, to: selectionAt } };
    };
}

/** An image's `{…}` size group, written straight after its `)`. */
const IMAGE_SIZE_GROUP = /^\{[^{}\n]*\}/;

/**
 * Whether an offset sits inside a link's or image's syntax: anywhere strictly
 * within an image (its alt text, its source, its size group), or within a
 * link but outside its bracketed text (its destination and title, and the
 * `](` between). A link's text holds inline content, an image included, so an
 * offset there — or at either outer edge of a link or image — is free.
 *
 * @param text - The full document text.
 * @param offset - 0-based offset.
 * @returns Whether it does.
 */
function insideLinkSyntax(text: string, offset: number): boolean {
    LINK_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = LINK_PATTERN.exec(text)) !== null) {
        const start = match.index;
        let end = start + match[0].length;

        if (start > 0 && text[start - 1] === "!") {
            end += IMAGE_SIZE_GROUP.exec(text.slice(end))?.[0].length ?? 0;

            if (start - 1 < offset && offset < end) {
                return true;
            }
        } else if (start + 1 + match[1]!.length < offset && offset < end) {
            return true;
        }
    }

    return false;
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
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @returns Whether it would.
 */
function cutsTableStructure(text: string, from: number, to: number): boolean {
    const lines = splitLines(text);
    const line = lineIndexAt(lines, from);

    return findLineConstructs(lines).some((table) => {
        if (table.kind !== "table" || to < lines[table.first]!.start || from > lines[table.last]!.end) {
            return false;
        }

        if (line !== lineIndexAt(lines, to) || line < table.first || line > table.last || line === table.first + 1
            || UNESCAPED_PIPE.test(text.slice(from, to))) {
            return true;
        }

        const row = lines[line]!;
        const open = row.text.search(/\S/);
        const close = row.text.trimEnd().length - 1;
        const opens = row.text[open] === "|";
        const closes = close > open && row.text[close] === "|" && row.text[close - 1] !== "\\";

        return (opens && from - row.start <= open) || (closes && to - row.start > close);
    });
}

/** A `|||` line separating two columns of a `:::` fence. */
const COLUMN_SEPARATOR_LINE = /^ {0,3}\|\|\|[ \t]*$/;

/**
 * Whether a range touches a fence line — a line of a `:::` fence's own
 * syntax (an opening or closing `:::` line, or a `|||` column separator), or
 * a fenced code block's opening or closing line, its indentation included —
 * which text written on it, or a selection replaced across it, would break:
 * a code block would open or end elsewhere, and the lines around it read
 * anew.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @returns Whether it does.
 */
function touchesFenceLine(text: string, from: number, to: number): boolean {
    const lines = splitLines(text);
    const first = lineIndexAt(lines, from);
    const last = lineIndexAt(lines, to);
    const codeFenceLines = findLineConstructs(lines).flatMap((construct) => construct.fenceLines);

    return lines.slice(first, last + 1).some((line, offset) => COLUMN_FENCE_LINE.test(line.text)
        || COLUMN_SEPARATOR_LINE.test(line.text) || codeFenceLines.includes(first + offset));
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

        if (spec === null || insideLinkSyntax(text, from) || insideLinkSyntax(text, to)
            || cutsTableStructure(text, from, to) || touchesFenceLine(text, from, to)) {
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

/**
 * A GFM delimiter cell with no alignment and no width — every column
 * `tableSource` builds. Spelled out here rather than produced by
 * `markdownTableTransformer.ts`'s `formatDelimiterRow`, which lives in a
 * Lexical module this leaf module must not import; the test suite pins the
 * row built from it byte-for-byte against that helper's output.
 */
const UNALIGNED_DELIMITER_CELL = "---";

/**
 * Builds the table-insertion transform: at the start of the caret's
 * paragraph — the caret's line, or the first line of the paragraph it
 * continues, since a table splitting a paragraph would leave its lower lines
 * to be re-read on their own — inserts a blank separator line (unless the
 * line above the insertion point is already blank, or the table lands at the
 * document start), the header row, the delimiter row (byte-for-byte what
 * `markdownTableTransformer.ts`'s `formatDelimiterRow` emits for `columns`
 * unaligned, unsized columns), `rows - 1` body rows, and a trailing blank
 * line. The caret lands in the first header cell. Declines (`null`) when the
 * insertion point sits inside a list item's content: a table written at
 * column 0 there ends the list, and the WYSIWYG editor holds no table inside
 * an item.
 *
 * @param rows - The number of rows, including the header row.
 * @param columns - The number of columns.
 * @returns The transform.
 */
export function tableSource(rows: number, columns: number): MarkdownSourceTransform {
    return (text, from) => {
        const lines = splitLines(text);
        const caretLine = lineIndexAt(lines, from);
        const { first } = paragraphLineRange(readParagraphLines(lines, findLineConstructs(lines)), caretLine, caretLine);

        if (insideListItem(lines, first)) {
            return null;
        }

        const start = lines[first]!.start;

        // The separator goes ABOVE the table, so what decides it is the line
        // PRECEDING the insertion point — not the caret's own line, which the
        // insert pushes below the table. `above` ends with a newline unless the
        // table lands at the document start, where no separator is wanted.
        const above = text.slice(0, start);
        const previousLine = above.slice(0, -1).split("\n").pop() ?? "";
        const separatorNeeded = above !== "" && previousLine.trim() !== "";

        const emptyRow = "| " + Array.from({ length: columns }, () => "").join(" | ") + " |";
        const delimiterRow = "| " + Array.from({ length: columns }, () => UNALIGNED_DELIMITER_CELL).join(" | ") + " |";
        const bodyRows = Array.from({ length: rows - 1 }, () => emptyRow);
        const tableText = [emptyRow, delimiterRow, ...bodyRows].join("\n");

        const prefix = separatorNeeded ? "\n" : "";
        const insert = prefix + tableText + "\n\n";
        const caretOffset = prefix.length + 2; // "| " into the first header cell

        return { from: start, to: start, insert, selection: { from: start + caretOffset, to: start + caretOffset } };
    };
}
