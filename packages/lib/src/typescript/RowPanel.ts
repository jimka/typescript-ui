// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { callable } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
class RowPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new VBox({ mode: "equal", stretching: true }));
    }
}

const RowPanelCallable = callable(RowPanel);
type RowPanelCallable = RowPanel;
export {
    RowPanel         as _RowPanel,
    RowPanelCallable as RowPanel
};
