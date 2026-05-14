import { AbstractStore, AbstractStoreOptions } from "~/data/AbstractStore";
import { Model } from "~/data/Model";
import { MemoryProxy } from "~/data/proxy/MemoryProxy";

/**
 * Construction-time options for {@link MemoryStore}.
 *
 * @category Data
 */
export interface MemoryStoreOptions extends AbstractStoreOptions {
    model: Model;
    data?: any[];
}

/**
 * A store backed entirely by in-memory data.
 * Useful for testing or for static datasets that do not require server persistence.
 *
 * @category Data
 */
export class MemoryStore extends AbstractStore {

    readonly model: Model;
    readonly proxy: MemoryProxy = new MemoryProxy();

    /**
     * Constructs a MemoryStore with the given model and an optional initial data array.
     *
     * @param modelOrOptions - The Model that defines the record schema, or a {@link MemoryStoreOptions} bag.
     * @param data - Optional. The initial data records to load into the store. Ignored when the first argument is a {@link MemoryStoreOptions} bag.
     */
    constructor(modelOrOptions: Model | MemoryStoreOptions, data: any[] = []) {
        super();

        if (modelOrOptions instanceof Model) {
            this.model = modelOrOptions;
            this.proxy.setData(data);
        } else {
            this.model = modelOrOptions.model;
            this.proxy.setData(modelOrOptions.data ?? []);

            this.applyOptions(modelOrOptions);
        }
    }
}
