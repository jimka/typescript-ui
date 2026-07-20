// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Router lifecycle/navigation suite, driven through the modelled DOM harness
// (installTestDOM) so the hashchange round trip is exercised offline exactly
// as production wires it — see tests/dom/events.test.ts for the setup shape.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Router, type RouteMatch, type RouteParams } from '~/router/Router';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

describe('Router — ambiguity warning at registration', () => {
    it('warns once, naming both patterns, when two patterns share a specificity key', () => {
        installTestDOM(CONFIG);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const router = new Router();

        router.register('/users/:id', () => {});
        router.register('/users/:name', () => {});

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/^Router:/);
        expect(warn.mock.calls[0][0]).toContain('/users/:id');
        expect(warn.mock.calls[0][0]).toContain('/users/:name');

        warn.mockRestore();
    });

    it('replaces silently and the second handler wins when the identical pattern string is registered twice', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/users/7');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const router = new Router();
        const calls: string[] = [];

        router.register('/users/:id', () => calls.push('first'));
        router.register('/users/:id', () => calls.push('second'));
        router.start();

        expect(warn).not.toHaveBeenCalled();
        expect(calls).toEqual(['second']);

        warn.mockRestore();
    });

    it('does not warn for two patterns with different specificity keys', () => {
        installTestDOM(CONFIG);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const router = new Router();

        router.register('/a/:x', () => {});
        router.register('/b/:y', () => {});

        expect(warn).not.toHaveBeenCalled();

        warn.mockRestore();
    });
});

describe('Router — lifecycle and navigation', () => {
    it('start() applies a route matching the hash present before start() and emits navigate', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/settings');

        const calls: Array<{ params: RouteParams; path: string }> = [];
        const navigateEvents: RouteMatch[] = [];

        const router = new Router({
            routes: {
                '/settings': (params, path) => calls.push({ params, path }),
            },
        });

        router.on('navigate', (match) => navigateEvents.push(match));
        router.start();

        expect(calls).toEqual([{ params: {}, path: '/settings' }]);
        expect(navigateEvents).toEqual([{ pattern: '/settings', params: {}, path: '/settings' }]);
    });

    it('runs the "/" handler when the hash is empty before start()', () => {
        installTestDOM(CONFIG);

        let ran = false;
        const router = new Router({ routes: { '/': () => { ran = true; } } });

        router.start();

        expect(ran).toBe(true);
    });

    it('emits nomatch with the normalized path and runs no handler when nothing matches', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/nope');

        let settingsRan = false;
        const nomatchPaths: string[] = [];

        const router = new Router({ routes: { '/settings': () => { settingsRan = true; } } });

        router.on('nomatch', (path) => nomatchPaths.push(path));
        router.start();

        expect(settingsRan).toBe(false);
        expect(nomatchPaths).toEqual(['/nope']);
    });

    it('a modelled hashchange after start() invokes the newly-matching handler with extracted params', () => {
        installTestDOM(CONFIG);

        const calls: RouteParams[] = [];
        const router = new Router({ routes: { '/data/rows/:sel': (params) => calls.push(params) } });

        router.start();
        DOM.sink.setLocationHash('#/data/rows/5');

        expect(calls).toEqual([{ sel: '5' }]);
    });

    it('navigate writes via setLocationHash by default and via replaceLocationHash with { replace: true }', () => {
        const sink   = installTestDOM(CONFIG);
        const router = new Router();

        router.navigate('/settings');
        expect(sink.writes.some((w) => w.op === 'setLocationHash' && w.args[0] === '#/settings')).toBe(true);

        router.navigate('/other', { replace: true });
        expect(sink.writes.some((w) => w.op === 'replaceLocationHash' && w.args[0] === '#/other')).toBe(true);
    });

    it('navigating to the path already in the hash does not fire hashchange or re-run the handler', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/settings');

        let runs = 0;
        const router = new Router({ routes: { '/settings': () => { runs += 1; } } });

        router.start();
        expect(runs).toBe(1);

        router.navigate('/settings');
        expect(runs).toBe(1);
    });

    it('navigate percent-encodes each segment', () => {
        const sink   = installTestDOM(CONFIG);
        const router = new Router();

        router.navigate('/a b');

        expect(sink.writes.some((w) => w.op === 'setLocationHash' && w.args[0] === '#/a%20b')).toBe(true);
    });

    it('navigate on a never-started router still writes the hash and runs no handler', () => {
        installTestDOM(CONFIG);

        let ran = false;
        const router = new Router({ routes: { '/settings': () => { ran = true; } } });

        router.navigate('/settings');

        expect(DOM.source.getLocationHash()).toBe('#/settings');
        expect(ran).toBe(false);
    });

    it('start() on an already-started router warns once and installs no second listener', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/settings');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        let runs = 0;
        const router = new Router({ routes: { '/settings': () => { runs += 1; } } });

        router.start();
        router.start();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/^Router:/);

        // A single stop() must fully silence hashchange delivery — if a second
        // listener had leaked in, one stop() would leave it live and the
        // final hashchange below would still re-run the handler.
        router.stop();
        runs = 0;
        DOM.sink.setLocationHash('#/temp');
        DOM.sink.setLocationHash('#/settings');

        expect(runs).toBe(0);

        warn.mockRestore();
    });

    it('stop() removes the hashchange listener so a subsequent hashchange invokes no handler', () => {
        const sink = installTestDOM(CONFIG);

        let runs = 0;
        const router = new Router({ routes: { '/settings': () => { runs += 1; } } });

        router.start();
        router.stop();

        expect(sink.writes.some((w) => w.op === 'removeListener' && w.args[0] === 'hashchange')).toBe(true);

        DOM.sink.setLocationHash('#/settings');
        expect(runs).toBe(0);
    });

    it('stop() on a never-started router is a silent no-op', () => {
        installTestDOM(CONFIG);
        const router = new Router();

        expect(() => router.stop()).not.toThrow();
    });

    it('getPath() returns the normalized current path', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/settings/');

        const router = new Router();

        expect(router.getPath()).toBe('/settings');
    });

    it('on/off with the same function reference registers and removes exactly one listener; listeners fire in registration order', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/settings');

        const order: string[] = [];
        const first  = (): void => { order.push('first'); };
        const second = (): void => { order.push('second'); };

        const router = new Router({ routes: { '/settings': () => {}, '/other': () => {} } });

        router.on('navigate', first);
        router.on('navigate', second);
        router.start();

        expect(order).toEqual(['first', 'second']);

        order.length = 0;
        router.off('navigate', first);
        DOM.sink.setLocationHash('#/other');

        expect(order).toEqual(['second']);
    });

    it('the listeners bag in RouterOptions registers a listener the same way on() does', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/settings');

        const navigateEvents: RouteMatch[] = [];

        const router = new Router({
            routes:    { '/settings': () => {} },
            listeners: { navigate: (match) => navigateEvents.push(match) },
        });

        router.start();

        expect(navigateEvents).toEqual([{ pattern: '/settings', params: {}, path: '/settings' }]);
    });
});
