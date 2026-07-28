import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { Border, Grid } from '@jimka/typescript-ui/layout';
import { Placement } from '@jimka/typescript-ui/primitive';
import { Header } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is the north/south bands, the west/east/centre row between them, and
 * the surrounding frame.
 */
export const height: number = 260;

/**
 * All five `Border` regions filled with labelled panels; double-click the
 * north, south, or west gutter to collapse that region.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const northPanel = Header('North');

    const southPanel = Header('South');

    const westPanel = Header('West');

    const eastPanel = Header('East');

    const centerPanel = Header('Center');

    const region = Panel({ layoutManager: Border({ spacing: 4 }) });

    region.addComponent(northPanel,  { placement: Placement.NORTH, collapsible: true });
    region.addComponent(southPanel,  { placement: Placement.SOUTH, collapsible: true });
    region.addComponent(westPanel,   { placement: Placement.WEST,  collapsible: true });
    region.addComponent(eastPanel,   { placement: Placement.EAST });
    region.addComponent(centerPanel, { placement: Placement.CENTER });

    return Panel({ layoutManager: Grid({ columns: 1, rows: 1 }), components: [region] });
}
