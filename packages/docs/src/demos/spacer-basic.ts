import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Spacer } from '@jimka/typescript-ui/component/container';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of buttons plus room around the frame for the stage's
 * border.
 */
export const height: number = 64;

/**
 * Two `Button`s in an `HBox`, pushed to opposite ends by a flex `Spacer`
 * between them.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const leftButton = Button({ text: 'Left' });

    const rightButton = Button({ text: 'Right' });

    const gap = Spacer.flex();

    return Panel({
        layoutManager: HBox(),
        components:    [leftButton, gap, rightButton],
    });
}
