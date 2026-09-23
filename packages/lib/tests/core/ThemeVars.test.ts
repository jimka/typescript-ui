// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the theme-variable cache introduced by
// plans/implemented/environment-read-caching.md — Expected Behaviour rows
// T1-T12.
//
// The cache sits above the DOM seam, so a pass-through `vi.spyOn` on
// `DOM.source.getThemeVar` counts exactly the reads that still reach it:
// "reads of X" below is `readsOf(name)`, the spy calls whose argument is
// `name`. A spy keeps the source object identity, which the cache keys on, so
// installing it changes nothing the cache can see.
//
// `ThemeManager` is a module-level singleton across the whole test process
// (mirrors BorderWidths.test.ts's own note), so afterEach restores ModernTheme
// even if an assertion above it fails, in the order that file uses.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { VBox } from '~/layout/VBox';
import { TextField } from '~/component/input/TextField';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { DOM } from '~/core/DOM';
import { ThemeManager, ModernTheme } from '~/core/Theme';
import { Util } from '~/core/Util';
import { readThemeVar, clearThemeVars, _themeVarCacheSize } from '~/core/ThemeVars';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

/** A bare Component subclass shared by the border-estimate case. */
class BorderProbe extends Component {}

/**
 * A fresh modelled-DOM config per case: T4 mutates `themeVars` in place to
 * model a `:root` variable changed behind the library's back.
 *
 * @returns The config, with the three variables the cases read.
 */
function makeConfig(): {
    rootMountOffset: { x: number; y: number };
    viewport:        { width: number; height: number };
    scrollBarWidth:  number;
    fontMetrics:     typeof fontMetrics;
    themeVars:       Record<string, string>;
} {
    return {
        rootMountOffset: { x: 0, y: 0 },
        viewport:        { width: 1280, height: 800 },
        scrollBarWidth:  15,
        fontMetrics,
        themeVars: {
            '--ts-ui-test-width':  '3px',
            '--ts-ui-test-border': '2px solid red',
            '--ts-ui-input-border': '1px solid #ccc',
        },
    };
}

describe('Theme-variable cache', () => {
    let config: ReturnType<typeof makeConfig>;
    let spy: MockInstance<(name: string) => string>;

    beforeEach(() => {
        config = makeConfig();
        installTestDOM(config);

        spy = vi.spyOn(DOM.source, 'getThemeVar');
    });

    afterEach(() => {
        // The window cases leave entries in the static open-window set, which
        // outlives the DOM — drop them before it resets, as the other window
        // suites do.
        (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();

        vi.restoreAllMocks();
        ThemeManager.setTheme(ModernTheme);
        DOM.reset();
    });

    /**
     * Counts the seam reads of one variable since the spy was installed.
     *
     * @param name - The custom-property name.
     *
     * @returns How many `getThemeVar` calls asked for it.
     */
    function readsOf(name: string): number {
        return spy.mock.calls.filter((call) => call[0] === name).length;
    }

    it('T1: a repeated read of the same variable reaches the seam once', () => {
        expect(readThemeVar('--ts-ui-test-width')).toBe('3px');
        expect(readThemeVar('--ts-ui-test-width')).toBe('3px');

        expect(readsOf('--ts-ui-test-width')).toBe(1);
    });

    it('T2: an unset variable is cached too', () => {
        expect(readThemeVar('--ts-ui-test-unset')).toBe('');
        expect(readThemeVar('--ts-ui-test-unset')).toBe('');

        expect(readsOf('--ts-ui-test-unset')).toBe(1);
    });

    it('T3: two different names each reach the seam once', () => {
        readThemeVar('--ts-ui-test-width');
        readThemeVar('--ts-ui-test-border');

        expect(readsOf('--ts-ui-test-width')).toBe(1);
        expect(readsOf('--ts-ui-test-border')).toBe(1);
    });

    it('T4: a variable changed outside setTheme is not seen', () => {
        expect(readThemeVar('--ts-ui-test-width')).toBe('3px');

        config.themeVars['--ts-ui-test-width'] = '5px';

        expect(readThemeVar('--ts-ui-test-width')).toBe('3px');
        expect(readsOf('--ts-ui-test-width')).toBe(1);
    });

    it('T5: setTheme clears the cache, so the next read sees the new value', () => {
        readThemeVar('--ts-ui-test-width');
        config.themeVars['--ts-ui-test-width'] = '5px';

        ThemeManager.setTheme(ModernTheme);

        expect(readThemeVar('--ts-ui-test-width')).toBe('5px');
        expect(readsOf('--ts-ui-test-width')).toBe(2);
    });

    it('T6: invalidateTextMetricsCache clears the cache', () => {
        readThemeVar('--ts-ui-test-width');

        Util.invalidateTextMetricsCache();

        readThemeVar('--ts-ui-test-width');

        expect(readsOf('--ts-ui-test-width')).toBe(2);
    });

    it('T7: a newly installed source is never served the old source\'s value', () => {
        expect(readThemeVar('--ts-ui-test-width')).toBe('3px');

        DOM.install({ source: Object.create(DOM.source, { getThemeVar: { value: (): string => '9px' } }) });

        expect(readThemeVar('--ts-ui-test-width')).toBe('9px');
    });

    it('T8: DOM.reset and a fresh installTestDOM start from empty', () => {
        expect(readThemeVar('--ts-ui-test-width')).toBe('3px');

        DOM.reset();

        const next = makeConfig();

        next.themeVars['--ts-ui-test-width'] = '7px';
        installTestDOM(next);

        expect(readThemeVar('--ts-ui-test-width')).toBe('7px');
    });

    it('T9: clearThemeVars empties the cache', () => {
        readThemeVar('--ts-ui-test-width');
        readThemeVar('--ts-ui-test-border');

        clearThemeVars();

        expect(_themeVarCacheSize()).toBe(0);
    });

    it('T10: four detached components sharing a var-valued border estimate read it once', () => {
        const children = [new BorderProbe({}), new BorderProbe({}), new BorderProbe({})];
        const panel    = new Panel({ layoutManager: new VBox(), components: children });

        for (const component of [panel, ...children]) {
            component.setBorder('var(--ts-ui-test-border)');
        }

        panel.doLayout();

        for (const component of [panel, ...children]) {
            expect(component.getBorderSize()).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
        }

        expect(readsOf('--ts-ui-test-border')).toBe(1);
    });

    it('T11: two TextFields share one read of the input border token', () => {
        new TextField();
        new TextField();

        expect(readsOf('--ts-ui-input-border')).toBe(1);
    });

    it('T12: two window shows read the window-control border token at most once', () => {
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation(() => 0);
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((): number => 0) as typeof setTimeout);

        new Window('A').show();
        new Window('B').show();

        expect(readsOf('--ts-ui-window-control-border')).toBeLessThanOrEqual(1);
    });
});
