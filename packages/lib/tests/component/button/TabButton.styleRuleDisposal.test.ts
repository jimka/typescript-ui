// Regression: `TabButton.buildCloseButton` raw-appends the overlaid close
// (✕) affordance onto this button's own element (TabButton.ts:145-192, the
// "standard overlay pattern" its own doc comment names) rather than
// registering it via `addComponent`. `TabButton` declared no `destructor()`
// override, so `Component.destructor()`'s child recursion — which only
// walks `_components` — never reached `_closeButton`, stranding its own
// rule (base + `:hover` + `:active`) and its `Glyph` icon's rule on the
// shared sheet every time a closeable tab closed.
//
// Mirrors tests/overlay/Menu.styleRuleDisposal.test.ts's shape: a warm-up
// pass to keep process-global rules out of the diff, a sanity check that the
// close button really materialised a rule, then a before/after
// `_ruleCacheKeys()` diff across `destructor()`.
// See plans/implemented/table-toolbar-button-residual-leak.md.
import { describe, it, expect, afterEach } from 'vitest';
import { TabButton } from '~/component/button/TabButton';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/** Calls the protected destructor, as TabBar.removeBarEntry does when a tab closes. */
function destroy(button: TabButton): void {
    (button as unknown as { destructor(): void }).destructor();
}

describe('TabButton — close-button style-rule disposal', () => {
    it('destructor() on a closeable tab leaves no trace of its close button', () => {
        installTestDOM(CONFIG);

        // Warm-up pass, mirroring the registry harness: keeps any
        // process-global rule these classes materialise on first use out of
        // the diff below.
        {
            const warmup = new TabButton('Warmup', { closeable: true });

            warmup.getElement(true);
            destroy(warmup);
        }

        const before = new Set(_ruleCacheKeys());

        const button = new TabButton('A', { closeable: true });

        button.getElement(true);

        const closeButtonId = button.getCloseButton()!.getId();

        // The close button really materialised a rule — otherwise the
        // assertion below would pass against a button that never rendered
        // one. Button eagerly allocates its :hover/:active state rules at
        // render time, so no interaction is needed first.
        expect(_ruleCacheKeys().some((key) => key.includes(closeButtonId))).toBe(true);

        destroy(button);

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked.some((key) => key.includes(closeButtonId))).toBe(false);
    });

    it('destructor() on a non-closeable tab is unaffected (no close button to dispose)', () => {
        installTestDOM(CONFIG);

        const button = new TabButton('A');

        button.getElement(true);

        expect(button.getCloseButton()).toBeNull();

        // The new `_closeButton?.dispose()` call is a no-op here; this must
        // not throw.
        expect(() => destroy(button)).not.toThrow();
    });
});
