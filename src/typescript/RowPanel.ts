import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { Row } from "./Base/layout/Row.js";

export class RowPanel extends LayoutTestPanel {

    constructor() {
        super();

        this.setLayoutManager(new Row());
    }
}