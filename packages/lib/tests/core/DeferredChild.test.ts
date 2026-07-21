//
// Coverage for the deferred-child seam on Component.addComponent: a child may be
// passed as a zero-argument factory instead of a live instance. A layout manager
// gets first refusal through LayoutManager.addDeferredComponent; the base hook
// declines, so every manager except Tab behaves as if the caller had written
// addComponent(factory()).
//
// A factory that returns a promise is only meaningful on the deferred path,
// because that path is the one with a spinner to show and an owner for the wait.
// On the eager path it throws rather than silently adding nothing.
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { HBox } from '~/layout/HBox';
import { Tab } from '~/layout/Tab';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/**
 * Builds a laid-out container whose manager declines deferral, so a factory is
 * built immediately.
 *
 * @returns A container managed by an HBox.
 */
function eagerHost(): Container {
    const host = new Container({ layoutManager: new HBox() });

    host.getElement(true);

    return host;
}

/**
 * Builds a constraints object carrying the given fields.
 *
 * @param fields - Constraint fields to apply.
 * @returns A LayoutConstraints instance.
 */
function constraints(fields: Partial<LayoutConstraints>): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), fields);
}

describe('addComponent with a factory', () => {

    it('runs the factory immediately when no manager defers it', () => {
        const host  = eagerHost();
        const built = new Component();

        host.addComponent(() => built, constraints({ name: 'A' }));

        expect(host.getComponents()).toEqual([built]);
        expect(host.getLayoutConstraints(built)?.name).toBe('A');
    });

    it('adds a live component normally even when lazy is set', () => {
        const host     = eagerHost();
        const instance = new Component();

        // `lazy` describes a factory. Construction already happened for an
        // instance, so the flag has nothing left to defer.
        host.addComponent(instance, constraints({ lazy: true }));

        expect(host.getComponents()).toEqual([instance]);
    });

    it('builds every factory passed through addComponents, in order', () => {
        const host = eagerHost();
        const a    = new Component();
        const b    = new Component();

        host.addComponents(() => a, { component: () => b, constraints: constraints({ name: 'B' }) });

        expect(host.getComponents()).toEqual([a, b]);
        expect(host.getLayoutConstraints(b)?.name).toBe('B');
    });

    it('builds a factory passed through the components options bag', () => {
        const built = new Component();
        const host  = new Container({ layoutManager: new HBox(), components: [() => built] });

        host.getElement(true);

        expect(host.getComponents()).toEqual([built]);
    });
});

describe('addComponent with an async factory on the eager path', () => {

    it('throws when no manager can host the wait', () => {
        const host = eagerHost();

        expect(() => host.addComponent(async () => new Component()))
            .toThrow(/addComponent/);
        expect(host.getComponents()).toEqual([]);
    });

    it('throws under a Tab when lazy is explicitly declined', () => {
        const host = new Container({ layoutManager: new Tab() });

        host.getElement(true);

        // `lazy: false` opts out of the deferral, so the eager path applies and
        // there is once again nothing to own the wait.
        expect(() => host.addComponent(async () => new Component(), constraints({ lazy: false })))
            .toThrow(/addComponent/);
    });
});
