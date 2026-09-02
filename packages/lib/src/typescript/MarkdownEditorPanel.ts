// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { Border, Fit, Split } from '@jimka/typescript-ui/layout';
import { Placement } from '@jimka/typescript-ui/primitive';
import { Button, ToggleButton } from '@jimka/typescript-ui/component/button';
import { ToolBar } from '@jimka/typescript-ui/component/menubar';
import { Markdown } from '@jimka/typescript-ui/component/display';
import { MarkdownEditor } from '@jimka/typescript-ui/component/editor';
import { Text } from '@jimka/typescript-ui/component/input';

const SAMPLE = `# MarkdownEditor

A **WYSIWYG** editor whose value is a *Markdown* string, built on Lexical.

## Try it

- Type \`**bold**\`, \`*italic*\`, or \`\` \`code\` \`\`
- Start a line with \`# \` for a heading, \`- \` for a bullet, \`> \` for a quote
- Use Ctrl/Cmd+B and Ctrl/Cmd+I

1. It emits only the [Markdown](https://commonmark.org) subset the viewer renders
2. The panel on the right renders \`getValue()\` live

> Edit on the left; the read-only Markdown viewer on the right stays in sync.

| Column | Aligned |
|:---|:---:|
| Tables | yes |

\`\`\`
const editor = new MarkdownEditor("# Hello");
\`\`\`
`;

/**
 * Demo panel showcasing the [`MarkdownEditor`](/api/component/editor/classes/MarkdownEditor)
 * component beside the read-only [`Markdown`](/api/component/display/classes/Markdown)
 * viewer. Editing on the left drives the viewer on the right through the
 * editor's `"change"` event and `getValue()`, visually proving the dialect
 * round-trips: what you edit renders identically in the viewer. A toolbar toggle
 * over the editor switches it between the WYSIWYG surface and a raw-Markdown
 * source editor via `setMode`; the viewer stays in sync in both modes. The editor
 * fills its `Fit` host and scrolls internally; the viewer sits in a vertically
 * scrolling panel. A status row below the editor reports the editor's own dirty
 * flag and the panel's own, the panel's arriving through the framework's
 * parent-to-child relay three containers up; Save clears it, and so does
 * undoing an edit back to the last-saved text.
 */
class MarkdownEditorPanel extends Panel {

    private readonly _editor: MarkdownEditor;
    private readonly _viewer: Markdown;
    private readonly _statusText: Text;

    constructor() {
        super();

        this.setLayoutManager(new Split());

        this._editor = new MarkdownEditor(SAMPLE);
        this._viewer = new Markdown(SAMPLE);

        // A toolbar toggle drives the editor's WYSIWYG / raw-Markdown source mode;
        // the mode API is consumer-wired (the editor ships no built-in chrome).
        const sourceToggle = new ToggleButton('Edit Markdown source');
        sourceToggle.on('action', () => { this._editor.setMode(sourceToggle.isSelected() ? 'source' : 'wysiwyg'); });

        // The table command API is consumer-wired, like the mode toggle above;
        // a named method (not an inline arrow) is the listener-wiring convention.
        const insertTableButton = new Button('Insert table');
        insertTableButton.on('action', this.handleInsertTable);

        // Writes nothing — only clears the dirty flag, standing in for a
        // host that has persisted the document.
        const saveBtn = new Button('Save');
        saveBtn.on('action', () => { this._editor.markClean(); });

        const toolbar = new ToolBar();
        toolbar.addComponent(sourceToggle);
        toolbar.addComponent(insertTableButton);
        toolbar.addComponent(saveBtn);

        const editorFit = new Panel({ layoutManager: new Fit() });
        editorFit.addComponent(this._editor);

        const editorHost = new Panel({ layoutManager: new Border() });
        editorHost.addComponent(toolbar,    { placement: Placement.NORTH });
        editorHost.addComponent(editorFit,  { placement: Placement.CENTER });

        this._statusText = new Text('');
        editorHost.addComponent(this._statusText, { placement: Placement.SOUTH });

        this.addComponent(editorHost);

        const viewerHost = new Panel({ layoutManager: new Fit() });
        viewerHost.setAutoScroll('y');
        viewerHost.addComponent(this._viewer);
        this.addComponent(viewerHost);

        this._editor.on('change', () => this.syncViewer());
        this.onDirtyChange(this.handleDirtyChange);
        this.handleDirtyChange();
    }

    private syncViewer(): void {
        this._viewer.setMarkdown(this._editor.getValue());
    }

    // An arrow-function field, not a method: passed as a bare `this.handler`
    // reference to `on("action", ...)`, which calls it unbound — a prototype
    // method would lose its `this`. Matches the VideoPlayer._onPlayButton /
    // ScrollStrip.leadClicked precedent.
    private readonly handleInsertTable = (): void => {
        this._editor.insertTable(2, 3);
    };

    private readonly handleDirtyChange = (): void => {
        this._statusText.setText(
            `Dirty — editor: ${this._editor.isDirty() ? 'yes' : 'no'}`
            + `, panel (3 levels up): ${this.isDirty() ? 'yes' : 'no'}`);
    };
}

const MarkdownEditorPanelCallable = callable(MarkdownEditorPanel);
type MarkdownEditorPanelCallable = MarkdownEditorPanel;
export {
    MarkdownEditorPanel         as _MarkdownEditorPanel,
    MarkdownEditorPanelCallable as MarkdownEditorPanel
};
