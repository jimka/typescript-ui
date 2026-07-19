// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '~/data/ModelRecord.js';

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
 * Default writer producing `JSON.stringify(record.getData())` for a single
 * record and a JSON array of data objects for a batch.
 *
 * @remarks
 * Reproduces the historical inline {@link AjaxProxy} body serialization so
 * existing callers and tests are unaffected. Set `mode: 'dirty'` to send only
 * changed fields (plus the primary key) on updates.
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
     * Serializes a single record as `JSON.stringify(dataFor(record, operation))`.
     *
     * @param record - The record to serialize.
     * @param operation - Optional. The proxy operation this write is for.
     *
     * @returns The serialized request body.
     */
    writeRecord(record: ModelRecord, operation?: WriteOperation): string {
        return JSON.stringify(this.dataFor(record, operation));
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
        return JSON.stringify(records.map(record => this.dataFor(record, operation)));
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
    private dataFor(record: ModelRecord, operation?: WriteOperation): Record<string, any> {
        return this._mode === 'dirty' && operation === 'update' ? record.getChangedData() : record.getData();
    }
}
