//
// AutoCompleteField match-mode coverage. The core unit is the private
// `matches(candidate, query)` predicate across all four match modes; it is
// reached via an `any` cast confined to this file. getValue/setValue delegate
// to the inner TextField and round-trip on a bare (unmounted) field. Debounce
// timing and the dropdown/store paths are out of scope (Non-Goals).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutoCompleteField } from '~/component/input/AutoCompleteField';
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

/** Builds a field in the given match mode and returns its private `matches`. */
function matcherFor(matchMode?: string): (candidate: string, query: string) => boolean {
    const field = new AutoCompleteField(matchMode ? { matchMode: matchMode as any } : undefined);

    // matches is the private unit under test; cast to reach it.
    return (candidate: string, query: string): boolean => (field as any).matches(candidate, query);
}

describe('AutoCompleteField matches: contains (default)', () => {
    const matches = matcherFor();

    it('matches a case-insensitive substring anywhere in the candidate', () => {
        expect(matches('apple', 'PL')).toBe(true);
        expect(matches('apple', 'app')).toBe(true);
        expect(matches('apple', 'le')).toBe(true);
    });

    it('rejects a substring not present in the candidate', () => {
        expect(matches('apple', 'xyz')).toBe(false);
    });

    // Prior-fix pin: the default mode lowercases both sides
    // (AutoCompleteField.ts:506-507). Locks the case-insensitive contract.
    it('matches case-insensitively regardless of either side casing', () => {
        expect(matches('Banana', 'BANANA')).toBe(true);
    });
});

describe('AutoCompleteField matches: startsWith', () => {
    const matches = matcherFor('startsWith');

    it('matches a case-insensitive prefix', () => {
        expect(matches('Apple', 'app')).toBe(true);
    });

    it('rejects a prefix that does not start the candidate', () => {
        expect(matches('apricot', 'app')).toBe(false);
    });
});

describe('AutoCompleteField matches: containsCaseSensitive', () => {
    const matches = matcherFor('containsCaseSensitive');

    it('matches a case-sensitive substring', () => {
        expect(matches('Apple', 'App')).toBe(true);
    });

    it('rejects when the casing differs', () => {
        expect(matches('Apple', 'app')).toBe(false);
    });
});

describe('AutoCompleteField matches: startsWithCaseSensitive', () => {
    const matches = matcherFor('startsWithCaseSensitive');

    it('matches a case-sensitive prefix', () => {
        expect(matches('Apple', 'App')).toBe(true);
    });

    it('rejects a prefix with mismatched casing', () => {
        expect(matches('Apple', 'app')).toBe(false);
    });

    it('rejects a case-sensitive substring that is not a prefix', () => {
        expect(matches('Pineapple', 'apple')).toBe(false);
    });
});

describe('AutoCompleteField value delegation', () => {
    it('round-trips getValue/setValue through the inner TextField', () => {
        const field = new AutoCompleteField({ suggestions: ['Apple', 'Banana'] });
        expect(field.getValue()).toBe('');

        field.setValue('Cherry');
        expect(field.getValue()).toBe('Cherry');
    });
});

describe('AutoCompleteField select event routing', () => {
    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => DOM.reset());

    it('fires both on("select") and addSelectListener on a suggestion pick, and off("select") stops only the framework listener', () => {
        const field = new AutoCompleteField({ suggestions: ['Apple'] });
        field.getElement(true);

        let viaOn     = 0;
        let viaLegacy = 0;
        let lastValue: string | null = null;

        const onSelect = (v: string): void => {
            viaOn += 1;
            lastValue = v;
        };

        field.on('select', onSelect);
        field.addSelectListener(() => { viaLegacy += 1; });

        (field as any).onSuggestionSelected('Apple');

        expect(viaOn).toBe(1);
        expect(viaLegacy).toBe(1);
        expect(lastValue).toBe('Apple');

        field.off('select', onSelect);

        (field as any).onSuggestionSelected('Apple');

        // The removed framework listener no longer fires; the legacy
        // addSelectListener (also routed through the bag) still does.
        expect(viaOn).toBe(1);
        expect(viaLegacy).toBe(2);
    });
});
