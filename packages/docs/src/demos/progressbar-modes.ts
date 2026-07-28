import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { ProgressBar } from '@jimka/typescript-ui/component/display';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is the bars row and the stepping-buttons row beneath it.
 */
export const height: number = 120;

/**
 * A determinate `ProgressBar` at 60% beside an indeterminate one; the
 * buttons step the determinate bar's value up and down by 10.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const determinateBar = ProgressBar(60, false, { preferredSize: { width: 160, height: 14 } });

    const indeterminateBar = ProgressBar(0, true, { preferredSize: { width: 160, height: 14 } });

    const decreaseButton = Button({ text: '-10', listeners: { action: handleDecrease } });

    const increaseButton = Button({ text: '+10', listeners: { action: handleIncrease } });

    function handleIncrease(): void {
        determinateBar.setValue(Math.min(100, determinateBar.getValue() + 10));
    }

    function handleDecrease(): void {
        determinateBar.setValue(Math.max(0, determinateBar.getValue() - 10));
    }

    const barsRow = Panel({
        layoutManager: HBox({ spacing: 16 }),
        components:    [determinateBar, indeterminateBar],
    });

    const buttonsRow = Panel({
        layoutManager: HBox({ spacing: 8 }),
        components:    [decreaseButton, increaseButton],
    });

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [barsRow, buttonsRow],
    });
}
