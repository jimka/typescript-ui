// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { HBox } from "./lib/layout/HBox.js";
import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { callable } from "./lib/Callable.js";

class HBoxPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new HBox());
    }
}

const HBoxPanelCallable = callable(HBoxPanel);
type HBoxPanelCallable = HBoxPanel;
export {
    HBoxPanel         as _HBoxPanel,
    HBoxPanelCallable as HBoxPanel
};
