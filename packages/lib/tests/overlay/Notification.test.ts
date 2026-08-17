//
// SCOPE: Notification is almost entirely DOM- / timer- / animation-driven. Its
// only entry point, `Notification.show`, builds Glyph/Button children, appends
// to the document, plays an entrance Animation, and arms a setTimeout — none of
// which the offline harness models meaningfully (rAF is a recorded no-op
// returning 0). The queue (`activeNotifications`), the per-toast dismiss timer,
// and the bottom-right stacking offsets are private static state with no public
// getter, so the queue model and stacking order are not assertable offline.
// What stays safe is the static pause/resume refcount API, which is pure
// counter logic when no toast is live. Stacking / auto-dismiss / restack need a
// real-DOM (jsdom-event or browser) harness.
import { describe, it, expect, afterEach } from 'vitest';
import { Notification } from '~/overlay/Notification';
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

describe('Notification (pause/resume refcount, idle)', () => {
    afterEach(() => DOM.reset());

    it('pauseAll / resumeAll are balanced no-ops when no toast is live', () => {
        installTestDOM(CONFIG);

        // With an empty active stack these only mutate the static counters and
        // iterate an empty list — they must not throw and must balance.
        expect(() => {
            Notification.pauseAll();
            Notification.resumeAll();
        }).not.toThrow();
    });

    it('resumeAll with no outstanding pause hold is a no-op (early return)', () => {
        installTestDOM(CONFIG);

        // modalCount is 0, so resumeAll returns immediately without underflowing.
        expect(() => Notification.resumeAll()).not.toThrow();
    });

    it('nested pauseAll holds compose and release cleanly', () => {
        installTestDOM(CONFIG);

        expect(() => {
            Notification.pauseAll();
            Notification.pauseAll();
            Notification.resumeAll();
            Notification.resumeAll();
        }).not.toThrow();
    });

    it("makes a toast's message text selectable and copyable", () => {
        installTestDOM(CONFIG);

        // A toast message is content the reader may want to select and copy —
        // the same category as a Dialog's body text, which
        // `tests/overlay/Dialog.test.ts` pins the same way. `_messageText` is a
        // `SelectableText`, so both values fold out of its class defaults
        // rather than a per-instance setter call; this asserts the behaviour
        // the swap to `SelectableText` had to preserve.
        //
        // The constructor is private, so the toast is reached through the
        // static active-stack the way `Notification.styleRuleDisposal.test.ts`
        // already does.
        Notification.show('msg');

        const active = (Notification as unknown as { activeNotifications: unknown[] }).activeNotifications;
        const toast  = active[active.length - 1] as { _messageText: { getUserSelect(): string | null; getCursor(): string | null } };

        expect(toast._messageText.getUserSelect()).toBe('text');
        expect(toast._messageText.getCursor()).toBe('text');
    });
});
