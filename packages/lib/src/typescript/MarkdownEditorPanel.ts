// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component, Panel } from '@jimka/typescript-ui/core';
import { Border, Fit, HBox, Split } from '@jimka/typescript-ui/layout';
import { Placement } from '@jimka/typescript-ui/primitive';
import { Button } from '@jimka/typescript-ui/component/button';
import { Markdown } from '@jimka/typescript-ui/component/display';
import { MarkdownDocumentPanel } from '@jimka/typescript-ui/component/editor';
import { Text } from '@jimka/typescript-ui/component/input';

const SAMPLE = `# MarkdownEditor

A **WYSIWYG** editor whose value is a *Markdown* string, built on Lexical.

## Try it

- Type \`**bold**\`, \`*italic*\`, \`++underline++\`, or \`\` \`code\` \`\`
- Start a line with \`# \` for a heading, \`- \` for a bullet, \`> \` for a quote
- Use Ctrl/Cmd+B and Ctrl/Cmd+I
- Right-click a word for [coloured]{color=#cc0000} or [sized]{size=1.3em} text

1. It emits only the [Markdown](https://commonmark.org) subset the viewer renders
2. The panel on the right renders \`getValue()\` live

> Edit on the left; the read-only Markdown viewer on the right stays in sync.

| Column {width=160} | Aligned |
|:---|:---:|
| Tables | yes |
| Merge | << |

::: {align=center}
A centred paragraph inside a fence.
:::

::: columns
Left column.
|||
Right column.
:::

![Diagram](https://placehold.co/240x120){width=240 height=120}

\`\`\`
const editor = new MarkdownEditor("# Hello");
\`\`\`
`;

/**
 * Demo panel showcasing the [`MarkdownDocumentPanel`](/api/component/editor/classes/MarkdownDocumentPanel)
 * component beside the read-only [`Markdown`](/api/component/display/classes/Markdown)
 * viewer. Editing on the left drives the viewer on the right through
 * `MarkdownDocumentPanel`'s own `"change"` event and `getValue()`, visually
 * proving the dialect round-trips: what you edit renders identically in the
 * viewer. A status row below the editor reports the editor's own dirty flag
 * and the panel's own, the panel's arriving through the framework's
 * parent-to-child relay three containers up; Save clears it, and so does
 * undoing an edit back to the last-saved text.
 */
class MarkdownEditorPanel extends Panel {

    private readonly _editorPanel: MarkdownDocumentPanel;
    private readonly _viewer: Markdown;
    private readonly _statusText: Text;

    constructor() {
        super();

        this.setLayoutManager(new Split());

        this._editorPanel = new MarkdownDocumentPanel({ value: SAMPLE });
        this._viewer = new Markdown(SAMPLE);

        // Writes nothing — only clears the dirty flag, standing in for a
        // host that has persisted the document.
        const saveBtn = new Button('Save');
        saveBtn.on('action', () => { this._editorPanel.markClean(); });

        this._statusText = new Text('');

        const statusRow = new Component({ layoutManager: new HBox() });
        statusRow.addComponent(saveBtn);
        statusRow.addComponent(this._statusText);

        const editorHost = new Panel({ layoutManager: new Border() });
        editorHost.addComponent(this._editorPanel, { placement: Placement.CENTER });
        editorHost.addComponent(statusRow,          { placement: Placement.SOUTH });

        this.addComponent(editorHost);

        const viewerHost = new Panel({ layoutManager: new Fit() });
        viewerHost.setAutoScroll('y');
        viewerHost.addComponent(this._viewer);
        this.addComponent(viewerHost);

        this._editorPanel.on('change', () => this.syncViewer());
        this.onDirtyChange(this.handleDirtyChange);
        this.handleDirtyChange();
    }

    private syncViewer(): void {
        this._viewer.setMarkdown(this._editorPanel.getValue());
    }

    private readonly handleDirtyChange = (): void => {
        this._statusText.setText(
            `Dirty — editor: ${this._editorPanel.isDirty() ? 'yes' : 'no'}`
            + `, panel (3 levels up): ${this.isDirty() ? 'yes' : 'no'}`);
    };
}

const MarkdownEditorPanelCallable = callable(MarkdownEditorPanel);
type MarkdownEditorPanelCallable = MarkdownEditorPanel;
export {
    MarkdownEditorPanel         as _MarkdownEditorPanel,
    MarkdownEditorPanelCallable as MarkdownEditorPanel
};
