// @vitest-environment jsdom
//
// Coverage for the style-audit's `DOMSource.getRuleCssText()` seam member
// (plans/in-progress/diagnostics-overlay-style-audit-window.md, Expected
// Behaviour rows 3-4) — against the REAL production source (the `jsdom`
// pragma keeps `tests/setup/node-setup.ts` from installing the modelled DOM,
// mirroring `tests/dom/countElements.test.ts`), and against the modelled
// source via an explicit `installTestDOM`.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM, ProductionDOMSink, ProductionDOMSource } from '~/core/DOM';
import { installTestDOM } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

describe('ProductionDOMSource.getRuleCssText', () => {
    afterEach(() => {
        const style = document.getElementById('Base');

        if (style) {
            style.remove();
        }
    });

    it('4. returns the rule\'s cssText, including declarations set via setMany', () => {
        const sink = new ProductionDOMSink();
        const rule = sink.ensureStyleRule('#getrulecsstext-test');

        sink.setRuleStyles(rule, { color: 'red' });

        const cssText = new ProductionDOMSource().getRuleCssText(rule);

        expect(cssText).toContain('#getrulecsstext-test');
        expect(cssText).toContain('color: red');
    });
});

describe('ModelledDOMSource.getRuleCssText', () => {
    afterEach(() => DOM.reset());

    it('3. returns \'\' — no live stylesheet offline', () => {
        installTestDOM({
            rootMountOffset: { x: 0, y: 0 },
            viewport:        { width: 1280, height: 800 },
            scrollBarWidth:  15,
            fontMetrics,
            themeVars:       {},
        });

        expect(DOM.source.getRuleCssText({} as CSSStyleRule)).toBe('');
    });
});
