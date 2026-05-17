// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

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
}
