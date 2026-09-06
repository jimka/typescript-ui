import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { Split, Fit, FillType } from '@jimka/typescript-ui/layout';
import { Image, Header } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 is the split's natural pane height plus the frame's own border.
 */
export const height: number = 200;

/**
 * An `Image` with `preserveAspectRatio: true` as the left pane of a
 * resizable `Split`, wrapped in a `Fit({ fill: FillType.HORIZONTAL })` so the
 * pane stretches the image's width to the drag-resized allocation while
 * still reading its derived preferred height back — `Split` panes fill both
 * axes on their own, so without this wrapper the image would be stretched
 * instead of staying aspect-locked. Drag the gutter and the image's own box
 * stays locked to its natural 2:1 aspect ratio instead of stretching —
 * `setWidth` re-derives the height on every drag frame.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const rectSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"'
        + ' viewBox="0 0 240 120"><rect width="240" height="120" rx="12"/></svg>';

    const aspectImage = Image(
        `data:image/svg+xml,${encodeURIComponent(rectSvg)}`,
        { alt: 'Aspect-locked rectangle', preserveAspectRatio: true },
    );

    const fitPane = Panel({
        layoutManager: Fit({ fill: FillType.HORIZONTAL }),
        components:    [aspectImage],
    });

    const split = Panel({ layoutManager: Split({ orientation: 'horizontal' }) });

    split.addComponent(fitPane);
    split.addComponent(Header('Drag the gutter'));

    return split;
}
