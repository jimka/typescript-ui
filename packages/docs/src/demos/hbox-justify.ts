import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { Button, ToggleButton } from '@jimka/typescript-ui/component/button';
import { ButtonGroup } from '@jimka/typescript-ui/overlay';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is the toggle row, the demonstrated row, and room to see the slack
 * `justify` redistributes, plus the surrounding frame.
 */
export const height: number = 260;

/**
 * Three buttons in an `HBox`; the `ToggleButton` row above switches the
 * row's `justify` between its five values at runtime.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const rowLayout = HBox({ justify: 'start' });

    const oneButton = Button({ text: 'One' });

    const twoButton = Button({ text: 'Two' });

    const threeButton = Button({ text: 'Three' });

    const row = Panel({
        layoutManager: rowLayout,
        components:    [oneButton, twoButton, threeButton],
    });

    const startToggle = ToggleButton('Start', {
        selected:  true,
        listeners: { action: handleStart },
    });

    const centerToggle = ToggleButton('Center', { listeners: { action: handleCenter } });

    const endToggle = ToggleButton('End', { listeners: { action: handleEnd } });

    const betweenToggle = ToggleButton('Between', { listeners: { action: handleBetween } });

    const aroundToggle = ToggleButton('Around', { listeners: { action: handleAround } });

    ButtonGroup({ buttons: [startToggle, centerToggle, endToggle, betweenToggle, aroundToggle] });

    function handleStart(): void {
        rowLayout.setJustify('start');
    }

    function handleCenter(): void {
        rowLayout.setJustify('center');
    }

    function handleEnd(): void {
        rowLayout.setJustify('end');
    }

    function handleBetween(): void {
        rowLayout.setJustify('between');
    }

    function handleAround(): void {
        rowLayout.setJustify('around');
    }

    const toggleRow = Panel({
        layoutManager: HBox({ spacing: 4 }),
        components:    [startToggle, centerToggle, endToggle, betweenToggle, aroundToggle],
    });

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [toggleRow, row],
    });
}
