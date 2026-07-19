//
// Coverage for Component.onFirstLayout — the per-instance "mounted and sized"
// hook. It fires the first time a component completes a layout while its element
// is connected to the document, replacing the requestAnimationFrame-until-
// getElement()-appears polling a host used to focus/measure a just-attached
// component.
//
// The offline DOM stubs requestAnimationFrame to a no-op recorder (spied here to
// drive the flush) and stubs isConnected to false (spied here to model whether
// the component has been attached).
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { VBox } from '~/layout/VBox';
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

describe('Component.onFirstLayout', () => {
    let frames: Array<FrameRequestCallback>;
    let connected: boolean;

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames = [];
        connected = true;
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
        // Model attachment: the offline source reports false unconditionally, so
        // a test flips `connected` to say whether the component is mounted.
        vi.spyOn(DOM.source, 'isConnected').mockImplementation(() => connected);
    });

    afterEach(() => { flushFrame(); vi.restoreAllMocks(); DOM.reset(); });

    /** Invokes every animation-frame callback captured since the last flush. */
    function flushFrame(): void {
        const pending = frames;
        frames = [];
        for (const cb of pending) {
            cb(0);
        }
    }

    /** A rendered, laid-out-capable host. */
    function host(): Container {
        const c = new Container({ layoutManager: new VBox() });
        c.getElement(true);

        return c;
    }

    it('does not run the callback synchronously on registration', () => {
        const ran = vi.fn();

        host().onFirstLayout(ran);

        expect(ran).not.toHaveBeenCalled();
    });

    it('runs the callback after the first connected layout', () => {
        const ran = vi.fn();

        host().onFirstLayout(ran);
        flushFrame();

        expect(ran).toHaveBeenCalledTimes(1);
    });

    it('runs the callback only once across repeated layouts', () => {
        const c = host();
        const ran = vi.fn();

        c.onFirstLayout(ran);
        flushFrame();
        c.scheduleLayout();
        flushFrame();

        expect(ran).toHaveBeenCalledTimes(1);
    });

    it('waits for connection: a layout while detached does not fire, the next connected one does', () => {
        const c = host();
        const ran = vi.fn();

        connected = false;
        c.onFirstLayout(ran);
        flushFrame();
        expect(ran).not.toHaveBeenCalled();

        // Now the host mounts: the next layout is connected, so the hook drains.
        connected = true;
        c.scheduleLayout();
        flushFrame();
        expect(ran).toHaveBeenCalledTimes(1);
    });

    it('defers to the next flush when registered on an already-laid-out, connected component', () => {
        const c = host();
        // First layout happens with no callback registered.
        c.scheduleLayout();
        flushFrame();

        const ran = vi.fn();
        c.onFirstLayout(ran);
        // Already connected → routed through afterNextLayout, so still async.
        expect(ran).not.toHaveBeenCalled();

        flushFrame();
        expect(ran).toHaveBeenCalledTimes(1);
    });
});
