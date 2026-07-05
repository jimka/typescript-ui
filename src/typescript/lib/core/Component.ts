// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "~/layout/LayoutManager.js";
import { Absolute } from "~/layout/Absolute.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { BorderOptions, borderToStyle, borderSideWidth } from "~/primitive/Border.js";
import { Size, UNBOUNDED, isUnbounded } from "~/primitive/Size.js";
import { Insets } from "~/primitive/Insets.js";
import { BaseObject } from "~/core/BaseObject.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Type } from "~/core/Type.js";
import { Util } from "~/core/Util.js";
import { Position } from "~/primitive/Position.js";
import { Aria } from "~/core/Aria.js";
import { Event } from "~/core/Event.js";
import { SmoothScroller, consumeWheel, type ScrollAxis } from "~/core/SmoothScroller.js";
import { StyleRule, InlineStyle } from "~/core/StyleTarget.js";
import { ThemeManager } from "~/core/Theme.js";
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
 * Declarative spec for a per-component state rule installed at construction
 * time via {@link ComponentOptions.styleRules}.
 *
 * Each entry produces (or fetches) a `StyleRule` whose selector is
 * `#<id><suffix>` (e.g. `#cmp-12:hover`, `#cmp-12.selected`) and applies the
 * given style body. The `suffix` is the dedupe key inside the component's
 * `_deferredStyleRules` map — repeated entries with the same suffix write
 * into the same wrapper.
 *
 * Subclasses that want to layer rules on top of caller-supplied entries
 * use the standard array-merge idiom on the bag:
 *
 * ```typescript
 * super({
 *     ...options,
 *     styleRules: [
 *         ...(options?.styleRules ?? []),
 *         { suffix: ":hover", styles: { backgroundColor: "var(--…)" } },
 *     ],
 * }, _defaultXOptions);
 * ```
 *
 * @category Core
 */
export interface ComponentStyleRuleSpec {
    suffix: string;
    styles: Record<string, string | null>;
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
    /** CSS `background` shorthand — a color, gradient, or image (all layers). */
    background?:      string;
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
    transition?:      string;
    willChange?:      string | null;
    opacity?:         number;
    overflow?:        string;
    pointerEvents?:   string;
    writingMode?:     string;
    touchAction?:     string;
    layoutManager?:   LayoutManager;
    id?:              string;
    /** Human-readable title for the component; read by the [`Tab`](/api/layout/classes/Tab) layout for the tab/window label. */
    name?:            string | null;
    attributes?:      Record<string, string>;
    components?:      Array<Component | ConstrainedComponent>;
    styleRules?:      ComponentStyleRuleSpec[];
}

// Module-level state for the rAF-coalesced layout queue. Setters and event handlers call
// `scheduleLayout()` instead of `doLayout()`; the queue flushes once per animation frame and
// prunes any component whose ancestor is also dirty (the ancestor's layout will recurse into
// it). `flushLayout()` provides a synchronous escape hatch for callers that need a layout
// commit before reading layout-derived state.
let pendingLayouts: Set<Component> = new Set();
// Callbacks queued via Component.afterNextLayout, drained once after the next
// flush lays out every dirty component — see afterNextLayout for the contract.
let afterLayoutCallbacks: Array<() => void> = [];
let rafHandle: number | null = null;

/** Schedules a layout-flush frame if one is not already pending. */
function ensureFlushScheduled(): void {
    if (rafHandle === null) {
        rafHandle = DOM.sink.requestAnimationFrame(flushPendingLayouts);
    }
}

function flushPendingLayouts() {
    rafHandle = null;

    // Snapshot and clear both queues so re-entrant scheduleLayout / afterNextLayout
    // calls (from a doLayout side effect or a post-layout callback) queue into the
    // next frame instead of mutating these during iteration.
    const dirty = Array.from(pendingLayouts);
    pendingLayouts.clear();

    const callbacks = afterLayoutCallbacks;
    afterLayoutCallbacks = [];

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

    // Post-layout callbacks run after every dirty component has settled, so a
    // consumer that scheduled layout work (revealing a view, opening a section)
    // can act on the final geometry — e.g. focus a now-laid-out element.
    for (const cb of callbacks) {
        cb();
    }
}

/**
 * Serialises one size term for a debug `data-*` size attribute: `"inf"` when the
 * extent is unbounded, else its rounded pixel string.
 *
 * @param value - The extent to serialise.
 * @returns `"inf"` for an unbounded extent, else `"<rounded>px"`.
 */
function formatSizeTerm(value: number): string {
    return isUnbounded(value) ? "inf" : Math.round(value) + "px";
}

/**
 * Serialises a width/height pair for a debug `data-*` size attribute, testing
 * each axis independently so an unbounded width paired with a bounded height (or
 * vice versa) renders correctly.
 *
 * @param width - The width extent.
 * @param height - The height extent.
 * @returns The space-separated `"<width> <height>"` term pair.
 */
function formatSizeAttr(width: number, height: number): string {
    return formatSizeTerm(width) + " " + formatSizeTerm(height);
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
/**
 * Releases a discarded component's retained handles once the `Component`
 * instance is garbage-collected — restoring the pre-handle lifecycle where a
 * node lived exactly as long as its `Component`.
 *
 * @remarks A component removed via `removeComponent` (the shared primitive that
 * `moveComponent` is built on) detaches its element but cannot release the
 * handle there — releasing would break a move, which re-inserts the same
 * instance. Reachability is the move-vs-discard signal: a moved component stays
 * referenced; a discarded one becomes unreachable. So the release is keyed on GC
 * of the `Component`. The held value is the owned-handle array (numbers only,
 * with no back-reference to the `Component`, so the `Component` stays
 * collectable). `release` is idempotent, so a handle already freed by the eager
 * `destructor` or an explicit dispose is a harmless no-op here.
 */
const _componentFinalizer = new FinalizationRegistry<readonly Handle[]>((handles) => {
    for (const handle of handles) {
        DOM.sink.release(handle);
    }
});

class Component<TOptions extends ComponentOptions = ComponentOptions> extends BaseObject {

    // Structural state that is NOT option-backed — runtime references, render
    // caches, lifecycle flags, and constants. Option-backed values (border,
    // layoutManager, insets, padding, ...) live in `this._options` instead.
    private _components: Array<Component>;

    // Callbacks queued via onFirstLayout, drained the first time this component
    // completes a doLayout while its element is connected. Null once fired (or
    // never registered) so the common case allocates nothing.
    private _firstLayoutCallbacks : Array<() => void> | null = null;

    private _element              : Handle | undefined;
    // Handles for every element this component created — root, clip / content
    // frames, and subclass-created children (registered via trackHandle).
    // Released eagerly in destructor, or by _componentFinalizer when a discarded
    // component is garbage-collected. Safe with a plain initializer: this is a
    // base-class field, set before the constructor body runs applyOptions, so no
    // cascade-dispatched render can clobber it.
    private readonly _ownedHandles : Handle[]               = [];
    private _tag                  : string                  = "div";
    private _attributes           : Map<string, string>;
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
    private _scrollLeft           : number                  = 0;
    private _scrollTop            : number                  = 0;
    private _willChange          : string | null           = null;
    private _transition           : string | null           = null;

    // Derived / runtime-only fields that have no direct ComponentOptions counterpart.
    // `_position` is intentionally NOT in `ComponentOptions` — the framework
    // positions every component absolutely (see ARCHITECTURE.md). Subclasses
    // that need `FIXED` for a floating overlay or `STATIC` for a semantic
    // HTML carve-out (e.g. `Legend`) call the protected `setPosition` setter
    // post-`super()`. Public callers cannot reach it.
    private _position             : Position                = Position.ABSOLUTE;
    private _onPreferredSizeChange: (() => void) | null     = null;
    // Fired when this component's min/max constraint changes, so the parent
    // layout manager can re-clamp/relayout. Parallels `_onPreferredSizeChange`;
    // bound by the parent in add/insert, nulled on remove. `setMinSize`/
    // `setMaxSize` (not `applyOptions`) write it, so no `declare` is needed.
    private _onConstraintSizeChange: (() => void) | null    = null;
    private _overflowX            : string | null           = null;
    private _overflowY            : string | null           = null;
    // Eased wheel-scroll controller, lazily attached while an overflow axis is
    // scrollable (auto/scroll). Null otherwise — most components never scroll.
    private _wheelScroller        : SmoothScroller | null     = null;
    private _contain              : string | null           = null;
    private _animation            : string | null           = null;
    private _outline              : string | null           = null;
    private _appearance           : string | null           = null;
    private _borderImage          : string | null           = null;
    private _transform            : string | null           = null;
    private _opacity              : number | null           = null;
    private _disabledAttribute    : boolean                 = false;
    private _border               : BorderOptions | null     = null;
    private _borderWidths         : PerimeterSize | null      = null;
    private _borderThemeCleanup    : (() => void) | null       = null;
    private _autoCommitStyle      : boolean                 = true;
    private _layoutPaused         : boolean                 = false;
    private _aria                : Aria | null             = null;
    private _whiteSpace           : string | null;
    private _userSelect           : string | null;
    private _verticalAlign        : string | null;
    // Deferred-write style buffers. `styleRule` lazily materialises the
    // component's per-id `CSSStyleRule` on first `ensure()` call; `inlineStyle`
    // queues `element.style.X = ...` writes until `init()` attaches it.
    private _styleRule            : StyleRule    = new StyleRule({ scope: "component", name: this.getId(), materialize: false });
    private _inlineStyle          : InlineStyle  = new InlineStyle();
    // Optional clip frame: a presentational wrapper element interposed between
    // this component's element and its DOM parent, sized to a cell rect with
    // `overflow: hidden` so a layout manager can visually clip an element that
    // is wider/taller than its allotted cell (e.g. a `Grid` fixed column). The
    // frame carries no id and no listeners — it is a non-interactive sheath, so
    // it stays runtime-only state off the options bag. `_clipFrameStyle` buffers
    // the wrapper's geometry writes through the framework's deferred-write seam.
    private _clipFrame            : Handle | null = null;
    private _clipFrameStyle       : InlineStyle  = new InlineStyle();
    // Optional content frame: a presentational wrapper interposed between this
    // component's element and ITS children, sized to the full content extent
    // (leading inset + children + trailing inset) so the host's native scroll
    // reserves both insets symmetrically when the children overflow. The mirror
    // image of the clip frame — that one clips a single oversized child, this
    // one exposes an oversized child set for scrolling. Same runtime-only,
    // id-less, listener-free discipline; the geometry writes buffer through
    // `_contentFrameStyle`.
    private _contentFrame         : Handle | null = null;
    private _contentFrameStyle    : InlineStyle  = new InlineStyle();
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

    /**
     * @param options - Caller-supplied options bag.
     * @param subclassDefaults - Per-subclass default bag merged on top of the
     *   built-in Component defaults to produce `_defaultOptions`. Subclasses
     *   that extend Component (or any further-derived class) pass their
     *   `_default<Name>Options` constant here. The defaults are a pure
     *   fallback: getters and `applyStyle` consult `_defaultOptions` directly
     *   when the caller omitted a field, so a default is never dispatched into
     *   `_options`. Replaces the older pattern of spreading defaults into the
     *   options arg at the call site — that pattern populated `_options`
     *   directly and broke whenever `applyOptions` was re-invoked, because
     *   Component's own defaults would silently override values set in the
     *   subclass constructor body. Subclasses-of-subclasses accept their own
     *   `subclassDefaults` parameter and forward it as
     *   `{ ..._myDefaults, ...(subclassDefaults ?? {}) }` so the deepest
     *   class's defaults win.
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        // BaseObject's constructor takes no options; this constructor applies them via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
        super();

        // Structural setup that doesn't map to ComponentOptions.
        // `styleRule` stays unmaterialised until the element actually needs to
        // render; the dirty-style path queues writes until then. See
        // `ensureCSSRule`.
        this._components         = [];
        this._attributes         = new Map<string, string>();
        this._deferredStyleRules = new Map<string, StyleRule>();

        // Constants without ComponentOptions counterpart.
        this._boxSizing     = "border-box";
        this._whiteSpace    = "nowrap";
        this._userSelect    = "none";
        this._verticalAlign = "baseline";

        // Class-level defaults — fallback values consulted by getters when the
        // caller (or a setter) hasn't written to `_options`, and the source
        // every `applyOptions` cascade merges over before dispatching setters.
        // Subclass defaults are layered on top of the Component defaults here
        // so deepest-class wins; `applyOptions` and its overrides then merge
        // user `options` on top of this bag at dispatch time.
        this._defaultOptions = {
            layoutManager: new Absolute(),
            cursor       : "default",
            insets       : new Insets(0, 0, 0, 0),
            minSize      : { width: 0, height: 0 },
            maxSize      : { width: UNBOUNDED, height: UNBOUNDED },
            overflow     : "hidden",
            zIndex       : 0,
            displayed    : true,
            ...(subclassDefaults ?? {}),
        } as TOptions;

        // Explicit state — starts empty. Only values the caller passed or that
        // setters wrote ever land here. This is what `if (this._options.X ===
        // undefined)` checks against in subclass constructors.
        this._options = {} as TOptions;

        // `tag` has no setter — apply the option directly here. Subclasses
        // commonly forward this from `super({ tag: "..." })`.
        if (options?.tag !== undefined) {
            this._tag = options.tag;
        } else if (this._defaultOptions.tag !== undefined) {
            this._tag = this._defaultOptions.tag;
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
        // Dispatch only the caller-supplied options — class-level defaults are a
        // pure fallback consulted by the getters (and `applyStyle`), never
        // written into `_options`. See the per-field getters and the
        // `_defaultOptions` seed in the constructor.
        if (options.id              !== undefined) this.setId(options.id);
        if (options.name            !== undefined) this.setName(options.name);
        if (options.layoutManager   !== undefined) this.setLayoutManager(options.layoutManager);
        if (options.visible         !== undefined) this.setVisible(options.visible);
        if (options.displayed       !== undefined) this.setDisplayed(options.displayed);
        if (options.zIndex          !== undefined) this.setZIndex(options.zIndex);
        if (options.insets          !== undefined) this.setInsets(options.insets);
        if (options.padding         !== undefined) this.setPadding(options.padding);
        if (options.backgroundColor !== undefined) this.setBackgroundColor(options.backgroundColor);
        if (options.background      !== undefined) this.setBackground(options.background);
        if (options.foregroundColor !== undefined) this.setForegroundColor(options.foregroundColor);
        if (options.colorScheme     !== undefined) this.setColorScheme(options.colorScheme);
        this.applyChromeOptions(options);
        if (options.outline         !== undefined) this.setOutline(options.outline);
        if (options.cursor          !== undefined) this.setCursor(options.cursor);
        if (options.preferredSize   !== undefined) this.setPreferredSize(options.preferredSize.width, options.preferredSize.height);
        if (options.minSize         !== undefined) this.setMinSize(options.minSize.width, options.minSize.height);
        if (options.maxSize         !== undefined) this.setMaxSize(options.maxSize.width, options.maxSize.height);
        if (options.transform       !== undefined) this.setTransform(options.transform);
        if (options.transition      !== undefined) this.setTransition(options.transition);
        if (options.willChange      !== undefined) this.setWillChange(options.willChange);
        if (options.opacity         !== undefined) this.setOpacity(options.opacity);
        if (options.overflow        !== undefined) this.setOverflow(options.overflow);
        if (options.pointerEvents   !== undefined) this.setPointerEvents(options.pointerEvents);
        if (options.writingMode     !== undefined) this.setWritingMode(options.writingMode);
        if (options.touchAction     !== undefined) this.setTouchAction(options.touchAction);

        if (options.attributes !== undefined) {
            // The options bag's `attributes` is a raw-HTML-attribute escape
            // hatch — callers pass arbitrary attribute names (e.g.
            // `placeholder`, `data-foo`, `aria-bar`) and expect a literal
            // write. Stash on `_options.attributes` so `init()` can replay
            // them when the element is created; write through immediately if
            // the element already exists.
            this._options.attributes = options.attributes;

            const element = this.getElement();
            if (element) {
                DOM.sink.apply(element, { setAttr: options.attributes });
            }
        }

        if (options.styleRules !== undefined) {
            // Route every entry through `createStyleRule` so the wrapper is
            // registered in `_deferredStyleRules` and materialised at render
            // time, matching how the lazy state-rule getters in Button /
            // ToggleButton / WindowBorder allocate. Bare `new StyleRule(...)`
            // would skip the deferral and force-insert the stylesheet rule
            // before the element exists.
            for (const spec of options.styleRules) {
                this.createStyleRule(spec.suffix).setMany(spec.styles);
            }
        }

        if (options.components !== undefined) this.addComponents(options.components);

        return this;
    }

    /**
     * Dispatches the visual-chrome subset of a {@link ComponentOptions} bag —
     * `border`, `borderRadius`, `shadow`, and `backgroundImage`. Called from
     * {@link applyOptions}.
     *
     * @param options - The raw caller options bag. Unlike the rest of
     *   `applyOptions`, the chrome fields fold in `this._defaultOptions` here so
     *   their class-level defaults are still *dispatched* (e.g.
     *   `options.border ?? this._defaultOptions.border`). They are kept on the
     *   dispatch path — rather than resolved lazily by their getters — because
     *   `border`'s parsed state (`_border`) feeds the layout border-width path
     *   and a theme re-measure listener, and because `borderRadius`/`shadow`
     *   must let a deeper subclass `clear*()` suppress an inherited default
     *   (e.g. TabButton flattening Button's chrome) rather than fall back to it.
     *   None of these four fields is consulted by a `_options.X === undefined`
     *   guard, so dispatching their default does not violate the clean-bag
     *   invariant.
     *
     * @remarks
     * Subclasses override this hook when they need to gate or extend the
     * chrome dispatch — e.g. [`Button`](/api/component/button/classes/Button)
     * gates on its `chromeless` option and appends its pressed/hover chrome
     * fields after the base call.
     */
    protected applyChromeOptions(options: TOptions): void {
        const border          = options.border          ?? this._defaultOptions.border;
        const borderRadius    = options.borderRadius    ?? this._defaultOptions.borderRadius;
        const shadow          = options.shadow          ?? this._defaultOptions.shadow;
        const backgroundImage = options.backgroundImage ?? this._defaultOptions.backgroundImage;

        if (border          !== undefined) this.setBorder(border);
        if (borderRadius    !== undefined) this.setBorderRadius(borderRadius);
        if (shadow          !== undefined) this.setShadow(shadow);
        if (backgroundImage !== undefined) this.setBackgroundImage(backgroundImage);
    }

    /**
     * Wires a closed `listeners` bag via `this.on()` — the declarative form of
     * the component's typed `on()` surface. A host that exposes `on()` calls
     * this once from its constructor body after `super()` returns (when its
     * `ListenerBag` field has initialised). The base never calls it — base
     * `Component` has no `on`, so the `(this as any).on` cast is sound only
     * because the helper is invoked exclusively from hosts that define one.
     *
     * @param listeners - The component's `options.listeners` bag, or `undefined`.
     */
    protected applyListeners(
        listeners: Record<string, ((...args: any[]) => void) | undefined> | undefined
    ): void {
        if (!listeners) {
            return;
        }

        for (const event of Object.keys(listeners)) {
            const fn = listeners[event];

            if (fn) {
                (this as any).on(event, fn);
            }
        }
    }

    /**
     * Removes the component's DOM element when the component is destroyed.
     */
    protected destructor() {
        if (this._borderThemeCleanup) {
            this._borderThemeCleanup();
            this._borderThemeCleanup = null;
        }

        // Tear any active clip / content frame down first (mirroring
        // removeElement) so each frame's wrapper is removed from the DOM and its
        // handle untracked and released.
        this.clearClipFrame();
        this.clearContentFrame();

        let element = this.getElement();
        if (element) {
            DOM.sink.removeElement(element);
        }

        // Eagerly release every remaining tracked handle (root and any
        // subclass-created children) and disarm the GC finalizer, then clear the
        // cache so a stale handle is never resolved.
        _componentFinalizer.unregister(this);

        for (const handle of this._ownedHandles) {
            DOM.sink.release(handle);
        }

        this._ownedHandles.length = 0;
        this._element             = undefined;
    }

    /**
     * Records a handle for an element this component created so it is released
     * on teardown — eagerly by {@link destructor}, or by the module finalizer
     * when a discarded component is garbage-collected. The first tracked handle
     * arms the finalizer. Subclasses call this at every element-creation site.
     *
     * @param handle - The created element handle.
     * @returns The same handle, for chaining at the creation site.
     */
    protected trackHandle(handle: Handle): Handle {
        if (this._ownedHandles.length === 0) {
            _componentFinalizer.register(this, this._ownedHandles, this);
        }

        this._ownedHandles.push(handle);

        return handle;
    }

    /**
     * Stops tracking a handle that has already been released through an explicit
     * dispose path (a disposed frame, a removed scroll-shadow overlay), so the
     * owned-handle set does not accumulate stale entries across repeated toggles.
     *
     * @param handle - The handle to drop from the tracked set.
     */
    protected untrackHandle(handle: Handle): void {
        const idx = this._ownedHandles.indexOf(handle);

        if (idx !== -1) {
            this._ownedHandles.splice(idx, 1);
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
            rule = new StyleRule({ scope: "component", name: this.getId(), suffix: selectorSuffix, materialize: false });
            this._deferredStyleRules.set(selectorSuffix, rule);
        }

        return rule;
    }

    /**
     * Returns the DOM element, querying by ID; creates and renders it if createIfMissing is true.
     *
     * @param createIfMissing - Optional. When true, renders and returns a new element if none exists in the DOM.
     *
     * @returns The component's element handle, or undefined if it does not exist and createIfMissing is false.
     */
    getElement(createIfMissing: boolean = false): Handle | undefined {
        if (!this._element) {
            // The lookup may miss (null); getElement's callers treat the result
            // as present, gating on `createIfMissing` / their own null checks.
            let element = DOM.source.getElementById(this.getId()) as Handle;
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

        // Tear any active clip / content frame down first so the wrapper is
        // removed with the element rather than orphaned in the DOM once the
        // element leaves.
        this.clearClipFrame();
        this.clearContentFrame();

        DOM.sink.removeElement(element);

        return this;
    }

    /**
     * Wraps this component's element in a clip frame — a presentational wrapper
     * element positioned at `(x, y)`, sized `width`×`height`, with
     * `overflow: hidden` — and parks this element at `(0, 0)` inside it. Lets a
     * layout manager visually clip an element that is wider or taller than its
     * allotted cell without fighting the element's own `min-width` /
     * `min-height` CSS floor (which `overflow: hidden` on the element itself
     * cannot, since it clips only descendants, not the element's own box).
     *
     * @param x - Left edge of the frame in the parent's coordinate space.
     * @param y - Top edge of the frame in the parent's coordinate space.
     * @param width - Frame width in pixels; element content beyond it is clipped.
     * @param height - Frame height in pixels; element content beyond it is clipped.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Idempotent: re-calling with a new rect resizes the existing
     * frame rather than creating a second one. No-op when the element is not
     * yet in the DOM — the layout manager drives this from a layout pass, by
     * which point the element exists. The frame carries no id and no listeners,
     * so subtree event delegation (which keys off element ids while walking
     * ancestors) routes through it unaffected.
     */
    setClipFrame(x: number, y: number, width: number, height: number): this {
        const element = this.getElement();
        if (!element) {
            return this;
        }

        if (!this._clipFrame) {
            const parent = DOM.source.getParentNode(element);

            // `position: absolute` (applied by createFrame) makes the frame the
            // containing block for the absolutely positioned element parked
            // inside it, so the element's `(0, 0)` resolves against the frame;
            // `overflow: hidden` clips a child larger than the cell rect.
            const frame = this.createFrame(this._clipFrameStyle, { overflow: "hidden" });
            this._clipFrame = frame;

            if (parent) {
                DOM.sink.insertBefore(parent, frame, element);
            }

            DOM.sink.appendChild(frame, element);
        }

        this._clipFrameStyle.setMany({
            left:   x + "px",
            top:    y + "px",
            width:  width  + "px",
            height: height + "px"
        });

        return this;
    }

    /**
     * Removes the clip frame installed by {@link setClipFrame}, re-parenting
     * this element back to the frame's parent at the frame's former DOM
     * position. No-op when no frame is active, so callers can invoke it
     * unconditionally on the non-clipped path.
     *
     * @returns This component, for method chaining.
     */
    clearClipFrame(): this {
        const frame = this._clipFrame;
        if (!frame) {
            return this;
        }

        const element = this.getElement();
        const parent  = DOM.source.getParentNode(frame);

        if (element && parent) {
            DOM.sink.insertBefore(parent, element, frame);
        }

        // disposeFrame removes the wrapper and returns a fresh buffer — the old
        // one was bound to the now-removed frame.
        this._clipFrameStyle = this.disposeFrame(frame);
        this._clipFrame = null;

        return this;
    }

    /**
     * Creates a presentational frame `<div>` for {@link setClipFrame} /
     * {@link setContentFrame}: a non-interactive sheath with no id and no
     * listeners, positioned absolutely so it can act as a containing block.
     * The caller's {@link InlineStyle} buffer is attached and seeded with
     * `position: absolute` plus any `base` overrides (e.g. `overflow: hidden`
     * for a clip frame); the caller is responsible for the geometry writes and
     * for splicing the returned element into the DOM.
     *
     * @param style - The buffer to attach to the new frame and write through.
     * @param base - Extra CSS properties applied alongside `position: absolute`.
     *
     * @returns The freshly created, styled frame element handle.
     */
    private createFrame(style: InlineStyle, base: Record<string, string>): Handle {
        const frame = DOM.sink.createElement("div");

        this.trackHandle(frame);
        style.attach(frame);
        style.setMany({ position: "absolute", ...base });

        return frame;
    }

    /**
     * Tears a frame created by {@link createFrame} down: removes it from the DOM
     * and returns a fresh {@link InlineStyle} for the caller to assign back to
     * its buffer field. A fresh buffer is required because the previous one was
     * bound to the now-removed frame. The caller must re-parent any wrapped
     * nodes out of the frame before calling this.
     *
     * @param frame - The frame element handle to remove.
     *
     * @returns A new, unattached InlineStyle buffer.
     */
    private disposeFrame(frame: Handle): InlineStyle {
        DOM.sink.removeElement(frame);
        this.untrackHandle(frame);
        DOM.sink.release(frame);

        return new InlineStyle();
    }

    /**
     * Wraps this container's children in a content frame sized to
     * `width`×`height` and re-parents every child into it, so the host's native
     * scroll extent equals the frame's box rather than the children's bounding
     * rect. A layout manager calls this when the children's content (including
     * both insets) overflows the container, sizing the frame to the full content
     * extent so the trailing inset is reserved as scrollable space — the mirror
     * of {@link setClipFrame}, which clips a single oversized child instead.
     *
     * Idempotent: when a frame already exists it is only resized. The frame is
     * id-less and carries no listeners, so it is transparent to subtree event
     * delegation (which walks the ancestor chain by id). No-op when the element
     * is not in the DOM.
     *
     * @param width - The content-frame width in pixels.
     * @param height - The content-frame height in pixels.
     *
     * @returns This component, for method chaining.
     */
    setContentFrame(width: number, height: number): this {
        const element = this.getElement();
        if (!element) {
            return this;
        }

        if (!this._contentFrame) {
            // Re-parenting the child set can reset the host's native scroll
            // offset; capture and restore it around the move.
            const scrollLeft = DOM.source.getScrollLeft(element);
            const scrollTop  = DOM.source.getScrollTop(element);

            // `left/top: 0` parks the frame at the container's padding-box
            // origin, so children keep their existing coordinates inside it.
            const frame = this.createFrame(this._contentFrameStyle, { left: "0px", top: "0px" });
            this._contentFrame = frame;

            // Move each child by its OUTERMOST node (its clip frame when one is
            // active, else its element) so a clip-framed child stays wrapped.
            for (const component of this._components) {
                const node = component.getAttachNode();

                if (node) {
                    DOM.sink.appendChild(frame, node);
                }
            }

            DOM.sink.appendChild(element, frame);

            DOM.sink.apply(element, { scrollLeft, scrollTop });
        }

        this._contentFrameStyle.setMany({
            width:  width  + "px",
            height: height + "px"
        });

        return this;
    }

    /**
     * Removes the content frame installed by {@link setContentFrame},
     * re-parenting the children back onto the element. No-op when no frame is
     * active, so a layout manager can call it unconditionally on the
     * non-overflowing path.
     *
     * @returns This component, for method chaining.
     */
    clearContentFrame(): this {
        const frame = this._contentFrame;
        if (!frame) {
            return this;
        }

        const element = this.getElement();

        if (element) {
            const scrollLeft = DOM.source.getScrollLeft(element);
            const scrollTop  = DOM.source.getScrollTop(element);

            // Re-parent the children back onto the element by their outermost
            // node before the frame is removed.
            for (const component of this._components) {
                const node = component.getAttachNode();

                if (node) {
                    DOM.sink.appendChild(element, node);
                }
            }

            DOM.sink.apply(element, { scrollLeft, scrollTop });
        }

        this._contentFrameStyle = this.disposeFrame(frame);
        this._contentFrame = null;

        return this;
    }

    /**
     * Returns the DOM node this component occupies in its parent's child list:
     * the clip frame when one is active (see {@link setClipFrame}), otherwise
     * the component's own element. Sibling DOM positioning must reference this
     * node rather than `getElement()`, because a clip-framed component's
     * element sits inside its frame, not directly under the container.
     *
     * @returns The frame element when clipped, else the component's element, or
     *   undefined when the element is not yet in the DOM.
     */
    protected getAttachNode(): Handle | null | undefined {
        return this._clipFrame ?? this.getElement();
    }

    /**
     * Returns the DOM node this component's children attach to: its content
     * frame when one is active (see {@link setContentFrame}), otherwise its own
     * element. The mirror of {@link getAttachNode} — that answers "what node do
     * I occupy in my parent", this answers "where do my children attach".
     *
     * @returns The content frame when active, else the component's element, or
     *   undefined when the element is not yet in the DOM.
     */
    private getChildHost(): Handle | undefined {
        return this._contentFrame ?? this.getElement();
    }

    /**
     * Returns whether the DOM element has the given attribute set.
     *
     * @param key - The attribute name to check.
     *
     * @returns True if the attribute exists, false otherwise, or undefined if the element is not in the DOM.
     */
    hasElementAttribute(key: string): boolean | undefined {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM.");
            return;
        }

        return DOM.source.hasAttribute(element, key);
    }

    /**
     * Returns the value of a DOM element attribute, or undefined if the element is not in the DOM.
     *
     * @param key - The attribute name to retrieve.
     *
     * @returns The attribute value string, null if the attribute is absent, or undefined if the element is not in the DOM.
     */
    getElementAttribute(key: string): string | null | undefined {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM. Attribute '" + key + "' can not be retrieved.");
            return;
        }

        return DOM.source.getAttribute(element, key);
    }

    /**
     * Sets a DOM element attribute; removes it if value is null/undefined.
     *
     * @param key - The attribute name.
     * @param value - The attribute value. Passing null or undefined removes the attribute.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Write-through to the element only — no internal cache. Setters
     * that need their value to survive detached construction store it in
     * their own specialized field (e.g. `_options.placeholder`,
     * `_disabledAttribute`) and replay it from the subclass `init()` after
     * the element is created.
     */
    protected setElementAttribute(key: string, value: Object | null | undefined): this {
        if (value === null || value === undefined) {
            return this.removeElementAttribute(key);
        }

        let element = this.getElement();
        if (!element) {
            return this;
        }

        DOM.sink.apply(element, { setAttr: { [key]: String(value) } });

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
            return this;
        }

        DOM.sink.apply(element, { removeAttr: [key] });

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
    getAutoCommitStyle(): boolean {
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

        // The per-component style rule is selector-scoped to `#<id>` and carries
        // `position: absolute` (plus every other rule-based style). It is created
        // from the initial id (the auto-UUID) before the constructor's
        // `applyOptions` can process an `id` option, so any id change — whether a
        // construction-time `{ id }` or a later `setId` — must re-point it, or
        // the rule stops matching the element and the component silently falls
        // back to `position: static`. Re-derive it here from the new id; the
        // values are replayed from the component's fields by `applyStyle` at
        // render (and immediately below when already rendered).
        this._styleRule = new StyleRule({ scope: "component", name: id, materialize: false });

        let element = this.getElement();
        if (!element) {
            return this;
        }

        DOM.sink.setId(element, id);
        this.applyStyle(element);

        return this;
    }

    /**
     * Returns the component's human-readable title — its intrinsic name,
     * distinct from the unique {@link getId} identifier. Set via the `name`
     * option or {@link setName}; `null` when unset. The
     * [`Tab`](/api/layout/classes/Tab) layout reads it for a tab button's label
     * (and a torn-off window's title) when no per-placement
     * `LayoutConstraints.name` override is present.
     *
     * @returns The component's name, or `null` when none has been set.
     */
    getName(): string | null {
        return this._options.name ?? null;
    }

    /**
     * Sets the component's human-readable title. Pure metadata — it writes no
     * DOM and does not affect layout; consumers such as the
     * [`Tab`](/api/layout/classes/Tab) layout read it to label the component.
     * The name travels with the component across re-parents (it lives on the
     * component, not on a parent's layout constraint).
     *
     * @param name - The new name, or `null` to clear it.
     *
     * @returns This component, for method chaining.
     */
    setName(name: string | null): this {
        this._options.name = name;

        return this;
    }

    /**
     * Returns a data attribute value from the component's cached `data-*`
     * attribute map.
     *
     * @param key - The attribute name (with or without the `data-` prefix).
     *
     * @returns The stored attribute value, or undefined if not set.
     *
     * @remarks Symmetric with {@link setDataAttribute}: the key is normalised
     * with a leading `data-` (idempotent if already prefixed) before lookup.
     */
    getDataAttribute(key: string): string | undefined {
        const dataKey = key.startsWith("data-") ? key : `data-${key}`;

        return this._attributes.get(dataKey);
    }

    /**
     * Stores a component-level data attribute and mirrors it as `data-<key>`
     * on the DOM element.
     *
     * @param key - The attribute name (with or without the `data-` prefix).
     * @param value - The attribute value. Passing null delegates to {@link delDataAttribute}.
     *
     * @remarks `setDataAttribute` is for *data-carrying* attributes — debug
     * markers, framework-internal identity reflection (`data-layout`), and
     * other consumer-readable `data-*` tags. Behavioral HTML attributes the
     * browser interprets (placeholder, readonly, inputmode, …) use the
     * `setElementAttribute` low-level seam instead.
     */
    setDataAttribute(key: string, value: string): this {
        if (value === null) {
            this.delDataAttribute(key);

            return this;
        }

        const dataKey = key.startsWith("data-") ? key : `data-${key}`;

        this._attributes.set(dataKey, value);

        let element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { setAttr: { [dataKey]: value } });
        }

        return this;
    }

    /**
     * Removes a component-level data attribute from both the internal map and
     * the DOM element.
     *
     * @param key - The attribute name (with or without the `data-` prefix).
     */
    delDataAttribute(key: string): this {
        const dataKey = key.startsWith("data-") ? key : `data-${key}`;

        this._attributes.delete(dataKey);

        let element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { removeAttr: [dataKey] });
        }

        return this;
    }

    /**
     * Returns the visibility state, or null if inherited from the parent.
     *
     * @returns True if explicitly visible, false if explicitly hidden, null if inheriting from the parent.
     */
    isVisible(): boolean | null {
        // Key-presence so a never-set component folds the class default (e.g.
        // AnimatedDropdown's `visible: false`), while an explicit
        // `setVisible(false)`/inherit still wins — mirrors getCursor/getPadding.
        return "visible" in this._options
            ? (this._options.visible ?? null)
            : (this._defaultOptions.visible ?? null);
    }

    /**
     * Sets visibility; true = visible, false = hidden, null/falsy = inherit from parent.
     *
     * @param value - True to show the component, false to hide it, or a falsy non-boolean to inherit.
     *
     * @remarks Throws an Error if value is a non-boolean truthy value.
     */
    setVisible(value: boolean | null): this {
        // `Type.isBoolean` runtime-checks arbitrary input (untyped callers can
        // still pass a non-boolean); the cast bridges its `object` parameter to
        // the narrowed `boolean | null` static type without altering behaviour.
        if (Type.isBoolean(value as unknown as object)) {
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
     * Returns the effective z-index — the caller/setter value, else the
     * class-level default (0 for a plain Component).
     *
     * @returns The resolved z-index.
     */
    getZIndex(): number {
        return (this._options.zIndex ?? this._defaultOptions.zIndex ?? 0) as number;
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

        this.setElementStyle("display", v ? "block" : "none");

        return this;
    }

    /**
     * Returns whether the component participates in layout. A `false` value
     * (set via `setDisplayed`) maps the element to CSS `display: none`, so it
     * occupies no space and its parent's layout manager skips it (see
     * `getLaidOutComponents`).
     *
     * @returns `true` unless `setDisplayed(false)` was called; never null
     *   (unlike `isVisible`, which is tri-state for inherited visibility).
     */
    isDisplayed(): boolean {
        return (this._options.displayed ?? this._defaultOptions.displayed) as boolean;
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
        this.setDataAttribute("insets", insets.render());

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
        this.setDataAttribute("insets", insets.render());

        return this;
    }

    /**
     * Returns the CSS padding insets for this component.
     *
     * @returns The current padding Insets, or null if none are set.
     */
    getPadding(): Insets | null {
        return "padding" in this._options ? (this._options.padding ?? null) : (this._defaultOptions.padding ?? null);
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
     * Returns the per-side offset a layout manager must apply to a child's
     * origin: insets plus CSS padding, border excluded.
     *
     * @returns An Insets whose sides are `inset + padding`.
     *
     * @remarks Framework components are absolutely positioned, so a child's
     * containing block is its parent's padding box. A child placed at
     * `left: 0` therefore lands at the inner edge of the border — the outer
     * edge of the padding — and the browser does not shift it inward by the
     * padding. `getInnerSize` has already subtracted padding from the usable
     * width/height, so a layout manager must add padding back into the child
     * origin or the whole padding allowance piles onto the far side. Border is
     * deliberately omitted: the containing-block edge already sits inside it.
     * Derived on each call from {@link getInsets} and {@link getPadding}; no
     * stored field, mirroring {@link getPerimiterSize}.
     */
    getContentInsets(): Insets {
        const insets = this.getInsets();
        const padding = this.getPadding();

        if (!padding) {
            return new Insets(insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft());
        }

        return new Insets(
            insets.getTop()    + padding.getTop(),
            insets.getRight()  + padding.getRight(),
            insets.getBottom() + padding.getBottom(),
            insets.getLeft()   + padding.getLeft()
        );
    }

    /**
     * Returns the component's background color, or null if inherited.
     *
     * @returns The CSS color string, or null if none is set.
     */
    getBackgroundColor(): string | null {
        return "backgroundColor" in this._options ? (this._options.backgroundColor ?? null) : (this._defaultOptions.backgroundColor ?? null);
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
        // Set (not skip) the key so `getBackgroundColor` sees an explicit clear
        // and returns null, suppressing a class-level default.
        this._options.backgroundColor = undefined;
        this.setElementCSSRule("backgroundColor", null);

        return this;
    }

    /**
     * Returns the CSS `background` shorthand value, or null if none is set.
     *
     * @returns The CSS background shorthand string, or null.
     */
    getBackground(): string | null {
        return this._options.background ?? null;
    }

    /**
     * Sets the CSS `background` shorthand property — a color, gradient, or image
     * (resetting every background layer). Use {@link clearBackground} to remove.
     *
     * @param value - A CSS `background` shorthand string.
     *
     * @returns This component, for method chaining.
     */
    setBackground(value: string): this {
        if (this._options.background === value) {
            return this;
        }

        this._options.background = value;
        this.setElementCSSRule("background", value);

        return this;
    }

    /**
     * Removes the `background` shorthand CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearBackground(): this {
        this._options.background = undefined;
        this.setElementCSSRule("background", null);

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
     * Sets the CSS `clip-path` on the component's own element — the box stays at
     * its full layout size while the painted (and hit-tested) area is clipped to
     * the given shape. Pass `null` to remove the clip. A layout manager can
     * transition this to visually collapse an element that refuses to shrink
     * below its min-size. Unlike {@link setClipFrame} this clips the element's
     * own box rather than interposing a wrapper, so a `clip-path` transition
     * animates in place.
     *
     * @param clipPath - A CSS `clip-path` value (e.g. `"inset(0 100% 0 0)"`), or `null` to clear.
     *
     * @returns This component, for method chaining.
     */
    setClipPath(clipPath: string | null): this {
        this.setElementCSSRule("clipPath", clipPath);

        return this;
    }

    /**
     * Returns the foreground (text) color, or null if inherited.
     *
     * @returns The CSS color string, or null if none is set.
     */
    getForegroundColor(): string | null {
        return "foregroundColor" in this._options ? (this._options.foregroundColor ?? null) : (this._defaultOptions.foregroundColor ?? null);
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
        // Set (not skip) the key so `getForegroundColor` sees an explicit clear
        // and returns null, suppressing a class-level default.
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
     * Returns the current border specification, or null if no border is set.
     *
     * @returns The current {@link BorderOptions}, or null.
     */
    getBorder(): BorderOptions | null {
        return this._border;
    }

    /**
     * Clears the component's border. Applies an explicit `none` on every side so
     * the cleared state overrides any inherited, class-level, or UA `<button>`
     * border styling, and invalidates the cached per-side widths.
     *
     * @returns This component, for method chaining.
     */
    clearBorder(): this {
        this._border       = { border: "none" };
        this._borderWidths = null;
        this.setElementCSSRules(borderToStyle(this._border));

        return this;
    }

    /**
     * Applies a border from a {@link BorderOptions} bag or a CSS `border` shorthand
     * string. A bare string is sugar for `{ border: <string> }`. The four CSS
     * longhands are written so a per-side value survives the {@link applyStyle}
     * replay; the cached per-side widths are invalidated and re-measured lazily at
     * layout time (see {@link getBorderSize}).
     *
     * @param options - Border configuration, or a CSS `border` shorthand string. Use {@link clearBorder} to clear the border explicitly.
     *
     * @returns This component, for method chaining.
     */
    setBorder(options: BorderOptions | string): this {
        this._border       = typeof options === "string" ? { border: options } : options;
        this._borderWidths = null;

        if (!this._borderThemeCleanup) {
            this._borderThemeCleanup = ThemeManager.onThemeChange(() => this._borderWidths = null);
        }

        this.setElementCSSRules(borderToStyle(this._border));

        return this;
    }

    /**
     * Returns the current CSS cursor value.
     *
     * @returns The CSS cursor string, or null if not set.
     */
    getCursor(): string | null {
        return "cursor" in this._options ? (this._options.cursor ?? null) : (this._defaultOptions.cursor ?? null);
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
        // Set (not skip) the key so `getCursor` sees an explicit clear and
        // returns null, suppressing the class default — distinct from the
        // never-set case where the key is absent and the default applies.
        this._options.cursor = undefined;
        this.setElementStyle("cursor", null);

        return this;
    }

    /**
     * Returns the CSS `touch-action` value, or null if not set.
     *
     * @returns The CSS `touch-action` string, or null.
     */
    getTouchAction(): string | null {
        return this._options.touchAction ?? null;
    }

    /**
     * Sets the CSS `touch-action` style on the element. Use
     * {@link clearTouchAction} to remove.
     *
     * @param touchAction - A CSS `touch-action` value (e.g. "none", "pan-y", "manipulation").
     *
     * @returns This component, for method chaining.
     */
    setTouchAction(touchAction: string): this {
        if (this._options.touchAction === touchAction) {
            return this;
        }
        this._options.touchAction = touchAction;
        this.setElementStyle("touchAction", touchAction);

        return this;
    }

    /**
     * Removes the inline `touch-action` style from the element.
     *
     * @returns This component, for method chaining.
     */
    clearTouchAction(): this {
        if (this._options.touchAction === undefined) {
            return this;
        }

        this._options.touchAction = undefined;
        this.setElementStyle("touchAction", null);

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
        return this._outline ?? this._defaultOptions.outline ?? null;
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
     * Returns this component's own preferred-size *constraint* — the
     * caller/setter value, else the class default — without consulting the
     * layout manager or current size. {@link getPreferredSize} layers those on
     * when no explicit constraint is set.
     *
     * @returns The constraint Size, or null when none is set.
     */
    getPreferredSizeConstraint(): Size | null {
        return (this._options.preferredSize ?? this._defaultOptions.preferredSize) ?? null;
    }

    /**
     * Returns the preferred size from the explicit override, layout manager, or current size.
     *
     * @returns The preferred Size, determined in priority order: explicit override, layout manager, then current size.
     */
    getPreferredSize(): Size | null {
        let layoutManager = this.getLayoutManager();
        let preferredSize;

        const ownPreferred = this.getPreferredSizeConstraint();
        if (ownPreferred) {
            preferredSize = ownPreferred;
        } else if (!layoutManager) {
            preferredSize = this.getSize();
        } else {
            preferredSize = layoutManager.getPreferredSize();
        }

        if (!preferredSize) {
            return null;
        }

        // Clamp against the component's *own* explicit constraints only — not the
        // merged {@link getMinSize} / {@link getMaxSize}. `getPreferredSize` is a
        // hot path in the layout-gathering recursion, and the merged maximum runs
        // {@link Grid.measureContent}, which itself calls children's
        // `getPreferredSize`; clamping to it here would make the recursion
        // re-entrant and exponential in tree depth. The merged `[min, max]`
        // envelope is enforced instead on the committed size, in
        // {@link clampWidth} / {@link clampHeight}.
        const ownMin = this.getMinSizeConstraint();
        const ownMax = this.getMaxSizeConstraint();

        return this.clampPreferredToConstraints(preferredSize, ownMin, ownMax);
    }

    /**
     * Clamps a resolved preferred size into the supplied `[min, max]` range on
     * each axis. `min` wins over a smaller `max` (a degenerate `min > max`
     * constraint) and over a smaller `preferred`, because the floor is applied
     * last among the pair — so an explicit minimum is always honoured.
     *
     * @param preferred - The resolved preferred size to clamp.
     * @param min - The minimum size to floor to, or null when unconstrained.
     * @param max - The maximum size to cap to, or null when unconstrained.
     *
     * @returns The preferred size clamped into `[min, max]` per axis.
     */
    private clampPreferredToConstraints(preferred: Size, min: Size | null, max: Size | null): Size {
        let width = preferred.width;
        let height = preferred.height;

        if (max) {
            width = Math.min(width, max.width);
            height = Math.min(height, max.height);
        }

        if (min) {
            width = Math.max(width, min.width);
            height = Math.max(height, min.height);
        }

        return {
            width: width,
            height: height
        };
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
        this.setDataAttribute("preferredSize", formatSizeAttr(next.width, next.height));
        this._onPreferredSizeChange?.();

        return this;
    }

    /**
     * Returns this component's own minimum-size *constraint* — the caller/setter
     * value, else the class default — without folding in the layout manager's
     * minimum. This is the raw author constraint written to CSS `min-*` and
     * clamped against; {@link getMinSize} layers the layout minimum on top.
     *
     * @returns The constraint Size, or null when none is set.
     */
    getMinSizeConstraint(): Size | null {
        return (this._options.minSize ?? this._defaultOptions.minSize) ?? null;
    }

    /**
     * Returns this component's own maximum-size *constraint* — the caller/setter
     * value, else the class default — without folding in the layout manager's
     * maximum. Companion to {@link getMinSizeConstraint}.
     *
     * @returns The constraint Size, or null when none is set.
     */
    getMaxSizeConstraint(): Size | null {
        return (this._options.maxSize ?? this._defaultOptions.maxSize) ?? null;
    }

    /**
     * Merges a component's own size *constraint* with its layout manager's size,
     * per axis, into a fresh {@link Size}. When both are present each axis is
     * combined with `merge` (the tighter bound: `Math.max` for minimums,
     * `Math.min` for maximums); when only one is present that source's values are
     * copied; when neither is present the axes fall back to `fallback`. Every
     * branch returns a new object, so callers never receive an alias of the
     * stored constraint or manager size.
     *
     * @param constraint - This component's own min/max size constraint, or null.
     * @param managerSize - The layout manager's reported min/max size, or null.
     * @param merge - The per-axis combiner applied when both sources are present.
     * @param fallback - The per-axis value used when neither source is present.
     * @returns The merged size as a fresh object.
     */
    private mergeConstraintSize(
        constraint: Size | null,
        managerSize: Size | null,
        merge: (a: number, b: number) => number,
        fallback: number,
    ): Size {
        if (constraint && managerSize) {
            return {
                width:  merge(constraint.width,  managerSize.width),
                height: merge(constraint.height, managerSize.height),
            };
        }

        if (constraint) {
            return { width: constraint.width, height: constraint.height };
        }

        if (managerSize) {
            return { width: managerSize.width, height: managerSize.height };
        }

        return { width: fallback, height: fallback };
    }

    /**
     * Returns the effective minimum size: the larger of the component and layout manager minimums.
     *
     * @returns A Size object whose width and height are the element-wise maximums of the component and layout manager minimums.
     */
    getMinSize(): Size | null {
        return this.mergeConstraintSize(this.getMinSizeConstraint(), this.getLayoutManager().getMinSize(), Math.max, 0);
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

        this.setDataAttribute("minSize", formatSizeAttr(next.width, next.height));

        this._onConstraintSizeChange?.();

        return this;
    }

    /**
     * Returns the effective maximum size: the *tighter* (smaller) of the
     * component's own maximum and its layout manager's maximum, per axis. A
     * component may exceed neither its own `setMaxSize` nor the ceiling its
     * layout manager imposes, so the binding constraint is the smaller of the
     * two — mirroring how {@link getMinSize} takes the larger (tighter) minimum.
     *
     * @returns A Size object whose width and height are the element-wise minimums of the component and layout manager maximums.
     */
    getMaxSize(): Size | null {
        return this.mergeConstraintSize(this.getMaxSizeConstraint(), this.getLayoutManager().getMaxSize(), Math.min, UNBOUNDED);
    }

    /**
     * Sets the maximum size and applies it to the CSS rule.
     *
     * @param width - The maximum width in pixels. Pass UNBOUNDED to remove the constraint.
     * @param height - The maximum height in pixels. Pass UNBOUNDED to remove the constraint.
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
            maxWidth:  isUnbounded(next.width)  ? "none" : next.width  + "px",
            maxHeight: isUnbounded(next.height) ? "none" : next.height + "px"
        });

        this.setDataAttribute("maxSize", formatSizeAttr(next.width, next.height));

        this._onConstraintSizeChange?.();

        return this;
    }

    /**
     * Returns the usable inner size: component size minus insets and border widths.
     *
     * @returns The inner Size in pixels, or null if the element is not yet in the DOM.
     */
    getInnerSize(): Size | null {
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
     * Returns the per-side pixel widths of the component's border. Once the element
     * is connected to the document the widths are browser-measured (so `var()`,
     * `none`, and keywords all resolve) and cached until the next
     * `setBorder`/`clearBorder` or theme change. Before the element is connected,
     * `getComputedStyle` can't resolve `var()` (the element doesn't yet inherit
     * from `:root`), so it falls back to an estimate from the spec strings that
     * resolves a leading `var(--name)` against `:root` directly. The estimate is
     * not cached, so it is re-measured authoritatively once the element connects.
     *
     * @returns A PerimeterSize with zero values on each side when no border is set.
     */
    getBorderSize(): PerimeterSize {
        if (!this._border) {
            return { top: 0, right: 0, bottom: 0, left: 0 };
        }

        if (this._borderWidths) {
            return this._borderWidths;
        }

        const element = this.getElement();

        if (element && DOM.source.isConnected(element)) {
            // Authoritative: getComputedStyle resolves var()/none/keywords to "<n>px"
            // once the element is in the document and inherits :root's custom props.
            const cs = DOM.source.getBorderWidths(element);

            this._borderWidths = {
                top:    borderSideWidth(cs.top),
                right:  borderSideWidth(cs.right),
                bottom: borderSideWidth(cs.bottom),
                left:   borderSideWidth(cs.left),
            };

            return this._borderWidths;
        }

        // Pre-attach estimate from the spec strings, resolving a leading var()
        // against :root so themed var-borders report their width before connect.
        const all = this._border.border;

        return {
            top:    this.estimateBorderSideWidth(this._border.borderTop    ?? all),
            right:  this.estimateBorderSideWidth(this._border.borderRight  ?? all),
            bottom: this.estimateBorderSideWidth(this._border.borderBottom ?? all),
            left:   this.estimateBorderSideWidth(this._border.borderLeft   ?? all),
        };
    }

    /**
     * Estimates one border side's pixel width before the element is connected.
     * A leading `<n>px` wins outright; otherwise a leading `var(--name)` is
     * resolved against `:root`'s custom properties (recursing into the resolved
     * value) so themed var-borders report a width pre-attach. Returns `0` when no
     * width can be determined.
     *
     * @param value - A single side's CSS border value, or `undefined`.
     *
     * @returns The estimated pixel width, or `0`.
     */
    private estimateBorderSideWidth(value: string | undefined): number {
        if (!value) {
            return 0;
        }

        const trimmed = value.trim();
        const direct  = borderSideWidth(trimmed);

        if (direct > 0) {
            return direct;
        }

        const varName = trimmed.match(/^var\(\s*(--[\w-]+)/)?.[1];

        if (varName) {
            const resolved = DOM.source.getThemeVar(varName);

            if (resolved) {
                return this.estimateBorderSideWidth(resolved);
            }
        }

        return 0;
    }

    /**
     * Returns the total per-side consumed space: insets plus border widths plus
     * CSS padding. These are the three bands between the component's outer box
     * and the content area a layout manager may fill, so `getInnerSize`
     * subtracts all of them and the size-hint paths add them back. CSS padding
     * is real layout space the browser reserves inside the (border-box) element,
     * so omitting it left a layout manager believing it had more room than the
     * content box actually offers — the surplus surfaced as content spilling
     * past the far inset (e.g. a `FieldSet`'s bottom inset).
     *
     * @returns A PerimeterSize where each side is the sum of the inset, border width, and padding for that side.
     */
    getPerimiterSize() {
        let borderSize = this.getBorderSize();
        let insets = this.getInsets();
        let padding = this.getPadding();

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

        if (padding) {
            perimiterSize.top += padding.getTop();
            perimiterSize.right += padding.getRight();
            perimiterSize.bottom += padding.getBottom();
            perimiterSize.left += padding.getLeft();
        }

        return perimiterSize;
    }

    /**
     * Returns the offset, in pixels, from the top of this component to its visual baseline.
     *
     * @returns The baseline offset in pixels, or `null` when this component has no
     * intrinsic baseline (e.g. graphical or non-text components).
     *
     * @remarks Subclasses with a meaningful baseline override this method,
     * typically composing an inner baseline with the component's own chrome via
     * `wrapInnerBaseline`. The default delegates to the layout manager's
     * {@link LayoutManager.getContentBaseline} so a plain container laid out by
     * a baseline-aware layout (e.g. an `HBox` of controls) aligns by its row's
     * baseline rather than auto-centring; non-baseline layouts return `null`.
     * Used by horizontal layouts to align children of mixed heights so their
     * text baselines coincide. Components that return `null` are treated as if
     * their bottom edge were the baseline (CSS replaced-element behaviour).
     */
    getBaseline(): number | null {
        const inner = this.getLayoutManager().getContentBaseline();

        return inner === null ? null : this.wrapInnerBaseline(inner);
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
     * `Util.measureTextBaseline()`). Centralises the chrome arithmetic that
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
        const width  = this.clampWidth(size.width);
        const height = this.clampHeight(size.height);

        this._width = width;
        this._height = height;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        this.setElementStyles({
            "width": width + "px",
            "height": height + "px"
        });

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the component's current width in pixels.
     *
     * @returns The width in pixels, or 0 if the size is unavailable.
     */
    getWidth(): number {
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
        width = this.clampWidth(width);

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
     * Whether {@link clampWidth} / {@link clampHeight} clamp the committed size to
     * the merged, layout-calculated {@link getMinSize} / {@link getMaxSize} — the
     * size derived from this component's children — or only to its own explicit
     * {@link setMinSize} / {@link setMaxSize}.
     *
     * The default is `true`: most components adhere to their content-derived
     * size, so they never collapse below what their children need to render.
     * {@link Container} overrides this to `false` (inherited by {@link Panel}) —
     * such a container fits whatever space its parent allocates and lets the
     * overflow clip (or scroll, on a `Panel` with `autoScroll` configured)
     * instead of inflating itself back up to its content size. Then only an
     * explicit {@link setMinSize} / {@link setMaxSize} remains a hard floor or
     * ceiling.
     *
     * @returns `true` to clamp to the merged constraints; `false` for the
     *   component's own explicit constraints only.
     */
    protected clampsToContentSize(): boolean {
        return true;
    }

    /**
     * Clamps a width value to this component's `[minSize.width, maxSize.width]`
     * range so {@link setWidth}, {@link setHeight}, and {@link setSize} cannot
     * drive `_width` / `_height` outside it. The bounding constraints are the
     * merged {@link getMinSize} / {@link getMaxSize} when
     * {@link clampsToContentSize} is `true` (the default — adhere to the
     * content-derived size), or the component's own explicit `_options` (or
     * default) constraints when it is `false` ({@link Container} / {@link Panel},
     * which fit their allocation).
     */
    private clampWidth(width: number): number {
        const toContent = this.clampsToContentSize();

        const maxSize = toContent ? this.getMaxSize() : (this.getMaxSizeConstraint());
        if (maxSize && width > maxSize.width) {
            width = maxSize.width;
        }

        const minSize = toContent ? this.getMinSize() : (this.getMinSizeConstraint());
        if (minSize && width < minSize.width) {
            width = minSize.width;
        }

        return width;
    }

    /**
     * Returns the component's current height in pixels.
     *
     * @returns The height in pixels, or 0 if the size is unavailable.
     */
    getHeight(): number {
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
        height = this.clampHeight(height);

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
     * Clamps a height value to this component's `[minSize.height,
     * maxSize.height]` range. Mirror of {@link clampWidth}; the bounding
     * constraints are the merged {@link getMinSize} / {@link getMaxSize} or the
     * component's own explicit constraints depending on
     * {@link clampsToContentSize}. See {@link clampWidth} for the rationale.
     */
    private clampHeight(height: number): number {
        const toContent = this.clampsToContentSize();

        const maxSize = toContent ? this.getMaxSize() : (this.getMaxSizeConstraint());
        if (maxSize && height > maxSize.height) {
            height = maxSize.height;
        }

        const minSize = toContent ? this.getMinSize() : (this.getMinSizeConstraint());
        if (minSize && height < minSize.height) {
            height = minSize.height;
        }

        return height;
    }

    /**
     * Returns the component's horizontal position (CSS left) in pixels.
     *
     * @returns The left offset in pixels.
     */
    getX(): number {
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
    getY(): number {
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
     * Returns the element's horizontal scroll offset from the cached value, so
     * reads never touch the DOM (mirroring {@link getX}). The cache is the value
     * last written through {@link setScrollLeft}; it is authoritative as long as
     * the scroll is driven through these setters (the host owns it — e.g. a `Tab`
     * strip's clip frame, which the browser never scrolls on its own).
     *
     * @returns The cached `scrollLeft` in pixels.
     */
    getScrollLeft(): number {
        return this._scrollLeft;
    }

    /**
     * Returns the element's cached vertical scroll offset. See {@link getScrollLeft}.
     *
     * @returns The cached `scrollTop` in pixels.
     */
    getScrollTop(): number {
        return this._scrollTop;
    }

    /**
     * Sets the element's native horizontal scroll offset and caches it for
     * {@link getScrollLeft}. The value is read back after the write so the cache
     * holds the browser-clamped result, not the raw request (clamped to
     * `[0, getMaxScrollLeft()]`).
     *
     * @param value - The desired `scrollLeft` in pixels.
     *
     * @returns This component, for method chaining.
     */
    setScrollLeft(value: number): this {
        this._wheelScroller?.reset();

        const element = this.getElement();

        if (element) {
            DOM.sink.apply(element, { scrollLeft: value });
            this._scrollLeft = DOM.source.getScrollLeft(element);
        } else {
            this._scrollLeft = value;
        }

        return this;
    }

    /**
     * Sets the element's native vertical scroll offset and caches it. See
     * {@link setScrollLeft}.
     *
     * @param value - The desired `scrollTop` in pixels.
     *
     * @returns This component, for method chaining.
     */
    setScrollTop(value: number): this {
        this._wheelScroller?.reset();

        const element = this.getElement();

        if (element) {
            DOM.sink.apply(element, { scrollTop: value });
            this._scrollTop = DOM.source.getScrollTop(element);
        } else {
            this._scrollTop = value;
        }

        return this;
    }

    /**
     * Re-reads the element's native scroll offsets into the cache that backs
     * {@link getScrollLeft} / {@link getScrollTop}. That cache is authoritative
     * only while the scroll is driven through {@link setScrollLeft} /
     * {@link setScrollTop}; the browser also clamps the native offset on its own
     * when the scrollable range shrinks (e.g. content laid out smaller than the
     * current offset), bypassing those setters and leaving the cache stale. Call
     * this after such a layout so the cache matches the DOM again.
     *
     * @returns This component, for method chaining.
     */
    syncScrollOffsets(): this {
        this._wheelScroller?.reset();

        const element = this.getElement();

        if (element) {
            this._scrollLeft = DOM.source.getScrollLeft(element);
            this._scrollTop = DOM.source.getScrollTop(element);
        }

        return this;
    }

    /**
     * Returns the maximum horizontal scroll offset — the content's overflow past
     * the element's viewport (`scrollWidth - clientWidth`).
     *
     * @returns The last-page `scrollLeft` in pixels, or 0 when nothing overflows.
     */
    getMaxScrollLeft(): number {
        const element = this.getElement();
        if (!element) {
            return 0;
        }

        const metrics = DOM.source.getScrollMetrics(element);

        return metrics.scrollWidth - metrics.clientWidth;
    }

    /**
     * Returns the maximum vertical scroll offset — the content's overflow past
     * the element's viewport (`scrollHeight - clientHeight`).
     *
     * @returns The last-page `scrollTop` in pixels, or 0 when nothing overflows.
     */
    getMaxScrollTop(): number {
        const element = this.getElement();
        if (!element) {
            return 0;
        }

        const metrics = DOM.source.getScrollMetrics(element);

        return metrics.scrollHeight - metrics.clientHeight;
    }

    /**
     * Returns the cached translate-X component of the element's `transform` (pixels).
     *
     * @returns The translate-X value last passed to setTranslate, or 0.
     */
    getTranslateX(): number {
        return this._translateX;
    }

    /**
     * Returns the cached translate-Y component of the element's `transform` (pixels).
     *
     * @returns The translate-Y value last passed to setTranslate, or 0.
     */
    getTranslateY(): number {
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
     * @returns The current Position value; defaults to `Position.ABSOLUTE`.
     *
     * @remarks Position is framework-internal — see [`setPosition`](/api/core/classes/Component#setposition).
     * Application code never needs to read or set it.
     */
    protected getPosition(): Position {
        return this._position;
    }

    /**
     * Framework-internal CSS position setter. Application code should NOT
     * call this — every framework component is positioned absolutely, and
     * layout managers compute child coordinates against the parent's padding
     * box on that assumption. See [ARCHITECTURE.md](/ARCHITECTURE.md)
     * §Positioning for the rationale.
     *
     * Subclasses MAY call this with [`Position.FIXED`](/api/primitive/enums/Position#FIXED)
     * when they are floating overlays anchored to the viewport
     * ([`AnimatedDropdown`](/api/core/classes/AnimatedDropdown),
     * [`Popover`](/api/overlay/classes/Popover), [`Notification`](/api/overlay/classes/Notification),
     * [`Dialog`](/api/overlay/classes/Dialog), [`DialogBackdrop`](/api/core/classes/DialogBackdrop))
     * or with [`Position.STATIC`](/api/primitive/enums/Position#STATIC) when
     * the element's HTML semantics require in-flow rendering
     * ([`Legend`](/api/component/container/classes/Legend) needs the notch in
     * the parent fieldset border).
     *
     * @param position - The CSS position mode to apply.
     *
     * @returns This component, for method chaining.
     */
    protected setPosition(position: Position): this {
        this._position = position;

        this.setElementCSSRule("position", position);

        return this;
    }


    /**
     * Restores the framework default (`Position.ABSOLUTE`). Framework-internal
     * companion to [`setPosition`](/api/core/classes/Component#setposition) —
     * application code does not need this.
     *
     * @returns This component, for method chaining.
     */
    protected clearPosition(): this {
        return this.setPosition(Position.ABSOLUTE);
    }

    /**
     * Returns the CSS overflow value when both axes agree, or null otherwise.
     *
     * @returns The shared overflow string, or null if the axes diverge or are unset.
     */
    getOverflow(): string | null {
        const overflowX = this.getOverflowX();
        const overflowY = this.getOverflowY();

        return overflowX !== null && overflowX === overflowY ? overflowX : null;
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
        return this._overflowX ?? this._defaultOptions.overflow ?? null;
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
        this.refreshWheelScrolling();

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
        this.refreshWheelScrolling();

        return this;
    }

    /**
     * Returns the CSS overflow-y value, or null if not set.
     *
     * @returns The CSS overflow-y string, or null.
     */
    getOverflowY(): string | null {
        return this._overflowY ?? this._defaultOptions.overflow ?? null;
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
        this.refreshWheelScrolling();

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
        this.refreshWheelScrolling();

        return this;
    }

    /**
     * Returns whether a CSS overflow value lets the browser scroll the axis —
     * i.e. `auto` or `scroll`.
     *
     * @param overflow - The per-axis overflow value, or null.
     *
     * @returns `true` when the axis is scrollable.
     */
    private isOverflowScrollable(overflow: string | null): boolean {
        return overflow === "auto" || overflow === "scroll";
    }

    /**
     * Lazily attaches the eased wheel-scroll controller when either overflow
     * axis becomes scrollable, and tears it down when neither does. Called from
     * every overflow setter/clearer; because Panel `autoScroll` routes through
     * those, this single hook covers `autoScroll` panels and direct
     * `setOverflow("auto")` users alike.
     */
    private refreshWheelScrolling(): void {
        const scrollable = this.isOverflowScrollable(this.getOverflowX())
                        || this.isOverflowScrollable(this.getOverflowY());

        if (scrollable && !this._wheelScroller) {
            this.attachWheelScrolling();
        } else if (!scrollable && this._wheelScroller) {
            this.detachWheelScrolling();
        }
    }

    /**
     * Builds the {@link SmoothScroller} over the element's native scroll offsets
     * and registers the non-passive subtree wheel listener that feeds it.
     *
     * @remarks Subtree because wheel fires on whichever descendant the pointer
     * is over, not the scroll container itself; `passive: false` so
     * {@link onWheelScroll} can `preventDefault` the native page scroll.
     */
    private attachWheelScrolling(): void {
        this._wheelScroller = new SmoothScroller({
            read:  (axis) => {
                const element = this.getElement();

                return element ? (axis === "x" ? DOM.source.getScrollLeft(element) : DOM.source.getScrollTop(element)) : 0;
            },
            write: (axis, value) => this.writeNativeScroll(axis, value),
            clamp: (axis, value) => Util.clamp(value, 0, axis === "x" ? this.getMaxScrollLeft() : this.getMaxScrollTop()),
        });

        Event.addSubtreeListener(this, "wheel", this.onWheelScroll, { passive: false });
    }

    /**
     * Removes the wheel listener, cancels any in-flight ease, and drops the
     * controller once neither axis is scrollable.
     */
    private detachWheelScrolling(): void {
        Event.removeSubtreeListener(this, "wheel", this.onWheelScroll);
        this._wheelScroller?.reset();
        this._wheelScroller = null;
    }

    /**
     * Writes a native scroll offset for one axis and mirrors the browser-clamped
     * result into the {@link getScrollLeft} / {@link getScrollTop} cache, holding
     * the cache invariant the eased wheel loop would otherwise bypass.
     *
     * @param axis - The axis to write.
     * @param value - The new offset in pixels.
     */
    private writeNativeScroll(axis: ScrollAxis, value: number): void {
        const element = this.getElement();
        if (!element) {
            return;
        }

        if (axis === "x") {
            DOM.sink.apply(element, { scrollLeft: value });
            this._scrollLeft = DOM.source.getScrollLeft(element);
        } else {
            DOM.sink.apply(element, { scrollTop: value });
            this._scrollTop = DOM.source.getScrollTop(element);
        }
    }

    /**
     * Eases a wheel gesture into the element's native scroll offset. Only a
     * scrollable axis receives delta, and shift+wheel with a bare vertical delta
     * is redirected to horizontal.
     *
     * @param e - The wheel event.
     */
    private onWheelScroll(e: WheelEvent): void {
        const canX = this.isOverflowScrollable(this.getOverflowX());
        const canY = this.isOverflowScrollable(this.getOverflowY());

        let dx = canX ? e.deltaX : 0;
        let dy = canY ? e.deltaY : 0;

        if (e.shiftKey && canX && e.deltaY !== 0 && e.deltaX === 0) {
            dx = e.deltaY;
            dy = 0;
        }

        if (dx === 0 && dy === 0) {
            return;
        }

        if (!consumeWheel(e)) {
            return;
        }

        e.preventDefault();
        this._wheelScroller?.scrollBy(dx, dy);
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
     * Returns the current CSS `transition` shorthand, or `null` if none has
     * been set.
     *
     * @returns The cached transition value, or null.
     */
    getTransition(): string | null {
        return this._transition;
    }

    /**
     * Sets the CSS `transition` shorthand on the component's CSS rule. Use
     * this to declare a property-by-property crossfade ahead of state writes
     * (e.g. setting a `transition: background-color 120ms ease-out` rule and
     * then later calling `setBackgroundColor` to fire the crossfade).
     *
     * @param value - A CSS transition shorthand (e.g. `"transform 120ms ease-out"`).
     *
     * @returns This component, for method chaining.
     */
    setTransition(value: string | null): this {
        if (this._transition === value) {
            return this;
        }

        this._transition = value;
        this.setElementCSSRule("transition", value);

        return this;
    }

    /**
     * Removes the CSS `transition` property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearTransition(): this {
        if (this._transition === null) {
            return this;
        }

        this._transition = null;
        this.setElementCSSRule("transition", null);

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
        return this._options.pointerEvents ?? this._defaultOptions.pointerEvents ?? null;
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
     * Returns the inline `writing-mode` value last passed to
     * {@link setWritingMode}, or `null` if not set.
     *
     * @returns The writing-mode string, or null.
     */
    getWritingMode(): string | null {
        return this._options.writingMode ?? this._defaultOptions.writingMode ?? null;
    }

    /**
     * Sets the CSS `writing-mode` property on the element. Unlike a
     * `transform: rotate`, `writing-mode` rotates the element's *layout box*,
     * so `getBoundingClientRect` reports the rotated width/height — used by the
     * vertical tab strip so measurement and hit-testing stay correct.
     *
     * @param value - A CSS writing-mode value (e.g. "vertical-rl", "vertical-lr").
     *
     * @returns This component, for method chaining.
     */
    setWritingMode(value: string): this {
        this._options.writingMode = value;

        this.setElementStyle("writingMode", value);

        return this;
    }

    /**
     * Removes the inline `writing-mode` property from the element, restoring the
     * default horizontal text flow.
     *
     * @returns This component, for method chaining.
     */
    clearWritingMode(): this {
        if (this._options.writingMode === undefined) {
            return this;
        }

        this._options.writingMode = undefined;
        this.setElementStyle("writingMode", null);

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
     * @param preventScroll - When `true`, suppresses the browser's
     *   scroll-the-focused-element-into-view behaviour. Set this when the host
     *   manages its own scroll offset (e.g. the [`Tab`](/api/layout/classes/Tab)
     *   strip owns its clip frame's native scroll explicitly, so a browser
     *   focus-scroll of that `overflow:hidden` frame would fight it and silently
     *   desync the strip's scroll bookkeeping).
     *
     * @returns This component, for method chaining.
     */
    focus(preventScroll: boolean = false): this {
        let element = this.getElement();
        if (!element) {
            //console.warn("Component #" + this.id + " is not yet in the DOM, unable to focus.");
            return this;
        }

        DOM.sink.focus(element, { preventScroll });

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

        DOM.sink.blur(element);

        return this;
    }

    /**
     * Writes all current style properties to the given element and its associated CSS rule.
     *
     * @param element - The element handle to apply styles to.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Clears all existing inline styles on the element before re-applying, ensuring a clean state.
     */
    applyStyle(element: Handle): this {
        DOM.sink.apply(element, { removeAttr: ["style"] });

        // Materialise the stylesheet rule once so subsequent `_styleRule.set`
        // calls write through directly (rather than queueing into the dirty
        // bag). The returned rule isn't referenced — every write below routes
        // through the StyleRule buffer, the architectural seam over
        // `CSSStyleRule.style`.
        this.ensureCSSRule();

        this.applyBoxAndVisibilityStyles();
        this.replayGeometryStyles();
        this.applySizeConstraintStyles();
        this.applyOverflowStyles();
        this.applyChromeStyles();
        this.applyMiscInlineStyles();
        this.materialiseDeferredRules();

        return this;
    }

    /**
     * Writes the box-model, visibility, display, cursor, and colour styles — the
     * first `applyStyle` phase.
     */
    private applyBoxAndVisibilityStyles(): void {
        // Every option-backed read below goes through the field's getter (or an
        // inline `_options.X ?? _defaultOptions.X` for the carve-out sizes), so
        // class-level defaults reach the DOM even when no setter has fired —
        // the getter owns the fallback; there is no merged bag to drift from.
        if (this._boxSizing) {
            this._styleRule.set("boxSizing", this._boxSizing);
        }

        this._styleRule.set("position", this._position);

        const visible = this.isVisible();
        if (visible != null) {
            // `true` resolves to `inherit`, not `visible`, so an explicitly-shown
            // component still hides when an ancestor hides (e.g. a Tab panel that
            // is switched away). This mirrors the live `setVisible` setter, which
            // also writes `inherit` for `true`; writing `visible` here would pin
            // the element on screen and defeat ancestor-based hiding.
            this._styleRule.set("visibility", visible ? "inherit" : "hidden");
        } else {
            this._styleRule.set("visibility", "inherit");
        }

        const displayed = this.isDisplayed();
        if (displayed != null) {
            this._styleRule.set("display", displayed ? "block" : "none");
        }

        const cursor = this.getCursor();
        if (cursor) {
            this._styleRule.set("cursor", cursor);
        }

        const foregroundColor = this.getForegroundColor();
        if (foregroundColor) {
            this._styleRule.set("color", foregroundColor);
        }

        const backgroundColor = this.getBackgroundColor();
        if (backgroundColor) {
            this._styleRule.set("backgroundColor", backgroundColor);
        }

        const backgroundImage = this.getBackgroundImage();
        if (backgroundImage) {
            this._styleRule.set("backgroundImage", backgroundImage);
        }
    }

    /**
     * Replays the cached width / top / left / height and translate transform that
     * the leading inline-style wipe cleared — the second `applyStyle` phase.
     */
    private replayGeometryStyles(): void {
        // NaN means "never assigned by a setter" — skip the DOM write for those.
        // Any finite value (including 0) MUST be written so the DOM matches the cached field.
        if (!Number.isNaN(this._width)) {
            this._inlineStyle.set("width", this._width + "px");
        }

        if (!Number.isNaN(this._top)) {
            this._inlineStyle.set("top", this._top + "px");
        }

        if (!Number.isNaN(this._left)) {
            this._inlineStyle.set("left", this._left + "px");
        }

        if (!Number.isNaN(this._height)) {
            this._inlineStyle.set("height", this._height + "px");
        }

        // Replay the cached translate so a `setTranslate`'d transform survives
        // the inline-style wipe above, the same way width/top/left/height are
        // replayed. Skipped at the (0,0) default so components that drive
        // `transform` through `setElementCSSRule` (rotation) are left untouched.
        if (this._translateX !== 0 || this._translateY !== 0) {
            this._inlineStyle.set("transform", "translate3d(" + this._translateX + "px," + this._translateY + "px,0)");
        }
    }

    /**
     * Writes the min/max CSS constraints and reflects `data-maxSize` — the third
     * `applyStyle` phase.
     */
    private applySizeConstraintStyles(): void {
        // Carve-out: the CSS min/max writes use the raw author *constraint*, not
        // the computed `getMinSize()`/`getMaxSize()` (which fold in the layout
        // manager and would push computed sizes into CSS, fighting the layout
        // engine). Read the option/default directly, never via the getter.
        const minSize = this.getMinSizeConstraint();
        if (minSize) {
            this._styleRule.set("minWidth",  minSize.width  + "px");
            this._styleRule.set("minHeight", minSize.height + "px");
        }

        const maxSize = this.getMaxSizeConstraint();
        if (maxSize) {
            this._styleRule.set("maxWidth",  isUnbounded(maxSize.width)  ? "none" : maxSize.width  + "px");
            this._styleRule.set("maxHeight", isUnbounded(maxSize.height) ? "none" : maxSize.height + "px");
            this.setDataAttribute("maxSize", formatSizeAttr(maxSize.width, maxSize.height));
        }
    }

    /**
     * Writes the overflow styles and refreshes the wheel-scroll controller — the
     * fourth `applyStyle` phase.
     */
    private applyOverflowStyles(): void {
        const overflowX = this.getOverflowX();
        if (overflowX !== null) {
            this._styleRule.set("overflowX", overflowX);
        }
        const overflowY = this.getOverflowY();
        if (overflowY !== null) {
            this._styleRule.set("overflowY", overflowY);
        }

        // A scrollable *default* overflow (e.g. Drawer's `"auto"`) no longer
        // dispatches `setOverflow` through `applyOptions`, so attach the eased
        // wheel-scroll controller here from the effective overflow. Idempotent:
        // `refreshWheelScrolling` no-ops when the scroller already matches.
        this.refreshWheelScrolling();
    }

    /**
     * Writes the border, outline, border-radius, and box-shadow chrome styles —
     * the fifth `applyStyle` phase.
     */
    private applyChromeStyles(): void {
        if (this._border) {
            this._styleRule.setMany(borderToStyle(this._border));
        } else {
            this._styleRule.set("border", null);
        }

        const outline = this.getOutline();
        if (outline) {
            this._styleRule.set("outline", outline);
        }

        const borderRadius = this.getBorderRadius();
        if (borderRadius) {
            this._styleRule.set("borderRadius", borderRadius);
        }

        const shadow = this.getShadow();
        if (shadow) {
            this._styleRule.set("boxShadow", shadow);
        }
    }

    /**
     * Writes the remaining inline and rule styles (white-space, pointer-events,
     * writing-mode, z-index, transition, opacity, user-select, padding, insets,
     * margin) — the sixth `applyStyle` phase.
     */
    private applyMiscInlineStyles(): void {
        if (this._whiteSpace) {
            this._styleRule.set("whiteSpace", this._whiteSpace);
        }

        const pointerEvents = this.getPointerEvents();
        if (pointerEvents) {
            this._inlineStyle.set("pointerEvents", pointerEvents);
        }

        const writingMode = this.getWritingMode();
        if (writingMode) {
            this._inlineStyle.set("writingMode", writingMode);
        }

        const zIndex = this.getZIndex();
        if (zIndex) {
            this._inlineStyle.set("zIndex", String(zIndex));
        }

        // Replay the cached transition so setters that fired before init
        // (e.g. accordion section setup) survive the `removeAttribute("style")`
        // wipe a few lines above. Inline rather than CSS-rule so callers can
        // freely overwrite per-instance (the height transition wouldn't make
        // sense at the class-rule level).
        if (this._transition !== null) {
            this._inlineStyle.set("transition", this._transition);
        }

        if (this._opacity !== null) {
            this._inlineStyle.set("opacity", String(this._opacity));
        }

        if (this._userSelect) {
            this._styleRule.set("userSelect", this._userSelect);
        }

        const padding = this.getPadding();
        if (padding) {
            this._styleRule.set("padding", padding.render());
        }

        const insets = this.getInsets();
        if (insets) {
            this.setDataAttribute("insets", insets.render());
        }

        this._styleRule.set("margin", "0px 0px 0px 0px");
    }

    /**
     * Materialises the deferred subclass state rules onto the live stylesheet —
     * the final `applyStyle` phase.
     */
    private materialiseDeferredRules(): void {
        // Materialise state-specific rules registered by subclasses (Button's
        // `:active` / `:hover`, ToggleButton's `.selected`). Each rule's
        // pending writes flush onto the live `CSSStyleRule` inside `ensure()`,
        // so the stylesheet picks up the entry on first render rather than on
        // first setter write during construction.
        for (const deferredRule of this._deferredStyleRules.values()) {
            deferredRule.ensure();
        }
    }

    /**
     * Re-applies all styles to the existing DOM element, syncing state after external changes.
     */
    sync() {
        let element = DOM.source.getElementById(this.getId());
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
     * Wires a child into this container's size-change propagation: adopts it as
     * the child's parent and installs the two callback slots that relay a
     * child's preferred-size / constraint-size change up to this container (which
     * re-lays-out and relays onward to its own parent). The teardown counterpart
     * is `unwireChild`.
     *
     * @param component - The child being attached to this container.
     */
    private wireChild(component: Component): void {
        component._parent = this;
        component._onPreferredSizeChange = () => {
            this.scheduleLayout();

            this._onPreferredSizeChange?.();
        };
        component._onConstraintSizeChange = () => {
            this.scheduleLayout();

            this._onConstraintSizeChange?.();
        };
    }

    /**
     * Tears down a child wired by `wireChild`: releases its layout constraints,
     * nulls both size-change callback slots (so a detached child can no longer
     * re-enter this container's layout), clears its parent, and removes its
     * element. Shared by `removeComponent` and `removeAllComponents`.
     *
     * @param component - The child being detached from this container.
     * @returns The layout constraints that were registered for the child, or undefined.
     */
    private unwireChild(component: Component): LayoutConstraints | undefined {
        const constraints = this.delLayoutConstraints(component);

        component._parent = null;
        component._onPreferredSizeChange = null;
        component._onConstraintSizeChange = null;
        component.removeElement();

        return constraints ?? undefined;
    }

    /**
     * Adds a child component, appends its element, wires preferred-size change propagation, and triggers layout.
     *
     * @param component - The child component to add.
     * @param constraints - Optional. Layout constraints to pass to the layout manager.
     */
    addComponent(component: Component, constraints?: LayoutConstraints): this {
        return this.insertComponent(component, this._components.length, constraints);
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

        const clampedIndex = Util.clamp(index, 0, this._components.length);
        this._components.splice(clampedIndex, 0, component);

        this.setLayoutConstraints(component, constraints);

        this.wireChild(component);

        let element = this.getElement();
        if (!element) {
            return this;
        }

        let compElement = component.getElement(true);
        // Reference the following sibling's attach node, not its element: a
        // clip-framed sibling sits inside its frame, so `insertBefore` against
        // its bare element (no longer a direct child of this container) would
        // throw. `getAttachNode` resolves to the frame when one is active.
        const nextSibling = clampedIndex + 1 < this._components.length
            ? this._components[clampedIndex + 1].getAttachNode()
            : null;
        const host = this.getChildHost();

        if (host) {
            DOM.sink.insertBefore(host, compElement!, nextSibling ?? null);
        }

        this.scheduleLayout();
        // See addComponent: propagate the container's own preferred-size change up
        // so an ancestor that sizes to this container tracks the inserted child.
        this._onPreferredSizeChange?.();

        return this;
    }

    /**
     * Atomically moves a child from its current parent (if any) to this container, at an optional
     * index, in a single call.
     *
     * Detaches `child` from its present parent and attaches it here, expressed entirely through the
     * existing {@link removeComponent} / {@link insertComponent} mutators, so subclass overrides of
     * those methods are honoured and the `already has a parent` guard stays armed for the genuine
     * two-parents error. When `index` is omitted the child is appended (mirroring
     * {@link addComponent}); when supplied it is clamped to `[0, children.length]`.
     *
     * @param child - The component to move into this container.
     * @param index - Optional. Zero-based destination index. Omitted appends; values outside
     *   `[0, children.length]` are clamped.
     * @param constraints - Optional. Layout constraints for the destination. When omitted, the
     *   constraints held by the old parent are carried across.
     *
     * @returns This component, for method chaining.
     *
     * @remarks
     * Both the source and destination containers schedule a layout, because `removeComponent` and
     * `insertComponent` each call `scheduleLayout`; the two schedules collapse to a single
     * `requestAnimationFrame` flush. The child's DOM element is detached from the old parent and
     * re-attached under this container, so any in-flight CSS transition on the element or its
     * descendants is reset by the move. Constraints are carried from the old parent by default but
     * an explicit `constraints` argument always wins — carrying an old layout manager's constraints
     * into an incompatible new manager (e.g. a [`LayoutConstraints`](/api/layout/classes/LayoutConstraints)
     * shaped for a different region) is the caller's responsibility. Moving into a container whose
     * `addComponent` / `removeComponent` narrow the accepted child type is likewise the caller's
     * responsibility, as this base-class primitive accepts any {@link Component}.
     */
    moveComponent(child: Component, index?: number, constraints?: LayoutConstraints): this {
        const oldParent = child.getParentComponent();

        // True no-op: already here and no reorder requested.
        if (oldParent === this && index === undefined) {
            return this;
        }

        // Detach from the present parent, capturing its layout constraints so they can be carried
        // unless the caller overrides them. removeComponent clears child._parent to null, which
        // satisfies insertComponent's parent guard and disarms its same-parent early-return, so an
        // intra-parent reorder is honoured rather than silently dropped.
        const carried = oldParent ? oldParent.removeComponent(child) : undefined;

        // Computed after removeComponent has spliced child out, so the append index reflects the
        // post-detach length in the same-parent reorder case.
        const targetIndex = index ?? this._components.length;

        this.insertComponent(child, targetIndex, constraints ?? carried ?? undefined);

        return this;
    }

    /**
     * Removes a child component, detaches its element, and triggers layout.
     *
     * @param component - The Component instance to remove.
     *
     * @returns The layout constraints that were registered for the removed component, or undefined.
     */
    removeComponent(component: Component): LayoutConstraints | undefined {
        let index = this._components.indexOf(component);

        if (index > -1) {
            this._components.splice(index, 1);
        }

        const constraints = this.unwireChild(component);

        this.scheduleLayout();
        // See addComponent: losing a child changes this container's own preferred
        // size, so notify the parent to relayout and re-measure.
        this._onPreferredSizeChange?.();

        return constraints;
    }

    /**
     * Removes all child components and their DOM elements without triggering layout.
     *
     * @returns This component, for method chaining.
     */
    removeAllComponents(): this {
        for (const component of this._components) {
            this.unwireChild(component);
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
     * Returns the child components that participate in layout: `getComponents`
     * filtered to those whose `isDisplayed` is `true`. Layout managers that
     * size or place children iterate this rather than `getComponents()`, so a
     * `display: none` child reserves no space. The general `getComponents()`
     * accessor is unchanged and still returns *all* children for serialization,
     * teardown, event delegation, and DOM mounting.
     *
     * @returns The displayed child components, in order.
     */
    getLaidOutComponents(): Component[] {
        return this._components.filter(component => component.isDisplayed());
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
        const layoutManager = (this._options.layoutManager ?? this._defaultOptions.layoutManager) as LayoutManager;

        // The class-level default manager is no longer dispatched through
        // `setLayoutManager`, so attach it lazily the first time it is
        // resolved. Layout consumers read the container back via
        // `getContainer()`; without this they would see `null`. The `!== this`
        // guard makes it fire exactly once and leaves the explicitly-set path
        // (which already attached in `setLayoutManager`) untouched. Mirror that
        // path's `data-layout` attribute so a default-layout component still
        // advertises its manager to DevTools.
        if (layoutManager && layoutManager.getContainer() !== this) {
            layoutManager.attach(this);
            this.setDataAttribute("layout", layoutManager.getClassName().replace(/^_/, ""));
        }

        return layoutManager;
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

        // `callable()`-wrapped classes report their underscored alias
        // (`_HBox`) through `constructor.name`; strip the leading underscore
        // so DevTools shows `data-layout="HBox"` rather than `_HBox`.
        this.setDataAttribute("layout", layoutManager.getClassName().replace(/^_/, ""));

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
        // Lay out only displayed children — a `display: none` subtree takes no
        // space, so recursing into it is wasted work and leaves stale committed
        // coordinates that `reserveContentFrame` would otherwise read.
        let components = this.getLaidOutComponents();

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
        this.runFirstLayoutCallbacks();

        return this;
    }

    /**
     * Runs a callback once, the first time this component completes a layout
     * while its element is connected to the document — a per-instance "mounted
     * and sized" signal.
     *
     * A component's content is built before its host attaches it (a dock tab's
     * panel, an accordion section's body), so on the tick that builds it the
     * element may not exist yet and its geometry is unknown. Polling
     * `requestAnimationFrame` until `getElement()` appears is the workaround this
     * replaces: the host schedules a layout when it mounts the component, and
     * this fires right after that first connected layout — the element exists and
     * has been sized, so focus, measurement, or seeding can act on it.
     *
     * If the component has already laid out connected when called, the callback
     * is deferred to the next layout flush (via {@link afterNextLayout}) rather
     * than run synchronously, so callers see one consistent asynchronous
     * contract. Unlike the static `afterNextLayout`, this waits for *this*
     * component specifically, so it is safe to register before the host mounts it.
     *
     * @param callback - The work to run once after the first connected layout.
     *
     * @returns This component, for method chaining.
     */
    onFirstLayout(callback: () => void): this {
        const element = this.getElement();

        if (element && DOM.source.isConnected(element)) {
            Component.afterNextLayout(callback);

            return this;
        }

        (this._firstLayoutCallbacks ??= []).push(callback);
        // Ensure a layout will occur to drive the drain even if nothing else
        // schedules one; if the component is still detached when it runs, the
        // drain is skipped and waits for the host's mount-time layout.
        this.scheduleLayout();

        return this;
    }

    /**
     * Drains the {@link onFirstLayout} queue once this component has laid out
     * while connected. A layout that runs on a still-detached component (laid out
     * in a subtree before its host attaches it) leaves the queue intact to fire
     * on the connected layout that follows.
     */
    private runFirstLayoutCallbacks(): void {
        if (!this._firstLayoutCallbacks) {
            return;
        }

        const element = this.getElement();

        if (!element || !DOM.source.isConnected(element)) {
            return;
        }

        const callbacks = this._firstLayoutCallbacks;
        this._firstLayoutCallbacks = null;

        for (const callback of callbacks) {
            callback();
        }
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
        ensureFlushScheduled();

        return this;
    }

    /**
     * Runs a callback once, after the next batched layout flush completes.
     *
     * Layout is coalesced onto an animation frame (see {@link scheduleLayout}),
     * so geometry a consumer has just triggered — revealing a view, opening an
     * {@link Accordion} section, adding rows — is not yet final on the
     * synchronous tick that triggered it. Deferring work here runs it past that
     * flush, once every dirty component has laid out, so it observes the settled
     * tree. The canonical case is moving focus into a freshly laid-out element:
     * a bare `requestAnimationFrame` only races the flush, whereas this follows
     * it deterministically.
     *
     * The callback fires on the same frame as an already-pending flush, or on
     * the next frame when nothing is scheduled; either way after every
     * `doLayout`. A callback that itself calls `afterNextLayout` queues the new
     * work for the following frame, not re-entrantly within this drain.
     *
     * @param callback - The work to run once after the next layout flush.
     */
    static afterNextLayout(callback: () => void): void {
        afterLayoutCallbacks.push(callback);
        ensureFlushScheduled();
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
     * Registers a `mousedown` event listener on this component. Named
     * accessor that lets cross-bucket consumers (e.g.
     * [`DragManager`](/api/overlay/variables/DragManager)) route through the
     * component instead of reaching for
     * `Event.addListener(component, "mousedown", ...)` directly — the
     * framework's "components own their event surface" rule
     * (`ARCHITECTURE.md` §Event handling).
     *
     * @param listener - The callback invoked with the originating MouseEvent.
     *
     * @returns This component, for method chaining.
     */
    addMouseDownListener(listener: Function): this {
        Event.addListener(this, "mousedown", listener);

        return this;
    }

    /**
     * Removes a previously registered mousedown listener.
     *
     * @param listener - The exact callback reference passed to {@link addMouseDownListener}.
     *
     * @returns This component, for method chaining.
     */
    removeMouseDownListener(listener: Function): this {
        Event.removeListener(this, "mousedown", listener);

        return this;
    }

    /**
     * Registers a subtree `mousedown` listener — the handler fires
     * whenever a mousedown lands on this component **or any of its
     * descendants**. Used by
     * [`DragManager`](/api/overlay/variables/DragManager) so a press
     * anywhere on a complex source (e.g. a `Row` whose cells receive
     * the actual mousedown) starts the drag.
     *
     * @param listener - The callback invoked with the originating MouseEvent.
     *
     * @returns This component, for method chaining.
     */
    addMouseDownSubtreeListener(listener: Function): this {
        Event.addSubtreeListener(this, "mousedown", listener);

        return this;
    }

    /**
     * Removes a previously registered subtree mousedown listener.
     *
     * @param listener - The exact callback reference passed to
     *   {@link addMouseDownSubtreeListener}.
     *
     * @returns This component, for method chaining.
     */
    removeMouseDownSubtreeListener(listener: Function): this {
        Event.removeSubtreeListener(this, "mousedown", listener);

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
    protected init(element?: Handle): this {
        element = element || this.getElement();
        if (!element) {
            throw new Error("Component has not been rendered!");
        }

        DOM.sink.setId(element, this.getId());
        DOM.sink.apply(element, { addClass: [this.constructor.name] });

        // Bind the inline-style buffer so any writes queued during detached
        // construction flush into the live element, and subsequent setters
        // write through directly.
        this._inlineStyle.attach(element);

        // `for…in` walks own enumerable property names. A `Map` has no own
        // enumerable properties (its entries live behind its public API), so
        // the prior `for (let key in this._attributes)` form silently iterated
        // nothing — every attribute cached during detached construction was
        // dropped at render time. Use the `Map` iterator directly.
        const setAttr: Record<string, string> = {};

        for (const [key, value] of this._attributes) {
            if (value != null) {
                setAttr[key.valueOf()] = value.valueOf();
            }
        }

        if (this._disabledAttribute) {
            setAttr.disabled = "";
        }

        if (this._options.attributes) {
            for (const key of Object.keys(this._options.attributes)) {
                setAttr[key] = this._options.attributes[key];
            }
        }

        DOM.sink.apply(element, { setAttr });

        this._aria?.applyToElement(element);

        this.applyStyle(element);

        let components = this.getComponents();
        for (let i in components) {
            let component = components[i];
            let compElement = component.getElement(true);

            DOM.sink.appendChild(element, compElement!);
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
     * @returns The newly created root element handle.
     */
    protected createRootElement(): Handle {
        return DOM.sink.createElement(this._tag);
    }

    /**
     * Creates the DOM element from the tag name and initializes it via init().
     *
     * @returns The newly created and initialised element handle.
     */
    protected render(): Handle {
        let element = this.createRootElement();

        this.trackHandle(element);
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

