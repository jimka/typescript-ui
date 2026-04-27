// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

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
}
