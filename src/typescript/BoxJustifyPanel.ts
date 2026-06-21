// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox, BoxJustify } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
import { FieldSet } from '@jimka/typescript-ui/component/container';

// The five main-axis justify modes, one labelled row each.
const JUSTIFY_MODES: BoxJustify[] = ["start", "center", "end", "between", "around"];

class BoxJustifyPanel extends Panel {

    constructor() {
        super({ autoScroll: 'auto' });

        // Stretch each row to the full width so the inner HBox has horizontal
        // slack to justify; without stretching the FieldSet would shrink to the
        // button block and there would be nothing to distribute.
        this.setLayoutManager(new VBox({ stretching: true }));

        for (const justify of JUSTIFY_MODES) {
            this.addComponent(this.buildJustifyRow(justify));
        }
    }

    /**
     * Builds one labelled FieldSet whose inner HBox justifies three buttons with
     * the given mode, so the row visibly demonstrates that distribution.
     *
     * @param justify - The {@link BoxJustify} mode this row exercises.
     * @returns The configured FieldSet.
     */
    private buildJustifyRow(justify: BoxJustify): FieldSet {
        return FieldSet(`justify: "${justify}"`, {
            layoutManager: HBox({ justify }),
            components: [
                Button({ text: "One"   }),
                Button({ text: "Two"   }),
                Button({ text: "Three" })
            ]
        });
    }
}

const BoxJustifyPanelCallable = callable(BoxJustifyPanel);
type BoxJustifyPanelCallable = BoxJustifyPanel;
export {
    BoxJustifyPanel         as _BoxJustifyPanel,
    BoxJustifyPanelCallable as BoxJustifyPanel
};
