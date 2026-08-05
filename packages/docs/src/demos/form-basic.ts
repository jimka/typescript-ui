import type { Component } from '@jimka/typescript-ui/core';
import { Form, Panel } from '@jimka/typescript-ui/core';
import { VBox, HBox } from '@jimka/typescript-ui/layout';
import { TextField, Text, Label } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 is two labelled fields, a submit button, and a result line.
 */
export const height: number = 200;

/**
 * A `Form` with two `TextField`s and a submit `Button`; submitting updates a
 * `Text` with the entered values.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const nameField = TextField();
    const nameLabel = Label('Name:', nameField.getId());

    const roleField = TextField();
    const roleLabel = Label('Role:', roleField.getId());

    const resultText = Text('(not submitted yet)');

    const submitButton = Button({ text: 'Submit' });

    const form = Form({
        layoutManager: VBox({ spacing: 8 }),
        components:    [nameLabel, nameField, roleLabel, roleField, submitButton],
        onSubmit:      handleSubmit,
    });

    function handleSubmit(): void {
        resultText.setText(`${nameField.getText()} — ${roleField.getText()}`);
    }

    const resultRow = Panel({
        layoutManager: HBox(),
        components:    [resultText],
    });

    return Panel({
        layoutManager: VBox({ spacing: 8, stretching: true }),
        components:    [form, resultRow],
    });
}
