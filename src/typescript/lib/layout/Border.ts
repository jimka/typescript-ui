// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js"
import { Component } from "~/core/Component.js"
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { SplitGutter } from "~/component/container/SplitGutter.js";
import { CollapseDirection } from "~/component/container/CollapseButton.js";
import { FillType } from "~/layout/FillType.js";
import { Placement } from "~/primitive/Placement.js";
import { Size } from "~/primitive/Size.js";
import { COLLAPSE_STRIP_SIZE, runCollapse, CollapseParticipant } from "~/layout/CollapseSupport.js";
import { callable } from "~/core/Callable.js";

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
 * Construction-time options for the {@link Border} layout manager.
 *
 * @remarks Re-exported as `BorderLayoutOptions` from the package barrel to
 * disambiguate from the line-style `Border`'s {@link BorderOptions}.
 *
 * @category Layouts
 */
export interface BorderOptions extends LayoutManagerOptions {
    gap?: number;
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
class Border extends LayoutManager {

    private _northComponent: Component | null = null;
    private _southComponent: Component | null = null;
    private _westComponent: Component | null = null;
    private _eastComponent: Component | null = null;
    private _centerComponent: Component | null = null;
    private _gap: number = 5;

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

    constructor(options?: BorderOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link BorderOptions} bag, dispatching the inter-region gap
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: BorderOptions): void {
        super.applyOptions(options);

        if (options.gap !== undefined) {
            this.setComponentGap(options.gap);
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
        } else if (this._southComponent === component) {
            this._southComponent = null;
        } else if (this._westComponent === component) {
            this._westComponent = null;
        } else if (this._eastComponent === component) {
            this._eastComponent = null;
        } else if (this._centerComponent === component) {
            this._centerComponent = null;
        }

        return super.delLayoutConstraints(component);
    }

    /**
     * Returns the pixel gap between adjacent border regions.
     *
     * @returns The current gap in pixels.
     */
    getComponentGap() {
        return this._gap;
    }

    /**
     * Sets the pixel gap between adjacent border regions.
     *
     * @param gap - Gap size in pixels.
     */
    setComponentGap(gap: number) : this {
        this._gap = gap;

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

        this._collapsed.set(placement, collapsed);

        const container = this.getContainer();
        if (!container) {
            return this;
        }

        // Materialise the region's gutter so it joins the participant list.
        this.ensureGutter(placement);

        // Every box that moves: the regions (content re-laid-out each frame) and
        // the gutters (geometry only). The toggled region is among them and also
        // clip-reveals; `runCollapse` coordinates the whole pass.
        const regions = [this._northComponent, this._southComponent, this._westComponent, this._eastComponent, this._centerComponent]
            .filter((c): c is Component => c != null);

        const participants: CollapseParticipant[] = [
            ...regions.map(region => ({ component: region, relayout: true })),
            ...[...this._gutters.values()].map(gutter => ({ component: gutter, relayout: false })),
        ];

        this._collapseAnimation = runCollapse(container, component, participants, this._collapseAnimation, () => {
            this._collapseAnimation = null;
        });

        return this;
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
            opaque:             false,
            collapseDirection:  COLLAPSE_CHEVRON[placement],
            expandedBackground: "transparent",
            listeners:          { collapse: () => this.setRegionCollapsed(placement, !this.isRegionCollapsed(placement)) },
        });

        gutter.setVisible(false);

        container.getElement().appendChild(gutter.getElement(true)!);

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
     * Computes the preferred size by summing the preferred sizes of all occupied border regions.
     *
     * @returns The preferred `{width, height}` or `null` if no container is attached.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let innerWidth = 0;
        let innerHeight = 0;

        let middleWidth = 0;
        let middleHeight = 0;

        if (this._northComponent) {
            let size = this._northComponent.getPreferredSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += this.isRegionCollapsed(Placement.NORTH) ? COLLAPSE_STRIP_SIZE : size.height;
            }
        }

        if (this._southComponent) {
            let size = this._southComponent.getPreferredSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += this.isRegionCollapsed(Placement.SOUTH) ? COLLAPSE_STRIP_SIZE : size.height;
            }
        }

        if (this._westComponent) {
            let size = this._westComponent.getPreferredSize();
            if (size) {
                middleWidth += this.isRegionCollapsed(Placement.WEST) ? COLLAPSE_STRIP_SIZE : size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this._centerComponent) {
            let size = this._centerComponent.getPreferredSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this._eastComponent) {
            let size = this._eastComponent.getPreferredSize();
            if (size) {
                middleWidth += this.isRegionCollapsed(Placement.EAST) ? COLLAPSE_STRIP_SIZE : size.width;
                middleHeight += Math.max(middleHeight, size.height);
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

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let innerWidth = 0;
        let innerHeight = 0;

        let middleWidth = 0;
        let middleHeight = 0;

        if (this._northComponent) {
            let size = this._northComponent.getMinSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += this.isRegionCollapsed(Placement.NORTH) ? COLLAPSE_STRIP_SIZE : size.height;
            }
        }

        if (this._southComponent) {
            let size = this._southComponent.getMinSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += this.isRegionCollapsed(Placement.SOUTH) ? COLLAPSE_STRIP_SIZE : size.height;
            }
        }

        if (this._westComponent) {
            let size = this._westComponent.getMinSize();
            if (size) {
                middleWidth += this.isRegionCollapsed(Placement.WEST) ? COLLAPSE_STRIP_SIZE : size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this._centerComponent) {
            let size = this._centerComponent.getMinSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this._eastComponent) {
            let size = this._eastComponent.getMinSize();
            if (size) {
                middleWidth += this.isRegionCollapsed(Placement.EAST) ? COLLAPSE_STRIP_SIZE : size.width;
                middleHeight += Math.max(middleHeight, size.height);
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
     * the `Number.MAX_SAFE_INTEGER` sentinel.
     *
     * @returns The maximum `{width, height}` or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        const INF = Number.MAX_SAFE_INTEGER;
        const maxOf = (component: Component | null): Size | null =>
            component ? (component.getMaxSize() ?? { width: INF, height: INF }) : null;

        const north  = maxOf(this._northComponent);
        const south  = maxOf(this._southComponent);
        const west   = maxOf(this._westComponent);
        const center = maxOf(this._centerComponent);
        const east   = maxOf(this._eastComponent);

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
        let innerWidth = INF;
        if (north)     { innerWidth = Math.min(innerWidth, north.width); }
        if (south)     { innerWidth = Math.min(innerWidth, south.width); }
        if (hasMiddle) { innerWidth = Math.min(innerWidth, middleWidth); }

        // Height stacks the three rows.
        let innerHeight = 0;
        if (north)     { innerHeight += north.height; }
        if (hasMiddle) { innerHeight += middleHeight; }
        if (south)     { innerHeight += south.height; }

        return {
            width:  Math.min(innerWidth  + outerWidth,  INF),
            height: Math.min(innerHeight + outerHeight, INF)
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

        const westMin   = this._westComponent  ?.getMinSize();
        const centerMin = this._centerComponent?.getMinSize();
        const eastMin   = this._eastComponent  ?.getMinSize();
        const northMin  = this._northComponent ?.getMinSize();
        const southMin  = this._southComponent ?.getMinSize();

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
        width += Math.max(0, hContribs.length - 1) * this._gap;

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
        height += Math.max(0, vContribs.length - 1) * this._gap;

        return { width, height };
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

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            throw new Error("Unable to determine component size.");
        }

        let containerInsets = container.getContentInsets();
        if (!containerInsets) {
            throw new Error("Unable to determine component insets.");
        }

        // Universal scroll: see HBox.doLayout for the rationale. Inflates the
        // working size to the children's combined minSize on the axes the
        // host has marked as overflowing.
        if (this.isOverflowingX() || this.isOverflowingY()) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        let width = containerSize.width;
        let height = containerSize.height;
        let centerX;
        let middleY;
        let centerWidth;
        let middleHeight;

        if (this._northComponent) {
            let constraints = this.getLayoutConstraints(this._northComponent);
            if (!constraints) {
                throw new Error("Unable to determine layout constraints for north component.");
            }

            let preferredSize = this._northComponent.getPreferredSize();
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for north component.");
            }

            let northHeight = this.regionExtent(Placement.NORTH, preferredSize.height);
            let northX = constraints.ignoreParentInsets ? 0 : containerInsets.getLeft();
            let northY = constraints.ignoreParentInsets ? 0 : containerInsets.getTop();
            let northWidth = width + (constraints.ignoreParentInsets ? containerInsets.getLeft() + containerInsets.getRight() : 0);
            let northInsetTop = constraints.ignoreParentInsets ? containerInsets.getTop() : 0;

            middleY = northHeight + northInsetTop;

            // The region is always laid out at full size and clipped toward its
            // outer edge while collapsed; the centre and gutter use the strip
            // extent (`middleY`) so they grow into the reclaimed space.
            this.placeComponent(
                this._northComponent,
                northX,
                northY,
                northWidth,
                preferredSize.height + northInsetTop,
                FillType.BOTH
            );
            this.applyRegionClip(this._northComponent, Placement.NORTH);

            this.updateRegionGutter(Placement.NORTH, northX, northY, northWidth, middleY);

            if (this._westComponent || this._centerComponent || this._eastComponent || this._southComponent) {
                middleY += this._gap;
            }
        } else {
            middleY = 0;
        }

        middleHeight = height - middleY;
        if (this._southComponent) {
            let preferredSize = this._southComponent.getPreferredSize();
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for south component.");
            }

            let southHeight = this.regionExtent(Placement.SOUTH, preferredSize.height);
            let southX = containerInsets.getLeft();
            let southY = containerInsets.getTop() + height - southHeight;

            middleHeight -= this._gap;
            middleHeight -= southHeight;

            // Full-size and bottom-anchored, clipped toward the bottom while
            // collapsed; the gutter uses the strip rect (`southY`/`southHeight`).
            let southFullY = containerInsets.getTop() + height - preferredSize.height;

            this.placeComponent(
                this._southComponent,
                southX,
                southFullY,
                width,
                preferredSize.height,
                FillType.BOTH
            );
            this.applyRegionClip(this._southComponent, Placement.SOUTH);

            this.updateRegionGutter(Placement.SOUTH, southX, southY, width, southHeight);
        }

        // Reserve east's preferred width up front so west can be clamped
        // to avoid overlapping east when west.preferred + east.preferred
        // exceeds the container width (e.g. a Window header where the
        // title is wider than the available space between the icon and
        // the trailing buttons).
        let eastPreferredWidth = 0;
        let eastFullWidth = 0;
        if (this._eastComponent) {
            let eastPreferred = this._eastComponent.getPreferredSize();
            if (!eastPreferred) {
                throw new Error("Unable to determine preferred size for east component.");
            }
            eastFullWidth = eastPreferred.width;
            eastPreferredWidth = this.regionExtent(Placement.EAST, eastPreferred.width);
        }

        if (this._westComponent) {
            let preferredSize = this._westComponent.getPreferredSize();
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for west component.");
            }

            let westWidth = Math.max(0, Math.min(this.regionExtent(Placement.WEST, preferredSize.width), width - eastPreferredWidth));
            let westX = containerInsets.getLeft();
            let westY = containerInsets.getTop() + middleY;

            centerX = westWidth;

            // Full-size and left-anchored, clipped toward the left while
            // collapsed; the centre and gutter use the strip extent (`westWidth`).
            let westFullWidth = Math.max(0, Math.min(preferredSize.width, width - eastPreferredWidth));

            this.placeComponent(
                this._westComponent,
                westX,
                westY,
                westFullWidth,
                middleHeight,
                FillType.BOTH
            );
            this.applyRegionClip(this._westComponent, Placement.WEST);

            this.updateRegionGutter(Placement.WEST, westX, westY, westWidth, middleHeight);

            if (this._centerComponent) {
                centerX += this._gap;
            }
        } else {
            centerX = 0;
        }

        centerWidth = width - centerX;

        if (this._eastComponent) {
            centerWidth -= this._gap;
            centerWidth -= eastPreferredWidth;

            let eastX = containerInsets.getLeft() + width - eastPreferredWidth;
            let eastY = containerInsets.getTop() + middleY;

            // Full-size and right-anchored, clipped toward the right while
            // collapsed; the gutter uses the strip rect (`eastX`/`eastPreferredWidth`).
            let eastFullX = containerInsets.getLeft() + width - eastFullWidth;

            this.placeComponent(
                this._eastComponent,
                eastFullX,
                eastY,
                eastFullWidth,
                middleHeight,
                FillType.BOTH
            );
            this.applyRegionClip(this._eastComponent, Placement.EAST);

            this.updateRegionGutter(Placement.EAST, eastX, eastY, eastPreferredWidth, middleHeight);
        }

        if (this._centerComponent) {
            this.placeComponent(this._centerComponent,
                containerInsets.getLeft() + centerX,
                containerInsets.getTop() + middleY,
                centerWidth,
                middleHeight,
                FillType.BOTH
            );
        }
    }

    /**
     * Detaches from the container, removing every lazily-created collapse gutter
     * from the DOM and tearing down its event listeners so a layout-manager swap
     * leaves no orphaned affordances.
     */
    detach(): this {
        super.detach();

        for (const gutter of this._gutters.values()) {
            const element = gutter.getElement();
            element?.parentNode?.removeChild(element);
            gutter.destroy();
        }

        this._gutters.clear();

        return this;
    }
}

const BorderCallable = callable(Border);
type BorderCallable = Border;
export {
    Border         as _Border,
    BorderCallable as Border
};
