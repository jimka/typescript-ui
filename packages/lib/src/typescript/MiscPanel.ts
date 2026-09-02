// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    callable,
    ClassicTheme,
    Component,
    Container,
    DarkTheme,
    Event,
    Form,
    ModernTheme,
    Panel,
    ThemeManager
} from '@jimka/typescript-ui/core';
import {
    ButtonGroup,
    Dialog,
    Dock,
    Drawer,
    Menu,
    Notification,
    NotificationHistoryButton,
    Popover,
    PopupPanel,
    Rail,
    Tooltip,
    Window
} from '@jimka/typescript-ui/overlay';
import type { AutoScrollMode } from '@jimka/typescript-ui/core';
import type { DockPanelEvent, DrawerEdge } from '@jimka/typescript-ui/overlay';
import { Insets, Placement } from '@jimka/typescript-ui/primitive';
import {
    Absolute,
    Anchor,
    AnchorConstraints,
    Border,
    Fit,
    HBox,
    VBox
} from '@jimka/typescript-ui/layout';
import type { LayoutState } from '@jimka/typescript-ui/layout';
import {
    MemoryStore,
    Model,
    ModelRecord,
    Proxy,
    ReadParams,
    Store
} from '@jimka/typescript-ui/data';
import {
    AutoCompleteField,
    Checkbox,
    ComboBox,
    DateField,
    DateTimeField,
    Link,
    NumberSpinner,
    RadioButton,
    Text,
    TextField,
    TimeField
} from '@jimka/typescript-ui/component/input';
import { Button, PopupButton } from '@jimka/typescript-ui/component/button';
import {
    Canvas,
    Glyph,
    IconLabel,
    IconText,
    Image,
    PaginationBar,
    ProgressBar,
    ProgressSpinner,
    VideoPlayer,
    WebGLCanvas
} from '@jimka/typescript-ui/component/display';
import { FieldSet, Spacer, StatusBar } from '@jimka/typescript-ui/component/container';
import type { MenuItemConfig } from '@jimka/typescript-ui/component/container';
import {
    ColumnSpec,
    LinkCellRenderer,
    Table,
    TablePanel,
    TreeTablePanel,
    TreeTableSpec
} from '@jimka/typescript-ui/component/table';
import {
    IconLabelTreeNodeRenderer,
    Tree
} from '@jimka/typescript-ui/component/tree';
import type { TreeNode } from '@jimka/typescript-ui/component/tree';
import {
    GlyphListItemRenderer,
    List
} from '@jimka/typescript-ui/component/list';
import { xmark }         from '@jimka/typescript-ui/glyphs/solid/xmark';
import { arrow_right }   from '@jimka/typescript-ui/glyphs/solid/arrow_right';
import { arrow_down }    from '@jimka/typescript-ui/glyphs/solid/arrow_down';
import { folder }        from '@jimka/typescript-ui/glyphs/solid/folder';
import { file }          from '@jimka/typescript-ui/glyphs/solid/file';
import { file_code }     from '@jimka/typescript-ui/glyphs/solid/file_code';
import { file_lines }    from '@jimka/typescript-ui/glyphs/solid/file_lines';
import { floppy_disk }   from '@jimka/typescript-ui/glyphs/solid/floppy_disk';
import { filter }        from '@jimka/typescript-ui/glyphs/solid/filter';
import { circle_info }   from '@jimka/typescript-ui/glyphs/solid/circle_info';
import { exclamation_triangle } from '@jimka/typescript-ui/glyphs/solid/exclamation_triangle';
import { ToolBar } from '~/component/menubar/ToolBar';
import { DiagnosticsOverlay } from '@jimka/typescript-ui/diagnostics';
import { VBoxPanel } from './VBoxPanel';

Glyph.register(xmark, arrow_right, arrow_down, folder, file, file_code, file_lines, floppy_disk, filter, circle_info,
               exclamation_triangle);
/**
 * Demo-only proxy that slices an in-memory dataset by page/pageSize and
 * pretends to be a slow network request so the spinner overlay is visible.
 *
 * @remarks
 * Only `read()` is meaningfully implemented. CRUD methods are no-ops; the
 * demo never sync()s.
 */
class PaginatingDemoProxy extends Proxy {

    private readonly all: any[];
    private readonly latencyMs: number;
    private lastTotal: number | undefined = undefined;

    /**
     * @param all - The full in-memory dataset.
     * @param latencyMs - Artificial response delay in milliseconds.
     */
    constructor(all: any[], latencyMs: number = 800) {
        super();

        this.all = all;
        this.latencyMs = latencyMs;
    }

    /**
     * Returns a paginated slice of the in-memory dataset after a simulated delay.
     *
     * @param params - Pagination parameters from the store.
     * @returns The slice of records corresponding to the requested page.
     */
    read(params?: ReadParams): Promise<any[]> {
        const page     = params?.page ?? 1;
        const pageSize = params?.pageSize ?? this.all.length;
        const start    = (page - 1) * pageSize;
        const slice    = this.all.slice(start, start + pageSize);

        this.lastTotal = this.all.length;

        return new Promise(resolve => {
            setTimeout(() => resolve(slice), this.latencyMs);
        });
    }

    /**
     * Returns the total record count from the most recent paginated read.
     *
     * @returns The dataset's full length, or undefined before the first read.
     */
    getLastTotalCount(): number | undefined {
        return this.lastTotal;
    }

    create(_record: ModelRecord): Promise<Record<string, any>> {
        return Promise.resolve({});
    }

    update(_record: ModelRecord): Promise<Record<string, any>> {
        return Promise.resolve({});
    }

    destroy(_record: ModelRecord): Promise<void> {
        return Promise.resolve();
    }
}

/**
 * Demo-only proxy whose `create()` rejects for any record named "Bad", so the
 * sync-error-handling demo can show one op failing while its siblings commit.
 *
 * @remarks
 * `read()` returns nothing — the demo seeds records via `add()` and only
 * exercises `sync()`. Updates/deletes succeed trivially.
 */
class FlakyDemoProxy extends Proxy {

    read(): Promise<any[]> {
        return Promise.resolve([]);
    }

    create(record: ModelRecord): Promise<Record<string, any>> {
        if (record.get("name") === "Bad") {
            return Promise.reject(new Error("server rejected record 'Bad'"));
        }

        return Promise.resolve(record.getData());
    }

    update(record: ModelRecord): Promise<Record<string, any>> {
        return Promise.resolve(record.getData());
    }

    destroy(_record: ModelRecord): Promise<void> {
        return Promise.resolve();
    }
}

class MiscPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new HBox({ stretching: true }));

        const leftColumn  = new Panel({ layoutManager: new VBox(), autoScroll: 'auto'  });
        const rightColumn = new Panel({ layoutManager: new VBox(), autoScroll: 'auto' });

        this.addComponent(leftColumn);
        this.addComponent(rightColumn);

        let buttonWindowImage = new Button("Show window with image!", { flat: true });
        buttonWindowImage.on("action", function () {
            let win = new Window("Hello World!");
            win.setX(100);
            win.setY(100);
            win.setWidth(400);
            win.setHeight(200);

            win.setContentFactory(() => new Image("https://arachnoid.com/JWX/graphics/grayscale_test_image_small.jpg?blah"));

            win.show();
        });
        leftColumn.addComponent(buttonWindowImage);

        let buttonDiagnosticsOverlay = new Button("Show diagnostics overlay", { flat: true });
        buttonDiagnosticsOverlay.on("action", function () {
            DiagnosticsOverlay.open();
        });
        leftColumn.addComponent(buttonDiagnosticsOverlay);

        // A window whose content opens another window. Each window registers
        // with the central LayerManager as an independent tree root (see
        // Window.isLayerRoot), so the child opens above the parent and takes
        // focus rather than nesting beneath it; clicking either title bar
        // raises that window. Exercises window-from-window stacking and
        // activation.
        let buttonWindowFromWindow = new Button("Show window that opens a window!");
        buttonWindowFromWindow.on("action", function () {
            const parentWin = new Window("Parent window");
            parentWin.setX(150);
            parentWin.setY(150);
            parentWin.setWidth(360);
            parentWin.setHeight(180);

            parentWin.setContentFactory(() => {
                const content = new Panel({ layoutManager: new VBox({ spacing: 12 }) });
                content.addComponent(new Text("Open a child window — it should appear on top and take focus."));

                let childCount = 0;
                const openChild = new Button("Open child window");
                openChild.on("action", function () {
                    childCount++;

                    const childWin = new Window("Child window " + childCount);
                    childWin.setX(220 + childCount * 24);
                    childWin.setY(220 + childCount * 24);
                    childWin.setWidth(300);
                    childWin.setHeight(130);

                    childWin.setContentFactory(() => new Text("I opened from the parent window and gained focus. Click the parent's title bar to raise it instead."));

                    childWin.show();
                });
                content.addComponent(openChild);

                return content;
            });

            parentWin.show();
        });
        leftColumn.addComponent(buttonWindowFromWindow);

        let buttonWindowTable = new Button("Show window with table (slow)!");
        buttonWindowTable.on("action", function () {
            let win2 = new Window("blaah!");

            win2.setX(50);
            win2.setY(200);
            win2.setWidth(800);
            win2.setHeight(600);

            win2.setContentFactory(() => {
                let tableModel = new Model([
                    { name: "col1", type: "string",  description: "desc1", order: 4 },
                    { name: "col2", type: "boolean", description: "desc2", order: 3 },
                    { name: "col3", type: "number",  description: "desc3", order: 2 },
                    { name: "col4", type: "string",  description: "desc4", order: 1 },
                    { name: "col5", type: "string",  description: "desc5", order: 0 },
                ]);

                let tableStore = new MemoryStore(tableModel);
                let tablePanel = new TablePanel(tableStore);

                tablePanel.setExportMenuEnabled(true);

                const rows = [
                    // Declare rows with arrays. Array index is matched by the column order value;
                    // col5(0), col4(1), col3(2), col2(3), col1(4)
                    ["World", "Goodbye", 1        , false    , "Hello"],
                    ["World", "Goodbye", 8        , undefined, "Hello"],
                    ["World", undefined, undefined, false    , "Hello"],
                    ["World", "Goodbye", 3        , false    , "Hello"],
                    ["World", "Goodbye", 10       , undefined, "Hello"],
                    ["World", undefined, undefined, false    , "Hello"],
                    ["World", "Goodbye", 5        , false    , "Hello"],
                    ["World", "Goodbye", 12       , undefined, "Hello"],
                    ["World", undefined, undefined, false    , "Hello"],
                    ["World", "Goodbye", 7        , false    , "Hello"],
                    ["World", "Goodbye", 14       , undefined, "Hello"],

                    // Declare rows with dicts.
                    { col1: "Hello", col2: false                                , col5: "World" },
                    { col1: "Hello", col2: true,  col3: 2      , col4: "Goodbye", col5: "World" },
                    { col1: "Hello",              col3: 9      , col4: "Goodbye"                },
                    { col1: "Hello", col2: false                                , col5: "World" },
                    { col1: "Hello", col2: false, col3: 4      , col4: "Goodbye", col5: "World" },
                    { col1: "Hello",              col3: 11     , col4: "Goodbye"                },
                    { col1: "Hello", col2: false                                , col5: "World" },
                    { col1: "Hello", col2: false, col3: 6      , col4: "Goodbye", col5: "World" },
                    { col1: "Hello",              col3: 13     , col4: "Goodbye"                },
                    { col1: "Hello", col2: false                                , col5: "World" },
                ];

                tableStore.add([
                    ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows,
                    ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows
                ]);

                // TODO: Will this lead to a race condition if we don't 'await'?
                tableStore.sync();

                // Proves Table.isDirty() — this plan's new store-derived
                // dirty flag — bubbling up through TablePanel via the
                // framework's existing parent-to-child relay: nothing in
                // TablePanel.ts reads or forwards it.
                const dirtyStatus = new Text('');
                const updateDirtyStatus = () =>
                    dirtyStatus.setText(`Dirty — table: ${tablePanel.isDirty() ? 'yes' : 'no'}`);
                tablePanel.onDirtyChange(updateDirtyStatus);
                updateDirtyStatus();

                const host = new Panel({ layoutManager: new VBox({ stretching: true }) });
                host.addComponent(tablePanel, { weight: 1 });
                host.addComponent(dirtyStatus);

                return host;
            });

            win2.show();
        });
        leftColumn.addComponent(buttonWindowTable);

        // A wide result set of the shape a database browser produces: far more
        // columns than fit the window, mixed types, and field names long enough
        // that a column narrower than its header clips the name. Columns size to
        // their measured content and the table scrolls horizontally rather than
        // squeezing every column down to nothing.
        let buttonWideTable = new Button("Show window with wide table (45 columns)!");
        buttonWideTable.on("action", function () {
            let win = new Window("Wide result set");

            win.setX(80);
            win.setY(120);
            win.setWidth(900);
            win.setHeight(600);

            win.setContentFactory(() => {
                const TYPES = ["string", "number", "date", "boolean"] as const;
                const NAMES = [
                    "customer_reference", "invoice_number", "posted_at", "is_settled",
                    "counterparty_name", "gross_amount", "value_date", "is_reconciled",
                    "ledger_account", "sequence_no", "created_at", "is_void",
                ];

                const fields = Array.from({ length: 45 }, (_, i) => ({
                    name:  `${NAMES[i % NAMES.length]}_${Math.floor(i / NAMES.length) + 1}`,
                    type:  TYPES[i % TYPES.length],
                    order: i,
                }));

                const wideModel = new Model(fields);
                const wideStore = new MemoryStore(wideModel);
                const widePanel = new TablePanel(wideStore, { columns: [], autoSizeColumns: true });

                widePanel.setExportMenuEnabled(true);

                // Values are deliberately uneven in length so the measured widths
                // differ per column instead of every column landing on the same size.
                const rows = Array.from({ length: 400 }, (_, r) => {
                    const row: Record<string, unknown> = {};

                    fields.forEach((f, i) => {
                        switch (f.type) {
                            case "number":  row[f.name] = (r + 1) * (i + 1);                         break;
                            case "boolean": row[f.name] = (r + i) % 3 === 0;                         break;
                            case "date":    row[f.name] = new Date(2024, i % 12, (r % 27) + 1);      break;
                            default:        row[f.name] = `${NAMES[i % NAMES.length]} value ${r + 1}`;
                        }
                    });

                    return row;
                });

                wideStore.add(rows);
                wideStore.sync();

                // Demos Table.setQuickSearch at scale: one call filters on
                // displayed text across every searchable column, entirely
                // display-only. The 11 boolean columns are skipped — a
                // checkbox cell has no text to match — and the per-record
                // caching that makes this affordable at 400 rows (scrolling
                // with a search active would otherwise re-format every
                // column of every record on every frame) now lives in
                // Table itself.
                const searchField = new TextField({ placeholder: 'Filter (every searchable column)…' });

                searchField.on("change", value => { widePanel.getTable().setQuickSearch(value); });

                // Demos plans/implemented/table-auto-size-column-resample.md:
                // "Add row" inserts a record whose first string column holds a
                // deliberately long value, so that column visibly widens once
                // the table re-samples; "Remove row" removes the most
                // recently added record, narrowing it again.
                let addedRows = 0;
                const addedRecords: ModelRecord[] = [];

                const addRowButton = new Button("Add row");

                addRowButton.on("action", () => {
                    addedRows++;

                    const row: Record<string, unknown> = {};

                    fields.forEach((f, i) => {
                        switch (f.type) {
                            case "number":  row[f.name] = addedRows * (i + 1);                          break;
                            case "boolean": row[f.name] = addedRows % 2 === 0;                           break;
                            case "date":    row[f.name] = new Date(2024, i % 12, (addedRows % 27) + 1);  break;
                            default:        row[f.name] = `${NAMES[i % NAMES.length]} — a much longer added value ${addedRows}`;
                        }
                    });

                    const [record] = wideStore.add(row);

                    addedRecords.push(record);
                });

                const removeRowButton = new Button("Remove row");

                removeRowButton.on("action", () => {
                    const record = addedRecords.pop();

                    if (record) {
                        wideStore.remove(record);
                    }
                });

                const searchRow = new Component({ layoutManager: new HBox({ spacing: 8 }) })
                    .addComponent(new Text("Filter:"))
                    .addComponent(searchField)
                    .addComponent(addRowButton)
                    .addComponent(removeRowButton);

                return Panel({
                    layoutManager: new VBox({ stretching: true }),
                    components: [
                        searchRow,
                        { component: widePanel, constraints: { weight: 1 } },
                    ]
                });
            });

            win.show();
        });
        leftColumn.addComponent(buttonWideTable);

        // Past COLUMN_MENU_DIALOG_THRESHOLD (20), with 60% of its columns spread
        // across four header groups — demos the show/hide-columns dialog's
        // multi-column layout and grouping. At 25 columns the dialog splits
        // 13 + 12 (15 checkboxes max per column); Financials (4 members)
        // straddles that split, so its section header repeats at the top of
        // the second dialog column.
        let buttonGroupedWideTable = new Button("Show window with grouped wide table (25 columns, 4 groups)!");
        buttonGroupedWideTable.on("action", function () {
            let win = new Window("Employee directory (grouped, wide)");

            win.setX(120);
            win.setY(140);
            win.setWidth(900);
            win.setHeight(600);

            win.setContentFactory(() => {
                const FIELDS: Array<{ name: string, type: "string" | "number" | "date" | "datetime" | "boolean", group?: string }> = [
                    { name: 'employee_id',    type: 'string',   group: 'Identity'   },
                    { name: 'first_name',     type: 'string',   group: 'Identity'   },
                    { name: 'last_name',      type: 'string',   group: 'Identity'   },
                    { name: 'department',     type: 'string',   group: 'Identity'   },
                    { name: 'status',         type: 'string'                       },
                    { name: 'email',          type: 'string'                       },
                    { name: 'hire_date',      type: 'date',     group: 'Activity'   },
                    { name: 'last_review',    type: 'date',     group: 'Activity'   },
                    { name: 'last_promotion', type: 'date',     group: 'Activity'   },
                    { name: 'last_login',     type: 'datetime', group: 'Activity'   },
                    { name: 'manager',        type: 'string'                       },
                    { name: 'location',       type: 'string'                       },
                    { name: 'base_salary',    type: 'number',   group: 'Financials' },
                    { name: 'bonus',          type: 'number',   group: 'Financials' },
                    { name: 'currency',       type: 'string',   group: 'Financials' },
                    { name: 'cost_center',    type: 'string',   group: 'Financials' },
                    { name: 'tax_id',         type: 'string'                       },
                    { name: 'notes',          type: 'string'                       },
                    { name: 'created_by',     type: 'string',   group: 'Metadata'   },
                    { name: 'created_at',     type: 'datetime', group: 'Metadata'   },
                    { name: 'updated_at',     type: 'datetime', group: 'Metadata'   },
                    { name: 'tags',           type: 'string'                       },
                    { name: 'priority',       type: 'string'                       },
                    { name: 'archived',       type: 'boolean'                      },
                    { name: 'external_ref',   type: 'string'                       },
                ];

                const groupedModel = new Model(FIELDS.map((f, i) => ({ name: f.name, type: f.type, order: i })));
                const groupedStore = new MemoryStore(groupedModel);

                const spec: ColumnSpec = {
                    columns: FIELDS.map(f => f.group ? { field: f.name, group: f.group } : { field: f.name }),
                };

                const groupedPanel = new TablePanel(groupedStore, spec);

                groupedPanel.setExportMenuEnabled(true);

                const rows = Array.from({ length: 40 }, (_, r) => {
                    const row: Record<string, unknown> = {};

                    FIELDS.forEach((f, i) => {
                        switch (f.type) {
                            case 'number':   row[f.name] = Math.round((r + 1) * (i + 3) * 1.7);                    break;
                            case 'boolean':  row[f.name] = (r + i) % 4 === 0;                                      break;
                            case 'date':     row[f.name] = new Date(2022 + (i % 3), i % 12, (r % 27) + 1);         break;
                            case 'datetime': row[f.name] = new Date(2024, i % 12, (r % 27) + 1, (r * 7) % 24, (i * 11) % 60); break;
                            default:         row[f.name] = `${f.name} ${r + 1}`;
                        }
                    });

                    return row;
                });

                groupedStore.add(rows);
                groupedStore.sync();

                return groupedPanel;
            });

            win.show();
        });
        leftColumn.addComponent(buttonGroupedWideTable);

        // Demonstrates the store's sync-error surface: with syncErrorPolicy
        // 'continue', a failing create emits 'exception' and the run proceeds, so
        // the sibling record still commits. The terminal 'sync' event reports the
        // failure count once.
        let buttonSyncErrors = new Button("Sync with a failing record (exception event)!");
        buttonSyncErrors.on("action", function () {
            const syncModel = new Model([
                { name: "id"  , type: "number" },
                { name: "name", type: "string" },
            ], "id");

            const syncStore = new Store({
                model: syncModel,
                proxy: new FlakyDemoProxy(),
                syncErrorPolicy: "continue",
            });

            syncStore.add([{ name: "Good" }, { name: "Bad" }]);

            syncStore.on("exception", function (payload: { operation: string }) {
                Notification.show(`sync ${payload.operation} failed`, "error");
            });

            syncStore.on("sync", function (payload: { failures: unknown[] }) {
                const ok = payload.failures.length === 0;

                Notification.show(
                    ok ? "Sync completed with no failures" : `Sync settled with ${payload.failures.length} failure(s)`,
                    ok ? "success" : "info",
                );
            });

            void syncStore.sync();
        });
        leftColumn.addComponent(buttonSyncErrors);

        let buttonPaginatedTable = new Button("Show window with paginated table!")
            .on("action", function () {
                const pagModel = new Model([
                    { name: "id"    , type: "number" , description: "id"    , order: 0 },
                    { name: "name"  , type: "string" , description: "name"  , order: 1 },
                    { name: "score" , type: "number" , description: "score" , order: 2 },
                    { name: "active", type: "boolean", description: "active", order: 3 },
                ]);

                const all = Array.from({ length: 237 }, (_, i) => ({
                    id    : i + 1,
                    name  : "Person " + (i + 1),
                    score : Math.round(Math.random() * 1000) / 10,
                    active: i % 3 !== 0,
                }));

                const pagProxy = new PaginatingDemoProxy(all, 800);
                const pagStore = new Store(pagModel, pagProxy);

                pagStore.setPageSize(25);

                Window("Paginated table (server-side)", {
                    x: 150, y: 150,
                    width: 700, height: 500,
                    contentFactory: () => {
                        const pagPanel = new TablePanel(pagStore);

                        pagPanel.setPaginationBar(new PaginationBar(pagStore));
                        pagPanel.setExportMenuEnabled(true);

                        return pagPanel;
                    },
                    onReady: () => void pagStore.load()
                }).show();
        });
        leftColumn.addComponent(buttonPaginatedTable);

        let buttonWindowTableSpec = new Button("Show window with table (column spec)!");
        buttonWindowTableSpec.on("action", function () {
            let win3 = new Window("Table with column spec");

            win3.setX(100);
            win3.setY(250);
            win3.setWidth(800);
            win3.setHeight(400);

            win3.setContentFactory(() => {
                let specModel = new Model([
                    { name: "Name"      , type: "string"  , description: "col1", order: 0 },
                    { name: "Active"    , type: "boolean" , description: "col2", order: 1 },
                    { name: "Score"     , type: "number"  , description: "col3", order: 2 },
                    { name: "Role"      , type: "string"  , description: "col9", order: 3 },
                    { name: "Joined"    , type: "date"    , description: "col5", order: 4 },
                    { name: "Meeting"   , type: "time"    , description: "col6", order: 5 },
                    { name: "LastSeen"  , type: "datetime", description: "col7", order: 6 },
                    { name: "Notes"     , type: "string"  , description: "col4", order: 7 },
                    { name: "locked"    , type: "boolean" , description: "col8", order: 8 },
                    { name: "Manager"   , type: "string"  , description: "col10", order: 9 },
                ]);

                let specStore = new MemoryStore(specModel);

                specStore.add([
                    { Name: "Alice", Active: true , Score: 95,   Role: "dev", Joined: new Date(2021,  2, 15), Meeting: new Date(1970, 0, 1,  9, 30, 20), LastSeen: new Date(2024,  0, 10, 14, 25), Notes: "Top performer"  , locked: false, Manager: "Carol" },
                    { Name: "Bob"  , Active: false, Score: 72,   Role: "qa" , Joined: new Date(2022,  7,  3), Meeting: new Date(1970, 0, 1, 14,  0, 30), LastSeen: new Date(2024,  3, 22,  8, 10), Notes: "Needs follow-up", locked: true  , Manager: "Alice" },
                    { Name: "Carol", Active: true , Score: 88,   Role: "pm" , Joined: new Date(2020, 11, 20), Meeting: null                        , LastSeen: new Date(2023, 11,  5, 17, 45)    , Notes: "On track"       , locked: false, Manager: null    },
                    { Name: "David", Active: true , Score: 61,   Role: "dev", Joined: null                  , Meeting: new Date(1970, 0, 1, 11, 15, 40), LastSeen: null                          , Notes: "Check in soon"  , locked: false, Manager: "Alice" },
                    { Name: "Eve"  , Active: false, Score: 45,   Role: "qa" , Joined: new Date(2023,  4,  9), Meeting: new Date(1970, 0, 1, 16, 45, 50), LastSeen: new Date(2024,  5,  1,  9,  0), Notes: "At risk"        , locked: false, Manager: "Carol" },
                    // Freshly onboarded, not yet fully filled out: demos the
                    // required-cell outline on both Role (static `required`) and
                    // Score (`requiredPredicate`, mandatory only while Active).
                    { Name: "Frank", Active: true , Score: null, Role: ""   , Joined: new Date(2024,  8,  1), Meeting: null                        , LastSeen: null                          , Notes: "Just joined"    , locked: false, Manager: "Carol" },
                ]);

                // TODO: Will this lead to a race condition if we don't 'await'?
                specStore.sync();

                // Partial spec: Name gets a minWidth; Score gets a maxWidth.
                // Notes is hidden initially. col2 (Active) is not listed but is
                // auto-appended because appendUnlisted defaults to true.
                // Name carries a headerGlyph to demo the leading-glyph slot
                // and `unhideable: true` so its context-menu entry renders
                // greyed-out with the visible checkmark.
                // Name + Active are grouped under "Identity"; Joined + Meeting
                // + LastSeen are grouped under "Activity" with a faint tint so
                // the parent-row affordance is visible.
                // rowReadOnly demos the spec-level predicate (Bob is locked so
                // every cell on his row is read-only); Score's cellReadOnly
                // demos the per-cell predicate (Score is read-only on any
                // record whose Active flag is false). Role's `required` and
                // Score's `requiredPredicate` demo the required-cell
                // affordance: Role always needs a value (header asterisk +
                // empty-cell outline on Frank, who has none yet); Score is only
                // mandatory while Active (predicate-only, so no header
                // asterisk — Frank's empty Score still outlines since he's
                // Active, but Bob's/Eve's don't since they're inactive).
                // LastSeen's `requiredPredicate` (mandatory while Active)
                // additionally demos the required-empty outline composing
                // with a grouped column's `groupColor` background: David's
                // and Frank's empty LastSeen (both Active) show the outline
                // on top of the Activity group tint; Alice's/Carol's filled
                // LastSeen shows just the group tint, no outline.
                // Manager demos LinkCellRenderer against the "cellclick"
                // handler below — the pairing the renderer is built for, since
                // it styles the value but never handles the click itself. It
                // reads as a reference to another row (Alice reports to Carol),
                // mirroring the foreign-key columns this is used for. Carol's
                // Manager is null, demoing the empty cell: no link text, and
                // clicking it still reports through cellclick with an empty
                // value. A custom-rendered cell carries no editor, so Manager
                // is the one column here that never enters edit mode — even on
                // an unlocked row.
                const spec: ColumnSpec = {
                    rowReadOnly: (r) => r.get('locked') === true,
                    columns: [
                        // Columns are filterable by default; Name/Score/Joined
                        // demo the header's filter row — one string column
                        // (contains/startsWith/endsWith/eq/neq), one number
                        // column (eq/neq/gt/gte/lt/lte; its filter input also
                        // refuses a keystroke that can never appear in a
                        // number — try typing a letter into it), one date
                        // column (same ordering set plus contains/startsWith/
                        // endsWith on the displayed day; Equals matches the
                        // whole displayed day). Hidden until toggled — see
                        // filterRowBtn below.
                        { field: 'Name'    , minWidth: 150, headerGlyph: 'xmark', group: 'Identity', unhideable: true                                      },
                        { field: 'Active'  , maxWidth: 100,                       group: 'Identity'                                                       },
                        { field: 'Score'   , maxWidth: 100, cellReadOnly: (r) => r.get('Active') === false, requiredPredicate: (r) => r.get('Active') === true },
                        { field: 'Role'    , minWidth: 140, required: true, values: [{ value: 'dev', label: 'Developer' }, { value: 'qa', label: 'QA Engineer' }, { value: 'pm', label: 'Project Manager' }] },
                        { field: 'Joined'  , minWidth: 120, readOnly: true, group: 'Activity', groupColor: 'rgba(30, 100, 200, 0.06)'    },
                        { field: 'Meeting' , minWidth: 100, showSeconds: true,    group: 'Activity', groupColor: 'rgba(30, 100, 200, 0.06)'                },
                        { field: 'LastSeen', minWidth: 160, requiredPredicate: (r) => r.get('Active') === true, group: 'Activity', groupColor: 'rgba(30, 100, 200, 0.06)' },
                        { field: 'Manager' , minWidth: 120, renderer: () => new LinkCellRenderer()                                                        },
                        { field: 'Notes'   , hidden  : true                                                                                                },
                        { field: 'locked'  , hidden  : true                                                                                                },
                    ],
                };

                let specTable = new Table(specStore, spec);
                specTable.setExportMenuEnabled(true);

                // Demos the required-empty outline stacking on top of the
                // new-row green row tint. Role/Score are left unset on the
                // freshly `markAsNew()`d record, and Active is seeded `true`
                // so Score's `requiredPredicate` (mandatory only while
                // Active) actually fires — a bare addRow({}) would leave
                // Active `undefined`, which is not `=== true`, and Score
                // would never outline. With Active seeded, both Role (static
                // `required`) and Score (predicate) outline. addRow() also
                // selects the new record, and Body paints a selected row's
                // background blue ahead of the green new-row tint (existing,
                // unrelated selection-precedence behaviour) — click any
                // other row afterward to deselect and see the required
                // outline layered on the green new-row background instead
                // of blue.
                const addRowBtn = new Button("Add row (demos new-row + required outline)");
                addRowBtn.on("action", () => { specTable.addRow({ Active: true }); });

                // Demos the header's filter row: hidden by default even though
                // every column here is filterable — toggle it on here, or via
                // the header's right-click "Filter" entry, then type into a
                // column's input and pick its operator from the button beside
                // it. Role's filter matches its label ("Developer"), not the
                // stored code ("dev"). Open a column's operator menu and pick
                // "Add condition…" to AND a second (or further) condition
                // onto that column — e.g. Score "At least" 60 AND "At most"
                // 90 — via the popover that opens under the operator button;
                // a small corner badge tracks the count once there are 2+.
                const filterRowBtn = new Button("Toggle filter row");
                filterRowBtn.on("action", () => {
                    specTable.setFilterRowVisible(!specTable.isFilterRowVisible());
                });

                // Demos Table.setQuickSearch's scoped form: an explicit field
                // whitelist restricts the search to
                // Name/Role/Notes/Manager/Joined/Meeting/LastSeen, entirely
                // display-only (the store, selection, and pending edits are
                // untouched — clearing the field restores every row). Role
                // matches its label ('Developer'/'QA Engineer'/'Project
                // Manager') rather than its stored code, since quick search
                // resolves each field the same way the cell itself renders it.
                const searchField = new TextField({ placeholder: 'Filter (name, role, notes, manager, joined, meeting, lastSeen)…' });
                const searchFields = ['Name', 'Role', 'Notes', 'Manager', 'Joined', 'Meeting', 'LastSeen'];

                searchField.on("change", value => {
                    specTable.setQuickSearch(value, searchFields);
                });

                const searchRow = new Component({ layoutManager: new HBox({ spacing: 8 }) })
                    .addComponent(new Text("Filter:"))
                    .addComponent(searchField);

                // Demo the store's aggregation + grouping API: average/max over
                // the numeric Score column, plus per-group counts bucketed by the
                // Active flag. getGroups() keys are the String() of each value.
                specStore.setGroupField('Active');

                const groupCounts = [...specStore.getGroups()]
                    .map(([key, records]) => `${key === 'true' ? 'active' : 'inactive'} ${records.length}`)
                    .join(', ');

                const statusBar = new StatusBar({
                    defaultMessage: `${specStore.getCount()} rows · avg Score ${specStore.average('Score').toFixed(1)} · max ${specStore.max('Score')} · ${groupCounts}`,
                });

                // Demo the column-aware "cellclick" event: a single click on any
                // data cell reports which column + record was hit (without
                // inferring the column from a selection change), while row
                // selection still works normally.
                specTable.on("cellclick", function (e) {
                    statusBar.setMessage(`clicked ${e.field} = ${String(e.value)} (row ${e.rowIndex}, col ${e.columnIndex})`);
                });

                const wrapper = Panel({
                    layoutManager: new VBox({ stretching: true }),
                    components: [
                        searchRow,
                        addRowBtn,
                        filterRowBtn,
                        { component: specTable, constraints: { weight: 1 } },
                        statusBar
                    ]
                });

                return wrapper;
            });

            win3.show();
        });
        leftColumn.addComponent(buttonWindowTableSpec);

        let buttonTreeTable = new Button("Show window with tree table!");
        buttonTreeTable.on("action", function () {
            const win4 = new Window("TreeTable — file-system layout");

            win4.setX(150);
            win4.setY(200);
            win4.setWidth(600);
            win4.setHeight(450);

            win4.setContentFactory(() => {
                const fsModel = new Model([
                    { name: "id"      , type: "number" , description: "id"      , order: 0 },
                    { name: "parentId", type: "number" , description: "parentId", order: 1 },
                    { name: "name"    , type: "string" , description: "name"    , order: 2 },
                    { name: "disabled", type: "boolean", description: "disabled", order: 3 },
                    { name: "size"    , type: "number" , description: "size"    , order: 4 },
                    { name: "modified", type: "date"   , description: "modified", order: 5 },
                ]);

                const fsStore = new MemoryStore(fsModel);

                // Three-level hierarchy: src/lib/{Component,Event}, src/main, docs/{guide,api}, package.json.
                fsStore.add([
                    { id:  1, parentId: null, name: "src"         , modified: new Date(2024, 0, 10) },
                    { id:  2, parentId:    1, name: "lib"         , modified: new Date(2024, 0, 10) },
                    { id:  3, parentId:    2, name: "Component.ts", size: 4200, modified: new Date(2024, 1, 22) },
                    { id:  4, parentId:    2, name: "Event.ts"    , size: 1850, modified: new Date(2024, 1, 18) },
                    { id:  5, parentId:    1, name: "main.ts"     , size: 320 , modified: new Date(2024, 0, 14) },
                    { id:  6, parentId: null, name: "docs"        , modified: new Date(2024, 2,  5) },
                    { id:  7, parentId:    6, name: "guide.md"    , size: 5800, modified: new Date(2024, 2,  5) },
                    { id:  8, parentId:    6, name: "api.md"      , size: 9100, modified: new Date(2024, 2, 12) },
                    { id:  9, parentId: null, name: "package.json", size: 1100, modified: new Date(2024, 0,  4) },
                ]);

                fsStore.sync();

                const spec: TreeTableSpec = {
                    idField:     "id",
                    parentField: "parentId",
                    treeColumn:  "name",
                    columns: [
                        { field: "name"    , minWidth: 240 },
                        { field: "size"    , maxWidth: 100 },
                        { field: "modified", minWidth: 130 },
                        { field: "id"      , hidden:  true },
                        { field: "parentId", hidden:  true },
                    ],
                };

                const treePanel = new TreeTablePanel(fsStore, spec);

                treePanel.setExportMenuEnabled(true);
                treePanel.getTreeTable().expandToDepth(0);

                return treePanel;
            });

            win4.show();
        });
        leftColumn.addComponent(buttonTreeTable);

        const themeCycle = [
            { theme: ModernTheme,  next: "Switch to classic theme" },
            { theme: ClassicTheme, next: "Switch to dark theme"    },
            { theme: DarkTheme,    next: "Switch to modern theme"  },
        ];
        let themeIndex = 0;
        let buttonTheme = new Button(themeCycle[0].next);
        buttonTheme.on("action", function () {
            themeIndex = (themeIndex + 1) % themeCycle.length;
            ThemeManager.setTheme(themeCycle[themeIndex].theme);
            buttonTheme.setText(themeCycle[themeIndex].next);
        });
        leftColumn.addComponent(buttonTheme);

        let fieldSet = new FieldSet("Hello World fieldset!");
        leftColumn.addComponent(fieldSet);

        const contextMenu = new Menu();

        const buttonContextMenu = new Button("Right-click me for context menu");
        Tooltip.attach(buttonContextMenu, "Right-click to open a context menu");
        Event.addListener(buttonContextMenu, "contextmenu", { prevent: true, handler: (e: MouseEvent) => {
            Tooltip.hide();
            contextMenu.show(e.clientX, e.clientY, [
                { text: "Action 1", action: () => alert("Action 1 clicked!") },
                { text: "Action 2", action: () => alert("Action 2 clicked!") },
                { separator: true },
                { text: "Disabled action", enabled: false },
                { text: "Action 3", action: () => alert("Action 3 clicked!") },
            ]);
        } });
        leftColumn.addComponent(buttonContextMenu);

        // A deliberately tall context menu (40 items) so it exceeds the
        // viewport height. Right-clicking near the bottom of the screen shows
        // the menu flip so its bottom ends at the cursor and cap its height
        // to scroll vertically rather than running off-screen with unreachable
        // items or covering the cursor.
        const tallContextMenu = new Menu();

        const tallItems: MenuItemConfig[] = [];

        for (let i = 1; i <= 40; i++) {
            tallItems.push({ text: `Item ${i}`, action: () => alert(`Item ${i} clicked!`) });
        }

        const buttonTallContextMenu = new Button("Right-click for a tall (scrolling) menu");
        Tooltip.attach(buttonTallContextMenu, "Right-click near the screen edge to see the menu flip and scroll");
        Event.addListener(buttonTallContextMenu, "contextmenu", { prevent: true, handler: (e: MouseEvent) => {
            Tooltip.hide();
            tallContextMenu.show(e.clientX, e.clientY, tallItems);
        } });
        leftColumn.addComponent(buttonTallContextMenu);

        const buttonTooltip = new Button("Hover over me for a tooltip");
        Tooltip.attach(buttonTooltip, "This tooltip appears after a short delay");
        leftColumn.addComponent(buttonTooltip);

        // A button carrying a subtitle below its title. By default the
        // description spans full-width below the glyph+title row (under-glyph),
        // and the auto-attached tooltip shows title + description on hover.
        const buttonWithDescription = new Button({
            text:        "Save document",
            description: "Persist your changes to disk",
            glyph:       "floppy-disk",
        });
        leftColumn.addComponent(buttonWithDescription);

        // Same shape but with descriptionUnderGlyph: false — the description
        // indents under the title text, beside the glyph, so the two buttons
        // stack to show both alignment modes.
        const buttonCancel = new Button({
            text:                  "Cancel",
            description:           "Discard your changes",
            glyph:                 "xmark",
            descriptionUnderGlyph: false,
        });
        leftColumn.addComponent(buttonCancel);

        // showDescription: false — the description is hidden on the button face
        // (glyph + title only) but still appears in the hover tooltip.
        const buttonHiddenDescription = new Button({
            text:            "Delete",
            description:     "This action cannot be undone",
            glyph:           "xmark",
            showDescription: false,
        });
        leftColumn.addComponent(buttonHiddenDescription);

        const buttonTree = new Button("Show tree component");
        buttonTree.on("action", () => {
            const win = new Window("Tree component");
            win.setX(200);
            win.setY(150);
            win.setWidth(300);
            win.setHeight(400);

            win.setContentFactory(() => {
                const treeData: TreeNode[] = [
                    {
                        label: "Animals", children: [
                            {
                                label: "Mammals", children: [
                                    { label: "Dog" },
                                    { label: "Cat" },
                                    { label: "Horse" },
                                ],
                            },
                            {
                                label: "Birds", children: [
                                    { label: "Eagle" },
                                    { label: "Parrot" },
                                ],
                            },
                            { label: "Fish" },
                        ],
                    },
                    {
                        label: "Plants", children: [
                            { label: "Trees" },
                            { label: "Flowers" },
                            { label: "Ferns" },
                        ],
                    },
                    { label: "Fungi" },
                    {
                        // Lazy node: renders a caret while collapsed, a spinner
                        // on first expand, then its children after the loader
                        // resolves. 800ms is long enough to see the spinner.
                        label: "Lazy folder",
                        hasChildren: true,
                        loadChildren: () => new Promise<TreeNode[]>(resolve => {
                            setTimeout(() => resolve([
                                { label: "Loaded A" },
                                { label: "Loaded B" },
                            ]), 800);
                        }),
                    },
                    {
                        // Lazy node whose loader rejects, to exercise the
                        // "loaderror" event and the retry-on-re-toggle path.
                        label: "Lazy folder (fails)",
                        hasChildren: true,
                        loadChildren: () => new Promise<TreeNode[]>((_resolve, reject) => {
                            setTimeout(() => reject(new Error("load failed")), 800);
                        }),
                    },
                ];

                const tree = new Tree({
                    listeners: {
                        loaderror: (node, error) => {
                            Notification.show(`Failed to load "${node.label}": ${error}`, "error");
                        },
                    },
                });
                tree.setNodes(treeData);

                return tree;
            });

            win.show();
        });
        leftColumn.addComponent(buttonTree);

        // Large-tree demo — exercises the virtual-scroll path at scale: hundreds
        // of rows (vertical overflow → scroll shadows) whose label widths vary
        // widely, with the very widest labels buried deep in the list so the
        // horizontal content width is only discovered after scrolling (→ the H
        // scrollbar must hold that width, not jitter with the visible rows).
        const buttonBigTree = new Button("Show large tree (variable-width rows)");
        buttonBigTree.on("action", () => {
            const win = new Window("Tree — large dataset");
            win.setX(240);
            win.setY(120);
            win.setWidth(360);
            win.setHeight(480);

            win.setContentFactory(() => {
                const SECTION_COUNT = 40;
                const LONG_SUFFIX   = " — a long descriptive label that overflows the tree horizontally";

                // Builds `count` leaves whose labels vary in length: most are
                // short, every seventh gets a long suffix (so the visible window
                // holds a mix of widths as it scrolls), and every leaf in the
                // deep `extraWide` section gets a double-length label — the
                // widest rows in the whole tree, far enough down that they are
                // off-screen at the top.
                const makeLeaves = (section: number, count: number): TreeNode[] => {
                    const leaves: TreeNode[] = [];
                    for (let i = 0; i < count; i++) {
                        let label = `Item ${section}.${i}`;
                        if (section === 31) {
                            label += LONG_SUFFIX + LONG_SUFFIX;
                        } else if (i % 7 === 3) {
                            label += LONG_SUFFIX;
                        }
                        leaves.push({ label });
                    }

                    return leaves;
                };

                const treeData: TreeNode[] = [];
                for (let s = 0; s < SECTION_COUNT; s++) {
                    const childCount = 6 + (s % 6) * 3;   // 6..21 leaves, varies per section
                    const children   = makeLeaves(s, childCount);

                    // Give every fourth section a nested sub-folder so indentation
                    // (and thus row width) also varies with depth.
                    if (s % 4 === 0) {
                        children.splice(2, 0, { label: `Subsection ${s}.x`, children: makeLeaves(s * 100, 5) });
                    }

                    treeData.push({ label: `Section ${s}`, children });
                }

                const tree = new Tree();
                tree.setNodes(treeData);
                tree.expandAll();

                return tree;
            });

            win.show();
        });
        leftColumn.addComponent(buttonBigTree);

        // Drawer demo — opens an edge-anchored sliding panel. Each drawer is a
        // bare content host, so we stack a heading and a Close button into it
        // via a VBox. The four modal buttons exercise all four geometries; the
        // last button shows a non-modal drawer that leaves the app interactive.
        const openDemoDrawer = (edge: DrawerEdge, modal: boolean, label: string): void => {
            const drawer = new Drawer({ edge, modal, layoutManager: new VBox({ stretching: true }) });

            const heading = new Text((modal ? "Modal" : "Non-modal") + " drawer — " + label);
            heading.setFontWeight("bold");
            heading.setPreferredSize({ width: 0, height: 28 });

            const closeButton = new Button("Close");
            closeButton.setPreferredSize({ width: 0, height: 32 });
            closeButton.on("action", () => { drawer.close(); });

            drawer.addComponent(heading);
            drawer.addComponent(closeButton);

            drawer.open();
        };

        const drawerEdges: Array<[string, DrawerEdge]> = [
            ["left",   Placement.WEST],
            ["right",  Placement.EAST],
            ["top",    Placement.NORTH],
            ["bottom", Placement.SOUTH],
        ];

        for (const [label, edge] of drawerEdges) {
            const drawerButton = new Button("Modal drawer from " + label);
            drawerButton.on("action", () => openDemoDrawer(edge, true, label));
            leftColumn.addComponent(drawerButton);
        }

        // Wire `action` declaratively through the typed `listeners` bag — the
        // bag mirrors the component's `on()` surface, so `action` is offered and
        // typed here while any non-`on()` key would be a compile error.
        const nonModalDrawerButton = new Button("Non-modal drawer (left)", {
            listeners: { action: () => openDemoDrawer(Placement.WEST, false, "left") },
        });
        leftColumn.addComponent(nonModalDrawerButton);

        // Rail demo — a persistent launcher strip along the left edge. Unlike a
        // drawer it never slides away; its handles toggle two registered
        // (non-modal) drawers, and a window minimizes *into* the rail as a
        // handle that restores it on click. The button toggles the whole rail
        // on and off so it doesn't permanently cover the demo. The rail is built
        // once and only mounted/unmounted, so its collapsed state is remembered
        // across toggles.
        let demoRail: Rail | null = null;
        let railMounted = false;
        const buildRailDrawer = (label: string): Drawer => {
            const drawer = new Drawer({ modal: false, layoutManager: new VBox({ stretching: true }) });

            const heading = new Text(label + " drawer — opened from its rail handle");
            heading.setFontWeight("bold");
            heading.setPreferredSize({ width: 0, height: 28 });

            const closeButton = new Button("Close");
            closeButton.setPreferredSize({ width: 0, height: 32 });
            closeButton.on("action", () => { drawer.close(); });

            drawer.addComponent(heading);
            drawer.addComponent(closeButton);

            return drawer;
        };

        const railButton = new Button("Toggle launcher rail (Rail)");
        railButton.on("action", () => {
            // Build the rail (and its drawers + minimizable window) once, the
            // first time it is shown. Reusing the instance means its
            // collapsed/expanded state survives later unmount/mount toggles.
            if (!demoRail) {
                demoRail = new Rail({ edge: Placement.EAST, orientation: "vertical-cw" });
                demoRail.registerDrawer(buildRailDrawer("Filters"), { glyph: "filter", text: "Filters" });
                demoRail.registerDrawer(buildRailDrawer("Info"), { glyph: "circle-info", text: "Info" });

                const win = new Window("Rail-docked window", { minimizable: true, glyph: "file" });
                win.setX(220);
                win.setY(140);
                win.setWidth(360);
                win.setHeight(240);
                win.setRail(demoRail);
                win.show();
            }

            if (railMounted) {
                demoRail.unmount();
                railMounted = false;
            } else {
                demoRail.mount();
                railMounted = true;
            }
        });
        leftColumn.addComponent(railButton);

        // Dock demo — a rearrangeable VS Code / GoldenLayout style layout. The
        // initial arrangement is a horizontal split: a two-tab group on the left
        // and a single panel on the right. Drag a tab to reorder, drop one on a
        // region edge to split, or tear it off into a floating window — the float
        // is itself a mini-dock you can edge-split, arrange, and re-dock against
        // the main dock in both directions. Save/Restore round-trips the whole
        // arrangement, including each float's internal split/tab tree.
        const dockButton = new Button("Dockable layout (Dock)");
        dockButton.on("action", () => {
            const win = new Window("Dockable layout");
            win.setX(180);
            win.setY(120);
            win.setWidth(720);
            win.setHeight(460);

            const dockPanel = (text: string): (() => Component) => () => {
                const host = new Panel({ layoutManager: new Fit() });
                host.addComponent(new Text(text));

                return host;
            };

            // Content that is not available until a simulated fetch resolves.
            // The dock shows its tab at once and holds a spinner for the wait.
            const dockAsyncPanel = (text: string): Promise<Component> => new Promise<Component>(resolve => {
                setTimeout(() => resolve(dockPanel(text)()), 1200);
            });

            // Content whose simulated fetch fails: the whole docked panel closes
            // itself and the dock emits "exception" after its own "close".
            const dockFailingPanel = (title: string): Promise<Component> => new Promise<Component>((_resolve, reject) => {
                setTimeout(() => reject(new Error(`${title}: content fetch failed`)), 800);
            });

            // A start-page placeholder shown only while the dock holds no panel:
            // close every tab to see it, open one to hide it again. It is chrome —
            // shown as a single non-closeable tab (labelled by its name), never
            // serialized.
            const emptyState = new Panel({ layoutManager: new Fit(), name: "Welcome" });
            emptyState.addComponent(new Text("No panels open — close all tabs to see this start page."));

            const dock = new Dock({
                emptyContent: emptyState,
                layout: {
                    split: "horizontal",
                    children: [
                        { tabs: [
                            { id: "explorer", title: "Explorer", content: dockPanel("Explorer — drag this tab to reorder or tear it off.") },
                            { id: "search",   title: "Search",   content: dockPanel("Search panel.") },
                        ] },
                        { id: "editor", title: "Editor", content: dockPanel("Editor — drop a tab on an edge to split this region.") },
                        { id: "vbox_test", title: "VBox", content: VBoxPanel() },
                    ],
                },
            });

            // Log the panel lifecycle so the events are observable from the
            // console while dragging, tearing off, focusing, and closing panels.
            // The host annotation names which host the event concerns: the float
            // window title, or "(tiled)" for the main dock. A detach can name a
            // float the panel just emptied (its title is then ""), so fall back to
            // "(window)" to keep the line readable.
            const host = (e: DockPanelEvent | null): string => e?.window ? (e.window.getTitle() || "(window)") : "(tiled)";

            dock.on("attach", e => console.log(`[Dock] attach: ${e.id} -> ${host(e)}`));
            dock.on("detach", e => console.log(`[Dock] detach: ${e.id} -> ${host(e)}`));
            dock.on("move",  e => console.log(`[Dock] moved: ${e.id} -> ${host(e)}`));
            dock.on("focus",  e => console.log(`[Dock] focus: ${e ? `${e.id} -> ${host(e)}` : "(none)"}`));
            dock.on("close",  e => console.log(`[Dock] close: ${e.id}`));
            dock.on("emptychange", e => console.log(`[Dock] emptychange: empty=${e.empty}`));
            dock.on("exception", e => console.log(`[Dock] exception: ${e.id} — ${String(e.error)}`));

            let savedLayout: LayoutState | null = null;
            const toolbar = new ToolBar();

            const saveButton = new Button("Save layout");
            saveButton.on("action", () => {
                savedLayout = dock.getLayoutState();
            });

            const restoreButton = new Button("Restore layout");
            restoreButton.on("action", () => {
                if (savedLayout) {
                    dock.setLayoutState(savedLayout);
                }
            });

            // addLazyPanel, not the `layout` spec — that compiles through the
            // eager addPanel, which rejects an async factory by design.
            let asyncPanelCounter = 0;
            const addAsyncButton = new Button("Add async panel");
            addAsyncButton.on("action", () => {
                asyncPanelCounter += 1;
                dock.addLazyPanel({
                    id:      `async-${asyncPanelCounter}`,
                    title:   "Async",
                    glyph:   "file-lines",
                    tooltip: "Resolves after a wait",
                    content: () => dockAsyncPanel("Async — resolved after a wait."),
                });
            });

            // A fixed id, so pressing it again after a failure re-adds the same
            // panel and starts a fresh load — a failed panel stays registered.
            const addFailingButton = new Button("Add failing panel");
            addFailingButton.on("action", () => {
                dock.addLazyPanel({
                    id:      "failing",
                    title:   "Failing",
                    glyph:   "exclamation-triangle",
                    content: () => dockFailingPanel("Failing"),
                });
            });

            toolbar.addComponent(saveButton);
            toolbar.addComponent(restoreButton);
            toolbar.addComponent(addAsyncButton);
            toolbar.addComponent(addFailingButton);

            const body = new Container({ layoutManager: new Border() });
            body.addComponent(toolbar, { placement: Placement.NORTH });
            body.addComponent(dock, { placement: Placement.CENTER });

            win.addComponent(body);
            win.show();
        });
        leftColumn.addComponent(dockButton);

        const spacer = new Spacer({ flex: true });
        leftColumn.addComponent(spacer);

        const buttonTreeIcons = new Button("Show tree component (icon renderer)");
        buttonTreeIcons.on("action", () => {
            const win = new Window("Tree — IconLabel renderer");
            win.setX(220);
            win.setY(170);
            win.setWidth(320);
            win.setHeight(400);

            win.setContentFactory(() => {
                const treeData: TreeNode[] = [
                    {
                        label: "src", children: [
                            {
                                label: "lib", children: [
                                    { label: "Component.ts" },
                                    { label: "Event.ts" },
                                ],
                            },
                            { label: "main.ts" },
                        ],
                    },
                    {
                        label: "docs", children: [
                            { label: "guide.md" },
                            { label: "api.md" },
                        ],
                    },
                    { label: "package.json" },
                ];

                const tree = new Tree();
                tree.setRendererFactory(() => new IconLabelTreeNodeRenderer(
                    (node) => {
                        if (node.children && node.children.length > 0) {
                            return "folder";
                        }

                        const label = node.label ?? "";

                        if (label.endsWith(".ts") || label.endsWith(".json")) {
                            return "file-code";
                        }
                        if (label.endsWith(".md")) {
                            return "file-lines";
                        }

                        return "file";
                    },
                ));
                tree.setNodes(treeData);

                return tree;
            });

            win.show();
        });
        leftColumn.addComponent(buttonTreeIcons);

        const buttonNotificationInfo = new Button("Notification — info");
        buttonNotificationInfo.on("action", () => {
            Notification.show("This is an informational message.", "info");
        });
        leftColumn.addComponent(buttonNotificationInfo);

        const buttonNotificationSuccess = new Button("Notification — success");
        buttonNotificationSuccess.on("action", () => {
            Notification.show("Record saved successfully.", "success");
        });
        leftColumn.addComponent(buttonNotificationSuccess);

        const buttonNotificationWarning = new Button("Notification — warning");
        buttonNotificationWarning.on("action", () => {
            Notification.show("Unsaved changes will be lost.", "warning");
        });
        leftColumn.addComponent(buttonNotificationWarning);

        const buttonNotificationError = new Button("Notification — error");
        buttonNotificationError.on("action", () => {
            Notification.show("Connection failed. Please try again.", "error");
        });
        leftColumn.addComponent(buttonNotificationError);

        const buttonNotificationStack = new Button("Notification — show all types");
        buttonNotificationStack.on("action", () => {
            Notification.show("This is an informational message.", "info");
            Notification.show("Record saved successfully.", "success");
            Notification.show("Unsaved changes will be lost.", "warning");
            Notification.show("Connection failed. Please try again.", "error");
        });
        leftColumn.addComponent(buttonNotificationStack);

        // Reviews the notifications shown above: opens a menu of the in-session
        // history, newest first, each row re-opening that notification's detail.
        leftColumn.addComponent(new NotificationHistoryButton());

        // Mixed-case fruits so the *CaseSensitive match modes produce a
        // visibly-different result set than the default case-insensitive ones.
        const fruits = [
            "Apple", "apricot", "Avocado", "Banana", "BANANA", "Blackberry",
            "blueberry", "Cherry", "Clementine", "Coconut", "Date", "Fig",
            "Grape", "Grapefruit", "Guava", "Kiwi", "Lemon", "Lime", "Lychee",
            "Mango", "Melon", "Nectarine", "Orange", "Papaya", "Peach", "Pear",
            "Pineapple", "Plum", "Pomegranate", "Raspberry", "Strawberry",
            "Tangerine", "Watermelon",
        ];

        const autoCompleteField = new AutoCompleteField({
            suggestions   : fruits,
            placeholder   : "Type a fruit…",
            maxSuggestions: 8,
        });

        const selectedText = new Text("Selected: (none)");

        autoCompleteField.addSelectListener(value => {
            selectedText.setText("Selected: " + value);
        });

        const radioContains      = new RadioButton("Contains");
        const radioStartsWith    = new RadioButton("Starts with");
        const radioContainsCS    = new RadioButton("Contains (CS)");
        const radioStartsWithCS  = new RadioButton("Starts with (CS)");
        radioContains.setSelected(true);

        const modeGroup = new ButtonGroup();
        modeGroup.addButton(radioContains);
        modeGroup.addButton(radioStartsWith);
        modeGroup.addButton(radioContainsCS);
        modeGroup.addButton(radioStartsWithCS);

        modeGroup.on("selection", (button) => {
            if (button === radioContains) {
                autoCompleteField.setMatchMode('contains');
            } else if (button === radioStartsWith) {
                autoCompleteField.setMatchMode('startsWith');
            } else if (button === radioContainsCS) {
                autoCompleteField.setMatchMode('containsCaseSensitive');
            } else {
                autoCompleteField.setMatchMode('startsWithCaseSensitive');
            }
        });

        const modeRow = new Component({ layoutManager: new HBox() })
            .addComponent(new Text("Match mode:"))
            .addComponent(radioContains)
            .addComponent(radioStartsWith)
            .addComponent(radioContainsCS)
            .addComponent(radioStartsWithCS);

        const autoCompleteRow = new Component();
        autoCompleteRow.setLayoutManager(new HBox());
        autoCompleteRow.addComponent(new Text("AutoComplete:"));
        autoCompleteRow.addComponent(autoCompleteField);
        rightColumn.addComponent(modeRow);
        rightColumn.addComponent(autoCompleteRow);
        rightColumn.addComponent(selectedText);

        const buttonDialogConfirm = new Button("Dialog — confirm/cancel");
        buttonDialogConfirm.on("action", () => void (async () => {
            const confirmed = await Dialog.confirm(
                'Confirm action',
                'Are you sure you want to proceed with this action?'
            );

            Notification.show(`Dialog closed with: ${confirmed ? 'confirm' : 'cancel'}`, confirmed ? 'success' : 'info');
        })());
        leftColumn.addComponent(buttonDialogConfirm);

        const buttonDialogOk = new Button("Dialog — OK only");
        buttonDialogOk.on("action", () => void (async () => {
            await Dialog.show({
                title  : 'Information',
                message: 'This is a simple informational dialog with a single OK button.',
            });
        })());
        leftColumn.addComponent(buttonDialogOk);

        const buttonDialogBackdrop = new Button("Dialog — close on backdrop click");
        buttonDialogBackdrop.on("action", () => void (async () => {
            const result = await Dialog.show({
                title          : 'Click outside to close',
                message        : 'You can dismiss this dialog by clicking the backdrop or pressing Escape.',
                closeOnBackdrop: true,
            });

            Notification.show(`Dialog closed with: ${result}`, 'info');
        })());
        leftColumn.addComponent(buttonDialogBackdrop);

        const buttonDialogNonDismissable = new Button("Dialog — non-dismissable (mandatory)");
        buttonDialogNonDismissable.on("action", () => void (async () => {
            const result = await Dialog.show({
                title      : 'Mandatory action required',
                message    : 'This dialog has no close button, and Escape and the backdrop are both inert — only the footer button below can dismiss it.',
                dismissable: false,
                buttons    : [{ text: 'OK', result: 'confirm', primary: true }],
            });

            Notification.show(`Dialog closed with: ${result}`, 'info');
        })());
        leftColumn.addComponent(buttonDialogNonDismissable);

        // The severity-toned OK dialogs — one per Dialog.info/success/warning/error
        // shorthand (each tints the title bar and shows a matching glyph).
        const buttonDialogInfo = new Button("Dialog — info");
        buttonDialogInfo.on("action", () => void Dialog.info('Import complete', 'Loaded 1,204 rows.'));
        leftColumn.addComponent(buttonDialogInfo);

        const buttonDialogSuccess = new Button("Dialog — success");
        buttonDialogSuccess.on("action", () => void Dialog.success('Saved', 'Your changes have been stored.'));
        leftColumn.addComponent(buttonDialogSuccess);

        const buttonDialogWarning = new Button("Dialog — warning");
        buttonDialogWarning.on("action", () => void Dialog.warning('Unsaved changes', 'They will be lost if you continue.'));
        leftColumn.addComponent(buttonDialogWarning);

        const buttonDialogError = new Button("Dialog — error");
        buttonDialogError.on("action", () => void Dialog.error('Connection failed', 'Host not allowed.'));
        leftColumn.addComponent(buttonDialogError);

        const formNameField  = new TextField({ placeholder: 'Name' });
        const formEmailField = new TextField({ placeholder: 'Email' });

        const miscForm = new Form({
            layoutManager: new VBox(),
            components   : [formNameField, formEmailField],
            onSubmit     : () => Notification.show('Form submitted', 'success'),
        });
        miscForm.setPreferredSize({ width: 240, height: 90 });

        const buttonFormSubmit = new Button("Submit");
        buttonFormSubmit.on("action", () => miscForm.requestSubmit());

        const formRow = new Component({ layoutManager: new HBox() })
            .addComponent(miscForm)
            .addComponent(buttonFormSubmit);

        leftColumn.addComponent(formRow);

        const integerSpinner = new NumberSpinner({
            min  : 0,
            max  : 10,
            step : 1,
            value: 3,
        });

        const decimalSpinner = new NumberSpinner({
            min  : -1,
            max  : 1,
            step : 0.1,
            value: 0,
        });

        const unboundedSpinner = new NumberSpinner({
            step : 5,
            value: 100,
        });

        const spinnerText = new Text("Spinners — integer: 3, decimal: 0.0, unbounded: 100");
        const updateSpinnerText = (): void => {
            spinnerText.setText(
                "Spinners — integer: " + integerSpinner.getValue()
                + ", decimal: "  + decimalSpinner.getValue().toFixed(1)
                + ", unbounded: " + unboundedSpinner.getValue()
            );
        };

        integerSpinner.on("change", updateSpinnerText);
        decimalSpinner.on("change", updateSpinnerText);
        unboundedSpinner.on("change", updateSpinnerText);

        const spinnerRow = new Component();
        spinnerRow.setLayoutManager(new HBox());
        spinnerRow.addComponent(new Text("0–10:"));
        spinnerRow.addComponent(integerSpinner);
        spinnerRow.addComponent(new Text("-1..1 step 0.1:"));
        spinnerRow.addComponent(decimalSpinner);
        spinnerRow.addComponent(new Text("step 5:"));
        spinnerRow.addComponent(unboundedSpinner);

        rightColumn.addComponent(spinnerRow);
        rightColumn.addComponent(spinnerText);

        const progressBar = new ProgressBar(0, false, {
            preferredSize: { width: 300, height: 12 },
            insets       : new Insets(0, 0, 0, 0),
        });

        const progressText = new Text("Progress: 0%");

        const progressBarRow = new Component();
        progressBarRow.setLayoutManager(new HBox());
        progressBarRow.addComponent(new Text("ProgressBar:"));
        progressBarRow.addComponent(progressBar);
        progressBarRow.addComponent(progressText);

        rightColumn.addComponent(progressBarRow);

        const buttonProgressStart = new Button("Animate progress bar");
        let progressAnimationHandle: ReturnType<typeof setInterval> | null = null;
        buttonProgressStart.on("action", () => {
            if (progressAnimationHandle !== null) {
                clearInterval(progressAnimationHandle);
            }

            progressBar.setIndeterminate(false);
            let v = 0;
            progressBar.setValue(0);
            progressText.setText("Progress: 0%");

            progressAnimationHandle = setInterval(() => {
                v += 5;
                progressBar.setValue(v);
                progressText.setText("Progress: " + v + "%");

                if (v >= 100 && progressAnimationHandle !== null) {
                    clearInterval(progressAnimationHandle);
                    progressAnimationHandle = null;
                }
            }, 100);
        });
        rightColumn.addComponent(buttonProgressStart);

        const buttonProgressIndeterminate = new Button("Toggle indeterminate progress bar");
        buttonProgressIndeterminate.on("action", () => {
            progressBar.setIndeterminate(!progressBar.isIndeterminate());
            progressText.setText(progressBar.isIndeterminate() ? "Progress: indeterminate" : "Progress: " + progressBar.getValue() + "%");
        });
        rightColumn.addComponent(buttonProgressIndeterminate);

        const inlineSpinner = new ProgressSpinner();
        const spinnerDemoRow = new Component();
        spinnerDemoRow.setLayoutManager(new HBox());
        spinnerDemoRow.addComponent(new Text("Inline ProgressSpinner:"));
        spinnerDemoRow.addComponent(inlineSpinner);
        rightColumn.addComponent(spinnerDemoRow);

        const glyphRow = new Component();
        glyphRow.setLayoutManager(new HBox());
        glyphRow.addComponent(new Text("Glyphs:"));
        glyphRow.addComponent(new Glyph("xmark"));
        glyphRow.addComponent(new Glyph("arrow-right"));
        glyphRow.addComponent(new Glyph("arrow-down"));
        rightColumn.addComponent(glyphRow);

        const animatedGlyphRow = new Component();
        animatedGlyphRow.setLayoutManager(new HBox());
        animatedGlyphRow.addComponent(new Text("Animated glyphs:"));
        animatedGlyphRow.addComponent(new Glyph("xmark",       { animation: "spin"  }));
        animatedGlyphRow.addComponent(new Glyph("arrow-right", { animation: "pulse" }));
        animatedGlyphRow.addComponent(new Glyph("arrow-down",  { animation: "beat"  }));
        rightColumn.addComponent(animatedGlyphRow);

        const buttonWithGlyph = new Button("Save", { glyph: "xmark" });
        rightColumn.addComponent(buttonWithGlyph);

        const iconTextRow = new Component();
        iconTextRow.setLayoutManager(new HBox());
        iconTextRow.addComponent(new Text("IconText:"));
        iconTextRow.addComponent(new IconText("xmark", "Close"));
        iconTextRow.addComponent(new IconText("arrow-right", "Next"));
        rightColumn.addComponent(iconTextRow);

        // Link: the hit area is exactly the text. The HBox row is load-bearing —
        // it sizes the link to its preferred (natural) width; a stretching
        // parent would widen the box and the hit area with it.
        const linkRow = new Component();
        linkRow.setLayoutManager(new HBox());
        linkRow.addComponent(new Text("Link:"));
        linkRow.addComponent(new Link("Open the release notes", {
            listeners: { action: () => Notification.show("Link actioned — click and Enter both land here.", "info") },
        }));
        rightColumn.addComponent(linkRow);

        const iconLabelField = new TextField();
        const iconLabelRow = new Component();
        iconLabelRow.setLayoutManager(new HBox());
        iconLabelRow.addComponent(new IconLabel("xmark", "Email:", iconLabelField.getId()));
        iconLabelRow.addComponent(iconLabelField);
        rightColumn.addComponent(iconLabelRow);

        const buttonGlyphWindow = new Button("Show window with title glyph");
        buttonGlyphWindow.on("action", () => {
            const win = new Window("Settings", { glyph: "arrow-right" });
            win.setX(220);
            win.setY(180);
            win.setWidth(300);
            win.setHeight(180);
            win.show();
        });
        rightColumn.addComponent(buttonGlyphWindow);

        const buttonOverlaySpinner = new Button("Overlay spinner on this panel for 2 s");
        buttonOverlaySpinner.on("action", () => {
            const overlay = new ProgressSpinner(48);
            overlay.showOverlay(this);

            setTimeout(() => overlay.hideOverlay(), 2000);
        });
        rightColumn.addComponent(buttonOverlaySpinner);

        // ── AnimatedDropdown demo: ComboBox / DateField / TimeField / DateTimeField ──
        const animatedDropdownsLabel = new Text("Animated dropdowns:");
        rightColumn.addComponent(animatedDropdownsLabel);

        const fieldsRow = new Component();
        fieldsRow.setLayoutManager(new HBox());

        const animatedCombo = new ComboBox({
            items: ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry'],
        });
        fieldsRow.addComponent(animatedCombo);

        const animatedDate = new DateField({
            // Bounded range exercises the year-scroller and disabled-day rendering
            // in the picker dropdown — see plans/implemented/datepicker-year-selection.md.
            minDate: new Date(2000, 0, 1),
            maxDate: new Date(2030, 11, 31),
        });
        fieldsRow.addComponent(animatedDate);

        const animatedTime = new TimeField({ showSeconds: true });
        fieldsRow.addComponent(animatedTime);

        const animatedDateTime = new DateTimeField({ showSeconds: true });
        fieldsRow.addComponent(animatedDateTime);

        rightColumn.addComponent(fieldsRow);

        // ── PopupButton: a custom popup panel built from ordinary components ──
        const popupButton: PopupButton = new PopupButton("Filters (PopupPanel)", {
            panel: () => {
                const showArchived = new Checkbox({ label: "Show archived" });
                const onlyMine     = new Checkbox({ label: "Only mine" });
                const apply        = new Button("Apply");

                const panel = new PopupPanel({
                    layoutManager: new VBox({ spacing: 4, stretching: true }),
                    components:    [showArchived, onlyMine, apply],
                });

                apply.on("action", () => { panel.hideAnimated(); });

                return panel;
            },
        });
        rightColumn.addComponent(popupButton);

        // ── Item renderers: a glyph beside each entry (List + ComboBox) ──
        // One GlyphListItemRenderer factory drives the ComboBox dropdown rows,
        // the standalone List rows, AND the collapsed ComboBox control, sourcing
        // each icon from the item's `glyph` field. Glyphs used here are already
        // registered above.
        const glyphItems = [
            { key: 'folder', label: 'Folder',     glyph: 'folder'      },
            { key: 'file',   label: 'Document',   glyph: 'file'        },
            { key: 'code',   label: 'Source',     glyph: 'file-code'   },
            { key: 'save',   label: 'Save As…',   glyph: 'floppy-disk' },
        ];

        const glyphRenderersLabel = new Text("Item renderers (glyph per entry):");
        rightColumn.addComponent(glyphRenderersLabel);

        const glyphRenderRow = new Component();
        glyphRenderRow.setLayoutManager(new HBox());

        const glyphCombo = new ComboBox({ rendererFactory: () => new GlyphListItemRenderer() });
        glyphCombo.setItems(glyphItems);
        glyphRenderRow.addComponent(glyphCombo);

        const glyphList = new List({
            rendererFactory: () => new GlyphListItemRenderer(),
            preferredSize:   { width: 160, height: 96 },
        });
        glyphList.setItems(glyphItems);
        glyphList.setSelectedIndex(0, false);
        glyphRenderRow.addComponent(glyphList);

        rightColumn.addComponent(glyphRenderRow);

        // ── Canvas demo ──
        // A raster surface has no intrinsic size, so it needs an explicit
        // preferredSize (or a stretching parent). `onDraw` draws in CSS pixels —
        // the dpr transform is applied — so it stays crisp on HiDPI and after a
        // resize. A phase field animated by the loop makes the pulse visible.
        rightColumn.addComponent(new Text("Canvas (onDraw + animation):"));

        // Matches the rate the old per-frame `+= 0.1` produced at 60fps, now
        // expressed per second so it is refresh-rate independent.
        const CANVAS_PULSE_RADIANS_PER_SECOND = 6;

        let canvasPhase = 0;

        const demoCanvas = new Canvas({
            preferredSize: { width: 240, height: 120 },
            onDraw: (ctx, width, height) => {
                ctx.fillStyle = "rgb(30, 30, 30)";
                ctx.fillRect(0, 0, width, height);

                // Pulse the radius between 20 and 40 px off the phase so the
                // animation loop has something visibly moving to draw.
                const radius = 30 + Math.sin(canvasPhase) * 10;

                ctx.fillStyle = "rgb(21, 101, 192)";
                ctx.beginPath();
                ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
                ctx.fill();

                // 0.5-px inset keeps the 1-px stroke on the pixel grid (crisp).
                ctx.strokeStyle = "rgb(255, 255, 255)";
                ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
            },
        });

        const canvasRow = new Component();
        canvasRow.setLayoutManager(new HBox());
        canvasRow.addComponent(demoCanvas);

        const buttonCanvasAnimate = new Button("Toggle canvas animation");
        buttonCanvasAnimate.on("action", () => {
            if (demoCanvas.isAnimating()) {
                demoCanvas.stopAnimation();
                return;
            }

            demoCanvas.setOnDraw((ctx, width, height, elapsedMs) => {
                // Breathe at a fixed ~6 rad/s, derived from elapsed time rather
                // than incremented per frame, so the rate does not scale with
                // the display's refresh rate.
                canvasPhase = elapsedMs / 1000 * CANVAS_PULSE_RADIANS_PER_SECOND;

                ctx.fillStyle = "rgb(30, 30, 30)";
                ctx.fillRect(0, 0, width, height);

                const radius = 30 + Math.sin(canvasPhase) * 10;

                ctx.fillStyle = "rgb(21, 101, 192)";
                ctx.beginPath();
                ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
                ctx.fill();
            });
            demoCanvas.startAnimation();
        });
        canvasRow.addComponent(buttonCanvasAnimate);

        rightColumn.addComponent(canvasRow);

        // ── VideoPlayer demo ──
        // A composite player: native <video> surface framed by a control bar
        // built from this library's own Button / Slider / Text primitives. Uses a
        // small public-domain sample clip so playback, scrubbing, volume, mute,
        // and fullscreen can be exercised live.
        rightColumn.addComponent(new Text("VideoPlayer:"));

        const demoPlayer = new VideoPlayer({
            src:          "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
            preferredSize: { width: 360, height: 240 },
        });

        const playerRow = new Component();
        playerRow.setLayoutManager(new HBox());
        playerRow.addComponent(demoPlayer);

        rightColumn.addComponent(playerRow);

        // ── WebGLCanvas demo ──
        // A GPU surface has no intrinsic size, so it needs an explicit
        // preferredSize. `onContextInit` builds GL resources once (and again
        // after a context restore); `onFrame` draws each frame — here it animates
        // the clear colour so the render loop (auto-started on first layout) is
        // visibly running. The viewport is already set in device pixels.
        rightColumn.addComponent(new Text("WebGLCanvas (animated clear colour):"));

        // Matches the rate the old per-frame `+= 0.02` produced at 60fps.
        const GL_SWEEP_RADIANS_PER_SECOND = 1.2;

        const demoWebGL = new WebGLCanvas({
            preferredSize: { width: 240, height: 120 },
            onFrame: (gl, _width, _height, elapsedMs) => {
                // Sweep the clear colour through a slow hue-ish pulse so the
                // continuously-running loop is obviously alive. Derived from
                // elapsed time, not incremented per frame, so the sweep runs at
                // the same speed on a 60Hz and a 180Hz display.
                const glPhase = elapsedMs / 1000 * GL_SWEEP_RADIANS_PER_SECOND;

                gl.clearColor(
                    0.5 + 0.5 * Math.sin(glPhase),
                    0.5 + 0.5 * Math.sin(glPhase + 2),
                    0.5 + 0.5 * Math.sin(glPhase + 4),
                    1,
                );
                gl.clear(gl.COLOR_BUFFER_BIT);
            },
        });

        const webglRow = new Component();
        webglRow.setLayoutManager(new HBox());
        webglRow.addComponent(demoWebGL);

        const buttonWebGLAnimate = new Button("Toggle WebGL animation");
        buttonWebGLAnimate.on("action", () => {
            if (demoWebGL.isAnimating()) {
                demoWebGL.stopAnimation();
                return;
            }

            demoWebGL.startAnimation();
        });
        webglRow.addComponent(buttonWebGLAnimate);

        rightColumn.addComponent(webglRow);

        // ── Panel auto-scroll demo ──
        const autoScrollLabel = new Text("Panel auto-scroll modes:");
        leftColumn.addComponent(autoScrollLabel);

        const autoScrollRow = new Component();
        autoScrollRow.setLayoutManager(new HBox());

        const autoScrollModes: AutoScrollMode[] = ["none", "auto", "x", "y", "both"];

        for (const mode of autoScrollModes) {
            const button = new Button("autoScroll: " + mode);
            button.on("action", () => {
                const win = new Window("Panel autoScroll = \"" + mode + "\"");
                win.setX(240);
                win.setY(200);
                win.setWidth(360);
                win.setHeight(240);

                win.setContentFactory(() => {
                    // Oversized child: 800 x 600 inside a ~360 x 200 viewport so
                    // both axes overflow under every non-"none" mode.
                    const oversized = new Component({
                        preferredSize  : { width: 800, height: 600 },
                        minSize        : { width: 800, height: 600 },
                        maxSize        : { width: 800, height: 600 },
                        backgroundColor: "lightsteelblue",
                    });

                    const scrollPanel: Panel = new Panel({
                        layoutManager: new Absolute(),
                        autoScroll: mode
                    });

                    scrollPanel.addComponent(oversized);

                    return scrollPanel;
                });

                win.show();
            });
            autoScrollRow.addComponent(button);
        }

        // The autoScroll windows above show the position-aware edge shadows by
        // default; this button opens the same overflowing panel with
        // `scrollShadows: false` so the suppressed state can be compared.
        const noShadowButton = new Button("autoScroll: both (no shadows)");
        noShadowButton.on("action", () => {
            const win = new Window("scrollShadows: false");
            win.setX(280);
            win.setY(240);
            win.setWidth(360);
            win.setHeight(240);

            win.setContentFactory(() => {
                const oversized = new Component({
                    preferredSize  : { width: 800, height: 600 },
                    minSize        : { width: 800, height: 600 },
                    maxSize        : { width: 800, height: 600 },
                    backgroundColor: "lightsteelblue",
                });

                const scrollPanel: Panel = new Panel({
                    layoutManager: new Absolute(),
                    autoScroll:    "both",
                    scrollShadows: false,
                });

                scrollPanel.addComponent(oversized);

                return scrollPanel;
            });

            win.show();
        });
        autoScrollRow.addComponent(noShadowButton);

        // The autoScroll windows above default to `scrollbarStyle: "overlay"`
        // (synced Scrollbar widgets over native scroll, native bar hidden);
        // this button opens the same overflowing panel with the explicit
        // `"native"` opt-out so the OS scrollbar can be compared side by side.
        const nativeScrollbarButton = new Button("scrollbarStyle: native (compare)");
        nativeScrollbarButton.on("action", () => {
            const win = new Window("scrollbarStyle: \"native\"");
            win.setX(320);
            win.setY(280);
            win.setWidth(360);
            win.setHeight(240);

            win.setContentFactory(() => {
                const oversized = new Component({
                    preferredSize  : { width: 800, height: 600 },
                    minSize        : { width: 800, height: 600 },
                    maxSize        : { width: 800, height: 600 },
                    backgroundColor: "lightsteelblue",
                });

                const scrollPanel: Panel = new Panel({
                    layoutManager: new Absolute(),
                    autoScroll:    "both",
                    scrollbarStyle: "native",
                });

                scrollPanel.addComponent(oversized);

                return scrollPanel;
            });

            win.show();
        });
        autoScrollRow.addComponent(nativeScrollbarButton);

        leftColumn.addComponent(autoScrollRow);

        // ── Anchor layout demo ──
        // Resize the window and watch all three children re-anchor on the
        // resize-driven doLayout, unlike Absolute's static placement.
        const anchorLabel = new Text("Anchor layout (resize the window):");
        leftColumn.addComponent(anchorLabel);

        const anchorButton = new Button("Open Anchor demo window");
        anchorButton.on("action", () => {
            const win = new Window("Anchor layout");
            win.setX(260);
            win.setY(220);
            win.setWidth(360);
            win.setHeight(260);

            win.setContentFactory(() => {
                const anchorPanel: Panel = new Panel({ layoutManager: new Anchor() });

                // Full-width header band pinned to the top, stretched between the
                // left and right edges at a fixed 40px height.
                const header = new Component({ backgroundColor: "steelblue" });
                const headerCons = new AnchorConstraints();
                headerCons.left = 0;
                headerCons.right = 0;
                headerCons.top = 0;
                headerCons.height = 40;
                anchorPanel.addComponent(header, headerCons);

                // Centred box: 25% inset from the top-left, sized to half the
                // container on each axis via percentage values.
                const centre = new Component({ backgroundColor: "lightgoldenrodyellow" });
                const centreCons = new AnchorConstraints();
                centreCons.left = { percent: 25 };
                centreCons.top = { percent: 25 };
                centreCons.width = { percent: 50 };
                centreCons.height = { percent: 50 };
                anchorPanel.addComponent(centre, centreCons);

                // Button pinned 8px from the bottom-right corner at a fixed size.
                const pinned = new Button("Pinned");
                const pinnedCons = new AnchorConstraints();
                pinnedCons.right = 8;
                pinnedCons.bottom = 8;
                pinnedCons.width = 120;
                pinnedCons.height = 32;
                anchorPanel.addComponent(pinned, pinnedCons);

                return anchorPanel;
            });

            win.show();
        });
        leftColumn.addComponent(anchorButton);

        // ── Popover demo ──
        const popoverLabel = new Text("Popovers (placement and dismiss modes):");
        leftColumn.addComponent(popoverLabel);

        const popoverRow = new Component();
        popoverRow.setLayoutManager(new HBox());

        // Auto-placement: a popover whose chosen side flips based on viewport space.
        const buttonPopoverAuto = new Button("Auto placement");
        const popoverAuto = new Popover({
            placement: "auto",
            dismissOn: "click-outside",
            title    : "Auto placement",
        });
        popoverAuto.setBody("Resolves the side with the most viewport space at show time.");
        popoverAuto.addAction("OK", () => popoverAuto.hide());
        Event.addListener(buttonPopoverAuto, "click", () => {
            if (popoverAuto.isOpen()) {
                popoverAuto.hide();
            } else {
                popoverAuto.attachToComponent(buttonPopoverAuto);
                popoverAuto.show();
            }
        });
        popoverRow.addComponent(buttonPopoverAuto);

        // Explicit placement: opens to the right; falls back to left if the viewport is too narrow.
        const buttonPopoverRight = new Button("Explicit right");
        const popoverRight = new Popover({
            placement: "right",
            dismissOn: "click-outside",
            title    : "Explicit placement",
        });
        popoverRight.setBody("Opens to the right; flips to the left only when the viewport cannot fit it.");
        Event.addListener(buttonPopoverRight, "click", () => {
            if (popoverRight.isOpen()) {
                popoverRight.hide();
            } else {
                popoverRight.attachToComponent(buttonPopoverRight);
                popoverRight.show();
            }
        });
        popoverRow.addComponent(buttonPopoverRight);

        // Blur dismissal.
        const buttonPopoverBlur = new Button("Dismiss on blur");
        const popoverBlur = new Popover({
            placement: "bottom",
            dismissOn: "blur",
            title    : "Blur dismissal",
        });
        popoverBlur.setBody("Tab focus outside the popover (or click outside) to close.");
        popoverBlur.addAction("OK", () => popoverBlur.hide());
        Event.addListener(buttonPopoverBlur, "click", () => {
            if (popoverBlur.isOpen()) {
                popoverBlur.hide();
            } else {
                popoverBlur.attachToComponent(buttonPopoverBlur);
                popoverBlur.show();
            }
        });
        popoverRow.addComponent(buttonPopoverBlur);

        // Manual dismissal — only programmatic hide() closes it.
        const buttonPopoverManual = new Button("Manual dismissal");
        const popoverManual = new Popover({
            placement: "top",
            dismissOn: "manual",
            title    : "Manual",
        });
        popoverManual.setBody("Only the Close button below dismisses this popover.");
        popoverManual.addAction("Close", () => popoverManual.hide());
        Event.addListener(buttonPopoverManual, "click", () => {
            if (popoverManual.isOpen()) {
                popoverManual.hide();
            } else {
                popoverManual.attachToComponent(buttonPopoverManual);
                popoverManual.show();
            }
        });
        popoverRow.addComponent(buttonPopoverManual);

        // Nested layer demo: a blur-dismiss popover hosting a ComboBox. Opening
        // the ComboBox's dropdown registers it as the popover's child layer, so
        // clicking a dropdown row (which lands in a sibling-rooted portal, not
        // inside the popover's own element) keeps the popover open — the case
        // the central LayerManager exists to handle. Picking a row commits to
        // the ComboBox without dismissing the popover; clicking outside both
        // closes the whole stack.
        const buttonPopoverNested = new Button("Popover + ComboBox (nested)");
        const popoverNested = new Popover({
            placement: "bottom",
            dismissOn: "blur",
            title    : "Nested layer",
        });
        const nestedCombo = new ComboBox({ items: ["Alpha", "Beta", "Gamma", "Delta"] });
        popoverNested.setBody("Open the ComboBox below — its dropdown is a child layer, so the popover stays open while you pick.");
        popoverNested.addComponent(nestedCombo);
        popoverNested.addAction("Close", () => popoverNested.hide());
        Event.addListener(buttonPopoverNested, "click", () => {
            if (popoverNested.isOpen()) {
                popoverNested.hide();
            } else {
                popoverNested.attachToComponent(buttonPopoverNested);
                popoverNested.show();
            }
        });
        popoverRow.addComponent(buttonPopoverNested);

        leftColumn.addComponent(popoverRow);
    }
}

const MiscPanelCallable = callable(MiscPanel);
type MiscPanelCallable = MiscPanel;
export {
    MiscPanel         as _MiscPanel,
    MiscPanelCallable as MiscPanel
};
