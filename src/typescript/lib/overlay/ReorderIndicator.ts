// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Position } from "~/primitive/Position.js";
import { callable } from "~/core/Callable.js";
import { LayerManager } from "~/core/LayerManager.js";
import { DOM } from "~/core/DOM.js";

/**
 * Z-order shared with {@link DragFeedback}: just **below** the lowest
 * {@link LayerManager} band (the {@link Window} band) so this drop-target
 * insertion line — drawn over app content that establishes no isolating
 * stacking context — never paints over a floating window, while still sitting
 * above the target's own content. The drag ghost sits above both at the root.
 */
const Z_INDEX = LayerManager.Band.Window - 1;

/** Height of the insertion-line bar in pixels. */
const BAR_HEIGHT = 2;

/**
 * Half the bar height — subtracted in {@link ReorderIndicator.setInsertionY}
 * so the 2 px bar is centred on the insertion line.
 */
const BAR_HALF = 1;

/**
 * A 2 px horizontal bar drawn between rows to mark the insertion line
 * during an active drag-reorder gesture.
 *
 * Reserved for future sibling-reorder work — drop-on-directory does not
 * use this overlay. The class ships now so the public API surface and
 * theme tokens stabilise alongside
 * [`DragGhost`](/api/overlay/classes/DragGhost) and
 * [`DragFeedback`](/api/overlay/classes/DragFeedback); the row-DnD wiring
 * in [`TreeTable`](/api/component/table/classes/TreeTable) only attaches
 * the feedback tint.
 *
 * @category Core
 */
class ReorderIndicator extends Component {

    /**
     * Constructs a reorder indicator. The bar is not attached until
     * {@link attachTo} is called.
     */
    constructor() {
        super();

        this.setPosition(Position.ABSOLUTE);
        this.setZIndex(Z_INDEX);
        this.setPointerEvents("none");
        this.setHeight(BAR_HEIGHT);

        this.setBackgroundColor("var(--ts-ui-drag-reorder-color)");
    }

    /**
     * Centres the bar on the given y-coordinate within the attached
     * target. The `- BAR_HALF` shift accounts for the 2 px bar height.
     *
     * @param y - Insertion-line y, measured from the target's top edge.
     */
    setInsertionY(y: number): void {
        this.setY(y - BAR_HALF);
    }

    /**
     * Mirrors the target's width onto the bar and appends the bar
     * element to the target.
     *
     * @param target - The drop target whose top-left coordinate space
     *   the bar is positioned within.
     */
    attachTo(target: Component): void {
        const targetEl = target.getElement(true)!;
        const myEl     = this.getElement(true)!;

        this.setX(0);
        this.setWidth(target.getWidth());

        if (DOM.source.getParentElement(myEl) === targetEl) {
            return;
        }

        DOM.sink.appendChild(targetEl, myEl);
    }

    /**
     * Removes the bar element from the DOM.
     */
    detach(): void {
        this.removeElement();
    }
}

const ReorderIndicatorCallable = callable(ReorderIndicator);
type ReorderIndicatorCallable = ReorderIndicator;
export {
    ReorderIndicator         as _ReorderIndicator,
    ReorderIndicatorCallable as ReorderIndicator,
};
