// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Text } from "~/component/input/Text.js";
import { ListItemRenderer } from "~/component/list/ListItemRenderer.js";
import { ListItemRenderContext } from "~/component/list/ListItemRenderContext.js";
import { callable } from "~/core/Callable.js";

/**
 * The default [`ListItemRenderer`](/api/component/list/classes/ListItemRenderer) —
 * a single [`Text`](/api/component/input/classes/Text) child carrying the
 * item's label.
 *
 * @remarks
 * Used as the implicit factory by [`List`](/api/component/list/classes/List) /
 * [`MultiSelectList`](/api/component/list/classes/MultiSelectList) and the
 * collapsed [`ComboBox`](/api/component/input/classes/ComboBox) control when no
 * custom renderer is set. The label keeps `Text`'s default `truncate: true`, so
 * a label wider than its row clips with an ellipsis — reproducing the row
 * chrome the list carried before renderers existed. The label is sized to fill
 * the row in {@link layoutChildren} rather than to its natural width: the row
 * is never narrower than {@link getContentWidth}, so filling it lets the
 * selection wash span the whole row without clipping the text.
 *
 * @example
 * ```typescript
 * list.setRendererFactory(() => new LabelListItemRenderer());
 * ```
 *
 * @category Components
 */
class LabelListItemRenderer extends ListItemRenderer {

    private _label: Text;
    /**
     * Whether `_label`'s cached natural width matches the bound text. The label
     * runs with `autoMeasure(false)`, so the measure is driven from
     * {@link getContentWidth} rather than {@link update} — a list with
     * horizontal scrolling off never asks, and so never pays for it.
     */
    private _measured: boolean = false;

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
     * Updates the rendered label text.
     *
     * @param context - The bound-item state for this render pass.
     */
    update(context: ListItemRenderContext): void {
        this._label.setText(context.item.label);
        this._measured = false;
    }

    /**
     * Returns the natural width of the bound label, measuring it on first ask
     * after each {@link update}.
     *
     * @returns The label's natural width in pixels.
     */
    getContentWidth(): number {
        if (!this._measured) {
            this._label.measure();
            this._measured = true;
        }

        return this._label.getPreferredSize()?.width ?? 0;
    }

    /**
     * Sizes the label to fill the renderer's allocated box and centres its
     * line-box vertically by matching `line-height` to the row height.
     *
     * The label goes inside this renderer's content box, so a border or padding
     * on the renderer shrinks it rather than being painted over.
     *
     * @param width - The horizontal extent of the row in pixels. Used only
     *   while the renderer has no element yet and the content box is
     *   unavailable.
     * @param height - The vertical extent of the row in pixels, used under the
     *   same condition as `width`.
     */
    layoutChildren(width: number, height: number): void {
        const box = this.getContentBounds() ?? { x: 0, y: 0, width, height };

        this._label.setAutoCommitStyle(false);
        this._label.setX(box.x);
        this._label.setY(box.y);
        this._label.setWidth(box.width);
        this._label.setHeight(box.height);
        this._label.setLineHeight(box.height);
        this._label.setAutoCommitStyle(true);
    }

    /**
     * Appends the label sub-component element to the renderer's DOM element.
     *
     * @param element - Optional element passed by the rendering pipeline; falls
     *   back to getElement().
     *
     * @returns This renderer, for method chaining.
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

const LabelListItemRendererCallable = callable(LabelListItemRenderer);
type LabelListItemRendererCallable = LabelListItemRenderer;
export {
    LabelListItemRenderer         as _LabelListItemRenderer,
    LabelListItemRendererCallable as LabelListItemRenderer,
};
