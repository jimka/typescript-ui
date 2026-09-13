// Offline coverage for plans/in-progress/abstractwindow-throttle-consolidation.md's
// `## Expected Behaviour` — neither the border-resize fps-cap gate nor its
// underlying per-move buffering had a dedicated regression test before this
// plan; the existing `AbstractWindow.resizable.test.ts` suite drives
// `onResize` but never drains a frame, so it only pins the `preventDefault`/
// `canResize()` guard, not the coalescing itself. Pins the fps-gate timing,
// the buffering, and the four cancellation paths so the PerFrameCoalescer
// refactor this plan makes cannot silently change any of them.
//
// Frame-capture harness copied from
// AbstractWindow.snapMouseMoveCoalescing.test.ts (lines 66-93): the offline
// sink discards a real requestAnimationFrame callback, so it's spied and
// drained by hand via flushFrame(), with a matching cancelAnimationFrame spy
// so a cancelled frame really never runs. Unlike that copy, flushFrame()
// here takes an explicit timestamp — cases 2-4 need to land a drain at an
// exact millisecond offset from the previous applied frame, on either side
// of the fps-cap boundary, which a hardcoded performance.now() can't do
// deterministically.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { WindowBorder, Direction } from '~/component/container/WindowBorder';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** White-box access to the private `onResizeEnd` teardown hook. */
interface ResizeInternals {
    onResizeEnd(): boolean | void;
}

function internals(win: Window): ResizeInternals {
    return win as unknown as ResizeInternals;
}

/** A fake mousemove-shaped event carrying a resize pointer position. */
function moveEvent(clientX: number, clientY: number): MouseEvent {
    return { preventDefault: () => {}, clientX, clientY } as unknown as MouseEvent;
}

describe('AbstractWindow — resize fps-cap coalescing', () => {
    let frames:      Map<number, FrameRequestCallback>;
    let nextFrameId: number;

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames      = new Map();
        nextFrameId = 1;
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            const id = nextFrameId++;

            frames.set(id, cb);

            return id;
        });
        // A real cancelAnimationFrame drops a callback before it ever fires;
        // without mirroring that here, a "cancelled" frame would still run on
        // the next flushFrame() and no cancellation case below could tell a
        // real cancel from a no-op one.
        vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((id: number) => {
            frames.delete(id);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    /**
     * Runs every frame callback still pending (i.e. not cancelled) since the
     * last drain, at the given timestamp.
     *
     * @param timestamp - The rAF timestamp handed to each drained callback.
     *   Defaults to `performance.now()` for cases that don't care about the
     *   exact value.
     */
    function flushFrame(timestamp: number = performance.now()): void {
        const pending = [...frames.values()];

        frames.clear();

        for (const cb of pending) {
            cb(timestamp);
        }
    }

    /**
     * A shown, resizable window. `show()` is required so a drained resize
     * frame's `doLayout()` has a rendered element to measure; its entrance
     * animation, and the title `Text`'s own construction-time layout-flush
     * frame, are dropped (not drained) so `frames` starts clean for the
     * resize-specific assertions below.
     */
    function resizableWindow(): Window {
        const win = new Window('W');

        win.show();
        frames.clear();

        return win;
    }

    it('1. first frame always applies', () => {
        const win    = resizableWindow();
        const border = new WindowBorder(Direction.EAST);
        const setWidth  = vi.spyOn(win, 'setWidth');
        const doLayout  = vi.spyOn(win, 'doLayout');

        win.onResize(border, moveEvent(0, 0));

        expect(setWidth).not.toHaveBeenCalled();

        // _lastFlushTime starts at 0, so any real timestamp clears the
        // default 60fps (16.7ms) gate on the very first frame.
        flushFrame(1000);

        expect(setWidth).toHaveBeenCalledTimes(1);
        expect(doLayout).toHaveBeenCalledTimes(1);

        internals(win).onResizeEnd();
    });

    it('2. a too-soon frame re-arms without applying', () => {
        const win    = resizableWindow();
        const border = new WindowBorder(Direction.EAST);
        const setWidth = vi.spyOn(win, 'setWidth');

        win.onResize(border, moveEvent(0, 0));
        flushFrame(1000);

        expect(setWidth).toHaveBeenCalledTimes(1);

        win.onResize(border, moveEvent(5, 0));
        // 10ms since the last applied frame, under the default 60fps's
        // ~16.7ms period — the gate re-arms without draining the buffer.
        flushFrame(1010);

        expect(setWidth).toHaveBeenCalledTimes(1);
        expect(frames.size).toBe(1);

        internals(win).onResizeEnd();
    });

    it('3. a late-enough frame applies', () => {
        const win    = resizableWindow();
        const border = new WindowBorder(Direction.EAST);
        const setWidth = vi.spyOn(win, 'setWidth');

        win.onResize(border, moveEvent(0, 0));
        flushFrame(1000);

        expect(setWidth).toHaveBeenCalledTimes(1);

        win.onResize(border, moveEvent(5, 0));
        // 20ms since the last applied frame, at/over the default 60fps's
        // ~16.7ms period — the gate lets this frame through.
        flushFrame(1020);

        expect(setWidth).toHaveBeenCalledTimes(2);

        internals(win).onResizeEnd();
    });

    it('4. setResizeFps changes the cap on the very next frame, not just for a new session', () => {
        const win    = resizableWindow();
        const border = new WindowBorder(Direction.EAST);
        const setWidth = vi.spyOn(win, 'setWidth');

        win.onResize(border, moveEvent(0, 0));
        flushFrame(1000);

        expect(setWidth).toHaveBeenCalledTimes(1);

        // Changed mid-drag — after the session already started and one frame
        // already applied under the default 60fps cap — not before the
        // session even began.
        win.setResizeFps(20);

        win.onResize(border, moveEvent(5, 0));
        // 30ms since the last applied frame, under the *new* 20fps's 50ms
        // period. If the cap were read once (e.g. cached from the first
        // onFrame call) instead of fresh on every frame, this would still
        // see the stale 60fps/16.7ms period and wrongly apply here.
        flushFrame(1030);

        expect(setWidth).toHaveBeenCalledTimes(1);

        // 50ms since the last applied frame — at the new cap's boundary.
        flushFrame(1050);

        expect(setWidth).toHaveBeenCalledTimes(2);

        internals(win).onResizeEnd();
    });

    it('5. two moves before a frame drains apply only the second', () => {
        const win     = resizableWindow();
        const border  = new WindowBorder(Direction.EAST);
        const originW = win.getWidth();
        const setWidth = vi.spyOn(win, 'setWidth');

        win.onResize(border, moveEvent(0, 0));
        win.onResize(border, moveEvent(30, 0));

        expect(setWidth).not.toHaveBeenCalled();
        expect(frames.size).toBe(1);

        flushFrame(1000);

        expect(setWidth).toHaveBeenCalledTimes(1);
        expect(setWidth).toHaveBeenCalledWith(originW + 30);

        internals(win).onResizeEnd();
    });

    it('6. onExitAction cancels a still-buffered frame', () => {
        const win    = resizableWindow();
        const border = new WindowBorder(Direction.EAST);
        const setWidth = vi.spyOn(win, 'setWidth');

        win.onResize(border, moveEvent(0, 0));

        expect(() => win.onExitAction()).not.toThrow();

        expect(frames.size).toBe(0);

        expect(() => flushFrame()).not.toThrow();
        expect(setWidth).not.toHaveBeenCalled();
    });

    it('7. setWindowState cancels a still-buffered frame', () => {
        const win    = resizableWindow();
        const border = new WindowBorder(Direction.EAST);
        const setWidth = vi.spyOn(win, 'setWidth');

        win.onResize(border, moveEvent(0, 0));

        expect(frames.size).toBe(1);

        const [resizeFrameId] = [...frames.keys()];

        // setWindowState arms its own rect-animation frames, so `frames` may
        // gain new entries here — the assertion below is only that the
        // resize coalescer's own frame (captured above) is gone, not that
        // the map is empty.
        expect(() => win.setWindowState('maximized')).not.toThrow();

        expect(frames.has(resizeFrameId)).toBe(false);

        const widthAfterState = win.getWidth();

        expect(() => flushFrame()).not.toThrow();
        // The stale buffered resize (offsetX = 0 relative to its own origin)
        // never reaches setWidth once cancelled.
        expect(setWidth).not.toHaveBeenCalledWith(widthAfterState);
    });

    it('8a. a non-resizable window never schedules', () => {
        const win = resizableWindow();

        win.setResizable(false);
        win.onResize(new WindowBorder(Direction.EAST), moveEvent(0, 0));

        expect(frames.size).toBe(0);
    });

    it('8b. a non-normal-state window never schedules', () => {
        const win = resizableWindow();

        win.setWindowState('maximized');
        // Drop the state transition's own rect-animation frames — irrelevant
        // to the guard under test.
        frames.clear();

        win.onResize(new WindowBorder(Direction.EAST), moveEvent(0, 0));

        expect(frames.size).toBe(0);
    });
});
