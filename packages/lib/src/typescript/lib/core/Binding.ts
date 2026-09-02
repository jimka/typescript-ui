// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BaseObject } from '~/core/BaseObject.js';
import { ModelRecord } from '~/data/ModelRecord.js';
import { Bindable, BindingAccessors } from '~/core/Bindable.js';
import { Component } from '~/core/Component.js';
// core/ reaching into component/ has precedent: core/Panel.ts imports
// Scrollbar from "~/component/container/Scrollbar.js".
import { AbstractInput } from '~/component/input/AbstractInput.js';
import { ListenerBag } from '~/core/ListenerBag.js';
import { ValidationRule, FieldValidationConfig } from '~/validation/ValidationRule.js';
import { FieldDecorator } from '~/validation/FieldDecorator.js';
import { applyRule } from '~/validation/Validator.js';

/**
 * String-literal union of events emitted by {@link Binding}.
 *
 * @category Data
 */
export type BindingEvent = "change" | "commit" | "reject" | "beforerecord";

interface BoundEntry {
    accessors: BindingAccessors<any>;
    active: boolean;
}

/**
 * Listener consulted before a record change takes effect.
 *
 * Receives the *next* record (or `null`) and returns `false` to cancel the
 * change. Any other return value (`true`, `undefined`, …) allows it.
 *
 * @category Data
 */
export type BeforeRecordListener = (next: ModelRecord | null) => boolean;

/**
 * Synchronises a {@link ModelRecord} with a set of UI components.
 *
 * Components are registered with {@link bind}, either as {@link Bindable} implementors
 * (short form) or via explicit accessor callbacks (long form). Once a record is loaded
 * via {@link setRecord}, every bound component is populated from the record's fields.
 * Conversely, whenever a component's value changes, the record is updated automatically.
 *
 * @example Short form — component implements Bindable
 * ```typescript
 * const binding = new Binding()
 *     .bind('name',   nameField)
 *     .bind('active', activeCheckbox)
 *     .bind('role',   roleCombo);
 *
 * binding.setRecord(record);
 * ```
 *
 * @example Long form — explicit accessors for any component
 * ```typescript
 * const binding = new Binding()
 *     .bind('name', myWidget, {
 *         get:    () => myWidget.getValue(),
 *         set:    (v) => myWidget.setValue(v),
 *         listen: (fn) => myWidget.on("change", fn),
 *     });
 * ```
 *
 * @category Data
 */
export class Binding extends BaseObject {

    private _record: ModelRecord | null = null;
    private _entries: Map<string, BoundEntry> = new Map();
    private _listeners: ListenerBag<BindingEvent> = new ListenerBag<BindingEvent>();
    private _validationConfigs: Map<string, FieldValidationConfig> = new Map();
    private _globalValidateOnChange: boolean = false;
    private _loading: boolean = false;

    // ── Registration ────────────────────────────────────────────────────────

    /**
     * Registers a field binding using a component that implements {@link Bindable}.
     *
     * @param fieldName - The record field to bind to.
     * @param component - A component implementing the {@link Bindable} interface.
     */
    bind<T>(fieldName: string, component: Bindable<T>): this;

    /**
     * Registers a field binding using explicit accessor callbacks.
     * Use this overload for components that do not implement {@link Bindable}.
     *
     * @param fieldName - The record field to bind to.
     * @param component - Any object (used only as a placeholder for the overload).
     * @param accessors - Getter, setter, and change-listener callbacks.
     */
    bind<T>(fieldName: string, component: object, accessors: BindingAccessors<T>): this;

    bind<T>(fieldName: string, component: Bindable<T> | object, accessors?: BindingAccessors<T>): this {
        this.unbind(fieldName);

        const acc: BindingAccessors<any> = accessors ?? {
            get:    () => (component as Bindable<T>).getValue(),
            set:    (v: T) => (component as Bindable<T>).setValue(v),
            listen: (fn) => (component as Bindable<T>).on("binding", fn),
        };

        if (acc.markClean === undefined && component instanceof AbstractInput) {
            acc.markClean = () => component.markClean();
        }

        const entry: BoundEntry = { accessors: acc, active: true };
        this._entries.set(fieldName, entry);

        acc.listen(() => {
            if (this._loading) {
                return;
            }

            if (!entry.active || !this._record) {
                return;
            }

            const value = acc.get();
            this._record.set(fieldName, value);

            this.emit("change", fieldName, value);

            this._validateFieldIfLive(fieldName);
        });

        if (this._record) {
            acc.set(this._record.get(fieldName));
        }

        return this;
    }

    /**
     * Removes the binding for the given field.
     * The change listener previously attached to the component becomes a no-op.
     *
     * @param fieldName - The field whose binding should be removed.
     */
    unbind(fieldName: string): this {
        const entry = this._entries.get(fieldName);
        if (entry) {
            entry.active = false;

            this._entries.delete(fieldName);
        }

        return this;
    }

    // ── Record management ────────────────────────────────────────────────────

    /**
     * Loads a record into the binding. All registered components are immediately
     * populated with the corresponding field values. Pass `null` to clear the binding.
     *
     * Before any state mutation, every `on("beforerecord", fn)` listener is
     * consulted; if any returns `false` the
     * call is a complete no-op (no validation reset, no field population) and
     * `this` is returned unchanged.
     *
     * @param record - The record to bind, or `null` to detach.
     */
    setRecord(record: ModelRecord | null): this {
        for (const fn of this._listeners.get("beforerecord") as BeforeRecordListener[]) {
            if (fn(record) === false) {
                return this;
            }
        }

        this._record = record;

        this.clearValidation();

        if (!record) {
            return this;
        }

        this._loading = true;

        try {
            for (const [fieldName, entry] of this._entries) {
                entry.accessors.set(record.get(fieldName));
            }
        } finally {
            this._loading = false;
        }

        for (const [fieldName] of this._validationConfigs) {
            this._validateFieldIfLive(fieldName);
        }

        return this;
    }

    /**
     * Returns the currently bound record, or `null` if none is loaded.
     */
    getRecord(): ModelRecord | null {
        return this._record;
    }

    // ── Commit / reject ──────────────────────────────────────────────────────

    /**
     * Commits the current record, clearing its dirty and new flags.
     * Fires all registered commit listeners.
     */
    commit(): this {
        this._record?.commit();

        for (const [, entry] of this._entries) {
            entry.accessors.markClean?.();
        }

        this.emit("commit");

        return this;
    }

    /**
     * Rejects all changes on the current record and re-syncs every component
     * from the reverted field values. Fires all registered reject listeners.
     * Also clears any active validation error decorations.
     */
    reject(): void {
        this._record?.reject();

        if (this._record) {
            for (const [fieldName, entry] of this._entries) {
                entry.accessors.set(this._record.get(fieldName));
            }
        }

        for (const [, entry] of this._entries) {
            entry.accessors.markClean?.();
        }

        this.clearValidation();

        this.emit("reject");
    }

    // ── Listeners ────────────────────────────────────────────────────────────

    /**
     * Registers a listener for one of this binding's events.
     *
     * @param event - `"change"` fires whenever any bound component changes a
     *   field value, receiving `(fieldName, value)`. `"commit"` fires after
     *   {@link commit}. `"reject"` fires after {@link reject}.
     *   `"beforerecord"` is consulted before {@link setRecord} mutates state;
     *   returning `false` vetoes the call as a complete no-op.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This binding, for method chaining.
     *
     * @remarks `"beforerecord"` veto semantics: iteration stops on the first
     *   `false`; if any listener vetoes, {@link setRecord} returns without
     *   modifying any state. Returning `true` — or anything other than
     *   `false`, including `undefined` — allows the change. Async
     *   confirmation must be handled at the call site — {@link setRecord}
     *   stays synchronous. A listener that itself calls {@link setRecord}
     *   re-enters the same veto loop, which is supported but discouraged.
     *   `null` is a valid `next` value (it represents a clear); a listener
     *   that only wants to guard non-clear switches must short-circuit
     *   `next === null` itself.
     */
    on(event: "change",       listener: (fieldName: string, value: unknown) => void): this;
    on(event: "commit",       listener: () => void): this;
    on(event: "reject",       listener: () => void): this;
    on(event: "beforerecord", listener: BeforeRecordListener): this;
    on(event: BindingEvent,   listener: Function): this {
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
     * @returns This binding, for method chaining.
     */
    off(event: BindingEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order. Internal use only — external callers route
     * dispatch through {@link commit} / {@link reject} / {@link setRecord}.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "change", fieldName: string, value: unknown): void;
    protected emit(event: "commit"): void;
    protected emit(event: "reject"): void;
    protected emit(event: BindingEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    // ── Disposal ────────────────────────────────────────────────────────────

    /**
     * Releases this binding's own resources: detaches every field registered
     * via {@link bind} — mirroring {@link unbind}, so a bound component's
     * still-registered "binding"/"change" listener becomes a permanent
     * no-op instead of writing into a dead binding — then clears the
     * emitted-event listener bag.
     *
     * @remarks Does not touch validation state; see {@link clearValidation}
     *   for that.
     */
    dispose(): void {
        for (const fieldName of [...this._entries.keys()]) {
            this.unbind(fieldName);
        }

        this._listeners.clear();
    }

    // ── Validation ───────────────────────────────────────────────────────────

    /**
     * Attaches one or more validation rules to a bound field.
     *
     * @param fieldName - The field name registered with {@link bind}.
     * @param component - The Component instance to wrap with a {@link FieldDecorator} on error.
     * @param rules - One or more {@link ValidationRule} objects to apply to this field.
     *
     * @returns this, for chaining.
     */
    addValidation(fieldName: string, component: Component, rules: ValidationRule | ValidationRule[]): this {
        const ruleArray = Array.isArray(rules) ? rules : [rules];

        this._validationConfigs.set(fieldName, {
            rules           : ruleArray,
            component,
            validateOnChange: false,
            decorator       : null,
        });

        return this;
    }

    /**
     * Removes all validation rules for a field and clears any existing error decoration.
     *
     * @param fieldName - The field whose validation should be removed.
     *
     * @returns this, for chaining.
     */
    removeValidation(fieldName: string): this {
        const config = this._validationConfigs.get(fieldName);

        if (config?.decorator) {
            config.decorator.clearError();
        }

        this._validationConfigs.delete(fieldName);

        return this;
    }

    /**
     * Runs all registered validation rules against the current field values.
     * Applies or clears {@link FieldDecorator} error state for each validated field.
     *
     * @returns true if all fields pass; false if any field fails.
     */
    validate(): boolean {
        let allValid = true;

        for (const [fieldName] of this._validationConfigs) {
            const valid = this._validateField(fieldName);

            if (!valid) {
                allValid = false;
            }
        }

        return allValid;
    }

    /**
     * Enables or disables live validation (validation on every field change).
     *
     * @param enabled - true to validate on every change event; false for explicit-only.
     */
    setValidateOnChange(enabled: boolean): this {
        this._globalValidateOnChange = enabled;

        return this;
    }

    /**
     * Returns whether live validation is globally enabled.
     *
     * @returns true if live validation is active.
     */
    getValidateOnChange(): boolean {
        return this._globalValidateOnChange;
    }

    /**
     * Clears all error decorations without re-running rules.
     * Called automatically by {@link reject}.
     */
    clearValidation(): this {
        for (const [, config] of this._validationConfigs) {
            if (config.decorator) {
                config.decorator.clearError();
            }
        }

        return this;
    }

    /**
     * Validates a single field and updates its decorator.
     *
     * @param fieldName - The field to validate.
     *
     * @returns true if the field passes all rules.
     */
    private _validateField(fieldName: string): boolean {
        const config = this._validationConfigs.get(fieldName);

        if (!config) {
            return true;
        }

        const entry = this._entries.get(fieldName);
        const value = entry ? entry.accessors.get() : undefined;

        for (const rule of config.rules) {
            const result = applyRule(rule, value);

            if (result.valid) {
                continue;
            }

            if (!config.decorator) {
                const parent = config.component.getParentComponent();

                if (parent) {
                    config.decorator = new FieldDecorator(config.component, parent);
                }
            }

            config.decorator?.showError(result.message);

            return false;
        }

        config.decorator?.clearError();

        return true;
    }

    /**
     * Calls {@link _validateField} only if live validation is active for this field.
     *
     * @param fieldName - The field to conditionally validate.
     */
    private _validateFieldIfLive(fieldName: string): void {
        const config = this._validationConfigs.get(fieldName);

        if (!config) {
            return;
        }

        const live = config.validateOnChange || this._globalValidateOnChange;

        if (live) {
            this._validateField(fieldName);
        }
    }
}
