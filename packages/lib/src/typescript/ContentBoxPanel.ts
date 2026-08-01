// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component, Container, Panel } from '@jimka/typescript-ui/core';
import { HFlow, VBox } from '@jimka/typescript-ui/layout';
import { FieldSet, MenuItem } from '@jimka/typescript-ui/component/container';
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
 * the border instead of inside it. Everything bordered here — all three rows —
 * should sit fully inside its border with the frame unbroken all the way round.
 *
 * Covered: the single-line fields, the tree row, and the four public row
 * renderers. `Dialog`, `Tooltip` and `DragGhost` carry real theme borders and
 * have their own demos. `TreeCellRenderer` is covered by nothing: every shipped
 * theme sets `table.cell.border` to `none`, so its content-box arithmetic never
 * runs anywhere in this app and a regression in it would go unseen — worth
 * adding here if it is ever touched again.
 *
 * The third row holds one fixed case and one still-baselined case. The
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
 */
class ContentBoxPanel extends Panel {

    constructor() {
        super({
            layoutManager: new VBox({ stretching: true }),
            autoScroll   : "auto",
        });

        this.addComponent(new Text(
            "Every component below carries a border. Look for a child clipped at the "
            + "right or bottom edge, or sitting flush against the frame. The last row's "
            + "second FieldSet is still on the lint rule's baseline.",
        ));

        this.addComponent(this.buildFieldRow());
        this.addComponent(this.buildRowRendererRow());
        this.addComponent(this.buildMenuAndNotificationRow());
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
}

const ContentBoxPanelCallable = callable(ContentBoxPanel);
type ContentBoxPanelCallable = ContentBoxPanel;
export {
    ContentBoxPanel         as _ContentBoxPanel,
    ContentBoxPanelCallable as ContentBoxPanel
};
