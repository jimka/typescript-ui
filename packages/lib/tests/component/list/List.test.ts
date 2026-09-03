import { describe, it, expect, vi, afterEach } from 'vitest';
import { _List } from '~/component/list/List';
import type { SelectableListItem } from '~/component/list/AbstractSelectableList';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

// White-box seam: widen the protected reducer / type-ahead to public so the
// single-select branch and the deterministic type-ahead clock can be exercised
// without a rendered element (reduceSelection / handleTypeAhead are protected
// and otherwise only fire from gated click / keyboard paths).
class TestList extends _List {
    public reduce(idx: number, ev: { ctrl: boolean; shift: boolean }): void {
        this.reduceSelection(idx, ev);
    }

    public typeAhead(ch: string): void {
        this.handleTypeAhead(ch);
    }

    // Widen the protected row-gesture dispatchers so the index → event mapping
    // can be exercised without a rendered row pool (they otherwise fire only
    // from a row's DOM listener).
    public contextMenu(idx: number, e: MouseEvent): void {
        this.handleRowContextMenu(idx, e);
    }

    public dblClick(idx: number, e: MouseEvent): void {
        this.handleRowDblClick(idx, e);
    }

    // Widen the protected click dispatcher the same way, so a disabled-row
    // click refusal can be exercised without a rendered row pool.
    public rowClick(idx: number, e: MouseEvent): void {
        this.handleRowClick(idx, e);
    }
}

/** A minimal KeyboardEvent-shaped object for the offline keyboard harness. */
function key(name: string): KeyboardEvent {
    return { key: name, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent;
}

/** Six-row fixture with rows 1, 2 and 5 disabled — the plan's navigation table. */
const ROWS = [
    { key: 'a', label: 'Apple' },
    { key: 'b', label: 'Banana', enabled: false },
    { key: 'c', label: 'Cherry', enabled: false },
    { key: 'd', label: 'Date' },
    { key: 'e', label: 'Elder' },
    { key: 'f', label: 'Fig', enabled: false },
];

/** A minimal MouseEvent stub tracking preventDefault, for the offline env. */
function mouseEventStub(): { event: MouseEvent; prevented: () => boolean } {
    let defaultPrevented = false;
    const event = { preventDefault: () => { defaultPrevented = true; } } as unknown as MouseEvent;

    return { event, prevented: () => defaultPrevented };
}

const FRUITS = ['Apple', 'Banana', 'Cherry', 'Date'];

describe('List — setItems string keying', () => {
    it('keys a string array by the string value', () => {
        const list = new _List({ items: FRUITS });

        expect(list.getItems()).toEqual([
            { key: 'Apple',  label: 'Apple' },
            { key: 'Banana', label: 'Banana' },
            { key: 'Cherry', label: 'Cherry' },
            { key: 'Date',   label: 'Date' },
        ]);
    });

    it('round-trips the visible string through setValue/getValue, not an index', () => {
        // Regression for the ComboBox footgun: a "list of names" built from a
        // plain-string array must return the chosen string from getValue, not its
        // positional index (which the backend would reject as an unknown value).
        const list = new _List({ items: FRUITS });

        list.setSelectedIndex(1, false);
        expect(list.getValue()).toBe('Banana');
    });

    it('setItemsArray keeps explicit keys verbatim (no index clobber)', () => {
        const list = new _List();

        list.setItemsArray([
            { key: 'a', label: 'Apple' },
            { key: 'z', label: 'Zucchini' },
        ]);
        expect(list.getItems().map(i => i.key)).toEqual(['a', 'z']);
    });
});

describe('List — addItem', () => {
    it('appends a string keyed by its own value', () => {
        const list = new _List({ items: ['One', 'Two'] });

        list.addItem('Three');
        expect(list.getItems()).toEqual([
            { key: 'One',   label: 'One' },
            { key: 'Two',   label: 'Two' },
            { key: 'Three', label: 'Three' },
        ]);
    });

    it('appends a string keyed by its value alongside explicit-keyed items', () => {
        const list = new _List();

        list.setItemsArray([{ key: '0', label: 'Zero' }]);
        // A plain string is keyed by its own value, independent of position.
        list.addItem('Next');
        expect(list.getItems().map(i => i.key)).toEqual(['0', 'Next']);
    });

    it('a duplicate key resolves setValue to the first matching row', () => {
        const list = new _List();

        // Two rows that collide on key "1": an explicit "1" at row 0 and an
        // explicit-keyed append at row 1.
        list.setItemsArray([{ key: '1', label: 'First' }]);
        list.addItem({ key: '1', label: 'Second' });
        list.setValue('1');
        // findIndex resolves to the lowest matching row → row 0.
        expect(list.getSelectedIndex()).toBe(0);
    });
});

describe('List — setValue / getValue', () => {
    it('setValue selects the first row whose key matches', () => {
        const list = new _List({ items: FRUITS });

        list.setValue('Cherry');
        expect(list.getSelectedIndex()).toBe(2);
        expect(list.getValue()).toBe('Cherry');
    });

    it('setValue with an unknown key clears the selection (mirrors native select)', () => {
        const list = new _List({ items: FRUITS });

        list.setValue('1');
        list.setValue('nope');
        // findIndex returns -1, setSelectedIndex(-1) clears.
        expect(list.getSelectedIndex()).toBe(-1);
        expect(list.getValue()).toBe('');
    });

    it('getValue returns "" when nothing is selected', () => {
        const list = new _List({ items: FRUITS });

        expect(list.getValue()).toBe('');
    });
});

describe('List — setSelectedIndex', () => {
    it('sets the anchor and focus; out-of-range clears to anchor null / focus -1', () => {
        const list = new _List({ items: FRUITS });

        list.setSelectedIndex(2, false);
        expect(list.getSelectedIndex()).toBe(2);
        expect(list.getFocusedIndex()).toBe(2);

        list.setSelectedIndex(99, false);
        expect(list.getSelectedIndex()).toBe(-1);
        expect(list.getFocusedIndex()).toBe(-1);

        list.setSelectedIndex(-5, false);
        expect(list.getSelectedIndex()).toBe(-1);
        expect(list.getFocusedIndex()).toBe(-1);
    });
});

describe('List — reduceSelection ignores modifiers', () => {
    it('ctrl and shift produce the same {idx} as a plain gesture', () => {
        const list = new TestList({ items: FRUITS });

        list.reduce(1, { ctrl: true, shift: true });
        expect(list.getValue()).toBe('Banana');
        expect(list.getFocusedIndex()).toBe(1);

        list.reduce(3, { ctrl: false, shift: true });
        // Still single-select: only row 3.
        expect(list.getValue()).toBe('Date');
    });
});

describe('List — construction option dispatch', () => {
    it('selectedIndex selects the row at construction', () => {
        const list = new _List({ items: FRUITS, selectedIndex: 2 });

        expect(list.getValue()).toBe('Cherry');
    });

    it('value option resolves by key at construction', () => {
        const list = new _List({ items: FRUITS, value: 'Banana' });

        expect(list.getSelectedIndex()).toBe(1);
    });

    it('selectedItem option resolves by key at construction', () => {
        const list = new _List({ items: FRUITS, selectedItem: 'Date' });

        expect(list.getSelectedIndex()).toBe(3);
    });
});

describe('AbstractSelectableList (via List) — item bookkeeping', () => {
    it('setItems resets selection / anchor / focus', () => {
        const list = new _List({ items: FRUITS, selectedIndex: 2 });

        expect(list.getSelectedIndex()).toBe(2);

        list.setItems(['New', 'Items']);
        expect(list.getSelectedIndex()).toBe(-1);
        expect(list.getFocusedIndex()).toBe(-1);
    });

    it('getItems returns a shallow array copy — structural edits do not affect the list', () => {
        const list = new _List({ items: FRUITS });
        const items = list.getItems();

        // The contract (AbstractSelectableList.ts:587) promises a *shallow* copy of
        // the array, so adding/removing entries from the returned array must not
        // change the list. (Element objects are shared by reference — deep
        // immutability is intentionally not part of the shallow-copy contract.)
        items.push({ key: 'x', label: 'Mutant' });
        items.pop();
        items.pop();
        expect(list.getItems()).toHaveLength(FRUITS.length);
        expect(list.getItems().map(i => i.label)).toEqual(FRUITS);
    });

    it('getFocusedIndex defaults to -1 before any navigation', () => {
        const list = new _List({ items: FRUITS });

        expect(list.getFocusedIndex()).toBe(-1);
    });
});

describe('AbstractSelectableList (via List) — type-ahead with a deterministic clock', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('accumulates successive keys within the timeout window into one prefix', () => {
        // Items chosen so a prefix narrows the match: "Date" vs "Da..." style.
        const list = new TestList({ items: ['Banana', 'Bark', 'Basil', 'Cherry'] });
        const now = vi.spyOn(Date, 'now');

        now.mockReturnValue(0);
        list.typeAhead('b');
        // "b" → first label starting with "b" is row 0 (Banana).
        expect(list.getFocusedIndex()).toBe(0);

        now.mockReturnValue(100);
        list.typeAhead('a');
        now.mockReturnValue(200);
        list.typeAhead('r');
        // Prefix "bar" → first match is "Bark" (row 1). "Basil" starts with
        // "ba" but not "bar".
        expect(list.getFocusedIndex()).toBe(1);
    });

    it('resets the buffer after the timeout so a lone later key searches fresh', () => {
        const list = new TestList({ items: ['Banana', 'Cherry', 'Date'] });
        const now = vi.spyOn(Date, 'now');

        now.mockReturnValue(0);
        list.typeAhead('b');
        expect(list.getFocusedIndex()).toBe(0);

        // Advance past the 700ms window → buffer resets, so "c" searches fresh.
        now.mockReturnValue(800);
        list.typeAhead('c');
        expect(list.getFocusedIndex()).toBe(1);
    });

    it('type-ahead moves focus only, never the selection', () => {
        const list = new TestList({ items: ['Apple', 'Banana'] });
        const now = vi.spyOn(Date, 'now');

        now.mockReturnValue(0);
        list.setSelectedIndex(0, false);
        list.typeAhead('b');
        expect(list.getFocusedIndex()).toBe(1);
        // Selection unchanged.
        expect(list.getSelectedIndex()).toBe(0);
        expect(list.getValue()).toBe('Apple');
    });
});

describe('AbstractSelectableList (via List) — store binding', () => {
    const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');
    const FIRST = [
        { id: 1, name: 'Alpha' },
        { id: 2, name: 'Beta' },
    ];
    const SECOND = [
        { id: 9, name: 'Zulu' },
    ];

    function loadedStore(data: any[]): MemoryStore {
        const store = new MemoryStore(MODEL, data);

        store.loadData(data);

        return store;
    }

    it('refreshFromStore keeps the selection when the key survives a reload', () => {
        const store = loadedStore(FIRST);
        const list = new _List({ store, displayField: 'name', valueField: 'id' });

        list.setValue('2');
        expect(list.getSelectedIndex()).toBe(1);

        // Reload keeps key "2" (Beta) but reorders.
        store.loadData([
            { id: 2, name: 'Beta' },
            { id: 1, name: 'Alpha' },
        ]);
        // Selection re-locates to the row still carrying key "2" → row 0.
        expect(list.getSelectedIndex()).toBe(0);
        expect(list.getValue()).toBe('2');
    });

    it('refreshFromStore clears selection and parks focus at 0 when the key is dropped', () => {
        const store = loadedStore(FIRST);
        const list = new _List({ store, displayField: 'name', valueField: 'id' });

        list.setValue('1');
        store.loadData(SECOND);
        // Key "1" gone → selection cleared, focus collapses to row 0.
        expect(list.getSelectedIndex()).toBe(-1);
        expect(list.getFocusedIndex()).toBe(0);
        expect(list.getItems().map(i => i.label)).toEqual(['Zulu']);
    });

    it('rebinding to a new store reflects only the new store contents', () => {
        const first = loadedStore(FIRST);
        const second = loadedStore(SECOND);
        const list = new _List({ store: first, displayField: 'name', valueField: 'id' });

        expect(list.getItems()).toHaveLength(2);

        list.setStore(second, 'name', 'id');
        expect(list.getItems().map(i => i.label)).toEqual(['Zulu']);

        // The old store no longer drives the list: a reload of `first` must not
        // change the item count (its handlers were de-registered).
        first.loadData([
            { id: 1, name: 'Alpha' },
            { id: 2, name: 'Beta' },
            { id: 3, name: 'Gamma' },
        ]);
        expect(list.getItems().map(i => i.label)).toEqual(['Zulu']);
    });
});

describe('List — row context-menu / dblclick events', () => {
    it('contextmenu fires with the row index and event, suppresses the native menu, and leaves the selection', () => {
        const list = new TestList({ items: FRUITS });
        const seen: Array<{ index: number; event: MouseEvent }> = [];
        list.on('contextmenu', (index, event) => seen.push({ index, event }));

        const { event, prevented } = mouseEventStub();
        list.contextMenu(2, event);

        expect(seen).toEqual([{ index: 2, event }]);
        expect(prevented()).toBe(true);
        // Right-click positions a menu without selecting — the contract mirrors Tree.
        expect(list.getSelectedIndex()).toBe(-1);
    });

    it('contextmenu ignores an out-of-range index without firing or preventing default', () => {
        const list = new TestList({ items: FRUITS });
        const fn = vi.fn();
        list.on('contextmenu', fn);

        const { event, prevented } = mouseEventStub();
        list.contextMenu(99, event);

        expect(fn).not.toHaveBeenCalled();
        expect(prevented()).toBe(false);
    });

    it('dblclick fires with the row index and event', () => {
        const list = new TestList({ items: FRUITS });
        const seen: number[] = [];
        list.on('dblclick', (index) => seen.push(index));

        const { event } = mouseEventStub();
        list.dblClick(1, event);

        expect(seen).toEqual([1]);
    });

    it('off removes a row-event listener', () => {
        const list = new TestList({ items: FRUITS });
        const fn = vi.fn();
        list.on('contextmenu', fn);
        list.off('contextmenu', fn);

        list.contextMenu(0, mouseEventStub().event);
        expect(fn).not.toHaveBeenCalled();
    });
});

describe('List — per-item tooltip data', () => {
    it('carries an array item tooltip through setItems / getItems', () => {
        const list = new _List();
        list.setItemsArray([
            { key: 'a', label: 'Apple',  tooltip: 'A red fruit' },
            { key: 'b', label: 'Banana' },
        ]);

        expect(list.getItems()).toEqual([
            { key: 'a', label: 'Apple',  glyph: undefined, tooltip: 'A red fruit' },
            { key: 'b', label: 'Banana', glyph: undefined, tooltip: undefined },
        ]);
    });

    it('resolves a store-bound tooltip from tooltipField', () => {
        const model = new Model([{ name: 'id' }, { name: 'name' }, { name: 'note' }], 'id');
        const store = new MemoryStore(model, []);
        store.loadData([{ id: 1, name: 'Alpha', note: 'the first one' }]);

        const list = new _List({ store, displayField: 'name', valueField: 'id', tooltipField: 'note' });

        expect(list.getItems()[0].tooltip).toBe('the first one');
    });
});

describe('List — disabled rows: item plumbing', () => {
    it('the enabled field round-trips through setItemsArray / setItems / addItem', () => {
        const viaArray = new _List();
        viaArray.setItemsArray(ROWS);
        expect(viaArray.getItems()[1].enabled).toBe(false);
        expect(viaArray.getItems()[0].enabled).toBeUndefined();

        const viaSetItems = new _List();
        viaSetItems.setItems(ROWS);
        expect(viaSetItems.getItems()[1].enabled).toBe(false);
        expect(viaSetItems.getItems()[0].enabled).toBeUndefined();

        const viaAddItem = new _List();
        viaAddItem.addItem({ key: 'g', label: 'Grape', enabled: false });
        expect(viaAddItem.getItems()[0].enabled).toBe(false);
    });

    it('a plain string entry stays enabled', () => {
        const list = new _List();
        list.setItems(['Apple']);
        expect(list.isItemEnabled(0)).toBe(true);
    });
});

describe('List — disabled rows: isItemEnabled / setItemEnabled', () => {
    it('isItemEnabled reflects a missing field, true, false, and out-of-range indices', () => {
        const list = new _List();
        list.setItemsArray(ROWS);

        expect(list.isItemEnabled(0)).toBe(true);
        expect(list.isItemEnabled(3)).toBe(true);
        expect(list.isItemEnabled(1)).toBe(false);
        expect(list.isItemEnabled(-1)).toBe(false);
        expect(list.isItemEnabled(99)).toBe(false);
    });

    it('setItemEnabled updates the flag both ways', () => {
        const list = new _List();
        list.setItemsArray(ROWS);

        list.setItemEnabled(0, false);
        expect(list.isItemEnabled(0)).toBe(false);
        expect(list.getItems()[0].enabled).toBe(false);

        list.setItemEnabled(1, true);
        expect(list.isItemEnabled(1)).toBe(true);
    });

    it('setItemEnabled does not mutate the caller-supplied item object', () => {
        const held: SelectableListItem = { key: 'a', label: 'Apple' };
        const list = new _List();
        list.setItemsArray([held]);

        list.setItemEnabled(0, false);
        expect(held.enabled).toBeUndefined();
    });

    it('setItemEnabled out of range is a no-op', () => {
        const list = new _List();
        list.setItemsArray(ROWS);
        const before = list.getItems();

        const result = list.setItemEnabled(99, false);
        expect(result).toBe(list);
        expect(list.getItems()).toEqual(before);
    });

    it('setItemEnabled leaves selection and focus alone', () => {
        const list = new _List();
        list.setItemsArray(ROWS);

        list.setSelectedIndex(0, false);
        list.setItemEnabled(0, false);
        expect(list.getSelectedIndex()).toBe(0);
        expect(list.getFocusedIndex()).toBe(0);
    });
});

describe('List — disabled rows: keyboard navigation skips them', () => {
    // The plan's navigation table: rows 1, 2 and 5 disabled. PageDown/PageUp
    // take the same code path as ArrowDown/ArrowUp for an offline (heightless)
    // list, whose page size falls back to one row — no separate case needed.
    it.each([
        { before: 0, key: 'ArrowDown', after: 3 },
        { before: 4, key: 'ArrowDown', after: 4 },
        { before: 3, key: 'ArrowUp',   after: 0 },
        { before: 0, key: 'ArrowUp',   after: 0 },
        { before: -1, key: 'Home',     after: 0 },
        { before: -1, key: 'End',      after: 4 },
    ])('focus $before + $key -> $after', ({ before, key: k, after }) => {
        const list = new TestList({ items: ROWS });
        list.setSelectedIndex(before, false);

        list.handleKey(key(k));
        expect(list.getFocusedIndex()).toBe(after);
    });

    it('consumes the key but does not move when every row is disabled', () => {
        const allDisabled = ROWS.map(item => ({ ...item, enabled: false }));
        const list = new TestList({ items: allDisabled });
        list.setSelectedIndex(-1, false);

        expect(list.handleKey(key('ArrowDown'))).toBe(true);
        expect(list.getFocusedIndex()).toBe(-1);
    });
});

describe('List — disabled rows: type-ahead skips a disabled match', () => {
    it('jumps past a disabled row whose label matches first', () => {
        const list = new TestList({
            items: [
                { key: 'a', label: 'Apple',   enabled: false },
                { key: 'b', label: 'Avocado' },
            ],
        });

        list.typeAhead('a');
        expect(list.getFocusedIndex()).toBe(1);
    });
});

describe('List — disabled rows: gesture refusal', () => {
    it('a click on a disabled row is refused', () => {
        const list = new TestList({ items: ROWS });
        list.setFocusOnRowClick(false);
        const fn = vi.fn();
        list.on('change', fn);

        list.rowClick(1, mouseEventStub().event);

        expect(list.getSelectedIndex()).toBe(-1);
        expect(fn).not.toHaveBeenCalled();
    });

    it('a double-click on a disabled row fires nothing', () => {
        const list = new TestList({ items: ROWS });
        const fn = vi.fn();
        list.on('dblclick', fn);

        list.dblClick(1, mouseEventStub().event);

        expect(fn).not.toHaveBeenCalled();
    });

    it('a right-click on a disabled row still fires and prevents default', () => {
        const list = new TestList({ items: ROWS });
        const fn = vi.fn();
        list.on('contextmenu', fn);

        const { event, prevented } = mouseEventStub();
        list.contextMenu(1, event);

        expect(fn).toHaveBeenCalledWith(1, event);
        expect(prevented()).toBe(true);
    });

    it('Enter on a focus parked at a disabled row is refused', () => {
        const list = new TestList({ items: ROWS });
        list.setSelectedIndex(1, false);
        const valueBefore = list.getValue();
        const selectedBefore = list.getSelectedIndex();
        const fn = vi.fn();
        list.on('change', fn);

        list.handleKey(key('Enter'));

        expect(list.getValue()).toBe(valueBefore);
        expect(list.getSelectedIndex()).toBe(selectedBefore);
        expect(fn).not.toHaveBeenCalled();
    });

    it('programmatic selection still reaches a disabled row', () => {
        const list = new _List({ items: ROWS });

        list.setValue('b');
        expect(list.getSelectedIndex()).toBe(1);
        expect(list.getValue()).toBe('b');
    });
});
