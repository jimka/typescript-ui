// Coverage for a destroyed component's setters writing nothing.
//
// `Component.destructor` releases the component's DOM handles. Its two write
// buffers (`_inlineStyle` and `_elementAttributes`) used to stay bound to the
// released handles, so any setter that would change a style or an attribute
// threw `DOM handle N is not registered` when called on a disposed component.
// The destructor now detaches both buffers, as `Component.release()` does: a
// late setter updates cached state and reaches no element. A raw handle stays
// loud on purpose.
//
// Cases are numbered to match `plans/in-progress/deferred-work-after-dispose.md`'s
// `## Expected Behaviour` "A destroyed component" table (B1-B4).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import { Panel } from '~/core/Panel';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import { installTestDOM, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('a destroyed component writes nothing', () => {
    let sink: RecordingDOMSink;

    beforeEach(() => {
        sink = installTestDOM(CONFIG);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        DOM.reset();
    });

    it('B1: setters that would write a style or an attribute neither throw nor reach the sink', () => {
        const component = new Component({});

        component.getElement(true);
        component.dispose();

        const writesBefore = sink.writes.length;

        expect(() => {
            component.setTranslate(3, 4);
            component.setOpacity(0.5);
        }).not.toThrow();

        const applied = sink.writes.slice(writesBefore).filter((write) => write.op === 'apply');

        expect(applied).toEqual([]);
    });

    it('B2: disposing a dialog that already closed is harmless', () => {
        vi.useFakeTimers();
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
            callback(0);

            return 1;
        });

        const dialog = new Dialog({ title: 't', message: 'm' });

        void dialog.show();
        dialog.hide('close');
        vi.advanceTimersByTime(2000);

        expect(() => dialog.dispose()).not.toThrow();
    });

    it('B3: laying out a container that still holds a directly disposed child does not throw', () => {
        const container = new Container();
        const child = new Panel();

        container.getElement(true);
        container.addComponent(child);
        container.doLayout();
        child.dispose();

        expect(() => container.doLayout()).not.toThrow();
    });

    it('B4: a raw handle read before the dispose still throws once released', () => {
        const component = new Component({});
        const handle = component.getElement(true)!;

        component.dispose();

        expect(() => DOM.source.getElementRect(handle)).toThrow(/not registered/);
    });
});
