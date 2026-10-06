// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { LayerManager } from "~/core/LayerManager.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { FocusReveal } from "~/core/FocusReveal.js";
import { isLiveHandle } from "~/core/Focusable.js";

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
 * Drops every stale (no-longer-connected) entry from the trail, and merges a
 * stop that the drop leaves repeated next to itself — two visits to one
 * control with a since-removed stop between them — into one entry. Keeps
 * `_index` pointed at the nearest surviving entry at or before its old
 * position (or -1 if nothing survived there). Run before every navigation
 * and every `canGo*` query so those never act on a dead entry.
 */
function pruneStale(): void {
    const kept: Handle[] = [];
    let newIndex = -1;

    for (let i = 0; i < _entries.length; i++) {
        const handle = _entries[i];
        const live   = isLiveHandle(handle);

        if (!live) {
            continue;
        }

        if (kept[kept.length - 1] !== handle) {
            kept.push(handle);
        }

        if (i <= _index) {
            newIndex = kept.length - 1;
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

/**
 * Reveals `handle`'s ancestry (selecting hiding tabs, expanding collapsed
 * regions, scrolling it into view) then focuses it, the whole operation
 * guarded so any focus side effect the reveal triggers is not recorded as a
 * new trail entry.
 *
 * @param handle - The stop to reveal and focus.
 * @returns True only when focus actually landed on `handle` — a still-hidden
 *   element silently refuses focus, which is the operational "unrevealable" signal.
 */
function revealAndFocus(handle: Handle): boolean {
    _navigating = true;

    try {
        if (!FocusReveal.reveal(handle)) {
            return false;
        }

        DOM.sink.focus(handle, { preventScroll: true });

        return DOM.source.getActiveElement() === handle;
    } finally {
        _navigating = false;
    }
}

/**
 * Prunes stale entries, then walks `_index` by `direction`, skipping any
 * entry that cannot be revealed and focused, and stops at the first one that
 * actually takes focus. Going back starts at the current stop itself when
 * focus is not on it; going forward always starts at the stop after it.
 * Moves and reveals nothing while a modal layer is open.
 *
 * @param direction - `-1` to walk back, `1` to walk forward.
 * @returns True if focus moved.
 */
function navigate(direction: -1 | 1): boolean {
    pruneStale();

    // The trail is out of reach while a modal layer is open. A stop behind
    // the modal is inert, and revealing it would rearrange a page nobody can
    // reach. A stop inside its scope can only be a leftover: one recorded in
    // a layer that kept its element and is open again as, or from, the modal.
    const modalOpen = LayerManager.hasModalLayer();

    if (modalOpen) {
        return false;
    }

    // Focus can be somewhere that is no stop: in a control inside a table
    // cell, or on <body> after the focused control was removed. Going back
    // from there returns to the current stop before it goes any further.
    const onCurrentStop = _index >= 0 && _entries[_index] === DOM.source.getActiveElement();
    let target = direction === -1 && !onCurrentStop ? _index : _index + direction;

    while (target >= 0 && target < _entries.length) {
        if (revealAndFocus(_entries[target])) {
            _index = target;
            fireChange();

            return true;
        }

        target += direction;
    }

    return false;
}

/**
 * Ancestor walk for the record-time filter: whether `handle` is a table cell
 * or lives inside one (cell content, an in-cell editor). Every framework cell
 * renders as `<td>` or `<th>`, so this is the only marker needed — no
 * `closest`/`matches` DOM-seam addition required.
 */
function isInTableCell(handle: Handle): boolean {
    for (let h: Handle | null = handle; h !== null; h = DOM.source.getParentNode(h)) {
        const tag = DOM.source.getTagName(h);

        if (tag === "TD" || tag === "TH") {
            return true;
        }
    }

    return false;
}

/**
 * Whether a focus move onto `handle` is a history stop: a place that stays.
 * `<body>` and `<html>` are what a browser reports when nothing has focus. A
 * control inside a table cell holds a position inside a widget, not a place.
 * While a modal layer is open, and inside a transient layer (a menu, a
 * dropdown, a popover), focus is on a surface that is gone once it closes.
 *
 * @param handle - The element focus moved to.
 * @returns True when the move belongs in the trail.
 */
function isHistoryStop(handle: Handle): boolean {
    const tag = DOM.source.getTagName(handle);

    if (tag === "BODY" || tag === "HTML") {
        return false;
    }

    const inCell = isInTableCell(handle);

    if (inCell) {
        return false;
    }

    const modalOpen = LayerManager.hasModalLayer();

    if (modalOpen) {
        return false;
    }

    return !LayerManager.isInTransientLayer(handle);
}

/** Whether a `KeyboardEvent` matches a configured combo. */
function matchesCombo(e: KeyboardEvent, combo: FocusHistoryKeyCombo): boolean {
    return e.code === combo.code &&
        e.altKey === !!combo.alt && e.ctrlKey === !!combo.ctrl &&
        e.shiftKey === !!combo.shift && e.metaKey === !!combo.meta;
}

/** Document `focusin` handler: records the newly-focused element when it is a stop. */
function onFocusIn(e: FocusEvent): void {
    if (!_enabled || _navigating) {
        return;
    }

    if (!DOM.source.isElement(e.target)) {
        return;
    }

    const handle = DOM.source.intern(e.target);

    const stop = isHistoryStop(handle);

    if (!stop) {
        return;
    }

    record(handle);
}

/**
 * Document `keydown` handler: drives `back()`/`forward()` on the configured
 * combos, suppressed while any modal or transient layer is open, so the
 * accelerator never pulls focus out of a menu, a dropdown or a dialog.
 *
 * @returns `{ stop: true, prevent: true }` when the key matches a navigation combo
 *   and no modal or transient layer is suppressing it; nothing otherwise, so
 *   every other key keeps propagating.
 */
function onKeyDown(e: KeyboardEvent): Event.ListenerResult {
    if (!_enabled) {
        return;
    }

    const direction: -1 | 1 | 0 = matchesCombo(e, _back) ? -1 : matchesCombo(e, _forward) ? 1 : 0;

    if (direction === 0) {
        return;
    }

    const layerOpen = LayerManager.hasActiveInputLayer();

    if (layerOpen) {
        return;
    }

    navigate(direction);

    return { stop: true, prevent: true };
}

/**
 * Global focus-trail navigation service: records, in chronological order, the
 * places keyboard focus has been — controls of the page, of a window, of a
 * non-modal drawer and of a popover that only its own control closes — and
 * drives an accelerator that walks the trail backward and forward, like
 * browser back/forward but for keyboard focus. Nothing inside a menu, a
 * dropdown, a popover that an outside click or focus move closes, a dialog or
 * a modal drawer is recorded: those surfaces are gone once closed, and while
 * one is open the accelerator stands down. A control inside a table cell is
 * not recorded either. Opt-in — call {@link enable} to start recording;
 * nothing auto-starts it.
 *
 * @category Core
 */
export namespace FocusHistory {
    /**
     * Installs the `focusin` + `keydown` listeners, seeds the trail with the
     * current active element, and begins recording. The seed is skipped when
     * nothing has focus or the focused element is not a stop — it is inside a
     * menu or a dialog, say. Idempotent — calling it again while already
     * enabled only applies `options`.
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

        if (active === null) {
            return;
        }

        const stop = isHistoryStop(active);

        if (stop) {
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
     * Returns focus to the current stop when focus has left it — it is in a
     * control inside a table cell, or the focused control was removed — and
     * otherwise to the stop before it, skipping and dropping any stale ones
     * encountered along the way. Moves and reveals nothing while a dialog or
     * a modal drawer is open.
     *
     * @returns True if focus moved; `false` while a modal layer is open.
     */
    export function back(): boolean {
        return navigate(-1);
    }

    /**
     * Re-focuses the next live entry, skipping and dropping any stale ones
     * encountered along the way. Moves and reveals nothing while a dialog or
     * a modal drawer is open.
     *
     * @returns True if focus moved; `false` while a modal layer is open.
     */
    export function forward(): boolean {
        return navigate(1);
    }

    /**
     * Whether a live entry exists before the current position. Prunes stale
     * entries as a side effect, so a stale-only direction never reports true.
     * It describes the trail, not where focus is: it is not `true` merely
     * because focus has left the current stop, although {@link back} would
     * then return to that stop.
     *
     * @returns True when the trail holds a stop before the current one.
     */
    export function canGoBack(): boolean {
        pruneStale();

        return _index > 0;
    }

    /**
     * Whether a live entry exists after the current position. Prunes stale
     * entries as a side effect, so a stale-only direction never reports true.
     *
     * @returns True when the trail holds a stop after the current one.
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
