// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '~/data/ModelRecord.js';
import { formatWireTemporal } from '~/data/temporalValue.js';

/**
 * The proxy operation a {@link Writer} is serializing for. `AjaxProxy` passes
 * this so a mode-aware writer can tell a create (which always needs the full
 * record) from an update (which may send only what changed).
 *
 * @category Data
 */
export type WriteOperation = 'create' | 'update';

/**
 * Serializes a record (or batch of records) into a request body string.
 *
 * @remarks
 * A `Writer` lets {@link AjaxProxy} delegate request serialization so callers can
 * swap in a custom wire format without subclassing the proxy. The default
 * implementation is {@link JsonWriter}.
 *
 * @category Data
 */
export interface Writer {

    /**
     * Serializes a single record into a request body string.
     *
     * @param record - The record to serialize.
     * @param operation - Optional. The proxy operation this write is for.
     *
     * @returns The serialized request body.
     */
    writeRecord(record: ModelRecord, operation?: WriteOperation): string;

    /**
     * Serializes a batch of records into a request body string.
     *
     * @param records - The records to serialize.
     * @param operation - Optional. The proxy operation this write is for.
     *
     * @returns The serialized request body.
     */
    writeRecords(records: ModelRecord[], operation?: WriteOperation): string;
}

/**
 * How {@link JsonWriter} chooses which fields to serialize on an update.
 *
 * - `'full'` — the historical behaviour: `record.getData()`, every field.
 * - `'dirty'` — only the fields changed since the last commit, plus the
 *   primary key (so a batch update, which carries no id in the URL, stays
 *   identifiable). Ignored for `create`, which always sends the full record —
 *   a new record has no committed baseline to diff against.
 *
 * @category Data
 */
export type JsonWriterMode = 'full' | 'dirty';

/**
 * Construction-time options for {@link JsonWriter}.
 *
 * @category Data
 */
export interface JsonWriterOptions {
    /**
     * Which fields to serialize on an update. Defaults to `'full'`. See
     * {@link JsonWriterMode}.
     */
    mode?: JsonWriterMode;
}

/**
 * Default writer producing a JSON object of the record's field data for a
 * single record and a JSON array of such objects for a batch.
 *
 * @remarks
 * Each `Date` field value is written in the form its field type is read back
 * in: a `date` as `YYYY-MM-DD`, a `time` as `HH:MM:SS.sss`, and any other type
 * as local ISO 8601 with its UTC offset (`2026-06-28T12:04:59.123-07:00`), so
 * the text names the calendar day and wall-clock time the user saw. An Invalid
 * `Date` is written as `null`; a `Date` nested inside an object or array value
 * keeps `JSON.stringify`'s own `toISOString()` form. Every other value is
 * written as `JSON.stringify` writes it.
 *
 * Set `mode: 'dirty'` to send only changed fields (plus the primary key) on
 * updates. A subclass may override the protected `dataFor` method to change
 * which fields are written; its `Date`s are still written by field type.
 *
 * @category Data
 */
export class JsonWriter implements Writer {

    private _mode: JsonWriterMode;

    /**
     * Constructs a JsonWriter from the given options.
     *
     * @param options - Optional. The serialization {@link JsonWriterMode | mode}.
     */
    constructor(options?: JsonWriterOptions) {
        this._mode = options?.mode ?? 'full';
    }

    /**
     * Serializes a single record's field data — every field, or only the
     * changed ones in `'dirty'` mode — as a JSON object, each `Date` in its
     * field type's form.
     *
     * @param record - The record to serialize.
     * @param operation - Optional. The proxy operation this write is for.
     *
     * @returns The serialized request body.
     */
    writeRecord(record: ModelRecord, operation?: WriteOperation): string {
        return JSON.stringify(this.toWireValues(record, this.dataFor(record, operation)));
    }

    /**
     * Serializes a batch as a JSON array of each record's serialized data.
     *
     * @param records - The records to serialize.
     * @param operation - Optional. The proxy operation this write is for.
     *
     * @returns The serialized request body.
     */
    writeRecords(records: ModelRecord[], operation?: WriteOperation): string {
        return JSON.stringify(records.map(record => this.toWireValues(record, this.dataFor(record, operation))));
    }

    /**
     * Chooses a record's serialized field data for the configured mode and
     * operation.
     *
     * @param record - The record being serialized.
     * @param operation - The proxy operation this write is for.
     *
     * @returns `record.getChangedData()` when `mode` is `'dirty'` and
     *   `operation` is `'update'`; otherwise `record.getData()`.
     */
    protected dataFor(record: ModelRecord, operation?: WriteOperation): Record<string, any> {
        return this._mode === 'dirty' && operation === 'update' ? record.getChangedData() : record.getData();
    }

    /**
     * Copies `data` with every top-level `Date` replaced by its wire text for
     * the type of the record's field of that name. Runs on `dataFor`'s result,
     * so a subclass that overrides `dataFor` still gets this conversion.
     *
     * @param record - The record `data` was taken from; its model supplies
     *   each field's type.
     * @param data - The field data `dataFor` chose.
     *
     * @returns A new object with the same keys, each `Date` replaced.
     */
    private toWireValues(record: ModelRecord, data: Record<string, any>): Record<string, any> {
        const model = record.getModel();
        const wire: Record<string, any> = {};

        for (const [name, value] of Object.entries(data)) {
            wire[name] = value instanceof Date ? formatWireTemporal(model.getField(name)?.getType(), value) : value;
        }

        return wire;
    }
}
