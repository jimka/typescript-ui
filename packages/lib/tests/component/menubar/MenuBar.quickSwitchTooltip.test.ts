// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The menu bar's quick-switch under a real pointer. Hovering a button while
// another menu is open opens the hovered one, and the button whose menu closes
// restores its title tooltip from inside that same `mouseover` dispatch. The
// pointer has just left that button, so the restored tooltip must stay quiet —
// only the button now under the pointer may show one, and that one is
// silenced while its own menu is open.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { MenuBar } from '~/component/menubar/MenuBar';
import { Component } from '~/core/Component';
import { DOM, type Handle } from '~/core/DOM';
import { Tooltip } from '~/overlay/Tooltip';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Mirrors `Tooltip.attach`'s `setTimeout(..., 500)` hover delay.
const HOVER_DELAY_MS = 500;
// Past the tooltip's 100 ms fade and its fallback timer.
const FADE_SETTLE_MS = 500;
// Any in-viewport pointer position: no case reads where the tooltip is placed.
const CURSOR_PX      = 10;

const MENUS = [
    { label: 'File', items: [{ text: 'New' }] },
    { label: 'Edit', items: [{ text: 'Undo' }] },
];

let showSpy: MockInstance<typeof Tooltip.show>;

/**
 * Dispatches a real event of `type` on `target` through `Event`'s window-level
 * handler.
 *
 * @param type - The event type.
 * @param target - The element the event targets.
 * @param related - The event's `relatedTarget`, if any.
 */
function fire(type: string, target: Handle, related?: Handle): void {
    DOM.sink.dispatchEvent(
        DOM.source.getWindow(),
        makeEvent(target, type, { clientX: CURSOR_PX, clientY: CURSOR_PX, relatedTarget: related }),
    );
}

/**
 * The pointer moves from `from` onto `to` in the order a browser raises it:
 * the pointer events first, then the compatibility mouse events, then a move
 * over the new element.
 *
 * @param from - The element the pointer leaves.
 * @param to - The element the pointer moves onto.
 */
function crossTo(from: Handle, to: Handle): void {
    fire('pointerout',  from, to);
    fire('pointerover', to, from);
    fire('mouseout',    from, to);
    fire('mouseover',   to, from);
    fire('mousemove',   to);
}

beforeEach(() => {
    installTestDOM(CONFIG);
    vi.useFakeTimers();

    showSpy = vi.spyOn(Tooltip, 'show');
});

afterEach(() => {
    Tooltip.hide();
    vi.advanceTimersByTime(FADE_SETTLE_MS);

    vi.useRealTimers();
    vi.restoreAllMocks();

    (Tooltip as any).showTimer = null;
    (Tooltip as any).instance = null;
    (Tooltip as any).watching = false;
    (Tooltip as any).activeElement = null;
    (Tooltip as any).pendingId = null;
    (Tooltip as any).dismissing = false;
    (Tooltip as any).attachments.clear();
    Tooltip._stopPointerWatch();

    DOM.reset();
});

describe('MenuBar quick-switch tooltips', () => {
    it('switching back to an earlier menu shows no tooltip for the button just left', () => {
        const bar = new MenuBar({ menus: MENUS });

        bar.getElement(true);

        const [file, edit] = (bar as unknown as Component).getComponents();
        const fileEl       = file.getElement(true)!;
        const editEl       = edit.getElement(true)!;
        const outside      = DOM.source.getDocumentElement();

        crossTo(outside, fileEl);
        bar.openMenu(0);

        crossTo(fileEl, editEl);
        expect(bar.getOpenIndex()).toBe(1);

        crossTo(editEl, fileEl);
        expect(bar.getOpenIndex()).toBe(0);

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(showSpy).not.toHaveBeenCalled();

        bar.dispose();
    });
});
