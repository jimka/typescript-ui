import { LayoutManager } from "./LayoutManager.js";
import { SplitGutter } from "../component/SplitGutter.js";
import { Component } from "../Component.js";
import { FillType } from "./FillType.js";

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

    getDirection() {
        return this.direction;
    }

    setDirection(direction: String) {
        this.direction = direction;
    }

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

    detach() {
        super.detach();

        for (let idx in this.gutters) {
            let gutter = this.gutters[idx];

            let gutterElement = gutter.getElement();
            (gutterElement.parentNode as Node).removeChild(gutterElement);
        }

        // TODO: Remove gutter listeners?
    }

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

        // TODO: Might need to move existing gutters to the current element
        // if the layout manager has been previously used by another container.
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
