// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { ThemeManager } from "../Theme.js";

/**
 * A text-displaying component with comprehensive font and layout controls.
 *
 * Uses an off-screen probe element to measure text dimensions and automatically
 * updates the preferred size whenever the text or a font property changes.
 */
export class Text extends Component {

    private text: String | null | undefined = null;
    private hasExplicitPreferredSize = false;
    private textAlign: string | null = null;
    private textShadow: string | null = null;
    private fontFamily: string | null = null;
    private fontKerning: string | null = null;
    private fontSize: number | null = null;
    private fontSizeCSSVar : string | null = null;
    private fontSizeCSSRule: string | null = null;
    private readonly unsubscribeTheme: () => void;
    private fontSizeAdjust: string | null = null;
    private fontStretch: string | null = null;
    private fontStyle: string | null = null;
    private fontVariant: string | null = null;
    private fontWeight: string | null = null;
    private lineHeight: number | null = null;

    constructor(tag?: string, text?: String) {
        super(tag || "span");

        this.text = text;
        this.textAlign = "left";
        this.fontFamily = "var(--ts-ui-font-family, system-ui, sans-serif)";
        this.fontKerning = "auto";
        this.fontSize = 14;
        this.fontSizeCSSVar  = "--ts-ui-font-size";
        this.fontSizeCSSRule = "var(--ts-ui-font-size, 14px)";
        this.fontSizeAdjust = "none";
        this.fontStretch = "normal";
        this.fontStyle = "normal";
        this.fontVariant = "normal";
        this.fontWeight = "normal";

        this.setInsets(null);

        this.unsubscribeTheme = ThemeManager.onThemeChange(() => {
            if (this.fontSizeCSSVar) {
                const raw    = getComputedStyle(document.documentElement)
                                   .getPropertyValue(this.fontSizeCSSVar).trim();
                const parsed = parseFloat(raw);
                if (!isNaN(parsed)) {
                    this.fontSize = parsed;
                }
            }
            this.calculateSize();
        });

        this.calculateSize();
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
     */
    setPreferredSize(width: number, height: number): void {
        this.hasExplicitPreferredSize = true;
        super.setPreferredSize(width, height);
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
     */
    private calculateSize() {
        if (this.text) {
            let probe = document.createElement("span");

            probe.style.cssText = [
                "position:fixed",
                "visibility:hidden",
                "white-space:nowrap",
                `font-family:${this.fontFamily}`,
                `font-size:${this.fontSizeCSSRule ?? (this.fontSize !== null ? `${this.fontSize}px` : '')}`,
                `font-weight:${this.fontWeight}`,
                `font-style:${this.fontStyle}`,
                `font-variant:${this.fontVariant}`,
                `font-stretch:${this.fontStretch}`,
            ].join(";");

            probe.textContent = this.text.toString();
            document.body.appendChild(probe);

            let rect = probe.getBoundingClientRect();

            document.body.removeChild(probe);

            this.setCalculatedSize(rect.width, rect.height);
        } else {
            this.setCalculatedSize(0, 0);
        }
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
     */
    setText(text: String) {
        this.text = text || "";

        this.calculateSize();

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.textContent = text.valueOf();
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
     */
    setTextAlign(align: string) {
        this.textAlign = align;

        this.setElementCSSRule("textAlign", align);
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
     */
    setTextShadow(shadow: string) {
        this.textShadow = shadow;

        this.setElementCSSRule("textShadow", shadow);
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
     */
    setFontFamily(value: string) {
        this.fontFamily = value;

        this.setElementCSSRule("fontFamily", value);

        this.calculateSize();
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
     */
    setFontKerning(value: string) {
        this.fontKerning = value;

        this.setElementCSSRule("fontKerning", value);
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
     */
    setFontSize(value: number | string) {
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
     */
    setFontSizeAdjust(value: string) {
        this.fontSizeAdjust = value;

        this.setElementCSSRule("fontSizeAdjust", value);
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
     */
    setFontStretch(value: string) {
        this.fontStretch = value;

        this.setElementCSSRule("fontStretch", value);
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
     */
    setFontStyle(value: string) {
        this.fontStyle = value;

        this.setElementCSSRule("fontStyle", value);
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
     */
    setFontVariant(value: string) {
        this.fontVariant = value;

        this.setElementCSSRule("fontVariant", value);
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
     */
    setFontWeight(value: string) {
        this.fontWeight = value;

        this.setElementCSSRule("fontWeight", value);

        this.calculateSize();
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
     * Sets the line height in pixels and updates the component's CSS rule.
     *
     * @param value - The line height in pixels.
     */
    setLineHeight(value: number) {
        this.lineHeight = value;

        this.setElementCSSRule("lineHeight", value + "px");
    }

    /**
     * Applies all text-specific style properties to the element's CSS rule in addition to base styles.
     *
     * @param element - The HTMLElement to apply styles to.
     */
    applyStyle(element: HTMLElement) {
        super.applyStyle(element);

        let rule = this.getCSSRule();

        rule.style.setProperty('font-family', this.fontFamily ?? '');
        rule.style.textAlign = this.textAlign ? this.textAlign : "";
        rule.style.textShadow = this.textShadow ? this.textShadow : "";
        rule.style.fontKerning = this.fontKerning ? this.fontKerning : "";
        rule.style.setProperty('font-size',
            this.fontSizeCSSRule ?? (this.fontSize !== null ? `${this.fontSize}px` : ''));
        rule.style.fontSizeAdjust = this.fontSizeAdjust ? this.fontSizeAdjust : "";
        rule.style.fontStretch = this.fontStretch ? this.fontStretch : "";
        rule.style.fontStyle = this.fontStyle ? this.fontStyle : "";
        rule.style.fontVariant = this.fontVariant ? this.fontVariant : "";
        rule.style.fontWeight = this.fontWeight ? this.fontWeight : "";
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