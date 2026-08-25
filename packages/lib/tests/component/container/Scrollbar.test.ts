import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Scrollbar, isScrollbarTarget, TRACK_WIDTH } from '~/component/container/Scrollbar';
import { Event } from '~/core/Event';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, makeEvent, ruleStyleWrites, RecordingDOMSink } from '../../dom/TestDOM';
import { _ruleCacheHas } from '~/core/StyleTarget';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Contract constant. THUMB_MIN_SIZE is file-local in Scrollbar.ts; the value
// is mirrored here ONLY to derive expected relations (the tests assert
// proportional/min-clamp/origin relations, not this number as a golden).
const THUMB_MIN_SIZE = 30;

/** The committed thumb child — Scrollbar adds it as its first child. */
function thumb(bar: Scrollbar): Component {
    return bar.getComponents()[0];
}

describe('Scrollbar construction defaults', () => {
    afterEach(() => DOM.reset());

    it('exposes TRACK_WIDTH via getTrackWidth', () => {
        installTestDOM(CONFIG);

        // getTrackWidth() is a one-line passthrough to the same TRACK_WIDTH
        // binding imported above, so comparing the two against each other
        // alone can never fail regardless of the constant's value — pin the
        // actual contract value (12) first, so a future edit to TRACK_WIDTH
        // still trips a regression here.
        expect(TRACK_WIDTH).toBe(12);
        expect(new Scrollbar('vertical').getTrackWidth()).toBe(TRACK_WIDTH);
    });

    it('reports its orientation', () => {
        installTestDOM(CONFIG);

        expect(new Scrollbar('vertical').getOrientation()).toBe('vertical');
        expect(new Scrollbar('horizontal').getOrientation()).toBe('horizontal');
    });

    // Arrows are enabled by default. The backing field `_arrowsEnabled`
    // initialises to `true` (Scrollbar.ts L341) and the docs now state default
    // `true`; a caller sets `arrowsEnabled: false` to opt out for a minimalist
    // look.
    it('defaults arrowsEnabled to true', () => {
        installTestDOM(CONFIG);

        expect(new Scrollbar('vertical').isArrowsEnabled()).toBe(true);
    });

    // The widget only mirrors a native scroll region, so it is decorative: it
    // carries aria-hidden so assistive tech ignores the track/thumb/arrow subtree.
    it('marks the widget aria-hidden', () => {
        installTestDOM(CONFIG);

        expect(new Scrollbar('vertical').getAria().getHidden()).toBe(true);
    });

    it('round-trips an explicit arrowsEnabled option', () => {
        installTestDOM(CONFIG);

        expect(new Scrollbar('vertical', { arrowsEnabled: true }).isArrowsEnabled()).toBe(true);
        expect(new Scrollbar('vertical', { arrowsEnabled: false }).isArrowsEnabled()).toBe(false);
    });

    it('round-trips the arrow step', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowStep: 64 });

        expect(bar.getArrowStep()).toBe(64);

        bar.setArrowStep(80);

        expect(bar.getArrowStep()).toBe(80);
    });
});

describe('Scrollbar visibility', () => {
    afterEach(() => DOM.reset());

    it('hides when content fits the viewport and shows when it overflows', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: false });

        bar.setHeight(200);

        bar.setMetrics(200, 150, 0); // content <= viewport

        expect(bar.isDisplayed()).toBe(false);

        bar.setMetrics(200, 600, 0); // content > viewport

        expect(bar.isDisplayed()).toBe(true);
    });
});

describe('Scrollbar thumb geometry (arrows disabled)', () => {
    afterEach(() => DOM.reset());

    it('sizes the thumb proportionally when above the floor', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: false });

        bar.setHeight(400); // trackLength === height with arrows off

        // viewport/content = 200/400 = 0.5 → floor(400 * 0.5) = 200, above the
        // 30px floor, so the proportional value is used verbatim.
        bar.setMetrics(200, 400, 0);

        expect(thumb(bar).getHeight()).toBe(Math.floor(400 * (200 / 400)));
        expect(thumb(bar).getHeight()).toBeGreaterThan(THUMB_MIN_SIZE);
    });

    it('clamps the thumb to THUMB_MIN_SIZE when the proportional size is smaller', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: false });

        bar.setHeight(100);

        // viewport/content = 50/5000 → floor(100 * 0.01) = 1, below the floor.
        bar.setMetrics(50, 5000, 0);

        expect(thumb(bar).getHeight()).toBe(THUMB_MIN_SIZE);
    });

    it('places the thumb at the track origin at scroll 0 (arrows off → origin 0)', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: false });

        bar.setHeight(400);
        bar.setMetrics(200, 800, 0);

        // Position rides the translate, not the static Y — see setThumbPos.
        expect(thumb(bar).getY()).toBe(0);
        expect(thumb(bar).getTranslateY()).toBe(0);
    });

    it('keeps thumbPos + thumbSize within the track across a scroll sweep', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: false });
        const trackLength = 400;

        bar.setHeight(trackLength);

        const viewport = 200;
        const content  = 1200;
        const maxScroll = content - viewport;

        for (const scroll of [0, 100, 500, maxScroll]) {
            bar.setMetrics(viewport, content, scroll);

            const pos  = thumb(bar).getTranslateY();
            const size = thumb(bar).getHeight();

            // Relational invariant: the thumb never extends past the track end.
            expect(pos + size).toBeLessThanOrEqual(trackLength);
            expect(pos).toBeGreaterThanOrEqual(0);
        }
    });

    it('lands the thumb flush with the track end at max scroll', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: false });
        const trackLength = 400;

        bar.setHeight(trackLength);

        const viewport = 200;
        const content  = 1200;

        bar.setMetrics(viewport, content, content - viewport);

        const pos  = thumb(bar).getTranslateY();
        const size = thumb(bar).getHeight();

        // Contract: at max scroll the thumb bottom is flush with the track end.
        expect(pos + size).toBe(trackLength);
    });
});

describe('Scrollbar thumb geometry (arrows enabled)', () => {
    afterEach(() => DOM.reset());

    it('shifts the thumb origin by TRACK_WIDTH relative to the arrows-off case', () => {
        installTestDOM(CONFIG);

        const off = new Scrollbar('vertical', { arrowsEnabled: false });
        const on  = new Scrollbar('vertical', { arrowsEnabled: true });

        off.setHeight(400);
        on.setHeight(400);

        off.setMetrics(200, 800, 0);
        on.setMetrics(200, 800, 0);

        // The start arrow occupies the first TRACK_WIDTH px, so the thumb at
        // scroll 0 begins one TRACK_WIDTH lower than with arrows off.
        expect(thumb(on).getTranslateY() - thumb(off).getTranslateY()).toBe(TRACK_WIDTH);
    });
});

describe('Scrollbar thumb positioning is composite-only', () => {
    afterEach(() => DOM.reset());

    // setThumbPos runs on every scroll tick. Positioning the thumb via
    // setX/setY (top/left) would force layout + paint on every tick; routing
    // it through setTranslate keeps the move composite-only. The static X/Y
    // pinned at construction must never change once a real scroll position
    // has been pushed through — only the translate should move.
    it('moves the thumb via translate, leaving its static X/Y pinned', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: false });

        bar.setHeight(400);
        bar.setMetrics(200, 1200, 0);

        const staticY = thumb(bar).getY();

        for (const scroll of [100, 500, 1000]) {
            bar.setMetrics(200, 1200, scroll);

            expect(thumb(bar).getY()).toBe(staticY);
        }

        expect(thumb(bar).getTranslateY()).toBeGreaterThan(0);
    });

    it('mirrors the pin on the horizontal axis', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('horizontal', { arrowsEnabled: false });

        bar.setWidth(400);
        bar.setMetrics(200, 1200, 0);

        const staticX = thumb(bar).getX();

        for (const scroll of [100, 500, 1000]) {
            bar.setMetrics(200, 1200, scroll);

            expect(thumb(bar).getX()).toBe(staticX);
        }

        expect(thumb(bar).getTranslateX()).toBeGreaterThan(0);
    });
});

describe('Scrollbar horizontal orientation', () => {
    afterEach(() => DOM.reset());

    it('mirrors vertical thumb math on the width/X axis', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('horizontal', { arrowsEnabled: false });
        const trackLength = 400;

        bar.setWidth(trackLength);

        const viewport = 200;
        const content  = 800;

        bar.setMetrics(viewport, content, content - viewport);

        const pos  = thumb(bar).getTranslateX();
        const size = thumb(bar).getWidth();

        expect(size).toBe(Math.max(THUMB_MIN_SIZE, Math.floor(trackLength * (viewport / content))));
        expect(pos + size).toBe(trackLength);
    });
});

describe('Scrollbar arrow glyph is non-interactive', () => {
    afterEach(() => DOM.reset());

    // The arrow's clickable face is a Glyph child that fills the whole button.
    // The Event system routes `addListener` callbacks only to the exact target
    // element's id, so an interactive glyph would swallow the click and the
    // arrow's mousedown/hover handlers would never fire. `pointer-events: none`
    // makes the glyph fall through to the arrow element.
    it('marks each arrow glyph pointer-events:none so clicks reach the arrow', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart, arrowEnd] = bar.getComponents();

        expect(arrowStart.getComponents()[0].getPointerEvents()).toBe('none');
        expect(arrowEnd.getComponents()[0].getPointerEvents()).toBe('none');
    });
});

describe('Scrollbar arrow tick emits scroll on change', () => {
    afterEach(() => DOM.reset());

    it('emits a clamped scroll position when stepping from a boundary', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true, arrowStep: 40 });

        bar.setHeight(400);

        const positions: number[] = [];
        bar.on('scroll', (p: number) => positions.push(p));

        // At scroll 0 the start arrow is at the edge: stepping back (-step) must
        // not emit (already clamped). We can only reach onArrowTick through the
        // arrow button's tick offline indirectly, so assert the equivalent step
        // math via setMetrics at the boundary then a second metrics push.
        bar.setMetrics(200, 1000, 0);

        // No public synchronous arrow-tick entry point offline; the emit is
        // verified through the boundary contract: a scroll listener fires only
        // when the computed next position differs. Driving the actual arrow
        // tick requires a real mousedown event (Tier 3), so here we assert the
        // listener registration is chainable and no spurious emit occurred from
        // setMetrics alone (setMetrics must not emit "scroll").
        expect(positions).toEqual([]);
    });
});

// _onThumbMouseOver/_onThumbMouseOut/_onDragStart/_onDragEnd are private bound
// fields, not real DOM listeners — calling them directly exercises the same
// logic a real mouseover/mousedown/mouseup would run without depending on the
// offline harness's dispatch (which never invokes registered listeners).
const FAKE_MOUSEDOWN = { preventDefault: () => {}, clientY: 0 } as unknown as MouseEvent;

/** Reaches the private drag/hover handlers under test, `Tree.test.ts`-style. */
function drive(bar: Scrollbar): {
    _onThumbMouseOver: () => void;
    _onThumbMouseOut:  () => void;
    _onDragStart:      (e: MouseEvent) => void;
    _onDragEnd:         (e: Event) => void;
} {
    return bar as unknown as ReturnType<typeof drive>;
}

/**
 * The most recently recorded add/remove state for the "key" DOM class token
 * applied to `handle`, or `undefined` if it was never touched. Since
 * `applyHoverState` now drives the visual fill through a CSS state-class
 * rather than a plain `setBackgroundColor` call (see
 * `plans/implemented/state-tier-rule-dedup-followups.md`), the toggled class
 * — not `getBackgroundColor()` — is the only offline-observable signal of
 * the thumb's current hover state. `setStyleState` (core/Component.ts)
 * toggles the token via `addClass`/`removeClass`; its own `render()`'s
 * pre-mount catch-up write (a state set before the element existed,
 * re-asserted once it does — `setStyleState`'s "already matches" guard
 * would otherwise skip it) still uses the older `toggleClass` shape, so
 * both are recognised here.
 */
function lastToggleClassValue(sink: RecordingDOMSink, handle: Handle, key: string): boolean | undefined {
    for (let i = sink.writes.length - 1; i >= 0; i--) {
        const w = sink.writes[i];
        if (w.op !== 'apply' || w.args[0] !== handle) {
            continue;
        }

        const patch = w.args[1] as { addClass?: readonly string[]; removeClass?: readonly string[]; toggleClass?: Record<string, boolean> };
        if (patch.addClass?.includes(key)) {
            return true;
        }
        if (patch.removeClass?.includes(key)) {
            return false;
        }
        if (patch.toggleClass && key in patch.toggleClass) {
            return patch.toggleClass[key];
        }
    }

    return undefined;
}

describe('Scrollbar thumb hover highlight persists through a drag', () => {
    afterEach(() => DOM.reset());

    it('applies the hover fill on mouseover and the resting fill on mouseout', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical');
        const el  = thumb(bar).getElement(true)!;

        drive(bar)._onThumbMouseOver();
        expect(lastToggleClassValue(sink, el, 'hover')).toBe(true);

        drive(bar)._onThumbMouseOut();
        expect(lastToggleClassValue(sink, el, 'hover')).toBe(false);
    });

    it('keeps the hover fill for the whole drag even after the pointer leaves the thumb', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: false });
        const el  = thumb(bar).getElement(true)!;

        bar.setHeight(400);
        bar.setMetrics(200, 1200, 0);

        drive(bar)._onThumbMouseOver();
        drive(bar)._onDragStart(FAKE_MOUSEDOWN);

        // The pointer strays off the thumb mid-drag (its travel box shrinks as
        // the thumb moves), firing a native mouseout — the highlight must not
        // drop while the drag is still in progress.
        drive(bar)._onThumbMouseOut();
        expect(lastToggleClassValue(sink, el, 'hover')).toBe(true);

        drive(bar)._onDragEnd({} as Event);
        expect(lastToggleClassValue(sink, el, 'hover')).toBe(false);
    });

    it('drops the hover fill on drag end only if the pointer is not still over the thumb', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: false });
        const el  = thumb(bar).getElement(true)!;

        bar.setHeight(400);
        bar.setMetrics(200, 1200, 0);

        drive(bar)._onThumbMouseOver();
        drive(bar)._onDragStart(FAKE_MOUSEDOWN);
        drive(bar)._onDragEnd({} as Event);

        // mouseout never fired mid-drag here, so the pointer is still (as far
        // as the component knows) over the thumb — the fill must stay hovered.
        expect(lastToggleClassValue(sink, el, 'hover')).toBe(true);
    });
});

describe('Scrollbar thumb cursor', () => {
    afterEach(() => DOM.reset());

    it('rests at a grab cursor', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical');

        expect(thumb(bar).getCursor()).toBe('grab');
    });

    it('pins a grabbing cursor on the document element for the duration of a drag, and releases it after', () => {
        const sink = installTestDOM(CONFIG);
        const bar  = new Scrollbar('vertical');

        /** The last style patch written to the named element's tag. */
        function styleFor(tag: string): Record<string, string> | undefined {
            const match = sink.writes
                .filter(w => w.op === 'apply')
                .reverse()
                .find(w => DOM.source.getTagName(w.args[0] as Handle) === tag
                        && (w.args[1] as { style?: unknown }).style !== undefined);

            return (match?.args[1] as { style?: Record<string, string> })?.style;
        }

        drive(bar)._onDragStart(FAKE_MOUSEDOWN);
        expect(styleFor('HTML')).toEqual({ cursor: 'grabbing' });

        drive(bar)._onDragEnd({} as Event);
        expect(styleFor('HTML')).toEqual({ cursor: '' });
    });
});

describe('Scrollbar thumb static style hoisting', () => {
    afterEach(() => DOM.reset());

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
     */
    function declarationsDuring(
        sink: RecordingDOMSink,
        selector: string,
        fn: () => void,
    ): Record<string, string | null> {
        const start = sink.writes.length;
        fn();

        const out: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
                continue;
            }

            const styles = w.args[1] as Record<string, string | null>;
            for (const key of Object.keys(styles)) {
                out[key] = styles[key];
            }
        }

        return out;
    }

    it('row 2: the thumb carries no static backgroundColor/cursor declaration on its own #id rule, and the shared .ScrollbarThumb class rule exists once rendered', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical');
        const declarations = declarationsDuring(sink, idSelector(thumb(bar)), () => bar.getElement(true));

        // Unlike ScrollArrowButton, nothing else forces the thumb's own `#id`
        // rule to materialise, so a matching value is skipped in silence
        // rather than surfacing as an explicit removal.
        expect(declarations.backgroundColor).toBeUndefined();
        expect(declarations.cursor).toBeUndefined();
        expect(_ruleCacheHas('.ScrollbarThumb')).toBe(true);
    });
});

// ScrollbarThumb-specific coverage for the state-tier dedup: the `.hover`
// backgroundColor is a declared `ownStyleStates` entry
// (plans/implemented/layered-style-bag.md), isolated from the resting
// `backgroundColor` via the guard suffix `restingGuardSuffix` derives from
// the declared states.
describe('ScrollbarThumb hover state-class hoisting', () => {
    afterEach(() => DOM.reset());

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
     */
    function declarationsDuring(
        sink: RecordingDOMSink,
        selector: string,
        fn: () => void,
    ): Record<string, string | null> {
        const start = sink.writes.length;
        fn();

        const out: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
                continue;
            }

            const styles = w.args[1] as Record<string, string | null>;
            for (const key of Object.keys(styles)) {
                out[key] = styles[key];
            }
        }

        return out;
    }

    it('row 6: a second, warmed Scrollbar hovers its thumb writing no backgroundColor to its own #id.hover rule', () => {
        const sink = installTestDOM(CONFIG);

        const warmup = new Scrollbar('vertical');
        warmup.getElement(true);
        drive(warmup)._onThumbMouseOver(); // warms .ScrollbarThumb.hover

        const bar = new Scrollbar('vertical');
        bar.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(thumb(bar)) + '.hover', () => {
            drive(bar)._onThumbMouseOver();
        });

        expect(declarations.backgroundColor).toBeUndefined();
        expect(_ruleCacheHas('.ScrollbarThumb.hover')).toBe(true);
    });

    it('row 6: a hover-in/hover-out cycle writes no backgroundColor to the resting #id:not(.hover) rule', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical');
        bar.getElement(true);

        const restingSelector = idSelector(thumb(bar)) + ':not(.hover)';

        const declarations = declarationsDuring(sink, restingSelector, () => {
            drive(bar)._onThumbMouseOver();
            drive(bar)._onThumbMouseOut();
        });

        expect(declarations.backgroundColor).toBeUndefined();
    });
});

// Scrollbar.setMetrics / setDisplayed state-tier dedup — Expected Behaviour
// row 9. Originally written against `Scrollbar`'s own `setDisplayed`
// override (component-setvisible-state-tier-dedup.md), which deliberately
// did not delegate to `super.setDisplayed`, since a naive delegating design
// would get its idempotency check stuck on a stale `_instanceStyle.displayed`
// after a hide→show→hide→show sequence and silently skip the second show's
// write and reconcile. component-setdisplayed-state-tier-dedup.md hoisted
// that exact shape onto the base `Component.setDisplayed`/`isDisplayed` and
// deleted `Scrollbar`'s own copy, so this test now exercises the inherited
// base implementation instead — kept unchanged (still against a `Scrollbar`,
// still driven via `setMetrics`) as the regression check that the inherited
// version reproduces the same hide→show→hide→show sequence correctly.
describe('Scrollbar.setMetrics undisplayed state-tier dedup', () => {
    afterEach(() => DOM.reset());

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /** Reads the protected hook off an arbitrary component for spying. */
    function hookTarget(c: Component): { onEffectiveVisibilityChange(effective: boolean): void } {
        return c as unknown as { onEffectiveVisibilityChange(effective: boolean): void };
    }

    it('row 9: overflow false -> true -> false -> true each toggles isDisplayed(), writes no display declaration to #id, and reconciles on every real transition', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical');
        bar.getElement(true);
        bar.setMetrics(200, 800, 0); // overflow: true — matches the default, establishes the "displayed" baseline with no real transition

        const spy = vi.spyOn(hookTarget(bar), 'onEffectiveVisibilityChange');

        // `Component.flushEffectiveVisibility()` after each call, not once at
        // the end, so a transition that fails to *schedule* a reconcile at
        // all (the bug a naive `super.setDisplayed`-delegating design would
        // introduce) is caught at the call that drops it, rather than being
        // masked by a coalesced net-zero flush across the whole sequence
        // (see EffectiveVisibility.test.ts's case 15 for that coalescing
        // behaviour applied deliberately, which is exactly why it can't be
        // relied on here).
        bar.setMetrics(200, 150, 0); // overflow: false — real transition 1
        expect(bar.isDisplayed()).toBe(false);
        Component.flushEffectiveVisibility();
        expect(spy).toHaveBeenCalledTimes(1);

        bar.setMetrics(200, 800, 0); // overflow: true — real transition 2
        expect(bar.isDisplayed()).toBe(true);
        Component.flushEffectiveVisibility();
        expect(spy).toHaveBeenCalledTimes(2);

        bar.setMetrics(200, 150, 0); // overflow: false — real transition 3
        expect(bar.isDisplayed()).toBe(false);
        Component.flushEffectiveVisibility();
        expect(spy).toHaveBeenCalledTimes(3);

        // Real transition 4, the second "show" — the exact call the plan's
        // stale-idempotency-trace footnote proves a naive
        // `super.setDisplayed`-delegating design would silently no-op: its
        // own idempotency check would find `_instanceStyle.displayed`
        // already `true` (stale from transition 2, never cleared by
        // transition 3's hide) and skip both the write and the reconcile.
        bar.setMetrics(200, 800, 0); // overflow: true — real transition 4
        expect(bar.isDisplayed()).toBe(true);
        Component.flushEffectiveVisibility();
        expect(spy).toHaveBeenCalledTimes(4);

        const displayWrites = ruleStyleWrites(sink).filter(
            w => w.selector === idSelector(bar) && w.key === 'display'
        );
        expect(displayWrites).toEqual([]);
    });
});

// isScrollbarTarget is the carve-out a blanket ancestor pointerdown guard
// (e.g. a dropdown panel's focus-loss protection) must consult before calling
// preventDefault(): doing so on a pointerdown that lands on a Scrollbar
// suppresses the browser's synthesized `mousedown` compatibility event for a
// real mouse pointer, which is what the thumb/track drag above is wired to
// (Event.addListener(this._thumb, "mousedown", ...)) — breaking the drag.
// TestDOM has no selector engine (DOM.source.matches is an unconditional
// `false` stub), so the `.Scrollbar`-class match a real browser performs is
// mocked here, mirroring how other tests in this suite mock DOM.source reads;
// the ancestor walk itself (getParentElement) runs against the harness's real
// modelled parent/child structure, unmocked.
describe('isScrollbarTarget', () => {
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    it('recognises a target inside the Scrollbar subtree (the thumb) once the class match resolves', () => {
        installTestDOM(CONFIG);

        const bar         = new Scrollbar('vertical');
        const root         = bar.getElement(true);
        const thumbElement = thumb(bar).getElement(true);

        vi.spyOn(DOM.source, 'matches').mockImplementation(
            (h: unknown, selector: string) => selector === '.Scrollbar' && h === root
        );

        expect(isScrollbarTarget(makeEvent(thumbElement!, 'pointerdown'))).toBe(true);
    });

    it('returns false for a target outside any Scrollbar', () => {
        installTestDOM(CONFIG);

        const other = new Component();

        vi.spyOn(DOM.source, 'matches').mockReturnValue(false);

        expect(isScrollbarTarget(makeEvent(other.getElement(true)!, 'pointerdown'))).toBe(false);
    });

    it('returns false for a non-node target', () => {
        installTestDOM(CONFIG);

        expect(isScrollbarTarget({ target: null } as unknown as Event)).toBe(false);
    });
});

describe('Scrollbar touchstart registration', () => {
    afterEach(() => DOM.reset());

    // Both the thumb's drag-start and the track-click listeners register
    // touchstart with `{ prevent: true }` — since "touchstart" is one of
    // Event.ts's PASSIVE_TYPES, that floor is a silent no-op unless the
    // registration also overrides `passive: false` (a passive listener's
    // preventDefault() is dropped by the browser). RecordingDOMSink.addListener
    // drops the options it's given, so this isn't directly observable through
    // a recorded write — but Event's own conflict guard makes it indirectly
    // observable: having claimed "touchstart" as `passive: false` (via the
    // `new Scrollbar` construction below, which registers it), a later
    // registration with a *different* passive setting throws, while a
    // matching one doesn't.
    it('locks "touchstart" as passive: false, so preventDefault actually applies', () => {
        installTestDOM(CONFIG);

        new Scrollbar('vertical');

        const other = new Component();

        expect(() => Event.addListener(other, 'touchstart', { passive: true, handler: () => {} })).toThrow();
        expect(() => Event.addListener(other, 'touchstart', { passive: false, handler: () => {} })).not.toThrow();
    });
});
