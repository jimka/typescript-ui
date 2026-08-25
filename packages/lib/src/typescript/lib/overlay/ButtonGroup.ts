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
     * When `true`, clicking the currently-selected button leaves it deselected
     * instead of re-selecting it — so the group can hold **nothing** selected.
     * Defaults to `false` (the classic radio invariant: exactly one selected once
     * a choice is made). Use `true` for a toggle rail where re-clicking the active
     * item is a meaningful "turn it off" gesture (e.g. a collapsible view switch).
     */
    allowDeselect?: boolean;
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
    private _allowDeselect: boolean = false;
    private _rovingTabIndex: RovingTabIndex | null = null;
    private _listeners: ListenerBag<ButtonGroupEvent> = new ListenerBag<ButtonGroupEvent>();

    /**
     * Creates a ButtonGroup, optionally populated with an initial set of buttons.
     *
     * @param options - Optional. Construction-time options. `options.buttons` registers
     *   the given buttons via {@link addButtons}.
     */
    constructor(options?: ButtonGroupOptions) {
        if (options?.allowDeselect !== undefined) this._allowDeselect = options.allowDeselect;

        if (options?.buttons !== undefined) this.addButtons(options.buttons);

        if (options?.listeners !== undefined) {
            const listeners = options.listeners;

            for (const event of Object.keys(listeners) as Array<keyof typeof listeners>) {
                const listener = listeners[event];

                if (listener !== undefined) {
                    this.on(event, listener);
                }
            }
        }
    }

    /**
     * Reconciles the group after a member's click. When the initiator is now
     * selected, every other button is deselected (mutual exclusivity). When the
     * initiator was toggled off by its own click, the group re-selects it to keep
     * exactly one selected — unless {@link ButtonGroupOptions.allowDeselect} is
     * set, in which case the group is left with nothing selected. Either way the
     * `"selection"` event fires with the initiator (which may be deselected under
     * `allowDeselect`, so listeners should read its `isSelected()`).
     *
     * @param initiatorButton - The button whose click triggered the update.
     */
    private updateButtonStates(initiatorButton: RadioButton | ToggleButton): void {
        if (!initiatorButton.isSelected()) {
            // The initiator's own click toggled it off. Radio groups snap it back
            // on to preserve the one-always-selected invariant; a deselectable
            // group lets it stay off (nothing selected). Its siblings were already
            // deselected when it was first chosen, so no further sweep is needed.
            if (!this._allowDeselect) {
                initiatorButton.setSelected(true);
            }
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
     * Toggles whether a click on the selected button may leave the group with
     * nothing selected. See {@link ButtonGroupOptions.allowDeselect}.
     *
     * @param value - `true` to allow deselect-to-none; `false` for the classic
     *   one-always-selected radio invariant.
     *
     * @returns This group, for method chaining.
     */
    setAllowDeselect(value: boolean): this {
        this._allowDeselect = value;

        return this;
    }

    /**
     * Releases this group's own event-listener bag. The buttons this group
     * manages, and any container passed to {@link setContainer}, each own
     * their registrations independently and release them on their own
     * teardown, so this only needs to clear the group's own `"selection"`
     * listeners.
     */
    dispose(): void {
        this._listeners.clear();
    }

    /**
     * Registers a listener for one of this group's events.
     *
     * @param event - `"selection"` fires whenever the group's selection changes,
     *   receiving the button that was clicked. With `allowDeselect` that button
     *   may now be deselected (the group holds nothing), so read its
     *   `isSelected()` to tell a select from a deselect.
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
     * Returns the group's buttons as a [`Component`](/api/core/classes/Component) array, suitable for passing
     * directly to [`Component.addComponents`](/api/core/classes/Component#addcomponents).
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

        button.on("action", () => {
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

        Event.addSubtreeListener(container, "keydown", (e: KeyboardEvent): Event.ListenerResult => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                this._rovingTabIndex!.moveNext();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                this._rovingTabIndex!.movePrev();
            } else {
                return;
            }

            return { prevent: true };
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
