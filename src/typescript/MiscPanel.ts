// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    ButtonGroup,
    callable,
    ClassicTheme,
    Component,
    Container,
    DarkTheme,
    Dialog,
    Dock,
    Drawer,
    Event,
    Menu,
    ModernTheme,
    Notification,
    Panel,
    Popover,
    Rail,
    ThemeManager,
    Tooltip,
    Window
} from '@jimka/typescript-ui/core';
import type { AutoScrollMode, DrawerEdge } from '@jimka/typescript-ui/core';
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
    ComboBox,
    DateField,
    DateTimeField,
    NumberSpinner,
    RadioButton,
    Text,
    TextField,
    TimeField
} from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import {
    Glyph,
    IconLabel,
    IconText,
    Image,
    PaginationBar,
    ProgressBar,
    ProgressSpinner
} from '@jimka/typescript-ui/component/display';
import { FieldSet, Spacer, StatusBar } from '@jimka/typescript-ui/component/container';
import type { MenuItemConfig } from '@jimka/typescript-ui/component/container';
import {
    ColumnSpec,
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
import { ToolBar } from '~/component/menubar/ToolBar';
import { VBoxPanel } from './VBoxPanel';

Glyph.register(xmark, arrow_right, arrow_down, folder, file, file_code, file_lines, floppy_disk, filter, circle_info);
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

                return tablePanel;
            });

            win2.show();
        });
        leftColumn.addComponent(buttonWindowTable);

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
                    { name: "Joined"    , type: "date"    , description: "col5", order: 3 },
                    { name: "Meeting"   , type: "time"    , description: "col6", order: 4 },
                    { name: "LastSeen"  , type: "datetime", description: "col7", order: 5 },
                    { name: "Notes"     , type: "string"  , description: "col4", order: 6 },
                    { name: "locked"    , type: "boolean" , description: "col8", order: 7 },
                ]);

                let specStore = new MemoryStore(specModel);

                specStore.add([
                    { Name: "Alice", Active: true , Score: 95, Joined: new Date(2021,  2, 15), Meeting: new Date(1970, 0, 1,  9, 30, 20), LastSeen: new Date(2024,  0, 10, 14, 25), Notes: "Top performer"  , locked: false },
                    { Name: "Bob"  , Active: false, Score: 72, Joined: new Date(2022,  7,  3), Meeting: new Date(1970, 0, 1, 14,  0, 30), LastSeen: new Date(2024,  3, 22,  8, 10), Notes: "Needs follow-up", locked: true  },
                    { Name: "Carol", Active: true , Score: 88, Joined: new Date(2020, 11, 20), Meeting: null                        , LastSeen: new Date(2023, 11,  5, 17, 45)    , Notes: "On track"       , locked: false },
                    { Name: "David", Active: true , Score: 61, Joined: null                  , Meeting: new Date(1970, 0, 1, 11, 15, 40), LastSeen: null                          , Notes: "Check in soon"  , locked: false },
                    { Name: "Eve"  , Active: false, Score: 45, Joined: new Date(2023,  4,  9), Meeting: new Date(1970, 0, 1, 16, 45, 50), LastSeen: new Date(2024,  5,  1,  9,  0), Notes: "At risk"        , locked: false },
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
                // record whose Active flag is false).
                const spec: ColumnSpec = {
                    rowReadOnly: (r) => r.get('locked') === true,
                    columns: [
                        { field: 'Name'    , minWidth: 150, headerGlyph: 'xmark', group: 'Identity', unhideable: true                                     },
                        { field: 'Active'  , maxWidth: 100,                       group: 'Identity'                                                       },
                        { field: 'Score'   , maxWidth: 100, cellReadOnly: (r) => r.get('Active') === false                                                 },
                        { field: 'Joined'  , minWidth: 120, readOnly: true,       group: 'Activity', groupColor: 'rgba(30, 100, 200, 0.06)'                },
                        { field: 'Meeting' , minWidth: 100, showSeconds: true,    group: 'Activity', groupColor: 'rgba(30, 100, 200, 0.06)'                },
                        { field: 'LastSeen', minWidth: 160,                       group: 'Activity', groupColor: 'rgba(30, 100, 200, 0.06)'                },
                        { field: 'Notes'   , hidden  : true                                                                                                },
                        { field: 'locked'  , hidden  : true                                                                                                },
                    ],
                };

                let specTable = new Table(specStore, spec);
                specTable.setExportMenuEnabled(true);

                const statusBar = new StatusBar({
                    defaultMessage: `${specStore.getCount()} rows`,
                });

                const wrapper = Panel({
                    layoutManager: new VBox({ stretching: true }),
                    components: [
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
        Event.addListener(buttonContextMenu, "contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            Tooltip.hide();
            contextMenu.show(e.clientX, e.clientY, [
                { text: "Action 1", action: () => alert("Action 1 clicked!") },
                { text: "Action 2", action: () => alert("Action 2 clicked!") },
                { separator: true },
                { text: "Disabled action", enabled: false },
                { text: "Action 3", action: () => alert("Action 3 clicked!") },
            ]);
        });
        leftColumn.addComponent(buttonContextMenu);

        // A deliberately tall context menu (40 items) so it exceeds the
        // viewport height. Right-clicking near the bottom of the screen shows
        // the menu clamp to the available room and scroll vertically rather
        // than running off-screen with unreachable items.
        const tallContextMenu = new Menu();

        const tallItems: MenuItemConfig[] = [];

        for (let i = 1; i <= 40; i++) {
            tallItems.push({ text: `Item ${i}`, action: () => alert(`Item ${i} clicked!`) });
        }

        const buttonTallContextMenu = new Button("Right-click for a tall (scrolling) menu");
        Tooltip.attach(buttonTallContextMenu, "Right-click near the screen edge to see the menu clamp and scroll");
        Event.addListener(buttonTallContextMenu, "contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            Tooltip.hide();
            tallContextMenu.show(e.clientX, e.clientY, tallItems);
        });
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

        // Drawer demo — opens an edge-anchored sliding panel. Each drawer is a
        // bare content host, so we stack a heading and a Close button into it
        // via a VBox. The four modal buttons exercise all four geometries; the
        // last button shows a non-modal drawer that leaves the app interactive.
        const openDemoDrawer = (edge: DrawerEdge, modal: boolean, label: string): void => {
            const drawer = new Drawer({ edge, modal, layoutManager: new VBox({ stretching: true }) });

            const heading = new Text((modal ? "Modal" : "Non-modal") + " drawer — " + label);
            heading.setFontWeight("bold");
            heading.setPreferredSize(0, 28);

            const closeButton = new Button("Close");
            closeButton.setPreferredSize(0, 32);
            closeButton.on("action", () => drawer.close());

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
            heading.setPreferredSize(0, 28);

            const closeButton = new Button("Close");
            closeButton.setPreferredSize(0, 32);
            closeButton.on("action", () => drawer.close());

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

            const dock = new Dock({
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

            toolbar.addComponent(saveButton);
            toolbar.addComponent(restoreButton);

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
        buttonDialogConfirm.on("action", async () => {
            const confirmed = await Dialog.confirm(
                'Confirm action',
                'Are you sure you want to proceed with this action?'
            );

            Notification.show(`Dialog closed with: ${confirmed ? 'confirm' : 'cancel'}`, confirmed ? 'success' : 'info');
        });
        leftColumn.addComponent(buttonDialogConfirm);

        const buttonDialogOk = new Button("Dialog — OK only");
        buttonDialogOk.on("action", async () => {
            await Dialog.show({
                title  : 'Information',
                message: 'This is a simple informational dialog with a single OK button.',
            });
        });
        leftColumn.addComponent(buttonDialogOk);

        const buttonDialogBackdrop = new Button("Dialog — close on backdrop click");
        buttonDialogBackdrop.on("action", async () => {
            const result = await Dialog.show({
                title          : 'Click outside to close',
                message        : 'You can dismiss this dialog by clicking the backdrop or pressing Escape.',
                closeOnBackdrop: true,
            });

            Notification.show(`Dialog closed with: ${result}`, 'info');
        });
        leftColumn.addComponent(buttonDialogBackdrop);

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
