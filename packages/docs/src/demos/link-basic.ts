import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Link, Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of text and links plus room around the frame for the stage's
 * border.
 */
export const height: number = 64;

/**
 * An in-app `Link` that activates on click/Enter and updates a status
 * `Text`, beside a presentational (non-activating) `Link`.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const statusText = Text('');

    const activeLink = Link('Open the release notes', { listeners: { action: handleOpen } });

    const presentationalLink = Link('orders', { interactive: false });

    function handleOpen(): void {
        statusText.setText('Opened.');
    }

    return Panel({
        layoutManager: HBox({ spacing: 12 }),
        components:    [activeLink, presentationalLink, statusText],
    });
}
