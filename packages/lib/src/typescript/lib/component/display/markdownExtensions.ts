// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Marked, Tokenizer } from "marked";
import type { Token, TokenizerExtension, TokenizerObject } from "marked";
import { lineEndAt, parseAttributes, splitColumnSections } from "~/component/display/markdownAttributes.js";
import { TABLE_EXTENSION } from "~/component/display/markdownTableExtension.js";

/** The `mdblock` token the fence extension emits — one token list per column. */
export interface MdBlockToken {
    type:       "mdblock";
    raw:        string;
    attributes: Record<string, string>;
    columns:    Token[][];
}

/**
 * `![alt](src){width=… height=…}` — replaces `marked`'s built-in image
 * tokenizer entirely, so every image (sized or not) arrives as one `mdimage`
 * token the viewer's own scheme allow-list validates before rendering.
 */
const IMAGE_EXTENSION: TokenizerExtension = {
    name:  "mdimage",
    level: "inline",
    start(src) {
        return src.indexOf("![");
    },
    tokenizer(src) {
        const match = /^!\[([^[\]]*)\]\(([^()\s]+)\)(?:\{([^{}]*)\})?/.exec(src);

        if (match === null) {
            return undefined;
        }

        return {
            type:       "mdimage",
            raw:        match[0],
            alt:        match[1],
            src:        match[2],
            attributes: parseAttributes(match[3] ?? ""),
        };
    },
};

/**
 * `++text++` — an inline-format-style extension so nested emphasis
 * (`**++b++**`) works with no special-casing: the tokenizer recurses into its
 * inner text through `this.lexer.inlineTokens`, exactly as `marked`'s
 * built-in `strong`/`em` do.
 */
const UNDERLINE_EXTENSION: TokenizerExtension = {
    name:  "underline",
    level: "inline",
    start(src) {
        return src.indexOf("++");
    },
    tokenizer(src) {
        const match = /^\+\+([^+]+)\+\+/.exec(src);

        if (match === null) {
            return undefined;
        }

        return {
            type:   "underline",
            raw:    match[0],
            text:   match[1],
            tokens: this.lexer.inlineTokens(match[1]!),
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
    const match = /\{([^{}]*)\}/.exec(remainder);

    return match === null ? "" : match[1]!;
}

/**
 * `::: {align=… gap=…}` … `:::` — a block alignment / column-region fence. A
 * line whose trimmed form starts with `:::` and has a non-empty remainder
 * opens a block; a line whose trimmed form is exactly `:::` closes one. The
 * scan tracks depth so fences nest. The inner content is split into one
 * section per `|||` line (`splitColumnSections`, which itself tracks fence
 * depth and code-fence state so a separator inside a nested fence or a code
 * block is ordinary content), and each section is re-lexed on its own with
 * `this.lexer.blockTokens` into its own column's token list.
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

        let depth = 1;
        let closingStart = -1;
        let lineEnd = openingEnd;

        while (lineEnd < src.length) {
            const lineStart = lineEnd + 1;

            lineEnd = lineEndAt(src, lineStart);

            const trimmed = src.slice(lineStart, lineEnd).trim();

            if (trimmed === ":::") {
                depth -= 1;

                if (depth === 0) {
                    closingStart = lineStart;

                    break;
                }
            } else if (trimmed.startsWith(":::") && trimmed.slice(3).trim() !== "") {
                depth += 1;
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
            columns:    splitColumnSections(inner).map((section) => this.lexer.blockTokens(section)),
        } satisfies MdBlockToken;
    },
};

/**
 * An empty line, or a line of spaces only. None of the windowed constructs
 * continues past one: a blockquote's lazy continuation, a `table` body row and
 * an `lheading`'s content all stop there, and a list item continues only onto
 * the marker line {@link LIST_MARKER_LINE} allows. A tab-only line is
 * deliberately not blank here — `marked`'s `table` body runs through one.
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
 * list-item marker line. None of the five windowed block constructs can
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
 * Whether the second line holds a `-`. `marked`'s `table` rule requires its
 * delimiter row's segments to be `:?-+:?`, so a second line without one can
 * never start a table.
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

/**
 * The six block rules whose anchored regexes JavaScriptCore — the engine
 * WebKitGTK runs — scans from every start position of whatever it is handed,
 * so each failed match costs time in proportion to the rest of the document
 * and lexing a long document is quadratic. Each override returns `undefined`,
 * declining the position outright, when a condition its rule's own regex
 * requires does not hold; otherwise it calls `marked`'s original method on
 * {@link blockWindow}'s cut of the source. `html` takes the guard only and
 * returns `false` — `marked` then runs the original on the whole source —
 * because its `<script>`, comment, processing-instruction, declaration and
 * CDATA forms all run to a closing marker no restart line bounds.
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
        return BLOCKQUOTE_START.test(src) ? Tokenizer.prototype.blockquote.call(this, blockWindow(src)) : undefined;
    },
    list(src) {
        return LIST_START.test(src) ? Tokenizer.prototype.list.call(this, blockWindow(src)) : undefined;
    },
    table(src) {
        return secondLineHasDash(src) ? Tokenizer.prototype.table.call(this, blockWindow(src)) : undefined;
    },
    lheading(src) {
        return hasSetextUnderline(src) ? Tokenizer.prototype.lheading.call(this, blockWindow(src)) : undefined;
    },
    html(src) {
        return HTML_START.test(src) ? false : undefined;
    },
};

/**
 * The dialect's extensions, shared by the bounded instance and its unbounded
 * test twin so the two cannot drift apart: the twin is only a witness for the
 * block-rule guards and windows if everything else about it is identical.
 */
const MARKDOWN_EXTENSIONS: TokenizerExtension[] = [
    UNDERLINE_EXTENSION, STYLED_SPAN_EXTENSION, TABLE_EXTENSION, BLOCK_EXTENSION, IMAGE_EXTENSION,
];

/**
 * The scoped `marked` instance the viewer's dialect extensions register
 * against — never the package's shared default instance, whose module-level
 * `use()` would change parsing for any other consumer of `marked` in the same
 * bundle.
 */
const _marked = new Marked({ extensions: MARKDOWN_EXTENSIONS, tokenizer: BOUNDED_BLOCK_TOKENIZERS });

/**
 * The unbounded twin's instance, created on first use so production code — which
 * never lexes through it — pays nothing for it.
 */
let _unboundedMarked: Marked | null = null;

/**
 * Lexes Markdown source through the same dialect with no block-rule guards or
 * windows, so a test can assert that bounding them changed no token.
 *
 * @internal Test-only reference lexer, not part of the public API surface.
 *
 * @param source - The Markdown source to lex.
 * @returns The top-level token list.
 */
export function lexMarkdownUnbounded(source: string): Token[] {
    _unboundedMarked ??= new Marked({ extensions: MARKDOWN_EXTENSIONS });

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
 * Six of `marked`'s own block rules run behind a guard and a window
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
