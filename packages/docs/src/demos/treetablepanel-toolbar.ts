import type { Component } from '@jimka/typescript-ui/core';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { TreeTablePanel } from '@jimka/typescript-ui/component/table';
import type { TreeTableSpec } from '@jimka/typescript-ui/component/table';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 320 is the toolbar and the six body rows, fully expanded, with room to
 * click Add/Remove without the frame feeling cramped.
 */
export const height: number = 320;

/**
 * A `TreeTablePanel` over the FILES store, showing its toolbar with rows
 * that expand and collapse.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const model = new Model([
        { name: 'id',       type: 'number' },
        { name: 'parentId', type: 'number' },
        { name: 'name',     type: 'string' },
        { name: 'size',     type: 'number' },
    ]);

    const store = new MemoryStore(model, [
        { id: 1, parentId: null, name: 'src',          size: 0 },
        { id: 2, parentId: 1,    name: 'main.ts',      size: 320 },
        { id: 3, parentId: 1,    name: 'Component.ts', size: 4820 },
        { id: 4, parentId: null, name: 'docs',         size: 0 },
        { id: 5, parentId: 4,    name: 'guide.md',     size: 1450 },
        { id: 6, parentId: null, name: 'package.json', size: 1100 },
    ]);

    const spec: TreeTableSpec = {
        idField:     'id',
        parentField: 'parentId',
        treeColumn:  'name',
        columns:     [
            { field: 'name', minWidth: 160 },
            { field: 'size', maxWidth: 100 },
        ],
    };

    const panel = TreeTablePanel(store, spec);

    void store.load();

    return panel;
}
