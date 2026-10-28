// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Container } from "~/core/Container.js";
import { Window } from "~/overlay/Window.js";
import { AbstractWindow } from "~/overlay/AbstractWindow.js";
import { TabWindow } from "~/overlay/TabWindow.js";
import { Split } from "~/layout/Split.js";
import { Tab } from "~/layout/Tab.js";
import type { TabDetachWindowMode } from "~/layout/Tab.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { normalizeRatios } from "~/layout/LayoutSizes.js";
import type { AxisOrientation } from "~/primitive/Axis.js";

/**
 * Captures and restores the **arrangement** of the recognised container
 * managers — {@link Split} pane ratios, {@link Tab} order + active index, and
 * floating [`Window`](/api/overlay/classes/Window) rects + state — keyed by stable
 * panel IDs. It does **not** serialize the component tree: leaf content is an
 * arbitrary {@link Component} subclass the framework cannot reconstruct from
 * data, so each leaf is recorded as a bare reference and supplied on restore by
 * a caller-owned {@link LayoutFactory}.
 *
 * @remarks Designed for runtime layout-switching: a caller holds several
 * {@link LayoutState} objects and calls {@link restoreLayout} with any of them
 * at any time. Restore uses a park-and-rebuild model — it parks the live leaf
 * panels (preserving their state), tears down and rebuilds the container tree
 * from the target state, then re-homes the leaves — so switching between
 * arbitrarily different topologies is correct without diff/patch heuristics.
 *
 * @module
 */

/**
 * Serializable rectangle for a {@link WindowNode}.
 *
 * @category Layouts
 */
export interface SerializedRect {
    x:      number;
    y:      number;
    width:  number;
    height: number;
}

/**
 * A recognised arrangement node, or an opaque content leaf.
 *
 * @category Layouts
 */
export type LayoutNode = PanelNode | SplitNode | TabNode;

/**
 * Leaf: a single content panel, keyed by its stable panel ID.
 *
 * @category Layouts
 */
export interface PanelNode {
    kind:    "panel";
    panelId: string;
    /**
     * Optional registry glyph name, captured from the leaf's
     * {@link LayoutConstraints.glyph} so a restored tab keeps its glyph (the
     * per-container constraint would otherwise be dropped by the re-home).
     */
    glyph?:  string | null;
    /** Captured from the leaf's {@link LayoutConstraints.tooltip}. */
    tooltip?: string | null;
    /** Captured from the leaf's {@link LayoutConstraints.closeable}. */
    closeable?: boolean;
    /** Captured from the leaf's {@link LayoutConstraints.disposeOnClose}. */
    disposeOnClose?: boolean;
    /** Captured from the leaf's {@link LayoutConstraints.italic}. */
    italic?: boolean;
    /** Captured from the leaf's {@link LayoutConstraints.modified}. */
    modified?: boolean;
}

/**
 * A {@link Split} container: orientation plus per-pane ratios and collapsed flags.
 *
 * @category Layouts
 */
export interface SplitNode {
    kind:        "split";
    orientation: AxisOrientation;
    /** Child arrangement nodes, in pane order. */
    children:    LayoutNode[];
    /** One ratio per child, in the same order; sums to ~1.0. */
    ratios:      number[];
    /** One collapsed flag per child, in the same order. */
    collapsed:   boolean[];
}

/**
 * A {@link Tab} container: ordered child nodes plus the active index.
 *
 * @category Layouts
 */
export interface TabNode {
    kind:        "tab";
    /**
     * Child arrangement nodes, in tab-strip order — the order the user sees,
     * which a drag reorder makes differ from the container's own child order.
     */
    children:    LayoutNode[];
    /**
     * Zero-based index, into `children`, of the active tab — `0` when no
     * captured child is the active one.
     */
    activeIndex: number;
}

/**
 * A floating window — a [`Window`](/api/overlay/classes/Window) or a
 * [`TabWindow`](/api/overlay/classes/TabWindow) — and the arrangement it hosts.
 * A dockable float carries a full region {@link content} tree (splits, tab
 * order, active tab); a legacy single-panel float carried only {@link panelId}.
 * A tab-strip window records `windowMode: "strip"`.
 *
 * @category Layouts
 */
export interface WindowNode {
    kind:        "window";
    /**
     * Legacy single-panel reference. Read on restore for backward-compat with
     * states written before floats became dockable; new states write
     * {@link content} instead.
     */
    panelId?:    string;
    /**
     * The float's internal arrangement — a region tree. Present in every
     * newly-serialized state; a single-frame float records a one-tab `tab` node.
     */
    content?:    LayoutNode;
    /**
     * The kind of window: `"strip"` for a
     * [`TabWindow`](/api/overlay/classes/TabWindow), whose tab strip is the
     * window, or `"bare"` for a header [`Window`](/api/overlay/classes/Window).
     * Omitted means `"bare"`. A save writes `"strip"`, with a `content` `tab`
     * node holding one child per tab, and omits the field for any other
     * window. A restore opens any other `"strip"` `content`, or a legacy
     * {@link panelId}, as the window's one tab. Uses the
     * {@link TabDetachWindowMode} vocabulary.
     */
    windowMode?: TabDetachWindowMode;
    /**
     * Title-bar text — captured so a restored `"bare"` window reproduces its
     * title. A `"strip"` window's title is its active tab's label, so a
     * restore does not read this.
     */
    header:      string;
    rect:        SerializedRect;
    state:       "normal" | "minimized" | "maximized";
    /** Normal-state geometry to restore to when un-minimizing; null when normal. */
    restoreRect: SerializedRect | null;
}

/**
 * Top-level captured layout: the in-root tree plus the orthogonal window plane.
 *
 * @category Layouts
 */
export interface LayoutState {
    /** Schema version for forward-compatible migration. */
    version: 1;
    /** The arrangement rooted at the serialized container. */
    root:    LayoutNode;
    /** Floating windows, captured separately from the root subtree. */
    windows: WindowNode[];
}

/**
 * Resolves a stable panel ID to the {@link Component} that supplies its content.
 *
 * **Contract:** the factory MUST return the **same Component instance** for a
 * given `panelId` on every call. Restoration parks and re-homes the live panel
 * rather than rebuilding it, so panel state (scroll, form values, table column
 * widths, selection) only survives a runtime layout switch when the factory
 * hands back the identical instance. Returning a fresh instance per call
 * discards that state and makes parking pointless. Return `null` for an ID the
 * caller no longer provides — that leaf is skipped (see {@link restoreLayout}).
 *
 * @category Layouts
 */
export type LayoutFactory = (panelId: string) => Component | null;

/**
 * Options for {@link serializeLayout} and {@link restoreLayout}.
 *
 * @category Layouts
 */
export interface LayoutSerializationOptions {
    /**
     * Decides which open windows belong to the layout's floating-window plane.
     * Called once for each open window that does not host `root`, when the call
     * starts and before anything is parked or closed. Return `true` to capture
     * the window (`serializeLayout`), or to park its leaves and close it
     * (`restoreLayout`). Default: every open
     * [`AbstractWindow`](/api/overlay/classes/AbstractWindow) except a host of
     * `root`.
     */
    includeWindow?: (win: AbstractWindow) => boolean;
    /**
     * Marks a component whose layout manager is a `Split` or `Tab` as a single
     * panel. Return `true` to record it as one `panel` node keyed by its id and
     * to park and re-home it whole on restore. Asked before the walk descends
     * into such a component; never asked about `root` or about a window.
     * Default: every `Split`- or `Tab`-managed component is an arrangement.
     */
    isPanel?: (component: Component) => boolean;
}

/**
 * Returns a container's arrangement-manager kind with the callable alias's
 * leading underscore stripped (`_Split` → `"Split"`), or `""` when the
 * component has no layout manager. String discrimination avoids importing the
 * manager classes purely for `instanceof`.
 *
 * @param component - The component whose manager to classify.
 * @returns `"Split"`, `"Tab"`, or another (opaque) manager name.
 */
function managerKind(component: Component): string {
    const manager = component.getLayoutManager();

    return manager ? manager.getClassName().replace(/^_/, "") : "";
}

/**
 * Whether the walk descends into a component as an arrangement: it carries a
 * `Split` or `Tab` manager and the caller's `isPanel` does not mark it as a
 * single panel. `isPanel` is asked only about such a component.
 *
 * @param component - A child the walk has reached.
 * @param options - The caller's options, if any.
 * @returns `true` to descend into it, `false` to treat it as a leaf.
 */
function isArrangement(component: Component, options: LayoutSerializationOptions | undefined): boolean {
    const kind = managerKind(component);

    return (kind === "Split" || kind === "Tab") && options?.isPanel?.(component) !== true;
}

/**
 * Builds the node for a child the walk has reached: its arrangement node when
 * it is one (see {@link isArrangement}), else a panel leaf.
 *
 * @param child - The child to capture.
 * @param options - The caller's options, if any.
 * @returns The child's node.
 */
function childNodeFor(child: Component, options: LayoutSerializationOptions | undefined): LayoutNode {
    return isArrangement(child, options) ? nodeFor(child, options) : panelNodeFor(child);
}

/**
 * Resolves a component's stable serialization ID as its {@link Component.getId}.
 * The id is the identity channel: callers that need a layout to round-trip across
 * reloads assign each leaf a stable id via `setId` (a volatile auto-generated id
 * round-trips within a session but not across one).
 *
 * @param component - The leaf component to identify.
 * @returns The component's id.
 */
function panelIdOf(component: Component): string {
    return component.getId();
}

/**
 * The positions, in `getComponents()` order, of the children that participate
 * in serialization. Positions rather than children, so a caller capturing
 * per-child geometry can read each kept child's ratio or collapsed flag at the
 * *live* index the layout manager indexes by, and write it at the kept index.
 *
 * @param component - The container whose children to filter.
 * @returns The indices of the non-transient children, in order.
 */
function serializableChildIndices(component: Component): number[] {
    const indices: number[] = [];

    component.getComponents().forEach((child, index) => {
        if (component.getLayoutConstraints(child)?.transient !== true) {
            indices.push(index);
        }
    });

    return indices;
}

/**
 * The children of a container that participate in serialization: every child
 * except those marked `transient` in their layout constraints. A transient child
 * is chrome laid out like any other (e.g. a `Dock` empty-state placeholder shown
 * as a non-closeable tab) but is never captured in a saved arrangement. Drops
 * exactly the positions `serializableChildIndices` leaves out.
 *
 * @param component - The container whose children to filter.
 * @returns The serializable children, in order.
 */
function serializableChildren(component: Component): Component[] {
    const children = component.getComponents();

    return serializableChildIndices(component).map(index => children[index]);
}

// A child whose strip cell the next layout pass has yet to create reports -1
// from indexOfContent. Rank it past every real strip position so it sorts
// after the tabbed children rather than ahead of all of them.
const UNTABBED_RANK = Number.MAX_SAFE_INTEGER;

/**
 * The serializable children of a {@link Tab} container in tab-strip order —
 * the order the user sees. A drag reorder re-sorts the manager's entries and
 * the strip and never the container's children, so from the first reorder
 * onwards the two orders differ, and the strip is the one a restore has to
 * reproduce.
 *
 * Each kept child is ranked by {@link Tab.indexOfContent} and the list sorted
 * by that rank — the same re-derivation `Tab` performs on its own entries
 * after a reorder. A child with no strip cell yet sorts after every tabbed
 * child, where the next layout pass will place it, and keeps its container
 * position against its untabbed siblings.
 *
 * @param component - The `Tab` container whose children to order.
 * @param manager - The container's `Tab` layout manager.
 * @returns The serializable children, in tab-strip order.
 */
function tabOrderedChildren(component: Component, manager: Tab): Component[] {
    const ranked = serializableChildren(component).map((child, position) => {
        const index = manager.indexOfContent(child);

        return { child, position, rank: index < 0 ? UNTABBED_RANK : index };
    });

    // The container position breaks ties, so untabbed children keep their
    // relative order without the sort having to be a stable one.
    ranked.sort((a, b) => (a.rank - b.rank) || (a.position - b.position));

    return ranked.map(entry => entry.child);
}

/**
 * Builds the arrangement node for a component: a `Split`- or `Tab`-managed one
 * is recorded with its children, each captured through {@link childNodeFor} so
 * that a child the caller's `isPanel` marks is a panel leaf; any other
 * component is an opaque panel leaf. `isPanel` is not asked about the
 * component itself.
 *
 * @param component - The component to capture.
 * @param options - The caller's options, if any.
 * @returns The arrangement node.
 */
function nodeFor(component: Component, options: LayoutSerializationOptions | undefined): LayoutNode {
    const kind = managerKind(component);

    if (kind === "Split") {
        const manager = component.getLayoutManager() as Split;
        const live    = component.getComponents();
        const kept    = serializableChildIndices(component);
        const ratios  = manager.getPaneRatios();

        // Every per-pane array is read at the child's live index and written at
        // its kept index, so dropping a transient pane shifts none of the
        // survivors. The kept ratios are renormalised to keep `SplitNode.ratios`
        // summing to 1.0, which is what its own declaration promises.
        return {
            kind:        "split",
            orientation: manager.getOrientation() === "vertical" ? "vertical" : "horizontal",
            children:    kept.map(index => childNodeFor(live[index], options)),
            ratios:      normalizeRatios(kept.map(index => ratios[index] ?? 0), kept.length),
            collapsed:   kept.map(index => manager.isPaneCollapsed(index)),
        };
    }

    if (kind === "Tab") {
        const manager = component.getLayoutManager() as Tab;
        const kept    = tabOrderedChildren(component, manager);
        const active  = manager.getActiveContent();

        // The manager's own active index counts tab-strip positions, which include
        // a transient tab and a lazy tab with no content yet, so it does not index
        // `kept`. The active tab is found in `kept` by identity instead, the way
        // Tab keeps its own selection across a reorder. With no captured child
        // active, the first tab is recorded.
        const index = active === null ? -1 : kept.indexOf(active);

        return {
            kind:        "tab",
            children:    kept.map(child => childNodeFor(child, options)),
            activeIndex: Math.max(0, index),
        };
    }

    return panelNodeFor(component);
}

/**
 * Builds the panel leaf for a component: its id plus the presentation and
 * close constraints its parent holds for it.
 *
 * @param component - The leaf to capture.
 * @returns The panel node.
 */
function panelNodeFor(component: Component): PanelNode {
    const constraints = component.getParentComponent()?.getLayoutConstraints(component);
    const glyph       = constraints?.glyph ?? null;
    const tooltip     = constraints?.tooltip ?? null;

    return {
        kind:           "panel",
        panelId:        panelIdOf(component),
        glyph,
        tooltip,
        closeable:      constraints?.closeable,
        disposeOnClose: constraints?.disposeOnClose,
        italic:         constraints?.italic,
        modified:       constraints?.modified,
    };
}

/**
 * Returns a window's content panel — its first non-header child — or `null`
 * when the window has no content yet.
 *
 * @param win - The window to inspect.
 * @returns The content component, or `null`.
 */
function windowContentOf(win: AbstractWindow): Component | null {
    return win.getComponents().find(child => !win.isChromeComponent(child)) ?? null;
}

/**
 * Builds a {@link WindowNode} for an open window, or `null` when it has no
 * content panel to key on. A `TabWindow` is captured whole, as a `"strip"`
 * node whose `content` is a `tab` node of every tab.
 *
 * @param win - The open window to capture.
 * @param options - The caller's options, if any.
 * @returns The window node, or `null`.
 */
function windowNodeFor(win: AbstractWindow, options: LayoutSerializationOptions | undefined): WindowNode | null {
    const content = windowContentOf(win);

    if (!content) {
        return null;
    }

    // A TabWindow's own manager is a Tab whose children are its tabs, so the
    // window itself goes through nodeFor's Tab branch.
    if (win instanceof TabWindow) {
        return {
            kind:        "window",
            windowMode:  "strip",
            content:     nodeFor(win, options),
            header:      win.getTitle(),
            rect:        win.getRect(),
            state:       win.getWindowState(),
            restoreRect: win.getRestoreRect(),
        };
    }

    return {
        kind:        "window",
        content:     childNodeFor(content, options),
        header:      win.getTitle(),
        rect:        win.getRect(),
        state:       win.getWindowState(),
        restoreRect: win.getRestoreRect(),
    };
}

/**
 * Captures the arrangement of `root` (and every open window except one that
 * hosts `root` — or, with `includeWindow`, only the windows it accepts) to a
 * plain, serializable object. Only `Split`/`Tab`/`Window` topology and geometry
 * is recorded; each leaf is a bare panel-ID reference whose content the caller
 * rebuilds on restore.
 *
 * @param root - The container whose arrangement to capture.
 * @param options - Limits which open windows are captured, and marks
 *   `Split`- or `Tab`-managed panels.
 * @returns The captured {@link LayoutState}.
 *
 * @category Layouts
 */
export function serializeLayout(root: Component, options?: LayoutSerializationOptions): LayoutState {
    // A window that hosts `root` is the layout's container, not one of its
    // floats: restoreLayout leaves it alone, so it is not recorded either.
    const windows = floatWindows(root, options)
        .map(win => windowNodeFor(win, options))
        .filter((node): node is WindowNode => node !== null);

    return {
        version: 1,
        root:    nodeFor(root, options),
        windows,
    };
}

/**
 * Collects the opaque leaf panels reachable from a component, descending
 * through every child that is an arrangement (see {@link isArrangement}: a
 * `Split`/`Tab` container the caller's `isPanel` does not mark) and treating
 * every other child as a leaf. The component itself is never added — only its descendants — because
 * the caller passes the rebuild-target container, which is never a parkable
 * leaf.
 *
 * Also detaches (but does not dispose) every transient child it finds along
 * the way — chrome like a Dock empty-state placeholder, excluded from state so
 * it has no slot to be re-homed into.
 *
 * @param component - The container whose descendants to walk.
 * @param into - The accumulator the leaves are pushed onto.
 * @param options - The caller's options, if any.
 */
function collectLeaves(component: Component, into: Component[], options: LayoutSerializationOptions | undefined): void {
    // Snapshot before mutating: a transient child's own removeComponent below
    // splices the live array getComponents() returns, so walking it directly
    // would shift a later sibling into the removed slot and skip it (see
    // Header.ts's reconcileColumnCells for the same snapshot-before-mutate
    // precedent).
    component.getComponents().slice().forEach(child => {
        if (component.getLayoutConstraints(child)?.transient === true) {
            // Transient chrome (e.g. a Dock empty-state placeholder) is never
            // captured in `state` and not owned by this module — detach it now,
            // before restoreLayout's scaffold-disposal sweep, so that sweep
            // cannot reach and dispose it. Its owner re-mounts the same
            // instance on its own next sweep (see Dock.showEmptyState).
            component.removeComponent(child);

            return;
        }

        if (isArrangement(child, options)) {
            collectLeaves(child, into, options);
        } else {
            into.push(child);
        }
    });
}

/**
 * Detaches every factory-known leaf from the live tree and open windows,
 * returning them keyed by panel ID. Honours the stable-instance contract: a
 * leaf is parked only when the factory hands back that very instance, so a
 * misbehaving factory degrades to "state not preserved" rather than re-homing a
 * stale orphan. Parked leaves are **not** destroyed — they carry panel state.
 * Transient children are also detached along the way (see collectLeaves) so
 * the caller's teardown sweep cannot reach them either. Every tab of a
 * `TabWindow` is parked.
 *
 * @param root - The container subtree to park leaves from.
 * @param liveWindows - The open windows whose content to park.
 * @param factory - Resolves a panel ID to its owning component.
 * @param options - The caller's options, if any.
 * @returns The parked leaves, keyed by panel ID.
 */
function parkLeaves(root: Component, liveWindows: AbstractWindow[], factory: LayoutFactory, options: LayoutSerializationOptions | undefined): Map<string, Component> {
    const leaves: Component[] = [];

    collectLeaves(root, leaves, options);

    liveWindows.forEach(win => {
        // A TabWindow's children are its tabs.
        if (win instanceof TabWindow) {
            collectLeaves(win, leaves, options);

            return;
        }

        const content = windowContentOf(win);

        if (!content) {
            return;
        }

        // A dockable float's content is a region tree: park every leaf in it so
        // each frame's state survives the restore. A legacy single-frame float
        // has a bare content component — park it directly.
        if (isArrangement(content, options)) {
            collectLeaves(content, leaves, options);
        } else {
            leaves.push(content);
        }
    });

    const parked = new Map<string, Component>();

    leaves.forEach(leaf => {
        const id = panelIdOf(leaf);

        if (factory(id) === leaf) {
            parked.set(id, leaf);
            leaf.getParentComponent()?.removeComponent(leaf);
        }
    });

    return parked;
}

/**
 * Whether `win` hosts `node` — i.e. `node` lies within `win`'s subtree, so `win`
 * is the window the layout root lives in rather than a torn-off float. Walks
 * `node`'s ancestor chain looking for `win`.
 *
 * @param win - A candidate host window.
 * @param node - The layout root being serialized or restored.
 * @returns `true` when `win` contains `node`.
 */
function hostsComponent(win: AbstractWindow, node: Component): boolean {
    for (let n: Component | null = node; n; n = n.getParentComponent()) {
        if (n === win) {
            return true;
        }
    }

    return false;
}

/**
 * The open windows that make up `root`'s floating-window plane: every open
 * window except one that hosts `root`, narrowed by `options.includeWindow`
 * when given. A host window is excluded before the predicate is asked.
 *
 * @param root - The layout root being serialized or restored.
 * @param options - The caller's options, if any.
 * @returns The float windows, in open order.
 */
function floatWindows(root: Component, options: LayoutSerializationOptions | undefined): AbstractWindow[] {
    const includeWindow = options?.includeWindow;

    return Window.getOpenWindows().filter(win =>
        !hostsComponent(win, root) && (includeWindow === undefined || includeWindow(win)));
}

/**
 * Returns the layout constraints to re-home a panel leaf under, carrying its
 * captured `glyph`, `tooltip`, `closeable` and `disposeOnClose` through so a
 * restored tab keeps its presentation and close behaviour. Identity rides on
 * the component's own id (see {@link panelIdOf}), not a constraint, so no `name`
 * is stamped — that keeps the leaf's visible label (its component name) intact
 * across a restore. Sub-containers and leaves that carry none of the four
 * fields carry no constraints.
 *
 * @param node - The child node being placed.
 * @returns The constraints, or `undefined` when none are needed.
 */
function constraintsFor(node: LayoutNode): LayoutConstraints | undefined {
    if (node.kind !== "panel") {
        return undefined;
    }

    const carries = node.glyph != null
        || node.tooltip != null
        || node.closeable !== undefined
        || node.disposeOnClose !== undefined
        || node.italic !== undefined
        || node.modified !== undefined;

    if (!carries) {
        return undefined;
    }

    const constraints = new LayoutConstraints();

    constraints.glyph          = node.glyph ?? null;
    constraints.tooltip        = node.tooltip ?? null;
    constraints.closeable      = node.closeable;
    constraints.disposeOnClose = node.disposeOnClose;
    constraints.italic         = node.italic;
    constraints.modified       = node.modified;

    return constraints;
}

/**
 * Resolves an arrangement node to a live component: a parked/factory leaf for a
 * panel node, or a freshly-built and populated sub-container for a split/tab
 * node. Returns `null` (with a warning) when a panel's factory yields nothing.
 * The sub-container is a fit-parent {@link Container}, as the live `Dock`
 * builds its regions, so it fills the slot its parent allocates and clips
 * oversized content rather than growing to the content's minimum size.
 *
 * @param node - The node to materialize.
 * @param parked - The parked leaves to re-home from.
 * @param factory - Supplies any leaf not already parked.
 * @returns The component, or `null` to skip.
 */
function materializeNode(node: LayoutNode, parked: Map<string, Component>, factory: LayoutFactory): Component | null {
    if (node.kind === "panel") {
        const panel = parked.get(node.panelId) ?? factory(node.panelId);

        if (!panel) {
            console.warn(`restoreLayout: no component for panelId "${node.panelId}"; skipping.`);
        }

        return panel;
    }

    const container = new Container();

    populateContainer(container, node, parked, factory);

    return container;
}

/**
 * Gives a container a fresh `Split`/`Tab` manager matching `node`, re-homes the
 * node's resolvable children into it in order, then applies the recorded
 * geometry (pane ratios + collapsed flags, or the active tab). Children whose
 * factory yields nothing are dropped, and the ratio/collapsed arrays — or a tab
 * node's active index — are re-aligned to the children that actually landed so
 * a missing leaf doesn't skew the rest.
 *
 * @param container - The container to populate.
 * @param node - The split or tab node describing it.
 * @param parked - The parked leaves to re-home from.
 * @param factory - Supplies any leaf not already parked.
 */
function populateContainer(container: Component, node: SplitNode | TabNode, parked: Map<string, Component>, factory: LayoutFactory): void {
    if (node.kind === "split") {
        const split = new Split({ orientation: node.orientation });
        container.setLayoutManager(split);

        const placed: { ratio: number; collapsed: boolean }[] = [];

        node.children.forEach((child, index) => {
            const built = materializeNode(child, parked, factory);

            if (built) {
                container.moveComponent(built, undefined, constraintsFor(child));
                placed.push({ ratio: node.ratios[index] ?? 0, collapsed: node.collapsed[index] ?? false });
            }
        });

        split.applyPaneRatios(placed.map(entry => entry.ratio));

        placed.forEach((entry, index) => {
            if (entry.collapsed) {
                split.setPaneCollapsedImmediate(index, true);
            }
        });
    } else {
        const tab = new Tab({ reorderable: true, compact: true });
        container.setLayoutManager(tab);

        fillTab(container, tab, node, parked, factory);
    }
}

/**
 * Re-homes a tab node's resolvable children into `container` as tabs of
 * `tab`, in order, then selects the saved active tab. Children whose factory
 * yields nothing are dropped, and the active index is re-aligned to the tabs
 * that actually landed.
 *
 * @param container - The component `tab` lays out: a rebuilt tab group, or a
 *   `TabWindow` itself.
 * @param tab - The `Tab` manager to register the tabs with.
 * @param node - The tab node describing the tabs.
 * @param parked - The parked leaves to re-home from.
 * @param factory - Supplies any leaf not already parked.
 * @returns How many tabs were placed.
 */
function fillTab(container: Component, tab: Tab, node: TabNode, parked: Map<string, Component>, factory: LayoutFactory): number {
    // The saved index counts every saved child, but the strip holds only
    // the children that were placed: each one skipped ahead of the active
    // child moves it one slot left. This is the re-alignment the split
    // branch of populateContainer gives its ratios through `placed`.
    let activeIndex = node.activeIndex;
    let placed = 0;

    node.children.forEach((child, index) => {
        const built = materializeNode(child, parked, factory);

        if (built) {
            container.moveComponent(built, undefined, constraintsFor(child));

            // Register the tab entry eagerly. The eager-add path otherwise
            // defers tab creation to the next `doLayout`, so `_tabs` would be
            // empty when `setActiveTabIndex` clamps below; `createTab` is the
            // public synchronous registration (doLayout's catch-up then skips
            // the now-owned child).
            tab.createTab(built);
            placed++;
        } else if (index < node.activeIndex) {
            activeIndex--;
        }
    });

    tab.setActiveTabIndex(activeIndex);

    return placed;
}

/**
 * Rebuilds a floating window from a {@link WindowNode}: a `"strip"` node
 * rebuilds a `TabWindow` holding its tabs, any other node a `Window` with the
 * recorded title and its materialized content — a region tree for a dockable
 * float, or the single parked/factory panel for a legacy single-frame float.
 * Then shows it at the saved geometry and state. Nothing opens when no
 * content could be materialized.
 *
 * @param node - The window node to rebuild.
 * @param parked - The parked leaves to re-home from.
 * @param factory - Supplies any content panel not parked.
 */
function applyWindow(node: WindowNode, parked: Map<string, Component>, factory: LayoutFactory): void {
    const contentNode = windowContentNode(node);

    if (!contentNode) {
        console.warn("restoreLayout: window node has neither content nor panelId; skipping.");

        return;
    }

    const win = node.windowMode === "strip"
        ? buildStripWindow(contentNode, parked, factory)
        : buildBareWindow(node.header, contentNode, parked, factory);

    if (win) {
        showRestoredWindow(win, node);
    }
}

/**
 * The node describing a saved window's content. New states carry a `content`
 * tree; a legacy state carries only `panelId`, restored as a single-panel node
 * through the same materialize path.
 *
 * @param node - The saved window node.
 * @returns The content node, or `null` when the node has neither field.
 */
function windowContentNode(node: WindowNode): LayoutNode | null {
    return node.content
        ?? (node.panelId ? { kind: "panel", panelId: node.panelId, glyph: null } : null);
}

/**
 * Builds a header `Window` titled `header` around the materialized content,
 * not yet shown.
 *
 * @param header - The title to give the window.
 * @param contentNode - The node describing the window's content.
 * @param parked - The parked leaves to re-home from.
 * @param factory - Supplies any content panel not parked.
 * @returns The window, or `null` when the content could not be materialized.
 */
function buildBareWindow(header: string, contentNode: LayoutNode, parked: Map<string, Component>, factory: LayoutFactory): AbstractWindow | null {
    const content = materializeNode(contentNode, parked, factory);

    if (!content) {
        return null;
    }

    // A restored layout shows its windows from code, not from a gesture on any
    // one of them, so the show takes no focus.
    const win = new Window(header, { autoFocus: false });

    // Carry the leaf's glyph (single-panel content only) through the re-home, as
    // for any split/tab pane. The frame's id is its own identity channel, so a
    // later restore still discovers and parks it through the normal leaf path.
    win.moveComponent(content, undefined, constraintsFor(contentNode));

    return win;
}

/**
 * Builds a `TabWindow` holding the saved tabs, not yet shown. A `tab` content
 * node gives one tab per child; any other node becomes the window's one tab.
 *
 * @param contentNode - The node describing the window's tabs.
 * @param parked - The parked leaves to re-home from.
 * @param factory - Supplies any content panel not parked.
 * @returns The window, or `null` (after disposing it) when no tab was placed.
 */
function buildStripWindow(contentNode: LayoutNode, parked: Map<string, Component>, factory: LayoutFactory): AbstractWindow | null {
    const tabs: TabNode = contentNode.kind === "tab"
        ? contentNode
        : { kind: "tab", children: [contentNode], activeIndex: 0 };

    // A restored layout shows its windows from code, so the show takes no
    // focus. Not shown yet, so filling it (and selecting its active tab)
    // moves no focus either.
    const win = new TabWindow({ autoFocus: false });

    if (fillTab(win, win.getLayoutManager() as Tab, tabs, parked, factory) === 0) {
        win.dispose();

        return null;
    }

    return win;
}

/**
 * Shows a rebuilt window at its saved geometry and state. The normal-state
 * geometry is applied first (from `restoreRect` when the saved state isn't
 * normal), then `setWindowState` re-caches it and animates to the saved state.
 *
 * @param win - The rebuilt, not yet shown window.
 * @param node - The saved window node.
 */
function showRestoredWindow(win: AbstractWindow, node: WindowNode): void {
    // Apply the geometry BEFORE show(): show() runs the first doLayout, which
    // sizes the content to the window's body — so the rect must already be the
    // final one or the content lays out against the default size and only
    // corrects on a later re-layout. For a minimized/maximized node the normal
    // rect is applied here and setWindowState (after show) animates from it.
    const normalRect = node.state === "normal" ? node.rect : (node.restoreRect ?? node.rect);
    win.applyRect(normalRect);

    win.show();

    if (node.state !== "normal") {
        win.setWindowState(node.state);
    }

    // From here on the float answers later raises (Dock.focusPanel, a drop into
    // it) like a float torn off a tab strip. show() decided its own focus move
    // when it ran, so switching autoFocus on now moves no focus.
    win.setAutoFocus(true);
}

/**
 * Restores a previously captured `state` onto `root`, sourcing leaves from
 * `factory`. Safe to call repeatedly on a live, already-arranged tree to switch
 * between saved layouts at runtime.
 *
 * @remarks Single-pass park-and-rebuild: it parks every factory-known leaf
 * under `root` and in the windows it is about to close, and detaches any
 * transient chrome (so both survive undisposed), disposes whatever scaffold
 * remains under `root`, and closes every open window except one that hosts
 * `root` — or, with `includeWindow`, only the windows it accepts, so a leaf in
 * an excluded window is not parked — rebuilds the container tree from `state`,
 * re-homes the parked leaves via
 * [`moveComponent`](/api/core/classes/Component#movecomponent), then applies
 * geometry. Because the container tree is rebuilt from scratch each call,
 * switching A→B→A reproduces A exactly with no residue from B. A panel ID with
 * no factory result is skipped with a warning.
 *
 * @param root - The container to restore the arrangement onto.
 * @param state - A {@link LayoutState} from {@link serializeLayout}.
 * @param factory - Resolves each panel ID to its (same-instance) content.
 * @param options - Limits which open windows are parked and closed, and marks
 *   `Split`- or `Tab`-managed panels.
 *
 * @category Layouts
 */
export function restoreLayout(root: Component, state: LayoutState, factory: LayoutFactory, options?: LayoutSerializationOptions): void {
    // Float-plane windows only. A window that *hosts* `root` (the layout lives
    // inside it, e.g. a Dock in a Window) must be left alone — tearing it down
    // would close the very window the restored layout renders into. Only
    // torn-off floats are parked and rebuilt from `state.windows`.
    const liveWindows = floatWindows(root, options);

    // 1. PARK every factory-known leaf (detach, never destroy).
    const parked = parkLeaves(root, liveWindows, factory, options);

    // 2. TEAR DOWN the live arrangement: close the float windows (content already
    //    parked) and clear the root container subtree wholesale.
    liveWindows.forEach(win => win.onExitAction());
    root.disposeAllComponents();

    // 3-5. REBUILD the container tree, RE-HOME parked leaves, APPLY geometry.
    if (state.root.kind === "panel") {
        const built = materializeNode(state.root, parked, factory);

        if (built) {
            root.moveComponent(built, undefined, constraintsFor(state.root));
        }
    } else {
        populateContainer(root, state.root, parked, factory);
    }

    state.windows.forEach(node => applyWindow(node, parked, factory));
}
