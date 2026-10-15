// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The keys that act on a row of a collection widget: type-ahead in a `List`
// (L), and in a `Tree` type-ahead (T), `Enter` (N) and `*` (X). Cases follow
// the `## Expected Behaviour` tables of
// plans/in-progress/collection-widget-keyboard-gaps.md.
//
// Every key press is a real `keydown` event dispatched through `Event`'s
// window-level handlers (`DOM.sink.dispatchEvent`), so a case can count the
// `preventDefault` calls a press made and show that an ancestor still hears
// the key. `Event` keeps its registrations in module-level state that
// outlives `DOM.reset()`, and attaches a window listener only when a type is
// first registered, so a registration left behind by one test would make the
// next test's dispatches silently vanish. The teardown therefore disposes
// every component a test built and stops the two static watches (see the
// header of `KeyboardRowNavigation.test.ts`, whose harness this file copies).
//
// The modelled DOM has no layout engine: a widget's viewport height comes
// from its committed size and the row height is the widget's own default.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Menu } from '~/overlay/Menu';
import { Tooltip } from '~/overlay/Tooltip';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { _List } from '~/component/list/List';
import type { SelectableListItem } from '~/component/list/AbstractSelectableList';
import { installTestDOM, makeEvent, setConnected } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Keys held during a press, and whether it is an auto-repeat. */
interface Modifiers {
    shiftKey?: boolean;
    ctrlKey?:  boolean;
    altKey?:   boolean;
    metaKey?:  boolean;
    repeat?:   boolean;
}

let built: Component[];

/**
 * Registers `component` for disposal in the teardown.
 *
 * @param component - The component a test built.
 * @returns The same component.
 */
function track<T extends Component>(component: T): T {
    built.push(component);

    return component;
}

/**
 * The user presses a key while `el` has focus: a real `keydown` there.
 *
 * @param el - The focused element.
 * @param key - The key pressed.
 * @param init - Modifier keys held.
 * @returns How many times the event's `preventDefault` ran.
 */
function press(el: Handle, key: string, init: Modifiers = {}): number {
    const event  = makeEvent(el, 'keydown', { key, ...init });
    let prevents = 0;

    (event as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

    DOM.sink.dispatchEvent(el, event);

    return prevents;
}

/**
 * Sets the clock the type-ahead helper reads.
 *
 * @param ms - The value `Date.now()` returns from now on.
 */
function clock(ms: number): void {
    vi.spyOn(Date, 'now').mockReturnValue(ms);
}

beforeEach(() => {
    installTestDOM(CONFIG);

    built = [];
});

afterEach(() => {
    vi.restoreAllMocks();

    for (const component of built) {
        component.dispose();
    }

    Menu._stopInputWatch();
    Tooltip._stopPointerWatch();

    DOM.reset();
});

describe('Keyboard row actions — List type-ahead', () => {
    const LIST_SIZE = 200;
    const LIST4     = ['Apple', 'Banana', 'Blueberry', 'Cherry'];

    /**
     * Builds a list, gives it a committed size and focuses it.
     *
     * @param items - The list's items.
     * @param options - Extra list options.
     * @returns The list and its element.
     */
    function mountList(items: Array<string | SelectableListItem>, options: object = {}): { list: _List, el: Handle } {
        const list = track(new _List({ items, ...options }));
        const el   = list.getElement(true)!;

        setConnected(el, true);
        list.setWidth(LIST_SIZE);
        list.setHeight(LIST_SIZE);
        DOM.sink.focus(el);

        return { list, el };
    }

    it('L6: a letter moves the focus mark, is prevented and leaves the selection', () => {
        const { list, el } = mountList(LIST4);

        clock(1000);

        expect(press(el, 'b')).toBe(1);
        expect(list.getFocusedIndex()).toBe(1);
        expect(list.getSelectedIndex()).toBe(-1);
    });

    it('L7: Escape clears the buffer and is not prevented', () => {
        const { list, el } = mountList(['Apple', 'Banana', 'Blueberry', 'Lemon']);

        clock(1000);
        press(el, 'b');

        expect(list.getFocusedIndex()).toBe(1);

        expect(press(el, 'Escape')).toBe(0);

        clock(1100);
        press(el, 'l');

        expect(list.getFocusedIndex()).toBe(3);
    });

    it('L8: a read-only list and an empty list ignore the key', () => {
        const readOnly = mountList(LIST4, { readOnly: true });

        clock(1000);

        expect(press(readOnly.el, 'b')).toBe(0);
        expect(readOnly.list.getFocusedIndex()).toBe(-1);

        const empty = mountList([]);

        expect(press(empty.el, 'b')).toBe(0);
        expect(empty.list.getFocusedIndex()).toBe(-1);
    });

    it('L9: the host-forwarded path consumes a letter and refuses a chord', () => {
        const { list } = mountList(LIST4);

        clock(1000);

        expect(list.handleKey({ key: 'b', preventDefault() {} } as unknown as KeyboardEvent)).toBe(true);
        expect(list.handleKey({ key: 'b', ctrlKey: true, preventDefault() {} } as unknown as KeyboardEvent)).toBe(false);
    });
});
