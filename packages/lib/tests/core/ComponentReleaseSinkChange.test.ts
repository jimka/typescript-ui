// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for a component's handle release across a sink swap.
//
// A component releases the handles it created when it is disposed, or when
// the collector reclaims it undisposed. A handle is only a number its sink's
// registry assigned, so once the sink is replaced the same number names an
// element of the installed sink. Both paths used to release through whichever
// sink was installed when they ran, freeing a live element of an unrelated
// component: a Markdown rendered in one test lost its placeholder `<pre>` to
// the previous test's Markdown, collected mid-`await` in the next. Both now
// release only while the sink that minted the handles is installed.
//
// The collector is driven directly (`collectUntil`), and the same-sink case is
// the control that shows the finalizer does run here — without it the
// cross-sink assertion could pass only because nothing was ever collected.
// Each cross-sink case first checks that the stale and the live handle are the
// same number, the collision the guard exists for.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import { collectUntil } from '../helpers/collectedAfter';
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
 * Renders a component and drops every reference to it, in a frame of its own
 * so no local of the caller keeps it reachable.
 *
 * @returns The handle of the discarded component's element.
 */
function renderAndDiscard(): Handle {
    return new Component().getElement(true)!;
}

describe('component finalizer across a sink swap', () => {
    it('releases a collected component\'s handles through the sink that minted them', async () => {
        const sink    = installTestDOM(CONFIG);
        const release = vi.spyOn(sink, 'release');
        const handle  = renderAndDiscard();

        await collectUntil(() => release.mock.calls.some(([released]) => released === handle));

        expect(release.mock.calls.some(([released]) => released === handle)).toBe(true);
    });

    it('does not release them through a sink installed after the component was rendered', async () => {
        installTestDOM(CONFIG);

        // Control first: once the same-sink release below has been seen, the
        // collector has demonstrably run the finalizer in this process, so
        // the stale component — discarded earlier — has had its turn too.
        const stale = renderAndDiscard();
        DOM.reset();

        // Held to the end: a live component the collector reclaimed would
        // release its own handle, rightly, through its own sink.
        const sink       = installTestDOM(CONFIG);
        const release    = vi.spyOn(sink, 'release');
        const live       = new Component();
        const liveHandle = live.getElement(true)!;

        expect(liveHandle).toBe(stale);

        const control = renderAndDiscard();

        await collectUntil(() => release.mock.calls.some(([released]) => released === control));

        expect(release.mock.calls.some(([released]) => released === control)).toBe(true);
        expect(release.mock.calls.filter(([released]) => released === liveHandle)).toEqual([]);
        expect(DOM.source.getTagName(live.getElement()!)).toBe('DIV');
    });
});

describe('component disposal across a sink swap', () => {
    it('releases the handles of a component disposed under the sink that minted them', () => {
        const sink      = installTestDOM(CONFIG);
        const release   = vi.spyOn(sink, 'release');
        const component = new Component();
        const handle    = component.getElement(true)!;

        component.dispose();

        expect(release.mock.calls.some(([released]) => released === handle)).toBe(true);
    });

    it('does not release them through a sink installed after the component was rendered', () => {
        installTestDOM(CONFIG);
        const stale       = new Component();
        const staleHandle = stale.getElement(true)!;
        DOM.reset();

        const sink       = installTestDOM(CONFIG);
        const release    = vi.spyOn(sink, 'release');
        const live       = new Component();
        const liveHandle = live.getElement(true)!;

        expect(liveHandle).toBe(staleHandle);

        stale.dispose();

        expect(release.mock.calls.filter(([released]) => released === liveHandle)).toEqual([]);
        expect(DOM.source.getTagName(live.getElement()!)).toBe('DIV');
    });
});
