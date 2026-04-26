// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Field } from './Field.js';
import { ModelRecord } from './ModelRecord.js';

export class Model {

    private fields: Field[];
    private fieldsByName: Map<string, Field>;

    constructor(fields: Field[]) {
        this.fields = fields.slice();
        this.fieldsByName = new Map();
        for (const field of fields) {
            this.fieldsByName.set(field.getName(), field);
        }
    }

    getFields(): Field[] {
        return this.fields;
    }

    getField(name: string): Field | undefined {
        return this.fieldsByName.get(name);
    }

    hasField(name: string): boolean {
        return this.fieldsByName.has(name);
    }

    createRecord(data: Record<string, any> = {}): ModelRecord {
        const mapped: Record<string, any> = {};
        for (const field of this.fields) {
            const raw = data[field.getMapping()];
            mapped[field.getName()] = raw !== undefined ? raw : field.getDefaultValue();
        }
        return new ModelRecord(this, mapped);
    }
}
