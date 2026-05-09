import { AbstractStore } from "./AbstractStore";
import { Model } from "./Model";
import { AjaxProxy, AjaxProxyConfig } from "./proxy/AjaxProxy";

/**
 * A store backed by an {@link AjaxProxy} that talks to a remote HTTP/REST endpoint.
 * Convenience subclass that constructs the proxy from an {@link AjaxProxyConfig}
 * so callers do not need to wire a {@link Store} and proxy separately.
 *
 * @category Data
 */
export class AjaxStore extends AbstractStore {

    readonly model: Model;
    readonly proxy: AjaxProxy;

    /**
     * Constructs an AjaxStore with the given model and AjaxProxy configuration.
     *
     * @param model - The Model that defines the record schema for this store.
     * @param config - The AjaxProxy configuration specifying the endpoint URL and HTTP options.
     */
    constructor(model: Model, config: AjaxProxyConfig) {
        super();

        this.model = model;
        this.proxy = new AjaxProxy(config);
    }
}
