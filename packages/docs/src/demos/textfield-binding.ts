import type { Component } from '@jimka/typescript-ui/core';
import { Panel, Binding } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { TextField, Text } from '@jimka/typescript-ui/component/input';
import { Model } from '@jimka/typescript-ui/data';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 is two stacked text fields plus an echo line and the surrounding frame.
 */
export const height: number = 200;

/**
 * Two `TextField`s bound to one `ModelRecord` via `Binding`; the `Text` below
 * echoes the record's current values as you type.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const model = new Model([
        { name: 'name',  type: 'string' },
        { name: 'email', type: 'string' },
    ]);

    const record = model.createRecord({ name: 'Alice', email: 'alice@example.com' });

    const nameField = TextField();

    const emailField = TextField();

    const summary = Text('');

    const binding = new Binding()
        .bind('name',  nameField)
        .bind('email', emailField);

    binding.setRecord(record);
    binding.on('change', handleChange);

    function handleChange(): void {
        summary.setText(`${record.get('name')} <${record.get('email')}>`);
    }

    handleChange();

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [nameField, emailField, summary],
    });
}
