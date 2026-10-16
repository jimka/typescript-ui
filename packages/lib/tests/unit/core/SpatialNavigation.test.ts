// rankInDirection is a pure function over Rect literals — cases 1-11 need no
// DOM harness at all. The service tests (12-28) reuse FocusTraversal.test.ts's
// offline harness (seedStops-style setQuerySelectorAllResult seeding,
// setRenderedVisible, setConnected, dispatchKeyDown) and the superseded
// directional-panel-navigation plan's module-singleton afterEach pattern.
//
// The control chord (tier 'component') reads its candidates with one query
// over NAVIGATION_CANDIDATE_SELECTOR, so every control-chord test seeds that
// selector, in document order. The region chord (tier 'target') still reads
// NAVIGATION_TARGET_SELECTOR and, inside a target, FOCUSABLE_SELECTOR. The
// cases numbered E-10 to E-34 are the redesign plan's expected-behaviour
// table; each expected landing is derived from the plan's rules (C1-C6, O1,
// S1, SC1, D1, N1), not from what the service returns.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    NAVIGATION_CANDIDATE_SELECTOR, rankInDirection, SpatialNavigation,
    type SpatialCandidate, type SpatialDirection,
} from '~/core/SpatialNavigation';
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

/**
 * `place`, with the rectangle given in page coordinates for a child of an
 * already-placed `parent`: the harness composes a child's rectangle from its
 * parent's, so the parent's own left/top is subtracted first. Appends `child`
 * to `parent`.
 */
function placeIn(parent: Handle, child: Handle, left: number, top: number, right: number, bottom: number): void {
    const parentRect = DOM.source.getElementRect(parent);

    DOM.sink.appendChild(parent, child);
    place(child, left - parentRect.left, top - parentRect.top, right - parentRect.left, bottom - parentRect.top);
}

/**
 * Makes every handle in `handles` a clipping ancestor: the harness reports
 * every computed overflow as `visible`, so nothing is ever clipped offline
 * unless a test says so.
 */
function clipping(...handles: Handle[]): void {
    vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((h: Handle) =>
        handles.includes(h)
            ? { overflow: 'hidden', overflowX: 'hidden', overflowY: 'hidden' }
            : { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' });
}

/** Marks `handle` a navigation group, mirroring `Component.setNavigationGroup(true)`. */
function markNavigationGroup(handle: Handle): void {
    DOM.sink.edit(handle).attr('data-ts-ui-navigation-group', 'true').commit();
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

/**
 * Registers `element` as a bare FocusRevealer (reveal is a no-op). Without
 * `scrollViewport` it stands for a container that reveals by changing state —
 * an `Accordion`, a `Tab` — which the region chord treats as the origin's
 * nearest container and the control chord ignores. With `scrollViewport` it
 * stands for one that reveals by scrolling — a `Panel`, a `ScrollStrip` — and
 * that element becomes a search level of the control chord.
 */
function registerFakeRevealer(element: Handle, scrollViewport?: Handle): void {
    const revealer: FocusRevealer = { getRevealElement: () => element, revealDescendant: () => {} };

    if (scrollViewport !== undefined) {
        revealer.getScrollViewportElement = () => scrollViewport;
    }

    FocusReveal.register(revealer);
    _registeredRevealers.push(revealer);
}

// Layers registered by the current test — unregistered in afterEach, since
// LayerManager is a module singleton.
let _registeredLayers: DismissableLayer[] = [];

/** Registers a floating window (dismiss mode `manual`) whose element is `element`. */
function registerWindowLayer(element: Handle): DismissableLayer {
    const layer: DismissableLayer = { getLayerElement: () => element, getDismissMode: () => 'manual', requestClose: () => {} };

    LayerManager.register(layer);
    _registeredLayers.push(layer);

    return layer;
}

/** Every handle in `handles` that carries the service's focus-visible marker. */
function focusVisibleMarked(handles: Handle[]): Handle[] {
    return handles.filter(h => DOM.source.getAttribute(h, 'data-ts-ui-focus-visible') !== null);
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
    _registeredLayers.forEach(layer => LayerManager.unregister(layer));
    _registeredLayers = [];

    SpatialNavigation.disable();
    SpatialNavigation.configure({ componentModifiers: { ctrl: true, alt: true }, targetModifiers: { ctrl: true, alt: true, shift: true } });
    // `FocusReveal` is a module namespace, not part of the DOM seam, so a spy
    // on it outlives `DOM.reset()` and would leak its recorded calls — and its
    // mock implementation — into every later test.
    vi.restoreAllMocks();
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
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true, shiftKey: true }))).toBe(false);
    });

    it('once enabled with defaults, claims Ctrl+Alt+Arrow* and Ctrl+Alt+Shift+Arrow*, and refuses a bare arrow, Ctrl-only, Shift-only, Alt-only, Ctrl+Shift, and a non-arrow code', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowUp', ctrlKey: true, altKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowDown', ctrlKey: true, altKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowLeft', ctrlKey: true, altKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true, shiftKey: true }))).toBe(true);

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight' }))).toBe(false);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true }))).toBe(false);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', shiftKey: true }))).toBe(false);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowLeft', ctrlKey: true, shiftKey: true }))).toBe(false);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, shiftKey: true }))).toBe(false);
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
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true, shiftKey: true }))).toBe(true);

        SpatialNavigation.configure({ componentModifiers: { ctrl: true, alt: true }, targetModifiers: { meta: true } });

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', metaKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true, shiftKey: true }))).toBe(false);
        // The component tier's reconfigured set is untouched by the target reconfigure.
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true }))).toBe(true);
    });

    it('configure({ targetModifiers }) with the old Ctrl+Shift set restores it, and no longer claims the new default', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();

        SpatialNavigation.configure({ targetModifiers: { ctrl: true, shift: true } });

        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, shiftKey: true }))).toBe(true);
        expect(SpatialNavigation.claimsKey(keyEvent({ code: 'ArrowRight', ctrlKey: true, altKey: true, shiftKey: true }))).toBe(false);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, plainCandidate]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin]);
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

    it('leaves Ctrl+Shift+arrow — the superseded target-tier chord — unclaimed, preserving native word selection', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();

        const body = stableBody();
        const origin = liveHandle();
        const target = liveHandle();
        const targetChild = liveHandle();

        place(origin, 0, 0, 100, 20);
        place(target, 200, 0, 300, 20); // east of origin
        markNavigationTarget(target);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target]);
        // A focusable descendant, so the target tier has somewhere to land —
        // without it, "focus stays on the origin" would hold regardless of
        // whether the chord was claimed, since a claimed-but-landing-nowhere
        // move also leaves the origin focused.
        setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [targetChild]);
        DOM.sink.focus(origin);

        const event = dispatchKeyDown({ code: 'ArrowRight', ctrlKey: true, shiftKey: true });

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(origin);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, near, far]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, candidate]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, nearestButHidden, nextBest]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, nextBest]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, refuses, accepts]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, container, button]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, tabButton, closeButton]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, tableBody, checkboxCell]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(tableBody);
    });

    it('reaches a roving-tabindex member roved to tabindex="-1" that renders as no native focusable tag', () => {
        // e.g. a ToolBar holding several ComboBoxes: only the active one has
        // tabindex="0" and matches FOCUSABLE_SELECTOR; its DIV-rooted siblings
        // are roved to "-1" and are found by the roving-member half of
        // NAVIGATION_CANDIDATE_SELECTOR instead.
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();   // the toolbar's active ComboBox
        const rovedOff = liveHandle(); // a sibling ComboBox at tabindex="-1"

        place(origin, 0, 200, 100, 220);
        place(rovedOff, 0, 160, 100, 180); // directly north, nearest
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, rovedOff]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, disabledSibling]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('E-23: excludes a candidate a collapsed ancestor is currently clipping to nothing, preferring a genuinely visible one instead', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const collapsedWrapper = liveHandle(); // e.g. an Accordion section's height-animated wrapper
        const phantom = liveHandle();          // its content — keeps its ordinary, unclipped rect
        const visible = liveHandle();          // genuinely visible, farther away

        place(origin, 0, 200, 100, 220);
        place(collapsedWrapper, 0, 150, 100, 150); // collapsed to zero height
        placeIn(collapsedWrapper, phantom, 0, 150, 100, 200); // deceptively adjacent to the origin
        place(visible, 0, 80, 100, 100);
        clipping(collapsedWrapper);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, phantom, visible]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(visible);
    });

    // E-24 runs E-23's layout with the wrapper open by a few pixels.
    it.each([
        // 2px of the 50px-tall phantom show: under the 4px floor (MIN_VISIBLE_PX), so it is not a candidate.
        { wrapperHeight: 2, lands: 'visible' as const },
        // 10px show. Measured by the visible part (0, 150, 100, 160) the
        // phantom is 40px north of the origin, nearer than `visible` at 100.
        { wrapperHeight: 10, lands: 'phantom' as const },
    ])('E-24: with $wrapperHeight px of a clipped candidate showing, a north move lands on $lands', ({ wrapperHeight, lands }) => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const wrapper = liveHandle();
        const phantom = liveHandle();
        const visible = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(wrapper, 0, 150, 100, 150 + wrapperHeight);
        placeIn(wrapper, phantom, 0, 150, 100, 200);
        place(visible, 0, 80, 100, 100);
        clipping(wrapper);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, phantom, visible]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(lands === 'phantom' ? phantom : visible);
    });

    it('E-24: the half-hidden candidate is measured by the half that shows, not by its own rectangle', () => {
        // The phantom's own rectangle (0, 150, 100, 215) straddles the
        // origin's top edge by 15px, so measured whole it is not ahead at
        // all. Its visible part (0, 150, 100, 160) is.
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const wrapper = liveHandle();
        const phantom = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(wrapper, 0, 150, 100, 160);
        placeIn(wrapper, phantom, 0, 150, 100, 215);
        clipping(wrapper);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, phantom]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(phantom);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, oversized]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [oversizedOrigin, eastNeighbour]);
        DOM.sink.focus(oversizedOrigin);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(eastNeighbour);
    });

    it('measures a candidate appended directly under documentElement without the clip walk reading past documentElement', () => {
        // e.g. a control portaled onto the document root, outside <body>. The
        // walk that collects a candidate's clipping ancestors must stop at
        // `documentElement`: one step further is the `document` node itself,
        // on which `getComputedStyle` throws.
        installTestDOM(CONFIG);
        const body = stableBody();
        const documentElement = stableDocumentElement();
        const documentNode = liveHandle(); // stands in for `document` itself
        const origin = liveHandle();
        const candidate = liveHandle();

        DOM.sink.appendChild(documentNode, documentElement);
        DOM.sink.appendChild(documentElement, candidate);
        place(origin, 0, 200, 100, 220);
        place(candidate, 0, 80, 100, 100);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, candidate]);
        DOM.sink.focus(origin);

        const realGetComputedOverflow = DOM.source.getComputedOverflow.bind(DOM.source);
        vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((handle: Handle) => {
            if (handle === documentNode) {
                throw new TypeError('getComputedStyle is not a function');
            }

            return realGetComputedOverflow(handle);
        });

        expect(() => SpatialNavigation.move('north', 'component')).not.toThrow();
        expect(DOM.source.getActiveElement()).toBe(candidate);
    });
});

describe('SpatialNavigation.move — scroll viewports', () => {
    // A control scrolled out of the focused control's own scrolling panel is
    // still the next control that way: it is reached at the panel's level and
    // scrolled into view on landing (rule V1). Reproduces the MiscPanel
    // left-column case: Ctrl+Alt+Up jumped into the app's tab bar instead of
    // continuing to the next (scrolled-off) button in the same scrolling Panel.
    it('E-20: reaches a sibling scrolled out of the origin\'s own scroll viewport ahead of an outside candidate, and reveals it only after it took focus', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const origin = liveHandle();
        const sibling = liveHandle(); // scrolled above the viewport's top edge
        const outside = liveHandle(); // outside the viewport, and nearer in raw page coordinates

        place(viewport, 0, 40, 230, 400);
        placeIn(viewport, origin, 8, 214, 218, 243);
        placeIn(viewport, sibling, 8, -25, 170, 4);
        place(outside, 109, 0, 131, 31);
        clipping(viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, sibling, outside]);
        DOM.sink.focus(origin);

        const order: string[] = [];

        vi.spyOn(FocusReveal, 'reveal').mockImplementation((h: Handle) => {
            order.push('reveal:' + h);

            return true;
        });

        const realFocus = DOM.sink.focus.bind(DOM.sink);
        vi.spyOn(DOM.sink, 'focus').mockImplementation((h: Handle, options?: { preventScroll?: boolean }) => {
            order.push('focus:' + h);
            realFocus(h, options);
        });

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(sibling);
        expect(order).toEqual(['focus:' + sibling, 'reveal:' + sibling]);
    });

    it('E-21: leaves the scroll viewport for an outside candidate once nothing inside it lies that way', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const origin = liveHandle(); // the only control inside the viewport
        const outside = liveHandle();

        place(viewport, 0, 40, 230, 400);
        placeIn(viewport, origin, 8, 214, 218, 243);
        place(outside, 109, 0, 131, 31);
        clipping(viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, outside]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(outside);
    });

    it('E-22: a control scrolled out of a scroll viewport that does not contain the origin is not a candidate', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const hidden = liveHandle(); // scrolled above the viewport's top edge
        const origin = liveHandle(); // outside the viewport

        place(viewport, 280, 100, 600, 400);
        placeIn(viewport, hidden, 300, 10, 400, 30);
        place(origin, 300, 60, 400, 80);
        clipping(viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [hidden, origin]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('a container that reveals by changing state, not by scrolling, is not a search level — the move is ranked at the search root', () => {
        // The container stands for an Accordion: a registered FocusRevealer
        // with no scroll viewport. `inside` is in line and 160px north.
        // `outside` is 20px north and 14px to the side — in the cone, scoring
        // 20 + 2 x (14 + 19) = 86 — so it wins on geometry. Ranking the
        // container's own candidates first would pick `inside`.
        installTestDOM(CONFIG);
        const body = stableBody();
        const container = liveHandle();
        const origin = liveHandle();
        const inside = liveHandle();
        const outside = liveHandle();

        place(container, 0, 100, 230, 400);
        placeIn(container, origin, 180, 300, 218, 330);
        placeIn(container, inside, 180, 110, 218, 140);
        place(outside, 232, 250, 300, 280);
        registerFakeRevealer(container);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, inside, outside]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(outside);
    });

    it('a control clipped away by something inside the scroll viewport is not readmitted by it', () => {
        // The viewport contains both controls, but `folded` sits in a
        // collapsed section inside it: scrolling the viewport cannot show it.
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const collapsedSection = liveHandle();
        const origin = liveHandle();
        const folded = liveHandle();

        place(viewport, 0, 40, 230, 400);
        placeIn(viewport, origin, 8, 214, 218, 243);
        placeIn(viewport, collapsedSection, 8, 150, 218, 150);
        placeIn(collapsedSection, folded, 8, 150, 218, 180);
        clipping(viewport, collapsedSection);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, folded]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });
});

// SQLAdmin's sidebar and dock at a 1500 x 850 window — the layout the
// redesign was written against. Rectangles are (left, top, right, bottom) in
// page coordinates. A group is one row of related controls (a menu bar, an
// accordion header, a tab strip, a tool bar); it carries the navigation-group
// marker and is not itself a candidate.
const SIDEBAR_CONFIG = { ...CONFIG, viewport: { width: 1500, height: 850 } };

type Edges = [left: number, top: number, right: number, bottom: number];

type SidebarGroup = 'menuBar' | 'header0' | 'header1' | 'tabBar' | 'queryToolbar' | 'resultToolbar';

const SIDEBAR_GROUPS: Record<SidebarGroup, Edges> = {
    menuBar:       [0, 33, 1500, 57],
    header0:       [41, 59, 279, 81],
    header1:       [41, 587, 279, 609],
    tabBar:        [280, 57, 1500, 81],
    queryToolbar:  [280, 81, 1500, 103],
    resultToolbar: [280, 282, 1500, 310],
};

type SidebarControl =
    | 'menuQuery' | 'databaseTitle' | 'createSchema' | 'showDiagram' | 'refresh' | 'tree'
    | 'propertiesTitle' | 'columnOptions' | 'tableBody' | 'dockTab' | 'runQuery' | 'formatQuery'
    | 'saveQuery' | 'editor' | 'recordView' | 'resultBody';

// In document order — the order the service's one query returns them in.
const SIDEBAR_CONTROLS: ReadonlyArray<{ name: SidebarControl; rect: Edges; group: SidebarGroup | null }> = [
    { name: 'menuQuery',       rect: [48, 33, 100, 57],     group: 'menuBar' },
    { name: 'databaseTitle',   rect: [47, 59, 181, 81],     group: 'header0' },
    { name: 'createSchema',    rect: [183, 59, 205, 81],    group: 'header0' },
    { name: 'showDiagram',     rect: [209, 59, 231, 81],    group: 'header0' },
    { name: 'refresh',         rect: [235, 59, 257, 81],    group: 'header0' },
    { name: 'tree',            rect: [41, 81, 279, 585],    group: null },
    { name: 'propertiesTitle', rect: [47, 587, 257, 609],   group: 'header1' },
    { name: 'columnOptions',   rect: [262, 614, 274, 634],  group: null },
    { name: 'tableBody',       rect: [46, 635, 274, 824],   group: null },
    { name: 'dockTab',         rect: [281, 57, 380, 81],    group: 'tabBar' },
    { name: 'runQuery',        rect: [284, 83, 306, 101],   group: 'queryToolbar' },
    { name: 'formatQuery',     rect: [310, 83, 332, 101],   group: 'queryToolbar' },
    { name: 'saveQuery',       rect: [336, 83, 358, 101],   group: 'queryToolbar' },
    { name: 'editor',          rect: [331, 103, 890, 253],  group: null },
    { name: 'recordView',      rect: [280, 284, 300, 308],  group: 'resultToolbar' },
    { name: 'resultBody',      rect: [280, 310, 1500, 829], group: null },
];

// Every control in the dock — the area right of the sidebar.
const DOCK_CONTROLS: SidebarControl[] = [
    'dockTab', 'runQuery', 'formatQuery', 'saveQuery', 'editor', 'recordView', 'resultBody',
];

interface Sidebar {
    body:     Handle;
    controls: Record<SidebarControl, Handle>;
}

/**
 * Installs the harness and builds the sidebar fixture, leaving the controls
 * named in `omit` out of the page entirely.
 */
function buildSidebar(omit: SidebarControl[] = []): Sidebar {
    installTestDOM(SIDEBAR_CONFIG);

    const body = stableBody();
    const groups = {} as Record<SidebarGroup, Handle>;

    for (const name of Object.keys(SIDEBAR_GROUPS) as SidebarGroup[]) {
        groups[name] = liveHandle();
        place(groups[name], ...SIDEBAR_GROUPS[name]);
        markNavigationGroup(groups[name]);
    }

    const controls = {} as Record<SidebarControl, Handle>;
    const seeded: Handle[] = [];

    for (const { name, rect, group } of SIDEBAR_CONTROLS) {
        controls[name] = liveHandle();

        const omitted = omit.includes(name);

        if (omitted) {
            continue;
        }

        if (group === null) {
            place(controls[name], ...rect);
        } else {
            placeIn(groups[group], controls[name], ...rect);
        }

        seeded.push(controls[name]);
    }

    setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, seeded);

    return { body, controls };
}

/**
 * Focuses `start`, then presses the control chord `presses` times in
 * `direction`. Returns, per press, the name of the control focus landed on —
 * or `null` when the move returned false.
 */
function walk(sidebar: Sidebar, start: SidebarControl, direction: SpatialDirection, presses: number): Array<SidebarControl | null> {
    const names = Object.keys(sidebar.controls) as SidebarControl[];
    const landings: Array<SidebarControl | null> = [];

    DOM.sink.focus(sidebar.controls[start]);

    for (let press = 0; press < presses; press++) {
        const moved = SpatialNavigation.move(direction, 'component');
        const active = DOM.source.getActiveElement();

        landings.push(moved ? names.find(name => sidebar.controls[name] === active) ?? null : null);
    }

    return landings;
}

/** Points `owner`'s `aria-activedescendant` at a new child placed at the given page rectangle. */
function setActiveDescendant(owner: Handle, id: string, left: number, top: number, right: number, bottom: number): Handle {
    const child = liveHandle();

    placeIn(owner, child, left, top, right, bottom);
    DOM.sink.edit(child).attr('id', id).commit();
    DOM.sink.edit(owner).attr('aria-activedescendant', id).commit();

    return child;
}

describe('SpatialNavigation.move — scroll viewports, what may be reached', () => {
    it('a control inside the scroll viewport\'s box that is beyond the browser window is not readmitted — scrolling cannot show it', () => {
        // The viewport hangs 200px below the 800px-tall window. `offWindow`
        // is inside the viewport's own box, so revealing it scrolls nothing.
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const origin = liveHandle();
        const offWindow = liveHandle();

        place(viewport, 0, 600, 300, 1000);
        placeIn(viewport, origin, 10, 700, 110, 720);
        placeIn(viewport, offWindow, 10, 900, 110, 920);
        clipping(viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, offWindow]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('south', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('a control inside the scroll viewport\'s box that an ancestor outside the viewport clips away is not readmitted', () => {
        // The viewport overflows a parent that clips it: `cut` is inside the
        // viewport's box but below the parent's bottom edge.
        installTestDOM(CONFIG);
        const body = stableBody();
        const outer = liveHandle();
        const viewport = liveHandle();
        const origin = liveHandle();
        const cut = liveHandle();

        place(outer, 0, 100, 300, 300);
        placeIn(outer, viewport, 0, 100, 300, 500);
        placeIn(viewport, origin, 10, 150, 110, 170);
        placeIn(viewport, cut, 10, 400, 110, 420);
        clipping(outer, viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, cut]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('south', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('a control scrolled out of a viewport is still reached when the viewport is only partly on screen and the control would scroll into the part that shows', () => {
        // The viewport's top 200px show. `above` is scrolled out past the
        // viewport's top edge; revealed, it sits at the top of the viewport,
        // which is on screen.
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const origin = liveHandle();
        const above = liveHandle();

        place(viewport, 0, 600, 300, 1000);
        placeIn(viewport, origin, 10, 700, 110, 720);
        placeIn(viewport, above, 10, 540, 110, 560);
        clipping(viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, above]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(above);
    });

    it('an origin wheeled wholly out of its panel still reaches the next in-line control in the panel', () => {
        // The focused button has been scrolled above the panel's top edge.
        // At the panel's level the move starts from the button's own place
        // in the content, so the button below it — in view — is next. From
        // the panel's visible box, which contains that button, nothing
        // would be ahead.
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const origin = liveHandle();
        const next = liveHandle();

        place(viewport, 0, 100, 200, 400);
        placeIn(viewport, origin, 10, 20, 110, 40);
        placeIn(viewport, next, 10, 150, 110, 170);
        clipping(viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, next]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('south', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(next);
    });

    it('a scroll viewport is skipped when the origin has no extent inside it — an origin in a collapsed section does not reach a scrolled-out control', () => {
        // The origin sits in a section collapsed to zero height inside the
        // panel. `scrolledOut` is above the panel's top edge and in line.
        // The origin has no place in the panel's content to measure from,
        // so the panel's level is skipped and nothing else qualifies.
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const collapsedSection = liveHandle();
        const origin = liveHandle();
        const scrolledOut = liveHandle();

        place(viewport, 0, 100, 200, 400);
        placeIn(viewport, collapsedSection, 0, 300, 200, 300);
        placeIn(collapsedSection, origin, 10, 300, 110, 320);
        placeIn(viewport, scrolledOut, 10, 20, 110, 40);
        clipping(viewport, collapsedSection);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, scrolledOut]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('at a scroll viewport\'s level a control is measured as content of the viewport, not by the part that shows', () => {
        // A panel scrolled sideways. The origin is wholly past the panel's
        // right edge; `partly` straddles that edge, so 10px of it show. The
        // two overlap only in the part of `partly` that is scrolled out, so
        // they are in line as content and not in line by what shows.
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const origin = liveHandle();
        const partly = liveHandle();

        place(viewport, 0, 100, 200, 400);
        placeIn(viewport, origin, 210, 300, 260, 320);
        placeIn(viewport, partly, 190, 150, 300, 170);
        clipping(viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, partly]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(partly);
    });

    it('a scroll viewport none of which is on screen is skipped — nothing inside it can show', () => {
        // The whole panel sits in a section collapsed to zero height inside
        // a visible page area. Focus is still on a button in it; the button
        // beside it in the panel must not take focus.
        installTestDOM(CONFIG);
        const body = stableBody();
        const page = liveHandle();
        const collapsedSection = liveHandle();
        const viewport = liveHandle();
        const origin = liveHandle();
        const beside = liveHandle();

        place(page, 0, 100, 400, 500);
        placeIn(page, collapsedSection, 0, 200, 400, 200);
        placeIn(collapsedSection, viewport, 0, 200, 400, 400);
        placeIn(viewport, origin, 10, 250, 110, 270);
        placeIn(viewport, beside, 200, 250, 300, 270);
        clipping(page, collapsedSection, viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, beside]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('east', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('at a scroll viewport\'s level the origin too is measured as content of the viewport', () => {
        // The mirror of the case above: the origin straddles the panel's
        // right edge with 10px showing, and `hidden` is wholly past that
        // edge. They overlap only in the part of the origin that is
        // scrolled out.
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const origin = liveHandle();
        const hidden = liveHandle();

        place(viewport, 0, 100, 200, 400);
        placeIn(viewport, origin, 190, 300, 300, 320);
        placeIn(viewport, hidden, 250, 150, 350, 170);
        clipping(viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, hidden]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(hidden);
    });
});

describe('SpatialNavigation.move — control chord on the SQLAdmin sidebar', () => {
    it('E-10: east along the Database header reaches each tool button, then the dock tab in the same row, then stays put', () => {
        const sidebar = buildSidebar();

        expect(walk(sidebar, 'createSchema', 'east', 4)).toEqual(['showDiagram', 'refresh', 'dockTab', null]);
        expect(DOM.source.getActiveElement()).toBe(sidebar.controls.dockTab);
    });

    it('E-10: the same walk from a fresh fixture gives the same sequence', () => {
        const first = walk(buildSidebar(), 'createSchema', 'east', 4);

        SpatialNavigation.disable();
        DOM.reset();

        const second = walk(buildSidebar(), 'createSchema', 'east', 4);

        expect(second).toEqual(first);
    });

    it('E-11: with no tab in the header\'s row, east from Refresh lands on the nearest control in the cone', () => {
        const sidebar = buildSidebar(['dockTab']);

        expect(walk(sidebar, 'createSchema', 'east', 3)).toEqual(['showDiagram', 'refresh', 'runQuery']);
    });

    it('E-12: with nothing in the dock, east from Refresh stays put — never the three-dots button 530px below', () => {
        const sidebar = buildSidebar(DOCK_CONTROLS);
        const all = Object.values(sidebar.controls);

        DOM.sink.focus(sidebar.controls.refresh);

        const focusSpy = vi.spyOn(DOM.sink, 'focus');
        const blurSpy = vi.spyOn(DOM.sink, 'blur');
        const revealSpy = vi.spyOn(FocusReveal, 'reveal');

        expect(SpatialNavigation.move('east', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(sidebar.controls.refresh);
        expect(focusSpy).not.toHaveBeenCalled();
        expect(blurSpy).not.toHaveBeenCalled();
        expect(revealSpy).not.toHaveBeenCalled();
        expect(focusVisibleMarked(all)).toEqual([]);
    });

    it('E-13: west from the SQL editor lands on the tree beside it, not the Record view button below-left', () => {
        const sidebar = buildSidebar();

        expect(walk(sidebar, 'editor', 'west', 1)).toEqual(['tree']);
    });

    it('E-14: west along the Database header walks back to the title, then stays put', () => {
        const sidebar = buildSidebar();

        expect(walk(sidebar, 'refresh', 'west', 4)).toEqual(['showDiagram', 'createSchema', 'databaseTitle', null]);
        expect(DOM.source.getActiveElement()).toBe(sidebar.controls.databaseTitle);
    });

    it('E-15: south from the menu bar walks straight down the sidebar', () => {
        const sidebar = buildSidebar();

        expect(walk(sidebar, 'menuQuery', 'south', 4)).toEqual(['databaseTitle', 'tree', 'propertiesTitle', 'tableBody']);
    });

    it('E-16: north from the Properties table walks back up, taking in the three-dots button on the way', () => {
        const sidebar = buildSidebar();

        expect(walk(sidebar, 'tableBody', 'north', 5))
            .toEqual(['columnOptions', 'propertiesTitle', 'tree', 'databaseTitle', 'menuQuery']);
    });

    it('E-17: a table moves from its focused cell — north from a left-hand cell reaches the title above it', () => {
        const sidebar = buildSidebar();

        setActiveDescendant(sidebar.controls.tableBody, 'cell-left', 46, 635, 166, 656);

        expect(walk(sidebar, 'tableBody', 'north', 1)).toEqual(['propertiesTitle']);
    });

    it('E-17: north from a right-hand cell reaches the three-dots button above it', () => {
        const sidebar = buildSidebar();

        setActiveDescendant(sidebar.controls.tableBody, 'cell-right', 166, 635, 274, 656);

        expect(walk(sidebar, 'tableBody', 'north', 1)).toEqual(['columnOptions']);
    });

    it('E-18: a tree with no current row moves from its whole box — equal scores go to the first in document order', () => {
        const sidebar = buildSidebar();

        // recordView and resultBody both score 1; recordView comes first.
        expect(walk(sidebar, 'tree', 'east', 1)).toEqual(['recordView']);
    });

    it('E-18: a tree moves from its current row — east lands on the control level with that row', () => {
        const sidebar = buildSidebar();

        setActiveDescendant(sidebar.controls.tree, 'row-current', 41, 150, 279, 174);

        expect(walk(sidebar, 'tree', 'east', 1)).toEqual(['editor']);
    });

    it('a tree with a current row still leaves through its own edge — south lands on the control below the tree, not on one beside the row', () => {
        // The plan's manual steps 3 and 9: click a tree row, press down,
        // land on the Properties title. Measured from the row itself
        // (41, 150, 279, 174) the title is 413px away, and the Record view
        // button in the dock — 1px to the side, so inside the cone — scores
        // 350 and would win. The row fixes where the move starts across the
        // arrow; along the arrow it starts from the tree's bottom edge.
        const sidebar = buildSidebar();

        setActiveDescendant(sidebar.controls.tree, 'row-current', 41, 150, 279, 174);

        expect(walk(sidebar, 'tree', 'south', 1)).toEqual(['propertiesTitle']);
    });

    it('a tree with a current row leaves north through its top edge', () => {
        const sidebar = buildSidebar();

        setActiveDescendant(sidebar.controls.tree, 'row-current', 41, 500, 279, 524);

        expect(walk(sidebar, 'tree', 'north', 1)).toEqual(['databaseTitle']);
    });

    it('E-19: south from a tool bar button reaches the editor below the bar — in line with the bar, though not with the button', () => {
        const sidebar = buildSidebar();

        expect(walk(sidebar, 'runQuery', 'south', 1)).toEqual(['editor']);
    });
});

describe('SpatialNavigation.move — control chord candidates', () => {
    it('E-25: a control outside the browser window is not a candidate', () => {
        installTestDOM(CONFIG); // viewport 1280 x 800
        const body = stableBody();
        const origin = liveHandle();
        const below = liveHandle();

        place(origin, 0, 700, 100, 720);
        place(below, 0, 900, 100, 920);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, below]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('south', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('E-26: a control with zero height is not a candidate', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const thin = liveHandle();
        const real = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(thin, 0, 100, 100, 100); // nearer, but zero height
        place(real, 0, 40, 100, 60);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, thin, real]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(real);
    });

    it('a control smaller than MIN_VISIBLE_PX is a candidate when its whole extent shows', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const tiny = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(tiny, 40, 100, 43, 102); // 3 x 2, wholly on screen
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, tiny]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(tiny);
    });

    it('E-27: a roving member with aria-disabled="true" is not a candidate', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const member = liveHandle(); // e.g. a disabled ComboBox in a ToolBar
        const other = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(member, 0, 150, 100, 170); // nearer
        place(other, 0, 80, 100, 100);
        markRovingMember(member);
        DOM.sink.edit(member).attr('aria-disabled', 'true').commit();
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, member, other]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(other);
    });

    it('aria-disabled="false" leaves a control a candidate', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const member = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(member, 0, 150, 100, 170);
        DOM.sink.edit(member).attr('aria-disabled', 'false').commit();
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, member]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(member);
    });

    it('E-30: a candidate that refuses focus is passed over and is never scrolled into view', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const near = liveHandle();
        const far = liveHandle();

        place(origin, 0, 200, 100, 220);
        place(near, 0, 150, 100, 170);
        place(far, 0, 80, 100, 100);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, near, far]);
        DOM.sink.focus(origin);

        const realFocus = DOM.sink.focus.bind(DOM.sink);
        vi.spyOn(DOM.sink, 'focus').mockImplementation((h: Handle, options?: { preventScroll?: boolean }) => {
            if (h === near) {
                return; // refuses focus
            }

            realFocus(h, options);
        });

        const revealSpy = vi.spyOn(FocusReveal, 'reveal');

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(far);
        expect(revealSpy).not.toHaveBeenCalledWith(near);
        expect(revealSpy).toHaveBeenCalledWith(far);
        expect(focusVisibleMarked([origin, near, far])).toEqual([far]);
    });

    it('a control inside the focused widget is never ahead of it, even when the move starts from the widget\'s current cell', () => {
        // A table body whose current cell is in its first row, with a
        // boolean column's checkbox two rows down — a real <input>, so the
        // leaf filter keeps it. Measured from the cell it lies south; it is
        // still part of the widget focus is already on.
        installTestDOM(CONFIG);
        const body = stableBody();
        const tableBody = liveHandle();
        const checkbox = DOM.sink.createElement('input');
        const below = liveHandle();

        setConnected(checkbox, true);
        place(tableBody, 0, 100, 200, 300);
        placeIn(tableBody, checkbox, 10, 160, 26, 176);
        place(below, 0, 320, 200, 340);
        setActiveDescendant(tableBody, 'cell-first', 0, 100, 100, 120);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [tableBody, checkbox, below]);
        DOM.sink.focus(tableBody);

        expect(SpatialNavigation.move('south', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(below);
    });

    it('a candidate inside the focused control is never ahead of it, even when it is laid out beyond the control\'s own box', () => {
        // A focusable child the widget lays out below its own box — a
        // widget that does not clip. Geometry alone would put it 20px south
        // and in line.
        installTestDOM(CONFIG);
        const body = stableBody();
        const widget = liveHandle();
        const spilled = DOM.sink.createElement('button');
        const below = liveHandle();

        setConnected(spilled, true);
        place(widget, 0, 100, 200, 300);
        placeIn(widget, spilled, 0, 320, 200, 340);
        place(below, 0, 360, 200, 380);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [widget, spilled, below]);
        DOM.sink.focus(widget);

        expect(SpatialNavigation.move('south', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(below);
    });

    it('a candidate that contains the focused control is never ahead of it, even when its own box lies ahead', () => {
        // A focusable container whose child — the origin — is laid out
        // outside the container's own box. Geometry alone would put the
        // container 100px east and in line.
        installTestDOM(CONFIG);
        const body = stableBody();
        const container = liveHandle();
        const origin = liveHandle();
        const beyond = liveHandle();

        place(container, 200, 0, 260, 20);
        placeIn(container, origin, 0, 0, 100, 20);
        place(beyond, 400, 0, 460, 20);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [container, origin, beyond]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(beyond);
    });

    it('<body> is never a clipping ancestor, even when it reports overflow: hidden over a zero-height box', () => {
        // A page whose body has `overflow: hidden` and no height reports a
        // zero-height body while its absolutely positioned content fills the
        // window. The browser window stands in for it.
        installTestDOM(CONFIG);
        const body = stableBody(); // never placed: its rectangle is the zero rect
        const origin = liveHandle();
        const above = liveHandle();

        DOM.sink.appendChild(body, origin);
        DOM.sink.appendChild(body, above);
        place(origin, 0, 200, 100, 220);
        place(above, 0, 80, 100, 100);
        clipping(body);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, above]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(above);
    });

    it('an aria-activedescendant that names an element outside the focused control is ignored — the move starts from the control', () => {
        // An AutoCompleteField's active descendant lives in a dropdown
        // elsewhere on the page. Measured from the option, `aboveOption`
        // would be the nearest control north; measured from the field it is
        // not ahead at all.
        installTestDOM(CONFIG);
        const body = stableBody();
        const field = liveHandle();
        const option = liveHandle();
        const aboveField = liveHandle();
        const aboveOption = liveHandle();

        place(field, 0, 200, 100, 220);
        place(option, 500, 500, 600, 520);
        place(aboveField, 0, 80, 100, 100);
        place(aboveOption, 500, 400, 600, 420);
        DOM.sink.edit(option).attr('id', 'option-1').commit();
        DOM.sink.edit(field).attr('aria-activedescendant', 'option-1').commit();
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [field, aboveField, aboveOption]);
        DOM.sink.focus(field);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(aboveField);
    });

    it('E-31: a focused control scrolled out of sight moves from the visible box of its nearest ancestor that has one', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const panel = liveHandle();
        const origin = liveHandle();
        const target = liveHandle();

        place(panel, 0, 100, 200, 300);
        placeIn(panel, origin, 10, 20, 110, 40); // above the panel's top edge: no view rectangle
        place(target, 260, 250, 320, 270);
        clipping(panel);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, target]);
        DOM.sink.focus(origin);

        // From the origin's own rectangle (10, 20, 110, 40) the target is
        // 150px forward and 210px to the side: not in line and outside the
        // cone, so a move measured from there would stay put. From the
        // panel's box (0, 100, 200, 300) it is in line. The plan's E-31
        // places the target at (260, 150, 320, 170), which is inside the
        // cone of the raw rectangle too and so cannot tell the two apart.
        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(target);
    });

    it('a current row that is scrolled out of its widget is ignored — the move starts from the widget\'s own box', () => {
        // A tree whose current row has been wheeled out of view. From the
        // row's raw rectangle (0, 20, 200, 44) the target is 60px forward
        // and 206px to the side — outside the cone; from the tree's box it
        // is in line.
        installTestDOM(CONFIG);
        const body = stableBody();
        const tree = liveHandle();
        const target = liveHandle();

        place(tree, 0, 100, 200, 300);
        setActiveDescendant(tree, 'row-hidden', 0, 20, 200, 44);
        place(target, 260, 250, 320, 270);
        clipping(tree);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [tree, target]);
        DOM.sink.focus(tree);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(target);
    });
});

describe('SpatialNavigation.move — control chord groups', () => {
    /** Builds E-32's menu bar layout; returns its handles. */
    function buildMenuBar(markGroup: boolean): { view: Handle; about: Handle; tool: Handle } {
        installTestDOM(CONFIG);
        const body = stableBody();
        const bar = liveHandle();
        const view = liveHandle();
        const about = liveHandle();
        const tool = liveHandle();

        place(bar, 0, 0, 1000, 24);
        placeIn(bar, view, 90, 0, 140, 24);
        placeIn(bar, about, 900, 0, 950, 24);
        place(tool, 145, 26, 175, 50); // just below-right of `view`

        if (markGroup) {
            markNavigationGroup(bar);
        }

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [view, about, tool]);
        DOM.sink.focus(view);

        return { view, about, tool };
    }

    it('E-32: inside a group the row continues — east reaches the far menu, not the nearer button on the row below', () => {
        const { about } = buildMenuBar(true);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(about);
    });

    it('E-32: without the group mark the same move is decided by geometry alone', () => {
        // tool: forward 5, side gap 2, half extent 12 -> 5 + 2 x (2 + 12) = 33. about: 760.
        const { tool } = buildMenuBar(false);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(tool);
    });

    it('when every accepted candidate of a group refuses focus, the search continues outside the group', () => {
        const { about, tool } = buildMenuBar(true);

        const realFocus = DOM.sink.focus.bind(DOM.sink);
        vi.spyOn(DOM.sink, 'focus').mockImplementation((h: Handle, options?: { preventScroll?: boolean }) => {
            if (h === about) {
                return; // refuses focus
            }

            realFocus(h, options);
        });

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(tool);
    });

    it('a group considers only its in-view members — one clipped out of sight is not reached along the row', () => {
        // `folded` sits in a part of the bar collapsed to zero width. Its
        // own rectangle is the nearest in-line member east of the origin.
        installTestDOM(CONFIG);
        const body = stableBody();
        const bar = liveHandle();
        const collapsedPart = liveHandle();
        const origin = liveHandle();
        const folded = liveHandle();
        const shown = liveHandle();

        place(bar, 0, 0, 400, 24);
        markNavigationGroup(bar);
        placeIn(bar, origin, 10, 0, 40, 24);
        placeIn(bar, collapsedPart, 100, 0, 100, 24);
        placeIn(collapsedPart, folded, 100, 0, 130, 24);
        placeIn(bar, shown, 300, 0, 330, 24);
        clipping(collapsedPart);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, folded, shown]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(shown);
    });

    it('the group line is the nearest group\'s — a candidate in line only with an outer group is not accepted', () => {
        // The origin's own row spans x 300-400; the row is inside a wider
        // group spanning x 0-800. `field` is 46px south and 50px to the
        // side: outside the cone, not in line with the origin or its row,
        // and in line only with the outer group.
        installTestDOM(CONFIG);
        const body = stableBody();
        const outer = liveHandle();
        const row = liveHandle();
        const origin = liveHandle();
        const field = liveHandle();

        place(outer, 0, 0, 800, 60);
        markNavigationGroup(outer);
        placeIn(outer, row, 300, 0, 400, 24);
        markNavigationGroup(row);
        placeIn(row, origin, 300, 0, 320, 24);
        place(field, 0, 70, 250, 94);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, field]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('south', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('levels are searched innermost first: a group inside a scroll viewport is searched before the viewport', () => {
        // A row of controls inside a scrolling panel. `nearer` is in the
        // panel but not in the row, in line, and closer than `member`: the
        // panel's level would pick it, so reaching `member` proves the row
        // was searched first. (E-33 covers the reverse nesting.)
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const row = liveHandle();
        const origin = liveHandle();
        const member = liveHandle();
        const nearer = liveHandle();

        place(viewport, 0, 0, 1000, 600);
        placeIn(viewport, row, 0, 0, 60, 24);
        placeIn(row, origin, 10, 0, 40, 24);
        placeIn(row, member, 300, 0, 330, 24);
        placeIn(viewport, nearer, 100, 0, 130, 24);
        markNavigationGroup(row);
        clipping(viewport);
        registerFakeRevealer(viewport, viewport);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, member, nearer]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(member);
    });

    it('E-33: a scrolling tab strip is walked tab by tab, hidden tabs included, before the strip\'s own tool — and never onto a tab\'s close button', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const tabBar = liveHandle();
        const clip = liveHandle();
        const button = (): Handle => {
            const handle = DOM.sink.createElement('button');

            setConnected(handle, true);

            return handle;
        };
        const tab1 = button();
        const close1 = button();
        const tab2 = button();
        const tab3 = button();
        const tab4 = button();
        const stripTool = button();

        place(tabBar, 0, 0, 400, 24);
        markNavigationGroup(tabBar);
        placeIn(tabBar, clip, 0, 0, 300, 24);
        placeIn(clip, tab1, 0, 0, 100, 24);
        placeIn(tab1, close1, 82, 4, 98, 20);
        placeIn(clip, tab2, 100, 0, 200, 24);
        placeIn(clip, tab3, 200, 0, 300, 24);
        placeIn(clip, tab4, 300, 0, 400, 24); // scrolled out past the clip's right edge
        placeIn(tabBar, stripTool, 370, 0, 394, 24);
        clipping(clip);
        // The strip's reveal element is the bar; what scrolls is the clip.
        registerFakeRevealer(tabBar, clip);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [tab1, close1, tab2, tab3, tab4, stripTool]);
        DOM.sink.focus(tab1);

        const landings: Array<Handle | null> = [];

        for (let press = 0; press < 4; press++) {
            SpatialNavigation.move('east', 'component');
            landings.push(DOM.source.getActiveElement());
        }

        expect(landings).toEqual([tab2, tab3, tab4, stripTool]);
    });
});

describe('SpatialNavigation.move — search root', () => {
    /** A window layer at (400, 200, 800, 600) with no controls of its own. */
    function openWindow(): Handle {
        const element = liveHandle();

        place(element, 400, 200, 800, 600);
        registerWindowLayer(element);

        return element;
    }

    it('E-28: a control wholly behind a floating window is not a candidate; one peeking out from behind it is', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const covered = liveHandle();
        const peeking = liveHandle();

        place(origin, 0, 300, 100, 320);
        place(covered, 500, 300, 560, 320); // wholly inside the window's box
        place(peeking, 380, 300, 440, 320); // 20px of it left of the window's edge
        openWindow();
        // `covered` leads the list and is farther along: were it a candidate,
        // it could only lose on score, so place `peeking` after it.
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, covered, peeking]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(peeking);

        // And from `peeking`, `covered` — 60px east, in line — is still not reachable.
        expect(SpatialNavigation.move('east', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(peeking);
    });

    it('E-29: moves inside a floating window stay inside it', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const windowElement = openWindow();
        const inW1 = liveHandle();
        const inW2 = liveHandle();
        const left = liveHandle();
        const main = liveHandle();

        placeIn(windowElement, inW1, 420, 300, 480, 320);
        placeIn(windowElement, inW2, 500, 300, 560, 320);
        place(left, 0, 300, 100, 320);
        place(main, 900, 300, 960, 320);
        setQuerySelectorAllResult(windowElement, NAVIGATION_CANDIDATE_SELECTOR, [inW1, inW2]);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [left, main]);
        DOM.sink.focus(inW1);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(inW2);

        // `main` is 340px east and in line, but outside the window.
        expect(SpatialNavigation.move('east', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(inW2);
    });

    it('E-29: moves in the page behind a floating window never enter it', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const windowElement = openWindow();
        const inW1 = liveHandle();
        const left = liveHandle();
        const main = liveHandle();

        placeIn(windowElement, inW1, 420, 300, 480, 320); // nearer than `main`, and in line
        place(left, 0, 300, 100, 320);
        place(main, 900, 300, 960, 320);
        setQuerySelectorAllResult(windowElement, NAVIGATION_CANDIDATE_SELECTOR, [inW1]);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [left, main]);
        DOM.sink.focus(left);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(main);
    });

    it.each([
        { direction: 'south' as const, lands: 'first' as const },
        { direction: 'north' as const, lands: 'last' as const },
    ])('with focus on a window\'s own element, a $direction move lands on the window\'s $lands control — the window is no point to search from', ({ direction, lands }) => {
        // A window focuses its own element when it is activated. Every
        // control in it is inside that element, so none is ever "ahead".
        installTestDOM(CONFIG);
        const body = stableBody();
        const windowElement = openWindow();
        const first = liveHandle();
        const last = liveHandle();
        const outside = liveHandle();

        // `first` is placed below `last`: a geometric ranking would give the opposite answer.
        placeIn(windowElement, first, 420, 400, 480, 420);
        placeIn(windowElement, last, 420, 300, 480, 320);
        place(outside, 0, 300, 100, 320);
        setQuerySelectorAllResult(windowElement, NAVIGATION_CANDIDATE_SELECTOR, [first, last]);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [outside]);
        DOM.sink.focus(windowElement);

        expect(SpatialNavigation.move(direction, 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(lands === 'first' ? first : last);
    });

    it('inside a window, only a layer stacked above that window covers its controls', () => {
        installTestDOM(CONFIG);
        stableBody();
        const windowElement = liveHandle();
        const a = liveHandle();
        const b = liveHandle();
        const c = liveHandle();
        const otherElement = liveHandle();

        place(windowElement, 100, 100, 700, 500);
        placeIn(windowElement, a, 120, 300, 180, 320);
        placeIn(windowElement, b, 300, 300, 360, 320);
        placeIn(windowElement, c, 600, 300, 660, 320);
        place(otherElement, 280, 280, 400, 400); // wholly covers `b`

        // Both are top-level windows in the window band, so each raise puts
        // the raised one on top.
        const makeWindow = (element: Handle): DismissableLayer => {
            const layer: DismissableLayer = {
                getLayerElement: () => element,
                getDismissMode:  () => 'manual',
                requestClose:    () => {},
                getBand:         () => LayerManager.Band.Window,
                isLayerRoot:     () => true,
            };

            LayerManager.register(layer);
            _registeredLayers.push(layer);

            return layer;
        };
        const windowLayer = makeWindow(windowElement);
        const otherLayer = makeWindow(otherElement);

        setQuerySelectorAllResult(windowElement, NAVIGATION_CANDIDATE_SELECTOR, [a, b, c]);

        // `other` was opened last, so it is stacked above: `b` is covered.
        expect(LayerManager.getZIndex(otherLayer)).toBeGreaterThan(LayerManager.getZIndex(windowLayer));
        DOM.sink.focus(a);
        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(c);

        // Raise the focused window above `other`: `b` now shows.
        LayerManager.bringToFront(windowLayer);
        DOM.sink.focus(a);
        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(b);
    });

    it('a layer that is not rendered, or has no element, covers nothing', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();
        const behind = liveHandle();
        const hiddenWindow = liveHandle();

        place(origin, 0, 300, 100, 320);
        place(behind, 500, 300, 560, 320);
        place(hiddenWindow, 400, 200, 800, 600); // would wholly cover `behind`
        setRenderedVisible(hiddenWindow, false);
        registerWindowLayer(hiddenWindow);

        const unrendered: DismissableLayer = { getLayerElement: () => null, getDismissMode: () => 'manual', requestClose: () => {} };

        LayerManager.register(unrendered);
        _registeredLayers.push(unrendered);

        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, behind]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('east', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(behind);
    });

    it('a control in the origin\'s scroll viewport that is wholly behind a floating window is not readmitted by the viewport\'s level', () => {
        // `shown` is inside the scroll viewport's box and wholly behind the
        // window. The viewport's level lifts only the viewport's own clip,
        // not the not-covered requirement.
        installTestDOM(CONFIG);
        const body = stableBody();
        const viewport = liveHandle();
        const origin = liveHandle();
        const shown = liveHandle();

        place(viewport, 400, 100, 800, 700);
        placeIn(viewport, origin, 500, 640, 560, 660); // below the window's bottom edge: in view
        placeIn(viewport, shown, 500, 300, 560, 320);  // behind the window
        clipping(viewport);
        registerFakeRevealer(viewport, viewport);
        openWindow();
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, shown]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(origin);
    });

    it('the region chord shares the search root: pressed in the page behind a window it does not enter the window', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const windowElement = openWindow();
        const origin = liveHandle();
        const pageTarget = liveHandle();
        const pageLanding = liveHandle();
        const windowTarget = liveHandle();
        const windowLanding = liveHandle();

        place(origin, 0, 300, 100, 320);
        place(pageTarget, 900, 300, 1000, 320);
        placeIn(windowElement, windowTarget, 420, 300, 520, 320); // nearer, and in line
        markNavigationTarget(pageTarget);
        markNavigationTarget(windowTarget);
        setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [pageTarget]);
        setQuerySelectorAllResult(pageTarget, FOCUSABLE_SELECTOR, [pageLanding]);
        setQuerySelectorAllResult(windowElement, NAVIGATION_TARGET_SELECTOR, [windowTarget]);
        setQuerySelectorAllResult(windowTarget, FOCUSABLE_SELECTOR, [windowLanding]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('east', 'target')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(pageLanding);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [remembered, elsewhere]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [remembered, elsewhere]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, elsewhere]);
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
        // Inside the 1280 x 800 viewport: a control below the fold is not a
        // control-chord candidate, and the move-away step below needs one.
        place(elsewhere, 0, 700, 50, 720);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [childB, elsewhere]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [target, origin]);
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
        // `first` is placed below `second`: a geometric ranking against
        // <body>'s own rect would give the opposite answer, which proves the
        // landing is picked by DOM order.
        const first = liveHandle();
        const second = liveHandle();

        place(first, 0, 40, 100, 60);
        place(second, 0, 0, 100, 20);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [first, second]);

        expect(DOM.source.getActiveElement()).toBe(null);
        expect(SpatialNavigation.move('south', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(first);
    });

    it('lands on the last component-tier candidate in DOM order for a backward direction, when nothing is focused', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const first = liveHandle();
        const second = liveHandle();

        place(first, 0, 40, 100, 60);
        place(second, 0, 0, 100, 20);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [first, second]);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(second);
    });

    it('treats <body> itself holding focus exactly like nothing being focused — real documents default there, never to null', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const first = liveHandle();
        const second = liveHandle();

        place(first, 0, 40, 100, 60);
        place(second, 0, 0, 100, 20);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [first, second]);
        DOM.sink.focus(body);

        expect(DOM.source.getActiveElement()).toBe(body);
        expect(SpatialNavigation.move('south', 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(first);
    });

    it.each([
        { direction: 'south' as const, lands: 'first' as const },
        { direction: 'north' as const, lands: 'last' as const },
    ])('E-34: with nothing focused, a $direction move skips a control that is not in view and lands on $lands', ({ direction, lands }) => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const offscreen = liveHandle();
        const first = liveHandle();
        const last = liveHandle();
        const offscreenToo = liveHandle();

        place(offscreen, 0, 900, 100, 920); // below the 800px-tall viewport
        place(first, 0, 0, 100, 20);
        place(last, 0, 40, 100, 60);
        place(offscreenToo, 0, 950, 100, 970);
        // An off-screen control leads the document order and another ends
        // it, so a plain first- or last-in-order landing would pick one.
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [offscreen, first, last, offscreenToo]);

        expect(SpatialNavigation.move(direction, 'component')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(lands === 'first' ? first : last);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [remembered, elsewhere]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [remembered, elsewhere]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [remembered, elsewhere]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, nextBest]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getAttribute(nextBest, FOCUS_VISIBLE_ATTR)).toBe('true');
    });

    it('does not mark anything when the move fails', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const origin = liveHandle();

        place(origin, 0, 200, 100, 220);
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, nextBest]);
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
        setQuerySelectorAllResult(body, NAVIGATION_CANDIDATE_SELECTOR, [origin, nextBest]);
        DOM.sink.focus(origin);

        expect(SpatialNavigation.move('north', 'component')).toBe(true);
        expect(DOM.source.getAttribute(nextBest, FOCUS_VISIBLE_ATTR)).toBe('true');

        // Never enabled in this test, so the focusout listener was never wired.
        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(nextBest, 'focusout'));
        expect(DOM.source.getAttribute(nextBest, FOCUS_VISIBLE_ATTR)).toBe('true');
    });
});
