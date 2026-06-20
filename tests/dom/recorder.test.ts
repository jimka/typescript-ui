// Runs in the default `node` environment. The recording sink captures every
// structural write as plain data without touching a DOM, so a write sequence
// can be asserted offline (and, in future, replayed across a worker boundary).
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { RecordingDOMSink } from './TestDOM';

describe('RecordingDOMSink', () => {
    afterEach(() => {
        DOM.reset();
    });

    it('captures each structural write as an ordered op log', () => {
        const sink = new RecordingDOMSink();

        DOM.install({ sink });

        const el    = DOM.sink.createElement('div');
        const child = DOM.sink.createElement('span');

        DOM.sink.apply(el, { addClass: ['Panel'], setAttr: { role: 'group' }, style: { width: '100px' } });
        DOM.sink.appendChild(el, child);
        DOM.sink.apply(el, { toggleClass: { active: true } });

        expect(sink.writes).toEqual([
            { op: 'createElement', args: ['div'] },
            { op: 'createElement', args: ['span'] },
            { op: 'apply',         args: [el, { addClass: ['Panel'], setAttr: { role: 'group' }, style: { width: '100px' } }] },
            { op: 'appendChild',   args: [] },
            { op: 'apply',         args: [el, { toggleClass: { active: true } }] },
        ]);
    });

    it('mints a numeric handle from createElement without touching a DOM', () => {
        const sink = new RecordingDOMSink();

        DOM.install({ sink });

        const el = DOM.sink.createElement('div');

        expect(typeof el).toBe('number');

        // The handle round-trips: an id written through the sink reads back via
        // the modelled source's stub — but with only a sink installed here, the
        // recorded op log is the assertion surface.
        expect(sink.writes).toEqual([{ op: 'createElement', args: ['div'] }]);
    });
});
