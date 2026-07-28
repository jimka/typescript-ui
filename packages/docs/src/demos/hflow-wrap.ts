import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HFlow } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is room for several wrapped lines of buttons plus the surrounding
 * frame.
 */
export const height: number = 260;

/**
 * A dozen buttons in an `HFlow`; narrowing the pane wraps them into more
 * lines, widening it wraps them into fewer.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const labels = [
        'Alpha', 'Beta', 'Gamma', 'Delta', 'Echo', 'Foxtrot',
        'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima',
    ];

    const buttons = labels.map((label) => Button({ text: label }));

    return Panel({
        layoutManager: HFlow({ spacing: 6, lineSpacing: 6 }),
        components:    buttons,
    });
}
