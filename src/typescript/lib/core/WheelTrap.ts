// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { consumeWheel } from "~/core/SmoothScroller.js";

/**
 * Per-component bound handler, kept so {@link untrapWheel} can remove the exact
 * reference {@link trapWheel} registered. Keyed weakly by the component, mirroring
 * how the layer registry keys per-layer state, so a closed overlay's entry is
 * collectable without an explicit purge.
 */
const _handlerByComponent = new WeakMap<Component, (e: WheelEvent) => void>();

/**
 * Registers a non-passive subtree `wheel` listener on `component` that
 * `preventDefault()`s any wheel the event reaches it unconsumed — trapping
 * wheels an inner scroller did not claim so they cannot fall through to content
 * behind a floating overlay. Idempotent per component.
 *
 * @param component - The overlay to install the trap on. Must already be mounted,
 * since the subtree listener resolves the component's element.
 *
 * @remarks Subtree events dispatch descendant-first, so any inner scroll
 * container under the pointer claims the wheel first and the overlay's handler,
 * firing last as the outermost ancestor, sees it already consumed and does
 * nothing — inner scroll proceeds untouched. The listener is `{ passive: false }`
 * to match the only other `wheel` registration (the inner scroll pipeline) and
 * because `preventDefault()` is a no-op on a passive listener.
 */
export function trapWheel(component: Component): void {
    if (_handlerByComponent.has(component)) {
        return;
    }

    const handler = (e: WheelEvent): void => {
        if (consumeWheel(e)) {
            e.preventDefault();
        }
    };

    _handlerByComponent.set(component, handler);
    Event.addSubtreeListener(component, "wheel", handler, { passive: false });
}

/**
 * Removes the trap installed by {@link trapWheel}. Safe to call when none was
 * installed.
 *
 * @param component - The overlay whose trap should be removed.
 */
export function untrapWheel(component: Component): void {
    const handler = _handlerByComponent.get(component);
    if (!handler) {
        return;
    }

    _handlerByComponent.delete(component);
    Event.removeSubtreeListener(component, "wheel", handler);
}
