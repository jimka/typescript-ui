// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button } from "./Button.js";
import { Insets } from "../Insets.js";

/**
 * A compact close button displaying a "×" glyph, sized to sit flush inside a tab header.
 */
export class TabCloseButton extends Button {

    /**
     * Creates a TabCloseButton with a "×" label sized for use in a tab toolbar.
     */
    constructor() {
        super("×");

        this.setPreferredSize(16, 16);
        this.setInsets(new Insets(0, 0, 0, 0));
        this.setForegroundColor("var(--ts-ui-close-button-fg, #555)");
    }
}
