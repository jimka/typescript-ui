// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Markdown } from '@jimka/typescript-ui/component/display';

const SAMPLE = `# Markdown component

A **live** DOM subtree built from a Markdown source string through the framework
DOM sink — *no* \`innerHTML\` anywhere.

## Features

- Headings \`#\` … \`######\`
- **Bold**, *italic*, and \`inline code\`
- Ordered and unordered lists
- [Links](https://example.com) open in a new tab

### Ordered list

1. First item
2. Second item

> Blockquotes render with a left bar and indented prose.

\`\`\`typescript
const md = new Markdown("# Hello");
panel.addComponent(md);
\`\`\`

Unsupported tokens (tables, images) fall back to plain text and never crash.`;

/**
 * Demo panel showcasing the [`Markdown`](/api/component/display/classes/Markdown)
 * display component: a single instance rendering a sample document inside a
 * scrolling `Fit` panel. The component measures its own content height, so the
 * panel's `autoScroll` produces a scrollbar whenever the document overflows.
 */
class MarkdownPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new Fit());
        this.setAutoScroll("auto");

        this.addComponent(new Markdown(SAMPLE));
    }
}

const MarkdownPanelCallable = callable(MarkdownPanel);
type MarkdownPanelCallable = MarkdownPanel;
export {
    MarkdownPanel         as _MarkdownPanel,
    MarkdownPanelCallable as MarkdownPanel
};
