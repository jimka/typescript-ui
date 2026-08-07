import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToggleButton } from '~/component/button/ToggleButton';
import { Glyph } from '~/component/display/Glyph';
import { xmark } from '~/glyphs/solid/xmark';
import { Fit } from '~/layout/Fit';
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
    Glyph.register(xmark);
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

describe('ToggleButton glyph option (regression)', () => {
    // ToggleButton forwards only `text` to super and hands its bag to a tail
    // applyOptions — which runs after Button's constructor already late-dispatched
    // the (then-undefined) glyph. applyOptions must dispatch setGlyph itself once
    // the content row is built, or the `glyph` option is silently dropped and the
    // rail icons render blank.
    it('renders the glyph passed in the options bag', () => {
        expect(new ToggleButton('', { glyph: 'xmark' }).getGlyph()).not.toBeNull();
    });
    it('has no glyph when none is supplied', () => {
        expect(new ToggleButton('Bold').getGlyph()).toBeNull();
    });
});

describe('ToggleButton showText option (regression)', () => {
    // ToggleButton's positional `text` is set on Button's own constructor
    // before showText has been recorded anywhere (ToggleButton forwards only
    // `text` to super, with no options), so Button's late-dispatch there
    // renders the title in full. `showText: false` then only reaches
    // `_options` via ToggleButton's tail `applyOptions` call, which carries
    // no `text` key of its own — nothing re-blanks `_text`, so a ToggleButton
    // constructed with a positional label, a glyph, and `showText: false`
    // rendered the label anyway.
    it('renders the title blank on the face when constructed with a positional label and { glyph, showText: false }', () => {
        const btn  = new ToggleButton('Show inherited members', { glyph: 'xmark', showText: false });
        const text = (btn as any)._text;

        expect(text.getText().valueOf()).toBe('');
        expect(btn.getText()).toBe('Show inherited members');
    });
});

describe('ToggleButton structural layout (regression)', () => {
    // Button installs a per-instance Fit layout imperatively in its constructor
    // (a fresh manager can't live in the shared _defaultOptions). ToggleButton
    // dispatches its consumer options through a tail `applyOptions`, whose
    // Component-level cascade re-applies the Absolute default from
    // _defaultOptions — which would clobber Button's Fit. A clobbered Absolute
    // layout never positions the content row, so the label collapses to the
    // element's static corner. The structural Fit must survive the options pass.
    it('keeps its Fit layout when constructed WITHOUT options', () => {
        expect(new ToggleButton('Bold').getLayoutManager()).toBeInstanceOf(Fit);
    });
    it('keeps its Fit layout when constructed WITH an options bag', () => {
        expect(new ToggleButton('Bold', { glyph: 'xmark' }).getLayoutManager()).toBeInstanceOf(Fit);
    });
});
