import type { Component } from '@jimka/typescript-ui/core';
import { StatusBar } from '@jimka/typescript-ui/component/container';
import { IconText, Glyph } from '@jimka/typescript-ui/component/display';
import { plug } from '@jimka/typescript-ui/glyphs/solid/plug';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is the bar's own fixed 22px height plus room around the frame for the
 * stage's border.
 */
export const height: number = 64;

/**
 * A `StatusBar` showing a status message and a small persistent connection
 * indicator, spanning the live area's full width the way a status strip is
 * actually used.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    Glyph.register(plug);

    const bar = StatusBar({ defaultMessage: 'Ready' });

    bar.addRight(IconText('plug', 'Connected'));

    return bar;
}
