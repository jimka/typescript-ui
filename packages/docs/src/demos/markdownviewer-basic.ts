import type { Component } from '@jimka/typescript-ui/core';
import { MarkdownViewer } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 320 (the tallest of the five allowed scale values) leaves enough room for
 * the floating minimap and controls to sit clear of a couple of lines of
 * prose while still needing to scroll to reach the document's later
 * headings — the point of the demo.
 */
export const height: number = 320;

/**
 * A `MarkdownViewer` showing its floating heading-outline minimap and
 * width/zoom control cluster over a multi-section document.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const source = `# Guide

Scroll this pane, or click a row in the minimap top-right, to jump around.
Try the width/zoom buttons bottom-right too.

## Getting started

A few paragraphs of introductory prose, long enough that the section spans
more than a screenful once the width/zoom controls narrow the column or
increase the font size.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio
praesent libero sed cursus ante dapibus diam sed nisi nulla quis sem at nibh
elementum imperdiet duis sagittis ipsum praesent mauris fusce nec tellus.

### Installation

\`\`\`bash
npm install @jimka/typescript-ui
\`\`\`

### Configuration

Sed aliquam ultrices mauris integer ante arcu accumsan a consectetuer eget
posuere mauris sit amet aliquam vel diam curabitur vel lectus in quam.

## Advanced usage

Nunc nisl duis bibendum felis sed interdum venenatis turpis enim blandit mi
in porttitor pede justo eu massa donec dapibus duis at velit eu est congue
elementum in hac habitasse.

### Custom themes

Fusce a quam facilisis lacus ut a nibh in ac risus quis varius quis pulvinar
in nulla enim donec tempor tellus egestas sed sed risus pretium quam.

## Reference

See the API reference for the full method list.
`;

    return MarkdownViewer({ markdown: source });
}
