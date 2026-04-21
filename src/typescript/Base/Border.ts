import { BorderLine } from "./BorderLine.js";
import { BorderStyle } from "./BorderStyle.js";

export interface BorderSideOptions {
    style?: BorderStyle;
    width?: number;
    color?: string;
}

export interface BorderOptions {
    style?: BorderStyle;
    width?: number;
    color?: string;
    top?: BorderSideOptions;
    right?: BorderSideOptions;
    bottom?: BorderSideOptions;
    left?: BorderSideOptions;
}

export class Border extends Object {

    private top: BorderLine;
    private right: BorderLine;
    private bottom: BorderLine;
    private left: BorderLine;

    constructor(options?: BorderOptions) {
        super();

        const fallback: BorderSideOptions = { style: options?.style, width: options?.width, color: options?.color };
        const top = options?.top ?? fallback;
        const right = options?.right ?? fallback;
        const bottom = options?.bottom ?? fallback;
        const left = options?.left ?? fallback;

        this.top = new BorderLine("border-top", top.style, top.width, top.color);
        this.right = new BorderLine("border-right", right.style as BorderStyle, right.width as number, right.color as string);
        this.bottom = new BorderLine("border-bottom", bottom.style as BorderStyle, bottom.width as number, bottom.color as string);
        this.left = new BorderLine("border-left", left.style as BorderStyle, left.width as number, left.color as string);
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