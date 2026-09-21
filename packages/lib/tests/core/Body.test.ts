import { describe, it, expect, afterEach, vi } from 'vitest';
import { Body } from '~/core/Body';
import { Component } from '~/core/Component';
import { Fit } from '~/layout/Fit';
import { DOM } from '~/core/DOM';
import { Favicon } from '~/core/Favicon';
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
    afterEach(() => {
        // Every Body.init(…) call below (favicon left unconfigured) installs
        // the default favicon as a side effect, and Favicon's own module state
        // caches the handle it wrote through — a handle that does not resolve
        // against the fresh table DOM.reset() installs for the next case (see
        // Favicon._reset()'s doc comment, and tests/core/BodyContextMenu.test.ts,
        // which guards the same way).
        Favicon._reset();
        DOM.reset();
    });

    it('applies the options bag to the singleton and returns it', async () => {
        installTestDOM(CONFIG);

        const fit   = new Fit();
        const child = new Component({});

        const body = await Body.init({ layoutManager: fit });
        body.addComponent(child);

        // init is the one-call entry point: it returns the same singleton
        // getInstance() hands out, with the supplied layout applied.
        expect(body).toBe(Body.getInstance());
        expect(body.getLayoutManager()).toBe(fit);
        expect(body.getComponents()).toContain(child);
    });

    it('B6. resolves with the singleton', async () => {
        installTestDOM(CONFIG);

        const body = await Body.init({});

        expect(body).toBe(Body.getInstance());
    });

    it('B7. applies its options synchronously', async () => {
        installTestDOM(CONFIG);

        const fit = new Fit();

        const pending = Body.init({ layoutManager: fit });

        expect(Body.getInstance().getLayoutManager()).toBe(fit);

        await pending;
    });

    it('B8. components is not a BodyOptions field', () => {
        installTestDOM(CONFIG);

        // @ts-expect-error — `components` was removed from `BodyOptions`.
        Body.init({ components: [new Component({})] });
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

        await FreshBody.init({});

        expect(subscribedWhileBuilding).toBeGreaterThan(0);
        expect(fired).toBe(1);
    });
});
