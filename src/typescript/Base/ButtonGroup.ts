// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { RadioButton } from "./component/RadioButton";
import { ToggleButton } from "./component/ToggleButton";

/**
 * Manages mutual exclusivity among a set of {@link RadioButton} or {@link ToggleButton} instances.
 *
 * When a button in the group becomes selected, all other buttons in the group are automatically deselected.
 */
export class ButtonGroup {
    buttons: Array<RadioButton | ToggleButton> = new Array<RadioButton | ToggleButton>();

    constructor() {
    }

    /**
     * Deselects all buttons in the group except the one that just became selected.
     *
     * @param initiatorButton - The button whose selection triggered the update.
     */
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

    /**
     * Adds a button to the group and wires its selection to enforce mutual exclusivity.
     *
     * @param button - The button to add to the group.
     */
    addButton(button: RadioButton | ToggleButton) {
        this.buttons.push(button);

        button.addActionListener(() => {
            this.updateButtonStates(button);
        });
    }

    /**
     * Removes a button from the group.
     *
     * @param button - The button to remove.
     */
    removeButton(button: RadioButton | ToggleButton) {
        let idx = this.buttons.indexOf(button);
        if (idx < 0) {
            return;
        }

        this.buttons.splice(idx);
    }
}