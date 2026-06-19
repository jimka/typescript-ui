// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { TextMeasureOptions, TextMetrics } from "~/core/Util.js";
import type { Size } from "~/primitive/Size.js";
import type { Component } from "~/core/Component.js";

// Production measurement caches. These live here because the irreducible
// browser-measurement leaf (the off-screen probe, the canvas metrics context,
// the scrollbar-width probe) is the production side of the read seam — the lone
// place the framework touches the real DOM for measurement.
let _metricsCtx:    CanvasRenderingContext2D | null = null;
let _scrollBarWidth: number = -1;

/**
 * Applies a set of camelCase inline-style properties to an element, used by the
 * off-screen measurement probes below. Raw `style` access is intentional — this
 * is inside the seam's production implementation.
 */
function _applyProbeStyles(element: HTMLElement, styles: Record<string, string>): void {
    for (const key of Object.keys(styles)) {
        (element.style as any)[key] = styles[key];
    }
}

/**
 * Plain serialisable rectangle in viewport coordinates. Deliberately *not* a
 * live [`DOMRect`](https://developer.mozilla.org/en-US/docs/Web/API/DOMRect):
 * the read seam returns plain data so the same call can be answered by a
 * geometry model (offline tests) or, in future, across a worker boundary.
 *
 * @remarks The `top` / `left` / `right` / `bottom` edges mirror `DOMRect`'s
 * derived fields so existing anchor-positioning call sites read this as a
 * drop-in for the rect they used to get from `getBoundingClientRect()`. A live
 * `DOMRect` is structurally assignable to a `Rect`.
 *
 * @category Core
 */
export interface Rect {
    x:      number;
    y:      number;
    width:  number;
    height: number;
    top:    number;
    left:   number;
    right:  number;
    bottom: number;
}

/**
 * Plain box-model snapshot — an element's native scroll offsets together with
 * its scrollable content size and visible viewport size, read in one shot.
 * Deliberately *not* a live element: like {@link Rect}, the read seam returns
 * plain data so the same call can be answered offline or across a worker
 * boundary.
 *
 * @category Core
 */
export interface ScrollMetrics {
    scrollTop:    number;
    scrollLeft:   number;
    scrollWidth:  number;
    scrollHeight: number;
    clientWidth:  number;
    clientHeight: number;
}

/**
 * Plain offset-box snapshot — an element's top edge and height relative to its
 * `offsetParent`. Plain data for the same reason as {@link ScrollMetrics}.
 *
 * @category Core
 */
export interface OffsetSize {
    offsetTop:    number;
    offsetHeight: number;
}

/**
 * Opaque, serialisable element reference. A branded `number`, so a raw number
 * cannot be passed where a handle is expected and the reference forwards across
 * a worker boundary as plain data. The live `Node` it stands for never escapes
 * the seam — every sink/source method resolves the handle internally.
 *
 * @category Core
 */
export type Handle = number & { readonly __handleBrand: unique symbol };

/**
 * A batch of mutations applied to a single element with one handle resolve.
 * Every field is plain serialisable data — no live element, no function — so a
 * worker transport forwards an entire patch as one `postMessage`.
 *
 * Application order is fixed: styles first, then class removals before
 * additions (so a `removeClass` + `addClass` of the same name lands "on"),
 * attribute removals before sets, then dataset / text / scroll.
 *
 * @category Core
 */
export interface ElementPatch {
    /** Inline style writes. `null` removes the property. camelCase or `--custom`. */
    style?:       Readonly<Record<string, string | null>>;
    /** Classes to remove (applied before {@link ElementPatch.addClass}). */
    removeClass?: readonly string[];
    /** Classes to add. */
    addClass?:    readonly string[];
    /** Classes to force on/off. */
    toggleClass?: Readonly<Record<string, boolean>>;
    /** Attributes to remove (applied before {@link ElementPatch.setAttr}). */
    removeAttr?:  readonly string[];
    /** Attributes to set. */
    setAttr?:     Readonly<Record<string, string>>;
    /** `data-*` writes (camelCase keys). */
    dataset?:     Readonly<Record<string, string>>;
    /** Text content. */
    text?:        string;
    /** Native horizontal scroll offset. */
    scrollLeft?:  number;
    /** Native vertical scroll offset. */
    scrollTop?:   number;
}

/**
 * Canonicalising handle registry — the lone holder of live DOM references in
 * the handle design. Maps a handle to its node (forward) and a node back to its
 * handle (reverse) so a node is never assigned two handles; that reverse map is
 * what makes handle equality mirror element equality.
 *
 * Two minting modes draw the leak-safety line. {@link HandleRegistry.retain} is
 * for nodes the framework owns (it created them): a strong forward entry,
 * released explicitly at the element's dispose site. {@link HandleRegistry.intern}
 * is for browser-supplied nodes the live DOM already owns: a weak forward entry
 * (`WeakRef`) plus a finalizer that drops the handle once the node is collected,
 * so interning can never pin a dead node.
 *
 * Module-private: only the production sink and source touch it.
 */
class HandleRegistry {
    private readonly _forward = new Map<Handle, Node | WeakRef<Node>>();
    private readonly _reverse = new WeakMap<Node, Handle>();
    private _next = 1;

    /** Drops the forward entry when a weakly-interned node is garbage-collected. */
    private readonly _finalizer = new FinalizationRegistry<Handle>((handle) => {
        this._forward.delete(handle);
    });

    /**
     * Mints a canonical handle for a node the framework owns (a created,
     * possibly-detached element). Strongly held so a detached node survives
     * until it is mounted or explicitly released.
     *
     * @param node - The owned node.
     * @returns Its canonical handle (stable across repeated calls).
     */
    retain(node: Node): Handle {
        const existing = this._reverse.get(node);

        if (existing !== undefined) {
            return existing;
        }

        const handle = this._mint(node);

        this._forward.set(handle, node);

        return handle;
    }

    /**
     * Mints a canonical handle for a node supplied by the browser (an event
     * target, a `querySelector` result, the active element). The live DOM owns
     * it, so the registry holds only a weak reference plus a finalizer — no leak
     * even if the handle is never released.
     *
     * @param node - The browser-supplied node.
     * @returns Its canonical handle (stable while the node is alive).
     */
    intern(node: Node): Handle {
        const existing = this._reverse.get(node);

        if (existing !== undefined) {
            return existing;
        }

        const handle = this._mint(node);

        this._forward.set(handle, new WeakRef(node));
        this._finalizer.register(node, handle);

        return handle;
    }

    /**
     * Resolves a handle to its node. Throws on a released or collected handle —
     * a use-after-free becomes a loud failure instead of the silent no-op a
     * stale element pointer would give.
     *
     * @param handle - The handle to resolve.
     * @returns The live node.
     */
    resolve(handle: Handle): Node {
        const entry = this._forward.get(handle);

        if (entry === undefined) {
            throw new Error(`DOM handle ${handle} is not registered (released or never minted).`);
        }

        const node = entry instanceof WeakRef ? entry.deref() : entry;

        if (node === undefined) {
            throw new Error(`DOM handle ${handle} refers to a collected node.`);
        }

        return node;
    }

    /**
     * Releases an owned handle at its element's dispose site. Idempotent. A
     * missed release on a retained (strong) handle pins a detached element
     * forever, so the migration must place this at every created-element
     * teardown.
     *
     * @param handle - The handle to release.
     */
    release(handle: Handle): void {
        const entry = this._forward.get(handle);

        if (entry === undefined) {
            return;
        }

        const node = entry instanceof WeakRef ? entry.deref() : entry;

        if (node) {
            this._reverse.delete(node);
        }

        this._forward.delete(handle);
    }

    /** Live forward-map size — a test hook that verifies release / GC eviction. */
    get size(): number {
        return this._forward.size;
    }

    private _mint(node: Node): Handle {
        const handle = this._next as Handle;

        this._next += 1;
        this._reverse.set(node, handle);

        return handle;
    }
}

/** The shared production registry. Rebuilt together with the seams by {@link DOM.reset}. */
let _registry = new HandleRegistry();

/** Forward-map size of the shared production registry; for tests only. @internal */
export function _handleRegistrySize(): number {
    return _registry.size;
}

/**
 * The single terminal style write, shared by the inline-style and patch paths.
 * A hyphenated key is either a custom property (`--foo`) or a standard
 * kebab-case name (`background-color`); both go through `setProperty` /
 * `removeProperty`. Only camelCase keys work through the indexed accessor.
 */
function writeDeclaration(style: CSSStyleDeclaration, key: string, value: string | null): void {
    if (key.includes("-")) {
        if (value === null) {
            style.removeProperty(key);
        } else {
            style.setProperty(key, value);
        }
    } else if (value === null) {
        (style as unknown as Record<string, string>)[key] = "";
    } else {
        (style as unknown as Record<string, string>)[key] = value;
    }
}

/**
 * Applies an {@link ElementPatch} to a resolved element — the terminal raw-DOM
 * write for the batched {@link DOMSink.apply} path. Fixed order: styles, class
 * removals before additions, attribute removals before sets, then dataset /
 * text / scroll.
 */
function applyPatchTo(element: HTMLElement, patch: ElementPatch): void {
    if (patch.style) {
        for (const key of Object.keys(patch.style)) {
            writeDeclaration(element.style, key, patch.style[key]);
        }
    }

    if (patch.removeClass) {
        for (const name of patch.removeClass) {
            element.classList.remove(name);
        }
    }

    if (patch.addClass) {
        for (const name of patch.addClass) {
            element.classList.add(name);
        }
    }

    if (patch.toggleClass) {
        for (const name of Object.keys(patch.toggleClass)) {
            element.classList.toggle(name, patch.toggleClass[name]);
        }
    }

    if (patch.removeAttr) {
        for (const key of patch.removeAttr) {
            element.removeAttribute(key);
        }
    }

    if (patch.setAttr) {
        for (const key of Object.keys(patch.setAttr)) {
            element.setAttribute(key, patch.setAttr[key]);
        }
    }

    if (patch.dataset) {
        for (const key of Object.keys(patch.dataset)) {
            element.dataset[key] = patch.dataset[key];
        }
    }

    if (patch.text !== undefined) {
        element.textContent = patch.text;
    }

    if (patch.scrollLeft !== undefined) {
        element.scrollLeft = patch.scrollLeft;
    }

    if (patch.scrollTop !== undefined) {
        element.scrollTop = patch.scrollTop;
    }
}

/**
 * Fluent accumulator over an {@link ElementPatch}. Each method appends to the
 * pending patch; {@link PatchBuilder.commit} flushes it as one batched write.
 * The fluent form is sugar for cold call sites — the batched {@link DOMSink.apply}
 * is the real primitive — and it allocates one builder per edit.
 *
 * @category Core
 */
export class PatchBuilder {
    private readonly _patch: {
        style?:    Record<string, string | null>;
        addClass?: string[];
        setAttr?:  Record<string, string>;
        text?:     string;
    } = {};

    /**
     * @param _commit - Flush callback that performs the single handle resolve.
     */
    constructor(private readonly _commit: (patch: ElementPatch) => void) {}

    /**
     * Queues an inline-style write (`null` removes).
     *
     * @param key - The CSS property name (camelCase, or `--custom-property`).
     * @param value - The value to set, or null to remove the property.
     * @returns This builder.
     */
    style(key: string, value: string | null): this {
        (this._patch.style ??= {})[key] = value;

        return this;
    }

    /**
     * Queues a class addition.
     *
     * @param name - The class name.
     * @returns This builder.
     */
    addClass(name: string): this {
        (this._patch.addClass ??= []).push(name);

        return this;
    }

    /**
     * Queues an attribute set.
     *
     * @param key - The attribute name.
     * @param value - The attribute value.
     * @returns This builder.
     */
    attr(key: string, value: string): this {
        (this._patch.setAttr ??= {})[key] = value;

        return this;
    }

    /**
     * Queues a text-content write.
     *
     * @param value - The text content.
     * @returns This builder.
     */
    text(value: string): this {
        this._patch.text = value;

        return this;
    }

    /** Flushes the accumulated patch through one batched write (one resolve). */
    commit(): void {
        this._commit(this._patch);
    }
}

/**
 * Terminal DOM-write primitive. Every structural mutation and inline-style
 * write in the framework funnels through this seam instead of touching
 * `element.style` / `element.classList` / `appendChild` directly. The
 * production implementation ({@link ProductionDOMSink}) is a thin pass-through;
 * test implementations record the writes without touching a DOM.
 *
 * @remarks Methods are one-way (no return value drives control flow), so a
 * future worker transport can forward each as a `postMessage`.
 *
 * @category Core
 */
export interface DOMSink {
    /**
     * Writes a single inline style property onto an element. The element's
     * `style` declaration is resolved inside the seam so call sites never touch
     * `element.style` directly.
     *
     * @param element - The target element.
     * @param key - The CSS property name (camelCase, or `--custom-property`).
     * @param value - The value to set, or null to remove the property.
     */
    setStyle(element: HTMLElement | SVGElement, key: string, value: string | null): void;

    /**
     * Writes a single style property onto a `CSSStyleRule`'s declaration. The
     * rule-style counterpart of {@link setStyle} — a `CSSStyleRule` has no
     * element, so it gets its own method.
     *
     * @param rule - The target `CSSStyleRule`.
     * @param key - The CSS property name (camelCase, or `--custom-property`).
     * @param value - The value to set, or null to remove the property.
     */
    setRuleStyle(rule: CSSStyleRule, key: string, value: string | null): void;

    /**
     * Finds, or inserts, the framework's shared-stylesheet `CSSStyleRule` for a
     * selector. Encapsulates the `cssRules` scan and `insertRule` so callers
     * never walk a `CSSStyleSheet` directly; the returned rule is handed to
     * {@link setRuleStyle}.
     *
     * @param selector - The CSS selector text.
     * @returns The existing or newly-inserted rule.
     */
    ensureStyleRule(selector: string): CSSStyleRule;

    /**
     * Inserts a `@keyframes` block into the shared stylesheet if one with the
     * given name does not already exist (idempotent).
     *
     * @param name - The animation name (no `@keyframes` prefix).
     * @param body - The keyframe body (the text between the braces).
     */
    ensureKeyframes(name: string, body: string): void;

    /**
     * Creates a detached HTML element.
     *
     * @param tag - The element tag name.
     * @returns The new element.
     */
    createElement(tag: string): HTMLElement;

    /**
     * Creates a detached namespaced element (SVG sprite / glyph construction).
     *
     * @param ns - The element namespace URI.
     * @param tag - The element tag name.
     * @returns The new element.
     */
    createElementNS(ns: string, tag: string): Element;

    /**
     * Appends a child node to a parent.
     *
     * @param parent - The parent node.
     * @param child - The child node to append.
     */
    appendChild(parent: Node, child: Node): void;

    /**
     * Removes a child node from a parent.
     *
     * @param parent - The parent node.
     * @param child - The child node to remove.
     */
    removeChild(parent: Node, child: Node): void;

    /**
     * Detaches an element from its parent.
     *
     * @param element - The element to remove.
     */
    removeElement(element: Element): void;

    /**
     * Adds a class to an element.
     *
     * @param element - The target element.
     * @param name - The class name to add.
     */
    addClass(element: Element, name: string): void;

    /**
     * Removes a class from an element.
     *
     * @param element - The target element.
     * @param name - The class name to remove.
     */
    removeClass(element: Element, name: string): void;

    /**
     * Toggles a class on an element.
     *
     * @param element - The target element.
     * @param name - The class name to toggle.
     * @param on - When provided, forces the class on (`true`) or off (`false`).
     */
    toggleClass(element: Element, name: string, on?: boolean): void;

    /**
     * Sets an attribute on an element.
     *
     * @param element - The target element.
     * @param key - The attribute name.
     * @param value - The attribute value.
     */
    setAttribute(element: Element, key: string, value: string): void;

    /**
     * Removes an attribute from an element.
     *
     * @param element - The target element.
     * @param key - The attribute name.
     */
    removeAttribute(element: Element, key: string): void;

    /**
     * Sets the text content of a node.
     *
     * @param node - The target node.
     * @param text - The text content.
     */
    setTextContent(node: Node, text: string): void;

    /**
     * Sets an element's native horizontal scroll offset.
     *
     * @param element - The target element.
     * @param value - The desired `scrollLeft` in pixels.
     *
     * @remarks One-way: the browser clamps the offset to the scrollable range.
     * Read the settled value back via {@link DOMSource.getScrollLeft}.
     */
    setScrollLeft(element: Element, value: number): void;

    /**
     * Sets an element's native vertical scroll offset.
     *
     * @param element - The target element.
     * @param value - The desired `scrollTop` in pixels.
     *
     * @remarks One-way; see {@link setScrollLeft}.
     */
    setScrollTop(element: Element, value: number): void;

    /**
     * Moves browser focus to an element.
     *
     * @param element - The element to focus.
     * @param options - Focus options; `preventScroll` suppresses the native
     *   scroll-into-view so a host that owns its own scroll offset is not fought.
     */
    focus(element: HTMLElement, options?: { preventScroll?: boolean }): void;

    /**
     * Removes browser focus from an element.
     *
     * @param element - The element to blur.
     */
    blur(element: HTMLElement): void;

    /**
     * Writes the value of a form control.
     *
     * @param element - The target form control.
     * @param value - The value to set.
     */
    setValue(element: HTMLElement, value: string): void;

    /**
     * Sets the text-selection range of a form control.
     *
     * @param element - The target form control.
     * @param start - The selection start offset.
     * @param end - The selection end offset.
     */
    setSelectionRange(element: HTMLElement, start: number, end: number): void;

    /**
     * Registers a native event listener on a target. The framework's
     * {@link Event} class is the component-level routing layer; this seam covers
     * the low-level native hook it (and a few primitives) sits on.
     *
     * @param target - The event target (element, window, media-query list).
     * @param type - The event type.
     * @param handler - The listener.
     * @param options - Optional capture/passive/once options.
     */
    addListener<T extends Event = Event>(target: EventTarget, type: string, handler: (event: T) => void, options?: boolean | AddEventListenerOptions): void;

    /**
     * Removes a native event listener previously registered with {@link addListener}.
     *
     * @param target - The event target.
     * @param type - The event type.
     * @param handler - The listener to remove.
     * @param options - Optional capture options matching the registration.
     */
    removeListener<T extends Event = Event>(target: EventTarget, type: string, handler: (event: T) => void, options?: boolean | EventListenerOptions): void;

    /**
     * Dispatches an event on a target.
     *
     * @param target - The event target.
     * @param event - The event to dispatch.
     */
    dispatchEvent(target: EventTarget, event: Event): void;

    /**
     * Schedules a callback for the next animation frame.
     *
     * @param callback - The frame callback.
     * @returns The request handle, for {@link cancelAnimationFrame}.
     */
    requestAnimationFrame(callback: FrameRequestCallback): number;

    /**
     * Cancels a previously scheduled animation-frame callback.
     *
     * @param handle - The handle returned by {@link requestAnimationFrame}.
     */
    cancelAnimationFrame(handle: number): void;

    /**
     * Sets an element's `id`.
     *
     * @param element - The target element.
     * @param id - The id to set.
     */
    setId(element: Element, id: string): void;

    /**
     * Inserts a node before a reference child of a parent.
     *
     * @param parent - The parent node.
     * @param node - The node to insert.
     * @param reference - The child to insert before, or null to append.
     */
    insertBefore(parent: Node, node: Node, reference: Node | null): void;

    /**
     * Writes a `data-*` attribute via the element's dataset.
     *
     * @param element - The target element.
     * @param key - The dataset key (camelCase).
     * @param value - The value to set.
     */
    setDataset(element: HTMLElement, key: string, value: string): void;

    /**
     * Creates an empty document fragment for batched insertion.
     *
     * @returns The new fragment.
     */
    createDocumentFragment(): DocumentFragment;

    /**
     * Synthesises a click on an element (file-input open, download anchor).
     *
     * @param element - The element to click.
     */
    click(element: HTMLElement): void;

    /**
     * Sets the selected option index of a `<select>`.
     *
     * @param element - The select element.
     * @param index - The zero-based option index.
     */
    setSelectedIndex(element: HTMLSelectElement, index: number): void;

    /**
     * Routes subsequent pointer events for a pointer id to an element.
     *
     * @param element - The capturing element.
     * @param pointerId - The pointer id to capture.
     */
    setPointerCapture(element: Element, pointerId: number): void;

    /**
     * Releases a pointer capture previously set on an element.
     *
     * @param element - The element holding the capture.
     * @param pointerId - The pointer id to release.
     */
    releasePointerCapture(element: Element, pointerId: number): void;
}

/**
 * Read seam. Geometry is keyed on the owning {@link Component} (so a model can
 * reproduce it from committed state); text metrics, theme variables, and
 * environment constants funnel through the remaining methods. The production
 * implementation ({@link ProductionDOMSource}) reads the live DOM; test
 * implementations answer from a geometry model and a baked metrics table.
 *
 * @category Core
 */
export interface DOMSource {
    /**
     * Returns the viewport-space rectangle of a component's root element.
     *
     * @param component - The component to measure.
     * @returns The component's bounding rectangle as plain data.
     */
    getViewportRect(component: Component): Rect;

    /**
     * Returns the viewport-space rectangle of an arbitrary element. Escape
     * hatch for non-component nodes (anchor elements, ancestor scroll boxes).
     *
     * @param element - The element to measure.
     * @returns The element's bounding rectangle as plain data.
     */
    getElementRect(element: Element): Rect;

    /**
     * Measures the rendered size and baseline of a text string.
     *
     * @param text - The string to measure.
     * @param options - Font properties; default to the active theme variables.
     * @returns The measured `{width, height, baseline}` in pixels.
     */
    measureText(text: string, options?: TextMeasureOptions): TextMetrics;

    /**
     * Resolves a CSS `font-size` value (possibly a `calc()`/`var()`) to a pixel
     * number by evaluating it on an off-screen probe.
     *
     * @param fontSizeCSS - A CSS font-size value.
     * @returns The resolved size in pixels (14 when unresolvable).
     */
    resolveFontSizePx(fontSizeCSS: string): number;

    /**
     * Returns the active font's vertical metrics in pixels.
     *
     * @returns The font `{ascent, descent, capTop}` in pixels.
     */
    measureFontMetrics(): { ascent: number; descent: number; capTop: number };

    /**
     * Resolves a theme CSS variable (e.g. `--ts-ui-font-size`) to its value.
     *
     * @param name - The CSS custom-property name, including the leading `--`.
     * @returns The resolved value, trimmed; empty string when unset.
     */
    getThemeVar(name: string): string;

    /**
     * Returns the current viewport size in pixels.
     *
     * @returns The viewport `{width, height}`.
     */
    getViewportSize(): Size;

    /**
     * Returns the native scrollbar width in pixels.
     *
     * @returns The scrollbar width.
     */
    getScrollBarWidth(): number;

    /**
     * Whether this is a modelled (no-browser) source. Lets the few
     * irreducibly-browser reads short-circuit to a fallback offline.
     *
     * @returns `true` for a modelled source, `false` for production.
     */
    isModelled(): boolean;

    /**
     * Reads an element's native horizontal scroll offset (browser-clamped).
     *
     * @param element - The element to read.
     * @returns The current `scrollLeft` in pixels.
     */
    getScrollLeft(element: Element): number;

    /**
     * Reads an element's native vertical scroll offset (browser-clamped).
     *
     * @param element - The element to read.
     * @returns The current `scrollTop` in pixels.
     */
    getScrollTop(element: Element): number;

    /**
     * Reads an element's scroll offsets, scrollable content size, and visible
     * viewport size in one shot.
     *
     * @param element - The element to measure.
     * @returns The element's {@link ScrollMetrics} as plain data.
     */
    getScrollMetrics(element: Element): ScrollMetrics;

    /**
     * Reads an element's offset-box top edge and height.
     *
     * @param element - The element to measure.
     * @returns The element's {@link OffsetSize} as plain data.
     */
    getOffsetSize(element: Element): OffsetSize;

    /**
     * Whether an element is currently attached to a document.
     *
     * @param element - The element to test.
     * @returns `true` when the element is connected.
     */
    isConnected(element: Element): boolean;

    /**
     * Reads the value of a form control.
     *
     * @param element - The form control to read.
     * @returns The control's current value.
     */
    getValue(element: HTMLElement): string;

    /**
     * Returns the element that currently has focus, or null.
     *
     * @returns The active element, or null when nothing is focused.
     */
    getActiveElement(): Element | null;

    /**
     * Evaluates a media query, returning its current match state and a
     * change-subscription hook. The live `MediaQueryList` never escapes the seam.
     *
     * @param query - The media-query string.
     * @returns The match state and a `change` subscription.
     */
    matchMedia(query: string): MediaQueryResult;

    /**
     * Whether an event target is the global `window` (identity check that keeps
     * the raw global out of call sites).
     *
     * @param target - The target to test.
     * @returns `true` when the target is `window`.
     */
    isWindow(target: EventTarget | null): boolean;

    /**
     * Returns the global `window` as an event target, so window-level listeners
     * can be registered without a call site naming the raw global.
     *
     * @returns The `window` event target.
     */
    getWindow(): Window;

    /**
     * Whether a node is the ancestor of (or equal to) another node.
     *
     * @param ancestor - The candidate ancestor.
     * @param node - The node to test, or null.
     * @returns `true` when `ancestor` contains `node`.
     */
    contains(ancestor: Node, node: Node | null): boolean;

    /**
     * Finds the first descendant of `root` matching a selector.
     *
     * @param root - The subtree root.
     * @param selector - The CSS selector.
     * @returns The first match, or null.
     */
    querySelector(root: ParentNode, selector: string): Element | null;

    /**
     * Finds all descendants of `root` matching a selector, as a plain array.
     *
     * @param root - The subtree root.
     * @param selector - The CSS selector.
     * @returns The matches (a snapshot array, never a live `NodeList`).
     */
    querySelectorAll(root: ParentNode, selector: string): Element[];

    /**
     * Returns an element's parent element, or null.
     *
     * @param element - The element to read.
     * @returns The parent element, or null.
     */
    getParentElement(element: Element): Element | null;

    /**
     * Returns a node's parent node, or null.
     *
     * @param node - The node to read.
     * @returns The parent node, or null.
     */
    getParentNode(node: Node): Node | null;

    /**
     * Returns a node's first child, or null.
     *
     * @param node - The node to read.
     * @returns The first child, or null.
     */
    getFirstChild(node: Node): Node | null;

    /**
     * Returns an element's resolved border widths as computed-style strings
     * (e.g. `"1px"`), one per side.
     *
     * @param element - The element to measure.
     * @returns The four border-width strings.
     */
    getBorderWidths(element: Element): { top: string; right: string; bottom: string; left: string };

    /**
     * Returns an element's resolved `overflow` / `overflow-x` / `overflow-y`
     * computed-style strings.
     *
     * @param element - The element to read.
     * @returns The three overflow strings.
     */
    getComputedOverflow(element: Element): { overflow: string; overflowX: string; overflowY: string };

    /**
     * Reads a single inline style property off an element.
     *
     * @param element - The element to read.
     * @param key - The CSS property name (camelCase, or `--custom-property`).
     * @returns The inline value (empty string when unset).
     */
    getInlineStyle(element: HTMLElement, key: string): string;

    /**
     * Returns the document's root `<html>` element — the mount point for
     * top-layer overlays.
     *
     * @returns The document element.
     */
    getDocumentElement(): HTMLElement;

    /**
     * Returns the document `<body>` element.
     *
     * @returns The body element.
     */
    getBody(): HTMLElement;

    /**
     * Returns the document `<head>` element.
     *
     * @returns The head element.
     */
    getHead(): HTMLElement;

    /**
     * Looks up an element by its `id`.
     *
     * @param id - The element id (no `#` prefix).
     * @returns The matching element, or null.
     */
    getElementById(id: string): HTMLElement | null;

    /**
     * Reads an element's `id`.
     *
     * @param element - The element to read.
     * @returns The element's id (empty string when unset).
     */
    getId(element: Element): string;

    /**
     * Reads a `data-*` attribute via the element's dataset.
     *
     * @param element - The element to read.
     * @param key - The dataset key (camelCase).
     * @returns The value, or undefined when unset.
     */
    getDataset(element: HTMLElement, key: string): string | undefined;

    /**
     * Reads an element's tag name (uppercase).
     *
     * @param element - The element to read.
     * @returns The tag name.
     */
    getTagName(element: Element): string;

    /**
     * Whether an element has a given attribute.
     *
     * @param element - The element to test.
     * @param key - The attribute name.
     * @returns `true` when the attribute is present.
     */
    hasAttribute(element: Element, key: string): boolean;

    /**
     * Reads an attribute value.
     *
     * @param element - The element to read.
     * @param key - The attribute name.
     * @returns The value, or null when unset.
     */
    getAttribute(element: Element, key: string): string | null;

    /**
     * Reads a `<select>`'s selected option index.
     *
     * @param element - The select element.
     * @returns The zero-based selected index.
     */
    getSelectedIndex(element: HTMLSelectElement): number;

    /**
     * Reads a `data-*` value off a `<select>`'s currently-selected option.
     *
     * @param element - The select element.
     * @param key - The dataset key (camelCase).
     * @returns The selected option's dataset value, or undefined.
     */
    getSelectedOptionDataset(element: HTMLSelectElement, key: string): string | undefined;

    /**
     * Reads an image's intrinsic pixel size.
     *
     * @param element - The image element.
     * @returns The natural `{width, height}` in pixels.
     */
    getNaturalSize(element: HTMLImageElement): { width: number; height: number };

    /**
     * Reads the selected files of a file input.
     *
     * @param element - The file-input element.
     * @returns The selected `FileList`, or null.
     */
    getFiles(element: HTMLInputElement): FileList | null;

    /**
     * Whether an element currently holds a given pointer capture.
     *
     * @param element - The element to test.
     * @param pointerId - The pointer id.
     * @returns `true` when the element captures the pointer.
     */
    hasPointerCapture(element: Element, pointerId: number): boolean;

    /**
     * Returns the stack of elements at a viewport point (hit-testing).
     *
     * @param x - The viewport x coordinate.
     * @param y - The viewport y coordinate.
     * @returns The elements at the point, topmost first.
     */
    elementsFromPoint(x: number, y: number): Element[];
}

/**
 * Seam-friendly result of {@link DOMSource.matchMedia}: the current match state
 * plus a change subscription, so the live `MediaQueryList` stays behind the seam.
 *
 * @category Core
 */
export interface MediaQueryResult {
    /** Whether the query currently matches. */
    matches: boolean;
    /**
     * Subscribes to match-state changes.
     *
     * @param handler - Called on each `change` of the query.
     */
    addChangeListener(handler: (event: MediaQueryListEvent) => void): void;
}

/**
 * Boxes a live `DOMRect` into a plain {@link Rect}, preserving every edge.
 */
function toRect(domRect: DOMRect): Rect {
    return {
        x:      domRect.x,
        y:      domRect.y,
        width:  domRect.width,
        height: domRect.height,
        top:    domRect.top,
        left:   domRect.left,
        right:  domRect.right,
        bottom: domRect.bottom
    };
}

/**
 * Production {@link DOMSink}: every method is a one-line pass-through to the
 * native DOM, behaving bit-for-bit like the pre-seam direct writes.
 *
 * @category Core
 */
export class ProductionDOMSink implements DOMSink {
    /**
     * Applies a batch of mutations to one element with a single handle resolve.
     * The hot-path primitive — a layout commit (width + height + classes + an
     * attribute) costs one `Map.get`, not one per write.
     *
     * @param handle - The target element handle.
     * @param patch - The batch of mutations.
     */
    apply(handle: Handle, patch: ElementPatch): void {
        applyPatchTo(_registry.resolve(handle) as HTMLElement, patch);
    }

    /**
     * Fluent convenience that accumulates a patch and flushes it through a
     * single {@link ProductionDOMSink.apply}. For cold call sites — it allocates
     * one builder per edit.
     *
     * @param handle - The target element handle.
     * @returns A builder whose `commit()` performs the single resolve.
     */
    edit(handle: Handle): PatchBuilder {
        return new PatchBuilder((patch) => this.apply(handle, patch));
    }

    /**
     * Releases an owned (retained) handle at its element's dispose site.
     *
     * @param handle - The handle to release.
     */
    release(handle: Handle): void {
        _registry.release(handle);
    }

    /** @inheritDoc */
    setStyle(element: HTMLElement | SVGElement, key: string, value: string | null): void {
        writeDeclaration(element.style, key, value);
    }

    /** @inheritDoc */
    setRuleStyle(rule: CSSStyleRule, key: string, value: string | null): void {
        writeDeclaration(rule.style, key, value);
    }

    /** @inheritDoc */
    ensureStyleRule(selector: string): CSSStyleRule {
        const sheet = this.mainSheet();

        for (let idx = 0; idx < sheet.cssRules.length; idx += 1) {
            const rule = sheet.cssRules[idx] as CSSStyleRule;

            if (rule.selectorText === selector) {
                return rule;
            }
        }

        const insertedAt = sheet.insertRule(selector + "{}", sheet.cssRules.length);

        return sheet.cssRules[insertedAt] as CSSStyleRule;
    }

    /** @inheritDoc */
    ensureKeyframes(name: string, body: string): void {
        const sheet = this.mainSheet();

        for (let idx = 0; idx < sheet.cssRules.length; idx += 1) {
            const rule = sheet.cssRules[idx] as CSSKeyframesRule;

            if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === name) {
                return;
            }
        }

        sheet.insertRule('@keyframes ' + name + ' { ' + body + ' }', sheet.cssRules.length);
    }

    /**
     * Returns the framework's shared `<style id="Base">` stylesheet, creating
     * the `<head>` and `<style>` element on first call. The lone place the
     * framework touches a `CSSStyleSheet` — relocated here from `StyleTarget`
     * so the stylesheet plumbing lives behind the seam.
     */
    private mainSheet(): CSSStyleSheet {
        let head = document.getElementsByTagName("head")[0] as HTMLHeadElement;

        if (!head) {
            head = document.createElement("head");
            document.appendChild(head);
        }

        let style: HTMLStyleElement | null = null;
        const styles = head.getElementsByTagName("style");

        for (let idx = 0; idx < styles.length; idx += 1) {
            if (styles[idx].id === "Base") {
                style = styles[idx];
            }
        }

        if (!style) {
            style = document.createElement("style");
            style.id = "Base";
            head.appendChild(style);
        }

        return style.sheet as CSSStyleSheet;
    }

    /** @inheritDoc */
    createElement(tag: string): HTMLElement {
        return document.createElement(tag);
    }

    /** @inheritDoc */
    createElementNS(ns: string, tag: string): Element {
        return document.createElementNS(ns, tag);
    }

    /** @inheritDoc */
    appendChild(parent: Node, child: Node): void {
        parent.appendChild(child);
    }

    /** @inheritDoc */
    removeChild(parent: Node, child: Node): void {
        parent.removeChild(child);
    }

    /** @inheritDoc */
    removeElement(element: Element): void {
        element.remove();
    }

    /** @inheritDoc */
    addClass(element: Element, name: string): void {
        element.classList.add(name);
    }

    /** @inheritDoc */
    removeClass(element: Element, name: string): void {
        element.classList.remove(name);
    }

    /** @inheritDoc */
    toggleClass(element: Element, name: string, on?: boolean): void {
        element.classList.toggle(name, on);
    }

    /** @inheritDoc */
    setAttribute(element: Element, key: string, value: string): void {
        element.setAttribute(key, value);
    }

    /** @inheritDoc */
    removeAttribute(element: Element, key: string): void {
        element.removeAttribute(key);
    }

    /** @inheritDoc */
    setTextContent(node: Node, text: string): void {
        node.textContent = text;
    }

    /** @inheritDoc */
    setScrollLeft(element: Element, value: number): void {
        element.scrollLeft = value;
    }

    /** @inheritDoc */
    setScrollTop(element: Element, value: number): void {
        element.scrollTop = value;
    }

    /** @inheritDoc */
    focus(element: HTMLElement, options?: { preventScroll?: boolean }): void {
        element.focus(options);
    }

    /** @inheritDoc */
    blur(element: HTMLElement): void {
        element.blur();
    }

    /** @inheritDoc */
    setValue(element: HTMLElement, value: string): void {
        (element as HTMLInputElement).value = value;
    }

    /** @inheritDoc */
    setSelectionRange(element: HTMLElement, start: number, end: number): void {
        (element as HTMLInputElement).setSelectionRange(start, end);
    }

    /** @inheritDoc */
    addListener<T extends Event = Event>(target: EventTarget, type: string, handler: (event: T) => void, options?: boolean | AddEventListenerOptions): void {
        target.addEventListener(type, handler as EventListener, options);
    }

    /** @inheritDoc */
    removeListener<T extends Event = Event>(target: EventTarget, type: string, handler: (event: T) => void, options?: boolean | EventListenerOptions): void {
        target.removeEventListener(type, handler as EventListener, options);
    }

    /** @inheritDoc */
    dispatchEvent(target: EventTarget, event: Event): void {
        target.dispatchEvent(event);
    }

    /** @inheritDoc */
    requestAnimationFrame(callback: FrameRequestCallback): number {
        return requestAnimationFrame(callback);
    }

    /** @inheritDoc */
    cancelAnimationFrame(handle: number): void {
        cancelAnimationFrame(handle);
    }

    /** @inheritDoc */
    setId(element: Element, id: string): void {
        element.id = id;
    }

    /** @inheritDoc */
    insertBefore(parent: Node, node: Node, reference: Node | null): void {
        parent.insertBefore(node, reference);
    }

    /** @inheritDoc */
    setDataset(element: HTMLElement, key: string, value: string): void {
        element.dataset[key] = value;
    }

    /** @inheritDoc */
    createDocumentFragment(): DocumentFragment {
        return document.createDocumentFragment();
    }

    /** @inheritDoc */
    click(element: HTMLElement): void {
        element.click();
    }

    /** @inheritDoc */
    setSelectedIndex(element: HTMLSelectElement, index: number): void {
        element.selectedIndex = index;
    }

    /** @inheritDoc */
    setPointerCapture(element: Element, pointerId: number): void {
        element.setPointerCapture(pointerId);
    }

    /** @inheritDoc */
    releasePointerCapture(element: Element, pointerId: number): void {
        element.releasePointerCapture(pointerId);
    }
}

/**
 * Production {@link DOMSource}: reads the live DOM and delegates text
 * measurement to the existing {@link Util} canvas/probe code.
 *
 * @category Core
 */
export class ProductionDOMSource implements DOMSource {
    /**
     * Converts a raw browser node arriving at an event boundary into a (weak)
     * handle. The one place a `Node` legitimately enters the seam from outside —
     * the event system hands it `evnt.target`, and the handle is interned so no
     * call site downstream holds the raw node.
     *
     * @param target - The browser-supplied node.
     * @returns Its canonical handle.
     */
    intern(target: Node): Handle {
        return _registry.intern(target);
    }

    /** @inheritDoc */
    getViewportRect(component: Component): Rect {
        return toRect(component.getElement()!.getBoundingClientRect());
    }

    /** @inheritDoc */
    getElementRect(element: Element): Rect {
        return toRect(element.getBoundingClientRect());
    }

    /** @inheritDoc */
    measureText(text: string, options: TextMeasureOptions = {}): TextMetrics {
        const {
            fontFamily  = "var(--ts-ui-font-family, system-ui, sans-serif)",
            fontSize    = "var(--ts-ui-font-size, 14px)",
            fontWeight  = "normal",
            fontStyle   = "normal",
            fontVariant = "normal",
            fontStretch = "normal",
            lineHeight  = "calc(1em + var(--ts-ui-line-padding, 2px))",
            maxWidth,
        } = options;

        const probe = document.createElement("span");

        _applyProbeStyles(probe, {
            position:    "fixed",
            visibility:  "hidden",
            // With a wrap width the probe must honour `\n` and soft-wrap so the
            // measured height covers every visual line; otherwise stay on a
            // single `nowrap` line for the natural-size measurement.
            whiteSpace:  maxWidth === undefined ? "nowrap" : "pre-wrap",
            width:       maxWidth === undefined ? "" : `${maxWidth}px`,
            fontFamily, fontSize, fontWeight, fontStyle, fontVariant, fontStretch, lineHeight,
        });

        probe.textContent = text;

        const ref = document.createElement("span");

        _applyProbeStyles(ref, {
            display:       "inline-block",
            width:         "0",
            height:        "0",
            verticalAlign: "baseline",
        });

        probe.appendChild(ref);
        document.body.appendChild(probe);

        const probeRect = probe.getBoundingClientRect();
        const refRect   = ref.getBoundingClientRect();

        document.body.removeChild(probe);

        return {
            width:    Math.ceil(probeRect.width),
            height:   Math.ceil(probeRect.height),
            baseline: Math.round(refRect.top - probeRect.top),
        };
    }

    /** @inheritDoc */
    resolveFontSizePx(fontSizeCSS: string): number {
        const probe = document.createElement("span");

        _applyProbeStyles(probe, { position: "fixed", visibility: "hidden", fontSize: fontSizeCSS });

        document.body.appendChild(probe);
        const px = parseFloat(getComputedStyle(probe).fontSize);
        document.body.removeChild(probe);

        return isNaN(px) ? 14 : px;   // 14 mirrors the base font fallback
    }

    /** @inheritDoc */
    measureFontMetrics(): { ascent: number; descent: number; capTop: number } {
        if (_metricsCtx === null) {
            _metricsCtx = document.createElement("canvas").getContext("2d");
        }

        const ctx = _metricsCtx as CanvasRenderingContext2D;

        // 14px / system-ui mirror the `--ts-ui-font-*` defaults shipped by the
        // themes; they only apply when the computed value is empty (pre-apply).
        const family = this.getThemeVar("--ts-ui-font-family") || "system-ui, sans-serif";
        const size   = this.getThemeVar("--ts-ui-font-size")   || "14px";

        ctx.font = `normal normal ${size} ${family}`;

        const m = ctx.measureText("X");

        const hasFontBox = typeof m.fontBoundingBoxAscent === "number";
        const ascent     = hasFontBox ? m.fontBoundingBoxAscent  : m.actualBoundingBoxAscent;
        const descent    = hasFontBox ? m.fontBoundingBoxDescent : m.actualBoundingBoxDescent;

        return { ascent, descent, capTop: m.actualBoundingBoxAscent };
    }

    /** @inheritDoc */
    getThemeVar(name: string): string {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    /** @inheritDoc */
    getViewportSize(): Size {
        const width  = Math.max(document.documentElement.clientWidth,  window.innerWidth  || 0);
        const height = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

        return { width, height };
    }

    /** @inheritDoc */
    getScrollBarWidth(): number {
        if (_scrollBarWidth >= 0) {
            return _scrollBarWidth;
        }

        const outer = document.createElement("div");

        _applyProbeStyles(outer, {
            position: "absolute",
            top:      "-1000px",
            left:     "-1000px",
            width:    "100px",
            height:   "50px",
            overflow: "hidden",
        });

        const inner = document.createElement("div");

        _applyProbeStyles(inner, { width: "100%", height: "200px" });

        outer.appendChild(inner);
        document.body.appendChild(outer);

        const widthNoScroll = inner.offsetWidth;

        _applyProbeStyles(outer, { overflow: "auto" });

        const widthScroll = inner.offsetWidth;

        document.body.removeChild(outer);

        _scrollBarWidth = widthNoScroll - widthScroll;

        return _scrollBarWidth;
    }

    /** @inheritDoc */
    isModelled(): boolean {
        return false;
    }

    /** @inheritDoc */
    getScrollLeft(element: Element): number {
        return element.scrollLeft;
    }

    /** @inheritDoc */
    getScrollTop(element: Element): number {
        return element.scrollTop;
    }

    /** @inheritDoc */
    getScrollMetrics(element: Element): ScrollMetrics {
        return {
            scrollTop:    element.scrollTop,
            scrollLeft:   element.scrollLeft,
            scrollWidth:  element.scrollWidth,
            scrollHeight: element.scrollHeight,
            clientWidth:  element.clientWidth,
            clientHeight: element.clientHeight
        };
    }

    /** @inheritDoc */
    getOffsetSize(element: Element): OffsetSize {
        const el = element as HTMLElement;

        return {
            offsetTop:    el.offsetTop,
            offsetHeight: el.offsetHeight
        };
    }

    /** @inheritDoc */
    isConnected(element: Element): boolean {
        return element.isConnected;
    }

    /** @inheritDoc */
    getValue(element: HTMLElement): string {
        return (element as HTMLInputElement).value;
    }

    /** @inheritDoc */
    getActiveElement(): Element | null {
        return document.activeElement;
    }

    /** @inheritDoc */
    matchMedia(query: string): MediaQueryResult {
        // Non-browser environments (SSR, workers, bare Node) have no
        // `matchMedia`; degrade to an inert result so callers need no
        // environment guard of their own — the capability check lives here, in
        // the seam, rather than leaking a raw `window` probe into call sites.
        if (typeof matchMedia !== "function") {
            return { matches: false, addChangeListener: (): void => {} };
        }

        const mql = matchMedia(query);

        return {
            matches: mql.matches,
            addChangeListener(handler: (event: MediaQueryListEvent) => void): void {
                mql.addEventListener("change", handler);
            }
        };
    }

    /** @inheritDoc */
    isWindow(target: EventTarget | null): boolean {
        return target === window;
    }

    /** @inheritDoc */
    getWindow(): Window {
        return window;
    }

    /** @inheritDoc */
    contains(ancestor: Node, node: Node | null): boolean {
        return ancestor.contains(node);
    }

    /** @inheritDoc */
    querySelector(root: ParentNode, selector: string): Element | null {
        return root.querySelector(selector);
    }

    /** @inheritDoc */
    querySelectorAll(root: ParentNode, selector: string): Element[] {
        return Array.from(root.querySelectorAll(selector));
    }

    /** @inheritDoc */
    getParentElement(element: Element): Element | null {
        return element.parentElement;
    }

    /** @inheritDoc */
    getParentNode(node: Node): Node | null {
        return node.parentNode;
    }

    /** @inheritDoc */
    getFirstChild(node: Node): Node | null {
        return node.firstChild;
    }

    /** @inheritDoc */
    getBorderWidths(element: Element): { top: string; right: string; bottom: string; left: string } {
        const cs = getComputedStyle(element);

        return {
            top:    cs.borderTopWidth,
            right:  cs.borderRightWidth,
            bottom: cs.borderBottomWidth,
            left:   cs.borderLeftWidth
        };
    }

    /** @inheritDoc */
    getComputedOverflow(element: Element): { overflow: string; overflowX: string; overflowY: string } {
        const cs = getComputedStyle(element);

        return {
            overflow:  cs.overflow,
            overflowX: cs.overflowX,
            overflowY: cs.overflowY
        };
    }

    /** @inheritDoc */
    getInlineStyle(element: HTMLElement, key: string): string {
        if (key.includes("-")) {
            return element.style.getPropertyValue(key);
        }

        return (element.style as any)[key];
    }

    /** @inheritDoc */
    getDocumentElement(): HTMLElement {
        return document.documentElement;
    }

    /** @inheritDoc */
    getBody(): HTMLElement {
        return document.body;
    }

    /** @inheritDoc */
    getHead(): HTMLElement {
        return document.head;
    }

    /** @inheritDoc */
    getElementById(id: string): HTMLElement | null {
        return document.getElementById(id);
    }

    /** @inheritDoc */
    getId(element: Element): string {
        return element.id;
    }

    /** @inheritDoc */
    getDataset(element: HTMLElement, key: string): string | undefined {
        return element.dataset[key];
    }

    /** @inheritDoc */
    getTagName(element: Element): string {
        return element.tagName;
    }

    /** @inheritDoc */
    hasAttribute(element: Element, key: string): boolean {
        return element.hasAttribute(key);
    }

    /** @inheritDoc */
    getAttribute(element: Element, key: string): string | null {
        return element.getAttribute(key);
    }

    /** @inheritDoc */
    getSelectedIndex(element: HTMLSelectElement): number {
        return element.selectedIndex;
    }

    /** @inheritDoc */
    getSelectedOptionDataset(element: HTMLSelectElement, key: string): string | undefined {
        return (element[element.selectedIndex] as HTMLElement | undefined)?.dataset[key];
    }

    /** @inheritDoc */
    getNaturalSize(element: HTMLImageElement): { width: number; height: number } {
        return { width: element.naturalWidth, height: element.naturalHeight };
    }

    /** @inheritDoc */
    getFiles(element: HTMLInputElement): FileList | null {
        return element.files;
    }

    /** @inheritDoc */
    hasPointerCapture(element: Element, pointerId: number): boolean {
        return element.hasPointerCapture(pointerId);
    }

    /** @inheritDoc */
    elementsFromPoint(x: number, y: number): Element[] {
        return document.elementsFromPoint(x, y);
    }
}

/**
 * The shape of the global {@link DOM} swap point.
 *
 * @category Core
 */
export interface DOMSeams {
    /** The active write seam. Defaults to a {@link ProductionDOMSink}. */
    sink: DOMSink;
    /** The active read seam. Defaults to a {@link ProductionDOMSource}. */
    source: DOMSource;
    /**
     * Swaps in test implementations. Omitted seams keep their current value.
     *
     * @param impls - The sink and/or source to install.
     */
    install(impls: { sink?: DOMSink; source?: DOMSource }): void;
    /** Restores the production implementations. */
    reset(): void;
}

/**
 * Global swap point for the DOM seams, mirroring `ThemeManager`'s active-theme
 * singleton. Production code reads {@link DOM.sink} / {@link DOM.source}; test
 * setup swaps them via {@link DOM.install} and restores via {@link DOM.reset}.
 *
 * @remarks A mutable-property `const` object rather than a `namespace` with
 * `export let`: the latter is not supported by the Oxc transformer the Vite
 * build uses. The binding is stable; the `sink` / `source` properties are the
 * swappable state.
 *
 * @category Core
 */
export const DOM: DOMSeams = {
    sink:   new ProductionDOMSink(),
    source: new ProductionDOMSource(),

    install(impls: { sink?: DOMSink; source?: DOMSource }): void {
        if (impls.sink) {
            DOM.sink = impls.sink;
        }

        if (impls.source) {
            DOM.source = impls.source;
        }
    },

    reset(): void {
        // Rebuild the shared registry alongside the seams so a test never
        // resolves a handle minted against the previous DOM.
        _registry  = new HandleRegistry();
        DOM.sink   = new ProductionDOMSink();
        DOM.source = new ProductionDOMSource();
    },
};
