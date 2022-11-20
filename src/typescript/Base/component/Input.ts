import { Component } from "../Component.js";

export class Input extends Component {

    constructor() {
        super("input");

        this.setBackgroundColor("rgb(255, 255, 255)");
    }

    getElement(createIfMissing: boolean = false) {
        return <HTMLInputElement>super.getElement(createIfMissing);
    }
}