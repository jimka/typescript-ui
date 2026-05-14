// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Text } from "~/component/input/Text.js";
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
 * The toggle and label {@link Text} sub-components are appended directly to the
 * row's DOM element in `init()` rather than via `addComponent`, so their
 * preferred-size change notifications do not propagate up to the Tree and
 * trigger unnecessary layout passes.
 */
class TreeRow extends Component {

    private _toggle: Text;
    private _nodeLabel: Text;
    private _node: TreeNode | null = null;
    private _depth: number = 0;

    constructor() {
        super();

        this.getAria().setRole("treeitem");

        this._toggle = new Text();
        this._toggle.setCursor("pointer");
        this._toggle.setInsets(null);
        this._toggle.setAutoMeasure(false);
        this._toggle.getAria().setHidden(true);

        this._nodeLabel = new Text();
        this._nodeLabel.setInsets(null);
        this._nodeLabel.setAutoMeasure(false);
    }

    /**
     * Returns the toggle icon Text component.
     *
     * @returns The toggle Text instance (shows ▶, ▼, or blank).
     */
    getToggle(): Text {
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

        this._toggle.setText(hasChildren ? (expanded ? "▼" : "▶") : "");
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

        this._toggle.setAutoCommitStyle(false);
        this._toggle.setX(indent);
        this._toggle.setY(0);
        this._toggle.setWidth(TOGGLE_WIDTH);
        this._toggle.setHeight(rowHeight);
        // Sync line-height to row height so the glyph renders vertically
        // centered within the row. autoMeasure is off, so this skips the
        // DOM measurement and only writes the CSS rule.
        this._toggle.setLineHeight(rowHeight);
        this._toggle.setAutoCommitStyle(true);

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
     * Appends the toggle and label sub-component elements to the row's DOM element.
     *
     * @param element - Optional element passed by the rendering pipeline; falls back to getElement().
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return this;
        }

        el.appendChild(this._toggle.getElement(true));
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
