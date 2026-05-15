// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
import { Text } from "~/component/input/Text.js";
import { Glyph } from "~/component/display/Glyph.js";
import { FillType } from "~/layout/FillType.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { CSS } from "~/core/CSS.js";
import { Border, BorderOptions } from "~/primitive/Border.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Button}.
 *
 * @category Components
 */
export interface ButtonOptions extends ComponentOptions {
    text?:                   string;
    glyph?:                  string;
    enabled?:                boolean;
    pressedBackgroundColor?: string;
    pressedBackgroundImage?: string;
    pressedForegroundColor?: string;
    pressedBorder?:          BorderOptions;
    pressedBorderRadius?:    string;
    pressedShadow?:          string;
}

/**
 * A push button component with a text label and configurable pressed-state appearance.
 *
 * Maintains separate CSS rules for the normal and `:active` states, allowing
 * independent control of border, shadow, background, and foreground color when pressed.
 *
 * @example
 * ```typescript
 * import { Event } from '@jimka/typescript-ui/core';
 * import { Button } from '@jimka/typescript-ui/component/button';
 *
 * const button = new Button('Save');
 * Event.addListener(button, 'click', () => save());
 * panel.addComponent(button);
 * ```
 *
 * @category Components
 */
class Button extends Component {

    private text: Text;
    private _content: Component;
    private _glyph: Glyph | null = null;

    private pressedCSSRule: CSSStyleRule;

    private pressedBorder: Border | null = null;
    private pressedBorderRadius: string | null = null;
    private pressedShadow: string | null = null;
    private pressedForegroundColor: string | null = null;
    private pressedBackgroundColor: string | null = null;
    private pressedBackgroundImage: string | null = null;

    private _enabled: boolean = true;
    private _enabledCursor: string = "pointer";

    /**
     * Constructs a Button. At least one of `text` (positional or via options)
     * or `options.glyph` must be supplied; a button with neither is rejected
     * at runtime.
     *
     * @example
     * ```typescript
     * new Button('Save');
     * new Button({ glyph: 'times' });
     * new Button('Save', { glyph: 'check-circle' });
     * ```
     */
    constructor(text?: string, options?: ButtonOptions);
    constructor(options: ButtonOptions);
    constructor(textOrOptions?: string | ButtonOptions, options?: ButtonOptions) {
        super({ tag: "button" });

        // Normalise the overload: a non-string first argument is the options bag.
        let text: string | undefined;
        if (typeof textOrOptions === "string") {
            text = textOrOptions;
        } else if (textOrOptions !== undefined) {
            options = textOrOptions;
        }

        // Fall back to `options.text` when no positional text was supplied.
        // Lets `super({ text: "Save" })` from a subclass actually display the
        // label even though applyOptions is gated on `this.constructor === Button`.
        if (text === undefined) {
            text = options?.text;
        }

        const hasText  = text !== undefined;
        const hasGlyph = options?.glyph !== undefined && options.glyph !== null;
        if (!hasText && !hasGlyph) {
            throw new Error("Button must be given a `text` label or a `glyph` option (or both).");
        }

        this.pressedCSSRule = CSS.createComponentRule(this.getId() + ":active") as CSSStyleRule;

        this.setLayoutManager(new Fit());
        this.text = new Text(text);

        this.text.setPointerEvents("none");

        this.setInsets(new Insets(4, 4, 4, 4));
        this.text.setTextAlign("center");
        this.text.setFontWeight("bold");
        this.text.setFontSize("--ts-ui-button-font-size");

        this._content = new Component();
        this._content.setLayoutManager(new HBox({ spacing: 2 }));
        this._content.setInsets(new Insets(0, 0, 0, 0));
        this._content.setPointerEvents("none");
        this._content.addComponent(this.text);

        this.addComponent(this._content, {
            fill: FillType.NONE,
            anchor: AnchorType.CENTER
        });

        this.setCursor("pointer");
        this.setForegroundColor("var(--ts-ui-text-color, black)");
        this.setBorder({ style: BorderStyle.RIDGE, width: 2, color: "var(--ts-ui-button-border, rgb(200, 200, 200))" });
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setShadow("var(--ts-ui-button-shadow, 1px 2px 5px 0 rgba(0, 0, 0, 0.2))");
        this.setBackgroundImage("var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))");

        this.setPressedForegroundColor("var(--ts-ui-button-pressed-fg, rgb(150, 150, 150))");
        this.setPressedBackgroundColor("var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))");
        this.setPressedBackgroundImage("var(--ts-ui-button-pressed-bg, none)");
        this.setPressedShadow("var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0, 0, 0, 0.2) inset)");

        // Mount the glyph eagerly so `super({ glyph: ... })` from a subclass
        // (TabCloseButton, SpinButton, …) renders correctly without each
        // subclass having to repeat the setGlyph call. The rest of the
        // options bag is still gated on `this.constructor === Button` so
        // subclasses can apply their own options at their own time.
        if (options?.glyph) {
            this.setGlyph(options.glyph);
        }

        if (this.constructor === Button && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link ButtonOptions} bag, dispatching button-specific text,
     * enabled state, and pressed-state styling after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ButtonOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined) {
            this.text.setText(options.text);
        }

        if (options.glyph !== undefined) {
            this.setGlyph(options.glyph);
        }

        if (options.enabled !== undefined) {
            this.setEnabled(options.enabled);
        }

        if (options.pressedBackgroundColor !== undefined) {
            this.setPressedBackgroundColor(options.pressedBackgroundColor);
        }

        if (options.pressedBackgroundImage !== undefined) {
            this.setPressedBackgroundImage(options.pressedBackgroundImage);
        }

        if (options.pressedForegroundColor !== undefined) {
            this.setPressedForegroundColor(options.pressedForegroundColor);
        }

        if (options.pressedBorder !== undefined) {
            this.setPressedBorder(options.pressedBorder);
        }

        if (options.pressedBorderRadius !== undefined) {
            this.setPressedBorderRadius(options.pressedBorderRadius);
        }

        if (options.pressedShadow !== undefined) {
            this.setPressedShadow(options.pressedShadow);
        }

        return this;
    }

    /**
     * Returns the Text child component used to display the button text.
     *
     * @returns The internal Text instance.
     */
    getText() {
        return this.text;
    }

    /**
     * Sets or clears an optional leading [`Glyph`](/api/component/display/classes/Glyph) shown alongside the button's text.
     *
     * @param name - Registry glyph name to display, or `null` to clear an existing glyph.
     *
     * @returns This component, for method chaining.
     *
     * @remarks
     * The button's text always lives inside an [`HBox`](/api/layout/classes/HBox)-laid-out
     * content row centred by the outer [`Fit`](/api/layout/classes/Fit) layout. This setter
     * just swaps the leading glyph child of that row in or out — adding the glyph as the
     * first child and re-appending the text after it to preserve the `[glyph, text]` order.
     * Empty text combined with `setGlyph(name)` therefore renders as a glyph-only button
     * with no visual artifacts at the default 0px spacing.
     */
    setGlyph(name: string): this {
        if (this._glyph) {
            this._content.removeComponent(this._glyph);
            this._glyph = null;
        }

        const glyph = new Glyph(name);
        glyph.setPointerEvents("none");
        this._glyph = glyph;

        this._content.insertComponent(glyph, 0);

        return this;
    }

    /**
     * Removes the leading glyph from the button, if one is present.
     *
     * @returns This component, for method chaining.
     */
    clearGlyph(): this {
        if (this._glyph) {
            this._content.removeComponent(this._glyph);
            this._glyph = null;
        }

        return this;
    }

    /**
     * Returns the current leading glyph component, or null if none is set.
     *
     * @returns The [`Glyph`](/api/component/display/classes/Glyph) instance, or null.
     */
    getGlyph(): Glyph | null {
        return this._glyph;
    }

    /**
     * Returns the offset from the top of the button to the label's text baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the label has no baseline.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this.text.getBaseline());
    }

    /**
     * Registers a click event listener on this button.
     *
     * @param listener - The callback to invoke when the button is clicked.
     *
     * @returns This component, for method chaining.
     */
    addActionListener(listener: Function): this {
        Event.addListener(this, "click", listener);

        return this;
    }

    /**
     * Returns the background color applied when the button is in the :active state.
     *
     * @returns The CSS color string, or null if not set.
     */
    getPressedBackgroundColor() {
        return this.pressedBackgroundColor;
    }

    /**
     * Sets the background color for the :active CSS rule.
     *
     * @param backgroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBackgroundColor(backgroundColor: string): this {
        this.pressedBackgroundColor = backgroundColor;
        this.pressedCSSRule.style.setProperty('background-color', backgroundColor);

        return this;
    }

    /**
     * Removes the background-color from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBackgroundColor(): this {
        this.pressedBackgroundColor = null;
        this.pressedCSSRule.style.removeProperty('background-color');

        return this;
    }

    /**
     * Returns the background image applied when the button is in the :active state.
     *
     * @returns The CSS background-image string, or null if not set.
     */
    getPressedBackgroundImage() {
        return this.pressedBackgroundImage;
    }

    /**
     * Sets the background image for the :active CSS rule.
     *
     * @param backgroundImage - Optional. A CSS background-image string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBackgroundImage(backgroundImage: string): this {
        this.pressedBackgroundImage = backgroundImage;
        this.pressedCSSRule.style.setProperty('background-image', backgroundImage);

        return this;
    }

    /**
     * Removes the background-image from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBackgroundImage(): this {
        this.pressedBackgroundImage = null;
        this.pressedCSSRule.style.removeProperty('background-image');

        return this;
    }

    /**
     * Returns the text color applied when the button is in the :active state.
     *
     * @returns The CSS color string, or null if not set.
     */
    getPressedForegroundColor() {
        return this.pressedForegroundColor;
    }

    /**
     * Sets the text color for the :active CSS rule.
     *
     * @param foregroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedForegroundColor(foregroundColor: string): this {
        this.pressedForegroundColor = foregroundColor;
        this.pressedCSSRule.style.setProperty('color', foregroundColor);

        return this;
    }

    /**
     * Removes the color (foreground) from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedForegroundColor(): this {
        this.pressedForegroundColor = null;
        this.pressedCSSRule.style.removeProperty('color');

        return this;
    }

    /**
     * Returns the border applied when the button is in the :active state.
     *
     * @returns The Border instance for the :active state, or null if not set.
     */
    getPressedBorder() {
        return this.pressedBorder;
    }

    /**
     * Sets the border for the :active CSS rule.
     *
     * @param options - Optional. Border configuration (style, width, color). Omit to apply a default border.
     *
     * @returns This component, for method chaining.
     */
    setPressedBorder(options?: BorderOptions): this {
        this.pressedBorder = new Border(options);

        if (this.pressedBorder) {
            this.pressedBorder.applyOnCSSRule(this.pressedCSSRule);
        } else {
            this.pressedCSSRule.style.removeProperty("border");
        }

        return this;
    }

    /**
     * Returns the border radius applied when the button is in the :active state.
     *
     * @returns The CSS border-radius string, or null if not set.
     */
    getPressedBorderRadius() {
        return this.pressedBorderRadius;
    }

    /**
     * Sets the border radius for the :active CSS rule.
     *
     * @param borderRadius - Optional. A CSS border-radius string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBorderRadius(borderRadius: string): this {
        this.pressedBorderRadius = borderRadius;
        this.pressedCSSRule.style.setProperty('border-radius', borderRadius);

        return this;
    }

    /**
     * Removes the border-radius from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBorderRadius(): this {
        this.pressedBorderRadius = null;
        this.pressedCSSRule.style.removeProperty('border-radius');

        return this;
    }

    /**
     * Returns the box shadow applied when the button is in the :active state.
     *
     * @returns The CSS box-shadow string, or null if not set.
     */
    getPressedShadow() {
        return this.pressedShadow;
    }

    /**
     * Sets the box shadow for the :active CSS rule.
     *
     * @param shadow - A CSS box-shadow string, or null to set the shadow to "none".
     *
     * @returns This component, for method chaining.
     */
    setPressedShadow(shadow: string): this {
        this.pressedShadow = shadow;
        this.pressedCSSRule.style.setProperty('box-shadow', shadow);

        return this;
    }

    /**
     * Removes the box-shadow from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedShadow(): this {
        this.pressedShadow = null;
        this.pressedCSSRule.style.removeProperty('box-shadow');

        return this;
    }

    /**
     * Enables or disables the button.
     *
     * @param enabled - True to enable, false to disable.
     *
     * @remarks
     * When disabled, sets the native `disabled` attribute on the underlying
     * `<button>` element (which suppresses pointer events and `:active`),
     * dims the button to 0.5 opacity, and switches the cursor to `not-allowed`.
     * Re-enabling restores the previous cursor and clears the opacity override.
     */
    setEnabled(enabled: boolean): this {
        if (this._enabled === enabled) {
            return this;
        }

        this._enabled = enabled;

        if (enabled) {
            this.setDisabledAttribute(false);
            this.clearOpacity();
            this.setCursor(this._enabledCursor);
        } else {
            this._enabledCursor = this.getCursor() ?? "pointer";
            this.setDisabledAttribute(true);
            this.setOpacity(0.5);
            this.setCursor("not-allowed");
        }

        return this;
    }

    /**
     * Returns whether the button is currently enabled.
     *
     * @returns True if the button accepts user interaction.
     */
    isEnabled(): boolean {
        return this._enabled;
    }
}

const ButtonCallable = callable(Button);
type ButtonCallable = Button;
export {
    Button         as _Button,
    ButtonCallable as Button
};
