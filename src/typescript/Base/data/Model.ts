// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Field, FieldConfig } from './Field.js';
import { AbstractModel } from './AbstractModel.js';

export class Model extends AbstractModel {

    readonly fields: (Field | FieldConfig)[];

    constructor(fields: Array<Field | FieldConfig>) {
        super();
        this.fields = fields;
    }
}
