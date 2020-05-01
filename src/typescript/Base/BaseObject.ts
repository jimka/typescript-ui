import { Util } from "./Util.js"

export class BaseObject {

    private id: string;

    constructor() {
        this.id = Util.generateUUID();
    }

    getId() {
        return this.id;
    }

    setId(id: string) {
        this.id = id;
    }

    getClassName() {
        return this.constructor.name;
    }
};
