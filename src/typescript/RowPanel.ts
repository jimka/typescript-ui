// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { Row } from "./Base/layout/Row.js";
import { callable } from "./Base/Callable.js";

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
