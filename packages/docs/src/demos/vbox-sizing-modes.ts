import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is two four-row columns tall enough to show the mode difference plus
 * the surrounding frame.
 */
export const height: number = 260;

/**
 * Two columns over the same four differently-sized children: `mode:
 * "preferred"` keeps each row's own height, `mode: "equal"` divides the
 * column evenly among them.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const preferredAlpha = Button({ text: 'Alpha' });

    const preferredBeta = Button({ text: 'Beta', description: 'Two-line button' });

    const preferredGamma = Button({ text: 'Gamma' });

    const preferredDelta = Button({ text: 'Delta', description: 'Two-line button' });

    const preferredColumn = Panel({
        layoutManager: VBox({ mode: 'preferred', spacing: 4 }),
        components:    [preferredAlpha, preferredBeta, preferredGamma, preferredDelta],
    });

    const equalAlpha = Button({ text: 'Alpha' });

    const equalBeta = Button({ text: 'Beta', description: 'Two-line button' });

    const equalGamma = Button({ text: 'Gamma' });

    const equalDelta = Button({ text: 'Delta', description: 'Two-line button' });

    const equalColumn = Panel({
        layoutManager: VBox({ mode: 'equal', stretching: true, spacing: 4 }),
        components:    [equalAlpha, equalBeta, equalGamma, equalDelta],
    });

    return Panel({
        layoutManager: HBox({ spacing: 16 }),
        components:    [preferredColumn, equalColumn],
    });
}
