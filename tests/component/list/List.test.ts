// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { _List } from '~/component/list/List';
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
}

const FRUITS = ['Apple', 'Banana', 'Cherry', 'Date'];

describe('List — setItems auto-keying', () => {
    it('auto-keys a string array by array position', () => {
        const list = new _List({ items: FRUITS });

        expect(list.getItems()).toEqual([
            { key: '0', label: 'Apple' },
            { key: '1', label: 'Banana' },
            { key: '2', label: 'Cherry' },
            { key: '3', label: 'Date' },
        ]);
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
    it('appends with key = String(length-at-append)', () => {
        const list = new _List({ items: ['One', 'Two'] });

        list.addItem('Three');
        expect(list.getItems()).toEqual([
            { key: '0', label: 'One' },
            { key: '1', label: 'Two' },
            { key: '2', label: 'Three' },
        ]);
    });

    it('appending a string after explicit-keyed items index-keys by position', () => {
        const list = new _List();

        list.setItemsArray([{ key: '0', label: 'Zero' }]);
        // Documented collision (AbstractCustomList.ts:670): the appended string
        // is keyed by its final position. Here length is 1 → key "1".
        list.addItem('Next');
        expect(list.getItems().map(i => i.key)).toEqual(['0', '1']);
    });

    it('addItem collision resolves setValue to the first matching row', () => {
        const list = new _List();

        // Two rows that collide on key "1": an explicit "1" at row 0 and a
        // string appended at position 1.
        list.setItemsArray([{ key: '1', label: 'First' }]);
        list.addItem('Second');
        list.setValue('1');
        // findIndex resolves to the lowest matching row → row 0.
        expect(list.getSelectedIndex()).toBe(0);
    });
});

describe('List — setValue / getValue', () => {
    it('setValue selects the first row whose key matches', () => {
        const list = new _List({ items: FRUITS });

        list.setValue('2');
        expect(list.getSelectedIndex()).toBe(2);
        expect(list.getValue()).toBe('2');
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
        expect(list.getValue()).toBe('1');
        expect(list.getFocusedIndex()).toBe(1);

        list.reduce(3, { ctrl: false, shift: true });
        // Still single-select: only row 3.
        expect(list.getValue()).toBe('3');
    });
});

describe('List — construction option dispatch', () => {
    it('selectedIndex selects the row at construction', () => {
        const list = new _List({ items: FRUITS, selectedIndex: 2 });

        expect(list.getValue()).toBe('2');
    });

    it('value option resolves by key at construction', () => {
        const list = new _List({ items: FRUITS, value: '1' });

        expect(list.getSelectedIndex()).toBe(1);
    });

    it('selectedItem option resolves by key at construction', () => {
        const list = new _List({ items: FRUITS, selectedItem: '3' });

        expect(list.getSelectedIndex()).toBe(3);
    });
});

describe('AbstractCustomList (via List) — item bookkeeping', () => {
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

        // The contract (AbstractCustomList.ts:587) promises a *shallow* copy of
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

describe('AbstractCustomList (via List) — type-ahead with a deterministic clock', () => {
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
        expect(list.getValue()).toBe('0');
    });
});

describe('AbstractCustomList (via List) — store binding', () => {
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
