// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../../../Component.js";
import { Fit } from "../../../../layout/Fit.js";
import { Insets } from "../../../../Insets.js";

/**
 * Abstract base class for cell editors.
 *
 * Subclasses allow in-place editing of a typed value inside a table cell using a
 * Fit layout with zero insets.
 */
export abstract class CellEditor<T> extends Component {

    constructor() {
        super();

        this.setLayoutManager(new Fit());
        this.setInsets(new Insets(0, 0, 0, 0));
    }

    /**
     * Returns the current editor value.
     *
     * @returns The edited value of type T.
     */
    abstract getValue(): T;

    /**
     * Sets the editor to an initial value before editing begins.
     *
     * @param t - The value to populate the editor with.
     */
    abstract setValue(t: T): void;
}