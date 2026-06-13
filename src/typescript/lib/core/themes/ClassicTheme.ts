// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BaseTheme } from '~/core/themes/BaseTheme.js';
import { defineTheme } from '~/core/Theme.js';
import type { Theme } from '~/core/Theme.js';

/**
 * Classic light theme using white backgrounds, black text, and gradient
 * buttons. The original default look, retained as an opt-in alternative now
 * that {@link ModernTheme} is the preselected theme.
 *
 * Authored as `defineTheme(BaseTheme, …)`: it declares only its palette (and
 * `colorScheme`); every structural token is inherited from {@link BaseTheme}.
 * Classic carries no structural override — its `header.padding` and
 * `tab.underBorderFullWidth` already match the base majority.
 *
 * @category Theme
 */
export const ClassicTheme: Theme = defineTheme(BaseTheme, {
    colorScheme: 'light',
    text       : { color: 'rgb(0, 0, 0)' },
    body       : { background: 'rgb(255, 255, 255)' },
    border     : { color: 'black' },
    button     : {
        background: 'linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))',
        border    : 'rgb(200, 200, 200)',
        shadow    : '1px 2px 5px 0 rgba(0, 0, 0, 0.2)',
        description: {
            foreground: 'rgb(110, 110, 110)',
        },
        pressed   : {
            foreground: 'rgb(150, 150, 150)',
            background: 'linear-gradient(rgb(200, 200, 200), rgb(214, 214, 214))',
            shadow    : 'inset 0 1px 4px rgba(0, 0, 0, 0.30)',
        },
        hover     : {
            foreground: 'inherit',
            background: 'linear-gradient(rgb(252, 252, 252), rgb(220, 220, 220))',
            shadow    : '1px 3px 6px 0 rgba(0, 0, 0, 0.25)',
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
        header   : {
            background: 'linear-gradient(rgb(230,230,230),rgb(210,210,210))',
            border    : 'rgb(190,190,190)',
            color     : 'inherit',
        },
        panel    : { border: 'rgb(210,210,210)' },
        indicator: { color: 'rgb(100,100,100)' },
    },
    tab   : {
        toolbar: { background: '#eee',     border: '#e1e1e8' },
        button : {
            background: 'linear-gradient(rgb(208, 208, 216), rgb(185, 185, 196))',
            border    : 'none',
            hover     : { background: 'linear-gradient(rgb(220, 220, 227), rgb(198, 198, 208))', border: 'none' },
            selected  : { background: 'linear-gradient(rgb(255, 255, 255), rgb(235, 235, 240))', border: 'none' },
        },
        indicator: { color: '#1a73e8' },
    },
    window: {
        shadow      : '3px 3px 2px rgba(0, 0, 0, 0.4)',
        snapGlow    : '0 0 0 2px rgba(30, 100, 200, 0.7)',
        control     : {
            background      : 'linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))',
            border          : '1px solid rgb(200, 200, 200)',
            shadow          : '1px 2px 5px 0 rgba(0, 0, 0, 0.2)',
            hoverBackground : 'linear-gradient(rgb(252, 252, 252), rgb(220, 220, 220))',
            activeBackground: 'linear-gradient(rgb(200, 200, 200), rgb(214, 214, 214))',
        },
    },
    table : {
        header: {
            background: 'linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))',
            border: 'black',
            glyph : { color: 'currentColor' },
        },
        row   : {
            selected      : 'rgba(30, 100, 200, 0.15)',
            selectedBorder: 'inset 0 0 0 1px rgba(30, 100, 200, 0.6)',
            new           : 'rgba(70, 200, 70, 0.15)',
            dirty         : 'rgba(255, 165, 0, 0.15)',
        },
        cell  : {
            background        : 'transparent',
            readonlyBackground: 'rgba(0, 0, 0, 0.04)',
            color             : 'inherit',
            border            : 'none',
            editorBorderColor : 'rgba(30, 100, 200, 0.6)',
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
    },
    toolBar: {
        background    : 'transparent',
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
    // Defaults mirror `autoComplete` numerically because both surfaces present
    // selectable rows; a theme that customises one gets the other matching
    // automatically. `row.separator` defaults to `transparent` so the visual
    // matches the prior native `<select>` (no row hairlines); themes can opt
    // in to a denser look by overriding to a `1px solid rgba(...)` colour.
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
    // Picker tokens stay numerically in step with `autoComplete.item.*` — they
    // share the {@link PickerCell} class — so a theme that customises one
    // gets the other matching automatically.
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
        background: 'var(--ts-ui-body-bg)',
        shadow    : '4px 0 24px rgba(0, 0, 0, 0.25)',
        border    : 'rgb(220, 220, 220)',
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
            background      : 'rgba(80, 140, 240, 0.10)',
            border          : 'rgba(80, 140, 240, 0.40)',
            activeBackground: 'rgba(80, 140, 240, 0.28)',
        },
    },
    scroll: {
        shadowColor: 'rgba(0, 0, 0, 1)',
    },
});
