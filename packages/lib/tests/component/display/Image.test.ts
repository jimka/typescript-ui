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

    it('publishes the natural size on load when no explicit size was set, with no auto-derived min-size floor', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });
        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });
    });

    it('reports {0,0} min size after load even when the natural size is small', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        setNaturalSize(img.getElement()!, 16, 16);
        (img as unknown as Bridged)._onLoad();

        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });
    });

    it('keeps an explicit preferredSize unchanged after load, minSize staying {0,0} without preserveAspectRatio', () => {
        const img = new Image('/x.png', { preferredSize: { width: 120, height: 40 } });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 120, height: 40 });
        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });
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
        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });

        img.setSrc('/new.png');

        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });

        setNaturalSize(img.getElement()!, 50, 50);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 50, height: 50 });
        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });
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

describe('Image objectFit / objectPosition', () => {
    it('round-trips objectFit through getObjectFit', () => {
        const img = new Image('/x.png');

        img.setObjectFit('contain');

        expect(img.getObjectFit()).toBe('contain');
    });

    it('round-trips objectPosition through getObjectPosition', () => {
        const img = new Image('/x.png');

        img.setObjectPosition('top center');

        expect(img.getObjectPosition()).toBe('top center');
    });

    it('reports null from getObjectFit/getObjectPosition before their setters are ever called', () => {
        const img = new Image('/x.png');

        expect(img.getObjectFit()).toBeNull();
        expect(img.getObjectPosition()).toBeNull();
    });

    it('applies objectFit from the construction options bag', () => {
        const img = new Image('/x.png', { objectFit: 'cover' });

        img.getElement(true);

        expect(img.getObjectFit()).toBe('cover');
    });
});

describe('Image preserveAspectRatio', () => {
    it('defaults to false and round-trips through setPreserveAspectRatio', () => {
        const img = new Image('/x.png');

        expect(img.getPreserveAspectRatio()).toBe(false);

        img.setPreserveAspectRatio(true);

        expect(img.getPreserveAspectRatio()).toBe(true);
    });

    it('derives the dependent axis from setWidth/setHeight and floors only that axis, until toggled off', () => {
        const img = new Image('/x.png', { preserveAspectRatio: true });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 150);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 300, height: 150 });
        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });

        img.setWidth(120);

        // The just-derived height is floored (protects a same-pass setHeight
        // call from clipping below it); width itself is never floored — it
        // was just set explicitly and must stay free to shrink again later.
        expect(img.getPreferredSize()).toEqual({ width: 120, height: 60 });
        expect(img.getMinSize()).toEqual({ width: 0, height: 60 });

        img.setHeight(150);

        expect(img.getPreferredSize()).toEqual({ width: 300, height: 150 });
        expect(img.getMinSize()).toEqual({ width: 300, height: 0 });

        img.setPreserveAspectRatio(false);
        img.setWidth(90);

        expect(img.getPreferredSize()).toEqual({ width: 300, height: 150 });
        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });
    });

    it('lets the image shrink again after growing, across repeated setWidth/setHeight passes', () => {
        const img = new Image('/x.png', { preserveAspectRatio: true });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 150);
        (img as unknown as Bridged)._onLoad();

        // A single standalone setWidth call must never be blocked from
        // shrinking by a floor an earlier setWidth call left behind.
        img.setWidth(300);
        img.setWidth(100);

        expect(img.getWidth()).toBe(100);

        // A realistic layout pass calls setWidth then setHeight together
        // (Component.writeBounds's own order). An ill-fitting box (2:1
        // image, 1.5:1 box) grows width past what the parent asked to stay
        // proportional — but a later, identical re-allocation from the same
        // parent (e.g. a fixed-size Split pane re-committing on the next
        // layout pass) must not stay stuck at the grown size.
        img.setWidth(300);
        img.setHeight(200);

        expect(img.getWidth()).toBe(300);
        expect(img.getHeight()).toBe(200);

        img.setWidth(300);
        img.setHeight(200);

        expect(img.getWidth()).toBe(300);
        expect(img.getHeight()).toBe(200);

        // A subsequent, smaller allocation is also honoured.
        img.setWidth(150);
        img.setHeight(100);

        expect(img.getWidth()).toBe(150);
        expect(img.getHeight()).toBe(100);
    });

    it('stops notifying once a mismatched box repeats, instead of looping forever', () => {
        const img = new Image('/x.png', { preserveAspectRatio: true });
        const preferredSpy = vi.fn();

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 150);
        (img as unknown as Bridged)._onLoad();
        (img as unknown as { _onPreferredSizeChange: unknown })._onPreferredSizeChange = preferredSpy;

        // Pass 1: an ill-fitting box (2:1 image, 1.5:1 box) — preserveAspectRatio
        // grows the published preferred size past the box to stay proportional.
        img.setWidth(300);
        img.setHeight(200);

        const callsAfterFirstPass = preferredSpy.mock.calls.length;
        expect(callsAfterFirstPass).toBeGreaterThan(0);

        // Pass 2: the parent hands the identical box again (a fixed-size
        // container that doesn't defer to the child's preferred size, e.g.
        // Fit or a Split pane holding its allocation). Nothing further
        // should fire — the box can never become aspect-correct, so without
        // an idempotency guard this pair would notify forever.
        img.setWidth(300);
        img.setHeight(200);

        expect(preferredSpy.mock.calls.length).toBe(callsAfterFirstPass);
    });

    it('re-derives after a setSrc swap even when the committed width happens to repeat', () => {
        const img = new Image('/x.png', { preserveAspectRatio: true });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 150); // 2:1
        (img as unknown as Bridged)._onLoad();

        img.setWidth(300);

        expect(img.getPreferredSize()).toEqual({ width: 300, height: 150 });

        // Swap to a differently-shaped image, then have a rigid parent
        // re-commit the exact same width as before — the idempotency guard
        // must not mistake this for "nothing changed" and keep the stale,
        // old-ratio height around.
        img.setSrc('/square.png');
        setNaturalSize(img.getElement()!, 100, 100); // 1:1
        (img as unknown as Bridged)._onLoad();

        img.setWidth(300);

        expect(img.getPreferredSize()).toEqual({ width: 300, height: 300 });
    });

    it('an explicit preferredSize wins for the initial load, but a later setWidth call re-derives from the aspect ratio', () => {
        const img = new Image('/x.png', {
            preferredSize:       { width: 120, height: 40 },
            preserveAspectRatio: true,
        });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 150);
        (img as unknown as Bridged)._onLoad();

        expect(img.getPreferredSize()).toEqual({ width: 120, height: 40 });

        img.setWidth(300);

        expect(img.getPreferredSize()).toEqual({ width: 300, height: 150 });
    });

    it('derives against the perimeter (padding), not the outer width/height', () => {
        const img = new Image('/x.png', {
            padding:             new Insets(10, 10, 10, 10),
            preserveAspectRatio: true,
        });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 150);
        (img as unknown as Bridged)._onLoad();

        img.setWidth(140);

        expect(img.getPreferredSize()).toEqual({ width: 140, height: 80 });
    });

    it('does not re-derive when the natural size has a zero-length axis', () => {
        const img = new Image('/x.png', { preserveAspectRatio: true });

        img.getElement(true);
        setNaturalSize(img.getElement()!, 0, 150);
        (img as unknown as Bridged)._onLoad();

        img.setWidth(120);

        expect(img.getPreferredSize()).toEqual({ width: 0, height: 150 });
        expect(img.getMinSize()).toEqual({ width: 0, height: 0 });
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
