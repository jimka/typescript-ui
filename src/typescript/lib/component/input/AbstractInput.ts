// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Bindable } from "~/core/Bindable.js";
import { ListenerBag } from "~/core/ListenerBag.js";

/**
 * String-literal union of the events emitted by every {@link AbstractInput}
 * subclass.
 *
 * @category Components
 */
export type AbstractInputEvent = "change" | "binding";

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
    /**
     * Multi-event listener bag dispatched at construction time. Entries
     * are appended to the subclass's listener bag as if `on(event, fn)`
     * had been called.
     */
    listeners?: {
        change?:  (value: any) => void;
        binding?: () => void;
    };
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
    private _listeners: ListenerBag<AbstractInputEvent> = new ListenerBag<AbstractInputEvent>();

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
     * Registers a listener for one of this input's events.
     *
     * @param event - `"change"` fires on every committed value change with
     *   the new value; `"binding"` fires on every user-driven change with
     *   no arguments (consumed by [`Binding`](/api/core/classes/Binding)).
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "change",  listener: (value: TValue) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: AbstractInputEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback
     * reference must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: AbstractInputEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every registered listener for `event` with `payload`, in
     * registration order. Subclasses call this after committing a
     * user-driven value change.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "change",  value: TValue): void;
    protected emit(event: "binding"): void;
    protected emit(event: AbstractInputEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Fires `"change"` listeners with `value` and `"binding"` listeners
     * with no arguments. Subclasses call this after committing a
     * user-driven value change.
     *
     * @param value - The newly committed value.
     */
    protected notifyChange(value: TValue): void {
        this.emit("change", value);
        this.emit("binding");
    }

    /**
     * @deprecated Use `on("change", fn)`.
     *
     * @param fn - The callback to invoke on each change.
     *
     * @returns This component, for method chaining.
     */
    addChangeListener(fn: (value: TValue) => void): this {
        return this.on("change", fn);
    }

    /**
     * @deprecated Use `off("change", fn)`.
     *
     * @param fn - The callback to remove.
     *
     * @returns This component, for method chaining.
     */
    removeChangeListener(fn: (value: TValue) => void): this {
        return this.off("change", fn);
    }

    /**
     * @deprecated Use `on("binding", fn)`.
     *
     * @param fn - The callback to invoke on each user-driven change.
     *
     * @returns This component, for method chaining.
     */
    addBindingListener(fn: () => void): this {
        return this.on("binding", fn);
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

        if (opts.listeners?.change  !== undefined) this.on("change",  opts.listeners.change);
        if (opts.listeners?.binding !== undefined) this.on("binding", opts.listeners.binding);

        return this;
    }
}

export { AbstractInput };
