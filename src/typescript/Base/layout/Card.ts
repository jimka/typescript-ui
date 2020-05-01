import { LayoutManager } from "./LayoutManager.js"
import { FillType } from "./FillType.js";

export class Card extends LayoutManager {

    private visibleComponentId: String | null = null;

    getVisibleComponentId() {
        return this.visibleComponentId;
    }

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

    setVisibleComponentId(id: String) {
        this.visibleComponentId = id;
    }

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