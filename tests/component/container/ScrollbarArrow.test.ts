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
