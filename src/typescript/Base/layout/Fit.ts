// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { Size } from "../Size.js";
import { FillType } from "./FillType.js";

/**
 * A layout manager that expects exactly one child component and sizes it to
 * fill the container's entire inner bounds.
 * Throws if the container holds more than one component.
 */
export class Fit extends LayoutManager {

    /**
     * Returns the preferred size of the single child component plus the container perimeter.
     *
     * @returns The preferred `{width, height}`, or `null` if there is no container or no child.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let component = this.getComponent();
        if (!component) {
            return null;
        }

        let size = component.getPreferredSize();
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Returns the minimum size of the single child component plus the container perimeter.
     *
     * @returns The minimum `{width, height}`, or `null` if there is no container or no child.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let component = this.getComponent();
        if (!component) {
            return null;
        }

        let size = component.getMinSize();
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Returns the maximum size of the single child component plus the container perimeter.
     *
     * @returns The maximum `{width, height}`, or `null` if there is no container or no child.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let component = this.getComponent();
        if (!component) {
            return null;
        }

        let size = component.getMaxSize();
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Returns the single child component of the container, or `undefined` if the container is empty.
     *
     * @returns The child component, or `undefined`.
     *
     * @remarks Throws if the container holds more than one component.
     */
    getComponent() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let components = container.getComponents();

        if (components.length > 1) {
            throw new Error("Container contains more then one component.");
        }

        let component;

        if (components.length == 1) {
            component = components[0];
        }

        return component;
    }

    /**
     * Sizes the single child component to fill the container's inner bounds.
     *
     * @remarks Throws if the container holds more than one component.
     */
    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();

        if (components.length > 1) {
            throw new Error("Container contains more then one component.");
        }

        let component;

        if (components.length == 1) {
            component = components[0];
        }

        if (!component) {
            return;
        }

        let containerSize = container.getInnerSize();
        let containerInsets = container.getInsets();

        this.placeComponent(
            component,
            containerInsets ? containerInsets.getLeft() : 0,
            containerInsets ? containerInsets.getTop() : 0,
            containerSize ? containerSize.width : 0,
            containerSize ? containerSize.height : 0,
            FillType.BOTH
        );
    }
}
