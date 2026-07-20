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
 * Reads a GFM delimiter row's per-column alignment, or `null` when the line
 * is not a delimiter row (any segment isn't `-`s optionally bounded by `:`).
 *
 * @param line - The candidate delimiter-row line.
 * @returns One {@link ElementFormatType} per column, or `null` when `line` is
 *   not a valid delimiter row.
 *
 * @example
 * ```
 * parseDelimiterRow("| :--- | :---: | ---: | --- |") // -> ["left", "center", "right", ""]
 * parseDelimiterRow("| a | b |")                      // -> null
 * ```
 */
function parseDelimiterRow(line: string): ElementFormatType[] | null {
    const segments = splitTableRow(line);
    const alignments: ElementFormatType[] = [];

    for (const segment of segments) {
        if (!/^:?-+:?$/.test(segment)) {
            return null;
        }

        const left = segment.startsWith(":");
        const right = segment.endsWith(":");

        if (left && right) {
            alignments.push("center");
        } else if (left) {
            alignments.push("left");
        } else if (right) {
            alignments.push("right");
        } else {
            alignments.push("");
        }
    }

    return alignments;
}

/**
 * Renders a delimiter row from the header cells' formats.
 *
 * @param alignments - One {@link ElementFormatType} per column.
 * @returns The rendered delimiter-row line.
 *
 * @example
 * ```
 * formatDelimiterRow(["left", "center", "right", ""]) // -> "| :--- | :---: | ---: | --- |"
 * ```
 */
function formatDelimiterRow(alignments: ElementFormatType[]): string {
    const cells = alignments.map((alignment) => {
        switch (alignment) {
            case "left":   return ":---";
            case "center": return ":---:";
            case "right":  return "---:";
            default:       return "---";
        }
    });

    return "| " + cells.join(" | ") + " |";
}

/**
 * Prepares a cell's Markdown for embedding in a pipe row: trims it, escapes
 * every `|` to `\|`, and replaces every newline with a literal `\n`.
 *
 * @param markdown - The cell's exported Markdown.
 * @returns The pipe-row-safe cell text.
 */
function escapeCellText(markdown: string): string {
    return markdown.trim().replace(/\|/g, "\\|").replace(/\n/g, "\\n");
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

            const alignments = parseDelimiterRow(delimiterLine);

            if (alignments === null) {
                return null;
            }

            const headerCells = splitTableRow(lines[startLineIndex]);
            const columnCount = headerCells.length;

            if (alignments.length !== columnCount) {
                return null;
            }

            const rows: string[][] = [headerCells];
            let lastConsumedLineIndex = startLineIndex + 1;

            // marked ends a table only at a blank line (or end of input), so a
            // following prose line with no pipe in it is absorbed as a
            // one-cell row rather than ending the table here.
            for (let lineIndex = startLineIndex + 2; lineIndex < lines.length; lineIndex += 1) {
                const line = lines[lineIndex];

                if (line.trim() === "") {
                    break;
                }

                rows.push(splitTableRow(line));
                lastConsumedLineIndex = lineIndex;
            }

            const table = $createTableNode();

            rows.forEach((cells, rowIndex) => {
                const row = $createTableRowNode();

                for (let column = 0; column < columnCount; column += 1) {
                    const cell = $createTableCellNode(
                        rowIndex === 0 ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS);

                    $convertFromMarkdownString(
                        (cells[column] ?? "").replace(/\\n/g, "\n"), getTransformers(), cell);

                    // AFTER the conversion: it clears the cell's children, and
                    // setting the format first risks the clear taking the
                    // format with it.
                    cell.setFormat(alignments[column] ?? "");
                    row.append(cell);
                }

                table.append(row);
            });

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

            const renderRow = (row: TableRowNodeType): string => {
                const cells = row.getChildren().filter($isTableCellNode);
                const rendered = cells.map(
                    (cell) => escapeCellText($convertToMarkdownString(getTransformers(), cell)));

                return "| " + rendered.join(" | ") + " |";
            };

            const headerRow = rows[0];
            const headerCells = headerRow.getChildren().filter($isTableCellNode);
            const alignments = headerCells.map((cell) => cell.getFormatType());

            const lines = [renderRow(headerRow), formatDelimiterRow(alignments)];

            for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
                lines.push(renderRow(rows[rowIndex]));
            }

            return lines.join("\n");
        },
    };
}
