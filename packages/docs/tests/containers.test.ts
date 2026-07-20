import { describe, it, expect } from 'vitest';
import { expandContainers } from '../src/content/containers.js';

describe('expandContainers', () => {
    it('turns a titled container into a blockquote with a bold first line', () => {
        const result = expandContainers('::: tip Title\nbody\n:::');

        const lines = result.split('\n');

        expect(lines[0]).toBe('> **Title**');
        expect(lines[1]).toBe('> body');
    });

    it('uses the capitalised type word when the container has no title', () => {
        const result = expandContainers('::: warning\nbe careful\n:::');

        expect(result.split('\n')[0]).toBe('> **Warning**');
    });

    it('leaves source containing no ::: byte-identical', () => {
        const source = '# Title\n\nSome plain prose with no containers.\n';

        expect(expandContainers(source)).toBe(source);
    });
});
