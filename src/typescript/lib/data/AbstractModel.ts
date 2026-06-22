// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Field, FieldOptions } from '~/data/Field.js';
import { ModelRecord } from '~/data/ModelRecord.js';
import { Association, AssociationOptions, HasManyAssociation, BelongsToAssociation } from '~/data/Association.js';

/**
 * Base class for all data models.
 * Defines the field schema used to create and validate ModelRecord instances.
 *
 * @remarks
 * Subclasses must declare the `fields` array. Field resolution and the name-to-field
 * index are built lazily on first access and cached for subsequent calls.
 *
 * @category Data
 */
export abstract class AbstractModel {

    abstract readonly fields: (Field | FieldOptions)[];

    /**
     * Optional association schema, mirroring `fields`. Declaring an association
     * surfaces a parent-scoped child {@link Association} accessor on records via
     * {@link ModelRecord.getAssociated}. Defaults to none, so every model that
     * omits it compiles and behaves unchanged.
     *
     * @remarks
     * Set once at construction (subclasses assign it, like `fields`); treated as
     * read-only schema thereafter. It is not `readonly` only so the {@link Model}
     * runtime subclass can assign it from its options bag.
     */
    associations?: (Association | AssociationOptions)[];

    protected _primaryKey: string | undefined;

    private _resolvedFields: Field[] | undefined;
    private _fieldsByName: Map<string, Field> | undefined;
    private _resolvedAssociations: Association[] | undefined;
    private _associationsByAccessor: Map<string, Association> | undefined;

    /**
     * Lazily builds the resolved fields list and name-to-field index on first access.
     *
     * @remarks
     * Plain [`FieldConfig`](/api/data/type-aliases/FieldConfig) objects in the `fields` array are promoted to [`Field`](/api/data/classes/Field) instances
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

        this._resolvedAssociations = (this.associations ?? []).map(a => AbstractModel.promoteAssociation(a));
        this._associationsByAccessor = new Map();

        for (const association of this._resolvedAssociations) {
            this._associationsByAccessor.set(association.getAccessor(), association);

            this.assertNestedKeyFree(association);
        }
    }

    /**
     * Promotes a plain {@link AssociationOptions} object to the concrete
     * {@link Association} subclass named by its `kind` discriminant.
     *
     * @param association - An already-built association, or an options object.
     *
     * @returns The supplied {@link Association}, or a freshly-built
     *   {@link HasManyAssociation} / {@link BelongsToAssociation}.
     */
    private static promoteAssociation(association: Association | AssociationOptions): Association {
        if (association instanceof Association) {
            return association;
        }

        return association.kind === 'belongsTo'
            ? new BelongsToAssociation(association)
            : new HasManyAssociation(association);
    }

    /**
     * Asserts that an association's nested key does not collide with any field's
     * raw-data mapping, which would let an embedded child array be mis-read by
     * the field-mapping loop in {@link createRecord}.
     *
     * @param association - The association whose nested key is checked.
     */
    private assertNestedKeyFree(association: Association): void {
        const nestedKey = association.getNestedKey();

        for (const field of this._resolvedFields!) {
            if (field.getMapping() === nestedKey) {
                throw new Error(`AbstractModel: association '${association.getAccessor()}' nested key '${nestedKey}' collides with field '${field.getName()}' mapping`);
            }
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
     * Returns all resolved {@link Association} instances for this model.
     *
     * @returns An array of every association defined on this model; empty when none.
     */
    getAssociations(): Association[] {
        this.ensureIndex();

        return this._resolvedAssociations!;
    }

    /**
     * Returns the {@link Association} with the given accessor, or undefined.
     *
     * @param accessor - The accessor name to look up.
     *
     * @returns The matching association, or undefined when none is declared.
     */
    getAssociation(accessor: string): Association | undefined {
        this.ensureIndex();

        return this._associationsByAccessor!.get(accessor);
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
            const value = raw !== undefined ? raw : field.getDefaultValue();

            mapped[field.getName()] = field.convertValue(value, source);
        }

        const seed: Record<string, any[]> = {};

        for (const association of this._resolvedAssociations!) {
            const raw = source[association.getNestedKey()];

            if (association.kind === 'hasMany' && Array.isArray(raw)) {
                seed[association.getAccessor()] = raw;
            }
        }

        return new ModelRecord(this, mapped, seed);
    }
}
