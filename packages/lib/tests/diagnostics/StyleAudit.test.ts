// @vitest-environment jsdom
//
// Coverage for the extracted stylesheet-dedup audit
// (plans/in-progress/diagnostics-overlay-style-audit-window.md, Expected
// Behaviour rows 5-9). Needs a real `document`/`CSSStyleSheet` for real
// `cssText` — the dedup math is meaningless under the modelled source's
// `getRuleCssText() === ''` — mirroring the `@vitest-environment jsdom`
// pragma and real-`StyleRule` construction of tests/core/StyleTarget.test.ts
// and tests/dom/style-rule-index.test.ts. Every rule this file materialises
// is disposed at the end of its own test, so `_ruleCache` (module state that
// outlives every test in this file — see StyleTarget.test.ts) stays clean
// for the next one.
import { describe, it, expect } from 'vitest';
import { StyleRule, styleRuleEntries } from '~/core/StyleTarget';
import { DOM } from '~/core/DOM';
import { auditStyleRules } from '~/diagnostics/StyleAudit';

describe('auditStyleRules', () => {
    it('5. two #id rules with byte-identical bodies produce one duplicate row with count 2', () => {
        const a = new StyleRule({ scope: 'component', name: 'audit-dup-a', styles: { color: 'rebeccapurple' } });
        const b = new StyleRule({ scope: 'component', name: 'audit-dup-b', styles: { color: 'rebeccapurple' } });

        const { duplicates } = auditStyleRules();
        const row = duplicates.find((d) => d.body.includes('rebeccapurple'));

        expect(row?.count).toBe(2);

        a.dispose();
        b.dispose();
    });

    it('6. resolves a matching component name for one duplicate row and "—" for a fully unmatched one', () => {
        const el = document.createElement('div');
        el.className = 'ts-ui-component Button';
        el.id = 'audit-comp-match';
        document.body.appendChild(el);

        const matched        = new StyleRule({ scope: 'component', name: 'audit-comp-match',      styles: { color: 'seagreen' } });
        const sameBodyNoMatch = new StyleRule({ scope: 'component', name: 'audit-comp-unlabelled', styles: { color: 'seagreen' } });

        const noMatchA = new StyleRule({ scope: 'component', name: 'audit-comp-none-a', styles: { color: 'tomato' } });
        const noMatchB = new StyleRule({ scope: 'component', name: 'audit-comp-none-b', styles: { color: 'tomato' } });

        const { duplicates } = auditStyleRules();

        const matchedRow   = duplicates.find((d) => d.body.includes('seagreen'));
        const unmatchedRow = duplicates.find((d) => d.body.includes('tomato'));

        expect(matchedRow?.component).toBe('Button');
        expect(unmatchedRow?.component).toBe('—');

        document.body.removeChild(el);
        matched.dispose();
        sameBodyNoMatch.dispose();
        noMatchA.dispose();
        noMatchB.dispose();
    });

    it('7. totalRules matches styleRuleEntries().length; a keyframes rule is absent from both', () => {
        const beforeEntries = styleRuleEntries().length;
        const beforeSummary = auditStyleRules().summary;

        expect(beforeSummary.totalRules).toBe(beforeEntries);

        DOM.sink.ensureKeyframes('audit-kf-test', 'from{opacity:0}to{opacity:1}');

        const afterEntries = styleRuleEntries().length;
        const afterSummary = auditStyleRules().summary;

        expect(afterEntries).toBe(beforeEntries);
        expect(afterSummary.totalRules).toBe(afterEntries);
    });

    it('8. duplicates are sorted by wasted bytes descending and capped to 25 rows, even with more than 25 duplicate bodies', () => {
        const rules: StyleRule[] = [];

        for (let i = 0; i < 30; i++) {
            // The "#i#" delimiter keeps a single-digit i's marker from being a
            // substring of a double-digit i's marker (e.g. "#1#" inside "#15#").
            const body = `AUDITCAP#${i}#` + 'x'.repeat(1000 + i);

            rules.push(new StyleRule({ scope: 'component', name: `audit-cap-${i}-a`, styles: { '--audit-cap': body } }));
            rules.push(new StyleRule({ scope: 'component', name: `audit-cap-${i}-b`, styles: { '--audit-cap': body } }));
        }

        const { duplicates } = auditStyleRules();
        const ours = duplicates.filter((d) => d.body.includes('AUDITCAP#'));

        // Every one of the 30 groups is padded far beyond any realistic
        // pre-existing rule's declaration body, so the 25-row cap is filled
        // entirely by these groups — nothing else can outrank them.
        expect(duplicates.length).toBe(25);
        expect(ours.length).toBe(25);

        for (let k = 1; k < ours.length; k++) {
            expect(parseFloat(ours[k - 1].wastedKB)).toBeGreaterThanOrEqual(parseFloat(ours[k].wastedKB));
        }

        for (let i = 5; i < 30; i++) {
            expect(ours.some((d) => d.body.includes(`AUDITCAP#${i}#`))).toBe(true);
        }
        for (let i = 0; i < 5; i++) {
            expect(ours.some((d) => d.body.includes(`AUDITCAP#${i}#`))).toBe(false);
        }

        rules.forEach((r) => r.dispose());
    });

    it('9. a selector not starting with # is excluded from componentRuleCount and dedup, but its bytes still count toward totalSizeKB', () => {
        const before = auditStyleRules();

        const classRule = new StyleRule({ scope: 'class', name: 'AuditAbsent9Marker', styles: { color: 'peru' } });
        const entry      = styleRuleEntries().find((e) => e.selector === '.AuditAbsent9Marker')!;

        const after = auditStyleRules();

        expect(after.summary.componentRuleCount).toBe(before.summary.componentRuleCount);
        expect(after.summary.totalRules).toBe(before.summary.totalRules + 1);
        expect(parseFloat(after.summary.totalSizeKB)).toBeGreaterThan(parseFloat(before.summary.totalSizeKB));
        expect(after.duplicates.some((d) => d.body === entry.cssText.slice(entry.cssText.indexOf('{')))).toBe(false);

        classRule.dispose();
    });
});
