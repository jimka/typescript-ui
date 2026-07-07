// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { Fit, Split } from '@jimka/typescript-ui/layout';
import { Markdown } from '@jimka/typescript-ui/component/display';
import { MarkdownEditor } from '@jimka/typescript-ui/component/editor';

const SAMPLE = `# MarkdownEditor

A **WYSIWYG** editor whose value is a *Markdown* string, built on Lexical.

## Try it

- Type \`**bold**\`, \`*italic*\`, or \`\` \`code\` \`\`
- Start a line with \`# \` for a heading, \`- \` for a bullet, \`> \` for a quote
- Use Ctrl/Cmd+B and Ctrl/Cmd+I

1. It emits only the [Markdown](https://commonmark.org) subset the viewer renders
2. The panel on the right renders \`getValue()\` live

> Edit on the left; the read-only Markdown viewer on the right stays in sync.

\`\`\`
const editor = new MarkdownEditor("# Hello");
\`\`\`
`;

/**
 * Demo panel showcasing the [`MarkdownEditor`](/api/component/editor/classes/MarkdownEditor)
 * component beside the read-only [`Markdown`](/api/component/display/classes/Markdown)
 * viewer. Editing on the left drives the viewer on the right through the
 * editor's `"change"` event and `getValue()`, visually proving the dialect
 * round-trips: what you edit renders identically in the viewer. The editor fills
 * its `Fit` host and scrolls internally; the viewer sits in a vertically
 * scrolling panel.
 */
class MarkdownEditorPanel extends Panel {

    private readonly _editor: MarkdownEditor;
    private readonly _viewer: Markdown;

    constructor() {
        super();

        this.setLayoutManager(new Split());

        this._editor = new MarkdownEditor(SAMPLE);
        this._viewer = new Markdown(SAMPLE);

        const editorHost = new Panel({ layoutManager: new Fit() });
        editorHost.addComponent(this._editor);
        this.addComponent(editorHost);

        const viewerHost = new Panel({ layoutManager: new Fit() });
        viewerHost.setAutoScroll('y');
        viewerHost.addComponent(this._viewer);
        this.addComponent(viewerHost);

        this._editor.on('change', () => this.syncViewer());
    }

    private syncViewer(): void {
        this._viewer.setMarkdown(this._editor.getValue());
    }
}

const MarkdownEditorPanelCallable = callable(MarkdownEditorPanel);
type MarkdownEditorPanelCallable = MarkdownEditorPanel;
export {
    MarkdownEditorPanel         as _MarkdownEditorPanel,
    MarkdownEditorPanelCallable as MarkdownEditorPanel
};
