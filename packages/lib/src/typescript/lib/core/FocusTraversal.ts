// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { LayerManager } from "~/core/LayerManager.js";
import { findFocusable } from "~/core/Focusable.js";

/**
 * Options for {@link FocusTraversal.enable} / {@link FocusTraversal.configure}.
 *
 * @category Core
 */
export interface FocusTraversalOptions {
    /** Wrap from the last stop to the first at the ends of the root. Default: only inside a modal layer. */
    wrap?: boolean;
}

// The DOM attribute a Tab-key-owning component's element carries — mirrored by
// `Component.setTabKeyOwner` via `setDataAttribute("ts-ui-tab-key-owner", ...)`.
const TAB_KEY_OWNER_ATTR = "data-ts-ui-tab-key-owner";

// A bare modifier keydown must not expire the Escape release: pressing
// Shift+Tab fires two keydowns (Shift, then Tab with shiftKey: true), and the
// Shift keydown alone would otherwise reach the "any other key" branch first
// and clear the flag before the real Tab arrives.
const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta"]);

// Sentinel used to register the service's viewport listeners — see
// FocusHistory's identical `_owner` pattern. `FocusTraversal` has no DOM
// element of its own, so a stable, otherwise-unused `Component` owns them.
const _owner: Component = new Component();

let _enabled: boolean = false;
// `undefined` means "auto": wrap only inside a modal layer. An explicit
// `configure({ wrap })` pins the behaviour regardless of the resolved root.
let _wrapOption: boolean | undefined = undefined;
// One-shot Escape-release, armed for a specific owner — see the arbitration
// table in plans/framework-focus-traversal.md's `## Architecture Decisions`.
// Holding the owner (not just a boolean) lets `onFocusIn` tell "focus moved
// elsewhere" (clear it) from "focus moved to another element still inside the
// same owner" (keep it armed) — e.g. a `Table` cell editor's cancel path
// re-focusing the body is still inside `Table`, and must not disarm the
// release the user just requested.
let _releaseOwner: Handle | null = null;

/**
 * Returns the traversal root: the topmost layer's element when one is
 * registered, else `<body>`.
 */
function resolveRoot(): Handle {
    const top = LayerManager.getTopLayer();
    const layerElement = top?.getLayerElement() ?? null;

    return layerElement ?? DOM.source.getBody();
}

/** Whether `root` is a registered modal layer's own element. */
function isModalRoot(root: Handle): boolean {
    const top = LayerManager.getTopLayer();

    return top !== null && top.getDismissMode() === "modal" && top.getLayerElement() === root;
}

/** Resolves the effective wrap behaviour for `root` — the explicit option, else "modal only". */
function shouldWrap(root: Handle): boolean {
    return _wrapOption ?? isModalRoot(root);
}

/**
 * Walks from `handle` up to (and including) `<body>` looking for the first
 * ancestor carrying the Tab-key-owner marker. Bounded at `<body>` rather than
 * climbing to `<html>`/`document` — every framework component tree lives
 * under `<body>`, and the seam's `hasAttribute` assumes a real `Element`,
 * which the `document` node above `<html>` is not.
 *
 * @param handle - The element to start the walk from (typically the focused element).
 * @returns The nearest owning ancestor's handle, or `null` when none claims it.
 */
function findTabKeyOwner(handle: Handle): Handle | null {
    const body = DOM.source.getBody();

    for (let h: Handle | null = handle; h !== null; h = DOM.source.getParentNode(h)) {
        if (DOM.source.hasAttribute(h, TAB_KEY_OWNER_ATTR)) {
            return h;
        }

        if (h === body) {
            break;
        }
    }

    return null;
}

/**
 * The eligible tab stops inside `root`, in DOM order: `findFocusable`'s
 * candidates (the shared selector plus the `disabled` filter), further
 * filtered to those actually rendered.
 */
function collectTabStops(root: Handle): Handle[] {
    return findFocusable(root).filter(handle => DOM.source.isRenderedVisible(handle));
}

/**
 * The next/previous stop from `active` within `stops`, wrapping only when
 * `shouldWrap(root)` allows it. `active === null` (nothing focused, or the
 * active element is not itself a stop) lands on the first stop moving
 * forward, the last moving backward — the same "nothing to continue from"
 * landing a fresh `Tab` press gets in a real browser.
 */
function stepFrom(root: Handle, stops: Handle[], active: Handle | null, direction: 1 | -1): Handle | null {
    if (stops.length === 0) {
        return null;
    }

    const index = active === null ? -1 : stops.indexOf(active);

    if (index === -1) {
        return direction === 1 ? stops[0] : stops[stops.length - 1];
    }

    let target = index + direction;

    if (target < 0 || target >= stops.length) {
        if (!shouldWrap(root)) {
            return null;
        }

        target = (target + stops.length) % stops.length;
    }

    return stops[target];
}

/**
 * The first stop, in `root`'s DOM order, that lies outside `owner`'s subtree
 * and follows every stop `owner` contains — the Escape-release target for
 * `Tab`. `owner`'s own element carries no position of its own to compare
 * against a sibling (the seam has no document-position primitive), so an
 * owner with no focusable descendant of its own degrades to the same "nothing
 * to continue from" landing {@link stepFrom} uses: the first stop of `root`.
 */
function stopAfterOwner(root: Handle, owner: Handle): Handle | null {
    const stops = collectTabStops(root);
    let lastInside = -1;

    for (let i = 0; i < stops.length; i++) {
        if (DOM.source.contains(owner, stops[i])) {
            lastInside = i;
        }
    }

    for (let i = lastInside + 1; i < stops.length; i++) {
        if (!DOM.source.contains(owner, stops[i])) {
            return stops[i];
        }
    }

    return null;
}

/** {@link stopAfterOwner}'s mirror for `Shift+Tab` — the last stop before every stop `owner` contains. */
function stopBeforeOwner(root: Handle, owner: Handle): Handle | null {
    const stops = collectTabStops(root);
    let firstInside = -1;

    for (let i = 0; i < stops.length; i++) {
        if (DOM.source.contains(owner, stops[i])) {
            firstInside = i;
            break;
        }
    }

    const upperBound = firstInside === -1 ? stops.length : firstInside;

    for (let i = upperBound - 1; i >= 0; i--) {
        if (!DOM.source.contains(owner, stops[i])) {
            return stops[i];
        }
    }

    return null;
}

/** Moves focus to `target` (when non-null) with `preventScroll: true`; reports whether it moved. */
function focusStop(target: Handle | null): boolean {
    if (target === null) {
        return false;
    }

    DOM.sink.focus(target, { preventScroll: true });

    return true;
}

/**
 * Document `focusin` handler: expires a pending Escape release only once
 * focus actually moves *outside* the owner that armed it — a focus move that
 * stays inside the same owner (a `Table` cell editor cancelling back to the
 * body, say) leaves the release armed for the `Tab` still to come.
 */
function onFocusIn(_e: FocusEvent): void {
    if (!_enabled || _releaseOwner === null) {
        return;
    }

    const active = DOM.source.getActiveElement();

    if (active !== null && DOM.source.contains(_releaseOwner, active)) {
        return;
    }

    _releaseOwner = null;
}

/**
 * Document `keydown` handler: implements the arbitration table in
 * plans/framework-focus-traversal.md's `## Architecture Decisions` — Escape
 * arms a one-shot release, a plain `Tab`/`Shift+Tab` stands down while focus
 * is inside a Tab-key owner (unless the release is armed, in which case it is
 * consumed to step past the owner), and any other key expires an armed
 * release without moving focus.
 *
 * @returns `{ stop: true, prevent: true }` only when the service actually
 *   moved focus, so an unclaimed boundary Tab (a `<body>` root already at its
 *   last stop) still reaches the browser's own chrome navigation.
 */
function onKeyDown(e: KeyboardEvent): Event.ListenerResult {
    if (!_enabled) {
        return;
    }

    if (e.key !== "Tab") {
        if (e.key === "Escape") {
            const active = DOM.source.getActiveElement();
            const owner  = active === null ? null : findTabKeyOwner(active);

            if (owner !== null) {
                _releaseOwner = owner;
            }
        } else if (!MODIFIER_KEYS.has(e.key)) {
            _releaseOwner = null;
        }

        return;
    }

    const active = DOM.source.getActiveElement();
    const owner  = active === null ? null : findTabKeyOwner(active);
    const armed  = owner !== null && owner === _releaseOwner;

    if (owner !== null && !armed) {
        return; // the owner keeps Tab.
    }

    const root = resolveRoot();
    let moved: boolean;

    if (owner !== null) {
        // `armed` is true here — the branch above returned otherwise.
        _releaseOwner = null;
        moved = focusStop(e.shiftKey ? stopBeforeOwner(root, owner) : stopAfterOwner(root, owner));
    } else {
        moved = focusStop(stepFrom(root, collectTabStops(root), active, e.shiftKey ? -1 : 1));
    }

    if (!moved) {
        return;
    }

    return { stop: true, prevent: true };
}

/**
 * Framework-level keyboard Tab traversal: intercepts `Tab` / `Shift+Tab`,
 * computes the ordered set of tab stops inside the topmost layer (or
 * `<body>`), skips ineligible ones, and moves focus — the same job the
 * browser's native traversal already does, opt-in for the cases it cannot
 * (see the plan's `## When To Pick This Up`). Stands down for a component
 * marked via {@link Component.setTabKeyOwner} while focus is inside it, so a
 * third-party editor or `Table`'s own cell-to-cell Tab handling keeps working
 * unmodified; `Escape` then `Tab`/`Shift+Tab` steps past it. Opt-in, matching
 * {@link FocusHistory}'s stance — call {@link enable} to start.
 *
 * @category Core
 */
export namespace FocusTraversal {
    /**
     * Installs the `keydown` + `focusin` listeners and begins intercepting
     * `Tab` / `Shift+Tab`. Idempotent — calling it again while already
     * enabled only applies `options`.
     *
     * @param options - Optional `wrap` override, applied via {@link configure} before enabling.
     */
    export function enable(options?: FocusTraversalOptions): void {
        if (options) {
            configure(options);
        }

        if (_enabled) {
            return;
        }

        _enabled = true;
        _releaseOwner = null;

        Event.addViewportListener(_owner, "keydown", onKeyDown);
        Event.addViewportListener(_owner, "focusin", onFocusIn);
    }

    /**
     * Removes the listeners and stops intercepting. Idempotent.
     */
    export function disable(): void {
        if (!_enabled) {
            return;
        }

        _enabled = false;
        _releaseOwner = null;

        Event.removeViewportListener(_owner, "keydown", onKeyDown);
        Event.removeViewportListener(_owner, "focusin", onFocusIn);
    }

    /** Whether the service is currently intercepting. */
    export function isEnabled(): boolean {
        return _enabled;
    }

    /**
     * Updates `wrap` without toggling enablement. Only the supplied field changes.
     *
     * @param options - The fields to update.
     */
    export function configure(options: FocusTraversalOptions): void {
        if (options.wrap !== undefined) {
            _wrapOption = options.wrap;
        }
    }

    /**
     * The ordered, eligible tab stops inside `root` (defaults to the current
     * traversal root).
     *
     * @param root - The subtree to search; defaults to the topmost layer's
     *   element, or `<body>` when no layer is registered.
     */
    export function getTabStops(root?: Handle): Handle[] {
        return collectTabStops(root ?? resolveRoot());
    }

    /**
     * Moves focus to the next tab stop after the currently active element.
     *
     * @returns `true` if focus moved.
     */
    export function next(): boolean {
        const root = resolveRoot();

        return focusStop(stepFrom(root, collectTabStops(root), DOM.source.getActiveElement(), 1));
    }

    /**
     * Moves focus to the tab stop before the currently active element.
     *
     * @returns `true` if focus moved.
     */
    export function previous(): boolean {
        const root = resolveRoot();

        return focusStop(stepFrom(root, collectTabStops(root), DOM.source.getActiveElement(), -1));
    }
}
