// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { Column } from "./Base/layout/Column.js";
import { callable } from "./Base/Callable.js";

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
