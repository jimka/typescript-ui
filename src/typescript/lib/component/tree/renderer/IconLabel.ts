// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Text } from "~/component/input/Text.js";
import { TreeNode } from "~/component/tree/TreeNode.js";
import { TreeNodeRenderer } from "~/component/tree/TreeNodeRenderer.js";
import { TreeNodeRenderContext } from "~/component/tree/TreeNodeRenderContext.js";

/**
 * Pixel width reserved for the icon column (icon + small gap before the label).
 */
const ICON_WIDTH = 20;

/** Square edge length used for the icon glyph. */
const ICON_SIZE = 16;

/**
 * Resolves a [`Glyph`](/api/component/display/classes/Glyph) registry name for
 * the row currently being rendered.
 *
 * @param node - The bound tree node.
 * @param context - The bound-node state for this render pass.
 * @returns The glyph registry name to display.
 *
 * @category Components
 */
export type IconLabelGlyphResolver = (node: TreeNode, context: TreeNodeRenderContext) => string;

/**
 * A [`TreeNodeRenderer`](/api/component/tree/classes/TreeNodeRenderer) that
 * renders an icon followed by a text label.
 *
 * @remarks
 * The icon class is resolved per-row by a caller-supplied
 * {@link IconLabelGlyphResolver}. Because [`Glyph`](/api/component/display/classes/Glyph)
 * names are immutable, this renderer constructs a fresh `Glyph` whenever the
 * resolver returns a different name — matching the pattern used by `TreeRow`
 * for its expand/collapse toggle.
 *
 * @example
 * ```typescript
 * tree.setRendererFactory(() => new IconLabelTreeNodeRenderer(
 *     (node) => (node.children?.length ? "chevron-down" : "file")
 * ));
 * ```
 *
 * @category Components
 */
export class IconLabelTreeNodeRenderer extends TreeNodeRenderer {

    private _icon:          Glyph;
    private _label:         Text;
    private _glyphResolver: IconLabelGlyphResolver;
    private _currentGlyph:  string;

    /**
     * Constructs an icon+label renderer.
     *
     * @param glyphResolver - Callback that resolves the glyph registry name for
     *                        a given node. Defaults to `() => "file"`.
     */
    constructor(glyphResolver: IconLabelGlyphResolver = () => "file") {
        super();
        this.clearInsets();

        this._glyphResolver = glyphResolver;
        this._currentGlyph  = "file";
        this._icon          = new Glyph(this._currentGlyph);
        this._label         = new Text();

        this._icon.clearInsets();
        this._label.clearInsets();
        this._label.setAutoMeasure(false);
    }

    /**
     * Updates the icon (constructing a new Glyph if the resolved name changed)
     * and the label text.
     *
     * @param context - The bound-node state for this render pass.
     */
    update(context: TreeNodeRenderContext): void {
        const next = this._glyphResolver(context.node, context);

        if (next !== this._currentGlyph) {
            const el = this.getElement();

            if (el) {
                const oldEl = this._icon.getElement();
                if (oldEl && DOM.source.getParentNode(oldEl) === el) {
                    DOM.sink.removeChild(el, oldEl);
                }
            }

            this._icon = new Glyph(next);
            this._icon.clearInsets();
            this._currentGlyph = next;

            if (el) {
                el.insertBefore(this._icon.getElement(true), this._label.getElement());
            }
        }

        this._label.setText(context.node.label);
        this._label.measure();
    }

    /**
     * Returns the natural pixel width of the icon column plus the measured
     * label width.
     */
    getContentWidth(): number {
        return ICON_WIDTH + (this._label.getPreferredSize()?.width ?? 0);
    }

    /**
     * Positions the icon (vertically centred in the row) and the label.
     *
     * @param width - The horizontal extent of the renderer in pixels.
     * @param height - The vertical extent of the renderer in pixels.
     */
    layoutChildren(width: number, height: number): void {
        this._icon.setAutoCommitStyle(false);
        this._icon.setX(0);
        this._icon.setY(Math.max(0, (height - ICON_SIZE) / 2));
        this._icon.setWidth(ICON_SIZE);
        this._icon.setHeight(ICON_SIZE);
        this._icon.setAutoCommitStyle(true);

        const labelWidth = Math.max(0, width - ICON_WIDTH);

        this._label.setAutoCommitStyle(false);
        this._label.setX(ICON_WIDTH);
        this._label.setY(0);
        this._label.setWidth(labelWidth);
        this._label.setHeight(height);
        this._label.setLineHeight(height);
        this._label.setAutoCommitStyle(true);
    }

    /**
     * Appends the icon and label sub-component elements to the renderer's DOM
     * element.
     *
     * @param element - Optional element passed by the rendering pipeline; falls back to getElement().
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return this;
        }

        DOM.sink.appendChild(el, this._icon.getElement(true));
        DOM.sink.appendChild(el, this._label.getElement(true));

        return this;
    }
}
