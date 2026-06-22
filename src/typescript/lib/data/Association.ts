// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractModel } from '~/data/AbstractModel.js';

/**
 * Per-association persistence strategy applied during cascade sync.
 *
 * @remarks
 * `'proxy'` (the default) persists children through the child store's own
 * proxy — the cascade simply calls the child store's `sync()`. `'nested'`
 * serialises children inside the parent's write body under the association's
 * nested key, via {@link ModelRecord.getDataWithNested}; the child store is not
 * synced independently.
 *
 * @category Data
 */
export type AssociationPersist = 'nested' | 'proxy';

/**
 * Construction-time options shared by all association kinds.
 *
 * @category Data
 */
export interface AssociationOptions {
    /** Accessor name exposed on the record (e.g. `'employees'`). */
    accessor: string;
    /** Thunk returning the target model — a thunk to break declaration cycles. */
    target: () => AbstractModel;
    /**
     * The child field holding the owner's id (hasMany) / the owner's primary
     * key this record points at (belongsTo).
     */
    foreignKey: string;
    /** Raw-payload key carrying an embedded child array for eager hydration. Defaults to `accessor`. */
    nestedKey?: string;
    /** Cascade persistence strategy; defaults to `'proxy'`. */
    persist?: AssociationPersist;
    /**
     * Discriminant selecting the concrete association kind when a plain options
     * object is promoted by {@link AbstractModel}. Ignored when an
     * {@link Association} instance is supplied directly.
     */
    kind?: 'hasMany' | 'belongsTo';
}

/**
 * Declarative association descriptor; behaviour lives in
 * {@link AbstractModel} / {@link ModelRecord} / {@link AbstractStore}.
 *
 * @remarks
 * Mirrors {@link Field}: a passive schema object holding name/target/foreignKey
 * and pure getters, with the runtime logic (hydrate, lazy-load, cascade) living
 * in the model, record, and store. The `target` thunk is called at most once and
 * its result memoised, so mutually-referential models can declare each other
 * without a module-initialisation cycle.
 *
 * @category Data
 */
export abstract class Association {

    private _accessor: string;
    private _target: () => AbstractModel;
    private _foreignKey: string;
    private _nestedKey: string | undefined;
    private _persist: AssociationPersist;
    private _resolvedTarget: AbstractModel | undefined;

    /** The concrete kind of this association. */
    abstract readonly kind: 'hasMany' | 'belongsTo';

    /**
     * Constructs an Association from an {@link AssociationOptions} object.
     *
     * @param options - The options describing the accessor, target, and foreign key.
     */
    constructor(options: AssociationOptions) {
        this._accessor = options.accessor;
        this._target = options.target;
        this._foreignKey = options.foreignKey;
        this._nestedKey = options.nestedKey;
        this._persist = options.persist ?? 'proxy';
    }

    /**
     * Returns the accessor name exposed on the record.
     *
     * @returns The accessor string (e.g. `'employees'`).
     */
    getAccessor(): string {
        return this._accessor;
    }

    /**
     * Returns the foreign-key field name.
     *
     * @returns The child field holding the owner's id (hasMany), or the owner's
     *   primary key this record points at (belongsTo).
     */
    getForeignKey(): string {
        return this._foreignKey;
    }

    /**
     * Returns the raw-payload key carrying an embedded child array.
     *
     * @returns The configured nested key, or the accessor name when none was set.
     */
    getNestedKey(): string {
        return this._nestedKey ?? this._accessor;
    }

    /**
     * Returns the cascade persistence strategy.
     *
     * @returns `'nested'` or `'proxy'` (the default).
     */
    getPersist(): AssociationPersist {
        return this._persist;
    }

    /**
     * Resolves and memoises the target model via the configured thunk.
     *
     * @returns The target {@link AbstractModel} instance; the thunk is invoked at
     *   most once across the association's lifetime.
     */
    resolveTarget(): AbstractModel {
        if (this._resolvedTarget === undefined) {
            this._resolvedTarget = this._target();
        }

        return this._resolvedTarget;
    }
}

/**
 * Parent owns many child records, surfaced as a parent-scoped child
 * {@link Store} via {@link ModelRecord.getAssociated}.
 *
 * @category Data
 */
export class HasManyAssociation extends Association {

    readonly kind = 'hasMany' as const;
}

/**
 * Record references a single owner via its foreign key.
 *
 * @remarks
 * Like {@link HasManyAssociation}, {@link ModelRecord.getAssociated} returns a
 * parent-scoped child {@link Store} (filtered to the owner) whose first record is
 * the owner; {@link ModelRecord.getForeignKeyValue} reads the raw FK without
 * loading.
 *
 * @category Data
 */
export class BelongsToAssociation extends Association {

    readonly kind = 'belongsTo' as const;
}
