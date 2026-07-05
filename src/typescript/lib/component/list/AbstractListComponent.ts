// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Insets } from "~/primitive/Insets.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { BulletedListItemStyle } from "~/component/list/BulletedListItemStyle.js";
import { NumberedListItemStyle } from "~/component/list/NumberedListItemStyle.js";
import { ListItem } from "~/component/list/ListItem.js";

/**
 * Construction-time options for {@link AbstractListComponent}.
 *
 * @category Components
 */
export interface AbstractListOptions<U extends BulletedListItemStyle | NumberedListItemStyle> extends ComponentOptions {
    itemStyle?:     U;
}

/**
 * Abstract base for bulleted and numbered list components.
 *
 * Manages the CSS list-style-type, selection state, and restricts child components to
 * ListItem instances. Concrete subclasses supply the HTML tag and default style.
 */
export abstract class AbstractListComponent<U extends BulletedListItemStyle | NumberedListItemStyle> extends Component<AbstractListOptions<U>> {

    // `declare` rather than initializer to dodge the class-field
    // super-cascade trap: the cascade-time setStyle write would otherwise
    // be clobbered by a `= undefined` initializer running after super().
    // The cascade always dispatches setStyle because the constructor seeds
    // `itemStyle: style` into the defaults bag below.
    declare private _style: U | undefined;

    constructor(
        tag:              string,
        style:            U,
        options?:         AbstractListOptions<U>,
        subclassDefaults?: Partial<AbstractListOptions<U>>,
    ) {
        super(options, {
            tag,
            preferredSize: { width: 200, height: 200 },
            padding:       new Insets(0, 0, 0, 25),
            itemStyle:     style,
            ...(subclassDefaults ?? {}),
        } as Partial<AbstractListOptions<U>>);
    }

    /**
     * Applies an {@link AbstractListOptions} bag, dispatching the list bullet
     * style and initial selection after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AbstractListOptions<U>): this {
        super.applyOptions(options);

        // `itemStyle` is always defaulted (the constructor seeds the required
        // `style` param into `_defaultOptions`), so always dispatch the caller
        // value or the class default — this seeds the `declare`d `_style` field
        // and queues the `list-style-type` rule without touching `_options`.
        this.setStyle(options.itemStyle ?? this.getStyle()!);

        return this;
    }

    /**
     * Returns the current list-style-type value.
     *
     * @returns The current style enum value, or undefined if not yet set.
     */
    getStyle() {
        return this._style ?? this._defaultOptions.itemStyle;
    }

    /**
     * Sets the list-style-type CSS property.
     *
     * @param style - The list item style enum value to apply.
     */
    setStyle(style: U) : this {
        this._style = style;
        this.setElementCSSRule("list-style-type", style);

        return this;
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
     * Removes a ListItem child.
     *
     * @param component - The ListItem instance to remove.
     *
     * @returns The layout constraints that were registered for the removed item, or undefined.
     */
    removeComponent(component: ListItem) {
        return super.removeComponent(component);
    }
}