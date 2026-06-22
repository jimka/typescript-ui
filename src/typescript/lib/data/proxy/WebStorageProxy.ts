// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '~/data/ModelRecord.js';
import { Proxy, ReadParams } from '~/data/proxy/Proxy.js';

/**
 * Construction-time options for {@link WebStorageProxy}.
 *
 * @category Data
 */
export interface WebStorageProxyOptions {
    key: string;
    storage?: 'local' | 'session';
    data?: any[];
}

/**
 * @deprecated Use {@link WebStorageProxyOptions}.
 */
export type WebStorageProxyConfig = WebStorageProxyOptions;

/**
 * A proxy that persists its record array to `localStorage` or `sessionStorage`
 * as a single JSON blob under one storage key.
 *
 * @remarks
 * Mirrors {@link MemoryProxy}'s array semantics — CRUD is keyed by primary key —
 * but every operation re-reads and re-writes the keyed blob so the data survives
 * page reloads (and, for `'local'`, browser restarts). New records lacking a
 * primary-key value receive a generated numeric id.
 *
 * Web Storage is synchronous; a `QuotaExceededError` (or a storage-unavailable
 * `SecurityError` in private mode) propagates as a rejected promise rather than
 * being silently swallowed, matching {@link AjaxProxy}'s throw-on-transport-error
 * contract. IndexedDB / async storage is out of scope.
 *
 * @category Data
 */
export class WebStorageProxy extends Proxy {

    private _key: string;
    private _storage: Storage;

    /**
     * Constructs a WebStorageProxy bound to the given storage key.
     *
     * @param options - The options object specifying the storage key, backend,
     *   and optional seed data.
     *
     * @remarks
     * `data` is written only when the key is absent, so a reload preserves the
     * persisted array rather than overwriting it with the seed.
     */
    constructor(options: WebStorageProxyOptions) {
        // Proxy has no options bag; fields are read from options directly below.
        // eslint-disable-next-line local/forward-super-options
        super();

        this._key     = options.key;
        this._storage = options.storage === 'session' ? sessionStorage : localStorage;

        if (options.data !== undefined && this._storage.getItem(this._key) === null) {
            this.writeAll(options.data);
        }
    }

    /**
     * Returns a copy of the persisted data array.
     *
     * @param _params - Optional. Pagination parameters; ignored by this proxy.
     *
     * @returns A promise that resolves to the persisted array (an empty array
     *   when the key is absent).
     */
    read(_params?: ReadParams): Promise<any[]> {
        return Promise.resolve(this.readAll());
    }

    /**
     * Appends a copy of the record's data to the persisted array, assigning a
     * generated id when the record has no primary-key value.
     *
     * @param record - The new ModelRecord to store.
     *
     * @returns A promise that resolves to the stored copy of the record's data.
     */
    create(record: ModelRecord): Promise<Record<string, any>> {
        const data = this.readAll();
        const copy = { ...record.getData() };
        const pkName = record.getModel().getPrimaryKeyField()?.getName();

        if (pkName !== undefined && record.getId() === undefined) {
            copy[pkName] = this.nextId(data, pkName);
        }

        data.push(copy);
        this.writeAll(data);

        return Promise.resolve(copy);
    }

    /**
     * Updates the matching entry in the persisted array by primary key.
     *
     * @param record - The dirty ModelRecord whose data should replace the existing entry.
     *
     * @returns A promise that resolves to the updated copy of the record's data.
     *
     * @remarks
     * If the model has no primary key or the record is not found, the array is
     * left unchanged and the method still resolves successfully.
     */
    update(record: ModelRecord): Promise<Record<string, any>> {
        const data = this.readAll();
        const copy = { ...record.getData() };
        const pkName = record.getModel().getPrimaryKeyField()?.getName();

        if (pkName !== undefined) {
            const id  = record.getId();
            const idx = data.findIndex(d => d[pkName] === id);

            if (idx !== -1) {
                data[idx] = copy;
                this.writeAll(data);
            }
        }

        return Promise.resolve(copy);
    }

    /**
     * Removes the matching entry from the persisted array by primary key.
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
        const data = this.readAll();
        const pkName = record.getModel().getPrimaryKeyField()?.getName();

        if (pkName !== undefined) {
            const id  = record.getId();
            const idx = data.findIndex(d => d[pkName] === id);

            if (idx !== -1) {
                data.splice(idx, 1);
                this.writeAll(data);
            }
        }

        return Promise.resolve();
    }

    /**
     * Reads and parses the persisted array from storage.
     *
     * @returns The persisted array, or an empty array when the key is absent.
     */
    private readAll(): any[] {
        const raw = this._storage.getItem(this._key);

        if (raw === null) {
            return [];
        }

        const parsed = JSON.parse(raw);

        return Array.isArray(parsed) ? parsed : [];
    }

    /**
     * Serializes and writes the array back to storage.
     *
     * @param data - The array to persist under the configured key.
     */
    private writeAll(data: any[]): void {
        this._storage.setItem(this._key, JSON.stringify(data));
    }

    /**
     * Computes the next numeric id for a new record, mirroring the lack of
     * server-side id assignment in {@link MemoryProxy} but made persistent.
     *
     * @param data - The current persisted array.
     * @param pkName - The primary-key field name.
     *
     * @returns One greater than the largest existing numeric primary key.
     *
     * @remarks
     * Seeding from `max(existing numeric pk, 0) + 1` avoids the collisions a
     * `Date.now()` clock would produce on fast successive creates within the
     * same millisecond. The `0` floor handles the empty-store case so the first
     * generated id is `1`.
     */
    private nextId(data: any[], pkName: string): number {
        let maxId = 0;

        for (const item of data) {
            const value = item[pkName];

            if (typeof value === 'number' && value > maxId) {
                maxId = value;
            }
        }

        return maxId + 1;
    }
}
