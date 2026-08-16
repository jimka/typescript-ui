// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { consumeWheel } from "~/core/SmoothScroller.js";

/**
 * Components that currently have the wheel trap installed. Used purely for
 * idempotency — the listener itself ({@link swallowUnconsumedWheel}) captures
 * nothing per component, so one shared reference serves every overlay. Keyed
 * weakly, mirroring how the layer registry keys per-layer state, so a closed
 * overlay's entry is collectable without an explicit purge.
 */
const _trapped = new WeakSet<Component>();

/**
 * Subtree `wheel` handler shared by every trapped overlay: claims the event via
 * the framework's wheel once-marker and, when the claim succeeds (no inner
 * scroller took it first), `preventDefault()`s it so the native wheel never
 * reaches a scrollable ancestor behind the overlay.
 *
 * @param e - The wheel event reaching the overlay as the outermost ancestor.
 */
function swallowUnconsumedWheel(e: WheelEvent): Event.ListenerResult {
    if (consumeWheel(e)) {
        return { prevent: true };
    }
}

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
    if (_trapped.has(component)) {
        return;
    }

    _trapped.add(component);
    Event.addSubtreeListener(component, "wheel", { passive: false, handler: swallowUnconsumedWheel });
}

/**
 * Removes the trap installed by {@link trapWheel}. Safe to call when none was
 * installed.
 *
 * @param component - The overlay whose trap should be removed.
 */
export function untrapWheel(component: Component): void {
    if (!_trapped.has(component)) {
        return;
    }

    _trapped.delete(component);
    Event.removeSubtreeListener(component, "wheel", swallowUnconsumedWheel);
}
