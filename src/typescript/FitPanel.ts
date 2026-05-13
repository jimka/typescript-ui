// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    callable,
    Fit,
    Panel,
    TextArea
} from "@jimka/typescript-ui";

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
