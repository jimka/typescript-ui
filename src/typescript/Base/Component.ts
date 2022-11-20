import { LayoutManager } from "./layout/LayoutManager.js";
import { Absolute } from "./layout/Absolute.js";
import { Border } from "./Border.js";
import { Size } from "./Size.js";
import { Insets } from "./Insets.js";
import { BaseObject } from "./BaseObject.js";
import { LayoutConstraints } from "./layout/LayoutConstraints.js";
import { Type } from "./Type.js";
import { Util } from "./Util.js";
import { CSS } from "./CSS.js";
import { BorderStyle } from "./BorderStyle.js";
import { Position } from "./Position.js";
//import { FastDom } from "./FastDom.js";

interface Comparator<V, U> {
    (a: V, b: U): number;
}

interface Style {
    [key: string]: string | null
}

export interface PerimeterSize {
    top: number,
    right: number,
    bottom: number,
    left: number
}

export class Component extends BaseObject {

    private layoutManager: LayoutManager;
    private components: Array<Component>;

    private element: HTMLElement | undefined;
    private tag: string;
    private attributes: Map<String, String>;
    private boxSizing: string | null;
    private position: Position;
    private cursor: string | null;
    private left: number;
    private top: number;
    private width: number;
    private height: number;
    private visible: Boolean | null;
    private insets: Insets = new Insets(0, 0, 0, 0);
    private padding: Insets | null;
    private foregroundColor: string | null;
    private backgroundColor: string | null;
    private backgroundImage: string | null;
    private preferredSize: Size | null = null;
    private minSize: Size | null;
    private maxSize: Size;
    private overflow: string | null;
    private whiteSpace: string | null;
    private border: Border | null = null;
    private borderRadius: string | null = null;
    private shadow: string | null = null;
    private pointerEvents: string | null = null;
    private zIndex: number | null;
    private displayed: Boolean | null;
    private display: string;
    private userSelect: string | null;
    private cssRule: CSSStyleRule;
    private dirtyStyle: Style = {};
    private dirtyCSSRule: Style = {};
    private autoCommitStyle: boolean = true;
    private layoutPaused: boolean = false;

    constructor(tag: string = "div") {
        super();

        this.tag = tag;
        this.cssRule = CSS.createComponentRule(this.getId()) as CSSStyleRule;

        this.layoutManager = new Absolute();
        this.components = [];

        this.attributes = new Map<String, String>();

        this.boxSizing = "border-box";
        this.position = Position.ABSOLUTE;
        this.cursor = "default";
        this.top = 0;
        this.left = 0;
        this.width = 0;
        this.height = 0;
        this.zIndex = 0;
        this.displayed = true;
        this.display = "block";
        this.visible = null; // Inherit from our parent.
        this.setInsets(new Insets(4, 4, 4, 4));
        this.padding = new Insets(0, 0, 0, 0);
        this.foregroundColor = null; // Inherit from our parent.
        this.backgroundColor = null; // Inherit from our parent.
        this.backgroundImage = null;
        //this.preferredSize = Base.instantiate("Base.Size");
        this.minSize = {
            width: 0,
            height: 0
        };
        this.maxSize = {
            width: Number.MAX_VALUE,
            height: Number.MAX_VALUE
        };
        this.overflow = "hidden";
        this.whiteSpace = "nowrap";
        this.userSelect = "none";
    }

    protected destructor() {
        let element = this.getElement();
        if (element) {
            element.remove();
        }
    }

    getTag() {
        return this.tag;
    }

    protected getCSSRule() {
        return this.cssRule;
    }

    getElement(createIfMissing: boolean = false) {
        if (!this.element) {
            let element = Util.select("#" + this.getId());
            if (!element && createIfMissing) {
                element = this.render();
            }

            this.element = element;
        }

        return this.element;
    }

    removeElement() {
        let element = this.getElement();
        if (!element) {
            return;
        }

        element.remove();
    }

    hasElementAttribute(key: string) {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM.");
            return;
        }

        return element.hasAttribute(key);
    }

    getElementAttribute(key: string) {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM. Attribute '" + key + "' can not be retrieved.");
            return;
        }

        return element.getAttribute(key);
    }

    setElementAttribute(key: string, value: Object | null | undefined) {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM. Attribute '" + key + "' will not be set.");
            return;
        }

        if (value) {
            element.setAttribute(key, String(value));
        } else {
            this.removeElementAttribute(key);
        }
    }

    removeElementAttribute(key: string) {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM. Attribute '" + key + "' will not be removed.");
            return;
        }

        element.removeAttribute(key);
    }

    setElementStyle(key: string, value: Object | null) {
        this.dirtyStyle[key] = value ? String(value) : null;

        if (this.autoCommitStyle) {
            this.commitElementStyle();
        }
    }

    setElementStyles(values: Style) {
        Object.assign(this.dirtyStyle, values);

        if (this.autoCommitStyle) {
            this.commitElementStyle();
        }
    }

    getAutoCommitStyle() {
        return this.autoCommitStyle;
    }

    setAutoCommitStyle(value: boolean) {
        this.autoCommitStyle = value;

        if (value) {
            this.commitElementStyle();
            this.commitCSSRule();
        }
    }

    commitElementStyle() {
        var me = this;
        // FastDom doesn't seem to be worth it, 'feels' faster without.
        // FastDom.mutate(function() {
        let element = me.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM. Style '" + key + "' will not be set.");
            return;
        }

        Object.assign(element.style, me.dirtyStyle);

        me.dirtyStyle = {};
        // });
    }

    setElementCSSRules(values: Style) {
        Object.assign(this.dirtyCSSRule, values);

        if (this.autoCommitStyle) {
            this.commitCSSRule();
        }
    }

    setElementCSSRule(key: string, value: Object | null) {
        this.dirtyCSSRule[key] = value ? String(value) : null;

        if (this.autoCommitStyle) {
            this.commitCSSRule();
        }
    }

    commitCSSRule() {
        var me = this;
        // FastDom doesn't seem to be worth it, 'feels' faster without.
        // FastDom.mutate(function() {
        Object.assign(me.cssRule.style, me.dirtyCSSRule);

        me.dirtyCSSRule = {};
        // });
    }

    setId(id: string) {
        super.setId(id);

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.id = id;
    }

    getAttribute(key: string) {
        return this.attributes.get(key);
    }

    setAttribute(key: string, value: string) {
        if (value === null) {
            this.delAttribute(key);

            return;
        }

        this.attributes.set(key, value);

        this.setElementAttribute(key, value);
    }

    delAttribute(key: string) {
        this.attributes.delete(key);
        this.removeElementAttribute(key);
    }

    isVisible() {
        return this.visible;
    }

    setVisible(value: Boolean) {
        if (Type.isBoolean(value)) {
            this.visible = value;
        } else if (!value) {
            this.visible = null;
        } else {
            throw new Error("Argument is not a boolean.");
        }

        let element = this.getElement();
        if (!element) {
            return;
        }

        let ruleValue;
        if (this.visible != null) {
            ruleValue = this.visible ? "inherit" : "hidden";
        } else {
            ruleValue = "inherit";
        }

        this.setElementCSSRule("visibility", ruleValue);
    }

    setZIndex(value: number) {
        this.zIndex = value;
        this.setElementStyle("zindex", this.zIndex);
    }

    setDisplayed(value: boolean) {
        this.displayed = !!value;

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.style.display = this.displayed ? this.display : "none";
    }

    getInsets() {
        return this.insets;
    }

    setInsets(insets: Insets | null) {
        if (!insets) {
            this.insets = new Insets(0, 0, 0, 0);
        } else {
            this.insets = insets;
        }

        if (this.insets) {
            this.setAttribute("insets", this.insets.render());
        } else {
            this.delAttribute("insets");
        }
    }

    getPadding() {
        return this.padding;
    }

    setPadding(padding: Insets | null) {
        this.padding = padding;
        this.cssRule.style.padding = padding ? padding.render() as string : "0px 0px 0px 0px";
    }

    getBackgroundColor() {
        return this.backgroundColor;
    }

    setBackgroundColor(backgroundColor: string | null) {
        this.backgroundColor = backgroundColor;
        this.cssRule.style.backgroundColor = this.backgroundColor ? this.backgroundColor : "";
    }

    getBackgroundImage() {
        return this.backgroundImage;
    }

    setBackgroundImage(backgroundImage: string | null) {
        this.backgroundImage = backgroundImage;
        this.cssRule.style.backgroundImage = this.backgroundImage ? this.backgroundImage : "";
    }

    getForegroundColor() {
        return this.foregroundColor;
    }

    setForegroundColor(foregroundColor: string | null) {
        this.foregroundColor = foregroundColor;
        this.cssRule.style.color = this.foregroundColor ? this.foregroundColor : "";
    }

    getBorder() {
        return this.border;
    }

    setBorder(topBorderStyle?: BorderStyle, topWidth?: number, topColor?: string,
        rightBorderStyle?: BorderStyle, rightWidth?: number, rightColor?: string,
        bottomBorderStyle?: BorderStyle, bottomWidth?: number, bottomColor?: string,
        leftBorderStyle?: BorderStyle, leftWidth?: number, leftColor?: string) {

        this.border = new Border(topBorderStyle, topWidth, topColor,
            rightBorderStyle, rightWidth, rightColor,
            bottomBorderStyle, bottomWidth, bottomColor,
            leftBorderStyle, leftWidth, leftColor
        );

        if (this.border) {
            this.border.applyOnCSSRule(this.cssRule);
        } else {
            this.cssRule.style.removeProperty("border");
        }
    }

    getCursor() {
        return this.cursor;
    }

    setCursor(cursor: string) {
        this.cursor = cursor;
        this.setElementStyle("cursor", cursor);
    }

    getBorderRadius() {
        return this.borderRadius;
    }

    setBorderRadius(borderRadius: string) {
        this.borderRadius = borderRadius;
        this.setElementStyle("borderRadius", this.borderRadius);
    }

    getShadow() {
        return this.shadow;
    }

    setShadow(shadow: string | null) {
        this.shadow = shadow;
        this.cssRule.style.boxShadow = this.shadow ? this.shadow : "none";
    }

    getSize(): Size | null {
        return {
            width: this.width,
            height: this.height
        }
    }

    getPreferredSize() {
        let layoutManager = this.getLayoutManager();
        let preferredSize;

        if (this.preferredSize) {
            preferredSize = this.preferredSize;
        } else if (!layoutManager) {
            preferredSize = this.getSize();
        } else {
            preferredSize = layoutManager.getPreferredSize();
        }

        if (!preferredSize) {
            console.warn("Component does not have a preferred size, (" + this.getId() + ")");
        }

        return preferredSize;
    }

    setPreferredSize(width: number, height: number) {
        this.preferredSize = {
            width: width,
            height: height
        };

        this.setAttribute("preferredSize", this.preferredSize.width + " " + this.preferredSize.height);
    }

    getMinSize() {
        let componentMinSize = this.minSize;;
        let layoutManager = this.getLayoutManager();

        if (!layoutManager) {
            return componentMinSize;
        }

        let layoutMinSize = layoutManager.getMinSize();

        let width;
        let height;

        if (componentMinSize) {
            if (layoutMinSize) {
                width = Math.max(componentMinSize.width, layoutMinSize.width);
                height = Math.max(componentMinSize.height, layoutMinSize.height);
            } else {
                width = componentMinSize.width;
                height = componentMinSize.height;
            }
        } else {
            if (layoutMinSize) {
                width = layoutMinSize.width;
                height = layoutMinSize.height;
            } else {
                width = 0;
                height = 0;
            }
        }

        return {
            width: width,
            height: height
        }
    }

    setMinSize(width: number, height: number) {
        this.minSize = {
            width: width,
            height: height
        };

        this.cssRule.style.minWidth = String(this.minSize.width);
        this.cssRule.style.minHeight = String(this.minSize.height);
    }

    getMaxSize() {
        let componentMaxSize = this.maxSize;;
        let layoutManager = this.getLayoutManager();

        if (!layoutManager) {
            return componentMaxSize;
        }

        let layoutMaxSize = layoutManager.getMaxSize();

        let width;
        let height;

        if (componentMaxSize) {
            if (layoutMaxSize) {
                width = Math.max(componentMaxSize.width, layoutMaxSize.width);
                height = Math.max(componentMaxSize.height, layoutMaxSize.height);
            } else {
                width = componentMaxSize.width;
                height = componentMaxSize.height;
            }
        } else {
            if (layoutMaxSize) {
                width = layoutMaxSize.width;
                height = layoutMaxSize.height;
            } else {
                width = Number.MAX_VALUE;
                height = Number.MAX_VALUE;
            }
        }

        return {
            width: width,
            height: height
        };
    }

    setMaxSize(width: number, height: number) {
        this.maxSize = {
            width: width,
            height: height
        };

        this.cssRule.style.maxWidth = String(this.maxSize.width);
        this.cssRule.style.maxHeight = String(this.maxSize.height);

        this.setAttribute("maxSize", this.maxSize.width + " " + this.maxSize.height);
    }

    getInnerSize() {
        let element = this.getElement();
        if (!element) {
            return null;
        }

        let perimiterSize = this.getPerimiterSize();

        let width = this.width - perimiterSize.left - perimiterSize.right;
        let height = this.height - perimiterSize.top - perimiterSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    getBorderSize() {
        let borderSize: PerimeterSize = {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
        };

        if (this.border) {
            borderSize.top = this.border.getTop().getWidth();
            borderSize.right = this.border.getRight().getWidth();
            borderSize.bottom = this.border.getBottom().getWidth();
            borderSize.left = this.border.getLeft().getWidth();
        }

        return borderSize;
    }

    getPerimiterSize() {
        let borderSize = this.getBorderSize();
        let insets = this.getInsets();

        let perimiterSize: PerimeterSize = {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
        }

        if (insets) {
            perimiterSize.top = insets.getTop();
            perimiterSize.right = insets.getRight();
            perimiterSize.bottom = insets.getBottom();
            perimiterSize.left = insets.getLeft();
        }

        if (borderSize) {
            perimiterSize.top += borderSize.top;
            perimiterSize.right += borderSize.right;
            perimiterSize.bottom += borderSize.bottom;
            perimiterSize.left += borderSize.left;
        }

        return perimiterSize;
    }

    // Currently commented out, probing if a scrollbar is visible or not seems to be unreliable with the below method.

    // hasHorizontalScrollBar() {
    //     let element = this.getElement();

    //     let overflowX = window.getComputedStyle(element)['overflow-x'];

    //     return (overflowX === 'scroll' || overflowX === 'auto') && element.scrollWidth > element.clientWidth;
    // }

    // getHorizontalScrollBarSize() {
    //     return this.hasHorizontalScrollBar() ? Base.getScrollBarWidth() : 0;
    // }

    // hasVerticalScrollBar() {
    //     let element = this.getElement();

    //     let overflowY = window.getComputedStyle(element)['overflow-y'];

    //     return (overflowY === 'scroll' || overflowY === 'auto') && element.scrollHeight > element.clientHeight;
    // }

    // getVerticalScrollBarSize() {
    //     return this.hasVerticalScrollBar() ? Base.getScrollBarWidth() : 0;
    // }

    setSize(size: Size) {
        this.width = size.width;
        this.height = size.height;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementStyles({
            "width": String(size.width),
            "height": String(size.height)
        });

        this.doLayout();
    }

    getWidth() {
        let size = this.getSize();
        if (size) {
            return size.width;
        } else {
            return 0;
        }
    }

    setWidth(width: number) {
        this.width = width;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementStyle("width", String(this.width));
    }

    getHeight() {
        let size = this.getSize();
        if (size) {
            return size.height;
        } else {
            return 0;
        }
    }

    setHeight(height: number) {
        this.height = height;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementStyle("height", String(this.height));
    }

    getX() {
        return this.left;
    }

    setX(x: number) {
        this.left = x;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementStyle("left", String(this.left));
    }

    getY() {
        return this.top;
    }

    setY(y: number) {
        this.top = y;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementStyle("top", String(this.top));
    }

    getPosition() {
        return this.position;
    }

    setPosition(position: Position) {
        this.position = position;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementCSSRule("position", position);
    }

    getOverflow() {
        return this.overflow;
    }

    setOverflow(overflow: string) {
        this.overflow = overflow;

        this.cssRule.style.overflow = overflow;
    }

    setPointerEvents(value: string) {
        this.pointerEvents = value;

        this.setElementStyle("pointerEvents", value);
    }

    focus() {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM, unable to focus.");
            return;
        }

        element.focus();
    }

    unfocus() {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM, unable to focus.");
            return;
        }

        element.blur();
    }

    applyStyle(element: HTMLElement) {
        element.removeAttribute("style");

        if (this.boxSizing) {
            this.cssRule.style.boxSizing = this.boxSizing;
        }

        if (this.position) {
            this.cssRule.style.position = this.position;
        }

        if (this.visible != null) {
            this.cssRule.style.visibility = this.visible ? "visible" : "hidden";
        } else {
            this.cssRule.style.visibility = "inherit";
        }

        if (this.displayed != null) {
            this.cssRule.style.display = this.displayed ? this.display : "none";
        }

        if (this.cursor) {
            this.cssRule.style.cursor = this.cursor;
        }

        if (this.foregroundColor) {
            this.cssRule.style.color = this.foregroundColor;
        }

        if (this.backgroundColor) {
            this.cssRule.style.backgroundColor = this.backgroundColor;
        }

        if (this.backgroundImage) {
            this.cssRule.style.backgroundImage = this.backgroundImage;
        }

        if (this.width) {
            element.style.width = String(this.width);
        }

        if (this.top) {
            element.style.top = String(this.top);
        }

        if (this.left) {
            element.style.left = String(this.left);
        }

        if (this.height) {
            element.style.height = String(this.height);
        }

        if (this.minSize) {
            this.cssRule.style.minWidth = String(this.minSize.width);
            this.cssRule.style.minHeight = String(this.minSize.height);
        }

        if (this.maxSize) {
            this.cssRule.style.maxWidth = String(this.maxSize.width);
            this.cssRule.style.maxHeight = String(this.maxSize.height);
            this.setAttribute("maxSize", this.maxSize.width + " " + this.maxSize.height);
        }

        if (this.overflow) {
            this.cssRule.style.overflow = this.overflow;
        }

        if (this.whiteSpace) {
            this.cssRule.style.whiteSpace = this.whiteSpace;
        }

        if (this.border) {
            this.border.applyOnCSSRule(this.cssRule);
        } else {
            this.cssRule.style.removeProperty("border");
        }

        if (this.borderRadius) {
            this.cssRule.style.borderRadius = this.borderRadius;
        }

        if (this.shadow) {
            this.cssRule.style.boxShadow = this.shadow;
        }

        if (this.pointerEvents) {
            element.style.pointerEvents = this.pointerEvents;
        }

        if (this.zIndex) {
            element.style.zIndex = String(this.zIndex);
        }

        if (this.userSelect) {
            this.cssRule.style.userSelect = this.userSelect;
        }

        if (this.padding) {
            this.cssRule.style.padding = this.padding.render();
        }

        if (this.insets) {
            this.setAttribute("insets", this.insets.render());
        }

        this.cssRule.style.margin = "0px 0px 0px 0px";
    }

    sync() {
        let element = Util.select("#" + this.getId());
        if (!element) {
            return;
        }

        this.applyStyle(element);
    }

    addComponent(component: Component, constraints?: LayoutConstraints) {
        this.components.push(component);
        this.setLayoutConstraints(component, constraints);

        let element = this.getElement();
        if (!element) {
            return;
        }

        let compElement = component.getElement(true);
        element.appendChild(compElement);
        this.doLayout();
    }

    removeComponent(component: Component | Number) {
        var index: number;
        if (component instanceof Component) {
            index = this.components.indexOf(component)
        } else if (component instanceof Number) {
            index = (component as Number).valueOf();
            component = this.components[index];
        } else {
            return;
        }

        if (index > -1) {
            this.components.splice(index, 1);
        }

        let constraints = this.delLayoutConstraints(component);

        component.removeElement();
        this.doLayout();

        return constraints;
    }

    removeAllComponents() {
        for (let idx in this.components) {
            let component = this.components[idx];
            component.removeElement();
        }

        this.components = [];
    }

    sortComponents(comparator: Comparator<Component, Component> | undefined) {
        this.components.sort(comparator);
    }

    getComponents() {
        return this.components;
    }

    getLayoutConstraints(component: Component) {
        if (!this.layoutManager) {
            console.warn("Unable to get layout constraints, no layout manager specified.");
            return;
        }

        return this.layoutManager.getLayoutConstraints(component);
    }

    setLayoutConstraints(component: Component, constraints?: LayoutConstraints) {
        if (!this.layoutManager) {
            console.warn("Unable to set layout constraints, no layout manager specified.");
            return;
        }

        return this.layoutManager.setLayoutConstraints(component, constraints);
    }

    delLayoutConstraints(component: Component) {
        if (!this.layoutManager) {
            return null;
        }

        return this.layoutManager.delLayoutConstraints(component);
    }

    getLayoutManager() {
        return this.layoutManager;
    }

    setLayoutManager(layoutManager: LayoutManager) {
        if (this.layoutManager) {
            this.layoutManager.detach();
        }

        this.layoutManager = layoutManager;

        if (this.layoutManager) {
            this.layoutManager.attach(this);
        }

        this.setAttribute("layout", layoutManager.getClassName());
    }

    isLayoutPaused() {
        return this.layoutPaused;
    }

    pauseLayout() {
        this.layoutPaused = true;
    }

    resumeLayout() {
        this.layoutPaused = false;
        this.doLayout();
    }

    doChildrenComponentLayouts() {
        let components = this.getComponents();

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            component.doLayout();
        }
    }

    doLayout() {
        if (this.isLayoutPaused()) {
            return;
        }

        if (!this.layoutManager) {
            throw new Error("Unable to do layout, no layout manager specified.");
        }

        this.layoutManager.doLayout();
    }

    protected init(element?: HTMLElement) {
        element = element || this.getElement();
        if (!element) {
            throw new Error("Component has not been rendered!");
        }

        element.id = this.getId();
        element.classList.add(this.constructor.name);

        for (let key in this.attributes) {
            let value = this.attributes.get(key);
            if (value != null) {
                element.setAttribute(key, value.valueOf());
            }
        }

        this.applyStyle(element);

        let components = this.getComponents();
        for (let i in components) {
            let component = components[i];
            let compElement = component.getElement(true);

            element.appendChild(compElement);
        }
    }

    protected render() {
        let element = document.createElement(this.tag);

        this.init(element);

        return element;
    }
}
