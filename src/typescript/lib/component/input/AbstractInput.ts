// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Bindable } from "~/core/Bindable.js";

/**
 * Construction-time options for {@link AbstractInput}. Extended by every
 * value-bearing input control so the `enabled` / `readOnly` flags share a
 * single options surface.
 *
 * @category Components
 */
export interface AbstractInputOptions extends ComponentOptions {
    enabled?:  boolean;
    readOnly?: boolean;
}

/**
 * Abstract base for every value-bearing input control in the framework.
 *
 * Owns the [`Bindable`](/api/core/interfaces/Bindable) value contract, the
 * change/binding listener bookkeeping, and the cached `_options.enabled` /
 * `_options.readOnly` state. Concrete subclasses own their value storage
 * and implement the `applyEnabled` / `applyReadOnly` hooks for their own
 * visual + ARIA wiring.
 *
 * Not wrapped with `callable()` — abstract classes are never instantiated;
 * the [ARCHITECTURE.md](/ARCHITECTURE.md) rule about callable-wrapping
 * applies only to concrete component subclasses.
 *
 * @category Components
 */
abstract class AbstractInput<
    TValue,
    TOptions extends AbstractInputOptions = AbstractInputOptions
>
    extends Component<TOptions>
    implements Bindable<TValue>
{
    protected _changeListeners:  Array<(value: TValue) => void> = [];
    protected _bindingListeners: Array<() => void>              = [];

    /**
     * @param options - Caller-supplied options bag.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded to `Component` so the cascade can merge
     *   it before dispatching setters.
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(options, subclassDefaults);
    }

    /**
     * Returns the current value. Concrete subclasses define the storage —
     * `Checkbox` aliases `isSelected`, `Slider` reads `_options.value`,
     * picker fields keep a private `_value` outside the options bag.
     *
     * @returns The current value.
     */
    abstract getValue(): TValue;

    /**
     * Sets the current value. Concrete subclasses implement the storage
     * write, normalisation, and any listener-firing for user-driven
     * commits.
     *
     * @param value - The new value.
     *
     * @returns This component, for method chaining.
     */
    abstract setValue(value: TValue): this;

    /**
     * Returns whether the control is enabled.
     *
     * @returns `true` when enabled (defaults to `true` when unset).
     */
    isEnabled(): boolean {
        return this._options.enabled ?? true;
    }

    /**
     * Enables or disables the control. Dispatches `applyEnabled` so the
     * subclass can reflect the state in its visuals + ARIA tree.
     *
     * @param value - `true` to enable, `false` to disable.
     *
     * @returns This component, for method chaining.
     */
    setEnabled(value: boolean): this {
        this._options.enabled = !!value;
        this.applyEnabled(this._options.enabled);

        return this;
    }

    /**
     * Returns whether the control is read-only.
     *
     * @returns `true` when read-only (defaults to `false` when unset).
     */
    isReadOnly(): boolean {
        return this._options.readOnly ?? false;
    }

    /**
     * Marks the control as read-only. Dispatches `applyReadOnly` so the
     * subclass can reflect the state in its visuals + ARIA tree.
     *
     * @param value - `true` to mark read-only.
     *
     * @returns This component, for method chaining.
     */
    setReadOnly(value: boolean): this {
        this._options.readOnly = !!value;
        this.applyReadOnly(this._options.readOnly);

        return this;
    }

    /**
     * Registers a callback fired on every user-driven and programmatic value
     * change. The callback receives the current value.
     *
     * @param fn - The callback to invoke on each change.
     *
     * @returns This component, for method chaining.
     */
    addChangeListener(fn: (value: TValue) => void): this {
        this._changeListeners.push(fn);

        return this;
    }

    /**
     * Removes a previously registered change listener. The exact callback
     * reference must match.
     *
     * @param fn - The callback to remove.
     *
     * @returns This component, for method chaining.
     */
    removeChangeListener(fn: (value: TValue) => void): this {
        const idx = this._changeListeners.indexOf(fn);

        if (idx >= 0) {
            this._changeListeners.splice(idx, 1);
        }

        return this;
    }

    /**
     * Subscribes a callback invoked on every user-driven value change. Used
     * by the [`Bindable`](/api/core/interfaces/Bindable) interface.
     *
     * @param fn - The callback to invoke on each change.
     *
     * @returns This component, for method chaining.
     */
    addBindingListener(fn: () => void): this {
        this._bindingListeners.push(fn);

        return this;
    }

    /**
     * Fires every registered change listener with `value` and every
     * registered binding listener with no arguments. Subclasses call this
     * after committing a user-driven value change.
     *
     * @param value - The newly committed value.
     */
    protected notifyChange(value: TValue): void {
        for (const fn of this._changeListeners) {
            fn(value);
        }

        for (const fn of this._bindingListeners) {
            fn();
        }
    }

    /**
     * Subclass hook: reflect the enabled state in visuals + ARIA. Called
     * from {@link setEnabled} after the cached state is updated.
     *
     * @param value - The new enabled state.
     */
    protected abstract applyEnabled(value: boolean): void;

    /**
     * Subclass hook: reflect the read-only state in visuals + ARIA. Called
     * from {@link setReadOnly} after the cached state is updated.
     *
     * @param value - The new read-only state.
     */
    protected abstract applyReadOnly(value: boolean): void;

    /**
     * Applies an {@link AbstractInputOptions} bag, caching the `enabled` /
     * `readOnly` flags on `_options`. The setters are intentionally NOT
     * dispatched here: subclasses build their children after `super()`
     * returns and dispatch `applyEnabled` / `applyReadOnly` themselves from
     * the constructor tail once those children exist (otherwise the abstract
     * `applyX` hooks would fire against half-built state).
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as TOptions;

        if (opts.enabled  !== undefined) this._options.enabled  = opts.enabled;
        if (opts.readOnly !== undefined) this._options.readOnly = opts.readOnly;

        return this;
    }
}

export { AbstractInput };
