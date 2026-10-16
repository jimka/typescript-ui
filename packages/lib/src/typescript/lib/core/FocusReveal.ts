// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, Rect } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { LayerManager } from "~/core/LayerManager.js";
import type { ScrollAxis } from "~/core/SmoothScroller.js";

/**
 * A container that can bring one of its hidden descendants into a focusable
 * state — select its tab, expand its collapsed region, scroll it into view.
 * Implemented by [`Tab`](/api/layout/classes/Tab), [`Border`](/api/layout/classes/Border),
 * [`Accordion`](/api/layout/classes/Accordion), [`Split`](/api/layout/classes/Split),
 * and the scroll {@link Panel}.
 *
 * A revealer is one of two kinds. One that reveals by changing state — a
 * tab, a collapsed region — implements the two required members. One that
 * reveals by scrolling also implements {@link FocusRevealer.revealRect}.
 *
 * @category Core
 */
export interface FocusRevealer {
    /** The container's own element, used for containment + outermost-first ordering. Null when unrendered. */
    getRevealElement(): Handle | null;
    /** Reveal whichever of this container's regions/children is on the DOM path to `target`. */
    revealDescendant(target: Handle): void;
    /**
     * Implemented only by a revealer that reveals by scrolling: the element
     * whose box is the visible window onto its scrolled content. Null when
     * unrendered. {@link SpatialNavigation} reads it to tell a control that is
     * merely scrolled out of the focused control's own panel — still
     * reachable, and scrolled into view on landing — from one that is hidden.
     * A revealer that reveals by changing state (selecting a tab, expanding a
     * region) leaves it unimplemented.
     */
    getScrollViewportElement?(): Handle | null;
    /**
     * Implemented only by a revealer that reveals by scrolling. Scrolls the
     * least distance that brings `rect` into this revealer's scroll viewport,
     * and returns what is then on show of it: the rectangle moved by the
     * scroll and cut to the viewport. The next scroller out is handed that
     * rectangle. A revealer that cannot scroll right now returns `rect` as
     * given.
     *
     * @param rect - The rectangle to show, in browser-viewport coordinates.
     * @param axis - Reveal along this axis only; along both when omitted.
     * @returns The part of `rect` this revealer shows after the scroll.
     */
    revealRect?(rect: Rect, axis?: ScrollAxis): Rect;
    /**
     * Implemented only by a revealer whose reveal leaves geometry moving:
     * `false` while a section, pane or region is still animating open or
     * shut. A revealer without it is always settled.
     *
     * @returns Whether every box this revealer positions is where it will stay.
     */
    isRevealSettled?(): boolean;
    /**
     * Implemented only by a revealer that reveals by changing state: whether
     * `target` lies in a part this revealer hides right now — a tab that is
     * not selected, a closed section, a collapsed pane or region — so that
     * `revealDescendant(target)` would have to open it. Nothing is scrolled
     * towards a rectangle that an opener around it still hides.
     *
     * @param target - The element to test.
     * @returns Whether `target` cannot be seen until this revealer opens.
     */
    hidesDescendant?(target: Handle): boolean;
    /**
     * Implemented only by a revealer that reveals by scrolling and can tell,
     * without measuring anything, whether its content overflows its viewport
     * along `axis` right now. A component that continues its own row reveal
     * outward measures nothing when no scroller around it has such a range.
     * A scroller without this member is taken to have one.
     *
     * @param axis - The axis asked about; either axis when omitted.
     * @returns Whether there is anything to scroll along `axis`.
     */
    hasScrollRange?(axis?: ScrollAxis): boolean;
}

const _revealers = new Set<FocusRevealer>();

// How many layout flushes the scroll pass of a reveal waits for the geometry
// around its target to settle before it scrolls regardless. One flush runs
// per animation frame, so 60 is one second on a 60 Hz display and about 0.4 s
// on a 144 Hz one: in both cases longer than the 240 ms the library's own
// open and expand animations take, fallback buffer included. At 240 Hz it is
// 250 ms, which still is. Above that it is not: on a 360 Hz display the wait
// ends after 167 ms, and a reveal into a pane that is still opening then
// scrolls with the geometry of that moment, as every reveal did before the
// wait existed. It is a count of flushes, not a duration, so a test can run
// it out without a clock.
const MAX_SETTLE_FLUSHES = 60;

// The keys a browser scrolls a panel with when nothing else takes them. One
// of these, pressed inside a panel that a waiting scroll pass would move and
// taken by nothing, says the user is scrolling that panel by hand.
const SCROLL_KEYS: ReadonlySet<string> = new Set([
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " ",
]);

// Elements that take those keys for themselves without cancelling the event:
// a text field moves its caret, a select changes its value, a button is
// pressed by the space bar. A key that targets one does not scroll a panel.
const KEY_TAKING_CONTROLS = "input, textarea, select, button, a[href], [contenteditable]:not([contenteditable=\"false\"])";

// The input a waiting scroll pass watches for: a wheel tick, a touch pan, a
// pointer press (a scrollbar drag starts with one) and a key press.
const WATCHED_INPUT: readonly string[] = ["wheel", "touchmove", "pointerdown", "keydown"];

// Sentinel that owns the viewport listeners a waiting scroll pass installs —
// the broker has no element of its own. `FocusHistory` and `LayerManager` own
// theirs the same way.
const _inputOwner: Component = new Component();

/**
 * The scroll pass of one `FocusReveal.reveal` call, while it waits for the
 * geometry around its target to settle.
 */
interface ScrollPass {
    /** The element to scroll into view. */
    readonly target: Handle;
    /** How many more layout flushes to wait for the geometry to settle. At 0 the pass scrolls whatever it finds. */
    flushesLeft: number;
    /** Whether focus has been on `target`, or inside it, at some point of the wait. */
    focusSeen: boolean;
    /** A scrolling key pressed during the wait, until the next flush has seen whether anything took it. */
    pendingKey: KeyboardEvent | null;
    /** The pending layout-flush callback while the pass waits. */
    queued: { cancel(): void } | null;
    /** Callbacks to run when the pass is over, whether it scrolled or was withdrawn. */
    readonly done: Array<() => void>;
}

// The scroll pass of the latest `reveal`, while it waits for the geometry
// around its target to settle. The next `reveal` withdraws it.
let _waiting: ScrollPass | null = null;

// Whether the viewport listeners of `WATCHED_INPUT` are installed.
let _watchingInput: boolean = false;

/**
 * The registered revealers whose element contains `target`, outermost first.
 * One whose element is still `null` (not yet rendered) is skipped. One whose
 * element has rendered and is not connected is skipped too, and with `prune`
 * it is also dropped from the registry for good.
 *
 * Only a walk a consumer asked for by name prunes. A closed drawer, a hidden
 * popover and a removed view keep their elements while they are out of the
 * document, and nothing registers their panels a second time, so a walk that
 * runs on every row reveal or every layout flush must leave them registered.
 *
 * @param target - The element to find containing revealers for.
 * @param prune - Whether to drop a revealer whose element has rendered and gone.
 * @returns The containing revealers, outermost first.
 */
function revealersAround(target: Handle, prune: boolean): FocusRevealer[] {
    const found: Array<{ revealer: FocusRevealer; el: Handle }> = [];

    for (const revealer of _revealers) {
        const el = revealer.getRevealElement();

        if (el === null) {
            continue;
        }

        const connected = DOM.source.isConnected(el);

        if (!connected) {
            if (prune) {
                _revealers.delete(revealer);
            }

            continue;
        }

        const around = DOM.source.contains(el, target);

        if (around) {
            found.push({ revealer, el });
        }
    }

    // Outermost-first: an outer container must select/expand before an inner
    // one can measure. All entries are nested (each contains `target`), so
    // this containment comparator is a total order over them.
    found.sort((a, b) =>
        DOM.source.contains(a.el, b.el) ? -1 : DOM.source.contains(b.el, a.el) ? 1 : 0);

    return found.map(entry => entry.revealer);
}

/**
 * The registered revealers above `origin`, outermost first, found through the
 * component tree: an ancestor itself (a scrolling panel) and its layout
 * manager (a tab, split, border or accordion layout). Unlike
 * {@link revealersAround} this walks no registry and measures nothing, so a
 * component can call it on every key press.
 *
 * The component tree can end below the top of the page: a component that is
 * appended into another one's element without being its child, as the clip
 * of a `ScrollStrip` is. What lies around such a component is then looked up
 * as {@link revealersAround} does, from the element it is appended into.
 *
 * @param origin - The component to look above.
 * @param host - The element the component tree above `origin` is appended
 *   into where it ends early, from {@link hostBeyondTree}; `null` when it
 *   reaches the top of the page.
 * @returns The revealers above `origin`, outermost first.
 */
function revealersAbove(origin: Component, host: Handle | null): FocusRevealer[] {
    const found: FocusRevealer[] = [];

    for (let ancestor = origin.getParentComponent(); ancestor; ancestor = ancestor.getParentComponent()) {
        const manager        = ancestor.getLayoutManager() as unknown as FocusRevealer;
        const panel          = ancestor as unknown as FocusRevealer;
        const managerReveals = _revealers.has(manager);
        const panelReveals   = _revealers.has(panel);

        if (managerReveals) {
            found.push(manager);
        }

        if (panelReveals) {
            found.push(panel);
        }
    }

    // Everything in `found` lies inside `host`, so no revealer is in both.
    const outer = host === null ? [] : revealersAround(host, false);

    return [...outer, ...found.reverse()];
}

/**
 * The element the topmost component above `origin` is appended into, when
 * that element is neither the page's root nor its body: the place where the
 * component tree stops short of the DOM tree.
 *
 * @param origin - The component whose ancestry to follow.
 * @returns That element, or `null` when the component tree reaches the top
 *   of the page.
 */
function hostBeyondTree(origin: Component): Handle | null {
    let top = origin;

    for (let ancestor = origin.getParentComponent(); ancestor; ancestor = ancestor.getParentComponent()) {
        top = ancestor;
    }

    const element = top.getElement();
    const host    = element ? DOM.source.getParentElement(element) : null;
    const atTop   = host === null || host === DOM.source.getBody() || host === DOM.source.getDocumentElement();

    return atTop ? null : host;
}

/**
 * Whether `handle` still names a connected element. A pass holds its target
 * across layout flushes, and the component can be disposed in between.
 *
 * @param handle - The handle to test.
 * @returns `true` when the element exists and is in the document.
 */
function isLive(handle: Handle): boolean {
    // isRegistered first: isConnected throws on a released handle.
    return DOM.source.isRegistered(handle) && DOM.source.isConnected(handle);
}

/**
 * Whether keyboard focus is on `target` or inside it.
 *
 * @param target - The element a pass scrolls to.
 * @returns Whether the user is at `target`.
 */
function isFocusAt(target: Handle): boolean {
    const active = DOM.source.getActiveElement();

    return active !== null && (active === target || DOM.source.contains(target, active));
}

/**
 * The revealers in `around` that reveal by scrolling, innermost first. One
 * whose own element is `origin` is left out: a scroller does not scroll to
 * show itself.
 *
 * @param origin - The element being revealed, or the one a rectangle belongs to.
 * @param around - The revealers around `origin`, outermost first.
 * @returns The scrolling revealers around `origin`, innermost first.
 */
function scrollersOf(origin: Handle, around: readonly FocusRevealer[]): FocusRevealer[] {
    return around
        .filter(revealer => revealer.revealRect !== undefined && revealer.getRevealElement() !== origin)
        .reverse();
}

/**
 * Hands `rect` from scroller to scroller, innermost first. Each one scrolls
 * to show the rectangle it is handed, and what it returns is handed to the
 * next.
 *
 * @param scrollers - The scrolling revealers, innermost first.
 * @param rect - The rectangle to show, in browser-viewport coordinates.
 * @param axis - Reveal along this axis only; along both when omitted.
 */
function scrollThrough(scrollers: readonly FocusRevealer[], rect: Rect, axis?: ScrollAxis): void {
    let onShow = rect;

    for (const scroller of scrollers) {
        onShow = scroller.revealRect!(onShow, axis);
    }
}

/**
 * Whether an opener in `around` still hides `origin`: scrolling towards it
 * would move panels for a rectangle nobody can see.
 *
 * @param origin - The element a scroll would show.
 * @param around - The revealers around `origin`.
 * @returns `true` when a tab, section, pane or region would have to open first.
 */
function isHiddenByOpener(origin: Handle, around: readonly FocusRevealer[]): boolean {
    return around.some(revealer => revealer.hidesDescendant?.(origin) === true);
}

/**
 * Whether the panels above `origin` may be scrolled for it right now: it is
 * effectively visible, no opener above it is still animating, and none of
 * them hides it.
 *
 * @param origin - The component a row reveal belongs to.
 * @param element - Its element.
 * @param around - The revealers above it, outermost first.
 * @returns `false` when a scroll would be for something nobody can see, or
 *   would be measured against panels that are still moving.
 */
function canScrollAround(origin: Component, element: Handle, around: readonly FocusRevealer[]): boolean {
    // A hidden component measures as an empty rectangle at the window's
    // origin, and nothing is laid out, measured or scrolled for it.
    const visible   = origin.isEffectivelyVisible();
    const animating = around.some(revealer => revealer.isRevealSettled?.() === false);

    return visible && !animating && !isHiddenByOpener(element, around);
}

/**
 * Scrolls for `pass` when the geometry around its target is settled: no
 * layout pass is queued for a component around it, and no revealer around it
 * is still animating.
 *
 * @param pass - The pass to run.
 * @returns `false` when the geometry is not settled and the pass has to wait;
 *   `true` when the pass is over, whether or not anything scrolled.
 */
function scrollIfSettled(pass: ScrollPass): boolean {
    const target = pass.target;

    // A page behind a modal layer is inert. Rearranging it achieves nothing
    // the user can reach.
    const behindModal = LayerManager.isBehindModal(target);

    if (behindModal) {
        return true;
    }

    const around       = revealersAround(target, false);
    const layoutQueued = Component.isLayoutQueuedAround(target);
    const animating    = around.some(revealer => revealer.isRevealSettled?.() === false);
    const settled      = pass.flushesLeft === 0 || (!layoutQueued && !animating);

    if (!settled) {
        return false;
    }

    // An element that is not rendered measures as an empty rectangle at the
    // window's origin, and one that an opener hides again is not on show.
    // Scrolling towards either would move panels for nothing.
    const hidden  = isHiddenByOpener(target, around);
    const visible = !hidden && DOM.source.isRenderedVisible(target);

    if (visible) {
        scrollThrough(scrollersOf(target, around), DOM.source.getElementRect(target));
    }

    return true;
}

/**
 * Runs `pass` now when the geometry around its target is settled, and puts it
 * off to after the next layout flush when it is not.
 *
 * @param pass - The pass to run or park.
 */
function scrollOrWait(pass: ScrollPass): void {
    // A pass that throws is over too: it must not keep the slot, or the
    // input listeners, for good.
    let over = true;

    try {
        over = scrollIfSettled(pass);
    } finally {
        if (over) {
            end(pass);
        }
    }

    if (!over) {
        park(pass);
    }
}

/**
 * Puts `pass` in the waiting slot, if it is not there yet, and has it asked
 * again after the next layout flush.
 *
 * The slot holds one pass. `reveal` empties it before it gets here, so a pass
 * found in it has been put there since, by code that ran in between. That
 * pass is taken out before this one goes in, and is told last, so that a
 * callback of its own that asks for another reveal finds this pass in the
 * slot and withdraws it in the ordinary way.
 *
 * @param pass - A pass that could not scroll yet.
 */
function park(pass: ScrollPass): void {
    const displaced = _waiting === pass ? null : takeOutWaiting();

    if (_waiting !== pass) {
        _waiting       = pass;
        pass.focusSeen = isFocusAt(pass.target);
    }

    pass.queued = Component.afterNextLayout(() => resume(pass));

    if (displaced !== null) {
        tell(displaced);
    }
}

/**
 * A waiting pass's turn after a layout flush. The pass stands down when its
 * target is gone, when focus was on the target and has moved elsewhere, or
 * when a scrolling key pressed since the last flush was taken by nothing: the
 * user has gone on to something else, and scrolling back would pull the page
 * from under them. Otherwise it tries again.
 *
 * @param pass - The pass whose flush has run.
 */
function resume(pass: ScrollPass): void {
    pass.queued      = null;
    pass.flushesLeft -= 1;

    const live      = isLive(pass.target);
    const focusAt   = live && isFocusAt(pass.target);
    const focusLeft = pass.focusSeen && !focusAt;

    // A widget that takes a key cancels it, and then scrolls by itself or
    // asks for a reveal of its own. A key nobody cancelled scrolled a panel.
    const keyScrolled = pass.pendingKey !== null && !pass.pendingKey.defaultPrevented;

    pass.pendingKey = null;

    if (!live || focusLeft || keyScrolled) {
        end(pass);

        return;
    }

    pass.focusSeen = pass.focusSeen || focusAt;

    // Input is watched from the first flush on, not from the call: until
    // then it is the tail of the key press or the click that asked for the
    // reveal, not the user's next move.
    watchInput();

    scrollOrWait(pass);
}

/**
 * Ends `pass`, whether it has scrolled or stands down: takes it out of the
 * waiting slot if it is there, and tells whoever asked to hear of it.
 *
 * @param pass - A pass that is over.
 */
function end(pass: ScrollPass): void {
    if (_waiting === pass) {
        takeOutWaiting();
    }

    tell(pass);
}

/**
 * Empties the waiting slot without telling anyone: cancels the pass's queued
 * turn and stops watching input for it. The caller tells it, with
 * {@link tell}, once the slot is in the state a callback may find it in.
 *
 * @returns The pass that was waiting, or `null`.
 */
function takeOutWaiting(): ScrollPass | null {
    const pass = _waiting;

    if (pass === null) {
        return null;
    }

    pass.queued?.cancel();
    pass.queued = null;
    _waiting    = null;
    unwatchInput();

    return pass;
}

/**
 * Runs the callbacks that asked to hear when `pass` is over, each once. One
 * that throws is reported and the rest still run, as the layout flush treats
 * its own callbacks: a consumer's callback must not break the reveal, or the
 * key press, that happened to end the pass.
 *
 * @param pass - A pass that is over and out of the slot.
 */
function tell(pass: ScrollPass): void {
    for (const callback of pass.done.splice(0)) {
        try {
            callback();
        } catch (error) {
            console.error("FocusReveal: an afterReveal callback threw; the rest continued.", error);
        }
    }
}

/** Withdraws the scroll pass that is still waiting, if there is one. */
function withdrawWaiting(): void {
    const pass = takeOutWaiting();

    if (pass !== null) {
        tell(pass);
    }
}

/** Starts watching for input that says the user has taken over a panel the waiting pass would scroll. */
function watchInput(): void {
    if (_watchingInput) {
        return;
    }

    for (const type of WATCHED_INPUT) {
        Event.addViewportListener(_inputOwner, type, onUserInput);
    }

    _watchingInput = true;
}

/** Stops watching input. */
function unwatchInput(): void {
    if (!_watchingInput) {
        return;
    }

    for (const type of WATCHED_INPUT) {
        Event.removeViewportListener(_inputOwner, type, onUserInput);
    }

    _watchingInput = false;
}

/**
 * Whether `element` lies in one of the panels `pass` would scroll.
 *
 * @param pass - The waiting pass.
 * @param element - The element an input event targets.
 * @returns `true` when the input is on a panel the pass would move.
 */
function isOnScrolledPanel(pass: ScrollPass, element: Handle): boolean {
    return scrollersOf(pass.target, revealersAround(pass.target, false)).some(scroller => {
        const panel = scroller.getRevealElement();

        return panel !== null && (panel === element || DOM.source.contains(panel, element));
    });
}

/**
 * Withdraws the waiting pass when the user takes hold of a panel the pass
 * would scroll: a wheel tick, a touch pan or a pointer press whose target
 * lies inside one of them. The pass would otherwise pull that panel back to
 * its own target a moment later.
 *
 * A scrolling key is only noted. The event is seen here on its way down,
 * before anything has handled it, so the next flush decides: a key that a
 * widget cancelled did not scroll the panel. A key that targets a control
 * which takes such keys without cancelling them is not noted at all.
 *
 * @param event - The input event, on its way to its target.
 */
function onUserInput(event: KeyboardEvent | WheelEvent | PointerEvent | TouchEvent): void {
    const pass    = _waiting;
    const element = event.target === null ? null : DOM.source.intern(event.target);
    const live    = pass !== null && element !== null && isLive(pass.target);

    if (pass === null || element === null || !live) {
        return;
    }

    const onPanel = isOnScrolledPanel(pass, element);

    if (!onPanel) {
        return;
    }

    if (event.type !== "keydown") {
        withdrawWaiting();

        return;
    }

    const key     = event as KeyboardEvent;
    const scrolls = SCROLL_KEYS.has(key.key) && !key.ctrlKey && !key.altKey && !key.metaKey;
    const taken   = scrolls && DOM.source.matches(element, KEY_TAKING_CONTROLS);

    if (scrolls && !taken) {
        pass.pendingKey = key;
    }
}

/**
 * Broker that lets {@link FocusHistory} (or any other consumer) surface a
 * hidden focus target before focusing it. Hiding containers register
 * themselves as {@link FocusRevealer}s, and {@link reveal} works through the
 * ones whose element contains a given target in two passes. First every
 * revealer that changes state acts, outermost first, so a `Tab` selects the
 * tab that makes an inner panel measurable. Then every revealer that scrolls
 * acts, innermost first, so an outer panel scrolls to where the inner one
 * left the target.
 *
 * @category Core
 */
export namespace FocusReveal {
    /**
     * Registers `revealer` so future {@link reveal} / {@link containing} calls
     * consider it. Idempotent — registering an already-registered revealer is a
     * no-op (backed by a `Set`).
     *
     * @param revealer - The container entering the registry.
     */
    export function register(revealer: FocusRevealer): void {
        _revealers.add(revealer);
    }

    /**
     * Unregisters `revealer`. Idempotent — unregistering one not currently
     * registered is a no-op.
     *
     * @param revealer - The container leaving the registry.
     */
    export function unregister(revealer: FocusRevealer): void {
        _revealers.delete(revealer);
    }

    /**
     * Registered revealers whose element contains `target`, outermost-first.
     * Prunes any revealer whose element has *rendered and then gone* (a
     * container GC'd without `detach` — the leak guard); one whose element is
     * still `null` (not yet rendered — `attach()` can run before first render)
     * is skipped for this call but stays registered.
     *
     * @param target - The element to find containing revealers for.
     * @returns The containing revealers, outermost-first.
     */
    export function containing(target: Handle): FocusRevealer[] {
        return revealersAround(target, true);
    }

    /**
     * Reveals `target`. Every revealer around it that changes state — a tab,
     * a collapsed region — acts at once, outermost first, so `target` can
     * take focus when this returns. Every revealer around it that scrolls
     * then acts, innermost first, each showing what the one inside it left on
     * show.
     *
     * The scrolling waits while the geometry around `target` is not final: a
     * layout pass is queued around it, or a section, pane or region is still
     * animating. It then runs after the layout flush that finds everything
     * settled, which can be after this call has returned.
     *
     * A scroll that is still waiting is withdrawn by a later call, and also
     * when the user has moved on in the meantime: focus was on `target` and
     * has gone to another control, or the user has started to scroll, or
     * pressed on, one of the panels the scroll would move. Nothing is
     * scrolled for a `target` behind a modal layer, whether the layer was
     * open at the call or has opened since; the tab, pane, region or section
     * is still opened. {@link afterReveal} tells a caller when the scroll is
     * over.
     *
     * @param target - The element to reveal.
     * @returns `false` when `target` is disconnected (nothing to reveal);
     *   `true` otherwise.
     */
    export function reveal(target: Handle): boolean {
        const connected = DOM.source.isConnected(target);

        if (!connected) {
            return false;
        }

        for (const revealer of containing(target)) {
            if (revealer.revealRect === undefined) {
                revealer.revealDescendant(target);
            }
        }

        // The pass that waits is over: that of an earlier reveal, or of one
        // an opener's listener asked for while it opened just now. It is
        // told last, when this reveal has its own pass in place, so that a
        // callback which asks for another reveal is simply a later reveal.
        const earlier = takeOutWaiting();

        scrollOrWait({ target, flushesLeft: MAX_SETTLE_FLUSHES, focusSeen: false, pendingKey: null, queued: null, done: [] });

        if (earlier !== null) {
            tell(earlier);
        }

        return true;
    }

    /**
     * Runs `callback` once the scroll of the latest {@link reveal} is over:
     * it has run, or it has been withdrawn. When no scroll is waiting, which
     * is the case right after a `reveal` that scrolled inside the call,
     * `callback` runs at once. The way to read a position that depends on
     * the reveal's scroll.
     *
     * A callback may ask for another reveal, which is then the latest one. A
     * callback that throws is reported on the console, and the others still
     * run.
     *
     * @param callback - Called once, with nothing left waiting.
     */
    export function afterReveal(callback: () => void): void {
        if (_waiting === null) {
            callback();

            return;
        }

        _waiting.done.push(callback);
    }

    /**
     * Continues a reveal outward from `origin`: scrolls every scroller above
     * it, innermost first, to show a rectangle its owner worked out. For a
     * component that scrolls its own content and has just scrolled a row, a
     * cell or a span of it into view — a scrolling panel around the component
     * may still hide what it now shows. The library's lists, trees and tables
     * call it for a keyboard move; a state setter called from code scrolls
     * the component alone.
     *
     * Everything happens inside the call; nothing waits.
     *
     * - The scrollers are found among the ancestors of `origin` in the
     *   component tree: a scrolling panel, or a layout manager that is a
     *   revealer. With none, nothing happens.
     * - While a pane, region or section above `origin` is still opening or
     *   closing, nothing happens: the panels are not where they will stay,
     *   and the next call after the animation follows as usual.
     * - While `origin` is hidden, or a tab, section, pane or region above it
     *   hides it, nothing happens.
     * - A layout pass that is queued around `origin` is run first, so that
     *   what is measured is final. From inside a layout pass that cannot be
     *   done, and nothing happens. The three conditions above are tested
     *   again after it, since the pass can have hidden `origin`.
     * - When no scroller has a scroll range along `axis`, nothing happens,
     *   and `measure` is not called.
     *
     * @param origin - The component the rectangle belongs to.
     * @param measure - Returns the rectangle to show, in browser-viewport
     *   coordinates, or `null` when there is nothing to show. It is passed
     *   `true` when a layout pass was run first, in which case anything the
     *   caller measured or scrolled before the call has to be done again.
     * @param axis - Reveal along this axis only; along both when omitted.
     */
    export function revealRectAround(origin: Component, measure: (relaidOut: boolean) => Rect | null, axis?: ScrollAxis): void {
        const element = origin.getElement();

        // A component that has not rendered has no element, and is not
        // effectively visible either.
        if (!element) {
            return;
        }

        const host         = hostBeyondTree(origin);
        const around       = revealersAbove(origin, host);
        const scrollers    = scrollersOf(element, around);
        const inLayoutPass = Component.currentLayoutPass() !== 0;
        const possible     = scrollers.length > 0 && !inLayoutPass && canScrollAround(origin, element, around);

        if (!possible) {
            return;
        }

        // What waiting for the next layout flush would give, inside the
        // call: the outer passes first.
        const relaidOut = Component.isLayoutQueuedAround(origin) || (host !== null && Component.isLayoutQueuedAround(host));

        if (relaidOut && host !== null) {
            Component.flushLayoutQueuedAround(host);
        }

        if (relaidOut) {
            Component.flushLayoutQueuedAround(origin);
        }

        // A pass just run can have hidden the component: a `Tab` switches to
        // the page it was asked for when it is next laid out, and a
        // consumer's layout listener can hide anything.
        const stillPossible = !relaidOut || canScrollAround(origin, element, around);

        if (!stillPossible) {
            return;
        }

        const ranged = scrollers.some(scroller => scroller.hasScrollRange?.(axis) !== false);

        if (!ranged) {
            return;
        }

        const rect = measure(relaidOut);

        if (rect !== null) {
            scrollThrough(scrollers, rect, axis);
        }
    }
}
