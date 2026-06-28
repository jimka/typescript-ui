// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * How a layer responds to an outside interaction.
 *
 * - `"click-outside"`: dismissed when a `pointerdown` lands outside the
 *   layer's subtree (and its anchor); ignores focus moves.
 * - `"blur"`: dismissed when either a `pointerdown` or a focus move lands
 *   outside the layer's subtree (and its anchor).
 * - `"manual"`: never dismissed by the document-level handlers; the host
 *   drives its own teardown.
 * - `"modal"`: never dismissed by an outside `pointerdown` or focus move
 *   (the layer captures the interaction); only Escape, routed through the
 *   keydown handler, asks it to close.
 *
 * @category Core
 */
export type LayerDismissMode = "click-outside" | "blur" | "manual" | "modal";

/**
 * A portaled overlay surface that participates in the runtime layer tree.
 * Implemented by [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown),
 * [`Popover`](/api/overlay/classes/Popover),
 * [`Dialog`](/api/overlay/classes/Dialog), and
 * [`Window`](/api/overlay/classes/Window).
 *
 * A surface registers itself with {@link LayerManager.register} from its
 * show path and unregisters with {@link LayerManager.unregister} from its
 * hide path. The manager then owns the z-index stamp, the activation
 * marking, and the dismissal decision — calling {@link DismissableLayer.requestClose}
 * (advisory) when an outside interaction meets the layer's
 * {@link LayerDismissMode}.
 *
 * @category Core
 */
export interface DismissableLayer {
    /** The layer's root element (already mounted on `documentElement`). */
    getLayerElement(): Handle | null;

    /** Dismiss policy consulted by the document-level interaction handlers. */
    getDismissMode(): LayerDismissMode;

    /** Advisory request to close; the surface runs its own teardown + unregister. */
    requestClose(): void;

    /**
     * Optional anchor element excluded from "outside" tests so the trigger
     * click that opened the layer does not immediately re-close it.
     */
    getAnchorElement?(): Handle | null;

    /**
     * Optional activation hook. The manager calls it with `true` when this
     * layer becomes the active (topmost containing) layer for a pointer /
     * focus interaction and `false` when it is superseded. Surfaces that
     * carry an active-state affordance (e.g. a window title bar) map it to
     * their own toggle; surfaces without one omit the method.
     */
    onActivate?(active: boolean): void;

    /**
     * Optional re-stamp hook. The manager calls it with a fresh z-index when
     * {@link LayerManager.bringToFront} re-allocates the layer (or one of its
     * ancestors) while it is already shown, so the surface can mirror the new
     * value onto its element through its own typed `setZIndex`. Surfaces that
     * only read z once in their show path (and never get raised afterwards)
     * may omit it.
     */
    onZIndexChanged?(zIndex: number): void;

    /**
     * Optional z-index band hint. Returns one of {@link LayerManager.Band}'s
     * values so an unrelated peer layer stacks in its surface family's band
     * (Window < Popover < dropdown < Dialog). Omitted surfaces default to the
     * dropdown band. A nested layer ignores its own band and inherits its
     * opener's, so this only matters for top-level (unparented) registrations.
     */
    getBand?(): number;

    /**
     * Optional top-level hint. Returns `true` for a surface that is an
     * independent peer rather than a layer opened from another — a window is
     * not a child of whatever happened to be topmost when it appeared. Such a
     * layer registers as a tree root, so raising it does not drag an unrelated
     * peer up with it (see {@link LayerManager.bringToFront}). Omitted surfaces
     * register under the current topmost layer (the opened-from edge).
     */
    isLayerRoot?(): boolean;
}

/**
 * Node in the runtime layer tree. Generalizes the per-host `LayerEntry`
 * that `AnimatedDropdown` previously kept module-private: `children` are the
 * layers opened while this one was topmost, `band` is the z-index band base
 * the layer was assigned (inherited from its opener), and `zIndex` is the
 * band + counter stamp the manager assigned at register time.
 */
interface LayerNode {
    layer:    DismissableLayer;
    parent:   LayerNode | null;
    children: LayerNode[];
    band:     number;
    zIndex:   number;
}

// Z-index bands. Plain module constants because z-index is not themed
// anywhere today (Theme.ts carries no z-index tokens; the values were inline
// per class). The bands reconcile the four historical bases into one
// ascending allocator and preserve relative order between unrelated peers:
//   Window 9000  <  Popover 9800  <  dropdowns 10000  <  Dialog 11000.
// A nested child inherits its opener's band but always lands above it because
// it registers later and so draws a higher counter. The 200-1000 gap between
// bands leaves headroom for the monotonic `_zCounter`; it is not reset, on the
// assumption a single session opens far fewer than 200 unrelated layers in the
// same band before a reload — the historical inline values made the same bet.
const Z_BAND_WINDOW:   number = 9000;
const Z_BAND_POPOVER:  number = 9800;
const Z_BAND_DROPDOWN: number = 10000;
const Z_BAND_DIALOG:   number = 11000;
// Above every managed layer: a tooltip is a transient, non-interactive
// affordance that must float over even a modal Dialog and its backdrop. Not a
// registered layer band — exposed so the Tooltip singleton stamps itself here
// rather than carrying a magic number that could fall below the Dialog band.
const Z_BAND_TOOLTIP:  number = 12000;

/**
 * Sentinel `Component` used as the registration key for the manager's three
 * document-level listeners. `Event.addViewportListener` binds a listener to a
 * `Component`, but the manager's handlers are module-global (one per type, not
 * per layer), so a single stable sentinel owns them — mirroring `Window`'s
 * `_viewportListenerOwner`. The install/teardown lifecycle keys off the tree
 * being non-empty rather than any individual layer.
 */
const _listenerOwner: Component = new Component();

/**
 * Central registry and document-level interaction broker for portaled overlay
 * surfaces. Owns one runtime layer tree (push-on-register /
 * link-under-current-topmost / pop-on-unregister), one z-index allocator with
 * reserved bands, and a single set of document-level `pointerdown` / `focusin`
 * / `keydown` listeners installed on the first register and removed on the
 * last unregister.
 *
 * The relationship the tree captures — the runtime "opened-from" edge (which
 * layer was topmost when this one opened) — is distinct from the static
 * component hierarchy and changes per activation, so it lives here rather than
 * in the component tree. Containment queries hop across portaled descendant
 * layers via {@link LayerManager.containsAcrossLayers}, which is the single
 * place cross-portal containment is reasoned about.
 *
 * @category Core
 */
export namespace LayerManager {

    // LIFO stack of open layers in register order; the last entry is topmost.
    const _stack: LayerNode[] = [];

    // Membership + node lookup keyed by the layer instance, generalizing the
    // per-host `_entryByLayer` WeakMap.
    const _nodeByLayer: WeakMap<DismissableLayer, LayerNode> = new WeakMap();

    // Ascending per-register counter; combined with a band base to stamp z.
    let _zCounter: number = 0;

    // The layer currently marked active (received the last `onActivate(true)`).
    let _activeLayer: DismissableLayer | null = null;

    let _listenersInstalled: boolean = false;

    /**
     * The four z-index bands a surface returns from
     * {@link DismissableLayer.getBand}. Exposed so each surface can tag itself
     * without re-declaring the constants. Reconciles the historical inline
     * bases (Window 9000, Popover 9998, dropdowns 10050, Dialog 10101) into
     * one ascending allocator.
     */
    export const Band = {
        Window:   Z_BAND_WINDOW,
        Popover:  Z_BAND_POPOVER,
        Dropdown: Z_BAND_DROPDOWN,
        Dialog:   Z_BAND_DIALOG,
        Tooltip:  Z_BAND_TOOLTIP,
    } as const;

    /**
     * Picks the z-index band for a layer. A nested layer inherits its
     * opener's band so it stays in the same stacking neighbourhood (and rises
     * above the opener because it registers later); an unrelated peer uses its
     * own surface-type band from {@link DismissableLayer.getBand}.
     */
    function bandFor(parent: LayerNode | null, ownBand: number): number {
        return parent ? parent.band : ownBand;
    }

    /**
     * Pushes `layer` as a child of the current topmost layer — unless it
     * declares itself a top-level peer via
     * {@link DismissableLayer.isLayerRoot}, in which case it registers as a
     * tree root — assigns its band-based z-index, and installs the
     * document-level listeners on the first call. A duplicate register (e.g. a
     * `showAnimated` that cancels an in-flight fade-out) is a no-op so the tree
     * never double-pushes.
     *
     * @param layer - The surface entering the layer tree.
     */
    export function register(layer: DismissableLayer): void {
        if (_nodeByLayer.has(layer)) {
            return;
        }

        const topmost = _stack.length > 0 ? _stack[_stack.length - 1] : null;
        const parent  = layer.isLayerRoot?.() ? null : topmost;
        const band    = bandFor(parent, layer.getBand?.() ?? Z_BAND_DROPDOWN);
        const zIndex = band + (++_zCounter);

        const node: LayerNode = { layer, parent, children: [], band, zIndex };

        _nodeByLayer.set(layer, node);
        _stack.push(node);

        if (parent) {
            parent.children.push(node);
        }

        if (!_listenersInstalled) {
            installListeners();
        }
    }

    /**
     * Pops `layer` from the tree (and unlinks it from its parent's child
     * list), clears it as active if it was, and removes the document-level
     * listeners on the last call.
     *
     * @param layer - The surface leaving the layer tree.
     */
    export function unregister(layer: DismissableLayer): void {
        const node = _nodeByLayer.get(layer);

        if (!node) {
            return;
        }

        _nodeByLayer.delete(layer);

        const idx = _stack.indexOf(node);

        if (idx >= 0) {
            _stack.splice(idx, 1);
        }

        if (node.parent) {
            const ci = node.parent.children.indexOf(node);

            if (ci >= 0) {
                node.parent.children.splice(ci, 1);
            }
        }

        if (_activeLayer === layer) {
            _activeLayer = null;
        }

        if (_stack.length === 0 && _listenersInstalled) {
            uninstallListeners();
        }
    }

    /**
     * Returns true when `node` is inside `layer`'s own element OR inside any
     * descendant layer's element. This is the only cross-portal containment
     * hop in the framework: a `pointerdown` or focus move that lands in a
     * child layer (e.g. a dropdown opened from inside a popover) counts as
     * inside the ancestor so the ancestor stays open.
     *
     * @param layer - The layer whose subtree is tested.
     * @param node - The DOM node receiving the interaction.
     * @returns True when `node` is inside `layer` or any descendant layer.
     */
    export function containsAcrossLayers(layer: DismissableLayer, node: Handle | null): boolean {
        if (!node) {
            return false;
        }

        const layerNode = _nodeByLayer.get(layer);

        if (!layerNode) {
            const el = layer.getLayerElement();

            return el ? DOM.source.contains(el, node) : false;
        }

        return nodeContains(layerNode, node);
    }

    /**
     * Returns the topmost currently-registered layer, or null when none is
     * open.
     *
     * @returns The topmost open layer, or null.
     */
    export function getTopLayer(): DismissableLayer | null {
        return _stack.length > 0 ? _stack[_stack.length - 1].layer : null;
    }

    /**
     * Re-stamps `layer` (and its descendant layers) with fresh top-of-band
     * z-indices and marks it active. Used by surfaces that raise on click
     * (e.g. a window brought to front), so the raised layer — and anything it
     * opened — jumps above its band peers without disturbing other bands.
     *
     * @param layer - The layer to raise and activate.
     */
    export function bringToFront(layer: DismissableLayer): void {
        const node = _nodeByLayer.get(layer);

        if (!node) {
            return;
        }

        restampSubtree(node);
        markActive(layer);
    }

    /**
     * Returns the z-index currently assigned to `layer`, for surfaces that
     * mirror it elsewhere. Falls back to the dropdown band when the layer is
     * not registered.
     *
     * @param layer - The layer whose stamp to read.
     * @returns The assigned z-index.
     */
    export function getZIndex(layer: DismissableLayer): number {
        const node = _nodeByLayer.get(layer);

        return node ? node.zIndex : Z_BAND_DROPDOWN;
    }

    /**
     * Re-stamps `node`'s subtree from a fresh top-of-band counter run so the
     * raised layer and its descendants ascend together, preserving their
     * relative order. Each re-stamped layer is notified via
     * {@link DismissableLayer.onZIndexChanged} so it can mirror the new value
     * through its own typed `setZIndex` (the manager never writes the DOM).
     */
    function restampSubtree(node: LayerNode): void {
        const walk = (n: LayerNode): void => {
            n.zIndex = n.band + (++_zCounter);
            n.layer.onZIndexChanged?.(n.zIndex);

            for (const child of n.children) {
                walk(child);
            }
        };

        walk(node);
    }

    /** True when `node` (or a descendant layer) contains `target`. */
    function nodeContains(node: LayerNode, target: Handle): boolean {
        const el = node.layer.getLayerElement();

        if (el && DOM.source.contains(el, target)) {
            return true;
        }

        for (const child of node.children) {
            if (nodeContains(child, target)) {
                return true;
            }
        }

        return false;
    }

    /** Marks `layer` active and deactivates the previously-active layer. */
    function markActive(layer: DismissableLayer): void {
        if (_activeLayer === layer) {
            return;
        }

        deactivateActive();

        _activeLayer = layer;

        if (layer.onActivate) {
            layer.onActivate(true);
        }
    }

    /** Deactivates the currently-active layer, if any. */
    function deactivateActive(): void {
        if (_activeLayer && _activeLayer.onActivate) {
            _activeLayer.onActivate(false);
        }

        _activeLayer = null;
    }

    /**
     * Walks up the "opened-from" chain from `node` and returns the nearest
     * ancestor-or-self layer that carries an activation affordance
     * ({@link DismissableLayer.onActivate}), or `null` if none does. A layer
     * opened inside a window resolves to that window, so the window stays
     * active while its descendant holds focus — interacting with a child layer
     * must not darken the title bar of the window that owns it.
     */
    function activatableAncestor(node: LayerNode): DismissableLayer | null {
        let cur: LayerNode | null = node;

        while (cur) {
            if (cur.layer.onActivate) {
                return cur.layer;
            }

            cur = cur.parent;
        }

        return null;
    }

    /**
     * Walks the stack top-down for a pointer / focus interaction at `target`,
     * dismissing each topmost layer whose dismiss mode and containment test
     * say the interaction landed outside it, and marking the topmost
     * containing layer active. `focusOnly` is true for the `focusin` pass, so
     * only `"blur"` layers act on it (a `"click-outside"` layer ignores focus
     * moves).
     */
    function handleOutside(target: Handle | null, focusOnly: boolean): void {
        // Snapshot top-down so requestClose-driven unregisters don't disturb
        // the walk; re-read containment against the live tree each step.
        const snapshot  = _stack.slice().reverse();
        let activated   = false;
        let landedInside = false;

        for (const node of snapshot) {
            const mode = node.layer.getDismissMode();

            if (containsAcrossLayers(node.layer, target)) {
                // Activation belongs to the nearest activatable ancestor (the
                // window a child layer was opened from), not the innermost
                // containing layer; fall back to the layer itself when nothing
                // up the chain carries an activation affordance, preserving the
                // prior behaviour for standalone layers.
                markActive(activatableAncestor(node) ?? node.layer);
                activated    = true;
                landedInside = true;

                break;
            }

            const anchor = node.layer.getAnchorElement?.();

            if (anchor && target && DOM.source.contains(anchor, target)) {
                landedInside = true;

                break;
            }

            const dismissable = mode === "click-outside" || mode === "blur";
            const acts        = focusOnly ? mode === "blur" : dismissable;

            if (mode === "manual" || mode === "modal" || !acts) {
                // Modal captures the interaction: an outside pointer/focus on a
                // modal must not fall through to dismiss layers beneath it.
                if (mode === "modal") {
                    landedInside = true;

                    break;
                }

                continue;
            }

            node.layer.requestClose();
        }

        // An interaction that landed outside every layer's subtree (and any
        // anchor / modal capture) deactivates the active layer — e.g. an
        // empty-viewport click that should drop a window's active title-bar
        // highlight. A focus move to a non-layer element (focusOnly) does not
        // deactivate, so tabbing through page chrome doesn't flicker the
        // active window.
        if (!activated && !landedInside && !focusOnly) {
            deactivateActive();
        }
    }

    /** Document `pointerdown` handler — see {@link handleOutside}. */
    function onPointerDown(e: PointerEvent): void {
        handleOutside(e.target === null ? null : DOM.source.intern(e.target), false);
    }

    /**
     * Window `blur` handler. When the whole browser window loses focus (the user
     * clicks another application or alt-tabs away) no in-page `pointerdown` or
     * `focusin` fires, so an open layer would otherwise stay up. Treat it as an
     * interaction landing outside every layer, dismissing each `"click-outside"`
     * / `"blur"` layer while a `"modal"` shields those beneath it and `"manual"`
     * layers (windows) are left open.
     *
     * @remarks Viewport listeners are capture-phase, so element blurs from within
     * the page surface here too; only a genuine window blur (`target` is the
     * window itself) should dismiss layers.
     */
    function onWindowBlur(e: FocusEvent): void {
        if (!DOM.source.isWindow(e.target === null ? null : DOM.source.intern(e.target))) {
            return;
        }

        handleOutside(null, false);
    }

    /** Document `focusin` handler — only `"blur"` layers act on it. */
    function onFocusIn(e: FocusEvent): void {
        handleOutside(e.target === null ? null : DOM.source.intern(e.target), true);
    }

    /** Document `keydown` handler — Escape asks the topmost non-manual layer to close. */
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key !== "Escape") {
            return;
        }

        for (let i = _stack.length - 1; i >= 0; i--) {
            const mode = _stack[i].layer.getDismissMode();

            if (mode === "manual") {
                continue;
            }

            _stack[i].layer.requestClose();

            return;
        }
    }

    /** Installs the three document-level listeners against the sentinel owner. */
    function installListeners(): void {
        Event.addViewportListener(_listenerOwner, "pointerdown", onPointerDown);
        Event.addViewportListener(_listenerOwner, "focusin",     onFocusIn);
        Event.addViewportListener(_listenerOwner, "keydown",     onKeyDown);
        Event.addViewportListener(_listenerOwner, "blur",        onWindowBlur);

        _listenersInstalled = true;
    }

    /** Removes the three document-level listeners. */
    function uninstallListeners(): void {
        Event.removeViewportListener(_listenerOwner, "pointerdown", onPointerDown);
        Event.removeViewportListener(_listenerOwner, "focusin",     onFocusIn);
        Event.removeViewportListener(_listenerOwner, "keydown",     onKeyDown);
        Event.removeViewportListener(_listenerOwner, "blur",        onWindowBlur);

        _listenersInstalled = false;
    }
}
