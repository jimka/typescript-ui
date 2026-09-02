// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

//
// Coverage for Table's store-derived dirty-state bridge: Table.isDirty()
// (inherited from Component, see plans/implemented/component-dirty-state.md)
// reflects its bound store's hasPendingChanges(), recomputed on every store
// event that can change that flag, and re-derived on setStore(). See
// plans/in-progress/table-store-dirty-bridge.md.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { TreeTable } from '~/component/table/TreeTable';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

const MODEL = new Model([
    { name: 'id',   type: 'number' },
    { name: 'name', type: 'string' },
], 'id');

describe('Table dirty state — initial state', () => {
    it('a Table over an empty, never-loaded store is not dirty', () => {
        const table = new Table(new MemoryStore(MODEL, []));

        expect(table.isDirty()).toBe(false);
    });

    it('a Table constructed over an already-dirty store reports dirty immediately', () => {
        const store = new MemoryStore(MODEL, []);
        store.add({ id: 1, name: 'A' });

        const table = new Table(store);

        expect(table.isDirty()).toBe(true);
    });
});

describe('Table dirty state — reacting to store mutation', () => {
    it('store.add() on an already-constructed table dirties it', () => {
        const store = new MemoryStore(MODEL, []);
        const table = new Table(store);

        store.add({ id: 1, name: 'A' });

        expect(table.isDirty()).toBe(true);
    });

    it('onDirtyChange fires exactly once per real transition', () => {
        const store    = new MemoryStore(MODEL, []);
        const table    = new Table(store);
        const listener = vi.fn();
        table.onDirtyChange(listener);

        store.add({ id: 1, name: 'A' });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(true);

        store.add({ id: 2, name: 'B' });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('sync() clears the flag and fires the listener once with false', async () => {
        const store    = new MemoryStore(MODEL, []);
        const table    = new Table(store);
        const listener = vi.fn();
        table.onDirtyChange(listener);

        store.add({ id: 1, name: 'A' });
        expect(table.isDirty()).toBe(true);

        await table.sync();

        expect(table.isDirty()).toBe(false);
        expect(listener).toHaveBeenLastCalledWith(false);
    });

    it('editing a committed record dirties the table; reject() clears it', () => {
        const store = new MemoryStore(MODEL, []);
        store.loadData([{ id: 1, name: 'A' }]);

        const table = new Table(store);
        expect(table.isDirty()).toBe(false);

        store.getAt(0)!.set('name', 'B');
        expect(table.isDirty()).toBe(true);

        table.reject();
        expect(table.isDirty()).toBe(false);
    });

    it('removing a committed record dirties the table; reject() clears it', () => {
        const store = new MemoryStore(MODEL, []);
        store.loadData([{ id: 1, name: 'A' }]);

        const table  = new Table(store);
        const record = store.getAt(0)!;

        store.remove(record);
        expect(table.isDirty()).toBe(true);

        table.reject();
        expect(table.isDirty()).toBe(false);
    });
});

describe('Table dirty state — setStore() rebind safety', () => {
    it('re-derives from the new store and drops the old subscription', () => {
        const oldStore = new MemoryStore(MODEL, []);
        oldStore.add({ id: 1, name: 'A' });

        const newStore = new MemoryStore(MODEL, []);
        const table    = new Table(oldStore);
        expect(table.isDirty()).toBe(true);

        table.setStore(newStore);
        expect(table.isDirty()).toBe(false);

        oldStore.add({ id: 2, name: 'B' });
        expect(table.isDirty()).toBe(false);

        newStore.add({ id: 3, name: 'C' });
        expect(table.isDirty()).toBe(true);
    });
});

describe('Table dirty state — ancestor relay', () => {
    it('bubbles up to an ancestor Component with no code added to it', () => {
        const store  = new MemoryStore(MODEL, []);
        const table  = new Table(store);
        const parent = new Component({});
        parent.addComponent(table);

        const listener = vi.fn();
        parent.onDirtyChange(listener);

        store.add({ id: 1, name: 'A' });

        expect(parent.isDirty()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(true);
    });
});

describe('Table dirty state — teardown', () => {
    it('dispose() leaves isDirty() at whatever it was', () => {
        const store = new MemoryStore(MODEL, []);
        const table = new Table(store);

        store.add({ id: 1, name: 'A' });
        expect(table.isDirty()).toBe(true);

        table.dispose();
        expect(table.isDirty()).toBe(true);
    });
});

describe('TreeTable dirty state — inherited unchanged', () => {
    it('reports dirty from a pending record with no code written on TreeTable', () => {
        const treeModel = new Model([
            { name: 'id',     type: 'number' },
            { name: 'parent', type: 'number' },
            { name: 'name',   type: 'string' },
        ], 'id');
        const spec  = { idField: 'id', parentField: 'parent', treeColumn: 'name', columns: [] };
        const store = new MemoryStore(treeModel, []);
        store.add({ id: 1, parent: null, name: 'root' });

        const treeTable = new TreeTable(store, spec);

        expect(treeTable.isDirty()).toBe(true);
    });
});
