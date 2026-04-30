// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
// import "../script/fontawesome/js/all.js"; -- For now, we require this import to be made in the index-page.

/**
 * A Font Awesome icon component rendered as an `<i>` element.
 *
 * Applies the given icon type prefix (e.g. "fas") and icon name (e.g. "times") as CSS classes
 * so that the Font Awesome library can resolve the correct glyph.
 *
 * @remarks The Font Awesome script must be included separately in the host page.
 */
export class FontAwesomeIcon extends Component {

    private type: string;
    private icon: string;

    constructor(type: string, icon: string) {
        super("i");

        this.type = type;
        this.icon = icon;
        this.setPreferredSize(16, 16);
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