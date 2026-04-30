import { AbstractStore } from "./AbstractStore";
import { Model } from "./Model";
import { MemoryProxy } from "./proxy/MemoryProxy";

/**
 * A store backed entirely by in-memory data.
 * Useful for testing or for static datasets that do not require server persistence.
 */
export class MemoryStore extends AbstractStore {

    readonly model: Model;
    readonly proxy: MemoryProxy = new MemoryProxy();

    /**
     * Constructs a MemoryStore with the given model and an optional initial data array.
     *
     * @param model - The Model that defines the record schema for this store.
     * @param data - Optional. The initial data records to load into the store.
     */
    constructor(model: Model, data: any[] = []) {
        super();

        this.model = model;
        this.proxy.setData(data);
    }
}
