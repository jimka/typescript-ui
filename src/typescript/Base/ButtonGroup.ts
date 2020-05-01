import { RadioButton } from "./component/RadioButton";
import { ToggleButton } from "./component/ToggleButton";

export class ButtonGroup {
    buttons: Array<RadioButton | ToggleButton> = new Array<RadioButton | ToggleButton>();

    constructor() {
    }

    private updateButtonStates(initiatorButton: RadioButton | ToggleButton) {
        if (!initiatorButton.isSelected()) {
            return;
        }

        this.buttons.forEach((button) => {
            if (button == initiatorButton) {
                return;
            }

            button.setSelected(false);
        });
    }

    addButton(button: RadioButton | ToggleButton) {
        this.buttons.push(button);

        button.addActionListener(() => {
            this.updateButtonStates(button);
        });
    }

    removeButton(button: RadioButton | ToggleButton) {
        let idx = this.buttons.indexOf(button);
        if (idx < 0) {
            return;
        }

        this.buttons.slice(idx);
    }
}