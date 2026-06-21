// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable } from '@jimka/typescript-ui/core';
import { AnchorType, HFlow, LayoutConstraints } from '@jimka/typescript-ui/layout';
import { LayoutTestPanel } from "./LayoutTestPanel.js";

class HFlowPanel extends LayoutTestPanel {

    constructor() {
        super();

        // `uniform: "none"` keeps each child at its own (mixed) size so the new
        // cross-axis and distribution options are visible: `itemAlign: "center"`
        // vertically centres a short item within a tall row, and
        // `justify: "between"` spreads each row's items edge-to-edge across the
        // inner width.
        this.setLayoutManager(new HFlow({ uniform: "both", itemAlign: "center", justify: "between" }));

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

const HFlowPanelCallable = callable(HFlowPanel);
type HFlowPanelCallable = HFlowPanel;
export {
    HFlowPanel         as _HFlowPanel,
    HFlowPanelCallable as HFlowPanel
};
