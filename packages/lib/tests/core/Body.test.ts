import { describe, it, expect, afterEach, vi } from 'vitest';
import { Body } from '~/core/Body';
import { Component } from '~/core/Component';
import { Fit } from '~/layout/Fit';
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

describe('Body.init', () => {
    afterEach(() => DOM.reset());

    it('applies the options bag to the singleton and returns it', () => {
        installTestDOM(CONFIG);

        const fit   = new Fit();
        const child = new Component({});

        const body = Body.init({ layoutManager: fit, components: [child] });

        // init is the one-call entry point: it returns the same singleton
        // getInstance() hands out, with the supplied layout + children applied.
        expect(body).toBe(Body.getInstance());
        expect(body.getLayoutManager()).toBe(fit);
        expect(body.getComponents()).toContain(child);
    });
});

describe('Body — lazy construction', () => {
    afterEach(() => DOM.reset());

    it('B2. writes nothing until the singleton is first reached', async () => {
        vi.resetModules();

        const { installTestDOM: freshInstallTestDOM } = await import('../dom/TestDOM');
        const sink = freshInstallTestDOM(CONFIG);
        const { Body: FreshBody } = await import('~/core/Body');

        const writesAfterImport = sink.writes.length;

        FreshBody.getInstance();

        expect(writesAfterImport).toBe(0);
        expect(sink.writes.length).toBeGreaterThan(0);
    });

    it('B3. applies ModernTheme when the app set no theme', async () => {
        vi.resetModules();

        const { installTestDOM: freshInstallTestDOM } = await import('../dom/TestDOM');
        freshInstallTestDOM(CONFIG);
        const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');
        const { Body: FreshBody } = await import('~/core/Body');

        const setTheme = vi.spyOn(FreshThemeManager, 'setTheme');

        FreshBody.getInstance();

        expect(setTheme).toHaveBeenCalledWith(FreshModernTheme);
    });

    it('B4. keeps a theme the app chose before the body was reached', async () => {
        vi.resetModules();

        const { installTestDOM: freshInstallTestDOM } = await import('../dom/TestDOM');
        freshInstallTestDOM(CONFIG);
        const { ThemeManager: FreshThemeManager, DarkTheme: FreshDarkTheme } = await import('~/core/Theme');
        const { Body: FreshBody } = await import('~/core/Body');

        FreshThemeManager.setTheme(FreshDarkTheme);

        const setTheme = vi.spyOn(FreshThemeManager, 'setTheme');

        FreshBody.init({});

        expect(setTheme).not.toHaveBeenCalled();
        expect(FreshThemeManager.getTheme()).toBe(FreshDarkTheme);
    });

    it('B5. fans the default theme out to a component built before the body was reached', async () => {
        vi.resetModules();

        const { installTestDOM: freshInstallTestDOM } = await import('../dom/TestDOM');
        freshInstallTestDOM(CONFIG);
        const { ThemeManager: FreshThemeManager } = await import('~/core/Theme');
        const { Button: FreshButton } = await import('~/component/button/Button');
        const { Body: FreshBody } = await import('~/core/Body');

        const button = FreshButton({ text: 'Save' });

        // The button subscribed to theme changes while it was built — before
        // any theme existed, which is the ordering this case is about.
        const subscribedWhileBuilding = FreshThemeManager._themeListenerCount();

        // Stands in for that subscription: registered after the button's, it
        // rides the same fan-out, so a fire here means the button's ran too.
        let fired = 0;
        FreshThemeManager.onThemeChange(() => fired++);

        FreshBody.init({ components: [button] });

        expect(subscribedWhileBuilding).toBeGreaterThan(0);
        expect(fired).toBe(1);
    });
});
