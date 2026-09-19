// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import type { Size } from "~/primitive/Size.js";
import { Event } from "~/core/Event.js";
import { SpatialNavigation } from "~/core/SpatialNavigation.js";
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
 * Where a node sits in the tree: the array that holds it, that array's owner
 * (`null` for the root array), the node's index in it, and the path down to
 * it — everything the one search that finds a node can report.
 */
interface NodeLocation {
    parent:   TreeNode | null;
    siblings: TreeNode[];
    index:    number;
    /** The root-to-node path, both ends included. */
    path:     TreeNode[];
}

/**
 * One `revealByPredicate` call's state, shared by every level of its walk.
 */
interface RevealWalk {
    /** The match test. */
    predicate:  (data: unknown, node: TreeNode) => boolean;
    /**
     * Every node this reveal has tested so far. A visited node is not tested
     * or loaded again, but the walk still searches the subtree beneath it.
     */
    visited:    Set<TreeNode>;
    /**
     * How many times a load this reveal waited on, whether it started the
     * load or joined it, has bumped the tree's structure generation. Each
     * such load only filled in the children of the node the walk was about to
     * search beneath, so the walk leaves these bumps out rather than go back
     * over what it has already searched.
     */
    ownCommits: number;
}

/**
 * How a lazy load ended: `"loaded"` committed the node's children,
 * `"failed"` means `loadChildren` rejected, and `"dropped"` means `setNodes`
 * or a structural call orphaned the load before it settled.
 */
type LoadOutcome = "loaded" | "failed" | "dropped";

/**
 * A settled lazy load, as every reveal and expand waiting on it sees it.
 */
interface SettledLoad {
    /** How the load ended. */
    outcome: LoadOutcome;
    /**
     * What a renderer or an `"expand"`/`"loaderror"` listener threw while the
     * load committed, boxed so a thrown `undefined` still counts, or `null`
     * when nothing threw. The expands waiting on the load rethrow it, as a
     * listener's throw reached the expand's caller before loads were shared;
     * a reveal ignores it, since those listeners answer the expand, not the
     * reveal.
     */
    thrown: { error: unknown } | null;
}

/**
 * A lazy node's one load in flight, shared by every reveal and expand
 * waiting on it.
 */
interface PendingLoad {
    /** The load's token from `_loadSeq`. */
    seq:     number;
    /**
     * Resolves, never rejecting, once the load has settled: a throw while it
     * commits is recorded in {@link SettledLoad.thrown} instead.
     */
    settled: Promise<SettledLoad>;
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
 * Pass root nodes via {@link Tree.setNodes}. Change the tree afterwards one
 * node at a time with {@link Tree.insertNode}, {@link Tree.removeNode},
 * {@link Tree.setChildren} and {@link Tree.notifyNodeChanged}, which keep
 * every other node's expansion, selection and lazy-load state. The tree
 * flattens the currently visible subtree into a single scrollable list and
 * recycles a fixed pool of internal row components. A reflatten first
 * re-matches each pool slot to the node it was already showing, by identity,
 * so a node that stays on screen keeps its slot — and therefore its DOM
 * element and renderer state — across an expand/collapse instead of following
 * a shifted flat position; only then does a slot rebind, and only when the
 * node, depth, expanded/loading state, or other content it was last bound to
 * has actually changed.
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
    // Set by `_flatten`, cleared by the render pass that consumes it. Tells
    // `renderWindow` whether the pool has to be re-matched to its nodes by
    // identity (a reflatten moved rows between flat positions) or can take the
    // base's cheap scroll rotation (the row set is unchanged; only the window
    // moved). Framework-managed bookkeeping, so per ARCHITECTURE.md's third
    // DOM-write rule it gets no `TreeOptions` field and no public setter.
    private _flatRowsDirty      : boolean                                                 = false;
    private _lastRowWidth       : number                                                  = 0;
    // Widest row content measured so far across the current flattened set. Only
    // the *visible* window is measured each frame, so tracking a running maximum
    // keeps the horizontal content width — and thus the H scrollbar — stable as
    // different-width rows scroll through the window, instead of jittering with
    // whatever happens to be on screen. Reset in `_flatten` when the row set is
    // rebuilt, so a narrower dataset (or a collapsed wide branch) re-derives it.
    private _maxContentWidth    : number                                                  = 0;
    private _selectedNodes      : Set<TreeNode>                                           = new Set();
    // A lazy node has at most one load in flight, its entry in
    // `_pendingLoads`, and every reveal and expand that needs the node's
    // children meanwhile waits on it. Each load takes a seq from `_loadSeq`,
    // the `AbstractStore.load` token shape applied per load, and commits only
    // if its node's entry still holds that seq when it settles. `setNodes`
    // clears every entry, and removing a node or taking over its children
    // deletes its entry, which orphans the load. `_loadingNodes` holds each
    // node whose load an expand is waiting on: the node shows a spinner, and
    // its load commits the expansion along with the children.
    private _loadSeq            : number                                                  = 0;
    private _loadingNodes       : Set<TreeNode>                                           = new Set();
    private _loadedNodes        : Set<TreeNode>                                           = new Set();
    private _pendingLoads       : Map<TreeNode, PendingLoad>                              = new Map();
    // Bumped by every change to which nodes the tree holds: `setNodes`, the
    // structural calls, and a lazy load committing a node's children.
    // `revealByPredicate` compares it after each await, the way `_loadSeq` is
    // compared, to learn that the sibling arrays it is walking may have been
    // spliced or replaced, or that children arrived under a node it passed.
    private _structureGeneration: number                                                  = 0;
    private _anchorNode         : TreeNode | null                                         = null;
    private _focusNode          : TreeNode | null                                         = null;
    private _listeners          : ListenerBag<TreeEvent>                                  = this.registerListenerBag(new ListenerBag<TreeEvent>());
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
     *
     * @remarks
     * Every visible row is force-rebound, even one whose node happens to keep
     * the same identity and `isBoundTo`-tracked flags across the call — a
     * caller may hand back the same (possibly in-place-mutated) node objects
     * specifically to pick up a content change (e.g. a relabel), and
     * `isBoundTo` has no way to see a mutation to a node it already holds a
     * reference to. `setRendererFactory` forces a rebind the same way and for
     * the same class of reason: fresh content `isBoundTo`'s eight compared
     * values cannot detect.
     *
     * To change part of the tree without resetting the rest, use
     * {@link insertNode}, {@link removeNode} or {@link setChildren}; to
     * repaint one node changed in place, use {@link notifyNodeChanged}.
     */
    setNodes(nodes: TreeNode[]): this {
        this._nodes = nodes;
        this._structureGeneration += 1;
        this._expandedNodes.clear();
        this._selectedNodes.clear();
        this._loadingNodes.clear();
        this._loadedNodes.clear();
        this._pendingLoads.clear();
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
     * Inserts `node` among `parent`'s children at `index`, keeping every other
     * node's expansion, selection, lazy-load state and the scroll offset.
     *
     * @param parent - The node to insert under, or `null` for the root level.
     * @param index - The position among `parent`'s children, clamped to
     *   `[0, length]`: a negative index prepends, one past the end appends.
     * @param node - A node this tree does not already hold. It starts
     *   collapsed and unselected.
     *
     * @returns This tree, for method chaining.
     *
     * @remarks
     * Writes into the array the tree already holds — `parent.children`
     * (created when absent) or the root array — so {@link getNodes} and
     * `parent.children` show the insert. Emits no event. A lazy `parent`
     * counts as loaded afterwards; see {@link setChildren}.
     */
    insertNode(parent: TreeNode | null, index: number, node: TreeNode): this {
        const siblings = this._childrenOf(parent);
        const at       = Math.max(0, Math.min(index, siblings.length));

        siblings.splice(at, 0, node);
        this._commitStructureChange(parent);

        return this;
    }

    /**
     * Removes `node`, and every node under it, from the tree.
     *
     * @param node - The node to remove, at any depth. A node this tree does
     *   not hold is ignored.
     *
     * @returns This tree, for method chaining.
     *
     * @remarks
     * The removed nodes leave the expanded, selected and loaded sets; the
     * anchor and focus are cleared when either was among them; a lazy load in
     * flight for one of them is dropped and its `expandNodeAsync` promise
     * resolves `false`. No event fires — not `"selection"` when a selected
     * node goes, not `"collapse"` when an expanded one does — because, as with
     * {@link selectNode}, the caller made the change. Read
     * {@link getSelectedNodes} afterwards when the new selection matters.
     */
    removeNode(node: TreeNode): this {
        const location = this._locate(node);

        if (location === null) {
            return this;
        }

        location.siblings.splice(location.index, 1);
        this._commitStructureChange(location.parent);

        return this;
    }

    /**
     * Replaces `parent`'s children with `children`, keeping the state of
     * every node the tree still holds afterwards.
     *
     * @param parent - The node whose children to replace, or `null` for the
     *   root level.
     * @param children - The new child list, stored by reference. Pass the
     *   same node object for an entry that survives: it keeps its expansion,
     *   its loaded children and its selection. A new object starts collapsed
     *   and unselected. An object left out is removed as by
     *   {@link removeNode}.
     *
     * @returns This tree, for method chaining.
     *
     * @remarks
     * Unlike {@link setNodes}, which resets the whole tree,
     * `setChildren(null, roots)` replaces the root list and keeps every
     * surviving node's state.
     *
     * The caller owns `parent`'s children from here on: a lazy `parent`
     * counts as loaded, so expanding it never calls `loadChildren`, and a
     * load already in flight for it is dropped — its result is discarded and
     * its `expandNodeAsync` promise resolves `false`. {@link insertNode} and
     * {@link removeNode} treat the parent they change the same way. Emits no
     * event.
     */
    setChildren(parent: TreeNode | null, children: TreeNode[]): this {
        if (parent === null) {
            this._nodes = children;
        } else {
            parent.children = children;
        }

        this._commitStructureChange(parent);

        return this;
    }

    /**
     * Re-renders `node`'s row after the caller changed the node in place —
     * its `label`, its `data` (which a renderer such as
     * [`IconLabelTreeNodeRenderer`](/api/component/tree/classes/IconLabelTreeNodeRenderer)
     * may read to pick an icon), or `hasChildren`.
     *
     * @param node - The node that changed.
     *
     * @returns This tree, for method chaining.
     *
     * @remarks
     * Only a row currently showing `node` is rebuilt. A node with no row on
     * screen needs nothing: it renders its current fields whenever it next
     * scrolls into view. A change to `children` is not covered — use
     * {@link setChildren}, which also keeps the tree's state in step. Emits
     * no event.
     */
    notifyNodeChanged(node: TreeNode): this {
        let found = false;

        for (let slot = 0; slot < this._rowPool.length; slot++) {
            if (this._boundIndices[slot] >= 0 && this._rowPool[slot].getNode() === node) {
                // Forced-rebind sentinel, read by `_bindAndMeasure`: `isBoundTo`
                // cannot see a change to a node the row already holds.
                this._boundIndices[slot] = -1;
                found = true;
            }
        }

        if (found) {
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
     * load every branch it visits, it is O(nodes) and waits on one
     * `loadChildren` per unloaded branch it descends; call it for a deliberate
     * "jump to this object" action, not on a hot path. That cost is for a
     * tree nothing else changes meanwhile: every change the walk does not own
     * — a structural call, or another reveal's or an expand's load committing
     * — restarts every level it has open and re-descends what it already
     * searched, about O(depth × visited) more per change.
     *
     * Revealing is not selecting: this method does not change the selection or
     * emit `"selection"`. Select the returned node with {@link selectNode} if the
     * reveal should also highlight it. It likewise expands ancestors without
     * emitting `"expand"` — read {@link getExpandedNodes} afterwards.
     *
     * The search is depth-first in root-then-child order and, for a tree
     * nothing else changes while it runs, stops at the first match. A lazy
     * branch whose `loadChildren` rejects is skipped (its subtree is treated
     * as empty) and the walk continues; the failure is not surfaced here (no
     * `"loaderror"` is emitted for it, unless an expand is waiting on the
     * same load, as below).
     *
     * A node has at most one lazy load in flight, which the walk shares with
     * every expand (a caret click, {@link expandNode}, {@link expandNodeAsync})
     * and every other reveal that needs the node's children: whichever needs
     * them first calls `loadChildren`, and the rest wait on that one call.
     * The children it resolves to are committed once. When an expand is
     * waiting on the call as it settles, a resolve also commits the expansion
     * and fires `"expand"` once, and a rejection fires `"loaderror"` once and
     * leaves the node collapsed and unloaded. Neither depends on whether the
     * walk or the expand started the call.
     *
     * The walk follows an {@link insertNode}, {@link removeNode},
     * {@link setChildren} or {@link setNodes} made while it waits on a load:
     * every level it still has open re-reads its live children and searches
     * them again from the first, innermost level first. It does not search
     * afresh, though — a node it has already tested is passed over untested,
     * and only descended into. So it still finds a matching node added
     * anywhere, including under a branch it has already searched, or under a
     * node whose children a later load commits after the load it waited on
     * for that node failed. It never returns, expands, or caches loaded
     * children for a node the tree no longer holds. The one node it forgets
     * having tested is one the tree dropped while its load was in flight,
     * since nothing was loaded for it: should that node come back, it is
     * tested and loaded afresh.
     *
     * Three limits follow. After `setNodes` the walk carries on over the new
     * roots, from the first, but a root object it has already tested is still
     * passed over — so a reveal running across the refresh idiom `setNodes`
     * documents, the same node objects handed back with changed `data`, can
     * resolve `null` with a match in the tree. A restarted level finishes
     * before the restart reaches its ancestors, so the match need not be the
     * depth-first-earliest one: with roots `[A[a1], B[b1, b2]]`, an
     * `insertNode(A, 1, X)` made while `b1`'s load is in flight returns a
     * matching `b2` rather than the earlier `X`. And the walk waits only on
     * the loads it started or joined, so a node retried after its own load
     * failed — by a `"loaderror"` listener, say — is picked up only if the
     * retry commits while the walk is still running; one committing after it
     * has run out of levels leaves its `null` standing.
     *
     * @param predicate - Tested against each node's `data` payload (and the node
     *   itself); return `true` for the node to reveal. It must not change the
     *   tree: one that removes the node it matched leaves the reveal with no
     *   path to expand, and throws.
     *
     * @returns A promise resolving to the revealed {@link TreeNode}, or `null`.
     */
    async revealByPredicate(predicate: (data: unknown, node: TreeNode) => boolean): Promise<TreeNode | null> {
        return this._revealFirstMatch(null, { predicate, visited: new Set(), ownCommits: 0 });
    }

    /**
     * Searches `parent`'s children, and the subtree under each, depth-first
     * for the first node satisfying the walk's predicate, and reveals it.
     * Loads each lazy branch it reaches so it can search the subtree beneath.
     *
     * @param parent - The node whose children to search, or `null` for the roots.
     * @param walk - The state every level of this reveal shares.
     *
     * @returns The revealed node, or `null` when nothing under `parent`
     *   matches, or `parent` has left the tree.
     *
     * @remarks
     * The children are read from the live array — the root array or
     * `parent.children` — at every step, never from a copy, because a
     * structural call during an await below may splice or replace it. After
     * an await, a changed `_structureGeneration` tells the walk that the tree
     * changed — the same post-await check `_settleLoad` and
     * `AbstractStore.load` make with their load seqs. The bumps made by the
     * loads the walk waited on, whether it started each one or joined it, are
     * left out, because each only filled in the children of the node it was
     * about to search beneath. The walk then stops when `parent` has left the
     * tree, and otherwise starts this level again from its first child. A
     * visited node is passed over untested but still descended into, so the
     * walk finds a node inserted under a branch it already searched, or loaded
     * under a node it passed. A node removed ahead of the walk is never
     * reached.
     *
     * The match is revealed in the same synchronous step that tested it, so
     * the path expanded is the tree's live path to it: no structural call can
     * run between the two.
     */
    private async _revealFirstMatch(parent: TreeNode | null, walk: RevealWalk): Promise<TreeNode | null> {
        const externalGeneration = (): number => this._structureGeneration - walk.ownCommits;

        let generation = externalGeneration();
        let index      = 0;

        for (;;) {
            if (generation !== externalGeneration()) {
                if (parent !== null && this._locate(parent) === null) {
                    return null;
                }

                generation = externalGeneration();
                index      = 0;
            }

            const siblings = parent === null ? this._nodes : (parent.children ?? []);

            if (index >= siblings.length) {
                return null;
            }

            const node = siblings[index];

            index += 1;

            if (!walk.visited.has(node)) {
                const match = await this._testAndLoad(node, walk);

                if (match !== null) {
                    return match;
                }

                // The node may have left this level: restart it before descending.
                if (generation !== externalGeneration()) {
                    continue;
                }
            }

            if (node.children && node.children.length > 0) {
                const found = await this._revealFirstMatch(node, walk);

                if (found !== null) {
                    return found;
                }
            }
        }
    }

    /**
     * Tests a node the walk has not tested yet, revealing it on a match, and
     * otherwise loads its children so the walk can search beneath it.
     *
     * @param node - The node the walk has reached.
     * @param walk - The state every level of this reveal shares.
     *
     * @returns `node`, already revealed, when it matches; `null` otherwise.
     *
     * @remarks
     * The node joins the walk's visited set up front, so no later level or
     * restart tests or loads it again. It leaves the set again when the load
     * was dropped with nothing committed for the node: should the node come
     * back, it is then tested and loaded afresh.
     *
     * The match is revealed here, in the same synchronous step that tested
     * it, so the path expanded is the tree's live path to it.
     */
    private async _testAndLoad(node: TreeNode, walk: RevealWalk): Promise<TreeNode | null> {
        walk.visited.add(node);

        if (walk.predicate(node.data, node)) {
            this._expandPathTo(node);

            return node;
        }

        if (!(await this._ensureChildrenLoaded(node, walk))) {
            walk.visited.delete(node);
        }

        return null;
    }

    /**
     * Expands every ancestor of `node` so its row enters the flattened set,
     * then scrolls it into view. `node`'s own children stay as they are.
     *
     * @param node - A node the tree holds.
     */
    private _expandPathTo(node: TreeNode): void {
        // Never null. The walk read `node` from the live children of a level,
        // in the same synchronous step, and last confirmed that level is in
        // the tree after an await. Anything that has detached a node since
        // bumped `_structureGeneration` and sent the walk back to confirm it
        // again. The only bumps the walk skips are those of the loads it
        // waited on, and those only fill in a node's absent or empty children.
        // A fallback here would only hide a break in that rule.
        const { path } = this._locate(node)!;

        for (let i = 0; i < path.length - 1; i++) {
            this._expandedNodes.add(path[i]);
        }

        this._reflattenAndRender();

        const index = this._flatRows.findIndex(r => r.node === node);

        if (index >= 0) {
            this._scrollIntoView(index);
        }
    }

    /**
     * Loads and caches a lazy, unloaded node's children before a reveal
     * searches beneath it, waiting on the node's one load through
     * {@link _loadLazy}: the reveal joins the load already in flight, whether
     * an expand or another reveal started it, or starts one. It does not
     * expand the node — a reveal only expands the ancestors on the path to its
     * match. A rejected load counts as an empty subtree.
     *
     * @param node - The node the reveal is about to search beneath.
     * @param walk - The reveal waiting on the load, which counts the commit's
     *   generation bump as its own.
     *
     * @returns `false` when the node is unloaded because the tree dropped it
     *   while its load was in flight — a structural call removed it, or
     *   `setNodes` replaced every node — so nothing was loaded for it; `true`
     *   otherwise.
     *
     * @remarks
     * A dropped load commits nothing, even when the node was put back
     * meanwhile, since `_pruneDetachedState` dropped its state then. A
     * structural call that took over the node's children drops the load too,
     * but marks the node loaded, so the walk searches the children the caller
     * supplied without testing the node again.
     */
    private async _ensureChildrenLoaded(node: TreeNode, walk: RevealWalk): Promise<boolean> {
        // Not `TreeNode.hasChildren`, the caret flag: the walk only needs to
        // know whether there is already a child array to search.
        const holdsChildren = node.children !== undefined && node.children.length > 0;

        if (holdsChildren || node.loadChildren === undefined || this._loadedNodes.has(node)) {
            return true;
        }

        const { outcome } = await this._loadLazy(node);

        if (outcome === "loaded") {
            walk.ownCommits += 1;
        }

        return outcome !== "dropped" || this._loadedNodes.has(node);
    }

    /**
     * Registers a listener for one of this tree's events.
     *
     * @param event - `"selection"` fires whenever a click or key press
     *   changes the selection, receiving the full array of selected
     *   {@link TreeNode} instances. Programmatic changes do not fire it:
     *   {@link selectNode}, {@link setNodes}, or a {@link removeNode} /
     *   {@link setChildren} that drops a selected node.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This tree, for method chaining.
     */
    on(event: "selection", listener: (nodes: TreeNode[]) => void): this;

    /**
     * Registers a listener for a lazy node's failed child load.
     *
     * @param event - `"loaderror"` fires when a node's `loadChildren` rejects
     *   while an expand (a caret click, `expandNode`, `expandNodeAsync`) is
     *   waiting on it — once, however many expands and `revealByPredicate`
     *   calls share the node's load, and whichever of them started it. The
     *   node stays collapsed and unloaded so toggling again retries with a
     *   fresh `loadChildren` call. A rejection no expand was waiting on fires
     *   nothing.
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
     *   toggle was first requested — once, however many expands and
     *   `revealByPredicate` calls share the node's load, and whichever of
     *   them started it. It never fires from `setNodes`, `expandAll`, or
     *   `revealByPredicate`, nor from `insertNode`, `removeNode` or
     *   `setChildren` — a lazy load one of those drops fires nothing; a
     *   rejected lazy load fires only `"loaderror"` instead.
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
     *   `expandAll`, or `revealByPredicate`, nor when `removeNode` or
     *   `setChildren` removes an expanded node.
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

        // Renderer identity isn't part of TreeRow.isBoundTo's comparison, so
        // every row needs a real rebind here — see "setRendererFactory keeps
        // its blanket invalidation" in plans/implemented/tree-row-toggle-rebind-perf.md.
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
        this._flatRowsDirty = true;

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
     * Re-flattens the visible subtree and re-renders; the render pass first
     * re-matches pool slots to nodes by identity, then rebinds only the slots
     * whose content — per `TreeRow.isBoundTo` — actually changed.
     *
     * @remarks
     * Called from the collapse path, the synchronous expand path, and the async
     * load path — anywhere the flattened-row set or a node's loading affordance
     * changes.
     */
    private _reflattenAndRender(): void {
        this._flatten();
        this.renderWindow();
    }

    /**
     * Returns the array holding `parent`'s children — the root array for
     * `null` — first giving a node with no `children` an empty one.
     *
     * @param parent - The node whose child array to return, or `null`.
     * @returns The live array the tree reads when flattening.
     */
    private _childrenOf(parent: TreeNode | null): TreeNode[] {
        if (parent === null) {
            return this._nodes;
        }

        if (parent.children === undefined) {
            parent.children = [];
        }

        return parent.children;
    }

    /**
     * Finds where `node` sits: the root array first, then every node's
     * `children`, depth-first, collapsed branches included.
     *
     * @param node - The node to find.
     * @returns The node's location, or `null` when this tree does not hold it.
     *
     * @remarks
     * The one search the tree makes for a single node, so every caller reads
     * what it needs off one walk: {@link removeNode} the holding array and
     * index, {@link _expandPathTo} the path, and the reveal's walk the
     * `null` alone, to learn that a level has left the tree.
     */
    private _locate(node: TreeNode): NodeLocation | null {
        const ancestors: TreeNode[] = [];

        const search = (parent: TreeNode | null, siblings: TreeNode[]): NodeLocation | null => {
            const index = siblings.indexOf(node);

            if (index >= 0) {
                return { parent, siblings, index, path: [...ancestors, node] };
            }

            for (const child of siblings) {
                if (child.children === undefined) {
                    continue;
                }

                ancestors.push(child);

                const found = search(child, child.children);

                if (found !== null) {
                    return found;
                }

                ancestors.pop();
            }

            return null;
        };

        return search(null, this._nodes);
    }

    /**
     * Collects every node reachable from the root array through `children`,
     * whether or not its ancestors are expanded.
     *
     * @returns The reachable nodes.
     */
    private _reachableNodes(): Set<TreeNode> {
        const reachable = new Set<TreeNode>();

        const walk = (nodes: TreeNode[]): void => {
            for (const node of nodes) {
                reachable.add(node);

                if (node.children) {
                    walk(node.children);
                }
            }
        };

        walk(this._nodes);

        return reachable;
    }

    /**
     * Drops every piece of per-node state held for a node the tree no longer
     * holds: expanded, selected, loading and loaded membership, a load in
     * flight, and the anchor or focus. Dropping a load orphans it the same way
     * `setNodes` does.
     */
    private _pruneDetachedState(): void {
        const reachable = this._reachableNodes();

        for (const set of [this._expandedNodes, this._selectedNodes, this._loadingNodes, this._loadedNodes]) {
            for (const node of set) {
                if (!reachable.has(node)) {
                    set.delete(node);
                }
            }
        }

        for (const node of this._pendingLoads.keys()) {
            if (!reachable.has(node)) {
                this._pendingLoads.delete(node);
            }
        }

        if (this._anchorNode !== null && !reachable.has(this._anchorNode)) {
            this._anchorNode = null;
        }

        if (this._focusNode !== null && !reachable.has(this._focusNode)) {
            this._focusNode = null;
        }
    }

    /**
     * Hands `parent`'s children to the caller: drops a lazy load in flight
     * for it and records a lazy `parent` as loaded. No-op for the root level.
     *
     * @param parent - The node a structural call just changed, or `null`.
     */
    private _supersedeLoad(parent: TreeNode | null): void {
        if (parent === null) {
            return;
        }

        this._loadingNodes.delete(parent);
        this._pendingLoads.delete(parent);

        if (parent.loadChildren !== undefined) {
            this._loadedNodes.add(parent);
        }
    }

    /**
     * The shared tail of `insertNode`, `removeNode` and `setChildren`, run
     * after the child array has been changed.
     *
     * @param parent - The node whose children changed, or `null` for the root level.
     *
     * @remarks
     * `_supersedeLoad` runs before `_pruneDetachedState`, so a `parent` that
     * is itself no longer in the tree is removed from `_loadedNodes` again.
     * `_updateActiveDescendant` runs after the render, when the focused
     * node's row is bound.
     */
    private _commitStructureChange(parent: TreeNode | null): void {
        this._structureGeneration += 1;
        this._supersedeLoad(parent);
        this._pruneDetachedState();
        this._reflattenAndRender();
        this._updateActiveDescendant();
    }

    /**
     * Attaches the children a lazy load fetched for `node` and records the
     * node as loaded. Bumps `_structureGeneration`, since the tree now holds
     * nodes it did not, so a running reveal that passed `node` goes back for
     * them.
     *
     * @param node - The node whose load settled.
     * @param children - The children its `loadChildren` resolved to.
     *
     * @remarks
     * A load starts only for a node with absent or empty children, and
     * commits only while it still holds the node's entry, which a structural
     * call that supplied the children would have deleted, so the commit never
     * detaches a node the tree held.
     */
    private _commitLoadedChildren(node: TreeNode, children: TreeNode[]): void {
        node.children = children;
        this._loadedNodes.add(node);
        this._structureGeneration += 1;
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
     *   and the node stayed collapsed, or was dropped before it settled.
     *
     * @remarks
     * A node has at most one lazy load in flight. A call for a node whose
     * load is already in flight — started by an earlier call, a caret click,
     * {@link expandNode} or {@link revealByPredicate} — joins that load
     * instead of starting another, and resolves with its outcome. Emits
     * `"expand"` on a real transition, the same as {@link expandNode}: once,
     * however many callers share the load.
     *
     * {@link setNodes}, and an {@link insertNode}, {@link removeNode} or
     * {@link setChildren} that takes over the node's children or drops the
     * node, drops its load: it commits nothing, and every call waiting on it
     * resolves `false` once the dropped `loadChildren` call settles — the
     * tree stops acting on that call, not waiting on it. A loader that makes
     * one of those calls itself drops its own load the same way. A node removed while its load
     * was in flight and then inserted again, or handed back to `setNodes`, is
     * a new node: its next expand starts a fresh load.
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
     * behaviour, via {@link _loadLazy}) used by every other caller.
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
            return this._loadAndExpand(node);
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
     * Joins `node`'s lazy load in flight, or starts one, so every reveal and
     * expand that needs the node's children meanwhile waits on a single
     * `loadChildren` call.
     *
     * @param node - A lazy node with absent or empty children that has not
     *   loaded.
     *
     * @returns The settled load, one promise shared by every caller waiting
     *   on the load.
     */
    private _loadLazy(node: TreeNode): Promise<SettledLoad> {
        const inFlight = this._pendingLoads.get(node);

        if (inFlight !== undefined) {
            return inFlight.settled;
        }

        const seq = ++this._loadSeq;

        // The entry goes in before the loader runs, so a loader that calls
        // back into the tree synchronously — `setChildren` for a "Loading…"
        // placeholder, `removeNode`, `setNodes` — finds this load to drop,
        // exactly as one doing it after an `await` would, and a loader that
        // expands its own node joins this load instead of starting a second
        // one. `settled` is therefore handed out before `_settleLoad` exists
        // to supply it, and takes that over once the loader has been called.
        let supply!: (outcome: Promise<SettledLoad>) => void;
        const settled = new Promise<SettledLoad>((resolve) => { supply = resolve; });

        this._pendingLoads.set(node, { seq, settled });

        // The wrapper turns a loader that throws instead of rejecting into a
        // rejection, so the load always settles.
        const request = new Promise<TreeNode[]>((resolve) => {
            resolve(node.loadChildren!());
        });

        supply(this._settleLoad(node, seq, request));

        return settled;
    }

    /**
     * Loads a lazy node's children, then commits its expansion.
     *
     * @param node - The lazy node to load and expand.
     *
     * @returns `true` when the node's expansion committed, `false` when the
     *   load failed or was orphaned by a `setNodes` swap or a structural call.
     *
     * @throws unknown - What a renderer or an `"expand"`/`"loaderror"`
     *   listener threw while the load committed; the commit itself has
     *   already happened.
     *
     * @remarks
     * Marks the node loading, which drives its spinner affordance and has the
     * load commit the expansion as it settles (see {@link _settleLoad}), then
     * waits on the node's one load through {@link _loadLazy}. It joins the
     * load when an expand or a reveal already started it, so a second caller
     * never triggers a second `loadChildren`, and every expand waiting on the
     * load resolves with its outcome, or rethrows what the commit threw.
     */
    private async _loadAndExpand(node: TreeNode): Promise<boolean> {
        this._loadingNodes.add(node);
        this._reflattenAndRender();

        const { outcome, thrown } = await this._loadLazy(node);

        if (thrown !== null) {
            throw thrown.error;
        }

        return outcome === "loaded";
    }

    /**
     * Settles `node`'s lazy load once `request`, its `loadChildren` call, has,
     * committing the outcome once for every reveal and expand waiting on it.
     *
     * @param node - The lazy node being loaded.
     * @param seq - This load's token from `_loadSeq`.
     * @param request - The node's `loadChildren` call.
     *
     * @returns How the load ended.
     *
     * @remarks
     * The load commits only while its node's entry in `_pendingLoads` still
     * holds its seq. `setNodes`, `_pruneDetachedState` and `_supersedeLoad`
     * delete the entry when they drop the node or take over its children, so
     * an orphaned load commits nothing, even when the node is back in the tree
     * and a newer load holds its entry.
     *
     * Otherwise it commits before any caller resumes, so the outcome does not
     * depend on which caller started the load or resumes first.
     * {@link _settleResolvedLoad} and {@link _settleFailedLoad} own the two
     * commit paths. Which one runs is decided by a flag the `catch` sets, not
     * by the resolved value, so a loader that resolves `null` or `undefined`
     * — which only an untyped caller can do, the signature promising an array
     * — counts as resolving with no children rather than as a failure.
     */
    private async _settleLoad(node: TreeNode, seq: number, request: Promise<TreeNode[]>): Promise<SettledLoad> {
        let children: TreeNode[] = [];
        let failure: unknown = null;
        let failed = false;

        try {
            // `?? []`: only a rejection is a failure, so an untyped caller's
            // resolved `null` or `undefined` is a resolve with no children.
            children = (await request) ?? [];
        } catch (error) {
            failure = error;
            failed  = true;
        }

        if (this._pendingLoads.get(node)?.seq !== seq) {
            return { outcome: "dropped", thrown: null };
        }

        this._pendingLoads.delete(node);

        // Every expand waiting on the load marked the node loading.
        const expanding = this._loadingNodes.delete(node);

        return failed
            ? this._settleFailedLoad(node, failure, expanding)
            : this._settleResolvedLoad(node, children, expanding);
    }

    /**
     * Settles a load whose `loadChildren` rejected, leaving the node
     * collapsed and unloaded so the next expand or reveal starts a fresh one.
     *
     * @param node - The node whose load failed.
     * @param failure - What its `loadChildren` rejected with.
     * @param expanding - Whether an expand was waiting on the load.
     *
     * @returns The settled load, as every reveal and expand waiting on it
     *   sees it.
     *
     * @remarks
     * A failure answers only an expand: it renders the row back from the
     * spinner to a caret and emits `"loaderror"`. A load only reveals waited
     * on left nothing to repaint, so it renders nothing and fires nothing.
     */
    private _settleFailedLoad(node: TreeNode, failure: unknown, expanding: boolean): SettledLoad {
        if (!expanding) {
            return { outcome: "failed", thrown: null };
        }

        // Render before emitting, as the resolved path does: the row is back
        // to a caret before any listener runs, so one that throws cannot
        // leave the spinner on screen.
        const thrown = this._captureThrow(() => {
            this._reflattenAndRender();
            this.emit("loaderror", node, failure);
        });

        return { outcome: "failed", thrown };
    }

    /**
     * Settles a load whose `loadChildren` resolved: the children are
     * attached, the node counts as loaded, and the rows are rebuilt.
     *
     * @param node - The node whose load resolved.
     * @param children - The children it resolved to. An empty array is a
     *   success, leaving an expanded, empty parent.
     * @param expanding - Whether an expand was waiting on the load, in which
     *   case the commit also expands the node and emits `"expand"`.
     *
     * @returns The settled load, as every reveal and expand waiting on it
     *   sees it.
     *
     * @remarks
     * The render runs whether or not an expand is waiting, because the
     * committed children change what the node's own row draws: a lazy node
     * declared without `hasChildren: true` gains its caret here, and a reveal
     * commits without expanding anything. The `"expand"` emission is the last
     * thing, after the render, so a listener sees the loaded children already
     * flattened.
     *
     * Both run consumer code — renderers and listeners — after the state is
     * committed, so what they throw is recorded in the result rather than
     * rejecting the promise every waiter shares (see
     * {@link SettledLoad.thrown}). With no expand waiting there is nobody to
     * rethrow it to, and it is dropped.
     */
    private _settleResolvedLoad(node: TreeNode, children: TreeNode[], expanding: boolean): SettledLoad {
        this._commitLoadedChildren(node, children);

        if (expanding) {
            this._expandedNodes.add(node);
        }

        const thrown = this._captureThrow(() => {
            this._reflattenAndRender();

            if (expanding) {
                this.emit("expand", node);
            }
        });

        return { outcome: "loaded", thrown };
    }

    /**
     * Runs `step` and returns what it threw, boxed, instead of letting it
     * propagate. {@link _settleLoad} runs its render and event emission this
     * way, so consumer code that throws cannot reject the load every reveal
     * and expand waiting on it shares.
     *
     * @param step - The work to run.
     *
     * @returns What `step` threw, boxed so a thrown `undefined` still counts,
     *   or `null` when it returned normally.
     */
    private _captureThrow(step: () => void): { error: unknown } | null {
        try {
            step();

            return null;
        } catch (error) {
            return { error };
        }
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
        if (SpatialNavigation.claimsKey(e)) { return; }

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

            // Per-node ephemeral selection/focus styling on a pooled row
            // re-bound to a different node on every render: `setStyleState`
            // toggles the shared `.TreeRow.selected`/`.TreeRow.focused`
            // class-tier rules (see `TreeRow.ownStyleStates`, which also
            // carries the `outline-offset` sibling) via a DOM class token,
            // so nothing here persists into `_instanceStyle` to replay onto
            // the next node bound to this reused row.
            row.setStyleState(".selected", isSelected);
            row.setStyleState(".focused", isFocused);

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

        // A pure scroll leaves `_flatRows` untouched, so every slot's node shifts
        // by the same amount and the base's rotation is the cheapest correct
        // answer. A reflatten moves rows by differing amounts either side of the
        // change point, so which slot keeps which node has to be resolved by node
        // identity instead.
        if (this._flatRowsDirty) {
            this._flatRowsDirty = false;

            this.reconcilePoolByKey(
                win.firstRow,
                win.windowSize,
                (dataIndex) => this._flatRows[dataIndex].node,
                (slot) => this._rowPool[slot].getNode(),
            );
        } else {
            this.alignPoolWindow(win.firstRow);
        }

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
        const widthChanged = rowWidth !== this._lastRowWidth;

        if (widthChanged) {
            this._lastRowWidth = rowWidth;
            this.invalidateGeom();
        }

        // While a live pane resize keeps moving the row width, each row's children
        // keep the layout the previous pass gave them; the settle pass catches them up.
        const deferChildLayout = this.deferRowLayoutWhileResizing(widthChanged);

        this._positionRows(win.firstRow, win.windowSize, rowWidth, reboundFlags, deferChildLayout);
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
            const selected    = this._selectedNodes.has(flatRow.node);

            // `_boundIndices[i] === -1` is the forced-rebind sentinel a caller
            // sets when a slot's cached binding cannot be trusted regardless of
            // content identity — none of these cases are visible to
            // `isBoundTo`'s eight compared values: a freshly grown slot
            // (`growRowPool`) or a freshly-hidden one (`hideExcessPoolRows`);
            // `setRendererFactory`, whose fresh renderer has no cached icon or
            // label text; `setNodes`, whose caller may hand back the very same
            // (possibly in-place-mutated) node objects specifically to pick up
            // a content change; `notifyNodeChanged`, which forces only the
            // slots showing a node its caller changed in place; and the
            // inherited `VirtualRowView.onThemeReflow`, whose font swap can
            // change every row's measured content without touching any of the
            // eight values. Without this check, `isBoundTo` alone would report
            // an untouched-looking row as unchanged — its node/depth/etc. really
            // are identical — and silently skip the real `setRowData` call one
            // of these cases actually needs.
            const wasRebound = this._boundIndices[i] === -1
                || !row.isBoundTo(flatRow.node, flatRow.depth, hasChildren, expanded, flatRow.siblingCount, flatRow.posInSet, selected, loading);

            if (wasRebound) {
                row.setRowData(flatRow.node, flatRow.depth, hasChildren, expanded, flatRow.siblingCount, flatRow.posInSet, selected, loading);
            }

            this._boundIndices[i] = dataIndex;
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
     * when the row was rebound, or when its geometry changed and no live
     * resize is withholding the pass.
     *
     * @param firstRow - The first data index covered by the visible window.
     * @param windowSize - The number of rows in the window.
     * @param rowWidth - The horizontal extent of each row in pixels.
     * @param reboundFlags - The per-slot rebind flags produced by {@link _bindAndMeasure}.
     * @param deferChildLayout - Whether a live resize is withholding the
     *   width-driven child relayout this pass.
     */
    private _positionRows(firstRow: number, windowSize: number, rowWidth: number, reboundFlags: boolean[], deferChildLayout: boolean): void {
        for (let i = 0; i < windowSize; i++) {
            const row        = this._rowPool[i];
            const dataIndex  = firstRow + i;
            const wasRebound = reboundFlags[i];

            const geomChanged = this.positionRow(i, dataIndex * ROW_HEIGHT, rowWidth);

            if (wasRebound || (geomChanged && !deferChildLayout)) {
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
        Event.addSubtreeListener(this, "contextmenu", this._handleContextMenu);
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
