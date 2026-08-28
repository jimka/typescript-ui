// Covers AbstractWindow's window menu: the item list buildWindowMenuItems
// assembles (contents, labels, checkable-row state) and the menu-opening
// entry point. The built configs are captured by stubbing the private
// `_windowMenu`'s `toggleFor` through a typed probe, mirroring
// Split.gutterMenu.test.ts's SplitProbe pattern — `openWindowMenu` is
// `protected`, so no direct call site can reach it. The Window and TabWindow
// glyph-click entry points (`onTitleGlyphClick` / `onLeadGlyphAction`) are
// asserted here too; those two cases fail until steps 13 and 16 wire them.
// See plan's Expected Behaviour cases 1-8, 10-11.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { TabWindow } from '~/overlay/TabWindow';
import { Component } from '~/core/Component';
import { MenuItemConfig } from '~/component/container/MenuItem';
import { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { _Checkbox as Checkbox } from '~/component/input/Checkbox';
import type { Handle } from '~/core/DOM';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// `openWindowMenu` / `_windowMenu` are private to AbstractWindow; accessed
// through a typed view that stubs `_windowMenu.toggleFor` to capture the
// built config array, mirroring Split.gutterMenu.test.ts's SplitProbe.
interface WindowMenuProbe {
    _windowMenu: {
        toggleFor: (openerEl: Handle, anchorRect: unknown, configs: MenuItemConfig[], onClose?: () => void) => void;
        setItemEnabled: (index: number, enabled: boolean) => void;
        dispose: () => void;
    } | null;
    openWindowMenu: (opener: Component) => void;
}

function probe(win: Window | TabWindow): WindowMenuProbe {
    return win as unknown as WindowMenuProbe;
}

/** Opens `win`'s window menu for `opener` and returns the captured configs. */
function captureMenu(win: Window | TabWindow, opener: Component): MenuItemConfig[] {
    const p = probe(win);
    let captured: MenuItemConfig[] = [];

    // `dispose` is a no-op stub, not exercised: `openWindowMenu`'s stubbed
    // `_windowMenu` still has to survive the window's own teardown (a Close
    // action's `requestClose` disposes `_windowMenu` in `destructor`).
    // `setItemEnabled` is a no-op stub too: a later `setLocked`/`setResizable`/
    // `setMaximizable` call on the same window (some tests below flip state
    // after capturing) pushes a live refresh at this stubbed `_windowMenu`
    // (see `AbstractWindow.refreshWindowMenuMaximizeAvailability`), which
    // needs a real method here to call, not just `toggleFor`/`dispose`.
    p._windowMenu = { toggleFor: (_el, _rect, configs): void => { captured = configs; }, setItemEnabled: () => {}, dispose: () => {} };
    p.openWindowMenu(opener);

    return captured;
}

describe('AbstractWindow window menu', () => {
    // Every Window/TabWindow/opener Component and `row:` factory this file
    // builds registers its own DOM listeners (a header's control buttons, a
    // row's click/mouseover/mouseout) and must be disposed before
    // DOM.reset(), or a leaked "click" registration is left marked installed
    // against a discarded sink — Event.ts's module-level "already installed"
    // state then silently drops real dispatch for every later test's fresh
    // window (see WindowControlButton.classStyleHoisting.test.ts's identical
    // observation, and Split.gutterMenu.test.ts's afterEach comment for the
    // same row-disposal requirement). Declared after DOM.reset()'s afterEach
    // so both run first (afterEach hooks run in reverse registration order).
    let builtRows: CheckboxMenuRow[] = [];
    let builtWindows: Array<{ dispose(): void }> = [];

    afterEach(() => DOM.reset());
    afterEach(() => {
        for (const row of builtRows) {
            row.dispose();
        }
        builtRows = [];

        for (const win of builtWindows) {
            win.dispose();
        }
        builtWindows = [];
    });

    /** Builds a `row:` config's row, tracking it for teardown. */
    function buildRow(config: MenuItemConfig): CheckboxMenuRow {
        const row = config.row!() as CheckboxMenuRow;
        builtRows.push(row);

        return row;
    }

    /** Tracks a constructed Window/TabWindow/opener Component for teardown. */
    function track<T extends { dispose(): void }>(obj: T): T {
        builtWindows.push(obj);

        return obj;
    }

    /** A rendered, unattached component usable as a menu opener, tracked for teardown. */
    function opener(): Component {
        const c = track(new Component());
        c.getElement(true);

        return c;
    }

    /** A built row's label — its only child is a Checkbox. */
    function rowLabel(row: CheckboxMenuRow): string {
        return (row.getComponents()[0] as InstanceType<typeof Checkbox>).getLabel() ?? '';
    }

    /** Dispatches a click at `row`'s element, toggling it — mirrors Split.gutterMenu.test.ts's `toggle` helper. */
    function click(row: CheckboxMenuRow): void {
        const handle = row.getElement(true)!;

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(handle, 'click'));
    }

    describe('menu contents', () => {
        it('builds seven configs in order: Minimize, Maximize, separator, Always on top, Lock position, separator, Close', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));
            const configs = captureMenu(win, opener());

            expect(configs.length).toBe(7);
            expect(configs[0].text).toBe('Minimize');
            expect(configs[1].text).toBe('Maximize');
            expect(configs[2].separator).toBe(true);
            expect(rowLabel(buildRow(configs[3]))).toBe('Always on top');
            expect(rowLabel(buildRow(configs[4]))).toBe('Lock position');
            expect(configs[5].separator).toBe(true);
            expect(configs[6].text).toBe('Close');
        });

        it('minimizable:false drops Minimize; maximizable:false drops Maximize; the list still starts with a real row', () => {
            installTestDOM(CONFIG);

            const noMin = captureMenu(track(new Window('W', { minimizable: false })), opener());
            expect(noMin[0].text).toBe('Maximize');
            expect(noMin[0].separator).toBeUndefined();

            const noMax = captureMenu(track(new Window('W2', { maximizable: false })), opener());
            expect(noMax[0].text).toBe('Minimize');
            expect(noMax[0].separator).toBeUndefined();
        });

        it('resizable:false drops both Minimize and Maximize; the list starts with the Always on top row', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W', { resizable: false }));
            const configs = captureMenu(win, opener());

            expect(configs[0].separator).toBeUndefined();
            expect(rowLabel(buildRow(configs[0]))).toBe('Always on top');
        });

        it('closeable:false keeps Close and sets enabled:false; locked:true disables Maximize/Restore but changes nothing else', () => {
            installTestDOM(CONFIG);

            const notCloseable = captureMenu(track(new Window('W', { closeable: false })), opener());
            const close = notCloseable.find(c => c.text === 'Close')!;
            expect(close.enabled).toBe(false);

            const locked = captureMenu(track(new Window('W2', { locked: true })), opener());
            expect(locked.length).toBe(7);
            expect(locked[0].text).toBe('Minimize');
            expect(locked[0].enabled).not.toBe(false);
            expect(locked[1].text).toBe('Maximize');
            expect(locked[1].enabled).toBe(false);
            expect(locked[6].text).toBe('Close');
            expect(locked[6].enabled).toBe(true);
        });

        it('an already-maximized window that then gets locked has its Restore row disabled too', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));
            win.setWindowState('maximized');
            win.setLocked(true);

            const configs = captureMenu(win, opener());
            const restore = configs.find(c => c.text === 'Restore')!;

            expect(restore.enabled).toBe(false);
        });

        it('labels follow window state: "minimized" shows Restore on row 1, "maximized" shows Restore on row 2', () => {
            installTestDOM(CONFIG);

            const minimizedWin = track(new Window('W'));
            minimizedWin.minimize();
            let configs = captureMenu(minimizedWin, opener());
            expect(configs[0].text).toBe('Restore');
            expect(configs[1].text).toBe('Maximize');

            const maximizedWin = track(new Window('W2'));
            maximizedWin.setWindowState('maximized');
            configs = captureMenu(maximizedWin, opener());
            expect(configs[0].text).toBe('Minimize');
            expect(configs[1].text).toBe('Restore');
        });

        it('the Always on top / Lock position rows are built with checked equal to the window\'s live state at open time', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));
            const op  = opener();

            let configs = captureMenu(win, op);
            expect(buildRow(configs[3]).isChecked()).toBe(false);
            expect(buildRow(configs[4]).isChecked()).toBe(false);

            win.setAlwaysOnTop(true);
            win.setLocked(true);

            configs = captureMenu(win, op);
            expect(buildRow(configs[3]).isChecked()).toBe(true);
            expect(buildRow(configs[4]).isChecked()).toBe(true);
        });
    });

    describe('menu row glyphs', () => {
        it('Minimize/Maximize/Close carry the same glyph their header button shows, in each window state', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));

            let configs = captureMenu(win, opener());
            expect(configs[0].glyph).toBe('window-minimize');
            expect(configs[1].glyph).toBe('window-maximize');
            expect(configs[6].glyph).toBe('xmark');

            win.minimize();
            configs = captureMenu(win, opener());
            expect(configs[0].glyph).toBe('window-restore');
            expect(configs[1].glyph).toBe('window-maximize');

            win.setWindowState('normal');
            win.setWindowState('maximized');
            configs = captureMenu(win, opener());
            expect(configs[0].glyph).toBe('window-minimize');
            expect(configs[1].glyph).toBe('window-restore');
        });

        it('Always on top / Lock position carry no glyph — they stay plain CheckboxMenuRow factories', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));
            const configs = captureMenu(win, opener());

            expect(configs[3].glyph).toBeUndefined();
            expect(configs[4].glyph).toBeUndefined();
        });
    });

    describe('menu actions', () => {
        it("Minimize/Maximize/Close configs' actions call toggleMinimize/toggleMaximize/requestClose", () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));
            const configs = captureMenu(win, opener());

            const minSpy = vi.spyOn(win, 'toggleMinimize');
            configs[0].action!();
            expect(minSpy).toHaveBeenCalledTimes(1);

            const maxSpy = vi.spyOn(win, 'toggleMaximize');
            configs[1].action!();
            expect(maxSpy).toHaveBeenCalledTimes(1);

            const closeSpy = vi.spyOn(win, 'requestClose');
            configs[6].action!();
            expect(closeSpy).toHaveBeenCalledTimes(1);
        });

        it('firing the Always on top / Lock position row action calls setAlwaysOnTop / setLocked with the toggled value', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));
            const configs = captureMenu(win, opener());

            const alwaysOnTopRow  = buildRow(configs[3]);
            const alwaysOnTopSpy  = vi.spyOn(win, 'setAlwaysOnTop');
            click(alwaysOnTopRow);
            expect(alwaysOnTopSpy).toHaveBeenLastCalledWith(true);

            click(alwaysOnTopRow);
            expect(alwaysOnTopSpy).toHaveBeenLastCalledWith(false);

            const lockRow = buildRow(configs[4]);
            const lockSpy = vi.spyOn(win, 'setLocked');
            click(lockRow);
            expect(lockSpy).toHaveBeenLastCalledWith(true);
        });
    });

    describe('menu opening', () => {
        it('openWindowMenu on an unrendered opener returns without creating a Menu', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));
            const unrendered = track(new Component());

            probe(win).openWindowMenu(unrendered);

            expect(probe(win)._windowMenu).toBeNull();
        });

        it('clicking the Window title-bar icon opens the window menu', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));
            win.getElement(true);

            const spy = vi.spyOn(probe(win), 'openWindowMenu');
            (win as unknown as { onTitleGlyphClick(): void }).onTitleGlyphClick();

            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('a Window whose icon was removed opens nothing on a header click', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));
            win.getElement(true);
            win.getHeader().clearGlyph();

            (win as unknown as { onTitleGlyphClick(): void }).onTitleGlyphClick();

            expect(probe(win)._windowMenu).toBeNull();
        });

        it('clicking the TabWindow leading glyph opens the window menu', () => {
            installTestDOM(CONFIG);

            const win = track(new TabWindow());
            win.getElement(true);

            const spy = vi.spyOn(probe(win), 'openWindowMenu');
            (win as unknown as { onLeadGlyphAction(): void }).onLeadGlyphAction();

            expect(spy).toHaveBeenCalledTimes(1);
        });
    });

    // Regression: the Maximize row's `enabled` flag is only computed when the
    // menu is (re)built (see buildWindowMenuItems), so toggling "Lock
    // position" — whose own row deliberately leaves the panel open, "so both
    // can be flipped in one visit" — used to leave that same still-open
    // panel's Maximize row clickable until the menu was closed and reopened.
    // Exercises a REAL Menu (not the `_windowMenu` stub `captureMenu` uses
    // elsewhere in this file), because the fix must reach the actual rendered
    // row, not just the captured config array.
    describe('menu stays in sync while the panel stays open', () => {
        it('toggling Lock position from the still-open menu immediately disables Maximize, so neither a click nor Enter on it maximizes', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));
            const op  = opener();

            probe(win).openWindowMenu(op);

            const menu = probe(win)._windowMenu as unknown as {
                _menuItems: Array<{ activate(): void; isEnabled(): boolean; getElement(create?: boolean): Handle | null }>;
            };
            const lockRow      = menu._menuItems[4] as unknown as CheckboxMenuRow;
            const maximizeItem = menu._menuItems[1];

            expect(maximizeItem.isEnabled()).toBe(true);

            // Toggling "Lock position" leaves the panel open (its own
            // documented behaviour) and calls setLocked(true) on the window.
            click(lockRow);

            expect(win.isLocked()).toBe(true);
            expect(maximizeItem.isEnabled()).toBe(false);

            const maxSpy = vi.spyOn(win, 'toggleMaximize');

            // Enter/keyboard-style activation.
            maximizeItem.activate();
            expect(maxSpy).not.toHaveBeenCalled();

            // A real pointer click on the row's own element — the path a
            // stale, construction-time-frozen `enabled` capture would have
            // kept live regardless of the fix above.
            DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(maximizeItem.getElement(true)!, 'click'));
            expect(maxSpy).not.toHaveBeenCalled();
        });
    });
});
