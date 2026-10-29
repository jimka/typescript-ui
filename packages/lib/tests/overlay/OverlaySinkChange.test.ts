// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for the overlays' class-wide state across a sink swap.
//
// Tooltip, Menu, AbstractWindow and Notification each install a class-wide
// viewport listener once and record that they did: Tooltip's pointer watch
// with the first attachment, Menu's input watch with the first menu, the
// minimized-window dock's `resize` listener with the first minimize, and the
// toast stack's with the first toast. `Event` drops every viewport
// registration on a swap, so the record used to outlive the listener and it
// was never installed again. Tooltip's attachments, Menu's keyboard sessions,
// the open windows and the live toasts are class-wide too, and pinned every
// component they named. All four classes now forget that state on
// `DOM.onSinkChange`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { Tooltip } from '~/overlay/Tooltip';
import { Menu } from '~/overlay/Menu';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Notification } from '~/overlay/Notification';
import { installTestDOM, type RecordingDOMSink } from '../dom/TestDOM';
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

/** Whether `sink` was asked to listen for `type`. */
function listensFor(sink: RecordingDOMSink, type: string): boolean {
    return sink.writes.some((w) => w.op === 'addListener' && w.args[0] === type);
}

/** A rendered component carrying a tooltip. */
function withTooltip(): Component {
    const component = new Component();

    component.getElement(true);
    Tooltip.attach(component, 'tip');

    return component;
}

describe('Tooltip across a sink swap', () => {
    it('installs the pointer watch on the replaced sink for the next attachment', () => {
        installTestDOM(CONFIG);
        withTooltip();
        DOM.reset();

        const sink = installTestDOM(CONFIG);
        withTooltip();

        expect(listensFor(sink, 'mousemove')).toBe(true);
    });

    it('does not keep a component attached under the old sink reachable', async () => {
        installTestDOM(CONFIG);

        const collected = await collectedAfter(withTooltip, () => {
            DOM.reset();
            installTestDOM(CONFIG);
        });

        expect(collected).toBe(true);
    });
});

describe('Menu across a sink swap', () => {
    it('installs the input watch on the replaced sink for the next menu', () => {
        installTestDOM(CONFIG);
        new Menu();
        DOM.reset();

        const sink = installTestDOM(CONFIG);
        new Menu();

        expect(listensFor(sink, 'pointerdown')).toBe(true);
    });
});

/** Whether the class-wide listener owner `owner` holds a viewport registration. */
function ownerRegistered(owner: Component): boolean {
    return Event._registeredComponentIds().includes(owner.getId());
}

describe('AbstractWindow across a sink swap', () => {
    /** A shown, minimized window: what installs the dock's resize listener. */
    function minimizedWindow(): Window {
        // Reduced motion, so the minimize lands at once rather than after an
        // animation the offline sink never runs.
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} } as never);

        const win = new Window('W');

        win.show();
        win.minimize();

        return win;
    }

    it('forgets the windows opened under the old sink', () => {
        installTestDOM(CONFIG);
        new Window('W').show();
        DOM.reset();

        installTestDOM(CONFIG);

        expect(AbstractWindow.getOpenWindows()).toEqual([]);
    });

    it('installs the dock\'s resize listener on the replaced sink for the next minimize', () => {
        installTestDOM(CONFIG);
        minimizedWindow();
        DOM.reset();

        installTestDOM(CONFIG);
        minimizedWindow();

        expect(ownerRegistered((AbstractWindow as any).stackResizeListenerOwner)).toBe(true);
    });
});

describe('Notification across a sink swap', () => {
    afterEach(() => vi.useRealTimers());

    it('installs the stack\'s resize listener on the replaced sink for the next toast', () => {
        vi.useFakeTimers();
        installTestDOM(CONFIG);
        Notification.show('one');
        DOM.reset();

        installTestDOM(CONFIG);
        Notification.show('two');

        expect(ownerRegistered((Notification as any).resizeListenerOwner)).toBe(true);
        expect((Notification as any).activeNotifications).toHaveLength(1);
    });
});
