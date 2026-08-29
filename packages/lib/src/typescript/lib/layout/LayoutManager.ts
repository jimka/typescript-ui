// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FillType } from "~/layout/FillType.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints";
import { Size, UNBOUNDED } from "~/primitive/Size.js";
import { Component } from "~/core/Component.js";
import type { ComponentFactory } from "~/core/Component.js";
import { BaseObject } from "~/core/BaseObject.js";
import { ListenerBag } from "~/core/ListenerBag.js";

/**
 * Construction-time options shared by every {@link LayoutManager}.
 *
 * @remarks Reserved for future cross-manager fields. Concrete layout managers
 * extend this interface (e.g. {@link HBoxOptions}) with their own fields and
 * dispatch them through `applyOptions`.
 *
 * @category Layouts
 */
export interface LayoutManagerOptions {
}

/**
 * A child's resolved bounds, paired with the component they belong to —
 * the hand-off between a placement loop's calc phase ({@link LayoutManager.resolveBounds})
 * and its commit phase ({@link LayoutManager.commitPlacements}).
 */
export interface ResolvedPlacement {
    component: Component;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Abstract base class for all layout managers.
 * A layout manager is attached to a container component and is responsible for
 * computing size hints and positioning child components within the container.
 *
 * @category Layouts
 */
export abstract class LayoutManager extends BaseObject {

    private _container: Component | null = null;
    private _layoutConstraints: Map<string, LayoutConstraints> = new Map<string, LayoutConstraints>();
    private _defaultPreferredSize: Size | null = null;
    private _defaultMinSize: Size = { width: 0, height: 0 };
    private _defaultMaxSize: Size = { width: UNBOUNDED, height: UNBOUNDED };
    // Per-axis "let children overflow the host" flag. Driven by the host
    // `Panel.setAutoScroll`; consumed by each manager's `doLayout` to decide
    // whether the working size can grow past the host's `innerSize` when the
    // children's combined minSize exceeds it. Default `false` on both axes
    // matches today's clamp-and-clip behaviour.
    private _overflowing: { x: boolean; y: boolean } = { x: false, y: false };
    // Callbacks registered via `registerListenerBag`, run once (in
    // registration order) from `detach()` — the `LayoutManager` counterpart
    // of `Component._destroyCleanups`. A manager subclass (`Tab`, `Split`,
    // `Accordion`, …) is not a `Component`, so it cannot use `onDestroy`;
    // `detach()` is its own equivalent teardown hook (see its doc comment).
    private readonly _detachCleanups: Array<() => void> = [];

    constructor() {
        super();
    }

    /**
     * Applies a {@link LayoutManagerOptions} bag to this layout manager.
     *
     * @param _options - The options bag carrying the values to apply.
     *
     * @remarks The base implementation is a no-op because [`LayoutManagerOptions`](/api/layout/interfaces/LayoutManagerOptions)
     * has no fields of its own. Subclasses override this method to dispatch
     * their additional fields (spacing, gap, stretching, etc.).
     */
    protected applyOptions(_options: LayoutManagerOptions): void {
    }

    /**
     * Offers an unbuilt child to this manager, before the container builds it.
     *
     * Returning `true` claims the factory: the container adds nothing, and this
     * manager owns when — and whether — the factory runs. The base
     * implementation declines, so the container builds the child immediately and
     * adds it like any other.
     *
     * @param _factory - The unbuilt child on offer.
     * @param _constraints - Optional. The layout constraints the caller passed.
     *
     * @returns `true` to claim the factory, `false` to let the container build it.
     */
    addDeferredComponent(_factory: ComponentFactory, _constraints?: LayoutConstraints): boolean {
        return false;
    }

    /**
     * Associates this layout manager with a container component.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component) : this {
        this._container = container;

        return this;
    }

    /**
     * Dissociates this layout manager from its container. A subclass that
     * emits its own custom events through a `ListenerBag` it registered for
     * automatic clearing (`Tab`, `Split`, `Accordion`) is torn down here, so
     * an override MUST end with `super.detach()` or its share of the work is
     * silently skipped.
     */
    detach() : this {
        this._container = null;

        for (const cleanup of this._detachCleanups) {
            cleanup();
        }
        this._detachCleanups.length = 0;

        return this;
    }

    /**
     * Registers `bag` — a `ListenerBag` this layout manager owns as an event
     * emitter — to be cleared when this manager is detached, so every
     * listener still registered on it (and the semantic-listener diagnostic
     * counter it contributed to) is released even though no consumer called
     * `off()`. Mirrors `Component.registerListenerBag`; returns `bag`
     * unchanged, so a subclass can wrap its own field initializer.
     *
     * @param bag - The `ListenerBag` this layout manager emits through.
     * @returns `bag`, unchanged.
     */
    protected registerListenerBag<T extends string>(bag: ListenerBag<T>): ListenerBag<T> {
        this._detachCleanups.push(() => bag.clear());

        return bag;
    }

    /**
     * Returns the container component this layout manager is attached to.
     *
     * @returns The attached container, or `null` if not attached.
     */
    getContainer(): Component | null {
        return this._container;
    }

    /**
     * Returns the default preferred size.
     * Subclasses may override this method to compute the preferred size dynamically.
     *
     * @returns The preferred size, or `null` if not set.
     */
    getPreferredSize(): Size | null {
        return this._defaultPreferredSize;
    }

    /**
     * Returns the minimum size this layout can produce.
     *
     * @returns The minimum size.
     */
    getMinSize(): Size | null {
        return this._defaultMinSize;
    }

    /**
     * Returns the maximum size this layout can produce.
     *
     * @returns The maximum size.
     */
    getMaxSize(): Size | null {
        return this._defaultMaxSize;
    }

    /**
     * Returns whether this layout manager is in "let children overflow" mode
     * on the X axis. Default `false`.
     *
     * @returns `true` when horizontal overflow is enabled.
     */
    protected isOverflowingX(): boolean {
        return this._overflowing.x;
    }

    /**
     * Returns whether this layout manager is in "let children overflow" mode
     * on the Y axis. Default `false`.
     *
     * @returns `true` when vertical overflow is enabled.
     */
    protected isOverflowingY(): boolean {
        return this._overflowing.y;
    }

    /**
     * Computes the children's combined minSize along this manager's geometry.
     * The default is a no-op (`{ width: 0, height: 0 }`); managers that support
     * host-driven overflow scrolling override it to report the min the working
     * size must inflate to. Consumed by {@link LayoutManager.inflateForOverflow}.
     *
     * @returns The total min-size of the children.
     */
    protected computeTotalMinSize(): Size {
        return { width: 0, height: 0 };
    }

    /**
     * Inflates a working container size to the children's combined minSize on
     * whichever axes the host has marked as overflowing (`Panel.setAutoScroll`),
     * so trailing children land past the host's inner rect and its CSS
     * `overflow: auto` produces the scrollbar. Axes the host has not opted into
     * keep the original extent and clamp as before.
     *
     * @param containerSize - The host's real inner size.
     * @returns The working size to lay out against — the original when neither
     *   axis overflows, otherwise inflated to the min total on the active axes.
     */
    protected inflateForOverflow(containerSize: Size): Size {
        if (!this.isOverflowingX() && !this.isOverflowingY()) {
            return containerSize;
        }

        const totalMin = this.computeTotalMinSize();

        return {
            width:  this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width,
            height: this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height,
        };
    }

    /**
     * Sets the per-axis overflow flags. Called by the host `Panel` whenever
     * its `autoScroll` mode changes; subclasses read the resulting state via
     * `isOverflowingX` / `isOverflowingY` in their `doLayout`. Triggers a
     * re-layout when either flag changes.
     *
     * Public so the host `Panel` can drive it; subclasses still consume the
     * resulting state via the `protected` `isOverflowingX` / `isOverflowingY`
     * getters.
     *
     * @param x - True to let children overflow horizontally.
     * @param y - True to let children overflow vertically.
     */
    public setOverflowing(x: boolean, y: boolean): void {
        if (this._overflowing.x === x && this._overflowing.y === y) {
            return;
        }

        this._overflowing = { x, y };

        this.getContainer()?.doLayout();
    }

    /**
     * Reserves the trailing inset in the scrollable area for a scroll-enabled
     * host. Box layouts place children from the leading inset but the trailing
     * inset is otherwise only implicit (the empty space `getInnerSize` leaves),
     * so once children overflow, the host's native scroll extent — driven by
     * the children's boxes — ends flush at the last child and the trailing
     * inset is lost. This wraps the children in a content frame (see
     * [`Component.setContentFrame`](/api/core/classes/Component#setcontentframe))
     * sized to their committed far edge plus the trailing inset, so the host
     * scrolls the frame and both insets are reserved symmetrically.
     *
     * The frame is **persistent** for any scroll-enabled host (either overflow
     * axis active): installed once and only resized thereafter, sized to the
     * children's extent so it shrinks below the viewport — showing no scrollbar
     * — when they fit, and grows past it when they don't. It is never removed
     * as the overflow state toggles. That matters because installing or
     * clearing the frame re-parents the whole child subtree, and moving DOM
     * nodes cancels any in-flight CSS transition on a descendant (e.g. an
     * Accordion section animating open/closed would snap the instant a
     * scrollbar appeared or disappeared). Non-scroll hosts clear any frame —
     * the trailing-inset reserve is only meaningful when scrolling.
     *
     * Call AFTER the placement loop: it reads each child's committed
     * `getX`/`getY`/`getWidth`/`getHeight`, plus `getTranslateX`/`getTranslateY`
     * to account for a child `commitBounds` placed via its size-stable
     * position fast path — such a child's `getX`/`getY` still report the
     * pre-move value, so the translate offset must be added back in to get
     * its true committed extent. The frame parks at the padding-box origin,
     * so the children's coordinates are identical whether they sit in the
     * frame or directly under the element — wrapping them after placement
     * does not move them visually.
     *
     * @returns This layout manager, for method chaining.
     */
    protected reserveContentFrame(): this {
        const container = this.getContainer();
        if (!container) {
            return this;
        }

        const inner      = container.getInnerSize();
        const components  = container.getLaidOutComponents();

        if (!inner || components.length === 0) {
            container.clearContentFrame();

            return this;
        }

        const insets = container.getContentInsets();

        let farRight  = insets.getLeft();
        let farBottom = insets.getTop();

        for (const component of components) {
            farRight  = Math.max(farRight,  component.getX() + component.getTranslateX() + component.getWidth());
            farBottom = Math.max(farBottom, component.getY() + component.getTranslateY() + component.getHeight());
        }

        // Keep a *persistent* content frame for any scroll-enabled host, sized
        // to the children's committed extent — created once on the first pass,
        // only resized afterwards. Sizing it to the content extent (rather than
        // only when that extent exceeds `inner`) means it shrinks below the
        // viewport when the children fit, so no scrollbar shows, yet the frame
        // is never installed/removed as the overflow state toggles. That
        // matters because installing or clearing the frame re-parents the whole
        // child subtree, and moving DOM nodes cancels any in-flight CSS
        // transition on a descendant — e.g. an Accordion section animating
        // open/closed snaps the instant a scrollbar appears or disappears.
        // Non-scroll hosts clear the frame as before (the trailing-inset reserve
        // is only meaningful when scrolling).
        if (this.isOverflowingX() || this.isOverflowingY()) {
            container.setContentFrame(farRight + insets.getRight(), farBottom + insets.getBottom());
        } else {
            container.clearContentFrame();
        }

        return this;
    }

    /**
     * Positions and sizes a child component within the given bounds,
     * respecting fill and anchor constraints.
     *
     * @param component - The child component to position.
     * @param x - Left edge of the cell in the container's coordinate space.
     * @param y - Top edge of the cell in the container's coordinate space.
     * @param maxWidth - Available width for the component.
     * @param maxHeight - Available height for the component.
     * @param fill - Optional. Fill strategy overriding the component's own constraints.
     * @param anchor - Optional. Anchor point overriding the component's own constraints.
     *
     * @remarks The method checks the component's stored [`LayoutConstraints`](/api/layout/classes/LayoutConstraints) first;
     * the `fill` and `anchor` parameters serve as fallbacks. After positioning,
     * `doLayout` is called on the child so nested layouts are updated in a single pass.
     */
    placeComponent(component: Component, x: number, y: number, maxWidth: number, maxHeight: number, fill?: FillType | null, anchor?: AnchorType | null): void {
        const r = this.resolveBounds(component, x, y, maxWidth, maxHeight, fill, anchor);

        this.commitBounds(component, r.x, r.y, r.width, r.height);
    }

    /**
     * Pure resolution of a child's effective bounds within a cell.
     *
     * Reads the child's stored [`LayoutConstraints`](/api/layout/classes/LayoutConstraints), applies the
     * {@link FillType} / {@link AnchorType} policy, clamps the result to
     * `maxWidth`/`maxHeight` and the child's own min/max sizes — the minimum
     * wins when the two conflict — and computes the anchor displacement that
     * centres or pins the child within the cell.
     *
     * Does NOT mutate the [`Component`](/api/core/classes/Component). Layout managers that need to
     * place a child outside the cell (e.g. to let it overflow a scroll panel)
     * can skip this method and call {@link LayoutManager.commitBounds} directly.
     *
     * @param component - The child whose bounds are being resolved.
     * @param x - Left edge of the cell in the container's coordinate space.
     * @param y - Top edge of the cell in the container's coordinate space.
     * @param maxWidth - Available width for the child.
     * @param maxHeight - Available height for the child.
     * @param fill - Optional. Fill strategy overriding the child's own constraints.
     * @param anchor - Optional. Anchor point overriding the child's own constraints.
     * @returns The resolved `{ x, y, width, height }` ready for {@link LayoutManager.commitBounds}.
     */
    protected resolveBounds(component: Component, x: number, y: number, maxWidth: number, maxHeight: number, fill?: FillType | null, anchor?: AnchorType | null): { x: number; y: number; width: number; height: number } {
        const layoutConstraints = this.getLayoutConstraints(component);
        const preferredSize = component.getPreferredSize();
        const size = component.getSize();
        const maxSize = component.getMaxSize();
        const minSize = component.getMinSize();
        let width: number;
        let height: number;

        fill = ((layoutConstraints ? layoutConstraints.fill : undefined) || fill || FillType.NONE) as FillType;
        // `??`, not `||`: AnchorType.NORTHWEST is 0, which `||` would discard as
        // falsy and silently fall through to CENTER. Only null/undefined should
        // mean "unset" here.
        anchor = ((layoutConstraints ? layoutConstraints.anchor : undefined) ?? anchor ?? AnchorType.CENTER) as AnchorType;

        if (fill == FillType.BOTH) {
            width = maxWidth;
            height = maxHeight;
        } else {
            if (fill == FillType.HORIZONTAL) {
                width = maxWidth;
            } else {
                let sw = 0;

                if (preferredSize) {
                    sw = preferredSize.width;
                } else if (size) {
                    sw = size.width;
                }

                if (sw > maxWidth) {
                    sw = maxWidth;
                } else if (sw < 0) {
                    sw = 0;
                }

                if (maxSize && sw > maxSize.width) {
                    sw = maxSize.width;
                }

                if (minSize && sw < minSize.width) {
                    sw = minSize.width;
                }

                width = sw;
            }

            if (fill == FillType.VERTICAL) {
                height = maxHeight;
            } else {
                let sh = 0;

                if (preferredSize) {
                    sh = preferredSize.height;
                } else if (size) {
                    sh = size.height;
                }

                if (sh > maxHeight) {
                    sh = maxHeight;
                } else if (sh < 0) {
                    sh = 0;
                }

                if (maxSize && sh > maxSize.height) {
                    sh = maxSize.height;
                }

                if (minSize && sh < minSize.height) {
                    sh = minSize.height;
                }

                height = sh;
            }
        }

        if (width < maxWidth) {
            let displace;
            switch (anchor) {
                case AnchorType.NORTHWEST:
                case AnchorType.SOUTHWEST:
                case AnchorType.WEST:
                    displace = 0;
                    break;
                case AnchorType.NORTHEAST:
                case AnchorType.SOUTHEAST:
                case AnchorType.EAST:
                    displace = maxWidth - width;
                    break;
                case AnchorType.NORTH:
                case AnchorType.SOUTH:
                case AnchorType.CENTER:
                default:
                    displace = (maxWidth - width) / 2;
            }

            x += displace;
        }

        if (height < maxHeight) {
            let displace;
            switch (anchor) {
                case AnchorType.NORTHWEST:
                case AnchorType.NORTHEAST:
                case AnchorType.NORTH:
                    displace = 0;
                    break;
                case AnchorType.SOUTHWEST:
                case AnchorType.SOUTHEAST:
                case AnchorType.SOUTH:
                    displace = maxHeight - height;
                    break;
                case AnchorType.WEST:
                case AnchorType.EAST:
                case AnchorType.CENTER:
                default:
                    displace = (maxHeight - height) / 2;
            }

            y += displace;
        }

        return { x, y, width, height };
    }

    /**
     * Commits a resolved rect to the child, then recurses into the child's
     * `doLayout`, all wrapped in `setAutoCommitStyle(false/true)` so the
     * positional writes flush as a single DOM update.
     *
     * When the child's `[width, height]` are unchanged from its last commit
     * and it has no CSS transition configured, the position move is written
     * as a compositor-only `transform` (via `setTranslate`) instead of
     * `left`/`top` — cheaper for a size-stable move, measured ~24% faster
     * than a `left`/`top` write on a live microbenchmark. `getX()`/`getY()`
     * keep reporting the pre-move value while this fast path is active; the
     * true visual position is `getX() + getTranslateX()` / `getY() +
     * getTranslateY()`. Any component with a configured transition, or any
     * commit that also changes size, takes the slow path instead — writing
     * real `left`/`top`/`width`/`height` and folding any leftover translate
     * back to `(0, 0)` in the same batch.
     *
     * A commit whose target `(x, y)` already equals the child's true visual
     * position (size unchanged too) also takes the slow path, even though
     * nothing needs to move — a redundant re-layout pass (e.g. a parent
     * `doLayout` cascading through children whose bounds didn't actually
     * change) must not promote `will-change: transform` on a component that
     * isn't moving, and must release any leftover promotion from an earlier
     * move that has since settled. Every setter this branch calls with an
     * already-current value is a cheap no-op, so this costs nothing beyond
     * the comparison itself.
     *
     * Used by {@link LayoutManager.placeComponent} (via {@link LayoutManager.resolveBounds}) and by
     * layout managers that need to bypass the cell clamp — e.g. [`Absolute`](/api/layout/classes/Absolute)
     * places children at their own preferred size, even when that exceeds the
     * container, so a host `Panel` with `autoScroll: "auto"` can scroll the
     * overflow.
     *
     * @param component - The child to update.
     * @param x - Final left position in the container's coordinate space.
     * @param y - Final top position in the container's coordinate space.
     * @param width - Final width.
     * @param height - Final height.
     */
    protected commitBounds(component: Component, x: number, y: number, width: number, height: number): void {
        component.setAutoCommitStyle(false);

        const sizeUnchanged = component.getWidth() === width && component.getHeight() === height;
        const positionUnchanged = x === component.getX() + component.getTranslateX() && y === component.getY() + component.getTranslateY();
        const transition = component.getTransition();
        const canFastPath = sizeUnchanged && !positionUnchanged && (transition === null || transition === "none");

        if (canFastPath) {
            component.setWillChange("transform");
            component.setTranslate(x - component.getX(), y - component.getY());
        } else {
            component.setX(x);
            component.setY(y);
            component.setTranslate(0, 0);
            component.setWillChange(null);
        }

        component.setWidth(width);
        component.setHeight(height);

        component.doLayout();

        component.setAutoCommitStyle(true);
    }

    /**
     * Commits a whole placement loop's resolved rects in order, one child at a
     * time. Pairs with a calc phase that pushed each child's {@link LayoutManager.resolveBounds}
     * result into a `ResolvedPlacement[]` instead of committing it immediately.
     *
     * @param placements - The resolved rects to commit, in placement order.
     */
    protected commitPlacements(placements: ResolvedPlacement[]): void {
        for (const placement of placements) {
            this.commitBounds(placement.component, placement.x, placement.y, placement.width, placement.height);
        }
    }

    /**
     * Stores layout constraints for a component, or removes them if `constraints` is `undefined`.
     *
     * @param component - The component whose constraints are being set.
     * @param constraints - Optional. The constraints to store; omit to delete existing constraints.
     *
     * @returns The stored constraints, or `undefined` if they were deleted.
     */
    setLayoutConstraints(component: Component, constraints?: LayoutConstraints): LayoutConstraints | undefined {
        if (!constraints) {
            return this.delLayoutConstraints(component);
        } else {
            this._layoutConstraints.set(component.getId(), constraints);
            return constraints;
        }
    }

    /**
     * Removes and returns the stored layout constraints for a component.
     *
     * @param component - The component whose constraints should be removed.
     *
     * @returns The removed constraints, or `undefined` if none were stored.
     */
    delLayoutConstraints(component: Component) {
        let constraints = this._layoutConstraints.get(component.getId());

        this._layoutConstraints.delete(component.getId());

        return constraints;
    }

    /**
     * Returns the stored layout constraints for a component.
     *
     * @param component - The component to look up.
     *
     * @returns The stored constraints, or `undefined` if none are set.
     */
    getLayoutConstraints(component: Component) {
        return this._layoutConstraints.get(component.getId());
    }

    /**
     * Computes the y-offset, relative to the row top, for a null-baseline child of the given height.
     *
     * @param height - The child's height.
     * @param rowAscent - The text baseline of the row (max baseline among text-bearing children).
     * @param rowDescent - The text descent of the row (max `height − baseline` among text-bearing children).
     * @returns The y-offset to use when placing the child.
     *
     * @remarks Vertically centres the child within the row's text line height.
     * Tall replaced elements (e.g. an inline [`ProgressSpinner`](/api/component/display/classes/ProgressSpinner)) clamp to 0 and
     * extend below the text. Components that want to align with the surrounding
     * text baseline should expose a real baseline via `getBaseline()` rather
     * than relying on this null-child placement.
     */
    protected nullChildY(height: number, rowAscent: number, rowDescent: number): number {
        const textLineHeight = rowAscent + rowDescent;

        return Math.max(0, (textLineHeight - height) / 2);
    }

    /**
     * Computes the row's text-line metrics from a set of child heights and baselines.
     *
     * @param heights - The per-child heights to consider.
     * @param baselines - The per-child baselines (`null` means "no baseline of my own —
     * graphical or replaced element").
     * @returns `{ rowAscent, rowDescent }`. `rowAscent` is the max baseline among
     * text-bearing children (`null` if none); `rowDescent` is the max
     * `height − baseline` among the same set.
     */
    protected computeRowMetrics(heights: number[], baselines: Array<number | null>): { rowAscent: number | null, rowDescent: number } {
        let rowAscent: number | null = null;
        let rowDescent = 0;

        for (let i = 0; i < baselines.length; i += 1) {
            const b = baselines[i];

            if (b !== null) {
                if (rowAscent === null || b > rowAscent) {
                    rowAscent = b;
                }

                const below = heights[i] - b;
                if (below > rowDescent) {
                    rowDescent = below;
                }
            }
        }

        return { rowAscent, rowDescent };
    }

    /**
     * Computes the row height required to fit all children when their baselines are aligned.
     *
     * @param heights - The per-child heights to consider.
     * @param baselines - The per-child baselines (`null` means "no baseline of my own").
     * @returns The row height, in pixels.
     *
     * @remarks Falls back to `max(heights)` when no child reports a real baseline.
     * Otherwise the row must fit text-bearing children's `rowAscent + rowDescent`
     * AND each null-baseline child's actual placed extent (`y + height`).
     */
    protected computeRowHeight(heights: number[], baselines: Array<number | null>): number {
        const { rowAscent, rowDescent } = this.computeRowMetrics(heights, baselines);

        if (rowAscent === null) {
            let maxAnyHeight = 0;

            for (const h of heights) {
                if (h > maxAnyHeight) {
                    maxAnyHeight = h;
                }
            }

            return maxAnyHeight;
        }

        let result = rowAscent + rowDescent;

        for (let i = 0; i < heights.length; i += 1) {
            if (baselines[i] === null) {
                const y = this.nullChildY(heights[i], rowAscent, rowDescent);
                const extent = y + heights[i];

                if (extent > result) {
                    result = extent;
                }
            }
        }

        return result;
    }

    /**
     * Returns the container's own baseline, measured from its content-top
     * (inside insets/border/padding), or `null` when this layout exposes no
     * meaningful baseline.
     *
     * @returns The inner baseline offset in pixels, or `null`.
     *
     * @remarks The default is `null` (no baseline). Baseline-aware layouts
     * override this so a container placed in a parent's baseline row aligns by
     * its content's baseline instead of auto-centring. `Component.getBaseline`
     * wraps the returned value with the container's chrome.
     */
    getContentBaseline(): number | null {
        return null;
    }

    abstract doLayout(): void;
};
