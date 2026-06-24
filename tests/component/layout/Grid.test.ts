import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Grid } from '~/layout/Grid';
import { FillType } from '~/layout/FillType';
import { AnchorType } from '~/layout/AnchorType';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function hostGrid(width: number, height: number, grid: Grid): Container {
    const host = new Container({ layoutManager: grid });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('Grid setters/getters', () => {
    it('round-trips rows / columns / spacing', () => {
        const grid = new Grid({ rows: 2, columns: 3, spacing: 7 });

        expect(grid.getRows()).toBe(2);
        expect(grid.getColumns()).toBe(3);
        expect(grid.getComponentSpacing()).toBe(7);
    });

    it('defaults fill to BOTH and anchor to CENTER, and round-trips them', () => {
        const grid = new Grid();

        expect(grid.getDefaultFill()).toBe(FillType.BOTH);
        expect(grid.getDefaultAnchor()).toBe(AnchorType.CENTER);

        grid.setDefaultFill(FillType.NONE);
        grid.setDefaultAnchor(AnchorType.NORTHWEST);

        expect(grid.getDefaultFill()).toBe(FillType.NONE);
        expect(grid.getDefaultAnchor()).toBe(AnchorType.NORTHWEST);
    });

    it('defaults baselineAlign to false and round-trips it', () => {
        const grid = new Grid();

        expect(grid.isBaselineAlign()).toBe(false);

        grid.setBaselineAlign(true);

        expect(grid.isBaselineAlign()).toBe(true);
    });

    it('round-trips columnTracks / rowTracks', () => {
        const tracks = [{ mode: 'fixed' as const, value: 50 }];
        const grid = new Grid({ columnTracks: tracks });

        expect(grid.getColumnTracks()).toEqual(tracks);
        expect(grid.getRowTracks()).toEqual([]);
    });

    it('doLayout() does not throw without a container', () => {
        expect(() => new Grid().doLayout()).not.toThrow();
    });
});

describe('Grid getColRowCount inference', () => {
    afterEach(() => DOM.reset());

    it('derives rows from a fixed column count and child count (ceil)', () => {
        installTestDOM(CONFIG);

        const grid = new Grid({ columns: 2 });
        const host = hostGrid(200, 200, grid);

        for (let i = 0; i < 5; i += 1) {
            host.addComponent(new Component({ preferredSize: { width: 10, height: 10 } }));
        }

        // 5 children / 2 columns => ceil(5/2) = 3 rows.
        const count = grid.getColRowCount()!;

        expect(count.width).toBe(2);  // columns
        expect(count.height).toBe(3); // rows
    });
});

describe('Grid placement geometry', () => {
    afterEach(() => DOM.reset());

    it('fills children row-major and splits the inner width into equal cells', () => {
        installTestDOM(CONFIG);

        const grid = new Grid({ columns: 2, spacing: 10 });
        const host = hostGrid(220, 200, grid);
        const a = new Component({ preferredSize: { width: 10, height: 10 } });
        const b = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(a);
        host.addComponent(b);

        const inner = host.getInnerSize()!;
        const spacing = 10;
        const expectedCell = (inner.width - spacing) / 2;

        host.doLayout();

        // Equal partition: each cell ~ (inner - spacing) / cols.
        expect(a.getWidth()).toBeCloseTo(expectedCell, 5);
        expect(b.getWidth()).toBeCloseTo(expectedCell, 5);

        // Row-major: child 0 in column 0, child 1 in column 1 of the same row.
        expect(a.getX()).toBe(0);
        expect(a.getY()).toBe(0);
        expect(b.getY()).toBe(0); // same row
        // Column 1 starts after column 0's width + spacing.
        expect(b.getX()).toBeCloseTo(expectedCell + spacing, 5);
    });
});
