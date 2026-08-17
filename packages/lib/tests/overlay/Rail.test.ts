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

// Parses the `scale(s)` suffix of a genie transform string.
function parseScale(transform: string): number {
    const match = transform.match(/scale\(([-\d.]+)\)/);
    if (!match) {
        throw new Error(`transform did not match scale(...): ${transform}`);
    }

    return Number(match[1]);
}

// Asserts the shrunken window ends centred along its handle's length: the
// window's scaled main-axis centre must coincide with the handle's main-axis
// centre. Derived from the contract ("centre the window on the handle's
// length"), reading only the parsed transform, the window's live rect, and the
// measured handle geometry — never the implementation's own offset formula.
// Main axis is Y for a vertical (WEST/EAST) rail, X for a horizontal one. The
// rect is read live via getRect(), which is the same rect the transform is
// built from (a minimized window's rect is not the pre-minimize one).
function expectCenteredAlongHandle(rail: Rail, win: Window): void {
    const edge     = rail.getEdge();
    const vertical = edge === Placement.EAST || edge === Placement.WEST;

    const rect          = win.getRect();
    const transform     = genieTransform(win);
    const { tx, ty }    = parseTranslate(transform);
    const scale         = parseScale(transform);
    const mainPos       = vertical ? rect.y : rect.x;
    const mainSize      = vertical ? rect.height : rect.width;
    const mainTranslate = vertical ? ty : tx;

    const windowCentre = mainPos + mainTranslate + (mainSize * scale) / 2;
    const handleCentre = rail.handleMainAxisOffset(win) + rail.handleMainAxisExtent(win) / 2;

    expect(windowCentre).toBeCloseTo(handleCentre);
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
    it('single handle: the window is centred on the handle, not pinned to its corner', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.WEST });
        rail.mount();

        const rect = { x: 10, y: 20, width: 200, height: 150 };
        const win  = new Window('A');
        win.applyRect(rect);
        minimizeIntoRail(win, rail);
        rail.flushLayout();

        // The lone handle sits at offset 0, but the window centres on its length
        // rather than pinning its top-left corner there.
        expect(rail.handleMainAxisOffset(win)).toBe(0);
        expect(rail.handleMainAxisExtent(win)).toBeGreaterThan(0);

        // Cross axis (WEST → X) is untouched: corner still lands on the edge.
        const { tx } = parseTranslate(genieTransform(win));
        expect(tx).toBe(0 - 10);
        // Main axis (Y) is centred on the handle's length.
        expectCenteredAlongHandle(rail, win);
    });

    it('the Nth handle centres on its own laid-out slot, not slot 0 (handle-exists path)', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.WEST });
        rail.mount();

        const rect = { x: 10, y: 20, width: 200, height: 150 };
        const windows = [0, 1, 2].map(i => {
            const w = new Window(`W${i}`);
            w.applyRect(rect);
            return w;
        });

        for (const w of windows) {
            minimizeIntoRail(w, rail);
        }
        rail.flushLayout();

        const third = windows[2];

        expect(rail.handleMainAxisOffset(third)).toBeGreaterThan(0);
        expectCenteredAlongHandle(rail, third);
    });

    it('folds a handle-in-flight translate into the reported offset (handle-exists path)', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.WEST });
        rail.mount();

        const rect = { x: 10, y: 20, width: 200, height: 150 };
        const windows = [0, 1, 2].map(i => {
            const w = new Window(`W${i}`);
            w.applyRect(rect);
            return w;
        });

        for (const w of windows) {
            minimizeIntoRail(w, rail);
        }
        rail.flushLayout();

        const third  = windows[2];
        const before = rail.handleMainAxisOffset(third);

        // Simulate the third handle sitting mid-`LayoutManager.commitBounds`
        // size-stable position fast path — e.g. a sibling handle's removal
        // compacting the remaining ones into new slots without resizing
        // them — leaving `getY()` (WEST is a vertical rail) at the pre-move
        // value while the move rides on `getTranslateY()`.
        const registration = (rail as unknown as {
            _windows: Map<Window, { handle: { setTranslate(x: number, y: number): void } | null }>;
        })._windows.get(third)!;
        const dy = 37;
        registration.handle!.setTranslate(0, dy);

        expect(rail.handleMainAxisOffset(third)).toBe(before + dy);
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

        const rect = { x: 900, y: 20, width: 200, height: 150 };
        const windows = [0, 1].map(i => {
            const w = new Window(`W${i}`);
            w.applyRect(rect);
            return w;
        });

        for (const w of windows) {
            minimizeIntoRail(w, rail);
        }
        rail.flushLayout();

        const second = windows[1];
        expect(rail.handleMainAxisOffset(second)).toBeGreaterThan(0);

        // Cross axis (EAST → X) is the rail edge, untouched by centring.
        const { tx } = parseTranslate(genieTransform(second));
        expect(tx).toBe((CONFIG.viewport.width - rail.getThickness()) - 900);
        // Main axis (Y) is centred on the handle's length.
        expectCenteredAlongHandle(rail, second);
    });

    it('SOUTH moves the main-axis target along X', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.SOUTH });
        rail.mount();

        const rect = { x: 10, y: 500, width: 200, height: 150 };
        const windows = [0, 1].map(i => {
            const w = new Window(`W${i}`);
            w.applyRect(rect);
            return w;
        });

        for (const w of windows) {
            minimizeIntoRail(w, rail);
        }
        rail.flushLayout();

        const second = windows[1];
        expect(rail.handleMainAxisOffset(second)).toBeGreaterThan(0);

        // Cross axis (SOUTH → Y) is the rail edge, untouched by centring.
        const { ty } = parseTranslate(genieTransform(second));
        expect(ty).toBe((CONFIG.viewport.height - rail.getThickness()) - 500);
        // Main axis (X) is centred on the handle's length.
        expectCenteredAlongHandle(rail, second);
    });

    it('NORTH moves the main-axis target along X, with a 0 cross-axis target', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.NORTH });
        rail.mount();

        const rect = { x: 10, y: 20, width: 200, height: 150 };
        const windows = [0, 1].map(i => {
            const w = new Window(`W${i}`);
            w.applyRect(rect);
            return w;
        });

        for (const w of windows) {
            minimizeIntoRail(w, rail);
        }
        rail.flushLayout();

        const second = windows[1];
        expect(rail.handleMainAxisOffset(second)).toBeGreaterThan(0);

        // Cross axis (NORTH → Y) is the top edge (0), untouched by centring.
        const { ty } = parseTranslate(genieTransform(second));
        expect(ty).toBe(0 - 20);
        // Main axis (X) is centred on the handle's length.
        expectCenteredAlongHandle(rail, second);
    });

    it('an empty rail returns offset 0 for an unregistered window', () => {
        installTestDOM(CONFIG);
        const rail = new Rail({ edge: Placement.WEST });
        rail.mount();

        const win = new Window('Unregistered');

        expect(() => rail.handleMainAxisOffset(win)).not.toThrow();
        expect(rail.handleMainAxisOffset(win)).toBe(0);
        // No handle to sample, so there is no length to centre against.
        expect(rail.handleMainAxisExtent(win)).toBe(0);
    });
});
