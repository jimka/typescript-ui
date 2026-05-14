// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Header, HeaderOptions } from "~/component/Header.js";
import { Button } from "~/component/Button.js";
import { FontAwesomeIcon } from "~/component/FontAwesomeIcon.js";
import { FillType } from "~/layout/FillType.js";
import { Placement } from "~/Placement.js";
import { callable } from "~/Callable.js";

/**
 * Construction-time options for {@link WindowHeader}.
 *
 * @category Components
 */
export interface WindowHeaderOptions extends HeaderOptions {
    closeable?: boolean;
}

/**
 * A window title bar component with a close button.
 *
 * Extends Header by adding a Font Awesome "times" exit button anchored to the east side.
 *
 * @category Components
 */
class WindowHeader extends Header {

    private exitButton: Button;
    private activeBackgroundImage: string;

    constructor(text: string, options?: WindowHeaderOptions) {
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

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link WindowHeaderOptions} bag, dispatching the closeable flag
     * after inherited Header fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: WindowHeaderOptions): this {
        super.applyOptions(options);

        if (options.closeable !== undefined) {
            this.exitButton.setVisible(options.closeable);
        }

        return this;
    }

    /**
     * Toggles the title bar appearance between the focused and unfocused states.
     *
     * @param active - True to show the focused (gradient) background; false for the unfocused (flat) background.
     */
    setActive(active: boolean): this {
        if (active) {
            this.setBackgroundImage(this.activeBackgroundImage);
            this.setBackgroundColor(null);
        } else {
            this.setBackgroundImage(null);
            this.setBackgroundColor("var(--ts-ui-gutter-bg, rgb(200, 200, 200))");
        }

        return this;
    }

    /**
     * Registers a click listener on the window close button.
     *
     * @param listener - The callback to invoke when the close button is clicked.
     */
    addExitButtonListener(listener: Function) : this {
        this.exitButton.addActionListener(listener);

        return this;
    }
}

const WindowHeaderCallable = callable(WindowHeader);
type WindowHeaderCallable = WindowHeader;
export {
    WindowHeader         as _WindowHeader,
    WindowHeaderCallable as WindowHeader
};
