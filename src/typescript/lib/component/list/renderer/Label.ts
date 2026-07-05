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
 * the row in {@link layoutChildren} rather than to its natural width, because a
 * list stretches rows to full width instead of scrolling horizontally.
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
    }

    /**
     * Sizes the label to fill the renderer's allocated box and centres its
     * line-box vertically by matching `line-height` to the row height.
     *
     * @param width - The horizontal extent of the row in pixels.
     * @param height - The vertical extent of the row in pixels.
     */
    layoutChildren(width: number, height: number): void {
        this._label.setAutoCommitStyle(false);
        this._label.setX(0);
        this._label.setY(0);
        this._label.setWidth(width);
        this._label.setHeight(height);
        this._label.setLineHeight(height);
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
}

const LabelListItemRendererCallable = callable(LabelListItemRenderer);
type LabelListItemRendererCallable = LabelListItemRenderer;
export {
    LabelListItemRenderer         as _LabelListItemRenderer,
    LabelListItemRendererCallable as LabelListItemRenderer,
};
