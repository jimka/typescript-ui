// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox, BoxMode, AnchorType, FillType } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
import { FieldSet } from '@jimka/typescript-ui/component/container';

// Row/column cross extent in pixels: tall/wide enough that NORTH/SOUTH (HBox)
// and WEST/EAST (VBox) anchors land at visibly different edges. Empirically
// chosen so three buttons leave clear slack on the cross axis.
const ROW_HEIGHT = 90;
const COLUMN_WIDTH = 220;

class AlignSelfPanel extends Panel {

    constructor() {
        super({ autoScroll: 'auto' });

        // Stretch each demo block to the panel's full width so the inner HBox
        // rows have a real cross band to anchor within.
        this.setLayoutManager(new VBox({ stretching: true }));

        this.addComponent(this.buildHBoxRow("preferred"));
        this.addComponent(this.buildHBoxRow("equal"));
        this.addComponent(this.buildVBoxColumn("preferred"));
        this.addComponent(this.buildVBoxColumn("equal"));
    }

    /**
     * Builds an HBox row (vertical cross axis) whose children opt into distinct
     * cross-axis align-self: top, bottom, full-height fill, and the default
     * baseline placement, in the given main-axis mode.
     *
     * @param mode - The {@link BoxMode} the inner HBox runs in.
     * @returns The configured FieldSet.
     */
    private buildHBoxRow(mode: BoxMode): FieldSet {
        return FieldSet(`HBox align-self (mode: "${mode}")`, {
            preferredSize: { width: 200, height: ROW_HEIGHT },
            layoutManager: HBox({ mode }),
            components: [
                { component: Button({ text: "default" }) },
                { component: Button({ text: "NORTH" }), constraints: { anchor: AnchorType.NORTH } },
                { component: Button({ text: "SOUTH" }), constraints: { anchor: AnchorType.SOUTH } },
                { component: Button({ text: "fill"  }), constraints: { fill: FillType.VERTICAL } }
            ]
        });
    }

    /**
     * Builds a VBox column (horizontal cross axis) whose children opt into
     * distinct cross-axis align-self: left, right, full-width fill, and the
     * default WEST-origin placement, in the given main-axis mode.
     *
     * @param mode - The {@link BoxMode} the inner VBox runs in.
     * @returns The configured FieldSet.
     */
    private buildVBoxColumn(mode: BoxMode): FieldSet {
        return FieldSet(`VBox align-self (mode: "${mode}")`, {
            preferredSize: { width: COLUMN_WIDTH, height: 200 },
            layoutManager: VBox({ mode }),
            components: [
                { component: Button({ text: "default" }) },
                { component: Button({ text: "WEST" }), constraints: { anchor: AnchorType.WEST } },
                { component: Button({ text: "EAST" }), constraints: { anchor: AnchorType.EAST } },
                { component: Button({ text: "fill" }), constraints: { fill: FillType.HORIZONTAL } }
            ]
        });
    }
}

const AlignSelfPanelCallable = callable(AlignSelfPanel);
type AlignSelfPanelCallable = AlignSelfPanel;
export {
    AlignSelfPanel         as _AlignSelfPanel,
    AlignSelfPanelCallable as AlignSelfPanel
};
