// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { SplitGutter } from "../component/SplitGutter.js";
import { Component } from "../Component.js";
import { FillType } from "./FillType.js";

/**
 * A layout manager that splits the container into two or more resizable panels
 * separated by draggable gutter elements.
 * The split direction can be `'horizontal'` (panels side by side) or `'vertical'` (panels stacked).
 */
export class Split extends LayoutManager {

    private direction: String;
    private sizes: Map<Component, number>;
    private gutters: Array<SplitGutter>;

    constructor(direction?: String) {
        super();

        this.direction = direction || "horizontal";
        this.sizes = new Map<Component, number>();
        this.gutters = [];
    }

    /**
     * Returns the split direction.
     *
     * @returns `'horizontal'` or `'vertical'`.
     */
    getDirection() {
        return this.direction;
    }

    /**
     * Sets the split direction.
     *
     * @param direction - `'horizontal'` for side-by-side panels, `'vertical'` for stacked panels.
     */
    setDirection(direction: String) {
        this.direction = direction;
    }

    /**
     * Adjusts the sizes of the two panels adjacent to a gutter when it is dragged.
     *
     * @param container - The container component that owns the panels.
     * @param gutter - The gutter being dragged.
     * @param dragAmount - The number of pixels the gutter was moved (negative moves left/up).
     *
     * @remarks The stored sizes for both affected panels are updated so the next `doLayout`
     * call preserves the user-defined split ratio.
     */
    onDrag(container: Component, gutter: SplitGutter, dragAmount: number) {
        let gutterIdx = this.gutters.indexOf(gutter);
        let lhs = container.getComponents()[gutterIdx];
        let rhs = container.getComponents()[gutterIdx + 1];

        if (this.direction === "horizontal") {
            lhs.setWidth(lhs.getWidth() + dragAmount);
            gutter.setX(gutter.getX() + dragAmount);
            rhs.setX(rhs.getX() + dragAmount);
            rhs.setWidth(rhs.getWidth() - dragAmount);

            this.sizes.set(lhs, lhs.getWidth());
            this.sizes.set(rhs, rhs.getWidth());
        } else {
            lhs.setHeight(lhs.getHeight() + dragAmount);
            gutter.setY(gutter.getY() + dragAmount);
            rhs.setY(rhs.getY() + dragAmount);
            rhs.setHeight(rhs.getHeight() - dragAmount);

            this.sizes.set(lhs, lhs.getHeight());
            this.sizes.set(rhs, rhs.getHeight());
        }

        lhs.doLayout();
        rhs.doLayout();
    }

    /**
     * Detaches from the container and removes all gutter elements from the DOM.
     */
    detach() {
        super.detach();

        for (let idx in this.gutters) {
            let gutter = this.gutters[idx];

            let gutterElement = gutter.getElement();
            (gutterElement.parentNode as Node).removeChild(gutterElement);
            gutter.destroy();
        }

        this.gutters = [];
    }

    /**
     * Creates missing gutters, computes panel sizes, and positions all panels and gutters.
     *
     * @remarks New `SplitGutter` instances are appended to the container's DOM element on first layout.
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

        let element = container.getElement();
        let components = container.getComponents();
        let containerInsets = container.getInsets();

        let componentCount = components.length;
        let gutterSize = 4;
        let gutterCount = componentCount - 1;

        for (let i = this.gutters.length; i < gutterCount; i += 1) {
            let gutter = new SplitGutter(this.direction);
            gutter.addDragListener(function (dragAmount: number) {
                me.onDrag(<Component>container, gutter, dragAmount);
            });

            this.gutters.push(gutter);

            element.appendChild(gutter.getElement(true));
        }

        let x = containerInsets.getLeft();
        let y = containerInsets.getTop();

        this.recalculateSizes();

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];

            let componentWidth;
            let componentHeight;

            if (this.direction === "horizontal") {
                componentWidth = this.sizes.get(component) as number;
                componentHeight = containerSize.height;
            } else {
                componentWidth = containerSize.width;
                componentHeight = this.sizes.get(component) as number;
            }

            this.placeComponent(
                component,
                x,
                y,
                componentWidth,
                componentHeight,
                FillType.BOTH
            );

            if (this.direction === "horizontal") {
                x += componentWidth;
            } else {
                y += componentHeight;
            }

            if (idx < gutterCount) {
                let gutter = this.gutters[idx];

                gutter.setX(x);
                gutter.setY(y);

                if (this.direction === "horizontal") {
                    gutter.setWidth(gutterSize);
                    gutter.setHeight(componentHeight);

                    x += gutterSize;
                } else {
                    gutter.setWidth(componentWidth);
                    gutter.setHeight(gutterSize);

                    y += gutterSize;
                }
            }
        }
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

        let containerInsets = container.getInsets();

        let components = container.getComponents();
        let componentsWithSize = 0;

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];

            if (this.sizes.has(component)) {
                componentsWithSize += 1;
            }
        }

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            let componentSize = this.sizes.get(component);

            if (componentSize == undefined) {
                if (this.sizes.size != 0) {
                    componentSize = 0;

                    for (let jdx = 0; jdx < components.length; jdx += 1) {
                        let c = components[jdx];
                        let cSize = this.sizes.get(c);

                        if(cSize == undefined) {
                            continue;
                        }

                        let sizeFraction = cSize * (1 / (componentsWithSize + 1));
                        componentSize += sizeFraction;
                        cSize -= sizeFraction;

                        this.sizes.set(c, cSize);
                    }
                } else {
                    if (this.direction === "horizontal") {
                        componentSize = containerSize.width - containerInsets.getLeft() - containerInsets.getRight();
                    } else {
                        componentSize = containerSize.height - containerInsets.getTop() - containerInsets.getBottom();
                    }
                }

                this.sizes.set(component, componentSize);
                componentsWithSize += 1;
            }
        }
    }
}
