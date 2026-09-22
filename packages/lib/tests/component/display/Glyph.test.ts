import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Glyph } from '~/component/display/Glyph';
import { Component } from '~/core/Component';
import { lookupGlyph, type NamedGlyphDef } from '~/component/display/Glyphs';
import { xmark } from '~/glyphs/solid/xmark';
import { DOM, type Handle } from '~/core/DOM';
import { GLYPH_XS_INK_TRAIT } from '~/core/StyleTraits';
import { installTestDOM, ruleStyleWrites, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { ThemeManager, ModernTheme, defineTheme } from '~/core/Theme';

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
let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(CONFIG); });
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
    it('a fresh Glyph at the default 16x16 size writes no real min/max declaration to its own #id rule', () => {
        const glyph = new Glyph('unicode-arrow-up');
        glyph.getElement(true);

        const sizeRows = ruleStyleWrites(sink).filter(r =>
            r.selector === '#' + glyph.getId()
            && ['minWidth', 'minHeight', 'maxWidth', 'maxHeight'].includes(r.key));

        // #id still materialises for this char-mode glyph — lineHeight/
        // textAlign are real, unrelated per-instance declarations written
        // from the constructor body (see _defaultGlyphOptions's doc comment)
        // — so the four size keys ride along in the same batch as explicit
        // removals rather than vanishing outright, the same pattern
        // CheckboxBox's row 1 test (Checkbox.test.ts) already established for
        // a rule forced to materialise by other real content.
        expect(sizeRows.map(r => r.key).sort()).toEqual(['maxHeight', 'maxWidth', 'minHeight', 'minWidth']);
        expect(sizeRows.every(r => r.value === null)).toBe(true);
    });
    it('case 8: setPreferredSize(size) locks min == pref == max to the given Size', () => {
        const glyph = new Glyph('unicode-arrow-up');

        glyph.setPreferredSize({ width: 16, height: 16 });

        expect(glyph.getPreferredSize()).toEqual({ width: 16, height: 16 });
        expect(glyph.getMinSize()).toEqual({ width: 16, height: 16 });
        expect(glyph.getMaxSize()).toEqual({ width: 16, height: 16 });
    });

    // The default preferred size is resolved per construction from the
    // theme's glyphLg icon step, not frozen at module load — see
    // plans/in-progress/glyph-icon-size-scale.md.
    describe('default size follows the theme scale', () => {
        afterEach(() => ThemeManager.setTheme(ModernTheme));

        it('grows a Glyph constructed after a raised scale.base', () => {
            ThemeManager.setTheme(defineTheme(ModernTheme, { scale: { base: 28 } }));

            const pref = new Glyph('unicode-arrow-up').getPreferredSize()!;

            expect(pref).toEqual({ width: 32, height: 32 });
        });
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

// Blink refuses to run a transform animation on an SVG element on the compositor
// thread, so an animation mounted on an `<svg>` root forces a full-document
// Layerize pass every frame. These pin the structure that avoids it: the root is
// always an animatable HTML element and the `<svg>` hangs inside it.
describe('Glyph renders an HTML root so its animation can composite', () => {
    afterEach(() => Glyph.unregister('xmark'));

    /** The `<svg>` appended into `root`, or null when the glyph created none. */
    const innerSvgOf = (root: Handle): Handle | null => {
        const write = sink.writes.find(w =>
            w.op === 'appendChild'
            && w.args[0] === root
            && DOM.source.getTagName(w.args[1] as Handle) === 'SVG');

        return write ? write.args[1] as Handle : null;
    };

    it('gives an svg-kind glyph a SPAN root, not an SVG root', () => {
        Glyph.register(xmark);

        const root = new Glyph('xmark').getElement(true)!;

        expect(DOM.source.getTagName(root)).toBe('SPAN');
    });

    it('hangs the <svg> inside the root as a tracked child', () => {
        Glyph.register(xmark);

        const root = new Glyph('xmark').getElement(true)!;
        const svg  = innerSvgOf(root);

        expect(svg).not.toBeNull();
        expect(sink.writes.some(w =>
            w.op === 'appendChild' && w.args[0] === root && w.args[1] === svg)).toBe(true);
    });

    it('leaves a char-kind glyph as a bare SPAN with no <svg>', () => {
        const root = new Glyph('unicode-arrow-up').getElement(true)!;

        expect(DOM.source.getTagName(root)).toBe('SPAN');
        expect(innerSvgOf(root)).toBeNull();
        expect(sink.writes.some(w =>
            w.op === 'apply' && w.args[0] === root
            && (w.args[1] as { text?: string }).text === '▲')).toBe(true);
    });

    it('puts the animation class on the root, not on the inner <svg>', () => {
        Glyph.register(xmark);

        const root = new Glyph('xmark', { animation: 'spin' }).getElement(true)!;
        const svg  = innerSvgOf(root);

        const animationClassWrites = sink.writes.filter(w =>
            w.op === 'apply'
            && (w.args[1] as { addClass?: string[] }).addClass?.includes('ts-ui-glyph-spin'));

        expect(animationClassWrites.length).toBeGreaterThan(0);
        expect(animationClassWrites.every(w => w.args[0] === root)).toBe(true);
        expect(animationClassWrites.some(w => w.args[0] === svg)).toBe(false);
    });

    it('keeps a construction-time animationDuration through render', () => {
        Glyph.register(xmark);

        const glyph = new Glyph('xmark', { animation: 'spin', animationDuration: 500 });
        glyph.getElement(true);

        expect(ruleStyleWrites(sink)).toContainEqual({
            selector: '#' + glyph.getId(),
            key:      'animationDuration',
            value:    '500ms',
        });
    });

    it('writes no animation-duration for a duration without an animation', () => {
        Glyph.register(xmark);

        const glyph = new Glyph('xmark', { animationDuration: 500 });
        glyph.getElement(true);

        const durationRows = ruleStyleWrites(sink).filter(r =>
            r.selector === '#' + glyph.getId() && r.key === 'animationDuration');

        expect(durationRows).toEqual([]);
        expect(glyph.getAnimationDuration()).toBe(500);
    });

    it('no longer parks a will-change hint on an animated glyph', () => {
        Glyph.register(xmark);

        const glyph = new Glyph('xmark', { animation: 'spin' });
        glyph.getElement(true);

        expect(glyph.getWillChange()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// setGlyphName — the in-place rename. The sprite and its mounted-symbol record
// are module state that `DOM.reset()` does not touch, so every case below that
// asserts a `<symbol>` mount registers a name no other case in this file uses,
// and drops it again afterwards.
// ---------------------------------------------------------------------------
describe('Glyph.setGlyphName', () => {

    /** Every registry name these cases mint, dropped again after each one. */
    const MINTED = [
        'gns-from', 'gns-to',
        'gns-pre-a', 'gns-pre-b',
        'gns-svg-to-char', 'gns-char-to-svg',
        'gns-state-a', 'gns-state-b',
        'gns-shared-a', 'gns-shared-mount',
        'gns-three', 'gns-unregister',
    ];

    afterEach(() => {
        for (const name of MINTED) {
            Glyph.unregister(name);
        }
    });

    /** An SVG registry entry under `name`, shaped like the shipped icon modules. */
    const svgDef = (name: string): NamedGlyphDef => ({
        name,
        kind:    'svg',
        viewBox: '0 0 512 512',
        path:    'M0 0h512v512z',
    });

    /** Every recorded write of one sink op. */
    const opsOf = (op: string): RecordingDOMSink['writes'] => sink.writes.filter(w => w.op === op);

    /** Every recorded stylesheet-rule write, of any of the three kinds. */
    const ruleOps = (): RecordingDOMSink['writes'] => sink.writes.filter(w =>
        w.op === 'ensureStyleRule' || w.op === 'setRuleStyles' || w.op === 'deleteStyleRule');

    /** Every recorded `createElementNS` for one tag name. */
    const nsCreations = (tag: string): RecordingDOMSink['writes'] => sink.writes.filter(w =>
        w.op === 'createElementNS' && w.args[1] === tag);

    /**
     * Every sprite `<symbol>` mounted so far for one registry name, identified
     * by the `ts-glyph-<name>` id the mount writes. Counted by id rather than
     * by tag because a registration that arrives while the sprite is already up
     * mounts the symbol there and then, before a rename can ask for it.
     */
    const symbolMountsFor = (name: string): RecordingDOMSink['writes'] => sink.writes.filter(w =>
        w.op === 'apply'
        && (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.id === 'ts-glyph-' + name);

    /** The handles released so far, in release order. */
    const releasedHandles = (): Handle[] => opsOf('release').map(w => w.args[0] as Handle);

    /** Every recorded `apply` patch targeting one element. */
    const appliesTo = (handle: Handle): Array<Record<string, unknown>> => sink.writes
        .filter(w => w.op === 'apply' && w.args[0] === handle)
        .map(w => w.args[1] as Record<string, unknown>);

    /** The first child of `parent` with the given tag appended so far, or null. */
    const childOf = (parent: Handle, tag: string): Handle | null => {
        const write = sink.writes.find(w =>
            w.op === 'appendChild'
            && w.args[0] === parent
            && DOM.source.getTagName(w.args[1] as Handle) === tag);

        return write ? write.args[1] as Handle : null;
    };

    /** The `<use>` inside the `<svg>` this root holds, or null when there is none. */
    const useChildOf = (root: Handle): Handle | null => {
        const svg = childOf(root, 'SVG');

        return svg ? childOf(svg, 'USE') : null;
    };

    it('renaming to the name already showing returns the glyph and reaches the sink not at all', () => {
        const glyph = new Glyph('unicode-arrow-up');
        glyph.getElement(true);
        sink.writes.length = 0;

        expect(glyph.setGlyphName('unicode-arrow-up')).toBe(glyph);
        expect(sink.writes).toHaveLength(0);
    });

    it('an unregistered name throws and leaves the glyph exactly as it was', () => {
        const glyph = new Glyph('unicode-arrow-up');
        glyph.getElement(true);
        sink.writes.length = 0;

        expect(() => glyph.setGlyphName('nope')).toThrow('Unknown glyph: nope');
        expect(glyph.getGlyphName()).toBe('unicode-arrow-up');
        expect(sink.writes).toHaveLength(0);
    });

    it('a rendered svg glyph renamed to another svg name repoints its <use> and builds nothing', () => {
        Glyph.register(svgDef('gns-from'), svgDef('gns-to'));

        const glyph = new Glyph('gns-from');
        const root  = glyph.getElement(true)!;
        const use   = useChildOf(root)!;

        sink.writes.length = 0;
        glyph.setGlyphName('gns-to');

        expect(glyph.getGlyphName()).toBe('gns-to');
        expect(DOM.source.getAttribute(use, 'href')).toBe('#ts-glyph-gns-to');
        expect(glyph.getElement()).toBe(root);
        expect(ruleOps()).toHaveLength(0);
        expect(opsOf('createElement')).toHaveLength(0);
        expect(nsCreations('svg')).toHaveLength(0);
        expect(nsCreations('use')).toHaveLength(0);
        expect(opsOf('removeElement')).toHaveLength(0);
        expect(opsOf('release')).toHaveLength(0);
    });

    it('an unrendered svg glyph renamed before its first render paints the new name', () => {
        Glyph.register(svgDef('gns-pre-a'), svgDef('gns-pre-b'));

        const glyph = new Glyph('gns-pre-a');

        glyph.setGlyphName('gns-pre-b');

        const root = glyph.getElement(true)!;

        expect(nsCreations('use')).toHaveLength(1);
        expect(DOM.source.getAttribute(useChildOf(root)!, 'href')).toBe('#ts-glyph-gns-pre-b');
    });

    it('a rendered char glyph renamed to another char name writes the new character once', () => {
        const glyph = new Glyph('unicode-arrow-up');
        const root  = glyph.getElement(true)!;

        sink.writes.length = 0;
        glyph.setGlyphName('unicode-arrow-down');

        const applies = appliesTo(root);

        expect(applies).toHaveLength(1);
        expect(applies[0].text).toBe('▼');
    });

    it('a rendered svg glyph renamed to a char name tears the <svg> down and applies the char defaults', () => {
        Glyph.register(svgDef('gns-svg-to-char'));

        const glyph = new Glyph('gns-svg-to-char');
        const root  = glyph.getElement(true)!;
        const svg   = childOf(root, 'SVG')!;
        const use   = useChildOf(root)!;

        sink.writes.length = 0;
        glyph.setGlyphName('unicode-arrow-down');

        const applies = appliesTo(root);

        expect(opsOf('removeElement')).toHaveLength(1);
        expect(releasedHandles()).toContain(svg);
        expect(releasedHandles()).toContain(use);
        expect(applies).toHaveLength(1);
        expect(applies[0].text).toBe('▼');
        expect(glyph.getLineHeight()).toBe('1');
        expect(glyph.getTextAlign()).toBe('center');
    });

    it('a rendered char glyph renamed to an svg name clears the text and builds the <svg>', () => {
        Glyph.register(svgDef('gns-char-to-svg'));

        const glyph = new Glyph('unicode-arrow-up');
        const root  = glyph.getElement(true)!;

        sink.writes.length = 0;
        glyph.setGlyphName('gns-char-to-svg');

        const applies = appliesTo(root);

        expect(applies).toHaveLength(1);
        expect(applies[0].text).toBe('');
        expect(childOf(root, 'SVG')).not.toBeNull();
        expect(DOM.source.getAttribute(useChildOf(root)!, 'href')).toBe('#ts-glyph-gns-char-to-svg');
        expect(glyph.getLineHeight()).toBe('1');
    });

    it('a rename keeps the instance, its id, colour, size, trait and running animation', () => {
        Glyph.register(svgDef('gns-state-a'), svgDef('gns-state-b'));

        const glyph = new Glyph('gns-state-a', { styleTrait: GLYPH_XS_INK_TRAIT, animation: 'spin' });

        glyph.setForegroundColor('red');
        glyph.setPreferredSize({ width: 24, height: 24 });

        const root = glyph.getElement(true)!;
        const id   = glyph.getId();

        sink.writes.length = 0;
        glyph.setGlyphName('gns-state-b');

        expect(glyph.getId()).toBe(id);
        expect(glyph.getForegroundColor()).toBe('red');
        expect(glyph.getPreferredSize()).toEqual({ width: 24, height: 24 });
        expect(glyph.getStyleTrait()).toBe(GLYPH_XS_INK_TRAIT);
        expect(glyph.getAnimated()).toBe('spin');
        expect(appliesTo(root).some(patch =>
            ((patch.removeClass as string[] | undefined) ?? []).includes('ts-ui-glyph-spin'))).toBe(false);
        expect(sink.writes.filter(w =>
            w.op === 'deleteStyleRule'
            && w.args[0] === '#' + DOM.source.escapeSelector(id))).toHaveLength(0);
    });

    it('two glyphs renamed to the same svg name leave one <symbol> mounted for it', () => {
        const spy = vi.spyOn(DOM.source, 'querySelector');

        Glyph.register(svgDef('gns-shared-a'), svgDef('gns-shared-mount'));

        const first  = new Glyph('gns-shared-a');
        const second = new Glyph('gns-shared-a');

        first.getElement(true);
        second.getElement(true);
        first.setGlyphName('gns-shared-mount');
        second.setGlyphName('gns-shared-mount');

        expect(symbolMountsFor('gns-shared-mount')).toHaveLength(1);
        expect(spy).not.toHaveBeenCalled();
    });

    it('three glyphs of one svg name mount one <symbol>, with no selector query', () => {
        const spy = vi.spyOn(DOM.source, 'querySelector');

        Glyph.register(svgDef('gns-three'));

        new Glyph('gns-three').getElement(true);
        new Glyph('gns-three').getElement(true);
        new Glyph('gns-three').getElement(true);

        expect(symbolMountsFor('gns-three')).toHaveLength(1);
        expect(nsCreations('symbol')).toHaveLength(1);
        expect(spy).not.toHaveBeenCalled();
    });

    it('unregistering a mounted name drops its <symbol>, and registering it again mounts a new one', () => {
        Glyph.register(svgDef('gns-unregister'));
        new Glyph('gns-unregister').getElement(true);

        const symbol = sink.writes.find(w =>
            w.op === 'appendChild'
            && DOM.source.getTagName(w.args[1] as Handle) === 'SYMBOL')!.args[1] as Handle;
        const path = childOf(symbol, 'PATH')!;

        sink.writes.length = 0;
        Glyph.unregister('gns-unregister');

        expect(opsOf('removeChild')).toHaveLength(1);
        expect(releasedHandles()).toContain(symbol);
        expect(releasedHandles()).toContain(path);

        Glyph.register(svgDef('gns-unregister'));
        new Glyph('gns-unregister').getElement(true);

        expect(nsCreations('symbol')).toHaveLength(1);
    });
});
