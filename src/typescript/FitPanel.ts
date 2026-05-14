// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { TextArea } from '@jimka/typescript-ui/component/input';
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
