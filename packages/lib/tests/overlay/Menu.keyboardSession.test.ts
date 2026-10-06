// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// A context menu opened from the keyboard: `Menu.show()` starts a keyboard
// session when the last input was a key press. The menu panel then takes DOM
// focus, highlights its first enabled row, handles its own keys, and returns
// focus to the invoker when it closes. Cases follow the plan's `## Expected
// Behaviour` tables (plans/implemented/context-menu-keyboard-operation.md):
// W = input watch, S = session start, K = keys, F = focus return,
// U = submenus, A = ARIA, C = cell editors, X = paths that must not change.
// D = inside a modal dialog, which the plan did not list: see the plan's
// `## Implementation Notes`.
//
// Every case dispatches real events through `Event`'s window-level handlers
// (`DOM.sink.dispatchEvent`). `Event` keeps its registrations in module-level
// state that outlives `DOM.reset()`, and attaches a window listener only when
// a type is first registered, so a registration left behind by one test would
// make the next test's dispatches silently vanish. The teardown below
// therefore removes every one: each menu and the opener are disposed, the
// timers are run so a closed submenu's fade disposes it, and
// `Menu._stopInputWatch()` removes the static input watch. A `Button` attaches
// a tooltip, which starts `Tooltip`'s own static watch — it listens for
// `keydown` too — so `Tooltip._stopPointerWatch()` removes that one.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Menu } from '~/overlay/Menu';
import { Tooltip } from '~/overlay/Tooltip';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { RadioMenuRow } from '~/component/container/RadioMenuRow';
import { MenuRow } from '~/component/container/MenuRow';
import { Button } from '~/component/button/Button';
import { TextField } from '~/component/input/TextField';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import { Event } from '~/core/Event';
import { SplitButton } from '~/component/button/SplitButton';
import { MenuBar } from '~/component/menubar/MenuBar';
import { StringEditor } from '~/component/table/cell/editor/String';
import { DateTimeEditor } from '~/component/table/cell/editor/DateTime';
import { DateEditor } from '~/component/table/cell/editor/Date';
import { TimeEditor } from '~/component/table/cell/editor/Time';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle, Rect } from '~/core/DOM';
import { LayerManager } from '~/core/LayerManager';
import { SpatialNavigation } from '~/core/SpatialNavigation';
import { installTestDOM, makeEvent, setConnected } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Any in-viewport point: no case reads where the menu is placed.
const AT = 10;

/** How many times a dispatched event was stopped and prevented. */
interface Consumption {
    stops:    number;
    prevents: number;
}

/** A key the focused menu handled: stopped and prevented, once each. */
const CONSUMED: Consumption = { stops: 1, prevents: 1 };
/** A key the focused menu left alone. */
const PASSED: Consumption = { stops: 0, prevents: 0 };

let opener: Button;
let openerEl: Handle;
let menus: Menu[];
let extras: Component[];

/** Builds a rebuild-mode menu the teardown disposes. */
function makeMenu(): Menu {
    const menu = new Menu();

    menus.push(menu);

    return menu;
}

/**
 * Renders `component`, marks its element connected, and registers it for
 * teardown.
 *
 * @param component - The component to render.
 * @returns The component's element.
 */
function connect(component: Component): Handle {
    const el = component.getElement(true)!;

    setConnected(el, true);
    extras.push(component);

    return el;
}

/**
 * The user presses a key while `target` has focus: a real `keydown` there.
 *
 * @param target - The element that has focus.
 * @param key - The key pressed.
 * @param repeat - Whether this is the auto-repeat of a key held down.
 */
function keyInput(target: Handle = openerEl, key: string = 'F10', repeat: boolean = false): void {
    DOM.sink.dispatchEvent(target, makeEvent(target, 'keydown', { key, repeat }));
}

/** The user presses a pointer button on `target`: a real `pointerdown` there. */
function pointerInput(target: Handle = openerEl): void {
    DOM.sink.dispatchEvent(target, makeEvent(target, 'pointerdown', { button: 2 }));
}

/**
 * Dispatches a real `keydown` at `target`'s element and reports whether the
 * dispatcher stopped and prevented it.
 *
 * @param target - The menu (or other component) whose element receives the key.
 * @param key - The key pressed.
 * @param init - Extra event fields, such as `shiftKey` or `repeat`.
 * @returns The stop and prevent counts.
 */
function press(target: Component, key: string, init: { shiftKey?: boolean; repeat?: boolean } = {}): Consumption {
    const el          = target.getElement()!;
    const event       = makeEvent(el, 'keydown', { key, ...init });
    const consumption = { stops: 0, prevents: 0 };

    (event as unknown as { stopPropagation: () => void }).stopPropagation = () => { consumption.stops += 1; };
    (event as unknown as { preventDefault: () => void }).preventDefault = () => { consumption.prevents += 1; };

    DOM.sink.dispatchEvent(el, event);

    return consumption;
}

/** Opens `menu` with `configs` after a key press on the opener. */
function showFromKeyboard(menu: Menu, configs: MenuItemConfig[]): Menu {
    keyInput();

    return menu.show(AT, AT, configs);
}

/** Opens `menu` with `configs` after a pointer press on the opener. */
function showFromPointer(menu: Menu, configs: MenuItemConfig[]): Menu {
    pointerInput();

    return menu.show(AT, AT, configs);
}

/** Whether `menu` is the topmost open layer. */
function isTopLayer(menu: Menu): boolean {
    return LayerManager.getTopLayer() === menu;
}

/** The element that has DOM focus. */
function active(): Handle | null {
    return DOM.source.getActiveElement();
}

/** The open child submenu of `menu`, or `null`. */
function submenuOf(menu: Menu): Menu | null {
    return (menu as any)._openSubmenuPanel;
}

/** The row built for `menu`'s config at `index`. */
function rowAt(menu: Menu, index: number): MenuRow {
    return (menu as any)._menuItems[index];
}

/** Builds a full Rect from its four edges. */
function rect(left: number, top: number, right: number, bottom: number): Rect {
    return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Spies on `DOM.sink.focus` while keeping its modelled effect. */
function spyOnFocus(): MockInstance<typeof DOM.sink.focus> {
    return vi.spyOn(DOM.sink, 'focus');
}

beforeEach(() => {
    installTestDOM(CONFIG);
    vi.useFakeTimers();

    menus  = [];
    extras = [];

    opener   = new Button({ text: 'Open' });
    openerEl = opener.getElement(true)!;
    setConnected(openerEl, true);
    DOM.sink.focus(openerEl);
});

afterEach(() => {
    vi.restoreAllMocks();

    for (const menu of menus) {
        menu.dispose();
    }

    // A submenu closed during the test disposes itself when its fade ends.
    vi.runOnlyPendingTimers();

    for (const extra of extras) {
        extra.dispose();
    }

    opener.dispose();
    Menu._stopInputWatch();
    Tooltip._stopPointerWatch();

    vi.useRealTimers();
    DOM.reset();
});

describe('Menu keyboard session — input watch', () => {
    const ITEMS: MenuItemConfig[] = [{ text: 'A' }, { text: 'B' }];

    it('W1: a key press, then show(): the menu takes focus', () => {
        const menu = showFromKeyboard(makeMenu(), ITEMS);

        expect(active()).toBe(menu.getElement());
    });

    it('W2: a key press, then a pointer press, then show(): the opener keeps focus', () => {
        const menu = makeMenu();

        keyInput();
        pointerInput();
        menu.show(AT, AT, ITEMS);

        expect(active()).toBe(openerEl);
    });

    it('W2b: Control held, then a pointer press (Ctrl+click): the opener keeps focus', () => {
        const menu = makeMenu();

        keyInput(openerEl, 'Control');
        pointerInput();
        menu.show(AT, AT, ITEMS);

        expect(active()).toBe(openerEl);
    });

    it('W2c: a held modifier repeating after the pointer press does not count as a key press', () => {
        const menu = makeMenu();

        // Where `contextmenu` is raised on the button's release, a held
        // Control keeps repeating between the pointer press and show().
        keyInput(openerEl, 'Control');
        pointerInput();
        keyInput(openerEl, 'Control', true);
        menu.show(AT, AT, ITEMS);

        expect(active()).toBe(openerEl);
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(false);
    });

    it('W2d: a modifier pressed after the pointer press does not count; the key it modifies does', () => {
        const menu = makeMenu();

        pointerInput();
        keyInput(openerEl, 'Shift');
        menu.show(AT, AT, ITEMS);

        expect(active()).toBe(openerEl);

        menu.hide();
        keyInput(openerEl, 'F10');
        menu.show(AT, AT, ITEMS);

        expect(active()).toBe(menu.getElement());
    });

    it('W2e: the auto-repeat of any held key after the pointer press does not count', () => {
        const menu = makeMenu();

        keyInput(openerEl, 'ArrowDown');
        pointerInput();
        keyInput(openerEl, 'ArrowDown', true);
        menu.show(AT, AT, ITEMS);

        expect(active()).toBe(openerEl);
    });

    // show() called from a keydown handler, for the key press being handled.
    // The input watch is a viewport listener, and the dispatcher runs element
    // listeners and viewport listeners in whichever order an application
    // installed them, so the press is on record only in one of the orders.
    // Documented as not guaranteed (Menu.md, show()'s comment); both outcomes
    // are pinned so a change to either is noticed.
    it('W7: show() from a keydown handler opens from the keyboard when viewport listeners run first', () => {
        const menu    = makeMenu();
        const host    = new Component();
        const hostEl  = connect(host);
        const openMenu = (): void => { menu.show(AT, AT, ITEMS); };

        // The shared setup's opener attached a tooltip, whose watch installed
        // a viewport keydown listener before the opener's own element
        // listener, so viewport listeners run first here.
        Event.addListener(host, 'keydown', openMenu);

        DOM.sink.focus(hostEl);
        pointerInput(hostEl);
        keyInput(hostEl, 'm');

        expect(active()).toBe(menu.getElement());
    });

    it('W7b: known limit: the same call opens as a pointer menu when element listeners run first', () => {
        // Start from no keydown registration at all, so the order below decides.
        opener.dispose();
        Menu._stopInputWatch();
        Tooltip._stopPointerWatch();

        const host     = new Component();
        const hostEl   = connect(host);
        let menu: Menu | null = null;
        const openMenu = (): void => { menu!.show(AT, AT, ITEMS); };

        Event.addListener(host, 'keydown', openMenu);

        // Constructing the menu installs the input watch after the host's listener.
        menu = makeMenu();

        DOM.sink.focus(hostEl);
        pointerInput(hostEl);
        keyInput(hostEl, 'm');

        expect(isTopLayer(menu)).toBe(true);
        expect(active()).toBe(hostEl);
        expect(menu.getFocusedIndex()).toBe(-1);
    });

    it('W3: no input at all, then show(): the opener keeps focus', () => {
        const menu = makeMenu();

        menu.show(AT, AT, ITEMS);

        expect(active()).toBe(openerEl);
    });

    it('W4: a key press, then toggleFor(): the opener keeps focus and nothing is highlighted', () => {
        const menu = makeMenu();

        keyInput();
        menu.toggleFor(openerEl, rect(100, 100, 200, 124), ITEMS);

        expect(isTopLayer(menu)).toBe(true);
        expect(active()).toBe(openerEl);
        expect(menu.getFocusedIndex()).toBe(-1);
        expect(menu.getAria().getTabIndex()).toBeNull();
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(false);
    });

    it('W5: a key press, then a persistent menu\'s open(): the opener keeps focus', () => {
        const menu = new Menu(ITEMS, () => {});

        menus.push(menu);

        keyInput();
        menu.open(openerEl);

        expect(isTopLayer(menu)).toBe(true);
        expect(active()).toBe(openerEl);
        expect(menu.getFocusedIndex()).toBe(-1);
        expect(menu.getAria().getTabIndex()).toBeNull();
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(false);
    });

    it('W6b: _stopInputWatch() is safe to call again, and when no menu ever started the watch', () => {
        Menu._stopInputWatch();

        expect(() => Menu._stopInputWatch()).not.toThrow();

        const menu = makeMenu();

        // The next menu started the watch again.
        keyInput();
        menu.show(AT, AT, ITEMS);

        expect(active()).toBe(menu.getElement());
    });

    it('W6: _stopInputWatch() forgets a recorded key press', () => {
        const menu = makeMenu();

        keyInput();
        Menu._stopInputWatch();
        menu.show(AT, AT, ITEMS);

        expect(active()).toBe(openerEl);
    });

    // M1 and M2 follow plans/implemented/table-tree-keyboard-context-menu.md:
    // a Tree, a List and a table body start the watch themselves and read its
    // answer, so both statics have to work before any Menu exists.
    it('M1: a widget can start the watch and read the last input with no Menu constructed', () => {
        Menu._startInputWatch();

        expect(Menu.lastInputWasKeyPress()).toBe(false);

        keyInput();

        expect(Menu.lastInputWasKeyPress()).toBe(true);

        pointerInput();

        expect(Menu.lastInputWasKeyPress()).toBe(false);

        Menu._stopInputWatch();

        expect(Menu.lastInputWasKeyPress()).toBe(false);
    });

    it('M1b: _stopInputWatch() resets a recorded key press for the widgets\' read too', () => {
        Menu._startInputWatch();
        keyInput();

        expect(Menu.lastInputWasKeyPress()).toBe(true);

        Menu._stopInputWatch();

        expect(Menu.lastInputWasKeyPress()).toBe(false);
    });

    it('M2: a second _startInputWatch() registers nothing, so one stop removes the watch', () => {
        Menu._startInputWatch();
        Menu._startInputWatch();
        Menu._stopInputWatch();

        keyInput();

        expect(Menu.lastInputWasKeyPress()).toBe(false);
    });
});

describe('Menu keyboard session — session start', () => {
    it('S1: the menu takes focus, highlights the first row, and records its invoker', () => {
        const menu = showFromKeyboard(makeMenu(), [{ text: 'A' }, { separator: true }, { text: 'B' }]);

        expect(active()).toBe(menu.getElement());
        expect(menu.getFocusedIndex()).toBe(0);
        expect(menu.getAria().getTabIndex()).toBe(-1);
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(true);
    });

    it('S2: a disabled first row is skipped for the first enabled one', () => {
        const menu = showFromKeyboard(makeMenu(), [{ text: 'Cut', enabled: false }, { text: 'Copy' }, { text: 'Paste' }]);

        expect(menu.getFocusedIndex()).toBe(1);
    });

    it('S2b: a leading separator is skipped', () => {
        const menu = showFromKeyboard(makeMenu(), [{ separator: true }, { text: 'Copy' }]);

        expect(menu.getFocusedIndex()).toBe(1);
    });

    it('S3: with no enabled row the first navigable row is highlighted', () => {
        const menu = showFromKeyboard(makeMenu(), [{ text: 'Copy', enabled: false }]);

        expect(menu.getFocusedIndex()).toBe(0);
    });

    it('S4: an empty menu and a separator-only menu take focus with no highlight', () => {
        const empty = showFromKeyboard(makeMenu(), []);

        expect(active()).toBe(empty.getElement());
        expect(empty.getFocusedIndex()).toBe(-1);

        empty.hide();

        const separators = showFromKeyboard(makeMenu(), [{ separator: true }]);

        expect(active()).toBe(separators.getElement());
        expect(separators.getFocusedIndex()).toBe(-1);
    });

    it('S5: a pointer-opened menu takes no focus, highlights nothing and starts no session', () => {
        const focus = spyOnFocus();
        const menu  = showFromPointer(makeMenu(), [{ text: 'A' }, { text: 'B' }]);

        expect(active()).toBe(openerEl);
        expect(menu.getFocusedIndex()).toBe(-1);
        expect(menu.getAria().getTabIndex()).toBeNull();
        expect(menu.getAria().getActiveDescendant()).toBeNull();
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(false);
        expect(focus).not.toHaveBeenCalled();
    });

    it('S6: a second keyboard show() on an open menu keeps the first invoker', () => {
        const menu = showFromKeyboard(makeMenu(), [{ text: 'A' }]);

        // Focus is on the menu now; a repeat show must not record the menu
        // itself as the element to return to.
        showFromKeyboard(menu, [{ text: 'B' }, { text: 'C' }]);

        expect(active()).toBe(menu.getElement());
        expect(menu.getFocusedIndex()).toBe(0);

        menu.hide();

        expect(active()).toBe(openerEl);
    });
});

describe('Menu keyboard session — nothing focused', () => {
    it('S7: with focus on <body> the session has no invoker, so no focus move reads as its return', () => {
        // The modelled source mints a new handle on every getBody() call, so
        // give it the one stable <body> a document has.
        const body = DOM.sink.createElement('body');

        vi.spyOn(DOM.source, 'getBody').mockReturnValue(body);

        // What a browser reports as the active element when nothing is focused.
        DOM.sink.focus(body);

        const menu = showFromKeyboard(makeMenu(), [{ text: 'Bold', closeOnActivate: false }]);

        expect(active()).toBe(menu.getElement());
        expect(Menu.hasKeyboardSessionFrom(body)).toBe(false);

        const otherEl = connect(new Button({ text: 'Other' }));

        DOM.sink.appendChild(body, otherEl);
        DOM.sink.focus(otherEl);
        DOM.sink.dispatchEvent(otherEl, makeEvent(otherEl, 'focusin'));

        expect(active()).toBe(otherEl);

        DOM.sink.focus(menu.getElement()!);

        const focus = spyOnFocus();

        menu.hide();

        expect(focus).not.toHaveBeenCalled();
    });
});

describe('Menu keyboard session — keys on a focused menu', () => {
    /** `A`, a separator, `B` (disabled), `C`. */
    function standardItems(actions: { a?: () => void; b?: () => void; c?: () => void } = {}): MenuItemConfig[] {
        return [
            { text: 'A', action: actions.a },
            { separator: true },
            { text: 'B', action: actions.b, enabled: false },
            { text: 'C', action: actions.c },
        ];
    }

    it('K1: ArrowDown / ArrowUp move the highlight, wrap, skip separators and land on disabled rows', () => {
        const menu = showFromKeyboard(makeMenu(), standardItems());

        expect(press(menu, 'ArrowDown')).toEqual(CONSUMED);
        expect(menu.getFocusedIndex()).toBe(2);
        expect(press(menu, 'ArrowDown')).toEqual(CONSUMED);
        expect(menu.getFocusedIndex()).toBe(3);
        expect(press(menu, 'ArrowDown')).toEqual(CONSUMED);
        expect(menu.getFocusedIndex()).toBe(0);
        expect(press(menu, 'ArrowUp')).toEqual(CONSUMED);
        expect(menu.getFocusedIndex()).toBe(3);
    });

    it('K2: End / Home highlight the last / first navigable row', () => {
        const menu = showFromKeyboard(makeMenu(), [{ separator: true }, ...standardItems(), { separator: true }]);

        expect(press(menu, 'End')).toEqual(CONSUMED);
        expect(menu.getFocusedIndex()).toBe(4);
        expect(press(menu, 'Home')).toEqual(CONSUMED);
        expect(menu.getFocusedIndex()).toBe(1);
    });

    it('K2b: a highlight move scrolls the highlighted row into view', () => {
        const menu   = showFromKeyboard(makeMenu(), standardItems());
        const reveal = vi.spyOn((menu as any)._itemPanel, 'revealDescendant');

        press(menu, 'End');

        expect(reveal).toHaveBeenLastCalledWith(rowAt(menu, 3).getElement());

        press(menu, 'ArrowUp');

        expect(reveal).toHaveBeenLastCalledWith(rowAt(menu, 2).getElement());
    });

    it('K2c: a list that opens scrolled to its end still shows the row the session highlights', () => {
        const menu   = makeMenu().setScrollToBottomOnShow(true);
        const reveal = vi.spyOn((menu as any)._itemPanel, 'revealDescendant');

        showFromKeyboard(menu, standardItems());

        expect(menu.getFocusedIndex()).toBe(0);
        expect(reveal).toHaveBeenLastCalledWith(rowAt(menu, 0).getElement());
    });

    it('K3: Enter activates the highlighted row and closes the menu', () => {
        const a    = vi.fn();
        const menu = showFromKeyboard(makeMenu(), standardItems({ a }));

        expect(press(menu, 'Enter')).toEqual(CONSUMED);
        expect(a).toHaveBeenCalledTimes(1);
        expect(isTopLayer(menu)).toBe(false);
    });

    it('K4: Space activates the highlighted row and closes the menu', () => {
        const a    = vi.fn();
        const menu = showFromKeyboard(makeMenu(), standardItems({ a }));

        expect(press(menu, ' ')).toEqual(CONSUMED);
        expect(a).toHaveBeenCalledTimes(1);
        expect(isTopLayer(menu)).toBe(false);
    });

    it('K5: Enter on a disabled row is consumed, runs nothing and leaves the menu open and focused', () => {
        const b    = vi.fn();
        const menu = showFromKeyboard(makeMenu(), standardItems({ b }));

        press(menu, 'ArrowDown');

        expect(menu.getFocusedIndex()).toBe(2);
        expect(press(menu, 'Enter')).toEqual(CONSUMED);
        expect(b).not.toHaveBeenCalled();
        expect(isTopLayer(menu)).toBe(true);
        expect(active()).toBe(menu.getElement());
    });

    it('K6: Enter on a closeOnActivate: false row runs it and leaves the menu open and focused', () => {
        const action = vi.fn();
        const menu   = showFromKeyboard(makeMenu(), [{ text: 'Bold', action, closeOnActivate: false }, { text: 'Italic' }]);

        expect(press(menu, 'Enter')).toEqual(CONSUMED);
        expect(action).toHaveBeenCalledTimes(1);
        expect(isTopLayer(menu)).toBe(true);
        expect(active()).toBe(menu.getElement());
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(true);
    });

    it('K7: Tab and Shift+Tab close the menu, return focus, and let the key continue', () => {
        const menu = showFromKeyboard(makeMenu(), standardItems());

        expect(press(menu, 'Tab')).toEqual(PASSED);
        expect(isTopLayer(menu)).toBe(false);
        expect(active()).toBe(openerEl);

        showFromKeyboard(menu, standardItems());

        expect(press(menu, 'Tab', { shiftKey: true })).toEqual(PASSED);
        expect(isTopLayer(menu)).toBe(false);
        expect(active()).toBe(openerEl);
    });

    it('K8: the layer manager\'s close request (Escape) closes the menu and returns focus', () => {
        const menu = showFromKeyboard(makeMenu(), standardItems());

        menu.requestClose();

        expect(isTopLayer(menu)).toBe(false);
        expect(active()).toBe(openerEl);
    });

    it('K8b: a real Escape on the focused menu closes it through the layer manager and returns focus', () => {
        const menu = showFromKeyboard(makeMenu(), standardItems());

        // Stopped by the layer manager's viewport listener, not by the menu's own.
        expect(press(menu, 'Escape')).toEqual({ stops: 1, prevents: 0 });
        expect(isTopLayer(menu)).toBe(false);
        expect(active()).toBe(openerEl);
    });

    it('K9: ArrowRight on a leaf and ArrowLeft in the top menu are consumed and change nothing', () => {
        const a    = vi.fn();
        const menu = showFromKeyboard(makeMenu(), standardItems({ a }));

        expect(press(menu, 'ArrowRight')).toEqual(CONSUMED);
        expect(press(menu, 'ArrowLeft')).toEqual(CONSUMED);
        expect(menu.getFocusedIndex()).toBe(0);
        expect(a).not.toHaveBeenCalled();
        expect(isTopLayer(menu)).toBe(true);
        expect(active()).toBe(menu.getElement());
    });

    it('K10: any other key, and a key SpatialNavigation claims, are left alone', () => {
        const menu = showFromKeyboard(makeMenu(), standardItems());

        expect(press(menu, 'a')).toEqual(PASSED);
        expect(menu.getFocusedIndex()).toBe(0);

        vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true);

        expect(press(menu, 'ArrowDown')).toEqual(PASSED);
        expect(press(menu, 'Enter')).toEqual(PASSED);
        expect(menu.getFocusedIndex()).toBe(0);
        expect(isTopLayer(menu)).toBe(true);
    });

    it('K12: a held Enter or Space is consumed but activates nothing; a held arrow keeps moving', () => {
        const a    = vi.fn();
        const menu = showFromKeyboard(makeMenu(), standardItems({ a }));

        // Enter on a button whose action opens the menu is still down when
        // the panel takes focus: its auto-repeat lands here.
        expect(press(menu, 'Enter', { repeat: true })).toEqual(CONSUMED);
        expect(press(menu, ' ', { repeat: true })).toEqual(CONSUMED);
        expect(a).not.toHaveBeenCalled();
        expect(isTopLayer(menu)).toBe(true);
        expect(active()).toBe(menu.getElement());

        expect(press(menu, 'ArrowDown', { repeat: true })).toEqual(CONSUMED);
        expect(menu.getFocusedIndex()).toBe(2);

        // The next real press still activates.
        press(menu, 'Home');

        expect(press(menu, 'Enter')).toEqual(CONSUMED);
        expect(a).toHaveBeenCalledTimes(1);
    });

    it('K13: a held Enter does not enter a submenu either', () => {
        const menu = showFromKeyboard(makeMenu(), [
            { text: 'More', submenu: { label: 'More', items: [{ text: 'Y' }] } },
        ]);

        expect(press(menu, 'Enter', { repeat: true })).toEqual(CONSUMED);
        expect(submenuOf(menu)).toBeNull();
    });

    it('K14: a key pressed with Alt, Control or Meta is left alone', () => {
        const a    = vi.fn();
        const menu = showFromKeyboard(makeMenu(), standardItems({ a }));

        /** Dispatches `key` at the menu with one modifier held. */
        const chord = (key: string, modifier: 'altKey' | 'ctrlKey' | 'metaKey'): Consumption => {
            const el          = menu.getElement()!;
            const event       = makeEvent(el, 'keydown', { key, [modifier]: true });
            const consumption = { stops: 0, prevents: 0 };

            (event as unknown as { stopPropagation: () => void }).stopPropagation = () => { consumption.stops += 1; };
            (event as unknown as { preventDefault: () => void }).preventDefault = () => { consumption.prevents += 1; };

            DOM.sink.dispatchEvent(el, event);

            return consumption;
        };

        // Alt+ArrowLeft is the browser's Back; Ctrl+Space and Meta+Enter are
        // the application's or the system's.
        expect(chord('ArrowLeft', 'altKey')).toEqual(PASSED);
        expect(chord('ArrowDown', 'altKey')).toEqual(PASSED);
        expect(chord(' ', 'ctrlKey')).toEqual(PASSED);
        expect(chord('Enter', 'metaKey')).toEqual(PASSED);
        expect(chord('Home', 'ctrlKey')).toEqual(PASSED);

        expect(menu.getFocusedIndex()).toBe(0);
        expect(a).not.toHaveBeenCalled();
        expect(isTopLayer(menu)).toBe(true);
    });

    it('K11: a key on the opener does not reach a keyboard-opened menu', () => {
        const menu = showFromKeyboard(makeMenu(), standardItems());

        // Only a key pressed on one of the chain's panels is the menu's.
        keyInput(openerEl, 'ArrowDown');

        expect(menu.getFocusedIndex()).toBe(0);
    });
});

describe('Menu keyboard session — focus return', () => {
    it('F1: focus is back on the invoker before a closing row\'s action runs', () => {
        const menu = makeMenu();
        let duringAction: Handle | null = null;
        let sessionDuringAction: boolean | null = null;

        showFromKeyboard(menu, [
            { text: 'A' },
            {
                text:   'B',
                action: () => {
                    duringAction        = active();
                    sessionDuringAction = Menu.hasKeyboardSessionFrom(openerEl);
                },
            },
        ]);

        menu.focusItem(1);
        menu.activateFocused();

        expect(duringAction).toBe(openerEl);
        expect(sessionDuringAction).toBe(false);
        expect(isTopLayer(menu)).toBe(false);
    });

    it('F1b: a click on a closing row returns focus before its action too', () => {
        const menu = makeMenu();
        let duringAction: Handle | null = null;

        showFromKeyboard(menu, [{ text: 'A', action: () => { duringAction = active(); } }]);

        // MenuItem's own click handler, as a real click on the row runs it.
        (rowAt(menu, 0) as any)._onClick();

        expect(duringAction).toBe(openerEl);
        expect(isTopLayer(menu)).toBe(false);
    });

    it('F2: hide() leaves focus alone when it has moved outside the menu', () => {
        const menu    = showFromKeyboard(makeMenu(), [{ text: 'A' }]);
        const otherEl = connect(new Button({ text: 'Other' }));

        DOM.sink.focus(otherEl);
        menu.hide();

        expect(active()).toBe(otherEl);
    });

    it('F3: a disposed invoker is not refocused, and hide() does not throw', () => {
        const menu  = showFromKeyboard(makeMenu(), [{ text: 'A' }]);
        const focus = spyOnFocus();

        // Production's resolve() throws for a released handle; the modelled
        // sink only records it, so model the throw to catch an unguarded call.
        focus.mockImplementation((handle) => {
            const registered = DOM.source.isRegistered(handle);

            if (!registered) {
                throw new Error(`DOM handle ${handle} is not registered`);
            }
        });

        opener.dispose();

        expect(() => menu.hide()).not.toThrow();
        expect(focus).not.toHaveBeenCalled();
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(false);
    });

    it('F3b: an invoker removed from the page is not refocused', () => {
        const menu  = showFromKeyboard(makeMenu(), [{ text: 'A' }]);
        const focus = spyOnFocus();

        setConnected(openerEl, false);

        expect(() => menu.hide()).not.toThrow();
        expect(focus).not.toHaveBeenCalled();
    });

    it('F3c: hasKeyboardSessionFrom does not throw for a session whose invoker was disposed', () => {
        showFromKeyboard(makeMenu(), [{ text: 'A' }]);

        const otherEl = connect(new Button({ text: 'Other' }));

        opener.dispose();

        expect(() => Menu.hasKeyboardSessionFrom(otherEl)).not.toThrow();
        expect(Menu.hasKeyboardSessionFrom(otherEl)).toBe(false);
    });

    it('F4: hide() ends the session', () => {
        const menu = showFromKeyboard(makeMenu(), [{ text: 'A' }]);

        menu.hide();

        expect(active()).toBe(openerEl);
        expect(menu.getAria().getTabIndex()).toBeNull();
        expect(menu.getAria().getActiveDescendant()).toBeNull();
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(false);
        expect(menu.getFocusedIndex()).toBe(-1);
    });

    it('F5: activating a row of a pointer-opened menu moves no focus', () => {
        const action = vi.fn();
        const focus  = spyOnFocus();
        const menu   = showFromPointer(makeMenu(), [{ text: 'A', action }]);

        menu.focusItem(0);
        menu.activateFocused();

        expect(action).toHaveBeenCalledTimes(1);
        expect(isTopLayer(menu)).toBe(false);
        expect(focus).not.toHaveBeenCalled();
    });

    it('F6: the menu takes focus back when its invoker grabs it while the menu stays open', () => {
        const menu = showFromKeyboard(makeMenu(), [{ text: 'Bold', closeOnActivate: false }]);

        DOM.sink.focus(openerEl);
        DOM.sink.dispatchEvent(openerEl, makeEvent(openerEl, 'focusin'));

        expect(active()).toBe(menu.getElement());
        expect(menu.getFocusedIndex()).toBe(0);
    });

    it('F7: focus that moves anywhere else is left alone', () => {
        showFromKeyboard(makeMenu(), [{ text: 'Bold', closeOnActivate: false }]);

        const otherEl = connect(new Button({ text: 'Other' }));

        DOM.sink.focus(otherEl);
        DOM.sink.dispatchEvent(otherEl, makeEvent(otherEl, 'focusin'));

        expect(active()).toBe(otherEl);
    });

    it('F8: dispose() ends the session without moving focus', () => {
        const menu  = showFromKeyboard(makeMenu(), [{ text: 'A' }]);
        const focus = spyOnFocus();

        expect(Event._registeredComponentIds()).toContain(menu.getId());
        expect(() => menu.dispose()).not.toThrow();
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(false);
        expect(focus).not.toHaveBeenCalled();
        expect(Event._registeredComponentIds()).not.toContain(menu.getId());
    });

    it('F8b: a closed menu holds no listener registration; only a live session does', () => {
        const menu = makeMenu();

        expect(Event._registeredComponentIds()).not.toContain(menu.getId());

        showFromPointer(menu, [{ text: 'A' }]);

        expect(Event._registeredComponentIds()).not.toContain(menu.getId());

        showFromKeyboard(menu, [{ text: 'A' }]);

        expect(Event._registeredComponentIds()).toContain(menu.getId());

        menu.hide();

        expect(Event._registeredComponentIds()).not.toContain(menu.getId());
    });

    it('F9: an action that moves focus keeps it; closing the menu does not steal it back', () => {
        const menu    = makeMenu();
        const otherEl = connect(new Button({ text: 'Other' }));
        const onClose = vi.fn();

        keyInput();
        menu.show(AT, AT, [{ text: 'Go', action: () => { DOM.sink.focus(otherEl); } }], onClose);

        const focus = spyOnFocus();

        expect(press(menu, 'Enter')).toEqual(CONSUMED);

        // The invoker first, then the action's own target, and nothing after.
        expect(focus.mock.calls.map((call) => call[0])).toEqual([openerEl, otherEl]);
        expect(active()).toBe(otherEl);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(isTopLayer(menu)).toBe(false);
    });

    it('F10: a focusin after the menu closed does not pull focus back into it', () => {
        const menu = showFromKeyboard(makeMenu(), [{ text: 'A' }]);

        menu.hide();

        const focus = spyOnFocus();

        DOM.sink.dispatchEvent(openerEl, makeEvent(openerEl, 'focusin'));

        expect(focus).not.toHaveBeenCalled();
        expect(active()).toBe(openerEl);
    });

    it('F11: a custom row closing the menu does its own work first, then focus returns', () => {
        class ClosingRow extends MenuRow {
            isNavigable(): boolean {
                return true;
            }

            activate(): void {
                duringWork = active();
                this.closeMenu();
            }
        }

        const menu = makeMenu();
        let duringWork: Handle | null = null;

        showFromKeyboard(menu, [{ row: () => new ClosingRow() }]);

        expect(menu.getFocusedIndex()).toBe(0);
        expect(press(menu, 'Enter')).toEqual(CONSUMED);
        expect(duringWork).toBe(menu.getElement());
        expect(active()).toBe(openerEl);
        expect(isTopLayer(menu)).toBe(false);
    });
});

describe('Menu keyboard session — submenus', () => {
    const MORE = 1;

    /** `Plain`, then `More` with the submenu `X` (disabled), `Y`, `Z`. */
    function items(options: { y?: () => void; moreEnabled?: boolean } = {}): MenuItemConfig[] {
        return [
            { text: 'Plain' },
            {
                text:    'More',
                enabled: options.moreEnabled ?? true,
                submenu: {
                    label: 'More',
                    items: [{ text: 'X', enabled: false }, { text: 'Y', action: options.y }, { text: 'Z' }],
                },
            },
        ];
    }

    /** A keyboard-opened menu with `More` highlighted. */
    function openOnMore(options: { y?: () => void; moreEnabled?: boolean } = {}): Menu {
        const menu = showFromKeyboard(makeMenu(), items(options));

        menu.focusItem(MORE);

        return menu;
    }

    /** Asserts the plan's U1 outcome: the submenu is entered and holds focus. */
    function expectSubmenuEntered(menu: Menu): Menu {
        const submenu = submenuOf(menu)!;

        expect(submenu).toBeInstanceOf(Menu);
        expect(active()).toBe(submenu.getElement());
        expect(submenu.getFocusedIndex()).toBe(1);
        expect(submenu.getAria().getTabIndex()).toBe(-1);
        expect(menu.getFocusedIndex()).toBe(MORE);
        expect(rowAt(menu, MORE).getAria().getExpanded()).toBe(true);

        return submenu;
    }

    it('U1: ArrowRight opens the submenu and moves into it', () => {
        const menu = openOnMore();

        expect(press(menu, 'ArrowRight')).toEqual(CONSUMED);

        expectSubmenuEntered(menu);
    });

    it('U2: Enter and Space open the submenu and move into it', () => {
        const viaEnter = openOnMore();

        expect(press(viaEnter, 'Enter')).toEqual(CONSUMED);

        expectSubmenuEntered(viaEnter);

        viaEnter.hide();

        const viaSpace = openOnMore();

        expect(press(viaSpace, ' ')).toEqual(CONSUMED);

        expectSubmenuEntered(viaSpace);
    });

    it('U3: a disabled submenu row opens nothing', () => {
        const menu = openOnMore({ moreEnabled: false });

        expect(press(menu, 'ArrowRight')).toEqual(CONSUMED);
        expect(press(menu, 'Enter')).toEqual(CONSUMED);
        expect(submenuOf(menu)).toBeNull();
        expect(active()).toBe(menu.getElement());
        expect(isTopLayer(menu)).toBe(true);
    });

    it('U4: ArrowLeft in the submenu closes it and returns to its parent row', () => {
        const menu = openOnMore();

        press(menu, 'ArrowRight');

        const submenu = submenuOf(menu)!;

        expect(press(submenu, 'ArrowLeft')).toEqual(CONSUMED);
        expect(active()).toBe(menu.getElement());
        expect(menu.getFocusedIndex()).toBe(MORE);
        expect(submenuOf(menu)).toBeNull();
        expect(isTopLayer(submenu)).toBe(false);
        expect(isTopLayer(menu)).toBe(true);
        expect(rowAt(menu, MORE).getAria().getExpanded()).toBe(false);
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(true);
    });

    it('U5: Enter on a submenu leaf returns focus to the invoker before its action, and closes the chain', () => {
        let duringAction: Handle | null = null;
        const menu = openOnMore({ y: () => { duringAction = active(); } });

        press(menu, 'ArrowRight');

        const submenu = submenuOf(menu)!;

        expect(press(submenu, 'Enter')).toEqual(CONSUMED);
        expect(duringAction).toBe(openerEl);
        expect(active()).toBe(openerEl);
        expect(isTopLayer(submenu)).toBe(false);
        expect(isTopLayer(menu)).toBe(false);
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(false);
    });

    it('U6: a highlight move on the parent closes a submenu that was opened without entering it', () => {
        const menu = openOnMore();

        // Opens the submenu the way a hover does: no highlight, no focus move.
        menu.activateFocused();

        expect(submenuOf(menu)).toBeInstanceOf(Menu);
        expect(active()).toBe(menu.getElement());

        expect(press(menu, 'ArrowDown')).toEqual(CONSUMED);
        expect(submenuOf(menu)).toBeNull();
        expect(menu.getFocusedIndex()).toBe(0);
        expect(active()).toBe(menu.getElement());
    });

    it('U6b: Home on the parent closes an open submenu too', () => {
        const menu = openOnMore();

        menu.activateFocused();

        expect(press(menu, 'Home')).toEqual(CONSUMED);
        expect(submenuOf(menu)).toBeNull();
        expect(menu.getFocusedIndex()).toBe(0);
    });

    it('U7: a close request on the submenu (Escape) closes the whole chain and returns focus', () => {
        const menu = openOnMore();

        press(menu, 'ArrowRight');

        const submenu = submenuOf(menu)!;

        submenu.requestClose();

        expect(isTopLayer(submenu)).toBe(false);
        expect(isTopLayer(menu)).toBe(false);
        expect(active()).toBe(openerEl);
    });

    it('U8: Tab in the submenu closes the whole chain, returns focus, and lets the key continue', () => {
        const menu = openOnMore();

        press(menu, 'ArrowRight');

        const submenu = submenuOf(menu)!;

        expect(press(submenu, 'Tab')).toEqual(PASSED);
        expect(isTopLayer(submenu)).toBe(false);
        expect(isTopLayer(menu)).toBe(false);
        expect(active()).toBe(openerEl);
    });

    it('U9: the keys of an entered submenu move its own highlight, not the parent\'s', () => {
        const menu = openOnMore();

        press(menu, 'ArrowRight');

        const submenu = submenuOf(menu)!;

        expect(press(submenu, 'ArrowDown')).toEqual(CONSUMED);
        expect(submenu.getFocusedIndex()).toBe(2);
        expect(press(submenu, 'Home')).toEqual(CONSUMED);
        expect(submenu.getFocusedIndex()).toBe(0);
        expect(menu.getFocusedIndex()).toBe(MORE);
    });

    it('U10: the invoker grabbing focus hands it back to the panel that holds the highlight', () => {
        const menu = openOnMore();

        press(menu, 'ArrowRight');

        const submenu = submenuOf(menu)!;

        DOM.sink.focus(openerEl);
        DOM.sink.dispatchEvent(openerEl, makeEvent(openerEl, 'focusin'));

        expect(active()).toBe(submenu.getElement());
    });

    it('U11: a submenu closed while it holds focus hands focus to its parent, whatever closed it', () => {
        const menu = openOnMore();

        press(menu, 'ArrowRight');

        // A hover on a plain sibling row closes the open submenu.
        (menu as any).handleItemOpenSubmenu(rowAt(menu, 0));

        expect(submenuOf(menu)).toBeNull();
        expect(active()).toBe(menu.getElement());
    });
});

describe('Menu keyboard session — pointer and keyboard mixed', () => {
    const ITEMS: MenuItemConfig[] = [
        { text: 'Plain' },
        { text: 'More', submenu: { label: 'More', items: [{ text: 'Y' }] } },
    ];

    it('P1: in a session, a submenu the pointer opens is focusable too', () => {
        const menu = showFromKeyboard(makeMenu(), ITEMS);

        // A hover on the submenu row: no highlight, no focus move.
        (menu as any).handleItemOpenSubmenu(rowAt(menu, 1));

        const submenu = submenuOf(menu)!;

        // Focusable, so a press on one of its rows keeps focus in the chain.
        expect(submenu.getAria().getTabIndex()).toBe(-1);
        expect(submenu.getFocusedIndex()).toBe(-1);
        expect(active()).toBe(menu.getElement());
    });

    it('P2: a press that focused a pointer-opened submenu still returns focus before the row\'s action', () => {
        let duringAction: Handle | null = null;
        const menu = showFromKeyboard(makeMenu(), [
            { text: 'Plain' },
            { text: 'More', submenu: { label: 'More', items: [{ text: 'Y', action: () => { duringAction = active(); } }] } },
        ]);

        (menu as any).handleItemOpenSubmenu(rowAt(menu, 1));

        const submenu = submenuOf(menu)!;

        // What the browser does for a press inside a focusable panel.
        DOM.sink.focus(submenu.getElement()!);
        (rowAt(submenu, 0) as any)._onClick();

        expect(duringAction).toBe(openerEl);
        expect(active()).toBe(openerEl);
        expect(isTopLayer(menu)).toBe(false);
    });
});

describe('Menu keyboard session — aria-activedescendant', () => {
    it('A1: the panel names its highlighted row, and nothing when none is highlighted', () => {
        const menu = showFromPointer(makeMenu(), [{ text: 'A' }, { separator: true }, { text: 'B' }]);

        menu.focusItem(0);

        expect(menu.getAria().getActiveDescendant()).toBe(rowAt(menu, 0).getId());

        menu.focusItem(2);

        expect(menu.getAria().getActiveDescendant()).toBe(rowAt(menu, 2).getId());

        // A separator takes no highlight, so it is never named.
        menu.focusItem(1);

        expect(menu.getAria().getActiveDescendant()).toBeNull();

        menu.focusItem(0);
        menu.focusItem(-1);

        expect(menu.getAria().getActiveDescendant()).toBeNull();
    });

    it('A2: a checkbox or radio row is named by its inner control', () => {
        const menu = showFromKeyboard(makeMenu(), [
            { row: () => new CheckboxMenuRow({ text: 'Bold' }) },
            { row: () => new RadioMenuRow({ text: 'Left' }) },
        ]);

        const checkboxRow = rowAt(menu, 0);
        const checkboxId  = (checkboxRow as any)._checkbox.getId();

        expect(menu.getFocusedIndex()).toBe(0);
        expect(menu.getAria().getActiveDescendant()).toBe(checkboxId);
        expect(checkboxId).not.toBe(checkboxRow.getId());
        expect(checkboxRow.getActiveDescendantId()).toBe(checkboxId);

        press(menu, 'ArrowDown');

        const radioRow = rowAt(menu, 1);
        const radioId  = (radioRow as any).getControl().getId();

        expect(menu.getAria().getActiveDescendant()).toBe(radioId);
        expect(radioId).not.toBe(radioRow.getId());
    });

    it('A4: a rebuild forgets the name of a row it disposed', () => {
        const menu = showFromPointer(makeMenu(), [{ text: 'A' }]);

        menu.focusItem(0);

        expect(menu.getAria().getActiveDescendant()).toBe(rowAt(menu, 0).getId());

        // A second show() without a hide() in between, as toggleFor() does
        // when a different opener takes the menu over.
        menu.show(AT, AT, [{ text: 'B' }]);

        expect(menu.getFocusedIndex()).toBe(-1);
        expect(menu.getAria().getActiveDescendant()).toBeNull();
    });

    it('A3: a plain row is named by its own id', () => {
        const menu = showFromKeyboard(makeMenu(), [{ text: 'A' }]);

        expect(rowAt(menu, 0).getActiveDescendantId()).toBe(rowAt(menu, 0).getId());
        expect(menu.getAria().getActiveDescendant()).toBe(rowAt(menu, 0).getId());
    });
});

describe('Menu keyboard session — table cell editors', () => {
    it('C1: hasKeyboardSessionFrom answers for the invoker and its ancestors only', () => {
        const parent    = new Component();
        const child     = new Button({ text: 'Child' });
        const unrelated = new Button({ text: 'Unrelated' });

        parent.addComponent(child);

        const parentEl    = connect(parent);
        const childEl     = child.getElement(true)!;
        const unrelatedEl = connect(unrelated);

        setConnected(childEl, true);
        DOM.sink.appendChild(parentEl, childEl);
        DOM.sink.focus(childEl);

        const menu = makeMenu();

        keyInput(childEl);
        menu.show(AT, AT, [{ text: 'A' }]);

        expect(Menu.hasKeyboardSessionFrom(parentEl)).toBe(true);
        expect(Menu.hasKeyboardSessionFrom(childEl)).toBe(true);
        expect(Menu.hasKeyboardSessionFrom(unrelatedEl)).toBe(false);
        expect(Menu.hasKeyboardSessionFrom(null)).toBe(false);

        menu.hide();

        expect(Menu.hasKeyboardSessionFrom(parentEl)).toBe(false);
        expect(Menu.hasKeyboardSessionFrom(childEl)).toBe(false);
    });

    it('C2: a StringEditor keeps its edit while a keyboard-opened menu holds the keyboard', () => {
        const editor   = new StringEditor();
        const editorEl = connect(editor);
        const fieldEl  = (editor as any)._textField.getElement(true)! as Handle;

        setConnected(fieldEl, true);
        DOM.sink.appendChild(editorEl, fieldEl);
        DOM.sink.focus(fieldEl);

        expect(editor.retainsFocus(null)).toBe(false);

        const menu = makeMenu();

        keyInput(fieldEl);
        menu.show(AT, AT, [{ text: 'Paste' }]);

        expect(editor.retainsFocus(null)).toBe(true);

        menu.hide();

        expect(editor.retainsFocus(null)).toBe(false);
        expect(active()).toBe(fieldEl);
    });

    it('C2b: a pointer-opened menu does not keep the edit', () => {
        const editor   = new StringEditor();
        const editorEl = connect(editor);

        DOM.sink.focus(editorEl);

        const menu = makeMenu();

        pointerInput(editorEl);
        menu.show(AT, AT, [{ text: 'Paste' }]);

        expect(editor.retainsFocus(null)).toBe(false);
    });

    it('C3: a DateTimeEditor keeps its edit for a session from its own element', () => {
        const editor   = new DateTimeEditor(false);
        const editorEl = connect(editor);

        DOM.sink.focus(editorEl);

        // No session, closed dropdown: any blur ends the edit, as before.
        expect(editor.retainsFocus(null)).toBe(false);

        const menu = makeMenu();

        keyInput(editorEl);
        menu.show(AT, AT, [{ text: 'Paste' }]);

        expect(editor.retainsFocus(null)).toBe(true);

        menu.hide();

        expect(editor.retainsFocus(null)).toBe(false);
    });

    for (const [name, make] of [
        ['DateEditor', (): Component => new DateEditor()],
        ['TimeEditor', (): Component => new TimeEditor(false)],
    ] as const) {
        it(`C5: a ${name} keeps its picker open while a keyboard-opened menu holds the keyboard`, () => {
            const editor   = make();
            const editorEl = connect(editor);
            const close    = vi.spyOn(editor as any, 'closeDropdown');

            DOM.sink.focus(editorEl);

            // No session: a blur closes the picker, as before.
            (editor as any).onEditorBlur(makeEvent(editorEl, 'blur'));

            expect(close).toHaveBeenCalledTimes(1);

            const menu = makeMenu();

            keyInput(editorEl);
            menu.show(AT, AT, [{ text: 'Paste' }]);

            (editor as any).onEditorBlur(makeEvent(editorEl, 'blur'));

            expect(close).toHaveBeenCalledTimes(1);

            menu.hide();
            (editor as any).onEditorBlur(makeEvent(editorEl, 'blur'));

            expect(close).toHaveBeenCalledTimes(2);
        });
    }

    it('C4: the session is recorded before the invoker loses focus', () => {
        const editor   = new StringEditor();
        const editorEl = connect(editor);
        let retainedAtBlur: boolean | null = null;

        DOM.sink.focus(editorEl);

        const menu  = makeMenu();
        const focus = spyOnFocus();

        // The invoker's blur fires inside the focus call that moves focus to
        // the panel; that is where a cell editor asks whether to keep its edit.
        focus.mockImplementation(() => { retainedAtBlur = editor.retainsFocus(null); });

        keyInput(editorEl);
        menu.show(AT, AT, [{ text: 'Paste' }]);

        expect(retainedAtBlur).toBe(true);
    });
});

describe('Menu keyboard session — inside a modal dialog', () => {
    // The dispatcher runs element listeners and viewport listeners from two
    // separate window-level listeners, in whichever order an application
    // happened to install them. A modal `Dialog` confirms on Enter from a
    // viewport listener, scoped to "I am the topmost layer" — so a menu that
    // closed itself on Enter before the dialog's listener ran would hand the
    // dialog the same key. Both orders are pinned.
    const ORDERS = ['element listeners first', 'viewport listeners first'] as const;

    /**
     * Installs the dispatcher's two window-level `keydown` listeners in
     * `order`, starting from no `keydown` registration at all, and proves the
     * order with a key pressed on a probe.
     *
     * @param order - Which of the two listeners is installed first.
     */
    function installKeydownListeners(order: typeof ORDERS[number]): void {
        // Whatever the shared setup registered would decide the order instead.
        opener.dispose();
        Menu._stopInputWatch();
        Tooltip._stopPointerWatch();

        const probe   = new Component();
        const probeEl = connect(probe);
        const seen: string[] = [];
        const onElement  = (): void => { seen.push('element'); };
        const onViewport = (): void => { seen.push('viewport'); };

        if (order === 'element listeners first') {
            Event.addListener(probe, 'keydown', onElement);
            Event.addViewportListener(probe, 'keydown', onViewport);
        } else {
            Event.addViewportListener(probe, 'keydown', onViewport);
            Event.addListener(probe, 'keydown', onElement);
        }

        keyInput(probeEl, 'a');

        expect(seen).toEqual(order === 'element listeners first' ? ['element', 'viewport'] : ['viewport', 'element']);
    }

    for (const order of ORDERS) {
        it(`D1 (${order}): Enter on a menu row does not also confirm the dialog beneath`, () => {
            installKeydownListeners(order);
            vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });

            const field  = new TextField();
            const dialog = new Dialog({
                title:            'Rename',
                message:          'New name',
                contentComponent: field,
                buttons:          [{ text: 'OK', result: 'confirm', primary: true }],
            });

            extras.push(dialog);
            void dialog.show();

            const fieldEl = field.getElement(true)!;
            const confirm = vi.spyOn((dialog as any)._buttonRow, 'confirmPrimary');
            const paste   = vi.fn();
            const menu    = makeMenu();

            setConnected(fieldEl, true);
            DOM.sink.focus(fieldEl);

            keyInput(fieldEl);
            menu.show(AT, AT, [{ text: 'Paste', action: paste }]);

            expect(active()).toBe(menu.getElement());

            expect(press(menu, 'Enter')).toEqual(CONSUMED);

            expect(paste).toHaveBeenCalledTimes(1);
            expect(confirm).not.toHaveBeenCalled();
            expect(isTopLayer(menu)).toBe(false);
            expect(LayerManager.getTopLayer()).toBe(dialog);
            expect(active()).toBe(fieldEl);
        });

        it(`D2 (${order}): Enter on a row that opens a dialog does not confirm that dialog`, () => {
            installKeydownListeners(order);
            vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });

            // An <input> invoker: the dialog stands down by itself for a
            // button, a textarea or an editing surface, and not for this.
            const field   = new TextField();
            const fieldEl = connect(field);
            const menu    = makeMenu();
            let dialog: Dialog | null = null;
            let confirm: MockInstance | null = null;

            DOM.sink.focus(fieldEl);

            keyInput(fieldEl);
            menu.show(AT, AT, [{
                text:   'Delete…',
                action: () => {
                    dialog = new Dialog({
                        title:   'Delete',
                        message: 'Delete this row?',
                        buttons: [{ text: 'Delete', result: 'confirm', primary: true }],
                    });

                    confirm = vi.spyOn((dialog as any)._buttonRow, 'confirmPrimary');
                    void dialog.show();
                },
            }]);

            expect(press(menu, 'Enter')).toEqual(CONSUMED);

            expect(dialog).not.toBeNull();
            expect(confirm).not.toHaveBeenCalled();
            expect(LayerManager.getTopLayer()).toBe(dialog);
            expect(isTopLayer(menu)).toBe(false);

            // The dialog does act on the next Enter: it was only the key that
            // opened it that was not its own. Confirming closes the dialog,
            // which disposes itself once its dismiss animation has run.
            press(field, 'Enter');

            expect(confirm).toHaveBeenCalledTimes(1);

            vi.runOnlyPendingTimers();
        });
    }
});

describe('Menu keyboard session — host-driven menus are unchanged', () => {
    it('X1: a SplitButton opened and worked from the keyboard keeps focus on the button', () => {
        const a      = vi.fn();
        const button = new SplitButton('Save', { menuItems: [{ text: 'A', action: a }, { text: 'B' }] });
        const el     = connect(button);

        DOM.sink.focus(el);

        const focus = spyOnFocus();

        // A real ArrowDown on the button: its own listener opens the dropdown.
        expect(press(button, 'ArrowDown')).toEqual(CONSUMED);

        const menu = (button as any)._menu as Menu;

        menus.push(menu);

        expect(isTopLayer(menu)).toBe(true);
        expect(menu.getFocusedIndex()).toBe(0);
        expect(menu.getAria().getTabIndex()).toBeNull();
        expect(Menu.hasKeyboardSessionFrom(el)).toBe(false);
        expect(active()).toBe(el);

        expect(press(button, 'ArrowDown')).toEqual(CONSUMED);
        expect(menu.getFocusedIndex()).toBe(1);
        expect(press(button, 'ArrowUp')).toEqual(CONSUMED);
        expect(press(button, 'Enter')).toEqual(CONSUMED);

        expect(a).toHaveBeenCalledTimes(1);
        expect(isTopLayer(menu)).toBe(false);
        expect(active()).toBe(el);
        expect(focus).not.toHaveBeenCalled();
    });

    it('X2: a SplitButton dropdown closed with Tab or Escape moves no focus', () => {
        const button = new SplitButton('Save', { menuItems: [{ text: 'A' }] });
        const el     = connect(button);

        DOM.sink.focus(el);

        const focus = spyOnFocus();

        press(button, 'ArrowDown');

        const menu = (button as any)._menu as Menu;

        menus.push(menu);

        expect(press(button, 'Tab')).toEqual(PASSED);
        expect(isTopLayer(menu)).toBe(false);

        press(button, 'ArrowDown');
        menu.requestClose();

        expect(isTopLayer(menu)).toBe(false);
        expect(focus).not.toHaveBeenCalled();
    });

    it('X3: a MenuBar panel opened after a key press takes no focus and is driven by the bar', () => {
        const save = vi.fn();
        const bar  = new MenuBar();

        bar.setMenus([
            {
                label: 'File',
                items: [
                    { text: 'Save', action: save },
                    { text: 'Recent', submenu: { label: 'Recent', items: [{ text: 'One' }] } },
                ],
            },
        ]);

        connect(bar);

        const buttonEl = (bar as any)._buttons[0].getElement(true)! as Handle;
        const panel    = (bar as any)._panels[0] as Menu;

        setConnected(buttonEl, true);
        DOM.sink.focus(buttonEl);

        const focus = spyOnFocus();

        keyInput(buttonEl, 'Enter');
        bar.openMenu(0);

        expect(isTopLayer(panel)).toBe(true);
        expect(panel.getFocusedIndex()).toBe(-1);
        expect(panel.getAria().getTabIndex()).toBeNull();
        expect(Menu.hasKeyboardSessionFrom(buttonEl)).toBe(false);
        expect(active()).toBe(buttonEl);

        // The bar's own keydown handler drives the panel's highlight.
        const barKey = (key: string): unknown => (bar as any)._onKeyDown(makeEvent(buttonEl, 'keydown', { key }));

        barKey('ArrowDown');
        barKey('ArrowDown');

        expect(panel.getFocusedIndex()).toBe(1);

        // Enter on a submenu row opens the child panel and moves no focus.
        barKey('Enter');

        const child = submenuOf(panel)!;

        expect(child).toBeInstanceOf(Menu);
        expect(child.getFocusedIndex()).toBe(-1);
        expect(child.getAria().getTabIndex()).toBeNull();
        expect(active()).toBe(buttonEl);

        barKey('ArrowUp');
        barKey('Enter');

        expect(save).toHaveBeenCalledTimes(1);
        expect(bar.getOpenIndex()).toBe(-1);
        expect(active()).toBe(buttonEl);
        expect(focus).not.toHaveBeenCalled();
    });

    it('X4: a key press after a pointer-opened menu starts no session', () => {
        const focus = spyOnFocus();
        const menu  = showFromPointer(makeMenu(), [{ text: 'A' }, { text: 'B' }]);

        keyInput(openerEl, 'ArrowDown');

        expect(active()).toBe(openerEl);
        expect(menu.getFocusedIndex()).toBe(-1);
        expect(menu.getAria().getTabIndex()).toBeNull();
        expect(Menu.hasKeyboardSessionFrom(openerEl)).toBe(false);
        expect(focus).not.toHaveBeenCalled();
    });

    it('X5: a pointer-opened menu\'s submenu opens and closes without a focus move', () => {
        const focus = spyOnFocus();
        const menu  = showFromPointer(makeMenu(), [
            { text: 'Plain' },
            { text: 'More', submenu: { label: 'More', items: [{ text: 'Y' }] } },
        ]);

        // A hover on the submenu row, then on its plain sibling.
        (menu as any).handleItemOpenSubmenu(rowAt(menu, 1));

        const submenu = submenuOf(menu)!;

        expect(submenu).toBeInstanceOf(Menu);
        expect(submenu.getFocusedIndex()).toBe(-1);
        expect(submenu.getAria().getTabIndex()).toBeNull();

        (menu as any).handleItemOpenSubmenu(rowAt(menu, 0));

        expect(submenuOf(menu)).toBeNull();

        menu.hide();

        expect(active()).toBe(openerEl);
        expect(focus).not.toHaveBeenCalled();
    });

    it('X6: handleKey still drives a pointer-opened context menu for a host that forwards keys', () => {
        const a    = vi.fn();
        const menu = showFromPointer(makeMenu(), [{ text: 'A', action: a }, { text: 'B' }]);

        expect(menu.handleKey({ key: 'ArrowDown' } as KeyboardEvent)).toBe(true);
        expect(menu.getFocusedIndex()).toBe(0);
        expect(menu.handleKey({ key: 'Home' } as KeyboardEvent)).toBe(false);
        expect(menu.handleKey({ key: 'ArrowRight' } as KeyboardEvent)).toBe(false);
        expect(menu.handleKey({ key: 'Enter' } as KeyboardEvent)).toBe(true);
        expect(a).toHaveBeenCalledTimes(1);
        expect(active()).toBe(openerEl);
    });
});
