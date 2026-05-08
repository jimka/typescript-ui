// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractModel } from './AbstractModel.js';
import { ModelRecord } from './ModelRecord.js';
import { Proxy } from './proxy/Proxy.js';
import { FilterDescriptor, matchesFilter } from './FilterDescriptor.js';
import { StoreWorkerClient } from './StoreWorkerClient.js';

/**
 * Datasets above this size are sorted/filtered on a Web Worker so the main
 * thread stays responsive. Below the threshold, the round-trip overhead exceeds
 * the work, so we run synchronously in-process.
 */
const WORKER_THRESHOLD = 1000;
let nextStoreId = 1;

/**
 * Callback fired when a store event ({@link StoreEvent}) is emitted.
 *
 * @category Data
 */
export type StoreListener<T = any> = (payload: T) => void;
/**
 * Names of the events fired by an {@link AbstractStore}.
 *
 * @category Data
 */
export type StoreEvent = 'load' | 'datachanged' | 'add' | 'remove' | 'beforesync' | 'sync';

interface SorterConfig {
    property: string;
    direction: 'asc' | 'desc';
}

/**
 * Abstract base class for all data stores.
 * Manages a collection of ModelRecord instances with support for loading, CRUD mutations,
 * filtering, sorting, and event notification.
 *
 * @remarks
 * The store maintains two parallel arrays: `allRecords` (the master list) and `records`
 * (the filtered and sorted view). Mutations always target `allRecords` and then rebuild
 * the view by calling `applyView()`. Consumers should read from `getRecords()` or
 * `getAt()` rather than accessing the raw arrays directly.
 *
 * @category Data
 */
export abstract class AbstractStore {

    abstract readonly model: AbstractModel;
    abstract readonly proxy: Proxy | undefined;

    private allRecords: ModelRecord[] = [];
    private records: ModelRecord[] = [];
    private pendingRemoved: ModelRecord[] = [];
    private activeFilters: FilterDescriptor[] = [];
    private activeSorter: SorterConfig | null = null;
    private listenerMap: Map<string, StoreListener[]> = new Map();

    // Worker-offload state. Each store gets a unique id so the shared worker can
    // keep snapshots from different stores apart. `snapshotDirty` flags whether
    // the worker's copy of allRecords is stale (re-shipped on the next applyView
    // when the dataset is over the threshold).
    private storeId: string = 'store-' + (nextStoreId++);
    private snapshotDirty: boolean = true;

    // ── Loading ──────────────────────────────────────────────────────────────

    /**
     * Fetches data through the proxy, replaces all records, and fires the 'load' event.
     *
     * @returns A promise that resolves when the data has been loaded and the view rebuilt.
     *
     * @remarks
     * Throws an `Error` if no proxy is configured. Any existing records (including pending
     * removals) are discarded when new data is ingested.
     */
    async load(): Promise<void> {
        if (!this.proxy) {
            throw new Error('Store.load() called but no proxy is configured');
        }
        const raw = await this.proxy.read();
        this.ingestRaw(raw);
        this.emit('load', { records: this.records });
    }

    /**
     * Loads raw data directly without going through the proxy, then fires 'load'.
     *
     * @param data - An array of plain objects to convert into ModelRecords.
     */
    loadData(data: any[]): void {
        this.ingestRaw(data);
        this.emit('load', { records: this.records });
    }

    /**
     * Converts raw objects to ModelRecords and rebuilds the filtered/sorted view.
     *
     * @param data - An array of plain objects to convert via the model's `createRecord`.
     */
    private ingestRaw(data: any[]): void {
        this.allRecords = data.map(item => this.model.createRecord(item));
        this.snapshotDirty = true;
        this.applyView();
    }

    // ── Access ───────────────────────────────────────────────────────────────

    /**
     * Returns a copy of the currently filtered and sorted records.
     *
     * @returns A shallow-copy array of the records in the active view.
     */
    getRecords(): ModelRecord[] {
        return this.records.slice();
    }

    /**
     * Returns a copy of all records, bypassing any active filters or sorting.
     *
     * @returns A shallow-copy array of every record in the store.
     */
    getAll(): ModelRecord[] {
        return this.allRecords.slice();
    }

    /**
     * Returns the number of records in the current filtered view.
     *
     * @returns The count of visible records after filters are applied.
     */
    getCount(): number {
        return this.records.length;
    }

    /**
     * Returns the record at the given index in the filtered view, or undefined.
     *
     * @param index - The zero-based position in the filtered and sorted view.
     *
     * @returns The ModelRecord at that position, or undefined if the index is out of range.
     */
    getAt(index: number): ModelRecord | undefined {
        return this.records[index];
    }

    /**
     * Finds a record by its primary-key value, searching all records (ignoring filters).
     *
     * @param id - The primary key value to search for.
     *
     * @returns The matching ModelRecord, or undefined if not found or no primary key is defined.
     */
    getById(id: any): ModelRecord | undefined {
        if (!this.model.getPrimaryKeyField()) {
            return undefined;
        }

        return this.allRecords.find(r => r.getId() === id);
    }

    /**
     * Returns the first record in the filtered view where property equals value.
     *
     * @param property - The field name to match against.
     * @param value - The value to compare using strict equality.
     *
     * @returns The first matching ModelRecord, or undefined if none is found.
     */
    find(property: string, value: any): ModelRecord | undefined {
        return this.records.find(r => r.get(property) === value);
    }

    /**
     * Returns all records in the filtered view where property equals value.
     *
     * @param property - The field name to match against.
     * @param value - The value to compare using strict equality.
     *
     * @returns An array of all matching ModelRecords; empty if none match.
     */
    findAll(property: string, value: any): ModelRecord[] {
        return this.records.filter(r => r.get(property) === value);
    }

    // ── Mutation ─────────────────────────────────────────────────────────────

    /**
     * Adds one or more records (marked as new), updates the view, and fires 'add'/'datachanged'.
     *
     * @param data - A single plain object or an array of plain objects to add.
     *
     * @returns An array of the newly created ModelRecord instances.
     */
    add(data: any | any[]): ModelRecord[] {
        const items = Array.isArray(data) ? data : [data];
        const added = items.map(item => {
            const record = this.model.createRecord(item);

            record.markAsNew();

            return record;
        });

        this.allRecords.push(...added);
        this.snapshotDirty = true;
        this.applyView();

        this.emit('add', { records: added });
        this.emit('datachanged', {});

        return added;
    }

    /**
     * Removes a record from the store, queuing it for deletion on the next sync.
     *
     * @param record - The ModelRecord to remove.
     *
     * @remarks
     * New records (never synced) are discarded immediately without being queued.
     * Records that have been persisted are added to `pendingRemoved` and sent to
     * the proxy during the next call to `sync()`.
     */
    remove(record: ModelRecord): void {
        const allIdx = this.allRecords.indexOf(record);
        if (allIdx === -1) {
            return;
        }

        this.allRecords.splice(allIdx, 1);
        this.snapshotDirty = true;

        if (!record.isNew()) {
            this.pendingRemoved.push(record);
        }

        this.applyView();

        this.emit('remove', { record });
        this.emit('datachanged', {});
    }

    /**
     * Removes all records, queuing existing (non-new) ones for deletion on the next sync.
     *
     * @remarks
     * Only persisted records are queued for removal; records that are still marked
     * as new are simply discarded.
     */
    removeAll(): void {
        this.pendingRemoved.push(...this.allRecords.filter(r => !r.isNew()));

        this.allRecords = [];
        this.records = [];
        this.snapshotDirty = true;

        this.emit('datachanged', {});
    }

    /**
     * Persists new, dirty, and removed records via the proxy, then fires 'sync'/'datachanged'.
     *
     * @returns A promise that resolves when all pending operations have completed.
     *
     * @remarks
     * Sync is a no-op when no proxy is configured. Operations are performed in order:
     * creates first, then updates, then deletes. Each record is committed after its
     * operation succeeds so it no longer appears in subsequent sync cycles.
     */
    async sync(): Promise<void> {
        if (!this.proxy) {
            return;
        }

        this.emit('beforesync', {});

        for (const record of this.allRecords.filter(r => r.isNew())) {
            const serverData = await this.proxy.create(record);

            for (const [k, v] of Object.entries(serverData)) {
                record.set(k, v);
            }

            record.commit();
        }

        for (const record of this.allRecords.filter(r => r.isDirty() && !r.isNew())) {
            const serverData = await this.proxy.update(record);

            for (const [k, v] of Object.entries(serverData)) {
                record.set(k, v);
            }

            record.commit();
        }

        for (const record of this.pendingRemoved) {
            await this.proxy.destroy(record);
        }

        this.pendingRemoved = [];

        this.emit('sync', {});
        this.emit('datachanged', {});
    }

    // ── Sort ─────────────────────────────────────────────────────────────────

    /**
     * Sorts the view by a property in the given direction and fires 'datachanged'.
     *
     * @param property - The field name to sort by.
     * @param direction - Optional. The sort direction; defaults to 'asc'.
     */
    sort(property: string, direction: 'asc' | 'desc' = 'asc'): Promise<void> {
        this.activeSorter = { property, direction };

        return this.applyView().then(() => {
            this.emit('datachanged', {});
        });
    }

    /**
     * Returns a copy of the active sorter config, or null if no sort is active.
     *
     * @returns The current sorter, or null.
     */
    getActiveSorter(): { property: string; direction: 'asc' | 'desc' } | null {
        return this.activeSorter ? { ...this.activeSorter } : null;
    }

    /**
     * Removes any active sort and restores insertion order, firing 'datachanged'.
     */
    clearSort(): Promise<void> {
        this.activeSorter = null;

        return this.applyView().then(() => {
            this.emit('datachanged', {});
        });
    }

    // ── Filter ───────────────────────────────────────────────────────────────

    /**
     * Adds an equality filter on a property and fires 'datachanged'.
     *
     * @param property - The field name to filter on.
     * @param value - The value a record's field must equal to pass the filter.
     */
    filter(property: string, value: any): Promise<void> {
        this.activeFilters.push({ type: 'eq', field: property, value: value });

        return this.applyView().then(() => {
            this.emit('datachanged', {});
        });
    }

    /**
     * Adds a filter described by a serializable {@link FilterDescriptor}. Descriptors
     * cross the worker boundary cleanly (unlike arbitrary predicate functions), so
     * the same call works for in-process and worker-offloaded evaluation.
     *
     * @param descriptor - The filter descriptor to apply.
     */
    filterBy(descriptor: FilterDescriptor): Promise<void> {
        this.activeFilters.push(descriptor);

        return this.applyView().then(() => {
            this.emit('datachanged', {});
        });
    }

    /**
     * Removes all active filters and fires 'datachanged'.
     */
    clearFilter(): Promise<void> {
        this.activeFilters = [];

        return this.applyView().then(() => {
            this.emit('datachanged', {});
        });
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * Subscribes a listener to a store event.
     *
     * @param event - The name of the store event to listen for.
     * @param listener - The callback function to invoke when the event fires.
     */
    on(event: StoreEvent, listener: StoreListener): void {
        let bucket = this.listenerMap.get(event);
        if (!bucket) {
            bucket = [];

            this.listenerMap.set(event, bucket);
        }

        bucket.push(listener);
    }

    /**
     * Removes a previously registered store event listener.
     *
     * @param event - The name of the store event the listener was registered for.
     * @param listener - The callback function to remove.
     */
    off(event: StoreEvent, listener: StoreListener): void {
        const bucket = this.listenerMap.get(event);
        if (!bucket) {
            return;
        }

        const idx = bucket.indexOf(listener);
        if (idx > -1) {
            bucket.splice(idx, 1);
        }
    }

    /**
     * Notifies all listeners registered for an event.
     *
     * @param event - The name of the event to emit.
     * @param payload - The data object passed to each listener.
     */
    private emit(event: string, payload: any): void {
        const bucket = this.listenerMap.get(event);
        if (!bucket) {
            return;
        }

        for (const listener of bucket) {
            listener(payload);
        }
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    /**
     * Rebuilds the visible records slice by applying all active filters and the active sorter.
     *
     * @remarks
     * Null values sort to the end regardless of sort direction. All active filter
     * predicates must pass for a record to be included in the view.
     */
    /**
     * Recomputes the filtered/sorted view from `allRecords`. Returns a Promise so a
     * future worker-offload path can resolve after the worker round-trip completes;
     * the current implementation runs synchronously and resolves immediately.
     */
    protected applyView(): Promise<void> {
        if (this.allRecords.length >= WORKER_THRESHOLD && StoreWorkerClient.isAvailable()) {
            return this.applyViewOnWorker();
        }

        let view = this.allRecords.slice();

        for (const descriptor of this.activeFilters) {
            view = view.filter(r => matchesFilter(r, descriptor));
        }

        if (this.activeSorter) {
            const { property, direction } = this.activeSorter;

            view.sort((a, b) => {
                const av = a.get(property);
                const bv = b.get(property);

                if (av == null && bv == null) {
                    return 0;
                }

                if (av == null) {
                    return 1;
                }

                if (bv == null) {
                    return -1;
                }

                const cmp = av < bv ? -1 : av > bv ? 1 : 0;

                return direction === 'asc' ? cmp : -cmp;
            });
        }

        this.records = view;

        return Promise.resolve();
    }

    /**
     * Worker-offloaded view rebuild for stores above WORKER_THRESHOLD. Ships a fresh
     * snapshot when allRecords has changed since the last dispatch, then asks the
     * worker for sorted/filtered indices into the snapshot, and maps those indices
     * back to the local ModelRecord array. The worker returns indices (not records)
     * because ModelRecord instances can't survive structured clone.
     */
    private applyViewOnWorker(): Promise<void> {
        const snapshot = this.snapshotDirty
            ? StoreWorkerClient.snapshot(this.storeId, this.allRecords.map(r => r.getData()))
            : Promise.resolve();

        if (this.snapshotDirty) {
            this.snapshotDirty = false;
        }

        const allRecordsRef = this.allRecords;

        return snapshot
            .then(() => StoreWorkerClient.sortFilter(
                this.storeId,
                this.activeSorter
                    ? { field: this.activeSorter.property, direction: this.activeSorter.direction }
                    : undefined,
                this.activeFilters.length > 0
                    ? (this.activeFilters.length === 1
                        ? this.activeFilters[0]
                        : { type: 'and', filters: this.activeFilters })
                    : undefined,
            ))
            .then(indices => {
                // Guard against allRecords having been replaced while the worker ran.
                // If so, the indices reference stale data; trigger a fresh applyView.
                if (allRecordsRef !== this.allRecords) {
                    return this.applyView();
                }

                this.records = indices.map(i => this.allRecords[i]);
                return undefined;
            });
    }
}
