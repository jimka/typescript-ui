// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { Column } from "./lib/layout/Column.js";
import { callable } from "./lib/Callable.js";

class ColumnPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new Column({
            stretching: false
        }));
    }
}

const ColumnPanelCallable = callable(ColumnPanel);
type ColumnPanelCallable = ColumnPanel;
export {
    ColumnPanel         as _ColumnPanel,
    ColumnPanelCallable as ColumnPanel
};
