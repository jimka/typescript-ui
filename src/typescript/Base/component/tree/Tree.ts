// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { Event } from "../../Event.js";
import { TreeNode } from "./TreeNode.js";
import { TreeRow } from "./TreeRow.js";

/** Pixels of indentation added per depth level. */
const INDENT_PX = 16;

/** Fixed height in pixels for every visible row. */
const ROW_HEIGHT = 24;

/** Number of off-screen rows to render above and below the visible viewport. */
const SCROLL_BUFFER = 2;

/** CSS background applied to the selected row. */
const SELECTED_BG = "var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15))";

/**
 * A pre-flattened entry in the visible subtree used by the virtual scroll.
 */
interface FlatRow {
    node: TreeNode;
    depth: number;
    siblingCount: number;
    posInSet: number;
}

/**
 * A hierarchical data view with collapsible nodes and virtual scrolling.
 *
 * Pass root nodes via {@link setNodes}. The tree flattens the currently visible
 * subtree into a single scrollable list and recycles a fixed pool of
 * {@link TreeRow} components — rebinding rows only when their data index
 * changes, mirroring the approach used in `table/Body.ts`.
 *
 * @example
 * ```typescript
 * const tree = new Tree();
 * tree.setNodes([
 *     { label: "Fruits", children: [
 *         { label: "Apple" },
 *         { label: "Banana" },
 *     ]},
 *     { label: "Vegetables" },
 * ]);
 * container.addComponent(tree);
 * ```
 */
export class Tree extends Component {

    private _nodes: TreeNode[] = [];
    private _expandedNodes: Set<TreeNode> = new Set();
    private _flatRows: FlatRow[] = [];
    private _rowPool: TreeRow[] = [];
    private _boundIndices: number[] = [];
    private _rowGeom: Array<{ ty: number, w: number, h: number } | null> = [];
    private _lastRowWidth: number = 0;
    private _phantom: HTMLElement | null = null;
    private _layoutInProgress: boolean = false;
    private _selectedNodes: Set<TreeNode> = new Set();
    private _anchorNode: TreeNode | null = null;
    private _focusNode: TreeNode | null = null;
    private _selectionListeners: Function[] = [];

    constructor() {
        super();

        this.setOverflow("auto");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setPreferredSize(200, 300);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

        this.getAria().setRole("tree");
        this.getAria().setTabIndex(0);
        this.setAttribute("aria-multiselectable", "true");
    }

    /**
     * Replaces the root nodes, collapses all nodes, clears selection, and re-renders.
     *
     * @param nodes - The new array of root {@link TreeNode} objects.
     */
    setNodes(nodes: TreeNode[]): void {
        this._nodes = nodes;
        this._expandedNodes.clear();
        this._selectedNodes.clear();
        this._anchorNode = null;
        this._focusNode = null;
        this._flatten();

        if (this.getElement()) {
            this._boundIndices.fill(-1);
            this._invalidateGeom();
            this._renderWindow();
        }
    }

    private _invalidateGeom(): void {
        for (let i = 0; i < this._rowGeom.length; i++) {
            this._rowGeom[i] = null;
        }
    }

    /**
     * Returns the root nodes currently displayed by the tree.
     *
     * @returns The array of root {@link TreeNode} objects.
     */
    getNodes(): TreeNode[] {
        return this._nodes;
    }

    /**
     * Returns the anchor node of the current selection (the last node selected by a plain click or
     * arrow key without Shift), or null if there is no selection.
     *
     * @returns The anchor {@link TreeNode}, or null.
     */
    getSelectedNode(): TreeNode | null {
        return this._anchorNode;
    }

    /**
     * Returns all currently selected nodes in no guaranteed order.
     *
     * @returns An array of selected {@link TreeNode} instances.
     */
    getSelectedNodes(): TreeNode[] {
        return Array.from(this._selectedNodes);
    }

    /**
     * Registers a callback that fires whenever the selection changes.
     *
     * @param listener - Called with the full array of selected {@link TreeNode} instances.
     */
    addSelectionListener(listener: (nodes: TreeNode[]) => void): void {
        this._selectionListeners.push(listener);
    }

    /**
     * Rebuilds the flat visible-row list from the current root nodes and expanded set,
     * computing `siblingCount` and `posInSet` (1-based) for each entry.
     */
    private _flatten(): void {
        this._flatRows = [];

        const recurse = (nodes: TreeNode[], depth: number): void => {
            const siblingCount = nodes.length;

            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];

                this._flatRows.push({ node, depth, siblingCount, posInSet: i + 1 });

                if (node.children && node.children.length > 0 && this._expandedNodes.has(node)) {
                    recurse(node.children, depth + 1);
                }
            }
        };

        recurse(this._nodes, 0);
    }

    /**
     * Toggles the expanded state of a node, re-flattens, and re-renders.
     *
     * @param node - The node whose expanded state should be toggled.
     */
    private _onToggle(node: TreeNode): void {
        if (this._expandedNodes.has(node)) {
            this._expandedNodes.delete(node);
        } else {
            this._expandedNodes.add(node);
        }

        this._flatten();
        this._boundIndices.fill(-1);
        this._invalidateGeom();
        this._renderWindow();
    }

    /**
     * Fires all selection listeners with the current selected-node array.
     */
    private _fireSelectionListeners(): void {
        const nodes = this.getSelectedNodes();

        for (const listener of this._selectionListeners) {
            listener(nodes);
        }
    }

    /**
     * Fills `_selectedNodes` with every node in `_flatRows` between `anchorIdx` and `focusIdx` (inclusive).
     *
     * @param anchorIdx - One end of the range.
     * @param focusIdx - The other end of the range (may be less than `anchorIdx`).
     */
    private _rangeSelect(anchorIdx: number, focusIdx: number): void {
        const lo = Math.min(anchorIdx, focusIdx);
        const hi = Math.max(anchorIdx, focusIdx);

        this._selectedNodes.clear();

        for (let i = lo; i <= hi; i++) {
            this._selectedNodes.add(this._flatRows[i].node);
        }
    }

    /**
     * Replaces the selection with the single node at `index`, resets the anchor and focus, and scrolls it into view.
     *
     * @param index - Zero-based index into `_flatRows`.
     */
    private _selectAtIndex(index: number): void {
        if (index < 0 || index >= this._flatRows.length) {
            return;
        }

        const node = this._flatRows[index].node;

        this._selectedNodes.clear();
        this._selectedNodes.add(node);
        this._anchorNode = node;
        this._focusNode = node;

        this._updateSelectionStyle();
        this._scrollIntoView(index);
        this._renderWindow();
        this._updateActiveDescendant();
        this._fireSelectionListeners();
    }

    /**
     * Extends the range selection from `_anchorNode` to `index`, moving only the focus end.
     *
     * @param index - Zero-based index into `_flatRows` for the new focus position.
     */
    private _extendSelectionTo(index: number): void {
        if (index < 0 || index >= this._flatRows.length) {
            return;
        }

        const anchorIdx = this._anchorNode
            ? this._flatRows.findIndex(r => r.node === this._anchorNode)
            : index;

        this._rangeSelect(anchorIdx < 0 ? index : anchorIdx, index);
        this._focusNode = this._flatRows[index].node;

        this._updateSelectionStyle();
        this._scrollIntoView(index);
        this._renderWindow();
        this._updateActiveDescendant();
        this._fireSelectionListeners();
    }

    /**
     * Scrolls the tree element so the row at `index` is fully visible, without moving if it already is.
     *
     * @param index - Zero-based index into `_flatRows`.
     */
    private _scrollIntoView(index: number): void {
        const el = this.getElement() as HTMLElement | undefined;
        if (!el) {
            return;
        }

        const top = index * ROW_HEIGHT;
        const bottom = top + ROW_HEIGHT;
        const scrollTop = el.scrollTop;
        const visibleBottom = scrollTop + this.getHeight();

        if (top < scrollTop) {
            el.scrollTop = top;
        } else if (bottom > visibleBottom) {
            el.scrollTop = bottom - this.getHeight();
        }
    }

    /**
     * Handles keyboard navigation for the tree widget.
     *
     * @remarks
     * Implements the WAI-ARIA tree keyboard interaction pattern:
     * - `ArrowDown` / `ArrowUp` — move to next/previous visible row (plain) or extend range (Shift)
     * - `ArrowRight` — expand a collapsed node, or move into an already-expanded node's first child
     * - `ArrowLeft` — collapse an expanded node, or move to its parent
     * - `Home` / `End` — jump to first/last visible row (plain) or extend range to edge (Shift)
     *
     * @param e - The keyboard event fired on the tree element.
     */
    private _onKeyDown(e: KeyboardEvent): void {
        const navigable = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
        if (!navigable.has(e.key)) {
            return;
        }

        const flatRows = this._flatRows;
        if (flatRows.length === 0) {
            return;
        }

        e.preventDefault();

        // For Shift+Arrow the moving end is the focus node, not the anchor
        const focusIdx = this._focusNode
            ? flatRows.findIndex(r => r.node === this._focusNode)
            : -1;

        if (e.key === 'ArrowDown') {
            const next = focusIdx < 0 ? 0 : Math.min(focusIdx + 1, flatRows.length - 1);
            e.shiftKey ? this._extendSelectionTo(next) : this._selectAtIndex(next);

        } else if (e.key === 'ArrowUp') {
            const prev = focusIdx < 0 ? 0 : Math.max(focusIdx - 1, 0);
            e.shiftKey ? this._extendSelectionTo(prev) : this._selectAtIndex(prev);

        } else if (e.key === 'Home') {
            e.shiftKey ? this._extendSelectionTo(0) : this._selectAtIndex(0);

        } else if (e.key === 'End') {
            const last = flatRows.length - 1;
            e.shiftKey ? this._extendSelectionTo(last) : this._selectAtIndex(last);

        } else if (e.key === 'ArrowRight') {
            if (focusIdx < 0) {
                this._selectAtIndex(0);
                return;
            }

            const { node } = flatRows[focusIdx];
            const hasChildren = !!(node.children && node.children.length > 0);

            if (!hasChildren) {
                return;
            }

            if (this._expandedNodes.has(node)) {
                // Already expanded — move focus into the first child
                this._selectAtIndex(focusIdx + 1);
            } else {
                // Collapsed — expand without moving focus
                this._onToggle(node);
            }

        } else if (e.key === 'ArrowLeft') {
            if (focusIdx < 0) {
                return;
            }

            const { node, depth } = flatRows[focusIdx];
            const hasChildren = !!(node.children && node.children.length > 0);

            if (hasChildren && this._expandedNodes.has(node)) {
                // Expanded — collapse and stay on the same node
                this._onToggle(node);
                const newIdx = this._flatRows.findIndex(r => r.node === node);
                if (newIdx >= 0) {
                    this._scrollIntoView(newIdx);
                }
            } else if (depth > 0) {
                // Collapsed or leaf — move to parent (nearest ancestor with depth - 1)
                for (let i = focusIdx - 1; i >= 0; i--) {
                    if (flatRows[i].depth === depth - 1) {
                        this._selectAtIndex(i);
                        break;
                    }
                }
            }
        }
    }

    /**
     * Dispatches clicks to either toggle expand/collapse or select a row.
     *
     * @remarks
     * Supports three selection modes via modifier keys:
     * - Plain click: replace selection with the clicked node
     * - Ctrl/Cmd+click: toggle the clicked node without disturbing others
     * - Shift+click: range-select from the anchor to the clicked node
     *
     * @param e - The click event whose target is inside the tree's DOM subtree.
     */
    private _handleClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;

        for (const row of this._rowPool) {
            const node = row.getNode();
            if (!node) {
                continue;
            }

            const toggleEl = row.getToggle().getElement();
            if (toggleEl && target === toggleEl) {
                this._onToggle(node);
                return;
            }

            const rowEl = row.getElement();
            if (!rowEl || (!rowEl.contains(target) && target !== rowEl)) {
                continue;
            }

            const clickedIdx = this._flatRows.findIndex(r => r.node === node);

            if (e.shiftKey && this._anchorNode) {
                this._extendSelectionTo(clickedIdx);
            } else if (e.ctrlKey || e.metaKey) {
                if (this._selectedNodes.has(node)) {
                    this._selectedNodes.delete(node);
                } else {
                    this._selectedNodes.add(node);
                }

                this._anchorNode = node;
                this._focusNode = node;
                this._updateSelectionStyle();
                this._fireSelectionListeners();
            } else {
                this._selectAtIndex(clickedIdx);
            }

            return;
        }
    }

    /**
     * Applies or removes the selection highlight, focus ring, and aria-selected on all bound pool rows.
     */
    private _updateSelectionStyle(): void {
        for (const row of this._rowPool) {
            const rowEl = row.getElement() as HTMLElement | undefined;

            if (!rowEl) {
                continue;
            }

            const node = row.getNode();
            const isSelected = node !== null && this._selectedNodes.has(node!);
            const isFocused = node !== null && node === this._focusNode;

            if (isSelected) {
                rowEl.style.setProperty("background-color", SELECTED_BG);
            } else {
                rowEl.style.removeProperty("background-color");
            }

            if (isFocused) {
                rowEl.style.setProperty("outline", "2px solid var(--ts-ui-focus-ring, rgba(30, 100, 200, 0.6))");
                rowEl.style.setProperty("outline-offset", "-2px");
            } else {
                rowEl.style.removeProperty("outline");
                rowEl.style.removeProperty("outline-offset");
            }

            row.getAria().setSelected(isSelected);
        }
    }

    /**
     * Sets `aria-activedescendant` on the tree container to the pool row bound to `_focusNode`.
     *
     * @remarks Must be called after `_renderWindow()` so the pool slot is guaranteed in the DOM.
     */
    private _updateActiveDescendant(): void {
        if (!this._focusNode) {
            this.getAria().setActiveDescendant("");

            return;
        }

        for (const row of this._rowPool) {
            if (row.getNode() === this._focusNode) {
                this.getAria().setActiveDescendant(row.getId());

                return;
            }
        }

        this.getAria().setActiveDescendant("");
    }

    /**
     * Recomputes the visible row window, rebinds changed pool slots, and hides excess rows.
     *
     * @remarks
     * Sets `_layoutInProgress` during layout-driven calls to suppress the spurious scroll
     * event the browser fires when the phantom element's height changes (same technique
     * as `table/Body.ts`).
     */
    private _renderWindow(): void {
        const element = this.getElement();
        if (!element) {
            return;
        }

        const totalRows = this._flatRows.length;
        const scrollTop = element.scrollTop;
        const visibleHeight = this.getHeight() || 0;
        const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - SCROLL_BUFFER);
        const lastRow = Math.min(
            totalRows - 1,
            Math.ceil((scrollTop + visibleHeight) / ROW_HEIGHT) + SCROLL_BUFFER
        );
        const windowSize = lastRow - firstRow + 1 > 0 ? lastRow - firstRow + 1 : 0;

        // Grow pool if the visible window is larger than the current pool
        while (this._rowPool.length < windowSize) {
            const row = new TreeRow();
            const rowEl = row.getElement(true);

            element.appendChild(rowEl);

            // Pin row's static top to 0 once; per-frame Y offset comes from translateY.
            row.setY(0);

            this._rowPool.push(row);
            this._boundIndices.push(-1);
            this._rowGeom.push(null);
        }

        const rowWidth = this.getWidth() || 0;
        const widthChanged = rowWidth !== this._lastRowWidth;
        if (widthChanged) {
            this._lastRowWidth = rowWidth;
            this._invalidateGeom();
        }

        // Bind and position visible rows
        for (let i = 0; i < windowSize; i++) {
            const row = this._rowPool[i];
            const dataIndex = firstRow + i;
            const flatRow = this._flatRows[dataIndex];
            const hasChildren = !!(flatRow.node.children && flatRow.node.children.length > 0);
            const expanded = this._expandedNodes.has(flatRow.node);
            const wasRebound = this._boundIndices[i] !== dataIndex;

            if (wasRebound) {
                row.setRowData(flatRow.node, flatRow.depth, hasChildren, expanded, flatRow.siblingCount, flatRow.posInSet);
                this._boundIndices[i] = dataIndex;
            }

            const targetY = dataIndex * ROW_HEIGHT;
            const prev = this._rowGeom[i];
            const geomChanged = !prev || prev.ty !== targetY || prev.w !== rowWidth || prev.h !== ROW_HEIGHT;
            if (geomChanged) {
                row.setAutoCommitStyle(false);
                row.setX(0);
                row.setTranslate(0, targetY);
                row.setWidth(rowWidth);
                row.setHeight(ROW_HEIGHT);
                row.setAutoCommitStyle(true);
                this._rowGeom[i] = { ty: targetY, w: rowWidth, h: ROW_HEIGHT };
            }
            row.setDisplayed(true);

            if (wasRebound || geomChanged) {
                row.layoutChildren(rowWidth, ROW_HEIGHT, INDENT_PX);
            }
        }

        // Hide pool rows that fall outside the visible window
        for (let i = windowSize; i < this._rowPool.length; i++) {
            this._rowPool[i].setDisplayed(false);
            this._boundIndices[i] = -1;
            this._rowGeom[i] = null;
        }

        // Keep phantom height in sync with total content height
        if (this._phantom) {
            this._phantom.style.height = totalRows * ROW_HEIGHT + "px";
        }

        this._updateSelectionStyle();

        this._layoutInProgress = false;
    }

    /**
     * Creates the phantom height element, attaches the scroll and click listeners, and renders the initial window.
     *
     * @param element - Optional element passed by the rendering pipeline; falls back to getElement().
     */
    protected init(element?: HTMLElement): void {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return;
        }

        this._phantom = document.createElement("div");
        this._phantom.style.position = "absolute";
        this._phantom.style.top = "0";
        this._phantom.style.width = "1px";
        this._phantom.style.height = this._flatRows.length * ROW_HEIGHT + "px";

        el.appendChild(this._phantom);

        Event.addListener(this, "scroll", () => {
            if (this._layoutInProgress) {
                return;
            }
            this._renderWindow();
        });

        Event.addSubtreeListener(this, "click", (e: MouseEvent) => {
            this._handleClick(e);
        });

        Event.addListener(this, "keydown", (e: KeyboardEvent) => {
            this._onKeyDown(e);
        });

        this._renderWindow();
    }

    /**
     * Calls the layout manager and then refreshes the virtual-scroll viewport.
     *
     * @remarks
     * Overrides {@link Component.doLayout} so that layout-manager-driven size changes
     * (e.g. from a parent Tab or Split) automatically update the rendered row window.
     */
    doLayout(): void {
        if (this.isLayoutPaused()) {
            return;
        }

        super.doLayout();
        this._renderWindow();
    }
}
