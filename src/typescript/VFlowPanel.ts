// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable } from '@jimka/typescript-ui/core';
import { AnchorType, VFlow, LayoutConstraints } from '@jimka/typescript-ui/layout';
import { LayoutTestPanel } from "./LayoutTestPanel.js";

class VFlowPanel extends LayoutTestPanel {

    constructor() {
        super();

        // `align: "center"` exercises the new flow line-alignment: each column's
        // content block is centred along the vertical (main) axis instead of
        // packing from the north edge.
        this.setLayoutManager(new VFlow({ uniform: "both", align: "center" }));

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
