// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The shared `{key=value …}` attribute grammar for the Markdown dialect's
 * extension syntax (underline/colour/font/size spans, table column widths,
 * block alignment/columns, and sized images) — parsed, validated, and
 * re-serialised in exactly one place so both the read-only `Markdown` viewer
 * and the `MarkdownEditor` agree on what is safe to render. A value that
 * fails validation is dropped rather than rendered; see each `resolve*`
 * function below.
 */

/** A span's resolved, validated colour/font/size — one field `null` per unset or invalid key. */
export interface MarkdownSpanStyle {
    color:      string | null;
    fontFamily: string | null;
    fontSize:   string | null;
}

/** A bare hex colour: `#rgb`, `#rrggbb`, or `#rrggbbaa`. */
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** A bare CSS colour keyword (e.g. `red`, `rebeccapurple`) — letters only. */
const NAMED_COLOR = /^[a-zA-Z]+$/;
/** An `rgb()`/`rgba()`/`hsl()`/`hsla()` function call with a numeric/percentage argument list. */
const FUNCTION_COLOR = /^(rgb|rgba|hsl|hsla)\([-0-9.,%\s/]+\)$/i;
/** A number followed by one of the accepted CSS length/percentage units. */
const SIZE = /^[0-9]*\.?[0-9]+(px|pt|em|rem|%)$/;
/** A font-family list: letters, digits, spaces, commas, hyphens, and quotes. */
const FONT_FAMILY = /^[a-zA-Z0-9 ,'"-]+$/;

function isValidColor(value: string): boolean {
    return HEX_COLOR.test(value) || NAMED_COLOR.test(value) || FUNCTION_COLOR.test(value);
}

function isValidSize(value: string): boolean {
    return SIZE.test(value);
}

function isValidFontFamily(value: string): boolean {
    return FONT_FAMILY.test(value);
}

/** A positive integer, the accepted column-width pixel dimension. */
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
/** `left` / `center` / `right` / `justify`, the four accepted block alignments. */
const ALIGN = /^(left|center|right|justify)$/;
/** An integer 2–6, the accepted multi-column count. */
const COLUMN_COUNT = /^[2-6]$/;

/** A block's resolved, validated alignment/column layout — one field `null` per unset or invalid key. */
export interface MarkdownBlockStyle {
    textAlign:   string | null;
    columnCount: number | null;
    columnGap:   string | null;
}

/**
 * Reads a space-separated `key=value` attribute list. A value is either a
 * bare run with no whitespace or a double-quoted run (which may contain
 * spaces). Unknown keys are kept — the per-feature `resolve*` functions drop
 * what they don't recognise or validate.
 *
 * @param text - The raw attribute text, e.g. `color=#c00 font="Georgia, serif"`.
 * @returns The parsed key/value record.
 *
 * @example
 * ```
 * parseAttributes('color=#c00 font="Georgia, serif" size=1.2em')
 * // -> { color: "#c00", font: "Georgia, serif", size: "1.2em" }
 * ```
 */
export function parseAttributes(text: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const pattern = /([a-zA-Z][a-zA-Z0-9]*)=(?:"([^"]*)"|(\S+))/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
        const key = match[1]!;
        const value = match[2] !== undefined ? match[2] : match[3]!;

        attributes[key] = value;
    }

    return attributes;
}

/**
 * Re-serialises an attribute record to `{key=value …}` text, quoting a value
 * that contains a space.
 *
 * @param attributes - The attribute record to serialise.
 * @returns The formatted attribute text.
 *
 * @example
 * ```
 * formatAttributes({ color: "#c00", font: "Georgia, serif" })
 * // -> 'color=#c00 font="Georgia, serif"'
 * ```
 */
export function formatAttributes(attributes: Record<string, string>): string {
    return Object.entries(attributes)
        .map(([key, value]) => (value.includes(" ") ? `${key}="${value}"` : `${key}=${value}`))
        .join(" ");
}

/**
 * Validates and resolves the three span-style attribute keys (`color`,
 * `font`, `size`). A key that is absent, or whose value fails validation,
 * resolves to `null` for that field — the construct renders with that
 * property unset rather than throwing or rendering an unsafe value.
 *
 * @param attributes - The parsed attribute record.
 * @returns The resolved span style.
 *
 * @example
 * ```
 * resolveSpanStyle({ color: "#c00", size: "1.2em" })
 * // -> { color: "#c00", fontFamily: null, fontSize: "1.2em" }
 * ```
 */
export function resolveSpanStyle(attributes: Record<string, string>): MarkdownSpanStyle {
    const color = attributes.color;
    const font = attributes.font;
    const size = attributes.size;

    return {
        color:      color !== undefined && isValidColor(color) ? color : null,
        fontFamily: font !== undefined && isValidFontFamily(font) ? font : null,
        fontSize:   size !== undefined && isValidSize(size) ? size : null,
    };
}

/**
 * Reverses {@link resolveSpanStyle}: maps a resolved span style back to its
 * `{key=value}` attribute record, omitting any unset field.
 *
 * @param style - The span style to serialise.
 * @returns The attribute record.
 */
export function spanStyleToAttributes(style: MarkdownSpanStyle): Record<string, string> {
    const attributes: Record<string, string> = {};

    if (style.color !== null) {
        attributes.color = style.color;
    }

    if (style.fontFamily !== null) {
        attributes.font = style.fontFamily;
    }

    if (style.fontSize !== null) {
        attributes.size = style.fontSize;
    }

    return attributes;
}

/**
 * Serialises a span style to the CSS text a Lexical `TextNode.setStyle` takes
 * (kebab-case declarations joined by `; `).
 *
 * @param style - The span style to serialise.
 * @returns The CSS text, or `""` when every field is unset.
 */
export function spanStyleToCss(style: MarkdownSpanStyle): string {
    const declarations: string[] = [];

    if (style.color !== null) {
        declarations.push(`color: ${style.color}`);
    }

    if (style.fontFamily !== null) {
        declarations.push(`font-family: ${style.fontFamily}`);
    }

    if (style.fontSize !== null) {
        declarations.push(`font-size: ${style.fontSize}`);
    }

    return declarations.join("; ");
}

/**
 * Reads a Lexical `TextNode.getStyle()` CSS string back into the attribute
 * record {@link resolveSpanStyle} understands — the inverse of
 * {@link spanStyleToCss}, keyed by attribute name rather than CSS property
 * name.
 *
 * @param cssText - The node's inline CSS text (e.g. `"color: #c00; font-size: 1.2em"`).
 * @returns The attribute record.
 */
export function cssTextToAttributes(cssText: string): Record<string, string> {
    const attributes: Record<string, string> = {};

    for (const declaration of cssText.split(";")) {
        const separator = declaration.indexOf(":");

        if (separator === -1) {
            continue;
        }

        const property = declaration.slice(0, separator).trim();
        const value = declaration.slice(separator + 1).trim();

        if (value === "") {
            continue;
        }

        if (property === "color") {
            attributes.color = value;
        } else if (property === "font-family") {
            attributes.font = value;
        } else if (property === "font-size") {
            attributes.size = value;
        }
    }

    return attributes;
}

/**
 * Validates and resolves the three block-style attribute keys (`align`,
 * `columns`, `gap`). Follows the same drop-on-failure rule as
 * {@link resolveSpanStyle}.
 *
 * @param attributes - The parsed attribute record.
 * @returns The resolved block style.
 */
export function resolveBlockStyle(attributes: Record<string, string>): MarkdownBlockStyle {
    const align = attributes.align;
    const columns = attributes.columns;
    const gap = attributes.gap;

    return {
        textAlign:   align !== undefined && ALIGN.test(align) ? align : null,
        columnCount: columns !== undefined && COLUMN_COUNT.test(columns) ? Number(columns) : null,
        columnGap:   gap !== undefined && isValidSize(gap) ? gap : null,
    };
}

/**
 * Reverses {@link resolveBlockStyle}: maps a resolved block style back to its
 * `{key=value}` attribute record, omitting any unset field.
 *
 * @param style - The block style to serialise.
 * @returns The attribute record.
 */
export function blockStyleToAttributes(style: MarkdownBlockStyle): Record<string, string> {
    const attributes: Record<string, string> = {};

    if (style.textAlign !== null) {
        attributes.align = style.textAlign;
    }

    if (style.columnCount !== null) {
        attributes.columns = String(style.columnCount);
    }

    if (style.columnGap !== null) {
        attributes.gap = style.columnGap;
    }

    return attributes;
}

/**
 * Reads a delimiter cell's trailing `{width=…}` attribute.
 *
 * @param text - The delimiter cell's text, e.g. `":--- {width=240}"`.
 * @returns The column width in pixels, or `null` when unset or invalid.
 *
 * @example
 * ```
 * resolveColumnWidth(":--- {width=240}")   // -> 240
 * resolveColumnWidth(":---")               // -> null
 * ```
 */
export function resolveColumnWidth(text: string): number | null {
    const match = /\{([^{}]*)\}/.exec(text);

    if (match === null) {
        return null;
    }

    const width = parseAttributes(match[1]!).width;

    return width !== undefined && POSITIVE_INTEGER.test(width) ? Number(width) : null;
}
