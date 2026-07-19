// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { AnchorType, FillType, Grid, GridConstraints } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Demo panel exercising the {@link Grid} layout's flexible track sizing, cell
 * spanning, explicit placement, per-component fill override, and
 * clip-on-overflow behaviour.
 *
 * @remarks Lays out a 3-column grid whose columns are sized as fixed-120px,
 * weight-1, and content. One child spans a 2x2 block, one child is pinned to
 * the top-right cell, one oversized child is clipped to the narrow fixed
 * column, and one child opts out of the grid's default fill with
 * `FillType.NONE` so it shrinks and anchors to its cell's south-east corner.
 * The remaining buttons auto-flow around the reserved cells. A commented-out
 * overlapping pair can be enabled to trip the collision warning.
 */
class GridPanel extends Panel {

    constructor() {
        super({ autoScroll: 'auto' });

        this.setLayoutManager(new Grid({
            rows: 3,
            columns: 3,
            columnTracks: [
                { mode: "fixed", value: 120 },
                { mode: "weight", value: 1 },
                { mode: "content" },
            ],
        }));

        // Spanning child: occupies a 2x2 block.
        const spanCons = new GridConstraints();
        spanCons.colSpan = 2;
        spanCons.rowSpan = 2;
        this.addComponent(new Button("I span 2x2"), spanCons);

        // Explicitly placed child: pinned to column 2, row 0.
        const pinnedCons = new GridConstraints();
        pinnedCons.col = 2;
        pinnedCons.row = 0;
        this.addComponent(new Button("Pinned (2,0)"), pinnedCons);

        // Oversized-min child pinned to the narrow fixed column (column 0); its
        // min width exceeds the 120px cell, so it clips instead of spilling.
        const wide = new Button("I am too wide for the fixed column and must clip");
        wide.setMinSize(400, 30);
        const wideCons = new GridConstraints();
        wideCons.col = 0;
        wideCons.row = 2;
        this.addComponent(wide, wideCons);

        // Per-component fill override: most children inherit the grid's default
        // FillType.BOTH and fill their cells, but this one opts out with
        // FillType.NONE so it shrinks to its preferred size and parks at its
        // own anchor (south-east corner of the cell) instead of stretching.
        const shrinkCons = new GridConstraints();
        shrinkCons.fill = FillType.NONE;
        shrinkCons.anchor = AnchorType.SOUTHEAST;
        this.addComponent(new Button("No fill (SE)"), shrinkCons);

        // Auto-flow children: flow into the cells left free by the span, the
        // pinned cell, and the clipped child — exactly fills the 3x3 grid.
        for (let i = 1; i <= 2; i += 1) {
            this.addComponent(new Button("Auto " + i));
        }

        // Enable to verify the explicit-vs-explicit collision console.warn:
        // const clashA = new GridConstraints();
        // clashA.col = 0;
        // clashA.row = 0;
        // this.addComponent(new Button("Clash A (0,0)"), clashA);
        //
        // const clashB = new GridConstraints();
        // clashB.col = 0;
        // clashB.row = 0;
        // this.addComponent(new Button("Clash B (0,0)"), clashB);
    }
}

const GridPanelCallable = callable(GridPanel);
type GridPanelCallable = GridPanel;
export {
    GridPanel         as _GridPanel,
    GridPanelCallable as GridPanel
};
