// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { Grid, callable } from "@jimka/typescript-ui";

class GridPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new Grid({
            stretching: false
        }));
    }
}

const GridPanelCallable = callable(GridPanel);
type GridPanelCallable = GridPanel;
export {
    GridPanel         as _GridPanel,
    GridPanelCallable as GridPanel
};
