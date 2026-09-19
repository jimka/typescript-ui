import { Panel } from '@jimka/typescript-ui/core';
import { Markdown } from '@jimka/typescript-ui/component/display';
import { MarkdownDocumentPanel } from '@jimka/typescript-ui/component/editor';
import { Text } from '@jimka/typescript-ui/component/input';
import { Border, Fit, Split } from '@jimka/typescript-ui/layout';
import { Placement } from '@jimka/typescript-ui/primitive';
import { editorDocument } from '../builders/data.js';
import { childGutter, elementFor, requireElement } from '../builders/dom.js';
import { TYPE_TEXT } from '../builders/shared.js';
import { parkOffset } from '../harness/drivers.js';
import type { HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'markdown-editor';

/** Where `call` starts the caret in the first paragraph: a few characters in, inside `Part 1`'s text. */
const CARET_START = 5;

/** How many units one caret sweep takes: out 20 characters and back, well inside the 120-character paragraph. */
const CARET_SPAN = 40;

export const description = 'MarkdownDocumentPanel of an n-section document (default 60, about 9 KB) beside a live Markdown preview in a Split, the preview re-rendered from the editor\'s change event, as MarkdownEditorPanel is. Reproduces slice 24 F24.1 (MarkdownEditor re-serialises the whole document on every commit, a caret move included): 1 handleChange@MarkdownEditor per call unit (a caret move) and per type unit.';

/** 60 sections: about 9 KB, the size of F24.1's largest document. */
export const defaultScale = 60;

/** Moving the caret, a commit that changes only the selection. */
export const defaultDrive = 'call';

/** The preview `syncViewer` re-renders: the mounted panel's. A page mounts one panel. */
let previewViewer: Markdown | null = null;

/** The editor `syncViewer` reads: the mounted panel's. */
let previewSource: MarkdownDocumentPanel | null = null;

/** Re-renders the preview from the editor's value, as `MarkdownEditorPanel` does on every change. */
function syncViewer(): void {
    if (previewViewer && previewSource) {
        previewViewer.setMarkdown(previewSource.getValue());
    }
}

/**
 * The `call` target: collapses the document selection inside the first text
 * node of the editor's first paragraph, `CARET_START` characters in plus a
 * walk out and back — a commit that changes only the selection.
 *
 * @param editable - The editor's editable element.
 * @returns The target.
 */
function caretMover(editable: HTMLElement): (index: number) => void {
    return function moveCaret(index: number): void {
        const paragraph = requireElement(editable, 'p', PANEL);
        const text = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode() as globalThis.Text | null;

        if (!text) {
            throw new Error(`${PANEL}: the first paragraph has no text`);
        }

        const offset = CARET_START + parkOffset(index % CARET_SPAN, CARET_SPAN, 1, 0);

        getSelection()!.collapse(text, Math.min(offset, text.length));
    };
}

/**
 * Builds a `MarkdownDocumentPanel` of `editorDocument(n)`, over a status
 * line, beside a `Markdown` preview that follows it.
 *
 * @param n - Sections.
 * @returns The split as root, target of `resize` and `passes`; `update`, which swaps the document's two versions; and `afterMount` giving `type` and `wheel` the editable element, `call` a caret move in it, and `drag` the split's gutter.
 */
export function build(n: number): PanelBuild {
    const docA = editorDocument(n);
    // The same document with ` (revised)` after its title, the first heading.
    const docB = docA.replace(/^(# .*)$/m, '$1 (revised)');
    const panel = MarkdownDocumentPanel({ value: docA });
    const viewer = Markdown(docA);

    const editorHost = Panel({
        layoutManager: Border(),
        components: [
            { component: panel, constraints: { placement: Placement.CENTER } },
            { component: Text('Ready'), constraints: { placement: Placement.SOUTH } },
        ],
    });

    const viewerHost = Panel({ layoutManager: Fit(), autoScroll: 'y', components: [viewer] });
    const root = Panel({ layoutManager: Split({ orientation: 'horizontal' }), components: [editorHost, viewerHost] });

    previewViewer = viewer;
    previewSource = panel;
    panel.on('change', syncViewer);

    return {
        root,
        targets: {
            resize: root,
            passes: root,
            update: function swapDocument(index: number): void {
                panel.setValue(index % 2 === 0 ? docB : docA);
            },
        },
        afterMount: (tools: HarnessTools): Record<string, unknown> => {
            const editable = requireElement(elementFor(tools, panel, PANEL), '[contenteditable="true"]', PANEL);

            return {
                type: { element: editable, text: TYPE_TEXT },
                call: caretMover(editable),
                drag: { element: childGutter(tools, root, PANEL), axis: 'x' },
                wheel: editable,
            };
        },
        geometry: { editor: panel, viewer },
        describe: () => ({ sections: n, chars: docA.length }),
        installWork: (tools: HarnessTools): string[] => [tools.countMethod(panel.getEditor(), 'handleChange')],
    };
}
