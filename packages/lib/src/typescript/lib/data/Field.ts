// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { ValidationRule } from '~/validation/ValidationRule.js';

/**
 * Built-in field types supported by {@link Model} and {@link AbstractModel}.
 *
 * @category Data
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'time' | 'datetime' | 'glyph' | 'auto';

/**
 * Construction-time options for a {@link Field}.
 * Can be passed directly to `AbstractModel.fields` or used to construct a `Field` instance.
 *
 * @category Data
 */
export interface FieldOptions {
    name: string;
    type?: FieldType;
    defaultValue?: any;
    mapping?: string;
    description?: string;
    order?: number;
    /** Custom raw-to-typed coercion; wins over the built-in `type` conversion. */
    convert?: (raw: any, sourceRecord?: Record<string, any>) => any;
    /** Field-level validation rules, evaluated by {@link ModelRecord} (pull-based). */
    validators?: ValidationRule[];
}

/**
 * @deprecated Use {@link FieldOptions}.
 */
export type FieldConfig = FieldOptions;

/**
 * Represents a single typed field in a model's schema.
 * Encapsulates the field's name, type, default value, raw-data mapping, description, and display order.
 *
 * @category Data
 */
export class Field {

    private _name: string;
    private _type: FieldType;
    private _defaultValue: any;
    private _mapping: string;
    private _description: string | undefined;
    private _order: number | undefined;
    private _convert: ((raw: any, sourceRecord?: Record<string, any>) => any) | undefined;
    private _validators: ValidationRule[];

    /**
     * Constructs a Field from a FieldOptions object.
     *
     * @param options - The options object describing the field's properties.
     */
    constructor(options: FieldOptions) {
        this._name = options.name;
        this._type = options.type ?? 'auto';
        this._defaultValue = options.defaultValue;
        this._mapping = options.mapping ?? options.name;
        this._description = options.description;
        this._order = options.order;
        this._convert = options.convert;
        this._validators = options.validators ?? [];
    }

    /**
     * Returns the field's logical name used as the record property key.
     *
     * @returns The logical name string for this field.
     */
    getName(): string {
        return this._name;
    }

    /**
     * Returns the field's data type.
     *
     * @returns The FieldType value for this field.
     */
    getType(): FieldType {
        return this._type;
    }

    /**
     * Returns the value used when raw data does not contain this field.
     *
     * @returns The configured default value, or undefined if none was specified.
     */
    getDefaultValue(): any {
        return this._defaultValue;
    }

    /**
     * Returns the raw-data property name that maps to this field.
     *
     * @returns The mapping key string; defaults to the field name when not explicitly configured.
     */
    getMapping(): string {
        return this._mapping;
    }

    /**
     * Returns the human-readable description, falling back to the field name.
     *
     * @returns The description string if configured, otherwise the field name.
     */
    getDescription(): string {
        return this._description ?? this._name;
    }

    /**
     * Returns the display order index; -1 means unspecified.
     *
     * @returns The configured order value, or -1 if no order was specified.
     */
    getOrder(): number {
        return this._order ?? -1;
    }

    /**
     * Coerces a raw value to this field's type, or runs the custom `convert` hook.
     *
     * @remarks
     * A configured `convert` callback wins over the built-in type conversion. Otherwise
     * `null`/`undefined` short-circuit to themselves (an absent value never becomes `NaN`,
     * `"null"`, or an Invalid Date), and any other value is routed through the type switch.
     *
     * @param raw - The raw value to coerce.
     * @param sourceRecord - Optional. The full mapped source object, so a custom `convert`
     *   can derive this field from sibling raw values.
     *
     * @returns The coerced value typed according to this field's `type`.
     */
    convertValue(raw: any, sourceRecord?: Record<string, any>): any {
        if (this._convert) {
            return this._convert(raw, sourceRecord);
        }

        if (raw === null || raw === undefined) {
            return raw;
        }

        return this.convertByType(raw);
    }

    /**
     * Coerces a non-null raw value according to this field's built-in `type`.
     *
     * @param raw - The raw value to coerce; guaranteed non-null by the caller.
     *
     * @returns The coerced value, or undefined when the value cannot be coerced to the type.
     */
    private convertByType(raw: any): any {
        switch (this._type) {
            case 'number': {
                if (raw === '') {
                    return undefined;
                }

                const num = Number(raw);

                return num;
            }

            case 'boolean': {
                return this.convertBoolean(raw);
            }

            case 'date':
            case 'datetime':
            case 'time': {
                if (raw instanceof Date) {
                    return raw;
                }

                const date = new Date(raw);

                return isNaN(date.getTime()) ? undefined : date;
            }

            case 'string': {
                return String(raw);
            }

            default: {
                return raw;
            }
        }
    }

    /**
     * Coerces a non-null raw value to a boolean, honouring the common truthy / falsy
     * string and numeric spellings before falling back to `Boolean(raw)`.
     *
     * @param raw - The raw value to coerce; guaranteed non-null by the caller.
     *
     * @returns The coerced boolean value.
     */
    private convertBoolean(raw: any): boolean {
        const truthy = [true, 1, 'true', '1', 'yes'];
        const falsy = [false, 0, 'false', '0', 'no', ''];

        if (truthy.includes(raw)) {
            return true;
        }

        if (falsy.includes(raw)) {
            return false;
        }

        return Boolean(raw);
    }

    /**
     * Returns the configured validation rules, or an empty array.
     *
     * @remarks
     * Evaluated by [`ModelRecord`](/api/data/classes/ModelRecord) on demand; see its
     * pull-based `isValid` / `getErrors` / `validateField` API.
     *
     * @returns The field's validation rules; empty when none were configured.
     */
    getValidators(): ValidationRule[] {
        return this._validators;
    }
}
