import { FillType } from "./FillType.js";
import { AnchorType } from "./AnchorType.js";
import { LayoutConstraints } from "./LayoutConstraints";
import { Size } from "../Size.js";
import { Component } from "../Component.js";
import { BaseObject } from "../BaseObject.js";

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

    attach(container: Component) {
        this.container = container;
    }

    detach() {
        this.container = null;
    }

    getContainer(): Component | null {
        return this.container;
    }

    getPreferredSize(): Size | null {
        return this.defaultPreferredSize;
    }

    getMinSize(): Size | null {
        return this.defaultMinSize;
    }

    getMaxSize(): Size | null {
        return this.defaultMaxSize;
    }

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

    setLayoutConstraints(component: Component, constraints?: LayoutConstraints): LayoutConstraints | undefined {
        if (!constraints) {
            return this.delLayoutConstraints(component);
        } else {
            this.layoutConstraints.set(component.getId(), constraints);
            return constraints;
        }
    }

    delLayoutConstraints(component: Component) {
        let constraints = this.layoutConstraints.get(component.getId());

        this.layoutConstraints.delete(component.getId());

        return constraints;
    }

    getLayoutConstraints(component: Component) {
        return this.layoutConstraints.get(component.getId());
    }

    abstract doLayout(): void;
};