// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for `Component.setContentClampSuspended()` — the seam `Split` and
 * `Border` use to keep a general `Component` pane/region at its box while its
 * children are out of the render tree (plan collapsed-panes-leave-render-tree.md).
 * A component that clamps to its content-derived size reads the merged max
 * live, and a box manager with no laid-out children reports its bare
 * perimeter, so without the seam every box write would be clamped away.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** A general (content-clamping) component with a box manager and one undisplayed child. */
function makeChildlessBoxHost(): Component {
    const host  = new Component({ layoutManager: new VBox() });
    const child = new Component({ preferredSize: { width: 50, height: 50 } });

    host.getElement(true);
    host.addComponent(child);
    child.getElement(true);
    child.setDisplayed(false);

    return host;
}

describe('Component.setContentClampSuspended', () => {
    it('clamps a box-managed component with no laid-out children to its bare perimeter by default', () => {
        const host = makeChildlessBoxHost();

        host.setWidth(198);
        host.setHeight(300);

        expect(host.getWidth()).toBe(0);
        expect(host.getHeight()).toBe(0);
    });

    it('lets the box be committed at full size while suspended, and clamps again once resumed', () => {
        const host = makeChildlessBoxHost();

        host.setContentClampSuspended(true);
        host.setWidth(198);
        host.setHeight(300);

        expect(host.getWidth()).toBe(198);
        expect(host.getHeight()).toBe(300);

        host.setContentClampSuspended(false);
        host.setWidth(150);
        host.setHeight(200);

        expect(host.getWidth()).toBe(0);
        expect(host.getHeight()).toBe(0);
    });

    it('still honours the component\'s own explicit constraints while suspended', () => {
        const host = makeChildlessBoxHost();

        host.setMaxSize({ width: 120, height: 120 });
        host.setContentClampSuspended(true);
        host.setWidth(198);
        host.setHeight(300);

        expect(host.getWidth()).toBe(120);
        expect(host.getHeight()).toBe(120);
    });
});
