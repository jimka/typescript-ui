// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput } from "./TextInput.js";
import { Util } from "../Util.js";
import { Insets } from "../Insets.js";
import { ThemeManager } from "../Theme.js";

/**
 * A password input component that renders an `<input type="password">` element.
 */
export class PasswordField extends TextInput {

    constructor() {
        super();

        this.setPadding(new Insets(3, 3, 3, 3));
        this.setCursor("text");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");

        this.updateHeight();
        ThemeManager.onThemeChange(() => this.updateHeight());
    }

    /**
     * Recalculates preferred and maximum height from the native input's measured size.
     *
     * Called at construction time and after each theme change so that font-size
     * adjustments propagate to the layout hint automatically.
     */
    private updateHeight(): void {
        const h = Util.measureInputHeight();

        this.setPreferredSize(200, h);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, h);
    }

    /**
     * Renders the input element with type="password".
     *
     * @returns The created input element with its type attribute set to "password".
     */
    render() {
        let element = super.render();

        element.setAttribute("type", "password");

        return element;
    }
}
