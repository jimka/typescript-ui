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
 * 260 is two rows of grid cells plus the surrounding frame — the same
 * layout-manager height class every other demo on this page and its sibling
 * layout pages uses.
 */
export const height: number = 260;

/**
 * A uniform 2×3 `Grid` — six labelled cells, every column and row the same
 * size, matching the diagram at the top of this page.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const cellA = Header('A');

    const cellB = Header('B');

    const cellC = Header('C');

    const cellD = Header('D');

    const cellE = Header('E');

    const cellF = Header('F');

    return Panel({
        layoutManager: Grid({ rows: 2, columns: 3 }),
        components:    [cellA, cellB, cellC, cellD, cellE, cellF],
    });
}
