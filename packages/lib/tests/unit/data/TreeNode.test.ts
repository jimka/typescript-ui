import { describe, it, expect } from 'vitest';
import { TreeStore } from '~/data/TreeStore';
import { Model } from '~/data/Model';

const MODEL = new Model([
    { name: 'id' },
    { name: 'parentId' },
    { name: 'name' },
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

describe('TreeNode synthetic root', () => {
    it('wraps a null record at depth -1 with undefined id and null parent', () => {
        const root = makeStore().getRootNode();

        expect(root.getRecord()).toBeNull();
        expect(root.getDepth()).toBe(-1);
        expect(root.getId()).toBeUndefined();
        expect(root.getParent()).toBeNull();
    });
});

describe('TreeNode getId', () => {
    it('reads the store id field rather than a raw key', () => {
        const MAPPED = new Model([
            { name: 'id',       mapping: 'pk' },
            { name: 'parentId', mapping: 'pid' },
            { name: 'name' },
        ], 'id');
        const store = new TreeStore({ model: MAPPED, parentField: 'parentId', childrenKey: 'children' });
        store.loadData([{ pk: 1, pid: null, name: 'Root', children: [{ pk: 2, name: 'Nested' }] }]);

        expect(store.getNodeById(2)!.getId()).toBe(2);
    });
});

describe('TreeNode isExpanded', () => {
    it('is a live view of the store expansion set', async () => {
        const store = makeStore();
        const node = store.getNodeById(1)!;

        expect(node.isExpanded()).toBe(false);

        await store.expand(node);
        expect(node.isExpanded()).toBe(true);

        store.collapse(node);
        expect(node.isExpanded()).toBe(false);
    });
});

describe('TreeNode getParent / getChildren linkage', () => {
    it('exposes reciprocal parent and child references', () => {
        const store = makeStore();
        const parent = store.getNodeById(1)!;
        const child = store.getNodeById(2)!;

        expect(parent.getChildren().map(n => n.getId())).toEqual([2]);
        expect(child.getParent()).toBe(parent);
    });
});
