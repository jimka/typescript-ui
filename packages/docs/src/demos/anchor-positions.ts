import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { Anchor, AnchorConstraints } from '@jimka/typescript-ui/layout';
import { Header } from '@jimka/typescript-ui/component/display';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is room for the header band, the pinned corner button, and the
 * percentage-anchored panel to all read clearly, plus the surrounding frame.
 */
export const height: number = 260;

/**
 * A full-width header band, a bottom-right pinned button, and a
 * percentage-anchored centre panel — all re-anchor live as the pane resizes.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const headerBand = Header('Header');

    const pinnedButton = Button({ text: 'Pinned' });

    const centerPanel = Header('Centered 50%', {
        border: { border: '1px solid var(--ts-ui-border-color)' },
    });

    const canvas = Panel({ layoutManager: Anchor() });

    const headerConstraints = new AnchorConstraints();
    headerConstraints.left   = 0;
    headerConstraints.right  = 0;
    headerConstraints.top    = 0;
    headerConstraints.height = 40;
    canvas.addComponent(headerBand, headerConstraints);

    const pinnedConstraints = new AnchorConstraints();
    pinnedConstraints.right  = 8;
    pinnedConstraints.bottom = 8;
    pinnedConstraints.width  = 100;
    pinnedConstraints.height = 32;
    canvas.addComponent(pinnedButton, pinnedConstraints);

    const centerConstraints = new AnchorConstraints();
    centerConstraints.left   = { percent: 25 };
    centerConstraints.top    = { percent: 25 };
    centerConstraints.width  = { percent: 50 };
    centerConstraints.height = { percent: 50 };
    canvas.addComponent(centerPanel, centerConstraints);

    return canvas;
}
