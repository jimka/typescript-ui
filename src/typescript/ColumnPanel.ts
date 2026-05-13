// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import {
    callable,
    Column
} from "@jimka/typescript-ui";

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
