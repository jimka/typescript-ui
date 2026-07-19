// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable } from '@jimka/typescript-ui/core';
import { HFlow } from '@jimka/typescript-ui/layout';
import { FlowDemoPanel } from "./FlowDemoPanel.js";

class HFlowPanel extends FlowDemoPanel {

    constructor() {
        // `uniform: "both"` grows every cell to the widest × tallest item so the
        // wrapped items line up into a grid; `itemAlign: "center"` vertically
        // centres a short item within a tall row, and `justify: "between"`
        // spreads each row's items edge-to-edge across the inner width. Every
        // setting is then live-editable through the panel's toolbar.
        super(new HFlow({ uniform: "both", itemAlign: "center", justify: "between" }));
    }
}

const HFlowPanelCallable = callable(HFlowPanel);
type HFlowPanelCallable = HFlowPanel;
export {
    HFlowPanel         as _HFlowPanel,
    HFlowPanelCallable as HFlowPanel
};
