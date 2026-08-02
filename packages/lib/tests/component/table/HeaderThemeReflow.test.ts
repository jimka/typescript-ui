// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for the header's geometry diff under a theme change. A header cell
// is laid out only when `TableHeader.applyCellGeometry` sees its x/width/height
// change, so a theme that moves a layout input without moving the cell — the
// table cell's padding feeds the renderer's insets — has to invalidate the
// diff, or the label stays where the old theme put it.
//
// The header drops its records from a theme subscription; the cells are
// re-fitted by the next layout pass, since `renderColumnWindow` only ever runs
// from one. These tests therefore drive that pass explicitly — the frame the
// root schedules off its own theme subscription is mocked out here, so relying
// on it would test the mock rather than the header.
//
// Kept in its own file, like `TextThemeReflow.test.ts`, because
// `ThemeManager.setTheme` synchronously fires every listener still registered
// in the process, which makes these tests sensitive to cross-test pollution
// from an undisposed theme-subscribing component built elsewhere in the suite.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Body } from '~/core/Body';
import { Fit } from '~/layout/Fit';
import { Table } from '~/component/table/Table';
import type { HeaderCell } from '~/component/table/cell/Header';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { ThemeManager, ModernTheme } from '~/core/Theme';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let frames: Array<FrameRequestCallback>;

beforeEach(() => {
    installTestDOM(CONFIG);
    frames = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });
});

afterEach(() => {
    // Theme state is module-level; restore it even if an assertion above fails.
    flushFrame();
    ThemeManager.setTheme(ModernTheme);
    vi.restoreAllMocks();
    DOM.reset();
});

/** Invokes every animation-frame callback captured since the last flush (the layout pass). */
function flushFrame(): void {
    const pending = frames;
    frames = [];
    for (const cb of pending) {
        cb(0);
    }
}

/** ModernTheme with a different table-cell padding, which drives the header cell's renderer insets. */
function paddedTheme(padding: number) {
    return {
        ...ModernTheme,
        table: {
            ...ModernTheme.table,
            cell: { ...ModernTheme.table.cell, padding },
        },
    };
}

function labelX(cell: HeaderCell): number {
    return (cell.getRenderer() as unknown as { getText(): { getX(): number } }).getText().getX();
}

async function singleColumnTable(): Promise<Table> {
    const store = new MemoryStore(new Model([{ name: 'c0', type: 'string' }], 'c0'), []);
    await store.load();

    return new Table(store);
}

describe('Header column window — theme reflow', () => {
    it('drops its geometry records so the next pass re-lays-out at unchanged geometry', async () => {
        const table = await singleColumnTable();
        table.getElement(true);

        const geometry = {
            columnWidths:    [100],
            viewportWidth:   250,
            columnHeight:    20,
            parentRowHeight: 0,
        };

        table.getHeader().renderColumnWindow(geometry);

        const cell   = table.getHeader().getColumns()[0] as HeaderCell;
        const before = labelX(cell);

        ThemeManager.setTheme(paddedTheme(ModernTheme.table.cell.padding + 8));

        // Deliberately the *same* geometry: without the records being dropped
        // this pass would skip the cell and the label would not move.
        table.getHeader().renderColumnWindow(geometry);

        expect(labelX(cell)).toBe(before + 8);
    });

    it('drops the records for parent-row cells too', async () => {
        const store = new MemoryStore(new Model([
            { name: 'c0', type: 'string' },
            { name: 'c1', type: 'string' },
        ], 'c0'), []);
        await store.load();

        const table = new Table(store, {
            columns: [{ field: 'c0', group: 'G' }, { field: 'c1', group: 'G' }],
        });
        table.getElement(true);

        const geometry = {
            columnWidths:    [100, 100],
            viewportWidth:   500,
            columnHeight:    20,
            parentRowHeight: 20,
        };

        table.getHeader().renderColumnWindow(geometry);

        // The parent row shares `applyCellGeometry`, so its cells are recorded
        // and skipped on the same terms as the column row's.
        const parent  = table.getHeader().getParentRow().getComponents()[0];
        let   layouts = 0;
        parent.doLayout = () => { layouts++; return parent; };

        ThemeManager.setTheme(paddedTheme(ModernTheme.table.cell.padding + 8));
        table.getHeader().renderColumnWindow(geometry);

        expect(layouts).toBe(1);
    });

    it('is re-fitted by the next full layout pass, mounted in the real Body', async () => {
        const table = await singleColumnTable();

        Body.init({ layoutManager: new Fit(), components: [table] });

        // The first layout is held pending font activation; `flushLayout` is
        // the documented synchronous bypass.
        Body.getInstance().flushLayout();

        const cell   = table.getHeader().getColumns()[0] as HeaderCell;
        const before = labelX(cell);

        ThemeManager.setTheme(paddedTheme(ModernTheme.table.cell.padding + 8));

        // Nothing has moved yet, because the frame that would carry the pass is
        // mocked out here. Asserted so the flush below is doing the work rather
        // than confirming something that had already happened.
        expect(labelX(cell)).toBe(before);

        Body.getInstance().flushLayout();

        expect(labelX(cell)).toBe(before + 8);
    });
});
