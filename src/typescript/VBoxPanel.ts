// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { VBox } from "./Base/layout/VBox.js";
import { callable } from "./Base/Callable.js";

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
