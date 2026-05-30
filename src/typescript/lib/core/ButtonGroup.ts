// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { RadioButton } from "~/component/input/RadioButton.js";
import { RovingTabIndex } from "~/core/RovingTabIndex.js";
import { ToggleButton } from "~/component/button/ToggleButton.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link ButtonGroup}.
 *
 * @category Core
 */
export type ButtonGroupEvent = "selection";

/**
 * Construction-time options for {@link ButtonGroup}.
 *
 * @category Core
 */
export interface ButtonGroupOptions {
    buttons?: Array<RadioButton | ToggleButton>;
    /**
     * Multi-event listener bag dispatched to {@link ButtonGroup.on} at
     * construction time.
     */
    listeners?: {
        selection?: (button: RadioButton | ToggleButton) => void;
    };
}

/**
 * Manages mutual exclusivity among a set of {@link RadioButton} or {@link ToggleButton} instances.
 *
 * When a button in the group becomes selected, all other buttons in the group are automatically deselected.
 * For [`RadioButton`](/api/component/input/classes/RadioButton) groups, a shared `name` attribute is applied so the browser handles keyboard navigation
 * natively. For [`ToggleButton`](/api/component/button/classes/ToggleButton) groups, call `setContainer` to enable roving tabindex keyboard nav.
 *
 * @category Core
 */
class ButtonGroup {

    buttons: Array<RadioButton | ToggleButton> = new Array<RadioButton | ToggleButton>();

    private _groupId: string = 'bg-' + Math.random().toString(36).slice(2, 10);
    private _rovingTabIndex: RovingTabIndex | null = null;
    private _listeners: ListenerBag<ButtonGroupEvent> = new ListenerBag<ButtonGroupEvent>();

    /**
     * Creates a ButtonGroup, optionally populated with an initial set of buttons.
     *
     * @param options - Optional. Construction-time options. `options.buttons` registers
     *   the given buttons via {@link addButtons}.
     */
    constructor(options?: ButtonGroupOptions) {
        if (options?.buttons !== undefined) this.addButtons(options.buttons);
        if (options?.listeners?.selection !== undefined) {
            this.on("selection", options.listeners.selection);
        }
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

        this.emit("selection", initiatorButton);
    }

    /**
     * Registers a listener for one of this group's events.
     *
     * @param event - `"selection"` fires whenever the selected button in the
     *   group changes, receiving the newly selected button.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This group, for method chaining.
     */
    on(event: "selection",      listener: (button: RadioButton | ToggleButton) => void): this;
    on(event: ButtonGroupEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This group, for method chaining.
     */
    off(event: ButtonGroupEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "selection",      button: RadioButton | ToggleButton): void;
    protected emit(event: ButtonGroupEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * @deprecated Use `on("selection", fn)`.
     *
     * @param listener - Callback receiving the newly selected button.
     */
    addSelectionListener(listener: (button: RadioButton | ToggleButton) => void): void {
        this.on("selection", listener);
    }

    /**
     * Returns the group's buttons as a {@link Component} array, suitable for passing
     * directly to {@link Component.addComponents}.
     *
     * @returns A new array of the buttons, widened to [`Component`](/api/core/classes/Component).
     */
    getButtons(): Array<Component> {
        return this.buttons.slice();
    }

    /**
     * Adds multiple buttons to the group in a single call.
     *
     * Each argument is either a button or an array of buttons; all forms can be freely mixed
     * in the same call. Each button is registered via {@link addButton}, so mutual-exclusivity
     * wiring and (for [`ToggleButton`](/api/component/button/classes/ToggleButton)) roving tabindex registration are applied to every entry.
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
     * @remarks The shared group id is stored on each [`RadioButton`](/api/component/input/classes/RadioButton) (via `setRadioName`) for
     * back-compat with consumers that read `getRadioName()`. Group navigation is delegated
     * to {@link RovingTabIndex} once a container has been wired via {@link setContainer};
     * both [`ToggleButton`](/api/component/button/classes/ToggleButton) and [`RadioButton`](/api/component/input/classes/RadioButton) members are registered there.
     * @param button - The button to add to the group.
     */
    addButton(button: RadioButton | ToggleButton): this {
        this.buttons.push(button);

        button.on("change", () => {
            this.updateButtonStates(button);
        });

        if (button instanceof RadioButton) {
            button.setRadioName(this._groupId);
        }

        if (this._rovingTabIndex !== null) {
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

        if (this._rovingTabIndex !== null) {
            this._rovingTabIndex.remove(button);
        }

        return this;
    }

    /**
     * Sets the container component for keyboard navigation of the group.
     *
     * @remarks Registers Left/Right/Up/Down arrow key handlers on the container via subtree listener.
     * Also initialises the {@link RovingTabIndex} and adds every already-registered
     * [`RadioButton`](/api/component/input/classes/RadioButton) or [`ToggleButton`](/api/component/button/classes/ToggleButton) member to it.
     * @param container - The component that wraps the buttons and should receive key events.
     */
    setContainer(container: Component): this {
        this._rovingTabIndex = new RovingTabIndex();

        for (const button of this.buttons) {
            this._rovingTabIndex.add(button);
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
