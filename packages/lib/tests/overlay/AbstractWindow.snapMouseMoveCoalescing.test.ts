// Offline coverage for plans/in-progress/window-snap-border-coalescing.md's
// `## Expected Behaviour` — the Ctrl-snap resize preview's mousemove handling
// is buffered and applied at most once per animation frame, `onSnapMouseDown`
// force-flushes so the border a press grabs is always the freshest pick, and
// the buffered frame is cancelled on every teardown path. No file previously
// covered the snap-resize affordance at all (see the plan's [^no-tests]).
//
// Frame-capture harness copied from AbstractWindow.largeResizeFade.test.ts:
// the offline sink discards a real requestAnimationFrame callback, so it's
// spied and drained by hand via flushFrame(), with a matching
// cancelAnimationFrame spy that actually drops a callback from the captured
// Map — needed here because several cases assert a cancelled frame really
// never runs, not just that nothing throws.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { WindowBorder } from '~/component/container/WindowBorder';
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

/** White-box access to the private snap-resize internals under test. */
interface SnapInternals {
    onSnapKeyDown(e: KeyboardEvent): void;
    onSnapKeyUp(e: KeyboardEvent): void;
    onSnapMouseMove(e: MouseEvent): void;
    onSnapMouseDown(e: MouseEvent): boolean | void;
    onExitAction(): void;
    _boundOnSnapBlur: () => void;
    _snapTargetBorder: WindowBorder | null;
    _borderComponents: Record<string, WindowBorder>;
    pickSnapBorder(cx: number, cy: number): WindowBorder | null;
}

function internals(win: Window): SnapInternals {
    return win as unknown as SnapInternals;
}

/** A fake keydown event carrying the default ("ctrl") snap modifier. */
function ctrlKeyEvent(): KeyboardEvent {
    return { ctrlKey: true } as unknown as KeyboardEvent;
}

/** A fake keyup event with the modifier already released. */
function ctrlReleasedEvent(): KeyboardEvent {
    return { ctrlKey: false } as unknown as KeyboardEvent;
}

/** A fake mousemove event at the given viewport position. */
function moveEvent(clientX: number, clientY: number): MouseEvent {
    return { clientX, clientY } as unknown as MouseEvent;
}

/** A fake primary-button mousedown landing outside any border strip's element. */
function downEvent(): MouseEvent {
    return { button: 0, target: null } as unknown as MouseEvent;
}

describe('AbstractWindow — snap-resize mousemove coalescing', () => {
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

    /** Runs every frame callback still pending (i.e. not cancelled) since the last drain. */
    function flushFrame(): void {
        const pending = [...frames.values()];

        frames.clear();

        for (const cb of pending) {
            cb(performance.now());
        }
    }

    /**
     * Builds a shown, resizable window with snap detection armed (Ctrl held).
     * `show()`'s own entrance animation schedules frames unrelated to this
     * suite; they're dropped (not drained) so `frames` starts clean for the
     * assertions below — this suite never checks that the entrance animation
     * itself completes.
     */
    function armedWindow(): Window {
        const win = new Window('W');

        win.show();
        frames.clear();
        internals(win).onSnapKeyDown(ctrlKeyEvent());

        return win;
    }

    it('1. a single buffered mousemove, once drained, picks and highlights exactly once', () => {
        const win    = armedWindow();
        const borderA = internals(win)._borderComponents.west;
        const pick    = vi.spyOn(internals(win), 'pickSnapBorder').mockReturnValue(borderA);
        const setSnapTarget = vi.spyOn(WindowBorder.prototype, 'setSnapTarget');

        internals(win).onSnapMouseMove(moveEvent(10, 20));

        expect(pick).not.toHaveBeenCalled();

        flushFrame();

        expect(pick).toHaveBeenCalledTimes(1);
        expect(pick).toHaveBeenCalledWith(10, 20);
        expect(setSnapTarget).toHaveBeenCalledWith(true);
        expect(internals(win)._snapTargetBorder).toBe(borderA);
    });

    it('2. a second mousemove before the frame drains overwrites the buffer, not the highlight', () => {
        const win     = armedWindow();
        const borderA = internals(win)._borderComponents.west;
        const borderB = internals(win)._borderComponents.east;
        // Keyed on the coordinate, not call order: only one pickSnapBorder
        // call actually happens (the whole point of coalescing), so a
        // mockReturnValueOnce chain would never see its second entry.
        const pick    = vi.spyOn(internals(win), 'pickSnapBorder')
            .mockImplementation((cx) => (cx === 1 ? borderA : borderB));

        internals(win).onSnapMouseMove(moveEvent(1, 1));
        internals(win).onSnapMouseMove(moveEvent(2, 2));

        expect(pick).not.toHaveBeenCalled();
        // Left armed, not cancelled-and-re-armed: exactly one frame requested
        // across both moves.
        expect(frames.size).toBe(1);

        flushFrame();

        expect(pick).toHaveBeenCalledTimes(1);
        expect(pick).toHaveBeenCalledWith(2, 2);
        expect(internals(win)._snapTargetBorder).toBe(borderB);
    });

    it('3. onSnapMouseDown never waits for a frame', () => {
        const win     = armedWindow();
        const borderA = internals(win)._borderComponents.west;
        vi.spyOn(internals(win), 'pickSnapBorder').mockReturnValue(borderA);
        const dragStart = vi.spyOn(borderA, 'onDragStart').mockImplementation(() => {});

        internals(win).onSnapMouseMove(moveEvent(5, 5));   // buffered, undrained

        const result = internals(win).onSnapMouseDown(downEvent());

        expect(dragStart).toHaveBeenCalledTimes(1);
        expect(result).toBe(true);
        expect(frames.size).toBe(0);   // the force-flush cancelled the armed frame
    });

    it('4. a stale highlight is corrected at the moment of mousedown, not shown as it was', () => {
        const win     = armedWindow();
        const borderA = internals(win)._borderComponents.west;
        const borderB = internals(win)._borderComponents.east;
        vi.spyOn(internals(win), 'pickSnapBorder')
            .mockReturnValueOnce(borderA)
            .mockReturnValueOnce(borderB);
        const dragStartA = vi.spyOn(borderA, 'onDragStart').mockImplementation(() => {});
        const dragStartB = vi.spyOn(borderB, 'onDragStart').mockImplementation(() => {});

        internals(win).onSnapMouseMove(moveEvent(1, 1));
        flushFrame();   // primes the highlight on border A

        expect(internals(win)._snapTargetBorder).toBe(borderA);

        internals(win).onSnapMouseMove(moveEvent(2, 2));   // buffered, undrained
        internals(win).onSnapMouseDown(downEvent());

        expect(dragStartB).toHaveBeenCalledTimes(1);
        expect(dragStartA).not.toHaveBeenCalled();
    });

    it('5. onSnapMouseDown with nothing ever buffered is a no-op-safe early return', () => {
        const win = armedWindow();
        const dragStarts = Object.values(internals(win)._borderComponents)
            .map((border) => vi.spyOn(border, 'onDragStart').mockImplementation(() => {}));

        expect(() => internals(win).onSnapMouseDown(downEvent())).not.toThrow();

        expect(internals(win)._snapTargetBorder).toBeNull();
        dragStarts.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    it('6. releasing the modifier cancels a still-buffered frame', () => {
        const win     = armedWindow();
        const borderA = internals(win)._borderComponents.west;
        const pick    = vi.spyOn(internals(win), 'pickSnapBorder').mockReturnValue(borderA);
        const setSnapTarget = vi.spyOn(WindowBorder.prototype, 'setSnapTarget');

        internals(win).onSnapMouseMove(moveEvent(1, 1));
        expect(frames.size).toBe(1);

        internals(win).onSnapKeyUp(ctrlReleasedEvent());

        expect(frames.size).toBe(0);

        flushFrame();

        expect(pick).not.toHaveBeenCalled();
        expect(setSnapTarget).not.toHaveBeenCalled();
    });

    it('7. a viewport blur cancels a still-buffered frame, via the same clearSnapState path', () => {
        const win     = armedWindow();
        const borderA = internals(win)._borderComponents.west;
        const pick    = vi.spyOn(internals(win), 'pickSnapBorder').mockReturnValue(borderA);

        internals(win).onSnapMouseMove(moveEvent(1, 1));
        expect(frames.size).toBe(1);

        internals(win)._boundOnSnapBlur();

        expect(frames.size).toBe(0);

        flushFrame();

        expect(pick).not.toHaveBeenCalled();
    });

    it('8. disabling snap-resize mid-hover cancels a still-buffered frame', () => {
        const win     = armedWindow();
        const borderA = internals(win)._borderComponents.west;
        const pick    = vi.spyOn(internals(win), 'pickSnapBorder').mockReturnValue(borderA);

        internals(win).onSnapMouseMove(moveEvent(1, 1));
        expect(frames.size).toBe(1);

        win.setSnapResizeEnabled(false);

        expect(frames.size).toBe(0);

        flushFrame();

        expect(pick).not.toHaveBeenCalled();
    });

    it('9. window close cancels a still-buffered frame', () => {
        const win     = armedWindow();
        const borderA = internals(win)._borderComponents.west;
        const pick    = vi.spyOn(internals(win), 'pickSnapBorder').mockReturnValue(borderA);

        internals(win).onSnapMouseMove(moveEvent(1, 1));
        expect(frames.size).toBe(1);

        expect(() => internals(win).onExitAction()).not.toThrow();

        expect(frames.size).toBe(0);

        expect(() => flushFrame()).not.toThrow();
        expect(pick).not.toHaveBeenCalled();
    });
});
