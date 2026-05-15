// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Text } from "~/component/input/Text.js";
import { Glyph } from "~/component/display/Glyph.js";
import { TreeNode } from "~/component/tree/TreeNode.js";
import { callable } from "~/core/Callable.js";

/** Width in pixels reserved for the expand/collapse toggle icon. */
export const TOGGLE_WIDTH = 20;

/**
 * A single visible row in the {@link Tree} virtual-scroll pool.
 *
 * Each pool slot holds one {@link TreeNode} at a time. The {@link Tree} calls
 * {@link setRowData} to rebind a slot to a different node and
 * {@link layoutChildren} to reposition the toggle and label after the row's
 * own dimensions are updated.
 *
 * @remarks
 * The toggle ([`Glyph`](/api/component/display/classes/Glyph)) and label
 * {@link Text} sub-components are appended directly to the row's DOM element
 * in `init()` rather than via `addComponent`, so their preferred-size change
 * notifications do not propagate up to the Tree and trigger unnecessary
 * layout passes. Leaf rows have no toggle; non-leaf rows swap in a fresh
 * `arrow-down` / `arrow-right` glyph on each state change rather than
 * mutating a single character.
 */
class TreeRow extends Component {

    private _toggle: Glyph | null = null;
    private _nodeLabel: Text;
    private _node: TreeNode | null = null;
    private _depth: number = 0;

    constructor() {
        super();

        this.getAria().setRole("treeitem");

        this._nodeLabel = new Text();
        this._nodeLabel.clearInsets();
        this._nodeLabel.setAutoMeasure(false);
    }

    /**
     * Returns the toggle icon glyph, or null when the bound node is a leaf.
     *
     * @returns The toggle [`Glyph`](/api/component/display/classes/Glyph) instance, or null.
     */
    getToggle(): Glyph | null {
        return this._toggle;
    }

    /**
     * Returns the node label Text component.
     *
     * @returns The label Text instance.
     */
    getNodeLabel(): Text {
        return this._nodeLabel;
    }

    /**
     * Returns the tree node currently bound to this pool row.
     *
     * @returns The bound {@link TreeNode}, or null if the slot is unbound.
     */
    getNode(): TreeNode | null {
        return this._node;
    }

    /**
     * Returns the depth of the currently bound node.
     *
     * @returns The zero-based depth level.
     */
    getDepth(): number {
        return this._depth;
    }

    /**
     * Binds this pool slot to a new node, updating the toggle icon, label text, and ARIA positional attributes.
     *
     * @param node - The tree node to display.
     * @param depth - The zero-based nesting depth (controls indentation).
     * @param hasChildren - Whether the node has child nodes (determines toggle visibility).
     * @param expanded - Whether the node is currently expanded.
     * @param siblingCount - Total number of siblings at this level under the same parent.
     * @param posInSet - 1-based position of this node among its siblings.
     */
    setRowData(node: TreeNode, depth: number, hasChildren: boolean, expanded: boolean, siblingCount: number, posInSet: number): this {
        this._node = node;
        this._depth = depth;

        if (this._toggle) {
            const el = this.getElement();
            if (el) {
                el.removeChild(this._toggle.getElement(true));
            }
            this._toggle = null;
        }

        if (hasChildren) {
            const toggle = new Glyph(expanded ? "arrow-down" : "arrow-right");
            toggle.setCursor("pointer");
            toggle.clearInsets();
            toggle.getAria().setHidden(true);
            this._toggle = toggle;

            const el = this.getElement();
            if (el) {
                el.appendChild(toggle.getElement(true));
            }
        }

        this._nodeLabel.setText(node.label);
        // Texts have setAutoMeasure(false); cache label width explicitly so
        // getContentWidth reflects the current text.
        this._nodeLabel.measure();

        this.getAria().setLevel(depth + 1);
        this.getAria().setExpanded(hasChildren ? expanded : null);
        this.getAria().setSetSize(siblingCount);
        this.getAria().setPosInSet(posInSet);

        return this;
    }

    /**
     * Positions the toggle and label sub-components within the row's bounds.
     *
     * @param rowHeight - The current height of this row in pixels.
     * @param indentPx - Pixels of indentation per depth level.
     */
    layoutChildren(rowHeight: number, indentPx: number): void {
        const indent = this._depth * indentPx;

        if (this._toggle) {
            this._toggle.setAutoCommitStyle(false);
            this._toggle.setX(indent);
            this._toggle.setY(0);
            this._toggle.setWidth(TOGGLE_WIDTH);
            this._toggle.setHeight(rowHeight);
            this._toggle.setAutoCommitStyle(true);
        }

        const labelX = indent + TOGGLE_WIDTH;
        const labelWidth = this._nodeLabel.getPreferredSize()?.width ?? 0;

        this._nodeLabel.setAutoCommitStyle(false);
        this._nodeLabel.setX(labelX);
        this._nodeLabel.setY(0);
        this._nodeLabel.setWidth(labelWidth);
        this._nodeLabel.setHeight(rowHeight);
        this._nodeLabel.setLineHeight(rowHeight);
        this._nodeLabel.setAutoCommitStyle(true);
    }

    /**
     * Returns the natural pixel width needed to display this row's full content
     * (indent + toggle + label text) without horizontal clipping.
     *
     * @param indentPx - Pixels of indentation per depth level.
     */
    getContentWidth(indentPx: number): number {
        const indent = this._depth * indentPx;
        const labelWidth = this._nodeLabel.getPreferredSize()?.width ?? 0;

        return indent + TOGGLE_WIDTH + labelWidth;
    }

    /**
     * Appends the label sub-component element to the row's DOM element. The toggle
     * glyph (if any) is appended on demand by `setRowData`.
     *
     * @param element - Optional element passed by the rendering pipeline; falls back to getElement().
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return this;
        }

        el.appendChild(this._nodeLabel.getElement(true));

        return this;
    }
}

const TreeRowCallable = callable(TreeRow);
type TreeRowCallable = TreeRow;
export {
    TreeRow         as _TreeRow,
    TreeRowCallable as TreeRow
};
