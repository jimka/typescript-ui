// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractModel } from '~/data/AbstractModel.js';

/**
 * A single data record managed by a store.
 *
 * Tracks current field values, dirty state, and new / committed status.
 *
 * @remarks
 * On construction the data snapshot is also stored as `original` so that
 * `reject()` can restore the record to its last committed state without
 * requiring a round-trip to the server.
 *
 * @example
 * ```typescript
 * const record = store.getAt(0);
 * record?.set('age', 31);
 * console.log(record?.isDirty()); // true
 * record?.commit();               // clears dirty flag
 * // record?.reject();            // reverts to last committed snapshot
 * ```
 *
 * @category Data
 */
export class ModelRecord {

    private _model: AbstractModel;
    private _data: Record<string, any>;
    private _original: Record<string, any>;
    private _dirty: boolean = false;
    private _isNew: boolean = false;

    /**
     * Constructs a ModelRecord with the given model schema and initial data.
     *
     * @param model - The AbstractModel that describes this record's field schema.
     * @param data - The initial field values keyed by field name.
     */
    constructor(model: AbstractModel, data: Record<string, any>) {
        this._model = model;
        this._data = { ...data };
        this._original = { ...data };
    }

    /**
     * Returns the value of a field by name.
     *
     * @param field - The logical name of the field to retrieve.
     *
     * @returns The current value of the field, or undefined if the field is not present.
     */
    get(field: string): any {
        return this._data[field];
    }

    /**
     * Sets a field value and marks the record as dirty.
     *
     * @param field - The logical name of the field to update.
     * @param value - The new value to assign to the field.
     */
    set(field: string, value: any): this {
        if (ModelRecord.isEqual(this._data[field], value)) {
            return this;
        }

        this._data[field] = value;
        this._dirty = this._isNew || Object.keys(this._original)
                                          .some(k => !ModelRecord.isEqual(this._data[k], this._original[k]));

        return this;
    }

    private static isEqual(a: any, b: any): boolean {
        if (a instanceof Date && b instanceof Date) {
            return a.getTime() === b.getTime();
        }

        return a === b;
    }

    /**
     * Returns a shallow copy of all field data.
     *
     * @returns A plain object containing all current field values keyed by field name.
     */
    getData(): Record<string, any> {
        return { ...this._data };
    }

    /**
     * Returns true if any field has been changed since the last commit.
     *
     * @returns True if the record has uncommitted changes, false otherwise.
     */
    isDirty(): boolean {
        return this._dirty;
    }

    /**
     * Returns true if this record has not yet been persisted (added via store.add).
     *
     * @returns True if the record is new and has not been synced to the server.
     */
    isNew(): boolean {
        return this._isNew;
    }

    /**
     * Marks the record as newly created and not yet synced to the server.
     */
    markAsNew(): void {
        this._isNew = true;
    }

    /**
     * Accepts current field values as the new baseline, clearing dirty and new flags.
     *
     * @remarks
     * Called automatically by `AbstractStore.sync()` after a successful create or update
     * so that the record no longer appears in subsequent sync cycles.
     */
    commit(): this {
        this._original = { ...this._data };
        this._dirty = false;
        this._isNew = false;

        return this;
    }

    /**
     * Reverts all field values to the last committed state.
     *
     * @remarks
     * The dirty flag is cleared but the new flag is not changed; a new record that has
     * been rejected remains new until it is committed or removed from the store.
     */
    reject(): void {
        this._data = { ...this._original };
        this._dirty = false;
    }

    /**
     * Returns the value of the model's primary-key field, or undefined if none is defined.
     *
     * @returns The primary key value, or undefined if the model has no primary key configured.
     */
    getId(): any {
        const pkField = this._model.getPrimaryKeyField();

        return pkField ? this._data[pkField.getName()] : undefined;
    }

    /**
     * Returns the AbstractModel that describes this record's schema.
     *
     * @returns The model instance associated with this record.
     */
    getModel(): AbstractModel {
        return this._model;
    }
}
