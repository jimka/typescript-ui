import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { Absolute } from '@jimka/typescript-ui/layout';
import { Header } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is room for three pinned panels at their literal pixel positions to
 * read clearly, plus the surrounding frame.
 */
export const height: number = 260;

/**
 * Three labelled panels pinned at literal pixel `x`/`y`/width/height via
 * `setX`/`setY` — fixed, not resize-responsive, unlike `Anchor`'s
 * `anchor-positions` demo.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const canvas = Panel({ layoutManager: Absolute() });

    const firstPanel = Header('First');
    firstPanel.setX(20).setY(20);
    firstPanel.setPreferredSize({ width: 160, height: 40 });
    canvas.addComponent(firstPanel);

    const secondPanel = Header('Second');
    secondPanel.setX(220).setY(80);
    secondPanel.setPreferredSize({ width: 160, height: 40 });
    canvas.addComponent(secondPanel);

    const thirdPanel = Header('Third');
    thirdPanel.setX(60).setY(160);
    thirdPanel.setPreferredSize({ width: 160, height: 40 });
    canvas.addComponent(thirdPanel);

    return canvas;
}
