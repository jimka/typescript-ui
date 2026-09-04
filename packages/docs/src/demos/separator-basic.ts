import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Separator } from '@jimka/typescript-ui/component/container';
import { Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 leaves room for two lines of text plus the separator and the VBox's
 * component spacing around it.
 */
export const height: number = 120;

/**
 * Two `Text` rows in a `VBox`, divided by a horizontal `Separator` that spans
 * the column's width.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const topText = Text('Above the rule');

    const rule = Separator();

    const bottomText = Text('Below the rule');

    return Panel({
        layoutManager: VBox(),
        components:    [topText, rule, bottomText],
    });
}
