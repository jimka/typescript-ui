// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for the `Body` singleton across a sink swap.
//
// `Body` is the one component that outlives every DOM environment, and
// `Body.init` is what rebinds it to the installed one. A seam swap drops every
// viewport registration (`Event`) and every background surface
// (`LayerManager`), so `init` registers the singleton's own again: the
// `resize` listener that keeps its size current and, while the native menu is
// suppressed, the page-wide `contextmenu` listener. The surface entry is
// covered by Body.modalInert.test.ts, whose cases each run against a fresh DOM.
import { describe, it, expect, afterEach } from 'vitest';
import { Body } from '~/core/Body';
import { DOM } from '~/core/DOM';
import { installTestDOM, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/** Whether `sink` was asked to listen for `type`. */
function listensFor(sink: RecordingDOMSink, type: string): boolean {
    return sink.writes.some((w) => w.op === 'addListener' && w.args[0] === type);
}

describe('Body across a sink swap', () => {
    it('re-registers its resize and contextmenu listeners on the replaced sink', async () => {
        installTestDOM(CONFIG);
        await Body.init({});
        DOM.reset();

        const sink = installTestDOM(CONFIG);
        await Body.init({});

        expect(listensFor(sink, 'resize')).toBe(true);
        expect(listensFor(sink, 'contextmenu')).toBe(true);
    });
});
