// @vitest-environment jsdom
//
// Coverage for the `DOMSink.createMouseEvent()` seam member
// (plans/implemented/table-tree-keyboard-context-menu.md, Expected Behaviour
// cases S1 and S2) — against the REAL production sink (the `jsdom` pragma
// keeps `tests/setup/node-setup.ts` from installing the modelled DOM, as
// `tests/dom/countElements.test.ts` does), and against the modelled sink via
// an explicit `installTestDOM`.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM, ProductionDOMSink } from '~/core/DOM';
import { installTestDOM, type RecordingDOMSink } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

// `MouseEvent.button` of the secondary (right) button, per the UI Events
// specification: the value a synthetic `contextmenu` event carries.
const SECONDARY_BUTTON = 2;

describe('ProductionDOMSink.createMouseEvent', () => {
    it('S1: builds a real MouseEvent and does not dispatch it', () => {
        const event = new ProductionDOMSink().createMouseEvent('contextmenu', { clientX: 5, clientY: 7, button: SECONDARY_BUTTON });

        expect(event).toBeInstanceOf(MouseEvent);
        expect(event.type).toBe('contextmenu');
        expect(event.clientX).toBe(5);
        expect(event.clientY).toBe(7);
        expect(event.button).toBe(SECONDARY_BUTTON);
        expect(event.target).toBeNull();
    });
});

describe('RecordingDOMSink.createMouseEvent', () => {
    afterEach(() => DOM.reset());

    it('S2: builds a plain event with the same values and records the write', () => {
        installTestDOM({
            rootMountOffset: { x: 0, y: 0 },
            viewport:        { width: 1280, height: 800 },
            scrollBarWidth:  15,
            fontMetrics,
            themeVars:       {},
        });

        const event = DOM.sink.createMouseEvent('contextmenu', { clientX: 5, clientY: 7, button: SECONDARY_BUTTON });

        expect(event.type).toBe('contextmenu');
        expect(event.clientX).toBe(5);
        expect(event.clientY).toBe(7);
        expect(event.button).toBe(SECONDARY_BUTTON);
        expect(event.target).toBeNull();
        expect(() => event.preventDefault()).not.toThrow();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(write => write.op === 'createMouseEvent');

        expect(writes).toHaveLength(1);
    });
});
