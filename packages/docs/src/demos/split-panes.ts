import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { Split } from '@jimka/typescript-ui/layout';
import { Header } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is the two panes' natural height plus the surrounding frame.
 */
export const height: number = 260;

/**
 * Two panes divided by a draggable gutter; drag it to resize either pane.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const leftPanel = Header('Left');

    const rightPanel = Header('Right');

    const split = Panel({ layoutManager: Split({ orientation: 'horizontal' }) });

    split.addComponent(leftPanel);
    split.addComponent(rightPanel);

    return split;
}
