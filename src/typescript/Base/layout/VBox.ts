import { LayoutManager } from "./LayoutManager.js";
import { FillType } from "./FillType.js";

export class VBox extends LayoutManager {

    private spacing: number;
    private stretching: boolean;
    private defaultComponentHeight: number = 100;

    constructor() {
        super();

        this.spacing = 5;
        this.stretching = false;
    }

    getComponentSpacing() {
        return this.spacing || 0;
    }

    setComponentSpacing(spacing: number) {
        this.spacing = spacing;
    }

    isStretching() {
        return this.stretching || false;
    }

    setStretching(stretching: boolean) {
        this.stretching = !!stretching;
    }

    getPreferredSize() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let containerBorderSize = container.getBorderSize();
        let components = container.getComponents();
        let containerInsets = container.getInsets();
        let width = Number.MAX_SAFE_INTEGER;
        let height = containerInsets.getTop() + containerInsets.getBottom();

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                width = width == Number.MAX_SAFE_INTEGER ? Math.min(width, size.width) : Math.max(width, size.width);
                height += size.height;
            }
        }

        width += containerInsets.getLeft() + containerInsets.getRight() + containerBorderSize.left + containerBorderSize.right;
        height += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.top + containerBorderSize.bottom;

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
        let width = 0;
        let height = containerInsets.getTop() + containerInsets.getBottom();

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                width = Math.max(width, size.width);
                height += size.height;
            }
        }

        width += containerInsets.getLeft() + containerInsets.getRight() + containerBorderSize.left + containerBorderSize.right;
        height += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.top + containerBorderSize.bottom;

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
        let width = Number.MAX_SAFE_INTEGER;
        let height = containerInsets.getTop() + containerInsets.getBottom();

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMaxSize();

            if (size) {
                width = Math.min(width, size.width);
                height += size.height;
            }
        }

        width += containerInsets.getLeft() + containerInsets.getRight() + containerBorderSize.left + containerBorderSize.right;
        height += this.getComponentSpacing() * (components.length - 1) + containerBorderSize.top + containerBorderSize.bottom;

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

            let width;
            let height = (size ? size.height : undefined)
                || (minSize ? minSize.height : undefined)
                || this.defaultComponentHeight;

            if (!size || this.isStretching()) {
                width = Math.min(maxSize.width, containerSize.width);
            } else {
                width = Math.min(size.width, containerSize.width);
            }

            this.placeComponent(
                component,
                x,
                y,
                width,
                height,
                FillType.BOTH
            )

            y += component.getHeight();
            y += this.getComponentSpacing();
        }
    }
}