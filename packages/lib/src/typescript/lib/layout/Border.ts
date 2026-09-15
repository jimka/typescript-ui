// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js"
import { Component } from "~/core/Component.js"
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { SplitGutter } from "~/component/container/SplitGutter.js";
import { CollapseDirection } from "~/component/container/CollapseButton.js";
import { FillType } from "~/layout/FillType.js";
import { Placement } from "~/primitive/Placement.js";
import { Size, UNBOUNDED, saturate } from "~/primitive/Size.js";
import { COLLAPSE_STRIP_SIZE, runCollapse, commitRect, CollapseParticipant, CollapseTransition } from "~/layout/CollapseSupport.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { FocusReveal } from "~/core/FocusReveal.js";
import type { FocusRevealer } from "~/core/FocusReveal.js";

// Pixel thickness of a region's transparent collapse track in its expanded
// state — just enough to carry the (overflowing) chevron at the region's inner
// edge. Mirrors `Split`'s GUTTER_SIZE so the two managers' divider tracks match.
const TRACK_SIZE = 4;

// The way each region's chevron points (and the gutter travels) when collapsing
// — toward the region's outer edge. The restore heading is its opposite,
// handled by the gutter's `setOpaque`.
const COLLAPSE_CHEVRON: Record<string, CollapseDirection> = {
    [Placement.NORTH]: "north",
    [Placement.SOUTH]: "south",
    [Placement.WEST]:  "west",
    [Placement.EAST]:  "east",
};

/**
 * What {@link Border} records about a collapsed edge region the instant before
 * it takes the region's content out of the render tree — the same shape
 * `Split` keeps per pane: the region's own size reports, substituted for live
 * queries while the content is out (a childless region reports different —
 * for a box-managed one, deflated — numbers), and which direct children were
 * displayed, so an expand puts back exactly those and leaves a child something
 * else had already undisplayed (a `Card`'s inactive page) alone.
 */
interface RegionContentSnapshot {
    preferred: Size | null;
    min:       Size | null;
    max:       Size | null;
    displayed: Component[];
    /** The region component whose content clamp is suspended while its content is out. */
    component: Component;
}

/**
 * Construction-time options for the {@link Border} layout manager.
 *
 * @remarks Re-exported as `BorderLayoutOptions` from the package barrel to
 * disambiguate from the line-style `Border`'s {@link BorderOptions}.
 *
 * @category Layouts
 */
export interface BorderOptions extends LayoutManagerOptions {
    spacing?: number;
}

/**
 * A layout manager that divides a container into five named regions:
 * north, south, east, west, and center.
 * North and south regions span the full width; east and west regions flank the center.
 *
 * Exported from `@jimka/typescript-ui/layout`. Disambiguate from the line-style
 * [`Border`](/api/primitive/classes/Border) utility (in `@jimka/typescript-ui/primitive`)
 * by aliasing one of them on import — e.g. `import { Border as BorderLayout } from '@jimka/typescript-ui/layout';`.
 *
 * @category Layouts
 */
class Border extends LayoutManager implements FocusRevealer {

    private _northComponent: Component | null = null;
    private _southComponent: Component | null = null;
    private _westComponent: Component | null = null;
    private _eastComponent: Component | null = null;
    private _centerComponent: Component | null = null;
    private _spacing: number = 5;

    // Per-region collapse state, keyed by placement. `_collapsed` and
    // `_collapsible` both default to false: collapsing is opt-in per region
    // (`collapsible: true` on the constraint), so a plain Border — including
    // the ones Header, Dialog, and the table panels use internally — never
    // sprouts collapse affordances. `_gutters` holds one lazily-created fixed
    // gutter per collapsible edge region — a transparent track carrying the
    // chevron when expanded, the opaque strip when collapsed. The child
    // component stays unaware it is collapsible — this is layout geometry, so
    // it lives here.
    private _collapsed: Map<Placement, boolean> = new Map<Placement, boolean>();
    private _collapsible: Map<Placement, boolean> = new Map<Placement, boolean>();
    private _gutters: Map<Placement, SplitGutter> = new Map<Placement, SplitGutter>();

    // Canceller for the in-flight region collapse/restore animation, or null
    // when idle. Calling it stops the rAF loop in place so a rapid re-toggle
    // re-snapshots and retargets without two loops fighting.
    private _collapseAnimation: (() => void) | null = null;

    // Collapse/restore CSS transitions primed by `runCollapse` that have not
    // settled yet. Cancelled on detach so their fallback timers cannot fire
    // against released element handles. Held separately from
    // `_collapseAnimation` because that field is nulled when the geometry
    // animation settles — ~40ms before these fallbacks disarm — and is replaced
    // outright by a re-toggle while these may still be running.
    private readonly _pendingCollapseTransitions: CollapseTransition[] = [];

    // True while a collapse/restore animation is being driven. The animation
    // slides every region by writing each element's own `left`/`top` (via
    // `CollapseSupport.commitRect`'s `setX`/`setY`), which a clip frame defeats
    // because the frame — not the element — carries a framed region's position
    // and the element sits parked at `(0, 0)` inside it. While this is set,
    // `doLayout` lays every region out unframed (plain `placeComponent`) so the
    // animation can move them; the steady-state frames are reinstated by the
    // final `doLayout` once the animation settles.
    private _collapsing: boolean = false;

    // Snapshot of a collapsed region's own size reports and displayed
    // children, taken the instant before its content is undisplayed, keyed by
    // placement to match `_collapsed` / `_collapsible` / `_gutters`.
    // Substituted for a live query wherever a region may be
    // collapsed-and-undisplayed, so a now-childless region's own report cannot
    // silently change what the border reports or lays out while collapsed.
    // Presence of an entry also doubles as "this region's content is
    // undisplayed".
    private readonly _undisplayedRegionContent: Map<Placement, RegionContentSnapshot> = new Map();

    // Edges whose content was just redisplayed and are awaiting a scroll
    // restore once their post-expand geometry is final. Drained by
    // `reconcileCollapsedRegions`.
    private readonly _pendingScrollRestore: Set<Placement> = new Set();

    constructor(options?: BorderOptions) {
        // LayoutManager's constructor takes no options; applied via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link BorderOptions} bag, dispatching the inter-region spacing
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: BorderOptions): void {
        super.applyOptions(options);

        if (options.spacing !== undefined) {
            this.setComponentSpacing(options.spacing);
        }
    }

    /**
     * Registers a component in the north, south, east, west, or center slot
     * based on `constraints.placement`.
     *
     * @param component - The component to register.
     * @param constraints - Optional. Layout constraints specifying the target placement slot.
     *
     * @returns The resolved constraints object, or `undefined` if none were provided.
     *
     * @remarks When `constraints` or `constraints.placement` is absent the component
     * defaults to the center slot.
     */
    setLayoutConstraints(component: Component, constraints?: LayoutConstraints): LayoutConstraints | undefined {
        if (!constraints) {
            constraints = new LayoutConstraints();
            constraints.placement = Placement.CENTER;
        }

        if (!constraints.placement) {
            constraints.placement = Placement.CENTER;
        }

        // A different component taking a slot must not inherit the outgoing
        // one's content snapshot or queued scroll restore — both are keyed by
        // placement, not by component.
        if (this.getRegionComponent(constraints.placement) !== component) {
            this.forgetRegionContent(constraints.placement);
        }

        switch (constraints.placement) {
            case Placement.NORTH:
                this._northComponent = component;
                break;
            case Placement.SOUTH:
                this._southComponent = component;
                break;
            case Placement.WEST:
                this._westComponent = component;
                break;
            case Placement.EAST:
                this._eastComponent = component;
                break;
            case Placement.CENTER:
                this._centerComponent = component;
                break;
        }

        // The center is never collapsible; every edge region defaults to
        // non-collapsible and opts in via `collapsible: true`.
        if (constraints.placement === Placement.CENTER) {
            this._collapsible.set(Placement.CENTER, false);
        } else {
            this._collapsible.set(constraints.placement, constraints.collapsible ?? false);
        }

        return super.setLayoutConstraints(component, constraints);
    }

    /**
     * Clears the region slot a component occupied when it is removed from the
     * container. Without this the region reference goes stale: a component moved
     * out of a `Border` container (e.g. a window's content panel re-homed
     * elsewhere) would still be held as that region's child and re-sized by this
     * manager on its next `doLayout`, fighting its new parent's layout.
     *
     * @param component - The component being removed.
     * @returns The removed constraints, or `undefined` if none were stored.
     */
    delLayoutConstraints(component: Component): LayoutConstraints | undefined {
        if (this._northComponent === component) {
            this._northComponent = null;
            this.forgetRegionContent(Placement.NORTH);
        } else if (this._southComponent === component) {
            this._southComponent = null;
            this.forgetRegionContent(Placement.SOUTH);
        } else if (this._westComponent === component) {
            this._westComponent = null;
            this.forgetRegionContent(Placement.WEST);
        } else if (this._eastComponent === component) {
            this._eastComponent = null;
            this.forgetRegionContent(Placement.EAST);
        } else if (this._centerComponent === component) {
            this._centerComponent = null;
        }

        return super.delLayoutConstraints(component);
    }

    /**
     * Returns the pixel spacing between adjacent border regions.
     *
     * @returns The current spacing in pixels.
     */
    getComponentSpacing() {
        return this._spacing;
    }

    /**
     * Sets the pixel spacing between adjacent border regions.
     *
     * @param spacing - Spacing size in pixels.
     */
    setComponentSpacing(spacing: number) : this {
        this._spacing = spacing;

        return this;
    }

    /**
     * Returns the component currently registered in the given region slot.
     *
     * @param placement - The region to look up.
     * @returns The region's component, or `null` if the slot is empty.
     */
    private getRegionComponent(placement: Placement): Component | null {
        switch (placement) {
            case Placement.NORTH:  return this._northComponent;
            case Placement.SOUTH:  return this._southComponent;
            case Placement.WEST:   return this._westComponent;
            case Placement.EAST:   return this._eastComponent;
            case Placement.CENTER: return this._centerComponent;
        }
    }

    /**
     * Returns whether the given region is collapsed.
     *
     * @param placement - The region to query.
     * @returns True when the region is collapsed.
     */
    isRegionCollapsed(placement: Placement): boolean {
        return this._collapsed.get(placement) ?? false;
    }

    /**
     * Collapses or restores an edge region, animating the change. The region's
     * gutter slides from its inner edge to its outer edge and widens into the
     * opaque collapse strip (cross-fading its fill) while the region keeps its
     * full size and reveals via a clip-path; the center grows into the reclaimed
     * space. The whole pass is one coordinated animation: the toggled region
     * clip-reveals while the center and the gutter interpolate their geometry —
     * re-laying out their contents each frame — in lockstep (see
     * `CollapseSupport.runCollapse`). The center cannot be collapsed and a
     * non-collapsible region ignores a collapse request.
     *
     * @param placement - The region to collapse or restore.
     * @param collapsed - True to collapse, false to restore.
     * @returns This layout manager, for method chaining.
     */
    setRegionCollapsed(placement: Placement, collapsed: boolean): this {
        if (placement === Placement.CENTER || !this.isRegionCollapsible(placement)) {
            return this;
        }

        const component = this.getRegionComponent(placement);
        if (!component) {
            return this;
        }

        const current = this._collapsed.get(placement) ?? false;
        if (current === collapsed) {
            return this;
        }

        const container = this.getContainer();
        if (!container) {
            return this;
        }

        // Content must be back in the render tree before the start-state and
        // end-state layouts below run, or the expand reveals an empty box for
        // its whole run.
        if (!collapsed) {
            this.redisplayRegionContent(placement);
        }

        // Enter the animated phase before laying out the start state. When no
        // animation is already running the regions are clip-framed, parked at
        // `(0, 0)` inside frames that carry their real position; this `doLayout`
        // (now that `_collapsing` is set) re-lays them out unframed at their
        // current pre-toggle position, so each element's own `left`/`top` holds
        // the real start that `runCollapse` snapshots — a framed element would
        // otherwise snapshot `(0, 0)` and never move. A re-toggle mid-animation
        // is already unframed (its elements hold live interpolated positions),
        // so it skips this and lets `runCollapse` re-snapshot the live geometry
        // for a smooth retarget.
        const wasAnimating = this._collapsing;
        this._collapsing = true;

        if (!wasAnimating) {
            container.doLayout();
        }

        this._collapsed.set(placement, collapsed);

        // Materialise the region's gutter so it joins the participant list.
        this.ensureGutter(placement);

        // Every box that moves: the regions (content re-laid-out each frame) and
        // the gutters (geometry only). The toggled region is among them and also
        // clip-reveals; `runCollapse` coordinates the whole pass. A sibling
        // whose content is out is geometry-only too — its own layout must not
        // run while it stays collapsed (see `placeRegionBox`).
        const participants: CollapseParticipant[] = [];

        for (const edge of [Placement.NORTH, Placement.SOUTH, Placement.WEST, Placement.EAST, Placement.CENTER]) {
            const region = this.getRegionComponent(edge);

            if (region) {
                participants.push({ component: region, relayout: !this._undisplayedRegionContent.has(edge), gutter: false });
            }
        }

        for (const gutter of this._gutters.values()) {
            participants.push({ component: gutter, relayout: false, gutter: true });
        }

        this._collapseAnimation = runCollapse(container, component, participants, this._collapseAnimation, this._pendingCollapseTransitions, () => {
            this._collapseAnimation = null;

            // Leave the animated phase and re-lay-out so the non-collapsible
            // regions get their steady-state clip frames back (and, now idle,
            // so the collapsed regions' content is reconciled).
            this._collapsing = false;

            container.doLayout();
        });

        return this;
    }

    /**
     * Snapshots a collapsed region's own size and its content's native scroll
     * offsets, then removes that content from the render tree. For a region
     * whose content is already out, only re-asserts the undisplay of the
     * children it took out — this manager owns their displayed state while
     * the region stays collapsed, so a child something else put back since (a
     * stray layout of the region's own `Tab`, a consumer's
     * `setDisplayed(true)`) leaves again; the snapshot and the captured scroll
     * are kept. A recorded child that has since left the region is no longer
     * this manager's to touch.
     *
     * @remarks The capture is guarded on effective visibility, as `Tab` and
     * `Card` guard theirs: an ancestor outside this manager's control can be
     * what actually leaves the region with no boxes, and a live read against a
     * boxless subtree would clobber every cached offset with zero.
     *
     * @param placement - The collapsed edge.
     * @param component - The region's component, whose content to undisplay.
     */
    private undisplayRegionContent(placement: Placement, component: Component): void {
        const snapshot = this._undisplayedRegionContent.get(placement);

        if (snapshot !== undefined) {
            for (const child of snapshot.displayed) {
                if (child.getParentComponent() === component) {
                    child.setDisplayed(false);
                }
            }

            return;
        }

        // A region re-collapsed before its expand's restore landed still
        // carries the offsets it was collapsed with in its cache, and its live
        // offsets are the engine's post-`display: none` zeros: a capture here
        // would overwrite the one with the other, and the pending restore is
        // then dropped by `reconcileCollapsedRegions`'s drain. The cache stays
        // authoritative until a restore has actually been written.
        if (component.isEffectivelyVisible() && !this._pendingScrollRestore.has(placement)) {
            component.captureSubtreeScroll();
        }

        const displayed = component.getLaidOutComponents();

        this._undisplayedRegionContent.set(placement, {
            preferred: component.getPreferredSize(),
            min:       component.getMinSize(),
            max:       component.getMaxSize(),
            displayed,
            component,
        });

        // The snapshot above answers this manager's own reads; the region's
        // own `setWidth`/`setHeight` clamp reads the live merged max, which a
        // childless box manager reports as its bare perimeter, so a general
        // `Component` region would have every box write clamped away while
        // its content is out. Resumed by `redisplayRegionContent` and
        // `forgetRegionContent`.
        component.setContentClampSuspended(true);

        for (const child of displayed) {
            child.setDisplayed(false);
        }
    }

    /**
     * Restores a collapsed region's content to the render tree. Scroll is not
     * reapplied here — it needs the region's post-expand geometry, which only
     * exists once the settling `doLayout` has run — so the edge is queued
     * instead. Idempotent — a region whose content is already displayed is
     * left untouched. A recorded child that has since left the region is no
     * longer this manager's to touch.
     *
     * @param placement - The edge whose content to redisplay.
     */
    private redisplayRegionContent(placement: Placement): void {
        const snapshot = this._undisplayedRegionContent.get(placement);

        if (snapshot === undefined) {
            return;
        }

        this._undisplayedRegionContent.delete(placement);

        // The recorded component, not the live slot: the two coincide today
        // because a replacement forgets the snapshot first, but the snapshot
        // is the thing being undone.
        const component = snapshot.component;

        for (const child of snapshot.displayed) {
            if (child.getParentComponent() === component) {
                child.setDisplayed(true);
            }
        }

        component.setContentClampSuspended(false);

        this._pendingScrollRestore.add(placement);
    }

    /**
     * Places a collapsible region's full-size box for the current layout. A
     * region whose content is out gets its box and nothing more: running its
     * own layout would let a manager that writes its children's displayed
     * state (a `Tab` re-selecting its page) put content back in the render
     * tree behind the strip, undoing exactly what the collapse took out.
     *
     * @param placement - The region's edge.
     * @param component - The region's component.
     * @param x - The box's left position.
     * @param y - The box's top position.
     * @param width - The box's width.
     * @param height - The box's height.
     */
    private placeRegionBox(placement: Placement, component: Component, x: number, y: number, width: number, height: number): void {
        if (this._undisplayedRegionContent.has(placement)) {
            commitRect(component, this.resolveBounds(component, x, y, width, height, FillType.BOTH), false);
        } else {
            this.placeComponent(component, x, y, width, height, FillType.BOTH);
        }
    }

    /**
     * Drops an edge's content snapshot and queued scroll restore, for when the
     * component occupying the edge is replaced or removed.
     *
     * @param placement - The edge whose bookkeeping to drop.
     */
    private forgetRegionContent(placement: Placement): void {
        // The outgoing component is no longer this manager's to clamp on
        // behalf of; its recorded children stay as they are (see the docs
        // note on removal).
        this._undisplayedRegionContent.get(placement)?.component.setContentClampSuspended(false);
        this._undisplayedRegionContent.delete(placement);
        this._pendingScrollRestore.delete(placement);
    }

    /**
     * Mirrors `Split.reconcileCollapsedContent` over the four edges, from the
     * tail of every idle `doLayout` — which is also what a settling animation's
     * `onIdle` runs, so one edge's settle sweeps a sibling whose own animation
     * it superseded. A region `doLayout` actually clips away — collapsible
     * *and* collapsed, the same test `applyRegionClip` applies — has its
     * content undisplayed if it still shows; a region that carries a snapshot
     * but was laid out unclipped this pass (`collapsible` switched off while
     * the edge stayed flagged) gets its content back, since nothing clips it
     * and `setRegionCollapsed` would refuse it. Scroll is then restored for
     * every edge awaiting it whose content is in the render tree (an edge
     * re-collapsed before its expand settled has just been undisplayed again,
     * so it is skipped).
     */
    private reconcileCollapsedRegions(): void {
        for (const placement of [Placement.NORTH, Placement.SOUTH, Placement.WEST, Placement.EAST]) {
            const component = this.laidOut(this.getRegionComponent(placement));

            if (!component) {
                continue;
            }

            if (this.isRegionCollapsible(placement) && this.isRegionCollapsed(placement)) {
                this.undisplayRegionContent(placement, component);
            } else if (this._undisplayedRegionContent.has(placement)) {
                // The region's own box is already final; lay its children out
                // so the restore below writes against real scroll ranges.
                this.redisplayRegionContent(placement);
                component.doLayout();
            }
        }

        // A region whose content is back but whose component something else
        // has undisplayed cannot take its offsets yet (no boxes to write
        // against), so its entry is kept for the layout that follows its
        // re-show rather than dropped.
        const retained: Placement[] = [];

        for (const placement of this._pendingScrollRestore) {
            if (this._undisplayedRegionContent.has(placement)) {
                continue;
            }

            const component = this.laidOut(this.getRegionComponent(placement));

            if (component) {
                component.restoreSubtreeScroll();
            } else if (this.getRegionComponent(placement)) {
                retained.push(placement);
            }
        }

        this._pendingScrollRestore.clear();

        for (const placement of retained) {
            this._pendingScrollRestore.add(placement);
        }
    }

    /**
     * A region's preferred size as the border reports and lays it out: the
     * snapshot taken before its content was undisplayed while that holds,
     * else live.
     *
     * @param placement - The region's edge.
     * @param component - The region's component.
     * @returns The region's preferred size, or `null` when it reports none.
     */
    private regionPreferredSize(placement: Placement, component: Component): Size | null {
        const snapshot = this._undisplayedRegionContent.get(placement);

        return snapshot !== undefined ? snapshot.preferred : component.getPreferredSize();
    }

    /**
     * Mirrors {@link regionPreferredSize} for the minimum size.
     *
     * @param placement - The region's edge.
     * @param component - The region's component.
     * @returns The region's minimum size, or `null` when it reports none.
     */
    private regionMinSize(placement: Placement, component: Component): Size | null {
        const snapshot = this._undisplayedRegionContent.get(placement);

        return snapshot !== undefined ? snapshot.min : component.getMinSize();
    }

    /**
     * Mirrors {@link regionPreferredSize} for the maximum size. Needed as
     * much as the other two: a box-managed region reports its bare perimeter
     * as its max once childless, which would cap the whole border's width or
     * height to it.
     *
     * @param placement - The region's edge.
     * @param component - The region's component.
     * @returns The region's maximum size, or `null` when it reports none.
     */
    private regionMaxSize(placement: Placement, component: Component): Size | null {
        const snapshot = this._undisplayedRegionContent.get(placement);

        return snapshot !== undefined ? snapshot.max : component.getMaxSize();
    }

    /**
     * Returns whether the given region may be collapsed. The center is never
     * collapsible; edge regions are non-collapsible unless they opt in with
     * `collapsible: true` on their constraint.
     *
     * @param placement - The region to query.
     * @returns True when the region may be collapsed.
     */
    isRegionCollapsible(placement: Placement): boolean {
        if (placement === Placement.CENTER) {
            return false;
        }

        return this._collapsible.get(placement) ?? false;
    }

    /**
     * Sets whether an edge region may be collapsed. Hides the collapse chevron
     * when set false; the center is always non-collapsible regardless.
     *
     * @param placement - The region to configure.
     * @param value - True to allow collapsing, false to opt out.
     * @returns This layout manager, for method chaining.
     */
    setRegionCollapsible(placement: Placement, value: boolean): this {
        if (placement === Placement.CENTER) {
            return this;
        }

        this._collapsible.set(placement, value);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the existing fixed gutter for a region, creating and wiring it on
     * first use. The gutter is non-movable, transparent in its divider state,
     * and carries the chevron pointing toward the region's outer edge; its
     * double-click collapses the region.
     *
     * @param placement - The region the gutter collapses.
     * @returns The region's gutter.
     */
    private ensureGutter(placement: Placement): SplitGutter {
        let gutter = this._gutters.get(placement);
        if (gutter) {
            return gutter;
        }

        const container = this.getContainer()!;
        const vertical  = placement === Placement.NORTH || placement === Placement.SOUTH;

        gutter = new SplitGutter(vertical ? "vertical" : "horizontal", {
            movable:            false,
            collapseDirection:  COLLAPSE_CHEVRON[placement],
            expandedBackground: "transparent",
            listeners:          { collapse: () => this.setRegionCollapsed(placement, !this.isRegionCollapsed(placement)) },
        });

        gutter.setVisible(false);

        DOM.sink.appendChild(container.getElement()!, gutter.getElement(true)!);

        this._gutters.set(placement, gutter);

        return gutter;
    }

    /**
     * Returns a region's effective edge extent: the strip thickness when the
     * region is collapsed, otherwise the region's own preferred main-axis size.
     *
     * @param placement - The edge region.
     * @param preferred - The region's preferred main-axis extent (width for
     *   west/east, height for north/south).
     * @returns The extent to reserve for the region in `doLayout`.
     */
    private regionExtent(placement: Placement, preferred: number): number {
        return this.isRegionCollapsed(placement) ? COLLAPSE_STRIP_SIZE : preferred;
    }

    /**
     * Floors a region's preferred main-axis extent at the region component's
     * own minimum main-axis extent, so a region whose consumer pinned a
     * sub-minimum `preferredSize` is still reserved — and clip-framed — at the
     * size the component clamps itself up to on commit. Mirrors
     * {@link VBox.preferredChildHeight} / {@link HBox.preferredChildWidth}.
     * Reading the region's `getMinSize()` here is a non-recursive sibling call,
     * not a re-entry into this manager's own size gathering.
     *
     * @param preferred - The region's preferred main-axis extent.
     * @param min - The region's min-size, or null.
     * @param vertical - True for NORTH/SOUTH (height axis), false for WEST/EAST (width axis).
     * @returns `max(preferred, region min on the main axis)`.
     */
    private flooredMainExtent(preferred: number, min: Size | null, vertical: boolean): number {
        const minMain = min ? (vertical ? min.height : min.width) : 0;

        return Math.max(preferred, minMain);
    }

    /**
     * Clips a region's element toward its outer edge for the current collapse
     * state. The component is always laid out at its full size; collapsing
     * progressively clips it away (animated via a `clip-path` transition) so the
     * region visibly retreats into the strip rather than vanishing instantly,
     * mirroring the expand. Expanded, the clip is cleared. `clip-path` also
     * suppresses pointer events on the clipped-away area, so the hidden region
     * doesn't intercept clicks meant for the grown centre.
     *
     * @param component - The region's component.
     * @param placement - The edge region, which fixes the clip direction.
     */
    private applyRegionClip(component: Component, placement: Placement): void {
        // Never clip a region that can't collapse: `clip-path` establishes a
        // stacking context and a containing block for fixed descendants, which
        // could disturb a plain region's popovers. Only collapsible regions —
        // which need `inset(0)` as the transition's expanded keyframe — get it.
        if (!this.isRegionCollapsible(placement)) {
            return;
        }

        if (!this.isRegionCollapsed(placement)) {
            component.setClipPath("inset(0 0 0 0)");

            return;
        }

        switch (placement) {
            case Placement.WEST:  component.setClipPath("inset(0 100% 0 0)"); break;
            case Placement.EAST:  component.setClipPath("inset(0 0 0 100%)"); break;
            case Placement.NORTH: component.setClipPath("inset(0 0 100% 0)"); break;
            case Placement.SOUTH: component.setClipPath("inset(100% 0 0 0)"); break;
        }
    }

    /**
     * Positions a region's single gutter for the region's current state: a
     * transparent track at the inner edge (carrying the chevron) when expanded,
     * the opaque strip filling the region's strip-sized rect when collapsed. The
     * region component is hidden while collapsed. No gutter is shown for a
     * non-collapsible region.
     *
     * @param placement - The edge region.
     * @param x - The region's left position.
     * @param y - The region's top position.
     * @param width - The region's width (strip-sized when collapsed).
     * @param height - The region's height (strip-sized when collapsed for north/south).
     */
    private updateRegionGutter(placement: Placement, x: number, y: number, width: number, height: number): void {
        const component = this.getRegionComponent(placement);
        if (!component) {
            return;
        }

        if (!this.isRegionCollapsible(placement)) {
            component.setVisible(true);
            this._gutters.get(placement)?.setVisible(false);

            return;
        }

        const collapsed = this.isRegionCollapsed(placement);
        const gutter    = this.ensureGutter(placement);

        // The region stays visible and laid out at full size; `applyRegionClip`
        // clips it away while collapsed (it can't shrink past its min-size), so
        // the gutter strip is what reads as the collapsed region.
        component.setVisible(true);

        gutter.setOpaque(collapsed);
        gutter.setVisible(true);

        // Collapsed: the gutter fills the region's strip-sized rect. Expanded:
        // a thin transparent track in the gap just past the region's
        // center-facing edge, where the chevron reads naturally.
        const rect = collapsed ? { x, y, width, height } : this.innerEdgeTrack(placement, x, y, width, height);

        gutter.setX(rect.x);
        gutter.setY(rect.y);
        gutter.setWidth(rect.width);
        gutter.setHeight(rect.height);
    }

    /**
     * Computes the thin transparent track rect in the gap just past a region's
     * center-facing edge, where the expanded gutter parks its chevron. The
     * track sits flush against the region's outer edge of the gap rather than
     * overlapping the region's own content.
     *
     * @param placement - The edge region.
     * @param x - The region's left position.
     * @param y - The region's top position.
     * @param width - The region's width.
     * @param height - The region's height.
     * @returns The track rect.
     */
    private innerEdgeTrack(placement: Placement, x: number, y: number, width: number, height: number): { x: number; y: number; width: number; height: number } {
        switch (placement) {
            case Placement.NORTH: return { x, y: y + height,     width, height: TRACK_SIZE };
            case Placement.SOUTH: return { x, y: y - TRACK_SIZE, width, height: TRACK_SIZE };
            case Placement.WEST:  return { x: x + width,     y, width: TRACK_SIZE, height };
            case Placement.EAST:  return { x: x - TRACK_SIZE, y, width: TRACK_SIZE, height };
            default:              return { x, y, width, height };
        }
    }

    /**
     * Resolves a slot component for layout: a non-displayed region component is
     * treated as an empty slot (`null`), so a `display: none` region reserves no
     * space and is not placed — the same outcome as removing it from the region.
     * Every slot read in the size/layout methods routes through this so the
     * "hidden = absent" rule is uniform.
     *
     * @param component - The slot component, or `null` when the region is empty.
     * @returns The component when present and displayed, otherwise `null`.
     */
    private laidOut(component: Component | null): Component | null {
        return component && component.isDisplayed() ? component : null;
    }

    /**
     * Computes the preferred size by summing the preferred sizes of all occupied border regions.
     *
     * @returns The preferred `{width, height}` or `null` if no container is attached.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimeterSize = container.getPerimeterSize();

        let outerWidth = perimeterSize.left + perimeterSize.right;
        let outerHeight = perimeterSize.top + perimeterSize.bottom;

        let innerWidth = 0;
        let innerHeight = 0;

        let middleWidth = 0;
        let middleHeight = 0;

        // A non-displayed region is treated as absent, contributing nothing.
        const north  = this.laidOut(this._northComponent);
        const south  = this.laidOut(this._southComponent);
        const west   = this.laidOut(this._westComponent);
        const center = this.laidOut(this._centerComponent);
        const east   = this.laidOut(this._eastComponent);

        if (north) {
            let size = this.regionPreferredSize(Placement.NORTH, north);
            if (size) {
                const flooredHeight = this.flooredMainExtent(size.height, this.regionMinSize(Placement.NORTH, north), true);
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += this.isRegionCollapsed(Placement.NORTH) ? COLLAPSE_STRIP_SIZE : flooredHeight;
            }
        }

        if (south) {
            let size = this.regionPreferredSize(Placement.SOUTH, south);
            if (size) {
                const flooredHeight = this.flooredMainExtent(size.height, this.regionMinSize(Placement.SOUTH, south), true);
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += this.isRegionCollapsed(Placement.SOUTH) ? COLLAPSE_STRIP_SIZE : flooredHeight;
            }
        }

        if (west) {
            let size = this.regionPreferredSize(Placement.WEST, west);
            if (size) {
                const flooredWidth = this.flooredMainExtent(size.width, this.regionMinSize(Placement.WEST, west), false);
                middleWidth += this.isRegionCollapsed(Placement.WEST) ? COLLAPSE_STRIP_SIZE : flooredWidth;
                middleHeight = Math.max(middleHeight, size.height);
            }
        }

        if (center) {
            let size = center.getPreferredSize();
            if (size) {
                middleWidth += size.width;
                middleHeight = Math.max(middleHeight, size.height);
            }
        }

        if (east) {
            let size = this.regionPreferredSize(Placement.EAST, east);
            if (size) {
                const flooredWidth = this.flooredMainExtent(size.width, this.regionMinSize(Placement.EAST, east), false);
                middleWidth += this.isRegionCollapsed(Placement.EAST) ? COLLAPSE_STRIP_SIZE : flooredWidth;
                middleHeight = Math.max(middleHeight, size.height);
            }
        }

        innerWidth = Math.max(innerWidth, middleWidth);
        innerHeight += middleHeight;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the minimum size by summing the minimum sizes of all occupied border regions.
     *
     * @returns The minimum `{width, height}` or `null` if no container is attached.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimeterSize = container.getPerimeterSize();

        let outerWidth = perimeterSize.left + perimeterSize.right;
        let outerHeight = perimeterSize.top + perimeterSize.bottom;

        let innerWidth = 0;
        let innerHeight = 0;

        let middleWidth = 0;
        let middleHeight = 0;

        // A non-displayed region is treated as absent, contributing nothing.
        const north  = this.laidOut(this._northComponent);
        const south  = this.laidOut(this._southComponent);
        const west   = this.laidOut(this._westComponent);
        const center = this.laidOut(this._centerComponent);
        const east   = this.laidOut(this._eastComponent);

        if (north) {
            let size = this.regionMinSize(Placement.NORTH, north);
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += this.isRegionCollapsed(Placement.NORTH) ? COLLAPSE_STRIP_SIZE : size.height;
            }
        }

        if (south) {
            let size = this.regionMinSize(Placement.SOUTH, south);
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += this.isRegionCollapsed(Placement.SOUTH) ? COLLAPSE_STRIP_SIZE : size.height;
            }
        }

        if (west) {
            let size = this.regionMinSize(Placement.WEST, west);
            if (size) {
                middleWidth += this.isRegionCollapsed(Placement.WEST) ? COLLAPSE_STRIP_SIZE : size.width;
                middleHeight = Math.max(middleHeight, size.height);
            }
        }

        if (center) {
            let size = center.getMinSize();
            if (size) {
                middleWidth += size.width;
                middleHeight = Math.max(middleHeight, size.height);
            }
        }

        if (east) {
            let size = this.regionMinSize(Placement.EAST, east);
            if (size) {
                middleWidth += this.isRegionCollapsed(Placement.EAST) ? COLLAPSE_STRIP_SIZE : size.width;
                middleHeight = Math.max(middleHeight, size.height);
            }
        }

        innerWidth = Math.max(innerWidth, middleWidth);
        innerHeight += middleHeight;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Computes the maximum size the border layout can usefully occupy. The five
     * regions stack as three rows that share one width: north (full width), the
     * middle row of west + center + east (summed across, tallest of the three
     * down), and south (full width). The width is capped to the narrowest row
     * that exists — a region cannot usefully widen the border past where its own
     * row stops growing — and the height is the sum of the three row heights.
     * An absent region imposes no constraint; an unbounded region contributes
     * the unbounded sentinel.
     *
     * @returns The maximum `{width, height}` or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimeterSize = container.getPerimeterSize();

        let outerWidth = perimeterSize.left + perimeterSize.right;
        let outerHeight = perimeterSize.top + perimeterSize.bottom;

        // A non-displayed region resolves to null here (no constraint), not the
        // unbounded sentinel — it must not widen/heighten the layout at all. A
        // collapsed-and-undisplayed region reads its snapshot, not its live
        // (childless) report.
        const maxOf = (placement: Placement, component: Component | null): Size | null =>
            this.laidOut(component) ? (this.regionMaxSize(placement, component!) ?? { width: UNBOUNDED, height: UNBOUNDED }) : null;

        const north  = maxOf(Placement.NORTH,  this._northComponent);
        const south  = maxOf(Placement.SOUTH,  this._southComponent);
        const west   = maxOf(Placement.WEST,   this._westComponent);
        const center = maxOf(Placement.CENTER, this._centerComponent);
        const east   = maxOf(Placement.EAST,   this._eastComponent);

        // Middle row: west / center / east sit side by side — widths sum, the
        // row height is the tallest region.
        let middleWidth = 0;
        let middleHeight = 0;
        let hasMiddle = false;

        for (const region of [west, center, east]) {
            if (region) {
                hasMiddle = true;
                middleWidth += region.width;
                middleHeight = Math.max(middleHeight, region.height);
            }
        }

        // Width is shared by every row; cap to the narrowest existing row.
        let innerWidth = UNBOUNDED;
        if (north)     { innerWidth = Math.min(innerWidth, north.width); }
        if (south)     { innerWidth = Math.min(innerWidth, south.width); }
        if (hasMiddle) { innerWidth = Math.min(innerWidth, middleWidth); }

        // Height stacks the three rows.
        let innerHeight = 0;
        if (north)     { innerHeight += north.height; }
        if (hasMiddle) { innerHeight += middleHeight; }
        if (south)     { innerHeight += south.height; }

        return {
            width:  saturate(innerWidth  + outerWidth),
            height: saturate(innerHeight + outerHeight)
        };
    }

    /**
     * Computes the children's combined minSize along this manager's
     * 5-region geometry: width = west.minWidth + center.minWidth +
     * east.minWidth + gaps; height = north.minHeight + center.minHeight +
     * south.minHeight + gaps. Used by `doLayout` to inflate the working
     * size when the host has opted into `setOverflowing`.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        // A non-displayed region is treated as absent (laidOut → null), so it
        // contributes no min-size to the total. CENTER is never collapsible,
        // so it alone reads live.
        const west  = this.laidOut(this._westComponent);
        const east  = this.laidOut(this._eastComponent);
        const north = this.laidOut(this._northComponent);
        const south = this.laidOut(this._southComponent);

        const westMin   = west  ? this.regionMinSize(Placement.WEST,  west)  : undefined;
        const centerMin = this.laidOut(this._centerComponent)?.getMinSize();
        const eastMin   = east  ? this.regionMinSize(Placement.EAST,  east)  : undefined;
        const northMin  = north ? this.regionMinSize(Placement.NORTH, north) : undefined;
        const southMin  = south ? this.regionMinSize(Placement.SOUTH, south) : undefined;

        // Horizontal regions contribute to width; vertical regions contribute
        // to height. Each inter-region gap is added only when both adjacent
        // regions exist so single-region layouts (only center, for instance)
        // don't gain phantom gap pixels. A collapsed edge region contributes
        // only the strip thickness along its collapse axis.
        const hContribs: number[] = [];
        if (westMin)   { hContribs.push(this.isRegionCollapsed(Placement.WEST) ? COLLAPSE_STRIP_SIZE : westMin.width); }
        if (centerMin) { hContribs.push(centerMin.width); }
        if (eastMin)   { hContribs.push(this.isRegionCollapsed(Placement.EAST) ? COLLAPSE_STRIP_SIZE : eastMin.width); }

        const vContribs: number[] = [];
        if (northMin)  { vContribs.push(this.isRegionCollapsed(Placement.NORTH) ? COLLAPSE_STRIP_SIZE : northMin.height); }
        if (centerMin) { vContribs.push(centerMin.height); }
        if (southMin)  { vContribs.push(this.isRegionCollapsed(Placement.SOUTH) ? COLLAPSE_STRIP_SIZE : southMin.height); }

        let width  = 0;
        let height = 0;

        for (const w of hContribs) {
            width += w;
        }
        width += Math.max(0, hContribs.length - 1) * this._spacing;

        // For width we also need to ensure the height-region's own width is
        // honoured: the center column may need at least the wider of
        // north.minWidth / south.minWidth (which span the full row).
        if (northMin) {
            width = Math.max(width, northMin.width);
        }
        if (southMin) {
            width = Math.max(width, southMin.width);
        }

        for (const h of vContribs) {
            height += h;
        }
        height += Math.max(0, vContribs.length - 1) * this._spacing;

        return { width, height };
    }

    /**
     * Clears the clip frame of every region that `doLayout` will skip because it
     * resolved to `null` (a non-displayed region), so a `display: none` region
     * does not leave its `overflow: hidden` wrapper orphaned around the hidden
     * element until the region is shown again.
     *
     * @param laidOutRegions - The `laidOut` results for north, south, west,
     *   center, and east; a `null` entry marks a region `doLayout` will skip.
     */
    private clearSkippedRegionFrames(...laidOutRegions: (Component | null)[]): void {
        const rawRegions = [
            this._northComponent,
            this._southComponent,
            this._westComponent,
            this._centerComponent,
            this._eastComponent
        ];

        rawRegions.forEach((component, index) => {
            if (component && !laidOutRegions[index]) {
                component.clearClipFrame();
            }
        });
    }

    /**
     * Positions north, south, east, west, and center children within the container's inner bounds.
     *
     * @remarks The north component may opt out of parent insets via `constraints.ignoreParentInsets`,
     * which is useful for components such as toolbars that should span the full container width.
     */
    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        // The container has no element yet (e.g. laid out before it is
        // rendered, as an autoScroll host's synchronous setOverflowing pass
        // can do to a not-yet-mounted child); defer to the next pass, which
        // every other layout manager (HBox, VBox, Grid, Split, Tab) already
        // does in this situation.
        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        let containerInsets = container.getContentInsets();

        // Universal scroll: see HBox.doLayout for the rationale. Inflates the
        // working size to the children's combined minSize on the axes the
        // host has marked as overflowing.
        containerSize = this.inflateForOverflow(containerSize);

        // Resolve every region through laidOut so a non-displayed region is
        // treated as absent: skipped for placement and excluded from the
        // adjacent-region gap checks below — the same outcome as an empty slot.
        // This also keeps the preferred-size throws below unreachable for a
        // hidden region (its `if` block is skipped entirely).
        const north  = this.laidOut(this._northComponent);
        const south  = this.laidOut(this._southComponent);
        const west   = this.laidOut(this._westComponent);
        const center = this.laidOut(this._centerComponent);
        const east   = this.laidOut(this._eastComponent);

        // A non-displayed region is skipped by its `if (region)` block below, so
        // its clip frame is never re-driven or cleared there. Clear it now on the
        // raw component so a `display: none` region doesn't orphan its
        // `overflow: hidden` wrapper around the hidden element; clearClipFrame is
        // a no-op when no frame is active.
        this.clearSkippedRegionFrames(north, south, west, center, east);

        let width = containerSize.width;
        let height = containerSize.height;
        let centerX;
        let middleY;
        let centerWidth;
        let middleHeight;

        if (north) {
            let constraints = this.getLayoutConstraints(north);
            if (!constraints) {
                throw new Error("Unable to determine layout constraints for north component.");
            }

            let preferredSize = this.regionPreferredSize(Placement.NORTH, north);
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for north component.");
            }

            const northExtent = this.flooredMainExtent(preferredSize.height, this.regionMinSize(Placement.NORTH, north), true);
            let northHeight = this.regionExtent(Placement.NORTH, northExtent);
            let northX = constraints.ignoreParentInsets ? 0 : containerInsets.getLeft();
            let northY = constraints.ignoreParentInsets ? 0 : containerInsets.getTop();
            let northWidth = width + (constraints.ignoreParentInsets ? containerInsets.getLeft() + containerInsets.getRight() : 0);
            let northInsetTop = constraints.ignoreParentInsets ? containerInsets.getTop() : 0;

            middleY = northHeight + northInsetTop;

            // The region is always laid out at full size and clipped toward its
            // outer edge while collapsed; the centre and gutter use the strip
            // extent (`middleY`) so they grow into the reclaimed space. While a
            // collapse animates, every region takes the unframed path so its own
            // `left`/`top` can be interpolated (a frame would freeze it).
            if (this.isRegionCollapsible(Placement.NORTH) || this._collapsing) {
                this.placeRegionBox(
                    Placement.NORTH,
                    north,
                    northX,
                    northY,
                    northWidth,
                    northExtent + northInsetTop
                );
                north.clearClipFrame();
                this.applyRegionClip(north, Placement.NORTH);
            } else {
                // Containment via clip frame: an oversized or mis-sized region's
                // own box is clipped to its allocated rect rather than bleeding
                // over the adjacent region. Clear any stale clip-path left by a
                // prior collapsible state (setRegionCollapsible can flip a region
                // at runtime); this branch never calls applyRegionClip.
                north.setClipPath(null);
                north.setClipFrame(northX, northY, northWidth, northExtent + northInsetTop);
                this.commitBounds(north, 0, 0, northWidth, northExtent + northInsetTop);
            }

            this.updateRegionGutter(Placement.NORTH, northX, northY, northWidth, middleY);

            if (west || center || east || south) {
                middleY += this._spacing;
            }
        } else {
            middleY = 0;
        }

        middleHeight = height - middleY;
        if (south) {
            let preferredSize = this.regionPreferredSize(Placement.SOUTH, south);
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for south component.");
            }

            const southExtent = this.flooredMainExtent(preferredSize.height, this.regionMinSize(Placement.SOUTH, south), true);
            let southHeight = this.regionExtent(Placement.SOUTH, southExtent);
            let southX = containerInsets.getLeft();
            let southY = containerInsets.getTop() + height - southHeight;

            middleHeight -= this._spacing;
            middleHeight -= southHeight;

            // Full-size and bottom-anchored, clipped toward the bottom while
            // collapsed; the gutter uses the strip rect (`southY`/`southHeight`).
            let southFullY = containerInsets.getTop() + height - southExtent;

            if (this.isRegionCollapsible(Placement.SOUTH) || this._collapsing) {
                this.placeRegionBox(
                    Placement.SOUTH,
                    south,
                    southX,
                    southFullY,
                    width,
                    southExtent
                );
                south.clearClipFrame();
                this.applyRegionClip(south, Placement.SOUTH);
            } else {
                // Containment via clip frame; see the NORTH branch. The
                // non-collapsible full position equals the strip position, so the
                // element commits at (0, 0) inside the frame.
                south.setClipPath(null);
                south.setClipFrame(southX, southFullY, width, southExtent);
                this.commitBounds(south, 0, 0, width, southExtent);
            }

            this.updateRegionGutter(Placement.SOUTH, southX, southY, width, southHeight);
        }

        // Reserve east's preferred width up front so west can be clamped
        // to avoid overlapping east when west.preferred + east.preferred
        // exceeds the container width (e.g. a Window header where the
        // title is wider than the available space between the icon and
        // the trailing buttons).
        let eastPreferredWidth = 0;
        let eastFullWidth = 0;
        if (east) {
            let eastPreferred = this.regionPreferredSize(Placement.EAST, east);
            if (!eastPreferred) {
                throw new Error("Unable to determine preferred size for east component.");
            }
            const eastExtent = this.flooredMainExtent(eastPreferred.width, this.regionMinSize(Placement.EAST, east), false);
            eastFullWidth = eastExtent;
            eastPreferredWidth = this.regionExtent(Placement.EAST, eastExtent);
        }

        if (west) {
            let preferredSize = this.regionPreferredSize(Placement.WEST, west);
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for west component.");
            }

            const westExtent = this.flooredMainExtent(preferredSize.width, this.regionMinSize(Placement.WEST, west), false);
            let westWidth = Math.max(0, Math.min(this.regionExtent(Placement.WEST, westExtent), width - eastPreferredWidth));
            let westX = containerInsets.getLeft();
            let westY = containerInsets.getTop() + middleY;

            centerX = westWidth;

            // Full-size and left-anchored, clipped toward the left while
            // collapsed; the centre and gutter use the strip extent (`westWidth`).
            let westFullWidth = Math.max(0, Math.min(westExtent, width - eastPreferredWidth));

            if (this.isRegionCollapsible(Placement.WEST) || this._collapsing) {
                this.placeRegionBox(
                    Placement.WEST,
                    west,
                    westX,
                    westY,
                    westFullWidth,
                    middleHeight
                );
                west.clearClipFrame();
                this.applyRegionClip(west, Placement.WEST);
            } else {
                // Containment via clip frame; see the NORTH branch. The
                // non-collapsible full width equals the strip width, so the
                // element commits at (0, 0) inside the frame.
                west.setClipPath(null);
                west.setClipFrame(westX, westY, westFullWidth, middleHeight);
                this.commitBounds(west, 0, 0, westFullWidth, middleHeight);
            }

            this.updateRegionGutter(Placement.WEST, westX, westY, westWidth, middleHeight);

            if (center) {
                centerX += this._spacing;
            }
        } else {
            centerX = 0;
        }

        centerWidth = width - centerX;

        if (east) {
            centerWidth -= this._spacing;
            centerWidth -= eastPreferredWidth;

            let eastX = containerInsets.getLeft() + width - eastPreferredWidth;
            let eastY = containerInsets.getTop() + middleY;

            // Full-size and right-anchored, clipped toward the right while
            // collapsed; the gutter uses the strip rect (`eastX`/`eastPreferredWidth`).
            let eastFullX = containerInsets.getLeft() + width - eastFullWidth;

            if (this.isRegionCollapsible(Placement.EAST) || this._collapsing) {
                this.placeRegionBox(
                    Placement.EAST,
                    east,
                    eastFullX,
                    eastY,
                    eastFullWidth,
                    middleHeight
                );
                east.clearClipFrame();
                this.applyRegionClip(east, Placement.EAST);
            } else {
                // Containment via clip frame; see the NORTH branch. The
                // non-collapsible full position equals the strip position, so the
                // element commits at (0, 0) inside the frame.
                east.setClipPath(null);
                east.setClipFrame(eastFullX, eastY, eastFullWidth, middleHeight);
                this.commitBounds(east, 0, 0, eastFullWidth, middleHeight);
            }

            this.updateRegionGutter(Placement.EAST, eastX, eastY, eastPreferredWidth, middleHeight);
        }

        if (center) {
            let centerLeft = containerInsets.getLeft() + centerX;
            let centerTop = containerInsets.getTop() + middleY;

            // CENTER is never collapsible, so outside an animation it always
            // takes the frame branch and never carries a clip-path. Its rect is
            // its own allocation (it can never overflow it), so the frame is a
            // perfect-fit sheath that clips nothing — keeping one code path for
            // the non-collapsible case. While a collapse animates, CENTER grows
            // into the reclaimed space, so it takes the unframed path so its own
            // `left`/`top` can be interpolated.
            if (this._collapsing) {
                this.placeComponent(center, centerLeft, centerTop, centerWidth, middleHeight, FillType.BOTH);
                center.clearClipFrame();
            } else {
                center.setClipFrame(centerLeft, centerTop, centerWidth, middleHeight);
                this.commitBounds(center, 0, 0, centerWidth, middleHeight);
            }
        }

        // Every settle path ends in this layout (a settling animation's
        // `onIdle` calls it), so the idle tail is where a collapsed region's
        // content leaves the render tree and an expanded one's scroll comes
        // back. Never mid-animation, when children must stay displayed for
        // the reveal.
        if (!this._collapsing) {
            this.reconcileCollapsedRegions();
        }
    }

    /**
     * Associates this layout manager with a container component, then
     * registers with {@link FocusReveal} so a hidden target inside a collapsed
     * region can be revealed before it is focused.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component): this {
        super.attach(container);

        FocusReveal.register(this);

        return this;
    }

    /** @inheritDoc */
    getRevealElement(): Handle | null {
        return this.getContainer()?.getElement() ?? null;
    }

    /**
     * {@link FocusRevealer.revealDescendant}: expands whichever region is on
     * the DOM path to `target`, if it is currently collapsed.
     *
     * @param target - The element to reveal.
     */
    revealDescendant(target: Handle): void {
        for (const placement of [Placement.NORTH, Placement.SOUTH, Placement.WEST, Placement.EAST]) {
            const comp = this.getRegionComponent(placement);
            const el   = comp?.getElement();

            if (el && DOM.source.contains(el, target)) {
                if (this.isRegionCollapsed(placement)) {
                    this.setRegionCollapsed(placement, false);
                }

                return;
            }
        }
    }

    /**
     * Detaches from the container, removing every lazily-created collapse gutter
     * from the DOM and tearing down its event listeners so a layout-manager swap
     * leaves no orphaned affordances. Also clears the clip frame installed on
     * each non-collapsible region: when Border is swapped out but its regions
     * stay mounted, a successor manager that doesn't drive clip frames would
     * otherwise leave Border's `overflow: hidden` wrapper orphaned around the
     * region element. `clearClipFrame` is a no-op for an unframed region.
     */
    detach(): this {
        FocusReveal.unregister(this);

        // Abandon any in-flight collapse first: the primed CSS transitions
        // carry fallback timers that would otherwise outlive the element
        // handles teardown releases.
        this._collapseAnimation?.();
        this._collapseAnimation = null;

        // That canceller's `onIdle` is the only place `_collapsing` is cleared,
        // and cancelling suppressed it. Left set, a swapped-out-then-reattached
        // Border takes the unframed / clearClipFrame branch for every region
        // forever, so the clip frames never come back.
        this._collapsing = false;

        // Two shapes of detach. A manager swap leaves the panes mounted, so
        // their primed transitions must be settled — cleared — or each keeps a
        // live transition and a permanent compositor layer. A dispose reaches
        // here from `Component.destructor`, which already destroyed the
        // children (so `getComponents()` is empty), and touching one would
        // write through a released element handle: cancel silently instead.
        const survives = (this.getContainer()?.getComponents().length ?? 0) > 0;

        for (const transition of this._pendingCollapseTransitions) {
            if (survives) {
                transition.settle();
            } else {
                transition.cancel();
            }
        }
        this._pendingCollapseTransitions.length = 0;

        // A collapsed region's undisplayed content and suspended clamp are
        // this manager's doing, and no other manager knows to undo them: every
        // recorded child still alive and still this manager's to put back —
        // one the region still owns, or one parked with no owner — is put
        // back (see `Split.detach` for the parked-leaf shape this covers); a
        // child re-homed under another owner is left to that owner. Liveness
        // is `isDestroyed()`, not the parent link, which no tear-down order
        // keeps meaningful on its own.
        for (const snapshot of this._undisplayedRegionContent.values()) {
            snapshot.component.setContentClampSuspended(false);

            for (const child of snapshot.displayed) {
                const parent = child.getParentComponent();

                if (!child.isDestroyed() && (parent === null || parent === snapshot.component)) {
                    child.setDisplayed(true);
                }
            }
        }

        this._undisplayedRegionContent.clear();
        this._pendingScrollRestore.clear();

        super.detach();

        for (const gutter of this._gutters.values()) {
            const element = gutter.getElement();
            const parent = element ? DOM.source.getParentNode(element) : null;

            if (element && parent) {
                DOM.sink.removeChild(parent, element);
            }

            gutter.dispose();
        }

        this._gutters.clear();

        for (const placement of [Placement.NORTH, Placement.SOUTH, Placement.WEST, Placement.EAST, Placement.CENTER]) {
            this.getRegionComponent(placement)?.clearClipFrame();
        }

        return this;
    }
}

const BorderCallable = callable(Border);
type BorderCallable = Border;
export {
    Border         as _Border,
    BorderCallable as Border
};
