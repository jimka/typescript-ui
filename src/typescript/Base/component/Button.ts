import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { Fit } from "../layout/Fit.js";
import { Label } from "./Label.js";
import { FillType } from "../layout/FillType.js";
import { BorderStyle } from "../BorderStyle.js";
import { AnchorType } from "../layout/AnchorType.js";

export class Button extends Component {

    private label: Label;

    constructor(text?: String) {
        super("button");

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
        this.setBorder(BorderStyle.SOLID, 0, "black");
        this.setShadow("1px 2px 5px 0 rgba(0, 0, 0, 0.2)");

        // height: 32px;
        // padding-left: 24px;
        // background: url(http://placehold.it/16x16) no-repeat 5px center;
        // background-size: 16px 16px;
        // cursor: pointer;
        // border-radius: 4px;
    }

    getLabel() {
        return this.label;
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "click", listener);
    }
}