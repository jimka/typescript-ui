import { CellEditor } from "./CellEditor.js";
import { TextField } from "../../../../component/TextField.js";
import { AnchorType } from "../../../../layout/AnchorType.js";
import { Event } from "../../../../Event.js";

export class NumberEditor extends CellEditor<Number> {

    private textField: TextField = new TextField();

    constructor() {
        super();

        Event.addListener(this.textField, "blur", (evnt: UIEvent) => {
            Event.fireEvent(this, "blur", evnt);
        });
        Event.addListener(this.textField, "keydown", (evnt: UIEvent) => {
            Event.fireEvent(this, "keydown", evnt);
        });

        this.textField.setTextAlign("right");
        this.textField.setText("");

        this.addComponent(this.textField, {
            anchor: AnchorType.NORTHEAST
        });
    }

    getValue() {
        return Number(this.textField.getText());
    }

    setValue(value: Number) {
        this.textField.setText(String(value) || "");
    }

    focus() {
        this.textField.focus();
        this.textField.select();
    }
}
