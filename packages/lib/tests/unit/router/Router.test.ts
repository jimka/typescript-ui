// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Router lifecycle/navigation suite, driven through the modelled DOM harness
// (installTestDOM) so the hashchange round trip is exercised offline exactly
// as production wires it — see tests/dom/events.test.ts for the setup shape.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Router, type RouteMatch, type RouteParams, type RouteQuery } from '~/router/Router';
import { normalizePath } from '~/router/RoutePattern';

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
        expect(navigateEvents).toEqual([{ pattern: '/settings', params: {}, path: '/settings', fragment: '', query: {} }]);
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

        expect(navigateEvents).toEqual([{ pattern: '/settings', params: {}, path: '/settings', fragment: '', query: {} }]);
    });
});

describe('Router — History mode', () => {
    it('a router constructed with no mode behaves exactly as today: getPath() still reads the hash', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/settings');

        const router = new Router();

        expect(router.getPath()).toBe('/settings');
    });

    it.each([
        ['/typescript-ui/guide', '/guide'],
        ['/typescript-ui/',      '/'],
        ['/typescript-ui',       '/'],
    ])('getPath() strips the base from the modelled pathname %j to %j', (pathname, expected) => {
        const sink = installTestDOM(CONFIG);

        sink.pushHistoryPath(pathname);
        const router = new Router({ mode: 'history', base: '/typescript-ui/' });

        expect(router.getPath()).toBe(expected);
    });

    it('getHref returns a base-joined path in History mode and a hash fragment in hash mode', () => {
        installTestDOM(CONFIG);

        const historyRouter = new Router({ mode: 'history', base: '/typescript-ui/' });
        const hashRouter    = new Router();

        expect(historyRouter.getHref('/guide/installation')).toBe('/typescript-ui/guide/installation');
        expect(hashRouter.getHref('/guide/installation')).toBe('#/guide/installation');
    });

    it.each([
        ['/guide'],
        ['/guide/'],
        ['/a b'],
        ['/'],
    ])('getPath(getHref(%j)) round-trips to the normalized path, in both modes', (path) => {
        installTestDOM(CONFIG);

        const historyRouter = new Router({ mode: 'history', base: '/typescript-ui/' });
        const hashRouter    = new Router();
        const expected      = normalizePath(path);

        expect(historyRouter.getPath(historyRouter.getHref(path))).toBe(expected);
        expect(hashRouter.getPath(hashRouter.getHref(path))).toBe(expected);
    });

    it.each([
        ['/concepts/sizing#the-size-invariant', '/typescript-ui/concepts/sizing#the-size-invariant'],
        ['/concepts/sizing',                    '/typescript-ui/concepts/sizing'],
        ['/guide/#intro',                       '/typescript-ui/guide#intro'],
    ])('getHref(%j) is %j in History mode', (path, expected) => {
        installTestDOM(CONFIG);

        const router = new Router({ mode: 'history', base: '/typescript-ui/' });

        expect(router.getHref(path)).toBe(expected);
    });

    it.each([
        ['/typescript-ui/concepts/sizing#the-size-invariant', '/concepts/sizing'],
        ['/typescript-ui/concepts/sizing',                    '/concepts/sizing'],
    ])('getPath(%j) is %j in History mode', (href, expected) => {
        installTestDOM(CONFIG);

        const router = new Router({ mode: 'history', base: '/typescript-ui/' });

        expect(router.getPath(href)).toBe(expected);
    });

    it.each([
        ['/typescript-ui/concepts/sizing#the-size-invariant', 'the-size-invariant'],
        ['/typescript-ui/concepts/sizing',                    ''],
    ])('getFragment(%j) is %j in History mode', (href, expected) => {
        installTestDOM(CONFIG);

        const router = new Router({ mode: 'history', base: '/typescript-ui/' });

        expect(router.getFragment(href)).toBe(expected);
    });

    it('getHref(getPath(h) + "#" + getFragment(h)) round-trips h', () => {
        installTestDOM(CONFIG);

        const router = new Router({ mode: 'history', base: '/typescript-ui/' });
        const h = '/typescript-ui/concepts/sizing#the-size-invariant';

        expect(router.getHref(router.getPath(h) + '#' + router.getFragment(h))).toBe(h);
    });

    it('getFragment() with no argument reads the modelled location.hash, and "" when it is empty', () => {
        const sink = installTestDOM(CONFIG);
        sink.pushHistoryPath('/typescript-ui/concepts/sizing');

        const router = new Router({ mode: 'history', base: '/typescript-ui/' });

        expect(router.getFragment()).toBe('');

        sink.pushHistoryPath('/typescript-ui/concepts/sizing#the-size-invariant');

        expect(router.getFragment()).toBe('the-size-invariant');
    });

    it('in hash mode, getFragment() is always "" even when the modelled hash is a route', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/guide');

        const router = new Router();

        expect(router.getFragment()).toBe('');
    });

    it('navigate("/settings") records one pushHistoryPath write and calls the matching handler once', () => {
        const sink = installTestDOM(CONFIG);

        let runs = 0;
        const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/settings': () => { runs += 1; } } });

        router.navigate('/settings');

        expect(sink.writes.filter((w) => w.op === 'pushHistoryPath')).toEqual([{ op: 'pushHistoryPath', args: ['/typescript-ui/settings'] }]);
        expect(runs).toBe(1);
    });

    it('navigate("/settings", { replace: true }) records replaceHistoryPath, not pushHistoryPath', () => {
        const sink = installTestDOM(CONFIG);

        const router = new Router({ mode: 'history', base: '/typescript-ui/' });

        router.navigate('/settings', { replace: true });

        expect(sink.writes.some((w) => w.op === 'replaceHistoryPath' && w.args[0] === '/typescript-ui/settings')).toBe(true);
        expect(sink.writes.some((w) => w.op === 'pushHistoryPath')).toBe(false);
    });

    it('navigate to the path already current records no write and calls no handler', () => {
        const sink = installTestDOM(CONFIG);
        sink.pushHistoryPath('/typescript-ui/settings');

        let runs = 0;
        const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/settings': () => { runs += 1; } } });

        router.start();
        expect(runs).toBe(1);

        const writesBefore = sink.writes.length;
        router.navigate('/settings');

        expect(sink.writes.length).toBe(writesBefore);
        expect(runs).toBe(1);
    });

    it('navigate("/concepts/sizing#the-size-invariant") records one pushHistoryPath write and calls the handler once with the fragment', () => {
        const sink = installTestDOM(CONFIG);

        const calls: Array<{ path: string; fragment: string }> = [];
        const router = new Router({
            mode:   'history',
            base:   '/typescript-ui/',
            routes: { '/concepts/sizing': (_params, path, fragment) => calls.push({ path, fragment }) },
        });

        router.navigate('/concepts/sizing#the-size-invariant');

        expect(sink.writes.filter((w) => w.op === 'pushHistoryPath')).toEqual([
            { op: 'pushHistoryPath', args: ['/typescript-ui/concepts/sizing#the-size-invariant'] },
        ]);
        expect(calls).toEqual([{ path: '/concepts/sizing', fragment: 'the-size-invariant' }]);
    });

    it('from a path with no fragment, navigating to the same path with a fragment records one write and calls the handler once', () => {
        const sink = installTestDOM(CONFIG);
        sink.pushHistoryPath('/typescript-ui/concepts/sizing');

        let runs = 0;
        const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/concepts/sizing': () => { runs += 1; } } });

        router.start();
        expect(runs).toBe(1);

        const writesBefore = sink.writes.length;
        router.navigate('/concepts/sizing#the-size-invariant');

        expect(sink.writes.length).toBe(writesBefore + 1);
        expect(runs).toBe(2);
    });

    it('navigating to the same path and fragment already current records no write and calls no handler', () => {
        const sink = installTestDOM(CONFIG);
        sink.pushHistoryPath('/typescript-ui/concepts/sizing#the-size-invariant');

        let runs = 0;
        const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/concepts/sizing': () => { runs += 1; } } });

        router.start();
        expect(runs).toBe(1);

        const writesBefore = sink.writes.length;
        router.navigate('/concepts/sizing#the-size-invariant');

        expect(sink.writes.length).toBe(writesBefore);
        expect(runs).toBe(1);
    });

    it('navigating from a fragment to the bare path records one write and calls the handler with an empty fragment', () => {
        const sink = installTestDOM(CONFIG);
        sink.pushHistoryPath('/typescript-ui/concepts/sizing#the-size-invariant');

        const calls: string[] = [];
        const router = new Router({
            mode:   'history',
            base:   '/typescript-ui/',
            routes: { '/concepts/sizing': (_params, _path, fragment) => calls.push(fragment) },
        });

        router.navigate('/concepts/sizing');

        expect(sink.writes.filter((w) => w.op === 'pushHistoryPath').at(-1)).toEqual(
            { op: 'pushHistoryPath', args: ['/typescript-ui/concepts/sizing'] },
        );
        expect(calls).toEqual(['']);
    });

    it('the "navigate" event\'s RouteMatch carries the same fragment the handler received', () => {
        installTestDOM(CONFIG);

        const navigateEvents: RouteMatch[] = [];
        const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/concepts/sizing': () => {} } });

        router.on('navigate', (match) => navigateEvents.push(match));
        router.navigate('/concepts/sizing#the-size-invariant');

        expect(navigateEvents.at(-1)?.fragment).toBe('the-size-invariant');
    });

    it('in hash mode, navigate("/guide#intro") writes "#/guide" and discards the fragment', () => {
        const sink = installTestDOM(CONFIG);

        const calls: string[] = [];
        const router = new Router({ routes: { '/guide': (_params, _path, fragment) => calls.push(fragment) } });

        router.navigate('/guide#intro');

        expect(sink.writes.some((w) => w.op === 'setLocationHash' && w.args[0] === '#/guide')).toBe(true);
        router.start();
        expect(calls).toEqual(['']);
    });

    it('a popstate dispatched after the modelled pathname changes calls the newly matching handler and emits navigate', () => {
        const sink = installTestDOM(CONFIG);

        const calls: RouteParams[] = [];
        const navigateEvents: RouteMatch[] = [];
        const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/data/rows/:sel': (params) => calls.push(params) } });

        router.on('navigate', (match) => navigateEvents.push(match));
        router.start();

        sink.pushHistoryPath('/typescript-ui/data/rows/5');
        DOM.sink.dispatchCustomEvent(DOM.source.getWindow(), 'popstate');

        expect(calls).toEqual([{ sel: '5' }]);
        expect(navigateEvents.at(-1)).toEqual({ pattern: '/data/rows/:sel', params: { sel: '5' }, path: '/data/rows/5', fragment: '', query: {} });
    });

    it('a popstate dispatched after the modelled pathname and hash change calls the handler with both the new path and the new fragment', () => {
        const sink = installTestDOM(CONFIG);

        const calls: Array<{ path: string; fragment: string }> = [];
        const navigateEvents: RouteMatch[] = [];
        const router = new Router({
            mode:   'history',
            base:   '/typescript-ui/',
            routes: { '/data/rows/:sel': (_params, path, fragment) => calls.push({ path, fragment }) },
        });

        router.on('navigate', (match) => navigateEvents.push(match));
        router.start();

        sink.pushHistoryPath('/typescript-ui/data/rows/5#detail');
        DOM.sink.dispatchCustomEvent(DOM.source.getWindow(), 'popstate');

        expect(calls).toEqual([{ path: '/data/rows/5', fragment: 'detail' }]);
        expect(navigateEvents.at(-1)).toEqual({ pattern: '/data/rows/:sel', params: { sel: '5' }, path: '/data/rows/5', fragment: 'detail', query: {} });
    });

    it('start() registers a popstate listener and no hashchange listener; stop() removes it', () => {
        const sink = installTestDOM(CONFIG);
        const router = new Router({ mode: 'history', base: '/typescript-ui/' });

        router.start();

        expect(sink.writes.some((w) => w.op === 'addListener' && w.args[0] === 'popstate')).toBe(true);
        expect(sink.writes.some((w) => w.op === 'addListener' && w.args[0] === 'hashchange')).toBe(false);

        router.stop();

        expect(sink.writes.some((w) => w.op === 'removeListener' && w.args[0] === 'popstate')).toBe(true);
    });

    it('in hash mode, start() registers hashchange and no popstate; stop() removes it (the reverse of History mode)', () => {
        const sink = installTestDOM(CONFIG);
        const router = new Router();

        router.start();

        expect(sink.writes.some((w) => w.op === 'addListener' && w.args[0] === 'hashchange')).toBe(true);
        expect(sink.writes.some((w) => w.op === 'addListener' && w.args[0] === 'popstate')).toBe(false);

        router.stop();

        expect(sink.writes.some((w) => w.op === 'removeListener' && w.args[0] === 'hashchange')).toBe(true);
    });

    it('with base "/", getHref("/guide") is "/guide" and getPath() reads the pathname unchanged', () => {
        const sink = installTestDOM(CONFIG);
        sink.pushHistoryPath('/guide');

        const router = new Router({ mode: 'history', base: '/' });

        expect(router.getHref('/guide')).toBe('/guide');
        expect(router.getPath()).toBe('/guide');
    });
});

describe('Router — query parameters', () => {
    describe('getQuery', () => {
        it('hash mode reads the query embedded in the hash, and getPath() ignores it', () => {
            installTestDOM(CONFIG);
            DOM.sink.setLocationHash('#/settings?tab=advanced');

            const router = new Router();

            expect(router.getQuery()).toEqual({ tab: 'advanced' });
            expect(router.getPath()).toBe('/settings');
        });

        it('hash mode with no query is {}', () => {
            installTestDOM(CONFIG);
            DOM.sink.setLocationHash('#/settings');

            const router = new Router();

            expect(router.getQuery()).toEqual({});
        });

        it('hash mode with an explicit href reads that href\'s query', () => {
            installTestDOM(CONFIG);

            const router = new Router();

            expect(router.getQuery('#/x?a=1')).toEqual({ a: '1' });
        });

        it('History mode reads location.search, alongside the fragment and path', () => {
            const sink = installTestDOM(CONFIG);
            sink.pushHistoryPath('/typescript-ui/x?a=1#frag');

            const router = new Router({ mode: 'history', base: '/typescript-ui/' });

            expect(router.getQuery()).toEqual({ a: '1' });
            expect(router.getFragment()).toBe('frag');
            expect(router.getPath()).toBe('/x');
        });

        it('History mode with an explicit href reads that href\'s query', () => {
            installTestDOM(CONFIG);

            const router = new Router({ mode: 'history', base: '/typescript-ui/' });

            expect(router.getQuery('/typescript-ui/concepts/sizing?depth=2#anchor')).toEqual({ depth: '2' });
        });

        it('History mode: a "?" only inside the fragment is not a query, because the fragment splits off first', () => {
            installTestDOM(CONFIG);

            const router = new Router({ mode: 'history', base: '/typescript-ui/' });

            expect(router.getQuery('/typescript-ui/x#a?b=1')).toEqual({});
        });

        it('History mode with no search is {}', () => {
            installTestDOM(CONFIG);

            const router = new Router({ mode: 'history', base: '/typescript-ui/' });

            expect(router.getQuery()).toEqual({});
        });
    });

    describe('getHref', () => {
        it('back-compat: a bare path is unaffected in both modes', () => {
            installTestDOM(CONFIG);

            const historyRouter = new Router({ mode: 'history', base: '/typescript-ui/' });
            const hashRouter    = new Router();

            expect(hashRouter.getHref('/guide')).toBe('#/guide');
            expect(historyRouter.getHref('/guide')).toBe('/typescript-ui/guide');
        });

        it('hash mode: an explicit query record is appended', () => {
            installTestDOM(CONFIG);
            const router = new Router();

            expect(router.getHref('/table/users', { rotated: 'true' })).toBe('#/table/users?rotated=true');
        });

        it('hash mode: a query embedded in the path is preserved', () => {
            installTestDOM(CONFIG);
            const router = new Router();

            expect(router.getHref('/table/users?rotated=true')).toBe('#/table/users?rotated=true');
        });

        it('hash mode: an explicit record replaces an embedded query rather than merging', () => {
            installTestDOM(CONFIG);
            const router = new Router();

            expect(router.getHref('/x?a=1', { b: '2' })).toBe('#/x?b=2');
        });

        it('hash mode: an explicit empty record is still a replacement', () => {
            installTestDOM(CONFIG);
            const router = new Router();

            expect(router.getHref('/x?a=1', {})).toBe('#/x');
        });

        it('hash mode: the fragment is dropped but the query is not', () => {
            installTestDOM(CONFIG);
            const router = new Router();

            expect(router.getHref('/guide?a=1#intro')).toBe('#/guide?a=1');
        });

        it('History mode: query comes before fragment', () => {
            installTestDOM(CONFIG);
            const router = new Router({ mode: 'history', base: '/typescript-ui/' });

            expect(router.getHref('/concepts/sizing#anchor', { depth: '2' })).toBe('/typescript-ui/concepts/sizing?depth=2#anchor');
        });

        it('History mode: an embedded query and fragment are preserved', () => {
            installTestDOM(CONFIG);
            const router = new Router({ mode: 'history', base: '/typescript-ui/' });

            expect(router.getHref('/concepts/sizing?depth=2#anchor')).toBe('/typescript-ui/concepts/sizing?depth=2#anchor');
        });

        it('percent-encodes both the key and the value', () => {
            installTestDOM(CONFIG);
            const router = new Router();

            expect(router.getHref('/a b', { 'x y': 'p&q' })).toBe('#/a%20b?x%20y=p%26q');
        });

        it('round-trips through getQuery and getPath, in both modes', () => {
            installTestDOM(CONFIG);

            const historyRouter = new Router({ mode: 'history', base: '/typescript-ui/' });
            const hashRouter    = new Router();
            const path          = '/a b';
            const query: RouteQuery = { 'x y': 'p&q' };

            for (const router of [historyRouter, hashRouter]) {
                const href = router.getHref(path, query);

                expect(router.getQuery(href)).toEqual(query);
                expect(router.getPath(href)).toBe(normalizePath(path));
            }
        });
    });

    describe('navigate', () => {
        it('hash mode: an explicit query is written into the hash', () => {
            const sink   = installTestDOM(CONFIG);
            const router = new Router();

            router.navigate('/x', { query: { a: '1' } });

            expect(sink.writes.some((w) => w.op === 'setLocationHash' && w.args[0] === '#/x?a=1')).toBe(true);
        });

        it('hash mode: an embedded query with { replace: true } writes via replaceLocationHash only', () => {
            const sink   = installTestDOM(CONFIG);
            const router = new Router();

            router.navigate('/x?a=1', { replace: true });

            expect(sink.writes.some((w) => w.op === 'replaceLocationHash' && w.args[0] === '#/x?a=1')).toBe(true);
            expect(sink.writes.some((w) => w.op === 'setLocationHash')).toBe(false);
        });

        it('hash mode never writes the real location.search', () => {
            installTestDOM(CONFIG);
            const router = new Router();

            router.navigate('/x', { query: { a: '1' } });

            expect(DOM.source.getLocationSearch()).toBe('');
        });

        it('hash mode: an embedded query in the path is written as-is', () => {
            const sink   = installTestDOM(CONFIG);
            const router = new Router();

            router.navigate('/guide?a=1#intro');

            expect(sink.writes.some((w) => w.op === 'setLocationHash' && w.args[0] === '#/guide?a=1')).toBe(true);
        });

        it('hash mode back-compat: no query writes no trailing "?"', () => {
            const sink   = installTestDOM(CONFIG);
            const router = new Router();

            router.navigate('/settings');

            expect(sink.writes.some((w) => w.op === 'setLocationHash' && w.args[0] === '#/settings')).toBe(true);
        });

        it('History mode: an explicit query writes exactly one pushHistoryPath and runs the handler once', () => {
            const sink = installTestDOM(CONFIG);

            let runs = 0;
            const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/concepts/sizing': () => { runs += 1; } } });

            router.navigate('/concepts/sizing', { query: { depth: '2' } });

            expect(sink.writes.filter((w) => w.op === 'pushHistoryPath')).toEqual([
                { op: 'pushHistoryPath', args: ['/typescript-ui/concepts/sizing?depth=2'] },
            ]);
            expect(runs).toBe(1);
        });

        it('History mode: navigating to the same path with the same query records no write and re-runs no handler', () => {
            const sink = installTestDOM(CONFIG);
            sink.pushHistoryPath('/typescript-ui/x?a=1');

            let runs = 0;
            const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/x': () => { runs += 1; } } });

            router.start();
            expect(runs).toBe(1);

            const writesBefore = sink.writes.length;
            router.navigate('/x', { query: { a: '1' } });

            expect(sink.writes.length).toBe(writesBefore);
            expect(runs).toBe(1);
        });

        it('History mode: key order does not count as a change', () => {
            const sink = installTestDOM(CONFIG);
            sink.pushHistoryPath('/typescript-ui/x?a=1&b=2');

            let runs = 0;
            const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/x': () => { runs += 1; } } });

            router.start();
            expect(runs).toBe(1);

            const writesBefore = sink.writes.length;
            router.navigate('/x', { query: { b: '2', a: '1' } });

            expect(sink.writes.length).toBe(writesBefore);
        });

        it('History mode: a changed query value writes and re-runs the handler', () => {
            const sink = installTestDOM(CONFIG);
            sink.pushHistoryPath('/typescript-ui/x?a=1');

            let runs = 0;
            const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/x': () => { runs += 1; } } });

            router.start();
            expect(runs).toBe(1);

            const writesBefore = sink.writes.length;
            router.navigate('/x', { query: { a: '2' } });

            expect(sink.writes.length).toBe(writesBefore + 1);
            expect(runs).toBe(2);
        });

        it('History mode: an omitted query clears an existing one, writing and re-running the handler', () => {
            const sink = installTestDOM(CONFIG);
            sink.pushHistoryPath('/typescript-ui/x?a=1');

            let runs = 0;
            const router = new Router({ mode: 'history', base: '/typescript-ui/', routes: { '/x': () => { runs += 1; } } });

            router.start();
            expect(runs).toBe(1);

            router.navigate('/x');

            expect(sink.writes.filter((w) => w.op === 'pushHistoryPath').at(-1)).toEqual(
                { op: 'pushHistoryPath', args: ['/typescript-ui/x'] },
            );
            expect(runs).toBe(2);
        });

        it('History mode back-compat: navigate with no query writes the plain path', () => {
            const sink = installTestDOM(CONFIG);
            const router = new Router({ mode: 'history', base: '/typescript-ui/' });

            router.navigate('/settings');

            expect(sink.writes.filter((w) => w.op === 'pushHistoryPath')).toEqual([
                { op: 'pushHistoryPath', args: ['/typescript-ui/settings'] },
            ]);
        });
    });

    describe('handler and RouteMatch', () => {
        it('hash mode: the handler receives the query as its fourth argument, and RouteMatch carries it', () => {
            installTestDOM(CONFIG);
            DOM.sink.setLocationHash('#/data/rows/5?depth=3');

            const calls: Array<[RouteParams, string, string, RouteQuery]> = [];
            const navigateEvents: RouteMatch[] = [];
            const router = new Router({
                routes: { '/data/rows/:sel': (params, path, fragment, query) => calls.push([params, path, fragment, query]) },
            });

            router.on('navigate', (match) => navigateEvents.push(match));
            router.start();

            expect(calls).toEqual([[{ sel: '5' }, '/data/rows/5', '', { depth: '3' }]]);
            expect(navigateEvents).toEqual([
                { pattern: '/data/rows/:sel', params: { sel: '5' }, path: '/data/rows/5', fragment: '', query: { depth: '3' } },
            ]);
        });

        it('hash mode with no query: the fourth argument and RouteMatch.query are both {}', () => {
            installTestDOM(CONFIG);
            DOM.sink.setLocationHash('#/data/rows/5');

            const calls: RouteQuery[] = [];
            const navigateEvents: RouteMatch[] = [];
            const router = new Router({
                routes: { '/data/rows/:sel': (_params, _path, _fragment, query) => calls.push(query) },
            });

            router.on('navigate', (match) => navigateEvents.push(match));
            router.start();

            expect(calls).toEqual([{}]);
            expect(navigateEvents[0]?.query).toEqual({});
        });

        it('History mode: a popstate after a query- and fragment-bearing pathname change calls the handler with both', () => {
            const sink = installTestDOM(CONFIG);

            const calls: Array<[RouteParams, string, string, RouteQuery]> = [];
            const router = new Router({
                mode:   'history',
                base:   '/typescript-ui/',
                routes: { '/data/rows/:sel': (params, path, fragment, query) => calls.push([params, path, fragment, query]) },
            });

            router.start();
            sink.pushHistoryPath('/typescript-ui/data/rows/5?depth=3#detail');
            DOM.sink.dispatchCustomEvent(DOM.source.getWindow(), 'popstate');

            expect(calls).toEqual([[{ sel: '5' }, '/data/rows/5', 'detail', { depth: '3' }]]);
        });

        it('a handler declared with only three parameters still compiles and runs', () => {
            installTestDOM(CONFIG);
            DOM.sink.setLocationHash('#/settings?tab=advanced');

            let ran = false;
            const router = new Router({
                routes: { '/settings': (_params, _path, _fragment) => { ran = true; } },
            });

            router.start();

            expect(ran).toBe(true);
        });

        it('the query never affects which pattern wins', () => {
            installTestDOM(CONFIG);
            DOM.sink.setLocationHash('#/x?id=9');

            const calls: RouteParams[] = [];
            const router = new Router({
                routes: {
                    '/x':      (params) => calls.push(params),
                    '/x/:id':  (params) => calls.push(params),
                },
            });

            router.start();

            expect(calls).toEqual([{}]);
        });
    });
});
