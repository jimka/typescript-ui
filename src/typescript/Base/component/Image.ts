import { Component } from "../Component.js";

export class Image extends Component {

    private src: String;

    constructor(src: String) {
        super("img");

        this.src = src;
        this.setInsets(null);
        this.setMinSize(20, 20);
    }

    getElement(createIfMissing: boolean = false) {
        return <HTMLImageElement>super.getElement(createIfMissing);
    }

    getPreferredSize() {
        let element = this.getElement();

        return {
            width: element.naturalWidth,
            height: element.naturalHeight
        };
    }

    render() {
        let element = <HTMLImageElement>super.render();

        element.src = this.src.valueOf();

        return element;
    }
}