// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Model } from './Model.js';
import { Proxy } from './proxy/Proxy.js';
import { AbstractStore } from './AbstractStore.js';

/**
 * A general-purpose concrete store that pairs a Model with an optional Proxy.
 * Use this class when you do not need a dedicated store subclass.
 */
export class Store extends AbstractStore {

    readonly model: Model;
    readonly proxy: Proxy | undefined;

    /**
     * Constructs a Store with the given model and an optional proxy.
     *
     * @param model - The Model that defines the record schema for this store.
     * @param proxy - Optional. The Proxy used to load and persist records.
     */
    constructor(model: Model, proxy?: Proxy) {
        super();

        this.model = model;
        this.proxy = proxy;
    }
}
