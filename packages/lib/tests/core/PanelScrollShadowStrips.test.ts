//
// Offline coverage for the scroll-shadow edge strips: the four thin per-edge
// strips that replace the single viewport-sized `box-shadow` overlay. Mirrors
// PanelOverlayScrollbar.test.ts's CONFIG / stubMetrics / internals / lastStyle
// idiom and PanelScrollChaining.test.ts's harness, plus
// Panel.styleRuleDisposal.test.ts's destructor-cast idiom for teardown coverage.
//
import { describe, it, expect, afterEach, vi } from 'vitest';
import { _Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import type { RecordingDOMSink } from '../dom/TestDOM';
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
    DOM.reset();
});

/** Stages the element geometry the scroll-shadow path reads, defaulting every axis to "fits". */
function stubMetrics(metrics: Partial<{
    scrollTop: number; scrollLeft: number;
    scrollWidth: number; scrollHeight: number;
    clientWidth: number; clientHeight: number;
}>) {
    return vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
        scrollTop: 0, scrollLeft: 0,
        scrollWidth: 400, scrollHeight: 300,
        clientWidth: 400, clientHeight: 300,
        ...metrics,
    });
}

/** Narrow shape reaching the strip-related private state without `any`. */
type StripInternals = {
    _shadowOverlay: Handle | null;
    _shadowStrips:  readonly Handle[];
};

function internals(panel: _Panel): StripInternals {
    return panel as unknown as StripInternals;
}

/** The accumulated inline style a raw handle has been written, last write wins. */
function styleOf(sink: RecordingDOMSink, handle: Handle): Record<string, string | null> {
    const style: Record<string, string | null> = {};

    for (const write of sink.writes) {
        if (write.op === 'apply' && write.args[0] === handle) {
            Object.assign(style, (write.args[1] as { style?: Record<string, string | null> }).style ?? {});
        }
    }

    return style;
}

/** Handles the sink recorded a `release` op for, in call order. */
function releasedHandles(sink: RecordingDOMSink): Handle[] {
    return sink.writes.filter((w) => w.op === 'release').map((w) => w.args[0] as Handle);
}

describe('Panel scroll-shadow strips', () => {
    it('creates four strips on a scrolling panel, styled like the recipe, host stays boxShadow-free', () => {
        const sink = installTestDOM(CONFIG);
        stubMetrics({ scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'auto' });
        panel.getElement(true);

        const i = internals(panel);
        expect(i._shadowOverlay).not.toBeNull();
        expect(i._shadowStrips).toHaveLength(4);

        const [top, bottom, left, right] = i._shadowStrips;

        expect(styleOf(sink, top)).toEqual({
            position: 'absolute', top: '0', left: '0', right: '0', height: '12px', maxHeight: '100%',
            boxShadow: 'inset 0 12px 12px -12px var(--ts-ss-top, transparent)',
        });
        expect(styleOf(sink, bottom)).toEqual({
            position: 'absolute', bottom: '0', left: '0', right: '0', height: '12px', maxHeight: '100%',
            boxShadow: 'inset 0 -12px 12px -12px var(--ts-ss-bottom, transparent)',
        });
        expect(styleOf(sink, left)).toEqual({
            position: 'absolute', left: '0', top: '0', bottom: '0', width: '12px', maxWidth: '100%',
            boxShadow: 'inset 12px 0 12px -12px var(--ts-ss-left, transparent)',
        });
        expect(styleOf(sink, right)).toEqual({
            position: 'absolute', right: '0', top: '0', bottom: '0', width: '12px', maxWidth: '100%',
            boxShadow: 'inset -12px 0 12px -12px var(--ts-ss-right, transparent)',
        });

        expect(styleOf(sink, i._shadowOverlay!)).not.toHaveProperty('boxShadow');
    });

    it('creates no host and no strips for a non-scrolling panel (default autoScroll: "none")', () => {
        installTestDOM(CONFIG);

        const panel = new _Panel();
        panel.getElement(true);

        const i = internals(panel);
        expect(i._shadowOverlay).toBeNull();
        expect(i._shadowStrips).toEqual([]);
    });

    it('releases every strip when shadows are disabled, and creates four fresh ones on re-enable', () => {
        const sink = installTestDOM(CONFIG);
        stubMetrics({ scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'auto' });
        panel.getElement(true);

        const firstStrips = internals(panel)._shadowStrips;
        expect(firstStrips).toHaveLength(4);

        panel.setScrollShadows(false);

        expect(internals(panel)._shadowStrips).toEqual([]);

        for (const strip of firstStrips) {
            expect(releasedHandles(sink)).toContain(strip);
        }

        panel.setScrollShadows(true);

        const secondStrips = internals(panel)._shadowStrips;

        expect(secondStrips).toHaveLength(4);
        expect(secondStrips).not.toEqual(firstStrips);
    });

    it('releases every strip on destructor, leaving _shadowStrips empty', () => {
        const sink = installTestDOM(CONFIG);
        stubMetrics({ scrollHeight: 900, clientHeight: 300 });

        const panel = new _Panel({ autoScroll: 'auto' });
        panel.getElement(true);

        const strips = internals(panel)._shadowStrips;
        expect(strips).toHaveLength(4);

        (panel as unknown as { destructor(): void }).destructor();

        for (const strip of strips) {
            expect(releasedHandles(sink)).toContain(strip);
        }

        expect(internals(panel)._shadowStrips).toEqual([]);
    });
});
