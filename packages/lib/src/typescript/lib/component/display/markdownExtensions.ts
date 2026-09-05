// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Marked } from "marked";
import type { Token, TokenizerExtension } from "marked";
import { parseAttributes } from "~/component/display/markdownAttributes.js";
import { TABLE_EXTENSION } from "~/component/display/markdownTableExtension.js";

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
 * The scoped `marked` instance the viewer's dialect extensions register
 * against — never the package's shared default instance, whose module-level
 * `use()` would change parsing for any other consumer of `marked` in the same
 * bundle.
 */
const _marked = new Marked({ extensions: [UNDERLINE_EXTENSION, STYLED_SPAN_EXTENSION, TABLE_EXTENSION] });

/**
 * Lexes Markdown source through this module's scoped, extended `marked`
 * instance. Every lexing site in the library — the viewer's `render` /
 * `setMarkdown` / `extractMarkdownHeadings`, and the editor test's parity
 * guard — must go through this function rather than `marked`'s own exported
 * `lexer`, or it certifies documents against an unextended grammar the viewer
 * cannot actually render.
 *
 * @param source - The Markdown source to lex.
 * @returns The top-level token list.
 */
export function lexMarkdown(source: string): Token[] {
    return _marked.lexer(source);
}
