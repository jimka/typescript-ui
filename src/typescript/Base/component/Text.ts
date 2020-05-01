import { Component } from "../Component.js";
import { Body } from "../Body.js";

export class Text extends Component {

    private text: String | null | undefined = null;
    private textAlign: string | null = null;
    private textShadow: string | null = null;
    private fontFamily: string | null = null;
    private fontKerning: string | null = null;
    private fontSize: number | null = null;
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
        this.fontFamily = "sans-serif";
        this.fontKerning = "auto";
        this.fontSize = 12;
        this.fontSizeAdjust = "none";
        this.fontStretch = "normal";
        this.fontStyle = "normal";
        this.fontVariant = "normal";
        this.fontWeight = "normal";
        this.setInsets(null);

        this.calculateSize();
    }

    getElement(createIfMissing: boolean = false): HTMLInputElement {
        return <HTMLInputElement>super.getElement(createIfMissing);
    }

    private calculateSize() {
        if (this.text) {
            let canvas = Body.getInstance().getCanvas();
            canvas.font = this.fontWeight + " " + this.getFontSize() + "px " + this.getFontFamily();
            canvas.fillStyle = this.getForegroundColor() || "black";

            let textSize = canvas.measureText(this.text ? this.text.toString() : "");

            let width = textSize.width;
            let height = (this.fontSize || 0) + textSize.actualBoundingBoxDescent;

            this.setPreferredSize(width, height);
        } else {
            this.setPreferredSize(0, 0);
        }
    }

    getText() {
        return this.text || "";
    }

    setText(text: String) {
        this.text = text || "";

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.textContent = text.valueOf();

        this.calculateSize();
    }

    getTextAlign() {
        return this.textAlign;
    }

    setTextAlign(align: string) {
        this.textAlign = align;

        this.setElementCSSRule("textAlign", align);
    }

    getTextShadow() {
        return this.textShadow;
    }

    setTextShadow(shadow: string) {
        this.textShadow = shadow;

        this.setElementCSSRule("textShadow", shadow);
    }

    getFontFamily() {
        return this.fontFamily;
    }

    setFontFamily(value: string) {
        this.fontFamily = value;

        this.setElementCSSRule("fontFamily", value);

        this.calculateSize();
    }

    getFontKerning() {
        return this.fontKerning;
    }

    setFontKerning(value: string) {
        this.fontKerning = value;

        this.setElementCSSRule("fontKerning", value);
    }

    getFontSize() {
        return this.fontSize;
    }

    setFontSize(value: number) {
        this.fontSize = value;

        this.setElementCSSRule("fontSize", value);

        this.calculateSize();
    }

    getFontSizeAdjust() {
        return this.fontSizeAdjust;
    }

    setFontSizeAdjust(value: string) {
        this.fontSizeAdjust = value;

        this.setElementCSSRule("fontSizeAdjust", value);
    }

    getFontStretch() {
        return this.fontStretch;
    }

    setFontStretch(value: string) {
        this.fontStretch = value;

        this.setElementCSSRule("fontStretch", value);
    }

    getFontStyle() {
        return this.fontStyle;
    }

    setFontStyle(value: string) {
        this.fontStyle = value;

        this.setElementCSSRule("fontStyle", value);
    }

    getFontVariant() {
        return this.fontVariant;
    }

    setFontVariant(value: string) {
        this.fontVariant = value;

        this.setElementCSSRule("fontVariant", value);
    }

    getFontWeight() {
        return this.fontWeight;
    }

    setFontWeight(value: string) {
        this.fontWeight = value;

        this.setElementCSSRule("fontWeight", value);

        this.calculateSize();
    }

    getLineHeight() {
        return this.lineHeight;
    }

    setLineHeight(value: number) {
        this.lineHeight = value;

        this.setElementCSSRule("lineHeight", value);
    }

    select(start?: number, end?: number) {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM, unable to select.");
            return;
        }

        if (!start || start < 0) {
            start = 0;
        }

        let text = this.getText();
        if (!end || end > text.length) {
            end = text.length + 1;
        }

        element.setSelectionRange(start, end);
    }

    applyStyle(element: HTMLElement) {
        super.applyStyle(element);

        let rule = this.getCSSRule();

        rule.style.fontFamily = this.fontFamily ? this.fontFamily : "";
        rule.style.textAlign = this.textAlign ? this.textAlign : "";
        rule.style.textShadow = this.textShadow ? this.textShadow : "";
        rule.style.kerning = this.fontKerning ? this.fontKerning : "";
        rule.style.fontSize = this.fontSize ? String(this.fontSize) : "";
        rule.style.fontSizeAdjust = this.fontSizeAdjust ? this.fontSizeAdjust : "";
        rule.style.fontStretch = this.fontStretch ? this.fontStretch : "";
        rule.style.fontStyle = this.fontStyle ? this.fontStyle : "";
        rule.style.fontVariant = this.fontVariant ? this.fontVariant : "";
        rule.style.fontWeight = this.fontWeight ? this.fontWeight : "";
    }

    render() {
        let element = super.render();

        element.textContent = this.getText().valueOf();

        return element;
    }
}