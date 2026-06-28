// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { VirtualScroller } from "~/component/container/VirtualScroller.js";
import { TreeNode } from "~/component/tree/TreeNode.js";
import { TreeRow } from "~/component/tree/TreeRow.js";
import { TreeNodeRenderer } from "~/component/tree/TreeNodeRenderer.js";
import { LabelTreeNodeRenderer } from "~/component/tree/renderer/Label.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link Tree}.
 *
 * @category Components
 */
export type TreeEvent = "selection" | "loaderror" | "contextmenu";

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
 * Construction-time options for {@link Tree}. Root nodes are set via
 * `setNodes()` and the renderer factory via `setRendererFactory()`; this
 * interface only carries the event-listener bag and the inherited
 * {@link ComponentOptions}.
 *
 * @category Components
 */
export interface TreeOptions extends ComponentOptions {
    /**
     * Multi-event listener bag dispatched to {@link Tree.on} at
     * construction time.
     */
    listeners?: {
        selection?: (nodes: TreeNode[]) => void;
        loaderror?: (node: TreeNode, error: unknown) => void;
        contextmenu?: (node: TreeNode, event: MouseEvent) => void;
    };
}

/**
 * A hierarchical data view with collapsible nodes and virtual scrolling.
 *
 * Pass root nodes via {@link Tree.setNodes}. The tree flattens the currently
 * visible subtree into a single scrollable list and recycles a fixed pool of
 * internal row components — rebinding rows only when their data index changes,
 * mirroring the approach used in `table/Body.ts`.
 *
 * Scrolling is delegated to a {@link VirtualScroller} that owns the
 * rows-container transform, two custom scrollbar overlays, and the wheel/touch
 * handlers with fling momentum.
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
 *
 * @category Components
 */
class Tree extends Component<TreeOptions> {

    private _nodes              : TreeNode[]                                              = [];
    private _expandedNodes      : Set<TreeNode>                                           = new Set();
    private _flatRows           : FlatRow[]                                               = [];
    private _rowPool            : TreeRow[]                                               = [];
    private _boundIndices       : number[]                                                = [];
    private _rowGeom            : Array<{ ty: number, w: number, h: number } | null>      = [];
    private _rowDisplayed       : boolean[]                                               = [];
    private _lastRowWidth       : number                                                  = 0;
    private _scroller           : VirtualScroller | null                                  = null;
    private _selectedNodes      : Set<TreeNode>                                           = new Set();
    private _loadingNodes       : Set<TreeNode>                                           = new Set();
    private _loadedNodes        : Set<TreeNode>                                           = new Set();
    private _anchorNode         : TreeNode | null                                         = null;
    private _focusNode          : TreeNode | null                                         = null;
    private _listeners          : ListenerBag<TreeEvent>                                  = new ListenerBag<TreeEvent>();
    private _rendererFactory    : () => TreeNodeRenderer                                  = () => new LabelTreeNodeRenderer();

    constructor(options?: TreeOptions) {
        super(options);

        this.setOverflow("hidden");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setPreferredSize(200, 300);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

        this.getAria().setRole("tree");
        this.getAria().setTabIndex(0);
        this.getAria().setMultiselectable(true);

        this.applyListeners(options?.listeners);
    }

    /**
     * Replaces the root nodes, collapses all nodes, clears selection, and re-renders.
     *
     * @param nodes - The new array of root {@link TreeNode} objects.
     */
    setNodes(nodes: TreeNode[]): this {
        this._nodes = nodes;
        this._expandedNodes.clear();
        this._selectedNodes.clear();
        this._loadingNodes.clear();
        this._loadedNodes.clear();
        this._anchorNode = null;
        this._focusNode = null;
        this._flatten();

        if (this.getElement()) {
            this._boundIndices.fill(-1);
            this._invalidateGeom();
            this._renderWindow();
        }

        return this;
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
     * Programmatically selects a single node, replacing any existing selection
     * and scrolling it into view.
     *
     * Unlike a user click this does **not** emit the `"selection"` event: it is a
     * state setter for syncing the tree to an external source of truth (e.g. the
     * active dock tab), so it must not re-trigger selection-driven side effects.
     * No-op when the node is not in the currently visible (flattened) set — e.g.
     * an ancestor is collapsed.
     *
     * @param node - A node currently held by this tree.
     *
     * @returns This tree, for method chaining.
     */
    selectNode(node: TreeNode): this {
        const index = this._flatRows.findIndex(r => r.node === node);
        if (index < 0) {
            return this;
        }

        this._selectedNodes.clear();
        this._selectedNodes.add(node);
        this._anchorNode = node;
        this._focusNode = node;

        this._updateSelectionStyle();
        this._scrollIntoView(index);
        this._renderWindow();
        this._updateActiveDescendant();

        return this;
    }

    /**
     * Registers a listener for one of this tree's events.
     *
     * @param event - `"selection"` fires whenever the selection changes,
     *   receiving the full array of selected {@link TreeNode} instances.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This tree, for method chaining.
     */
    on(event: "selection", listener: (nodes: TreeNode[]) => void): this;

    /**
     * Registers a listener for a lazy node's failed child load.
     *
     * @param event - `"loaderror"` fires when a node's `loadChildren` rejects;
     *   the node stays collapsed and unloaded so toggling again retries.
     * @param listener - Receives the {@link TreeNode} whose load failed and the
     *   rejection reason.
     *
     * @returns This tree, for method chaining.
     */
    on(event: "loaderror", listener: (node: TreeNode, error: unknown) => void): this;

    /**
     * Registers a listener for a right-click on a node.
     *
     * @param event - `"contextmenu"` fires when a node row is right-clicked,
     *   receiving the {@link TreeNode} under the cursor and the originating
     *   `MouseEvent` (its `clientX`/`clientY` position a context menu). The
     *   default browser menu is suppressed and the tree's selection is left
     *   unchanged, so a right-click never opens a node the way a left-click does.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This tree, for method chaining.
     */
    on(event: "contextmenu", listener: (node: TreeNode, event: MouseEvent) => void): this;
    on(event: TreeEvent,   listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This tree, for method chaining.
     */
    off(event: TreeEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "selection", nodes: TreeNode[]): void;
    protected emit(event: "loaderror", node: TreeNode, error: unknown): void;
    protected emit(event: "contextmenu", node: TreeNode, event_: MouseEvent): void;
    protected emit(event: TreeEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Sets the renderer factory used to create one
     * [`TreeNodeRenderer`](/api/component/tree/classes/TreeNodeRenderer)
     * instance per pool slot.
     *
     * @param factory - Zero-argument function returning a new
     *                  [`TreeNodeRenderer`](/api/component/tree/classes/TreeNodeRenderer).
     *                  Defaults to `() => new LabelTreeNodeRenderer()`.
     * @returns This tree, for method chaining.
     *
     * @remarks
     * If pool rows already exist, each one's renderer is replaced in place via
     * `TreeRow.setRenderer(factory())`. The DOM pool itself is preserved.
     * Bindings are cleared so the next render pass rebinds and updates the
     * new renderers.
     */
    setRendererFactory(factory: () => TreeNodeRenderer): this {
        this._rendererFactory = factory;

        for (const row of this._rowPool) {
            row.setRenderer(factory());
        }

        this._boundIndices.fill(-1);
        this._invalidateGeom();

        if (this.getElement()) {
            this._renderWindow();
        }

        return this;
    }

    /**
     * Returns the renderer factory currently in use.
     *
     * @returns The zero-argument factory function.
     */
    getRendererFactory(): () => TreeNodeRenderer {
        return this._rendererFactory;
    }

    /**
     * Reports whether a node renders an expand/collapse caret.
     *
     * @param node - The node to test.
     * @returns True when the node already carries children, or is a lazy node
     *   declared with `hasChildren: true`.
     *
     * @remarks
     * Centralising the predicate keeps the caret, ARIA, and flatten decisions
     * from drifting apart. An eager node with an empty `children` array is not
     * expandable; a lazy node is expandable before its children exist.
     */
    private _isExpandable(node: TreeNode): boolean {
        return !!(node.children && node.children.length > 0) || node.hasChildren === true;
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

                if (this._isExpandable(node) && this._expandedNodes.has(node) && node.children) {
                    recurse(node.children, depth + 1);
                }
            }
        };

        recurse(this._nodes, 0);
    }

    /**
     * Re-flattens the visible subtree and forces a full rebind of the pool so
     * every row reflects the current expanded/loading state.
     *
     * @remarks
     * Called from the collapse path, the synchronous expand path, and the async
     * load path — anywhere the flattened-row set or a node's loading affordance
     * changes.
     */
    private _reflattenAndRender(): void {
        this._flatten();
        this._boundIndices.fill(-1);
        this._invalidateGeom();
        this._renderWindow();
    }

    /**
     * Toggles the expanded state of a node, re-flattens, and re-renders.
     *
     * @param node - The node whose expanded state should be toggled.
     *
     * @remarks
     * Collapse and already-resolved expansion commit synchronously. A lazy node
     * declared with `loadChildren` that has not loaded yet defers its expansion
     * to {@link _loadAndExpand}, which only commits once the loader resolves.
     */
    private _onToggle(node: TreeNode): void {
        if (this._expandedNodes.has(node)) {
            this._expandedNodes.delete(node);
            this._reflattenAndRender();

            return;
        }

        const needsLoad = node.loadChildren !== undefined
            && !this._loadedNodes.has(node)
            && !(node.children && node.children.length);

        if (!needsLoad) {
            this._expandedNodes.add(node);
            this._reflattenAndRender();

            return;
        }

        if (this._loadingNodes.has(node)) {
            return;
        }

        void this._loadAndExpand(node);
    }

    /**
     * Loads a lazy node's children, then commits its expansion.
     *
     * @param node - The lazy node to load and expand.
     *
     * @remarks
     * Marks the node loading (driving its spinner affordance), awaits
     * `loadChildren`, and on success writes `children`, records the node as
     * loaded and expanded. A rejection emits `"loaderror"` and leaves the node
     * collapsed and unloaded so toggling again retries. An empty resolved array
     * is treated as success: the node renders as an expanded, empty parent.
     *
     * If `setNodes` swaps the dataset while the loader is in flight, it clears
     * `_loadingNodes`, so a still-present membership check after the await tells
     * us the node is still live; an orphaned resolve commits nothing.
     */
    private async _loadAndExpand(node: TreeNode): Promise<void> {
        this._loadingNodes.add(node);
        this._reflattenAndRender();

        try {
            const children = await node.loadChildren!();

            if (!this._loadingNodes.has(node)) {
                return;
            }

            node.children = children;
            this._loadedNodes.add(node);
            this._expandedNodes.add(node);
        } catch (error) {
            if (!this._loadingNodes.has(node)) {
                return;
            }

            this.emit("loaderror", node, error);
        } finally {
            this._loadingNodes.delete(node);
            this._reflattenAndRender();
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
        this.emit("selection", this.getSelectedNodes());
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
        this.emit("selection", this.getSelectedNodes());
    }

    /**
     * Scrolls the tree element so the row at `index` is fully visible, without moving if it already is.
     *
     * @param index - Zero-based index into `_flatRows`.
     */
    private _scrollIntoView(index: number): void {
        if (!this._scroller) {
            return;
        }

        const top           = index * ROW_HEIGHT;
        const bottom        = top + ROW_HEIGHT;
        const scrollTop     = this._scroller.getScrollY();
        const visibleBottom = scrollTop + this.getHeight();

        if (top < scrollTop) {
            this.setScrollY(top);
        } else if (bottom > visibleBottom) {
            this.setScrollY(bottom - this.getHeight());
        }
    }

    /**
     * Sets the JS-controlled vertical scroll position. Delegates to the
     * underlying {@link VirtualScroller}.
     *
     * @param y - The new scroll position in pixels.
     */
    setScrollY(y: number): this {
        this._scroller?.resetWheelEase();
        this._scroller?.setScrollY(y);

        return this;
    }

    /**
     * Sets the JS-controlled horizontal scroll position. Delegates to the
     * underlying {@link VirtualScroller}.
     *
     * @param x - The new scroll position in pixels.
     */
    setScrollX(x: number): this {
        this._scroller?.resetWheelEase();
        this._scroller?.setScrollX(x);

        return this;
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
            const hasChildren = this._isExpandable(node);

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
            const hasChildren = this._isExpandable(node);

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
        const target = e.target === null ? null : DOM.source.intern(e.target);

        for (const row of this._rowPool) {
            const node = row.getNode();
            if (!node) {
                continue;
            }

            const toggle = row.getToggle();
            if (toggle) {
                const toggleEl = toggle.getElement();
                if (toggleEl && (target === toggleEl || DOM.source.contains(toggleEl, target))) {
                    this._onToggle(node);
                    return;
                }
            }

            const rowEl = row.getElement();
            if (!rowEl || (!DOM.source.contains(rowEl, target) && target !== rowEl)) {
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
                this.emit("selection", this.getSelectedNodes());
            } else {
                this._selectAtIndex(clickedIdx);
            }

            return;
        }
    }

    /**
     * Resolves the node under a right-click and emits the `"contextmenu"` event.
     *
     * @remarks
     * Mirrors {@link _handleClick}'s row-matching but deliberately does not change
     * the selection: a right-click positions a context menu over a node without
     * triggering the selection-driven side effects (e.g. opening the node) that a
     * left-click would. When a node row is hit the browser's native menu is
     * suppressed via `preventDefault` and `"contextmenu"` fires with the node and
     * the originating event; a right-click on empty space is left to the browser.
     *
     * @param e - The contextmenu event whose target is inside the tree's subtree.
     */
    private _handleContextMenu(e: MouseEvent): void {
        const target = e.target === null ? null : DOM.source.intern(e.target);

        for (const row of this._rowPool) {
            const node = row.getNode();
            if (!node) {
                continue;
            }

            const rowEl = row.getElement();
            if (!rowEl || (!DOM.source.contains(rowEl, target) && target !== rowEl)) {
                continue;
            }

            e.preventDefault();
            this.emit("contextmenu", node, e);

            return;
        }
    }

    /**
     * Applies or removes the selection highlight, focus ring, and aria-selected on all bound pool rows.
     */
    private _updateSelectionStyle(): void {
        for (const row of this._rowPool) {
            const rowEl = row.getElement();

            if (!rowEl) {
                continue;
            }

            const node = row.getNode();
            const isSelected = node !== null && this._selectedNodes.has(node!);
            const isFocused = node !== null && node === this._focusNode;

            // Per-node ephemeral selection/focus styling on a pooled row re-bound
            // to a different node on every render. Routing this through cached
            // Component setters would persist it into _options and replay it onto
            // the next node bound to this reused row, so write/remove the inline
            // styles directly instead.
            if (isSelected) {
                DOM.sink.apply(rowEl, { style: { "background-color": SELECTED_BG } });
            } else {
                DOM.sink.apply(rowEl, { style: { "background-color": null } });
            }

            if (isFocused) {
                DOM.sink.apply(rowEl, { style: { "outline": "2px solid var(--ts-ui-focus-ring, rgba(30, 100, 200, 0.6))", "outline-offset": "-2px" } });
            } else {
                DOM.sink.apply(rowEl, { style: { "outline": null, "outline-offset": null } });
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
     */
    private _renderWindow(): void {
        const element = this.getElement();
        if (!element || !this._scroller) {
            return;
        }
        const scroller = this._scroller;

        const totalRows   = this._flatRows.length;
        const totalHeight = totalRows * ROW_HEIGHT;

        // Loose clamp using the last-known content width (the actual contentW
        // for this frame is computed below from the first row-bind pass).
        scroller.clampToContent(this._lastRowWidth, totalHeight);

        const visibleHeight = this.getHeight() || 0;
        const win = this._computeVisibleWindow(scroller.getScrollY(), visibleHeight, totalRows);

        const poolTarget = this._computePoolTarget(win.windowSize, visibleHeight, totalRows);
        this._growRowPool(poolTarget);

        const { reboundFlags, maxContentWidth } =
            this._bindAndMeasure(win.firstRow, win.windowSize);

        const treeWidth = this.getWidth() || 0;
        const rowWidth  = Math.max(treeWidth, maxContentWidth);
        if (rowWidth !== this._lastRowWidth) {
            this._lastRowWidth = rowWidth;
            this._invalidateGeom();
        }

        this._positionRows(win.firstRow, win.windowSize, rowWidth, reboundFlags);
        this._hideExcessPoolRows(win.windowSize);

        this._updateSelectionStyle();

        scroller.layoutScrollbars(rowWidth, totalHeight);
    }

    /**
     * Computes the `[firstRow, lastRow]` data-index window visible in the
     * current viewport, padded by `SCROLL_BUFFER` on each side and clamped to
     * the dataset bounds.
     *
     * @param scrollY - The current scroll offset in pixels.
     * @param visibleHeight - The viewport height in pixels.
     * @param totalRows - The total number of flattened rows.
     * @returns The `firstRow` / `lastRow` data indices and the number of rows in the window.
     */
    private _computeVisibleWindow(scrollY: number, visibleHeight: number, totalRows: number): { firstRow: number, lastRow: number, windowSize: number } {
        const firstRow = Math.max(0, Math.floor(scrollY / ROW_HEIGHT) - SCROLL_BUFFER);
        const lastRow  = Math.min(
            totalRows - 1,
            Math.ceil((scrollY + visibleHeight) / ROW_HEIGHT) + SCROLL_BUFFER
        );
        const windowSize = lastRow - firstRow + 1 > 0 ? lastRow - firstRow + 1 : 0;

        return { firstRow, lastRow, windowSize };
    }

    /**
     * Computes the row-pool target size: the max possible window for the
     * current viewport, not just the current windowSize. Pre-growing avoids
     * paying per-row first-time layout cost once the user passes a
     * viewport-edge boundary mid-scroll.
     *
     * @param windowSize - The current visible-window size.
     * @param visibleHeight - The viewport height in pixels.
     * @param totalRows - The total number of flattened rows.
     * @returns The pool target size.
     */
    private _computePoolTarget(windowSize: number, visibleHeight: number, totalRows: number): number {
        return Math.min(
            totalRows,
            Math.max(
                windowSize,
                Math.ceil(visibleHeight / ROW_HEIGHT) + 2 * SCROLL_BUFFER + 2
            )
        );
    }

    /**
     * Grows the row pool up to `poolTarget`, batching new {@link TreeRow}
     * elements through a {@link DocumentFragment} so the rows container sees a
     * single append instead of N.
     *
     * @param poolTarget - The target pool size.
     */
    private _growRowPool(poolTarget: number): void {
        if (!this._scroller || this._rowPool.length >= poolTarget) {
            return;
        }

        const rowsContainer = this._scroller.getRowsContainer();
        const growFragment  = DOM.sink.createDocumentFragment();

        while (this._rowPool.length < poolTarget) {
            const row   = new TreeRow(this._rendererFactory);
            const rowEl = row.getElement(true)!;

            DOM.sink.appendChild(growFragment, rowEl);

            // Pin row's static top to 0 once; per-frame Y offset comes from translateY.
            row.setY(0);

            // Pre-promote pooled rows to their own compositor layer so the first
            // scroll-driven translate doesn't pay a layer-creation cost. The pool
            // is grow-only here, so the hint persists for the Tree's lifetime —
            // bounded by windowSize + buffer (~20–40 rows), well under the per-page
            // will-change threshold.
            row.setWillChange("transform");

            this._rowPool.push(row);
            this._boundIndices.push(-1);
            this._rowGeom.push(null);
            this._rowDisplayed.push(false);
        }

        DOM.sink.appendChild(rowsContainer, growFragment);
        DOM.sink.release(growFragment);
    }

    /**
     * First pass: binds visible pool slots to their flattened rows (when
     * rebound) and computes the maximum content width across visible rows so
     * the second pass knows how wide each row should be.
     *
     * @param firstRow - The first data index covered by the visible window.
     * @param windowSize - The number of rows in the window.
     * @returns Per-slot rebind flags (parallel to the window) and the widest
     * content width seen, both consumed by {@link _positionRows}.
     */
    private _bindAndMeasure(firstRow: number, windowSize: number): { reboundFlags: boolean[], maxContentWidth: number } {
        const reboundFlags: boolean[] = new Array(windowSize);
        let maxContentWidth = 0;

        for (let i = 0; i < windowSize; i++) {
            const row         = this._rowPool[i];
            const dataIndex   = firstRow + i;
            const flatRow     = this._flatRows[dataIndex];
            const hasChildren = this._isExpandable(flatRow.node);
            const expanded    = this._expandedNodes.has(flatRow.node);
            const loading     = this._loadingNodes.has(flatRow.node);
            const wasRebound  = this._boundIndices[i] !== dataIndex;

            if (wasRebound) {
                const selected = this._selectedNodes.has(flatRow.node);
                row.setRowData(flatRow.node, flatRow.depth, hasChildren, expanded, flatRow.siblingCount, flatRow.posInSet, selected, loading);
                this._boundIndices[i] = dataIndex;
            }

            reboundFlags[i] = wasRebound;

            const cw = row.getContentWidth(INDENT_PX);
            if (cw > maxContentWidth) {
                maxContentWidth = cw;
            }
        }

        return { reboundFlags, maxContentWidth };
    }

    /**
     * Second pass: positions visible rows at `dataIndex * ROW_HEIGHT`, sizes
     * them to `rowWidth`, marks them displayed, and re-lays out their children
     * only when the row was rebound or its geometry changed.
     *
     * @param firstRow - The first data index covered by the visible window.
     * @param windowSize - The number of rows in the window.
     * @param rowWidth - The horizontal extent of each row in pixels.
     * @param reboundFlags - The per-slot rebind flags produced by {@link _bindAndMeasure}.
     */
    private _positionRows(firstRow: number, windowSize: number, rowWidth: number, reboundFlags: boolean[]): void {
        for (let i = 0; i < windowSize; i++) {
            const row        = this._rowPool[i];
            const dataIndex  = firstRow + i;
            const wasRebound = reboundFlags[i];

            const targetY     = dataIndex * ROW_HEIGHT;
            const prev        = this._rowGeom[i];
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

            if (!this._rowDisplayed[i]) {
                row.setDisplayed(true);
                this._rowDisplayed[i] = true;
            }

            if (wasRebound || geomChanged) {
                row.layoutChildren(ROW_HEIGHT, INDENT_PX);
            }
        }
    }

    /**
     * Hides pool slots whose index falls outside the visible window and
     * clears their cached binding so the next bind triggers a full rebuild.
     *
     * @param windowSize - The number of pool slots currently in use.
     */
    private _hideExcessPoolRows(windowSize: number): void {
        for (let i = windowSize; i < this._rowPool.length; i++) {
            if (this._rowDisplayed[i]) {
                this._rowPool[i].setDisplayed(false);
                this._rowDisplayed[i] = false;
            }

            this._boundIndices[i] = -1;
            this._rowGeom[i] = null;
        }
    }

    /**
     * Constructs the {@link VirtualScroller} and wires click and keyboard listeners.
     *
     * @param element - Optional element passed by the rendering pipeline; falls back to getElement().
     */
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return this;
        }

        this._scroller = new VirtualScroller(this, el, () => this._renderWindow());

        // Track the scroller's created container handles so they are released
        // with this tree (on destructor or GC); the scroller is not a Component.
        for (const handle of this._scroller.ownedHandles()) {
            this.trackHandle(handle);
        }

        Event.addSubtreeListener(this, "click", (e: MouseEvent) => {
            this._handleClick(e);
        });

        Event.addSubtreeListener(this, "contextmenu", (e: MouseEvent) => {
            this._handleContextMenu(e);
        });

        Event.addListener(this, "keydown", (e: KeyboardEvent) => {
            this._onKeyDown(e);
        });

        this._renderWindow();

        return this;
    }

    /**
     * Calls the layout manager and then refreshes the virtual-scroll viewport.
     *
     * @returns This component, for method chaining.
     *
     * @remarks
     * Overrides [`Component.doLayout`](/api/core/classes/Component#doLayout) so that layout-manager-driven size changes
     * (e.g. from a parent Tab or Split) automatically update the rendered row window.
     */
    doLayout(): this {
        if (this.isLayoutPaused()) {
            return this;
        }

        super.doLayout();
        this._renderWindow();

        return this;
    }
}

const TreeCallable = callable(Tree);
type TreeCallable = Tree;
export {
    Tree         as _Tree,
    TreeCallable as Tree
};
