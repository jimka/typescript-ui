import { Component } from "./Base/Component.js";
import { TextArea } from "./Base/component/TextArea.js";
import { Fit } from "./Base/layout/Fit.js";

export class FitPanel extends Component {

    constructor() {
        super();

        this.setLayoutManager(new Fit());

        let centerTextArea = new TextArea("Center textarea!");
        this.addComponent(centerTextArea);
    }
}