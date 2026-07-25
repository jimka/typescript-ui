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
import { describe, it, expect, afterEach } from 'vitest';
import { ProductionDOMSource } from '~/core/DOM';
import { ThemeManager, ModernTheme } from '~/core/Theme';
import { Util } from '~/core/Util';

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
function installIdleFontSet(): { completeLoadBatch(): void } {
    const listeners: Array<() => void> = [];

    const fonts = {
        status: 'loaded',
        ready:  Promise.resolve(),
        addEventListener(type: string, listener: () => void): void {
            if (type === 'loadingdone') {
                listeners.push(listener);
            }
        },
    };

    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });

    return {
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
