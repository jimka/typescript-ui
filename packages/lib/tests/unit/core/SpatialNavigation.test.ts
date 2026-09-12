// rankInDirection is a pure function over Rect literals — cases 1-11 need no
// DOM harness at all. The service tests (12-28) reuse FocusTraversal.test.ts's
// offline harness (seedStops-style setQuerySelectorAllResult seeding,
// setRenderedVisible, setConnected, dispatchKeyDown) and the superseded
// directional-panel-navigation plan's module-singleton afterEach pattern.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { rankInDirection, SpatialNavigation, type SpatialCandidate, type SpatialDirection } from '~/core/SpatialNavigation';
import { FOCUSABLE_SELECTOR } from '~/core/Focusable';
import { FocusReveal, type FocusRevealer } from '~/core/FocusReveal';
import { DOM, type Handle, type Rect } from '~/core/DOM';
import { LayerManager, type DismissableLayer } from '~/core/LayerManager';
import { installTestDOM, makeEvent, setConnected, setQuerySelectorAllResult, setRenderedVisible } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The DOM attribute a navigation target's element carries — mirrored by
// `Component.setNavigationTarget`. Not exported by the module under test, so
// hardcoded here exactly like FocusTraversal.test.ts's own tab-key-owner
// attribute literal.
const NAVIGATION_TARGET_SELECTOR = '[data-ts-ui-navigation-target]';

// The DOM attribute every `RovingTabIndex` member carries, active or not —
// mirrored by that class. Not exported by the module under test, hardcoded
// for the same reason as `NAVIGATION_TARGET_SELECTOR` above.
const ROVING_MEMBER_SELECTOR = '[data-ts-ui-roving-member]';

/** Mints a fresh handle, marked connected (live) unless told otherwise. */
function liveHandle(): Handle {
    const handle = DOM.sink.createElement('div');
    setConnected(handle, true);

    return handle;
}

/** Writes the inline-style geometry `getElementRect` composes its Rect from, from the rect's four edges (matching `rect()`, above). */
function place(handle: Handle, left: number, top: number, right: number, bottom: number): void {
    DOM.sink.apply(handle, { style: { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` } });
}

/** Marks `handle` a navigation target, mirroring `Component.setNavigationTarget(true)`. */
function markNavigationTarget(handle: Handle): void {
    DOM.sink.edit(handle).attr('data-ts-ui-navigation-target', 'true').commit();
}

/** Marks `handle` a `RovingTabIndex` member, mirroring `RovingTabIndex.add()`'s own attribute. */
function markRovingMember(handle: Handle): void {
    DOM.sink.edit(handle).attr('data-ts-ui-roving-member', 'true').commit();
}

// Fake FocusRevealers registered by the current test — unregistered in
// afterEach so one test's revealer can never leak into the next. `_revealers`
// is a module-level Set shared across the whole file, and a stale entry's
// numeric handle can collide with a same-numbered handle a later test mints,
// since installTestDOM resets the handle-numbering counter every test.
let _registeredRevealers: FocusRevealer[] = [];

/** Registers `element` as a bare FocusRevealer (reveal is a no-op) so `SpatialNavigation` treats it as `origin`'s nearest scrolling/hiding container. */
function registerFakeRevealer(element: Handle): void {
    const revealer: FocusRevealer = { getRevealElement: () => element, revealDescendant: () => {} };

    FocusReveal.register(revealer);
    _registeredRevealers.push(revealer);
}

/**
 * `DOM.source.getBody()` mints a fresh stub handle on every offline call, but
 * the service resolves its scope root fresh on every `move()`/keydown call —
 * pin it for the rest of the test, mirroring FocusTraversal.test.ts's helper
 * of the same name.
 */
function stableBody(): Handle {
    const body = DOM.source.getBody();
    vi.spyOn(DOM.source, 'getBody').mockReturnValue(body);

    return body;
}

/** Same as {@link stableBody}, for `DOM.source.getDocumentElement()`. */
function stableDocumentElement(): Handle {
    const documentElement = DOM.source.getDocumentElement();
    vi.spyOn(DOM.source, 'getDocumentElement').mockReturnValue(documentElement);

    return documentElement;
}

/** A synthetic keydown, shaped for direct `claimsKey` calls (never dispatched). */
function keyEvent(init: {
    code: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean;
}): KeyboardEvent {
    return makeEvent(0 as Handle, 'keydown', init) as unknown as KeyboardEvent;
}

/** Dispatches a keydown through the window-registered viewport listeners; returns the event so preventDefault/stopPropagation can be asserted. */
function dispatchKeyDown(init: {
    code: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean; repeat?: boolean;
}): { preventDefault: () => void; stopPropagation: () => void } {
    const event = makeEvent(0 as Handle, 'keydown', init) as unknown as { preventDefault: () => void; stopPropagation: () => void };

    vi.spyOn(event, 'preventDefault');
    vi.spyOn(event, 'stopPropagation');
    DOM.sink.dispatchEvent(DOM.source.getWindow(), event as unknown as Event);

    return event;
}

afterEach(() => {
    _registeredRevealers.forEach(revealer => FocusReveal.unregister(revealer));
    _registeredRevealers = [];

    SpatialNavigation.disable();
    SpatialNavigation.configure({ componentModifiers: { ctrl: true, alt: true }, targetModifiers: { ctrl: true, shift: true } });
    DOM.reset();
});

/** A Rect literal from its four edges — the shape rankInDirection consumes. */
function rect(left: number, top: number, right: number, bottom: number): Rect {
    return { x: left, y: top, width: right - left, height: bottom - top, top, left, right, bottom };
}

/** A synthetic handle identifying a candidate — never resolved against real DOM. */
function handle(n: number): Handle {
    return n as Handle;
}

function candidate(n: number, r: Rect): SpatialCandidate {
    return { handle: handle(n), rect: r };
}

describe('rankInDirection', () => {
    it('returns [] for an empty candidate list', () => {
        expect(rankInDirection(rect(0, 200, 100, 220), [], 'north')).toEqual([]);
    });

    it('excludes a candidate whose primary gap is negative — straddling the origin\'s forward edge', () => {
        const origin = rect(0, 200, 100, 220);
        // Case D from the plan's worked table: straddles O.top.
        const straddling = candidate(1, rect(0, 210, 100, 230));

        expect(rankInDirection(origin, [straddling], 'north')).toEqual([]);
    });

    it('excludes a candidate whose rect is width===0 && height===0 even when its position would qualify', () => {
        const origin = rect(0, 200, 100, 220);
        // Directly ahead and perpendicular-band-aligned — would otherwise be
        // the best possible candidate — but has no extent on either axis.
        const zeroRect = candidate(1, rect(50, 150, 50, 150));

        expect(rankInDirection(origin, [zeroRect], 'north')).toEqual([]);
    });

    it('includes a candidate whose primary gap is exactly 0 (edge-to-edge adjacency)', () => {
        const origin = rect(0, 200, 100, 220);
        const adjacent = candidate(1, rect(0, 180, 100, 200));

        expect(rankInDirection(origin, [adjacent], 'north')).toEqual([handle(1)]);
    });

    it('includes a candidate whose primary gap is negative only by sub-pixel rounding noise', () => {
        const origin = rect(0, 200, 100, 220);
        // Two flex siblings that are visually flush can each round their own
        // shared edge independently, landing a few thousandths of a pixel
        // apart — exactly what made a real adjacent tab button disappear
        // from the candidate set entirely (its edge landed 0.0000038px
        // behind the origin's). This must still count as adjacency, not
        // "behind the origin."
        const almostAdjacent = candidate(1, rect(0, 180, 100, 200.00001));
        const farther = candidate(2, rect(0, 80, 100, 100));

        expect(rankInDirection(origin, [almostAdjacent, farther], 'north')).toEqual([handle(1), handle(2)]);
    });

    it('ranks the smaller primary gap first among two candidates sharing the perpendicular band (C beats A)', () => {
        const origin = rect(0, 200, 100, 220);
        const a = candidate(1, rect(0, 80, 100, 100));  // directly above, primary 100
        const c = candidate(2, rect(0, 160, 100, 180)); // directly above, nearer, primary 20

        expect(rankInDirection(origin, [a, c], 'north')).toEqual([handle(2), handle(1)]);
    });

    it('ranks a perfectly aligned but distant candidate ahead of a near but off-band one (E beats G)', () => {
        const origin = rect(0, 0, 100, 100); // east; perpendicular centre 50
        const e = candidate(1, rect(200, 0, 250, 20));    // aligned, primary 100, perp gap 0 → score 100
        const g = candidate(2, rect(120, 300, 220, 320)); // near but off-band, primary 20, perp gap 200 → score 420

        expect(rankInDirection(origin, [e, g], 'east')).toEqual([handle(1), handle(2)]);
    });

    it('ranks directly ahead over diagonal at equal straight-line distance (A beats B)', () => {
        const origin = rect(0, 200, 100, 220);
        const a = candidate(1, rect(0, 80, 100, 100));    // directly above, score 100
        const b = candidate(2, rect(180, 120, 280, 140)); // above-right, score 220

        expect(rankInDirection(origin, [a, b], 'north')).toEqual([handle(1), handle(2)]);
    });

    it('breaks an equal score on the smaller perpendicular-centre distance (F beats E)', () => {
        const origin = rect(0, 0, 100, 100); // east; perpendicular centre 50
        const e = candidate(1, rect(200, 0, 250, 20));  // score 100, centre delta 40
        const f = candidate(2, rect(200, 60, 250, 80)); // score 100, centre delta 20

        expect(rankInDirection(origin, [e, f], 'east')).toEqual([handle(2), handle(1)]);
    });

    it('breaks an equal score and equal centre distance on the caller\'s supplied order', () => {
        const origin = rect(0, 0, 100, 100);
        const tied = rect(200, 40, 250, 60); // identical rect for both candidates: score and centre delta both tie exactly

        expect(rankInDirection(origin, [candidate(1, tied), candidate(2, tied)], 'east'))
            .toEqual([handle(1), handle(2)]);
        expect(rankInDirection(origin, [candidate(2, tied), candidate(1, tied)], 'east'))
            .toEqual([handle(2), handle(1)]);
    });

    it('ranks any candidate sharing the origin\'s perpendicular band ahead of every candidate that misses it, even when the missing one scores lower', () => {
        const origin = rect(200, 0, 400, 20); // west; perpendicular span [0, 20]
        // Same row as the origin, but far along it — the gap this arrow is
        // actually meant to close. Score 50.
        const sameRow = candidate(1, rect(120, 0, 150, 20));
        // A different row, close enough horizontally that the weighted-sum
        // score alone (26) ranks it ahead of sameRow's 50 — exactly how a
        // tab strip sitting just above a wide `Slider` could outrank the
        // `RadioButton` immediately to the slider's own left.
        const differentRow = candidate(2, rect(160, -30, 194, -10));

        expect(rankInDirection(origin, [sameRow, differentRow], 'west')).toEqual([handle(1), handle(2)]);
    });

    it('does not treat a merely-touching adjacent row as sharing the origin\'s perpendicular band', () => {
        const origin = rect(45, 31, 112, 55); // east; toolbar row, perpendicular span [31, 55]
        // The toolbar's own next control, spaced out (label + control) — the
        // gap this arrow is actually meant to close. Score 40.
        const sameRow = candidate(1, rect(152, 31, 218, 55));
        // A tab strip row directly above, its bottom edge exactly flush with
        // the toolbar's top edge (a real, common layout: no gap between a
        // fixed-height chrome row and the content below it). `gapBetween`
        // reports 0 for this touching-but-not-overlapping pair — same as a
        // genuine overlap — so this must not be treated as sharing the band,
        // even though its score (19) beats sameRow's.
        const flushAbove = candidate(2, rect(131, 0, 153, 31));

        expect(rankInDirection(origin, [sameRow, flushAbove], 'east')).toEqual([handle(1), handle(2)]);
    });

    it('returns every eligible candidate ranked, not only the winner', () => {
        const origin = rect(0, 0, 100, 100); // east; perpendicular centre 50
        const e = candidate(1, rect(200, 0, 250, 20));    // score 100, centre delta 40
        const f = candidate(2, rect(200, 60, 250, 80));   // score 100, centre delta 20
        const g = candidate(3, rect(120, 300, 220, 320)); // score 420

        expect(rankInDirection(origin, [e, f, g], 'east')).toEqual([handle(2), handle(1), handle(3)]);
    });

    it('mirrors the same fixture through all four directions', () => {
        const origin = rect(0, 0, 100, 100); // square, symmetric on every axis

        const fixtures: Record<SpatialDirection, { aligned: Rect; offBand: Rect }> = {
            north: { aligned: rect(20, -50, 80, -10), offBand: rect(120, -50, 180, -10) },
            south: { aligned: rect(20, 110, 80, 150),  offBand: rect(120, 110, 180, 150) },
            east:  { aligned: rect(110, 20, 150, 80),  offBand: rect(110, 120, 150, 180) },
            west:  { aligned: rect(-50, 20, -10, 80),  offBand: rect(-50, 120, -10, 180) },
        };

        for (const direction of Object.keys(fixtures) as SpatialDirection[]) {
            const { aligned, offBand } = fixtures[direction];

            // Every fixture shares the same primary gap (10); only the
            // perpendicular alignment differs — the aligned one must win in
            // every direction alike.
            expect(rankInDirection(origin, [candidate(1, aligned), candidate(2, offBand)], direction))
                .toEqual([handle(1), handle(2)]);
        }
    });
});

describe('SpatialNavigation.claimsKey', () => {
    it('is false for every key while isEnabled() is false', () => {
        installTestDOM(CONFIG);

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true }))).toBe(false);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, shiftKey: true }))).toBe(false);
    });

    it('once enabled with defaults, claims Ctrl+Alt+Arrow* and Ctrl+Shift+Arrow*, and refuses a bare arrow, Ctrl-only, Shift-only, Alt-only, and a non-arrow code', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowUp', ctrlKey: true, altKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowDown', ctrlKey: true, altKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowLeft', ctrlKey: true, altKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, shiftKey: true }))).toBe(true);

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight' }))).toBe(false);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true }))).toBe(false);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', shiftKey: true }))).toBe(false);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', altKey: true }))).toBe(false);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'KeyA', ctrlKey: true, altKey: true }))).toBe(false);
    });

    it('configure({ componentModifiers }) claims the new set and stops claiming the old one, leaving the target tier untouched — and vice versa', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();

        SpatialNavigation.configure({ componentModifiers: { alt: true } });

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', altKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true }))).toBe(false);
        // The target tier's default is untouched by the component reconfigure.
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, shiftKey: true }))).toBe(true);

        SpatialNavigation.configure({ componentModifiers: { ctrl: true, alt: true }, targetModifiers: { meta: true } });

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', metaKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, shiftKey: true }))).toBe(false);
        // The component tier's reconfigured set is untouched by the target reconfigure.
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true }))).toBe(true);
    });

    it('is false while a non-"manual" layer is registered, even underneath a "manual" one stacked on top, and true once only the "manual" layer remains', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();

        const dropdown: DismissableLayer = { getLayerElement: () => null, getDismissMode: () => 'click-outside', requestClose: () => {} };
        LayerManager.register(dropdown);

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true }))).toBe(false);

        const windowLayer: DismissableLayer = { getLayerElement: () => null, getDismissMode: () => 'manual', requestClose: () => {} };
        LayerManager.register(windowLayer);

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true }))).toBe(false);

        LayerManager.unregister(dropdown);

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true }))).toBe(true);

        LayerManager.unregister(windowLayer);
    });
});

describe('SpatialNavigation keydown wiring', () => {
    it('with both tiers configured to the same modifier set, a matching keydown moves the component tier', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.configure({ targetModifiers: { ctrl: true, alt: true } });
        SpatialNavigation.enable();

        const body = stableBody();
        const origin = liveHandle();
        const plainCandidate = liveHandle(); // unmarked: only the component tier can reach it

        place(origin, 0, 200, 100, 220);
        place(plainCandidate, 0, 80, 100, 100);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, plainCandidate]);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, []);
        DOM.sink.focus(origin);

        dispatchKeyDown({ code: 'ArrowUp', ctrlKey: true, altKey: true });

        expect(DOM.source.getActiveElement()).toBe(plainCandidate);
    });

    it('a claimed keydown calls preventDefault and stopPropagation whether or not focus moved', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();

        const body = stableBody();
        const origin = liveHandle();
        place(origin, 0, 200, 100, 220);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin]);
        DOM.sink.focus(origin);

        // Nothing else registered to move focus to.
        const event = dispatchKeyDown({ code: 'ArrowUp', ctrlKey: true, altKey: true });

        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('an unclaimed keydown calls neither preventDefault nor stopPropagation', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();

        const event = dispatchKeyDown({ code: 'ArrowUp' }); // no modifiers

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
    });

    it('ignores an OS auto-repeat keydown, moving focus only once per physical key-hold', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();

        const body = stableBody();
        const origin = liveHandle();
        const near = liveHandle();
        const far = liveHandle();

        place(origin, 0, 300, 100, 320);
        place(near, 0, 200, 100, 220); // one step north of origin
        place(far, 0, 80, 100, 100);   // a further step north, beyond near
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, near, far]);
        DOM.sink.focus(origin);

        dispatchKeyDown({ code: 'ArrowUp', ctrlKey: true, altKey: true });
        expect(DOM.source.getActiveElement()).toBe(near);

        // A held key's OS-generated repeat keydown must not advance focus a
        // second time for what was a single physical press — mirroring
        // Button's own `e.repeat` guard on its space-bar handler.
        const event = dispatchKeyDown({ code: 'ArrowUp', ctrlKey: true, altKey: true, repeat: true });
        expect(DOM.source.getActiveElement()).toBe(near);

        // Still claims (and consumes) the repeat keydown, exactly like any
        // other claimed keydown that doesn't move focus.
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('after disable(), a chord that was previously claimed moves nothing and calls neither preventDefault nor stopPropagation', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();

        const body = stableBody();
        const origin = liveHandle();
        const candidate = liveHandle();
        place(origin, 0, 200, 100, 220);
        place(candidate, 0, 80, 100, 100);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, candidate]);
        DOM.sink.focus(origin);

        SpatialNavigation.disable();

        const event = dispatchKeyDown({ code: 'ArrowUp', ctrlKey: true, altKey: true });

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(origin);
    });
});

describe('SpatialNavigation.move — component tier', () => {
    it('focuses the best-ranked rendered focusable in scope, and never a candidate isRenderedVisible reports false for', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const nearestButHidden = liveHandle();
        const nextBest = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(nearestButHidden, 0, 160, 100, 180); // nearer, but hidden
        place(nextBest, 0, 80, 100, 100);
        setRenderedVisible(nearestButHidden, false);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, nearestButHidden, nextBest]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(nextBest);
    });

    it('returns false and focuses nothing when nothing is focused', () => {
        installTestDOM(CONFIG);
        stableBody();

        expect(DOM.source.getActiveElement()).toBe(null);
        expect(SpatialNavigation.move('north', 'component')).toBe(false);
    });

    it('returns false and focuses nothing when the focused element\'s rect is the zero rect', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle(); // never placed — getElementRect is the zero rect
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('never re-focuses the origin element', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();

        place(origin, 0, 200, 100, 220);
        // The origin itself would offline-"match" the seeded selector too, exactly
        // like any other candidate; the service must still drop it explicitly.
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('passes { preventScroll: true } to every service-driven focus call', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const nextBest = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(nextBest, 0, 80, 100, 100);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, nextBest]);
        DOM.sink.focus(origin);

        const realFocus = DOM.sink.focus.bind(DOM.sink);
        const focusSpy = vi.spyOn(DOM.sink, 'focus').mockImplementation((h: Handle, options?: { preventScroll?: boolean }) => {
            realFocus(h, options);
        });

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(focusSpy).toHaveBeenCalledWith(nextBest, { preventScroll: true });
    });

    it('tries the next-ranked candidate when the best-ranked one refuses focus, and returns true once one takes it', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const refuses = liveHandle();
        const accepts = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(refuses, 0, 160, 100, 180); // nearer — tried first, but refuses focus
        place(accepts, 0, 80, 100, 100);  // farther — tried second
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, refuses, accepts]);
        DOM.sink.focus(origin);

        const realFocus = DOM.sink.focus.bind(DOM.sink);
        vi.spyOn(DOM.sink, 'focus').mockImplementation((handle: Handle, options?: { preventScroll?: boolean }) => {
            if (handle === refuses) {
                return; // refuses focus
            }

            realFocus(handle, options);
        });

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(accepts);
    });

    it('prefers a composite widget\'s own content over its wrapping container, when both are candidates', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const container = liveHandle(); // e.g. ToolBar's own tabindex="0" element
        const button = liveHandle();    // its real content — a roving-tabindex member

        DOM.sink.appendChild(container, button);
        place(origin, 0, 200, 100, 220);
        // container's own rect extends 1px past its child's — e.g. a bottom
        // border — the exact geometry that let the wrapper out-rank its own
        // content under a flat (unfiltered) ranking.
        place(container, 0, 80, 100, 101);
        place(button, 0, 0, 100, 20); // local coords -> absolute (0,80,100,100)
        markRovingMember(button);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, container, button]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(button);
    });

    it('does not drop a native-tag candidate for containing another candidate, unlike a plain container', () => {
        // e.g. a TabButton (a real <button>) with its overlaid TabCloseButton
        // raw-appended as a genuine DOM child — both independently meaningful,
        // unlike a passive ToolBar/MenuBar container hosting its own content.
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const tabButton = DOM.sink.createElement('button');
        const closeButton = DOM.sink.createElement('button');
        setConnected(tabButton, true);
        setConnected(closeButton, true);

        DOM.sink.appendChild(tabButton, closeButton);
        place(origin, 0, 200, 100, 220);
        place(tabButton, 0, 80, 100, 100);
        place(closeButton, 84, 4, 96, 16); // local coords -> absolute (84,84,96,96): corner overlay, still inside tabButton
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, tabButton, closeButton]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(tabButton);
    });

    it('keeps a tabindex-bearing container over a plain descendant that only carries an incidental tabindex', () => {
        // e.g. Table's <tbody> (Body.ts sets its own tabindex="0" as the
        // whole table's single grid-pattern Tab stop) containing a boolean
        // column's always-visible Checkbox cell renderer (BooleanEditor),
        // which sets tabindex="0" on itself for standalone use but carries no
        // roving-tabindex marker and renders as no native focusable tag —
        // unlike a ToolBar's real content, it was never meant to be
        // independently reachable, and letting it out-rank its own tbody
        // fractures the table's one-stop-per-widget model into a scatter of
        // per-cell stops.
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const tableBody = liveHandle();    // e.g. Table's own tabindex="0" <tbody>
        const checkboxCell = liveHandle(); // an always-visible boolean-cell Checkbox

        DOM.sink.appendChild(tableBody, checkboxCell);
        place(origin, 0, 200, 100, 220);
        place(tableBody, 0, 80, 100, 180);
        place(checkboxCell, 10, 10, 26, 26); // local coords -> absolute (10,90,26,106)
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, tableBody, checkboxCell]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(tableBody);
    });

    it('reaches a roving-tabindex member roved to tabindex="-1" that renders as no native focusable tag', () => {
        // e.g. a ToolBar holding several ComboBoxes: only the active one has
        // tabindex="0" and matches FOCUSABLE_SELECTOR; its DIV-rooted siblings
        // are roved to "-1" and would otherwise be invisible to this tier.
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();   // the toolbar's active ComboBox
        const rovedOff = liveHandle(); // a sibling ComboBox at tabindex="-1"

        place(origin, 0, 200, 100, 220);
        place(rovedOff, 0, 160, 100, 180); // directly north, nearest
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin]);
        setQuerySelectorAllResult(body, ROVING_MEMBER_SELECTOR, [origin, rovedOff]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(rovedOff);
    });

    it('does not offer a disabled roving-tabindex member as a candidate', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const disabledSibling = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(disabledSibling, 0, 160, 100, 180);
        DOM.sink.edit(disabledSibling).attr('disabled', '').commit();
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin]);
        setQuerySelectorAllResult(body, ROVING_MEMBER_SELECTOR, [origin, disabledSibling]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('does not treat a decorative glyph icon as a candidate that disqualifies its own containing button', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const header = liveHandle(); // e.g. an AccordionHeader button
        const glyph = DOM.sink.createElement('use'); // its chevron glyph icon
        setConnected(glyph, true);

        DOM.sink.appendChild(header, glyph);
        place(origin, 0, 200, 100, 220);
        place(header, 0, 80, 100, 100);
        place(glyph, 0, 0, 10, 10); // local coords, deep inside header
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, header, glyph]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(header);
    });

    it('excludes a candidate a collapsed ancestor is currently clipping to nothing, preferring a genuinely visible one instead', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const collapsedWrapper = liveHandle(); // e.g. an Accordion section's height-animated wrapper
        const phantom = liveHandle();          // its content — keeps its ordinary, unclipped rect
        const visible = liveHandle();          // genuinely visible, farther away

        DOM.sink.appendChild(collapsedWrapper, phantom);
        place(origin, 0, 200, 100, 220);
        place(collapsedWrapper, 0, 150, 100, 150); // collapsed to zero height
        place(phantom, 0, 0, 100, 50);             // local coords -> absolute (0,150,100,200): deceptively adjacent
        place(visible, 0, 80, 100, 100);

        vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((h: Handle) =>
            h === collapsedWrapper
                ? { overflow: 'hidden', overflowX: 'hidden', overflowY: 'hidden' }
                : { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' });

        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, phantom, visible]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(visible);
    });

    it('ranks a clip-framed candidate by its frame\'s rect, not its own oversized one', () => {
        // e.g. a Grid cell's oversized child, wrapped by Component.setClipFrame:
        // the child's own element keeps its full natural size and is parked
        // at the frame's origin, so it can spill deep past the frame's far
        // edge — here, past its south edge into the origin's own row — enough
        // to put a genuinely-adjacent origin "behind" it on raw geometry and
        // drop it from ranking entirely.
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const clipFrame = liveHandle();
        const oversized = liveHandle();

        DOM.sink.appendChild(clipFrame, oversized);
        DOM.sink.edit(clipFrame).attr('data-ts-ui-clip-frame', 'true').commit();
        place(origin, 0, 200, 100, 220);
        place(clipFrame, 0, 150, 100, 170); // the cell: north of origin, gap 30
        place(oversized, 0, 0, 100, 60); // local coords -> absolute (0,150,100,210): spills 40px past the cell's south edge
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, oversized]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(oversized);
    });

    it('ranks a clip-framed origin by its frame\'s rect too, not its own oversized one', () => {
        // The mirror of the case above: the move starts *from* the oversized,
        // clip-framed element, so its own raw (unclipped) rect — not the
        // frame's — would put a genuinely-adjacent candidate "behind" it and
        // reject that candidate instead.
        installTestDOM(CONFIG);
        const body = stableBody();
        const oversizedOrigin = liveHandle();
        const clipFrame = liveHandle();
        const eastNeighbour = liveHandle();

        DOM.sink.appendChild(clipFrame, oversizedOrigin);
        DOM.sink.edit(clipFrame).attr('data-ts-ui-clip-frame', 'true').commit();
        place(clipFrame, 0, 80, 40, 100); // the cell: 40px wide
        place(oversizedOrigin, 0, 0, 150, 20); // local coords -> absolute (0,80,150,100): spills to x=150
        place(eastNeighbour, 45, 80, 145, 100); // just past the cell's east edge, well inside the raw spill
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [oversizedOrigin, eastNeighbour]);
        DOM.sink.focus(oversizedOrigin);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(eastNeighbour);
    });

    it('does not walk past documentElement checking for a collapsed ancestor when root is not an ancestor of the candidate', () => {
        // e.g. focus inside a non-topmost LayerManager layer: `focusScopeRoot`
        // resolves `root` to the *topmost* registered layer's element
        // regardless, which need not be an ancestor of a candidate living in
        // some other, currently non-topmost layer — the same root-is-not-an-
        // ancestor shape the recordOrigin/findTabKeyOwner fixes cover,
        // reached here through ancestorGeometry's own ancestor walk
        // (`getComputedStyle` throws on a real `document` node, same as
        // `hasAttribute`).
        installTestDOM(CONFIG);
        stableBody();
        const documentElement = stableDocumentElement();
        const documentNode = liveHandle(); // stands in for `document` itself
        const topLayerRoot  = liveHandle(); // the topmost layer — resolves as `root`
        const origin = liveHandle();
        const candidate = liveHandle(); // lives outside `topLayerRoot` entirely

        DOM.sink.appendChild(documentNode, documentElement);
        DOM.sink.appendChild(documentElement, candidate);
        place(origin, 0, 200, 100, 220);
        place(candidate, 0, 80, 100, 100);
        setQuerySelectorAllResult(topLayerRoot, FOCUSABLE_SELECTOR, [origin, candidate]);
        DOM.sink.focus(origin);

        const topLayer: DismissableLayer = { getLayerElement: () => topLayerRoot, getDismissMode: () => 'manual', requestClose: () => {} };
        LayerManager.register(topLayer);

        const realGetComputedOverflow = DOM.source.getComputedOverflow.bind(DOM.source);
        vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((handle: Handle) => {
            if (handle === documentNode) {
                throw new TypeError('getComputedStyle is not a function');
            }

            return realGetComputedOverflow(handle);
        });

        expect(() => SpatialNavigation.move('north', 'component')).not.toThrow();

        LayerManager.unregister(topLayer);
    });
});

describe('SpatialNavigation.move — scrolling-container priority', () => {
    // A candidate scrolled far enough out of its own container's view can end
    // up, in raw page coordinates, farther from origin than some unrelated
    // element positioned elsewhere on the page (e.g. a fixed tab strip near
    // the top of the page, while the scrolled-out sibling has been pushed up
    // near that same coordinate). Reproduces the MiscPanel left-column bug:
    // Ctrl+Alt+Up jumped into the app's tab bar instead of continuing to the
    // next (scrolled-off) button in the same scrolling Panel.
    it('keeps a move inside the origin\'s nearest scrolling container ahead of an outside candidate that merely looks closer in raw page coordinates', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const container = liveHandle();
        const origin = liveHandle();
        const withinSibling = liveHandle();    // scrolled far above origin, but still inside container
        const outsideCandidate = liveHandle(); // outside container, but a smaller raw primary gap

        DOM.sink.appendChild(container, origin);
        DOM.sink.appendChild(container, withinSibling);
        registerFakeRevealer(container);

        place(origin, 8, 214, 218, 243);
        place(withinSibling, 8, -25, 170, 4);     // raw primary gap from origin: 214 - 4   = 210
        place(outsideCandidate, 109, 0, 131, 31); // raw primary gap from origin: 214 - 31  = 183 (smaller!)

        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, withinSibling, outsideCandidate]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(withinSibling);
    });

    it('still reaches an outside candidate once the origin\'s own scrolling container has no more candidates in that direction', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const container = liveHandle();
        const origin = liveHandle(); // the only focusable element inside container
        const outsideCandidate = liveHandle();

        DOM.sink.appendChild(container, origin);
        registerFakeRevealer(container);

        place(origin, 8, 214, 218, 243);
        place(outsideCandidate, 109, 0, 131, 31);

        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, outsideCandidate]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(outsideCandidate);
    });

    it('ranks normally when origin is not inside any registered revealer', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const nearer = liveHandle();
        const farther = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(nearer, 0, 160, 100, 180);
        place(farther, 0, 80, 100, 100);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, nearer, farther]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(nearer);
    });
});

describe('SpatialNavigation.move — target tier', () => {
    it('considers only elements matching [data-ts-ui-navigation-target] inside the scope — an unmarked container in the same direction is ignored', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const unmarkedContainer = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(unmarkedContainer, 0, 80, 100, 100);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, []); // unmarkedContainer never appears here
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'target')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('lands on the first focusable descendant of a target with nothing recorded', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const target = liveHandle();
        const firstChild = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(target, 0, 80, 100, 100);
        markNavigationTarget(target);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [firstChild]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(firstChild);
    });

    it('lands on the target\'s remembered descendant when it is still live and contained', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const target = liveHandle();
        const remembered = liveHandle();
        const firstChild = liveHandle();
        const elsewhere = liveHandle();

        markNavigationTarget(target);
        DOM.sink.appendChild(target, remembered);
        place(target, 0, 80, 100, 100);
        place(remembered, 0, 85, 50, 95); // origin of the "move away" step below
        place(elsewhere, 0, 200, 100, 220); // south of target/remembered

        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [firstChild, remembered]);

        // Record `remembered` against `target` by focusing it, then moving
        // away via the component tier (moveFocus records the origin before
        // ranking).
        DOM.sink.focus(remembered);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [remembered, elsewhere]);
        SpatialNavigation.move('south', 'component');
        expect(DOM.source.getActiveElement()).toBe(elsewhere);

        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(remembered);
    });

    it('tries the next focusable descendant when the remembered one refuses focus, and the next-ranked target when a target has no focusable descendant', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const emptyTarget = liveHandle();
        const target = liveHandle();
        const remembered = liveHandle();
        const nextChild = liveHandle();
        const elsewhere = liveHandle();

        markNavigationTarget(emptyTarget);
        markNavigationTarget(target);
        DOM.sink.appendChild(target, remembered);
        place(emptyTarget, 0, 90, 100, 110); // nearer to elsewhere — tried first, but has no focusable descendant
        place(target, 0, 60, 100, 80);       // farther
        place(remembered, 0, 65, 50, 75);    // origin of the "move away" step below, inside target
        place(elsewhere, 0, 200, 100, 220);  // south of both targets

        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [emptyTarget, target]);
        setQuerySelectorAllResult(emptyTarget, FOCUSABLE_SELECTOR, []);
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [remembered, nextChild]);

        DOM.sink.focus(remembered);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [remembered, elsewhere]);
        SpatialNavigation.move('south', 'component');
        expect(DOM.source.getActiveElement()).toBe(elsewhere);

        const realFocus = DOM.sink.focus.bind(DOM.sink);
        vi.spyOn(DOM.sink, 'focus').mockImplementation((handle: Handle, options?: { preventScroll?: boolean }) => {
            if (handle === remembered) {
                return; // refuses focus
            }

            realFocus(handle, options);
        });

        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(nextChild);
    });

    it('calls FocusReveal.reveal for each landing candidate before its focus attempt', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const target = liveHandle();
        const firstChild = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(target, 0, 80, 100, 100);
        markNavigationTarget(target);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [firstChild]);
        DOM.sink.focus(origin);

        const order: string[] = [];

        vi.spyOn(FocusReveal, 'reveal').mockImplementation((h: Handle) => {
            order.push('reveal:' + h);

            return DOM.source.isConnected(h);
        });

        const realFocus = DOM.sink.focus.bind(DOM.sink);
        vi.spyOn(DOM.sink, 'focus').mockImplementation((h: Handle, options?: { preventScroll?: boolean }) => {
            order.push('focus:' + h);
            realFocus(h, options);
        });

        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(order).toEqual(['reveal:' + firstChild, 'focus:' + firstChild]);
    });

    it('records a moved-away-from element against every marked ancestor it was nested inside, not only the nearest', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const outer = liveHandle();
        const inner = liveHandle();
        const origin = liveHandle();
        const elsewhere = liveHandle();

        markNavigationTarget(outer);
        markNavigationTarget(inner);
        DOM.sink.appendChild(outer, inner);
        DOM.sink.appendChild(inner, origin);
        // Geometry composes through the DOM parent chain (each handle's rect
        // is local to its parent), so `inner`/`origin`'s edges below are
        // local offsets that land them at absolute (0,80,100,100) and
        // (0,85,50,95) respectively — same as the single-level fixtures
        // above, just nested two deep.
        place(outer, 0, 80, 100, 100);
        place(inner, 0, 0, 100, 20);
        place(origin, 0, 5, 50, 15); // origin of the "move away" step below, inside inner/outer
        place(elsewhere, 0, 200, 100, 220); // south of outer/inner/origin

        DOM.sink.focus(origin);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, elsewhere]);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [outer, inner]);
        SpatialNavigation.move('south', 'component');
        expect(DOM.source.getActiveElement()).toBe(elsewhere);

        // Only `inner` in the candidate set: proves `inner` recorded `origin`.
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [inner]);
        setQuerySelectorAllResult(inner, FOCUSABLE_SELECTOR, [origin]);
        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(origin);

        // Only `outer` in the candidate set: proves `outer` recorded `origin` too.
        DOM.sink.focus(elsewhere);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [outer]);
        setQuerySelectorAllResult(outer, FOCUSABLE_SELECTOR, [origin]);
        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('prefers an ancestor target over its own nested descendant target when the move approaches from outside the subtree', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const outer = liveHandle();
        const inner = liveHandle();
        const outerLanding = liveHandle();
        const innerLanding = liveHandle();

        markNavigationTarget(outer);
        markNavigationTarget(inner);
        DOM.sink.appendChild(outer, inner);

        place(origin, 0, 0, 90, 20);
        place(outer, 0, 100, 200, 150);
        // getElementRect composes a nested handle's position through its DOM
        // parent chain (own width/height, but position += ancestor position),
        // so inner's local rect here resolves to the absolute [0,100,80,150] —
        // nested in outer, closer to origin's centre — would win a flat ranking.
        place(inner, 0, 0, 80, 50);

        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [outer, inner]);
        setQuerySelectorAllResult(outer, FOCUSABLE_SELECTOR, [outerLanding]);
        setQuerySelectorAllResult(inner, FOCUSABLE_SELECTOR, [innerLanding]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('south', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(outerLanding);
    });

    it('does not suppress a sibling target reached from inside the shared ancestor target', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const outer = liveHandle();
        const childA = liveHandle();
        const childB = liveHandle();
        const childBLanding = liveHandle();

        markNavigationTarget(outer);
        markNavigationTarget(childA);
        markNavigationTarget(childB);
        DOM.sink.appendChild(outer, childA);
        DOM.sink.appendChild(outer, childB);

        place(outer, 0, 0, 200, 50);
        place(childA, 0, 0, 80, 50);
        place(childB, 100, 0, 200, 50);

        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [outer, childA, childB]);
        setQuerySelectorAllResult(childB, FOCUSABLE_SELECTOR, [childBLanding]);
        DOM.sink.focus(childA);

        expect(SpatialNavigation.move('east', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(childBLanding);
    });

    it('reaches the ancestor\'s remembered leaf rather than a geometrically-closer sibling target, when approaching from outside', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const outer = liveHandle();
        const childA = liveHandle(); // would win a flat geometric ranking, but was never focused
        const childALanding = liveHandle();
        const childB = liveHandle(); // farther from outsideOrigin, but was actually last focused
        const elsewhere = liveHandle();
        const outsideOrigin = liveHandle();

        markNavigationTarget(outer);
        markNavigationTarget(childA);
        markNavigationTarget(childB);
        DOM.sink.appendChild(outer, childA);
        DOM.sink.appendChild(outer, childB);

        place(outer, 4, 100, 696, 150);
        // childA/childB are nested in outer, so getElementRect composes their
        // position through it (own width/height, position += outer's) — these
        // local rects resolve to the absolute [208,100,450,150] and
        // [454,100,696,150] respectively, matching the live SplitPanel geometry.
        place(childA, 204, 0, 446, 50);
        place(childB, 450, 0, 692, 50);
        place(elsewhere, 0, 1000, 50, 1020);
        place(outsideOrigin, 4, 0, 597, 20);

        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [outer, childA, childB]);
        setQuerySelectorAllResult(outer, FOCUSABLE_SELECTOR, [childA, childB]);
        // Deliberately gives childA its own landing: if the (unfixed) ranking
        // let childA win outright, this proves it by landing here instead of
        // falling through to outer by accident (an empty landing list would
        // silently mask the bug this test exists to catch).
        setQuerySelectorAllResult(childA, FOCUSABLE_SELECTOR, [childALanding]);

        // Record childB as the row's last focus by focusing it, then moving away.
        DOM.sink.focus(childB);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [childB, elsewhere]);
        SpatialNavigation.move('south', 'component');
        expect(DOM.source.getActiveElement()).toBe(elsewhere);

        // Approach the row from outside: outer is the sole candidate (childA/
        // childB are suppressed as its descendants), and its own remembered
        // descendant — childB — receives focus, not childA, even though
        // childA's rect is the geometrically closest to outsideOrigin.
        DOM.sink.focus(outsideOrigin);
        expect(SpatialNavigation.move('south', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(childB);
    });
});

describe('SpatialNavigation.move — target landing order', () => {
    it('prefers a real descendant over the target\'s own focusable element, when the target itself is also a focus stop', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const target = liveHandle(); // itself focusable — e.g. ToolBar/MenuBar/TabBar's own tabindex="0"
        const firstButton = liveHandle();
        const secondButton = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(target, 0, 80, 100, 100);
        markNavigationTarget(target);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        // The offline harness's `matches()` always reports false (see
        // TestDOM.ts), so `findFocusable` can never take its own
        // root-matches-the-selector branch here — seeding target itself
        // into the querySelectorAll result stands in for that, exactly
        // as if `target` were a real `<div tabindex="0">` wrapping buttons.
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [target, firstButton, secondButton]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(firstButton);
    });

    it('still lands on the target itself when it has no other focusable descendant', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const target = liveHandle(); // a leaf navigation target, e.g. a TextArea marked as its own target

        place(origin, 0, 200, 100, 220);
        place(target, 0, 80, 100, 100);
        markNavigationTarget(target);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [target]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(target);
    });

    it('still prefers a real descendant over the target itself even if the target was somehow recorded as its own last focus', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const target = liveHandle();
        const firstButton = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(target, 0, 80, 100, 100);
        markNavigationTarget(target);
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [target, firstButton]);

        // Focus the target itself, then move away via the component tier —
        // moveFocus records the leaving origin (the target) against every
        // navigation-target ancestor it walks through starting at itself,
        // so `target` ends up recorded against its own key.
        DOM.sink.focus(target);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [target, origin]);
        SpatialNavigation.move('south', 'component');
        expect(DOM.source.getActiveElement()).toBe(origin);

        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(firstButton);
    });
});

describe('SpatialNavigation.move — no genuine origin', () => {
    it('lands on the first component-tier candidate in DOM order for a forward direction, when nothing is focused', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        // Deliberately unplaced (zero rect) — proves the landing is picked
        // by DOM order, not a geometric ranking against <body>'s own rect.
        const first = liveHandle();
        const second = liveHandle();

        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [first, second]);

        expect(DOM.source.getActiveElement()).toBe(null);
        expect(SpatialNavigation.move('south', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(first);
    });

    it('lands on the last component-tier candidate in DOM order for a backward direction, when nothing is focused', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const first = liveHandle();
        const second = liveHandle();

        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [first, second]);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(second);
    });

    it('treats <body> itself holding focus exactly like nothing being focused — real documents default there, never to null', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const first = liveHandle();
        const second = liveHandle();

        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [first, second]);
        DOM.sink.focus(body);

        expect(DOM.source.getActiveElement()).toBe(body);
        expect(SpatialNavigation.move('south', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(first);
    });

    it('applies the same DOM-order fallback to the target tier, still drilling into the first focusable descendant', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const target = liveHandle();
        const firstChild = liveHandle();

        markNavigationTarget(target);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [firstChild]);

        expect(SpatialNavigation.move('south', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(firstChild);
    });
});

describe('SpatialNavigation focus memory', () => {
    it('a disable() / enable() cycle empties the memory: the next target move lands on the first focusable descendant', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const target = liveHandle();
        const remembered = liveHandle();
        const firstChild = liveHandle();
        const elsewhere = liveHandle();

        markNavigationTarget(target);
        DOM.sink.appendChild(target, remembered);
        place(target, 0, 80, 100, 100);
        place(remembered, 0, 85, 50, 95); // origin of the "move away" step below
        place(elsewhere, 0, 200, 100, 220); // south of target/remembered
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [firstChild, remembered]);

        DOM.sink.focus(remembered);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [remembered, elsewhere]);
        SpatialNavigation.enable();
        SpatialNavigation.move('south', 'component');
        expect(DOM.source.getActiveElement()).toBe(elsewhere);

        SpatialNavigation.disable();
        SpatialNavigation.enable();

        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(firstChild);
    });

    it('empties the memory even when the service was never enabled — move() populates it independently of the keyboard listeners', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const target = liveHandle();
        const remembered = liveHandle();
        const firstChild = liveHandle();
        const elsewhere = liveHandle();

        markNavigationTarget(target);
        DOM.sink.appendChild(target, remembered);
        place(target, 0, 80, 100, 100);
        place(remembered, 0, 85, 50, 95); // origin of the "move away" step below
        place(elsewhere, 0, 200, 100, 220); // south of target/remembered
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [firstChild, remembered]);

        // Never calls enable() — move() alone records the memory.
        DOM.sink.focus(remembered);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [remembered, elsewhere]);
        SpatialNavigation.move('south', 'component');
        expect(DOM.source.getActiveElement()).toBe(elsewhere);

        SpatialNavigation.disable();

        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(firstChild);
    });

    it('drops a memory entry whose target element is no longer connected, rather than consulting it — and it stays dropped even after the target reconnects', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const target = liveHandle();
        const remembered = liveHandle();
        const firstChild = liveHandle();
        const elsewhere = liveHandle();

        markNavigationTarget(target);
        DOM.sink.appendChild(target, remembered);
        place(target, 0, 80, 100, 100);
        place(remembered, 0, 85, 50, 95); // origin of the "move away" step below
        place(elsewhere, 0, 200, 100, 220); // south of target/remembered
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [firstChild, remembered]);

        DOM.sink.focus(remembered);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [remembered, elsewhere]);
        SpatialNavigation.move('south', 'component');
        expect(DOM.source.getActiveElement()).toBe(elsewhere);

        setConnected(target, false);
        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(firstChild);

        DOM.sink.focus(elsewhere);
        setConnected(target, true);
        expect(SpatialNavigation.move('north', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(firstChild);
    });

    it('does not walk past documentElement recording memory for an origin mounted outside <body>', () => {
        // e.g. a LayerManager-portaled Window: its root is appended directly
        // onto documentElement (see LayerManager.ts), bypassing <body>
        // entirely, so an origin inside one never reaches the `body` handle
        // recordOrigin used to bound its walk at — it would otherwise run
        // past documentElement into the real `document` node, whose
        // `hasAttribute` is not a function (the exact production crash).
        installTestDOM(CONFIG);
        stableBody(); // never an ancestor of `origin` below
        const documentElement = stableDocumentElement();
        const documentNode = liveHandle(); // stands in for `document` itself
        const overlayRoot   = liveHandle(); // e.g. a Window's portaled root
        const origin         = liveHandle();

        DOM.sink.appendChild(documentNode, documentElement);
        DOM.sink.appendChild(documentElement, overlayRoot);
        DOM.sink.appendChild(overlayRoot, origin);
        place(origin, 0, 200, 100, 220);
        DOM.sink.focus(origin);

        const realHasAttribute = DOM.source.hasAttribute.bind(DOM.source);
        vi.spyOn(DOM.source, 'hasAttribute').mockImplementation((handle: Handle, key: string) => {
            if (handle === documentNode) {
                throw new TypeError('hasAttribute is not a function');
            }

            return realHasAttribute(handle, key);
        });

        expect(() => SpatialNavigation.move('north', 'component')).not.toThrow();
    });
});

// The DOM attribute `moveFocus` mirrors onto its landing element — see
// SpatialNavigation.ts's own FOCUS_VISIBLE_ATTR comment for why it exists
// (Chromium's :focus-visible heuristic excludes a ctrlKey/altKey-modified
// keydown, which both of this service's chords use). Hardcoded here exactly
// like NAVIGATION_TARGET_SELECTOR above, since the module doesn't export it.
const FOCUS_VISIBLE_ATTR = 'data-ts-ui-focus-visible';

describe('SpatialNavigation focus-visible marker', () => {
    it('marks the landing element focus-visible after a successful move', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const nextBest = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(nextBest, 0, 80, 100, 100);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, nextBest]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getAttribute(nextBest, FOCUS_VISIBLE_ATTR)).toBe('true');
    });

    it('does not mark anything when the move fails', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();

        place(origin, 0, 200, 100, 220);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(false);
        expect(DOM.source.getAttribute(origin, FOCUS_VISIBLE_ATTR)).toBe(null);
    });

    it('clears the marker once a focusout fires for the marked element, while the service is enabled', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();
        const body = stableBody();
        const origin = liveHandle();
        const nextBest = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(nextBest, 0, 80, 100, 100);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, nextBest]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getAttribute(nextBest, FOCUS_VISIBLE_ATTR)).toBe('true');

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(nextBest, 'focusout'));
        expect(DOM.source.getAttribute(nextBest, FOCUS_VISIBLE_ATTR)).toBe(null);
    });

    it('a focusout for an element that never carried the marker is a harmless no-op', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();
        const untouched = liveHandle();

        expect(() => {
            DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(untouched, 'focusout'));
        }).not.toThrow();
        expect(DOM.source.getAttribute(untouched, FOCUS_VISIBLE_ATTR)).toBe(null);
    });

    it('does not clear the marker via focusout while the service is disabled', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const nextBest = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(nextBest, 0, 80, 100, 100);
        setQuerySelectorAllResult(body, FOCUSABLE_SELECTOR, [origin, nextBest]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getAttribute(nextBest, FOCUS_VISIBLE_ATTR)).toBe('true');

        // Never enabled in this test, so the focusout listener was never wired.
        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(nextBest, 'focusout'));
        expect(DOM.source.getAttribute(nextBest, FOCUS_VISIBLE_ATTR)).toBe('true');
    });
});
