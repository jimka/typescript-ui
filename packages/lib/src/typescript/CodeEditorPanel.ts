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

// One sample per newly-registered or newly-completion/lint-relevant
// language, so the Language row below is a manual-verify handle for
// "selecting css and python highlights correctly; format() reformats CSS
// and re-indents Python" and "in a JSON document, typing t at a value
// position offers true" — none of which the JS-only editor above can show.
const SAMPLE_CSS = `.button {
    color:blue;
  padding:  4px   8px;
}
`;

const SAMPLE_PYTHON = `def greet(name):
    return "Hello, " + name

print(greet("world"))
`;

const SAMPLE_JSON = `{
  "name": "test",
  "active": true
}
`;

// A foldable block plus a single long line, with autoHeightMaxRows set, so
// toggling Wrap and folding/unfolding the block below are both manual-verify
// handles for line wrap and folding driving auto-height growth/shrink — the
// main SAMPLE_JS editor above has no autoHeightMaxRows (it fills its Fit
// host instead), so it cannot demonstrate either interaction on its own.
const SAMPLE_WRAP_FOLD = `function example(x) {
  return x * 2;
}

const longLine = "this line is deliberately long enough that, with Wrap turned on, it reflows across several rows and grows this editor's own auto-height box to fit them";
`;

/**
 * Demo panel showcasing the [`CodeEditor`](/api/component/editor/classes/CodeEditor)
 * component: the main editor toggles read-only, line wrap, and lint, and
 * the Language row swaps it between JavaScript, CSS, Python, and JSON
 * samples (Format re-runs that language's formatter, or CodeMirror's own
 * re-indent when it has none). The editor sits in a `Fit` panel so it fills
 * the available space and scrolls internally. A second, smaller editor below
 * the toolbar carries `autoHeightMaxRows`, so folding its sample function and
 * toggling Wrap (driven by the same button as the main editor) are both
 * manual-verify handles for those two interactions growing/shrinking an
 * auto-height box — the main editor's `Fit` host defeats auto-height, so it
 * cannot show either on its own. A status row reports the main editor's own
 * dirty flag and the panel's own, the panel's arriving through the
 * framework's parent-to-child relay two containers up. Save clears the flag,
 * and so does undoing an edit back to the last-saved text.
 */
class CodeEditorPanel extends Panel {

    private readonly _editor: CodeEditor;
    private readonly _wrapFoldDemo: CodeEditor;
    private readonly _readOnlyBtn: Button;
    private readonly _wrapBtn: Button;
    private readonly _lintBtn: Button;
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

        this._lintBtn = new Button({ text: 'Lint: off' });
        this._lintBtn.on('action', () => this.toggleLint());

        // Writes nothing — only clears the dirty flag, standing in for a
        // host that has persisted the document.
        const saveBtn = new Button({ text: 'Save' });
        saveBtn.on('action', () => { this._editor.markClean(); });

        const toolbar = new Panel({ layoutManager: new HBox() });
        toolbar.addComponent(formatBtn);
        toolbar.addComponent(this._readOnlyBtn);
        toolbar.addComponent(this._wrapBtn);
        toolbar.addComponent(this._lintBtn);
        toolbar.addComponent(saveBtn);
        this.addComponent(toolbar);

        const languageRow = new Panel({ layoutManager: new HBox() });
        languageRow.addComponent(new Text('Language:'));
        languageRow.addComponent(this.makeLanguageButton('JS', 'javascript', SAMPLE_JS));
        languageRow.addComponent(this.makeLanguageButton('CSS', 'css', SAMPLE_CSS));
        languageRow.addComponent(this.makeLanguageButton('Python', 'python', SAMPLE_PYTHON));
        languageRow.addComponent(this.makeLanguageButton('JSON', 'json', SAMPLE_JSON));
        this.addComponent(languageRow);

        // Unweighted (not inside a Fit host): with autoHeightMaxRows set, the
        // editor reports its own auto-grown preferred size, and VBox sizes
        // this row to exactly that — the same "controlled via
        // setHeight/preferredSize" contract Markdown's fenced-code-block
        // upgrade relies on, and the shape Wrap and folding both need to be
        // able to grow/shrink it. An explicit preferredSize.width caps it
        // well below SAMPLE_WRAP_FOLD's rendered width — without one, VBox's
        // default (non-stretching) cross-axis layout reads CodeEditor's own
        // getPreferredSize() (null until the first auto-height commit sets
        // one), falls back to the full container width, and the line never
        // has anything to wrap against. autoHeightMaxRows is 15, not 6:
        // SAMPLE_WRAP_FOLD's unwrapped content is already 6 rows, so a cap of
        // 6 saturates before Wrap is even toggled and leaves no headroom for
        // the ~9 rows the long line wraps to at this width — the box would
        // stay pinned to the same capped height in both states instead of
        // growing. 15 comfortably covers both.
        this.addComponent(new Text(
            'Wrap + fold + auto-height demo (autoHeightMaxRows: 15) — fold the function via its gutter arrow:'));
        this._wrapFoldDemo = new CodeEditor(SAMPLE_WRAP_FOLD,
            { language: 'javascript', autoHeightMaxRows: 15, preferredSize: { width: 400, height: 60 } });
        this.addComponent(this._wrapFoldDemo);

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
        this._wrapFoldDemo.setLineWrap(wrap);
        this._wrapBtn.setText(wrap ? 'Wrap: on' : 'Wrap: off');
    }

    private toggleLint(): void {
        const lint = !this._editor.getLint();

        this._editor.setLint(lint);
        this._lintBtn.setText(lint ? 'Lint: on' : 'Lint: off');
    }

    /**
     * Builds one Language-row button that swaps the main editor's language
     * and content to `sample`.
     *
     * @param label - The button's own text.
     * @param language - The registered language id to switch to.
     * @param sample - The document text to load for that language.
     * @returns The constructed button.
     */
    private makeLanguageButton(label: string, language: string, sample: string): Button {
        const button = new Button({ text: label });

        button.on('action', () => {
            this._editor.setLanguage(language);
            this._editor.setValue(sample);
        });

        return button;
    }
}

const CodeEditorPanelCallable = callable(CodeEditorPanel);
type CodeEditorPanelCallable = CodeEditorPanel;
export {
    CodeEditorPanel         as _CodeEditorPanel,
    CodeEditorPanelCallable as CodeEditorPanel
};
