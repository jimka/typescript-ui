// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { ThemeManager } from "~/core/Theme.js";
import { Util } from "~/core/Util.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Text}.
 *
 * @category Components
 */
export interface TextOptions extends ComponentOptions {
    tag?:            string;
    text?:           string;
    textAlign?:      string;
    textShadow?:     string;
    fontFamily?:     string;
    fontSize?:       number | string;
    fontWeight?:     string;
    fontStyle?:      string;
    fontVariant?:    string;
    fontStretch?:    string;
    fontKerning?:    string;
    fontSizeAdjust?: string;
    lineHeight?:     number | string;
    textOverflow?:   string;
    whiteSpace?:     string;
}

/**
 * A text-displaying component with comprehensive font and layout controls.
 *
 * Uses an off-screen probe element to measure text dimensions and automatically
 * updates the preferred size whenever the text or a font property changes.
 *
 * `Text` subscribes to {@link ThemeManager} on construction so it re-measures itself
 * on every theme change. Components that create `Text` instances dynamically and
 * remove them from the page should call `text.dispose()` to detach the listener.
 *
 * @category Components
 */
class Text extends Component {

    private text: String | null | undefined = null;
    private hasExplicitPreferredSize: boolean = false;
    private textAlign: string | null = "left";
    private textShadow: string | null = null;
    private fontFamily: string | null = "var(--ts-ui-font-family, system-ui, sans-serif)";
    private fontKerning: string | null = "auto";
    private fontSize: number | null = 14;
    private fontSizeCSSVar : string | null = "--ts-ui-font-size";
    private fontSizeCSSRule: string | null = "var(--ts-ui-font-size, 14px)";
    private readonly unsubscribeTheme: () => void;
    private fontSizeAdjust: string | null = "none";
    private fontStretch: string | null = "normal";
    private fontStyle: string | null = "normal";
    private fontVariant: string | null = "normal";
    private fontWeight: string | null = "normal";
    private lineHeight: number | null = null;
    private lineHeightCSSVar : string | null = "--ts-ui-line-height";
    private lineHeightCSSRule: string | null = "var(--ts-ui-line-height, 1.2)";
    private measuredBaseline: number | null = null;
    private autoMeasure: boolean = true;

    constructor(text?: String, options?: TextOptions) {
        super({ tag: options?.tag ?? "span" });

        this.text       = text;
        this.lineHeight = this.readThemeLineHeightPx();

        this.setInsets(null);
        this.setElementCSSRule("lineHeight", this.lineHeightCSSRule);

        this.unsubscribeTheme = ThemeManager.onThemeChange(() => {
            if (this.fontSizeCSSVar) {
                const raw    = getComputedStyle(document.documentElement)
                                   .getPropertyValue(this.fontSizeCSSVar)
                                   .trim();
                const parsed = parseFloat(raw);

                if (!isNaN(parsed)) {
                    this.fontSize = parsed;
                }
            }

            if (this.lineHeightCSSVar) {
                this.lineHeight = this.readThemeLineHeightPx();
            }

            this.calculateSize();
        });

        this.calculateSize();

        if (this.constructor === Text && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link TextOptions} bag to this component, dispatching font and
     * text properties to their corresponding setters after the inherited
     * Component fields have been applied.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TextOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined) {
            this.setText(options.text);
        }

        if (options.textAlign !== undefined) {
            this.setTextAlign(options.textAlign);
        }

        if (options.textShadow !== undefined) {
            this.setTextShadow(options.textShadow);
        }

        if (options.fontFamily !== undefined) {
            this.setFontFamily(options.fontFamily);
        }

        if (options.fontSize !== undefined) {
            this.setFontSize(options.fontSize);
        }

        if (options.fontWeight !== undefined) {
            this.setFontWeight(options.fontWeight);
        }

        if (options.fontStyle !== undefined) {
            this.setFontStyle(options.fontStyle);
        }

        if (options.fontVariant !== undefined) {
            this.setFontVariant(options.fontVariant);
        }

        if (options.fontStretch !== undefined) {
            this.setFontStretch(options.fontStretch);
        }

        if (options.fontKerning !== undefined) {
            this.setFontKerning(options.fontKerning);
        }

        if (options.fontSizeAdjust !== undefined) {
            this.setFontSizeAdjust(options.fontSizeAdjust);
        }

        if (options.lineHeight !== undefined) {
            this.setLineHeight(options.lineHeight);
        }

        if (options.textOverflow !== undefined) {
            this.setTextOverflow(options.textOverflow);
        }

        if (options.whiteSpace !== undefined) {
            this.setWhiteSpace(options.whiteSpace);
        }

        return this;
    }

    /**
     * Reads the active theme's `--ts-ui-line-height` (a unitless multiplier)
     * and resolves it to a pixel value relative to the current font size.
     *
     * @returns The line height in pixels, or `fontSize * 1.2` as a fallback
     * when the variable is missing or unparseable.
     */
    private readThemeLineHeightPx(): number {
        const fs = this.fontSize ?? 14;

        if (!this.lineHeightCSSVar) {
            return fs;
        }

        const raw    = getComputedStyle(document.documentElement)
                           .getPropertyValue(this.lineHeightCSSVar)
                           .trim();
        const parsed = parseFloat(raw);

        return isNaN(parsed) ? fs * 1.2 : fs * parsed;
    }

    /**
     * Returns the DOM element cast to HTMLElement.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's HTMLElement.
     */
    getElement(createIfMissing: boolean = false): HTMLElement {
        return super.getElement(createIfMissing) as HTMLElement;
    }

    /**
     * Sets the preferred size from an explicit caller, locking it against automatic recalculation.
     *
     * @returns This component, for method chaining.
     */
    setPreferredSize(width: number, height: number): this {
        this.hasExplicitPreferredSize = true;
        super.setPreferredSize(width, height);

        return this;
    }

    /**
     * Updates the preferred size from a measurement only when no explicit size has been set.
     */
    private setCalculatedSize(width: number, height: number): void {
        if (!this.hasExplicitPreferredSize) {
            super.setPreferredSize(width, height);
        }
    }

    /**
     * Measures the text using an off-screen probe element and sets the preferred size.
     *
     * @remarks Creates a temporary fixed-positioned invisible `<span>`, appends it to the body
     * to obtain its bounding rect, then removes it. Sets preferred size to (0, 0) when no text is set.
     * No-op when {@link setAutoMeasure} is `false` — the parent layout is expected to size this Text.
     */
    private calculateSize(): void {
        if (!this.autoMeasure) {
            return;
        }

        if (this.text) {
            const { width, height, baseline } = Util.measureTextMetrics(this.text.toString(), {
                fontFamily : this.fontFamily      ?? undefined,
                fontSize   : this.fontSizeCSSRule ?? (this.fontSize !== null ? `${this.fontSize}px` : undefined),
                fontWeight : this.fontWeight      ?? undefined,
                fontStyle  : this.fontStyle       ?? undefined,
                fontVariant: this.fontVariant     ?? undefined,
                fontStretch: this.fontStretch     ?? undefined,
                lineHeight : this.lineHeightCSSRule ?? (this.lineHeight !== null ? `${this.lineHeight}px` : undefined)
            });

            this.measuredBaseline = baseline;
            this.setCalculatedSize(width, height);
        } else {
            this.measuredBaseline = 0;
            this.setCalculatedSize(0, 0);
        }
    }

    /**
     * Forces a one-off text measurement that ignores {@link setAutoMeasure}.
     * Use when the caller has opted out of auto-measure but needs an up-to-date
     * preferred size after a programmatic text change.
     */
    measure(): void {
        const wasAuto = this.autoMeasure;
        this.autoMeasure = true;
        this.calculateSize();
        this.autoMeasure = wasAuto;
    }

    /**
     * Returns the visual baseline of the rendered text, accounting for any
     * border, padding, or framework insets on this component.
     *
     * @returns The baseline offset from the component's outer top, in pixels,
     * or `null` when no text has been measured yet.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this.measuredBaseline);
    }

    /**
     * Returns the current text content, or an empty string if none is set.
     *
     * @returns The current text string, or "" if no text is set.
     */
    getText() {
        return this.text || "";
    }

    /**
     * Sets the text content, recalculates the preferred size, and updates the DOM element.
     *
     * @param text - The new text to display.
     *
     * @returns This component, for method chaining.
     */
    setText(text: String): this {
        this.text = text || "";

        this.calculateSize();

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.textContent = text.valueOf();

        return this;
    }

    /**
     * Enables or disables automatic text measurement on `setText`.
     *
     * @param enabled - When `false`, `setText` skips the off-screen probe and
     *                  leaves preferred size and baseline unchanged. Use only when
     *                  the parent layout (e.g. [`Fit`](/api/layout/classes/Fit)) sizes this Text from
     *                  the container, so the measured preferred size is unused.
     *
     * @returns This component, for method chaining.
     */
    setAutoMeasure(enabled: boolean): this {
        this.autoMeasure = enabled;

        return this;
    }

    /**
     * Returns the current CSS text-align value.
     *
     * @returns The CSS text-align string, or null if not set.
     */
    getTextAlign() {
        return this.textAlign;
    }

    /**
     * Sets the CSS text-align and updates the component's CSS rule.
     *
     * @param align - A CSS text-align value (e.g. "left", "center", "right").
     *
     * @returns This component, for method chaining.
     */
    setTextAlign(align: string): this {
        this.textAlign = align;

        this.setElementCSSRule("textAlign", align);

        return this;
    }

    /**
     * Returns the CSS text-shadow value.
     *
     * @returns The CSS text-shadow string, or null if not set.
     */
    getTextShadow() {
        return this.textShadow;
    }

    /**
     * Sets the CSS text-shadow and updates the component's CSS rule.
     *
     * @param shadow - A CSS text-shadow value.
     *
     * @returns This component, for method chaining.
     */
    setTextShadow(shadow: string): this {
        this.textShadow = shadow;

        this.setElementCSSRule("textShadow", shadow);

        return this;
    }

    /**
     * Returns the CSS font-family value.
     *
     * @returns The CSS font-family string, or null if not set.
     */
    getFontFamily() {
        return this.fontFamily;
    }

    /**
     * Sets the CSS font-family, updates the rule, and recalculates preferred size.
     *
     * @param value - The CSS font-family string (e.g. "sans-serif", "'Arial', sans-serif").
     *
     * @returns This component, for method chaining.
     */
    setFontFamily(value: string): this {
        this.fontFamily = value;

        this.setElementCSSRule("fontFamily", value);

        this.calculateSize();

        return this;
    }

    /**
     * Returns the CSS font-kerning value.
     *
     * @returns The CSS font-kerning string, or null if not set.
     */
    getFontKerning() {
        return this.fontKerning;
    }

    /**
     * Sets the CSS font-kerning and updates the component's CSS rule.
     *
     * @param value - A CSS font-kerning value (e.g. "auto", "normal", "none").
     *
     * @returns This component, for method chaining.
     */
    setFontKerning(value: string): this {
        this.fontKerning = value;

        this.setElementCSSRule("fontKerning", value);

        return this;
    }

    /**
     * Returns the font size in pixels.
     *
     * @returns The font size as a number, or null if not set.
     */
    getFontSize() {
        return this.fontSize;
    }

    /**
     * Sets the font size. Pass a number for an explicit pixel value, or a CSS variable name
     * (e.g. `"--ts-ui-header-font-size"`) to bind to a theme token.
     *
     * @param value - Pixel size as a number, or a CSS custom property name as a string.
     *
     * @returns This component, for method chaining.
     */
    setFontSize(value: number | string): this {
        if (typeof value === 'number') {
            this.fontSize        = value;
            this.fontSizeCSSVar  = null;
            this.fontSizeCSSRule = null;
            this.setElementCSSRule("fontSize", value + "px");
        } else {
            const raw    = getComputedStyle(document.documentElement).getPropertyValue(value).trim();
            const parsed = parseFloat(raw);

            if (!isNaN(parsed)) {
                this.fontSize = parsed;
            }

            this.fontSizeCSSVar  = value;
            this.fontSizeCSSRule = `var(${value}, ${this.fontSize ?? 14}px)`;
            this.setElementCSSRule("fontSize", this.fontSizeCSSRule);
        }

        this.calculateSize();

        return this;
    }

    /**
     * Returns the CSS font-size-adjust value.
     *
     * @returns The CSS font-size-adjust string, or null if not set.
     */
    getFontSizeAdjust() {
        return this.fontSizeAdjust;
    }

    /**
     * Sets the CSS font-size-adjust and updates the component's CSS rule.
     *
     * @param value - A CSS font-size-adjust value.
     *
     * @returns This component, for method chaining.
     */
    setFontSizeAdjust(value: string): this {
        this.fontSizeAdjust = value;

        this.setElementCSSRule("fontSizeAdjust", value);

        return this;
    }

    /**
     * Returns the CSS font-stretch value.
     *
     * @returns The CSS font-stretch string, or null if not set.
     */
    getFontStretch() {
        return this.fontStretch;
    }

    /**
     * Sets the CSS font-stretch and updates the component's CSS rule.
     *
     * @param value - A CSS font-stretch value (e.g. "normal", "condensed", "expanded").
     *
     * @returns This component, for method chaining.
     */
    setFontStretch(value: string): this {
        this.fontStretch = value;

        this.setElementCSSRule("fontStretch", value);

        return this;
    }

    /**
     * Returns the CSS font-style value (e.g. "normal", "italic").
     *
     * @returns The CSS font-style string, or null if not set.
     */
    getFontStyle() {
        return this.fontStyle;
    }

    /**
     * Sets the CSS font-style and updates the component's CSS rule.
     *
     * @param value - A CSS font-style value (e.g. "normal", "italic", "oblique").
     *
     * @returns This component, for method chaining.
     */
    setFontStyle(value: string): this {
        this.fontStyle = value;

        this.setElementCSSRule("fontStyle", value);

        return this;
    }

    /**
     * Returns the CSS font-variant value.
     *
     * @returns The CSS font-variant string, or null if not set.
     */
    getFontVariant() {
        return this.fontVariant;
    }

    /**
     * Sets the CSS font-variant and updates the component's CSS rule.
     *
     * @param value - A CSS font-variant value (e.g. "normal", "small-caps").
     *
     * @returns This component, for method chaining.
     */
    setFontVariant(value: string): this {
        this.fontVariant = value;

        this.setElementCSSRule("fontVariant", value);

        return this;
    }

    /**
     * Returns the CSS font-weight value.
     *
     * @returns The CSS font-weight string, or null if not set.
     */
    getFontWeight() {
        return this.fontWeight;
    }

    /**
     * Sets the CSS font-weight, updates the rule, and recalculates preferred size.
     *
     * @param value - A CSS font-weight value (e.g. "normal", "bold", "700").
     *
     * @returns This component, for method chaining.
     */
    setFontWeight(value: string): this {
        this.fontWeight = value;

        this.setElementCSSRule("fontWeight", value);

        this.calculateSize();

        return this;
    }

    /**
     * Returns the line height in pixels, or null if not set.
     *
     * @returns The line height as a number, or null if not set.
     */
    getLineHeight() {
        return this.lineHeight;
    }

    /**
     * Sets the line height. Pass a number for an explicit pixel value (which
     * stops tracking the theme), or a CSS variable name (e.g.
     * `"--ts-ui-line-height"`) to bind to a theme token. Theme tokens are
     * interpreted as unitless multipliers of the current font size, so they
     * scale automatically when the font size changes.
     *
     * @param value - Pixel value as a number, or a CSS custom property name as a string.
     *
     * @returns This component, for method chaining.
     */
    setLineHeight(value: number | string): this {
        if (typeof value === 'number') {
            this.lineHeight        = value;
            this.lineHeightCSSVar  = null;
            this.lineHeightCSSRule = null;
            this.setElementCSSRule("lineHeight", value + "px");
        } else {
            this.lineHeightCSSVar  = value;
            this.lineHeightCSSRule = `var(${value}, 1.2)`;
            this.lineHeight        = this.readThemeLineHeightPx();
            this.setElementCSSRule("lineHeight", this.lineHeightCSSRule);
        }

        this.calculateSize();

        return this;
    }

    /**
     * Sets the CSS text-overflow property and updates the component's CSS rule.
     *
     * @param value - A CSS text-overflow value (e.g. "clip", "ellipsis").
     *
     * @returns This component, for method chaining.
     */
    setTextOverflow(value: string): this {
        this.setElementCSSRule("textOverflow", value);

        return this;
    }

    /**
     * Sets the CSS white-space property and updates the component's CSS rule.
     *
     * @param value - A CSS white-space value (e.g. "nowrap", "normal", "pre").
     *
     * @returns This component, for method chaining.
     */
    setWhiteSpace(value: string): this {
        this.setElementCSSRule("whiteSpace", value);

        return this;
    }

    /**
     * Applies all text-specific style properties to the element's CSS rule in addition to base styles.
     *
     * @param element - The HTMLElement to apply styles to.
     */
    applyStyle(element: HTMLElement): this {
        super.applyStyle(element);

        this.setElementCSSRules({
            fontFamily:     this.fontFamily      ?? '',
            textAlign:      this.textAlign        ? this.textAlign          : '',
            textShadow:     this.textShadow       ? this.textShadow         : '',
            fontKerning:    this.fontKerning      ? this.fontKerning        : '',
            fontSize:       this.fontSizeCSSRule ?? (this.fontSize !== null ? `${this.fontSize}px` : ''),
            fontSizeAdjust: this.fontSizeAdjust   ? this.fontSizeAdjust     : '',
            fontStretch:    this.fontStretch      ? this.fontStretch        : '',
            fontStyle:      this.fontStyle        ? this.fontStyle          : '',
            fontVariant:    this.fontVariant      ? this.fontVariant        : '',
            fontWeight:     this.fontWeight       ? this.fontWeight         : '',
            lineHeight:     this.lineHeightCSSRule ?? (this.lineHeight !== null ? `${this.lineHeight}px` : '')
        });

        return this;
    }

    /**
     * Removes the theme-change listener. Call when the component is permanently removed.
     */
    dispose() {
        this.unsubscribeTheme();
    }

    /**
     * Renders the element and sets its text content.
     *
     * @returns The created element with textContent initialised.
     */
    protected render() {
        let element = super.render();

        element.textContent = this.getText().valueOf();

        return element;
    }
}

const TextCallable = callable(Text);
type TextCallable = Text;
export {
    Text         as _Text,
    TextCallable as Text
};
