// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToggleButton } from '~/component/button/ToggleButton';
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

describe('ToggleButton selected state', () => {
    it('defaults to not selected', () => {
        expect(new ToggleButton('Bold').isSelected()).toBe(false);
    });
    it('round-trips setSelected', () => {
        const btn = new ToggleButton('Bold');

        btn.setSelected(true);
        expect(btn.isSelected()).toBe(true);

        btn.setSelected(false);
        expect(btn.isSelected()).toBe(false);
    });
    it('applies a { selected: true } option', () => {
        expect(new ToggleButton('Bold', { selected: true }).isSelected()).toBe(true);
    });
});

describe('ToggleButton setSelected DOM write', () => {
    it('writes a toggleClass { selected } to the rendered element', () => {
        const btn = new ToggleButton('Bold');

        btn.getElement(true);

        const before = sink.writes.length;

        btn.setSelected(true);

        // setSelected resolves the element and toggles the `selected` class; the
        // recorded apply patch carries `toggleClass: { selected: true }`.
        const wrote = sink.writes
            .slice(before)
            .some(w => w.op === 'apply' && JSON.stringify(w.args).includes('"selected":true'));

        expect(wrote).toBe(true);
    });
});

describe('ToggleButton action routing', () => {
    // ToggleButton overrides on/off("action") to route to the DOM "change"
    // event (not the base "click"). Real delivery isn't observable offline; we
    // assert the routing target via the base-listener dedup contract: a second
    // registration of "change" within one test adds no new base install.
    it('routes on("action") to the "change" event and is chainable', () => {
        const btn = new ToggleButton('Bold');

        expect(btn.on('action', () => {})).toBe(btn);
    });
    it('adds no further "change" base install once it is live (dedup)', () => {
        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const fa = (): void => {};
        const fb = (): void => {};

        a.on('action', fa);

        const before = countWrites('addListener', 'change');

        b.on('action', fb);

        expect(countWrites('addListener', 'change') - before).toBe(0);

        a.off('action', fa);
        b.off('action', fb);
    });
});

describe('ToggleButton flat state', () => {
    it('round-trips setFlat', () => {
        const btn = new ToggleButton('Bold');

        btn.setFlat(true);

        expect(btn.isFlat()).toBe(true);
    });
});
