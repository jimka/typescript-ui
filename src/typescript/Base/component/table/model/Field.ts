export class Field {

    private id: String;
    private type: String;
    private description: String;
    private order: number;

    constructor(id: String, type: String, description: String, order: number) {
        this.id = id;
        this.type = type;
        this.description = description;
        this.order = order;
    }

    getId() {
        return this.id;
    }

    getType() {
        return this.type;
    }

    getDescription() {
        return this.description || this.id;
    }

    getOrder() {
        return this.order || -1;
    }
}