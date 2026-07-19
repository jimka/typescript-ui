// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable } from '@jimka/typescript-ui/core';
import { VFlow } from '@jimka/typescript-ui/layout';
import { FlowDemoPanel } from "./FlowDemoPanel.js";

class VFlowPanel extends FlowDemoPanel {

    constructor() {
        // `uniform: "none"` keeps each child at its own (mixed) size so the
        // cross-axis and distribution options are visible: `itemAlign: "center"`
        // horizontally centres a narrow item within a wide column, and
        // `justify: "around"` spaces each column's items with equal gaps (and
        // half-gaps at the ends) across the inner height. Every setting is then
        // live-editable through the panel's toolbar.
        super(new VFlow({ uniform: "none", itemAlign: "center", justify: "around" }));
    }
}

const VFlowPanelCallable = callable(VFlowPanel);
type VFlowPanelCallable = VFlowPanel;
export {
    VFlowPanel         as _VFlowPanel,
    VFlowPanelCallable as VFlowPanel
};
