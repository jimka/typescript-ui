import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of text plus room around the frame for the stage's border.
 */
export const height: number = 64;

/**
 * A left-aligned `Text` beside one centred in a fixed-height box via
 * `centerInHeight`.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const leftText = Text('Left-aligned');

    const centeredText = Text('Centred in a 48px row');
    centeredText.centerInHeight(48);

    const centeredBox = Panel({
        layoutManager:  HBox(),
        components:     [centeredText],
        preferredSize:  { width: 220, height: 48 },
    });

    return Panel({
        layoutManager: HBox({ spacing: 16 }),
        components:    [leftText, centeredBox],
    });
}
