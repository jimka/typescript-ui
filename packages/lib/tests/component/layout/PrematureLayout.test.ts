// Regression: an autoScroll Panel drives LayoutManager.setOverflowing during its
// own construction (Panel.setAutoScroll → LayoutManager.setOverflowing →
// container.doLayout()), which synchronously lays out the whole stage —
// including a child Panel that has never been rendered and so has no DOM
// element yet. HBox, VBox, Grid, Split and Tab already treat that as a normal
// transient state and return quietly (see HBox.doLayout); Border threw
// "Unable to determine component size." and Accordion's createSection
// dereferenced a null container element. This is the exact docs-app crash
// reproduced offline. See plans/implemented/scrollbar-leak-and-layout-guards.md
// (Bug 2).
import { describe, it, expect, afterEach } from 'vitest';
import { Panel } from '~/core/Panel';
import { Component } from '~/core/Component';
import { Fit } from '~/layout/Fit';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { Grid } from '~/layout/Grid';
import { Split } from '~/layout/Split';
import { Tab } from '~/layout/Tab';
import { Border } from '~/layout/Border';
import { Accordion } from '~/layout/Accordion';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
import type { LayoutManager } from '~/layout/LayoutManager';
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

/** An unrendered Panel with a Border manager carrying a north and a center child. */
function elementLessBorderPanel(): Panel {
    const borderPanel = new Panel({ layoutManager: new Border() });

    borderPanel.addComponent(new Component({ preferredSize: { width: 10, height: 10 } }), { placement: Placement.NORTH });
    borderPanel.addComponent(new Component({ preferredSize: { width: 10, height: 10 } }), { placement: Placement.CENTER });

    return borderPanel;
}

/** An unrendered Panel with an Accordion manager carrying two sections. */
function elementLessAccordionPanel(): Panel {
    const accordionPanel = new Panel({ layoutManager: new Accordion() });

    accordionPanel.addComponent(new Component({ preferredSize: { width: 10, height: 10 } }), new AccordionConstraints('A'));
    accordionPanel.addComponent(new Component({ preferredSize: { width: 10, height: 10 } }), new AccordionConstraints('B'));

    return accordionPanel;
}

describe('Border / Accordion — premature layout guard', () => {
    it('B2-1: an autoScroll stage holding an element-less Border-managed panel does not throw during construction', () => {
        installTestDOM(CONFIG);

        expect(() => new Panel({
            layoutManager: new Fit(),
            autoScroll:    'both',
            components:    [elementLessBorderPanel()],
        })).not.toThrow();
    });

    it('B2-2: the same construction with an Accordion-managed panel records no appendChild onto a falsy parent', () => {
        const sink = installTestDOM(CONFIG);

        new Panel({
            layoutManager: new Fit(),
            autoScroll:    'both',
            components:    [elementLessAccordionPanel()],
        });

        expect(sink.writes.filter((w) => w.op === 'appendChild' && !w.args[0])).toEqual([]);
    });

    it('B2-3: a deferred Border layout pass defers, then places every region once the container has an element', () => {
        installTestDOM(CONFIG);

        const borderPanel = elementLessBorderPanel();

        expect(() => borderPanel.doLayout()).not.toThrow(); // deferred: no element yet

        borderPanel.getElement(true);
        borderPanel.setWidth(400);
        borderPanel.setHeight(300);
        borderPanel.doLayout();

        const [north, center] = borderPanel.getComponents();
        const inner = borderPanel.getInnerSize()!;

        expect(north.getWidth()).toBe(inner.width);
        expect(center.getWidth()).toBe(inner.width);
        expect(center.getHeight()).toBeLessThan(inner.height);
    });

    it('B2-3: a deferred Accordion layout pass defers, then builds one header and one wrapper per child once the container has an element', () => {
        installTestDOM(CONFIG);

        const accordionPanel = elementLessAccordionPanel();
        const acc = accordionPanel.getLayoutManager() as unknown as {
            _headers: unknown[];
            _panelWrappers: unknown[];
        };

        expect(() => accordionPanel.doLayout()).not.toThrow(); // deferred: no element yet

        // The deferral must be real, not incidental: nothing is built until the
        // container has an element, or `createSection` would have dereferenced
        // a null element on the call above.
        expect(acc._headers.length).toBe(0);
        expect(acc._panelWrappers.length).toBe(0);

        accordionPanel.getElement(true);
        accordionPanel.setWidth(400);
        accordionPanel.setHeight(300);
        accordionPanel.doLayout();

        expect(acc._headers.length).toBe(2);
        expect(acc._panelWrappers.length).toBe(2);
    });

    it('B2-4: every layout manager tolerates a doLayout pass before its container has an element', () => {
        const managers: Array<{ name: string; make: () => LayoutManager }> = [
            { name: 'HBox',      make: () => new HBox() },
            { name: 'VBox',      make: () => new VBox() },
            { name: 'Grid',      make: () => new Grid() },
            { name: 'Split',     make: () => new Split() },
            { name: 'Tab',       make: () => new Tab() },
            { name: 'Border',    make: () => new Border() },
            { name: 'Accordion', make: () => new Accordion() },
        ];

        for (const { name, make } of managers) {
            const sink = installTestDOM(CONFIG);

            const panel = new Panel({ layoutManager: make() });
            panel.addComponent(new Component({ preferredSize: { width: 10, height: 10 } }));

            expect(() => panel.doLayout(), name).not.toThrow();
            expect(sink.writes.filter((w) => w.op === 'appendChild' && !w.args[0]), name).toEqual([]);

            DOM.reset();
        }
    });
});
