// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "../Component.js";
// import "../script/fontawesome/js/all.js"; -- For now, we require this import to be made in the index-page.

/**
 * Construction-time options for {@link FontAwesomeIcon}.
 *
 * @category Components
 */
export interface FontAwesomeIconOptions extends ComponentOptions {
    iconName?:  string;
    iconStyle?: string;
}

/**
 * A Font Awesome icon component rendered as an `<i>` element.
 *
 * Applies the given icon type prefix (e.g. "fas") and icon name (e.g. "times") as CSS classes
 * so that the Font Awesome library can resolve the correct glyph.
 *
 * @remarks The Font Awesome script must be included separately in the host page.
 *
 * @category Components
 */
export class FontAwesomeIcon extends Component {

    private type: string;
    private icon: string;

    constructor(type: string, icon: string, options?: FontAwesomeIconOptions) {
        super({ tag: "i" });

        this.type = type;
        this.icon = icon;
        this.setPreferredSize(16, 16);

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link FontAwesomeIconOptions} bag, dispatching icon name and
     * style class overrides after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: FontAwesomeIconOptions): this {
        super.applyOptions(options);

        const element = this.getElement();

        if (options.iconName !== undefined) {
            if (element) {
                element.classList.remove("fa-" + this.icon);
                element.classList.add("fa-" + options.iconName);
            }
            this.icon = options.iconName;
        }

        if (options.iconStyle !== undefined) {
            if (element) {
                element.classList.remove(this.type);
                element.classList.add(options.iconStyle);
            }
            this.type = options.iconStyle;
        }

        return this;
    }

    /**
     * Renders the icon element and adds the type and icon CSS classes.
     *
     * @returns The created `<i>` element with the Font Awesome classes applied.
     */
    render() {
        let element = super.render();

        element.classList.add(this.type);
        element.classList.add("fa-" + this.icon);

        return element;
    }
}