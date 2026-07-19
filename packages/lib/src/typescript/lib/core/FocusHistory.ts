// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { LayerManager } from "~/core/LayerManager.js";
import { ListenerBag } from "~/core/ListenerBag.js";

/**
 * A physical-key chord. `code` is a `KeyboardEvent.code` value (layout-independent).
 *
 * @category Core
 */
export interface FocusHistoryKeyCombo {
    code:   string;
    ctrl?:  boolean;
    alt?:   boolean;
    shift?: boolean;
    meta?:  boolean;
}

/**
 * Options for {@link FocusHistory.enable} / {@link FocusHistory.configure}.
 *
 * @category Core
 */
export interface FocusHistoryOptions {
    /** Max entries retained; oldest dropped past this. Default 50. */
    maxSize?: number;
    /** Back accelerator. Default `Alt+[` (`{ code: "BracketLeft", alt: true }`). */
    back?:    FocusHistoryKeyCombo;
    /** Forward accelerator. Default `Alt+]` (`{ code: "BracketRight", alt: true }`). */
    forward?: FocusHistoryKeyCombo;
}

/**
 * The sole custom event name fired by {@link FocusHistory}.
 *
 * @category Core
 */
export type FocusHistoryEvent = "change";

/**
 * Payload of the `"change"` event: the navigability of the trail after the change.
 *
 * @category Core
 */
export interface FocusHistoryChange {
    canGoBack:    boolean;
    canGoForward: boolean;
}

// 50: a working session's focus trail rarely exceeds a few dozen stops; caps
// memory at 50 handle numbers while leaving generous back-depth.
const DEFAULT_MAX_ENTRIES: number = 50;
// Alt+[ / Alt+]: editor-style "navigate back/forward"; no default browser
// action (unlike Alt+Left/Right = browser history); layout-independent via code.
const DEFAULT_BACK_COMBO:    FocusHistoryKeyCombo = { code: "BracketLeft",  alt: true };
const DEFAULT_FORWARD_COMBO: FocusHistoryKeyCombo = { code: "BracketRight", alt: true };

// Sentinel used to register the service's viewport listeners — see
// LayerManager's identical `_listenerOwner` pattern. `FocusHistory` has no DOM
// element of its own, so a stable, otherwise-unused `Component` owns them.
const _owner: Component = new Component();
const _listeners = new ListenerBag<FocusHistoryEvent>();

// Chronological trail, oldest first. Entries are bare `Handle`s (not
// `Component`s) because focus frequently lands on an element with no 1:1
// component (an input inside a Text, a raw button).
let _entries: Handle[] = [];
// Current position in `_entries`; -1 when the trail is empty.
let _index: number = -1;
let _enabled: boolean = false;
// Re-entrancy guard: true for the duration of a service-driven `DOM.sink.focus`
// call, so the synchronous `focusin` it triggers is not recorded as a new move.
let _navigating: boolean = false;
let _maxSize: number = DEFAULT_MAX_ENTRIES;
let _back:    FocusHistoryKeyCombo = DEFAULT_BACK_COMBO;
let _forward: FocusHistoryKeyCombo = DEFAULT_FORWARD_COMBO;

/**
 * Whether `handle` still resolves to a connected element. A GC-collected weak
 * handle throws on resolve inside the DOM seam; that is treated as stale too.
 */
function isLive(handle: Handle): boolean {
    try {
        return DOM.source.isConnected(handle);
    } catch {
        return false;
    }
}

/**
 * Drops every stale (no-longer-connected) entry from the trail, keeping
 * `_index` pointed at the nearest surviving entry at or before its old
 * position (or -1 if nothing survived there). Run before every navigation
 * and every `canGo*` query so those never act on a dead entry.
 */
function pruneStale(): void {
    const kept: Handle[] = [];
    let newIndex = -1;

    for (let i = 0; i < _entries.length; i++) {
        const handle = _entries[i];

        if (isLive(handle)) {
            kept.push(handle);

            if (i <= _index) {
                newIndex = kept.length - 1;
            }
        }
    }

    _entries = kept;
    _index = newIndex;
}

/** Computes the current navigability and notifies `"change"` listeners. */
function fireChange(): void {
    const change: FocusHistoryChange = {
        canGoBack:    _index > 0,
        canGoForward: _index < _entries.length - 1,
    };

    _listeners.fire("change", change);
}

/**
 * Appends `handle` to the trail (deduping a repeat of the current entry and
 * truncating any forward branch), advances `_index`, and fires `"change"`.
 */
function record(handle: Handle): void {
    if (_index >= 0 && _entries[_index] === handle) {
        return;
    }

    _entries.length = _index + 1;
    _entries.push(handle);

    while (_entries.length > _maxSize) {
        _entries.shift();
    }

    _index = _entries.length - 1;
    fireChange();
}

/** Re-focuses `handle` under the re-entrancy guard, then fires `"change"`. */
function focusEntry(handle: Handle): void {
    _navigating = true;
    DOM.sink.focus(handle);
    _navigating = false;
    fireChange();
}

/**
 * Prunes stale entries, then moves `_index` by `direction` and re-focuses the
 * entry there, if one exists.
 *
 * @returns True if focus moved.
 */
function navigate(direction: -1 | 1): boolean {
    pruneStale();

    const target = _index + direction;

    if (target < 0 || target >= _entries.length) {
        return false;
    }

    _index = target;
    focusEntry(_entries[_index]);

    return true;
}

/** Whether a `KeyboardEvent` matches a configured combo. */
function matchesCombo(e: KeyboardEvent, combo: FocusHistoryKeyCombo): boolean {
    return e.code === combo.code &&
        e.altKey === !!combo.alt && e.ctrlKey === !!combo.ctrl &&
        e.shiftKey === !!combo.shift && e.metaKey === !!combo.meta;
}

/** Document `focusin` handler: records the newly-focused element. */
function onFocusIn(e: FocusEvent): void {
    if (!_enabled || _navigating) {
        return;
    }

    if (!DOM.source.isElement(e.target)) {
        return;
    }

    record(DOM.source.intern(e.target));
}

/**
 * Document `keydown` handler: drives `back()`/`forward()` on the configured
 * combos, suppressed while a modal layer is on top so the accelerator does
 * not fight the modal's own focus trap.
 */
function onKeyDown(e: KeyboardEvent): void {
    if (!_enabled) {
        return;
    }

    const direction: -1 | 1 | 0 = matchesCombo(e, _back) ? -1 : matchesCombo(e, _forward) ? 1 : 0;

    if (direction === 0) {
        return;
    }

    const top = LayerManager.getTopLayer();

    if (top && top.getDismissMode() === "modal") {
        return;
    }

    e.preventDefault();
    navigate(direction);
}

/**
 * Global focus-trail navigation service: records the chronological order in
 * which elements receive keyboard focus across the document and drives an
 * accelerator that walks the trail backward and forward, like browser
 * back/forward but for keyboard focus. Opt-in — call {@link enable} to start
 * recording; nothing auto-starts it.
 *
 * @category Core
 */
export namespace FocusHistory {
    /**
     * Installs the `focusin` + `keydown` listeners, seeds the trail with the
     * current active element (if any), and begins recording. Idempotent —
     * calling it again while already enabled only applies `options`.
     *
     * @param options - Optional `maxSize` / combo overrides, applied via
     * {@link configure} before enabling.
     */
    export function enable(options?: FocusHistoryOptions): void {
        if (options) {
            configure(options);
        }

        if (_enabled) {
            return;
        }

        _enabled = true;

        Event.addViewportListener(_owner, "focusin", onFocusIn);
        Event.addViewportListener(_owner, "keydown", onKeyDown);

        const active = DOM.source.getActiveElement();

        if (active !== null) {
            record(active);
        }
    }

    /**
     * Removes the listeners and stops recording. Preserves the trail —
     * re-enabling resumes from where it left off. Idempotent.
     */
    export function disable(): void {
        if (!_enabled) {
            return;
        }

        _enabled = false;
        _navigating = false;

        Event.removeViewportListener(_owner, "focusin", onFocusIn);
        Event.removeViewportListener(_owner, "keydown", onKeyDown);
    }

    /** Whether the service is currently observing. */
    export function isEnabled(): boolean {
        return _enabled;
    }

    /**
     * Updates `maxSize` / combos without toggling enablement. Only the
     * supplied fields change.
     *
     * @param options - The fields to update.
     */
    export function configure(options: FocusHistoryOptions): void {
        if (options.maxSize !== undefined) {
            _maxSize = options.maxSize;
        }

        if (options.back !== undefined) {
            _back = options.back;
        }

        if (options.forward !== undefined) {
            _forward = options.forward;
        }
    }

    /**
     * Re-focuses the previous live entry, skipping and dropping any stale
     * ones encountered along the way.
     *
     * @returns True if focus moved.
     */
    export function back(): boolean {
        return navigate(-1);
    }

    /**
     * Re-focuses the next live entry, skipping and dropping any stale ones
     * encountered along the way.
     *
     * @returns True if focus moved.
     */
    export function forward(): boolean {
        return navigate(1);
    }

    /**
     * Whether a live entry exists before the current position. Prunes stale
     * entries as a side effect, so a stale-only direction never reports true.
     */
    export function canGoBack(): boolean {
        pruneStale();

        return _index > 0;
    }

    /**
     * Whether a live entry exists after the current position. Prunes stale
     * entries as a side effect, so a stale-only direction never reports true.
     */
    export function canGoForward(): boolean {
        pruneStale();

        return _index < _entries.length - 1;
    }

    /** Empties the trail and fires `"change"` with both flags false. */
    export function clear(): void {
        _entries = [];
        _index = -1;
        fireChange();
    }

    /**
     * Subscribes to trail-navigability changes, fired after every recorded
     * focus move and after every `back()` / `forward()` navigation.
     *
     * @param event - Always `"change"`.
     * @param listener - Invoked with the trail's navigability after the change.
     */
    export function on(event: "change", listener: (change: FocusHistoryChange) => void): void {
        _listeners.add(event, listener);
    }

    /**
     * Unsubscribes a `"change"` listener.
     *
     * @param event - Always `"change"`.
     * @param listener - The exact callback reference passed to {@link on}.
     */
    export function off(event: "change", listener: (change: FocusHistoryChange) => void): void {
        _listeners.remove(event, listener);
    }
}
