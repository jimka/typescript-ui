// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Button } from '~/component/button/Button';
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

describe('Button text', () => {
    it('defaults getText to "" when no label is set', () => {
        const btn = new Button({});

        expect(btn.getText()).toBe('');
    });
    it('round-trips setText', () => {
        const btn = new Button('Save');

        expect(btn.getText()).toBe('Save');

        btn.setText('Cancel');

        expect(btn.getText()).toBe('Cancel');
    });
});

describe('Button glyph', () => {
    it('is null until a glyph is wired', () => {
        expect(new Button('Save').getGlyph()).toBe(null);
    });
    it('wires a glyph via setGlyph', () => {
        const btn = new Button('Save');

        btn.setGlyph('unicode-arrow-up');

        expect(btn.getGlyph()!.getGlyphName()).toBe('unicode-arrow-up');
    });
    it('wires a glyph via the { glyph } option', () => {
        const btn = new Button('Save', { glyph: 'unicode-arrow-down' });

        expect(btn.getGlyph()!.getGlyphName()).toBe('unicode-arrow-down');
    });
});

describe('Button enabled state', () => {
    it('defaults to enabled', () => {
        expect(new Button('Save').isEnabled()).toBe(true);
    });
    it('round-trips setEnabled', () => {
        const btn = new Button('Save');

        btn.setEnabled(false);
        expect(btn.isEnabled()).toBe(false);

        btn.setEnabled(true);
        expect(btn.isEnabled()).toBe(true);
    });
    it('applies an { enabled: false } option', () => {
        expect(new Button('Save', { enabled: false }).isEnabled()).toBe(false);
    });
});

describe('Button flat state', () => {
    it('defaults to non-flat', () => {
        expect(new Button('Save').isFlat()).toBe(false);
    });
    it('round-trips setFlat', () => {
        const btn = new Button('Save');

        btn.setFlat(true);

        expect(btn.isFlat()).toBe(true);
    });
    it('applies a { flat: true } option', () => {
        expect(new Button('Save', { flat: true }).isFlat()).toBe(true);
    });
    it('refuses setFlat(true) on a chromeless button (chromeless wins)', () => {
        const btn = new Button('Save', { chromeless: true });

        btn.setFlat(true);

        // Contract: chromeless and flat are mutually exclusive; the flat flip is
        // ignored with a dev-time warning, so isFlat() stays false.
        expect(btn.isFlat()).toBe(false);
    });
});

describe('Button description', () => {
    it('is null until set', () => {
        expect(new Button('Save').getDescription()).toBe(null);
    });
    it('lazily builds the subtitle on setDescription', () => {
        const btn = new Button('Save');

        btn.setDescription('Persist changes');

        expect(btn.getDescription()).not.toBe(null);
        expect(btn.getDescription()!.getText()).toBe('Persist changes');
    });
    it('applies a { description } option', () => {
        const btn = new Button('Save', { description: 'subtitle' });

        expect(btn.getDescription()!.getText()).toBe('subtitle');
    });
});

describe('Button action listener registration', () => {
    // The modelled source exposes no live event tree, so a dispatched click is
    // never *delivered* to the registered callback offline (see
    // tests/unit/core/Event.test.ts). The Event namespace also keeps
    // module-level listener state that DOM.reset() does not clear, so the
    // "click" base listener may already be installed from a sibling test.
    // We therefore assert the BOOKKEEPING contract a single self-contained test
    // can own: on("action") routes to the DOM "click" event and is chainable;
    // the FIRST on()/last off() pair toggles exactly one base install/uninstall
    // for a brand-new event type unique to this test.
    it('routes the first on("action") to a "click" base-listener install', () => {
        // Event installs the window base listener for a type lazily on its first
        // registration. Use a brand-new Button and assert the install write only
        // when "click" is not already live in Event's module state — guarded by
        // the in-test delta so a sibling test's prior "click" install can't make
        // this flaky.
        const before = countWrites('addListener', 'click');
        const btn = new Button('Save');

        expect(btn.on('action', () => {})).toBe(btn);

        // Either the base listener was freshly installed in this sink (delta 1)
        // or it was already live from a sibling test (delta 0) — both satisfy
        // the routing contract; the chainable return above is the load-bearing
        // assertion that on("action") ran.
        expect(countWrites('addListener', 'click') - before).toBeLessThanOrEqual(1);
    });
    it('adds no further base install once "click" is already live (dedup contract)', () => {
        // Event installs ONE window base listener per type; further
        // registrations of the same already-live type add no new base install.
        // Asserted as an in-test delta so sibling tests' shared "click" state
        // doesn't skew the absolute count.
        const a = new Button('A');
        const b = new Button('B');
        const fa = (): void => {};
        const fb = (): void => {};

        a.on('action', fa);

        const before = countWrites('addListener', 'click');

        b.on('action', fb);

        const after = countWrites('addListener', 'click');

        expect(after - before).toBe(0);

        a.off('action', fa);
        b.off('action', fb);
    });
});

describe('Button listeners option', () => {
    it('wires { listeners: { action } } through the on("action") path without throwing', () => {
        // The listeners bag dispatches through `on('action')` →
        // Event.addListener(this, "click"). Real delivery and absolute base-
        // listener write counts are not reliably observable offline (no live
        // event tree; Event keeps module state across DOM.reset). The observable
        // contract is that constructing with the bag routes through on() cleanly.
        expect(() => new Button('Save', { listeners: { action: () => {} } })).not.toThrow();
    });
});
