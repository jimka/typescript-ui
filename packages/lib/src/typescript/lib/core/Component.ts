// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "~/layout/LayoutManager.js";
import { Absolute } from "~/layout/Absolute.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { isFirstLayoutHeld, startFirstLayoutDeadline } from "~/core/FirstLayoutGate.js";
import { BorderOptions, borderSideWidth } from "~/primitive/Border.js";
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
import { StyleRule, InlineStyle, disposeStyleRule } from "~/core/StyleTarget.js";
import { Diagnostics } from "~/core/Diagnostics.js";
import { ElementAttributes } from "~/core/ElementAttributes.js";
import { ThemeManager } from "~/core/Theme.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import { resolveClassDefaults } from "~/core/ComponentDefaults.js";
import { COMPONENT_CLASS, ensureClassStateRule, ensureClassStyleRule, ensureStyleGroupRule, ensureTraitStyleRule, getStyleClassChain, registerStyleChainRoot, resolveDeclarations, resolvePartialDeclarations, resolveStyleStates, resolveStyleTraits, resolveTraitStyleDefaults, restingGuardSuffix, styleGroupClassSuffix, traitClassName, traitTopStateConflictKeys, type StyleBag, type StyleLayer, type StyleStateSpec, type StyleTrait, type TextStyleBag } from "~/core/ClassStyleRules.js";
import { cancelTransitions } from "~/core/PendingTransitions.js";
import { measureBorderWidths } from "~/core/BorderWidths.js";

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
 * Returned by [`Component.getPerimeterSize`](/api/core/classes/Component#getperimetersize) — the sum of border width and
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
 * A zero-argument function producing a child component on demand, either
 * immediately or once its promise resolves. An async factory is only accepted
 * by a layout manager that defers it (today: [`Tab`](/api/layout/classes/Tab)).
 *
 * @category Core
 */
export type ComponentFactory = () => Component | Promise<Component>;

/**
 * A child component paired with optional layout constraints, as accepted by
 * [`Component.addComponents`](/api/core/classes/Component#addcomponents).
 *
 * @category Core
 */
export interface ConstrainedComponent {
    component:    Component | ComponentFactory;
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
    userSelect?:      string;
    preferredSize?:   Size;
    minSize?:         Size;
    maxSize?:         Size;
    transform?:       string;
    transformOrigin?: string;
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
    components?:      Array<Component | ComponentFactory | ConstrainedComponent>;
    styleRules?:      ComponentStyleRuleSpec[];
    /**
     * Opt-in token that lets several instances of the same concrete class
     * share one generated `.ClassName--<group>` CSS rule instead of each
     * carrying its own.
     */
    styleGroup?:      string | null;
    /** Attaches this single instance to a shared, declared `StyleTrait`
     *  regardless of its class. `null` clears it. See `setStyleTrait`. */
    styleTrait?:      StyleTrait | null;
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

    // Startup font gate: hold the very first flush until the web font has
    // activated, so no text is committed at a fallback-derived size. The queues
    // are left intact and retried next frame; the gate opens on activation or
    // on its own bounded deadline.
    if (isFirstLayoutHeld()) {
        startFirstLayoutDeadline();
        ensureFlushScheduled();

        return;
    }

    const timed   = Diagnostics.isTimingEnabled();
    const started = timed ? performance.now() : 0;

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

        // An earlier entry's doLayout() can synchronously dispose a component
        // still waiting later in this same snapshot — e.g. a table's real
        // layout (Body.renderWindow) discarding a pooled cell whose renderer
        // had already scheduled a layout during construction. `pendingLayouts.
        // delete(this)` in destructor() only protects against the *next*
        // flush; a disposal mid-flush leaves this snapshot stale. Skip a
        // disposed (or never-rendered) component rather than laying out a
        // corpse — mirrors flushPendingVisibility's same guard, above.
        if (!hasDirtyAncestor && c.getElement()) {
            c.doLayout();
        }
    }

    // Post-layout callbacks run after every dirty component has settled, so a
    // consumer that scheduled layout work (revealing a view, opening a section)
    // can act on the final geometry — e.g. focus a now-laid-out element.
    for (const cb of callbacks) {
        cb();
    }

    if (timed) {
        Diagnostics.noteLayoutFlush(performance.now() - started);
    }
}

// Module-level state for the rAF-coalesced effective-visibility reconcile.
// `setVisible` / `setDisplayed` add their component to this queue instead of
// walking the subtree synchronously; the queue flushes once per animation
// frame, recomputing each queued root's *net* effective visibility once —
// mirroring `pendingLayouts` above. `flushEffectiveVisibility()` provides a
// synchronous escape hatch (the offline `RecordingDOMSink.requestAnimationFrame`
// drops its callback, so tests must call it to observe a coalesced flush).
let pendingVisibility: Set<Component> = new Set();
let visibilityRafHandle: number | null = null;

/** Schedules an effective-visibility flush frame if one is not already pending. */
function ensureVisibilityFlushScheduled(): void {
    if (visibilityRafHandle === null) {
        visibilityRafHandle = DOM.sink.requestAnimationFrame(flushPendingVisibility);
    }
}

function flushPendingVisibility(): void {
    visibilityRafHandle = null;

    const dirty = Array.from(pendingVisibility);
    pendingVisibility.clear();

    for (const c of dirty) {
        if (!c.getElement()) continue;                 // skip disposed / never-rendered
        c.propagateEffectiveVisibility(c.isEffectivelyVisible());
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
 * A specific instance's own resolved hoistable style, authored — read
 * through the same per-field getters a caller would use
 * (`getBackgroundColor()`, `getBorder()`, ...), in the same `StyleBag` shape
 * `getClassStyleDefaults()` returns for the class-only bag.
 * `ensureStyleGroupRule` resolves this through `resolveDeclarations` itself,
 * so this seeds it with what *this instance* would actually render, not the
 * class's plain default — see
 * plans/implemented/shared-instance-style-groups.md. Scoped to the same
 * fields the class tier hoists via `StyleBag`, minus
 * `backgroundImage`/`borderRadius`/`visible`/`displayed`/`font`, which a
 * `styleGroup` does not cover.
 */
function resolveInstanceStyleDeclarations(component: Component): StyleBag {
    return {
        backgroundColor: component.getBackgroundColor(),
        border:          component.getBorder(),
        cursor:          component.getCursor(),
        foregroundColor: component.getForegroundColor(),
        outline:         component.getOutline(),
        userSelect:      component.getUserSelect(),
        shadow:          component.getShadow(),
        minSize:         component.getMinSizeConstraint(),
        maxSize:         component.getMaxSizeConstraint(),
        overflow:        component.getOverflow(),
    };
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
type OwnedResources = {
    readonly handles:   readonly Handle[];
    readonly selectors: readonly string[];
};

const _componentFinalizer = new FinalizationRegistry<OwnedResources>(({ handles, selectors }) => {
    for (const handle of handles) {
        DOM.sink.release(handle);
    }

    for (const selector of selectors) {
        disposeStyleRule(selector);
    }
});

// CSS keys the retired phase methods routed through a skip-on-match write
// (rather than a write-null-on-match one) when `applyStyle`'s full sweep
// queued a key the instance layer never declared — mirroring that
// pre-migration split, this queues nothing at all rather than a redundant
// removal for a class-default-only value. Only that "no instance opinion"
// case, though: a value the instance *did* declare (typically via a runtime
// setter — see `flushStyleBag`'s own comment) always queues a real write or
// an explicit removal on a match, regardless of this set, since the old
// phase-method skip never applied to a live setter's own write in the first
// place — every key here (`setDisplayed` included) had its runtime setter
// write through unconditionally pre-migration. See `flushStyleBag`.
const SKIP_ON_MATCH_KEYS: ReadonlySet<string> = new Set([
    "boxSizing",
    "position",
    "cursor",
    "display",
    "padding",
    "margin",
]);

// The framework-baseline hoisted CSS keys — present, with a fallback value,
// in *every* class's resolved bag unconditionally (mirrors
// `ClassStyleRules.ts`'s `FRAMEWORK_DECLARATIONS`, minus `border`, which is
// a non-DOM bookkeeping key there — see `flushStyleBag`'s own `"border"`
// guard). Unlike `backgroundColor`/`shadow`/etc., which a class's resolved
// bag carries only when it explicitly declares one, these always exist —
// which is what makes them safe for `flushStyleBag`'s class-default-only
// comprehensive write (see its own comment): every other key a lower
// layer's resolved bag might carry is either that non-DOM bookkeeping key,
// or a class-specific declaration (e.g. `Text`'s font sub-bag keys) with no
// framework-wide fallback, and must never be written by this class's own
// flush on a class-default-only basis.
const FRAMEWORK_BASELINE_KEYS: ReadonlySet<string> = new Set([
    "boxSizing", "position", "display", "visibility", "whiteSpace",
    "userSelect", "cursor", "margin", "minWidth", "minHeight",
    "maxWidth", "maxHeight", "overflowX", "overflowY",
]);

class Component<TOptions extends ComponentOptions = ComponentOptions> extends BaseObject {

    // The one state Component itself declares — see ARCHITECTURE.md's
    // "Component CSS tiers and state-rule dedup". setVisible(false) toggles
    // it instead of writing a per-instance `visibility: hidden` declaration.
    // Declared on the root class, not a concrete leaf — see the
    // `stateRuleName` fix in ClassStyleRules.ts this relies on. A subclass
    // that declares its own `ownStyleStates` (a whole-list override, see
    // ARCHITECTURE.md) does not inherit this entry and is not required to
    // restate it — see `isVisible()`'s `_activeStates` direct-read below.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".invisible",
            extract: (): StyleBag => ({ visible: false }),
        },
    ];

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
    // Component-scope selectors (#<uuid>[<suffix>]) this component allocated,
    // for teardown deletion. Strings only (no back-reference to Component) so
    // the GC finalizer can hold it without pinning the instance. Mirror of
    // _ownedHandles.
    private readonly _ownedSelectors : string[]             = [];
    // Disposers for every ThemeManager.onThemeChange subscription this
    // component holds, released eagerly in destructor. Safe with a plain
    // initializer for the same reason as _ownedHandles above: a base-class
    // field set before applyOptions runs, so no cascade-dispatched setter can
    // clobber it.
    private readonly _themeCleanups : Array<() => void>      = [];
    // Callbacks registered via `onDestroy`, run once (in registration order)
    // in destructor. The public, module-external counterpart of
    // `_themeCleanups` — for state a module outside this component's own
    // class hierarchy attaches keyed by component identity (e.g.
    // `Tooltip.attach`) and must release on teardown without every call site
    // remembering to call the matching teardown itself. Same plain-initializer
    // safety rationale as `_ownedHandles` above.
    private readonly _destroyCleanups : Array<() => void>    = [];
    private _tag                  : string                  = "div";
    // Every attribute the component currently intends its element to carry —
    // from setElementAttribute/removeElementAttribute, setDataAttribute/
    // delDataAttribute, the `attributes` options bag, setDisabledAttribute,
    // and Aria's mutators (which all route through applyAriaAttribute). One
    // channel, so init() replays it onto a freshly created element with a
    // single attach() call. Assigned in the constructor body (not a field
    // initializer) because applyOptions dispatches setters — including the
    // `attributes` bag itself — that write it from inside super().
    private _elementAttributes    : ElementAttributes;

    // Geometry: NaN sentinels mean "never assigned", so equality guards on
    // setX/setY/setWidth/setHeight short-circuit only AFTER a real write —
    // the first call always reaches the DOM even when its target value is 0.
    private _left                 : number                  = NaN;
    private _top                  : number                  = NaN;
    private _width                : number                  = NaN;
    private _height               : number                  = NaN;
    /**
     * Backing field. Declared bare — see the `declare` rule in CODE_CONVENTIONS.md.
     * Framework-managed bookkeeping, so it gets no `ComponentOptions` field, per
     * ARCHITECTURE.md's third DOM-write rule.
     */
    declare private _layoutDirty  : boolean;
    private _translateX           : number                  = 0;
    private _translateY           : number                  = 0;
    private _scrollLeft           : number                  = 0;
    private _scrollTop            : number                  = 0;
    private _willChange          : string | null           = null;
    private _transition           : string | null           = null;

    // Derived / runtime-only fields that have no direct ComponentOptions counterpart.
    // `position` is intentionally NOT in `ComponentOptions` — the framework
    // positions every component absolutely (see ARCHITECTURE.md). Subclasses
    // that need `FIXED` for a floating overlay or `STATIC` for a semantic
    // HTML carve-out (e.g. `Legend`) call the protected `setPosition` setter
    // post-`super()`. Public callers cannot reach it. Its value now lives in
    // `_instanceStyle.position`, the same as every other layering property.
    private _onPreferredSizeChange: (() => void) | null     = null;
    // Fired when this component's min/max constraint changes, so the parent
    // layout manager can re-clamp/relayout. Parallels `_onPreferredSizeChange`;
    // bound by the parent in add/insert, nulled on remove. `setMinSize`/
    // `setMaxSize` (not `applyOptions`) write it, so no `declare` is needed.
    private _onConstraintSizeChange: (() => void) | null    = null;
    // Eased wheel-scroll controller, lazily attached while an overflow axis is
    // scrollable (auto/scroll). Null otherwise — most components never scroll.
    private _wheelScroller        : SmoothScroller | null     = null;
    private _contain              : string | null           = null;
    private _animation            : string | null           = null;
    // Edge-trigger cache for the effective-visibility walk; null = not yet
    // evaluated. Plain initializer: only propagateEffectiveVisibility
    // (post-render) writes it, never a cascade setter.
    private _lastEffectiveVisible : boolean | null           = null;
    // Set by release(), consumed at the end of the next init() to queue the
    // scroll/focus restore. Plain initializer: only release() and init() write
    // it, never a cascade setter.
    private _pendingRematerialize   : boolean = false;
    // Captured at release(), consumed by restoreReleasedState() on rebuild.
    private _refocusOnRematerialize : boolean = false;
    // Guards Diagnostics.noteComponentDestroyed() against destructor()'s
    // documented idempotency — a bare decrement would double-count a component
    // whose destructor legitimately runs twice (an explicit dispose() on a
    // child a parent later destroys). Plain initializer: only destructor()
    // writes it, never a cascade setter.
    private _destroyed              : boolean = false;
    // Cache for setAnimationPlayState. Plain initializer for the same reason.
    private _animationPlayState   : string | null            = null;
    private _appearance           : string | null           = null;
    private _borderImage          : string | null           = null;
    private _transform            : string | null           = null;
    private _transformOrigin      : string | null           = null;
    private _opacity              : number | null           = null;
    private _disabledAttribute    : boolean                 = false;
    private _border               : BorderOptions | null     = null;
    private _borderWidths         : PerimeterSize | null      = null;
    private _borderThemeSubscribed : boolean                   = false;
    private _autoCommitStyle      : boolean                 = true;
    private _autoCommitAttributes : boolean                 = true;
    private _layoutPaused         : boolean                 = false;
    private _aria                : Aria | null             = null;
    private _verticalAlign        : string | null;
    // Deferred-write style buffers. `styleRule` lazily materialises the
    // component's per-id `CSSStyleRule` on first `ensure()` call; `inlineStyle`
    // queues `element.style.X = ...` writes until `init()` attaches it.
    private _styleRule            : StyleRule    = new StyleRule({ scope: "component", name: this.getId(), materialize: false });
    private _inlineStyle          : InlineStyle  = new InlineStyle();
    // Per-render cache of what the framework and class rules already deliver
    // for this concrete class — the layer `ensureClassStyleRule` returns.
    // Set at the top of `applyStyle` and consulted by `flushStyleBag` so it
    // can skip a write already served by a lower tier.
    private _classLayer           : StyleLayer | null = null;
    // Per-render cache of what this instance's `styleGroup` (if any) already
    // delivers — the layer `ensureStyleGroupRule` returns, or `null` when no
    // group is set. Scanned by `styleLayers()` ahead of `_classLayer`; see
    // plans/implemented/shared-instance-style-groups.md.
    private _groupLayer           : StyleLayer | null = null;
    // Per-render caches for the trait tier — a declared `StyleTrait` bag
    // shared across unrelated classes/instances, ranked above the class tier
    // (see plans/cross-class-style-groups.md). Instance-level opt-in
    // (`setStyleTrait`) is dynamic, so `_instanceTraitLayer` is recomputed
    // every render like `_groupLayer`; class-level opt-in (`ownStyleTraits`)
    // is fixed for the life of the instance, but `_classTraitLayers` is
    // still recomputed every render since `resolveStyleTraits`/
    // `ensureTraitLayer` are both memoized and cheap to re-derive.
    private _instanceTraitLayer   : StyleLayer | null = null;
    private _classTraitLayers     : readonly StyleLayer[] | null = null;
    // The DOM class token `applyStyle` most recently added for the instance-
    // level trait, or `null` if none is currently applied — tracked
    // separately from `_instanceTraitLayer` so a `setStyleTrait(null)` (or a
    // switch to a different trait) can remove the *previous* token, which a
    // check on the new value alone can't see.
    private _instanceTraitToken   : string | null = null;
    // The instance's own authored style — the single cache for every
    // layering property (see ARCHITECTURE.md's *Always cache in memory*).
    // Written unconditionally by `writeStyle`; survives an `applyStyle`
    // rebuild (e.g. `setId`'s fresh `_styleRule`) since it, not the rule, is
    // the source of truth `flushStyleBag` replays from.
    private _instanceStyle        : StyleBag = {};
    // `resolveStyleValue`/`resolveFontValue`'s per-authored-key memo, keyed
    // on the `StyleBag` key name (a `"font."`-prefixed key for a font
    // sub-field). Cleared whenever a layer that could change an answer
    // changes: an instance-layer write, a meta-class toggle, or
    // `setStyleGroup`. Class and framework layers are immutable per process,
    // so nothing else can invalidate an entry.
    private _resolvedCache        : Map<string, unknown> | null = null;
    // CSS keys `flushStyleBag` still needs to resolve and write. `writeStyle`
    // adds to it; `applyStyle` additionally seeds it with every key any
    // layer currently resolves, so a full render pass always replays the
    // complete state (matching the six phase methods this stage retires,
    // which re-derived every hoistable property unconditionally on every
    // render) rather than only what changed since the last flush.
    private _pendingStyleKeys     : Set<string> | null = null;
    // Per-selector twin of `_instanceStyle` / `_pendingStyleKeys` for the
    // state tier: this instance's own authored override bag for each
    // declared state (`.pressed`, `.selected`, …) it has written to via
    // `writeStateStyle`, and the CSS keys `flushStateStyleBag` still owes a
    // write for. `null` until the first `writeStateStyle` call — most
    // instances never override a state, so this stays unallocated.
    private _instanceStateStyle   : Map<string, StyleBag>    | null = null;
    private _pendingStateKeys     : Map<string, Set<string>> | null = null;
    // Currently-active declared states (`.pressed`, `:hover`, `.selected`,
    // `.invisible`, ...) — the selectors from this class's own `ownStyleStates`
    // this instance has toggled on via `setStyleState`. Scanned by
    // `styleLayers()` ahead of the instance layer, in declared order, so the
    // first active entry wins. Plain initializer is safe even though
    // `setVisible` (dispatched by `applyOptions`, itself called from
    // Component's own constructor body, after `super()`) can reach
    // `setStyleState` mid-cascade for any subclass under construction:
    // `_activeStates` is one of Component's own fields, so it is already
    // initialized by the time Component's constructor makes that call,
    // regardless of which subclass is being built.
    private _activeStates         : Set<string> = new Set();
    // Per-prefix value-class state: the DOM class token this instance
    // currently carries, pointing it at a shared `.ClassName.<prefix><value>`
    // rule (see `setValueStyleState`) — e.g. `"lh" -> "lh18px"` for `Text`'s
    // line-height dedup — plus the `StyleLayer` that shared rule publishes,
    // so `layersBelowInstance()` can recognise the value as already
    // delivered. Plain initializer for the same reason as `_activeStates`
    // above.
    private _valueStyleTokens     : Map<string, { token: string; layer: StyleLayer }> = new Map();
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
    // Subclass-owned state rules (e.g. Button's `.pressed` / `:hover:not(.pressed)`,
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
    // holds class-level defaults consulted as a fallback by getters. It is a
    // single frozen object **shared by every instance of the concrete class**,
    // cached on the class constructor by `resolveClassDefaults` — nothing
    // writes into it after it is built, and the freeze turns an accidental
    // write into a runtime throw. Splitting the two bags lets subclass guards
    // of the form `if (this._options.X === undefined)` detect "the caller
    // didn't supply X" without false-firing on defaults that base classes
    // pre-seeded. Both are initialized in the constructor body (not via field
    // initializers) so subclass field initializers can't clobber them. See
    // `plans/options-bag-state-refactor.md` and
    // `plans/implemented/per-class-component-defaults.md` for rationale.
    //
    // `layoutManager` never enters this bag — a layout manager holds
    // per-instance `_container` state, so sharing one across every instance
    // of a class would have each instance's layout stomp the others'.
    // `_defaultLayoutManager` is the per-instance slot: seeded from
    // `subclassDefaults.layoutManager` when the subclass supplied one,
    // otherwise lazily filled with `new Absolute()` the first time
    // `getLayoutManager()` resolves it.
    protected _options!:        TOptions;
    protected _defaultOptions!: Readonly<TOptions>;
    private   _defaultLayoutManager: LayoutManager | null;

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
        this._elementAttributes  = new ElementAttributes();
        this._deferredStyleRules = new Map<string, StyleRule>();
        this.trackSelector(this._styleRule.getSelector());

        // Constants without ComponentOptions counterpart. `boxSizing` /
        // `whiteSpace` need no assignment here any more — the framework tier
        // already emits `border-box` / `nowrap` as its baseline.
        this._verticalAlign = "baseline";

        // Class-level defaults — fallback values consulted by getters when the
        // caller (or a setter) hasn't written to `_options`, and the source
        // every `applyOptions` cascade merges over before dispatching setters.
        // Subclass defaults are layered on top of the Component defaults by
        // `resolveClassDefaults`, which also caches the frozen result on
        // `this.constructor` so every instance of this concrete class shares
        // one bag. `layoutManager` is resolved separately into a per-instance
        // slot — see `_defaultLayoutManager`'s field comment.
        this._defaultLayoutManager = (subclassDefaults?.layoutManager as LayoutManager | undefined) ?? null;
        this._defaultOptions       = resolveClassDefaults<TOptions>(this.constructor, subclassDefaults);

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

        Diagnostics.noteComponentConstructed();
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
        if (options.userSelect      !== undefined) this.setUserSelect(options.userSelect);
        if (options.preferredSize   !== undefined) this.setPreferredSize(options.preferredSize);
        if (options.minSize         !== undefined) this.setMinSize(options.minSize);
        if (options.maxSize         !== undefined) this.setMaxSize(options.maxSize);
        if (options.transform       !== undefined) this.setTransform(options.transform);
        if (options.transformOrigin !== undefined) this.setTransformOrigin(options.transformOrigin);
        if (options.transition      !== undefined) this.setTransition(options.transition);
        if (options.willChange      !== undefined) this.setWillChange(options.willChange);
        if (options.opacity         !== undefined) this.setOpacity(options.opacity);
        if (options.overflow        !== undefined) this.setOverflow(options.overflow);
        if (options.pointerEvents   !== undefined) this.setPointerEvents(options.pointerEvents);
        if (options.writingMode     !== undefined) this.setWritingMode(options.writingMode);
        if (options.touchAction     !== undefined) this.setTouchAction(options.touchAction);
        if (options.styleGroup      !== undefined) this.setStyleGroup(options.styleGroup);
        if (options.styleTrait      !== undefined) this.setStyleTrait(options.styleTrait);

        if (options.attributes !== undefined) {
            // The options bag's `attributes` is a raw-HTML-attribute escape
            // hatch — callers pass arbitrary attribute names (`placeholder`,
            // `data-foo`, `aria-bar`) and expect a literal write. Route each
            // entry through the typed seam so the channel is the only store:
            // it writes through when the element already exists and replays
            // at render when it does not.
            for (const key of Object.keys(options.attributes)) {
                this.setElementAttribute(key, options.attributes[key]);
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
     *   invariant. A third fallback, `resolveTraitStyleDefaults(this.constructor)`,
     *   sits below the class default so a class-level trait's declared value
     *   (e.g. `INPUT_CHROME_TRAIT`'s border) still reaches `setBorder`/
     *   `getBorderSize` for layout even once the class's own `_defaultOptions`
     *   no longer carries it.
     *
     * @remarks
     * Subclasses override this hook when they need to gate or extend the
     * chrome dispatch — e.g. [`Button`](/api/component/button/classes/Button)
     * gates on its `chromeless` option and appends its pressed/hover chrome
     * fields after the base call.
     */
    protected applyChromeOptions(options: TOptions): void {
        const classTraits = resolveTraitStyleDefaults(this.constructor);

        const border          = options.border          ?? this._defaultOptions.border          ?? classTraits.border          ?? undefined;
        const borderRadius    = options.borderRadius    ?? this._defaultOptions.borderRadius    ?? classTraits.borderRadius    ?? undefined;
        const shadow          = options.shadow          ?? this._defaultOptions.shadow          ?? classTraits.shadow          ?? undefined;
        const backgroundImage = options.backgroundImage ?? this._defaultOptions.backgroundImage ?? classTraits.backgroundImage ?? undefined;

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
     * Subscribes to theme changes and records the disposer so it is released
     * on teardown. Prefer this over calling `ThemeManager.onThemeChange`
     * directly — a discarded disposer leaks the component, because the
     * listener closure pins `this` in the static listener array for the life
     * of the process.
     *
     * @param listener - Called after CSS variables have been updated, so `getComputedStyle` returns new values.
     */
    protected subscribeTheme(listener: () => void): void {
        this._themeCleanups.push(ThemeManager.onThemeChange(listener));
    }

    /**
     * Registers a callback to run once, when this component is destroyed.
     * For a module outside this component's own class hierarchy that attaches
     * state keyed by component identity (e.g. `Tooltip.attach`) and needs it
     * released on teardown, without every attaching call site remembering to
     * call the matching teardown itself.
     *
     * @param cleanup - Called with no arguments when this component is destroyed.
     */
    onDestroy(cleanup: () => void): void {
        this._destroyCleanups.push(cleanup);
    }

    /**
     * Registers `bag` — a `ListenerBag` this component owns as an event
     * emitter — to be cleared when this component is destroyed, so every
     * listener still registered on it (and the semantic-listener diagnostic
     * counter it contributed to) is released even though no consumer called
     * `off()`. Returns `bag` unchanged, so a class can wrap its own field
     * initializer: `private _listeners = this.registerListenerBag(new ListenerBag())`.
     *
     * @param bag - The `ListenerBag` this component emits through.
     * @returns `bag`, unchanged.
     */
    protected registerListenerBag<T extends string>(bag: ListenerBag<T>): ListenerBag<T> {
        this.onDestroy(() => bag.clear());

        return bag;
    }

    /**
     * Tears this component down: the public call entry point for teardown.
     * The entire body defers to `destructor()`, which recursively destroys
     * this component's children, releases every tracked theme subscription,
     * runs every callback registered via `onDestroy`, unregisters every DOM
     * listener it registered through the `Event` API, detaches its layout
     * manager, removes the DOM element, deletes the component's per-instance
     * stylesheet rules, and releases tracked handles.
     *
     * @remarks Idempotent — calling this more than once is a harmless no-op.
     * Never override this method — override `destructor()` instead, so an
     * ancestor's own teardown recursing into this component still reaches
     * your cleanup.
     */
    dispose(): void {
        this.destructor();
    }

    /**
     * Destroys this component: recursively destroys its children, releases
     * every tracked theme subscription, runs every callback registered via
     * `onDestroy`, unregisters every DOM listener it registered through the
     * `Event` API, detaches its layout manager, removes the DOM element,
     * deletes the component's per-instance stylesheet rules, and releases
     * tracked handles.
     *
     * @remarks Idempotent — calling this more than once is a harmless no-op.
     * This is the override hook — a subclass releasing its own resources
     * MUST end the override with `super.destructor()` or its share of the
     * work is silently skipped. Reached both from `dispose()` (the public
     * entry point) and, recursively, from an ancestor's own `destructor()` —
     * never call it directly from outside a `Component` subclass.
     */
    protected destructor() {
        // Drop any queued layout before this component's handles are released
        // below. `pendingLayouts` is module-level and outlives the component, so
        // a teardown landing between `scheduleLayout()` and the next animation
        // frame would otherwise leave the flush to lay out a corpse: `doLayout`
        // writes through handles this destructor has already released, which
        // throws against the production sink and aborts the rest of that flush,
        // leaving every component queued behind it unlaid. Descendants are
        // covered by the child recursion below, which reaches this same line for
        // each of them.
        pendingLayouts.delete(this);

        if (!this._destroyed) {
            this._destroyed = true;
            Diagnostics.noteComponentDestroyed();
        }

        // Same reason as the line above: a module-level registration keyed by this
        // component's id outlives it, and each entry holds the component itself. An
        // entry left behind pins the whole instance (disarming the GC finalizer), and
        // a stale viewport entry keeps firing its handler against handles released at
        // the bottom of this method.
        Event.purgeComponent(this.getId());

        // Tear any active clip frame down, then remove this component's own
        // element — before recursing into children below, rather than after.
        // A still-connected element's removal here is the one call in this
        // subtree that costs a live style/layout invalidation; it also
        // natively detaches the whole subtree from the document in one step.
        // Every descendant reached afterward (through the `_components`
        // recursion below, or through any other component-owned disposal loop
        // elsewhere) still runs its own `DOM.sink.removeElement()` call — never
        // skipped, since a descendant can be reached by a path (e.g.
        // `disposeAllComponents()` on the still-live children of a container
        // that is itself merely detached-and-cached, not being disposed —
        // see `Menu.showAnchored()`) where nothing above it in *this* call
        // ever actually performed the removal — but that call now runs
        // against an already-detached node, which is a cheap pointer unlink,
        // not a rendering-affecting operation. `clearContentFrame()` stays
        // below, after the child recursion clears `_components` — unlike the
        // clip frame, its wrapper teardown re-parents every child (via
        // `getAttachNode()`) back onto this element first, which would be
        // real, wasted DOM work against every about-to-be-destroyed child
        // still in `_components` if it ran here.
        this.clearClipFrame();

        let element = this.getElement();
        if (element) {
            DOM.sink.removeElement(element);
        }

        // Discard the subtree eagerly — a destroyed container destroys its
        // children too. `removeComponent` never calls destructor (a removed
        // child may be re-parented by a move), so recursion here only reaches
        // descendants still present in `_components` at close time.
        for (const child of this._components) {
            child.destructor();
        }
        this._components = [];

        // Tear down any active content frame now that `_components` is empty
        // (mirroring `removeElement()`) so the wrapper is removed from the DOM
        // and its handle untracked and released, without its child-reparenting
        // loop doing pointless work against children this method just destroyed.
        this.clearContentFrame();

        // Detach the layout manager after the element is removed above.
        // Detaching before removal, as this method originally did, was a
        // defensive choice, not a proven-necessary one: a `LayoutManager.detach()`
        // override could touch the container's element through `getElement()`
        // — whose `getElementById` fallback needs a connected document — which
        // is what motivated running detach first. But no current override
        // demonstrably requires a connected element at
        // detach time: `Accordion.detach()` and `Split.detach()` (the two
        // overrides three successive review cycles pointed to as the reason)
        // both resolve their header / panel-wrapper / gutter elements through
        // `getElement()` calls that never reach the fallback, because those
        // components cache `_element` at creation via `getElement(true)`
        // (`Accordion.ts:1357-1358`, `Split.ts:1185`). The offline test
        // harness cannot settle the question either way: its modelled
        // `getElementById` (`TestHandleTable._byId`) is never evicted on
        // `removeElement`, so a stale id keeps resolving regardless of
        // ordering. A prior investigation into this exact ordering question
        // reordered detach to run after element removal and left the full
        // suite green, so detach running after removal — as it now does — is
        // not known to require an override. This is also what makes
        // `Tab.detach()` reachable on this path at all — it disposes the
        // raw-appended `TabBar` (`Tab.attach()` appends it directly to the
        // container element instead of registering it as a child), which the
        // child-destruction loop above cannot reach on its own. Resolved
        // directly against `_options` / `_defaultOptions`, rather than
        // through `getLayoutManager()`, whose lazy-attach branch would
        // re-attach (and then immediately re-detach) a manager that was never
        // actually in use — which would break idempotency on a second
        // `destructor()` call by re-attaching every time.
        const layoutManager = (this._options.layoutManager as LayoutManager | undefined)
            ?? (this._defaultLayoutManager ??= new Absolute());
        if (layoutManager && layoutManager.getContainer() === this) {
            layoutManager.detach();
        }

        // Release every recorded theme subscription (includes border
        // invalidation, folded into this bag by setBorder).
        for (const dispose of this._themeCleanups) {
            dispose();
        }
        this._themeCleanups.length = 0;

        // Run every registered destroy hook (e.g. Tooltip.attach's
        // component-keyed teardown) before the handle-release block below.
        for (const cleanup of this._destroyCleanups) {
            cleanup();
        }
        this._destroyCleanups.length = 0;

        // Dispose this component's own style rules before the handle-release
        // block below (rule disposal doesn't touch handles, so order relative
        // to it doesn't matter — grouped here to keep both eager-teardown
        // concerns together).
        this._styleRule.dispose();

        for (const rule of this._deferredStyleRules.values()) {
            rule.dispose();
        }

        // Eagerly release every remaining tracked handle (root and any
        // subclass-created children) and disarm the GC finalizer, then clear the
        // cache so a stale handle is never resolved.
        _componentFinalizer.unregister(this);

        // Abandon every transition still running against a handle released below. A
        // pending deferred write — Animation.play's two-frame entrance dance, or the
        // `transition: null` reset its completion performs — would otherwise resolve a
        // released handle and throw, exactly the stale-deferred-work hazard
        // `pendingLayouts.delete(this)` drops at the top of this method.
        for (const handle of this._ownedHandles) {
            cancelTransitions(handle);
        }

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
            _componentFinalizer.register(this, { handles: this._ownedHandles, selectors: this._ownedSelectors }, this);
        }

        this._ownedHandles.push(handle);

        return handle;
    }

    /** Records a component-scope selector so both teardown paths delete it. */
    private trackSelector(selector: string): void {
        this._ownedSelectors.push(selector);
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
     * Returns the component's dedicated `#id` CSS style rule.
     *
     * @returns The CSSStyleRule scoped to this component's ID.
     *
     * @remarks Forces the underlying stylesheet rule to materialize on first
     * access. After {@link ensureCSSRule} runs, any pending writes queued in
     * `styleRule` are flushed onto the live rule so callers can read / mutate
     * it directly. This `#id` rule no longer holds a component's full
     * effective style: declarations that are uniform for this class are
     * served instead by a framework-wide rule shared by every component, and
     * a rule shared by every instance of this concrete class where its
     * defaults deviate from that; this rule carries only the declarations an
     * individual instance deviates on.
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
     * suffix appended to this component's id (e.g. `":hover"`,
     * `".pressed"`, `".selected"`). The first call for a suffix
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
            this.trackSelector(rule.getSelector());
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
     * Returns the element that carries this component's native scroll — the
     * target every scroll read/write, the child host, and the content frame
     * resolve through. Defaults to the component's own element; a subclass whose
     * scroll happens on an inner element (see [`Panel`](/api/core/classes/Panel)'s overlay-scrollbar
     * mode) overrides this so all scroll plumbing follows the inner scroller
     * without each call site needing to know about it.
     *
     * @returns The scroll-owning element handle, or undefined before render.
     */
    protected getScrollElement(): Handle | undefined {
        return this.getElement();
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
     * Releases this component's DOM element — detaches the node from the
     * document and clears the cached handle — while keeping the component
     * object alive and reusable. A fresh element is built lazily the next time
     * getElement(true) is called. Distinct from dispose(), which destroys the
     * component. Refused (returns false, no-op) unless the component opts in by
     * overriding the release gate; also a no-op when no element is materialised.
     *
     * @returns true if an element was released, false if refused or none was live.
     */
    release(): boolean {
        if (!this.canRelease()) {
            return false;
        }

        // Read the field directly — NOT getElement(), which would resurrect a
        // detached node by id.
        const element = this._element;
        if (!element) {
            return false;
        }

        // Capture focus intent before the node leaves the document.
        this._refocusOnRematerialize = DOM.source.getActiveElement() === element;

        // Tear any active clip / content frame down first so their fields reset
        // to null and the next layout re-frames the fresh element (mirrors
        // destructor()'s teardown, minus child/theme/style-rule disposal).
        this.clearClipFrame();
        this.clearContentFrame();

        // Detach the node so getElement()'s by-id lookup misses and render() runs.
        DOM.sink.removeElement(element);

        // Abandon any transition still running against the handle released below.
        // A pending deferred write — Animation.play's two-frame entrance dance, or
        // its completion — would otherwise resolve a released handle and throw.
        // Mirrors destructor()'s same guard.
        cancelTransitions(element);

        // Drop the outgoing handle so it can never be resolved again and
        // _ownedHandles does not accumulate a dead entry per release cycle.
        DOM.sink.release(element);
        this.untrackHandle(element);

        this._element               = undefined;
        this._pendingRematerialize   = true;

        return true;
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
        const element = this.getScrollElement();
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

        const element = this.getScrollElement();

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
        return this._contentFrame ?? this.getScrollElement();
    }

    /**
     * Moves this component's rendered content from one host element to another,
     * preserving the source's native scroll offset across the move: the active
     * content frame as a unit when one exists (see {@link setContentFrame}), else
     * each child by its outermost {@link getAttachNode} node (so a clip-framed
     * child stays wrapped). Used by a subclass that relocates the scroll host —
     * see [`Panel`](/api/core/classes/Panel)'s overlay inner scroller, which shifts existing children
     * onto the inner element on install and back onto the panel element on
     * teardown — mirroring the re-parent dance {@link setContentFrame} performs.
     *
     * @param from - The element the content currently lives in (its scroll
     *   offset is captured).
     * @param to - The element to move the content into (the captured offset is
     *   restored here).
     */
    protected reparentContent(from: Handle, to: Handle): void {
        const scrollLeft = DOM.source.getScrollLeft(from);
        const scrollTop  = DOM.source.getScrollTop(from);

        if (this._contentFrame) {
            DOM.sink.appendChild(to, this._contentFrame);
        } else {
            for (const component of this._components) {
                const node = component.getAttachNode();

                if (node) {
                    DOM.sink.appendChild(to, node);
                }
            }
        }

        DOM.sink.apply(to, { scrollLeft, scrollTop });
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
     * @remarks The value is held by a buffer that binds to the element at
     * render and writes through afterwards, so a value set while the
     * component is detached survives until the element is created (and any
     * later re-render). A write made after the element exists reaches it
     * immediately unless a batching window is open (see
     * {@link setAutoCommitAttributes}).
     */
    protected setElementAttribute(key: string, value: Object | null | undefined): this {
        if (value === null || value === undefined) {
            return this.removeElementAttribute(key);
        }

        const stringValue = String(value);

        if (this._autoCommitAttributes) this._elementAttributes.set(key, stringValue);
        else                             this._elementAttributes.queue(key, stringValue);

        return this;
    }

    /**
     * Removes an attribute from the DOM element.
     *
     * @param key - The attribute name to remove.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Drops the cached entry the attribute buffer would otherwise
     * replay, in addition to removing the attribute from a live element
     * unless a batching window is open (see {@link setAutoCommitAttributes}).
     */
    protected removeElementAttribute(key: string): this {
        if (this._autoCommitAttributes) this._elementAttributes.remove(key);
        else                             this._elementAttributes.queueRemove(key);

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
     * Returns whether attribute changes are immediately committed to the DOM.
     *
     * @returns True if auto-commit is enabled, false if changes are batched.
     */
    getAutoCommitAttributes(): boolean {
        return this._autoCommitAttributes;
    }

    /**
     * Enables or disables auto-commit; flushing all pending attribute changes when re-enabled.
     *
     * @param value - True to enable immediate commits; false to batch changes until manually flushed.
     */
    setAutoCommitAttributes(value: boolean): this {
        this._autoCommitAttributes = value;

        if (value) {
            this.commitElementAttributes();
        }

        return this;
    }

    /**
     * Flushes all queued attribute changes to the DOM element and clears the pending set.
     */
    protected commitElementAttributes(): this {
        this._elementAttributes.flush();

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
     * but never attached. Once attached, also skips inserting the rule when
     * nothing queued would produce a real declaration — see
     * {@link materialiseWhenNeeded}.
     */
    protected commitCSSRule(): this {
        // Gate on element existence (matches prior `dirtyCSSRule` behaviour):
        // avoids inserting a stylesheet rule for components that are
        // constructed but never attached.
        if (!this.getElement()) {
            return this;
        }

        this.materialiseWhenNeeded(this._styleRule);
        this._styleRule.flush();

        return this;
    }

    /**
     * Sets the component ID and updates the DOM element's id attribute if the element exists.
     *
     * @param id - The new unique identifier for this component.
     */
    setId(id: string): this {
        const oldId = this.getId();

        super.setId(id);

        Event.reindexComponent(oldId, id);

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
        this.trackSelector(this._styleRule.getSelector());

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
     * Returns this component's `styleGroup` token — the caller-supplied
     * string that lets several instances of the same concrete class share
     * one generated `.ClassName--<group>` CSS rule instead of each carrying
     * its own. `null` when unset.
     *
     * @returns The `styleGroup` token, or `null` when none has been set.
     */
    getStyleGroup(): string | null {
        return this._options.styleGroup ?? null;
    }

    /**
     * Sets this component's `styleGroup` token. Two instances of the same
     * concrete class constructed with the same token compare their resolved
     * hoistable style (background/border/cursor/foregroundColor/outline/
     * userSelect/shadow/minSize/maxSize/overflow) and share one rule for
     * whatever agrees; a genuine deviation still writes to that instance's
     * own rule, exactly as an ungrouped instance would.
     *
     * @remarks The group's shared content is fixed by whichever instance in
     * the group renders *first* — a later instance passing a different
     * value under the same token is treated as a per-instance deviation
     * (written to its own rule), not an error. Choose a token deliberately
     * for instances that are meant to look identical; the group's exact
     * resolved content is otherwise not predictable from source alone
     * without knowing render order.
     *
     * @param group - The new token, or `null` to clear it.
     *
     * @returns This component, for method chaining.
     */
    setStyleGroup(group: string | null): this {
        this._options.styleGroup = group;

        return this;
    }

    /** This instance's own `styleTrait`, or `null` when unset. */
    getStyleTrait(): StyleTrait | null {
        return this._options.styleTrait ?? null;
    }

    /**
     * Attaches (or clears) this instance's own trait, independent of its
     * class. A plain assignment — like `setStyleGroup`, it does not itself
     * validate or touch CSS. If `trait`'s declared properties collide with
     * this instance's class's own top-priority declared state, the *next
     * render* throws instead of resolving the tie by stylesheet order — see
     * plans/cross-class-style-groups.md's Architecture Decisions on the
     * state-tier specificity tie.
     *
     * @param trait - The trait to attach, or `null` to clear it.
     *
     * @returns This component, for method chaining.
     */
    setStyleTrait(trait: StyleTrait | null): this {
        this._options.styleTrait = trait;

        return this;
    }

    /**
     * Resolves `trait` for `ctor`, or throws if `trait`'s declared properties
     * would tie in real CSS specificity with `ctor`'s own top-priority
     * declared state (see plans/cross-class-style-groups.md's Architecture
     * Decisions). Called by both opt-in surfaces (class-level in `init()`/
     * `applyStyle`, instance-level in `applyStyle`) so neither can bypass
     * the check.
     *
     * @param ctor - The concrete component class constructor `trait` is
     *   being resolved for.
     * @param trait - The trait to resolve.
     *
     * @returns `trait`'s shared style layer, or `null` on a name collision
     *   with a different `StyleTrait` object (see `ensureTraitStyleRule`).
     */
    private ensureTraitLayer(ctor: Function, trait: StyleTrait): StyleLayer | null {
        const conflicts = traitTopStateConflictKeys(ctor, trait);

        if (conflicts.length > 0) {
            throw new Error(
                `${ctor.name} cannot use trait "${trait.name}": its own top-priority declared ` +
                `state already sets ${conflicts.join(", ")}, which would tie in CSS specificity ` +
                `with the trait's shared rule. Remove the overlapping property from one side.`
            );
        }

        return ensureTraitStyleRule(trait);
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
     * Reads the component's attribute buffer, not the live DOM, so it stays
     * correct while detached and inside an open batching window.
     */
    getDataAttribute(key: string): string | undefined {
        const dataKey = key.startsWith("data-") ? key : `data-${key}`;

        return this._elementAttributes.get(dataKey);
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
            return this.delDataAttribute(key);
        }

        const dataKey = key.startsWith("data-") ? key : `data-${key}`;

        return this.setElementAttribute(dataKey, value);
    }

    /**
     * Removes a component-level data attribute from both the internal map and
     * the DOM element.
     *
     * @param key - The attribute name (with or without the `data-` prefix).
     */
    delDataAttribute(key: string): this {
        const dataKey = key.startsWith("data-") ? key : `data-${key}`;

        return this.removeElementAttribute(dataKey);
    }

    /**
     * Returns the visibility state, or null if inherited from the parent.
     *
     * @returns True if explicitly visible, false if explicitly hidden, null if inheriting from the parent.
     */
    isVisible(): boolean | null {
        // `.invisible` is read from `_activeStates` directly rather than
        // through `resolveStyleValue`'s layer walk: a subclass that declares
        // its own `ownStyleStates` (Button, ToggleButton, ...) does not
        // inherit Component's `.invisible` entry into its own resolved list,
        // so `styleLayers()` never pushes that layer for such an instance.
        // The shared CSS rule still applies regardless (it matches on the
        // universal `ts-ui-component` token, not the concrete class name) —
        // this check only keeps the *getter* correct uniformly across every
        // subclass.
        if (this._activeStates.has(".invisible")) {
            return false;
        }

        return this.resolveStyleValue("visible");
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
        // Normalize to the tri-state target first (same branch logic as
        // before) so the idempotency guard below can compare against it.
        let normalized: boolean | undefined;
        if (Type.isBoolean(value as unknown as object)) {
            normalized = value as boolean;
        } else if (!value) {
            normalized = undefined;
        } else {
            throw new Error("Argument is not a boolean.");
        }

        // Idempotent short-circuit, mirroring setDisplayed: skip the redundant
        // CSS write + reconcile enqueue when the normalized value is unchanged
        // and the element exists. A detached component (no element) falls
        // through to record the value, so the intended state is never lost.
        const authored = normalized ?? null;
        if (this.isVisible() === authored && this.getElement()) {
            return this;
        }

        // Route the CSS side through the shared `.ts-ui-component.invisible`
        // class-tier rule instead of a per-instance `#id` declaration.
        // `_instanceStyle` is deliberately left untouched on the `false`
        // branch — caching it there would make a later full-sweep re-render
        // treat it as a genuine per-instance override again, reproducing the
        // exact duplicate rule this change removes.
        this.setStyleState(".invisible", authored === false);

        if (authored !== false) {
            this.writeStyle({ visible: authored });
        }

        if (this.getElement()) {
            this.scheduleEffectiveVisibilityReconcile();
        }

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
        if (this._instanceStyle.displayed === v && this.getElement()) {
            return this;
        }

        this.writeStyle({ displayed: v });

        if (this.getElement()) {
            this.scheduleEffectiveVisibilityReconcile();
        }

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
        return (this.resolveStyleValue("displayed") ?? this._defaultOptions.displayed) as boolean;
    }

    /**
     * Walks this component and its ancestor chain, returning whether it is
     * actually on-screen — as opposed to `isVisible()` / `isDisplayed()`, which
     * report only this component's own state and don't see an ancestor that
     * hides it. A `Tab` / `Card` hides an inactive panel with `setVisible(false)`
     * (CSS `visibility: hidden`) while keeping its layout slot, so a descendant's
     * own `isVisible()` stays `null` (inherit) even though it is not effectively
     * shown; this walks up to catch that case.
     *
     * @returns `false` if this component or any ancestor is explicitly hidden
     *   (`isVisible() === false`) or undisplayed (`!isDisplayed()`); `true`
     *   otherwise.
     */
    isEffectivelyVisible(): boolean {
        let node: Component | null = this;
        while (node) {
            if (node.isVisible() === false || !node.isDisplayed()) {
                return false;
            }
            node = node.getParentComponent();
        }
        return true;
    }

    /**
     * Override hook fired once per node whose effective visibility changed,
     * edge-triggered by {@link propagateEffectiveVisibility}. The base
     * implementation pauses this node's own CSS animation (via the
     * `animation-play-state` longhand on its `#uuid` rule) when it has one, and
     * resumes it when shown again — subclasses that need to react to the same
     * signal (e.g. a canvas render loop) override this and call `super`.
     *
     * @param effective - The component's new effective-visibility state.
     */
    protected onEffectiveVisibilityChange(effective: boolean): void {
        if (this.getAnimation() !== null) {
            this.setAnimationPlayState(effective ? null : "paused");
        }
    }

    /**
     * Recursively fans an effective-visibility change down the subtree,
     * short-circuiting at any node whose effective value is unchanged (an
     * independent descendant change is separately queued through its own
     * `setVisible`/`setDisplayed`, so an unchanged node never needs to recurse).
     * Called by the module-level coalesced flush on each queued root; public and
     * `@internal` because the flush needs to invoke it on arbitrary instances —
     * consumers react to {@link onEffectiveVisibilityChange} instead of calling
     * this directly.
     *
     * @param effective - This node's newly computed effective-visibility state.
     *
     * @internal
     */
    public propagateEffectiveVisibility(effective: boolean): void {
        if (effective === this._lastEffectiveVisible) {
            return;
        }
        this._lastEffectiveVisible = effective;
        this.onEffectiveVisibilityChange(effective);

        for (const child of this.getComponents()) {
            const childEffective =
                effective && child.isVisible() !== false && child.isDisplayed();
            child.propagateEffectiveVisibility(childEffective);
        }
    }

    /**
     * Queues this component for the next coalesced effective-visibility flush,
     * mirroring `scheduleLayout`. Called by `setVisible` / `setDisplayed` after
     * a real state change.
     */
    protected scheduleEffectiveVisibilityReconcile(): void {
        pendingVisibility.add(this);
        ensureVisibilityFlushScheduled();
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
        return this.resolveStyleValue("padding");
    }

    /**
     * Sets the CSS padding. Use {@link clearPadding} to reset to `"0px 0px 0px 0px"`.
     *
     * @param padding - The new padding Insets.
     *
     * @returns This component, for method chaining.
     */
    setPadding(padding: Insets): this {
        const current = this._instanceStyle.padding;
        if (current &&
            current.getTop()    === padding.getTop()    &&
            current.getRight()  === padding.getRight()  &&
            current.getBottom() === padding.getBottom() &&
            current.getLeft()   === padding.getLeft()) {
            return this;
        }

        this.writeStyle({ padding });

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
        // A bare removal would hand the property to a class default when the
        // class defines one, repainting padding instead of clearing it —
        // write the getter-facing null through the layer (so `getPadding()`
        // suppresses any lower default) and assert the CSS reset directly,
        // bypassing the layer dedup, exactly as before this migration.
        this.writeStyle({ padding: null });
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
     * stored field, mirroring {@link getPerimeterSize}.
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
        return this.resolveStyleValue("backgroundColor");
    }

    /**
     * Sets the background color CSS property. Use {@link clearBackgroundColor} to inherit.
     *
     * @param backgroundColor - A CSS color string.
     *
     * @returns This component, for method chaining.
     */
    setBackgroundColor(backgroundColor: string): this {
        if (this._instanceStyle.backgroundColor === backgroundColor) {
            return this;
        }

        this.writeStyle({ backgroundColor });

        return this;
    }

    /**
     * Removes the background-color CSS property so the element inherits from its parent.
     *
     * @returns This component, for method chaining.
     */
    clearBackgroundColor(): this {
        // Write the getter-facing null through the layer, so `getBackgroundColor`
        // sees an explicit clear and returns null, suppressing a class-level
        // default. A bare CSS removal would still hand the property to the
        // class rule when the class defaults it, repainting the background
        // instead of clearing it — assert the CSS initial value directly,
        // bypassing the layer dedup, so "clear" always means "paint nothing".
        this.writeStyle({ backgroundColor: null });

        if (this._defaultOptions.backgroundColor) {
            this.setElementCSSRule("backgroundColor", "transparent");
        }

        return this;
    }

    /**
     * Returns the CSS `background` shorthand value, or null if none is set.
     *
     * @returns The CSS background shorthand string, or null.
     */
    getBackground(): string | null {
        return this.resolveStyleValue("background");
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
        if (this._instanceStyle.background === value) {
            return this;
        }

        this.writeStyle({ background: value });

        return this;
    }

    /**
     * Removes the `background` shorthand CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearBackground(): this {
        // Same reasoning as `clearBackgroundColor`: the layer write is what makes
        // `getBackground()` report the clear, but a bare CSS removal would hand
        // the property straight back to the class rule when the class defaults it.
        // Only routed through the guarded escape hatch when `background` is one
        // of this instance's own resting-isolation keys (e.g. an isolated
        // Button-family instance) — `setBackground` (via `flushStyleBag`) only
        // ever targets the guarded rule for those same keys, so asserting on it
        // unconditionally here would outrank a later plain-`#id` `setBackground`
        // and leave the clear permanently stuck.
        this.writeStyle({ background: null });

        if (this._defaultOptions.background) {
            if (this.isRestingChromeIsolated() && this.restingIsolationKeys().has("background")) {
                this.writeGuardedCSSRule("background", "transparent");
            } else {
                this.setElementCSSRule("background", "transparent");
            }
        }

        return this;
    }

    /**
     * Returns the background image CSS value, or null if none is set.
     *
     * @returns The CSS background-image string, or null.
     */
    getBackgroundImage(): string | null {
        return this.resolveStyleValue("backgroundImage");
    }

    /**
     * Sets the CSS background-image property. Use {@link clearBackgroundImage} to remove.
     *
     * @param backgroundImage - A CSS background-image string.
     *
     * @returns This component, for method chaining.
     */
    setBackgroundImage(backgroundImage: string): this {
        this.writeStyle({ backgroundImage });

        return this;
    }

    /**
     * Removes the background-image CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearBackgroundImage(): this {
        // Same reasoning as `clearBackgroundColor`: a defaulting class would
        // repaint through a bare removal, so assert the CSS initial value —
        // routed through the resting-isolation-aware escape hatch (not the raw
        // `setElementCSSRule` bypass) so an isolated Button-family instance gets
        // the assertion on its guarded rule, not the bare `#id` rule. See
        // plans/button-flat-chrome-dedup.md.
        this.writeStyle({ backgroundImage: null });

        if (this._defaultOptions.backgroundImage) {
            this.writeGuardedCSSRule("backgroundImage", "none");
        }

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
        return this.resolveStyleValue("foregroundColor");
    }

    /**
     * Sets the CSS color (text color). Use {@link clearForegroundColor} to inherit.
     *
     * @param foregroundColor - A CSS color string.
     *
     * @returns This component, for method chaining.
     */
    setForegroundColor(foregroundColor: string): this {
        if (this._instanceStyle.foregroundColor === foregroundColor) {
            return this;
        }

        this.writeStyle({ foregroundColor });

        return this;
    }

    /**
     * Removes the color (foreground) CSS property so the element inherits from its parent.
     *
     * @returns This component, for method chaining.
     */
    clearForegroundColor(): this {
        // Write the key (not skip it) so `getForegroundColor` sees an
        // explicit clear and returns null, suppressing a class-level default.
        // Only routed through the guarded escape hatch when `color` is one of
        // this instance's own resting-isolation keys — see `clearBackground`'s
        // comment for why an unconditional guarded write would go stale.
        this.writeStyle({ foregroundColor: null });

        if (this._defaultOptions.foregroundColor) {
            if (this.isRestingChromeIsolated() && this.restingIsolationKeys().has("color")) {
                this.writeGuardedCSSRule("color", "inherit");
            } else {
                this.setElementCSSRule("color", "inherit");
            }
        }

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
        // `StyleBag.border` also accepts a bare CSS shorthand string (a
        // class-level default may author one directly) — `setBorder` already
        // normalises an instance-level string to `{ border: <string> }`
        // before caching it, so this mirrors that for a class-level one.
        const value = this.resolveStyleValue("border");

        return typeof value === "string" ? { border: value } : value;
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
        this.writeStyle({ border: this._border });

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

        if (!this._borderThemeSubscribed) {
            this._borderThemeSubscribed = true;
            this.subscribeTheme(() => this._borderWidths = null);
        }

        this.writeStyle({ border: this._border });

        return this;
    }

    /**
     * Updates the component's cached border specification — the geometry
     * {@link getBorderSize} reads for layout math — without writing any CSS.
     * For a subclass whose border is painted entirely by a shared class-tier
     * rule rather than a per-instance write (e.g. a flat `Button`'s resting
     * border, hoisted onto `.ClassName.flat` — see
     * plans/button-flat-chrome-dedup.md), the instance still needs an
     * accurate cached width for sizing even though nothing is written to its
     * own `#id` rule; calling {@link setBorder} instead would defeat that
     * hoisting by writing the same value to the instance rule anyway.
     *
     * @param options - Border configuration, or a CSS `border` shorthand string.
     */
    protected cacheBorderSpec(options: BorderOptions | string): void {
        this._border       = typeof options === "string" ? { border: options } : options;
        this._borderWidths = null;
    }

    /**
     * Returns the current CSS cursor value.
     *
     * @returns The CSS cursor string, or null if not set.
     */
    getCursor(): string | null {
        return this.resolveStyleValue("cursor");
    }

    /**
     * Sets the CSS cursor style on the element.
     *
     * @param cursor - A CSS cursor value (e.g. "pointer", "text", "default").
     *
     * @returns This component, for method chaining.
     */
    setCursor(cursor: string): this {
        if (this._instanceStyle.cursor === cursor) {
            return this;
        }
        this.writeStyle({ cursor });

        return this;
    }

    /**
     * Removes the cursor override from the element.
     *
     * @returns This component, for method chaining.
     */
    clearCursor(): this {
        // Write the key (not skip it) so `getCursor` sees an explicit clear and
        // returns null, suppressing the class default — distinct from the
        // never-set case where the key is absent and the default applies.
        this.writeStyle({ cursor: null });

        return this;
    }

    /**
     * Returns the CSS `touch-action` value, or null if not set.
     *
     * @returns The CSS `touch-action` string, or null.
     */
    getTouchAction(): string | null {
        return "touchAction" in this._options ? (this._options.touchAction ?? null) : (this._defaultOptions.touchAction ?? null);
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
        // Set (not skip) the key so `getTouchAction` sees an explicit clear and
        // returns null, suppressing the class default — distinct from the
        // never-set case where the key is absent and the default applies.
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
        return this.resolveStyleValue("borderRadius");
    }

    /**
     * Sets the CSS border-radius on the element. Use {@link clearBorderRadius} to remove.
     *
     * @param borderRadius - A CSS border-radius string (e.g. "4px").
     *
     * @returns This component, for method chaining.
     */
    setBorderRadius(borderRadius: string): this {
        if (this._instanceStyle.borderRadius === borderRadius) {
            return this;
        }
        this.writeStyle({ borderRadius });

        return this;
    }

    /**
     * Removes the border-radius CSS property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearBorderRadius(): this {
        // Covers both "never set" (key absent, so the raw field access reads
        // `undefined`) and "already cleared" (key present with `null`) —
        // both mean there is nothing left to clear.
        if (this._instanceStyle.borderRadius === undefined || this._instanceStyle.borderRadius === null) {
            return this;
        }
        this.writeStyle({ borderRadius: null });

        return this;
    }

    /**
     * Returns the CSS box-shadow value, or null if not set.
     *
     * @returns The CSS box-shadow string, or null.
     */
    getShadow(): string | null {
        return this.resolveStyleValue("shadow");
    }

    /**
     * Sets the CSS box-shadow. Use {@link clearShadow} to set the shadow to `"none"`.
     * Idempotent: a repeat call with the same value writes nothing.
     *
     * @param shadow - A CSS box-shadow string.
     *
     * @returns This component, for method chaining.
     */
    setShadow(shadow: string): this {
        if (this._instanceStyle.shadow === shadow) {
            return this;
        }

        this.writeStyle({ shadow });

        return this;
    }

    /**
     * Removes the box-shadow by writing `"none"` (preserving the legacy
     * `setShadow(null)` semantic — not a removeProperty). Idempotent: a
     * repeat call while already cleared writes nothing.
     *
     * @returns This component, for method chaining.
     */
    clearShadow(): this {
        // Covers both "never set" (key absent) and "already cleared" (key
        // present with `null`) — both mean there is nothing left to clear.
        if (this._instanceStyle.shadow === undefined || this._instanceStyle.shadow === null) {
            return this;
        }

        // Write the getter-facing null through the layer (so `getShadow()`
        // reports "cleared", not "none"). The CSS neutral is the literal
        // "none" (preserving the legacy `setShadow(null)` semantic — not a
        // bare removeProperty), not the getter-facing `null` above, so the
        // generic instance-vs-lower-layer dedup `writeStyle` triggers can't
        // make this comparison itself: compare "none" against the tiers
        // below the instance layer directly (a bare removal when one of
        // them already resolves `boxShadow` to "none", a real "none"
        // override otherwise) and write it through the guarded escape
        // hatch, which still respects Button's chromeless resting-isolation
        // rule when active.
        this.writeStyle({ shadow: null });
        this.writeGuardedCSSRule("boxShadow", this.matchesLowerTier("boxShadow", "none") ? null : "none");

        return this;
    }

    /**
     * Returns the CSS outline value last passed to {@link setOutline}, or `null`
     * if no outline is set.
     *
     * @returns The outline string, or null.
     */
    getOutline(): string | null {
        return this.resolveStyleValue("outline");
    }

    /**
     * Sets the CSS outline on the element. Use {@link clearOutline} to remove.
     *
     * @param outline - A CSS outline value (e.g. "none", "2px solid blue").
     *
     * @returns This component, for method chaining.
     */
    setOutline(outline: string): this {
        this.writeStyle({ outline });

        return this;
    }

    /**
     * Removes the outline CSS property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearOutline(): this {
        this.writeStyle({ outline: null });

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
     * Returns the CSS transform-origin last passed to
     * {@link setTransformOrigin}, or `null` if none is set.
     *
     * @returns The transform-origin string, or null.
     */
    getTransformOrigin(): string | null {
        return this._transformOrigin;
    }

    /**
     * Sets the CSS transform-origin — the anchor point a {@link setTransform}
     * scales/rotates about. Use {@link clearTransformOrigin} to remove.
     *
     * @param value - A CSS transform-origin value (e.g. "0 0", "50% 50%").
     *
     * @returns This component, for method chaining.
     */
    setTransformOrigin(value: string): this {
        this._transformOrigin = value;

        this.setElementCSSRule("transformOrigin", value);

        return this;
    }

    /**
     * Removes the transform-origin CSS property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearTransformOrigin(): this {
        this._transformOrigin = null;
        this.setElementCSSRule("transformOrigin", null);

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
        return "preferredSize" in this._options
            ? (this._options.preferredSize ?? null)
            : (this._defaultOptions.preferredSize ?? null);
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
     * @param size - The preferred size in pixels.
     *
     * @returns This component, for method chaining.
     */
    setPreferredSize(size: Size): this {
        const prev = this._options.preferredSize;
        if (prev && prev.width === size.width && prev.height === size.height) {
            return this;
        }

        const next: Size = { width: size.width, height: size.height };
        this._options.preferredSize = next;
        this.setDataAttribute("preferredSize", formatSizeAttr(next.width, next.height));
        this._onPreferredSizeChange?.();

        return this;
    }

    /**
     * Drops this component's preferred-size constraint, including one that came
     * from a class default, so its size is derived from its content and layout
     * manager instead.
     *
     * @returns This component, for method chaining.
     *
     * @remarks The options bag cannot express this: `applyOptions` skips an
     * `undefined` entry, so `preferredSize: undefined` never reaches `_options`
     * and a class default (a `FieldSet`'s fixed square, say) keeps winning.
     * This writes the key with an `undefined` value, which is what tells
     * {@link getPreferredSizeConstraint} that the size was *cleared* rather than
     * *never set* — the same key-presence rule `clearPadding` follows.
     */
    clearPreferredSize(): this {
        if ("preferredSize" in this._options && this._options.preferredSize === undefined) {
            return this;
        }

        this._options.preferredSize = undefined;
        this.delDataAttribute("preferredSize");
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
        return this.resolveStyleValue("minSize");
    }

    /**
     * Returns this component's own maximum-size *constraint* — the caller/setter
     * value, else the class default — without folding in the layout manager's
     * maximum. Companion to {@link getMinSizeConstraint}.
     *
     * @returns The constraint Size, or null when none is set.
     */
    getMaxSizeConstraint(): Size | null {
        return this.resolveStyleValue("maxSize");
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
     * @param size - The minimum size in pixels.
     *
     * @returns This component, for method chaining.
     */
    setMinSize(size: Size): this {
        const current = this._instanceStyle.minSize;
        if (current && current.width === size.width && current.height === size.height) {
            return this;
        }

        const next: Size = { width: size.width, height: size.height };
        this.writeStyle({ minSize: next });

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
     * @param size - The maximum size in pixels. Pass UNBOUNDED on either axis to remove that constraint.
     *
     * @returns This component, for method chaining.
     */
    setMaxSize(size: Size): this {
        const current = this._instanceStyle.maxSize;
        if (current && current.width === size.width && current.height === size.height) {
            return this;
        }

        const next: Size = { width: size.width, height: size.height };
        this.writeStyle({ maxSize: next });

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

        let perimeterSize = this.getPerimeterSize();

        let width = this._width - perimeterSize.left - perimeterSize.right;
        let height = this._height - perimeterSize.top - perimeterSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the rectangle this component's children are laid out into: the
     * origin from {@link getContentInsets} and the size from
     * {@link getInnerSize}. A component that places its own children places
     * them inside this rectangle — from a `doLayout` override or from any other
     * method that positions them, such as a row renderer's `layoutChildren`.
     *
     * A border shrinks the rectangle but never moves its origin. Because every
     * component is absolutely positioned, a child's containing block is already
     * this component's padding box — a child at `left: 0` lands at the inner
     * edge of the border — so only the size has to account for it.
     *
     * @returns The content rectangle in pixels, or null if the element is not
     *   yet in the DOM (mirroring {@link getInnerSize}).
     */
    getContentBounds(): { x: number; y: number; width: number; height: number } | null {
        const inner = this.getInnerSize();

        if (!inner) {
            return null;
        }

        const contentInsets = this.getContentInsets();

        return {
            x:      contentInsets.getLeft(),
            y:      contentInsets.getTop(),
            width:  inner.width,
            height: inner.height,
        };
    }

    /**
     * Returns the per-side pixel widths of the component's border. Once the element
     * is connected to the document the widths are browser-measured (so `var()`,
     * `none`, and keywords all resolve) and cached until the next
     * `setBorder`/`clearBorder` or theme change. The measurement itself is shared
     * by every component carrying the same border specification — not repeated
     * per instance — and discarded on theme change; a border side whose width is
     * font-relative (`em`/`ex`/`ch`/`lh`) opts out of sharing and is measured per
     * component, since it can resolve differently on each element. Before the
     * element is connected, `getComputedStyle` can't resolve `var()` (the element
     * doesn't yet inherit from `:root`), so it falls back to an estimate from the
     * spec strings that resolves a leading `var(--name)` against `:root` directly.
     * The estimate is not cached, so it is re-measured authoritatively once the
     * element connects.
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
            this._borderWidths = measureBorderWidths(this._border, element);

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
    getPerimeterSize() {
        let borderSize = this.getBorderSize();
        let insets = this.getInsets();
        let padding = this.getPadding();

        let perimeterSize: PerimeterSize = {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
        }

        if (insets) {
            perimeterSize.top = insets.getTop();
            perimeterSize.right = insets.getRight();
            perimeterSize.bottom = insets.getBottom();
            perimeterSize.left = insets.getLeft();
        }

        if (borderSize) {
            perimeterSize.top += borderSize.top;
            perimeterSize.right += borderSize.right;
            perimeterSize.bottom += borderSize.bottom;
            perimeterSize.left += borderSize.left;
        }

        if (padding) {
            perimeterSize.top += padding.getTop();
            perimeterSize.right += padding.getRight();
            perimeterSize.bottom += padding.getBottom();
            perimeterSize.left += padding.getLeft();
        }

        return perimeterSize;
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
     * Writes x / y / width / height as one batched DOM update.
     *
     * @param x - The new left position in pixels.
     * @param y - The new top position in pixels.
     * @param width - The new width in pixels.
     * @param height - The new height in pixels.
     *
     * @returns Whether the committed rectangle changed.
     */
    setBounds(x: number, y: number, width: number, height: number): boolean {
        this.setAutoCommitStyle(false);
        const changed = this.writeBounds(x, y, width, height);
        this.setAutoCommitStyle(true);

        return changed;
    }

    /**
     * Writes the rectangle, then lays this component out unless the rectangle
     * was unchanged and this component allows the pass to be skipped.
     *
     * @param x - The new left position in pixels.
     * @param y - The new top position in pixels.
     * @param width - The new width in pixels.
     * @param height - The new height in pixels.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Keeps the batching window open across `doLayout()`, matching
     * `LayoutManager.commitBounds`'s behaviour exactly: any inline style the
     * component writes on itself during its own layout pass is flushed in the
     * same batch as the rectangle. The pass runs when the rectangle changed,
     * when this component has not opted into the skip (the protected
     * `canSkipUnchangedLayout` gate, default `false`), when
     * {@link isLayoutDirty} reports a pass is owed, or when this component
     * has no element yet — a cell with no element cannot lay out, so
     * recording that pass as done would skip it forever.
     */
    applyBounds(x: number, y: number, width: number, height: number): this {
        this.setAutoCommitStyle(false);

        const changed = this.writeBounds(x, y, width, height);

        if (changed || !this.canSkipUnchangedLayout() || this.isLayoutDirty() || !this.getElement()) {
            this.doLayout();
        }

        this.setAutoCommitStyle(true);

        return this;
    }

    /**
     * Opt-in gate for the unchanged-geometry skip {@link applyBounds} applies.
     * Default `false` — a component's `doLayout()` is withheld only when it
     * overrides this to `true`.
     *
     * @returns `true` to allow `applyBounds` to skip a `doLayout()` pass when
     *   the rectangle it was handed is unchanged and this component is not
     *   dirty; `false` to always recurse.
     */
    protected canSkipUnchangedLayout(): boolean {
        return false;
    }

    /**
     * Shared body of {@link setBounds} / {@link applyBounds}: writes x / y /
     * width / height and reports whether the committed rectangle changed.
     * Assumes the batching window is already open.
     *
     * @param x - The new left position in pixels.
     * @param y - The new top position in pixels.
     * @param width - The new width in pixels.
     * @param height - The new height in pixels.
     *
     * @returns Whether the committed rectangle changed.
     *
     * @remarks Reads the fields *after* the setters ran, so a `setWidth`/
     * `setHeight` that clamped to this component's min or max still reports
     * honestly.
     */
    private writeBounds(x: number, y: number, width: number, height: number): boolean {
        const px = this._left, py = this._top, pw = this._width, ph = this._height;

        this.setX(x);
        this.setY(y);
        this.setWidth(width);
        this.setHeight(height);

        return this._left !== px || this._top !== py || this._width !== pw || this._height !== ph;
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
     *
     * @remarks The DOM write is rounded to the nearest device pixel — see
     * {@link setX}.
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

        this.setElementStyle("width", Math.round(this._width) + "px");

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
     * Whether this component supports releasing its element without being
     * destroyed. Default false — a component becomes releasable only by
     * overriding this to true, and only once its own element-derived state is
     * provably rebuilt by render()/init() or absent.
     *
     * @returns `true` to allow {@link release} to detach and later rebuild this
     *   component's element; `false` to refuse release.
     */
    protected canRelease(): boolean {
        return false;
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
     *
     * @remarks The DOM write is rounded to the nearest device pixel — see
     * {@link setX}.
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

        this.setElementStyle("height", Math.round(this._height) + "px");

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
     *
     * @remarks The DOM write is rounded to the nearest device pixel to avoid
     * sub-pixel edges and text re-rasterization; `getX()` still returns the
     * exact value passed in, so repeated relative layout math does not
     * accumulate rounding drift.
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

        this.setElementStyle("left", Math.round(this._left) + "px");

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
     *
     * @remarks The DOM write is rounded to the nearest device pixel — see
     * {@link setX}.
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

        this.setElementStyle("top", Math.round(this._top) + "px");

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

        const element = this.getScrollElement();

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

        const element = this.getScrollElement();

        if (element) {
            DOM.sink.apply(element, { scrollTop: value });
            this._scrollTop = DOM.source.getScrollTop(element);
        } else {
            this._scrollTop = value;
        }

        return this;
    }

    /**
     * Restores the scroll offset and focus a released element held, onto the
     * freshly rebuilt element — queued by {@link release} / `init()` into the
     * first-connected-layout drain, since neither lands on a still-detached
     * element.
     *
     * @param element - The freshly rebuilt element to restore state onto.
     */
    private restoreReleasedState(element: Handle): void {
        // Routed through getScrollElement() — not the raw root `element` — so a
        // subclass whose scroll happens on an inner element (see getScrollElement's
        // own doc) restores onto the same target every other scroll write uses.
        const scrollElement = this.getScrollElement();
        if (scrollElement && (this._scrollLeft !== 0 || this._scrollTop !== 0)) {
            DOM.sink.apply(scrollElement, { scrollLeft: this._scrollLeft, scrollTop: this._scrollTop });
        }

        if (this._refocusOnRematerialize) {
            this._refocusOnRematerialize = false;
            // preventScroll: avoid focus-scroll pollution of an overflow:hidden ancestor.
            DOM.sink.focus(element, { preventScroll: true });
        }
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

        const element = this.getScrollElement();

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
        const element = this.getScrollElement();
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
        const element = this.getScrollElement();
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
     *
     * @remarks The DOM write is rounded to the nearest device pixel — see
     * {@link setX}.
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
            this.setElementStyle("transform", "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0)");
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
        return this.resolveStyleValue("position") ?? Position.ABSOLUTE;
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
        this.writeStyle({ position });

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
        // `overflowX` first (the axis-specific authored key), falling back
        // to the combined `overflow` key, per layer — see
        // `resolveOverflowAxis`'s own comment for why a per-layer walk
        // (rather than two chained `resolveStyleValue` calls) is required.
        // `setOverflow` never writes `overflow` to the instance layer
        // directly (it delegates to `setOverflowX`/`Y`), so this only ever
        // matters for a class-level `overflow` default.
        return this.resolveOverflowAxis("overflowX");
    }

    /**
     * Sets the CSS overflow-x property on the component's CSS rule.
     *
     * @param value - A CSS overflow value (e.g. "hidden", "auto", "visible").
     *
     * @returns This component, for method chaining.
     */
    setOverflowX(value: string): this {
        if (this._instanceStyle.overflowX === value) {
            return this;
        }

        this.writeStyle({ overflowX: value });

        return this;
    }

    /**
     * Removes the overflow-x CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearOverflowX(): this {
        // Covers both "never set" (key absent) and "already cleared" (key
        // present with `null`) — both mean there is nothing left to clear.
        if (this._instanceStyle.overflowX === undefined || this._instanceStyle.overflowX === null) {
            return this;
        }

        this.writeStyle({ overflowX: null });

        return this;
    }

    /**
     * Returns the CSS overflow-y value, or null if not set.
     *
     * @returns The CSS overflow-y string, or null.
     */
    getOverflowY(): string | null {
        // See `getOverflowX`'s comment for the axis-specific-then-combined
        // fallback chain.
        return this.resolveOverflowAxis("overflowY");
    }

    /**
     * Sets the CSS overflow-y property on the component's CSS rule.
     *
     * @param value - A CSS overflow value (e.g. "hidden", "auto", "visible").
     *
     * @returns This component, for method chaining.
     */
    setOverflowY(value: string): this {
        if (this._instanceStyle.overflowY === value) {
            return this;
        }

        this.writeStyle({ overflowY: value });

        return this;
    }

    /**
     * Removes the overflow-y CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearOverflowY(): this {
        // Covers both "never set" (key absent) and "already cleared" (key
        // present with `null`) — both mean there is nothing left to clear.
        if (this._instanceStyle.overflowY === undefined || this._instanceStyle.overflowY === null) {
            return this;
        }

        this.writeStyle({ overflowY: null });

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
                const element = this.getScrollElement();

                return element ? (axis === "x" ? DOM.source.getScrollLeft(element) : DOM.source.getScrollTop(element)) : 0;
            },
            write: (axis, value) => this.writeNativeScroll(axis, value),
            clamp: (axis, value) => Util.clamp(value, 0, axis === "x" ? this.getMaxScrollLeft() : this.getMaxScrollTop()),
        });

        Event.addSubtreeListener(this, "wheel", { passive: false, handler: this.onWheelScroll });
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
        const element = this.getScrollElement();
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
     *
     * @remarks An axis counts as scrollable only when it has somewhere to go:
     * a scrollable overflow style is necessary but not sufficient, since an
     * `auto` axis whose content fits has no extent to move through. Claiming
     * such an axis would strand the wheel — the dispatch is descendant-first,
     * so an ancestor scroll region that *can* move (the capped content area
     * around a Dialog's `autoScroll` panel, say) is reached later and would
     * find the event already consumed. Ignoring it lets the wheel chain
     * outward, as it does natively.
     */
    private onWheelScroll(e: WheelEvent): Event.ListenerResult {
        const canX = this.isOverflowScrollable(this.getOverflowX()) && this.getMaxScrollLeft() > 0;
        const canY = this.isOverflowScrollable(this.getOverflowY()) && this.getMaxScrollTop()  > 0;

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

        this._wheelScroller?.scrollBy(dx, dy);

        return { prevent: true };
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
     * Writes the CSS `animation-play-state` longhand on the component's own
     * `#uuid` rule — framework-managed (not on the options bag), set by
     * {@link onEffectiveVisibilityChange} to pause/resume this node's own CSS
     * animation without touching layout, `display`, or CSS transitions.
     *
     * @param value - `"paused"` to freeze the animation, `null` to resume it.
     * @returns This component, for method chaining.
     */
    protected setAnimationPlayState(value: string | null): this {
        this._animationPlayState = value;
        this.setElementCSSRule("animationPlayState", value);

        return this;
    }

    /**
     * Returns the current `animation-play-state` written when this
     * component's effective visibility changes, or `null` when not paused.
     *
     * @returns The cached play-state value, or null.
     */
    getAnimationPlayState(): string | null {
        return this._animationPlayState;
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
     * Sets the CSS `transition` shorthand on the component's inline style. Use
     * this to declare a property-by-property crossfade ahead of state writes
     * (e.g. setting a `transition: background-color 120ms ease-out` and then
     * later calling `setBackgroundColor` to fire the crossfade).
     *
     * The value is written **inline**, not to the component's `#id` rule,
     * because the render-time style pass replays the cached transition inline
     * on every render — and inline beats an `#id` rule. Writing to the rule
     * here would let that inline replay of a construction-time value shadow
     * every later runtime change, so a component that declared a transition at
     * construction could never re-set it. Inline keeps the setter and the
     * replay on the same seam.
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
        this.setElementStyle("transition", value);

        return this;
    }

    /**
     * Removes the CSS `transition` property from the component's inline style.
     *
     * @returns This component, for method chaining.
     */
    clearTransition(): this {
        if (this._transition === null) {
            return this;
        }

        this._transition = null;
        this.setElementStyle("transition", null);

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
        return this.resolveStyleValue("whiteSpace");
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
        this.writeStyle({ whiteSpace: value });

        return this;
    }

    /**
     * Removes the white-space CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearWhiteSpace(): this {
        // Covers both "never set" (key absent) and "already cleared" (key
        // present with `null`) — both mean there is nothing left to clear.
        if (this._instanceStyle.whiteSpace === undefined || this._instanceStyle.whiteSpace === null) {
            return this;
        }

        this.writeStyle({ whiteSpace: null });

        return this;
    }

    /**
     * Returns the current CSS user-select value.
     *
     * @returns The CSS user-select string, or null if not set.
     */
    getUserSelect(): string | null {
        return this.resolveStyleValue("userSelect");
    }

    /**
     * Sets the CSS user-select style on the element.
     *
     * @param value - A CSS user-select value (e.g. "none", "text", "auto").
     *
     * @returns This component, for method chaining.
     */
    setUserSelect(value: string): this {
        if (this._instanceStyle.userSelect === value) {
            return this;
        }
        this.writeStyle({ userSelect: value });

        return this;
    }

    /**
     * Removes the user-select CSS property from the element.
     *
     * @returns This component, for method chaining.
     */
    clearUserSelect(): this {
        // Write the key (not skip it) so `getUserSelect` sees an explicit
        // clear and returns null, suppressing the class default — distinct
        // from the never-set case where the key is absent and the default
        // applies.
        this.writeStyle({ userSelect: null });

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
     * The component's style layers, highest-priority first: every currently
     * active declared state (in declared order — see `ownStyleStates`),
     * then this instance's own writes, then its instance-level trait (if
     * any), then its class-level traits (if any), then its `styleGroup` (if
     * any), then its class tier.
     *
     * @remarks `_classLayer` is only populated by `applyStyle`, i.e. once
     * this component has rendered at least once — but a getter like
     * `getCursor()` must resolve a class-level default correctly even
     * earlier (construction, or any pre-render call), matching every
     * pre-migration getter's `_options.X ?? _defaultOptions.X` fallback.
     * Before first render, the class tier falls back to a *virtual* layer
     * built straight from `getClassStyleDefaults()` — the same authored bag
     * `applyStyle` will eventually seed `_classLayer` from — with an empty
     * resolved half, since CSS dedup (`matchesLowerTier` / `flushStyleBag`)
     * only ever runs once an element exists, by which point the real,
     * CSS-backed `_classLayer` is already in place.
     */
    protected styleLayers(): ReadonlyArray<StyleLayer> {
        const layers: StyleLayer[] = [];

        for (const state of resolveStyleStates(this.constructor)) {
            if (this._activeStates.has(state.selector)) {
                const own = this.instanceStateLayer(state.selector);
                if (own) layers.push(own);
                layers.push(state.layer);
            }
        }

        layers.push(this.instanceLayer());

        if (this._instanceTraitLayer) layers.push(this._instanceTraitLayer);
        layers.push(...(this._classTraitLayers ?? []));

        if (this._groupLayer) layers.push(this._groupLayer);

        layers.push(this._classLayer ?? { authored: this.getClassStyleDefaults(), resolved: {} });

        return layers;
    }

    /** This instance's own authored style, and the CSS it resolves to. Not
     *  cached as an object: `_instanceStyle` itself is the cache, and the
     *  resolved half is cheap to recompute (bounded by the small number of
     *  keys an instance ever declares) — see `resolveStyleValue`'s
     *  `_resolvedCache` for the per-key memo that *is* worth caching. */
    protected instanceLayer(): StyleLayer {
        return { authored: this._instanceStyle, resolved: resolvePartialDeclarations(this._instanceStyle) };
    }

    /** This instance's own override bag for one declared state, and the CSS
     *  it resolves to — `writeStateStyle`'s per-selector twin of
     *  {@link instanceLayer}. `null` when this instance has never written an
     *  override for `selector` (never allocates `_instanceStateStyle` just
     *  to answer this). */
    protected instanceStateLayer(selector: string): StyleLayer | null {
        const authored = this._instanceStateStyle?.get(selector);

        return authored ? { authored, resolved: resolvePartialDeclarations(authored) } : null;
    }

    /** The class-tier layer `ownStyleStates` resolves for one declared
     *  state, or `null` when `selector` isn't a state this class declares. */
    protected classStateLayer(selector: string): StyleLayer | null {
        return resolveStyleStates(this.constructor).find((state) => state.selector === selector)?.layer ?? null;
    }

    /** The layers *below* the instance layer — instance-level trait (if any),
     *  class-level traits (if any), every active value-class tier (see
     *  `setValueStyleState`), group (if any), then class — built directly
     *  from the cached fields rather than by slicing `styleLayers()`, since
     *  that array's prefix (zero or more active meta-class layers) has no
     *  fixed length to slice past. Used by `matchesLowerTier` and
     *  `flushStyleBag`'s per-key dedup, both of which need "does a tier
     *  *other than this instance's own* already supply this value", never a
     *  meta-class layer's. Value-class layers rank above group and class
     *  here because their `.ClassName.<token>` selector outranks both on
     *  specificity. */
    protected layersBelowInstance(): ReadonlyArray<StyleLayer> {
        const layers: StyleLayer[] = [];

        if (this._instanceTraitLayer) layers.push(this._instanceTraitLayer);
        layers.push(...(this._classTraitLayers ?? []));

        for (const entry of this._valueStyleTokens.values()) {
            layers.push(entry.layer);
        }

        if (this._groupLayer) layers.push(this._groupLayer);

        layers.push(this._classLayer ?? { authored: this.getClassStyleDefaults(), resolved: {} });

        return layers;
    }

    /** True when a lower-tier layer already delivers `value` for `key` — the
     *  first layer *below the instance layer* (highest priority first,
     *  see `layersBelowInstance`) whose resolved bag *contains* `key`
     *  decides; a layer that doesn't declare `key` is skipped, not treated
     *  as a mismatch. Excludes the instance layer itself (and any active
     *  meta-class layer above it) — a caller checking this mid-write, after
     *  its own `writeStyle`/`cacheStyleValue` already updated
     *  `_instanceStyle`, must compare against what a *different* tier
     *  supplies, not its own just-written value. The comparison primitive
     *  a caller reaches for when it needs to decide between a real value and
     *  a `null` removal itself, rather than letting `flushStyleBag`'s
     *  generic per-key sweep decide — e.g. `clearShadow`'s CSS-facing
     *  `"none"` doesn't match its getter-facing `null`, so `writeStyle`'s
     *  own instance-vs-lower-layer dedup can't make this comparison alone. */
    protected matchesLowerTier(key: string, value: string | null): boolean {
        for (const layer of this.layersBelowInstance()) {
            if (key in layer.resolved) {
                return layer.resolved[key] === value;
            }
        }

        return false;
    }

    /**
     * Writes `patch` into the instance layer unconditionally — no comparison
     * against any other layer; that happens later, in {@link flushStyleBag}.
     * Shallow merge, one level deep for `font` (a partial font patch merges
     * onto the previously-authored font sub-bag rather than replacing it).
     * Every key `patch` declares (including an explicit `null`, i.e. a
     * `clearX()`) joins the pending set `flushStyleBag` drains; when this
     * component already has an element, the flush runs immediately.
     *
     * Before first render there is no element, so the CSS dedup/write in
     * {@link flushStyleBag} stays pending for the render pass to drain — the
     * class layer isn't resolved yet, and flushing early would reproduce the
     * exact redundant-declaration bug this mechanism exists to fix. But
     * {@link onStyleResolved}'s non-CSS side effects (a `data-*` attribute,
     * `refreshWheelScrolling`) don't depend on the class layer at all, and
     * pre-migration setters ran them unconditionally regardless of render
     * state — so this instance's own newly-written keys still fire them now.
     *
     * When this component already has an element, `flushStyleBag` still only
     * *queues* its writes (see its own comment) — this is the standalone
     * (not-mid-`applyStyle`) caller, so it commits them itself: `#id`'s own
     * rule via `commitCSSRule`, and the chromeless resting-isolation rule (a
     * no-op unless `flushStyleBag` queued something onto it) via
     * `materialiseRestingRule`.
     *
     * @param patch - The authored `StyleBag` keys this write touches.
     */
    protected writeStyle(patch: StyleBag): void {
        this._instanceStyle = patch.font
            ? { ...this._instanceStyle, ...patch, font: { ...this._instanceStyle.font, ...patch.font } }
            : { ...this._instanceStyle, ...patch };

        this._resolvedCache = null;

        const patchKeys = Object.keys(resolvePartialDeclarations(patch));
        const pending    = this._pendingStyleKeys ??= new Set();
        for (const key of patchKeys) {
            pending.add(key);
        }

        if (this.getElement()) {
            this.flushStyleBag();
            this.commitCSSRule();
            this.materialiseRestingRule();
        } else {
            this.onStyleResolved(new Set(patchKeys));
        }
    }

    /**
     * Updates the instance layer's cached value for one key without touching
     * CSS or scheduling a flush — the escape hatch for a call site that
     * manages its own DOM write (or writes none at all) and only needs the
     * typed getters / `resolveStyleValue` to reflect the new value. Pooled,
     * frequently-rebound components (`Cell._applyStateTint`,
     * `Button._applyFlatChrome`/`_restoreChrome`) use this instead of
     * `writeStyle` specifically to avoid the per-recycle `#id` rule
     * materialisation `writeStyle`'s flush would otherwise cost.
     *
     * @param key - The `StyleBag` key to update.
     * @param value - The new authored value.
     */
    protected cacheStyleValue<K extends keyof StyleBag>(key: K, value: StyleBag[K]): void {
        this._instanceStyle = { ...this._instanceStyle, [key]: value };
        this._resolvedCache = null;
    }

    /**
     * Resolves one authored `StyleBag` value: the first layer (instance,
     * then group, then class — see {@link styleLayers}) whose authored bag
     * *contains* `key` wins, even when its value is `null` — so a `clearX()`
     * (which writes the key with `null`) suppresses a lower layer's default
     * rather than falling through to it. Memoized in `_resolvedCache` until
     * the next layer change.
     *
     * @param key - The `StyleBag` key to resolve.
     * @returns The resolved authored value, or `null` when no layer declares `key`.
     */
    protected resolveStyleValue<K extends keyof StyleBag>(key: K): NonNullable<StyleBag[K]> | null {
        if (this._resolvedCache?.has(key)) {
            return this._resolvedCache.get(key) as NonNullable<StyleBag[K]> | null;
        }

        let result: NonNullable<StyleBag[K]> | null = null;

        for (const layer of this.styleLayers()) {
            if (key in layer.authored) {
                result = (layer.authored[key] ?? null) as NonNullable<StyleBag[K]> | null;
                break;
            }
        }

        (this._resolvedCache ??= new Map()).set(key, result);

        return result;
    }

    /**
     * `resolveStyleValue`'s sibling for `overflowX`/`overflowY`: the
     * axis-specific key first, falling back to the combined `overflow` key
     * — mirroring `resolveDeclarations`'s CSS-level `overflowX ?? overflow`
     * fallback — but *per layer*, not chained across layers via `??`.
     * Chaining two separate `resolveStyleValue` calls (`resolveStyleValue
     * ("overflowX") ?? resolveStyleValue("overflow")`) can't distinguish
     * "this layer authors overflowX as an explicit null" (a `clearOverflowX()`,
     * which must suppress every lower layer, including this layer's own
     * `overflow`) from "no layer authors overflowX at all" (`??`'s trigger
     * for falling through) — both read back as `null` from `resolveStyleValue`.
     * Walking layers directly, checking both keys within each one before
     * moving to the next, resolves that ambiguity.
     *
     * @param axisKey - `"overflowX"` or `"overflowY"`.
     * @returns The resolved authored value, or `null` when no layer declares either key.
     */
    protected resolveOverflowAxis(axisKey: "overflowX" | "overflowY"): string | null {
        const cacheKey = "axis." + axisKey;

        if (this._resolvedCache?.has(cacheKey)) {
            return this._resolvedCache.get(cacheKey) as string | null;
        }

        let result: string | null = null;

        for (const layer of this.styleLayers()) {
            if (axisKey in layer.authored) {
                result = layer.authored[axisKey] ?? null;
                break;
            }

            if ("overflow" in layer.authored) {
                result = layer.authored.overflow ?? null;
                break;
            }
        }

        (this._resolvedCache ??= new Map()).set(cacheKey, result);

        return result;
    }

    /**
     * `resolveStyleValue`'s sibling for one `font` sub-key — the same
     * first-layer-with-the-key-wins walk, over each layer's `authored.font`
     * bag instead of `authored` itself.
     *
     * @param key - The `TextStyleBag` sub-key to resolve.
     * @returns The resolved authored value, or `null` when no layer's `font` bag declares `key`.
     */
    protected resolveFontValue<K extends keyof TextStyleBag>(key: K): NonNullable<TextStyleBag[K]> | null {
        const cacheKey = "font." + key;

        if (this._resolvedCache?.has(cacheKey)) {
            return this._resolvedCache.get(cacheKey) as NonNullable<TextStyleBag[K]> | null;
        }

        let result: NonNullable<TextStyleBag[K]> | null = null;

        for (const layer of this.styleLayers()) {
            const font = layer.authored.font;

            if (font && key in font) {
                result = (font[key] ?? null) as NonNullable<TextStyleBag[K]> | null;
                break;
            }
        }

        (this._resolvedCache ??= new Map()).set(cacheKey, result);

        return result;
    }

    /**
     * Writes `patch` into this instance's own layer for `selector` — the
     * state-tier twin of {@link writeStyle}. Writes unconditionally; dedup
     * against the class-tier state layer happens at flush, exactly as
     * {@link flushStyleBag} does for the resting tier.
     *
     * @param selector - The declared state's selector, e.g. `".pressed"`.
     * @param patch - The `StyleBag` key(s) this write touches.
     */
    protected writeStateStyle(selector: string, patch: StyleBag): void {
        const bags     = this._instanceStateStyle ??= new Map();
        const existing = bags.get(selector);

        bags.set(selector, patch.font
            ? { ...existing, ...patch, font: { ...existing?.font, ...patch.font } }
            : { ...existing, ...patch });

        this._resolvedCache = null;

        const pending = this._pendingStateKeys ??= new Map();
        const keys    = pending.get(selector) ?? new Set<string>();
        for (const key of Object.keys(resolvePartialDeclarations(patch))) {
            keys.add(key);
        }
        pending.set(selector, keys);

        if (this.getElement()) {
            this.flushStateStyleBag();
        }
    }

    /**
     * Like {@link writeStateStyle}, but queues every declaration verbatim —
     * never deduped against the class-tier state layer. For a write whose
     * whole purpose is to outrank that rule even when the two values happen
     * to coincide (e.g. `Button.pinPressedToResting`). Flushes immediately,
     * independent of {@link flushStateStyleBag}'s batched, deduped writes.
     *
     * @param selector - The declared state's selector, e.g. `".pressed"`.
     * @param patch - The `StyleBag` key(s) this write touches.
     */
    protected pinStateStyle(selector: string, patch: StyleBag): void {
        const bags     = this._instanceStateStyle ??= new Map();
        const existing = bags.get(selector);

        bags.set(selector, patch.font
            ? { ...existing, ...patch, font: { ...existing?.font, ...patch.font } }
            : { ...existing, ...patch });

        this._resolvedCache = null;

        const state = resolveStyleStates(this.constructor).find((s) => s.selector === selector);
        if (!state) {
            return;
        }

        const rule = this.createStyleRule(state.guardedSuffix);
        rule.setMany(resolvePartialDeclarations(patch));

        if (this.getElement() && rule.hasQueuedDeclarations()) {
            rule.ensure();
        }
    }

    /**
     * Resolves one declared state's authored value: the first of
     * [{@link instanceStateLayer}, {@link classStateLayer}] whose authored
     * bag *contains* `key` wins — presence, not truthiness, so a `clearX()`
     * that writes `null` suppresses the class-tier token rather than falling
     * through to it. Never falls through to the resting tiers (instance,
     * group, class) `resolveStyleValue` walks. Memoized in `_resolvedCache`
     * under `"state." + selector + "." + key`.
     *
     * @param selector - The declared state's selector, e.g. `".pressed"`.
     * @param key - The `StyleBag` key to resolve.
     * @returns The resolved authored value, or `null` when neither layer declares `key`.
     */
    protected resolveStateStyleValue<K extends keyof StyleBag>(selector: string, key: K): NonNullable<StyleBag[K]> | null {
        const cacheKey = "state." + selector + "." + key;

        if (this._resolvedCache?.has(cacheKey)) {
            return this._resolvedCache.get(cacheKey) as NonNullable<StyleBag[K]> | null;
        }

        let result: NonNullable<StyleBag[K]> | null = null;

        for (const layer of [this.instanceStateLayer(selector), this.classStateLayer(selector)]) {
            if (layer && key in layer.authored) {
                result = (layer.authored[key] ?? null) as NonNullable<StyleBag[K]> | null;
                break;
            }
        }

        (this._resolvedCache ??= new Map()).set(cacheKey, result);

        return result;
    }

    /**
     * Drains the pending CSS-key set. A key the instance layer never
     * declared (a class-default-only value, added to the pending set by
     * `applyStyle`'s full sweep so `onStyleResolved` still fires for it) is
     * usually skipped entirely — the instance has nothing to say about it,
     * so `#id` writes neither a real value nor a removal, leaving the lower
     * tier's own rule to supply it via the ordinary CSS cascade. The one
     * exception is `FRAMEWORK_BASELINE_KEYS`, where a class-default-only
     * value still queues a (harmless, always-matching) removal — see that
     * constant's own comment for why only those keys are safe to treat this
     * way, and `reconciled-write-path-widening.md` for why at all.
     *
     * For a key the instance *did* declare, this instance's own value is
     * checked against the layers *below* the instance layer (group, then
     * class). A mismatch always queues the real value. A match always queues
     * an explicit `null` removal instead — `SKIP_ON_MATCH_KEYS` plays no part
     * here, only in the class-default-only case above: a value the instance
     * itself authored (typically via a runtime setter — e.g. `setDisplayed`
     * toggling a pooled Table/Tree row) may have been a *real* override a
     * moment ago, so a later call that happens to land back on the class
     * default must clear that stale declaration, not silently leave it in
     * place. The removal is a harmless no-op that surfaces only if some
     * *other* real declaration in the same flush already materialises the
     * rule (see `StyleTarget.hasQueuedDeclarations`), otherwise the rule
     * never materialises at all. This runs the same comparison the
     * pre-migration phase methods made, at a point where every layer is
     * guaranteed resolved (see the plan's Architecture Decisions for why
     * that ordering is what fixes the two shipped construction-time bugs),
     * with the same resting-chrome-isolation routing those methods used for
     * `restingIsolationKeys()` — otherwise a migrated property (e.g.
     * `backgroundColor`) would bypass `restingStyleRule` and land back on
     * the bare `#id` rule that isolation exists to keep clear of.
     *
     * Runs from `applyStyle` (which first seeds the pending set with every
     * key any layer currently resolves, so a full render pass replays
     * everything, the same as the phase methods it replaces) and, for an
     * already-rendered component, at the end of `writeStyle`.
     */
    protected flushStyleBag(): void {
        if (!this._pendingStyleKeys || this._pendingStyleKeys.size === 0) {
            return;
        }

        const pending = this._pendingStyleKeys;
        this._pendingStyleKeys = null;

        const instanceDeclared = resolvePartialDeclarations(this._instanceStyle);
        const lowerLayers       = this.layersBelowInstance();
        const isolated          = this.isRestingChromeIsolated();
        const isolationKeys     = isolated ? this.restingIsolationKeys() : null;
        const resolved: Style   = {};

        for (const key of pending) {
            const declaredByInstance = key in instanceDeclared;

            if (!declaredByInstance && SKIP_ON_MATCH_KEYS.has(key)) {
                // A skip-on-match key the instance has no opinion on: a
                // class/group-default-only value always "matches" its own
                // source, so this can never produce a write either way.
                continue;
            }

            if (!declaredByInstance && !FRAMEWORK_BASELINE_KEYS.has(key)) {
                // Not one of the keys guaranteed real (see
                // `FRAMEWORK_BASELINE_KEYS`) — e.g. `backgroundColor`/`shadow`
                // (present in a lower layer's resolved bag only when that
                // class explicitly declares one), the non-DOM `border`
                // bookkeeping key `resolveDeclarations` always carries (the
                // real per-side writes flow through this same loop under
                // their own `borderTop`/… names instead), or a key belonging
                // to an unmigrated subclass's own mechanism (`Text`'s font
                // sub-bag). This instance has nothing to say about it and no
                // lower tier's own rule needs a comprehensive-write nudge —
                // leave it alone.
                continue;
            }

            let value: string | null;
            let matchesLower: boolean;

            if (declaredByInstance) {
                value = instanceDeclared[key];
                matchesLower = false;

                for (const layer of lowerLayers) {
                    if (key in layer.resolved) {
                        matchesLower = layer.resolved[key] === value;
                        break;
                    }
                }
            } else {
                // No instance override at all — resolve the value a lower
                // tier already supplies. Always "matches" (it *is* that
                // tier's own value), so this only ever queues a removal —
                // matching the retired phase methods, which wrote every
                // hoistable property their getter resolved (folding the
                // class default) unconditionally, not only instance
                // overrides. Harmless on its own (an all-null batch never
                // materialises `#id` — see `StyleTarget.hasQueuedDeclarations`),
                // it only surfaces when another real declaration in the same
                // batch materialises the rule anyway, keeping that rule's
                // declaration set comprehensive rather than partial (see
                // plans/implemented/reconciled-write-path-widening.md).
                const lower = lowerLayers.find((layer) => key in layer.resolved);
                if (!lower) {
                    continue;
                }
                value = lower.resolved[key];
                matchesLower = true;
            }

            const toWrite = matchesLower ? null : value;

            if (isolationKeys?.has(key)) {
                // Queue only — `restingStyleRule.set` writes through
                // immediately once the rule is materialised, which would
                // jump ahead of a still-to-run `applySubclassStyles`
                // correction on the *bare* rule (see below). Materialising
                // this rule is the caller's job: `writeStyle`'s standalone
                // (non-`applyStyle`) call commits it explicitly, and a full
                // render pass reaches it anyway via `materialiseDeferredRules`,
                // since `restingStyleRule` is a `createStyleRule` allocation.
                this.restingStyleRule.set(key, toWrite);
            } else {
                resolved[key] = toWrite;
            }
        }

        // Queue only, never commit — committing here would materialise
        // `_styleRule` mid-render, before a later `applyStyle` phase (e.g.
        // `applySubclassStyles`) has queued its own corrections onto the
        // same rule, permanently exposing a value that phase exists to
        // dedupe away. `applyStyle`'s own `materialiseStyleRule()` commits
        // once, at the end, after every phase has queued; `writeStyle`
        // commits explicitly for a standalone (already-rendered) call.
        if (Object.keys(resolved).length > 0) {
            this._styleRule.queueMany(resolved);
        }

        this.onStyleResolved(pending);
    }

    /**
     * Hook for a non-CSS effect that must also fire when a *lower* layer
     * supplies the value, not only when this instance's own write does — the
     * gap a construction-time-only side effect would otherwise fall into.
     * Called by `flushStyleBag` after its writes, with the CSS keys just
     * resolved. `Component`'s own effects: `refreshWheelScrolling()` when an
     * overflow axis resolved, and the `data-minSize`/`data-maxSize`
     * attributes when a size constraint resolved.
     *
     * @param keys - The CSS keys `flushStyleBag` just resolved, in `Style` key form.
     */
    protected onStyleResolved(keys: ReadonlySet<string>): void {
        if (keys.has("overflowX") || keys.has("overflowY")) {
            this.refreshWheelScrolling();
        }

        if (keys.has("minWidth") || keys.has("minHeight")) {
            const minSize = this.getMinSizeConstraint();
            if (minSize) {
                this.setDataAttribute("minSize", formatSizeAttr(minSize.width, minSize.height));
            }
        }

        if (keys.has("maxWidth") || keys.has("maxHeight")) {
            const maxSize = this.getMaxSizeConstraint();
            if (maxSize) {
                this.setDataAttribute("maxSize", formatSizeAttr(maxSize.width, maxSize.height));
            }
        }
    }

    /**
     * Drains the pending per-state CSS keys onto `#id<guardedSuffix>` — the
     * state-tier twin of {@link flushStyleBag}. For each pending
     * `(selector, keys)` pair, a key that matches the class-tier state
     * layer's own resolved value queues a `null` (a removal, not a skip —
     * unlike `flushStyleBag`'s match branch, a matching write here still
     * clears whatever stale value this instance's own rule was holding),
     * everything else queues its real value.
     */
    protected flushStateStyleBag(): void {
        if (!this._pendingStateKeys || this._pendingStateKeys.size === 0) {
            return;
        }

        const pending = this._pendingStateKeys;
        this._pendingStateKeys = null;

        for (const [selector, keys] of pending) {
            const state = resolveStyleStates(this.constructor).find((s) => s.selector === selector);
            if (!state) {
                continue;
            }

            const rule     = this.createStyleRule(state.guardedSuffix);
            const declared = resolvePartialDeclarations(this._instanceStateStyle!.get(selector)!);
            const classBag = state.layer.resolved;
            const queued: Record<string, string | null> = {};

            for (const key of keys) {
                const value = declared[key] ?? null;
                queued[key] = (key in classBag && classBag[key] === value) ? null : value;
            }

            rule.setMany(queued);

            if (this.getElement() && rule.hasQueuedDeclarations()) {
                rule.ensure();
            }
        }
    }

    /**
     * Ensures a shared `.ClassName<selectorSuffix>` rule carrying
     * `declarations` — a one-line forwarder to {@link ensureClassStateRule}
     * for the three call sites (`Cell.focusedStyleRule`, `TreeRow.focusedStyleRule`,
     * `Component.setValueStyleState`) that only ever publish a shared
     * class-tier state rule and never write per-instance.
     *
     * @param selectorSuffix - The class-tier rule's own suffix, e.g. `".focused"`.
     * @param declarations - This class's resolved declarations for the suffixed state.
     */
    protected ensureSharedStateRule(selectorSuffix: string, declarations: Record<string, string | null>): void {
        ensureClassStateRule(this.constructor, selectorSuffix, declarations);
    }

    // An instance-level opt-out for a class whose own construction-time
    // defaults publish no state-tier chrome to isolate from (e.g. a
    // chromeless Button) — `resolveStyleStates` is memoized once per
    // *class*, so it cannot know that *this* instance's own defaults happen
    // to be chromeless the way a per-*instance* check against
    // `this._defaultOptions` could.
    // `declare` because a subclass may write it during the `super()`
    // cascade (Button's chromeless branch runs inside `applyChromeOptions`,
    // itself dispatched from `super()`); a plain initializer would run
    // afterward and revert the write.
    private declare _isolationSuppressed?: boolean;

    protected isIsolationSuppressed(): boolean {
        return this._isolationSuppressed ?? false;
    }

    protected suppressIsolation(suppressed: boolean): void {
        this._isolationSuppressed = suppressed;
    }

    /** True when this instance currently isolates its resting chrome from at
     *  least one of its class's declared states (see `ownStyleStates`),
     *  and `suppressIsolation` hasn't disabled it for this instance. */
    protected isRestingChromeIsolated(): boolean {
        return !this.isIsolationSuppressed() && restingGuardSuffix(this.constructor) !== "";
    }

    /** The CSS keys `flushStyleBag` / `writeGuardedCSSRule` route onto
     *  `restingStyleRule` instead of the bare `#id` rule — the union of
     *  every key this class's own declared states carry (see
     *  `ownStyleStates`). Replaces the old fixed three-property
     *  isolation-key constant: a state layer that declares a fourth
     *  property is protected automatically now, instead of silently
     *  unprotected until someone remembers to widen a hand-kept set. */
    protected restingIsolationKeys(): ReadonlySet<string> {
        const keys = new Set<string>();

        for (const state of resolveStyleStates(this.constructor)) {
            for (const key of Object.keys(state.layer.resolved)) {
                keys.add(key);
            }
        }

        // `background` is a shorthand covering both background longhands, so a
        // bare `#id { background: … }` would outrank a state rule declaring
        // either of them. Isolate it whenever a declared state touches one.
        if (keys.has("backgroundColor") || keys.has("backgroundImage")) {
            keys.add("background");
        }

        // Each side longhand carries that side's colour, so a bare
        // `#id { border-top: … }` would outrank a state rule declaring
        // `border-color`. Isolate all four whenever a declared state
        // touches the colour.
        if (keys.has("borderColor")) {
            keys.add("borderTop");
            keys.add("borderRight");
            keys.add("borderBottom");
            keys.add("borderLeft");
        }

        return keys;
    }

    // Lazy resting-isolation rule. Never allocated unless isRestingChromeIsolated()
    // is true somewhere on a write path — see the guard in flushStyleBag /
    // writeGuardedCSSRule, which never call this getter with an empty guard
    // suffix.
    protected declare _restingStyleRule?: StyleRule;
    protected get restingStyleRule(): StyleRule {
        return this._restingStyleRule ??= this.createStyleRule(restingGuardSuffix(this.constructor));
    }

    /**
     * Inserts `restingStyleRule` when a write just queued a real declaration on
     * an already-rendered instance — `applyStyle` materialises deferred rules at
     * the end of a render pass; a runtime setter firing later has no such pass
     * behind it. A rule holding only `null` removals is left unmaterialised, as
     * `Component` does for every other deferred rule.
     */
    protected materialiseRestingRule(): void {
        if (this.getElement() && this.restingStyleRule.hasQueuedDeclarations()) {
            this.restingStyleRule.ensure();
        }
    }

    /**
     * Toggles one of this class's declared states (see `ownStyleStates`) on
     * this instance — e.g. `setStyleState(".pressed", true)`. Updates
     * `_activeStates` (so `styleLayers()`, and every getter built on
     * `resolveStyleValue`, immediately reflect the new state) and the DOM
     * class token, when the state has one: a `.`-prefixed selector's class
     * name is that selector minus the leading dot; a `:`-prefixed
     * pseudo-class (`:hover`, `:active`) carries no DOM token at all — the
     * browser drives those itself, and only a component that already tracks
     * its own hover/active state (the way `Button` tracks `.pressed`) should
     * ever call this for one.
     *
     * No CSS write happens here: the state's own declarations already live
     * on the shared `.ClassName<guardedSuffix>` rule `ownStyleStates`
     * registers, and the resting rule's own `:not(...)` guard (see
     * `restingGuardSuffix`) is what stops it from competing once the token
     * is present — the cascade resolves the rest.
     *
     * @param name - The declared state's own selector, e.g. `".pressed"` or `":hover"`.
     * @param active - Whether the state should be active on this instance.
     * @returns This component, for method chaining.
     */
    setStyleState(name: string, active: boolean): this {
        if (active === this._activeStates.has(name)) {
            return this;
        }

        if (active) {
            this._activeStates.add(name);
        } else {
            this._activeStates.delete(name);
        }

        this._resolvedCache = null;

        const element = this.getElement();
        if (element && !name.startsWith(":")) {
            const token = name.slice(1);   // ".selected" -> "selected"
            DOM.sink.apply(element, active ? { addClass: [token] } : { removeClass: [token] });
        }

        return this;
    }

    /**
     * Whether one of this class's declared states is currently active on
     * this instance.
     *
     * @param name - The declared state's own selector, e.g. `".pressed"`.
     */
    isStyleState(name: string): boolean {
        return this._activeStates.has(name);
    }

    /**
     * Writes one key onto the resting-guarded rule directly, bypassing the
     * layer/dedup machinery — used by a `clearX` method to force a real CSS
     * reset onto the guarded rule instead of the bare `#id` one, for a key a
     * declared state might otherwise outrank. Correct only when `key` is
     * actually one of this instance's own `restingIsolationKeys()` — the
     * guarded rule exists to beat exactly those keys' state rules, nothing
     * else (see `clearBackground`/`clearForegroundColor` for the per-key
     * check this implies). Falls back to the plain `#id` write when this
     * instance isn't isolated at all (see `isRestingChromeIsolated`).
     *
     * @param key - The CSS property name (camelCase).
     * @param value - The value to set, or null to remove the property.
     */
    protected writeGuardedCSSRule(key: string, value: string | null): void {
        if (!this.isRestingChromeIsolated()) {
            this.setElementCSSRule(key, value);

            return;
        }

        this.restingStyleRule.set(key, value);
        this.materialiseRestingRule();
    }

    /**
     * Points this instance at the shared `.ClassName.<prefix><sanitizedValue>`
     * rule for `cssValue`, so every instance of this concrete class that
     * resolves the same value shares one rule instead of each writing its
     * own `#id` declaration. Removes any previously-applied token for this
     * same `prefix` first. Generalises `Text`'s original
     * `applyLineHeightValueClass` (`prefix = "lh"`) so a future value-keyed
     * toggle (a different property, or a different class) needs no bespoke
     * per-property machinery of its own — see `## Architecture Decisions`.
     *
     * The shared rule is recorded as a layer below the instance layer (see
     * `layersBelowInstance`), so `flushStyleBag` recognises the value as
     * already delivered by a lower tier and queues a removal for any
     * matching instance-layer declaration instead of writing it per
     * instance — which is what lets every instance resolving the same value
     * share one rule instead of each contributing its own `#id` deviation.
     *
     * @param prefix - Namespaces this value-class's token from any other one
     *   this class declares (e.g. `"lh"`).
     * @param cssValue - The exact CSS value being applied (e.g. `"18px"`),
     *   used both as the declared value and, sanitized, as the class token.
     * @param patch - The `StyleBag` key(s) the shared rule declares.
     */
    protected setValueStyleState(prefix: string, cssValue: string, patch: StyleBag): void {
        const token        = prefix + cssValue.replace(/[^a-zA-Z0-9]/g, "_");
        const declarations = resolvePartialDeclarations(patch);
        const guard        = this.valueClassGuardSuffix(declarations);

        this.ensureSharedStateRule("." + token + guard, declarations);

        const element  = this.getElement();
        const previous = this._valueStyleTokens.get(prefix)?.token;
        if (element) {
            const removeClass = (previous && previous !== token) ? [previous] : [];
            DOM.sink.apply(element, { removeClass, addClass: [token] });
        }

        this._valueStyleTokens.set(prefix, { token, layer: { authored: patch, resolved: declarations } });
    }

    /**
     * The selector suffix `setValueStyleState` appends to a shared value-class
     * rule when its declarations touch one of this instance's own
     * resting-isolation keys (see `restingIsolationKeys`) — empty otherwise.
     * Without it, a value class serving such a key would tie on specificity
     * with this class's own state rule (e.g. `.Cell.rangeSelected`), and
     * source order — which cell happens to render first — would decide which
     * one paints. Matches `restingIsolationKeys()`'s own test for whether a
     * key belongs on the guarded resting rule or the bare one, so the value
     * tier and the resting tier route identically.
     *
     * @param declarations - The shared rule's resolved declarations.
     */
    private valueClassGuardSuffix(declarations: Record<string, string | null>): string {
        if (!this.isRestingChromeIsolated()) {
            return "";
        }

        const isolated = this.restingIsolationKeys();

        return Object.keys(declarations).some((key) => isolated.has(key))
            ? restingGuardSuffix(this.constructor)
            : "";
    }

    /**
     * The DOM class token `setValueStyleState` currently has this instance
     * pointed at for `prefix`, or `null` when none is active — the read-back
     * a `render()` override needs to re-apply a token recorded before the
     * element existed (a fresh element starts with no classes; the write
     * `setValueStyleState`/`clearValueStyleState` make while unrendered is
     * deferred, not lost — mirrors `setStyleState`'s own render-time catch-up
     * need, e.g. `CheckboxBox.render()`).
     *
     * @param prefix - The same namespace a prior `setValueStyleState` call used.
     */
    protected getValueStyleToken(prefix: string): string | null {
        return this._valueStyleTokens.get(prefix)?.token ?? null;
    }

    /**
     * Reverts to the class-tier default: removes any value-class token this
     * instance currently carries for `prefix` (see {@link setValueStyleState}).
     *
     * @param prefix - The same namespace a prior `setValueStyleState` call used.
     */
    protected clearValueStyleState(prefix: string): void {
        const previous = this._valueStyleTokens.get(prefix)?.token;
        if (!previous) {
            return;
        }

        const element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { removeClass: [previous] });
        }

        this._valueStyleTokens.delete(prefix);
    }

    /**
     * The class-comparison bag `ensureClassStyleRule` resolves for this class.
     * Base implementation is a bare reference to `_defaultOptions` — the same
     * value `applyStyle` has always passed. Override when a subclass needs to
     * contribute a comparison value that doesn't live in `_defaultOptions`
     * (e.g. `Text`, whose `fontSize`/`lineHeight` resolve through private
     * derived fields).
     */
    protected getClassStyleDefaults(): StyleBag {
        return this._defaultOptions;
    }

    /**
     * Writes all current style properties to the given element and its associated CSS rule.
     *
     * @param element - The element handle to apply styles to.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Clears all existing inline styles on the element before re-applying, ensuring a clean state.
     * Declarations that are uniform for this class — the same value every
     * instance would produce from its defaults — are served by a
     * framework-wide `:where(.ts-ui-component)` rule and, where this class's
     * defaults deviate from that, a shared `.ClassName` rule; only a value an
     * instance actually deviates on is queued into this component's own
     * `#id` rule. The `#id` rule is inserted only when a declaration was
     * queued during this pass; a component that contributes no deviation
     * gets no rule on the shared stylesheet until a later setter writes one.
     */
    applyStyle(element: Handle): this {
        DOM.sink.apply(element, { removeAttr: ["style"] });

        // Resolve the declarations this class inherits from the framework and
        // class rules before the flush runs, so it can skip one it already
        // gets from a lower tier.
        this._classLayer = ensureClassStyleRule(this.constructor, this.getClassStyleDefaults());

        // `ensureClassStyleRule` returns `null` when this class opted out of
        // the shared `.ClassName` rule (a name collision — see its own doc
        // comment) — nothing else supplies this class's own baseline
        // declarations via CSS, so write them directly onto this instance's
        // own `#id` rule instead. `flushStyleBag` below still applies on top
        // of this (and, since `styleLayers()` falls back to an empty
        // `resolved` bag for a null `_classLayer`, always writes for real,
        // never skipping on a false "match"), so an instance-level override
        // still wins the final declaration.
        if (!this._classLayer) {
            this.setElementCSSRules(resolveDeclarations(this.getClassStyleDefaults()));
        }

        const group = this.getStyleGroup();
        this._groupLayer = group
            ? ensureStyleGroupRule(this.constructor, group, resolveInstanceStyleDeclarations(this))
            : null;

        // Class-level: recomputed every render (both calls are memoized, so
        // this is cheap), kept in lockstep with the tokens `init()` already
        // wrote once.
        this._classTraitLayers = resolveStyleTraits(this.constructor)
            .map((trait) => this.ensureTraitLayer(this.constructor, trait))
            .filter((layer): layer is StyleLayer => layer !== null);

        // Instance-level: dynamic (unlike the class-level surface, this can
        // change or clear over an instance's lifetime — Expected Behaviour
        // row 10), so token and layer are decided together here. The
        // previous token is tracked in `_instanceTraitToken` so clearing the
        // trait (or switching to a different one) removes it — checking only
        // the new value can't see what was there before.
        const instanceTrait      = this.getStyleTrait();
        this._instanceTraitLayer = instanceTrait ? this.ensureTraitLayer(this.constructor, instanceTrait) : null;

        const previousToken = this._instanceTraitToken;
        const nextToken     = this._instanceTraitLayer ? traitClassName(instanceTrait!) : null;

        if (previousToken !== nextToken) {
            const patch: { addClass?: string[]; removeClass?: string[] } = {};
            if (previousToken) patch.removeClass = [previousToken];
            if (nextToken)     patch.addClass    = [nextToken];
            DOM.sink.apply(element, patch);
        }
        this._instanceTraitToken = nextToken;

        this._resolvedCache = null;

        // A full render pass replays every layering property, not only what
        // changed since the last flush — matching the phase methods this
        // mechanism replaces, which unconditionally re-derived every
        // hoistable declaration on every render. Union every layer's own
        // resolved CSS keys (not just the instance layer's) so a
        // class-default-only value (no instance override at all) still
        // reaches `onStyleResolved` — see Expected Behaviour row 8.
        const pending = this._pendingStyleKeys ??= new Set();
        for (const layer of this.styleLayers()) {
            for (const key of Object.keys(layer.resolved)) {
                pending.add(key);
            }
        }

        // Same full-replay seeding as above, per declared state this
        // instance has its own override bag for — a render pass replays
        // every key that bag declares, not only what changed since the last
        // flush.
        if (this._instanceStateStyle) {
            const statePending = this._pendingStateKeys ??= new Map();
            for (const [selector, bag] of this._instanceStateStyle) {
                const keys = statePending.get(selector) ?? new Set<string>();
                for (const key of Object.keys(resolvePartialDeclarations(bag))) {
                    keys.add(key);
                }
                statePending.set(selector, keys);
            }
        }

        this.flushStyleBag();
        this.flushStateStyleBag();
        this.replayGeometryStyles();
        this.applyMiscInlineStyles();
        this.applySubclassStyles();

        // Materialise last: every phase above queued into the dirty bag, so the
        // whole rule body reaches the stylesheet as one write — or none, if the
        // bag is empty.
        this.materialiseStyleRule();

        this.materialiseDeferredRules();

        return this;
    }

    /**
     * Replays the cached width / top / left / height and translate transform that
     * the leading inline-style wipe cleared — the second `applyStyle` phase.
     */
    private replayGeometryStyles(): void {
        // NaN means "never assigned by a setter" — skip the DOM write for those.
        // Any finite value (including 0) MUST be written so the DOM matches the cached field.
        if (!Number.isNaN(this._width)) {
            this._inlineStyle.set("width", Math.round(this._width) + "px");
        }

        if (!Number.isNaN(this._top)) {
            this._inlineStyle.set("top", Math.round(this._top) + "px");
        }

        if (!Number.isNaN(this._left)) {
            this._inlineStyle.set("left", Math.round(this._left) + "px");
        }

        if (!Number.isNaN(this._height)) {
            this._inlineStyle.set("height", Math.round(this._height) + "px");
        }

        // Replay the cached translate so a `setTranslate`'d transform survives
        // the inline-style wipe above, the same way width/top/left/height are
        // replayed. Skipped at the (0,0) default so components that drive
        // `transform` through `setElementCSSRule` (rotation) are left untouched.
        if (this._translateX !== 0 || this._translateY !== 0) {
            this._inlineStyle.set("transform", "translate3d(" + Math.round(this._translateX) + "px," + Math.round(this._translateY) + "px,0)");
        }
    }

    /**
     * Writes the remaining inline styles (pointer-events, writing-mode,
     * touch-action, z-index, will-change, transition, opacity) and the
     * `data-insets` attribute — the third `applyStyle` phase. Every other
     * hoistable property (white-space, user-select, padding, margin, and
     * the box-model/visibility/size/overflow/chrome properties the four
     * retired phase methods used to own) is now covered by `flushStyleBag`.
     */
    private applyMiscInlineStyles(): void {
        const pointerEvents = this.getPointerEvents();
        if (pointerEvents) {
            this._inlineStyle.set("pointerEvents", pointerEvents);
        }

        const writingMode = this.getWritingMode();
        if (writingMode) {
            this._inlineStyle.set("writingMode", writingMode);
        }

        const touchAction = this.getTouchAction();
        if (touchAction) {
            this._inlineStyle.set("touchAction", touchAction);
        }

        const zIndex = this.getZIndex();
        if (zIndex) {
            this._inlineStyle.set("zIndex", String(zIndex));
        }

        // Replay the cached will-change hint for the same reason as the
        // transition below: `setWillChange` writes inline, so a hint set before
        // the element rendered — e.g. from `applyOptions` during the super()
        // cascade — is otherwise lost to the wipe.
        if (this._willChange !== null) {
            this._inlineStyle.set("willChange", this._willChange);
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

        const insets = this.getInsets();
        if (insets) {
            this.setDataAttribute("insets", insets.render());
        }
    }

    /**
     * Extension point for a subclass that needs to queue more `#id` rule
     * declarations — through `writeStyle`/`writeGuardedCSSRule`, so they
     * still compare against the class tier — before `applyStyle`'s one
     * materialising flush runs. A no-op by default.
     *
     * A subclass overrides this, chaining onto `super()`'s call rather than
     * replacing it, so a grandchild class's own contribution runs too. Only
     * needed by a subclass whose extra declaration can itself resolve to a
     * class-tier-matching removal (see
     * plans/implemented/applystyle-flush-order-empty-rule-fix.md's Architecture
     * Decisions) — a subclass that only ever writes a real, always-present
     * value (`Markdown`'s `maxWidth`) has no need of
     * this hook and can keep overriding `applyStyle` directly, calling
     * `super.applyStyle()` first.
     */
    protected applySubclassStyles(): void {
        // No-op by default.
    }

    /**
     * Materialises `rule` only when doing so is worth it: the rule already
     * exists — so any queued write, including a `null` removal, is a real
     * change to live state — or the dirty bag holds at least one real
     * declaration. Skips a rule that would otherwise insert empty, with every
     * currently-queued entry a no-op `null` removal of a property that was
     * never set.
     *
     * @param rule - The component-scoped or deferred `StyleRule` to
     *   conditionally materialise.
     */
    private materialiseWhenNeeded(rule: StyleRule): void {
        if (rule.isMaterialized() || rule.hasQueuedDeclarations()) {
            rule.ensure();
        }
    }

    /**
     * Materialises this component's `#id` stylesheet rule and drains the queued
     * declarations into it — the final `applyStyle` phase before the deferred
     * state rules.
     *
     * @remarks Skipped entirely when the phases queued nothing worth a real
     * declaration: a component that contributes no declaration gets no rule
     * on the shared stylesheet, and none is needed until a later setter
     * writes one. `ensure()` flushes the bag on first materialisation; the
     * `flush()` after it covers the re-render case, where the rule already
     * exists and `ensure()` returns it without draining.
     */
    protected materialiseStyleRule(): void {
        this.materialiseWhenNeeded(this._styleRule);
        this._styleRule.flush();
    }

    /**
     * Materialises the deferred subclass state rules onto the live stylesheet —
     * the final `applyStyle` phase.
     */
    private materialiseDeferredRules(): void {
        // Materialise state-specific rules registered by subclasses (Button's
        // `.pressed` / `:hover:not(.pressed)`, ToggleButton's `.selected`). Each rule's
        // pending writes flush onto the live `CSSStyleRule` inside `ensure()`,
        // so the stylesheet picks up the entry on first render rather than on
        // first setter write during construction. A deferred rule allocated via
        // `createStyleRule()` but never given a real declaration (e.g. `Panel`'s
        // `::-webkit-scrollbar` rule when the native bar is never hidden) is
        // correctly skipped rather than inserted empty.
        for (const deferredRule of this._deferredStyleRules.values()) {
            this.materialiseWhenNeeded(deferredRule);
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
     * {@link ComponentFactory} (added with no constraints), a
     * {@link ConstrainedComponent} pair (added with the supplied constraints), or an array of
     * any of those forms (each entry is processed in order). All forms can be freely mixed in
     * the same call.
     *
     * @param specs - The components to add. Each entry is a bare {@link Component}, a
     *   {@link ComponentFactory}, a {@link ConstrainedComponent} pair, or an array of those.
     *
     * @returns This component, for method chaining.
     */
    addComponents(...specs: Array<Component | ComponentFactory | ConstrainedComponent
                                 | Array<Component | ComponentFactory | ConstrainedComponent>>): this {
        for (const spec of specs) {
            const items = Array.isArray(spec) ? spec : [spec];

            for (const item of items) {
                // A factory is a function, so it is neither a Component nor a
                // ConstrainedComponent pair — without the typeof arm it would
                // fall through and have `.component` read off a function.
                if (item instanceof Component || typeof item === "function") {
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
     * The child may be a live {@link Component} or a {@link ComponentFactory} that has not been
     * built yet. A factory is offered to this container's layout manager first: a manager that
     * defers it owns when — and whether — it runs, which is how a
     * [`Tab`](/api/layout/classes/Tab) registers a tab whose content is built on first
     * activation. Every other manager declines, and the factory runs immediately.
     *
     * A factory returning a promise is only meaningful to a manager that defers it, because
     * that manager is the one showing a spinner for the wait. On the immediate path there is
     * nothing to host the wait, so a promise throws.
     *
     * @param component - The child component to add, or a factory producing it.
     * @param constraints - Optional. Layout constraints to pass to the layout manager.
     *
     * @throws Error if a factory returns a promise and no layout manager deferred it.
     */
    addComponent(component: Component | ComponentFactory, constraints?: LayoutConstraints): this {
        if (typeof component === "function") {
            const manager = this.getLayoutManager();

            // A manager that claims the factory owns when (and whether) it runs.
            if (manager && manager.addDeferredComponent(component, constraints)) {
                return this;
            }

            const built = component();

            if (built instanceof Promise) {
                throw new Error("Component.addComponent: an async factory needs a layout manager that defers it — "
                              + "add it to a Tab-managed container and leave `lazy` at its default.");
            }

            component = built;
        }

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
     *
     * @remarks Detach-only — does not call {@link dispose}. To discard every child at once
     * instead of re-parenting them, use {@link disposeAllComponents}.
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
     *
     * @remarks Detach-only, like {@link removeComponent} — none of the removed children are
     * disposed, so a re-parenting caller keeps them alive. To discard the children instead, use
     * {@link disposeAllComponents}.
     */
    removeAllComponents(): this {
        for (const component of this._components) {
            this.unwireChild(component);
        }

        this._components = [];

        return this;
    }

    /**
     * Disposes every current child, then removes them all.
     *
     * The discarding counterpart to {@link removeAllComponents}: that method
     * only detaches children (a re-parenting move, e.g. through
     * {@link moveComponent}, depends on the detached child staying alive), so a
     * caller that means to throw the children away instead has to loop
     * `.dispose()` over {@link getComponents} itself before calling it —
     * forgotten, that loop leaks each child's per-instance stylesheet rule and
     * any theme/listener subscriptions on every rebuild. Use this whenever a
     * rebuild's old children are not going to be reused.
     *
     * @returns This component, for method chaining.
     */
    disposeAllComponents(): this {
        for (const component of this._components) {
            component.dispose();
        }

        return this.removeAllComponents();
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
        const layoutManager = (this._options.layoutManager as LayoutManager | undefined)
            ?? (this._defaultLayoutManager ??= new Absolute());

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
     *
     * @remarks The pass runs synchronously, so like `flushLayout()` it bypasses
     * the startup hold that keeps the first coalesced flush waiting for the web
     * font to activate — with the same exception for the virtualised row views,
     * whose rows stay unrendered until the hold ends. Resuming during startup
     * can therefore lay this component out against the fallback font; the
     * font-load re-measure corrects it once the real face arrives.
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
     *
     * The dirty flag is cleared only when this component has an element: a
     * layout manager that reads {@link getInnerSize} — `null` without one,
     * e.g. `Card`, `Fit`, `Border`, the box layouts — cannot actually place
     * its children on a pass run before this component is rendered, so
     * clearing the flag anyway would let {@link applyBounds} skip the real
     * pass once the element exists and the same rectangle is handed to it
     * again (the header-cell "no element" case the protected
     * `canSkipUnchangedLayout` gate's opt-ins guard against).
     */
    doLayout(): this {
        if (this.isLayoutPaused()) {
            return this;
        }

        Diagnostics.noteLayoutPass();

        const lm = this.getLayoutManager();
        if (!lm) {
            throw new Error("Unable to do layout, no layout manager specified.");
        }

        if (this.getElement()) {
            this._layoutDirty = false;
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
     * Marks this component's layout as stale, so the next {@link applyBounds}
     * cannot skip it even when the rectangle it is handed is unchanged.
     *
     * @returns This component, for method chaining.
     *
     * @remarks The cheaper counterpart to {@link scheduleLayout} for setters
     * that cannot lay out immediately — during construction, or mid-cascade —
     * and only need to make sure a later pass is not withheld.
     */
    invalidateLayout(): this {
        this._layoutDirty = true;

        return this;
    }

    /**
     * Whether a layout pass is owed. True until the first {@link doLayout}
     * completes.
     *
     * @returns `true` when this component has never completed a layout pass,
     *   or has been marked stale since its last one.
     */
    isLayoutDirty(): boolean {
        return this._layoutDirty ?? true;
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
        this._layoutDirty = true;

        if (this.isLayoutPaused()) {
            return this;
        }

        pendingLayouts.add(this);
        ensureFlushScheduled();

        return this;
    }

    /**
     * Signals that this component's own preferred and minimum sizes changed for
     * a reason the framework cannot observe through {@link setPreferredSize} /
     * {@link setMinSize} — typically a layout manager whose intrinsic sizing
     * depends on internal state (e.g. an {@link layout!Accordion} opening or closing a
     * section changes the height it wants). Fires the same upward relay a
     * {@link setPreferredSize} call would (installed by the parent in
     * `wireChild`), so every ancestor — and in particular a scrolling host —
     * re-lays-out and recomputes its overflow.
     *
     * `scheduleLayout` alone is not enough here: it re-lays-out this component's
     * own subtree inside its *unchanged* bounds, but never tells the parent the
     * component now wants a different size, so an `autoScroll` ancestor's
     * scrollbar goes stale until the next resize forces a top-down pass. A no-op
     * when the component has no wired parent.
     *
     * @returns This component, for method chaining.
     */
    notifyIntrinsicSizeChanged(): this {
        this._onPreferredSizeChange?.();
        this._onConstraintSizeChange?.();

        return this;
    }

    /**
     * Runs a callback once, after the next batched layout flush completes.
     *
     * Layout is coalesced onto an animation frame (see {@link scheduleLayout}),
     * so geometry a consumer has just triggered is not yet final on the
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
     *
     * @remarks Lays out immediately, so it bypasses the startup hold that keeps
     * the first coalesced flush waiting for the web font to activate. A caller
     * that flushes during startup can therefore read geometry measured against
     * the fallback font. That is the deliberate trade for a synchronous read —
     * and it is corrected anyway, because the font-load re-measure re-flows
     * every subscribed component once the real face arrives. The virtualised
     * row views are the exception: `Tree` and the table body check the hold
     * inside their own render pass, so flushing one during startup lays out its
     * frame but leaves its rows unrendered until the hold ends, rather than
     * rendering them at fallback sizes.
     */
    flushLayout(): this {
        pendingLayouts.delete(this);
        this.doLayout();

        return this;
    }

    /**
     * Synchronously drains the coalesced effective-visibility queue, cancelling
     * any pending animation frame first. Mirrors `flushLayout()`'s escape hatch:
     * the offline `RecordingDOMSink.requestAnimationFrame` drops its callback,
     * so tests (and any caller needing an immediate reconcile) call this instead
     * of waiting on a real frame.
     */
    static flushEffectiveVisibility(): void {
        if (visibilityRafHandle !== null) {
            DOM.sink.cancelAnimationFrame(visibilityRafHandle);
            visibilityRafHandle = null;
        }
        flushPendingVisibility();
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
     * Fires for every button — this public surface has no documented button
     * restriction, so it opts out of `Event.addListener`'s primary-only
     * default to preserve that.
     *
     * @returns This component, for method chaining.
     */
    addMouseDownListener(listener: Event.Listener): this {
        Event.addListener(this, "mousedown", { button: "any", handler: listener });

        return this;
    }

    /**
     * Removes a previously registered mousedown listener.
     *
     * @param listener - The exact callback reference passed to {@link addMouseDownListener}.
     *
     * @returns This component, for method chaining.
     */
    removeMouseDownListener(listener: Event.Listener): this {
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
     * Fires for every button — this public surface has no documented button
     * restriction, so it opts out of `Event.addSubtreeListener`'s
     * primary-only default to preserve that.
     *
     * @returns This component, for method chaining.
     */
    addMouseDownSubtreeListener(listener: Event.Listener): this {
        Event.addSubtreeListener(this, "mousedown", { button: "any", handler: listener });

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
    removeMouseDownSubtreeListener(listener: Event.Listener): this {
        Event.removeSubtreeListener(this, "mousedown", listener);

        return this;
    }

    /**
     * Sets the element ID, attaches the style and attribute buffers, applies style, and appends child elements.
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

        // Bind the inline-style and attribute buffers so any writes queued
        // during detached construction flush into the live element, and
        // subsequent setters write through directly.
        this._inlineStyle.attach(element);
        this._elementAttributes.attach(element);

        const group = this.getStyleGroup();
        // Whitespace-normalised (see `styleGroupClassSuffix`) so this is
        // always a valid single `classList` token — a raw caller-supplied
        // token containing a space would otherwise throw here, since
        // CSS-escaping (used only for the class-tier selector) does not
        // remove whitespace.
        const groupClass = group ? [this.constructor.name + "--" + styleGroupClassSuffix(group)] : [];
        // Re-applies any declared state's DOM class token recorded before this
        // element existed (e.g. setVisible(false) via the construction-time
        // `visible` option) — setStyleState's own DOM write is gated on
        // getElement(), so a state toggled during construction only updates
        // `_activeStates` until this first render catches it up. Mirrors the
        // per-class render() catch-up ToggleButton/ScrollArrowButton/ScrollbarThumb
        // already do for their own states, generalised once here since `.invisible`
        // is reachable from every concrete class.
        const activeStateTokens = Array.from(this._activeStates)
            .filter((selector) => selector.startsWith("."))
            .map((selector) => selector.slice(1));
        // Class-level trait tokens: every trait this class declares through
        // `ownStyleTraits` (inherited down the chain), filtered to the ones
        // that actually resolved a layer — a name collision with a different
        // `StyleTrait` object is filtered out silently here, the same way
        // every other tier's name collision is (only a *state* conflict
        // throws, from `ensureTraitLayer` itself).
        const classTraitTokens = resolveStyleTraits(this.constructor)
            .filter((trait) => this.ensureTraitLayer(this.constructor, trait) !== null)
            .map(traitClassName);
        DOM.sink.apply(element, { addClass: [COMPONENT_CLASS, ...getStyleClassChain(this.constructor), ...groupClass, ...activeStateTokens, ...classTraitTokens] });

        this.applyStyle(element);

        let components = this.getComponents();
        for (let i in components) {
            let component = components[i];
            let compElement = component.getElement(true);

            DOM.sink.appendChild(element, compElement!);
        }

        if (this._pendingRematerialize) {
            this._pendingRematerialize = false;
            // Queue the scroll/focus restore for the first connected layout — a
            // detached element cannot hold scroll or focus. Pushed directly
            // (not via onFirstLayout, which calls getElement() — unset here
            // mid-render) and paired with a scheduled layout to guarantee the
            // drain.
            (this._firstLayoutCallbacks ??= []).push(() => this.restoreReleasedState(element));
            this.scheduleLayout();
        }

        return this;
    }

    /**
     * Re-binds the style and attribute buffers to the component's current
     * element, without re-running the rest of `init()` (no class list, no
     * `applyStyle`, no child re-append).
     *
     * @returns This component, for method chaining.
     *
     * @remarks For almost every component `getElement()` returns a cached
     * field set once at render, so the buffers stay bound to the right
     * handle for the component's lifetime. `Body` is the one component whose
     * `getElement()` always resolves the live document body afresh instead
     * of a cached field, so a caller that re-mounts it against a different
     * DOM (only relevant to a swappable seam, e.g. a test harness) calls
     * this first to keep the buffers pointed at the current element.
     */
    protected reattachElementBuffers(): this {
        const element = this.getElement();

        if (element) {
            this._inlineStyle.attach(element);
            this._elementAttributes.attach(element);
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

// Every real subclass (`class Foo extends Component`) resolves its
// `Object.getPrototypeOf` link against this *callable*, public-facing
// reference — the import consumers use — not the raw class above, so this
// is the reference the hierarchy walk in `core/ClassStyleRules.ts` must
// treat as its root. See ARCHITECTURE.md's "Components are exported through
// `callable()`": the wrapper preserves the prototype chain, but `extends`
// stores the exact reference on the right-hand side of the clause.
registerStyleChainRoot(ComponentCallable);

export {
    Component         as _Component,
    ComponentCallable as Component
};

