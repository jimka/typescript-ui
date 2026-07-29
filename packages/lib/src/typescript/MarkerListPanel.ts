// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Container, Panel } from '@jimka/typescript-ui/core';
import { HFlow, VBox } from '@jimka/typescript-ui/layout';
import { FieldSet } from '@jimka/typescript-ui/component/container';
import { Text } from '@jimka/typescript-ui/component/input';
import {
    BulletedList,
    BulletedListItemStyle,
    ListItem,
    NumberedList,
    NumberedListItemStyle,
} from '@jimka/typescript-ui/component/list';

/**
 * Twelve labels, so every numbered list crosses the one-digit to two-digit
 * boundary at item 10 — the point where the marker grows and the shared column
 * has to keep every label on one left edge.
 */
const ITEM_LABELS = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot",
    "Golf", "Hotel", "India", "Juliett", "Kilo", "Lima",
];

/** Labels for the bullet demos, which have no digit-growth boundary to cross. */
const BULLET_LABELS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];

/** Box for one twelve-item numbered list, sized to hold the list plus its legend. */
const NUMBERED_BOX = { width: 190, height: 285 };

/** Box for one five-item bulleted list. */
const BULLETED_BOX = { width: 190, height: 140 };

/**
 * Demonstrates every marker-list style side by side: all eleven
 * `NumberedListItemStyle` members and all four `BulletedListItemStyle` members.
 *
 * Each numbered list runs long enough to show the shared marker column at work.
 * Every item's marker is widened to the list's widest and right-aligned inside
 * that slot, so the markers share a right edge and the labels share a left one
 * even where the marker grows a character — decimal at item 10, roman at 4 and
 * 9. The alias pairs sit next to each other so their identical output is
 * visible, and `none` shows the marker slot collapsing away entirely.
 */
class MarkerListPanel extends Panel {

    constructor() {
        super({
            // Stretching so each row spans the panel and its HFlow has a real
            // width to wrap against; without it the row would collapse to the
            // width of a single list and stack them vertically.
            layoutManager: new VBox({ stretching: true }),
            autoScroll: "auto"
        });

        this.addComponent(new Text("Numbered lists — every NumberedListItemStyle, twelve items each:"));
        this.addComponent(this.buildNumberedRow());

        this.addComponent(new Text("Bulleted lists — every BulletedListItemStyle:"));
        this.addComponent(this.buildBulletedRow());
    }

    /**
     * Builds the wrapping row of numbered lists, one per numbering style.
     *
     * @returns A scrolling panel holding one FieldSet per NumberedListItemStyle member.
     */
    private buildNumberedRow(): Container {
        // Two wrapped lines' worth of height. Eleven boxes fit on two lines at a
        // typical window width; a narrower window wraps to more, which this row
        // scrolls rather than pushing the bullet section off the panel.
        const row = Container({
            layoutManager: HFlow({
                spacing    : 8,
                lineSpacing: 8
            }),
        });

        for (const style of Object.values(NumberedListItemStyle)) {
            const list = NumberedList({ itemStyle: style });

            for (const label of ITEM_LABELS) {
                list.addComponent(ListItem(label.toLowerCase(), label));
            }

            row.addComponent(
                FieldSet(
                    style, {
                        preferredSize: NUMBERED_BOX,
                        layoutManager: VBox({ stretching: true }),
                        components   : [{
                            component: list
                        }],
                    }
                )
            );
        }

        return row;
    }

    /**
     * Builds the wrapping row of bulleted lists, one per bullet style.
     *
     * @returns A scrolling panel holding one FieldSet per BulletedListItemStyle member.
     */
    private buildBulletedRow(): Container {
        // Four styles fit on one line at any usable width, so this row is fixed
        // to one box's height rather than sharing the leftover space.
        const row = Container({
            layoutManager: HFlow({
                spacing    : 8,
                lineSpacing: 8
            }),
        });

        for (const style of Object.values(BulletedListItemStyle)) {
            const list = BulletedList({ itemStyle: style });

            for (const label of BULLET_LABELS) {
                list.addComponent(ListItem(label.toLowerCase(), label));
            }

            row.addComponent(
                FieldSet(
                    style, {
                        preferredSize: BULLETED_BOX,
                        layoutManager: VBox({ stretching: true }),
                        components   : [{
                            component: list
                        }],
                    }
                )
            );
        }

        return row;
    }
}

const MarkerListPanelCallable = callable(MarkerListPanel);
type MarkerListPanelCallable = MarkerListPanel;
export {
    MarkerListPanel         as _MarkerListPanel,
    MarkerListPanelCallable as MarkerListPanel
};
