import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Image } from '@jimka/typescript-ui/component/display';
import { Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is the auto-fit image at its natural 64x64 plus the status line and
 * room around the frame for the stage's border.
 */
export const height: number = 120;

/**
 * An `Image` with no `preferredSize`, so it reports no opinion until the
 * real `load` event fires and the component publishes its natural
 * dimensions; a `Text` status line, updated from an `on('load', ...)`
 * listener, shows the size once it arrives.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"'
        + ' viewBox="0 0 64 64">'
        + '<rect x="8" y="8" width="48" height="48" rx="8"/>'
        + '</svg>';

    const status = Text('loading…');

    const logo = Image(`data:image/svg+xml,${encodeURIComponent(svg)}`);
    logo.on('load', handleLoad);

    function handleLoad(): void {
        const size = logo.getPreferredSize();

        status.setText(size ? `loaded at ${size.width}×${size.height}` : 'loaded');
    }

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [logo, status],
    });
}
