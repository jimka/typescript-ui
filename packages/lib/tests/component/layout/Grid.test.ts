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

describe('Grid baselineAlign preferred size reserves the baseline spread', () => {
    afterEach(() => DOM.reset());

    // A baseline-aligned row's height is `max(tallestCell, rowAscent + rowDescent)`:
    // when two cells share a height but sit on different baselines, aligning them
    // needs the highest ascent PLUS the deepest descent, which exceeds the tallest
    // cell. doLayout accounts for that spread; getPreferredSize / getMinSize must
    // report the same, or a parent sizes the grid too short and doLayout overflows
    // the box it was given.
    it('does not lay content out past the grid preferred height', () => {
        installTestDOM(CONFIG);

        const grid = new Grid({
            baselineAlign: true,
            columns:       2,
            rows:          1,
            spacing:       0,
            rowTracks:     [{ mode: 'content' }],
            columnTracks:  [{ mode: 'content' }, { mode: 'weight', value: 1 }],
        });

        // Two equal-height cells with mismatched baselines: ascent 13 from the
        // first, descent 13 (16 − 3) from the second → a 26px baseline spread,
        // 10px taller than either 16px cell.
        const high = new Component({ preferredSize: { width: 10, height: 16 } });
        const low  = new Component({ preferredSize: { width: 10, height: 16 } });
        high.getBaseline = () => 13;
        low.getBaseline  = () => 3;

        const host = new Container({ layoutManager: grid });
        host.getElement(true);
        host.clearInsets();
        host.addComponent(high);
        host.addComponent(low);

        const pref = grid.getPreferredSize()!;

        // The reported preferred height must cover the baseline spread doLayout
        // reserves — not just the tallest cell.
        expect(pref.height).toBe(26);

        // Sizing the host to that preferred height, no cell may overflow it.
        host.setWidth(pref.width);
        host.setHeight(pref.height);
        host.doLayout();

        const inner = host.getInnerSize()!;

        for (const cell of [high, low]) {
            expect(cell.getY() + cell.getHeight()).toBeLessThanOrEqual(inner.height);
        }
    });
});

describe('Grid overflow inflation', () => {
    afterEach(() => DOM.reset());

    // A single-column grid so every child spans the full working width. The
    // observed child carries a small min; a wide sibling drives
    // computeTotalMinSize's width (max child min) past the narrow host, so the
    // observed width reflects the manager's inflation rather than the observed
    // child's own min-clamp.
    function hostWithWideSibling(): { grid: Grid; observed: Component } {
        installTestDOM(CONFIG);
        const grid = new Grid({ rows: 2, columns: 1 });
        const host = hostGrid(100, 300, grid); // narrow host
        const observed = new Component({ preferredSize: { width: 50, height: 50 } });
        observed.setMinSize({ width: 50, height: 10 });
        const wide = new Component({ preferredSize: { width: 50, height: 50 } });
        wide.setMinSize({ width: 300, height: 10 }); // drives totalMin width
        host.addComponent(observed);
        host.addComponent(wide);
        return { grid, observed };
    }

    it('inflates the working width to the total min width when the host marks X overflowing', () => {
        const { grid, observed } = hostWithWideSibling();
        grid.setOverflowing(true, false);
        grid.getContainer()!.doLayout();
        expect(observed.getWidth()).toBe(300); // inflated to totalMin width (from the wide sibling)
    });

    it('does not inflate — child fills the container width — when X overflow is off', () => {
        const { grid, observed } = hostWithWideSibling();
        grid.setOverflowing(false, false);
        grid.getContainer()!.doLayout();
        expect(observed.getWidth()).toBe(100); // container width, not the 300 totalMin
    });
});
