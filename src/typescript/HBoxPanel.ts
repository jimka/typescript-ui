// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    callable,
    HBox
} from "@jimka/typescript-ui";
import { LayoutTestPanel } from "./LayoutTestPanel.js";

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
