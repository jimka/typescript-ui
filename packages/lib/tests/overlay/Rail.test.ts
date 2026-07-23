import { describe, it, expect, afterEach } from 'vitest';
import { Rail } from '~/overlay/Rail';
import { Drawer } from '~/overlay/Drawer';
import { Window } from '~/overlay/Window';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// Rail's substance (edge geometry, collapse animation, minimize-genie window
// geometry) reads true only under a real mount and is deferred to manual-verify
// (see the plan's Non-Goals). This suite pins only the pre-mount STATE contract,
// where the collapse animation path is guarded off by `_mounted === false` —
// EXCEPT for the `handleMainAxisOffset` / `railGenieTransform` cases below,
// which mount the rail and drive it through a real layout pass: the computed
// transform is pure geometry, and is offline-testable that way (see
// plans/implemented/rail-genie-handle-target.md).
const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

describe('Rail — edge', () => {
    it('defaults to WEST and round-trips via setter and constructor', () => {
        installTestDOM(CONFIG);
        expect(new Rail().getEdge()).toBe(Placement.WEST);
        expect(new Rail().setEdge(Placement.EAST).getEdge()).toBe(Placement.EAST);
        expect(new Rail({ edge: Placement.SOUTH }).getEdge()).toBe(Placement.SOUTH);
    });
});

describe('Rail — thickness', () => {
    it('round-trips an explicit thickness via setter and constructor (while expanded)', () => {
        installTestDOM(CONFIG);
        const rail = new Rail();
        rail.setThickness(64);
        expect(rail.getThickness()).toBe(64);
        expect(new Rail({ thickness: 40 }).getThickness()).toBe(40);
    });
});

describe('Rail — orientation', () => {
    it('defaults to horizontal and round-trips via setter and constructor', () => {
        installTestDOM(CONFIG);
        expect(new Rail().getOrientation()).toBe('horizontal');
        expect(new Rail().setOrientation('vertical-cw').getOrientation()).toBe('vertical-cw');
        expect(new Rail({ orientation: 'vertical-ccw' }).getOrientation()).toBe('vertical-ccw');
    });
});

describe('Rail — collapse state', () => {
    it('defaults isCollapsed to false', () => {
        installTestDOM(CONFIG);
        expect(new Rail().isCollapsed()).toBe(false);
    });

    it('setCollapsed(true) collapses; toggleCollapsed flips back and forth', () => {
        installTestDOM(CONFIG);
        const rail = new Rail();
        rail.setCollapsed(true);
        expect(rail.isCollapsed()).toBe(true);
        rail.toggleCollapsed();
        expect(rail.isCollapsed()).toBe(false);
        rail.toggleCollapsed();
        expect(rail.isCollapsed()).toBe(true);
    });

    it('setCollapsed to the current state is a no-op (no throw, state unchanged)', () => {
        installTestDOM(CONFIG);
        const rail = new Rail();
        expect(() => rail.setCollapsed(false)).not.toThrow(); // already expanded
        expect(rail.isCollapsed()).toBe(false);
    });
});

describe('Rail — registration bookkeeping', () => {
    it('registerDrawer is chainable and idempotent for the same drawer', () => {
        installTestDOM(CONFIG);
        const rail = new Rail();
        const drawer = new Drawer();
        expect(rail.registerDrawer(drawer)).toBe(rail);
        expect(() => rail.registerDrawer(drawer)).not.toThrow(); // second call is a no-op
    });

    it('registerWindow is chainable and does not throw for a minimal window', () => {
        installTestDOM(CONFIG);
        const rail = new Rail();
        const window = new Window('Test');
        expect(rail.registerWindow(window)).toBe(rail);
    });
});

// Reads the private `railGenieTransform()` by cast — the transform string is
// pure geometry (see the plan's Expected Behaviour), so it is offline-testable
// without ever playing the animation it feeds.
type WindowWithGenieTransform = { railGenieTransform(): string };

function genieTransform(window: Window): string {
    return (window as unknown as WindowWithGenieTransform).railGenieTransform();
}

// Parses the `translate(txpx, typx)` prefix of a genie transform string.
function parseTranslate(transform: string): { tx: number; ty: number } {
    const match = transform.match(/^translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    if (!match) {
        throw new Error(`transform did not match translate(...): ${transform}`);
    }

    return { tx: Number(match[1]), ty: Number(match[2]) };
}

// Seeds a window's rail handle synchronously, with no genie playback: minimize
// while the window has no rail yet (takes the built-in dock path, whose tween
// never advances because the test DOM swallows requestAnimationFrame — see
// TestDOM.requestAnimationFrame), then attach the rail. `registerWindow` sees
// an already-minimized window and creates its handle immediately (see the
// plan's `[^sync-handles]`).
function minimizeIntoRail(window: Window, rail: Rail): void {
    window.minimize();
    window.setRail(rail);
}

describe('Rail — handleMainAxisOffset / railGenieTransform', () => {
    it('single handle targets the corner (offset 0)', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.WEST });
        rail.mount();

        const win = new Window('A');
        win.applyRect({ x: 10, y: 20, width: 200, height: 150 });
        minimizeIntoRail(win, rail);
        rail.flushLayout();

        expect(rail.handleMainAxisOffset(win)).toBe(0);

        const { tx, ty } = parseTranslate(genieTransform(win));
        expect(tx).toBe(0 - 10);
        expect(ty).toBe(0 - 20);
    });

    it('the Nth handle targets its own laid-out offset, not 0 (handle-exists path)', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.WEST });
        rail.mount();

        const windows = [0, 1, 2].map(i => {
            const w = new Window(`W${i}`);
            w.applyRect({ x: 10, y: 20, width: 200, height: 150 });
            return w;
        });

        for (const w of windows) {
            minimizeIntoRail(w, rail);
        }
        rail.flushLayout();

        const third = windows[2];
        const offset = rail.handleMainAxisOffset(third);

        expect(offset).toBeGreaterThan(0);

        const { ty } = parseTranslate(genieTransform(third));
        expect(ty).toBe(offset - 20);
    });

    it('the collapse path predicts the slot where the next handle actually lands', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.WEST });
        rail.mount();

        const first  = new Window('First');
        const second = new Window('Second');

        first.applyRect({ x: 10, y: 20, width: 200, height: 150 });
        second.applyRect({ x: 10, y: 20, width: 200, height: 150 });
        minimizeIntoRail(first, rail);
        minimizeIntoRail(second, rail);
        rail.flushLayout();

        // Registered, but never minimized — no handle exists yet, so the offset
        // comes from the predict branch (the append slot), not a live handle.
        const pending = new Window('Pending');
        pending.setRail(rail);
        const predicted = rail.handleMainAxisOffset(pending);

        expect(predicted).toBeGreaterThan(0);

        // The stronger check: the prediction must equal where the next handle
        // genuinely lands. Minimize a fresh window (its handle is created
        // synchronously) and read the laid-out position off that real handle.
        const next = new Window('Next');
        next.applyRect({ x: 10, y: 20, width: 200, height: 150 });
        minimizeIntoRail(next, rail);
        rail.flushLayout();

        const handles = rail.getComponents();
        const landed  = handles[handles.length - 1];

        expect(landed.getY()).toBe(predicted);
    });

    it('EAST keeps the cross-axis target and gains the main-axis target', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.EAST });
        rail.mount();

        const windows = [0, 1].map(i => {
            const w = new Window(`W${i}`);
            w.applyRect({ x: 900, y: 20, width: 200, height: 150 });
            return w;
        });

        for (const w of windows) {
            minimizeIntoRail(w, rail);
        }
        rail.flushLayout();

        const second = windows[1];
        const offset = rail.handleMainAxisOffset(second);
        expect(offset).toBeGreaterThan(0);

        const { tx, ty } = parseTranslate(genieTransform(second));
        expect(tx).toBe((CONFIG.viewport.width - rail.getThickness()) - 900);
        expect(ty).toBe(offset - 20);
    });

    it('SOUTH moves the main-axis target along X', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.SOUTH });
        rail.mount();

        const windows = [0, 1].map(i => {
            const w = new Window(`W${i}`);
            w.applyRect({ x: 10, y: 500, width: 200, height: 150 });
            return w;
        });

        for (const w of windows) {
            minimizeIntoRail(w, rail);
        }
        rail.flushLayout();

        const second = windows[1];
        const offset = rail.handleMainAxisOffset(second);
        expect(offset).toBeGreaterThan(0);

        const { tx, ty } = parseTranslate(genieTransform(second));
        expect(tx).toBe(offset - 10);
        expect(ty).toBe((CONFIG.viewport.height - rail.getThickness()) - 500);
    });

    it('NORTH moves the main-axis target along X, with a 0 cross-axis target', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.NORTH });
        rail.mount();

        const windows = [0, 1].map(i => {
            const w = new Window(`W${i}`);
            w.applyRect({ x: 10, y: 20, width: 200, height: 150 });
            return w;
        });

        for (const w of windows) {
            minimizeIntoRail(w, rail);
        }
        rail.flushLayout();

        const second = windows[1];
        const offset = rail.handleMainAxisOffset(second);
        expect(offset).toBeGreaterThan(0);

        const { tx, ty } = parseTranslate(genieTransform(second));
        expect(tx).toBe(offset - 10);
        expect(ty).toBe(0 - 20);
    });

    it('an empty rail returns offset 0 for an unregistered window', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.WEST });
        rail.mount();

        const win = new Window('Unregistered');

        expect(() => rail.handleMainAxisOffset(win)).not.toThrow();
        expect(rail.handleMainAxisOffset(win)).toBe(0);
    });
});
