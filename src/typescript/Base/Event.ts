// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component.js";

/**
 * Event routing system that manages DOM event listeners on behalf of components.
 * Uses a single window-level capture handler per event type to avoid per-element listeners.
 */
export namespace Event {
    interface CompFunc {
        component: Component,
        listeners: Function[]
    };

    let listenerMap = new Map<String, Map<String, CompFunc>>();
    let viewportListenerMap = new Map<String, Map<String, CompFunc>>();
    let subtreeListenerMap = new Map<String, Map<String, CompFunc>>();
    let installedListenerTypes = new Set<string>();

    let baseListener = function (evnt: Event) {
        let listeners = listenerMap.get(evnt.type);
        if (listeners) {
            let elementId = (evnt.target as HTMLElement).id;
            let compFunc = listeners.get(elementId);

            if (compFunc) {
                evnt.stopPropagation();

                for (let listener of compFunc.listeners) {
                    listener.apply(compFunc.component, [evnt]);
                }
            }
        }

        let subtreeListeners = subtreeListenerMap.get(evnt.type);
        if (!subtreeListeners) {
            return;
        }

        let element: HTMLElement | null = evnt.target as HTMLElement;
        while (element) {
            if (element.id) {
                let compFunc = subtreeListeners.get(element.id);
                if (compFunc) {
                    for (let listener of compFunc.listeners) {
                        listener.apply(compFunc.component, [evnt]);
                    }
                }
            }

            element = element.parentElement;
        }
    };

    let baseViewportListener = function (evnt: Event) {
        let typeListeners = viewportListenerMap.get(evnt.type);
        if (!typeListeners) {
            return;
        }

        evnt.stopPropagation();

        for (let listeners of typeListeners) {
            let compFunc = listeners[1];
            if (!compFunc) {
                continue;
            }

            let component = compFunc.component;

            for (let listener of compFunc.listeners) {
                listener.apply(component, [evnt]);
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
            element.dispatchEvent(new CustomEvent(typeOrEvent, payload));
        } else {
            element.dispatchEvent(typeOrEvent);
        }
    }

    /**
     * Registers a listener for a DOM event type on the given component, using a single window-level handler per type.
     *
     * @param component - The component to associate the listener with.
     * @param type - The DOM event type string to listen for.
     * @param listener - The callback function to invoke when the event fires on this component.
     *
     * @remarks A capture-phase window listener is installed the first time a given event type is registered,
     * and removed automatically when the last listener for that type is unregistered.
     */
    export function addListener(component: Component, type: string, listener: Function) {
        if (!listener || !component) {
            return;
        }

        let typeMap = listenerMap.get(type);
        if (!typeMap) {
            typeMap = new Map<String, CompFunc>();
            listenerMap.set(type, typeMap);
        }

        if (!installedListenerTypes.has(type)) {
            installedListenerTypes.add(type);
            window.addEventListener(type, baseListener, true);
        }

        let compFunc = typeMap.get(component.getId());
        if (!compFunc) {
            compFunc = {
                component: component,
                listeners: []
            }

            typeMap.set(component.getId(), compFunc);
        }

        compFunc.listeners.push(listener);
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
    export function removeListener(component: Component, type: string, listener: Function) {
        if (!listener || !component) {
            return;
        }

        let typeMap = listenerMap.get(type);
        if (!typeMap) {
            return;
        }

        let compFunc = typeMap.get(component.getId());
        if (!compFunc) {
            return;
        }

        let idx = compFunc.listeners.indexOf(listener);
        compFunc.listeners.splice(idx, 1);

        if (compFunc.listeners.length == 0) {
            typeMap.delete(component.getId());
        }

        if (typeMap.size == 0) {
            listenerMap.delete(type);
        }

        const subtreeMap = subtreeListenerMap.get(type);
        const bothEmpty = !listenerMap.has(type) && (!subtreeMap || subtreeMap.size === 0);
        if (bothEmpty && installedListenerTypes.has(type)) {
            installedListenerTypes.delete(type);
            window.removeEventListener(type, baseListener, true);
        }
    }

    /**
     * Registers a listener that fires whenever the given event type targets this component
     * or any of its DOM descendants.
     *
     * @param component - The ancestor component to watch.
     * @param type - The DOM event type string to listen for.
     * @param listener - The callback invoked when a matching event bubbles through this component's subtree.
     *
     * @remarks Unlike `addListener`, which only matches the exact event target, this fires for
     * any event whose target is a descendant of the component's element. Multiple components
     * may register subtree listeners for the same event type; all matching ancestors are notified.
     */
    export function addSubtreeListener(component: Component, type: string, listener: Function): void {
        if (!listener || !component) {
            return;
        }

        let typeMap = subtreeListenerMap.get(type);
        if (!typeMap) {
            typeMap = new Map<String, CompFunc>();
            subtreeListenerMap.set(type, typeMap);
        }

        if (!installedListenerTypes.has(type)) {
            installedListenerTypes.add(type);
            window.addEventListener(type, baseListener, true);
        }

        let compFunc = typeMap.get(component.getId());
        if (!compFunc) {
            compFunc = { component, listeners: [] };
            typeMap.set(component.getId(), compFunc);
        }

        compFunc.listeners.push(listener);
    }

    /**
     * Removes a previously registered subtree event listener.
     *
     * @param component - The component whose subtree listener should be removed.
     * @param type - The DOM event type string the listener was registered for.
     * @param listener - The exact callback function reference that was passed to `addSubtreeListener`.
     */
    export function removeSubtreeListener(component: Component, type: string, listener: Function): void {
        if (!listener || !component) {
            return;
        }

        let typeMap = subtreeListenerMap.get(type);
        if (!typeMap) {
            return;
        }

        let compFunc = typeMap.get(component.getId());
        if (!compFunc) {
            return;
        }

        let idx = compFunc.listeners.indexOf(listener);
        if (idx >= 0) {
            compFunc.listeners.splice(idx, 1);
        }

        if (compFunc.listeners.length === 0) {
            typeMap.delete(component.getId());
        }

        if (typeMap.size === 0) {
            subtreeListenerMap.delete(type);
        }

        const exactMap = listenerMap.get(type);
        const bothEmpty = (!exactMap || exactMap.size === 0) && !subtreeListenerMap.has(type);
        if (bothEmpty && installedListenerTypes.has(type)) {
            installedListenerTypes.delete(type);
            window.removeEventListener(type, baseListener, true);
        }
    }

    /**
     * Registers a viewport-level listener that fires for all matching events regardless of target element.
     *
     * @param component - The component to associate the listener with.
     * @param type - The DOM event type string to listen for globally.
     * @param listener - The callback function to invoke on every matching event.
     *
     * @remarks Unlike `addListener`, viewport listeners are not filtered by element id — every
     * registered component receives the event. Logs a console trace and returns early if
     * either argument is falsy.
     */
    export function addViewportListener(component: Component, type: string, listener: Function) {
        if (!listener || !component) {
            console.trace();
            return;
        }

        let typeMap = viewportListenerMap.get(type);
        if (!typeMap) {
            typeMap = new Map<String, CompFunc>();
            viewportListenerMap.set(type, typeMap);

            window.addEventListener(type, baseViewportListener, true);
        }

        let compFunc = typeMap.get(component.getId());
        if (!compFunc) {
            compFunc = {
                component: component,
                listeners: []
            }

            typeMap.set(component.getId(), compFunc);
        }

        compFunc.listeners.push(listener);
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
    export function removeViewportListener(component: Component, type: string, listener: Function) {
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

        let idx = compFunc.listeners.indexOf(listener);
        compFunc.listeners.splice(idx, 1);

        if (compFunc.listeners.length == 0) {
            typeMap.delete(component.getId());
        }

        if (typeMap.size == 0) {
            viewportListenerMap.delete(type);
            window.removeEventListener(type, baseViewportListener, true);
        }
    }

    /**
     * Registers a window resize listener that receives a `{width, height}` size object.
     *
     * @param listener - The callback function invoked on every window resize event,
     * called with `{ width: number, height: number }` as its argument.
     */
    export function addViewportResizeListener(this: any, listener: Function) {
        var me = this;

        window.addEventListener('resize', function () {
            let size = {
                width: window.innerWidth,
                height: window.innerHeight
            };

            listener.apply(me, [size]);
        }, true);
    }
}
