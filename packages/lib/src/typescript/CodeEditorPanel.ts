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

function describePerson(person) {
  // A multi-line body, foldable from the gutter arrow or Ctrl-Shift-[.
  const parts = [];
  parts.push(person.name);
  parts.push('(' + person.age + ')');
  if (person.role) {
    parts.push('- ' + person.role);
  }
  return parts.join(' ');
}

console.log(greet("world"));
`;

// A single long line, and autoHeightMaxRows set, so toggling Wrap below is a
// manual-verify handle for line wrap driving auto-height growth/shrink — the
// main SAMPLE_JS editor above has no autoHeightMaxRows (it fills its Fit
// host instead), so it cannot demonstrate that interaction on its own.
const SAMPLE_LONG_LINE = `const longLine = "this line is deliberately long enough that, with Wrap turned on, it reflows across several rows and grows this editor's own auto-height box to fit them";
`;

/**
 * Demo panel showcasing the [`CodeEditor`](/api/component/editor/classes/CodeEditor)
 * component: syntax highlighting for a JavaScript sample, a Format button
 * (Prettier), and a read-only toggle. The editor sits in a `Fit` panel so it
 * fills the available space and scrolls internally. A status row reports the
 * editor's own dirty flag and the panel's own, the panel's arriving through
 * the framework's parent-to-child relay two containers up. Save clears the
 * flag, and so does undoing an edit back to the last-saved text.
 */
class CodeEditorPanel extends Panel {

    private readonly _editor: CodeEditor;
    private readonly _wrapHeightDemo: CodeEditor;
    private readonly _readOnlyBtn: Button;
    private readonly _wrapBtn: Button;
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

        this._wrapBtn = new Button({ text: 'Wrap: off' });
        this._wrapBtn.on('action', () => this.toggleLineWrap());

        // Writes nothing — only clears the dirty flag, standing in for a
        // host that has persisted the document.
        const saveBtn = new Button({ text: 'Save' });
        saveBtn.on('action', () => { this._editor.markClean(); });

        const toolbar = new Panel({ layoutManager: new HBox() });
        toolbar.addComponent(formatBtn);
        toolbar.addComponent(this._readOnlyBtn);
        toolbar.addComponent(this._wrapBtn);
        toolbar.addComponent(saveBtn);
        this.addComponent(toolbar);

        // Unweighted (not inside a Fit host): with autoHeightMaxRows set, the
        // editor reports its own auto-grown preferred size, and VBox sizes
        // this row to exactly that — the same "controlled via
        // setHeight/preferredSize" contract Markdown's fenced-code-block
        // upgrade relies on, and the shape Wrap needs to be able to grow it.
        // An explicit preferredSize.width caps it well below SAMPLE_LONG_LINE's
        // rendered width — without one, VBox's default (non-stretching)
        // cross-axis layout reads CodeEditor's own getPreferredSize() (null
        // until the first auto-height commit sets one), falls back to the
        // full container width, and the line never has anything to wrap
        // against.
        this.addComponent(new Text('Wrap + auto-height demo (autoHeightMaxRows: 6):'));
        this._wrapHeightDemo = new CodeEditor(SAMPLE_LONG_LINE,
            { language: 'javascript', autoHeightMaxRows: 6, preferredSize: { width: 400, height: 60 } });
        this.addComponent(this._wrapHeightDemo);

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

    private toggleLineWrap(): void {
        const wrap = !this._editor.getLineWrap();

        this._editor.setLineWrap(wrap);
        // Also drives the auto-height demo below, since the main editor
        // above has no autoHeightMaxRows and so cannot show wrap driving a
        // height change on its own.
        this._wrapHeightDemo.setLineWrap(wrap);
        this._wrapBtn.setText(wrap ? 'Wrap: on' : 'Wrap: off');
    }
}

const CodeEditorPanelCallable = callable(CodeEditorPanel);
type CodeEditorPanelCallable = CodeEditorPanel;
export {
    CodeEditorPanel         as _CodeEditorPanel,
    CodeEditorPanelCallable as CodeEditorPanel
};
