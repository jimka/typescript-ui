import { Component } from "../../../../Component.js";
import { Fit } from "../../../../layout/Fit.js";
import { Insets } from "../../../../Insets.js";

export abstract class CellEditor<T> extends Component {

    constructor() {
        super();

        this.setLayoutManager(new Fit());
        this.setInsets(new Insets(0, 0, 0, 0));
    }

    abstract getValue(): T;
    abstract setValue(t: T): void;
}