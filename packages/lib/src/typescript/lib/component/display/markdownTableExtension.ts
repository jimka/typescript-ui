// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Token, TokenizerExtension } from "marked";
import { lineEndAt, resolveColumnWidth } from "~/component/display/markdownAttributes.js";

/** One header cell: never merged — only body cells carry `<<`/`^^` continuations. */
export interface MdTableHeaderCell {
    text:   string;
    tokens: Token[];
    align:  "center" | "left" | "right" | null;
}

/** One body cell surviving merge resolution (a covered position emits no cell at all). */
export interface MdTableBodyCell {
    text:    string;
    tokens:  Token[];
    align:   "center" | "left" | "right" | null;
    colSpan: number;
    rowSpan: number;
}

/** The `mdtable` block token this extension emits. */
export interface MdTableToken {
    type:   "mdtable";
    raw:    string;
    align:  Array<"center" | "left" | "right" | null>;
    widths: Array<number | null>;
    header: MdTableHeaderCell[];
    rows:   MdTableBodyCell[][];
    /**
     * Whether a body row holds a non-empty cell past the header's last column,
     * which the table drops (GFM ignores a row's excess cells).
     */
    droppedCells: boolean;
}

/**
 * Splits one raw pipe-row line into its cell texts — the reverse of the pipe
 * rows the editor's serializer (`markdownSerializer.ts`) writes: drops one
 * optional leading and trailing pipe, splits on unescaped `|` only, restores
 * an escaped `\|` to a literal `|`, and trims each cell.
 *
 * A cell whose *entire* trimmed text is `\<<` or `\^^` (the escaped form of a
 * literal `<<`/`^^`) is left untouched here; that whole-cell unescape happens
 * later, only for a cell that survives merge resolution, so the merge grid
 * itself still sees the bare `<<`/`^^` sentinel where one was intended.
 *
 * @param line - One raw table-row line (with or without surrounding pipes).
 * @returns The row's cell texts, trimmed and pipe-unescaped.
 */
function splitRow(line: string): string[] {
    let trimmed = line.trim();

    if (trimmed.startsWith("|")) {
        trimmed = trimmed.slice(1);
    }

    if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
        trimmed = trimmed.slice(0, -1);
    }

    const cells: string[] = [];
    let current = "";

    for (let i = 0; i < trimmed.length; i += 1) {
        const char = trimmed[i];

        if (char === "\\" && trimmed[i + 1] === "|") {
            current += "|";
            i += 1;
        } else if (char === "|") {
            cells.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }

    cells.push(current.trim());

    return cells;
}

/**
 * Parses a delimiter row's per-column alignment and optional `{width=…}`.
 *
 * @param line - The candidate delimiter-row line.
 * @returns The per-column alignments and widths, or `null` when `line` is not
 *   a valid delimiter row (a segment isn't `-`s optionally bounded by `:`,
 *   optionally followed by `{…}`).
 */
function parseDelimiterRow(line: string): { align: Array<"center" | "left" | "right" | null>; widths: Array<number | null> } | null {
    const segments = splitRow(line);
    const align: Array<"center" | "left" | "right" | null> = [];
    const widths: Array<number | null> = [];

    for (const segment of segments) {
        const match = /^(:?-+:?)(?:\s*\{[^{}]*\})?$/.exec(segment);

        if (match === null) {
            return null;
        }

        const dashes = match[1]!;
        const left = dashes.startsWith(":");
        const right = dashes.endsWith(":");

        align.push(left && right ? "center" : left ? "left" : right ? "right" : null);
        widths.push(resolveColumnWidth(segment));
    }

    return { align, widths };
}

/** One resolved grid position: the `(row, column)` of the cell it is covered by, or itself if it's an anchor. */
interface Anchor {
    row:    number;
    column: number;
}

/** A cell's rectangle while the grid is resolved: its anchor, and the last row and column it covers so far. */
interface MergeRect {
    readonly anchor: Anchor;
    lastRow:         number;
    lastColumn:      number;
}

/**
 * Resolves `<<`/`^^` continuations over the body-row grid into one anchor per
 * position, row by row, so every anchor covers a whole rectangle (the
 * `colspan` × `rowspan` block a table cell can span): a `<<` extends the cell
 * to its left only while that cell was begun in the same row; a `^^` extends
 * the cell above only from that cell's first column, and only when every
 * further column the cell covers is continued in the same row (by `^^` or
 * `<<`), so the cell grows by a whole row. A marker that cannot extend a cell
 * that way — including a `<<` in column 0 or a `^^` in row 0 — becomes its
 * own anchor holding that literal text. The header row is never part of this
 * grid — only body rows merge.
 *
 * @param grid - The body rows' raw cell texts, one array per row, each
 *   already padded to the table's column count.
 * @returns One `Anchor` per grid position, same shape as `grid`.
 */
function resolveMergeGrid(grid: string[][]): Anchor[][] {
    const owners: MergeRect[][] = grid.map(() => []);

    for (let row = 0; row < grid.length; row += 1) {
        for (let column = 0; column < grid[row]!.length; column += 1) {
            owners[row]![column] ??= extendLeft(grid, owners, row, column)
                ?? extendUp(grid, owners, row, column)
                ?? { anchor: { row, column }, lastRow: row, lastColumn: column };
        }
    }

    return owners.map((rects) => rects.map((rect) => rect.anchor));
}

/**
 * Extends the cell to the left of a `<<` by one column, when that cell was
 * begun in this row (a cell spanning rows from above cannot widen in one row
 * only).
 *
 * @param grid - The body rows' cell texts.
 * @param owners - The rectangles resolved so far.
 * @param row - The position's row.
 * @param column - The position's column.
 * @returns The extended rectangle, or `null` when the position does not extend one.
 */
function extendLeft(grid: string[][], owners: MergeRect[][], row: number, column: number): MergeRect | null {
    const left = column > 0 ? owners[row]![column - 1]! : null;

    if (grid[row]![column] !== "<<" || left === null || left.anchor.row !== row) {
        return null;
    }

    left.lastColumn = column;

    return left;
}

/**
 * Extends the cell above a `^^` by one row, when the `^^` stands under that
 * cell's first column and every further column the cell covers holds `^^` or
 * `<<` in this row; those positions are claimed too.
 *
 * @param grid - The body rows' cell texts.
 * @param owners - The rectangles resolved so far. Updated in place for the claimed positions.
 * @param row - The position's row.
 * @param column - The position's column.
 * @returns The extended rectangle, or `null` when the position does not extend one.
 */
function extendUp(grid: string[][], owners: MergeRect[][], row: number, column: number): MergeRect | null {
    const above = row > 0 ? owners[row - 1]![column]! : null;

    if (grid[row]![column] !== "^^" || above === null || above.anchor.column !== column) {
        return null;
    }

    const covered = grid[row]!.slice(column + 1, above.lastColumn + 1);

    if (!covered.every((text) => text === "^^" || text === "<<")) {
        return null;
    }

    above.lastRow = row;

    for (let claimed = column + 1; claimed <= above.lastColumn; claimed += 1) {
        owners[row]![claimed] = above;
    }

    return above;
}

/** Reverses the whole-cell `\<<` / `\^^` escape back to the literal marker text. */
function unescapeCellText(text: string): string {
    return text === "\\<<" ? "<<" : text === "\\^^" ? "^^" : text;
}

/**
 * A `marked` block tokenizer extension that parses a whole GFM pipe table —
 * header, delimiter (with an optional trailing `{width=…}` per column), and
 * body rows, resolving `<<`/`^^` merge continuations — in one pass. Replaces
 * `marked`'s own table recognition entirely: its built-in delimiter-row regex
 * rejects a cell carrying `{width=…}`, which would otherwise turn the whole
 * block into paragraphs. The editor reads tables through this same
 * extension and writes them with its serializer (`markdownSerializer.ts`),
 * so there is one table parser.
 */
export const TABLE_EXTENSION: TokenizerExtension = {
    name:  "mdtable",
    level: "block",
    tokenizer(src) {
        const headerEnd = src.indexOf("\n");

        // A single unterminated line cannot carry a delimiter row below it.
        if (headerEnd === -1) {
            return undefined;
        }

        const delimiterEnd = lineEndAt(src, headerEnd + 1);
        const delimiter = parseDelimiterRow(src.slice(headerEnd + 1, delimiterEnd));

        if (delimiter === null) {
            return undefined;
        }

        const headerCells = splitRow(src.slice(0, headerEnd));
        const columnCount = headerCells.length;

        if (delimiter.align.length !== columnCount) {
            return undefined;
        }

        const bodyLines: string[] = [];
        let consumedEnd = delimiterEnd;

        while (consumedEnd < src.length) {
            const lineStart = consumedEnd + 1;
            const lineEnd = lineEndAt(src, lineStart);
            const line = src.slice(lineStart, lineEnd);

            if (line.trim() === "") {
                break;
            }

            bodyLines.push(line);
            consumedEnd = lineEnd;
        }

        const raw = src.slice(0, consumedEnd);

        const header: MdTableHeaderCell[] = headerCells.map((text, column) => ({
            text,
            align:  delimiter.align[column] ?? null,
            tokens: this.lexer.inline(text),
        }));

        const bodyGrid = bodyLines.map((line) => {
            const cells = splitRow(line);

            return Array.from({ length: columnCount }, (_, column) => cells[column] ?? "");
        });

        const anchors = resolveMergeGrid(bodyGrid);
        const droppedCells = bodyLines.some((line) => splitRow(line).slice(columnCount).some((cell) => cell !== ""));

        const rows: MdTableBodyCell[][] = bodyGrid.map((cells, row) => {
            const rowCells: MdTableBodyCell[] = [];

            for (let column = 0; column < cells.length; column += 1) {
                const anchor = anchors[row]![column]!;

                if (anchor.row !== row || anchor.column !== column) {
                    continue;
                }

                let colSpan = 1;
                while (
                    column + colSpan < cells.length
                    && anchors[row]![column + colSpan]!.row === row
                    && anchors[row]![column + colSpan]!.column === column
                ) {
                    colSpan += 1;
                }

                let rowSpan = 1;
                while (
                    row + rowSpan < bodyGrid.length
                    && anchors[row + rowSpan]![column]!.row === row
                    && anchors[row + rowSpan]![column]!.column === column
                ) {
                    rowSpan += 1;
                }

                const text = unescapeCellText(cells[column]!);

                rowCells.push({
                    text,
                    align: delimiter.align[column] ?? null,
                    colSpan,
                    rowSpan,
                    tokens: this.lexer.inline(text),
                });
            }

            return rowCells;
        });

        return {
            type: "mdtable",
            raw,
            align: delimiter.align,
            widths: delimiter.widths,
            header,
            rows,
            droppedCells,
        } satisfies MdTableToken;
    },
};
