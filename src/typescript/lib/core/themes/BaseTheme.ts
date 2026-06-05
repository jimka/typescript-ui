// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { DeepPartial, Theme } from '~/core/Theme.js';

/**
 * Scheme-invariant structural tokens shared by every built-in theme — sizes,
 * paddings, radii, gaps, thicknesses, durations, and font sizes. Not a usable
 * theme on its own (palette tokens are absent); wrap it with {@link defineTheme}.
 *
 * The two structural-shaped tokens that are *not* invariant carry their majority
 * value here — `header.padding: 5` (Dark overrides to `4`) and
 * `tab.underBorderFullWidth: true` (Modern overrides to `false`).
 *
 * @category Theme
 */
export const BaseTheme: DeepPartial<Theme> = {
    font: {
        family     : 'system-ui, sans-serif',
        size       : '14px',
        linePadding: '2px',
    },
    border: {
        radius: '4px',
    },
    button: {
        padding: '0',
        font   : { size: '12px' },
        description: {
            fontSize: '11px',
            weight  : 'normal',
        },
    },
    form: {
        toggle  : { width: '36px', height: '20px' },
        slider  : { thumbSize: '16px', trackThickness: '4px' },
        checkbox: { size: '16px', radius: '3px' },
        radio   : { size: '16px' },
    },
    tab: {
        underBorderFullWidth: true,
        indicator: { thickness: '2px' },
    },
    window: {
        minDockWidth: '200px',
    },
    header: {
        font   : { size: '12px' },
        padding: 5,
    },
    table: {
        header: {
            font : { size: '13px' },
            glyph: { gap: '4px' },
        },
        cell: {
            height : '22px',
            padding: 2,
        },
        resizeHandle: {
            width : '5px',
            cursor: 'ew-resize',
        },
        sortBadge: {
            fontSize: '10px',
        },
    },
    menuBar: {
        panel: { minWidth: '160px' },
    },
    statusBar: {
        height : '22px',
        padding: '6px',
    },
    toolBar: {
        padding: '4px',
        gap    : '4px',
    },
    popover: {
        radius   : '6px',
        padding  : '12px',
        arrowSize: '8px',
    },
    dropdown: {
        fade: { duration: '120ms', translate: '4px' },
    },
    spinner: {
        buttonWidth: '18px',
    },
    progressBar: {
        track: { borderRadius: '4px' },
    },
    progressSpinner: {
        size: '32px',
    },
    glyph: {
        spinDuration : '2000ms',
        pulseDuration: '1000ms',
        beatDuration : '1000ms',
    },
    drag: {
        ghost: { opacity: '0.85' },
    },
};
