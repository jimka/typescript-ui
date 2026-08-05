import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Label, TextField, Checkbox } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of labels and their associated controls plus room around the
 * frame for the stage's border.
 */
export const height: number = 64;

/**
 * A plain `Label` associated with a `TextField`, beside one associated with a
 * `Checkbox` via `for`; clicking either label targets its control.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const nameField = TextField();
    const nameLabel = Label('Name:', nameField.getId());

    const subscribeCheckbox = Checkbox();
    const subscribeLabel = Label('Subscribe', subscribeCheckbox.getId());

    return Panel({
        layoutManager: HBox({ spacing: 12 }),
        components:    [nameLabel, nameField, subscribeLabel, subscribeCheckbox],
    });
}
