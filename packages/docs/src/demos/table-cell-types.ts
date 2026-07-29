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
 * 200 is a header row, the five body rows, and the surrounding frame; the
 * store never grows past those five, so a taller frame is empty space.
 */
export const height: number = 200;

/**
 * The same store as `table-store`, with a per-column `ColumnSpec`: `role`
 * renders as a combo cell (double-click to pick), `age` as a number cell.
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

    const table = Table(store, {
        columns: [
            { field: 'name' },
            { field: 'role', values: ['Engineer', 'Designer', 'Analyst'] },
            { field: 'age' },
        ],
    });

    void store.load();

    return table;
}
