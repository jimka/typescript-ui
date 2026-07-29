import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { Grid } from '@jimka/typescript-ui/layout';
import { Header } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is one row of tracked columns plus the surrounding frame.
 */
export const height: number = 260;

/**
 * A 3-column `Grid` with a fixed, a weighted, and a content-sized column
 * track; resizing the pane moves only the weighted column's edge.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const fixedPanel = Header('Fixed 120px');

    const weightPanel = Header('Weight 1');

    const contentPanel = Header('Content');

    const grid = Panel({
        layoutManager: Grid({
            columns:      3,
            columnTracks: [
                { mode: 'fixed',   value: 120 },
                { mode: 'weight',  value: 1 },
                { mode: 'content' },
            ],
        }),
    });

    grid.addComponent(fixedPanel);
    grid.addComponent(weightPanel);
    grid.addComponent(contentPanel);

    return grid;
}
