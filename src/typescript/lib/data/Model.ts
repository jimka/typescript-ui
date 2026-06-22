// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Field, FieldOptions } from '~/data/Field.js';
import type { Association, AssociationOptions } from '~/data/Association.js';
import { AbstractModel } from '~/data/AbstractModel.js';

/**
 * Construction-time options for {@link Model}.
 *
 * @category Data
 */
export interface ModelOptions {
    fields:        Array<Field | FieldOptions>;
    primaryKey?:   string;
    associations?: Array<Association | AssociationOptions>;
}

/**
 * A concrete, configurable model created at runtime from a field array.
 * Use this class when you do not need a dedicated model subclass.
 *
 * @category Data
 */
export class Model extends AbstractModel {

    readonly fields: (Field | FieldOptions)[];

    /**
     * Constructs a Model with the specified fields and an optional primary key.
     *
     * @param fields - An array of Field instances or FieldOptions objects that define the schema, or a {@link ModelOptions} bag.
     * @param primaryKey - Optional. The name of the field to use as the primary key. Ignored when the first argument is a {@link ModelOptions} bag.
     */
    constructor(fields: Array<Field | FieldOptions> | ModelOptions, primaryKey?: string) {
        super();

        if (Array.isArray(fields)) {
            this.fields = fields;
            this._primaryKey = primaryKey;
        } else {
            this.fields = fields.fields;
            this._primaryKey = fields.primaryKey;
            this.associations = fields.associations;
        }
    }
}
