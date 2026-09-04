import { describe, it, expect } from 'vitest';
import { _MultiSelectList } from '~/component/list/MultiSelectList';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

// White-box seam: widen the protected reducer / selectAll to public so the
// modifier-key branches can be exercised without faking DOM MouseEvents. The
// production reducer only fires from handleRowClick / the keyboard reducer,
// both gated behind a rendered element — see AbstractSelectableList.handleRowClick.
class TestMultiSelectList extends _MultiSelectList {
    public reduce(idx: number, ev: { ctrl: boolean; shift: boolean }): void {
        this.reduceSelection(idx, ev);
    }

    public all(): void {
        this.selectAll();
    }

    /** Performs both calls the real click handler makes — reduce, then notify. */
    public click(idx: number, ev: { ctrl: boolean; shift: boolean }): void {
        this.reduceSelection(idx, ev);
        this.notifyUserChange();
    }
}

const FRUITS = ['Apple', 'Banana', 'Cherry', 'Date', 'Elder', 'Fig'];

/** Six-row fixture with rows 1, 2 and 5 disabled — matches List.test.ts's ROWS. */
const ROWS = [
    { key: 'a', label: 'Apple' },
    { key: 'b', label: 'Banana', enabled: false },
    { key: 'c', label: 'Cherry', enabled: false },
    { key: 'd', label: 'Date' },
    { key: 'e', label: 'Elder' },
    { key: 'f', label: 'Fig', enabled: false },
];

describe('MultiSelectList — construction + selectedIndices option', () => {
    it('selects the rows named by selectedIndices', () => {
        const list = new _MultiSelectList({ items: FRUITS, selectedIndices: [1, 3] });

        // Rows are keyed by their string value; getValue returns the selected keys.
        expect(list.getValue()).toEqual(['Banana', 'Date']);
    });

    it('drops out-of-range indices in the selectedIndices option', () => {
        const list = new _MultiSelectList({ items: FRUITS, selectedIndices: [1, 99, -1] });

        // Bounds guard in applyInitialSelection silently ignores 99 and -1.
        expect(list.getValue()).toEqual(['Banana']);
    });

    it('parks the anchor at the max applied index (observable via getSelectedIndex)', () => {
        const list = new _MultiSelectList({ items: FRUITS, selectedIndices: [1, 3] });

        // applyInitialSelection sets anchor = Math.max(...selected) = 3, and
        // getSelectedIndex returns the anchor when it is in the set.
        expect(list.getSelectedIndex()).toBe(3);
    });
});

describe('MultiSelectList — setValues replace semantics', () => {
    it('replaces the prior selection with the rows whose key matches', () => {
        const list = new _MultiSelectList({ items: FRUITS });

        list.setValues(['Apple', 'Cherry']);
        expect(list.getValue()).toEqual(['Apple', 'Cherry']);

        list.setValues(['Elder']);
        // Replace, not union: row 4 only.
        expect(list.getValue()).toEqual(['Elder']);
    });

    it('returns getValue() sorted by row index even when keys arrive out of order', () => {
        const list = new _MultiSelectList({ items: FRUITS });

        list.setValues(['Elder', 'Banana', 'Cherry']);
        // Contract (MultiSelectList.ts:127): keys returned sorted by row order.
        expect(list.getValue()).toEqual(['Banana', 'Cherry', 'Elder']);
    });

    it('parks the anchor at the max selected index', () => {
        const list = new _MultiSelectList({ items: FRUITS });

        list.setValues(['Elder', 'Banana']);
        // anchor = Math.max(1, 4) = 4; getSelectedIndex returns it (in set).
        expect(list.getSelectedIndex()).toBe(4);
    });

    it('selecting nothing leaves an empty selection and a null anchor', () => {
        const list = new _MultiSelectList({ items: FRUITS });

        list.setValues(['nope']);
        expect(list.getValue()).toEqual([]);
        // anchor null → no selection → getSelectedIndex returns -1.
        expect(list.getSelectedIndex()).toBe(-1);
    });

    it('setValues([]) clears the selection', () => {
        const list = new _MultiSelectList({ items: FRUITS, selectedIndices: [0, 2] });

        list.setValues([]);
        expect(list.getValue()).toEqual([]);
        expect(list.getSelectedIndex()).toBe(-1);
    });

    it('setValue delegates to setValues (Bindable alias)', () => {
        const list = new _MultiSelectList({ items: FRUITS });

        list.setValue(['Cherry', 'Apple']);
        expect(list.getValue()).toEqual(['Apple', 'Cherry']);
    });
});

describe('MultiSelectList — reduceSelection plain', () => {
    it('replaces the selection with {idx}, collapsing anchor and focus', () => {
        const list = new TestMultiSelectList({ items: FRUITS });

        list.reduce(0, { ctrl: false, shift: false });
        list.reduce(2, { ctrl: false, shift: false });

        // Plain replaces — only row 2 remains.
        expect(list.getValue()).toEqual(['Cherry']);
        expect(list.getSelectedIndex()).toBe(2);
        expect(list.getFocusedIndex()).toBe(2);
    });
});

describe('MultiSelectList — reduceSelection ctrl-toggle', () => {
    it('toggles membership of idx and moves the anchor to idx', () => {
        const list = new TestMultiSelectList({ items: FRUITS });

        list.reduce(1, { ctrl: true, shift: false });
        list.reduce(3, { ctrl: true, shift: false });
        expect(list.getValue()).toEqual(['Banana', 'Date']);
        // Anchor moved to the most recently toggled row.
        expect(list.getSelectedIndex()).toBe(3);

        // Toggling an already-selected row removes it.
        list.reduce(1, { ctrl: true, shift: false });
        expect(list.getValue()).toEqual(['Date']);
        // Anchor still moves to idx even on removal.
        expect(list.getFocusedIndex()).toBe(1);
    });
});

describe('MultiSelectList — reduceSelection shift-range', () => {
    it('fills the inclusive range from anchor to idx, clearing first without ctrl', () => {
        const list = new TestMultiSelectList({ items: FRUITS });

        // Establish an anchor at row 1.
        list.reduce(1, { ctrl: false, shift: false });
        // Shift across a gap to row 4 selects {1,2,3,4} exactly.
        list.reduce(4, { ctrl: false, shift: true });

        expect(list.getValue()).toEqual(['Banana', 'Cherry', 'Date', 'Elder']);
    });

    it('shift-range fills downward too (anchor above idx)', () => {
        const list = new TestMultiSelectList({ items: FRUITS });

        list.reduce(4, { ctrl: false, shift: false });
        list.reduce(1, { ctrl: false, shift: true });

        expect(list.getValue()).toEqual(['Banana', 'Cherry', 'Date', 'Elder']);
    });

    it('shift+ctrl unions the range onto the existing set', () => {
        const list = new TestMultiSelectList({ items: FRUITS });

        // Ctrl-select row 0 (kept), then anchor at 2, then shift+ctrl to 4.
        list.reduce(0, { ctrl: true, shift: false });
        list.reduce(2, { ctrl: true, shift: false });
        list.reduce(4, { ctrl: true, shift: true });

        // Union: {0} ∪ {2,3,4}.
        expect(list.getValue()).toEqual(['Apple', 'Cherry', 'Date', 'Elder']);
    });

    it('shift with no anchor falls through to plain single-select', () => {
        const list = new TestMultiSelectList({ items: FRUITS });

        // No prior gesture → _anchorIndex is null → the shift branch is skipped.
        list.reduce(3, { ctrl: false, shift: true });

        expect(list.getValue()).toEqual(['Date']);
    });
});

describe('MultiSelectList — selectAll', () => {
    it('selects every row, anchors at 0, focuses the last index', () => {
        const list = new TestMultiSelectList({ items: FRUITS });

        list.all();
        expect(list.getValue()).toEqual(['Apple', 'Banana', 'Cherry', 'Date', 'Elder', 'Fig']);
        // anchor 0 ∈ set → getSelectedIndex returns 0.
        expect(list.getSelectedIndex()).toBe(0);
        expect(list.getFocusedIndex()).toBe(FRUITS.length - 1);
    });

    it('is a no-op on an empty list', () => {
        const list = new TestMultiSelectList({ items: [] });

        list.all();
        expect(list.getValue()).toEqual([]);
        expect(list.getFocusedIndex()).toBe(-1);
    });
});

describe('MultiSelectList — store round-trip', () => {
    const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');
    const SAMPLE = [
        { id: 10, name: 'Alpha' },
        { id: 20, name: 'Beta' },
        { id: 30, name: 'Gamma' },
    ];

    function boundList(): _MultiSelectList {
        const store = new MemoryStore(MODEL, SAMPLE);

        // The MemoryStore constructor only seeds the proxy; loadData()
        // synchronously populates the store's records (and fires `load`).
        // setStore then calls refreshFromStore, populating _items at bind time.
        store.loadData(SAMPLE);

        return new _MultiSelectList({ store, displayField: 'name', valueField: 'id' });
    }

    it('populates items from the bound store', () => {
        const list = boundList();

        expect(list.getItems().map(i => i.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
        expect(list.getItems().map(i => i.key)).toEqual(['10', '20', '30']);
    });

    it('getSelectedRecords returns the records of the selected rows in row order', () => {
        const list = boundList();

        list.setValues(['30', '10']);
        const names = list.getSelectedRecords().map(r => r.get('name'));
        // Row order: row 0 (Alpha, key 10) then row 2 (Gamma, key 30).
        expect(names).toEqual(['Alpha', 'Gamma']);
    });

    it('setSelectedRecords selects the rows whose backing records match', () => {
        const list = boundList();
        const store = list.getStore()!;
        const beta = store.getRecords()[1];
        const gamma = store.getRecords()[2];

        list.setSelectedRecords([gamma, beta]);
        expect(list.getValue()).toEqual(['20', '30']);
    });

    it('getSelectedRecords returns [] when no store is bound', () => {
        const list = new _MultiSelectList({ items: FRUITS });

        list.setValues(['Banana']);
        expect(list.getSelectedRecords()).toEqual([]);
    });
});

describe('MultiSelectList — disabled rows', () => {
    it('programmatic setValues still reaches a disabled row', () => {
        const list = new _MultiSelectList({ items: ROWS });

        list.setValues(['b']);
        expect(list.getValue()).toContain('b');
    });

    it('a Shift-range excludes a disabled row it crosses', () => {
        const list = new TestMultiSelectList({ items: ROWS });

        list.reduce(0, { ctrl: false, shift: false });
        list.reduce(3, { ctrl: false, shift: true });

        expect(list.getValue()).toEqual(['a', 'd']);
    });

    it('Ctrl+A (selectAll) excludes disabled rows', () => {
        const list = new TestMultiSelectList({ items: ROWS });

        list.all();
        expect(list.getValue()).toEqual(['a', 'd', 'e']);
    });
});

describe('MultiSelectList dirty state', () => {
    it('a freshly constructed list with an initial selection is not dirty', () => {
        const list = new _MultiSelectList({ items: FRUITS, selectedIndices: [1, 3] });

        expect(list.getValue()).toEqual(['Banana', 'Date']);
        expect(list.isDirty()).toBe(false);
    });

    it('a plain click that replaces the selection makes it dirty', () => {
        const list = new TestMultiSelectList({ items: FRUITS, selectedIndices: [1, 3] });

        list.click(1, { ctrl: false, shift: false });

        expect(list.getValue()).toEqual(['Banana']);
        expect(list.isDirty()).toBe(true);
    });

    it('ctrl-clicking back to the original selection set clears the dirty flag', () => {
        const list = new TestMultiSelectList({ items: FRUITS, selectedIndices: [1, 3] });

        list.click(1, { ctrl: false, shift: false });
        list.click(3, { ctrl: true, shift: false });

        // Sorted by row order, independent of click order — confirms
        // content-based rather than reference comparison.
        expect(list.getValue()).toEqual(['Banana', 'Date']);
        expect(list.isDirty()).toBe(false);
    });
});
