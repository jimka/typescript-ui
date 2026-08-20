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

        // The contract is total: a closed window must not retain a single
        // per-instance rule on the shared sheet, or the sheet grows without
        // bound across churn. The documented exceptions are the two lower,
        // permanent tiers (plans/implemented/class-scoped-style-rules.md) —
        // the framework-wide `:where(.ts-ui-component)` rule and any
        // `.ClassName` rule (e.g. `.Button`, for its `cursor: pointer`
        // default) — both module-scoped state created once per process and
        // never disposed, unlike the window's and its resize borders' own
        // `#uuid` rules. Per-instance selectors all start with `#`, so
        // filtering to those excludes both permanent tiers at once.
        const leaked = _ruleCacheKeys().filter((key) => !before.has(key) && key.startsWith('#'));

        expect(leaked).toEqual([]);
    });

    // A former second test here ("deletes both rules each resize border owns,
    // not just its base rule") pinned that each strip's `#uuid.snap-target`
    // companion rule, not just its `#uuid` base rule, was disposed. Since
    // plans/implemented/state-tier-rule-dedup-followups.md, `.snap-target`
    // dedupes onto ONE shared `.WindowBorder.snap-target` class rule and no
    // per-instance `.snap-target` rule ever materialises (for any strip, not
    // just a second one) — the leak that test guarded is now structurally
    // impossible, and a rewritten version of it could only ever assert an
    // empty set both before and after `destroy()`, which cannot fail even if
    // disposal were broken. Removed rather than kept as a tautology; the test
    // above already covers the total per-instance-rule-leak contract.
});
