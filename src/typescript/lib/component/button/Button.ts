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
import { StyleRule } from "~/core/StyleTarget.js";
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
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins. Includes the
 * `pressedX` defaults because `pressedStyleRule` is a lazy getter — pressed*
 * setters are safe to fire during the super cascade and queue their writes
 * until the rule materialises.
 */
const _defaultButtonOptions: Partial<ButtonOptions> = {
    cursor:                 "pointer",
    foregroundColor:        "var(--ts-ui-text-color, black)",
    border:                 { style: BorderStyle.RIDGE, width: 2, color: "var(--ts-ui-button-border, rgb(200, 200, 200))" },
    borderRadius:           "var(--ts-ui-border-radius, 4px)",
    shadow:                 "var(--ts-ui-button-shadow, 1px 2px 5px 0 rgba(0, 0, 0, 0.2))",
    backgroundImage:        "var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))",
    insets:                 new Insets(4, 4, 4, 4),
    pressedForegroundColor: "var(--ts-ui-button-pressed-fg, rgb(150, 150, 150))",
    pressedBackgroundColor: "var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))",
    pressedBackgroundImage: "var(--ts-ui-button-pressed-bg, none)",
    pressedShadow:          "var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0, 0, 0, 0.2) inset)",
};

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
class Button<TOptions extends ButtonOptions = ButtonOptions> extends Component<TOptions> {

    private text!:    Text;
    private _content!: Component;
    private _glyph: Glyph | null = null;

    // Lazy `:active` rule. The backing field is undefined until first access
    // so the getter is safe to call from the `super` cascade — which runs
    // before subclass field initializers — when pressed* setters fire from
    // the merged options bag. The underlying `CSSStyleRule` itself stays
    // unmaterialised until `pressedStyleRule.ensure()` runs.
    private _pressedStyleRule?: StyleRule;
    private get pressedStyleRule(): StyleRule {
        return this._pressedStyleRule ??= new StyleRule(() => CSS.createComponentRule(this.getId() + ":active") as CSSStyleRule);
    }
    private pressedBorder: Border | null = null;

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
        // Normalise the overload: a non-string first argument is the options bag.
        let text: string | undefined;
        if (typeof textOrOptions === "string") {
            text = textOrOptions;
        } else if (textOrOptions !== undefined) {
            options = textOrOptions;
        }

        // Validate before `super` because the cascade dispatches setters with
        // side effects.
        const hasText  = text !== undefined || options?.text !== undefined;
        const hasGlyph = options?.glyph !== undefined && options.glyph !== null;
        if (!hasText && !hasGlyph) {
            throw new Error("Button must be given a `text` label or a `glyph` option (or both).");
        }

        // Merge defaults → consumer options → non-overridable structural keys.
        // The cascade in `super` dispatches every cascade-safe setter once with
        // the final value, including pressed* (the StyleRule getter is lazy)
        // and inherited Component fields. Children-touching options (text,
        // glyph) are written pure to `_options` by the leaf `applyOptions` and
        // dispatched from the constructor body below once children exist.
        super({
            ..._defaultButtonOptions,
            ...(options ?? {}),
            tag: "button",
        } as TOptions);

        // Structural state — can't go through the bag because consumers must
        // not be able to override it.
        this.setLayoutManager(new Fit());

        // Build the text/glyph content row.
        this.text     = new Text();
        this._content = new Component();
        this._content.setLayoutManager(new HBox({ spacing: 2 }));
        this._content.setInsets(new Insets(0, 0, 0, 0));
        this._content.setPointerEvents("none");
        this._content.addComponent(this.text);

        this.text.setPointerEvents("none");
        this.text.setTextAlign("center");
        this.text.setFontWeight("bold");
        this.text.setFontSize("--ts-ui-button-font-size");

        this.addComponent(this._content, {
            fill: FillType.NONE,
            anchor: AnchorType.CENTER
        });

        // Late-built state: applyOptions wrote `text`/`glyph` into `_options`
        // pure (no setter dispatch) because `this.text`/`_content` didn't exist
        // yet. Dispatch them now that children are wired up.
        const effectiveText = this._options.text ?? text;
        if (effectiveText !== undefined) {
            this.text.setText(effectiveText);
        }
        if (this._options.glyph !== undefined) {
            this.setGlyph(this._options.glyph);
        }
    }

    /**
     * Applies a {@link ButtonOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; pressed-state and `enabled` fields cascade
     * through their own setters (the lazy `pressedStyleRule` getter makes them
     * safe to fire during the super-time cascade). `text` and `glyph` are
     * written pure into `_options` here and dispatched from the constructor
     * body once children exist.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.text                   !== undefined) this._options.text  = options.text;
        if (options.glyph                  !== undefined) this._options.glyph = options.glyph;

        if (options.enabled                !== undefined) this.setEnabled(options.enabled);
        if (options.pressedForegroundColor !== undefined) this.setPressedForegroundColor(options.pressedForegroundColor);
        if (options.pressedBackgroundColor !== undefined) this.setPressedBackgroundColor(options.pressedBackgroundColor);
        if (options.pressedBackgroundImage !== undefined) this.setPressedBackgroundImage(options.pressedBackgroundImage);
        if (options.pressedShadow          !== undefined) this.setPressedShadow(options.pressedShadow);
        if (options.pressedBorder          !== undefined) this.setPressedBorder(options.pressedBorder);
        if (options.pressedBorderRadius    !== undefined) this.setPressedBorderRadius(options.pressedBorderRadius);

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
    getPressedBackgroundColor(): string | null {
        return this._options.pressedBackgroundColor ?? null;
    }

    /**
     * Sets the background color for the :active CSS rule.
     *
     * @param backgroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBackgroundColor(backgroundColor: string): this {
        this._options.pressedBackgroundColor = backgroundColor;
        this.pressedStyleRule.set("backgroundColor", backgroundColor);

        return this;
    }

    /**
     * Removes the background-color from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBackgroundColor(): this {
        this._options.pressedBackgroundColor = undefined;
        this.pressedStyleRule.set("backgroundColor", null);

        return this;
    }

    /**
     * Returns the background image applied when the button is in the :active state.
     *
     * @returns The CSS background-image string, or null if not set.
     */
    getPressedBackgroundImage(): string | null {
        return this._options.pressedBackgroundImage ?? null;
    }

    /**
     * Sets the background image for the :active CSS rule.
     *
     * @param backgroundImage - Optional. A CSS background-image string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBackgroundImage(backgroundImage: string): this {
        this._options.pressedBackgroundImage = backgroundImage;
        this.pressedStyleRule.set("backgroundImage", backgroundImage);

        return this;
    }

    /**
     * Removes the background-image from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBackgroundImage(): this {
        this._options.pressedBackgroundImage = undefined;
        this.pressedStyleRule.set("backgroundImage", null);

        return this;
    }

    /**
     * Returns the text color applied when the button is in the :active state.
     *
     * @returns The CSS color string, or null if not set.
     */
    getPressedForegroundColor(): string | null {
        return this._options.pressedForegroundColor ?? null;
    }

    /**
     * Sets the text color for the :active CSS rule.
     *
     * @param foregroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedForegroundColor(foregroundColor: string): this {
        this._options.pressedForegroundColor = foregroundColor;
        this.pressedStyleRule.set("color", foregroundColor);

        return this;
    }

    /**
     * Removes the color (foreground) from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedForegroundColor(): this {
        this._options.pressedForegroundColor = undefined;
        this.pressedStyleRule.set("color", null);

        return this;
    }

    /**
     * Returns the border applied when the button is in the :active state.
     *
     * @returns The Border instance for the :active state, or null if not set.
     */
    getPressedBorder(): Border | null {
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
        this.pressedBorder.applyOnCSSRule(this.pressedStyleRule.ensure());

        return this;
    }

    /**
     * Returns the border radius applied when the button is in the :active state.
     *
     * @returns The CSS border-radius string, or null if not set.
     */
    getPressedBorderRadius(): string | null {
        return this._options.pressedBorderRadius ?? null;
    }

    /**
     * Sets the border radius for the :active CSS rule.
     *
     * @param borderRadius - Optional. A CSS border-radius string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBorderRadius(borderRadius: string): this {
        this._options.pressedBorderRadius = borderRadius;
        this.pressedStyleRule.set("borderRadius", borderRadius);

        return this;
    }

    /**
     * Removes the border-radius from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBorderRadius(): this {
        this._options.pressedBorderRadius = undefined;
        this.pressedStyleRule.set("borderRadius", null);

        return this;
    }

    /**
     * Returns the box shadow applied when the button is in the :active state.
     *
     * @returns The CSS box-shadow string, or null if not set.
     */
    getPressedShadow(): string | null {
        return this._options.pressedShadow ?? null;
    }

    /**
     * Sets the box shadow for the :active CSS rule.
     *
     * @param shadow - A CSS box-shadow string, or null to set the shadow to "none".
     *
     * @returns This component, for method chaining.
     */
    setPressedShadow(shadow: string): this {
        this._options.pressedShadow = shadow;
        this.pressedStyleRule.set("boxShadow", shadow);

        return this;
    }

    /**
     * Removes the box-shadow from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedShadow(): this {
        this._options.pressedShadow = undefined;
        this.pressedStyleRule.set("boxShadow", null);

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
        if ((this._options.enabled ?? true) === enabled) {
            return this;
        }

        this._options.enabled = enabled;

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
        return this._options.enabled ?? true;
    }
}

const ButtonCallable = callable(Button);
type ButtonCallable<TOptions extends ButtonOptions = ButtonOptions> = Button<TOptions>;
export {
    Button         as _Button,
    ButtonCallable as Button
};
