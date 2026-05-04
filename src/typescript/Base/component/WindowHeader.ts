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
    private activeBackgroundImage: string;

    constructor(text: string) {
        super(text);

        this.activeBackgroundImage = "var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))";
        this.setBackgroundImage(this.activeBackgroundImage);

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
     * Toggles the title bar appearance between the focused and unfocused states.
     *
     * @param active - True to show the focused (gradient) background; false for the unfocused (flat) background.
     */
    setActive(active: boolean): void {
        if (active) {
            this.setBackgroundImage(this.activeBackgroundImage);
            this.setBackgroundColor(null);
        } else {
            this.setBackgroundImage(null);
            this.setBackgroundColor("var(--ts-ui-gutter-bg, rgb(200, 200, 200))");
        }
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