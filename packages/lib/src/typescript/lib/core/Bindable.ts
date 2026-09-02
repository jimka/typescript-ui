// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Explicit getter/setter/listener callbacks used by {@link Binding} when a component
 * does not implement the {@link Bindable} interface.
 *
 * @category Data
 */
export interface BindingAccessors<T = unknown> {
    get:    () => T;
    set:    (value: T) => void;
    listen: (fn: () => void) => void;
    /**
     * Accepts the field's current value as clean. Auto-supplied by
     * `Binding.bind()` when the bound component is an `AbstractInput`;
     * supply your own for a component with an equivalent concept. Called by
     * `Binding.commit()` and `Binding.reject()`.
     */
    markClean?: () => void;
}

/**
 * Implemented by components that want to participate in {@link Binding} without
 * supplying explicit accessor callbacks.
 *
 * @category Data
 */
export interface Bindable<T> {
    /** Populate the component with a value from the bound record. */
    setValue(value: T): void;

    /** Read the component's current value to write back to the record. */
    getValue(): T;

    /** Subscribe to user-driven value changes. */
    on(event: "binding", listener: () => void): unknown;
}
