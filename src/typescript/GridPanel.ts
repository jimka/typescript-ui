// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { Grid } from "./lib/layout/Grid.js";
import { callable } from "./lib/Callable.js";

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
