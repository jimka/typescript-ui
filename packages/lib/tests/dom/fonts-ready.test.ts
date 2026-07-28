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

describe('ThemeManager — web font download', () => {
    afterEach(() => {
        Reflect.deleteProperty(document, 'fonts');
    });

    it('starts the download when the rules are installed, not at first paint', async () => {
        const fontSet = installIdleFontSet();

        // `ensureFontLoaded` is guarded by a module-level once-flag, so this
        // needs a module graph where it has not already run — independent of
        // whatever else in this file has called setTheme.
        vi.resetModules();
        const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');

        FreshThemeManager.setTheme(FreshModernTheme);

        // Nothing has been laid out yet — the fetch is under way regardless,
        // which is the whole point: it overlaps the first layout instead of
        // following it.
        expect(fontSet.loadCalls).toEqual(['14px "Manrope Variable"']);
    });
});

describe('ThemeManager — startup layout gate', () => {
    afterEach(async () => {
        Reflect.deleteProperty(document, 'fonts');

        // Each case below arms a *fresh* module graph's gate, so releasing the
        // statically-imported one would leave that copy held. Reach the current
        // graph's copy the same way the cases do.
        const { releaseFirstLayout } = await import('~/core/FirstLayoutGate');
        releaseFirstLayout();
        vi.resetModules();
    });

    it('arms the gate when a font load really started', async () => {
        const fontSet = installIdleFontSet();

        vi.resetModules();
        const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');
        // The gate must come from the same fresh graph the theme module just
        // touched — a statically-imported copy is a different module instance
        // with its own state.
        const { isFirstLayoutHeld } = await import('~/core/FirstLayoutGate');

        FreshThemeManager.setTheme(FreshModernTheme);

        expect(fontSet.loadCalls).toEqual(['14px "Manrope Variable"']);
        expect(isFirstLayoutHeld()).toBe(true);
    });

    it('leaves the gate open when the engine cannot load fonts asynchronously', async () => {
        Reflect.deleteProperty(document, 'fonts');

        vi.resetModules();
        const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');
        const { isFirstLayoutHeld } = await import('~/core/FirstLayoutGate');

        FreshThemeManager.setTheme(FreshModernTheme);

        // Nothing would ever release a gate armed here, so it must never close.
        expect(isFirstLayoutHeld()).toBe(false);
    });

    it('refreshes the text metrics before it opens the gate', async () => {
        const fontSet = installIdleFontSet();

        vi.resetModules();
        const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');
        const { isFirstLayoutHeld } = await import('~/core/FirstLayoutGate');
        const { Util: FreshUtil } = await import('~/core/Util');

        FreshThemeManager.setTheme(FreshModernTheme);
        await settleMicrotasks();

        const generationBeforeSwap = FreshUtil.textMetricsGeneration();

        // Guards against this case passing vacuously on a build where the gate
        // is never armed in the first place.
        expect(isFirstLayoutHeld()).toBe(true);

        // Sample the gate from inside the re-measure. `reflowText` fans out to
        // the theme listeners, so this runs mid-refresh — the one vantage point
        // from which the two steps are distinguishable. Registered after
        // `setTheme`, whose own tail reflow would otherwise fire it early.
        let heldDuringRefresh: boolean | null = null;
        FreshThemeManager.onThemeChange(() => { heldDuringRefresh = isFirstLayoutHeld(); });

        fontSet.completeLoadBatch();

        // The order is the assertion, not just the end state: the refresh has
        // to see a still-held gate, so the flush the release frees can never
        // run against text sizes cached before the font activated.
        expect(heldDuringRefresh).toBe(true);
        expect(FreshUtil.textMetricsGeneration()).toBeGreaterThan(generationBeforeSwap);
        expect(isFirstLayoutHeld()).toBe(false);
    });
});

describe('ModelledDOMSource.startFontLoad', () => {
    afterEach(() => DOM.reset());

    it('reports no load started, so offline runs never arm the gate', () => {
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
