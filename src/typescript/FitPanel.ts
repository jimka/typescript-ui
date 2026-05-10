// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextArea } from "./Base/component/TextArea.js";
import { Fit } from "./Base/layout/Fit.js";
import { Panel } from "./Base/Panel.js";

export class FitPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new Fit());

        let centerTextArea = new TextArea("Center textarea!");
        this.addComponent(centerTextArea);
    }
}