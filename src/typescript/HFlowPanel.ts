// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable } from '@jimka/typescript-ui/core';
import { AnchorType, HFlow, LayoutConstraints } from '@jimka/typescript-ui/layout';
import { LayoutTestPanel } from "./LayoutTestPanel.js";

class HFlowPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new HFlow({ uniform: "both" }));

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
