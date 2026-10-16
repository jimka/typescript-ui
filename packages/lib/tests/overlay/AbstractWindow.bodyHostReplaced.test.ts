// A window caches the component that holds its body (the "body host") the first
// time it needs it. An application that replaces the window's content leaves
// that cache pointing at a disposed component: a replacement made during a
// maximise or restore animation threw from the glide's last frame and left the
// window unable to change state, and one made at rest was never hidden when the
// window was minimised. The cache is now dropped when its host is no
// longer the window's child, and the glide checks, when it lands, that the
// host it captured is still the body. See
// plans/implemented/references-to-disposed-components.md.
//
// Frame-and-fake-timer harness copied from AbstractWindow.largeResizeFade.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Component } from '~/core/Component';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 2000, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The fade-out leg's own fallback deadline: 200 ms fade plus the 40 ms default buffer. */
const FADE_LEG_FALLBACK_MS = 240;

/** The glide's duration (AbstractWindow's WINDOW_ANIM_DURATION_MS). */
const GLIDE_DURATION_MS = 150;

/** Mid fade-out: past the start, short of the 240 ms deadline. */
const MID_FADE_OUT_MS = 100;

/** One settle step: past a fade leg's fallback deadline. */
const SETTLE_STEP_MS = 300;

/** Settle steps that drain a whole fade, glide and fade-in sequence. */
const SETTLE_STEPS = 12;

/** The viewport width a maximised window reaches. */
const VIEWPORT_WIDTH = 2000;

/** The window's starting width. */
const WINDOW_WIDTH = 300;

describe('AbstractWindow — body replaced while the window lives', () => {
    let frames:      Map<number, FrameRequestCallback>;
    let nextFrameId: number;

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames      = new Map();
        nextFrameId = 1;
        vi.useFakeTimers();
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
        (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
        vi.restoreAllMocks();
        vi.useRealTimers();
        DOM.reset();
    });

    /** Runs every frame callback still pending since the last drain. */
    function flushFrame(): void {
        const pending = [...frames.values()];

        frames.clear();

        for (const cb of pending) {
            cb(performance.now());
        }
    }

    /** Builds a shown window with a single body child. */
    function makeWindow(width: number, height: number): { win: Window; body: Component } {
        const win  = new Window('W');
        const body = new Component();

        win.addComponent(body, { placement: Placement.CENTER });
        win.setSize({ width, height });
        win.show();
        flushFrame();
        flushFrame();

        return { win, body };
    }

    /** Replaces the window's body the way an application would. */
    function swap(win: Window, body: Component): Component {
        const replacement = new Component();

        win.removeComponent(body);
        body.dispose();
        win.addComponent(replacement, { placement: Placement.CENTER });

        return replacement;
    }

    /** Advances fake time and frames until every state animation has finished. */
    function settle(): void {
        for (let step = 0; step < SETTLE_STEPS; step++) {
            vi.advanceTimersByTime(SETTLE_STEP_MS);
            flushFrame();
        }
    }

    /** Whether the window still believes a body fade owns the body host's opacity. */
    function bodyFadeActive(win: Window): boolean {
        return (win as unknown as { _bodyFadeActive: boolean })._bodyFadeActive;
    }

    it('W0: control: minimising hides the original body', () => {
        const { win, body } = makeWindow(WINDOW_WIDTH, 200);

        win.minimize();
        settle();

        expect(body.isDisplayed()).toBe(false);
    });

    it('W1: a body replaced at rest is the one hidden by the next minimise', () => {
        const { win, body } = makeWindow(WINDOW_WIDTH, 200);

        win.minimize();
        settle();
        win.restore();
        settle();

        const replacement = swap(win, body);

        win.minimize();
        settle();

        expect(replacement.isDisplayed()).toBe(false);
    });

    it('W2: a body replaced during the glide lets the window finish and change state again', () => {
        const { win, body } = makeWindow(WINDOW_WIDTH, 200);

        win.toggleMaximize();
        flushFrame();
        vi.advanceTimersByTime(FADE_LEG_FALLBACK_MS);   // the fade-out lands and the glide starts

        swap(win, body);

        expect(() => {
            vi.advanceTimersByTime(GLIDE_DURATION_MS);
            flushFrame();
            settle();
        }).not.toThrow();
        expect(bodyFadeActive(win)).toBe(false);
        expect(win.getWidth()).toBe(VIEWPORT_WIDTH);

        expect(() => {
            win.toggleMaximize();
            settle();
        }).not.toThrow();
        expect(win.getWidth()).toBe(WINDOW_WIDTH);
    });

    it('W3: a body replaced during the fade-out leaves the window able to change state', () => {
        const { win, body } = makeWindow(WINDOW_WIDTH, 200);

        win.toggleMaximize();
        flushFrame();
        vi.advanceTimersByTime(MID_FADE_OUT_MS);

        swap(win, body);
        settle();

        expect(() => {
            win.toggleMaximize();
            settle();
        }).not.toThrow();
        expect(win.getWindowState()).toBe('normal');
        expect(win.getWidth()).toBe(WINDOW_WIDTH);
    });
});
