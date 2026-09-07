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
