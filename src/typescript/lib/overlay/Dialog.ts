// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Animation } from "~/core/Animation.js";
import { Event } from "~/core/Event.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { trapWheel, untrapWheel } from "~/core/WheelTrap.js";
import { Position } from "~/primitive/Position.js";
import { Text } from "~/component/input/Text.js";
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
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

Glyph.register(xmark, circle_check, circle_info);

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
}

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
    private readonly _closeButton: Button;
    private _titleGlyph: Glyph | null = null;

    /**
     * @param title - Text to display in the title bar.
     * @param onClose - Called when the user clicks the close button.
     */
    constructor(title: string, onClose: () => void) {
        super();

        this.setBackgroundColor("var(--ts-ui-body-bg)");
        this.setBorder({
            border:       "none",
            borderBottom: "1px solid var(--ts-ui-dialog-border)",
        });
        this.setPreferredSize(0, TITLE_HEIGHT);

        this._titleText = new Text(title);
        this._titleText.setFontWeight("bold");
        this._titleText.setOverflow("hidden");
        this._titleText.setTextOverflow("ellipsis");
        this._titleText.setWhiteSpace("nowrap");
        // Centre the label within the inner area of the row (TITLE_HEIGHT
        // minus the top + bottom TITLE_V_PAD breathing room).
        this._titleText.centerInHeight(TITLE_HEIGHT - TITLE_V_PAD * 2);
        this.addComponent(this._titleText);

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
        this._closeButton.setPreferredSize(CLOSE_SIZE, CLOSE_SIZE);
        this.addComponent(this._closeButton);

        this._closeButton.on("action", onClose);
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

        const glyph = new Glyph(name);
        glyph.setPointerEvents("none");
        glyph.setPreferredSize(16, 16);
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
     * the title bar bounds.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const w       = this.getWidth();
        const h       = this.getHeight();
        const closeX  = w - CLOSE_SIZE - TITLE_RIGHT_GAP;
        const centerY = Math.floor((h - CLOSE_SIZE) / 2);

        let labelX = TITLE_H_PAD;

        if (this._titleGlyph) {
            const glyphSize = this._titleGlyph.getPreferredSize() ?? { width: 16, height: 16 };
            const glyphY    = Math.max(0, Math.floor((h - glyphSize.height) / 2));

            this._titleGlyph.setX(TITLE_H_PAD);
            this._titleGlyph.setY(glyphY);
            this._titleGlyph.setWidth(glyphSize.width);
            this._titleGlyph.setHeight(glyphSize.height);

            labelX = TITLE_H_PAD + glyphSize.width + TITLE_GLYPH_TEXT_GAP;
        }

        // Reserve TITLE_RIGHT_GAP of space between the label and the close button.
        const labelWidth = Math.max(0, closeX - labelX - TITLE_RIGHT_GAP);
        const labelH     = h - TITLE_V_PAD * 2;

        this._titleText.setX(labelX);
        this._titleText.setY(TITLE_V_PAD);
        this._titleText.setWidth(labelWidth);
        this._titleText.setHeight(labelH);

        this._closeButton.setX(closeX);
        this._closeButton.setY(centerY);
        this._closeButton.setWidth(CLOSE_SIZE);
        this._closeButton.setHeight(CLOSE_SIZE);
        // setX/setY/setWidth/setHeight don't cascade — explicitly relayout the
        // close button so its internal Fit layout sizes the times glyph.
        this._closeButton.doLayout();

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

    private readonly _buttons: Button[] = [];

    /**
     * @param configs - Button definitions to render.
     * @param onButton - Called with the resolved [`DialogResult`](/api/overlay/type-aliases/DialogResult) when any button is clicked.
     */
    constructor(configs: DialogButtonConfig[], onButton: (result: DialogResult) => void) {
        super();

        this.setBorder({
            border:    "none",
            borderTop: "1px solid var(--ts-ui-dialog-border)",
        });
        this.setBackgroundColor("var(--ts-ui-body-bg)");
        this.setPreferredSize(0, BUTTON_HEIGHT);

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

            btn.on("action", () => onButton(result));
            this._buttons.push(btn);
            this.addComponent(btn);
        }
    }

    /**
     * Positions buttons right-aligned within the footer row.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const w         = this.getWidth();
        const h         = this.getHeight();
        const btnH      = h - BUTTON_V_PAD * 2;
        const totalW    = this._buttons.length * BUTTON_WIDTH + (this._buttons.length - 1) * BUTTON_GAP;
        let   x         = Math.round((w - totalW) / 2);

        for (const btn of this._buttons) {
            btn.setX(x);
            btn.setY(BUTTON_V_PAD);
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
    private readonly _contentContainer: Component;
    private readonly _buttonRow       : DialogButtonRow;
    private readonly _backdrop        : DialogBackdrop;
    private readonly _config          : DialogConfig;

    private _resolvePromise  : ((result: DialogResult) => void) | null = null;
    private _previousFocus   : Handle | null = null;
    private _boundKeyHandler : (e: KeyboardEvent) => void;
    private _boundResizeHandler: () => void;

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

        this._titleBar = new DialogTitleBar(config.title, () => this.hide('close'));
        this.addComponent(this._titleBar, { placement: Placement.NORTH });

        this.applyHeaderVariant(this.computeHeaderVariant(buttons));

        this._contentContainer = new Component();
        this._contentContainer.setLayoutManager(new Fit());
        // Vertical scrolling only — a horizontal scrollbar would cover the
        // bottom rows of body text and is rarely useful for dialog content.
        this._contentContainer.setOverflowY("auto");
        this._contentContainer.setOverflowX("hidden");

        if (config.contentComponent) {
            this._contentContainer.addComponent(config.contentComponent);
        } else {
            const messageText = new Text(config.message ?? '');
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

        if (this._config.closeOnBackdrop) {
            this._backdrop.addClickListener(() => this.hide('close'));
        }

        // Join the central layer tree and stamp the panel from the Dialog
        // band; the backdrop sits one below the panel so stacked dialogs keep
        // each panel above its own backdrop.
        LayerManager.register(this);

        const panelZ = LayerManager.getZIndex(this);
        this.setZIndex(panelZ);
        this._backdrop.setZIndex(panelZ - 1);

        const backdropEl = this._backdrop.getElement(true)!;
        DOM.sink.appendChild(DOM.source.getDocumentElement(), backdropEl);

        const dialogEl = this.getElement(true)!;
        DOM.sink.appendChild(DOM.source.getDocumentElement(), dialogEl);

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
        Component.afterNextLayout(() => this.resizeToContent());

        Event.addViewportListener(this, 'keydown', this._boundKeyHandler);
        Event.addViewportListener(this, 'resize', this._boundResizeHandler);

        this.focusFirst();
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

        Animation.play(el, {
            from:       { opacity: "0", transform: "scale(0.97)" },
            to:         { opacity: "1", transform: "scale(1)"    },
            durationMs: DIALOG_ANIM_DURATION_MS,
            properties: ["opacity", "transform"],
        });

        if (bdEl) {
            Animation.play(bdEl, {
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
     * Moves initial focus into the dialog. Prefers the first focusable element
     * in the content region, so a form field — not the title-bar close button,
     * which is first in DOM order — receives focus on open. Falls back to the
     * primary action button, then to the first focusable element anywhere in the
     * dialog.
     */
    private focusFirst(): void {
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
     */
    private onKeyDown(e: KeyboardEvent): void {
        // Escape is owned by LayerManager's keydown handler, which closes the
        // topmost non-manual layer (this dialog when it is on top). The dialog
        // keeps only the Tab focus-trap and the Enter-confirms-the-primary
        // shortcut here.
        if (e.key === 'Enter') {
            this.onEnter(e);

            return;
        }

        if (e.key === 'Tab') {
            const focusable = this.getFocusable();

            if (focusable.length === 0) {
                e.preventDefault();
                return;
            }

            const first = focusable[0];
            const last  = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (DOM.source.getActiveElement() === first) {
                    e.preventDefault();
                    DOM.sink.focus(last);
                }
            } else {
                if (DOM.source.getActiveElement() === last) {
                    e.preventDefault();
                    DOM.sink.focus(first);
                }
            }
        }
    }

    /**
     * Confirms the dialog on Enter by resolving the primary button's result,
     * so a simple form submits like one without the caller wiring Enter itself.
     *
     * @remarks Deliberately inert when focus is on a `<textarea>` (Enter inserts
     * a newline) or on a `<button>` (the button activates itself on Enter, and
     * hijacking it would fire the wrong action). No-op when no button is marked
     * `primary`, so a dialog with no clear default action does not submit blind.
     *
     * @param e - The keydown event for the Enter press.
     */
    private onEnter(e: KeyboardEvent): void {
        const active = DOM.source.getActiveElement();
        const tag    = active ? DOM.source.getTagName(active).toLowerCase() : null;

        if (tag === 'textarea' || tag === 'button') {
            return;
        }

        const result = this.primaryResult();

        if (result === null) {
            return;
        }

        e.preventDefault();
        this.hide(result);
    }

    /**
     * Returns the result of the button marked `primary` in this dialog's
     * resolved button set — the action Enter confirms — or `null` when none is
     * primary.
     *
     * @returns The primary button's [`DialogResult`](/api/overlay/type-aliases/DialogResult), or `null`.
     */
    private primaryResult(): DialogResult | null {
        const buttons = this._config.buttons ?? DEFAULT_BUTTONS;
        const primary = buttons.find(b => b.primary);

        return primary ? (primary.result ?? 'cancel') : null;
    }

    /**
     * Re-centers the dialog and resizes the backdrop when the viewport changes.
     */
    private onViewportResize(): void {
        this._backdrop.resize();
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

        Animation.play(el, {
            to:         { opacity: "0", transform: "scale(0.97)" },
            durationMs: DIALOG_ANIM_DURATION_MS,
            properties: ["opacity", "transform"],
            onComplete: finalize,
        });

        if (bdEl) {
            Animation.play(bdEl, {
                to:         { opacity: "0" },
                durationMs: DIALOG_ANIM_DURATION_MS,
                properties: ["opacity"],
            });
        }

        return this;
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
     * Returns the dialog's title-bar component.
     *
     * @returns The internal title-bar instance, exposing `getText()` and
     *          `setGlyph()` for callers (e.g. the notification detail dialog)
     *          that need to tint or decorate the header.
     *
     * @remarks
     * The `DialogTitleBar` class itself is not exported — callers reach it
     * only through this accessor and interact via its few public methods
     * (`getText`, `setGlyph`, `getGlyph`).
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
     */
    requestClose(): void {
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
}

const DialogCallable = callable(Dialog);
type DialogCallable = Dialog;
export {
    Dialog         as _Dialog,
    DialogCallable as Dialog,
    DialogTitleBar
};
