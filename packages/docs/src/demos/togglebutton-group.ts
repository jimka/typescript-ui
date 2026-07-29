import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { ToggleButton } from '@jimka/typescript-ui/component/button';
import { ButtonGroup } from '@jimka/typescript-ui/overlay';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of default-height buttons plus room around the frame for the
 * stage's border.
 */
export const height: number = 64;

/**
 * Three `ToggleButton`s wrapped in a `ButtonGroup`; clicking one releases
 * whichever of the others was selected.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const boldButton = ToggleButton('Bold', { selected: true });

    const italicButton = ToggleButton('Italic');

    const underlineButton = ToggleButton('Underline');

    ButtonGroup({ buttons: [boldButton, italicButton, underlineButton] });

    return Panel({
        layoutManager: HBox({ spacing: 8 }),
        components:    [boldButton, italicButton, underlineButton],
    });
}
