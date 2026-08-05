import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { BulletedList, ListItem, BulletedListItemStyle } from '@jimka/typescript-ui/component/list';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is two four-item lists side by side plus the surrounding frame.
 */
export const height: number = 120;

/**
 * Two `BulletedList`s over the same four items, one in `SQUARE` style and one
 * in `CIRCLE` style.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const items = ['Apple', 'Banana', 'Cherry', 'Date'];

    const squareList = BulletedList();
    squareList.setStyle(BulletedListItemStyle.SQUARE);
    for (const item of items) {
        squareList.addComponent(ListItem(item.toLowerCase(), item));
    }

    const circleList = BulletedList();
    circleList.setStyle(BulletedListItemStyle.CIRCLE);
    for (const item of items) {
        circleList.addComponent(ListItem(item.toLowerCase(), item));
    }

    return Panel({
        layoutManager: HBox({ spacing: 24 }),
        components:    [squareList, circleList],
    });
}
