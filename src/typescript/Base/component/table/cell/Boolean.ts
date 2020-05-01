import { BooleanEditor } from "./editor/Boolean.js";
import { Cell } from "./Cell.js";
import { FillType } from "../../../layout/FillType.js";
import { AnchorType } from "../../../layout/AnchorType.js";

export class BooleanCell extends Cell<Boolean> {

    constructor() {
        let editor = new BooleanEditor();

        super("td",
            editor,
            undefined, {
                fill: FillType.NONE,
                anchor: AnchorType.CENTER
            },
            undefined
        );
    }

    startEdit() { }

    setValue(value: Boolean) {
        this.getRenderer().setValue(value);
    }
}