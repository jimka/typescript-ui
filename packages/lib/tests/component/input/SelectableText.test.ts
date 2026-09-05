// Drives SelectableText's self-wired right-click Copy menu through the real
// `contextmenu` listener (Event.fireEvent + makeEvent), asserting the
// resulting Menu via vi.spyOn(Menu.prototype, 'show') — never a white-box
// call to the private handleContextMenu. Follows
// plans/text-input-context-menu-clipboard.md's Step 2 idiom.
//
// Event's window-level base listener is armed once per event TYPE for the
// lifetime of this module and is not re-armed by a later installTestDOM()
// call unless the component holding it is disposed first (see the file-level
// note in tests/component/container/CollapseButton.test.ts, which documents
// the same constraint) — every component that fires or listens for a real
// `contextmenu` below is disposed before its test ends.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { SelectableText } from '~/component/input/SelectableText';
import { Panel } from '~/core/Panel';
import { Event } from '~/core/Event';
import { DOM } from '~/core/DOM';
import { Menu } from '~/overlay/Menu';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

describe('SelectableText — copyMenu option', () => {
    it('defaults to off; the constructor option turns it on', () => {
        installTestDOM(CONFIG);

        const off = new SelectableText('x');
        const on  = new SelectableText('x', { copyMenu: true });

        expect(off.hasCopyMenu()).toBe(false);
        expect(on.hasCopyMenu()).toBe(true);

        off.dispose();
        on.dispose();
    });

    it('with copyMenu unset, a right-click falls through to the parent subtree listener, not a Menu', () => {
        installTestDOM(CONFIG);

        const showSpy = vi.spyOn(Menu.prototype, 'show');
        const panel   = new Panel({});
        const text    = new SelectableText('x');

        panel.getElement(true);
        panel.addComponent(text);

        let subtreeRuns = 0;
        Event.addSubtreeListener(panel, 'contextmenu', () => { subtreeRuns += 1; });

        const el = text.getElement()!;
        Event.fireEvent(text, makeEvent(el, 'contextmenu', { clientX: 10, clientY: 20 }));

        expect(showSpy).not.toHaveBeenCalled();
        expect(subtreeRuns).toBe(1);

        panel.dispose();
    });

    it('with copyMenu: true, a right-click opens a one-row Copy Menu at the event coordinates and does not fall through', () => {
        installTestDOM(CONFIG);

        const showSpy = vi.spyOn(Menu.prototype, 'show');
        const panel   = new Panel({});
        const text    = new SelectableText('x', { copyMenu: true });

        panel.getElement(true);
        panel.addComponent(text);

        let subtreeRuns = 0;
        Event.addSubtreeListener(panel, 'contextmenu', () => { subtreeRuns += 1; });

        const el = text.getElement()!;
        Event.fireEvent(text, makeEvent(el, 'contextmenu', { clientX: 10, clientY: 20 }));

        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(showSpy.mock.calls[0][0]).toBe(10);
        expect(showSpy.mock.calls[0][1]).toBe(20);
        expect((showSpy.mock.calls[0][2] as { text?: string }[]).map(i => i.text)).toEqual(['Copy']);
        expect(subtreeRuns).toBe(0);

        panel.dispose();
    });

    it('dims Copy with no selection spied in, and enables it with a selection contained in the element', () => {
        installTestDOM(CONFIG);

        const showSpy = vi.spyOn(Menu.prototype, 'show');
        const text    = new SelectableText('x', { copyMenu: true });
        const el      = text.getElement(true)!;

        Event.fireEvent(text, makeEvent(el, 'contextmenu', { clientX: 0, clientY: 0 }));
        expect((showSpy.mock.calls[0][2] as { enabled?: boolean }[])[0].enabled).toBe(false);

        vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({
            startContainer: el,
            startOffset:    0,
            endContainer:   el,
            endOffset:      1,
        });
        vi.spyOn(DOM.source, 'getDocumentSelectionText').mockReturnValue('x');

        Event.fireEvent(text, makeEvent(el, 'contextmenu', { clientX: 0, clientY: 0 }));
        expect((showSpy.mock.calls[1][2] as { enabled?: boolean }[])[0].enabled).toBe(true);

        text.dispose();
    });

    it('setCopyMenu toggles the menu on and off after construction', () => {
        installTestDOM(CONFIG);

        const showSpy = vi.spyOn(Menu.prototype, 'show');
        const panel   = new Panel({});
        const text    = new SelectableText('x');

        panel.getElement(true);
        panel.addComponent(text);

        let subtreeRuns = 0;
        Event.addSubtreeListener(panel, 'contextmenu', () => { subtreeRuns += 1; });

        const el = text.getElement()!;

        text.setCopyMenu(true);
        Event.fireEvent(text, makeEvent(el, 'contextmenu', { clientX: 1, clientY: 1 }));
        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(subtreeRuns).toBe(0);

        text.setCopyMenu(false);
        Event.fireEvent(text, makeEvent(el, 'contextmenu', { clientX: 1, clientY: 1 }));
        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(subtreeRuns).toBe(1);

        panel.dispose();
    });

    it('disposing a SelectableText that has opened its menu disposes that Menu', () => {
        installTestDOM(CONFIG);

        const disposeSpy = vi.spyOn(Menu.prototype, 'dispose');
        const text       = new SelectableText('x', { copyMenu: true });
        const el         = text.getElement(true)!;

        Event.fireEvent(text, makeEvent(el, 'contextmenu', { clientX: 0, clientY: 0 }));
        text.dispose();

        expect(disposeSpy).toHaveBeenCalledTimes(1);
    });
});
