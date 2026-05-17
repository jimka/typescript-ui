// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { Animation } from "~/core/Animation.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Text } from "~/component/input/Text.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Button } from "~/component/button/Button.js";
import { Position } from "~/primitive/Position.js";
import { Insets } from "~/primitive/Insets.js";
import { _Dialog } from "~/core/Dialog.js";
import { circle_info } from "~/glyphs/solid/circle_info.js";
import { circle_check } from "~/glyphs/solid/circle_check.js";
import { triangle_exclamation } from "~/glyphs/solid/triangle_exclamation.js";
import { circle_exclamation } from "~/glyphs/solid/circle_exclamation.js";

Glyph.register(circle_info, circle_check, triangle_exclamation, circle_exclamation);

/**
 * The visual severity of a notification.
 *
 * @category Core
 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

const BADGE_GLYPH: Record<NotificationType, string> = {
    info:    "circle-info",
    success: "circle-check",
    warning: "triangle-exclamation",
    error:   "circle-exclamation",
};

const DETAIL_TITLE: Record<NotificationType, string> = {
    info:    "Information",
    success: "Success",
    warning: "Warning",
    error:   "Error",
};

const MIN_RESUMED_MS: number = 8000;
const DISMISS_DURATION_MS: number = 200;
const ENTRANCE_DURATION_MS: number = 200;

/**
 * A lightweight toast-style notification that appears in the bottom-right corner
 * of the viewport and auto-dismisses after a configurable duration.
 *
 * Multiple notifications stack upward. Each can also be dismissed manually via
 * the × button. Long messages are clipped to two lines with an ellipsis; a
 * double-click on the body opens a modal detail dialog containing the full
 * message.
 *
 * @example
 * ```typescript
 * Notification.show('Record saved.', 'success');
 * Notification.show('Connection lost.', 'error', 0); // persistent
 * ```
 *
 * @category Core
 */
export class Notification extends Component {

    private static readonly WIDTH: number          = 320;
    private static readonly HEIGHT: number         = 64;
    private static readonly MARGIN: number         = 16;
    private static readonly H_PADDING: number      = 12;
    private static readonly V_PADDING: number      = 10;
    private static readonly CLOSE_SIZE: number     = 20;
    private static readonly BADGE_SIZE: number     = 20;
    private static readonly BADGE_TEXT_GAP: number = 8;
    private static readonly Z_INDEX: number        = 10002;

    private static activeNotifications: Notification[] = [];

    // The auto-dismiss timer of every visible notification is paused while
    // either of these counters is positive. `hoverCount` tracks how many
    // notifications the pointer is currently over (so hovering one freezes
    // the whole stack until the pointer leaves the last one); `modalCount`
    // tracks outstanding calls to Notification.pauseAll() (a balanced pair
    // with resumeAll() that callers use to bracket their own modal flows).
    // When the combined paused state transitions back to false, every
    // notification's timer is restarted with at least `MIN_RESUMED_MS` of
    // remaining duration whenever a modal hold was the last released.
    private static hoverCount: number = 0;
    private static modalCount: number = 0;

    private readonly _type: NotificationType;
    private readonly _fullMessage: string;
    private readonly _badge: Glyph;
    private readonly _messageText: Text;
    private readonly _closeButton: Button;
    private _dismissTimer: ReturnType<typeof setTimeout> | null = null;
    private _remainingDuration: number = 0;
    private _timerStartedAt: number    = 0;
    private _dismissing: boolean       = false;

    /**
     * Private — use `Notification.show()` to create and display instances.
     *
     * @param message - The text to display inside the notification.
     * @param type - The severity type that controls the colour scheme.
     */
    private constructor(message: string, type: NotificationType) {
        super();

        this._type        = type;
        this._fullMessage = message;

        this.setPosition(Position.FIXED);
        this.setZIndex(Notification.Z_INDEX);
        this.setWidth(Notification.WIDTH);
        this.setHeight(Notification.HEIGHT);
        this.setOverflow("hidden");
        // Fixed size, fixed position, hidden overflow — full strict containment.
        this.setContain("strict");

        const bgVar     = `var(--ts-ui-notification-${type}-bg)`;
        const borderVar = `var(--ts-ui-notification-${type}-border)`;
        const shadowVar = `var(--ts-ui-notification-shadow)`;

        this.setBackgroundColor(bgVar);
        this.setBorder({ style: BorderStyle.SOLID, width: 1, color: borderVar });
        this.setShadow(shadowVar);
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");

        this._badge = new Glyph(BADGE_GLYPH[type]);
        this._badge.setForegroundColor(borderVar);
        this._badge.setPreferredSize(Notification.BADGE_SIZE, Notification.BADGE_SIZE);
        this._badge.setPointerEvents("none");
        this.addComponent(this._badge);

        this._messageText = new Text(message);
        // Webkit-prefixed line clamp is now cross-browser (Chrome, Edge, Safari,
        // Firefox 68+). Clamped to two lines so a long message gets a trailing
        // ellipsis — the full text is reachable via double-click → detail dialog.
        this._messageText.setLineClamp(2);
        this._messageText.setWhiteSpace("normal");
        this._messageText.setWordBreak("break-word");
        this.addComponent(this._messageText);

        this._closeButton = new Button({ glyph: "times" });
        this._closeButton.setInsets(new Insets(0, 0, 0, 0));
        this._closeButton.setBorder({ style: BorderStyle.NONE });
        this._closeButton.clearBackgroundImage();
        this._closeButton.setBackgroundColor("transparent");
        this._closeButton.clearShadow();
        this._closeButton.clearPressedShadow();
        this._closeButton.setForegroundColor("var(--ts-ui-text-color, rgb(0, 0, 0))");
        this._closeButton.setPreferredSize(Notification.CLOSE_SIZE, Notification.CLOSE_SIZE);
        this.addComponent(this._closeButton);

        Event.addListener(this._closeButton, "click", (e: MouseEvent) => {
            // Prevent the click from contributing to a double-click on the body.
            e.stopPropagation();
            this.dismiss();
        });

        // addSubtreeListener so double-clicks on the badge / text bubble up.
        Event.addSubtreeListener(this, "dblclick", () => this.openDetail());

        // Native mouseover / mouseout on the root element. These bubble from
        // every descendant of the toast, so the handlers below filter out
        // intra-element movements via `relatedTarget`. mouseenter / mouseleave
        // look cleaner on paper but proved unreliable here in practice —
        // mouseleave didn't always fire on a root carrying a non-empty
        // `transition` CSS rule left over from the entrance animation.
        const el = this.getElement(true);

        el.addEventListener("mouseover", (e: MouseEvent) => Notification.acquireHoverHold(e));
        el.addEventListener("mouseout",  (e: MouseEvent) => Notification.releaseHoverHold(e));
    }

    /**
     * Displays a notification toast in the bottom-right corner of the viewport.
     *
     * @param message - The text to display.
     * @param type - The severity type; controls background and border colour. Defaults to `'info'`.
     * @param duration - How long in milliseconds before the notification auto-dismisses.
     *   Pass `0` for a persistent notification. Defaults to `3000`.
     */
    static show(message: string, type: NotificationType = 'info', duration: number = 3000): void {
        const n = new Notification(message, type);

        Notification.activeNotifications.push(n);

        const el = n.getElement(true);

        n.scheduleLayout();

        document.documentElement.appendChild(el);

        Notification.restack();
        n.animateIn();

        if (duration > 0) {
            n.startTimer(duration);

            // If another toast is currently hovered, or a modal hold is open,
            // freeze the brand-new toast too so it doesn't dismiss out from
            // under the user while they're still reading the stack.
            if (Notification.isPaused()) {
                n.pauseTimer();
            }
        }
    }

    /**
     * Slides the notification in from the right while fading from `opacity: 0`
     * to `opacity: 1` over 200ms. No-op when `prefers-reduced-motion: reduce`
     * is set — the toast snaps into place immediately.
     */
    private animateIn(): void {
        const el = this.getElement();

        if (!el) {
            return;
        }

        Animation.play(el, {
            from:       { transform: "translateX(100%)", opacity: "0" },
            to:         { transform: "translateX(0)",   opacity: "1" },
            durationMs: ENTRANCE_DURATION_MS,
            properties: ["transform", "opacity"],
        });
    }

    /**
     * Pauses the auto-dismiss timer of every currently visible notification.
     * Balanced with {@link Notification.resumeAll}; nested pause/resume pairs
     * compose, and the combined paused state is released only when every
     * acquired hold has been released.
     *
     * @remarks Intended for use by code that opens a modal flow during which
     * the user is unable to read or interact with active notifications.
     * Resumed timers are then clamped to a minimum of 8 seconds.
     */
    static pauseAll(): void {
        const wasPaused = Notification.isPaused();
        Notification.modalCount += 1;
        if (!wasPaused) {
            Notification.pauseAllTimers();
        }
    }

    /**
     * Releases one outstanding {@link Notification.pauseAll} hold. When the
     * last modal hold AND every hover hold is released, the stack's timers
     * are restarted with at least 8 seconds of remaining duration so the
     * user has time to read the toasts after the modal dismissal.
     */
    static resumeAll(): void {
        if (Notification.modalCount === 0) {
            return;
        }

        Notification.modalCount -= 1;
        if (!Notification.isPaused()) {
            Notification.resumeAllTimers(true);
        }
    }

    /**
     * Increments the hover refcount when the supplied `mouseover` event
     * represents an actual entry into a notification (not a movement
     * between two of its children). The first hover on any notification
     * pauses the entire stack so the user can read without timers eating
     * notifications mid-glance.
     *
     * @param e - The native `mouseover` event from the toast's root element.
     */
    private static acquireHoverHold(e: MouseEvent): void {
        const el = e.currentTarget as HTMLElement | null;
        if (el && e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) {
            return;
        }

        const wasPaused = Notification.isPaused();
        Notification.hoverCount += 1;
        if (!wasPaused) {
            Notification.pauseAllTimers();
        }
    }

    /**
     * Decrements the hover refcount when the supplied `mouseout` event
     * represents an actual exit (cursor moving outside the notification,
     * not just between two of its children). When the last hover hold AND
     * every outstanding modal hold has been released, every notification's
     * timer is restarted with whatever remaining duration was captured at
     * pause time (no minimum clamp on the hover-only path).
     *
     * @param e - The native `mouseout` event from the toast's root element.
     */
    private static releaseHoverHold(e: MouseEvent): void {
        const el = e.currentTarget as HTMLElement | null;
        if (el && e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) {
            return;
        }

        if (Notification.hoverCount === 0) {
            return;
        }

        Notification.hoverCount -= 1;
        if (!Notification.isPaused()) {
            Notification.resumeAllTimers(false);
        }
    }

    /**
     * Returns `true` when any hover or modal hold is currently active.
     */
    private static isPaused(): boolean {
        return Notification.hoverCount > 0 || Notification.modalCount > 0;
    }

    /**
     * Pauses every active notification's auto-dismiss timer.
     */
    private static pauseAllTimers(): void {
        for (const n of Notification.activeNotifications) {
            n.pauseTimer();
        }
    }

    /**
     * Restarts every active notification's auto-dismiss timer with its
     * captured remaining duration. When `clampMin` is true, the remaining
     * duration is bumped to at least {@link MIN_RESUMED_MS} so a modal
     * release leaves the user enough time to read the stack.
     */
    private static resumeAllTimers(clampMin: boolean): void {
        for (const n of Notification.activeNotifications) {
            n.restartTimer(clampMin);
        }
    }

    /**
     * Starts (or restarts) the auto-dismiss timer with the given duration and
     * records when it began so remaining time can be calculated on hover.
     *
     * @param ms - Milliseconds until the notification is dismissed.
     */
    private startTimer(ms: number): void {
        this._remainingDuration = ms;
        this._timerStartedAt    = Date.now();
        this._dismissTimer      = setTimeout(() => this.dismiss(), ms);
    }

    /**
     * Pauses the auto-dismiss timer when the pointer enters the notification.
     * Stores how many milliseconds were left so `resumeTimer` can pick up where it left off.
     */
    private pauseTimer(): void {
        if (this._dismissTimer === null) {
            return;
        }

        clearTimeout(this._dismissTimer);
        this._dismissTimer      = null;
        this._remainingDuration = Math.max(0, this._remainingDuration - (Date.now() - this._timerStartedAt));
    }

    /**
     * Restarts this notification's auto-dismiss timer with its captured
     * remaining duration. When `clampMin` is true, the remaining duration
     * is bumped to {@link MIN_RESUMED_MS} so the user gets enough time to
     * read what's left after a modal release.
     *
     * @param clampMin - Apply the modal-resume minimum clamp.
     */
    private restartTimer(clampMin: boolean): void {
        if (this._dismissing) {
            return;
        }

        if (this._remainingDuration <= 0 || this._dismissTimer !== null) {
            return;
        }

        if (clampMin) {
            this._remainingDuration = Math.max(this._remainingDuration, MIN_RESUMED_MS);
        }

        this._timerStartedAt = Date.now();
        this._dismissTimer   = setTimeout(() => this.dismiss(), this._remainingDuration);
    }

    /**
     * Opens a modal detail dialog showing the full (un-truncated) message text.
     * Active notification timers are paused while the dialog is open and clamped
     * to a minimum of 8 seconds when the dialog is dismissed.
     */
    private openDetail(): void {
        Notification.pauseAll();

        const content = new Text(this._fullMessage);
        content.setAutoMeasure(false);
        content.setWhiteSpace("pre-wrap");
        content.setWordBreak("break-word");
        content.setPadding(new Insets(16, 16, 16, 16));

        const dialog = new _Dialog({
            title:            DETAIL_TITLE[this._type],
            contentComponent: content,
            buttons:          [{ text: 'Close', result: 'close', primary: true, glyph: "times" }],
            width:            420,
            height:           220,
        });

        // Tint the title bar to match the notification's severity colours.
        const titleBar = dialog.getTitleBar();
        titleBar.setBackgroundColor(`var(--ts-ui-notification-${this._type}-bg)`);
        titleBar.getTitleText().setForegroundColor(`var(--ts-ui-notification-${this._type}-border)`);
        titleBar.setGlyph(BADGE_GLYPH[this._type]);

        dialog.show().then(() => Notification.resumeAll());
    }

    /**
     * Slides the notification rightward while fading it out, then removes the
     * element from the DOM and restacks the remaining notifications.
     */
    private dismiss(): void {
        if (this._dismissing) {
            return;
        }

        this._dismissing = true;

        if (this._dismissTimer !== null) {
            clearTimeout(this._dismissTimer);
            this._dismissTimer = null;
        }

        const el = this.getElement();

        if (!el) {
            this.finishDismiss();
            return;
        }

        Animation.play(el, {
            to:         { transform: "translateX(100%)", opacity: "0" },
            durationMs: DISMISS_DURATION_MS,
            properties: ["transform", "opacity"],
            onComplete: () => this.finishDismiss(),
        });
    }

    /**
     * Removes this notification from the active stack and from the DOM.
     */
    private finishDismiss(): void {
        Notification.activeNotifications = Notification.activeNotifications.filter(n => n !== this);

        this.removeElement();

        Notification.restack();
    }

    /**
     * Recalculates the Y position of every active notification so they
     * stack upward from the bottom-right corner without overlapping.
     */
    private static restack(): void {
        const vp = Util.getViewportSize();
        const x  = vp.width - Notification.WIDTH - Notification.MARGIN;

        let y = vp.height - Notification.MARGIN;

        for (let i = Notification.activeNotifications.length - 1; i >= 0; i--) {
            const n = Notification.activeNotifications[i];

            y -= Notification.HEIGHT;
            n.setX(x);
            n.setY(y);
            y -= Notification.MARGIN;
        }
    }

    /**
     * Positions the badge glyph, message label, and close button within the
     * notification body.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const closeX    = Notification.WIDTH - Notification.CLOSE_SIZE - 4;
        const badgeX    = Notification.H_PADDING;
        const badgeY    = Notification.V_PADDING + 2;
        const msgX      = badgeX + Notification.BADGE_SIZE + Notification.BADGE_TEXT_GAP;
        const msgWidth  = closeX - msgX - 4;
        const msgHeight = Notification.HEIGHT - Notification.V_PADDING * 2;

        this._badge.setX(badgeX);
        this._badge.setY(badgeY);
        this._badge.setWidth(Notification.BADGE_SIZE);
        this._badge.setHeight(Notification.BADGE_SIZE);

        this._messageText.setX(msgX);
        this._messageText.setY(Notification.V_PADDING);
        this._messageText.setWidth(msgWidth);
        this._messageText.setHeight(msgHeight);

        this._closeButton.setX(closeX);
        this._closeButton.setY(4);
        this._closeButton.setWidth(Notification.CLOSE_SIZE);
        this._closeButton.setHeight(Notification.CLOSE_SIZE);
        // Cascade the size change down to the times-glyph through the
        // close button's internal Fit/HBox layout.
        this._closeButton.doLayout();

        return this;
    }
}
