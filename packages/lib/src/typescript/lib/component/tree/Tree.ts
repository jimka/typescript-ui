// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import type { Size } from "~/primitive/Size.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { VirtualRowView } from "~/component/shared/VirtualRowView.js";
import { selectionsEqual } from "~/component/shared/selectionsEqual.js";
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
export type TreeEvent = "selection" | "loaderror" | "contextmenu" | "dblclick" | "expand" | "collapse";

/**
 * How a row wider than the viewport is handled.
 *
 * - `"scroll"` (the default) — every row grows to the widest label seen so
 *   far and the horizontal scrollbar reveals the rest. Appropriate when a
 *   label's full text matters (e.g. a file path).
 * - `"clip"` — every row caps at the viewport width and a row-node renderer
 *   that honours it (e.g. {@link LabelTreeNodeRenderer}) truncates with an
 *   ellipsis instead. Appropriate for a TOC-style outline, where reading a
 *   label matters more than its exact text and scrolling sideways to read
 *   one would be worse than truncating it.
 *
 * @category Components
 */
export type TreeRowOverflow = "scroll" | "clip";

/** Which click gesture on a row's body expands or collapses it. Default `"dblclick"`. */
export type TreeExpandTrigger = "dblclick" | "click";

/** Pixels of indentation added per depth level. */
const INDENT_PX = 16;

/** Fixed height in pixels for every visible row. */
const ROW_HEIGHT = 24;

/** Default preferred width when the caller sets no explicit `preferredSize`. */
const DEFAULT_PREFERRED_WIDTH = 200;

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
    /** How a row wider than the viewport is handled. Default `"scroll"`. See {@link TreeRowOverflow}. */
    rowOverflow?: TreeRowOverflow;

    /** Which click gesture on a row's body expands/collapses it. Default `"dblclick"`. See {@link TreeExpandTrigger}. */
    expandTrigger?: TreeExpandTrigger;

    /**
     * Multi-event listener bag dispatched to {@link Tree.on} at
     * construction time.
     */
    listeners?: {
        selection?: (nodes: TreeNode[]) => void;
        loaderror?: (node: TreeNode, error: unknown) => void;
        contextmenu?: (node: TreeNode, event: MouseEvent) => void;
        dblclick?: (node: TreeNode) => void;
        expand?: (node: TreeNode) => void;
        collapse?: (node: TreeNode) => void;
    };
}

/** User-overridable default fill; a caller-supplied `backgroundColor` wins. */
const _defaultTreeOptions: Partial<TreeOptions> = {
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    overflow:      "hidden",
    maxSize:       { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
    rowOverflow:   "scroll",
    expandTrigger: "dblclick",
};

/**
 * A hierarchical data view with collapsible nodes and virtual scrolling.
 *
 * Pass root nodes via {@link Tree.setNodes}. The tree flattens the currently
 * visible subtree into a single scrollable list and recycles a fixed pool of
 * internal row components — rebinding rows only when their data index changes,
 * mirroring the approach used in `table/Body.ts`.
 *
 * Scrolling is delegated to a `VirtualScroller` that owns the
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
class Tree extends VirtualRowView<TreeRow, TreeOptions> {

    private _nodes              : TreeNode[]                                              = [];
    private _expandedNodes      : Set<TreeNode>                                           = new Set();
    private _flatRows           : FlatRow[]                                               = [];
    private _lastRowWidth       : number                                                  = 0;
    // Widest row content measured so far across the current flattened set. Only
    // the *visible* window is measured each frame, so tracking a running maximum
    // keeps the horizontal content width — and thus the H scrollbar — stable as
    // different-width rows scroll through the window, instead of jittering with
    // whatever happens to be on screen. Reset in `_flatten` when the row set is
    // rebuilt, so a narrower dataset (or a collapsed wide branch) re-derives it.
    private _maxContentWidth    : number                                                  = 0;
    private _selectedNodes      : Set<TreeNode>                                           = new Set();
    private _loadingNodes       : Set<TreeNode>                                           = new Set();
    private _loadedNodes        : Set<TreeNode>                                           = new Set();
    private _pendingExpansions  : Map<TreeNode, Promise<boolean>>                         = new Map();
    private _anchorNode         : TreeNode | null                                         = null;
    private _focusNode          : TreeNode | null                                         = null;
    private _listeners          : ListenerBag<TreeEvent>                                  = new ListenerBag<TreeEvent>();
    private _rendererFactory    : () => TreeNodeRenderer                                  = () => new LabelTreeNodeRenderer();

    constructor(options?: TreeOptions, subclassDefaults?: Partial<TreeOptions>) {
        super(options, { ..._defaultTreeOptions, ...(subclassDefaults ?? {}) });

        this.getAria().setRole("tree");
        this.getAria().setTabIndex(0);
        this.getAria().setMultiselectable(true);

        this.subscribeTheme(() => this.onThemeReflow());

        this.applyListeners(options?.listeners);
    }

    /**
     * Dispatches {@link TreeOptions.rowOverflow} and
     * {@link TreeOptions.expandTrigger}; every other option is inherited from
     * {@link Component}.
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This tree, for method chaining.
     */
    protected applyOptions(options: TreeOptions): this {
        super.applyOptions(options);

        if (options.rowOverflow !== undefined) {
            this.setRowOverflow(options.rowOverflow);
        }

        if (options.expandTrigger !== undefined) {
            this.setExpandTrigger(options.expandTrigger);
        }

        return this;
    }

    /**
     * How a row wider than the viewport is handled.
     *
     * @returns The cached {@link TreeOptions.rowOverflow}, or the class default when never set.
     */
    getRowOverflow(): TreeRowOverflow {
        return this._options.rowOverflow ?? this._defaultOptions.rowOverflow ?? "scroll";
    }

    /**
     * Sets how a row wider than the viewport is handled.
     *
     * @param rowOverflow - `"scroll"` grows rows to fit the widest label and
     *   scrolls; `"clip"` caps rows at the viewport width and truncates. See
     *   {@link TreeRowOverflow}.
     * @returns This tree, for method chaining.
     */
    setRowOverflow(rowOverflow: TreeRowOverflow): this {
        this._options.rowOverflow = rowOverflow;

        return this;
    }

    /**
     * Which click gesture on a row's body expands or collapses it.
     *
     * @returns The cached {@link TreeOptions.expandTrigger}, or the class default when never set.
     */
    getExpandTrigger(): TreeExpandTrigger {
        return this._options.expandTrigger ?? this._defaultOptions.expandTrigger ?? "dblclick";
    }

    /**
     * Sets which click gesture on a row's body expands or collapses it.
     *
     * @param expandTrigger - `"dblclick"` requires a double-click on the row
     *   body to toggle it, the file-explorer convention; `"click"` toggles it
     *   on a plain single click, the IDE-sidebar convention. The caret always
     *   toggles on a single click regardless of this setting. See
     *   {@link TreeExpandTrigger}.
     * @returns This tree, for method chaining.
     */
    setExpandTrigger(expandTrigger: TreeExpandTrigger): this {
        this._options.expandTrigger = expandTrigger;

        return this;
    }

    /**
     * Reports a height derived from the current flattened row count as the
     * preferred height when the caller has set no explicit `preferredSize`,
     * mirroring `Markdown.getPreferredSize`'s own measured-content override —
     * so a `Tree` sized by its preferred size (e.g. a corner-pinned `Anchor`
     * child, not stretched) grows and shrinks with its actual content instead
     * of reporting a fixed guess. Width keeps the class default; an explicit
     * `preferredSize` constraint wins outright.
     *
     * @returns The preferred `{width, height}`.
     */
    getPreferredSize(): Size | null {
        if (this.getPreferredSizeConstraint() !== null) {
            return super.getPreferredSize();
        }

        return { width: DEFAULT_PREFERRED_WIDTH, height: this._flatRows.length * this.getRowHeight() };
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
        this._pendingExpansions.clear();
        this._anchorNode = null;
        this._focusNode = null;
        this._flatten();

        if (this.getElement()) {
            this._boundIndices.fill(-1);
            this.invalidateGeom();
            this.renderWindow();
        }

        return this;
    }

    /**
     * Expands every node that has (already-loaded) children, so the whole tree
     * is flattened and visible. Does not load lazy branches and does not change
     * the selection or emit any event.
     *
     * @returns This tree, for method chaining.
     */
    expandAll(): this {
        const addExpandable = (nodes: TreeNode[]): void => {
            for (const node of nodes) {
                if (node.children && node.children.length > 0) {
                    this._expandedNodes.add(node);
                    addExpandable(node.children);
                }
            }
        };

        addExpandable(this._nodes);
        this._reflattenAndRender();

        return this;
    }

    /** Returns the fixed row height every tree row is laid out at. */
    protected getRowHeight(): number {
        return ROW_HEIGHT;
    }

    /**
     * Constructs one pool row backed by the current renderer factory. The
     * base's `growRowPool` owns the append + parallel-array bookkeeping.
     *
     * @returns The new, un-appended pool row.
     */
    protected createPoolRow(): TreeRow {
        return new TreeRow(this._rendererFactory);
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
     * Returns every currently expanded node, in no guaranteed order.
     *
     * @returns A snapshot array of expanded {@link TreeNode} instances.
     *
     * @remarks
     * `expandAll` and `revealByPredicate` fill the expanded set without
     * emitting `"expand"`, so this getter is how a caller reads the state
     * after either.
     */
    getExpandedNodes(): TreeNode[] {
        return Array.from(this._expandedNodes);
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
        this.renderWindow();
        this._updateActiveDescendant();

        return this;
    }

    /**
     * Finds the first node whose payload satisfies `predicate`, expanding every
     * ancestor on the path (loading lazy branches as needed) so the node becomes
     * visible, then scrolls it into view. Returns the node, or `null` when no
     * node matches.
     *
     * Unlike {@link selectNode} — which no-ops when the target sits under a
     * collapsed or not-yet-loaded ancestor — this walks the whole tree,
     * awaiting each lazy branch's `loadChildren` on the way down, so it can
     * reveal a node the user has never manually expanded to. Because it may
     * load every branch it visits, it is O(nodes) and issues one `loadChildren`
     * per unloaded branch it descends; call it for a deliberate "jump to this
     * object" action, not on a hot path.
     *
     * Revealing is not selecting: this method does not change the selection or
     * emit `"selection"`. Select the returned node with {@link selectNode} if the
     * reveal should also highlight it. It likewise expands ancestors without
     * emitting `"expand"` — read {@link getExpandedNodes} afterwards.
     *
     * The search is depth-first in root-then-child order and stops at the first
     * match. A lazy branch whose `loadChildren` rejects is skipped (its subtree
     * is treated as empty) and the walk continues; the failure is not surfaced
     * here (no `"loaderror"` is emitted for a reveal-driven load).
     *
     * @param predicate - Tested against each node's `data` payload (and the node
     *   itself); return `true` for the node to reveal.
     *
     * @returns A promise resolving to the revealed {@link TreeNode}, or `null`.
     */
    async revealByPredicate(predicate: (data: unknown, node: TreeNode) => boolean): Promise<TreeNode | null> {
        const path = await this._findPath(this._nodes, predicate, []);
        if (path === null) {
            return null;
        }

        // Expand every ancestor (all but the target itself) so the target's row
        // enters the flattened set; the target's own children stay as they are.
        for (let i = 0; i < path.length - 1; i++) {
            this._expandedNodes.add(path[i]);
        }
        this._reflattenAndRender();

        const target = path[path.length - 1];
        const index  = this._flatRows.findIndex(r => r.node === target);
        if (index >= 0) {
            this._scrollIntoView(index);
        }

        return target;
    }

    /**
     * Depth-first search for the first node satisfying `predicate`, returning
     * the full root-to-match path (inclusive) or `null`. Awaits and caches each
     * visited branch's lazy children so the walk can descend into unloaded
     * subtrees.
     *
     * @param nodes - The sibling nodes to search at this level.
     * @param predicate - The match test (see {@link revealByPredicate}).
     * @param prefix - The ancestor path leading to `nodes`.
     *
     * @returns The path from a root to the matching node, or `null`.
     */
    private async _findPath(
        nodes: TreeNode[],
        predicate: (data: unknown, node: TreeNode) => boolean,
        prefix: TreeNode[],
    ): Promise<TreeNode[] | null> {
        for (const node of nodes) {
            const here = [...prefix, node];

            if (predicate(node.data, node)) {
                return here;
            }

            const children = await this._ensureChildrenLoaded(node);
            if (children.length > 0) {
                const found = await this._findPath(children, predicate, here);
                if (found !== null) {
                    return found;
                }
            }
        }

        return null;
    }

    /**
     * Returns a node's children, loading and caching them from `loadChildren`
     * first when the node is lazy and unloaded. Mirrors {@link _loadAndExpand}'s
     * cache writes (`children` + `_loadedNodes`) but does not expand the node —
     * a reveal only expands the ancestors on the path to its match. A rejected
     * load is swallowed and treated as an empty subtree.
     *
     * @param node - The node whose children are needed.
     *
     * @returns The node's children (possibly empty).
     */
    private async _ensureChildrenLoaded(node: TreeNode): Promise<TreeNode[]> {
        if (node.children && node.children.length > 0) {
            return node.children;
        }

        if (node.loadChildren !== undefined && !this._loadedNodes.has(node)) {
            try {
                const children = await node.loadChildren();

                node.children = children;
                this._loadedNodes.add(node);

                return children;
            } catch {
                return [];
            }
        }

        return node.children ?? [];
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

    /**
     * Registers a listener for a double-click (activation) on a node.
     *
     * @param event - `"dblclick"` fires when a node row is double-clicked,
     *   receiving the {@link TreeNode} under the cursor. The first click of the
     *   pair still emits `"selection"` as usual, so `"dblclick"` is an
     *   activation signal layered on top of selection — consumers typically use
     *   `"selection"` to preview a node and `"dblclick"` to open it.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This tree, for method chaining.
     */
    on(event: "dblclick", listener: (node: TreeNode) => void): this;

    /**
     * Registers a listener for a node's expansion committing.
     *
     * @param event - `"expand"` fires after the expansion has committed and
     *   the rows have been rebuilt — for an unloaded lazy node, after its
     *   `loadChildren` resolved and the children were attached, not when the
     *   toggle was first requested. It never fires from `setNodes`,
     *   `expandAll`, or `revealByPredicate`; a rejected lazy load fires only
     *   `"loaderror"` instead.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This tree, for method chaining.
     */
    on(event: "expand", listener: (node: TreeNode) => void): this;

    /**
     * Registers a listener for a node leaving the expanded set.
     *
     * @param event - `"collapse"` fires after the node has left the expanded
     *   set and the rows have been rebuilt. It never fires from `setNodes`,
     *   `expandAll`, or `revealByPredicate`.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This tree, for method chaining.
     */
    on(event: "collapse", listener: (node: TreeNode) => void): this;
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
    protected emit(event: "dblclick", node: TreeNode): void;
    protected emit(event: "expand",   node: TreeNode): void;
    protected emit(event: "collapse", node: TreeNode): void;
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
        this.invalidateGeom();

        if (this.getElement()) {
            this.renderWindow();
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

        // The visible set is changing, so the widest-row running maximum no
        // longer describes it — reset it and let the next render pass re-derive
        // the content width from the new rows (a collapsed wide branch or a
        // narrower dataset must be able to shrink the horizontal extent).
        this._maxContentWidth = 0;

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
        this.invalidateGeom();
        this.renderWindow();
    }

    /**
     * Expands `node` if it is not already expanded — the same commit path as
     * clicking its collapsed caret (loading its children first when it is an
     * unloaded lazy node), without requiring a prior click. No-ops if `node`
     * is already expanded. Useful for defaulting specific sections open after
     * {@link setNodes}, which always starts every node collapsed.
     *
     * @param node - The node to expand.
     *
     * @returns This tree, for method chaining.
     *
     * @see Use {@link expandNodeAsync} instead when the caller needs to know
     *   when a lazy expansion finished.
     */
    expandNode(node: TreeNode): this {
        if (!this._expandedNodes.has(node)) {
            void this._expand(node);
        }

        return this;
    }

    /**
     * Expands `node` and resolves once the expansion has committed.
     *
     * @param node - The node to expand.
     *
     * @returns A promise resolving to `true` when the node ends up expanded —
     *   including when it already was — or `false` when a lazy load rejected
     *   and the node stayed collapsed.
     *
     * @remarks
     * A second call for a node whose lazy load is already in flight joins
     * that load instead of starting another, and both callers resolve with
     * its outcome. Emits `"expand"` on a real transition, the same as
     * {@link expandNode}.
     */
    async expandNodeAsync(node: TreeNode): Promise<boolean> {
        if (this._expandedNodes.has(node)) {
            return true;
        }

        return this._expand(node);
    }

    /**
     * Toggles the expanded state of a node, re-flattens, and re-renders.
     *
     * @param node - The node whose expanded state should be toggled.
     *
     * @remarks
     * Delegates to {@link _collapse} for an expanded node and {@link _expand}
     * for a collapsed one — the same commit path (and lazy-load join
     * behaviour, via {@link _expandLazy}) used by every other caller.
     */
    private _onToggle(node: TreeNode): void {
        if (this._expandedNodes.has(node)) {
            this._collapse(node);

            return;
        }

        void this._expand(node);
    }

    /**
     * Commits `node`'s expansion, loading a lazy node's children first.
     *
     * @param node - The node to expand.
     *
     * @returns A promise resolving to `true` once the expansion has committed,
     *   or `false` when a lazy load failed or was orphaned.
     *
     * @remarks
     * An already-loaded node commits synchronously — the returned promise is
     * already resolved by the time this returns, so a caller that ignores it
     * still sees the expansion in the same tick.
     */
    private _expand(node: TreeNode): Promise<boolean> {
        const needsLoad = node.loadChildren !== undefined
            && !this._loadedNodes.has(node)
            && !(node.children && node.children.length);

        if (needsLoad) {
            return this._expandLazy(node);
        }

        this._expandedNodes.add(node);
        this._reflattenAndRender();
        this.emit("expand", node);

        return Promise.resolve(true);
    }

    /**
     * Removes `node` from the expanded set, re-renders, then reports the change.
     *
     * @param node - The node to collapse.
     */
    private _collapse(node: TreeNode): void {
        this._expandedNodes.delete(node);
        this._reflattenAndRender();
        this.emit("collapse", node);
    }

    /**
     * Starts a lazy node's load-and-expand, or joins the one already running for
     * that node so a second caller never triggers a second `loadChildren`.
     *
     * @param node - The lazy node to expand.
     *
     * @returns The (possibly shared) promise resolving once the load settles.
     */
    private _expandLazy(node: TreeNode): Promise<boolean> {
        const inFlight = this._pendingExpansions.get(node);

        if (inFlight !== undefined) {
            return inFlight;
        }

        const pending = this._loadAndExpand(node);

        this._pendingExpansions.set(node, pending);

        // Identity-checked so a `setNodes` that cleared the map mid-flight, followed
        // by a fresh load for the same node object, is not un-registered by the
        // orphaned load's own cleanup.
        void pending.then(() => {
            if (this._pendingExpansions.get(node) === pending) {
                this._pendingExpansions.delete(node);
            }
        });

        return pending;
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
     *
     * The `"expand"` emission is the last thing this method does, after the
     * re-render, so a listener sees the loaded children already flattened.
     *
     * @returns `true` when the node's expansion committed, `false` when the
     *   load failed or was orphaned by a `setNodes` swap.
     */
    private async _loadAndExpand(node: TreeNode): Promise<boolean> {
        this._loadingNodes.add(node);
        this._reflattenAndRender();

        let expanded = false;

        try {
            const children = await node.loadChildren!();

            if (!this._loadingNodes.has(node)) {
                return false;
            }

            node.children = children;
            this._loadedNodes.add(node);
            this._expandedNodes.add(node);
            expanded = true;
        } catch (error) {
            if (!this._loadingNodes.has(node)) {
                return false;
            }

            this.emit("loaderror", node, error);
        } finally {
            this._loadingNodes.delete(node);
            this._reflattenAndRender();
        }

        if (expanded) {
            this.emit("expand", node);
        }

        return expanded;
    }

    /**
     * Fires `"selection"` with the current selection, unless it has the same
     * membership as `before` — in which case the gesture that ran did not
     * actually change what was selected, and the event is skipped.
     *
     * @param before - The selection as it stood immediately before the
     *   mutating gesture ran.
     */
    private _notifySelectionChange(before: ReadonlySet<TreeNode>): void {
        if (selectionsEqual(before, this._selectedNodes)) {
            return;
        }

        this.emit("selection", this.getSelectedNodes());
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
        const before = new Set(this._selectedNodes);

        this._selectedNodes.clear();
        this._selectedNodes.add(node);
        this._anchorNode = node;
        this._focusNode = node;

        this._updateSelectionStyle();
        this._scrollIntoView(index);
        this.renderWindow();
        this._updateActiveDescendant();
        this._notifySelectionChange(before);
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

        const before = new Set(this._selectedNodes);

        const anchorIdx = this._anchorNode
            ? this._flatRows.findIndex(r => r.node === this._anchorNode)
            : index;

        this._rangeSelect(anchorIdx < 0 ? index : anchorIdx, index);
        this._focusNode = this._flatRows[index].node;

        this._updateSelectionStyle();
        this._scrollIntoView(index);
        this.renderWindow();
        this._updateActiveDescendant();
        this._notifySelectionChange(before);
    }

    /**
     * Scrolls the tree element so the row at `index` is fully visible, without
     * moving if it already is. Delegates to the shared base implementation.
     *
     * @param index - Zero-based index into `_flatRows`.
     */
    private _scrollIntoView(index: number): void {
        this.scrollRowIntoView(index);
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
    private _onKeyDown(e: KeyboardEvent): Event.ListenerResult {
        const navigable = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
        if (!navigable.has(e.key)) {
            return;
        }

        const flatRows = this._flatRows;
        if (flatRows.length === 0) {
            return;
        }

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

                return { prevent: true };
            }

            const { node } = flatRows[focusIdx];
            const hasChildren = this._isExpandable(node);

            if (!hasChildren) {
                return { prevent: true };
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
                return { prevent: true };
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

        return { prevent: true };
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
     * When {@link getExpandTrigger} is `"click"`, a plain click (no
     * modifiers) on an expandable row's body also toggles its expansion
     * after selection is applied; Ctrl/Cmd-click and an anchored Shift-click
     * never toggle; the caret always toggles regardless of this setting.
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
                const before = new Set(this._selectedNodes);

                if (this._selectedNodes.has(node)) {
                    this._selectedNodes.delete(node);
                } else {
                    this._selectedNodes.add(node);
                }

                this._anchorNode = node;
                this._focusNode = node;
                this._updateSelectionStyle();
                this._notifySelectionChange(before);
            } else {
                this._selectAtIndex(clickedIdx);

                if (this.getExpandTrigger() === "click" && this._isExpandable(node)) {
                    this._onToggle(node);
                }
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
    private _handleContextMenu(e: MouseEvent): Event.ListenerResult {
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

            this.emit("contextmenu", node, e);

            return { prevent: true };
        }
    }

    /**
     * Resolves the node under a double-click and emits the `"dblclick"` event.
     *
     * @remarks
     * Mirrors {@link _handleContextMenu}'s row-matching. The first click of the
     * pair has already run through {@link _handleClick} and set the selection, so
     * this only layers an activation signal on top — it does not re-select.
     * `preventDefault` suppresses the browser's double-click text selection of the
     * row label. When {@link getExpandTrigger} is `"click"`, the row-body toggle
     * below is skipped too, for the same reason the caret's is — each click of
     * the pair already toggled it via {@link _handleClick}.
     *
     * @param e - The dblclick event whose target is inside the tree's subtree.
     */
    private _handleDblClick(e: MouseEvent): Event.ListenerResult {
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

            this.emit("dblclick", node);

            // Double-clicking a parent row toggles its expansion, the
            // file-explorer convention. A double-click on the toggle caret is
            // skipped: `_handleClick` already fired `_onToggle` on each of the
            // two clicks, so its net state is unchanged and toggling again here
            // would flip it a third time. The row body is skipped the same way
            // when `expandTrigger` is `"click"` — there too, each of the two
            // clicks already toggled it via `_handleClick`. Leaf nodes have
            // nothing to expand, so their `"dblclick"` stays a pure activation
            // signal.
            const toggle   = row.getToggle();
            const toggleEl = toggle ? toggle.getElement() : undefined;
            const onToggle = !!toggleEl
                && (target === toggleEl || DOM.source.contains(toggleEl, target));

            if (!onToggle && this._isExpandable(node) && this.getExpandTrigger() === "dblclick") {
                this._onToggle(node);
            }

            return { prevent: true };
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
     * @remarks Must be called after `renderWindow()` so the pool slot is guaranteed in the DOM.
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
     * Drops the running content-width maximum before the shared re-bind pass.
     *
     * @remarks The maximum is deliberately monotonic within a flattened set so
     * the horizontal scrollbar does not jitter as rows scroll in and out (it is
     * otherwise reset only in `_flatten`). A metrics reflow invalidates the
     * measurements it was accumulated from, so keeping it would pin the content
     * width to the old font — leaving a phantom scroll range when the new face
     * is narrower, and never widening past the stale value.
     */
    protected onThemeReflow(): void {
        this._maxContentWidth = 0;

        super.onThemeReflow();
    }

    /**
     * Recomputes the visible row window, rebinds changed pool slots, and hides excess rows.
     */
    protected renderWindow(): void {
        const element = this.getElement();
        if (!element || !this._scroller) {
            return;
        }

        if (this.deferRenderWhileFirstLayoutHeld()) {
            return;
        }

        const scroller = this._scroller;

        const totalRows   = this._flatRows.length;
        const totalHeight = totalRows * ROW_HEIGHT;

        // Loose clamp using the last-known content width (the actual contentW
        // for this frame is computed below from the first row-bind pass).
        scroller.clampToContent(this._lastRowWidth, totalHeight);

        const visibleHeight = this.getHeight() || 0;
        const win = this.computeVisibleWindow(scroller.getScrollY(), visibleHeight, totalRows);

        const poolTarget = this.computePoolTarget(win.windowSize, visibleHeight, totalRows);
        this.growRowPool(poolTarget);
        this.alignPoolWindow(win.firstRow);

        const { reboundFlags, maxContentWidth } =
            this._bindAndMeasure(win.firstRow, win.windowSize);

        // Only the visible window was measured, so fold the widest row seen this
        // frame into the running maximum for the current flattened set (reset in
        // `_flatten`). The content width then only grows as wider rows are
        // discovered and never shrinks when they scroll away, so the horizontal
        // scrollbar stays stable instead of jittering with the visible rows.
        if (maxContentWidth > this._maxContentWidth) {
            this._maxContentWidth = maxContentWidth;
        }

        // Fill to the effective viewport width (owner width minus the vertical
        // scrollbar's reservation when that bar is visible), not the raw owner
        // width. Sizing rows to the full width would push their trailing edge
        // under the vertical bar, and handing that full width to
        // `layoutScrollbars` as the content width forces a spurious horizontal
        // bar for the reserved band. `clampToContent` above has already refreshed
        // the scroller's content metrics this pass.
        //
        // `rowOverflow: "clip"` never grows past the viewport at all — every
        // row (and so every renderer) is capped there instead, trading the
        // horizontal scrollbar for truncation (see `LabelTreeNodeRenderer`).
        const rowWidth = this.getRowOverflow() === "clip"
            ? scroller.getViewportWidth()
            : Math.max(scroller.getViewportWidth(), this._maxContentWidth);
        if (rowWidth !== this._lastRowWidth) {
            this._lastRowWidth = rowWidth;
            this.invalidateGeom();
        }

        this._positionRows(win.firstRow, win.windowSize, rowWidth, reboundFlags);
        this.hideExcessPoolRows(win.windowSize);

        this._updateSelectionStyle();

        scroller.layoutScrollbars(rowWidth, totalHeight);

        // A pass the startup font gate deferred skipped whatever its caller did
        // after asking for it — including the active-descendant refresh, which
        // could not name a row that did not exist yet. Redo it now the rows do.
        if (this.finishResumedRender()) {
            this._updateActiveDescendant();
        }
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

            const geomChanged = this.positionRow(i, dataIndex * ROW_HEIGHT, rowWidth);

            if (wasRebound || geomChanged) {
                row.layoutChildren(ROW_HEIGHT, INDENT_PX);
            }
        }
    }

    /**
     * Constructs the `VirtualScroller` and wires click and keyboard listeners.
     *
     * @param element - Optional element passed by the rendering pipeline; falls back to getElement().
     */
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return this;
        }

        this.initScroller(el);

        Event.addSubtreeListener(this, "click", this._handleClick);
        Event.addSubtreeListener(this, "contextmenu", { button: "any", handler: this._handleContextMenu });
        Event.addSubtreeListener(this, "dblclick", this._handleDblClick);
        Event.addListener(this, "keydown", this._onKeyDown);

        this.renderWindow();

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

        // A pass the startup font gate deferred already renders the window, so
        // running the unconditional one as well would render twice on the frame
        // the gate opens.
        if (!this.renderWindowIfDeferred()) {
            this.renderWindow();
        }

        return this;
    }
}

const TreeCallable = callable(Tree);
type TreeCallable = Tree;
export {
    Tree         as _Tree,
    TreeCallable as Tree
};
