// @vitest-environment jsdom
//
// Regression coverage for the font-swap re-measure seam, against the REAL
// production source (the `jsdom` pragma keeps `tests/setup/node-setup.ts` from
// installing the modelled DOM, which is inert here by design).
//
// The framework injects its `@font-face` rules from JS at `setTheme` time and
// then subscribes for the swap-in, because every `Text` measured against the
// fallback face caches a preferred size that is wrong once the real glyphs
// arrive. The subscription has to survive the fact that the font set is *idle*
// at the instant it is made: the rules were injected microseconds earlier and
// no text has been laid out with them, so the browser has not begun fetching.
// `document.fonts` is not implemented by jsdom, so each test installs a stub
// that models that exact sequence — idle at subscription, batch completes
// later.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM, ProductionDOMSource } from '~/core/DOM';
import { ThemeManager, ModernTheme } from '~/core/Theme';
import { Util } from '~/core/Util';
import { installTestDOM } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

/** Drains the microtask queue, so an already-resolved promise gets its turn. */
async function settleMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Installs a `document.fonts` stub in the state the framework actually
 * subscribes in — idle, with `ready` already resolved — and hands back a
 * trigger for the load batch that completes later.
 */
function installIdleFontSet(loadResult: Promise<unknown> = Promise.resolve([])): {
    completeLoadBatch(): void;
    loadCalls: string[];
} {
    const listeners: Array<() => void> = [];
    const loadCalls: string[]          = [];

    const fonts = {
        status: 'loaded',
        ready:  Promise.resolve(),
        addEventListener(type: string, listener: () => void): void {
            if (type === 'loadingdone') {
                listeners.push(listener);
            }
        },
        load(font: string): Promise<unknown> {
            loadCalls.push(font);

            return loadResult;
        },
    };

    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });

    return {
        loadCalls,
        completeLoadBatch(): void {
            listeners.forEach(listener => listener());
        },
    };
}

describe('ProductionDOMSource.onFontsReady', () => {
    afterEach(() => {
        Reflect.deleteProperty(document, 'fonts');
    });

    it('signals only once the face has swapped in, not while the set is still idle', async () => {
        const fontSet = installIdleFontSet();
        let fired     = 0;

        new ProductionDOMSource().onFontsReady(() => fired++);

        await settleMicrotasks();
        const firedBeforeSwap = fired;

        // The browser now fetches and applies the real face — the moment every
        // fallback-derived measurement in the page becomes stale.
        fontSet.completeLoadBatch();

        expect(firedBeforeSwap).toBe(0);
        expect(fired).toBe(1);
    });

    it('stays inert on engines without the CSS Font Loading API', () => {
        Reflect.deleteProperty(document, 'fonts');
        let fired = 0;

        expect(() => new ProductionDOMSource().onFontsReady(() => fired++)).not.toThrow();
        expect(fired).toBe(0);
    });
});

describe('ProductionDOMSource.startFontLoad', () => {
    afterEach(() => {
        Reflect.deleteProperty(document, 'fonts');
    });

    it('asks the font set for the family instead of waiting for text to use it', () => {
        const fontSet = installIdleFontSet();

        const started = new ProductionDOMSource().startFontLoad('Manrope Variable');

        expect(fontSet.loadCalls).toEqual(['14px "Manrope Variable"']);
        expect(started).toBe(true);
    });

    it('swallows a failed load rather than surfacing an unhandled rejection', async () => {
        installIdleFontSet(Promise.reject(new Error('network')));

        expect(() => new ProductionDOMSource().startFontLoad('Manrope Variable')).not.toThrow();

        // An unswallowed rejection surfaces on the next turns of the microtask
        // queue, so drain it before the assertion can pass vacuously.
        await settleMicrotasks();
    });

    it('reports no load started on an engine without the CSS Font Loading API', () => {
        Reflect.deleteProperty(document, 'fonts');

        // `false` is load-bearing, not cosmetic: it is what keeps the caller
        // from arming a gate that nothing would ever release.
        expect(new ProductionDOMSource().startFontLoad('Manrope Variable')).toBe(false);
    });
});

describe('Body — web font download', () => {
    afterEach(() => {
        Reflect.deleteProperty(document, 'fonts');
        vi.resetModules();
    });

    it('starts no download when the module is imported', async () => {
        const fontSet = installIdleFontSet();

        // `ensureFontLoaded` is guarded by a module-level once-flag, so this
        // needs a module graph where it has not already run — independent of
        // whatever else in this file has called setTheme.
        vi.resetModules();
        await import('~/core/Body');

        expect(fontSet.loadCalls).toEqual([]);
    });

    it('starts the download when the body is first reached, not at first paint', async () => {
        const fontSet = installIdleFontSet();

        vi.resetModules();
        const { Body: FreshBody } = await import('~/core/Body');

        FreshBody.getInstance();

        // Nothing has been laid out yet — the fetch is under way regardless,
        // which is the whole point: it overlaps the first layout instead of
        // following it.
        expect(fontSet.loadCalls).toEqual(['14px "Manrope Variable"']);
    });
});

describe('ThemeManager — startup font wait', () => {
    afterEach(() => {
        Reflect.deleteProperty(document, 'fonts');
        vi.resetModules();
    });

    it('settles on loadingdone', async () => {
        const fontSet = installIdleFontSet();

        vi.resetModules();
        const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');
        // The wait must come from the same fresh graph the theme module just
        // touched — a statically-imported copy is a different module instance
        // with its own state.
        const { isFontActivated } = await import('~/core/FontActivation');

        FreshThemeManager.setTheme(FreshModernTheme);

        expect(fontSet.loadCalls).toEqual(['14px "Manrope Variable"']);
        expect(isFontActivated()).toBe(false);

        fontSet.completeLoadBatch();

        expect(isFontActivated()).toBe(true);
    });

    it('settles at once when the engine cannot load fonts asynchronously', async () => {
        Reflect.deleteProperty(document, 'fonts');

        vi.resetModules();
        const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');
        const { isFontActivated } = await import('~/core/FontActivation');

        FreshThemeManager.setTheme(FreshModernTheme);

        // Nothing would ever report back for a wait armed here, so it must
        // settle immediately rather than stall until the deadline.
        expect(isFontActivated()).toBe(true);
    });

    it('refreshes the text metrics before it settles', async () => {
        const fontSet = installIdleFontSet();

        vi.resetModules();
        const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');
        const { isFontActivated } = await import('~/core/FontActivation');
        const { Util: FreshUtil } = await import('~/core/Util');

        FreshThemeManager.setTheme(FreshModernTheme);
        await settleMicrotasks();

        const generationBeforeSwap = FreshUtil.textMetricsGeneration();

        // Guards against this case passing vacuously on a build where the wait
        // is already settled by this point.
        expect(isFontActivated()).toBe(false);

        // Sample the wait from inside the re-measure. `reflowText` fans out to
        // the theme listeners, so this runs mid-refresh — the one vantage point
        // from which the two steps are distinguishable. Registered after
        // `setTheme`, whose own tail reflow would otherwise fire it early.
        let activatedDuringRefresh: boolean | null = null;
        FreshThemeManager.onThemeChange(() => { activatedDuringRefresh = isFontActivated(); });

        fontSet.completeLoadBatch();

        // The order is the assertion, not just the end state: the refresh has
        // to see a still-unsettled wait, so the awaited bootstrap it resolves
        // can never run against text sizes cached before the font activated.
        expect(activatedDuringRefresh).toBe(false);
        expect(FreshUtil.textMetricsGeneration()).toBeGreaterThan(generationBeforeSwap);
        expect(isFontActivated()).toBe(true);
    });

    it('settles on the deadline', async () => {
        vi.useFakeTimers();

        try {
            // A batch that never completes: `completeLoadBatch` is deliberately
            // never called, so only the deadline can settle the wait.
            installIdleFontSet();

            vi.resetModules();
            const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');
            const { isFontActivated, FONT_ACTIVATION_DEADLINE_MS } = await import('~/core/FontActivation');

            FreshThemeManager.setTheme(FreshModernTheme);

            expect(isFontActivated()).toBe(false);

            vi.advanceTimersByTime(FONT_ACTIVATION_DEADLINE_MS);

            expect(isFontActivated()).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('ProductionDOMSource — early-measurement warning', () => {
    afterEach(() => {
        Reflect.deleteProperty(document, 'fonts');
        vi.resetModules();
    });

    it('warns once when text is measured before the startup font wait settles, and no further after', async () => {
        const fontSet = installIdleFontSet();
        const warn    = vi.spyOn(console, 'warn').mockImplementation(() => {});

        vi.resetModules();
        const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');
        const { ProductionDOMSource: FreshProductionDOMSource } = await import('~/core/DOM');

        FreshThemeManager.setTheme(FreshModernTheme);

        const source = new FreshProductionDOMSource();

        source.measureText('probe');
        source.measureText('probe');

        expect(warn).toHaveBeenCalledTimes(1);

        fontSet.completeLoadBatch();
        source.measureText('probe');

        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe('Body.init — awaited bootstrap', () => {
    afterEach(() => {
        Reflect.deleteProperty(document, 'fonts');
        vi.resetModules();
    });

    it('resolves only after the load batch settles', async () => {
        const fontSet = installIdleFontSet();

        vi.resetModules();
        const { Body: FreshBody } = await import('~/core/Body');

        let resolved = false;
        void FreshBody.init({}).then(() => { resolved = true; });

        await settleMicrotasks();
        expect(resolved).toBe(false);

        fontSet.completeLoadBatch();
        await settleMicrotasks();

        expect(resolved).toBe(true);
    });

    it('resolves without waiting when document.fonts is absent', async () => {
        Reflect.deleteProperty(document, 'fonts');

        vi.resetModules();
        const { Body: FreshBody } = await import('~/core/Body');

        let resolved = false;
        void FreshBody.init({}).then(() => { resolved = true; });

        await settleMicrotasks();
        expect(resolved).toBe(true);
    });

    it('a second call resolves with the same instance', async () => {
        installIdleFontSet();

        vi.resetModules();
        const { Body: FreshBody } = await import('~/core/Body');

        const first  = await FreshBody.init({});
        const second = await FreshBody.init({});

        expect(second).toBe(first);
    });
});

describe('ModelledDOMSource.startFontLoad', () => {
    afterEach(() => DOM.reset());

    it('reports no load started, so offline runs never wait for activation', () => {
        installTestDOM({
            rootMountOffset: { x: 0, y: 0 },
            viewport:        { width: 1280, height: 800 },
            scrollBarWidth:  15,
            fontMetrics,
            themeVars:       {},
        });

        expect(DOM.source.startFontLoad('Manrope Variable')).toBe(false);
    });
});

describe('ThemeManager — font-swap reflow', () => {
    afterEach(() => {
        Reflect.deleteProperty(document, 'fonts');
    });

    it('invalidates the shared text-metrics cache when the face swaps in', async () => {
        const fontSet = installIdleFontSet();

        // The subscription is one-per-process; clear the guard so this test
        // re-subscribes against the stub rather than depending on suite order.
        (ThemeManager as unknown as { fontReflowScheduled: boolean }).fontReflowScheduled = false;

        ThemeManager.setTheme(ModernTheme);
        await settleMicrotasks();

        const generationBeforeSwap = Util.textMetricsGeneration();
        fontSet.completeLoadBatch();

        expect(Util.textMetricsGeneration()).toBeGreaterThan(generationBeforeSwap);
    });
});
