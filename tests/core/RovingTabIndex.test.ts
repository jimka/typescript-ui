import { describe, it, expect } from 'vitest';
import { RovingTabIndex } from '~/core/RovingTabIndex';
import { Component } from '~/core/Component';

// The tabindex bookkeeping lives in each item's Aria cache; reading it needs no
// materialised DOM. moveTo() also calls Component.focus(), which is a safe no-op
// while the element is not in the DOM — so the *focus movement* is manual-verify,
// but the tabindex/active-index accounting asserted here is fully offline.

function group(count: number): { g: RovingTabIndex; items: Component[] } {
    const g = new RovingTabIndex();
    const items: Component[] = [];
    for (let i = 0; i < count; i++) {
        const c = new Component();
        items.push(c);
        g.add(c);
    }
    return { g, items };
}

const tabIndices = (g: RovingTabIndex): (number | null)[] =>
    g.getItems().map(c => c.getAria().getTabIndex());
const zeroCount = (g: RovingTabIndex): number =>
    tabIndices(g).filter(t => t === 0).length;

describe('RovingTabIndex — add', () => {
    it('gives the first item tabindex 0 and every later item tabindex -1', () => {
        const { g } = group(3);
        expect(tabIndices(g)).toEqual([0, -1, -1]);
    });
    it('starts active index at 0 and returns items in add order', () => {
        const { g, items } = group(3);
        expect(g.getActiveIndex()).toBe(0);
        expect(g.getItems()).toEqual(items);
    });
});

describe('RovingTabIndex — moveTo', () => {
    it('sets the previous active to -1, the new active to 0, and updates active index', () => {
        const { g } = group(3);
        g.moveTo(2);
        expect(g.getActiveIndex()).toBe(2);
        expect(tabIndices(g)).toEqual([-1, -1, 0]);
    });
    it('clamps an out-of-range index into [0, length-1]', () => {
        const { g } = group(3);
        g.moveTo(99);
        expect(g.getActiveIndex()).toBe(2);
        g.moveTo(-5);
        expect(g.getActiveIndex()).toBe(0);
    });
    it('leaves exactly one item at tabindex 0 when re-selecting the current index', () => {
        const { g } = group(3);
        g.moveTo(0); // same as current active
        expect(g.getActiveIndex()).toBe(0);
        expect(zeroCount(g)).toBe(1);
        expect(tabIndices(g)).toEqual([0, -1, -1]);
    });
});

describe('RovingTabIndex — moveNext / movePrev', () => {
    it('moveNext advances and wraps from last back to first', () => {
        const { g } = group(3);
        g.moveNext();
        expect(g.getActiveIndex()).toBe(1);
        g.moveTo(2);
        g.moveNext();
        expect(g.getActiveIndex()).toBe(0); // wrapped
    });
    it('movePrev retreats and wraps from first back to last', () => {
        const { g } = group(3);
        g.movePrev();
        expect(g.getActiveIndex()).toBe(2); // wrapped
        g.movePrev();
        expect(g.getActiveIndex()).toBe(1);
    });
});

describe('RovingTabIndex — empty group', () => {
    it('moveTo / moveNext / movePrev are no-ops that do not throw', () => {
        const g = new RovingTabIndex();
        expect(() => { g.moveTo(0); g.moveNext(); g.movePrev(); }).not.toThrow();
        expect(g.getActiveIndex()).toBe(0);
        expect(g.getItems()).toEqual([]);
    });
});

describe('RovingTabIndex — remove', () => {
    it('removing a non-active item before the active index keeps the same item active', () => {
        const { g, items } = group(4);
        g.moveTo(2);                       // items[2] active
        g.remove(items[0]);                // idx 0 < active 2
        expect(g.getActiveIndex()).toBe(1);
        expect(g.getItems()[1]).toBe(items[2]);   // same item still active
        expect(items[2].getAria().getTabIndex()).toBe(0);
        expect(zeroCount(g)).toBe(1);
    });
    it('removing a non-active item after the active index leaves the active index unchanged', () => {
        const { g, items } = group(3);     // active 0
        g.remove(items[2]);                // idx 2 > active 0
        expect(g.getActiveIndex()).toBe(0);
        expect(items[0].getAria().getTabIndex()).toBe(0);
        expect(zeroCount(g)).toBe(1);
    });
    it('removing the active item moves active to max(0, idx-1)', () => {
        const { g, items } = group(3);
        g.moveTo(1);                       // items[1] active
        g.remove(items[1]);                // remove active
        expect(g.getActiveIndex()).toBe(0);
        expect(g.getItems()[0]).toBe(items[0]);
        expect(items[0].getAria().getTabIndex()).toBe(0);
        expect(zeroCount(g)).toBe(1);
    });
    it('removing the last remaining item resets active index to 0', () => {
        const { g, items } = group(1);
        g.remove(items[0]);
        expect(g.getActiveIndex()).toBe(0);
        expect(g.getItems()).toEqual([]);
    });
    it('removing an item not in the group is a no-op', () => {
        const { g } = group(2);
        const stranger = new Component();
        expect(() => g.remove(stranger)).not.toThrow();
        expect(g.getItems()).toHaveLength(2);
        expect(g.getActiveIndex()).toBe(0);
    });
});
