// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for FocusReveal's revealer registry across a sink swap.
//
// Scrolling panels, splits, borders and tabs register themselves as revealers
// in a module-level set and leave it on detach or dispose. A container that is
// simply discarded with its environment never leaves, so before FocusReveal
// forgot its registry on `DOM.onSinkChange` every such container stayed
// reachable — the MarkdownEditor suites kept tens of thousands of menus and
// panels alive through it. The same swap drops the scroll pass still waiting
// for the geometry to settle, and forgets the input watch whose viewport
// listeners `Event` drops on that swap, so the next pass installs them anew.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { FocusReveal } from '~/core/FocusReveal';
import type { FocusRevealer } from '~/core/FocusReveal';
import type { Handle } from '~/core/DOM';
import { installTestDOM, setConnected, type RecordingDOMSink } from '../dom/TestDOM';
import { collectedAfter } from '../helpers/collectedAfter';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/** A registered revealer with no element of its own. */
function registeredRevealer(): FocusRevealer {
    const revealer: FocusRevealer = {
        getRevealElement: () => null,
        revealDescendant: () => {},
    };

    FocusReveal.register(revealer);

    return revealer;
}

/**
 * Replaces the installed sink with a fresh offline one whose animation-frame
 * requests are captured rather than dropped.
 *
 * @returns The sink, and a function running the frames captured so far, once:
 *   one layout flush.
 */
function installCapturingSink(): { sink: RecordingDOMSink; flush: () => void } {
    const frames: Array<FrameRequestCallback> = [];
    const sink   = installTestDOM(CONFIG);

    vi.spyOn(sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);

        return frames.length;
    });

    return {
        sink,
        flush: () => {
            for (const callback of frames.splice(0)) {
                callback(0);
            }
        },
    };
}

/**
 * Reveals a connected element inside an opener that never reports settled,
 * so the reveal's scroll pass waits.
 *
 * @returns The revealed element.
 */
function waitingReveal(): Handle {
    const page   = DOM.sink.createElement('div');
    const target = DOM.sink.createElement('div');

    DOM.sink.appendChild(page, target);
    setConnected(page, true);
    setConnected(target, true);

    FocusReveal.register({
        getRevealElement: () => page,
        revealDescendant: () => {},
        isRevealSettled:  () => false,
    });

    expect(FocusReveal.reveal(target)).toBe(true);

    return target;
}

describe('FocusReveal registry across a sink swap', () => {
    it('does not keep a revealer registered under the old sink reachable', async () => {
        installTestDOM(CONFIG);

        const collected = await collectedAfter(registeredRevealer, () => {
            DOM.reset();
            installTestDOM(CONFIG);
        });

        expect(collected).toBe(true);
    });

    it('keeps a revealer registered under the installed sink reachable', async () => {
        installTestDOM(CONFIG);

        const collected = await collectedAfter(registeredRevealer, () => {});

        expect(collected).toBe(false);
    });

    it('watches input again for a pass that waits under the replaced sink', () => {
        const before = installCapturingSink();
        waitingReveal();
        // The first flush is where a waiting pass starts watching input; one
        // flush only, so the pass is still waiting, and watching, at the swap.
        before.flush();
        DOM.reset();

        const after = installCapturingSink();
        waitingReveal();
        after.flush();

        expect(after.sink.writes.some((w) => w.op === 'addListener' && w.args[0] === 'wheel')).toBe(true);
    });

    it('drops a pass waiting under the old sink without running its afterReveal callbacks', () => {
        installCapturingSink();
        waitingReveal();
        const staleDone = vi.fn();
        FocusReveal.afterReveal(staleDone);
        DOM.reset();

        installCapturingSink();
        waitingReveal();   // a later reveal is what would tell a pass still in the slot

        expect(staleDone).not.toHaveBeenCalled();
    });
});
