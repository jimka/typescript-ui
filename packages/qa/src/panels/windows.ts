import { Panel } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import { LabeledGrid } from '@jimka/typescript-ui/component/container';
import { Header } from '@jimka/typescript-ui/component/display';
import { TextField } from '@jimka/typescript-ui/component/input';
import { Border } from '@jimka/typescript-ui/layout';
import { Dialog, Notification, Window } from '@jimka/typescript-ui/overlay';
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

// Where the pinned window opens, relative to window 0: half of window 0's own
// box down and across, so it covers the cascade's bodies while every header
// above it stays clear to click. That covered region is what C30 reads — an
// always-on-top window must paint over the clicked ones there, however many
// clicks the run makes.
const PINNED_OFFSET_X_PX = WINDOW_WIDTH_PX / 2;
const PINNED_OFFSET_Y_PX = WINDOW_HEIGHT_PX / 2;

/** Fields in each window's form. */
const WINDOW_FIELDS = 4;

/** Fields in the dialog's form: a little more than a window's, as an edit dialog has. */
const DIALOG_FIELDS = 6;

// C25's window insets (top, right, bottom, left): a right inset unlike the
// bottom one, so the south strip's height shows which of the two it took.
// Now that the strip takes its own inset, the asymmetry is what keeps the
// witness honest — a uniform inset would agree either way.
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

export const description = 'n floating Windows (default 8), each holding a four-field form, half of them minimized, plus a bare Window, one with insets (4, 12, 4, 4) and an always-on-top one overlapping window 0, over a toolbar, with one persistent toast; toggle opens and closes a six-field Dialog. Reproduces slice 09 F09.11 (a header move is not frame-coalesced: it re-applies the window and reads the viewport per mousemove): apply 1 and getViewportSize 1 per move; F09.4 (a settled window re-laid out and rewritten every pass): apply 38 per bare-window pass, no setRuleStyles; F09.6 (the minimized stack\'s resize handling is quadratic in minimized windows): getViewportSize at least minimized² per viewport unit; C25 (fixed: the south resize strip takes the bottom inset as its height): geometry.southStrip is 4 px tall, not 12; C30 (an ordinary window\'s stamp climbs past the pinned band, so after about 400 clicks the clicked windows paint over the pinned one); and C33 (a live toast adds one getViewportSize per viewport unit once it re-stacks on resize, and none before).';

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
 * Builds a desktop: a toolbar over a header, and `n` windows, a bare window,
 * C25's window and an always-on-top window overlapping window 0, all shown
 * after mounting, with the last `⌊n / 2⌋` of the `n` minimized and one
 * persistent toast in the corner.
 *
 * @param n - Windows.
 * @param params - `grip=` chooses what `drag` presses; read once mounted.
 * @returns The desktop as root; `toggle`, which opens and closes a dialog; and `afterMount` showing the windows and the toast, and giving `drag`, `click` (the open windows' headers), `passes` (the bare window) and `hover` (window 0) their targets.
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
    // `alwaysOnTop` in the options bag, not a `setAlwaysOnTop` after `show()`:
    // `getBand()` then already answers the pinned band when `show()` registers
    // the window. It is not among `click`'s targets, so it never raises.
    const pinned = Window('Pinned', {
        x: WINDOW_X_PX + PINNED_OFFSET_X_PX,
        y: WINDOW_Y_PX + PINNED_OFFSET_Y_PX,
        width: WINDOW_WIDTH_PX,
        height: WINDOW_HEIGHT_PX,
        alwaysOnTop: true,
    });
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

            for (const win of [...windows, bare, c25, pinned]) {
                win.show();
            }

            windows.slice(n - minimized).forEach((win) => win.minimize());
            southStrip.set(windowStrip(tools, c25, 'south').id);

            // Duration 0 keeps one toast alive for the whole run, so C33's
            // re-stack answers every viewport unit. Not a C31 witness: that
            // needs a dropdown open over the bottom-right corner, which this
            // panel has no element for.
            Notification.show('Stacking witness', 'info', 0);

            return {
                drag: { element: grip === 'header' ? elementFor(tools, windows[0].getHeader(), PANEL) : windowStrip(tools, windows[0], 'east'), axis: 'x' },
                click: { elements: windows.slice(0, n - minimized).map((win) => elementFor(tools, win.getHeader(), PANEL)) },
                passes: bare,
                hover: { element: elementFor(tools, windows[0], PANEL), axis: 'x' },
            };
        },
        geometry: { win0: windows[0], bare, pinned, southStrip: southStrip.target },
        describe: () => ({ windows: n, minimized }),
    };
}
