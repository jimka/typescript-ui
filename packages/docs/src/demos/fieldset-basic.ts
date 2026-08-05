import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { FieldSet } from '@jimka/typescript-ui/component/container';
import { Checkbox } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is the bordered box, its legend, and the two checkboxes it wraps.
 */
export const height: number = 120;

/**
 * A bordered `FieldSet` with a legend title, wrapping two `Checkbox`es.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const emailCheckbox = Checkbox({ label: 'Email updates' });

    const smsCheckbox = Checkbox({ label: 'SMS alerts' });

    const body = Panel({
        layoutManager: VBox({ spacing: 4 }),
        components:    [emailCheckbox, smsCheckbox],
    });

    const profile = FieldSet();
    profile.setTitle('Notifications');
    profile.addComponent(body);

    return profile;
}
