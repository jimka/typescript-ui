import type { Component } from '@jimka/typescript-ui/core';
import { Header } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one header bar plus room around the frame for the stage's border.
 */
export const height: number = 64;

/**
 * A `Header` bar with a section title, spanning the live area's full width —
 * the way a panel header is actually used.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    return Header('Settings');
}
