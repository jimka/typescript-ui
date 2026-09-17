import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgressSpinner } from '~/component/display/ProgressSpinner';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import type { ListenerBag } from '~/core/ListenerBag';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Construction, the effective-visibility animation pause, and the overlay
// size relay: `showOverlay` subscribes to the target's `"sizechange"` event,
// so the overlay follows a target resize synchronously instead of re-arming
// a layout pass every frame for as long as it is shown (see
// plans/implemented/progress-indicator-resize-relay.md). The keyframe
// animation itself and the theme-change re-derivation path stay out of scope.
// The offline sink's requestAnimationFrame is an inert recorder, so a
// scheduled layout pass can only be counted by holding the callbacks. Same
// Map-keyed capture as tests/component/tree/ResizeLayoutEconomy.test.ts, so a
// specific generation's registrations can be told apart from the next one's.
// Installed for the whole file, and drained after every test: Component's
// layout-flush handle is module-level, so a test that ends with a frame still
// armed would leave the next one's scheduleLayout believing a flush is
// already pending and silently arming nothing.
let sink: RecordingDOMSink;
let nextFrameHandle = 1;
let frames: Map<number, FrameRequestCallback> = new Map();

beforeEach(() => {
    sink            = installTestDOM(CONFIG);
    nextFrameHandle = 1;
    frames          = new Map();

    (DOM.sink as any).requestAnimationFrame = (callback: FrameRequestCallback): number => {
        const handle = nextFrameHandle++;
        frames.set(handle, callback);

        return handle;
    };
    (DOM.sink as any).cancelAnimationFrame = (handle: number): void => {
        frames.delete(handle);
    };
});
afterEach(() => {
    drainFrames();
    DOM.reset();
});

/**
 * Runs exactly the frames pending right now, without following any a callback
 * re-arms in turn — the per-generation granularity the relay's "no further
 * passes once settled" assertion needs.
 */
function runQueuedFramesOnce(): void {
    const pending = Array.from(frames.values());
    frames.clear();

    for (const callback of pending) {
        callback(0);
    }
}

/** Runs queued frames to quiescence, including any re-armed in turn. */
function drainFrames(): void {
    // Ten generations: the same bound tests/component/tree/ResizeLayoutEconomy
    // uses, enough for any settled relay and short enough that a genuinely
    // self-perpetuating loop still terminates the run.
    for (let guard = 0; guard < 10 && frames.size > 0; guard++) {
        runQueuedFramesOnce();
    }
}

/**
 * The `left` / `top` / `width` / `height` declarations the sink recorded on
 * `apply` patches since `from`. A settled pass is asserted against these keys
 * rather than an `apply` count, because one content-free InlineStyle flush per
 * component survives regardless — a Component/InlineStyle floor, not a
 * progress-indicator one.
 */
function geometryWritesSince(recorder: RecordingDOMSink, from: number): string[] {
    const written: string[] = [];

    for (const write of recorder.writes.slice(from)) {
        if (write.op !== 'apply') {
            continue;
        }

        const style = (write.args[1] as { style?: Record<string, string | null> }).style;

        if (!style) {
            continue;
        }

        for (const key of ['left', 'top', 'width', 'height']) {
            if (key in style) {
                written.push(key);
            }
        }
    }

    return written;
}

/** A materialised, explicitly sized bare Component for the overlay to track. */
function makeTarget(width: number, height: number): Component {
    const target = new Component();

    target.getElement(true);
    target.setWidth(width);
    target.setHeight(height);

    return target;
}

describe('ProgressSpinner construction', () => {
    it('sets the preferred size to the explicit diameter', () => {
        const spinner = new ProgressSpinner(24);
        const pref = spinner.getPreferredSize()!;

        expect(pref.width).toBe(24);
        expect(pref.height).toBe(24);
        expect(spinner.getSpinnerSize()).toBe(24);
    });
    it('defaults to the 14px theme fallback when no size is given', () => {
        // With no `--ts-ui-font-size` themeVar configured, the spinner reports
        // the documented 14px fallback before any post-attach theme read.
        const spinner = new ProgressSpinner();

        expect(spinner.getSpinnerSize()).toBe(14);
    });
    it('constructs without throwing', () => {
        expect(() => new ProgressSpinner(20)).not.toThrow();
    });
    it('updates the diameter via setSpinnerSize', () => {
        const spinner = new ProgressSpinner(20);

        spinner.setSpinnerSize(32);

        expect(spinner.getSpinnerSize()).toBe(32);
        expect(spinner.getPreferredSize()!.width).toBe(32);
    });
    it('applies a { spinnerSize } option', () => {
        const spinner = new ProgressSpinner(20, { spinnerSize: 40 });

        expect(spinner.getSpinnerSize()).toBe(40);
    });
});

describe('ProgressSpinner effective-visibility pause (case 2)', () => {
    it('pauses the rotating arc animation when hidden, resumes it when shown', () => {
        const spinner = new ProgressSpinner(20);
        spinner.getElement(true);

        // The arc carries the keyframe animation (see ProgressSpinner's
        // constructor); the effective-visibility walk reaches it as a
        // descendant of the spinner, not the spinner's own root element.
        const arc = (spinner as unknown as { _arc: Component })._arc;

        spinner.setVisible(false);
        Component.flushEffectiveVisibility();

        expect(arc.getAnimationPlayState()).toBe('paused');

        spinner.setVisible(true);
        Component.flushEffectiveVisibility();

        expect(arc.getAnimationPlayState()).toBeNull();
    });
});

describe('Component size-change relay', () => {
    it('leaves the geometry setters untouched when nothing is listening', () => {
        const target   = makeTarget(300, 200);
        const schedule = vi.spyOn(target, 'scheduleLayout');
        const start    = sink.writes.length;

        target.setSize({ width: 300, height: 200 });

        // setSize stays unconditional: it re-writes both axes and re-arms a
        // layout pass even for an unchanged box. The same-value early return
        // belongs to the component-setter-guards plan, not this one.
        expect(target.getWidth()).toBe(300);
        expect(target.getHeight()).toBe(200);
        expect(schedule).toHaveBeenCalledTimes(1);
        expect(geometryWritesSince(sink, start)).toEqual(['width', 'height']);
    });

    it('fires once with the committed box when setWidth changes the width', () => {
        const target = makeTarget(300, 200);
        const seen: Array<[number, number]> = [];

        target.onSizeChange((width, height) => {
            seen.push([width, height]);
        });
        target.setWidth(320);

        expect(seen).toEqual([[320, 200]]);
    });

    it('does not fire when setWidth commits the width it already had', () => {
        const target = makeTarget(300, 200);
        let calls    = 0;

        target.onSizeChange(() => {
            calls++;
        });
        target.setWidth(300);

        expect(calls).toBe(0);
    });

    it('does not fire when setSize commits the box it already had', () => {
        const target   = makeTarget(300, 200);
        const schedule = vi.spyOn(target, 'scheduleLayout');
        let   calls    = 0;

        target.onSizeChange(() => {
            calls++;
        });
        target.setSize({ width: 300, height: 200 });

        expect(calls).toBe(0);
        expect(schedule).toHaveBeenCalledTimes(1);
    });

    it('fires exactly once when setSize changes both axes', () => {
        const target = makeTarget(300, 200);
        const seen: Array<[number, number]> = [];

        target.onSizeChange((width, height) => {
            seen.push([width, height]);
        });
        target.setSize({ width: 320, height: 210 });

        expect(seen).toEqual([[320, 210]]);
    });

    it('fires once per changed axis when the two are written separately', () => {
        const target = makeTarget(300, 200);
        const seen: Array<[number, number]> = [];

        target.onSizeChange((width, height) => {
            seen.push([width, height]);
        });
        target.setWidth(320);
        target.setHeight(210);

        // The event is per committed axis, so a listener sees the intermediate
        // box mid-commit and must be safe to run twice.
        expect(seen).toEqual([[320, 200], [320, 210]]);
    });

    it('does not fire for a position change', () => {
        const target = makeTarget(300, 200);
        let calls    = 0;

        target.onSizeChange(() => {
            calls++;
        });
        target.setX(4);
        target.setY(6);

        expect(calls).toBe(0);
    });

    it('stops delivering after offSizeChange, and a second offSizeChange is a no-op', () => {
        const target = makeTarget(300, 200);
        const seen: number[] = [];

        function recordWidth(width: number): void {
            seen.push(width);
        }

        target.onSizeChange(recordWidth);
        target.setWidth(320);

        target.offSizeChange(recordWidth);
        target.setWidth(340);

        expect(() => target.offSizeChange(recordWidth)).not.toThrow();
        target.setWidth(360);

        expect(seen).toEqual([320]);
    });

    it('releases its listeners when the observed component is destroyed', () => {
        const target = makeTarget(300, 200);

        target.onSizeChange(() => {});

        const bag = (target as unknown as { _sizeListeners: ListenerBag<'sizechange'> })._sizeListeners;

        expect(bag.get('sizechange')).toHaveLength(1);

        target.dispose();

        expect(bag.get('sizechange')).toHaveLength(0);
    });
});

describe('ProgressSpinner overlay size relay', () => {
    it('sizes itself to its target and then runs no further layout passes while the target holds still', () => {
        const target  = makeTarget(300, 200);
        const spinner = new ProgressSpinner(20);

        spinner.showOverlay(target);

        expect(spinner.getWidth()).toBe(300);
        expect(spinner.getHeight()).toBe(200);
        expect(spinner.getX()).toBe(0);
        expect(spinner.getY()).toBe(0);

        // The first generation carries whatever construction already armed;
        // every later one must be empty, where the old self-re-scheduling
        // loop armed exactly one frame per generation forever.
        const counts: number[] = [];

        for (let generation = 0; generation < 6; generation++) {
            counts.push(frames.size);
            runQueuedFramesOnce();
        }

        expect(counts.slice(1)).toEqual([0, 0, 0, 0, 0]);
    });

    it('follows a target resize synchronously, with no animation frame in between', () => {
        const target  = makeTarget(300, 200);
        const spinner = new ProgressSpinner(20);

        spinner.showOverlay(target);
        runQueuedFramesOnce();

        target.setWidth(420);

        expect(spinner.getWidth()).toBe(420);
        expect(frames.size).toBe(0);

        target.setHeight(240);

        expect(spinner.getHeight()).toBe(240);

        target.setSize({ width: 500, height: 260 });

        expect(spinner.getWidth()).toBe(500);
        expect(spinner.getHeight()).toBe(260);
    });

    it('stops following the target once hideOverlay has run', () => {
        const target  = makeTarget(300, 200);
        const spinner = new ProgressSpinner(20);

        spinner.showOverlay(target);
        target.setWidth(420);
        spinner.hideOverlay();

        target.setWidth(500);

        expect(spinner.getWidth()).toBe(420);
    });

    it('resumes following the target when shown a second time', () => {
        const target  = makeTarget(300, 200);
        const spinner = new ProgressSpinner(20);

        spinner.showOverlay(target);
        spinner.hideOverlay();
        spinner.showOverlay(target);

        target.setWidth(500);

        expect(spinner.isOverlay()).toBe(true);
        expect(spinner.getWidth()).toBe(500);
    });

    it('drops its subscription when a still-overlaid spinner is destroyed', () => {
        const target  = makeTarget(300, 200);
        const spinner = new ProgressSpinner(20);

        spinner.showOverlay(target);
        spinner.dispose();

        const bag = (target as unknown as { _sizeListeners: ListenerBag<'sizechange'> })._sizeListeners;

        expect(bag.get('sizechange')).toHaveLength(0);
    });
});

describe('ProgressSpinner settled-pass write economy', () => {
    it('writes no arc geometry on a second inline layout pass at the same size', () => {
        const spinner = new ProgressSpinner(20);

        spinner.getElement(true);
        spinner.setWidth(48);
        spinner.setHeight(48);
        spinner.doLayout();

        // The arc keeps its contract: min(spinnerSize, box.width, box.height),
        // centred in the content box (the constructor clears the insets).
        const arc = (spinner as unknown as { _arc: Component })._arc;

        expect(arc.getWidth()).toBe(20);
        expect(arc.getHeight()).toBe(20);
        expect(arc.getX()).toBe(14);
        expect(arc.getY()).toBe(14);

        const start = sink.writes.length;

        spinner.doLayout();

        expect(geometryWritesSince(sink, start)).toEqual([]);
    });
});
