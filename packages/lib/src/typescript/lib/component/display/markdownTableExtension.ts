// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Token, TokenizerExtension } from "marked";
import { resolveColumnWidth } from "~/component/display/markdownAttributes.js";

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
}

/**
 * Splits one raw pipe-row line into its cell texts. Mirrors the editor's own
 * `splitTableRow` (`markdownTableTransformer.ts`): drops one optional leading
 * and trailing pipe, splits on unescaped `|` only, restores an escaped `\|`
 * to a literal `|`, and trims each cell. Duplicated rather than imported —
 * `component/display` does not reach into `component/editor`.
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

/**
 * Resolves `<<`/`^^` continuations over the body-row grid into one anchor per
 * position, per the three-step algorithm in the plan's Internal Structure:
 * `<<` points left, `^^` points up (both transitively, since earlier
 * positions are already resolved by the time a later one reads them), and a
 * `<<` in column 0 or a `^^` in row 0 has nothing to extend, so it becomes
 * its own anchor holding that literal text. The header row is never part of
 * this grid — only body rows merge.
 *
 * @param grid - The body rows' raw cell texts, one array per row, each
 *   already padded to the table's column count.
 * @returns One `Anchor` per grid position, same shape as `grid`.
 */
function resolveMergeGrid(grid: string[][]): Anchor[][] {
    const anchors: Anchor[][] = grid.map((row) => row.map(() => ({ row: -1, column: -1 })));

    for (let row = 0; row < grid.length; row += 1) {
        for (let column = 0; column < grid[row]!.length; column += 1) {
            const text = grid[row]![column]!;

            if (text === "<<" && column > 0) {
                anchors[row]![column] = anchors[row]![column - 1]!;
            } else if (text === "^^" && row > 0) {
                anchors[row]![column] = anchors[row - 1]![column]!;
            } else {
                anchors[row]![column] = { row, column };
            }
        }
    }

    return anchors;
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
 * block into paragraphs. Mirrors the editor's own hand-written
 * `markdownTableTransformer.ts`, so each half owns one table parser.
 */
export const TABLE_EXTENSION: TokenizerExtension = {
    name:  "mdtable",
    level: "block",
    tokenizer(src) {
        const lines = src.split("\n");
        const delimiterLine = lines[1];

        if (delimiterLine === undefined) {
            return undefined;
        }

        const delimiter = parseDelimiterRow(delimiterLine);

        if (delimiter === null) {
            return undefined;
        }

        const headerCells = splitRow(lines[0]!);
        const columnCount = headerCells.length;

        if (delimiter.align.length !== columnCount) {
            return undefined;
        }

        const bodyLines: string[] = [];
        let consumedLines = 2;

        for (let i = 2; i < lines.length; i += 1) {
            if (lines[i]!.trim() === "") {
                break;
            }

            bodyLines.push(lines[i]!);
            consumedLines += 1;
        }

        const raw = lines.slice(0, consumedLines).join("\n");

        const header: MdTableHeaderCell[] = headerCells.map((text, column) => ({
            text,
            align:  delimiter.align[column] ?? null,
            tokens: this.lexer.inlineTokens(text),
        }));

        const bodyGrid = bodyLines.map((line) => {
            const cells = splitRow(line);

            return Array.from({ length: columnCount }, (_, column) => cells[column] ?? "");
        });

        const anchors = resolveMergeGrid(bodyGrid);

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
                    tokens: this.lexer.inlineTokens(text),
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
        } satisfies MdTableToken;
    },
};
