import { CellRenderer } from "./CellRenderer.js";
import { Label } from "../../../../component/Label.js";

export class StringRenderer extends CellRenderer<String> {

    private label: Label = new Label();

    constructor() {
        super();

        this.label.setText("");
        this.label.setPointerEvents("none");
        this.addComponent(this.label);
    }

    getLabel() {
        return this.label;
    }

    getValue() {
        return this.label.getText();
    }

    setValue(value: String) {
        this.label.setText(value || "");
    }
}