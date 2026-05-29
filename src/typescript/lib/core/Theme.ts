// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { InlineStyle } from '~/core/StyleTarget.js';
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
        hover: {
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
        /**
         * Complete CSS border shorthand string consumed via `setBorder(string)`.
         * Applied to `TextInput`, the three picker fields, `ComboBox`, the
         * picker dropdown panels, the autocomplete dropdown, and `FieldSet`.
         */
        border: string;
        /**
         * Complete CSS border shorthand string for the hover state. Provisioned
         * for follow-up work that adds `:hover` rules to the listed inputs; not
         * consumed at present.
         */
        borderHover: string;
    };

    /**
     * Cross-cutting affordance tokens — surfaces that mark a focused / selected
     * cell or row use this bucket rather than per-component colour-only tokens.
     */
    indicator: {
        /**
         * Colour-only token for the keyboard-focus indicator. Consumed by
         * every `:focus` / `:focus-within` rule the framework exposes —
         * `TextField` / `TextArea` / `PasswordField`, the composite inputs
         * (`AutoCompleteField`, the picker fields, `NumberSpinner`), the
         * list root, the row focus mark, and the table cell focus mark.
         * The width / style is fixed at `2px solid` framework-side so the
         * same colour works through both the `border:` shorthand (on
         * pseudo-element overlays) and the `box-shadow: inset 0 0 0 2px`
         * recipe (used on `<input>` elements, which don't render
         * pseudo-elements).
         */
        focus: string;
        /**
         * Complete CSS outline shorthand string for the "selection mark"
         * affordance — reserved for callers that need an outline-shaped
         * selection cue distinct from background-tint selection. Currently
         * unconsumed; provisioned so a future plan can wire it without
         * re-touching `Theme.ts`.
         */
        selection: string;
    };

    form: {
        background       : string;
        border           : string;
        color            : string;
        disabledBackground: string;
        disabledColor    : string;
        focusRing        : string;

        toggle: {
            trackOffBackground: string;
            trackOnBackground : string;
            thumbBackground   : string;
            width             : string;
            height            : string;
        };

        slider: {
            trackBackground      : string;
            trackActiveBackground: string;
            thumbBackground      : string;
            thumbSize            : string;
            trackThickness       : string;
        };

        checkbox: {
            background             : string;
            selectedBackground     : string;
            indeterminateBackground: string;
            checkColor             : string;
            size                   : string;
            radius                 : string;
        };

        radio: {
            background        : string;
            selectedBackground: string;
            dotColor          : string;
            size              : string;
        };
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
        shadow      : string;
        snapGlow    : string;
        minDockWidth: string;
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
            glyph: {
                gap  : string;
                color: string;
            };
        };
        row: {
            selected      : string;
            selectedBorder: string;
            new           : string;
            dirty         : string;
        };
        cell: {
            height            : string;
            padding           : number;
            background        : string;
            readonlyBackground: string;
            color             : string;
            border            : string;
            editorBorderColor : string;
        };
        resizeHandle: {
            width : string;
            color : string;
            cursor: string;
        };
        sortBadge: {
            background: string;
            color     : string;
            fontSize  : string;
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

    statusBar: {
        background: string;
        color     : string;
        border    : string;
        height    : string;
        padding   : string;
    },
    toolBar: {
        background    : string;
        border        : string;
        padding       : string;
        gap           : string;
        separatorColor: string;
    };

    tooltip: {
        background: string;
        color     : string;
        border    : string;
        shadow    : string;
    };

    popover: {
        background: string;
        color     : string;
        border    : string;
        shadow    : string;
        radius    : string;
        padding   : string;
        arrowSize : string;
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
        border:  string;
        shadow:  string;
        confirm: string;
        cancel:  string;
        /**
         * Title-bar wash for an informational dialog (one `confirm`-result
         * button). Background is a low-opacity tint of the same hue as
         * `notification.info.border`; foreground is the saturated form,
         * applied to both the title text and the leading `circle-info`
         * glyph the dialog injects for this variant.
         */
        info: {
            background: string;
            foreground: string;
        };
        /**
         * Title-bar wash for an affirmative-action dialog (both `confirm`
         * and `cancel` buttons). Background mirrors the low-opacity tint of
         * `notification.success.border`; foreground is the saturated form,
         * applied to the title text only — this variant carries no leading
         * glyph.
         */
        affirm: {
            background: string;
            foreground: string;
        };
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

    list: {
        background: string;
        border    : string;
        row: {
            hoverBackground   : string;
            selectedBackground: string;
            selectedColor     : string;
            focusRing         : string;
            disabledColor     : string;
            separator         : string;
        };
    };

    dropdown: {
        fade: {
            duration : string;
            translate: string;
        };
    };

    /**
     * Tokens used by the picker dropdowns
     * ([`DatePickerDropdown`](/api/component/input/classes/DatePickerDropdown),
     * [`DateTimePickerDropdown`](/api/component/input/classes/DateTimePickerDropdown)).
     * The cell hover and selection highlight keep tracking `autoComplete.item.*`
     * numerically because both surfaces share the
     * [`PickerCell`](/api/component/input/classes/PickerCell) class — a theme
     * that customises one gets the other matching automatically. These three
     * tokens cover the surfaces the autoComplete tokens cannot: a
     * navigation-chevron / header-as-button affordance and the dim background
     * for out-of-range day cells.
     */
    picker: {
        /** Foreground colour for the header chevron glyph and the year-scroller toggle. */
        navForeground:       string;
        /** Background applied to the navigation chevron / header-toggle under hover. */
        navHoverBackground:  string;
        /** Background applied to a day cell that falls outside `minDate`/`maxDate`. */
        cellDisabledBackground: string;
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

    glyph: {
        spinDuration : string;
        pulseDuration: string;
        beatDuration : string;
    };

    /**
     * Tokens consumed by the drag-and-drop overlays — the ghost that
     * follows the cursor, the per-target validity tint applied by
     * [`DragFeedback`](/api/core/classes/DragFeedback), and the
     * insertion-line bar drawn by
     * [`ReorderIndicator`](/api/core/classes/ReorderIndicator).
     */
    drag: {
        ghost: {
            background: string;
            border    : string;
            shadow    : string;
            opacity   : string;
        };
        feedback: {
            valid  : { background: string; border: string; };
            invalid: { background: string; border: string; };
        };
        reorderIndicator: {
            color: string;
        };
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
        toolbar: { background: '#eee',     border: '#e1e1e8' },
        button : { background: '#b8b8c3' },
    },
    window: {
        shadow      : '3px 3px 2px rgba(0, 0, 0, 0.4)',
        snapGlow    : '0 0 0 2px rgba(30, 100, 200, 0.7)',
        minDockWidth: '200px',
    },
    header: { font: { size: '12px' }, padding: 5 },
    table : {
        header: {
            border: 'black',
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
    dropdown: {
        fade: { duration: '120ms', translate: '4px' },
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
            width             : '36px',
            height            : '20px',
        },
        slider  : {
            trackBackground      : 'rgb(70, 70, 70)',
            trackActiveBackground: 'rgb(120, 170, 240)',
            thumbBackground      : 'rgb(230, 230, 230)',
            thumbSize            : '16px',
            trackThickness       : '4px',
        },
        checkbox: {
            background             : 'rgb(40, 40, 40)',
            selectedBackground     : 'rgb(120, 170, 240)',
            indeterminateBackground: 'rgb(100, 100, 100)',
            checkColor             : 'rgb(20, 20, 20)',
            size                   : '16px',
            radius                 : '3px',
        },
        radio   : {
            background        : 'rgb(40, 40, 40)',
            selectedBackground: 'rgb(120, 170, 240)',
            dotColor          : 'rgb(20, 20, 20)',
            size              : '16px',
        },
    },
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
    window    : {
        shadow      : '3px 3px 2px rgba(0, 0, 0, 0.6)',
        snapGlow    : '0 0 0 2px rgba(80, 150, 240, 0.8)',
        minDockWidth: '200px',
    },
    header    : { font: { size: '12px' }, padding: 4 },
    table     : {
        header: {
            border: '#555',
            font  : { size: '13px' },
            glyph : { gap: '4px', color: 'currentColor' },
        },
        row   : {
            selected      : 'rgba(30, 100, 200, 0.25)',
            selectedBorder: 'inset 0 0 0 1px rgba(30, 100, 200, 0.8)',
            new           : 'rgba(70, 200, 70, 0.2)',
            dirty         : 'rgba(255, 165, 0, 0.2)',
        },
        cell  : {
            height            : '22px',
            padding           : 2,
            background        : 'transparent',
            readonlyBackground: 'rgba(255, 255, 255, 0.04)',
            color             : 'inherit',
            border            : 'none',
            editorBorderColor : 'rgba(30, 100, 200, 0.8)',
        },
        resizeHandle: {
            width : '5px',
            color : 'rgba(255, 255, 255, 0.25)',
            cursor: 'ew-resize',
        },
        sortBadge: {
            background: 'rgba(255, 255, 255, 0.2)',
            color     : 'inherit',
            fontSize  : '10px',
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
    statusBar: {
        background: 'transparent',
        color     : 'rgb(200, 200, 200)',
        border    : 'rgb(70, 70, 70)',
        height    : '22px',
        padding   : '6px',
    },
    toolBar: {
        background    : 'transparent',
        border        : 'rgb(70, 70, 70)',
        padding       : '4px',
        gap           : '4px',
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
        radius    : '6px',
        padding   : '12px',
        arrowSize : '8px',
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
    dropdown: {
        fade: { duration: '120ms', translate: '4px' },
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
    glyph: {
        spinDuration : '2000ms',
        pulseDuration: '1000ms',
        beatDuration : '1000ms',
    },
    drag: {
        ghost: {
            background: 'rgba(60, 60, 60, 0.9)',
            border    : 'rgb(100, 100, 100)',
            shadow    : '2px 4px 12px rgba(0, 0, 0, 0.6)',
            opacity   : '0.85',
        },
        feedback: {
            valid  : { background: 'rgba(30, 180, 80, 0.2)',  border: 'rgb(30, 180, 80)'  },
            invalid: { background: 'rgba(200, 50, 50, 0.18)', border: 'rgb(200, 50, 50)' },
        },
        reorderIndicator: {
            color: 'rgb(80, 140, 240)',
        },
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
        '--ts-ui-button-hover-fg'                  : theme.button.hover.foreground,
        '--ts-ui-button-hover-bg'                  : theme.button.hover.background,
        '--ts-ui-button-hover-shadow'              : theme.button.hover.shadow,
        '--ts-ui-toggle-selected-bg'               : theme.toggle.selected.background,
        '--ts-ui-toggle-selected-shadow'           : theme.toggle.selected.shadow,
        '--ts-ui-input-bg'                         : theme.input.background,
        '--ts-ui-input-border'                     : theme.input.border,
        '--ts-ui-input-border-hover'               : theme.input.borderHover,
        '--ts-ui-form-bg'                          : theme.form.background,
        '--ts-ui-form-border'                      : theme.form.border,
        '--ts-ui-form-color'                       : theme.form.color,
        '--ts-ui-form-disabled-bg'                 : theme.form.disabledBackground,
        '--ts-ui-form-disabled-color'              : theme.form.disabledColor,
        '--ts-ui-focus-ring'                       : theme.form.focusRing,
        '--ts-ui-toggle-track-bg-off'              : theme.form.toggle.trackOffBackground,
        '--ts-ui-toggle-track-bg-on'               : theme.form.toggle.trackOnBackground,
        '--ts-ui-toggle-thumb-bg'                  : theme.form.toggle.thumbBackground,
        '--ts-ui-toggle-width'                     : theme.form.toggle.width,
        '--ts-ui-toggle-height'                    : theme.form.toggle.height,
        '--ts-ui-slider-track-bg'                  : theme.form.slider.trackBackground,
        '--ts-ui-slider-track-active-bg'           : theme.form.slider.trackActiveBackground,
        '--ts-ui-slider-thumb-bg'                  : theme.form.slider.thumbBackground,
        '--ts-ui-slider-thumb-size'                : theme.form.slider.thumbSize,
        '--ts-ui-slider-track-thickness'           : theme.form.slider.trackThickness,
        '--ts-ui-checkbox-bg'                      : theme.form.checkbox.background,
        '--ts-ui-checkbox-bg-selected'             : theme.form.checkbox.selectedBackground,
        '--ts-ui-checkbox-bg-indeterminate'        : theme.form.checkbox.indeterminateBackground,
        '--ts-ui-checkbox-check-color'             : theme.form.checkbox.checkColor,
        '--ts-ui-checkbox-size'                    : theme.form.checkbox.size,
        '--ts-ui-checkbox-radius'                  : theme.form.checkbox.radius,
        '--ts-ui-radio-bg'                         : theme.form.radio.background,
        '--ts-ui-radio-bg-selected'                : theme.form.radio.selectedBackground,
        '--ts-ui-radio-dot-color'                  : theme.form.radio.dotColor,
        '--ts-ui-radio-size'                       : theme.form.radio.size,
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
        '--ts-ui-window-snap-glow'                 : theme.window.snapGlow,
        '--ts-ui-window-min-dock-width'            : theme.window.minDockWidth,
        '--ts-ui-header-font-size'                 : theme.header.font.size,
        '--ts-ui-table-header-border'              : theme.table.header.border,
        '--ts-ui-table-header-font-size'           : theme.table.header.font.size,
        '--ts-ui-table-header-glyph-gap'           : theme.table.header.glyph.gap,
        '--ts-ui-table-header-glyph-color'         : theme.table.header.glyph.color,
        '--ts-ui-table-row-selected'               : theme.table.row.selected,
        '--ts-ui-table-row-selected-border'        : theme.table.row.selectedBorder,
        '--ts-ui-table-row-new'                    : theme.table.row.new,
        '--ts-ui-table-row-dirty'                  : theme.table.row.dirty,
        '--ts-ui-table-cell-height'                : theme.table.cell.height,
        '--ts-ui-table-cell-bg'                    : theme.table.cell.background,
        '--ts-ui-table-cell-readonly-bg'           : theme.table.cell.readonlyBackground,
        '--ts-ui-table-cell-color'                 : theme.table.cell.color,
        '--ts-ui-table-cell-border'                : theme.table.cell.border,
        '--ts-ui-table-cell-editor-border'         : theme.table.cell.editorBorderColor,
        '--ts-ui-table-resize-handle-width'        : theme.table.resizeHandle.width,
        '--ts-ui-table-resize-handle-color'        : theme.table.resizeHandle.color,
        '--ts-ui-table-resize-handle-cursor'       : theme.table.resizeHandle.cursor,
        '--ts-ui-sort-badge-bg'                    : theme.table.sortBadge.background,
        '--ts-ui-sort-badge-color'                 : theme.table.sortBadge.color,
        '--ts-ui-sort-badge-font-size'             : theme.table.sortBadge.fontSize,
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
        '--ts-ui-popover-bg'                       : theme.popover.background,
        '--ts-ui-popover-color'                    : theme.popover.color,
        '--ts-ui-popover-border'                   : theme.popover.border,
        '--ts-ui-popover-shadow'                   : theme.popover.shadow,
        '--ts-ui-popover-radius'                   : theme.popover.radius,
        '--ts-ui-popover-padding'                  : theme.popover.padding,
        '--ts-ui-popover-arrow-size'               : theme.popover.arrowSize,
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
        '--ts-ui-list-bg'                          : theme.list.background,
        '--ts-ui-list-border'                      : theme.list.border,
        '--ts-ui-list-row-hover-bg'                : theme.list.row.hoverBackground,
        '--ts-ui-list-row-selected-bg'             : theme.list.row.selectedBackground,
        '--ts-ui-list-row-selected-color'          : theme.list.row.selectedColor,
        '--ts-ui-list-row-focus-ring'              : theme.list.row.focusRing,
        '--ts-ui-list-row-disabled-color'          : theme.list.row.disabledColor,
        '--ts-ui-list-row-separator'               : theme.list.row.separator,
        '--ts-ui-indicator-focus'                  : theme.indicator.focus,
        '--ts-ui-indicator-selection'              : theme.indicator.selection,
        '--ts-ui-dropdown-fade-duration'           : theme.dropdown.fade.duration,
        '--ts-ui-dropdown-fade-translate'          : theme.dropdown.fade.translate,
        '--ts-ui-picker-nav-fg'                    : theme.picker.navForeground,
        '--ts-ui-picker-nav-hover-bg'              : theme.picker.navHoverBackground,
        '--ts-ui-picker-cell-disabled-bg'          : theme.picker.cellDisabledBackground,
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
        '--ts-ui-statusbar-bg'                     : theme.statusBar.background,
        '--ts-ui-statusbar-color'                  : theme.statusBar.color,
        '--ts-ui-statusbar-border'                 : theme.statusBar.border,
        '--ts-ui-statusbar-height'                 : theme.statusBar.height,
        '--ts-ui-statusbar-padding'                : theme.statusBar.padding,
        '--ts-ui-toolbar-bg'                       : theme.toolBar.background,
        '--ts-ui-toolbar-border'                   : theme.toolBar.border,
        '--ts-ui-toolbar-padding'                  : theme.toolBar.padding,
        '--ts-ui-toolbar-gap'                      : theme.toolBar.gap,
        '--ts-ui-toolbar-separator-color'          : theme.toolBar.separatorColor,
        '--ts-ui-dialog-backdrop-bg'               : theme.dialog.backdrop.background,
        '--ts-ui-dialog-border'                    : theme.dialog.border,
        '--ts-ui-dialog-shadow'                    : theme.dialog.shadow,
        '--ts-ui-dialog-confirm-color'             : theme.dialog.confirm,
        '--ts-ui-dialog-cancel-color'              : theme.dialog.cancel,
        '--ts-ui-dialog-info-bg'                   : theme.dialog.info.background,
        '--ts-ui-dialog-info-fg'                   : theme.dialog.info.foreground,
        '--ts-ui-dialog-affirm-bg'                 : theme.dialog.affirm.background,
        '--ts-ui-dialog-affirm-fg'                 : theme.dialog.affirm.foreground,
        '--ts-ui-spinner-btn-width'                : theme.spinner.buttonWidth,
        '--ts-ui-spinner-divider'                  : theme.spinner.dividerColor,
        '--ts-ui-progress-track-bg'                : theme.progressBar.track.background,
        '--ts-ui-progress-track-radius'            : theme.progressBar.track.borderRadius,
        '--ts-ui-progress-fill-bg'                 : theme.progressBar.fill.background,
        '--ts-ui-progress-indeterminate-bg'        : theme.progressBar.indeterminate.background,
        '--ts-ui-progress-spinner-color'           : theme.progressSpinner.color,
        '--ts-ui-progress-spinner-backdrop'        : theme.progressSpinner.backdrop,
        '--ts-ui-progress-spinner-size'            : theme.progressSpinner.size,
        '--ts-ui-glyph-spin-duration'              : theme.glyph.spinDuration,
        '--ts-ui-glyph-pulse-duration'             : theme.glyph.pulseDuration,
        '--ts-ui-glyph-beat-duration'              : theme.glyph.beatDuration,
        '--ts-ui-drag-ghost-bg'                    : theme.drag.ghost.background,
        '--ts-ui-drag-ghost-border'                : theme.drag.ghost.border,
        '--ts-ui-drag-ghost-shadow'                : theme.drag.ghost.shadow,
        '--ts-ui-drag-ghost-opacity'               : theme.drag.ghost.opacity,
        '--ts-ui-drag-feedback-valid-bg'           : theme.drag.feedback.valid.background,
        '--ts-ui-drag-feedback-valid-border'       : theme.drag.feedback.valid.border,
        '--ts-ui-drag-feedback-invalid-bg'         : theme.drag.feedback.invalid.background,
        '--ts-ui-drag-feedback-invalid-border'     : theme.drag.feedback.invalid.border,
        '--ts-ui-drag-reorder-color'               : theme.drag.reorderIndicator.color,
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

        const rootStyle = new InlineStyle();
        rootStyle.setMany(themeToVars(theme));
        rootStyle.attach(document.documentElement);

        document.documentElement.style.colorScheme = theme.colorScheme;
        document.documentElement.style.color       = theme.text.color;
        document.documentElement.style.fontFamily  = theme.font.family;
        document.documentElement.style.fontSize    = theme.font.size;
        document.documentElement.style.lineHeight  = String(theme.font.lineHeight);
        document.body.style.backgroundColor        = theme.body.background;
        document.body.style.color                  = theme.text.color;

        Util.invalidateInputBaselineCache();
        Util.invalidateLabelBaselineCache();

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
