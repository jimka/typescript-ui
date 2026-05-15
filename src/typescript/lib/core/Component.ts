// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "~/layout/LayoutManager.js";
import { Absolute } from "~/layout/Absolute.js";
import { Border, BorderOptions } from "~/primitive/Border.js";
import { Size } from "~/primitive/Size.js";
import { Insets } from "~/primitive/Insets.js";
import { BaseObject } from "~/core/BaseObject.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Type } from "~/core/Type.js";
import { Util } from "~/core/Util.js";
import { CSS } from "~/core/CSS.js";
import { Position } from "~/primitive/Position.js";
import { Aria } from "~/core/Aria.js";
import { callable } from "~/core/Callable.js";

//import { FastDom } from "~/FastDom.js";

/**
 * Generic two-argument comparator returning a sort-order number.
 *
 * @category Core
 */
export interface Comparator<V, U> {
    (a: V, b: U): number;
}

/**
 * Map of CSS property names to string values (or `null` to clear). Used by
 * `Component.setElementCSSRules` for bulk style updates.
 *
 * @category Core
 */
export interface Style {
    [key: string]: string | null
}

/**
 * Width of a component's outer perimeter on each side, in pixels.
 *
 * Returned by {@link Component.getPerimiterSize} — the sum of border width and
 * padding for each edge.
 *
 * @category Core
 */
export interface PerimeterSize {
    top: number,
    right: number,
    bottom: number,
    left: number
}

/**
 * A child component paired with optional layout constraints, as accepted by
 * {@link Component.addComponents}.
 *
 * @category Core
 */
export interface ConstrainedComponent {
    component:    Component;
    constraints?: LayoutConstraints;
}

/**
 * Construction-time options for {@link Component}.
 *
 * Every field is optional and maps to an existing setter on `Component`. Pass
 * an `options` object as the trailing constructor argument to configure a
 * component declaratively instead of issuing chained setter calls.
 *
 * @category Core
 */
export interface ComponentOptions {
    tag?:             string;
    visible?:         boolean;
    displayed?:       boolean;
    zIndex?:          number;
    insets?:          Insets;
    padding?:         Insets;
    backgroundColor?: string | null;
    backgroundImage?: string | null;
    foregroundColor?: string | null;
    colorScheme?:     string;
    border?:          BorderOptions | string;
    borderRadius?:    string | null;
    shadow?:          string | null;
    outline?:         string | null;
    cursor?:          string;
    preferredSize?:   Size;
    minSize?:         Size;
    maxSize?:         Size;
    transform?:       string | null;
    opacity?:         number | null;
    position?:        Position;
    overflow?:        string;
    pointerEvents?:   string;
    layoutManager?:   LayoutManager;
    id?:              string;
    attributes?:      Record<string, string>;
    components?:      Array<Component | ConstrainedComponent>;
}

// Module-level state for the rAF-coalesced layout queue. Setters and event handlers call
// `scheduleLayout()` instead of `doLayout()`; the queue flushes once per animation frame and
// prunes any component whose ancestor is also dirty (the ancestor's layout will recurse into
// it). `flushLayout()` provides a synchronous escape hatch for callers that need a layout
// commit before reading layout-derived state.
let pendingLayouts: Set<Component> = new Set();
let rafHandle: number | null = null;

function flushPendingLayouts() {
    rafHandle = null;

    if (pendingLayouts.size === 0) {
        return;
    }

    // Snapshot and clear so re-entrant scheduleLayout calls (from doLayout side effects)
    // queue into the next frame instead of mutating during iteration.
    const dirty = Array.from(pendingLayouts);
    pendingLayouts.clear();

    for (const c of dirty) {
        let hasDirtyAncestor = false;
        let p = c.getParentComponent();
        while (p) {
            if (dirty.indexOf(p) !== -1) {
                hasDirtyAncestor = true;
                break;
            }
            p = p.getParentComponent();
        }

        if (!hasDirtyAncestor) {
            c.doLayout();
        }
    }
}

/**
 * Base class for all UI components in the framework.
 *
 * Manages the component's DOM element lifecycle, CSS style rule, layout manager,
 * child component tree, and all visual properties (size, position, color, border, etc.).
 * Subclasses override `render()` and `init()` to produce specialised elements.
 *
 * Components are positioned absolutely. Sizes are explicit (preferred / min / max);
 * positions are computed by the parent's {@link LayoutManager} on each `doLayout()` pass.
 * See the Mental model guide on the documentation site for the architectural overview.
 *
 * @category Core
 */
class Component extends BaseObject {

    private layoutManager: LayoutManager;
    private components: Array<Component>;

    private element              : HTMLElement | undefined;
    private tag                  : string                  = "div";
    private attributes           : Map<String, String>;
    private boxSizing            : string | null;
    private position             : Position                = Position.ABSOLUTE;
    private cursor               : string | null           = "default";

    // Geometry: NaN sentinels mean "never assigned", so equality guards on
    // setX/setY/setWidth/setHeight short-circuit only AFTER a real write —
    // the first call always reaches the DOM even when its target value is 0.
    private left                 : number                  = NaN;
    private top                  : number                  = NaN;
    private width                : number                  = NaN;
    private height               : number                  = NaN;
    private translateX           : number                  = 0;
    private translateY           : number                  = 0;
    private visible              : Boolean | null          = null;
    private insets               : Insets                  = new Insets(0, 0, 0, 0);
    private padding              : Insets | null           = new Insets(0, 0, 0, 0);
    private foregroundColor      : string | null           = null;
    private backgroundColor      : string | null           = null;
    private backgroundImage      : string | null           = null;
    private preferredSize        : Size | null             = null;
    private onPreferredSizeChange: (() => void) | null     = null;
    private minSize              : Size | null             = { width: 0, height: 0 };
    private maxSize              : Size                    = { width: Number.MAX_VALUE, height: Number.MAX_VALUE };
    private overflow             : string | null           = "hidden";
    private overflowX            : string | null           = null;
    private overflowY            : string | null           = null;
    private contain              : string | null           = null;
    private animation            : string | null           = null;
    private disabledAttribute    : boolean                 = false;
    private border               : Border | null           = null;
    private borderCSS            : string | null           = null;
    private borderRadius         : string | null           = null;
    private shadow               : string | null           = null;
    private pointerEvents        : string | null           = null;
    private zIndex               : number | null           = 0;
    private displayed            : Boolean | null          = true;
    private autoCommitStyle      : boolean                 = true;
    private layoutPaused         : boolean                 = false;
    private _aria                : Aria | null             = null;
    private colorScheme          : string | null           = null;
    private whiteSpace           : string | null;
    private display              : string;
    private userSelect           : string | null;
    private verticalAlign        : string | null;
    private cssRule              : CSSStyleRule;
    private dirtyStyle           : Style = {};
    private dirtyCSSRule         : Style = {};

    // Tracks the single parent this component belongs to. Exposed read-only via
    // getParentComponent() for structural queries (e.g. FieldDecorator insertion).
    // Do NOT use this reference to propagate information upward from child to parent —
    // that direction of communication creates tight coupling and circular dependencies.
    // Parent-to-child communication (layout, sizing) is the only intended flow.
    private _parent              : Component | null = null;

    constructor(options?: ComponentOptions) {
        super();

        // Structural setup that doesn't map to ComponentOptions.
        this.cssRule       = CSS.createComponentRule(this.getId()) as CSSStyleRule;
        this.layoutManager = new Absolute();
        this.components    = [];
        this.attributes    = new Map<String, String>();

        // Constants without ComponentOptions counterpart.
        this.boxSizing     = "border-box";
        this.display       = "block";
        this.whiteSpace    = "nowrap";
        this.userSelect    = "none";
        this.verticalAlign = "baseline";

        // `tag` has no setter — apply the option directly here. Subclasses
        // commonly forward this from `super({ tag: "..." })`.
        if (options?.tag !== undefined) {
            this.tag = options.tag;
        }

        // Dispatch the rest of the options at the leaf only. Subclass
        // constructors call `applyOptions(options)` themselves with their
        // full bag once their internal child components are built.
        if (this.constructor === Component && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link ComponentOptions} bag to this component by dispatching
     * each present field to its corresponding setter.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Defaults live in field initializers, so this method only runs
     * setters for fields the caller explicitly specified — cssRule writes,
     * attribute-map updates, and attach chains fire once at the leaf rather
     * than being re-run for every super() hop. Subclass overrides typically
     * call `super.applyOptions(options)` first so inherited fields are
     * applied before subclass-specific ones.
     */
    protected applyOptions(options: ComponentOptions): this {
        if (options.id              !== undefined) this.setId(options.id);
        if (options.layoutManager   !== undefined) this.setLayoutManager(options.layoutManager);
        if (options.visible         !== undefined) this.setVisible(options.visible);
        if (options.displayed       !== undefined) this.setDisplayed(options.displayed);
        if (options.zIndex          !== undefined) this.setZIndex(options.zIndex);
        if (options.insets          !== undefined) this.setInsets(options.insets);
        if (options.padding         !== undefined) this.setPadding(options.padding);
        if (options.backgroundColor !== undefined) this.setBackgroundColor(options.backgroundColor);
        if (options.backgroundImage !== undefined) this.setBackgroundImage(options.backgroundImage);
        if (options.foregroundColor !== undefined) this.setForegroundColor(options.foregroundColor);
        if (options.colorScheme     !== undefined) this.setColorScheme(options.colorScheme);
        if (options.border          !== undefined) this.setBorder(options.border);
        if (options.borderRadius    !== undefined) this.setBorderRadius(options.borderRadius);
        if (options.shadow          !== undefined) this.setShadow(options.shadow);
        if (options.outline         !== undefined) this.setOutline(options.outline);
        if (options.cursor          !== undefined) this.setCursor(options.cursor);
        if (options.preferredSize   !== undefined) this.setPreferredSize(options.preferredSize.width, options.preferredSize.height);
        if (options.minSize         !== undefined) this.setMinSize(options.minSize.width, options.minSize.height);
        if (options.maxSize         !== undefined) this.setMaxSize(options.maxSize.width, options.maxSize.height);
        if (options.transform       !== undefined) this.setTransform(options.transform);
        if (options.opacity         !== undefined) this.setOpacity(options.opacity);
        if (options.position        !== undefined) this.setPosition(options.position);
        if (options.overflow        !== undefined) this.setOverflow(options.overflow);
        if (options.pointerEvents   !== undefined) this.setPointerEvents(options.pointerEvents);

        if (options.attributes !== undefined) {
            for (const key of Object.keys(options.attributes)) {
                this.setAttribute(key, options.attributes[key]);
            }
        }

        if (options.components !== undefined) this.addComponents(options.components);

        return this;
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
    getTag(): string {
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
    removeElement(): this {
        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.remove();

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setElementAttribute(key: string, value: Object | null | undefined): this {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM. Attribute '" + key + "' will not be set.");
            return this;
        }

        if (value) {
            element.setAttribute(key, String(value));
        } else {
            this.removeElementAttribute(key);
        }

        return this;
    }

    /**
     * Removes an attribute from the DOM element.
     *
     * @param key - The attribute name to remove.
     *
     * @returns This component, for method chaining.
     */
    removeElementAttribute(key: string): this {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM. Attribute '" + key + "' will not be removed.");
            return this;
        }

        element.removeAttribute(key);

        return this;
    }

    /**
     * Queues a single inline style property for commit to the DOM element.
     *
     * @param key - The CSS property name (camelCase).
     * @param value - The value to set, or null to remove the property.
     *
     * @remarks Immediately flushes to the DOM unless autoCommitStyle is false.
     */
    setElementStyle(key: string, value: Object | null): this {
        this.dirtyStyle[key] = value ? String(value) : null;

        if (this.autoCommitStyle) {
            this.commitElementStyle();
        }

        return this;
    }

    /**
     * Queues multiple inline style properties for commit to the DOM element.
     *
     * @param values - An object whose keys are camelCase CSS property names and values are strings or null.
     *
     * @remarks Immediately flushes to the DOM unless autoCommitStyle is false.
     */
    setElementStyles(values: Style): this {
        Object.assign(this.dirtyStyle, values);

        if (this.autoCommitStyle) {
            this.commitElementStyle();
        }

        return this;
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
    setAutoCommitStyle(value: boolean): this {
        this.autoCommitStyle = value;

        if (value) {
            this.commitElementStyle();
            this.commitCSSRule();
        }

        return this;
    }

    /**
     * Flushes all queued inline style changes to the DOM element and clears the dirty map.
     */
    commitElementStyle(): this {
        var me = this;
        let element = me.getElement();

        if (!element) {
            return this;
        }

        Object.assign(element.style, me.dirtyStyle);

        me.dirtyStyle = {};
        
        return this;
    }

    /**
     * Queues multiple CSS rule properties for commit to the component's CSS rule.
     *
     * @param values - An object whose keys are camelCase CSS property names and values are strings or null.
     *
     * @remarks Immediately flushes to the CSS rule unless autoCommitStyle is false.
     */
    setElementCSSRules(values: Style): this {
        Object.assign(this.dirtyCSSRule, values);

        if (this.autoCommitStyle) {
            this.commitCSSRule();
        }

        return this;
    }

    /**
     * Queues a single CSS rule property for commit to the component's CSS rule.
     *
     * @param key - The CSS property name (camelCase).
     * @param value - The value to set, or null to remove the property.
     *
     * @remarks Immediately flushes to the CSS rule unless autoCommitStyle is false.
     */
    setElementCSSRule(key: string, value: Object | null): this {
        this.dirtyCSSRule[key] = value ? String(value) : null;

        if (this.autoCommitStyle) {
            this.commitCSSRule();
        }

        return this;
    }

    /**
     * Flushes all queued CSS rule changes to the component's CSS rule and clears the dirty map.
     */
    commitCSSRule(): this {
        var me = this;

        Object.assign(me.cssRule.style, me.dirtyCSSRule);

        me.dirtyCSSRule = {};
        
        return this;
    }

    /**
     * Sets the component ID and updates the DOM element's id attribute if the element exists.
     *
     * @param id - The new unique identifier for this component.
     */
    setId(id: string): this {
        super.setId(id);

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.id = id;

        return this;
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
    setAttribute(key: string, value: string): this {
        if (value === null) {
            this.delAttribute(key);

            return this;
        }

        this.attributes.set(key, value);
        this.setElementAttribute(key, value);

        return this;
    }

    /**
     * Removes a component-level attribute from both the internal map and the DOM element.
     *
     * @param key - The attribute name to remove.
     */
    delAttribute(key: string): this {
        this.attributes.delete(key);
        this.removeElementAttribute(key);

        return this;
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
    setVisible(value: Boolean): this {
        if (Type.isBoolean(value)) {
            this.visible = value;
        } else if (!value) {
            this.visible = null;
        } else {
            throw new Error("Argument is not a boolean.");
        }

        let element = this.getElement();
        if (!element) {
            return this;
        }

        let ruleValue;
        if (this.visible != null) {
            ruleValue = this.visible ? "inherit" : "hidden";
        } else {
            ruleValue = "inherit";
        }

        this.setElementCSSRule("visibility", ruleValue);

        return this;
    }

    /**
     * Sets the CSS z-index of the component.
     *
     * @param value - The z-index value.
     */
    setZIndex(value: number): this {
        if (this.zIndex === value) {
            return this;
        }

        this.zIndex = value;
        this.setElementStyle("zIndex", this.zIndex);

        return this;
    }

    /**
     * Returns the {@link Aria} helper for this component, creating it lazily on first access.
     *
     * @returns The ARIA helper instance.
     */
    getAria(): Aria {
        if (!this._aria) {
            this._aria = new Aria(this);
        }

        return this._aria;
    }

    /**
     * Shows or hides the component using CSS display; hidden components take no space.
     *
     * @param value - True to show the component, false to set display to "none".
     *
     * @returns This component, for method chaining.
     */
    setDisplayed(value: boolean): this {
        const v = !!value;
        if (this.displayed === v && this.getElement()) {
            return this;
        }

        this.displayed = v;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.style.display = this.displayed ? this.display : "none";

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setInsets(insets: Insets | null): this {
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

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setPadding(padding: Insets | null): this {
        if (this.padding === padding ||
            (this.padding && padding &&
             this.padding.getTop()    === padding.getTop()    &&
             this.padding.getRight()  === padding.getRight()  &&
             this.padding.getBottom() === padding.getBottom() &&
             this.padding.getLeft()   === padding.getLeft())) {
            return this;
        }

        this.padding = padding;
        this.cssRule.style.padding = padding ? padding.render() as string : "0px 0px 0px 0px";

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setBackgroundColor(backgroundColor: string | null): this {
        if (this.backgroundColor === backgroundColor) {
            return this;
        }

        this.backgroundColor = backgroundColor;

        if (backgroundColor) {
            this.cssRule.style.setProperty('background-color', backgroundColor);
        } else {
            this.cssRule.style.removeProperty('background-color');
        }

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setBackgroundImage(backgroundImage: string | null): this {
        this.backgroundImage = backgroundImage;

        if (backgroundImage) {
            this.cssRule.style.setProperty('background-image', backgroundImage);
        } else {
            this.cssRule.style.removeProperty('background-image');
        }

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setForegroundColor(foregroundColor: string | null): this {
        if (this.foregroundColor === foregroundColor) {
            return this;
        }

        this.foregroundColor = foregroundColor;

        if (foregroundColor) {
            this.cssRule.style.setProperty('color', foregroundColor);
        } else {
            this.cssRule.style.removeProperty('color');
        }

        return this;
    }

    getColorScheme() {
        return this.colorScheme;
    }

    /**
     * @returns This component, for method chaining.
     */
    setColorScheme(colorScheme: string): this {
        this.colorScheme = colorScheme;

        this.cssRule.style.setProperty('color-scheme', colorScheme);

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setBorder(options?: BorderOptions | string): this {
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

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setCursor(cursor: string): this {
        if (this.cursor === cursor) {
            return this;
        }
        this.cursor = cursor;
        this.setElementStyle("cursor", cursor);

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setBorderRadius(borderRadius: string | null = null): this {
        if (this.borderRadius === borderRadius) {
            return this;
        }
        this.borderRadius = borderRadius;
        this.setElementStyle("borderRadius", this.borderRadius);

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setShadow(shadow: string | null): this {
        this.shadow = shadow;

        this.cssRule.style.setProperty('box-shadow', this.shadow || 'none');

        return this;
    }

    /**
     * Sets the CSS outline on the element; null removes the property.
     *
     * @param outline - A CSS outline value (e.g. "none", "2px solid blue"), or null to inherit.
     *
     * @returns This component, for method chaining.
     */
    setOutline(outline: string | null): this {
        if (outline !== null) {
            this.cssRule.style.setProperty('outline', outline);
        } else {
            this.cssRule.style.removeProperty('outline');
        }

        return this;
    }

    /**
     * Sets the CSS appearance on the element; null removes the property.
     *
     * @param value - A CSS appearance value (e.g. "none", "auto"), or null to remove.
     *
     * @returns This component, for method chaining.
     */
    setAppearance(value: string | null): this {
        if (value !== null) {
            this.cssRule.style.setProperty('-webkit-appearance', value);
            this.cssRule.style.setProperty('appearance', value);
        } else {
            this.cssRule.style.removeProperty('-webkit-appearance');
            this.cssRule.style.removeProperty('appearance');
        }

        return this;
    }

    /**
     * Sets the CSS border-image shorthand on the element; null removes the property.
     *
     * @param value - A CSS border-image value (e.g. "none"), or null to remove.
     *
     * @returns This component, for method chaining.
     */
    setBorderImage(value: string | null): this {
        if (value !== null) {
            this.cssRule.style.setProperty('border-image', value);
        } else {
            this.cssRule.style.removeProperty('border-image');
        }

        return this;
    }

    /**
     * Sets the CSS transform on the element; null removes the property.
     *
     * @param value - A CSS transform value (e.g. "translateY(-1px)"), or null to remove.
     *
     * @returns This component, for method chaining.
     */
    setTransform(value: string | null): this {
        if (value !== null) {
            this.cssRule.style.setProperty('transform', value);
        } else {
            this.cssRule.style.removeProperty('transform');
        }

        return this;
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
    getPreferredSize(): Size | null {
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
     *
     * @returns This component, for method chaining.
     */
    setPreferredSize(width: number, height: number): this {
        const prev = this.preferredSize;
        if (prev && prev.width === width && prev.height === height) {
            return this;
        }

        this.preferredSize = { width, height };
        this.setAttribute("preferredSize", this.preferredSize.width + " " + this.preferredSize.height);
        this.onPreferredSizeChange?.();

        return this;
    }

    /**
     * Returns the effective minimum size: the larger of the component and layout manager minimums.
     *
     * @returns A Size object whose width and height are the element-wise maximums of the component and layout manager minimums.
     */
    getMinSize(): Size | null {
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
     *
     * @returns This component, for method chaining.
     */
    setMinSize(width: number, height: number): this {
        if (this.minSize && this.minSize.width === width && this.minSize.height === height) {
            return this;
        }

        this.minSize = {
            width: width,
            height: height
        };

        this.cssRule.style.minWidth = this.minSize.width + "px";
        this.cssRule.style.minHeight = this.minSize.height + "px";

        return this;
    }

    /**
     * Returns the effective maximum size: the larger of the component and layout manager maximums.
     *
     * @returns A Size object whose width and height are the element-wise maximums of the component and layout manager maximums.
     */
    getMaxSize(): Size | null {
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
     *
     * @returns This component, for method chaining.
     */
    setMaxSize(width: number, height: number): this {
        if (this.maxSize && this.maxSize.width === width && this.maxSize.height === height) {
            return this;
        }

        this.maxSize = {
            width: width,
            height: height
        };

        this.cssRule.style.maxWidth = this.maxSize.width === Number.MAX_VALUE ? "none" : this.maxSize.width + "px";
        this.cssRule.style.maxHeight = this.maxSize.height === Number.MAX_VALUE ? "none" : this.maxSize.height + "px";

        this.setAttribute("maxSize", this.maxSize.width + " " + this.maxSize.height);

        return this;
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

    /**
     * Returns the offset, in pixels, from the top of this component to its visual baseline.
     *
     * @returns The baseline offset in pixels, or `null` when this component has no
     * intrinsic baseline (e.g. graphical or non-text components).
     *
     * @remarks The default implementation returns `null`. Subclasses with a
     * meaningful baseline override this method, typically composing an inner
     * baseline with the component's own chrome via `wrapInnerBaseline`. Used by
     * horizontal layouts to align children of mixed heights so their text
     * baselines coincide. Components that return `null` are treated as if their
     * bottom edge were the baseline (CSS replaced-element behaviour).
     */
    getBaseline(): number | null {
        return null;
    }

    /**
     * Wraps a chrome-relative inner baseline with this component's outer chrome.
     *
     * @param inner - The baseline measured from the inner content top (inside
     * border, padding, and framework insets), or `null` when the component has
     * no meaningful baseline.
     * @returns The visual baseline measured from this component's outer top,
     * or `null` when `inner` is `null`.
     *
     * @remarks Adds `insets.top + border.top + padding.top` to `inner`. Use
     * when implementing `getBaseline()` on a composite component (delegating
     * to a child) or a CSS-rendered leaf (delegating to
     * `Util.measureInputBaseline()`). Centralises the chrome arithmetic that
     * would otherwise be repeated in every override.
     */
    protected wrapInnerBaseline(inner: number | null): number | null {
        if (inner === null) {
            return null;
        }

        const padding    = this.getPadding();
        const paddingTop = padding ? padding.getTop() : 0;

        return this.getInsets().getTop()
             + this.getBorderSize().top
             + paddingTop
             + inner;
    }

    getVerticalAlign() {
        return this.verticalAlign
    }

    /**
     * @returns This component, for method chaining.
     */
    setVerticalAlign(align: string): this {
        this.verticalAlign = align;

        this.setElementCSSRule("verticalAlign", align);

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setSize(size: Size): this {
        this.width = size.width;
        this.height = size.height;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementStyles({
            "width": size.width + "px",
            "height": size.height + "px"
        });

        this.scheduleLayout();

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setWidth(width: number): this {
        if (this.width === width) {
            return this;
        }

        this.width = width;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementStyle("width", this.width + "px");

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setHeight(height: number): this {
        if (this.height === height) {
            return this;
        }

        this.height = height;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementStyle("height", this.height + "px");

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setX(x: number): this {
        if (this.left === x) {
            return this;
        }

        this.left = x;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementStyle("left", this.left + "px");

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setY(y: number): this {
        if (this.top === y) {
            return this;
        }

        this.top = y;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementStyle("top", this.top + "px");

        return this;
    }

    /**
     * Returns the cached translate-X component of the element's `transform` (pixels).
     *
     * @returns The translate-X value last passed to setTranslate, or 0.
     */
    getTranslateX() {
        return this.translateX;
    }

    /**
     * Returns the cached translate-Y component of the element's `transform` (pixels).
     *
     * @returns The translate-Y value last passed to setTranslate, or 0.
     */
    getTranslateY() {
        return this.translateY;
    }

    /**
     * Writes the element's `transform` to translate3d(x, y, 0). This positions on the
     * compositor without triggering layout/paint, complementing setX/setY (left/top).
     * Visual position of the element is `left + translateX, top + translateY`.
     *
     * @param x - Translate-X in pixels.
     * @param y - Translate-Y in pixels.
     *
     * @returns This component, for method chaining.
     */
    setTranslate(x: number, y: number): this {
        if (this.translateX === x && this.translateY === y && this.getElement()) {
            return this;
        }

        this.translateX = x;
        this.translateY = y;

        if (x === 0 && y === 0) {
            this.setElementStyle("transform", null);
        } else {
            this.setElementStyle("transform", "translate3d(" + x + "px," + y + "px,0)");
        }

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setPosition(position: Position): this {
        this.position = position;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementCSSRule("position", position);

        return this;
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
     *
     * @returns This component, for method chaining.
     */
    setOverflow(overflow: string): this {
        this.overflow = overflow;

        this.cssRule.style.overflow = overflow;

        return this;
    }

    /**
     * Returns the CSS overflow-x value, or null if not set.
     *
     * @returns The CSS overflow-x string, or null.
     */
    getOverflowX(): string | null {
        return this.overflowX;
    }

    /**
     * Sets the CSS overflow-x property on the component's CSS rule.
     *
     * @param value - A CSS overflow value (e.g. "hidden", "auto", "visible").
     *
     * @returns This component, for method chaining.
     */
    setOverflowX(value: string): this {
        if (this.overflowX === value) {
            return this;
        }

        this.overflowX = value;
        this.setElementCSSRule("overflowX", value);

        return this;
    }

    /**
     * Returns the CSS overflow-y value, or null if not set.
     *
     * @returns The CSS overflow-y string, or null.
     */
    getOverflowY(): string | null {
        return this.overflowY;
    }

    /**
     * Sets the CSS overflow-y property on the component's CSS rule.
     *
     * @param value - A CSS overflow value (e.g. "hidden", "auto", "visible").
     *
     * @returns This component, for method chaining.
     */
    setOverflowY(value: string): this {
        if (this.overflowY === value) {
            return this;
        }

        this.overflowY = value;
        this.setElementCSSRule("overflowY", value);

        return this;
    }

    /**
     * Returns the CSS `contain` value, or null if not set.
     *
     * @returns The CSS contain string, or null.
     */
    getContain(): string | null {
        return this.contain;
    }

    /**
     * Sets the CSS `contain` property on the component's CSS rule. Hints the
     * rendering engine that descendants are isolated from external layout/paint.
     *
     * @param value - A CSS contain value (e.g. "layout", "strict", "layout paint").
     *
     * @returns This component, for method chaining.
     */
    setContain(value: string): this {
        if (this.contain === value) {
            return this;
        }

        this.contain = value;
        this.setElementCSSRule("contain", value);

        return this;
    }

    /**
     * Returns the CSS `animation` shorthand value, or null if not set.
     *
     * @returns The CSS animation string, or null.
     */
    getAnimation(): string | null {
        return this.animation;
    }

    /**
     * Sets the CSS `animation` shorthand on the component's CSS rule.
     *
     * @param value - A CSS animation shorthand (e.g. "ts-ui-spin 0.8s linear infinite").
     *
     * @returns This component, for method chaining.
     */
    setAnimation(value: string): this {
        if (this.animation === value) {
            return this;
        }

        this.animation = value;
        this.setElementCSSRule("animation", value);

        return this;
    }

    /**
     * Removes the CSS `animation` property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearAnimation(): this {
        if (this.animation === null) {
            return this;
        }

        this.animation = null;
        this.setElementCSSRule("animation", null);

        return this;
    }

    /**
     * Returns the cached state of the HTML `disabled` attribute on the element.
     *
     * @returns True when the `disabled` attribute is set, false otherwise.
     */
    getDisabledAttribute(): boolean {
        return this.disabledAttribute;
    }

    /**
     * Sets the HTML `disabled` attribute on the underlying element.
     *
     * Distinct from `setEnabled` on input subclasses, which carries semantic +
     * ARIA + visual state. This setter only toggles the HTML attribute.
     *
     * @param value - True to add `disabled`, false to remove it.
     *
     * @returns This component, for method chaining.
     */
    setDisabledAttribute(value: boolean): this {
        if (this.disabledAttribute === value) {
            return this;
        }

        this.disabledAttribute = value;

        if (value) {
            this.setElementAttribute("disabled", "");
        } else {
            this.removeElementAttribute("disabled");
        }

        return this;
    }

    /**
     * Applies an ARIA attribute on this component's element. Used by the
     * {@link Aria} helper.
     *
     * @param name - The full attribute name (e.g. `"aria-label"`, `"role"`, `"tabindex"`).
     * @param value - The string value to set, or null to remove the attribute.
     *
     * @returns This component, for method chaining.
     *
     * @internal Consumers should use {@link Component.getAria} to access typed ARIA setters.
     */
    applyAriaAttribute(name: string, value: string | null): this {
        if (value === null) {
            this.removeElementAttribute(name);
        } else {
            this.setElementAttribute(name, value);
        }

        return this;
    }

    /**
     * Sets the CSS pointer-events property on the element.
     *
     * @param value - A CSS pointer-events value (e.g. "none", "auto").
     *
     * @returns This component, for method chaining.
     */
    setPointerEvents(value: string): this {
        this.pointerEvents = value;

        this.setElementStyle("pointerEvents", value);

        return this;
    }

    /**
     * Sets the CSS opacity property on the element.
     *
     * @param value - A number between `0` (fully transparent) and `1` (fully opaque), or `null` to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setOpacity(value: number | null): this {
        this.setElementStyle("opacity", value === null ? null : String(value));

        return this;
    }

    /**
     * Sets the CSS user-select property on the element.
     *
     * @param value - A CSS user-select value (e.g. "none", "auto", "text").
     *
     * @returns This component, for method chaining.
     */
    setUserSelect(value: string): this {
        this.userSelect = value;

        this.cssRule.style.userSelect = value;

        return this;
    }

    /**
     * Moves browser focus to this component's DOM element.
     *
     * @returns This component, for method chaining.
     */
    focus(): this {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM, unable to focus.");
            return this;
        }

        element.focus();

        return this;
    }

    /**
     * Removes browser focus from this component's DOM element.
     *
     * @returns This component, for method chaining.
     */
    unfocus(): this {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM, unable to focus.");
            return this;
        }

        element.blur();

        return this;
    }

    /**
     * Writes all current style properties to the given element and its associated CSS rule.
     *
     * @param element - The HTMLElement to apply styles to.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Clears all existing inline styles on the element before re-applying, ensuring a clean state.
     */
    applyStyle(element: HTMLElement): this {
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

        // NaN means "never assigned by a setter" — skip the DOM write for those.
        // Any finite value (including 0) MUST be written so the DOM matches the cached field.
        if (!Number.isNaN(this.width)) {
            element.style.width = this.width + "px";
        }

        if (!Number.isNaN(this.top)) {
            element.style.top = this.top + "px";
        }

        if (!Number.isNaN(this.left)) {
            element.style.left = this.left + "px";
        }

        if (!Number.isNaN(this.height)) {
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

        return this;
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
     * Returns the parent component this component was added to, or null if it has no parent.
     *
     * @returns The parent {@link Component}, or null.
     */
    getParentComponent(): Component | null {
        return this._parent;
    }

    /**
     * Adds multiple child components in a single call, with optional per-component layout constraints.
     *
     * Each argument is either a {@link Component} (added with no constraints), a
     * {@link ConstrainedComponent} pair (added with the supplied constraints), or an array of
     * either form (each entry is processed in order). All three forms can be freely mixed in
     * the same call.
     *
     * @param specs - The components to add. Each entry is a bare {@link Component}, a
     *   {@link ConstrainedComponent} pair, or an array of either.
     *
     * @returns This component, for method chaining.
     */
    addComponents(...specs: Array<Component | ConstrainedComponent | Array<Component | ConstrainedComponent>>): this {
        for (const spec of specs) {
            const items = Array.isArray(spec) ? spec : [spec];

            for (const item of items) {
                if (item instanceof Component) {
                    this.addComponent(item);
                } else {
                    this.addComponent(item.component, item.constraints);
                }
            }
        }

        return this;
    }

    /**
     * Adds a child component, appends its element, wires preferred-size change propagation, and triggers layout.
     *
     * @param component - The child component to add.
     * @param constraints - Optional. Layout constraints to pass to the layout manager.
     */
    addComponent(component: Component, constraints?: LayoutConstraints): this {
        if (component._parent !== null) {
            throw new Error(`Component ${component.getId()} already has a parent. Remove it first.`);
        }

        this.components.push(component);

        this.setLayoutConstraints(component, constraints);

        component._parent = this;
        component.onPreferredSizeChange = () => {
            this.scheduleLayout();

            this.onPreferredSizeChange?.();
        };

        let element = this.getElement();
        if (!element) {
            return this;
        }

        let compElement = component.getElement(true);
        element.appendChild(compElement);
        this.scheduleLayout();

        return this;
    }

    /**
     * Inserts a child component at the given index, appends its element at the matching DOM position,
     * wires preferred-size change propagation, and triggers layout.
     *
     * @param component - The child component to insert.
     * @param index - Zero-based insertion index. Values outside `[0, children.length]` are clamped.
     * @param constraints - Optional. Layout constraints to pass to the layout manager.
     *
     * @remarks
     * Use this when child order matters — for example, placing a leading glyph before an existing
     * label without removing and re-appending the label. `addComponent(c, …)` is the append-at-end
     * shortcut for `insertComponent(c, children.length, …)`.
     */
    insertComponent(component: Component, index: number, constraints?: LayoutConstraints): this {
        if (component._parent !== null) {
            throw new Error(`Component ${component.getId()} already has a parent. Remove it first.`);
        }

        const clampedIndex = Math.max(0, Math.min(index, this.components.length));
        this.components.splice(clampedIndex, 0, component);

        this.setLayoutConstraints(component, constraints);

        component._parent = this;
        component.onPreferredSizeChange = () => {
            this.scheduleLayout();

            this.onPreferredSizeChange?.();
        };

        let element = this.getElement();
        if (!element) {
            return this;
        }

        let compElement = component.getElement(true);
        const nextSibling = clampedIndex + 1 < this.components.length
            ? this.components[clampedIndex + 1].getElement()
            : null;
        element.insertBefore(compElement, nextSibling ?? null);
        this.scheduleLayout();

        return this;
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

        component._parent = null;
        component.onPreferredSizeChange = null;
        component.removeElement();
        this.scheduleLayout();

        return constraints;
    }

    /**
     * Removes all child components and their DOM elements without triggering layout.
     *
     * @returns This component, for method chaining.
     */
    removeAllComponents(): this {
        for (let idx in this.components) {
            let component = this.components[idx];
            component._parent = null;
            component.onPreferredSizeChange = null;
            component.removeElement();
        }

        this.components = [];

        return this;
    }

    /**
     * Sorts the children array in place using the given comparator function.
     *
     * @param comparator - Optional. A comparator function that receives two Components and returns a number.
     *
     * @returns This component, for method chaining.
     */
    sortComponents(comparator: Comparator<Component, Component> | undefined): this {
        this.components.sort(comparator);

        return this;
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
    setLayoutManager(layoutManager: LayoutManager): this {
        if (this.layoutManager) {
            this.layoutManager.detach();
        }

        this.layoutManager = layoutManager;

        if (this.layoutManager) {
            this.layoutManager.attach(this);
        }

        this.setAttribute("layout", layoutManager.getClassName());

        return this;
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
    pauseLayout(): this {
        this.layoutPaused = true;

        return this;
    }

    /**
     * Resumes layout and immediately triggers a doLayout pass.
     *
     * @returns This component, for method chaining.
     */
    resumeLayout(): this {
        this.layoutPaused = false;
        this.doLayout();

        return this;
    }

    /**
     * Calls doLayout on each direct child component.
     *
     * @returns This component, for method chaining.
     */
    doChildrenComponentLayouts(): this {
        let components = this.getComponents();

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            component.doLayout();
        }

        return this;
    }

    /**
     * Delegates layout to the layout manager unless layout is currently paused.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Throws an Error if no layout manager has been set.
     */
    doLayout(): this {
        if (this.isLayoutPaused()) {
            return this;
        }

        if (!this.layoutManager) {
            throw new Error("Unable to do layout, no layout manager specified.");
        }

        this.layoutManager.doLayout();

        return this;
    }

    /**
     * Queues a layout pass to run on the next animation frame. Multiple calls within
     * the same frame coalesce into a single doLayout() call; if an ancestor is also
     * scheduled, the ancestor's recursion subsumes this component and its scheduled
     * pass is skipped.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Honors `pauseLayout()`. Callers that need a synchronous layout commit
     * (e.g. before reading getInnerSize) should call `flushLayout()` instead.
     */
    scheduleLayout(): this {
        if (this.isLayoutPaused()) {
            return this;
        }

        pendingLayouts.add(this);

        if (rafHandle === null) {
            rafHandle = requestAnimationFrame(flushPendingLayouts);
        }

        return this;
    }

    /**
     * Forces a synchronous layout pass on this component, removing it from the
     * scheduled-layout queue if it was pending. Use when a layout-derived value must
     * be read before the next animation frame.
     *
     * @returns This component, for method chaining.
     */
    flushLayout(): this {
        pendingLayouts.delete(this);
        this.doLayout();

        return this;
    }

    /**
     * Sets the element ID, adds the class name, mirrors attributes, applies style, and appends child elements.
     *
     * @param element - Optional. The element to initialise. Falls back to getElement() if omitted.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Throws an Error if no element is available (i.e. render has not been called).
     */
    protected init(element?: HTMLElement): this {
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

        this._aria?.applyToElement(element);

        this.applyStyle(element);

        let components = this.getComponents();
        for (let i in components) {
            let component = components[i];
            let compElement = component.getElement(true);

            element.appendChild(compElement);
        }

        return this;
    }

    /**
     * Creates the root DOM element for this component.
     *
     * @remarks Override in subclasses that need a non-HTML namespace (e.g. SVG).
     * The returned element is treated as an `HTMLElement` by the rest of the
     * Component pipeline; non-HTML roots should use the API surface that is
     * common to all Element types (`id`, `classList`, `setAttribute`,
     * `appendChild`, `style`).
     *
     * @returns The newly created root element.
     */
    protected createRootElement(): HTMLElement {
        return document.createElement(this.tag);
    }

    /**
     * Creates the DOM element from the tag name and initializes it via init().
     *
     * @returns The newly created and initialised HTMLElement.
     */
    protected render() {
        let element = this.createRootElement();

        this.init(element);

        return element;
    }
}

const ComponentCallable = callable(Component);
type ComponentCallable = Component;
export {
    Component         as _Component,
    ComponentCallable as Component
};

