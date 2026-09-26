// @vitest-environment jsdom
//
// Glyphs.ts holds the shared hidden SVG sprite — its element `Handle`, the
// "already mounted" flag, and the record of which `<symbol>`s it carries — in
// module state. A `Handle` is only meaningful to the seam that minted it:
// `DOM.reset()` rebuilds the shared registry outright, while `installTestDOM`
// and `DOM.install({ sink })` route later writes through a sink that resolves
// handles from a table of its own. So the sprite record has to be dropped when
// the sink it was built against is replaced. Without that, the first symbol
// mounted after a swap appends through a handle the live sink never minted —
// under the production pair, into whatever element now holds that recycled
// handle number.
//
// The modelled test DOM is not the right harness for this: it models its own
// handle table, so the corruption these cases pin is a property of the
// production sink/source pair. This file keeps the `@vitest-environment jsdom`
// pragma and runs against that pair (the recipe
// tests/component/activation-after-dispose.test.ts and
// tests/dom/event-subtree-reentrant-dispose.test.ts already use), and must not
// call installTestDOM.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { Glyph } from '~/component/display/Glyph';
import { lookupGlyph } from '~/component/display/Glyphs';

const ALPHA = { name: 'gss-alpha', kind: 'svg' as const, viewBox: '0 0 512 512', path: 'M0 0h512v512z' };
const BETA  = { name: 'gss-beta',  kind: 'svg' as const, viewBox: '0 0 512 512', path: 'M0 0h256v256z' };
const GAMMA = { name: 'gss-gamma', kind: 'svg' as const, viewBox: '0 0 512 512', path: 'M0 0h128v128z' };

// Deliberately not registered below — registering it is what its own case does.
const DELTA = { name: 'gss-delta', kind: 'svg' as const, viewBox: '0 0 512 512', path: 'M0 0h64v64z' };

// Registered at module scope, not in a hook: registration mounts nothing while
// no sprite exists, so it touches no DOM, and the definitions must outlive
// every DOM.reset() below for S3 to mean anything.
Glyph.register(ALPHA, BETA, GAMMA);

afterEach(() => {
    DOM.reset();
});

/** The tag name of the element holding the `<symbol>` for `name`, or `'MISSING'`. */
function symbolParent(name: string): string {
    return document.querySelector('#ts-glyph-' + name)?.parentElement?.tagName ?? 'MISSING';
}

/**
 * How many `<symbol>`s carrying `name`'s sprite id exist in the document.
 *
 * Counted rather than looked up, because a reset orphans the sprite it replaces
 * without removing it (see the note on `spriteCount`), so the document ends up
 * holding several `<symbol>`s with the same id and `querySelector` only ever
 * answers with the oldest. A *delta* on this count is what distinguishes a
 * symbol genuinely re-mounted into the rebuilt sprite from the stale one an id
 * lookup would find either way.
 */
function symbolCount(name: string): number {
    return document.querySelectorAll('#ts-glyph-' + name).length;
}

/** Every hidden sprite `<svg>` currently under the body. */
function spriteCount(): number {
    return document.body.querySelectorAll('svg[aria-hidden="true"]').length;
}

/** Renders a glyph unattached to any host — enough to mount the sprite. */
function render(name: string): void {
    new Glyph(name).getElement(true);
}

describe('glyph sprite across a seam swap', () => {

    it('mounts a first-seen symbol into a live sprite after a reset', () => {
        render('gss-alpha');

        const before = symbolCount('gss-beta');

        DOM.reset();

        render('gss-beta');

        expect(symbolCount('gss-beta')).toBe(before + 1);
        expect(symbolParent('gss-beta')).toBe('svg');
    });

    it('rebuilds the sprite and re-mounts a known symbol after a reset', () => {
        render('gss-alpha');

        const sprites = spriteCount();
        const symbols = symbolCount('gss-alpha');

        DOM.reset();

        render('gss-alpha');

        // The second assertion is the one that pins the mounted-symbol record
        // being dropped alongside the sprite: without that, the rebuilt sprite
        // is skipped as "already mounted" and stays empty for this name.
        expect(spriteCount()).toBe(sprites + 1);
        expect(symbolCount('gss-alpha')).toBe(symbols + 1);
    });

    it('keeps the glyph definition registry across a reset', () => {
        render('gss-alpha');

        DOM.reset();

        expect(lookupGlyph('gss-alpha')).toBeDefined();
    });

    it('keeps the sprite when only the source is swapped', () => {
        render('gss-alpha');

        const sprites = spriteCount();
        const symbols = symbolCount('gss-beta');

        DOM.install({ source: Object.create(DOM.source) as typeof DOM.source });

        render('gss-beta');

        // No new sprite, and the incoming symbol went into the one already
        // there — a source-keyed check would rebuild instead and fail the first.
        expect(spriteCount()).toBe(sprites);
        expect(symbolCount('gss-beta')).toBe(symbols + 1);
    });

    it('unregisters a glyph after a reset without touching a dead handle', () => {
        render('gss-gamma');

        DOM.reset();

        // unregisterGlyph would otherwise remove the `<symbol>` through the
        // handles the discarded registry minted, and resolving one throws.
        expect(() => Glyph.unregister('gss-gamma')).not.toThrow();
    });

    it('registers an SVG glyph after a reset without touching a dead handle', () => {
        render('gss-alpha');

        DOM.reset();

        // registerGlyph mounts an incoming SVG glyph's `<symbol>` immediately
        // whenever it believes a sprite is already up. After a reset that belief
        // is stale, and the append would go through the dead sprite handle.
        expect(() => Glyph.register(DELTA)).not.toThrow();

        // It mounted nothing, because the reset left no sprite to mount into;
        // the `<symbol>` arrives when the name is first rendered instead.
        render('gss-delta');

        expect(symbolParent('gss-delta')).toBe('svg');
    });
});
