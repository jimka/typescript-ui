// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CSS } from './CSS.js';

/**
 * Defines the full set of design tokens that make up a UI theme.
 *
 * Background tokens (e.g. `button.bg`, `button.pressed.bg`, `toggle.selected.bg`) accept any
 * CSS `background-image` value such as a gradient, or any CSS `background-color` value such as
 * a plain colour. The framework applies the same variable to both `background-color` and
 * `background-image`, so CSS's "invalid at computed-value time" rule routes automatically:
 * a plain colour takes effect via `background-color`; a gradient via `background-image`.
 */
export interface Theme {
    colorScheme: string;

    font: {
        family: string;
        size  : string;
    };

    text: {
        color: string;
    };

    body: {
        background: string;
    };

    border: {
        color : string;
        radius: string;
    };

    button: {
        background: string;
        border    : string;
        shadow    : string;
        padding   : string;
        font: {
            size: string;
        };
        pressed: {
            foreground: string;
            background: string;
            shadow    : string;
        };
    };

    toggle: {
        selected: {
            background: string;
            shadow    : string;
        };
    };

    input: {
        background: string;
    };

    gutter: {
        background: string;
    };

    tab: {
        toolbar: {
            background: string;
            border    : string;
        };
        button: {
            background: string;
        };
    };

    window: {
        shadow: string;
    };

    header: {
        font: {
            size: string;
        };
        padding: number;
    };

    table: {
        header: {
            border: string;
            font: {
                size: string;
            };
        };
        row: {
            selected      : string;
            selectedBorder: string;
            new           : string;
            dirty         : string;
        };
        cell: {
            height           : string;
            padding          : number;
            background       : string;
            color            : string;
            border           : string;
            editorBorderColor: string;
        };
    };
}

/**
 * Light-mode theme using white backgrounds and black text.
 */
export const DefaultTheme: Theme = {
    colorScheme: 'light',
    font       : { family: 'system-ui, sans-serif', size: '14px' },
    text       : { color: 'rgb(0, 0, 0)' },
    body       : { background: 'rgb(255, 255, 255)' },
    border     : { color: 'black',                 radius: '4px' },
    button     : {
        background: 'linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))',
        border    : 'rgb(200, 200, 200)',
        shadow    : '1px 2px 5px 0 rgba(0, 0, 0, 0.2)',
        padding   : '0',
        font      : { size: '12px' },
        pressed   : {
            foreground: 'rgb(150, 150, 150)',
            background: 'rgb(200, 200, 200)',
            shadow    : '1px 2px 5px 0 rgba(0, 0, 0, 0.2) inset',
        },
    },
    toggle      : {
        selected: {
            background: 'rgb(200, 200, 200)',
            shadow    : '2px 2px 1px inset grey',
        },
    },
    input : { background: 'rgb(255, 255, 255)' },
    gutter: { background: '#AAAAAA' },
    tab   : {
        toolbar: { background: '#eee',     border: '#e1e1e8' },
        button : { background: '#b8b8c3' },
    },
    window: { shadow: '3px 3px 2px rgba(0, 0, 0, 0.4)' },
    header: { font: { size: '12px' }, padding: 4 },
    table : {
        header: { border: 'black', font: { size: '13px' } },
        row   : {
            selected      : 'rgba(30, 100, 200, 0.15)',
            selectedBorder: 'inset 0 0 0 1px rgba(30, 100, 200, 0.6)',
            new           : 'rgba(70, 200, 70, 0.15)',
            dirty         : 'rgba(255, 165, 0, 0.15)',
        },
        cell  : {
            height           : '22px',
            padding          : 2,
            background       : 'transparent',
            color            : 'inherit',
            border           : 'none',
            editorBorderColor: 'rgba(30, 100, 200, 0.6)',
        },
    },
};

/**
 * Dark-mode theme using dark backgrounds and light text.
 */
export const DarkTheme: Theme = {
    colorScheme: 'dark',
    font       : { family: 'system-ui, sans-serif', size: '14px' },
    text       : { color: 'rgb(220, 220, 220)' },
    body       : { background: 'rgb(30, 30, 30)' },
    border     : { color: 'rgb(90, 90, 90)',        radius: '4px' },
    button     : {
        background: 'linear-gradient(rgb(70, 70, 70), rgb(50, 50, 50))',
        border    : 'rgb(80, 80, 80)',
        shadow    : '1px 2px 5px 0 rgba(0, 0, 0, 0.5)',
        padding   : '0',
        font      : { size: '12px' },
        pressed   : {
            foreground: 'rgb(180, 180, 180)',
            background: 'rgb(35, 35, 35)',
            shadow    : '1px 2px 5px 0 rgba(0, 0, 0, 0.5) inset',
        },
    },
    toggle      : {
        selected: {
            background: 'rgb(35, 35, 35)',
            shadow    : '2px 2px 1px inset #333',
        },
    },
    input : { background: 'rgb(40, 40, 40)' },
    gutter: { background: '#555' },
    tab   : {
        toolbar: { background: '#2a2a2a', border: '#444' },
        button : { background: '#3a3a3a' },
    },
    window    : { shadow: '3px 3px 2px rgba(0, 0, 0, 0.6)' },
    header    : { font: { size: '12px' }, padding: 4 },
    table     : {
        header: { border: '#555', font: { size: '13px' } },
        row   : {
            selected      : 'rgba(30, 100, 200, 0.25)',
            selectedBorder: 'inset 0 0 0 1px rgba(30, 100, 200, 0.8)',
            new           : 'rgba(70, 200, 70, 0.2)',
            dirty         : 'rgba(255, 165, 0, 0.2)',
        },
        cell  : {
            height           : '22px',
            padding          : 2,
            background       : 'transparent',
            color            : 'inherit',
            border           : 'none',
            editorBorderColor: 'rgba(30, 100, 200, 0.8)',
        },
    },
};

/**
 * Converts a Theme object into a map of CSS custom property names to values.
 */
function themeToVars(theme: Theme): Record<string, string> {
    return {
        '--ts-ui-font-family'           : theme.font.family,
        '--ts-ui-font-size'             : theme.font.size,
        '--ts-ui-text-color'            : theme.text.color,
        '--ts-ui-body-bg'               : theme.body.background,
        '--ts-ui-border-color'          : theme.border.color,
        '--ts-ui-border-radius'         : theme.border.radius,
        '--ts-ui-button-bg'             : theme.button.background,
        '--ts-ui-button-border'         : theme.button.border,
        '--ts-ui-button-shadow'         : theme.button.shadow,
        '--ts-ui-button-padding'        : theme.button.padding,
        '--ts-ui-button-font-size'      : theme.button.font.size,
        '--ts-ui-button-pressed-fg'     : theme.button.pressed.foreground,
        '--ts-ui-button-pressed-bg'     : theme.button.pressed.background,
        '--ts-ui-button-pressed-shadow' : theme.button.pressed.shadow,
        '--ts-ui-toggle-selected-bg'    : theme.toggle.selected.background,
        '--ts-ui-toggle-selected-shadow': theme.toggle.selected.shadow,
        '--ts-ui-input-bg'              : theme.input.background,
        '--ts-ui-gutter-bg'             : theme.gutter.background,
        '--ts-ui-tab-toolbar-bg'        : theme.tab.toolbar.background,
        '--ts-ui-tab-toolbar-border'    : theme.tab.toolbar.border,
        '--ts-ui-tab-button-bg'         : theme.tab.button.background,
        '--ts-ui-window-shadow'              : theme.window.shadow,
        '--ts-ui-header-font-size'           : theme.header.font.size,
        '--ts-ui-table-header-border'        : theme.table.header.border,
        '--ts-ui-table-header-font-size'     : theme.table.header.font.size,
        '--ts-ui-table-row-selected'         : theme.table.row.selected,
        '--ts-ui-table-row-selected-border'  : theme.table.row.selectedBorder,
        '--ts-ui-table-row-new'              : theme.table.row.new,
        '--ts-ui-table-row-dirty'            : theme.table.row.dirty,
        '--ts-ui-table-cell-height'           : theme.table.cell.height,
        '--ts-ui-table-cell-bg'              : theme.table.cell.background,
        '--ts-ui-table-cell-color'           : theme.table.cell.color,
        '--ts-ui-table-cell-border'          : theme.table.cell.border,
        '--ts-ui-table-cell-editor-border'   : theme.table.cell.editorBorderColor,
        '--ts-ui-color-scheme'               : theme.colorScheme,
    };
}

/**
 * Singleton manager that applies a theme by writing CSS custom properties and
 * inline styles onto the document root and body elements.
 */
export class ThemeManager {
    private static current: Theme = DefaultTheme;
    private static themeListeners: Array<() => void> = [];

    /**
     * Subscribes a listener that is called whenever the active theme changes.
     *
     * @param listener - Called after CSS variables have been updated, so `getComputedStyle` returns new values.
     * @returns A cleanup function that removes the listener when called.
     */
    static onThemeChange(listener: () => void): () => void {
        ThemeManager.themeListeners.push(listener);
        return () => {
            ThemeManager.themeListeners = ThemeManager.themeListeners.filter(l => l !== listener);
        };
    }

    /**
     * Applies a theme by writing CSS variables onto `:root` and updating body/html styles.
     *
     * @param theme - The theme object to activate.
     *
     * @remarks Sets `document.documentElement.style.colorScheme`, `color`, `fontFamily`,
     * `fontSize`, and `document.body.style.backgroundColor` / `color` in addition to the CSS
     * custom properties, so both CSS-variable consumers and direct inline-style consumers
     * are updated. `<html>` is targeted (in addition to `<body>`) because `Window` components
     * are appended to `document.documentElement`, so text in floating windows must inherit
     * from `<html>`.
     */
    static setTheme(theme: Theme) {
        ThemeManager.current = theme;

        CSS.setRootVariables(themeToVars(theme));

        document.documentElement.style.colorScheme = theme.colorScheme;
        document.documentElement.style.color       = theme.text.color;
        document.documentElement.style.fontFamily  = theme.font.family;
        document.documentElement.style.fontSize    = theme.font.size;
        document.body.style.backgroundColor        = theme.body.background;
        document.body.style.color                  = theme.text.color;

        ThemeManager.themeListeners.forEach(l => l());
    }

    /**
     * Returns the currently active theme.
     *
     * @returns The `Theme` object that was last passed to `setTheme`, defaulting to `DefaultTheme`.
     */
    static getTheme(): Theme {
        return ThemeManager.current;
    }
}
