import { CellRenderer } from "./CellRenderer.js";
import { Label } from "../../../Label.js";
import { AnchorType } from "../../../../layout/AnchorType.js";

export class NumberRenderer extends CellRenderer<Number> {

    private label: Label = new Label();

    constructor() {
        super();

        this.label.setPointerEvents("none");
        this.label.setTextAlign("right");
        this.label.setText("");

        this.addComponent(this.label, {
            anchor: AnchorType.NORTHEAST
        });
    }

    getValue() {
        return Number(this.label.getText());
    }

    setValue(value: Number) {
        this.label.setText(String(value) || "");
    }
}
