// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CSS } from '~/core/CSS.js';
import { Util } from '~/core/Util.js';

/**
 * Defines the full set of design tokens that make up a UI theme.
 *
 * Background tokens (e.g. `button.bg`, `button.pressed.bg`, `toggle.selected.bg`) accept any
 * CSS `background-image` value such as a gradient, or any CSS `background-color` value such as
 * a plain colour. The framework applies the same variable to both `background-color` and
 * `background-image`, so CSS's "invalid at computed-value time" rule routes automatically:
 * a plain colour takes effect via `background-color`; a gradient via `background-image`.
 *
 * @category Theme
 */
export interface Theme {
    colorScheme: string;

    font: {
        family    : string;
        size      : string;
        /**
         * Unitless multiplier of the current font size. CSS treats a unitless
         * `line-height` as "this many times the element's own font-size", so
         * the value scales automatically when the font size changes. Typical
         * UI values are around 1.2 (compact) to 1.5 (loose).
         */
        lineHeight: number;
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

    contextMenu: {
        background: string;
        border    : string;
        shadow    : string;
        item: {
            hoverBackground: string;
            disabledColor  : string;
        };
        separatorColor: string;
    };

    menuBar: {
        background: string;
        border    : string;
        button: {
            background     : string;
            hoverBackground: string;
            foreground     : string;
        };
        panel: {
            background: string;
            border    : string;
            shadow    : string;
            minWidth  : string;
        };
        item: {
            hoverBackground: string;
            disabledColor  : string;
            shortcutColor  : string;
        };
        separatorColor: string;
    };

    tooltip: {
        background: string;
        color     : string;
        border    : string;
        shadow    : string;
    };

    notification: {
        shadow : string;
        info: {
            background: string;
            border    : string;
        };
        success: {
            background: string;
            border    : string;
        };
        warning: {
            background: string;
            border    : string;
        };
        error: {
            background: string;
            border    : string;
        };
    };

    dialog: {
        backdrop: {
            background: string;
        };
        border: string;
        shadow: string;
    };

    accordion: {
        header: {
            background: string;
            border    : string;
            color     : string;
        };
        panel: {
            border: string;
        };
        indicator: {
            color: string;
        };
    };

    validation: {
        error: {
            border : string;
            tooltip: {
                background: string;
                color     : string;
                border    : string;
            };
        };
    };

    autoComplete: {
        background: string;
        border    : string;
        shadow    : string;
        item: {
            hoverBackground    : string;
            highlightBackground: string;
            highlightColor     : string;
            disabledColor      : string;
        };
    };

    spinner: {
        buttonWidth : string;
        dividerColor: string;
    };

    progressBar: {
        track: {
            background  : string;
            borderRadius: string;
        };
        fill: {
            background: string;
        };
        indeterminate: {
            background: string;
        };
    };

    progressSpinner: {
        color   : string;
        backdrop: string;
        size    : string;
    };
}

/**
 * Light-mode theme using white backgrounds and black text.
 *
 * @category Theme
 */
export const DefaultTheme: Theme = {
    colorScheme: 'light',
    font       : { family: 'system-ui, sans-serif', size: '14px', lineHeight: 1.2 },
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
        button : { background: '#b8b8c3' },
    },
    window: { shadow: '3px 3px 2px rgba(0, 0, 0, 0.4)' },
    header: { font: { size: '12px' }, padding: 5 },
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
    tooltip: {
        background: 'rgb(255, 255, 240)',
        color     : 'rgb(0, 0, 0)',
        border    : 'rgb(180, 180, 100)',
        shadow    : '1px 2px 4px rgba(0, 0, 0, 0.2)',
    },
    notification: {
        shadow : '2px 4px 8px rgba(0, 0, 0, 0.15)',
        info   : { background: 'rgba(30, 100, 200, 0.1)',  border: 'rgb(30, 100, 200)'  },
        success: { background: 'rgba(30, 180, 80, 0.1)',   border: 'rgb(30, 180, 80)'   },
        warning: { background: 'rgba(220, 140, 0, 0.1)',   border: 'rgb(220, 140, 0)'   },
        error  : { background: 'rgba(200, 50, 50, 0.1)',   border: 'rgb(200, 50, 50)'   },
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
    dialog: {
        backdrop: { background: 'rgba(0, 0, 0, 0.45)' },
        border  : 'rgb(220, 220, 220)',
        shadow  : '4px 8px 24px rgba(0, 0, 0, 0.35)',
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
};

/**
 * Dark-mode theme using dark backgrounds and light text.
 *
 * @category Theme
 */
export const DarkTheme: Theme = {
    colorScheme: 'dark',
    font       : { family: 'system-ui, sans-serif', size: '14px', lineHeight: 1.2 },
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
            minWidth  : '160px',
        },
        item          : {
            hoverBackground: 'rgba(100, 140, 220, 0.2)',
            disabledColor  : 'rgb(100, 100, 100)',
            shortcutColor  : 'rgb(140, 140, 140)',
        },
        separatorColor: 'rgb(70, 70, 70)',
    },
    tooltip: {
        background: 'rgb(60, 60, 45)',
        color     : 'rgb(220, 220, 180)',
        border    : 'rgb(120, 110, 70)',
        shadow    : '1px 2px 4px rgba(0, 0, 0, 0.5)',
    },
    notification: {
        shadow : '2px 4px 8px rgba(0, 0, 0, 0.4)',
        info   : { background: 'rgba(30, 100, 200, 0.2)',  border: 'rgb(30, 100, 200)'  },
        success: { background: 'rgba(30, 180, 80, 0.2)',   border: 'rgb(30, 180, 80)'   },
        warning: { background: 'rgba(220, 140, 0, 0.2)',   border: 'rgb(220, 140, 0)'   },
        error  : { background: 'rgba(200, 50, 50, 0.2)',   border: 'rgb(200, 50, 50)'   },
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
    dialog: {
        backdrop: { background: 'rgba(0, 0, 0, 0.65)' },
        border  : 'rgb(70, 70, 70)',
        shadow  : '4px 8px 24px rgba(0, 0, 0, 0.6)',
    },
    spinner: {
        buttonWidth : '18px',
        dividerColor: 'rgb(80, 80, 80)',
    },
    progressBar: {
        track        : { background: 'rgb(55, 55, 55)',  borderRadius: '4px' },
        fill         : { background: 'rgb(60, 130, 220)' },
        indeterminate: { background: 'rgb(60, 130, 220)' },
    },
    progressSpinner: {
        color   : 'rgb(60, 130, 220)',
        backdrop: 'rgba(20, 20, 20, 0.6)',
        size    : '32px',
    },
};

/**
 * Converts a Theme object into a map of CSS custom property names to values.
 */
function themeToVars(theme: Theme): Record<string, string> {
    return {
        '--ts-ui-font-family'                      : theme.font.family,
        '--ts-ui-font-size'                        : theme.font.size,
        '--ts-ui-line-height'                      : String(theme.font.lineHeight),
        '--ts-ui-text-color'                       : theme.text.color,
        '--ts-ui-body-bg'                          : theme.body.background,
        '--ts-ui-border-color'                     : theme.border.color,
        '--ts-ui-border-radius'                    : theme.border.radius,
        '--ts-ui-button-bg'                        : theme.button.background,
        '--ts-ui-button-border'                    : theme.button.border,
        '--ts-ui-button-shadow'                    : theme.button.shadow,
        '--ts-ui-button-padding'                   : theme.button.padding,
        '--ts-ui-button-font-size'                 : theme.button.font.size,
        '--ts-ui-button-pressed-fg'                : theme.button.pressed.foreground,
        '--ts-ui-button-pressed-bg'                : theme.button.pressed.background,
        '--ts-ui-button-pressed-shadow'            : theme.button.pressed.shadow,
        '--ts-ui-toggle-selected-bg'               : theme.toggle.selected.background,
        '--ts-ui-toggle-selected-shadow'           : theme.toggle.selected.shadow,
        '--ts-ui-input-bg'                         : theme.input.background,
        '--ts-ui-gutter-bg'                        : theme.gutter.background,
        '--ts-ui-accordion-header-bg'              : theme.accordion.header.background,
        '--ts-ui-accordion-header-border'          : theme.accordion.header.border,
        '--ts-ui-accordion-header-color'           : theme.accordion.header.color,
        '--ts-ui-accordion-panel-border'           : theme.accordion.panel.border,
        '--ts-ui-accordion-indicator-color'        : theme.accordion.indicator.color,
        '--ts-ui-tab-toolbar-bg'                   : theme.tab.toolbar.background,
        '--ts-ui-tab-toolbar-border'               : theme.tab.toolbar.border,
        '--ts-ui-tab-button-bg'                    : theme.tab.button.background,
        '--ts-ui-window-shadow'                    : theme.window.shadow,
        '--ts-ui-header-font-size'                 : theme.header.font.size,
        '--ts-ui-table-header-border'              : theme.table.header.border,
        '--ts-ui-table-header-font-size'           : theme.table.header.font.size,
        '--ts-ui-table-row-selected'               : theme.table.row.selected,
        '--ts-ui-table-row-selected-border'        : theme.table.row.selectedBorder,
        '--ts-ui-table-row-new'                    : theme.table.row.new,
        '--ts-ui-table-row-dirty'                  : theme.table.row.dirty,
        '--ts-ui-table-cell-height'                : theme.table.cell.height,
        '--ts-ui-table-cell-bg'                    : theme.table.cell.background,
        '--ts-ui-table-cell-color'                 : theme.table.cell.color,
        '--ts-ui-table-cell-border'                : theme.table.cell.border,
        '--ts-ui-table-cell-editor-border'         : theme.table.cell.editorBorderColor,
        '--ts-ui-color-scheme'                     : theme.colorScheme,
        '--ts-ui-context-menu-bg'                  : theme.contextMenu.background,
        '--ts-ui-context-menu-border'              : theme.contextMenu.border,
        '--ts-ui-context-menu-shadow'              : theme.contextMenu.shadow,
        '--ts-ui-context-menu-item-hover-bg'       : theme.contextMenu.item.hoverBackground,
        '--ts-ui-context-menu-item-disabled-color' : theme.contextMenu.item.disabledColor,
        '--ts-ui-context-menu-separator-color'     : theme.contextMenu.separatorColor,
        '--ts-ui-tooltip-bg'                       : theme.tooltip.background,
        '--ts-ui-tooltip-color'                    : theme.tooltip.color,
        '--ts-ui-tooltip-border'                   : theme.tooltip.border,
        '--ts-ui-tooltip-shadow'                   : theme.tooltip.shadow,
        '--ts-ui-notification-shadow'              : theme.notification.shadow,
        '--ts-ui-notification-info-bg'             : theme.notification.info.background,
        '--ts-ui-notification-info-border'         : theme.notification.info.border,
        '--ts-ui-notification-success-bg'          : theme.notification.success.background,
        '--ts-ui-notification-success-border'      : theme.notification.success.border,
        '--ts-ui-notification-warning-bg'          : theme.notification.warning.background,
        '--ts-ui-notification-warning-border'      : theme.notification.warning.border,
        '--ts-ui-notification-error-bg'            : theme.notification.error.background,
        '--ts-ui-notification-error-border'        : theme.notification.error.border,
        '--ts-ui-validation-error-border'          : theme.validation.error.border,
        '--ts-ui-validation-error-tooltip-bg'      : theme.validation.error.tooltip.background,
        '--ts-ui-validation-error-tooltip-color'   : theme.validation.error.tooltip.color,
        '--ts-ui-validation-error-tooltip-border'  : theme.validation.error.tooltip.border,
        '--ts-ui-autocomplete-bg'                  : theme.autoComplete.background,
        '--ts-ui-autocomplete-border'              : theme.autoComplete.border,
        '--ts-ui-autocomplete-shadow'              : theme.autoComplete.shadow,
        '--ts-ui-autocomplete-item-hover-bg'       : theme.autoComplete.item.hoverBackground,
        '--ts-ui-autocomplete-item-highlight-bg'   : theme.autoComplete.item.highlightBackground,
        '--ts-ui-autocomplete-item-highlight-color': theme.autoComplete.item.highlightColor,
        '--ts-ui-autocomplete-item-disabled-color' : theme.autoComplete.item.disabledColor,
        '--ts-ui-menu-bar-bg'                      : theme.menuBar.background,
        '--ts-ui-menu-bar-border'                  : theme.menuBar.border,
        '--ts-ui-menu-bar-btn-bg'                  : theme.menuBar.button.background,
        '--ts-ui-menu-bar-btn-hover-bg'            : theme.menuBar.button.hoverBackground,
        '--ts-ui-menu-bar-btn-fg'                  : theme.menuBar.button.foreground,
        '--ts-ui-menu-bar-panel-bg'                : theme.menuBar.panel.background,
        '--ts-ui-menu-bar-panel-border'            : theme.menuBar.panel.border,
        '--ts-ui-menu-bar-panel-shadow'            : theme.menuBar.panel.shadow,
        '--ts-ui-menu-bar-panel-min-width'         : theme.menuBar.panel.minWidth,
        '--ts-ui-menu-bar-item-hover-bg'           : theme.menuBar.item.hoverBackground,
        '--ts-ui-menu-bar-item-disabled-color'     : theme.menuBar.item.disabledColor,
        '--ts-ui-menu-bar-item-shortcut-color'     : theme.menuBar.item.shortcutColor,
        '--ts-ui-menu-bar-separator-color'         : theme.menuBar.separatorColor,
        '--ts-ui-dialog-backdrop-bg'               : theme.dialog.backdrop.background,
        '--ts-ui-dialog-border'                    : theme.dialog.border,
        '--ts-ui-dialog-shadow'                    : theme.dialog.shadow,
        '--ts-ui-spinner-btn-width'                : theme.spinner.buttonWidth,
        '--ts-ui-spinner-divider'                  : theme.spinner.dividerColor,
        '--ts-ui-progress-track-bg'                : theme.progressBar.track.background,
        '--ts-ui-progress-track-radius'            : theme.progressBar.track.borderRadius,
        '--ts-ui-progress-fill-bg'                 : theme.progressBar.fill.background,
        '--ts-ui-progress-indeterminate-bg'        : theme.progressBar.indeterminate.background,
        '--ts-ui-progress-spinner-color'           : theme.progressSpinner.color,
        '--ts-ui-progress-spinner-backdrop'        : theme.progressSpinner.backdrop,
        '--ts-ui-progress-spinner-size'            : theme.progressSpinner.size,
    };
}

/**
 * Singleton manager that applies a theme by writing CSS custom properties and
 * inline styles onto the document root and body elements.
 *
 * @example
 * ```typescript
 * import { ThemeManager, DefaultTheme, DarkTheme } from '@jimka/typescript-ui/core';
*
 * ThemeManager.setTheme(DefaultTheme); // light
 * ThemeManager.setTheme(DarkTheme);    // dark
 * ```
 *
 * @category Theme
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
     * are updated. `<html>` is targeted (in addition to `<body>`) because [`Window`](/api/core/classes/Window) components
     * are appended to `document.documentElement`, so text in floating windows must inherit
     * from `<html>`.
     */
    static setTheme(theme: Theme): void {
        ThemeManager.current = theme;

        CSS.setRootVariables(themeToVars(theme));

        document.documentElement.style.colorScheme = theme.colorScheme;
        document.documentElement.style.color       = theme.text.color;
        document.documentElement.style.fontFamily  = theme.font.family;
        document.documentElement.style.fontSize    = theme.font.size;
        document.documentElement.style.lineHeight  = String(theme.font.lineHeight);
        document.body.style.backgroundColor        = theme.body.background;
        document.body.style.color                  = theme.text.color;

        Util.invalidateInputBaselineCache();

        ThemeManager.themeListeners.forEach(l => l());
    }

    /**
     * Returns the currently active theme.
     *
     * @returns The `Theme` object that was last passed to `setTheme`, defaulting to [`DefaultTheme`](/api/core/variables/DefaultTheme).
     */
    static getTheme(): Theme {
        return ThemeManager.current;
    }
}
