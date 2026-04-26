// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Model } from './Model.js';

export class ModelRecord {

    private model: Model;
    private data: Record<string, any>;
    private original: Record<string, any>;
    private dirty: boolean = false;

    constructor(model: Model, data: Record<string, any>) {
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

    getModel(): Model {
        return this.model;
    }
}
