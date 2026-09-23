// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * `Component.getLaidOutComponents()` re-serves the array it last returned for
 * as long as that array still lists exactly the displayed children, in order,
 * instead of filtering a new one on every call. Case E3 of
 * `plans/implemented/layout-size-read-economy.md`.
 *
 * The kept array is only ever replaced, never edited, so an array a caller
 * already holds keeps the contents it was handed — which is what `Border` and
 * `Split` depend on when they store the list in a collapsed-content record.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { VBox } from '~/layout/VBox';
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

/** A rendered, inset-free container. */
function makeHost(): Container {
    const host = new Container({ layoutManager: new VBox({ spacing: 0 }) });

    host.getElement(true);
    host.clearInsets();

    return host;
}

describe('Component.getLaidOutComponents re-serves its last array', () => {
    afterEach(() => DOM.reset());

    it('E3: re-serves while the displayed children match, and replaces the array otherwise', () => {
        installTestDOM(CONFIG);

        const host = makeHost();
        const a    = new Component();
        const b    = new Component();
        const c    = new Component();

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);

        const first = host.getLaidOutComponents();

        expect(first).toEqual([a, b, c]);
        expect(host.getLaidOutComponents()).toBe(first);

        b.setDisplayed(false);

        const undisplayed = host.getLaidOutComponents();

        expect(undisplayed).toEqual([a, c]);
        expect(undisplayed).not.toBe(first);
        // The array the first call handed out is never edited afterwards.
        expect(first).toEqual([a, b, c]);

        b.setDisplayed(true);

        const redisplayed = host.getLaidOutComponents();

        expect(redisplayed).toEqual([a, b, c]);
        expect(redisplayed).not.toBe(undisplayed);

        const order = [a, b, c];

        host.sortComponents((left, right) => order.indexOf(right) - order.indexOf(left));

        const sorted = host.getLaidOutComponents();

        expect(sorted).toEqual([c, b, a]);
        expect(sorted).not.toBe(redisplayed);

        const d = new Component();

        host.addComponent(d);

        const appended = host.getLaidOutComponents();

        expect(appended).toEqual([c, b, a, d]);
        expect(appended).not.toBe(sorted);

        host.removeComponent(a);

        expect((host as any)._laidOutComponents).toBeNull();

        const removed = host.getLaidOutComponents();

        expect(removed).toEqual([c, b, d]);

        removed.push(new Component());

        const rebuilt = host.getLaidOutComponents();

        expect(rebuilt).toEqual([c, b, d]);
        expect(rebuilt).not.toBe(removed);

        host.removeAllComponents();

        const emptied = host.getLaidOutComponents();

        expect(emptied).toEqual([]);
        expect(emptied).not.toBe(rebuilt);
    });

    it('E3: a leaf with no children re-serves the same empty array', () => {
        installTestDOM(CONFIG);

        const leaf  = new Component();
        const empty = leaf.getLaidOutComponents();

        expect(empty).toEqual([]);
        expect(leaf.getLaidOutComponents()).toBe(empty);
    });
});
