// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { SplitGutter } from "~/component/container/SplitGutter.js";
import { CollapseDirection } from "~/component/container/CollapseButton.js";
import { Component } from "~/core/Component.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { COLLAPSE_STRIP_SIZE, runCollapse, CollapseParticipant } from "~/layout/CollapseSupport.js";
import { callable } from "~/core/Callable.js";

// Pixel thickness of a single draggable gutter. The main-axis sizing math
// subtracts the gutters' combined footprint before dividing space among
// panes, so this constant is the single source of truth for both the size
// reservation and the gutter placement in `doLayout`.
const GUTTER_SIZE = 4;

/**
 * Construction-time options for {@link Split}.
 *
 * @category Layouts
 */
export interface SplitOptions extends LayoutManagerOptions {
    direction?: string;
    /** Indices of panes to start collapsed (applied on first layout). */
    collapsedPanes?: number[];
}

/**
 * A layout manager that splits the container into two or more resizable panels
 * separated by draggable gutter elements.
 * The split direction can be `'horizontal'` (panels side by side) or `'vertical'` (panels stacked).
 *
 * @category Layouts
 */
class Split extends LayoutManager {

    private _direction: String = "horizontal";
    private _sizes: Map<Component, number> = new Map<Component, number>();
    private _gutters: Array<SplitGutter> = [];

    // Per-pane collapsed state, paralleling `_sizes`. A collapsed pane keeps its
    // stored size untouched so a restore returns it to the same ratio; only the
    // displayed geometry in `doLayout` substitutes the strip thickness. The
    // pane's own gutter becomes the visible strip while collapsed.
    private _collapsed: Map<Component, boolean> = new Map<Component, boolean>();

    // Pane indices to collapse on the first connected layout, taken from the
    // `collapsedPanes` option. Drained once because pane components aren't
    // resolvable from indices until the container has its children.
    private _pendingCollapsed: number[] = [];

    private _dragOriginPointer: number = 0;
    private _dragOriginLhsSize: number = 0;
    private _dragOriginRhsSize: number = 0;

    // The available (net-of-gutters) main-axis extent the stored `_sizes`
    // were last normalised against. Lets `recalculateSizes` rescale the
    // frozen pane sizes when the container grows or shrinks, so panes keep
    // filling the container across viewport resizes. `0` until the first
    // connected layout, which correctly suppresses the rescale pass.
    private _lastAvailableMain: number = 0;

    // Canceller for the in-flight collapse/restore animation, or null when
    // idle. Calling it stops the rAF loop in place so a rapid re-toggle can
    // re-snapshot the current geometry and retarget without two loops fighting.
    private _collapseAnimation: (() => void) | null = null;

    constructor(direction?: String | SplitOptions, options?: SplitOptions) {
        super();

        if (direction === undefined || typeof direction === 'string' || direction instanceof String) {
            if (direction) {
                this._direction = direction;
            }

            if (options) {
                this.applyOptions(options);
            }
        } else {
            this.applyOptions(direction);
        }
    }

    /**
     * Applies a {@link SplitOptions} bag, dispatching the split direction
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: SplitOptions): void {
        super.applyOptions(options);

        if (options.direction !== undefined) {
            this.setDirection(options.direction);
        }

        if (options.collapsedPanes !== undefined) {
            this._pendingCollapsed = [...options.collapsedPanes];
        }
    }

    /**
     * Returns whether the pane at the given container index is collapsed.
     *
     * @param index - Zero-based pane index.
     * @returns True when the pane is collapsed; false when expanded or the
     *   index is out of range.
     */
    isPaneCollapsed(index: number): boolean {
        const container = this.getContainer();
        if (!container) {
            return false;
        }

        const pane = container.getComponents()[index];

        return pane ? (this._collapsed.get(pane) ?? false) : false;
    }

    /**
     * Whether a collapse direction heads toward the split's leading edge
     * (`west`/`north`) rather than its trailing edge (`east`/`south`). A
     * leading-collapsing pane tucks into a strip made from the gutter on its
     * trailing side; a trailing-collapsing one uses the gutter on its leading
     * side (which is how the otherwise-gutterless last pane collapses).
     *
     * @param direction - The collapse heading to classify.
     * @returns True for `west`/`north`.
     */
    private collapsesTowardStart(direction: CollapseDirection): boolean {
        return direction === "west" || direction === "north";
    }

    /**
     * Resolves a pane's configured collapse direction, defaulting to the
     * leading direction for the split's axis (`west` horizontal, `north`
     * vertical) when its constraint leaves it unset.
     *
     * @param pane - The pane whose direction to resolve.
     * @returns The effective collapse heading.
     */
    private paneDirection(pane: Component): CollapseDirection {
        const constraints = this.getLayoutConstraints(pane);

        return constraints?.collapseDirection ?? (this._direction === "horizontal" ? "west" : "north");
    }

    /**
     * Returns the index of the pane that gutter `gutterIndex` collapses, or
     * `-1` when it collapses neither neighbour (a plain divider with no
     * chevron). The trailing pane claims the gutter when it opts to collapse
     * toward the end; otherwise the leading pane uses it to collapse toward the
     * start. The two are mutually exclusive, so no pane is served by two gutters.
     *
     * @param gutterIndex - The gutter between panes `gutterIndex` and `gutterIndex + 1`.
     * @param components - The container's current panes.
     * @returns The served pane index, or `-1`.
     */
    private gutterTargetPane(gutterIndex: number, components: Array<Component>): number {
        const next = components[gutterIndex + 1];
        if (next && !this.collapsesTowardStart(this.paneDirection(next))) {
            return gutterIndex + 1;
        }

        const lead = components[gutterIndex];
        if (lead && this.collapsesTowardStart(this.paneDirection(lead))) {
            return gutterIndex;
        }

        return -1;
    }

    /**
     * Returns the index of the gutter that collapses the pane at `index`, or
     * `-1` when the pane cannot collapse — no gutter on the side its direction
     * needs, or that gutter is claimed by the adjacent pane. A leading-collapsing
     * pane uses its trailing gutter; a trailing-collapsing one uses its leading
     * gutter (the mechanism that lets the last pane collapse).
     *
     * @param index - The pane index.
     * @param components - The container's current panes.
     * @returns The serving gutter index, or `-1`.
     */
    private paneServingGutter(index: number, components: Array<Component>): number {
        const direction = this.paneDirection(components[index]);

        if (this.collapsesTowardStart(direction)) {
            return index < components.length - 1 && this.gutterTargetPane(index, components) === index ? index : -1;
        }

        return index > 0 && this.gutterTargetPane(index - 1, components) === index ? index - 1 : -1;
    }

    /**
     * Collapses or restores the pane at the given container index, animating the
     * change. The pane's own gutter slides to the pane's outer edge and widens
     * into the opaque collapse strip (cross-fading its fill) while the pane keeps
     * its full size and reveals via a clip-path; the freed main-axis space is
     * redistributed to the remaining expanded panes. The whole pass is one
     * coordinated animation: the toggled pane clip-reveals while every other pane
     * and the gutters interpolate their geometry — re-laying out their contents
     * each frame — in lockstep (see `CollapseSupport.runCollapse`).
     *
     * The serving gutter depends on the pane's `collapseDirection` constraint: a
     * leading-collapsing pane (the default) uses the gutter on its trailing side,
     * a trailing-collapsing one the gutter on its leading side — which is how the
     * last pane collapses. A pane with no serving gutter cannot collapse.
     *
     * @param index - Zero-based pane index.
     * @param collapsed - True to collapse, false to restore.
     * @returns This layout manager, for method chaining.
     */
    setPaneCollapsed(index: number, collapsed: boolean): this {
        const container = this.getContainer();
        if (!container) {
            return this;
        }

        const components = container.getComponents();
        const pane       = components[index];
        if (!pane) {
            return this;
        }

        const gutterIndex = this.paneServingGutter(index, components);
        if (gutterIndex < 0) {
            return this;
        }

        const current = this._collapsed.get(pane) ?? false;
        if (current === collapsed) {
            return this;
        }

        this._collapsed.set(pane, collapsed);

        // Every box that moves: the panes (content re-laid-out each frame) and
        // the gutters (geometry only). The toggled pane is among them and also
        // clip-reveals; `runCollapse` coordinates the whole pass.
        const participants: CollapseParticipant[] = [
            ...components.map(component => ({ component, relayout: true })),
            ...this._gutters.map(gutter => ({ component: gutter, relayout: false })),
        ];

        this._collapseAnimation = runCollapse(container, pane, participants, this._collapseAnimation, () => {
            this._collapseAnimation = null;
        });

        return this;
    }

    /**
     * Returns the split direction.
     *
     * @returns `'horizontal'` or `'vertical'`.
     */
    getDirection() {
        return this._direction;
    }

    /**
     * Sets the split direction.
     *
     * @param direction - `'horizontal'` for side-by-side panels, `'vertical'` for stacked panels.
     */
    setDirection(direction: String) : this {
        this._direction = direction;

        return this;
    }

    /**
     * Returns the stored pane sizes normalised to sum 1.0, in container child
     * order. Captures the user's split ratios for serialization; ratios are
     * viewport-independent, so they survive a restore into a differently-sized
     * container (`Split` rescales px against the live extent on the next layout).
     *
     * @returns One ratio per pane in child order, summing to ~1.0; an equal
     *   split when no sizes are stored yet, or `[]` when detached.
     */
    getPaneRatios(): number[] {
        const container = this.getContainer();
        if (!container) {
            return [];
        }

        const components = container.getComponents();
        if (components.length === 0) {
            return [];
        }

        const sizes = components.map(component => this._sizes.get(component) ?? 0);
        const sum   = sizes.reduce((total, size) => total + size, 0);

        return sum > 0 ? sizes.map(size => size / sum) : components.map(() => 1 / components.length);
    }

    /**
     * Writes pane ratios captured by {@link getPaneRatios} back onto the live
     * panes, by container child order. The input is treated as relative weights
     * (re-normalised internally), so a caller that dropped a pane on restore can
     * pass a short or non-unit array without skewing the result.
     *
     * @remarks Stored sizes are px, so the ratios are seeded against a positive
     * base extent: the live inner main-axis extent when the container is already
     * sized (no rescale needed next layout), else a unit base that
     * `recalculateSizes` scales up on the first connected layout. `_lastAvailableMain`
     * is reset to that same base so the next layout does not double-rescale the
     * freshly-written sizes.
     *
     * @param ratios - Relative pane weights in child order.
     * @returns This layout manager, for method chaining.
     */
    applyPaneRatios(ratios: number[]): this {
        const container = this.getContainer();
        if (!container) {
            return this;
        }

        const components = container.getComponents();
        const count      = components.length;
        if (count === 0) {
            return this;
        }

        const weights = components.map((_, idx) => Math.max(0, ratios[idx] ?? 0));
        const sum     = weights.reduce((total, weight) => total + weight, 0);
        const norm    = sum > 0 ? weights.map(weight => weight / sum) : components.map(() => 1 / count);

        // Seed the stored px against a positive base. When the container is laid
        // out, use its real net-of-gutters main extent so the next layout needs
        // no rescale; otherwise use 1 and let `recalculateSizes` scale the
        // ratio-invariant sizes up on the first connected layout.
        const innerSize = container.getInnerSize();
        const main      = innerSize ? (this._direction === "horizontal" ? innerSize.width : innerSize.height) : 0;
        const available = Math.max(0, main - this.gutterTotal(count));
        const base      = available > 0 ? available : 1;

        components.forEach((component, idx) => {
            this._sizes.set(component, norm[idx] * base);
        });

        this._lastAvailableMain = base;

        container.scheduleLayout();

        return this;
    }

    /**
     * Collapses or restores the pane at the given index **without animating** —
     * the geometry change lands on the next layout pass. Unlike
     * {@link setPaneCollapsed} (which runs a coordinated rAF animation), this is
     * for bulk restore, where N concurrent collapse animations would fight over
     * geometry. Sets the collapsed flag directly; `doLayout` substitutes the
     * strip thickness for a collapsed pane that has a serving gutter.
     *
     * @param index - Zero-based pane index.
     * @param collapsed - True to collapse, false to expand.
     * @returns This layout manager, for method chaining.
     */
    setPaneCollapsedImmediate(index: number, collapsed: boolean): this {
        const container = this.getContainer();
        if (!container) {
            return this;
        }

        const pane = container.getComponents()[index];
        if (!pane) {
            return this;
        }

        this._collapsed.set(pane, collapsed);

        container.scheduleLayout();

        return this;
    }

    /**
     * Captures the drag origin when a gutter's drag begins: the absolute
     * pointer coordinate and the current sizes of the two adjacent panels.
     * Subsequent `drag` events derive the new sizes from these origins so
     * over-travel past a panel's minimum is absorbed without decoupling the
     * gutter from the cursor on reversal.
     *
     * @param container - The container component that owns the panels.
     * @param gutter - The gutter whose drag is starting.
     * @param position - The absolute pointer coordinate (`clientX`/`clientY`)
     *   in the split axis at the moment the drag began.
     */
    onDragStart(container: Component, gutter: SplitGutter, position: number) {
        let gutterIdx = this._gutters.indexOf(gutter);
        let lhs = container.getComponents()[gutterIdx];
        let rhs = container.getComponents()[gutterIdx + 1];

        this._dragOriginPointer = position;

        if (this._direction === "horizontal") {
            this._dragOriginLhsSize = lhs.getWidth();
            this._dragOriginRhsSize = rhs.getWidth();
        } else {
            this._dragOriginLhsSize = lhs.getHeight();
            this._dragOriginRhsSize = rhs.getHeight();
        }
    }

    /**
     * Adjusts the sizes of the two panels adjacent to a gutter when it is dragged.
     *
     * @param container - The container component that owns the panels.
     * @param gutter - The gutter being dragged.
     * @param position - The absolute pointer coordinate (`clientX`/`clientY`) in
     *   the split axis for this move.
     *
     * @remarks The new panel sizes are computed from the drag origin captured in
     * {@link onDragStart} as `origin + (position − originPointer)`, then clamped
     * against each panel's minimum size while conserving the pair's combined
     * size. Clamping the absolute result (rather than accumulating per-move
     * deltas) means dragging past a panel's minimum is idempotent: the panel
     * stays at its floor until the pointer returns past the boundary
     * coordinate. The stored sizes for both affected panels are updated so the
     * next `doLayout` call preserves the user-defined split ratio.
     */
    onDrag(container: Component, gutter: SplitGutter, position: number) {
        let gutterIdx = this._gutters.indexOf(gutter);
        let lhs = container.getComponents()[gutterIdx];
        let rhs = container.getComponents()[gutterIdx + 1];

        const horizontal = this._direction === "horizontal";
        const total      = this._dragOriginLhsSize + this._dragOriginRhsSize;

        const lhsMin = lhs.getMinSize();
        const rhsMin = rhs.getMinSize();
        const minLhs = lhsMin ? (horizontal ? lhsMin.width : lhsMin.height) : 0;
        const minRhs = rhsMin ? (horizontal ? rhsMin.width : rhsMin.height) : 0;

        const offset = position - this._dragOriginPointer;

        let newLhs = this._dragOriginLhsSize + offset;
        newLhs = Math.max(minLhs, Math.min(total - minRhs, newLhs));

        const newRhs    = total - newLhs;
        const dragAmount = newLhs - (horizontal ? lhs.getWidth() : lhs.getHeight());

        if (horizontal) {
            lhs.setWidth(newLhs);
            gutter.setX(gutter.getX() + dragAmount);
            rhs.setX(rhs.getX() + dragAmount);
            rhs.setWidth(newRhs);
        } else {
            lhs.setHeight(newLhs);
            gutter.setY(gutter.getY() + dragAmount);
            rhs.setY(rhs.getY() + dragAmount);
            rhs.setHeight(newRhs);
        }

        this._sizes.set(lhs, newLhs);
        this._sizes.set(rhs, newRhs);

        lhs.doLayout();
        rhs.doLayout();
    }

    /**
     * Detaches from the container and removes all gutter elements from the DOM.
     */
    detach() : this {
        super.detach();

        for (let idx in this._gutters) {
            let gutter = this._gutters[idx];

            let gutterElement = gutter.getElement();
            (gutterElement.parentNode as Node).removeChild(gutterElement);
            gutter.destroy();
        }

        this._gutters = [];

        return this;
    }

    /**
     * Returns the combined pixel footprint of all gutters for a given pane
     * count: one gutter sits between each adjacent pane pair.
     *
     * @param componentCount - The number of panes in the container.
     *
     * @returns The total gutter thickness along the split axis.
     */
    private gutterTotal(componentCount: number): number {
        return Math.max(0, componentCount - 1) * GUTTER_SIZE;
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * along the split axis the per-pane `_sizes` are the user's floor (their
     * sum is the total); the cross-axis follows the max child minSize. Used
     * by `doLayout` to inflate the working size when the host has opted into
     * `setOverflowing`.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        const components = container.getComponents();
        if (components.length === 0) {
            return { width: 0, height: 0 };
        }

        const gutterCount = components.length - 1;

        let splitTotal = 0;
        let crossMax = 0;

        for (let idx = 0; idx < components.length; idx += 1) {
            const component = components[idx];
            const stored    = this._sizes.get(component);
            const collapsed = this._collapsed.get(component) ?? false;
            const hasGutter = idx < gutterCount;

            if (collapsed && hasGutter) {
                // The gutter→strip covers this pane's whole slot: a single
                // strip thickness, no separate divider.
                splitTotal += COLLAPSE_STRIP_SIZE;
            } else {
                if (!collapsed) {
                    if (stored != null) {
                        splitTotal += stored;
                    } else {
                        const min = component.getMinSize();
                        if (min) {
                            splitTotal += this._direction === "horizontal" ? min.width : min.height;
                        }
                    }
                }

                if (hasGutter) {
                    splitTotal += GUTTER_SIZE;
                }
            }

            const min = component.getMinSize();
            if (min) {
                crossMax = Math.max(crossMax, this._direction === "horizontal" ? min.height : min.width);
            }
        }

        return this._direction === "horizontal"
            ? { width: splitTotal, height: crossMax }
            : { width: crossMax,   height: splitTotal };
    }

    /**
     * Creates missing gutters, computes panel sizes, and positions all panels and gutters.
     *
     * @remarks New [`SplitGutter`](/api/component/container/classes/SplitGutter) instances are appended to the container's DOM element on first layout.
     * Existing gutters are reused on subsequent layouts.
     */
    doLayout() {
        let me = this;
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        // Universal scroll: see HBox.doLayout for the rationale. When the
        // host has marked the corresponding axis as overflowing, grow the
        // working size past the host's inner rect so trailing panes land
        // past `innerSize` and the host's CSS `overflow: auto` produces a
        // scrollbar.
        if (this.isOverflowingX() || this.isOverflowingY()) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        let element = container.getElement();
        let components = container.getComponents();
        let containerInsets = container.getContentInsets();

        let componentCount = components.length;
        let gutterCount = componentCount - 1;

        for (let i = this._gutters.length; i < gutterCount; i += 1) {
            // Transparent divider track (like Border): only the chevron grip
            // shows in the expanded state; the gutter paints itself only once
            // collapsed into its button-styled strip.
            let gutter = new SplitGutter(this._direction, { expandedBackground: "transparent" });
            let gutterIndex = i;

            gutter.on("dragstart", function (position: number) {
                me.onDragStart(<Component>container, gutter, position);
            });
            gutter.on("drag", function (position: number) {
                me.onDrag(<Component>container, gutter, position);
            });
            gutter.on("collapse", function () {
                // The chevron toggles whichever neighbour this gutter serves —
                // its leading pane by default, or a trailing pane that opted to
                // collapse toward the end.
                const target = me.gutterTargetPane(gutterIndex, (<Component>container).getComponents());
                if (target >= 0) {
                    me.setPaneCollapsed(target, !me.isPaneCollapsed(target));
                }
            });

            this._gutters.push(gutter);

            element.appendChild(gutter.getElement(true));
        }

        let x = containerInsets.getLeft();
        let y = containerInsets.getTop();

        this.recalculateSizes();
        this.applyPendingCollapsed(components);

        const horizontal = this._direction === "horizontal";
        const crossSize  = horizontal ? containerSize.height : containerSize.width;
        const mainSizes  = this.computeMainAxisSizes(components);

        // Gutters placed this pass (as a strip or a divider); the rest are
        // hidden afterward — e.g. the trailing gutter of a pane collapsed
        // toward the end, whose strip is the leading gutter instead.
        const placed = new Set<number>();

        for (let idx = 0; idx < components.length; idx += 1) {
            const component  = components[idx];
            const servingIdx = this.paneServingGutter(idx, components);
            const collapsed  = (this._collapsed.get(component) ?? false) && servingIdx >= 0;

            if (collapsed) {
                // The serving gutter becomes the opaque strip in this pane's
                // slot; the pane hides behind it. The strip lands in the same
                // slot whichever side the pane collapses toward — only the
                // chevron heading and which gutter animates differ.
                const gutter = this._gutters[servingIdx];

                gutter.setCollapseDirection(this.paneDirection(component));
                gutter.setCollapsible(true);
                this.placeGutterAsStrip(gutter, component, x, y, crossSize, horizontal, this.paneDirection(component));
                placed.add(servingIdx);

                if (horizontal) {
                    x += COLLAPSE_STRIP_SIZE;
                } else {
                    y += COLLAPSE_STRIP_SIZE;
                }

                continue;
            }

            const mainSize = mainSizes.get(component) as number;

            component.setVisible(true);

            this.placeComponent(
                component,
                x,
                y,
                horizontal ? mainSize  : crossSize,
                horizontal ? crossSize : mainSize,
                FillType.BOTH
            );

            // A collapsible pane keeps `inset(0)` as the expanded keyframe so a
            // restore animates its clip back open; a pane that can't collapse
            // carries no clip-path at all.
            component.setClipPath(servingIdx >= 0 ? "inset(0 0 0 0)" : null);

            if (horizontal) {
                x += mainSize;
            } else {
                y += mainSize;
            }

            if (idx < gutterCount) {
                const gutter = this._gutters[idx];
                const target = this.gutterTargetPane(idx, components);

                // When this gutter is the strip for a collapsed trailing pane,
                // the strip is placed in that pane's own slot — skip the divider
                // here and let the gutter hide between the strip and this pane.
                const targetIsCollapsedStrip = target >= 0
                    && (this._collapsed.get(components[target]) ?? false)
                    && this.paneServingGutter(target, components) === idx;

                if (!targetIsCollapsedStrip && !placed.has(idx)) {
                    // Expanded divider: a thin draggable gutter whose chevron (if
                    // any) collapses the neighbour it serves.
                    gutter.setOpaque(false);
                    gutter.setVisible(true);
                    gutter.setCollapsible(target >= 0);
                    if (target >= 0) {
                        gutter.setCollapseDirection(this.paneDirection(components[target]));
                    }
                    gutter.setX(x);
                    gutter.setY(y);

                    if (horizontal) {
                        gutter.setWidth(GUTTER_SIZE);
                        gutter.setHeight(crossSize);

                        x += GUTTER_SIZE;
                    } else {
                        gutter.setWidth(crossSize);
                        gutter.setHeight(GUTTER_SIZE);

                        y += GUTTER_SIZE;
                    }

                    placed.add(idx);
                }
            }
        }

        for (let i = 0; i < this._gutters.length; i += 1) {
            if (!placed.has(i)) {
                this._gutters[i].setVisible(false);
            }
        }
    }

    /**
     * Places a pane's gutter as the opaque collapse strip occupying the pane's
     * slot, and hides the pane behind it. The gutter is the only visible
     * affordance for a collapsed pane; it animates into this geometry from its
     * expanded divider position.
     *
     * @param gutter - The pane's gutter, repurposed as the strip.
     * @param pane - The collapsed pane, clipped away behind the strip.
     * @param x - The slot's left position.
     * @param y - The slot's top position.
     * @param crossSize - The container's cross-axis extent.
     * @param horizontal - Whether the split runs horizontally.
     * @param direction - The pane's collapse heading, fixing the clip edge.
     */
    private placeGutterAsStrip(gutter: SplitGutter, pane: Component, x: number, y: number, crossSize: number, horizontal: boolean, direction: CollapseDirection): void {
        gutter.setOpaque(true);
        gutter.setVisible(true);
        gutter.setX(x);
        gutter.setY(y);

        if (horizontal) {
            gutter.setWidth(COLLAPSE_STRIP_SIZE);
            gutter.setHeight(crossSize);
        } else {
            gutter.setWidth(crossSize);
            gutter.setHeight(COLLAPSE_STRIP_SIZE);
        }

        // The pane stays visible at its full stored size and clips toward its
        // outer (collapse-direction) edge, retreating into the strip rather than
        // vanishing. It can't shrink past its min-size, so the clip — not a width
        // change — is what hides it. It is anchored at the strip on the side it
        // collapses toward so the retreating edge tucks into the strip.
        const fullMain    = this._sizes.get(pane) ?? COLLAPSE_STRIP_SIZE;
        const towardStart = this.collapsesTowardStart(direction);

        pane.setVisible(true);

        if (horizontal) {
            const paneX = towardStart ? x : x + COLLAPSE_STRIP_SIZE - fullMain;
            this.placeComponent(pane, paneX, y, fullMain, crossSize, FillType.BOTH);
        } else {
            const paneY = towardStart ? y : y + COLLAPSE_STRIP_SIZE - fullMain;
            this.placeComponent(pane, x, paneY, crossSize, fullMain, FillType.BOTH);
        }

        pane.setClipPath(this.paneClipInset(direction));
    }

    /**
     * Returns the `clip-path` inset that clips a pane toward its outer edge for
     * the given collapse heading, used to animate a collapse into (or expand out
     * of) the strip.
     *
     * @param direction - The collapse heading.
     * @returns A CSS `clip-path` inset string.
     */
    private paneClipInset(direction: CollapseDirection): string {
        switch (direction) {
            case "east":  return "inset(0 0 0 100%)";
            case "north": return "inset(0 0 100% 0)";
            case "south": return "inset(100% 0 0 0)";
            default:      return "inset(0 100% 0 0)";
        }
    }

    /**
     * Drains the `collapsedPanes` option into `_collapsed` on the first layout
     * where the panes are resolvable. Runs once: pane components can't be looked
     * up from indices until the container has its children.
     *
     * @param components - The container's current child panes.
     */
    private applyPendingCollapsed(components: Array<Component>): void {
        if (this._pendingCollapsed.length === 0) {
            return;
        }

        for (const index of this._pendingCollapsed) {
            const pane = components[index];

            // Only a pane with a serving gutter can collapse.
            if (pane && this.paneServingGutter(index, components) >= 0) {
                this._collapsed.set(pane, true);
            }
        }

        this._pendingCollapsed = [];
    }

    /**
     * Computes each expanded pane's main-axis extent. A collapsed pane reports
     * `0` — it is hidden and its gutter, rendered as the opaque strip, occupies
     * the `COLLAPSE_STRIP_SIZE` slot in its place. The space the collapsed panes
     * (and the gutter→strip thickness change) free flows back to the expanded
     * panes in proportion to their stored sizes, so the layout always fills the
     * container and the expanded panes keep their relative ratio.
     *
     * @param components - The container's current child panes.
     * @returns A map from pane to its displayed main-axis size (`0` when collapsed).
     */
    private computeMainAxisSizes(components: Array<Component>): Map<Component, number> {
        const gutterCount = components.length - 1;

        let available      = 0;   // Σ of all stored sizes (= inner − gutterTotal)
        let expandedStored = 0;
        let strips         = 0;   // collapsed panes (each turns a gutter into a strip)
        let hidden         = 0;   // gutters hidden by a toward-end collapse

        for (let idx = 0; idx < components.length; idx += 1) {
            const component = components[idx];
            const stored    = this._sizes.get(component) ?? 0;

            available += stored;

            const collapsed = (this._collapsed.get(component) ?? false) && this.paneServingGutter(idx, components) >= 0;

            if (collapsed) {
                strips += 1;

                // A pane collapsing toward the end uses its *leading* gutter as
                // the strip, leaving its trailing gutter (when it has one)
                // hidden — that 4px divider is reclaimed by the expanded panes.
                if (!this.collapsesTowardStart(this.paneDirection(component)) && idx < gutterCount) {
                    hidden += 1;
                }
            } else {
                expandedStored += stored;
            }
        }

        // Each collapsed pane's gutter becomes a `COLLAPSE_STRIP_SIZE` strip in
        // place of the `GUTTER_SIZE` divider it would otherwise be, the pane
        // itself yields its whole slot, and any hidden divider is reclaimed. The
        // expanded panes absorb the rest, so panes + strips + visible dividers
        // still sum to the inner extent.
        const expandedTotal = Math.max(0, available - strips * (COLLAPSE_STRIP_SIZE - GUTTER_SIZE) + hidden * GUTTER_SIZE);
        const factor        = expandedStored > 0 ? expandedTotal / expandedStored : 0;

        const sizes = new Map<Component, number>();

        for (let idx = 0; idx < components.length; idx += 1) {
            const component = components[idx];
            const collapsed = (this._collapsed.get(component) ?? false) && this.paneServingGutter(idx, components) >= 0;

            sizes.set(component, collapsed ? 0 : (this._sizes.get(component) ?? 0) * factor);
        }

        return sizes;
    }

    /**
     * Assigns initial sizes to any components that do not yet have a stored size.
     *
     * @remarks When some panels already have stored sizes and a new panel is added,
     * its size is taken proportionally from the existing panels so the total remains constant.
     * When no panels have stored sizes the available container dimension is divided equally.
     */
    recalculateSizes() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        let components = container.getComponents();

        // `getInnerSize` already removed the perimeter (insets + border +
        // padding); the only thing the panes don't get is the gutters, so the
        // space to divide is the inner main axis minus the gutter footprint.
        // `doLayout` places panes from `getContentInsets` and advances by this
        // same gutter total, so a pane sum of `available` lands flush with the
        // inner edge — no `gutterCount × GUTTER_SIZE` overflow.
        let main = this._direction === "horizontal" ? containerSize.width : containerSize.height;
        let available = Math.max(0, main - this.gutterTotal(components.length));

        // Rescale the frozen pane sizes to the new extent so they keep filling
        // the container across viewport resizes. Ratios are scale-invariant, so
        // multiplying every stored size by the same factor preserves any split
        // the user dragged. Skipped on the first connected layout
        // (`_lastAvailableMain` is still 0) and when nothing changed.
        if (this._lastAvailableMain > 0 && available > 0 && available !== this._lastAvailableMain && this._sizes.size > 0) {
            let factor = available / this._lastAvailableMain;

            for (let idx = 0; idx < components.length; idx += 1) {
                let component = components[idx];
                let stored = this._sizes.get(component);

                if (stored != undefined) {
                    this._sizes.set(component, stored * factor);
                }
            }
        }

        let componentsWithSize = 0;

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];

            if (this._sizes.has(component)) {
                componentsWithSize += 1;
            }
        }

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            let componentSize = this._sizes.get(component);

            if (componentSize == undefined) {
                if (this._sizes.size != 0) {
                    componentSize = 0;

                    for (let jdx = 0; jdx < components.length; jdx += 1) {
                        let c = components[jdx];
                        let cSize = this._sizes.get(c);

                        if(cSize == undefined) {
                            continue;
                        }

                        let sizeFraction = cSize * (1 / (componentsWithSize + 1));
                        componentSize += sizeFraction;
                        cSize -= sizeFraction;

                        this._sizes.set(c, cSize);
                    }
                } else {
                    componentSize = available;
                }

                this._sizes.set(component, componentSize);
                componentsWithSize += 1;
            }
        }

        // Only remember a positive extent. If the container collapsed below the
        // gutter footprint (`available == 0`) the stored sizes were left frozen,
        // so keeping the last positive baseline lets the next growth rescale
        // them back to fill instead of stranding the pre-collapse sizes.
        if (available > 0) {
            this._lastAvailableMain = available;
        }
    }
}

const SplitCallable = callable(Split);
type SplitCallable = Split;
export {
    Split         as _Split,
    SplitCallable as Split
};
