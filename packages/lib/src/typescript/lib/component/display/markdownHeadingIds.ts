// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Token, Tokens } from "marked";
import { decodeEscapesAndCharacterReferences } from "~/component/display/markdownCharacterReferences.js";

/**
 * GitHub/VitePress-compatible slug: lowercase, non-alphanumerics collapsed to
 * single hyphens, ends trimmed. Does not dedupe — the caller folds in a `-N`
 * suffix via a per-render counter so every id on the page is unique.
 *
 * @param text - The heading's plain text.
 * @returns The slug, with no leading, trailing, or doubled hyphens.
 */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * The source a heading's slug is made from: the heading's text as written,
 * with its backslash escapes and character references read exactly where the
 * viewer reads them. Text the viewer reads (including the text between an
 * inline `<kbd>` and its end tag, which it keeps as written) comes from the
 * lexer's own text tokens; a code span and inline HTML stay as written; a
 * link's destination and title are read with their escapes and references.
 * Everything else keeps its markup, which a slug turns into hyphens, so only
 * the characters the viewer reads differently from the source change.
 *
 * @param tokens - The heading's inline tokens.
 * @returns The text to slugify.
 */
export function headingSlugSource(tokens: readonly Token[]): string {
    return tokens.map((token) => {
        if (token.type === "text" && (token as Tokens.Text).tokens === undefined) {
            return (token as Tokens.Text).text;
        }

        if (token.type === "escape") {
            return (token as Tokens.Escape).text;
        }

        const children = (token as Tokens.Generic).tokens as Token[] | undefined;
        const inner = children?.map((child) => child.raw).join("") ?? "";
        const emptyLink = token.type === "link" && inner === "";
        const at = children === undefined ? -1 : emptyLink ? token.raw.indexOf("](") : token.raw.indexOf(inner);

        if (children === undefined || at < 0) {
            return token.raw;
        }

        const tail = token.raw.slice(at + inner.length);

        return token.raw.slice(0, at) + headingSlugSource(children)
            + (token.type === "link" ? decodeEscapesAndCharacterReferences(tail) : tail);
    }).join("");
}

/**
 * The slug the viewer makes a heading's id from, before it is deduped: what
 * the viewer reads of the heading's text ({@link headingSlugSource}),
 * slugified. The viewer, the editor's save and its importer all make the id
 * through this one function, so a save cannot move an id unnoticed.
 *
 * @param tokens - The heading's inline tokens.
 * @returns The slug.
 */
export function headingSlug(tokens: readonly Token[]): string {
    return slugify(headingSlugSource(tokens));
}
