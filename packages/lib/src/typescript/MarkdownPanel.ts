// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { MarkdownViewer } from '@jimka/typescript-ui/component/display';

const SAMPLE = `# Markdown component

A **live** DOM subtree built from a Markdown source string through the framework
DOM sink — *no* \`innerHTML\` anywhere.

## Features

- Headings \`#\` … \`######\`
- **Bold**, *italic*, ++underlined++, and \`inline code\`
- [Coloured]{color=#cc0000}, [sized]{size=1.3em}, and [font-styled]{font=Georgia} spans
- Ordered and unordered lists
- [Links](https://example.com) open in a new tab

### Ordered list

1. First item
2. Second item

> Blockquotes render with a left bar and indented prose.

\`\`\`typescript
import { Markdown } from '@jimka/typescript-ui/component/display';
import { Panel } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';

// A fenced block longer than 20 rows stays capped at the 20-row height and
// grows a native vertical scrollbar instead of pushing the rest of this
// page down — this block does exactly that, on purpose, to show it off.
const panel = new Panel({ layoutManager: new Fit(), autoScroll: 'y' });
const md = new Markdown('# Hello');

panel.addComponent(md);
md.setLinkResolver((href) => ({ href, external: !href.startsWith('/') }));

async function refresh(url: string): Promise<void> {
    const response = await fetch(url);
    const text = await response.text();

    md.setMarkdown(text);
}

void refresh('/docs/intro.md');
\`\`\`

A short block stays under the 20-row cap, so a line wider than the prose
column grows *this* block's own box taller instead — tall enough for both
the content and CodeMirror's own horizontal scrollbar, with the last row
staying fully visible above the bar instead of sitting behind it.

\`\`\`sql
SELECT id, name, email, created_at, updated_at, status, role, last_login_at FROM users WHERE status = 'active' ORDER BY created_at DESC LIMIT 50;
\`\`\`

### GFM table

| Feature | Aligned | Notes |
|:---|:---:|---:|
| Tables | yes | 0.05 |
| Alignment | yes | left/center/right |

### Sized and merged columns

| Feature {width=200} | Support |
| --- | --- |
| Column width | yes |
| Merged cells | << |

::: {align=center}
This paragraph is centred inside a \`::: {align=center}\` fence.
:::

::: {columns=2 gap=2em}
Fences also lay out block content across multiple CSS columns, splitting a
longer run of prose into a newspaper-style two-column layout without any
extra markup beyond the fence itself.

A second paragraph flows into whichever column has room next.
:::

### Sized image

![Diagram](https://placehold.co/320x160){width=320 height=160}

Unsupported tokens (raw HTML, task lists) fall back to plain text and never crash.`;

/**
 * Demo panel showcasing the [`MarkdownViewer`](/api/component/display/classes/MarkdownViewer)
 * component: a single instance rendering a sample document inside a `Fit`
 * panel. `MarkdownViewer` scrolls internally, so this host panel stays
 * unscrolled itself — a redundant `autoScroll` here would starve it of a
 * bounded height and hand scrolling to this outer panel instead.
 */
class MarkdownPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new Fit());

        this.addComponent(new MarkdownViewer({
            markdown: SAMPLE
        }));
    }
}

const MarkdownPanelCallable = callable(MarkdownPanel);
type MarkdownPanelCallable = MarkdownPanel;
export {
    MarkdownPanel         as _MarkdownPanel,
    MarkdownPanelCallable as MarkdownPanel
};
