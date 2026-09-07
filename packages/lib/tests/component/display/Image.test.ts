import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Image } from '~/component/display/Image';
import { DOM } from '~/core/DOM';
import { Insets } from '~/primitive/Insets';
import { installTestDOM, setNaturalSize } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

type Recorder = { writes: { op: string; args: unknown[] }[] };

const hasOp = (recorder: Recorder, op: string): boolean =>
    recorder.writes.some(w => w.op === op);

/** Reads back the last `setAttr` patch value written for `key` on any element. */
const lastAttr = (recorder: Recorder, key: string): string | undefined => {
    let value: string | undefined;

    for (const w of recorder.writes) {
        if (w.op === 'apply') {
            const patch = w.args[1] as { setAttr?: Record<string, string> };

            if (patch.setAttr && key in patch.setAttr) {
                value = patch.setAttr[key];
            }
        }
    }

    return value;
};

// The native load/error → custom `emit` bridge. The offline harness cannot
// dispatch a non-bubbling event at a non-window element, so instead of a real
// `load`/`error` event these tests invoke the stored native handler directly
// and assert it re-emits through the custom `on` surface — the same code path
// a real decode would drive. End-to-end decode remains a manual-verify step
// (see the `image-auto-fit` docs demo, which — unlike `image-basic` — has no
// explicit `preferredSize`, so it actually exercises the real load-triggered
// auto-fit this bridges to).
type Bridged = { _onLoad: () => void; _onError: () => void };

describe('Image size reporting', () => {
    it('reports null preferred size and {0,0} min size before render', () => {
        const img = new Image('/x.png');

        expect(img.getPreferredSize()).toBeNull();
        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });
    });

    it('reports null preferred size and {0,0} min size when rendered but not yet loaded', () => {
        const img = new Image('/x.png');

        img.getElement(true);

        expect(img.getPreferredSize()).toBeNull();
        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });
    });

    it('publishes the natural size on load when no explicit size was set', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });
        expect(img.getMinSize()).toEqual({ width: 100, height: 100 });
    });

    it('reports the natural size unclamped when under the auto-min cap', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        setNaturalSize(img.getElement()!, 16, 16);
        (img as unknown as Bridged)._onLoad();

        expect(img.getMinSize()).toEqual({ width: 16, height: 16 });
    });

    it('keeps an explicit preferredSize unchanged after load, but still auto-derives minSize', () => {
        const img = new Image('/x.png', { preferredSize: { width: 120, height: 40 } });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 120, height: 40 });
        expect(img.getMinSize()).toEqual({ width: 100, height: 100 });
    });

    it('lets an explicit setMinSize win regardless of load state, without gating the preferredSize publish', () => {
        const img = new Image('/x.png');

        img.setMinSize({ width: 40, height: 50 });
        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getMinSize()).toEqual({ width: 40, height: 50 });
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });
    });

    it('adds the perimeter (padding) to the published preferred size', () => {
        const img = new Image('/x.png', { padding: new Insets(5, 5, 5, 5) });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 310, height: 210 });
    });

    it('relays a min-size change upward when an explicit preferredSize skips the publish', () => {
        const img = new Image('/x.png', { preferredSize: { width: 120, height: 40 } });
        const preferredSpy  = vi.fn();
        const constraintSpy = vi.fn();

        img.getElement(true);
        (img as unknown as { _onPreferredSizeChange: unknown })._onPreferredSizeChange  = preferredSpy;
        (img as unknown as { _onConstraintSizeChange: unknown })._onConstraintSizeChange = constraintSpy;
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(preferredSpy).toHaveBeenCalledTimes(1);
        expect(constraintSpy).toHaveBeenCalledTimes(1);
    });
});

describe('Image re-emits native load/error events as custom events', () => {
    it('registers native listeners for load and error at render', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);

        const addedTypes = recorder.writes
            .filter(w => w.op === 'addListener')
            .map(w => w.args[0]);

        expect(addedTypes).toContain('load');
        expect(addedTypes).toContain('error');
    });

    it('re-emits a load event to an `on` listener', () => {
        const img = new Image('/x.png');

        img.getElement(true);

        let fired = 0;
        img.on('load', () => { fired += 1; });
        (img as unknown as Bridged)._onLoad();

        expect(fired).toBe(1);
    });

    it('re-emits an error event to an `on` listener', () => {
        const img = new Image('/x.png');

        img.getElement(true);

        let fired = 0;
        img.on('error', () => { fired += 1; });
        (img as unknown as Bridged)._onError();

        expect(fired).toBe(1);
    });

    it('wires a constructor listeners bag', () => {
        let fired = 0;
        const img = new Image('/x.png', { listeners: { load: () => { fired += 1; } } });

        img.getElement(true);
        (img as unknown as Bridged)._onLoad();

        expect(fired).toBe(1);
    });

    it('stops re-emitting after off()', () => {
        const img = new Image('/x.png');

        img.getElement(true);

        let fired = 0;
        const listener = (): void => { fired += 1; };

        img.on('load', listener);
        img.off('load', listener);
        (img as unknown as Bridged)._onLoad();

        expect(fired).toBe(0);
    });

    it('fires _onPreferredSizeChange when load auto-publishes the natural size', () => {
        const img = new Image('/x.png');
        const onChange = vi.fn();

        img.getElement(true);
        (img as unknown as { _onPreferredSizeChange: unknown })._onPreferredSizeChange = onChange;
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('detaches native listeners on dispose', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.dispose();

        expect(hasOp(recorder, 'removeListener')).toBe(true);
    });
});

describe('Image baseline', () => {
    it('is null pre-load with no explicit preferred size', () => {
        const img = new Image('/x.png');

        img.getElement(true);

        expect(img.getBaseline()).toBeNull();
    });

    it('is the bottom edge of the published natural size after load', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getBaseline()).toBe(200);
    });

    it('is the bottom edge of an explicit preferredSize', () => {
        const img = new Image('/x.png', { preferredSize: { width: 120, height: 40 } });

        expect(img.getBaseline()).toBe(40);
    });
});

describe('Image src attribute', () => {
    it('writes the src attribute on render', () => {
        const img = new Image('/logo.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);

        const wroteSrc = recorder.writes.some(w =>
            w.op === 'apply'
            && JSON.stringify(w.args).includes('/logo.png'));

        expect(wroteSrc).toBe(true);
    });
});

describe('Image attribute round-trip', () => {
    it('round-trips src through getSrc and writes the src attribute', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.setSrc('/logo.png');

        expect(img.getSrc()).toBe('/logo.png');
        expect(lastAttr(recorder, 'src')).toBe('/logo.png');
    });

    it('round-trips alt through getAlt and writes the alt attribute', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.setAlt('Company logo');

        expect(img.getAlt()).toBe('Company logo');
        expect(lastAttr(recorder, 'alt')).toBe('Company logo');
    });

    it('accepts an empty alt to mark the image decorative', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.setAlt('');

        expect(img.getAlt()).toBe('');
        expect(lastAttr(recorder, 'alt')).toBe('');
    });

    it('round-trips loading through getLoading and writes the loading attribute', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.setLoading('lazy');

        expect(img.getLoading()).toBe('lazy');
        expect(lastAttr(recorder, 'loading')).toBe('lazy');
    });

    it('round-trips decoding through getDecoding and writes the decoding attribute', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.setDecoding('async');

        expect(img.getDecoding()).toBe('async');
        expect(lastAttr(recorder, 'decoding')).toBe('async');
    });

    it('round-trips fetchPriority through getFetchPriority and writes the fetchpriority attribute', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.setFetchPriority('high');

        expect(img.getFetchPriority()).toBe('high');
        expect(lastAttr(recorder, 'fetchpriority')).toBe('high');
    });

    it('round-trips crossOrigin through getCrossOrigin and writes the crossorigin attribute', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.setCrossOrigin('anonymous');

        expect(img.getCrossOrigin()).toBe('anonymous');
        expect(lastAttr(recorder, 'crossorigin')).toBe('anonymous');
    });

    it('round-trips referrerPolicy through getReferrerPolicy and writes the referrerpolicy attribute', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.setReferrerPolicy('no-referrer');

        expect(img.getReferrerPolicy()).toBe('no-referrer');
        expect(lastAttr(recorder, 'referrerpolicy')).toBe('no-referrer');
    });

    it('reports null from every attribute getter before its setter is ever called', () => {
        const img = new Image('/x.png');

        expect(img.getAlt()).toBeNull();
        expect(img.getLoading()).toBeNull();
        expect(img.getDecoding()).toBeNull();
        expect(img.getFetchPriority()).toBeNull();
        expect(img.getCrossOrigin()).toBeNull();
        expect(img.getReferrerPolicy()).toBeNull();
    });
});

describe('Image options-bag construction', () => {
    it('writes src, alt, crossorigin, and loading attributes from the options bag on first render', () => {
        const img = new Image('/a.png', { alt: 'Logo', crossOrigin: 'anonymous', loading: 'lazy' });
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);

        expect(lastAttr(recorder, 'src')).toBe('/a.png');
        expect(lastAttr(recorder, 'alt')).toBe('Logo');
        expect(lastAttr(recorder, 'crossorigin')).toBe('anonymous');
        expect(lastAttr(recorder, 'loading')).toBe('lazy');
    });

    it('uses the positional src when the options bag has no src key', () => {
        const img = new Image('/a.png', {});

        expect(img.getSrc()).toBe('/a.png');
    });

    it('lets an options-bag src win over the positional src', () => {
        const img = new Image('/a.png', { src: '/b.png' });

        expect(img.getSrc()).toBe('/b.png');
    });

    it('uses the positional src when no options bag is given', () => {
        const img = new Image('/a.png');

        expect(img.getSrc()).toBe('/a.png');
    });
});

describe('Image setSrc cache invalidation and re-measure', () => {
    it('resets minSize and leaves preferredSize unchanged until the next load, which re-measures instead of freezing', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });
        expect(img.getMinSize()).toEqual({ width: 100, height: 100 });

        img.setSrc('/new.png');

        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });

        setNaturalSize(img.getElement()!, 50, 50);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 50, height: 50 });
        expect(img.getMinSize()).toEqual({ width: 50, height: 50 });
    });

    it('keeps an explicit preferredSize unchanged across a setSrc reload', () => {
        const img = new Image('/x.png', { preferredSize: { width: 120, height: 40 } });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 120, height: 40 });

        img.setSrc('/b.png');
        setNaturalSize(img.getElement()!, 50, 50);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 120, height: 40 });
    });

    it('does not throw when setSrc is called before the element ever renders', () => {
        const img = new Image('/x.png');

        expect(() => img.setSrc('/new.png')).not.toThrow();
    });
});

describe('Image setPreferredSize/clearPreferredSize overrides', () => {
    it('a direct setPreferredSize call (not via construction options) marks the size explicit and survives a load', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        img.setPreferredSize({ width: 40, height: 40 });
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 40, height: 40 });
    });

    it('clearPreferredSize lets handleLoad auto-derive the preferred size again on the next load', () => {
        const img = new Image('/x.png', { preferredSize: { width: 120, height: 40 } });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 120, height: 40 });

        img.clearPreferredSize();
        setNaturalSize(img.getElement()!, 50, 50);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 50, height: 50 });
    });

    it('a subclassDefaults-seeded preferredSize is treated as explicit and survives a load', () => {
        // Regression: a class default is a pure fallback that
        // Component.applyOptions never dispatches through setPreferredSize
        // (see ARCHITECTURE.md's "Class-level defaults must survive the
        // getter"), so the constructor's `_hasExplicitPreferredSize` seed
        // must also consult `getPreferredSizeConstraint()` — which folds the
        // class default in — not just whether the cascade ran.
        const img = new Image('/x.png', undefined, { preferredSize: { width: 40, height: 40 } });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 40, height: 40 });
    });
});

describe('Image render()/getElement() deletion regression', () => {
    it('still writes every set attribute through the base attribute-buffer replay with no render() override', () => {
        const img = new Image('/logo.png', { alt: 'Logo' });
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);

        expect(lastAttr(recorder, 'src')).toBe('/logo.png');
        expect(lastAttr(recorder, 'alt')).toBe('Logo');
    });

    it('getElement() returns nothing before render and the same handle after, matching Component.getElement()', () => {
        const img = new Image('/x.png');

        expect(img.getElement()).toBeFalsy();

        const handle = img.getElement(true);

        expect(img.getElement()).toBe(handle);
    });
});
