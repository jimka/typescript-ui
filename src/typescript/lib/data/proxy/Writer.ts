// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '~/data/ModelRecord.js';

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
     *
     * @returns The serialized request body.
     */
    writeRecord(record: ModelRecord): string;

    /**
     * Serializes a batch of records into a request body string.
     *
     * @param records - The records to serialize.
     *
     * @returns The serialized request body.
     */
    writeRecords(records: ModelRecord[]): string;
}

/**
 * Default writer producing `JSON.stringify(record.getData())` for a single
 * record and a JSON array of data objects for a batch.
 *
 * @remarks
 * Reproduces the historical inline {@link AjaxProxy} body serialization so
 * existing callers and tests are unaffected.
 *
 * @category Data
 */
export class JsonWriter implements Writer {

    /**
     * Serializes a single record as `JSON.stringify(record.getData())`.
     *
     * @param record - The record to serialize.
     *
     * @returns The serialized request body.
     */
    writeRecord(record: ModelRecord): string {
        return JSON.stringify(record.getData());
    }

    /**
     * Serializes a batch as a JSON array of the records' data objects.
     *
     * @param records - The records to serialize.
     *
     * @returns The serialized request body.
     */
    writeRecords(records: ModelRecord[]): string {
        return JSON.stringify(records.map(record => record.getData()));
    }
}
