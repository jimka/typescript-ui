import type { Component } from '@jimka/typescript-ui/core';
import { SplitButton } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of default-height buttons plus room around the frame for the
 * stage's border.
 */
export const height: number = 64;

/**
 * A `SplitButton` whose face fires the primary action and whose chevron opens
 * a three-item dropdown menu; each destination relabels the button.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const saveButton = SplitButton('Save', {
        menuItems: [
            { text: 'Save As…',   action: handleSaveAs },
            { text: 'Save All',   action: handleSaveAll },
            { text: 'Export PDF', action: handleExportPdf },
        ],
    });

    saveButton.on('action', handleSave);

    function handleSave(): void {
        saveButton.setText('Saved');
    }

    function handleSaveAs(): void {
        saveButton.setText('Saved as…');
    }

    function handleSaveAll(): void {
        saveButton.setText('Saved all');
    }

    function handleExportPdf(): void {
        saveButton.setText('Exported PDF');
    }

    return saveButton;
}
