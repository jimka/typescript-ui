//
// What a floating window tells assistive technology: it is a non-modal
// dialog, named by its header text (Window) or by its active tab's label
// (TabWindow), and its title-bar buttons carry names that follow the window
// state. Activation is driven directly through onActivate, as
// AbstractWindow.activate.test.ts does — no live paint or layer manager.
//
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { _TabWindow as TabWindow } from '~/overlay/TabWindow';
import { _Button as Button } from '~/component/button/Button';
import { Component } from '~/core/Component';
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

/** The rendered value of `name` on the component's own element, or null when absent. */
function attribute(component: Component, name: string): string | null {
    return DOM.source.getAttribute(component.getElement(true)!, name);
}

/** The accessible name a title-bar button carries. */
function nameOf(button: Button): string | null {
    return button.getAria().getLabel();
}

/** White-box seam onto a TabWindow's protected window-state hook. */
function reflectState(tabWindow: TabWindow, state: 'normal' | 'minimized' | 'maximized'): void {
    (tabWindow as any).reflectMaximizeState(state);
}

describe('Window — role and name', () => {
    afterEach(() => DOM.reset());

    // W1
    it('a Window and a TabWindow are dialogs without aria-modal', () => {
        installTestDOM(CONFIG);

        const win       = new Window('Local Storage');
        const tabWindow = new TabWindow();

        expect(attribute(win, 'role')).toBe('dialog');
        expect(attribute(win, 'aria-modal')).toBeNull();
        expect(attribute(tabWindow, 'role')).toBe('dialog');
        expect(attribute(tabWindow, 'aria-modal')).toBeNull();

        win.dispose();
        tabWindow.dispose();
    });

    // W2
    it('a Window is named by reference to its header text, across a rename', () => {
        installTestDOM(CONFIG);

        const win      = new Window('Local Storage');
        const headerId = win.getHeader().getText().getId();

        expect(attribute(win, 'aria-labelledby')).toBe(headerId);

        win.setHeaderText('Storage');

        expect(attribute(win, 'aria-labelledby')).toBe(headerId);
        expect(win.getHeader().getText().getText()).toBe('Storage');

        win.dispose();
    });

    it('a Window named by its header text carries no aria-label of its own', () => {
        installTestDOM(CONFIG);

        const win = new Window('Local Storage');

        expect(attribute(win, 'aria-label')).toBeNull();

        win.onActivate(true);

        expect(attribute(win, 'aria-label')).toBeNull();

        win.dispose();
    });

    it('a consumer renames a Window by clearing the reference first', () => {
        installTestDOM(CONFIG);

        const win = new Window('Local Storage');

        win.getAria().clearLabelledBy().setLabel('Storage inspector');

        expect(attribute(win, 'aria-labelledby')).toBeNull();
        expect(attribute(win, 'aria-label')).toBe('Storage inspector');

        win.dispose();
    });
});

describe('Window — header button names', () => {
    afterEach(() => DOM.reset());

    // W3
    it('names the three header buttons', () => {
        installTestDOM(CONFIG);

        const win    = new Window('W');
        const header = win.getHeader();

        expect(nameOf(header.getMinimizeButton())).toBe('Minimize');
        expect(nameOf(header.getMaximizeButton())).toBe('Maximize');
        expect(nameOf(header.getCloseButton())).toBe('Close');

        win.dispose();
    });

    it('keeps each name off the button face', () => {
        installTestDOM(CONFIG);

        const win    = new Window('W');
        const header = win.getHeader();

        for (const button of [header.getMinimizeButton(), header.getMaximizeButton(), header.getCloseButton()]) {
            expect(button.isShowText()).toBe(false);
        }

        win.dispose();
    });

    // W4
    it('renames the maximize and minimize buttons with their glyph', () => {
        installTestDOM(CONFIG);

        const win    = new Window('W');
        const header = win.getHeader();

        header.setMaximizeButtonGlyph('window-restore');
        expect(nameOf(header.getMaximizeButton())).toBe('Restore');

        header.setMaximizeButtonGlyph('window-maximize');
        expect(nameOf(header.getMaximizeButton())).toBe('Maximize');

        header.setMinimizeButtonGlyph('window-restore');
        expect(nameOf(header.getMinimizeButton())).toBe('Restore');

        header.setMinimizeButtonGlyph('window-minimize');
        expect(nameOf(header.getMinimizeButton())).toBe('Minimize');

        win.dispose();
    });

    it('follows the window state through maximize and restore', () => {
        installTestDOM(CONFIG);

        const win    = new Window('W');
        const header = win.getHeader();

        (win as any).reflectMaximizeState('maximized');

        expect(nameOf(header.getMaximizeButton())).toBe('Restore');
        expect(nameOf(header.getMinimizeButton())).toBe('Minimize');

        (win as any).reflectMaximizeState('minimized');

        expect(nameOf(header.getMaximizeButton())).toBe('Maximize');
        expect(nameOf(header.getMinimizeButton())).toBe('Restore');

        (win as any).reflectMaximizeState('normal');

        expect(nameOf(header.getMaximizeButton())).toBe('Maximize');
        expect(nameOf(header.getMinimizeButton())).toBe('Minimize');

        win.dispose();
    });

    it('leaves a name the consumer gave a button alone as the state changes', () => {
        installTestDOM(CONFIG);

        const win    = new Window('W');
        const header = win.getHeader();

        header.getMaximizeButton().setText('Maximera');
        header.getCloseButton().setText('Stäng');

        header.setMaximizeButtonGlyph('window-restore');
        header.setMaximizeButtonGlyph('window-maximize');

        expect(nameOf(header.getMaximizeButton())).toBe('Maximera');
        expect(nameOf(header.getCloseButton())).toBe('Stäng');

        win.dispose();
    });

    it('leaves alone a button the consumer gave a name another control carries', () => {
        installTestDOM(CONFIG);

        const win    = new Window('W');
        const header = win.getHeader();

        // "Close" is a library name, but not one the maximize button ever has.
        header.getMaximizeButton().setText('Close');
        header.setMaximizeButtonGlyph('window-restore');

        expect(nameOf(header.getMaximizeButton())).toBe('Close');

        win.dispose();
    });

    it('names the buttons of a window constructed maximized or minimized for that state', () => {
        installTestDOM(CONFIG);

        // No transition happens for a constructed state, so the names must
        // come from construction itself.
        const maximized = new Window('W', { windowState: 'maximized' });
        const minimized = new Window('W', { windowState: 'minimized' });

        expect(nameOf(maximized.getHeader().getMaximizeButton())).toBe('Restore');
        expect(nameOf(maximized.getHeader().getMinimizeButton())).toBe('Minimize');
        expect(nameOf(minimized.getHeader().getMinimizeButton())).toBe('Restore');
        expect(nameOf(minimized.getHeader().getMaximizeButton())).toBe('Maximize');

        maximized.dispose();
        minimized.dispose();
    });

    it('shows the restore glyph on a window constructed maximized or minimized', () => {
        installTestDOM(CONFIG);

        const maximized = new Window('W', { windowState: 'maximized' });
        const minimized = new Window('W', { windowState: 'minimized' });

        expect(maximized.getHeader().getMaximizeButton().getGlyph()?.getGlyphName()).toBe('window-restore');
        expect(minimized.getHeader().getMinimizeButton().getGlyph()?.getGlyphName()).toBe('window-restore');

        maximized.dispose();
        minimized.dispose();
    });
});

describe('TabWindow — tool button names', () => {
    afterEach(() => DOM.reset());

    // W5
    it('names the three tools and the window-menu button', () => {
        installTestDOM(CONFIG);

        const tabWindow = new TabWindow();

        expect(nameOf(tabWindow.getMinimizeButton())).toBe('Minimize');
        expect(nameOf(tabWindow.getMaximizeButton())).toBe('Maximize');
        expect(nameOf(tabWindow.getCloseButton())).toBe('Close');
        expect(nameOf(tabWindow.getWindowMenuButton())).toBe('Window menu');
        expect(tabWindow.getWindowMenuButton().getAria().getHasPopup()).toBe('menu');

        tabWindow.dispose();
    });

    it('keeps the window-menu name when the leading glyph is swapped', () => {
        installTestDOM(CONFIG);

        const tabWindow = new TabWindow();

        tabWindow.setGlyph('xmark');

        expect(nameOf(tabWindow.getWindowMenuButton())).toBe('Window menu');

        tabWindow.dispose();
    });

    // W6
    it('renames the maximize and minimize tools with the window state', () => {
        installTestDOM(CONFIG);

        const tabWindow = new TabWindow();

        reflectState(tabWindow, 'maximized');

        expect(nameOf(tabWindow.getMaximizeButton())).toBe('Restore');
        expect(nameOf(tabWindow.getMinimizeButton())).toBe('Minimize');

        reflectState(tabWindow, 'minimized');

        expect(nameOf(tabWindow.getMaximizeButton())).toBe('Maximize');
        expect(nameOf(tabWindow.getMinimizeButton())).toBe('Restore');

        reflectState(tabWindow, 'normal');

        expect(nameOf(tabWindow.getMaximizeButton())).toBe('Maximize');
        expect(nameOf(tabWindow.getMinimizeButton())).toBe('Minimize');

        tabWindow.dispose();
    });

    it('keeps the tool glyphs as the state changes', () => {
        installTestDOM(CONFIG);

        const tabWindow = new TabWindow();

        reflectState(tabWindow, 'maximized');

        expect(tabWindow.getMaximizeButton().getGlyph()?.getGlyphName()).toBe('window-maximize');
        expect(tabWindow.getMinimizeButton().getGlyph()?.getGlyphName()).toBe('window-minimize');

        tabWindow.dispose();
    });

    it('names the tools of a window constructed maximized or minimized for that state', () => {
        installTestDOM(CONFIG);

        const maximized = new TabWindow({ windowState: 'maximized' });
        const minimized = new TabWindow({ windowState: 'minimized' });

        expect(nameOf(maximized.getMaximizeButton())).toBe('Restore');
        expect(nameOf(maximized.getMinimizeButton())).toBe('Minimize');
        expect(nameOf(minimized.getMinimizeButton())).toBe('Restore');
        expect(nameOf(minimized.getMaximizeButton())).toBe('Maximize');

        maximized.dispose();
        minimized.dispose();
    });

    it('leaves a name the consumer gave a tool alone as the state changes', () => {
        installTestDOM(CONFIG);

        const tabWindow = new TabWindow();

        tabWindow.getMinimizeButton().setText('Minimera');

        reflectState(tabWindow, 'minimized');
        reflectState(tabWindow, 'normal');

        expect(nameOf(tabWindow.getMinimizeButton())).toBe('Minimera');

        tabWindow.dispose();
    });
});

describe('TabWindow — name', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    /** Builds a TabWindow holding one tab. */
    function withOneTab(): TabWindow {
        const tabWindow = new TabWindow();

        tabWindow.createTab(new Component());

        return tabWindow;
    }

    // W7
    it('takes the active tab label as its name when it is activated', () => {
        installTestDOM(CONFIG);

        const tabWindow = withOneTab();

        tabWindow.onActivate(true);

        expect(tabWindow.getTitle()).not.toBe('');
        expect(tabWindow.getAria().getLabel()).toBe(tabWindow.getTitle());
        expect(attribute(tabWindow, 'aria-label')).toBe(tabWindow.getTitle());

        tabWindow.dispose();
    });

    it('takes the active tab label as its name when it is shown', () => {
        installTestDOM(CONFIG);

        const tabWindow = withOneTab();

        vi.spyOn(tabWindow, 'getTitle').mockReturnValue('Query 1');
        // show() also activates the window, which names it too. Silence that,
        // so the name asserted below can only come from show() itself.
        vi.spyOn(tabWindow, 'onActivate').mockImplementation(() => {});
        tabWindow.show();

        expect(tabWindow.getAria().getLabel()).toBe('Query 1');

        tabWindow.dispose();
    });

    it('does not rename itself when it is deactivated', () => {
        installTestDOM(CONFIG);

        const tabWindow = withOneTab();

        tabWindow.onActivate(true);

        vi.spyOn(tabWindow, 'getTitle').mockReturnValue('B');
        tabWindow.onActivate(false);

        expect(tabWindow.getAria().getLabel()).not.toBe('B');

        tabWindow.dispose();
    });

    it('writes the name before the window takes focus, so it is announced with it', () => {
        installTestDOM(CONFIG);

        const tabWindow = withOneTab();

        tabWindow.getElement(true);

        let nameAtFocus: string | null = 'not focused';

        vi.spyOn(tabWindow, 'focus').mockImplementation(() => {
            nameAtFocus = tabWindow.getAria().getLabel();

            return tabWindow;
        });

        tabWindow.onActivate(true);

        expect(nameAtFocus).toBe(tabWindow.getTitle());

        tabWindow.dispose();
    });

    it('names itself again once the consumer has cleared the name', () => {
        installTestDOM(CONFIG);

        const tabWindow = withOneTab();

        tabWindow.onActivate(true);
        tabWindow.getAria().clearLabel();
        tabWindow.onActivate(true);

        expect(tabWindow.getAria().getLabel()).toBe(tabWindow.getTitle());

        tabWindow.dispose();
    });

    // W8
    it('follows the active tab on the next activation', () => {
        installTestDOM(CONFIG);

        const tabWindow = withOneTab();

        tabWindow.onActivate(true);

        vi.spyOn(tabWindow, 'getTitle').mockReturnValue('B');
        tabWindow.onActivate(true);

        expect(tabWindow.getAria().getLabel()).toBe('B');

        tabWindow.dispose();
    });

    // W9
    it('leaves a name the consumer set alone', () => {
        installTestDOM(CONFIG);

        const tabWindow = withOneTab();

        tabWindow.onActivate(true);
        tabWindow.getAria().setLabel('Workspace');
        tabWindow.onActivate(true);

        expect(tabWindow.getAria().getLabel()).toBe('Workspace');

        tabWindow.dispose();
    });

    it('leaves a name the consumer set before the first activation alone', () => {
        installTestDOM(CONFIG);

        const tabWindow = withOneTab();

        tabWindow.getAria().setLabel('Workspace');
        tabWindow.onActivate(true);

        expect(tabWindow.getAria().getLabel()).toBe('Workspace');

        tabWindow.dispose();
    });

    // W10
    it('has no name while its strip is empty', () => {
        installTestDOM(CONFIG);

        const tabWindow = new TabWindow();

        tabWindow.onActivate(true);

        expect(tabWindow.getAria().getLabel()).toBeNull();
        expect(attribute(tabWindow, 'aria-label')).toBeNull();

        tabWindow.dispose();
    });

    // W11
    it('drops the name it wrote when the title becomes empty', () => {
        installTestDOM(CONFIG);

        const tabWindow = withOneTab();

        tabWindow.onActivate(true);

        vi.spyOn(tabWindow, 'getTitle').mockReturnValue('');
        tabWindow.onActivate(true);

        expect(tabWindow.getAria().getLabel()).toBeNull();

        tabWindow.dispose();
    });
});
