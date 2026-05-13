// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component.js";
import { Event } from "./Event.js";
import { RadioButton } from "./component/RadioButton.js";
import { RovingTabIndex } from "./RovingTabIndex.js";
import { ToggleButton } from "./component/ToggleButton.js";
import { callable } from "./Callable.js";

/**
 * Construction-time options for {@link ButtonGroup}.
 *
 * @category Core
 */
export interface ButtonGroupOptions {
    buttons?: Array<RadioButton | ToggleButton>;
}

/**
 * Manages mutual exclusivity among a set of {@link RadioButton} or {@link ToggleButton} instances.
 *
 * When a button in the group becomes selected, all other buttons in the group are automatically deselected.
 * For `RadioButton` groups, a shared `name` attribute is applied so the browser handles keyboard navigation
 * natively. For `ToggleButton` groups, call `setContainer` to enable roving tabindex keyboard nav.
 *
 * @category Core
 */
class ButtonGroup {

    buttons: Array<RadioButton | ToggleButton> = new Array<RadioButton | ToggleButton>();

    private _groupId: string = 'bg-' + Math.random().toString(36).slice(2, 10);
    private _rovingTabIndex: RovingTabIndex | null = null;
    private _selectionListeners: Array<(button: RadioButton | ToggleButton) => void> = [];

    /**
     * Creates a ButtonGroup, optionally populated with an initial set of buttons.
     *
     * @param options - Optional. Construction-time options. `options.buttons` registers
     *   the given buttons via {@link addButtons}.
     */
    constructor(options?: ButtonGroupOptions) {
        if (options?.buttons !== undefined) this.addButtons(options.buttons);
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
     * Returns the group's buttons as a {@link Component} array, suitable for passing
     * directly to {@link Component.addComponents}.
     *
     * @returns A new array of the buttons, widened to `Component`.
     */
    getButtons(): Array<Component> {
        return this.buttons.slice();
    }

    /**
     * Adds multiple buttons to the group in a single call.
     *
     * Each argument is either a button or an array of buttons; all forms can be freely mixed
     * in the same call. Each button is registered via {@link addButton}, so mutual-exclusivity
     * wiring and (for `ToggleButton`) roving tabindex registration are applied to every entry.
     *
     * @param buttons - The buttons to add. Each entry is a bare button or an array of buttons.
     *
     * @returns This group, for method chaining.
     */
    addButtons(...buttons: Array<RadioButton | ToggleButton | Array<RadioButton | ToggleButton>>): this {
        for (const entry of buttons) {
            const items = Array.isArray(entry) ? entry : [entry];

            for (const button of items) {
                this.addButton(button);
            }
        }

        return this;
    }

    /**
     * Adds a button to the group and wires its selection to enforce mutual exclusivity.
     *
     * @remarks For `RadioButton` instances, a shared `name` attribute is applied for native browser grouping.
     * For `ToggleButton` instances, the button is added to the roving tabindex group if a container has been set.
     * @param button - The button to add to the group.
     */
    addButton(button: RadioButton | ToggleButton): this {
        this.buttons.push(button);

        button.addActionListener(() => {
            this.updateButtonStates(button);
        });

        if (button instanceof RadioButton) {
            button.setRadioName(this._groupId);
        } else if (button instanceof ToggleButton && this._rovingTabIndex !== null) {
            this._rovingTabIndex.add(button);
        }

        return this;
    }

    /**
     * Removes a button from the group.
     *
     * @param button - The button to remove.
     */
    removeButton(button: RadioButton | ToggleButton): this {
        let idx = this.buttons.indexOf(button);

        if (idx < 0) {
            return this;
        }

        this.buttons.splice(idx, 1);

        if (button instanceof ToggleButton && this._rovingTabIndex !== null) {
            this._rovingTabIndex.remove(button);
        }

        return this;
    }

    /**
     * Sets the container component for keyboard navigation of `ToggleButton` groups.
     *
     * @remarks Registers Left/Right/Up/Down arrow key handlers on the container via subtree listener.
     * Also initialises the {@link RovingTabIndex} and adds any already-registered `ToggleButton` members to it.
     * @param container - The component that wraps the toggle buttons and should receive key events.
     */
    setContainer(container: Component): this {
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

        return this;
    }
}

const ButtonGroupCallable = callable(ButtonGroup);
type ButtonGroupCallable = ButtonGroup;
export {
    ButtonGroup as _ButtonGroup,
    ButtonGroupCallable as ButtonGroup
};
