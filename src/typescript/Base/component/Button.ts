// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { Fit } from "../layout/Fit.js";
import { Label } from "./Label.js";
import { FillType } from "../layout/FillType.js";
import { BorderStyle } from "../BorderStyle.js";
import { AnchorType } from "../layout/AnchorType.js";
import { CSS } from "../CSS.js";
import { Border, BorderOptions } from "../Border.js";

/**
 * A push button component with a text label and configurable pressed-state appearance.
 *
 * Maintains separate CSS rules for the normal and :active states, allowing
 * independent control of border, shadow, background, and foreground color when pressed.
 */
export class Button extends Component {

    private label: Label;

    private pressedCSSRule: CSSStyleRule;

    private pressedBorder: Border | null = null;
    private pressedBorderRadius: string | null = null;
    private pressedShadow: string | null = null;
    private pressedForegroundColor: string | null = null;
    private pressedBackgroundColor: string | null = null;
    private pressedBackgroundImage: string | null = null;

    constructor(text?: string) {
        super("button");

        this.pressedCSSRule = CSS.createComponentRule(this.getId() + ":active") as CSSStyleRule;

        this.setLayoutManager(new Fit());
        this.label = new Label(text);

        this.label.setPointerEvents("none");

        this.label.setTextAlign("center");
        this.label.setFontWeight("bold");
        this.label.setFontSize("--ts-ui-button-font-size");

        this.addComponent(this.label, {
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
    }

    /**
     * Returns the Label child component used to display the button text.
     *
     * @returns The internal Label instance.
     */
    getLabel() {
        return this.label;
    }

    /**
     * Registers a click event listener on this button.
     *
     * @param listener - The callback to invoke when the button is clicked.
     */
    addActionListener(listener: Function) {
        Event.addListener(this, "click", listener);
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
     */
    setPressedBackgroundColor(backgroundColor: string | null) {
        this.pressedBackgroundColor = backgroundColor;
        if (this.pressedBackgroundColor) {
            this.pressedCSSRule.style.setProperty('background-color', this.pressedBackgroundColor);
        } else {
            this.pressedCSSRule.style.removeProperty('background-color');
        }
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
     */
    setPressedBackgroundImage(backgroundImage: string | null = null) {
        this.pressedBackgroundImage = backgroundImage;
        if (this.pressedBackgroundImage) {
            this.pressedCSSRule.style.setProperty('background-image', this.pressedBackgroundImage);
        } else {
            this.pressedCSSRule.style.removeProperty('background-image');
        }
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
     */
    setPressedForegroundColor(foregroundColor: string | null) {
        this.pressedForegroundColor = foregroundColor;
        if (this.pressedForegroundColor) {
            this.pressedCSSRule.style.setProperty('color', this.pressedForegroundColor);
        } else {
            this.pressedCSSRule.style.removeProperty('color');
        }
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
     */
    setPressedBorder(options?: BorderOptions) {
        this.pressedBorder = new Border(options);

        if (this.pressedBorder) {
            this.pressedBorder.applyOnCSSRule(this.pressedCSSRule);
        } else {
            this.pressedCSSRule.style.removeProperty("border");
        }
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
     */
    setPressedBorderRadius(borderRadius: string | null = null) {
        this.pressedBorderRadius = borderRadius;
        if (this.pressedBorderRadius) {
            this.pressedCSSRule.style.setProperty('border-radius', this.pressedBorderRadius);
        } else {
            this.pressedCSSRule.style.removeProperty('border-radius');
        }
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
     */
    setPressedShadow(shadow: string | null) {
        this.pressedShadow = shadow;
        if (this.pressedShadow) {
            this.pressedCSSRule.style.setProperty('box-shadow', this.pressedShadow);
        } else {
            this.pressedCSSRule.style.removeProperty('box-shadow');
        }
    }
}
