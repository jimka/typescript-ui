// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Absolute } from "~/layout/Absolute.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import { caret_down }  from "~/glyphs/solid/caret_down.js";
import { caret_right } from "~/glyphs/solid/caret_right.js";

Glyph.register(caret_down, caret_right);

/** Width in pixels reserved for the expand/collapse toggle glyph. Matches
 *  `TreeRow.ts`'s `TOGGLE_WIDTH`; keep the two in lockstep so a `Tree` and a
 *  `TreeTable` indent identically. */
const TOGGLE_WIDTH = 20;

/** Default pixels of indentation added per depth level. */
export const DEFAULT_INDENT_PX = 16;

/**
 * A {@link CellRenderer} wrapper that prepends an indent column and an
 * expand/collapse toggle in front of a delegate renderer.
 *
 * The delegate is the typed renderer that would have been used for the
 * column's field type ({@link StringRenderer},
 * [`NumberRenderer`](/api/component/table/classes/NumberRenderer), …). It is
 * adopted as the tree renderer's only data-bearing child and handles
 * `getValue` / `setValue` unchanged. The toggle is a {@link Glyph}
 * rebuilt on each {@link setTreeState} call, mirroring the swap pattern
 * used by [`TreeRow.setRowData`](/api/component/tree/classes/TreeRow#setrowdata).
 *
 * Layout is absolute: the toggle (when present) is placed at
 * `depth * indentPx`, and the delegate immediately to its right —
 * filling the remaining width. The renderer's own insets are zero; the
 * delegate carries the cell padding inherited from its own
 * {@link CellRenderer} base.
 *
 * Toggle click routing is intentionally absent here. The host
 * `TreeBody` owns one subtree-click listener for the whole body; it
 * inspects the click target and, when it matches a pool row's toggle
 * element, calls {@link TreeBody.setExpanded} directly. This keeps
 * tree-cell renderers free of click handlers and matches the way the
 * existing `Tree` component routes toggle clicks.
 *
 * @category Components
 */
class TreeCellRenderer<T> extends CellRenderer<T> {

    declare private _delegate:    CellRenderer<T>;
    declare private _indentPx:    number;
    private _toggle:      Glyph | null = null;
    private _depth:       number       = 0;
    private _hasChildren: boolean      = false;
    private _expanded:    boolean      = false;

    /**
     * Constructs a tree-cell renderer wrapping the given delegate.
     *
     * @param delegate - The typed renderer that draws the cell value to
     *   the right of the toggle. Adopted as a child of this renderer; do
     *   not also add it to another parent.
     * @param indentPx - Pixels of indentation per depth level. Defaults
     *   to 16 px.
     */
    constructor(delegate: CellRenderer<T>, indentPx: number = DEFAULT_INDENT_PX) {
        super();

        this._delegate = delegate;
        this._indentPx = indentPx;

        // Override CellRenderer's default Fit layout — we place the
        // toggle and delegate at explicit x positions in `doLayout`.
        this.setLayoutManager(new Absolute());

        // Zero out the cell padding that CellRenderer's base set during
        // super(); the delegate is itself a CellRenderer and owns the
        // padding, so doubling it would over-indent the content by one
        // cell-padding width per row. Call the inherited setter through
        // `super` to bypass our own forwarding override.
        super.setInsets(new Insets(0, 0, 0, 0));

        this.addComponent(delegate);
    }

    /**
     * Returns the delegate renderer that draws the cell's value.
     *
     * @returns The wrapped {@link CellRenderer}.
     */
    getDelegate(): CellRenderer<T> {
        return this._delegate;
    }

    /**
     * Returns the toggle glyph currently rendered, or `null` for a leaf
     * row. The host `TreeBody` reads this to dispatch toggle clicks
     * from its subtree-click listener.
     *
     * @returns The toggle {@link Glyph}, or `null` when the row has no children.
     */
    getToggle(): Glyph | null {
        return this._toggle;
    }

    /**
     * Returns the current depth level (0 = root).
     *
     * @returns The zero-based depth.
     */
    getDepth(): number {
        return this._depth;
    }

    /**
     * Returns the x offset at which this renderer's actual content
     * (the wrapped delegate) begins — `depth * indentPx + TOGGLE_WIDTH`.
     * Used by the owning {@link Cell} on `doLayout` to keep the
     * editor visually aligned with the delegate when the cell enters
     * edit mode.
     *
     * @returns The pixels reserved on the left for the indent +
     *   toggle column.
     */
    getContentX(): number {
        return this._depth * this._indentPx + TOGGLE_WIDTH;
    }

    /**
     * Returns the value rendered by the delegate.
     *
     * @returns The current cell value.
     */
    getValue(): T {
        return this._delegate.getValue();
    }

    /**
     * Sets the value rendered by the delegate.
     *
     * @param value - The cell value to display.
     */
    setValue(value: T): this {
        this._delegate.setValue(value);

        return this;
    }

    /**
     * Returns the delegate's display text — the toggle and indent columns
     * carry no text of their own.
     *
     * @returns The delegate's current display text.
     */
    getDisplayText(): string {
        return this._delegate.getDisplayText();
    }

    /**
     * Updates the tree state for this slot — depth, whether the bound
     * record has children, and whether it is currently expanded. The
     * toggle glyph is created or removed as needed, and the renderer's
     * own `doLayout` runs so the toggle and delegate snap to their new
     * positions.
     *
     * Idempotent — a call with the same triple is a no-op.
     *
     * @param depth - Zero-based nesting depth.
     * @param hasChildren - Whether the bound record has children
     *   (controls whether a toggle is rendered).
     * @param expanded - Whether the bound record is currently expanded
     *   (controls the toggle glyph: `caret-down` vs `caret-right`).
     *
     * @returns This renderer, for method chaining.
     */
    setTreeState(depth: number, hasChildren: boolean, expanded: boolean): this {
        if (this._depth       === depth
         && this._hasChildren === hasChildren
         && this._expanded    === expanded) {
            return this;
        }

        this._depth       = depth;
        this._hasChildren = hasChildren;
        this._expanded    = expanded;

        this.refreshToggle();
        this.doLayout();

        return this;
    }

    /**
     * Forwards insets writes to the delegate. The tree-cell wrapper
     * itself stays insets-zero — its only role is to inject indent +
     * toggle space; the delegate owns the cell-padding contract that
     * CellRenderer's base assumes.
     *
     * The first call lands during `super()` of this renderer's
     * constructor (`CellRenderer`'s `applyPadding` runs before our
     * `_delegate` field is assigned). That call is swallowed by the
     * optional chain; subsequent calls — including theme-change
     * re-applications and explicit consumer writes — propagate to
     * the delegate.
     *
     * @param insets - The insets to apply to the delegate.
     */
    setInsets(insets: Insets): this {
        this._delegate?.setInsets(insets);

        return this;
    }

    /**
     * Rebuilds the toggle glyph from `_hasChildren` and `_expanded`.
     * A leaf row has no toggle. A branch row swaps in a fresh
     * `caret-down` (expanded) or `caret-right` (collapsed) glyph —
     * matches [`TreeRow.setRowData`](/api/component/tree/classes/TreeRow#setrowdata)'s
     * swap pattern (no in-place name mutation API on `Glyph`).
     */
    private refreshToggle(): void {
        if (this._toggle) {
            this.removeComponent(this._toggle);
            this._toggle = null;
        }

        if (!this._hasChildren) {
            return;
        }

        const toggle = new Glyph(this._expanded ? "caret-down" : "caret-right");

        toggle.setCursor("pointer");
        toggle.clearInsets();
        toggle.getAria().setHidden(true);

        this._toggle = toggle;
        this.addComponent(toggle);
    }

    /**
     * Positions the toggle (when present) at `depth * indentPx` from the
     * content box's origin and places the delegate immediately to its right,
     * filling the remaining content width. Runs the inherited `super.doLayout` so the
     * Absolute layout manager commits the bounds we set on the
     * children.
     *
     * @returns This renderer, for method chaining.
     */
    doLayout(): this {
        // No early return on a null box: `super.doLayout()` is the last
        // statement here, and skipping it would leave the children's bounds
        // uncommitted. The zero fallback preserves the previous
        // `getWidth() || 0` behaviour before the element exists.
        const box    = this.getContentBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
        const width  = box.width;
        const height = box.height;
        const indent = this._depth * this._indentPx;

        if (this._toggle) {
            // The caret is a rigid SVG Glyph (min/max pinned to its 16×16
            // preferredSize), so it cannot fill the taller row — centre it
            // geometrically instead of relying on line-height (a no-op for SVG).
            const glyphHeight = this._toggle.getPreferredSize()?.height ?? height;
            this._toggle.setAutoCommitStyle(false);
            this._toggle.setX(box.x + indent);
            this._toggle.setY(box.y + Math.max(0, (height - glyphHeight) / 2));
            this._toggle.setWidth(TOGGLE_WIDTH);
            this._toggle.setHeight(glyphHeight);
            this._toggle.setAutoCommitStyle(true);
        }

        const delegateX = indent + TOGGLE_WIDTH;
        const delegateW = Math.max(0, width - delegateX);

        this._delegate.setAutoCommitStyle(false);
        this._delegate.setX(box.x + delegateX);
        this._delegate.setY(box.y);
        this._delegate.setWidth(delegateW);
        this._delegate.setHeight(height);
        this._delegate.setAutoCommitStyle(true);

        // The inherited `super.doLayout` (CellRenderer → Component →
        // Absolute layout manager) commits each child's bounds via
        // `LayoutManager.commitBounds`, which already calls
        // `component.doLayout()` on every placed child. The delegate
        // and the toggle therefore receive their own `doLayout` once
        // during this call — no need to call `_delegate.doLayout()`
        // again here.
        super.doLayout();

        return this;
    }
}

const TreeCellRendererCallable = callable(TreeCellRenderer);
type TreeCellRendererCallable<T> = TreeCellRenderer<T>;
export {
    TreeCellRenderer         as _TreeCellRenderer,
    TreeCellRendererCallable as TreeCellRenderer
};
