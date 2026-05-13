// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { Row, callable } from "@jimka/typescript-ui";

class RowPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new Row());
    }
}

const RowPanelCallable = callable(RowPanel);
type RowPanelCallable = RowPanel;
export {
    RowPanel         as _RowPanel,
    RowPanelCallable as RowPanel
};
