// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '../ModelRecord.js';
import { Proxy } from './Proxy.js';

/**
 * Configuration object for constructing an AjaxProxy.
 */
export interface AjaxProxyConfig {
    url: string;
    root?: string;
    method?: 'GET' | 'POST';
    createMethod?: 'POST' | 'PUT';
    updateMethod?: 'PUT' | 'PATCH';
    headers?: Record<string, string>;
}

/**
 * A proxy that communicates with a remote HTTP/REST endpoint using the Fetch API.
 * Supports configurable HTTP methods and an optional root key for unwrapping responses.
 *
 * @remarks
 * Update and destroy requests are sent to `{url}/{id}` where `id` is the record's
 * primary key value. All four CRUD methods throw an `Error` when the server responds
 * with a non-OK status code.
 */
export class AjaxProxy extends Proxy {

    private url: string;
    private root: string | undefined;
    private method: 'GET' | 'POST';
    private createMethod: 'POST' | 'PUT';
    private updateMethod: 'PUT' | 'PATCH';
    private headers: Record<string, string>;

    /**
     * Constructs an AjaxProxy from the given configuration.
     *
     * @param config - The configuration object specifying the endpoint URL and HTTP options.
     */
    constructor(config: AjaxProxyConfig) {
        super();
        this.url = config.url;
        this.root = config.root;
        this.method = config.method ?? 'GET';
        this.createMethod = config.createMethod ?? 'POST';
        this.updateMethod = config.updateMethod ?? 'PUT';
        this.headers = config.headers ?? {};
    }

    /**
     * Fetches all records from the configured URL, optionally extracting from a root key.
     *
     * @returns A promise that resolves to an array of raw data objects from the server.
     *
     * @remarks
     * When `root` is configured the response JSON is expected to be an object and the
     * array is read from `json[root]`. Without `root` the response must be a top-level
     * array. An `Error` is thrown for non-OK responses or unexpected response shapes.
     */
    async read(): Promise<any[]> {
        const response = await fetch(this.url, {
            method: this.method,
            headers: this.headers
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: request failed with status ${response.status}`);
        }

        const json = await response.json();

        if (this.root) {
            const extracted = json[this.root];
            if (!Array.isArray(extracted)) {
                throw new Error(`AjaxProxy: root '${this.root}' did not resolve to an array`);
            }
            return extracted;
        }

        if (!Array.isArray(json)) {
            throw new Error(`AjaxProxy: response is not an array and no root was specified`);
        }

        return json;
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
        const response = await fetch(this.url, {
            method: this.createMethod,
            headers: { 'Content-Type': 'application/json', ...this.headers },
            body: JSON.stringify(record.getData())
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: create failed with status ${response.status}`);
        }

        const json = await response.json();

        return this.root ? json[this.root] : json;
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
        const response = await fetch(`${this.url}/${record.getId()}`, {
            method: this.updateMethod,
            headers: { 'Content-Type': 'application/json', ...this.headers },
            body: JSON.stringify(record.getData())
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: update failed with status ${response.status}`);
        }

        const json = await response.json();

        return this.root ? json[this.root] : json;
    }

    /**
     * Sends a DELETE request for the record to `{url}/{id}`.
     *
     * @param record - The ModelRecord to delete on the server.
     *
     * @returns A promise that resolves when the server confirms the deletion.
     */
    async destroy(record: ModelRecord): Promise<void> {
        const response = await fetch(`${this.url}/${record.getId()}`, {
            method: 'DELETE',
            headers: this.headers
        });

        if (!response.ok) {
            throw new Error(`AjaxProxy: destroy failed with status ${response.status}`);
        }
    }
}
