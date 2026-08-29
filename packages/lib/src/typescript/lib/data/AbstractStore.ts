// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractModel } from '~/data/AbstractModel.js';
import { ModelRecord, type FieldChange } from '~/data/ModelRecord.js';
import { Proxy, ReadParams } from '~/data/proxy/Proxy.js';
import { FilterDescriptor, matchesFilter } from '~/data/FilterDescriptor.js';
import { StoreWorkerClient } from '~/data/StoreWorkerClient.js';
import { compareValues } from '~/data/compareValues.js';
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
export type StoreEvent = 'load' | 'beforeload' | 'datachange' | 'add' | 'remove' | 'clear' | 'beforesync' | 'sync' | 'exception' | 'loadingchange' | 'pagechange' | 'pagechangeblocked' | 'sortchange' | 'filterchange' | 'update' | 'groupchange';

/**
 * The proxy operation that failed in a {@link StoreExceptionEvent}.
 *
 * @category Data
 */
export type StoreOperation = 'read' | 'create' | 'update' | 'destroy';

/**
 * Payload for the `'exception'` event, fired when a `load()` read or a `sync()`
 * create/update/destroy fails.
 *
 * @remarks
 * `operation` disambiguates which proxy op failed; `records` carries the
 * offending record(s) — the batch or single record whose op failed — and is
 * empty for a `read` failure. `error` is the raw thrown value.
 *
 * @category Data
 */
export interface StoreExceptionEvent {
    operation: StoreOperation;
    records  : ModelRecord[];
    error    : unknown;
}

/**
 * Payload for the `'clear'` event fired by {@link AbstractStore.removeAll}.
 *
 * @category Data
 */
export interface StoreClearEvent {
    removed: ModelRecord[];
}

/**
 * Payload for the `'filterchange'` event fired when the active filter list is
 * replaced or cleared.
 *
 * @category Data
 */
export interface StoreFilterChangeEvent {
    filters: FilterDescriptor[];
}

/**
 * Payload for the `'update'` event fired by {@link AbstractStore.notifyRecordChanged}.
 *
 * @category Data
 */
export interface StoreUpdateEvent {
    record: ModelRecord;
    /**
     * Field-level diff of the change, keyed by field name. Carried by both the
     * single-`set()` auto-notify and a record edit-batch commit; absent only when
     * a caller invokes {@link AbstractStore.notifyRecordChanged} with no diff.
     */
    changes?: Record<string, FieldChange>;
}

/**
 * Summary payload for the `'sync'` event: the per-op failures recorded during
 * the just-finished `sync()`, empty when every operation succeeded.
 *
 * @category Data
 */
export interface StoreSyncEvent {
    failures: StoreExceptionEvent[];
}

/**
 * Payload for the `'groupchange'` event fired when {@link AbstractStore.setGroupField}
 * changes the active group field.
 *
 * @category Data
 */
export interface StoreGroupChangeEvent {
    groupField: string | null;
}

/**
 * Describes one column's contribution to a multi-column sort.
 *
 * @category Data
 */
export interface SortDescriptor {
    field: string;
    dir  : 'asc' | 'desc';
    /**
     * Optional custom comparator returning the ascending-sense ordering of two
     * records. Main-thread only: a function cannot cross the structured-clone
     * boundary, so a sorter carrying a `sorterFn` forces {@link AbstractStore}'s
     * in-process sort path even for datasets above the worker threshold.
     */
    sorterFn?: (a: ModelRecord, b: ModelRecord) => number;
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
    remoteFilter?: boolean;
    autoLoad?:    boolean;
    syncErrorPolicy?: 'stop' | 'continue';
    groupField?:  string;
    cascadeSync?: boolean;
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
 * The store's listener bag needs no teardown hook. Nothing in the framework holds a
 * store instance — there is no module-level store registry, and the shared sort/filter
 * worker keys its snapshots by a plain string id with no back-reference — so a discarded
 * store's bag is collected with it. The retention that does matter runs the other way: a
 * long-lived store holding a subscription a destroyed component never removed. That is
 * released by each component's own `destructor()` calling `store.off(…)`, not by anything
 * the store could do.
 *
 * @category Data
 */
export abstract class AbstractStore {

    abstract readonly model: AbstractModel;
    abstract readonly proxy: Proxy | undefined;

    private _allRecords: ModelRecord[] = [];
    private _records: ModelRecord[] = [];
    // Whether the most recent applyView() offloaded to the worker (so `_records`
    // is populated only when its promise resolves, not synchronously). Read right
    // after an ingestRaw() to decide whether the 'load' emit must wait for the
    // view. See applyView / loadData.
    private _viewAsync: boolean = false;
    private _pendingRemoved: ModelRecord[] = [];
    // Keyed so a single column's filter can be replaced without stacking a new
    // entry per keystroke and without touching another column's filter. Entries
    // added by `filter()` / `filterBy()` / the `filters` option are keyed by a
    // fresh `Symbol()`, which can never collide with a string key passed to
    // `setFilter`; a `Map` preserves insertion order for both key kinds, and
    // re-setting an existing key keeps its original position instead of
    // reordering it to the end.
    private _activeFilters: Map<string | symbol, FilterDescriptor> = new Map();
    private _activeSorters: SortDescriptor[] = [];
    private _listeners: ListenerBag<StoreEvent> = new ListenerBag<StoreEvent>();

    // id → record index over `_allRecords`, rebuilt by `rebuildIdIndex()` on
    // every `applyView()` so `getById()` is O(1). Stays empty (so getById returns
    // undefined) when the model has no primary key.
    private _idIndex: Map<any, ModelRecord> = new Map();

    // Active single-level group field, or null when grouping is off. Read by
    // `getGroupString()` / `getGroups()`; set via `setGroupField()`.
    private _groupField: string | null = null;

    // Worker-offload state. Each store gets a unique id so the shared worker can
    // keep snapshots from different stores apart. `snapshotDirty` flags whether
    // the worker's copy of allRecords is stale (re-shipped on the next applyView
    // when the dataset is over the threshold).
    private _storeId: string = 'store-' + (nextStoreId++);
    private _snapshotDirty: boolean = true;
    private _loading: boolean = false;

    // Store-level edit-batch flag. While set, owned records suppress their own
    // auto-notify (consulted through their back-ref by ModelRecord.set()); the
    // matching commitEdit() fires a single coalesced 'datachange'.
    private _batching: boolean = false;

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

    // Controls what sync() does after an op fails: 'stop' aborts the remaining
    // sync (already-committed records stay committed; failed/untouched records
    // remain pending), 'continue' records the failure and proceeds.
    private _syncErrorPolicy: 'stop' | 'continue' = 'stop';

    // When true (default), sync() walks each parent record's materialised hasMany
    // child stores after the parent creates/updates resolve, stamping the parent
    // foreign key and cascading the child store's own sync(). Set false to opt a
    // store out of the cascade.
    private _cascadeSync: boolean = true;

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
            for (const f of options.filters) {
                this._activeFilters.set(Symbol(), f);
            }
        }

        if (options.remoteSort !== undefined) {
            this._remoteSort = options.remoteSort;
        }

        if (options.remoteFilter !== undefined) {
            this._remoteFilter = options.remoteFilter;
        }

        if (options.syncErrorPolicy !== undefined) {
            this._syncErrorPolicy = options.syncErrorPolicy;
        }

        if (options.cascadeSync !== undefined) {
            this._cascadeSync = options.cascadeSync;
        }

        if (options.groupField !== undefined) {
            this.setGroupField(options.groupField);
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
     *
     * Fires `'beforeload'` before the proxy read. A read failure emits an
     * `'exception'` event ({@link StoreExceptionEvent} with `operation: 'read'`
     * and empty `records`) and then re-throws so existing `await store.load()`
     * call sites still observe the rejection. An aborted or superseded load is a
     * silent no-op and emits neither `'exception'` nor `'load'`.
     */
    async load(): Promise<void> {
        if (!this.proxy) {
            throw new Error('Store.load() called but no proxy is configured');
        }

        this.emit('beforeload', {});

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

            // Await the view build so a worker-offloaded sort/filter has
            // populated `_records` before 'load' fires; below the worker
            // threshold this resolves synchronously. load() is already async, so
            // there is no caller-visible timing change.
            await this.ingestRaw(raw);

            this._totalCount = this.proxy.getLastTotalCount();

            this.emit('load', { records: this._records });
        } catch (err) {
            // An aborted fetch or a superseded load is a silent no-op; only a
            // genuine failure from the current load emits 'exception' and
            // propagates to the awaiter.
            if ((err as Error).name === 'AbortError' || seq !== this._loadSeq) {
                return;
            }

            this.emit('exception', { operation: 'read', records: [], error: err });

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

        if (this._remoteFilter && this._activeFilters.size > 0) {
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
     * Sets the loading flag and fires `'loadingchange'` only when the value actually changes.
     *
     * @param value - The new loading state.
     */
    private setLoading(value: boolean): void {
        if (this._loading === value) {
            return;
        }

        this._loading = value;
        this.emit('loadingchange', { loading: value });
    }

    /**
     * Loads raw data directly without going through the proxy, then fires 'load'.
     *
     * @param data - An array of plain objects to convert into ModelRecords.
     */
    loadData(data: any[]): void {
        const pending = this.ingestRaw(data);

        // When applyView built the view synchronously (below the worker
        // threshold, or no worker available) `_records` is already populated, so
        // emit 'load' synchronously — consumers and tests rely on that timing.
        // When it offloaded to the worker, `_records` is not ready yet; defer the
        // emit until the worker resolves so listeners never render an empty view.
        if (this._viewAsync) {
            void pending.then(() => this.emit('load', { records: this._records }));
        } else {
            this.emit('load', { records: this._records });
        }
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
     * Fires `'pagechange'`.
     */
    setPageSize(n: number): this {
        this._pageSize = n;
        this._page = 1;
        this.emit('pagechange', { page: this._page, pageSize: this._pageSize });

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
     * sync or reject before leaving the page. Otherwise fires `'pagechange'`
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
        this.emit('pagechange', { page: this._page, pageSize: this._pageSize });
        void this.load();
    }

    /**
     * Returns to the previous page and reloads, unless already on page 1.
     *
     * @remarks
     * Blocked when the store has pending changes — emits `'pagechangeblocked'`
     * instead of firing `'pagechange'`.
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
        this.emit('pagechange', { page: this._page, pageSize: this._pageSize });
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
        this.emit('pagechange', { page: this._page, pageSize: this._pageSize });
        void this.load();

        return this;
    }

    /**
     * Converts raw objects to ModelRecords and rebuilds the filtered/sorted view.
     *
     * @param data - An array of plain objects to convert via the model's `createRecord`.
     *
     * @remarks
     * A reload replaces the store's contents with a fresh authoritative snapshot,
     * so any removal queued against the previous snapshot is discarded — its target
     * may not exist in the new data, and letting it fire on the next `sync()` would
     * destroy a server row the user never asked to delete. The queued records were
     * already ownership-released by `remove()`, so clearing the array suffices.
     */
    private ingestRaw(data: any[]): Promise<void> {
        this.setOwnership(this._allRecords, false);
        this._allRecords = data.map(item => this.model.createRecord(item));
        this.setOwnership(this._allRecords, true);
        this._pendingRemoved = [];
        this._snapshotDirty = true;

        return this.applyView();
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
     *
     * @remarks This is the store's **count aggregate** — the number of rows the
     * view exposes after filtering. There is no separate `count()` method;
     * `getCount()` fills that role, consistent with {@link sum} / {@link average}
     * / {@link min} / {@link max} operating over the same filtered view.
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
     *
     * @remarks O(1): backed by an internal id→record index that is refreshed on
     * every `applyView()`, so it tracks every mutation of the master list.
     * Returns undefined when the model defines no primary key (the index stays
     * empty).
     */
    getById(id: any): ModelRecord | undefined {
        return this._idIndex.get(id);
    }

    /**
     * Returns the position of a record within the filtered view.
     *
     * @param record - The record to locate.
     *
     * @returns The zero-based index in the view, or -1 when the record is not
     *   in the current view (filtered out or absent).
     */
    indexOf(record: ModelRecord): number {
        return this._records.indexOf(record);
    }

    /**
     * Returns an inclusive slice of the filtered view between two indices.
     *
     * @param start - The first index to include; clamped up to 0.
     * @param end - The last index to include; clamped down to the final index.
     *
     * @returns A shallow-copy array of the records in `[start, end]`; empty when
     *   the clamped range is empty.
     */
    getRange(start: number, end: number): ModelRecord[] {
        const lo = Math.max(0, start);
        const hi = Math.min(end, this._records.length - 1);

        if (hi < lo) {
            return [];
        }

        return this._records.slice(lo, hi + 1);
    }

    /**
     * Returns the first record in the filtered view.
     *
     * @returns The record at view index 0, or undefined when the view is empty.
     */
    first(): ModelRecord | undefined {
        return this._records[0];
    }

    /**
     * Returns the last record in the filtered view.
     *
     * @returns The record at the final view index, or undefined when the view is empty.
     */
    last(): ModelRecord | undefined {
        return this._records[this._records.length - 1];
    }

    /**
     * Invokes a callback for each record in the filtered view, in view order.
     *
     * @param fn - The callback applied to each record and its view index.
     */
    each(fn: (record: ModelRecord, index: number) => void): void {
        this._records.forEach((record, index) => fn(record, index));
    }

    /**
     * Returns whether a record is present in the filtered view.
     *
     * @param record - The record to test for membership.
     *
     * @returns True when the record is in the current view.
     */
    contains(record: ModelRecord): boolean {
        return this._records.includes(record);
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
     * Adds one or more records (marked as new), updates the view, and fires 'add'/'datachange'.
     *
     * @param data - A single plain object or an array of plain objects to add.
     *
     * @returns An array of the newly created ModelRecord instances.
     */
    add(data: any | any[]): ModelRecord[] {
        return this.insertAt(null, data);
    }

    /**
     * Inserts one or more records (marked as new) into the master list at a
     * clamped position, rebuilds the view, and fires 'add'/'datachange'.
     *
     * @param index - The target position in the master list; clamped to
     *   `[0, allRecords.length]`.
     * @param data - A single plain object or an array of plain objects to insert.
     *
     * @returns An array of the newly created ModelRecord instances.
     *
     * @remarks
     * Mirrors {@link add} but splices at `index` instead of appending. The
     * insertion position is into the master list; the visible position in the
     * view still depends on any active sort and filter.
     */
    insert(index: number, data: any | any[]): ModelRecord[] {
        return this.insertAt(index, data);
    }

    /**
     * Shared body of {@link add} and {@link insert}: creates records marked new,
     * places them in the master list, rebuilds the view, and fires 'add' then
     * 'datachange'.
     *
     * @param index - `null` appends to the master list; a number splices at the
     *   position clamped to `[0, allRecords.length]`.
     * @param data - A single plain object or an array of plain objects.
     *
     * @returns An array of the newly created ModelRecord instances.
     */
    private insertAt(index: number | null, data: any | any[]): ModelRecord[] {
        const items = Array.isArray(data) ? data : [data];
        const added = items.map(item => {
            const record = this.model.createRecord(item);

            record.markAsNew();

            return record;
        });

        if (index === null) {
            this._allRecords.push(...added);
        } else {
            const at = Math.max(0, Math.min(index, this._allRecords.length));

            this._allRecords.splice(at, 0, ...added);
        }

        this.setOwnership(added, true);
        this._snapshotDirty = true;
        this.applyView();

        this.emit('add', { records: added });
        this.emit('datachange', {});

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
        this.setOwnership([record], false);
        this._snapshotDirty = true;

        if (!record.isNew()) {
            this._pendingRemoved.push(record);
        }

        this.applyView();

        this.emit('remove', { record });
        this.emit('datachange', {});

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
        const removed = this._allRecords.slice();

        this._pendingRemoved.push(...this._allRecords.filter(r => !r.isNew()));

        this.setOwnership(removed, false);
        this._allRecords = [];
        this._snapshotDirty = true;
        this.applyView();

        this.emit('clear', { removed });
        this.emit('datachange', {});

        return this;
    }

    /**
     * Appends already-committed records to the master list and rebuilds the
     * view, without marking them new or firing `'add'`.
     *
     * @param records - The records to append; they keep their committed state.
     *
     * @remarks
     * The lazy-load seam for {@link TreeStore}: children fetched on a node
     * expand are server-backed (not pending inserts), so they bypass the
     * new-record path of {@link add}. This is the only sanctioned way for a
     * subclass to grow the master list with committed records.
     */
    protected appendRecords(records: ModelRecord[]): void {
        this._allRecords.push(...records);
        this.setOwnership(records, true);
        this._snapshotDirty = true;
        this.applyView();
    }

    /**
     * Signals that a record's fields were mutated outside the store's own
     * mutation methods (e.g. an in-cell edit in a Table).
     *
     * @param record - The record that was edited; carried on the `'update'`
     *   event so listeners can identify it.
     * @param changes - Optional. The field-level diff of the change, carried on
     *   the `'update'` event for listeners that want per-field granularity.
     *
     * @remarks
     * Fires `'update'` ({@link StoreUpdateEvent}) followed by `'datachange'` so
     * listeners (toolbars, pagination bars, etc.) re-evaluate state such as
     * {@link hasPendingChanges}. A store-owned record calls this automatically
     * from `set()`; it remains public for the standalone/manual case (an unowned
     * record, or forcing a refresh).
     */
    notifyRecordChanged(record: ModelRecord, changes?: Record<string, FieldChange>): void {
        this.emit('update', { record, changes });
        this.emit('datachange', {});
    }

    /**
     * Opens a store-level edit batch: owned records suppress their own
     * auto-notify until the matching {@link commitEdit}.
     *
     * @returns This store, for method chaining.
     *
     * @remarks
     * The coarse counterpart to a record edit batch — use it to mutate many
     * records and refresh bound views once. Records reach this flag through their
     * back-ref. Not nested by any framework caller, so the flag is a plain
     * boolean rather than a depth counter.
     */
    beginEdit(): this {
        this._batching = true;

        return this;
    }

    /**
     * Closes a store-level edit batch and fires a single `'datachange'` so bound
     * views refresh once for the whole batch.
     *
     * @returns This store, for method chaining.
     *
     * @remarks
     * Deliberately emits only `'datachange'`, not per-record `'update'`s:
     * replaying every record's update would defeat the coalescing the batch
     * exists to provide. Use a record edit batch when per-record granularity is
     * needed.
     */
    commitEdit(): this {
        this._batching = false;

        this.emit('datachange', {});

        return this;
    }

    /**
     * Reports whether a store-level edit batch is currently open.
     *
     * @returns True while a {@link beginEdit} batch is open.
     *
     * @internal Framework wiring; consulted by an owned record's `set()` through
     *   its back-ref to decide whether to suppress its auto-notify.
     */
    isBatching(): boolean {
        return this._batching;
    }

    /**
     * Stamps or clears the owning-store back-ref on a set of records as they
     * enter or leave this store's master list.
     *
     * @param records - The records joining or leaving the master list.
     * @param owned - True to adopt the records into this store, false to release.
     *
     * @remarks
     * The single seam that keeps {@link ModelRecord}'s auto-notify back-ref in
     * step with `_allRecords` membership. Called at every site that grows or
     * shrinks the master list.
     */
    private setOwnership(records: ModelRecord[], owned: boolean): void {
        for (const record of records) {
            if (owned) {
                record.adoptedBy(this);
            } else {
                record.released();
            }
        }
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
     * and restores pending removals — then fires 'datachange'.
     *
     * @remarks
     * Pending removals are pushed back into `allRecords` (in their original
     * order is not preserved; they are appended) so the user can recover from
     * an accidental removal. Dirty records are restored to their last
     * committed values. New records are dropped outright since they were never
     * persisted.
     */
    reject(): void {
        const previouslyOwned = this._allRecords;
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

        // Release everyone who was owned (survivors + dropped new records), then
        // re-adopt the final set: dropped new records stay released, restored
        // pending-removals (released by remove()) are re-adopted.
        this.setOwnership(previouslyOwned, false);
        this.setOwnership(survivors, true);

        this._snapshotDirty = true;
        this.applyView();

        this.emit('datachange', {});
    }

    /**
     * Persists new, dirty, and removed records via the proxy, then fires 'sync'/'datachange'.
     *
     * @returns A promise that resolves when the sync run has settled.
     *
     * @remarks
     * Sync is a no-op when no proxy is configured. Operations run in order:
     * creates first, then updates, then deletes — and use the proxy's optional
     * batch hooks ({@link Proxy.createBatch}/{@link Proxy.updateBatch}/{@link Proxy.destroyBatch})
     * when present, falling back to one request per record otherwise. Each record
     * is committed only after its own op succeeds, so a record never appears
     * committed unless the server accepted it.
     *
     * **Contract change:** `sync()` no longer rejects on a transport failure. A
     * failed op emits an `'exception'` event ({@link StoreExceptionEvent}) and is
     * recorded; `sync()` always resolves and fires `'sync'` with a
     * {@link StoreSyncEvent} listing the failures. The `syncErrorPolicy` option
     * controls what happens after the first failure: `'stop'` (default) aborts
     * the remaining sync (already-committed records stay committed; failed and
     * untouched records remain pending for the next `sync()`), `'continue'`
     * proceeds through every record/batch. Callers that previously relied on a
     * rejected promise should switch to the `'exception'` event or the `'sync'`
     * payload's `failures`.
     */
    async sync(): Promise<void> {
        const proxy = this.proxy;

        if (!proxy) {
            return;
        }

        this.emit('beforesync', {});

        const failures: StoreExceptionEvent[] = [];

        // Each phase returns true when the run should stop early ('stop' policy
        // after a failure); the || chain then short-circuits the later phases.
        // Under 'continue' every phase returns false and all phases run. The
        // hasMany cascade runs after creates/updates resolve (so parents carry
        // their server ids) and before deletes (children sync before the parent
        // is removed); a stopped run skips it like any later phase.
        const stopped = await this.syncCreates(proxy, failures)
            || await this.syncUpdates(proxy, failures);

        if (!stopped) {
            await this.syncCascade();

            await this.syncDeletes(proxy, failures);
        }

        this.emit('sync', { failures });
        this.emit('datachange', {});
    }

    /**
     * Cascades persistence into each parent record's materialised hasMany child
     * stores: stamps the parent foreign key onto every child, then runs the
     * child store's own `sync()`.
     *
     * @returns A promise that resolves when every cascaded child sync has settled.
     *
     * @remarks
     * No-op when `cascadeSync` is disabled. Only associations whose child store
     * was actually built (via {@link ModelRecord.getAssociated}) are walked, so a
     * loaded-but-untouched parent costs nothing. Reusing the child store's own
     * `sync()` means child `'exception'` events, `syncErrorPolicy`, and batch
     * behaviour all apply to the cascade unchanged; failures surface on the child
     * store's own event surface, not the parent's `'sync'` payload.
     */
    private async syncCascade(): Promise<void> {
        if (!this._cascadeSync) {
            return;
        }

        for (const parent of this._allRecords) {
            for (const association of parent.getModel().getAssociations()) {
                if (association.kind !== 'hasMany' || !parent.hasChildStore(association.getAccessor())) {
                    continue;
                }

                const child = parent.getAssociated(association.getAccessor());

                this.stampForeignKeys(child, association.getForeignKey(), parent);

                await child.sync();
            }
        }
    }

    /**
     * Stamps the parent's id onto the foreign-key field of every record in a
     * hasMany child store, so a child created against a brand-new parent picks up
     * the real server id before it is itself persisted.
     *
     * @param child - The parent-scoped child store.
     * @param foreignKey - The child field that holds the owner's id.
     * @param parent - The owning record, whose `getId()` supplies the FK value.
     *
     * @remarks
     * `set()` is a no-op when the value already matches, so a child added to an
     * already-persisted parent (already carrying the correct FK) is untouched.
     * When the parent still has no id (its create failed or was skipped), the
     * stamp writes `undefined` and the child is not falsely re-keyed.
     */
    private stampForeignKeys(child: AbstractStore, foreignKey: string, parent: ModelRecord): void {
        const parentId = parent.getId();

        if (parentId === undefined) {
            return;
        }

        for (const record of child.getAll()) {
            record.setSilent(foreignKey, parentId);
        }
    }

    /**
     * Persists the new records, by batch when the proxy advertises
     * {@link Proxy.createBatch}, else one {@link Proxy.create} per record.
     *
     * @param proxy - The configured proxy.
     * @param failures - The accumulator that collects this run's op failures.
     *
     * @returns True when the run should stop early (policy `'stop'` and this
     *   phase recorded a failure).
     */
    private async syncCreates(proxy: Proxy, failures: StoreExceptionEvent[]): Promise<boolean> {
        const created = this._allRecords.filter(r => r.isNew());

        if (created.length === 0) {
            return false;
        }

        if (proxy.createBatch) {
            return this.runBatch('create', created, failures, records => proxy.createBatch!(records));
        }

        return this.runPerRecord('create', created, failures, record => proxy.create(record));
    }

    /**
     * Persists the dirty (non-new) records, by batch when the proxy advertises
     * {@link Proxy.updateBatch}, else one {@link Proxy.update} per record.
     *
     * @param proxy - The configured proxy.
     * @param failures - The accumulator that collects this run's op failures.
     *
     * @returns True when the run should stop early.
     */
    private async syncUpdates(proxy: Proxy, failures: StoreExceptionEvent[]): Promise<boolean> {
        const dirty = this._allRecords.filter(r => r.isDirty() && !r.isNew());

        if (dirty.length === 0) {
            return false;
        }

        if (proxy.updateBatch) {
            return this.runBatch('update', dirty, failures, records => proxy.updateBatch!(records));
        }

        return this.runPerRecord('update', dirty, failures, record => proxy.update(record));
    }

    /**
     * Destroys the pending-removed records, by batch when the proxy advertises
     * {@link Proxy.destroyBatch}, else one {@link Proxy.destroy} per record.
     * Only successfully-destroyed records are cleared from the pending queue.
     *
     * @param proxy - The configured proxy.
     * @param failures - The accumulator that collects this run's op failures.
     *
     * @returns True when the run should stop early.
     */
    private async syncDeletes(proxy: Proxy, failures: StoreExceptionEvent[]): Promise<boolean> {
        // Snapshot the queue so a failure's 'exception' payload holds an immutable
        // copy (matching the create/update phases, whose filter() returns a fresh
        // array) rather than aliasing the live _pendingRemoved array.
        const removed = this._pendingRemoved.slice();

        if (removed.length === 0) {
            return false;
        }

        if (proxy.destroyBatch) {
            try {
                await proxy.destroyBatch(removed);
                this._pendingRemoved = [];

                return false;
            } catch (err) {
                return this.recordFailure('destroy', removed, err, failures);
            }
        }

        const survivors: ModelRecord[] = [];
        let stopped = false;

        for (const record of removed) {
            if (stopped) {
                survivors.push(record);
                continue;
            }

            try {
                await proxy.destroy(record);
            } catch (err) {
                survivors.push(record);
                stopped = this.recordFailure('destroy', [record], err, failures);
            }
        }

        this._pendingRemoved = survivors;

        return stopped;
    }

    /**
     * Runs a create/update batch op, committing every record positionally from
     * the server response, or recording one failure for the whole batch.
     *
     * @param operation - The op kind, for the failure payload.
     * @param records - The batch's records, in request order.
     * @param failures - The accumulator that collects this run's op failures.
     * @param call - Issues the batch request and resolves to per-record server data in input order.
     *
     * @returns True when the run should stop early.
     */
    private async runBatch(operation: 'create' | 'update', records: ModelRecord[], failures: StoreExceptionEvent[], call: (records: ModelRecord[]) => Promise<Record<string, any>[]>): Promise<boolean> {
        try {
            const serverData = await call(records);

            records.forEach((record, i) => {
                this.commitFromServerData(record, serverData[i] ?? {});
            });

            return false;
        } catch (err) {
            return this.recordFailure(operation, records, err, failures);
        }
    }

    /**
     * Runs a create/update op one record at a time, committing each on success
     * and recording a per-record failure otherwise.
     *
     * @param operation - The op kind, for the failure payload.
     * @param records - The records to persist, in order.
     * @param failures - The accumulator that collects this run's op failures.
     * @param call - Issues a single-record request and resolves to that record's server data.
     *
     * @returns True when the run should stop early.
     */
    private async runPerRecord(operation: 'create' | 'update', records: ModelRecord[], failures: StoreExceptionEvent[], call: (record: ModelRecord) => Promise<Record<string, any>>): Promise<boolean> {
        for (const record of records) {
            try {
                const serverData = await call(record);

                this.commitFromServerData(record, serverData);
            } catch (err) {
                if (this.recordFailure(operation, [record], err, failures)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Applies a server response onto a record and commits it, so the record
     * drops out of subsequent sync cycles.
     *
     * @param record - The record that was persisted.
     * @param serverData - The server's representation of the record.
     */
    private commitFromServerData(record: ModelRecord, serverData: Record<string, any>): void {
        for (const [k, v] of Object.entries(serverData)) {
            record.setSilent(k, v);
        }

        record.commit();
    }

    /**
     * Records an op failure: pushes a {@link StoreExceptionEvent} onto the run's
     * accumulator, emits `'exception'`, and reports whether the run should stop.
     *
     * @param operation - The op kind that failed.
     * @param records - The offending record(s).
     * @param error - The raw thrown value.
     * @param failures - The accumulator that collects this run's op failures.
     *
     * @returns True when `syncErrorPolicy` is `'stop'` (so the caller halts).
     */
    private recordFailure(operation: StoreOperation, records: ModelRecord[], error: unknown, failures: StoreExceptionEvent[]): boolean {
        const failure: StoreExceptionEvent = { operation, records, error };

        failures.push(failure);
        this.emit('exception', failure);

        return this._syncErrorPolicy === 'stop';
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
     * `{page, pageSize}`. Fires `'sortchange'` and `'datachange'`.
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
     * Mirrors the single-column overload's reload side effects when `remoteSort`
     * or server-side pagination is enabled.
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
            this.emit('pagechange', { page: this._page, pageSize: this._pageSize });
        }

        return this.applyView().then(() => {
            this.emit('sortchange', { sorters: this.getActiveSorters() });
            this.emit('datachange', {});

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
        return [...this._activeFilters.values()].map(f => ({ ...f }));
    }

    /**
     * Removes any active sort and restores insertion order, firing 'sortchange' and 'datachange'.
     *
     * @returns A promise that resolves once the local view has been rebuilt.
     */
    clearSort(): Promise<void> {
        this._activeSorters = [];

        return this.applyView().then(() => {
            this.emit('sortchange', { sorters: [] });
            this.emit('datachange', {});
        });
    }

    // ── Filter ───────────────────────────────────────────────────────────────

    /**
     * Adds an equality filter on a property and fires 'datachange'.
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
        this._activeFilters.set(Symbol(), { type: 'eq', field: property, value: value });

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
        this._activeFilters.set(Symbol(), descriptor);

        return this.applyFilterChange();
    }

    /**
     * Replaces (or removes, when `descriptor` is `null`) the single filter
     * stored under `key`, without disturbing any other active filter —
     * keyed or anonymous. Intended for a UI surface with one filter per
     * identity (e.g. one text input per table column), where re-typing
     * must replace that column's descriptor rather than stack a new one
     * per keystroke.
     *
     * @param key - Identifies the filter slot to replace. A caller-chosen
     *   key (e.g. a field name) can never collide with the `Symbol()` keys
     *   {@link filter} / {@link filterBy} / the `filters` option generate.
     * @param descriptor - The new filter descriptor, or `null` to remove
     *   whatever descriptor is currently stored under `key`.
     *
     * @remarks
     * Reload behaviour is identical to {@link filterBy}'s: when `remoteFilter`
     * is enabled, or when server-side pagination is enabled (the legacy
     * trigger), this also resets to page 1 and reloads.
     */
    setFilter(key: string, descriptor: FilterDescriptor | null): Promise<void> {
        if (descriptor === null) {
            this._activeFilters.delete(key);
        } else {
            this._activeFilters.set(key, descriptor);
        }

        return this.applyFilterChange();
    }

    /**
     * Replaces (or removes) several keyed filters in one pass, rebuilding the
     * view and firing its change events exactly once for the whole batch
     * rather than once per entry. Intended for a UI surface that changes more
     * than one column's filter in the same user action — e.g. hiding a
     * table's filter row, which must clear every column's descriptor
     * together. Calling {@link setFilter} once per key instead would still be
     * correct, but fires one reload per call whenever `remoteFilter` or
     * pagination is enabled, turning an N-column clear into N sequential
     * round-trips.
     *
     * @param entries - The `[key, descriptor]` pairs to apply, in order. A
     *   `null` descriptor removes whatever is stored under that key, exactly
     *   like a `null` argument to {@link setFilter}.
     *
     * @returns A promise that resolves once the local view has been rebuilt.
     *
     * @remarks
     * Reload behaviour mirrors {@link setFilter}'s: when `remoteFilter` is
     * enabled, or when server-side pagination is enabled (the legacy
     * trigger), this also resets to page 1 and reloads — once, regardless of
     * how many entries were passed.
     */
    setFilters(entries: Array<[key: string, descriptor: FilterDescriptor | null]>): Promise<void> {
        for (const [key, descriptor] of entries) {
            if (descriptor === null) {
                this._activeFilters.delete(key);
            } else {
                this._activeFilters.set(key, descriptor);
            }
        }

        return this.applyFilterChange();
    }

    /**
     * Returns the filter descriptor stored under `key` by {@link setFilter}.
     *
     * @param key - The key passed to {@link setFilter}.
     * @returns A shallow copy of the stored descriptor, or `null` when `key`
     *   holds no filter.
     */
    getFilter(key: string): FilterDescriptor | null {
        const descriptor = this._activeFilters.get(key);

        return descriptor ? { ...descriptor } : null;
    }

    /**
     * Rebuilds the view after a filter mutation, fires `'filterchange'` (with the
     * active filters) plus `'datachange'`, and, when `remoteFilter` or
     * pagination is enabled, resets to page 1 and triggers a reload.
     *
     * @returns A promise that resolves once the local view has been rebuilt.
     */
    private applyFilterChange(): Promise<void> {
        const reload = this._remoteFilter || this._pageSize != null;

        if (reload) {
            this._page = 1;
            this.emit('pagechange', { page: this._page, pageSize: this._pageSize });
        }

        return this.applyView().then(() => {
            this.emit('filterchange', { filters: this.getActiveFilters() });
            this.emit('datachange', {});

            if (reload) {
                void this.load();
            }
        });
    }

    /**
     * Removes all active filters and fires 'datachange'.
     *
     * @remarks
     * When `remoteFilter` is enabled, or when server-side pagination is enabled
     * (the legacy trigger), this method also resets the current page to 1 and
     * triggers a fire-and-forget reload so the proxy is queried without filter
     * context.
     */
    clearFilter(): Promise<void> {
        this._activeFilters.clear();

        return this.applyFilterChange();
    }

    // ── Aggregation ────────────────────────────────────────────────────────────

    /**
     * Collects the numeric, non-null values of a field across the filtered view.
     *
     * @param field - The field to read from each visible record.
     *
     * @returns The coerced numbers, skipping null/undefined and any value that
     *   does not coerce to a finite number.
     *
     * @remarks Shared by {@link sum} / {@link average} / {@link min} / {@link max};
     * `null`/`undefined` are skipped (never coerced to `0`) so an absent value
     * never distorts the result.
     */
    private numericValues(field: string): number[] {
        const values: number[] = [];

        for (const record of this._records) {
            const raw = record.get(field);

            if (raw == null) {
                continue;
            }

            const value = Number(raw);

            if (!Number.isNaN(value)) {
                values.push(value);
            }
        }

        return values;
    }

    /**
     * Sums a numeric field across the filtered view.
     *
     * @param field - The field to total.
     *
     * @returns The sum of the field's numeric values; `0` over an empty or
     *   all-null view.
     */
    sum(field: string): number {
        return this.numericValues(field).reduce((total, value) => total + value, 0);
    }

    /**
     * Averages a numeric field across the filtered view.
     *
     * @param field - The field to average.
     *
     * @returns The mean of the field's numeric values; `0` over an empty or
     *   all-null view.
     */
    average(field: string): number {
        const values = this.numericValues(field);

        if (values.length === 0) {
            return 0;
        }

        return values.reduce((total, value) => total + value, 0) / values.length;
    }

    /**
     * Returns the smallest value of a numeric field across the filtered view.
     *
     * @param field - The field to minimise.
     *
     * @returns The minimum numeric value, or undefined over an empty or
     *   all-null view.
     */
    min(field: string): number | undefined {
        const values = this.numericValues(field);

        if (values.length === 0) {
            return undefined;
        }

        return values.reduce((lowest, value) => value < lowest ? value : lowest);
    }

    /**
     * Returns the largest value of a numeric field across the filtered view.
     *
     * @param field - The field to maximise.
     *
     * @returns The maximum numeric value, or undefined over an empty or
     *   all-null view.
     */
    max(field: string): number | undefined {
        const values = this.numericValues(field);

        if (values.length === 0) {
            return undefined;
        }

        return values.reduce((highest, value) => value > highest ? value : highest);
    }

    /**
     * Collects the distinct values of a field across the filtered view, in
     * first-encounter (view) order.
     *
     * @param field - The field to collect distinct values from.
     *
     * @returns An array of unique values (by strict `===` identity), preserving
     *   the order in which they first appear in the view.
     *
     * @remarks The type-agnostic companion to the numeric aggregates: useful for
     * building a distinct-value filter list. Values are de-duplicated by strict
     * equality, so distinct object references are treated as distinct values.
     */
    collect(field: string): any[] {
        const seen = new Set<any>();
        const result: any[] = [];

        for (const record of this._records) {
            const value = record.get(field);

            if (!seen.has(value)) {
                seen.add(value);
                result.push(value);
            }
        }

        return result;
    }

    // ── Grouping ───────────────────────────────────────────────────────────────

    /**
     * Sets the single-level group field, firing 'groupchange' only on a real change.
     *
     * @param field - The field to group by, or null to disable grouping.
     *
     * @returns This store, for method chaining.
     *
     * @remarks
     * Grouping is a pure read over the existing view ({@link getGroups}), so
     * changing the group field does **not** rebuild the view or fire
     * `'datachange'`; it fires only `'groupchange'` ({@link StoreGroupChangeEvent}).
     */
    setGroupField(field: string | null): this {
        if (this._groupField === field) {
            return this;
        }

        this._groupField = field;
        this.emit('groupchange', { groupField: field });

        return this;
    }

    /**
     * Returns the active group field, or null when grouping is disabled.
     *
     * @returns The field set via {@link setGroupField}, or null.
     */
    getGroupField(): string | null {
        return this._groupField;
    }

    /**
     * Returns the group-bucket key for a record under the active group field.
     *
     * @param record - The record to derive a group key for.
     *
     * @returns `String(record.get(groupField))`, or `''` when no group field is
     *   set or the record's value is null/undefined.
     */
    getGroupString(record: ModelRecord): string {
        if (this._groupField == null) {
            return '';
        }

        const value = record.get(this._groupField);

        return value == null ? '' : String(value);
    }

    /**
     * Buckets the filtered view by the active group field.
     *
     * @returns A `Map` from group key ({@link getGroupString}) to the records in
     *   that group. Groups appear in first-encounter order, and records within a
     *   group keep view order. When no group field is set, every record falls
     *   under the single `''` key.
     */
    getGroups(): Map<string, ModelRecord[]> {
        const groups = new Map<string, ModelRecord[]>();

        for (const record of this._records) {
            const key = this.getGroupString(record);
            const bucket = groups.get(key);

            if (bucket) {
                bucket.push(record);
            } else {
                groups.set(key, [record]);
            }
        }

        return groups;
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
        this.rebuildIdIndex();

        if (this._allRecords.length >= WORKER_THRESHOLD && StoreWorkerClient.isAvailable() && !this.hasCustomSorter()) {
            this._viewAsync = true;

            return this.applyViewOnWorker();
        }

        this._viewAsync = false;

        let view = this._allRecords.slice();

        for (const descriptor of this._activeFilters.values()) {
            view = view.filter(r => matchesFilter(r, descriptor));
        }

        if (this._activeSorters.length > 0) {
            view.sort((a, b) => {
                for (const sorter of this._activeSorters) {
                    const cmp = this.compareBySorter(a, b, sorter);

                    if (cmp !== 0) {
                        return cmp;
                    }
                }

                return 0;
            });
        }

        this._records = view;

        return Promise.resolve();
    }

    /**
     * Compares two records under one sorter, applying its direction. A sorter
     * with a `sorterFn` delegates to it; otherwise the shared, type-aware
     * {@link compareValues} runs against the field values.
     *
     * @param a - The left record.
     * @param b - The right record.
     * @param sorter - The sorter whose `field`/`dir`/`sorterFn` drive the compare.
     *
     * @returns The final ordering: negative if `a` precedes `b`, positive if it
     *   follows, `0` if equal under this sorter.
     *
     * @remarks
     * Nulls sort last regardless of direction — when either field value is
     * null/undefined, the (un-negated) {@link compareValues} result is returned
     * so direction applies only to a non-null comparison, matching the worker's
     * `sortIndices`.
     */
    private compareBySorter(a: ModelRecord, b: ModelRecord, sorter: SortDescriptor): number {
        if (sorter.sorterFn) {
            const cmp = sorter.sorterFn(a, b);

            return sorter.dir === 'asc' ? cmp : -cmp;
        }

        const av  = a.get(sorter.field);
        const bv  = b.get(sorter.field);
        const cmp = compareValues(av, bv, this.model.getField(sorter.field)?.getType());

        if (av == null || bv == null) {
            return cmp;
        }

        return sorter.dir === 'asc' ? cmp : -cmp;
    }

    /**
     * Reports whether any active sorter carries a custom `sorterFn`.
     *
     * @returns True when at least one sorter has a `sorterFn`, which forces the
     *   in-process sort path (a function cannot cross the worker boundary).
     */
    private hasCustomSorter(): boolean {
        return this._activeSorters.some(sorter => sorter.sorterFn !== undefined);
    }

    /**
     * Rebuilds the id→record index from the master list so {@link getById} is
     * O(1). The index stays empty when the model defines no primary key.
     */
    private rebuildIdIndex(): void {
        this._idIndex.clear();

        if (!this.model.getPrimaryKeyField()) {
            return;
        }

        for (const record of this._allRecords) {
            this._idIndex.set(record.getId(), record);
        }
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
        const active        = [...this._activeFilters.values()];

        return snapshot
            .then(() => StoreWorkerClient.sortFilter(
                this._storeId,
                primary
                    ? { field: primary.field, direction: primary.dir, fieldType: this.model.getField(primary.field)?.getType() }
                    : undefined,
                active.length > 0
                    ? (active.length === 1
                        ? active[0]
                        : { type: 'and', filters: active })
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
