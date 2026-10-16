// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// modal-dialog-focus-trap plan, Implementation Notes "inert is never written
// to <body>". Four layout managers mount components of their own straight onto
// their container's element — a tab strip, section headers, gutters — beside
// the container's children and outside `getComponents()`. A container that
// has to reach everything mounted in it (`Body`, when the application goes
// inert behind a modal layer) asks the manager for them.
import { describe, it, expect, afterEach } from 'vitest';
import { Panel } from '~/core/Panel';
import { Component } from '~/core/Component';
import { Split } from '~/layout/Split';
import { Border } from '~/layout/Border';
import { Accordion } from '~/layout/Accordion';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
import { Tab } from '~/layout/Tab';
import { HBox } from '~/layout/HBox';
import { SplitGutter } from '~/component/container/SplitGutter';
import { AccordionHeader } from '~/component/container/AccordionHeader';
import { TabBar } from '~/component/container/TabBar';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/** A pane with a preferred size, so every manager can place it. */
function pane(): Component {
    return new Component({ preferredSize: { width: 50, height: 50 } });
}

/** Renders `panel` at a fixed size and runs one layout pass. */
function layOut(panel: Panel): Panel {
    panel.getElement(true);
    panel.setWidth(300);
    panel.setHeight(300);
    panel.doLayout();

    return panel;
}

describe('LayoutManager.getChromeComponents', () => {
    it('a manager that mounts nothing of its own reports nothing', () => {
        installTestDOM(CONFIG);

        const manager = new HBox();
        const panel   = new Panel({ layoutManager: manager });

        panel.addComponent(pane());
        layOut(panel);

        expect(manager.getChromeComponents()).toEqual([]);
    });

    it('Split reports its gutters, and none of the panes', () => {
        installTestDOM(CONFIG);

        const manager = new Split();
        const panel   = new Panel({ layoutManager: manager });
        const panes   = [pane(), pane(), pane()];

        for (const each of panes) {
            panel.addComponent(each);
        }

        layOut(panel);

        const chrome = manager.getChromeComponents();

        // One gutter per boundary between two panes.
        expect(chrome).toHaveLength(2);
        expect(chrome.every(component => component instanceof SplitGutter)).toBe(true);
        expect(chrome.some(component => panes.includes(component))).toBe(false);
    });

    it('Border reports the gutter of each collapsible region', () => {
        installTestDOM(CONFIG);

        const manager = new Border();
        const panel   = new Panel({ layoutManager: manager });

        panel.addComponent(pane(), { placement: Placement.NORTH, collapsible: true });
        panel.addComponent(pane(), { placement: Placement.CENTER });
        layOut(panel);

        const chrome = manager.getChromeComponents();

        expect(chrome).toHaveLength(1);
        expect(chrome[0]).toBeInstanceOf(SplitGutter);
    });

    it('Accordion reports each section header', () => {
        installTestDOM(CONFIG);

        const manager = new Accordion();
        const panel   = new Panel({ layoutManager: manager });

        panel.getElement(true);
        panel.addComponent(pane(), new AccordionConstraints('A', true));
        panel.addComponent(pane(), new AccordionConstraints('B', false));
        layOut(panel);

        const chrome  = manager.getChromeComponents();
        const headers = chrome.filter(component => component instanceof AccordionHeader);

        expect(headers).toHaveLength(2);

        // ...and the wrapper it mounts around each section's content: two
        // more components on the container's element that are not children.
        expect(chrome).toHaveLength(4);
        expect(chrome.some(component => panel.getComponents().includes(component))).toBe(false);
    });

    it('Accordion reports the resize gutter between two open sections too', () => {
        installTestDOM(CONFIG);

        const manager = new Accordion();
        const panel   = new Panel({ layoutManager: manager });

        manager.setResizable(true);
        panel.getElement(true);
        panel.addComponent(pane(), new AccordionConstraints('A', true));
        panel.addComponent(pane(), new AccordionConstraints('B', true));
        layOut(panel);

        const gutters = manager.getChromeComponents().filter(component => component instanceof SplitGutter);

        // One gutter per adjacent pair of open sections.
        expect(gutters).toHaveLength(1);
    });

    it('Tab reports its tab strip', () => {
        installTestDOM(CONFIG);

        const manager = new Tab();
        const panel   = new Panel({ layoutManager: manager });

        panel.addComponent(pane());
        layOut(panel);

        const chrome = manager.getChromeComponents();

        expect(chrome).toHaveLength(1);
        expect(chrome[0]).toBeInstanceOf(TabBar);
    });
});
