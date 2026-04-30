// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CSS } from './CSS.js';

/**
 * Defines the full set of color tokens that make up a UI theme.
 */
export interface Theme {
    textColor           : string;
    bodyBg              : string;
    buttonBorderColor   : string;
    buttonBgTop         : string;
    buttonBgBottom      : string;
    buttonShadow        : string;
    buttonPressedFg     : string;
    buttonPressedBg     : string;
    buttonPressedShadow : string;
    toggleSelectedShadow: string;
    toggleSelectedBg    : string;
    inputBg             : string;
    borderColor         : string;
    gutterBg            : string;
    tabToolbarBg        : string;
    tabToolbarBorder    : string;
    tabButtonBg         : string;
    tableHeaderBorder   : string;
    colorScheme         : string;
}

/**
 * Light-mode theme using white backgrounds and black text.
 */
export const DefaultTheme: Theme = {
    textColor           : 'rgb(0, 0, 0)',
    bodyBg              : 'rgb(255, 255, 255)',
    buttonBorderColor   : 'rgb(200, 200, 200)',
    buttonBgTop         : 'rgb(241, 241, 241)',
    buttonBgBottom      : 'rgb(200, 200, 200)',
    buttonShadow        : '1px 2px 5px 0 rgba(0, 0, 0, 0.2)',
    buttonPressedFg     : 'rgb(150, 150, 150)',
    buttonPressedBg     : 'rgb(200, 200, 200)',
    buttonPressedShadow : '1px 2px 5px 0 rgba(0, 0, 0, 0.2) inset',
    toggleSelectedShadow: '2px 2px 1px inset grey',
    toggleSelectedBg    : 'rgb(200, 200, 200)',
    inputBg             : 'rgb(255, 255, 255)',
    borderColor         : 'black',
    gutterBg            : '#AAAAAA',
    tabToolbarBg        : '#eee',
    tabToolbarBorder    : '#e1e1e8',
    tabButtonBg         : '#b8b8c3',
    tableHeaderBorder   : 'black',
    colorScheme         : 'light',
};

/**
 * Dark-mode theme using dark backgrounds and light text.
 */
export const DarkTheme: Theme = {
    textColor           : 'rgb(220, 220, 220)',
    bodyBg              : 'rgb(30, 30, 30)',
    buttonBorderColor   : 'rgb(80, 80, 80)',
    buttonBgTop         : 'rgb(70, 70, 70)',
    buttonBgBottom      : 'rgb(50, 50, 50)',
    buttonShadow        : '1px 2px 5px 0 rgba(0, 0, 0, 0.5)',
    buttonPressedFg     : 'rgb(180, 180, 180)',
    buttonPressedBg     : 'rgb(35, 35, 35)',
    buttonPressedShadow : '1px 2px 5px 0 rgba(0, 0, 0, 0.5) inset',
    toggleSelectedShadow: '2px 2px 1px inset #333',
    toggleSelectedBg    : 'rgb(35, 35, 35)',
    inputBg             : 'rgb(40, 40, 40)',
    borderColor         : 'rgb(90, 90, 90)',
    gutterBg            : '#555',
    tabToolbarBg        : '#2a2a2a',
    tabToolbarBorder    : '#444',
    tabButtonBg         : '#3a3a3a',
    tableHeaderBorder   : '#555',
    colorScheme         : 'dark',
};

/**
 * Converts a Theme object into a map of CSS custom property names to values.
 *
 * @param theme - The theme whose token values should be converted.
 *
 * @returns A record mapping `--ts-ui-*` CSS variable names to their corresponding theme values.
 */
function themeToVars(theme: Theme): Record<string, string> {
    return {
        '--ts-ui-text-color'            : theme.textColor,
        '--ts-ui-body-bg'               : theme.bodyBg,
        '--ts-ui-button-border'         : theme.buttonBorderColor,
        '--ts-ui-button-bg-top'         : theme.buttonBgTop,
        '--ts-ui-button-bg-bottom'      : theme.buttonBgBottom,
        '--ts-ui-button-shadow'         : theme.buttonShadow,
        '--ts-ui-button-pressed-fg'     : theme.buttonPressedFg,
        '--ts-ui-button-pressed-bg'     : theme.buttonPressedBg,
        '--ts-ui-button-pressed-shadow' : theme.buttonPressedShadow,
        '--ts-ui-toggle-selected-shadow': theme.toggleSelectedShadow,
        '--ts-ui-toggle-selected-bg'    : theme.toggleSelectedBg,
        '--ts-ui-input-bg'              : theme.inputBg,
        '--ts-ui-border-color'          : theme.borderColor,
        '--ts-ui-gutter-bg'             : theme.gutterBg,
        '--ts-ui-tab-toolbar-bg'        : theme.tabToolbarBg,
        '--ts-ui-tab-toolbar-border'    : theme.tabToolbarBorder,
        '--ts-ui-tab-button-bg'         : theme.tabButtonBg,
        '--ts-ui-table-header-border'   : theme.tableHeaderBorder,
    };
}

/**
 * Singleton manager that applies a theme by writing CSS custom properties and
 * inline styles onto the document root and body elements.
 */
export class ThemeManager {
    private static current: Theme = DefaultTheme;

    /**
     * Applies a theme by writing CSS variables onto `:root` and updating body/html styles.
     *
     * @param theme - The theme object to activate.
     *
     * @remarks Sets `document.documentElement.style.colorScheme`, `color`, and
     * `document.body.style.backgroundColor` / `color` in addition to the CSS custom properties,
     * so both CSS-variable consumers and direct inline-style consumers are updated.
     */
    static setTheme(theme: Theme) {
        ThemeManager.current = theme;

        CSS.setRootVariables(themeToVars(theme));

        document.documentElement.style.colorScheme = theme.colorScheme;
        document.documentElement.style.color       = theme.textColor;
        document.body.style.backgroundColor        = theme.bodyBg;
        document.body.style.color                  = theme.textColor;
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
