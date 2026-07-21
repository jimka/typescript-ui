// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Border as BorderLayout } from "~/layout/Border.js";
import { Text, TextOptions } from "~/component/input/Text.js";
import { Insets } from "~/primitive/Insets.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { FillType } from "~/layout/FillType.js";
import { Placement } from "~/primitive/Placement.js";
import { Container } from "~/core/Container.js";
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
 * cascade in `Container`/`Component` dispatches each present setter once with the
 * final value. Font fields are handled in the constructor body once the inner
 * `text` child exists — they're written into `_options` by `applyOptions` and
 * dispatched from there.
 */
const _defaultHeaderOptions: Partial<HeaderOptions> = {
    // Static content padding around the header label — the single source of the
    // bar's padding (WindowHeader subclasses Header without passing its own
    // insets). 4px matches the spacing headers carried implicitly from Panel
    // before the Container reparent; it is not theme-derived, so headers do not
    // reflow their padding on a theme change.
    insets: new Insets(4, 4, 4, 4),
};

/**
 * A header bar component containing a left-aligned text label.
 *
 * Renders a `<header>` element with a Border layout manager and a bold label
 * anchored to the west side.
 *
 * @category Components
 */
class Header<TOptions extends HeaderOptions = HeaderOptions> extends Container<TOptions> {

    private _text!: Text;

    constructor(text: string, options?: TOptions) {
        super(
            options,
            { ..._defaultHeaderOptions, tag: "header" } as Partial<TOptions>,
        );

        this.setLayoutManager(new BorderLayout());

        // Build the inner text label. Font defaults are applied here when the
        // caller didn't supply an override — the cascade can't reach `this.text`
        // because it doesn't exist yet during `super`.
        this._text = new Text(text);
        if (this._options.fontWeight === undefined) {
            this._text.setFontWeight("bold");
        }
        if (this._options.fontSize === undefined) {
            this._text.setFontSize("--ts-ui-header-font-size");
        }
        this._text.setPointerEvents("none");

        this.addComponent(this._text, {
            placement: Placement.WEST,
            anchor: AnchorType.WEST,
            fill: FillType.HORIZONTAL
        });

        // Recompute the preferred height on theme change: the header font size
        // is theme-bound, so a theme swap can change the label's measured height.
        // The insets are static (see `_defaultHeaderOptions`), so padding is not
        // re-derived here.
        this.subscribeTheme(() => {
            this.updatePreferredSize();
        });

        if (this._options.preferredSize === undefined) {
            this.updatePreferredSize();
        }

        // Late-built state: font/text fields written pure into `_options` by
        // the super-time cascade. Dispatch them now that `this.text` exists.
        if (this._options.text !== undefined) {
            this._text.setText(this._options.text);
        }
        if (this._options.textAlign !== undefined) {
            this._text.setTextAlign(this._options.textAlign);
        }
        if (this._options.textShadow !== undefined) {
            this._text.setTextShadow(this._options.textShadow);
        }
        if (this._options.fontFamily !== undefined) {
            this._text.setFontFamily(this._options.fontFamily);
        }
        if (this._options.fontSize !== undefined) {
            this._text.setFontSize(this._options.fontSize);
        }
        if (this._options.fontWeight !== undefined) {
            this._text.setFontWeight(this._options.fontWeight);
        }
        if (this._options.fontStyle !== undefined) {
            this._text.setFontStyle(this._options.fontStyle);
        }
        if (this._options.fontVariant !== undefined) {
            this._text.setFontVariant(this._options.fontVariant);
        }
        if (this._options.fontStretch !== undefined) {
            this._text.setFontStretch(this._options.fontStretch);
        }
        if (this._options.fontKerning !== undefined) {
            this._text.setFontKerning(this._options.fontKerning);
        }
        if (this._options.fontSizeAdjust !== undefined) {
            this._text.setFontSizeAdjust(this._options.fontSizeAdjust);
        }
        if (this._options.lineHeight !== undefined) {
            this._text.setLineHeight(this._options.lineHeight);
        }
        if (this._options.textOverflow !== undefined) {
            this._text.setTextOverflow(this._options.textOverflow);
        }
    }

    /**
     * Applies a {@link HeaderOptions} bag. Inherited Container/Component fields
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
     * adjustments propagate to the header's layout hint automatically. `protected`
     * so a subclass can override the derivation — `WindowHeader` substitutes a
     * chrome-band thickness so its stretched controls fill the bar.
     */
    protected updatePreferredSize(): void {
        const textSize = this._text.getPreferredSize();
        const insets = this.getInsets();
        const textHeight = textSize ? textSize.height : 20;
        const preferredHeight = textHeight
                                    + insets.getTop()
                                    + insets.getBottom();

        this.setPreferredSize({ width: 100, height: preferredHeight });
    }

    /**
     * Returns the Text child used to display the header text.
     *
     * @returns The internal Text instance.
     */
    getText() {
        return this._text;
    }

    /**
     * Returns the offset from the top of the header to the label's text baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the label has no baseline.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this._text.getBaseline());
    }
}

const HeaderCallable = callable(Header);
type HeaderCallable<TOptions extends HeaderOptions = HeaderOptions> = Header<TOptions>;
export {
    Header         as _Header,
    HeaderCallable as Header
};
