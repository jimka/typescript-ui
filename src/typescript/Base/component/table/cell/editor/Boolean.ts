import { CellEditor } from "./CellEditor.js";
import { Checkbox } from "../../../../component/CheckBox.js";

export class BooleanEditor extends CellEditor<Boolean> {

    private checkBox: Checkbox = new Checkbox();

    constructor() {
        super();

        this.checkBox.setSelected(false);
        this.addComponent(this.checkBox);
    }

    getValue() {
        return this.checkBox.isSelected();
    }

    setValue(value: boolean) {
        this.checkBox.setSelected(value);
    }
}