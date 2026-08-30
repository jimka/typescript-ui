// Covers the `locked` window option: it defaults to false, reaches both
// concrete window subclasses, hides the eight resize-border strips and vetoes
// both drag-to-move and drag-to-resize while set, and disables every
// user-facing maximize control (the header/tool button and the header/bar
// double-click) while leaving minimize and close untouched — `locked` is a
// separate gate from `resizable`, not routed through it (see the plan's
// Architecture Decisions). Construction and the gated calls stay JS-only, so
// all of this is exercised offline under the recording sink. See plan's
// Expected Behaviour cases 20-24.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { TabWindow } from '~/overlay/TabWindow';
import { WindowBorder, Direction } from '~/component/container/WindowBorder';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** White-box access to the eight private border strips — copied from AbstractWindow.resizable.test.ts. */
function borders(win: Window | TabWindow): Record<string, { isVisible(): boolean | null }> {
    return (win as unknown as { _borderComponents: Record<string, { isVisible(): boolean | null }> })._borderComponents;
}

/** Ends a resize session started by `onResize`, so its viewport listeners don't outlive the test. */
function endResize(win: Window): void {
    (win as unknown as { onResizeEnd(): void }).onResizeEnd();
}

/** White-box access to a TabWindow's private maximize tool button. */
function maxTool(win: TabWindow): { isEnabled(): boolean } {
    return (win as unknown as { _maxTool: { isEnabled(): boolean } })._maxTool;
}

describe('AbstractWindow locked option', () => {
    afterEach(() => DOM.reset());

    it('defaults to false', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        expect(win.isLocked()).toBe(false);
    });

    it('reaches Window via the constructor option', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { locked: true });

        expect(win.isLocked()).toBe(true);
    });

    it('reaches TabWindow via the constructor option', () => {
        installTestDOM(CONFIG);

        const win = new TabWindow({ locked: true });

        expect(win.isLocked()).toBe(true);
    });

    it('setLocked(true) hides all eight border strips; setLocked(false) restores them to inherit', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        win.setLocked(true);
        for (const border of Object.values(borders(win))) {
            expect(border.isVisible()).toBe(false);
        }

        win.setLocked(false);
        for (const border of Object.values(borders(win))) {
            expect(border.isVisible()).toBeNull();
        }
    });

    it('leaves a non-resizable window\'s strips hidden through a lock/unlock round-trip', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });

        win.setLocked(true);
        for (const border of Object.values(borders(win))) {
            expect(border.isVisible()).toBe(false);
        }

        win.setLocked(false);
        for (const border of Object.values(borders(win))) {
            expect(border.isVisible()).toBe(false);
        }
    });

    it('onResize makes no geometry change on a locked window', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { locked: true });
        let prevented = false;
        const fakeEvent = { preventDefault: () => { prevented = true; }, clientX: 0, clientY: 0 } as unknown as MouseEvent;
        const originalWidth  = win.getWidth();
        const originalHeight = win.getHeight();

        win.onResize(new WindowBorder(Direction.EAST), fakeEvent);
        endResize(win);

        expect(prevented).toBe(false);
        expect(win.getWidth()).toBe(originalWidth);
        expect(win.getHeight()).toBe(originalHeight);
    });

    it('startMoveFrom registers no viewport listeners on a locked window', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { locked: true });
        const fakeEvent = { clientX: 10, clientY: 10, button: 0, shiftKey: false } as unknown as MouseEvent;

        win.startMoveFrom(fakeEvent);

        // `getX()`/`getY()` are the wrong discriminator here: `onDrag` only
        // ever writes a compositor `translate` (committed into x/y on
        // mouseup), so position never changes synchronously inside
        // `startMoveFrom` regardless of whether it registered anything —
        // that assertion would pass even with the lock veto removed. A real
        // viewport `mousemove`, dispatched the way the mouse actually would,
        // is the same discriminator AbstractWindow.dragWillChangeOnMove.test.ts
        // uses: it reaches `onDrag` (which promotes a compositor layer) only
        // if `startMoveFrom` actually registered the listener.
        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(0 as Handle, 'mousemove', { clientX: 50, clientY: 50 }));

        expect(win.getWillChange()).toBeNull();
    });

    it('does not change isMinimizable / isMaximizable / isCloseable', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        win.setLocked(true);

        expect(win.isMinimizable()).toBe(true);
        expect(win.isMaximizable()).toBe(true);
        expect(win.isCloseable()).toBe(true);
    });

    it('setLocked(true) disables (not hides) the Window header maximize button; setLocked(false) re-enables it', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.getElement(true);

        win.setLocked(true);
        expect(win.getHeader().isMaximizeButtonEnabled()).toBe(false);
        expect(win.getHeader().isMaximizable()).toBe(true); // still shown — only disabled

        win.setLocked(false);
        expect(win.getHeader().isMaximizeButtonEnabled()).toBe(true);
    });

    it('setLocked(true) disables the TabWindow maximize tool; setLocked(false) re-enables it', () => {
        installTestDOM(CONFIG);

        const win = new TabWindow();
        win.getElement(true);

        win.setLocked(true);
        expect(maxTool(win).isEnabled()).toBe(false);

        win.setLocked(false);
        expect(maxTool(win).isEnabled()).toBe(true);
    });

    it('a locked, maximizable window does not toggle maximize on a header double-click; an unlocked one does', () => {
        installTestDOM(CONFIG);

        const locked = new Window('W');
        locked.getElement(true);
        locked.setLocked(true);

        (locked as unknown as { onHeaderDoubleClick(e: MouseEvent): void })
            .onHeaderDoubleClick(makeEvent(locked.getHeader().getElement()!, 'dblclick') as unknown as MouseEvent);
        expect(locked.getWindowState()).toBe('normal');

        const unlocked = new Window('W2');
        unlocked.getElement(true);

        (unlocked as unknown as { onHeaderDoubleClick(e: MouseEvent): void })
            .onHeaderDoubleClick(makeEvent(unlocked.getHeader().getElement()!, 'dblclick') as unknown as MouseEvent);
        expect(unlocked.getWindowState()).toBe('maximized');
    });

    it('a locked, maximizable TabWindow does not toggle maximize on a bar double-click; an unlocked one does', () => {
        installTestDOM(CONFIG);

        const locked = new TabWindow();
        locked.getElement(true);
        locked.setLocked(true);

        (locked as unknown as { onBarDoubleClick(): void }).onBarDoubleClick();
        expect(locked.getWindowState()).toBe('normal');

        const unlocked = new TabWindow();
        unlocked.getElement(true);

        (unlocked as unknown as { onBarDoubleClick(): void }).onBarDoubleClick();
        expect(unlocked.getWindowState()).toBe('maximized');
    });

    it('locking an already-maximized window disables restore too — the gate is on the action, not the label', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.getElement(true);
        win.setWindowState('maximized');

        win.setLocked(true);

        expect(win.getHeader().isMaximizeButtonEnabled()).toBe(false);
    });

    it("a resizable:false window's maximize button stays disabled through a lock/unlock round-trip", () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { resizable: false });
        win.getElement(true);

        // Not maximizable at all, so canMaximize() is already false.
        expect(win.getHeader().isMaximizeButtonEnabled()).toBe(false);

        win.setLocked(true);
        expect(win.getHeader().isMaximizeButtonEnabled()).toBe(false);

        win.setLocked(false);
        expect(win.getHeader().isMaximizeButtonEnabled()).toBe(false);
    });

    // Mirrors Window.headerMoveTrigger.test.ts's identical case for the header
    // double-click — TabWindow's onBarDoubleClick makes the same replacement.
    it('restores AND activates a minimized TabWindow via bar double-click', () => {
        installTestDOM(CONFIG);

        const win = new TabWindow();
        win.getElement(true);
        win.minimize();
        expect(win.getWindowState()).toBe('minimized');

        const bringToFrontSpy = vi.spyOn(win, 'bringToFront');
        const focusSpy = vi.spyOn(win, 'focus');

        (win as unknown as { onBarDoubleClick(): void }).onBarDoubleClick();

        expect(win.getWindowState()).toBe('normal');
        expect(bringToFrontSpy).toHaveBeenCalledOnce();
        expect(focusSpy).toHaveBeenCalledWith(true);
    });

    it('minimize stays available on a locked window: toggleMinimize still changes its state', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.getElement(true);

        win.setLocked(true);
        win.toggleMinimize();

        expect(win.getWindowState()).toBe('minimized');
    });
});
