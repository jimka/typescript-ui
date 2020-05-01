import { Cell } from "./Cell.js";
import { StringRenderer } from "./renderer/String.js";
import { StringEditor } from "./editor/String.js";

export class StringCell extends Cell<String> {

    constructor() {
        let renderer = new StringRenderer();
        let editor = new StringEditor();

        super("td", renderer, editor);
    }

    setValue(value: String) {
        this.getRenderer().setValue(value);
    }
}