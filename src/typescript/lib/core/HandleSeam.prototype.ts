// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/* eslint-disable local/no-raw-dom -- PROTOTYPE: this file *is* a seam implementation spike; raw DOM access is the point. */

// ---------------------------------------------------------------------------
// PROTOTYPE — handle-based DOM seam spike. NOT wired into the framework.
//
// The total-coverage seam stopped the library from *touching* the DOM, but the
// library still *holds* live `Element` pointers (110 typed fields, ~350 inbound
// seam calls, ~13 element-returning methods). This spike de-risks the design
// that removes the last of those references — an opaque `Handle` backed by a
// registry inside the seam — before committing to the full sweep.
//
// It proves three properties the investigation flagged as the real unknowns:
//
//   1. CANONICALIZATION — the same node always maps to the same handle, so
//      handle `===` reproduces element `===` (the 8 identity-comparison sites:
//      focus-trap, event-target-vs-stored-child, parent-equality).
//
//   2. LIFECYCLE — created elements are held STRONGLY (a detached clipFrame must
//      not vanish before it is mounted); browser-supplied elements (event
//      targets, query results, activeElement) are held WEAKLY behind a
//      `FinalizationRegistry`, so interning them can never leak. This is the one
//      genuinely new risk the pass-through seam never had.
//
//   3. BATCHED MULTI-WRITE — `apply(handle, patch)` resolves the handle ONCE and
//      performs N mutations, so a component that sets width + height + two
//      classes + an attribute pays one `Map.get`, not five. The patch is plain
//      serialisable data, so the same call forwards across a worker boundary as
//      a single `postMessage`.
//
// Throwaway: promote the shapes that survive review into core/DOM.ts; delete
// the rest. Kept out of the lib build (nothing imports it) and self-contained
// (no dependency on the real DOM.ts) so it reads as one unit.
// ---------------------------------------------------------------------------

/**
 * Opaque element reference. A branded `number` so it serialises across a worker
 * boundary and so a raw `number` cannot be passed where a handle is expected.
 * The live `Node` it stands for never escapes the seam.
 */
export type Handle = number & { readonly __handleBrand: unique symbol };

/**
 * A batch of mutations applied to a single element with one handle resolve.
 * Every field is plain serialisable data — no live element, no function — so a
 * future worker transport forwards an entire patch as one `postMessage`.
 *
 * Application order is fixed and deliberate: removals before additions (so a
 * `removeClass` + `addClass` of the same name lands "on"), styles first.
 */
export interface ElementPatch {
    /** Inline style writes. `null` removes the property. camelCase or `--custom`. */
    style?:       Readonly<Record<string, string | null>>;
    /** Classes to remove (applied before {@link addClass}). */
    removeClass?: readonly string[];
    /** Classes to add. */
    addClass?:    readonly string[];
    /** Classes to force on/off. */
    toggleClass?: Readonly<Record<string, boolean>>;
    /** Attributes to remove (applied before {@link setAttr}). */
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
 * The lone module that holds live DOM references in the handle design. Maps a
 * handle to its node (forward) and a node back to its handle (reverse) so a node
 * is never assigned two handles — that reverse map is what makes handle equality
 * mirror element equality.
 *
 * Two minting modes draw the leak-safety line:
 *
 * - {@link retain} — the framework OWNS the node (it created it). Strong forward
 *   entry; released explicitly at the element's dispose site.
 * - {@link intern} — the node came from the browser and the live DOM already
 *   owns it. Weak forward entry (`WeakRef`) plus a finalizer that drops the
 *   handle once the node is collected. Interning can never pin a dead node.
 */
export class HandleRegistry {
    private readonly _forward = new Map<Handle, Node | WeakRef<Node>>();
    private readonly _reverse = new WeakMap<Node, Handle>();
    private _next = 1;

    /** Drops the forward entry when a weakly-interned node is garbage-collected. */
    private readonly _finalizer = new FinalizationRegistry<Handle>((handle) => {
        this._forward.delete(handle);
    });

    /** Instrumentation: total {@link resolve} calls, for the "one Map.get" proof. */
    private _resolveCount = 0;

    /** Number of resolves performed so far (test instrumentation only). */
    get resolveCount(): number {
        return this._resolveCount;
    }

    /** Live forward-map size (test instrumentation; verifies release/eviction). */
    get size(): number {
        return this._forward.size;
    }

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

        this._forward.set(handle, node);   // strong

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

        this._forward.set(handle, new WeakRef(node));   // weak
        this._finalizer.register(node, handle);

        return handle;
    }

    /**
     * Resolves a handle to its node. Throws on a released or collected handle —
     * a use-after-free becomes a loud failure instead of the silent no-op a raw
     * stale element pointer would give.
     *
     * @param handle - The handle to resolve.
     * @returns The live node.
     */
    resolve(handle: Handle): Node {
        this._resolveCount += 1;

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
     * Releases an owned handle at its element's dispose site. Idempotent. The
     * one operation the migration must place correctly: a missed release on a
     * retained (strong) handle pins a detached element forever.
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

    private _mint(node: Node): Handle {
        const handle = this._next as Handle;

        this._next += 1;
        this._reverse.set(node, handle);

        return handle;
    }
}

/**
 * Applies an {@link ElementPatch} to a resolved element — the terminal raw-DOM
 * write. Fixed order: styles, class removals before additions, attribute
 * removals before sets, then dataset / text / scroll.
 */
function applyPatchTo(element: HTMLElement, patch: ElementPatch): void {
    if (patch.style) {
        for (const key of Object.keys(patch.style)) {
            writeStyle(element.style, key, patch.style[key]);
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
 * The single terminal style write — the same hyphen-keyed branch the real
 * {@link ProductionDOMSink} uses, lifted here so the spike is self-contained.
 */
function writeStyle(style: CSSStyleDeclaration, key: string, value: string | null): void {
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
 * The handle-based write subset, enough to demonstrate the design end to end:
 * create (owned), append (two resolves), and the batched {@link apply}. The
 * production version would carry every {@link DOMSink} method, each taking a
 * handle and resolving through the registry.
 */
export class HandleSink {
    constructor(private readonly _registry: HandleRegistry) {}

    /**
     * Creates a detached element and returns its (strongly-held) handle. The
     * live element never escapes.
     *
     * @param tag - The element tag name.
     * @returns The new element's handle.
     */
    createElement(tag: string): Handle {
        return this._registry.retain(document.createElement(tag));
    }

    /**
     * Appends one handled node to another. Two resolves — the irreducible cost
     * of a cross-element operation; no batching collapses it.
     *
     * @param parent - The parent handle.
     * @param child - The child handle.
     */
    appendChild(parent: Handle, child: Handle): void {
        this._registry.resolve(parent).appendChild(this._registry.resolve(child));
    }

    /**
     * The multi-setter. Resolves `handle` ONCE, then applies every mutation in
     * `patch`. N writes, one `Map.get`. `patch` is plain data, so this whole
     * call is a single serialisable unit.
     *
     * @param handle - The target element handle.
     * @param patch - The batch of mutations.
     */
    apply(handle: Handle, patch: ElementPatch): void {
        applyPatchTo(this._registry.resolve(handle) as HTMLElement, patch);
    }

    /**
     * Fluent convenience that accumulates a patch and flushes it through a
     * single {@link apply}. Ergonomic for migrating imperative call sites; costs
     * one builder allocation per edit, still one handle resolve.
     *
     * @param handle - The target element handle.
     * @returns A builder whose `commit()` performs the single resolve.
     */
    edit(handle: Handle): PatchBuilder {
        return new PatchBuilder((patch) => this.apply(handle, patch));
    }

    /**
     * Releases an owned handle. Delegates to {@link HandleRegistry.release}; the
     * migration calls this at each created element's dispose site.
     *
     * @param handle - The handle to release.
     */
    release(handle: Handle): void {
        this._registry.release(handle);
    }
}

/**
 * Fluent accumulator over an {@link ElementPatch}. Each method appends to the
 * pending patch; {@link commit} flushes it as one batched write. The fluent form
 * is sugar — the batched {@link HandleSink.apply} is the real primitive.
 */
export class PatchBuilder {
    private readonly _patch: {
        style?:       Record<string, string | null>;
        addClass?:    string[];
        removeClass?: string[];
        toggleClass?: Record<string, boolean>;
        setAttr?:     Record<string, string>;
        removeAttr?:  string[];
        dataset?:     Record<string, string>;
        text?:        string;
        scrollLeft?:  number;
        scrollTop?:   number;
    } = {};

    constructor(private readonly _commit: (patch: ElementPatch) => void) {}

    /** Queues an inline-style write (`null` removes). */
    style(key: string, value: string | null): this {
        (this._patch.style ??= {})[key] = value;

        return this;
    }

    /** Queues a class addition. */
    addClass(name: string): this {
        (this._patch.addClass ??= []).push(name);

        return this;
    }

    /** Queues a class removal. */
    removeClass(name: string): this {
        (this._patch.removeClass ??= []).push(name);

        return this;
    }

    /** Queues an attribute set. */
    attr(key: string, value: string): this {
        (this._patch.setAttr ??= {})[key] = value;

        return this;
    }

    /** Queues a text-content write. */
    text(value: string): this {
        this._patch.text = value;

        return this;
    }

    /** Flushes the accumulated patch through one batched write (one resolve). */
    commit(): void {
        this._commit(this._patch);
    }
}
