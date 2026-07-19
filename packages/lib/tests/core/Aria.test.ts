import { describe, it, expect, vi } from 'vitest';
import { Aria } from '~/core/Aria';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';

// Every getter reads Aria's own cache, so round-trips need no materialised DOM.
// The single seam-touching case is applyToElement, whose contract is "flush all
// cached state onto the element" — asserted by spying the sink's apply payload,
// since the modelled source's getAttribute is a null stub offline.
const aria = (): Aria => new Component().getAria();

describe('Aria — role & tabindex', () => {
    it('setRole/getRole round-trip; getRole defaults null', () => {
        const a = aria();
        expect(a.getRole()).toBeNull();
        a.setRole('grid');
        expect(a.getRole()).toBe('grid');
    });
    it('setTabIndex(0|-1) round-trips; setTabIndex(null) clears', () => {
        const a = aria();
        expect(a.getTabIndex()).toBeNull();
        a.setTabIndex(0);
        expect(a.getTabIndex()).toBe(0);
        a.setTabIndex(-1);
        expect(a.getTabIndex()).toBe(-1);
        a.setTabIndex(null);
        expect(a.getTabIndex()).toBeNull();
    });
});

describe('Aria — boolean attributes', () => {
    const cases: [keyof Aria, (a: Aria) => boolean | null][] = [
        ['setSelected',        a => a.getSelected()],
        ['setHidden',          a => a.getHidden()],
        ['setMultiselectable', a => a.getMultiselectable()],
        ['setDisabled',        a => a.getDisabled()],
        ['setPressed',         a => a.getPressed()],
        ['setReadOnly',        a => a.getReadOnly()],
    ];
    for (const [setter, getter] of cases) {
        it(`${String(setter)} round-trips and defaults null`, () => {
            const a = aria();
            expect(getter(a)).toBeNull();
            (a[setter] as (v: boolean) => Aria)(true);
            expect(getter(a)).toBe(true);
            (a[setter] as (v: boolean) => Aria)(false);
            expect(getter(a)).toBe(false);
        });
    }
    it('setExpanded(true|false|null) round-trips and defaults null', () => {
        const a = aria();
        expect(a.getExpanded()).toBeNull();
        a.setExpanded(true);
        expect(a.getExpanded()).toBe(true);
        a.setExpanded(false);
        expect(a.getExpanded()).toBe(false);
    });
});

describe('Aria — checked (tri-state)', () => {
    it('setChecked(true|false) yields a boolean', () => {
        const a = aria();
        expect(a.getChecked()).toBeNull();
        a.setChecked(true);
        expect(a.getChecked()).toBe(true);
        a.setChecked(false);
        expect(a.getChecked()).toBe(false);
    });
    it("setChecked('mixed') preserves the 'mixed' string", () => {
        const a = aria();
        a.setChecked('mixed');
        expect(a.getChecked()).toBe('mixed');
    });
});

describe('Aria — valueMin / valueMax null-delete', () => {
    it('setValueMin(n)/setValueMax(n) round-trip; null deletes (getter null)', () => {
        const a = aria();
        a.setValueMin(1);
        a.setValueMax(10);
        expect(a.getValueMin()).toBe(1);
        expect(a.getValueMax()).toBe(10);
        a.setValueMin(null);
        a.setValueMax(null);
        expect(a.getValueMin()).toBeNull();
        expect(a.getValueMax()).toBeNull();
    });
});

describe('Aria — numeric attributes', () => {
    const cases: [keyof Aria, (a: Aria) => number | null][] = [
        ['setRowIndex', a => a.getRowIndex()],
        ['setColIndex', a => a.getColIndex()],
        ['setLevel',    a => a.getLevel()],
        ['setSetSize',  a => a.getSetSize()],
        ['setPosInSet', a => a.getPosInSet()],
        ['setValueNow', a => a.getValueNow()],
    ];
    for (const [setter, getter] of cases) {
        it(`${String(setter)} stores and returns its number`, () => {
            const a = aria();
            expect(getter(a)).toBeNull();
            (a[setter] as (v: number) => Aria)(7);
            expect(getter(a)).toBe(7);
        });
    }
});

describe('Aria — enum attributes', () => {
    it('round-trip the given value', () => {
        const a = aria();
        a.setSort('ascending');
        a.setLive('polite');
        a.setOrientation('vertical');
        a.setHasPopup('menu');
        a.setAutoComplete('list');
        expect(a.getSort()).toBe('ascending');
        expect(a.getLive()).toBe('polite');
        expect(a.getOrientation()).toBe('vertical');
        expect(a.getHasPopup()).toBe('menu');
        expect(a.getAutoComplete()).toBe('list');
    });
});

describe('Aria — label', () => {
    it('setLabel/getLabel round-trip; clearLabel returns getter to null', () => {
        const a = aria();
        expect(a.getLabel()).toBeNull();
        a.setLabel('Close');
        expect(a.getLabel()).toBe('Close');
        a.clearLabel();
        expect(a.getLabel()).toBeNull();
    });
});

describe('Aria — applyToElement flush', () => {
    it('flushes role, tabindex, and aria-* attributes onto the element via the sink', () => {
        const c = new Component();
        const a = c.getAria();
        a.setRole('grid');
        a.setTabIndex(0);
        a.setSelected(true);

        const el = c.getElement(true)!;           // materialise first
        const applySpy = vi.spyOn(DOM.sink, 'apply');

        a.applyToElement(el);

        expect(applySpy).toHaveBeenCalled();
        const payload = applySpy.mock.calls.at(-1)![1] as { setAttr: Record<string, string> };
        expect(payload.setAttr).toMatchObject({
            role: 'grid',
            tabindex: '0',
            'aria-selected': 'true',
        });
    });
});
