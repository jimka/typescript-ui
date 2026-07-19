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
 * for the canonical default. {@link getContentWidth} is optional: it is read
 * only by a list running with `horizontalScrolling` on, and the base
 * implementation already reports "no intrinsic width".
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
     * Returns the natural width of the currently bound content — the width at
     * which it renders without clipping.
     *
     * Read only by a list running with
     * [`horizontalScrolling`](/api/component/list/classes/List#sethorizontalscrolling)
     * on, which sizes every row to the widest value across the bound items so
     * over-long content scrolls into view instead of ellipsising. A list with
     * horizontal scrolling off — the default — never calls this, so a renderer
     * that measures lazily pays nothing for it.
     *
     * The base implementation returns 0, meaning "no intrinsic width": rows
     * stay at the viewport width and never extend the horizontal scroll extent.
     * That keeps a custom renderer written against the previous contract
     * working unchanged; override it to opt that renderer into horizontal
     * scrolling.
     *
     * @returns The bound content's natural width in pixels, or 0 when unknown.
     */
    getContentWidth(): number {
        return 0;
    }

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
