// Offline coverage for plans/in-progress/table-column-visibility-menu.md's
// `## Expected Behaviour` — moving Table's header context-menu per-column
// toggles off the top level into a submenu (<= 20 resolved columns) or a
// modal dialog (> 20). Test numbers in each `it()` name match the plan's
// `## Expected Behaviour` list. Mirrors TabBar.contextMenu.test.ts's
// openMenuFor/labels helpers and ColumnFilterRow.test.ts's
// capturedMenuItems stub.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import { _Checkbox as Checkbox } from '~/component/input/Checkbox';
import { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { _Text as Text } from '~/component/input/Text';
import { _HBox as HBox } from '~/layout/HBox';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnConfig, ColumnSpec } from '~/component/table/ColumnConfig';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import type { Component } from '~/core/Component';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));

// Rows built via a `row:` factory (the Filter row and each field row) wire
// window-level click/mouseover/mouseout listeners in their constructor and
// must be disposed before DOM.reset(), or a leaked row leaves the type
// marked installed against a discarded sink and the next test's dispatch
// silently finds no handler (see MenuRow.test.ts's afterEach comment).
// afterEach hooks run in reverse registration order, so this is declared
// after DOM.reset()'s to run before it.
let builtRows: Array<InstanceType<typeof CheckboxMenuRow>> = [];

// Every Table built by `makeTable` carries per-column ResizeHandles, each
// wiring its own "click" listener; left undisposed (as every case here did
// before `toggle()` existed, since no case ever dispatched a real click) it
// keeps "click" permanently marked installed against that test's now-discarded
// sink, so a later test's `toggle()` dispatch silently finds no handler — the
// exact "click"/"submit" gotcha documented in Form.test.ts's `disposeForm`.
// Disposing here is idempotent even for the case (20) that already disposes
// its own table.
let builtTables: Table[] = [];

afterEach(() => DOM.reset());
afterEach(() => {
    for (const row of builtRows) {
        row.dispose();
    }
    builtRows = [];

    for (const table of builtTables) {
        table.dispose();
    }
    builtTables = [];
});

// The submenu's indent: four literal U+00A0 non-breaking spaces (see
// Table.ts's GROUP_INDENT).
const NBSP = '    ';

/** Builds an n-field string Model, `col0`..`col{n-1}`, in field order. */
function wideModel(n: number): Model {
    const fields = Array.from({ length: n }, (_, i) => ({ name: `col${i}`, type: 'string' as const, order: i }));

    return new Model(fields, 'col0');
}

/** Builds a laid-out Table over `model`/`spec` (no records needed — the menu never reads them). */
async function makeTable(model: Model, spec?: ColumnSpec): Promise<Table> {
    const store = new MemoryStore(model, []);
    await store.load();

    const table = new Table(store, spec);
    table.getElement(true);
    table.setWidth(600);
    table.setHeight(400);
    table.doLayout();

    builtTables.push(table);

    return table;
}

/** A laid-out Table with `n` resolved columns and no spec. */
function wideTable(n: number): Promise<Table> {
    return makeTable(wideModel(n));
}

// A 10-field fixture matching the plan's `## Internal Structure` worked
// example verbatim (field names, groups, `unhideable`, `hidden`) so item
// 10's expected array can be asserted against the plan's own literal text.
const GROUPED_FIELDS = [
    { name: 'Name',     type: 'string' as const, order: 0 },
    { name: 'Active',   type: 'string' as const, order: 1 },
    { name: 'Score',    type: 'string' as const, order: 2 },
    { name: 'Role',     type: 'string' as const, order: 3 },
    { name: 'Joined',   type: 'string' as const, order: 4 },
    { name: 'Meeting',  type: 'string' as const, order: 5 },
    { name: 'LastSeen', type: 'string' as const, order: 6 },
    { name: 'Manager',  type: 'string' as const, order: 7 },
    { name: 'Notes',    type: 'string' as const, order: 8 },
    { name: 'locked',   type: 'string' as const, order: 9 },
];

const GROUPED_SPEC: ColumnSpec = {
    columns: [
        { field: 'Name',     group: 'Identity', unhideable: true },
        { field: 'Active',   group: 'Identity' },
        { field: 'Score' },
        { field: 'Role' },
        { field: 'Joined',   group: 'Activity' },
        { field: 'Meeting',  group: 'Activity' },
        { field: 'LastSeen', group: 'Activity' },
        { field: 'Manager' },
        { field: 'Notes',    hidden: true },
        { field: 'locked',   hidden: true },
    ],
};

function groupedTable(): Promise<Table> {
    return makeTable(new Model(GROUPED_FIELDS, 'Name'), GROUPED_SPEC);
}

/**
 * The grouped fixture extended with `extraCount` extra ungrouped columns, so
 * the resolved column count crosses the 20-column dialog threshold while
 * keeping the same grouped-run shape for the dialog's Text-header coverage.
 */
async function wideGroupedTable(extraCount: number): Promise<Table> {
    const extraFields  = Array.from({ length: extraCount }, (_, i) => ({ name: `Extra${i}`, type: 'string' as const, order: 10 + i }));
    const extraColumns: ColumnConfig[] = extraFields.map(f => ({ field: f.name }));

    return makeTable(
        new Model([...GROUPED_FIELDS, ...extraFields], 'Name'),
        { columns: [...GROUPED_SPEC.columns, ...extraColumns] },
    );
}

/** Invokes the private `showColumnMenu`, capturing the items it builds. */
function capturedMenuItems(table: Table, x = 0, y = 0): MenuItemConfig[] {
    const captured: { items?: MenuItemConfig[] } = {};

    (table as any)._columnContextMenu.show = (_x: number, _y: number, items: MenuItemConfig[]) => {
        captured.items = items;
    };

    (table as any).showColumnMenu(x, y);

    return captured.items!;
}

/** Calls a `row:` factory, recording the built row for teardown in `afterEach`. */
function buildRow(config: MenuItemConfig): InstanceType<typeof CheckboxMenuRow> {
    const row = config.row!() as InstanceType<typeof CheckboxMenuRow>;

    builtRows.push(row);

    return row;
}

// Named apart from the dialog-row `rowLabel` below (which prefixes
// 'H:'/'C:' for a Text/Checkbox pair) — a built menu row's label is unprefixed.
/** A built menu row's label — its only child is its Checkbox. */
function menuRowLabel(row: InstanceType<typeof CheckboxMenuRow>): string {
    return (row.getComponents()[0] as InstanceType<typeof Checkbox>).getLabel() ?? '';
}

/** Dispatches a click at `row`'s element, toggling it — mirrors MenuRow.test.ts's `click` helper. */
function toggle(row: InstanceType<typeof CheckboxMenuRow>): void {
    const handle = row.getElement(true)!;

    DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(handle, 'click'));
}

/** Row labels in order; a `row:` config's label is built, a separator renders as '---'. */
function labels(configs: MenuItemConfig[]): string[] {
    return configs.map(c => {
        if (c.separator) {
            return '---';
        }

        if (c.row !== undefined) {
            return menuRowLabel(buildRow(c));
        }

        return c.text!;
    });
}

/** The submenu items array under the top-level "Show/hide columns" row. */
function submenuItems(table: Table): MenuItemConfig[] {
    const submenu = capturedMenuItems(table)[0].submenu;

    return Array.isArray(submenu?.items) ? submenu.items : [];
}

/** Opens the column dialog by invoking the top-level trigger row's action. */
function openDialog(table: Table): InstanceType<typeof Dialog> {
    capturedMenuItems(table)[0].action!();

    return (table as any)._columnDialog;
}

/** The dialog's content component (the HBox-of-columns body Table builds). */
function dialogBody(dialog: InstanceType<typeof Dialog>): Component {
    return dialog.getContentComponent().getComponents()[0];
}

/** The dialog body's per-column containers, left to right. */
function dialogColumns(dialog: InstanceType<typeof Dialog>): Component[] {
    return dialogBody(dialog).getComponents();
}

/** The dialog body's rows (Checkbox / Text), flattened across columns in reading order. */
function dialogRows(dialog: InstanceType<typeof Dialog>): Component[] {
    return dialogColumns(dialog).flatMap(col => col.getComponents());
}

/** `'H:<group>'` for a bold Text header row, `'C:<field>'` for a Checkbox row. */
function rowLabel(r: Component): string {
    if (r instanceof Text) {
        return `H:${r.getText()}`;
    }

    if (r instanceof Checkbox) {
        return `C:${r.getLabel()}`;
    }

    throw new Error('Unexpected dialog row type: ' + r.getClassName());
}

describe('Table column visibility — top-level menu, normal mode', () => {
    it('1. a 1-20 column table gets one "Show/hide columns" submenu row, no field-named rows at top level', async () => {
        const table = await wideTable(10);
        const items = capturedMenuItems(table);

        expect(items[0].text).toBe('Show/hide columns');
        expect(items[0].submenu).toBeDefined();
        expect(items.some(i => i.text && /^col\d+$/.test(i.text))).toBe(false);
    });

    it('2. a 21+ column table gets one "Show/hide columns" action row, no submenu', async () => {
        const table = await wideTable(45);
        const items = capturedMenuItems(table);

        expect(items[0].text).toBe('Show/hide columns');
        expect(typeof items[0].action).toBe('function');
        expect(items[0].submenu).toBeUndefined();
    });

    it('3. exactly 20 columns yields the submenu; exactly 21 yields the dialog row', async () => {
        const at20 = capturedMenuItems(await wideTable(20));
        const at21 = capturedMenuItems(await wideTable(21));

        expect(at20[0].submenu).toBeDefined();
        expect(at21[0].submenu).toBeUndefined();
        expect(at21[0].text).toBe('Show/hide columns');
    });

    it('4. a zero-column table emits no column row: the list starts with a separator, then Reset columns', async () => {
        const table = await makeTable(wideModel(3), { columns: [], appendUnlisted: false });
        const items = capturedMenuItems(table);

        expect(items[0]).toEqual({ separator: true });
        expect(items[1].text).toBe('Reset columns');
    });

    it('5. Reset columns / Filter / export entries keep their order and separators; Filter is a row config', async () => {
        const table = await makeTable(wideModel(3), { columns: [{ field: 'col0', filterable: true }] });
        table.setExportMenuEnabled(true);

        const items       = capturedMenuItems(table);
        const resetIndex  = items.findIndex(i => i.text === 'Reset columns');
        const filterIndex = items.findIndex(i => i.row !== undefined);
        const csvIndex    = items.findIndex(i => i.text === 'Export as CSV');
        const jsonIndex   = items.findIndex(i => i.text === 'Export as JSON');

        expect(items[resetIndex - 1]).toEqual({ separator: true });
        expect(items[filterIndex - 1]).toEqual({ separator: true });
        expect(filterIndex).toBeGreaterThan(resetIndex);
        expect(items[filterIndex].text).toBeUndefined();
        expect(menuRowLabel(buildRow(items[filterIndex]))).toBe('Filter');
        expect(items[csvIndex - 1]).toEqual({ separator: true });
        expect(csvIndex).toBeGreaterThan(filterIndex);
        expect(jsonIndex).toBe(csvIndex + 1);
    });

    it('5b. the built Filter row starts checked to isFilterRowVisible(), and toggling it round-trips the table state', async () => {
        const table = await makeTable(wideModel(3), { columns: [{ field: 'col0', filterable: true }] });

        const filterRow = buildRow(capturedMenuItems(table).find(i => i.row !== undefined)!);

        expect(filterRow.isChecked()).toBe(table.isFilterRowVisible());

        toggle(filterRow);
        expect(table.isFilterRowVisible()).toBe(true);

        toggle(filterRow);
        expect(table.isFilterRowVisible()).toBe(false);
    });

    it('6. rotated mode is unchanged: export rows only when enabled, no menu otherwise', async () => {
        const table = await wideTable(10);
        table.setDisplayMode('rotated');
        table.setExportMenuEnabled(true);

        const items = capturedMenuItems(table);
        expect(items).toEqual([
            { text: 'Export as CSV',  action: expect.any(Function) },
            { text: 'Export as JSON', action: expect.any(Function) },
        ]);

        table.setExportMenuEnabled(false);
        let shown = false;
        (table as any)._columnContextMenu.show = () => { shown = true; };
        (table as any).showColumnMenu(0, 0);
        expect(shown).toBe(false);
    });
});

describe('Table column visibility — submenu contents', () => {
    it('7. rows appear in field order, one per resolved column, each labelled with the field name', async () => {
        const table = await groupedTable();
        const fieldRows = submenuItems(table).filter(i => i.row !== undefined).map(buildRow);

        expect(fieldRows.map(r => menuRowLabel(r).trim())).toEqual(
            ['Name', 'Active', 'Score', 'Role', 'Joined', 'Meeting', 'LastSeen', 'Manager', 'Notes', 'locked']
        );
    });

    it('8. isChecked() matches column visibility, for both a visible and a hidden column', async () => {
        const table    = await groupedTable();
        const rows     = submenuItems(table).filter(i => i.row !== undefined).map(buildRow);
        const fieldRow = (name: string) => rows.find(r => menuRowLabel(r).trim() === name)!;

        expect(fieldRow('Name').isChecked()).toBe(true);
        expect(fieldRow('Active').isChecked()).toBe(true);
        expect(fieldRow('Notes').isChecked()).toBe(false);
        expect(fieldRow('locked').isChecked()).toBe(false);
    });

    it('9. a disabled group-header row precedes each grouped run; only grouped runs get one', async () => {
        const table   = await groupedTable();
        const items   = submenuItems(table);
        const headers = items.filter(i => !i.separator && i.row === undefined);

        expect(headers.map(h => h.text)).toEqual(['Identity', 'Activity']);
        expect(headers.every(h => h.enabled === false && h.checked === undefined)).toBe(true);
    });

    it('10. the worked example: exact ordered listing, a separator at every group boundary but the first', async () => {
        const table = await groupedTable();

        expect(labels(submenuItems(table))).toEqual([
            'Identity',
            NBSP + 'Name',
            NBSP + 'Active',
            '---',
            'Score',
            'Role',
            '---',
            'Activity',
            NBSP + 'Joined',
            NBSP + 'Meeting',
            NBSP + 'LastSeen',
            '---',
            'Manager',
            'Notes',
            'locked',
        ]);
    });

    it('11. an unhideable column\'s row is disabled and checked', async () => {
        const table = await groupedTable();
        const rows  = submenuItems(table).filter(i => i.row !== undefined).map(buildRow);
        const nameRow = rows.find(r => menuRowLabel(r).trim() === 'Name')!;

        expect(nameRow.isEnabled()).toBe(false);
        expect(nameRow.isChecked()).toBe(true);
    });

    it('12. toggling a visible column\'s row hides it; toggling the SAME row instance again shows it', async () => {
        const table  = await groupedTable();
        const before = table.getColumns().map(c => c.getField().getName());
        const rows   = submenuItems(table).filter(i => i.row !== undefined).map(buildRow);
        const scoreRow = rows.find(r => menuRowLabel(r).trim() === 'Score')!;

        toggle(scoreRow);

        expect(table.getColumns().map(c => c.getField().getName())).toEqual(before.filter(n => n !== 'Score'));

        toggle(scoreRow);

        expect(table.getColumns().map(c => c.getField().getName())).toEqual(before);
    });
});

describe('Table column visibility — dialog', () => {
    it('13. opening the dialog sets a live _columnDialog and leaves _hiddenColumns unchanged', async () => {
        const table  = await wideGroupedTable(12);
        const before = new Set((table as any)._hiddenColumns);

        const dialog = openDialog(table);

        expect(dialog).toBeInstanceOf(Dialog);
        expect((table as any)._hiddenColumns).toEqual(before);
    });

    it('14. one Checkbox per resolved column in field order, plus a bold Text before each grouped run; ungrouped runs get no Text', async () => {
        const table = await wideGroupedTable(12);
        const dialog = openDialog(table);
        const rows  = dialogRows(dialog);

        expect(rows.map(rowLabel)).toEqual([
            'H:Identity',
            'C:Name', 'C:Active',
            'C:Score', 'C:Role',
            'H:Activity',
            'C:Joined', 'C:Meeting', 'C:LastSeen',
            'C:Manager', 'C:Notes', 'C:locked',
            ...Array.from({ length: 12 }, (_, i) => `C:Extra${i}`),
        ]);

        for (const r of rows) {
            if (r instanceof Text) {
                expect(r.getFontWeight()).toBe('bold');
            }
        }
    });

    it('15. each Checkbox reflects the column\'s visibility at open time; the unhideable column is disabled and selected', async () => {
        const table = await wideGroupedTable(12);
        table.setColumnVisible('Score', false);

        const rows      = dialogRows(openDialog(table));
        const checkbox  = (label: string) => rows.find(r => r instanceof Checkbox && r.getLabel() === label) as InstanceType<typeof Checkbox>;

        expect(checkbox('Score').isSelected()).toBe(false);
        expect(checkbox('Active').isSelected()).toBe(true);
        expect(checkbox('Notes').isSelected()).toBe(false);
        expect(checkbox('Name').isEnabled()).toBe(false);
        expect(checkbox('Name').isSelected()).toBe(true);
    });

    it('16. toggling checkboxes changes nothing on the table until a button is pressed', async () => {
        const table  = await wideGroupedTable(12);
        const before = new Set((table as any)._hiddenColumns);
        const rows   = dialogRows(openDialog(table));
        const scheduleLayout = vi.spyOn(table as any, 'scheduleLayout');

        for (const r of rows) {
            if (r instanceof Checkbox && r.isEnabled()) {
                r.setSelected(!r.isSelected());
            }
        }

        expect((table as any)._hiddenColumns).toEqual(before);
        expect(scheduleLayout).not.toHaveBeenCalled();
    });

    it('17. Apply calls setColumnVisible exactly once per genuinely changed column, with the correct value', async () => {
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} } as any);

        const table = await wideGroupedTable(12);
        table.setColumnVisible('Score', false);

        const dialog = openDialog(table);
        const rows   = dialogRows(dialog);
        const checkbox = (label: string) => rows.find(r => r instanceof Checkbox && r.getLabel() === label) as InstanceType<typeof Checkbox>;

        const setColumnVisible = vi.spyOn(table, 'setColumnVisible');

        checkbox('Score').setSelected(true);    // was hidden -> show
        checkbox('Notes').setSelected(true);    // spec-hidden -> show
        checkbox('Active').setSelected(false);  // was visible -> hide
        checkbox('Role').setSelected(true);     // unchanged (already visible) -> no write

        dialog.hide('confirm');
        await Promise.resolve();

        expect(setColumnVisible).toHaveBeenCalledTimes(3);
        expect(setColumnVisible).toHaveBeenCalledWith('Score', true);
        expect(setColumnVisible).toHaveBeenCalledWith('Notes', true);
        expect(setColumnVisible).toHaveBeenCalledWith('Active', false);
        expect((table as any)._columnDialog).toBeNull();
    });

    it('18-19. Cancel and Escape leave _hiddenColumns byte-identical and clear _columnDialog, even after every checkbox was flipped', async () => {
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} } as any);

        for (const route of ['cancel', 'escape'] as const) {
            const table  = await wideGroupedTable(12);
            const before = new Set((table as any)._hiddenColumns);
            const dialog = openDialog(table);
            const rows   = dialogRows(dialog);

            for (const r of rows) {
                if (r instanceof Checkbox && r.isEnabled()) {
                    r.setSelected(!r.isSelected());
                }
            }

            const setColumnVisible = vi.spyOn(table, 'setColumnVisible');

            if (route === 'cancel') {
                dialog.hide('cancel');
            } else {
                dialog.requestClose(); // the Escape / title-bar-close route
            }

            await Promise.resolve();

            expect(setColumnVisible).not.toHaveBeenCalled();
            expect((table as any)._hiddenColumns).toEqual(before);
            expect((table as any)._columnDialog).toBeNull();
        }
    });

    it('20. disposing the table while the dialog is open does not throw and settles with no writes', async () => {
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} } as any);

        const table = await wideGroupedTable(12);
        openDialog(table);

        const setColumnVisible = vi.spyOn(table, 'setColumnVisible');

        expect(() => table.dispose()).not.toThrow();
        await Promise.resolve();

        expect(setColumnVisible).not.toHaveBeenCalled();
    });
});

describe('Table column visibility — dialog multi-column layout', () => {
    it('splits checkboxes into ceil(count / 15) columns, sized as evenly as possible', async () => {
        const table  = await wideTable(30);
        const dialog = openDialog(table);
        const columns = dialogColumns(dialog);

        expect(columns).toHaveLength(2);
        expect(columns.map(c => c.getComponents().length)).toEqual([15, 15]);
    });

    it('never leaves a column over 15 checkboxes, adding a column instead', async () => {
        const table  = await wideTable(31);
        const dialog = openDialog(table);
        const columns = dialogColumns(dialog);

        expect(columns).toHaveLength(3);
        expect(columns.map(c => c.getComponents().length)).toEqual([11, 10, 10]);
        expect(columns.every(c => c.getComponents().length <= 15)).toBe(true);
    });

    it('a group split across dialog columns repeats its header at the top of the next column', async () => {
        const fields = Array.from({ length: 25 }, (_, i) => ({ name: `f${i}`, type: 'string' as const, order: i }));
        const spec: ColumnSpec = { columns: fields.map(f => ({ field: f.name, group: 'Alpha' })) };
        const table  = await makeTable(new Model(fields, 'f0'), spec);
        const dialog = openDialog(table);
        const columns = dialogColumns(dialog);

        expect(columns).toHaveLength(2);
        expect(columns[0].getComponents().map(rowLabel)[0]).toBe('H:Alpha');
        expect(columns[1].getComponents().map(rowLabel)[0]).toBe('H:Alpha');
        expect(columns[0].getComponents()).toHaveLength(14); // 1 header + 13 checkboxes
        expect(columns[1].getComponents()).toHaveLength(13); // 1 header + 12 checkboxes
    });

    it('dialog width is sized to the columns\' actual content, not a fixed per-column guess', async () => {
        const twoColumnDialog   = openDialog(await wideTable(21));   // ceil(21/15) = 2
        const threeColumnDialog = openDialog(await wideTable(45));   // ceil(45/15) = 3

        const twoColumnContentWidth   = Math.ceil(dialogBody(twoColumnDialog).getPreferredSize()!.width);
        const threeColumnContentWidth = Math.ceil(dialogBody(threeColumnDialog).getPreferredSize()!.width);
        const MIN_DIALOG_WIDTH        = 320; // Dialog's own floor (Dialog.ts) — content narrower than this gets clamped up.

        // Matches the body's own measured preferred width exactly (floored at
        // Dialog's own minimum) — no slack from a generous fixed-width-per-column
        // guess. Short field names ("col0".."col20") are narrow enough here that
        // Dialog's floor, not the content, ends up deciding the width.
        expect(twoColumnDialog.getWidth()).toBe(Math.max(MIN_DIALOG_WIDTH, twoColumnContentWidth));

        // Nowhere near the 360px-per-column guess the dialog used before it was
        // measured from real content.
        expect(twoColumnDialog.getWidth()).toBeLessThan(776);

        // The measured content itself grows with the column count, even though
        // both happen to be floored to the same rendered width here.
        expect(threeColumnContentWidth).toBeGreaterThan(twoColumnContentWidth);
    });

    it('the columns are centered in the dialog', async () => {
        const dialog = openDialog(await wideTable(21));
        const layoutManager = dialogBody(dialog).getLayoutManager();

        expect(layoutManager).toBeInstanceOf(HBox);
        expect((layoutManager as InstanceType<typeof HBox>).getJustify()).toBe('center');
    });
});
