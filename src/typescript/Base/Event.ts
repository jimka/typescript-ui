import { Component } from "./Component.js";

export namespace Event {
    interface CompFunc {
        component: Component,
        listeners: Function[]
    };

    let listenerMap = new Map<String, Map<String, CompFunc>>();
    let viewportListenerMap = new Map<String, Map<String, CompFunc>>();

    let baseListener = function (evnt: Event) {
        let listeners = listenerMap.get(evnt.type);
        if (!listeners) {
            return;
        }

        let elementId = (evnt.target as HTMLElement).id;
        let compFunc = listeners.get(elementId);

        if (!compFunc) {
            return;
        }

        let component = compFunc.component;
        let componentListeners = compFunc.listeners;

        evnt.stopPropagation();

        for (let listener of componentListeners) {
            listener.apply(component, [evnt]);
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

    export function init() {

    }

    export function fireEvent(component: Component, type: string, payload?: any) {
        let element = component.getElement();
        if (!element) {
            throw new Error("Cannot fire event '" + type + "'. Component '" + component.getId() + "' is not in the DOM.");
        }

        var event = new CustomEvent(type, payload);
        element.dispatchEvent(event);
    }

    export function addListener(component: Component, type: string, listener: Function) {
        if (!listener || !component) {
            return;
        }

        let typeMap = listenerMap.get(type);
        if (!typeMap) {
            typeMap = new Map<String, CompFunc>();
            listenerMap.set(type, typeMap);

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
            window.removeEventListener(type, baseListener, true);
        }
    }

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