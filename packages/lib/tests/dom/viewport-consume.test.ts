// Regression tests for gesture registrars that must consume their own
// viewport event.
//
// The viewport dispatcher no longer stops propagation on a handler's behalf
// (see plans/implemented/viewport-event-propagation.md), so a gesture that owns
// an interaction has to return a stop disposition itself (see
// plans/implemented/listener-return-disposition.md). These tests assert the
// consume at the *registration boundary* — dispatching a real event through
// DOM.sink — rather than by invoking the handler directly. That distinction is
// the point: the bug this pins was a bound wrapper that dropped its event
// argument, so the handler's own consume could never reach the dispatcher even
// though the handler read correctly on its own. This now covers
// `SplitGutter.onDragStop`'s direct (non-wrapped) registration — the one
// drag-end mechanism `Split`, `Border`, and `Accordion` all depend on today.
//
// These live in their own file deliberately. `Event`'s viewportListenerMap is
// module-level state and the window listener is attached only when a type is
// first registered (core/Event.ts), while `DOM.reset()` replaces the sink
// without clearing that map. Once any earlier test in the same file registers
// e.g. "mouseup", a later registration of the same type silently never
// re-attaches and no dispatch reaches it. Vitest gives each test file a fresh
// module registry, so a dedicated file is what makes these deterministic.
import { describe, it, expect, afterEach } from 'vitest';
import { SplitGutter } from '~/component/container/SplitGutter';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('SplitGutter — drag end consumes its viewport event', () => {
    afterEach(() => DOM.reset());

    it('stops native propagation of the mouseup that ends a drag', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        gutter.getElement(true);

        gutter.onDragStart({ clientX: 10 } as MouseEvent);

        let nativeStops = 0;
        const evt = makeEvent(gutter.getElement()!, 'mouseup');
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { nativeStops += 1; };

        DOM.sink.dispatchEvent(gutter.getElement()!, evt);

        expect(nativeStops).toBe(1);
    });
});
