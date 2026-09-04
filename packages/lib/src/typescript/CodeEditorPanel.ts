// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { VBox, Fit } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
import { CodeEditor } from '@jimka/typescript-ui/component/editor';
import { Text } from '@jimka/typescript-ui/component/input';
import { ToolBar, ToolBarSeparator } from '@jimka/typescript-ui/component/menubar';

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

// A literal tab indents this line — Tab always inserts spaces
// (indentUnit), so a literal tab can only get into this sample by being
// seeded here directly. Cycling "Tab size" above changes how many
// columns it lines up under.
\tconsole.log("indented with a literal tab");

// This comment has a delibrately misspelled word, for the Spellcheck button.
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
 * component as two independent editors, each with its own toolbar and its
 * own dirty indicator, divided by a `ToolBarSeparator`.
 *
 * The upper editor's toolbar carries every action that concerns it: Format
 * re-runs the active language's formatter (or CodeMirror's own re-indent when
 * it has none), Read-only/Wrap/Lint toggle those three states, Save clears
 * the dirty flag (standing in for a host that has persisted the document),
 * and the Language row swaps the editor between JavaScript, CSS, Python, and
 * JSON samples. The editor sits in a `Fit` panel so it fills the available
 * space and scrolls internally — which also means it has no
 * `autoHeightMaxRows`, so it cannot demonstrate line wrap or folding driving
 * a height change on its own.
 *
 * The lower editor exists for exactly that: it carries `autoHeightMaxRows`,
 * and its own Wrap button — its only action, so it stands alone above the
 * editor rather than sitting inside a toolbar — toggles wrapping on this
 * editor alone. Folding its sample function via the gutter arrow is the
 * other manual-verify handle for auto-height growth/shrink.
 *
 * A status line below each editor reports that editor's own dirty flag,
 * wired directly to its `onDirtyChange`.
 */
class CodeEditorPanel extends Panel {

    private readonly _editor: CodeEditor;
    private readonly _wrapFoldDemo: CodeEditor;
    private readonly _readOnlyBtn: Button;
    private readonly _upperWrapBtn: Button;
    private readonly _lowerWrapBtn: Button;
    private readonly _lintBtn: Button;
    private readonly _tabSizeBtn: Button;
    private readonly _lineNumbersBtn: Button;
    private readonly _spellcheckBtn: Button;
    private readonly _upperStatusText: Text;
    private readonly _lowerStatusText: Text;

    private readonly handleUpperDirtyChange = (dirty: boolean): void => {
        this._upperStatusText.setText(`Dirty: ${dirty ? 'yes' : 'no'}`);
    };

    private readonly handleLowerDirtyChange = (dirty: boolean): void => {
        this._lowerStatusText.setText(`Dirty: ${dirty ? 'yes' : 'no'}`);
    };

    constructor() {
        super();

        this.setLayoutManager(new VBox());

        this._editor = new CodeEditor(SAMPLE_JS, { language: 'javascript' });

        const formatBtn = new Button({ text: 'Format' });
        formatBtn.on('action', () => { void this._editor.format(); });

        this._readOnlyBtn = new Button({ text: 'Read-only: off' });
        this._readOnlyBtn.on('action', () => this.toggleReadOnly());

        this._upperWrapBtn = new Button({ text: 'Wrap: off' });
        this._upperWrapBtn.on('action', () => this.toggleUpperWrap());

        this._lintBtn = new Button({ text: 'Lint: off' });
        this._lintBtn.on('action', () => this.toggleLint());

        this._tabSizeBtn = new Button({ text: 'Tab size: 4' });
        this._tabSizeBtn.on('action', () => this.toggleTabSize());

        this._lineNumbersBtn = new Button({ text: 'Line numbers: on' });
        this._lineNumbersBtn.on('action', () => this.toggleLineNumbers());

        this._spellcheckBtn = new Button({ text: 'Spellcheck: off' });
        this._spellcheckBtn.on('action', () => this.toggleSpellcheck());

        // Writes nothing — only clears the dirty flag, standing in for a
        // host that has persisted the document.
        const saveBtn = new Button({ text: 'Save' });
        saveBtn.on('action', () => { this._editor.markClean(); });

        const upperToolbar = new ToolBar();
        upperToolbar.addComponent(formatBtn);
        upperToolbar.addComponent(this._readOnlyBtn);
        upperToolbar.addComponent(this._upperWrapBtn);
        upperToolbar.addComponent(this._lintBtn);
        upperToolbar.addComponent(this._tabSizeBtn);
        upperToolbar.addComponent(this._lineNumbersBtn);
        upperToolbar.addComponent(this._spellcheckBtn);
        upperToolbar.addComponent(saveBtn);
        upperToolbar.addComponent(new Text('Language:'));
        upperToolbar.addComponent(this.makeLanguageButton('JS', 'javascript', SAMPLE_JS));
        upperToolbar.addComponent(this.makeLanguageButton('CSS', 'css', SAMPLE_CSS));
        upperToolbar.addComponent(this.makeLanguageButton('Python', 'python', SAMPLE_PYTHON));
        upperToolbar.addComponent(this.makeLanguageButton('JSON', 'json', SAMPLE_JSON));
        this.addComponent(upperToolbar);

        const editorHost = new Panel({ layoutManager: new Fit() });
        editorHost.addComponent(this._editor);
        this.addComponent(editorHost, { weight: 1 });

        this._upperStatusText = new Text('');
        this.addComponent(this._upperStatusText);
        this._editor.onDirtyChange(this.handleUpperDirtyChange);
        this.handleUpperDirtyChange(this._editor.isDirty());

        this.addComponent(new ToolBarSeparator({ orientation: 'horizontal' }));

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

        this._lowerWrapBtn = new Button({ text: 'Wrap: off' });
        this._lowerWrapBtn.on('action', () => this.toggleLowerWrap());
        this.addComponent(this._lowerWrapBtn);

        this._wrapFoldDemo = new CodeEditor(SAMPLE_WRAP_FOLD,
            { language: 'javascript', autoHeightMaxRows: 15, preferredSize: { width: 400, height: 60 } });
        this.addComponent(this._wrapFoldDemo);

        this._lowerStatusText = new Text('');
        this.addComponent(this._lowerStatusText);
        this._wrapFoldDemo.onDirtyChange(this.handleLowerDirtyChange);
        this.handleLowerDirtyChange(this._wrapFoldDemo.isDirty());
    }

    private toggleReadOnly(): void {
        const readOnly = !this._editor.getReadOnly();

        this._editor.setReadOnly(readOnly);
        this._readOnlyBtn.setText(readOnly ? 'Read-only: on' : 'Read-only: off');
    }

    private toggleUpperWrap(): void {
        const wrap = !this._editor.getLineWrap();

        this._editor.setLineWrap(wrap);
        this._upperWrapBtn.setText(wrap ? 'Wrap: on' : 'Wrap: off');
    }

    private toggleLowerWrap(): void {
        const wrap = !this._wrapFoldDemo.getLineWrap();

        this._wrapFoldDemo.setLineWrap(wrap);
        this._lowerWrapBtn.setText(wrap ? 'Wrap: on' : 'Wrap: off');
    }

    private toggleLint(): void {
        const lint = !this._editor.getLint();

        this._editor.setLint(lint);
        this._lintBtn.setText(lint ? 'Lint: on' : 'Lint: off');
    }

    private toggleTabSize(): void {
        // Cycles through three presets. Unset (CodeMirror's own default,
        // effectively 4) folds into the 4 slot, so the cycle always lands on
        // one of the three shown values instead of a fourth ambiguous
        // "unset" step.
        const TAB_SIZE_PRESETS = [2, 4, 8];
        const current = this._editor.getTabSize() ?? 4;
        const next = TAB_SIZE_PRESETS[(TAB_SIZE_PRESETS.indexOf(current) + 1) % TAB_SIZE_PRESETS.length];

        this._editor.setTabSize(next);
        this._tabSizeBtn.setText(`Tab size: ${next}`);
    }

    private toggleLineNumbers(): void {
        const show = !this._editor.getLineNumbers();

        this._editor.setLineNumbers(show);
        this._lineNumbersBtn.setText(show ? 'Line numbers: on' : 'Line numbers: off');
    }

    private toggleSpellcheck(): void {
        const spellcheck = !this._editor.getSpellcheck();

        this._editor.setSpellcheck(spellcheck);
        this._spellcheckBtn.setText(spellcheck ? 'Spellcheck: on' : 'Spellcheck: off');
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
