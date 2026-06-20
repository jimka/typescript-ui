// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Position } from "~/primitive/Position.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";

/**
 * Z-order ceiling for the drag ghost. The follow-the-cursor preview rides above
 * everything during a drag — appended at the document root, above the
 * LayerManager bands — so it is never occluded by a floating window or by the
 * per-target highlights ([`DragFeedback`](/api/core/classes/DragFeedback) /
 * [`ReorderIndicator`](/api/core/classes/ReorderIndicator)), which deliberately
 * sit *below* the window band instead.
 */
const Z_INDEX = 10200;

/**
 * Default ghost width when the caller omits an explicit size. Picked to
 * comfortably surround a one-line label without measuring text.
 */
const DEFAULT_WIDTH = 160;

/** Default ghost height — one row's worth of vertical room. */
const DEFAULT_HEIGHT = 28;

/**
 * Inner padding around the optional ghost label so text doesn't crowd the
 * border at the framework's default font size.
 */
const LABEL_INSET = 6;

/**
 * A floating drag preview that follows the pointer during an active drag
 * session, drawn above every other overlay. Created and owned by
 * [`DragManager`](/api/core/variables/DragManager); application code does
 * not instantiate this directly.
 *
 * The ghost is `Position.FIXED` (one of the documented overlay carve-outs
 * in `ARCHITECTURE.md` §Positioning) and renders with
 * `pointer-events: none` so the manager's
 * `document.elementsFromPoint` hit-test always returns the row underneath.
 *
 * @category Core
 */
class DragGhost extends Component {

    private _label: Text | null = null;

    /**
     * Constructs a drag ghost. The caller positions it via
     * {@link moveTo} and toggles visibility through {@link show} /
     * {@link hide}.
     *
     * @param label - Optional text drawn inside the ghost.
     * @param width - Optional width in pixels (defaults to 160).
     * @param height - Optional height in pixels (defaults to 28).
     */
    constructor(label?: string, width?: number, height?: number) {
        super();

        this.setPosition(Position.FIXED);
        this.setZIndex(Z_INDEX);
        this.setPointerEvents("none");
        this.setWidth(width ?? DEFAULT_WIDTH);
        this.setHeight(height ?? DEFAULT_HEIGHT);

        this.setBackgroundColor("var(--ts-ui-drag-ghost-bg)");
        this.setBorder({ border: "1px solid var(--ts-ui-drag-ghost-border)" });
        this.setShadow("var(--ts-ui-drag-ghost-shadow)");
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setOpacity(Number("0.85"));

        if (label !== undefined) {
            this._label = new Text(label);
            this._label.setPointerEvents("none");
            this.addComponent(this._label);
        }
    }

    /**
     * Repositions the ghost so its top-left corner sits at
     * `(clientX, clientY)`. `DragManager` calls this on every `mousemove`
     * during an active drag.
     *
     * @param clientX - The viewport X (already offset from the cursor by the manager).
     * @param clientY - The viewport Y (already offset from the cursor by the manager).
     */
    moveTo(clientX: number, clientY: number): void {
        this.setX(clientX);
        this.setY(clientY);
    }

    /**
     * Appends the ghost to `<html>` and schedules a layout pass. Used by
     * `DragManager` when a drag commits past the movement threshold.
     */
    show(): void {
        const el = this.getElement(true)!;

        this.scheduleLayout();
        DOM.sink.appendChild(DOM.source.getDocumentElement(), el);
    }

    /**
     * Removes the ghost element from the DOM. Used by `DragManager` on
     * mouseup / cancel.
     */
    hide(): void {
        this.removeElement();
    }

    /**
     * Lays out the optional label inside the ghost body.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        if (this._label) {
            const w = this.getWidth();
            const h = this.getHeight();

            this._label.setX(LABEL_INSET);
            this._label.setY(LABEL_INSET);
            this._label.setWidth(w - LABEL_INSET * 2);
            this._label.setHeight(h - LABEL_INSET * 2);
        }

        return this;
    }
}

const DragGhostCallable = callable(DragGhost);
type DragGhostCallable = DragGhost;
export {
    DragGhost         as _DragGhost,
    DragGhostCallable as DragGhost,
};
