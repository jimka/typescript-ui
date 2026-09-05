// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { ElementFormatType } from "lexical";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import type { MultilineElementTransformer, Transformer } from "@lexical/markdown";
import {
    $createTableNode, $createTableRowNode, $createTableCellNode,
    $isTableNode, $isTableRowNode, $isTableCellNode,
    TableNode, TableRowNode, TableCellNode, TableCellHeaderStates,
} from "@lexical/table";
import type { TableRowNode as TableRowNodeType } from "@lexical/table";
import { resolveColumnWidth } from "~/component/display/markdownAttributes.js";

/**
 * A candidate table row: any line containing a pipe. Deliberately loose — a
 * line only becomes a table once the next line is a matching delimiter row,
 * which {@link createTableTransformer}'s `handleImportAfterStartMatch` checks.
 * Leading and trailing pipes are optional in GFM, so they cannot be part of
 * this test.
 */
const TABLE_ROW_REG_EXP = /\|/;

/**
 * Splits one row into its cell texts. Drops one optional leading and one
 * optional trailing pipe, splits on unescaped `|` only, turns each `\|` back
 * into a literal `|`, and trims each cell. A manual scan rather than a regexp
 * with a lookbehind — the same choice `@lexical/markdown`'s own
 * `isTableRowDivider` makes, since a nested-quantifier lookbehind pattern can
 * run in super-linear time on a backtracking regexp engine.
 *
 * @param line - One raw table-row line (with or without surrounding pipes).
 * @returns The row's cell texts, trimmed and unescaped.
 *
 * @example
 * ```
 * splitTableRow("| a | b \\| c |") // -> ["a", "b | c"]
 * splitTableRow("a | b")           // -> ["a", "b"]
 * ```
 */
function splitTableRow(line: string): string[] {
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
 * Reads a GFM delimiter row's per-column alignment and optional `{width=…}`,
 * or `null` when the line is not a delimiter row (any segment isn't `-`s
 * optionally bounded by `:`, optionally followed by `{…}`).
 *
 * @param line - The candidate delimiter-row line.
 * @returns One {@link ElementFormatType} and one width per column, or `null`
 *   when `line` is not a valid delimiter row.
 *
 * @example
 * ```
 * parseDelimiterRow("| :--- {width=240} | --- |") // -> { alignments: ["left", ""], widths: [240, null] }
 * parseDelimiterRow("| a | b |")                   // -> null
 * ```
 */
function parseDelimiterRow(line: string): { alignments: ElementFormatType[]; widths: Array<number | null> } | null {
    const segments = splitTableRow(line);
    const alignments: ElementFormatType[] = [];
    const widths: Array<number | null> = [];

    for (const segment of segments) {
        const match = /^(:?-+:?)(?:\s*\{[^{}]*\})?$/.exec(segment);

        if (match === null) {
            return null;
        }

        const dashes = match[1]!;
        const left = dashes.startsWith(":");
        const right = dashes.endsWith(":");

        if (left && right) {
            alignments.push("center");
        } else if (left) {
            alignments.push("left");
        } else if (right) {
            alignments.push("right");
        } else {
            alignments.push("");
        }

        widths.push(resolveColumnWidth(segment));
    }

    return { alignments, widths };
}

/**
 * Renders a delimiter row from the header cells' formats and the table's
 * column widths. A `0` (or `null`) width is `@lexical/table`'s own "no width"
 * sentinel for `TableNode.getColWidths()`, so it re-emits with no `{width=…}`.
 *
 * @param alignments - One {@link ElementFormatType} per column.
 * @param widths - One column width (in pixels) per column, or `null`/`0` for none.
 * @returns The rendered delimiter-row line.
 *
 * @example
 * ```
 * formatDelimiterRow(["left", "center", "right", ""], [240, null, null, null])
 * // -> "| :--- {width=240} | :---: | ---: | --- |"
 * ```
 */
function formatDelimiterRow(alignments: ElementFormatType[], widths: readonly (number | null)[]): string {
    const cells = alignments.map((alignment, index) => {
        const dashes = (() => {
            switch (alignment) {
                case "left":   return ":---";
                case "center": return ":---:";
                case "right":  return "---:";
                default:       return "---";
            }
        })();

        const width = widths[index];

        return width !== null && width !== 0 && width !== undefined ? `${dashes} {width=${width}}` : dashes;
    });

    return "| " + cells.join(" | ") + " |";
}

/**
 * Prepares a cell's Markdown for embedding in a pipe row: trims it, escapes
 * every `|` to `\|`, replaces every newline with a literal `\n`, and — when
 * the *entire* trimmed text is literally `<<` or `^^` — escapes it to `\<<` /
 * `\^^` so it round-trips as content rather than being read back as a merge
 * continuation marker on import.
 *
 * @param markdown - The cell's exported Markdown.
 * @returns The pipe-row-safe cell text.
 */
function escapeCellText(markdown: string): string {
    const trimmed = markdown.trim();

    if (trimmed === "<<" || trimmed === "^^") {
        return "\\" + trimmed;
    }

    return trimmed.replace(/\|/g, "\\|").replace(/\n/g, "\\n");
}

/**
 * Reverses the whole-cell `\<<` / `\^^` escape {@link escapeCellText} writes,
 * back to the literal marker text — the import-side counterpart, applied
 * before a merge-marker check so an escaped cell reads as content, not a
 * continuation.
 *
 * @param text - A raw, still-escaped cell text.
 * @returns The unescaped text.
 */
function unescapeCellText(text: string): string {
    return text === "\\<<" ? "<<" : text === "\\^^" ? "^^" : text;
}

/** One resolved grid position: the `(row, column)` of the cell it is covered by, or itself if it's an anchor. */
interface CellAnchor {
    row:    number;
    column: number;
}

/**
 * Resolves `<<`/`^^` continuations over the body-row grid into one anchor per
 * position — the same three-step algorithm the viewer's own
 * `markdownTableExtension.ts` implements over the same raw cell-text shape:
 * `<<` points left, `^^` points up (both transitively, since earlier
 * positions are already resolved by the time a later one reads them), and a
 * `<<` in column 0 or a `^^` in row 0 has nothing to extend, so it becomes
 * its own anchor holding that literal text. The header row is never part of
 * this grid — only body rows merge.
 *
 * @param grid - The body rows' raw cell texts, one array per row, each
 *   already padded to the table's column count.
 * @returns One {@link CellAnchor} per grid position, same shape as `grid`.
 */
function resolveMergeGrid(grid: string[][]): CellAnchor[][] {
    const anchors: CellAnchor[][] = grid.map((row) => row.map(() => ({ row: -1, column: -1 })));

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

/**
 * Builds the GFM pipe-table transformer: a `MultilineElementTransformer` that
 * consumes a whole table block (header, delimiter, and body rows) in one pass
 * — the same `handleImportAfterStartMatch` hook the curated `CODE` transformer
 * uses for fenced blocks — so it can require a delimiter row before
 * committing, rather than the row-at-a-time shape Lexical's own playground
 * `TABLE` transformer uses.
 *
 * @param getTransformers - Returns the curated transformer array. Called at
 *   import/export time, not at construction time, so the array may reference
 *   the transformer this call returns (avoiding a module import cycle with
 *   the file that builds that array).
 * @returns The table transformer, ready to include in a transformer array.
 */
export function createTableTransformer(getTransformers: () => Transformer[]): MultilineElementTransformer {
    return {
        dependencies: [TableNode, TableRowNode, TableCellNode],
        regExpStart:  TABLE_ROW_REG_EXP,
        type:         "multiline-element",

        handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
            const delimiterLine = lines[startLineIndex + 1];

            if (delimiterLine === undefined) {
                return null;
            }

            const delimiter = parseDelimiterRow(delimiterLine);

            if (delimiter === null) {
                return null;
            }

            const headerCells = splitTableRow(lines[startLineIndex]);
            const columnCount = headerCells.length;

            if (delimiter.alignments.length !== columnCount) {
                return null;
            }

            const bodyLines: string[] = [];
            let lastConsumedLineIndex = startLineIndex + 1;

            // marked ends a table only at a blank line (or end of input), so a
            // following prose line with no pipe in it is absorbed as a
            // one-cell row rather than ending the table here.
            for (let lineIndex = startLineIndex + 2; lineIndex < lines.length; lineIndex += 1) {
                const line = lines[lineIndex];

                if (line.trim() === "") {
                    break;
                }

                bodyLines.push(line);
                lastConsumedLineIndex = lineIndex;
            }

            const table = $createTableNode();
            const headerRow = $createTableRowNode();

            for (let column = 0; column < columnCount; column += 1) {
                const cell = $createTableCellNode(TableCellHeaderStates.ROW);

                $convertFromMarkdownString(
                    (headerCells[column] ?? "").replace(/\\n/g, "\n"), getTransformers(), cell);

                // AFTER the conversion: it clears the cell's children, and
                // setting the format first risks the clear taking the
                // format with it.
                cell.setFormat(delimiter.alignments[column] ?? "");
                headerRow.append(cell);
            }

            table.append(headerRow);

            // Body rows only — the merge grid never covers the header (see
            // resolveMergeGrid), so a `^^` in the first body row has nothing
            // above it to extend into and reads as literal text instead.
            const bodyGrid = bodyLines.map((line) => {
                const cells = splitTableRow(line);

                return Array.from({ length: columnCount }, (_, column) => cells[column] ?? "");
            });

            const anchors = resolveMergeGrid(bodyGrid);

            bodyGrid.forEach((cells, row) => {
                const tableRow = $createTableRowNode();

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

                    const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
                    const text = unescapeCellText(cells[column]!);

                    $convertFromMarkdownString(text.replace(/\\n/g, "\n"), getTransformers(), cell);

                    // AFTER the conversion, per the same ordering rule above.
                    cell.setFormat(delimiter.alignments[column] ?? "");
                    cell.setColSpan(colSpan);
                    cell.setRowSpan(rowSpan);
                    tableRow.append(cell);
                }

                table.append(tableRow);
            });

            table.setColWidths(delimiter.widths.map((width) => width ?? 0));
            rootNode.append(table);

            return [true, lastConsumedLineIndex];
        },

        // Never reached: handleImportAfterStartMatch either imports the block or
        // declines it, so the default multiline import path never runs.
        replace: () => false,

        export: (node) => {
            if (!$isTableNode(node)) {
                return null;
            }

            const rows = node.getChildren().filter($isTableRowNode);

            if (rows.length === 0) {
                return null;
            }

            const headerRow = rows[0];
            const headerCells = headerRow.getChildren().filter($isTableCellNode);
            const alignments = headerCells.map((cell) => cell.getFormatType());
            const columnCount = headerCells.length;

            const renderHeaderRow = (row: TableRowNodeType): string => {
                const cells = row.getChildren().filter($isTableCellNode);
                const rendered = cells.map(
                    (cell) => escapeCellText($convertToMarkdownString(getTransformers(), cell)));

                return "| " + rendered.join(" | ") + " |";
            };

            // The reverse of the import-side merge grid: a cell's `colSpan`
            // writes that many `<<` continuations after it, and a `rowSpan`
            // greater than 1 registers a pending `^^` for the columns it
            // covers, consumed one row at a time as the walk continues down.
            const pendingRowSpans = new Map<number, number>();

            const renderBodyRow = (row: TableRowNodeType): string => {
                const cells = row.getChildren().filter($isTableCellNode);
                const texts: string[] = [];
                let cellIndex = 0;

                for (let column = 0; column < columnCount; column += 1) {
                    const pending = pendingRowSpans.get(column) ?? 0;

                    if (pending > 0) {
                        texts.push("^^");
                        pendingRowSpans.set(column, pending - 1);

                        continue;
                    }

                    const cell = cells[cellIndex];

                    cellIndex += 1;

                    if (cell === undefined) {
                        texts.push("");

                        continue;
                    }

                    texts.push(escapeCellText($convertToMarkdownString(getTransformers(), cell)));

                    const colSpan = cell.getColSpan();
                    const rowSpan = cell.getRowSpan();

                    for (let i = 1; i < colSpan; i += 1) {
                        column += 1;
                        texts.push("<<");
                    }

                    if (rowSpan > 1) {
                        for (let c = column - colSpan + 1; c <= column; c += 1) {
                            pendingRowSpans.set(c, rowSpan - 1);
                        }
                    }
                }

                return "| " + texts.join(" | ") + " |";
            };

            const lines = [renderHeaderRow(headerRow), formatDelimiterRow(alignments, node.getColWidths() ?? [])];

            for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
                lines.push(renderBodyRow(rows[rowIndex]));
            }

            return lines.join("\n");
        },
    };
}
