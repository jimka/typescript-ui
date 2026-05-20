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
import { StyleRule, InlineStyle } from "~/core/StyleTarget.js";
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
 * Returned by [`Component.getPerimiterSize`](/api/core/classes/Component#getperimitersize) — the sum of border width and
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
 * [`Component.addComponents`](/api/core/classes/Component#addcomponents).
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
    backgroundColor?: string;
    backgroundImage?: string;
    foregroundColor?: string;
    colorScheme?:     string;
    border?:          BorderOptions | string;
    borderRadius?:    string;
    shadow?:          string;
    outline?:         string;
    cursor?:          string;
    preferredSize?:   Size;
    minSize?:         Size;
    maxSize?:         Size;
    transform?:       string;
    willChange?:      string | null;
    opacity?:         number;
    position?:        Position;
    display?:         string;
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
class Component<TOptions extends ComponentOptions = ComponentOptions> extends BaseObject {

    // Structural state that is NOT option-backed — runtime references, render
    // caches, lifecycle flags, and constants. Option-backed values (border,
    // layoutManager, insets, padding, ...) live in `this._options` instead.
    private _components: Array<Component>;

    private _element              : HTMLElement | undefined;
    private _tag                  : string                  = "div";
    private _attributes           : Map<String, String>;
    private _boxSizing            : string | null;

    // Geometry: NaN sentinels mean "never assigned", so equality guards on
    // setX/setY/setWidth/setHeight short-circuit only AFTER a real write —
    // the first call always reaches the DOM even when its target value is 0.
    private _left                 : number                  = NaN;
    private _top                  : number                  = NaN;
    private _width                : number                  = NaN;
    private _height               : number                  = NaN;
    private _translateX           : number                  = 0;
    private _translateY           : number                  = 0;
    private _willChange          : string | null           = null;

    // Derived / runtime-only fields that have no direct ComponentOptions counterpart.
    private _onPreferredSizeChange: (() => void) | null     = null;
    private _overflowX            : string | null           = null;
    private _overflowY            : string | null           = null;
    private _contain              : string | null           = null;
    private _animation            : string | null           = null;
    private _outline              : string | null           = null;
    private _appearance           : string | null           = null;
    private _borderImage          : string | null           = null;
    private _transform            : string | null           = null;
    private _opacity              : number | null           = null;
    private _disabledAttribute    : boolean                 = false;
    private _border               : Border | null           = null;
    private _borderCSS            : string | null           = null;
    private _autoCommitStyle      : boolean                 = true;
    private _layoutPaused         : boolean                 = false;
    private _aria                : Aria | null             = null;
    private _whiteSpace           : string | null;
    private _display              : string;
    private _userSelect           : string | null;
    private _verticalAlign        : string | null;
    // Deferred-write style buffers. `styleRule` lazily materialises the
    // component's per-id `CSSStyleRule` on first `ensure()` call; `inlineStyle`
    // queues `element.style.X = ...` writes until `init()` attaches it.
    private _styleRule            : StyleRule    = new StyleRule(() => CSS.createComponentRule(this.getId()) as CSSStyleRule);
    private _inlineStyle          : InlineStyle  = new InlineStyle();
    // Subclass-owned state rules (e.g. Button's `:active` / `:hover`,
    // ToggleButton's `.selected`) keyed by selector suffix and materialised
    // at first render. Assigned in the constructor body (not via a field
    // initializer) so the map is in place before subclass field initializers
    // run and before the `applyOptions` cascade fires — letting cascade-time
    // setters dedupe through `createStyleRule` regardless of any later slot
    // clobber on the caller side.
    private _deferredStyleRules!  : Map<string, StyleRule>;

    // Tracks the single parent this component belongs to. Exposed read-only via
    // getParentComponent() for structural queries (e.g. FieldDecorator insertion).
    // Do NOT use this reference to propagate information upward from child to parent —
    // that direction of communication creates tight coupling and circular dependencies.
    // Parent-to-child communication (layout, sizing) is the only intended flow.
    private _parent              : Component | null = null;

    // Two bags. `_options` holds values supplied by the caller or written by a
    // setter — i.e. the *explicit* state for this component. `_defaultOptions`
    // holds class-level defaults consulted as a fallback by getters; nothing
    // ever writes into `_defaultOptions` after construction. Splitting the two
    // lets subclass guards of the form `if (this._options.X === undefined)`
    // detect "the caller didn't supply X" without false-firing on defaults
    // that base classes pre-seeded. Both are initialized in the constructor
    // body (not via field initializers) so subclass field initializers can't
    // clobber them. See `plans/options-bag-state-refactor.md` for rationale.
    protected _options!:        TOptions;
    protected _defaultOptions!: TOptions;

    constructor(options?: TOptions) {
        super();

        // Structural setup that doesn't map to ComponentOptions.
        // `styleRule` stays unmaterialised until the element actually needs to
        // render; the dirty-style path queues writes until then. See
        // `ensureCSSRule`.
        this._components         = [];
        this._attributes         = new Map<String, String>();
        this._deferredStyleRules = new Map<string, StyleRule>();

        // Constants without ComponentOptions counterpart.
        this._boxSizing     = "border-box";
        this._display       = "block";
        this._whiteSpace    = "nowrap";
        this._userSelect    = "none";
        this._verticalAlign = "baseline";

        // Class-level defaults — fallback values consulted by getters when the
        // caller (or a setter) hasn't written to `_options`. Subclasses may
        // extend this bag in their own constructors (after `super()`) to add
        // their per-class defaults — the parent default still flows through
        // because subclass writes merge with what was already there.
        this._defaultOptions = {
            layoutManager: new Absolute(),
            position     : Position.ABSOLUTE,
            cursor       : "default",
            insets       : new Insets(0, 0, 0, 0),
            padding      : new Insets(0, 0, 0, 0),
            minSize      : { width: 0, height: 0 },
            maxSize      : { width: Number.MAX_VALUE, height: Number.MAX_VALUE },
            overflow     : "hidden",
            zIndex       : 0,
            displayed    : true,
        } as TOptions;

        // Explicit state — starts empty. Only values the caller passed or that
        // setters wrote ever land here. This is what `if (this._options.X ===
        // undefined)` checks against in subclass constructors.
        this._options = {} as TOptions;

        // `tag` has no setter — apply the option directly here. Subclasses
        // commonly forward this from `super({ tag: "..." })`.
        if (options?.tag !== undefined) {
            this._tag = options.tag;
        }

        // Dispatch the caller-supplied options through virtual `applyOptions`.
        // The leaf-most override runs first and chains back up via
        // `super.applyOptions`, so every level along the chain gets a chance
        // to apply its own option-backed setters. No leaf gate — setters are
        // bag-mutating, so subclass field initializers can't clobber them.
        // `applyOptions` is `!== undefined` gated per-field, so omitting
        // `options` is safe and produces zero setter calls.
        this.applyOptions((options ?? ({} as TOptions)));
    }

    /**
     * Applies a {@link ComponentOptions} bag to this component by dispatching
     * each present field to its corresponding setter.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Option-backed state lives in `this._options`; each setter
     * dispatched here mutates the bag and triggers the necessary DOM /
     * attribute side effects. Subclass overrides typically call
     * `super.applyOptions(options)` first so inherited fields are applied
     * before subclass-specific ones, then dispatch their own option-backed
     * setters.
     */
    protected applyOptions(options: TOptions): this {
        const opts = { ...this._defaultOptions, ...options };

        if (opts.id              !== undefined) this.setId(opts.id);
        if (opts.layoutManager   !== undefined) this.setLayoutManager(opts.layoutManager);
        if (opts.visible         !== undefined) this.setVisible(opts.visible);
        if (opts.displayed       !== undefined) this.setDisplayed(opts.displayed);
        if (opts.zIndex          !== undefined) this.setZIndex(opts.zIndex);
        if (opts.insets          !== undefined) this.setInsets(opts.insets);
        if (opts.padding         !== undefined) this.setPadding(opts.padding);
        if (opts.backgroundColor !== undefined) this.setBackgroundColor(opts.backgroundColor);
        if (opts.backgroundImage !== undefined) this.setBackgroundImage(opts.backgroundImage);
        if (opts.foregroundColor !== undefined) this.setForegroundColor(opts.foregroundColor);
        if (opts.colorScheme     !== undefined) this.setColorScheme(opts.colorScheme);
        if (opts.border          !== undefined) this.setBorder(opts.border);
        if (opts.borderRadius    !== undefined) this.setBorderRadius(opts.borderRadius);
        if (opts.shadow          !== undefined) this.setShadow(opts.shadow);
        if (opts.outline         !== undefined) this.setOutline(opts.outline);
        if (opts.cursor          !== undefined) this.setCursor(opts.cursor);
        if (opts.preferredSize   !== undefined) this.setPreferredSize(opts.preferredSize.width, opts.preferredSize.height);
        if (opts.minSize         !== undefined) this.setMinSize(opts.minSize.width, opts.minSize.height);
        if (opts.maxSize         !== undefined) this.setMaxSize(opts.maxSize.width, opts.maxSize.height);
        if (opts.transform       !== undefined) this.setTransform(opts.transform);
        if (opts.willChange      !== undefined) this.setWillChange(opts.willChange);
        if (opts.opacity         !== undefined) this.setOpacity(opts.opacity);
        if (opts.position        !== undefined) this.setPosition(opts.position);
        if (opts.display         !== undefined) this.setDisplay(opts.display);
        if (opts.overflow        !== undefined) this.setOverflow(opts.overflow);
        if (opts.pointerEvents   !== undefined) this.setPointerEvents(opts.pointerEvents);

        if (opts.attributes !== undefined) {
            for (const key of Object.keys(opts.attributes)) {
                this.setAttribute(key, opts.attributes[key]);
            }
        }

        if (opts.components !== undefined) this.addComponents(opts.components);

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
        return this._tag;
    }

    /**
     * Returns the component's dedicated CSS style rule for applying class-level styles.
     *
     * @returns The CSSStyleRule scoped to this component's ID.
     *
     * @remarks Forces the underlying stylesheet rule to materialize on first
     * access. After {@link ensureCSSRule} runs, any pending writes queued in
     * `styleRule` are flushed onto the live rule so callers can read / mutate
     * it directly.
     */
    protected getCSSRule(): CSSStyleRule {
        return this.ensureCSSRule();
    }

    /**
     * Lazily creates the component's dedicated CSS rule and flushes any
     * dirty-style entries that accumulated before the rule existed.
     *
     * @returns The live `CSSStyleRule` scoped to this component's ID.
     *
     * @remarks Until this is called the component has no stylesheet entry —
     * setters queue into `styleRule` only. Defers the stylesheet insertion
     * (which would force a paint) to the moment the component renders, so
     * detached construction stays JS-only.
     */
    private ensureCSSRule(): CSSStyleRule {
        return this._styleRule.ensure();
    }

    /**
     * Returns the state-specific {@link StyleRule} for the given selector
     * suffix appended to this component's id (e.g. `":active"`,
     * `":hover:not(:active)"`, `".selected"`). The first call for a suffix
     * allocates a new wrapper and registers it for render-time materialisation
     * via {@link applyStyle}; subsequent calls with the same suffix return the
     * same wrapper, even across intervening backing-slot resets — so a lazy
     * getter that loses its cached reference (e.g. to TypeScript class-field
     * init clobber after super returns) still sees the original wrapper.
     *
     * @param selectorSuffix - CSS selector text appended to `#<id>` to form
     *                         the rule's selector. Must be unique per
     *                         component within this component's lifetime.
     *
     * @returns The `StyleRule` wrapper. Owners should cache it on a backing
     *          slot for fast subsequent access; the slot is just a cache —
     *          if it gets cleared, the next call to this method returns the
     *          same wrapper from the deduping map.
     *
     * @remarks Safe to call from a lazy getter on the super-cascade path —
     * `deferredStyleRules` is initialised in Component's constructor body
     * before `applyOptions` fires, so cascade-time setters can allocate
     * through this builder.
     */
    protected createStyleRule(selectorSuffix: string): StyleRule {
        let rule = this._deferredStyleRules.get(selectorSuffix);
        if (!rule) {
            rule = new StyleRule(() => CSS.createComponentRule(this.getId() + selectorSuffix) as CSSStyleRule);
            this._deferredStyleRules.set(selectorSuffix, rule);
        }

        return rule;
    }

    /**
     * Returns the DOM element, querying by ID; creates and renders it if createIfMissing is true.
     *
     * @param createIfMissing - Optional. When true, renders and returns a new element if none exists in the DOM.
     *
     * @returns The component's HTMLElement, or undefined if it does not exist and createIfMissing is false.
     */
    getElement(createIfMissing: boolean = false) {
        if (!this._element) {
            let element = Util.select("#" + this.getId());
            if (!element && createIfMissing) {
                element = this.render();
            }

            this._element = element;
        }

        return this._element;
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
    protected setElementAttribute(key: string, value: Object | null | undefined): this {
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
    protected removeElementAttribute(key: string): this {
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
    protected setElementStyle(key: string, value: Object | null): this {
        const v = value ? String(value) : null;

        if (this._autoCommitStyle) {
            this._inlineStyle.set(key, v);
        } else {
            this._inlineStyle.queue(key, v);
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
    protected setElementStyles(values: Style): this {
        if (this._autoCommitStyle) {
            this._inlineStyle.setMany(values);
        } else {
            this._inlineStyle.queueMany(values);
        }

        return this;
    }

    /**
     * Returns whether style changes are immediately committed to the DOM.
     *
     * @returns True if auto-commit is enabled, false if changes are batched.
     */
    getAutoCommitStyle() {
        return this._autoCommitStyle;
    }

    /**
     * Enables or disables auto-commit; flushing all pending style and CSS rule changes when re-enabled.
     *
     * @param value - True to enable immediate commits; false to batch changes until manually flushed.
     */
    setAutoCommitStyle(value: boolean): this {
        this._autoCommitStyle = value;

        if (value) {
            this.commitElementStyle();
            this.commitCSSRule();
        }

        return this;
    }

    /**
     * Flushes all queued inline style changes to the DOM element and clears the dirty map.
     */
    protected commitElementStyle(): this {
        // `inlineStyle.flush()` is a no-op when the element isn't yet attached
        // — dirty entries stay queued for the next flush after `init()`.
        this._inlineStyle.flush();

        return this;
    }

    /**
     * Queues multiple CSS rule properties for commit to the component's CSS rule.
     *
     * @param values - An object whose keys are camelCase CSS property names and values are strings or null.
     *
     * @remarks Immediately flushes to the CSS rule unless autoCommitStyle is false.
     */
    protected setElementCSSRules(values: Style): this {
        // The rule is created lazily, so writes go through `queue` until the
        // element exists; `commitCSSRule` only flushes once an element is
        // attached, matching the prior `dirtyCSSRule` gating.
        this._styleRule.queueMany(values);

        if (this._autoCommitStyle) {
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
    protected setElementCSSRule(key: string, value: Object | null): this {
        this._styleRule.queue(key, value ? String(value) : null);

        if (this._autoCommitStyle) {
            this.commitCSSRule();
        }

        return this;
    }

    /**
     * Flushes all queued CSS rule changes to the component's CSS rule and clears the dirty map.
     *
     * @remarks Skips the flush entirely when the element has not yet been
     * rendered — the dirty entries stay queued and are picked up by the next
     * {@link ensureCSSRule} call (typically driven by `render()`).
     * Avoids inserting a stylesheet rule for components that are constructed
     * but never attached.
     */
    protected commitCSSRule(): this {
        // Gate on element existence (matches prior `dirtyCSSRule` behaviour):
        // avoids inserting a stylesheet rule for components that are
        // constructed but never attached.
        if (!this.getElement()) {
            return this;
        }

        // Materialise the rule (no-op if already created) and drain the
        // queued writes.
        this._styleRule.ensure();
        this._styleRule.flush();

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
        return this._attributes.get(key);
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

        this._attributes.set(key, value);
        this.setElementAttribute(key, value);

        return this;
    }

    /**
     * Removes a component-level attribute from both the internal map and the DOM element.
     *
     * @param key - The attribute name to remove.
     */
    delAttribute(key: string): this {
        this._attributes.delete(key);
        this.removeElementAttribute(key);

        return this;
    }

    /**
     * Returns the visibility state, or null if inherited from the parent.
     *
     * @returns True if explicitly visible, false if explicitly hidden, null if inheriting from the parent.
     */
    isVisible(): Boolean | null {
        return this._options.visible ?? null;
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
            this._options.visible = value as boolean;
        } else if (!value) {
            this._options.visible = undefined;
        } else {
            throw new Error("Argument is not a boolean.");
        }

        let element = this.getElement();
        if (!element) {
            return this;
        }

        let ruleValue;
        const visible = this._options.visible;
        if (visible != null) {
            ruleValue = visible ? "inherit" : "hidden";
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
        if (this._options.zIndex === value) {
            return this;
        }

        this._options.zIndex = value;
        this.setElementStyle("zIndex", value);

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
        if (this._options.displayed === v && this.getElement()) {
            return this;
        }

        this._options.displayed = v;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.style.display = v ? this._display : "none";

        return this;
    }

    /**
     * Returns the component's insets (internal spacing used by layout managers).
     *
     * @returns The current Insets instance.
     */
    getInsets(): Insets {
        return (this._options.insets ?? this._defaultOptions.insets) as Insets;
    }

    /**
     * Sets the component's insets. Use {@link clearInsets} to reset to zero.
     *
     * @param insets - The new Insets.
     *
     * @returns This component, for method chaining.
     */
    setInsets(insets: Insets): this {
        this._options.insets = insets;
        this.setAttribute("insets", insets.render());

        return this;
    }

    /**
     * Resets the component's insets to zero on all sides.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Companion to {@link setInsets}. Resets to
     * `new Insets(0, 0, 0, 0)` — semantically a "reset to default" rather than
     * a CSS-level clear.
     */
    clearInsets(): this {
        const insets = new Insets(0, 0, 0, 0);
        this._options.insets = insets;
        this.setAttribute("insets", insets.render());

        return this;
    }

    /**
     * Returns the CSS padding insets for this component.
     *
     * @returns The current padding Insets, or null if none are set.
     */
    getPadding(): Insets | null {
        return this._options.padding ?? null;
    }

    /**
     * Sets the CSS padding. Use {@link clearPadding} to reset to `"0px 0px 0px 0px"`.
     *
     * @param padding - The new padding Insets.
     *
     * @returns This component, for method chaining.
     */
    setPadding(padding: Insets): this {
        const current = this._options.padding;
        if (current &&
            current.getTop()    === padding.getTop()    &&
            current.getRight()  === padding.getRight()  &&
            current.getBottom() === padding.getBottom() &&
            current.getLeft()   === padding.getLeft()) {
            return this;
        }

        this._options.padding = padding;
        this.setElementCSSRule("padding", padding.render() as string);

        return this;
    }

    /**
     * Resets the CSS padding to zero on all sides.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Companion to {@link setPadding}. Writes
     * `"0px 0px 0px 0px"` rather than removing the property — preserves the
     * legacy `setPadding(null)` behaviour as a reset, not a CSS-level clear.
     */
    clearPadding(): this {
        this._options.padding = undefined;
        this.setElementCSSRule("padding", "0px 0px 0px 0px");

        return this;
    }

    /**
     * Returns the component's background color, or null if inherited.
     *
     * @returns The CSS color string, or null if none is set.
     */
    getBackgroundColor(): string | null {
        return this._options.backgroundColor ?? null;
    }

    /**
     * Sets the background color CSS property. Use {@link clearBackgroundColor} to inherit.
     *
     * @param backgroundColor - A CSS color string.
     *
     * @returns This component, for method chaining.
     */
    setBackgroundColor(backgroundColor: string): this {
        if (this._options.backgroundColor === backgroundColor) {
            return this;
        }

        this._options.backgroundColor = backgroundColor;
        this.setElementCSSRule("backgroundColor", backgroundColor);

        return this;
    }

    /**
     * Removes the background-color CSS property so the element inherits from its parent.
     *
     * @returns This component, for method chaining.
     */
    clearBackgroundColor(): this {
        if (this._options.backgroundColor === undefined) {
            return this;
        }

        this._options.backgroundColor = undefined;
        this.setElementCSSRule("backgroundColor", null);

        return this;
    }

    /**
     * Returns the background image CSS value, or null if none is set.
     *
     * @returns The CSS background-image string, or null.
     */
    getBackgroundImage(): string | null {
        return this._options.backgroundImage ?? null;
    }

    /**
     * Sets the CSS background-image property. Use {@link clearBackgroundImage} to remove.
     *
     * @param backgroundImage - A CSS background-image string.
     *
     * @returns This component, for method chaining.
     */
    setBackgroundImage(backgroundImage: string): this {
        this._options.backgroundImage = backgroundImage;
        this.setElementCSSRule("backgroundImage", backgroundImage);

        return this;
    }

    /**
     * Removes the background-image CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearBackgroundImage(): this {
        this._options.backgroundImage = undefined;
        this.setElementCSSRule("backgroundImage", null);

        return this;
    }

    /**
     * Returns the foreground (text) color, or null if inherited.
     *
     * @returns The CSS color string, or null if none is set.
     */
    getForegroundColor(): string | null {
        return this._options.foregroundColor ?? null;
    }

    /**
     * Sets the CSS color (text color). Use {@link clearForegroundColor} to inherit.
     *
     * @param foregroundColor - A CSS color string.
     *
     * @returns This component, for method chaining.
     */
    setForegroundColor(foregroundColor: string): this {
        if (this._options.foregroundColor === foregroundColor) {
            return this;
        }

        this._options.foregroundColor = foregroundColor;
        this.setElementCSSRule("color", foregroundColor);

        return this;
    }

    /**
     * Removes the color (foreground) CSS property so the element inherits from its parent.
     *
     * @returns This component, for method chaining.
     */
    clearForegroundColor(): this {
        if (this._options.foregroundColor === undefined) {
            return this;
        }

        this._options.foregroundColor = undefined;
        this.setElementCSSRule("color", null);

        return this;
    }

    getColorScheme(): string | null {
        return this._options.colorScheme ?? null;
    }

    /**
     * @returns This component, for method chaining.
     */
    setColorScheme(colorScheme: string): this {
        this._options.colorScheme = colorScheme;

        this.setElementCSSRule("colorScheme", colorScheme);

        return this;
    }

    /**
     * Removes the color-scheme CSS property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearColorScheme(): this {
        if (this._options.colorScheme === undefined) {
            return this;
        }

        this._options.colorScheme = undefined;
        this.setElementCSSRule("colorScheme", null);

        return this;
    }

    /**
     * Returns the Border instance, or null if no border is set.
     *
     * @returns The current Border object, or null.
     */
    getBorder(): Border | null {
        return this._border;
    }

    /**
     * Clears the component's border by applying an explicit 0-width, none-style,
     * black-colour border on every side. The longhand writes guarantee the cleared
     * state overrides any inherited or class-level border styling.
     *
     * @returns This component, for method chaining.
     */
    clearBorder(): this {
        this._borderCSS = null;
        this._border    = new Border();
        this.setElementCSSRules(this._border.toStyle());

        return this;
    }

    /**
     * Creates and applies a border from options.
     *
     * @param options - Border configuration (style, width, color), or a CSS border shorthand string. Use {@link clearBorder} to clear the border explicitly.
     *
     * @returns This component, for method chaining.
     */
    setBorder(options: BorderOptions | string): this {
        if (typeof options === 'string' && options.trimStart().startsWith('var(')) {
            this._borderCSS = options;
            this.setElementCSSRule("border", options);

            const varName  = options.match(/var\((--[^,)]+)/)?.[1];
            const resolved = varName
                ? getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
                : null;

            this._border = resolved ? Border.fromString(resolved) : null;
        } else if (typeof options === 'string') {
            this._borderCSS = null;
            this._border    = Border.fromString(options);
            this.setElementCSSRules(this._border.toStyle());
        } else {
            this._borderCSS = null;
            this._border    = new Border(options);
            this.setElementCSSRules(this._border.toStyle());
        }

        return this;
    }

    /**
     * Returns the current CSS cursor value.
     *
     * @returns The CSS cursor string, or null if not set.
     */
    getCursor(): string | null {
        return this._options.cursor ?? null;
    }

    /**
     * Sets the CSS cursor style on the element.
     *
     * @param cursor - A CSS cursor value (e.g. "pointer", "text", "default").
     *
     * @returns This component, for method chaining.
     */
    setCursor(cursor: string): this {
        if (this._options.cursor === cursor) {
            return this;
        }
        this._options.cursor = cursor;
        this.setElementStyle("cursor", cursor);

        return this;
    }

    /**
     * Removes the inline cursor style from the element.
     *
     * @returns This component, for method chaining.
     */
    clearCursor(): this {
        if (this._options.cursor === undefined) {
            return this;
        }

        this._options.cursor = undefined;
        this.setElementStyle("cursor", null);

        return this;
    }

    /**
     * Returns the CSS border-radius value, or null if not set.
     *
     * @returns The CSS border-radius string, or null.
     */
    getBorderRadius(): string | null {
        return this._options.borderRadius ?? null;
    }

    /**
     * Sets the CSS border-radius on the element. Use {@link clearBorderRadius} to remove.
     *
     * @param borderRadius - A CSS border-radius string (e.g. "4px").
     *
     * @returns This component, for method chaining.
     */
    setBorderRadius(borderRadius: string): this {
        if (this._options.borderRadius === borderRadius) {
            return this;
        }
        this._options.borderRadius = borderRadius;
        this.setElementStyle("borderRadius", borderRadius);

        return this;
    }

    /**
     * Removes the border-radius CSS property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearBorderRadius(): this {
        if (this._options.borderRadius === undefined) {
            return this;
        }
        this._options.borderRadius = undefined;
        this.setElementStyle("borderRadius", null);

        return this;
    }

    /**
     * Returns the CSS box-shadow value, or null if not set.
     *
     * @returns The CSS box-shadow string, or null.
     */
    getShadow(): string | null {
        return this._options.shadow ?? null;
    }

    /**
     * Sets the CSS box-shadow. Use {@link clearShadow} to set the shadow to `"none"`.
     *
     * @param shadow - A CSS box-shadow string.
     *
     * @returns This component, for method chaining.
     */
    setShadow(shadow: string): this {
        this._options.shadow = shadow;
        this.setElementCSSRule("boxShadow", shadow);

        return this;
    }

    /**
     * Removes the box-shadow by writing `"none"` (preserving the legacy
     * `setShadow(null)` semantic — not a removeProperty).
     *
     * @returns This component, for method chaining.
     */
    clearShadow(): this {
        this._options.shadow = undefined;
        this.setElementCSSRule("boxShadow", "none");

        return this;
    }

    /**
     * Returns the CSS outline value last passed to {@link setOutline}, or `null`
     * if no outline is set.
     *
     * @returns The outline string, or null.
     */
    getOutline(): string | null {
        return this._outline;
    }

    /**
     * Sets the CSS outline on the element. Use {@link clearOutline} to remove.
     *
     * @param outline - A CSS outline value (e.g. "none", "2px solid blue").
     *
     * @returns This component, for method chaining.
     */
    setOutline(outline: string): this {
        this._outline = outline;

        this.setElementCSSRule("outline", outline);

        return this;
    }

    /**
     * Removes the outline CSS property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearOutline(): this {
        this._outline = null;
        this.setElementCSSRule("outline", null);

        return this;
    }

    /**
     * Returns the CSS appearance value last passed to {@link setAppearance}, or
     * `null` if no appearance override is set.
     *
     * @returns The appearance string, or null.
     */
    getAppearance(): string | null {
        return this._appearance;
    }

    /**
     * Sets the CSS appearance on the element. Use {@link clearAppearance} to remove.
     *
     * @param value - A CSS appearance value (e.g. "none", "auto").
     *
     * @returns This component, for method chaining.
     */
    setAppearance(value: string): this {
        this._appearance = value;

        this.setElementCSSRules({
            webkitAppearance: value,
            appearance:       value
        });

        return this;
    }

    /**
     * Removes both the `-webkit-appearance` and `appearance` CSS properties.
     *
     * @returns This component, for method chaining.
     */
    clearAppearance(): this {
        this._appearance = null;
        this.setElementCSSRules({
            webkitAppearance: null,
            appearance:       null
        });

        return this;
    }

    /**
     * Returns the CSS border-image value last passed to {@link setBorderImage},
     * or `null` if no border-image is set.
     *
     * @returns The border-image string, or null.
     */
    getBorderImage(): string | null {
        return this._borderImage;
    }

    /**
     * Sets the CSS border-image shorthand on the element. Use {@link clearBorderImage} to remove.
     *
     * @param value - A CSS border-image value (e.g. "none").
     *
     * @returns This component, for method chaining.
     */
    setBorderImage(value: string): this {
        this._borderImage = value;

        this.setElementCSSRule("borderImage", value);

        return this;
    }

    /**
     * Removes the border-image CSS property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearBorderImage(): this {
        this._borderImage = null;
        this.setElementCSSRule("borderImage", null);

        return this;
    }

    /**
     * Returns the CSS transform value last passed to {@link setTransform}, or
     * `null` if no transform is set.
     *
     * @returns The transform string, or null.
     *
     * @remarks Reflects the value written to the component's CSS rule by
     * {@link setTransform}. {@link setTranslate} writes `transform` as an inline
     * style on a separate surface — its value is **not** reflected here. The
     * two transform surfaces (rule vs. inline) are independent; the cached
     * value here is the rule-side value only.
     */
    getTransform(): string | null {
        return this._transform;
    }

    /**
     * Sets the CSS transform on the element. Use {@link clearTransform} to remove.
     *
     * @param value - A CSS transform value (e.g. "translateY(-1px)").
     *
     * @returns This component, for method chaining.
     */
    setTransform(value: string): this {
        this._transform = value;

        this.setElementCSSRule("transform", value);

        return this;
    }

    /**
     * Removes the transform CSS property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearTransform(): this {
        this._transform = null;
        this.setElementCSSRule("transform", null);

        return this;
    }

    /**
     * Returns the component's current width and height.
     *
     * @returns A Size object with the current width and height in pixels.
     */
    getSize(): Size | null {
        return {
            width: this._width,
            height: this._height
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

        if (this._options.preferredSize) {
            preferredSize = this._options.preferredSize;
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
        const prev = this._options.preferredSize;
        if (prev && prev.width === width && prev.height === height) {
            return this;
        }

        const next: Size = { width, height };
        this._options.preferredSize = next;
        this.setAttribute("preferredSize", next.width + " " + next.height);
        this._onPreferredSizeChange?.();

        return this;
    }

    /**
     * Returns the effective minimum size: the larger of the component and layout manager minimums.
     *
     * @returns A Size object whose width and height are the element-wise maximums of the component and layout manager minimums.
     */
    getMinSize(): Size | null {
        let componentMinSize = (this._options.minSize ?? this._defaultOptions.minSize) ?? null;
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
        const current = this._options.minSize;
        if (current && current.width === width && current.height === height) {
            return this;
        }

        const next: Size = { width, height };
        this._options.minSize = next;

        this.setElementCSSRules({
            minWidth:  next.width  + "px",
            minHeight: next.height + "px"
        });

        return this;
    }

    /**
     * Returns the effective maximum size: the larger of the component and layout manager maximums.
     *
     * @returns A Size object whose width and height are the element-wise maximums of the component and layout manager maximums.
     */
    getMaxSize(): Size | null {
        let componentMaxSize = (this._options.maxSize ?? this._defaultOptions.maxSize) ?? null;
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
        const current = this._options.maxSize;
        if (current && current.width === width && current.height === height) {
            return this;
        }

        const next: Size = { width, height };
        this._options.maxSize = next;

        this.setElementCSSRules({
            maxWidth:  next.width  === Number.MAX_VALUE ? "none" : next.width  + "px",
            maxHeight: next.height === Number.MAX_VALUE ? "none" : next.height + "px"
        });

        this.setAttribute("maxSize", next.width + " " + next.height);

        return this;
    }

    /**
     * Returns the usable inner size: component size minus insets and border widths.
     *
     * @returns The inner Size in pixels, or null if the element is not yet in the DOM.
     */
    getInnerSize(): { width: number, height: number } | null {
        let element = this.getElement();
        if (!element) {
            return null;
        }

        let perimiterSize = this.getPerimiterSize();

        let width = this._width - perimiterSize.left - perimiterSize.right;
        let height = this._height - perimiterSize.top - perimiterSize.bottom;

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

        if (this._border) {
            borderSize.top    = this._border.getTop().getWidth();
            borderSize.right  = this._border.getRight().getWidth();
            borderSize.bottom = this._border.getBottom().getWidth();
            borderSize.left   = this._border.getLeft().getWidth();
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
        return this._verticalAlign
    }

    /**
     * @returns This component, for method chaining.
     */
    setVerticalAlign(align: string): this {
        this._verticalAlign = align;

        this.setElementCSSRule("verticalAlign", align);

        return this;
    }

    /**
     * Removes the vertical-align CSS property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearVerticalAlign(): this {
        if (this._verticalAlign === null) {
            return this;
        }

        this._verticalAlign = null;
        this.setElementCSSRule("verticalAlign", null);

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
        this._width = size.width;
        this._height = size.height;

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
        if (this._width === width) {
            return this;
        }

        this._width = width;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementStyle("width", this._width + "px");

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
        if (this._height === height) {
            return this;
        }

        this._height = height;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementStyle("height", this._height + "px");

        return this;
    }

    /**
     * Returns the component's horizontal position (CSS left) in pixels.
     *
     * @returns The left offset in pixels.
     */
    getX() {
        return this._left;
    }

    /**
     * Sets the CSS left position and updates the DOM element's inline style.
     *
     * @param x - The horizontal offset in pixels.
     *
     * @returns This component, for method chaining.
     */
    setX(x: number): this {
        if (this._left === x) {
            return this;
        }

        this._left = x;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementStyle("left", this._left + "px");

        return this;
    }

    /**
     * Returns the component's vertical position (CSS top) in pixels.
     *
     * @returns The top offset in pixels.
     */
    getY() {
        return this._top;
    }

    /**
     * Sets the CSS top position and updates the DOM element's inline style.
     *
     * @param y - The vertical offset in pixels.
     *
     * @returns This component, for method chaining.
     */
    setY(y: number): this {
        if (this._top === y) {
            return this;
        }

        this._top = y;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementStyle("top", this._top + "px");

        return this;
    }

    /**
     * Returns the cached translate-X component of the element's `transform` (pixels).
     *
     * @returns The translate-X value last passed to setTranslate, or 0.
     */
    getTranslateX() {
        return this._translateX;
    }

    /**
     * Returns the cached translate-Y component of the element's `transform` (pixels).
     *
     * @returns The translate-Y value last passed to setTranslate, or 0.
     */
    getTranslateY() {
        return this._translateY;
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
        if (this._translateX === x && this._translateY === y && this.getElement()) {
            return this;
        }

        this._translateX = x;
        this._translateY = y;

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
    getPosition(): Position {
        return (this._options.position ?? Position.ABSOLUTE) as Position;
    }

    /**
     * Sets the CSS position mode and updates the component's CSS rule.
     *
     * @param position - The CSS position mode to apply (e.g. Position.ABSOLUTE, Position.STATIC).
     *
     * @returns This component, for method chaining.
     */
    setPosition(position: Position): this {
        this._options.position = position;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementCSSRule("position", position);

        return this;
    }

    /**
     * Returns the CSS `display` mode for this component.
     *
     * @returns The current display value (e.g. `"block"`, `"grid"`, `"flex"`).
     */
    getDisplay(): string {
        return this._display;
    }

    /**
     * Sets the CSS `display` mode (e.g. `"grid"`, `"flex"`, `"inline-block"`).
     *
     * Updates the cached display so that {@link setDisplayed} restores the
     * correct mode when toggling visibility, and writes through to the
     * per-component CSS rule.
     *
     * @param value - A valid CSS `display` value.
     *
     * @returns This component, for method chaining.
     */
    setDisplay(value: string): this {
        this._display = value;
        this._options.display = value;

        if (this._options.displayed !== false) {
            this.setElementCSSRule("display", value);
        }

        return this;
    }

    /**
     * Removes the explicit position override from the component's CSS rule.
     * The framework default (`Position.ABSOLUTE`) reported by {@link getPosition}
     * remains in effect.
     *
     * @returns This component, for method chaining.
     */
    clearPosition(): this {
        if (this._options.position === undefined) {
            return this;
        }

        this._options.position = undefined;
        this.setElementCSSRule("position", null);

        return this;
    }

    /**
     * Returns the CSS overflow value when both axes agree, or null otherwise.
     *
     * @returns The shared overflow string, or null if the axes diverge or are unset.
     */
    getOverflow(): string | null {
        return this._overflowX !== null
               && this._overflowX === this._overflowY ? this._overflowX : null;
    }

    /**
     * Sets the CSS overflow property on both axes. Convenience for callers that
     * want the same value on x and y; routes through [`setOverflowX`](/api/core/classes/Component#setoverflowx)
     * and [`setOverflowY`](/api/core/classes/Component#setoverflowy) so the per-axis state stays canonical.
     *
     * @param overflow - A CSS overflow value (e.g. "hidden", "auto", "visible").
     *
     * @returns This component, for method chaining.
     */
    setOverflow(overflow: string): this {
        return this.setOverflowX(overflow)
                   .setOverflowY(overflow);
    }

    /**
     * Clears both per-axis overflow values.
     *
     * @returns This component, for method chaining.
     */
    clearOverflow(): this {
        return this.clearOverflowX().clearOverflowY();
    }

    /**
     * Returns the CSS overflow-x value, or null if not set.
     *
     * @returns The CSS overflow-x string, or null.
     */
    getOverflowX(): string | null {
        return this._overflowX;
    }

    /**
     * Sets the CSS overflow-x property on the component's CSS rule.
     *
     * @param value - A CSS overflow value (e.g. "hidden", "auto", "visible").
     *
     * @returns This component, for method chaining.
     */
    setOverflowX(value: string): this {
        if (this._overflowX === value) {
            return this;
        }

        this._overflowX = value;
        this.setElementCSSRule("overflowX", value);

        return this;
    }

    /**
     * Removes the overflow-x CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearOverflowX(): this {
        if (this._overflowX === null) {
            return this;
        }

        this._overflowX = null;
        this.setElementCSSRule("overflowX", null);

        return this;
    }

    /**
     * Returns the CSS overflow-y value, or null if not set.
     *
     * @returns The CSS overflow-y string, or null.
     */
    getOverflowY(): string | null {
        return this._overflowY;
    }

    /**
     * Sets the CSS overflow-y property on the component's CSS rule.
     *
     * @param value - A CSS overflow value (e.g. "hidden", "auto", "visible").
     *
     * @returns This component, for method chaining.
     */
    setOverflowY(value: string): this {
        if (this._overflowY === value) {
            return this;
        }

        this._overflowY = value;
        this.setElementCSSRule("overflowY", value);

        return this;
    }

    /**
     * Removes the overflow-y CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearOverflowY(): this {
        if (this._overflowY === null) {
            return this;
        }

        this._overflowY = null;
        this.setElementCSSRule("overflowY", null);

        return this;
    }

    /**
     * Returns the CSS `contain` value, or null if not set.
     *
     * @returns The CSS contain string, or null.
     */
    getContain(): string | null {
        return this._contain;
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
        if (this._contain === value) {
            return this;
        }

        this._contain = value;
        this.setElementCSSRule("contain", value);

        return this;
    }

    /**
     * Removes the `contain` CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearContain(): this {
        if (this._contain === null) {
            return this;
        }

        this._contain = null;
        this.setElementCSSRule("contain", null);

        return this;
    }

    /**
     * Returns the CSS `animation` shorthand value, or null if not set.
     *
     * @returns The CSS animation string, or null.
     */
    getAnimation(): string | null {
        return this._animation;
    }

    /**
     * Sets the CSS `animation` shorthand on the component's CSS rule.
     *
     * @param value - A CSS animation shorthand (e.g. "ts-ui-spin 0.8s linear infinite").
     *
     * @returns This component, for method chaining.
     */
    setAnimation(value: string): this {
        if (this._animation === value) {
            return this;
        }

        this._animation = value;
        this.setElementCSSRule("animation", value);

        return this;
    }

    /**
     * Removes the CSS `animation` property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearAnimation(): this {
        if (this._animation === null) {
            return this;
        }

        this._animation = null;
        this.setElementCSSRule("animation", null);

        return this;
    }

    /**
     * Returns the cached state of the HTML `disabled` attribute on the element.
     *
     * @returns True when the `disabled` attribute is set, false otherwise.
     */
    getDisabledAttribute(): boolean {
        return this._disabledAttribute;
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
        if (this._disabledAttribute === value) {
            return this;
        }

        this._disabledAttribute = value;

        if (value) {
            this.setAttribute("disabled", "");
        } else {
            this.delAttribute("disabled");
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
     * @internal Consumers should use {@link getAria} to access typed ARIA setters.
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
     * Returns the inline `pointer-events` value last passed to
     * {@link setPointerEvents}, or `null` if not set.
     *
     * @returns The pointer-events string, or null.
     */
    getPointerEvents(): string | null {
        return this._options.pointerEvents ?? null;
    }

    /**
     * Sets the CSS pointer-events property on the element.
     *
     * @param value - A CSS pointer-events value (e.g. "none", "auto").
     *
     * @returns This component, for method chaining.
     */
    setPointerEvents(value: string): this {
        this._options.pointerEvents = value;

        this.setElementStyle("pointerEvents", value);

        return this;
    }

    /**
     * Removes the inline `pointer-events` property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearPointerEvents(): this {
        if (this._options.pointerEvents === undefined) {
            return this;
        }

        this._options.pointerEvents = undefined;
        this.setElementStyle("pointerEvents", null);

        return this;
    }

    /**
     * Returns the opacity value last passed to {@link setOpacity}, or `null` if
     * no opacity has been set.
     *
     * @returns The opacity number, or null.
     */
    getOpacity(): number | null {
        return this._opacity;
    }

    /**
     * Sets the CSS opacity property on the element.
     *
     * @param value - A number between `0` (fully transparent) and `1` (fully opaque). Use {@link clearOpacity} to remove the property.
     *
     * @returns This component, for method chaining.
     */
    setOpacity(value: number): this {
        this._opacity = value;

        this.setElementStyle("opacity", String(value));

        return this;
    }

    /**
     * Removes the opacity property from the element's inline style, restoring
     * full opacity from the CSS rule or default.
     *
     * @returns This component, for method chaining.
     */
    clearOpacity(): this {
        this._opacity = null;
        this.setElementStyle("opacity", null);

        return this;
    }

    /**
     * Returns the cached `will-change` value last passed to {@link setWillChange}.
     *
     * @returns The active hint string, or `null` if no hint is set.
     */
    getWillChange(): string | null {
        return this._willChange;
    }

    /**
     * Sets the CSS `will-change` hint on the element, pre-promoting it to its
     * own compositor layer so the first transform/scroll frame doesn't pay a
     * layer-creation cost. Pass `null` to clear the hint and release the layer.
     *
     * @param value - A CSS `will-change` value (e.g. `"transform"`) or `null` to clear.
     *
     * @returns This component, for method chaining.
     *
     * @remarks The hint costs GPU memory and is ignored by browsers past a
     * per-page threshold (~50–100 elements). Set it only over the active-motion
     * lifetime (drag, pool membership, scroll-target lifetime) and clear it
     * promptly when motion ends.
     */
    setWillChange(value: string | null): this {
        if (this._willChange === value) {
            return this;
        }

        this._willChange = value;

        this.setElementStyle("willChange", value);

        return this;
    }

    /**
     * Returns the CSS `white-space` value last written by {@link setWhiteSpace},
     * or `null` if cleared.
     *
     * @returns The white-space string, or null.
     */
    getWhiteSpace(): string | null {
        return this._whiteSpace;
    }

    /**
     * Sets the CSS white-space property on the component's CSS rule.
     *
     * @param value - A CSS white-space value (e.g. "nowrap", "normal", "pre").
     *
     * @returns This component, for method chaining.
     *
     * @remarks Previously declared on [`Text`](/api/component/input/classes/Text);
     * promoted to `Component` because the property has no Text-specific
     * semantics. The `_whiteSpace` backing field that {@link applyStyle}
     * already consults on re-render lives here, so caching during the setter
     * call keeps the post-render state in lockstep with the cached value.
     */
    setWhiteSpace(value: string): this {
        this._whiteSpace = value;

        this.setElementCSSRule("whiteSpace", value);

        return this;
    }

    /**
     * Removes the white-space CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearWhiteSpace(): this {
        if (this._whiteSpace === null) {
            return this;
        }

        this._whiteSpace = null;
        this.setElementCSSRule("whiteSpace", null);

        return this;
    }

    /**
     * Returns the `user-select` value last passed to {@link setUserSelect}, or
     * `null` if no value has been set.
     *
     * @returns The user-select string, or null.
     */
    getUserSelect(): string | null {
        return this._userSelect;
    }

    /**
     * Sets the CSS user-select property on the element.
     *
     * @param value - A CSS user-select value (e.g. "none", "auto", "text").
     *
     * @returns This component, for method chaining.
     */
    setUserSelect(value: string): this {
        this._userSelect = value;

        this.setElementCSSRule("userSelect", value);

        return this;
    }

    /**
     * Removes the user-select CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearUserSelect(): this {
        if (this._userSelect === null) {
            return this;
        }

        this._userSelect = null;
        this.setElementCSSRule("userSelect", null);

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

        // Materialize the stylesheet rule once and write directly to it from
        // this method. applyStyle runs during render() before `this.element`
        // has been cached, so routing through setElementCSSRule (which gates
        // on getElement()) would no-op.
        const rule = this.ensureCSSRule();

        // Read through the default-options fallback so class-level defaults
        // (position, cursor, insets, padding, minSize/maxSize, overflow,
        // displayed, zIndex) reach the DOM even when no setter has fired —
        // `_options` is empty for any field the caller didn't supply.
        const opts = { ...this._defaultOptions, ...this._options };

        if (this._boxSizing) {
            rule.style.boxSizing = this._boxSizing;
        }

        if (opts.position) {
            rule.style.position = opts.position;
        }

        if (opts.visible != null) {
            rule.style.visibility = opts.visible ? "visible" : "hidden";
        } else {
            rule.style.visibility = "inherit";
        }

        if (opts.displayed != null) {
            rule.style.display = opts.displayed ? this._display : "none";
        }

        if (opts.cursor) {
            rule.style.cursor = opts.cursor;
        }

        if (opts.foregroundColor) {
            rule.style.setProperty('color', opts.foregroundColor);
        }

        if (opts.backgroundColor) {
            rule.style.setProperty('background-color', opts.backgroundColor);
        }

        if (opts.backgroundImage) {
            rule.style.setProperty('background-image', opts.backgroundImage);
        }

        // NaN means "never assigned by a setter" — skip the DOM write for those.
        // Any finite value (including 0) MUST be written so the DOM matches the cached field.
        if (!Number.isNaN(this._width)) {
            element.style.width = this._width + "px";
        }

        if (!Number.isNaN(this._top)) {
            element.style.top = this._top + "px";
        }

        if (!Number.isNaN(this._left)) {
            element.style.left = this._left + "px";
        }

        if (!Number.isNaN(this._height)) {
            element.style.height = this._height + "px";
        }

        const minSize = opts.minSize;
        if (minSize) {
            rule.style.minWidth = minSize.width + "px";
            rule.style.minHeight = minSize.height + "px";
        }

        const maxSize = opts.maxSize;
        if (maxSize) {
            rule.style.maxWidth = maxSize.width === Number.MAX_VALUE ? "none" : maxSize.width + "px";
            rule.style.maxHeight = maxSize.height === Number.MAX_VALUE ? "none" : maxSize.height + "px";
            this.setAttribute("maxSize", maxSize.width + " " + maxSize.height);
        }

        if (this._overflowX !== null) {
            rule.style.overflowX = this._overflowX;
        }
        if (this._overflowY !== null) {
            rule.style.overflowY = this._overflowY;
        }

        if (this._whiteSpace) {
            rule.style.whiteSpace = this._whiteSpace;
        }

        if (this._borderCSS) {
            rule.style.setProperty('border', this._borderCSS);
        } else if (this._border) {
            this._border.applyOnCSSRule(rule);
        } else {
            rule.style.removeProperty("border");
        }

        if (opts.borderRadius) {
            rule.style.borderRadius = opts.borderRadius;
        }

        if (opts.shadow) {
            rule.style.setProperty('box-shadow', opts.shadow);
        }

        if (opts.pointerEvents) {
            element.style.pointerEvents = opts.pointerEvents;
        }

        if (opts.zIndex) {
            element.style.zIndex = String(opts.zIndex);
        }

        if (this._userSelect) {
            rule.style.userSelect = this._userSelect;
        }

        if (opts.padding) {
            rule.style.padding = opts.padding.render();
        }

        if (opts.insets) {
            this.setAttribute("insets", opts.insets.render());
        }

        rule.style.margin = "0px 0px 0px 0px";

        // Materialise state-specific rules registered by subclasses (Button's
        // `:active` / `:hover`, ToggleButton's `.selected`). Each rule's
        // pending writes flush onto the live `CSSStyleRule` inside `ensure()`,
        // so the stylesheet picks up the entry on first render rather than on
        // first setter write during construction.
        for (const deferredRule of this._deferredStyleRules.values()) {
            deferredRule.ensure();
        }

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
        if (component._parent === this) {
            return this;
        }

        if (component._parent !== null) {
            throw new Error(`Component ${component.getId()} already has a parent. Remove it first.`);
        }

        this._components.push(component);

        this.setLayoutConstraints(component, constraints);

        component._parent = this;
        component._onPreferredSizeChange = () => {
            this.scheduleLayout();

            this._onPreferredSizeChange?.();
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
        if (component._parent === this) {
            return this;
        }

        if (component._parent !== null) {
            throw new Error(`Component ${component.getId()} already has a parent. Remove it first.`);
        }

        const clampedIndex = Math.max(0, Math.min(index, this._components.length));
        this._components.splice(clampedIndex, 0, component);

        this.setLayoutConstraints(component, constraints);

        component._parent = this;
        component._onPreferredSizeChange = () => {
            this.scheduleLayout();

            this._onPreferredSizeChange?.();
        };

        let element = this.getElement();
        if (!element) {
            return this;
        }

        let compElement = component.getElement(true);
        const nextSibling = clampedIndex + 1 < this._components.length
            ? this._components[clampedIndex + 1].getElement()
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
            index = this._components.indexOf(component)
        } else if (component instanceof Number) {
            index = (component as Number).valueOf();
            component = this._components[index];
        } else {
            return;
        }

        if (index > -1) {
            this._components.splice(index, 1);
        }

        let constraints = this.delLayoutConstraints(component);

        component._parent = null;
        component._onPreferredSizeChange = null;
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
        for (let idx in this._components) {
            let component = this._components[idx];
            component._parent = null;
            component._onPreferredSizeChange = null;
            component.removeElement();
        }

        this._components = [];

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
        this._components.sort(comparator);

        return this;
    }

    /**
     * Returns the array of child components.
     *
     * @returns The live array of child Component instances.
     */
    getComponents() {
        return this._components;
    }

    /**
     * Returns the layout constraints for a child component from the layout manager.
     *
     * @param component - The child component whose constraints to retrieve.
     *
     * @returns The LayoutConstraints for the component, or undefined if none are set.
     */
    getLayoutConstraints(component: Component) {
        const lm = this.getLayoutManager();
        if (!lm) {
            console.warn("Unable to get layout constraints, no layout manager specified.");
            return;
        }

        return lm.getLayoutConstraints(component);
    }

    /**
     * Registers layout constraints for a child component with the layout manager.
     *
     * @param component - The child component to constrain.
     * @param constraints - Optional. The layout constraints to apply.
     */
    setLayoutConstraints(component: Component, constraints?: LayoutConstraints) {
        const lm = this.getLayoutManager();
        if (!lm) {
            console.warn("Unable to set layout constraints, no layout manager specified.");
            return;
        }

        return lm.setLayoutConstraints(component, constraints);
    }

    /**
     * Removes and returns the layout constraints for a child component.
     *
     * @param component - The child component whose constraints to remove.
     *
     * @returns The removed LayoutConstraints, or null if no layout manager is set.
     */
    delLayoutConstraints(component: Component) {
        const lm = this.getLayoutManager();
        if (!lm) {
            return null;
        }

        return lm.delLayoutConstraints(component);
    }

    /**
     * Returns the layout manager currently attached to this component.
     *
     * @returns The current LayoutManager instance.
     */
    getLayoutManager(): LayoutManager {
        return (this._options.layoutManager ?? this._defaultOptions.layoutManager) as LayoutManager;
    }

    /**
     * Detaches the current layout manager, attaches the new one, and stores the class name as an attribute.
     *
     * @param layoutManager - The new LayoutManager to use for this component.
     */
    setLayoutManager(layoutManager: LayoutManager): this {
        const current = this._options.layoutManager;
        if (current) {
            current.detach();
        }

        this._options.layoutManager = layoutManager;

        if (layoutManager) {
            layoutManager.attach(this);
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
        return this._layoutPaused;
    }

    /**
     * Suspends automatic layout passes until resumeLayout is called.
     */
    pauseLayout(): this {
        this._layoutPaused = true;

        return this;
    }

    /**
     * Resumes layout and immediately triggers a doLayout pass.
     *
     * @returns This component, for method chaining.
     */
    resumeLayout(): this {
        this._layoutPaused = false;
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

        const lm = this.getLayoutManager();
        if (!lm) {
            throw new Error("Unable to do layout, no layout manager specified.");
        }

        lm.doLayout();

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

        // Bind the inline-style buffer so any writes queued during detached
        // construction flush into the live element, and subsequent setters
        // write through directly.
        this._inlineStyle.attach(element);

        // `for…in` walks own enumerable property names. A `Map` has no own
        // enumerable properties (its entries live behind its public API), so
        // the prior `for (let key in this._attributes)` form silently iterated
        // nothing — every attribute cached during detached construction was
        // dropped at render time. Use the `Map` iterator directly.
        for (const [key, value] of this._attributes) {
            if (value != null) {
                element.setAttribute(key.valueOf(), value.valueOf());
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
        return document.createElement(this._tag);
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
type ComponentCallable<TOptions extends ComponentOptions = ComponentOptions> = Component<TOptions>;
export {
    Component         as _Component,
    ComponentCallable as Component
};

