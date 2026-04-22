// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { HBox } from "./Base/layout/HBox.js";
import { LayoutTestPanel } from "./LayoutTestPanel.js";

export class HBoxPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new HBox());
    }
}