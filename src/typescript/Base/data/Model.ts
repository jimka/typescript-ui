// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Field, FieldConfig } from './Field.js';
import { AbstractModel } from './AbstractModel.js';

/**
 * A concrete, configurable model created at runtime from a field array.
 * Use this class when you do not need a dedicated model subclass.
 */
export class Model extends AbstractModel {

    readonly fields: (Field | FieldConfig)[];

    /**
     * Constructs a Model with the specified fields and an optional primary key.
     *
     * @param fields - An array of Field instances or FieldConfig objects that define the schema.
     * @param primaryKey - Optional. The name of the field to use as the primary key.
     */
    constructor(fields: Array<Field | FieldConfig>, primaryKey?: string) {
        super();

        this.fields = fields;
        this._primaryKey = primaryKey;
    }
}
