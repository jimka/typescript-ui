import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { RadioButton } from '@jimka/typescript-ui/component/input';
import { ButtonGroup } from '@jimka/typescript-ui/overlay';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is three stacked radio rows plus the surrounding frame.
 */
export const height: number = 120;

/**
 * Three `RadioButton`s stacked in a `ButtonGroup`; arrow keys move the
 * selection once a control in the group has focus.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const smallRadio = RadioButton('Small');

    const mediumRadio = RadioButton('Medium', { selected: true });

    const largeRadio = RadioButton('Large');

    const group = ButtonGroup({ buttons: [smallRadio, mediumRadio, largeRadio] });

    const groupRow = Panel({
        layoutManager: VBox({ spacing: 4 }),
        components:    [smallRadio, mediumRadio, largeRadio],
    });

    group.setContainer(groupRow);

    return groupRow;
}
