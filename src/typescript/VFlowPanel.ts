// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable } from '@jimka/typescript-ui/core';
import { AnchorType, VFlow, LayoutConstraints } from '@jimka/typescript-ui/layout';
import { LayoutTestPanel } from "./LayoutTestPanel.js";

class VFlowPanel extends LayoutTestPanel {

    constructor() {
        super();

        // `uniform: "none"` keeps each child at its own (mixed) size so the new
        // cross-axis and distribution options are visible: `itemAlign: "center"`
        // horizontally centres a narrow item within a wide column, and
        // `justify: "around"` spaces each column's items with equal gaps (and
        // half-gaps at the ends) across the inner height.
        this.setLayoutManager(new VFlow({ uniform: "none", itemAlign: "center", justify: "around" }));

        const enums = Object.keys(AnchorType).length;
        let n = 0;

        for (const component of this.getComponents()) {
            const constraints = this.getLayoutConstraints(component) ?? new LayoutConstraints();

            constraints.anchor = n % enums;
            n += 1;

            this.setLayoutConstraints(component, constraints);
        }
    }
}

const VFlowPanelCallable = callable(VFlowPanel);
type VFlowPanelCallable = VFlowPanel;
export {
    VFlowPanel         as _VFlowPanel,
    VFlowPanelCallable as VFlowPanel
};
