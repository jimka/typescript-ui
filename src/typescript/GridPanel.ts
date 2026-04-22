// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { Grid } from "./Base/layout/Grid.js";

export class GridPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new Grid());
    }
}