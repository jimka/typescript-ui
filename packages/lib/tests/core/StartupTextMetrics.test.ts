// The invariant this file pins: no text may be measured before the active
// theme's font tokens are on `<html>`. Until `setTheme` has run, the
// measurement probe's `var(--ts-ui-font-family, system-ui, sans-serif)`
// resolves to its literal fallback, so every width taken before then is
// measured against the browser's own UI face rather than the theme's.
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Theme } from '~/core/Theme';
import type { TextAdvanceSpacing } from '~/core/DOM';
import type { TextMeasureOptions, TextMeasureRequest } from '~/core/Util';
import { CALIBRATION_TEXT } from '~/core/TextMeasure';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * Builds the app in a fresh module graph, recording every string measured
 * before the theme was applied — through the probe or on the canvas.
 *
 * @param awaitInit - Whether the app awaits `Body.init` before building its
 *   tree (the documented pattern) or builds first (the superseded one).
 */
async function runApp(awaitInit: boolean): Promise<string[]> {
    vi.resetModules();

    const { installTestDOM } = await import('../dom/TestDOM');
    installTestDOM(CONFIG);

    const { DOM }          = await import('~/core/DOM');
    const { ThemeManager } = await import('~/core/Theme');
    const { Body }         = await import('~/core/Body');
    const { Fit }          = await import('~/layout/Fit');
    const { MenuBar }      = await import('~/component/menubar/MenuBar');

    let themed = false;
    const untimed: string[] = [];

    const realSetTheme = ThemeManager.setTheme.bind(ThemeManager);
    vi.spyOn(ThemeManager, 'setTheme').mockImplementation((theme: Theme) => {
        themed = true;

        return realSetTheme(theme);
    });

    const realMeasureText    = DOM.source.measureText.bind(DOM.source);
    const realMeasureTexts   = DOM.source.measureTexts.bind(DOM.source);
    const realMeasureAdvance = DOM.source.measureTextAdvance.bind(DOM.source);

    vi.spyOn(DOM.source, 'measureText').mockImplementation((text: string, options?: TextMeasureOptions) => {
        if (!themed) { untimed.push(String(text)); }

        return realMeasureText(text, options);
    });
    vi.spyOn(DOM.source, 'measureTexts').mockImplementation((requests: TextMeasureRequest[]) => {
        if (!themed) { untimed.push(...requests.map(r => r.text)); }

        return realMeasureTexts(requests);
    });
    vi.spyOn(DOM.source, 'measureTextAdvance').mockImplementation((text: string, font: string, spacing: TextAdvanceSpacing) => {
        if (!themed) { untimed.push(text); }

        return realMeasureAdvance(text, font, spacing);
    });

    if (awaitInit) {
        // The documented pattern: bootstrap, then build, then add.
        const body = await Body.init({ layoutManager: Fit() });
        const bar  = new MenuBar({ menus: [{ label: 'File', items: [{ text: 'New' }] }] });

        body.addComponent(bar);
    } else {
        // The superseded pattern, kept so the probe cannot pass vacuously.
        const bar = new MenuBar({ menus: [{ label: 'File', items: [{ text: 'New' }] }] });

        (await Body.init({ layoutManager: Fit() })).addComponent(bar);
    }

    // A font's calibration is not a string the app measured, and a string can
    // reach both the probe and the canvas, so compare the distinct app strings.
    return [...new Set(untimed.filter(text => text !== CALIBRATION_TEXT))].sort();
}

describe('startup text metrics', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('measures no text before the theme has been applied', async () => {
        expect(await runApp(true)).toEqual([]);
    });

    it('control: the same app measures early text when built before the await', async () => {
        expect(await runApp(false)).toEqual(['File', 'New']);
    });
});
