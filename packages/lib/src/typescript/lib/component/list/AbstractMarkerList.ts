// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Comparator, Component, ComponentOptions } from "~/core/Component.js";
import { Insets } from "~/primitive/Insets.js";
import { VBox } from "~/layout/VBox.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { BulletedListItemStyle } from "~/component/list/BulletedListItemStyle.js";
import { NumberedListItemStyle } from "~/component/list/NumberedListItemStyle.js";
import { ListItem } from "~/component/list/ListItem.js";

/**
 * Construction-time options for {@link AbstractMarkerList}.
 *
 * @category Components
 */
export interface AbstractMarkerListOptions<U extends BulletedListItemStyle | NumberedListItemStyle> extends ComponentOptions {
    itemStyle?:     U;
}

/**
 * Abstract base for bulleted and numbered list components.
 *
 * Owns each item's marker string — the bullet or number — and rewrites every
 * one whenever the children or the style change; the browser's own marker is
 * suppressed. Restricts child components to ListItem instances. Items are
 * stacked vertically by a [`VBox`](/api/layout/classes/VBox), and the list sizes
 * itself to them. Concrete subclasses supply the HTML tag, the default style,
 * and the marker string for a given position.
 */
export abstract class AbstractMarkerList<U extends BulletedListItemStyle | NumberedListItemStyle> extends Component<AbstractMarkerListOptions<U>> {

    // `declare` rather than initializer to dodge the class-field
    // super-cascade trap: the cascade-time setStyle write would otherwise
    // be clobbered by a `= undefined` initializer running after super().
    // The cascade always dispatches setStyle because the constructor seeds
    // `itemStyle: style` into the defaults bag below.
    declare private _style: U | undefined;

    constructor(
        tag:              string,
        style:            U,
        options?:         AbstractMarkerListOptions<U>,
        subclassDefaults?: Partial<AbstractMarkerListOptions<U>>,
    ) {
        super(options, {
            tag,
            // The left padding indents every item. The marker is drawn inside
            // the item's own box, not in this band — see ListItem.
            padding:       new Insets(0, 0, 0, 25),
            layoutManager: new VBox({ spacing: 0, stretching: true }),
            itemStyle:     style,
            ...(subclassDefaults ?? {}),
        } as Partial<AbstractMarkerListOptions<U>>);

        // Each item paints its own marker, so the browser must not paint a
        // second one beside it.
        this.setElementCSSRule("listStyleType", "none");
        this.getAria().setRole("list");
    }

    /**
     * Applies an {@link AbstractMarkerListOptions} bag, dispatching the list
     * marker style after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AbstractMarkerListOptions<U>): this {
        super.applyOptions(options);

        // `itemStyle` is always defaulted (the constructor seeds the required
        // `style` param into `_defaultOptions`), so always dispatch the caller
        // value or the class default — this seeds the `declare`d `_style` field
        // without touching `_options`.
        this.setStyle(options.itemStyle ?? this.getStyle()!);

        return this;
    }

    /**
     * Returns the current marker style.
     *
     * @returns The current style enum value, or undefined if not yet set.
     */
    getStyle() {
        return this._style ?? this._defaultOptions.itemStyle;
    }

    /**
     * Sets the marker style and rewrites every item's marker to match.
     *
     * @param style - The list item style enum value to apply.
     */
    setStyle(style: U) : this {
        this._style = style;
        this.renumber();

        return this;
    }

    /**
     * Returns the marker string for the child at `index` under the current
     * style. Implemented by each concrete list.
     *
     * @param index - The child's zero-based position in the list.
     *
     * @returns The marker string, or `""` when the style shows no marker.
     */
    protected abstract markerText(index: number): string;

    /**
     * Rewrites every child's marker from its current position. A no-op while
     * the list is empty, which is what makes the construction-time style
     * dispatch harmless.
     *
     * @remarks Walks every child rather than only the displayed ones, so a
     * hidden item still consumes its number — nothing notifies a list when a
     * child's displayed flag flips, so position-dependent markers would
     * otherwise go stale the moment a consumer hid an item.
     */
    protected renumber(): void {
        const items = this.getComponents() as ListItem[];

        for (let i = 0; i < items.length; i++) {
            items[i].setMarker(this.markerText(i));
        }
    }

    /**
     * Adds a ListItem child; restricts the type accepted by this container to ListItem.
     *
     * @param component - The ListItem to add.
     * @param constraints - Optional. Layout constraints for the item.
     */
    addComponent(component: ListItem, constraints?: LayoutConstraints): this {
        super.addComponent(component, constraints);

        return this;
    }

    /**
     * Inserts a ListItem child at `index` and renumbers the list.
     *
     * @param component - The ListItem to insert.
     * @param index - The position to insert at.
     * @param constraints - Optional. Layout constraints for the item.
     */
    insertComponent(component: ListItem, index: number, constraints?: LayoutConstraints): this {
        super.insertComponent(component, index, constraints);
        this.renumber();

        return this;
    }

    /**
     * Removes a ListItem child and renumbers the survivors.
     *
     * @param component - The ListItem instance to remove.
     *
     * @returns The layout constraints that were registered for the removed item, or undefined.
     */
    removeComponent(component: ListItem) {
        const constraints = super.removeComponent(component);

        this.renumber();

        return constraints;
    }

    /**
     * Reorders the items and renumbers them in the new order.
     *
     * @param comparator - The comparator to sort the items by.
     *
     * @remarks `sortComponents` is the only reorder path that does not express
     * itself through insert/remove, so it needs its own hook.
     */
    sortComponents(comparator: Comparator<Component, Component> | undefined): this {
        super.sortComponents(comparator);
        this.renumber();

        return this;
    }
}