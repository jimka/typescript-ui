// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component, Panel } from '@jimka/typescript-ui/core';
import { Border } from '@jimka/typescript-ui/layout';
import { Placement } from '@jimka/typescript-ui/primitive';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Table } from '@jimka/typescript-ui/component/table';
import { Button } from '@jimka/typescript-ui/component/button';
import { ToolBar } from '@jimka/typescript-ui/component/menubar';
import { Glyph } from '@jimka/typescript-ui/component/display';
import { Tooltip } from '@jimka/typescript-ui/overlay';
import { table_list }  from '@jimka/typescript-ui/glyphs/solid/table_list';
import { angle_left }  from '@jimka/typescript-ui/glyphs/solid/angle_left';
import { angle_right } from '@jimka/typescript-ui/glyphs/solid/angle_right';

Glyph.register(table_list, angle_left, angle_right);

const DEPARTMENTS = ['Engineering', 'Sales', 'Support', 'Marketing', 'Finance'];
const TITLES      = ['Engineer', 'Manager', 'Director', 'Analyst', 'Associate'];
const COUNTRIES   = ['USA', 'Canada', 'UK', 'Germany', 'Australia'];

// 30 records over 20 fields: enough columns that reading one record in the
// normal (record-per-row) view means scrolling horizontally across the
// whole width — the case the rotated view exists for.
const RECORD_COUNT = 30;

const WIDE_MODEL = new Model([
    { name: 'id',           type: 'number'  },
    { name: 'firstName',    type: 'string'  },
    { name: 'lastName',     type: 'string'  },
    { name: 'email',        type: 'string'  },
    { name: 'department',   type: 'string'  },
    { name: 'title',        type: 'string'  },
    { name: 'age',          type: 'number'  },
    { name: 'salary',       type: 'number'  },
    { name: 'active',       type: 'boolean' },
    { name: 'remote',       type: 'boolean' },
    { name: 'hireDate',     type: 'date'    },
    { name: 'country',      type: 'string'  },
    { name: 'city',         type: 'string'  },
    { name: 'phone',        type: 'string'  },
    { name: 'manager',      type: 'string'  },
    { name: 'level',        type: 'number'  },
    { name: 'bonus',        type: 'number'  },
    { name: 'rating',       type: 'number'  },
    { name: 'notes',        type: 'string'  },
    { name: 'employeeCode', type: 'string'  },
]);

/**
 * Builds `RECORD_COUNT` synthetic wide records, one per field declared on
 * {@link WIDE_MODEL}, cycling through a few lookup lists for variety.
 */
function buildRecords(): Record<string, any>[] {
    const records: Record<string, any>[] = [];

    for (let i = 0; i < RECORD_COUNT; i++) {
        records.push({
            id:           i + 1,
            firstName:    `First${i + 1}`,
            lastName:     `Last${i + 1}`,
            email:        `user${i + 1}@example.com`,
            department:   DEPARTMENTS[i % DEPARTMENTS.length],
            title:        TITLES[i % TITLES.length],
            age:          25 + (i % 40),
            salary:       50000 + i * 1500,
            active:       i % 3 !== 0,
            remote:       i % 2 === 0,
            hireDate:     new Date(2015 + (i % 9), i % 12, (i % 27) + 1),
            country:      COUNTRIES[i % COUNTRIES.length],
            city:         `City${i + 1}`,
            phone:        `555-${String(1000 + i).slice(1)}`,
            manager:      `Manager${(i % 5) + 1}`,
            level:        (i % 6) + 1,
            bonus:        (i % 10) * 500,
            rating:       1 + (i % 5),
            notes:        `Notes for record ${i + 1}`,
            employeeCode: `EMP-${String(i + 1).padStart(4, '0')}`,
        });
    }

    return records;
}

/**
 * Demo for {@link Table.setDisplayMode}: a wide (20-field) record set shown
 * either one row per record, or — via the "Rotate" toggle — as the selected
 * record's fields laid out as key/value rows (the psql `\x` expanded view).
 * The Previous/Next buttons step the displayed record by driving
 * `table.selectRecord(...)` off `table.getStore().getRecords()`, clamped at
 * both ends — the consumer-wired stepper the mode intentionally ships
 * without.
 */
class RotatedRecordPanel extends Panel {

    private _table: Table;

    constructor() {
        super({ layoutManager: Border() });

        this._table = this.buildTable();

        this.addComponent(this.buildToolbar(), { placement: Placement.NORTH });
        this.addComponent(this._table,         { placement: Placement.CENTER });
    }

    private buildTable(): Table {
        const records = buildRecords();
        const store   = new MemoryStore(WIDE_MODEL, records);

        store.loadData(records);

        return Table(store);
    }

    private buildToolbar(): Component {
        const toolbar = new ToolBar();

        // `text` (with `showText: false`) supplies each icon-only button its
        // accessible name; ToolBar renders the glyph compactly and sizes its
        // own height to the buttons, so nothing is clipped.
        const rotateBtn = Button({
            glyph:     'table-list',
            text:      'Toggle rotated (key/value) view',
            showText:  false,
            listeners: { action: () => this.toggleRotate() },
        });
        Tooltip.attach(rotateBtn, 'Toggle rotated (key/value) view');

        const prevBtn = Button({
            glyph:     'angle-left',
            text:      'Previous record',
            showText:  false,
            listeners: { action: () => this.stepRecord(-1) },
        });
        Tooltip.attach(prevBtn, 'Previous record');

        const nextBtn = Button({
            glyph:     'angle-right',
            text:      'Next record',
            showText:  false,
            listeners: { action: () => this.stepRecord(1) },
        });
        Tooltip.attach(nextBtn, 'Next record');

        toolbar.addComponents(rotateBtn, prevBtn, nextBtn);

        return toolbar;
    }

    /** Flips the table between `"normal"` and `"rotated"` display mode. */
    private toggleRotate(): void {
        const next = this._table.getDisplayMode() === 'normal' ? 'rotated' : 'normal';

        this._table.setDisplayMode(next);
    }

    /**
     * Moves the displayed/selected record by `delta` positions in the
     * store's current record order, clamped to the first/last record.
     *
     * @param delta - `-1` for the previous record, `1` for the next.
     */
    private stepRecord(delta: number): void {
        const records = this._table.getStore().getRecords();

        if (records.length === 0) {
            return;
        }

        const current      = this._table.getSelectedRecord();
        const currentIndex = current ? records.indexOf(current) : -1;
        const nextIndex     = Math.min(Math.max(currentIndex + delta, 0), records.length - 1);

        this._table.selectRecord(records[nextIndex]);
    }
}

const RotatedRecordPanelCallable = callable(RotatedRecordPanel);
type RotatedRecordPanelCallable = RotatedRecordPanel;
export {
    RotatedRecordPanel         as _RotatedRecordPanel,
    RotatedRecordPanelCallable as RotatedRecordPanel
};
