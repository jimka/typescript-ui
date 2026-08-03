// Regression: `Notification.finishDismiss` called `removeElement()`, which
// strips the DOM node but leaves the toast's and its close button's rules on
// the shared sheet — a dismissed toast is unreachable (`show` returns `void`
// and the instance is dropped from the active list on the line above), so
// nothing ever released them. See plans/implemented/dock-disposes-tab-content.md.
import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { Notification } from '~/overlay/Notification';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * Recursively collects a component's own id plus every registered
 * descendant's id, copied from tests/component/dispose-full-teardown.test.ts.
 */
function collectIds(c: Component): string[] {
    const ids = [c.getId()];

    for (const child of c.getComponents()) {
        ids.push(...collectIds(child));
    }

    return ids;
}

afterEach(() => DOM.reset());

describe('Notification — style-rule disposal on dismiss', () => {
    it('N1 — a dismissed toast leaves no rule behind', () => {
        installTestDOM(CONFIG);

        Notification.show('msg');

        const active = (Notification as unknown as { activeNotifications: Component[] }).activeNotifications;
        const toast  = active[active.length - 1];
        const ids    = collectIds(toast);

        expect(_ruleCacheKeys().some((key) => ids.some((id) => key.includes(id)))).toBe(true);

        (toast as unknown as { finishDismiss(): void }).finishDismiss();

        const leaked = _ruleCacheKeys().filter((key) => ids.some((id) => key.includes(id)));

        expect(leaked).toEqual([]);

        expect(() => {
            Notification.pauseAll();
            Notification.resumeAll();
        }).not.toThrow();
    });
});
