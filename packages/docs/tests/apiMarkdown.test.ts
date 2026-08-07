import { describe, it, expect } from 'vitest';
import {
    normalizeApiMarkdown,
    filterInheritedMembers,
    moduleIndexSource,
    collapseModuleGroups,
    expandModuleBreadcrumb,
} from '../src/content/apiMarkdown.js';
import type { IndexSection } from '../src/content/apiMarkdown.js';

describe('normalizeApiMarkdown', () => {
    it('removes a *** separator line, leaving surrounding blank lines intact', () => {
        expect(normalizeApiMarkdown('a\n\n***\n\nb')).toBe('a\n\n\n\nb');
    });

    it('leaves a source with no *** line byte-identical', () => {
        const source = '# Title\n\nSome plain prose with no separators.\n';

        expect(normalizeApiMarkdown(source)).toBe(source);
    });

    it('strips a *** line even inside a fenced code block', () => {
        const source = '```ts\ncode\n***\nmore code\n```';

        expect(normalizeApiMarkdown(source)).toBe('```ts\ncode\n\nmore code\n```');
    });

    it('leaves inline emphasis untouched — only a line that is exactly *** matches', () => {
        const source = '**bold** and ***emphasis*** stay\n***\nkept';

        expect(normalizeApiMarkdown(source)).toBe('**bold** and ***emphasis*** stay\n\nkept');
    });
});

describe('filterInheritedMembers', () => {
    it('returns a source with no "#### Inherited from" line byte-identical', () => {
        const source = [
            '# Class: Foo',
            '',
            '## Methods',
            '',
            '### bar()',
            '',
            'Own method, not inherited.',
            '',
        ].join('\n');

        expect(filterInheritedMembers(source)).toBe(source);
    });

    it('removes only the inherited members from a section with a mix, keeping the heading and own members', () => {
        const source = [
            '## Methods',
            '',
            '### ownMethod()',
            '',
            'Declared by this class.',
            '',
            '### inheritedMethod()',
            '',
            'Body text.',
            '',
            '#### Inherited from',
            '',
            '[`Base`](../Base.md).[`inheritedMethod`](../Base.md#inheritedmethod)',
            '',
            '### anotherOwnMethod()',
            '',
            'Also declared here.',
        ].join('\n');

        const result = filterInheritedMembers(source);

        expect(result).toContain('## Methods');
        expect(result).toContain('### ownMethod()');
        expect(result).toContain('### anotherOwnMethod()');
        expect(result).not.toContain('inheritedMethod');
    });

    it('removes a whole section, heading included, when every member in it is inherited', () => {
        const source = [
            '# Class: Thin',
            '',
            '## Methods',
            '',
            '### addComponent()',
            '',
            '#### Inherited from',
            '',
            '[`Component`](../Component.md).[`addComponent`](../Component.md#addcomponent)',
            '',
            '### addComponents()',
            '',
            '#### Inherited from',
            '',
            '[`Component`](../Component.md).[`addComponents`](../Component.md#addcomponents)',
            '',
            '## Properties',
            '',
            '### ownProp',
            '',
            'Declared here.',
        ].join('\n');

        const result = filterInheritedMembers(source);

        expect(result).not.toContain('## Methods');
        expect(result).not.toContain('addComponent');
        expect(result).toContain('## Properties');
        expect(result).toContain('### ownProp');
    });

    it('filters multiple sections independently', () => {
        const source = [
            '## Methods',
            '',
            '### ownMethod()',
            '',
            'Declared here.',
            '',
            '### inheritedMethod()',
            '',
            '#### Inherited from',
            '',
            '[`Base`](../Base.md).[`inheritedMethod`](../Base.md#inheritedmethod)',
            '',
            '## Properties',
            '',
            '### inheritedProp',
            '',
            '#### Inherited from',
            '',
            '[`Base`](../Base.md).[`inheritedProp`](../Base.md#inheritedprop)',
            '',
            '### ownProp',
            '',
            'Declared here.',
        ].join('\n');

        const result = filterInheritedMembers(source);

        expect(result).toContain('### ownMethod()');
        expect(result).not.toContain('inheritedMethod');
        expect(result).toContain('### ownProp');
        expect(result).not.toContain('inheritedProp');
    });

    it('removes an entire inherited member block, including nested Parameters content, not just from the marker down', () => {
        const source = [
            '## Methods',
            '',
            '### setWidth()',
            '',
            '```ts',
            'setWidth(value: number): this;',
            '```',
            '',
            '#### Parameters',
            '',
            '##### value',
            '',
            '`number`',
            '',
            '#### Returns',
            '',
            '`this`',
            '',
            '#### Inherited from',
            '',
            '[`Component`](../Component.md).[`setWidth`](../Component.md#setwidth)',
            '',
            '### ownMethod()',
            '',
            'Declared here.',
        ].join('\n');

        const result = filterInheritedMembers(source);

        expect(result).not.toContain('setWidth');
        expect(result).not.toContain('##### value');
        expect(result).toContain('### ownMethod()');
    });

    it('leaves the literal text "Inherited from" alone when it is not an exact "#### Inherited from" heading line', () => {
        const source = [
            '## Methods',
            '',
            '### ownMethod()',
            '',
            'See "Inherited from" in the base class docs for background — not a real heading here.',
        ].join('\n');

        expect(filterInheritedMembers(source)).toBe(source);
    });

    it('does not treat a line merely starting with "#### Inherited from" as the exact marker', () => {
        const source = [
            '## Methods',
            '',
            '### ownMethod()',
            '',
            '#### Inherited from a mixin, not a base class — different heading, not the exact marker.',
            '',
            'Still declared here in prose.',
        ].join('\n');

        expect(filterInheritedMembers(source)).toBe(source);
    });
});

describe('moduleIndexSource', () => {
    it("breadcrumbs a first-level module with one '..'", () => {
        const source = moduleIndexSource('core', []);
        const lines  = source.split('\n');

        expect(lines[0]).toBe('[@jimka/typescript-ui](../index.md) / core');
        expect(lines[2]).toBe('# core');
    });

    it("breadcrumbs a two-segment module with two '..'", () => {
        const source = moduleIndexSource('component/button', []);
        const lines  = source.split('\n');

        expect(lines[0]).toBe('[@jimka/typescript-ui](../../index.md) / component/button');
        expect(lines[2]).toBe('# component/button');
    });

    it('renders a section heading followed by its bulleted links', () => {
        const sections: IndexSection[] = [
            { heading: 'Classes', links: [{ text: 'Button', href: 'classes/Button.md' }] },
        ];

        expect(moduleIndexSource('component/button', sections)).toContain(
            '## Classes\n\n- [Button](classes/Button.md)',
        );
    });

    it('renders a heading with no bullets for a section with an empty links array', () => {
        const sections: IndexSection[] = [{ heading: 'Enumerations', links: [] }];
        const source = moduleIndexSource('core', sections);

        expect(source).toContain('## Enumerations');
        expect(source).not.toMatch(/## Enumerations\n\n- /);
    });

    it('emits breadcrumb and heading only for a module with no sections', () => {
        const source = moduleIndexSource('core', []);

        expect(source).not.toContain('## ');
    });
});

describe('collapseModuleGroups', () => {
    const root = [
        '# @jimka/typescript-ui',
        '',
        '## Modules',
        '',
        '- [component/button](component/button/index.md)',
        '- [component/chart](component/chart/index.md)',
        '- [component/tree](component/tree/index.md)',
        '- [core](core/index.md)',
        '- [data](data/index.md)',
        '',
    ].join('\n');

    it('collapses a run of group/* lines into one group line at the first line\'s position', () => {
        const result = collapseModuleGroups(root, ['component']);

        expect(result).toContain('- [component](component/index.md)');
        expect(result).not.toContain('component/button');
        expect(result).not.toContain('component/chart');
        expect(result).not.toContain('component/tree');
        expect(result).toContain('- [core](core/index.md)');
        expect(result).toContain('- [data](data/index.md)');

        const lines = result.split('\n');
        expect(lines[4]).toBe('- [component](component/index.md)');
    });

    it('returns the source byte-identical when no line matches a group', () => {
        const source = '- [core](core/index.md)\n- [data](data/index.md)\n';

        expect(collapseModuleGroups(source, ['component'])).toBe(source);
    });

    it('returns the source byte-identical for an empty groups list', () => {
        expect(collapseModuleGroups(root, [])).toBe(root);
    });
});

describe('expandModuleBreadcrumb', () => {
    it('splits a linked two-segment module crumb into one crumb per directory, keeping the original href on the last', () => {
        const source = [
            '[@jimka/typescript-ui](../../../index.md) / [component/button](../index.md) / Button',
            '',
            '# Class: Button',
        ].join('\n');

        const lines = expandModuleBreadcrumb(source).split('\n');

        expect(lines[0]).toBe(
            '[@jimka/typescript-ui](../../../index.md) / [component](../../index.md) / [button](../index.md) / Button',
        );
        expect(lines[2]).toBe('# Class: Button');
    });

    it('splits a plain (unlinked) two-segment module crumb — the module\'s own index page — leaving the last segment unlinked', () => {
        const source = '[@jimka/typescript-ui](../../index.md) / component/button\n\n# component/button\n';

        const lines = expandModuleBreadcrumb(source).split('\n');

        expect(lines[0]).toBe('[@jimka/typescript-ui](../../index.md) / [component](../index.md) / button');
    });

    it('leaves a single-segment module crumb unchanged', () => {
        const source = '[@jimka/typescript-ui](../index.md) / [core](../index.md) / Component';

        expect(expandModuleBreadcrumb(source)).toBe(source);
    });

    it('leaves a namespace symbol breadcrumb (four single-segment crumbs) unchanged', () => {
        const source =
            '[@jimka/typescript-ui](../../../../index.md) / [core](../../../index.md) / [Animation](../index.md) / play';

        expect(expandModuleBreadcrumb(source)).toBe(source);
    });

    it('returns a source with no breadcrumb line byte-identical', () => {
        const source = '# @jimka/typescript-ui\n\n## Modules\n';

        expect(expandModuleBreadcrumb(source)).toBe(source);
    });
});
