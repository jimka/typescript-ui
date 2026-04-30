// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'auto';

/**
 * Configuration object used to define a field on a model.
 * Can be passed directly to `AbstractModel.fields` or used to construct a `Field` instance.
 */
export interface FieldConfig {
    name: string;
    type?: FieldType;
    defaultValue?: any;
    mapping?: string;
    description?: string;
    order?: number;
}

/**
 * Represents a single typed field in a model's schema.
 * Encapsulates the field's name, type, default value, raw-data mapping, description, and display order.
 */
export class Field {

    private name: string;
    private type: FieldType;
    private defaultValue: any;
    private mapping: string;
    private description: string | undefined;
    private order: number | undefined;

    /**
     * Constructs a Field from a FieldConfig object.
     *
     * @param config - The configuration object describing the field's properties.
     */
    constructor(config: FieldConfig) {
        this.name = config.name;
        this.type = config.type ?? 'auto';
        this.defaultValue = config.defaultValue;
        this.mapping = config.mapping ?? config.name;
        this.description = config.description;
        this.order = config.order;
    }

    /**
     * Returns the field's logical name used as the record property key.
     *
     * @returns The logical name string for this field.
     */
    getName(): string {
        return this.name;
    }

    /**
     * Returns the field's data type.
     *
     * @returns The FieldType value for this field.
     */
    getType(): FieldType {
        return this.type;
    }

    /**
     * Returns the value used when raw data does not contain this field.
     *
     * @returns The configured default value, or undefined if none was specified.
     */
    getDefaultValue(): any {
        return this.defaultValue;
    }

    /**
     * Returns the raw-data property name that maps to this field.
     *
     * @returns The mapping key string; defaults to the field name when not explicitly configured.
     */
    getMapping(): string {
        return this.mapping;
    }

    /**
     * Returns the human-readable description, falling back to the field name.
     *
     * @returns The description string if configured, otherwise the field name.
     */
    getDescription(): string {
        return this.description ?? this.name;
    }

    /**
     * Returns the display order index; -1 means unspecified.
     *
     * @returns The configured order value, or -1 if no order was specified.
     */
    getOrder(): number {
        return this.order ?? -1;
    }
}
