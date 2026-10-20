// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The highlighting tags only the built-in "markdown" language emits. Each
// names one kind of non-text Markdown, which the editor theme (theme.ts)
// colours. Tags defined here are new tags, not lezer's standard ones, so no
// other grammar can emit them and a rule for them changes no other language.
// `@lezer/highlight` is loaded by theme.ts, which CodeEditor imports, so this
// module adds nothing to the editor chunk.

import { Tag } from "@lezer/highlight";

/**
 * The kinds of non-text Markdown that source mode colours, one tag each.
 *
 * @internal Shared by `languages.ts`, `markdownSourceSyntax.ts` and `theme.ts`, not part of the public API surface.
 */
export const MARKDOWN_SOURCE_TAGS = {
    /** Marks inside a line: `*`, `**`, `~~`, `++`, a code span's backticks, a link's brackets and parentheses, an autolink's `<` `>`, a definition's `:`. */
    inlineMark:  Tag.define("markdownInlineMark"),
    /** Marks that make a block: `#` runs and setext underlines, `>`, list markers, task boxes, thematic breaks, code-fence lines. */
    blockMark:   Tag.define("markdownBlockMark"),
    /** Where a link points: a URL, a reference label, and both halves of a link reference definition. */
    destination: Tag.define("markdownDestination"),
    /** A backslash escape, a backslash hard break, and a character reference such as `&amp;`. */
    escape:      Tag.define("markdownEscape"),
    /** Inline HTML tags, and HTML blocks, HTML comments and processing instructions whole. */
    html:        Tag.define("markdownHtml"),
    /** The dialect's own syntax and tables: `{…}` groups, `:::` and `|||` lines, `<<` and `^^` cells, table pipes and delimiter rows. */
    dialect:     Tag.define("markdownDialect"),
    /** The text of a code span or a code block. */
    code:        Tag.define("markdownCode"),
} as const;
