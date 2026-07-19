//
// SCOPE: the in-session history ring buffer captured by Notification.show().
// Each show() records one entry before it builds any DOM, so capture, ordering,
// the eviction cap, and the defensive copy are all assertable offline under the
// recording DOM sink. showDetail() opens a modal dialog but must never record —
// asserted here too. The menu UI that surfaces the history is manual-verify
// (see NotificationHistoryButton.test.ts for the offline-testable slice).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Notification, NotificationRecord } from '~/overlay/Notification';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// History and the live-toast queue are private static state that persist across
// tests; clear both so each case starts clean (a stale toast left in the queue
// from a prior test's DOM instance would break restack() under the fresh sink).
function clearStatics(): void {
    (Notification as unknown as { history: unknown[]; activeNotifications: unknown[] }).history = [];
    (Notification as unknown as { history: unknown[]; activeNotifications: unknown[] }).activeNotifications = [];
}

describe('Notification history capture', () => {
    beforeEach(() => {
        installTestDOM(CONFIG);
        clearStatics();
    });
    afterEach(() => DOM.reset());

    it('appends one record per show(), capturing message and type', () => {
        const before = Date.now();
        Notification.show('a', 'success');

        const history = Notification.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0].message).toBe('a');
        expect(history[0].type).toBe('success');
        expect(history[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(history[0].timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('stores records oldest-first', () => {
        Notification.show('a', 'info');
        Notification.show('b', 'warning');

        const history = Notification.getHistory();
        expect(history.map(r => r.message)).toEqual(['a', 'b']);
    });

    it('captures the full (un-truncated) message, not the clamped display text', () => {
        const long = 'line one\n' + 'x'.repeat(500);
        Notification.show(long, 'info');

        expect(Notification.getHistory()[0].message).toBe(long);
    });

    it('evicts the oldest entry once the 50-entry cap is exceeded', () => {
        for (let i = 0; i < 51; i++) {
            Notification.show(`m${i}`, 'info');
        }

        const history = Notification.getHistory();
        expect(history).toHaveLength(50);
        // The very first (m0) was evicted; m1 is now the oldest.
        expect(history[0].message).toBe('m1');
        expect(history[49].message).toBe('m50');
    });

    it('returns a defensive copy from getHistory()', () => {
        Notification.show('a', 'info');

        // getHistory() returns a readonly copy; force a mutation through a cast
        // to prove it does not write back into the retained history.
        const first = Notification.getHistory() as NotificationRecord[];
        first.push({ message: 'injected', type: 'error', timestamp: 0 });

        expect(Notification.getHistory()).toHaveLength(1);
    });

    it('showDetail() opens the detail view without recording a history entry', () => {
        Notification.show('a', 'info');
        expect(Notification.getHistory()).toHaveLength(1);

        Notification.showDetail('a', 'info');

        // Browsing history (re-opening a past notification's detail) must not
        // append a new record — only show() records.
        expect(Notification.getHistory()).toHaveLength(1);
    });
});
