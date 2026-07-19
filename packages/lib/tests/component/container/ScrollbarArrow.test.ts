import { describe, it, expect, afterEach } from 'vitest';
import { Scrollbar } from '~/component/container/Scrollbar';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Real-event delivery lives in its OWN file on purpose. The Event namespace
// installs its base window listener once per type, guarded by a module-scoped
// Set that survives `DOM.reset()`; reset installs a fresh sink whose window
// listeners start empty but leaves that guard set — so a second test in the same
// file that constructs a Scrollbar never re-installs the `mousedown` base
// listener into the fresh sink, and a dispatch reaches nothing. Vitest isolates
// module state per file, so a single delivery test here always runs against a
// freshly-installed base listener. (events.test.ts sidesteps the same limitation
// by minting a unique event type per test.)
describe('Scrollbar arrow mousedown drives a scroll step', () => {
    afterEach(() => DOM.reset());

    // Regression guard on the delivery chain
    // (_onMouseDown → emit("tick") → onArrowTick → emit("scroll")). The offline
    // harness has no pointer-events hit-testing, so this dispatches straight to
    // the arrow element — it passes with or without the glyph pointer-events fix
    // (the retargeting itself is manual-verify). It pins that an enabled arrow
    // steps the scroll and a disabled (at-edge) arrow does not.
    it('steps on an enabled arrow and ignores a disabled (at-edge) arrow', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true, arrowStep: 40 });

        bar.setHeight(400);
        bar.setMetrics(200, 1000, 0); // at top: start arrow disabled, end arrow enabled

        const [, arrowStart, arrowEnd] = bar.getComponents();

        const positions: number[] = [];
        bar.on('scroll', (p: number) => positions.push(p));

        // Enabled end arrow: a mousedown steps down one arrowStep (clamped). The
        // trailing mouseup cancels the accelerating hold-repeat schedule so no
        // stray timer leaks past the test.
        const endEl = arrowEnd.getElement(true)!;
        DOM.sink.dispatchEvent(endEl, makeEvent(endEl, 'mousedown'));
        DOM.sink.dispatchEvent(endEl, makeEvent(endEl, 'mouseup'));

        expect(positions).toEqual([40]);

        // Disabled start arrow (already at the top): a mousedown emits nothing.
        const startEl = arrowStart.getElement(true)!;
        DOM.sink.dispatchEvent(startEl, makeEvent(startEl, 'mousedown'));
        DOM.sink.dispatchEvent(startEl, makeEvent(startEl, 'mouseup'));

        expect(positions).toEqual([40]);
    });
});

const ENABLED_COLOR  = 'var(--ts-ui-scrollbar-arrow-color, rgba(0, 0, 0, 0.55))';
const DISABLED_COLOR = 'var(--ts-ui-scrollbar-arrow-disabled-color, rgba(0, 0, 0, 0.18))';

// Pins the enabled↔disabled colour crossfade added on top of the instant
// `_disabled` gating covered above: both arrows declare the fade transition
// at construction, the disabled colour still lands at each extreme, and a
// no-op `setMetrics` call doesn't redundantly rewrite the colour.
describe('Scrollbar arrow enabled/disabled colour fade', () => {
    afterEach(() => DOM.reset());

    it('applies the disabled colour to the start arrow at the top extreme', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        bar.setHeight(400);
        bar.setMetrics(200, 1000, 0); // scrolled to top

        const [, arrowStart, arrowEnd] = bar.getComponents();

        expect(arrowStart.getForegroundColor()).toBe(DISABLED_COLOR);
        expect(arrowEnd.getForegroundColor()).toBe(ENABLED_COLOR);
    });

    it('flips the disabled colour to the end arrow at the bottom extreme', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        bar.setHeight(400);
        bar.setMetrics(200, 1000, 0);   // top: start disabled
        bar.setMetrics(200, 1000, 800); // bottom (maxScroll = 600): end disabled

        const [, arrowStart, arrowEnd] = bar.getComponents();

        expect(arrowStart.getForegroundColor()).toBe(ENABLED_COLOR);
        expect(arrowEnd.getForegroundColor()).toBe(DISABLED_COLOR);
    });

    it('declares the 120ms colour crossfade transition on both arrows', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart, arrowEnd] = bar.getComponents();

        expect(arrowStart.getTransition()).toBe('color 120ms ease-out');
        expect(arrowEnd.getTransition()).toBe('color 120ms ease-out');
    });

    it('is idempotent: a repeated no-op setMetrics leaves colours unchanged and emits no scroll', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        bar.setHeight(400);
        bar.setMetrics(200, 1000, 0);

        const [, arrowStart, arrowEnd] = bar.getComponents();

        const positions: number[] = [];
        bar.on('scroll', (p: number) => positions.push(p));

        bar.setMetrics(200, 1000, 0); // same metrics again

        expect(arrowStart.getForegroundColor()).toBe(DISABLED_COLOR);
        expect(arrowEnd.getForegroundColor()).toBe(ENABLED_COLOR);
        expect(positions).toEqual([]);
    });
});
