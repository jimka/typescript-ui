// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Panel } from "~/core/Panel.js";
import { Animation } from "~/core/Animation.js";
import { Event } from "~/core/Event.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { trapWheel, untrapWheel } from "~/core/WheelTrap.js";
import { Position } from "~/primitive/Position.js";
import { Text } from "~/component/input/Text.js";
import { SelectableText } from "~/component/input/SelectableText.js";
import { Button } from "~/component/button/Button.js";
import { Glyph } from "~/component/display/Glyph.js";
import { DialogBackdrop } from "~/component/container/DialogBackdrop.js";
import { Border as BorderLayout } from "~/layout/Border.js";
import { Fit } from "~/layout/Fit.js";
import { Placement } from "~/primitive/Placement.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import { xmark } from "~/glyphs/solid/xmark.js";
import { circle_check } from "~/glyphs/solid/circle_check.js";
import { circle_info } from "~/glyphs/solid/circle_info.js";
import { triangle_exclamation } from "~/glyphs/solid/triangle_exclamation.js";
import { circle_exclamation } from "~/glyphs/solid/circle_exclamation.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { ThemeManager } from "~/core/Theme.js";

/**
 * Square edge length used for the dialog's title-bar glyph — the theme's
 * `glyphLg` default icon step (16px at the shipped base). Read per call, not
 * frozen in a module constant, so a theme that raises `scale.base` moves the
 * icon with it.
 */
function titleGlyphPx(): number {
    return ThemeManager.getResolvedScale().glyphLg;
}

Glyph.register(xmark, circle_check, circle_info, triangle_exclamation, circle_exclamation);

/**
 * The result produced when a dialog is dismissed.
 *
 * @category Core
 */
export type DialogResult = 'confirm' | 'cancel' | 'close';

/**
 * Configuration for a single button in a dialog's button row.
 *
 * @category Core
 */
export interface DialogButtonConfig {
    /** The label text displayed on the button. */
    text    : string;
    /** The result value emitted when this button is clicked. Defaults to `'cancel'`. */
    result? : DialogResult;
    /** When true, renders the button with primary (confirm) styling. */
    primary?: boolean;
    /** Optional registry glyph name shown to the left of the button label. */
    glyph?  : string;
    /**
     * Optional foreground colour applied to the button's leading glyph. Accepts
     * any CSS colour string — typically a theme variable reference such as
     * `'var(--ts-ui-dialog-confirm-color)'`. When omitted the glyph inherits
     * the button's `currentColor`. The {@link DialogButtons} presets supply
     * the appropriate tint by default; reach for this field at the call site
     * only when overriding a preset or building a one-off button.
     */
    tint?   : string;
    /**
     * Optional async guard run when this button is clicked, before the dialog
     * closes. Return (or resolve) `false` to veto the close: the dialog stays
     * open and its `show()` promise does not resolve, so the caller can show
     * its own in-content validation error and let the user retry with no
     * rebuild. Return (or resolve) `true` — or omit `onClick` entirely — to
     * close normally with this button's `result`, exactly as before this
     * field existed.
     *
     * Every button in the row is disabled for the duration of a pending
     * `onClick` call, so a slow validation/submit can't race a second click.
     * A rejected/thrown `onClick` also vetoes the close (buttons re-enable),
     * and the rejection propagates to the caller — reserve throwing for a
     * genuine bug, not an expected validation failure; return `false` for that.
     *
     * Only chrome buttons go through this guard: Escape, a backdrop click, and
     * the title-bar close button all still close unconditionally, so a user
     * always has an unvalidated way out of the dialog.
     */
    onClick?: () => boolean | Promise<boolean>;
}

/**
 * Severity tone for a dialog's title bar, mirroring
 * [`NotificationType`](/api/core/type-aliases/NotificationType). When set it
 * tints the header and shows a matching leading glyph, taking precedence over
 * the tone otherwise derived from the buttons.
 *
 * @category Core
 */
export type DialogSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * Configuration object passed to `new Dialog(config)` or `Dialog.show(config)`.
 *
 * @category Core
 */
export interface DialogConfig {
    /** Text displayed in the dialog title bar. */
    title            : string;
    /** Plain-text body message. Ignored when `contentComponent` is provided. */
    message?         : string;
    /** A custom component rendered in the content area instead of a message label. */
    contentComponent?: Component;
    /**
     * Button definitions for the footer row.
     * Defaults to a single OK button that resolves with `'confirm'`.
     */
    buttons?         : DialogButtonConfig[];
    /** Dialog panel width in pixels. Defaults to 480. */
    width?           : number;
    /** Dialog panel height in pixels. When omitted the height is computed from content. */
    height?          : number;
    /** When true, clicking the backdrop closes the dialog with result `'close'`. Defaults to false. */
    closeOnBackdrop? : boolean;
    /**
     * When `false`, the dialog is a mandatory modal: no title-bar close button,
     * Escape does not close it, and a backdrop click does not close it (regardless
     * of `closeOnBackdrop`). Defaults to `true`.
     */
    dismissable?     : boolean;
    /**
     * Optional severity tone for the title bar (`'info'`, `'success'`,
     * `'warning'`, `'error'`). When set it tints the header and shows a matching
     * leading glyph, overriding the tone derived from the buttons. Omit for the
     * default button-derived chrome.
     */
    severity?        : DialogSeverity;
    /**
     * Component to receive focus when the dialog opens, overriding the default
     * (the first focusable element in the content region). Use it when the field
     * that should take focus is not the first one — a form whose first control is
     * a read-only summary, say. Ignored when the component has no focusable
     * element on open, which falls back to the default order.
     */
    initialFocus?    : Component;
}

// ---------------------------------------------------------------------------
// Private constants
// ---------------------------------------------------------------------------

const TITLE_HEIGHT  : number = 36;
const BUTTON_HEIGHT : number = 52;
const BUTTON_WIDTH  : number = 90;
const BUTTON_GAP    : number = 8;
const BUTTON_V_PAD  : number = 11;
const CLOSE_SIZE    : number = 20;
const TITLE_H_PAD   : number = 12;
const MIN_DIALOG_WIDTH : number = 320;
const MIN_DIALOG_HEIGHT: number = 160;
const MIN_CONTENT_HEIGHT: number = 80;
// Minimum gap kept between a content-resized dialog and each viewport edge, so a
// dialog grown to tall content never runs flush to the top/bottom of the screen.
const DIALOG_VIEWPORT_MARGIN: number = 24;

// Leading title-bar glyph per severity tone, mirroring Notification's badges.
const SEVERITY_GLYPH: Record<DialogSeverity, string> = {
    info:    "circle-info",
    success: "circle-check",
    warning: "triangle-exclamation",
    error:   "circle-exclamation",
};

/**
 * Shared duration (ms) for the dialog entrance/exit transition. The backdrop
 * fade and the panel's opacity + scale all run for this many milliseconds.
 */
const DIALOG_ANIM_DURATION_MS: number = 150;

/**
 * CSS selector matching the focusable elements inside a dialog — the Tab
 * focus-trap boundary set, the initial-focus candidates, and the primary-button
 * lookup all share it so the notion of "focusable" stays single-sourced.
 */
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Vertical breathing room reserved above and below the title text inside the
 * `TITLE_HEIGHT` row. 4 px on each side: keeps the bold label off the divider
 * border and gives a balanced visual cap height. Used both for the text's
 * line-height (via {@link Text.centerInHeight}) and for its laid-out height
 * inside the bar.
 */
const TITLE_V_PAD: number = 4;

/**
 * Horizontal gap between the close button and the right edge of the title
 * bar, plus the gap between the title text and the close button. Two
 * separate offsets share the same value so the close-button column reads as
 * a balanced `[gap][icon][gap]` strip.
 */
const TITLE_RIGHT_GAP: number = 4;

/**
 * Horizontal gap between the optional leading glyph and the title text.
 * Matches the 8 px gutter the WindowHeader uses between its title icon and
 * label so the two surfaces feel consistent.
 */
const TITLE_GLYPH_TEXT_GAP: number = 8;

// ---------------------------------------------------------------------------
// Private: DialogTitleBar
// ---------------------------------------------------------------------------

/**
 * Title bar that occupies the NORTH slot of a Dialog's border layout.
 * Contains a text label on the left, an optional leading glyph, and a glyph
 * close button on the right.
 *
 * @remarks
 * Reach this instance via [`Dialog.getTitleBar()`](/api/overlay/classes/Dialog#gettitlebar) — there is no public
 * constructor. The supported surface is `getTitleText()` (for tinting the
 * title text colour), `setGlyph()` / `getGlyph()` (for the optional leading
 * icon), and any inherited [`Component`](/api/core/classes/Component) setter
 * (e.g. `setBackgroundColor`).
 *
 * @category Core
 */
class DialogTitleBar extends Component {

    private readonly _titleText  : Text;
    private _closeButton: Button | null = null;
    private _titleGlyph: Glyph | null = null;

    /**
     * @param title - Text to display in the title bar.
     * @param onClose - Called when the user clicks the close button.
     * @param dismissable - When `false`, the close button is not built at all
     *   (mandatory-modal title bar).
     */
    constructor(title: string, onClose: () => void, dismissable: boolean) {
        super();

        this.setBackgroundColor("var(--ts-ui-body-bg)");
        this.setBorder({
            border:       "none",
            borderBottom: "1px solid var(--ts-ui-dialog-border)",
        });
        this.setPreferredSize({ width: 0, height: TITLE_HEIGHT });

        this._titleText = new Text(title);
        this._titleText.setFontWeight("bold");
        this._titleText.setOverflow("hidden");
        this._titleText.setTextOverflow("ellipsis");
        this._titleText.setWhiteSpace("nowrap");
        // Centre the label within the inner area of the row (TITLE_HEIGHT
        // minus the top + bottom TITLE_V_PAD breathing room).
        this._titleText.centerInHeight(TITLE_HEIGHT - TITLE_V_PAD * 2);
        this.addComponent(this._titleText);

        if (dismissable) {
            this._closeButton = new Button({ glyph: "xmark" });
            this._closeButton.setInsets(new Insets(0, 0, 0, 0));
            this._closeButton.setBorder("none");
            this._closeButton.clearBackgroundImage();
            this._closeButton.setBackgroundColor("transparent");
            this._closeButton.clearShadow();
            this._closeButton.clearPressedShadow();
            this._closeButton.clearHoverShadow();
            // Hover and pressed background swap out the framework's gray
            // var(--ts-ui-button-hover-bg, …) for a translucent overlay that
            // darkens whatever tinted header sits underneath without
            // imposing its own colour. Also drop the hover gradient so it
            // doesn't double up over the overlay.
            this._closeButton.setHoverBackgroundColor("var(--ts-ui-titlebar-btn-hover-bg, rgba(0, 0, 0, 0.08))");
            this._closeButton.setPressedBackgroundColor("var(--ts-ui-titlebar-btn-active-bg, rgba(0, 0, 0, 0.16))");
            this._closeButton.clearHoverBackgroundImage();
            this._closeButton.clearPressedBackgroundImage();
            this._closeButton.setPreferredSize({ width: CLOSE_SIZE, height: CLOSE_SIZE });
            this.addComponent(this._closeButton);

            this._closeButton.on("action", onClose);
        }
    }

    /**
     * Returns the title bar's close button, or `null` when the title bar was
     * built non-dismissable (no close affordance).
     *
     * @returns The close [`Button`](/api/component/button/classes/Button), or `null`.
     */
    getCloseButton(): Button | null {
        return this._closeButton;
    }

    /**
     * Returns the title-text component, for callers that need to tint or
     * otherwise restyle it from outside the title bar.
     *
     * @returns The internal title [`Text`](/api/component/input/classes/Text) instance.
     */
    getTitleText(): Text {
        return this._titleText;
    }

    /**
     * Sets or clears an optional leading glyph shown to the left of the title text.
     *
     * @param name - Registry glyph name to display, or `null` to clear an existing glyph.
     *
     * @returns This component, for method chaining.
     *
     * @remarks
     * The current implementation positions the glyph in `doLayout`; only the
     * notification-detail path uses this slot, and the glyph never coexists with
     * other left-side decoration on a Dialog title bar.
     */
    setGlyph(name: string): this {
        if (this._titleGlyph) {
            this.removeComponent(this._titleGlyph);
            this._titleGlyph = null;
        }

        const glyph  = new Glyph(name);
        const iconPx = titleGlyphPx();
        glyph.setPointerEvents("none");
        glyph.setPreferredSize({ width: iconPx, height: iconPx });
        this._titleGlyph = glyph;
        this.addComponent(glyph);

        this.doLayout();

        return this;
    }

    /**
     * Removes the leading title-bar glyph from the dialog, if one is present.
     *
     * @returns This component, for method chaining.
     */
    clearGlyph(): this {
        if (this._titleGlyph) {
            this.removeComponent(this._titleGlyph);
            this._titleGlyph = null;
            this.doLayout();
        }

        return this;
    }

    /**
     * Returns the optional leading title-glyph component, or null if none is set.
     *
     * @returns The leading [`Glyph`](/api/component/display/classes/Glyph) instance, or null.
     */
    getGlyph(): Glyph | null {
        return this._titleGlyph;
    }

    /**
     * Positions the title label, optional leading glyph, and close button within
     * the title bar's content box.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();

        if (!box) {
            return this;
        }

        const w       = box.width;
        const h       = box.height;
        const closeX  = w - CLOSE_SIZE - TITLE_RIGHT_GAP;
        const centerY = Math.floor((h - CLOSE_SIZE) / 2);
        const rightBound = this._closeButton
            ? closeX                    // reserve the close-button slot
            : (w - TITLE_H_PAD);        // no button: label runs to the right pad

        let labelX = TITLE_H_PAD;

        if (this._titleGlyph) {
            const fallbackPx = titleGlyphPx();
            const glyphSize  = this._titleGlyph.getPreferredSize() ?? { width: fallbackPx, height: fallbackPx };
            const glyphY     = Math.max(0, Math.floor((h - glyphSize.height) / 2));

            this._titleGlyph.setX(box.x + TITLE_H_PAD);
            this._titleGlyph.setY(box.y + glyphY);
            this._titleGlyph.setWidth(glyphSize.width);
            this._titleGlyph.setHeight(glyphSize.height);

            labelX = TITLE_H_PAD + glyphSize.width + TITLE_GLYPH_TEXT_GAP;
        }

        // Reserve TITLE_RIGHT_GAP of space between the label and the close button.
        const labelWidth = Math.max(0, rightBound - labelX - TITLE_RIGHT_GAP);
        const labelH     = h - TITLE_V_PAD * 2;

        this._titleText.setX(box.x + labelX);
        this._titleText.setY(box.y + TITLE_V_PAD);
        this._titleText.setWidth(labelWidth);
        this._titleText.setHeight(labelH);

        if (this._closeButton) {
            this._closeButton.setX(box.x + closeX);
            this._closeButton.setY(box.y + centerY);
            this._closeButton.setWidth(CLOSE_SIZE);
            this._closeButton.setHeight(CLOSE_SIZE);
            // setX/setY/setWidth/setHeight don't cascade — explicitly relayout the
            // close button so its internal Fit layout sizes the times glyph.
            this._closeButton.doLayout();
        }

        return this;
    }
}

// ---------------------------------------------------------------------------
// Private: DialogButtonRow
// ---------------------------------------------------------------------------

/**
 * Footer row that occupies the SOUTH slot of a Dialog's border layout.
 * Lays out one or more buttons, right-aligned.
 */
class DialogButtonRow extends Component {

    private readonly _buttons : Button[] = [];
    private readonly _configs : DialogButtonConfig[];
    private readonly _onButton: (result: DialogResult) => void;

    /**
     * @param configs - Button definitions to render.
     * @param onButton - Called with the resolved [`DialogResult`](/api/overlay/type-aliases/DialogResult) when a button's click clears its own `onClick` guard (or has none).
     */
    constructor(configs: DialogButtonConfig[], onButton: (result: DialogResult) => void) {
        super();

        this._configs  = configs;
        this._onButton = onButton;

        this.setBorder({
            border:    "none",
            borderTop: "1px solid var(--ts-ui-dialog-border)",
        });
        this.setBackgroundColor("var(--ts-ui-body-bg)");
        this.setPreferredSize({ width: 0, height: BUTTON_HEIGHT });

        for (const cfg of configs) {
            const btn    = new Button(cfg.text, cfg.glyph !== undefined ? { glyph: cfg.glyph } : undefined);
            const result = cfg.result ?? 'cancel';

            if (cfg.primary) {
                btn.setBackgroundImage("var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))");
            }

            if (cfg.glyph !== undefined) {
                const glyph = btn.getGlyph();
                const tint = cfg.tint;

                if (glyph !== null && tint) {
                    glyph.setForegroundColor(tint);
                }
            }

            btn.on("action", () => void this.handleClick(cfg, result));
            this._buttons.push(btn);
            this.addComponent(btn);
        }
    }

    /**
     * Runs `cfg.onClick` (if any) before reporting the click upward. Disables
     * every button in the row for the duration of a pending guard, so a slow
     * validation/submit can't race a second click; re-enables them once the
     * guard settles (a `true`/omitted result is about to tear this row down
     * anyway, so re-enabling then is harmless). A guard that rejects/throws
     * still re-enables the row and propagates — see `DialogButtonConfig.onClick`'s doc.
     *
     * @param cfg - The clicked button's own config (carries its `onClick`).
     * @param result - The `DialogResult` to report once the guard clears.
     */
    private async handleClick(cfg: DialogButtonConfig, result: DialogResult): Promise<void> {
        if (!cfg.onClick) {
            this._onButton(result);

            return;
        }

        this.setButtonsEnabled(false);

        let proceed: boolean;

        try {
            proceed = await cfg.onClick();
        } finally {
            this.setButtonsEnabled(true);
        }

        if (proceed) {
            this._onButton(result);
        }
    }

    /**
     * Simulates a click on the button marked `primary`, running its `onClick`
     * guard (if any) exactly as a real click would — see {@link handleClick}.
     * Used by {@link Dialog.onEnter} so Enter-to-confirm never bypasses a
     * primary button's own validation/submit work the way calling `hide`
     * directly would.
     *
     * @returns `true` when a primary button exists (its click was
     *   triggered, though `cfg.onClick`, if any, may still veto it);
     *   `false` when no button is marked `primary`.
     */
    confirmPrimary(): boolean {
        const cfg = this._configs.find(c => c.primary);

        if (!cfg) {
            return false;
        }

        void this.handleClick(cfg, cfg.result ?? 'cancel');

        return true;
    }

    /**
     * Enables or disables every button in the row at once — used to lock the
     * whole footer while one button's `onClick` guard is pending.
     *
     * @param enabled - The enabled state to apply to every button.
     */
    private setButtonsEnabled(enabled: boolean): void {
        for (const btn of this._buttons) {
            btn.setEnabled(enabled);
        }
    }

    /**
     * Positions buttons right-aligned within the footer row's content box.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();

        if (!box) {
            return this;
        }

        const btnH      = box.height - BUTTON_V_PAD * 2;
        const totalW    = this._buttons.length * BUTTON_WIDTH + (this._buttons.length - 1) * BUTTON_GAP;
        let   x         = Math.round((box.width - totalW) / 2);

        for (const btn of this._buttons) {
            btn.setX(box.x + x);
            btn.setY(box.y + BUTTON_V_PAD);
            btn.setWidth(BUTTON_WIDTH);
            btn.setHeight(btnH);

            btn.doLayout();

            x += BUTTON_WIDTH + BUTTON_GAP;
        }

        return this;
    }
}

// ---------------------------------------------------------------------------
// Public: Dialog
// ---------------------------------------------------------------------------

/**
 * Canonical dialog button presets. Spread into the `buttons` array of a
 * {@link DialogConfig} to inherit the standard text / result / glyph mapping
 * for the three universal dismiss-row affordances; override `primary` per
 * call site since which button is default-focused is contextual (Cancel is
 * primary when paired with Confirm; Confirm is primary when it stands alone).
 *
 * Centralising the `glyph` here is the rule that prevents drift — the
 * checkmark/xmark mapping is bound to the button's identity, never re-typed
 * at the call site. {@link Dialog} also inspects the resolved result set to
 * pick the title-bar variant (only `confirm` → info header with leading
 * `circle-info`; `confirm` + `cancel` → affirm header).
 *
 * @category Core
 * @example
 * ```typescript
 * Dialog.show({
 *     title:   'Delete record',
 *     message: 'This cannot be undone.',
 *     buttons: [
 *         { ...DialogButtons.Cancel, primary: true },
 *         DialogButtons.Confirm,
 *     ],
 * });
 * ```
 */
export const DialogButtons = {
    /** Affirm an action — emits `'confirm'`, carries the green-tinted `circle-check` glyph. Paired with {@link Cancel} for action prompts. */
    Confirm: { text: 'Confirm', result: 'confirm', glyph: 'circle-check', tint: 'var(--ts-ui-dialog-confirm-color)' },
    /** Acknowledge information — emits `'confirm'`, carries the green-tinted `circle-check` glyph. Stands alone on informational dialogs. */
    Ok:      { text: 'Ok',      result: 'confirm', glyph: 'circle-check', tint: 'var(--ts-ui-dialog-confirm-color)' },
    /** Reject an action — emits `'cancel'`, carries the red-tinted `xmark` glyph. Paired with {@link Confirm}. */
    Cancel:  { text: 'Cancel',  result: 'cancel',  glyph: 'xmark',        tint: 'var(--ts-ui-dialog-cancel-color)'  },
    /** Dismiss without choosing — emits `'close'`, carries the red-tinted `xmark` glyph (same icon family as cancel; the result value disambiguates). */
    Close:   { text: 'Close',   result: 'close',   glyph: 'xmark',        tint: 'var(--ts-ui-dialog-cancel-color)'  },
} as const satisfies Record<string, DialogButtonConfig>;

/** Default button set when no buttons are supplied in config. */
const DEFAULT_BUTTONS: DialogButtonConfig[] = [
    { ...DialogButtons.Ok, primary: true },
];

/**
 * A modal dialog component with a title bar, scrollable content area, and button row.
 *
 * Use the static `Dialog.show(config)` convenience method for one-shot confirm/cancel
 * prompts, or construct an instance and call `show()` for fine-grained control.
 *
 * @example
 * ```typescript
 * const result = await Dialog.show({
 *     title  : 'Confirm deletion',
 *     message: 'Are you sure you want to delete this record?',
 *     buttons: [
 *         { text: 'Delete', result: 'confirm', primary: true },
 *         { text: 'Cancel', result: 'cancel' },
 *     ],
 * });
 * if (result === 'confirm') { ... }
 * ```
 *
 * @category Core
 */
class Dialog extends Component implements DismissableLayer {

    private readonly _titleBar        : DialogTitleBar;
    private readonly _contentContainer: Panel;
    private readonly _buttonRow       : DialogButtonRow;
    private readonly _backdrop        : DialogBackdrop;
    private readonly _config          : DialogConfig;

    private _resolvePromise  : ((result: DialogResult) => void) | null = null;
    private _previousFocus   : Handle | null = null;
    private _boundKeyHandler : (e: KeyboardEvent) => Event.ListenerResult;
    private _boundResizeHandler: () => void;

    // In-flight entrance / dismiss animations for the panel and its backdrop,
    // cancelled on teardown so their fallback timers cannot fire against
    // released element handles.
    private _panelInAnimation    : Animation.CancelHandle | null = null;
    private _backdropInAnimation : Animation.CancelHandle | null = null;
    private _panelOutAnimation   : Animation.CancelHandle | null = null;
    private _backdropOutAnimation: Animation.CancelHandle | null = null;

    // Queued post-layout callbacks, cancelled on teardown so a dispose landing
    // before the flush cannot touch a torn-down component.
    private _resizeToContentLayout: { cancel(): void } | null = null;
    private _focusFirstLayout:      { cancel(): void } | null = null;

    // True once `hide()`'s finalize has begun. `finalize` calls `destructor()`
    // partway through and finishes the rest afterwards, so the destructor uses
    // this to tell "reached from a completing hide" (leave the remainder to
    // finalize) from "reached from a bare dispose" (run it here, because the
    // cancelled dismiss animation will never call finalize at all).
    private _finalizing: boolean = false;

    /**
     * Constructs a Dialog but does not display it. Call `show()` to open.
     *
     * @param config - Dialog configuration.
     */
    constructor(config: DialogConfig) {
        super();

        this._config    = config;

        const dialogWidth  = Math.max(MIN_DIALOG_WIDTH, config.width ?? 480);
        const buttons      = config.buttons ?? DEFAULT_BUTTONS;
        const contentHeight = Math.max(MIN_CONTENT_HEIGHT, this.computeContentHeight(config));
        const dialogHeight  = Math.max(
            MIN_DIALOG_HEIGHT,
            config.height ?? (TITLE_HEIGHT + contentHeight + BUTTON_HEIGHT)
        );

        this.setPosition(Position.FIXED);
        this.setWidth(dialogWidth);
        this.setHeight(dialogHeight);
        // z-index is stamped from LayerManager's Dialog band at open() time
        // so stacked dialogs ascend monotonically; the backdrop is set one
        // below the panel there.
        this.setBackgroundColor("var(--ts-ui-body-bg)");
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setShadow("var(--ts-ui-dialog-shadow)");
        this.setOverflow("hidden");
        // Fixed dimensions, hidden overflow, no escaping descendants — full strict containment.
        this.setContain("strict");

        const layout = new BorderLayout();
        layout.setComponentSpacing(0);
        this.setLayoutManager(layout);

        this._titleBar = new DialogTitleBar(config.title, () => this.hide('close'), config.dismissable !== false);
        this.addComponent(this._titleBar, { placement: Placement.NORTH });

        // An explicit severity tone wins over the tone derived from the buttons,
        // so an error/warning dialog reads as such regardless of its footer.
        if (config.severity) {
            this.applySeverityHeader(config.severity);
        } else {
            this.applyHeaderVariant(this.computeHeaderVariant(buttons));
        }

        // A Panel (not a bare Component) so the content area is a real scroll
        // region: `autoScroll: "y"` opts it into the framework's overflow
        // handling, and — because Panel does not clamp itself to its content size
        // (`clampsToContentSize` is false) — a dialog capped shorter than its
        // content (see resizeToContent) shrinks this container to the available
        // space and scrolls, instead of a bare Component flooring to its content
        // height and clipping. Vertical only: a horizontal scrollbar would cover
        // the bottom rows of body text and is rarely useful for dialog content.
        // Zero insets so content sits flush, matching the former bare container.
        this._contentContainer = new Panel({
            autoScroll:    "y",
            layoutManager: new Fit(),
            insets:        new Insets(0, 0, 0, 0),
        });

        if (config.contentComponent) {
            this._contentContainer.addComponent(config.contentComponent);
        } else {
            const messageText = new SelectableText(config.message ?? '');
            messageText.setWhiteSpace("normal");
            messageText.setWordBreak("break-word");
            messageText.setPadding(new Insets(16, 16, 16, 16));
            this._contentContainer.addComponent(messageText);
        }

        this.addComponent(this._contentContainer, { placement: Placement.CENTER });

        this._buttonRow = new DialogButtonRow(buttons, (result) => this.hide(result));
        this.addComponent(this._buttonRow, { placement: Placement.SOUTH });

        this._backdrop = new DialogBackdrop();

        this._boundKeyHandler    = (e: KeyboardEvent) => this.onKeyDown(e);
        this._boundResizeHandler = () => this.onViewportResize();
    }

    /**
     * Picks the title-bar tint variant for this dialog by inspecting the set
     * of button results. The variant is derived from the buttons rather than
     * a config flag so callers cannot signal one intent via buttons and a
     * conflicting intent via a separate option.
     *
     * @param buttons - The resolved button configuration array.
     * @returns `'info'` for a single confirm-result button (informational
     *          dialog), `'affirm'` when both confirm and cancel are present
     *          (affirmative-action dialog), `'plain'` otherwise.
     */
    private computeHeaderVariant(buttons: DialogButtonConfig[]): 'info' | 'affirm' | 'plain' {
        const results = new Set(buttons.map(b => b.result ?? 'cancel'));

        if (results.size === 1 && results.has('confirm')) {
            return 'info';
        }

        if (results.has('confirm') && results.has('cancel')) {
            return 'affirm';
        }

        return 'plain';
    }

    /**
     * Applies the chosen header variant's background, title-text foreground,
     * and (for the info variant only) a leading `circle-info` glyph. The
     * close button inside the title bar is intentionally untouched — dismiss
     * affordances stay on `currentColor` per the modal-glyph-theming rule.
     *
     * @param variant - One of `'info'`, `'affirm'`, or `'plain'`.
     */
    private applyHeaderVariant(variant: 'info' | 'affirm' | 'plain'): void {
        if (variant === 'plain') {
            return;
        }

        const bgVar = variant === 'info' ? 'var(--ts-ui-dialog-info-bg)' : 'var(--ts-ui-dialog-affirm-bg)';
        const fgVar = variant === 'info' ? 'var(--ts-ui-dialog-info-fg)' : 'var(--ts-ui-dialog-affirm-fg)';

        this._titleBar.setBackgroundColor(bgVar);
        this._titleBar.getTitleText().setForegroundColor(fgVar);

        if (variant === 'info') {
            this._titleBar.setGlyph('circle-info');

            const headerGlyph = this._titleBar.getGlyph();

            if (headerGlyph !== null) {
                headerGlyph.setForegroundColor(fgVar);
            }
        }
    }

    /**
     * Tints the title bar for an explicit {@link DialogSeverity}, reusing the
     * notification severity palette and leading glyph (matching the
     * notification-detail dialog). The border colour doubles as the title-text
     * and glyph foreground, as it does for a notification.
     *
     * @param severity - The severity tone to apply.
     */
    private applySeverityHeader(severity: DialogSeverity): void {
        const bgVar = `var(--ts-ui-notification-${severity}-bg)`;
        const fgVar = `var(--ts-ui-notification-${severity}-border)`;

        this._titleBar.setBackgroundColor(bgVar);
        this._titleBar.getTitleText().setForegroundColor(fgVar);
        this._titleBar.setGlyph(SEVERITY_GLYPH[severity]);

        const headerGlyph = this._titleBar.getGlyph();

        if (headerGlyph !== null) {
            headerGlyph.setForegroundColor(fgVar);
        }
    }

    /**
     * Computes the default content area height based on config.
     *
     * @param config - Dialog configuration.
     * @returns Height in pixels for the content region.
     *
     * @remarks
     * Content whose height depends on its width — a wrapping {@link Text} only
     * knows its line count once laid out — reports a single-line height here,
     * before it has been sized. {@link resizeToContent}, scheduled after the
     * first layout in {@link open}, re-fits the dialog once the content has
     * settled at the dialog width.
     */
    private computeContentHeight(config: DialogConfig): number {
        if (config.contentComponent) {
            const ps = config.contentComponent.getPreferredSize();

            if (ps) {
                return ps.height;
            }
        }

        return 100;
    }

    /**
     * Displays the dialog, attaches event listeners, and returns a promise that
     * resolves when the dialog is dismissed.
     *
     * @returns A promise resolving to the [`DialogResult`](/api/overlay/type-aliases/DialogResult) of the closing action.
     */
    show(): Promise<DialogResult> {
        return new Promise((resolve) => {
            this._resolvePromise = resolve;
            this.open();
        });
    }

    /**
     * Re-fits the dialog's height to its content's current preferred size and
     * re-centres it. A dialog's height is otherwise fixed at construction, so a
     * form whose content grows or shrinks after `show()` (e.g. add/remove rows)
     * is stretched or clipped to the original box; call this after mutating the
     * content so the dialog tracks it.
     *
     * The new height is `TITLE_HEIGHT + content + BUTTON_HEIGHT`, floored at the
     * dialog minimum and capped so the panel keeps a margin from the top and
     * bottom viewport edges — past that cap the content area scrolls (its
     * container is already `overflow-y: auto`). No-op before `show()` (nothing to
     * re-centre) and when the height is unchanged. Width is untouched.
     *
     * @returns This dialog, for method chaining.
     */
    resizeToContent(): this {
        if (!this.getElement()) {
            return this;
        }

        const contentHeight = Math.max(MIN_CONTENT_HEIGHT, this.computeContentHeight(this._config));
        const target        = Math.max(MIN_DIALOG_HEIGHT, TITLE_HEIGHT + contentHeight + BUTTON_HEIGHT);

        const vp     = DOM.source.getViewportSize();
        const capped = Math.min(target, Math.max(MIN_DIALOG_HEIGHT, vp.height - DIALOG_VIEWPORT_MARGIN * 2));

        if (capped === this.getHeight()) {
            return this;
        }

        this.setHeight(capped);
        this.scheduleLayout();
        this.center();

        return this;
    }

    /**
     * Appends backdrop and dialog to the DOM, centers the panel, and captures focus.
     */
    private open(): void {
        this._previousFocus = DOM.source.getActiveElement();

        if (this._config.closeOnBackdrop && this._config.dismissable !== false) {
            this._backdrop.addClickListener(() => { this.hide('close'); });
        }

        // Join the central layer tree and stamp the panel from the Dialog
        // band; the backdrop sits one below the panel so stacked dialogs keep
        // each panel above its own backdrop.
        LayerManager.register(this);

        const panelZ = LayerManager.getZIndex(this);
        this.setZIndex(panelZ);
        this._backdrop.setZIndex(panelZ - 1);

        const backdropEl = this._backdrop.getElement(true)!;
        LayerManager.mount(backdropEl);

        const dialogEl = this.getElement(true)!;
        LayerManager.mount(dialogEl);

        // Trap wheels no inner scroller claimed so the content behind a modal
        // dialog stays inert, matching modality.
        trapWheel(this);

        this.scheduleLayout();
        this.center();
        this.animateIn();

        // The construction-time height assumed single-line content; once the
        // first layout has sized the content at the dialog width, content whose
        // height depends on width (wrapping Text) has settled, so re-fit to it.
        // A no-op for content whose height did not change (resizeToContent bails
        // when the height is unchanged), so only width-dependent content reflows.
        this._resizeToContentLayout = Component.afterNextLayout(() => this.resizeToContent());

        Event.addViewportListener(this, 'keydown', this._boundKeyHandler);
        Event.addViewportListener(this, 'resize', this._boundResizeHandler);

        // Deferred past the scheduled layout: focusing synchronously here does
        // land on the right element, but the first layout then wraps the content
        // in its frame and re-parents the subtree into it. Moving a focused
        // element out of the document blurs it — silently, with no blur event —
        // so the focus is undone a frame later and lands nowhere.
        this._focusFirstLayout = Component.afterNextLayout(() => this.focusFirst());
    }

    /**
     * Fades the backdrop in and the dialog panel in from `opacity: 0` +
     * `scale(0.97)` to `opacity: 1` + `scale(1)` over 150ms. No-op when
     * `prefers-reduced-motion: reduce` is set.
     */
    private animateIn(): void {
        const el   = this.getElement();
        const bdEl = this._backdrop.getElement();

        if (!el) {
            return;
        }

        this._panelInAnimation?.cancel();
        this._panelInAnimation = Animation.play(el, {
            from:       { opacity: "0", transform: "scale(0.97)" },
            to:         { opacity: "1", transform: "scale(1)"    },
            durationMs: DIALOG_ANIM_DURATION_MS,
            properties: ["opacity", "transform"],
        });

        if (bdEl) {
            this._backdropInAnimation?.cancel();
            this._backdropInAnimation = Animation.play(bdEl, {
                from:       { opacity: "0" },
                to:         { opacity: "1" },
                durationMs: DIALOG_ANIM_DURATION_MS,
                properties: ["opacity"],
            });
        }
    }

    /**
     * Centers the dialog panel within the viewport.
     */
    private center(): void {
        const vp = DOM.source.getViewportSize();
        const x  = Math.max(0, Math.round((vp.width  - this.getWidth())  / 2));
        const y  = Math.max(0, Math.round((vp.height - this.getHeight()) / 2));

        this.setX(x);
        this.setY(y);
    }

    /**
     * Moves initial focus into the dialog. Prefers the configured
     * `initialFocus` component, then the first focusable element in the content
     * region, so a form field — not the title-bar close button, which is first in
     * DOM order — receives focus on open. Falls back to the primary action
     * button, then to the first focusable element anywhere in the dialog.
     *
     * @remarks Must run after the dialog's first layout, which re-parents the
     * content into its frame and would blur anything focused before it.
     */
    private focusFirst(): void {
        const requested = this.requestedFocusElement();

        if (requested) {
            DOM.sink.focus(requested);

            return;
        }

        const contentEl = this._contentContainer.getElement();
        const inContent = contentEl ? DOM.source.querySelectorAll(contentEl, FOCUSABLE_SELECTOR) : [];

        if (inContent.length > 0) {
            DOM.sink.focus(inContent[0]);

            return;
        }

        const primary = this.primaryButtonElement();

        if (primary) {
            DOM.sink.focus(primary);

            return;
        }

        const el        = this.getElement();
        const focusable = el ? DOM.source.querySelectorAll(el, FOCUSABLE_SELECTOR) : [];

        if (focusable.length > 0) {
            DOM.sink.focus(focusable[0]);
        }
    }

    /**
     * Resolves the configured `initialFocus` component to the element that
     * should take focus: the component's own root element when it is itself
     * focusable (a `TextField` renders as the `<input>`), otherwise its first
     * focusable descendant (a `Panel` wrapping a field).
     *
     * @returns The element to focus, or `null` when no `initialFocus` is
     *   configured or it offers nothing focusable — both of which fall through
     *   to the default order.
     */
    private requestedFocusElement(): Handle | null {
        const component = this._config.initialFocus;
        const element   = component?.getElement();

        if (!element) {
            return null;
        }

        if (DOM.source.matches(element, FOCUSABLE_SELECTOR)) {
            return element;
        }

        return DOM.source.querySelector(element, FOCUSABLE_SELECTOR);
    }

    /**
     * Returns the DOM element of the primary action button, used as the initial
     * focus target when the content region has nothing focusable. Resolves by
     * position: the index of the `primary` entry in the resolved button set maps
     * to the same-indexed focusable in the button row.
     *
     * @returns The primary button element, or `null` when none is primary or the
     *   row is not yet rendered.
     */
    private primaryButtonElement(): Handle | null {
        const buttons = this._config.buttons ?? DEFAULT_BUTTONS;
        const index   = buttons.findIndex(b => b.primary);

        if (index < 0) {
            return null;
        }

        const rowEl = this._buttonRow.getElement();
        const focusable = rowEl ? DOM.source.querySelectorAll(rowEl, FOCUSABLE_SELECTOR) : [];

        return focusable[index] ?? null;
    }

    /**
     * Collects all currently focusable elements inside the dialog.
     *
     * @returns An array of focusable elements in DOM order.
     */
    private getFocusable(): Handle[] {
        const el = this.getElement();

        if (!el) {
            return [];
        }

        return DOM.source.querySelectorAll(el, FOCUSABLE_SELECTOR)
            .filter(el => !DOM.source.hasAttribute(el, 'disabled'));
    }

    /**
     * Handles document-level keydown events for Escape and Tab focus trapping.
     *
     * @param e - The keyboard event.
     * @returns A stop-and-prevent disposition when the dialog handles the key (the Tab trap, or Enter); nothing otherwise, so unhandled keys keep propagating.
     */
    private onKeyDown(e: KeyboardEvent): Event.ListenerResult {
        // Escape is owned by LayerManager's keydown handler, which closes the
        // topmost non-manual layer (this dialog when it is on top). The dialog
        // keeps only the Tab focus-trap and the Enter-confirms-the-primary
        // shortcut here.
        //
        // Both are scoped to "I am the topmost layer": every open Dialog gets
        // this same keydown broadcast (that's the event dispatcher's policy,
        // and other consumers rely on it — see Event.addViewportListener), so
        // a backgrounded Dialog stacked under another one must not act on a
        // key meant for whichever Dialog is actually on top. Without this, a
        // "name this preset" prompt opened from inside a login dialog would
        // have Enter in its field also confirm the login dialog underneath.
        if (!LayerManager.isTopmostInputLayer(this)) {
            return;
        }

        if (e.key === 'Enter') {
            return this.onEnter(e);
        }

        if (e.key === 'Tab') {
            const focusable = this.getFocusable();

            if (focusable.length === 0) {
                return { stop: true, prevent: true };
            }

            const first = focusable[0];
            const last  = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (DOM.source.getActiveElement() === first) {
                    DOM.sink.focus(last);

                    return { stop: true, prevent: true };
                }
            } else {
                if (DOM.source.getActiveElement() === last) {
                    DOM.sink.focus(first);

                    return { stop: true, prevent: true };
                }
            }
        }

        return;
    }

    /**
     * Confirms the dialog on Enter by simulating a click on the primary
     * button — see {@link DialogButtonRow.confirmPrimary} — so a simple form
     * submits like one without the caller wiring Enter itself, and a guarded
     * primary action (e.g. an async `onClick` that does the dialog's real
     * work and only closes on success) runs exactly as it would from a real
     * click, rather than being skipped in favour of an unconditional close.
     *
     * @remarks Deliberately inert when focus is on a `<textarea>` or a
     * `contenteditable` host (a live `CodeEditor`'s CodeMirror surface is a
     * `contenteditable` element, not a `<textarea>` — both need Enter to
     * insert a newline, not confirm the dialog), or on a `<button>` (the
     * button activates itself on Enter, and hijacking it would fire the
     * wrong action). No-op when no button is marked `primary`, so a dialog
     * with no clear default action does not submit blind.
     *
     * @param _e - The keydown event for the Enter press.
     * @returns `{ stop: true, prevent: true }` when Enter confirms the dialog; nothing when there is nothing to confirm.
     */
    private onEnter(_e: KeyboardEvent): Event.ListenerResult {
        const active = DOM.source.getActiveElement();
        const tag    = active ? DOM.source.getTagName(active).toLowerCase() : null;

        if (tag === 'textarea' || tag === 'button') {
            return;
        }

        if (active && DOM.source.hasAttribute(active, 'contenteditable')) {
            return;
        }

        if (!this._buttonRow.confirmPrimary()) {
            return;
        }

        return { stop: true, prevent: true };
    }

    /**
     * Re-fits the dialog to the resized viewport: {@link Dialog.resizeToContent}
     * grows it back toward its content when the viewport gained room, or caps it
     * (so the content area scrolls) when the viewport shrank below the content —
     * keeping the dialog within the viewport instead of overflowing it. The
     * backdrop is resized to the new viewport and the panel re-centred (again
     * unconditionally here, since `resizeToContent` skips re-centring when the
     * height is unchanged).
     */
    private onViewportResize(): void {
        this._backdrop.resize();
        this.resizeToContent();
        this.center();
    }

    /**
     * Dismisses the dialog with a brief fade-and-scale animation, restores
     * focus, and resolves the promise.
     *
     * @param result - The result to resolve the promise with.
     *
     * @remarks Honours `prefers-reduced-motion: reduce` — the transition is
     * skipped when motion is reduced.
     */
    hide(result: DialogResult): this {
        Event.removeViewportListener(this, 'keydown', this._boundKeyHandler);
        Event.removeViewportListener(this, 'resize', this._boundResizeHandler);

        const finalize = (): void => {
            this._finalizing = true;

            this._backdrop.destroy();
            this.removeElement();
            this.destructor();

            LayerManager.unregister(this);
            untrapWheel(this);

            if (this._previousFocus !== null) {
                DOM.sink.focus(this._previousFocus);
            }

            if (this._resolvePromise) {
                this._resolvePromise(result);
                this._resolvePromise = null;
            }
        };

        const el   = this.getElement();
        const bdEl = this._backdrop.getElement();

        if (!el) {
            finalize();
            return this;
        }

        this._panelOutAnimation?.cancel();
        this._panelOutAnimation = Animation.play(el, {
            to:         { opacity: "0", transform: "scale(0.97)" },
            durationMs: DIALOG_ANIM_DURATION_MS,
            properties: ["opacity", "transform"],
            onComplete: finalize,
        });

        if (bdEl) {
            this._backdropOutAnimation?.cancel();
            this._backdropOutAnimation = Animation.play(bdEl, {
                to:         { opacity: "0" },
                durationMs: DIALOG_ANIM_DURATION_MS,
                properties: ["opacity"],
            });
        }

        return this;
    }

    /**
     * Cancels any in-flight panel / backdrop animation, then defers to the base
     * class. Reached from `hide()`'s completion callback as well as from a
     * direct dispose: on that path the dismiss animation is already finished, so
     * cancelling it is a no-op.
     */
    protected destructor(): void {
        this._panelInAnimation?.cancel();
        this._panelInAnimation = null;
        this._backdropInAnimation?.cancel();
        this._backdropInAnimation = null;
        this._panelOutAnimation?.cancel();
        this._panelOutAnimation = null;
        this._backdropOutAnimation?.cancel();
        this._backdropOutAnimation = null;
        this._resizeToContentLayout?.cancel();
        this._resizeToContentLayout = null;
        this._focusFirstLayout?.cancel();
        this._focusFirstLayout = null;

        // A dispose that lands mid-dismiss cancels the animation whose
        // completion callback owns the rest of teardown, so run that work here.
        // The backdrop is a private field rather than a registered child, so the
        // base class's recursion cannot reach it and it would otherwise stay
        // mounted over the whole app; the promise `show()` handed the caller
        // would never settle. Skipped when `finalize` is already running, which
        // reaches this method partway through and completes the rest itself —
        // including resolving with the caller's real result rather than the
        // `"close"` stand-in used here.
        if (!this._finalizing) {
            this._backdrop.destroy();

            LayerManager.unregister(this);
            untrapWheel(this);

            if (this._resolvePromise) {
                this._resolvePromise('close');
                this._resolvePromise = null;
            }
        }

        super.destructor();
    }

    /**
     * Returns the content container component where custom content is rendered.
     *
     * @returns The content container [`Component`](/api/core/classes/Component).
     */
    getContentComponent(): Component {
        return this._contentContainer;
    }

    /**
     * The dialog sizes itself explicitly — its height is computed to fit its
     * content at construction and re-fit (capped to the viewport) in
     * {@link Dialog.resizeToContent} — so it must not additionally floor itself
     * to its content's min-size. If it did, a dialog whose content is taller
     * than the viewport could not shrink to the capped height, and its
     * `autoScroll` content container would never get the constrained space it
     * needs to scroll (it would clip instead). The `MIN_DIALOG_HEIGHT` floor is
     * applied explicitly wherever the height is set.
     */
    protected clampsToContentSize(): boolean {
        return false;
    }

    /**
     * Returns the dialog's title-bar component.
     *
     * @returns The internal title-bar instance, exposing `getTitleText()` and
     *          `setGlyph()` for callers (e.g. the notification detail dialog)
     *          that need to tint or decorate the header.
     *
     * @remarks
     * The `DialogTitleBar` class itself is not exported — callers reach it
     * only through this accessor and interact via its few public methods
     * (`getTitleText`, `setGlyph`, `getGlyph`).
     */
    getTitleBar(): DialogTitleBar {
        return this._titleBar;
    }

    // ----- DismissableLayer -----

    /**
     * Returns the dialog panel's root element for the central layer tree.
     *
     * @returns The dialog's element, or null when not yet rendered.
     */
    getLayerElement(): Handle | null {
        return this.getElement() ?? null;
    }

    /**
     * Returns the dismiss mode the document-level handlers consult. A dialog
     * is `"modal"`: the manager neither dismisses ancestors on an outside
     * interaction nor lets one fall through, and it owns the Escape-to-close
     * shortcut. The dialog keeps its own Tab focus-trap.
     *
     * @returns The layer dismiss mode.
     */
    getDismissMode(): LayerDismissMode {
        return "modal";
    }

    /**
     * Advisory close request from the manager — closes the dialog with the
     * `'close'` result, matching the title-bar close affordance.
     *
     * @remarks No-op when `dismissable` is `false`: this is the Escape path
     * (`LayerManager` routes Escape to the topmost non-`"manual"` layer's
     * `requestClose()`), so a mandatory modal swallows Escape rather than
     * closing. `getDismissMode()` deliberately stays `"modal"` here — a
     * `"manual"` layer would be skipped by the Escape loop, letting Escape
     * fall through to close a layer beneath this one.
     */
    requestClose(): void {
        if (this._config.dismissable === false) {
            return;
        }

        this.hide('close');
    }

    /**
     * Returns the dialog's z-index band so unrelated dialogs stack above
     * every other overlay family.
     *
     * @returns The dialog band base.
     */
    getBand(): number {
        return LayerManager.Band.Dialog;
    }

    /**
     * Displays a modal dialog and returns a promise that resolves on dismissal.
     *
     * @param config - Dialog configuration.
     * @returns A promise resolving to the [`DialogResult`](/api/overlay/type-aliases/DialogResult) of the closing action.
     *
     * @example
     * ```typescript
     * const result = await Dialog.show({ title: 'Confirm', message: 'Proceed?' });
     * ```
     */
    static show(config: DialogConfig): Promise<DialogResult> {
        const dialog = new Dialog(config);

        return dialog.show();
    }

    /**
     * Displays a confirm/cancel dialog and resolves to `true` when the user confirms.
     *
     * Buttons are ordered Cancel (default focus) then Confirm, so pressing Enter or
     * Escape both safely default to cancellation.
     *
     * @param title - Text displayed in the title bar.
     * @param message - Body message shown in the content area.
     * @returns A promise resolving to `true` if the user clicked Confirm, `false` otherwise.
     *
     * @example
     * ```typescript
     * if (await Dialog.confirm('Delete record', 'This cannot be undone.')) {
     *     store.remove(record);
     * }
     * ```
     */
    static async confirm(title: string, message: string): Promise<boolean> {
        const result = await Dialog.show({
            title,
            message,
            buttons: [
                { ...DialogButtons.Cancel, primary: true },
                DialogButtons.Confirm,
            ],
        });

        return result === 'confirm';
    }

    /**
     * Displays a severity-toned dialog with a single OK button and resolves once
     * the user acknowledges it. Shared by the {@link Dialog.info} /
     * {@link Dialog.success} / {@link Dialog.warning} / {@link Dialog.error}
     * shorthands.
     *
     * @param severity - The title-bar severity tone (see {@link DialogConfig.severity}).
     * @param title - Text displayed in the title bar.
     * @param message - Body message shown in the content area.
     */
    private static async alert(severity: DialogSeverity, title: string, message: string): Promise<void> {
        await Dialog.show({
            title,
            message,
            severity,
            buttons: [{ ...DialogButtons.Ok, primary: true }],
        });
    }

    /**
     * Displays an info-toned dialog with a single OK button and resolves once the
     * user acknowledges it.
     *
     * @param title - Text displayed in the title bar.
     * @param message - Body message shown in the content area.
     *
     * @example
     * ```typescript
     * await Dialog.info('Import complete', 'Loaded 1,204 rows.');
     * ```
     */
    static info(title: string, message: string): Promise<void> {
        return Dialog.alert('info', title, message);
    }

    /**
     * Displays a success-toned dialog with a single OK button and resolves once
     * the user acknowledges it.
     *
     * @param title - Text displayed in the title bar.
     * @param message - Body message shown in the content area.
     *
     * @example
     * ```typescript
     * await Dialog.success('Saved', 'Your changes have been stored.');
     * ```
     */
    static success(title: string, message: string): Promise<void> {
        return Dialog.alert('success', title, message);
    }

    /**
     * Displays a warning-toned dialog with a single OK button and resolves once
     * the user acknowledges it.
     *
     * @param title - Text displayed in the title bar.
     * @param message - Body message shown in the content area.
     *
     * @example
     * ```typescript
     * await Dialog.warning('Unsaved changes', 'They will be lost if you continue.');
     * ```
     */
    static warning(title: string, message: string): Promise<void> {
        return Dialog.alert('warning', title, message);
    }

    /**
     * Displays an error-toned dialog with a single OK button and resolves once
     * the user acknowledges it. The title bar carries the error severity tint and
     * glyph (see {@link DialogConfig.severity}).
     *
     * @param title - Text displayed in the title bar.
     * @param message - Body message shown in the content area.
     *
     * @example
     * ```typescript
     * await Dialog.error('Connection failed', 'Host not allowed.');
     * ```
     */
    static error(title: string, message: string): Promise<void> {
        return Dialog.alert('error', title, message);
    }
}

const DialogCallable = callable(Dialog);
type DialogCallable = Dialog;
export {
    Dialog         as _Dialog,
    DialogCallable as Dialog,
    DialogTitleBar
};
