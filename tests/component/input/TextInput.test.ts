import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TextArea } from '~/component/input/TextArea';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
});

afterEach(() => DOM.reset());

/** Counts recording-sink writes of `op` whose first recorded arg is `type`. */
function countWrites(op: string, type: string): number {
    return sink.writes.filter(w => w.op === op && w.args[0] === type).length;
}

describe('TextInput keydown shorthand', () => {
    // The recording sink does not deliver DOM events to listeners, so the
    // contract verified here is the *wiring*: on("keydown") routes to the native
    // keydown DOM event via Event.addListener(this, ...) (the same shorthand the
    // existing "action" event uses for "input"), and off removes it. Actual key
    // delivery (Ctrl/Cmd+Enter handling) is exercised live by consumers.
    it('on/off("keydown") route to the native keydown DOM event and are chainable', () => {
        const input = new TextArea();
        const listener = (): void => {};

        const addsBefore = countWrites('addListener', 'keydown');
        const chainOn    = input.on('keydown', listener);
        const installed  = countWrites('addListener', 'keydown') - addsBefore;

        const removesBefore = countWrites('removeListener', 'keydown');
        const chainOff      = input.off('keydown', listener);
        const removed       = countWrites('removeListener', 'keydown') - removesBefore;

        expect(chainOn).toBe(input);
        expect(chainOff).toBe(input);
        // First on() installs the single window-level keydown base listener;
        // off() removes it once the last keydown listener is gone.
        expect(installed).toBe(1);
        expect(removed).toBe(1);
    });
});
