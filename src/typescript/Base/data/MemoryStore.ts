import { AbstractStore } from "./AbstractStore";
import { Model } from "./Model";
import { MemoryProxy } from "./proxy/MemoryProxy";

export class MemoryStore extends AbstractStore {

    readonly model: Model;
    readonly proxy: MemoryProxy = new MemoryProxy();

    constructor(model: Model, data: any[] = []) {
        super();

        this.model = model;
        this.proxy.setData(data);
    }
}
