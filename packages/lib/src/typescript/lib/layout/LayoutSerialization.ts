// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Window } from "~/overlay/Window.js";
import { AbstractWindow } from "~/overlay/AbstractWindow.js";
import { Split } from "~/layout/Split.js";
import { Tab } from "~/layout/Tab.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
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
    /** Child arrangement nodes, in tab order. */
    children:    LayoutNode[];
    /** Zero-based index of the active tab. */
    activeIndex: number;
}

/**
 * A floating [`Window`](/api/overlay/classes/Window) and the arrangement it hosts.
 * A dockable float carries a full region {@link content} tree (splits, tab
 * order, active tab); a legacy single-panel float carried only {@link panelId}.
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
    /** Title-bar text — captured so the restored window reproduces its title. */
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
 * Builds the arrangement node for a component, descending into recognised
 * `Split`/`Tab` containers and recording everything else as an opaque panel
 * leaf.
 *
 * @param component - The component to capture.
 * @returns The arrangement node.
 */
/**
 * The children of a container that participate in serialization: every child
 * except those marked `transient` in their layout constraints. A transient child
 * is chrome laid out like any other (e.g. a `Dock` empty-state placeholder shown
 * as a non-closeable tab) but is never captured in a saved arrangement.
 *
 * @param component - The container whose children to filter.
 * @returns The serializable children, in order.
 */
function serializableChildren(component: Component): Component[] {
    return component.getComponents()
        .filter(child => component.getLayoutConstraints(child)?.transient !== true);
}

function nodeFor(component: Component): LayoutNode {
    const kind = managerKind(component);

    if (kind === "Split") {
        const manager  = component.getLayoutManager() as Split;
        const children = component.getComponents().map(nodeFor);

        return {
            kind:      "split",
            orientation: manager.getOrientation() === "vertical" ? "vertical" : "horizontal",
            children,
            ratios:    manager.getPaneRatios(),
            collapsed: children.map((_, index) => manager.isPaneCollapsed(index)),
        };
    }

    if (kind === "Tab") {
        const manager = component.getLayoutManager() as Tab;

        return {
            kind:        "tab",
            children:    serializableChildren(component).map(nodeFor),
            activeIndex: manager.getActiveTabIndex(),
        };
    }

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
 * content panel to key on.
 *
 * @param win - The open window to capture.
 * @returns The window node, or `null`.
 */
function windowNodeFor(win: AbstractWindow): WindowNode | null {
    const content = windowContentOf(win);

    if (!content) {
        return null;
    }

    return {
        kind:        "window",
        content:     nodeFor(content),
        header:      win.getTitle(),
        rect:        win.getRect(),
        state:       win.getWindowState(),
        restoreRect: win.getRestoreRect(),
    };
}

/**
 * Captures the arrangement of `root` (and every open window) to a plain,
 * serializable object. Only `Split`/`Tab`/`Window` topology and geometry is
 * recorded; each leaf is a bare panel-ID reference whose content the caller
 * rebuilds on restore.
 *
 * @param root - The container whose arrangement to capture.
 * @returns The captured {@link LayoutState}.
 *
 * @category Layouts
 */
export function serializeLayout(root: Component): LayoutState {
    const windows = Window.getOpenWindows()
        .map(windowNodeFor)
        .filter((node): node is WindowNode => node !== null);

    return {
        version: 1,
        root:    nodeFor(root),
        windows,
    };
}

/**
 * Collects the opaque leaf panels reachable from a component, descending
 * through recognised `Split`/`Tab` containers and treating everything else as a
 * leaf. The component itself is never added — only its descendants — because
 * the caller passes the rebuild-target container, which is never a parkable
 * leaf.
 *
 * Also detaches (but does not dispose) every transient child it finds along
 * the way — chrome like a Dock empty-state placeholder, excluded from state so
 * it has no slot to be re-homed into.
 *
 * @param component - The container whose descendants to walk.
 * @param into - The accumulator the leaves are pushed onto.
 */
function collectLeaves(component: Component, into: Component[]): void {
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

        const kind = managerKind(child);

        if (kind === "Split" || kind === "Tab") {
            collectLeaves(child, into);
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
 * the caller's teardown sweep cannot reach them either.
 *
 * @param root - The container subtree to park leaves from.
 * @param liveWindows - The open windows whose content to park.
 * @param factory - Resolves a panel ID to its owning component.
 * @returns The parked leaves, keyed by panel ID.
 */
function parkLeaves(root: Component, liveWindows: AbstractWindow[], factory: LayoutFactory): Map<string, Component> {
    const leaves: Component[] = [];

    collectLeaves(root, leaves);

    liveWindows.forEach(win => {
        const content = windowContentOf(win);

        if (!content) {
            return;
        }

        // A dockable float's content is a region tree: park every leaf in it so
        // each frame's state survives the restore. A legacy single-frame float
        // has a bare content component — park it directly.
        const kind = managerKind(content);

        if (kind === "Split" || kind === "Tab") {
            collectLeaves(content, leaves);
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
 * @param node - The layout root being restored.
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
        || node.disposeOnClose !== undefined;

    if (!carries) {
        return undefined;
    }

    const constraints = new LayoutConstraints();

    constraints.glyph          = node.glyph ?? null;
    constraints.tooltip        = node.tooltip ?? null;
    constraints.closeable      = node.closeable;
    constraints.disposeOnClose = node.disposeOnClose;

    return constraints;
}

/**
 * Resolves an arrangement node to a live component: a parked/factory leaf for a
 * panel node, or a freshly-built and populated sub-container for a split/tab
 * node. Returns `null` (with a warning) when a panel's factory yields nothing.
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

    const container = new Component();

    populateContainer(container, node, parked, factory);

    return container;
}

/**
 * Gives a container a fresh `Split`/`Tab` manager matching `node`, re-homes the
 * node's resolvable children into it in order, then applies the recorded
 * geometry (pane ratios + collapsed flags, or the active tab). Children whose
 * factory yields nothing are dropped, and the ratio/collapsed arrays are
 * re-aligned to the panes that actually landed so a missing leaf doesn't skew
 * the rest.
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

        node.children.forEach(child => {
            const built = materializeNode(child, parked, factory);

            if (built) {
                container.moveComponent(built, undefined, constraintsFor(child));

                // Register the tab entry eagerly. The eager-add path otherwise
                // defers tab creation to the next `doLayout`, so `_tabs` would be
                // empty when `setActiveTabIndex` clamps below; `createTab` is the
                // public synchronous registration (doLayout's catch-up then skips
                // the now-owned child).
                tab.createTab(built);
            }
        });

        tab.setActiveTabIndex(node.activeIndex);
    }
}

/**
 * Rebuilds a floating window from a {@link WindowNode}: a fresh window with the
 * recorded title and its materialized content — a region tree for a dockable
 * float, or the single parked/factory panel for a legacy single-frame float. The
 * normal-state geometry is applied first (from `restoreRect` when the saved
 * state isn't normal), then `setWindowState` re-caches it and animates to the
 * saved state.
 *
 * @param node - The window node to rebuild.
 * @param parked - The parked leaves to re-home from.
 * @param factory - Supplies any content panel not parked.
 */
function applyWindow(node: WindowNode, parked: Map<string, Component>, factory: LayoutFactory): void {
    // New states carry a `content` tree; a legacy state carries only `panelId`,
    // restored as a single-panel node through the same materialize path.
    const contentNode: LayoutNode | null = node.content
        ?? (node.panelId ? { kind: "panel", panelId: node.panelId, glyph: null } : null);

    if (!contentNode) {
        console.warn("restoreLayout: window node has neither content nor panelId; skipping.");

        return;
    }

    const content = materializeNode(contentNode, parked, factory);

    if (!content) {
        return;
    }

    const win = new Window(node.header);

    // Carry the leaf's glyph (single-panel content only) through the re-home, as
    // for any split/tab pane. The frame's id is its own identity channel, so a
    // later restore still discovers and parks it through the normal leaf path.
    win.moveComponent(content, undefined, constraintsFor(contentNode));

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
}

/**
 * Restores a previously captured `state` onto `root`, sourcing leaves from
 * `factory`. Safe to call repeatedly on a live, already-arranged tree to switch
 * between saved layouts at runtime.
 *
 * @remarks Single-pass park-and-rebuild: it parks every factory-known leaf and
 * detaches any transient chrome (so both survive undisposed), disposes
 * whatever scaffold remains under `root`, and closes all open windows,
 * rebuilds the container tree from `state`, re-homes the parked leaves via
 * [`moveComponent`](/api/core/classes/Component#movecomponent), then applies
 * geometry. Because the container tree is rebuilt from scratch each call,
 * switching A→B→A reproduces A exactly with no residue from B. A panel ID with
 * no factory result is skipped with a warning.
 *
 * @param root - The container to restore the arrangement onto.
 * @param state - A {@link LayoutState} from {@link serializeLayout}.
 * @param factory - Resolves each panel ID to its (same-instance) content.
 *
 * @category Layouts
 */
export function restoreLayout(root: Component, state: LayoutState, factory: LayoutFactory): void {
    // Float-plane windows only. A window that *hosts* `root` (the layout lives
    // inside it, e.g. a Dock in a Window) must be left alone — tearing it down
    // would close the very window the restored layout renders into. Only
    // torn-off floats are parked and rebuilt from `state.windows`.
    const liveWindows = Window.getOpenWindows().filter(win => !hostsComponent(win, root));

    // 1. PARK every factory-known leaf (detach, never destroy).
    const parked = parkLeaves(root, liveWindows, factory);

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
