// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { TextMeasureOptions, TextMeasureRequest, TextMetrics } from "~/core/Util.js";
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
 * Plain snapshot of a media element's playback state, read in one shot through
 * {@link DOMSource.getMediaState}. Deliberately *not* a live element: like
 * {@link ScrollMetrics}, the read seam returns plain data so the same call can
 * be answered by a media model (offline tests) or across a worker boundary.
 *
 * @category Core
 */
export interface MediaState {
    /** Current playback position in seconds. */
    currentTime:  number;
    /** Total media duration in seconds (`NaN` before metadata loads). */
    duration:     number;
    /** Whether playback is currently paused. */
    paused:       boolean;
    /** Whether playback has reached the end of the media. */
    ended:        boolean;
    /** Current audio volume in `[0, 1]`. */
    volume:       number;
    /** Whether audio is muted. */
    muted:        boolean;
    /** Current playback speed multiplier (`1` is normal speed). */
    playbackRate: number;
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
 * A timer id as returned by the host's `setTimeout`. Node and the browser
 * disagree on the concrete type (`Timeout` object vs `number`), so the seam
 * carries whichever the host produces rather than committing to one.
 *
 * @category Core
 */
export type TimerId = ReturnType<typeof setTimeout>;

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
 * Module-private, never appended to the document: a detached element whose
 * inline style is a real `CSSStyleDeclaration`. Writing to it costs nothing at
 * the document level, so a bag can be merged property-by-property here and
 * land on the shared sheet as one mutation.
 */
let _scratch: CSSStyleDeclaration | null = null;

function scratchDeclaration(): CSSStyleDeclaration | null {
    if (typeof document === "undefined") {
        return null;
    }

    return _scratch ??= document.createElement("div").style;
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
            // Skip empty tokens: `classList.add("")` throws a SyntaxError. A
            // stray empty class name (e.g. an anonymous class whose
            // `constructor.name` is "") must not abort the whole patch.
            if (name) {
                element.classList.add(name);
            }
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
     * Applies a batch of mutations to one element with a single handle resolve.
     * The hot-path primitive that replaces the ten per-write data setters
     * (`setStyle`, `addClass`, `removeClass`, `toggleClass`, `setAttribute`,
     * `removeAttribute`, `setDataset`, `setTextContent`, `setScrollLeft`,
     * `setScrollTop`): a layout commit (width + height + classes + an attribute)
     * costs one `Map.get`, not one per write.
     *
     * @param handle - The target element handle.
     * @param patch - The batch of mutations.
     */
    apply(handle: Handle, patch: ElementPatch): void;

    /**
     * Fluent convenience that accumulates a patch and flushes it through a
     * single {@link apply}. For cold call sites — it allocates one builder per
     * edit.
     *
     * @param handle - The target element handle.
     * @returns A builder whose `commit()` performs the single resolve.
     */
    edit(handle: Handle): PatchBuilder;

    /**
     * Releases an owned (retained) handle at its element's dispose site.
     *
     * @param handle - The handle to release.
     */
    release(handle: Handle): void;

    /**
     * Writes a bag of style properties onto a `CSSStyleRule`'s declaration as
     * one sheet mutation. A `CSSStyleRule` has no element, so it gets its own
     * method — mirroring how {@link apply}'s `style` patch serves both the
     * single and the bulk element-style path.
     *
     * @param rule - The target `CSSStyleRule`.
     * @param styles - Camel-cased property keys mapped to string values (or
     *   null to remove the property).
     */
    setRuleStyles(rule: CSSStyleRule, styles: Record<string, string | null>): void;

    /**
     * Finds, or inserts, the framework's shared-stylesheet `CSSStyleRule` for a
     * selector, so callers never walk a `CSSStyleSheet` directly. The returned
     * rule is handed to {@link setRuleStyles}.
     *
     * @param selector - The CSS selector text.
     * @returns The existing or newly-inserted rule.
     */
    ensureStyleRule(selector: string): CSSStyleRule;

    /**
     * Removes the shared-stylesheet `CSSStyleRule` for a selector, if present.
     * The inverse of {@link ensureStyleRule}. A no-op when no rule matches.
     *
     * @param selector - The CSS selector text of the rule to remove.
     */
    deleteStyleRule(selector: string): void;

    /**
     * Inserts a `@keyframes` block into the shared stylesheet if one with the
     * given name does not already exist (idempotent).
     *
     * @param name - The animation name (no `@keyframes` prefix).
     * @param body - The keyframe body (the text between the braces).
     */
    ensureKeyframes(name: string, body: string): void;

    /**
     * Creates a detached HTML element, retained behind a handle until released.
     *
     * @param tag - The element tag name.
     * @returns The new element's handle.
     */
    createElement(tag: string): Handle;

    /**
     * Creates a detached namespaced element (SVG sprite / glyph construction),
     * retained behind a handle until released.
     *
     * @param ns - The element namespace URI.
     * @param tag - The element tag name.
     * @returns The new element's handle.
     */
    createElementNS(ns: string, tag: string): Handle;

    /**
     * Appends a child to a parent.
     *
     * @param parent - The parent handle.
     * @param child - The child handle to append.
     */
    appendChild(parent: Handle, child: Handle): void;

    /**
     * Removes a child from a parent.
     *
     * @param parent - The parent handle.
     * @param child - The child handle to remove.
     */
    removeChild(parent: Handle, child: Handle): void;

    /**
     * Detaches an element from its parent.
     *
     * @param handle - The element to remove.
     */
    removeElement(handle: Handle): void;

    /**
     * Moves browser focus to an element.
     *
     * @param handle - The element to focus.
     * @param options - Focus options; `preventScroll` suppresses the native
     *   scroll-into-view so a host that owns its own scroll offset is not fought.
     */
    focus(handle: Handle, options?: { preventScroll?: boolean }): void;

    /**
     * Requests a native form submission on a `<form>` element, firing the
     * cancelable `submit` event and running constraint validation.
     *
     * @param handle - The form element to submit.
     */
    requestSubmit(handle: Handle): void;

    /**
     * Removes browser focus from an element.
     *
     * @param handle - The element to blur.
     */
    blur(handle: Handle): void;

    /**
     * Writes the value of a form control.
     *
     * @param handle - The target form control.
     * @param value - The value to set.
     */
    setValue(handle: Handle, value: string): void;

    /**
     * Sets the text-selection range of a form control.
     *
     * @param handle - The target form control.
     * @param start - The selection start offset.
     * @param end - The selection end offset.
     */
    setSelectionRange(handle: Handle, start: number, end: number): void;

    /**
     * Assigns `location.hash`, pushing a history entry.
     *
     * @param hash - The new hash, including its leading `"#"`.
     */
    setLocationHash(hash: string): void;

    /**
     * Replaces the current history entry with one carrying `hash`, instead of
     * pushing a new one.
     *
     * @param hash - The new hash, including its leading `"#"`.
     */
    replaceLocationHash(hash: string): void;

    /**
     * `history.pushState` with `url`, pushing a history entry. Fires no
     * event — the caller is responsible for applying the new route.
     *
     * @param url - The new path (and optional query/fragment) to push.
     */
    pushHistoryPath(url: string): void;

    /**
     * `history.replaceState` with `url`, replacing the current history
     * entry. Fires no event — the caller is responsible for applying the new
     * route.
     *
     * @param url - The new path (and optional query/fragment) to write.
     */
    replaceHistoryPath(url: string): void;

    /**
     * Writes `text` to the system clipboard. Page-level; no element receiver.
     *
     * @param text - The text to write to the clipboard.
     */
    writeClipboardText(text: string): void;

    /**
     * Clears the document's current text selection. Page-level; no element
     * receiver.
     */
    clearDocumentSelection(): void;

    /**
     * Registers a native event listener on a target. The framework's
     * {@link Event} class is the component-level routing layer; this seam covers
     * the low-level native hook it (and a few primitives) sits on.
     *
     * @param target - The event target handle (element, window, media-query list).
     * @param type - The event type.
     * @param handler - The listener.
     * @param options - Optional capture/passive/once options.
     */
    addListener<T extends Event = Event>(target: Handle, type: string, handler: (event: T) => void, options?: boolean | AddEventListenerOptions): void;

    /**
     * Removes a native event listener previously registered with {@link addListener}.
     *
     * @param target - The event target handle.
     * @param type - The event type.
     * @param handler - The listener to remove.
     * @param options - Optional capture options matching the registration.
     */
    removeListener<T extends Event = Event>(target: Handle, type: string, handler: (event: T) => void, options?: boolean | EventListenerOptions): void;

    /**
     * Dispatches an event on a target.
     *
     * @param target - The event target handle.
     * @param event - The event to dispatch.
     */
    dispatchEvent(target: Handle, event: Event): void;

    /**
     * Builds and dispatches a custom event of `type` with the given init on a
     * target. The framework's sole construction site for fired custom events:
     * the production sink mints a native `CustomEvent`, while the modelled sink
     * builds a plain sentinel event, so production code never names the global
     * `CustomEvent` constructor. `init` is a `CustomEventInit`, so `init.detail`
     * surfaces as the event's `detail` exactly as the inline `new CustomEvent`
     * it replaces did.
     *
     * @param target - The event target handle.
     * @param type - The event type (e.g. `"keydown"`).
     * @param init - Optional `CustomEventInit` (carries `detail`).
     */
    dispatchCustomEvent(target: Handle, type: string, init?: CustomEventInit): void;

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
     * Schedules `callback` to run after `delayMs`.
     *
     * @param callback - The timer callback.
     * @param delayMs - Delay before the callback runs, in milliseconds.
     * @returns The timer id, for {@link clearTimeout}.
     */
    setTimeout(callback: () => void, delayMs: number): TimerId;

    /**
     * Cancels a timer scheduled through {@link setTimeout}. A timer that has
     * already fired, or an id already cleared, is ignored.
     *
     * @param id - The id returned by {@link setTimeout}.
     */
    clearTimeout(id: TimerId): void;

    /**
     * Cancels every timer this sink scheduled that has not yet fired. Called by
     * `DOM.reset()` so a torn-down environment cannot be reached by a callback
     * scheduled against the previous one.
     */
    clearAllTimeouts(): void;

    /**
     * Sets an element's `id`.
     *
     * @param handle - The target element.
     * @param id - The id to set.
     */
    setId(handle: Handle, id: string): void;

    /**
     * Inserts a node before a reference child of a parent.
     *
     * @param parent - The parent handle.
     * @param node - The node to insert.
     * @param reference - The child to insert before, or null to append.
     */
    insertBefore(parent: Handle, node: Handle, reference: Handle | null): void;

    /**
     * Creates an empty document fragment for batched insertion, retained behind
     * a handle until released.
     *
     * @returns The new fragment's handle.
     */
    createDocumentFragment(): Handle;

    /**
     * Synthesises a click on an element (file-input open, download anchor).
     *
     * @param handle - The element to click.
     */
    click(handle: Handle): void;

    /**
     * Routes subsequent pointer events for a pointer id to an element.
     *
     * @param handle - The capturing element.
     * @param pointerId - The pointer id to capture.
     */
    setPointerCapture(handle: Handle, pointerId: number): void;

    /**
     * Releases a pointer capture previously set on an element.
     *
     * @param handle - The element holding the capture.
     * @param pointerId - The pointer id to release.
     */
    releasePointerCapture(handle: Handle, pointerId: number): void;

    /**
     * Obtains a drawing context from a `<canvas>` element. Generic over
     * `contextId` (`"2d"`, `"webgl"`, `"webgl2"`) so a single seam entry serves
     * both the raster and WebGL components, each narrowing the returned union
     * itself.
     *
     * @remarks Unlike every other sink method this returns a live object rather
     * than a forwardable one-way write: a rendering context cannot cross a worker
     * boundary, so a modelled sink returns `null` and the caller no-ops offline.
     * This is the single, named escape from the seam's one-way contract — the
     * reason a canvas is a live-only component.
     *
     * @param handle - The `<canvas>` element handle.
     * @param contextId - The context identifier (`"2d"`, `"webgl"`, …).
     * @param options - Optional context attributes (e.g. `{ alpha: false }`).
     * @returns The rendering context, or `null` when unavailable (offline, or the
     *   element does not support the requested context).
     */
    getContext(handle: Handle, contextId: string, options?: unknown): RenderingContext | null;

    /**
     * Resolves `handle` to its real element and hands it to `factory`, which
     * mounts a foreign live widget (a third-party library that takes a parent
     * element and mutates a whole DOM region it owns) into it — the second
     * named escape from the seam's one-way contract, after {@link getContext}.
     *
     * @remarks Like `getContext`, this returns a live object rather than a
     * forwardable one-way write: the mounted widget instance cannot cross a
     * worker boundary, so a modelled sink returns `null` and the caller no-ops
     * offline. This is the reason a component built on `mountView` (e.g.
     * `CodeEditor` on CodeMirror's `EditorView`) is live-only. `factory`'s
     * parameter is deliberately left unannotated at call sites outside this
     * seam — its type is inferred from this signature — so no call site names
     * a DOM element type and trips `no-raw-dom`'s *hold* clause.
     *
     * @param handle - The element handle to mount the foreign widget into.
     * @param factory - Builds and returns the foreign widget given the
     *   resolved parent element.
     * @returns Whatever `factory` returns, or `null` offline / when the handle
     *   does not resolve.
     */
    mountView<T>(handle: Handle, factory: (parent: HTMLElement) => T): T | null;

    /**
     * Starts (or resumes) playback of a media element. Wraps the `play()` IDL
     * method, whose returned promise is intentionally dropped — playback state is
     * observed through media events, not the promise.
     *
     * @param handle - The `<video>` / `<audio>` element handle.
     */
    mediaPlay(handle: Handle): void;

    /**
     * Pauses playback of a media element.
     *
     * @param handle - The media element handle.
     */
    mediaPause(handle: Handle): void;

    /**
     * Seeks a media element to a playback position.
     *
     * @param handle - The media element handle.
     * @param seconds - The target position in seconds.
     */
    setCurrentTime(handle: Handle, seconds: number): void;

    /**
     * Sets a media element's audio volume.
     *
     * @param handle - The media element handle.
     * @param value - The volume in `[0, 1]`.
     */
    setVolume(handle: Handle, value: number): void;

    /**
     * Sets a media element's muted state (the IDL property, which the boolean
     * attribute alone cannot toggle after load).
     *
     * @param handle - The media element handle.
     * @param muted - Whether audio is muted.
     */
    setMuted(handle: Handle, muted: boolean): void;

    /**
     * Sets a media element's playback speed multiplier.
     *
     * @param handle - The media element handle.
     * @param rate - The playback rate (`1` is normal speed).
     */
    setPlaybackRate(handle: Handle, rate: number): void;

    /**
     * Requests that an element enter fullscreen. Must be called from a user
     * gesture handler; the returned promise is dropped — the transition is
     * observed through the `fullscreenchange` event.
     *
     * @param handle - The element to display fullscreen.
     */
    requestFullscreen(handle: Handle): void;

    /**
     * Exits fullscreen for the document. No-op when nothing is fullscreen.
     */
    exitFullscreen(): void;
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
     * Converts a raw browser node arriving at an event boundary into a (weak)
     * handle. The one place a raw target legitimately enters the seam from
     * outside — the event system hands it `evnt.target`, and the handle is
     * interned so no call site downstream holds the raw node.
     *
     * @param target - The browser-supplied event target.
     * @returns Its canonical handle.
     */
    intern(target: EventTarget): Handle;

    /**
     * Whether a raw value arriving at an event boundary is a DOM node. Replaces
     * call-site `value instanceof Node` guards (which name a global constructor)
     * so an `EventTarget | null` field can be narrowed before {@link intern}.
     *
     * @param value - The raw value to test (typically `e.relatedTarget` / `e.target`).
     * @returns `true` when the value is a node; production matches `instanceof Node`.
     *   The `EventTarget` type guard lets a nullable event field narrow for
     *   the subsequent {@link intern}.
     */
    isNode(value: unknown): value is EventTarget;

    /**
     * Whether a raw value is a DOM element — {@link isNode} narrowed to elements.
     * Replaces call-site `value instanceof Element`.
     *
     * @param value - The raw value to test.
     * @returns `true` when the value is an element; production matches `instanceof Element`.
     */
    isElement(value: unknown): value is EventTarget;

    /**
     * Escapes a string for safe use inside a CSS selector. Replaces call-site
     * `CSS.escape`, which names a global the offline harness does not ship.
     *
     * @param value - The raw string (e.g. a glyph id).
     * @returns The escaped string; production uses `CSS.escape`.
     */
    escapeSelector(value: string): string;

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
     * @param handle - The element to measure.
     * @returns The element's bounding rectangle as plain data.
     */
    getElementRect(handle: Handle): Rect;

    /**
     * Measures the rendered size and baseline of a text string.
     *
     * @param text - The string to measure.
     * @param options - Font properties; default to the active theme variables.
     * @returns The measured `{width, height, baseline}` in pixels.
     */
    measureText(text: string, options?: TextMeasureOptions): TextMetrics;

    /**
     * Measures many strings under one font in a single document reflow.
     *
     * @param texts - The strings to measure.
     * @param options - Font properties; default to the active theme variables.
     * @returns One width per input, in input order; an empty input list
     * touches the DOM not at all and returns an empty array.
     */
    measureTextWidths(texts: string[], options?: TextMeasureOptions): number[];

    /**
     * Measures many strings, each under its own font, in a single document reflow.
     *
     * @param requests - The strings to measure, each with its own font properties.
     * @returns One `TextMetrics` per request, in request order; an empty request
     *   list touches the DOM not at all and returns an empty array.
     */
    measureTexts(requests: TextMeasureRequest[]): TextMetrics[];

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
     * Returns the display's device-pixel ratio — the factor by which a
     * `<canvas>` backing store must be scaled above its CSS size to stay crisp
     * on a HiDPI display. Reads the flagged `window.devicePixelRatio` global
     * behind the seam; a modelled source reports `1` so offline backing-store
     * math stays deterministic.
     *
     * @returns The device-pixel ratio (`1` or greater); `1` when unavailable.
     */
    getDevicePixelRatio(): number;

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
     * @param handle - The element to read.
     * @returns The current `scrollLeft` in pixels.
     */
    getScrollLeft(handle: Handle): number;

    /**
     * Reads an element's native vertical scroll offset (browser-clamped).
     *
     * @param handle - The element to read.
     * @returns The current `scrollTop` in pixels.
     */
    getScrollTop(handle: Handle): number;

    /**
     * Reads an element's scroll offsets, scrollable content size, and visible
     * viewport size in one shot.
     *
     * @param handle - The element to measure.
     * @returns The element's {@link ScrollMetrics} as plain data.
     */
    getScrollMetrics(handle: Handle): ScrollMetrics;

    /**
     * Reads an element's offset-box top edge and height.
     *
     * @param handle - The element to measure.
     * @returns The element's {@link OffsetSize} as plain data.
     */
    getOffsetSize(handle: Handle): OffsetSize;

    /**
     * Whether an element is currently attached to a document.
     *
     * @param handle - The element to test.
     * @returns `true` when the element is connected.
     */
    isConnected(handle: Handle): boolean;

    /**
     * Reads the value of a form control.
     *
     * @param handle - The form control to read.
     * @returns The control's current value.
     */
    getValue(handle: Handle): string;

    /**
     * Returns the element that currently has focus, or null.
     *
     * @returns The active element handle, or null when nothing is focused.
     */
    getActiveElement(): Handle | null;

    /**
     * Reads the document's current text selection as plain data, boxed
     * through handles so the live `Selection`/`Range` never escapes the seam.
     *
     * @returns The selection's start/end containers and character offsets,
     *   or `null` when nothing is selected (no ranges, or a collapsed one).
     */
    getDocumentSelection(): DocumentSelectionRange | null;

    /**
     * Reads plain text from the system clipboard.
     *
     * @returns The clipboard text; `""` for an empty clipboard; `null` when
     *   the read is unavailable or denied (no `navigator.clipboard`, a denied
     *   permission, or a browser that refuses the read for page scripts).
     */
    readClipboardText(): Promise<string | null>;

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
     * @param target - The target handle to test, or null.
     * @returns `true` when the target is `window`.
     */
    isWindow(target: Handle | null): boolean;

    /**
     * Returns the global `window` interned to a handle, so window-level
     * listeners can be registered without a call site naming the raw global.
     *
     * @returns The `window` handle.
     */
    getWindow(): Handle;

    /**
     * The current `location.hash`, boxed so the raw global never escapes the
     * seam.
     *
     * @returns The hash including its leading `"#"`, or `""` when empty.
     */
    getLocationHash(): string;

    /**
     * The current `location.pathname`, boxed so the raw global never escapes
     * the seam.
     *
     * @returns The path, always starting with `"/"`.
     */
    getLocationPathname(): string;

    /**
     * The current `location.search`, boxed so the raw global never escapes
     * the seam.
     *
     * @returns The query string including its leading `"?"`, or `""` when empty.
     */
    getLocationSearch(): string;

    /**
     * Whether a node is the ancestor of (or equal to) another node.
     *
     * @param ancestor - The candidate ancestor handle.
     * @param node - The node handle to test, or null.
     * @returns `true` when `ancestor` contains `node`.
     */
    contains(ancestor: Handle, node: Handle | null): boolean;

    /**
     * Finds the first descendant of `root` matching a selector.
     *
     * @param root - The subtree root handle.
     * @param selector - The CSS selector.
     * @returns The first match handle, or null.
     */
    querySelector(root: Handle, selector: string): Handle | null;

    /**
     * Finds all descendants of `root` matching a selector, as a plain array.
     *
     * @param root - The subtree root handle.
     * @param selector - The CSS selector.
     * @returns The match handles (a snapshot array, never a live `NodeList`).
     */
    querySelectorAll(root: Handle, selector: string): Handle[];

    /**
     * Total element count in the document, for the diagnostics overlay's DOM
     * node reading. A raw count rather than a {@link querySelectorAll} call so
     * a twice-a-second sample never interns thousands of elements into the
     * handle registry — see {@link DOMSource.querySelectorAll}.
     *
     * @returns The number of elements in the document. `0` when no selector
     *   engine is available (offline).
     */
    countElements(): number;

    /**
     * Returns a materialised style rule's full CSS text (selector plus
     * declaration body), e.g. `"#a3f2.pressed { color: red; }"`.
     *
     * @param rule - A `CSSStyleRule` obtained from `StyleTarget`'s rule cache.
     * @returns The rule's `cssText`. Empty string when no selector engine is
     *   available (the modelled source — matches `countElements()`'s stance).
     */
    getRuleCssText(rule: CSSStyleRule): string;

    /**
     * Whether an element itself matches a selector. The self-test counterpart to
     * {@link DOMSource.querySelector}, which only sees descendants — needed when
     * a component's own root element is the candidate (a `TextField` renders as
     * the `<input>` itself, with no focusable descendant to find).
     *
     * @param handle - The element to test.
     * @param selector - The CSS selector.
     * @returns `true` when the element matches.
     */
    matches(handle: Handle, selector: string): boolean;

    /**
     * Returns an element's parent element, or null.
     *
     * @param handle - The element to read.
     * @returns The parent element handle, or null.
     */
    getParentElement(handle: Handle): Handle | null;

    /**
     * Returns a node's parent node, or null.
     *
     * @param handle - The node to read.
     * @returns The parent node handle, or null.
     */
    getParentNode(handle: Handle): Handle | null;

    /**
     * Returns a node's first child, or null.
     *
     * @param handle - The node to read.
     * @returns The first child handle, or null.
     */
    getFirstChild(handle: Handle): Handle | null;

    /**
     * Returns an element's resolved border widths as computed-style strings
     * (e.g. `"1px"`), one per side.
     *
     * @param handle - The element to measure.
     * @returns The four border-width strings.
     */
    getBorderWidths(handle: Handle): { top: string; right: string; bottom: string; left: string };

    /**
     * Returns an element's resolved `overflow` / `overflow-x` / `overflow-y`
     * computed-style strings.
     *
     * @param handle - The element to read.
     * @returns The three overflow strings.
     */
    getComputedOverflow(handle: Handle): { overflow: string; overflowX: string; overflowY: string };

    /**
     * Reads a single inline style property off an element.
     *
     * @param handle - The element to read.
     * @param key - The CSS property name (camelCase, or `--custom-property`).
     * @returns The inline value (empty string when unset).
     */
    getInlineStyle(handle: Handle, key: string): string;

    /**
     * Returns the document's root `<html>` element — the mount point for
     * top-layer overlays.
     *
     * @returns The document element handle.
     */
    getDocumentElement(): Handle;

    /**
     * Returns the document `<body>` element.
     *
     * @returns The body element handle.
     */
    getBody(): Handle;

    /**
     * Returns the document `<head>` element.
     *
     * @returns The head element handle.
     */
    getHead(): Handle;

    /**
     * Registers a callback fired each time the document's web fonts finish a
     * batch of loading. Text whose preferred size was measured against a
     * fallback font before a `font-display: swap` web font swapped in must
     * re-measure once the real font is available, or its stale
     * (fallback-derived) size clips the now-wider glyphs. Offline sources
     * measure against baked fonts with no async swap, so they never invoke it.
     *
     * @param callback - Invoked whenever a batch of font loads settles; never
     *   invoked on a document that loads no web fonts at all, since no
     *   measurement can go stale there. Implementations must not fire it merely
     *   because the font set is momentarily idle — see the production
     *   implementation for why that is the trap this contract exists to avoid.
     */
    onFontsReady(callback: () => void): void;

    /**
     * Starts downloading and activating `family` now, rather than leaving the
     * fetch to be triggered by the first text that renders in it.
     *
     * An `@font-face` rule on its own downloads nothing: the browser fetches
     * and activates a face only once rendered content actually uses it, which
     * puts that work *after* the whole first layout instead of alongside it.
     * Starting it as soon as the rules are installed lets the face arrive while
     * the component tree is still being built.
     *
     * @param family - The `font-family` name to start loading, as it appears in
     *   the `@font-face` rule.
     *
     * @returns `true` when an asynchronous load was actually started, so the
     *   caller can expect {@link onFontsReady} to follow; `false` when this
     *   source cannot load fonts asynchronously at all — an engine with no CSS
     *   Font Loading API, or an offline source measuring against baked fonts.
     *   A caller that defers work until the font settles must not defer on
     *   `false`, or it would be waiting for a callback that never comes.
     *
     * @remarks Best-effort and fire-and-forget: a failed load is not an error
     *   (the `font-display: swap` fallback stands, and {@link onFontsReady}
     *   still settles the measurements).
     */
    startFontLoad(family: string): boolean;

    /**
     * Looks up an element by its `id`.
     *
     * @param id - The element id (no `#` prefix).
     * @returns The matching element handle, or null.
     */
    getElementById(id: string): Handle | null;

    /**
     * Reads an element's `id`.
     *
     * @param handle - The element to read.
     * @returns The element's id (empty string when unset).
     */
    getId(handle: Handle): string;

    /**
     * Reads a `data-*` attribute via the element's dataset.
     *
     * @param handle - The element to read.
     * @param key - The dataset key (camelCase).
     * @returns The value, or undefined when unset.
     */
    getDataset(handle: Handle, key: string): string | undefined;

    /**
     * Reads an element's tag name (uppercase).
     *
     * @param handle - The element to read.
     * @returns The tag name.
     */
    getTagName(handle: Handle): string;

    /**
     * Whether an element has a given attribute.
     *
     * @param handle - The element to test.
     * @param key - The attribute name.
     * @returns `true` when the attribute is present.
     */
    hasAttribute(handle: Handle, key: string): boolean;

    /**
     * Reads an attribute value.
     *
     * @param handle - The element to read.
     * @param key - The attribute name.
     * @returns The value, or null when unset.
     */
    getAttribute(handle: Handle, key: string): string | null;

    /**
     * Reads an image's intrinsic pixel size.
     *
     * @param handle - The image element.
     * @returns The natural `{width, height}` in pixels.
     */
    getNaturalSize(handle: Handle): { width: number; height: number };

    /**
     * Reads a media element's playback state in one shot as plain data.
     *
     * @param handle - The `<video>` / `<audio>` element handle.
     * @returns The element's {@link MediaState}.
     */
    getMediaState(handle: Handle): MediaState;

    /**
     * Returns the element currently displayed fullscreen, or `null` when nothing
     * is. Reads `document.fullscreenElement` behind the seam so no call site
     * names the global.
     *
     * @returns The fullscreen element handle, or `null`.
     */
    getFullscreenElement(): Handle | null;

    /**
     * Reads the selected files of a file input.
     *
     * @param handle - The file-input element.
     * @returns The selected `FileList`, or null.
     */
    getFiles(handle: Handle): FileList | null;

    /**
     * Whether an element currently holds a given pointer capture.
     *
     * @param handle - The element to test.
     * @param pointerId - The pointer id.
     * @returns `true` when the element captures the pointer.
     */
    hasPointerCapture(handle: Handle, pointerId: number): boolean;

    /**
     * Returns the stack of elements at a viewport point (hit-testing).
     *
     * @param x - The viewport x coordinate.
     * @param y - The viewport y coordinate.
     * @returns The element handles at the point, topmost first.
     */
    elementsFromPoint(x: number, y: number): Handle[];
}

/**
 * Seam-friendly result of {@link DOMSource.getDocumentSelection}: the
 * selection's start/end containers and character offsets, boxed through
 * handles so the live `Selection`/`Range` never escapes the seam.
 *
 * @category Core
 */
export interface DocumentSelectionRange {
    /** The node the selection starts in. */
    startContainer: Handle;
    /** Character offset into {@link startContainer}, or `null` when it is not a text node. */
    startOffset:    number | null;
    /** The node the selection ends in. */
    endContainer:   Handle;
    /** Character offset into {@link endContainer}, or `null` when it is not a text node. */
    endOffset:      number | null;
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
     * Timers scheduled through this sink that have not yet fired. Tracked so
     * `DOM.reset()` can disarm them: a pending `setTimeout` lives in the host's
     * scheduler, so discarding the sink object leaves it running.
     */
    private readonly _timers = new Set<TimerId>();

    /** Selector → rule for the sheet in `_indexedSheet`. Empty until first use. */
    private _ruleIndex: Map<string, CSSStyleRule> = new Map();

    /** The sheet `_ruleIndex` describes; `null` before the first build. */
    private _indexedSheet: CSSStyleSheet | null = null;

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
    setRuleStyles(rule: CSSStyleRule, styles: Record<string, string | null>): void {
        const keys = Object.keys(styles);

        if (keys.length === 0) {
            return;
        }

        const scratch = keys.length === 1 ? null : scratchDeclaration();

        // One declaration is already one mutation, and the headless path (no
        // document, so no scratch element) falls back to the same direct writes.
        if (!scratch) {
            for (const key of keys) {
                writeDeclaration(rule.style, key, styles[key]);
            }

            return;
        }

        scratch.cssText = rule.style.cssText;

        for (const key of keys) {
            writeDeclaration(scratch, key, styles[key]);
        }

        rule.style.cssText = scratch.cssText;
    }

    /** @inheritDoc */
    ensureStyleRule(selector: string): CSSStyleRule {
        const sheet  = this.mainSheet();
        const index  = this.ruleIndex(sheet);
        const cached = index.get(selector);

        if (cached) {
            return cached;
        }

        const insertedAt = sheet.insertRule(selector + "{}", sheet.cssRules.length);
        const rule       = sheet.cssRules[insertedAt] as CSSStyleRule;

        index.set(selector, rule);

        return rule;
    }

    /** @inheritDoc */
    deleteStyleRule(selector: string): void {
        // Best-effort cleanup reached from the component GC finalizer, which runs
        // decoupled from the DOM lifecycle: at GC time this production sink may be
        // active in a headless environment (the node test env, or after a
        // DOM.reset()). With no document there is no shared sheet and nothing to
        // delete, so no-op rather than dereference `document` in `mainSheet()`.
        if (typeof document === "undefined") {
            return;
        }

        const sheet = this.mainSheet();
        const index = this.ruleIndex(sheet);
        const rule  = index.get(selector);

        if (!rule) {
            return;
        }

        index.delete(selector);

        for (let idx = 0; idx < sheet.cssRules.length; idx += 1) {
            if (sheet.cssRules[idx] === rule) {
                sheet.deleteRule(idx);
                return;
            }
        }
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
     * Returns the selector → rule index for `sheet`, building it with one walk
     * of `cssRules` the first time this sheet is seen and reusing it on every
     * later call while `sheet` stays the same object. Building from the live
     * sheet — rather than starting empty — is what keeps a fresh sink (e.g.
     * after `DOM.reset()`, which replaces the sink but not the `<style
     * id="Base">` element) honest about rules a previous sink already left on
     * it. Assumes a single writer: a second `ProductionDOMSink` concurrently
     * writing the same sheet would keep its own index and not see this one's
     * inserts.
     *
     * @param sheet - The sheet to index.
     */
    private ruleIndex(sheet: CSSStyleSheet): Map<string, CSSStyleRule> {
        if (this._indexedSheet === sheet) {
            return this._ruleIndex;
        }

        const index = new Map<string, CSSStyleRule>();

        for (let idx = 0; idx < sheet.cssRules.length; idx += 1) {
            const rule = sheet.cssRules[idx];

            if (rule.type === CSSRule.STYLE_RULE) {
                index.set((rule as CSSStyleRule).selectorText, rule as CSSStyleRule);
            }
        }

        this._ruleIndex    = index;
        this._indexedSheet = sheet;

        return index;
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
    createElement(tag: string): Handle {
        return _registry.retain(document.createElement(tag));
    }

    /** @inheritDoc */
    createElementNS(ns: string, tag: string): Handle {
        return _registry.retain(document.createElementNS(ns, tag));
    }

    /** @inheritDoc */
    appendChild(parent: Handle, child: Handle): void {
        _registry.resolve(parent).appendChild(_registry.resolve(child));
    }

    /** @inheritDoc */
    removeChild(parent: Handle, child: Handle): void {
        _registry.resolve(parent).removeChild(_registry.resolve(child));
    }

    /** @inheritDoc */
    removeElement(handle: Handle): void {
        (_registry.resolve(handle) as Element).remove();
    }

    /** @inheritDoc */
    focus(handle: Handle, options?: { preventScroll?: boolean }): void {
        (_registry.resolve(handle) as HTMLElement).focus(options);
    }

    /** @inheritDoc */
    requestSubmit(handle: Handle): void {
        (_registry.resolve(handle) as HTMLFormElement).requestSubmit();
    }

    /** @inheritDoc */
    blur(handle: Handle): void {
        (_registry.resolve(handle) as HTMLElement).blur();
    }

    /** @inheritDoc */
    setValue(handle: Handle, value: string): void {
        (_registry.resolve(handle) as HTMLInputElement).value = value;
    }

    /** @inheritDoc */
    setSelectionRange(handle: Handle, start: number, end: number): void {
        (_registry.resolve(handle) as HTMLInputElement).setSelectionRange(start, end);
    }

    /** @inheritDoc */
    setLocationHash(hash: string): void {
        location.hash = hash;
    }

    /** @inheritDoc */
    replaceLocationHash(hash: string): void {
        const href       = location.href;
        const hashIndex  = href.indexOf('#');
        const base       = hashIndex === -1 ? href : href.slice(0, hashIndex);

        location.replace(base + hash);
    }

    /** @inheritDoc */
    pushHistoryPath(url: string): void {
        history.pushState(null, "", url);
    }

    /** @inheritDoc */
    replaceHistoryPath(url: string): void {
        history.replaceState(null, "", url);
    }

    /** @inheritDoc */
    writeClipboardText(text: string): void {
        navigator.clipboard?.writeText(text);
    }

    /** @inheritDoc */
    clearDocumentSelection(): void {
        window.getSelection()?.removeAllRanges();
    }

    /** @inheritDoc */
    addListener<T extends Event = Event>(target: Handle, type: string, handler: (event: T) => void, options?: boolean | AddEventListenerOptions): void {
        _registry.resolve(target).addEventListener(type, handler as EventListener, options);
    }

    /** @inheritDoc */
    removeListener<T extends Event = Event>(target: Handle, type: string, handler: (event: T) => void, options?: boolean | EventListenerOptions): void {
        _registry.resolve(target).removeEventListener(type, handler as EventListener, options);
    }

    /** @inheritDoc */
    dispatchEvent(target: Handle, event: Event): void {
        _registry.resolve(target).dispatchEvent(event);
    }

    /** @inheritDoc */
    dispatchCustomEvent(target: Handle, type: string, init?: CustomEventInit): void {
        _registry.resolve(target).dispatchEvent(new CustomEvent(type, init));
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
    setTimeout(callback: () => void, delayMs: number): TimerId {
        const id = setTimeout(() => {
            this._timers.delete(id);
            callback();
        }, delayMs);

        this._timers.add(id);

        return id;
    }

    /** @inheritDoc */
    clearTimeout(id: TimerId): void {
        this._timers.delete(id);
        clearTimeout(id);
    }

    /** @inheritDoc */
    clearAllTimeouts(): void {
        for (const id of this._timers) {
            clearTimeout(id);
        }

        this._timers.clear();
    }

    /** @inheritDoc */
    setId(handle: Handle, id: string): void {
        (_registry.resolve(handle) as Element).id = id;
    }

    /** @inheritDoc */
    insertBefore(parent: Handle, node: Handle, reference: Handle | null): void {
        _registry.resolve(parent).insertBefore(
            _registry.resolve(node),
            reference === null ? null : _registry.resolve(reference)
        );
    }

    /** @inheritDoc */
    createDocumentFragment(): Handle {
        return _registry.retain(document.createDocumentFragment());
    }

    /** @inheritDoc */
    click(handle: Handle): void {
        (_registry.resolve(handle) as HTMLElement).click();
    }

    /** @inheritDoc */
    setPointerCapture(handle: Handle, pointerId: number): void {
        (_registry.resolve(handle) as Element).setPointerCapture(pointerId);
    }

    /** @inheritDoc */
    releasePointerCapture(handle: Handle, pointerId: number): void {
        (_registry.resolve(handle) as Element).releasePointerCapture(pointerId);
    }

    /** @inheritDoc */
    getContext(handle: Handle, contextId: string, options?: unknown): RenderingContext | null {
        return (_registry.resolve(handle) as HTMLCanvasElement).getContext(contextId, options);
    }

    /** @inheritDoc */
    mountView<T>(handle: Handle, factory: (parent: HTMLElement) => T): T | null {
        return factory(_registry.resolve(handle) as HTMLElement);
    }

    /** @inheritDoc */
    mediaPlay(handle: Handle): void {
        // The play() promise rejects on an autoplay-policy block; playback state
        // is observed through media events, so the promise is intentionally void.
        void (_registry.resolve(handle) as HTMLMediaElement).play().catch(() => {});
    }

    /** @inheritDoc */
    mediaPause(handle: Handle): void {
        (_registry.resolve(handle) as HTMLMediaElement).pause();
    }

    /** @inheritDoc */
    setCurrentTime(handle: Handle, seconds: number): void {
        (_registry.resolve(handle) as HTMLMediaElement).currentTime = seconds;
    }

    /** @inheritDoc */
    setVolume(handle: Handle, value: number): void {
        (_registry.resolve(handle) as HTMLMediaElement).volume = value;
    }

    /** @inheritDoc */
    setMuted(handle: Handle, muted: boolean): void {
        (_registry.resolve(handle) as HTMLMediaElement).muted = muted;
    }

    /** @inheritDoc */
    setPlaybackRate(handle: Handle, rate: number): void {
        (_registry.resolve(handle) as HTMLMediaElement).playbackRate = rate;
    }

    /** @inheritDoc */
    requestFullscreen(handle: Handle): void {
        // The transition is observed through fullscreenchange; a rejected request
        // (no user gesture) is swallowed rather than surfaced as an unhandled reject.
        void (_registry.resolve(handle) as HTMLElement).requestFullscreen().catch(() => {});
    }

    /** @inheritDoc */
    exitFullscreen(): void {
        if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
        }
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
     * handle. The one place a raw target legitimately enters the seam from
     * outside — the event system hands it `evnt.target`, and the handle is
     * interned so no call site downstream holds the raw node.
     *
     * @param target - The browser-supplied event target.
     * @returns Its canonical handle.
     */
    intern(target: EventTarget): Handle {
        return _registry.intern(target as Node);
    }

    /** @inheritDoc */
    isNode(value: unknown): value is EventTarget {
        return value instanceof Node;
    }

    /** @inheritDoc */
    isElement(value: unknown): value is EventTarget {
        return value instanceof Element;
    }

    /** @inheritDoc */
    escapeSelector(value: string): string {
        // Real browsers always ship `CSS.escape`; guard for environments that
        // don't (jsdom, some SSR contexts) with an equivalent backslash escape
        // of every non-identifier character.
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
            return CSS.escape(value);
        }

        return value.replace(/[^\w-]/g, ch => "\\" + ch);
    }

    /** @inheritDoc */
    getViewportRect(component: Component): Rect {
        return toRect((_registry.resolve(component.getElement()!) as HTMLElement).getBoundingClientRect());
    }

    /** @inheritDoc */
    getElementRect(handle: Handle): Rect {
        return toRect((_registry.resolve(handle) as Element).getBoundingClientRect());
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
    measureTextWidths(texts: string[], options: TextMeasureOptions = {}): number[] {
        if (texts.length === 0) {
            return [];
        }

        const {
            fontFamily  = "var(--ts-ui-font-family, system-ui, sans-serif)",
            fontSize    = "var(--ts-ui-font-size, 14px)",
            fontWeight  = "normal",
            fontStyle   = "normal",
            fontVariant = "normal",
            fontStretch = "normal",
        } = options;

        const wrapper = document.createElement("div");

        _applyProbeStyles(wrapper, { position: "fixed", visibility: "hidden", whiteSpace: "nowrap" });

        const probes = texts.map(text => {
            const probe = document.createElement("span");

            _applyProbeStyles(probe, {
                display: "inline-block", whiteSpace: "nowrap",
                fontFamily, fontSize, fontWeight, fontStyle, fontVariant, fontStretch,
            });

            probe.textContent = text;
            wrapper.appendChild(probe);

            return probe;
        });

        document.body.appendChild(wrapper);

        // One layout flush: the first read forces it, and nothing mutates the
        // DOM between reads, so the rest are served from the same computed layout.
        const widths = probes.map(p => Math.ceil(p.getBoundingClientRect().width));

        document.body.removeChild(wrapper);

        return widths;
    }

    /** @inheritDoc */
    measureTexts(requests: TextMeasureRequest[]): TextMetrics[] {
        if (requests.length === 0) {
            return [];
        }

        const wrapper = document.createElement("div");

        _applyProbeStyles(wrapper, { position: "fixed", visibility: "hidden", whiteSpace: "nowrap" });

        const probes = requests.map(({ text, options = {} }) => {
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
                display:    "inline-block",
                whiteSpace: maxWidth === undefined ? "nowrap" : "pre-wrap",
                width:      maxWidth === undefined ? "" : `${maxWidth}px`,
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
            wrapper.appendChild(probe);

            return { probe, ref };
        });

        document.body.appendChild(wrapper);

        // One layout flush: the first read forces it, and nothing mutates the
        // DOM between reads, so the rest are served from the same computed layout.
        const metrics = probes.map(({ probe, ref }) => {
            const probeRect = probe.getBoundingClientRect();
            const refRect   = ref.getBoundingClientRect();

            return {
                width:    Math.ceil(probeRect.width),
                height:   Math.ceil(probeRect.height),
                baseline: Math.round(refRect.top - probeRect.top),
            };
        });

        document.body.removeChild(wrapper);

        return metrics;
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
    getDevicePixelRatio(): number {
        return window.devicePixelRatio || 1;
    }

    /** @inheritDoc */
    isModelled(): boolean {
        return false;
    }

    /** @inheritDoc */
    getScrollLeft(handle: Handle): number {
        return (_registry.resolve(handle) as Element).scrollLeft;
    }

    /** @inheritDoc */
    getScrollTop(handle: Handle): number {
        return (_registry.resolve(handle) as Element).scrollTop;
    }

    /** @inheritDoc */
    getScrollMetrics(handle: Handle): ScrollMetrics {
        const element = _registry.resolve(handle) as Element;

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
    getOffsetSize(handle: Handle): OffsetSize {
        const el = _registry.resolve(handle) as HTMLElement;

        return {
            offsetTop:    el.offsetTop,
            offsetHeight: el.offsetHeight
        };
    }

    /** @inheritDoc */
    isConnected(handle: Handle): boolean {
        return (_registry.resolve(handle) as Element).isConnected;
    }

    /** @inheritDoc */
    getValue(handle: Handle): string {
        return (_registry.resolve(handle) as HTMLInputElement).value;
    }

    /** @inheritDoc */
    getActiveElement(): Handle | null {
        const active = document.activeElement;

        return active === null ? null : _registry.intern(active);
    }

    /** @inheritDoc */
    getDocumentSelection(): DocumentSelectionRange | null {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
            return null;
        }

        const range = sel.getRangeAt(0);
        const startIsText = range.startContainer.nodeType === Node.TEXT_NODE;
        const endIsText   = range.endContainer.nodeType === Node.TEXT_NODE;

        return {
            startContainer: _registry.intern(range.startContainer),
            startOffset:    startIsText ? range.startOffset : null,
            endContainer:   _registry.intern(range.endContainer),
            endOffset:      endIsText ? range.endOffset : null,
        };
    }

    /** @inheritDoc */
    async readClipboardText(): Promise<string | null> {
        try {
            return (await navigator.clipboard?.readText()) ?? null;
        } catch {
            return null;
        }
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
    isWindow(target: Handle | null): boolean {
        return target !== null && _registry.resolve(target) === (window as unknown as Node);
    }

    /** @inheritDoc */
    getWindow(): Handle {
        return _registry.intern(window as unknown as Node);
    }

    /** @inheritDoc */
    getLocationHash(): string {
        return location.hash;
    }

    /** @inheritDoc */
    getLocationPathname(): string {
        return location.pathname;
    }

    /** @inheritDoc */
    getLocationSearch(): string {
        return location.search;
    }

    /** @inheritDoc */
    contains(ancestor: Handle, node: Handle | null): boolean {
        return _registry.resolve(ancestor).contains(node === null ? null : _registry.resolve(node));
    }

    /** @inheritDoc */
    querySelector(root: Handle, selector: string): Handle | null {
        const found = (_registry.resolve(root) as ParentNode).querySelector(selector);

        return found === null ? null : _registry.intern(found);
    }

    /** @inheritDoc */
    querySelectorAll(root: Handle, selector: string): Handle[] {
        return Array.from((_registry.resolve(root) as ParentNode).querySelectorAll(selector), (node) => _registry.intern(node));
    }

    /** @inheritDoc */
    countElements(): number {
        return document.querySelectorAll("*").length;
    }

    /** @inheritDoc */
    getRuleCssText(rule: CSSStyleRule): string {
        return rule.cssText;
    }

    /** @inheritDoc */
    matches(handle: Handle, selector: string): boolean {
        return (_registry.resolve(handle) as Element).matches(selector);
    }

    /** @inheritDoc */
    getParentElement(handle: Handle): Handle | null {
        const parent = (_registry.resolve(handle) as Element).parentElement;

        return parent === null ? null : _registry.intern(parent);
    }

    /** @inheritDoc */
    getParentNode(handle: Handle): Handle | null {
        const parent = _registry.resolve(handle).parentNode;

        return parent === null ? null : _registry.intern(parent);
    }

    /** @inheritDoc */
    getFirstChild(handle: Handle): Handle | null {
        const child = _registry.resolve(handle).firstChild;

        return child === null ? null : _registry.intern(child);
    }

    /** @inheritDoc */
    getBorderWidths(handle: Handle): { top: string; right: string; bottom: string; left: string } {
        const cs = getComputedStyle(_registry.resolve(handle) as Element);

        return {
            top:    cs.borderTopWidth,
            right:  cs.borderRightWidth,
            bottom: cs.borderBottomWidth,
            left:   cs.borderLeftWidth
        };
    }

    /** @inheritDoc */
    getComputedOverflow(handle: Handle): { overflow: string; overflowX: string; overflowY: string } {
        const cs = getComputedStyle(_registry.resolve(handle) as Element);

        return {
            overflow:  cs.overflow,
            overflowX: cs.overflowX,
            overflowY: cs.overflowY
        };
    }

    /** @inheritDoc */
    getInlineStyle(handle: Handle, key: string): string {
        const style = (_registry.resolve(handle) as HTMLElement).style;

        if (key.includes("-")) {
            return style.getPropertyValue(key);
        }

        return (style as any)[key];
    }

    /** @inheritDoc */
    getDocumentElement(): Handle {
        return _registry.intern(document.documentElement);
    }

    /** @inheritDoc */
    getBody(): Handle {
        return _registry.intern(document.body);
    }

    /** @inheritDoc */
    getHead(): Handle {
        return _registry.intern(document.head);
    }

    /** @inheritDoc */
    onFontsReady(callback: () => void): void {
        const fonts = document.fonts;

        // Older engines without the CSS Font Loading API: the fallback
        // measurement is the only one we get, so leave it standing.
        if (!fonts) {
            return;
        }

        // `loadingdone`, deliberately not `fonts.ready`: `ready` is a snapshot
        // of the set's *current* state, and the set is idle at the moment the
        // framework subscribes — `ensureFontLoaded` injected the `@font-face`
        // rules microseconds earlier and no text has been laid out with them
        // yet, so the browser has not begun fetching. A lone `ready.then`
        // therefore resolves on the very next microtask, hundreds of ms before
        // the real face arrives, and re-measures against the same fallback it
        // exists to replace. `loadingdone` fires once each batch of faces
        // settles (loaded or errored), so it catches the swap-in itself — and
        // any later batch, such as a second subset or a lazily used family.
        fonts.addEventListener('loadingdone', () => callback());
    }

    /** @inheritDoc */
    startFontLoad(family: string): boolean {
        const fonts = document.fonts;

        if (!fonts) {
            return false;
        }

        // `load` matches faces by the CSS font shorthand and by the characters
        // its second argument needs; the default (a single space) selects the
        // subset covering the Basic Latin range, which is the one virtually all
        // UI text renders from. Any further subset stays lazy and is picked up
        // by the `loadingdone` batch it settles in.
        //
        // The size in the shorthand is required syntax, not a constraint: one
        // variable face covers every size and the 200-800 weight range, so this
        // activates the same file the first laid-out text would have. A
        // rejection means the face is unavailable, which the `swap` fallback
        // already covers — swallow it rather than surfacing an unhandled
        // rejection for a purely opportunistic fetch.
        fonts.load(`14px "${family}"`).catch(() => {});

        return true;
    }

    /** @inheritDoc */
    getElementById(id: string): Handle | null {
        const found = document.getElementById(id);

        return found === null ? null : _registry.intern(found);
    }

    /** @inheritDoc */
    getId(handle: Handle): string {
        return (_registry.resolve(handle) as Element).id;
    }

    /** @inheritDoc */
    getDataset(handle: Handle, key: string): string | undefined {
        return (_registry.resolve(handle) as HTMLElement).dataset[key];
    }

    /** @inheritDoc */
    getTagName(handle: Handle): string {
        return (_registry.resolve(handle) as Element).tagName;
    }

    /** @inheritDoc */
    hasAttribute(handle: Handle, key: string): boolean {
        return (_registry.resolve(handle) as Element).hasAttribute(key);
    }

    /** @inheritDoc */
    getAttribute(handle: Handle, key: string): string | null {
        return (_registry.resolve(handle) as Element).getAttribute(key);
    }

    /** @inheritDoc */
    getNaturalSize(handle: Handle): { width: number; height: number } {
        const image = _registry.resolve(handle) as HTMLImageElement;

        return { width: image.naturalWidth, height: image.naturalHeight };
    }

    /** @inheritDoc */
    getMediaState(handle: Handle): MediaState {
        const media = _registry.resolve(handle) as HTMLMediaElement;

        return {
            currentTime:  media.currentTime,
            duration:     media.duration,
            paused:       media.paused,
            ended:        media.ended,
            volume:       media.volume,
            muted:        media.muted,
            playbackRate: media.playbackRate,
        };
    }

    /** @inheritDoc */
    getFullscreenElement(): Handle | null {
        const element = document.fullscreenElement;

        return element ? _registry.intern(element) : null;
    }

    /** @inheritDoc */
    getFiles(handle: Handle): FileList | null {
        return (_registry.resolve(handle) as HTMLInputElement).files;
    }

    /** @inheritDoc */
    hasPointerCapture(handle: Handle, pointerId: number): boolean {
        return (_registry.resolve(handle) as Element).hasPointerCapture(pointerId);
    }

    /** @inheritDoc */
    elementsFromPoint(x: number, y: number): Handle[] {
        return Array.from(document.elementsFromPoint(x, y), (node) => _registry.intern(node));
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
        // Disarm before anything is rebuilt. A pending timer lives in the host
        // scheduler and reads the *current* seams when it fires, so one left
        // armed here would run against the fresh registry with a handle minted
        // against the old one — the use-after-free `resolve` throws on.
        DOM.sink.clearAllTimeouts();

        // Rebuild the shared registry alongside the seams so a test never
        // resolves a handle minted against the previous DOM.
        _registry  = new HandleRegistry();
        DOM.sink   = new ProductionDOMSink();
        DOM.source = new ProductionDOMSource();
    },
};
