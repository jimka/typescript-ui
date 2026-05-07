// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component.js";
import { Event } from "./Event.js";
import { Position } from "./Position.js";
import { Util } from "./Util.js";
import { BorderStyle } from "./BorderStyle.js";
import { Label } from "./component/Label.js";
import { Button } from "./component/Button.js";
import { DialogBackdrop } from "./component/DialogBackdrop.js";
import { Border as BorderLayout } from "./layout/Border.js";
import { Fit } from "./layout/Fit.js";
import { Placement } from "./Placement.js";
import { Insets } from "./Insets.js";

/** The result produced when a dialog is dismissed. */
export type DialogResult = 'confirm' | 'cancel' | 'close';

/**
 * Configuration for a single button in a dialog's button row.
 */
export interface DialogButtonConfig {
    /** The label text displayed on the button. */
    text    : string;
    /** The result value emitted when this button is clicked. Defaults to `'cancel'`. */
    result? : DialogResult;
    /** When true, renders the button with primary (confirm) styling. */
    primary?: boolean;
}

/**
 * Configuration object passed to `new Dialog(config)` or `Dialog.show(config)`.
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

// ---------------------------------------------------------------------------
// Private: DialogTitleBar
// ---------------------------------------------------------------------------

/**
 * Title bar that occupies the NORTH slot of a Dialog's border layout.
 * Contains a text label on the left and a close (×) button on the right.
 */
class DialogTitleBar extends Component {

    private readonly titleLabel : Label;
    private readonly closeButton: Label;

    /**
     * @param title - Text to display in the title bar.
     * @param onClose - Called when the user clicks the × close button.
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

        this.titleLabel = new Label(title);
        this.titleLabel.setFontWeight("bold");
        this.titleLabel.setOverflow("hidden");
        this.titleLabel.setTextOverflow("ellipsis");
        this.titleLabel.setWhiteSpace("nowrap");
        this.addComponent(this.titleLabel);

        this.closeButton = new Label("×");
        this.closeButton.setCursor("pointer");
        this.closeButton.setTextAlign("center");
        this.closeButton.setLineHeight(CLOSE_SIZE);
        this.closeButton.setUserSelect("none");
        this.closeButton.setForegroundColor("var(--ts-ui-text-color)");
        this.addComponent(this.closeButton);

        Event.addListener(this.closeButton, "click", onClose);
    }

    /**
     * Positions the title label and close button within the title bar bounds.
     */
    doLayout(): void {
        super.doLayout();

        const w          = this.getWidth();
        const h          = this.getHeight();
        const closeX     = w - CLOSE_SIZE - 4;
        const centerY    = Math.floor((h - CLOSE_SIZE) / 2);
        const labelWidth = closeX - TITLE_H_PAD - 4;
        const labelH     = h - 8;

        this.titleLabel.setX(TITLE_H_PAD);
        this.titleLabel.setY(4);
        this.titleLabel.setWidth(labelWidth);
        this.titleLabel.setHeight(labelH);

        this.closeButton.setX(closeX);
        this.closeButton.setY(centerY);
        this.closeButton.setWidth(CLOSE_SIZE);
        this.closeButton.setHeight(CLOSE_SIZE);
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
     * @param onButton - Called with the resolved `DialogResult` when any button is clicked.
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
            const btn    = new Button(cfg.text);
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
     */
    doLayout(): void {
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
    { text: 'OK', result: 'confirm', primary: true },
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
 */
export class Dialog extends Component {

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

        const dialogWidth  = config.width ?? 480;
        const buttons      = config.buttons ?? DEFAULT_BUTTONS;
        const contentHeight = this.computeContentHeight(config);
        const dialogHeight  = config.height ?? (TITLE_HEIGHT + contentHeight + BUTTON_HEIGHT);

        this.setPosition(Position.FIXED);
        this.setWidth(dialogWidth);
        this.setHeight(dialogHeight);
        this.setZIndex(DIALOG_BASE_Z + this.instanceZ * 2);
        this.setBackgroundColor("var(--ts-ui-body-bg)");
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setShadow("var(--ts-ui-dialog-shadow)");
        this.setOverflow("hidden");

        const layout = new BorderLayout();
        layout.setComponentGap(0);
        this.setLayoutManager(layout);

        this.titleBar = new DialogTitleBar(config.title, () => this.hide('close'));
        this.addComponent(this.titleBar, { placement: Placement.NORTH });

        this.contentContainer = new Component();
        this.contentContainer.setLayoutManager(new Fit());
        this.contentContainer.setOverflow("auto");

        if (config.contentComponent) {
            this.contentContainer.addComponent(config.contentComponent);
        } else {
            const msgLabel = new Label(config.message ?? '');
            msgLabel.setElementCSSRule("whiteSpace", "normal");
            msgLabel.setElementCSSRule("wordBreak", "break-word");
            msgLabel.setPadding(new Insets(16, 16, 16, 16));
            this.contentContainer.addComponent(msgLabel);
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
     * @returns A promise resolving to the `DialogResult` of the closing action.
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

        this.doLayout();
        this.center();

        document.addEventListener('keydown', this.boundKeyHandler, true);
        window.addEventListener('resize', this.boundResizeHandler);

        this.focusFirst();
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
     * Dismisses the dialog, restores focus, and resolves the promise.
     *
     * @param result - The result to resolve the promise with.
     */
    hide(result: DialogResult): void {
        document.removeEventListener('keydown', this.boundKeyHandler, true);
        window.removeEventListener('resize', this.boundResizeHandler);

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
    }

    /**
     * Returns the content container component where custom content is rendered.
     *
     * @returns The content container `Component`.
     */
    getContentComponent(): Component {
        return this.contentContainer;
    }

    /**
     * Displays a modal dialog and returns a promise that resolves on dismissal.
     *
     * @param config - Dialog configuration.
     * @returns A promise resolving to the `DialogResult` of the closing action.
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
                { text: 'Cancel',  result: 'cancel',  primary: true },
                { text: 'Confirm', result: 'confirm'                },
            ],
        });

        return result === 'confirm';
    }
}
