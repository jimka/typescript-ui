// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { TagStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import { StyleRule, deferStyleSheetWrite } from "~/core/StyleTarget.js";
import { MARKDOWN_SOURCE_TAGS } from "~/component/editor/markdownSourceTags.js";

// The syntax palette has no dedicated project theme tokens (the framework
// defines chrome/surface/accent tokens, not a per-token-kind syntax scheme),
// so it is a fixed, IDE-conventional colour set chosen for light/dark
// legibility rather than derived from CSS variables — mirroring how
// `Markdown`'s code-block wash is a neutral constant rather than a token.
export const SYNTAX_KEYWORD  = "#2563eb"; // matches the framework's single accent hue
export const SYNTAX_STRING   = "#16a34a"; // green — conventional "string" colour
export const SYNTAX_COMMENT  = "#6b7280"; // muted grey — de-emphasises comments
export const SYNTAX_LITERAL  = "#d97706"; // amber — numbers/booleans/null
export const SYNTAX_FUNCTION = "#7c3aed"; // violet — function/variable definitions
export const SYNTAX_TYPE     = "#0891b2"; // teal — type names
export const SYNTAX_PROPERTY = "#be185d"; // pink — object/attribute property names

/**
 * The syntax-highlighting rules every `CodeEditor` language shares, in both
 * themes: each maps lezer tags to a look. A range takes every rule its tags
 * match, and a later rule wins where two set the same property. The
 * `processingInstruction` rule colours the `html` language's `<?…?>`.
 */
export const SHARED_SYNTAX_STYLES: readonly TagStyle[] = [
    { tag: tags.keyword,                                                    color: SYNTAX_KEYWORD },
    { tag: [tags.string, tags.special(tags.string)],                        color: SYNTAX_STRING },
    { tag: tags.comment,                                                    color: SYNTAX_COMMENT, fontStyle: "italic" },
    { tag: [tags.number, tags.bool, tags.null],                             color: SYNTAX_LITERAL },
    { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], color: SYNTAX_FUNCTION },
    { tag: tags.typeName,                                                   color: SYNTAX_TYPE },
    { tag: [tags.propertyName, tags.attributeName],                        color: SYNTAX_PROPERTY },
    { tag: tags.tagName,                                                    color: SYNTAX_KEYWORD },
    { tag: tags.processingInstruction,                                      color: SYNTAX_COMMENT },
];

/** One colour per kind of non-text Markdown, keyed as {@link MARKDOWN_SOURCE_TAGS} is. */
export type MarkdownSourceColours = Readonly<Record<keyof typeof MARKDOWN_SOURCE_TAGS, string>>;

// The colours of the `markdown` language's own tags, one set per scheme. The
// shared palette above has no colour that reaches 4.5 : 1 (WCAG AA for normal
// text) on both editor backgrounds, so source mode has its own. Each value was
// picked for that ratio on the editor background (`--ts-ui-input-bg`: white
// in ModernTheme and ClassicTheme, rgb(40, 40, 40) in DarkTheme) and on the
// active line's tint over it (`.cm-activeLine` below), and for a CIEDE2000
// difference of at least 18 from every other colour of its set and from the
// text colour. The six hues are spread round the colour wheel and keep clear
// of the viewer's link blue (`--ts-ui-indicator-focus`). Ratios are on the
// background, then on the active line.
export const MARKDOWN_SOURCE_LIGHT: MarkdownSourceColours = {
    inlineMark:  "#6e6e6e", // grey   5.10 / 4.67 — the most muted, so the text reads over its marks
    blockMark:   "#893ee0", // violet 5.48 / 5.02
    destination: "#1a7479", // teal   5.50 / 5.03
    escape:      "#a65217", // orange 5.47 / 5.00
    html:        "#c92055", // rose   5.50 / 5.03
    dialect:     "#7b6817", // gold   5.48 / 5.01
    code:        "#407616", // green  5.50 / 5.03
};

/** The dark scheme's set; see {@link MARKDOWN_SOURCE_LIGHT}. */
export const MARKDOWN_SOURCE_DARK: MarkdownSourceColours = {
    inlineMark:  "#989898", // grey   5.11 / 4.64
    blockMark:   "#ba96f9", // violet 6.19 / 5.63
    destination: "#2eb9c0", // teal   6.19 / 5.62
    escape:      "#f98b46", // orange 6.18 / 5.62
    html:        "#f98498", // rose   6.17 / 5.60
    dialect:     "#c3a629", // gold   6.18 / 5.62
    code:        "#6abc29", // green  6.20 / 5.64
};

/**
 * The syntax-highlighting rules of one scheme: the shared rules, then one
 * rule per kind of non-text Markdown. Only the `markdown` language emits the
 * tags of the Markdown rules, so they change no other language. Their order
 * matters where a fenced code block hands its block-mark tag to everything in
 * it: block mark after inline mark, so a fence's backticks are block marks,
 * and code after block mark, so the fence's code is code.
 *
 * @param dark - Whether the dark theme is active.
 * @returns The rules.
 */
export function syntaxStyles(dark: boolean): readonly TagStyle[] {
    const colours = dark ? MARKDOWN_SOURCE_DARK : MARKDOWN_SOURCE_LIGHT;

    return [
        ...SHARED_SYNTAX_STYLES,
        { tag: MARKDOWN_SOURCE_TAGS.inlineMark,  color: colours.inlineMark },
        { tag: MARKDOWN_SOURCE_TAGS.blockMark,   color: colours.blockMark },
        { tag: MARKDOWN_SOURCE_TAGS.destination, color: colours.destination },
        { tag: MARKDOWN_SOURCE_TAGS.escape,      color: colours.escape },
        { tag: MARKDOWN_SOURCE_TAGS.html,        color: colours.html },
        { tag: MARKDOWN_SOURCE_TAGS.dialect,     color: colours.dialect },
        { tag: MARKDOWN_SOURCE_TAGS.code,        color: colours.code },
    ];
}

/** Class the reveal highlight's decoration carries; styled below, inside the editor's theme scope. */
export const REVEAL_CLASS = "ts-ui-cm-reveal";

/** Added alongside {@link REVEAL_CLASS} to run the entrance flash once. Omitted under reduced motion. */
export const REVEAL_FLASH_CLASS = "ts-ui-cm-reveal-flash";

/** Name of the reveal flash's `@keyframes` block, registered once below. */
const REVEAL_FLASH_KEYFRAME = "ts-ui-code-editor-reveal-flash";

// Long enough to register as a flash rather than a repaint, short enough that
// it has finished by the time the eye reaches the range — the same order as
// READONLY_FLASH_MS (300ms) in ReadOnlyFlash.ts, doubled because this animation
// has to be caught rather than merely felt.
const REVEAL_FLASH_MS = 600;

/** Resting tint of the reveal highlight — the same strength as a selected search match. */
const REVEAL_RESTING_TINT = "color-mix(in srgb, var(--ts-ui-indicator-focus, #2563eb) 25%, transparent)";

/** Peak tint the flash starts from, decaying to {@link REVEAL_RESTING_TINT}. */
const REVEAL_PEAK_TINT = "color-mix(in srgb, var(--ts-ui-indicator-focus, #2563eb) 50%, transparent)";

deferStyleSheetWrite(() => {
    StyleRule.ensureKeyframes(
        REVEAL_FLASH_KEYFRAME,
        `from { background-color: ${REVEAL_PEAK_TINT}; } to { background-color: ${REVEAL_RESTING_TINT}; }`
    );
});

/** The built theme for `dark === false`, built on first use and shared by every editor. */
let _lightTheme: Extension | null = null;

/** The built theme for `dark === true`. */
let _darkTheme: Extension | null = null;

/**
 * Builds the editor's theme extension: the chrome (background, gutters,
 * cursor, selection) via `EditorView.theme`, plus syntax-highlighting colours
 * via a `HighlightStyle`.
 *
 * The result is built once per `dark` value and shared by every editor from
 * then on. That is not an optimisation: both halves compile to a `style-mod`
 * module, and `style-mod` bounds a root's rule count by the number of modules
 * mounted into it while offering no way to unmount one — so a module built per
 * call (once per editor, and once more per theme change) grows the page's
 * stylesheet forever. Sharing is sound because the build depends on nothing
 * but `dark`: every colour it writes is either a module constant or a
 * `var(--ts-ui-…)` reference the browser resolves at paint time.
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
    const cached = dark ? _darkTheme : _lightTheme;

    if (cached) {
        return cached;
    }

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
        // CodeMirror's own search panel is kept installed and open (it still
        // drives searchHighlighter's match tinting) but its DOM is hidden — a
        // framework-built floating CodeEditorSearchPanel replaces it visually.
        // Scoped to `.cm-search` so the go-to-line dialog and any lint panel,
        // which share `.cm-panels`/`.cm-panel`, keep their container.
        ".cm-panel.cm-search": {
            display: "none",
        },
        ".cm-panels:has(> .cm-panel.cm-search:only-child)": {
            display: "none",
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
        [`.${REVEAL_CLASS}`]: {
            backgroundColor: REVEAL_RESTING_TINT,
        },
        [`.${REVEAL_CLASS}.${REVEAL_FLASH_CLASS}`]: {
            // No fill-mode: the animation ends on the resting tint the rule above
            // already declares, so the mark settles with nothing to clean up.
            animation: `${REVEAL_FLASH_KEYFRAME} ${REVEAL_FLASH_MS}ms ease-out`,
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
        ".cm-tooltip.cm-tooltip-autocomplete": {
            backgroundColor: "var(--ts-ui-autocomplete-bg, #ffffff)",
            border:          "1px solid var(--ts-ui-autocomplete-border, #c8c8c8)",
            boxShadow:       "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0, 0, 0, 0.15))",
            color:           "var(--ts-ui-text-color, #1a1a1a)",
        },
        ".cm-tooltip-autocomplete > ul > li": {
            color: "var(--ts-ui-text-color, #1a1a1a)",
        },
        ".cm-tooltip-autocomplete > ul > li:hover": {
            backgroundColor: "var(--ts-ui-autocomplete-item-hover-bg, rgba(37, 99, 235, 0.08))",
        },
        ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
            backgroundColor: "var(--ts-ui-autocomplete-item-highlight-bg, rgba(37, 99, 235, 0.18))",
            color:           "var(--ts-ui-autocomplete-item-highlight-color, inherit)",
        },
        ".cm-completionMatchedText": {
            color:          "var(--ts-ui-indicator-focus, #2563eb)",
            fontWeight:     "bold",
            textDecoration: "none",
        },
        ".cm-completionDetail": {
            color: "var(--ts-ui-autocomplete-item-disabled-color, #aaaaaa)",
        },
        ".cm-completionIcon": {
            color: "var(--ts-ui-autocomplete-item-disabled-color, #aaaaaa)",
        },
    }, { dark });

    const highlight = syntaxHighlighting(HighlightStyle.define(syntaxStyles(dark)));

    const built: Extension = [chrome, highlight];

    if (dark) {
        _darkTheme = built;
    } else {
        _lightTheme = built;
    }

    return built;
}
