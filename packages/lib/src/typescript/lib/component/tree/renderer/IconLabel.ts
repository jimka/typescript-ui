// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Text } from "~/component/input/Text.js";
import { TreeNode } from "~/component/tree/TreeNode.js";
import { TreeNodeRenderer } from "~/component/tree/TreeNodeRenderer.js";
import { TreeNodeRenderContext } from "~/component/tree/TreeNodeRenderContext.js";
import { ThemeManager } from "~/core/Theme.js";

/**
 * Pixel width reserved for the icon column (icon + small gap before the label).
 */
const ICON_WIDTH = 20;

/**
 * Square edge length used for the icon glyph — the theme's `glyphLg` default
 * icon step (16px at the shipped base). Read per call, not frozen in a module
 * constant, so a theme that raises `scale.base` moves the icon with it.
 */
function iconSizePx(): number {
    return ThemeManager.getResolvedScale().glyphLg;
}

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

    private _icon:          Glyph | null  = null;
    private _label:         Text;
    private _glyphResolver: IconLabelGlyphResolver;
    private _currentGlyph:  string | null = null;

    /**
     * Constructs an icon+label renderer.
     *
     * @param glyphResolver - Callback that resolves the glyph registry name for
     *                        a given node. Defaults to `() => "file"`.
     */
    constructor(glyphResolver: IconLabelGlyphResolver = () => "file") {
        super();
        this.clearInsets();

        // No icon is built here: the glyph is constructed lazily in the first
        // update() from the resolved name, so a caller supplying its own resolver
        // never forces the default "file" glyph to be registered.
        this._glyphResolver = glyphResolver;
        this._label         = new Text();

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

            this._icon?.dispose();

            this._icon = new Glyph(next);
            this._icon.clearInsets();
            this._currentGlyph = next;

            if (el) {
                DOM.sink.insertBefore(el, this._icon.getElement(true)!, this._label.getElement() ?? null);
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
        return (this._icon ? ICON_WIDTH : 0) + (this._label.getPreferredSize()?.width ?? 0);
    }

    /**
     * Positions the icon (vertically centred in the row) and the label.
     *
     * Both go inside this renderer's content box, so a border or padding on the
     * renderer shrinks them rather than being painted over.
     *
     * @param width - The horizontal extent of the renderer in pixels. Used only
     *   while the renderer has no element yet and the content box is
     *   unavailable.
     * @param height - The vertical extent of the renderer in pixels, used under
     *   the same condition as `width`.
     */
    layoutChildren(width: number, height: number): void {
        const box = this.getContentBounds() ?? { x: 0, y: 0, width, height };

        if (this._icon) {
            const iconSize = iconSizePx();

            this._icon.setAutoCommitStyle(false);
            this._icon.setX(box.x);
            this._icon.setY(box.y + Math.max(0, (box.height - iconSize) / 2));
            this._icon.setWidth(iconSize);
            this._icon.setHeight(iconSize);
            this._icon.setAutoCommitStyle(true);
        }

        const labelX     = box.x + (this._icon ? ICON_WIDTH : 0);
        const labelWidth = Math.max(0, box.x + box.width - labelX);

        this._label.setAutoCommitStyle(false);
        this._label.setX(labelX);
        this._label.setY(box.y);
        this._label.setWidth(labelWidth);
        this._label.setHeight(box.height);
        this._label.setLineHeight(box.height);
        this._label.setAutoCommitStyle(true);
    }

    /**
     * Appends the label sub-component element (and the icon, when one is already
     * bound) to the renderer's DOM element. A later icon change is inserted before
     * the label by {@link update}.
     *
     * @param element - Optional element passed by the rendering pipeline; falls back to getElement().
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

    /**
     * Disposes the label and icon, then runs the inherited teardown. Both
     * are raw-appended rather than registered, so the base destructor's
     * recursion over `_components` cannot reach them.
     */
    protected destructor(): void {
        this._label.dispose();
        this._icon?.dispose();

        super.destructor();
    }
}
