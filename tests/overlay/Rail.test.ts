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
// where the collapse animation path is guarded off by `_mounted === false`.
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
