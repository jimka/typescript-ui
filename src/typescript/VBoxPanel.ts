// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { VBox } from "./Base/layout/VBox.js";

export class VBoxPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new VBox());
    }
}