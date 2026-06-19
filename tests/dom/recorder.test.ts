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

        DOM.sink.addClass(el, 'Panel');
        DOM.sink.setAttribute(el, 'role', 'group');
        DOM.sink.setStyle(el, 'width', '100px');
        DOM.sink.appendChild(el, child);
        DOM.sink.toggleClass(el, 'active', true);

        expect(sink.writes).toEqual([
            { op: 'createElement', args: ['div'] },
            { op: 'createElement', args: ['span'] },
            { op: 'addClass',      args: ['Panel'] },
            { op: 'setAttribute',  args: ['role', 'group'] },
            { op: 'setStyle',      args: ['width', '100px'] },
            { op: 'appendChild',   args: [] },
            { op: 'toggleClass',   args: ['active', true] },
        ]);
    });

    it('returns a stub element from createElement without touching a DOM', () => {
        const sink = new RecordingDOMSink();
        const el   = sink.createElement('div');

        expect(el.tagName).toBe('DIV');
        expect(el.isConnected).toBe(false);
    });
});
