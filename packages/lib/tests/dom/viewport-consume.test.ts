// Regression tests for gesture registrars that must consume their own
// viewport event.
//
// The viewport dispatcher no longer stops propagation on a handler's behalf
// (see plans/implemented/viewport-event-propagation.md), so a gesture that owns
// an interaction has to call stopPropagation() itself. These tests assert the
// consume at the *registration boundary* — dispatching a real event through
// DOM.sink — rather than by invoking the handler directly. That distinction is
// the point: the bug this pins was a bound wrapper that dropped its event
// argument, so the handler's own stopPropagation() could never fire even though
// the handler read correctly on its own.
//
// These live in their own file deliberately. `Event`'s viewportListenerMap is
// module-level state and the window listener is attached only when a type is
// first registered (core/Event.ts), while `DOM.reset()` replaces the sink
// without clearing that map. Once any earlier test in the same file registers
// e.g. "mouseup", a later registration of the same type silently never
// re-attaches and no dispatch reaches it. Vitest gives each test file a fresh
// module registry, so a dedicated file is what makes these deterministic.
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Accordion } from '~/layout/Accordion';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
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

const HEADER = 30;

/** A content component materialised for createSection's element reparent. */
function content(): Component {
    const c = new Component({ preferredSize: { width: 100, height: 60 } });
    c.setMinSize({ width: 40, height: 20 });
    c.getElement(true);
    return c;
}

describe('Accordion — gutter drag end consumes its viewport event', () => {
    afterEach(() => DOM.reset());

    it('stops native propagation of the mouseup that ends a gutter drag', () => {
        installTestDOM(CONFIG);

        const acc = new Accordion();
        acc.setHeaderHeight(HEADER);
        acc.setResizable(true);

        const host = new Container({ layoutManager: acc });
        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);
        host.clearInsets();
        host.addComponent(content(), new AccordionConstraints('A', true));
        host.addComponent(content(), new AccordionConstraints('B', true));
        host.doLayout();

        // Starting the drag is what registers the viewport listeners.
        (acc as unknown as { onGutterDragStart(index: number, position: number): void })
            .onGutterDragStart(0, 0);

        let nativeStops = 0;
        const evt = makeEvent(host.getElement()!, 'mouseup');
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { nativeStops += 1; };

        DOM.sink.dispatchEvent(host.getElement()!, evt);

        expect(nativeStops).toBe(1);
    });
});
