// Coverage for the two deferred-hook loops of `Component` isolating a
// throwing entry.
//
// `Component.propagateEffectiveVisibility` calls `onEffectiveVisibilityChange`
// on a node, then recurses into its children; a throw from the hook used to
// escape `flushEffectiveVisibility()` and leave the node's children, and every
// root queued behind it, unreconciled. `runFirstLayoutCallbacks` empties the
// `onFirstLayout` queue before running it, so a throw used to abort that
// component's `doLayout()` and lose every callback behind the throwing one.
// Each entry now runs inside its own try/catch and reports through the same
// `reportFlushFailure` the layout flush uses: one `console.error` and one
// count on `Diagnostics`.
//
// Cases are numbered to match `plans/in-progress/deferred-work-after-dispose.md`'s
// `## Expected Behaviour` "Isolated loops" table (G1-G5). G3 and G5 are
// controls that pass before and after the change.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Diagnostics } from '~/core/Diagnostics';
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

/** A component whose visibility hook always fails. */
class Thrower extends Component {
    protected onEffectiveVisibilityChange(): void {
        throw new Error('deliberate hook failure');
    }
}

/** A component that records the visibility its hook was last told. */
class Recorder extends Component {
    seen: boolean | null = null;

    protected onEffectiveVisibilityChange(effective: boolean): void {
        this.seen = effective;
    }
}

describe('deferred hook loops — a throwing entry', () => {
    let frames: Array<FrameRequestCallback>;
    let connected: boolean;

    beforeEach(() => {
        installTestDOM(CONFIG);
        Diagnostics._reset();
        frames = [];
        connected = true;
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
        vi.spyOn(DOM.source, 'isConnected').mockImplementation(() => connected);
    });

    afterEach(() => { frames = []; vi.restoreAllMocks(); DOM.reset(); });

    /** Invokes every animation-frame callback captured since the last flush. */
    function flushFrame(): void {
        const pending = frames;
        frames = [];
        for (const cb of pending) {
            cb(0);
        }
    }

    it('G1: a throwing visibility hook leaves its siblings reconciled and is reported', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const container = new Container();
        const thrower = new Thrower();
        const sibling = new Recorder();

        container.addComponent(thrower);
        container.addComponent(sibling);
        container.getElement(true);

        const before = Diagnostics.counters().layoutErrors;

        container.setVisible(false);

        expect(() => Component.flushEffectiveVisibility()).not.toThrow();
        expect(sibling.seen).toBe(false);
        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(String(consoleError.mock.calls[0][0])).toContain('Layout flush: onEffectiveVisibilityChange for #');
        expect(Diagnostics.counters().layoutErrors - before).toBe(1);
    });

    it('G2: a throwing visibility hook on one root does not skip the next root', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const first = new Thrower();
        const second = new Recorder();

        first.getElement(true);
        second.getElement(true);
        first.setVisible(false);
        second.setVisible(false);

        expect(() => Component.flushEffectiveVisibility()).not.toThrow();
        expect(second.seen).toBe(false);
    });

    it('G3: control — a throwing afterNextLayout callback never took the rest with it', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const component = new Component();
        const ranB = vi.fn();

        component.getElement(true);
        component.scheduleLayout();
        component.onFirstLayout(() => { throw new Error('deliberate callback failure'); });
        component.onFirstLayout(ranB);
        flushFrame();

        expect(ranB).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(String(consoleError.mock.calls[0][0])).toContain('afterNextLayout');
    });

    it('G4: a throwing onFirstLayout callback does not abort doLayout or lose the rest', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const component = new Container();
        const ranB = vi.fn();

        component.getElement(true);
        connected = false;
        component.onFirstLayout(() => { throw new Error('deliberate callback failure'); });
        component.onFirstLayout(ranB);
        connected = true;

        const before = Diagnostics.counters().layoutErrors;

        expect(() => component.doLayout()).not.toThrow();
        expect(ranB).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(String(consoleError.mock.calls[0][0])).toContain('Layout flush: onFirstLayout for #');
        expect(Diagnostics.counters().layoutErrors - before).toBe(1);
    });

    it('G5: control — clean first-layout callbacks all run and report nothing', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const component = new Container();
        const ranA = vi.fn();
        const ranB = vi.fn();

        component.getElement(true);
        connected = false;
        component.onFirstLayout(ranA);
        component.onFirstLayout(ranB);
        connected = true;
        component.doLayout();

        expect(ranA).toHaveBeenCalledTimes(1);
        expect(ranB).toHaveBeenCalledTimes(1);
        expect(consoleError).not.toHaveBeenCalled();
    });
});
