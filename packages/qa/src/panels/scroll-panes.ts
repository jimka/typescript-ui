import { Panel } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import { Text } from '@jimka/typescript-ui/component/input';
import { Grid, VBox } from '@jimka/typescript-ui/layout';
import { outlineLabels } from '../builders/data.js';
import { elementFor } from '../builders/dom.js';
import type { GeometryTarget, HarnessTools } from '../harness/types.js';
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

export const description = 'A Grid of n scrolling Panel subclasses (default 24), each holding 40 Text rows — more than a cell of the board can show. The panes are a subclass because a plain Panel opts into the unchanged-commit layout skip, and a pane that skips its pass never reaches remeasureScrollMetrics, which is the call this cell measures; a real application\'s scrolling pane is almost always a subclass too, so what G16 has left to win exists only for panels that are not opted in. Built for G16: one `passes` unit re-measures every pane\'s scroll metrics, and one `wheel` unit really scrolls pane 0, so the settled-pass gate and the scroll-read path are exercised on the same scrollable Panels in one cell. It reproduces no outside behaviour and has no recorded figure: it exists so the two G16 arms have a population large enough to read against a phase\'s bracket.';

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
 * Builds a board of `n` scrolling panes of `ROWS_PER_PANE` text rows each.
 *
 * @param n - Scrolling panes.
 * @returns The board as root, target of `passes` and `resize`; and `afterMount` giving `wheel` pane 0's element.
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

    // No label sits on scrolled content except `row1`, which is a row of pane
    // 1 — a pane no phase scrolls. A label on pane 0's content would move with
    // a scroll position no two runs share, and every plain run would then
    // disagree with every other. `row1` still catches a wrongly reserved
    // gutter or a wrongly sized shadow overlay, both of which move content.
    const geometry: Record<string, GeometryTarget> = { board: root, pane0: panes[0], paneLast: panes[n - 1] };

    if (n > 1) {
        geometry.pane1 = panes[1];
        geometry.row1 = panes[1].getComponents()[0];
    }

    return {
        root,
        targets: { passes: root, resize: root },
        afterMount: (tools: HarnessTools): Record<string, unknown> => ({
            wheel: elementFor(tools, panes[0], PANEL),
        }),
        geometry,
        describe: () => ({
            panes: n,
            rowsPerPane: ROWS_PER_PANE,
            // The premise of the cell: a pane that does not overflow at the
            // host's viewport re-measures nothing worth skipping and scrolls
            // nowhere, so an `unreached` verdict would be about the board.
            scrollablePanes: panes.filter((pane) => pane.getMaxScrollTop() > 0).length,
            maxScrollTop0: panes[0].getMaxScrollTop(),
        }),
        installWork: (tools: HarnessTools): string[] => [
            // Wrapped on `Panel.prototype`, so the key carries the receiver's
            // class: `pane.remeasure@ScrollPane` once per pane per pass, and
            // `pane.remeasure@Panel` once for the board root, whose own
            // re-measure returns at once because it does not scroll.
            tools.countMethod(panes[0], 'remeasureScrollMetrics', 'pane.remeasure'),
            countScrollTicks(tools, panes[0]),
        ],
    };
}
