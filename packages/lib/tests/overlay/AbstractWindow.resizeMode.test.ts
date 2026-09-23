// Offline coverage for plans/in-progress/drag-resize-outline-mode.md's
// `## Expected Behaviour` cases W1-W5: how a window edge or corner drag
// behaves in each resize mode, and the one live-mode change the shared drag
// session brings — a release now applies its last buffered move at once, as a
// `Split` gutter drag always has.
//
// Frame-capture harness and `resizableWindow()` copied from
// AbstractWindow.resizeFpsCoalescing.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { setAppResizeMode } from '~/core/ResizeDrag';
import type { ResizeMode } from '~/core/ResizeDrag';
import { WindowBorder, Direction } from '~/component/container/WindowBorder';
import { Window } from '~/overlay/Window';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A box, as both the window and its outline report one. */
interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** `new Window('W').show()`'s resting geometry in the configured viewport. */
const RESTING: Box = { x: 50, y: 50, width: 400, height: 300 };

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

/** A component's visual box: its laid-out position plus whatever translate moved it. */
function visualBox(component: Component): Box {
    return {
        x:      component.getX() + component.getTranslateX(),
        y:      component.getY() + component.getTranslateY(),
        width:  component.getWidth(),
        height: component.getHeight(),
    };
}

describe('AbstractWindow resize mode', () => {
    let frames:      Map<number, FrameRequestCallback>;
    let nextFrameId: number;
    let windows:     Window[];

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames      = new Map();
        nextFrameId = 1;
        windows     = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            const id = nextFrameId++;

            frames.set(id, cb);

            return id;
        });
        vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((id: number) => {
            frames.delete(id);
        });
    });

    afterEach(() => {
        // An outline left on screen keeps its two viewport listeners, and
        // `Event`'s registration maps are module state DOM.reset() does not
        // clear: a surviving type map stops the next `addViewportListener`
        // re-registering the base listener against the fresh sink.
        for (const win of windows) {
            win.dispose();
        }

        vi.restoreAllMocks();
        setAppResizeMode('live');
        DOM.reset();
    });

    /** Runs every frame callback still pending since the last drain. */
    function flushFrame(timestamp: number = performance.now()): void {
        const pending = [...frames.values()];

        frames.clear();

        for (const cb of pending) {
            cb(timestamp);
        }
    }

    /**
     * A shown, resizable window in the given mode. `show()` is required so a
     * drained resize frame's `doLayout()` has a rendered element to measure;
     * the frames it queued are dropped so `frames` starts clean.
     *
     * @param resizeMode - The window's own mode.
     * @returns The window.
     */
    function resizableWindow(resizeMode: ResizeMode): Window {
        const win = new Window('W', { resizeMode });

        win.show();
        frames.clear();
        windows.push(win);

        return win;
    }

    /** The outline the window's drag session has on screen, if any. */
    function outlineOf(win: Window): Component | null {
        return (win as unknown as { _resizeDrag: { _outline: Component | null } })._resizeDrag._outline;
    }

    it('W1. an outline drag leaves the window where it is', () => {
        const win      = resizableWindow('outline');
        const border   = new WindowBorder(Direction.EAST);
        const setWidth = vi.spyOn(win, 'setWidth');
        const doLayout = vi.spyOn(win, 'doLayout');
        // The offline source mints a fresh handle on every
        // `getDocumentElement()` call, so pin one for the drag to mount into
        // and for the assertion below to compare against.
        const documentElement = DOM.source.getDocumentElement();

        vi.spyOn(DOM.source, 'getDocumentElement').mockReturnValue(documentElement);

        win.onResize(border, moveEvent(0, 0));
        win.onResize(border, moveEvent(30, 0));
        flushFrame(1000);

        expect(visualBox(win)).toEqual(RESTING);
        expect(setWidth).not.toHaveBeenCalled();
        expect(doLayout).not.toHaveBeenCalled();

        const outline = outlineOf(win)!;

        expect(DOM.source.getParentElement(outline.getElement()!)).toBe(documentElement);
        expect(outline.getZIndex()).toBe(win.getZIndex());
        expect(visualBox(outline)).toEqual({ x: 50, y: 50, width: 430, height: 300 });

        internals(win).onResizeEnd();
    });

    it.each<[Direction, number, number, Box, ResizeMode]>(([
        [Direction.EAST, 30, 0, { x: 50, y: 50, width: 430, height: 300 }],
        // The chrome floor, 192.
        [Direction.WEST, 300, 0, { x: 258, y: 50, width: 192, height: 300 }],
        // The viewport, 800 - 50.
        [Direction.SOUTH, 0, 600, { x: 50, y: 50, width: 400, height: 750 }],
        // The viewport's top.
        [Direction.NORTH, 0, -100, { x: 50, y: 0, width: 400, height: 350 }],
        [Direction.NORTHWEST, -20, -20, { x: 30, y: 30, width: 420, height: 320 }],
        // The viewport, both axes.
        [Direction.SOUTHEAST, 2000, 2000, { x: 50, y: 50, width: 1230, height: 750 }],
    ] as [Direction, number, number, Box][]).flatMap(row => (['outline', 'live'] as ResizeMode[]).map(mode => [...row, mode] as [Direction, number, number, Box, ResizeMode])))(
        'W2. %s by (%i, %i) lands at %j in %s mode',
        (direction, offsetX, offsetY, expected, mode) => {
            const win    = resizableWindow(mode);
            const border = new WindowBorder(direction);

            win.onResize(border, moveEvent(0, 0));
            win.onResize(border, moveEvent(offsetX, offsetY));
            flushFrame(1000);

            if (mode === 'outline') {
                expect(visualBox(outlineOf(win)!)).toEqual(expected);
            }

            internals(win).onResizeEnd();

            expect(visualBox(win)).toEqual(expected);
            expect(outlineOf(win)).toBeNull();
        },
    );

    it('W3. the fps cap does not delay the outline', () => {
        const win    = resizableWindow('outline');
        const border = new WindowBorder(Direction.EAST);

        win.setResizeFps(20);
        win.onResize(border, moveEvent(0, 0));
        win.onResize(border, moveEvent(10, 0));
        flushFrame(1000);

        expect(outlineOf(win)!.getWidth()).toBe(410);

        win.onResize(border, moveEvent(30, 0));
        // 10 ms later, well inside 20fps's 50 ms period.
        flushFrame(1010);

        expect(outlineOf(win)!.getWidth()).toBe(430);

        internals(win).onResizeEnd();
    });

    it.each<[string]>([
        ['onExitAction'],
        ['setWindowState'],
        ['dispose'],
    ])('W4. %s mid-drag takes the outline down with it', (teardown) => {
        const win    = resizableWindow('outline');
        const border = new WindowBorder(Direction.EAST);

        win.onResize(border, moveEvent(0, 0));
        win.onResize(border, moveEvent(30, 0));
        flushFrame(1000);

        const outline = outlineOf(win)!;

        if (teardown === 'onExitAction') {
            win.onExitAction();
        } else if (teardown === 'setWindowState') {
            win.setWindowState('maximized');
        } else {
            win.dispose();
        }

        expect(outlineOf(win)).toBeNull();
        expect(DOM.source.getParentElement(outline.getElement()!)).toBeNull();

        if (teardown === 'setWindowState') {
            // No frame is drained here: one would advance the maximize's own
            // state animation, which is not what this case is about.
            const maximized = visualBox(win);

            win.onResize(border, moveEvent(60, 0));
            internals(win).onResizeEnd();

            expect(visualBox(win)).toEqual(maximized);
        }
    });

    it('W5. a live release applies the last move at once', () => {
        const win    = resizableWindow('live');
        const border = new WindowBorder(Direction.EAST);

        win.onResize(border, moveEvent(0, 0));
        win.onResize(border, moveEvent(30, 0));
        internals(win).onResizeEnd();

        expect(win.getWidth()).toBe(430);
    });
});
