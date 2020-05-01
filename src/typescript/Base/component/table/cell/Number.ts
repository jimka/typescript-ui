import { Cell } from "./Cell.js";
import { NumberRenderer } from "./renderer/Number.js";
import { NumberEditor } from "./editor/Number.js";

export class NumberCell extends Cell<Number> {

    constructor() {
        let renderer = new NumberRenderer();
        let editor = new NumberEditor();

        super("td", renderer, editor);
    }

    setValue(value: Number) {
        this.getRenderer().setValue(value);
    }
}