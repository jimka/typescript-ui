import { Event } from "../Event.js";
import { ComboBox } from "./ComboBox.js";

export class List extends ComboBox {

    constructor() {
        super();

        this.setPreferredSize(200, 200);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this.setOverflow("auto");
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "change", listener);
    }

    setItems(items: String | Array<String>) {
        super.setItems(items);

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.size = this.getItems().length + 1;
    }

    addItem(item: String) {
        super.addItem(item);

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.size = this.getItems().length + 1;
    }

    render() {
        let element = <HTMLSelectElement>super.render();

        element.size = this.getItems().length + 1;

        return element;
    }
}
