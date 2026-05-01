// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Header } from "./Header.js";
import { Button } from "./Button.js";
import { FontAwesomeIcon } from "./FontAwesomeIcon.js";
import { FillType } from "../layout/FillType.js";
import { Placement } from "../Placement.js";

/**
 * A window title bar component with a close button.
 *
 * Extends Header by adding a Font Awesome "times" exit button anchored to the east side.
 */
export class WindowHeader extends Header {

    private exitButton: Button;

    constructor(text: string) {
        super(text);

        this.setBackgroundImage("var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))");

        this.exitButton = new Button();
        this.exitButton.setBackgroundImage("var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))");
        this.exitButton.setBorder();
        this.exitButton.removeAllComponents();

        let fontAwesomeIcon = new FontAwesomeIcon("fas", "times");
        fontAwesomeIcon.setPointerEvents("none");
        this.exitButton.addComponent(fontAwesomeIcon, {
            fill: FillType.NONE
        });

        this.addComponent(this.exitButton, { placement: Placement.EAST });
    }

    /**
     * Registers a click listener on the window close button.
     *
     * @param listener - The callback to invoke when the close button is clicked.
     */
    addExitButtonListener(listener: Function) {
        this.exitButton.addActionListener(listener);
    }
}