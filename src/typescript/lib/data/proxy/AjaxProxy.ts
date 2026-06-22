// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '~/data/ModelRecord.js';
import { Proxy, ReadParams } from '~/data/proxy/Proxy.js';
import { Reader, JsonReader } from '~/data/proxy/Reader.js';
import { Writer, JsonWriter } from '~/data/proxy/Writer.js';

/**
 * Construction-time options for {@link AjaxProxy}.
 *
 * @category Data
 */
export interface AjaxProxyOptions {
    url: string;
    root?: string;
    method?: 'GET' | 'POST';
    createMethod?: 'POST' | 'PUT';
    updateMethod?: 'PUT' | 'PATCH';
    headers?: Record<string, string>;
    reader?: Reader;
    writer?: Writer;
}

/**
 * @deprecated Use {@link AjaxProxyOptions}.
 */
export type AjaxProxyConfig = AjaxProxyOptions;

/**
 * A proxy that communicates with a remote HTTP/REST endpoint using the Fetch API.
 * Supports configurable HTTP methods and an optional root key for unwrapping responses.
 *
 * @remarks
 * Update and destroy requests are sent to `{url}/{id}` where `id` is the record's
 * primary key value. All four CRUD methods throw an `Error` when the server responds
 * with a non-OK status code.
 *
 * @category Data
 */
export class AjaxProxy extends Proxy {

    private _url: string;
    private _root: string | undefined;
    private _method: 'GET' | 'POST';
    private _createMethod: 'POST' | 'PUT';
    private _updateMethod: 'PUT' | 'PATCH';
    private _headers: Record<string, string>;
    private _reader: Reader;
    private _writer: Writer;
    private _lastTotalCount: number | undefined = undefined;

    /**
     * Constructs an AjaxProxy from the given options.
     *
     * @param options - The options object specifying the endpoint URL and HTTP options.
     */
    constructor(options: AjaxProxyOptions) {
        // Proxy has no options bag; fields are read from options directly below.
        // eslint-disable-next-line local/forward-super-options
        super();
        this._url = options.url;
        this._root = options.root;
        this._method = options.method ?? 'GET';
        this._createMethod = options.createMethod ?? 'POST';
        this._updateMethod = options.updateMethod ?? 'PUT';
        this._headers = options.headers ?? {};
        this._reader = options.reader ?? new JsonReader({ root: options.root });
        this._writer = options.writer ?? new JsonWriter();
    }

    /**
     * Fetches records from the configured URL, optionally with pagination.
     *
     * @param params - Optional. Pagination parameters from the store. When provided,
     *   `page` and `pageSize` are appended as query-string parameters and the
     *   response is parsed as a `{ data, total }` envelope.
     *
     * @returns A promise that resolves to an array of raw data objects from the server.
     *
     * @remarks
     * Unpaginated mode: when `params` is omitted, the response JSON is read as a
     * top-level array, or unwrapped via `root` if configured. An `Error` is thrown
     * for non-OK responses or unexpected response shapes.
     *
     * Paginated mode: when `params` carries `page` or `pageSize`, the request URL is
     * extended with `?page=N&pageSize=M`. The response is parsed by the configured
     * {@link Reader} as a `{ data, total }` envelope and the reported `total` is
     * stored and exposed via {@link getLastTotalCount}.
     *
     * When `params` carries `sorters`/`filters` (the store's `remoteSort`/`remoteFilter`
     * opt-in), they are appended as `sort=<json>` / `filter=<json>` query parameters.
     * A `signal` is threaded into `fetch` so a superseded read can be aborted.
     */
    async read(params?: ReadParams): Promise<any[]> {
        const paginated = params != null && (params.page != null || params.pageSize != null);

        const url = this.buildReadUrl(params);

        const response = await fetch(url, {
            method: this._method,
            headers: this._headers,
            signal: params?.signal
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: request failed with status ${response.status}`);
        }

        const json = await response.json();

        const result = this._reader.read(json, paginated);

        this._lastTotalCount = result.total;

        return result.records;
    }

    /**
     * Builds the request URL, appending `page`/`pageSize`/`sort`/`filter` query
     * parameters from the given read params when present.
     *
     * @param params - Optional. The read parameters carrying pagination and
     *   remote sort/filter descriptors.
     *
     * @returns The fully-qualified request URL.
     */
    private buildReadUrl(params?: ReadParams): string {
        if (params == null) {
            return this._url;
        }

        const search = new URLSearchParams();

        if (params.page != null) {
            search.set('page', String(params.page));
        }

        if (params.pageSize != null) {
            search.set('pageSize', String(params.pageSize));
        }

        if (params.sorters != null && params.sorters.length > 0) {
            search.set('sort', JSON.stringify(params.sorters));
        }

        if (params.filters != null && params.filters.length > 0) {
            search.set('filter', JSON.stringify(params.filters));
        }

        const query = search.toString();

        if (query === '') {
            return this._url;
        }

        const sep = this._url.includes('?') ? '&' : '?';

        return this._url + sep + query;
    }

    /**
     * Returns the total record count reported by the most recent paginated read.
     *
     * @returns The `total` value parsed from the last paginated response, or
     *   undefined if no paginated read has occurred or the server omitted it.
     */
    getLastTotalCount(): number | undefined {
        return this._lastTotalCount;
    }

    /**
     * Posts a new record to the server and returns the server response data.
     *
     * @param record - The new ModelRecord to send to the server.
     *
     * @returns A promise that resolves to the server response object, unwrapped from
     *   `root` if configured.
     */
    async create(record: ModelRecord): Promise<Record<string, any>> {
        const response = await fetch(this._url, {
            method: this._createMethod,
            headers: { 'Content-Type': 'application/json', ...this._headers },
            body: this._writer.writeRecord(record)
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: create failed with status ${response.status}`);
        }

        const json = await response.json();

        return this._root ? json[this._root] : json;
    }

    /**
     * Sends an update request for an existing record to `{url}/{id}` and returns the server response.
     *
     * @param record - The dirty ModelRecord to update on the server.
     *
     * @returns A promise that resolves to the server response object, unwrapped from
     *   `root` if configured.
     */
    async update(record: ModelRecord): Promise<Record<string, any>> {
        const response = await fetch(`${this._url}/${record.getId()}`, {
            method: this._updateMethod,
            headers: { 'Content-Type': 'application/json', ...this._headers },
            body: this._writer.writeRecord(record)
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: update failed with status ${response.status}`);
        }

        const json = await response.json();

        return this._root ? json[this._root] : json;
    }

    /**
     * Sends a DELETE request for the record to `{url}/{id}`.
     *
     * @param record - The ModelRecord to delete on the server.
     *
     * @returns A promise that resolves when the server confirms the deletion.
     */
    async destroy(record: ModelRecord): Promise<void> {
        const response = await fetch(`${this._url}/${record.getId()}`, {
            method: 'DELETE',
            headers: this._headers
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: destroy failed with status ${response.status}`);
        }
    }

    /**
     * Batch-creates records by POSTing the serialized batch to the collection URL.
     *
     * @param records - The new ModelRecords to create, in order.
     *
     * @returns A promise resolving to the per-record server objects in input
     *   order, unwrapped from `root` if configured.
     *
     * @remarks
     * The store commits each record positionally against the returned array, so
     * the server must echo back one object per input record in the same order.
     */
    async createBatch(records: ModelRecord[]): Promise<Record<string, any>[]> {
        const response = await fetch(this._url, {
            method: this._createMethod,
            headers: { 'Content-Type': 'application/json', ...this._headers },
            body: this._writer.writeRecords(records)
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: createBatch failed with status ${response.status}`);
        }

        return this.readBatchResponse(response);
    }

    /**
     * Batch-updates records by PUTting the serialized batch to the collection URL.
     *
     * @param records - The dirty ModelRecords to update, in order.
     *
     * @returns A promise resolving to the per-record server objects in input
     *   order, unwrapped from `root` if configured.
     */
    async updateBatch(records: ModelRecord[]): Promise<Record<string, any>[]> {
        const response = await fetch(this._url, {
            method: this._updateMethod,
            headers: { 'Content-Type': 'application/json', ...this._headers },
            body: this._writer.writeRecords(records)
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: updateBatch failed with status ${response.status}`);
        }

        return this.readBatchResponse(response);
    }

    /**
     * Batch-destroys records by DELETEing the serialized batch from the collection URL.
     *
     * @param records - The ModelRecords to delete, in order.
     *
     * @returns A promise that resolves when the server confirms the deletion.
     */
    async destroyBatch(records: ModelRecord[]): Promise<void> {
        const response = await fetch(this._url, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...this._headers },
            body: this._writer.writeRecords(records)
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: destroyBatch failed with status ${response.status}`);
        }
    }

    /**
     * Parses a batch response into an array of per-record server objects, in
     * input order, unwrapping the `root` envelope when configured.
     *
     * @param response - The non-rejected fetch response from a batch op.
     *
     * @returns The per-record server objects.
     */
    private async readBatchResponse(response: Response): Promise<Record<string, any>[]> {
        const json = await response.json();

        return this._root ? json[this._root] : json;
    }
}
