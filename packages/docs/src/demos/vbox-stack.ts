import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Header } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is four stacked rows plus their spacing and the surrounding frame.
 */
export const height: number = 260;

/**
 * Four labelled panels stacked in a `VBox` with `spacing: 8` and
 * `stretching: true`, so each row fills the column's full width.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const rowOne = Header('Row 1');

    const rowTwo = Header('Row 2');

    const rowThree = Header('Row 3');

    const rowFour = Header('Row 4');

    return Panel({
        layoutManager: VBox({ spacing: 8, stretching: true }),
        components:    [rowOne, rowTwo, rowThree, rowFour],
    });
}
