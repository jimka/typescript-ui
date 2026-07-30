import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Glyph } from '~/component/display/Glyph';
import { Component } from '~/core/Component';
import { lookupGlyph } from '~/component/display/Glyphs';
import { xmark } from '~/glyphs/solid/xmark';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Harness installed throughout so element-resolving and sprite-mount paths run
// offline and any scheduled layout is inert. The four `unicode-arrow-*` char
// glyphs are seeded unconditionally, so they are always present without
// registration; SVG-kind cases register `xmark` inside the test and clean up.
beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('Glyph name resolution', () => {
    it('looks up the always-seeded unicode-arrow-up as a char def', () => {
        const def = lookupGlyph('unicode-arrow-up');

        expect(def).toBeDefined();
        expect(def!.kind).toBe('char');
    });
    it('throws "Unknown glyph: <name>" for an unregistered name', () => {
        expect(() => new Glyph('definitely-not-registered'))
            .toThrow('Unknown glyph: definitely-not-registered');
    });
    it('exposes the constructed name via getGlyphName', () => {
        expect(new Glyph('unicode-arrow-up').getGlyphName()).toBe('unicode-arrow-up');
    });
});

describe('Glyph char-mode defaults', () => {
    it('defaults line-height to "1" for a char glyph', () => {
        expect(new Glyph('unicode-arrow-up').getLineHeight()).toBe('1');
    });
    it('defaults text-align to "center" for a char glyph', () => {
        expect(new Glyph('unicode-arrow-up').getTextAlign()).toBe('center');
    });
    it('honours an explicit lineHeight option over the char default', () => {
        expect(new Glyph('unicode-arrow-up', { lineHeight: '2' }).getLineHeight()).toBe('2');
    });
});

describe('Glyph svg-mode defaults', () => {
    afterEach(() => Glyph.unregister('xmark'));

    it('leaves line-height unset for an svg glyph', () => {
        Glyph.register(xmark);

        expect(new Glyph('xmark').getLineHeight()).toBe(null);
    });
    it('leaves text-align unset for an svg glyph', () => {
        Glyph.register(xmark);

        expect(new Glyph('xmark').getTextAlign()).toBe(null);
    });
    it('constructs and renders an svg glyph without throwing (sprite mount)', () => {
        Glyph.register(xmark);

        const glyph = new Glyph('xmark');

        expect(() => glyph.getElement(true)).not.toThrow();
        expect(glyph.getGlyphName()).toBe('xmark');
    });
});

describe('Glyph register / unregister round-trip', () => {
    // Safety net: if an assertion throws between register and the body's
    // unregister, this keeps `xmark` from leaking into the global registry and
    // polluting later tests. unregister is a no-op when already removed.
    afterEach(() => Glyph.unregister('xmark'));

    it('finds a glyph after register and drops it after unregister', () => {
        Glyph.register(xmark);
        expect(lookupGlyph('xmark')).toBeDefined();

        // A Glyph for the registered name constructs cleanly.
        expect(() => new Glyph('xmark')).not.toThrow();

        Glyph.unregister('xmark');

        expect(lookupGlyph('xmark')).toBeUndefined();
        expect(() => new Glyph('xmark')).toThrow('Unknown glyph: xmark');
    });
});

describe('Glyph font-size cache', () => {
    it('returns null before any setFontSize', () => {
        expect(new Glyph('unicode-arrow-up').getFontSize()).toBe(null);
    });
    it('caches and reflects setFontSize', () => {
        const glyph = new Glyph('unicode-arrow-up');

        glyph.setFontSize(20);

        expect(glyph.getFontSize()).toBe(20);
    });
    it('applies a fontSize option at construction', () => {
        expect(new Glyph('unicode-arrow-up', { fontSize: 18 }).getFontSize()).toBe(18);
    });
});

describe('Glyph size lock', () => {
    it('pins min == pref == max via setPreferredSize', () => {
        const glyph = new Glyph('unicode-arrow-up');

        glyph.setPreferredSize({ width: 24, height: 24 });

        const pref = glyph.getPreferredSize()!;
        const min  = glyph.getMinSize()!;
        const max  = glyph.getMaxSize()!;

        expect(pref.width).toBe(24);
        expect(min.width).toBe(24);
        expect(max.width).toBe(24);
        expect(min.height).toBe(24);
        expect(max.height).toBe(24);
    });
    it('defaults the preferred size to 16x16', () => {
        const pref = new Glyph('unicode-arrow-up').getPreferredSize()!;

        expect(pref.width).toBe(16);
        expect(pref.height).toBe(16);
    });
    it('case 8: setPreferredSize(size) locks min == pref == max to the given Size', () => {
        const glyph = new Glyph('unicode-arrow-up');

        glyph.setPreferredSize({ width: 16, height: 16 });

        expect(glyph.getPreferredSize()).toEqual({ width: 16, height: 16 });
        expect(glyph.getMinSize()).toEqual({ width: 16, height: 16 });
        expect(glyph.getMaxSize()).toEqual({ width: 16, height: 16 });
    });
});

describe('Glyph baseline', () => {
    it('returns preferredHeight - 3 with the default size', () => {
        // Default preferred height is 16, so baseline is 13.
        expect(new Glyph('unicode-arrow-up').getBaseline()).toBe(13);
    });
    it('tracks an explicit preferred height', () => {
        const glyph = new Glyph('unicode-arrow-up');

        glyph.setPreferredSize({ width: 30, height: 30 });

        expect(glyph.getBaseline()).toBe(27);
    });
});

// An animated Glyph must stop consuming frames once it is no longer effectively
// visible, exactly as ProgressSpinner's arc does
// (tests/component/display/ProgressSpinner.test.ts:65-74). Glyph drives its
// animation from a shared CSS class rather than Component.setAnimation, so the
// base onEffectiveVisibilityChange — which only pauses when getAnimation() is
// non-null — cannot see it; these pin that the pause happens anyway.
describe('Glyph animation pauses while hidden', () => {
    it('pauses its animation when it stops being effectively visible', () => {
        const glyph = new Glyph('unicode-arrow-up', { animation: 'spin' });

        glyph.getElement(true);

        expect(glyph.getAnimationPlayState()).toBeNull();

        glyph.setVisible(false);
        Component.flushEffectiveVisibility();

        expect(glyph.getAnimationPlayState()).toBe('paused');
    });

    it('resumes the animation when it becomes effectively visible again', () => {
        const glyph = new Glyph('unicode-arrow-up', { animation: 'spin' });

        glyph.getElement(true);
        glyph.setVisible(false);
        Component.flushEffectiveVisibility();
        glyph.setVisible(true);
        Component.flushEffectiveVisibility();

        expect(glyph.getAnimationPlayState()).toBeNull();
    });

    it('pauses when an ancestor is hidden, not just the glyph itself', () => {
        const parent = new Component();
        const glyph  = new Glyph('unicode-arrow-up', { animation: 'spin' });

        parent.addComponent(glyph);
        parent.getElement(true);

        parent.setVisible(false);
        Component.flushEffectiveVisibility();

        expect(glyph.getAnimationPlayState()).toBe('paused');
    });

    it('leaves an unanimated glyph alone', () => {
        const glyph = new Glyph('unicode-arrow-up');

        glyph.getElement(true);
        glyph.setVisible(false);
        Component.flushEffectiveVisibility();

        expect(glyph.getAnimationPlayState()).toBeNull();
    });
});
