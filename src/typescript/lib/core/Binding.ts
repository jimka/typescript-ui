// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BaseObject } from '~/core/BaseObject.js';
import { ModelRecord } from '~/data/ModelRecord.js';
import { Bindable, BindingAccessors } from '~/core/Bindable.js';
import { Component } from '~/core/Component.js';
import { ValidationRule, FieldValidationConfig } from '~/validation/ValidationRule.js';
import { FieldDecorator } from '~/validation/FieldDecorator.js';
import { applyRule } from '~/validation/Validator.js';

interface BoundEntry {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    accessors: BindingAccessors<any>;
    active: boolean;
}

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
 *         listen: (fn) => myWidget.addChangeListener(fn),
 *     });
 * ```
 *
 * @category Data
 */
export class Binding extends BaseObject {

    private record: ModelRecord | null = null;
    private entries: Map<string, BoundEntry> = new Map();
    private changeListeners:  Array<(fieldName: string, value: unknown) => void> = [];
    private commitListeners:  Array<() => void> = [];
    private rejectListeners:  Array<() => void> = [];
    private validationConfigs: Map<string, FieldValidationConfig> = new Map();
    private globalValidateOnChange: boolean = false;

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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const acc: BindingAccessors<any> = accessors ?? {
            get:    () => (component as Bindable<T>).getValue(),
            set:    (v: T) => (component as Bindable<T>).setValue(v),
            listen: (fn) => (component as Bindable<T>).addBindingListener(fn),
        };

        const entry: BoundEntry = { accessors: acc, active: true };
        this.entries.set(fieldName, entry);

        acc.listen(() => {
            if (!entry.active || !this.record) {
                return;
            }

            const value = acc.get();
            this.record.set(fieldName, value);

            for (const fn of this.changeListeners) {
                fn(fieldName, value);
            }

            this._validateFieldIfLive(fieldName);
        });

        if (this.record) {
            acc.set(this.record.get(fieldName));
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
        const entry = this.entries.get(fieldName);
        if (entry) {
            entry.active = false;

            this.entries.delete(fieldName);
        }

        return this;
    }

    // ── Record management ────────────────────────────────────────────────────

    /**
     * Loads a record into the binding. All registered components are immediately
     * populated with the corresponding field values. Pass `null` to clear the binding.
     *
     * @param record - The record to bind, or `null` to detach.
     */
    setRecord(record: ModelRecord | null): this {
        this.record = record;

        this.clearValidation();

        if (!record) {
            return this;
        }

        for (const [fieldName, entry] of this.entries) {
            entry.accessors.set(record.get(fieldName));
        }

        for (const [fieldName] of this.validationConfigs) {
            this._validateFieldIfLive(fieldName);
        }

        return this;
    }

    /**
     * Returns the currently bound record, or `null` if none is loaded.
     */
    getRecord(): ModelRecord | null {
        return this.record;
    }

    // ── Commit / reject ──────────────────────────────────────────────────────

    /**
     * Commits the current record, clearing its dirty and new flags.
     * Fires all registered commit listeners.
     */
    commit(): this {
        this.record?.commit();

        for (const fn of this.commitListeners) {
            fn();
        }

        return this;
    }

    /**
     * Rejects all changes on the current record and re-syncs every component
     * from the reverted field values. Fires all registered reject listeners.
     * Also clears any active validation error decorations.
     */
    reject(): void {
        this.record?.reject();

        if (this.record) {
            for (const [fieldName, entry] of this.entries) {
                entry.accessors.set(this.record.get(fieldName));
            }
        }

        this.clearValidation();

        for (const fn of this.rejectListeners) {
            fn();
        }
    }

    // ── Listeners ────────────────────────────────────────────────────────────

    /**
     * Registers a listener that fires whenever any bound component changes a field value.
     *
     * @param fn - Called with the field name and new value on every change.
     */
    addChangeListener(fn: (fieldName: string, value: unknown) => void): void {
        this.changeListeners.push(fn);
    }

    /**
     * Registers a listener that fires after {@link commit} is called.
     */
    addCommitListener(fn: () => void): void {
        this.commitListeners.push(fn);
    }

    /**
     * Registers a listener that fires after {@link reject} is called.
     */
    addRejectListener(fn: () => void): void {
        this.rejectListeners.push(fn);
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

        this.validationConfigs.set(fieldName, {
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
        const config = this.validationConfigs.get(fieldName);

        if (config?.decorator) {
            config.decorator.clearError();
        }

        this.validationConfigs.delete(fieldName);

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

        for (const [fieldName] of this.validationConfigs) {
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
        this.globalValidateOnChange = enabled;

        return this;
    }

    /**
     * Returns whether live validation is globally enabled.
     *
     * @returns true if live validation is active.
     */
    getValidateOnChange(): boolean {
        return this.globalValidateOnChange;
    }

    /**
     * Clears all error decorations without re-running rules.
     * Called automatically by {@link reject}.
     */
    clearValidation(): this {
        for (const [, config] of this.validationConfigs) {
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
        const config = this.validationConfigs.get(fieldName);

        if (!config) {
            return true;
        }

        const entry = this.entries.get(fieldName);
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
        const config = this.validationConfigs.get(fieldName);

        if (!config) {
            return;
        }

        const live = config.validateOnChange || this.globalValidateOnChange;

        if (live) {
            this._validateField(fieldName);
        }
    }
}
