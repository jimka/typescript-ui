// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";

/**
 * An image component backed by an `<img>` element.
 *
 * Reports its preferred size from the image's natural intrinsic dimensions once loaded.
 */
export class Image extends Component {

    private src: String;

    constructor(src: String) {
        super("img");

        this.src = src;
        this.setInsets(null);
        this.setMinSize(20, 20);
    }

    /**
     * Returns the DOM element cast to HTMLImageElement.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's HTMLImageElement.
     */
    getElement(createIfMissing: boolean = false) {
        return <HTMLImageElement>super.getElement(createIfMissing);
    }

    /**
     * Returns the natural intrinsic size of the image from the DOM element.
     *
     * @returns A Size with the image's naturalWidth and naturalHeight.
     */
    getPreferredSize() {
        let element = this.getElement();

        return {
            width: element.naturalWidth,
            height: element.naturalHeight
        };
    }

    /**
     * Renders the img element and sets its src attribute.
     *
     * @returns The created HTMLImageElement with its src initialised.
     */
    render() {
        let element = <HTMLImageElement>super.render();

        element.src = this.src.valueOf();

        return element;
    }
}