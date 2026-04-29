// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '../ModelRecord.js';
import { Proxy } from './Proxy.js';

export interface AjaxProxyConfig {
    url: string;
    root?: string;
    method?: 'GET' | 'POST';
    createMethod?: 'POST' | 'PUT';
    updateMethod?: 'PUT' | 'PATCH';
    headers?: Record<string, string>;
}

export class AjaxProxy extends Proxy {

    private url: string;
    private root: string | undefined;
    private method: 'GET' | 'POST';
    private createMethod: 'POST' | 'PUT';
    private updateMethod: 'PUT' | 'PATCH';
    private headers: Record<string, string>;

    constructor(config: AjaxProxyConfig) {
        super();
        this.url = config.url;
        this.root = config.root;
        this.method = config.method ?? 'GET';
        this.createMethod = config.createMethod ?? 'POST';
        this.updateMethod = config.updateMethod ?? 'PUT';
        this.headers = config.headers ?? {};
    }

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
