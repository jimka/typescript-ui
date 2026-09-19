import { Panel } from '@jimka/typescript-ui/core';
import { Button } from '@jimka/typescript-ui/component/button';
import { Header } from '@jimka/typescript-ui/component/display';
import { CodeEditor } from '@jimka/typescript-ui/component/editor';
import type { CodeEditorCursorPosition } from '@jimka/typescript-ui/component/editor';
import { Text } from '@jimka/typescript-ui/component/input';
import { ToolBar } from '@jimka/typescript-ui/component/menubar';
import { Border, Split } from '@jimka/typescript-ui/layout';
import { Placement } from '@jimka/typescript-ui/primitive';
import { noCommand } from '../builders/chrome.js';
import { codeDocument } from '../builders/data.js';
import { childGutter, elementFor, requireElement } from '../builders/dom.js';
import { SIDE_WIDTH_PX, TYPE_TEXT } from '../builders/shared.js';
import type { HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'code-document';

/** The side header's preferred height: a header bar's; the split stretches it to the viewport anyway. */
const SIDE_HEIGHT_PX = 40;

/** The editor toolbar's buttons: `CodeEditorPanel`'s upper toolbar, each wired to a no-op. */
const TOOLBAR_LABELS: readonly string[] = ['Format', 'Read-only', 'Wrap', 'Lint', 'Tab size', 'Line numbers', 'Spellcheck', 'Save', 'Reveal', 'Preview'];

export const description = 'One CodeEditor of n lines of JavaScript (default 2,000) under a toolbar of ten buttons, over a status Text updated on every cursor change, as CodeEditorPanel lays out its upper editor; beside an outline header in a Split. The single-editor partner of shell-deep and shell-shallow, for the editor\'s per-wheel scroll-metric reads (G16) and the status text measured per keystroke (G18). No figure is recorded for it yet.';

/** 2,000 lines: a large source file, many screens long. */
export const defaultScale = 2000;

/** Wheel-scrolling the editor: its everyday hot path. */
export const defaultDrive = 'wheel';

/** The status line `showCursorPosition` writes to: the mounted panel's. A page mounts one panel. */
let statusText: Text | null = null;

/**
 * Shows the caret's position in the status line, as `CodeEditorPanel`'s
 * status line does on every cursor change.
 *
 * @param position - The caret's position.
 */
function showCursorPosition(position: CodeEditorCursorPosition): void {
    statusText?.setText(`Ln ${position.line}, Col ${position.column}`);
}

/**
 * Builds a `CodeEditor` of `codeDocument(n)` under a toolbar, over a status
 * line, beside an outline header.
 *
 * @param n - Lines.
 * @returns The split as root, target of `resize`; the editor, target of `passes`; and `afterMount` giving `drag` the split's gutter, `wheel` the editor's scroller, and `type` and `key` its content.
 */
export function build(n: number): PanelBuild {
    const editor = CodeEditor(codeDocument(n), { language: 'javascript', listeners: { cursorchange: showCursorPosition } });
    const status = Text('Ln 1, Col 1');
    const toolBar = ToolBar({ components: TOOLBAR_LABELS.map((text) => Button({ text, listeners: { action: noCommand } })) });

    const main = Panel({
        layoutManager: Border(),
        components: [
            { component: toolBar, constraints: { placement: Placement.NORTH } },
            { component: editor, constraints: { placement: Placement.CENTER } },
            { component: status, constraints: { placement: Placement.SOUTH } },
        ],
    });

    const root = Panel({
        layoutManager: Split({ orientation: 'horizontal' }),
        components: [
            { component: Header('Outline', { preferredSize: { width: SIDE_WIDTH_PX, height: SIDE_HEIGHT_PX } }), constraints: { weight: 0 } },
            { component: main, constraints: { weight: 1 } },
        ],
    });

    statusText = status;

    return {
        root,
        targets: { passes: editor, resize: root },
        afterMount: (tools: HarnessTools): Record<string, unknown> => {
            const editorElement = elementFor(tools, editor, PANEL);
            const content = requireElement(editorElement, '.cm-content', PANEL);

            return {
                drag: { element: childGutter(tools, root, PANEL), axis: 'x' },
                wheel: requireElement(editorElement, '.cm-scroller', PANEL),
                type: { element: content, text: TYPE_TEXT },
                key: { element: content, keys: ['ArrowDown', 'ArrowUp'] },
            };
        },
        geometry: { editor, status },
        describe: () => ({ lines: n }),
    };
}
