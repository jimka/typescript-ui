// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextArea } from "./lib/component/TextArea.js";
import { Fit } from "./lib/layout/Fit.js";
import { Panel } from "./lib/Panel.js";
import { callable } from "./lib/Callable.js";

class FitPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new Fit());

        let centerTextArea = new TextArea("Center textarea!");
        this.addComponent(centerTextArea);
    }
}

const FitPanelCallable = callable(FitPanel);
type FitPanelCallable = FitPanel;
export {
    FitPanel         as _FitPanel,
    FitPanelCallable as FitPanel
};
