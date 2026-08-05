import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { TextArea } from '@jimka/typescript-ui/component/input';
import { Markdown } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 is the source text area plus the rendered preview beneath it.
 */
export const height: number = 200;

/**
 * A `TextArea` of Markdown source with a `Markdown` panel below it that
 * re-renders live as you type.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const initialSource = '# Hello\n\nSome **bold** text and a [link](https://example.com).';

    const source = TextArea(initialSource, { preferredSize: { width: 320, height: 80 } });

    const preview = Markdown(initialSource, { preferredSize: { width: 320, height: 96 } });

    source.on('change', handleChange);

    function handleChange(value: string): void {
        preview.setMarkdown(value);
    }

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [source, preview],
    });
}
