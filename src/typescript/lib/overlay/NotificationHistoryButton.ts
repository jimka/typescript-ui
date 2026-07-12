// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Menu } from "~/overlay/Menu.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { Notification, BADGE_GLYPH } from "~/overlay/Notification.js";
import { Glyph } from "~/component/display/Glyph.js";
import { clock_rotate_left } from "~/glyphs/solid/clock_rotate_left.js";
import { DOM } from "~/core/DOM.js";
import { callable } from "~/core/Callable.js";

Glyph.register(clock_rotate_left);

const MINUTE_MS = 60_000;
const HOUR_MS   = 3_600_000;
const DAY_MS    = 86_400_000;

/**
 * Formats the age of a notification as a compact relative-time string
 * (`"just now"`, `"5m ago"`, `"2h ago"`, `"3d ago"`). A future timestamp
 * (clock skew) clamps to `"just now"`. Module-internal (not barrel-exported, so
 * it stays out of the public API) — exported only so the unit tests can pin the
 * bucket boundaries directly.
 *
 * @param timestampMs - When the notification was shown (epoch ms).
 * @param nowMs - The current time (epoch ms).
 * @returns The relative-time label.
 */
export function formatRelativeTime(timestampMs: number, nowMs: number): string {
    const delta = Math.max(0, nowMs - timestampMs);

    if (delta < MINUTE_MS) {
        return "just now";
    }

    if (delta < HOUR_MS) {
        return `${Math.floor(delta / MINUTE_MS)}m ago`;
    }

    if (delta < DAY_MS) {
        return `${Math.floor(delta / HOUR_MS)}h ago`;
    }

    return `${Math.floor(delta / DAY_MS)}d ago`;
}

/**
 * Construction-time options for {@link NotificationHistoryButton}. Inherits
 * every {@link ButtonOptions} field; a consumer-supplied `glyph` overrides the
 * default clock icon.
 *
 * @category Components
 */
export interface NotificationHistoryButtonOptions extends ButtonOptions {}

/**
 * A trigger button that opens a menu of recent notifications. The menu lists the
 * in-session {@link Notification} history in chronological order (latest at the
 * bottom) and opens scrolled to the bottom, so the most recent entries are
 * visible first — each row showing the notification's severity badge, its
 * message, and how long ago it was shown. Activating a row re-opens that
 * notification's full message in the same modal detail dialog a live toast opens
 * on double-click; it does not re-show a toast, so browsing history has no effect
 * on the history itself.
 *
 * Place one wherever a persistent affordance for reviewing past notifications is
 * wanted, e.g. in a toolbar.
 *
 * @example
 * ```typescript
 * toolbar.addComponent(new NotificationHistoryButton());
 * ```
 *
 * @category Components
 */
class NotificationHistoryButton extends Button<NotificationHistoryButtonOptions> {

    // Lazily created on first open and reused across opens (rebuild-mode Menu
    // rebuilds its items on every toggle, so relative times and new entries are
    // always current).
    private _menu: Menu | null = null;

    private readonly _boundToggleMenu: () => void = () => this.toggleMenu();

    /**
     * Creates a NotificationHistoryButton seeded with the `clock-rotate-left`
     * glyph. A consumer-supplied `glyph` in `options` still wins.
     *
     * @param options - Optional button configuration.
     */
    constructor(options?: NotificationHistoryButtonOptions) {
        // The seed glyph lives in the defaults bag so a caller `options.glyph`
        // overrides it (Button resolves `options.glyph ?? _defaultOptions.glyph`).
        super(undefined, options, { glyph: "clock-rotate-left" });

        this.getAria().setLabel("Notification history");
        this.on("action", this._boundToggleMenu);

        // Button wires the listener bag only for a plain Button; as a subclass we
        // wire our own so a consumer `listeners` option is not silently dropped.
        this.applyListeners(options?.listeners);
    }

    /**
     * Toggles the history menu anchored under the button's bottom-left corner.
     * No-op when the button is not yet attached (no anchor rect to read).
     */
    private toggleMenu(): void {
        const el = this.getElement();

        if (!el) {
            return;
        }

        const rect = DOM.source.getViewportRect(this);

        // The history is chronological (latest at the bottom), so open scrolled to
        // the bottom to reveal the most recent entries.
        this._menu ??= new Menu().setScrollToBottomOnShow(true);
        this._menu.toggleFor(el, rect.left, rect.bottom, this.buildItems());
    }

    /**
     * Builds the menu item configs from the current notification history in
     * chronological order (oldest first, latest at the bottom). Returns a single
     * disabled placeholder when the history is empty.
     *
     * @returns The menu item descriptors for the current history.
     */
    private buildItems(): MenuItemConfig[] {
        const history = Notification.getHistory();

        if (history.length === 0) {
            return [{ text: "No notifications yet", enabled: false }];
        }

        const now = Date.now();

        // History is stored oldest-first; keep that order so the latest entries
        // sit at the bottom (the menu opens scrolled there).
        return history.map(record => ({
            glyph:      BADGE_GLYPH[record.type],
            // Tint the badge with the severity's border token — the same colour
            // the live toast's badge uses.
            glyphColor: `var(--ts-ui-notification-${record.type}-border)`,
            text:       record.message,
            shortcut:   formatRelativeTime(record.timestamp, now),
            action:     () => Notification.showDetail(record.message, record.type),
        }));
    }
}

const NotificationHistoryButtonCallable = callable(NotificationHistoryButton);
type NotificationHistoryButtonCallable = NotificationHistoryButton;
export {
    NotificationHistoryButton         as _NotificationHistoryButton,
    NotificationHistoryButtonCallable as NotificationHistoryButton,
};
