import { LayoutManager } from "./LayoutManager.js";
import { FillType } from "./FillType.js";

export class Row extends LayoutManager {

    private gap: number = 5;

    constructor() {
        super();
    }

    getGap() {
        return this.gap;
    }

    setGap(gap : number) {
        this.gap = gap;
        this.doLayout();
    }

    getPreferredSize() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let innerWidth = 0;
        let innerHeight = 0;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight = Math.max(innerHeight, size.height);
            }
        }

        innerHeight = components.length * (innerHeight + this.gap) - this.gap;

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

        let components = container.getComponents();

        let innerWidth = 0;
        let innerHeight = 0;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight = Math.max(innerHeight, size.height);
            }
        }

        innerHeight = components.length * (innerHeight + this.gap) - this.gap;

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

        let components = container.getComponents();

        let innerWidth = Number.MAX_SAFE_INTEGER;
        let innerHeight = Number.MAX_SAFE_INTEGER;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMaxSize();

            if (size) {
                innerWidth = Math.min(innerWidth, size.width);
                innerHeight = Math.min(innerHeight, size.height);
            }
        }

        innerHeight = components.length * (innerHeight + this.gap) - this.gap;

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
            return;
        }

        let components = container.getComponents();
        let containerInsets = container.getInsets();

        let columnWidth = containerSize.width;
        let columnHeight = (containerSize.height - (this.gap * components.length) + this.gap) / components.length;

        let x = containerInsets.getLeft();
        let y = containerInsets.getTop();

        for (let idx in components) {
            let component = components[idx];

            this.placeComponent(
                component,
                x,
                y,
                columnWidth,
                columnHeight,
                FillType.BOTH
            );

            y += columnHeight + this.gap;
        }
    }
}