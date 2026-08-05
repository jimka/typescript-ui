import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { NumberedList, ListItem, NumberedListItemStyle } from '@jimka/typescript-ui/component/list';

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
 * Two `NumberedList`s over the same four items, one in `DECIMAL` style and
 * one in `LOWER_ALPHA` style.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const items = ['Introduction', 'Background', 'Method', 'Conclusion'];

    const decimalList = NumberedList();
    decimalList.setStyle(NumberedListItemStyle.DECIMAL);
    for (const item of items) {
        decimalList.addComponent(ListItem(item.toLowerCase(), item));
    }

    const alphaList = NumberedList();
    alphaList.setStyle(NumberedListItemStyle.LOWER_ALPHA);
    for (const item of items) {
        alphaList.addComponent(ListItem(item.toLowerCase(), item));
    }

    return Panel({
        layoutManager: HBox({ spacing: 24 }),
        components:    [decimalList, alphaList],
    });
}
