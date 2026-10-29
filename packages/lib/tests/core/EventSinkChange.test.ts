// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for Event's listener registries across a sink swap.
//
// The exact-target, subtree and viewport maps are module state keyed by
// component, and the set of armed window-level base listeners records the
// window of the sink that armed them. Neither used to change on a swap, so
// every component that registered a listener stayed reachable through the
// maps — with its whole subtree — for as long as the module stayed loaded (in
// a test run, the rest of the file), and an event type armed under one sink
// was never armed again under the next one. Event now forgets both on
// `DOM.onSinkChange`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM } from '../dom/TestDOM';
import { collectedAfter } from '../helpers/collectedAfter';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/** A rendered component holding one subtree listener for `type`. */
function listening(type: string): Component {
    const component = new Component();

    component.getElement(true);
    Event.addSubtreeListener(component, type, () => {});

    return component;
}

describe('Event registrations across a sink swap', () => {
    it('forgets a component registered under the old sink and keeps one registered under the new one', () => {
        installTestDOM(CONFIG);
        const stale = listening('click');
        DOM.reset();

        installTestDOM(CONFIG);
        const fresh = listening('click');

        expect(Event._registeredComponentIds()).not.toContain(stale.getId());
        expect(Event._registeredComponentIds()).toContain(fresh.getId());
    });

    it('arms the base listener on the replaced sink for a type the old sink had armed', () => {
        installTestDOM(CONFIG);
        listening('contextmenu');
        DOM.reset();

        const sink = installTestDOM(CONFIG);
        listening('contextmenu');

        expect(sink.writes.some((w) => w.op === 'addListener' && w.args[0] === 'contextmenu')).toBe(true);
    });

    it('does not keep a component registered under the old sink reachable', async () => {
        installTestDOM(CONFIG);

        const collected = await collectedAfter(() => listening('mousedown'), () => {
            DOM.reset();
            installTestDOM(CONFIG);
        });

        expect(collected).toBe(true);
    });
});
