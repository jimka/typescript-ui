// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import { Column } from "~/component/table/Column.js";
import { ColumnConfig } from "~/component/table/ColumnConfig.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import type { CellTextResolver } from "~/component/table/cell/CellText.js";

/**
 * Options controlling a {@link Table} export operation.
 *
 * @category Components
 */
export interface ExportOptions {
    /** When true, hidden columns are included in the export. Default: false. */
    includeHidden?: boolean;

    /** Override the downloaded filename. */
    filename?: string;
}

/**
 * Stateless helper that converts a column list and a record list into a CSV,
 * JSON, or TSV download.
 *
 * @remarks
 * Used internally by {@link Table.exportCSV}, {@link Table.exportJSON}, and
 * {@link Table.exportTSV}. Combo, date, time, and datetime values are
 * formatted the same way the matching cell renderer displays them, so
 * exports match what the user sees.
 */
export class TableExporter {

    /**
     * Converts columns + records to an RFC 4180 CSV string and triggers a download.
     *
     * @param columns       - The columns to include as fields in the CSV.
     * @param records       - The records to serialize as rows.
     * @param columnConfigs - Per-field column config map (carries `values` / `showSeconds`).
     * @param display       - Resolver used to format combo/temporal values.
     * @param options       - Optional export options.
     */
    static exportCSV(
        columns      : Column[],
        records      : ModelRecord[],
        columnConfigs: Map<string, ColumnConfig>,
        display      : CellTextResolver,
        options     ?: ExportOptions
    ): void {
        const header = columns
            .map(c => TableExporter.escapeCSVField(c.getField().getName()))
            .join(',');

        const rows = records.map(record =>
            columns
                .map(c => TableExporter.escapeCSVField(TableExporter.formatValue(c, record.get(c.getField().getName()), columnConfigs, display)))
                .join(',')
        );

        const csv = [header, ...rows].join('\r\n');

        TableExporter.download(csv, options?.filename ?? 'table-export.csv', 'text/csv;charset=utf-8;');
    }

    /**
     * Converts columns + records to a pretty-printed JSON array of objects and triggers a download.
     *
     * @param columns       - The columns whose field names become the keys of each emitted object.
     * @param records       - The records to serialize.
     * @param columnConfigs - Per-field column config map (carries `values` / `showSeconds`).
     * @param display       - Resolver used to format combo/temporal values.
     * @param options       - Optional export options.
     */
    static exportJSON(
        columns      : Column[],
        records      : ModelRecord[],
        columnConfigs: Map<string, ColumnConfig>,
        display      : CellTextResolver,
        options     ?: ExportOptions
    ): void {
        const data = records.map(record =>
            Object.fromEntries(
                columns.map(c => [
                    c.getField().getName(),
                    TableExporter.formatValue(c, record.get(c.getField().getName()), columnConfigs, display)
                ])
            )
        );
        const json = JSON.stringify(data, null, 2);

        TableExporter.download(json, options?.filename ?? 'table-export.json', 'application/json');
    }

    /**
     * Converts columns + records to a tab-separated string and triggers a download.
     *
     * @param columns       - The columns to include as fields in the TSV.
     * @param records       - The records to serialize as rows.
     * @param columnConfigs - Per-field column config map (carries `values` / `showSeconds`).
     * @param display       - Resolver used to format combo/temporal values.
     * @param options       - Optional export options.
     */
    static exportTSV(
        columns      : Column[],
        records      : ModelRecord[],
        columnConfigs: Map<string, ColumnConfig>,
        display      : CellTextResolver,
        options     ?: ExportOptions
    ): void {
        const header = columns.map(c => c.getField().getName());

        const rows = records.map(record =>
            columns.map(c => String(TableExporter.formatValue(c, record.get(c.getField().getName()), columnConfigs, display) ?? ''))
        );

        const tsv = TableExporter.buildRectangularTSV([header, ...rows]);

        TableExporter.download(tsv, options?.filename ?? 'table-export.tsv', 'text/tab-separated-values;charset=utf-8;');
    }

    /**
     * Formats a raw cell value the same way the matching cell renderer does.
     * Only two shapes are reformatted — everything else, including `null` /
     * `undefined`, a plain `number` / `string` / `boolean`, and a `Date` on a
     * non-temporal column, passes through unchanged so JSON export keeps its
     * types and a boolean column keeps exporting `true` / `false`.
     *
     * @param column        - The column whose field type / config drives the formatting choice.
     * @param value         - The raw value read from the record.
     * @param columnConfigs - Per-field config map; consulted for `values` and `showSeconds`.
     * @param display       - Resolver used to format the combo/temporal shapes.
     * @returns The formatted value, or the original value when no formatting applies.
     *
     * @internal
     */
    static formatValue(column: Column, value: any, columnConfigs: Map<string, ColumnConfig>, display: CellTextResolver): any {
        if (value == null) {
            return value;
        }

        const config = columnConfigs.get(column.getField().getName());

        if (config?.values && config.values.length > 0) {
            return display.text('combo', false, config.values, value);
        }

        if (!(value instanceof Date)) {
            return value;
        }

        const type = column.getField().getType();

        if (type !== 'date' && type !== 'time' && type !== 'datetime') {
            return value;
        }

        return display.text(type, config?.showSeconds ?? false, undefined, value);
    }

    /**
     * Escapes a single CSV field value per RFC 4180.
     *
     * @param value - The raw value to escape; null and undefined become empty strings.
     * @returns The escaped CSV field, wrapped in quotes when it contains `,`, `"`, or `\n`.
     */
    private static escapeCSVField(value: any): string {
        const str = String(value ?? '');

        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }

        return str;
    }

    /**
     * Joins a row-major grid of already-stringified cell values into a
     * tab/newline-delimited string, escaping each field.
     *
     * @param rows - The grid, one array of cell strings per row.
     * @returns The tab-separated, newline-joined text.
     *
     * @internal
     */
    static buildRectangularTSV(rows: string[][]): string {
        return rows.map(row => row.map(TableExporter.escapeTSVField).join('\t')).join('\n');
    }

    /**
     * Escapes a single TSV field value.
     *
     * @param value - The already-stringified value to escape.
     * @returns The escaped TSV field, wrapped in quotes when it contains a tab, `"`, or `\n`.
     */
    private static escapeTSVField(value: string): string {
        if (value.includes('\t') || value.includes('"') || value.includes('\n')) {
            return '"' + value.replace(/"/g, '""') + '"';
        }

        return value;
    }

    /**
     * Triggers a browser download of the given content via a temporary anchor element.
     *
     * @param content  - The textual content to download.
     * @param filename - The suggested filename for the download.
     * @param mimeType - The MIME type used to construct the Blob.
     */
    private static download(content: string, filename: string, mimeType: string): void {
        const blob = new Blob([content], { type: mimeType });
        const url  = URL.createObjectURL(blob);
        const a    = DOM.sink.createElement('a');

        DOM.sink.apply(a, { setAttr: { "href": url, "download": filename } });

        DOM.sink.appendChild(DOM.source.getBody(), a);
        DOM.sink.click(a);
        DOM.sink.removeChild(DOM.source.getBody(), a);
        DOM.sink.release(a);

        URL.revokeObjectURL(url);
    }
}
