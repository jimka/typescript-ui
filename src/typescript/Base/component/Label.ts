import { Text } from "./Text.js";

export class Label extends Text {

    forId: string;

    constructor(text? : string, forId : string = "") {
        super("label", text);

        this.forId = forId;
    }

    public getForId() : string {
        return this.forId;
    }

    public setForId(id : string) {
        this.forId = id;

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.textContent = id;
    }

    protected render() {
        let element = <HTMLLabelElement>super.render();

        element.htmlFor = this.forId;

        return element;
    }
}