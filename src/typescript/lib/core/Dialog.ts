// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Animation } from "~/core/Animation.js";
import { Position } from "~/primitive/Position.js";
import { Util } from "~/core/Util.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Text } from "~/component/input/Text.js";
import { Button } from "~/component/button/Button.js";
import { Glyph } from "~/component/display/Glyph.js";
import { DialogBackdrop } from "~/component/container/DialogBackdrop.js";
import { Border as BorderLayout } from "~/layout/Border.js";
import { Fit } from "~/layout/Fit.js";
import { Placement } from "~/primitive/Placement.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

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

/**
 * Shared duration (ms) for the dialog entrance/exit transition. The backdrop
 * fade and the panel's opacity + scale all run for this many milliseconds.
 */
const DIALOG_ANIM_DURATION_MS: number = 150;

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
 * Reach this instance via [`Dialog.getTitleBar()`](/api/core/classes/Dialog#gettitlebar) — there is no public
 * constructor. The supported surface is `getTitleText()` (for tinting the
 * title text colour), `setGlyph()` / `getGlyph()` (for the optional leading
 * icon), and any inherited [`Component`](/api/core/classes/Component) setter
 * (e.g. `setBackgroundColor`).
 *
 * @category Core
 */
class DialogTitleBar extends Component {

    private readonly titleText  : Text;
    private readonly closeButton: Button;
    private _titleGlyph: Glyph | null = null;

    /**
     * @param title - Text to display in the title bar.
     * @param onClose - Called when the user clicks the close button.
     */
    constructor(title: string, onClose: () => void) {
        super();

        this.setBackgroundColor("var(--ts-ui-body-bg)");
        this.setBorder({
            top   : { style: BorderStyle.NONE },
            right : { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-dialog-border)" },
            left  : { style: BorderStyle.NONE },
        });
        this.setPreferredSize(0, TITLE_HEIGHT);

        this.titleText = new Text(title);
        this.titleText.setFontWeight("bold");
        this.titleText.setOverflow("hidden");
        this.titleText.setTextOverflow("ellipsis");
        this.titleText.setWhiteSpace("nowrap");
        // Centre the label within the inner area of the row (TITLE_HEIGHT
        // minus the top + bottom TITLE_V_PAD breathing room).
        this.titleText.centerInHeight(TITLE_HEIGHT - TITLE_V_PAD * 2);
        this.addComponent(this.titleText);

        this.closeButton = new Button({ glyph: "times" });
        this.closeButton.setInsets(new Insets(0, 0, 0, 0));
        this.closeButton.setBorder({ style: BorderStyle.NONE });
        this.closeButton.clearBackgroundImage();
        this.closeButton.setBackgroundColor("transparent");
        this.closeButton.clearShadow();
        this.closeButton.clearPressedShadow();
        this.closeButton.setPreferredSize(CLOSE_SIZE, CLOSE_SIZE);
        this.addComponent(this.closeButton);

        this.closeButton.addActionListener(onClose);
    }

    /**
     * Returns the title-text component, for callers that need to tint or
     * otherwise restyle it from outside the title bar.
     *
     * @returns The internal title [`Text`](/api/component/input/classes/Text) instance.
     */
    getTitleText(): Text {
        return this.titleText;
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

        this.titleText.setX(labelX);
        this.titleText.setY(TITLE_V_PAD);
        this.titleText.setWidth(labelWidth);
        this.titleText.setHeight(labelH);

        this.closeButton.setX(closeX);
        this.closeButton.setY(centerY);
        this.closeButton.setWidth(CLOSE_SIZE);
        this.closeButton.setHeight(CLOSE_SIZE);
        // setX/setY/setWidth/setHeight don't cascade — explicitly relayout the
        // close button so its internal Fit layout sizes the times glyph.
        this.closeButton.doLayout();

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

    private readonly buttons: Button[] = [];

    /**
     * @param configs - Button definitions to render.
     * @param onButton - Called with the resolved [`DialogResult`](/api/core/type-aliases/DialogResult) when any button is clicked.
     */
    constructor(configs: DialogButtonConfig[], onButton: (result: DialogResult) => void) {
        super();

        this.setBorder({
            top   : { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-dialog-border)" },
            right : { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            left  : { style: BorderStyle.NONE },
        });
        this.setBackgroundColor("var(--ts-ui-body-bg)");
        this.setPreferredSize(0, BUTTON_HEIGHT);

        for (const cfg of configs) {
            const btn    = new Button(cfg.text, cfg.glyph !== undefined ? { glyph: cfg.glyph } : undefined);
            const result = cfg.result ?? 'cancel';

            if (cfg.primary) {
                btn.setBackgroundImage("var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))");
            }

            btn.addActionListener(() => onButton(result));
            this.buttons.push(btn);
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
        const totalW    = this.buttons.length * BUTTON_WIDTH + (this.buttons.length - 1) * BUTTON_GAP;
        let   x         = Math.round((w - totalW) / 2);

        for (const btn of this.buttons) {
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

/** Counter used to compute stacked z-indices. */
let instanceCounter: number = 0;

/** Base z-index for the dialog panel. */
const DIALOG_BASE_Z: number = 10101;

/** Default button set when no buttons are supplied in config. */
const DEFAULT_BUTTONS: DialogButtonConfig[] = [
    { text: 'OK', result: 'confirm', primary: true, glyph: "check-circle" },
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
class Dialog extends Component {

    private readonly titleBar        : DialogTitleBar;
    private readonly contentContainer: Component;
    private readonly buttonRow       : DialogButtonRow;
    private readonly backdrop        : DialogBackdrop;
    private readonly config          : DialogConfig;

    private resolvePromise  : ((result: DialogResult) => void) | null = null;
    private previousFocus   : Element | null = null;
    private boundKeyHandler : (e: KeyboardEvent) => void;
    private boundResizeHandler: () => void;
    private readonly instanceZ: number;

    /**
     * Constructs a Dialog but does not display it. Call `show()` to open.
     *
     * @param config - Dialog configuration.
     */
    constructor(config: DialogConfig) {
        super();

        this.config    = config;
        this.instanceZ = instanceCounter;
        instanceCounter += 1;

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
        this.setZIndex(DIALOG_BASE_Z + this.instanceZ * 2);
        this.setBackgroundColor("var(--ts-ui-body-bg)");
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setShadow("var(--ts-ui-dialog-shadow)");
        this.setOverflow("hidden");
        // Fixed dimensions, hidden overflow, no escaping descendants — full strict containment.
        this.setContain("strict");

        const layout = new BorderLayout();
        layout.setComponentGap(0);
        this.setLayoutManager(layout);

        this.titleBar = new DialogTitleBar(config.title, () => this.hide('close'));
        this.addComponent(this.titleBar, { placement: Placement.NORTH });

        this.contentContainer = new Component();
        this.contentContainer.setLayoutManager(new Fit());
        // Vertical scrolling only — a horizontal scrollbar would cover the
        // bottom rows of body text and is rarely useful for dialog content.
        this.contentContainer.setOverflowY("auto");
        this.contentContainer.setOverflowX("hidden");

        if (config.contentComponent) {
            this.contentContainer.addComponent(config.contentComponent);
        } else {
            const messageText = new Text(config.message ?? '');
            messageText.setWhiteSpace("normal");
            messageText.setWordBreak("break-word");
            messageText.setPadding(new Insets(16, 16, 16, 16));
            this.contentContainer.addComponent(messageText);
        }

        this.addComponent(this.contentContainer, { placement: Placement.CENTER });

        this.buttonRow = new DialogButtonRow(buttons, (result) => this.hide(result));
        this.addComponent(this.buttonRow, { placement: Placement.SOUTH });

        this.backdrop = new DialogBackdrop();

        this.boundKeyHandler    = (e: KeyboardEvent) => this.onKeyDown(e);
        this.boundResizeHandler = () => this.onViewportResize();
    }

    /**
     * Computes the default content area height based on config.
     *
     * @param config - Dialog configuration.
     * @returns Height in pixels for the content region.
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
     * @returns A promise resolving to the [`DialogResult`](/api/core/type-aliases/DialogResult) of the closing action.
     */
    show(): Promise<DialogResult> {
        return new Promise((resolve) => {
            this.resolvePromise = resolve;
            this.open();
        });
    }

    /**
     * Appends backdrop and dialog to the DOM, centers the panel, and captures focus.
     */
    private open(): void {
        this.previousFocus = document.activeElement;

        if (this.config.closeOnBackdrop) {
            this.backdrop.addClickListener(() => this.hide('close'));
        }

        const backdropEl = this.backdrop.getElement(true);
        document.documentElement.appendChild(backdropEl);

        const dialogEl = this.getElement(true);
        document.documentElement.appendChild(dialogEl);

        this.scheduleLayout();
        this.center();
        this.animateIn();

        document.addEventListener('keydown', this.boundKeyHandler, true);
        window.addEventListener('resize', this.boundResizeHandler);

        this.focusFirst();
    }

    /**
     * Fades the backdrop in and the dialog panel in from `opacity: 0` +
     * `scale(0.97)` to `opacity: 1` + `scale(1)` over 150ms. No-op when
     * `prefers-reduced-motion: reduce` is set.
     */
    private animateIn(): void {
        const el   = this.getElement();
        const bdEl = this.backdrop.getElement();

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
        const vp = Util.getViewportSize();
        const x  = Math.max(0, Math.round((vp.width  - this.getWidth())  / 2));
        const y  = Math.max(0, Math.round((vp.height - this.getHeight()) / 2));

        this.setX(x);
        this.setY(y);
    }

    /**
     * Focuses the first focusable descendant inside the dialog.
     */
    private focusFirst(): void {
        const el        = this.getElement();
        const focusable = el?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (focusable && focusable.length > 0) {
            focusable[0].focus();
        }
    }

    /**
     * Collects all currently focusable elements inside the dialog.
     *
     * @returns An array of focusable elements in DOM order.
     */
    private getFocusable(): HTMLElement[] {
        const el = this.getElement();

        if (!el) {
            return [];
        }

        return Array.from(el.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter(el => !el.hasAttribute('disabled'));
    }

    /**
     * Handles document-level keydown events for Escape and Tab focus trapping.
     *
     * @param e - The keyboard event.
     */
    private onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            this.hide('close');
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
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    }

    /**
     * Re-centers the dialog and resizes the backdrop when the viewport changes.
     */
    private onViewportResize(): void {
        this.backdrop.resize();
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
        document.removeEventListener('keydown', this.boundKeyHandler, true);
        window.removeEventListener('resize', this.boundResizeHandler);

        const finalize = (): void => {
            this.backdrop.destroy();
            this.removeElement();
            this.destructor();

            instanceCounter = Math.max(0, instanceCounter - 1);

            if (this.previousFocus && 'focus' in this.previousFocus) {
                (this.previousFocus as HTMLElement).focus();
            }

            if (this.resolvePromise) {
                this.resolvePromise(result);
                this.resolvePromise = null;
            }
        };

        const el   = this.getElement();
        const bdEl = this.backdrop.getElement();

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
        return this.contentContainer;
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
        return this.titleBar;
    }

    /**
     * Displays a modal dialog and returns a promise that resolves on dismissal.
     *
     * @param config - Dialog configuration.
     * @returns A promise resolving to the [`DialogResult`](/api/core/type-aliases/DialogResult) of the closing action.
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
                { text: 'Cancel',  result: 'cancel',  primary: true, glyph: "times"        },
                { text: 'Confirm', result: 'confirm',                glyph: "check-circle" },
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
