// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The dialect's shared grammar — both the `{key=value …}` attribute grammar
 * (underline/colour/font/size spans, table column widths, block alignment,
 * and sized images) and the line-level grammar of a `:::` fence's inner text
 * (its `:::` closer, nested fences and `|||` column separators, with the
 * code-fence rule that grammar reads lines by) — kept in exactly one place so
 * both the read-only `Markdown` viewer and the `MarkdownEditor` agree on what
 * is safe to render, where a fence ends and where a column region splits. A
 * value that fails attribute validation is dropped rather than rendered; see
 * each `resolve*` function below.
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

/** An open code fence: its character and the length of its opening run. */
interface CodeFence {
    readonly char:   string;
    readonly length: number;
}

/** A trimmed code-fence line: three or more backticks or tildes, then the rest of the line. */
const CODE_FENCE_LINE = /^(`{3,}|~{3,})(.*)$/;

/** What may follow a closing fence's run: more fence characters only, as `marked`'s `fences` rule allows. */
const CLOSING_FENCE_TAIL = /^[`~]*$/;

/**
 * The list-item markers a trimmed line can start with before its content —
 * a bullet, or an ordered marker of one to nine digits (CommonMark's limit)
 * and `.` or `)`, each followed by whitespace. A code fence or `:::` fence
 * opened on an item's marker line is closed by a line indented under the
 * item, which the scan reads, so the opening is read after the markers too.
 */
const LEADING_LIST_MARKERS = /^(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)+/;

/** Where a line scan of a `:::` fence's inner text stands: its nested-fence depth and the code block it is in. */
export interface FenceLineScan {
    depth: number;
    code:  CodeFence | null;
}

/** What one line of a `:::` fence's inner text is at the fence's own level ({@link readFenceLine}). */
export type FenceLineRole = "closer" | "separator" | "escaped-separator" | "content";

/**
 * Starts a line scan of a `:::` fence's inner text, at depth 0 outside code.
 *
 * @returns The scan state, for {@link readFenceLine}.
 */
export function startFenceLineScan(): FenceLineScan {
    return { depth: 0, code: null };
}

/**
 * Reads the code fence a trimmed line opens: a run of three or more
 * backticks or tildes, as `marked`'s `fences` rule reads it.
 *
 * @param trimmed - The line, trimmed.
 * @returns The fence it opens, or `null` when it opens none.
 */
function openedCodeFence(trimmed: string): CodeFence | null {
    const match = CODE_FENCE_LINE.exec(trimmed);

    if (match === null) {
        return null;
    }

    const run = match[1]!;

    // A backtick fence's info string cannot hold a backtick (CommonMark §4.5).
    return run[0] === "`" && match[2]!.includes("`") ? null : { char: run[0]!, length: run.length };
}

/**
 * Tells whether a trimmed line closes an open code fence: the opening run
 * repeated (same character, at least as long), then fence characters only.
 *
 * @param trimmed - The line, trimmed.
 * @param fence - The open code fence.
 * @returns `true` when the line closes it.
 */
function closesCodeFence(trimmed: string, fence: CodeFence): boolean {
    return trimmed.startsWith(fence.char.repeat(fence.length)) && CLOSING_FENCE_TAIL.test(trimmed.slice(fence.length));
}

/**
 * Reads one line of a `:::` fence's inner text and says what it is at the
 * fence's own level, advancing `scan` past it. A line inside a fenced code
 * block or a nested `:::` fence is always `"content"`; at the fence's own
 * level, outside code, a `:::` line is the `"closer"`, a `|||` line the
 * `"separator"` and a `\|||` line the `"escaped-separator"`. A code block
 * opens and closes as `marked` reads it (a run of three or more backticks or
 * tildes; it closes only on its own character, at least as long, followed
 * by fence characters only), and every line counts at any indentation, as
 * the `:::` and `|||` lines always have; a code fence or `:::` fence also
 * opens after list-item markers (as in `- ~~~`), since the line closing it is
 * indented under the item. Mutates `scan`.
 *
 * @param scan - The scan state, from {@link startFenceLineScan}; advanced past the line.
 * @param line - The line.
 * @returns The line's role at the fence's own level.
 */
export function readFenceLine(scan: FenceLineScan, line: string): FenceLineRole {
    const trimmed = line.trim();

    if (scan.code !== null) {
        const closed = closesCodeFence(trimmed, scan.code);

        scan.code = closed ? null : scan.code;

        return "content";
    }

    const opening = trimmed.replace(LEADING_LIST_MARKERS, "");
    const opened = openedCodeFence(opening);

    if (opened !== null) {
        scan.code = opened;

        return "content";
    }

    if (trimmed === ":::") {
        if (scan.depth === 0) {
            return "closer";
        }

        scan.depth -= 1;

        return "content";
    }

    // A `:::` line with anything after it opens a nested fence (3 is ":::".length, as in the tokenizer).
    const opensFence = opening.startsWith(":::") && opening.slice(3).trim() !== "";

    if (opensFence) {
        scan.depth += 1;

        return "content";
    }

    if (scan.depth === 0 && trimmed === COLUMN_SEPARATOR) {
        return "separator";
    }

    return scan.depth === 0 && trimmed === `\\${COLUMN_SEPARATOR}` ? "escaped-separator" : "content";
}

/**
 * Splits a `:::` fence's inner text into one section per column, on any line
 * whose trimmed form is exactly {@link COLUMN_SEPARATOR} — but only at the
 * fence's own nesting level ({@link readFenceLine}): a separator line inside
 * a fenced code block or a nested `:::` fence is ordinary content. A line
 * that is the separator preceded by a backslash (`\|||`) is unescaped to a
 * literal `|||` and kept as content rather than splitting. Always returns at
 * least one section, so a fence always has at least one column.
 *
 * @param inner - The fence's inner text (between its opening and closing lines).
 * @returns The column sections, in document order.
 *
 * @example
 * ```
 * splitColumnSections("A\n|||\nB")                 // -> ["A", "B"]
 * splitColumnSections("A\n\\|||\nB")               // -> ["A\n|||\nB"]
 * splitColumnSections("````\n```\n````\n|||\nB")  // -> ["````\n```\n````", "B"]
 * ```
 */
export function splitColumnSections(inner: string): string[] {
    const sections: string[] = [];
    const scan = startFenceLineScan();
    let current: string[] = [];

    for (const line of inner.split("\n")) {
        const role = readFenceLine(scan, line);

        if (role === "separator") {
            sections.push(current.join("\n"));
            current = [];

            continue;
        }

        // Only unescaped at this fence's own level: a `\|||` line inside a
        // nested fence or a code block is left untouched here so the later
        // recursive parse of that nested content (which runs this same
        // function again, at its own depth 0) is the one that unescapes it —
        // unescaping it here too would double-consume the backslash.
        current.push(role === "escaped-separator" ? line.replace("\\", "") : line);
    }

    sections.push(current.join("\n"));

    return sections;
}

/**
 * Reverses {@link splitColumnSections}: joins column sections back into one
 * fence body, escaping any line whose trimmed form is exactly
 * {@link COLUMN_SEPARATOR} so it re-imports as content rather than a split —
 * but, symmetrically with the split side, only at that line's own nesting
 * level ({@link readFenceLine}). A section's content can itself contain an
 * already-exported nested `:::` fence or a fenced code block (e.g. one
 * column's content is another whole column-region fence); a `|||` line
 * inside either of those is left untouched, since it is not a threat to
 * *this* join — re-splitting the joined whole only ever looks for a
 * separator at depth 0, outside code. Escaping it anyway would still be
 * undone correctly on the next import (an unescape with nothing to undo is a
 * no-op), but it would mean the exported Markdown no longer matches what a
 * nested import round-trip produces.
 *
 * @param sections - The column sections, in document order.
 * @returns The joined fence inner text.
 *
 * @example
 * ```
 * joinColumnSections(["A", "B"])                  // -> "A\n|||\nB"
 * joinColumnSections(["|||"])                     // -> "\\|||"
 * joinColumnSections(["````\n```\n|||\n````"])   // -> "````\n```\n|||\n````"
 * ```
 */
export function joinColumnSections(sections: string[]): string {
    return sections
        .map((section) => {
            const scan = startFenceLineScan();

            return section.split("\n")
                .map((line) => (readFenceLine(scan, line) === "separator" ? line.replace(COLUMN_SEPARATOR, `\\${COLUMN_SEPARATOR}`) : line))
                .join("\n");
        })
        .join(`\n${COLUMN_SEPARATOR}\n`);
}

/**
 * Tells whether content written as the only column of a `:::` fence would
 * not read back as that column: a line would close the fence, the fence's
 * closing line would be swallowed by a nested fence or a code block left
 * open, or the join and split would change a line.
 *
 * @param content - The column's Markdown.
 * @returns `true` when the content breaks its column.
 */
export function breaksColumn(content: string): boolean {
    const inner = joinColumnSections([content]);
    const scan = startFenceLineScan();
    const closesEarly = inner.split("\n").some((line) => readFenceLine(scan, line) === "closer");
    const sections = splitColumnSections(inner);

    return closesEarly || scan.depth !== 0 || scan.code !== null || sections.length !== 1 || sections[0] !== content;
}

/**
 * Finds where the line starting at `start` ends, so a block tokenizer can read
 * one line at a time instead of splitting the whole remaining document into an
 * array to look at its first line or two — the difference between linear and
 * quadratic lexing of a long document.
 *
 * @param src - The source being read.
 * @param start - The index the line starts at.
 * @returns The index of the `"\n"` that ends the line, or `src.length` when
 *   the line is the last one and unterminated.
 */
export function lineEndAt(src: string, start: number): number {
    const end = src.indexOf("\n", start);

    return end === -1 ? src.length : end;
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
