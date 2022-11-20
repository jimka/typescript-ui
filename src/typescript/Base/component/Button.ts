import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { Fit } from "../layout/Fit.js";
import { Label } from "./Label.js";
import { FillType } from "../layout/FillType.js";
import { BorderStyle } from "../BorderStyle.js";
import { AnchorType } from "../layout/AnchorType.js";
import { CSS } from "../CSS.js";
import { Border } from "../Border.js";

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

        this.addComponent(this.label, {
            fill: FillType.NONE,
            anchor: AnchorType.CENTER
        });

        this.setCursor("pointer");
        this.setBorder(
            BorderStyle.RIDGE, 2, "rgb(200, 200, 200)"
        );
        this.setBorderRadius("4px");
        this.setShadow("1px 2px 5px 0 rgba(0, 0, 0, 0.2)");
        this.setBackgroundImage("linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))");

        this.setPressedForegroundColor("rgb(150, 150, 150)");
        this.setPressedBackgroundColor("rgb(200, 200, 200)");
        this.setPressedBackgroundImage("linear-gradient(rgb(200, 200, 200), rgb(200, 200, 200))");
        this.setPressedShadow("1px 2px 5px 0 rgba(0, 0, 0, 0.2) inset");
    }

    getLabel() {
        return this.label;
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "click", listener);
    }

    getPressedBackgroundColor() {
        return this.pressedBackgroundColor;
    }

    setPressedBackgroundColor(backgroundColor: string | null) {
        this.pressedBackgroundColor = backgroundColor;
        this.pressedCSSRule.style.backgroundColor = this.pressedBackgroundColor ? this.pressedBackgroundColor : "";
    }

    getPressedBackgroundImage() {
        return this.pressedBackgroundImage;
    }

    setPressedBackgroundImage(backgroundImage: string | null = null) {
        this.pressedBackgroundImage = backgroundImage;
        this.pressedCSSRule.style.backgroundImage = this.pressedBackgroundImage ? this.pressedBackgroundImage : "";
    }

    getPressedForegroundColor() {
        return this.pressedForegroundColor;
    }

    setPressedForegroundColor(foregroundColor: string | null) {
        this.pressedForegroundColor = foregroundColor;
        this.pressedCSSRule.style.color = this.pressedForegroundColor ? this.pressedForegroundColor : "";
    }

    getPressedBorder() {
        return this.pressedBorder;
    }

    // TODO: Fix this mess and make it easier to call.
    setPressedBorder(topBorderStyle?: BorderStyle, topWidth?: number, topColor?: string,
        rightBorderStyle?: BorderStyle, rightWidth?: number, rightColor?: string,
        bottomBorderStyle?: BorderStyle, bottomWidth?: number, bottomColor?: string,
        leftBorderStyle?: BorderStyle, leftWidth?: number, leftColor?: string) {

        this.pressedBorder = new Border(topBorderStyle, topWidth, topColor,
            rightBorderStyle, rightWidth, rightColor,
            bottomBorderStyle, bottomWidth, bottomColor,
            leftBorderStyle, leftWidth, leftColor
        );

        if (this.pressedBorder) {
            this.pressedBorder.applyOnCSSRule(this.pressedCSSRule);
        } else {
            this.pressedCSSRule.style.removeProperty("border");
        }
    }

    getPressedBorderRadius() {
        return this.pressedBorderRadius;
    }

    setBorderRadius(borderRadius: string | null = null) {
        this.pressedBorderRadius = borderRadius;
        this.pressedCSSRule.style.borderRadius = this.pressedBorderRadius ? this.pressedBorderRadius : "none";
    }

    getPressedShadow() {
        return this.pressedShadow;
    }

    setPressedShadow(shadow: string | null) {
        this.pressedShadow = shadow;
        this.pressedCSSRule.style.boxShadow = this.pressedShadow ? this.pressedShadow : "none";
    }
}
