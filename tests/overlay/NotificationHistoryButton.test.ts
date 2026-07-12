//
// SCOPE: the offline-testable slice of NotificationHistoryButton — the default
// glyph, the relative-time formatter, and buildItems()'s pure mapping of the
// history into menu-item configs (empty state, newest-first order, field
// mapping). The actual menu open/anchor/dismiss and clicking a row to open the
// detail dialog are DOM-/geometry-/LayerManager-driven and covered by the
// plan's manual-verify steps, not here.
import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationHistoryButton, formatRelativeTime } from '~/overlay/NotificationHistoryButton';
import { Notification, BADGE_GLYPH, NotificationRecord } from '~/overlay/Notification';

const MINUTE = 60_000;
const HOUR   = 3_600_000;
const DAY    = 86_400_000;

function setHistory(records: NotificationRecord[]): void {
    (Notification as unknown as { history: NotificationRecord[] }).history = records;
}

// buildItems() is private; exercise it through a cast — it is the pure read the
// menu is built from.
function buildItems(button: NotificationHistoryButton) {
    return (button as unknown as { buildItems: () => Array<{ text?: string; glyph?: string; shortcut?: string; enabled?: boolean; action?: () => void }> }).buildItems();
}

describe('formatRelativeTime', () => {
    const now = 1_000_000_000;

    it('renders sub-minute deltas as "just now"', () => {
        expect(formatRelativeTime(now, now)).toBe('just now');
        expect(formatRelativeTime(now - 59_000, now)).toBe('just now');
    });

    it('renders minute, hour, and day deltas', () => {
        expect(formatRelativeTime(now - MINUTE, now)).toBe('1m ago');
        expect(formatRelativeTime(now - 90 * MINUTE, now)).toBe('1h ago');
        expect(formatRelativeTime(now - 25 * HOUR, now)).toBe('1d ago');
        expect(formatRelativeTime(now - 3 * DAY, now)).toBe('3d ago');
    });

    it('clamps a future timestamp to "just now"', () => {
        expect(formatRelativeTime(now + HOUR, now)).toBe('just now');
    });
});

describe('NotificationHistoryButton', () => {
    beforeEach(() => setHistory([]));

    it('defaults to the clock-rotate-left glyph', () => {
        expect(new NotificationHistoryButton().getGlyph()?.getGlyphName()).toBe('clock-rotate-left');
    });

    it('lets a consumer glyph override the default', () => {
        // circle-check is registered by the imported Notification module.
        expect(new NotificationHistoryButton({ glyph: 'circle-check' }).getGlyph()?.getGlyphName()).toBe('circle-check');
    });

    it('carries an accessible label', () => {
        expect(new NotificationHistoryButton().getAria().getLabel()).toBe('Notification history');
    });

    it('builds a single disabled item for the empty history', () => {
        const items = buildItems(new NotificationHistoryButton());
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe('No notifications yet');
        expect(items[0].enabled).toBe(false);
    });

    it('builds items oldest-first (latest at the bottom)', () => {
        setHistory([
            { message: 'a', type: 'info', timestamp: 1 },
            { message: 'b', type: 'error', timestamp: 2 },
        ]);
        const items = buildItems(new NotificationHistoryButton());
        expect(items.map(i => i.text)).toEqual(['a', 'b']);
    });

    it('maps each record to badge glyph, message, relative time, and an action', () => {
        setHistory([{ message: 'saved', type: 'success', timestamp: Date.now() }]);
        const [item] = buildItems(new NotificationHistoryButton());

        expect(item.glyph).toBe(BADGE_GLYPH.success);
        expect(item.text).toBe('saved');
        expect(typeof item.shortcut).toBe('string');
        expect(typeof item.action).toBe('function');
    });
});
