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

/** Replays every `addClass`/`removeClass` write touching `token` on `handle`,
 *  in order, and returns whether the token ends up present — mirrors
 *  `Button.pressedState.test.ts`'s `isPressed` helper, generalised to any
 *  class token instead of just `"pressed"`. */
const lastClassState = (recorder: Recorder, handle: unknown, token: string): boolean => {
    let state = false;

    for (const w of recorder.writes) {
        if (w.op !== 'apply' || w.args[0] !== handle) {
            continue;
        }

        const patch = w.args[1] as { addClass?: readonly string[]; removeClass?: readonly string[] };

        if (patch.addClass?.includes(token)) state = true;
        if (patch.removeClass?.includes(token)) state = false;
    }

    return state;
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

    it('round-trips srcset through getSrcset and writes the srcset attribute', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.setSrcset('a.jpg 1x, b.jpg 2x');

        expect(img.getSrcset()).toBe('a.jpg 1x, b.jpg 2x');
        expect(lastAttr(recorder, 'srcset')).toBe('a.jpg 1x, b.jpg 2x');
    });

    it('round-trips sizes through getSizes and writes the sizes attribute', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);
        img.setSizes('(min-width: 600px) 480px, 100vw');

        expect(img.getSizes()).toBe('(min-width: 600px) 480px, 100vw');
        expect(lastAttr(recorder, 'sizes')).toBe('(min-width: 600px) 480px, 100vw');
    });

    it('reports null from every attribute getter before its setter is ever called', () => {
        const img = new Image('/x.png');

        expect(img.getAlt()).toBeNull();
        expect(img.getLoading()).toBeNull();
        expect(img.getDecoding()).toBeNull();
        expect(img.getFetchPriority()).toBeNull();
        expect(img.getCrossOrigin()).toBeNull();
        expect(img.getReferrerPolicy()).toBeNull();
        expect(img.getSrcset()).toBeNull();
        expect(img.getSizes()).toBeNull();
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

    it('writes srcset and sizes attributes from the options bag on first render', () => {
        const img = new Image('/a.png', {
            srcset: 'a.jpg 1x, b.jpg 2x',
            sizes:  '(min-width: 600px) 480px, 100vw',
        });
        const recorder = DOM.sink as unknown as Recorder;

        img.getElement(true);

        expect(img.getSrcset()).toBe('a.jpg 1x, b.jpg 2x');
        expect(img.getSizes()).toBe('(min-width: 600px) 480px, 100vw');
        expect(lastAttr(recorder, 'srcset')).toBe('a.jpg 1x, b.jpg 2x');
        expect(lastAttr(recorder, 'sizes')).toBe('(min-width: 600px) 480px, 100vw');
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

describe('Image srcset/sizes invalidate the cache and re-trigger decode', () => {
    it('setSrcset on an already-rendered Image calls decodeImage again', () => {
        const img = new Image('/x.png');
        const decodeSpy = vi.spyOn(DOM.sink, 'decodeImage');

        img.getElement(true);
        expect(decodeSpy).toHaveBeenCalledTimes(1);

        img.setSrcset('a.jpg 1x, b.jpg 2x');

        expect(decodeSpy).toHaveBeenCalledTimes(2);
    });

    it('setSrcset clears _naturalSize, so a same-size settle after it still republishes instead of hitting the size-diff guard', () => {
        const img = new Image('/x.png');
        const handle = img.getElement(true)!;

        setNaturalSize(handle, 300, 200);
        (img as unknown as Bridged)._onLoad();
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });

        img.setSrcset('a.jpg 1x, b.jpg 2x');
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 }); // unchanged until the next settle

        let fired = 0;
        img.on('load', () => { fired += 1; });

        setNaturalSize(handle, 300, 200); // same size as the candidate srcset replaced
        (img as unknown as Bridged)._onLoad();

        expect(fired).toBe(1); // would be 0 if setSrcset hadn't cleared the cache
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });
    });

    it('setSizes on an already-rendered Image calls decodeImage again', () => {
        const img = new Image('/x.png');
        const decodeSpy = vi.spyOn(DOM.sink, 'decodeImage');

        img.getElement(true);
        expect(decodeSpy).toHaveBeenCalledTimes(1);

        img.setSizes('(min-width: 600px) 480px, 100vw');

        expect(decodeSpy).toHaveBeenCalledTimes(2);
    });

    it('setSizes clears _naturalSize, so a same-size settle after it still republishes instead of hitting the size-diff guard', () => {
        const img = new Image('/x.png');
        const handle = img.getElement(true)!;

        setNaturalSize(handle, 300, 200);
        (img as unknown as Bridged)._onLoad();
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });

        img.setSizes('(min-width: 600px) 480px, 100vw');
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 }); // unchanged until the next settle

        let fired = 0;
        img.on('load', () => { fired += 1; });

        setNaturalSize(handle, 300, 200); // same size as the candidate sizes replaced
        (img as unknown as Bridged)._onLoad();

        expect(fired).toBe(1); // would be 0 if setSizes hadn't cleared the cache
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });
    });

    it('does not throw when setSrcset/setSizes are called before the element ever renders, and defers decodeImage until it does', () => {
        const img = new Image('/x.png');
        const decodeSpy = vi.spyOn(DOM.sink, 'decodeImage');

        expect(() => img.setSrcset('a.jpg 1x, b.jpg 2x')).not.toThrow();
        expect(() => img.setSizes('100vw')).not.toThrow();
        expect(decodeSpy).not.toHaveBeenCalled();

        img.getElement(true);

        expect(decodeSpy).toHaveBeenCalledTimes(1);
    });
});

describe('Image automatic decode trigger', () => {
    it('calls DOM.sink.decodeImage exactly once for a freshly rendered, default-loading Image', () => {
        const img = new Image('/x.png');
        const decodeSpy = vi.spyOn(DOM.sink, 'decodeImage');

        img.getElement(true);

        expect(decodeSpy).toHaveBeenCalledTimes(1);
    });

    it('never calls DOM.sink.decodeImage for an Image constructed with loading: "lazy"', () => {
        const img = new Image('/x.png', { loading: 'lazy' });
        const decodeSpy = vi.spyOn(DOM.sink, 'decodeImage');

        img.getElement(true);

        expect(decodeSpy).not.toHaveBeenCalled();
    });

    it('setSrc on an already-rendered Image increases the decodeImage call count by one', () => {
        const img = new Image('/x.png');
        const decodeSpy = vi.spyOn(DOM.sink, 'decodeImage');

        img.getElement(true);
        expect(decodeSpy).toHaveBeenCalledTimes(1);

        img.setSrc('/new.png');

        expect(decodeSpy).toHaveBeenCalledTimes(2);
    });
});

describe('Image decode() converges with handleLoad/_onError', () => {
    it('a successful decode() publishes the natural size and fires "load" before any native load', async () => {
        const img = new Image('/x.png');
        const handle = img.getElement(true)!;
        setNaturalSize(handle, 300, 200);

        let fired = 0;
        img.on('load', () => { fired += 1; });

        await Promise.resolve();
        await Promise.resolve();

        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });
        expect(fired).toBe(1);
    });

    it('a same-size native load after decode() resolves does not double-publish', async () => {
        const img = new Image('/x.png');
        const handle = img.getElement(true)!;
        setNaturalSize(handle, 300, 200);

        let fired = 0;
        img.on('load', () => { fired += 1; });

        await Promise.resolve();
        await Promise.resolve();
        expect(fired).toBe(1);

        (img as unknown as Bridged)._onLoad();

        expect(fired).toBe(1);
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });
    });

    it('a later, size-different native load still republishes', async () => {
        const img = new Image('/x.png');
        const handle = img.getElement(true)!;
        setNaturalSize(handle, 300, 200);

        let fired = 0;
        img.on('load', () => { fired += 1; });

        await Promise.resolve();
        await Promise.resolve();
        expect(fired).toBe(1);

        setNaturalSize(handle, 600, 400);
        (img as unknown as Bridged)._onLoad();

        expect(fired).toBe(2);
        expect(img.getPreferredSize()).toEqual({ width: 600, height: 400 });
    });

    it('a rejected decode() converges on the error path, firing "error"', async () => {
        const img = new Image('/x.png');
        vi.spyOn(DOM.sink, 'decodeImage').mockRejectedValue(new Error('decode failed'));

        let fired = 0;
        img.on('error', () => { fired += 1; });

        img.getElement(true);

        await Promise.resolve();
        await Promise.resolve();

        expect(fired).toBe(1);
    });

    it('a rejected decode() followed by the native error event for the same failed source does not double-fire "error"', async () => {
        // Regression: a genuinely broken source can fail both signals
        // independently (decode() forces the same fetch the native listener
        // observes completing) — handleError() must not re-run its full body
        // for the second settlement.
        const img = new Image('/x.png');
        vi.spyOn(DOM.sink, 'decodeImage').mockRejectedValue(new Error('decode failed'));

        let fired = 0;
        img.on('error', () => { fired += 1; });

        img.getElement(true);

        await Promise.resolve();
        await Promise.resolve();
        expect(fired).toBe(1);

        (img as unknown as Bridged)._onError();

        expect(fired).toBe(1);
        expect(img.isBroken()).toBe(true);
    });
});

describe('Image decode() settlement guards', () => {
    it('a superseded decode settlement is silently ignored', async () => {
        const img = new Image('/x.png');
        let rejectFirst: (reason: unknown) => void = () => {};
        const pending = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });

        vi.spyOn(DOM.sink, 'decodeImage')
            .mockReturnValueOnce(pending)
            .mockReturnValueOnce(Promise.resolve());

        img.getElement(true); // consumes the 1st mocked return, starts the pending decode

        let errorFired = 0;
        img.on('error', () => { errorFired += 1; });

        img.setSrc('/new.png'); // consumes the 2nd mocked return, bumps the generation

        rejectFirst(new Error('superseded'));
        await Promise.resolve();
        await Promise.resolve();

        expect(errorFired).toBe(0);
    });

    // The two tests below pin "a decode settlement after disposal does not
    // throw" (triggerDecode's live-element recheck) — but cannot independently
    // exercise that recheck's own getElement() branch offline: Component's
    // destructor() clears `_element`, so getElement() falls back to
    // DOM.source.getElementById(this.getId()), and the modelled
    // TestHandleTable._byId index is never evicted on element removal (see
    // Component.ts's own comment on this exact gap, next to its
    // clearContentFrame() ordering discussion). TextInput.test.ts's own
    // disposal-guard test for paste() has the identical limitation. `fired`
    // stays 0 here because registerListenerBag's onDestroy hook clears the
    // ListenerBag on dispose, not because the guard's getElement() check
    // no-oped — so what these tests actually prove is "no throw and no
    // listener fan-out reaches a disposed instance's consumers"; the
    // getElement()-based no-op itself is the same, already-proven pattern
    // TextInput.paste() uses (TextInput.ts:795-797) and is verified by code
    // inspection against Component.ts's documented contract, not by this
    // offline harness.
    it('a decode settlement after disposal does not throw and does not fire "load"', async () => {
        const img = new Image('/x.png');
        let resolvePending: () => void = () => {};
        const pending = new Promise<void>(resolve => { resolvePending = resolve; });
        vi.spyOn(DOM.sink, 'decodeImage').mockReturnValue(pending);

        let fired = 0;
        img.on('load', () => { fired += 1; });

        img.getElement(true);
        img.dispose();
        resolvePending();

        await Promise.resolve();
        await Promise.resolve();

        expect(fired).toBe(0);
    });

    it('a decode settlement after disposal does not throw and does not fire "error"', async () => {
        const img = new Image('/x.png');
        let rejectPending: (reason: unknown) => void = () => {};
        const pending = new Promise<void>((_resolve, reject) => { rejectPending = reject; });
        vi.spyOn(DOM.sink, 'decodeImage').mockReturnValue(pending);

        let fired = 0;
        img.on('error', () => { fired += 1; });

        img.getElement(true);
        img.dispose();
        rejectPending(new Error('post-dispose'));

        await Promise.resolve();
        await Promise.resolve();

        expect(fired).toBe(0);
    });
});

describe('Image loading and error visual states', () => {
    it('is loading and not broken immediately after construction', () => {
        const img = new Image('/x.png');

        expect(img.isLoading()).toBe(true);
        expect(img.isBroken()).toBe(false);
    });

    it('is neither loading nor broken after _onLoad fires', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        setNaturalSize(img.getElement()!, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(img.isLoading()).toBe(false);
        expect(img.isBroken()).toBe(false);
    });

    it('is broken and not loading after _onError fires', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        (img as unknown as Bridged)._onError();

        expect(img.isLoading()).toBe(false);
        expect(img.isBroken()).toBe(true);
    });

    it('carries the loading DOM class and not broken after first render', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        const handle = img.getElement(true);

        expect(lastClassState(recorder, handle, 'loading')).toBe(true);
        expect(lastClassState(recorder, handle, 'broken')).toBe(false);
    });

    it('carries neither DOM class after _onLoad fires', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        const handle = img.getElement(true)!;
        setNaturalSize(handle, 300, 200);
        (img as unknown as Bridged)._onLoad();

        expect(lastClassState(recorder, handle, 'loading')).toBe(false);
        expect(lastClassState(recorder, handle, 'broken')).toBe(false);
    });

    it('carries the broken DOM class and not loading after _onError fires', () => {
        const img = new Image('/x.png');
        const recorder = DOM.sink as unknown as Recorder;

        const handle = img.getElement(true);
        (img as unknown as Bridged)._onError();

        expect(lastClassState(recorder, handle, 'broken')).toBe(true);
        expect(lastClassState(recorder, handle, 'loading')).toBe(false);
    });

    it('re-enters loading and clears broken on setSrc after a prior error', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        (img as unknown as Bridged)._onError();

        expect(img.isBroken()).toBe(true);

        img.setSrc('/y.png');

        expect(img.isLoading()).toBe(true);
        expect(img.isBroken()).toBe(false);
    });

    it('re-enters loading, clears broken, and re-emits error on a later failure after setSrcset following a prior error', () => {
        // Regression: handleError()'s already-broken guard is only re-armed
        // by resetLoadState(), which setSrc already called but setSrcset
        // didn't — so a retry pattern like
        // `img.on('error', () => img.setSrcset(next))` would silently stop
        // re-emitting after the first failure.
        const img = new Image('/x.png');
        let errorCount = 0;
        img.on('error', () => { errorCount += 1; });

        img.getElement(true);
        (img as unknown as Bridged)._onError();

        expect(errorCount).toBe(1);

        img.setSrcset('a.jpg 1x, b.jpg 2x');

        expect(img.isLoading()).toBe(true);
        expect(img.isBroken()).toBe(false);

        (img as unknown as Bridged)._onError();

        expect(errorCount).toBe(2);
        expect(img.isBroken()).toBe(true);
    });

    it('re-enters loading, clears broken, and re-emits error on a later failure after setSizes following a prior error', () => {
        const img = new Image('/x.png');
        let errorCount = 0;
        img.on('error', () => { errorCount += 1; });

        img.getElement(true);
        (img as unknown as Bridged)._onError();

        expect(errorCount).toBe(1);

        img.setSizes('(min-width: 600px) 480px, 100vw');

        expect(img.isLoading()).toBe(true);
        expect(img.isBroken()).toBe(false);

        (img as unknown as Bridged)._onError();

        expect(errorCount).toBe(2);
        expect(img.isBroken()).toBe(true);
    });

    it('a same-size load after an error still clears broken and republishes, instead of being swallowed by the size-diff guard', () => {
        // Regression: handleError() doesn't clear _naturalSize, so a load
        // whose measured size matches the pre-error cache must not hit
        // handleLoad()'s same-size early return — otherwise .broken (and the
        // 48x48 placeholder size) would strand forever on an image that
        // actually recovered.
        const img = new Image('/x.png');
        const handle = img.getElement(true)!;

        setNaturalSize(handle, 300, 200);
        (img as unknown as Bridged)._onLoad();
        (img as unknown as Bridged)._onError();

        expect(img.isBroken()).toBe(true);

        let fired = 0;
        img.on('load', () => { fired += 1; });

        setNaturalSize(handle, 300, 200); // same size as before the error
        (img as unknown as Bridged)._onLoad();

        expect(img.isBroken()).toBe(false);
        expect(img.isLoading()).toBe(false);
        expect(img.getPreferredSize()).toEqual({ width: 300, height: 200 });
        expect(fired).toBe(1);
    });
});

describe('Image broken-state placeholder size', () => {
    it('reports a 48x48 placeholder for both preferred and min size when no explicit size is set', () => {
        const img = new Image('/x.png');

        img.getElement(true);
        (img as unknown as Bridged)._onError();

        expect(img.getPreferredSize()).toEqual({ width: 48, height: 48 });
        expect(img.getMinSize()).toEqual({ width: 48, height: 48 });
    });

    it('keeps an explicit preferredSize unchanged but still floors minSize at 48x48', () => {
        const img = new Image('/x.png', { preferredSize: { width: 120, height: 40 } });

        img.getElement(true);
        (img as unknown as Bridged)._onError();

        expect(img.getPreferredSize()).toEqual({ width: 120, height: 40 });
        expect(img.getMinSize()).toEqual({ width: 48, height: 48 });
    });

    it('lets an explicit setMinSize win over the broken placeholder floor', () => {
        const img = new Image('/x.png');

        img.setMinSize({ width: 10, height: 10 });
        img.getElement(true);
        (img as unknown as Bridged)._onError();

        expect(img.getMinSize()).toEqual({ width: 10, height: 10 });
    });

    it('adds the perimeter (padding) to the broken placeholder preferred size', () => {
        const img = new Image('/x.png', { padding: new Insets(5, 5, 5, 5) });

        img.getElement(true);
        (img as unknown as Bridged)._onError();

        expect(img.getPreferredSize()).toEqual({ width: 58, height: 58 });
    });

    it('relays a min-size change upward when an explicit preferredSize skips the publish on error', () => {
        const img = new Image('/x.png', { preferredSize: { width: 120, height: 40 } });
        const preferredSpy  = vi.fn();
        const constraintSpy = vi.fn();

        img.getElement(true);
        (img as unknown as { _onPreferredSizeChange: unknown })._onPreferredSizeChange  = preferredSpy;
        (img as unknown as { _onConstraintSizeChange: unknown })._onConstraintSizeChange = constraintSpy;
        (img as unknown as Bridged)._onError();

        expect(preferredSpy).toHaveBeenCalledTimes(1);
        expect(constraintSpy).toHaveBeenCalledTimes(1);
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
