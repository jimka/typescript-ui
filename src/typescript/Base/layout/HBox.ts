import { LayoutManager } from "./LayoutManager.js";
import { FillType } from "./FillType.js";

export class HBox extends LayoutManager {

    private spacing: number;
    private stretching: boolean;
    private defaultComponentWidth: number = 100;

    constructor() {
        super();

        this.spacing = 5;
        this.stretching = false;
    }

    getComponentSpacing() {
        return this.spacing || 0;
    }

    setComponentSpacing(spacing: number) {
        this.spacing = spacing || 0;
    }

    isStretching() {
        return this.stretching || false;
    }

    setStretching(stretching: boolean) {
        this.stretching = stretching;
    }

    getPreferredSize() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let containerBorderSize = container.getBorderSize();
        let components = container.getComponents();
        let containerInsets = container.getInsets();
        let width = containerInsets.getLeft() + containerInsets.getRight();
        let height = Number.MAX_SAFE_INTEGER;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                width += size.width;
                height = Math.min(height, size.height);
            }
        }

        width += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.left + containerBorderSize.right;
        height += containerInsets.getTop() + containerInsets.getBottom() + containerBorderSize.top + containerBorderSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    getMinSize() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let containerBorderSize = container.getBorderSize();
        let components = container.getComponents();
        let containerInsets = container.getInsets();
        let width = containerInsets.getLeft() + containerInsets.getRight();
        let height = 0;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                width += size.width;
                height = Math.max(height, size.height);
            }
        }

        width += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.left + containerBorderSize.right;
        height += containerInsets.getTop() + containerInsets.getBottom() + containerBorderSize.top + containerBorderSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    getMaxSize() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let containerBorderSize = container.getBorderSize();
        let components = container.getComponents();
        let containerInsets = container.getInsets();
        let width = containerInsets.getLeft() + containerInsets.getRight();
        let height = Number.MAX_SAFE_INTEGER;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                width += size.width;
                height = Math.min(height, size.height);
            }
        }

        width += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.left + containerBorderSize.right;
        height += containerInsets.getTop() + containerInsets.getBottom() + containerBorderSize.top + containerBorderSize.bottom;

        return {
            width: width,
            height: height
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

        let containerInsets = container.getInsets();
        let components = container.getComponents();

        let x = containerInsets.getLeft();
        let y = containerInsets.getTop();

        for (let idx in components) {
            let component = components[idx];

            let size = component.getPreferredSize();
            let minSize = component.getMinSize();
            let maxSize = component.getMaxSize();

            let width = (size ? size.width : undefined)
                || (minSize ? minSize.width : undefined)
                || this.defaultComponentWidth;
            let height;

            if (!size || this.isStretching()) {
                height = Math.min(maxSize.height, containerSize.height);
            } else {
                height = Math.min(size.height, containerSize.height);
            }

            this.placeComponent(
                component,
                x,
                y,
                width,
                height,
                FillType.BOTH
            );

            if (size) {
                x += size.width;
            }

            x += this.getComponentSpacing();
        }
    }
}