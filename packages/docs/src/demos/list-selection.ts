import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { List } from '@jimka/typescript-ui/component/list';
import { Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 is the list plus the selection-echo line below it.
 */
export const height: number = 200;

/**
 * A store-bound `List` of people's names; the `Text` below shows the
 * current selection.
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

    const list = List({
        store,
        displayField:  'name',
        valueField:    'id',
        preferredSize: { width: 200, height: 140 },
    });

    const selectionText = Text('No selection');

    list.on('change', handleChange);

    function handleChange(value: string): void {
        const record = store.getById(Number(value));
        selectionText.setText(record ? `Selected: ${record.get('name')}` : 'No selection');
    }

    void store.load();

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [list, selectionText],
    });
}
