// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { StyleRule } from "~/core/StyleTarget.js";
import type { EditorThemeClasses } from "lexical";

// Class names Lexical stamps onto the rendered nodes. Prefixed `ts-ui-mde-`
// (markdown editor) so they never collide with the read-only `Markdown`
// viewer's `ts-ui-md-` rules; the two components replicate rather than share
// their class rules — the shared contract is the theme-token names below, not
// the selectors.
const HEADING_CLASS     = "ts-ui-mde-heading";
const QUOTE_CLASS       = "ts-ui-mde-quote";
const CODE_BLOCK_CLASS  = "ts-ui-mde-code";
const INLINE_CODE_CLASS = "ts-ui-mde-inline-code";
const LIST_CLASS        = "ts-ui-mde-list";
const LINK_CLASS        = "ts-ui-mde-link";
const BOLD_CLASS        = "ts-ui-mde-bold";
const ITALIC_CLASS      = "ts-ui-mde-italic";
const TABLE_CLASS               = "ts-ui-mde-table";
const TABLE_CELL_CLASS          = "ts-ui-mde-table-cell";
const TABLE_CELL_HEADER_CLASS   = "ts-ui-mde-table-cell-header";
const TABLE_CELL_SELECTED_CLASS = "ts-ui-mde-table-cell-selected";

/** Guards the module-singleton class-rule registration in {@link ensureMarkdownEditorClassRules}. */
let _classRulesEnsured = false;

/**
 * Registers the shared class rules that style the WYSIWYG editing surface,
 * once per document.
 *
 * @remarks
 * The rules mirror the read-only `Markdown` viewer's constructs and reference
 * the **same** CSS custom-property tokens — `--ts-ui-font-mono` for code,
 * `--ts-ui-border-color` for the quote bar, `--ts-ui-indicator-focus` for links
 * — so the edited rich text looks identical to what the viewer renders (the
 * point of WYSIWYG). Because the rules resolve live CSS variables, a theme
 * toggle recolours the surface with no rebuild and the component needs no
 * theme-change subscription. Each em-relative padding/indent is genuine
 * structural spacing (a code wash, a list-marker gutter, a quote bar), scaling
 * with the surrounding font — not a cosmetic nudge.
 */
export function ensureMarkdownEditorClassRules(): void {
    if (_classRulesEnsured) {
        return;
    }

    _classRulesEnsured = true;

    new StyleRule({
        scope:  "class",
        name:   HEADING_CLASS,
        // Semibold so headings read as headings independent of any UA reset.
        styles: { fontWeight: "600" },
    });

    new StyleRule({
        scope:  "class",
        name:   QUOTE_CLASS,
        styles: {
            // 3px quote bar — the framework's thin-border weight — plus an
            // em-relative gutter indenting the quoted prose off the bar.
            borderLeft:  "3px solid var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
            paddingLeft: "1em",
            marginLeft:  "0",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   CODE_BLOCK_CLASS,
        styles: {
            fontFamily:   "var(--ts-ui-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
            // Translucent grey wash reads as "code" on light and dark alike.
            background:   "rgba(127, 127, 127, 0.16)",
            borderRadius: "var(--ts-ui-border-radius, 3px)",
            // Structural inset giving the fenced code frame room.
            padding:      "0.6em 0.8em",
            whiteSpace:   "pre-wrap",
            // Lexical renders a fenced block as <code>, which is inline by
            // default and so sits on a text baseline — it rides up into a
            // preceding block instead of stacking below it. The viewer's
            // fenced code is a <pre>, a block with the browser's 1em block
            // margin; both are restated here so the two surfaces stack alike.
            display:      "block",
            margin:       "1em 0",
            // Matches the viewer's own fenced-code reset (Markdown.ts's
            // PRE_CLASS): without it this block inherits the WYSIWYG
            // surface's prose line-height (WysiwygSurface's constructor),
            // rendering taller here than in the viewer.
            lineHeight:   "normal",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   INLINE_CODE_CLASS,
        styles: {
            fontFamily:   "var(--ts-ui-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
            background:   "rgba(127, 127, 127, 0.16)",
            borderRadius: "var(--ts-ui-border-radius, 3px)",
            // Snug padding so the wash hugs the inline-code glyphs.
            padding:      "0.1em 0.3em",
            // Matches the viewer's own inline-code reset (Markdown.ts's
            // CODE_CLASS), for the same reading-vs-code rationale.
            lineHeight:   "normal",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   LIST_CLASS,
        // Room for the list marker; structural, em-relative indentation.
        styles: { paddingLeft: "1.5em" },
    });

    new StyleRule({
        scope:  "class",
        name:   LINK_CLASS,
        // The framework's single accent hue (shared with focus/selection).
        styles: { color: "var(--ts-ui-indicator-focus, #2563eb)" },
    });

    new StyleRule({
        scope:  "class",
        name:   BOLD_CLASS,
        styles: { fontWeight: "700" },
    });

    new StyleRule({
        scope:  "class",
        name:   ITALIC_CLASS,
        styles: { fontStyle: "italic" },
    });

    new StyleRule({
        scope:  "class",
        name:   TABLE_CLASS,
        styles: { borderCollapse: "collapse" },
    });

    new StyleRule({
        scope:  "class",
        name:   TABLE_CELL_CLASS,
        styles: {
            border:  "1px solid var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
            // Structural cell padding, matching the read-only viewer's cells.
            padding: "0.3em 0.6em",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   TABLE_CELL_HEADER_CLASS,
        styles: {
            border:     "1px solid var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
            padding:    "0.3em 0.6em",
            fontWeight: "600",
        },
    });

    new StyleRule({
        scope: "selector",
        name:  `.${TABLE_CELL_CLASS} > p`,
        // Lexical wraps each cell's content in a paragraph, which would carry
        // the browser's default 1em block margin and make every editor cell
        // two line-heights taller than the same cell in the read-only viewer,
        // whose cells hold inline content directly. Only cell paragraphs are
        // reset: prose paragraphs keep their margin, which is what matches the
        // viewer outside a table.
        styles: { margin: "0" },
    });

    new StyleRule({
        scope:  "class",
        name:   TABLE_CELL_SELECTED_CLASS,
        // @lexical/table stamps this class onto cells caught in a drag-selected
        // range; reuses the data-grid Table component's own row-selected token
        // so a selected cell reads the same way here as it does there.
        styles: { backgroundColor: "var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15))" },
    });
}

/**
 * The Lexical class-name theme map linking each node type to its shared class
 * rule from {@link ensureMarkdownEditorClassRules}.
 *
 * @remarks
 * Every heading level maps to the one heading rule (the tag itself carries the
 * size); ordered and unordered lists share the indentation rule. Bold, italic,
 * and inline code are text-format entries, and links carry the accent colour.
 */
export const EDITOR_THEME: EditorThemeClasses = {
    heading: {
        h1: HEADING_CLASS,
        h2: HEADING_CLASS,
        h3: HEADING_CLASS,
        h4: HEADING_CLASS,
        h5: HEADING_CLASS,
        h6: HEADING_CLASS,
    },
    quote: QUOTE_CLASS,
    code:  CODE_BLOCK_CLASS,
    list:  {
        ul: LIST_CLASS,
        ol: LIST_CLASS,
    },
    text: {
        bold:   BOLD_CLASS,
        italic: ITALIC_CLASS,
        code:   INLINE_CODE_CLASS,
    },
    link:              LINK_CLASS,
    table:             TABLE_CLASS,
    tableCell:         TABLE_CELL_CLASS,
    tableCellHeader:   TABLE_CELL_HEADER_CLASS,
    tableCellSelected: TABLE_CELL_SELECTED_CLASS,
};
