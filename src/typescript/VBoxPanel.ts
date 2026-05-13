// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { VBox } from "./lib/layout/VBox.js";
import { callable } from "./lib/Callable.js";

class VBoxPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new VBox());
    }
}

const VBoxPanelCallable = callable(VBoxPanel);
type VBoxPanelCallable = VBoxPanel;
export {
    VBoxPanel         as _VBoxPanel,
    VBoxPanelCallable as VBoxPanel
};
