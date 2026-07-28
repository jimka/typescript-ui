// Regression: DropZoneOverlay.attachTo raw-appends the overlay itself onto the
// dock region's element, and its own nested highlight rect onto the overlay's
// element — both via `getElement(true)` assigned to a variable with the
// `appendChild` call on a later line, the same split-statement shape that
// this plan's Rail addendum found and fixed. DockRegion (a plain coordinator,
// not a Component — see DockRegion.ts) owns the overlay and is the only place
// that can tear it down; its `destroy()` called `overlay.detach()`, which only
// removes the element, never the overlay's own or its highlight's stylesheet
// rule. See plans/implemented/scrollbar-leak-and-layout-guards.md (Bug 1).
import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DockRegion } from '~/layout/DockRegion';
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

/** A DockRegion driven through one attach/highlight cycle, as a live drag-over would. */
function drivenDockRegion(): { region: Component; dockRegion: DockRegion } {
    const region = new Component({ preferredSize: { width: 200, height: 150 } });
    const dockRegion = new DockRegion(region);

    const overlay = (dockRegion as unknown as { _overlay: { attachTo(r: Component): void; setHighlight(zone: string): void } })._overlay;

    overlay.attachTo(region);
    overlay.setHighlight('center');

    return { region, dockRegion };
}

/** Calls the protected destructor, as an owning window does when it closes. */
function destroy(component: Component): void {
    (component as unknown as { destructor(): void }).destructor();
}

describe('DockRegion — drop-zone overlay style-rule disposal', () => {
    it('leaves no per-instance rule behind after destroy()', () => {
        installTestDOM(CONFIG);

        // Warm-up pass: keeps any process-global rule a class materialises on
        // first use out of the diff below. The underlying region component is
        // disposed too — DockRegion.destroy() only owns the overlay's
        // lifecycle, not the region's, so the region's own rule must be
        // reclaimed the same way a real caller tearing down both would.
        const warm = drivenDockRegion();
        warm.dockRegion.destroy();
        destroy(warm.region);

        const before = new Set(_ruleCacheKeys());

        const { region, dockRegion } = drivenDockRegion();

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        dockRegion.destroy();
        destroy(region);

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });
});
