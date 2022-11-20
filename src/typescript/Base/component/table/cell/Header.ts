import { DefaultCell } from "./Default.js";

export class HeaderCell extends DefaultCell {

    constructor(text: String) {
        super("th");

        let renderer = this.getRenderer();
        renderer.getLabel().setFontSize(13);
        renderer.getLabel().setFontWeight("bold");
        renderer.getLabel().setText(text);
    }
}