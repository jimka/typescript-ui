// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { SpatialNavigation } from "~/core/SpatialNavigation.js";
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

    /** Per-button `"action"` handlers, held so the exact reference `addButton` registered can be removed again. */
    private readonly _actionHandlers: Map<RadioButton | ToggleButton, () => void> = new Map();

    /** The component `setContainer` wired last, held so a re-wire or `dispose` can unregister from it. */
    private _container: Component | null = null;

    /** The one `keydown` reference registered on `_container`, bound once so `removeSubtreeListener` matches it. */
    private readonly _onContainerKeyDown: (e: KeyboardEvent) => Event.ListenerResult;

    /**
     * Creates a ButtonGroup, optionally populated with an initial set of buttons.
     *
     * @param options - Optional. Construction-time options. `options.buttons` registers
     *   the given buttons via {@link addButtons}.
     */
    constructor(options?: ButtonGroupOptions) {
        this._onContainerKeyDown = this.handleContainerKeyDown.bind(this);

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
     * Releases every registration this group made, then clears its own
     * `"selection"` bag.
     *
     * @remarks The `"action"` listener on each member and the `"keydown"`
     * listener on the container passed to {@link setContainer} are the
     * group's own registrations, made against components it does not own, so
     * nothing else releases them — a member or a container that outlives the
     * group would otherwise keep driving a disposed group's reconciliation.
     * Call this before discarding the group.
     */
    dispose(): void {
        for (const [button, handler] of this._actionHandlers) {
            button.off("action", handler);
        }

        this._actionHandlers.clear();

        this.unwireContainer();

        this._rovingTabIndex = null;
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
     *
     * Adding a button that is already a member does nothing: the group holds
     * one `"action"` handler per button so {@link removeButton} and
     * {@link dispose} can remove the exact reference it registered, and a
     * second add would strand the first handler with no way to reach it.
     * @param button - The button to add to the group.
     */
    addButton(button: RadioButton | ToggleButton): this {
        if (this._actionHandlers.has(button)) {
            return this;
        }

        this.buttons.push(button);

        const handler = (): void => {
            this.updateButtonStates(button);
        };

        this._actionHandlers.set(button, handler);
        button.on("action", handler);

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
     * @remarks The group also drops the `"action"` listener it registered on
     * the button, so a removed button no longer deselects its former siblings
     * when it is clicked — it is simply a button again, and the caller may go
     * on using it.
     * @param button - The button to remove.
     */
    removeButton(button: RadioButton | ToggleButton): this {
        let idx = this.buttons.indexOf(button);

        if (idx < 0) {
            return this;
        }

        this.buttons.splice(idx, 1);

        const handler = this._actionHandlers.get(button);

        if (handler !== undefined) {
            button.off("action", handler);
            this._actionHandlers.delete(button);
        }

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
     *
     * Calling this again unwires the container wired last: its key handler is
     * removed and the previous roving index is dropped wholesale, so only the
     * newest container drives the group's navigation. The outgoing index's
     * members are not swept out of it one at a time, because removing the
     * active member from a roving index moves DOM focus — a re-wire must not
     * do that as a side effect.
     * @param container - The component that wraps the buttons and should receive key events.
     */
    setContainer(container: Component): this {
        this.unwireContainer();

        this._rovingTabIndex = new RovingTabIndex();

        for (const button of this.buttons) {
            this._rovingTabIndex.add(button);
        }

        this._container = container;

        Event.addSubtreeListener(container, "keydown", this._onContainerKeyDown);

        return this;
    }

    /**
     * Steps the roving tab index on an arrow key delivered from the wired
     * container's subtree.
     *
     * @param e - The keydown event as delivered by the subtree listener.
     *
     * @returns A disposition suppressing the browser's own arrow-key scroll
     *   when the key moved the group's focus; nothing otherwise, which leaves
     *   the event for [`SpatialNavigation`](/api/core/classes/SpatialNavigation)
     *   or the page to handle.
     */
    private handleContainerKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (SpatialNavigation.claimsKey(e)) { return; }

        const rovingTabIndex = this._rovingTabIndex;

        if (rovingTabIndex === null) {
            return;
        }

        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            rovingTabIndex.moveNext();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            rovingTabIndex.movePrev();
        } else {
            return;
        }

        return { prevent: true };
    }

    /**
     * Removes the `keydown` registration from the container wired last, if
     * there is one. A no-op for a group that was never given a container.
     */
    private unwireContainer(): void {
        if (this._container === null) {
            return;
        }

        Event.removeSubtreeListener(this._container, "keydown", this._onContainerKeyDown);
        this._container = null;
    }
}

const ButtonGroupCallable = callable(ButtonGroup);
type ButtonGroupCallable = ButtonGroup;
export {
    ButtonGroup as _ButtonGroup,
    ButtonGroupCallable as ButtonGroup
};
