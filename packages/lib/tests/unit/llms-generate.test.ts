// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect } from 'vitest';

// The generator is a plain ESM Node script; import its pure helpers directly.
import {
    buildSymbolIndex,
    resolveSymbol,
    summarize,
    resolveDoc,
    linkFor,
    interpolateProse,
    renderRow,
    estimateTokens,
    assertBudget,
} from '../../scripts/llms/generate.mjs';

/** TypeDoc ReflectionKind values used by the generator. */
const KIND_CLASS = 128;
const KIND_INTERFACE = 256;

/**
 * A synthetic TypeDoc model mirroring the real shape: modules named by full export
 * subpath, class/interface children with `comment.summary` parts, and the real
 * cross-module name collision (`TreeNode` as an interface in `component/tree` and a
 * class in `data`). Keeping this synthetic avoids depending on the 96 MB build artifact.
 */
function makeModel() {
    const buttonSummary = [
        { kind: 'text', text: 'A push button component with a text label and configurable pressed-state appearance.\n\nMaintains separate CSS rules for the normal and ' },
        { kind: 'code', text: '`:active`' },
        { kind: 'text', text: ' states.' },
    ];

    const linkSummary = [
        { kind: 'text', text: 'Backed by a ' },
        { kind: 'inline-tag', tag: '@link', text: 'Store' },
        { kind: 'text', text: ' of records.' },
    ];

    // Mirrors the real TabPanel lead: an author-written markdown link split across parts.
    const markdownLinkSummary = [
        { kind: 'text', text: 'A [' },
        { kind: 'code', text: '`Container`' },
        { kind: 'text', text: '](/api/core/classes/Container) subclass.' },
    ];

    return {
        kind: 1,
        children: [
            { kind: 2, name: 'component/button', children: [
                { kind: KIND_CLASS, name: 'Button', comment: { summary: buttonSummary } },
            ] },
            { kind: 2, name: 'layout', children: [
                { kind: KIND_CLASS, name: 'VBox', comment: { summary: [{ kind: 'text', text: 'Lays out children in a single vertical column.' }] } },
            ] },
            { kind: 2, name: 'component/tree', children: [
                { kind: KIND_INTERFACE, name: 'TreeNode' },
            ] },
            { kind: 2, name: 'component/container', children: [
                { kind: KIND_CLASS, name: 'TabPanel', comment: { summary: markdownLinkSummary } },
            ] },
            { kind: 2, name: 'data', children: [
                { kind: KIND_CLASS, name: 'Store', comment: { summary: linkSummary } },
                { kind: KIND_CLASS, name: 'TreeNode', comment: { summary: [{ kind: 'text', text: 'A node in a tree store.' }] } },
                { kind: 64, name: 'someFunction' }, // non class/interface — must be ignored
            ] },
        ],
    };
}

describe('llms generator — symbol resolution', () => {
    it('resolves a symbol to its owning module as the import subpath', () => {
        const index = buildSymbolIndex(makeModel());
        expect(resolveSymbol({ symbol: 'Button' }, index).subpath).toBe('component/button');
        expect(resolveSymbol({ symbol: 'VBox' }, index).subpath).toBe('layout');
        expect(resolveSymbol({ symbol: 'Store' }, index).subpath).toBe('data');
    });

    it('indexes only classes and interfaces, not other reflection kinds', () => {
        const index = buildSymbolIndex(makeModel());
        expect(index.get('data')!.has('someFunction')).toBe(false);
    });

    it('resolves a colliding name via its subpath disambiguator', () => {
        const index = buildSymbolIndex(makeModel());
        expect(resolveSymbol({ symbol: 'TreeNode', subpath: 'data' }, index).subpath).toBe('data');
    });

    it('throws on an ambiguous colliding name with no subpath', () => {
        const index = buildSymbolIndex(makeModel());
        expect(() => resolveSymbol({ symbol: 'TreeNode' }, index)).toThrow(/ambiguous/i);
    });

    it('throws on a renamed / removed symbol (zero matches)', () => {
        const index = buildSymbolIndex(makeModel());
        expect(() => resolveSymbol({ symbol: 'NoSuchSymbol' }, index)).toThrow(/not found/i);
    });

    it('throws when a subpath is given but the symbol is absent there', () => {
        const index = buildSymbolIndex(makeModel());
        expect(() => resolveSymbol({ symbol: 'Button', subpath: 'data' }, index)).toThrow(/not found/i);
    });
});

describe('llms generator — summary extraction', () => {
    it('takes the first paragraph, dropping later paragraphs and @example blocks', () => {
        const index = buildSymbolIndex(makeModel());
        const { node } = resolveSymbol({ symbol: 'Button' }, index);
        expect(summarize(node)).toBe('A push button component with a text label and configurable pressed-state appearance.');
    });

    it('keeps inline-tag ({@link}) words instead of dropping them', () => {
        const index = buildSymbolIndex(makeModel());
        const { node } = resolveSymbol({ symbol: 'Store' }, index);
        expect(summarize(node)).toBe('Backed by a Store of records.');
    });

    it('strips author-written markdown links to their display text (no /api/ leak)', () => {
        const index = buildSymbolIndex(makeModel());
        const { node } = resolveSymbol({ symbol: 'TabPanel' }, index);
        expect(summarize(node)).toBe('A `Container` subclass.');
        expect(summarize(node)).not.toMatch(/\/api\//);
    });

    it('returns the lead sentence for a documented symbol and an empty string for an undocumented one', () => {
        const index = buildSymbolIndex(makeModel());
        const { node } = resolveSymbol({ symbol: 'TreeNode', subpath: 'data' }, index);
        expect(summarize(node)).toBe('A node in a tree store.');
        expect(summarize({})).toBe('');
    });

    it('caps a long summary with an ellipsis (bounds a row for the budget)', () => {
        const long = 'x'.repeat(300);
        const node = { comment: { summary: [{ kind: 'text', text: long }] } };
        const result = summarize(node);
        expect(result.length).toBeLessThanOrEqual(140);
        expect(result.endsWith('…')).toBe(true);
    });
});

describe('llms generator — row rendering', () => {
    const row = { task: 'Push button', symbol: 'Button', subpath: 'component/button', summary: 'A push button.', target: 'docs/components/Button.md' };

    it('renders the catalog row contract: task → **Symbol** · subpath · summary · docs', () => {
        expect(renderRow(row, 'fs')).toBe('- Push button → **Button** · `@jimka/typescript-ui/component/button` · A push button. · docs/components/Button.md');
    });

    it('rewrites the doc link per mode and omits it when there is no page', () => {
        expect(renderRow(row, 'site')).toContain('· https://jimka.github.io/typescript-ui/components/Button');
        expect(renderRow({ ...row, target: null }, 'fs')).toBe('- Push button → **Button** · `@jimka/typescript-ui/component/button` · A push button.');
    });
});

describe('llms generator — linkFor (two variants)', () => {
    it('fs mode returns the repo-relative path verbatim', () => {
        expect(linkFor('docs/components/Button.md', 'fs')).toBe('docs/components/Button.md');
        expect(linkFor('ARCHITECTURE.md', 'fs')).toBe('ARCHITECTURE.md');
    });

    it('site mode strips docs/ + .md and prepends the site base', () => {
        expect(linkFor('docs/components/Button.md', 'site')).toBe('https://jimka.github.io/typescript-ui/components/Button');
        expect(linkFor('docs/concepts/sizing.md', 'site')).toBe('https://jimka.github.io/typescript-ui/concepts/sizing');
    });

    it('site mode keeps a section-root (trailing slash) as a directory URL', () => {
        expect(linkFor('docs/components/', 'site')).toBe('https://jimka.github.io/typescript-ui/components/');
        expect(linkFor('docs/api/', 'site')).toBe('https://jimka.github.io/typescript-ui/api/');
    });

    it('site mode points repo-root docs at the GitHub blob URL', () => {
        expect(linkFor('ARCHITECTURE.md', 'site')).toBe('https://github.com/jimka/typescript-ui/blob/master/ARCHITECTURE.md');
        expect(linkFor('CODE_CONVENTIONS.md', 'site')).toBe('https://github.com/jimka/typescript-ui/blob/master/CODE_CONVENTIONS.md');
    });
});

describe('llms generator — prose interpolation', () => {
    it('resolves {{placeholders}} through linkFor per mode', () => {
        const block = 'See {{guide/mental-model}} and {{ARCHITECTURE}}.';
        expect(interpolateProse(block, 'fs')).toBe('See docs/guide/mental-model.md and ARCHITECTURE.md.');
        expect(interpolateProse(block, 'site')).toBe('See https://jimka.github.io/typescript-ui/guide/mental-model and https://github.com/jimka/typescript-ui/blob/master/ARCHITECTURE.md.');
    });

    it('leaves no docs/ filesystem path in a site-mode prose block', () => {
        const block = 'Detail → {{components/}}, {{layouts/}}; API → {{api/}}.';
        expect(interpolateProse(block, 'site')).not.toMatch(/docs\//);
    });

    it('throws on an unknown placeholder key', () => {
        expect(() => interpolateProse('{{nope/missing}}', 'fs')).toThrow(/proseTargets/);
    });
});

describe('llms generator — doc resolution & budget', () => {
    it('uses an explicit doc override when the page exists', () => {
        const warnings: string[] = [];
        expect(resolveDoc({ symbol: 'Store', doc: 'docs/data/store.md' }, warnings)).toBe('docs/data/store.md');
        expect(warnings).toHaveLength(0);
    });

    it('warns and returns null when no page exists', () => {
        const warnings: string[] = [];
        expect(resolveDoc({ symbol: 'ZzzNonexistentComponent' }, warnings)).toBeNull();
        expect(warnings).toHaveLength(1);
    });

    it('estimates tokens as ceil(chars / 4)', () => {
        expect(estimateTokens('12345678')).toBe(2);
        expect(estimateTokens('123456789')).toBe(3);
    });

    it('passes a within-budget document and throws past the ceiling', () => {
        expect(assertBudget('small.txt', 'a'.repeat(400))).toBe(100);
        // ceil(28000 / 4) = 7000 tokens, over any ceiling the constant has carried.
        expect(() => assertBudget('big.txt', 'a'.repeat(28000))).toThrow(/budget/i);
    });
});
