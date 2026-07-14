// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Table } from '@jimka/typescript-ui/component/table';
import type { CellType, ColumnSpec } from '@jimka/typescript-ui/component/table';

const OWNER_OPTIONS    = [{ value: 'alice',  label: 'Alice'  }, { value: 'bob',    label: 'Bob'    }];
const DATATYPE_OPTIONS = [{ value: 'string', label: 'String' }, { value: 'number', label: 'Number' }];

/**
 * Demo for `ColumnConfig.cellType` / `cellValues`: a Property/Value grid
 * whose single `value` column renders a different cell variant per row — a
 * checkbox for "Cycle", a combo for "Owner" and "Data type" (each with its
 * own option set), and a plain number input for "Count" — all through one
 * `DynamicCell` per pool slot rather than a form or a per-row workaround.
 */
class PropertyGridPanel extends Panel {

    constructor() {
        super({
            layoutManager: new VBox({ stretching: true }),
            autoScroll: "auto"
        });

        this.addComponent(this.buildTable());
    }

    private buildTable(): Table {
        const model = new Model([
            { name: 'property', type: 'string', order: 0 },
            { name: 'value',    type: 'auto',   order: 1 }, // 'auto': rows commit mixed native types
            { name: 'kind',     type: 'string', order: 2 },
        ]);

        const rows = [
            { property: 'Cycle',     value: true,     kind: 'boolean' },
            { property: 'Owner',     value: 'alice',  kind: 'combo'   },
            { property: 'Data type', value: 'string', kind: 'combo'   },
            { property: 'Count',     value: 5,        kind: 'number'  },
        ];

        const store = new MemoryStore(model, rows);
        store.loadData(rows);

        const spec: ColumnSpec = {
            columns: [
                { field: 'property', minWidth: 140, readOnly: true },
                {
                    field: 'value',
                    minWidth: 160,
                    cellType:   (r) => r.get('kind') as CellType,
                    cellValues: (r) => r.get('property') === 'Owner' ? OWNER_OPTIONS : DATATYPE_OPTIONS,
                },
                { field: 'kind', hidden: true },
            ],
        };

        const table = new Table(store, spec);
        table.setExportMenuEnabled(true);

        return table;
    }
}

const PropertyGridPanelCallable = callable(PropertyGridPanel);
type PropertyGridPanelCallable = PropertyGridPanel;
export {
    PropertyGridPanel         as _PropertyGridPanel,
    PropertyGridPanelCallable as PropertyGridPanel
};
