// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Field, FieldConfig } from './Field.js';
import { ModelRecord } from './ModelRecord.js';

/**
 * Base class for all data models.
 * Defines the field schema used to create and validate ModelRecord instances.
 *
 * @remarks
 * Subclasses must declare the `fields` array. Field resolution and the name-to-field
 * index are built lazily on first access and cached for subsequent calls.
 */
export abstract class AbstractModel {

    abstract readonly fields: (Field | FieldConfig)[];

    protected _primaryKey: string | undefined;

    private _resolvedFields: Field[] | undefined;
    private _fieldsByName: Map<string, Field> | undefined;

    /**
     * Lazily builds the resolved fields list and name-to-field index on first access.
     *
     * @remarks
     * Plain `FieldConfig` objects in the `fields` array are promoted to `Field` instances
     * on the first call; subsequent calls return immediately.
     */
    private ensureIndex(): void {
        if (this._resolvedFields) {
            return;
        }

        this._resolvedFields = this.fields.map(f => f instanceof Field ? f : new Field(f));
        this._fieldsByName = new Map();

        for (const field of this._resolvedFields) {
            this._fieldsByName.set(field.getName(), field);
        }
    }

    /**
     * Returns the Field designated as the primary key, or undefined if none is set.
     *
     * @returns The primary key Field, or undefined if no primary key has been configured.
     */
    getPrimaryKeyField(): Field | undefined {
        if (!this._primaryKey) {
            return undefined;
        }

        return this.getField(this._primaryKey);
    }

    /**
     * Returns all resolved Field instances for this model.
     *
     * @returns An array of all Field instances defined on this model.
     */
    getFields(): Field[] {
        this.ensureIndex();

        return this._resolvedFields!;
    }

    /**
     * Returns the Field with the given name, or undefined if not found.
     *
     * @param name - The logical name of the field to look up.
     *
     * @returns The matching Field, or undefined if no field with that name exists.
     */
    getField(name: string): Field | undefined {
        this.ensureIndex();

        return this._fieldsByName!.get(name);
    }

    /**
     * Returns true if the model contains a field with the given name.
     *
     * @param name - The logical name of the field to check.
     *
     * @returns True if a field with the given name exists, false otherwise.
     */
    hasField(name: string): boolean {
        this.ensureIndex();

        return this._fieldsByName!.has(name);
    }

    /**
     * Creates a ModelRecord from a plain object or positional array, applying field mappings and defaults.
     *
     * @param data - Optional. The source data as a key/value object or a positional array.
     *   When an array is provided, values are assigned to fields ordered by their `order` property.
     *
     * @returns A new ModelRecord populated with mapped and defaulted field values.
     *
     * @remarks
     * When `data` is an array, fields are sorted by their `order` value before being matched
     * by position. Fields absent from `data` receive the value from `field.getDefaultValue()`.
     */
    createRecord(data: Record<string, any> | any[] = {}): ModelRecord {
        this.ensureIndex();

        let source: Record<string, any>;

        if (Array.isArray(data)) {
            const sorted = this._resolvedFields!.slice().sort((a, b) => a.getOrder() - b.getOrder());

            source = {};

            sorted.forEach((field, i) => {
                source[field.getMapping()] = data[i];
            });
        } else {
            source = data;
        }

        const mapped: Record<string, any> = {};

        for (const field of this._resolvedFields!) {
            const raw = source[field.getMapping()];

            mapped[field.getName()] = raw !== undefined ? raw : field.getDefaultValue();
        }

        return new ModelRecord(this, mapped);
    }
}
