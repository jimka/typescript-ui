// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the shared border-width measurement cache
// introduced by plans/implemented/table-scroll-forced-reflow.md — Expected
// Behaviour rows 1-10 (rows 11-13 are manual-verify, browser-only, per the
// plan's own `## Verification` scroll benchmark).
//
// `ModelledDOMSource.getBorderWidths` always reports `0px` on every side, so
// exercising the measurement branch (rather than the pre-attach estimate
// every other offline test takes) needs a wrapped source with a call-counting
// `getBorderWidths` that returns a chosen width — installed per test via
// `installCountingBorderSource` below. `setConnected` (the existing TestDOM
// precedent used by FocusHistory.test.ts) marks a component's element
// connected so `Component.getBorderSize` takes that branch.
//
// `ThemeManager` is a module-level singleton across the whole test process
// (mirrors HeaderThemeReflow.test.ts's own note), so afterEach restores
// ModernTheme even if an assertion above it fails.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM, type Handle } from '~/core/DOM';
import { ThemeManager, ModernTheme, ClassicTheme } from '~/core/Theme';
import { installTestDOM, setConnected } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _borderWidthCacheSize } from '~/core/BorderWidths';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A bare Component subclass shared by every case in this file. */
class BorderProbe extends Component {}

beforeEach(() => installTestDOM(DOM_CONFIG));

afterEach(() => {
    ThemeManager.setTheme(ModernTheme);
    DOM.reset();
});

/**
 * Wraps the installed source with a call-counting `getBorderWidths` that
 * always reports `widths`, so a test can assert how many times the browser
 * measurement actually ran regardless of which component triggered it.
 *
 * @param widths - The fixed per-side CSS values every call reports.
 *
 * @returns A counter whose `calls` field increments on each `getBorderWidths` call.
 */
function installCountingBorderSource(
    widths: { top: string; right: string; bottom: string; left: string }
): { calls: number } {
    const counter = { calls: 0 };

    const wrapped = Object.create(DOM.source, {
        getBorderWidths: {
            value: (_handle: Handle) => {
                counter.calls += 1;

                return widths;
            },
        },
    });

    DOM.install({ source: wrapped });

    return counter;
}

/** Renders `component` and marks its element connected, so `getBorderSize` takes the measurement branch. */
function renderConnected(component: Component): void {
    const handle = component.getElement(true) as Handle;

    setConnected(handle, true);
}

describe('Shared border-width measurement', () => {
    it('case 1: two components with the identical spec share one measurement', () => {
        const counter = installCountingBorderSource({ top: '2px', right: '2px', bottom: '2px', left: '2px' });

        const a = new BorderProbe({});
        const b = new BorderProbe({});

        a.setBorder('1px solid black');
        b.setBorder('1px solid black');
        renderConnected(a);
        renderConnected(b);

        expect(a.getBorderSize()).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
        expect(b.getBorderSize()).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
        expect(counter.calls).toBe(1);
    });

    it('case 2: two components with different specs each measure', () => {
        const counter = installCountingBorderSource({ top: '2px', right: '2px', bottom: '2px', left: '2px' });

        const a = new BorderProbe({});
        const b = new BorderProbe({});

        a.setBorder('1px solid black');
        b.setBorder('2px solid red');
        renderConnected(a);
        renderConnected(b);

        a.getBorderSize();
        b.getBorderSize();

        expect(counter.calls).toBe(2);
    });

    it('case 3: an all-sides spec and its equivalent per-side longhand spec share one entry', () => {
        const counter = installCountingBorderSource({ top: '2px', right: '2px', bottom: '2px', left: '2px' });

        const a = new BorderProbe({});
        const b = new BorderProbe({});

        a.setBorder({ border: '1px solid black' });
        b.setBorder({
            borderTop:    '1px solid black',
            borderRight:  '1px solid black',
            borderBottom: '1px solid black',
            borderLeft:   '1px solid black',
        });
        renderConnected(a);
        renderConnected(b);

        a.getBorderSize();
        b.getBorderSize();

        expect(counter.calls).toBe(1);
    });

    it('case 4: a bottom-only spec and a top-only spec do not share an entry', () => {
        const counter = installCountingBorderSource({ top: '2px', right: '2px', bottom: '2px', left: '2px' });

        const a = new BorderProbe({});
        const b = new BorderProbe({});

        a.setBorder({ borderBottom: '2px solid black' });
        b.setBorder({ borderTop: '2px solid black' });
        renderConnected(a);
        renderConnected(b);

        a.getBorderSize();
        b.getBorderSize();

        expect(counter.calls).toBe(2);
    });

    it('case 5: a theme change empties the cache and the next measurement re-measures', () => {
        const counter = installCountingBorderSource({ top: '2px', right: '2px', bottom: '2px', left: '2px' });

        const a = new BorderProbe({});

        a.setBorder('1px solid black');
        renderConnected(a);
        a.getBorderSize();
        expect(_borderWidthCacheSize()).toBe(1);

        ThemeManager.setTheme(ClassicTheme);
        expect(_borderWidthCacheSize()).toBe(0);

        const b = new BorderProbe({});

        b.setBorder('1px solid black');
        renderConnected(b);
        b.getBorderSize();

        expect(counter.calls).toBe(2);
    });

    it('case 6: a font-relative spec is measured on every call and never cached', () => {
        const counter = installCountingBorderSource({ top: '2px', right: '2px', bottom: '2px', left: '2px' });

        const a = new BorderProbe({});
        const b = new BorderProbe({});

        a.setBorder('0.1em solid black');
        b.setBorder('0.1em solid black');
        renderConnected(a);
        renderConnected(b);

        a.getBorderSize();
        b.getBorderSize();

        expect(counter.calls).toBe(2);
        expect(_borderWidthCacheSize()).toBe(0);
    });

    it('case 7: a rem spec is cached — rem is root-relative, not font-relative', () => {
        const counter = installCountingBorderSource({ top: '2px', right: '2px', bottom: '2px', left: '2px' });

        const a = new BorderProbe({});
        const b = new BorderProbe({});

        a.setBorder('0.125rem solid black');
        b.setBorder('0.125rem solid black');
        renderConnected(a);
        renderConnected(b);

        a.getBorderSize();
        b.getBorderSize();

        expect(counter.calls).toBe(1);
    });

    it('case 8: an unconnected component takes the estimate branch and adds no cache entry', () => {
        const counter = installCountingBorderSource({ top: '2px', right: '2px', bottom: '2px', left: '2px' });

        const a = new BorderProbe({});

        a.setBorder('3px solid red');

        expect(a.getBorderSize()).toEqual({ top: 3, right: 3, bottom: 3, left: 3 });
        expect(counter.calls).toBe(0);
        expect(_borderWidthCacheSize()).toBe(0);
    });

    it('case 9: setBorder after a measurement invalidates the instance cache, forcing a re-measure', () => {
        const counter = installCountingBorderSource({ top: '2px', right: '2px', bottom: '2px', left: '2px' });

        const a = new BorderProbe({});

        a.setBorder('1px solid black');
        renderConnected(a);
        a.getBorderSize();
        expect(counter.calls).toBe(1);

        a.setBorder('4px solid red');
        a.getBorderSize();

        expect(counter.calls).toBe(2);
    });

    it('case 10: clearBorder reports zero widths on every side', () => {
        const a = new BorderProbe({});

        a.setBorder('3px solid red');
        renderConnected(a);
        a.clearBorder();

        expect(a.getBorderSize()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });
});
