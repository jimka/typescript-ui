// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BaseTheme } from '~/core/themes/BaseTheme.js';
import { defineTheme } from '~/core/Theme.js';
import type { Theme } from '~/core/Theme.js';

/**
 * Dark-mode theme using dark backgrounds and light text.
 *
 * Authored as `defineTheme(BaseTheme, …)`: it declares only its palette,
 * `colorScheme: 'dark'`, and the single structural divergence
 * `header.padding: 4` (the base majority is `5`). Every other structural token
 * is inherited from {@link BaseTheme}.
 *
 * @category Theme
 */
export const DarkTheme: Theme = defineTheme(BaseTheme, {
    colorScheme: 'dark',
    text       : { color: 'rgb(220, 220, 220)' },
    body       : { background: 'rgb(30, 30, 30)' },
    border     : { color: 'rgb(90, 90, 90)' },
    button     : {
        background: 'linear-gradient(rgb(70, 70, 70), rgb(50, 50, 50))',
        border    : 'rgb(80, 80, 80)',
        shadow    : '1px 2px 5px 0 rgba(0, 0, 0, 0.5)',
        description: {
            foreground: 'rgb(160, 160, 160)',
        },
        pressed   : {
            foreground: 'rgb(180, 180, 180)',
            background: 'linear-gradient(rgb(35, 35, 35), rgb(48, 48, 48))',
            shadow    : 'inset 0 1px 4px rgba(0, 0, 0, 0.6)',
        },
        hover     : {
            foreground: 'inherit',
            background: 'linear-gradient(rgb(90, 90, 90), rgb(65, 65, 65))',
            shadow    : '1px 3px 6px 0 rgba(0, 0, 0, 0.55)',
        },
    },
    toggle      : {
        selected: {
            background: 'rgb(35, 35, 35)',
            shadow    : '2px 2px 1px inset #333',
        },
    },
    input : {
        background : 'rgb(40, 40, 40)',
        border     : '1px solid rgb(110, 110, 110)',
        borderHover: '1px solid rgb(150, 150, 150)',
    },
    form  : {
        background        : 'rgb(40, 40, 40)',
        border            : 'rgb(110, 110, 110)',
        color             : 'rgb(230, 230, 230)',
        disabledBackground: 'rgb(60, 60, 60)',
        disabledColor     : 'rgb(120, 120, 120)',
        focusRing         : 'rgb(120, 170, 240)',
        toggle  : {
            trackOffBackground: 'rgb(70, 70, 70)',
            trackOnBackground : 'rgb(120, 170, 240)',
            thumbBackground   : 'rgb(230, 230, 230)',
        },
        slider  : {
            trackBackground      : 'rgb(70, 70, 70)',
            trackActiveBackground: 'rgb(120, 170, 240)',
            thumbBackground      : 'rgb(230, 230, 230)',
        },
        checkbox: {
            background             : 'rgb(40, 40, 40)',
            selectedBackground     : 'rgb(120, 170, 240)',
            indeterminateBackground: 'rgb(100, 100, 100)',
            checkColor             : 'rgb(20, 20, 20)',
        },
        radio   : {
            background        : 'rgb(40, 40, 40)',
            selectedBackground: 'rgb(120, 170, 240)',
            dotColor          : 'rgb(20, 20, 20)',
        },
    },
    gutter: { background: '#555' },
    collapse: {
        strip:  { background: '#555', size: '18px' },
        button: { color: 'rgb(160,160,160)' },
    },
    accordion: {
        header   : {
            background: 'linear-gradient(rgb(60,60,60),rgb(45,45,45))',
            border    : 'rgb(80,80,80)',
            color     : 'inherit',
        },
        panel    : { border: 'rgb(70,70,70)' },
        indicator: { color: 'rgb(160,160,160)' },
    },
    tab   : {
        underBorderFullWidth: false,
        toolbar: { background: '#2a2a2a', border: '#444' },
        button : {
            background: '#3a3a3a',
            border    : 'none',
            hover     : { background: '#454545',          border: 'none' },
            selected  : { background: 'rgb(30, 30, 30)', border: 'none' },
        },
        indicator: { color: '#4a9eff' },
    },
    window    : {
        shadow      : '3px 3px 2px rgba(0, 0, 0, 0.6)',
        snapGlow    : '0 0 0 2px rgba(80, 150, 240, 0.8)',
        control     : {
            background      : 'rgb(30, 30, 30)',
            border          : '1px solid transparent',
            shadow          : 'none',
            hoverBackground : 'rgb(55, 55, 55)',
            activeBackground: 'rgb(45, 45, 45)',
        },
    },
    header    : { padding: 4 },
    table     : {
        header: {
            background: 'linear-gradient(rgb(70, 70, 70), rgb(50, 50, 50))',
            border: '#555',
            glyph : { color: 'currentColor' },
        },
        row   : {
            selected      : 'rgba(30, 100, 200, 0.25)',
            selectedBorder: 'inset 0 0 0 1px rgba(30, 100, 200, 0.8)',
            new           : 'rgba(70, 200, 70, 0.2)',
            dirty         : 'rgba(255, 165, 0, 0.2)',
        },
        cell  : {
            background        : 'transparent',
            readonlyBackground: 'rgba(255, 255, 255, 0.04)',
            color             : 'inherit',
            border            : 'none',
            editorBorderColor : 'rgba(30, 100, 200, 0.8)',
        },
        resizeHandle: {
            color : 'rgba(255, 255, 255, 0.25)',
        },
        sortBadge: {
            background: 'rgba(255, 255, 255, 0.2)',
            color     : 'inherit',
        },
    },
    contextMenu: {
        background    : 'rgb(45, 45, 45)',
        border        : 'rgb(80, 80, 80)',
        shadow        : '2px 4px 8px rgba(0, 0, 0, 0.5)',
        item          : {
            hoverBackground: 'rgba(100, 140, 220, 0.2)',
            disabledColor  : 'rgb(100, 100, 100)',
        },
        separatorColor: 'rgb(70, 70, 70)',
    },
    menuBar: {
        background    : 'transparent',
        border        : 'rgb(70, 70, 70)',
        button        : {
            background     : 'transparent',
            hoverBackground: 'rgba(100, 140, 220, 0.15)',
            foreground     : 'inherit',
        },
        panel         : {
            background: 'rgb(45, 45, 45)',
            border    : 'rgb(80, 80, 80)',
            shadow    : '2px 4px 8px rgba(0, 0, 0, 0.5)',
        },
        item          : {
            hoverBackground: 'rgba(100, 140, 220, 0.2)',
            disabledColor  : 'rgb(100, 100, 100)',
            shortcutColor  : 'rgb(140, 140, 140)',
        },
        separatorColor: 'rgb(70, 70, 70)',
    },
    statusBar: {
        background: 'transparent',
        color     : 'rgb(200, 200, 200)',
        border    : 'rgb(70, 70, 70)',
    },
    toolBar: {
        background    : 'transparent',
        border        : 'rgb(70, 70, 70)',
        separatorColor: 'rgb(70, 70, 70)',
    },
    tooltip: {
        background: 'rgb(60, 60, 45)',
        color     : 'rgb(220, 220, 180)',
        border    : 'rgb(120, 110, 70)',
        shadow    : '1px 2px 4px rgba(0, 0, 0, 0.5)',
    },
    popover: {
        background: 'rgb(50, 50, 55)',
        color     : 'rgb(230, 230, 235)',
        border    : 'rgb(90, 90, 100)',
        shadow    : '2px 4px 12px rgba(0, 0, 0, 0.55)',
    },
    notification: {
        shadow : '2px 4px 8px rgba(0, 0, 0, 0.4)',
        info   : { background: 'rgba(30, 100, 200, 0.4)',  border: 'rgb(30, 100, 200)'  },
        success: { background: 'rgba(30, 180, 80, 0.4)',   border: 'rgb(30, 180, 80)'   },
        warning: { background: 'rgba(220, 140, 0, 0.4)',   border: 'rgb(220, 140, 0)'   },
        error  : { background: 'rgba(200, 50, 50, 0.4)',   border: 'rgb(200, 50, 50)'   },
    },
    validation: {
        error: {
            border : 'rgb(220, 80, 80)',
            tooltip: {
                background: 'rgb(160, 30, 30)',
                color     : 'rgb(255, 220, 220)',
                border    : 'rgb(120, 20, 20)',
            },
        },
    },
    autoComplete: {
        background: 'rgb(45, 45, 45)',
        border    : 'rgb(80, 80, 80)',
        shadow    : '2px 4px 8px rgba(0,0,0,0.5)',
        item: {
            hoverBackground    : 'rgba(100, 140, 220, 0.12)',
            highlightBackground: 'rgba(100, 140, 220, 0.28)',
            highlightColor     : 'rgb(220, 220, 255)',
            disabledColor      : 'rgb(100, 100, 100)',
        },
    },
    // Dark defaults track `autoComplete` for the same hover/selected hues so
    // the row chrome stays consistent across the two popover surfaces.
    list: {
        background: 'rgb(40, 40, 40)',
        border    : 'rgb(80, 80, 80)',
        row: {
            hoverBackground   : 'rgba(100, 140, 220, 0.12)',
            selectedBackground: 'rgba(100, 140, 220, 0.28)',
            selectedColor     : 'rgb(220, 220, 255)',
            focusRing         : 'rgb(120, 170, 240)',
            disabledColor     : 'rgb(100, 100, 100)',
            separator         : 'transparent',
        },
    },
    indicator: {
        focus    : 'rgb(120, 170, 240)',
        selection: '1px dashed rgb(120, 170, 240)',
    },
    // Dark picker tokens follow the dark `autoComplete.item.*` hue family for
    // chevron-hover consistency with cell hover.
    picker: {
        navForeground:          'var(--ts-ui-text-color)',
        navHoverBackground:     'rgba(120, 170, 255, 0.12)',
        cellDisabledBackground: 'transparent',
    },
    dialog: {
        backdrop: { background: 'rgba(0, 0, 0, 0.65)' },
        border  : 'rgb(70, 70, 70)',
        shadow  : '4px 8px 24px rgba(0, 0, 0, 0.6)',
        confirm : 'rgb(80, 200, 110)',
        cancel  : 'rgb(220, 90, 90)',
        info    : { background: 'rgba(30, 100, 200, 0.25)', foreground: 'rgb(60, 130, 220)' },
        affirm  : { background: 'rgba(80, 200, 110, 0.25)', foreground: 'rgb(80, 200, 110)' },
    },
    drawer: {
        background: 'var(--ts-ui-body-bg)',
        shadow    : '4px 0 24px rgba(0, 0, 0, 0.55)',
        border    : 'rgb(70, 70, 70)',
    },
    spinner: {
        dividerColor: 'rgb(80, 80, 80)',
    },
    progressBar: {
        track        : { background: 'rgb(55, 55, 55)' },
        fill         : { background: 'rgb(60, 130, 220)' },
        indeterminate: { background: 'rgb(60, 130, 220)' },
    },
    progressSpinner: {
        color   : 'rgb(60, 130, 220)',
        backdrop: 'rgba(20, 20, 20, 0.6)',
    },
    drag: {
        ghost: {
            background: 'rgba(60, 60, 60, 0.9)',
            border    : 'rgb(100, 100, 100)',
            shadow    : '2px 4px 12px rgba(0, 0, 0, 0.6)',
        },
        feedback: {
            valid  : { background: 'rgba(30, 180, 80, 0.2)',  border: 'rgb(30, 180, 80)'  },
            invalid: { background: 'rgba(200, 50, 50, 0.18)', border: 'rgb(200, 50, 50)' },
        },
        reorderIndicator: {
            color: 'rgb(80, 140, 240)',
        },
        dropzone: {
            background      : 'rgba(80, 140, 240, 0.12)',
            border          : 'rgba(80, 140, 240, 0.45)',
            activeBackground: 'rgba(80, 140, 240, 0.32)',
        },
    },
    scroll: {
        shadowColor: 'rgba(0, 0, 0, 1)',
    },
});
