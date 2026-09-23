//
// `Glyph.setGlyphName` mounts the incoming name's sprite `<symbol>` before it
// repoints the `<use>` at it. Without that, a rename to a name no `Glyph` was
// ever constructed for would leave a dangling `href="#ts-glyph-…"`: an app
// registers its icon set up front, and `registerGlyph` mounts a `<symbol>`
// eagerly only once the sprite itself exists, which does not happen until the
// first SVG glyph renders.
//
// This needs its own file, and exactly one case in it. The sprite and its
// mounted-symbol record are module state that `DOM.reset()` does not touch, so
// the moment anything in a file has rendered an SVG glyph, every later
// `Glyph.register` mounts its `<symbol>` there and then — and the rename has
// nothing left to mount. Only the first SVG render of a fresh module instance
// leaves a registered-but-unmounted name behind, so the case has to be the
// first thing the file does.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Glyph } from '~/component/display/Glyph';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(CONFIG); });
afterEach(() => DOM.reset());

describe('Glyph.setGlyphName sprite mounting', () => {
    it('mounts the incoming name\'s <symbol> and points the <use> at it', () => {
        Glyph.register(
            { name: 'grsm-rendered', kind: 'svg', viewBox: '0 0 512 512', path: 'M0 0h512v512z' },
            { name: 'grsm-renamed',  kind: 'svg', viewBox: '0 0 512 512', path: 'M0 0h256v256z' },
        );

        // The sprite does not exist until this render, so neither registration
        // above mounted anything: the first render mounts the sprite and only
        // its own `<symbol>`, leaving `grsm-renamed` registered but unmounted.
        const glyph = new Glyph('grsm-rendered');
        const root  = glyph.getElement(true)!;

        const symbolIds = (): Array<string | undefined> => sink.writes
            .filter(w => w.op === 'apply')
            .map(w => (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.id)
            .filter(id => id !== undefined);

        expect(symbolIds()).toEqual(['ts-glyph-grsm-rendered']);

        glyph.setGlyphName('grsm-renamed');

        // The rename mounted the missing `<symbol>` itself, so the `<use>` it
        // repointed resolves to real path data rather than a dangling id.
        expect(symbolIds()).toEqual(['ts-glyph-grsm-rendered', 'ts-glyph-grsm-renamed']);

        const svg = sink.writes.find(w =>
            w.op === 'appendChild'
            && w.args[0] === root
            && DOM.source.getTagName(w.args[1] as Handle) === 'SVG')!.args[1] as Handle;
        const use = sink.writes.find(w =>
            w.op === 'appendChild'
            && w.args[0] === svg
            && DOM.source.getTagName(w.args[1] as Handle) === 'USE')!.args[1] as Handle;

        expect(DOM.source.getAttribute(use, 'href')).toBe('#ts-glyph-grsm-renamed');
    });
});
