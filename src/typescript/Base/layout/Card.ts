// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js"
import { FillType } from "./FillType.js";

/**
 * A layout manager that shows exactly one child component at a time,
 * sizing it to fill the container's inner bounds.
 * The visible child is selected by component ID; all others are hidden.
 */
export class Card extends LayoutManager {

    private visibleComponentId: String | null = null;

    /**
     * Returns the ID of the currently visible child component, or `null` if none is set.
     *
     * @returns The visible component ID, or `null`.
     */
    getVisibleComponentId() {
        return this.visibleComponentId;
    }

    /**
     * Returns the preferred size of the visible child plus the container perimeter.
     *
     * @returns The preferred `{width, height}`, or `null` if there is no container or no visible component.
     */
    getPreferredSize() {
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
    getMinSize() {
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
    getMaxSize() {
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
     * Sets the ID of the child component to show; all others will be hidden on the next layout pass.
     *
     * @param id - The ID of the child component to make visible.
     */
    setVisibleComponentId(id: String) {
        this.visibleComponentId = id;
    }

    /**
     * Returns the child component matching `visibleComponentId`, or the first child if no ID is set.
     *
     * @returns The resolved visible component, or `undefined` if the container is empty.
     *
     * @remarks Logs a console warning when `visibleComponentId` is set but no matching child is found,
     * then falls back to the first child.
     */
    getVisibleComponent() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let components = container.getComponents();
        let component = undefined;

        if (this.visibleComponentId) {
            for (let idx in components) {
                let c = components[idx];
                if (c.getId() == this.visibleComponentId) {
                    component = c;
                    break;
                }
            }

            if (!component) {
                console.warn("Visible component id is specified but no matching component was found.");
            }
        }

        if (!component && components.length > 0) {
            component = components[0];
        }

        return component;
    }

    /**
     * Hides all children and sizes the visible component to fill the container's inner bounds.
     */
    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();

        for (let idx in components) {
            let component = components[idx];
            component.setVisible(false);
        }

        let component = this.getVisibleComponent();

        if (!component) {
            return;
        }

        let containerSize = container.getInnerSize();
        let containerInsets = container.getInsets();

        component.setVisible(true);

        this.placeComponent(
            component,
            containerInsets.getLeft(),
            containerInsets.getTop(),
            containerSize ? containerSize.width : 0,
            containerSize ? containerSize.height : 0,
            FillType.BOTH
        );
    }
}
