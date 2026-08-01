// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Row } from "~/component/table/Row.js";
import { callable } from "~/core/Callable.js";

/**
 * The footer section of a table, rendered as a `<tfoot>` element.
 *
 * Contains a single {@link Row} and delegates width/height changes to it.
 *
 * Re-exported as `TableFooter` from the package barrel.
 *
 * @category Components
 */
class FooterRow extends Component {

    constructor() {
        super({ tag: "tfoot" });

        this.setBorder({ borderTop: "1px solid var(--ts-ui-border-color, black)" });
        // Apply the surface as both a colour and an image so a flat-colour
        // theme (e.g. ModernTheme, where --ts-ui-button-bg is a solid colour)
        // paints via the colour and a gradient theme via the image. Setting
        // only background-image left the footer transparent under a flat-colour
        // theme, since a colour is invalid as a background-image.
        const footerBg = "var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))";
        this.setBackgroundColor(footerBg);
        this.setBackgroundImage(footerBg);

        let row = new Row();
        this.addRow(row);
    }

    /**
     * Returns the footer cell components in column order.
     *
     * @returns An array of cell components from the footer's inner row.
     */
    getColumns() {
        return this.getComponents()[0].getComponents();
    }

    /**
     * Appends a row to the footer.
     *
     * @param row - The row to append.
     */
    addRow(row: Row) : this {
        this.addComponent(row);

        return this;
    }

    /**
     * Adds a row as a child component of the footer.
     *
     * @param row - The row component to add.
     *
     * @returns This component, for method chaining.
     */
    addComponent(row: Row): this {
        super.addComponent(row);

        return this;
    }

    /**
     * Sets the footer width and propagates it to the inner row.
     *
     * @param width - The width in pixels.
     *
     * @returns This component, for method chaining.
     */
    setWidth(width: number): this {
        super.setWidth(width);

        // The row is a child, so it already starts inside the footer's border;
        // handing it the outer width would push it that far past the far edge.
        // Before the element exists there is no border to subtract, so the
        // argument is the whole box.
        this.getComponents()[0].setWidth(this.getContentBounds()?.width ?? width);

        return this;
    }

    /**
     * Sets the footer height and propagates it to the inner row.
     *
     * @param height - The height in pixels.
     *
     * @returns This component, for method chaining.
     */
    setHeight(height: number): this {
        super.setHeight(height);

        // The footer gives itself a 1px top border in its constructor, so the
        // row was a pixel taller than the band's content box and its bottom
        // pixel fell under `overflow: hidden`. Nothing displays a footer today
        // — there is no footer-visibility setter — so this corrects the
        // arithmetic rather than any rendered pixel.
        this.getComponents()[0].setHeight(this.getContentBounds()?.height ?? height);

        return this;
    }
}

const FooterRowCallable = callable(FooterRow);
type FooterRowCallable = FooterRow;
export {
    FooterRow         as _FooterRow,
    FooterRowCallable as FooterRow
};
