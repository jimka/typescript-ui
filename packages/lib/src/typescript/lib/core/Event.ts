// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * Event routing system that manages DOM event listeners on behalf of components.
 * Uses a single window-level capture handler per event type to avoid per-element listeners.
 *
 * @category Core
 */
export namespace Event {
    /** A registered listener paired with the options it was registered with. */
    interface ListenerEntry {
        listener: Listener,
        options?: ListenerOptions,
    }

    interface CompFunc {
        component: Component,
        listeners: ListenerEntry[]
    };

    /**
     * Per-call override of the default registration options for a listener.
     *
     * @remarks `passive` is a per-*type* setting: once a type has been
     * registered with a given `passive` value, subsequent registrations for
     * the same type must agree — `addListener` / `addSubtreeListener` throw
     * on conflict, since the window-level capture handler is installed once
     * per type and locks that setting for its lifetime. `button` is a
     * per-*listener* setting with no such conflict — different listeners on
     * the same type may set it independently.
     */
    export interface ListenerOptions {
        /**
         * Override the type's default passive setting. When `false`, listeners
         * for this type may call `preventDefault()` on the received event.
         */
        passive?: boolean;

        /**
         * Restricts which button state — see {@link isPrimaryButton} — this
         * listener fires for:
         * - `"primary"` — only a primary (left) press, or an event with no
         *   `button` property at all (touch, hand-built fixtures).
         * - `"aux"` — only a defined, non-zero button (right/middle/back/
         *   forward); never fires for touch. Named after the `auxclick`
         *   event, which fires under this same condition — any non-primary
         *   button, not just the middle button despite the DOM's
         *   `MouseEvent.button` value `1` also being labelled "auxiliary".
         * - `"any"` — every button, regardless of state. Use this for a
         *   listener that reacts to a button-agnostic gesture (dismissing a
         *   tooltip on any press, bringing a window to front on any press,
         *   …) rather than *initiating* a primary-button interaction.
         *
         * Unset resolves to `"primary"` for a short list of press-initiating
         * types (`mousedown`, `mouseup`, `click`, `dblclick`, `pointerdown`,
         * `pointerup` — see the internal `PRIMARY_BUTTON_TYPES` set in
         * Event.ts) and `"any"` for every other type, since only those few
         * types actually represent an initiating press. Set this explicitly
         * to override the default either way.
         *
         * `"click"` is unaffected by any of this — the dispatcher gates it
         * to the primary button unconditionally regardless of this option.
         */
        button?: "primary" | "aux" | "any";

        /**
         * Unconditionally halts DOM propagation (`stopPropagation`) after
         * this listener runs, OR'd with whatever the listener itself
         * returns — it is a floor, not an override, so a listener cannot
         * un-set it by returning `false`/`void`. Set this only when EVERY
         * code path through the listener wants the same outcome; a
         * listener whose disposition depends on runtime state (an early
         * guard-clause return, a conditional check) must leave this unset
         * and keep returning its {@link EventDisposition} instead.
         */
        stop?: boolean;

        /**
         * Unconditionally suppresses the default action (`preventDefault`)
         * after this listener runs. Same floor semantics as {@link stop}.
         */
        prevent?: boolean;
    }

    /**
     * A listener bundled with its registration options into a single
     * argument, for the {@link addListener} / {@link addSubtreeListener}
     * overload that takes options.
     */
    export interface ListenerRegistration extends ListenerOptions {
        /** The callback invoked when the event fires. See {@link addListener}. */
        handler: Listener;
    }

    /**
     * What a listener asks the dispatcher to do with the event it handled.
     */
    export interface EventDisposition {
        /** Halt DOM propagation (`stopPropagation`). */
        stop?:    boolean;
        /** Suppress the browser's default action (`preventDefault`). */
        prevent?: boolean;
    }

    /** `true` is shorthand for `{ stop: true }`. Returning nothing leaves the event alone. */
    export type ListenerResult = boolean | EventDisposition | void;

    /** A DOM-routed listener registered through the `Event` API. */
    export type Listener = (event: any) => ListenerResult;

    /**
     * Reports whether a mouse/pointer event represents a primary-button
     * press. Share this rather than re-deriving it: `button === undefined`
     * (a hand-built test fixture, or a `TouchEvent`, which carries no
     * `button` at all) is treated as primary, matching the DOM's own
     * `MouseEventInit.button` default of `0` — only a defined, non-zero
     * value (right/middle/back/forward) is rejected.
     *
     * @remarks A bare `addListener`/`addSubtreeListener` registration already
     * gets primary-only filtering for free from the dispatcher's default —
     * see {@link ListenerOptions.button}. This helper remains useful for two
     * cases the default doesn't cover: a listener registered `button: "any"`
     * that still needs a primary check for part of its own logic (e.g. a
     * viewport listener, which isn't button-filtered at all), and a public
     * method (a drag-initiating entry point a subclass or consumer can call
     * directly, bypassing the dispatcher) validating its own precondition.
     *
     * @param e - A mouse, pointer, or touch event.
     * @returns True when the event should be treated as a primary-button press.
     */
    export function isPrimaryButton(e: MouseEvent | PointerEvent | TouchEvent): boolean {
        const button = (e as MouseEvent | PointerEvent).button;

        return button === undefined || button === 0;
    }

    /**
     * Event types whose bare registration means "primary button only" — the
     * gestures that actually initiate a press. Every other type defaults to
     * `"any"`: `contextmenu` (already the button-agnostic "open a menu"
     * signal — right-click, a keyboard context-menu key, a touch
     * long-press), the pointer move/cancel/capture-loss family (the Pointer
     * Events spec reports `button: -1`, "no button change", for all of
     * them), the mouse-flavoured half of that same family (`mousemove` /
     * `mouseover` / `mouseout` / `mouseenter` / `mouseleave`, whose `button`
     * likewise never represents a press), and `auxclick` (which by
     * definition never carries `button: 0`, so a `"primary"` default would
     * mean a bare registration on it could never fire).
     */
    const PRIMARY_BUTTON_TYPES: ReadonlySet<string> = new Set([
        "mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup",
    ]);

    /**
     * Applies a {@link ListenerOptions.button} filter to a dispatched event.
     * `undefined` (unset) resolves to `"primary"` for a type in
     * {@link PRIMARY_BUTTON_TYPES}, `"any"` for every other type.
     */
    function passesButtonFilter(evnt: Event, type: string, filter: ListenerOptions["button"]): boolean {
        const effective = filter ?? (PRIMARY_BUTTON_TYPES.has(type) ? "primary" : "any");

        if (effective === "any") {
            return true;
        }

        const primary = isPrimaryButton(evnt as MouseEvent);

        return effective === "aux" ? !primary : primary;
    }

    let listenerMap = new Map<String, Map<String, CompFunc>>();
    let viewportListenerMap = new Map<String, Map<String, CompFunc>>();
    let subtreeListenerMap = new Map<String, Map<String, CompFunc>>();
    let installedListenerTypes = new Set<string>();
    let installedListenerOpts = new Map<string, AddEventListenerOptions>();

    const PASSIVE_TYPES: Set<string> = new Set(["scroll", "wheel", "touchstart", "touchmove"]);

    function captureOpts(type: string, override?: ListenerOptions): AddEventListenerOptions {
        const passive = override?.passive ?? PASSIVE_TYPES.has(type);

        return { capture: true, passive };
    }

    /**
     * Applies a listener's returned disposition to the event, OR'd with its
     * registration's {@link ListenerOptions.stop} / {@link
     * ListenerOptions.prevent} floor, if any — either source alone is
     * enough to trigger the corresponding action.
     *
     * @returns `true` when propagation was stopped, so a dispatcher can end its walk.
     */
    function applyDisposition(evnt: Event, result: ListenerResult, options?: ListenerOptions): boolean {
        const stop = !!options?.stop || result === true || (typeof result === "object" && !!result?.stop);
        const prevent = !!options?.prevent || (typeof result === "object" && !!result?.prevent);

        if (prevent) {
            evnt.preventDefault();
        }

        if (stop) {
            evnt.stopPropagation();

            return true;
        }

        return false;
    }

    function installBaseListener(type: string, options?: ListenerOptions): void {
        if (!installedListenerTypes.has(type)) {
            const opts = captureOpts(type, options);

            installedListenerTypes.add(type);
            installedListenerOpts.set(type, opts);
            DOM.sink.addListener(DOM.source.getWindow(), type, baseListener, opts);

            return;
        }

        if (!options) {
            return;
        }

        const prev = installedListenerOpts.get(type)!;
        const next = captureOpts(type, options);

        if (prev.passive !== next.passive || prev.capture !== next.capture) {
            throw new Error(
                "Event listener options for '" + type +
                "' conflict with earlier registration"
            );
        }
    }

    function uninstallBaseListener(type: string): void {
        const opts = installedListenerOpts.get(type) ?? captureOpts(type);

        installedListenerTypes.delete(type);
        installedListenerOpts.delete(type);
        DOM.sink.removeListener(DOM.source.getWindow(), type, baseListener, opts);
    }

    let baseListener = function (evnt: Event) {
        // "click" is the framework-wide activation event (buttons, links,
        // checkboxes, menu items, ...) and is meant to represent a primary
        // (left) mouse-button activation. Reject any other button here so
        // every consumer gets that guarantee for free. `fireEvent(component,
        // "click")` (a programmatic `.click()`) dispatches a plain
        // `CustomEvent`, which carries no `button` property at all —
        // `isPrimaryButton` treats that as primary rather than rejecting it.
        if (evnt.type === "click" && !isPrimaryButton(evnt as MouseEvent)) {
            return;
        }

        // The dispatcher does NOT stop propagation on a component's behalf: an
        // event is halted only when a handler's returned disposition asks for
        // it (see `applyDisposition`). An unconsumed event therefore keeps
        // propagating — through the bubble phase and on to any
        // `document`-level listener (e.g. a consumer's global keyboard
        // accelerator), which a proactive stop here used to swallow whenever
        // the focused element happened to carry a library listener.
        let propagationStopped = false;

        // Intern the raw browser target into a handle at the boundary so no
        // downstream code holds the live node; every read below climbs in
        // handle space.
        const targetHandle = evnt.target === null ? null : DOM.source.intern(evnt.target);

        let listeners = listenerMap.get(evnt.type);
        if (listeners && targetHandle !== null) {
            let elementId = DOM.source.getId(targetHandle);
            let compFunc = listeners.get(elementId);

            if (compFunc) {
                for (let entry of compFunc.listeners) {
                    if (!passesButtonFilter(evnt, evnt.type, entry.options?.button)) {
                        continue;
                    }

                    if (applyDisposition(evnt, entry.listener.apply(compFunc.component, [evnt]), entry.options)) {
                        propagationStopped = true;
                    }
                }
            }
        }

        if (propagationStopped) {
            return;
        }

        let subtreeListeners = subtreeListenerMap.get(evnt.type);
        if (!subtreeListeners) {
            return;
        }

        let handle: Handle | null = targetHandle;
        while (handle) {
            let id: string;

            try {
                id = DOM.source.getId(handle);
            } catch {
                // `handle` was released by a disposal that ran synchronously earlier
                // in this same event's dispatch — the exact-target listener phase
                // above (a click that disposes its own target, e.g. a tab's close
                // button), or a subtree listener on a nearer ancestor already
                // visited by this same walk, disposing itself or a not-yet-visited
                // ancestor. Nothing further up this chain can be resolved through
                // this handle either, so the walk ends here instead of throwing.
                // Mirrors FocusHistory.isLive's identical guard around a stale focus
                // handle (core/FocusHistory.ts:82-92).
                return;
            }

            if (id) {
                let compFunc = subtreeListeners.get(id);
                if (compFunc) {
                    for (let entry of compFunc.listeners) {
                        if (!passesButtonFilter(evnt, evnt.type, entry.options?.button)) {
                            continue;
                        }

                        if (applyDisposition(evnt, entry.listener.apply(compFunc.component, [evnt]), entry.options)) {
                            propagationStopped = true;
                        }
                    }
                }
            }

            if (propagationStopped) {
                return;
            }

            try {
                handle = DOM.source.getParentElement(handle);
            } catch {
                // Same reentrancy hazard as above, at the climb-to-parent step: the
                // listeners that just ran on `handle` (immediately above) can
                // themselves have disposed the component `handle` belongs to.
                return;
            }
        }
    };

    let baseViewportListener = function (evnt: Event) {
        let typeListeners = viewportListenerMap.get(evnt.type);
        if (!typeListeners) {
            return;
        }

        for (let listeners of typeListeners) {
            let compFunc = listeners[1];
            if (!compFunc) {
                continue;
            }

            let component = compFunc.component;

            for (let entry of compFunc.listeners) {
                applyDisposition(evnt, entry.listener.apply(component, [evnt]), entry.options);
            }
        }
    };

    /**
     * Initialises the event system (currently a no-op).
     */
    export function init() {

    }

    /**
     * Dispatches a CustomEvent of the given type on the component's DOM element.
     *
     * @param component - The component whose DOM element will dispatch the event.
     * @param type - The event type string (e.g. `"click"`).
     * @param payload - Optional. Arbitrary data attached as the CustomEvent detail.
     *
     * @remarks Throws an error if the component has no associated DOM element at the time of the call.
     */
    export function fireEvent(component: Component, type: string, payload?: any): void;

    /**
     * Dispatches a pre-built event on the component's DOM element.
     *
     * @param component - The component whose DOM element will dispatch the event.
     * @param event - A pre-built DOM event to dispatch as-is.
     *
     * @remarks Useful when the event type and its properties must be preserved exactly
     * (e.g. proxying a KeyboardEvent). Throws an error if the component has no DOM element.
     */
    export function fireEvent(component: Component, event: globalThis.Event): void;

    export function fireEvent(component: Component, typeOrEvent: string | globalThis.Event, payload?: any): void {
        const element = component.getElement();
        if (!element) {
            const type = typeof typeOrEvent === 'string' ? typeOrEvent : typeOrEvent.type;
            throw new Error("Cannot fire event '" + type + "'. Component '" + component.getId() + "' is not in the DOM.");
        }

        if (typeof typeOrEvent === 'string') {
            DOM.sink.dispatchCustomEvent(element, typeOrEvent, payload);
        } else {
            DOM.sink.dispatchEvent(element, typeOrEvent);
        }
    }

    /**
     * Resolves the `addListener` / `addSubtreeListener` overload argument
     * into a handler and its options, splitting `handler` back out of a
     * {@link ListenerRegistration} so `entry.options` never carries a
     * redundant self-reference to the same function as `entry.listener`.
     */
    function resolveRegistration(
        listenerOrRegistration: Listener | ListenerRegistration,
    ): [Listener | undefined, ListenerOptions | undefined] {
        if (!listenerOrRegistration || typeof listenerOrRegistration === "function") {
            return [listenerOrRegistration as Listener | undefined, undefined];
        }

        const { handler, ...options } = listenerOrRegistration;

        return [handler, options];
    }

    /**
     * Finds or creates the `CompFunc` for `(type, component)` in `map` and
     * appends `{ listener, options }` — or, when that exact `listener`
     * reference is already registered there, overwrites its stored
     * `options` instead of adding a second entry. Shared by `addListener`
     * and `addSubtreeListener`, which differ only in which map they write to.
     */
    function registerEntry(
        map: Map<String, Map<String, CompFunc>>,
        component: Component,
        type: string,
        listener: Listener,
        options: ListenerOptions | undefined,
    ): void {
        // Validate BEFORE touching `map`: `installBaseListener` throws on a
        // passive-option conflict, and it must do so before a fresh, empty
        // `typeMap` is inserted — otherwise a failed registration leaves a
        // stale `type -> emptyMap` entry behind, which later cleanup paths
        // (e.g. `purgeComponent`'s plain `.has(type)` check) mistake for a
        // live registration and never uninstall the base listener for.
        installBaseListener(type, options);

        let typeMap = map.get(type);
        if (!typeMap) {
            typeMap = new Map<String, CompFunc>();
            map.set(type, typeMap);
        }

        let compFunc = typeMap.get(component.getId());
        if (!compFunc) {
            compFunc = { component, listeners: [] };
            typeMap.set(component.getId(), compFunc);
        }

        const existing = compFunc.listeners.find((entry) => entry.listener === listener);

        if (existing) {
            // A second registration of the same reference is not a second listener —
            // it re-configures the one already registered. Overwriting `options`
            // (rather than dropping the call, as this did before) is what lets a
            // rebuilt element's `init()` re-run land its CURRENT options instead of
            // silently inheriting whatever the first registration passed.
            existing.options = options;

            return;
        }

        compFunc.listeners.push({ listener, options });
    }

    /**
     * Removes the entry for `listener` from `map`'s `(type, component)`
     * `CompFunc`, and cleans up the map/type-map entries it leaves empty.
     * Shared by `removeListener` and `removeSubtreeListener` — each still
     * runs its own cross-map `uninstallBaseListener` check afterward, since
     * exact-target and subtree registrations share one window-level handler
     * per type.
     */
    function unregisterEntry(
        map: Map<String, Map<String, CompFunc>>,
        component: Component,
        type: string,
        listener: Listener,
    ): void {
        let typeMap = map.get(type);
        if (!typeMap) {
            return;
        }

        let compFunc = typeMap.get(component.getId());
        if (!compFunc) {
            return;
        }

        let idx = compFunc.listeners.findIndex((entry) => entry.listener === listener);
        if (idx >= 0) {
            compFunc.listeners.splice(idx, 1);
        }

        if (compFunc.listeners.length === 0) {
            typeMap.delete(component.getId());
        }

        if (typeMap.size === 0) {
            map.delete(type);
        }
    }

    /**
     * Registers a listener for a DOM event type on the given component, using a single window-level handler per type.
     *
     * @param component - The component to associate the listener with.
     * @param type - The DOM event type string to listen for.
     * @param listener - The callback invoked when the event fires on this
     * component. Its return value tells the dispatcher what to do with the
     * event: `true` stops propagation, `{ prevent: true }` suppresses the
     * default action, `{ stop: true, prevent: true }` does both, and nothing
     * (or `false`) leaves the event untouched.
     *
     * @remarks A capture-phase window listener is installed the first time a given event type is registered,
     * and removed automatically when the last listener for that type is unregistered. Re-registering the
     * same function reference does not add a second listener — it replaces that registration's options; a
     * fresh inline closure has no identity to match, so a site that can run more than once must pass a
     * stable reference.
     */
    export function addListener(component: Component, type: string, listener: Listener): void;

    /**
     * Registers a listener for a DOM event type, bundled with explicit
     * registration options into a single argument.
     *
     * @param component - The component to associate the listener with.
     * @param type - The DOM event type string to listen for.
     * @param registration - The handler plus overrides for the default
     * registration options. `handler` — see the two-argument overload.
     * `passive` is native-listener-level: once a type has been registered
     * with a given `passive` value, subsequent registrations for the same
     * type must agree, or this function throws. `button` is per-listener —
     * see {@link ListenerOptions.button}. `stop` / `prevent` are an
     * unconditional floor applied regardless of `handler`'s return value —
     * see {@link ListenerOptions.stop}.
     *
     * @remarks Re-registering the same function reference does not add a second listener — it replaces
     * that registration's options; a fresh inline closure has no identity to match, so a site that can
     * run more than once must pass a stable reference.
     */
    export function addListener(component: Component, type: string, registration: ListenerRegistration): void;

    export function addListener(
        component: Component,
        type: string,
        listenerOrRegistration: Listener | ListenerRegistration,
    ): void {
        const [listener, options] = resolveRegistration(listenerOrRegistration);

        if (!listener || !component) {
            return;
        }

        registerEntry(listenerMap, component, type, listener, options);
    }

    /**
     * Removes a previously registered component event listener.
     *
     * @param component - The component whose listener should be removed.
     * @param type - The DOM event type string the listener was registered for.
     * @param listener - The exact callback function reference that was passed to `addListener`.
     *
     * @remarks If removing the listener leaves a component or event type with no remaining listeners,
     * the corresponding map entries and the window-level handler are cleaned up automatically.
     */
    export function removeListener(component: Component, type: string, listener: Listener) {
        if (!listener || !component) {
            return;
        }

        unregisterEntry(listenerMap, component, type, listener);

        const subtreeMap = subtreeListenerMap.get(type);
        const bothEmpty = !listenerMap.has(type) && (!subtreeMap || subtreeMap.size === 0);
        if (bothEmpty && installedListenerTypes.has(type)) {
            uninstallBaseListener(type);
        }
    }

    /**
     * Registers a listener that fires whenever the given event type targets this component
     * or any of its DOM descendants.
     *
     * @param component - The ancestor component to watch.
     * @param type - The DOM event type string to listen for.
     * @param listener - The callback invoked when a matching event bubbles
     * through this component's subtree. Its return value tells the
     * dispatcher what to do with the event: `true` stops propagation (ending
     * the walk after every listener on this component has run — no further
     * ancestor is visited), `{ prevent: true }` suppresses the default
     * action, `{ stop: true, prevent: true }` does both, and nothing (or
     * `false`) leaves the event untouched.
     *
     * @remarks Unlike `addListener`, which only matches the exact event target, this fires for
     * any event whose target is a descendant of the component's element. Multiple components
     * may register subtree listeners for the same event type; all matching ancestors are notified.
     * Re-registering the same function reference does not add a second listener — it replaces
     * that registration's options; a fresh inline closure has no identity to match, so a site
     * that can run more than once must pass a stable reference.
     */
    export function addSubtreeListener(component: Component, type: string, listener: Listener): void;

    /**
     * Registers a subtree listener, bundled with explicit registration
     * options into a single argument.
     *
     * @param component - The ancestor component to watch.
     * @param type - The DOM event type string to listen for.
     * @param registration - See {@link addListener}'s registration overload.
     *
     * @remarks Re-registering the same function reference does not add a second listener — it replaces
     * that registration's options; a fresh inline closure has no identity to match, so a site that can
     * run more than once must pass a stable reference.
     */
    export function addSubtreeListener(component: Component, type: string, registration: ListenerRegistration): void;

    export function addSubtreeListener(
        component: Component,
        type: string,
        listenerOrRegistration: Listener | ListenerRegistration,
    ): void {
        const [listener, options] = resolveRegistration(listenerOrRegistration);

        if (!listener || !component) {
            return;
        }

        registerEntry(subtreeListenerMap, component, type, listener, options);
    }

    /**
     * Removes a previously registered subtree event listener.
     *
     * @param component - The component whose subtree listener should be removed.
     * @param type - The DOM event type string the listener was registered for.
     * @param listener - The exact callback function reference that was passed to `addSubtreeListener`.
     */
    export function removeSubtreeListener(component: Component, type: string, listener: Listener): void {
        if (!listener || !component) {
            return;
        }

        unregisterEntry(subtreeListenerMap, component, type, listener);

        const exactMap = listenerMap.get(type);
        const bothEmpty = (!exactMap || exactMap.size === 0) && !subtreeListenerMap.has(type);
        if (bothEmpty && installedListenerTypes.has(type)) {
            uninstallBaseListener(type);
        }
    }

    /**
     * @internal Migrates a component's exact-target and subtree listener
     * registrations from `oldId` to `newId` after its id changes. No-op when the
     * ids are equal or the component has no registrations. Does not touch viewport
     * listeners (dispatched by whole-map iteration, not by id).
     */
    export function reindexComponent(oldId: string, newId: string): void {
        if (oldId === newId) {
            return;
        }

        for (const typeMap of listenerMap.values()) {
            const compFunc = typeMap.get(oldId);
            if (compFunc) {
                typeMap.set(newId, compFunc);
                typeMap.delete(oldId);
            }
        }

        for (const typeMap of subtreeListenerMap.values()) {
            const compFunc = typeMap.get(oldId);
            if (compFunc) {
                typeMap.set(newId, compFunc);
                typeMap.delete(oldId);
            }
        }
    }

    /**
     * @internal Drops every exact-target, subtree and viewport listener
     * registration held under `componentId`, and uninstalls each window-level
     * base listener whose last registration this removed. Called from
     * `Component.destructor`. No-op for an id with no registrations.
     */
    export function purgeComponent(componentId: string): void {
        const touched = new Set<string>();

        // The maps are declared with `String` (object) keys throughout this
        // module while every write passes a primitive, so normalise on the
        // way out (same reasoning as `_registeredComponentIds` below).
        for (const [type, typeMap] of listenerMap) {
            if (typeMap.delete(componentId)) {
                touched.add(String(type));

                if (typeMap.size === 0) {
                    listenerMap.delete(type);
                }
            }
        }

        for (const [type, typeMap] of subtreeListenerMap) {
            if (typeMap.delete(componentId)) {
                touched.add(String(type));

                if (typeMap.size === 0) {
                    subtreeListenerMap.delete(type);
                }
            }
        }

        // Both id-routed maps share one window-level base listener per type, so the
        // uninstall check runs once per touched type after both loops — mirroring
        // the `bothEmpty` test in removeListener / removeSubtreeListener.
        for (const type of touched) {
            if (!listenerMap.has(type) && !subtreeListenerMap.has(type) && installedListenerTypes.has(type)) {
                uninstallBaseListener(type);
            }
        }

        // The viewport map has its own base listener, installed and removed with
        // the type-map itself rather than through installedListenerTypes.
        for (const [type, typeMap] of viewportListenerMap) {
            if (!typeMap.delete(componentId) || typeMap.size > 0) {
                continue;
            }

            viewportListenerMap.delete(type);

            const typeStr = String(type);
            DOM.sink.removeListener(DOM.source.getWindow(), typeStr, baseViewportListener, captureOpts(typeStr));
        }
    }

    /** Ids currently holding any listener registration; for tests only. @internal */
    export function _registeredComponentIds(): readonly string[] {
        const ids = new Set<string>();

        for (const map of [listenerMap, subtreeListenerMap, viewportListenerMap]) {
            for (const typeMap of map.values()) {
                // The maps are declared with `String` (object) keys throughout this
                // module while every write passes a primitive, so normalise here.
                for (const id of typeMap.keys()) {
                    ids.add(String(id));
                }
            }
        }

        return Array.from(ids);
    }

    /**
     * Registers a viewport-level listener that fires for all matching events regardless of target element.
     *
     * @param component - The component to associate the listener with.
     * @param type - The DOM event type string to listen for globally.
     * @param listener - The callback invoked on every matching event. Its
     * return value tells the dispatcher what to do with the event: `true`
     * stops propagation, `{ prevent: true }` suppresses the default action,
     * `{ stop: true, prevent: true }` does both, and nothing (or `false`)
     * leaves the event untouched.
     *
     * @remarks Unlike `addListener`, viewport listeners are not filtered by element id — every
     * registered component receives the event, regardless of dispatch order, and a component
     * whose listener returns a stop disposition does not prevent the others from running. The
     * dispatcher does not stop propagation on a component's behalf: an unconsumed event keeps
     * propagating to the page (e.g. a consumer's `document`-level accelerator) unless a handler's
     * returned disposition asks for a stop. Logs a console trace and returns early if either
     * argument is falsy. Re-registering the same function reference does not add a second
     * listener — it is ignored; a fresh inline closure has no identity to match, so a site that
     * can run more than once must pass a stable reference.
     */
    export function addViewportListener(component: Component, type: string, listener: Listener) {
        if (!listener || !component) {
            console.trace();
            return;
        }

        let typeMap = viewportListenerMap.get(type);
        if (!typeMap) {
            typeMap = new Map<String, CompFunc>();
            viewportListenerMap.set(type, typeMap);

            DOM.sink.addListener(DOM.source.getWindow(), type, baseViewportListener, captureOpts(type));
        }

        let compFunc = typeMap.get(component.getId());
        if (!compFunc) {
            compFunc = {
                component: component,
                listeners: []
            }

            typeMap.set(component.getId(), compFunc);
        }

        if (compFunc.listeners.some((entry) => entry.listener === listener)) {
            return;
        }

        compFunc.listeners.push({ listener });
    }

    /**
     * Removes a previously registered viewport-level listener.
     *
     * @param component - The component whose viewport listener should be removed.
     * @param type - The DOM event type string the listener was registered for.
     * @param listener - The exact callback function reference that was passed to `addViewportListener`.
     *
     * @remarks Cleans up empty map entries and the window-level handler when no listeners remain
     * for a given event type, mirroring the behaviour of `removeListener`.
     */
    export function removeViewportListener(component: Component, type: string, listener: Listener) {
        if (!listener || !component) {
            return;
        }

        let typeMap = viewportListenerMap.get(type);
        if (!typeMap) {
            return;
        }

        let compFunc = typeMap.get(component.getId());
        if (!compFunc) {
            return;
        }

        let idx = compFunc.listeners.findIndex((entry) => entry.listener === listener);
        if (idx >= 0) {
            compFunc.listeners.splice(idx, 1);
        }

        if (compFunc.listeners.length == 0) {
            typeMap.delete(component.getId());
        }

        if (typeMap.size == 0) {
            viewportListenerMap.delete(type);
            DOM.sink.removeListener(DOM.source.getWindow(), type, baseViewportListener, captureOpts(type));
        }
    }

    /** Per-registration-surface listener counts returned by {@link listenerCounts}. */
    export interface ListenerCounts {
        exact:    number;
        subtree:  number;
        viewport: number;
        total:    number;
    }

    /**
     * Sums every registered listener's `listeners.length` across every type and
     * component in `map`. Shared by {@link listenerCounts} since `listenerMap`,
     * `subtreeListenerMap`, and `viewportListenerMap` share the same
     * `Map<type, Map<componentId, CompFunc>>` shape.
     */
    function sumListeners(map: Map<String, Map<String, CompFunc>>): number {
        let total = 0;

        for (const typeMap of map.values()) {
            for (const compFunc of typeMap.values()) {
                total += compFunc.listeners.length;
            }
        }

        return total;
    }

    /**
     * Reads the current DOM-routed listener counts, split by registration
     * surface.
     *
     * @returns The live {@link ListenerCounts}.
     */
    export function listenerCounts(): ListenerCounts {
        const exact    = sumListeners(listenerMap);
        const subtree  = sumListeners(subtreeListenerMap);
        const viewport = sumListeners(viewportListenerMap);

        return { exact, subtree, viewport, total: exact + subtree + viewport };
    }
}
