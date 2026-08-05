import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { IconText, Glyph } from '@jimka/typescript-ui/component/display';
import { plug } from '@jimka/typescript-ui/glyphs/solid/plug';
import { clock } from '@jimka/typescript-ui/glyphs/solid/clock';
import { circle_check } from '@jimka/typescript-ui/glyphs/solid/circle_check';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of `IconText`s plus room around the frame for the stage's
 * border.
 */
export const height: number = 64;

/**
 * Three `IconText`s pairing a glyph with a standalone text label — a
 * connection status line, a timestamp, and a confirmation.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    Glyph.register(plug, clock, circle_check);

    const connectionText = IconText('plug', 'Connected');
    const savedText = IconText('clock', 'Last saved 2m ago');
    const syncedText = IconText('circle-check', 'All changes synced');

    return Panel({
        layoutManager: HBox({ spacing: 16 }),
        components:    [connectionText, savedText, syncedText],
    });
}
