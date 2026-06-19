// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The OFL Manrope variable font (weight axis 200–800), shipped by
// @fontsource-variable/manrope as unicode-range subsets. We bundle the Latin
// and Latin-Ext subsets (the framework's Western chrome plus extended-Latin
// coverage); each .woff2 is imported as a URL so Vite emits it as a build asset
// served from the consumer's own origin — no Google Fonts <link>, no runtime
// external request. Vite library mode inlines these assets as base64, so the
// other subsets (Cyrillic, Greek, Vietnamese) are deliberately omitted to keep
// the eagerly-bundled font payload small; text outside Latin/Latin-Ext falls
// back to `sans-serif`. The matching @font-face rules are injected at runtime by
// ensureFontLoaded() (see below) rather than via a CSS import, because the
// framework ships no stylesheet: like Glyph's keyframes, shared assets are
// injected from JS so they survive the library build, where a CSS side-effect
// import would be extracted to an orphaned file the bundle never loads.
import manropeLatinExtUrl from '@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2';
import manropeLatinUrl    from '@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2';

import { InlineStyle } from '~/core/StyleTarget.js';
import { Util } from '~/core/Util.js';
import { DOM } from '~/core/DOM.js';
// The three built-in theme literals live in their own files under
// `core/themes/`; they are imported here so `ThemeManager` can default to
// `ModernTheme`, and re-exported below so existing
// `import { ClassicTheme } from '~/core/Theme.js'` paths and the core barrel
// keep resolving unchanged.
import { BaseTheme } from '~/core/themes/BaseTheme.js';
import { ClassicTheme } from '~/core/themes/ClassicTheme.js';
import { DarkTheme } from '~/core/themes/DarkTheme.js';
import { ModernTheme } from '~/core/themes/ModernTheme.js';

/**
 * A scaled size in the theme's {@link Theme.scale} block.
 *
 * `{ scale }` is a **ratio of the base** size — the resolved px grows with
 * `scale.base` (`round(base * scale)`). `{ fixed }` is **absolute px** that opts
 * out of scaling. Exactly one of the two is intended, and that is compile-time
 * enforced wherever a value is typed against `ScaleToken` directly. Inside a
 * theme literal the guarantee is weakened by
 * [`DeepPartial`](/api/core/type-aliases/DeepPartial) (which makes both arms
 * optional), so the resolution that produces {@link ResolvedScale} guards every
 * arm at runtime.
 *
 * @category Theme
 */
export type ScaleToken = { scale: number } | { fixed: number };

/**
 * A theme font-size token, resolved to a CSS string by `themeToVars`. A bare
 * length string (`'13px'`, `'1.2rem'`) passes through unchanged; a signed pixel
 * offset string (`'+2px'`, `'-2px'`) becomes `calc(var(--ts-ui-font-size) ± Npx)`;
 * a `{ scale: n }` object becomes `calc(var(--ts-ui-font-size) * n)`. Omitting an
 * optional font token inherits the base font size ([`Theme`](/api/core/interfaces/Theme)'s
 * `font.size`, the `--ts-ui-font-size` anchor).
 *
 * Unlike the glyph {@link ScaleToken} — which resolves to a JS px number frozen
 * into {@link ResolvedScale} once per theme — a `FontSizeToken` resolves to a CSS
 * string and rides the cascade, so it re-resolves automatically when the base
 * font size changes.
 *
 * @category Theme
 */
export type FontSizeToken = string | { scale: number };

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
        size?     : string;
        /**
         * Extra vertical leading added to a control's own font size to form its
         * line box, as a CSS length string, e.g. `"2px"`. The rendered line
         * height is `font-size + linePadding` (via `calc(1em + …)`), so the
         * leading scales with each control's font size instead of being a fixed
         * value — 12px text and 14px text get proportionate line boxes from the
         * one token. A control can still pin an explicit fixed line-height with
         * `Text.setLineHeight(px)`.
         */
        linePadding: string;
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
            size?: FontSizeToken;
        };
        description: {
            fontSize? : FontSizeToken;
            foreground: string;
            weight    : string;
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
        flat: {
            hover: {
                background: string;
                border    : string;
            };
            pressed: {
                background: string;
                shadow    : string;
                border    : string;
            };
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

    collapse: {
        strip: {
            /** Background fill of a collapsed pane/region's tucked strip. */
            background: string;
            /** Strip thickness along its short axis (CSS length). */
            size: string;
        };
        button: {
            /** Colour of the collapse/restore chevron glyph. */
            color: string;
        };
    };

    tab: {
        /**
         * Whether the tab strip draws the edge-to-edge 1px rule under the toolbar.
         * Read by the [`Tab`](/api/layout/classes/Tab) layout manager as the default
         * for its under-border; an explicit `tabUnderBorderFullWidth` option overrides it.
         */
        underBorderFullWidth: boolean;
        toolbar: {
            background: string;
            border    : string;
        };
        button: {
            background: string;
            /** CSS `border` shorthand applied to all four sides (e.g. `'1px solid rgb(...)'` or `'none'`); the uniform fallback for the per-side overrides. */
            border    : string;
            /** Optional CSS `border-top` override for the normal state; falls back to `border`. */
            borderTop?   : string;
            /** Optional CSS `border-right` override for the normal state; falls back to `border`. */
            borderRight? : string;
            /** Optional CSS `border-bottom` override for the normal state; falls back to `border`. */
            borderBottom?: string;
            /** Optional CSS `border-left` override for the normal state; falls back to `border`. */
            borderLeft?  : string;
            hover: {
                background: string;
                border    : string;
                borderTop?   : string;
                borderRight? : string;
                borderBottom?: string;
                borderLeft?  : string;
            };
            selected: {
                background: string;
                border    : string;
                borderTop?   : string;
                borderRight? : string;
                borderBottom?: string;
                borderLeft?  : string;
            };
        };
        indicator: {
            /** Fill colour of the sliding active-tab selection bar. */
            color    : string;
            /** Thickness (CSS length) of the indicator bar. */
            thickness: string;
        };
    };

    window: {
        shadow      : string;
        snapGlow    : string;
        minDockWidth: string;
        /**
         * Window control buttons (minimize / maximize / close), shared by a
         * {@link TabWindow}'s tab bar and an ordinary `Window`'s `WindowHeader`
         * (both build them from the same `windowControls` factory). Flat themes
         * blend them into the surface; the classic theme renders them as standard
         * raised buttons.
         */
        control: {
            background      : string;
            border          : string;
            shadow          : string;
            hoverBackground : string;
            activeBackground: string;
        };
        /**
         * Focused fill of an ordinary `Window`'s `WindowHeader`. Independently
         * themeable from the tab strip, but valued equal to `tab.toolbar.background`
         * so a header `Window` and a headerless {@link TabWindow} share one
         * window-chrome colour. The blurred fill is the shared `gutter.background`.
         */
        header: {
            background: string;
        };
    };

    header: {
        font: {
            size?: FontSizeToken;
        };
    };

    table: {
        header: {
            /** Header surface fill; accepts any CSS `background-image` (gradient) or `background-color` value. */
            background: string;
            border: string;
            font: {
                size?: FontSizeToken;
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
            stripe        : string;
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
            fontSize? : FontSizeToken;
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

    drawer: {
        background: string;
        shadow:     string;
        border:     string;
    };

    rail: {
        background: string;
        border:     string;
        shadow:     string;
        handle: {
            hoverBackground:    string;
            selectedBackground: string;
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
        dropzone: {
            background       : string;
            border           : string;
            activeBackground : string;
            invalidBackground: string;
        };
    };

    /**
     * Tokens consumed by the [`FileDropZone`](/api/component/input/classes/FileDropZone)
     * surface — the dashed border and tinted background of its resting state
     * and the brighter wash while a valid OS file drag hovers. Deliberately
     * separate from the {@link Theme.drag} `dropzone` tokens, which belong to
     * the internal pointer-drag overlay: the two mechanisms are unrelated.
     */
    fileDropZone: {
        background    : string;
        border        : string;
        activeBackground: string;
        activeBorder  : string;
    };

    scroll: {
        /**
         * Start colour of the edge-fade gradient a scrolling {@link Panel}
         * paints on each side where hidden content can still be scrolled into
         * view. Each fade runs from this colour to `transparent`; the fade
         * depth is a framework constant, so only the colour is themed.
         */
        shadowColor: string;
    };

    /**
     * The framework's global scale knob plus the font-coupled size ratios that
     * follow it. `base` is the root size in px, mirrored to CSS as
     * `--ts-ui-base-size`; SVG glyph boxes and JS layout constants size off it
     * (CSS `font-size` does not reach an SVG glyph). Each non-`base` token is a
     * {@link ScaleToken}; the block is resolved to a numeric
     * {@link ResolvedScale} once per {@link ThemeManager.setTheme} and read by
     * layout code via {@link ThemeManager.getResolvedScale}.
     */
    scale: {
        /** Root base size in px; the global scale knob. Mirror of `--ts-ui-base-size`. */
        base          : number;
        /** Window/tab title-glyph ink size. */
        titleGlyph    : ScaleToken;
        /** Tab close-button box. */
        tabClose      : ScaleToken;
        /** Tab close-glyph ink size. */
        tabCloseGlyph : ScaleToken;
        /** Tab-button inset (the compact inset derives as half of this). */
        tabButtonInset: ScaleToken;
    };
}

export { BaseTheme, ClassicTheme, DarkTheme, ModernTheme };

/**
 * Recursively-optional view of a type: every property optional at every depth,
 * recursing into plain object properties. Used for the partial overrides bag
 * passed to {@link defineTheme}.
 */
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Narrows a value to a plain object — an object that is neither `null` nor an
 * array. Used by {@link defineTheme}'s merge to decide recurse-vs-replace.
 *
 * @param value - The value to test.
 * @returns `true` when `value` is a non-null, non-array object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively merges `overrides` onto `base`: recurse into plain objects,
 * replace primitive/array leaves wholesale, and skip `undefined` override
 * values so an absent override key never blanks a base value.
 *
 * @param base - The value being layered onto.
 * @param overrides - The value layered on top.
 * @returns The merged value — a new object when both sides are plain objects, otherwise `overrides`.
 */
function deepMerge(base: unknown, overrides: unknown): unknown {
    if (!isPlainObject(base) || !isPlainObject(overrides)) {
        return overrides;
    }

    const result: Record<string, unknown> = { ...base };

    for (const key of Object.keys(overrides)) {
        const ov = overrides[key];

        if (ov === undefined) {
            continue;
        }

        result[key] = key in base ? deepMerge(base[key], ov) : ov;
    }

    return result;
}

/**
 * Produces a fully-resolved {@link Theme} by deep-merging `overrides` onto `base`.
 *
 * `base` is typically {@link BaseTheme} (the structural scaffold), but may be any
 * full `Theme` to deliberately derive one theme from another (e.g.
 * `defineTheme(ClassicTheme, { …dark palette… })`). The caller is responsible for
 * `base` + `overrides` together covering every `Theme` key; completeness is
 * enforced by the theme regression test, not the type system.
 *
 * Merge rule: recurse into plain objects, replace primitive/array leaves wholesale,
 * skip `undefined` override values.
 *
 * @param base - The scaffold or full theme to layer onto.
 * @param overrides - Tokens that differ from `base`.
 * @returns A complete, resolved `Theme`.
 */
export function defineTheme(base: DeepPartial<Theme>, overrides: DeepPartial<Theme>): Theme {
    return deepMerge(base, overrides) as Theme;
}

/**
 * The theme's {@link Theme.scale} block with every {@link ScaleToken} resolved
 * to a px number against the base size. Computed once per
 * [`setTheme`](/api/core/classes/ThemeManager#settheme) and read by layout code
 * via [`getResolvedScale`](/api/core/classes/ThemeManager#getresolvedscale), so
 * SVG glyph boxes and JS layout constants read a plain number instead of
 * resolving a token on every layout pass.
 *
 * @category Theme
 */
export type ResolvedScale = { readonly [K in keyof Theme["scale"]]: number };

/**
 * Resolves a {@link ScaleToken} to px against `base`. `{ scale }` is a ratio of
 * the base (`round(base * scale)`, grows with it); `{ fixed }` is absolute px
 * that stays put.
 *
 * Every arm is guarded because
 * [`DeepPartial`](/api/core/type-aliases/DeepPartial) weakens the union to
 * `{ scale? } | { fixed? }` inside a theme literal, so an authored token can be
 * malformed (`{}`, both-present) without a compile error. `scale` wins when both
 * are somehow present; a token missing both falls back to `base` so a malformed
 * theme degrades visibly (base px) rather than producing `NaN` or crashing.
 */
function resolveScaleToken(token: ScaleToken, base: number): number {
    const t = token as { scale?: number; fixed?: number };

    if (typeof t.scale === 'number') return Math.round(base * t.scale);
    if (typeof t.fixed === 'number') return t.fixed;

    return base;
}

/**
 * Resolves a theme's whole `scale` block to a numeric {@link ResolvedScale}
 * snapshot. Runs once per {@link ThemeManager.setTheme} (and once at module load
 * for the default theme), reading `scale.base` directly off the theme object —
 * no `getComputedStyle` — so layout code never resolves a token itself.
 */
function resolveScale(theme: Theme): ResolvedScale {
    const base = theme.scale.base;

    return {
        base,
        titleGlyph    : resolveScaleToken(theme.scale.titleGlyph, base),
        tabClose      : resolveScaleToken(theme.scale.tabClose, base),
        tabCloseGlyph : resolveScaleToken(theme.scale.tabCloseGlyph, base),
        tabButtonInset: resolveScaleToken(theme.scale.tabButtonInset, base),
    };
}

/**
 * Emits the four per-side tab-button border custom properties for one state,
 * keyed `<base>-top` / `-right` / `-bottom` / `-left`, each resolving to the
 * side's own value or falling back to the uniform `border`. All four are always
 * emitted with a concrete value so switching to a theme that leaves the per-side
 * fields unset overwrites (rather than leaks) the previous theme's per-side vars.
 *
 * @param base - The uniform border var name for the state (e.g. `'--ts-ui-tab-button-border'`).
 * @param side - The tab-button (sub-)object carrying the uniform `border` plus optional per-side fields.
 *
 * @returns A map of all four per-side custom properties.
 */
function tabButtonSideVars(
    base: string,
    side: { border: string; borderTop?: string; borderRight?: string; borderBottom?: string; borderLeft?: string }
): Record<string, string> {
    return {
        [`${base}-top`]:    side.borderTop    ?? side.border,
        [`${base}-right`]:  side.borderRight  ?? side.border,
        [`${base}-bottom`]: side.borderBottom ?? side.border,
        [`${base}-left`]:   side.borderLeft   ?? side.border,
    };
}

// Matches a signed pixel offset: '+2px', '-2px', '+0.5px'. Whole/decimal, px only.
const FONT_SIZE_OFFSET = /^([+-])(\d+(?:\.\d+)?)px$/;

/**
 * Resolves a {@link FontSizeToken} (or its absence) to the CSS string
 * `themeToVars` emits for a font var.
 *
 * - A signed pixel offset string (`'+2px'` / `'-2px'`) becomes
 *   `calc(var(--ts-ui-font-size) ± Npx)`.
 * - A `{ scale: n }` object becomes `calc(var(--ts-ui-font-size) * n)`.
 * - Any other string (a bare length like `'13px'` / `'1.2rem'`) passes through
 *   unchanged.
 * - `undefined` (an omitted optional token) and any unrecognised shape fall back
 *   to `var(--ts-ui-font-size)`, so a malformed theme degrades to the base font
 *   size — visibly, never `NaN`/crash. `DeepPartial<Theme>` weakens the
 *   `{ scale }` arm to `{ scale?: number }` inside a theme literal, so the
 *   `typeof token.scale === 'number'` guard is what keeps `{}` from emitting a
 *   broken `calc(... * undefined)`.
 */
function resolveFontSizeToken(token: FontSizeToken | undefined): string {
    if (token === undefined) return 'var(--ts-ui-font-size)';

    if (typeof token === 'object') {
        return typeof token.scale === 'number'
            ? `calc(var(--ts-ui-font-size) * ${token.scale})`
            : 'var(--ts-ui-font-size)';
    }

    if (typeof token === 'string') {
        const m = FONT_SIZE_OFFSET.exec(token.trim());
        // Whitespace around the operator is required — calc() rejects `14px-2px`
        // but accepts `14px - 2px`.
        return m ? `calc(var(--ts-ui-font-size) ${m[1]} ${m[2]}px)` : token;
    }

    return 'var(--ts-ui-font-size)';
}

/**
 * Converts a Theme object into a map of CSS custom property names to values.
 */
function themeToVars(theme: Theme): Record<string, string> {
    return {
        '--ts-ui-font-family'                      : theme.font.family,
        // `'14px'` mirrors BaseTheme.font.size — the fallback only applies when a
        // theme omits font.size entirely (the built-ins never do); it keeps the
        // base anchor every relative font token references from being unemitted.
        '--ts-ui-font-size'                        : theme.font.size ?? '14px',
        '--ts-ui-base-size'                        : String(theme.scale.base) + 'px',
        '--ts-ui-line-padding'                     : String(theme.font.linePadding),
        '--ts-ui-text-color'                       : theme.text.color,
        '--ts-ui-body-bg'                          : theme.body.background,
        '--ts-ui-border-color'                     : theme.border.color,
        '--ts-ui-border-radius'                    : theme.border.radius,
        '--ts-ui-button-bg'                        : theme.button.background,
        '--ts-ui-button-border'                    : theme.button.border,
        '--ts-ui-button-shadow'                    : theme.button.shadow,
        '--ts-ui-button-padding'                   : theme.button.padding,
        '--ts-ui-button-font-size'                 : resolveFontSizeToken(theme.button.font.size),
        '--ts-ui-button-description-font-size'     : resolveFontSizeToken(theme.button.description.fontSize),
        '--ts-ui-button-description-fg'            : theme.button.description.foreground,
        '--ts-ui-button-description-weight'        : theme.button.description.weight,
        '--ts-ui-button-pressed-fg'                : theme.button.pressed.foreground,
        '--ts-ui-button-pressed-bg'                : theme.button.pressed.background,
        '--ts-ui-button-pressed-shadow'            : theme.button.pressed.shadow,
        '--ts-ui-button-hover-fg'                  : theme.button.hover.foreground,
        '--ts-ui-button-hover-bg'                  : theme.button.hover.background,
        '--ts-ui-button-hover-shadow'              : theme.button.hover.shadow,
        '--ts-ui-button-flat-hover-bg'             : theme.button.flat.hover.background,
        '--ts-ui-button-flat-hover-border'         : theme.button.flat.hover.border,
        '--ts-ui-button-flat-pressed-bg'           : theme.button.flat.pressed.background,
        '--ts-ui-button-flat-pressed-shadow'       : theme.button.flat.pressed.shadow,
        '--ts-ui-button-flat-pressed-border'       : theme.button.flat.pressed.border,
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
        '--ts-ui-collapse-strip-bg'                : theme.collapse.strip.background,
        '--ts-ui-collapse-strip-size'              : theme.collapse.strip.size,
        '--ts-ui-collapse-button-color'            : theme.collapse.button.color,
        '--ts-ui-accordion-header-bg'              : theme.accordion.header.background,
        '--ts-ui-accordion-header-border'          : theme.accordion.header.border,
        '--ts-ui-accordion-header-color'           : theme.accordion.header.color,
        '--ts-ui-accordion-panel-border'           : theme.accordion.panel.border,
        '--ts-ui-accordion-indicator-color'        : theme.accordion.indicator.color,
        '--ts-ui-tab-toolbar-bg'                   : theme.tab.toolbar.background,
        '--ts-ui-tab-toolbar-border'               : theme.tab.toolbar.border,
        '--ts-ui-tab-button-bg'                    : theme.tab.button.background,
        '--ts-ui-tab-button-border'                : theme.tab.button.border,
        ...tabButtonSideVars('--ts-ui-tab-button-border', theme.tab.button),
        '--ts-ui-tab-button-hover-bg'              : theme.tab.button.hover.background,
        '--ts-ui-tab-button-hover-border'          : theme.tab.button.hover.border,
        ...tabButtonSideVars('--ts-ui-tab-button-hover-border', theme.tab.button.hover),
        '--ts-ui-tab-button-selected-bg'           : theme.tab.button.selected.background,
        '--ts-ui-tab-button-selected-border'       : theme.tab.button.selected.border,
        ...tabButtonSideVars('--ts-ui-tab-button-selected-border', theme.tab.button.selected),
        '--ts-ui-tab-indicator-color'              : theme.tab.indicator.color,
        '--ts-ui-tab-indicator-thickness'          : theme.tab.indicator.thickness,
        '--ts-ui-window-shadow'                    : theme.window.shadow,
        '--ts-ui-window-snap-glow'                 : theme.window.snapGlow,
        '--ts-ui-window-min-dock-width'            : theme.window.minDockWidth,
        '--ts-ui-window-control-bg'                : theme.window.control.background,
        '--ts-ui-window-control-border'            : theme.window.control.border,
        '--ts-ui-window-control-shadow'            : theme.window.control.shadow,
        '--ts-ui-window-control-hover-bg'          : theme.window.control.hoverBackground,
        '--ts-ui-window-control-active-bg'         : theme.window.control.activeBackground,
        '--ts-ui-window-header-bg'                 : theme.window.header.background,
        '--ts-ui-header-font-size'                 : resolveFontSizeToken(theme.header.font.size),
        '--ts-ui-table-header-bg'                  : theme.table.header.background,
        '--ts-ui-table-header-border'              : theme.table.header.border,
        '--ts-ui-table-header-font-size'           : resolveFontSizeToken(theme.table.header.font.size),
        '--ts-ui-table-header-glyph-gap'           : theme.table.header.glyph.gap,
        '--ts-ui-table-header-glyph-color'         : theme.table.header.glyph.color,
        '--ts-ui-table-row-selected'               : theme.table.row.selected,
        '--ts-ui-table-row-selected-border'        : theme.table.row.selectedBorder,
        '--ts-ui-table-row-new'                    : theme.table.row.new,
        '--ts-ui-table-row-dirty'                  : theme.table.row.dirty,
        '--ts-ui-table-row-stripe'                 : theme.table.row.stripe,
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
        '--ts-ui-sort-badge-font-size'             : resolveFontSizeToken(theme.table.sortBadge.fontSize),
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
        '--ts-ui-drawer-bg'                        : theme.drawer.background,
        '--ts-ui-drawer-shadow'                    : theme.drawer.shadow,
        '--ts-ui-drawer-border'                    : theme.drawer.border,
        '--ts-ui-rail-bg'                          : theme.rail.background,
        '--ts-ui-rail-border'                      : theme.rail.border,
        '--ts-ui-rail-shadow'                      : theme.rail.shadow,
        '--ts-ui-rail-handle-hover-bg'             : theme.rail.handle.hoverBackground,
        '--ts-ui-rail-handle-selected-bg'          : theme.rail.handle.selectedBackground,
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
        '--ts-ui-drag-dropzone-bg'                 : theme.drag.dropzone.background,
        '--ts-ui-drag-dropzone-border'             : theme.drag.dropzone.border,
        '--ts-ui-drag-dropzone-active-bg'          : theme.drag.dropzone.activeBackground,
        '--ts-ui-drag-dropzone-invalid-bg'         : theme.drag.dropzone.invalidBackground,
        '--ts-ui-filedropzone-bg'                  : theme.fileDropZone.background,
        '--ts-ui-filedropzone-border'              : theme.fileDropZone.border,
        '--ts-ui-filedropzone-active-bg'           : theme.fileDropZone.activeBackground,
        '--ts-ui-filedropzone-active-border'       : theme.fileDropZone.activeBorder,
        '--ts-ui-scroll-shadow-color'              : theme.scroll.shadowColor,
    };
}

/**
 * The Manrope subsets to register, pairing each bundled `.woff2` asset URL with
 * the `unicode-range` it covers. The URLs and ranges mirror the `index.css`
 * shipped by `@fontsource-variable/manrope`; the ranges are carried here
 * verbatim because the framework injects the `@font-face` rules from JS (see
 * {@link ensureFontLoaded}) rather than importing the package's stylesheet. Only
 * the Latin and Latin-Ext subsets are bundled — `unicode-range` still routes
 * each glyph to the right face, and codepoints outside these ranges fall back to
 * `sans-serif`.
 */
const MANROPE_SUBSETS: ReadonlyArray<{ url: string; unicodeRange: string }> = [
    { url: manropeLatinExtUrl, unicodeRange: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' },
    { url: manropeLatinUrl,    unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
];

// Module-level guard so the @font-face block is injected exactly once, no matter
// how many times setTheme runs. Mirrors Glyph.ts's _keyframesInjected pattern.
let _fontInjected = false;

/**
 * Injects the bundled Manrope `@font-face` rules into `<head>` on first call.
 *
 * Idempotent — guarded by the module-level `_fontInjected` flag, mirroring
 * `Glyph.ts`'s keyframe injection. The face registers as `'Manrope Variable'`
 * (the value carried by the `font.family` theme token), spans the full 200–800
 * weight axis (Manrope's variable-font axis bounds, carried verbatim from the
 * package's `@font-face`), and uses `font-display: swap` so text stays visible
 * during the load. Each subset's `.woff2` is a Vite-bundled asset, so the font
 * self-hosts from the consumer's origin with no external request.
 */
function ensureFontLoaded(): void {
    if (_fontInjected) {
        return;
    }

    _fontInjected = true;

    const rules = MANROPE_SUBSETS.map(subset =>
        `@font-face{`
        + `font-family:'Manrope Variable';`
        + `font-style:normal;`
        + `font-display:swap;`
        + `font-weight:200 800;`
        + `src:url(${subset.url}) format('woff2-variations');`
        + `unicode-range:${subset.unicodeRange}`
        + `}`
    ).join('');

    const style = DOM.sink.createElement('style');
    DOM.sink.setTextContent(style, rules);
    DOM.sink.appendChild(DOM.source.getHead(), style);
}

/**
 * Singleton manager that applies a theme by writing CSS custom properties and
 * inline styles onto the document root and body elements.
 *
 * @example
 * ```typescript
 * import { ThemeManager, ClassicTheme, DarkTheme } from '@jimka/typescript-ui/core';
*
 * ThemeManager.setTheme(ClassicTheme); // classic light
 * ThemeManager.setTheme(DarkTheme);    // dark
 * ```
 *
 * @category Theme
 */
export class ThemeManager {
    private static current: Theme = ModernTheme;
    private static resolvedScale: ResolvedScale = resolveScale(ModernTheme);
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
        ensureFontLoaded();

        ThemeManager.current = theme;
        ThemeManager.resolvedScale = resolveScale(theme);

        const rootStyle = new InlineStyle();
        rootStyle.setMany(themeToVars(theme));
        rootStyle.attach(DOM.source.getDocumentElement());

        document.documentElement.style.colorScheme = theme.colorScheme;
        document.documentElement.style.color       = theme.text.color;
        document.documentElement.style.fontFamily  = theme.font.family;
        document.documentElement.style.fontSize    = theme.font.size ?? '14px';   // mirrors BaseTheme.font.size; font.size is optional
        document.documentElement.style.lineHeight  = `calc(1em + ${theme.font.linePadding})`;
        document.body.style.backgroundColor        = theme.body.background;
        document.body.style.color                  = theme.text.color;

        Util.invalidateTextMetricsCache();

        ThemeManager.themeListeners.forEach(l => l());
    }

    /**
     * Returns the currently active theme.
     *
     * @returns The `Theme` object that was last passed to `setTheme`, defaulting to [`ModernTheme`](/api/core/variables/ModernTheme).
     */
    static getTheme(): Theme {
        return ThemeManager.current;
    }

    /**
     * Returns the active theme's `scale` block resolved to px numbers — the snapshot
     * computed by the last `setTheme` (defaulting to [`ModernTheme`](/api/core/variables/ModernTheme)'s).
     * Layout code reads these numbers directly instead of resolving a {@link ScaleToken}
     * per pass; a base or token change re-resolves on the next `setTheme`.
     *
     * @returns The resolved scale snapshot for the active theme.
     */
    static getResolvedScale(): ResolvedScale {
        return ThemeManager.resolvedScale;
    }
}
