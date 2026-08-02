// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component, Container, Panel } from '@jimka/typescript-ui/core';
import { HFlow, VBox } from '@jimka/typescript-ui/layout';
import type { BoxLayout } from '@jimka/typescript-ui/layout';
import { FieldSet, MenuItem, Scrollbar, ScrollStrip } from '@jimka/typescript-ui/component/container';
import {
    AutoCompleteField,
    ComboBox,
    DateField,
    DateTimeField,
    NumberSpinner,
    Text,
    TextField,
    TimeField,
} from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { Glyph } from '@jimka/typescript-ui/component/display';
import { Notification } from '@jimka/typescript-ui/overlay';
import {
    IconLabelTreeNodeRenderer,
    LabelTreeNodeRenderer,
    Tree,
} from '@jimka/typescript-ui/component/tree';
import type { TreeNode } from '@jimka/typescript-ui/component/tree';
import {
    GlyphListItemRenderer,
    LabelListItemRenderer,
    List,
} from '@jimka/typescript-ui/component/list';
import {
    Cell,
    StringEditor,
    StringRenderer,
    TreeCellRenderer,
} from '@jimka/typescript-ui/component/table';
import type { CellRenderer } from '@jimka/typescript-ui/component/table';
import { Insets } from '@jimka/typescript-ui/primitive';
import { folder } from '@jimka/typescript-ui/glyphs/solid/folder';
import { file } from '@jimka/typescript-ui/glyphs/solid/file';

Glyph.register(folder);
Glyph.register(file);

/**
 * The border every component on this panel wears. Two pixels, because a
 * one-pixel overrun is easy to mistake for a rounding artefact and this panel
 * exists to make the overrun unmistakable.
 */
const BORDER = "2px solid var(--ts-ui-border-color)";

/**
 * The border on the demo `MenuItem`, thicker than {@link BORDER} because this
 * is the thickness at which the item's now-fixed defect used to take a visible
 * bite out of the label: at 4px the content box is 16px, and the label used to
 * be pinned to 24px regardless. Kept at 4px so the fix stays visible here
 * rather than only in the offline suite.
 */
const MENU_ITEM_BORDER = "4px solid var(--ts-ui-border-color)";

/** Box for one demo FieldSet, wide enough for a picker field plus its legend. */
const BOX = { width: 250, height: 250 };

/** Depth the demo tree cells sit at, so the indent is wide enough to see. */
const TREE_CELL_DEPTH = 2;

/** Outer box of one demo tree cell: room for a caret, an indent and a value. */
const TREE_CELL_SIZE = { width: 230, height: 28 };

/** Nodes shared by both trees, deep enough to show the caret at two indents. */
const TREE_NODES: TreeNode[] = [
    {
        label: "src", children: [
            { label: "Component.ts" },
            { label: "Event.ts" },
        ],
    },
    {
        label: "docs", children: [
            { label: "guide.md" },
        ],
    },
    { label: "package.json" },
];

/** Items shared by both lists; `glyph` is read only by the glyph renderer. */
const LIST_ITEMS = [
    { key: "a", label: "Folder",   glyph: "folder" },
    { key: "b", label: "Document", glyph: "file"   },
    { key: "c", label: "Another",  glyph: "file"   },
];

/**
 * Nodes for the scroll-chrome row's `Tree`: enough leaves to overflow the
 * demo box vertically, plus one label long enough to overflow it horizontally
 * too, so both `VirtualScroller` scrollbars appear.
 */
const SCROLL_TREE_NODES: TreeNode[] = [
    {
        label: "src", children: [
            { label: "This label is deliberately long enough to overflow the tree horizontally.ts" },
            { label: "Event.ts" },
            { label: "Component.ts" },
            { label: "DOM.ts" },
            { label: "Animation.ts" },
            { label: "ListenerBag.ts" },
            { label: "Callable.ts" },
            { label: "Util.ts" },
        ],
    },
    { label: "package.json" },
    { label: "tsconfig.json" },
    { label: "README.md" },
];

/** Labels for the scroll-chrome row's `ScrollStrip`, wide enough in total to overflow its 250px demo box and force both paging arrows. */
const STRIP_ITEMS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];

/** Fixed band height for the scroll-chrome row's `ScrollStrip` demo. */
const STRIP_HEIGHT = 32;

/**
 * A `Tree` whose pool rows carry a border, reaching the row through the
 * `protected createPoolRow` seam — the only route a consumer has, since
 * `TreeRow` is not exported.
 */
class BorderedRowTree extends Tree {

    /**
     * Borders each pool row as it is built, so every rendered row exercises
     * `TreeRow.layoutChildren`'s content-box arithmetic.
     *
     * @returns The bordered pool row.
     */
    protected override createPoolRow() {
        const row = super.createPoolRow();

        // Border only, no padding: a tree row is a fixed 24px, and the caret
        // glyph is a rigid 16x16 that its own clamp will not shrink. Two
        // pixels of border leave 20px of content box, which fits; adding
        // padding on top would not, and the caret would clip whatever the
        // layout arithmetic did.
        row.setBorder(BORDER);

        return row;
    }
}

/** Drives a bordered ScrollStrip the way an owner does: size the band, then lay its content. */
class BorderedStripHost extends Container {
    private _strip: ScrollStrip = new ScrollStrip({ border: BORDER, scrollable: true });

    constructor() {
        super();

        // Reported so the stretching VBox that hosts this row sizes it to the
        // fixed band height on the main axis while still stretching it to the
        // FieldSet's full content width on the cross axis.
        this.setPreferredSize({ width: 0, height: STRIP_HEIGHT });

        for (const label of STRIP_ITEMS) {
            this._strip.addItem(Button({ text: label }));
        }

        // ScrollStrip's own clip box defaults to "equal" mode, which divides
        // the available width among the items instead of letting them
        // overflow — the same reason TabBar's applyTabWidths switches its
        // clip to "preferred" + setOverflowing before relying on paging
        // arrows. Without this the items always fit and the arrows, though
        // correctly positioned, would have nothing to page.
        const box = this._strip.getContentBox() as BoxLayout;
        box.setMode("preferred");
        box.setOverflowing(true, false);

        this.addComponent(this._strip);
    }

    /**
     * Sizes the strip to this host's content box and a fixed band height, then
     * asks the strip whether its items overflow before laying out its content
     * — the same two-step sequence an owner like `TabBar` follows.
     *
     * @returns This host, for method chaining.
     */
    doLayout(): this {
        const box = this.getContentBounds() ?? { x: 0, y: 0, width: 0, height: 0 };

        this._strip.setX(box.x);
        this._strip.setY(box.y);
        this._strip.setWidth(box.width);
        this._strip.setHeight(STRIP_HEIGHT);

        const reserve = this._strip.arrowReserve(this.predictedItemsExtent(), box.width);

        this._strip.layoutContent(reserve, 0);

        return this;
    }

    /**
     * Sums each item's preferred width — the same overflow prediction an
     * owner runs before deciding whether to reserve arrow gutters.
     *
     * @returns The predicted total main-axis extent of the strip's items.
     */
    private predictedItemsExtent(): number {
        return this._strip.getItems()
            .reduce((sum, item) => sum + (item.getPreferredSize()?.width ?? 0), 0);
    }
}

/**
 * Exercises content-box containment: the components here carry a border, so any
 * child still placed against its owner's *outer* box overruns the far edge and
 * is clipped by the `overflow: hidden` each component carries.
 *
 * The border is 2px because the shipped themes give these components either
 * 1px or nothing, and 1px is not enough to see. Every single-line field here
 * does carry a real 1px input border by default, which is how the original
 * defect was found at all — but only at 125% display scaling, where one CSS
 * pixel of overrun becomes a visibly shaved glyph edge. At 100% it looked
 * fine. The tree row and the four row renderers have no natural coverage
 * whatsoever: a list row's theme border is 1px and fully transparent, a tree
 * row's is absent, so a regression in any of them shows up on no other demo
 * tab and in no screenshot.
 *
 * What to look for here: a caret, icon, spinner, picker button, or label that
 * is cut off on its right or bottom edge, or a label that starts flush against
 * the border instead of inside it. Everything bordered here — all five rows —
 * should sit fully inside its border with the frame unbroken all the way
 * round. On the table-cell row, double-click the first cell's text: the
 * opened editor's outline should start at the text, not at the cell's left
 * edge, and its right edge should stop inside the cell's border rather than
 * under it (Escape closes it).
 *
 * Covered: the single-line fields, the tree row, the four public row
 * renderers, the menu item, a table cell (bordered directly, and again
 * through its `TreeCellRenderer`), and the three pieces of scroll chrome (a
 * `Tree`'s `VirtualScroller` bars, a `ScrollStrip`'s clip and paging arrows,
 * and a `Scrollbar`'s thumb and arrow caps).
 * `Dialog`, `Tooltip` and `DragGhost` carry real theme borders and
 * have their own demos.
 *
 * The third row holds two standalone tree-column table cells — a `Table`
 * builds its own cells and hands out no writable reference to one, so both
 * are built directly rather than inside a `TreeTable`. The first borders the
 * `Cell` itself, exercising `Cell.alignEditorWithContent`: the `Card` layout
 * already placed the editor inside the cell's content box, but the method
 * used to re-measure it against the cell's *outer* width, running it past
 * the frame by both border sides. The second borders and pads the cell's
 * `TreeCellRenderer` instead, exercising the renderer's own `doLayout` —
 * already content-box correct, but until this branch covered by no test that
 * a border and padding together could tell apart from the unfixed
 * arithmetic, since every shipped theme sets `table.cell.border` to `none`
 * and the `box.x`/`box.y` term is zero everywhere in this app.
 *
 * The fourth row holds one fixed case and one still-baselined case. The
 * `MenuItem` used to misbehave visibly — its labels were centred against its
 * *outer* height at construction, pinning their minimum, so a bordered one
 * clipped their descenders — and is now pinned to its content height instead,
 * so the label and shortcut render whole. The notification is baselined for
 * the same class of defect but has gaps wide enough to absorb its 1px border,
 * so nothing there clips — it is on the panel to be measured, not looked at.
 *
 * The `local/require-content-bounds` ESLint rule guards the same rule
 * statically; this panel is the eye-check for the cases a lint rule cannot see,
 * such as a child that is placed correctly but sized from a stale measurement.
 * One near miss of that kind is worth knowing about while reading the
 * `AutoCompleteField` here: `syncSizeFromTextField` mirrors the inner field's
 * height at construction only, before `applyOptions` has applied a border from
 * the options bag, so the mirrored preferred height is a perimeter short. It
 * produces no artefact — the content-derived minimum floors the committed
 * height back to the right value — but the stale mirror is real, and a future
 * change to that clamp would surface here first.
 *
 * The fifth row exercises the three pieces of scroll chrome fixed alongside
 * this panel — `VirtualScroller` (the bordered `Tree`'s two scrollbars),
 * `ScrollStrip` (its inner clip and paging arrows), and `Scrollbar` (its
 * thumb and arrow caps) — all three previously placed against their owner's
 * outer box instead of its content box. None of the three carries a border
 * under any shipped theme, so this row is the only place their fix is visible
 * at all.
 */
class ContentBoxPanel extends Panel {

    // Assigned inside buildTableCellRow(), called from the constructor below.
    // A Cell's border is theme-owned (see the constructor's setBorder call in
    // Cell.ts) and every theme change re-applies `table.cell.border`, which
    // would wipe this demo border the moment someone uses the theme switcher —
    // the constructor's trailing subscribeTheme re-applies it last.
    private _borderedCell!: Cell<String | null>;

    constructor() {
        super({
            layoutManager: new VBox({ stretching: true }),
            autoScroll   : "auto",
        });

        this.addComponent(new Text(
            "Every component below carries a border. Look for a child clipped at the "
            + "right or bottom edge, or sitting flush against the frame. The fourth row's "
            + "second FieldSet is still on the lint rule's baseline.",
        ));

        this.addComponent(this.buildFieldRow());
        this.addComponent(this.buildRowRendererRow());
        this.addComponent(this.buildTableCellRow());
        this.addComponent(this.buildMenuAndNotificationRow());
        this.addComponent(this.buildScrollChromeRow());

        // The panel subscribes after the cell does (Cell's own constructor
        // subscribes first), and theme listeners fire in registration order,
        // so this write lands last and wins.
        this.subscribeTheme(() => this._borderedCell.setBorder(BORDER));
    }

    /**
     * Builds the row holding the bordered `MenuItem` fixed case and the
     * notification trigger still on the lint rule's baseline, so the open case
     * sits beside the fixed one instead of being invisible.
     *
     * @returns A row holding a bordered menu item FieldSet and a baselined
     * notification-trigger FieldSet.
     */
    private buildMenuAndNotificationRow(): Container {
        const row = Container({ layoutManager: HFlow({ spacing: 8, lineSpacing: 8 }) });

        // A bordered MenuItem's content box is smaller than its 24px outer
        // height; its labels are pinned to that content height, so a 4px
        // border here leaves a 16px content box — exactly the natural line box
        // at the default font — and the label and shortcut render whole.
        // Rendered standalone rather than inside a Menu, which builds its own
        // items and hands out no reference to them.
        const menuItem = MenuItem(
            { text: "Paging, gapping", shortcut: "Ctrl+G" },
            () => undefined,
            () => undefined,
            "menu-bar",
            // Sized explicitly: a MenuItem is normally stretched by the Menu
            // that owns it and collapses to nothing on its own. Wide enough for
            // its own columns plus the border, so height was the only axis that
            // ever clipped, and 24 is MenuItem.HEIGHT — the labels are now
            // pinned to the 16 that leaves once the 4px border is taken off.
            { border: MENU_ITEM_BORDER, preferredSize: { width: 240, height: 24 } },
        );

        row.addComponent(FieldSet("Bordered menu item", {
            preferredSize: { width: 250, height: 60 },
            layoutManager: VBox(),
            components   : [
                { component: menuItem },
            ],
        }));

        row.addComponent(FieldSet("Still on the baseline", {
            preferredSize: { width: 250, height: 60 },
            layoutManager: VBox(),
            components   : [
                { component: Button({
                    text     : "Show a notification",
                    listeners: {
                        action: () => Notification.show(
                            "Badge, message and close button inside the border?", "info",
                        ),
                    },
                }) },
            ],
        }));

        return row;
    }

    /**
     * Builds the row of bordered single-line fields. Each pins its height to a
     * one-line box that includes the border, then places its own button, caret,
     * or spinners inside what is left.
     *
     * @returns A wrapping row of one FieldSet per field type.
     */
    private buildFieldRow(): Container {
        const row = Container({ layoutManager: HFlow({ spacing: 8, lineSpacing: 8 }) });

        row.addComponent(FieldSet("Text and combo", {
            preferredSize: BOX,
            layoutManager: VBox(),
            components   : [
                { component: TextField({ text: "Plain field", border: BORDER }) },
                { component: ComboBox({ border: BORDER }).addItem("Caret inside") },
                { component: NumberSpinner({ value: 42, border: BORDER }) },
                { component: AutoCompleteField({ border: BORDER }) },
            ],
        }));

        row.addComponent(FieldSet("Picker fields", {
            preferredSize: BOX,
            layoutManager: VBox(),
            components   : [
                { component: DateField({ border: BORDER }) },
                { component: TimeField({ border: BORDER }) },
                { component: DateTimeField({ border: BORDER }) },
            ],
        }));

        return row;
    }

    /**
     * Builds the row of bordered virtual rows and row renderers — the four
     * renderer `layoutChildren` implementations plus `TreeRow`'s.
     *
     * @returns A wrapping row of one FieldSet per renderer.
     */
    private buildRowRendererRow(): Container {
        const row = Container({ layoutManager: HFlow({ spacing: 8, lineSpacing: 8 }) });

        // Bordered rows AND a bordered renderer inside each one, so the row's
        // content box and the renderer's are both under test at once.
        const labelTree = new BorderedRowTree();
        labelTree.setRendererFactory(() => {
            const renderer = new LabelTreeNodeRenderer();
            renderer.setBorder(BORDER);

            return renderer;
        });
        labelTree.setNodes(TREE_NODES);
        labelTree.expandAll();

        const iconTree = new BorderedRowTree();
        iconTree.setRendererFactory(() => {
            const renderer = new IconLabelTreeNodeRenderer(
                (node) => (node.children && node.children.length > 0 ? "folder" : "file"),
            );
            renderer.setBorder(BORDER);

            return renderer;
        });
        iconTree.setNodes(TREE_NODES);
        iconTree.expandAll();

        const labelList = new List({
            rendererFactory: () => {
                const renderer = new LabelListItemRenderer();
                renderer.setBorder(BORDER);

                return renderer;
            },
        });
        labelList.setItems(LIST_ITEMS);

        const glyphList = new List({
            rendererFactory: () => {
                const renderer = new GlyphListItemRenderer();
                renderer.setBorder(BORDER);

                return renderer;
            },
        });
        glyphList.setItems(LIST_ITEMS);

        const boxes: Array<[string, Component]> = [
            ["Tree — label renderer", labelTree],
            ["Tree — icon renderer",  iconTree],
            ["List — label renderer", labelList],
            ["List — glyph renderer", glyphList],
        ];

        for (const [legend, component] of boxes) {
            row.addComponent(FieldSet(legend, {
                preferredSize: BOX,
                layoutManager: VBox({ stretching: true }),
                components   : [{ component }],
            }));
        }

        return row;
    }

    /**
     * Builds a standalone tree-column cell: a `Cell` whose renderer is wrapped in
     * a `TreeCellRenderer` showing an expand toggle at {@link TREE_CELL_DEPTH},
     * carrying its own `StringEditor` so a double-click opens an editor without a
     * table's `CellEditorPool`.
     *
     * @param text - The value the cell renders.
     *
     * @returns The configured cell.
     */
    private static buildTreeCell(text: string): Cell<String | null> {
        const cell = new Cell<String | null>("div", new StringRenderer(), new StringEditor());

        cell.wrapRenderer((delegate: CellRenderer<String | null>) => new TreeCellRenderer(delegate));
        (cell.getRenderer() as TreeCellRenderer<String | null>)
            .setTreeState(TREE_CELL_DEPTH, true, false);
        cell.setValue(text);
        cell.setPreferredSize(TREE_CELL_SIZE);

        return cell;
    }

    /**
     * Builds the row of two standalone tree-column table cells: one bordered
     * directly to exercise {@link Cell.alignEditorWithContent}, and one whose
     * `TreeCellRenderer` is bordered and padded instead, to exercise the
     * renderer's own `doLayout`. A `Table` builds its own cells and hands out
     * no writable reference to one, so both are built standalone rather than
     * inside a `TreeTable`.
     *
     * @returns A wrapping row of one FieldSet holding both cells.
     */
    private buildTableCellRow(): Container {
        const row = Container({ layoutManager: HFlow({ spacing: 8, lineSpacing: 8 }) });

        this._borderedCell = ContentBoxPanel.buildTreeCell("Editor inside the border");
        this._borderedCell.setBorder(BORDER);

        const paddedRendererCell = ContentBoxPanel.buildTreeCell("Caret inside the frame");
        const paddedRenderer = paddedRendererCell.getRenderer();

        paddedRenderer.setBorder(BORDER);
        paddedRenderer.setPadding(new Insets(3, 3, 3, 3));

        row.addComponent(FieldSet("Table cell", {
            preferredSize: BOX,
            layoutManager: VBox(),
            components   : [
                { component: this._borderedCell },
                { component: paddedRendererCell },
            ],
        }));

        return row;
    }

    /**
     * Builds the row exercising the three scroll-chrome fixes: a bordered
     * `Tree` (its two `VirtualScroller` bars), a bordered `ScrollStrip`
     * (driven by {@link BorderedStripHost}), and a bordered `Scrollbar` fed
     * synthetic metrics on first layout.
     *
     * @returns A wrapping row of one FieldSet per scroll-chrome component.
     */
    private buildScrollChromeRow(): Container {
        const row = Container({ layoutManager: HFlow({ spacing: 8, lineSpacing: 8 }) });

        const tree = new Tree({ border: BORDER, preferredSize: { width: 200, height: 120 } });
        tree.setNodes(SCROLL_TREE_NODES);
        tree.expandAll();

        row.addComponent(FieldSet("Tree (VirtualScroller)", {
            preferredSize: BOX,
            layoutManager: VBox(),
            components   : [{ component: tree }],
        }));

        row.addComponent(FieldSet("ScrollStrip", {
            preferredSize: BOX,
            layoutManager: VBox({ stretching: true }),
            components   : [{ component: new BorderedStripHost() }],
        }));

        // Metrics deferred to onFirstLayout: setMetrics reads the bar's
        // committed size, which does not exist until the element is rendered.
        const scrollbar = new Scrollbar("vertical", { border: BORDER, preferredSize: { width: 12, height: 200 } });
        scrollbar.onFirstLayout(() => scrollbar.setMetrics(200, 1000, 300));
        // A standalone bar has no owner to scroll, so it emits a position that
        // nothing consumes and the thumb never moves. Feeding the position
        // straight back makes the thumb follow a drag, a track click and an
        // arrow step — the three things this row exists to let you check.
        scrollbar.on("scroll", position => scrollbar.setMetrics(200, 1000, position));

        row.addComponent(FieldSet("Scrollbar", {
            preferredSize: BOX,
            layoutManager: VBox(),
            components   : [{ component: scrollbar }],
        }));

        return row;
    }
}

const ContentBoxPanelCallable = callable(ContentBoxPanel);
type ContentBoxPanelCallable = ContentBoxPanel;
export {
    ContentBoxPanel         as _ContentBoxPanel,
    ContentBoxPanelCallable as ContentBoxPanel
};
