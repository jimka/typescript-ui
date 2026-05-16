// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Border as BorderLayout } from "~/layout/Border.js";
import { Text, TextOptions } from "~/component/input/Text.js";
import { Insets } from "~/primitive/Insets.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { FillType } from "~/layout/FillType.js";
import { Placement } from "~/primitive/Placement.js";
import { ThemeManager } from "~/core/Theme.js";
import { Panel } from "~/core/Panel.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Header}. Text and font fields target
 * the inner header label, not the header bar itself.
 *
 * @category Components
 */
export interface HeaderOptions extends TextOptions {
}

/**
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade in `Panel`/`Component` dispatches each present setter once with the
 * final value. Font fields are handled in the constructor body once the inner
 * `text` child exists — they're written into `_options` by `applyOptions` and
 * dispatched from there.
 */
const _defaultHeaderOptions: Partial<HeaderOptions> = {
};

/**
 * A header bar component containing a left-aligned text label.
 *
 * Renders a `<header>` element with a Border layout manager and a bold label
 * anchored to the west side.
 *
 * @category Components
 */
class Header<TOptions extends HeaderOptions = HeaderOptions> extends Panel<TOptions> {

    private text!: Text;

    constructor(text: string, options?: TOptions) {
        // Merge defaults → consumer options → non-overridable structural keys.
        // Font/text fields are written pure to `_options` by `applyOptions` and
        // dispatched from the constructor body once the inner Text child
        // exists.
        super({
            ..._defaultHeaderOptions,
            ...(options ?? {}),
            tag: "header",
        } as TOptions);

        this.setLayoutManager(new BorderLayout());

        // Build the inner text label. Font defaults are applied here when the
        // caller didn't supply an override — the cascade can't reach `this.text`
        // because it doesn't exist yet during `super`.
        this.text = new Text(text);
        if (this._options.fontWeight === undefined) {
            this.text.setFontWeight("bold");
        }
        if (this._options.fontSize === undefined) {
            this.text.setFontSize("--ts-ui-header-font-size");
        }
        this.text.setPointerEvents("none");

        this.addComponent(this.text, {
            placement: Placement.WEST,
            anchor: AnchorType.WEST,
            fill: FillType.HORIZONTAL
        });

        if (this._options.insets === undefined) {
            this.applyThemePadding();
        }
        ThemeManager.onThemeChange(() => {
            this.updatePreferredSize();
            this.applyThemePadding();
        });

        if (this._options.preferredSize === undefined) {
            this.updatePreferredSize();
        }

        // Late-built state: font/text fields written pure into `_options` by
        // the super-time cascade. Dispatch them now that `this.text` exists.
        if (this._options.text !== undefined) {
            this.text.setText(this._options.text);
        }
        if (this._options.textAlign !== undefined) {
            this.text.setTextAlign(this._options.textAlign);
        }
        if (this._options.textShadow !== undefined) {
            this.text.setTextShadow(this._options.textShadow);
        }
        if (this._options.fontFamily !== undefined) {
            this.text.setFontFamily(this._options.fontFamily);
        }
        if (this._options.fontSize !== undefined) {
            this.text.setFontSize(this._options.fontSize);
        }
        if (this._options.fontWeight !== undefined) {
            this.text.setFontWeight(this._options.fontWeight);
        }
        if (this._options.fontStyle !== undefined) {
            this.text.setFontStyle(this._options.fontStyle);
        }
        if (this._options.fontVariant !== undefined) {
            this.text.setFontVariant(this._options.fontVariant);
        }
        if (this._options.fontStretch !== undefined) {
            this.text.setFontStretch(this._options.fontStretch);
        }
        if (this._options.fontKerning !== undefined) {
            this.text.setFontKerning(this._options.fontKerning);
        }
        if (this._options.fontSizeAdjust !== undefined) {
            this.text.setFontSizeAdjust(this._options.fontSizeAdjust);
        }
        if (this._options.lineHeight !== undefined) {
            this.text.setLineHeight(this._options.lineHeight);
        }
        if (this._options.textOverflow !== undefined) {
            this.text.setTextOverflow(this._options.textOverflow);
        }
    }

    /**
     * Applies a {@link HeaderOptions} bag. Inherited Panel/Component fields
     * cascade through `super.applyOptions`; text-targeting fields are written
     * pure into `_options` here and dispatched from the constructor body once
     * `this.text` exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.text           !== undefined) this._options.text           = options.text;
        if (options.textAlign      !== undefined) this._options.textAlign      = options.textAlign;
        if (options.textShadow     !== undefined) this._options.textShadow     = options.textShadow;
        if (options.fontFamily     !== undefined) this._options.fontFamily     = options.fontFamily;
        if (options.fontSize       !== undefined) this._options.fontSize       = options.fontSize;
        if (options.fontWeight     !== undefined) this._options.fontWeight     = options.fontWeight;
        if (options.fontStyle      !== undefined) this._options.fontStyle      = options.fontStyle;
        if (options.fontVariant    !== undefined) this._options.fontVariant    = options.fontVariant;
        if (options.fontStretch    !== undefined) this._options.fontStretch    = options.fontStretch;
        if (options.fontKerning    !== undefined) this._options.fontKerning    = options.fontKerning;
        if (options.fontSizeAdjust !== undefined) this._options.fontSizeAdjust = options.fontSizeAdjust;
        if (options.lineHeight     !== undefined) this._options.lineHeight     = options.lineHeight;
        if (options.textOverflow   !== undefined) this._options.textOverflow   = options.textOverflow;

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

const HeaderCallable = callable(Header);
type HeaderCallable<TOptions extends HeaderOptions = HeaderOptions> = Header<TOptions>;
export {
    Header         as _Header,
    HeaderCallable as Header
};
