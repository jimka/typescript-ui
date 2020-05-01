import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { Column } from "./Base/layout/Column.js";

export class ColumnPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new Column());
    }
}