// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./layout/LayoutManager.js";
import { Absolute } from "./layout/Absolute.js";
import { Border, BorderOptions } from "./Border.js";
import { Size } from "./Size.js";
import { Insets } from "./Insets.js";
import { BaseObject } from "./BaseObject.js";
import { LayoutConstraints } from "./layout/LayoutConstraints.js";
import { Type } from "./Type.js";
import { Util } from "./Util.js";
import { CSS } from "./CSS.js";
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

/**
 * Base class for all UI components in the framework.
 *
 * Manages the component's DOM element lifecycle, CSS style rule, layout manager,
 * child component tree, and all visual properties (size, position, color, border, etc.).
 * Subclasses override render() and init() to produce specialised elements.
 */
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
    private onPreferredSizeChange: (() => void) | null = null;
    private minSize: Size | null;
    private maxSize: Size;
    private overflow: string | null;
    private whiteSpace: string | null;
    private border: Border | null = null;
    private borderCSS: string | null = null;
    private borderRadius: string | null = null;
    private shadow: string | null = null;
    private pointerEvents: string | null = null;
    private zIndex: number | null;
    private displayed: Boolean | null;
    private display: string;
    private userSelect: string | null;
    private verticalAlign: string | null;
    private cssRule: CSSStyleRule;
    private dirtyStyle: Style = {};
    private dirtyCSSRule: Style = {};
    private autoCommitStyle: boolean = true;
    private layoutPaused: boolean = false;
    colorScheme: string;

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
        this.verticalAlign = "baseline";
    }

    /**
     * Removes the component's DOM element when the component is destroyed.
     */
    protected destructor() {
        let element = this.getElement();
        if (element) {
            element.remove();
        }
    }

    /**
     * Returns the HTML tag name used when creating this component's element.
     *
     * @returns The HTML tag string (e.g. "div", "button").
     */
    getTag() {
        return this.tag;
    }

    /**
     * Returns the component's dedicated CSS style rule for applying class-level styles.
     *
     * @returns The CSSStyleRule scoped to this component's ID.
     */
    protected getCSSRule() {
        return this.cssRule;
    }

    /**
     * Returns the DOM element, querying by ID; creates and renders it if createIfMissing is true.
     *
     * @param createIfMissing - Optional. When true, renders and returns a new element if none exists in the DOM.
     *
     * @returns The component's HTMLElement, or undefined if it does not exist and createIfMissing is false.
     */
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

    /**
     * Removes the component's DOM element from the document.
     */
    removeElement() {
        let element = this.getElement();
        if (!element) {
            return;
        }

        element.remove();
    }

    /**
     * Returns whether the DOM element has the given attribute set.
     *
     * @param key - The attribute name to check.
     *
     * @returns True if the attribute exists, false otherwise, or undefined if the element is not in the DOM.
     */
    hasElementAttribute(key: string) {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM.");
            return;
        }

        return element.hasAttribute(key);
    }

    /**
     * Returns the value of a DOM element attribute, or undefined if the element is not in the DOM.
     *
     * @param key - The attribute name to retrieve.
     *
     * @returns The attribute value string, null if the attribute is absent, or undefined if the element is not in the DOM.
     */
    getElementAttribute(key: string) {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM. Attribute '" + key + "' can not be retrieved.");
            return;
        }

        return element.getAttribute(key);
    }

    /**
     * Sets a DOM element attribute; removes it if value is null/undefined.
     *
     * @param key - The attribute name.
     * @param value - The attribute value. Passing null or undefined removes the attribute.
     */
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

    /**
     * Removes an attribute from the DOM element.
     *
     * @param key - The attribute name to remove.
     */
    removeElementAttribute(key: string) {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM. Attribute '" + key + "' will not be removed.");
            return;
        }

        element.removeAttribute(key);
    }

    /**
     * Queues a single inline style property for commit to the DOM element.
     *
     * @param key - The CSS property name (camelCase).
     * @param value - The value to set, or null to remove the property.
     *
     * @remarks Immediately flushes to the DOM unless autoCommitStyle is false.
     */
    setElementStyle(key: string, value: Object | null) {
        this.dirtyStyle[key] = value ? String(value) : null;

        if (this.autoCommitStyle) {
            this.commitElementStyle();
        }
    }

    /**
     * Queues multiple inline style properties for commit to the DOM element.
     *
     * @param values - An object whose keys are camelCase CSS property names and values are strings or null.
     *
     * @remarks Immediately flushes to the DOM unless autoCommitStyle is false.
     */
    setElementStyles(values: Style) {
        Object.assign(this.dirtyStyle, values);

        if (this.autoCommitStyle) {
            this.commitElementStyle();
        }
    }

    /**
     * Returns whether style changes are immediately committed to the DOM.
     *
     * @returns True if auto-commit is enabled, false if changes are batched.
     */
    getAutoCommitStyle() {
        return this.autoCommitStyle;
    }

    /**
     * Enables or disables auto-commit; flushing all pending style and CSS rule changes when re-enabled.
     *
     * @param value - True to enable immediate commits; false to batch changes until manually flushed.
     */
    setAutoCommitStyle(value: boolean) {
        this.autoCommitStyle = value;

        if (value) {
            this.commitElementStyle();
            this.commitCSSRule();
        }
    }

    /**
     * Flushes all queued inline style changes to the DOM element and clears the dirty map.
     */
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

    /**
     * Queues multiple CSS rule properties for commit to the component's CSS rule.
     *
     * @param values - An object whose keys are camelCase CSS property names and values are strings or null.
     *
     * @remarks Immediately flushes to the CSS rule unless autoCommitStyle is false.
     */
    setElementCSSRules(values: Style) {
        Object.assign(this.dirtyCSSRule, values);

        if (this.autoCommitStyle) {
            this.commitCSSRule();
        }
    }

    /**
     * Queues a single CSS rule property for commit to the component's CSS rule.
     *
     * @param key - The CSS property name (camelCase).
     * @param value - The value to set, or null to remove the property.
     *
     * @remarks Immediately flushes to the CSS rule unless autoCommitStyle is false.
     */
    setElementCSSRule(key: string, value: Object | null) {
        this.dirtyCSSRule[key] = value ? String(value) : null;

        if (this.autoCommitStyle) {
            this.commitCSSRule();
        }
    }

    /**
     * Flushes all queued CSS rule changes to the component's CSS rule and clears the dirty map.
     */
    commitCSSRule() {
        var me = this;
        // FastDom doesn't seem to be worth it, 'feels' faster without.
        // FastDom.mutate(function() {
        Object.assign(me.cssRule.style, me.dirtyCSSRule);

        me.dirtyCSSRule = {};
        // });
    }

    /**
     * Sets the component ID and updates the DOM element's id attribute if the element exists.
     *
     * @param id - The new unique identifier for this component.
     */
    setId(id: string) {
        super.setId(id);

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.id = id;
    }

    /**
     * Returns a component-level attribute value from the internal attributes map.
     *
     * @param key - The attribute name.
     *
     * @returns The stored attribute value, or undefined if not set.
     */
    getAttribute(key: string) {
        return this.attributes.get(key);
    }

    /**
     * Stores a component-level attribute and mirrors it onto the DOM element.
     *
     * @param key - The attribute name.
     * @param value - The attribute value. Passing null delegates to delAttribute.
     */
    setAttribute(key: string, value: string) {
        if (value === null) {
            this.delAttribute(key);

            return;
        }

        this.attributes.set(key, value);

        this.setElementAttribute(key, value);
    }

    /**
     * Removes a component-level attribute from both the internal map and the DOM element.
     *
     * @param key - The attribute name to remove.
     */
    delAttribute(key: string) {
        this.attributes.delete(key);
        this.removeElementAttribute(key);
    }

    /**
     * Returns the visibility state, or null if inherited from the parent.
     *
     * @returns True if explicitly visible, false if explicitly hidden, null if inheriting from the parent.
     */
    isVisible() {
        return this.visible;
    }

    /**
     * Sets visibility; true = visible, false = hidden, null/falsy = inherit from parent.
     *
     * @param value - True to show the component, false to hide it, or a falsy non-boolean to inherit.
     *
     * @remarks Throws an Error if value is a non-boolean truthy value.
     */
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

    /**
     * Sets the CSS z-index of the component.
     *
     * @param value - The z-index value.
     */
    setZIndex(value: number) {
        this.zIndex = value;
        this.setElementStyle("zIndex", this.zIndex);
    }

    /**
     * Shows or hides the component using CSS display; hidden components take no space.
     *
     * @param value - True to show the component, false to set display to "none".
     */
    setDisplayed(value: boolean) {
        this.displayed = !!value;

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.style.display = this.displayed ? this.display : "none";
    }

    /**
     * Returns the component's insets (internal spacing used by layout managers).
     *
     * @returns The current Insets instance.
     */
    getInsets() {
        return this.insets;
    }

    /**
     * Sets the component's insets; null resets to zero insets.
     *
     * @param insets - The new Insets, or null to reset to zero on all sides.
     */
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

    /**
     * Returns the CSS padding insets for this component.
     *
     * @returns The current padding Insets, or null if none are set.
     */
    getPadding() {
        return this.padding;
    }

    /**
     * Sets the CSS padding; null resets to zero.
     *
     * @param padding - The new padding Insets, or null to reset to "0px 0px 0px 0px".
     */
    setPadding(padding: Insets | null) {
        this.padding = padding;
        this.cssRule.style.padding = padding ? padding.render() as string : "0px 0px 0px 0px";
    }

    /**
     * Returns the component's background color, or null if inherited.
     *
     * @returns The CSS color string, or null if none is set.
     */
    getBackgroundColor() {
        return this.backgroundColor;
    }

    /**
     * Sets the background color CSS property; null removes the property to inherit.
     *
     * @param backgroundColor - A CSS color string, or null to remove the property and inherit.
     */
    setBackgroundColor(backgroundColor: string | null) {
        this.backgroundColor = backgroundColor;

        if (backgroundColor) {
            this.cssRule.style.setProperty('background-color', backgroundColor);
        } else {
            this.cssRule.style.removeProperty('background-color');
        }
    }

    /**
     * Returns the background image CSS value, or null if none is set.
     *
     * @returns The CSS background-image string, or null.
     */
    getBackgroundImage() {
        return this.backgroundImage;
    }

    /**
     * Sets the CSS background-image property; null removes it.
     *
     * @param backgroundImage - A CSS background-image string, or null to remove the property.
     */
    setBackgroundImage(backgroundImage: string | null) {
        this.backgroundImage = backgroundImage;

        if (backgroundImage) {
            this.cssRule.style.setProperty('background-image', backgroundImage);
        } else {
            this.cssRule.style.removeProperty('background-image');
        }
    }

    /**
     * Returns the foreground (text) color, or null if inherited.
     *
     * @returns The CSS color string, or null if none is set.
     */
    getForegroundColor() {
        return this.foregroundColor;
    }

    /**
     * Sets the CSS color (text color); null removes the property to inherit.
     *
     * @param foregroundColor - A CSS color string, or null to remove the property and inherit.
     */
    setForegroundColor(foregroundColor: string | null) {
        this.foregroundColor = foregroundColor;

        if (foregroundColor) {
            this.cssRule.style.setProperty('color', foregroundColor);
        } else {
            this.cssRule.style.removeProperty('color');
        }
    }

    getColorScheme() {
        return this.colorScheme;
    }

    setColorScheme(colorScheme: string) {
        this.colorScheme = colorScheme;

        this.cssRule.style.setProperty('color-scheme', colorScheme);
    }

    /**
     * Returns the Border instance, or null if no border is set.
     *
     * @returns The current Border object, or null.
     */
    getBorder() {
        return this.border;
    }

    /**
     * Creates and applies a border from options, or clears the border CSS property.
     *
     * @param options - Optional. Border configuration (style, width, color). Omit to apply a default border.
     */
    setBorder(options?: BorderOptions | string) {
        if (typeof options === 'string' && options.trimStart().startsWith('var(')) {
            this.borderCSS = options;
            this.cssRule.style.setProperty('border', options);

            const varName  = options.match(/var\((--[^,)]+)/)?.[1];
            const resolved = varName
                ? getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
                : null;

            this.border = resolved ? Border.fromString(resolved) : null;
        } else if (typeof options === 'string') {
            this.borderCSS = null;
            this.border    = Border.fromString(options);
            this.border.applyOnCSSRule(this.cssRule);
        } else {
            this.borderCSS = null;
            this.border    = new Border(options);

            if (this.border) {
                this.border.applyOnCSSRule(this.cssRule);
            } else {
                this.cssRule.style.removeProperty('border');
            }
        }
    }

    /**
     * Returns the current CSS cursor value.
     *
     * @returns The CSS cursor string, or null if not set.
     */
    getCursor() {
        return this.cursor;
    }

    /**
     * Sets the CSS cursor style on the element.
     *
     * @param cursor - A CSS cursor value (e.g. "pointer", "text", "default").
     */
    setCursor(cursor: string) {
        this.cursor = cursor;
        this.setElementStyle("cursor", cursor);
    }

    /**
     * Returns the CSS border-radius value, or null if not set.
     *
     * @returns The CSS border-radius string, or null.
     */
    getBorderRadius() {
        return this.borderRadius;
    }

    /**
     * Sets the CSS border-radius on the element; null clears it.
     *
     * @param borderRadius - Optional. A CSS border-radius string (e.g. "4px"), or null to clear.
     */
    setBorderRadius(borderRadius: string | null = null) {
        this.borderRadius = borderRadius;
        this.setElementStyle("borderRadius", this.borderRadius);
    }

    /**
     * Returns the CSS box-shadow value, or null if not set.
     *
     * @returns The CSS box-shadow string, or null.
     */
    getShadow() {
        return this.shadow;
    }

    /**
     * Sets the CSS box-shadow; null sets it to 'none'.
     *
     * @param shadow - A CSS box-shadow string, or null to set the shadow to "none".
     */
    setShadow(shadow: string | null) {
        this.shadow = shadow;

        this.cssRule.style.setProperty('box-shadow', this.shadow || 'none');
    }

    /**
     * Sets the CSS outline on the element; null removes the property.
     *
     * @param outline - A CSS outline value (e.g. "none", "2px solid blue"), or null to inherit.
     */
    setOutline(outline: string | null) {
        if (outline !== null) {
            this.cssRule.style.setProperty('outline', outline);
        } else {
            this.cssRule.style.removeProperty('outline');
        }
    }

    /**
     * Sets the CSS appearance on the element; null removes the property.
     *
     * @param value - A CSS appearance value (e.g. "none", "auto"), or null to remove.
     */
    setAppearance(value: string | null) {
        if (value !== null) {
            this.cssRule.style.setProperty('-webkit-appearance', value);
            this.cssRule.style.setProperty('appearance', value);
        } else {
            this.cssRule.style.removeProperty('-webkit-appearance');
            this.cssRule.style.removeProperty('appearance');
        }
    }

    /**
     * Sets the CSS border-image shorthand on the element; null removes the property.
     *
     * @param value - A CSS border-image value (e.g. "none"), or null to remove.
     */
    setBorderImage(value: string | null) {
        if (value !== null) {
            this.cssRule.style.setProperty('border-image', value);
        } else {
            this.cssRule.style.removeProperty('border-image');
        }
    }

    /**
     * Sets the CSS transform on the element; null removes the property.
     *
     * @param value - A CSS transform value (e.g. "translateY(-1px)"), or null to remove.
     */
    setTransform(value: string | null) {
        if (value !== null) {
            this.cssRule.style.setProperty('transform', value);
        } else {
            this.cssRule.style.removeProperty('transform');
        }
    }

    /**
     * Returns the component's current width and height.
     *
     * @returns A Size object with the current width and height in pixels.
     */
    getSize(): Size | null {
        return {
            width: this.width,
            height: this.height
        }
    }

    /**
     * Returns the preferred size from the explicit override, layout manager, or current size.
     *
     * @returns The preferred Size, determined in priority order: explicit override, layout manager, then current size.
     */
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

        return preferredSize;
    }

    /**
     * Sets an explicit preferred size; triggers the onPreferredSizeChange callback if changed.
     *
     * @param width - The preferred width in pixels.
     * @param height - The preferred height in pixels.
     */
    setPreferredSize(width: number, height: number) {
        const prev = this.preferredSize;
        if (prev && prev.width === width && prev.height === height) {
            return;
        }

        this.preferredSize = { width, height };
        this.setAttribute("preferredSize", this.preferredSize.width + " " + this.preferredSize.height);
        this.onPreferredSizeChange?.();
    }

    /**
     * Returns the effective minimum size: the larger of the component and layout manager minimums.
     *
     * @returns A Size object whose width and height are the element-wise maximums of the component and layout manager minimums.
     */
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

    /**
     * Sets the minimum size and applies it to the CSS rule.
     *
     * @param width - The minimum width in pixels.
     * @param height - The minimum height in pixels.
     */
    setMinSize(width: number, height: number) {
        this.minSize = {
            width: width,
            height: height
        };

        this.cssRule.style.minWidth = this.minSize.width + "px";
        this.cssRule.style.minHeight = this.minSize.height + "px";
    }

    /**
     * Returns the effective maximum size: the larger of the component and layout manager maximums.
     *
     * @returns A Size object whose width and height are the element-wise maximums of the component and layout manager maximums.
     */
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

    /**
     * Sets the maximum size and applies it to the CSS rule.
     *
     * @param width - The maximum width in pixels. Pass Number.MAX_VALUE to remove the constraint.
     * @param height - The maximum height in pixels. Pass Number.MAX_VALUE to remove the constraint.
     */
    setMaxSize(width: number, height: number) {
        this.maxSize = {
            width: width,
            height: height
        };

        this.cssRule.style.maxWidth = this.maxSize.width === Number.MAX_VALUE ? "none" : this.maxSize.width + "px";
        this.cssRule.style.maxHeight = this.maxSize.height === Number.MAX_VALUE ? "none" : this.maxSize.height + "px";

        this.setAttribute("maxSize", this.maxSize.width + " " + this.maxSize.height);
    }

    /**
     * Returns the usable inner size: component size minus insets and border widths.
     *
     * @returns The inner Size in pixels, or null if the element is not yet in the DOM.
     */
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

    /**
     * Returns the per-side pixel widths of the component's border.
     *
     * @returns A PerimeterSize with zero values on each side when no border is set.
     */
    getBorderSize() {
        let borderSize: PerimeterSize = {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
        };

        if (this.border) {
            borderSize.top    = this.border.getTop().getWidth();
            borderSize.right  = this.border.getRight().getWidth();
            borderSize.bottom = this.border.getBottom().getWidth();
            borderSize.left   = this.border.getLeft().getWidth();
        }

        return borderSize;
    }

    /**
     * Returns the total per-side consumed space: insets plus border widths.
     *
     * @returns A PerimeterSize where each side is the sum of the inset and border width for that side.
     */
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

    getVerticalAlign() {
        return this.verticalAlign
    }

    setVerticalAlign(align: string) {
        this.verticalAlign = align;

        this.setElementCSSRule("verticalAlign", align);
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

    /**
     * Sets width and height, updates the DOM element, and triggers doLayout.
     *
     * @param size - The new Size with width and height in pixels.
     */
    setSize(size: Size) {
        this.width = size.width;
        this.height = size.height;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementStyles({
            "width": size.width + "px",
            "height": size.height + "px"
        });

        this.doLayout();
    }

    /**
     * Returns the component's current width in pixels.
     *
     * @returns The width in pixels, or 0 if the size is unavailable.
     */
    getWidth() {
        let size = this.getSize();
        if (size) {
            return size.width;
        } else {
            return 0;
        }
    }

    /**
     * Sets the component width and updates the DOM element's inline style.
     *
     * @param width - The new width in pixels.
     */
    setWidth(width: number) {
        this.width = width;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementStyle("width", this.width + "px");
    }

    /**
     * Returns the component's current height in pixels.
     *
     * @returns The height in pixels, or 0 if the size is unavailable.
     */
    getHeight() {
        let size = this.getSize();
        if (size) {
            return size.height;
        } else {
            return 0;
        }
    }

    /**
     * Sets the component height and updates the DOM element's inline style.
     *
     * @param height - The new height in pixels.
     */
    setHeight(height: number) {
        this.height = height;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementStyle("height", this.height + "px");
    }

    /**
     * Returns the component's horizontal position (CSS left) in pixels.
     *
     * @returns The left offset in pixels.
     */
    getX() {
        return this.left;
    }

    /**
     * Sets the CSS left position and updates the DOM element's inline style.
     *
     * @param x - The horizontal offset in pixels.
     */
    setX(x: number) {
        this.left = x;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementStyle("left", this.left + "px");
    }

    /**
     * Returns the component's vertical position (CSS top) in pixels.
     *
     * @returns The top offset in pixels.
     */
    getY() {
        return this.top;
    }

    /**
     * Sets the CSS top position and updates the DOM element's inline style.
     *
     * @param y - The vertical offset in pixels.
     */
    setY(y: number) {
        this.top = y;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementStyle("top", this.top + "px");
    }

    /**
     * Returns the CSS position mode for this component.
     *
     * @returns The current Position value (e.g. Position.ABSOLUTE).
     */
    getPosition() {
        return this.position;
    }

    /**
     * Sets the CSS position mode and updates the component's CSS rule.
     *
     * @param position - The CSS position mode to apply (e.g. Position.ABSOLUTE, Position.STATIC).
     */
    setPosition(position: Position) {
        this.position = position;

        let element = this.getElement();
        if (!element) {
            return;
        }

        this.setElementCSSRule("position", position);
    }

    /**
     * Returns the CSS overflow value.
     *
     * @returns The CSS overflow string, or null if not set.
     */
    getOverflow() {
        return this.overflow;
    }

    /**
     * Sets the CSS overflow property on the component's CSS rule.
     *
     * @param overflow - A CSS overflow value (e.g. "hidden", "auto", "visible").
     */
    setOverflow(overflow: string) {
        this.overflow = overflow;

        this.cssRule.style.overflow = overflow;
    }

    /**
     * Sets the CSS pointer-events property on the element.
     *
     * @param value - A CSS pointer-events value (e.g. "none", "auto").
     */
    setPointerEvents(value: string) {
        this.pointerEvents = value;

        this.setElementStyle("pointerEvents", value);
    }

    /**
     * Moves browser focus to this component's DOM element.
     */
    focus() {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM, unable to focus.");
            return;
        }

        element.focus();
    }

    /**
     * Removes browser focus from this component's DOM element.
     */
    unfocus() {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM, unable to focus.");
            return;
        }

        element.blur();
    }

    /**
     * Writes all current style properties to the given element and its associated CSS rule.
     *
     * @param element - The HTMLElement to apply styles to.
     *
     * @remarks Clears all existing inline styles on the element before re-applying, ensuring a clean state.
     */
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
            this.cssRule.style.setProperty('color', this.foregroundColor);
        }

        if (this.backgroundColor) {
            this.cssRule.style.setProperty('background-color', this.backgroundColor);
        }

        if (this.backgroundImage) {
            this.cssRule.style.setProperty('background-image', this.backgroundImage);
        }

        if (this.width) {
            element.style.width = this.width + "px";
        }

        if (this.top) {
            element.style.top = this.top + "px";
        }

        if (this.left) {
            element.style.left = this.left + "px";
        }

        if (this.height) {
            element.style.height = this.height + "px";
        }

        if (this.minSize) {
            this.cssRule.style.minWidth = this.minSize.width + "px";
            this.cssRule.style.minHeight = this.minSize.height + "px";
        }

        if (this.maxSize) {
            this.cssRule.style.maxWidth = this.maxSize.width === Number.MAX_VALUE ? "none" : this.maxSize.width + "px";
            this.cssRule.style.maxHeight = this.maxSize.height === Number.MAX_VALUE ? "none" : this.maxSize.height + "px";
            this.setAttribute("maxSize", this.maxSize.width + " " + this.maxSize.height);
        }

        if (this.overflow) {
            this.cssRule.style.overflow = this.overflow;
        }

        if (this.whiteSpace) {
            this.cssRule.style.whiteSpace = this.whiteSpace;
        }

        if (this.borderCSS) {
            this.cssRule.style.setProperty('border', this.borderCSS);
        } else if (this.border) {
            this.border.applyOnCSSRule(this.cssRule);
        } else {
            this.cssRule.style.removeProperty("border");
        }

        if (this.borderRadius) {
            this.cssRule.style.borderRadius = this.borderRadius;
        }

        if (this.shadow) {
            this.cssRule.style.setProperty('box-shadow', this.shadow);
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

    /**
     * Re-applies all styles to the existing DOM element, syncing state after external changes.
     */
    sync() {
        let element = Util.select("#" + this.getId());
        if (!element) {
            return;
        }

        this.applyStyle(element);
    }

    /**
     * Adds a child component, appends its element, wires preferred-size change propagation, and triggers layout.
     *
     * @param component - The child component to add.
     * @param constraints - Optional. Layout constraints to pass to the layout manager.
     */
    addComponent(component: Component, constraints?: LayoutConstraints) {
        this.components.push(component);

        this.setLayoutConstraints(component, constraints);

        component.onPreferredSizeChange = () => {
            this.doLayout();

            this.onPreferredSizeChange?.();
        };

        let element = this.getElement();
        if (!element) {
            return;
        }

        let compElement = component.getElement(true);
        element.appendChild(compElement);
        this.doLayout();
    }

    /**
     * Removes a child component by instance or index, detaches its element, and triggers layout.
     *
     * @param component - The Component instance to remove, or a Number index into the children array.
     *
     * @returns The layout constraints that were registered for the removed component, or undefined.
     */
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

        component.onPreferredSizeChange = null;
        component.removeElement();
        this.doLayout();

        return constraints;
    }

    /**
     * Removes all child components and their DOM elements without triggering layout.
     */
    removeAllComponents() {
        for (let idx in this.components) {
            let component = this.components[idx];
            component.onPreferredSizeChange = null;
            component.removeElement();
        }

        this.components = [];
    }

    /**
     * Sorts the children array in place using the given comparator function.
     *
     * @param comparator - Optional. A comparator function that receives two Components and returns a number.
     */
    sortComponents(comparator: Comparator<Component, Component> | undefined) {
        this.components.sort(comparator);
    }

    /**
     * Returns the array of child components.
     *
     * @returns The live array of child Component instances.
     */
    getComponents() {
        return this.components;
    }

    /**
     * Returns the layout constraints for a child component from the layout manager.
     *
     * @param component - The child component whose constraints to retrieve.
     *
     * @returns The LayoutConstraints for the component, or undefined if none are set.
     */
    getLayoutConstraints(component: Component) {
        if (!this.layoutManager) {
            console.warn("Unable to get layout constraints, no layout manager specified.");
            return;
        }

        return this.layoutManager.getLayoutConstraints(component);
    }

    /**
     * Registers layout constraints for a child component with the layout manager.
     *
     * @param component - The child component to constrain.
     * @param constraints - Optional. The layout constraints to apply.
     */
    setLayoutConstraints(component: Component, constraints?: LayoutConstraints) {
        if (!this.layoutManager) {
            console.warn("Unable to set layout constraints, no layout manager specified.");
            return;
        }

        return this.layoutManager.setLayoutConstraints(component, constraints);
    }

    /**
     * Removes and returns the layout constraints for a child component.
     *
     * @param component - The child component whose constraints to remove.
     *
     * @returns The removed LayoutConstraints, or null if no layout manager is set.
     */
    delLayoutConstraints(component: Component) {
        if (!this.layoutManager) {
            return null;
        }

        return this.layoutManager.delLayoutConstraints(component);
    }

    /**
     * Returns the layout manager currently attached to this component.
     *
     * @returns The current LayoutManager instance.
     */
    getLayoutManager() {
        return this.layoutManager;
    }

    /**
     * Detaches the current layout manager, attaches the new one, and stores the class name as an attribute.
     *
     * @param layoutManager - The new LayoutManager to use for this component.
     */
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

    /**
     * Returns true if layout has been paused for this component.
     *
     * @returns True if layout passes are currently suppressed.
     */
    isLayoutPaused() {
        return this.layoutPaused;
    }

    /**
     * Suspends automatic layout passes until resumeLayout is called.
     */
    pauseLayout() {
        this.layoutPaused = true;
    }

    /**
     * Resumes layout and immediately triggers a doLayout pass.
     */
    resumeLayout() {
        this.layoutPaused = false;
        this.doLayout();
    }

    /**
     * Calls doLayout on each direct child component.
     */
    doChildrenComponentLayouts() {
        let components = this.getComponents();

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            component.doLayout();
        }
    }

    /**
     * Delegates layout to the layout manager unless layout is currently paused.
     *
     * @remarks Throws an Error if no layout manager has been set.
     */
    doLayout() {
        if (this.isLayoutPaused()) {
            return;
        }

        if (!this.layoutManager) {
            throw new Error("Unable to do layout, no layout manager specified.");
        }

        this.layoutManager.doLayout();
    }

    /**
     * Sets the element ID, adds the class name, mirrors attributes, applies style, and appends child elements.
     *
     * @param element - Optional. The element to initialise. Falls back to getElement() if omitted.
     *
     * @remarks Throws an Error if no element is available (i.e. render has not been called).
     */
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

    /**
     * Creates the DOM element from the tag name and initializes it via init().
     *
     * @returns The newly created and initialised HTMLElement.
     */
    protected render() {
        let element = document.createElement(this.tag);

        this.init(element);

        return element;
    }
}
