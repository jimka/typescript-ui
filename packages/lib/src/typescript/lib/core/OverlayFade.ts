// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Animation } from "~/core/Animation.js";

/** Default fade duration in milliseconds. Matches `MENU_ANIM_DURATION_MS` from `Menu`. */
export const DEFAULT_DURATION_MS: number = 120;

/** Default entrance vertical-offset distance in pixels. */
export const DEFAULT_TRANSLATE_PX: number = 4;

/**
 * Per-component `_dismissing` flag used by the free-function form
 * (`fadeShow` / `fadeHideAndDetach`). `WeakMap`-keyed so a `Component` that
 * never opts into the helper carries no extra state.
 */
const _dismissingByComponent: WeakMap<Component, boolean> = new WeakMap();

/** Handle for the fade paths that finish before there is anything to cancel. */
const NOOP_HANDLE: Animation.CancelHandle = { cancel: (): void => {} };

/**
 * Options forwarded to the free-function forms `fadeShow` / `fadeHideAndDetach`.
 *
 * @category Core
 */
export interface FadeOptions {
    /** Fade duration in milliseconds. Default: 120. */
    durationMs?:  number;
    /** Vertical translation distance in pixels for the entrance. Default: 4. */
    translatePx?: number;
    /** When false, the helper bypasses the transition and applies the end state synchronously. Default: true. */
    animated?:    boolean;
    /** Called once the fade completes (or immediately when animation is disabled). */
    onComplete?:  () => void;
}

/**
 * Plays the standard dropdown-style entrance fade on the given component's
 * element. Shared by any overlay surface that fades in on show — `Menu` and
 * `Popover` use it directly; {@link AnimatedDropdown} (core/AnimatedDropdown.ts)
 * wraps the same transition as its `showAnimated` method for subclasses that
 * extend it rather than composing this free-function form.
 *
 * Cancels any in-flight fade-out queued by {@link fadeHideAndDetach} so a
 * fresh show mid-dismiss keeps the panel on screen.
 *
 * @param component - The component to fade in.
 * @param options - Optional duration / translate / animated overrides.
 * @returns A handle the caller stores and cancels on its own teardown.
 */
export function fadeShow(component: Component, options?: FadeOptions): Animation.CancelHandle {
    const durationMs  = options?.durationMs  ?? DEFAULT_DURATION_MS;
    const translatePx = options?.translatePx ?? DEFAULT_TRANSLATE_PX;
    const animated    = options?.animated    ?? true;

    _dismissingByComponent.set(component, false);

    const el = component.getElement();

    if (!el) {
        options?.onComplete?.();
        return NOOP_HANDLE;
    }

    if (!animated) {
        options?.onComplete?.();
        return NOOP_HANDLE;
    }

    component.setWillChange("opacity, transform");

    return Animation.play(el, {
        from:       { opacity: "0", transform: `translateY(-${translatePx}px)` },
        to:         { opacity: "1", transform: "translateY(0)" },
        durationMs: durationMs,
        properties: ["opacity", "transform"],
        onComplete: () => {
            component.setWillChange(null);
            options?.onComplete?.();
        },
    });
}

/**
 * Plays the standard dropdown-style exit fade on the given component's
 * element, then hides and detaches it from the DOM when the transition
 * completes.
 *
 * A fresh {@link fadeShow} during the fade cancels the deferred detach so the
 * panel stays mounted.
 *
 * @param component - The component to fade out and detach.
 * @param options - Optional duration / translate / animated overrides; `onComplete` fires after detach.
 * @returns A handle the caller stores and cancels on its own teardown.
 */
export function fadeHideAndDetach(component: Component, options?: FadeOptions): Animation.CancelHandle {
    const durationMs  = options?.durationMs  ?? DEFAULT_DURATION_MS;
    const translatePx = options?.translatePx ?? DEFAULT_TRANSLATE_PX;
    const animated    = options?.animated    ?? true;

    const el = component.getElement();
    const finalize = (): void => {
        component.setVisible(false);
        component.removeElement();
        options?.onComplete?.();
    };

    if (!el || !animated) {
        finalize();
        return NOOP_HANDLE;
    }

    _dismissingByComponent.set(component, true);
    component.setWillChange("opacity, transform");

    return Animation.play(el, {
        to:         { opacity: "0", transform: `translateY(-${translatePx}px)` },
        durationMs: durationMs,
        properties: ["opacity", "transform"],
        onComplete: () => {
            if (!_dismissingByComponent.get(component)) {
                component.setWillChange(null);
                return;
            }
            _dismissingByComponent.set(component, false);
            component.setWillChange(null);
            finalize();
        },
    });
}
