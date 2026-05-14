// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Text } from "~/component/input/Text.js";
import { Position } from "~/primitive/Position.js";

/**
 * The visual severity of a notification.
 *
 * @category Core
 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

/**
 * A lightweight toast-style notification that appears in the bottom-right corner
 * of the viewport and auto-dismisses after a configurable duration.
 *
 * Multiple notifications stack upward. Each can also be dismissed manually via
 * the × button.
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

    private static readonly WIDTH: number  = 320;
    private static readonly HEIGHT: number = 64;
    private static readonly MARGIN: number = 16;
    private static readonly H_PADDING: number  = 12;
    private static readonly V_PADDING: number  = 10;
    private static readonly CLOSE_SIZE: number = 20;
    private static readonly Z_INDEX: number    = 10002;

    private static activeNotifications: Notification[] = [];

    private readonly messageText: Text;
    private readonly closeIcon: Text;
    private dismissTimer: ReturnType<typeof setTimeout> | null = null;
    private remainingDuration: number = 0;
    private timerStartedAt: number    = 0;

    /**
     * Private — use `Notification.show()` to create and display instances.
     *
     * @param message - The text to display inside the notification.
     * @param type - The severity type that controls the colour scheme.
     */
    private constructor(message: string, type: NotificationType) {
        super();

        this.setPosition(Position.FIXED);
        this.setZIndex(Notification.Z_INDEX);
        this.setWidth(Notification.WIDTH);
        this.setHeight(Notification.HEIGHT);
        this.setOverflow("hidden");
        // Fixed size, fixed position, hidden overflow — full strict containment.
        this.setElementCSSRule("contain", "strict");

        const bgVar     = `var(--ts-ui-notification-${type}-bg)`;
        const borderVar = `var(--ts-ui-notification-${type}-border)`;
        const shadowVar = `var(--ts-ui-notification-shadow)`;

        this.setBackgroundColor(bgVar);
        this.setBorder({ style: BorderStyle.SOLID, width: 1, color: borderVar });
        this.setShadow(shadowVar);
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");

        this.messageText = new Text(message);
        this.messageText.setElementCSSRule("whiteSpace", "normal");
        this.messageText.setElementCSSRule("wordBreak", "break-word");
        this.addComponent(this.messageText);

        this.closeIcon = new Text("×");
        this.closeIcon.setCursor("pointer");
        this.closeIcon.setElementCSSRule("textAlign", "center");
        this.closeIcon.setElementCSSRule("lineHeight", `${Notification.CLOSE_SIZE}px`);
        this.closeIcon.setElementCSSRule("userSelect", "none");
        this.closeIcon.setForegroundColor("var(--ts-ui-text-color, rgb(0, 0, 0))");
        this.addComponent(this.closeIcon);

        Event.addListener(this.closeIcon, "click", () => this.dismiss());

        Event.addSubtreeListener(this, "mouseover", (e: MouseEvent) => {
            const el = this.getElement();

            if (el && e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) {
                return;
            }

            this.pauseTimer();
        });

        Event.addSubtreeListener(this, "mouseout", (e: MouseEvent) => {
            const el = this.getElement();

            if (el && e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) {
                return;
            }

            this.resumeTimer();
        });
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

        if (duration > 0) {
            n.startTimer(duration);
        }
    }

    /**
     * Starts (or restarts) the auto-dismiss timer with the given duration and
     * records when it began so remaining time can be calculated on hover.
     *
     * @param ms - Milliseconds until the notification is dismissed.
     */
    private startTimer(ms: number): void {
        this.remainingDuration = ms;
        this.timerStartedAt    = Date.now();
        this.dismissTimer      = setTimeout(() => this.dismiss(), ms);
    }

    /**
     * Pauses the auto-dismiss timer when the pointer enters the notification.
     * Stores how many milliseconds were left so `resumeTimer` can pick up where it left off.
     */
    private pauseTimer(): void {
        if (this.dismissTimer === null) {
            return;
        }

        clearTimeout(this.dismissTimer);
        this.dismissTimer      = null;
        this.remainingDuration = Math.max(0, this.remainingDuration - (Date.now() - this.timerStartedAt));
    }

    /**
     * Resumes the auto-dismiss timer when the pointer leaves the notification,
     * using whatever time remained when the timer was paused.
     */
    private resumeTimer(): void {
        if (this.remainingDuration <= 0 || this.dismissTimer !== null) {
            return;
        }

        this.timerStartedAt = Date.now();
        this.dismissTimer   = setTimeout(() => this.dismiss(), this.remainingDuration);
    }

    /**
     * Removes this notification from the screen and from the active stack.
     */
    private dismiss(): void {
        if (this.dismissTimer !== null) {
            clearTimeout(this.dismissTimer);
            this.dismissTimer = null;
        }

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
     * Positions the message label and the close button within the notification body.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const closeX    = Notification.WIDTH - Notification.CLOSE_SIZE - 4;
        const msgWidth  = closeX - Notification.H_PADDING - 4;
        const msgHeight = Notification.HEIGHT - Notification.V_PADDING * 2;

        this.messageText.setX(Notification.H_PADDING);
        this.messageText.setY(Notification.V_PADDING);
        this.messageText.setWidth(msgWidth);
        this.messageText.setHeight(msgHeight);

        this.closeIcon.setX(closeX);
        this.closeIcon.setY(4);
        this.closeIcon.setWidth(Notification.CLOSE_SIZE);
        this.closeIcon.setHeight(Notification.CLOSE_SIZE);

        return this;
    }
}
