import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { MultiSelectList } from '@jimka/typescript-ui/component/list';
import { Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 is the five-item list plus the selection echo line below it.
 */
export const height: number = 200;

/**
 * A `MultiSelectList` of five tag strings with Ctrl/Shift multi-select, and
 * a `Text` below showing the current selection.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const tags = MultiSelectList();
    tags.setItems(['Urgent', 'Blocked', 'Reviewed', 'In progress', 'Done']);
    tags.setPreferredSize({ width: 240, height: 140 });

    const selectionText = Text('Selection: (none)');

    tags.on('change', handleChange);

    function handleChange(selected: string[]): void {
        const summary = selected.length > 0 ? selected.join(', ') : '(none)';

        selectionText.setText(`Selection: ${summary}`);
    }

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [tags, selectionText],
    });
}
