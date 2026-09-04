// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

// The syntax palette has no dedicated project theme tokens (the framework
// defines chrome/surface/accent tokens, not a per-token-kind syntax scheme),
// so it is a fixed, IDE-conventional colour set chosen for light/dark
// legibility rather than derived from CSS variables — mirroring how
// `Markdown`'s code-block wash is a neutral constant rather than a token.
const SYNTAX_KEYWORD  = "#2563eb"; // matches the framework's single accent hue
const SYNTAX_STRING   = "#16a34a"; // green — conventional "string" colour
const SYNTAX_COMMENT  = "#6b7280"; // muted grey — de-emphasises comments
const SYNTAX_LITERAL  = "#d97706"; // amber — numbers/booleans/null
const SYNTAX_FUNCTION = "#7c3aed"; // violet — function/variable definitions
const SYNTAX_TYPE     = "#0891b2"; // teal — type names
const SYNTAX_PROPERTY = "#be185d"; // pink — object/attribute property names

/**
 * Builds the editor's theme extension: the chrome (background, gutters,
 * cursor, selection) via `EditorView.theme`, plus syntax-highlighting colours
 * via a `HighlightStyle`.
 *
 * The chrome reads the project's CSS custom-property tokens directly
 * (`--ts-ui-input-bg`, `--ts-ui-text-color`, `--ts-ui-font-mono`,
 * `--ts-ui-border-color`, `--ts-ui-indicator-focus`,
 * `--ts-ui-indicator-selection`), each with a light/dark-safe fallback, so a
 * `ThemeManager.setTheme` toggle recolours the editor with no rebuild — only
 * the underlying CSS variables change.
 *
 * @param dark - Whether the dark theme flag (`--ts-ui-color-scheme: dark`) is
 *   currently active, forwarded to `EditorView.theme`'s `dark` option so
 *   CodeMirror's own dark-mode heuristics (default scrollbar styling, base
 *   theme selection) agree with the project's active theme.
 * @returns The combined chrome + syntax-highlighting extension.
 */
export function codeEditorTheme(dark: boolean): Extension {
    const chrome = EditorView.theme({
        "&": {
            height:          "100%",
            color:           "var(--ts-ui-text-color, #1a1a1a)",
            backgroundColor: "var(--ts-ui-input-bg, #ffffff)",
        },
        ".cm-content": {
            fontFamily: "var(--ts-ui-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
            caretColor: "var(--ts-ui-indicator-focus, #2563eb)",
            cursor:     "text",
        },
        ".cm-gutters": {
            color:           "var(--ts-ui-text-color, #1a1a1a)",
            backgroundColor: "var(--ts-ui-input-bg, #ffffff)",
            borderRight:     "1px solid var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
        },
        "&.cm-focused .cm-cursor": {
            borderLeftColor: "var(--ts-ui-indicator-focus, #2563eb)",
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: "var(--ts-ui-indicator-selection, rgba(37, 99, 235, 0.25))",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
            backgroundColor: "rgba(127, 127, 127, 0.08)",
        },
        ".cm-foldGutter .cm-gutterElement": {
            color:  "var(--ts-ui-text-color, #1a1a1a)",
            opacity: "0.6",
            cursor: "pointer",
        },
        ".cm-foldPlaceholder": {
            backgroundColor: "var(--ts-ui-button-bg, #f3f4f6)",
            border:          "1px solid var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
            borderRadius:    "var(--ts-ui-border-radius, 4px)",
        },
        ".cm-placeholder": {
            color: "var(--ts-ui-autocomplete-item-disabled-color, #aaaaaa)",
        },
        ".cm-specialChar, .cm-highlightSpace, .cm-highlightTab": {
            color: "var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
        },
        ".cm-trailingSpace": {
            // Same color-mix recipe as .cm-searchMatch below.
            backgroundColor: "color-mix(in srgb, var(--ts-ui-validation-error-border, #dc2626) 15%, transparent)",
        },
        ".cm-panels": {
            backgroundColor: "var(--ts-ui-toolbar-bg, #f5f5f5)",
            color:           "var(--ts-ui-text-color, #1a1a1a)",
        },
        ".cm-panels-top": {
            borderBottom: "1px solid var(--ts-ui-toolbar-border, #dcdcdc)",
        },
        ".cm-panels-bottom": {
            borderTop: "1px solid var(--ts-ui-toolbar-border, #dcdcdc)",
        },
        ".cm-textfield": {
            backgroundColor: "var(--ts-ui-input-bg, #ffffff)",
            color:           "var(--ts-ui-text-color, #1a1a1a)",
            border:          "var(--ts-ui-input-border, 1px solid #a0a0a0)",
            borderRadius:    "var(--ts-ui-border-radius, 4px)",
            fontFamily:      "var(--ts-ui-font-family, sans-serif)",
            fontSize:        "var(--ts-ui-font-size, 14px)",
        },
        ".cm-button": {
            backgroundColor: "var(--ts-ui-button-bg, #f3f4f6)",
            border:          "1px solid var(--ts-ui-button-border, #d6d9de)",
            borderRadius:    "var(--ts-ui-border-radius, 4px)",
            backgroundImage: "none",
        },
        ".cm-button:hover": {
            backgroundColor: "var(--ts-ui-button-hover-bg, #eaecef)",
        },
        ".cm-button:active": {
            backgroundColor: "var(--ts-ui-button-pressed-bg, #ced2d8)",
        },
        ".cm-searchMatch": {
            // Derived from the framework's single accent token (the same one
            // `.cm-completionMatchedText` below reads) rather than
            // `--ts-ui-indicator-selection`: that token's real, actively
            // consumed shape is a dashed *outline* shorthand (see
            // AbstractSelectableList.ts / Cell.ts), not a colour, so it is
            // invalid as a `background-color` source. Reduced-opacity variant
            // of the selected match's colour below, so a consumer's
            // `--ts-ui-indicator-focus` override reaches both — same
            // `color-mix` recipe as ScrollShadow.scrollShadowEdgeValue.
            backgroundColor: "color-mix(in srgb, var(--ts-ui-indicator-focus, #2563eb) 15%, transparent)",
        },
        ".cm-searchMatch.cm-searchMatch-selected": {
            backgroundColor: "color-mix(in srgb, var(--ts-ui-indicator-focus, #2563eb) 25%, transparent)",
        },
        ".cm-selectionMatch": {
            backgroundColor: "rgba(127, 127, 127, 0.2)",
        },
        ".cm-lintRange-error": {
            backgroundImage: "none",
            textDecoration:  "underline wavy var(--ts-ui-validation-error-border, #dc2626)",
        },
        ".cm-diagnostic-error": {
            borderLeft: "4px solid var(--ts-ui-validation-error-border, #dc2626)",
        },
        ".cm-diagnosticSource": {
            color: "var(--ts-ui-autocomplete-item-disabled-color, #aaaaaa)",
        },
        ".cm-tooltip-lint .cm-diagnostic": {
            backgroundColor: "var(--ts-ui-tooltip-bg, #fffff0)",
            color:           "var(--ts-ui-tooltip-color, #000000)",
        },
    }, { dark });

    const highlight = syntaxHighlighting(HighlightStyle.define([
        { tag: tags.keyword,                                                    color: SYNTAX_KEYWORD },
        { tag: [tags.string, tags.special(tags.string)],                        color: SYNTAX_STRING },
        { tag: tags.comment,                                                    color: SYNTAX_COMMENT, fontStyle: "italic" },
        { tag: [tags.number, tags.bool, tags.null],                             color: SYNTAX_LITERAL },
        { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], color: SYNTAX_FUNCTION },
        { tag: tags.typeName,                                                   color: SYNTAX_TYPE },
        { tag: [tags.propertyName, tags.attributeName],                        color: SYNTAX_PROPERTY },
        { tag: tags.tagName,                                                    color: SYNTAX_KEYWORD },
        // Markdown constructs (the `markdown` language, e.g. the MarkdownEditor
        // source surface). The parser tags these; without a style here they
        // would render as plain text. Headings/links reuse the accent hue; bold
        // and italic carry weight/slant rather than colour so prose stays
        // readable; the markup marks (`#`, `**`, `` ` ``, `>`, `-`) and quotes
        // are muted so the content reads over the syntax.
        { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3,
                tags.heading4, tags.heading5, tags.heading6],                   color: SYNTAX_KEYWORD, fontWeight: "bold" },
        { tag: tags.strong,                                                     fontWeight: "bold" },
        { tag: tags.emphasis,                                                   fontStyle: "italic" },
        { tag: tags.monospace,                                                  color: SYNTAX_STRING },
        { tag: [tags.link, tags.url],                                           color: SYNTAX_KEYWORD, textDecoration: "underline" },
        { tag: [tags.quote, tags.contentSeparator],                             color: SYNTAX_COMMENT },
        { tag: tags.processingInstruction,                                      color: SYNTAX_COMMENT },
    ]));

    return [chrome, highlight];
}
