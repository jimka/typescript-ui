// `Body`'s default page-wide suppression of the browser's native "contextmenu".
// See plans/implemented/native-context-menu-suppression.md.
//
// `Body` is a module-level singleton, so its `_options.nativeContextMenu`
// persists across every test in this file, not just within one `it`. The
// `afterEach` below always leaves it at `true` (unregistered) before
// `DOM.reset()`, which is also what empties `Event`'s viewport map entry for
// "contextmenu" so the next case re-registers cleanly against its own fresh
// sink (see `tests/dom/viewport-consume.test.ts` for the same module-state
// hazard). That invariant makes every case below order-independent, with two
// exceptions: the getter case must run first, because only the very first
// test in the file ever observes the singleton's pristine (unconfigured)
// state; and the last case, which registers its own exact-target listener,
// is kept last and cleans up after itself so it cannot leak into a later one.
import { describe, it, expect, afterEach } from 'vitest';
import { Body } from '~/core/Body';
import { Component } from '~/core/Component';
import { DOM, type Handle } from '~/core/DOM';
import { Event } from '~/core/Event';
import { Favicon } from '~/core/Favicon';
import { installTestDOM, makeEvent, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Dispatches a synthetic "contextmenu" event and counts `preventDefault()` calls. */
function dispatchContextMenu(target: Handle): number {
    const evt = makeEvent(target, 'contextmenu');
    let preventCount = 0;
    (evt as unknown as { preventDefault: () => void }).preventDefault = () => { preventCount += 1; };

    DOM.sink.dispatchEvent(target, evt);

    return preventCount;
}

/** Counts sink writes that (de)registered the "contextmenu" viewport listener. */
function contextMenuWrites(sink: RecordingDOMSink, op: 'addListener' | 'removeListener'): number {
    return sink.writes.filter(w => w.op === op && w.args[0] === 'contextmenu').length;
}

describe('Body — native context-menu suppression', () => {
    afterEach(() => {
        // Favicon._reset() is not part of this feature; it is required because
        // every Body.init({}) call below (favicon left unconfigured) installs
        // the default favicon as a side effect, and Favicon's own module state
        // caches the handle it wrote through — a handle that does not resolve
        // against the fresh table DOM.reset() installs for the next case (see
        // Favicon._reset()'s doc comment, and tests/core/Favicon.test.ts, which
        // guards the same way).
        Favicon._reset();
        Body.getInstance().setNativeContextMenu(true);
        DOM.reset();
    });

    // Placed first: only the file's first test observes the singleton before
    // any configuration has touched it.
    it('reports the effective value through every transition', () => {
        installTestDOM(CONFIG);

        expect(Body.getInstance().getNativeContextMenu()).toBe(false);

        const body = Body.init({ nativeContextMenu: true });
        expect(body.getNativeContextMenu()).toBe(true);

        body.setNativeContextMenu(false);
        expect(body.getNativeContextMenu()).toBe(false);
    });

    it('suppresses the native menu by default', () => {
        installTestDOM(CONFIG);
        Body.init({});

        expect(dispatchContextMenu(DOM.source.getBody())).toBe(1);
    });

    it('restores the native menu when opted in', () => {
        const sink = installTestDOM(CONFIG);
        Body.init({ nativeContextMenu: true });

        expect(dispatchContextMenu(DOM.source.getBody())).toBe(0);
        expect(contextMenuWrites(sink, 'addListener')).toBe(0);
    });

    it('behaves like the default when nativeContextMenu is explicitly false', () => {
        installTestDOM(CONFIG);
        Body.init({ nativeContextMenu: false });

        expect(dispatchContextMenu(DOM.source.getBody())).toBe(1);
    });

    it('registers the listener once across repeated Body.init calls', () => {
        const sink = installTestDOM(CONFIG);
        Body.init({});
        Body.init({});

        expect(contextMenuWrites(sink, 'addListener')).toBe(1);
        expect(dispatchContextMenu(DOM.source.getBody())).toBe(1);
    });

    it('removes the listener when the native menu is enabled at runtime', () => {
        const sink = installTestDOM(CONFIG);
        Body.init({});

        Body.getInstance().setNativeContextMenu(true);

        expect(contextMenuWrites(sink, 'removeListener')).toBe(1);
        expect(dispatchContextMenu(DOM.source.getBody())).toBe(0);
    });

    it('enabling the native menu when nothing is registered is a no-op', () => {
        const sink = installTestDOM(CONFIG);

        // Entering state is already "true" (unregistered) here, whether from a
        // prior test's afterEach or, for a first-in-file run, the singleton's
        // unconfigured default — both exercise the same guarded no-op.
        Body.getInstance().setNativeContextMenu(true);

        expect(contextMenuWrites(sink, 'removeListener')).toBe(0);
    });

    it('round-trips through multiple toggles with the expected sink writes', () => {
        const sink = installTestDOM(CONFIG);
        const body = Body.init({});

        body.setNativeContextMenu(true);
        body.setNativeContextMenu(false);

        expect(contextMenuWrites(sink, 'addListener')).toBe(2);
        expect(contextMenuWrites(sink, 'removeListener')).toBe(1);
        expect(dispatchContextMenu(DOM.source.getBody())).toBe(1);
    });

    // Placed last: registers its own exact-target "contextmenu" listener
    // (a separate window handler from the viewport one above) and tears it
    // down at the end so it cannot leak into a later case.
    it("a component's own contextmenu handler still runs alongside the global suppression", () => {
        installTestDOM(CONFIG);
        Body.init({});

        const child = new Component({});
        const target = child.getElement(true)!;

        let handlerRuns = 0;
        const handler = (): void => { handlerRuns += 1; };

        Event.addListener(child, 'contextmenu', handler);

        expect(dispatchContextMenu(target)).toBe(1);
        expect(handlerRuns).toBe(1);

        Event.removeListener(child, 'contextmenu', handler);
    });
});
