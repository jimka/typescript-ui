import { describe, it, expect } from 'vitest';
import { normalizeApiMarkdown } from '../src/content/apiMarkdown.js';

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
