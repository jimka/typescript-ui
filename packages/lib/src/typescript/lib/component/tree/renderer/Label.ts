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

        this._label = new Text(undefined, { truncate: true });
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
     * The label goes inside this renderer's content box, so a border or padding
     * on the renderer shrinks it rather than being painted over.
     *
     * @param width - The row's available width in pixels. The label clamps to
     *   this when it is narrower than the label's own natural width — its box
     *   is otherwise always exactly as wide as its content (`getContentWidth`),
     *   so `text-overflow: ellipsis` would never actually have room to trigger.
     *   In `Tree`'s default `rowOverflow: "scroll"` mode this is a no-op: rows
     *   already grow to fit the widest label (`Tree`'s `_maxContentWidth`), so
     *   `width` is never narrower than `getContentWidth()` there. It only
     *   clamps when `rowOverflow: "clip"` caps the row at the viewport width.
     * @param height - The vertical extent of the row in pixels. Used only while
     *   the renderer has no element yet and the content box is unavailable.
     */
    layoutChildren(width: number, height: number): void {
        const box        = this.getContentBounds() ?? { x: 0, y: 0, height };
        const labelWidth = Math.min(this.getContentWidth(), width);

        this._label.setAutoCommitStyle(false);
        this._label.setX(box.x);
        this._label.setY(box.y);
        this._label.setWidth(labelWidth);
        this._label.setHeight(box.height);
        this._label.setLineHeight(box.height);
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

    /**
     * Disposes the label, then runs the inherited teardown. `_label` is
     * raw-appended rather than registered, so the base destructor's
     * recursion over `_components` cannot reach it.
     */
    protected destructor(): void {
        this._label.dispose();

        super.destructor();
    }
}
