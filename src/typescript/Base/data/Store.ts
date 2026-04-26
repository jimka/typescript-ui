// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Model } from './Model.js';
import { Proxy } from './proxy/Proxy.js';
import { AbstractStore } from './AbstractStore.js';

export class Store extends AbstractStore {

    readonly model: Model;
    readonly proxy: Proxy | undefined;

    constructor(model: Model, proxy?: Proxy) {
        super();
        this.model = model;
        this.proxy = proxy;
    }
}
