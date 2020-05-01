import { StringRenderer } from "./renderer/String.js";
import { Cell } from "./Cell.js";

export class DefaultCell extends Cell<String> {

    constructor(tag?: string) {
        let renderer = new StringRenderer();

        super(tag || "td", renderer);
    }

    getRenderer() {
        return <StringRenderer>super.getRenderer();
    }

    setValue(value: String) {
        this.getRenderer().setValue(value);
    }
}