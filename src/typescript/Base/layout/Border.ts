import { LayoutManager } from "./LayoutManager.js"
import { Component } from "../Component.js"
import { LayoutConstraints } from "./LayoutConstraints.js";
import { FillType } from "./FillType.js";
import { Placement } from "../Placement.js";

export class Border extends LayoutManager {

    private northComponent: Component | null = null;
    private southComponent: Component | null = null;
    private westComponent: Component | null = null;
    private eastComponent: Component | null = null;
    private centerComponent: Component | null = null;
    private gap: number = 5;

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
                this.northComponent = component;
                break;
            case Placement.SOUTH:
                this.southComponent = component;
                break;
            case Placement.WEST:
                this.westComponent = component;
                break;
            case Placement.EAST:
                this.eastComponent = component;
                break;
            case Placement.CENTER:
                this.centerComponent = component;
                break;
        }

        return super.setLayoutConstraints(component, constraints);
    }

    getComponentGap() {
        return this.gap;
    }

    setComponentGap(gap: number) {
        this.gap = gap;
    }

    getPreferredSize() {
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

        if (this.northComponent) {
            let size = this.northComponent.getPreferredSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this.southComponent) {
            let size = this.southComponent.getPreferredSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this.westComponent) {
            let size = this.westComponent.getPreferredSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this.centerComponent) {
            let size = this.centerComponent.getPreferredSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this.eastComponent) {
            let size = this.eastComponent.getPreferredSize();
            if (size) {
                middleWidth += size.width;
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

    getMinSize() {
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

        if (this.northComponent) {
            let size = this.northComponent.getMinSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this.southComponent) {
            let size = this.southComponent.getMinSize();
            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this.westComponent) {
            let size = this.westComponent.getMinSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this.centerComponent) {
            let size = this.centerComponent.getMinSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.max(middleHeight, size.height);
            }
        }

        if (this.eastComponent) {
            let size = this.eastComponent.getMinSize();
            if (size) {
                middleWidth += size.width;
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

    getMaxSize() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let innerWidth = Number.MAX_SAFE_INTEGER;
        let innerHeight = Number.MAX_SAFE_INTEGER;

        let middleWidth = 0;
        let middleHeight = 0;

        if (this.northComponent) {
            let size = this.northComponent.getMaxSize();
            if (size) {
                innerWidth = Math.min(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this.southComponent) {
            let size = this.southComponent.getMaxSize();
            if (size) {
                innerWidth = Math.min(innerWidth, size.width);
                innerHeight += size.height;
            }
        }

        if (this.westComponent) {
            let size = this.westComponent.getMaxSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.min(middleHeight, size.height);
            }
        }

        if (this.centerComponent) {
            let size = this.centerComponent.getMaxSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.min(middleHeight, size.height);
            }
        }

        if (this.eastComponent) {
            let size = this.eastComponent.getMaxSize();
            if (size) {
                middleWidth += size.width;
                middleHeight += Math.min(middleHeight, size.height);
            }
        }

        innerWidth = Math.min(innerWidth, middleWidth);
        innerHeight += middleHeight;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            throw new Error("Unable to determine component size.");
        }

        let containerInsets = container.getInsets();
        if (!containerInsets) {
            throw new Error("Unable to determine component insets.");
        }

        let width = containerSize.width;
        let height = containerSize.height;
        let centerX;
        let middleY;
        let centerWidth;
        let middleHeight;

        if (this.northComponent) {
            let constraints = this.getLayoutConstraints(this.northComponent);
            if (!constraints) {
                throw new Error("Unable to determine layout constraints for north component.");
            }

            let preferredSize = this.northComponent.getPreferredSize();
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for north component.");
            }

            middleY = preferredSize.height + (constraints.ignoreParentInsets ? containerInsets.getTop() : 0);

            this.placeComponent(
                this.northComponent,
                constraints.ignoreParentInsets ? 0 : containerInsets.getLeft(),
                constraints.ignoreParentInsets ? 0 : containerInsets.getTop(),
                width + (constraints.ignoreParentInsets ? containerInsets.getLeft() + containerInsets.getRight() : 0),
                middleY,
                FillType.BOTH
            );

            if (this.westComponent || this.centerComponent || this.eastComponent || this.southComponent) {
                middleY += this.gap;
            }
        } else {
            middleY = 0;
        }

        middleHeight = height - middleY;
        if (this.southComponent) {
            let preferredSize = this.southComponent.getPreferredSize();
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for south component.");
            }

            middleHeight -= this.gap;
            middleHeight -= preferredSize.height;

            this.placeComponent(
                this.southComponent,
                containerInsets.getLeft(),
                containerInsets.getTop() + height - preferredSize.height,
                width,
                preferredSize.height,
                FillType.BOTH
            );
        }

        if (this.westComponent) {
            let preferredSize = this.westComponent.getPreferredSize();
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for west component.");
            }

            centerX = preferredSize.width;

            this.placeComponent(
                this.westComponent,
                containerInsets.getLeft(),
                containerInsets.getTop() + middleY,
                preferredSize.width,
                middleHeight,
                FillType.BOTH
            );

            if (this.centerComponent) {
                centerX += this.gap;
            }
        } else {
            centerX = 0;
        }

        centerWidth = width - centerX;

        if (this.eastComponent) {
            let preferredSize = this.eastComponent.getPreferredSize();
            if (!preferredSize) {
                throw new Error("Unable to determine preferred size for east component.");
            }

            centerWidth -= this.gap;
            centerWidth -= preferredSize.width;

            this.placeComponent(
                this.eastComponent,
                containerInsets.getLeft() + width - preferredSize.width,
                containerInsets.getTop() + middleY,
                preferredSize.width,
                middleHeight,
                FillType.BOTH
            );
        }

        if (this.centerComponent) {
            this.placeComponent(this.centerComponent,
                containerInsets.getLeft() + centerX,
                containerInsets.getTop() + middleY,
                centerWidth,
                middleHeight,
                FillType.BOTH
            );
        }
    }
}