import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { AccordionPanel, AccordionSectionConfig } from '~/component/container/AccordionPanel';
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

/**
 * Builds three labelled sections (the second optionally pre-opened) for panel
 * construction.
 */
function threeSections(secondOpen = false): AccordionSectionConfig[] {
    return [
        { label: 'Alpha', component: new Component() },
        { label: 'Beta',  component: new Component(), initiallyOpen: secondOpen },
        { label: 'Gamma', component: new Component() },
    ];
}

/**
 * Materialises a panel: gives it an element + size and runs doLayout(), which is
 * where the Accordion manager lazily creates its section state (open flags,
 * headers) from the per-section constraints. isSectionOpen reads that state, so
 * the layout pass is a precondition for the documented section contract.
 */
function realise(panel: AccordionPanel): AccordionPanel {
    panel.getElement(true);
    panel.setWidth(300);
    panel.setHeight(600);
    panel.clearInsets();
    panel.doLayout();

    return panel;
}

describe('AccordionPanel section state', () => {
    afterEach(() => DOM.reset());

    it('maps the sections config 1:1 and honours initiallyOpen', () => {
        installTestDOM(CONFIG);

        const panel = realise(new AccordionPanel({ sections: threeSections(true) }));
        const acc   = panel.getAccordion();

        expect(acc.isSectionOpen(0)).toBe(false);
        expect(acc.isSectionOpen(1)).toBe(true);
        expect(acc.isSectionOpen(2)).toBe(false);
    });

    it('openSection / closeSection flip the flag', () => {
        installTestDOM(CONFIG);

        const acc = realise(new AccordionPanel({ sections: threeSections() })).getAccordion();

        expect(acc.isSectionOpen(0)).toBe(false);

        acc.openSection(0);

        expect(acc.isSectionOpen(0)).toBe(true);

        acc.closeSection(0);

        expect(acc.isSectionOpen(0)).toBe(false);
    });

    it('treats an out-of-range index as a no-op', () => {
        installTestDOM(CONFIG);

        const acc = realise(new AccordionPanel({ sections: threeSections() })).getAccordion();

        expect(() => acc.openSection(99)).not.toThrow();
        expect(acc.isSectionOpen(99)).toBe(false);
        expect(acc.isSectionOpen(0)).toBe(false);
    });

    it('enforces mutual exclusion under singleOpen', () => {
        installTestDOM(CONFIG);

        const acc = realise(new AccordionPanel({
            singleOpen: true,
            sections:   threeSections(),
        })).getAccordion();

        acc.openSection(0);

        expect(acc.isSectionOpen(0)).toBe(true);

        acc.openSection(2);

        // Opening section 2 must close section 0 (single-open invariant).
        expect(acc.isSectionOpen(0)).toBe(false);
        expect(acc.isSectionOpen(2)).toBe(true);
    });

    it('expandAll under singleOpen opens only section 0', () => {
        installTestDOM(CONFIG);

        const acc = realise(new AccordionPanel({
            singleOpen: true,
            sections:   threeSections(),
        })).getAccordion();

        acc.expandAll();

        // Documented deterministic choice: the topmost section becomes the one.
        expect(acc.isSectionOpen(0)).toBe(true);
        expect(acc.isSectionOpen(1)).toBe(false);
        expect(acc.isSectionOpen(2)).toBe(false);
    });

    it('expandAll without singleOpen opens every section', () => {
        installTestDOM(CONFIG);

        const acc = realise(new AccordionPanel({ sections: threeSections() })).getAccordion();

        acc.expandAll();

        expect(acc.isSectionOpen(0)).toBe(true);
        expect(acc.isSectionOpen(1)).toBe(true);
        expect(acc.isSectionOpen(2)).toBe(true);
    });

    it('collapseAll closes every section', () => {
        installTestDOM(CONFIG);

        const acc = realise(new AccordionPanel({ sections: threeSections(true) })).getAccordion();

        acc.expandAll();
        acc.collapseAll();

        expect(acc.isSectionOpen(0)).toBe(false);
        expect(acc.isSectionOpen(1)).toBe(false);
        expect(acc.isSectionOpen(2)).toBe(false);
    });
});

describe('AccordionPanel sectiontoggle event', () => {
    afterEach(() => DOM.reset());

    it('fires with (index, open) on open and close', () => {
        installTestDOM(CONFIG);

        const events: Array<[number, boolean]> = [];
        const panel  = realise(new AccordionPanel({
            sections:        threeSections(),
            onSectionToggle: (index, open) => events.push([index, open]),
        }));
        const acc = panel.getAccordion();

        acc.openSection(1);
        acc.closeSection(1);

        expect(events).toContainEqual([1, true]);
        expect(events).toContainEqual([1, false]);
    });

    it('single-open emits a close for the prior section and an open for the new one', () => {
        installTestDOM(CONFIG);

        const events: Array<[number, boolean]> = [];
        const acc = realise(new AccordionPanel({
            singleOpen: true,
            sections:   threeSections(),
        })).getAccordion();

        acc.openSection(0);

        acc.on('sectiontoggle', (index, open) => events.push([index, open]));

        acc.openSection(2);

        // Switching sections under single-open closes 0 and opens 2.
        expect(events).toContainEqual([0, false]);
        expect(events).toContainEqual([2, true]);
    });
});

describe('AccordionPanel per-section fill weights', () => {
    afterEach(() => DOM.reset());

    /** An open section whose content has a small fixed preferred height. */
    function section(label: string, fillWeight?: number): AccordionSectionConfig {
        const component = new Component();
        component.setPreferredSize(0, PREF);

        return { label, component, initiallyOpen: true, fillWeight };
    }

    // The fixed preferred height each section's content starts at, before fill.
    const PREF = 40;

    it('fills a non-bottommost weighted section, leaving an unweighted one at preferred', () => {
        installTestDOM(CONFIG);

        const top    = section('Top', 1);
        const bottom = section('Bottom');
        realise(new AccordionPanel({ sections: [top, bottom] }));

        // The weighted top section (index 0) absorbs the slack; the bottommost,
        // unweighted section stays at its preferred height — proving fill follows
        // the weight, not position (the legacy bottommost-fills rule).
        expect(bottom.component.getHeight()).toBe(PREF);
        expect(top.component.getHeight()).toBeGreaterThan(PREF * 3);
    });

    it('splits the leftover between sections in proportion to their weights', () => {
        installTestDOM(CONFIG);

        const a = section('A', 1);
        const b = section('B', 3);
        realise(new AccordionPanel({ sections: [a, b] }));

        // Both grew past preferred, and B's extra is 3× A's extra.
        const extraA = a.component.getHeight() - PREF;
        const extraB = b.component.getHeight() - PREF;

        expect(extraA).toBeGreaterThan(0);
        expect(extraB).toBeCloseTo(extraA * 3, 5);
    });
});
