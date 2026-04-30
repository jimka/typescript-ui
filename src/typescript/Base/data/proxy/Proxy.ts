// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '../ModelRecord.js';

/**
 * Abstract base class for all data proxies.
 * Defines the four CRUD operations that every proxy implementation must provide.
 *
 * @remarks
 * AbstractStore calls these methods during `load()` and `sync()`. Each method
 * receives or returns plain data objects so that the proxy layer remains
 * decoupled from the store's record management logic.
 */
export abstract class Proxy {

    /**
     * Fetches all records from the data source.
     *
     * @returns A promise that resolves to an array of raw data objects.
     */
    abstract read(): Promise<any[]>;

    /**
     * Persists a new record to the data source.
     *
     * @param record - The new ModelRecord to create.
     *
     * @returns A promise that resolves to the server-side representation of the created record,
     *   which may include server-assigned values such as a generated primary key.
     */
    abstract create(record: ModelRecord): Promise<Record<string, any>>;

    /**
     * Updates an existing record in the data source.
     *
     * @param record - The dirty ModelRecord to persist.
     *
     * @returns A promise that resolves to the server-side representation of the updated record.
     */
    abstract update(record: ModelRecord): Promise<Record<string, any>>;

    /**
     * Removes a record from the data source.
     *
     * @param record - The ModelRecord to delete.
     *
     * @returns A promise that resolves when the deletion is complete.
     */
    abstract destroy(record: ModelRecord): Promise<void>;
}
