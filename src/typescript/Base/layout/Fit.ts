import { LayoutManager } from "./LayoutManager.js";
import { Size } from "../Size.js";
import { FillType } from "./FillType.js";

export class Fit extends LayoutManager {

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