// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins `plans/implemented/programmatic-selection-action.md`'s
// `## Expected Behaviour` cases 1-7: `List` and `MultiSelectList` announce
// `"action"` for the user's own selection gestures only. A programmatic
// `setSelectedIndex(idx)` keeps firing the committed-value `"change"` and
// `"binding"` — and keeps updating the dirty state — but no longer announces
// `"action"`; `setSelectedIndex(idx, false)`, `setValue` and `setValues` stay
// silent on all three.
//
// Kept in its own file rather than folded into `List.test.ts`: `"action"` is
// DOM-routed, and `Event` installs one window-level base listener per DOM
// event type in module state that survives `DOM.reset()`. A file whose
// earlier cases leave instances undisposed keeps `"change"` marked installed
// against a dead window, so every later case dispatches into nothing and each
// "zero actions" assertion passes vacuously — see the same gotcha documented
// in `ComboBoxDropdownClose.test.ts`'s header and `RowStateEconomy.test.ts`'s
// disposal list. Every list here is disposed in `afterEach`, and cases 1 and
// 5 are positive controls that must read 1.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _List } from '~/component/list/List';
import { _MultiSelectList } from '~/component/list/MultiSelectList';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The list geometry every fixture here mounts at — wide enough that no row clips. */
const LIST_WIDTH  = 300;
/** Tall enough to show every row of the six-row fixtures, so no case scrolls. */
const LIST_HEIGHT = 400;

/** A minimal KeyboardEvent-shaped object for the offline keyboard harness. */
function key(name: string): KeyboardEvent {
    return { key: name, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent;
}

// Every list this file mounts, disposed in `afterEach` — see the file header
// for why an undisposed instance would make every later "zero actions"
// assertion pass for the wrong reason.
let lists: Array<{ dispose(): void }> = [];

/**
 * Registers `list` for disposal in `afterEach` and hands it back, so a fixture
 * reads as one expression.
 *
 * @param list - The freshly constructed list.
 *
 * @returns The same list.
 */
function track<T extends { dispose(): void }>(list: T): T {
    lists.push(list);

    return list;
}

/** A rendered, laid-out single-select list of `count` string items keyed `Item <i>`. */
function makeList(count: number): _List {
    const list = track(new _List({ items: Array.from({ length: count }, (_, i) => 'Item ' + i) }));

    list.getElement(true);
    list.setWidth(LIST_WIDTH);
    list.setHeight(LIST_HEIGHT);
    list.doLayout();

    return list;
}

/** The {@link makeList} twin for the multi-select subclass. */
function makeMultiSelectList(count: number): _MultiSelectList {
    const list = track(new _MultiSelectList({ items: Array.from({ length: count }, (_, i) => 'Item ' + i) }));

    list.getElement(true);
    list.setWidth(LIST_WIDTH);
    list.setHeight(LIST_HEIGHT);
    list.doLayout();

    return list;
}

/** The live tallies {@link countEvents} keeps, plus every value `"change"` carried. */
interface EventCounts {
    change:       number;
    action:       number;
    binding:      number;
    changeValues: unknown[];
}

/**
 * Counts the `change`, `action` and `binding` events `list` fires from the
 * call onward, recording each `change` payload alongside.
 *
 * @param list - The list to observe.
 *
 * @returns A live counter object, mutated as the events fire.
 */
function countEvents(list: _List | _MultiSelectList): EventCounts {
    const counts: EventCounts = { change: 0, action: 0, binding: 0, changeValues: [] };
    const onChange  = (value: unknown): void => { counts.change += 1; counts.changeValues.push(value); };
    const onAction  = (): void => { counts.action += 1; };
    const onBinding = (): void => { counts.binding += 1; };
    // The two list classes declare `on` as an overload set whose union is not
    // directly callable; all three events wired here exist on each of them.
    const surface   = list as unknown as { on(event: string, listener: (value?: unknown) => void): void };

    surface.on('change',  onChange);
    surface.on('action',  onAction);
    surface.on('binding', onBinding);

    return counts;
}

beforeEach(() => {
    installTestDOM(CONFIG);
    lists = [];
});

afterEach(() => {
    vi.restoreAllMocks();

    for (const list of lists) {
        list.dispose();
    }

    DOM.reset();
});

describe('List — "action" announces the user\'s own selection only', () => {
    it('case 1: an arrow key that moves the selection delivers one action and one change', () => {
        const list   = makeList(6);
        const counts = countEvents(list);

        list.handleKey(key('ArrowDown'));

        expect(list.getSelectedIndex()).toBe(0);
        expect(counts.action).toBe(1);
        expect(counts.change).toBe(1);
    });

    it('case 2: setSelectedIndex delivers no action, one change carrying the new key, and one binding', () => {
        const list   = makeList(6);
        const counts = countEvents(list);

        list.setSelectedIndex(2);

        expect(list.getSelectedIndex()).toBe(2);
        expect(counts.action).toBe(0);
        expect(counts.change).toBe(1);
        expect(counts.changeValues).toEqual(['Item 2']);
        expect(counts.binding).toBe(1);
    });

    it('case 3: setSelectedIndex with fireEvent=false delivers no action, change or binding', () => {
        const list   = makeList(6);
        const counts = countEvents(list);

        list.setSelectedIndex(2, false);

        expect(list.getSelectedIndex()).toBe(2);
        expect(counts.action).toBe(0);
        expect(counts.change).toBe(0);
        expect(counts.binding).toBe(0);
    });

    it('case 4: setValue delivers no action, change or binding', () => {
        const list   = makeList(6);
        const counts = countEvents(list);

        list.setValue('Item 3');

        expect(list.getSelectedIndex()).toBe(3);
        expect(counts.action).toBe(0);
        expect(counts.change).toBe(0);
        expect(counts.binding).toBe(0);
    });

    it('case 6: a programmatic selection still updates the dirty state', () => {
        const list = makeList(6);
        list.markClean();

        list.setSelectedIndex(2);

        expect(list.isDirty()).toBe(true);
    });

    it('case 7: an unmounted list fires one change and no action, without throwing', () => {
        const list   = track(new _List({ items: ['Item 0', 'Item 1', 'Item 2'] }));
        const counts = countEvents(list);

        expect(() => list.setSelectedIndex(1)).not.toThrow();

        expect(list.getSelectedIndex()).toBe(1);
        expect(counts.change).toBe(1);
        expect(counts.action).toBe(0);
    });
});

describe('MultiSelectList — "action" announces the user\'s own selection only', () => {
    it('case 5: the arrow key announces, while setSelectedIndex and setValues do not', () => {
        const list   = makeMultiSelectList(6);
        const counts = countEvents(list);

        list.handleKey(key('ArrowDown'));

        expect(counts.action).toBe(1);

        list.setSelectedIndex(1);

        expect(counts.action).toBe(1);
        expect(counts.change).toBe(2);

        list.setValues([]);

        expect(counts.action).toBe(1);
        expect(counts.change).toBe(2);
    });
});
