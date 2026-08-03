// Registry test enforcing that disposing a component purges every DOM
// listener registration it holds through the `Event` API. Mirrors
// tests/component/dispose-full-teardown.test.ts's REGISTRY / collectIds
// shape, swapping the rule-cache inventory for the listener-registration
// inventory `Event._registeredComponentIds()` exposes.
//
// Every listed class registers its listeners in its constructor, so unlike
// the rule-cache registry this needs no render pass, no warm-up (listener
// registration is per-instance state, not shared/lazily-materialised process
// state), and no before/after set diff — asserting that no snapshotted id
// survives the purge is already exact.
import { describe, it, expect } from 'vitest';
import { Component } from '~/core/Component';
import { Link } from '~/component/input/Link';
import { MenuItem } from '~/component/container/MenuItem';
import { MenuBarButton } from '~/component/menubar/MenuBarButton';
import { CollapseButton } from '~/component/container/CollapseButton';
import { ChartLegend } from '~/component/chart/ChartLegend';
import { LineChart } from '~/component/chart/LineChart';
import { Event } from '~/core/Event';

/**
 * Recursively collects a component's own id plus every registered
 * descendant's id (via `getComponents()`).
 */
function collectIds(c: Component): string[] {
    const ids = [c.getId()];

    for (const child of c.getComponents()) {
        ids.push(...collectIds(child));
    }

    return ids;
}

const REGISTRY: Array<{ name: string; make: () => Component }> = [
    { name: 'Link',           make: () => new Link('x') },
    { name: 'MenuItem',       make: () => new MenuItem({ text: 'A' }, () => {}, () => {}) },
    { name: 'MenuBarButton',  make: () => new MenuBarButton('File', () => {}, () => {}) },
    { name: 'CollapseButton', make: () => new CollapseButton() },
    { name: 'ChartLegend',    make: () => new ChartLegend() },
    { name: 'AbstractChart (via LineChart)', make: () => new LineChart({}) },
];

describe('dispose-listener-teardown registry: every dispose() purges its Event registrations', () => {
    for (const { name, make } of REGISTRY) {
        it(name, () => {
            const c = make();
            const ids = collectIds(c);

            c.dispose();

            const registered = Event._registeredComponentIds();
            const leaked = ids.filter((id) => registered.includes(id));

            expect(leaked).toEqual([]);
        });
    }
});
