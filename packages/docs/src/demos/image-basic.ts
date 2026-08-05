import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Image } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is the pinned 80x80 image plus room around the frame for the stage's
 * border.
 */
export const height: number = 120;

/**
 * A small inline SVG shape, encoded as a `data:` URI so the demo needs no
 * external asset.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        + '<circle cx="32" cy="32" r="28"/>'
        + '</svg>';

    const logo = Image(
        `data:image/svg+xml,${encodeURIComponent(svg)}`,
        { preferredSize: { width: 80, height: 80 } },
    );

    return Panel({
        layoutManager: HBox(),
        components:    [logo],
    });
}
