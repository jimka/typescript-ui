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
 * The visible child is selected by component ID; all others are hidden.
 *
 * @category Layouts
 */
class Card extends LayoutManager {

    private _visibleComponentId: String | null = null;
    private _currentVisible: Component | null = null;

    constructor(options?: CardOptions) {
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
    getVisibleComponentId(): String | null {
        return this._visibleComponentId;
    }

    /**
     * Returns the preferred size of the visible child plus the container perimeter.
     *
     * @returns The preferred `{width, height}`, or `null` if there is no container or no visible component.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();
        if (!perimiterSize) {
            return null;
        }

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getPreferredSize();
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Returns the minimum size of the visible child plus the container perimeter.
     *
     * @returns The minimum `{width, height}`, or `null` if there is no container or no visible component.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();
        if (!perimiterSize) {
            return null;
        }

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getMinSize();
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Returns the maximum size of the visible child plus the container perimeter.
     *
     * @returns The maximum `{width, height}`, or `null` if there is no container or no visible component.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();
        if (!perimiterSize) {
            return null;
        }

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getMaxSize();
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Selects which child component is visible. Hides the previously-visible
     * child (if different) and shows the new one. Subsequent `doLayout` calls
     * only re-size the visible child; visibility writes happen here, not on
     * every layout pass.
     *
     * @param id - The ID of the child component to make visible.
     */
    setVisibleComponentId(id: String): this {
        if (this._visibleComponentId === id) {
            return this;
        }

        this._visibleComponentId = id;
        this.syncVisible();

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
     * Resolves the visible component from `visibleComponentId` (or first child
     * if unset), and transitions visibility: hides the previous one if
     * different, shows the new one. No-op when the resolved component is the
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
            // First sync: components default to visible, so any sibling that
            // isn't the resolved child needs to be hidden explicitly. Without
            // this, e.g. a Cell's editor (sibling of its renderer) renders on
            // top of the renderer because its setVisible was never called.
            for (const c of components) {
                if (c !== resolved) {
                    c.setVisible(false);
                }
            }
        } else {
            this._currentVisible.setVisible(false);
        }

        if (resolved) {
            resolved.setVisible(true);
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
        if (containerSize && (this.isOverflowingX() || this.isOverflowingY())) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        this.placeComponent(
            this._currentVisible,
            containerInsets.getLeft(),
            containerInsets.getTop(),
            containerSize ? containerSize.width : 0,
            containerSize ? containerSize.height : 0,
            FillType.BOTH
        );
    }
}

const CardCallable = callable(Card);
type CardCallable = Card;
export {
    Card         as _Card,
    CardCallable as Card
};
