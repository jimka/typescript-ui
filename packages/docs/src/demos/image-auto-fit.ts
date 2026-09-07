import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Image } from '@jimka/typescript-ui/component/display';
import { Text } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 is the next size up from the auto-fit image's natural 64x64 content,
 * leaving room for the status line, the swap button, and the frame's own
 * border.
 */
export const height: number = 200;

/**
 * An `Image` with no `preferredSize`, so it reports no opinion until the
 * real `load` event fires and the component publishes its natural
 * dimensions; a `Text` status line, updated from an `on('load', ...)`
 * listener, shows the size once it arrives. A "Swap image" button calls
 * `setSrc` with a differently-sized source, demonstrating that a source
 * change invalidates the cached natural size and re-measures on the next
 * `load` instead of freezing at the first image's dimensions.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const squareSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"'
        + ' viewBox="0 0 64 64">'
        + '<rect x="8" y="8" width="48" height="48" rx="8"/>'
        + '</svg>';

    const circleSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"'
        + ' viewBox="0 0 40 40">'
        + '<circle cx="20" cy="20" r="16"/>'
        + '</svg>';

    const status = Text('loading…');

    const logo = Image(
        `data:image/svg+xml,${encodeURIComponent(squareSvg)}`,
        { alt: 'Auto-fit demo shape' },
    );
    logo.on('load', handleLoad);

    let showingSquare = true;

    const swapButton = Button({ text: 'Swap image', listeners: { action: handleSwap } });

    function handleLoad(): void {
        const size = logo.getPreferredSize();

        status.setText(size ? `loaded at ${size.width}×${size.height}` : 'loaded');
    }

    function handleSwap(): void {
        showingSquare = !showingSquare;

        const svg = showingSquare ? squareSvg : circleSvg;

        logo.setSrc(`data:image/svg+xml,${encodeURIComponent(svg)}`);
    }

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [logo, status, swapButton],
    });
}
