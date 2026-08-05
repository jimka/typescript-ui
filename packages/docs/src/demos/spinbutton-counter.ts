import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { SpinButton, Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of spin buttons and a count plus room around the frame for
 * the stage's border.
 */
export const height: number = 64;

/**
 * A `SpinButton` incrementing and a `SpinButton` decrementing a
 * `Text`-displayed count; hold either down to see the repeat cadence.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const countText = Text('0');

    let count = 0;

    const downButton = SpinButton('▼');
    downButton.on('tick', handleDown);

    const upButton = SpinButton('▲');
    upButton.on('tick', handleUp);

    function handleUp(): void {
        count += 1;
        countText.setText(String(count));
    }

    function handleDown(): void {
        count -= 1;
        countText.setText(String(count));
    }

    return Panel({
        layoutManager: HBox({ spacing: 8 }),
        components:    [downButton, countText, upButton],
    });
}
