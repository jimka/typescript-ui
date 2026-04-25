// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CSS } from './CSS.js';

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
}

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
};

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
};

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

export class ThemeManager {
    private static current: Theme = DefaultTheme;

    static setTheme(theme: Theme) {
        ThemeManager.current = theme;
        CSS.setRootVariables(themeToVars(theme));
        document.body.style.backgroundColor = theme.bodyBg;
        document.body.style.color = theme.textColor;
    }

    static getTheme(): Theme {
        return ThemeManager.current;
    }
}
