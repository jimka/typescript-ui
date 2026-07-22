// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { LayerManager } from "~/core/LayerManager.js";
import { Animation } from "~/core/Animation.js";
import { Text } from "~/component/input/Text.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Button } from "~/component/button/Button.js";
import { Position } from "~/primitive/Position.js";
import { Insets } from "~/primitive/Insets.js";
import { _Dialog, DialogButtons } from "~/overlay/Dialog.js";
import { circle_info } from "~/glyphs/solid/circle_info.js";
import { circle_check } from "~/glyphs/solid/circle_check.js";
import { triangle_exclamation } from "~/glyphs/solid/triangle_exclamation.js";
import { circle_exclamation } from "~/glyphs/solid/circle_exclamation.js";
import { xmark } from "~/glyphs/solid/xmark.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

Glyph.register(circle_info, circle_check, triangle_exclamation, circle_exclamation, xmark);

/**
 * The visual severity of a notification.
 *
 * @category Core
 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

/**
 * A single captured notification, retained in the in-session history returned
 * by {@link Notification.getHistory}.
 *
 * @category Core
 */
export interface NotificationRecord {
    /** The full (un-truncated) message text passed to {@link Notification.show}. */
    readonly message: string;
    /** The severity type the toast was shown with. */
    readonly type: NotificationType;
    /** Epoch milliseconds (`Date.now()`) when the toast was shown. */
    readonly timestamp: number;
}

/**
 * Maps a notification severity to its registry glyph name. Exported (module,
 * not barrel — so it stays out of the public API docs) so the notification
 * history menu reuses the same severity-icon mapping rather than duplicating it.
 */
export const BADGE_GLYPH: Record<NotificationType, string> = {
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

    // In-flight entrance / dismiss animations, cancelled on teardown so their
    // fallback timers cannot fire against this notification's released handle.
    private _showAnimation:    Animation.CancelHandle | null = null;
    private _dismissAnimation: Animation.CancelHandle | null = null;

    private static readonly WIDTH: number          = 320;
    private static readonly HEIGHT: number         = 64;
    private static readonly MARGIN: number         = 16;
    private static readonly H_PADDING: number      = 12;
    private static readonly V_PADDING: number      = 10;
    private static readonly CLOSE_SIZE: number     = 20;
    private static readonly BADGE_SIZE: number     = 20;
    private static readonly BADGE_TEXT_GAP: number = 8;
    // Stacking z-index for toasts. Sits just above the managed dropdown band
    // (`LayerManager.Band.Dropdown` = 10000) so a toast floats over open pickers
    // and menus, yet below the Dialog band (11000) so the modal detail dialog a
    // toast can open covers it. A fixed literal rather than a `Band` allocation
    // because a `Notification` is not a registered layer — it never joins the
    // dismiss / stacking tree, so it has no node for the manager to stamp.
    private static readonly Z_INDEX: number        = 10002;

    private static activeNotifications: Notification[] = [];

    // The most-recent notifications retained by the in-session history. A fixed
    // ring cap keeps memory trivial and the history menu scrollable-but-finite;
    // oldest entries are evicted first.
    private static readonly HISTORY_CAP: number = 50;
    private static history: NotificationRecord[] = [];

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

    // Named listener refs (removable, grep-able, named in stack traces) for the
    // close button's action, the body double-click, and the hover hold pair.
    private readonly _boundOnCloseAction: () => Event.ListenerResult = () => {
        this.dismiss();

        // Prevent the click from contributing to a double-click on the body.
        return true;
    };
    private readonly _boundOnDblClick:  () => void              = () => this.openDetail();
    private readonly _boundOnMouseOver: (e: MouseEvent) => void = (e) => Notification.acquireHoverHold(e, this.getElement());
    private readonly _boundOnMouseOut:  (e: MouseEvent) => void = (e) => Notification.releaseHoverHold(e, this.getElement());

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

        // Live-region semantics so screen readers announce the toast when it is
        // inserted. Errors and warnings interrupt (`alert`/`assertive`);
        // informational and success toasts wait their turn (`status`/`polite`).
        const assertive = type === 'error' || type === 'warning';
        this.getAria().setRole(assertive ? "alert" : "status");
        this.getAria().setLive(assertive ? "assertive" : "polite");

        const bgVar     = `var(--ts-ui-notification-${type}-bg)`;
        const borderVar = `var(--ts-ui-notification-${type}-border)`;
        const shadowVar = `var(--ts-ui-notification-shadow)`;

        this.setBackgroundColor(bgVar);
        this.setBorder({ border: `1px solid ${borderVar}` });
        this.setShadow(shadowVar);
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");

        this._badge = new Glyph(BADGE_GLYPH[type]);
        this._badge.setForegroundColor(borderVar);
        this._badge.setPreferredSize({ width: Notification.BADGE_SIZE, height: Notification.BADGE_SIZE });
        this._badge.setPointerEvents("none");
        // Decorative severity icon — its meaning is already carried by the
        // message text, so keep it out of the announced live-region content.
        this._badge.getAria().setHidden(true);
        this.addComponent(this._badge);

        this._messageText = new Text(message);
        // Webkit-prefixed line clamp is now cross-browser (Chrome, Edge, Safari,
        // Firefox 68+). Clamped to two lines so a long message gets a trailing
        // ellipsis — the full text is reachable via double-click → detail dialog.
        this._messageText.setLineClamp(2);
        this._messageText.setWhiteSpace("normal");
        this._messageText.setWordBreak("break-word");
        this.addComponent(this._messageText);

        this._closeButton = new Button({ glyph: "xmark" });
        this._closeButton.setInsets(new Insets(0, 0, 0, 0));
        this._closeButton.setBorder("none");
        this._closeButton.clearBackgroundImage();
        this._closeButton.setBackgroundColor("transparent");
        this._closeButton.clearShadow();
        this._closeButton.clearPressedShadow();
        this._closeButton.setForegroundColor("var(--ts-ui-text-color, rgb(0, 0, 0))");
        this._closeButton.setPreferredSize({ width: Notification.CLOSE_SIZE, height: Notification.CLOSE_SIZE });
        this._closeButton.getAria().setLabel("Dismiss notification");
        this.addComponent(this._closeButton);

        // Route through the button's own `"action"` surface rather than reaching
        // into its DOM `click` via the Event API (a component must not listen to
        // another component's events through Event). The handler's returned `true`
        // stops propagation, so the dblclick-suppressing consume is preserved.
        this._closeButton.on("action", this._boundOnCloseAction);

        // addSubtreeListener so double-clicks on the badge / text bubble up.
        Event.addSubtreeListener(this, "dblclick", this._boundOnDblClick);

        // Subtree mouseover / mouseout on the root. These bubble from every
        // descendant of the toast, so the handlers below filter out
        // intra-element movements via `relatedTarget`. mouseenter / mouseleave
        // look cleaner on paper but proved unreliable here in practice —
        // mouseleave didn't always fire on a root carrying a non-empty
        // `transition` CSS rule left over from the entrance animation.
        // Subtree listeners route through `Event`'s window-level base
        // listener, so `e.currentTarget` resolves to `window` (which has no
        // `.contains` method) — pass the toast root explicitly instead.
        Event.addSubtreeListener(this, "mouseover", this._boundOnMouseOver);
        Event.addSubtreeListener(this, "mouseout",  this._boundOnMouseOut);
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
        Notification.record(message, type);

        const n = new Notification(message, type);

        Notification.activeNotifications.push(n);

        const el = n.getElement(true)!;

        n.scheduleLayout();

        LayerManager.mount(el);

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
     * Appends one entry to the in-session history, evicting the oldest once the
     * {@link HISTORY_CAP} ceiling is exceeded. Called by {@link show} for every
     * toast; browsing history via {@link showDetail} deliberately does not
     * record, so "history = everything ever shown this session, one entry per
     * `show()`".
     *
     * @param message - The full message text.
     * @param type - The severity type.
     */
    private static record(message: string, type: NotificationType): void {
        Notification.history.push({ message, type, timestamp: Date.now() });

        if (Notification.history.length > Notification.HISTORY_CAP) {
            Notification.history.shift();
        }
    }

    /**
     * Returns the in-session notification history, oldest first, capped at the
     * most recent 50 entries. The returned array is a defensive copy — mutating
     * it does not affect the retained history.
     *
     * @returns A copy of the history entries, oldest first.
     */
    static getHistory(): readonly NotificationRecord[] {
        return [...Notification.history];
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

        this._showAnimation?.cancel();
        this._showAnimation = Animation.play(el, {
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
     * @param el - The toast root element (the `Event`-routed listener can't
     *             rely on `e.currentTarget` — that's `window` here).
     */
    private static acquireHoverHold(e: MouseEvent, el: Handle | undefined): void {
        if (el && DOM.source.isNode(e.relatedTarget) && DOM.source.contains(el, DOM.source.intern(e.relatedTarget))) {
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
     * @param el - The toast root element (the `Event`-routed listener can't
     *             rely on `e.currentTarget` — that's `window` here).
     */
    private static releaseHoverHold(e: MouseEvent, el: Handle | undefined): void {
        if (el && DOM.source.isNode(e.relatedTarget) && DOM.source.contains(el, DOM.source.intern(e.relatedTarget))) {
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
     * Opens the modal detail dialog for this toast's full (un-truncated) message.
     * Delegates to {@link showDetail}; a double-click on the toast body routes
     * here.
     */
    private openDetail(): void {
        Notification.showDetail(this._fullMessage, this._type);
    }

    /**
     * Opens a modal detail dialog showing the full message text — the same dialog
     * a live toast opens on double-click. Active notification timers are paused
     * while the dialog is open and clamped to a minimum of 8 seconds when the
     * dialog is dismissed. Does not itself record a history entry, so re-opening a
     * past notification from the history menu leaves the history unchanged.
     *
     * @param message - The full message text to display.
     * @param type - The severity type; controls the title and title-bar tint.
     */
    static showDetail(message: string, type: NotificationType): void {
        Notification.pauseAll();

        const content = new Text(message);
        content.setAutoMeasure(false);
        content.setWhiteSpace("pre-wrap");
        content.setWordBreak("break-word");
        content.setPadding(new Insets(16, 16, 16, 16));

        const dialog = new _Dialog({
            title:            DETAIL_TITLE[type],
            contentComponent: content,
            buttons:          [{ ...DialogButtons.Close, primary: true }],
            width:            420,
            height:           220,
        });

        // Tint the title bar to match the notification's severity colours.
        const titleBar = dialog.getTitleBar();
        titleBar.setBackgroundColor(`var(--ts-ui-notification-${type}-bg)`);
        titleBar.getTitleText().setForegroundColor(`var(--ts-ui-notification-${type}-border)`);
        titleBar.setGlyph(BADGE_GLYPH[type]);

        const titleGlyph = titleBar.getGlyph();

        if (titleGlyph !== null) {
            titleGlyph.setForegroundColor(`var(--ts-ui-notification-${type}-border)`);
        }

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

        this._dismissAnimation?.cancel();
        this._dismissAnimation = Animation.play(el, {
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
        const vp = DOM.source.getViewportSize();
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

    /**
     * Cancels any in-flight entrance / dismiss animation, then defers to the
     * base class. Cancelling first keeps their fallback timers from firing
     * after `super.destructor()` has released the animated element handles.
     */
    protected destructor(): void {
        this._showAnimation?.cancel();
        this._showAnimation = null;
        this._dismissAnimation?.cancel();
        this._dismissAnimation = null;

        // `finishDismiss` is the only place a notification leaves the static
        // active list, and cancelling above suppressed it. That list outlives
        // every teardown, and `restack` writes setX/setY to each entry — so a
        // disposed notification left in it is positioned through the element
        // handle released below. Re-stack afterwards so the survivors close the
        // gap, exactly as a completed dismiss would have left them.
        if (Notification.activeNotifications.includes(this)) {
            Notification.activeNotifications = Notification.activeNotifications.filter(n => n !== this);
            Notification.restack();
        }

        super.destructor();
    }
}
