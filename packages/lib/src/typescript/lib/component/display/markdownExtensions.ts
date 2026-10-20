// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Lexer as MarkedLexer, Marked, Tokenizer } from "marked";
import type { Lexer, Links, Token, TokenizerExtension, TokenizerObject, Tokens } from "marked";
import {
    FENCE_ATTRIBUTE_GROUP, lineEndAt, parseAttributes, readFenceLine, splitColumnSections, startFenceLineScan,
} from "~/component/display/markdownAttributes.js";
import { decodeCharacterReferences, decodeEscapesAndCharacterReferences } from "~/component/display/markdownCharacterReferences.js";
import { tokenizeTable } from "~/component/display/markdownTableExtension.js";
import { expandPrefixTabs, restoreTokenSources, tabWidthAt } from "~/component/display/markdownTabs.js";

/**
 * `marked`'s own patterns for a full reference (`[text][label]`, `![alt][label]`)
 * and for a collapsed or shortcut one (`[label][]`, `[label]`, with a leading
 * `!` for an image) — the patterns that produce a reference's `link` or image
 * token, so a label holding an escaped bracket or a code span is read exactly
 * as the viewer reads it. The reference-link importer and the image writer
 * match whole written forms against them.
 */
export const FULL_REFERENCE = MarkedLexer.rules.inline.gfm.reflink;
export const SHORT_REFERENCE = MarkedLexer.rules.inline.gfm.nolink;

/** The `mdblock` token the fence extension emits — one token list per column. */
export interface MdBlockToken {
    type:       "mdblock";
    raw:        string;
    attributes: Record<string, string>;
    columns:    Token[][];
}

/**
 * The `mdimage` token every image arrives as, whatever form it was written in.
 * It is a leaf: it has no `tokens` field, so every walker that treats an image
 * as one atom keeps doing so.
 */
export interface MdImageToken {
    type:          "mdimage";
    /** The image and its attribute group, as written. */
    raw:           string;
    /** The image as written, without its attribute group. */
    imageRaw:      string;
    /** The description's plain text. */
    alt:           string;
    /** The destination as read: escapes and references read, `<…>` dropped. */
    src:           string;
    /** The title as read; `null` when there is none or it is empty. */
    title:         string | null;
    /** The attribute group, parsed. */
    attributes:    Record<string, string>;
    /** The group's text between its braces; `""` when there is none. */
    attributeText: string;
}

/** The length of each `++` mark of an underline. */
const UNDERLINE_MARK_LENGTH = 2;

/** A run of `+`, the candidates for an underline's closing mark. */
const PLUS_RUN = /\++/g;

/** A Unicode punctuation or symbol character: what `marked`'s flanking rules count as punctuation. */
const FLANKING_PUNCTUATION = /^[\p{P}\p{S}]$/u;

/** One whitespace character, as a delimiter's neighbour. */
const FLANKING_WHITESPACE = /^\s$/;

/**
 * `marked`'s own patterns for the stretches its emphasis and strikethrough
 * pairing skips: a reference (masked only when its label is defined), a
 * backslash escape of punctuation, and an inline link or image, a code span
 * or an inline tag or autolink.
 */
const REFERENCE_SEARCH = MarkedLexer.rules.inline.gfm.reflinkSearch;
const ESCAPED_PUNCTUATION = MarkedLexer.rules.inline.gfm.anyPunctuation;
const PAIRING_SKIPPED = MarkedLexer.rules.inline.gfm.blockSkip;

/**
 * Tells whether a delimiter's neighbour is blank: whitespace, or the edge of
 * the text (`""`).
 *
 * @param char - The neighbour.
 * @returns `true` for whitespace or no character.
 */
function isBlankNeighbour(char: string): boolean {
    return char === "" || FLANKING_WHITESPACE.test(char);
}

/**
 * Tells whether a `++` between two characters can open an underline:
 * CommonMark's left-flanking rule, which GFM's `~~` follows too. It is not
 * followed by whitespace, and when punctuation follows it, whitespace,
 * punctuation or the edge of the text precedes it.
 *
 * @param before - The character before the `++` (`""` at the edge).
 * @param after - The character after it (`""` at the edge).
 * @returns `true` when it is left-flanking.
 */
function opensUnderline(before: string, after: string): boolean {
    return !isBlankNeighbour(after) && (!FLANKING_PUNCTUATION.test(after) || isBlankNeighbour(before) || FLANKING_PUNCTUATION.test(before));
}

/**
 * Tells whether a `++` between two characters can close an underline:
 * CommonMark's right-flanking rule, the mirror of {@link opensUnderline}.
 *
 * @param before - The character before the `++` (`""` at the edge).
 * @param after - The character after it (`""` at the edge).
 * @returns `true` when it is right-flanking.
 */
function closesUnderline(before: string, after: string): boolean {
    return !isBlankNeighbour(before) && (!FLANKING_PUNCTUATION.test(before) || isBlankNeighbour(after) || FLANKING_PUNCTUATION.test(after));
}

/**
 * Masks the stretches of an inline text that `marked` hides from its own
 * emphasis and strikethrough pairing, as `marked` masks them, so a `++` in
 * them never closes an underline: a defined reference, a backslash escape,
 * an inline link or image, a code span, an inline tag or autolink. Each mask
 * keeps the length of what it replaces, and keeps punctuation at its edges,
 * as the stretch has, so a `++` next to it flanks as it does next to the
 * stretch. An escape is masked with `!`, not with the `+` `marked` uses,
 * which would read as an underline mark here.
 *
 * @param src - The inline text, from an underline's opening `++` on.
 * @param links - The document's link reference definitions.
 * @returns The masked text, as long as `src`.
 */
function maskedForPairing(src: string, links: Links): string {
    const bracketed = (stretch: string): string => "[" + "a".repeat(stretch.length - 2) + "]";

    const references = src.replace(REFERENCE_SEARCH, (stretch) => {
        const labelStart = stretch.lastIndexOf("[");
        const defined = Object.hasOwn(links, linkLabelKey(stretch.slice(labelStart + 1, -1)));

        return defined ? bracketed(stretch) : stretch;
    });

    return references.replace(ESCAPED_PUNCTUATION, (escape) => "!".repeat(escape.length)).replace(PAIRING_SKIPPED, bracketed);
}

/**
 * What the underline tokenizer reads of one inline text, once: `marked`
 * tries the tokenizer at each `++` of the text in turn, each time on the rest
 * of the text and with the same token list, so every try reads the text the
 * first try was given — as `marked`'s own `~~` search reads the end of the
 * text it masks once.
 */
interface InlineTextReading {
    /** The inline text from the first `++` the tokenizer was tried at on. */
    readonly text: string;
    /** The character before `text` (the last of the token read before it), or `""` at the inline text's start. */
    readonly before: string;
    /** The underline pairs of `text` ({@link underlinePairs}), read on the first try that needs them. */
    closers: ReadonlyMap<number, number> | null;
}

/** The reading of each inline text the underline tokenizer is tried in, keyed by the token list its lex fills. */
const INLINE_TEXT_READINGS = new WeakMap<readonly Token[], InlineTextReading>();

/**
 * The reading of the inline text a try of the underline tokenizer stands
 * in, and where the try stands in it: the reading a first try in the same
 * lex made, or a new one. The text before the try is read from the reading,
 * never from the token list: a text token there grows as `marked` joins text
 * to it, and reading its end at every try would copy it each time.
 *
 * @param src - The inline text, from the `++` tried on.
 * @param tokens - The token list the inline lex fills.
 * @returns The reading, and the index of `src`'s start in its text.
 */
function inlineTextReading(src: string, tokens: readonly Token[]): { reading: InlineTextReading; offset: number } {
    let reading = INLINE_TEXT_READINGS.get(tokens);

    if (reading === undefined || reading.text.length < src.length) {
        reading = { text: src, before: tokens.at(-1)?.raw.at(-1) ?? "", closers: null };
        INLINE_TEXT_READINGS.set(tokens, reading);
    }

    return { reading, offset: reading.text.length - src.length };
}

/**
 * Pairs the `++` marks of a masked inline text, as `marked` pairs `~~`: a
 * `++` that can open is closed by the first right-flanking `++` after it at
 * which every `++` between that can only open has been closed. A `++` that
 * can both open and close closes when something is open before it. A run of
 * one `+`, or of three or more, neither opens nor closes. One pass: the
 * marks that can open wait on a stack with the depth of open marks they
 * leave, and a closing mark closes every waiting one whose depth it takes the
 * count below.
 *
 * @param masked - The text, masked ({@link maskedForPairing}).
 * @returns For each `++` that can open, by its index, the index of its closing `++`.
 */
function underlinePairs(masked: string): Map<number, number> {
    const closers = new Map<number, number>();
    const waiting: Array<{ index: number; depth: number }> = [];
    let depth = 0;

    for (const run of masked.matchAll(PLUS_RUN)) {
        if (run[0].length !== UNDERLINE_MARK_LENGTH) {
            continue;
        }

        const before = masked.charAt(run.index - 1);
        const after = masked.charAt(run.index + UNDERLINE_MARK_LENGTH);
        const closes = closesUnderline(before, after);
        const opens = opensUnderline(before, after);

        if (!closes && !opens) {
            continue;
        }

        depth += closes ? -1 : 1;

        while (waiting.length > 0 && depth < waiting[waiting.length - 1]!.depth) {
            closers.set(waiting.pop()!.index, run.index);
        }

        if (opens) {
            waiting.push({ index: run.index, depth });
        }
    }

    return closers;
}

/**
 * The length of the run of `+` a text starts with.
 *
 * @param src - The text.
 * @returns The number of `+` at its start.
 */
function leadingPlusRun(src: string): number {
    let length = 0;

    while (src.charAt(length) === "+") {
        length += 1;
    }

    return length;
}

/**
 * `++text++` — an inline-format-style extension so nested emphasis
 * (`**++b++**`) works with no special-casing: the tokenizer recurses into its
 * inner text through `this.lexer.inlineTokens`, exactly as `marked`'s
 * built-in `strong`/`em` do. Its marks pair as `marked` pairs GFM's `~~`: a
 * run of exactly two `+` (an escaped `+` before it is no part of the run)
 * opens when it is left-flanking ({@link opensUnderline}) and closes at the
 * right-flanking run that pairs with it ({@link underlinePairs}), outside
 * code spans, links and tags, so `C++ and C++` stays text. Like `~~` and
 * `*`, it may stand inside a word (`a++b++c`). The pairs of an inline text
 * are read once ({@link inlineTextReading}), so lexing stays linear.
 */
const UNDERLINE_EXTENSION: TokenizerExtension = {
    name:  "underline",
    level: "inline",
    start(src) {
        return src.indexOf("++");
    },
    tokenizer(src, tokens) {
        const after = src.charAt(UNDERLINE_MARK_LENGTH);
        // Read first, so a `++` before whitespace (`C++ and`) declines at once.
        const mayOpen = leadingPlusRun(src) === UNDERLINE_MARK_LENGTH && !isBlankNeighbour(after);

        if (!mayOpen) {
            return undefined;
        }

        const { reading, offset } = inlineTextReading(src, tokens);
        const before = offset > 0 ? reading.text.charAt(offset - 1) : reading.before;
        // A `+` before the run makes it longer, unless that `+` is escaped.
        const longerRun = before === "+" && tokens.at(-1)?.type !== "escape";
        const opens = !longerRun && opensUnderline(before, after);

        if (!opens) {
            return undefined;
        }

        reading.closers ??= underlinePairs(maskedForPairing(reading.text, this.lexer.tokens.links));

        const closerAt = reading.closers.get(offset);

        if (closerAt === undefined) {
            return undefined;
        }

        const closer = closerAt - offset;
        const text = src.slice(UNDERLINE_MARK_LENGTH, closer);

        return {
            type:   "underline",
            raw:    src.slice(0, closer + UNDERLINE_MARK_LENGTH),
            text,
            tokens: this.lexer.inlineTokens(text),
        };
    },
};

/**
 * `[text]{key=value …}` — a coloured/sized/font-styled span. Requires `{`
 * immediately after the closing `]`, which a plain link's `[text](url)` never
 * has, so the two constructs never collide despite both starting with `[`.
 */
const STYLED_SPAN_EXTENSION: TokenizerExtension = {
    name:  "styledspan",
    level: "inline",
    start(src) {
        return src.indexOf("[");
    },
    tokenizer(src) {
        const match = /^\[([^[\]]+)\]\{([^{}]*)\}/.exec(src);

        if (match === null) {
            return undefined;
        }

        return {
            type:       "styledspan",
            raw:        match[0],
            text:       match[1],
            attributes: parseAttributes(match[2]!),
            tokens:     this.lexer.inlineTokens(match[1]!),
        };
    },
};

/**
 * Extracts the `{key=value …}` attribute text from a fence's opening
 * remainder (the text after `:::`), or `""` when the remainder carries no
 * `{…}` group.
 *
 * @param remainder - The opening line's text after `:::`, trimmed.
 * @returns The attribute text inside the first `{…}` group, or `""`.
 */
function extractFenceAttributeText(remainder: string): string {
    const match = FENCE_ATTRIBUTE_GROUP.exec(remainder);

    return match === null ? "" : match[1]!;
}

/**
 * `::: {align=… gap=…}` … `:::` — a block alignment / column-region fence. A
 * line whose trimmed form starts with `:::` and has a non-empty remainder
 * opens a block; a line whose trimmed form is exactly `:::` closes one. The
 * scan (`readFenceLine`) tracks depth so fences nest, and code fences so a
 * `:::` line inside code is code; a code block left open hides the closing
 * line, and the fence then declines. The inner content is split into one
 * section per `|||` line (`splitColumnSections`, which itself tracks fence
 * depth and code-fence state so a separator inside a nested fence or a code
 * block is ordinary content), and each section is re-lexed on its own with
 * `this.lexer.blockTokens` into its own column's token list. Each section is
 * lexed with `marked`'s `top` state on, so a fence in a list item holds
 * paragraphs like a fence anywhere else.
 */
const BLOCK_EXTENSION: TokenizerExtension = {
    name:  "mdblock",
    level: "block",
    tokenizer(src) {
        const openingEnd = lineEndAt(src, 0);
        const firstLine = src.slice(0, openingEnd).trim();

        if (!firstLine.startsWith(":::")) {
            return undefined;
        }

        const openingRemainder = firstLine.slice(3).trim();

        // A bare ":::" with nothing to open is a stray closer, not an opener.
        if (openingRemainder === "") {
            return undefined;
        }

        const scan = startFenceLineScan();
        let closingStart = -1;
        let lineEnd = openingEnd;

        while (lineEnd < src.length) {
            const lineStart = lineEnd + 1;

            lineEnd = lineEndAt(src, lineStart);

            const role = readFenceLine(scan, src.slice(lineStart, lineEnd));

            if (role === "closer") {
                closingStart = lineStart;

                break;
            }
        }

        // No matching close anywhere in the remaining source: decline
        // entirely, so the lines fall through to ordinary paragraphs.
        if (closingStart === -1) {
            return undefined;
        }

        // The `break` above leaves `lineEnd` at the end of the closing line,
        // so `raw` runs through it. When the close directly follows the
        // opening line, `closingStart - 1` is `openingEnd` and `inner` is "".
        const raw = src.slice(0, lineEnd);
        const inner = src.slice(openingEnd + 1, closingStart - 1);

        return {
            type:       "mdblock",
            raw,
            attributes: parseAttributes(extractFenceAttributeText(openingRemainder)),
            columns:    splitColumnSections(inner).map((section) => {
                // A fence holds blocks wherever it stands. In a list item `marked` lexes with `top` off, where a
                // paragraph is a bare `text` token; `blockTokens` turns `top` back on when it returns.
                this.lexer.state.top = true;

                return this.lexer.blockTokens(section);
            }),
        } satisfies MdBlockToken;
    },
};

/**
 * An empty line, or a line of spaces only. None of the windowed constructs
 * continues past one: a blockquote's lazy continuation and an `lheading`'s
 * content stop there, and a list item continues only onto the marker line
 * {@link LIST_MARKER_LINE} allows. A tab-only line is deliberately not blank
 * here: reading it as content can only lengthen a window, never cut one short.
 */
const SPACES_ONLY_LINE = /^ *$/;

/**
 * A list-item marker line at column 0. A loose list continues across a blank
 * line onto its next item, so such a line is the one column-0, non-blank line
 * that does not end a windowed construct.
 */
const LIST_MARKER_LINE = /^(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/;

/**
 * Cuts `src` at its first *restart line* — a line that (1) follows an empty or
 * spaces-only line, (2) is not itself empty or spaces-only, (3) starts at
 * column 0, its first character neither a space nor a tab, and (4) is not a
 * list-item marker line. None of the four windowed block constructs can
 * continue onto such a line, so `marked`'s own tokenizer returns the same
 * token for the window as for the whole remaining document — while a rule
 * whose anchored regex JavaScriptCore scans from every start position pays for
 * the window's length instead of the document's.
 *
 * @param src - The remaining source at the current block position.
 * @returns `src` cut just before its first restart line, or all of `src` when
 *   it has none.
 */
function blockWindow(src: string): string {
    let lineStart = 0;
    let previousBlank = false;

    while (lineStart < src.length) {
        const lineEnd = lineEndAt(src, lineStart);
        const line = src.slice(lineStart, lineEnd);
        const blank = SPACES_ONLY_LINE.test(line);

        if (previousBlank && !blank && !line.startsWith(" ") && !line.startsWith("\t") && !LIST_MARKER_LINE.test(line)) {
            return src.slice(0, lineStart);
        }

        previousBlank = blank;
        lineStart = lineEnd + 1;
    }

    return src;
}

/** Read off `marked`'s `hr` rule, which begins `^ {0,3}` then one of `-`, `_`, `*`. */
const HR_START = /^ {0,3}[-*_]/;

/** Read off `marked`'s `blockquote` rule, which begins `^( {0,3}>`. */
const BLOCKQUOTE_START = /^ {0,3}>/;

/** Read off `marked`'s `list` rule, `^( {0,3}(?:[*+-]|\d{1,9}[.)]))([ \t][^\n]*?)?(?:\n|$)`, which matches exactly where this does. */
const LIST_START = /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t\n]|$)/;

/** Read off `marked`'s `html` rule, every alternative of which begins `^ {0,3}<`. */
const HTML_START = /^ {0,3}</;

/** The line a setext heading's content must end at, read off `marked`'s `lheading` rule's closing ` {0,3}(=+|-+) *` step. */
const SETEXT_UNDERLINE_LINE = /^ {0,3}(?:=+|-+) *$/;

/** Whitespace-only by JavaScript's `\s`, the class `lheading`'s `\n(?!\s*?\n…)` step stops its content at. */
const WHITESPACE_ONLY_LINE = /^\s*$/;

/**
 * Whether the second line holds a `-`. The dialect's table tokenizer requires
 * its delimiter row's segments to be `:?-+:?`, so a second line without one
 * can never start a table.
 *
 * @param src - The remaining source at the current block position.
 * @returns `true` when a second line exists and contains `-`.
 */
function secondLineHasDash(src: string): boolean {
    const firstEnd = src.indexOf("\n");

    return firstEnd !== -1 && src.slice(firstEnd + 1, lineEndAt(src, firstEnd + 1)).includes("-");
}

/**
 * Whether a setext underline can close a heading that starts here: some line
 * after the first, and before the first whitespace-only line, is a run of `=`
 * or `-`. `marked`'s `lheading` content cannot cross a whitespace-only line,
 * so no underline beyond one can belong to a heading at this position.
 *
 * @param src - The remaining source at the current block position.
 * @returns `true` when a reachable setext underline line exists.
 */
function hasSetextUnderline(src: string): boolean {
    let lineEnd = lineEndAt(src, 0);

    while (lineEnd < src.length) {
        const lineStart = lineEnd + 1;

        lineEnd = lineEndAt(src, lineStart);

        const line = src.slice(lineStart, lineEnd);

        if (WHITESPACE_ONLY_LINE.test(line)) {
            return false;
        }

        if (SETEXT_UNDERLINE_LINE.test(line)) {
            return true;
        }
    }

    return false;
}

/** One entry on `marked`'s inline queue: a block's inline source, and the token array its inline pass fills. */
type InlineQueueEntry = Lexer["inlineQueue"][number];

/** The inline-queue entries one list item's lexing queued, as {@link recordingLexer} found them. */
interface QueuedItemEntries {
    /** The entries, in queue order. */
    entries:  InlineQueueEntry[];
    /** Each entry's source text, before `marked` searched the queue for a task marker. */
    sources:  string[];
    /** The entry holding the item's first token's inline tokens, when that token is a paragraph or text run. */
    ownEntry: InlineQueueEntry | undefined;
}

/**
 * A view of `lexer` whose `blockTokens` also records, under the token array it
 * returns, the inline-queue entries that call queued. `marked`'s list
 * tokenizer lexes each item through `this.lexer.blockTokens(item.text, [])`
 * and keeps the returned array as `item.tokens`, so the record of every item
 * is found again from the finished list. Every other property — the queue, the
 * state, the token list — is `lexer`'s own, read through the prototype.
 *
 * @param lexer - The lexer the list tokenizer is running in.
 * @param records - Receives one record per `blockTokens` call, keyed by its result.
 * @returns The recording view.
 */
function recordingLexer(lexer: Lexer, records: Map<Token[], QueuedItemEntries>): Lexer {
    const blockTokens = (text: string, tokens: Token[]): Token[] => {
        const firstQueued = lexer.inlineQueue.length;
        const itemTokens = lexer.blockTokens(text, tokens);
        const entries = lexer.inlineQueue.slice(firstQueued);
        const first = itemTokens[0];
        const ownTokens = first?.type === "paragraph" || first?.type === "text" ? first.tokens : undefined;

        records.set(itemTokens, {
            entries,
            sources:  entries.map((entry) => entry.src),
            ownEntry: entries.find((entry) => entry.tokens === ownTokens),
        });

        return itemTokens;
    };

    return Object.create(lexer, { blockTokens: { value: blockTokens } }) as Lexer;
}

/**
 * Runs `marked`'s list tokenizer, then takes each task item's `[ ] `/`[x] `
 * marker off the item's own first text and off nothing else. `marked` 18
 * strips the marker from the *last* entry on the lexer's inline queue that
 * starts with one, and that is a later paragraph or table cell of the same
 * item whenever one of those also starts with a marker: the item's text then
 * kept its marker and the later block lost its own.
 *
 * The original runs against {@link recordingLexer}'s view, which records each
 * item's queued entries just before `marked` searches the queue. Afterwards
 * every recorded entry gets its recorded text back — undoing whichever strip
 * `marked` made — and a task item's own entry loses the marker. A nested list
 * finishes this inside its parent item's lexing, before the parent records, so
 * the parent restores the nested entries to their already-fixed text. Only the
 * queued sources change: the token tree, checkbox included, is `marked`'s own.
 *
 * @param src - The remaining source at the current block position.
 * @returns The list token, or `undefined` when no list starts here.
 */
function listWithOwnTaskMarker(this: Tokenizer, src: string): Tokens.List | undefined {
    const records = new Map<Token[], QueuedItemEntries>();
    const recordingTokenizer = Object.create(this, { lexer: { value: recordingLexer(this.lexer, records) } }) as Tokenizer;
    const list = Tokenizer.prototype.list.call(recordingTokenizer, src);

    for (const item of list?.items ?? []) {
        const record = records.get(item.tokens);

        if (record === undefined) {
            continue;
        }

        record.entries.forEach((entry, index) => {
            entry.src = record.sources[index]!;
        });

        if (item.task && record.ownEntry !== undefined) {
            record.ownEntry.src = record.ownEntry.src.replace(this.rules.other.listReplaceTask, "");
        }
    }

    return list;
}

/** The newlines `marked` trims off the end of a blockquote rule's match before reading its lines. */
const TRAILING_NEWLINES = /\n+$/;

/**
 * Runs the dialect's table tokenizer in `marked`'s `table` slot. The cast
 * exists because `marked` types the slot's result as its own `Tokens.Table`,
 * while the lexer reads only `raw` from it and every consumer switches on the
 * `mdtable` type the dialect's token carries.
 *
 * @param src - The remaining source at the current block position.
 * @returns The `mdtable` token, or `undefined` when no table starts here.
 */
function dialectTable(this: Tokenizer, src: string): Tokens.Table | undefined {
    return tokenizeTable.call(this, src) as unknown as Tokens.Table | undefined;
}

/**
 * Finds where the source a blockquote used ends: the latest *candidate end*
 * not past the length of `marked`'s own `raw`. The candidate ends are the end
 * of the rule's match, and the end of every `>` line a lazy line (one without
 * `>`) follows — the only places `marked`'s line loop can stop.
 *
 * The snap is exact whenever the loop runs out of lines (the source used is
 * then the whole match). It can be inexact only when the loop stops early at
 * a code block after four or more lazy list re-reads in one quote: candidate
 * ends there lie at least four characters apart, and the rebuilt `raw` could
 * then outgrow the source past the next one, so the snap would land a
 * candidate late. That is a bound, not an observed case — a 200,000-document
 * probe while planning, the stack review's fuzz and a 185,000-document probe
 * of quote, list, lazy and fence lines found none: every top-level `raw`
 * joined back into the source.
 *
 * @param quoted - The blockquote rule's match, its trailing newlines dropped.
 * @param rebuiltLength - The length of the `raw` `marked` built.
 * @returns The length of the source the quote used, or `rebuiltLength` when
 *   no candidate end qualifies.
 */
function quotedSourceEnd(quoted: string, rebuiltLength: number): number {
    let end = -1;
    let lineStart = 0;

    while (lineStart <= quoted.length) {
        const lineEnd = lineEndAt(quoted, lineStart);
        const last = lineEnd >= quoted.length;
        const quotedLine = BLOCKQUOTE_START.test(quoted.slice(lineStart, lineEnd));
        const nextLazy = !last && !BLOCKQUOTE_START.test(quoted.slice(lineEnd + 1, lineEndAt(quoted, lineEnd + 1)));
        const candidate = last || (quotedLine && nextLazy);

        if (candidate && lineEnd <= rebuiltLength) {
            end = lineEnd;
        }

        if (last) {
            break;
        }

        lineStart = lineEnd + 1;
    }

    return end === -1 ? rebuiltLength : end;
}

/**
 * Runs `marked`'s blockquote tokenizer and replaces the token's `raw` with
 * the slice of the source the quote used. `marked` rebuilds a blockquote's
 * `raw` when a list inside it takes a lazy line, and the rebuilt text can be
 * longer than that source; the lexer advances by `raw.length`, so the block
 * after the quote would lose its first characters. Only `raw` changes: the
 * token's `text` and child tokens stay as `marked` built them.
 *
 * @param src - The remaining source at the current block position.
 * @returns The blockquote token, or `undefined` when no blockquote starts here.
 */
function blockquoteWithSourceRaw(this: Tokenizer, src: string): Tokens.Blockquote | undefined {
    const token = Tokenizer.prototype.blockquote.call(this, src);

    if (token === undefined) {
        return undefined;
    }

    // `marked`'s tokenizer returned a token, so its own rule matched this `src`.
    const quoted = this.rules.block.blockquote.exec(src)![0].replace(TRAILING_NEWLINES, "");

    token.raw = src.slice(0, quotedSourceEnd(quoted, token.raw.length));

    return token;
}

/** The line end `marked`'s HTML rule wants after a tag name that ends its line. */
const LINE_END = "\n";

/**
 * Runs `marked`'s HTML-block tokenizer, reading the end of the input as the
 * end of a line. `marked` 18's rule takes a block tag name (`<div`, `</div`,
 * `<pre`) as an HTML block start only when a space, a `>` or a line-end
 * character follows it, so the same line is an HTML block before a line end
 * and a paragraph as the last line of an input: a document, a `:::` column,
 * a list item's content, or a run of a blockquote's `>` lines (`marked` lexes
 * a quote's `>` lines and the lazy lines after them as inputs of their own).
 * CommonMark ends a line at the end of the input too. When `marked` declines
 * a one-line input, it is asked again with a line end after it; a token it
 * then returns is that line's, so its `raw` and `text` are set back to the
 * input. An input holding a line end is not asked again: the rule already saw
 * what follows the tag name there.
 *
 * @param src - The remaining source at the current block position.
 * @returns The HTML token, or `undefined` when no HTML block starts here.
 */
function htmlWithInputEndAsLineEnd(this: Tokenizer, src: string): Tokens.HTML | undefined {
    const token = Tokenizer.prototype.html.call(this, src);

    if (token !== undefined) {
        return token;
    }

    const oneLine = !src.includes(LINE_END);

    if (!oneLine) {
        return undefined;
    }

    const ended = Tokenizer.prototype.html.call(this, src + LINE_END);

    if (ended === undefined) {
        return undefined;
    }

    ended.raw = src;
    ended.text = src;

    return ended;
}

/** A pattern that matches nothing: `marked`'s unescape rules, switched off. */
const MATCHES_NOTHING = /(?!)/gu;

/**
 * The view {@link keepingEscapes} made for each rules object. `marked` gives
 * the tokenizer a new rules object for every lexer it makes, so this holds
 * one view per lex, made on that lex's first link, definition or code fence.
 */
const VIEWS_KEEPING_ESCAPES = new WeakMap<Tokenizer["rules"], Tokenizer>();

/**
 * A view of the tokenizer whose two unescape rules match nothing, so what
 * `marked` builds keeps its backslash escapes as written: `anyPunctuation`
 * for a destination, title and info string, and `outputLinkReplace` for a
 * link's or image's text. `marked` takes the backslash off each `\[` and
 * `\]` of that text before lexing it, so an escaped pair read as a live one
 * (`[\[x\]](/u)` held a reference `[x]` wherever `x` was defined, and the
 * link was lost to it); kept, each escape is read by the inline lexer as
 * CommonMark reads it, as a literal bracket. The view shares everything
 * else with the tokenizer, through its prototype: its lexer, options and
 * state.
 *
 * @param tokenizer - The tokenizer `marked` called.
 * @returns The view.
 */
function keepingEscapes(tokenizer: Tokenizer): Tokenizer {
    let view = VIEWS_KEEPING_ESCAPES.get(tokenizer.rules);

    if (view === undefined) {
        const rules = {
            ...tokenizer.rules,
            inline: { ...tokenizer.rules.inline, anyPunctuation: MATCHES_NOTHING },
            other:  { ...tokenizer.rules.other, outputLinkReplace: MATCHES_NOTHING },
        };

        view = Object.create(tokenizer, { rules: { value: rules } }) as Tokenizer;
        VIEWS_KEEPING_ESCAPES.set(tokenizer.rules, view);
    }

    return view;
}

/**
 * Reads the backslash escapes and character references of a destination,
 * title or info string, skipping the work for the common one that holds
 * neither a `\` nor an `&`.
 *
 * @param text - The text, its escapes still in it.
 * @returns It as read.
 */
function readEscapesAndReferences(text: string): string {
    return /[\\&]/.test(text) ? decodeEscapesAndCharacterReferences(text) : text;
}

/**
 * Runs `marked`'s fenced-code tokenizer and reads the character references and
 * backslash escapes of the fence's info string, as CommonMark reads them.
 * {@link fencesWithColumnIndent} wraps it, and the character-reference
 * tokenizers leave the `fences` slot to that wrapper.
 *
 * @param src - The remaining source at the current block position.
 * @returns The code token, or `undefined` when no fenced code starts here.
 */
function fencesReadingReferences(this: Tokenizer, src: string): Tokens.Code | undefined {
    const token = Tokenizer.prototype.fences.call(keepingEscapes(this), src);

    if (token?.lang) {
        token.lang = readEscapesAndReferences(token.lang);
    }

    return token;
}

/**
 * The two tokenizers that read character references (`&copy;`, `&#169;`)
 * where CommonMark reads them: in text and in link reference definitions'
 * destinations and titles, so a reference link gets its definition's read
 * values. A link's own destination and title are read the same way by
 * {@link linkReadingReferences}, which {@link DIALECT_IMAGE_TOKENIZERS} wraps
 * in the `link` slot, and code fence info strings by
 * {@link fencesReadingReferences}, which {@link fencesWithColumnIndent} wraps
 * in the `fences` slot. `marked` reads only numeric references, and only in
 * text; it keeps a named one as written. Each runs `marked`'s own method;
 * `def` runs it on {@link keepingEscapes}'s view and then reads the escapes
 * and references together ({@link decodeEscapesAndCharacterReferences}), so an
 * escaped `&` (`\&copy;`) stays text. Text inside raw HTML (`marked`'s
 * `escaped`), code spans, code blocks and autolinks is not read: those keep
 * what is written.
 */
const CHARACTER_REFERENCE_TOKENIZERS: TokenizerObject = {
    inlineText(src) {
        const token = Tokenizer.prototype.inlineText.call(this, src);

        if (token === undefined) {
            return token;
        }

        const readsReferences = token.escaped !== true && token.raw.includes("&");

        if (readsReferences) {
            token.text = decodeCharacterReferences(token.raw);
        }

        return token;
    },
    def(src) {
        const token = Tokenizer.prototype.def.call(keepingEscapes(this), src);

        if (token !== undefined) {
            token.href = readEscapesAndReferences(token.href);

            if (token.title) {
                token.title = readEscapesAndReferences(token.title);
            }
        }

        return token;
    },
};

/**
 * Runs `marked`'s link tokenizer and reads the character references and
 * backslash escapes of the destination and title, as CommonMark reads them.
 * {@link DIALECT_IMAGE_TOKENIZERS} wraps it in the `link` slot.
 *
 * @param src - The remaining source at the current inline position.
 * @returns The link or image token, or `undefined` when no inline link starts here.
 */
function linkReadingReferences(this: Tokenizer, src: string): Tokens.Link | Tokens.Image | undefined {
    const token = Tokenizer.prototype.link.call(keepingEscapes(this), src);

    if (token !== undefined) {
        token.href = readEscapesAndReferences(token.href);

        if (token.title) {
            token.title = readEscapesAndReferences(token.title);
        }
    }

    return token;
}

/** An image's attribute group, read directly after the image: its text between the braces. */
const IMAGE_ATTRIBUTE_GROUP = /^\{([^{}]*)\}/;

/**
 * The plain text of an image's description, as CommonMark specifies for the
 * `alt` attribute: emphasis, links and spans give their text, a nested image
 * gives its own alt text, a code span its code, a hard line break a line feed.
 *
 * @param tokens - The tokens of the image's description.
 * @returns The plain text.
 */
function imageAltText(tokens: readonly Token[]): string {
    return tokens.map((token) => {
        const generic = token as Tokens.Generic;

        if (token.type === "mdimage") {
            return generic.alt as string;
        }

        if (token.type === "br") {
            return "\n";
        }

        const children = generic.tokens as Token[] | undefined;

        if (children !== undefined && children.length > 0) {
            return imageAltText(children);
        }

        return (generic.text as string | undefined) ?? token.raw;
    }).join("");
}

/**
 * Turns `marked`'s image token into the dialect's `mdimage` token, with the
 * `{…}` attribute group that follows the image, if there is one.
 *
 * @param image - `marked`'s image token.
 * @param src - The remaining source the image was read from.
 * @returns The `mdimage` token.
 */
function dialectImage(image: Tokens.Image, src: string): MdImageToken {
    const group = IMAGE_ATTRIBUTE_GROUP.exec(src.slice(image.raw.length));

    return {
        type:          "mdimage",
        raw:           image.raw + (group?.[0] ?? ""),
        imageRaw:      image.raw,
        alt:           imageAltText(image.tokens),
        src:           image.href,
        title:         image.title ?? null,
        attributes:    parseAttributes(group?.[1] ?? ""),
        attributeText: group?.[1] ?? "",
    };
}

/**
 * Reads every image form through `marked`'s own `link` and `reflink`
 * tokenizers: each runs `marked`'s method (the `link` slot through
 * {@link linkReadingReferences}, the `reflink` slot on
 * {@link keepingEscapes}'s view, so the text of either keeps its bracket
 * escapes) and, when the token it returns is an image,
 * turns it into the dialect's `mdimage` token with any `{…}` group that
 * follows. A link, or a reference that names no definition, is returned as
 * `marked` read it.
 */
const DIALECT_IMAGE_TOKENIZERS: TokenizerObject = {
    link(src) {
        const token = linkReadingReferences.call(this, src);

        return token?.type === "image" ? dialectImage(token, src) as unknown as Tokens.Image : token;
    },
    reflink(src, links) {
        const token = Tokenizer.prototype.reflink.call(keepingEscapes(this), src, links);

        return token?.type === "image" ? dialectImage(token, src) as unknown as Tokens.Image : token;
    },
};

/**
 * Applies `change` to every line of `text`.
 *
 * @param text - Lines joined by line feeds.
 * @param change - What to do with one line.
 * @returns The changed lines, joined by line feeds.
 */
function mapLines(text: string, change: (line: string) => string): string {
    return text.split("\n").map(change).join("\n");
}

/**
 * The first `count` lines of `text`, without the line end after the last.
 *
 * @param text - Lines joined by line feeds.
 * @param count - How many lines to take.
 * @returns Those lines, joined by line feeds.
 */
function leadingLines(text: string, count: number): string {
    return text.split("\n").slice(0, count).join("\n");
}

/**
 * Counts the lines a token's `raw` spans. A line end that closes the last
 * line starts no new one.
 *
 * @param raw - A token's `raw`.
 * @returns The number of lines.
 */
function lineCount(raw: string): number {
    const pieces = raw.split("\n").length;
    const closed = raw.endsWith("\n");

    return closed ? pieces - 1 : pieces;
}

/**
 * Sets a list token's `raw`, and each item's, back to the source lines they
 * span. `marked` builds both from whole lines, and the tab-free form of the
 * source has the same lines, so counting lines finds the source.
 *
 * @param list - The list token, lexed from the tab-free form of `src`.
 * @param src - The source the list was read from.
 */
function restoreListSource(list: Tokens.List, src: string): void {
    const lines = src.split("\n");
    let line = 0;

    for (const item of list.items) {
        const count = lineCount(item.raw);
        const closed = item.raw.endsWith("\n");
        const source = lines.slice(line, line + count).join("\n");

        item.raw = closed ? source + "\n" : source.trimEnd();
        line += count;
    }

    list.raw = leadingLines(src, lineCount(list.raw)).trimEnd();
}

/**
 * Runs the dialect's list tokenizer on a form of the source in which a tab
 * counts as CommonMark counts it. `marked` writes each tab that starts a
 * continuation line of an item as four spaces, wherever the tab starts, and
 * so reads `- a` / (blank) / two spaces, a tab, `b` as code where CommonMark
 * reads a paragraph. Here each tab of a line's container prefix is written as
 * the spaces that reach its tab stop; every other tab is left to `marked`,
 * which keeps it, and a code line's text is read again from the source at
 * the column the item's content starts at, which keeps a tab the item leaves
 * whole. The `raw` of the list, its items and the containers and raw
 * blocks inside them are set back to the source ({@link restoreTokenSources}),
 * which the lexer and the editor's import measure with.
 *
 * @param src - The remaining source at the current block position.
 * @returns The list token, or `undefined` when no list starts here.
 */
function listWithTabStops(this: Tokenizer, src: string): Tokens.List | undefined {
    const hasTab = src.includes("\t");

    if (!hasTab) {
        return listWithOwnTaskMarker.call(this, src);
    }

    const expansion = expandPrefixTabs(src);
    const list = listWithOwnTaskMarker.call(this, expansion.text);

    if (list === undefined) {
        return undefined;
    }

    restoreTokenSources([list], expansion, src);
    restoreListSource(list, src);

    return list;
}

/**
 * Runs the dialect's blockquote tokenizer on a form of the source in which a
 * tab counts as CommonMark counts it. `marked` takes one space or tab after
 * `>` and reads the rest from column 0, so `>`, a space, a tab, `foo` is code
 * where CommonMark reads a paragraph. Each tab of a line's container prefix
 * is written as the spaces that reach its tab stop; the token's `raw` is set
 * back to the source lines it spans.
 *
 * @param src - The remaining source at the current block position.
 * @returns The blockquote token, or `undefined` when no blockquote starts here.
 */
function blockquoteWithTabStops(this: Tokenizer, src: string): Tokens.Blockquote | undefined {
    const hasTab = src.includes("\t");

    if (!hasTab) {
        return blockquoteWithSourceRaw.call(this, src);
    }

    const expansion = expandPrefixTabs(src);
    const token = blockquoteWithSourceRaw.call(this, expansion.text);

    if (token !== undefined) {
        restoreTokenSources([token], expansion, src);
        token.raw = leadingLines(src, lineCount(token.raw));
    }

    return token;
}

/** The indentation of an indented backtick fence: one to three spaces. `marked` takes it off the content of backtick fences only. */
const INDENTED_BACKTICK_FENCE = /^ {1,3}(?=`{3})/;

/**
 * Writes the tabs in the first `columns` columns of a line's indentation as
 * the spaces that reach their tab stops.
 *
 * @param line - One line, without its line end.
 * @param columns - How many columns of indentation to make tab-free.
 * @returns The line, its indentation tab-free up to that column.
 */
function withIndentTabsAsSpaces(line: string, columns: number): string {
    let indentation = "";
    let index = 0;

    while (index < line.length && indentation.length < columns && (line[index] === " " || line[index] === "\t")) {
        indentation += line[index] === "\t" ? " ".repeat(tabWidthAt(indentation.length)) : " ";
        index += 1;
    }

    return indentation + line.slice(index);
}

/**
 * Runs `marked`'s fenced-code tokenizer and, for a backtick fence indented by
 * one to three spaces, takes that many columns off each content line.
 * `marked` takes off characters: under a fence indented by one space it drops
 * a line's leading tab whole, where CommonMark leaves three spaces. The
 * token's own text is lexed again with those tabs written as spaces; only
 * `text` changes.
 *
 * @param src - The remaining source at the current block position.
 * @returns The code token, or `undefined` when no fenced code starts here.
 */
function fencesWithColumnIndent(this: Tokenizer, src: string): Tokens.Code | undefined {
    const token = fencesReadingReferences.call(this, src);

    if (token === undefined) {
        return undefined;
    }

    const indent = INDENTED_BACKTICK_FENCE.exec(token.raw)?.[0].length ?? 0;
    const hasTab = token.raw.includes("\t");

    if (indent === 0 || !hasTab) {
        return token;
    }

    const spaced = fencesReadingReferences.call(this, mapLines(token.raw, (line) => withIndentTabsAsSpaces(line, indent)));

    if (spaced !== undefined) {
        token.text = spaced.text;
    }

    return token;
}

/**
 * The five block tokenizers the dialect owns, installed in `marked`'s
 * `blockquote`, `list`, `table`, `html` and `fences` slots: the unbounded test
 * twin installs them as they are, and {@link BOUNDED_BLOCK_TOKENIZERS} calls
 * the same five, four of them behind its guards, so the twin differs from the
 * bounded instance in nothing else.
 */
const DIALECT_BLOCK_TOKENIZERS: TokenizerObject = {
    blockquote: blockquoteWithTabStops,
    list:       listWithTabStops,
    table:      dialectTable,
    html:       htmlWithInputEndAsLineEnd,
    fences:     fencesWithColumnIndent,
};

/**
 * The seven block slots the bounded instance overrides. Five run `marked` rules
 * whose anchored regexes JavaScriptCore — the engine WebKitGTK runs — scans
 * from every start position of whatever it is handed, so each failed match
 * costs time in proportion to the rest of the document and lexing a long
 * document is quadratic (`blockquote`, `list` and `html` reach theirs through
 * the dialect's wrappers); the sixth, `table`, is the dialect's own tokenizer,
 * which has no such regex; the seventh, `fences`, is described below. Each
 * override returns `undefined`, declining the position outright, when a
 * condition its rule's own regex requires does not hold; otherwise it calls
 * `marked`'s original method on {@link blockWindow}'s cut of the source.
 * `blockquote` and `list` call the dialect's tab-stop wrappers on the window
 * instead of the originals. `table` runs the dialect's table tokenizer behind
 * the guard with no window: that tokenizer reads only up to its first blank
 * line, so it never scans the rest of the document. `html` takes the guard
 * only and calls the dialect's input-end wrapper on the whole source, because
 * its `<script>`, comment, processing-instruction, declaration and CDATA forms
 * all run to a closing marker no restart line bounds. `fences` carries no
 * guard and no window: it calls the dialect's column-indent wrapper on the
 * same source it would have been given, and that wrapper reads only the token
 * it returned.
 *
 * The originals are reached through `Tokenizer.prototype`: `marked` installs
 * these overrides as own properties on the instance's tokenizer object, so the
 * prototype still holds the unoverridden methods. Installed on the bounded
 * instance only, never on `marked`'s shared rule objects, for the same reason
 * the instance itself is scoped.
 */
const BOUNDED_BLOCK_TOKENIZERS: TokenizerObject = {
    hr(src) {
        return HR_START.test(src) ? Tokenizer.prototype.hr.call(this, blockWindow(src)) : undefined;
    },
    blockquote(src) {
        return BLOCKQUOTE_START.test(src) ? blockquoteWithTabStops.call(this, blockWindow(src)) : undefined;
    },
    list(src) {
        return LIST_START.test(src) ? listWithTabStops.call(this, blockWindow(src)) : undefined;
    },
    table(src) {
        return secondLineHasDash(src) ? dialectTable.call(this, src) : undefined;
    },
    lheading(src) {
        return hasSetextUnderline(src) ? Tokenizer.prototype.lheading.call(this, blockWindow(src)) : undefined;
    },
    html(src) {
        return HTML_START.test(src) ? htmlWithInputEndAsLineEnd.call(this, src) : undefined;
    },
    fences: fencesWithColumnIndent,
};

/**
 * The dialect's extensions, shared by the bounded instance and its unbounded
 * test twin so the two cannot drift apart: the twin is only a witness for the
 * block-rule guards and windows if everything else about it is identical.
 */
const MARKDOWN_EXTENSIONS: TokenizerExtension[] = [
    UNDERLINE_EXTENSION, STYLED_SPAN_EXTENSION, BLOCK_EXTENSION,
];

/**
 * The scoped `marked` instance the viewer's dialect extensions register
 * against — never the package's shared default instance, whose module-level
 * `use()` would change parsing for any other consumer of `marked` in the same
 * bundle.
 */
const _marked = new Marked({ extensions: MARKDOWN_EXTENSIONS, tokenizer: { ...BOUNDED_BLOCK_TOKENIZERS, ...CHARACTER_REFERENCE_TOKENIZERS, ...DIALECT_IMAGE_TOKENIZERS } });

/**
 * The unbounded twin's instance, created on first use so production code — which
 * never lexes through it — pays nothing for it.
 */
let _unboundedMarked: Marked | null = null;

/**
 * Lexes Markdown source through the same dialect with no block-rule guards or
 * windows, so a test can assert that bounding them changed no token. It shares
 * the dialect's own `table`, `blockquote`, `list` and `html` tokenizers and
 * its character-reference tokenizers, so the guards and windows are the only
 * difference.
 *
 * @internal Test-only reference lexer, not part of the public API surface.
 *
 * @param source - The Markdown source to lex.
 * @returns The top-level token list.
 */
export function lexMarkdownUnbounded(source: string): Token[] {
    _unboundedMarked ??= new Marked({ extensions: MARKDOWN_EXTENSIONS, tokenizer: { ...DIALECT_BLOCK_TOKENIZERS, ...CHARACTER_REFERENCE_TOKENIZERS, ...DIALECT_IMAGE_TOKENIZERS } });

    return _unboundedMarked.lexer(source);
}

/**
 * Lexes Markdown source through this module's scoped, extended `marked`
 * instance. Every lexing site in the library — the viewer's `render` /
 * `setMarkdown` / `extractMarkdownHeadings`, and the editor test's parity
 * guard — must go through this function rather than `marked`'s own exported
 * `lexer`, or it certifies documents against an unextended grammar the viewer
 * cannot actually render.
 *
 * Six block rules run behind a guard and, where they need one, a window
 * ({@link BOUNDED_BLOCK_TOKENIZERS}), which is what keeps one lex linear in
 * the document's length; the tokens are exactly the ones
 * {@link lexMarkdownUnbounded} produces without them.
 *
 * @param source - The Markdown source to lex.
 * @returns The top-level token list.
 */
export function lexMarkdown(source: string): Token[] {
    return _marked.lexer(source);
}

/**
 * The key `marked` files a link reference definition under, and looks a
 * reference's label up by: the label with its whitespace runs collapsed to
 * one space, trimmed, and case-folded. The fold goes through upper case, as
 * `marked`'s own does, so that `ẞ` and `SS` share a key, which
 * `toLowerCase()` alone does not give. {@link lexMarkdownLinkDefinitions}
 * returns a map keyed this way.
 *
 * @param label - A reference's label or a definition's, as written between its brackets.
 * @returns The key.
 */
export function linkLabelKey(label: string): string {
    return label.replace(/\s+/g, " ").trim().toLowerCase().toUpperCase().toLowerCase();
}

/**
 * Lexes Markdown source through the same scoped `marked` instance as
 * {@link lexMarkdown} and returns only its link reference definitions, so a
 * caller resolves a reference label exactly as the viewer does: the first
 * definition of a label wins, and a definition inside a blockquote, list item
 * or `:::` fence counts, while a definition-shaped line inside code does not.
 *
 * @param source - The Markdown source to lex.
 * @returns `marked`'s map from a label's key ({@link linkLabelKey}) to `{ href, title }`.
 */
export function lexMarkdownLinkDefinitions(source: string): Links {
    return _marked.lexer(source).links;
}

/**
 * Lexes Markdown source through the same scoped `marked` instance as
 * {@link lexMarkdown}, as if `definitions` had been defined before it: a
 * reference label resolves through them first, so the tokens show how the
 * source reads in a document holding those definitions. Comparing two such
 * lexes tells whether a change of definitions changes what the source says.
 *
 * @param source - The Markdown source to lex.
 * @param definitions - The link reference definitions in force, as
 *   {@link lexMarkdownLinkDefinitions} returns them.
 * @returns The top-level token list.
 */
export function lexMarkdownWithDefinitions(source: string, definitions: Links): Token[] {
    const lexer = new _marked.Lexer(_marked.defaults);

    Object.assign(lexer.tokens.links, definitions);

    return lexer.lex(source);
}

/**
 * Lexes one run of inline Markdown — text with no block structure, such as a
 * reference link's label — through the same scoped `marked` instance as
 * {@link lexMarkdown}, so emphasis and the dialect's inline extensions read
 * as they do in the viewer.
 *
 * @param source - The inline Markdown to lex.
 * @param definitions - The link reference definitions the source's references resolve against, filed the way {@link lexMarkdownWithDefinitions} files them; none by default.
 * @returns The inline token list.
 */
export function lexMarkdownInline(source: string, definitions?: Links): Token[] {
    const lexer = new _marked.Lexer(_marked.defaults);

    if (definitions !== undefined) {
        Object.assign(lexer.tokens.links, definitions);
    }

    return lexer.inlineTokens(source);
}
