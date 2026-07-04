// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { ListItemRenderContext } from "~/component/list/ListItemRenderContext.js";

/**
 * Abstract base class for list item renderers.
 *
 * @remarks
 * A `ListItemRenderer` owns the content of a single list row — the label, and
 * optionally an icon or other affordance. The owning
 * [`List`](/api/component/list/classes/List) /
 * [`MultiSelectList`](/api/component/list/classes/MultiSelectList) holds a
 * renderer factory; each pooled row calls that factory once at construction and
 * rebinds via {@link update} when the row is remapped to a different item. The
 * collapsed [`ComboBox`](/api/component/input/classes/ComboBox) control hosts
 * one renderer built from the same factory, so the selected entry renders on
 * the closed control exactly as it does in the open dropdown.
 *
 * Selection / focus / hover chrome is applied by the list on the row element
 * directly and never reaches the renderer.
 *
 * Subclasses implement {@link update} and {@link layoutChildren}. See
 * [`LabelListItemRenderer`](/api/component/list/classes/LabelListItemRenderer)
 * for the canonical default. Unlike `TreeNodeRenderer` there is no
 * `getContentWidth` — a list stretches its rows to full width and never
 * computes a horizontal scroll extent.
 *
 * Not wrapped with `callable()` — abstract classes are never instantiated.
 *
 * @category Components
 */
export abstract class ListItemRenderer extends Component {

    constructor() {
        super();
    }

    /**
     * Rebinds this renderer to new item data.
     *
     * @param context - The bound-item state for this render pass.
     *
     * @remarks Called every time the owning row (or collapsed control) is
     * mapped to a different item.
     */
    abstract update(context: ListItemRenderContext): void;

    /**
     * Positions this renderer's internal children within the given box.
     *
     * @param width - The horizontal extent of the renderer in pixels.
     * @param height - The vertical extent of the renderer in pixels.
     *
     * @remarks Called by the owning row after the renderer's own size has been
     * set via `setX` / `setY` / `setWidth` / `setHeight`.
     */
    abstract layoutChildren(width: number, height: number): void;
}
