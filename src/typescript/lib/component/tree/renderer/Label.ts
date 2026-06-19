// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Text } from "~/component/input/Text.js";
import { TreeNodeRenderer } from "~/component/tree/TreeNodeRenderer.js";
import { TreeNodeRenderContext } from "~/component/tree/TreeNodeRenderContext.js";

/**
 * The default [`TreeNodeRenderer`](/api/component/tree/classes/TreeNodeRenderer) —
 * a single `<span>` carrying the node's label.
 *
 * @remarks
 * Used as the implicit factory by [`Tree`](/api/component/tree/classes/Tree)
 * when no custom renderer is set. The internal `Text` runs with
 * `autoMeasure(false)`; an explicit `measure()` call after each `setText`
 * caches the natural width for `getContentWidth()` to read on the next layout
 * pass.
 *
 * @example
 * ```typescript
 * tree.setRendererFactory(() => new LabelTreeNodeRenderer());
 * ```
 *
 * @category Components
 */
export class LabelTreeNodeRenderer extends TreeNodeRenderer {

    private _label: Text;

    /**
     * Constructs a label renderer with an empty text node. The label is
     * populated on the first {@link update} call.
     */
    constructor() {
        super();
        this.clearInsets();

        this._label = new Text();
        this._label.clearInsets();
        this._label.setAutoMeasure(false);
    }

    /**
     * Returns the underlying label component so consumers can tweak font /
     * colour properties at construction time.
     *
     * @returns The internal [`Text`](/api/component/input/classes/Text) instance.
     */
    getLabel(): Text {
        return this._label;
    }

    /**
     * Updates the rendered label text and re-measures.
     *
     * @param context - The bound-node state for this render pass.
     */
    update(context: TreeNodeRenderContext): void {
        this._label.setText(context.node.label);
        this._label.measure();
    }

    /**
     * Returns the cached natural width of the rendered label.
     *
     * @returns Label width in pixels.
     */
    getContentWidth(): number {
        return this._label.getPreferredSize()?.width ?? 0;
    }

    /**
     * Sizes the label to fill the renderer's allocated box and centres its
     * line-box vertically by matching `line-height` to the row height.
     *
     * @param _width - Unused; the label sizes to its natural content width.
     * @param height - The vertical extent of the row in pixels.
     */
    layoutChildren(_width: number, height: number): void {
        const labelWidth = this.getContentWidth();

        this._label.setAutoCommitStyle(false);
        this._label.setX(0);
        this._label.setY(0);
        this._label.setWidth(labelWidth);
        this._label.setHeight(height);
        this._label.setLineHeight(height);
        this._label.setAutoCommitStyle(true);
    }

    /**
     * Appends the label sub-component element to the renderer's DOM element.
     *
     * @param element - Optional element passed by the rendering pipeline; falls back to getElement().
     */
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return this;
        }

        DOM.sink.appendChild(el, this._label.getElement(true)!);

        return this;
    }
}
