import { Header } from "./Header.js";
import { Button } from "./Button.js";
import { FontAwesomeIcon } from "./FontAwesomeIcon.js";
import { FillType } from "../layout/FillType.js";
import { Placement } from "../Placement.js";

export class WindowHeader extends Header {

    private exitButton: Button;

    constructor(text: string) {
        super(text);

        this.exitButton = new Button();
        this.exitButton.removeAllComponents();

        let fontAwesomeIcon = new FontAwesomeIcon("fas", "times");
        fontAwesomeIcon.setPointerEvents("none");
        this.exitButton.addComponent(fontAwesomeIcon, {
            fill: FillType.NONE
        });

        this.addComponent(this.exitButton, { placement: Placement.EAST });
    }

    addExitButtonListener(listener: Function) {
        this.exitButton.addActionListener(listener);
    }
}