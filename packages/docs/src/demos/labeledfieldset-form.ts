import type { Component } from '@jimka/typescript-ui/core';
import { LabeledFieldSet } from '@jimka/typescript-ui/component/container';
import { TextField } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 is two field rows, the full-width button row, and the fieldset chrome.
 */
export const height: number = 200;

/**
 * A two-column `LabeledFieldSet`: a name row split across both columns, an
 * email row, and a full-width `Button` row.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const firstField = TextField();

    const lastField = TextField();

    const emailField = TextField();

    const saveButton = Button({ text: 'Save' });

    const form = LabeledFieldSet('Profile', {
        columns: 2,
        rows:    [
            [{ title: 'First', component: firstField }, { title: 'Last', component: lastField }],
            [{ title: 'Email', component: emailField }],
            { component: saveButton, fullWidth: true },
        ],
    });

    return form;
}
