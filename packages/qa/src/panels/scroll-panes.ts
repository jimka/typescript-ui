import { Panel } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import { Text } from '@jimka/typescript-ui/component/input';
import { Grid, VBox } from '@jimka/typescript-ui/layout';
import { outlineLabels } from '../builders/data.js';
import { elementFor } from '../builders/dom.js';
import type { CallTarget, GeometryTarget, HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'scroll-panes';

/** Panes per grid row: a board six across, so the default twenty-four panes are four rows deep. */
const GRID_COLUMNS = 6;

/**
 * Rows per pane: more text than a cell of the board can show, so every pane
 * overflows and scrolls. Forty is a judgement about the host's viewport rather
 * than a derivable number — nothing offline observes overflow — so the value is
 * checked by the run itself: `describe().scrollablePanes` must equal `n` before
 * either arm is read, and the remedy for a board that does not overflow is to
 * raise this and re-run (`## Potential Challenges`).
 */
const ROWS_PER_PANE = 40;

/** Past any pane's end: written once per pane to read the browser-clamped maximum back. */
const LADDER_PROBE_PX = 10_000_000;

/** Units per lap: one second of units at 60 Hz, and a divisor of the cell's 144. */
const LADDER_PERIOD = 24;

/** The unit a lap peaks on: the top of the triangle, half a lap from either end. */
const LADDER_HALF = LADDER_PERIOD / 2;

/** Frames the span probe's writes are given to settle before the first phase. */
const LADDER_SETTLE_FRAMES = 2;

/** The pane the ladder leaves at rest, so the `pane1` and `row1` labels do not move. */
const UNSCROLLED_PANE = 1;

/**
 * A scrolling pane that pays its layout pass on every commit, including one
 * that moves nothing.
 *
 * This class exists for one reason: `Panel.canSkipUnchangedLayout` opts a
 * *plain* `Panel` into the unchanged-commit skip by prototype identity, so a
 * plain pane whose rectangle the board re-commits unchanged never runs
 * `doLayout`, and therefore never reaches `remeasureScrollMetrics` — the one
 * call this cell measures. A subclass opts out by construction. Do not collapse
 * it back into `Panel()`: every `passes` unit would measure an empty pass, both
 * G16 arms would read `unreached`, and nothing in the report would say why.
 *
 * It is also the realistic shape, which is the more interesting half. A real
 * application's scrolling pane is almost always a `Panel` subclass, so it
 * genuinely pays the re-measure on every settled pass; the plain `Panel` is the
 * case the shipped opt-in already covers. What G16 has left to win therefore
 * exists only for panels that are *not* opted in — which is what this board
 * measures, and how its number has to be read.
 */
class ScrollPane extends Panel {}

export const description = 'A Grid of n scrolling Panel subclasses (default 24), each holding 40 Text rows — more than a cell of the board can show. The panes are a subclass because a plain Panel opts into the unchanged-commit layout skip, and a pane that skips its pass never reaches remeasureScrollMetrics, which is the call this cell measures; a real application\'s scrolling pane is almost always a subclass too, so what G16 has left to win exists only for panels that are not opted in. Built for G16: one `passes` unit re-measures every pane\'s scroll metrics, and one `wheel` unit really scrolls pane 0, so the settled-pass gate and the scroll-read path are exercised on the same scrollable Panels in one cell. It reproduces no outside behaviour and has no recorded figure: it exists so the two G16 arms have a population large enough to read against a phase\'s bracket. Its `call` driver steps every pane but pane 1 through a fixed ladder of absolute offsets, which is the phase built to reach the framework\'s scroll-shadow path deterministically: `resizeScrollShadowOverlay` and `updateScrollShadows` are reachable from a scroll event alone, so no layout pass can engage the scroll half of G16, and whether a synthetic wheel\'s eased controller lands a scroll of its own is what `pane.shadowUpdate` is there to say rather than to assume. Because the ladder moves pane 0\'s content, `row0` is a geometry gate on a `call` cell only.';

/** 24 panes: four rows of six, enough avoided re-measures per pass to clear a phase's timing bracket. */
export const defaultScale = 24;

/** Both halves of G16 in one cell, over a settled trailing phase: the board's passes, a wheel on pane 0, then idle. */
export const defaultDrive = 'passes,wheel,idle:4';

/**
 * Counts every scroll tick pane 0 delivers as `pane.scrollTick`, so the report
 * says whether a `wheel` unit scrolled anything at all — an arm that changes
 * the scroll path says nothing on a pane that never moved.
 *
 * The listener captures: a `scroll` event does not bubble, and under overlay
 * scrollbars it fires on the inner scroll element rather than on the pane's
 * own, so a listener on the pane element only sees it on the way down.
 *
 * @param tools - The harness tools.
 * @param pane - The pane `wheel` scrolls.
 * @returns `counting pane.scrollTick`.
 */
function countScrollTicks(tools: HarnessTools, pane: Component): string {
    elementFor(tools, pane, PANEL).addEventListener('scroll', () => tools.bumpWork('pane.scrollTick'), { capture: true });

    return 'counting pane.scrollTick';
}

/**
 * The `call` target: a triangle of absolute offsets over each pane's own span,
 * so unit `k` is at the same pixel in every run of every arm and a lap ends
 * where it started. It is the panel's only phase that makes the framework
 * scroll, and therefore the only one that reaches the scroll-shadow path: a
 * wheel performs no default action and reaches a scroll only if the eased wheel
 * controller claims the gesture and lands a write, at offsets that are a
 * function of elapsed time.
 *
 * `UNSCROLLED_PANE` is skipped, so the `pane1` and `row1` labels hold still.
 *
 * @param panes - The board's panes, in the order the geometry labels them.
 * @param spans - Each pane's scrollable span; 0 for a pane that cannot scroll, which is left alone.
 * @returns The target.
 */
function scrollLadder(panes: readonly Component[], spans: readonly number[]): CallTarget {
    return function ladderStep(index: number): void {
        const step = index % LADDER_PERIOD;
        const fraction = step <= LADDER_HALF ? step / LADDER_HALF : (LADDER_PERIOD - step) / LADDER_HALF;

        for (let k = 0; k < panes.length; k++) {
            if (k !== UNSCROLLED_PANE && spans[k] > 0) {
                panes[k].setScrollTop(Math.round(fraction * spans[k]));
            }
        }
    };
}

/**
 * Builds a board of `n` scrolling panes of `ROWS_PER_PANE` text rows each.
 *
 * @param n - Scrolling panes.
 * @returns The board as root, target of `passes` and `resize`; and `afterMount` giving `wheel` pane 0's element and `call` the scroll ladder.
 */
export function build(n: number): PanelBuild {
    const labels = outlineLabels(ROWS_PER_PANE);

    const panes = Array.from({ length: n }, () => new ScrollPane({
        autoScroll: 'y',
        layoutManager: VBox({ stretching: true }),
        components: labels.map((text) => Text(text)),
    }));

    const root = Panel({
        layoutManager: Grid({ rows: Math.ceil(n / GRID_COLUMNS), columns: GRID_COLUMNS }),
        components: panes,
    });

    // The ladder leaves pane `UNSCROLLED_PANE` alone, so `pane1` and `row1`
    // hold still and keep catching a wrongly reserved gutter or a wrongly
    // sized shadow overlay, both of which move content. `row0` does move —
    // with the ladder, by an absolute integer offset every run repeats, which
    // is exactly what a wheel could not promise, since its landing positions
    // follow elapsed time.
    //
    // So `row0` is a gate on a `call` cell only. Geometry labels are the
    // panel's, not a phase's, and `defaultDrive` still drives a `wheel` on
    // pane 0, so any cell that drives one has to take the label out with
    // `--allow-diff row0@<phase>` — the standing remedy for a burst phase's
    // moving labels — and a `DIFF` on `row0` there says nothing about
    // soundness. `pane1` and `row1` are the stationary probes for exactly
    // that reason, and stay the ones such a cell reads.
    const geometry: Record<string, GeometryTarget> = {
        board: root,
        pane0: panes[0],
        row0: panes[0].getComponents()[0],
        paneLast: panes[n - 1],
    };

    if (n > 1) {
        geometry.pane1 = panes[1];
        geometry.row1 = panes[1].getComponents()[0];
    }

    // Measured once in `afterMount` and held for the run: the `passes` phase
    // re-commits every pane at the rectangle it holds, so no span moves.
    let ladderSpans: number[] = [];

    return {
        root,
        targets: { passes: root, resize: root },
        afterMount: async (tools: HarnessTools): Promise<Record<string, unknown>> => {
            // Each pane's scrollable span, measured with no DOM lookup: the
            // write goes to the native offset and the read-back is the
            // browser's clamped result.
            ladderSpans = panes.map((pane) => {
                pane.setScrollTop(LADDER_PROBE_PX);

                const span = pane.getScrollTop();

                pane.setScrollTop(0);

                return span;
            });

            await tools.waitFrames(LADDER_SETTLE_FRAMES);

            return {
                wheel: elementFor(tools, panes[0], PANEL),
                call: scrollLadder(panes, ladderSpans),
            };
        },
        geometry,
        describe: () => ({
            panes: n,
            rowsPerPane: ROWS_PER_PANE,
            // The premise of the cell: a pane that does not overflow at the
            // host's viewport re-measures nothing worth skipping and scrolls
            // nowhere, so an `unreached` verdict would be about the board.
            scrollablePanes: panes.filter((pane) => pane.getMaxScrollTop() > 0).length,
            maxScrollTop0: panes[0].getMaxScrollTop(),
            // The premise of the ladder, and the first witness the `call` cell
            // reads: the panes the ladder really writes to. A 0 says the board
            // does not overflow at this viewport, so the ladder walked nowhere
            // and no arm verdict is available — which is the distinction the
            // panel's earlier `unreached` reading could not make.
            ladderPanes: ladderSpans.filter((span, k) => k !== UNSCROLLED_PANE && span > 0).length,
        }),
        installWork: (tools: HarnessTools): string[] => [
            // Wrapped on `Panel.prototype`, so the key carries the receiver's
            // class: `pane.remeasure@ScrollPane` once per pane per pass, and
            // `pane.remeasure@Panel` once for the board root, whose own
            // re-measure returns at once because it does not scroll.
            tools.countMethod(panes[0], 'remeasureScrollMetrics', 'pane.remeasure'),
            // The second witness: one count per entry into the framework's
            // scroll-shadow path, which is where both of `g16.scroll-reads`'
            // scroll sub-patches sit. A 0 over the `call` phase says the
            // ladder's writes produced no scroll event at all, so the arm
            // could not have engaged whatever it reads.
            tools.countMethod(panes[0], 'updateScrollShadows', 'pane.shadowUpdate'),
            countScrollTicks(tools, panes[0]),
        ],
    };
}
