// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractModel } from './AbstractModel.js';
import { ModelRecord } from './ModelRecord.js';
import { Proxy } from './proxy/Proxy.js';

type StoreListener<T = any> = (payload: T) => void;
type StoreEvent = 'load' | 'datachanged' | 'add' | 'remove';

interface SorterConfig {
    property: string;
    direction: 'asc' | 'desc';
}

export abstract class AbstractStore {

    abstract readonly model: AbstractModel;
    abstract readonly proxy: Proxy | undefined;

    private allRecords: ModelRecord[] = [];
    private records: ModelRecord[] = [];
    private activeFilterFns: Array<(r: ModelRecord) => boolean> = [];
    private activeSorter: SorterConfig | null = null;
    private listenerMap: Map<string, StoreListener[]> = new Map();

    // ── Loading ──────────────────────────────────────────────────────────────

    async load(): Promise<void> {
        if (!this.proxy) {
            throw new Error('Store.load() called but no proxy is configured');
        }
        const raw = await this.proxy.read();
        this.ingestRaw(raw);
        this.emit('load', { records: this.records });
    }

    loadData(data: any[]): void {
        this.ingestRaw(data);
        this.emit('load', { records: this.records });
    }

    private ingestRaw(data: any[]): void {
        this.allRecords = data.map(item => this.model.createRecord(item));
        this.applyView();
    }

    // ── Access ───────────────────────────────────────────────────────────────

    getRecords(): ModelRecord[] {
        return this.records.slice();
    }

    getAll(): ModelRecord[] {
        return this.allRecords.slice();
    }

    getCount(): number {
        return this.records.length;
    }

    getAt(index: number): ModelRecord | undefined {
        return this.records[index];
    }

    find(property: string, value: any): ModelRecord | undefined {
        return this.records.find(r => r.get(property) === value);
    }

    findAll(property: string, value: any): ModelRecord[] {
        return this.records.filter(r => r.get(property) === value);
    }

    // ── Mutation ─────────────────────────────────────────────────────────────

    add(data: any | any[]): ModelRecord[] {
        const items = Array.isArray(data) ? data : [data];
        const added = items.map(item => this.model.createRecord(item));
        this.allRecords.push(...added);
        this.applyView();
        this.emit('add', { records: added });
        this.emit('datachanged', {});
        return added;
    }

    remove(record: ModelRecord): void {
        const allIdx = this.allRecords.indexOf(record);
        if (allIdx > -1) {
            this.allRecords.splice(allIdx, 1);
        }
        this.applyView();
        this.emit('remove', { record });
        this.emit('datachanged', {});
    }

    removeAll(): void {
        this.allRecords = [];
        this.records = [];
        this.emit('datachanged', {});
    }

    // ── Sort ─────────────────────────────────────────────────────────────────

    sort(property: string, direction: 'asc' | 'desc' = 'asc'): void {
        this.activeSorter = { property, direction };
        this.applyView();
        this.emit('datachanged', {});
    }

    clearSort(): void {
        this.activeSorter = null;
        this.applyView();
        this.emit('datachanged', {});
    }

    // ── Filter ───────────────────────────────────────────────────────────────

    filter(property: string, value: any): void {
        this.activeFilterFns.push(r => r.get(property) === value);
        this.applyView();
        this.emit('datachanged', {});
    }

    filterBy(fn: (record: ModelRecord) => boolean): void {
        this.activeFilterFns.push(fn);
        this.applyView();
        this.emit('datachanged', {});
    }

    clearFilter(): void {
        this.activeFilterFns = [];
        this.applyView();
        this.emit('datachanged', {});
    }

    // ── Events ───────────────────────────────────────────────────────────────

    on(event: StoreEvent, listener: StoreListener): void {
        let bucket = this.listenerMap.get(event);
        if (!bucket) {
            bucket = [];
            this.listenerMap.set(event, bucket);
        }
        bucket.push(listener);
    }

    off(event: StoreEvent, listener: StoreListener): void {
        const bucket = this.listenerMap.get(event);
        if (!bucket) {
            return;
        }
        const idx = bucket.indexOf(listener);
        if (idx > -1) {
            bucket.splice(idx, 1);
        }
    }

    private emit(event: string, payload: any): void {
        const bucket = this.listenerMap.get(event);
        if (!bucket) {
            return;
        }
        for (const listener of bucket) {
            listener(payload);
        }
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private applyView(): void {
        let view = this.allRecords.slice();

        for (const fn of this.activeFilterFns) {
            view = view.filter(fn);
        }

        if (this.activeSorter) {
            const { property, direction } = this.activeSorter;
            view.sort((a, b) => {
                const av = a.get(property);
                const bv = b.get(property);
                if (av == null && bv == null) return 0;
                if (av == null) return 1;
                if (bv == null) return -1;
                const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                return direction === 'asc' ? cmp : -cmp;
            });
        }

        this.records = view;
    }
}
