import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { MenuBar } from '@jimka/typescript-ui/component/menubar';
import { Text } from '@jimka/typescript-ui/component/input';
import { CheckboxMenuRow } from '@jimka/typescript-ui/component/container';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is the menu bar row plus the current-selection echo line beneath it.
 */
export const height: number = 64;

/**
 * A `MenuBar` "Format" menu built entirely from `CheckboxMenuRow` entries — a
 * real `Checkbox` per row instead of `MenuItem`'s text checkmark — so
 * toggling Bold / Italic / Underline leaves the menu open across clicks and a
 * `Text` below echoes the current selection.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const labels: Record<string, string> = {
        bold: 'Bold', italic: 'Italic', underline: 'Underline',
    };
    const selected = new Set<string>(['bold']);
    const selectionText = Text('Selected: Bold');

    function updateSelectionText(): void {
        const active = Object.keys(labels).filter(key => selected.has(key)).map(key => labels[key]);
        const text = active.length > 0 ? `Selected: ${active.join(', ')}` : 'Selected: (none)';

        selectionText.setText(text);
    }

    function formatRow(key: string): CheckboxMenuRow {
        const row = new CheckboxMenuRow({ text: labels[key], checked: selected.has(key) });

        // Fires after the row's own state has already flipped, so isChecked()
        // here reads the new value.
        row.on('action', () => {
            if (row.isChecked()) {
                selected.add(key);
            } else {
                selected.delete(key);
            }

            updateSelectionText();
        });

        return row;
    }

    const bar = MenuBar({
        menus: [
            { label: 'Format', items: [
                { row: () => formatRow('bold') },
                { row: () => formatRow('italic') },
                { row: () => formatRow('underline') },
            ] },
        ],
    });

    return Panel({
        layoutManager: VBox({ stretching: true }),
        components:    [bar, selectionText],
    });
}
