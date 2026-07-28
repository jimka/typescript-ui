// Regression: Rail.mount() raw-appends its collapse chevron (`_collapseButton`)
// straight onto the rail's element instead of registering it via
// `addComponent` (see the comment at Rail.ts's `mount()`, "outside the handle
// layout"), so `Component.destructor()`'s child recursion — which walks
// `_components` — never reaches it and its per-instance stylesheet rule is
// never deleted. The same raw-appended-CollapseButton shape
// plans/implemented/scrollbar-leak-and-layout-guards.md fixed for
// `SplitGutter`, found here in the one owner its sweep missed (the append at
// Rail.ts's `mount()` splits `getElement(true)` and `appendChild` across two
// statements, which the sweep's single-line grep did not match).
import { describe, it, expect, afterEach } from 'vitest';
import { Rail } from '~/overlay/Rail';
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

afterEach(() => DOM.reset());

/** Calls the protected destructor, as an owning window does when it closes. */
function destroy(rail: Rail): void {
    (rail as unknown as { destructor(): void }).destructor();
}

/** A mounted Rail, whose collapse chevron is materialised by `mount()`. */
function mountedRail(): Rail {
    const rail = new Rail();

    rail.mount();

    return rail;
}

describe('Rail — collapse chevron style-rule disposal', () => {
    it('leaves no per-instance rule behind after a mounted rail is destroyed', () => {
        installTestDOM(CONFIG);

        // Warm-up pass: keeps any process-global rule a class materialises on
        // first use out of the diff below.
        destroy(mountedRail());

        const before = new Set(_ruleCacheKeys());

        const rail = mountedRail();

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        destroy(rail);

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });
});
