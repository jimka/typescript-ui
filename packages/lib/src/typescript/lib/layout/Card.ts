// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js"
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { Component } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Card}.
 *
 * @category Layouts
 */
export interface CardOptions extends LayoutManagerOptions {
    visibleComponentId?: string;
}

/**
 * A layout manager that shows exactly one child component at a time,
 * sizing it to fill the container's inner bounds.
 * The visible child is selected by component ID; all others are undisplayed
 * (`display: none`), dropping them out of the render tree entirely.
 *
 * @category Layouts
 */
class Card extends LayoutManager {

    private _visibleComponentId: string | null = null;
    private _currentVisible: Component | null = null;

    // Framework bookkeeping, not consumer configuration — see the
    // undisplay-inactive-tab-pages plan's `## Public API` for why this stays
    // off `CardOptions`. `syncVisible` flips a child's display outside of any
    // layout pass (reachable from `setVisibleComponentId`), so the component
    // owed a scroll restore is parked here and consumed by the next
    // `doLayout`, once `placeComponent` has relaid it out.
    private _pendingScrollRestore: Component | null = null;

    constructor(options?: CardOptions) {
        // LayoutManager's constructor takes no options; applied via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link CardOptions} bag, dispatching the initial visible
     * component id after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: CardOptions): void {
        super.applyOptions(options);

        if (options.visibleComponentId !== undefined) {
            this.setVisibleComponentId(options.visibleComponentId);
        }
    }

    /**
     * Returns the ID of the currently visible child component, or `null` if none is set.
     *
     * @returns The visible component ID, or `null`.
     */
    getVisibleComponentId(): string | null {
        return this._visibleComponentId;
    }

    /**
     * Returns the preferred size of the visible child plus the container perimeter.
     *
     * @returns The preferred `{width, height}`, or `null` if there is no container or no visible component.
     */
    getPreferredSize(): Size | null {
        return this.computeSize(component => component.getPreferredSize());
    }

    /**
     * Returns the minimum size of the visible child plus the container perimeter.
     *
     * @returns The minimum `{width, height}`, or `null` if there is no container or no visible component.
     */
    getMinSize(): Size | null {
        return this.computeSize(component => component.getMinSize());
    }

    /**
     * Returns the maximum size of the visible child plus the container perimeter.
     *
     * @returns The maximum `{width, height}`, or `null` if there is no container or no visible component.
     */
    getMaxSize(): Size | null {
        return this.computeSize(component => component.getMaxSize());
    }

    /**
     * Shared core of {@link getPreferredSize} / {@link getMinSize} /
     * {@link getMaxSize}: adds the visible child's size (selected by `sizeOf`)
     * to the container perimeter.
     *
     * @param sizeOf - Selects the child's preferred, minimum, or maximum size.
     * @returns The composed `{width, height}`, or `null` if there is no
     *   container, no visible component, or the child reports no size.
     */
    private computeSize(sizeOf: (component: Component) => Size | null): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimeterSize = container.getPerimeterSize();
        if (!perimeterSize) {
            return null;
        }

        const outerWidth = perimeterSize.left + perimeterSize.right;
        const outerHeight = perimeterSize.top + perimeterSize.bottom;

        const visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        const size = sizeOf(visibleComponent);
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Selects which child component is visible. Undisplays the
     * previously-visible child (if different) and displays the new one.
     * Subsequent `doLayout` calls only re-size the visible child; display
     * writes happen here, not on every layout pass.
     *
     * @param id - The ID of the child component to make visible.
     */
    setVisibleComponentId(id: string): this {
        if (this._visibleComponentId === id) {
            return this;
        }

        this._visibleComponentId = id;
        this.syncVisible();

        // Schedule a layout so a child first shown here gets sized: doLayout only
        // ever lays out the visible child, so a sibling that was hidden during
        // the initial pass has never been laid out and would render blank until
        // an unrelated relayout. No-op before the manager is attached.
        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the child component matching `visibleComponentId`, or the first
     * child if no ID is set. Result is cached; the cache is refreshed when
     * `setVisibleComponentId` is called or when `doLayout` runs without a
     * resolved component.
     *
     * @returns The resolved visible component, or `null` if the container is empty.
     */
    getVisibleComponent(): Component | null {
        if (!this._currentVisible) {
            this.syncVisible();
        }

        return this._currentVisible;
    }

    /**
     * Reads a component's live native scroll offset (if it still has boxes)
     * then undisplays it — the capture must run first, since a `display: none`
     * element reports every scroll offset as zero. Mirrors `Tab.doLayout`'s
     * own capture-then-undisplay pairing.
     *
     * @remarks The capture guard is effective visibility, not just the
     * component's own displayed flag: an ancestor entirely outside this
     * Card's own management can be what actually leaves it with no boxes,
     * and a live read against a boxless element would clobber its cache.
     *
     * @param component - The child to drop out of the render tree.
     */
    private undisplayChild(component: Component): void {
        if (component.isEffectivelyVisible()) {
            component.captureSubtreeScroll();
        }

        component.setDisplayed(false);
    }

    /**
     * Resolves the visible component from `visibleComponentId` (or first child
     * if unset), and transitions display: undisplays the previous one if
     * different, displays the new one. No-op when the resolved component is the
     * same as the currently-shown one.
     */
    private syncVisible(): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const components = container.getComponents();
        let resolved: Component | null = null;

        if (this._visibleComponentId) {
            for (const c of components) {
                if (c.getId() == this._visibleComponentId) {
                    resolved = c;
                    break;
                }
            }

            if (!resolved) {
                console.warn("Visible component id is specified but no matching component was found.");
            }
        }

        if (!resolved && components.length > 0) {
            resolved = components[0];
        }

        if (resolved === this._currentVisible) {
            return;
        }

        if (this._currentVisible === null) {
            // First sync: components default to displayed, so any sibling
            // that isn't the resolved child needs to be dropped out of the
            // render tree explicitly. Without this, e.g. a Cell's editor
            // (sibling of its renderer) renders on top of the renderer
            // because its setDisplayed was never called.
            for (const c of components) {
                if (c !== resolved) {
                    this.undisplayChild(c);
                }
            }
        } else {
            this.undisplayChild(this._currentVisible);
        }

        if (resolved) {
            const wasUndisplayed = !resolved.isDisplayed();

            resolved.setDisplayed(true);

            // syncVisible runs outside of any layout pass (reachable from
            // setVisibleComponentId), so the restore itself is deferred to
            // the doLayout that follows — see `_pendingScrollRestore`'s own
            // doc. Overwriting a still-pending record from an earlier switch
            // this same tick is correct: every non-current child stays
            // undisplayed by construction, so `resolved` is the only target
            // whose offset still needs restoring.
            if (wasUndisplayed) {
                this._pendingScrollRestore = resolved;
            }
        }

        this._currentVisible = resolved;
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * the currently-visible child's minSize. Used by `doLayout` to inflate
     * the working size when the host has opted into `setOverflowing`.
     *
     * @returns The visible child's min-size; `{ width: 0, height: 0 }` when
     *   no child is visible.
     */
    protected computeTotalMinSize(): Size {
        if (!this._currentVisible) {
            return { width: 0, height: 0 };
        }

        const min = this._currentVisible.getMinSize();

        return min ?? { width: 0, height: 0 };
    }

    /**
     * Sizes the visible component to fill the container's inner bounds.
     * Visibility transitions are handled in `setVisibleComponentId`, not here.
     */
    doLayout(): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        if (!this._currentVisible) {
            this.syncVisible();
        }

        if (!this._currentVisible) {
            return;
        }

        let containerSize = container.getInnerSize();
        const containerInsets = container.getContentInsets();

        // Universal scroll: see HBox.doLayout for the rationale. When the
        // host has marked the corresponding axis as overflowing, grow the
        // working size past the host's inner rect to the visible child's
        // minSize so the host's CSS `overflow: auto` produces a scrollbar.
        if (containerSize) {
            containerSize = this.inflateForOverflow(containerSize);
        }

        this.placeComponent(
            this._currentVisible,
            containerInsets.getLeft(),
            containerInsets.getTop(),
            containerSize ? containerSize.width : 0,
            containerSize ? containerSize.height : 0,
            FillType.BOTH
        );

        // Consumes the restore `syncVisible` deferred here — safe now rather
        // than at the switch itself, because placeComponent -> commitBounds
        // just ran the visible child's own doLayout() synchronously, so its
        // subtree already carries its final geometry. The `=== _currentVisible`
        // guard discards a stale record from a component that was switched
        // away from again before this pass ever ran.
        const restore = this._pendingScrollRestore;

        this._pendingScrollRestore = null;

        if (restore === this._currentVisible) {
            restore.restoreSubtreeScroll();
        }
    }
}

const CardCallable = callable(Card);
type CardCallable = Card;
export {
    Card         as _Card,
    CardCallable as Card
};
