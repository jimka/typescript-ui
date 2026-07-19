// ChartLegend composition: setEntries builds one row per entry; the toggle
// event fires with the clicked row's index (click routing is exercised via the
// white-box emit seam, since real hit-testing is a manual-verify).
import { describe, it, expect } from 'vitest';
import { _ChartLegend } from '~/component/chart/ChartLegend';

/** White-box subclass exposing the protected emit so toggle fan-out is testable. */
class TestLegend extends _ChartLegend {
    public fireToggle(index: number): void {
        this.emit('toggle', index);
    }
}

describe('ChartLegend.setEntries', () => {
    it('builds one row per entry', () => {
        const legend = new _ChartLegend();

        legend.setEntries([
            { name: 'Alpha', color: '#f00' },
            { name: 'Beta', color: '#0f0' },
            { name: 'Gamma', color: '#00f' },
        ]);

        expect(legend.getComponents().length).toBe(3);
    });

    it('replaces prior rows on a subsequent setEntries', () => {
        const legend = new _ChartLegend();

        legend.setEntries([{ name: 'A', color: '#111' }, { name: 'B', color: '#222' }]);
        legend.setEntries([{ name: 'Solo', color: '#333' }]);

        expect(legend.getComponents().length).toBe(1);
        expect(legend.getEntries().map((e) => e.name)).toEqual(['Solo']);
    });

    it('accepts entries and orientation through the options bag', () => {
        const legend = new _ChartLegend({
            orientation: 'horizontal',
            entries: [{ name: 'X', color: '#abc' }],
        });

        expect(legend.getOrientation()).toBe('horizontal');
        expect(legend.getComponents().length).toBe(1);
    });

    it('is a no-op re-apply with fresh but value-equal entries (idempotency guard)', () => {
        const legend = new _ChartLegend();

        legend.setEntries([{ name: 'A', color: '#111' }, { name: 'B', color: '#222' }]);

        const firstRow = legend.getComponents()[0];

        legend.setEntries([{ name: 'A', color: '#111' }, { name: 'B', color: '#222' }]);

        expect(legend.getComponents()[0]).toBe(firstRow);
        expect(legend.getComponents().length).toBe(2);
    });

    it('rebuilds when only the effective hidden state flips', () => {
        const legend = new _ChartLegend();

        legend.setEntries([{ name: 'A', color: '#111' }]);

        const firstRow = legend.getComponents()[0];

        legend.setEntries([{ name: 'A', color: '#111', hidden: true }]);

        expect(legend.getComponents()[0]).not.toBe(firstRow);
    });
});

describe('ChartLegend toggle event', () => {
    it('fires registered toggle listeners with the series index', () => {
        const legend = new TestLegend();
        const seen: number[] = [];
        const onToggle = (i: number): void => { seen.push(i); };

        legend.on('toggle', onToggle);
        legend.fireToggle(2);

        expect(seen).toEqual([2]);
    });

    it('stops firing after off()', () => {
        const legend = new TestLegend();
        const seen: number[] = [];
        const onToggle = (i: number): void => { seen.push(i); };

        legend.on('toggle', onToggle);
        legend.off('toggle', onToggle);
        legend.fireToggle(1);

        expect(seen).toEqual([]);
    });

    it('wires a construction-time toggle listener from the options bag', () => {
        const seen: number[] = [];
        const legend = new TestLegend({ listeners: { toggle: (i) => seen.push(i) } });

        legend.fireToggle(5);

        expect(seen).toEqual([5]);
    });
});
