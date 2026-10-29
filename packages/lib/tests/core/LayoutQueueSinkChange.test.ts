// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for the layout and effective-visibility queues across a sink swap.
//
// Both queues are module state in `Component.ts`, each armed by one animation
// frame whose handle is kept until that frame runs. The offline sink's
// `requestAnimationFrame` records the request, drops the callback and returns
// `0` — a real handle value, not the `null` "nothing armed" sentinel — so once
// a test file's first `scheduleLayout` swallowed a frame, no later one was
// ever requested: every component that scheduled a layout afterwards stayed
// in `pendingLayouts` for the rest of the file, retaining its whole subtree.
// This queue was one of several registries pinning undisposed components
// that way (see the other `*SinkChange` cases); together they took the
// MarkdownEditor suites to 2-3.5 GB per worker, enough for a full parallel
// run to exhaust the machine. A replaced sink now drops both queues and both
// frame handles, as every other module holding state minted through a sink
// does (`DOM.onSinkChange`).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
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

afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/**
 * Replaces the installed sink with a fresh offline one whose animation-frame
 * requests are captured rather than dropped.
 *
 * @returns The captured frame callbacks, in request order.
 */
function installCapturingSink(): Array<FrameRequestCallback> {
    const frames: Array<FrameRequestCallback> = [];
    const sink   = installTestDOM(CONFIG);

    vi.spyOn(sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);

        return frames.length;
    });

    return frames;
}

/** Runs every captured frame callback, including any requested while running. */
function runFrames(frames: Array<FrameRequestCallback>): void {
    while (frames.length > 0) {
        frames.shift()!(0);
    }
}

describe('layout queue across a sink swap', () => {
    it('asks a replaced sink for a fresh frame after the old sink swallowed one', () => {
        installTestDOM(CONFIG);
        new Component().scheduleLayout();
        DOM.reset();

        const frames = installCapturingSink();
        new Component().scheduleLayout();

        expect(frames.length).toBe(1);
    });

    it('does not lay out a component queued under the old sink', () => {
        installTestDOM(CONFIG);
        const stale = new Component();
        stale.getElement(true);
        stale.scheduleLayout();
        DOM.reset();

        const frames = installCapturingSink();
        const fresh  = new Component();
        fresh.getElement(true);

        const staleLayout = vi.spyOn(stale, 'doLayout');
        const freshLayout = vi.spyOn(fresh, 'doLayout');

        fresh.scheduleLayout();
        runFrames(frames);

        expect(staleLayout).not.toHaveBeenCalled();
        expect(freshLayout).toHaveBeenCalled();
    });

    it('does not run a post-layout callback queued under the old sink', () => {
        installTestDOM(CONFIG);
        const staleCallback = vi.fn();
        Component.afterNextLayout(staleCallback);
        DOM.reset();

        const frames        = installCapturingSink();
        const freshCallback = vi.fn();
        Component.afterNextLayout(freshCallback);
        runFrames(frames);

        expect(staleCallback).not.toHaveBeenCalled();
        expect(freshCallback).toHaveBeenCalled();
    });
});

describe('effective-visibility queue across a sink swap', () => {
    it('asks a replaced sink for a fresh frame and does not reconcile a component queued under the old one', () => {
        installTestDOM(CONFIG);
        const stale = new Component();
        stale.getElement(true);
        stale.setDisplayed(false);
        DOM.reset();

        const frames = installCapturingSink();
        const fresh  = new Component();
        fresh.getElement(true);

        const staleReconcile = vi.spyOn(stale as any, 'propagateEffectiveVisibility');
        const freshReconcile = vi.spyOn(fresh as any, 'propagateEffectiveVisibility');

        fresh.setDisplayed(false);

        expect(frames.length).toBe(1);

        runFrames(frames);

        expect(staleReconcile).not.toHaveBeenCalled();
        expect(freshReconcile).toHaveBeenCalled();
    });
});
