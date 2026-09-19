import { Panel } from '@jimka/typescript-ui/core';
import { Header, MarkdownViewer } from '@jimka/typescript-ui/component/display';
import { Split } from '@jimka/typescript-ui/layout';
import { markdownDocument } from '../builders/data.js';
import { childGutter, elementFor, requireElement } from '../builders/dom.js';
import { SIDE_WIDTH_PX } from '../builders/shared.js';
import type { HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'markdown-doc';

/** The side header's preferred height: a header bar's; the split stretches it to the viewport anyway. */
const SIDE_HEIGHT_PX = 40;

export const description = 'MarkdownViewer of an n-section document (default 60) with lists, TypeScript fences and tables, beside a side pane in a Split. Reproduces slice 25 F25.3 (MarkdownViewer.doLayout forces two document layouts per pass): 2 getElementRect per unchanged pass; and, under theme, slice 23 F23.1 for the fences\' editors (51 CSS rules per editor per theme switch).';

/** 60 sections: several screens of prose, fifteen fences. */
export const defaultScale = 60;

/** Dragging the split's gutter, which re-measures the viewer's width every frame. */
export const defaultDrive = 'drag';

/**
 * Builds a `MarkdownViewer` of `markdownDocument(n, 0)` beside a side header.
 *
 * @param n - Sections.
 * @returns The split as root, target of `resize`; the viewer, target of `passes`; `update`, which swaps the document's two variants; and `afterMount` giving `drag` the split's gutter and `wheel` the viewer's first paragraph.
 */
export function build(n: number): PanelBuild {
    const draft = markdownDocument(n, 0);
    const revised = markdownDocument(n, 1);
    const side = Header('Documents', { preferredSize: { width: SIDE_WIDTH_PX, height: SIDE_HEIGHT_PX } });
    const viewer = MarkdownViewer({ markdown: draft });

    const root = Panel({
        layoutManager: Split({ orientation: 'horizontal' }),
        components: [
            { component: side, constraints: { weight: 0 } },
            { component: viewer, constraints: { weight: 1 } },
        ],
    });

    return {
        root,
        targets: {
            passes: viewer,
            resize: root,
            update: function swapDocument(index: number): void {
                viewer.setMarkdown(index % 2 === 0 ? revised : draft);
            },
        },
        afterMount: (tools: HarnessTools): Record<string, unknown> => ({
            drag: { element: childGutter(tools, root, PANEL), axis: 'x' },
            wheel: requireElement(elementFor(tools, viewer, PANEL), 'p', PANEL),
        }),
        geometry: { side, viewer },
        describe: () => ({
            headings: n,
            fences: draft.split('\n').filter((line) => line.startsWith('```ts')).length,
            // Fences become editors lazily, near the viewport, so this depends on the screen.
            editorViews: document.getElementById(viewer.getId())?.querySelectorAll('.cm-editor').length ?? 0,
        }),
    };
}
