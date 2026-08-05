import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { TextArea, Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is the text area plus the echo line below it.
 */
export const height: number = 120;

/**
 * A `TextArea` with a `Text` below echoing its live value on every keystroke.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const notes = TextArea('Type here…', { preferredSize: { width: 320, height: 72 } });

    const echoText = Text('Type here…');

    notes.on('change', handleChange);

    function handleChange(value: string): void {
        echoText.setText(value);
    }

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [notes, echoText],
    });
}
