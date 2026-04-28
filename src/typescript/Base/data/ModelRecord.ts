// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractModel } from './AbstractModel.js';

export class ModelRecord {

    private model: AbstractModel;
    private data: Record<string, any>;
    private original: Record<string, any>;
    private dirty: boolean = false;

    constructor(model: AbstractModel, data: Record<string, any>) {
        this.model = model;
        this.data = { ...data };
        this.original = { ...data };
    }

    get(field: string): any {
        return this.data[field];
    }

    set(field: string, value: any): void {
        this.data[field] = value;
        this.dirty = true;
    }

    getData(): Record<string, any> {
        return { ...this.data };
    }

    isDirty(): boolean {
        return this.dirty;
    }

    commit(): void {
        this.original = { ...this.data };
        this.dirty = false;
    }

    reject(): void {
        this.data = { ...this.original };
        this.dirty = false;
    }

    getId(): any {
        const pkField = this.model.getPrimaryKeyField();

        return pkField ? this.data[pkField.getName()] : undefined;
    }

    getModel(): AbstractModel {
        return this.model;
    }
}
