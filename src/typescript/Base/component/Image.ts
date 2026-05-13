// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "../Component.js";
import { Size } from "../Size.js";
import { callable } from "../Callable.js";

/**
 * Construction-time options for {@link Image}.
 *
 * @remarks Supplying `preferredSize` locks the rendered size and disables the
 * default natural-dimension auto-fit behaviour.
 *
 * @category Components
 */
export interface ImageOptions extends ComponentOptions {
}

/**
 * An image component backed by an `<img>` element.
 *
 * Reports its preferred size from the image's natural intrinsic dimensions once loaded.
 *
 * @category Components
 */
class Image extends Component {

    private src: String;

    constructor(src: String, options?: ImageOptions) {
        super({ tag: "img" });

        this.src = src;
        this.setInsets(null);
        this.setMinSize(20, 20);

        if (options) {
            this.applyOptions(options);
        }
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
    getPreferredSize(): Size | null {
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

const ImageCallable = callable(Image);
type ImageCallable = Image;
export {
    Image         as _Image,
    ImageCallable as Image
};
