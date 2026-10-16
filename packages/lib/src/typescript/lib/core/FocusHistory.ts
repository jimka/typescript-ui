// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { LayerManager } from "~/core/LayerManager.js";
import type { BackgroundSurface } from "~/core/LayerManager.js";
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
 * Payload of the `"change"` event: what {@link FocusHistory.back} and
 * {@link FocusHistory.forward} would do from where focus is now.
 *
 * @category Core
 */
export interface FocusHistoryChange {
    /** Whether `back()` has a stop to go to. */
    canGoBack:    boolean;
    /** Whether `forward()` has a stop to go to. */
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
// call, so the synchronous `focusin` it triggers is not recorded as a new move
// and neither that event nor its `focusout` fires `"change"` mid-walk.
let _navigating: boolean = false;
let _maxSize: number = DEFAULT_MAX_ENTRIES;
let _back:    FocusHistoryKeyCombo = DEFAULT_BACK_COMBO;
let _forward: FocusHistoryKeyCombo = DEFAULT_FORWARD_COMBO;
// The flags last handed to `"change"` listeners. Seeded with those of an empty
// trail, which is what a listener has to assume before its first event.
let _lastChange: FocusHistoryChange = { canGoBack: false, canGoForward: false };
// Whether a modal layer was open the last time the layer watch was called.
let _modalWasOpen: boolean = false;

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

/**
 * The position in `_entries` a walk in `direction` tries first. Going back
 * starts at the current stop itself when focus is not on it; going forward
 * always starts at the stop after it. The result can lie outside the trail,
 * which means the walk has nothing to try.
 *
 * @param direction - `-1` for a walk back, `1` for a walk forward.
 * @returns The first position to try.
 */
function firstCandidate(direction: -1 | 1): number {
    // Focus can be somewhere that is no stop: in a control inside a table
    // cell, or on <body> after the focused control was removed.
    const onCurrentStop = _index >= 0 && _entries[_index] === DOM.source.getActiveElement();

    return direction === -1 && !onCurrentStop ? _index : _index + direction;
}

/**
 * Prunes stale entries, then answers what a walk would do from where focus
 * is now: a flag is true when the walk in that direction has a stop to try.
 * Both are false while a modal layer is open, where no walk starts.
 *
 * @returns The two flags as they stand.
 */
function currentFlags(): FocusHistoryChange {
    pruneStale();

    const modalOpen = LayerManager.hasModalLayer();

    if (modalOpen) {
        return { canGoBack: false, canGoForward: false };
    }

    return {
        canGoBack:    firstCandidate(-1) >= 0,
        canGoForward: firstCandidate(1) < _entries.length,
    };
}

/**
 * Fires `"change"` when either flag differs from the one last fired, and
 * does nothing otherwise.
 */
function fireChangeIfFlipped(): void {
    const flags = currentFlags();

    if (flags.canGoBack === _lastChange.canGoBack && flags.canGoForward === _lastChange.canGoForward) {
        return;
    }

    _lastChange = flags;
    _listeners.fire("change", flags);
}

/**
 * Appends `handle` to the trail (deduping a repeat of the current entry and
 * truncating any forward branch) and advances `_index`.
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
function walk(direction: -1 | 1): boolean {
    pruneStale();

    // The trail is out of reach while a modal layer is open. A stop behind
    // the modal is inert, and revealing it would rearrange a page nobody can
    // reach. A stop inside its scope can only be a leftover: one recorded in
    // a layer that kept its element and is open again as, or from, the modal.
    const modalOpen = LayerManager.hasModalLayer();

    if (modalOpen) {
        return false;
    }

    let target = firstCandidate(direction);

    while (target >= 0 && target < _entries.length) {
        if (revealAndFocus(_entries[target])) {
            _index = target;

            return true;
        }

        target += direction;
    }

    return false;
}

/**
 * Walks the trail by `direction`, then fires `"change"` when a flag differs
 * from the one last fired — after a walk that moved focus and after one
 * that did not, since pruning alone can change a flag.
 *
 * @param direction - `-1` to walk back, `1` to walk forward.
 * @returns True if focus moved.
 */
function navigate(direction: -1 | 1): boolean {
    const moved = walk(direction);

    fireChangeIfFlipped();

    return moved;
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

/**
 * Document `focusin` handler: records the newly-focused element when it is a
 * stop, then fires `"change"` when a flag differs from the one last fired. A
 * move that records nothing can change a flag too: focus has left the
 * current stop, or returned to it.
 */
function onFocusIn(e: FocusEvent): void {
    if (!_enabled || _navigating) {
        return;
    }

    if (!DOM.source.isElement(e.target)) {
        return;
    }

    const handle = DOM.source.intern(e.target);

    const stop = isHistoryStop(handle);

    if (stop) {
        record(handle);
    }

    fireChangeIfFlipped();
}

/**
 * Document `focusout` handler: acts when focus has left an element for
 * nowhere — a click on the empty page, a blur from code — since no `focusin`
 * follows then. Fires `"change"` when a flag differs from the one last
 * fired.
 */
function onFocusOut(e: FocusEvent): void {
    if (!_enabled || _navigating) {
        return;
    }

    // Focus is on its way to another element. That element's `focusin`
    // follows, and reports the flags once the move is complete.
    const movingToElement = DOM.source.isNode(e.relatedTarget);

    if (movingToElement) {
        return;
    }

    fireChangeIfFlipped();
}

/**
 * Layer watch: `LayerManager` calls this on every register and unregister of
 * any layer. Acts only when a modal layer has opened or closed since the last
 * call, and then fires `"change"` when a flag differs from the one last
 * fired. No other layer changes a flag, and one that closes because focus
 * moved — a popover that closes on blur — unregisters in the middle of that
 * move, where the flags describe a state between two elements.
 *
 * @param modalOpen - Whether any modal layer is open now.
 */
function onLayersChanged(modalOpen: boolean): void {
    const modalChanged = modalOpen !== _modalWasOpen;

    _modalWasOpen = modalOpen;

    if (!modalChanged) {
        return;
    }

    fireChangeIfFlipped();
}

// How the service learns that a modal layer opened or closed. A background
// surface is what `LayerManager` tells about modality; the service is not a
// surface and writes no element — the trail is what goes out of reach while
// the page behind a modal layer is inert.
const _layerWatch: BackgroundSurface = { onInertChanged: onLayersChanged };

/**
 * Records the element that has focus as the first stop, when it is one.
 * Nothing is recorded when nothing has focus or the focused element is not a
 * stop.
 */
function seedFromActiveElement(): void {
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
     * Installs the `focusin`, `focusout` and `keydown` listeners, seeds the
     * trail with the current active element, and begins recording. The seed
     * is skipped when nothing has focus or the focused element is not a stop
     * — it is inside a menu or a dialog, say. Idempotent — calling it again
     * while already enabled only applies `options`. Fires `"change"` when a
     * flag differs from the one last fired.
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
        Event.addViewportListener(_owner, "focusout", onFocusOut);
        Event.addViewportListener(_owner, "keydown", onKeyDown);

        seedFromActiveElement();
        LayerManager.addBackgroundSurface(_layerWatch);
        fireChangeIfFlipped();
    }

    /**
     * Removes the listeners and stops recording. Preserves the trail —
     * re-enabling resumes from where it left off. Idempotent. While disabled,
     * {@link canGoBack} and {@link canGoForward} keep answering, but a focus
     * move fires no `"change"`; {@link enable} fires it if a flag changed in
     * between.
     */
    export function disable(): void {
        if (!_enabled) {
            return;
        }

        _enabled = false;
        _navigating = false;

        Event.removeViewportListener(_owner, "focusin", onFocusIn);
        Event.removeViewportListener(_owner, "focusout", onFocusOut);
        Event.removeViewportListener(_owner, "keydown", onKeyDown);
        LayerManager.removeBackgroundSurface(_layerWatch);
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
     * Whether {@link back} has a stop to go to from where focus is now: the
     * current stop when focus has left it, otherwise a stop before it. Always
     * `false` while a dialog or a modal drawer is open. Prunes stale entries as
     * a side effect, so a stop that has left the document never counts. A stop
     * that is still in the document counts even when it is hidden or disabled,
     * so `back()` can return `false` after this returned `true`.
     *
     * @returns True when `back()` has a stop to try.
     */
    export function canGoBack(): boolean {
        return currentFlags().canGoBack;
    }

    /**
     * Whether {@link forward} has a stop to go to: one after the current stop.
     * Always `false` while a dialog or a modal drawer is open. Prunes stale
     * entries as a side effect, so a stop that has left the document never
     * counts. A stop that is still in the document counts even when it is
     * hidden or disabled.
     *
     * @returns True when `forward()` has a stop to try.
     */
    export function canGoForward(): boolean {
        return currentFlags().canGoForward;
    }

    /** Empties the trail. Fires `"change"` when either flag was true. */
    export function clear(): void {
        _entries = [];
        _index = -1;
        fireChangeIfFlipped();
    }

    /**
     * Subscribes to `"change"`, fired whenever {@link canGoBack} or
     * {@link canGoForward} changes value: after a focus move, recorded or not,
     * after a `back()` / `forward()` call, after {@link clear}, and when a
     * dialog or a modal drawer opens or closes. It is not fired when neither
     * value changed, and not on subscribing: call the two functions once for
     * the starting state. A listener can run while a layer is opening or
     * closing, so it should not open or close one itself.
     *
     * @param event - Always `"change"`.
     * @param listener - Invoked with the two flags after the change.
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
