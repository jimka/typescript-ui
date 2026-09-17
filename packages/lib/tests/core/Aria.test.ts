import { describe, it, expect, afterEach } from 'vitest';
import { Aria } from '~/core/Aria';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// Every getter reads Aria's own cache, so round-trips need no materialised DOM.
const aria = (): Aria => new Component().getAria();

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

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

describe('Aria — unchanged writes are skipped', () => {
    afterEach(() => DOM.reset());

    /** Every recorded `apply` patch on `element` that sets `aria-hidden`. */
    function hiddenWrites(sink: { writes: Array<{ op: string; args: unknown[] }> }, element: unknown): Array<string> {
        return sink.writes
            .filter(w => w.op === 'apply' && w.args[0] === element)
            .map(w => (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.['aria-hidden'])
            .filter((value): value is string => value !== undefined);
    }

    it('a repeated setter with the same value writes nothing', () => {
        const sink = installTestDOM(CONFIG);
        const c = new Component();

        c.getElement(true);

        const element = c.getElement()!;

        c.getAria().setHidden(true);
        c.getAria().setHidden(true);

        expect(hiddenWrites(sink, element)).toEqual(['true']);
        expect(c.getAria().getHidden()).toBe(true);
    });

    it('a changed value writes', () => {
        const sink = installTestDOM(CONFIG);
        const c = new Component();

        c.getElement(true);

        const element = c.getElement()!;

        c.getAria().setHidden(true);
        c.getAria().setHidden(false);

        expect(hiddenWrites(sink, element)).toEqual(['true', 'false']);
    });

    /** Every recorded `apply` patch on `element` that removes `aria-label`. */
    function labelRemovals(sink: { writes: Array<{ op: string; args: unknown[] }> }, element: unknown): number {
        return sink.writes
            .filter(w => w.op === 'apply' && w.args[0] === element)
            .filter(w => (w.args[1] as { removeAttr?: string[] }).removeAttr?.includes('aria-label'))
            .length;
    }

    it('clearLabel writes nothing when no label was ever set, and nothing again once cleared', () => {
        const sink = installTestDOM(CONFIG);
        const c = new Component();

        c.getElement(true);

        const element = c.getElement()!;

        c.getAria().clearLabel();

        expect(labelRemovals(sink, element)).toBe(0);

        c.getAria().setLabel('Close');
        c.getAria().clearLabel();

        expect(labelRemovals(sink, element)).toBe(1);
        expect(c.getAria().getLabel()).toBeNull();

        c.getAria().clearLabel();

        expect(labelRemovals(sink, element)).toBe(1);
    });

    it('a value set again after a removal writes', () => {
        const sink = installTestDOM(CONFIG);
        const c = new Component();

        c.getElement(true);

        const element = c.getElement()!;

        c.getAria().setExpanded(true);
        c.getAria().setExpanded(null);
        c.getAria().setExpanded(true);

        const patches = sink.writes.filter(w => w.op === 'apply' && w.args[0] === element);
        const expandedSets = patches
            .map(w => (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.['aria-expanded'])
            .filter((value): value is string => value !== undefined);
        const expandedRemoves = patches.filter(w =>
            (w.args[1] as { removeAttr?: string[] }).removeAttr?.includes('aria-expanded'));

        expect(expandedSets).toEqual(['true', 'true']);
        expect(expandedRemoves.length).toBe(1);
    });
});
