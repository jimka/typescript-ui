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
import { Insets } from '~/primitive/Insets';
import { UNBOUNDED } from '~/primitive/Size';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import { _ruleCacheHas } from '~/core/StyleTarget';
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

});

describe('Slider orientation sizing', () => {
    it('defaults to the horizontal preferred/max size', () => {
        const s = new Slider();

        expect(s.getPreferredSizeConstraint()).toEqual({ width: 200, height: 16 });
        expect(s.getMaxSizeConstraint()).toEqual({ width: UNBOUNDED, height: 16 });
    });

    it('applies the vertical preferred/max size for { orientation: "vertical" }', () => {
        const s = new Slider({ orientation: 'vertical' });

        expect(s.getPreferredSizeConstraint()).toEqual({ width: 16, height: 200 });
        expect(s.getMaxSizeConstraint()).toEqual({ width: 16, height: UNBOUNDED });
    });

    it('honours a construction-time preferredSize override, leaving maxSize at its default', () => {
        const s = new Slider({ preferredSize: { width: 300, height: 40 } });

        expect(s.getPreferredSizeConstraint()).toEqual({ width: 300, height: 40 });
        expect(s.getMaxSizeConstraint()).toEqual({ width: UNBOUNDED, height: 16 });
    });

    it('honours a construction-time maxSize override, leaving preferredSize at its default', () => {
        const s = new Slider({ maxSize: { width: 500, height: 50 } });

        expect(s.getPreferredSizeConstraint()).toEqual({ width: 200, height: 16 });
        expect(s.getMaxSizeConstraint()).toEqual({ width: 500, height: 50 });
    });

    it('folds preferredSize independently of orientation, still deriving maxSize from it', () => {
        const s = new Slider({ orientation: 'vertical', preferredSize: { width: 50, height: 300 } });

        expect(s.getPreferredSizeConstraint()).toEqual({ width: 50, height: 300 });
        expect(s.getMaxSizeConstraint()).toEqual({ width: 16, height: UNBOUNDED });
    });

    it('recomputes both fields unconditionally on a runtime setOrientation, dropping a construction-time override', () => {
        const s = new Slider({ preferredSize: { width: 300, height: 40 }, maxSize: { width: 500, height: 50 } });

        s.setOrientation('vertical');

        expect(s.getPreferredSizeConstraint()).toEqual({ width: 16, height: 200 });
        expect(s.getMaxSizeConstraint()).toEqual({ width: 16, height: UNBOUNDED });
    });

    it('recomputes back to the horizontal default after a construction-time vertical override', () => {
        const s = new Slider({ orientation: 'vertical', maxSize: { width: 999, height: 999 } });

        s.setOrientation('horizontal');

        expect(s.getMaxSizeConstraint()).toEqual({ width: UNBOUNDED, height: 16 });
    });
});

describe('Slider initial value contract', () => {
    // Resolved divergence: the constructor now routes the initial `value` option
    // through snap() (clamp + step-snap) before storing it, matching setValue()
    // and NumberSpinner. An initial value of 23 with step 10 snaps to 20.
    it('snaps the initial value option to the step grid', () => {
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

// The track and thumb are drawn inside the content box, so the pointer must be
// measured against the same rectangle. `getViewportRect` hands back the BORDER
// box, and `getContentBounds().x` is measured from the padding box, so reaching
// the content origin from the viewport rect costs the border as well. Get that
// wrong and the thumb trails the cursor by the padding on every drag.
describe('Slider valueAtPointer measures the content box', () => {
    afterEach(() => DOM.reset());

    /** Mounts a slider at (0,0) 200x16 and returns its private pointer mapper. */
    const mapper = (configure: (s: any) => void) => {
        installTestDOM(CONFIG);

        const host             = new Container({});
        const slider: Slider   = new Slider({ min: 0, max: 100 });

        host.addComponent(slider);
        host.getElement(true);
        slider.getElement(true);
        configure(slider as any);
        // The offline viewport rect accumulates each ancestor's committed
        // origin, so an unpositioned slider would map every pointer to NaN.
        host.setX(0);
        host.setY(0);
        slider.setX(0);
        slider.setY(0);
        slider.setWidth(200);
        slider.setHeight(16);
        slider.doLayout();
        quiesce(host, slider);

        return (x: number): number => (slider as any).valueAtPointer({ clientX: x, clientY: 8 });
    };

    it('maps the outer box when there is no padding or border', () => {
        const at = mapper(() => {});

        expect(at(0)).toBe(0);
        expect(at(100)).toBe(50);
        expect(at(200)).toBe(100);
    });

    it('starts at the padding edge, not the outer edge', () => {
        const at = mapper(s => {
            s.clearInsets();
            s.setPadding(new Insets(0, 4, 0, 4));
        });

        // The 192px content box runs from x=4 to x=196.
        expect(at(4)).toBe(0);
        expect(at(100)).toBe(50);
        expect(at(196)).toBe(100);
    });

    it('starts inside the border', () => {
        const at = mapper(s => s.setBorder('2px solid black'));

        // The 196px content box runs from x=2 to x=198.
        expect(at(2)).toBe(0);
        expect(at(100)).toBe(50);
        expect(at(198)).toBe(100);
    });
});

// The track, active-track, and thumb are each a dedicated file-local subclass
// (SliderTrack / SliderActiveTrack / SliderThumb) rather than a bare
// `Component`, so their static chrome hoists into a shared `.ClassName` rule
// instead of repeating on every instance's own `#id` rule. Mirrors
// Scrollbar.test.ts's "Scrollbar thumb static style hoisting" block.
describe('SliderTrack/SliderActiveTrack/SliderThumb class-rule hoisting', () => {
    afterEach(() => DOM.reset());

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `Scrollbar.test.ts`.
     */
    function declarationsDuring(
        sink: RecordingDOMSink,
        selector: string,
        fn: () => void,
    ): Record<string, string | null> {
        const start = sink.writes.length;
        fn();

        const out: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
                continue;
            }

            const styles = w.args[1] as Record<string, string | null>;
            for (const key of Object.keys(styles)) {
                out[key] = styles[key];
            }
        }

        return out;
    }

    it('the track, active-track, and thumb carry no static backgroundColor/borderRadius declaration on their own #id rules, and the shared class rules exist once rendered', () => {
        const sink = installTestDOM(CONFIG);

        const slider     = new Slider() as any;
        const track      = slider._track;
        const activeTrack = slider._activeTrack;
        const thumb      = slider._thumb;

        const trackDeclarations = declarationsDuring(sink, idSelector(track), () => track.getElement(true));
        expect(trackDeclarations.backgroundColor).toBeUndefined();
        expect(trackDeclarations.borderRadius).toBeUndefined();

        const activeTrackDeclarations = declarationsDuring(sink, idSelector(activeTrack), () => activeTrack.getElement(true));
        expect(activeTrackDeclarations.backgroundColor).toBeUndefined();
        expect(activeTrackDeclarations.borderRadius).toBeUndefined();

        const thumbDeclarations = declarationsDuring(sink, idSelector(thumb), () => thumb.getElement(true));
        expect(thumbDeclarations.backgroundColor).toBeUndefined();
        expect(thumbDeclarations.borderRadius).toBeUndefined();

        expect(_ruleCacheHas('.SliderTrack')).toBe(true);
        expect(_ruleCacheHas('.SliderActiveTrack')).toBe(true);
        expect(_ruleCacheHas('.SliderThumb')).toBe(true);
    });
});
