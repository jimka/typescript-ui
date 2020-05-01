import { BorderStyle } from "./BorderStyle.js";

export class BorderLine extends Object {

    private placement: string;
    private borderStyle: BorderStyle;
    private width: number;
    private color: string;

    constructor(placement: string, borderStyle?: BorderStyle, width?: number, color?: string) {
        super();

        this.placement = placement;
        this.borderStyle = borderStyle ? borderStyle : BorderStyle.NONE;
        this.width = width ? width : 0;
        this.color = color ? color : "black";
    }

    getPlacement() {
        return this.placement;
    }

    getStyle() {
        return this.borderStyle;
    }

    getStyleString() {
        return BorderStyle[this.getStyle()].toLowerCase();
    }

    getWidth() {
        return this.width;
    }

    getColor() {
        return this.color;
    }

    set(borderStyle: BorderStyle, width: number, color: string) {
        this.borderStyle = borderStyle;
        this.width = width;
        this.color = color;
    }

    render() {
        return this.getWidth() + "px " + this.getStyleString() + " " + this.getColor();
    }

    applyOnCSSRule(rule: CSSStyleRule) {
        rule.style.setProperty(this.placement.valueOf() + "-width", this.getWidth() + "px");
        rule.style.setProperty(this.placement.valueOf() + "-style", this.getStyleString());
        rule.style.setProperty(this.placement.valueOf() + "-color", this.getColor());
    }
};