// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Image } from '~/component/display/Image';
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

// The offline ModelledDOMSource reports natural size as 0x0, so these tests
// exercise the documented pre-load fallback branch — actual decode/load events
// and natural-dimension auto-fit are browser-only and out of scope.
beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('Image min-size fallback (pre-load)', () => {
    // DIVERGENCE (code defect): the JSDoc on Image.getMinSize promises a 20x20
    // pre-load fallback before the image decodes, gated by an *explicit*
    // caller-supplied minSize. But Component.applyOptions dispatches the default
    // `minSize: {0,0}` from `_defaultOptions` into `_options.minSize`
    // (Component.ts:377, applyOptions Component.ts:442), so EVERY Image has a
    // truthy `_options.minSize` of {0,0}. The guard `if (this._options.minSize)`
    // (Image.ts:89) is thus always satisfied and short-circuits to
    // `super.getMinSize()` = {0,0}, so the documented 20x20 fallback and the
    // natural-dimension auto-min path (Image.ts:93-102) are unreachable.
    // Contract-correct expectation kept; marked it.fails to pin the bug.
    it.fails('returns the 20x20 fallback when natural size is 0x0', () => {
        const img = new Image('/x.png');

        img.getElement(true);

        const min = img.getMinSize()!;

        expect(min.width).toBe(20);
        expect(min.height).toBe(20);
    });
    it('lets an explicit setMinSize win over the auto-derived fallback', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        img.setMinSize(40, 50);

        const min = img.getMinSize()!;

        expect(min.width).toBe(40);
        expect(min.height).toBe(50);
    });
});

describe('Image src attribute', () => {
    it('writes the src attribute on render', () => {
        const img = new Image('/logo.png');
        const recorder = DOM.sink as unknown as { writes: { op: string; args: unknown[] }[] };

        img.getElement(true);

        const wroteSrc = recorder.writes.some(w =>
            w.op === 'apply'
            && JSON.stringify(w.args).includes('/logo.png'));

        expect(wroteSrc).toBe(true);
    });
});
