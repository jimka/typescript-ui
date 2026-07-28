import type { Component } from '@jimka/typescript-ui/core';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { ComboBox } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is the closed control plus room for the open dropdown to read clearly.
 */
export const height: number = 120;

/**
 * A `ComboBox` backed by a store of people, its `displayField` set to
 * `name`; open it to see every row.
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

    const combo = ComboBox({ store, displayField: 'name', valueField: 'id' });

    void store.load();

    return combo;
}
