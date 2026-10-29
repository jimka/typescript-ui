// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for the focus services and the layer stack across a sink swap.
//
// `FocusTraversal`, `FocusHistory` and `SpatialNavigation` each install
// viewport listeners when enabled and record that they did, and
// `LayerManager` records that its document-level listeners are installed.
// `Event` drops every viewport registration on a swap, so each of these used
// to go on reporting itself enabled — or installed — with nothing listening,
// and `enable()` returned early without listening again. Each now forgets its
// state of the outgoing environment on `DOM.onSinkChange`: the flag, and every
// handle or layer that environment minted.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { FocusTraversal } from '~/core/FocusTraversal';
import { FocusHistory } from '~/core/FocusHistory';
import { SpatialNavigation } from '~/core/SpatialNavigation';
import { LayerManager, type DismissableLayer } from '~/core/LayerManager';
import { installTestDOM, setConnected, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => {
    vi.restoreAllMocks();
    FocusTraversal.disable();
    FocusHistory.disable();
    SpatialNavigation.disable();
    DOM.reset();
});

/** Whether `sink` was asked to listen for `type`. */
function listensFor(sink: RecordingDOMSink, type: string): boolean {
    return sink.writes.some((w) => w.op === 'addListener' && w.args[0] === type);
}

describe('focus services across a sink swap', () => {
    it('FocusTraversal reports itself disabled and listens again once re-enabled', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();
        DOM.reset();

        const sink = installTestDOM(CONFIG);

        expect(FocusTraversal.isEnabled()).toBe(false);

        FocusTraversal.enable();

        expect(listensFor(sink, 'keydown')).toBe(true);
    });

    it('FocusHistory reports itself disabled, empties its trail, and listens again once re-enabled', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();
        DOM.reset();

        const sink = installTestDOM(CONFIG);

        expect(FocusHistory.isEnabled()).toBe(false);
        expect(FocusHistory.canGoBack()).toBe(false);

        FocusHistory.enable();

        expect(listensFor(sink, 'focusin')).toBe(true);
    });

    it('SpatialNavigation reports itself disabled and listens again once re-enabled', () => {
        installTestDOM(CONFIG);
        SpatialNavigation.enable();
        DOM.reset();

        const sink = installTestDOM(CONFIG);

        expect(SpatialNavigation.isEnabled()).toBe(false);

        SpatialNavigation.enable();

        expect(listensFor(sink, 'keydown')).toBe(true);
    });
});

describe('layer stack across a sink swap', () => {
    /** A connected modal layer of the installed sink. */
    function modalLayer(): DismissableLayer {
        const element = DOM.sink.createElement('div');

        setConnected(element, true);

        return {
            getLayerElement: () => element,
            getDismissMode:  () => 'modal',
            requestClose:    () => {},
        };
    }

    it('forgets a modal layer opened under the old sink', () => {
        installTestDOM(CONFIG);
        LayerManager.register(modalLayer());
        DOM.reset();

        installTestDOM(CONFIG);

        expect(LayerManager.getTopLayer()).toBeNull();
    });

    it('installs its document listeners on the replaced sink for the next layer', () => {
        installTestDOM(CONFIG);
        const stale = modalLayer();
        LayerManager.register(stale);
        DOM.reset();

        const sink  = installTestDOM(CONFIG);
        const fresh = modalLayer();

        try {
            LayerManager.register(fresh);

            expect(listensFor(sink, 'pointerdown')).toBe(true);
        } finally {
            LayerManager.unregister(fresh);
        }
    });
});
