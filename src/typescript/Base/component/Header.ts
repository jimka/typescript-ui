// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { Border as BorderLayout } from "../layout/Border.js";
import { Label } from "./Label.js";
import { Insets } from "../Insets.js";
import { AnchorType } from "../layout/AnchorType.js";
import { FillType } from "../layout/FillType.js";
import { Placement } from "../Placement.js";
import { ThemeManager } from "../Theme.js";

/**
 * A header bar component containing a left-aligned text label.
 *
 * Renders a `<header>` element with a Border layout manager and a bold label
 * anchored to the west side.
 *
 * @category Components
 */
export class Header extends Component {

    private label: Label;

    constructor(text: string) {
        super("header");

        this.setLayoutManager(new BorderLayout());

        this.label = new Label(text);
        this.label.setFontWeight("bold");
        this.label.setFontSize("--ts-ui-header-font-size");
        this.label.setPointerEvents("none");

        this.addComponent(this.label, {
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
     * Recalculates the preferred height from the label's measured preferred size.
     *
     * Called at construction time and after each theme change so that font-size
     * adjustments propagate to the header's layout hint automatically.
     */
    private updatePreferredSize(): void {
        const labelSize = this.label.getPreferredSize();
        const labelHeight = labelSize ? labelSize.height : 20;

        this.setPreferredSize(100, labelHeight);
    }

    private applyThemePadding(): void {
        const pad = ThemeManager.getTheme().header.padding;
        this.setInsets(new Insets(0, 0, 0, pad));
    }

    /**
     * Returns the Label child used to display the header text.
     *
     * @returns The internal Label instance.
     */
    getLabel() {
        return this.label;
    }
}