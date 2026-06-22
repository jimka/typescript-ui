// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Container } from "~/core/Container.js";
import { DOM } from "~/core/DOM.js";
import { AbstractWindow } from "~/core/AbstractWindow.js";
import { Split } from "~/layout/Split.js";
import { Tab } from "~/layout/Tab.js";
import { DragManager, DragEventDetail, tabDragRegistry } from "~/core/DragManager.js";
import { DropZone, DropZoneOverlay, EDGE_BAND_FRACTION } from "~/core/component/DropZoneOverlay.js";

/**
 * Dwell, in milliseconds, before a tab held over a region raises that region's
 * host window. Long enough that brushing a drag across a background window in
 * transit does not raise it, short enough that a deliberate hover surfaces the
 * target so the user can aim the drop. Set above a `MenuItem` submenu's 150ms
 * hover delay because raising a whole window is a heavier, more disruptive action
 * than opening a submenu, so it should demand a clearly deliberate pause.
 */
const SPRING_RAISE_DELAY_MS = 1000;

/**
 * Coordinator that turns an edge/center drop onto a region into a structural
 * re-split (edge) or a tab add (center). One instance per dockable region.
 *
 * While a tab is dragged over the region (a source carrying plan #2's
 * [`TabDragData`](/api/core/interfaces/TabDragData)), a
 * [`DropZoneOverlay`](/api/core/classes/DropZoneOverlay) marks the five drop
 * zones and highlights the one under the cursor. Dropping on an **edge** splits
 * the region — wrapping it in a fresh [`Split`](/api/layout/classes/Split) (or
 * extending an existing same-axis `Split`) and re-homing the dragged panel into
 * a new pane. Dropping on the **center** adds the panel as a tab. The dropped
 * panel always lands inside a reorderable [`Tab`](/api/layout/classes/Tab)
 * stack rather than as a bare pane, so its tab header stays a drag source and
 * the panel can be torn off or re-docked again. Every re-parent goes through
 * [`Component.moveComponent`](/api/core/classes/Component#movecomponent).
 *
 * `DockRegion` is a plain coordinator, not a `Component`: it owns no element,
 * only a drop-target registration (torn down by {@link destroy}) and the
 * overlay it drives. It composes with the manager's own
 * [`DragFeedback`](/api/core/classes/DragFeedback) tint — the tint reports drop
 * validity, this overlay reports drop position — by returning `null` from
 * `onDragOver`, which suppresses the manager's reorder line.
 *
 * @category Layouts
 */
export class DockRegion {

    private _region: Component;
    private _overlay: DropZoneOverlay = new DropZoneOverlay();
    private _teardown: () => void;
    private _onStructureChanged: (() => void) | null;
    // Pending spring-loaded raise of the host window while a tab dwells over this
    // region; cleared the moment the cursor leaves, drops, or the region tears down.
    private _raiseTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Registers `region` as a drop target and wires the five-zone gesture.
     *
     * @param region - The container whose edges/center accept a docked tab.
     * @param onStructureChanged - Optional callback invoked after a drop mutates
     *   the tree (an edge split or a centre dock), letting a tree owner such as
     *   [`Dock`](/api/core/classes/Dock) re-wire the regions a drop just created.
     */
    constructor(region: Component, onStructureChanged?: () => void) {
        this._region = region;
        this._onStructureChanged = onStructureChanged ?? null;

        this._teardown = DragManager.makeDropTarget(region, {
            // Accept any tab drag so the manager keeps routing onDragOver/onDrop
            // here even over a zone the drop is *not* legal on — legality is then
            // decided per-zone (see isLegalDrop) and shown by colouring the drop
            // zone blue/red, not by tinting the whole frame. suppressValidityTint
            // turns off the manager's whole-target tint so it does not stack with
            // the per-zone colour.
            accepts:              (detail: DragEventDetail): boolean => detail.dragData["tabDrag"] === true,
            suppressValidityTint: true,
            onDragOver: (detail: DragEventDetail): null => {
                const componentId = detail.dragData["componentId"] as string;
                const zone        = this.computeZone(detail.clientX, detail.clientY);

                this._overlay.attachTo(this._region);
                this._overlay.setHighlight(zone, this.isLegalDrop(componentId, zone));

                // Spring-load a raise of the host window: a tab held over a
                // backgrounded float surfaces it after a dwell so the user can aim.
                this.scheduleSpringRaise();

                // Suppress the manager's ReorderIndicator — position feedback is
                // the overlay's job here, not a single insertion line.
                return null;
            },
            onDragLeave: (): void => {
                this._overlay.detach();
                this.clearSpringRaise();
            },
            onDrop: (detail: DragEventDetail): boolean | void => {
                const componentId = detail.dragData["componentId"] as string;
                const zone        = this.computeZone(detail.clientX, detail.clientY);

                this._overlay.detach();
                this.clearSpringRaise();

                // An illegal zone (self/ancestor, sole-content, a no-op edge, or
                // a centre drop into the panel's own tab bar) is a no-op:
                // suppress the drop so the source snaps back, exactly as the red
                // zone feedback promised.
                if (!this.isLegalDrop(componentId, zone)) {
                    return false;
                }

                const panel = tabDragRegistry.get(componentId);

                if (!panel) {
                    return false;
                }

                if (zone === "center") {
                    this.dockAsTab(panel);
                } else {
                    this.splitOnEdge(panel, zone);
                }

                // Surface the window the tab just landed in: a cross-window dock
                // onto a backgrounded float promotes and activates it, mirroring
                // the strip-drop raise in `Tab`.
                this.raiseHostWindow();
                this._onStructureChanged?.();
            },
        });
    }

    /**
     * Unregisters the drop target, detaches the overlay, and cancels any pending
     * spring-loaded raise.
     */
    destroy(): void {
        this._teardown();
        this._overlay.detach();
        this.clearSpringRaise();
    }

    /**
     * The {@link AbstractWindow} this region lives in, or `null` when the region
     * sits directly in the document. Walks the region's ancestor chain.
     *
     * @returns The owning window, or `null`.
     */
    private hostWindow(): AbstractWindow | null {
        for (let node: Component | null = this._region; node; node = node.getParentComponent()) {
            if (node instanceof AbstractWindow) {
                return node;
            }
        }

        return null;
    }

    /**
     * Raises and activates the region's host window, if any. A no-op for an
     * in-document region and harmless when the window is already frontmost.
     */
    private raiseHostWindow(): void {
        this.hostWindow()?.bringToFront();
    }

    /**
     * Arms the spring-loaded host-window raise if one is not already pending, so
     * a tab dwelling over a backgrounded float surfaces it after
     * {@link SPRING_RAISE_DELAY_MS}. Idempotent across the repeated `onDragOver`
     * calls a single hover produces — the timer runs once per dwell.
     */
    private scheduleSpringRaise(): void {
        if (this._raiseTimer !== null) {
            return;
        }

        this._raiseTimer = setTimeout(() => {
            this._raiseTimer = null;

            // Only raise if the drag is still live: the leave/drop clears cover
            // every reachable end, but guarding here keeps a cancelled drag (or
            // any future end path) from raising a window after the gesture ended.
            if (DragManager.isDragging()) {
                this.raiseHostWindow();
            }
        }, SPRING_RAISE_DELAY_MS);
    }

    /**
     * Cancels a pending spring-loaded raise — the cursor left, dropped, or the
     * region tore down before the dwell elapsed.
     */
    private clearSpringRaise(): void {
        if (this._raiseTimer !== null) {
            clearTimeout(this._raiseTimer);
            this._raiseTimer = null;
        }
    }

    /**
     * Resolves a viewport-relative cursor position to one of the five drop
     * zones. The cursor falls in an edge band when it is within
     * `EDGE_BAND_FRACTION` of an edge *and* closer to that edge than to the
     * perpendicular ones (corners resolve to the nearer edge, so there is no dead
     * diagonal); otherwise it is the central remainder. Pure arithmetic on the
     * region's box — no DOM mutation.
     *
     * @param x - Viewport-relative pointer X.
     * @param y - Viewport-relative pointer Y.
     * @returns The resolved drop zone.
     */
    private computeZone(x: number, y: number): DropZone {
        const rect = DOM.source.getViewportRect(this._region);

        const fx = (x - rect.left) / rect.width;   // 0..1 across
        const fy = (y - rect.top)  / rect.height;  // 0..1 down
        const f  = EDGE_BAND_FRACTION;

        const distLeft = fx, distRight = 1 - fx, distTop = fy, distBottom = 1 - fy;
        const nearest  = Math.min(distLeft, distRight, distTop, distBottom);

        if (nearest >= f) {
            return "center";
        }

        if (nearest === distLeft)  { return "left"; }
        if (nearest === distRight) { return "right"; }
        if (nearest === distTop)   { return "top"; }

        return "bottom";
    }

    /**
     * Whether dropping `componentId` on `zone` of this region is a real,
     * structure-changing move — the single predicate behind both the zone
     * colour (`onDragOver`) and the commit guard (`onDrop`). A drop is illegal
     * when it would:
     *
     * - re-home the region into itself or an ancestor (a cycle: the overlay sits
     *   on the region, so docking a node that contains the region beneath it
     *   would detach the subtree). Reachable since an edge drop wraps the region
     *   in a tab stack, making the region draggable by its own tab;
     * - dock a panel onto the edge of the region it is already the sole content
     *   of (a split with the same panel on both sides);
     * - reproduce the panel's current layout — an edge drop where the dragged
     *   stack is already that edge's neighbour (see {@link isRedundantEdgeDrop}),
     *   or a centre drop adding the panel to the tab bar it is already in (see
     *   {@link isRedundantCenterDrop}).
     *
     * @param componentId - The dragged content component's id.
     * @param zone - The zone the cursor resolved to.
     * @returns `true` when the drop would change the layout.
     */
    private isLegalDrop(componentId: string, zone: DropZone): boolean {
        for (let node: Component | null = this._region; node; node = node.getParentComponent()) {
            if (node.getId() === componentId) {
                return false;
            }
        }

        const children = this._region.getComponents();

        if (children.length === 1 && children[0].getId() === componentId) {
            return false;
        }

        if (zone === "center") {
            return !this.isRedundantCenterDrop(componentId);
        }

        return !this.isRedundantEdgeDrop(componentId, zone);
    }

    /**
     * Whether a centre drop of `componentId` would add it to the tab bar it is
     * already in — the panel is already a tab there, so the drop changes
     * nothing. Mirrors {@link dockAsTab}'s target resolution: a centre drop adds
     * to the region's own `Tab` (when the region is a stack), or to the region's
     * parent `Tab` (when the region is a tabbed leaf); any other shape wraps the
     * region in a fresh stack and so is never redundant. Redundant exactly when
     * the dragged panel's current stack is that same target stack.
     *
     * @param componentId - The dragged content component's id.
     * @returns `true` when the centre drop would leave the layout unchanged.
     */
    private isRedundantCenterDrop(componentId: string): boolean {
        const dragged = tabDragRegistry.get(componentId);

        if (!dragged) {
            return false;
        }

        const stack = dragged.getParentComponent();

        if (this._region.getLayoutManager() instanceof Tab) {
            return stack === this._region;
        }

        const parent = this._region.getParentComponent();

        if (parent?.getLayoutManager() instanceof Tab) {
            return stack === parent;
        }

        return false;
    }

    /**
     * Whether an edge drop of `componentId` on `zone` would reproduce the
     * current layout — i.e. land the dragged panel exactly where it already is.
     * Such a drop is the spatial equivalent of a self-drop and is rejected so it
     * gets red, no-op feedback rather than silently rebuilding the same tree.
     *
     * The redundant case is narrow: the dragged panel is the *sole* tab of a
     * stack that is *already* the immediate neighbour of the split unit on the
     * drop side. A multi-tab stack always changes (a tab is pulled out); a
     * perpendicular or non-adjacent drop always wraps or reorders. The
     * unit/container resolution mirrors {@link splitOnEdge} so this predicts the
     * exact insertion that method would perform, but reads the tree before any
     * mutation.
     *
     * @param componentId - The dragged content component's id.
     * @param zone - The edge the cursor resolved to (never `"center"`).
     * @returns `true` when the drop would leave the layout unchanged.
     */
    private isRedundantEdgeDrop(componentId: string, zone: DropZone): boolean {
        const dragged = tabDragRegistry.get(componentId);

        if (!dragged) {
            return false;
        }

        // Only a single-tab stack relocates wholesale: pulling a tab out of a
        // multi-tab stack always splits it off, which is a real change.
        const stack = dragged.getParentComponent();

        if (!stack || stack.getComponents().length !== 1) {
            return false;
        }

        const axis    = (zone === "left" || zone === "right") ? "horizontal" : "vertical";
        const leading = zone === "top" || zone === "left";

        // Branch 1: the region is itself a same-axis Split — the drop appends the
        // stack as the region's first/last child. Redundant when the dragged
        // stack already occupies that boundary slot inside the region.
        const regionLm = this._region.getLayoutManager();

        if (regionLm instanceof Split && String(regionLm.getOrientation()) === axis) {
            if (stack.getParentComponent() !== this._region) {
                return false;
            }

            const kids = this._region.getComponents();

            return leading ? kids[0] === stack : kids[kids.length - 1] === stack;
        }

        // Branch 2: the stack inserts adjacent to the split unit (the region, or
        // its whole tab stack) inside a same-axis Split container. Redundant when
        // the dragged stack is already that neighbour. Any other container shape
        // wraps the unit in a fresh Split — never a no-op.
        const parent    = this._region.getParentComponent();
        const unit      = parent?.getLayoutManager() instanceof Tab ? parent : this._region;
        const container = unit?.getParentComponent();

        if (!container) {
            return false;
        }

        const containerLm = container.getLayoutManager();

        if (!(containerLm instanceof Split && String(containerLm.getOrientation()) === axis)) {
            return false;
        }

        if (stack.getParentComponent() !== container) {
            return false;
        }

        const kids       = container.getComponents();
        const unitIndex  = kids.indexOf(unit);
        const stackIndex = kids.indexOf(stack);

        return leading ? stackIndex === unitIndex - 1 : stackIndex === unitIndex + 1;
    }

    /**
     * Splits on an edge drop. The new panel lands in its own reorderable Tab
     * stack; the question is what that stack splits *against* — the **unit**:
     *
     * - if the region is itself a same-axis `Split`, it is extended directly;
     * - else if the region is a tabbed leaf (its parent is a `Tab`), the unit is
     *   that whole tab **stack** — the split happens around the group, never by
     *   dropping a `Split` into a tab slot (which would create an anonymous,
     *   ever-nesting wrapper tab);
     * - otherwise the unit is the region itself.
     *
     * The unit is then either inserted into its container's existing same-axis
     * `Split` (adjacent — keeping repeated same-axis drops flat) or wrapped in a
     * fresh `Split` (so a perpendicular drop nests by one level, as intended).
     * The new stack is the leading pane for a `"top"`/`"left"` drop, trailing
     * otherwise. A single-tab stack split this way becomes a `Split` of two
     * stacks — "the single tab converted into a split with two tabs".
     *
     * @param panel - The dragged content component to re-home.
     * @param zone - The edge the cursor was released on (never `"center"`).
     */
    private splitOnEdge(panel: Component, zone: DropZone): void {
        const axis    = (zone === "left" || zone === "right") ? "horizontal" : "vertical";
        const leading = zone === "top" || zone === "left";

        // The dropped panel always lands in its own reorderable Tab stack, never
        // as a bare Split pane: a bare pane has no draggable handle, so it could
        // never be detached again. The stack's tab is that handle (tear-off and
        // re-dock come free from the reorderable Tab wiring).
        const stack = this.newStack();
        stack.moveComponent(panel);

        // The region is itself a same-axis Split → extend it directly.
        const lm = this._region.getLayoutManager();

        if (lm instanceof Split && String(lm.getOrientation()) === axis) {
            this._region.moveComponent(stack, leading ? 0 : this._region.getComponents().length);

            return;
        }

        // Pick the unit to split: the region's whole Tab stack when the region is
        // a tabbed leaf, else the region itself. Splitting the stack (not the
        // leaf) keeps the Split out of the Tab — a Split in a tab slot is exactly
        // what produced the anonymous, nesting wrapper tab.
        const parent    = this._region.getParentComponent();
        const unit       = parent?.getLayoutManager() instanceof Tab ? parent : this._region;
        const container = unit.getParentComponent();

        if (!container) {
            return;
        }

        const containerLm = container.getLayoutManager();
        const unitIndex   = container.getComponents().indexOf(unit);

        // Container is already a same-axis Split → insert the stack adjacent to
        // the unit, keeping same-axis drops flat instead of nesting.
        if (containerLm instanceof Split && String(containerLm.getOrientation()) === axis) {
            container.moveComponent(stack, leading ? unitIndex : unitIndex + 1);

            return;
        }

        // Otherwise wrap the unit in a fresh same-axis Split (a perpendicular
        // drop therefore nests by one level, as intended).
        const split = new Container({ layoutManager: new Split({ orientation: axis }) });

        container.moveComponent(split, unitIndex);

        // Stack the existing pane too when it is a bare leaf, so both sides of
        // the new split are draggable tab stacks — not a tab stack paired with a
        // handle-less bare pane that could never be torn off again.
        const unitPane = this.ensureStacked(unit);

        split.moveComponent(stack,    leading ? 0 : 1);
        split.moveComponent(unitPane, leading ? 1 : 0);

        // The fresh `split` now occupies the slot `unit` held in `container`. When
        // that container is itself a Split, hand the new wrapper the size the unit
        // had so the user's dragged ratio survives the wrap instead of the slot
        // re-equalizing.
        if (containerLm instanceof Split) {
            containerLm.transferPaneSize(unit, split);
        }
    }

    /**
     * Returns `unit` wrapped in a fresh reorderable Tab stack when it is a bare
     * leaf, or `unit` unchanged when it is already a stack or a `Split`. Lets a
     * wrap leave *both* panes of the new split as draggable tab stacks — the
     * dropped panel and the pre-existing content alike — rather than pairing a
     * stack with a handle-less bare pane that could never be torn off again.
     *
     * @param unit - The pane about to become one side of a fresh `Split`.
     * @returns A Tab stack containing `unit`, or `unit` itself when it is already
     *   a stack or a structural `Split`.
     */
    private ensureStacked(unit: Component): Component {
        const lm = unit.getLayoutManager();

        if (lm instanceof Tab || lm instanceof Split) {
            return unit;
        }

        const stack = this.newStack();
        stack.moveComponent(unit);

        return stack;
    }

    /**
     * A fresh, empty reorderable [`Tab`](/api/layout/classes/Tab) stack — the
     * draggable leaf unit edge and centre drops deposit content into. Made
     * `reorderable` so its tab header registers as a drag source: that is what
     * lets a docked panel be torn off or re-docked later. The tab itself is
     * built by `Tab.doLayout`, which creates one for every container child no
     * entry yet owns, so callers only need to `moveComponent` content in.
     *
     * Subscribes the stack's `empty` event to {@link pruneEmptyStack} so that
     * once its last tab leaves (torn off, re-docked, or closed) the now-empty
     * stack removes itself and any single-pane `Split` it leaves behind
     * collapses. The closure captures only `stack`; both are dropped together
     * when the stack is pruned, so no explicit `off` is needed.
     *
     * @returns A `Container` carrying a reorderable `Tab` layout manager.
     */
    private newStack(): Container {
        const stack = new Container({ layoutManager: new Tab({ reorderable: true, compact: true }) });
        const tab   = stack.getLayoutManager() as Tab;

        tab.on("empty", () => this.pruneEmptyStack(stack));

        return stack;
    }

    /**
     * Removes an emptied stack from its parent, then collapses the parent if the
     * removal leaves it a single-pane `Split`. The stack is destroyed, not moved,
     * so it leaves via `removeComponent` rather than `moveComponent`.
     *
     * @param stack - The stack whose `empty` event fired.
     */
    private pruneEmptyStack(stack: Component): void {
        const parent = stack.getParentComponent();

        if (!parent) {
            return;
        }

        parent.removeComponent(stack);
        this.collapseIfSinglePaneSplit(parent);
    }

    /**
     * Collapses a `Split` that has been left with a single child: the lone child
     * is hoisted into the grandparent at the `Split`'s slot via `moveComponent`
     * and the emptied `Split` is dropped. A no-op unless `container` is a `Split`
     * with exactly one child. At the root (no grandparent) the lone child is left
     * in place — a root `Split` with one child simply renders it full-bleed.
     *
     * The hoist swaps one child for another in the grandparent (count unchanged),
     * so the grandparent never itself drops to a single child from this — the
     * collapse does not cascade.
     *
     * @param container - The container that just lost a child.
     */
    private collapseIfSinglePaneSplit(container: Component): void {
        if (!(container.getLayoutManager() instanceof Split)) {
            return;
        }

        const children = container.getComponents();

        if (children.length !== 1) {
            return;
        }

        const grandparent = container.getParentComponent();

        if (!grandparent) {
            return;
        }

        const index = grandparent.getComponents().indexOf(container);

        // The hoisted child takes the slot the collapsing Split vacated; carry the
        // Split's stored size onto it so a single-pane collapse keeps the user's
        // dragged ratio (when the grandparent is itself a Split).
        const grandparentLm = grandparent.getLayoutManager();

        if (grandparentLm instanceof Split) {
            grandparentLm.transferPaneSize(container, children[0]);
        }

        grandparent.moveComponent(children[0], index);
        grandparent.removeComponent(container);
    }

    /**
     * Adds the dragged panel to the region as a tab, choosing the target by what
     * already exists:
     *
     * 1. the region is itself a `Tab` → the panel joins it;
     * 2. the region is already a tabbed leaf (its parent is a `Tab` stack, from a
     *    prior centre-drop) → the panel joins that parent stack as a sibling tab;
     * 3. otherwise → the region is wrapped in a fresh `Tab` stack.
     *
     * Case 2 is the fix for repeated centre-drops: without it, the region's own
     * layout manager (a plain leaf) is never a `Tab`, so each drop would wrap it
     * again, nesting stacks and shrinking the content by a tab-strip per drop.
     * The tab itself is materialised by `Tab.doLayout`, which builds one for
     * every container child no entry yet owns.
     *
     * @param panel - The dragged content component to re-home as a tab.
     */
    private dockAsTab(panel: Component): void {
        const lm = this._region.getLayoutManager();

        if (lm instanceof Tab) {
            this._region.moveComponent(panel);
            this._region.scheduleLayout();

            return;
        }

        const parent = this._region.getParentComponent();

        if (!parent) {
            return;
        }

        if (parent.getLayoutManager() instanceof Tab) {
            parent.moveComponent(panel);
            parent.scheduleLayout();

            return;
        }

        const index        = parent.getComponents().indexOf(this._region);
        const tabContainer = this.newStack();

        parent.moveComponent(tabContainer, index);
        tabContainer.moveComponent(this._region);
        tabContainer.moveComponent(panel);
        tabContainer.scheduleLayout();
    }
}
