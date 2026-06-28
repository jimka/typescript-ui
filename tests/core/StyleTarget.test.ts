import { describe, it, expect } from 'vitest';
import { StyleRule } from '~/core/StyleTarget';

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
