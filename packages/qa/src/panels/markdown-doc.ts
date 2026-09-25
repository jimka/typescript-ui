import { Panel } from '@jimka/typescript-ui/core';
import { extractMarkdownHeadings, Header, MarkdownViewer } from '@jimka/typescript-ui/component/display';
import { Split } from '@jimka/typescript-ui/layout';
import { markdownDocument } from '../builders/data.js';
import { childGutter, elementFor, requireElement } from '../builders/dom.js';
import { SIDE_WIDTH_PX } from '../builders/shared.js';
import type { CallTarget, HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'markdown-doc';

/** The side header's preferred height: a header bar's; the split stretches it to the viewport anyway. */
const SIDE_HEIGHT_PX = 40;

/** Past any document's end: written once to read the browser-clamped maximum back. */
const LADDER_PROBE_PX = 10_000_000;

/** Units per lap of the ladder: 24, so a lap is a whole second of units at 60 Hz and every arm of a phase covers whole laps at the drive lengths the cells use. */
const LADDER_PERIOD = 24;

/** The unit a lap peaks on: the top of the triangle, half a lap from either end. */
const LADDER_HALF = LADDER_PERIOD / 2;

/** Frames the probe's own two writes are given to settle before the first phase. */
const LADDER_SETTLE_FRAMES = 2;

/**
 * The library's `ACTIVE_HEADING_TOP_TOLERANCE_PX`: the sub-pixel slack
 * `findActiveHeading` allows over the pane's top. Re-stated rather than
 * imported, because the library does not export it. The duplication is not
 * unguarded: `P18` straddles this value with stubbed rectangles and requires
 * the oracle and the exported `findActiveHeading` to answer the same, so moving
 * the library's value breaks that test rather than silently turning the oracle
 * into a different rule.
 */
const TOP_TOLERANCE_PX = 1;

export const description = 'MarkdownViewer of an n-section document (default 60) with lists, TypeScript fences and tables, beside a side pane in a Split. Reproduces slice 25 F25.3 (MarkdownViewer.doLayout forces two document layouts per pass): 2 getElementRect per unchanged pass; and, under theme, slice 23 F23.1 for the fences\' editors (51 CSS rules per editor per theme switch). Its `call` driver steps the prose through a fixed ladder of absolute offsets, and its heading counter checks every resolved heading against the rule re-derived from live rectangles, which is G27\'s surface.';

/** 60 sections: several screens of prose, fifteen fences. */
export const defaultScale = 60;

/** Dragging the split's gutter, which re-measures the viewer's width every frame. */
export const defaultDrive = 'drag';

/** What the heading oracle reads: the element the viewer scrolls, and the headings it looks for inside it. */
interface Oracle {
    /** The pane, as the last scroll event from an element holding the prose named it; `null` until one has. */
    pane: HTMLElement | null;
    /** The document's heading ids, in document order. */
    ids: string[];
}

/**
 * The attribute selector for a heading id, as the library's own heading lookup
 * builds it. Read directly rather than through the DOM seam's `escapeSelector`,
 * so the oracle adds nothing to the seam counters the cell is scored on; the
 * two agree on the slugs `markdownDocument` produces, where only `\\` and `"`
 * would need escaping inside a quoted attribute value and neither occurs.
 *
 * @param id - The heading id.
 * @returns The selector.
 */
function headingSelector(id: string): string {
    return `[id="${id.replace(/["\\]/g, '\\$&')}"]`;
}

/**
 * The heading element for `id` inside `pane`, or `null` when the document
 * rendered none — `findActiveHeading` skips those, so the oracle must too.
 *
 * @param pane - The element the viewer scrolls.
 * @param id - The heading id.
 * @returns The element, or `null`.
 */
function headingElement(pane: HTMLElement, id: string): HTMLElement | null {
    return pane.querySelector<HTMLElement>(headingSelector(id));
}

/**
 * Whether `reported` is the heading the library's rule picks over the pane's
 * rectangles now — the same rule over the same rectangles, read in the same
 * task, so the plain arm agrees by construction and a disagreement is a
 * candidate that changed which heading is active.
 *
 * Tops increase down the document, so "at or above the pane's top" holds for a
 * prefix of the headings the pane rendered, and the reported heading plus one
 * neighbour decides the whole rule. Below the pane's top only the *first* such
 * heading can be active, and only once the pane has scrolled to its maximum,
 * where nothing can bring it to the top any more.
 *
 * @param pane - The element the viewer scrolls.
 * @param ids - The document's heading ids, in document order.
 * @param reported - The heading the tracker resolved, or `null` for none.
 * @returns `true` when the rule picks `reported` too.
 */
function agreesWithRule(pane: HTMLElement, ids: readonly string[], reported: string | null): boolean {
    const paneTop = pane.getBoundingClientRect().top;

    const atMax = pane.scrollHeight > pane.clientHeight
        && pane.scrollTop >= pane.scrollHeight - pane.clientHeight - TOP_TOLERANCE_PX;

    const isAbove = (element: HTMLElement): boolean => element.getBoundingClientRect().top <= paneTop + TOP_TOLERANCE_PX;

    const present = (from: number, step: number): HTMLElement | null => {
        for (let i = from; i >= 0 && i < ids.length; i += step) {
            const element = headingElement(pane, ids[i]);

            if (element) {
                return element;
            }
        }

        return null;
    };

    if (reported === null) {
        const first = present(0, 1);

        return first === null || (!isAbove(first) && !atMax);
    }

    const index = ids.indexOf(reported);
    const element = index < 0 ? null : headingElement(pane, ids[index]);

    if (!element) {
        return false;
    }

    if (isAbove(element)) {
        const next = present(index + 1, 1);

        return atMax ? next === null : next === null || !isAbove(next);
    }

    const previous = present(index - 1, -1);

    return atMax && (previous === null || isAbove(previous));
}

/**
 * Tallies every heading the viewer resolves as `heading@<id>`
 * (`heading@none` above the first), one per scroll tick: the viewer's
 * heading tracker is given an own `setActiveHeading` that counts, then
 * delegates. A wrong choice of heading moves no box, so these counts are what
 * a change to the tracking can be checked against.
 *
 * Each resolution is also checked against the rule re-derived from live
 * rectangles, as `heading.agree` or `heading.disagree`. That is an in-run
 * oracle rather than a tally compared between runs: a wheel's landing offsets
 * are a function of elapsed time, so comparing two runs' tallies cannot tell a
 * changed answer from a differently-paced scroll, while `heading.disagree` is
 * raised by the run that made the wrong choice whatever its offsets were.
 * Nothing is checked or counted while the pane is still unknown.
 *
 * @param tools - The harness tools.
 * @param viewer - The viewer.
 * @param oracle - The pane and the heading ids the check reads.
 * @returns `counting heading@<id>`, or `NOT FOUND …` when the viewer has no tracker.
 */
function countActiveHeadings(tools: HarnessTools, viewer: MarkdownViewer, oracle: Oracle): string {
    const tracker = (viewer as unknown as { _tracker?: Record<string, unknown> })._tracker;
    const original = tracker?.setActiveHeading;

    if (!tracker || typeof original !== 'function') {
        return 'NOT FOUND setActiveHeading on MarkdownViewer._tracker';
    }

    tracker.setActiveHeading = function countedActiveHeading(this: unknown, id: string | null): void {
        if (oracle.pane) {
            tools.bumpWork(agreesWithRule(oracle.pane, oracle.ids, id) ? 'heading.agree' : 'heading.disagree');
        }

        tools.bumpWork(`heading@${id ?? 'none'}`);
        original.call(this, id);
    };

    return 'counting heading@<id>';
}

/**
 * The `call` target: a triangle of absolute offsets over `span`, so unit `k`
 * is at the same pixel in every run of every arm and a lap ends where it
 * started. A wheel's offsets depend on the gap between frames, which is fine
 * for timing and useless for a question asked per position.
 *
 * @param viewer - The viewer whose prose scrolls.
 * @param span - The scrollable span; 0 for a page that cannot scroll, which writes nothing.
 * @returns The target.
 */
function scrollLadder(viewer: MarkdownViewer, span: number): CallTarget {
    return function ladderStep(index: number): void {
        if (span === 0) {
            return;
        }

        const step = index % LADDER_PERIOD;
        const fraction = step <= LADDER_HALF ? step / LADDER_HALF : (LADDER_PERIOD - step) / LADDER_HALF;

        viewer.setScrollTop(Math.round(fraction * span));
    };
}

/**
 * Builds a `MarkdownViewer` of `markdownDocument(n, 0)` beside a side header.
 *
 * @param n - Sections.
 * @returns The split as root, target of `resize`; the viewer, target of `passes`; `update`, which swaps the document's two variants; and `afterMount` giving `drag` the split's gutter, `wheel` the viewer's first paragraph and `call` the scroll ladder.
 */
export function build(n: number): PanelBuild {
    const draft = markdownDocument(n, 0);
    const revised = markdownDocument(n, 1);
    const side = Header('Documents', { preferredSize: { width: SIDE_WIDTH_PX, height: SIDE_HEIGHT_PX } });
    const viewer = MarkdownViewer({ markdown: draft });

    // Both variants of the document carry the same headings — they differ only
    // in the paragraphs' second word — so `update` leaves these ids standing.
    const oracle: Oracle = { pane: null, ids: extractMarkdownHeadings(draft).map((heading) => heading.id) };
    let maxScrollTop = 0;

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
        afterMount: async (tools: HarnessTools): Promise<Record<string, unknown>> => {
            const viewerElement = elementFor(tools, viewer, PANEL);

            // Captured, because a `scroll` event does not bubble and, under
            // overlay scrollbars, fires on an inner element. The prose test is
            // what tells the pane from another scroller inside the viewer — a
            // code fence's editor delivers scroll events here too, and holds
            // no heading.
            //
            // This listener sits on the viewer's element while the library
            // routes its own scroll handling through a base listener installed
            // at the window, which the capture phase reaches first: within one
            // event, `setActiveHeading` therefore sees the pane the *previous*
            // event named. The probe's two writes below name it before any
            // phase runs, so the lag costs nothing in these cells — but a
            // rebuilt overlay scroll element would cost one spurious
            // `heading.disagree`, and cell `m60l` is gated on that counter.
            viewerElement.addEventListener('scroll', (event: Event): void => {
                const target = event.target;

                if (target instanceof HTMLElement && headingElement(target, oracle.ids[0])) {
                    oracle.pane = target;
                }
            }, { capture: true });

            // The scrollable span, measured with no DOM lookup: the write goes
            // to the native offset and the read-back is the browser's clamped
            // result. Both writes also deliver a scroll event, which names the
            // pane before the first phase asks a heading question.
            viewer.setScrollTop(LADDER_PROBE_PX);
            maxScrollTop = viewer.getScrollTop();
            viewer.setScrollTop(0);
            await tools.waitFrames(LADDER_SETTLE_FRAMES);

            return {
                drag: { element: childGutter(tools, root, PANEL), axis: 'x' },
                wheel: requireElement(viewerElement, 'p', PANEL),
                call: scrollLadder(viewer, maxScrollTop),
            };
        },
        geometry: { side, viewer, minimap: '.MarkdownMinimap' },
        describe: () => ({
            headings: n,
            fences: draft.split('\n').filter((line) => line.startsWith('```ts')).length,
            // Fences become editors lazily, near the viewport, so this depends on the screen.
            editorViews: document.getElementById(viewer.getId())?.querySelectorAll('.cm-editor').length ?? 0,
            // The premise of the ladder: a viewer that cannot scroll walks nowhere.
            maxScrollTop,
        }),
        installWork: (tools: HarnessTools): string[] => [countActiveHeadings(tools, viewer, oracle)],
    };
}
