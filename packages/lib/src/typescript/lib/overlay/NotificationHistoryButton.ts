// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { MenuButton, MenuButtonOptions } from "~/component/button/MenuButton.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { Notification, BADGE_GLYPH } from "~/overlay/Notification.js";
import { Glyph } from "~/component/display/Glyph.js";
import { clock_rotate_left } from "~/glyphs/solid/clock_rotate_left.js";
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
 * Builds the menu item configs from the current notification history in
 * chronological order (oldest first, latest at the bottom). Returns a single
 * disabled placeholder when the history is empty. Module-level (uses only
 * statics), passed through {@link NotificationHistoryButton}'s subclass
 * defaults bag so it is re-invoked on every open. Module-internal (not
 * barrel-exported, so it stays out of the public API) — exported only so the
 * unit tests can pin its pure mapping directly.
 *
 * @returns The menu item descriptors for the current history.
 */
export function buildHistoryItems(): MenuItemConfig[] {
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

/**
 * Construction-time options for {@link NotificationHistoryButton}. Inherits
 * every {@link MenuButtonOptions} field; a consumer-supplied `glyph` overrides
 * the default clock icon.
 *
 * @category Components
 */
export interface NotificationHistoryButtonOptions extends MenuButtonOptions {}

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
class NotificationHistoryButton extends MenuButton<NotificationHistoryButtonOptions> {

    /**
     * Creates a NotificationHistoryButton seeded with the `clock-rotate-left`
     * glyph, the history provider, and scroll-to-bottom-on-show. A
     * consumer-supplied option in `options` still wins over these seeds.
     *
     * @param options - Optional button configuration.
     */
    constructor(options?: NotificationHistoryButtonOptions) {
        // Seeds live in the defaults bag so a caller's options still win.
        // History is chronological (latest at the bottom), so open scrolled to
        // the bottom; the provider re-runs per open so relative times stay current.
        super(undefined, options, {
            glyph:                "clock-rotate-left",
            menuItems:            buildHistoryItems,
            scrollToBottomOnShow: true,
        });

        this.getAria().setLabel("Notification history");

        // MenuButton wires the bag only for a plain MenuButton; as a subclass we
        // wire our own so a consumer `listeners` option is not silently dropped.
        this.applyListeners(options?.listeners);
    }
}

const NotificationHistoryButtonCallable = callable(NotificationHistoryButton);
type NotificationHistoryButtonCallable = NotificationHistoryButton;
export {
    NotificationHistoryButton         as _NotificationHistoryButton,
    NotificationHistoryButtonCallable as NotificationHistoryButton,
};
