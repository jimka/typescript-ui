import { BorderLine } from "./BorderLine.js";
import { BorderStyle } from "./BorderStyle.js";

export class Border extends Object {

    private top: BorderLine;
    private right: BorderLine;
    private bottom: BorderLine;
    private left: BorderLine;

    constructor(topBorderStyle?: BorderStyle, topWidth?: number, topColor?: string,
                rightBorderStyle?: BorderStyle, rightWidth?: number, rightColor?: string,
                bottomBorderStyle?: BorderStyle, bottomWidth?: number, bottomColor?: string,
                leftBorderStyle?: BorderStyle, leftWidth?: number, leftColor?: string) {
        super();

        if (topBorderStyle && (!rightBorderStyle && !bottomBorderStyle && !leftBorderStyle)) {
            rightBorderStyle = topBorderStyle;
            rightWidth = topWidth;
            rightColor = topColor;

            bottomBorderStyle = topBorderStyle;
            bottomWidth = topWidth;
            bottomColor = topColor;

            leftBorderStyle = topBorderStyle;
            leftWidth = topWidth;
            leftColor = topColor;
        }

        if (topBorderStyle && rightBorderStyle && (!bottomBorderStyle && !leftBorderStyle)) {
            bottomBorderStyle = topBorderStyle;
            bottomWidth = topWidth;
            bottomColor = topColor;

            leftBorderStyle = rightBorderStyle;
            leftWidth = rightWidth;
            leftColor = rightColor;
        }

        this.top = new BorderLine("border-top", topBorderStyle, topWidth, topColor);
        this.right = new BorderLine("border-right", rightBorderStyle as BorderStyle, rightWidth as number, rightColor as string);
        this.bottom = new BorderLine("border-bottom", bottomBorderStyle as BorderStyle, bottomWidth as number, bottomColor as string);
        this.left = new BorderLine("border-left", leftBorderStyle as BorderStyle, leftWidth as number, leftColor as string);
    }

    getTop() {
        return this.top;
    }

    getRight() {
        return this.right;
    }

    getBottom() {
        return this.bottom;
    }

    getLeft() {
        return this.left;
    }

    set(borderStyle: BorderStyle, width: number, color: string) {
        this.top.set(borderStyle, width, color);
        this.right.set(borderStyle, width, color);
        this.bottom.set(borderStyle, width, color);
        this.left.set(borderStyle, width, color);
    }

    applyOnCSSRule(rule: CSSStyleRule) {
        this.top.applyOnCSSRule(rule);
        this.right.applyOnCSSRule(rule);
        this.bottom.applyOnCSSRule(rule);
        this.left.applyOnCSSRule(rule);
    }
}