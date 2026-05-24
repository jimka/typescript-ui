// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { callable } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
class ColumnPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new HBox({
            mode:       "equal",
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
