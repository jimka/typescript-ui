// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '~/data/ModelRecord.js';

/**
 * Optional parameters passed to {@link Proxy.read} when the store opts in to
 * server-side pagination.
 *
 * @remarks
 * When `AbstractStore.setPageSize(n)` has been called, `AbstractStore.load()`
 * builds a `ReadParams` object describing the desired page and forwards it to
 * the proxy. Proxies that do not understand pagination (e.g. {@link MemoryProxy})
 * are free to ignore the argument.
 *
 * @category Data
 */
export interface ReadParams {
    page?    : number;
    pageSize?: number;
}

/**
 * Abstract base class for all data proxies.
 * Defines the four CRUD operations that every proxy implementation must provide.
 *
 * @remarks
 * AbstractStore calls these methods during `load()` and `sync()`. Each method
 * receives or returns plain data objects so that the proxy layer remains
 * decoupled from the store's record management logic.
 *
 * @category Data
 */
export abstract class Proxy {

    /**
     * Fetches records from the data source.
     *
     * @param params - Optional. Pagination parameters from the store.
     *   Proxies that do not support pagination may ignore this argument.
     *
     * @returns A promise that resolves to an array of raw data objects.
     */
    abstract read(params?: ReadParams): Promise<any[]>;

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

    /**
     * Returns the total record count reported by the most recent paginated read.
     *
     * @returns The total count from the last paginated response, or undefined if
     *   the proxy does not support pagination or no paginated read has occurred.
     *
     * @remarks
     * Default implementation returns undefined. Pagination-aware proxies (such as
     * {@link AjaxProxy}) override this to return the `total` value parsed from
     * the server envelope.
     */
    getLastTotalCount(): number | undefined {
        return undefined;
    }
}
