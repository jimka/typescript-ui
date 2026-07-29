import type { Component } from '@jimka/typescript-ui/core';
import { Tree } from '@jimka/typescript-ui/component/tree';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 is the same file/folder hierarchy `treetable-hierarchy` shows, fully
 * expanded, plus the surrounding frame.
 */
export const height: number = 200;

/**
 * A `Tree` over folder/file node literals; click the caret to expand or
 * collapse a folder, click a row to select it.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const tree = Tree();

    tree.setNodes([
        { label: 'src',  children: [{ label: 'main.ts' }, { label: 'Component.ts' }] },
        { label: 'docs', children: [{ label: 'guide.md' }] },
        { label: 'package.json' },
    ]);

    return tree;
}
