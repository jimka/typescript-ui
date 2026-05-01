// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractModel } from './AbstractModel.js';

/**
 * A single data record managed by a store.
 * Tracks current field values, dirty state, and new/committed status.
 *
 * @remarks
 * On construction the data snapshot is also stored as `original` so that
 * `reject()` can restore the record to its last committed state without
 * requiring a round-trip to the server.
 */
export class ModelRecord {

    private model: AbstractModel;
    private data: Record<string, any>;
    private original: Record<string, any>;
    private dirty: boolean = false;
    private _isNew: boolean = false;

    /**
     * Constructs a ModelRecord with the given model schema and initial data.
     *
     * @param model - The AbstractModel that describes this record's field schema.
     * @param data - The initial field values keyed by field name.
     */
    constructor(model: AbstractModel, data: Record<string, any>) {
        this.model = model;
        this.data = { ...data };
        this.original = { ...data };
    }

    /**
     * Returns the value of a field by name.
     *
     * @param field - The logical name of the field to retrieve.
     *
     * @returns The current value of the field, or undefined if the field is not present.
     */
    get(field: string): any {
        return this.data[field];
    }

    /**
     * Sets a field value and marks the record as dirty.
     *
     * @param field - The logical name of the field to update.
     * @param value - The new value to assign to the field.
     */
    set(field: string, value: any): void {
        if (this.data[field] === value) return;
        this.data[field] = value;
        this.dirty = this._isNew || Object.keys(this.original).some(k => this.data[k] !== this.original[k]);
    }

    /**
     * Returns a shallow copy of all field data.
     *
     * @returns A plain object containing all current field values keyed by field name.
     */
    getData(): Record<string, any> {
        return { ...this.data };
    }

    /**
     * Returns true if any field has been changed since the last commit.
     *
     * @returns True if the record has uncommitted changes, false otherwise.
     */
    isDirty(): boolean {
        return this.dirty;
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
    commit(): void {
        this.original = { ...this.data };
        this.dirty = false;
        this._isNew = false;
    }

    /**
     * Reverts all field values to the last committed state.
     *
     * @remarks
     * The dirty flag is cleared but the new flag is not changed; a new record that has
     * been rejected remains new until it is committed or removed from the store.
     */
    reject(): void {
        this.data = { ...this.original };
        this.dirty = false;
    }

    /**
     * Returns the value of the model's primary-key field, or undefined if none is defined.
     *
     * @returns The primary key value, or undefined if the model has no primary key configured.
     */
    getId(): any {
        const pkField = this.model.getPrimaryKeyField();

        return pkField ? this.data[pkField.getName()] : undefined;
    }

    /**
     * Returns the AbstractModel that describes this record's schema.
     *
     * @returns The model instance associated with this record.
     */
    getModel(): AbstractModel {
        return this.model;
    }
}
