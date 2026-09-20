import { Panel } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import { LabeledGrid } from '@jimka/typescript-ui/component/container';
import { Header } from '@jimka/typescript-ui/component/display';
import { TextField } from '@jimka/typescript-ui/component/input';
import { Border } from '@jimka/typescript-ui/layout';
import { Dialog, Window } from '@jimka/typescript-ui/overlay';
import { Insets, Placement } from '@jimka/typescript-ui/primitive';
import { appToolBar } from '../builders/chrome.js';
import { elementFor, lateId, pickStrip } from '../builders/dom.js';
import type { StripSide } from '../builders/dom.js';
import { choice } from '../builders/params.js';
import type { CallTarget, HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'windows';

/** What `drag` presses: window 0's header (a move) or its east edge strip (a resize). */
const GRIPS = ['header', 'edge'] as const;

// Where the windows open: window i at (40 + 32i, 60 + 24i), clear of the
// toolbar, each offset down and right from the last so every header shows.
const WINDOW_X_PX = 40;
const WINDOW_Y_PX = 60;
const WINDOW_STEP_X_PX = 32;
const WINDOW_STEP_Y_PX = 24;

// Every window's size: room for its four-field form.
const WINDOW_WIDTH_PX = 420;
const WINDOW_HEIGHT_PX = 300;

/** Fields in each window's form. */
const WINDOW_FIELDS = 4;

/** Fields in the dialog's form: a little more than a window's, as an edit dialog has. */
const DIALOG_FIELDS = 6;

// C25's window insets (top, right, bottom, left): a right inset unlike the
// bottom one, so the south strip's height shows which of the two it took.
const C25_TOP_PX = 4;
const C25_RIGHT_PX = 12;
const C25_BOTTOM_PX = 4;
const C25_LEFT_PX = 4;

/**
 * Units between two dialog toggles: a dialog's 150 ms open and close
 * animations are about 9 frames each at 60 Hz, so 30 lets one finish, and
 * settle, before the next toggle, and a phase measures whole opens and closes.
 */
const DIALOG_PERIOD_UNITS = 30;

export const description = 'n floating Windows (default 8), each holding a four-field form, half of them minimized, plus a bare Window and one with insets (4, 12, 4, 4), over a toolbar; toggle opens and closes a six-field Dialog. Reproduces slice 09 F09.11 (a header move is not frame-coalesced: it re-applies the window and reads the viewport per mousemove): apply 1 and getViewportSize 1 per move; F09.4 (a settled window re-laid out and rewritten every pass): apply 38 per bare-window pass, no setRuleStyles; F09.6 (the minimized stack\'s resize handling is quadratic in minimized windows): getViewportSize at least minimized² per viewport unit; and C25 (the south resize strip takes the right inset as its height): geometry.southStrip is 12 px tall, not 4.';

/** Eight windows: four open and four minimized, a busy desktop. */
export const defaultScale = 8;

/** A window resize event, which every open window, the minimized stack and the dialogs answer. */
export const defaultDrive = 'viewport';

/**
 * A labelled one-column grid of text fields, a window's or a dialog's form.
 *
 * @param fields - How many fields.
 * @returns The grid.
 */
function textForm(fields: number): LabeledGrid {
    const grid = LabeledGrid({ columns: 1 });

    for (let k = 0; k < fields; k++) {
        grid.addField(`Field ${k + 1}`, TextField());
    }

    return grid;
}

/** Each window's content factory: a four-field form. */
function fourFieldForm(): Component {
    return textForm(WINDOW_FIELDS);
}

/** The dialog's content factory: a six-field form. */
function sixFieldForm(): Component {
    return textForm(DIALOG_FIELDS);
}

/**
 * The `toggle` target: every `DIALOG_PERIOD_UNITS` units, opens an edit
 * dialog when none is open and closes it otherwise.
 *
 * @returns The target.
 */
function dialogToggle(): CallTarget {
    let dialog: Dialog | null = null;

    return function toggleDialog(index: number): void {
        if (index % DIALOG_PERIOD_UNITS !== 0) {
            return;
        }

        if (dialog) {
            dialog.hide('close');
            dialog = null;

            return;
        }

        dialog = Dialog({
            title: 'Edit',
            contentComponent: sixFieldForm(),
            buttons: [{ text: 'Cancel', result: 'cancel' }, { text: 'OK', result: 'confirm', primary: true }],
        });

        void dialog.show();
    };
}

/**
 * One of a window's `.WindowBorder` strips, picked by `pickStrip`.
 *
 * @param tools - The harness tools.
 * @param win - The window.
 * @param side - Which strip.
 * @returns The strip's element.
 * @throws Error - When the window has no `.WindowBorder` elements.
 */
function windowStrip(tools: HarnessTools, win: Window, side: StripSide): HTMLElement {
    const strips = Array.from(elementFor(tools, win, PANEL).querySelectorAll<HTMLElement>('.WindowBorder'));
    const index = pickStrip(strips.map((strip) => strip.getBoundingClientRect()), side);

    if (index < 0) {
        throw new Error(`${PANEL}: no element matches .WindowBorder in #${win.getId()}`);
    }

    return strips[index];
}

/**
 * Builds a desktop: a toolbar over a header, and `n` windows, a bare window
 * and C25's window, all shown after mounting, with the last `⌊n / 2⌋` of the
 * `n` minimized.
 *
 * @param n - Windows.
 * @param params - `grip=` chooses what `drag` presses; read once mounted.
 * @returns The desktop as root; `toggle`, which opens and closes a dialog; and `afterMount` showing the windows and giving `drag`, `click` (the open windows' headers), `passes` (the bare window) and `hover` (window 0) their targets.
 */
export function build(n: number, params: URLSearchParams): PanelBuild {
    const windows = Array.from({ length: n }, (_, i) => Window(`Window ${i + 1}`, {
        x: WINDOW_X_PX + WINDOW_STEP_X_PX * i,
        y: WINDOW_Y_PX + WINDOW_STEP_Y_PX * i,
        width: WINDOW_WIDTH_PX,
        height: WINDOW_HEIGHT_PX,
        contentFactory: fourFieldForm,
    }));

    const bare = Window('Bare');
    const c25 = Window('Insets', { insets: new Insets(C25_TOP_PX, C25_RIGHT_PX, C25_BOTTOM_PX, C25_LEFT_PX) });
    const minimized = Math.floor(n / 2);
    const southStrip = lateId();

    const root = Panel({
        layoutManager: Border(),
        components: [
            { component: appToolBar(), constraints: { placement: Placement.NORTH } },
            { component: Header('Desktop'), constraints: { placement: Placement.CENTER } },
        ],
    });

    return {
        root,
        targets: { toggle: dialogToggle() },
        afterMount: (tools: HarnessTools): Record<string, unknown> => {
            const grip = choice(params, 'grip', GRIPS, PANEL);

            for (const win of [...windows, bare, c25]) {
                win.show();
            }

            windows.slice(n - minimized).forEach((win) => win.minimize());
            southStrip.set(windowStrip(tools, c25, 'south').id);

            return {
                drag: { element: grip === 'header' ? elementFor(tools, windows[0].getHeader(), PANEL) : windowStrip(tools, windows[0], 'east'), axis: 'x' },
                click: { elements: windows.slice(0, n - minimized).map((win) => elementFor(tools, win.getHeader(), PANEL)) },
                passes: bare,
                hover: { element: elementFor(tools, windows[0], PANEL), axis: 'x' },
            };
        },
        geometry: { win0: windows[0], bare, southStrip: southStrip.target },
        describe: () => ({ windows: n, minimized }),
    };
}
