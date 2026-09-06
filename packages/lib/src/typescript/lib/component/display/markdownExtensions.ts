// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Marked } from "marked";
import type { Token, TokenizerExtension } from "marked";
import { parseAttributes, splitColumnSections } from "~/component/display/markdownAttributes.js";
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
        const lines = src.split("\n");
        const firstLine = lines[0]!.trim();

        if (!firstLine.startsWith(":::")) {
            return undefined;
        }

        const openingRemainder = firstLine.slice(3).trim();

        // A bare ":::" with nothing to open is a stray closer, not an opener.
        if (openingRemainder === "") {
            return undefined;
        }

        let depth = 1;
        let closingLineIndex = -1;

        for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
            const trimmed = lines[lineIndex]!.trim();

            if (trimmed === ":::") {
                depth -= 1;

                if (depth === 0) {
                    closingLineIndex = lineIndex;

                    break;
                }
            } else if (trimmed.startsWith(":::") && trimmed.slice(3).trim() !== "") {
                depth += 1;
            }
        }

        // No matching close anywhere in the remaining source: decline
        // entirely, so the lines fall through to ordinary paragraphs.
        if (closingLineIndex === -1) {
            return undefined;
        }

        const raw = lines.slice(0, closingLineIndex + 1).join("\n");
        const inner = lines.slice(1, closingLineIndex).join("\n");

        return {
            type:       "mdblock",
            raw,
            attributes: parseAttributes(extractFenceAttributeText(openingRemainder)),
            columns:    splitColumnSections(inner).map((section) => this.lexer.blockTokens(section)),
        } satisfies MdBlockToken;
    },
};

/**
 * The scoped `marked` instance the viewer's dialect extensions register
 * against — never the package's shared default instance, whose module-level
 * `use()` would change parsing for any other consumer of `marked` in the same
 * bundle.
 */
const _marked = new Marked({
    extensions: [
        UNDERLINE_EXTENSION, STYLED_SPAN_EXTENSION, TABLE_EXTENSION, BLOCK_EXTENSION, IMAGE_EXTENSION,
    ],
});

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
