// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Model } from '~/data/Model.js';
import { AbstractModel } from '~/data/AbstractModel.js';
import { Proxy } from '~/data/proxy/Proxy.js';
import { AbstractStore, AbstractStoreOptions } from '~/data/AbstractStore.js';

/**
 * Construction-time options for {@link Store}. May be passed as the first
 * argument in place of the positional `(model, proxy)` form, in which case
 * `model` and optional `proxy` come from the bag.
 *
 * @category Data
 */
export interface StoreOptions extends AbstractStoreOptions {
    model:  Model;
    proxy?: Proxy;
}

/**
 * A general-purpose concrete store that pairs a Model with an optional Proxy.
 * Use this class when you do not need a dedicated store subclass.
 *
 * @category Data
 */
export class Store extends AbstractStore {

    readonly model: Model;
    readonly proxy: Proxy | undefined;

    /**
     * Constructs a Store with the given model and an optional proxy.
     *
     * @param modelOrOptions - The {@link Model} that defines the record schema, or a {@link StoreOptions} bag.
     * @param proxy - Optional. The Proxy used to load and persist records. Ignored when the first argument is a {@link StoreOptions} bag.
     */
    constructor(modelOrOptions: Model | StoreOptions, proxy?: Proxy) {
        super();

        if (modelOrOptions instanceof AbstractModel) {
            this.model = modelOrOptions;
            this.proxy = proxy;
        } else {
            this.model = modelOrOptions.model;
            this.proxy = modelOrOptions.proxy;

            this.applyOptions(modelOrOptions);
        }
    }
}
