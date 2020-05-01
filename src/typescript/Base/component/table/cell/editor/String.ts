import { CellEditor } from "./CellEditor.js";
import { TextField } from "../../../../component/TextField.js";
import { Event } from "../../../../Event.js";

export class StringEditor extends CellEditor<String> {

    private textField: TextField = new TextField();

    constructor() {
        super();

        Event.addListener(this.textField, "blur", (evnt: UIEvent) => {
            Event.fireEvent(this, "blur", evnt);
        });
        Event.addListener(this.textField, "keydown", (evnt: UIEvent) => {
            Event.fireEvent(this, "keydown", evnt);
        });

        this.textField.setText("");
        this.addComponent(this.textField);
    }

    getValue() {
        return this.textField.getText();
    }

    setValue(value: String) {
        this.textField.setText(value || "");
    }

    focus() {
        this.textField.focus();
        this.textField.select();
    }
}