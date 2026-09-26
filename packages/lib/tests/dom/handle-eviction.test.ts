// The modelled-DOM twin of handle-registry.test.ts: that file pins the
// production registry's eviction under jsdom (release drops the entry so a
// later resolve throws); this one pins the modelled pair's eviction under
// node — release evicts the handle's stub and id-index entry the same way,
// and detaching an element from the modelled tree un-indexes its id.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

describe('modelled handle eviction', () => {
    it('E1. a released handle stops resolving and stops being findable', () => {
        const h = DOM.sink.createElement('div');

        DOM.sink.setId(h, 'probe-id');

        expect(DOM.source.isRegistered(h)).toBe(true);
        expect(DOM.source.getElementById('probe-id')).toBe(h);
        expect(DOM.source.getTagName(h)).toBe('DIV');

        DOM.sink.release(h);

        expect(DOM.source.isRegistered(h)).toBe(false);
        expect(DOM.source.getElementById('probe-id')).toBe(null);
        expect(() => DOM.source.getTagName(h)).toThrow(/not registered/);
    });

    it('E2. detaching un-indexes the id; re-attaching re-indexes it', () => {
        const parent = DOM.sink.createElement('div');
        const child  = DOM.sink.createElement('div');

        DOM.sink.setId(child, 'kid');
        DOM.sink.appendChild(parent, child);

        expect(DOM.source.getElementById('kid')).toBe(child);

        DOM.sink.removeElement(child);

        expect(DOM.source.getElementById('kid')).toBe(null);

        DOM.sink.appendChild(parent, child);

        expect(DOM.source.getElementById('kid')).toBe(child);
    });

    it('E3. appending a fragment moves its children, so releasing the fragment orphans nothing', () => {
        const host     = DOM.sink.createElement('div');
        const fragment = DOM.sink.createDocumentFragment();
        const row      = DOM.sink.createElement('div');

        DOM.sink.appendChild(fragment, row);
        DOM.sink.appendChild(host, fragment);

        expect(DOM.source.getParentNode(row)).toBe(host);

        DOM.sink.release(fragment);

        expect(() => DOM.sink.apply(row, {
            style: { left: '5px', top: '7px', width: '10px', height: '10px' },
        })).not.toThrow();
        expect(DOM.source.getElementRect(row).x).toBe(5);
    });
});
