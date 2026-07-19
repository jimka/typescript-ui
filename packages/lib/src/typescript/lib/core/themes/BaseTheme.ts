// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { DeepPartial, Theme } from '~/core/Theme.js';

/**
 * Scheme-invariant structural tokens shared by every built-in theme — sizes,
 * paddings, radii, gaps, thicknesses, durations, and font sizes. Not a usable
 * theme on its own (palette tokens are absent); wrap it with {@link defineTheme}.
 *
 * The one structural-shaped token that is *not* invariant carries its base
 * value here — `tab.underBorderFullWidth: true` (Modern and Dark override to
 * `false`, so only Classic keeps the base value).
 *
 * @category Theme
 */
export const BaseTheme: DeepPartial<Theme> = {
    font: {
        family     : "'Manrope Variable', sans-serif",
        size       : '14px',
        linePadding: '2px',
    },
    border: {
        radius: '4px',
    },
    button: {
        padding: '0',
        font   : { size: '-2px' },      // base − 2 → 12px at the 14px base
        description: {
            fontSize: '-3px',           // base − 3 → 11px at the 14px base
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
        font   : { size: '-2px' },      // base − 2 → 12px at the 14px base
    },
    table: {
        header: {
            font : { size: '-1px' },    // base − 1 → 13px at the 14px base
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
            fontSize: '-4px',           // base − 4 → 10px at the 14px base
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
    // Scheme-invariant charting structure: stroke widths and the point-marker
    // radius carry no palette meaning, so they live here rather than in each
    // per-scheme theme. `2px` line / `1px` axis mirror the framework's other
    // hairline rules (e.g. the tab under-border); `3px` points read at the
    // plan's modest data densities without crowding.
    chart: {
        lineWidth  : '2px',
        axisWidth  : '1px',
        pointRadius: '3px',
    },
    // The scale knob plus the font-coupled ratios. Each ratio is `current-px ÷
    // base`, chosen so `round(base × ratio)` recovers the exact historic px at
    // the default base of 14 (so nothing shifts until the base is raised), then
    // grows proportionally as the base scales. titleGlyph is `{ scale: 1 }` —
    // one base size — so the window/tab title glyph tracks the base 1:1.
    scale: {
        base          : 14,
        titleGlyph    : { scale: 1 },        // 14 ÷ 14 — title glyph == base
        tabClose      : { scale: 16 / 14 },  // close-button box was 16px
        tabCloseGlyph : { scale: 8 / 14 },   // close-glyph ink was 8px
        tabButtonInset: { scale: 4 / 14 },   // tab-button inset was 4px
    },
};
