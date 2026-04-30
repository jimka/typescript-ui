// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FillType } from "./FillType.js";
import { AnchorType } from "./AnchorType.js";
import { LayoutConstraints } from "./LayoutConstraints";
import { Size } from "../Size.js";
import { Component } from "../Component.js";
import { BaseObject } from "../BaseObject.js";

/**
 * Abstract base class for all layout managers.
 * A layout manager is attached to a container component and is responsible for
 * computing size hints and positioning child components within the container.
 */
export abstract class LayoutManager extends BaseObject {

    private container: Component | null = null;
    private layoutConstraints: Map<string, LayoutConstraints>;
    private defaultPreferredSize: Size | null = null;
    private defaultMinSize: Size;
    private defaultMaxSize: Size;

    constructor() {
        super();

        this.layoutConstraints = new Map<string, LayoutConstraints>();
        //this.defaultPreferredSize = Base.instantiate("Base.Size");
        this.defaultMinSize = {
            width: 0,
            height: 0
        };

        this.defaultMaxSize = {
            width: Number.MAX_VALUE,
            height: Number.MAX_VALUE
        };
    }

    /**
     * Associates this layout manager with a container component.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component) {
        this.container = container;
    }

    /**
     * Dissociates this layout manager from its container.
     */
    detach() {
        this.container = null;
    }

    /**
     * Returns the container component this layout manager is attached to.
     *
     * @returns The attached container, or `null` if not attached.
     */
    getContainer(): Component | null {
        return this.container;
    }

    /**
     * Returns the default preferred size.
     * Subclasses may override this method to compute the preferred size dynamically.
     *
     * @returns The preferred size, or `null` if not set.
     */
    getPreferredSize(): Size | null {
        return this.defaultPreferredSize;
    }

    /**
     * Returns the minimum size this layout can produce.
     *
     * @returns The minimum size.
     */
    getMinSize(): Size | null {
        return this.defaultMinSize;
    }

    /**
     * Returns the maximum size this layout can produce.
     *
     * @returns The maximum size.
     */
    getMaxSize(): Size | null {
        return this.defaultMaxSize;
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
     * @remarks The method checks the component's stored `LayoutConstraints` first;
     * the `fill` and `anchor` parameters serve as fallbacks. After positioning,
     * `doLayout` is called on the child so nested layouts are updated in a single pass.
     */
    placeComponent(component: Component, x: number, y: number, maxWidth: number, maxHeight: number, fill?: FillType | null, anchor?: AnchorType | null) {
        let layoutConstraints = this.getLayoutConstraints(component);
        let preferredSize = component.getPreferredSize();
        let size = component.getSize();
        let maxSize = component.getMaxSize();
        let minSize = component.getMinSize();
        let width;
        let height;

        fill = ((layoutConstraints ? layoutConstraints.fill : undefined) || fill || FillType.NONE) as FillType;
        anchor = ((layoutConstraints ? layoutConstraints.anchor : undefined) || anchor || AnchorType.CENTER) as AnchorType;

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
                } else if (minSize && sw < minSize.width) {
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
                } else if (minSize && sh < minSize.height) {
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

        component.setAutoCommitStyle(false);
        component.setX(x);
        component.setY(y);
        component.setWidth(width);
        component.setHeight(height);

        component.doLayout();

        component.setAutoCommitStyle(true);
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
            this.layoutConstraints.set(component.getId(), constraints);
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
        let constraints = this.layoutConstraints.get(component.getId());

        this.layoutConstraints.delete(component.getId());

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
        return this.layoutConstraints.get(component.getId());
    }

    abstract doLayout(): void;
};
