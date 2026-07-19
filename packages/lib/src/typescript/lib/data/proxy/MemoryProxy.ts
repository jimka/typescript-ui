// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '~/data/ModelRecord.js';
import { Proxy, ReadParams } from '~/data/proxy/Proxy.js';

/**
 * Construction-time options for {@link MemoryProxy}.
 *
 * @category Data
 */
export interface MemoryProxyOptions {
    data: any[];
}

/**
 * @deprecated Use {@link MemoryProxyOptions}.
 */
export type MemoryProxyConfig = MemoryProxyOptions;

/**
 * An in-memory proxy that stores data as a plain JavaScript array.
 * All operations resolve synchronously via `Promise.resolve`.
 *
 * @remarks
 * Because this proxy holds no external state, data is lost when the page is
 * refreshed or the proxy instance is discarded. It is primarily intended for
 * testing and for stores that manage transient, client-only data.
 *
 * @category Data
 */
export class MemoryProxy extends Proxy {

    private _data: any[];

    /**
     * Constructs a MemoryProxy, optionally pre-populated with an initial data array.
     *
     * @param options - Optional. Options object containing the initial data array.
     */
    constructor(options: MemoryProxyOptions = { data: [] }) {
        // Proxy has no options bag; fields are read from options directly below.
        // eslint-disable-next-line local/forward-super-options
        super();

        this._data = options.data.slice();
    }

    /**
     * Replaces the in-memory data array used by this proxy.
     *
     * @param data - The new data array; a shallow copy is stored internally.
     */
    setData(data: any[]): void {
        this._data = data.slice();
    }

    /**
     * Returns a copy of the in-memory data array.
     *
     * @param _params - Optional. Pagination parameters; ignored by this proxy.
     *
     * @returns A promise that resolves to a shallow copy of the current data array.
     */
    read(_params?: ReadParams): Promise<any[]> {
        return Promise.resolve(this._data.slice());
    }

    /**
     * Appends a copy of the record's data to the in-memory array.
     *
     * @param record - The new ModelRecord to store.
     *
     * @returns A promise that resolves to the stored copy of the record's data.
     */
    create(record: ModelRecord): Promise<Record<string, any>> {
        const copy = { ...record.getData() };

        this._data.push(copy);

        return Promise.resolve(copy);
    }

    /**
     * Updates the matching entry in the in-memory array by primary key.
     *
     * @param record - The dirty ModelRecord whose data should replace the existing entry.
     *
     * @returns A promise that resolves to the updated copy of the record's data.
     *
     * @remarks
     * If the model has no primary key or the record is not found in the array, the
     * array is left unchanged and the method still resolves successfully.
     */
    update(record: ModelRecord): Promise<Record<string, any>> {
        const copy = { ...record.getData() };
        const pkName = record.getModel().getPrimaryKeyField()?.getName();

        if (pkName !== undefined) {
            const id = record.getId();
            const idx = this._data.findIndex(d => d[pkName] === id);

            if (idx !== -1) {
                this._data[idx] = copy;
            }
        }

        return Promise.resolve(copy);
    }

    /**
     * Removes the matching entry from the in-memory array by primary key.
     *
     * @param record - The ModelRecord to remove.
     *
     * @returns A promise that resolves when the removal is complete.
     *
     * @remarks
     * If the model has no primary key or the record is not found, the array is
     * left unchanged and the method still resolves successfully.
     */
    destroy(record: ModelRecord): Promise<void> {
        const pkName = record.getModel().getPrimaryKeyField()?.getName();

        if (pkName !== undefined) {
            const id = record.getId();
            const idx = this._data.findIndex(d => d[pkName] === id);

            if (idx !== -1) {
                this._data.splice(idx, 1);
            }
        }

        return Promise.resolve();
    }
}
