// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox, Fit } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
import { CodeEditor } from '@jimka/typescript-ui/component/editor';
import { Text } from '@jimka/typescript-ui/component/input';

const SAMPLE_JS = `function greet(name) {
  const message = "Hello, " + name + "!"
  return message
}

console.log(greet("world"));
`;

/**
 * Demo panel showcasing the [`CodeEditor`](/api/component/editor/classes/CodeEditor)
 * component: syntax highlighting for a JavaScript sample, a Format button
 * (Prettier), and a read-only toggle. The editor sits in a `Fit` panel so it
 * fills the available space and scrolls internally. A status row reports the
 * editor's own dirty flag and the panel's own, the panel's arriving through
 * the framework's parent-to-child relay two containers up, and Save clears
 * it.
 */
class CodeEditorPanel extends Panel {

    private readonly _editor: CodeEditor;
    private readonly _readOnlyBtn: Button;
    private readonly _statusText: Text;

    private readonly handleDirtyChange = (): void => {
        this._statusText.setText(
            `Dirty — editor: ${this._editor.isDirty() ? 'yes' : 'no'}`
            + `, panel (2 levels up): ${this.isDirty() ? 'yes' : 'no'}`);
    };

    constructor() {
        super();

        this.setLayoutManager(new VBox());

        this._editor = new CodeEditor(SAMPLE_JS, { language: 'javascript' });

        const editorHost = new Panel({ layoutManager: new Fit() });
        editorHost.addComponent(this._editor);
        this.addComponent(editorHost, { weight: 1 });

        const formatBtn = new Button({ text: 'Format' });
        formatBtn.on('action', () => { void this._editor.format(); });

        this._readOnlyBtn = new Button({ text: 'Read-only: off' });
        this._readOnlyBtn.on('action', () => this.toggleReadOnly());

        // Writes nothing — only clears the dirty flag, standing in for a
        // host that has persisted the document.
        const saveBtn = new Button({ text: 'Save' });
        saveBtn.on('action', () => { this._editor.markClean(); });

        const toolbar = new Panel({ layoutManager: new HBox() });
        toolbar.addComponent(formatBtn);
        toolbar.addComponent(this._readOnlyBtn);
        toolbar.addComponent(saveBtn);
        this.addComponent(toolbar);

        this._statusText = new Text('');
        this.addComponent(this._statusText);
        this.onDirtyChange(this.handleDirtyChange);
        this.handleDirtyChange();
    }

    private toggleReadOnly(): void {
        const readOnly = !this._editor.getReadOnly();

        this._editor.setReadOnly(readOnly);
        this._readOnlyBtn.setText(readOnly ? 'Read-only: on' : 'Read-only: off');
    }
}

const CodeEditorPanelCallable = callable(CodeEditorPanel);
type CodeEditorPanelCallable = CodeEditorPanel;
export {
    CodeEditorPanel         as _CodeEditorPanel,
    CodeEditorPanelCallable as CodeEditorPanel
};
