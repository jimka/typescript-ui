// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '../ModelRecord.js';
import { Proxy } from './Proxy.js';

export interface MemoryProxyConfig {
    data: any[];
}

export class MemoryProxy extends Proxy {

    private data: any[];

    constructor(config: MemoryProxyConfig = { data: [] }) {
        super();

        this.data = config.data.slice();
    }

    setData(data: any[]): void {
        this.data = data.slice();
    }

    read(): Promise<any[]> {
        return Promise.resolve(this.data.slice());
    }

    create(record: ModelRecord): Promise<Record<string, any>> {
        const copy = { ...record.getData() };

        this.data.push(copy);

        return Promise.resolve(copy);
    }

    update(record: ModelRecord): Promise<Record<string, any>> {
        const copy = { ...record.getData() };
        const pkName = record.getModel().getPrimaryKeyField()?.getName();

        if (pkName !== undefined) {
            const id = record.getId();
            const idx = this.data.findIndex(d => d[pkName] === id);

            if (idx !== -1) {
                this.data[idx] = copy;
            }
        }

        return Promise.resolve(copy);
    }

    destroy(record: ModelRecord): Promise<void> {
        const pkName = record.getModel().getPrimaryKeyField()?.getName();

        if (pkName !== undefined) {
            const id = record.getId();
            const idx = this.data.findIndex(d => d[pkName] === id);

            if (idx !== -1) {
                this.data.splice(idx, 1);
            }
        }

        return Promise.resolve();
    }
}
