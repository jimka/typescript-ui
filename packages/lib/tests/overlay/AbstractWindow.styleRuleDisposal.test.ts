// Regression: a window's eight resize-border strips are appended straight to the
// window element (AbstractWindow.renderContent) instead of being registered as
// child components, so the recursive teardown in Component.destructor — which
// walks `_components` — never reached them. Each strip owns two per-instance
// rules on the shared `Base` sheet (`#uuid` and `#uuid.snap-target`), so every
// open/close cycle leaked 16 rules that were never deleted. Measured live before
// the fix: +19 rules retained per open/close cycle, growing linearly and never
// released, which is what made repeated window churn progressively slower.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Window } from '~/overlay/Window';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Calls the protected destructor, as the layer manager does when a window closes. */
function destroy(win: Window): void {
    (win as unknown as { destructor(): void }).destructor();
}

describe('AbstractWindow — style-rule disposal on teardown', () => {

    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => DOM.reset());

    it('leaves no per-instance rule behind after a rendered window is destroyed', () => {
        const before = new Set(_ruleCacheKeys());

        const win = new Window('W');
        win.getElement(true);   // render -> materialises the window's and the borders' rules

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        destroy(win);

        // The contract is total: a closed window must not retain a single rule
        // on the shared sheet, or the sheet grows without bound across churn.
        // The one documented exception is the framework-wide rule
        // (plans/implemented/class-scoped-style-rules.md) — permanent,
        // module-scoped state created once per process and never disposed.
        const leaked = _ruleCacheKeys().filter((key) => !before.has(key) && key !== ':where(.ts-ui-component)');

        expect(leaked).toEqual([]);
    });

    it('deletes both rules each resize border owns, not just its base rule', () => {
        const before = new Set(_ruleCacheKeys());

        const win = new Window('W');
        win.getElement(true);

        // Each strip carries a `#uuid.snap-target` companion rule for the drag
        // highlight; a teardown that disposed only `#uuid` would leave these.
        // Counted relative to `before`: the StyleTarget rule cache is module
        // state that outlives DOM.reset(), so anything an earlier test left
        // behind is still visible here.
        const snapTargets = _ruleCacheKeys()
            .filter((key) => key.endsWith('.snap-target') && !before.has(key));

        expect(snapTargets.length).toBe(8);

        destroy(win);

        const leakedSnapTargets = _ruleCacheKeys()
            .filter((key) => key.endsWith('.snap-target') && !before.has(key));

        expect(leakedSnapTargets).toEqual([]);
    });
});
