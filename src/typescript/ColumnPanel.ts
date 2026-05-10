// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { Column } from "./Base/layout/Column.js";

export class ColumnPanel extends LayoutTestPanel {

    constructor() {
        super();

        let column = new Column();
        column.setStretching(false);

        this.setLayoutManager(column);
    }
}