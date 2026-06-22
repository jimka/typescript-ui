// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractModel } from '~/data/AbstractModel.js';
import { ModelRecord } from '~/data/ModelRecord.js';
import { Proxy, ReadParams } from '~/data/proxy/Proxy.js';
import { FilterDescriptor, matchesFilter } from '~/data/FilterDescriptor.js';
import { StoreWorkerClient } from '~/data/StoreWorkerClient.js';
import { ListenerBag } from '~/core/ListenerBag.js';

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
export type StoreEvent = 'load' | 'datachanged' | 'add' | 'remove' | 'beforesync' | 'sync' | 'loadingchanged' | 'pagechanged' | 'pagechangeblocked' | 'sortchanged';

/**
 * Describes one column's contribution to a multi-column sort.
 *
 * @category Data
 */
export interface SortDescriptor {
    field: string;
    dir  : 'asc' | 'desc';
}

/**
 * Construction-time options shared by every {@link AbstractStore} subclass.
 *
 * @remarks Concrete stores extend this interface with the fields specific to
 * their model/proxy wiring (e.g. {@link StoreOptions}, {@link MemoryStoreOptions},
 * {@link AjaxStoreOptions}).
 *
 * @category Data
 */
export interface AbstractStoreOptions {
    pageSize?:    number;
    page?:        number;
    sorters?:     SortDescriptor[];
    filters?:     FilterDescriptor[];
    remoteSort?:  boolean;
    remoteFilter?:boolean;
    autoLoad?:    boolean;
    listeners?:   Partial<Record<StoreEvent, StoreListener>>;
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

    private _allRecords: ModelRecord[] = [];
    private _records: ModelRecord[] = [];
    private _pendingRemoved: ModelRecord[] = [];
    private _activeFilters: FilterDescriptor[] = [];
    private _activeSorters: SortDescriptor[] = [];
    private _listeners: ListenerBag<StoreEvent> = new ListenerBag<StoreEvent>();

    // Worker-offload state. Each store gets a unique id so the shared worker can
    // keep snapshots from different stores apart. `snapshotDirty` flags whether
    // the worker's copy of allRecords is stale (re-shipped on the next applyView
    // when the dataset is over the threshold).
    private _storeId: string = 'store-' + (nextStoreId++);
    private _snapshotDirty: boolean = true;
    private _loading: boolean = false;

    // ── Server-side pagination state ─────────────────────────────────────────
    // `_pageSize` is undefined until `setPageSize(n)` is called; while undefined,
    // `load()` calls `proxy.read()` with no arguments and the store behaves
    // identically to its unpaginated form.
    private _page: number = 1;
    private _pageSize: number | undefined = undefined;
    private _totalCount: number | undefined = undefined;

    // ── Remote sort/filter + load concurrency state ──────────────────────────
    // When set, active sorters/filters are serialized into ReadParams and a
    // mutation triggers a reload, instead of being applied locally by applyView.
    private _remoteSort: boolean = false;
    private _remoteFilter: boolean = false;

    // `_loadSeq` is bumped on every load() so a stale in-flight response (whose
    // captured seq no longer matches) is ignored. `_loadAbort` cancels the
    // previous HTTP read when a newer load starts.
    private _loadSeq: number = 0;
    private _loadAbort: AbortController | undefined = undefined;

    /**
     * Applies an {@link AbstractStoreOptions} bag to this store. Subclasses
     * should call this from their constructor (after `model` and `proxy` are
     * assigned) so that pagination, sort, filter, and listener defaults are
     * dispatched to the existing setters.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @remarks Listener registrations and filters are applied first so that an
     * `autoLoad: true` flag triggers a `load()` whose result fires the
     * already-registered `'load'` listener.
     */
    protected applyOptions(options: AbstractStoreOptions): void {
        if (options.listeners !== undefined) {
            for (const event of Object.keys(options.listeners) as StoreEvent[]) {
                const listener = options.listeners[event];

                if (listener !== undefined) {
                    this.on(event, listener);
                }
            }
        }

        if (options.pageSize !== undefined) {
            this.setPageSize(options.pageSize);
        }

        if (options.page !== undefined) {
            this._page = options.page;
        }

        if (options.sorters !== undefined && options.sorters.length > 0) {
            this._activeSorters = options.sorters.slice();
        }

        if (options.filters !== undefined && options.filters.length > 0) {
            this._activeFilters = options.filters.slice();
        }

        if (options.remoteSort !== undefined) {
            this._remoteSort = options.remoteSort;
        }

        if (options.remoteFilter !== undefined) {
            this._remoteFilter = options.remoteFilter;
        }

        if (options.autoLoad === true) {
            void this.load();
        }
    }

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

        const seq = ++this._loadSeq;

        this._loadAbort?.abort();

        const controller = new AbortController();
        this._loadAbort = controller;

        this.setLoading(true);

        try {
            const params = this.buildReadParams(controller.signal);
            const raw    = await this.proxy.read(params);

            if (seq !== this._loadSeq) {
                return;
            }

            this.ingestRaw(raw);

            this._totalCount = this.proxy.getLastTotalCount();

            this.emit('load', { records: this._records });
        } catch (err) {
            // An aborted fetch or a superseded load is a silent no-op; only a
            // genuine failure from the current load propagates.
            if ((err as Error).name === 'AbortError' || seq !== this._loadSeq) {
                return;
            }

            throw err;
        } finally {
            if (seq === this._loadSeq) {
                this.setLoading(false);
            }
        }
    }

    /**
     * Builds the {@link ReadParams} for a load: pagination when enabled, plus
     * active sorters/filters when `remoteSort`/`remoteFilter` are on, plus the
     * abort signal.
     *
     * @param signal - The abort signal for the in-flight HTTP read.
     *
     * @returns A ReadParams object, or undefined when nothing applies — so an
     *   unpaginated client-side store still calls `read()` with no arguments and
     *   pagination-unaware proxies keep ignoring it.
     */
    private buildReadParams(signal: AbortSignal): ReadParams | undefined {
        const params: ReadParams = {};

        if (this._pageSize != null) {
            params.page     = this._page;
            params.pageSize = this._pageSize;
        }

        if (this._remoteSort && this._activeSorters.length > 0) {
            params.sorters = this.getActiveSorters();
        }

        if (this._remoteFilter && this._activeFilters.length > 0) {
            params.filters = this.getActiveFilters();
        }

        if (params.page == null && params.sorters == null && params.filters == null) {
            return undefined;
        }

        params.signal = signal;

        return params;
    }

    /**
     * Returns whether the store is currently loading data.
     *
     * @returns True while `load()` is in-flight.
     */
    isLoading(): boolean {
        return this._loading;
    }

    /**
     * Sets the loading flag and fires `'loadingchanged'` only when the value actually changes.
     *
     * @param value - The new loading state.
     */
    private setLoading(value: boolean): void {
        if (this._loading === value) {
            return;
        }

        this._loading = value;
        this.emit('loadingchanged', { loading: value });
    }

    /**
     * Loads raw data directly without going through the proxy, then fires 'load'.
     *
     * @param data - An array of plain objects to convert into ModelRecords.
     */
    loadData(data: any[]): void {
        this.ingestRaw(data);
        this.emit('load', { records: this._records });
    }

    // ── Pagination ───────────────────────────────────────────────────────────

    /**
     * Enables server-side pagination at the given page size and resets to page 1.
     *
     * @param n - The number of records to request per page. Must be a positive integer.
     *
     * @remarks
     * Calling this method opts the store into the paginated `load()` path, where
     * [`ReadParams`](/api/data/interfaces/ReadParams) are forwarded to the proxy. Paginated mode also causes
     * `sort()` and `clearFilter()` to reset to page 1 and re-fetch from the proxy.
     * Fires `'pagechanged'`.
     */
    setPageSize(n: number): this {
        this._pageSize = n;
        this._page = 1;
        this.emit('pagechanged', { page: this._page, pageSize: this._pageSize });

        return this;
    }

    /**
     * Returns the configured page size, or undefined if pagination is disabled.
     *
     * @returns The page size set via {@link setPageSize}, or undefined.
     */
    getPageSize(): number | undefined {
        return this._pageSize;
    }

    /**
     * Returns the current 1-based page number.
     *
     * @returns The current page (defaults to 1 even when pagination is disabled).
     */
    getPage(): number {
        return this._page;
    }

    /**
     * Returns the total record count reported by the most recent paginated load.
     *
     * @returns The total count from the proxy, or undefined when no paginated
     *   load has occurred or the proxy did not report one.
     */
    getTotalCount(): number | undefined {
        return this._totalCount;
    }

    /**
     * Returns the total number of pages, derived from the page size and total count.
     *
     * @returns The number of pages, or undefined when either piece of information
     *   is missing.
     */
    getTotalPages(): number | undefined {
        if (this._pageSize == null || this._totalCount == null) {
            return undefined;
        }

        return Math.max(1, Math.ceil(this._totalCount / this._pageSize));
    }

    /**
     * Advances to the next page and reloads, unless already on the last page.
     *
     * @remarks
     * No-op when pagination is disabled or the current page equals the total
     * page count. When the store has pending unsynced changes, the navigation
     * is blocked and `'pagechangeblocked'` is emitted instead, so the user can
     * sync or reject before leaving the page. Otherwise fires `'pagechanged'`
     * and triggers a fire-and-forget reload.
     */
    nextPage(): void {
        if (this._pageSize == null) {
            return;
        }

        const total = this.getTotalPages();
        if (total != null && this._page >= total) {
            return;
        }

        if (this.hasPendingChanges()) {
            this.emit('pagechangeblocked', { from: this._page, to: this._page + 1 });
            return;
        }

        this._page++;
        this.emit('pagechanged', { page: this._page, pageSize: this._pageSize });
        void this.load();
    }

    /**
     * Returns to the previous page and reloads, unless already on page 1.
     *
     * @remarks
     * Blocked when the store has pending changes — emits `'pagechangeblocked'`
     * instead of firing `'pagechanged'`.
     */
    prevPage(): void {
        if (this._pageSize == null || this._page <= 1) {
            return;
        }

        if (this.hasPendingChanges()) {
            this.emit('pagechangeblocked', { from: this._page, to: this._page - 1 });
            return;
        }

        this._page--;
        this.emit('pagechanged', { page: this._page, pageSize: this._pageSize });
        void this.load();
    }

    /**
     * Jumps to the given 1-based page and reloads.
     *
     * @param n - The target page number; clamped to `[1, totalPages]` when total is known.
     *
     * @remarks
     * No-op when pagination is disabled. Blocked when the store has pending
     * changes — emits `'pagechangeblocked'` instead.
     */
    goToPage(n: number): this {
        if (this._pageSize == null) {
            return this;
        }

        const total  = this.getTotalPages();
        const upper  = total ?? n;
        const target = Math.max(1, Math.min(n, upper));

        if (target === this._page) {
            return this;
        }

        if (this.hasPendingChanges()) {
            this.emit('pagechangeblocked', { from: this._page, to: target });
            return this;
        }

        this._page = target;
        this.emit('pagechanged', { page: this._page, pageSize: this._pageSize });
        void this.load();

        return this;
    }

    /**
     * Converts raw objects to ModelRecords and rebuilds the filtered/sorted view.
     *
     * @param data - An array of plain objects to convert via the model's `createRecord`.
     */
    private ingestRaw(data: any[]): void {
        this._allRecords = data.map(item => this.model.createRecord(item));
        this._snapshotDirty = true;
        this.applyView();
    }

    // ── Access ───────────────────────────────────────────────────────────────

    /**
     * Returns a copy of the currently filtered and sorted records.
     *
     * @returns A shallow-copy array of the records in the active view.
     */
    getRecords(): ModelRecord[] {
        return this._records.slice();
    }

    /**
     * Returns a copy of all records, bypassing any active filters or sorting.
     *
     * @returns A shallow-copy array of every record in the store.
     */
    getAll(): ModelRecord[] {
        return this._allRecords.slice();
    }

    /**
     * Returns the number of records in the current filtered view.
     *
     * @returns The count of visible records after filters are applied.
     */
    getCount(): number {
        return this._records.length;
    }

    /**
     * Returns the record at the given index in the filtered view, or undefined.
     *
     * @param index - The zero-based position in the filtered and sorted view.
     *
     * @returns The ModelRecord at that position, or undefined if the index is out of range.
     */
    getAt(index: number): ModelRecord | undefined {
        return this._records[index];
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

        return this._allRecords.find(r => r.getId() === id);
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
        return this._records.find(r => r.get(property) === value);
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
        return this._records.filter(r => r.get(property) === value);
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

        this._allRecords.push(...added);
        this._snapshotDirty = true;
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
    remove(record: ModelRecord): this {
        const allIdx = this._allRecords.indexOf(record);
        if (allIdx === -1) {
            return this;
        }

        this._allRecords.splice(allIdx, 1);
        this._snapshotDirty = true;

        if (!record.isNew()) {
            this._pendingRemoved.push(record);
        }

        this.applyView();

        this.emit('remove', { record });
        this.emit('datachanged', {});

        return this;
    }

    /**
     * Removes all records, queuing existing (non-new) ones for deletion on the next sync.
     *
     * @remarks
     * Only persisted records are queued for removal; records that are still marked
     * as new are simply discarded.
     */
    removeAll(): this {
        this._pendingRemoved.push(...this._allRecords.filter(r => !r.isNew()));

        this._allRecords = [];
        this._records = [];
        this._snapshotDirty = true;

        this.emit('datachanged', {});

        return this;
    }

    /**
     * Signals that a record's fields were mutated outside the store's own
     * mutation methods (e.g. an in-cell edit in a Table).
     *
     * @param _record - The record that was edited. Forwarded by callers so
     *   future listeners can identify it; currently unused by the store itself.
     *
     * @remarks
     * Fires `'datachanged'` so listeners (toolbars, pagination bars, etc.)
     * re-evaluate state such as {@link hasPendingChanges}. The record's dirty
     * flag is already set by `record.set()`; this method just notifies.
     */
    notifyRecordChanged(_record: ModelRecord): void {
        this.emit('datachanged', {});
    }

    /**
     * Returns whether the store holds any unsynced state.
     *
     * @returns True if any record is dirty, any record is new, or there are
     *   queued removals waiting to be synced.
     *
     * @remarks
     * Used by the pagination guard to prevent navigation that would silently
     * discard in-memory edits. Also useful for "unsaved changes" prompts.
     */
    hasPendingChanges(): boolean {
        if (this._pendingRemoved.length > 0) {
            return true;
        }

        for (const record of this._allRecords) {
            if (record.isNew() || record.isDirty()) {
                return true;
            }
        }

        return false;
    }

    /**
     * Discards all unsynced changes — reverts dirty records, drops new ones,
     * and restores pending removals — then fires 'datachanged'.
     *
     * @remarks
     * Pending removals are pushed back into `allRecords` (in their original
     * order is not preserved; they are appended) so the user can recover from
     * an accidental removal. Dirty records are restored to their last
     * committed values. New records are dropped outright since they were never
     * persisted.
     */
    reject(): void {
        const survivors: ModelRecord[] = [];

        for (const record of this._allRecords) {
            if (record.isNew()) {
                continue;
            }

            if (record.isDirty()) {
                record.reject();
            }

            survivors.push(record);
        }

        if (this._pendingRemoved.length > 0) {
            survivors.push(...this._pendingRemoved);
            this._pendingRemoved = [];
        }

        this._allRecords = survivors;
        this._snapshotDirty = true;
        this.applyView();

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

        for (const record of this._allRecords.filter(r => r.isNew())) {
            const serverData = await this.proxy.create(record);

            for (const [k, v] of Object.entries(serverData)) {
                record.set(k, v);
            }

            record.commit();
        }

        for (const record of this._allRecords.filter(r => r.isDirty() && !r.isNew())) {
            const serverData = await this.proxy.update(record);

            for (const [k, v] of Object.entries(serverData)) {
                record.set(k, v);
            }

            record.commit();
        }

        for (const record of this._pendingRemoved) {
            await this.proxy.destroy(record);
        }

        this._pendingRemoved = [];

        this.emit('sync', {});
        this.emit('datachanged', {});
    }

    // ── Sort ─────────────────────────────────────────────────────────────────

    /**
     * Sorts the view by a single property in the given direction.
     *
     * @param field - The field name to sort by.
     * @param dir - Optional. The sort direction; defaults to 'asc'.
     *
     * @returns A promise that resolves once the local view has been rebuilt.
     *
     * @remarks
     * When `remoteSort` is enabled, or when server-side pagination is enabled
     * (the legacy trigger), this method also resets the current page to 1 and
     * triggers a fire-and-forget reload. With `remoteSort` on, the active
     * sorters are serialized into [`ReadParams`](/api/data/interfaces/ReadParams) so the proxy receives the new
     * ordering; without it, a paginated reload still fires but sends only
     * `{page, pageSize}`. Fires `'sortchanged'` and `'datachanged'`.
     */
    sort(field: string, dir?: 'asc' | 'desc'): Promise<void>;
    /**
     * Applies a multi-column sort. Pass an empty array to clear all sorters.
     *
     * @param descriptors - The ordered list of sort descriptors. Earlier
     *   descriptors take priority.
     *
     * @returns A promise that resolves once the local view has been rebuilt.
     *
     * @remarks
     * Mirrors the single-column overload's pagination side effects when
     * server-side pagination is enabled.
     */
    sort(descriptors: SortDescriptor[]): Promise<void>;
    sort(fieldOrDescriptors: string | SortDescriptor[], dir: 'asc' | 'desc' = 'asc'): Promise<void> {
        if (typeof fieldOrDescriptors === 'string') {
            this._activeSorters = [{ field: fieldOrDescriptors, dir }];
        } else {
            this._activeSorters = fieldOrDescriptors.slice();
        }

        const reload = this._remoteSort || this._pageSize != null;

        if (reload) {
            this._page = 1;
            this.emit('pagechanged', { page: this._page, pageSize: this._pageSize });
        }

        return this.applyView().then(() => {
            this.emit('sortchanged', { sorters: this.getActiveSorters() });
            this.emit('datachanged', {});

            if (reload) {
                void this.load();
            }
        });
    }

    /**
     * Returns a copy of all active sort descriptors in priority order.
     *
     * @returns A shallow-copy array of the active sort descriptors; empty when no sort is active.
     */
    getActiveSorters(): SortDescriptor[] {
        return this._activeSorters.map(s => ({ ...s }));
    }

    /**
     * Returns a copy of all active filter descriptors.
     *
     * @returns A shallow-copy array of the active filter descriptors; empty when no filter is active.
     */
    getActiveFilters(): FilterDescriptor[] {
        return this._activeFilters.map(f => ({ ...f }));
    }

    /**
     * Returns a copy of the primary active sorter config, or null if no sort is active.
     *
     * @returns The first active sorter mapped to the legacy `{ property, direction }` shape, or null.
     *
     * @deprecated Use {@link getActiveSorters} instead.
     */
    getActiveSorter(): { property: string; direction: 'asc' | 'desc' } | null {
        const first = this._activeSorters[0];

        return first ? { property: first.field, direction: first.dir } : null;
    }

    /**
     * Removes any active sort and restores insertion order, firing 'sortchanged' and 'datachanged'.
     *
     * @returns A promise that resolves once the local view has been rebuilt.
     */
    clearSort(): Promise<void> {
        this._activeSorters = [];

        return this.applyView().then(() => {
            this.emit('sortchanged', { sorters: [] });
            this.emit('datachanged', {});
        });
    }

    // ── Filter ───────────────────────────────────────────────────────────────

    /**
     * Adds an equality filter on a property and fires 'datachanged'.
     *
     * @param property - The field name to filter on.
     * @param value - The value a record's field must equal to pass the filter.
     *
     * @remarks
     * When `remoteFilter` is enabled, or when server-side pagination is enabled
     * (the legacy trigger), this also resets to page 1 and reloads. With
     * `remoteFilter` on, the active filters are serialized into [`ReadParams`](/api/data/interfaces/ReadParams) so
     * the proxy filters the result set.
     */
    filter(property: string, value: any): Promise<void> {
        this._activeFilters.push({ type: 'eq', field: property, value: value });

        return this.applyFilterChange();
    }

    /**
     * Adds a filter described by a serializable {@link FilterDescriptor}. Descriptors
     * cross the worker boundary cleanly (unlike arbitrary predicate functions), so
     * the same call works for in-process and worker-offloaded evaluation.
     *
     * @param descriptor - The filter descriptor to apply.
     *
     * @remarks
     * Mirrors {@link filter}'s reload side effects when `remoteFilter` or
     * server-side pagination is enabled.
     */
    filterBy(descriptor: FilterDescriptor): Promise<void> {
        this._activeFilters.push(descriptor);

        return this.applyFilterChange();
    }

    /**
     * Rebuilds the view after a filter mutation and, when `remoteFilter` or
     * pagination is enabled, resets to page 1 and triggers a reload.
     *
     * @returns A promise that resolves once the local view has been rebuilt.
     */
    private applyFilterChange(): Promise<void> {
        const reload = this._remoteFilter || this._pageSize != null;

        if (reload) {
            this._page = 1;
            this.emit('pagechanged', { page: this._page, pageSize: this._pageSize });
        }

        return this.applyView().then(() => {
            this.emit('datachanged', {});

            if (reload) {
                void this.load();
            }
        });
    }

    /**
     * Removes all active filters and fires 'datachanged'.
     *
     * @remarks
     * When `remoteFilter` is enabled, or when server-side pagination is enabled
     * (the legacy trigger), this method also resets the current page to 1 and
     * triggers a fire-and-forget reload so the proxy is queried without filter
     * context.
     */
    clearFilter(): Promise<void> {
        this._activeFilters = [];

        return this.applyFilterChange();
    }

    // ── Events ───────────────────────────────────────────────────────────────

    /**
     * Subscribes a listener to a store event. Listeners are invoked in
     * registration order when the matching event is emitted.
     *
     * @param event - The name of the store event to listen for.
     * @param listener - The callback function to invoke when the event fires.
     *
     * @returns This store, for method chaining.
     */
    on(event: StoreEvent, listener: StoreListener): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered store event listener. No-op if the
     * listener was never registered for the given event.
     *
     * @param event - The name of the store event the listener was registered for.
     * @param listener - The exact callback reference to remove.
     *
     * @returns This store, for method chaining.
     */
    off(event: StoreEvent, listener: StoreListener): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Notifies all listeners registered for an event, in registration order.
     *
     * @param event - The name of the event to emit.
     * @param payload - The data object passed to each listener.
     */
    protected emit(event: StoreEvent, payload: any): void {
        this._listeners.fire(event, payload);
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
        if (this._allRecords.length >= WORKER_THRESHOLD && StoreWorkerClient.isAvailable()) {
            return this.applyViewOnWorker();
        }

        let view = this._allRecords.slice();

        for (const descriptor of this._activeFilters) {
            view = view.filter(r => matchesFilter(r, descriptor));
        }

        if (this._activeSorters.length > 0) {
            view.sort((a, b) => {
                for (const { field, dir } of this._activeSorters) {
                    const av = a.get(field);
                    const bv = b.get(field);

                    if (av == null && bv == null) {
                        continue;
                    }

                    if (av == null) {
                        return 1;
                    }

                    if (bv == null) {
                        return -1;
                    }

                    const cmp = av < bv ? -1 : av > bv ? 1 : 0;

                    if (cmp !== 0) {
                        return dir === 'asc' ? cmp : -cmp;
                    }
                }

                return 0;
            });
        }

        this._records = view;

        return Promise.resolve();
    }

    /**
     * Worker-offloaded view rebuild for stores above WORKER_THRESHOLD. Ships a fresh
     * snapshot when allRecords has changed since the last dispatch, then asks the
     * worker for sorted/filtered indices into the snapshot, and maps those indices
     * back to the local ModelRecord array. The worker returns indices (not records)
     * because ModelRecord instances can't survive structured clone.
     *
     * @remarks
     * The worker protocol currently accepts only a single sorter, so on the
     * worker path multi-sort degrades to the primary (first) sorter. Datasets
     * below {@link WORKER_THRESHOLD} run in-process and apply the full
     * multi-key comparator.
     */
    private applyViewOnWorker(): Promise<void> {
        const snapshot = this._snapshotDirty
            ? StoreWorkerClient.snapshot(this._storeId, this._allRecords.map(r => r.getData()))
            : Promise.resolve();

        if (this._snapshotDirty) {
            this._snapshotDirty = false;
        }

        const allRecordsRef = this._allRecords;
        const primary       = this._activeSorters[0];

        return snapshot
            .then(() => StoreWorkerClient.sortFilter(
                this._storeId,
                primary
                    ? { field: primary.field, direction: primary.dir }
                    : undefined,
                this._activeFilters.length > 0
                    ? (this._activeFilters.length === 1
                        ? this._activeFilters[0]
                        : { type: 'and', filters: this._activeFilters })
                    : undefined,
            ))
            .then(indices => {
                // Guard against allRecords having been replaced while the worker ran.
                // If so, the indices reference stale data; trigger a fresh applyView.
                if (allRecordsRef !== this._allRecords) {
                    return this.applyView();
                }

                this._records = indices.map(i => this._allRecords[i]);
                return undefined;
            });
    }
}
