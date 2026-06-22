// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractModel } from '~/data/AbstractModel.js';
import { AbstractStore } from '~/data/AbstractStore.js';
import { Association } from '~/data/Association.js';
import { Field } from '~/data/Field.js';
import { Store } from '~/data/Store.js';
import { Model } from '~/data/Model.js';
import { applyRule } from '~/validation/Validator.js';

// Monotonic per-session id source for client-side row keys; never leaves the client,
// so a plain counter suffices (no UUID / collision concern across sessions).
let nextInternalId = 1;

// Recursion cap for deep value equality. Model field values are JSON-shaped and
// acyclic in practice; this bound stops a pathologically deep or accidentally
// cyclic structure from overflowing the stack. Beyond it we fall back to `===`
// for that sub-comparison rather than tracking a visited-set on every set().
const MAX_EQUALITY_DEPTH = 100;

/**
 * A single field's before / after values, as returned by
 * {@link ModelRecord.getChanges} and {@link ModelRecord.getModified}.
 *
 * @category Data
 */
export interface FieldChange {
    old: any;
    new: any;
}

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
    private _internalId: number;

    // Embedded child rows captured from the parent payload at createRecord time,
    // keyed by association accessor. Kept out of `_data` so getData() / the proxy
    // writers never see them; consumed once when the child store is first built.
    private _associatedSeed: Record<string, any[]>;

    // Lazily-built per-accessor child stores, so repeated getAssociated() calls
    // return the same instance (stable identity for listeners and the collection
    // id-index). Allocated on first access.
    private _childStores: Map<string, AbstractStore> | undefined;

    /**
     * Constructs a ModelRecord with the given model schema and initial data.
     *
     * @param model - The AbstractModel that describes this record's field schema.
     * @param data - The initial field values keyed by field name.
     * @param associatedSeed - Optional. Embedded child rows from the parent
     *   payload, keyed by association accessor, used to seed child stores on
     *   first access. Never enters `_data` and is never serialised.
     */
    constructor(model: AbstractModel, data: Record<string, any>, associatedSeed: Record<string, any[]> = {}) {
        this._model = model;
        this._data = { ...data };
        this._original = { ...data };
        this._internalId = nextInternalId++;
        this._associatedSeed = associatedSeed;
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
        const modelField = this._model.getField(field);
        const converted = modelField ? modelField.convertValue(value, this._data) : value;

        if (ModelRecord.isEqual(this._data[field], converted)) {
            return this;
        }

        this._data[field] = converted;
        this._dirty = this._isNew || Object.keys(this._original)
                                          .some(k => !ModelRecord.isEqual(this._data[k], this._original[k]));

        return this;
    }

    /**
     * Structural value equality used for dirty-tracking: primitives by SameValueZero,
     * `Date` by time, arrays and plain objects deep, class instances by reference.
     *
     * @param a - The first value to compare.
     * @param b - The second value to compare.
     *
     * @returns True when the two values are structurally equal for dirty-tracking purposes.
     */
    private static isEqual(a: any, b: any): boolean {
        return ModelRecord.isEqualAtDepth(a, b, 0);
    }

    /**
     * Recursive core of {@link ModelRecord.isEqual}, carrying the depth budget.
     *
     * @param a - The first value to compare.
     * @param b - The second value to compare.
     * @param depth - The current recursion depth, capped by `MAX_EQUALITY_DEPTH`.
     *
     * @returns True when the two values are structurally equal at this depth.
     */
    private static isEqualAtDepth(a: any, b: any, depth: number): boolean {
        if (a === b) {
            return true;
        }

        if (a !== a && b !== b) {
            return true;
        }

        if (a === null || a === undefined || b === null || b === undefined) {
            return false;
        }

        if (a instanceof Date && b instanceof Date) {
            return a.getTime() === b.getTime();
        }

        if (depth >= MAX_EQUALITY_DEPTH) {
            return a === b;
        }

        if (Array.isArray(a) || Array.isArray(b)) {
            return Array.isArray(a) && Array.isArray(b) && ModelRecord.arraysEqual(a, b, depth);
        }

        if (ModelRecord.isPlainObject(a) && ModelRecord.isPlainObject(b)) {
            return ModelRecord.plainObjectsEqual(a, b, depth);
        }

        return false;
    }

    /**
     * Compares two arrays element-wise, recursing one level deeper per element.
     *
     * @param a - The first array.
     * @param b - The second array.
     * @param depth - The current recursion depth.
     *
     * @returns True when both arrays have equal length and structurally-equal elements.
     */
    private static arraysEqual(a: any[], b: any[], depth: number): boolean {
        if (a.length !== b.length) {
            return false;
        }

        for (let i = 0; i < a.length; i++) {
            if (!ModelRecord.isEqualAtDepth(a[i], b[i], depth + 1)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Compares two plain objects by own-enumerable keys, recursing one level deeper per key.
     *
     * @param a - The first plain object.
     * @param b - The second plain object.
     * @param depth - The current recursion depth.
     *
     * @returns True when both objects share the same key set and structurally-equal values.
     */
    private static plainObjectsEqual(a: Record<string, any>, b: Record<string, any>, depth: number): boolean {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);

        if (aKeys.length !== bKeys.length) {
            return false;
        }

        for (const key of aKeys) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) {
                return false;
            }

            if (!ModelRecord.isEqualAtDepth(a[key], b[key], depth + 1)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Reports whether a value is a plain object (prototype is `Object.prototype` or `null`).
     *
     * @param value - The value to test.
     *
     * @returns True for plain data objects; false for class instances, arrays, and primitives.
     */
    private static isPlainObject(value: any): boolean {
        if (typeof value !== 'object' || value === null) {
            return false;
        }

        const proto = Object.getPrototypeOf(value);

        return proto === Object.prototype || proto === null;
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

    /**
     * Returns the stable client-side id assigned at construction.
     *
     * @remarks
     * Unlike `getId()` (the primary-key value, which is `undefined` until the server
     * replies), this id exists immediately and is unique within the session, so UI can
     * use it as a key for unsynced rows. It is never serialised and never sent to the server.
     *
     * @returns The monotonic per-session internal id.
     */
    getInternalId(): number {
        return this._internalId;
    }

    /**
     * Returns the cached, parent-scoped child {@link AbstractStore} for an
     * association accessor, building it on first access.
     *
     * @remarks
     * Repeated calls for the same accessor return the **same** store instance, so
     * listeners and the collection id-index stay stable. For a hasMany association
     * the store is seeded from an embedded child array when the parent payload
     * carried one (eager), otherwise it is configured to load through the target
     * model's proxy filtered on the parent's foreign key (lazy). For a belongsTo
     * association the store is filtered to the single owner record.
     *
     * @param accessor - The association accessor declared on this record's model.
     *
     * @returns The cached child store for that association.
     *
     * @throws Error when no association with that accessor exists (programmer error).
     */
    getAssociated(accessor: string): AbstractStore {
        const cached = this._childStores?.get(accessor);

        if (cached) {
            return cached;
        }

        const association = this._model.getAssociation(accessor);

        if (!association) {
            throw new Error(`ModelRecord.getAssociated: no association '${accessor}'`);
        }

        const store = this.buildChildStore(association);

        (this._childStores ??= new Map()).set(accessor, store);

        return store;
    }

    /**
     * Builds the parent-scoped child store for an association.
     *
     * @remarks
     * The target model is resolved through the association's memoised thunk. A
     * hasMany association with an embedded seed loads those rows directly (each
     * committed, not new); otherwise it carries a `remoteFilter` on the parent
     * foreign key for the lazy load path. A belongsTo association filters the
     * target store to the owner via the foreign-key value.
     *
     * @param association - The association whose child store is built.
     *
     * @returns A freshly-constructed {@link Store} for the target model.
     */
    private buildChildStore(association: Association): AbstractStore {
        const targetModel = association.resolveTarget() as Model;

        if (association.kind === 'belongsTo') {
            const pkName = targetModel.getPrimaryKeyField()?.getName() ?? association.getForeignKey();

            return new Store({
                model: targetModel,
                remoteFilter: true,
                filters: [{ type: 'eq', field: pkName, value: this.get(association.getForeignKey()) }],
            });
        }

        const seed = this._associatedSeed[association.getAccessor()];

        if (seed) {
            const store = new Store({ model: targetModel });

            store.loadData(seed);

            return store;
        }

        return new Store({
            model: targetModel,
            remoteFilter: true,
            filters: [{ type: 'eq', field: association.getForeignKey(), value: this.getId() }],
        });
    }

    /**
     * Reports whether a child store for an association has already been built.
     *
     * @remarks
     * Used by the parent store's cascade sync to skip associations whose child
     * store was never materialised — a loaded-but-untouched parent then costs
     * nothing.
     *
     * @param accessor - The association accessor to test.
     *
     * @returns True when {@link getAssociated} has already built that store.
     */
    hasChildStore(accessor: string): boolean {
        return this._childStores?.has(accessor) ?? false;
    }

    /**
     * Returns the raw foreign-key value for a belongsTo accessor, without loading.
     *
     * @param accessor - The belongsTo association accessor.
     *
     * @returns The foreign-key field value held on this record.
     *
     * @throws Error when no association with that accessor exists (programmer error).
     */
    getForeignKeyValue(accessor: string): any {
        const association = this._model.getAssociation(accessor);

        if (!association) {
            throw new Error(`ModelRecord.getForeignKeyValue: no association '${accessor}'`);
        }

        return this.get(association.getForeignKey());
    }

    /**
     * Returns this record's data augmented with embedded children for every
     * `'nested'`-persist association whose child store was materialised.
     *
     * @remarks
     * Unlike {@link getData}, which never carries children, this is the hook a
     * nested-aware writer reads to serialise children inside the parent's write
     * body. Each materialised `'nested'` association contributes
     * `{ [nestedKey]: childRecordsData }`; `'proxy'`-persist associations and
     * unbuilt stores are omitted (they persist through their own proxy).
     *
     * @returns A plain object: the field data plus nested child-record arrays.
     */
    getDataWithNested(): Record<string, any> {
        const data = this.getData();

        for (const association of this._model.getAssociations()) {
            if (association.kind !== 'hasMany' || association.getPersist() !== 'nested') {
                continue;
            }

            if (!this.hasChildStore(association.getAccessor())) {
                continue;
            }

            const child = this.getAssociated(association.getAccessor());

            data[association.getNestedKey()] = child.getAll().map(r => r.getData());
        }

        return data;
    }

    /**
     * Returns the fields whose current value differs from the last committed baseline.
     *
     * @remarks
     * Comparison uses the same structural equality as dirty tracking, so plain object /
     * array field values compare deeply; class instances still compare by reference.
     *
     * @returns A map of changed field name to its `{ old, new }` values; empty when clean.
     */
    getChanges(): Record<string, FieldChange> {
        const changes: Record<string, FieldChange> = {};

        for (const key of Object.keys(this._data)) {
            if (!ModelRecord.isEqual(this._data[key], this._original[key])) {
                changes[key] = { old: this._original[key], new: this._data[key] };
            }
        }

        return changes;
    }

    /**
     * Returns the modified fields as a `{ old, new }` map.
     *
     * @remarks
     * Alias of {@link ModelRecord.getChanges}; both names are provided for caller intent.
     *
     * @returns A map of modified field name to its `{ old, new }` values; empty when clean.
     */
    getModified(): Record<string, FieldChange> {
        return this.getChanges();
    }

    /**
     * Returns a copy of this record carrying a fresh internal id, marked new and dirty.
     *
     * @remarks
     * A clone is a distinct row, so it receives its own `internalId` and is flagged as a
     * new, dirty insert. The data is shallow-copied (object / array field values are shared
     * with the source, matching the shallow contract elsewhere in this class).
     *
     * @returns A new {@link ModelRecord} for the same model with copied field data.
     */
    clone(): ModelRecord {
        const copy = new ModelRecord(this._model, { ...this._data });

        copy.markAsNew();
        copy._dirty = true;

        return copy;
    }

    /**
     * Returns true when every field passes its implicit type check and explicit validators.
     *
     * @returns True when no field reports an error, false otherwise.
     */
    isValid(): boolean {
        return Object.keys(this.getErrors()).length === 0;
    }

    /**
     * Returns the first failing message for each currently-invalid field.
     *
     * @returns A map of field name to its first error message; empty when the record is valid.
     */
    getErrors(): Record<string, string> {
        const errors: Record<string, string> = {};

        for (const field of this._model.getFields()) {
            const message = this.validateField(field.getName());

            if (message) {
                errors[field.getName()] = message;
            }
        }

        return errors;
    }

    /**
     * Validates a single field, returning its first failing message.
     *
     * @remarks
     * An implicit type check runs first: a non-null value on a typed (non-`auto`/`glyph`)
     * field that fails coercion reports a type error before the explicit `validators` run.
     *
     * @param name - The logical name of the field to validate.
     *
     * @returns The first error message, or `''` when the field is valid or is not a model field.
     */
    validateField(name: string): string {
        const field = this._model.getField(name);

        if (!field) {
            return '';
        }

        const value = this._data[name];
        const typeError = this.checkType(field, value);

        if (typeError) {
            return typeError;
        }

        for (const rule of field.getValidators()) {
            const result = applyRule(rule, value);

            if (!result.valid) {
                return result.message;
            }
        }

        return '';
    }

    /**
     * Runs the implicit, conversion-derived type check for a field value.
     *
     * @remarks
     * Skips `auto` / `glyph` fields (no type to enforce) and `null` / `undefined` values
     * (absence is governed by a `required` rule, not the type check). For every other typed
     * field, a stored value that re-coerces to `undefined` (a `number` holding `NaN`, a date
     * holding an Invalid Date) is reported as a type error.
     *
     * @param field - The field whose declared type is enforced.
     * @param value - The current stored value for that field.
     *
     * @returns The type-error message, or `''` when the value satisfies the field's type.
     */
    private checkType(field: Field, value: any): string {
        const type = field.getType();

        if (type === 'auto' || type === 'glyph' || value === null || value === undefined) {
            return '';
        }

        const coerced = field.convertValue(value);
        const failed = coerced === undefined
            || (typeof coerced === 'number' && isNaN(coerced));

        if (failed) {
            return `Value is not a valid ${type}.`;
        }

        return '';
    }
}
