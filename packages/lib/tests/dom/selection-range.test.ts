// @vitest-environment jsdom
//
// Coverage for `DOMSource.getSelectionRange()` — the read twin of
// `DOMSink.setSelectionRange` — against the REAL production source (the
// `jsdom` pragma keeps `tests/setup/node-setup.ts` from installing the
// modelled DOM, mirroring `tests/dom/countElements.test.ts`), and against
// the modelled source via `installTestDOM`, the same combination that file
// uses.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM, ProductionDOMSink, ProductionDOMSource } from '~/core/DOM';
import { installTestDOM } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

describe('ProductionDOMSource.getSelectionRange', () => {
    const sink   = new ProductionDOMSink();
    const source = new ProductionDOMSource();

    // Case: a real range selected in a <textarea> reads back exactly.
    it('reads back a range selected in a textarea', () => {
        const h = sink.createElement('textarea');

        sink.setValue(h, 'hello');
        sink.setSelectionRange(h, 1, 4);

        expect(source.getSelectionRange(h)).toEqual({ start: 1, end: 4 });
    });

    // Case: a collapsed range in a text input reads back as a bare caret.
    it('reads back a caret position in a text input, not null', () => {
        const h = sink.createElement('input');

        sink.setValue(h, 'he');
        sink.setSelectionRange(h, 2, 2);

        expect(source.getSelectionRange(h)).toEqual({ start: 2, end: 2 });
    });

    // Case: an empty text input's caret is a real {0, 0} range, not null.
    it('reads an empty text input as {start: 0, end: 0}', () => {
        const h = sink.createElement('input');

        expect(source.getSelectionRange(h)).toEqual({ start: 0, end: 0 });
    });

    // Case: an <input type="number"> exposes no character range at all —
    // `selectionStart`/`selectionEnd` are `null`, not a number.
    it('returns null for an input type that has no character range', () => {
        const h = sink.createElement('input');
        sink.apply(h, { setAttr: { type: 'number' } });

        expect(source.getSelectionRange(h)).toBeNull();
    });

    // Case: a non-form element has no `selectionStart`/`selectionEnd` at all
    // (`undefined` at runtime, not `null`) — still reported as `null`.
    it('returns null for an element that is not a form control', () => {
        const h = sink.createElement('div');

        expect(source.getSelectionRange(h)).toBeNull();
    });
});

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('ModelledDOMSource.getSelectionRange', () => {
    afterEach(() => DOM.reset());

    // Case 1: a written range reads back exactly.
    it('reads back a range written by setSelectionRange', () => {
        installTestDOM(CONFIG);
        const h = DOM.sink.createElement('input');

        DOM.sink.setSelectionRange(h, 1, 4);

        expect(DOM.source.getSelectionRange(h)).toEqual({ start: 1, end: 4 });
    });

    // Case 2: a handle nothing has written a range to reports null.
    it('returns null for a handle with no written range', () => {
        installTestDOM(CONFIG);
        const h = DOM.sink.createElement('input');

        expect(DOM.source.getSelectionRange(h)).toBeNull();
    });

    // Case 3: a collapsed write reads back as a real range, not null.
    it('reads back a collapsed write as {start, end}, not null', () => {
        installTestDOM(CONFIG);
        const h = DOM.sink.createElement('input');

        DOM.sink.setSelectionRange(h, 2, 2);

        expect(DOM.source.getSelectionRange(h)).toEqual({ start: 2, end: 2 });
    });

    // Case 4: a later write replaces the earlier one.
    it('reflects the most recent write', () => {
        installTestDOM(CONFIG);
        const h = DOM.sink.createElement('input');

        DOM.sink.setSelectionRange(h, 1, 4);
        DOM.sink.setSelectionRange(h, 0, 0);

        expect(DOM.source.getSelectionRange(h)).toEqual({ start: 0, end: 0 });
    });

    // Case 5: the result is a copy — mutating it does not affect a later read.
    it('returns a copy that a caller cannot mutate the stub through', () => {
        installTestDOM(CONFIG);
        const h = DOM.sink.createElement('input');

        DOM.sink.setSelectionRange(h, 1, 4);

        const first = DOM.source.getSelectionRange(h)!;
        first.start = 999;

        expect(DOM.source.getSelectionRange(h)).toEqual({ start: 1, end: 4 });
    });

    // Case 6: folding the write onto the stub does not displace the op-log entry.
    it('still records the write in the op log', () => {
        const sink = installTestDOM(CONFIG);
        const h    = DOM.sink.createElement('input');

        DOM.sink.setSelectionRange(h, 1, 4);

        expect(sink.writes).toContainEqual({ op: 'setSelectionRange', args: [1, 4] });
    });
});
