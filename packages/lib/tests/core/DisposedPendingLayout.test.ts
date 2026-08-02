// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for the interaction between teardown and the coalesced layout queue.
//
// `scheduleLayout` parks a component in a module-level `pendingLayouts` set that
// drains on the next animation frame. Disposal happening in between is ordinary
// — a spinner overlay that is removed before its frame lands, a panel closed
// mid-animation — and the flush must not lay the corpse out: `destructor` has
// already released the component's element handles, so `doLayout` would write
// through a released handle and (against the production sink) throw, aborting
// the rest of the flush and leaving every component queued behind it unlaid.
//
// The offline sink's `requestAnimationFrame` is a no-op recorder, so these spy
// on it to drive the flush deterministically — the same shim
// `AfterNextLayout.test.ts` uses. They assert on whether `doLayout` ran rather
// than on `not.toThrow()`, because the recording sink keeps serving released
// handles and would make a throw-based assertion pass vacuously.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
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

describe('pending layout queue — disposed components', () => {
    let frames: Array<FrameRequestCallback>;

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
    });

    afterEach(() => { flushFrame(); vi.restoreAllMocks(); DOM.reset(); });

    /** Invokes every animation-frame callback captured since the last flush (the layout pass). */
    function flushFrame(): void {
        const pending = frames;
        frames = [];
        for (const cb of pending) {
            cb(0);
        }
    }

    it('skips a component disposed after it scheduled a layout', () => {
        const component = new Component();
        component.getElement(true);
        component.scheduleLayout();

        const doLayout = vi.spyOn(component, 'doLayout');

        component.dispose();
        flushFrame();

        expect(doLayout).not.toHaveBeenCalled();
    });

    it('still lays out the components queued alongside a disposed one', () => {
        const doomed   = new Component();
        const survivor = new Container();

        doomed.getElement(true);
        survivor.getElement(true);
        doomed.scheduleLayout();
        survivor.scheduleLayout();

        const survivorLayout = vi.spyOn(survivor, 'doLayout');

        doomed.dispose();
        flushFrame();

        expect(survivorLayout).toHaveBeenCalledTimes(1);
    });

    // The flush's other guard — skipping a component that an *earlier entry in
    // the same flush* disposed — cannot be pinned here. It reads `getElement()`,
    // and against the recording sink a disposed component still answers with a
    // live handle: `release()` does not evict the stub, so `getElementById`
    // keeps resolving the id. Offline the guard therefore never fires, and a
    // test that made it fire would have to stub `getElement` itself — asserting
    // the mock, not the behaviour. It is verified live instead; see
    // `plans/implemented/table-column-virtualization.md`'s Implementation Notes.

    it('skips a component that never rendered', () => {
        // The same guard reads the element, so a component that scheduled a
        // layout before its first render is skipped too — there is nothing to
        // lay out against, and rendering schedules its own pass.
        const component = new Component();
        component.scheduleLayout();

        const doLayout = vi.spyOn(component, 'doLayout');

        flushFrame();

        expect(doLayout).not.toHaveBeenCalled();
    });

    it('skips a disposed child reached through its container', () => {
        const container = new Container();
        const child     = new Component();

        container.addComponent(child);
        container.getElement(true);
        child.scheduleLayout();

        const childLayout = vi.spyOn(child, 'doLayout');

        // Tearing the container down recurses into the child, so the child's own
        // queue entry has to go with it.
        container.dispose();
        flushFrame();

        expect(childLayout).not.toHaveBeenCalled();
    });
});
