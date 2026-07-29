// Regression: `Dock` holds an empty-state `DropZoneOverlay` in a private field
// (Dock.ts:255) and mounts it with `attachTo` (Dock.ts:406), which raw-appends
// the overlay onto the dock's element and the overlay's nested highlight rect
// onto its own — the same split-statement shape as the DockRegion case. The
// overlay was only ever `detach()`ed (Dock.ts:412, 415), which removes the
// element but leaves both components' per-instance rules on the shared sheet,
// and `Dock` declared no `destructor()` at all, so nothing reclaimed them when
// the dock itself went away.
//
// This is the same class and the same method as the DockRegion fix on this
// branch, one owner over — see tests/layout/DockRegion.styleRuleDisposal.test.ts.
// It is exercised by the empty-dock drag path, which is what builds the overlay.
// See plans/implemented/scrollbar-leak-and-layout-guards.md (Bug 1).
import { describe, it, expect, afterEach } from 'vitest';
import { _Dock } from '~/overlay/Dock';
import { Component } from '~/core/Component';
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
function destroy(dock: _Dock): void {
    (dock as unknown as { destructor(): void }).destructor();
}

/**
 * A `Dock` driven through one empty-state drag-over cycle — `attachTo` plus
 * `highlightFull` is what materialises the overlay and its highlight rect,
 * exactly as `Dock`'s own drop-target callbacks do.
 */
function drivenDock(): _Dock {
    const dock = new _Dock({});

    dock.getElement(true);
    dock.setWidth(400);
    dock.setHeight(300);
    dock.doLayout();

    const overlay = (dock as unknown as {
        _emptyDropOverlay: { attachTo(d: _Dock): void; highlightFull(): void };
    })._emptyDropOverlay;

    overlay.attachTo(dock);
    overlay.highlightFull();

    return dock;
}

describe('Dock — empty-state drop overlay style-rule disposal', () => {
    it('B1-11: leaves no per-instance rule behind after a driven dock is destroyed', () => {
        installTestDOM(CONFIG);

        // Warm-up pass: keeps any process-global rule these classes materialise
        // on first use out of the diff below.
        destroy(drivenDock());

        const before = new Set(_ruleCacheKeys());

        const dock = drivenDock();

        // The overlay really was built — otherwise the assertion below would
        // pass against a dock that never mounted one.
        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        destroy(dock);

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });

    it('B1-15: leaves no per-instance rule behind for a wired region that was drag-hovered', () => {
        installTestDOM(CONFIG);

        // A wired region owns its own DockRegion, whose drop-zone overlay is
        // built on first hover. `DockRegion.destroy()` is otherwise reached
        // only by the unreachable-region sweep, so a dock torn down while its
        // regions are still reachable never released them.
        // The region belongs to the caller, not to the dock, so it is built
        // outside the measured window — its own rule is expected to outlive
        // the dock and must not be counted as a leak.
        const region = new Component({ preferredSize: { width: 100, height: 100 } });

        region.getElement(true);

        const build = (): _Dock => {
            const dock = new _Dock({});

            dock.getElement(true);
            dock.setWidth(400);
            dock.setHeight(300);
            dock.doLayout();

            const priv = dock as unknown as {
                wireRegion(r: Component): void;
                _wiring: Map<Component, { dockRegion: { _overlay: { attachTo(r: Component): void; setHighlight(z: string, v: boolean): void } } }>;
            };

            priv.wireRegion(region);

            const overlay = priv._wiring.get(region)!.dockRegion._overlay;

            overlay.attachTo(region);
            overlay.setHighlight('center', true);

            return dock;
        };

        destroy(build()); // warm-up

        const before = new Set(_ruleCacheKeys());
        const dock   = build();

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        destroy(dock);

        expect(_ruleCacheKeys().filter((key) => !before.has(key))).toEqual([]);

        // Disposing the dock's regions must not take the caller's region with
        // them — the same ownership rule the Accordion tool cases pin.
        expect(_ruleCacheKeys().some((key) => key.includes(region.getId()))).toBe(true);
    });
});
