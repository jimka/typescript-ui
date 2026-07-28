import type { Component } from '@jimka/typescript-ui/core';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Table } from '@jimka/typescript-ui/component/table';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 320 is a header row, five body rows, and the surrounding frame.
 */
export const height: number = 320;

/**
 * A store-bound `Table`. Click a column header to sort, click a row to select,
 * double-click a cell to edit.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const model = new Model([
        { name: 'id',   type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'role', type: 'string' },
        { name: 'age',  type: 'number' },
    ]);

    const store = new MemoryStore(model, [
        { id: 1, name: 'Alice', role: 'Engineer', age: 30 },
        { id: 2, name: 'Bob',   role: 'Designer', age: 25 },
        { id: 3, name: 'Carol', role: 'Engineer', age: 41 },
        { id: 4, name: 'Dan',   role: 'Analyst',  age: 38 },
        { id: 5, name: 'Erin',  role: 'Designer', age: 29 },
    ]);

    const table = Table(store);

    void store.load();

    return table;
}
