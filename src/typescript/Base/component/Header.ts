import { Component } from "../Component.js";
import { Border as BorderLayout } from "../layout/Border.js";
import { Label } from "./Label.js";
import { Insets } from "../Insets.js";
import { AnchorType } from "../layout/AnchorType.js";
import { FillType } from "../layout/FillType.js";
import { Placement } from "../Placement.js";

export class Header extends Component {

    private label: Label;

    constructor(text: string) {
        super("header");

        this.setPreferredSize(100, 20);
        this.setInsets(new Insets(0, 0, 0, 0));
        this.setBackgroundColor("#eee");

        this.setLayoutManager(new BorderLayout());

        this.label = new Label(text);
        let labelInsets = this.label.getInsets();
        if (labelInsets == null) {
            labelInsets = new Insets(0, 0, 0, 20);
        } else {
            labelInsets.setLeft(20);
        }
        this.label.setInsets(labelInsets);

        this.label.setFontWeight("bold");
        this.label.setFontSize(12);
        this.label.setPointerEvents("none");

        this.addComponent(this.label, {
            placement: Placement.WEST,
            anchor: AnchorType.WEST,
            fill: FillType.HORIZONTAL
        });
    }

    getLabel() {
        return this.label;
    }
}