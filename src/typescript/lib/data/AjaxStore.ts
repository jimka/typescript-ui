// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractStore, AbstractStoreOptions } from '~/data/AbstractStore.js';
import { Model } from '~/data/Model.js';
import { AjaxProxy, AjaxProxyOptions } from '~/data/proxy/AjaxProxy.js';

/**
 * Construction-time options for {@link AjaxStore}. Combines store-level options
 * with the proxy configuration that drives the embedded {@link AjaxProxy}.
 *
 * @category Data
 */
export interface AjaxStoreOptions extends AbstractStoreOptions {
    model: Model;
    proxy: AjaxProxyOptions;
}

/**
 * A store backed by an {@link AjaxProxy} that talks to a remote HTTP/REST endpoint.
 * Convenience subclass that constructs the proxy from an {@link AjaxProxyOptions}
 * bag so callers do not need to wire a {@link Store} and proxy separately.
 *
 * @category Data
 */
export class AjaxStore extends AbstractStore {

    readonly model: Model;
    readonly proxy: AjaxProxy;

    /**
     * Constructs an AjaxStore with the given model and AjaxProxy configuration.
     *
     * @param modelOrOptions - The Model that defines the record schema, or an {@link AjaxStoreOptions} bag.
     * @param proxyOptions - The AjaxProxy options specifying the endpoint URL and HTTP options. Required when the first argument is a Model; ignored when the first argument is an {@link AjaxStoreOptions} bag.
     */
    constructor(modelOrOptions: Model | AjaxStoreOptions, proxyOptions?: AjaxProxyOptions) {
        super();

        if (modelOrOptions instanceof Model) {
            if (!proxyOptions) {
                throw new Error("AjaxStore requires an AjaxProxyOptions argument when constructed with a Model.");
            }

            this.model = modelOrOptions;
            this.proxy = new AjaxProxy(proxyOptions);
        } else {
            this.model = modelOrOptions.model;
            this.proxy = new AjaxProxy(modelOrOptions.proxy);

            this.applyOptions(modelOrOptions);
        }
    }
}
