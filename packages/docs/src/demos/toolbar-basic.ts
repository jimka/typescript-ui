import type { Component } from '@jimka/typescript-ui/core';
import { ToolBar } from '@jimka/typescript-ui/component/menubar';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of buttons plus room around the frame for the stage's
 * border.
 */
export const height: number = 64;

/**
 * A `ToolBar` with enough buttons, at the stage's 900px cap, to show its
 * overflow menu.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    // Deliberately more labels than fit at the stage's 900px width cap, so
    // the trailing buttons collapse into the overflow chevron menu.
    const buttonLabels = [
        'New', 'Open', 'Save', 'Save As', 'Print', 'Undo', 'Redo', 'Cut', 'Copy',
        'Paste', 'Find', 'Replace', 'Zoom In', 'Zoom Out', 'Settings',
    ];

    const bar = ToolBar({ overflow: 'menu' });

    for (const label of buttonLabels) {
        bar.addComponent(Button({ text: label }));
    }

    return bar;
}
