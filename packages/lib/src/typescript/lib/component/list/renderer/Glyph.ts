// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Text } from "~/component/input/Text.js";
import { ListItemRenderer } from "~/component/list/ListItemRenderer.js";
import { ListItemRenderContext } from "~/component/list/ListItemRenderContext.js";
import { callable } from "~/core/Callable.js";

/**
 * Pixel width reserved for the icon column (icon plus a small gap before the
 * label). Mirrors the tree icon-label renderer so a glyph list row and a glyph
 * tree row share the same icon gutter.
 */
const ICON_WIDTH = 20;

/** Square edge length used for the icon glyph, matching the tree renderer. */
const ICON_SIZE = 16;

/**
 * A [`ListItemRenderer`](/api/component/list/classes/ListItemRenderer) that
 * paints an icon before the item label, sourcing the icon from each item's
 * `glyph` field.
 *
 * @remarks
 * The glyph name comes from the bound item (`SelectableListItem.glyph`), populated
 * either directly on an array-supplied item or from a store record via the
 * list's `glyphField`. An item with no glyph renders label-only, with the label
 * filling the full row — matching the render-blank-on-empty contract of the
 * table glyph cell renderer. Because [`Glyph`](/api/component/display/classes/Glyph)
 * names are immutable, a fresh `Glyph` is constructed whenever the bound name
 * changes, matching the pattern `TreeRow` uses for its toggle.
 *
 * Register the glyphs the items reference before use, exactly as the table
 * glyph cell renderer requires:
 *
 * @example
 * ```typescript
 * import { star } from "~/glyphs/solid/star.js";
 *
 * Glyph.register(star);
 * list.setRendererFactory(() => new GlyphListItemRenderer());
 * list.setItems([{ key: "a", label: "Alpha", glyph: "star" }]);
 * ```
 *
 * @category Components
 */
class GlyphListItemRenderer extends ListItemRenderer {

    private _icon:         Glyph | null  = null;
    private _label:        Text;
    private _currentGlyph: string | null = null;
    /**
     * Whether `_label`'s cached natural width matches the bound text. The label
     * runs with `autoMeasure(false)`, so the measure is driven from
     * {@link getContentWidth} rather than {@link update} — a list with
     * horizontal scrolling off never asks, and so never pays for it.
     */
    private _measured:     boolean       = false;

    /**
     * Constructs a glyph+label renderer with an empty label and no icon. Both
     * are populated on the first {@link update} call.
     */
    constructor() {
        super();
        this.clearInsets();

        this._label = new Text();
        this._label.clearInsets();
        this._label.setAutoMeasure(false);
    }

    /**
     * Rebinds the icon (constructing a new Glyph when the item's glyph name
     * changed, removing it when the item has none) and the label text.
     *
     * @param context - The bound-item state for this render pass.
     */
    update(context: ListItemRenderContext): void {
        const next = context.item.glyph ? context.item.glyph : null;

        if (next !== this._currentGlyph) {
            const el = this.getElement();

            if (el && this._icon) {
                const oldEl = this._icon.getElement();
                if (oldEl && DOM.source.getParentNode(oldEl) === el) {
                    DOM.sink.removeChild(el, oldEl);
                }
            }

            this._icon         = null;
            this._currentGlyph = next;

            if (next !== null) {
                this._icon = new Glyph(next);
                this._icon.clearInsets();
                this._icon.setPointerEvents("none");

                if (el) {
                    DOM.sink.insertBefore(el, this._icon.getElement(true)!, this._label.getElement() ?? null);
                }
            }
        }

        this._label.setText(context.item.label);
        this._measured = false;
    }

    /**
     * Returns the natural width of the bound content — the icon gutter, when an
     * icon is bound, plus the label's natural width (measured on first ask
     * after each {@link update}). Mirrors {@link layoutChildren}'s geometry, so
     * a row sized to this width fits the icon and the whole label.
     *
     * @returns The bound content's natural width in pixels.
     */
    getContentWidth(): number {
        if (!this._measured) {
            this._label.measure();
            this._measured = true;
        }

        const labelWidth = this._label.getPreferredSize()?.width ?? 0;

        return (this._icon ? ICON_WIDTH : 0) + labelWidth;
    }

    /**
     * Positions the icon (vertically centred in the row) and the label. When no
     * icon is bound the label fills the full width from the left edge.
     *
     * @param width - The horizontal extent of the row in pixels.
     * @param height - The vertical extent of the row in pixels.
     */
    layoutChildren(width: number, height: number): void {
        if (this._icon) {
            this._icon.setAutoCommitStyle(false);
            this._icon.setX(0);
            this._icon.setY(Math.max(0, (height - ICON_SIZE) / 2));
            this._icon.setWidth(ICON_SIZE);
            this._icon.setHeight(ICON_SIZE);
            this._icon.setAutoCommitStyle(true);
        }

        const labelX     = this._icon ? ICON_WIDTH : 0;
        const labelWidth = Math.max(0, width - labelX);

        this._label.setAutoCommitStyle(false);
        this._label.setX(labelX);
        this._label.setY(0);
        this._label.setWidth(labelWidth);
        this._label.setHeight(height);
        this._label.setLineHeight(height);
        this._label.setAutoCommitStyle(true);
    }

    /**
     * Appends the label sub-component element (and the icon, when one is
     * already bound) to the renderer's DOM element. Later icon changes are
     * inserted before the label by {@link update}.
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

        if (this._icon) {
            DOM.sink.appendChild(el, this._icon.getElement(true)!);
        }

        DOM.sink.appendChild(el, this._label.getElement(true)!);

        return this;
    }
}

const GlyphListItemRendererCallable = callable(GlyphListItemRenderer);
type GlyphListItemRendererCallable = GlyphListItemRenderer;
export {
    GlyphListItemRenderer         as _GlyphListItemRenderer,
    GlyphListItemRendererCallable as GlyphListItemRenderer,
};
