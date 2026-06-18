// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import { Column } from "~/component/table/Column.js";
import { ColumnConfig } from "~/component/table/ColumnConfig.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { FieldType } from "~/data/Field.js";

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
 * Stateless helper that converts a column list and a record list into a CSV
 * or JSON download.
 *
 * @remarks
 * Used internally by {@link Table.exportCSV} and {@link Table.exportJSON}.
 * Date, time, and datetime values are formatted with the same `toLocale*`
 * options the cell renderers use, so exports match what the user sees.
 */
export class TableExporter {

    /**
     * Converts columns + records to an RFC 4180 CSV string and triggers a download.
     *
     * @param columns       - The columns to include as fields in the CSV.
     * @param records       - The records to serialize as rows.
     * @param columnConfigs - Per-field column config map (carries `showSeconds` for time/datetime).
     * @param options       - Optional export options.
     */
    static exportCSV(
        columns      : Column[],
        records      : ModelRecord[],
        columnConfigs: Map<string, ColumnConfig>,
        options     ?: ExportOptions
    ): void {
        const header = columns
            .map(c => TableExporter.escapeCSVField(c.getField().getName()))
            .join(',');

        const rows = records.map(record =>
            columns
                .map(c => TableExporter.escapeCSVField(TableExporter.formatValue(c, record.get(c.getField().getName()), columnConfigs)))
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
     * @param columnConfigs - Per-field column config map (carries `showSeconds` for time/datetime).
     * @param options       - Optional export options.
     */
    static exportJSON(
        columns      : Column[],
        records      : ModelRecord[],
        columnConfigs: Map<string, ColumnConfig>,
        options     ?: ExportOptions
    ): void {
        const data = records.map(record =>
            Object.fromEntries(
                columns.map(c => [
                    c.getField().getName(),
                    TableExporter.formatValue(c, record.get(c.getField().getName()), columnConfigs)
                ])
            )
        );
        const json = JSON.stringify(data, null, 2);

        TableExporter.download(json, options?.filename ?? 'table-export.json', 'application/json');
    }

    /**
     * Formats a raw cell value the same way the matching cell renderer does.
     *
     * @param column        - The column whose field type drives the formatting choice.
     * @param value         - The raw value read from the record.
     * @param columnConfigs - Per-field config map; consulted for `showSeconds` on time/datetime.
     * @returns The formatted value, or the original value when no formatting applies.
     */
    private static formatValue(column: Column, value: any, columnConfigs: Map<string, ColumnConfig>): any {
        if (value == null || !(value instanceof Date)) {
            return value;
        }

        const type        : FieldType = column.getField().getType();
        const showSeconds : boolean   = columnConfigs.get(column.getField().getName())?.showSeconds ?? false;

        switch (type) {
            case 'date':
                return value.toLocaleDateString();
            case 'time':
                return value.toLocaleTimeString(undefined, showSeconds
                    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
                    : { hour: '2-digit', minute: '2-digit' });
            case 'datetime':
                return value.toLocaleString(undefined, showSeconds
                    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
                    : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            default:
                return value;
        }
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
     * Triggers a browser download of the given content via a temporary anchor element.
     *
     * @param content  - The textual content to download.
     * @param filename - The suggested filename for the download.
     * @param mimeType - The MIME type used to construct the Blob.
     */
    private static download(content: string, filename: string, mimeType: string): void {
        const blob = new Blob([content], { type: mimeType });
        const url  = URL.createObjectURL(blob);
        const a    = DOM.sink.createElement('a') as HTMLAnchorElement;

        a.href     = url;
        a.download = filename;

        DOM.sink.appendChild(document.body, a);
        a.click();
        DOM.sink.removeChild(document.body, a);

        URL.revokeObjectURL(url);
    }
}
