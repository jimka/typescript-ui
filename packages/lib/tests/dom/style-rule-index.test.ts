// @vitest-environment jsdom
//
// Production style-rule index behaviour, exercised through the real
// ProductionDOMSink against a real `document`/`CSSStyleSheet` — mirrors the
// pragma and structure of handle-registry.test.ts. Pins the find-or-insert /
// remove-if-present contract of ensureStyleRule / deleteStyleRule, including
// the lazy build-from-live-sheet behaviour that keeps a fresh sink honest
// about rules a previous sink already left on the shared `<style id="Base">`
// sheet after `DOM.reset()`.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM, ProductionDOMSink } from '~/core/DOM';

function baseSheet(): CSSStyleSheet {
    const style = document.getElementById('Base') as HTMLStyleElement;

    return style.sheet as CSSStyleSheet;
}

function selectors(sheet: CSSStyleSheet): string[] {
    const result: string[] = [];

    for (let idx = 0; idx < sheet.cssRules.length; idx += 1) {
        const rule = sheet.cssRules[idx];

        if (rule.type === CSSRule.STYLE_RULE) {
            result.push((rule as CSSStyleRule).selectorText);
        }
    }

    return result;
}

describe('ProductionDOMSink style-rule index', () => {
    afterEach(() => {
        const style = document.getElementById('Base');

        if (style) {
            style.remove();
        }

        DOM.reset();
    });

    it('first lookup inserts a single rule with the requested selector', () => {
        const sink = new ProductionDOMSink();
        const rule = sink.ensureStyleRule('#alpha');

        expect(baseSheet().cssRules.length).toBe(1);
        expect(rule.selectorText).toBe('#alpha');
    });

    it('repeat lookup returns the same object without growing the sheet', () => {
        const sink  = new ProductionDOMSink();
        const first = sink.ensureStyleRule('#alpha');
        const again = sink.ensureStyleRule('#alpha');

        expect(again).toBe(first);
        expect(baseSheet().cssRules.length).toBe(1);
    });

    it('lookup after deletion inserts a new, distinct rule', () => {
        const sink  = new ProductionDOMSink();
        const first = sink.ensureStyleRule('#alpha');

        sink.deleteStyleRule('#alpha');
        expect(baseSheet().cssRules.length).toBe(0);

        const second = sink.ensureStyleRule('#alpha');

        expect(baseSheet().cssRules.length).toBe(1);
        expect(second).not.toBe(first);
    });

    it('deleting a selector that was never inserted is a no-op', () => {
        const sink  = new ProductionDOMSink();
        const alpha = sink.ensureStyleRule('#alpha');

        sink.deleteStyleRule('#never');

        expect(baseSheet().cssRules.length).toBe(1);
        expect(sink.ensureStyleRule('#alpha')).toBe(alpha);
    });

    it('deletes from the middle without disturbing the surviving rules', () => {
        const sink = new ProductionDOMSink();
        const a    = sink.ensureStyleRule('#a');
        const b    = sink.ensureStyleRule('#b');
        const c    = sink.ensureStyleRule('#c');

        sink.deleteStyleRule('#b');

        expect(baseSheet().cssRules.length).toBe(2);
        expect(selectors(baseSheet())).toEqual(['#a', '#c']);
        expect(sink.ensureStyleRule('#a')).toBe(a);
        expect(sink.ensureStyleRule('#c')).toBe(c);
        expect(baseSheet().cssRules.length).toBe(2);
        void b;
    });

    it('adopts an existing rule left on the sheet after DOM.reset(), rather than duplicating it', () => {
        const sinkA = new ProductionDOMSink();
        const ruleA = sinkA.ensureStyleRule('#alpha');

        DOM.reset();

        const sinkB = new ProductionDOMSink();
        const ruleB = sinkB.ensureStyleRule('#alpha');

        expect(baseSheet().cssRules.length).toBe(1);
        expect(ruleB).toBe(ruleA);
    });

    it('a rule adopted after DOM.reset() is still deletable', () => {
        const sinkA = new ProductionDOMSink();

        sinkA.ensureStyleRule('#alpha');

        DOM.reset();

        const sinkB = new ProductionDOMSink();

        sinkB.deleteStyleRule('#alpha');

        expect(baseSheet().cssRules.length).toBe(0);
    });

    it('a keyframes rule interleaved among style rules does not corrupt the index', () => {
        const sink  = new ProductionDOMSink();
        const alpha = sink.ensureStyleRule('#alpha');

        sink.ensureKeyframes('k', 'from{opacity:0}to{opacity:1}');

        const beta = sink.ensureStyleRule('#beta');

        expect(sink.ensureStyleRule('#alpha')).toBe(alpha);

        sink.deleteStyleRule('#alpha');

        expect(selectors(baseSheet())).toEqual(['#beta']);
        expect(baseSheet().cssRules.length).toBe(2); // keyframes rule + #beta
        expect(sink.ensureStyleRule('#beta')).toBe(beta);
    });

    it('a keyframes rule present at index-build time does not poison the rebuilt index', () => {
        const sinkA = new ProductionDOMSink();

        sinkA.ensureKeyframes('k', 'from{opacity:0}to{opacity:1}');

        DOM.reset();

        const sinkB = new ProductionDOMSink();

        expect(() => sinkB.ensureStyleRule('#alpha')).not.toThrow();

        const first  = sinkB.ensureStyleRule('#alpha');
        const second = sinkB.ensureStyleRule('#alpha');

        expect(second).toBe(first);
    });
});
