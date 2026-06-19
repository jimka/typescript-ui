// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Util } from "~/core/Util.js";
import type { TextMeasureOptions, TextMetrics } from "~/core/Util.js";
import type { Size } from "~/primitive/Size.js";
import type { Component } from "~/core/Component.js";

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
     * Writes a single style property onto a live `style` declaration.
     *
     * @param style - The target `CSSStyleDeclaration` (inline or rule).
     * @param key - The CSS property name (camelCase, or `--custom-property`).
     * @param value - The value to set, or null to remove the property.
     */
    setStyle(style: CSSStyleDeclaration, key: string, value: string | null): void;

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
     * Writes a single style property onto a live `style` declaration — the
     * verbatim body of the former `StyleTarget.write`.
     *
     * @param style - The target `CSSStyleDeclaration`.
     * @param key - The CSS property name (camelCase, or `--custom-property`).
     * @param value - The value to set, or null to remove the property.
     *
     * @remarks Custom properties (`--foo`) must go through
     * `setProperty`/`removeProperty`; the indexed accessor only works for
     * camelCase keys.
     */
    setStyle(style: CSSStyleDeclaration, key: string, value: string | null): void {
        if (key.startsWith("--")) {
            if (value === null) {
                style.removeProperty(key);
            } else {
                style.setProperty(key, value);
            }
        } else {
            if (value === null) {
                (style as any)[key] = "";
            } else {
                (style as any)[key] = value;
            }
        }
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
}

/**
 * Production {@link DOMSource}: reads the live DOM and delegates text
 * measurement to the existing {@link Util} canvas/probe code.
 *
 * @category Core
 */
export class ProductionDOMSource implements DOMSource {
    /** @inheritDoc */
    getViewportRect(component: Component): Rect {
        return toRect(component.getElement()!.getBoundingClientRect());
    }

    /** @inheritDoc */
    getElementRect(element: Element): Rect {
        return toRect(element.getBoundingClientRect());
    }

    /** @inheritDoc */
    measureText(text: string, options?: TextMeasureOptions): TextMetrics {
        return Util.measureTextMetrics(text, options);
    }

    /** @inheritDoc */
    measureFontMetrics(): { ascent: number; descent: number; capTop: number } {
        return Util.measureFontMetrics();
    }

    /** @inheritDoc */
    getThemeVar(name: string): string {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    /** @inheritDoc */
    getViewportSize(): Size {
        return Util.getViewportSize();
    }

    /** @inheritDoc */
    getScrollBarWidth(): number {
        return Util.getScrollBarWidth();
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
        DOM.sink   = new ProductionDOMSink();
        DOM.source = new ProductionDOMSource();
    },
};
