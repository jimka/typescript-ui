import { Component } from "./Component.js";
import { Border } from "./layout/Border.js";
import { BorderStyle } from "./BorderStyle.js";
import { WindowHeader } from "./component/WindowHeader.js";
import { WindowBorder, Direction } from "./component/WindowBorder.js";
import { Event } from "./Event.js";
import { Placement } from "./Placement.js";

export class Window extends Component {

    private header: WindowHeader;
    private borderComponents: {
        west: WindowBorder,
        northwest: WindowBorder,
        north: WindowBorder,
        northeast: WindowBorder,
        east: WindowBorder,
        southeast: WindowBorder,
        south: WindowBorder,
        southwest: WindowBorder,
    };

    constructor(headerText: string, zIndex: number = 9999) {
        super();

        this.setLayoutManager(new Border());

        this.borderComponents = {
            west: new WindowBorder(Direction.WEST),
            northwest: new WindowBorder(Direction.NORTHWEST),
            north: new WindowBorder(Direction.NORTH),
            northeast: new WindowBorder(Direction.NORTHEAST),
            east: new WindowBorder(Direction.EAST),
            southeast: new WindowBorder(Direction.SOUTHEAST),
            south: new WindowBorder(Direction.SOUTH),
            southwest: new WindowBorder(Direction.SOUTHWEST),
        };

        this.borderComponents.west.addDragListener(this.onResize.bind(this));
        this.borderComponents.northwest.addDragListener(this.onResize.bind(this));
        this.borderComponents.north.addDragListener(this.onResize.bind(this));
        this.borderComponents.northeast.addDragListener(this.onResize.bind(this));
        this.borderComponents.east.addDragListener(this.onResize.bind(this));
        this.borderComponents.southeast.addDragListener(this.onResize.bind(this));
        this.borderComponents.south.addDragListener(this.onResize.bind(this));
        this.borderComponents.southwest.addDragListener(this.onResize.bind(this));

        this.header = new WindowHeader(headerText || "Window");
        this.addComponent(this.header, {
            placement: Placement.NORTH,
            ignoreParentInsets: true
        });
        this.header.addExitButtonListener(this.onExitAction.bind(this));

        //this.modal = false;
        this.setVisible(false);
        this.setZIndex(zIndex || 9999);
        this.setBorder(BorderStyle.SOLID, 1, "black");
        this.setBorderRadius("4px");
        this.setShadow("3px 3px 2px rgba(0, 0, 0, 0.4)");
        this.setBackgroundColor("rgb(241, 241, 241)");

        Event.addListener(this.header, "mousedown", this.onMouseDown.bind(this));
    }

    show() {
        document.documentElement.appendChild(this.getElement(true));

        this.doLayout();
        this.setVisible(true);
    }

    onExitAction() {
        this.setVisible(false);
        this.destructor();
    }

    setHeaderText(text: string) {
        if (!this.header) {
            throw new Error("Window does not have a header.");
        }

        this.header.getLabel().setText(text);
    }

    onMouseDown() {
        var me = this;

        document.onmouseup = this.onMouseUp.bind(me);
        document.onmousemove = this.onDrag.bind(me);
    }

    onResize(border: WindowBorder, e: MouseEvent) {
        e = e || window.event as MouseEvent;
        e.preventDefault();

        this.setAutoCommitStyle(false);
        switch (border.getDirection()) {
            case Direction.NORTHWEST:
                this.setX(this.getX() + e.movementX);
                this.setY(this.getY() + e.movementY);
                this.setWidth(this.getWidth() - e.movementX);
                this.setHeight(this.getHeight() - e.movementY);
                break;
            case Direction.NORTH:
                this.setY(this.getY() + e.movementY);
                this.setHeight(this.getHeight() - e.movementY);
                break;
            case Direction.NORTHEAST:
                this.setY(this.getY() + e.movementY);
                this.setWidth(this.getWidth() + e.movementX);
                this.setHeight(this.getHeight() - e.movementY);
                break;
            case Direction.EAST:
                this.setWidth(this.getWidth() + e.movementX);
                break;
            case Direction.SOUTHEAST:
                this.setWidth(this.getWidth() + e.movementX);
                this.setHeight(this.getHeight() + e.movementY);
                break;
            case Direction.SOUTH:
                this.setHeight(this.getHeight() + e.movementY);
                break;
            case Direction.SOUTHWEST:
                this.setX(this.getX() + e.movementX);
                this.setWidth(this.getWidth() - e.movementX);
                this.setHeight(this.getHeight() + e.movementY);
                break;
            case Direction.WEST:
                this.setX(this.getX() + e.movementX);
                this.setWidth(this.getWidth() - e.movementX);
                break;
        }

        this.doLayout();

        this.setAutoCommitStyle(true);
    }

    onDrag(e: MouseEvent) {
        e = e || window.event as MouseEvent;
        e.preventDefault();

        this.setX(this.getX() + e.movementX);
        this.setY(this.getY() + e.movementY);
    }

    onMouseUp() {
        document.onmouseup = null;
        document.onmousemove = null;
    }

    doLayout() {
        super.doLayout();

        let borderSize = this.getBorderSize();
        let insets = this.getInsets();
        let horisontallBorderWidth = (Number(borderSize.left) || 0) + (Number(borderSize.right) || 0) + insets.getLeft();
        let verticalBorderWidth = (Number(borderSize.top) || 0) + (Number(borderSize.bottom) || 0) + insets.getTop();
        let size = this.getSize();
        if (!size) {
            throw new Error("Component doesn't seem to be rendered.");
        }

        let innerSize = this.getInnerSize();
        if (!innerSize) {
            throw new Error("Component doesn't seem to be rendered.");
        }

        this.borderComponents.west.setAutoCommitStyle(false);
        this.borderComponents.northwest.setAutoCommitStyle(false);
        this.borderComponents.north.setAutoCommitStyle(false);
        this.borderComponents.northeast.setAutoCommitStyle(false);
        this.borderComponents.east.setAutoCommitStyle(false);
        this.borderComponents.southeast.setAutoCommitStyle(false);
        this.borderComponents.south.setAutoCommitStyle(false);
        this.borderComponents.southwest.setAutoCommitStyle(false);

        this.borderComponents.west.setX(0);
        this.borderComponents.west.setY(insets.getTop());
        this.borderComponents.west.setWidth(insets.getLeft());
        this.borderComponents.west.setHeight(innerSize.height);

        this.borderComponents.northwest.setX(0);
        this.borderComponents.northwest.setY(0);
        this.borderComponents.northwest.setWidth(insets.getLeft());
        this.borderComponents.northwest.setHeight(insets.getTop());

        this.borderComponents.north.setX(insets.getLeft());
        this.borderComponents.north.setY(0);
        this.borderComponents.north.setWidth(innerSize.width);
        this.borderComponents.north.setHeight(insets.getTop());

        this.borderComponents.northeast.setX(size.width - horisontallBorderWidth);
        this.borderComponents.northeast.setY(0);
        this.borderComponents.northeast.setWidth(insets.getRight());
        this.borderComponents.northeast.setHeight(insets.getTop());

        this.borderComponents.east.setX(size.width - horisontallBorderWidth);
        this.borderComponents.east.setY(insets.getTop());
        this.borderComponents.east.setWidth(insets.getRight());
        this.borderComponents.east.setHeight(innerSize.height);

        this.borderComponents.southeast.setX(size.width - horisontallBorderWidth);
        this.borderComponents.southeast.setY(size.height - verticalBorderWidth);
        this.borderComponents.southeast.setWidth(insets.getRight());
        this.borderComponents.southeast.setHeight(insets.getBottom());

        this.borderComponents.south.setX(insets.getLeft());
        this.borderComponents.south.setY(size.height - verticalBorderWidth);
        this.borderComponents.south.setWidth(innerSize.width);
        this.borderComponents.south.setHeight(insets.getRight());

        this.borderComponents.southwest.setX(0);
        this.borderComponents.southwest.setY(size.height - verticalBorderWidth);
        this.borderComponents.southwest.setWidth(insets.getLeft());
        this.borderComponents.southwest.setHeight(insets.getBottom());

        this.borderComponents.west.setAutoCommitStyle(true);
        this.borderComponents.northwest.setAutoCommitStyle(true);
        this.borderComponents.north.setAutoCommitStyle(true);
        this.borderComponents.northeast.setAutoCommitStyle(true);
        this.borderComponents.east.setAutoCommitStyle(true);
        this.borderComponents.southeast.setAutoCommitStyle(true);
        this.borderComponents.south.setAutoCommitStyle(true);
        this.borderComponents.southwest.setAutoCommitStyle(true);
    }

    render() {
        let element = super.render();

        element.appendChild(this.borderComponents.west.getElement(true));
        element.appendChild(this.borderComponents.northwest.getElement(true));
        element.appendChild(this.borderComponents.north.getElement(true));
        element.appendChild(this.borderComponents.northeast.getElement(true));
        element.appendChild(this.borderComponents.east.getElement(true));
        element.appendChild(this.borderComponents.southeast.getElement(true));
        element.appendChild(this.borderComponents.south.getElement(true));
        element.appendChild(this.borderComponents.southwest.getElement(true));

        return element;
    }
}