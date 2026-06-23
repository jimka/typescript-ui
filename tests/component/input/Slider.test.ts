// @vitest-environment jsdom
//
// Slider value coverage. Two seams:
//
//  - The snap math, deprecated aliases, and getters are exercised on a bare
//    (unmounted) Slider — `snap()` is the private unit under test and is
//    reached via an `any` cast confined to this file.
//  - `setValue` calls `Event.fireEvent(this, "input")`, which throws on an
//    unmounted Slider, so the `setValue` round-trip + `change`-listener block
//    mounts the slider via the TestDOM ritual copied from
//    tests/component/layout/Tab.test.ts and resets the DOM after each case.
import { describe, it, expect, afterEach } from 'vitest';
import { Slider } from '~/component/input/Slider';
import { Container } from '~/core/Container';
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

/**
 * Quiesces a realized Slider so it leaves no pending layout behind. The
 * module-level pending-layout set outlives a single test file, so a Slider (or
 * its private track/thumb children) left queued flushes on a LATER file's real
 * rAF after this file's DOM was reset — surfacing as a stray "DOM handle not
 * registered" unhandled error. The sequence is: pause the slider AND its
 * private children first (so the synchronous flush below can't re-queue them
 * via doLayout's setX/setSize side effects), then flushLayout the host subtree
 * and the slider to delete their already-queued entries from the global set.
 * fireEvent only needs the element to exist, not a live frame.
 */
function quiesce(host: { flushLayout(): unknown; pauseLayout(): unknown }, slider: any): void {
    slider.pauseLayout();
    // The track/active-fill/thumb are private Components the slider's doLayout
    // re-schedules; pause them so the flush below doesn't re-queue the subtree.
    slider._track?.pauseLayout?.();
    slider._activeTrack?.pauseLayout?.();
    slider._thumb?.pauseLayout?.();

    host.pauseLayout();
    host.flushLayout();
    slider.flushLayout();
}

describe('Slider snap math', () => {
    it('clamps to [min,max] then rounds to the nearest step boundary', () => {
        const s = new Slider({ min: 0, max: 100, step: 10 });

        // snap is the private unit under test; cast to reach it.
        const snap = (v: number): number => (s as any).snap(v);

        expect(snap(23)).toBe(20);
        expect(snap(27)).toBe(30);
        expect(snap(-5)).toBe(0);
        expect(snap(140)).toBe(100);
    });

    it('anchors the step grid at min, not at zero', () => {
        const s = new Slider({ min: 3, max: 23, step: 5 });

        // Boundaries are 3, 8, 13, 18, 23; 10 rounds to the nearest (8).
        expect((s as any).snap(10)).toBe(8);
        expect((s as any).snap(12)).toBe(13);
    });

    it('clamps only (no rounding) when step <= 0', () => {
        const s = new Slider({ min: 0, max: 100, step: 0 });

        expect((s as any).snap(37.5)).toBe(37.5);
        expect((s as any).snap(200)).toBe(100);
    });
});

describe('Slider getters and deprecated aliases', () => {
    it('defaults largeStep to 10 * step', () => {
        expect(new Slider({ step: 4 }).getLargeStep()).toBe(40);
    });

    it('honours an explicit largeStep over the derived one', () => {
        expect(new Slider({ step: 4, largeStep: 7 }).getLargeStep()).toBe(7);
    });

    it('defaults orientation to horizontal', () => {
        expect(new Slider().getOrientation()).toBe('horizontal');
    });

    it('maps deprecated minValue/maxValue to min/max only when the canonical key is absent', () => {
        const fallback = new Slider({ minValue: 5, maxValue: 50 });
        expect(fallback.getMin()).toBe(5);
        expect(fallback.getMax()).toBe(50);

        // Canonical min/max win when both forms are present.
        const canonical = new Slider({ min: 1, minValue: 5, max: 99, maxValue: 50 });
        expect(canonical.getMin()).toBe(1);
        expect(canonical.getMax()).toBe(99);
    });

    it('aliases the deprecated value setters/getters onto the canonical ones', () => {
        const s = new Slider();
        s.setMinValue(10);
        s.setMaxValue(90);

        expect(s.getMinValue()).toBe(10);
        expect(s.getMaxValue()).toBe(90);
        expect(s.getMin()).toBe(10);
        expect(s.getMax()).toBe(90);
    });
});

describe('Slider initial value contract', () => {
    // CONTRACT DIVERGENCE (pinned): the Slider constructor calls applyValue()
    // directly (Slider.ts:134), bypassing snap(), so the initial `value` option
    // is NOT step-snapped — unlike setValue() and unlike NumberSpinner, which
    // normalises its initial value. The intended contract is that the initial
    // value snaps to the step grid (→ 20). Today getValue() returns 23. Flip
    // this `it.fails` back to `it` once the constructor routes the initial value
    // through snap().
    it.fails('snaps the initial value option to the step grid', () => {
        expect(new Slider({ min: 0, max: 100, step: 10, value: 23 }).getValue()).toBe(20);
    });
});

describe('Slider setValue round-trip (mounted)', () => {
    afterEach(() => DOM.reset());

    it('clamps + snaps on setValue and fires change once on a real transition', () => {
        installTestDOM(CONFIG);

        const host   = new Container({});
        const slider: Slider = new Slider({ min: 0, max: 100, step: 10 });
        host.addComponent(slider);
        // Realise the element so Event.fireEvent("input") inside setValue finds
        // a mounted node rather than throwing "is not in the DOM".
        host.getElement(true);
        slider.getElement(true);
        // Construction + realization queued the host subtree into the
        // module-level pending-layout set; drain it synchronously now (while the
        // elements are valid) and pause both so setValue's further
        // scheduleLayout calls never re-queue a frame that another file's real
        // rAF would flush against a reset DOM after teardown. fireEvent only
        // needs the element to exist, not a live frame.
        quiesce(host, slider);

        let changes = 0;
        let last    = -1;
        slider.on('change', (v: number) => {
            changes += 1;
            last = v;
        });

        slider.setValue(23);

        expect(slider.getValue()).toBe(20);
        expect(changes).toBe(1);
        expect(last).toBe(20);
    });

    it('does not fire change on a no-op setValue to the current value', () => {
        installTestDOM(CONFIG);

        const host   = new Container({});
        const slider: Slider = new Slider({ min: 0, max: 100, step: 10 });
        host.addComponent(slider);
        host.getElement(true);
        slider.getElement(true);
        // See the sibling case: drain the construction-time pending layouts, then
        // pause so setValue's scheduleLayout never queues a frame that another
        // file's real rAF would flush against a reset DOM after teardown.
        quiesce(host, slider);

        slider.setValue(20);

        let changes = 0;
        slider.on('change', () => {
            changes += 1;
        });

        // 24 snaps back to 20, which equals the current value → no transition.
        slider.setValue(24);

        expect(slider.getValue()).toBe(20);
        expect(changes).toBe(0);
    });
});
