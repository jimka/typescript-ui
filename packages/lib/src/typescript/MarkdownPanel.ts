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

### GFM table

| Feature | Aligned | Notes |
|:---|:---:|---:|
| Tables | yes | 0.05 |
| Alignment | yes | left/center/right |

Unsupported tokens (images, raw HTML) fall back to plain text and never crash.`;

/**
 * Demo panel showcasing the [`Markdown`](/api/component/display/classes/Markdown)
 * display component: a single instance rendering a sample document inside a
 * scrolling `Fit` panel. The prose wraps to the panel width and the component
 * measures its own flowed height, so vertical `autoScroll` produces a scrollbar
 * whenever the document is taller than the panel.
 */
class MarkdownPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new Fit());
        this.setAutoScroll("y");

        this.addComponent(new Markdown(SAMPLE));
    }
}

const MarkdownPanelCallable = callable(MarkdownPanel);
type MarkdownPanelCallable = MarkdownPanel;
export {
    MarkdownPanel         as _MarkdownPanel,
    MarkdownPanelCallable as MarkdownPanel
};
