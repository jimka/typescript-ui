// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Field, FieldConfig } from './Field.js';
import { ModelRecord } from './ModelRecord.js';

export abstract class AbstractModel {

    abstract readonly fields: (Field | FieldConfig)[];

    protected _primaryKey: string | undefined;

    private _resolvedFields: Field[] | undefined;
    private _fieldsByName: Map<string, Field> | undefined;

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

    getPrimaryKeyField(): Field | undefined {
        if (!this._primaryKey) {
            return undefined;
        }

        return this.getField(this._primaryKey);
    }

    getFields(): Field[] {
        this.ensureIndex();

        return this._resolvedFields!;
    }

    getField(name: string): Field | undefined {
        this.ensureIndex();

        return this._fieldsByName!.get(name);
    }

    hasField(name: string): boolean {
        this.ensureIndex();

        return this._fieldsByName!.has(name);
    }

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
