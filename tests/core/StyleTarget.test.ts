import { describe, it, expect } from 'vitest';
import { StyleRule, _ruleCacheHas } from '~/core/StyleTarget';
import { DOM } from '~/core/DOM';
import type { RecordingDOMSink } from '../dom/TestDOM';

// Regression: a component-scoped style rule is keyed on the element's #id, and
// the id is consumer-supplied (e.g. a Dock panel id "public.customers"). The
// selector must CSS-escape the id, or a "." / ":" in it makes "#public.customers"
// parse as id="public" + class="customers" — the rule never matches the element,
// position:absolute is dropped, and the component collapses to position:static.
describe('StyleRule — component-scope selector escaping', () => {
    it('escapes CSS-special characters in a component id', () => {
        const rule = new StyleRule({ scope: 'component', name: 'public.customers', materialize: false });

        expect(rule.ensure().selectorText).toBe('#public\\.customers');
    });

    it('leaves a plain id unchanged', () => {
        const rule = new StyleRule({ scope: 'component', name: 'cmp-12', materialize: false });

        expect(rule.ensure().selectorText).toBe('#cmp-12');
    });

    it('escapes the id but keeps a live selector suffix unescaped', () => {
        const rule = new StyleRule({ scope: 'component', name: 'public.customers', suffix: ':hover', materialize: false });

        expect(rule.ensure().selectorText).toBe('#public\\.customers:hover');
    });
});

// Regression: teardown must remove a component's per-instance rule from the
// shared stylesheet, or the sheet grows unbounded as components are discarded
// (see plans/implemented/component-style-rule-disposal.md). Each case uses a
// unique selector name — `_ruleCache` is module state that survives
// `DOM.reset()`, so a shared name would let a leftover cache entry from a
// prior test mask an `ensureStyleRule` op (a cache hit skips the sink call).
describe('StyleRule — dispose', () => {
    it('deletes the materialised rule from the sink and evicts the cache', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.dispose-test-materialised', materialize: false });

        rule.ensure();
        expect(_ruleCacheHas('.dispose-test-materialised')).toBe(true);

        rule.dispose();

        expect(_ruleCacheHas('.dispose-test-materialised')).toBe(false);
        expect(sink.writes).toContainEqual({ op: 'deleteStyleRule', args: ['.dispose-test-materialised'] });
    });

    it('is a no-op on a never-materialised rule', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.dispose-test-unmaterialised', materialize: false });

        rule.dispose();

        expect(sink.writes.some((w) => w.op === 'deleteStyleRule')).toBe(false);
        expect(_ruleCacheHas('.dispose-test-unmaterialised')).toBe(false);
    });

    it('is idempotent — a second call records no further deleteStyleRule op', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.dispose-test-idempotent', materialize: false });

        rule.ensure();
        rule.dispose();
        const deleteCount = sink.writes.filter((w) => w.op === 'deleteStyleRule').length;

        rule.dispose();

        expect(sink.writes.filter((w) => w.op === 'deleteStyleRule').length).toBe(deleteCount);
    });

    it('is not terminal — a later ensure() re-materialises', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.dispose-test-rematerialise', materialize: false });

        rule.ensure();
        rule.dispose();
        rule.ensure();

        expect(_ruleCacheHas('.dispose-test-rematerialise')).toBe(true);
        expect(sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === '.dispose-test-rematerialise').length).toBe(2);
    });
});
