// The three composite inputs (picker fields, AutoCompleteField, NumberSpinner)
// shared a byte-identical `:focus-within::after` StyleRule; it now lives in one
// helper. The recording sink records ensureStyleRule(selector) when a rule
// materialises, so the observable contract is that the helper registers a rule
// for exactly the selector it was given.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerFocusWithinRing } from '~/component/input/focusRing';
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

beforeEach(() => { sink = installTestDOM(CONFIG); });
afterEach(() => DOM.reset());

describe('registerFocusWithinRing', () => {
    it('appends the :focus-within::after pseudo to a single base selector', () => {
        registerFocusWithinRing('.SomeField');

        const registered = sink.writes.some(
            w => w.op === 'ensureStyleRule' && w.args[0] === '.SomeField:focus-within::after',
        );

        expect(registered).toBe(true);
    });

    it('appends the pseudo to each of a compound comma-separated base selector, as one rule', () => {
        registerFocusWithinRing('.DateField, .TimeField, .DateTimeField');

        const expected =
            '.DateField:focus-within::after, .TimeField:focus-within::after, .DateTimeField:focus-within::after';
        const registered = sink.writes.filter(
            w => w.op === 'ensureStyleRule' && w.args[0] === expected,
        );

        expect(registered).toHaveLength(1);
    });
});
