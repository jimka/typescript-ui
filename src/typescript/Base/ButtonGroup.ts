// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component.js";
import { Event } from "./Event.js";
import { RadioButton } from "./component/RadioButton.js";
import { RovingTabIndex } from "./RovingTabIndex.js";
import { ToggleButton } from "./component/ToggleButton.js";

/**
 * Manages mutual exclusivity among a set of {@link RadioButton} or {@link ToggleButton} instances.
 *
 * When a button in the group becomes selected, all other buttons in the group are automatically deselected.
 * For `RadioButton` groups, a shared `name` attribute is applied so the browser handles keyboard navigation
 * natively. For `ToggleButton` groups, call {@link setContainer} to enable roving tabindex keyboard nav.
 */
export class ButtonGroup {

    buttons: Array<RadioButton | ToggleButton> = new Array<RadioButton | ToggleButton>();

    private _groupId: string = 'bg-' + Math.random().toString(36).slice(2, 10);
    private _rovingTabIndex: RovingTabIndex | null = null;
    private _selectionListeners: Array<(button: RadioButton | ToggleButton) => void> = [];

    /**
     * Creates an empty ButtonGroup.
     */
    constructor() {
    }

    /**
     * Deselects all buttons in the group except the one that just became selected.
     *
     * @param initiatorButton - The button whose selection triggered the update.
     */
    private updateButtonStates(initiatorButton: RadioButton | ToggleButton): void {
        if (!initiatorButton.isSelected()) {
            initiatorButton.setSelected(true);
        } else {
            this.buttons.forEach((button) => {
                if (button !== initiatorButton) {
                    button.setSelected(false);
                }
            });
        }

        this._selectionListeners.forEach((listener) => listener(initiatorButton));
    }

    /**
     * Registers a listener that is called whenever the selected button in the group changes.
     *
     * @param listener - Callback receiving the newly selected button.
     */
    addSelectionListener(listener: (button: RadioButton | ToggleButton) => void): void {
        this._selectionListeners.push(listener);
    }

    /**
     * Adds a button to the group and wires its selection to enforce mutual exclusivity.
     *
     * @remarks For `RadioButton` instances, a shared `name` attribute is applied for native browser grouping.
     * For `ToggleButton` instances, the button is added to the roving tabindex group if a container has been set.
     * @param button - The button to add to the group.
     */
    addButton(button: RadioButton | ToggleButton): void {
        this.buttons.push(button);

        button.addActionListener(() => {
            this.updateButtonStates(button);
        });

        if (button instanceof RadioButton) {
            button.setRadioName(this._groupId);
        } else if (button instanceof ToggleButton && this._rovingTabIndex !== null) {
            this._rovingTabIndex.add(button);
        }
    }

    /**
     * Removes a button from the group.
     *
     * @param button - The button to remove.
     */
    removeButton(button: RadioButton | ToggleButton): void {
        let idx = this.buttons.indexOf(button);

        if (idx < 0) {
            return;
        }

        this.buttons.splice(idx, 1);

        if (button instanceof ToggleButton && this._rovingTabIndex !== null) {
            this._rovingTabIndex.remove(button);
        }
    }

    /**
     * Sets the container component for keyboard navigation of `ToggleButton` groups.
     *
     * @remarks Registers Left/Right/Up/Down arrow key handlers on the container via subtree listener.
     * Also initialises the {@link RovingTabIndex} and adds any already-registered `ToggleButton` members to it.
     * @param container - The component that wraps the toggle buttons and should receive key events.
     */
    setContainer(container: Component): void {
        this._rovingTabIndex = new RovingTabIndex();

        for (const button of this.buttons) {
            if (button instanceof ToggleButton) {
                this._rovingTabIndex.add(button);
            }
        }

        Event.addSubtreeListener(container, "keydown", (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                this._rovingTabIndex!.moveNext();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                this._rovingTabIndex!.movePrev();
            }
        });
    }
}
