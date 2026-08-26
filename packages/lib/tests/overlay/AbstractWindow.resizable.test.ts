// Covers the `resizable` window option: it defaults to true, reaches both
// concrete window subclasses, toggles the eight border strips' visibility
// (tri-state `null`/`false`, never `true` — see the plan's `visible-null`
// note), and gates the `onResize` drag entry point. Construction and the
// gated call stay JS-only, so all eight rows are exercised offline under the
// recording sink; cursor rendering, hit testing, and a live drag need a real
// browser and are covered by the plan's manual pass instead.
import { describe, it, expect, afterEach } from 'vitest';
import { Window } from '~/overlay/Window';
import { TabWindow } from '~/overlay/TabWindow';
import { WindowBorder, Direction } from '~/component/container/WindowBorder';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** White-box access to the eight private border strips. */
function borders(win: Window | TabWindow): Record<string, { isVisible(): boolean | null }> {
    return (win as unknown as { _borderComponents: Record<string, { isVisible(): boolean | null }> })._borderComponents;
}

/** Ends a resize session started by `onResize`, so its viewport listeners don't outlive the test. */
function endResize(win: Window): void {
    (win as unknown as { onResizeEnd(): void }).onResizeEnd();
}

describe('AbstractWindow resizable option', () => {
    afterEach(() => DOM.reset());

    it('defaults to true', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        expect(win.isResizable()).toBe(true);
    });

    it('reaches Window via the constructor option', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });

        expect(win.isResizable()).toBe(false);
    });

    it('reaches TabWindow via the constructor option', () => {
        installTestDOM(CONFIG);

        const win = new TabWindow({ resizable: false });

        expect(win.isResizable()).toBe(false);
    });

    it('leaves every border strip inheriting visibility by default', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        for (const border of Object.values(borders(win))) {
            expect(border.isVisible()).toBeNull();
        }
    });

    it('hides every border strip when constructed non-resizable', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });

        for (const border of Object.values(borders(win))) {
            expect(border.isVisible()).toBe(false);
        }
    });

    it('restores every border strip to inherited visibility on re-enable', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        win.setResizable(false);
        win.setResizable(true);

        for (const border of Object.values(borders(win))) {
            expect(border.isVisible()).toBeNull();
        }
    });

    it('lets onResize through on a resizable window', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        let prevented = false;
        const fakeEvent = { preventDefault: () => { prevented = true; }, clientX: 0, clientY: 0 } as unknown as MouseEvent;

        win.onResize(new WindowBorder(Direction.EAST), fakeEvent);
        endResize(win);

        expect(prevented).toBe(true);
    });

    it('blocks onResize on a non-resizable window', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });
        let prevented = false;
        const fakeEvent = { preventDefault: () => { prevented = true; }, clientX: 0, clientY: 0 } as unknown as MouseEvent;
        const originalWidth = win.getWidth();
        const originalHeight = win.getHeight();

        win.onResize(new WindowBorder(Direction.EAST), fakeEvent);

        expect(prevented).toBe(false);
        expect(win.getWidth()).toBe(originalWidth);
        expect(win.getHeight()).toBe(originalHeight);
    });
});

/** White-box access to TabWindow's trailing control tools. */
function tools(win: TabWindow): { _minTool: { isVisible(): boolean | null }, _maxTool: { isVisible(): boolean | null } } {
    return win as unknown as { _minTool: { isVisible(): boolean | null }, _maxTool: { isVisible(): boolean | null } };
}

describe('resizable supersedes minimizable/maximizable', () => {
    afterEach(() => DOM.reset());

    it('leaves both affordances enabled by default', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        expect(win.isMinimizable()).toBe(true);
        expect(win.isMaximizable()).toBe(true);
    });

    it('disables both affordances when constructed non-resizable', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });

        expect(win.isMinimizable()).toBe(false);
        expect(win.isMaximizable()).toBe(false);
    });

    it('hides both header buttons when constructed non-resizable', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });

        expect(win.getHeader().isMinimizable()).toBe(false);
        expect(win.getHeader().isMaximizable()).toBe(false);
    });

    it('hides both TabWindow tools when constructed non-resizable', () => {
        installTestDOM(CONFIG);

        const win = new TabWindow({ resizable: false });

        expect(win.isMinimizable()).toBe(false);
        expect(win.isMaximizable()).toBe(false);
        expect(tools(win)._minTool.isVisible()).toBe(false);
        expect(tools(win)._maxTool.isVisible()).toBe(false);
    });

    it('restores both affordances when resizable is re-enabled', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });

        win.setResizable(true);

        expect(win.isMinimizable()).toBe(true);
        expect(win.isMaximizable()).toBe(true);
        expect(win.getHeader().isMinimizable()).toBe(true);
        expect(win.getHeader().isMaximizable()).toBe(true);
    });

    it('remembers the caller\'s own minimizable setting through a resizable round-trip', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false, minimizable: false });

        win.setResizable(true);

        expect(win.isMinimizable()).toBe(false);
        expect(win.isMaximizable()).toBe(true);
    });

    it('re-reflects both affordances on a resizable-false-then-true round-trip', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        win.setResizable(false);
        win.setResizable(true);

        expect(win.isMinimizable()).toBe(true);
        expect(win.isMaximizable()).toBe(true);
        expect(win.getHeader().isMinimizable()).toBe(true);
        expect(win.getHeader().isMaximizable()).toBe(true);
    });

    it('blocks toggleMinimize on a non-resizable window', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });

        win.toggleMinimize();

        expect(win.getWindowState()).toBe('normal');
    });

    it('blocks toggleMaximize on a non-resizable window', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });

        win.toggleMaximize();

        expect(win.getWindowState()).toBe('normal');
    });

    it('leaves the programmatic minimize() path open on a non-resizable window', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });

        win.minimize();

        expect(win.getWindowState()).toBe('minimized');
    });

    it('does not let setMinimizable(true) alone re-enable the affordance', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });

        win.setMinimizable(true);

        expect(win.isMinimizable()).toBe(false);
        expect(win.getHeader().isMinimizable()).toBe(false);

        win.setResizable(true);

        expect(win.isMinimizable()).toBe(true);
        expect(win.getHeader().isMinimizable()).toBe(true);
    });
});
