import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { ProgressSpinner } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of spinners plus room around the frame for the stage's
 * border.
 */
export const height: number = 64;

/**
 * Two `ProgressSpinner`s at different sizes, spinning via the component's
 * own CSS animation.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const smallSpinner = ProgressSpinner(24);

    const largeSpinner = ProgressSpinner(40);

    return Panel({
        layoutManager: HBox({ spacing: 16 }),
        components:    [smallSpinner, largeSpinner],
    });
}
