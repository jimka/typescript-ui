// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The dialect's shared grammar — both the `{key=value …}` attribute grammar
 * (underline/colour/font/size spans, table column widths, block alignment,
 * and sized images) and the line-level `|||` column-separator grammar — kept
 * in exactly one place so both the read-only `Markdown` viewer and the
 * `MarkdownEditor` agree on what is safe to render and where a column region
 * splits. A value that fails attribute validation is dropped rather than
 * rendered; see each `resolve*` function below.
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

/** The line-level marker separating one column region from the next inside a `:::` fence. */
export const COLUMN_SEPARATOR = "|||";

/**
 * Splits a `:::` fence's inner text into one section per column, on any line
 * whose trimmed form is exactly {@link COLUMN_SEPARATOR} — but only at the
 * fence's own nesting level: a separator line inside a fenced code block or a
 * nested `:::` fence is ordinary content. A line that is the separator
 * preceded by a backslash (`\|||`) is unescaped to a literal `|||` and kept
 * as content rather than splitting. Always returns at least one section, so
 * a fence always has at least one column.
 *
 * @param inner - The fence's inner text (between its opening and closing lines).
 * @returns The column sections, in document order.
 *
 * @example
 * ```
 * splitColumnSections("A\n|||\nB")     // -> ["A", "B"]
 * splitColumnSections("A\n\\|||\nB")   // -> ["A\n|||\nB"]
 * ```
 */
export function splitColumnSections(inner: string): string[] {
    const sections: string[] = [];
    let current: string[] = [];
    let depth = 0;
    let inCode = false;

    for (const line of inner.split("\n")) {
        const trimmed = line.trim();

        if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
            inCode = !inCode;
        } else if (!inCode) {
            if (trimmed === ":::") {
                depth = Math.max(0, depth - 1);
            } else if (trimmed.startsWith(":::") && trimmed.slice(3).trim() !== "") {
                depth += 1;
            } else if (depth === 0 && trimmed === COLUMN_SEPARATOR) {
                sections.push(current.join("\n"));
                current = [];

                continue;
            }
        }

        // Only unescaped at this fence's own level: a `\|||` line inside a
        // nested fence or a code block is left untouched here so the later
        // recursive parse of that nested content (which runs this same
        // function again, at its own depth 0) is the one that unescapes it —
        // unescaping it here too would double-consume the backslash.
        current.push(!inCode && depth === 0 ? line.replace(/^(\s*)\\\|\|\|$/, "$1|||") : line);
    }

    sections.push(current.join("\n"));

    return sections;
}

/**
 * Reverses {@link splitColumnSections}: joins column sections back into one
 * fence body, escaping any line whose trimmed form is exactly
 * {@link COLUMN_SEPARATOR} so it re-imports as content rather than a split —
 * but, symmetrically with the split side, only at that line's own nesting
 * level. A section's content can itself contain an already-exported nested
 * `:::` fence or a fenced code block (e.g. one column's content is another
 * whole column-region fence); a `|||` line inside either of those is left
 * untouched, since it is not a threat to *this* join — re-splitting the
 * joined whole only ever looks for a separator at depth 0, outside code.
 * Escaping it anyway would still be undone correctly on the next import (an
 * unescape with nothing to undo is a no-op), but it would mean the exported
 * Markdown no longer matches what a nested import round-trip produces.
 *
 * @param sections - The column sections, in document order.
 * @returns The joined fence inner text.
 *
 * @example
 * ```
 * joinColumnSections(["A", "B"])   // -> "A\n|||\nB"
 * joinColumnSections(["|||"])      // -> "\\|||"
 * ```
 */
export function joinColumnSections(sections: string[]): string {
    return sections
        .map((section) => {
            let depth = 0;
            let inCode = false;

            return section.split("\n").map((line) => {
                const trimmed = line.trim();

                if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
                    inCode = !inCode;
                } else if (!inCode) {
                    if (trimmed === ":::") {
                        depth = Math.max(0, depth - 1);
                    } else if (trimmed.startsWith(":::") && trimmed.slice(3).trim() !== "") {
                        depth += 1;
                    }
                }

                return !inCode && depth === 0 && trimmed === COLUMN_SEPARATOR
                    ? line.replace(COLUMN_SEPARATOR, `\\${COLUMN_SEPARATOR}`)
                    : line;
            }).join("\n");
        })
        .join(`\n${COLUMN_SEPARATOR}\n`);
}

/** A sized image's resolved, validated source/alt/dimensions. */
export interface MarkdownImageSpec {
    src:    string;
    alt:    string;
    width:  number | null;
    height: number | null;
}

/** The `data:image/…` MIME types this dialect renders — deliberately excludes `svg+xml`, which can embed script. */
const DATA_IMAGE_MIME = /^data:image\/(png|jpeg|gif|webp|avif);base64,/;

/** A block's resolved, validated alignment/column-gap style — one field `null` per unset or invalid key. */
export interface MarkdownBlockStyle {
    textAlign: string | null;
    columnGap: string | null;
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
 * Validates and resolves the two block-style attribute keys (`align`,
 * `gap`). Follows the same drop-on-failure rule as {@link resolveSpanStyle}.
 *
 * @param attributes - The parsed attribute record.
 * @returns The resolved block style.
 */
export function resolveBlockStyle(attributes: Record<string, string>): MarkdownBlockStyle {
    const align = attributes.align;
    const gap = attributes.gap;

    return {
        textAlign: align !== undefined && ALIGN.test(align) ? align : null,
        columnGap: gap !== undefined && isValidSize(gap) ? gap : null,
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

/**
 * Validates and resolves an image's `src` against a scheme allow-list
 * (relative path, `http:`, `https:`, or an allow-listed `data:image/…`
 * base64 URI) plus its optional `width`/`height` attributes.
 *
 * @param src - The image's authored source.
 * @param alt - The image's alt text.
 * @param attributes - The parsed attribute record (`width`, `height`).
 * @returns The resolved image spec, or `null` when `src` fails the scheme allow-list.
 *
 * @example
 * ```
 * resolveImageSpec("/img/d.png", "Diagram", { width: "320" })
 * // -> { src: "/img/d.png", alt: "Diagram", width: 320, height: null }
 *
 * resolveImageSpec("javascript:alert(1)", "x", {})   // -> null
 * ```
 */
export function resolveImageSpec(src: string, alt: string, attributes: Record<string, string>): MarkdownImageSpec | null {
    const isRelative = !src.includes(":");
    const isHttp = src.startsWith("http:") || src.startsWith("https:");
    const isDataImage = DATA_IMAGE_MIME.test(src);

    if (!isRelative && !isHttp && !isDataImage) {
        return null;
    }

    const width = attributes.width;
    const height = attributes.height;

    return {
        src,
        alt,
        width:  width !== undefined && POSITIVE_INTEGER.test(width) ? Number(width) : null,
        height: height !== undefined && POSITIVE_INTEGER.test(height) ? Number(height) : null,
    };
}
