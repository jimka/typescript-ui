// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Border as BorderLayout } from "../layout/Border.js";
import { Text, TextOptions } from "./Text.js";
import { Insets } from "../Insets.js";
import { AnchorType } from "../layout/AnchorType.js";
import { FillType } from "../layout/FillType.js";
import { Placement } from "../Placement.js";
import { ThemeManager } from "../Theme.js";
import { Panel } from "../Panel.js";

/**
 * Construction-time options for {@link Header}. Text and font fields target
 * the inner header label, not the header bar itself.
 *
 * @category Components
 */
export interface HeaderOptions extends TextOptions {
}

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

    constructor(text: string, options?: HeaderOptions) {
        super({ tag: "header" });

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

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link HeaderOptions} bag, dispatching text-specific fields to
     * the inner label and Component-level fields to the header itself.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: HeaderOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined) {
            this.text.setText(options.text);
        }

        if (options.textAlign !== undefined) {
            this.text.setTextAlign(options.textAlign);
        }

        if (options.textShadow !== undefined) {
            this.text.setTextShadow(options.textShadow);
        }

        if (options.fontFamily !== undefined) {
            this.text.setFontFamily(options.fontFamily);
        }

        if (options.fontSize !== undefined) {
            this.text.setFontSize(options.fontSize);
        }

        if (options.fontWeight !== undefined) {
            this.text.setFontWeight(options.fontWeight);
        }

        if (options.fontStyle !== undefined) {
            this.text.setFontStyle(options.fontStyle);
        }

        if (options.fontVariant !== undefined) {
            this.text.setFontVariant(options.fontVariant);
        }

        if (options.fontStretch !== undefined) {
            this.text.setFontStretch(options.fontStretch);
        }

        if (options.fontKerning !== undefined) {
            this.text.setFontKerning(options.fontKerning);
        }

        if (options.fontSizeAdjust !== undefined) {
            this.text.setFontSizeAdjust(options.fontSizeAdjust);
        }

        if (options.lineHeight !== undefined) {
            this.text.setLineHeight(options.lineHeight);
        }

        if (options.textOverflow !== undefined) {
            this.text.setTextOverflow(options.textOverflow);
        }

        return this;
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