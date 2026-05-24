// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

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

// Upper bound for the auto-derived `minSize` per axis. Small images report
// their intrinsic size (so a 16×16 favicon stays sharp at full natural size);
// larger images cap here so their parent layout can always shrink them down.
const IMAGE_AUTO_MIN_CAP_PX = 100;

/**
 * An image component backed by an `<img>` element.
 *
 * Reports its preferred size from the image's natural intrinsic dimensions once loaded.
 *
 * @category Components
 */
class Image extends Component {

    private _src: String;

    constructor(src: String, options?: ImageOptions) {
        super({ tag: "img" });

        this._src = src;
        this.clearInsets();

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
     * Returns a minimum size derived from the image's intrinsic dimensions
     * (mirrors the `Math.min(natural, 100)` cap that `Text` applies), so
     * small images keep their full size while large images stay shrinkable
     * by their parent layout. An explicit `setMinSize` from the caller
     * wins via `Component.getMinSize`'s `_options.minSize` priority.
     *
     * @returns The minimum `{width, height}` from intrinsic dims, or a
     *   `20×20` pre-load fallback before the image has decoded.
     */
    getMinSize(): Size | null {
        const explicit = super.getMinSize();
        if (this._options.minSize) {
            return explicit;
        }

        const element = this.getElement();
        if (!element || !element.naturalWidth) {
            return { width: 20, height: 20 };
        }

        return {
            width:  Math.min(element.naturalWidth,  IMAGE_AUTO_MIN_CAP_PX),
            height: Math.min(element.naturalHeight, IMAGE_AUTO_MIN_CAP_PX),
        };
    }

    /**
     * Renders the img element and sets its src attribute.
     *
     * @returns The created HTMLImageElement with its src initialised.
     */
    render() {
        let element = <HTMLImageElement>super.render();

        element.src = this._src.valueOf();

        return element;
    }
}

const ImageCallable = callable(Image);
type ImageCallable = Image;
export {
    Image         as _Image,
    ImageCallable as Image
};
