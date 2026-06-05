// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Theme } from '~/core/Theme.js';

/**
 * Opt-in modern light theme: flat, gradient-free buttons and a flatter table
 * header surface. Reuses {@link ClassicTheme} values everywhere except the
 * `button` and `table.header` buckets, so it stays a light scheme that simply
 * reads as a cleaner, more contemporary variant of the default.
 *
 * @category Theme
 */
export const ModernTheme: Theme = {
    colorScheme: 'light',
    font       : { family: 'system-ui, sans-serif', size: '14px', linePadding: '2px' },
    text       : { color: 'rgb(0, 0, 0)' },
    body       : { background: 'rgb(255, 255, 255)' },
    border     : { color: 'black',                 radius: '4px' },
    button     : {
        background: 'rgb(243, 244, 246)',
        border    : 'rgb(214, 217, 222)',
        shadow    : 'none',
        padding   : '0',
        font      : { size: '12px' },
        description: {
            fontSize  : '11px',
            foreground: 'rgb(110, 110, 110)',
            weight    : 'normal',
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
            width             : '36px',
            height            : '20px',
        },
        slider  : {
            trackBackground      : 'rgb(220, 220, 220)',
            trackActiveBackground: 'rgb(30, 100, 200)',
            thumbBackground      : 'rgb(255, 255, 255)',
            thumbSize            : '16px',
            trackThickness       : '4px',
        },
        checkbox: {
            background             : 'rgb(255, 255, 255)',
            selectedBackground     : 'rgb(30, 100, 200)',
            indeterminateBackground: 'rgb(160, 160, 160)',
            checkColor             : 'rgb(255, 255, 255)',
            size                   : '16px',
            radius                 : '3px',
        },
        radio   : {
            background        : 'rgb(255, 255, 255)',
            selectedBackground: 'rgb(30, 100, 200)',
            dotColor          : 'rgb(255, 255, 255)',
            size              : '16px',
        },
    },
    gutter: { background: '#AAAAAA' },
    accordion: {
        header   : {
            background: 'linear-gradient(rgb(230,230,230),rgb(210,210,210))',
            border    : 'rgb(190,190,190)',
            color     : 'inherit',
        },
        panel    : { border: 'rgb(210,210,210)' },
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
        indicator: { color: '#1a73e8', thickness: '2px' },
    },
    window: {
        shadow      : '3px 3px 2px rgba(0, 0, 0, 0.4)',
        snapGlow    : '0 0 0 2px rgba(30, 100, 200, 0.7)',
        minDockWidth: '200px',
    },
    header: { font: { size: '12px' }, padding: 5 },
    table : {
        header: {
            background: 'rgb(248, 249, 250)',
            border: 'rgb(226, 229, 233)',
            font  : { size: '13px' },
            glyph : { gap: '4px', color: 'currentColor' },
        },
        row   : {
            selected      : 'rgba(30, 100, 200, 0.15)',
            selectedBorder: 'inset 0 0 0 1px rgba(30, 100, 200, 0.6)',
            new           : 'rgba(70, 200, 70, 0.15)',
            dirty         : 'rgba(255, 165, 0, 0.15)',
        },
        cell  : {
            height            : '22px',
            padding           : 2,
            background        : 'transparent',
            readonlyBackground: 'rgba(0, 0, 0, 0.04)',
            color             : 'inherit',
            border            : 'none',
            editorBorderColor : 'rgba(30, 100, 200, 0.6)',
        },
        resizeHandle: {
            width : '5px',
            color : 'rgba(0, 0, 0, 0.2)',
            cursor: 'ew-resize',
        },
        sortBadge: {
            background: 'rgba(0, 0, 0, 0.15)',
            color     : 'inherit',
            fontSize  : '10px',
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
        background    : 'transparent',
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
            minWidth  : '160px',
        },
        item          : {
            hoverBackground: 'rgba(30, 100, 200, 0.12)',
            disabledColor  : 'rgb(170, 170, 170)',
            shortcutColor  : 'rgb(140, 140, 140)',
        },
        separatorColor: 'rgb(220, 220, 220)',
    },
    statusBar: {
        background: 'transparent',
        color     : 'rgb(60, 60, 60)',
        border    : 'rgb(220, 220, 220)',
        height    : '22px',
        padding   : '6px',
    },
    toolBar: {
        background    : 'transparent',
        border        : 'rgb(220, 220, 220)',
        padding       : '4px',
        gap           : '4px',
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
        radius    : '6px',
        padding   : '12px',
        arrowSize : '8px',
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
    dropdown: {
        fade: { duration: '120ms', translate: '4px' },
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
    spinner: {
        buttonWidth : '18px',
        dividerColor: 'rgb(180, 180, 180)',
    },
    progressBar: {
        track        : { background: 'rgb(220, 220, 220)', borderRadius: '4px' },
        fill         : { background: 'rgb(30, 100, 200)' },
        indeterminate: { background: 'rgb(30, 100, 200)' },
    },
    progressSpinner: {
        color   : 'rgb(30, 100, 200)',
        backdrop: 'rgba(255, 255, 255, 0.6)',
        size    : '32px',
    },
    glyph: {
        spinDuration : '2000ms',
        pulseDuration: '1000ms',
        beatDuration : '1000ms',
    },
    drag: {
        ghost: {
            background: 'rgba(200, 200, 200, 0.9)',
            border    : 'rgb(150, 150, 150)',
            shadow    : '2px 4px 12px rgba(0, 0, 0, 0.25)',
            opacity   : '0.85',
        },
        feedback: {
            valid  : { background: 'rgba(30, 180, 80, 0.12)', border: 'rgb(30, 180, 80)'  },
            invalid: { background: 'rgba(200, 50, 50, 0.10)', border: 'rgb(200, 50, 50)' },
        },
        reorderIndicator: {
            color: 'rgb(30, 100, 200)',
        },
    },

    scroll: {
        shadowColor: 'rgba(0, 0, 0, 1)',
    },
};
