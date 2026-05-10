// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Border as BorderLayout } from "../layout/Border.js";
import { Text } from "./Text.js";
import { Insets } from "../Insets.js";
import { AnchorType } from "../layout/AnchorType.js";
import { FillType } from "../layout/FillType.js";
import { Placement } from "../Placement.js";
import { ThemeManager } from "../Theme.js";
import { Panel } from "../Panel.js";

/**
 * A header bar component containing a left-aligned text label.
 *
 * Renders a `<header>` element with a Border layout manager and a bold label
 * anchored to the west side.
 *
 * @category Components
 */
export class Header extends Panel {

    private text: Text;

    constructor(text: string) {
        super("header");

        this.setLayoutManager(new BorderLayout());

        this.text = new Text(text);
        this.text.setFontWeight("bold");
        this.text.setFontSize("--ts-ui-header-font-size");
        this.text.setPointerEvents("none");

        this.addComponent(this.text, {
            placement: Placement.WEST,
            anchor: AnchorType.WEST,
            fill: FillType.HORIZONTAL
        });

        this.applyThemePadding();
        ThemeManager.onThemeChange(() => {
            this.updatePreferredSize();
            this.applyThemePadding();
        });

        this.updatePreferredSize();
    }

    /**
     * Recalculates the preferred height from the text component's measured preferred size.
     *
     * Called at construction time and after each theme change so that font-size
     * adjustments propagate to the header's layout hint automatically.
     */
    private updatePreferredSize(): void {
        const textSize = this.text.getPreferredSize();
        const insets = this.getInsets();
        const textHeight = textSize ? textSize.height : 20;
        const preferredHeight = textHeight
                                    + insets.getTop()
                                    + insets.getBottom();

        this.setPreferredSize(100, preferredHeight);
    }

    private applyThemePadding(): void {
        const pad = ThemeManager.getTheme().header.padding;
        this.setInsets(new Insets(pad, pad, pad, pad));
    }

    /**
     * Returns the Text child used to display the header text.
     *
     * @returns The internal Text instance.
     */
    getText() {
        return this.text;
    }

    /**
     * Returns the offset from the top of the header to the label's text baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the label has no baseline.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this.text.getBaseline());
    }
}