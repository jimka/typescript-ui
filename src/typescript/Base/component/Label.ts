import { Component } from "../Component.js";
import { Fit } from "../layout/Fit.js";
import { Text } from "./Text.js";
import { AnchorType } from "../layout/AnchorType.js";

export class Label extends Component {

    private textComponent: Text;

    constructor(text?: String) {
        super();

        this.setLayoutManager(new Fit());
        this.textComponent = new Text("span", text);
        this.addComponent(this.textComponent, {
            //fill: FillType.NONE,
            anchor: AnchorType.CENTER
        });

        this.setInsets(null);
        this.textComponent.setPointerEvents("none");
    }

    getSize() {
        return this.getPreferredSize();
    }

    getPreferredSize() {
        let ps = super.getPreferredSize();
        if (ps) {
            return ps;
        }

        let size = this.textComponent.getSize();
        if (!size) {
            return null;
        }

        let insets = this.getInsets();
        let borderSize = this.getBorderSize();

        size.width = size.width + (insets ? (insets.getLeft() + insets.getRight()) : 0) + (borderSize ? (borderSize.left + borderSize.right) : 0);
        size.height = size.height + (insets ? (insets.getTop() + insets.getBottom()) : 0) + (borderSize ? (borderSize.top + borderSize.bottom) : 0);

        return size;
    }

    getMinSize() {
        return this.getPreferredSize();
    }

    getText() {
        return this.textComponent.getText();
    }

    setText(value: String) {
        this.textComponent.setText(value);
    }

    getTextAlign() {
        return this.textComponent.getTextAlign();
    }

    setTextAlign(value: string) {
        this.textComponent.setTextAlign(value);
    }

    getTextShadow() {
        return this.textComponent.getTextShadow();
    }

    setTextShadow(value: string) {
        this.textComponent.setTextShadow(value);
    }

    getFontFamily() {
        return this.textComponent.getFontFamily();
    }

    setFontFamily(value: string) {
        this.textComponent.setFontFamily(value);
    }

    getFontKerning() {
        return this.textComponent.getFontKerning();
    }

    setFontKerning(value: string) {
        this.textComponent.setFontKerning(value);
    }

    getFontSize() {
        return this.textComponent.getFontSize();
    }

    setFontSize(value: number) {
        this.textComponent.setFontSize(value);
    }

    getFontSizeAdjust() {
        return this.textComponent.getFontSizeAdjust();
    }

    setFontSizeAdjust(value: string) {
        this.textComponent.setFontSizeAdjust(value);
    }

    getFontStretch() {
        return this.textComponent.getFontStretch();
    }

    setFontStretch(value: string) {
        this.textComponent.setFontStretch(value);
    }

    getFontStyle() {
        return this.textComponent.getFontStyle();
    }

    setFontStyle(value: string) {
        this.textComponent.setFontStyle(value);
    }

    getFontVariant() {
        return this.textComponent.getFontVariant();
    }

    setFontVariant(value: string) {
        this.textComponent.setFontVariant(value);
    }

    getFontWeight() {
        return this.textComponent.getFontWeight();
    }

    setFontWeight(value: string) {
        this.textComponent.setFontWeight(value);
    }

    getLineHeight() {
        return this.textComponent.getLineHeight();
    }

    setLineHeight(value: number) {
        this.textComponent.setLineHeight(value);
    }

    select(start: number, end: number) {
        this.textComponent.select(start, end);
    }
}