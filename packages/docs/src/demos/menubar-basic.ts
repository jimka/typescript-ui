import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { MenuBar } from '@jimka/typescript-ui/component/menubar';
import { Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is the menu bar row plus the last-clicked echo line beneath it.
 */
export const height: number = 64;

/**
 * A `MenuBar` with File/Edit/View menus, each with a few items and a
 * separator; clicking an item updates a `Text`.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const lastActionText = Text('Last action: (none)');

    function handleNew(): void {
        lastActionText.setText('Last action: File → New');
    }

    function handleOpen(): void {
        lastActionText.setText('Last action: File → Open');
    }

    function handleQuit(): void {
        lastActionText.setText('Last action: File → Quit');
    }

    function handleUndo(): void {
        lastActionText.setText('Last action: Edit → Undo');
    }

    function handleRedo(): void {
        lastActionText.setText('Last action: Edit → Redo');
    }

    function handleZoomIn(): void {
        lastActionText.setText('Last action: View → Zoom In');
    }

    function handleZoomOut(): void {
        lastActionText.setText('Last action: View → Zoom Out');
    }

    const bar = MenuBar({
        menus: [
            { label: 'File', items: [
                { text: 'New',  action: handleNew },
                { text: 'Open', action: handleOpen },
                { separator: true },
                { text: 'Quit', action: handleQuit },
            ] },
            { label: 'Edit', items: [
                { text: 'Undo', action: handleUndo },
                { text: 'Redo', action: handleRedo },
            ] },
            { label: 'View', items: [
                { text: 'Zoom In',  action: handleZoomIn },
                { text: 'Zoom Out', action: handleZoomOut },
            ] },
        ],
    });

    return Panel({
        layoutManager: VBox({ stretching: true }),
        components:    [bar, lastActionText],
    });
}
