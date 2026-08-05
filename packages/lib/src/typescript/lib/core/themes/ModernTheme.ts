// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BaseTheme } from '~/core/themes/BaseTheme.js';
import { defineTheme } from '~/core/Theme.js';
import type { Theme } from '~/core/Theme.js';

/**
 * Opt-in modern light theme: flat, gradient-free buttons and a flatter table
 * header surface that read as a cleaner, more contemporary light scheme.
 *
 * Authored as `defineTheme(BaseTheme, …)`: it declares only its palette,
 * `colorScheme`, and the single structural divergence
 * `tab.underBorderFullWidth: false` (the base majority is `true`). Every other
 * structural token is inherited from {@link BaseTheme}; it deliberately does
 * not derive from any other concrete theme.
 *
 * @category Theme
 */
export const ModernTheme: Theme = defineTheme(BaseTheme, {
    colorScheme: 'light',
    text       : { color: 'rgb(0, 0, 0)' },
    body       : { background: 'rgb(255, 255, 255)' },
    border     : { color: 'black' },
    button     : {
        background: 'rgb(243, 244, 246)',
        border    : 'rgb(214, 217, 222)',
        shadow    : 'none',
        description: {
            foreground: 'rgb(110, 110, 110)',
        },
        pressed   : {
            foreground: 'rgb(150, 150, 150)',
            background: 'linear-gradient(rgb(206, 210, 216), rgb(214, 217, 222))',
            shadow    : 'inset 0 1px 3px rgba(0, 0, 0, 0.18)',
        },
        hover     : {
            foreground: 'inherit',
            background: 'rgb(234, 236, 239)',
            shadow    : 'none',
        },
        flat      : {
            hover  : {
                background: 'rgba(0, 0, 0, 0.06)',
                border    : '1px solid rgb(200, 200, 200)',
            },
            pressed: {
                background: 'rgba(0, 0, 0, 0.10)',
                shadow    : 'inset 1px 1px 3px rgba(0, 0, 0, 0.25)',
                border    : '1px solid rgb(180, 180, 180)',
            },
        },
    },
    toggle      : {
        selected: {
            background: 'rgb(200, 200, 200)',
            shadow    : '2px 2px 1px inset grey',
        },
    },
    input : {
        background : 'rgb(255, 255, 255)',
        border     : '1px solid rgb(160, 160, 160)',
        borderHover: '1px solid rgb(120, 120, 120)',
    },
    form  : {
        background        : 'rgb(255, 255, 255)',
        border            : 'rgb(160, 160, 160)',
        color             : 'rgb(40, 40, 40)',
        disabledBackground: 'rgb(240, 240, 240)',
        disabledColor     : 'rgb(170, 170, 170)',
        focusRing         : 'rgb(30, 100, 200)',
        toggle  : {
            trackOffBackground: 'rgb(200, 200, 200)',
            trackOnBackground : 'rgb(30, 100, 200)',
            thumbBackground   : 'rgb(255, 255, 255)',
        },
        slider  : {
            trackBackground      : 'rgb(220, 220, 220)',
            trackActiveBackground: 'rgb(30, 100, 200)',
            thumbBackground      : 'rgb(255, 255, 255)',
        },
        checkbox: {
            background             : 'rgb(255, 255, 255)',
            selectedBackground     : 'rgb(30, 100, 200)',
            indeterminateBackground: 'rgb(160, 160, 160)',
            checkColor             : 'rgb(255, 255, 255)',
        },
        radio   : {
            background        : 'rgb(255, 255, 255)',
            selectedBackground: 'rgb(30, 100, 200)',
            dotColor          : 'rgb(255, 255, 255)',
        },
    },
    gutter: { background: '#AAAAAA' },
    collapse: {
        strip:  { background: '#AAAAAA', size: '18px' },
        button: { color: 'rgb(100,100,100)' },
    },
    accordion: {
        border   : '1px solid rgb(214, 217, 222)',
        header   : {
            // Flat, gradient-free header matching this theme's buttons.
            background: 'rgb(243, 244, 246)',
            border    : '1px solid rgb(214, 217, 222)',
            color     : 'inherit',
        },
        panel    : { border: 'rgb(214, 217, 222)' },
        indicator: { color: 'rgb(100,100,100)' },
    },
    tab   : {
        underBorderFullWidth: false,
        toolbar: { background: '#eee',     border: '#e1e1e8' },
        button : {
            background : 'rgb(226, 229, 233)',
            border     : 'none',
            borderLeft : '1px solid rgb(214, 217, 222)',
            borderRight: '1px solid rgb(214, 217, 222)',
            hover      : {
                background : 'rgb(234, 236, 239)',
                border     : 'none',
                borderLeft : '1px solid rgb(206, 210, 216)',
                borderRight: '1px solid rgb(206, 210, 216)',
            },
            selected   : {
                background : 'rgb(255, 255, 255)',
                border     : 'none',
                borderLeft : '1px solid rgb(214, 217, 222)',
                borderRight: '1px solid rgb(214, 217, 222)',
            },
        },
        indicator: { color: '#1a73e8' },
    },
    window: {
        shadow      : '3px 3px 2px rgba(0, 0, 0, 0.4)',
        snapGlow    : '0 0 0 2px rgba(30, 100, 200, 0.7)',
        control     : {
            background      : 'rgb(255, 255, 255)',
            border          : '1px solid transparent',
            shadow          : 'none',
            hoverBackground : 'rgb(236, 238, 241)',
            activeBackground: 'rgb(226, 229, 233)',
        },
        header      : { background: '#eee' },
    },
    table : {
        header: {
            background: 'rgb(248, 249, 250)',
            border: 'rgb(226, 229, 233)',
            glyph : { color: 'currentColor' },
        },
        row   : {
            selected      : 'rgba(30, 100, 200, 0.15)',
            selectedBorder: 'inset 0 0 0 1px rgba(30, 100, 200, 0.6)',
            new           : 'rgba(70, 200, 70, 0.15)',
            dirty         : 'rgba(255, 165, 0, 0.15)',
            stripe        : 'rgba(0, 0, 0, 0.035)',
        },
        cell  : {
            background                : 'transparent',
            readonlyBackground        : 'rgba(0, 0, 0, 0.04)',
            requiredEmptyOutlineColor : 'rgba(220, 60, 60, 0.6)',
            color                     : 'inherit',
            border                    : 'none',
            editorBorderColor         : 'rgba(30, 100, 200, 0.6)',
        },
        resizeHandle: {
            color : 'rgba(0, 0, 0, 0.2)',
        },
        sortBadge: {
            background: 'rgba(0, 0, 0, 0.15)',
            color     : 'inherit',
        },
    },
    contextMenu: {
        background    : 'rgb(255, 255, 255)',
        border        : 'rgb(200, 200, 200)',
        shadow        : '2px 4px 8px rgba(0, 0, 0, 0.15)',
        item          : {
            hoverBackground: 'rgba(30, 100, 200, 0.12)',
            disabledColor  : 'rgb(170, 170, 170)',
        },
        separatorColor: 'rgb(220, 220, 220)',
    },
    menuBar: {
        // Menu bars share the tool bar's background by default (see toolBar below).
        background    : 'rgb(245, 245, 245)',
        border        : 'rgb(220, 220, 220)',
        button        : {
            background     : 'transparent',
            hoverBackground: 'rgba(30, 100, 200, 0.10)',
            foreground     : 'inherit',
        },
        panel         : {
            background: 'rgb(255, 255, 255)',
            border    : 'rgb(200, 200, 200)',
            shadow    : '2px 4px 8px rgba(0, 0, 0, 0.15)',
        },
        item          : {
            hoverBackground: 'rgba(30, 100, 200, 0.12)',
            disabledColor  : 'rgb(170, 170, 170)',
            shortcutColor  : 'rgb(140, 140, 140)',
        },
        separatorColor: 'rgb(220, 220, 220)',
    },
    statusBar: {
        background: 'rgb(245, 245, 245)',
        color     : 'rgb(60, 60, 60)',
        border    : 'rgb(220, 220, 220)',
    },
    toolBar: {
        background    : 'rgb(245, 245, 245)',
        border        : 'rgb(220, 220, 220)',
        separatorColor: 'rgb(220, 220, 220)',
    },
    tooltip: {
        background: 'rgb(255, 255, 240)',
        color     : 'rgb(0, 0, 0)',
        border    : 'rgb(180, 180, 100)',
        shadow    : '1px 2px 4px rgba(0, 0, 0, 0.2)',
    },
    popover: {
        background: 'rgb(255, 255, 255)',
        color     : 'rgb(0, 0, 0)',
        border    : 'rgb(200, 200, 200)',
        shadow    : '2px 4px 12px rgba(0, 0, 0, 0.18)',
    },
    notification: {
        shadow : '2px 4px 8px rgba(0, 0, 0, 0.15)',
        info   : { background: 'rgba(210, 224, 244, 0.75)',  border: 'rgb(30, 100, 200)'  },
        success: { background: 'rgba(210, 240, 220, 0.75)',  border: 'rgb(30, 180, 80)'   },
        warning: { background: 'rgba(248, 232, 204, 0.75)',  border: 'rgb(220, 140, 0)'   },
        error  : { background: 'rgba(244, 214, 214, 0.75)',  border: 'rgb(200, 50, 50)'   },
    },
    validation: {
        error: {
            border : 'rgb(200, 50, 50)',
            tooltip: {
                background: 'rgb(180, 30, 30)',
                color     : 'rgb(255, 255, 255)',
                border    : 'rgb(140, 20, 20)',
            },
        },
    },
    autoComplete: {
        background: 'rgb(255, 255, 255)',
        border    : 'rgb(200, 200, 200)',
        shadow    : '2px 4px 8px rgba(0,0,0,0.15)',
        item: {
            hoverBackground    : 'rgba(30, 100, 200, 0.08)',
            highlightBackground: 'rgba(30, 100, 200, 0.18)',
            highlightColor     : 'inherit',
            disabledColor      : 'rgb(170, 170, 170)',
        },
    },
    list: {
        background: 'rgb(255, 255, 255)',
        border    : 'rgb(200, 200, 200)',
        row: {
            hoverBackground   : 'rgba(30, 100, 200, 0.08)',
            selectedBackground: 'rgba(30, 100, 200, 0.18)',
            selectedColor     : 'inherit',
            focusRing         : 'rgb(30, 100, 200)',
            disabledColor     : 'rgb(170, 170, 170)',
            separator         : 'transparent',
        },
    },
    indicator: {
        focus    : 'rgb(30, 100, 200)',
        selection: '1px dashed rgb(120, 170, 240)',
    },
    picker: {
        navForeground:          'var(--ts-ui-text-color)',
        navHoverBackground:     'rgba(30, 100, 200, 0.08)',
        cellDisabledBackground: 'transparent',
    },
    dialog: {
        backdrop: { background: 'rgba(0, 0, 0, 0.45)' },
        border  : 'rgb(220, 220, 220)',
        shadow  : '4px 8px 24px rgba(0, 0, 0, 0.35)',
        confirm : 'rgb(30, 180, 80)',
        cancel  : 'rgb(200, 50, 50)',
        info    : { background: 'rgba(30, 100, 200, 0.15)', foreground: 'rgb(30, 100, 200)' },
        affirm  : { background: 'rgba(30, 180, 80, 0.15)',  foreground: 'rgb(30, 180, 80)'  },
    },
    drawer: {
        shadow    : '4px 0 24px rgba(0, 0, 0, 0.25)',
        border    : 'rgb(220, 220, 220)',
    },
    rail: {
        border    : 'rgb(220, 220, 220)',
        shadow    : '2px 0 12px rgba(0, 0, 0, 0.18)',
        handle: {
            hoverBackground   : 'rgba(30, 100, 200, 0.08)',
            selectedBackground: 'rgba(30, 100, 200, 0.16)',
        },
    },
    spinner: {
        dividerColor: 'rgb(180, 180, 180)',
    },
    progressBar: {
        track        : { background: 'rgb(220, 220, 220)' },
        fill         : { background: 'rgb(30, 100, 200)' },
        indeterminate: { background: 'rgb(30, 100, 200)' },
    },
    progressSpinner: {
        color   : 'rgb(30, 100, 200)',
        backdrop: 'rgba(255, 255, 255, 0.6)',
    },
    drag: {
        ghost: {
            background: 'rgba(200, 200, 200, 0.9)',
            border    : 'rgb(150, 150, 150)',
            shadow    : '2px 4px 12px rgba(0, 0, 0, 0.25)',
        },
        feedback: {
            valid  : { background: 'rgba(30, 180, 80, 0.12)', border: 'rgb(30, 180, 80)'  },
            invalid: { background: 'rgba(200, 50, 50, 0.10)', border: 'rgb(200, 50, 50)' },
        },
        reorderIndicator: {
            color: 'rgb(30, 100, 200)',
        },
        dropzone: {
            background       : 'rgba(80, 140, 240, 0.10)',
            border           : 'rgba(80, 140, 240, 0.40)',
            activeBackground : 'rgba(80, 140, 240, 0.28)',
            invalidBackground: 'rgba(200, 50, 50, 0.28)',
        },
    },
    fileDropZone: {
        background      : 'rgba(80, 140, 240, 0.06)',
        border          : '2px dashed rgba(80, 140, 240, 0.40)',
        activeBackground: 'rgba(80, 140, 240, 0.18)',
        activeBorder    : '2px dashed rgba(80, 140, 240, 0.80)',
    },
    scroll: {
        shadowColor: 'rgba(0, 0, 0, 1)',
    },
    // Okabe–Ito colour-blind-safe categorical palette, tuned for a light
    // background. Axis/grid/label are neutral greys; the selection ring reuses
    // the theme's blue accent (matching the focus indicator).
    chart: {
        series: [
            '#0072B2', // blue
            '#E69F00', // orange
            '#009E73', // green
            '#D55E00', // vermilion
            '#CC79A7', // purple
            '#56B4E9', // sky
            '#8C6D1F', // gold
            '#555555', // grey
        ],
        axis     : 'rgb(120, 120, 120)',
        grid     : 'rgb(224, 224, 224)',
        label    : 'rgb(85, 85, 85)',
        selection: '#1a73e8',
    },
});
