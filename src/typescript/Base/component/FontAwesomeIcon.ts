import { Component } from "../Component.js";
// import "../script/fontawesome/js/all.js"; -- For now, we require this import to be made in the index-page.

export class FontAwesomeIcon extends Component {

    private type: string;
    private icon: string;

    constructor(type: string, icon: string) {
        super("i");

        this.type = type;
        this.icon = icon;
        this.setPreferredSize(16, 16);
    }

    render() {
        let element = super.render();

        element.classList.add(this.type);
        element.classList.add("fa-" + this.icon);

        return element;
    }
}