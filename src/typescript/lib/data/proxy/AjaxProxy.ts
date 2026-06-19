// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '~/data/ModelRecord.js';
import { Proxy, ReadParams } from '~/data/proxy/Proxy.js';

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
     * extended with `?page=N&pageSize=M`. The response is expected to be `{ data: T[],
     * total: number }`. If `root` is configured, the envelope is read from `json[root]`
     * first. The reported `total` is stored and exposed via {@link getLastTotalCount}.
     */
    async read(params?: ReadParams): Promise<any[]> {
        const paginated = params != null && (params.page != null || params.pageSize != null);

        let url = this._url;

        if (paginated) {
            const search = new URLSearchParams();

            if (params!.page != null) {
                search.set('page', String(params!.page));
            }

            if (params!.pageSize != null) {
                search.set('pageSize', String(params!.pageSize));
            }

            const sep = this._url.includes('?') ? '&' : '?';
            url = this._url + sep + search.toString();
        }

        const response = await fetch(url, {
            method: this._method,
            headers: this._headers
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: request failed with status ${response.status}`);
        }

        const json = await response.json();

        if (paginated) {
            const envelope = this._root ? json[this._root] : json;

            if (envelope == null || typeof envelope !== 'object') {
                throw new Error(`AjaxProxy: paginated response is not an envelope object`);
            }

            const data  = envelope.data;
            const total = envelope.total;

            if (!Array.isArray(data)) {
                throw new Error(`AjaxProxy: paginated response 'data' is not an array`);
            }

            this._lastTotalCount = typeof total === 'number' ? total : undefined;

            return data;
        }

        if (this._root) {
            const extracted = json[this._root];
            if (!Array.isArray(extracted)) {
                throw new Error(`AjaxProxy: root '${this._root}' did not resolve to an array`);
            }
            return extracted;
        }

        if (!Array.isArray(json)) {
            throw new Error(`AjaxProxy: response is not an array and no root was specified`);
        }

        return json;
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
            body: JSON.stringify(record.getData())
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
            body: JSON.stringify(record.getData())
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
}
