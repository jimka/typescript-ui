import { describe, it, expect, afterEach } from 'vitest';
import { RovingTabIndex } from '~/core/RovingTabIndex';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

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
    it('marks every member with data-ts-ui-roving-member, active or not', () => {
        const { items } = group(3);
        for (const item of items) {
            expect(item.getDataAttribute('ts-ui-roving-member')).toBe('true');
        }
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
    it('clears data-ts-ui-roving-member from a removed item', () => {
        const { g, items } = group(3);
        g.remove(items[1]);
        expect(items[1].getDataAttribute('ts-ui-roving-member')).toBeUndefined();
        expect(items[0].getDataAttribute('ts-ui-roving-member')).toBe('true');
        expect(items[2].getDataAttribute('ts-ui-roving-member')).toBe('true');
    });
});

// The same-index early return — see
// plans/implemented/component-setter-guards.md. `moveTo` is reached both from
// a tab press (whose target is often already active) and from `remove`, which
// calls it after splicing the list; the tabindex half of the guard is what
// keeps those two apart.
describe('RovingTabIndex — repeat activation', () => {
    const CONFIG = {
        rootMountOffset: { x: 0, y: 0 },
        viewport:        { width: 1280, height: 800 },
        scrollBarWidth:  15,
        fontMetrics,
        themeVars:       {},
    };

    afterEach(() => DOM.reset());

    /** A materialised group, so `moveTo`'s aria and focus writes reach the recording sink. */
    function renderedGroup(count: number): { g: RovingTabIndex; items: Component[] } {
        const built = group(count);

        for (const item of built.items) {
            item.getElement(true);
        }

        return built;
    }

    it('re-activating the already-active item writes nothing and moves no focus', () => {
        const sink = installTestDOM(CONFIG);
        const { g } = renderedGroup(3);

        sink.writes.length = 0;

        g.moveTo(0);
        g.moveTo(0);
        g.moveTo(0);

        expect(sink.writes).toHaveLength(0);
        expect(g.getActiveIndex()).toBe(0);
        expect(zeroCount(g)).toBe(1);
    });

    it('still focuses and re-points the tabindex for a genuinely different index', () => {
        const sink = installTestDOM(CONFIG);
        const { g } = renderedGroup(3);

        sink.writes.length = 0;

        g.moveTo(2);

        expect(sink.writes.filter(w => w.op === 'focus')).toHaveLength(1);
        expect(tabIndices(g)).toEqual([-1, -1, 0]);
    });

    it('re-points the tabindex onto the item that slides into the active slot', () => {
        const { g, items } = group(3);

        // `remove` splices then calls moveTo(max(0, idx - 1)) — here moveTo(0)
        // while `_activeIndex` is still 0, but with a *different* component now
        // sitting at index 0, still carrying -1. An index-only guard would
        // leave the group with no tabbable member at all.
        g.remove(items[0]);

        expect(g.getItems()[0]).toBe(items[1]);
        expect(items[1].getAria().getTabIndex()).toBe(0);
        expect(zeroCount(g)).toBe(1);
    });
});
