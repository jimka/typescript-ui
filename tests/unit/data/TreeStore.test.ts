import { describe, it, expect, vi } from 'vitest';
import { TreeStore } from '~/data/TreeStore';
import { Model } from '~/data/Model';
import { Proxy, ReadParams } from '~/data/proxy/Proxy';
import { ModelRecord } from '~/data/ModelRecord';

const MODEL = new Model([
    { name: 'id' },
    { name: 'parentId' },
    { name: 'name' },
    { name: 'leaf', type: 'boolean' },
    { name: 'hasKids', type: 'boolean' },
], 'id');

const FLAT = [
    { id: 1, parentId: null, name: 'Root A' },
    { id: 2, parentId: 1,    name: 'Child A1' },
    { id: 3, parentId: null, name: 'Root B' },
];

function makeStore(): TreeStore {
    const store = new TreeStore({ model: MODEL, parentField: 'parentId' });
    store.loadData(FLAT);
    return store;
}

describe('TreeStore eager build', () => {
    it('builds the synthetic root with the flat roots as children', () => {
        const store = makeStore();
        expect(store.getRootNode().getChildren().map(n => n.getId())).toEqual([1, 3]);
        expect(store.getRootNode().getDepth()).toBe(-1);
    });

    it('resolves child nodes and depth', () => {
        const store = makeStore();
        const a = store.getNodeById(1)!;
        expect(a.getChildren().map(n => n.getId())).toEqual([2]);
        expect(store.getDepth(store.getNodeById(2)!)).toBe(1);
        expect(store.getNodeById(2)!.getParent()!.getId()).toBe(1);
    });

    it('treats an unresolved parent id as a root (orphan fallback)', () => {
        const store = new TreeStore({ model: MODEL, parentField: 'parentId' });
        store.loadData([{ id: 5, parentId: 99, name: 'Orphan' }]);
        expect(store.getRootNode().getChildren().map(n => n.getId())).toEqual([5]);
    });

    it('defaults idField to the model primary key', () => {
        expect(makeStore().getIdField()).toBe('id');
    });
});

describe('TreeStore visible view', () => {
    it('lists only roots when nothing is expanded', () => {
        const store = makeStore();
        expect(store.getVisibleNodes().map(n => n.getId())).toEqual([1, 3]);
        expect(store.getVisibleCount()).toBe(2);
    });

    it('includes a child between roots after expand, gone after collapse', async () => {
        const store = makeStore();
        const a = store.getNodeById(1)!;

        await store.expand(a);
        expect(store.getVisibleNodes().map(n => n.getId())).toEqual([1, 2, 3]);

        store.collapse(a);
        expect(store.getVisibleNodes().map(n => n.getId())).toEqual([1, 3]);
    });

    it('fires exactly one expand and one collapse event', async () => {
        const store = makeStore();
        const onExpand = vi.fn();
        const onCollapse = vi.fn();
        store.onTree('expand', onExpand);
        store.onTree('collapse', onCollapse);

        const a = store.getNodeById(1)!;
        await store.expand(a);
        store.collapse(a);

        expect(onExpand).toHaveBeenCalledTimes(1);
        expect(onCollapse).toHaveBeenCalledTimes(1);
    });
});

describe('TreeStore expansion survives reload', () => {
    it('keeps a node expanded across a load that re-creates the same ids', async () => {
        const store = makeStore();
        await store.expand(store.getNodeById(1)!);

        store.loadData(FLAT);

        expect(store.isExpanded(store.getNodeById(1)!)).toBe(true);
        expect(store.getVisibleNodes().map(n => n.getId())).toEqual([1, 2, 3]);
    });
});

describe('TreeStore leaf determination', () => {
    it('treats a record with no children as a leaf by default', () => {
        const store = makeStore();
        expect(store.getNodeById(2)!.isLeaf()).toBe(true);
        expect(store.getNodeById(1)!.isLeaf()).toBe(false);
    });

    it('honours an explicit leafField', () => {
        const store = new TreeStore({ model: MODEL, parentField: 'parentId', leafField: 'leaf' });
        store.loadData([
            { id: 1, parentId: null, name: 'Branch', leaf: false },
            { id: 2, parentId: null, name: 'Leaf',   leaf: true },
        ]);
        expect(store.getNodeById(1)!.isLeaf()).toBe(false);
        expect(store.getNodeById(2)!.isLeaf()).toBe(true);
    });

    it('shows a caret for a hasChildrenField branch with no loaded children', () => {
        const store = new TreeStore({ model: MODEL, parentField: 'parentId', hasChildrenField: 'hasKids' });
        store.loadData([{ id: 1, parentId: null, name: 'Lazy', hasKids: true }]);
        expect(store.getNodeById(1)!.isLeaf()).toBe(false);
        expect(store.getNodeById(1)!.isLoaded()).toBe(false);
    });
});

class StubProxy extends Proxy {
    lastParams: ReadParams | undefined;
    readCount = 0;
    create(): Promise<Record<string, any>> { return Promise.resolve({}); }
    update(): Promise<Record<string, any>> { return Promise.resolve({}); }
    destroy(): Promise<void> { return Promise.resolve(); }
    read(params?: ReadParams): Promise<any[]> {
        this.lastParams = params;
        this.readCount++;
        return Promise.resolve([{ id: 10, parentId: 1, name: 'Lazy child' }]);
    }
}

describe('TreeStore lazy load', () => {
    function makeLazy(proxy: Proxy): TreeStore {
        const store = new TreeStore({ model: MODEL, parentField: 'parentId', hasChildrenField: 'hasKids', proxy });
        store.loadData([{ id: 1, parentId: null, name: 'Lazy', hasKids: true }]);
        return store;
    }

    it('fetches children scoped by a parentField eq filter, appends, and marks loaded', async () => {
        const proxy = new StubProxy();
        const store = makeLazy(proxy);
        const onAppend = vi.fn();
        store.onTree('append', onAppend);

        await store.expand(store.getNodeById(1)!);

        expect(proxy.lastParams?.filters).toEqual([{ type: 'eq', field: 'parentId', value: 1 }]);
        expect(store.getNodeById(10)?.getRecord()?.get('name')).toBe('Lazy child');
        expect(store.getNodeById(1)!.isLoaded()).toBe(true);
        expect(onAppend).toHaveBeenCalledTimes(1);
        expect(store.getVisibleNodes().map(n => n.getId())).toEqual([1, 10]);
    });

    it('de-duplicates concurrent expands of the same node', async () => {
        const proxy = new StubProxy();
        const store = makeLazy(proxy);
        const node = store.getNodeById(1)!;

        await Promise.all([store.expand(node), store.expand(node)]);

        expect(proxy.readCount).toBe(1);
    });
});

describe('TreeStore nested eager flatten', () => {
    it('flattens an embedded children array and stamps parentField', () => {
        const store = new TreeStore({ model: MODEL, parentField: 'parentId', childrenKey: 'children' });
        store.loadData([{ id: 1, parentId: null, name: 'Root', children: [{ id: 2, name: 'Nested' }] }]);

        expect(store.getAll().map((r: ModelRecord) => r.get('id')).sort()).toEqual([1, 2]);
        expect(store.getNodeById(2)!.getParent()!.getId()).toBe(1);
    });

    it('reads and stamps the raw mapping keys when id/parent fields are mapped', () => {
        const MAPPED = new Model([
            { name: 'id',       mapping: 'pk' },
            { name: 'parentId', mapping: 'pid' },
            { name: 'name' },
        ], 'id');
        const store = new TreeStore({ model: MAPPED, parentField: 'parentId', childrenKey: 'children' });
        store.loadData([{ pk: 1, pid: null, name: 'Root', children: [{ pk: 2, name: 'Nested' }] }]);

        expect(store.getRootNode().getChildren().map(n => n.getId())).toEqual([1]);
        expect(store.getNodeById(2)!.getParent()!.getId()).toBe(1);
    });
});
