// Regression: three layout managers raw-append chrome components straight
// onto their container's element instead of registering them via
// `addComponent`, so `Component.destructor()`'s child recursion — which walks
// `_components` — never reaches them and their per-instance stylesheet rules
// are never deleted:
//   - `Split` / `Border` / `Accordion` each append a `SplitGutter` per pane
//     boundary / collapsible region / section, and `SplitGutter` in turn
//     raw-appends its own `CollapseButton`.
//   - `Accordion` additionally raw-appends a header and a panel-wrapper
//     component per section.
// `SplitGutter.destroy()` and `CollapseButton.destroy()` predate the
// dispose()/destructor() teardown seam and only unhooked listeners, so even a
// gutter reached via the old `gutter.destroy()` call sites left its rule
// behind. See plans/implemented/scrollbar-leak-and-layout-guards.md (Bug 1,
// cases B1-4 through B1-7).
import { describe, it, expect, afterEach } from 'vitest';
import { Panel } from '~/core/Panel';
import { Component } from '~/core/Component';
import { Button } from '~/component/button/Button';
import { Fit } from '~/layout/Fit';
import { Split } from '~/layout/Split';
import { Border } from '~/layout/Border';
import { Accordion } from '~/layout/Accordion';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/** Calls the protected destructor, as an owning window does when it closes. */
function destroy(panel: Panel): void {
    (panel as unknown as { destructor(): void }).destructor();
}

/** A rendered, laid-out Panel with a Split manager and two panes. */
function renderedSplitPanel(): Panel {
    const panel = new Panel({ layoutManager: new Split() });

    panel.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }));
    panel.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }));

    panel.getElement(true);
    panel.setWidth(300);
    panel.setHeight(300);
    panel.doLayout();

    return panel;
}

/** A rendered, laid-out Panel with a Border manager and one collapsible region. */
function renderedBorderPanel(): Panel {
    const panel = new Panel({ layoutManager: new Border() });

    panel.addComponent(new Component({ preferredSize: { width: 50, height: 30 } }), { placement: Placement.NORTH, collapsible: true });
    panel.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }), { placement: Placement.CENTER });

    panel.getElement(true);
    panel.setWidth(300);
    panel.setHeight(300);
    panel.doLayout();

    return panel;
}

/** A rendered, laid-out Panel with an Accordion manager and two sections. */
function renderedAccordionPanel(): Panel {
    const panel = new Panel({ layoutManager: new Accordion() });

    // `backgroundColor` is a conditional declaration, never hoisted onto the
    // class rule, so it is what gives each content child a per-instance `#id`
    // rule — a stock component now materialises none at all, and B1-7's
    // survives-the-swap assertion reads the rule keys.
    panel.addComponent(new Component({ preferredSize: { width: 50, height: 50 }, backgroundColor: '#fff' }), new AccordionConstraints('A', true));
    panel.addComponent(new Component({ preferredSize: { width: 50, height: 50 }, backgroundColor: '#fff' }), new AccordionConstraints('B'));

    panel.getElement(true);
    panel.setWidth(300);
    panel.setHeight(300);
    panel.doLayout();

    return panel;
}

describe('Split / Border / Accordion — gutter and chrome style-rule disposal', () => {
    it('B1-4: destroying a Split-managed panel leaves no new rule-cache key', () => {
        installTestDOM(CONFIG);

        destroy(renderedSplitPanel()); // warm-up

        const before = new Set(_ruleCacheKeys());
        const panel = renderedSplitPanel();

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        destroy(panel);

        expect(_ruleCacheKeys().filter((key) => !before.has(key))).toEqual([]);
    });

    it('B1-5: destroying a Border-managed panel with a collapsible region leaves no new rule-cache key', () => {
        installTestDOM(CONFIG);

        destroy(renderedBorderPanel()); // warm-up

        const before = new Set(_ruleCacheKeys());
        const panel = renderedBorderPanel();

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        destroy(panel);

        expect(_ruleCacheKeys().filter((key) => !before.has(key))).toEqual([]);
    });

    it('B1-6: destroying an Accordion-managed panel leaves no new rule-cache key', () => {
        installTestDOM(CONFIG);

        destroy(renderedAccordionPanel()); // warm-up

        const before = new Set(_ruleCacheKeys());
        const panel = renderedAccordionPanel();

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        destroy(panel);

        expect(_ruleCacheKeys().filter((key) => !before.has(key))).toEqual([]);
    });

    it('B1-7: swapping an Accordion-managed panel to Fit disposes its headers/wrappers but keeps both content children alive', () => {
        installTestDOM(CONFIG);

        const panel = renderedAccordionPanel();
        const [a, b] = panel.getComponents();

        const acc = panel.getLayoutManager() as unknown as {
            _headers: Array<{ getId(): string }>;
            _panelWrappers: Array<{ getId(): string }>;
        };

        const chromeIds = [...acc._headers, ...acc._panelWrappers].map((c) => c.getId());

        expect(chromeIds.length).toBe(4); // 2 headers + 2 wrappers

        panel.setLayoutManager(new Fit());

        for (const id of chromeIds) {
            expect(_ruleCacheKeys().some((key) => key.includes(id))).toBe(false);
        }

        // Both content components are registered on the panel, not the wrapper,
        // so disposing the wrapper must not take them with it: each keeps its
        // own rule.
        //
        // `getElement()` is deliberately NOT used as the survival check — it
        // falls back to a lookup by id, and the offline harness never evicts
        // the id, so it resolves even for a fully disposed component. The rule
        // keys are the assertion that can actually fail.
        expect(_ruleCacheKeys().some((key) => key.includes(a.getId()))).toBe(true);
        expect(_ruleCacheKeys().some((key) => key.includes(b.getId()))).toBe(true);

        // The reparent in detach() is ordering-sensitive: it must move each
        // content element back onto the container *before* the wrapper that
        // held it is disposed, or the element leaves the document with its
        // wrapper. Asserting the parent is what pins that order — the rule
        // keys above are blind to where the element sits.
        const containerElement = panel.getElement()!;

        expect(DOM.source.getParentElement(a.getElement()!)).toBe(containerElement);
        expect(DOM.source.getParentElement(b.getElement()!)).toBe(containerElement);
    });

    it('B1-12: detaching an Accordion does not destroy a consumer-supplied header tool', () => {
        installTestDOM(CONFIG);

        const panel = renderedAccordionPanel();
        const accordion = panel.getLayoutManager() as Accordion;

        // A tool belongs to the caller, not to the accordion: `addTool` hands it
        // to each header, which registers it as a child of the header's tool
        // group. Disposing the header must therefore not take the tool with it.
        const tool = new Button({ text: 'X' });

        accordion.addTool(tool);

        // Tools are attached to a header when the pointer enters it, so drive
        // that directly — `addTool` alone only records the tool.
        (accordion as unknown as { revealHeaderTools(index: number): void }).revealHeaderTools(0);
        panel.doLayout();

        expect(_ruleCacheKeys().some((key) => key.includes(tool.getId()))).toBe(true);

        panel.setLayoutManager(new Fit());

        // The caller still holds `tool` and may re-add it to another manager,
        // so it must survive with its own rule intact.
        expect(_ruleCacheKeys().some((key) => key.includes(tool.getId()))).toBe(true);
    });

    it('B1-13: detaching an Accordion does not destroy a per-section tool supplied via constraints', () => {
        installTestDOM(CONFIG);

        // The second way a caller-owned tool reaches a header: `createSection`
        // registers every `AccordionConstraints.tools` entry on that section's
        // own header, independently of the global `addTool` registry.
        const tool  = new Button({ text: 'X' });
        const panel = new Panel({ layoutManager: new Accordion() });

        panel.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }), new AccordionConstraints('A', true, undefined, [tool]));
        panel.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }), new AccordionConstraints('B'));

        panel.getElement(true);
        panel.setWidth(300);
        panel.setHeight(300);
        panel.doLayout();

        expect(_ruleCacheKeys().some((key) => key.includes(tool.getId()))).toBe(true);

        panel.setLayoutManager(new Fit());

        expect(_ruleCacheKeys().some((key) => key.includes(tool.getId()))).toBe(true);
    });

    it('B1-14: destroying a resizable Accordion disposes its resize gutters', () => {
        installTestDOM(CONFIG);

        // `_resizeGutters` only exist for a `resizable` manager with an
        // adjacent open pair, which the other Accordion cases do not build —
        // so without this case the `gutter.dispose()` call in `detach()` is
        // never exercised.
        const build = (): Panel => {
            const panel = new Panel({ layoutManager: new Accordion({ resizable: true, singleOpen: false }) });

            panel.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }), new AccordionConstraints('A', true));
            panel.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }), new AccordionConstraints('B', true));

            panel.getElement(true);
            panel.setWidth(300);
            panel.setHeight(300);
            panel.doLayout();

            return panel;
        };

        destroy(build()); // warm-up

        const before = new Set(_ruleCacheKeys());
        const panel  = build();

        const gutters = (panel.getLayoutManager() as unknown as { _resizeGutters: unknown[] })._resizeGutters;

        // Guard the case against silently testing nothing: no gutters means
        // the disposal path below is never reached.
        expect(gutters.length).toBeGreaterThan(0);

        destroy(panel);

        expect(_ruleCacheKeys().filter((key) => !before.has(key))).toEqual([]);
    });
});
